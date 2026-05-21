import { Controller } from '@nestjs/common';
import { EventPattern, Transport } from '@nestjs/microservices';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { AutopostService } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.service';
import {
  POST_QUEUE_PATTERN,
  SUBMIT_QUEUE_PATTERN,
  SEND_DIGEST_EMAIL_QUEUE_PATTERN,
  WEBHOOKS_QUEUE_PATTERN,
  CRON_QUEUE_PATTERN,
} from '@gitroom/nestjs-libraries/bull-mq-transport-new/queues.constants';

@Controller()
export class PostsController {
  constructor(
    private _postsService: PostsService,
    private _webhooksService: WebhooksService,
    private _autopostsService: AutopostService
  ) {}

  @EventPattern(POST_QUEUE_PATTERN, Transport.REDIS)
  async post(data: { id: string }) {
    console.log('processing', data);
    try {
      return await this._postsService.post(data.id);
    } catch (err) {
      console.log("Unhandled error, let's avoid crashing the post worker", err);
    }
  }

  @EventPattern(SUBMIT_QUEUE_PATTERN, Transport.REDIS)
  async payout(data: { id: string; releaseURL: string }) {
    try {
      return await this._postsService.payout(data.id, data.releaseURL);
    } catch (err) {
      console.log(
        "Unhandled error, let's avoid crashing the submit worker",
        err
      );
    }
  }

  @EventPattern(SEND_DIGEST_EMAIL_QUEUE_PATTERN, Transport.REDIS)
  async sendDigestEmail(data: { subject: string; org: string; since: string }) {
    try {
      return await this._postsService.sendDigestEmail(
        data.subject,
        data.org,
        data.since
      );
    } catch (err) {
      console.log(
        "Unhandled error, let's avoid crashing the digest worker",
        err
      );
    }
  }

  @EventPattern(WEBHOOKS_QUEUE_PATTERN, Transport.REDIS)
  async webhooks(data: { org: string; since: string }) {
    try {
      return await this._webhooksService.fireWebhooks(data.org, data.since);
    } catch (err) {
      console.log(
        "Unhandled error, let's avoid crashing the webhooks worker",
        err
      );
    }
  }

  @EventPattern(CRON_QUEUE_PATTERN, Transport.REDIS)
  async cron(data: { id: string }) {
    try {
      return await this._autopostsService.startAutopost(data.id);
    } catch (err) {
      console.log(
        "Unhandled error, let's avoid crashing the autopost worker",
        err
      );
    }
  }
}
