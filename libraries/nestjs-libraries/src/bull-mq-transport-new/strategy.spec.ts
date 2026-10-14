const mockProcessors: Record<string, (job: any) => Promise<void>> = {};

jest.mock('bullmq', () => ({
  Queue: jest.fn(() => ({ close: jest.fn() })),
  Worker: jest.fn((name: string, processor: (job: any) => Promise<void>) => {
    mockProcessors[name] = processor;
    return { on: jest.fn(), isRunning: () => true, close: jest.fn() };
  }),
}));

jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));

import { defer, from, throwError } from 'rxjs';
import { BullMqServer } from './strategy';

const tick = () => new Promise((resolve) => setImmediate(resolve));

function startServer(handler: (...args: any[]) => any) {
  const server = new BullMqServer();
  server.addHandler('post', handler as any, true);
  server.listen(() => undefined);
  return server;
}

function makeJob() {
  return { id: 'job-1', data: { payload: { id: 'post-1' } }, discard: jest.fn() };
}

describe('BullMqServer job processing', () => {
  let server: BullMqServer | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
    jest.restoreAllMocks();
  });

  it('keeps the job active until the handler finishes, running it once', async () => {
    let finishPublish!: () => void;
    const publishDone = new Promise<void>((resolve) => (finishPublish = resolve));
    let runs = 0;
    server = startServer(async () =>
      defer(() => {
        runs++;
        return from(publishDone);
      })
    );

    let jobFinished = false;
    const processing = mockProcessors.post(makeJob()).then(() => {
      jobFinished = true;
    });
    await tick();

    expect(runs).toBe(1);
    expect(jobFinished).toBe(false);

    finishPublish();
    await processing;

    expect(jobFinished).toBe(true);
    expect(runs).toBe(1);
  });

  it('discards the job when the handler errors', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    server = startServer(async () => throwError(() => new Error('boom')));
    const job = makeJob();

    await mockProcessors.post(job);

    expect(job.discard).toHaveBeenCalledTimes(1);
  });
});
