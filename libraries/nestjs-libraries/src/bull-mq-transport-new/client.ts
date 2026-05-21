import { ClientProxy, ReadPacket, WritePacket } from '@nestjs/microservices';
import { Queue, QueueEvents } from 'bullmq';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { v4 } from 'uuid';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

@Injectable()
export class BullMqClient extends ClientProxy implements OnModuleDestroy {
  private readonly logger = new Logger(BullMqClient.name);
  queues = new Map<string, Queue>();
  queueEvents = new Map<string, QueueEvents>();

  async connect(): Promise<any> {
    return;
  }

  // NestJS ClientProxy.close() is invoked on graceful shutdown. Delegate to
  // onModuleDestroy so both code paths drain the cached Queue/QueueEvents
  // ioredis connections. Pre-hardening this was a no-op AND the Maps were
  // never populated; both issues are fixed together (cache populated by
  // getQueue/getQueueEvents, drained here on shutdown).
  async close() {
    await this.onModuleDestroy();
  }

  async onModuleDestroy(): Promise<void> {
    const results = await Promise.allSettled([
      ...Array.from(this.queues.values()).map((q) => q.close()),
      ...Array.from(this.queueEvents.values()).map((qe) => qe.close()),
    ]);
    for (const r of results) {
      if (r.status === 'rejected') {
        // Best-effort drain — log and continue so a single bad close doesn't
        // strand the others. Process is exiting either way.
        this.logger.warn(
          `BullMqClient shutdown drain rejected: ${
            (r.reason as Error)?.message ?? r.reason
          }`
        );
      }
    }
    this.queues.clear();
    this.queueEvents.clear();
  }

  publish(
    packet: ReadPacket<any>,
    callback: (packet: WritePacket<any>) => void
  ) {
    // console.log('hello');
    // this.publishAsync(packet, callback);
    return () => console.log('sent');
  }

  delete(pattern: string, jobId: string) {
    const queue = this.getQueue(pattern);
    return queue.remove(jobId);
  }

  deleteScheduler(pattern: string, jobId: string) {
    const queue = this.getQueue(pattern);
    return queue.removeJobScheduler(jobId);
  }

  async publishAsync(
    packet: ReadPacket<any>,
    callback: (packet: WritePacket<any>) => void
  ) {
    const queue = this.getQueue(packet.pattern);
    const queueEvents = this.getQueueEvents(packet.pattern);
    const job = await queue.add(packet.pattern, packet.data, {
      jobId: packet.data.id ?? v4(),
      ...packet.data.options,
      removeOnComplete: !packet.data.options.attempts,
      removeOnFail: !packet.data.options.attempts,
    });

    try {
      await job.waitUntilFinished(queueEvents);
      console.log('success');
      callback({ response: job.returnvalue, isDisposed: true });
    } catch (err) {
      console.log('err');
      callback({ err, isDisposed: true });
    }
  }

  getQueueEvents(pattern: string) {
    // Cache-or-create. Previously this used `Map.get() || new QueueEvents(...)`
    // which short-circuited to a fresh QueueEvents on every miss but never
    // .set() back into the Map — leaking an ioredis connection per call.
    let queueEvents = this.queueEvents.get(pattern);
    if (!queueEvents) {
      queueEvents = new QueueEvents(pattern, {
        connection: ioRedis,
      });
      this.queueEvents.set(pattern, queueEvents);
    }
    return queueEvents;
  }

  getQueue(pattern: string) {
    // Cache-or-create. See getQueueEvents above — same leak shape.
    let queue = this.queues.get(pattern);
    if (!queue) {
      queue = new Queue(pattern, {
        connection: ioRedis,
      });
      this.queues.set(pattern, queue);
    }
    return queue;
  }

  async checkForStuckWaitingJobs(queueName: string) {
    const queue = this.getQueue(queueName);
    const getJobs = await queue.getJobs('waiting' as const);
    const now = Date.now();
    const thresholdMs = 60 * 60 * 1000;
    return {
      valid: !getJobs.some((job) => {
        const age = now - job.timestamp;
        return age > thresholdMs;
      }),
    };
  }

  async dispatchEvent(packet: ReadPacket<any>): Promise<any> {
    console.log('event to dispatch: ', packet);
    const queue = this.getQueue(packet.pattern);
    if (packet?.data?.options?.every) {
      const { every, immediately } = packet.data.options;
      const id = packet.data.id ?? v4();
      await queue.upsertJobScheduler(
        id,
        { every, ...(immediately ? { immediately } : {}) },
        {
          name: id,
          data: packet.data,
          opts: {
            removeOnComplete: true,
            removeOnFail: true,
          },
        }
      );
      return;
    }

    await queue.add(packet.pattern, packet.data, {
      jobId: packet.data.id ?? v4(),
      ...packet.data.options,
      removeOnComplete: true,
      removeOnFail: true,
    });
  }
}
