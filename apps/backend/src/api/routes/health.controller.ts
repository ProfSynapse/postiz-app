import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { BullMqClient } from '@gitroom/nestjs-libraries/bull-mq-transport-new/client';
import {
  KNOWN_QUEUE_PATTERNS,
  POST_QUEUE_PATTERN,
  KnownQueuePattern,
} from '@gitroom/nestjs-libraries/bull-mq-transport-new/queues.constants';

const healthControllerLogger = new Logger('HealthController');

function parsePositiveIntEnv(
  name: string,
  raw: string | undefined,
  defaultValue: number
): number {
  if (raw === undefined || raw === '') return defaultValue;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    healthControllerLogger.warn(
      `Invalid ${name}="${raw}" — must be positive integer; using default ${defaultValue}`
    );
    return defaultValue;
  }
  return n;
}

// Probe timeout: how long a single sub-probe (redis ping, postgres SELECT 1,
// bullmq worker fanout) may take before withTimeout rejects it. Overridable
// via HEALTH_PROBE_TIMEOUT_MS so operators can loosen the bound during a
// known-degraded window without a deploy.
const PROBE_TIMEOUT_MS = parsePositiveIntEnv(
  'HEALTH_PROBE_TIMEOUT_MS',
  process.env.HEALTH_PROBE_TIMEOUT_MS,
  3_000
);

// Delayed-job staleness threshold for the post queue.
//
// BullMQ stores delayed jobs in a sorted set (key `bull:<queue>:delayed`)
// scored by fire-time in ms-epoch. ZCOUNT key -inf (now-THRESHOLD_MS) counts
// jobs whose fire-time was supposed to occur >THRESHOLD_MS ago and are still
// pending — i.e. workers are not draining the delayed queue in time.
//
// 60_000 ms (60s) is the default starting point because the 2026-05-21
// incident left a post in bull:post:delayed for 132 minutes; a 60-second
// threshold would have surfaced that failure within ~1 minute of fire-time
// lag. Operators can tune this without a deploy via HEALTH_DELAYED_STALENESS_MS
// (lower = more sensitive, higher = more tolerant of brief worker pauses).
const DELAYED_STALENESS_THRESHOLD_MS = parsePositiveIntEnv(
  'HEALTH_DELAYED_STALENESS_MS',
  process.env.HEALTH_DELAYED_STALENESS_MS,
  60_000
);

// Cache TTL for /health/deep response. The deep probe performs up to ~9 Redis
// round-trips per call; under aggressive monitoring + multi-replica backend
// this can amplify into significant Redis CPU. Cache the last result for
// HEALTH_DEEP_CACHE_TTL_MS (default 5_000ms = 5s, well inside the 60s
// staleness SLO) and serve from cache for repeat callers within the window.
const HEALTH_DEEP_CACHE_TTL_MS = parsePositiveIntEnv(
  'HEALTH_DEEP_CACHE_TTL_MS',
  process.env.HEALTH_DEEP_CACHE_TTL_MS,
  5_000
);

type ProbeStatus = 'ok' | 'fail';

interface BullMqProbeBody {
  status: ProbeStatus;
  workers: Record<KnownQueuePattern, number>;
  delayedStale: { queue: string; count: number; thresholdMs: number };
  error?: string;
}

// Public response body for /health/deep. Intentionally narrow: top-level
// ProbeStatus per subsystem + a sanitized errors[] array. Internal probe
// detail (per-queue worker counts, delayed-job counts) is NOT serialized to
// the public response — it's emitted to operator logs only via Logger.warn.
// See B-1 in the 2026-05-21 security review.
interface DeepHealthBody {
  redis: ProbeStatus;
  postgres: ProbeStatus;
  bullmq: ProbeStatus;
  errors?: string[];
}

function withTimeout<T>(
  probeName: string,
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${probeName} probe timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// Strip operationally-sensitive substrings from error messages before they
// reach the public response body. Order matters — most-specific patterns
// first so credential-bearing URLs are redacted whole before the bare-host
// pass catches their hosts.
//
// Real failure shapes seen on Railway:
//   - "getaddrinfo ENOTFOUND redis.railway.internal"
//   - "Can't reach database server at `postgres.internal`:5432"
//   - "connect ETIMEDOUT 10.0.0.1:6379"
//   - "connect ETIMEDOUT — host railway.internal:6379"
//
// Anything matching a credential URL, internal-domain host, IP:port, or
// host.tld:port substring is replaced with a sanitized placeholder.
export function sanitizeErrorMessage(message: string): string {
  let s = message;
  // (1) Scheme://user:pass@host[:port][/path] — full credential-bearing URL.
  s = s.replace(
    /[a-z][a-z0-9+.-]*:\/\/[^\s'"`]*?@[^\s'"`/?#]+(?::\d+)?(?:\/[^\s'"`]*)?/gi,
    '<redacted-url>'
  );
  // (2) Scheme://host[:port][/path] — bare URL without credentials.
  s = s.replace(
    /[a-z][a-z0-9+.-]*:\/\/[^\s'"`/?#]+(?::\d+)?(?:\/[^\s'"`]*)?/gi,
    '<redacted-url>'
  );
  // (3) Private/internal DNS suffix + optional port:
  //     foo.railway.internal[:5432], svc.internal, host.local, x.lan
  s = s.replace(
    /\b[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.(?:railway\.internal|internal|local|lan)(?::\d+)?\b/g,
    '<redacted-host>'
  );
  // (4) IPv4 with optional port — covers "10.0.0.1:6379" and bare "10.0.0.1".
  s = s.replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '<redacted-ip>');
  // (5) Catch-all: any remaining host.tld:port shape with at least one dot.
  s = s.replace(
    /\b[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+:\d+\b/g,
    '<redacted-host>'
  );
  return s;
}

function describeError(err: unknown): string {
  let raw: string;
  if (err instanceof Error) {
    raw = err.message;
  } else if (typeof err === 'string') {
    raw = err;
  } else {
    raw = 'unknown error';
  }
  return sanitizeErrorMessage(raw);
}

@ApiTags('Health')
@Controller('/health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  // In-memory response cache for /health/deep. Stores both 200 and 503
  // payloads so the cache layer matches the actual probe outcome — caching
  // only the 200 path would defeat the purpose during a degraded window.
  // No thundering-herd guard (first N concurrent callers may race before the
  // first response fills the cache); acceptable for v1 since the goal is
  // reducing steady-state amplification, not single-spike protection.
  private _cachedBody: DeepHealthBody | null = null;
  private _cachedStatus = HttpStatus.OK;
  private _cachedAt = 0;

  constructor(
    private readonly _prismaService: PrismaService,
    private readonly _bullMqClient: BullMqClient
  ) {}

  /**
   * Deep healthcheck — probes Redis, Postgres, and BullMQ liveness.
   *
   * BullMQ probe (post 2026-05-21 incident hardening):
   *   (a) Worker-liveness: for each KNOWN_QUEUE_PATTERN, call
   *       queue.getWorkers() and require count > 0. Any queue with zero
   *       connected workers fails the probe. Per-queue probe rejections
   *       (transient ioredis errors) do NOT short-circuit the fanout —
   *       failed queues are recorded but the remaining queues still probe.
   *   (b) Delayed-job staleness: for the `post` queue specifically,
   *       ZCOUNT bull:post:delayed -inf (now - DELAYED_STALENESS_THRESHOLD_MS).
   *       If count > 0, the scheduler is silently stuck — jobs whose
   *       fire-time is in the past are not being drained.
   *
   * Returns 200 only if redis, postgres, AND both bullmq sub-checks pass.
   * Returns 503 with per-subsystem status + sanitized error strings.
   * Internal probe detail (per-queue worker counts, delayed-job count) is
   * logged server-side via Logger.warn but never serialized to the public
   * response — see B-1 hardening from the 2026-05-21 security review.
   *
   * Repeat callers within HEALTH_DEEP_CACHE_TTL_MS see the cached response
   * (both 200 and 503 paths cached) to bound Redis round-trip amplification.
   */
  @Get('/deep')
  async deep(): Promise<DeepHealthBody> {
    const now = Date.now();
    if (
      this._cachedBody !== null &&
      now - this._cachedAt < HEALTH_DEEP_CACHE_TTL_MS
    ) {
      if (this._cachedStatus === HttpStatus.OK) {
        return this._cachedBody;
      }
      throw new HttpException(this._cachedBody, this._cachedStatus);
    }

    const [redisResult, postgresResult, bullmqResult] = await Promise.all([
      this.probeRedis(),
      this.probePostgres(),
      this.probeBullMq(),
    ]);

    const errors: string[] = [];
    if (redisResult.status === 'fail') {
      errors.push(`redis: ${redisResult.error}`);
    }
    if (postgresResult.status === 'fail') {
      errors.push(`postgres: ${postgresResult.error}`);
    }
    if (bullmqResult.status === 'fail') {
      errors.push(`bullmq: ${bullmqResult.error}`);
      // Log the full internal probe detail server-side so operators retain
      // visibility through Railway/Sentry logs even though the public
      // response body no longer carries it.
      this.logger.warn(
        `bullmq probe failed: error="${bullmqResult.error}" workers=${JSON.stringify(
          bullmqResult.workers
        )} delayedStale=${JSON.stringify(bullmqResult.delayedStale)}`
      );
    }

    // Build the public-shape body. By construction this object's TS type is
    // DeepHealthBody, which has NO bullmqDetail field — the cache below
    // therefore cannot accidentally store internal probe state. (B-1↔M-6
    // interaction safety property.)
    const body: DeepHealthBody = {
      redis: redisResult.status,
      postgres: postgresResult.status,
      bullmq: bullmqResult.status,
    };

    if (errors.length > 0) {
      const failingBody: DeepHealthBody = { ...body, errors };
      this._cachedBody = failingBody;
      this._cachedStatus = HttpStatus.SERVICE_UNAVAILABLE;
      this._cachedAt = Date.now();
      throw new HttpException(failingBody, HttpStatus.SERVICE_UNAVAILABLE);
    }

    this._cachedBody = body;
    this._cachedStatus = HttpStatus.OK;
    this._cachedAt = Date.now();
    return body;
  }

  private async probeRedis(): Promise<{ status: ProbeStatus; error?: string }> {
    try {
      await withTimeout('redis', Promise.resolve(ioRedis.ping()), PROBE_TIMEOUT_MS);
      return { status: 'ok' };
    } catch (err) {
      return { status: 'fail', error: describeError(err) };
    }
  }

  private async probePostgres(): Promise<{
    status: ProbeStatus;
    error?: string;
  }> {
    try {
      await withTimeout(
        'postgres',
        this._prismaService.$queryRaw`SELECT 1`,
        PROBE_TIMEOUT_MS
      );
      return { status: 'ok' };
    } catch (err) {
      return { status: 'fail', error: describeError(err) };
    }
  }

  private async probeBullMq(): Promise<BullMqProbeBody> {
    // Initialize per-queue worker counts to -1 (sentinel: "not probed").
    // Per-queue rejection in the fanout below leaves the entry at -1; the
    // aggregation step then treats -1 as a probe failure rather than as a
    // zero-worker failure so the response error string is accurate.
    const workers: Record<KnownQueuePattern, number> = Object.fromEntries(
      KNOWN_QUEUE_PATTERNS.map((q) => [q, -1])
    ) as Record<KnownQueuePattern, number>;
    const delayedStale = {
      queue: POST_QUEUE_PATTERN,
      count: -1,
      thresholdMs: DELAYED_STALENESS_THRESHOLD_MS,
    };
    const probeFailures: string[] = [];

    try {
      if (!this._bullMqClient) {
        return {
          status: 'fail',
          workers,
          delayedStale,
          error: 'bullmq client unavailable',
        };
      }

      const probe = async () => {
        // (a) Worker-liveness per queue. Use Promise.allSettled so a single
        // queue's getWorkers() rejection does NOT collapse the entire fanout
        // — the other queues still record their counts.
        const settled = await Promise.allSettled(
          KNOWN_QUEUE_PATTERNS.map(async (pattern) => {
            const queue = this._bullMqClient.getQueue(pattern);
            const queueWorkers = await queue.getWorkers();
            return {
              pattern,
              count: queueWorkers?.length ?? 0,
            };
          })
        );
        settled.forEach((r, i) => {
          const pattern = KNOWN_QUEUE_PATTERNS[i];
          if (r.status === 'fulfilled') {
            workers[pattern] = r.value.count;
          } else {
            // Leave workers[pattern] at -1 (the "not probed" sentinel).
            const errMsg = describeError(r.reason);
            probeFailures.push(`${pattern}: ${errMsg}`);
            this.logger.warn(
              `bullmq queue probe rejected: pattern="${pattern}" error="${errMsg}"`
            );
          }
        });

        // (b) Delayed-job staleness on the post queue.
        // BullMQ key: `bull:<queue>:delayed`, scored by fire-time-ms.
        const cutoff = Date.now() - DELAYED_STALENESS_THRESHOLD_MS;
        const staleKey = `bull:${POST_QUEUE_PATTERN}:delayed`;
        delayedStale.count = await ioRedis.zcount(staleKey, '-inf', cutoff);
      };

      await withTimeout('bullmq', probe(), PROBE_TIMEOUT_MS);

      if (probeFailures.length > 0) {
        return {
          status: 'fail',
          workers,
          delayedStale,
          error: `bullmq queue probe(s) failed: ${probeFailures.join('; ')}`,
        };
      }

      const zeroWorkerQueues = KNOWN_QUEUE_PATTERNS.filter(
        (q) => workers[q] === 0
      );
      if (zeroWorkerQueues.length > 0) {
        return {
          status: 'fail',
          workers,
          delayedStale,
          error: `queues with zero workers: ${zeroWorkerQueues.join(', ')}`,
        };
      }

      if (delayedStale.count > 0) {
        return {
          status: 'fail',
          workers,
          delayedStale,
          error: `${delayedStale.count} delayed job(s) on ${POST_QUEUE_PATTERN} aged >${DELAYED_STALENESS_THRESHOLD_MS}ms past fire-time`,
        };
      }

      return { status: 'ok', workers, delayedStale };
    } catch (err) {
      return {
        status: 'fail',
        workers,
        delayedStale,
        error: describeError(err),
      };
    }
  }
}
