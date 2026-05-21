// apps/cron/src/tasks/media.janitor.spec.ts
//
// Boot-guard + env-gate coverage for the @Cron entry-point (architect §7,
// plan §Env-var surface, invariant #6).
//
// Validates:
//   - MEDIA_JANITOR_ENABLED kill-switch (default off → no service calls)
//   - STORAGE_PROVIDER !== 'local' → inert (invariant #6)
//   - UPLOAD_DIRECTORY missing / non-absolute → inert
//   - FRONTEND_URL missing → inert
//   - Forbidden roots (/, /tmp, /etc, ...) → inert (SR-5)
//   - DryRun default true (`MEDIA_JANITOR_DRY_RUN !== 'false'`)
//   - runId minted via ClockService (no `new Date()` reached here per ESLint)
//   - Both phases invoked when guards pass; per-phase errors logged not rethrown
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { MediaJanitor } from './media.janitor';

class FakeClock {
  // Frozen ms timestamp; tests can mutate to advance time.
  ms = Date.UTC(2026, 4, 21, 3, 0, 0);
  now(): Date {
    return new Date(this.ms);
  }
  nowMs(): number {
    return this.ms;
  }
}

function buildTask(overrides: { service?: any; clock?: any } = {}) {
  const service = overrides.service ?? {
    runSoftDeletePhase: jest.fn(async () => ({
      scanned: 0,
      eligible: 0,
      transitioned: 0,
      errors: 0,
      bytesReclaimedEstimate: 0,
    })),
    runHardDeletePhase: jest.fn(async () => ({
      scanned: 0,
      candidates: 0,
      hardDeleted: 0,
      resurrected: 0,
      pathRejected: 0,
      unlinkErrors: 0,
      bytesReclaimed: 0,
    })),
  };
  const clock = overrides.clock ?? new FakeClock();
  const task = new MediaJanitor(service, clock as any);
  return { task, service, clock };
}

function saveEnv(...keys: string[]): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of keys) snap[k] = process.env[k];
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(snap)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe('MediaJanitor.handleCron — boot guards + env-gating', () => {
  const ENV_KEYS = [
    'MEDIA_JANITOR_ENABLED',
    'MEDIA_JANITOR_DRY_RUN',
    'MEDIA_JANITOR_AGE_DAYS',
    'MEDIA_JANITOR_GRACE_DAYS',
    'MEDIA_JANITOR_BATCH_SIZE',
    'STORAGE_PROVIDER',
    'UPLOAD_DIRECTORY',
    'FRONTEND_URL',
  ];
  let snap: Record<string, string | undefined>;
  let validUploadDir: string;

  beforeAll(async () => {
    validUploadDir = await mkdtemp(path.join(tmpdir(), 'mj-task-'));
  });

  beforeEach(() => {
    snap = saveEnv(...ENV_KEYS);
    // Reset to the "fully enabled but dry-run" baseline.
    process.env.MEDIA_JANITOR_ENABLED = 'true';
    process.env.MEDIA_JANITOR_DRY_RUN = 'true';
    process.env.STORAGE_PROVIDER = 'local';
    process.env.UPLOAD_DIRECTORY = validUploadDir;
    process.env.FRONTEND_URL = 'https://app.example.test';
    delete process.env.MEDIA_JANITOR_AGE_DAYS;
    delete process.env.MEDIA_JANITOR_GRACE_DAYS;
    delete process.env.MEDIA_JANITOR_BATCH_SIZE;
  });

  afterEach(() => {
    restoreEnv(snap);
  });

  it('default state (MEDIA_JANITOR_ENABLED unset) → no service calls', async () => {
    delete process.env.MEDIA_JANITOR_ENABLED;
    const { task, service } = buildTask();
    await task.handleCron();
    expect(service.runSoftDeletePhase).not.toHaveBeenCalled();
    expect(service.runHardDeletePhase).not.toHaveBeenCalled();
  });

  it('MEDIA_JANITOR_ENABLED=false → no service calls', async () => {
    process.env.MEDIA_JANITOR_ENABLED = 'false';
    const { task, service } = buildTask();
    await task.handleCron();
    expect(service.runSoftDeletePhase).not.toHaveBeenCalled();
    expect(service.runHardDeletePhase).not.toHaveBeenCalled();
  });

  it('STORAGE_PROVIDER=cloudflare → INERT (invariant #6)', async () => {
    process.env.STORAGE_PROVIDER = 'cloudflare';
    const { task, service } = buildTask();
    await task.handleCron();
    expect(service.runSoftDeletePhase).not.toHaveBeenCalled();
    expect(service.runHardDeletePhase).not.toHaveBeenCalled();
  });

  it('STORAGE_PROVIDER unset → defaults to local, runs', async () => {
    delete process.env.STORAGE_PROVIDER;
    const { task, service } = buildTask();
    await task.handleCron();
    expect(service.runSoftDeletePhase).toHaveBeenCalled();
    expect(service.runHardDeletePhase).toHaveBeenCalled();
  });

  it('UPLOAD_DIRECTORY missing → INERT', async () => {
    delete process.env.UPLOAD_DIRECTORY;
    const { task, service } = buildTask();
    await task.handleCron();
    expect(service.runSoftDeletePhase).not.toHaveBeenCalled();
  });

  it('UPLOAD_DIRECTORY non-absolute → INERT', async () => {
    process.env.UPLOAD_DIRECTORY = 'relative/path';
    const { task, service } = buildTask();
    await task.handleCron();
    expect(service.runSoftDeletePhase).not.toHaveBeenCalled();
  });

  it('FRONTEND_URL missing → INERT (resolver cannot classify)', async () => {
    delete process.env.FRONTEND_URL;
    const { task, service } = buildTask();
    await task.handleCron();
    expect(service.runSoftDeletePhase).not.toHaveBeenCalled();
  });

  it.each(['/', '/tmp', '/etc', '/var', '/usr', '/bin'])(
    'UPLOAD_DIRECTORY=%s → INERT (SR-5 forbidden root)',
    async (root) => {
      process.env.UPLOAD_DIRECTORY = root;
      const { task, service } = buildTask();
      await task.handleCron();
      expect(service.runSoftDeletePhase).not.toHaveBeenCalled();
    }
  );

  it('UPLOAD_DIRECTORY that does not exist → INERT (root-sanity probe fails)', async () => {
    process.env.UPLOAD_DIRECTORY = '/nonexistent/never/exists-mj-spec';
    const { task, service } = buildTask();
    await task.handleCron();
    expect(service.runSoftDeletePhase).not.toHaveBeenCalled();
  });
});

describe('MediaJanitor.handleCron — options assembly + delegation', () => {
  const ENV_KEYS = [
    'MEDIA_JANITOR_ENABLED',
    'MEDIA_JANITOR_DRY_RUN',
    'MEDIA_JANITOR_AGE_DAYS',
    'MEDIA_JANITOR_GRACE_DAYS',
    'MEDIA_JANITOR_BATCH_SIZE',
    'STORAGE_PROVIDER',
    'UPLOAD_DIRECTORY',
    'FRONTEND_URL',
  ];
  let snap: Record<string, string | undefined>;
  let validUploadDir: string;

  beforeAll(async () => {
    validUploadDir = await mkdtemp(path.join(tmpdir(), 'mj-task-opts-'));
  });

  beforeEach(() => {
    snap = saveEnv(...ENV_KEYS);
    process.env.MEDIA_JANITOR_ENABLED = 'true';
    process.env.STORAGE_PROVIDER = 'local';
    process.env.UPLOAD_DIRECTORY = validUploadDir;
    process.env.FRONTEND_URL = 'https://app.example.test';
  });

  afterEach(() => restoreEnv(snap));

  it('defaults: dryRun=true, ageDays=7, graceDays=7, batchSize=100', async () => {
    delete process.env.MEDIA_JANITOR_DRY_RUN;
    delete process.env.MEDIA_JANITOR_AGE_DAYS;
    delete process.env.MEDIA_JANITOR_GRACE_DAYS;
    delete process.env.MEDIA_JANITOR_BATCH_SIZE;
    const { task, service } = buildTask();
    await task.handleCron();
    const opts = (service.runSoftDeletePhase as jest.Mock).mock.calls[0][0];
    expect(opts).toMatchObject({
      dryRun: true,
      ageDays: 7,
      graceDays: 7,
      batchSize: 100,
    });
  });

  it('DRY_RUN must be the literal string "false" to actually destroy', async () => {
    process.env.MEDIA_JANITOR_DRY_RUN = 'false';
    const { task, service } = buildTask();
    await task.handleCron();
    const opts = (service.runSoftDeletePhase as jest.Mock).mock.calls[0][0];
    expect(opts.dryRun).toBe(false);
  });

  it('DRY_RUN with any other string defaults safe (dryRun=true)', async () => {
    process.env.MEDIA_JANITOR_DRY_RUN = '0';
    const { task, service } = buildTask();
    await task.handleCron();
    const opts = (service.runSoftDeletePhase as jest.Mock).mock.calls[0][0];
    expect(opts.dryRun).toBe(true);
  });

  it('non-positive AGE_DAYS falls back to default (7)', async () => {
    process.env.MEDIA_JANITOR_AGE_DAYS = '0';
    const { task, service } = buildTask();
    await task.handleCron();
    const opts = (service.runSoftDeletePhase as jest.Mock).mock.calls[0][0];
    expect(opts.ageDays).toBe(7);
  });

  it('garbage AGE_DAYS falls back to default (7)', async () => {
    process.env.MEDIA_JANITOR_AGE_DAYS = 'not-a-number';
    const { task, service } = buildTask();
    await task.handleCron();
    const opts = (service.runSoftDeletePhase as jest.Mock).mock.calls[0][0];
    expect(opts.ageDays).toBe(7);
  });

  it('valid AGE/GRACE/BATCH overrides reach the service', async () => {
    process.env.MEDIA_JANITOR_AGE_DAYS = '14';
    process.env.MEDIA_JANITOR_GRACE_DAYS = '3';
    process.env.MEDIA_JANITOR_BATCH_SIZE = '50';
    const { task, service } = buildTask();
    await task.handleCron();
    const opts = (service.runSoftDeletePhase as jest.Mock).mock.calls[0][0];
    expect(opts).toMatchObject({ ageDays: 14, graceDays: 3, batchSize: 50 });
  });

  it('runId format: mj-<isoStartedAt>-<6hex>', async () => {
    const clock = new FakeClock();
    clock.ms = Date.UTC(2026, 4, 21, 3, 0, 0);
    const { task, service } = buildTask({ clock });
    await task.handleCron();
    const opts = (service.runSoftDeletePhase as jest.Mock).mock.calls[0][0];
    expect(opts.runId).toMatch(
      /^mj-2026-05-21T03:00:00\.000Z-[0-9a-f]{6}$/
    );
  });

  it('invokes BOTH phases even when soft-phase throws (invariant #10 containment)', async () => {
    const service = {
      runSoftDeletePhase: jest.fn(async () => {
        throw new Error('soft DB error');
      }),
      runHardDeletePhase: jest.fn(async () => ({
        scanned: 0,
        candidates: 0,
        hardDeleted: 0,
        resurrected: 0,
        pathRejected: 0,
        unlinkErrors: 0,
        bytesReclaimed: 0,
      })),
    };
    const { task } = buildTask({ service });
    await task.handleCron();
    expect(service.runSoftDeletePhase).toHaveBeenCalled();
    expect(service.runHardDeletePhase).toHaveBeenCalled();
  });

  it('does NOT rethrow when hard-phase throws (cron handler does not surface)', async () => {
    const service = {
      runSoftDeletePhase: jest.fn(async () => ({
        scanned: 0, eligible: 0, transitioned: 0, errors: 0,
        bytesReclaimedEstimate: 0,
      })),
      runHardDeletePhase: jest.fn(async () => {
        throw new Error('hard DB error');
      }),
    };
    const { task } = buildTask({ service });
    await expect(task.handleCron()).resolves.toBeUndefined();
  });
});
