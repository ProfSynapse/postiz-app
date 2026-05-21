// apps/backend/src/api/routes/health.controller.spec.ts
//
// Regression coverage for the deep healthcheck endpoint.
//
// Post 2026-05-21 incident hardening — the BullMQ probe was rewritten to
// catch the actual failure shape that occurred in production:
//   - Workers had silently stopped consuming the `post` queue (zero
//     attached workers) and /health/deep returned 200 because the probe
//     only pinged Redis.
//   - A post sat in bull:post:delayed for 132 minutes unprocessed.
//
// Post-remediation (PR #7 follow-up):
//   - B-1: bullmqDetail was stripped from the PUBLIC response body. The
//     controller still computes per-queue worker counts and delayed-job
//     counts internally to drive error strings + server-side Logger.warn,
//     but they are NOT serialized to the public response.
//   - M-1: per-queue getWorkers() rejections do not short-circuit the fanout.
//   - M-5: error strings are sanitized of internal hostnames / IPs / URLs.
//   - M-6: /health/deep responses are cached for HEALTH_DEEP_CACHE_TTL_MS.
//
// Critical behavior under test:
//   - GET /health/deep returns {redis:'ok', postgres:'ok', bullmq:'ok'} only
//     when ALL probes succeed AND every known queue has >=1 worker AND
//     bull:post:delayed has zero stale jobs.
//   - GET /health/deep throws 503 when ANY queue has zero workers, naming
//     the affected queue in the errors[] string. bullmqDetail is NOT in body.
//   - GET /health/deep throws 503 when bull:post:delayed has stale jobs.
//   - Redis-unreachable failure mode still returns 503 with redis:'fail'.
//   - One queue's getWorkers() rejection does not collapse the probe.
//   - Error strings are sanitized — internal hostnames, IPs, and URLs are
//     redacted.
//   - Repeat callers within the cache TTL get the prior result without
//     re-probing.

// IMPORTANT: jest.mock('@gitroom/nestjs-libraries/redis/redis.service') MUST
// be at the very top, before any import that pulls the health controller in.
// We control `ioRedis.ping` and `ioRedis.zcount` per-test via exported jest.fn.
const pingMock = jest.fn();
const zcountMock = jest.fn();
jest.mock(
  '@gitroom/nestjs-libraries/redis/redis.service',
  () => ({
    ioRedis: {
      ping: pingMock,
      zcount: zcountMock,
    },
  }),
  { virtual: false }
);

import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import {
  HealthController,
  sanitizeErrorMessage,
} from './health.controller';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { BullMqClient } from '@gitroom/nestjs-libraries/bull-mq-transport-new/client';
import { KNOWN_QUEUE_PATTERNS } from '@gitroom/nestjs-libraries/bull-mq-transport-new/queues.constants';

// Minimal Prisma stub. The controller calls `prisma.$queryRaw\`SELECT 1\``
// which is a tagged-template invocation; the stub returns a resolved promise.
class PrismaServiceStub {
  shouldFail = false;
  $queryRaw(_strings: TemplateStringsArray): Promise<unknown> {
    if (this.shouldFail) {
      return Promise.reject(new Error('postgres unreachable'));
    }
    return Promise.resolve([{ '?column?': 1 }]);
  }
}

// Per-queue worker fixtures, indexed by queue pattern. Default: every known
// queue has one attached worker (the healthy default). Tests override
// individual entries to simulate zero-workers / per-queue-reject failure modes.
function makeBullMqStub(opts?: {
  workerCounts?: Partial<Record<string, number>>;
  getWorkersThrows?: boolean;
  rejectQueues?: string[];
}) {
  const counts: Record<string, number> = {};
  for (const pattern of KNOWN_QUEUE_PATTERNS) {
    counts[pattern] = opts?.workerCounts?.[pattern] ?? 1;
  }
  const rejectSet = new Set(opts?.rejectQueues ?? []);
  const getQueue = jest.fn((pattern: string) => ({
    getWorkers: jest.fn(async () => {
      if (opts?.getWorkersThrows) {
        throw new Error('bullmq queue unreachable');
      }
      if (rejectSet.has(pattern)) {
        throw new Error(`forced reject for ${pattern}`);
      }
      const n = counts[pattern] ?? 0;
      return Array.from({ length: n }, (_, i) => ({ name: `worker-${i}` }));
    }),
  }));
  return { getQueue } as unknown as BullMqClient;
}

describe('HealthController /health/deep', () => {
  let controller: HealthController;
  let prismaStub: PrismaServiceStub;

  async function buildController(bullMqStub: BullMqClient) {
    prismaStub = new PrismaServiceStub();
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: prismaStub },
        { provide: BullMqClient, useValue: bullMqStub },
      ],
    }).compile();
    controller = moduleRef.get<HealthController>(HealthController);
  }

  beforeEach(() => {
    pingMock.mockReset();
    zcountMock.mockReset();
  });

  it('returns 200 {redis:ok, postgres:ok, bullmq:ok} when all probes succeed and every queue has >=1 worker', async () => {
    pingMock.mockResolvedValue('PONG');
    zcountMock.mockResolvedValue(0);
    await buildController(makeBullMqStub());

    const result = await controller.deep();

    expect(result.redis).toBe('ok');
    expect(result.postgres).toBe('ok');
    expect(result.bullmq).toBe('ok');
    // B-1: bullmqDetail must NOT be in the public response body.
    expect((result as Record<string, unknown>).bullmqDetail).toBeUndefined();
    expect(zcountMock).toHaveBeenCalledWith(
      'bull:post:delayed',
      '-inf',
      expect.any(Number)
    );
  });

  it('throws 503 with bullmq:fail when any queue has zero workers, naming the queue in errors[]', async () => {
    pingMock.mockResolvedValue('PONG');
    zcountMock.mockResolvedValue(0);
    // `post` queue has zero workers — the dominant 2026-05-21 failure shape.
    await buildController(makeBullMqStub({ workerCounts: { post: 0 } }));

    let caught: HttpException | undefined;
    try {
      await controller.deep();
    } catch (err) {
      caught = err as HttpException;
    }

    expect(caught).toBeInstanceOf(HttpException);
    expect(caught?.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);

    const body = caught?.getResponse() as {
      redis: string;
      postgres: string;
      bullmq: string;
      errors: string[];
      bullmqDetail?: unknown;
    };
    expect(body.redis).toBe('ok');
    expect(body.postgres).toBe('ok');
    expect(body.bullmq).toBe('fail');
    // B-1: bullmqDetail must NOT be in the public 503 body.
    expect(body.bullmqDetail).toBeUndefined();
    // The error message names the specific queue, not just "bullmq failed".
    expect(body.errors.some((e) => /bullmq:.*zero workers.*post/.test(e))).toBe(
      true
    );
  });

  it('throws 503 with bullmq:fail when bull:post:delayed has stale jobs (count > 0)', async () => {
    pingMock.mockResolvedValue('PONG');
    // 3 jobs whose fire-time is more than 60s in the past — workers are not
    // draining the delayed queue (the 132-minute-stale failure shape).
    zcountMock.mockResolvedValue(3);
    await buildController(makeBullMqStub());

    let caught: HttpException | undefined;
    try {
      await controller.deep();
    } catch (err) {
      caught = err as HttpException;
    }

    expect(caught).toBeInstanceOf(HttpException);
    expect(caught?.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);

    const body = caught?.getResponse() as {
      bullmq: string;
      errors: string[];
      bullmqDetail?: unknown;
    };
    expect(body.bullmq).toBe('fail');
    expect(body.bullmqDetail).toBeUndefined();
    // The error message includes the count.
    expect(body.errors.some((e) => /bullmq:.*3 delayed job/.test(e))).toBe(true);
  });

  it('throws 503 with redis:fail when ioRedis.ping rejects (original Railway IPv6 failure mode)', async () => {
    const etimedout = Object.assign(
      new Error('connect ETIMEDOUT 10.0.0.1:6379'),
      { code: 'ETIMEDOUT' }
    );
    pingMock.mockRejectedValue(etimedout);
    zcountMock.mockRejectedValue(etimedout);
    await buildController(makeBullMqStub({ getWorkersThrows: true }));

    let caught: HttpException | undefined;
    try {
      await controller.deep();
    } catch (err) {
      caught = err as HttpException;
    }

    expect(caught).toBeInstanceOf(HttpException);
    expect(caught?.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);

    const body = caught?.getResponse() as {
      redis: string;
      postgres: string;
      bullmq: string;
      errors: string[];
    };
    expect(body.redis).toBe('fail');
    expect(body.postgres).toBe('ok');
    expect(body.bullmq).toBe('fail');
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.some((e) => e.startsWith('redis:'))).toBe(true);
    expect(body.errors.some((e) => e.startsWith('bullmq:'))).toBe(true);
    expect(body.errors.some((e) => e.startsWith('postgres:'))).toBe(false);
  });

  it('returns 503 with postgres:fail when only Prisma fails', async () => {
    pingMock.mockResolvedValue('PONG');
    zcountMock.mockResolvedValue(0);
    await buildController(makeBullMqStub());
    prismaStub.shouldFail = true;

    let caught: HttpException | undefined;
    try {
      await controller.deep();
    } catch (err) {
      caught = err as HttpException;
    }

    expect(caught).toBeInstanceOf(HttpException);
    expect(caught?.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    const body = caught?.getResponse() as {
      redis: string;
      postgres: string;
      bullmq: string;
      errors: string[];
    };
    expect(body).toMatchObject({ redis: 'ok', postgres: 'fail', bullmq: 'ok' });
    expect(body.errors.some((e) => e.startsWith('postgres:'))).toBe(true);
  });

  it('sanitizes error strings — no internal hostname or credential URL leaks', async () => {
    // Real-shape error including a railway.internal hostname + port.
    pingMock.mockRejectedValue(
      new Error('connect ETIMEDOUT — host railway.internal:6379')
    );
    zcountMock.mockResolvedValue(0);
    await buildController(makeBullMqStub());

    let caught: HttpException | undefined;
    try {
      await controller.deep();
    } catch (err) {
      caught = err as HttpException;
    }

    const body = caught?.getResponse() as { errors: string[] };
    const joined = body.errors.join(' | ');
    expect(joined).not.toMatch(/REDIS_URL/);
    expect(joined).not.toMatch(/password/i);
    expect(joined).not.toMatch(/redis:\/\/[^@]+:[^@]+@/);
    // M-5: railway.internal must not appear in the public errors[].
    expect(joined).not.toContain('railway.internal');
    expect(joined).toContain('<redacted-host>');
  });

  // M-1: one queue's getWorkers() rejection does not collapse the fanout —
  // the other six queues still record their counts; the response error names
  // ONLY the queue that rejected.
  it('M-1: per-queue getWorkers() rejection does not short-circuit the probe', async () => {
    pingMock.mockResolvedValue('PONG');
    zcountMock.mockResolvedValue(0);
    await buildController(
      makeBullMqStub({
        workerCounts: { post: 0 }, // also include a zero-worker queue
        rejectQueues: ['cron'],
      })
    );

    let caught: HttpException | undefined;
    try {
      await controller.deep();
    } catch (err) {
      caught = err as HttpException;
    }

    expect(caught).toBeInstanceOf(HttpException);
    expect(caught?.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    const body = caught?.getResponse() as { errors: string[] };
    // The cron failure must surface in errors[] (not collapsed into a
    // generic Promise.all-shape failure). The error string contains the
    // queue name "cron" because we now report per-queue rejection.
    expect(body.errors.some((e) => /cron/.test(e))).toBe(true);
  });

  // M-6: cache returns the prior result for repeat callers within TTL —
  // verify the BullMqClient was NOT invoked a second time on the cached call.
  it('M-6: repeat callers within the cache TTL get the cached response without re-probing', async () => {
    pingMock.mockResolvedValue('PONG');
    zcountMock.mockResolvedValue(0);
    const stub = makeBullMqStub();
    await buildController(stub);

    await controller.deep();
    const callsAfterFirst = (stub.getQueue as jest.Mock).mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const second = await controller.deep();
    expect(second.bullmq).toBe('ok');
    // Cache hit: BullMqClient.getQueue was NOT called a second time.
    expect((stub.getQueue as jest.Mock).mock.calls.length).toBe(callsAfterFirst);
    // ioRedis.zcount also wasn't re-invoked.
    expect(zcountMock).toHaveBeenCalledTimes(1);
  });

  it('M-6: cache also covers the 503 path — repeat failure does not re-probe', async () => {
    pingMock.mockResolvedValue('PONG');
    zcountMock.mockResolvedValue(0);
    // Force a 503 via zero-worker on post.
    const stub = makeBullMqStub({ workerCounts: { post: 0 } });
    await buildController(stub);

    await controller.deep().catch(() => undefined);
    const callsAfterFirst = (stub.getQueue as jest.Mock).mock.calls.length;

    let caught: HttpException | undefined;
    try {
      await controller.deep();
    } catch (err) {
      caught = err as HttpException;
    }

    expect(caught).toBeInstanceOf(HttpException);
    expect(caught?.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect((stub.getQueue as jest.Mock).mock.calls.length).toBe(callsAfterFirst);
  });
});

// Unit-level coverage for the sanitizer helper. Exercises every redaction
// branch so a future refactor that breaks one branch surfaces immediately
// rather than waiting for an integration assertion to drop coverage.
describe('sanitizeErrorMessage', () => {
  it('redacts railway.internal hostnames', () => {
    const out = sanitizeErrorMessage(
      'getaddrinfo ENOTFOUND redis.railway.internal'
    );
    expect(out).not.toContain('railway.internal');
    expect(out).toContain('<redacted-host>');
  });

  it('redacts internal hostnames with port', () => {
    const out = sanitizeErrorMessage(
      "Can't reach database server at `postgres.internal`:5432"
    );
    expect(out).not.toContain('postgres.internal');
    expect(out).toContain('<redacted-host>');
  });

  it('redacts IPv4 with port', () => {
    const out = sanitizeErrorMessage('connect ETIMEDOUT 10.0.0.1:6379');
    expect(out).not.toContain('10.0.0.1');
    expect(out).toContain('<redacted-ip>');
  });

  it('redacts credential-bearing URLs whole', () => {
    const out = sanitizeErrorMessage(
      'failed: redis://admin:supersecret@host.local:6379/0'
    );
    expect(out).not.toContain('admin');
    expect(out).not.toContain('supersecret');
    expect(out).not.toContain('host.local');
    expect(out).toContain('<redacted-url>');
  });

  it('passes through messages without sensitive substrings unchanged', () => {
    const out = sanitizeErrorMessage('bullmq client unavailable');
    expect(out).toBe('bullmq client unavailable');
  });
});
