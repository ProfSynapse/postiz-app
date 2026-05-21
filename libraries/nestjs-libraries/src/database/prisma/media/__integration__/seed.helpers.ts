// libraries/nestjs-libraries/src/database/prisma/media/__integration__/seed.helpers.ts
//
// Integration-test fixture builders + scenario seeder (plan I.3).
//
// Three responsibilities:
//   1. `mediaFactory`   — build a Media row with sensible defaults.
//   2. `postFactory`    — build a Post row with image=JSON.stringify([{id}]).
//   3. `seedScenario`   — given a named scenario key (see plan §Test Engineer
//      Required test scenarios), insert the rows that scenario expects.
//
// All factories return PLAIN OBJECTS suitable for `prisma.media.create({data})`
// — the test owns the prisma client and the truncation lifecycle. Keeping the
// factory side-effect-free lets one helper drive both UNIT (Prisma mocked)
// and INTEGRATION (real DB) tests.
//
// Truncation strategy: the suite runs `truncateMediaScope(prisma)` in
// beforeEach so each test starts from a clean slate. Per-test transactional
// rollback doesn't work here because the janitor opens its OWN transactions
// (REPEATABLE READ + FOR UPDATE); nested-txn rollback would mask the SUT's
// behavior.
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

export type ScenarioName =
  | 'no-referrers'
  | 'only-draft-referrer'
  | 'only-queued-referrer'
  | 'only-errored-referrer'
  | 'recent-publish'
  | 'old-publish-eligible'
  | 'mixed-publish-ages'
  | 'mixed-publish-ages-all-old'
  | 'already-soft-deleted-grace-pending'
  | 'already-soft-deleted-grace-expired'
  | 'soft-deleted-but-re-referenced'
  | 'orphan-media-id-in-post'
  | 'malformed-post-image'
  | 'duplicate-media-id-in-post'
  // Database-engineer addendum:
  | 'scenario-x-draft-plus-old-published'
  | 'scenario-y-grace-plus-new-draft'
  | 'scenario-z-grace-plus-deleted-published';

export interface MediaSeed {
  id: string;
  organizationId: string;
  path: string;
  fileSize: number;
  type: string;
  name: string;
  alt: string | null;
  deletedAt: Date | null;
}

export function mediaFactory(
  overrides: Partial<MediaSeed> = {}
): MediaSeed {
  const id = overrides.id ?? randomUUID();
  return {
    id,
    organizationId: overrides.organizationId ?? 'org-test',
    path: overrides.path ?? `/2025/01/01/${id}.png`,
    fileSize: overrides.fileSize ?? 1024,
    type: overrides.type ?? 'image',
    name: overrides.name ?? `${id}.png`,
    alt: overrides.alt ?? null,
    deletedAt: overrides.deletedAt ?? null,
  };
}

export interface PostSeed {
  id: string;
  state: 'DRAFT' | 'QUEUE' | 'PUBLISHED' | 'ERROR';
  publishDate: Date;
  image: string; // JSON-stringified array of {id, path}
  deletedAt: Date | null;
  organizationId: string;
  content: string;
  integrationId: string;
}

export function postFactory(
  mediaIds: string[],
  overrides: Partial<PostSeed> = {}
): PostSeed {
  const id = overrides.id ?? randomUUID();
  return {
    id,
    state: overrides.state ?? 'PUBLISHED',
    publishDate:
      overrides.publishDate ??
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
    image:
      overrides.image ??
      JSON.stringify(
        mediaIds.map((mediaId) => ({ id: mediaId, path: `/p/${mediaId}.png` }))
      ),
    deletedAt: overrides.deletedAt ?? null,
    organizationId: overrides.organizationId ?? 'org-test',
    content: overrides.content ?? 'post content',
    integrationId: overrides.integrationId ?? 'integration-test',
  };
}

/**
 * Truncate the tables the janitor touches, in dependency order, to give each
 * test a clean slate. Uses CASCADE so foreign-key checks don't block the
 * suite if other tables grow in future.
 */
export async function truncateMediaScope(
  prisma: PrismaClient
): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Post", "Media" RESTART IDENTITY CASCADE'
  );
}

/**
 * Insert one scenario per name. Returns the media row id the test should
 * focus on (most scenarios center on a single Media row; multi-row scenarios
 * return the FIRST id and the test can re-query for the rest).
 */
export async function seedScenario(
  prisma: PrismaClient,
  scenario: ScenarioName,
  ageDays = 7
): Promise<string> {
  const PAST = (days: number): Date =>
    new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const media = mediaFactory();
  await prisma.media.create({ data: media });

  switch (scenario) {
    case 'no-referrers': {
      // Media exists but no Post references it.
      return media.id;
    }
    case 'only-draft-referrer': {
      await prisma.post.create({
        data: postFactory([media.id], { state: 'DRAFT', publishDate: PAST(1) }),
      });
      return media.id;
    }
    case 'only-queued-referrer': {
      await prisma.post.create({
        data: postFactory([media.id], { state: 'QUEUE', publishDate: PAST(1) }),
      });
      return media.id;
    }
    case 'only-errored-referrer': {
      await prisma.post.create({
        data: postFactory([media.id], { state: 'ERROR', publishDate: PAST(1) }),
      });
      return media.id;
    }
    case 'recent-publish': {
      await prisma.post.create({
        data: postFactory([media.id], {
          state: 'PUBLISHED',
          publishDate: PAST(ageDays - 1), // INSIDE the cutoff
        }),
      });
      return media.id;
    }
    case 'old-publish-eligible': {
      await prisma.post.create({
        data: postFactory([media.id], {
          state: 'PUBLISHED',
          publishDate: PAST(ageDays + 5),
        }),
      });
      return media.id;
    }
    case 'mixed-publish-ages': {
      // One recent + one old PUBLISHED → MAX is recent → NOT eligible.
      await prisma.post.createMany({
        data: [
          postFactory([media.id], {
            state: 'PUBLISHED',
            publishDate: PAST(ageDays + 30),
          }),
          postFactory([media.id], {
            state: 'PUBLISHED',
            publishDate: PAST(ageDays - 2), // recent → blocks
          }),
        ],
      });
      return media.id;
    }
    case 'mixed-publish-ages-all-old': {
      await prisma.post.createMany({
        data: [
          postFactory([media.id], {
            state: 'PUBLISHED',
            publishDate: PAST(ageDays + 30),
          }),
          postFactory([media.id], {
            state: 'PUBLISHED',
            publishDate: PAST(ageDays + 5),
          }),
        ],
      });
      return media.id;
    }
    case 'already-soft-deleted-grace-pending': {
      await prisma.media.update({
        where: { id: media.id },
        data: { deletedAt: PAST(2) }, // soft-deleted 2 days ago; grace not expired
      });
      await prisma.post.create({
        data: postFactory([media.id], {
          state: 'PUBLISHED',
          publishDate: PAST(ageDays + 10),
        }),
      });
      return media.id;
    }
    case 'already-soft-deleted-grace-expired': {
      await prisma.media.update({
        where: { id: media.id },
        data: { deletedAt: PAST(ageDays + 10) }, // grace expired
      });
      await prisma.post.create({
        data: postFactory([media.id], {
          state: 'PUBLISHED',
          publishDate: PAST(ageDays + 20),
        }),
      });
      return media.id;
    }
    case 'soft-deleted-but-re-referenced': {
      // Soft-deleted with grace expired, but a new DRAFT arrived mid-grace →
      // hard-delete must RESURRECT (Inv #9).
      await prisma.media.update({
        where: { id: media.id },
        data: { deletedAt: PAST(ageDays + 10) },
      });
      await prisma.post.createMany({
        data: [
          postFactory([media.id], {
            state: 'PUBLISHED',
            publishDate: PAST(ageDays + 20),
          }),
          postFactory([media.id], {
            state: 'DRAFT',
            publishDate: PAST(0),
          }),
        ],
      });
      return media.id;
    }
    case 'orphan-media-id-in-post': {
      // Post references a media id that has never existed (or was hard-deleted).
      const orphanId = randomUUID();
      await prisma.post.create({
        data: postFactory([orphanId], {
          state: 'PUBLISHED',
          publishDate: PAST(ageDays + 10),
        }),
      });
      return orphanId; // intentionally returns the orphan
    }
    case 'malformed-post-image': {
      await prisma.post.create({
        data: postFactory([media.id], {
          state: 'PUBLISHED',
          publishDate: PAST(ageDays + 10),
          image: '[truncated-malformed-json',
        }),
      });
      return media.id;
    }
    case 'duplicate-media-id-in-post': {
      await prisma.post.create({
        data: postFactory([media.id, media.id], {
          state: 'PUBLISHED',
          publishDate: PAST(ageDays + 10),
        }),
      });
      return media.id;
    }
    case 'scenario-x-draft-plus-old-published': {
      // DRAFT exists → nonPublishedCount > 0 → soft-delete SKIPS.
      await prisma.post.createMany({
        data: [
          postFactory([media.id], {
            state: 'DRAFT',
            publishDate: PAST(0),
          }),
          postFactory([media.id], {
            state: 'PUBLISHED',
            publishDate: PAST(ageDays + 10),
          }),
        ],
      });
      return media.id;
    }
    case 'scenario-y-grace-plus-new-draft': {
      // Already-soft-deleted; a DRAFT was just created → hard-delete RESURRECTS.
      await prisma.media.update({
        where: { id: media.id },
        data: { deletedAt: PAST(ageDays + 10) },
      });
      await prisma.post.createMany({
        data: [
          postFactory([media.id], {
            state: 'PUBLISHED',
            publishDate: PAST(ageDays + 20),
          }),
          postFactory([media.id], {
            state: 'DRAFT',
            publishDate: PAST(0),
          }),
        ],
      });
      return media.id;
    }
    case 'scenario-z-grace-plus-deleted-published': {
      // Already-soft-deleted; sole PUBLISHED was deleted → publishedCount=0
      // → hard-delete RESURRECTS (`resurrected-no-pub-ref`).
      await prisma.media.update({
        where: { id: media.id },
        data: { deletedAt: PAST(ageDays + 10) },
      });
      await prisma.post.create({
        data: postFactory([media.id], {
          state: 'PUBLISHED',
          publishDate: PAST(ageDays + 20),
          deletedAt: PAST(1), // post deleted mid-grace
        }),
      });
      return media.id;
    }
    default: {
      const _exhaustive: never = scenario;
      throw new Error(`unknown scenario: ${_exhaustive}`);
    }
  }
}
