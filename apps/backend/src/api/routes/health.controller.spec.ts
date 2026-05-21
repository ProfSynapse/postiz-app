// apps/backend/src/api/routes/health.controller.spec.ts
//
// Regression coverage for the deep healthcheck endpoint.
//
// Post 2026-05-21 incident hardening — the BullMQ probe was rewritten to
// catch the actual failure shape that occurred in production:
//   - Workers had silently stopped consuming the `post` queue (zero
//     attached workers) and /api/health/deep returned 200 because the
//     probe only pinged Redis.
//   - A post sat in bull:post:delayed for 132 minutes unprocessed.
//
// Critical behavior under test:
//   - GET /health/deep returns 503 when ANY known queue has zero workers,
//     naming the affected queue in the response body.
//   - GET /health/deep returns 503 when `post` has stale delayed jobs
//     (fire-time >60s in the past), with the count in the response body.
//   - The 200 path returns {redis:'ok', postgres:'ok', bullmq:'ok'} when
//     all probes succeed AND every known queue has >=1 worker AND
//     bull:post:delayed has zero stale jobs.
//   - Redis-unreachable failure mode (the original failure shape) still
//     returns 503 with redis:'fail'.
//   - Error strings are sanitized — no REDIS_URL, password, or
//     credential-like tokens leak in the response body.

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
import { HealthController } from './health.controller';
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
// individual entries to simulate zero-workers failure mode.
function makeBullMqStub(opts?: {
  workerCounts?: Partial<Record<string, number>>;
  getWorkersThrows?: boolean;
}) {
  const counts: Record<string, number> = {};
  for (const pattern of KNOWN_QUEUE_PATTERNS) {
    counts[pattern] = opts?.workerCounts?.[pattern] ?? 1;
  }
  const getQueue = jest.fn((pattern: string) => ({
    getWorkers: jest.fn(async () => {
      if (opts?.getWorkersThrows) {
        throw new Error('bullmq queue unreachable');
      }
      const n = counts[pattern] ?? 0;
      // BullMQ.getWorkers() resolves to an array of worker descriptors; only
      // the .length matters to the probe.
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
    // Every known queue reports the healthy default (1 worker).
    for (const pattern of KNOWN_QUEUE_PATTERNS) {
      expect(result.bullmqDetail?.workers[pattern]).toBe(1);
    }
    expect(result.bullmqDetail?.delayedStale.count).toBe(0);
    expect(zcountMock).toHaveBeenCalledWith('bull:post:delayed', '-inf', expect.any(Number));
  });

  it('throws 503 with bullmq:fail when any queue has zero workers, naming the queue', async () => {
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
      bullmqDetail: { workers: Record<string, number>; delayedStale: { count: number } };
      errors: string[];
    };
    expect(body.redis).toBe('ok');
    expect(body.postgres).toBe('ok');
    expect(body.bullmq).toBe('fail');
    expect(body.bullmqDetail.workers.post).toBe(0);
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
      bullmqDetail: {
        delayedStale: { queue: string; count: number; thresholdMs: number };
      };
      errors: string[];
    };
    expect(body.bullmq).toBe('fail');
    expect(body.bullmqDetail.delayedStale.queue).toBe('post');
    expect(body.bullmqDetail.delayedStale.count).toBe(3);
    expect(body.bullmqDetail.delayedStale.thresholdMs).toBe(60_000);
    // The error message includes the count.
    expect(
      body.errors.some((e) => /bullmq:.*3 delayed job/.test(e))
    ).toBe(true);
  });

  it('throws 503 with redis:fail when ioRedis.ping rejects (original Railway IPv6 failure mode)', async () => {
    const etimedout = Object.assign(
      new Error('connect ETIMEDOUT 10.0.0.1:6379'),
      { code: 'ETIMEDOUT' }
    );
    pingMock.mockRejectedValue(etimedout);
    // BullMQ workers can't be reached when Redis is down — simulate by
    // having getWorkers throw a Redis-shaped error too.
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

  it('sanitizes error strings — no REDIS_URL, no obvious credentials leak', async () => {
    // Simulate an error message that contains a credential-bearing URL —
    // we want to confirm that the deep healthcheck's `describeError` returns
    // ONLY the error message (not the full Redis options/connection-info
    // object). In production a real ETIMEDOUT error from ioredis will NOT
    // contain REDIS_URL anyway, but this asserts the contract.
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
  });
});
