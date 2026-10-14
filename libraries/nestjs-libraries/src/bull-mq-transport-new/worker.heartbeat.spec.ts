const mockRedis = { set: jest.fn(), exists: jest.fn() };
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: mockRedis,
}));

import { EventEmitter } from 'events';
import {
  isWorkerAlive,
  startWorkerHeartbeat,
  workerHeartbeatKey,
} from './worker.heartbeat';

function fakeWorker(name: string, running = true) {
  const emitter = new EventEmitter() as EventEmitter & {
    name: string;
    isRunning: () => boolean;
  };
  emitter.name = name;
  emitter.isRunning = () => running;
  return emitter;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('worker heartbeat', () => {
  let interval: NodeJS.Timeout | undefined;

  beforeEach(() => {
    mockRedis.set.mockReset().mockResolvedValue('OK');
    mockRedis.exists.mockReset();
  });

  afterEach(() => {
    if (interval) clearInterval(interval);
    interval = undefined;
  });

  it('beats only once every worker has reported ready', async () => {
    const post = fakeWorker('post');
    const submit = fakeWorker('submit');
    interval = startWorkerHeartbeat([post, submit] as any);

    post.emit('ready');
    await flush();
    expect(mockRedis.set).not.toHaveBeenCalled();

    submit.emit('ready');
    await flush();
    expect(mockRedis.set).toHaveBeenCalledWith(
      workerHeartbeatKey(),
      expect.any(Number),
      'PX',
      60_000
    );
  });

  it('does not beat while a worker is stopped', async () => {
    const post = fakeWorker('post', false);
    interval = startWorkerHeartbeat([post] as any);

    post.emit('ready');
    await flush();

    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('keys the heartbeat by container hostname', () => {
    expect(workerHeartbeatKey('abc123')).toBe('postiz:heartbeat:workers:abc123');
  });

  it('reports alive, missing and unreadable heartbeats distinctly', async () => {
    mockRedis.exists.mockResolvedValueOnce(1);
    await expect(isWorkerAlive()).resolves.toBe(true);

    mockRedis.exists.mockResolvedValueOnce(0);
    await expect(isWorkerAlive()).resolves.toBe(false);

    mockRedis.exists.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    await expect(isWorkerAlive()).resolves.toBeNull();
  });
});
