/**
 * libraries/nestjs-libraries/src/upload/path.confinement.error.ts
 *
 * Typed error thrown by `LocalStorage.removeFile` when the authoritative
 * re-confinement check (`confineAndVerify`) rejects an input path. Carries the
 * machine-readable rejection reason plus the offending input so callers (the
 * janitor service) can structured-log + Sentry-capture without parsing.
 *
 * Used by:
 *   - libraries/nestjs-libraries/src/upload/local.storage.ts (throws)
 *   - libraries/nestjs-libraries/src/database/prisma/media/media.janitor.service.ts (catches)
 *
 * See: docs/architecture/media-janitor.md §5 Resolver + Path-Guard Contract
 */
import type { ConfinementReason } from './path.confinement';

export class PathConfinementError extends Error {
  constructor(
    public readonly reason: ConfinementReason,
    public readonly input: string
  ) {
    super(`path-confinement rejected: ${reason}`);
    this.name = 'PathConfinementError';
  }
}
