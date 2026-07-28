import { Integration } from '@prisma/client';

jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: jest.fn(),
}));

jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: jest.fn() })
);

import { RefreshIntegrationService } from './refresh.integration.service';

const integration = {
  id: 'integration-1',
  organizationId: 'organization-1',
  providerIdentifier: 'linkedin',
  refreshToken: '',
  rootInternalId: 'member-1',
  internalId: 'member-1',
  name: 'LinkedIn',
  picture: null,
} as Integration;

function buildService(refreshToken: jest.Mock) {
  const provider = { refreshToken };
  const integrationManager = {
    getSocialIntegration: jest.fn(() => provider),
  };
  const integrationService = {
    createOrUpdateIntegration: jest.fn(),
    disconnectChannel: jest.fn(),
  };

  return {
    service: new RefreshIntegrationService(
      integrationManager as any,
      integrationService as any
    ),
    integrationService,
  };
}

describe('RefreshIntegrationService', () => {
  it('marks the channel for reconnection when refresh returns no access token', async () => {
    const { service, integrationService } = buildService(
      jest.fn().mockResolvedValue({
        accessToken: undefined,
        refreshToken: '',
        expiresIn: 3600,
      })
    );

    await expect(service.refresh(integration)).resolves.toBe(false);
    expect(integrationService.disconnectChannel).toHaveBeenCalledTimes(1);
    expect(integrationService.disconnectChannel).toHaveBeenCalledWith(
      integration.organizationId,
      integration
    );
    expect(integrationService.createOrUpdateIntegration).not.toHaveBeenCalled();
  });

  it('persists a valid refreshed token', async () => {
    const refreshed = {
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresIn: 3600,
    };
    const { service, integrationService } = buildService(
      jest.fn().mockResolvedValue(refreshed)
    );

    await expect(service.refresh(integration)).resolves.toEqual(refreshed);
    expect(integrationService.disconnectChannel).not.toHaveBeenCalled();
    expect(integrationService.createOrUpdateIntegration).toHaveBeenCalledTimes(
      1
    );
  });
});
