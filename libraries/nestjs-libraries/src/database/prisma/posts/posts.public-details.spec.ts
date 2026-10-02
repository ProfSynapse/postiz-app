import 'reflect-metadata';

jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: jest.fn(),
}));
jest.mock('@gitroom/nestjs-libraries/integrations/social.abstract', () => ({
  BadBody: class BadBody extends Error {},
  RefreshToken: class RefreshToken extends Error {},
}));
jest.mock('@sentry/nestjs', () => ({ metrics: { count: jest.fn() } }));
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: jest.fn(() => ({})) },
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/media/media.service',
  () => ({ MediaService: class {} })
);

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { PostsService } from './posts.service';
import { PostsRepository } from './posts.repository';
import { MediaRepository } from '../media/media.repository';
import { MediaService } from '../media/media.service';
import { IntegrationService } from '../integrations/integration.service';
import { PublicIntegrationsController } from '@gitroom/backend/public-api/routes/v1/public.integrations.controller';
import { PublicAuthMiddleware } from '@gitroom/backend/services/auth/public.auth.middleware';
import { publicMediaUrl } from '@gitroom/nestjs-libraries/dtos/posts/public-post-details.dto';

const date = new Date('2026-10-02T13:00:00.000Z');
function post(id: string, extra: Record<string, any> = {}) {
  return {
    id,
    parentPostId: null,
    group: 'group-a',
    organizationId: 'org-a',
    deletedAt: null,
    createdAt: date,
    publishDate: date,
    state: 'QUEUE',
    content: 'Approved main post',
    title: null,
    description: null,
    releaseURL: null,
    image: JSON.stringify([{ id: 'video-a' }]),
    settings: JSON.stringify({
      __type: 'linkedin',
      post_as_images_carousel: false,
    }),
    integration: {
      id: 'integration-a',
      organizationId: 'org-a',
      name: 'Joseph',
      providerIdentifier: 'linkedin',
      token: 'DO-NOT-RETURN-TOKEN',
      refreshToken: 'DO-NOT-RETURN-REFRESH',
    },
    apiKey: 'DO-NOT-RETURN-KEY',
    ...extra,
  };
}
function attachment(id: string, extra: Record<string, any> = {}) {
  return {
    id,
    organizationId: 'org-a',
    deletedAt: null,
    name: `${id}.mp4`,
    path: `https://cdn.example.test/${id}.mp4`,
    type: 'video',
    thumbnail: null,
    alt: null,
    privatePath: '/tmp/private.mp4',
    ...extra,
  };
}

// Query-sensitive in-memory adapters: removing an organization/deletion predicate
// really changes the HTTP result. No live DB, credentials or production app boot.
function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'OR')
      return value.some((condition: any) => matches(row, condition));
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if ('in' in value) return value.in.includes(row[key]);
      return matches(row[key] || {}, value);
    }
    return row[key] === value;
  });
}

describe('Public post detail HTTP endpoint', () => {
  let app: INestApplication;
  let base: string;
  let rows: any[];
  let mediaRows: any[];
  let postsModel: Record<string, jest.Mock>;
  let mediaModel: Record<string, jest.Mock>;
  let service: PostsService;
  let updateMedia: jest.SpyInstance;
  let orgLookup: jest.Mock;

  beforeEach(async () => {
    rows = [
      post('post-a'),
      post('comment-a', {
        parentPostId: 'post-a',
        image: '[]',
        content: 'Read the blog: https://example.test/blog',
      }),
      post('reply-a', {
        parentPostId: 'comment-a',
        image: '[]',
        content: 'Second scheduled reply',
      }),
    ];
    mediaRows = [attachment('video-a')];
    const forbiddenWrites = () =>
      Object.fromEntries(
        [
          'create',
          'createMany',
          'update',
          'updateMany',
          'delete',
          'deleteMany',
          'upsert',
        ].map((name) => [
          name,
          jest.fn(() => {
            throw new Error('A read attempted a write');
          }),
        ])
      );
    postsModel = {
      ...forbiddenWrites(),
      findFirst: jest.fn(
        async ({ where }) => rows.find((row) => matches(row, where)) || null
      ),
      findMany: jest.fn(async ({ where }) =>
        rows
          .filter((row) => matches(row, where))
          .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      ),
    };
    mediaModel = {
      ...forbiddenWrites(),
      findMany: jest.fn(async ({ where }) =>
        mediaRows.filter((row) => matches(row, where))
      ),
    };
    const repository = new PostsRepository(
      { model: { post: postsModel } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    const mediaRepository = new MediaRepository({
      model: { media: mediaModel },
    } as any);
    service = new PostsService(
      repository,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        getPublicMedia: (...args: [string, string[], string[]]) =>
          mediaRepository.getPublicMedia(...args),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    updateMedia = jest.spyOn(service, 'updateMedia');
    const module = await Test.createTestingModule({
      controllers: [PublicIntegrationsController],
      providers: [
        { provide: PostsService, useValue: service },
        { provide: IntegrationService, useValue: {} },
        { provide: MediaService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    orgLookup = jest.fn(async (key) =>
      key === 'test-only-key' ? { id: 'org-a', subscription: {} } : null
    );
    const middleware = new PublicAuthMiddleware({
      getOrgByApiKey: orgLookup,
    } as any);
    // Same controller-wide PublicAuthMiddleware used by PublicApiModule.
    app.use('/api/public/v1', middleware.use.bind(middleware));
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });

  afterEach(async () => {
    expect(updateMedia).not.toHaveBeenCalled();
    for (const model of [postsModel, mediaModel])
      for (const name of [
        'create',
        'createMany',
        'update',
        'updateMany',
        'delete',
        'deleteMany',
        'upsert',
      ])
        expect(model[name]).not.toHaveBeenCalled();
    await app.close();
    jest.restoreAllMocks();
  });

  function get(id = 'post-a', authorization: string | null = 'test-only-key') {
    return fetch(`${base}/api/public/v1/posts/${id}`, {
      headers: authorization ? { Authorization: authorization } : {},
    });
  }

  it.each([null, 'invalid-test-key', 'Bearer test-only-key'])(
    'rejects missing/invalid authorization (%s) without post reads',
    async (key) => {
      expect((await get('post-a', key)).status).toBe(401);
      expect(postsModel.findFirst).not.toHaveBeenCalled();
      expect(mediaModel.findMany).not.toHaveBeenCalled();
    }
  );

  it.each(['missing', 'foreign', 'deleted', 'foreign-integration'])(
    'returns 404 for %s post',
    async (kind) => {
      if (kind === 'missing') rows = [];
      if (kind === 'foreign') rows[0].organizationId = 'org-b';
      if (kind === 'deleted') rows[0].deletedAt = date;
      if (kind === 'foreign-integration')
        rows[0].integration.organizationId = 'org-b';
      expect((await get()).status).toBe(404);
      expect(postsModel.findMany).not.toHaveBeenCalled();
      expect(mediaModel.findMany).not.toHaveBeenCalled();
    }
  );

  it('returns a valid YouTube watch URL while keeping media query URLs excluded', async () => {
    rows[0].integration.providerIdentifier = 'youtube';
    rows[0].releaseURL = 'https://www.youtube.com/watch?v=aB_cD-12345';
    rows[0].settings = JSON.stringify({
      __type: 'youtube',
      title: 'Approved video',
      type: 'public',
    });
    const response = await get();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.posts[0].releaseURL).toBe(rows[0].releaseURL);
    expect(JSON.stringify(body)).not.toMatch(/DO-NOT-RETURN/);
  });

  it('returns exact own post, ordered first comment/reply, attachment and settings', async () => {
    const response = await get();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      id: 'post-a',
      group: 'group-a',
      integration: {
        id: 'integration-a',
        name: 'Joseph',
        providerIdentifier: 'linkedin',
      },
      threadComplete: true,
      posts: rows.map((row, index) => ({
        id: row.id,
        parentPostId: row.parentPostId,
        state: 'QUEUE',
        publishDate: date.toISOString(),
        content: row.content,
        title: null,
        description: null,
        releaseURL: null,
        image:
          index === 0
            ? [
                {
                  id: 'video-a',
                  name: 'video-a.mp4',
                  type: 'video',
                  url: 'https://cdn.example.test/video-a.mp4',
                  thumbnail: null,
                  alt: null,
                },
              ]
            : [],
        mediaComplete: true,
        settings: { __type: 'linkedin', post_as_images_carousel: false },
        settingsComplete: true,
      })),
    });
    expect(
      postsModel.findFirst.mock.calls[0][0].select.integration.select
    ).toEqual({ id: true, name: true, providerIdentifier: true });
    expect(postsModel.findMany).toHaveBeenCalledTimes(3);
    expect(orgLookup).toHaveBeenCalledWith('test-only-key');
  });

  it('cannot change organization through caller query parameters', async () => {
    rows[0].organizationId = 'org-b';
    expect(
      (await get('post-a?organizationId=org-b&showorg=org-b')).status
    ).toBe(404);
  });

  it('excludes foreign/deleted/different-group children and does not traverse them', async () => {
    rows.push(
      post('foreign-child', {
        parentPostId: 'post-a',
        organizationId: 'org-b',
      }),
      post('deleted-child', { parentPostId: 'post-a', deletedAt: date }),
      post('other-group', { parentPostId: 'post-a', group: 'other' }),
      post('foreign-descendant', { parentPostId: 'foreign-child' })
    );
    const body = await (await get()).json();
    expect(body.posts.map((row: any) => row.id)).toEqual([
      'post-a',
      'comment-a',
      'reply-a',
    ]);
    expect(
      postsModel.findMany.mock.calls.map(([query]) => query.where.parentPostId)
    ).toEqual(['post-a', 'comment-a', 'reply-a']);
  });

  it('does not resolve foreign/deleted media or fall back from its ID to a supplied own path', async () => {
    rows[0].image = JSON.stringify([
      { id: 'foreign-media', path: mediaRows[0].path },
      { id: 'deleted-media' },
    ]);
    mediaRows.push(
      attachment('foreign-media', { organizationId: 'org-b' }),
      attachment('deleted-media', { deletedAt: date })
    );
    const body = await (await get()).json();
    expect(body.posts[0].image).toEqual([]);
    expect(body.posts[0].mediaComplete).toBe(false);
    expect(mediaModel.findMany.mock.calls[0][0].where).toEqual({
      organizationId: 'org-a',
      deletedAt: null,
      OR: [
        { id: { in: ['foreign-media', 'deleted-media'] } },
        { path: { in: [] } },
      ],
    });
  });

  it('projects YouTube settings including scoped cover/captions and excludes unknown/nested credentials', async () => {
    rows = [
      post('post-a', {
        integration: { ...rows[0].integration, providerIdentifier: 'youtube' },
        settings: JSON.stringify({
          __type: 'youtube',
          title: 'Approved title',
          type: 'public',
          selfDeclaredMadeForKids: 'no',
          tags: [
            { value: 'nonprofit', label: 'Nonprofit', apiKey: 'NESTED-SECRET' },
          ],
          categoryId: '27',
          publishAt: date.toISOString(),
          defaultLanguage: 'en',
          recordingDate: '2026-09-30',
          captionsLanguage: 'en',
          thumbnail: { id: 'cover-a', token: 'THUMBNAIL-SECRET' },
          captions: { id: 'captions-a' },
          token: 'SETTINGS-SECRET',
        }),
      }),
    ];
    mediaRows.push(
      attachment('cover-a', { type: 'image' }),
      attachment('captions-a', { type: 'caption' })
    );
    const body = await (await get()).json();
    expect(body.posts[0].settings).toEqual({
      __type: 'youtube',
      title: 'Approved title',
      type: 'public',
      selfDeclaredMadeForKids: 'no',
      tags: [{ value: 'nonprofit', label: 'Nonprofit' }],
      categoryId: '27',
      publishAt: date.toISOString(),
      defaultLanguage: 'en',
      recordingDate: '2026-09-30',
      captionsLanguage: 'en',
      thumbnail: {
        id: 'cover-a',
        name: 'cover-a.mp4',
        type: 'image',
        url: 'https://cdn.example.test/cover-a.mp4',
        thumbnail: null,
        alt: null,
      },
      captions: {
        id: 'captions-a',
        name: 'captions-a.mp4',
        type: 'caption',
        url: 'https://cdn.example.test/captions-a.mp4',
        thumbnail: null,
        alt: null,
      },
    });
    expect(body.posts[0].settingsComplete).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(
      /SECRET|TOKEN|REFRESH|RETURN-KEY|privatePath/
    );
  });

  it('flags a stored attachment id/path mismatch instead of claiming an exact media read', async () => {
    rows[0].image = JSON.stringify([
      { id: 'video-a', path: 'https://other.example.test/unverified.mp4' },
    ]);
    const body = await (await get()).json();
    expect(body.posts[0].image[0].url).toBeNull();
    expect(body.posts[0].mediaComplete).toBe(false);
    expect(JSON.stringify(body)).not.toContain('unverified.mp4');
  });

  it('reports unsupported provider settings as incomplete without exposing arbitrary JSON', async () => {
    rows[0].integration.providerIdentifier = 'other-provider';
    rows[0].settings = JSON.stringify({
      accessToken: 'NOT-PUBLIC',
      customInstanceDetails: { apiKey: 'NOT-PUBLIC' },
    });
    const body = await (await get()).json();
    expect(body.posts[0].settings).toEqual({ __type: 'other-provider' });
    expect(body.posts[0].settingsComplete).toBe(false);
  });

  it('handles malformed stored JSON and missing attachments without hiding the incomplete read', async () => {
    rows[0].image = '{malformed';
    rows[0].settings = '{malformed';
    const body = await (await get()).json();
    expect(body.posts[0].image).toEqual([]);
    expect(body.posts[0].mediaComplete).toBe(false);
    expect(body.posts[0].settingsComplete).toBe(false);
  });

  it('does not return server filesystem paths or credential-bearing URLs', async () => {
    mediaRows[0].path = 'C:\\private\\video.mp4';
    mediaRows[0].thumbnail = 'https://user:password@cdn.example.test/cover.png';
    rows[0].image = JSON.stringify([
      { id: 'video-a', thumbnail: '/tmp/private.png' },
    ]);
    const body = await (await get()).json();
    expect(body.posts[0].image[0]).toMatchObject({
      url: null,
      thumbnail: null,
    });
    expect(body.posts[0].mediaComplete).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(
      /private|password|token|apiKey|refreshToken/
    );
    expect(
      publicMediaUrl('https://cdn.example.test/a.mp4?apiKey=SECRET#TOKEN')
    ).toBeNull();
  });

  it('bounds a corrupt cyclic comment chain and reports incompleteness', async () => {
    rows[0].parentPostId = 'reply-a';
    const body = await (await get()).json();
    expect(body.threadComplete).toBe(false);
    expect(body.posts).toHaveLength(3);
    expect(postsModel.findMany).toHaveBeenCalledTimes(3);
  });
});
