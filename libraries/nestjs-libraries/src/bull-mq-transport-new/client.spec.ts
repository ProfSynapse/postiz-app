// libraries/nestjs-libraries/src/bull-mq-transport-new/client.spec.ts
//
// Regression coverage for the BullMqClient connection-leak fix
// (Phase 2 BullMQ hardening, 2026-05-21).
//
// What is being guarded:
//   1. getQueue(pattern) returns the SAME Queue instance on repeated calls
//      for the same pattern (cache hit).
//   2. getQueueEvents(pattern) returns the SAME QueueEvents instance on
//      repeated calls for the same pattern (cache hit).
//   3. Distinct patterns produce distinct cached instances.
//   4. The cache Map is actually populated (size grows by 1 per new pattern).
//
// Previously the implementation read `this.queues.get(p) || new Queue(...)`
// which short-circuited to a fresh Queue on every miss but never .set() back
// into the Map — every emit/dispatchEvent/delete spawned a new BullMQ Queue
// and a new ioredis connection. Each test below would FAIL against the
// pre-fix implementation: cache identity would not hold, and Map size would
// stay at 0.

import { Queue, QueueEvents } from 'bullmq';

// Mock the bullmq Queue and QueueEvents constructors so the spec does not
// actually open ioredis connections. Each call returns a fresh sentinel
// object so identity assertions are meaningful.
jest.mock('bullmq', () => {
  let queueId = 0;
  let queueEventsId = 0;
  return {
    Queue: jest.fn().mockImplementation((pattern: string) => ({
      __tag: 'Queue',
      __id: ++queueId,
      pattern,
    })),
    QueueEvents: jest.fn().mockImplementation((pattern: string) => ({
      __tag: 'QueueEvents',
      __id: ++queueEventsId,
      pattern,
    })),
  };
});

// ioRedis is imported eagerly by client.ts; stub it so the import chain
// does not try to construct a real Redis instance.
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { __tag: 'mock-ioredis' },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { BullMqClient } = require('./client');

describe('BullMqClient queue/queueEvents caching (leak fix)', () => {
  beforeEach(() => {
    (Queue as unknown as jest.Mock).mockClear();
    (QueueEvents as unknown as jest.Mock).mockClear();
  });

  it('getQueue caches per pattern: second call returns the same Queue instance', () => {
    const client = new BullMqClient();

    const a1 = client.getQueue('post');
    const a2 = client.getQueue('post');

    expect(a1).toBe(a2);
    expect((Queue as unknown as jest.Mock).mock.calls.length).toBe(1);
    expect(client.queues.size).toBe(1);
    expect(client.queues.get('post')).toBe(a1);
  });

  it('getQueueEvents caches per pattern: second call returns the same QueueEvents instance', () => {
    const client = new BullMqClient();

    const a1 = client.getQueueEvents('post');
    const a2 = client.getQueueEvents('post');

    expect(a1).toBe(a2);
    expect((QueueEvents as unknown as jest.Mock).mock.calls.length).toBe(1);
    expect(client.queueEvents.size).toBe(1);
    expect(client.queueEvents.get('post')).toBe(a1);
  });

  it('getQueue distinguishes patterns: different patterns produce different cached instances', () => {
    const client = new BullMqClient();

    const post = client.getQueue('post');
    const plug = client.getQueue('plug');

    expect(post).not.toBe(plug);
    expect((Queue as unknown as jest.Mock).mock.calls.length).toBe(2);
    expect(client.queues.size).toBe(2);
    expect(client.queues.get('post')).toBe(post);
    expect(client.queues.get('plug')).toBe(plug);
  });

  it('getQueueEvents distinguishes patterns: different patterns produce different cached instances', () => {
    const client = new BullMqClient();

    const post = client.getQueueEvents('post');
    const plug = client.getQueueEvents('plug');

    expect(post).not.toBe(plug);
    expect((QueueEvents as unknown as jest.Mock).mock.calls.length).toBe(2);
    expect(client.queueEvents.size).toBe(2);
  });

  it('many calls for the same pattern still only construct one Queue + one QueueEvents', () => {
    // The leak shape: every call to getQueue/getQueueEvents pre-fix would have
    // produced N constructor calls for N invocations. After the fix, repeated
    // calls must be a no-op past the first.
    const client = new BullMqClient();

    for (let i = 0; i < 25; i++) {
      client.getQueue('post');
      client.getQueueEvents('post');
    }

    expect((Queue as unknown as jest.Mock).mock.calls.length).toBe(1);
    expect((QueueEvents as unknown as jest.Mock).mock.calls.length).toBe(1);
    expect(client.queues.size).toBe(1);
    expect(client.queueEvents.size).toBe(1);
  });
});
