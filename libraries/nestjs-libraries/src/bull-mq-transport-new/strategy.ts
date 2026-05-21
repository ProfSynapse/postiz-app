import { CustomTransportStrategy, Server } from '@nestjs/microservices';
import { Queue, Worker } from 'bullmq';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { Logger } from '@nestjs/common';

export class BullMqServer extends Server implements CustomTransportStrategy {
  // Additive-only observability logger. Today's silent-startup incident
  // was masked because nothing here emitted on bind — we now log each
  // queue and worker as they are constructed.
  private readonly logger = new Logger(BullMqServer.name);

  queues: Map<string, Queue>;
  workers: Worker[] = [];

  /**
   * This method is triggered when you run "app.listen()".
   */
  listen(callback: () => void) {
    const patterns = [...this.messageHandlers.keys()];
    this.logger.log(
      `Binding ${patterns.length} BullMQ queue(s) for patterns: ${
        patterns.length ? patterns.join(', ') : '(none)'
      }`
    );

    this.queues = patterns.reduce((all, pattern) => {
      all.set(pattern, new Queue(pattern, { connection: ioRedis }));
      this.logger.log(`Queue bound: pattern="${pattern}"`);
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
            connection: ioRedis,
            removeOnComplete: {
              count: 0,
            },
            removeOnFail: {
              count: 0,
            },
          }
        );
        this.logger.log(
          `Worker bound: pattern="${pattern}" concurrency=300 status=listening`
        );
        return worker;
      }
    );

    this.logger.log(
      `BullMQ transport ready: ${this.queues.size} queue(s), ${this.workers.length} worker(s)`
    );
    callback();
  }

  /**
   * This method is triggered on application shutdown.
   */
  close() {
    this.workers.map((worker) => worker.close());
    this.queues.forEach((queue) => queue.close());
    return true;
  }
}
