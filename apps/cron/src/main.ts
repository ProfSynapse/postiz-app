// Start the boot watchdog before anything heavy loads (see boot.watchdog.ts).
// Cron hosts the workers supervisor, so a stalled cron leaves nothing watching.
import { startBootWatchdog } from '@gitroom/nestjs-libraries/boot/boot.watchdog';
const boot = startBootWatchdog('cron');

import { initializeSentry } from '@gitroom/nestjs-libraries/sentry/initialize.sentry';
initializeSentry('cron');

import { NestFactory } from '@nestjs/core';
import { CronModule } from './cron.module';

boot.mark('modules loaded');

async function bootstrap() {
  // some comment again
  await NestFactory.createApplicationContext(CronModule);
  boot.mark('nest created');
  boot.mark('listening');
}

bootstrap();
