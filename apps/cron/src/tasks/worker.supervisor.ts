import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { execFile } from 'child_process';
import { isWorkerAlive } from '@gitroom/nestjs-libraries/bull-mq-transport-new/worker.heartbeat';

// Give a fresh container (or a just-restarted workers process) time to boot
// before judging it, and never restart more often than the cooldown.
const BOOT_GRACE_MS = 3 * 60_000;
const RESTART_COOLDOWN_MS = 5 * 60_000;

type RestartWorkers = () => Promise<void>;

const pm2RestartWorkers: RestartWorkers = () =>
  new Promise((resolve, reject) => {
    execFile('pm2', ['restart', 'workers'], { timeout: 60_000 }, (err) =>
      err ? reject(err) : resolve()
    );
  });

/**
 * PM2 reports a hung workers process as "online", and Railway only restarts
 * a container whose main process exits, so nothing else notices a workers
 * process that stalled during boot or lost its queues. Posts then sit in
 * QUEUE until someone restarts Postiz by hand. Restart it from here instead.
 */
@Injectable()
export class WorkerSupervisor {
  // Fields rather than constructor params so Nest DI stays parameterless;
  // tests replace them.
  restartWorkers: RestartWorkers = pm2RestartWorkers;
  now: () => number = Date.now;
  underPm2 = process.env.pm_id !== undefined;
  private readonly startedAt = Date.now();
  private lastRestartAt = 0;

  @Cron('* * * * *')
  async handleCron() {
    if (!this.underPm2) {
      return;
    }
    const now = this.now();
    if (now - this.startedAt < BOOT_GRACE_MS) {
      return;
    }
    if (now - this.lastRestartAt < RESTART_COOLDOWN_MS) {
      return;
    }

    const alive = await isWorkerAlive();
    // null: Redis itself is unreachable. Restarting workers cannot fix that,
    // and ioredis reconnects on its own when Redis returns.
    if (alive !== false) {
      return;
    }

    this.lastRestartAt = now;
    console.error(
      '[supervisor] workers heartbeat missing; restarting workers via pm2'
    );
    try {
      await this.restartWorkers();
      console.warn('[supervisor] workers restart requested');
    } catch (err) {
      console.error('[supervisor] failed to restart workers', err);
    }
  }
}
