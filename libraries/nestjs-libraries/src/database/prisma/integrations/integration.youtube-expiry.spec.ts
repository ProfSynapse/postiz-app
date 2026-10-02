jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: jest.fn(() => ({})) },
}));
import { IntegrationRepository } from './integration.repository';

describe('YouTube integration expiry persistence', () => {
  let upsert: jest.Mock;
  let repository: IntegrationRepository;
  beforeEach(() => {
    upsert = jest.fn(async () => ({ id: 'integration-1' }));
    repository = new IntegrationRepository(
      { model: { integration: { upsert } } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    jest.useFakeTimers().setSystemTime(new Date('2026-10-02T13:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());
  async function save(
    provider: string,
    expiresIn?: number,
    refreshToken?: string
  ) {
    await repository.createOrUpdateIntegration(
      undefined,
      false,
      'org-a',
      'Channel',
      undefined,
      'social',
      'channel-a',
      provider,
      'test-access',
      refreshToken,
      expiresIn
    );
    return upsert.mock.calls[0][0];
  }
  it('persists Google expiry in create and update', async () => {
    const args = await save('youtube', 3600, 'test-refresh');
    expect(args.create.tokenExpiration.toISOString()).toBe(
      '2026-10-02T14:00:00.000Z'
    );
    expect(args.update.tokenExpiration).toEqual(args.create.tokenExpiration);
  });
  it('does not fabricate a decades-long expiry or erase an existing refresh grant', async () => {
    const args = await save('youtube');
    expect(args.update.tokenExpiration.toISOString()).toBe(
      '2026-10-02T13:00:00.000Z'
    );
    expect(args.update).not.toHaveProperty('refreshToken');
  });
  it('preserves the existing fallback for other providers', async () => {
    const args = await save('linkedin');
    expect(args.update.tokenExpiration.getTime() - Date.now()).toBe(
      999999999000
    );
  });
});
