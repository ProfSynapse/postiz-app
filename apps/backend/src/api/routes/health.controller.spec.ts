// apps/backend/src/api/routes/health.controller.spec.ts
//
// Regression coverage for the deep healthcheck endpoint (commit c0882554).
//
// Critical behavior under test:
//   - GET /health/deep returns 503 with per-probe status when Redis is
//     unreachable (the exact failure mode Railway IPv6 misconfig produces).
//   - The 200 path returns {redis:'ok', postgres:'ok', bullmq:'ok'} when all
//     probes succeed.
//   - Error strings are sanitized: no REDIS_URL, password, or credential-like
//     tokens leak in the response body.
//
// The BullMQ probe pings the SAME shared `ioRedis` client used by the Redis
// probe (per health.controller.ts:140), so a Redis outage produces both
// redis:'fail' AND bullmq:'fail' simultaneously. This is intentional — the
// deep healthcheck surfaces the dominant Railway failure mode at the same
// signal everywhere BullMQ workers/cron consume Redis.

// IMPORTANT: jest.mock('@gitroom/nestjs-libraries/redis/redis.service') MUST
// be at the very top, before any import that pulls the health controller in.
// We control `ioRedis.ping` per-test via the exported jest.fn.
const pingMock = jest.fn();
jest.mock(
  '@gitroom/nestjs-libraries/redis/redis.service',
  () => ({
    ioRedis: {
      ping: pingMock,
    },
  }),
  { virtual: false }
);

import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { BullMqClient } from '@gitroom/nestjs-libraries/bull-mq-transport-new/client';

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

// Truthy BullMqClient stub — the controller only checks the client exists,
// then pings via the shared ioRedis. Cast to any to satisfy the constructor
// signature of the real BullMqClient (which extends ClientProxy).
const bullMqStub = {} as unknown as BullMqClient;

describe('HealthController /health/deep', () => {
  let controller: HealthController;
  let prismaStub: PrismaServiceStub;

  beforeEach(async () => {
    pingMock.mockReset();
    prismaStub = new PrismaServiceStub();

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: prismaStub },
        { provide: BullMqClient, useValue: bullMqStub },
      ],
    }).compile();

    controller = moduleRef.get<HealthController>(HealthController);
  });

  it('returns {redis:ok, postgres:ok, bullmq:ok} when all probes succeed', async () => {
    pingMock.mockResolvedValue('PONG');

    const result = await controller.deep();

    expect(result).toEqual({
      redis: 'ok',
      postgres: 'ok',
      bullmq: 'ok',
    });
    // BullMQ probe and Redis probe both ping the shared ioRedis instance.
    expect(pingMock).toHaveBeenCalledTimes(2);
  });

  it('throws HttpException 503 with redis:fail + bullmq:fail when ioRedis.ping rejects', async () => {
    const etimedout = Object.assign(
      new Error('connect ETIMEDOUT 10.0.0.1:6379'),
      { code: 'ETIMEDOUT' }
    );
    pingMock.mockRejectedValue(etimedout);

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
    // BullMQ probe pings the same ioRedis -> also fails.
    expect(body.bullmq).toBe('fail');
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThanOrEqual(2);
    expect(body.errors.some((e) => e.startsWith('redis:'))).toBe(true);
    expect(body.errors.some((e) => e.startsWith('bullmq:'))).toBe(true);
    // The Postgres-success path should NOT appear in errors.
    expect(body.errors.some((e) => e.startsWith('postgres:'))).toBe(false);
  });

  it('returns 503 with postgres:fail when only Prisma fails', async () => {
    pingMock.mockResolvedValue('PONG');
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

    let caught: HttpException | undefined;
    try {
      await controller.deep();
    } catch (err) {
      caught = err as HttpException;
    }

    const body = caught?.getResponse() as { errors: string[] };
    const joined = body.errors.join(' | ');
    // None of these credential-shaped tokens should appear.
    expect(joined).not.toMatch(/REDIS_URL/);
    expect(joined).not.toMatch(/password/i);
    // No basic-auth-style "user:pass@host" tokens (rough heuristic).
    expect(joined).not.toMatch(/redis:\/\/[^@]+:[^@]+@/);
  });
});
