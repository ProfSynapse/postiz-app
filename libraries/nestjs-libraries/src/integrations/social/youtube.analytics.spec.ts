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

    it('uses current counts when delayed Analytics contains only pre-publication zero rows', async () => {
      reportsQuery.mockResolvedValue({
        data: {
          columnHeaders: [{ name: 'day' }, { name: 'views' }],
          rows: [
            ['2026-10-20', 0],
            ['2026-10-21', 0],
          ],
        },
      });
      videosList.mockResolvedValue({
        data: {
          items: [
            {
              statistics: {
                viewCount: '62',
                likeCount: '0',
                commentCount: '0',
              },
            },
          ],
        },
      });
      const result = await new YoutubeProvider().postAnalytics(
        'c',
        TOKEN,
        'vid',
        365
      );
      expect(videosList).toHaveBeenCalledWith({
        part: ['statistics'],
        id: ['vid'],
      });
      expect(result.find((metric) => metric.label === 'Views')).toEqual({
        label: 'Views',
        percentageChange: 0,
        lifetime: true,
        data: [{ total: '62', date: '2026-10-22' }],
      });
    });

    it('keeps a genuine zero lifetime count as zero', async () => {
      reportsQuery.mockResolvedValue({
        data: {
          columnHeaders: [{ name: 'day' }, { name: 'views' }],
          rows: [['2026-10-21', 0]],
        },
      });
      videosList.mockResolvedValue({
        data: { items: [{ statistics: { viewCount: '0' } }] },
      });
      const result = await new YoutubeProvider().postAnalytics(
        'c',
        TOKEN,
        'vid',
        365
      );
      expect(result[0]).toMatchObject({
        label: 'Views',
        lifetime: true,
        data: [{ total: '0', date: '2026-10-22' }],
      });
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
          lifetime: true,
          data: [{ total: '99', date: '2026-10-22' }],
        },
        {
          label: 'Likes',
          percentageChange: 0,
          lifetime: true,
          data: [{ total: '5', date: '2026-10-22' }],
        },
        {
          label: 'Comments',
          percentageChange: 0,
          lifetime: true,
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
      expect(videosList).not.toHaveBeenCalled();
      reportsQuery.mockRejectedValueOnce({ response: { status: 403 } });
      videosList.mockRejectedValueOnce({ response: { status: 403 } });
      await expect(
        new YoutubeProvider().postAnalytics('c', TOKEN, 'vid', 30)
      ).resolves.toEqual([]);
      reportsQuery.mockResolvedValueOnce({ data: {} });
      videosList.mockRejectedValueOnce({ response: { status: 401 } });
      await expect(
        new YoutubeProvider().postAnalytics('c', TOKEN, 'vid', 30)
      ).rejects.toBeInstanceOf(RefreshToken);
    });

    it('falls back to the snapshot when the Analytics report fails', async () => {
      reportsQuery.mockRejectedValueOnce({ response: { status: 403 } });
      videosList.mockResolvedValue({
        data: { items: [{ statistics: { viewCount: '42' } }] },
      });
      await expect(
        new YoutubeProvider().postAnalytics('c', TOKEN, 'vid', 30)
      ).resolves.toEqual([
        {
          label: 'Views',
          percentageChange: 0,
          lifetime: true,
          data: [{ total: '42', date: '2026-10-22' }],
        },
      ]);
    });
  });
});
