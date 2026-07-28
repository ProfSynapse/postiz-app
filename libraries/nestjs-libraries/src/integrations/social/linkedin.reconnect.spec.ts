jest.mock('@gitroom/helpers/utils/concurrency.service', () => ({
  concurrency: async (_id: string, _max: number, fn: () => Promise<unknown>) =>
    fn(),
}));

import { NotEnoughScopes } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { resolveLinkedInReconnectId } from './linkedin.reconnect';

const existing = {
  internalId: 'legacy-person-id',
  name: 'Joseph Rosenbaum, MSW',
  providerIdentifier: 'linkedin',
};

describe('resolveLinkedInReconnectId', () => {
  it('keeps the authenticated ID for a new connection', () => {
    expect(
      resolveLinkedInReconnectId(
        'linkedin',
        'oidc-subject',
        existing.name,
        null
      )
    ).toBe('oidc-subject');
  });

  it('accepts a new LinkedIn identity for the matching legacy channel', () => {
    expect(
      resolveLinkedInReconnectId(
        'linkedin',
        'oidc-subject',
        '  JOSEPH   ROSENBAUM, MSW ',
        existing.internalId,
        existing
      )
    ).toBe('oidc-subject');
  });

  it('rejects reconnecting a different LinkedIn profile', () => {
    expect(() =>
      resolveLinkedInReconnectId(
        'linkedin',
        'another-oidc-subject',
        'Another Person',
        existing.internalId,
        existing
      )
    ).toThrow(NotEnoughScopes);
  });

  it('does not relax identity checks for other providers', () => {
    expect(() =>
      resolveLinkedInReconnectId(
        'facebook',
        'new-id',
        existing.name,
        existing.internalId,
        existing
      )
    ).toThrow(NotEnoughScopes);
  });
});
