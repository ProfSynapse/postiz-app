// libraries/nestjs-libraries/src/bull-mq-transport-new/queues.constants.ts
//
// Single source of truth for BullMQ queue/pattern names used across the
// Postiz scheduling stack. Worker controllers in apps/workers/src/app/*
// declare these via @EventPattern() decorators; consumers (health probes,
// observability logs, recovery cron) import from here to avoid drifting
// duplicate string literals.
//
// To add a new queue: add a new named constant + extend KNOWN_QUEUE_PATTERNS.
// Then reference the constant in the @EventPattern decorator on the
// corresponding apps/workers controller. Never hardcode the string literal.

export const POST_QUEUE_PATTERN = 'post' as const;
export const CRON_QUEUE_PATTERN = 'cron' as const;
export const PLUGS_QUEUE_PATTERN = 'plugs' as const;
export const INTERNAL_PLUGS_QUEUE_PATTERN = 'internal-plugs' as const;
export const SUBMIT_QUEUE_PATTERN = 'submit' as const;
export const SEND_DIGEST_EMAIL_QUEUE_PATTERN = 'sendDigestEmail' as const;
export const WEBHOOKS_QUEUE_PATTERN = 'webhooks' as const;

export const KNOWN_QUEUE_PATTERNS = [
  POST_QUEUE_PATTERN,
  CRON_QUEUE_PATTERN,
  PLUGS_QUEUE_PATTERN,
  INTERNAL_PLUGS_QUEUE_PATTERN,
  SUBMIT_QUEUE_PATTERN,
  SEND_DIGEST_EMAIL_QUEUE_PATTERN,
  WEBHOOKS_QUEUE_PATTERN,
] as const;

export type KnownQueuePattern = (typeof KNOWN_QUEUE_PATTERNS)[number];
