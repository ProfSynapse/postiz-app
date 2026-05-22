import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { BullMqClient } from '@gitroom/nestjs-libraries/bull-mq-transport-new/client';
import dayjs from 'dayjs';

@Injectable()
export class PostNowPendingQueues {
  constructor(
    private _postService: PostsService,
    private _workerServiceProducer: BullMqClient
  ) {}
  @Cron('* * * * *')
  async handleCron() {
    const list = await this._postService.checkOverdueQueuedPosts();
    const notExists = (
      await Promise.all(
        list.map(async (p) => {
          const queue = this._workerServiceProducer.getQueue('post');
          const job = await queue.getJob(p.id);
          const state = job ? await job.getState() : 'missing';
          const dueAt =
            job && typeof job.timestamp === 'number'
              ? dayjs(job.timestamp + (job.delay || 0))
              : dayjs(p.publishDate);

          return {
            id: p.id,
            publishDate: p.publishDate,
            job,
            state,
            isStale:
              state === 'missing' ||
              (['delayed', 'waiting'].includes(state) &&
                dueAt.isBefore(dayjs())),
          };
        })
      )
    ).filter((p) => p.isStale);

    for (const job of notExists) {
      if (job.job && ['delayed', 'waiting'].includes(job.state)) {
        try {
          await job.job.remove();
        } catch (err) {
          console.warn(
            `Skipping overdue post ${job.id}; failed to remove stale ${job.state} queue job`,
            err
          );
          continue;
        }
      }

      console.warn(
        `Requeueing overdue post ${job.id}; scheduled at ${job.publishDate.toISOString()}`
      );
      this._workerServiceProducer
        .emit('post', {
          id: job.id,
          options: {
            delay: 0,
          },
          payload: {
            id: job.id,
            delay: 0,
          },
        })
        .subscribe({
          error: (err) =>
            console.warn(`Failed to requeue overdue post ${job.id}`, err),
        });
    }
  }
}
