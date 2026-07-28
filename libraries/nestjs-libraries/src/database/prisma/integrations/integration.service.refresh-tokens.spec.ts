jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: jest.fn(),
}));

jest.mock('@gitroom/nestjs-libraries/integrations/social.abstract', () => ({
  RefreshToken: class RefreshToken extends Error {},
}));

jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: {
    createStorage: jest.fn(() => ({})),
  },
}));

jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));

jest.mock(
  '@gitroom/nestjs-libraries/integrations/refresh.integration.service',
  () => ({ RefreshIntegrationService: jest.fn() })
);

import { IntegrationService } from './integration.service';

describe('IntegrationService.refreshTokens', () => {
  it('continues refreshing other channels after one channel needs reconnecting', async () => {
    const failedIntegration = {
      id: 'failed-integration',
      organizationId: 'organization-1',
      providerIdentifier: 'linkedin',
      refreshToken: '',
    };
    const healthyIntegration = {
      id: 'healthy-integration',
      organizationId: 'organization-1',
      providerIdentifier: 'provider-with-refresh',
      refreshToken: 'old-refresh-token',
      internalId: 'profile-1',
      name: 'Healthy channel',
    };
    const repository = {
      needsToBeRefreshed: jest
        .fn()
        .mockResolvedValue([failedIntegration, healthyIntegration]),
      refreshNeeded: jest.fn(),
    };
    const providers = {
      linkedin: { refreshToken: jest.fn(), oneTimeToken: true },
      'provider-with-refresh': {
        refreshToken: jest.fn(),
        oneTimeToken: false,
      },
    };
    const service = Object.create(IntegrationService.prototype) as any;
    service._integrationRepository = repository;
    service._integrationManager = {
      getSocialIntegration: jest.fn(
        (identifier: keyof typeof providers) => providers[identifier]
      ),
    };
    service.refreshToken = jest
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresIn: 3600,
      });
    service.informAboutRefreshError = jest.fn();
    service.createOrUpdateIntegration = jest.fn();

    await service.refreshTokens();

    expect(repository.refreshNeeded).toHaveBeenCalledWith(
      failedIntegration.organizationId,
      failedIntegration.id
    );
    expect(service.refreshToken).toHaveBeenCalledTimes(2);
    expect(service.createOrUpdateIntegration).toHaveBeenCalledTimes(1);
  });
});
