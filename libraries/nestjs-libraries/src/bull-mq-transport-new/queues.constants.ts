// libraries/nestjs-libraries/src/bull-mq-transport-new/queues.constants.ts
//
// Single source of truth for BullMQ queue/pattern names used across the
// Postiz scheduling stack. Worker controllers in apps/workers/src/app/*
// declare these via @EventPattern() decorators; consumers (health probes,
// observability logs, recovery cron) import from here to avoid drifting
// duplicate string literals.
//
// To add a new queue: declare the @EventPattern('<name>', Transport.REDIS)
// in the appropriate apps/workers controller AND extend the list below.

export const POST_QUEUE_PATTERN = 'post' as const;

export const KNOWN_QUEUE_PATTERNS = [
  POST_QUEUE_PATTERN,
  'cron',
  'plugs',
  'internal-plugs',
  'submit',
  'sendDigestEmail',
  'webhooks',
] as const;

export type KnownQueuePattern = (typeof KNOWN_QUEUE_PATTERNS)[number];
