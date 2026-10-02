import type { AuthTokenDetails } from './social/social.integrations.interface';

/** Selecting a channel must not discard the OAuth response's real expiry. */
export function mergeReconnectAuth(
  auth: AuthTokenDetails,
  channel: Omit<AuthTokenDetails, 'refreshToken' | 'expiresIn'>,
  refreshToken: string
): AuthTokenDetails {
  return { ...auth, ...channel, expiresIn: auth.expiresIn, refreshToken };
}

/** Missing/legacy synthetic YouTube expiry is due now, never decades away. */
export function youtubeTokenExpiration(
  expiresIn: number | undefined,
  now = Date.now()
): Date {
  const seconds =
    Number.isFinite(expiresIn) && expiresIn! > 0 && expiresIn! <= 86400
      ? expiresIn!
      : 0;
  return new Date(now + seconds * 1000);
}
