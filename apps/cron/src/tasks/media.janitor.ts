/**
 * apps/cron/src/tasks/media.janitor.ts
 *
 * Cron entry-point for the media-asset janitor. Owns:
 *   - Env-gating (MEDIA_JANITOR_ENABLED, STORAGE_PROVIDER)
 *   - Boot-time guards (UPLOAD_DIRECTORY, FRONTEND_URL, root sanity-check)
 *   - runId minting via ClockService
 *   - Delegating Phase 1 + Phase 2 to MediaJanitorService
 *
 * The task is INERT (zero side-effects, including no DB reads) when:
 *   - MEDIA_JANITOR_ENABLED !== 'true'
 *   - STORAGE_PROVIDER !== 'local'  (invariant #6)
 *   - UPLOAD_DIRECTORY unset or non-absolute
 *   - FRONTEND_URL unset (resolver cannot classify)
 *   - UPLOAD_DIRECTORY matches a dangerous root (/, /tmp, /etc) (SR-5)
 *
 * No `new Date()` / `Date.now()` may appear in this file (invariant #2)
 * - ESLint enforces this. Read time exclusively through ClockService.
 *
 * Used by:
 *   - apps/cron/src/cron.module.ts (registered as a provider)
 *
 * See: docs/architecture/media-janitor.md §7 Env-var Surface
 *      docs/plans/media-janitor-plan.md §Env-var surface, §Implementation Sequence
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { promises as fsp } from 'fs';
import path from 'path';
import { ClockService } from '@gitroom/nestjs-libraries/services/clock.service';
import {
  JanitorRunOptions,
  MediaJanitorService,
} from '@gitroom/nestjs-libraries/database/prisma/media/media.janitor.service';

const DEFAULT_CRON = '0 3 * * *';
const DEFAULT_AGE_DAYS = 7;
const DEFAULT_GRACE_DAYS = 7;
const DEFAULT_BATCH_SIZE = 100;
const ROOT_SANITY_TIMEOUT_MS = 30_000;

// Roots refused by the SR-5 startup sanity-check. The volume mount should be
// a dedicated path like `/data/uploads`, not a system directory.
const FORBIDDEN_ROOTS = new Set([
  '/',
  '/tmp',
  '/etc',
  '/var',
  '/usr',
  '/bin',
  '/sbin',
  '/root',
  '/home',
  '/dev',
  '/proc',
  '/sys',
]);

@Injectable()
export class MediaJanitor {
  private readonly logger = new Logger(MediaJanitor.name);

  // The cron expression is evaluated by @nestjs/schedule at module init time
  // from process.env, falling back to the default daily 03:00 UTC slot.
  // The job is still env-gated INSIDE handleCron (defense-in-depth).
  constructor(
    private readonly _service: MediaJanitorService,
    private readonly _clock: ClockService
  ) {}

  @Cron(process.env.MEDIA_JANITOR_CRON || DEFAULT_CRON)
  async handleCron(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }
    if (!this.passesGuards()) {
      // Guard failures already logged inside passesGuards.
      return;
    }

    const rootOk = await this.checkRootSanity();
    if (!rootOk) {
      return;
    }

    const opts = this.buildOptions();

    this.logger.log({
      evt: 'media-janitor.run.start',
      runId: opts.runId,
      dryRun: opts.dryRun,
      ageDays: opts.ageDays,
      graceDays: opts.graceDays,
      batchSize: opts.batchSize,
    });

    const startedAt = this._clock.nowMs();
    let errorCount = 0;

    try {
      await this._service.runSoftDeletePhase(opts);
    } catch (err) {
      errorCount += 1;
      this.logger.error({
        evt: 'media-janitor.soft.aborted',
        runId: opts.runId,
        error: (err as Error).message,
      });
    }

    try {
      await this._service.runHardDeletePhase(opts);
    } catch (err) {
      errorCount += 1;
      this.logger.error({
        evt: 'media-janitor.hard.aborted',
        runId: opts.runId,
        error: (err as Error).message,
      });
    }

    this.logger.log({
      evt: 'media-janitor.run.end',
      runId: opts.runId,
      durationMs: this._clock.nowMs() - startedAt,
      errorCount,
    });
  }

  private isEnabled(): boolean {
    return process.env.MEDIA_JANITOR_ENABLED === 'true';
  }

  /**
   * Boot-time env validation. Force-disable + log on misconfig (architect §7).
   * Returns true only when ALL guards pass.
   */
  private passesGuards(): boolean {
    const storageProvider = process.env.STORAGE_PROVIDER || 'local';
    if (storageProvider !== 'local') {
      this.logger.warn({
        evt: 'media-janitor.disabled',
        reason: 'storage_provider_not_local',
        storageProvider,
      });
      return false;
    }

    const uploadDirectory = process.env.UPLOAD_DIRECTORY;
    if (!uploadDirectory || !path.isAbsolute(uploadDirectory)) {
      this.logger.error({
        evt: 'media-janitor.disabled',
        reason: 'upload_directory_invalid',
        uploadDirectory: uploadDirectory ?? null,
      });
      return false;
    }

    if (!process.env.FRONTEND_URL) {
      this.logger.error({
        evt: 'media-janitor.disabled',
        reason: 'frontend_url_unset',
      });
      return false;
    }

    return true;
  }

  /**
   * SR-5: refuse to operate against a dangerous root (/, /tmp, /etc, ...).
   * Wrapped in Promise.race + try/catch with an orphaned-promise .catch so a
   * hung filesystem cannot stall the cron tick beyond the timeout budget
   * (secretary memory 593b51a0).
   */
  private async checkRootSanity(): Promise<boolean> {
    const uploadDirectory = process.env.UPLOAD_DIRECTORY as string;
    const normalized = path.resolve(uploadDirectory);

    if (FORBIDDEN_ROOTS.has(normalized)) {
      this.logger.error({
        evt: 'media-janitor.disabled',
        reason: 'forbidden_root',
        uploadDirectory: normalized,
      });
      return false;
    }

    const probe = (async () => {
      const stat = await fsp.stat(normalized);
      if (!stat.isDirectory()) {
        throw new Error('upload_directory_not_directory');
      }
    })();

    const timeout = new Promise<never>((_, reject) => {
      const t = setTimeout(() => {
        reject(new Error('upload_directory_probe_timeout'));
      }, ROOT_SANITY_TIMEOUT_MS);
      // Unref so the timer never holds the event loop open beyond the race.
      if (typeof (t as { unref?: () => void }).unref === 'function') {
        (t as { unref: () => void }).unref();
      }
    });

    // Orphaned-promise .catch on the loser of Promise.race so an unhandled
    // rejection cannot bubble after the race resolves.
    probe.catch(() => undefined);

    try {
      await Promise.race([probe, timeout]);
      return true;
    } catch (err) {
      this.logger.error({
        evt: 'media-janitor.disabled',
        reason: 'upload_directory_unverifiable',
        error: (err as Error).message,
      });
      return false;
    }
  }

  private buildOptions(): JanitorRunOptions {
    const now = this._clock.now();
    return {
      runId: this.mintRunId(now),
      dryRun: process.env.MEDIA_JANITOR_DRY_RUN !== 'false',
      ageDays: parsePositiveInt(
        process.env.MEDIA_JANITOR_AGE_DAYS,
        DEFAULT_AGE_DAYS
      ),
      graceDays: parsePositiveInt(
        process.env.MEDIA_JANITOR_GRACE_DAYS,
        DEFAULT_GRACE_DAYS
      ),
      batchSize: parsePositiveInt(
        process.env.MEDIA_JANITOR_BATCH_SIZE,
        DEFAULT_BATCH_SIZE
      ),
    };
  }

  private mintRunId(now: Date): string {
    const iso = now.toISOString();
    // 6 hex chars from clock-derived ms (no Math.random in janitor code;
    // pseudo-randomness is fine for correlation IDs and avoids an extra
    // injected dependency).
    const ms = this._clock.nowMs();
    const suffix = (ms & 0xffffff).toString(16).padStart(6, '0');
    return `mj-${iso}-${suffix}`;
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}
