import {
  mergeReconnectAuth,
  youtubeTokenExpiration,
} from './auth-token-expiry';

describe('OAuth expiry preservation', () => {
  it('keeps the Google lifetime while choosing the requested channel', () => {
    const auth = {
      id: 'google-user',
      name: 'User',
      accessToken: 'test-access',
      refreshToken: 'test-refresh',
      expiresIn: 3600,
    } as any;
    const selected = {
      id: 'youtube-channel',
      name: 'Channel',
      accessToken: 'channel-access',
    } as any;
    expect(mergeReconnectAuth(auth, selected, 'test-refresh')).toMatchObject({
      id: 'youtube-channel',
      expiresIn: 3600,
      refreshToken: 'test-refresh',
      accessToken: 'channel-access',
    });
  });
  it.each([undefined, '', 'request-fallback'])(
    "keeps Google's fresh refresh grant over request field %s",
    (requestGrant) => {
      const auth = {
        id: 'user',
        name: 'User',
        accessToken: 'test-access',
        refreshToken: 'test-google-grant',
        expiresIn: 3600,
      } as any;
      const selected = {
        id: 'channel',
        name: 'Channel',
        accessToken: 'test-access',
      } as any;
      expect(
        mergeReconnectAuth(auth, selected, requestGrant as any).refreshToken
      ).toBe('test-google-grant');
    }
  );
  it('uses the request grant only when the provider returns no new grant', () => {
    const auth = {
      id: 'user',
      name: 'User',
      accessToken: 'test-access',
      expiresIn: 3600,
    } as any;
    const selected = {
      id: 'channel',
      name: 'Channel',
      accessToken: 'test-access',
    } as any;
    expect(
      mergeReconnectAuth(auth, selected, 'test-existing-grant').refreshToken
    ).toBe('test-existing-grant');
  });
  it('stores the actual short-lived expiry', () => {
    expect(youtubeTokenExpiration(3600, 1000).getTime()).toBe(3601000);
  });
  it.each([undefined, 0, -1, NaN, Infinity, 999999999])(
    'treats invalid/legacy expiry %s as due now',
    (value) => {
      expect(youtubeTokenExpiration(value, 1000).getTime()).toBe(1000);
    }
  );
});
