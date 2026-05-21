import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { BullMqClient } from '@gitroom/nestjs-libraries/bull-mq-transport-new/client';
import {
  KNOWN_QUEUE_PATTERNS,
  POST_QUEUE_PATTERN,
  KnownQueuePattern,
} from '@gitroom/nestjs-libraries/bull-mq-transport-new/queues.constants';

const PROBE_TIMEOUT_MS = 3000;

// Delayed-job staleness threshold for the post queue.
//
// BullMQ stores delayed jobs in a sorted set (key `bull:<queue>:delayed`)
// scored by fire-time in ms-epoch. ZCOUNT key -inf (now-THRESHOLD_MS) counts
// jobs whose fire-time was supposed to occur >THRESHOLD_MS ago and are still
// pending — i.e. workers are not draining the delayed queue in time.
//
// 60_000 ms (60s) was chosen as the starting point because the 2026-05-21
// incident left a post in bull:post:delayed for 132 minutes; a 60-second
// threshold would have surfaced that failure within ~1 minute of fire-time
// lag, well before the 132-minute mark. A future maintainer can tune this
// (lower = more sensitive, higher = more tolerant of brief worker pauses).
const DELAYED_STALENESS_THRESHOLD_MS = 60_000;

type ProbeStatus = 'ok' | 'fail';

interface BullMqProbeBody {
  status: ProbeStatus;
  workers: Record<KnownQueuePattern, number>;
  delayedStale: { queue: string; count: number; thresholdMs: number };
  error?: string;
}

interface DeepHealthBody {
  redis: ProbeStatus;
  postgres: ProbeStatus;
  bullmq: ProbeStatus;
  bullmqDetail?: BullMqProbeBody;
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

function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return 'unknown error';
}

@ApiTags('Health')
@Controller('/health')
export class HealthController {
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
   *       connected workers fails the probe.
   *   (b) Delayed-job staleness: for the `post` queue specifically,
   *       ZCOUNT bull:post:delayed -inf (now - DELAYED_STALENESS_THRESHOLD_MS).
   *       If count > 0, the scheduler is silently stuck — jobs whose
   *       fire-time is in the past are not being drained.
   *
   * Returns 200 only if redis, postgres, AND both bullmq sub-checks pass.
   * Returns 503 with per-probe status + sanitized error strings + a
   * bullmqDetail object (worker counts + delayed-stale count) otherwise so
   * monitoring tools can route on the specific failure mode.
   */
  @Get('/deep')
  async deep(): Promise<DeepHealthBody> {
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
    }

    const body: DeepHealthBody = {
      redis: redisResult.status,
      postgres: postgresResult.status,
      bullmq: bullmqResult.status,
      bullmqDetail: bullmqResult,
    };

    if (errors.length > 0) {
      throw new HttpException(
        { ...body, errors },
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }

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
    // If withTimeout / aggregation fails, the response still shows which
    // queues were never reached vs. which returned 0 workers.
    const workers: Record<KnownQueuePattern, number> = Object.fromEntries(
      KNOWN_QUEUE_PATTERNS.map((q) => [q, -1])
    ) as Record<KnownQueuePattern, number>;
    const delayedStale = {
      queue: POST_QUEUE_PATTERN,
      count: -1,
      thresholdMs: DELAYED_STALENESS_THRESHOLD_MS,
    };

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
        // (a) Worker-liveness per queue.
        await Promise.all(
          KNOWN_QUEUE_PATTERNS.map(async (pattern) => {
            const queue = this._bullMqClient.getQueue(pattern);
            const queueWorkers = await queue.getWorkers();
            workers[pattern] = queueWorkers?.length ?? 0;
          })
        );

        // (b) Delayed-job staleness on the post queue.
        // BullMQ key: `bull:<queue>:delayed`, scored by fire-time-ms.
        const cutoff = Date.now() - DELAYED_STALENESS_THRESHOLD_MS;
        const staleKey = `bull:${POST_QUEUE_PATTERN}:delayed`;
        delayedStale.count = await ioRedis.zcount(staleKey, '-inf', cutoff);
      };

      await withTimeout('bullmq', probe(), PROBE_TIMEOUT_MS);

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
