/**
 * libraries/nestjs-libraries/src/database/prisma/media/media.janitor.service.ts
 *
 * Orchestrates the two-phase media-asset janitor:
 *   Phase 1 (soft-delete):  scan eligible rows -> UPDATE Media SET deletedAt
 *   Phase 2 (hard-delete):  per-row REPEATABLE READ txn -> DELETE or RESURRECT
 *                           -> post-commit unlink (via IUploadProvider)
 *
 * Owns observability (structured one-line JSON logs), error containment
 * (per-row exceptions never abort the pass), and the path-confinement
 * decision flow (resolver pre-flight + LocalStorage authoritative gate).
 *
 * Time inputs are integer day-counts only - the repository builds eligibility
 * cutoffs in SQL via `NOW() - ($1::int * INTERVAL '1 day')` so no JS-computed
 * Date ever crosses the JS->SQL boundary (invariant #3).
 *
 * DryRun semantics:
 *   - Phase 1: log "would soft-delete" counts; skip the UPDATE entirely.
 *   - Phase 2: repository opens the txn and ROLLBACKs; service issues NO
 *              unlinks regardless of repository outcomes.
 *
 * Used by:
 *   - apps/cron/src/tasks/media.janitor.ts (the @Cron task entrypoint)
 *
 * See: docs/architecture/media-janitor.md §4 Service Contract
 *      docs/plans/media-janitor-plan.md §Two-phase state machine, §Observability
 */
import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import {
  HardDeleteRowOutcome,
  MediaJanitorRepository,
} from './media.janitor.repository';
import { MediaPathResolver } from '@gitroom/nestjs-libraries/upload/media.path.resolver';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { IUploadProvider } from '@gitroom/nestjs-libraries/upload/upload.interface';
import { PathConfinementError } from '@gitroom/nestjs-libraries/upload/path.confinement.error';

export interface JanitorRunOptions {
  runId: string;
  dryRun: boolean;
  ageDays: number;
  graceDays: number;
  batchSize: number;
  wallClockBudgetMs?: number;
}

export interface SoftPhaseSummary {
  scanned: number;
  eligible: number;
  transitioned: number;
  errors: number;
  bytesReclaimedEstimate: number;
}

export interface HardPhaseSummary {
  scanned: number;
  candidates: number;
  hardDeleted: number;
  resurrected: number;
  pathRejected: number;
  unlinkErrors: number;
  bytesReclaimed: number;
}

@Injectable()
export class MediaJanitorService {
  private readonly logger = new Logger(MediaJanitorService.name);
  private _uploadProvider: IUploadProvider | undefined;

  constructor(
    private readonly _repository: MediaJanitorRepository,
    private readonly _resolver: MediaPathResolver
  ) {}

  // Lazy-initialised to preserve invariant #6 (janitor must be INERT when
  // STORAGE_PROVIDER !== 'local'). Constructing the upload provider eagerly
  // would instantiate a cloud client (e.g. S3Client) at cron-boot time even
  // when the janitor's preflight guards never run a delete.
  private get uploadProvider(): IUploadProvider {
    if (!this._uploadProvider) {
      this._uploadProvider = UploadFactory.createStorage();
    }
    return this._uploadProvider;
  }

  /**
   * Phase 1: find soft-delete candidates and (unless dryRun) transition them
   * by setting Media.deletedAt. Per-row errors are counted and logged but
   * never rethrown - a bad row must not abort the whole pass.
   */
  async runSoftDeletePhase(
    opts: JanitorRunOptions
  ): Promise<SoftPhaseSummary> {
    const summary: SoftPhaseSummary = {
      scanned: 0,
      eligible: 0,
      transitioned: 0,
      errors: 0,
      bytesReclaimedEstimate: 0,
    };

    let candidates;
    try {
      candidates = await this._repository.findSoftDeleteCandidates({
        ageDays: opts.ageDays,
        batchSize: opts.batchSize,
      });
    } catch (err) {
      // Phase-level failure (DB unreachable etc) - rethrow; Sentry catches
      // via the CronModule's existing @sentry/nestjs wiring.
      this.logger.error({
        evt: 'media-janitor.soft.fatal',
        runId: opts.runId,
        error: (err as Error).message,
      });
      throw err;
    }

    summary.scanned = candidates.length;
    summary.eligible = candidates.length;
    summary.bytesReclaimedEstimate = candidates.reduce(
      (acc, c) => acc + (c.fileSize ?? 0),
      0
    );

    if (opts.dryRun) {
      this.logger.log({
        evt: 'media-janitor.soft.dryrun',
        runId: opts.runId,
        wouldTransition: candidates.length,
        bytesReclaimedEstimate: summary.bytesReclaimedEstimate,
      });
      this.logger.log({
        evt: 'media-janitor.soft.summary',
        runId: opts.runId,
        ...summary,
      });
      return summary;
    }

    if (candidates.length === 0) {
      this.logger.log({
        evt: 'media-janitor.soft.summary',
        runId: opts.runId,
        ...summary,
      });
      return summary;
    }

    try {
      const { transitioned } = await this._repository.markSoftDeleted({
        ids: candidates.map((c) => c.id),
        ageDays: opts.ageDays,
      });
      summary.transitioned = transitioned;
    } catch (err) {
      summary.errors = candidates.length;
      this.logger.error({
        evt: 'media-janitor.soft.error',
        runId: opts.runId,
        error: (err as Error).message,
      });
    }

    this.logger.log({
      evt: 'media-janitor.soft.summary',
      runId: opts.runId,
      ...summary,
    });
    return summary;
  }

  /**
   * Phase 2: delegate to repository for the per-row REPEATABLE READ txn
   * (which performs SELECT FOR UPDATE, intra-txn re-check, and either DELETE
   * or RESURRECT). Then for each `result === 'deleted'` outcome, run the
   * resolver and (on `{kind:'local'}`) call IUploadProvider.removeFile.
   *
   * Unlinks happen POST-COMMIT only. DryRun skips unlinks entirely; the
   * repository ROLLBACKs internally.
   */
  async runHardDeletePhase(
    opts: JanitorRunOptions
  ): Promise<HardPhaseSummary> {
    const summary: HardPhaseSummary = {
      scanned: 0,
      candidates: 0,
      hardDeleted: 0,
      resurrected: 0,
      pathRejected: 0,
      unlinkErrors: 0,
      bytesReclaimed: 0,
    };

    let outcomes: HardDeleteRowOutcome[];
    try {
      outcomes = await this._repository.hardDeleteBatch({
        ageDays: opts.ageDays,
        graceDays: opts.graceDays,
        batchSize: opts.batchSize,
        dryRun: opts.dryRun,
      });
    } catch (err) {
      this.logger.error({
        evt: 'media-janitor.hard.fatal',
        runId: opts.runId,
        error: (err as Error).message,
      });
      throw err;
    }

    summary.scanned = outcomes.length;
    summary.candidates = outcomes.length;

    for (const outcome of outcomes) {
      try {
        await this.handleOutcome(outcome, opts, summary);
      } catch (err) {
        // Per-row containment - never rethrow.
        this.logger.warn({
          evt: 'media-janitor.hard.row-error',
          runId: opts.runId,
          mediaId: outcome.mediaId,
          error: (err as Error).message,
        });
      }
    }

    this.logger.log({
      evt: 'media-janitor.hard.summary',
      runId: opts.runId,
      dryRun: opts.dryRun,
      ...summary,
    });
    return summary;
  }

  private async handleOutcome(
    outcome: HardDeleteRowOutcome,
    opts: JanitorRunOptions,
    summary: HardPhaseSummary
  ): Promise<void> {
    switch (outcome.result) {
      case 'resurrected-fk-relinked':
      case 'resurrected-nonpub-ref':
      case 'resurrected-no-pub-ref':
        summary.resurrected += 1;
        this.logger.warn({
          evt: 'media-janitor.resurrect',
          runId: opts.runId,
          mediaId: outcome.mediaId,
          reason: outcome.result,
        });
        return;

      case 'skipped-race':
        this.logger.log({
          evt: 'media-janitor.skipped-race',
          runId: opts.runId,
          mediaId: outcome.mediaId,
        });
        return;

      case 'deleted':
        summary.hardDeleted += 1;
        summary.bytesReclaimed += outcome.fileSize ?? 0;
        if (opts.dryRun) {
          // Repository ROLLBACKed; do not unlink.
          return;
        }
        await this.attemptUnlink(outcome, opts, summary);
        return;

      default: {
        // Narrow on the discriminant MEMBER (`outcome.result`), not the parent
        // object. `HardDeleteRowOutcome` is a flat interface whose `result`
        // field is a string-literal union (HardDeleteRowResult); TypeScript
        // narrows the member inside switch cases but does NOT narrow the
        // parent object (that would require a discriminated-union-of-objects
        // shape like `{result:'deleted';...} | {result:'skipped-race';...}`).
        // So `const _exhaustive: never = outcome` fails TS2322 (outcome is
        // still HardDeleteRowOutcome, not never), but `= outcome.result`
        // succeeds because all 5 string-literal cases have been matched. The
        // exhaustiveness guarantee is preserved: adding a new variant to
        // HardDeleteRowResult will still flag here. (Conceptually distinct
        // from the loose-`!discriminant` family — this is a type-shape issue
        // that would fail under strict mode too.)
        const _exhaustive: never = outcome.result;
        throw new Error(
          `Unknown HardDeleteRowResult variant: ${JSON.stringify(_exhaustive)}`
        );
      }
    }
  }

  private async attemptUnlink(
    outcome: HardDeleteRowOutcome,
    opts: JanitorRunOptions,
    summary: HardPhaseSummary
  ): Promise<void> {
    const resolved = await this._resolver.resolveForDelete(outcome.path, {
      runId: opts.runId,
      mediaId: outcome.mediaId,
    });

    if (resolved.kind === 'remote') {
      this.logger.log({
        evt: 'media-janitor.unlink.skipped-remote',
        runId: opts.runId,
        mediaId: outcome.mediaId,
      });
      return;
    }

    if (resolved.kind === 'rejected') {
      summary.pathRejected += 1;
      // path-reject events are Sentry-captured per plan §Observability.
      Sentry.captureMessage('media-janitor.path-reject', {
        level: 'error',
        tags: { evt: 'media-janitor.path-reject', runId: opts.runId },
        extra: {
          mediaId: outcome.mediaId,
          reason: resolved.reason,
        },
      });
      this.logger.error({
        evt: 'media-janitor.path-reject',
        runId: opts.runId,
        mediaId: outcome.mediaId,
        reason: resolved.reason,
      });
      return;
    }

    // resolved.kind === 'local'
    try {
      await this.uploadProvider.removeFile(resolved.absolutePath);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e && e.code === 'ENOENT') {
        this.logger.log({
          evt: 'media-janitor.unlink.enoent',
          runId: opts.runId,
          mediaId: outcome.mediaId,
        });
        return;
      }

      if (err instanceof PathConfinementError) {
        // Layer-2 caught something the resolver missed. Treat as path-reject,
        // Sentry-capture.
        summary.pathRejected += 1;
        Sentry.captureMessage('media-janitor.path-reject', {
          level: 'error',
          tags: { evt: 'media-janitor.path-reject', runId: opts.runId },
          extra: {
            mediaId: outcome.mediaId,
            reason: err.reason,
            layer: 'local-storage-removeFile',
          },
        });
        this.logger.error({
          evt: 'media-janitor.path-reject',
          runId: opts.runId,
          mediaId: outcome.mediaId,
          reason: err.reason,
          layer: 'local-storage-removeFile',
        });
        return;
      }

      summary.unlinkErrors += 1;
      this.logger.warn({
        evt: 'media-janitor.unlink.failed',
        runId: opts.runId,
        mediaId: outcome.mediaId,
        error: e.code ?? (err as Error).message,
      });
    }
  }
}
