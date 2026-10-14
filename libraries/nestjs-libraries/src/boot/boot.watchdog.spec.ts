import { spawnSync } from 'child_process';
import { BOOT_PHASES, WATCHDOG_SOURCE } from './boot.watchdog';

// Runs the watchdog thread in a child process, because a firing watchdog
// SIGKILLs its own process. `finalPhase` is how far the child's boot gets;
// `block` stalls the child's main thread the way the production stall does.
function runChild(finalPhase: number, block: boolean) {
  const script = `
    const { Worker } = require('worker_threads');
    const progress = new Int32Array(new SharedArrayBuffer(4));
    const w = new Worker(${JSON.stringify(WATCHDOG_SOURCE)}, {
      eval: true,
      workerData: { app: 'test', deadlineMs: 300, buffer: progress.buffer, phases: ${JSON.stringify(BOOT_PHASES)} },
    });
    w.unref();
    Atomics.store(progress, 0, ${finalPhase});
    if (${block}) {
      // Sleep the main thread in the kernel, like the stalled boots.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
    } else {
      setTimeout(() => w.terminate(), 600);
    }
  `;
  return spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    timeout: 10_000,
  });
}

describe('boot watchdog', () => {
  it('kills a process whose main thread stalls before boot finishes', () => {
    const result = runChild(1, true);

    // Windows has no signals: a killed process just exits non-zero.
    if (process.platform === 'win32') {
      expect(result.status).not.toBe(0);
    } else {
      expect(result.signal).toBe('SIGKILL');
    }
    expect(result.stderr).toContain('[boot-watchdog] test did not finish booting');
    expect(result.stderr).toContain('last phase "modules loaded"');
  });

  it('leaves a process alone once boot reaches listening', () => {
    const result = runChild(BOOT_PHASES.indexOf('listening'), false);

    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('[boot-watchdog]');
  });
});
