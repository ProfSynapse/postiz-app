import 'reflect-metadata';
jest.mock('@gitroom/helpers/utils/concurrency.service', () => ({
  concurrency: async (_id: string, _limit: number, fn: () => unknown) => fn(),
}));
import { InstagramProvider } from './instagram.provider';
import { InstagramStandaloneProvider } from './instagram.standalone.provider';

const DAY = 86400;
const TOKEN = 'test-instagram-secret';
const NOW = new Date('2026-10-13T13:00:00Z');
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const daily = (name: string, value = 4) => ({
  name,
  values: [{ end_time: '2026-10-12T07:00:00Z', value }],
});
const total = (name: string, value = 3) => ({ name, total_value: { value } });

describe('Instagram analytics', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(NOW);
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it.each([7, 29, 30, 90])(
    'keeps %i-day requests inside the exact Meta window limit',
    async (days) => {
      const seen: URL[] = [];
      global.fetch = jest.fn(async (input, init) => {
        const url = new URL(String(input));
        seen.push(url);
        expect(String(input)).not.toContain(TOKEN);
        expect(init?.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
        const since = Number(url.searchParams.get('since'));
        const until = Number(url.searchParams.get('until'));
        if (until - since > 30 * DAY)
          return response({ error: { code: 100 } }, 400);
        const metrics = url.searchParams.get('metric')!.split(',');
        return response({
          data: metrics.map((name) =>
            url.searchParams.has('metric_type') ? total(name) : daily(name)
          ),
        });
      });
      const result = await new InstagramProvider().analytics(
        'account',
        TOKEN,
        days
      );
      expect(result.find((row) => row.label === 'Reach')).toBeDefined();
      expect(result.find((row) => row.label === 'Likes')?.data).toEqual([
        { total: days === 90 ? 9 : 3, date: '2026-10-13' },
      ]);
      const windows = seen.filter((url) => url.searchParams.has('metric_type'));
      expect(windows).toHaveLength(Math.ceil(days / 30));
      expect(Number(windows[0].searchParams.get('since'))).toBe(
        NOW.getTime() / 1000 - days * DAY
      );
      expect(Number(windows.at(-1)!.searchParams.get('until'))).toBe(
        NOW.getTime() / 1000
      );
      for (let i = 1; i < windows.length; i++) {
        expect(windows[i].searchParams.get('since')).toBe(
          windows[i - 1].searchParams.get('until')
        );
      }
      if (days === 90)
        expect(result.some((row) => row.label === 'Follower Count')).toBe(
          false
        );
    }
  );

  it('keeps reach and valid totals when one metric is rejected', async () => {
    global.fetch = jest.fn(async (input) => {
      const url = new URL(String(input));
      const metrics = url.searchParams.get('metric')!.split(',');
      if (metrics.includes('replies'))
        return response({ error: { code: 100 } }, 400);
      return response({
        data: metrics.map((name) =>
          url.searchParams.has('metric_type') ? total(name) : daily(name)
        ),
      });
    });
    const result = await new InstagramProvider().analytics(
      'account',
      TOKEN,
      30
    );
    expect(result.map((row) => row.label)).toEqual([
      'Follower Count',
      'Reach',
      'Likes',
      'Views',
      'Comments',
      'Shares',
      'Saves',
    ]);
  });

  it('omits incomplete 90-day metrics instead of treating a missing window as zero', async () => {
    global.fetch = jest.fn(async (input) => {
      const url = new URL(String(input));
      const first =
        Number(url.searchParams.get('since')) ===
        NOW.getTime() / 1000 - 90 * DAY;
      return response({ data: first ? [] : [total('likes')] });
    });
    expect(
      await new InstagramProvider().analytics('account', TOKEN, 90)
    ).toEqual([]);
  });

  it.each([401, 429, 500])(
    'does not fan out HTTP %i failures or leak provider errors',
    async (status) => {
      global.fetch = jest.fn(async () =>
        response({ error: { code: status, message: TOKEN } }, status)
      );
      await expect(
        new InstagramProvider().analytics('account', TOKEN, 30)
      ).rejects.toThrow('Instagram insights request failed');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    }
  );

  it('uses the same fix for standalone Instagram', async () => {
    global.fetch = jest.fn(async (input) => {
      expect(new URL(String(input)).hostname).toBe('graph.instagram.com');
      return response({ data: [] });
    });
    expect(
      await new InstagramStandaloneProvider().analytics('account', TOKEN, 30)
    ).toEqual([]);
  });
});
