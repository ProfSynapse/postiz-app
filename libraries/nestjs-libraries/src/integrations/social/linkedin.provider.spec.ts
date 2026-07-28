jest.mock('@gitroom/helpers/utils/concurrency.service', () => ({
  concurrency: async (_id: string, _max: number, fn: () => Promise<unknown>) =>
    fn(),
}));

import { LinkedinProvider } from './linkedin.provider';

type FetchMock = jest.Mock<
  Promise<Response>,
  [RequestInfo | URL, RequestInit?]
>;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('LinkedinProvider authentication identity', () => {
  const originalFetch = global.fetch;
  const originalFrontendUrl = process.env.FRONTEND_URL;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://postiz.example.com';
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.FRONTEND_URL = originalFrontendUrl;
    logSpy.mockRestore();
  });

  it('prefers the Person ID used for posting over a different OIDC subject', async () => {
    const mockFetch: FetchMock = jest.fn(async (input, init) => {
      const url = String(input);
      if (url.includes('/oauth/v2/accessToken')) {
        return jsonResponse({
          access_token: 'access-token',
          expires_in: 3600,
          scope: 'openid,profile,w_member_social',
        });
      }
      if (url.endsWith('/v2/userinfo')) {
        return jsonResponse({
          sub: 'oidc-subject',
          name: 'Joseph Rosenbaum, MSW',
          picture: 'https://example.com/avatar.jpg',
        });
      }
      if (url.endsWith('/v2/me')) {
        expect(
          new Headers(init?.headers).get('X-RestLi-Protocol-Version')
        ).toBe('2.0.0');
        return jsonResponse({
          id: 'SZ6-rkCEFa',
          vanityName: 'joseph-rosenbaum',
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const result = await new LinkedinProvider().authenticate({
      code: 'oauth-code',
      codeVerifier: 'unused',
    });

    expect(result).toMatchObject({
      id: 'SZ6-rkCEFa',
      name: 'Joseph Rosenbaum, MSW',
      username: 'joseph-rosenbaum',
      accessToken: 'access-token',
    });
  });

  it('falls back to the OIDC subject when the legacy Profile API is unavailable', async () => {
    const mockFetch: FetchMock = jest.fn(async (input) => {
      const url = String(input);
      if (url.includes('/oauth/v2/accessToken')) {
        return jsonResponse({
          access_token: 'access-token',
          expires_in: 3600,
          scope: 'openid profile w_member_social',
        });
      }
      if (url.endsWith('/v2/userinfo')) {
        return jsonResponse({ sub: 'oidc-subject', name: 'Joseph Rosenbaum' });
      }
      if (url.endsWith('/v2/me')) {
        return jsonResponse({ message: 'Forbidden' }, 403);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const result = await new LinkedinProvider().authenticate({
      code: 'oauth-code',
      codeVerifier: 'unused',
    });

    expect(result.id).toBe('oidc-subject');
  });
});
