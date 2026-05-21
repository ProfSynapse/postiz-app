import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '@gitroom/nestjs-libraries/database/prisma/database.module';
import { BullMqModule } from '@gitroom/nestjs-libraries/bull-mq-transport-new/bull.mq.module';
import { SentryModule } from '@sentry/nestjs/setup';
import { FILTER } from '@gitroom/nestjs-libraries/sentry/sentry.exception';
import { CheckMissingQueues } from '@gitroom/cron/tasks/check.missing.queues';
import { PostNowPendingQueues } from '@gitroom/cron/tasks/post.now.pending.queues';
import { MediaJanitor } from '@gitroom/cron/tasks/media.janitor';
import { MediaJanitorService } from '@gitroom/nestjs-libraries/database/prisma/media/media.janitor.service';
import { MediaJanitorRepository } from '@gitroom/nestjs-libraries/database/prisma/media/media.janitor.repository';
import { MediaPathResolver } from '@gitroom/nestjs-libraries/upload/media.path.resolver';
import { ClockService } from '@gitroom/nestjs-libraries/services/clock.service';

@Module({
  imports: [
    SentryModule.forRoot(),
    DatabaseModule,
    ScheduleModule.forRoot(),
    BullMqModule,
  ],
  controllers: [],
  providers: [
    FILTER,
    CheckMissingQueues,
    PostNowPendingQueues,
    MediaJanitor,
    MediaJanitorService,
    MediaJanitorRepository,
    MediaPathResolver,
    ClockService,
  ],
})
export class CronModule {}
