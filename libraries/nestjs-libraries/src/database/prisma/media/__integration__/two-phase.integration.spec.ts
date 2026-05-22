// two-phase.integration.spec.ts
//
// End-to-end coverage of the repository two-phase state machine against a
// real Postgres (plan §Two-phase state machine, invariants #4 / #5 / #9 / #10).
//
// Sub-suites:
//   - state-transitions  (NULL → soft-deleted → hard-deleted)
//   - idempotency        (re-run safe at every state)
//   - dry-run-default    (txn ROLLBACKs; no row mutation)
//   - resurrection-rc1..6 (TOCTOU races yielding fk-relinked / nonpub-ref /
//                         no-pub-ref outcomes — counter-test-by-revert on RC-1)
//   - scenario-W         (FakeClock equivalence: graceDays-alone == graceDays
//                         + ageDays for the hard-delete cutoff). Auditor YELLOW.
import { PrismaClient } from '@prisma/client';
import { MediaJanitorRepository } from '../media.janitor.repository';
import { PrismaService } from '../../prisma.service';
import {
  describeIfDb,
  disconnectIntegrationContext,
} from './setup';
import {
  truncateMediaScope,
  mediaFactory,
  postFactory,
  seedScenario,
} from './seed.helpers';

const DAY_MS = 24 * 60 * 60 * 1000;

describeIfDb('MediaJanitorRepository two-phase state machine (integration)', (prisma) => {
  const repository = new MediaJanitorRepository(
    prisma as unknown as PrismaService
  );

  beforeEach(async () => {
    await truncateMediaScope(prisma);
  });

  afterAll(async () => {
    await disconnectIntegrationContext();
  });

  describe('state-transitions', () => {
    it('NULL → soft-deleted → hard-deleted progression', async () => {
      const mediaId = await seedScenario(prisma, 'old-publish-eligible');

      // Phase 1
      const candidates = await repository.findSoftDeleteCandidates({
        ageDays: 7,
        batchSize: 100,
      });
      expect(candidates.map((c) => c.id)).toContain(mediaId);

      const { transitioned } = await repository.markSoftDeleted({
        ids: [mediaId],
        ageDays: 7,
      });
      expect(transitioned).toBe(1);

      const softDeleted = await prisma.media.findUnique({
        where: { id: mediaId },
      });
      expect(softDeleted?.deletedAt).not.toBeNull();
      // Stamp must be in the past by at least ageDays * 1d.
      const stampMs = softDeleted!.deletedAt!.getTime();
      expect(Date.now() - stampMs).toBeGreaterThanOrEqual(7 * DAY_MS - 1000);

      // Phase 2 — graceDays=0 so the hard-delete floor is met immediately.
      const outcomes = await repository.hardDeleteBatch({
        ageDays: 7,
        graceDays: 0,
        batchSize: 100,
      });
      expect(outcomes.map((o) => o.result)).toContain('deleted');

      const gone = await prisma.media.findUnique({ where: { id: mediaId } });
      expect(gone).toBeNull();
    });
  });

  describe('idempotency (invariant #5)', () => {
    it('markSoftDeleted is a no-op when called twice (deletedAt IS NULL filter)', async () => {
      const mediaId = await seedScenario(prisma, 'old-publish-eligible');
      const first = await repository.markSoftDeleted({
        ids: [mediaId],
        ageDays: 7,
      });
      expect(first.transitioned).toBe(1);
      const second = await repository.markSoftDeleted({
        ids: [mediaId],
        ageDays: 7,
      });
      expect(second.transitioned).toBe(0);
    });

    it('hardDeleteBatch on an empty candidate set returns []', async () => {
      const outcomes = await repository.hardDeleteBatch({
        ageDays: 7,
        graceDays: 7,
        batchSize: 100,
      });
      expect(outcomes).toEqual([]);
    });

    it('hardDeleteBatch on a row that is no longer present (concurrent delete) → skipped-race no-op', async () => {
      const mediaId = await seedScenario(
        prisma,
        'already-soft-deleted-grace-expired'
      );
      // Race: another process deletes the row between candidate-discovery
      // and FOR UPDATE.
      await prisma.media.delete({ where: { id: mediaId } });
      const outcomes = await repository.hardDeleteBatch({
        ageDays: 7,
        graceDays: 7,
        batchSize: 100,
      });
      // Row is gone → not a candidate.
      expect(outcomes.find((o) => o.mediaId === mediaId)).toBeUndefined();
    });
  });

  describe('markSoftDeleted FK re-check (security-engineer S-MINOR-1 / M-toctou-fk-recheck)', () => {
    it('User.pictureId set between candidate selection and UPDATE → row is SKIPPED (transitioned=0, deletedAt stays NULL)', async () => {
      // Simulate the TOCTOU window: candidate enumeration ran with the row
      // unreferenced, then a User.pictureId was set before the UPDATE fires.
      // Without the FK NOT EXISTS predicate, markSoftDeleted would stamp
      // deletedAt and the User's profile picture would render as missing for
      // up to graceDays. With the predicate, the UPDATE matches 0 rows.
      const mediaId = await seedScenario(prisma, 'old-publish-eligible');
      await prisma.user.create({
        data: {
          email: `fk-mid-window-${mediaId}@example.test`,
          pictureId: mediaId,
          providerName: 'LOCAL',
          name: 'Test',
          timezone: 0,
        },
      });

      const { transitioned } = await repository.markSoftDeleted({
        ids: [mediaId],
        ageDays: 7,
      });
      expect(transitioned).toBe(0);

      const stillLive = await prisma.media.findUnique({ where: { id: mediaId } });
      expect(stillLive?.deletedAt).toBeNull();
    });

    it('SocialMediaAgency.logoId set between candidate selection and UPDATE → row is SKIPPED', async () => {
      const mediaId = await seedScenario(prisma, 'old-publish-eligible');
      const media = await prisma.media.findUnique({ where: { id: mediaId } });
      // Create an agency whose user/owner already exists for the seeded media's
      // organization; logoId points at our candidate.
      const owner = await prisma.user.create({
        data: {
          email: `agency-owner-${mediaId}@example.test`,
          providerName: 'LOCAL',
          name: 'Agency Owner',
          timezone: 0,
        },
      });
      await prisma.socialMediaAgency.create({
        data: {
          userId: owner.id,
          name: 'Test Agency',
          shortDescription: 'short',
          description: 'desc',
          logoId: media!.id,
        },
      });

      const { transitioned } = await repository.markSoftDeleted({
        ids: [mediaId],
        ageDays: 7,
      });
      expect(transitioned).toBe(0);

      const stillLive = await prisma.media.findUnique({ where: { id: mediaId } });
      expect(stillLive?.deletedAt).toBeNull();
    });
  });

  describe('dry-run-default (invariant #4 dry-run leg)', () => {
    it('hardDeleteBatch({dryRun:true}) returns "deleted" outcome but ROLLBACKs the txn', async () => {
      const mediaId = await seedScenario(
        prisma,
        'already-soft-deleted-grace-expired'
      );
      const outcomes = await repository.hardDeleteBatch({
        ageDays: 7,
        graceDays: 7,
        batchSize: 100,
        dryRun: true,
      });
      expect(outcomes.find((o) => o.mediaId === mediaId)?.result).toBe(
        'deleted'
      );

      // Row MUST still exist with deletedAt set — the dryRun did NOT commit
      // the DELETE.
      const stillThere = await prisma.media.findUnique({
        where: { id: mediaId },
      });
      expect(stillThere).not.toBeNull();
      expect(stillThere?.deletedAt).not.toBeNull();
    });
  });

  describe('resurrection (invariant #9 — counter-test-by-revert on RC-1)', () => {
    it('RC-1 / scenario-Y: new DRAFT inserted mid-grace → resurrected-nonpub-ref', async () => {
      const mediaId = await seedScenario(
        prisma,
        'scenario-y-grace-plus-new-draft'
      );
      const outcomes = await repository.hardDeleteBatch({
        ageDays: 7,
        graceDays: 7,
        batchSize: 100,
      });
      const outcome = outcomes.find((o) => o.mediaId === mediaId);
      expect(outcome?.result).toBe('resurrected-nonpub-ref');

      // Resurrected: deletedAt MUST be NULL again. NEVER deleted.
      const restored = await prisma.media.findUnique({
        where: { id: mediaId },
      });
      expect(restored).not.toBeNull();
      expect(restored?.deletedAt).toBeNull();
    });

    it('RC-2 / scenario-Z: sole PUBLISHED deleted mid-grace → resurrected-no-pub-ref', async () => {
      const mediaId = await seedScenario(
        prisma,
        'scenario-z-grace-plus-deleted-published'
      );
      const outcomes = await repository.hardDeleteBatch({
        ageDays: 7,
        graceDays: 7,
        batchSize: 100,
      });
      const outcome = outcomes.find((o) => o.mediaId === mediaId);
      expect(outcome?.result).toBe('resurrected-no-pub-ref');

      const restored = await prisma.media.findUnique({
        where: { id: mediaId },
      });
      expect(restored?.deletedAt).toBeNull();
    });

    it('RC-3: FK relink via User.pictureId mid-grace → resurrected-fk-relinked', async () => {
      // Seed a Media + grace-expired + a User pointing at it.
      const media = mediaFactory({ deletedAt: new Date(Date.now() - 30 * DAY_MS) });
      await prisma.media.create({ data: media });
      await prisma.user.create({
        data: {
          email: `fk-relink-${media.id}@example.test`,
          pictureId: media.id,
          providerName: 'LOCAL',
          name: 'Test',
          timezone: 0,
        },
      });
      const outcomes = await repository.hardDeleteBatch({
        ageDays: 7,
        graceDays: 7,
        batchSize: 100,
      });
      const outcome = outcomes.find((o) => o.mediaId === media.id);
      expect(outcome?.result).toBe('resurrected-fk-relinked');
    });

    it('RC-4: clean grace-expired media → deleted (positive baseline / counter-test anchor)', async () => {
      // This is the counter-test-by-revert anchor for RC-1/2/3 — if the
      // resurrect branch was flipped to DELETE-on-re-check-failure (the
      // exact violation invariant #9 forbids), the resurrect tests would
      // FAIL while THIS one passes. The asymmetry is what makes the
      // counter-test meaningful.
      const mediaId = await seedScenario(
        prisma,
        'already-soft-deleted-grace-expired'
      );
      const outcomes = await repository.hardDeleteBatch({
        ageDays: 7,
        graceDays: 7,
        batchSize: 100,
      });
      const outcome = outcomes.find((o) => o.mediaId === mediaId);
      expect(outcome?.result).toBe('deleted');
      const gone = await prisma.media.findUnique({ where: { id: mediaId } });
      expect(gone).toBeNull();
    });

    it('RC-5: grace NOT yet expired → row NOT in candidate set (no outcome)', async () => {
      const mediaId = await seedScenario(
        prisma,
        'already-soft-deleted-grace-pending'
      );
      const outcomes = await repository.hardDeleteBatch({
        ageDays: 7,
        graceDays: 7,
        batchSize: 100,
      });
      expect(outcomes.find((o) => o.mediaId === mediaId)).toBeUndefined();
      const stillThere = await prisma.media.findUnique({
        where: { id: mediaId },
      });
      expect(stillThere?.deletedAt).not.toBeNull();
    });

    it('RC-6: malformed Post.image referencing media id under grace → resurrected-nonpub-ref via LIKE-substring', async () => {
      // SQL LIKE has no JSON awareness — if a malformed Post.image contains
      // the quoted media id substring, the re-check will treat it as a
      // reference. This is conservative (false-positive → RESURRECT) and is
      // exactly the right safety-side error.
      const media = mediaFactory({
        deletedAt: new Date(Date.now() - 30 * DAY_MS),
      });
      await prisma.media.create({ data: media });
      // Post with a DRAFT state and malformed image that happens to contain
      // the quoted ID substring.
      await prisma.post.create({
        data: postFactory([], {
          state: 'DRAFT',
          publishDate: new Date(),
          image: `[malformed but contains "${media.id}" substring]`,
        }),
      });
      const outcomes = await repository.hardDeleteBatch({
        ageDays: 7,
        graceDays: 7,
        batchSize: 100,
      });
      const outcome = outcomes.find((o) => o.mediaId === media.id);
      // Conservative resurrect — the substring match counts as a non-pub ref.
      expect(outcome?.result).toBe('resurrected-nonpub-ref');
    });
  });

  describe('SCENARIO-W: graceDays cutoff equivalence (auditor YELLOW)', () => {
    it('SCENARIO-W: a row stamped (ageDays+graceDays)-old IS in the hardDeleteBatch candidate set', async () => {
      // Soft-delete stamp logic: deletedAt = NOW() - ageDays * 1d.
      // Hard-delete floor:       deletedAt <= NOW() - graceDays * 1d.
      // Therefore: a row whose deletedAt is (ageDays + graceDays) days old
      // satisfies the floor — confirming the equivalence the repository
      // comment at lines 162-167 documents.
      const media = mediaFactory({
        deletedAt: new Date(Date.now() - (7 + 7) * DAY_MS - 1000), // 14d+1s old
      });
      await prisma.media.create({ data: media });
      const outcomes = await repository.hardDeleteBatch({
        ageDays: 7,
        graceDays: 7,
        batchSize: 100,
      });
      expect(outcomes.map((o) => o.mediaId)).toContain(media.id);
    });

    it('SCENARIO-W counter-test: a row stamped (graceDays - 1)d old is NOT a candidate', async () => {
      const media = mediaFactory({
        deletedAt: new Date(Date.now() - 6 * DAY_MS), // 6d, less than graceDays
      });
      await prisma.media.create({ data: media });
      const outcomes = await repository.hardDeleteBatch({
        ageDays: 7,
        graceDays: 7,
        batchSize: 100,
      });
      expect(outcomes.map((o) => o.mediaId)).not.toContain(media.id);
    });

    it('SCENARIO-W: changing ageDays does NOT shift the hard-delete cutoff (graceDays is authoritative)', async () => {
      // Pins the documented contract: ageDays is signature-preserved but not
      // load-bearing for the hard-delete floor. If someone later wires ageDays
      // into the cutoff, this test will need a deliberate update.
      const media = mediaFactory({
        deletedAt: new Date(Date.now() - 8 * DAY_MS), // 8d ≥ graceDays=7
      });
      await prisma.media.create({ data: media });
      const outA = await repository.hardDeleteBatch({
        ageDays: 7,
        graceDays: 7,
        batchSize: 100,
        dryRun: true,
      });
      // Reset deletedAt (the dryRun was rolled back so state is preserved).
      const outB = await repository.hardDeleteBatch({
        ageDays: 999, // intentionally absurd; does NOT affect the floor
        graceDays: 7,
        batchSize: 100,
        dryRun: true,
      });
      // Both runs see the same candidate set.
      expect(outA.map((o) => o.mediaId).sort()).toEqual(
        outB.map((o) => o.mediaId).sort()
      );
    });
  });

  describe('concurrent-tick race (M-rc3, runbook §R15 single-replica assumption)', () => {
    // Pins the EvalPlanQual + REPEATABLE READ + FOR UPDATE race-safety
    // contract documented at media.janitor.repository.ts:143-150. Two
    // concurrent hardDeleteBatch invocations against the SAME grace-expired
    // candidate row must serialize on the per-row FOR UPDATE: the winner
    // performs the DELETE, the loser observes the row mutated out from
    // under its predicate via EvalPlanQual and yields `skipped-race` —
    // never a double-delete, never a lost write.
    //
    // The race is the structural reason runbook §R15 forbids multi-replica
    // janitor deploys: even if two replicas ticked at the same instant,
    // the database-layer guard would still hold. This test exercises that
    // guard directly on a single replica using two concurrent JS
    // invocations, which Prisma's connection pool dispatches onto distinct
    // DB sessions.
    it('two concurrent hardDeleteBatch calls on the same row: one deleted, one skipped-race', async () => {
      // ────────────────────────────────────────────────────────────────
      // Advisory-lock barrier mechanism (race-determinism harness).
      //
      // Problem this solves: Promise.all([call1, call2]) does NOT
      // guarantee both per-row REPEATABLE READ transactions have reached
      // the FOR UPDATE step before either commits. Without the barrier,
      // a fast-enough machine can serialize the two calls and emit
      // ['deleted', 'deleted'] (winner) or ['deleted'] (loser observed
      // empty candidate set on its outer discovery query) — both legal
      // outcomes for the unsynchronized race, but neither exercises the
      // 40001 → skipped-race code path that PR #11 must pin.
      //
      // Mechanism (Option B, accepted by team-lead via TEACHBACK #80):
      //   1. A separate holder PrismaClient (distinct DB session)
      //      acquires a SESSION-level pg_advisory_lock(key).
      //   2. We set JANITOR_TEST_ADVISORY_LOCK_KEY in process.env so the
      //      production hook in repository.ts opens each txn with a
      //      pg_advisory_xact_lock(key) — both contestants block.
      //   3. We poll pg_stat_activity for two waiters on the advisory
      //      lock (wait_event_type='Lock', wait_event='advisory'), with
      //      a bounded sleep fallback if polling proves unreliable on
      //      this Postgres image.
      //   4. The holder releases via pg_advisory_unlock. Both contestant
      //      txns unblock in DB-scheduled order, race through FOR UPDATE
      //      deterministically, and emit ['deleted', 'skipped-race'].
      //
      // Why a separate PrismaClient for the holder: pg_advisory_lock is
      // session-scoped; if we acquired it on the suite's shared `prisma`
      // session, every subsequent query on that session (including the
      // contestant calls if Prisma pooled them onto the same conn) would
      // pre-own the lock and the barrier would short-circuit.
      // ────────────────────────────────────────────────────────────────
      const url = process.env.TEST_DATABASE_URL;
      if (!url) {
        throw new Error(
          'TEST_DATABASE_URL must be set for the advisory-lock barrier'
        );
      }
      const ADVISORY_KEY = 909119; // arbitrary positive int4, test-local
      const holder = new PrismaClient({ datasources: { db: { url } } });

      const mediaId = await seedScenario(
        prisma,
        'already-soft-deleted-grace-expired'
      );

      try {
        // 1) Holder acquires SESSION-level advisory lock.
        await holder.$executeRawUnsafe(
          'SELECT pg_advisory_lock($1)',
          ADVISORY_KEY
        );

        // 2) Arm the production hook for the duration of this test only.
        process.env.JANITOR_TEST_ADVISORY_LOCK_KEY = String(ADVISORY_KEY);

        // 3) Fire both calls; they will block inside their respective
        //    $transaction bodies on pg_advisory_xact_lock(KEY).
        const racePromise = Promise.all([
          repository.hardDeleteBatch({
            ageDays: 7,
            graceDays: 7,
            batchSize: 100,
          }),
          repository.hardDeleteBatch({
            ageDays: 7,
            graceDays: 7,
            batchSize: 100,
          }),
        ]);

        // 4) Poll pg_stat_activity until two contestants are queued on
        //    the advisory lock. Bounded sleep fallback after exhausting
        //    poll budget (defends against PG image / view-permission
        //    weirdness where wait_event may not surface immediately).
        const POLL_INTERVAL_MS = 25;
        const POLL_BUDGET_MS = 5000;
        const deadline = Date.now() + POLL_BUDGET_MS;
        let waitersSeen = 0;
        while (Date.now() < deadline) {
          const rows = await holder.$queryRaw<{ n: bigint | number }[]>`
            SELECT COUNT(*)::int8 AS n
            FROM pg_stat_activity
            WHERE wait_event_type = 'Lock'
              AND wait_event = 'advisory'
          `;
          waitersSeen = Number(rows[0]?.n ?? 0);
          if (waitersSeen >= 2) break;
          await new Promise((resolve) =>
            setTimeout(resolve, POLL_INTERVAL_MS)
          );
        }

        if (waitersSeen < 2) {
          // Polling fallback: bounded sleep, then release. Worst case
          // we degrade to the pre-barrier timing window — but the
          // assertions below remain the contract we pin.
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        // 5) Release the gate — both contestants unblock.
        await holder.$executeRawUnsafe(
          'SELECT pg_advisory_unlock($1)',
          ADVISORY_KEY
        );

        const [outcomesA, outcomesB] = await racePromise;

        const all = [...outcomesA, ...outcomesB].filter(
          (o) => o.mediaId === mediaId
        );
        const results = all.map((o) => o.result).sort();

        // Exactly one tick wins the FOR UPDATE and performs the DELETE; the
        // other loses the lock race. Mechanism under REPEATABLE READ + FOR
        // UPDATE (set at repository.ts processHardDeleteRow's $transaction
        // call): Postgres does NOT fire EvalPlanQual under RR — the loser's
        // txn aborts with SQLSTATE 40001 ("could not serialize access due
        // to concurrent update"). The catch block in processHardDeleteRow
        // classifies 40001 specifically (via isSerializationFailure) and
        // emits a skipped-race outcome, routing the loser through the
        // error-handler path rather than the in-txn predicate re-check
        // (which is structurally unreachable under RR for the contended
        // single-row case).
        expect(results).toEqual(['deleted', 'skipped-race']);

        // Post-condition: the row is gone exactly once. The LOSER must never
        // reach the DELETE statement — contract pinned by the FOR UPDATE
        // + RepeatableRead serialization-abort path (loser's tx never
        // executes the DELETE statement because it aborts with 40001
        // before reaching it).
        const gone = await prisma.media.findUnique({ where: { id: mediaId } });
        expect(gone).toBeNull();
      } finally {
        delete process.env.JANITOR_TEST_ADVISORY_LOCK_KEY;
        // Best-effort holder cleanup. Unlock is idempotent: if we
        // already unlocked above it returns false (no error).
        try {
          await holder.$executeRawUnsafe(
            'SELECT pg_advisory_unlock_all()'
          );
        } catch {
          // ignore
        }
        await holder.$disconnect();
      }
    });

    it('counter-test: a single hardDeleteBatch call (no concurrency) returns ONLY deleted, never skipped-race', async () => {
      // Asymmetric pair for the race test above. If the FOR UPDATE guard
      // were removed (or the predicate re-check at line 199-202 dropped),
      // the concurrent test could still pass by accident (e.g., both
      // succeeding). This baseline pins that a serial single-caller path
      // never emits skipped-race — so the appearance of skipped-race in
      // the concurrent case is genuinely produced by the race window, not
      // by some spurious "always emit skipped-race" path.
      const mediaId = await seedScenario(
        prisma,
        'already-soft-deleted-grace-expired'
      );
      const outcomes = await repository.hardDeleteBatch({
        ageDays: 7,
        graceDays: 7,
        batchSize: 100,
      });
      const forRow = outcomes.filter((o) => o.mediaId === mediaId);
      expect(forRow.map((o) => o.result)).toEqual(['deleted']);
      expect(forRow.some((o) => o.result === 'skipped-race')).toBe(false);
    });
  });
});
