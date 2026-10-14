const mockIsWorkerAlive = jest.fn();
jest.mock(
  '@gitroom/nestjs-libraries/bull-mq-transport-new/worker.heartbeat',
  () => ({ isWorkerAlive: () => mockIsWorkerAlive() })
);

import { WorkerSupervisor } from './worker.supervisor';

const MINUTE = 60_000;

function makeSupervisor(minutesSinceBoot: number) {
  const supervisor = new WorkerSupervisor();
  const restart = jest.fn(async () => undefined);
  let now = Date.now() + minutesSinceBoot * MINUTE;
  supervisor.restartWorkers = restart;
  supervisor.underPm2 = true;
  supervisor.now = () => now;
  return {
    supervisor,
    restart,
    advance: (minutes: number) => {
      now += minutes * MINUTE;
    },
  };
}

describe('WorkerSupervisor', () => {
  beforeEach(() => {
    mockIsWorkerAlive.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('restarts workers when the heartbeat is missing after boot grace', async () => {
    mockIsWorkerAlive.mockResolvedValue(false);
    const { supervisor, restart } = makeSupervisor(4);

    await supervisor.handleCron();

    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('leaves healthy workers alone', async () => {
    mockIsWorkerAlive.mockResolvedValue(true);
    const { supervisor, restart } = makeSupervisor(4);

    await supervisor.handleCron();

    expect(restart).not.toHaveBeenCalled();
  });

  it('waits out the boot grace period', async () => {
    mockIsWorkerAlive.mockResolvedValue(false);
    const { supervisor, restart } = makeSupervisor(1);

    await supervisor.handleCron();

    expect(restart).not.toHaveBeenCalled();
    expect(mockIsWorkerAlive).not.toHaveBeenCalled();
  });

  it('does not restart when Redis itself is unreachable', async () => {
    mockIsWorkerAlive.mockResolvedValue(null);
    const { supervisor, restart } = makeSupervisor(4);

    await supervisor.handleCron();

    expect(restart).not.toHaveBeenCalled();
  });

  it('restarts at most once per cooldown', async () => {
    mockIsWorkerAlive.mockResolvedValue(false);
    const { supervisor, restart, advance } = makeSupervisor(4);

    await supervisor.handleCron();
    advance(1);
    await supervisor.handleCron();
    expect(restart).toHaveBeenCalledTimes(1);

    advance(5);
    await supervisor.handleCron();
    expect(restart).toHaveBeenCalledTimes(2);
  });

  it('keeps running when the restart command fails', async () => {
    mockIsWorkerAlive.mockResolvedValue(false);
    const { supervisor, restart } = makeSupervisor(4);
    restart.mockRejectedValueOnce(new Error('pm2 not found'));

    await expect(supervisor.handleCron()).resolves.toBeUndefined();
  });

  it('does nothing outside pm2', async () => {
    mockIsWorkerAlive.mockResolvedValue(false);
    const { supervisor, restart } = makeSupervisor(4);
    supervisor.underPm2 = false;

    await supervisor.handleCron();

    expect(restart).not.toHaveBeenCalled();
  });
});
