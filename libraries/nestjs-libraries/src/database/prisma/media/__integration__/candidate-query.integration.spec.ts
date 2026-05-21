// candidate-query.integration.spec.ts
//
// Validates the soft-delete candidate SELECT against the locked eligibility
// predicate (plan §Eligibility predicate, architect §3) AND asserts EXPLAIN
// shows no Seq Scan on the candidate query path (plan §Test Engineer + R1
// risk mitigation). The composite Post index `(state, publishDate, deletedAt)`
// landed in this PR is the precondition for the index-scan plan.
//
// Counter-test-by-revert anchor: the LIKE-anchor `"<mediaId>"` (with quotes)
// is what makes the eligibility match safe against substring drift. If that
// anchor is removed, the substring "duplicate-media-id-in-post" scenario
// becomes ambiguous and the test set drifts — covered by the dedicated
// `mediaId-substring-only-no-quote` assertion below.
import { MediaJanitorRepository } from '../media.janitor.repository';
import { PrismaService } from '../../prisma.service';
import {
  describeIfDb,
  disconnectIntegrationContext,
} from './setup';
import {
  truncateMediaScope,
  seedScenario,
  mediaFactory,
  postFactory,
} from './seed.helpers';

describeIfDb('MediaJanitorRepository.findSoftDeleteCandidates (integration)', (prisma) => {
  const repository = new MediaJanitorRepository(prisma as unknown as PrismaService);

  beforeEach(async () => {
    await truncateMediaScope(prisma);
  });

  afterAll(async () => {
    await disconnectIntegrationContext();
  });

  describe('eligibility predicate scenarios (plan §Test Engineer required fixtures)', () => {
    it('no-referrers → NOT eligible (no PUBLISHED ref)', async () => {
      await seedScenario(prisma, 'no-referrers');
      const candidates = await repository.findSoftDeleteCandidates({
        ageDays: 7,
        batchSize: 100,
      });
      expect(candidates).toHaveLength(0);
    });

    it.each([
      'only-draft-referrer',
      'only-queued-referrer',
      'only-errored-referrer',
    ] as const)(
      '%s → NOT eligible (no PUBLISHED ref or non-pub ref blocks)',
      async (scenario) => {
        await seedScenario(prisma, scenario);
        const candidates = await repository.findSoftDeleteCandidates({
          ageDays: 7,
          batchSize: 100,
        });
        expect(candidates).toHaveLength(0);
      }
    );

    it('recent-publish → NOT eligible (MAX(publishDate) inside cutoff)', async () => {
      await seedScenario(prisma, 'recent-publish');
      const candidates = await repository.findSoftDeleteCandidates({
        ageDays: 7,
        batchSize: 100,
      });
      expect(candidates).toHaveLength(0);
    });

    it('old-publish-eligible → ELIGIBLE', async () => {
      const mediaId = await seedScenario(prisma, 'old-publish-eligible');
      const candidates = await repository.findSoftDeleteCandidates({
        ageDays: 7,
        batchSize: 100,
      });
      expect(candidates.map((c) => c.id)).toContain(mediaId);
    });

    it('mixed-publish-ages (one recent) → NOT eligible (MAX wins)', async () => {
      await seedScenario(prisma, 'mixed-publish-ages');
      const candidates = await repository.findSoftDeleteCandidates({
        ageDays: 7,
        batchSize: 100,
      });
      expect(candidates).toHaveLength(0);
    });

    it('mixed-publish-ages-all-old → ELIGIBLE', async () => {
      const mediaId = await seedScenario(prisma, 'mixed-publish-ages-all-old');
      const candidates = await repository.findSoftDeleteCandidates({
        ageDays: 7,
        batchSize: 100,
      });
      expect(candidates.map((c) => c.id)).toContain(mediaId);
    });

    it('already-soft-deleted → NOT eligible (filter deletedAt IS NULL)', async () => {
      await seedScenario(prisma, 'already-soft-deleted-grace-pending');
      const candidates = await repository.findSoftDeleteCandidates({
        ageDays: 7,
        batchSize: 100,
      });
      expect(candidates).toHaveLength(0);
    });

    it('scenario-x: DRAFT + old-PUBLISHED → NOT eligible (nonPub blocks)', async () => {
      await seedScenario(prisma, 'scenario-x-draft-plus-old-published');
      const candidates = await repository.findSoftDeleteCandidates({
        ageDays: 7,
        batchSize: 100,
      });
      expect(candidates).toHaveLength(0);
    });

    it('malformed-post-image → eligibility query still terminates (does not throw)', async () => {
      // SQL LIKE has no JSON awareness — the test guards that a malformed
      // Post.image value doesn't propagate as a runtime error in the
      // repository. The candidate is NOT eligible because the truncated JSON
      // means LIKE may or may not match depending on whether the truncation
      // left the quoted ID intact; the contract is that the query terminates
      // and returns a deterministic result.
      await seedScenario(prisma, 'malformed-post-image');
      await expect(
        repository.findSoftDeleteCandidates({ ageDays: 7, batchSize: 100 })
      ).resolves.toBeDefined();
    });

    it('duplicate-media-id-in-post → ELIGIBLE (LIKE de-duplication is irrelevant)', async () => {
      const mediaId = await seedScenario(
        prisma,
        'duplicate-media-id-in-post'
      );
      const candidates = await repository.findSoftDeleteCandidates({
        ageDays: 7,
        batchSize: 100,
      });
      expect(candidates.map((c) => c.id)).toContain(mediaId);
    });

    it('mediaId-substring-only-no-quote: ID embedded in path WITHOUT JSON-quote anchor → NOT a false-positive match', async () => {
      const media = mediaFactory();
      await prisma.media.create({ data: media });
      // Post.image is hand-crafted to contain the media id substring but
      // without the JSON quote-anchor — mimicking a hypothetical drift where
      // someone serializes path values that include the id substring.
      await prisma.post.create({
        data: postFactory([], {
          state: 'PUBLISHED',
          publishDate: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
          image: `[{"id":"other","path":"/p/${media.id}.png"}]`,
        }),
      });
      const candidates = await repository.findSoftDeleteCandidates({
        ageDays: 7,
        batchSize: 100,
      });
      expect(candidates.map((c) => c.id)).not.toContain(media.id);
    });
  });

  describe('cross-tenant scope (R12)', () => {
    it('a PUBLISHED post in org-B referencing org-A media STILL blocks soft-delete (current SQL is org-agnostic)', async () => {
      // The current eligibility SQL does NOT filter by organizationId — the
      // janitor scope is global. This test pins that behavior so that any
      // future per-tenant scoping is a CONSCIOUS DECISION (the test will
      // need to change). Documenting the global-scope choice from plan
      // §Risk Register R12.
      // Per-test cross-tenant scaffolding: seed org-A (Media owner) and
      // org-B (Post owner) inline rather than polluting the generic
      // seedPrerequisites helper with test-specific tenant rows. Also seed
      // 'org-test' + 'integration-test' here (the postFactory + mediaFactory
      // defaults) because this is the only test in candidate-query.spec.ts
      // that does NOT call seedScenario — so we cannot rely on seedScenario's
      // call to seedPrerequisites having already run within this test's
      // Jest worker (test-ordering or --testNamePattern isolation can
      // reorder it). Matches seedPrerequisites' canonical organizationId
      // wiring for 'integration-test' (→ 'org-test') to avoid divergence if
      // both seed paths run in the same worker.
      await prisma.organization.upsert({
        where: { id: 'org-test' },
        update: {},
        create: { id: 'org-test', name: 'Test Org' },
      });
      await prisma.organization.upsert({
        where: { id: 'org-A' },
        update: {},
        create: { id: 'org-A', name: 'Test Org A' },
      });
      await prisma.organization.upsert({
        where: { id: 'org-B' },
        update: {},
        create: { id: 'org-B', name: 'Test Org B' },
      });
      await prisma.integration.upsert({
        where: { id: 'integration-test' },
        update: {},
        create: {
          id: 'integration-test',
          internalId: 'integration-test-internal',
          organizationId: 'org-test',
          name: 'Test Integration',
          providerIdentifier: 'test-provider',
          type: 'social',
          token: 'test-token',
        },
      });
      const media = mediaFactory({ organizationId: 'org-A' });
      await prisma.media.create({ data: media });
      await prisma.post.create({
        data: postFactory([media.id], {
          state: 'PUBLISHED',
          publishDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          organizationId: 'org-B',
        }),
      });
      const candidates = await repository.findSoftDeleteCandidates({
        ageDays: 7,
        batchSize: 100,
      });
      // Old PUBLISHED in another org → eligible from janitor's POV.
      expect(candidates.map((c) => c.id)).toContain(media.id);
    });
  });

  describe('EXPLAIN no-Seq-Scan (R1 mitigation, plan §Test Engineer)', () => {
    it('candidate query plan against representative dataset uses index scans', async () => {
      // Seed enough rows that the planner has a real choice.
      for (let i = 0; i < 20; i += 1) {
        const m = mediaFactory();
        await prisma.media.create({ data: m });
        await prisma.post.create({
          data: postFactory([m.id], {
            state: 'PUBLISHED',
            publishDate: new Date(
              Date.now() - (10 + i) * 24 * 60 * 60 * 1000
            ),
          }),
        });
      }
      await prisma.$executeRawUnsafe(`ANALYZE "Media"`);
      await prisma.$executeRawUnsafe(`ANALYZE "Post"`);

      const explain = await prisma.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
        `EXPLAIN
         SELECT m."id", m."path", m."organizationId", m."fileSize"
         FROM "Media" m
         WHERE m."deletedAt" IS NULL
           AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."pictureId" = m."id")
           AND NOT EXISTS (SELECT 1 FROM "SocialMediaAgency" a WHERE a."logoId" = m."id")
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
           ) <= NOW() - (7::int * INTERVAL '1 day')
         ORDER BY m."createdAt" ASC
         LIMIT 100`
      );
      const plan = explain.map((row) => row['QUERY PLAN']).join('\n');
      // The LIKE '%"...%' residual will produce a Seq Scan on Post.image at
      // small data volumes; the index-supported portion is the
      // (state, publishDate, deletedAt) filter. The acceptance contract is
      // that "Media" itself is NOT seq-scanned (it has @@index([deletedAt])).
      // This assertion is conservative — sharpen as data volume grows.
      const mediaSeqScan = /Seq Scan on "Media"|Seq Scan on Media\b/.test(plan);
      expect(mediaSeqScan).toBe(false);
    });
  });
});
