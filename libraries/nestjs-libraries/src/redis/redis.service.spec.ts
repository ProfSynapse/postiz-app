// libraries/nestjs-libraries/src/redis/redis.service.spec.ts
//
// Regression coverage for the Railway IPv6 hotfix (commit c0882554).
//
// What is being guarded:
//   1. When process.env.REDIS_URL is set, the shared ioRedis instance MUST be
//      constructed with `family: 0` (dual-stack DNS lookup). Without this,
//      Railway private DNS (*.railway.internal, AAAA-only / IPv6-only) yields
//      ETIMEDOUT and silently stalls BullMQ workers and cron jobs.
//   2. The other production options (`maxRetriesPerRequest: null`,
//      `connectTimeout: 10000`) must survive.
//   3. When REDIS_URL is unset, the MockRedis branch is taken — i.e. the real
//      Redis constructor is NOT called. This is the local-dev / unit-test path.

import type { Redis as RedisType } from 'ioredis';

describe('redis.service ioredis options', () => {
  const ORIGINAL_REDIS_URL = process.env.REDIS_URL;

  afterEach(() => {
    jest.resetModules();
    jest.unmock('ioredis');
    if (ORIGINAL_REDIS_URL === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = ORIGINAL_REDIS_URL;
    }
  });

  it('constructs ioredis with family:0 and the documented Railway-safe options when REDIS_URL is set', () => {
    const RedisCtor = jest.fn();

    jest.isolateModules(() => {
      // Mock the `ioredis` module so we can spy on the named `Redis` import
      // used by redis.service.ts (`import { Redis } from 'ioredis'`).
      jest.doMock('ioredis', () => ({ Redis: RedisCtor }));
      process.env.REDIS_URL = 'redis://test-host:6379';

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./redis.service');
      // Force the lazy export to be evaluated.
      expect(mod.ioRedis).toBeDefined();
    });

    expect(RedisCtor).toHaveBeenCalledTimes(1);
    const [urlArg, optsArg] = RedisCtor.mock.calls[0];

    expect(urlArg).toBe('redis://test-host:6379');
    expect(optsArg).toMatchObject({
      family: 0,
      maxRetriesPerRequest: null,
      connectTimeout: 10000,
    });
    // Explicit assertion on family — this is the load-bearing field for the
    // Railway IPv6 fix. Fails LOUDLY if a future refactor removes it.
    expect(optsArg.family).toBe(0);
  });

  it('does NOT call the real Redis constructor when REDIS_URL is unset (MockRedis branch)', () => {
    const RedisCtor = jest.fn();
    let exportedRedis: RedisType | undefined;

    jest.isolateModules(() => {
      jest.doMock('ioredis', () => ({ Redis: RedisCtor }));
      delete process.env.REDIS_URL;

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./redis.service');
      exportedRedis = mod.ioRedis;
    });

    expect(RedisCtor).not.toHaveBeenCalled();
    // The exported value should still be defined (the MockRedis instance).
    // It exposes `get`/`set` but not the real ioredis API.
    expect(exportedRedis).toBeDefined();
    expect(typeof (exportedRedis as unknown as { get: unknown }).get).toBe(
      'function'
    );
  });
});
