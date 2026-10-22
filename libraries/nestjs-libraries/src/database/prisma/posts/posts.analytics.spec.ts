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
const cache = new Map<string, string>();
const redisSet = jest.fn(async (key: string, value: string) => {
  cache.set(key, value);
  return 'OK';
});
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    get: jest.fn(async (key: string) => cache.get(key) ?? null),
    set: (...args: [string, string]) => redisSet(...args),
  },
}));

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import {
  PostsService,
  normalizePostAnalyticsDays,
  parsePostAnalyticsIds,
} from './posts.service';
import { PostsRepository } from './posts.repository';
import { MediaService } from '../media/media.service';
import { IntegrationService } from '../integrations/integration.service';
import { PublicIntegrationsController } from '@gitroom/backend/public-api/routes/v1/public.integrations.controller';
import { PublicAuthMiddleware } from '@gitroom/backend/services/auth/public.auth.middleware';
import { publicApiThrottleBucket } from '@gitroom/nestjs-libraries/throttler/throttler.provider';

const future = new Date(Date.now() + 3600_000);
function channel(id: string, extra: Record<string, any> = {}) {
  return {
    id,
    organizationId: 'org-a',
    internalId: `internal-${id}`,
    providerIdentifier: 'youtube',
    type: 'social',
    token: `token-${id}`,
    refreshToken: 'refresh',
    tokenExpiration: future,
    deletedAt: null as Date | null,
    disabled: false,
    ...extra,
  };
}
function post(id: string, extra: Record<string, any> = {}) {
  return {
    id,
    organizationId: 'org-a',
    deletedAt: null as Date | null,
    releaseId: `release-${id}`,
    integration: channel('yt'),
    ...extra,
  };
}
function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if ('in' in value) return value.in.includes(row[key]);
      return row[key] ? matches(row[key], value) : false;
    }
    return row[key] === value;
  });
}
const series = (total: number) => [
  {
    label: 'Views',
    percentageChange: 0,
    data: [{ date: '2026-10-21', total }],
  },
];

describe('Per-post analytics', () => {
  let app: INestApplication;
  let base: string;
  let rows: any[];
  let postsModel: Record<string, jest.Mock>;
  let providers: Record<string, any>;
  let refresh: jest.Mock;
  let disconnectChannel: jest.Mock;
  let checkAnalytics: jest.Mock;
  const env = process.env.NODE_ENV;

  beforeEach(async () => {
    process.env.NODE_ENV = 'production';
    cache.clear();
    redisSet.mockClear();
    const shared = channel('yt');
    rows = [
      post('post-a', { integration: shared }),
      post('post-b', { integration: shared }),
      post('foreign', { organizationId: 'org-b' }),
      post('foreign-channel', {
        integration: channel('other', { organizationId: 'org-b' }),
      }),
      post('deleted', { deletedAt: new Date() }),
      post('no-release', { releaseId: null }),
      post('x-post', {
        integration: channel('x', { providerIdentifier: 'x' }),
      }),
      post('disabled', { integration: channel('off', { disabled: true }) }),
    ];
    // findMany returns fresh copies, like Prisma does.
    postsModel = {
      findMany: jest.fn(async ({ where }) =>
        rows
          .filter((row) => matches(row, where))
          .map((row) => ({ ...row, integration: { ...row.integration } }))
      ),
      update: jest.fn(() => {
        throw new Error('analytics must not write posts');
      }),
    };
    providers = {
      youtube: {
        identifier: 'youtube',
        postAnalytics: jest.fn(async (_i, _t, releaseId: string) =>
          series(releaseId.length)
        ),
      },
      x: { identifier: 'x' },
    };
    refresh = jest.fn(async () => ({
      accessToken: 'fresh-token',
      expiresIn: 3600,
    }));
    disconnectChannel = jest.fn();
    checkAnalytics = jest.fn();
    const repository = new PostsRepository(
      { model: { post: postsModel } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    const service = new PostsService(
      repository,
      {} as any,
      { getSocialIntegration: (id: string) => providers[id] } as any,
      {} as any,
      {} as any,
      {} as any,
      { disconnectChannel } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { refresh } as any
    );
    const module = await Test.createTestingModule({
      controllers: [PublicIntegrationsController],
      providers: [
        { provide: PostsService, useValue: service },
        { provide: IntegrationService, useValue: { checkAnalytics } },
        { provide: MediaService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    const middleware = new PublicAuthMiddleware({
      getOrgByApiKey: jest.fn(async (key) =>
        key === 'test-only-key' ? { id: 'org-a', subscription: {} } : null
      ),
    } as any);
    app.use('/api/public/v1', middleware.use.bind(middleware));
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });

  afterEach(async () => {
    process.env.NODE_ENV = env;
    expect(postsModel.update).not.toHaveBeenCalled();
    await app.close();
  });

  const get = (path: string, key: string | null = 'test-only-key') =>
    fetch(`${base}/api/public/v1${path}`, {
      headers: key ? { Authorization: key } : {},
    });

  it('requires the API key', async () => {
    expect((await get('/analytics/posts?ids=post-a', null)).status).toBe(401);
    expect((await get('/analytics/post/post-a', null)).status).toBe(401);
    expect(postsModel.findMany).not.toHaveBeenCalled();
  });

  it('returns one map for a batch, scoped to the API key organization', async () => {
    const ids = [
      'post-a',
      'post-b',
      'foreign',
      'foreign-channel',
      'deleted',
      'no-release',
      'x-post',
      'disabled',
      'unknown',
    ];
    const res = await get(`/analytics/posts?ids=${ids.join(',')}&date=7`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual([...ids].sort());
    expect(body['post-a']).toEqual([
      {
        label: 'Views',
        percentageChange: 0,
        data: [{ date: '2026-10-21', total: String('release-post-a'.length) }],
      },
    ]);
    expect(body['post-b']).toHaveLength(1);
    for (const id of ids.slice(2)) expect(body[id]).toEqual([]);
    // Never treated as /analytics/:integration with integration "posts".
    expect(checkAnalytics).not.toHaveBeenCalled();
    expect(postsModel.findMany).toHaveBeenCalledTimes(1);
    expect(postsModel.findMany.mock.calls[0][0].where).toMatchObject({
      organizationId: 'org-a',
      deletedAt: null,
      integration: { organizationId: 'org-a', deletedAt: null },
    });
    const calls = providers.youtube.postAnalytics.mock.calls;
    expect(calls.map((c: any[]) => c[2]).sort()).toEqual([
      'release-post-a',
      'release-post-b',
    ]);
    expect(calls[0]).toEqual([
      'internal-yt',
      'token-yt',
      expect.any(String),
      7,
    ]);
  });

  it('serves the single-post route with upstream shape and [] for foreign posts', async () => {
    const res = await get('/analytics/post/post-a?date=30');
    expect(res.status).toBe(200);
    expect((await res.json())[0].label).toBe('Views');
    expect(await (await get('/analytics/post/foreign')).json()).toEqual([]);
    expect(await (await get('/analytics/post/x-post')).json()).toEqual([]);
  });

  it.each([
    ['', 'missing'],
    ['?ids=', 'empty'],
    [
      `?ids=${Array.from({ length: 21 }, (_, i) => `p${i}`).join(',')}`,
      '21 ids',
    ],
    ['?ids=post-a,../etc', 'invalid id'],
  ])('rejects %s (%s) with 400', async (query) => {
    expect((await get(`/analytics/posts${query}`)).status).toBe(400);
    expect(postsModel.findMany).not.toHaveBeenCalled();
  });

  it('accepts 20 ids, deduplicated, and repeated ids params', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `p${i}`);
    const res = await get(`/analytics/posts?ids=${ids.join(',')},p0&ids=p1`);
    expect(res.status).toBe(200);
    expect(Object.keys(await res.json())).toHaveLength(20);
  });

  it('caches results in Redis, briefly when empty', async () => {
    providers.youtube.postAnalytics.mockResolvedValueOnce([]);
    await get('/analytics/posts?ids=post-a,post-b&date=7');
    const ttl = Object.fromEntries(
      redisSet.mock.calls.map((c: any[]) => [c[0], c[3]])
    );
    expect(Object.values(ttl).sort()).toEqual([300, 3600]);
    expect(Object.keys(ttl).sort()).toEqual([
      'integration:org-a:post-a:7',
      'integration:org-a:post-b:7',
    ]);
    providers.youtube.postAnalytics.mockClear();
    await get('/analytics/posts?ids=post-a,post-b&date=7');
    expect(providers.youtube.postAnalytics).not.toHaveBeenCalled();
  });

  it('refreshes an expired channel token once for the whole batch', async () => {
    rows[0].integration.tokenExpiration = new Date(Date.now() - 1000);
    const res = await get('/analytics/posts?ids=post-a,post-b');
    expect(res.status).toBe(200);
    expect(refresh).toHaveBeenCalledTimes(1);
    for (const call of providers.youtube.postAnalytics.mock.calls)
      expect(call[1]).toBe('fresh-token');
  });

  it('refreshes and disconnects a failing channel once per batch', async () => {
    const shared = channel('yt', {
      tokenExpiration: new Date(Date.now() - 1000),
    });
    rows = Array.from({ length: 10 }, (_, i) =>
      post(`expired-${i}`, { integration: shared })
    );
    // Facebook-style refresh: no new access token.
    refresh.mockResolvedValue({ accessToken: '', expiresIn: 0 });
    const ids = rows.map((r) => r.id).join(',');
    const res = await get(`/analytics/posts?ids=${ids}`);
    expect(res.status).toBe(200);
    expect(Object.values(await res.json())).toEqual(rows.map(() => []));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(disconnectChannel).toHaveBeenCalledTimes(1);
    expect(providers.youtube.postAnalytics).not.toHaveBeenCalled();
    // Failed results are not cached, so the next poll must not retry either
    // once the channel is marked for reconnection.
    shared.refreshNeeded = true;
    await get(`/analytics/posts?ids=${ids}`);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(disconnectChannel).toHaveBeenCalledTimes(1);
  });

  it('skips channels waiting for reconnection or setup', async () => {
    rows = [
      post('needs-refresh', {
        integration: channel('r', {
          refreshNeeded: true,
          tokenExpiration: new Date(Date.now() - 1000),
        }),
      }),
      post('between-steps', {
        integration: channel('b', { inBetweenSteps: true }),
      }),
    ];
    const res = await get('/analytics/posts?ids=needs-refresh,between-steps');
    expect(await res.json()).toEqual({
      'needs-refresh': [],
      'between-steps': [],
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(providers.youtube.postAnalytics).not.toHaveBeenCalled();
  });

  it('passes the lifetime marker through', async () => {
    providers.youtube.postAnalytics.mockResolvedValueOnce([
      {
        label: 'Views',
        percentageChange: 0,
        lifetime: true,
        extra: 'dropped',
        data: [{ date: '2026-10-22', total: 5 }],
      },
    ]);
    const res = await get('/analytics/post/post-a');
    expect(await res.json()).toEqual([
      {
        label: 'Views',
        percentageChange: 0,
        lifetime: true,
        data: [{ date: '2026-10-22', total: '5' }],
      },
    ]);
  });

  it('retries once with a refreshed token on RefreshToken', async () => {
    providers.youtube.postAnalytics
      .mockRejectedValueOnce(new (RefreshToken as any)())
      .mockRejectedValueOnce(new (RefreshToken as any)());
    const res = await get('/analytics/post/post-a');
    expect(await res.json()).toEqual([]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(providers.youtube.postAnalytics).toHaveBeenCalledTimes(2);
    expect(providers.youtube.postAnalytics.mock.calls[1][1]).toBe(
      'fresh-token'
    );
  });

  it('normalizes the look-back window and ids', () => {
    expect(normalizePostAnalyticsDays(NaN)).toBe(30);
    expect(normalizePostAnalyticsDays(0)).toBe(30);
    expect(normalizePostAnalyticsDays(7.9)).toBe(7);
    expect(normalizePostAnalyticsDays(10000)).toBe(365);
    expect(parsePostAnalyticsIds(['a,b', ' c ', 'a'])).toEqual(['a', 'b', 'c']);
  });

  it('exposes releaseId in GET /public/v1/posts', async () => {
    postsModel.findMany.mockResolvedValueOnce([]);
    await get(
      '/posts?startDate=2026-10-01T00:00:00Z&endDate=2026-10-31T00:00:00Z'
    );
    expect(postsModel.findMany.mock.calls[0][0].select.releaseId).toBe(true);
  });
});

describe('public API throttle buckets', () => {
  it.each([
    ['/public/v1/posts', 'posts'],
    ['/api/public/v1/posts?startDate=x', 'posts'],
    ['/public/v1/posts/abc/statistics', 'posts'],
    ['/public/v1/upload', 'other'],
    ['/public/v1/upload-from-url', 'other'],
    ['/public/v1/analytics/posts?ids=a,b', null],
    ['/public/v1/analytics/post/abc', null],
    ['/public/v1/analytics/integration-id', null],
    ['/public/v1/integrations', null],
  ])('%s -> %s', (url, bucket) => {
    expect(publicApiThrottleBucket(url)).toBe(bucket);
  });
});
