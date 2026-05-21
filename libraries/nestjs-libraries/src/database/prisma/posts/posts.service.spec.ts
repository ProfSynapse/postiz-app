import dayjs from 'dayjs';

jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: jest.fn(),
}));

jest.mock('@gitroom/nestjs-libraries/integrations/social.abstract', () => ({
  BadBody: class BadBody extends Error {},
  RefreshToken: class RefreshToken extends Error {},
}));

jest.mock('@sentry/nestjs', () => ({
  metrics: { count: jest.fn() },
}));

jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: {
    createStorage: jest.fn(() => ({})),
  },
}));

import { PostsService } from './posts.service';

function buildService(overrides: {
  postRepository?: Record<string, jest.Mock>;
  workerServiceProducer?: Record<string, jest.Mock>;
} = {}) {
  const postRepository = {
    createOrUpdatePost: jest.fn(),
    deletePost: jest.fn(),
    getPostById: jest.fn(),
    ...overrides.postRepository,
  };
  const workerServiceProducer = {
    delete: jest.fn(async () => undefined),
    emit: jest.fn(() => ({ subscribe: jest.fn() })),
    ...overrides.workerServiceProducer,
  };

  const service = new PostsService(
    postRepository as any,
    workerServiceProducer as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { convertTextToShortLinks: jest.fn() } as any,
    {} as any,
    {} as any,
    {} as any
  );

  return { service, postRepository, workerServiceProducer };
}

function scheduleBody() {
  return {
    type: 'schedule',
    date: dayjs().add(1, 'day').toISOString(),
    shortLink: false,
    tags: [],
    posts: [
      {
        integration: { id: 'integration-1' },
        value: [{ content: 'scheduled post', image: [] }],
      },
    ],
  };
}

describe('PostsService queue side effects', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('returns created posts even when queued-job cleanup does not respond', async () => {
    const subscribe = jest.fn();
    const { service, postRepository, workerServiceProducer } = buildService({
      postRepository: {
        createOrUpdatePost: jest.fn(async () => ({
          previousPost: null,
          posts: [
            {
              id: 'post-1',
              publishDate: dayjs().add(1, 'day').toDate(),
            },
          ],
        })),
      },
      workerServiceProducer: {
        delete: jest.fn(() => new Promise(() => undefined)),
        emit: jest.fn(() => ({ subscribe })),
      },
    });

    const resultPromise = service.createPost('org-1', scheduleBody() as any);
    await Promise.resolve();
    jest.advanceTimersByTime(1500);

    await expect(resultPromise).resolves.toEqual([
      { postId: 'post-1', integration: 'integration-1' },
    ]);
    expect(workerServiceProducer.delete).toHaveBeenCalledWith('post', 'post-1');
    expect(workerServiceProducer.emit).toHaveBeenCalledWith(
      'post',
      expect.objectContaining({
        id: 'post-1',
        payload: expect.objectContaining({ id: 'post-1' }),
      })
    );
    expect(subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Function) })
    );
    expect(postRepository.createOrUpdatePost).toHaveBeenCalledTimes(1);
  });

  it('returns deleted post id even when queued-job cleanup does not respond', async () => {
    const { service, workerServiceProducer } = buildService({
      postRepository: {
        deletePost: jest.fn(async () => ({ id: 'post-1' })),
      },
      workerServiceProducer: {
        delete: jest.fn(() => new Promise(() => undefined)),
      },
    });

    const resultPromise = service.deletePost('org-1', 'group-1');
    await Promise.resolve();
    jest.advanceTimersByTime(1500);

    await expect(resultPromise).resolves.toEqual({ id: 'post-1' });
    expect(workerServiceProducer.delete).toHaveBeenCalledWith('post', 'post-1');
  });
});
