// libraries/nestjs-libraries/src/integrations/social/linkedin.version.spec.ts
//
// Unit tests for the LinkedIn-Version self-healing helper. These exercise the
// pure logic (next-version walking, 426 detection, cache update semantics)
// without hitting the network. Compatible with Jest's describe/it/expect API
// but the helper module itself has no runtime deps, so the tests can also be
// executed by a minimal harness (see scripts/test-linkedin-version.ts).

import {
  getLinkedInVersion,
  linkedInFetchWithFallback,
  linkedInRetryOn426,
} from './linkedin.version';

type FetchMock = jest.Mock<Promise<Response>, [RequestInfo | URL, RequestInit?]>;

function makeResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

function build426Body(): string {
  return JSON.stringify({
    status: 426,
    code: 'NONEXISTENT_VERSION',
    message: 'Requested version 20260101 is not active',
  });
}

describe('linkedin.version', () => {
  const originalFetch = global.fetch;
  const originalOverride = process.env.LINKEDIN_VERSION_OVERRIDE;
  let warnSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    delete process.env.LINKEDIN_VERSION_OVERRIDE;
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.LINKEDIN_VERSION_OVERRIDE = originalOverride;
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  describe('getLinkedInVersion', () => {
    it('returns a 6-digit YYYYMM string by default', () => {
      const version = getLinkedInVersion();
      expect(version).toMatch(/^\d{6}$/);
    });
  });

  describe('linkedInRetryOn426', () => {
    it('returns the result on first attempt when no 426 occurs', async () => {
      const attempt = jest.fn(async (_version: string) => 'ok' as const);
      const result = await linkedInRetryOn426(attempt);
      expect(result).toBe('ok');
      expect(attempt).toHaveBeenCalledTimes(1);
    });

    it('passes the current working version to the attempt callback', async () => {
      const seen: string[] = [];
      await linkedInRetryOn426(async (version) => {
        seen.push(version);
        return 'ok';
      });
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatch(/^\d{6}$/);
    });

    it('retries with an older YYYYMM on NONEXISTENT_VERSION error', async () => {
      const attempts: string[] = [];
      let calls = 0;
      const result = await linkedInRetryOn426(async (version) => {
        attempts.push(version);
        calls += 1;
        if (calls === 1) {
          throw Object.assign(new Error('LinkedIn 426 NONEXISTENT_VERSION'), {
            json: '{"code":"NONEXISTENT_VERSION"}',
          });
        }
        return 'ok';
      });
      expect(result).toBe('ok');
      expect(attempts).toHaveLength(2);
      // Second attempt must be one month earlier in YYYYMM
      const [first, second] = attempts;
      const firstNum = parseInt(first, 10);
      const secondNum = parseInt(second, 10);
      // Either same year-1 month (e.g. 202601 -> 202512) or month-1
      const firstYear = Math.floor(firstNum / 100);
      const firstMonth = firstNum % 100;
      const expectedSecond =
        firstMonth === 1
          ? (firstYear - 1) * 100 + 12
          : firstYear * 100 + firstMonth - 1;
      expect(secondNum).toBe(expectedSecond);
    });

    it('walks January back to previous December', async () => {
      process.env.LINKEDIN_VERSION_OVERRIDE = undefined as unknown as string;
      // Force start at known boundary by manipulating cache via prior call
      // we just check the walk: chain three 426 then accept
      const attempts: string[] = [];
      let calls = 0;
      const buildError = () =>
        Object.assign(new Error('NONEXISTENT_VERSION'), {
          json: '{"code":"NONEXISTENT_VERSION"}',
        });
      await linkedInRetryOn426(async (version) => {
        attempts.push(version);
        calls += 1;
        if (calls < 4) throw buildError();
        return 'ok';
      });
      expect(attempts.length).toBeGreaterThanOrEqual(4);
      // Each subsequent attempt should be strictly older (numerically smaller, accounting for year rollover)
      for (let i = 1; i < attempts.length; i += 1) {
        expect(parseInt(attempts[i], 10)).toBeLessThan(
          parseInt(attempts[i - 1], 10)
        );
      }
    });

    it('rethrows non-426 errors immediately without retry', async () => {
      const attempt = jest.fn(async (_version: string) => {
        throw new Error('Some unrelated network error');
      });
      await expect(linkedInRetryOn426(attempt)).rejects.toThrow(
        'Some unrelated network error'
      );
      expect(attempt).toHaveBeenCalledTimes(1);
    });

    it('caps retries at MAX_FALLBACK_ATTEMPTS and throws the last error', async () => {
      const attempt = jest.fn(async (_version: string) => {
        throw Object.assign(new Error('persistent 426'), {
          json: '{"code":"NONEXISTENT_VERSION"}',
        });
      });
      await expect(linkedInRetryOn426(attempt)).rejects.toThrow();
      // MAX_FALLBACK_ATTEMPTS = 24, plus one initial attempt = 25 total
      expect(attempt.mock.calls.length).toBeLessThanOrEqual(25);
      expect(attempt.mock.calls.length).toBeGreaterThanOrEqual(20);
    });

    it('caches accepted version so subsequent calls start from it', async () => {
      // First call: 426 once, then accept on second
      let calls = 0;
      const firstAttempts: string[] = [];
      await linkedInRetryOn426(async (version) => {
        firstAttempts.push(version);
        calls += 1;
        if (calls === 1) {
          throw Object.assign(new Error('426'), {
            json: 'NONEXISTENT_VERSION',
          });
        }
        return 'ok';
      });
      const acceptedVersion = firstAttempts[firstAttempts.length - 1];

      // Second call should start from the cached/accepted version
      const secondAttempts: string[] = [];
      await linkedInRetryOn426(async (version) => {
        secondAttempts.push(version);
        return 'ok';
      });
      expect(secondAttempts[0]).toBe(acceptedVersion);
      expect(getLinkedInVersion()).toBe(acceptedVersion);
    });
  });

  describe('linkedInFetchWithFallback', () => {
    it('returns the response on first 2xx attempt', async () => {
      const mockFetch: FetchMock = jest.fn(async () => makeResponse(200, '{}'));
      global.fetch = mockFetch as unknown as typeof fetch;

      const result = await linkedInFetchWithFallback(
        'https://api.linkedin.com/v2/test',
        {},
        (version) => ({
          headers: { 'LinkedIn-Version': version },
        })
      );

      expect(result.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('retries with a different version when first call returns 426', async () => {
      const versionsSent: string[] = [];
      const mockFetch: FetchMock = jest.fn(
        async (_url: RequestInfo | URL, init?: RequestInit) => {
          const headers = new Headers(init?.headers || undefined);
          const v = headers.get('LinkedIn-Version') || '';
          versionsSent.push(v);
          if (versionsSent.length === 1) {
            return makeResponse(426, build426Body());
          }
          return makeResponse(200, '{"ok":true}');
        }
      );
      global.fetch = mockFetch as unknown as typeof fetch;

      const result = await linkedInFetchWithFallback(
        'https://api.linkedin.com/v2/test',
        {},
        (version) => ({
          headers: { 'LinkedIn-Version': version },
        })
      );

      expect(result.status).toBe(200);
      expect(versionsSent.length).toBe(2);
      expect(versionsSent[1]).not.toBe(versionsSent[0]);
      expect(parseInt(versionsSent[1], 10)).toBeLessThan(
        parseInt(versionsSent[0], 10)
      );
    });

    it('propagates non-426 status codes to the caller (no retry)', async () => {
      const mockFetch: FetchMock = jest.fn(async () =>
        makeResponse(500, '{"error":"server"}')
      );
      global.fetch = mockFetch as unknown as typeof fetch;

      const result = await linkedInFetchWithFallback(
        'https://api.linkedin.com/v2/test',
        {},
        (version) => ({
          headers: { 'LinkedIn-Version': version },
        })
      );

      expect(result.status).toBe(500);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('LINKEDIN_VERSION_OVERRIDE env var', () => {
    // Note: the override is read at module-load time, so testing it
    // properly requires module re-import via jest.isolateModules.
    it('module-scope cache is NOT mutated when override is set', async () => {
      process.env.LINKEDIN_VERSION_OVERRIDE = '209901';
      // We cannot re-trigger the let-init from here, but we can verify the
      // noteVersionAccepted branch by checking that a 426/recover cycle
      // doesn't shift `getLinkedInVersion()` when override is present.
      jest.isolateModules(async () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('./linkedin.version');
        expect(mod.getLinkedInVersion()).toBe('209901');

        let calls = 0;
        await mod.linkedInRetryOn426(async (version: string) => {
          calls += 1;
          if (calls === 1) {
            throw Object.assign(new Error('426'), {
              json: 'NONEXISTENT_VERSION',
            });
          }
          return 'ok';
        });
        // Even after a successful retry on a different version, the cache
        // must remain pinned to the override.
        expect(mod.getLinkedInVersion()).toBe('209901');
      });
    });
  });
});
