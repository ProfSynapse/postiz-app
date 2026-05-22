import { initializeSentry } from '@gitroom/nestjs-libraries/sentry/initialize.sentry';
initializeSentry('workers');

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { MicroserviceOptions } from '@nestjs/microservices';
import { BullMqServer } from '@gitroom/nestjs-libraries/bull-mq-transport-new/strategy';

import { AppModule } from './app/app.module';

async function bootstrap() {
  process.env.IS_WORKER = 'true';

  Logger.log('🚀 Workers microservice bootstrapping (IS_WORKER=true)', 'Workers');

  try {
    const app = await NestFactory.createMicroservice<MicroserviceOptions>(
      AppModule,
      {
        strategy: new BullMqServer(),
      }
    );

    Logger.log('Nest application context created — binding BullMQ transport', 'Workers');

    await app.listen();

    Logger.log('✅ Workers microservice listening on BullMQ transport', 'Workers');
  } catch (err) {
    Logger.error(
      `❌ Workers failed to bootstrap: ${(err as Error)?.message ?? err}`,
      (err as Error)?.stack,
      'Workers'
    );
    // Exit non-zero so pm2 (or the container runtime) restarts us instead of
    // sitting silently with an unbound microservice — today's incident shape.
    process.exit(1);
  }
}

bootstrap().catch((err) => {
  Logger.error(
    `❌ Unhandled rejection in workers bootstrap: ${(err as Error)?.message ?? err}`,
    (err as Error)?.stack,
    'Workers'
  );
  process.exit(1);
});
