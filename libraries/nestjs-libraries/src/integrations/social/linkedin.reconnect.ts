import { NotEnoughScopes } from '@gitroom/nestjs-libraries/integrations/social.abstract';

type ExistingLinkedInIntegration = {
  internalId: string;
  name: string;
  providerIdentifier: string;
};

const normalizeProfileName = (value: string) =>
  value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

/**
 * LinkedIn migrated its self-serve sign-in product to OIDC. Older Postiz
 * channels can therefore have a Person ID while a new authorization returns a
 * pairwise OIDC subject. Preserve the existing channel only when the provider
 * and profile name both verify the reconnect target.
 */
export function resolveLinkedInReconnectId(
  provider: string,
  authenticatedId: string,
  authenticatedName: string,
  refreshId: string | null,
  existingIntegration?: ExistingLinkedInIntegration
) {
  if (!refreshId || authenticatedId === refreshId) {
    return authenticatedId;
  }

  if (
    provider !== 'linkedin' ||
    !existingIntegration ||
    existingIntegration.providerIdentifier !== 'linkedin' ||
    existingIntegration.internalId !== refreshId
  ) {
    throw new NotEnoughScopes(
      'Please refresh the channel that needs to be refreshed'
    );
  }

  if (
    !authenticatedName ||
    normalizeProfileName(existingIntegration.name) !==
      normalizeProfileName(authenticatedName)
  ) {
    throw new NotEnoughScopes(
      `LinkedIn signed into a different profile than ${existingIntegration.name}. Please retry with the matching LinkedIn account.`
    );
  }

  return authenticatedId;
}
