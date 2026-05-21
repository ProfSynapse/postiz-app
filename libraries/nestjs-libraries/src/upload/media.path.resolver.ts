/**
 * libraries/nestjs-libraries/src/upload/media.path.resolver.ts
 *
 * Pre-flight Media.path classifier for the media-janitor. Wraps
 * `confineAndVerify` and adds the modern-URL vs legacy-relative vs remote
 * shape classification. Returns a discriminated union; NEVER throws.
 *
 * The janitor service calls `resolveForDelete` for each row that the
 * repository returned for hard-delete. On `{kind:'local'}` the service hands
 * the verified absolute path to `IUploadProvider.removeFile`. On `remote`
 * the row is already gone (post-commit) and no syscall is issued. On
 * `rejected` the service logs `media-janitor.path-reject` (Sentry-captured)
 * and skips the unlink - the row stays deleted.
 *
 * Classification order is LOAD-BEARING (plan §Path-confinement contract):
 *   1. modern URL: startsWith(`${FRONTEND_URL}/uploads/`)
 *   2. legacy relative: /^\/\d{4}\/\d{2}\/\d{2}\//
 *   3. remote http(s): /^https?:\/\//
 *   4. else: rejected('unknown_shape')
 *
 * House style: this resolver matches `upload.factory.ts` and reads
 * `process.env` directly rather than going through @nestjs/config (no Nest
 * config infrastructure exists in this codebase for these vars).
 *
 * Used by:
 *   - libraries/nestjs-libraries/src/database/prisma/media/media.janitor.service.ts
 *
 * Registered as a provider in CronModule (apps/cron/src/cron.module.ts).
 * Future refactor to UploadModule (@Global) is tracked as F-resolver-placement.
 *
 * See: docs/architecture/media-janitor.md §5 Resolver + Path-Guard Contract
 *      docs/plans/media-janitor-plan.md §Three in-the-wild Media.path shapes
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  ConfinementReason,
  confineAndVerify,
} from './path.confinement';

export type ResolverContext = { runId: string; mediaId: string };

export type ResolveResult =
  | { kind: 'local'; absolutePath: string }
  | { kind: 'remote'; reason: 'http_scheme'; url: string }
  | { kind: 'rejected'; reason: ConfinementReason | 'unknown_shape' };

const LEGACY_RELATIVE_SHAPE = /^\/\d{4}\/\d{2}\/\d{2}\//;
const HTTP_PREFIX = /^https?:\/\//i;

@Injectable()
export class MediaPathResolver {
  private readonly logger = new Logger(MediaPathResolver.name);

  /**
   * Classify and (if local) confine the given Media.path. Returns a
   * discriminated union; callers branch on `.kind`. Never throws.
   *
   * @param mediaPath Raw Media.path value (untrusted).
   * @param ctx       Run/media correlation for structured logs.
   */
  async resolveForDelete(
    mediaPath: string,
    ctx: ResolverContext
  ): Promise<ResolveResult> {
    if (typeof mediaPath !== 'string' || mediaPath.length === 0) {
      this.logger.warn({
        evt: 'media-janitor.path-reject',
        runId: ctx.runId,
        mediaId: ctx.mediaId,
        reason: 'unknown_shape',
      });
      return { kind: 'rejected', reason: 'unknown_shape' };
    }

    const frontendUrl = process.env.FRONTEND_URL ?? '';
    const uploadRoot = process.env.UPLOAD_DIRECTORY ?? '';
    const modernPrefix =
      frontendUrl.length > 0 ? `${frontendUrl}/uploads/` : null;

    // Classification step 3: explicit remote shape that is NOT our frontend.
    // Run this check BEFORE legacy-relative so http(s) URLs route remote.
    const isModern =
      modernPrefix !== null && mediaPath.startsWith(modernPrefix);
    const isLegacyRelative = LEGACY_RELATIVE_SHAPE.test(mediaPath);

    if (!isModern && !isLegacyRelative && HTTP_PREFIX.test(mediaPath)) {
      // Remote http(s) URL - no syscall, row-delete only.
      return { kind: 'remote', reason: 'http_scheme', url: mediaPath };
    }

    if (!isModern && !isLegacyRelative) {
      this.logger.warn({
        evt: 'media-janitor.path-reject',
        runId: ctx.runId,
        mediaId: ctx.mediaId,
        reason: 'unknown_shape',
      });
      return { kind: 'rejected', reason: 'unknown_shape' };
    }

    if (uploadRoot.length === 0) {
      // Boot-time guards in MediaJanitor.handleCron force-disable the job
      // when UPLOAD_DIRECTORY is unset, so this is defense-in-depth.
      this.logger.error({
        evt: 'media-janitor.path-reject',
        runId: ctx.runId,
        mediaId: ctx.mediaId,
        reason: 'realpath_failed',
        detail: 'UPLOAD_DIRECTORY unset',
      });
      return { kind: 'rejected', reason: 'realpath_failed' };
    }

    const result = await confineAndVerify(mediaPath, uploadRoot);
    // Use explicit discriminant-equality (`=== false`) rather than the `!`
    // unary-negation form so TypeScript narrows the union correctly even
    // under tsconfig.base.json's `strictNullChecks: false`. With loose null
    // checks, `!result.ok` is treated as a generic falsiness test that does
    // not propagate the discriminant, so `result.reason` is unresolved on
    // the resulting union (TS2339). The `=== false` form is unambiguously a
    // discriminant check and narrows under both strict and loose modes.
    // (Same fix pattern as local.storage.ts:96; shared root cause is the
    // loose-narrowing-of-`!discriminant` family tracked under F8.)
    if (result.ok === false) {
      this.logger.warn({
        evt: 'media-janitor.path-reject',
        runId: ctx.runId,
        mediaId: ctx.mediaId,
        reason: result.reason,
      });
      return { kind: 'rejected', reason: result.reason };
    }

    return { kind: 'local', absolutePath: result.absolutePath };
  }
}
