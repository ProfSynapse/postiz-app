jest.mock('@gitroom/helpers/utils/concurrency.service', () => ({
  concurrency: async (_id: string, _limit: number, fn: () => unknown) => fn(),
}));
import { BadBody, RefreshToken, SocialAbstract } from './social.abstract';

class Provider extends SocialAbstract {
  identifier = 'test-provider';
  handleErrors = jest.fn();
}
describe('provider concurrency error handling', () => {
  it('returns a successful result unchanged', async () => {
    const result = { data: { id: 'video-id' } };
    await expect(
      new Provider().runInConcurrent(async () => result)
    ).resolves.toBe(result);
  });
  it('raises a refresh signal for authentication failures', async () => {
    const provider = new Provider();
    provider.handleErrors.mockReturnValue({
      type: 'refresh-token',
      value: 'Authentication expired',
    });
    await expect(
      provider.runInConcurrent(async () => {
        throw new Error('invalid token');
      })
    ).rejects.toBeInstanceOf(RefreshToken);
  });
  it('keeps mapped body errors as failures', async () => {
    const provider = new Provider();
    provider.handleErrors.mockReturnValue({
      type: 'bad-body',
      value: 'Invalid title',
    });
    await expect(
      provider.runInConcurrent(async () => {
        throw new Error('bad title');
      })
    ).rejects.toMatchObject({ message: 'Invalid title' });
  });
  it('does not turn unknown failures into success or log credentials', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const provider = new Provider();
    const error = {
      response: { status: 503 },
      config: { headers: { Authorization: 'SECRET' } },
    };
    try {
      await expect(
        provider.runInConcurrent(async () => {
          throw error;
        })
      ).rejects.toMatchObject({
        message: 'test-provider request failed (HTTP 503).',
        json: '{}',
      });
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
