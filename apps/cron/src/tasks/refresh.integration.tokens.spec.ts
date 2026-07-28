jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: jest.fn() })
);

import { RefreshIntegrationTokens } from './refresh.integration.tokens';

describe('RefreshIntegrationTokens', () => {
  it('runs the integration token refresh service', async () => {
    const integrationService = {
      refreshTokens: jest.fn().mockResolvedValue(undefined),
    };
    const task = new RefreshIntegrationTokens(integrationService as any);

    await task.handleCron();

    expect(integrationService.refreshTokens).toHaveBeenCalledTimes(1);
  });

  it('logs a failed run without crashing the cron process', async () => {
    const integrationService = {
      refreshTokens: jest.fn().mockRejectedValue(new Error('database offline')),
    };
    const task = new RefreshIntegrationTokens(integrationService as any);
    const error = jest
      .spyOn((task as any).logger, 'error')
      .mockImplementation(() => undefined);

    await expect(task.handleCron()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith({
      evt: 'integration-token-refresh.failed',
      error: 'database offline',
    });
  });
});
