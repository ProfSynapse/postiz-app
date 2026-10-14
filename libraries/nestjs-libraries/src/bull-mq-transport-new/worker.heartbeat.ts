import { hostname } from 'os';
import type { Worker } from 'bullmq';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

// The heartbeat proves this container's workers process booted, connected to
// Redis and has every BullMQ worker running. It is keyed by hostname because
// backend, cron and workers share one container, while an old deployment's
// container keeps writing its own key during a rolling deploy.
const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_TTL_MS = 60_000;

export const workerHeartbeatKey = (host = hostname()) =>
  `postiz:heartbeat:workers:${host}`;

export function startWorkerHeartbeat(workers: Worker[]): NodeJS.Timeout {
  const ready = new Set<string>();
  for (const worker of workers) {
    worker.on('ready', () => ready.add(worker.name));
  }

  const beat = async () => {
    const allRunning =
      workers.length > 0 &&
      ready.size === workers.length &&
      workers.every((worker) => worker.isRunning());
    if (!allRunning) {
      return;
    }
    try {
      await ioRedis.set(workerHeartbeatKey(), Date.now(), 'PX', HEARTBEAT_TTL_MS);
    } catch (err) {
      console.warn('[BullMQ] failed to write worker heartbeat', err);
    }
  };

  const interval = setInterval(beat, HEARTBEAT_INTERVAL_MS);
  interval.unref();
  // Beat as soon as every worker reports ready instead of waiting a full
  // interval, so deploy healthchecks pass promptly.
  for (const worker of workers) {
    worker.on('ready', () => void beat());
  }
  return interval;
}

/** Null when Redis itself cannot be asked, so callers can tell the two apart. */
export async function isWorkerAlive(): Promise<boolean | null> {
  try {
    return (await ioRedis.exists(workerHeartbeatKey())) === 1;
  } catch {
    return null;
  }
}
