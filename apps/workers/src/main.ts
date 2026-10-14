// Start the boot watchdog before anything heavy loads (see boot.watchdog.ts).
import { startBootWatchdog } from '@gitroom/nestjs-libraries/boot/boot.watchdog';
const boot = startBootWatchdog('workers');

import { initializeSentry } from '@gitroom/nestjs-libraries/sentry/initialize.sentry';
initializeSentry('workers');

import { NestFactory } from '@nestjs/core';

import { MicroserviceOptions } from '@nestjs/microservices';
import { BullMqServer } from '@gitroom/nestjs-libraries/bull-mq-transport-new/strategy';

import { AppModule } from './app/app.module';

boot.mark('modules loaded');

async function bootstrap() {
  process.env.IS_WORKER = 'true';

  // some comment again
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      strategy: new BullMqServer(),
    }
  );
  boot.mark('nest created');

  await app.listen();
  boot.mark('listening');
}

bootstrap();
