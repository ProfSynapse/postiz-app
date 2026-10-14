import { Worker } from 'worker_threads';

// The workers process has stalled during boot on several deploys: it prints
// its start command, never reaches Nest's first log line, sleeps with almost
// no CPU and never recovers. PM2 still reports it online. This watchdog runs
// on its own thread, so it keeps working while the main thread is blocked.
// If boot has not finished by the deadline it records where boot stopped and
// what every thread is blocked on, then kills the process so PM2 restarts it.

export const BOOT_PHASES = [
  'process started',
  'modules loaded',
  'nest created',
  'listening',
] as const;
export type BootPhase = (typeof BOOT_PHASES)[number];

const DEFAULT_DEADLINE_MS = 90_000;

// Plain JS, evaluated in the watchdog thread. It writes with fs.writeSync
// because a worker thread's console is relayed through the (stalled) main
// thread and would never be flushed.
export const WATCHDOG_SOURCE = `
const { workerData } = require('worker_threads');
const fs = require('fs');
const progress = new Int32Array(workerData.buffer);
const read = (p) => { try { return fs.readFileSync(p, 'utf8').trim(); } catch { return '?'; } };
setTimeout(() => {
  const phase = Atomics.load(progress, 0);
  if (phase >= workerData.phases.length - 1) return;
  let threads = [];
  try {
    threads = fs.readdirSync('/proc/self/task').map((tid) => {
      const base = '/proc/self/task/' + tid;
      return read(base + '/comm') + '[' + read(base + '/wchan') + ']';
    });
  } catch {}
  fs.writeSync(2,
    '[boot-watchdog] ' + workerData.app + ' did not finish booting within ' +
    workerData.deadlineMs + 'ms; last phase "' + workerData.phases[phase] +
    '"; threads ' + (threads.join(' ') || 'unavailable') +
    '; killing so PM2 restarts it\\n');
  process.kill(process.pid, 'SIGKILL');
}, workerData.deadlineMs);
`;

export function startBootWatchdog(
  app: string,
  deadlineMs = Number(process.env.BOOT_WATCHDOG_DEADLINE_MS) ||
    DEFAULT_DEADLINE_MS
) {
  const startedAt = Date.now();
  const progress = new Int32Array(new SharedArrayBuffer(4));
  let watchdog: Worker | undefined;
  try {
    watchdog = new Worker(WATCHDOG_SOURCE, {
      eval: true,
      workerData: {
        app,
        deadlineMs,
        buffer: progress.buffer,
        phases: BOOT_PHASES,
      },
    });
    watchdog.unref();
  } catch (err) {
    console.warn(`[boot-watchdog] could not start for ${app}`, err);
  }

  return {
    mark(phase: BootPhase) {
      Atomics.store(progress, 0, BOOT_PHASES.indexOf(phase));
      console.log(`[boot] ${app}: ${phase} after ${Date.now() - startedAt}ms`);
      if (phase === 'listening') {
        void watchdog?.terminate();
      }
    },
  };
}
