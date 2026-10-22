import 'reflect-metadata';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';

jest.mock('@gitroom/helpers/utils/concurrency.service', () => ({
  concurrency: async (_id: string, _max: number, fn: () => Promise<unknown>) =>
    fn(),
}));

const reportsQuery = jest.fn();
const videosList = jest.fn();
jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest
        .fn()
        .mockImplementation(() => ({ setCredentials: jest.fn() })),
    },
    youtube: jest.fn(() => ({ videos: { list: videosList } })),
    youtubeAnalytics: jest.fn(() => ({ reports: { query: reportsQuery } })),
    oauth2: jest.fn(() => ({})),
  },
  youtube_v3: {},
}));

import { YoutubeProvider } from './youtube.provider';
import { InstagramProvider, instagramMediaMetrics } from './instagram.provider';
import { InstagramStandaloneProvider } from './instagram.standalone.provider';
import { FacebookProvider } from './facebook.provider';
import { LinkedinPageProvider } from './linkedin.page.provider';
import { LinkedinProvider } from './linkedin.provider';

const TOKEN = 'test-only-token';
const NOW = new Date('2026-10-22T12:00:00Z');
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe('per-post analytics providers', () => {
  const originalFetch = global.fetch;
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(NOW);
    reportsQuery.mockReset();
    videosList.mockReset();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
    errorSpy.mockRestore();
  });

  describe('YouTube', () => {
    it('queries a daily series filtered to the one video', async () => {
      reportsQuery.mockResolvedValue({
        data: {
          columnHeaders: [
            { name: 'day' },
            { name: 'views' },
            { name: 'estimatedMinutesWatched' },
            { name: 'averageViewDuration' },
            { name: 'averageViewPercentage' },
            { name: 'likes' },
            { name: 'comments' },
            { name: 'shares' },
            { name: 'subscribersGained' },
          ],
          rows: [
            ['2026-10-20', 10, 20, 30, 40.5, 1, 2, 3, 4],
            ['2026-10-21', 11, 21, 31, 41.5, 0, 0, 0, 1],
          ],
        },
      });
      const result = await new YoutubeProvider().postAnalytics(
        'channel',
        TOKEN,
        'dQw4w9WgXcQ',
        7
      );
      expect(reportsQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          ids: 'channel==MINE',
          filters: 'video==dQw4w9WgXcQ',
          dimensions: 'day',
          startDate: '2026-10-15',
          endDate: '2026-10-22',
          metrics:
            'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares,subscribersGained',
        })
      );
      expect(result.map((r) => r.label)).toEqual([
        'Views',
        'Estimated Minutes Watched',
        'Average View Duration',
        'Average View Percentage',
        'Likes',
        'Comments',
        'Shares',
        'Subscribers Gained',
      ]);
      expect(result[0]).toEqual({
        label: 'Views',
        percentageChange: 0,
        data: [
          { total: '10', date: '2026-10-20' },
          { total: '11', date: '2026-10-21' },
        ],
      });
      expect(result[2].average).toBe(true);
      expect(videosList).not.toHaveBeenCalled();
    });

    it('falls back to the lifetime snapshot while Analytics has no rows', async () => {
      reportsQuery.mockResolvedValue({ data: { columnHeaders: [], rows: [] } });
      videosList.mockResolvedValue({
        data: {
          items: [
            {
              statistics: {
                viewCount: '99',
                likeCount: '5',
                commentCount: '1',
              },
            },
          ],
        },
      });
      const result = await new YoutubeProvider().postAnalytics(
        'c',
        TOKEN,
        'vid',
        30
      );
      expect(result).toEqual([
        {
          label: 'Views',
          percentageChange: 0,
          data: [{ total: '99', date: '2026-10-22' }],
        },
        {
          label: 'Likes',
          percentageChange: 0,
          data: [{ total: '5', date: '2026-10-22' }],
        },
        {
          label: 'Comments',
          percentageChange: 0,
          data: [{ total: '1', date: '2026-10-22' }],
        },
      ]);
    });

    it('throws RefreshToken on 401 and returns [] on other errors', async () => {
      reportsQuery.mockRejectedValueOnce({
        response: { status: 401, data: { secret: 'x' } },
      });
      await expect(
        new YoutubeProvider().postAnalytics('c', TOKEN, 'vid', 30)
      ).rejects.toBeInstanceOf(RefreshToken);
      reportsQuery.mockRejectedValueOnce({ response: { status: 403 } });
      await expect(
        new YoutubeProvider().postAnalytics('c', TOKEN, 'vid', 30)
      ).resolves.toEqual([]);
    });
  });

  describe('Instagram', () => {
    it.each([
      ['FEED', false],
      ['REELS', true],
    ])('requests current %s media metrics', async (productType, reels) => {
      const seen: URL[] = [];
      global.fetch = jest.fn(async (input, init) => {
        const url = new URL(String(input));
        seen.push(url);
        expect(String(input)).not.toContain(TOKEN);
        expect(init?.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
        if (!url.pathname.endsWith('/insights'))
          return response({
            media_type: 'VIDEO',
            media_product_type: productType,
          });
        return response({
          data: url.searchParams
            .get('metric')!
            .split(',')
            .map((name, i) => ({ name, values: [{ value: i + 1 }] })),
        });
      }) as any;
      const result = await new InstagramProvider().postAnalytics(
        'acct',
        TOKEN,
        '1789',
        30
      );
      const metrics = seen[1].searchParams.get('metric')!.split(',');
      expect(metrics).not.toContain('impressions');
      expect(metrics).not.toContain('plays');
      expect(metrics.includes('ig_reels_avg_watch_time')).toBe(reels);
      expect(seen[0].host).toBe('graph.facebook.com');
      expect(result.find((r) => r.label === 'Views')?.data).toEqual([
        { total: '1', date: '2026-10-22' },
      ]);
      expect(result.map((r) => r.label)).toEqual(
        expect.arrayContaining([
          'Reach',
          'Saves',
          'Likes',
          'Comments',
          'Shares',
          'Total Interactions',
        ])
      );
    });

    it('keeps valid metrics when Meta rejects one, and uses graph.instagram.com for standalone', async () => {
      const hosts = new Set<string>();
      global.fetch = jest.fn(async (input) => {
        const url = new URL(String(input));
        hosts.add(url.host);
        if (!url.pathname.endsWith('/insights'))
          return response({ media_product_type: 'FEED' });
        const metrics = url.searchParams.get('metric')!.split(',');
        if (metrics.includes('saved'))
          return response(
            { error: { code: 100, message: 'invalid metric' } },
            400
          );
        return response({
          data: metrics.map((name) => ({ name, values: [{ value: 7 }] })),
        });
      }) as any;
      const result = await new InstagramStandaloneProvider().postAnalytics(
        'acct',
        TOKEN,
        '1789',
        30
      );
      expect([...hosts]).toEqual(['graph.instagram.com']);
      expect(result.some((r) => r.label === 'Saves')).toBe(false);
      expect(result.find((r) => r.label === 'Reach')?.data[0].total).toBe('7');
    });

    it('returns [] for album children / media without insights', async () => {
      global.fetch = jest.fn(async (input) =>
        String(input).includes('/insights')
          ? response({ error: { code: 10, message: 'not available' } }, 400)
          : response({ error: { code: 100 } }, 400)
      ) as any;
      await expect(
        new InstagramProvider().postAnalytics('acct', TOKEN, 'child', 30)
      ).resolves.toEqual([]);
    });

    it('chooses metrics per product type', () => {
      expect(instagramMediaMetrics('STORY')).toEqual([
        'views',
        'reach',
        'shares',
        'total_interactions',
      ]);
      expect(instagramMediaMetrics(undefined)).not.toContain(
        'ig_reels_avg_watch_time'
      );
    });
  });

  describe('Facebook Page', () => {
    it('uses current post metrics, never post_impressions*', async () => {
      const seen: URL[] = [];
      global.fetch = jest.fn(async (input, init) => {
        const url = new URL(String(input));
        seen.push(url);
        expect(String(input)).not.toContain(TOKEN);
        expect(init?.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
        if (url.pathname.endsWith('/insights'))
          return response({
            data: [
              { name: 'post_total_media_view_unique', values: [{ value: 40 }] },
              { name: 'post_media_view', values: [{ value: 55 }] },
              { name: 'post_clicks', values: [{ value: 3 }] },
              {
                name: 'post_reactions_by_type_total',
                values: [{ value: { like: 4, love: 2 } }],
              },
            ],
          });
        return response({
          shares: { count: 2 },
          comments: { summary: { total_count: 5 } },
        });
      }) as any;
      const result = await new FacebookProvider().postAnalytics(
        'page',
        TOKEN,
        '123_456',
        30
      );
      const metric = seen
        .find((u) => u.pathname.endsWith('/insights'))!
        .searchParams.get('metric')!;
      expect(metric).not.toMatch(/post_impressions|post_engaged_users/);
      expect(metric.split(',')).toEqual(
        expect.arrayContaining([
          'post_total_media_view_unique',
          'post_media_view',
          'post_clicks',
          'post_reactions_by_type_total',
        ])
      );
      const totals = Object.fromEntries(
        result.map((r) => [r.label, r.data[0].total])
      );
      expect(totals).toEqual({
        Reach: '40',
        Views: '55',
        Clicks: '3',
        Reactions: '6',
        Comments: '5',
        Shares: '2',
      });
    });

    it('routes bare video ids to video_insights', async () => {
      const paths: string[] = [];
      global.fetch = jest.fn(async (input) => {
        const url = new URL(String(input));
        paths.push(url.pathname);
        return response({
          data: [
            { name: 'total_video_views', values: [{ value: 9 }] },
            {
              name: 'post_video_social_actions',
              values: [{ value: { COMMENT: 1, SHARE: 2 } }],
            },
          ],
        });
      }) as any;
      const result = await new FacebookProvider().postAnalytics(
        'page',
        TOKEN,
        '987654',
        30
      );
      expect(paths).toEqual(['/v23.0/987654/video_insights']);
      expect(result).toEqual([
        {
          label: 'Views',
          percentageChange: 0,
          data: [{ total: '9', date: '2026-10-22' }],
        },
        {
          label: 'Engagement',
          percentageChange: 0,
          data: [{ total: '3', date: '2026-10-22' }],
        },
      ]);
    });

    it('retries metrics one by one when one is rejected', async () => {
      global.fetch = jest.fn(async (input) => {
        const url = new URL(String(input));
        if (!url.pathname.endsWith('/insights')) return response({}, 400);
        const metrics = url.searchParams.get('metric')!.split(',');
        if (metrics.length > 1 || metrics[0] === 'post_media_view')
          return response(
            { error: { code: 100, message: 'invalid metric' } },
            400
          );
        return response({
          data: [{ name: metrics[0], values: [{ value: 1 }] }],
        });
      }) as any;
      const result = await new FacebookProvider().postAnalytics(
        'page',
        TOKEN,
        '1_2',
        30
      );
      expect(result.map((r) => r.label).sort()).toEqual([
        'Clicks',
        'Reach',
        'Reactions',
      ]);
    });
  });

  describe('LinkedIn Page', () => {
    it.each([
      ['urn:li:share:7000', 'shares'],
      ['urn:li:ugcPost:7001', 'ugcPosts'],
    ])('queries lifetime statistics for %s', async (urn, param) => {
      const urls: string[] = [];
      global.fetch = jest.fn(async (input) => {
        urls.push(String(input));
        return response({
          elements: [
            {
              [param === 'shares' ? 'share' : 'ugcPost']: urn,
              totalShareStatistics: {
                impressionCount: 100,
                uniqueImpressionsCount: 80,
                clickCount: 5,
                likeCount: 4,
                commentCount: 3,
                shareCount: 2,
                engagement: 0.14,
              },
            },
          ],
        });
      }) as any;
      const result = await new LinkedinPageProvider().postAnalytics(
        '42',
        TOKEN,
        urn,
        30
      );
      expect(urls).toHaveLength(1);
      expect(urls[0]).toContain(`&${param}=List(${encodeURIComponent(urn)})`);
      expect(urls[0]).not.toContain('timeIntervals');
      expect(urls[0]).not.toContain(TOKEN);
      expect(
        Object.fromEntries(result.map((r) => [r.label, r.data[0].total]))
      ).toEqual({
        Impressions: '100',
        'Unique Impressions': '80',
        Clicks: '5',
        Likes: '4',
        Comments: '3',
        Shares: '2',
        Engagement: '0.14',
      });
      expect(result.find((r) => r.label === 'Engagement')?.average).toBe(true);
    });

    it('falls back to socialActions when LinkedIn omits the post', async () => {
      global.fetch = jest.fn(async (input) =>
        String(input).includes('socialActions')
          ? response({
              likesSummary: { totalLikes: 2 },
              commentsSummary: { totalFirstLevelComments: 1 },
            })
          : response({ elements: [] })
      ) as any;
      const result = await new LinkedinPageProvider().postAnalytics(
        '42',
        TOKEN,
        'urn:li:share:1',
        30
      );
      expect(result.map((r) => [r.label, r.data[0].total])).toEqual([
        ['Likes', '2'],
        ['Comments', '1'],
      ]);
    });

    it('returns [] for ids that are not post URNs, and personal LinkedIn has no postAnalytics', async () => {
      global.fetch = jest.fn() as any;
      await expect(
        new LinkedinPageProvider().postAnalytics('42', TOKEN, 'not-a-urn', 30)
      ).resolves.toEqual([]);
      expect(global.fetch).not.toHaveBeenCalled();
      expect((new LinkedinProvider() as any).postAnalytics).toBeUndefined();
    });
  });
});
