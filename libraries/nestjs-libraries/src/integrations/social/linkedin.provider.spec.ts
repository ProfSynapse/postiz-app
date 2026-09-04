jest.mock('@gitroom/helpers/utils/concurrency.service', () => ({
  concurrency: async (_id: string, _max: number, fn: () => Promise<unknown>) =>
    fn(),
}));

import { LinkedinProvider } from './linkedin.provider';

class TestableLinkedinProvider extends LinkedinProvider {
  formatText(text: string) {
    return this.fixText(text);
  }
}

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

describe('LinkedinProvider mention formatting', () => {
  const provider = new TestableLinkedinProvider();

  it('preserves organization mention tokens', () => {
    const mention = '@[Synaptic Labs](urn:li:organization:123456)';

    expect(provider.formatText('Hello ' + mention)).toBe('Hello ' + mention);
  });

  it('preserves person mention tokens', () => {
    const mention = '@[Joseph](urn:li:person:94YtzFQ6hd)';

    expect(provider.formatText('Building with ' + mention + ' #AI')).toBe(
      'Building with ' + mention + ' \\#AI'
    );
  });

  it('does not preserve web-profile ids relabeled as person URNs', () => {
    expect(
      provider.formatText(
        '@[Laurie](urn:li:person:ACoAAAcTm18BC-lN0wBZr5RgbtIdo7rk-RwMRjw)'
      )
    ).toBe(
      '\\@\\[Laurie\\]\\(urn:li:person:ACoAAAcTm18BC-lN0wBZr5RgbtIdo7rk-RwMRjw\\)'
    );
  });

  it('continues to escape ordinary LinkedIn text', () => {
    expect(provider.formatText('Hello @someone [link](https://example.com)')).toBe(
      'Hello \\@someone \\[link\\]\\(https://example.com\\)'
    );
  });

  it('does not preserve member or mini-profile URNs as mentions', () => {
    expect(
      provider.formatText('@[Laurie](urn:li:member:118725471)')
    ).toBe('\\@\\[Laurie\\]\\(urn:li:member:118725471\\)');
    expect(
      provider.formatText(
        '@[Laurie](urn:li:fs_miniProfile:ACoAAAcTm18BC-lN0wBZr5RgbtIdo7rk-RwMRjw)'
      )
    ).toBe(
      '\\@\\[Laurie\\]\\(urn:li:fs\\_miniProfile:ACoAAAcTm18BC-lN0wBZr5RgbtIdo7rk-RwMRjw\\)'
    );
  });

  it('escapes malformed person mention tokens', () => {
    expect(provider.formatText('@[Laurie](urn:li:person:)')).toBe(
      '\\@\\[Laurie\\]\\(urn:li:person:\\)'
    );
  });
});
