/**
 * libraries/nestjs-libraries/src/services/clock.service.ts
 *
 * Injectable wall-clock abstraction. Sole exempt site from the `new Date()` /
 * `Date.now()` ban enforced (via ESLint `no-restricted-syntax`) on media-janitor
 * source files. All janitor code paths must read time through this service so
 * tests can substitute a `FakeClockService`.
 *
 * Used by:
 *   - apps/cron/src/tasks/media.janitor.ts (runId minting, run start/end logs)
 *   - libraries/nestjs-libraries/src/database/prisma/media/media.janitor.service.ts
 *
 * See: docs/architecture/media-janitor.md §6 ClockService Contract
 *      docs/plans/media-janitor-plan.md §Clock contract, invariants #2/#3
 */
import { Injectable } from '@nestjs/common';

@Injectable()
export class ClockService {
  now(): Date {
    return new Date();
  }

  nowMs(): number {
    return Date.now();
  }
}
