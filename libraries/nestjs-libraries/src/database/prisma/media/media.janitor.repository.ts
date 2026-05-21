import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

export type TxClient = Prisma.TransactionClient;

export interface SoftDeleteCandidate {
  id: string;
  path: string;
  organizationId: string;
  fileSize: number;
}

export interface ReferenceStatus {
  lastPublishedAt: Date | null;
  publishedCount: number;
  nonPublishedCount: number;
}

export type HardDeleteRowResult =
  | 'deleted'
  | 'resurrected-fk-relinked'
  | 'resurrected-nonpub-ref'
  | 'resurrected-no-pub-ref'
  | 'skipped-race';

export interface HardDeleteRowOutcome {
  mediaId: string;
  path: string;
  fileSize: number;
  organizationId: string;
  result: HardDeleteRowResult;
}

interface ReferenceStatusRow {
  lastPublishedAt: Date | null;
  publishedCount: number | bigint;
  nonPublishedCount: number | bigint;
}

interface CandidateRow {
  id: string;
  path: string;
  organizationId: string;
  fileSize: number;
}

interface HardDeleteLockRow {
  id: string;
  path: string;
  organizationId: string;
  fileSize: number;
  deletedAt: Date;
}

const toNumber = (v: number | bigint): number =>
  typeof v === 'bigint' ? Number(v) : v;

@Injectable()
export class MediaJanitorRepository {
  private readonly logger = new Logger(MediaJanitorRepository.name);

  constructor(private readonly _prisma: PrismaService) {}

  // Phase 1 read. Batched scan capped at batchSize. No txn — phase-2 re-check is
  // the authoritative gate (see hardDeleteBatch).
  //
  // Eligibility (plan §Eligibility predicate):
  //   m.deletedAt IS NULL
  //   AND NOT EXISTS (User u WHERE u.pictureId = m.id)
  //   AND NOT EXISTS (SocialMediaAgency a WHERE a.logoId = m.id)
  //   AND NOT EXISTS (non-PUBLISHED Post p WHERE p.deletedAt IS NULL AND p.image LIKE '%"m.id"%')
  //   AND EXISTS    (PUBLISHED      Post p WHERE p.deletedAt IS NULL AND p.image LIKE '%"m.id"%')
  //   AND MAX(p.publishDate) over the published set <= NOW() - ageDays * INTERVAL '1 day'
  async findSoftDeleteCandidates(opts: {
    ageDays: number;
    batchSize: number;
  }): Promise<SoftDeleteCandidate[]> {
    const ageDays = Math.trunc(opts.ageDays);
    const batchSize = Math.trunc(opts.batchSize);

    const rows = await this._prisma.$queryRaw<CandidateRow[]>`
      SELECT m."id", m."path", m."organizationId", m."fileSize"
      FROM "Media" m
      WHERE m."deletedAt" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "User" u WHERE u."pictureId" = m."id"
        )
        AND NOT EXISTS (
          SELECT 1 FROM "SocialMediaAgency" a WHERE a."logoId" = m."id"
        )
        AND NOT EXISTS (
          SELECT 1 FROM "Post" p
          WHERE p."deletedAt" IS NULL
            AND p."state" <> 'PUBLISHED'
            AND p."image" LIKE '%"' || m."id" || '"%'
        )
        AND EXISTS (
          SELECT 1 FROM "Post" p
          WHERE p."deletedAt" IS NULL
            AND p."state" = 'PUBLISHED'
            AND p."image" LIKE '%"' || m."id" || '"%'
        )
        AND (
          SELECT MAX(p."publishDate")
          FROM "Post" p
          WHERE p."deletedAt" IS NULL
            AND p."state" = 'PUBLISHED'
            AND p."image" LIKE '%"' || m."id" || '"%'
        ) <= NOW() - (${ageDays}::int * INTERVAL '1 day')
      ORDER BY m."createdAt" ASC
      LIMIT ${batchSize}::int
    `;

    return rows.map((r) => ({
      id: r.id,
      path: r.path,
      organizationId: r.organizationId,
      fileSize: r.fileSize,
    }));
  }

  // Phase 1 transition. Idempotent via `deletedAt IS NULL` filter.
  // SQL stamps deletedAt = NOW() - (ageDays * INTERVAL '1 day'), keeping the
  // entire cutoff topology in SQL (Invariant #3).
  async markSoftDeleted(opts: {
    ids: string[];
    ageDays: number;
  }): Promise<{ transitioned: number }> {
    if (opts.ids.length === 0) return { transitioned: 0 };
    const ageDays = Math.trunc(opts.ageDays);

    const transitioned = await this._prisma.$executeRaw`
      UPDATE "Media"
      SET "deletedAt" = NOW() - (${ageDays}::int * INTERVAL '1 day')
      WHERE "id" IN (${Prisma.join(opts.ids)})
        AND "deletedAt" IS NULL
    `;

    return { transitioned: toNumber(transitioned as unknown as number | bigint) };
  }

  // Phase 2. Self-discover candidates whose Media.deletedAt <= NOW() - graceDays,
  // then per row open a REPEATABLE READ txn:
  //   1) SELECT ... FOR UPDATE on Media row (race window guard)
  //   2) FK re-check (User.pictureId, SocialMediaAgency.logoId)
  //   3) Post-reference re-check via getReferenceStatus (intra-txn — SD5)
  //   4) DELETE or resurrectMedia
  //   5) COMMIT (or ROLLBACK if dryRun)
  // Unlinks DO NOT happen here — the service does post-commit unlinks.
  async hardDeleteBatch(opts: {
    graceDays: number;
    ageDays: number;
    batchSize: number;
    dryRun?: boolean;
  }): Promise<HardDeleteRowOutcome[]> {
    const graceDays = Math.trunc(opts.graceDays);
    const ageDays = Math.trunc(opts.ageDays);
    const batchSize = Math.trunc(opts.batchSize);
    const dryRun = opts.dryRun ?? false;

    // Hard-delete floor: Media.deletedAt <= NOW() - (graceDays + ageDays) * 1d.
    // Soft-delete pass stamped deletedAt = NOW() - ageDays * 1d at transition,
    // so total elapsed real time before hard-delete is (graceDays + ageDays).
    // Equivalent to: deletedAt <= NOW() - graceDays * 1d (since stamp is already
    // ageDays in the past). Use graceDays alone — matches the plan §Two-phase
    // state machine "deletedAt <= now-7d" condition.
    void ageDays;

    const candidates = await this._prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Media"
      WHERE "deletedAt" IS NOT NULL
        AND "deletedAt" <= NOW() - (${graceDays}::int * INTERVAL '1 day')
      ORDER BY "deletedAt" ASC
      LIMIT ${batchSize}::int
    `;

    const outcomes: HardDeleteRowOutcome[] = [];
    for (const { id } of candidates) {
      const outcome = await this.processHardDeleteRow(id, graceDays, dryRun);
      if (outcome) outcomes.push(outcome);
    }
    return outcomes;
  }

  private async processHardDeleteRow(
    mediaId: string,
    graceDays: number,
    dryRun: boolean,
  ): Promise<HardDeleteRowOutcome | null> {
    try {
      return await this._prisma.$transaction(
        async (tx) => {
          // Step 2: row-lock + re-assert cutoff inside the txn.
          const locked = await tx.$queryRaw<HardDeleteLockRow[]>`
            SELECT "id", "path", "organizationId", "fileSize", "deletedAt"
            FROM "Media"
            WHERE "id" = ${mediaId}
              AND "deletedAt" IS NOT NULL
              AND "deletedAt" <= NOW() - (${graceDays}::int * INTERVAL '1 day')
            FOR UPDATE
          `;

          if (locked.length === 0) {
            // skipped-race is a no-op — no mutations, no rollback needed.
            return {
              mediaId,
              path: '',
              fileSize: 0,
              organizationId: '',
              result: 'skipped-race' as HardDeleteRowResult,
            };
          }
          const row = locked[0];

          // Step 3: FK re-check inside txn.
          const [userRefs, agencyRefs] = await Promise.all([
            tx.user.count({ where: { pictureId: mediaId } }),
            tx.socialMediaAgency.count({ where: { logoId: mediaId } }),
          ]);

          let outcome: HardDeleteRowOutcome;

          if (userRefs > 0 || agencyRefs > 0) {
            await this.resurrectMedia(tx, mediaId);
            outcome = {
              mediaId,
              path: row.path,
              fileSize: row.fileSize,
              organizationId: row.organizationId,
              result: 'resurrected-fk-relinked',
            };
          } else {
            // Step 4: post-reference re-check via conditional-aggregate SQL.
            const refs = await this.getReferenceStatus(tx, mediaId);

            if (refs.nonPublishedCount > 0) {
              await this.resurrectMedia(tx, mediaId);
              outcome = {
                mediaId,
                path: row.path,
                fileSize: row.fileSize,
                organizationId: row.organizationId,
                result: 'resurrected-nonpub-ref',
              };
            } else if (refs.publishedCount === 0) {
              await this.resurrectMedia(tx, mediaId);
              outcome = {
                mediaId,
                path: row.path,
                fileSize: row.fileSize,
                organizationId: row.organizationId,
                result: 'resurrected-no-pub-ref',
              };
            } else {
              await tx.$executeRaw`DELETE FROM "Media" WHERE "id" = ${mediaId}`;
              outcome = {
                mediaId,
                path: row.path,
                fileSize: row.fileSize,
                organizationId: row.organizationId,
                result: 'deleted',
              };
            }
          }

          if (dryRun) throw new DryRunRollback(outcome);
          return outcome;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    } catch (err) {
      if (err instanceof DryRunRollback) {
        return err.outcome;
      }
      this.logger.warn(
        `media-janitor.hard-delete.tx-error mediaId=${mediaId} err=${
          (err as Error).message
        }`,
      );
      return null;
    }
  }

  // Canonical eligibility (plan §Canonical eligibility SQL).
  // Intra-txn variant: caller passes the live tx client (SD5).
  async getReferenceStatus(
    tx: TxClient,
    mediaId: string,
  ): Promise<ReferenceStatus> {
    const rows = await tx.$queryRaw<ReferenceStatusRow[]>`
      SELECT
        MAX(p."publishDate") FILTER (WHERE p."state" = 'PUBLISHED') AS "lastPublishedAt",
        COUNT(*) FILTER (WHERE p."state" = 'PUBLISHED')::int        AS "publishedCount",
        COUNT(*) FILTER (WHERE p."state" <> 'PUBLISHED')::int       AS "nonPublishedCount"
      FROM "Post" p
      WHERE p."deletedAt" IS NULL
        AND p."image" LIKE '%"' || ${mediaId} || '"%'
    `;

    const r = rows[0];
    return {
      lastPublishedAt: r?.lastPublishedAt ?? null,
      publishedCount: r ? toNumber(r.publishedCount) : 0,
      nonPublishedCount: r ? toNumber(r.nonPublishedCount) : 0,
    };
  }

  // RESURRECT: phase-2 re-check failure → restore Media.deletedAt to NULL.
  // NEVER use DELETE on re-check failure (Invariant #9).
  async resurrectMedia(tx: TxClient, id: string): Promise<void> {
    await tx.$executeRaw`UPDATE "Media" SET "deletedAt" = NULL WHERE "id" = ${id}`;
    this.logger.warn(`media-janitor.resurrect mediaId=${id}`);
  }
}

// Sentinel exception used to ROLLBACK a dryRun txn while still propagating the
// in-memory outcome out of the closure. Prisma rolls back when the interactive
// transaction callback throws.
class DryRunRollback extends Error {
  constructor(public readonly outcome: HardDeleteRowOutcome) {
    super('media-janitor.dry-run-rollback');
  }
}
