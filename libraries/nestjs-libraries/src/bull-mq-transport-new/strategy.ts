import { CustomTransportStrategy, Server } from '@nestjs/microservices';
import { ConnectionOptions, Queue, Worker } from 'bullmq';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

const bullMqConnection = ioRedis as unknown as ConnectionOptions;

export class BullMqServer extends Server implements CustomTransportStrategy {
  queues: Map<string, Queue>;
  workers: Worker[] = [];
  private healthInterval?: NodeJS.Timeout;

  /**
   * This method is triggered when you run "app.listen()".
   */
  listen(callback: () => void) {
    this.queues = [...this.messageHandlers.keys()].reduce((all, pattern) => {
      all.set(pattern, new Queue(pattern, { connection: bullMqConnection }));
      return all;
    }, new Map());

    this.workers = Array.from(this.messageHandlers).map(
      ([pattern, handler]) => {
        const worker = new Worker(
          pattern,
          async (job) => {
            const stream$ = this.transformToObservable(
              await handler(job.data.payload, job)
            );

            this.send(stream$, (packet) => {
              if (packet.err) {
                return job.discard();
              }

              return true;
            });
          },
          {
            maxStalledCount: 10,
            concurrency: 300,
            connection: bullMqConnection,
            removeOnComplete: {
              count: 0,
            },
            removeOnFail: {
              count: 0,
            },
          }
        );

        worker.on('ready', () =>
          console.log(`[BullMQ] worker ready for queue "${pattern}"`)
        );
        worker.on('error', (err) =>
          console.error(`[BullMQ] worker error for queue "${pattern}"`, err)
        );
        worker.on('failed', (job, err) =>
          console.error(
            `[BullMQ] job ${job?.id} failed on queue "${pattern}"`,
            err
          )
        );
        worker.on('completed', (job) =>
          console.log(`[BullMQ] job ${job.id} completed on queue "${pattern}"`)
        );
        worker.on('stalled', (jobId) =>
          console.warn(`[BullMQ] job ${jobId} stalled on queue "${pattern}"`)
        );

        return worker;
      }
    );

    this.healthInterval = setInterval(() => {
      for (const worker of this.workers) {
        if (!worker.isRunning()) {
          console.error(
            `[BullMQ] worker for queue "${worker.name}" stopped; restarting run loop`
          );
          worker.run().catch((err) =>
            console.error(
              `[BullMQ] worker for queue "${worker.name}" failed after restart`,
              err
            )
          );
        }
      }
    }, 30000);
    this.healthInterval.unref();

    callback();
  }

  /**
   * This method is triggered on application shutdown.
   */
  close() {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
    }
    this.workers.map((worker) => worker.close());
    this.queues.forEach((queue) => queue.close());
    return true;
  }
}
