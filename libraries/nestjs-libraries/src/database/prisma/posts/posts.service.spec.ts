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

function buildService(
  overrides: {
    postRepository?: Record<string, jest.Mock>;
    workerServiceProducer?: Record<string, jest.Mock>;
    notificationService?: Record<string, jest.Mock>;
  } = {}
) {
  const postRepository = {
    createOrUpdatePost: jest.fn(),
    deletePost: jest.fn(),
    getPostById: jest.fn(),
    changeState: jest.fn(),
    ...overrides.postRepository,
  };
  const workerServiceProducer = {
    delete: jest.fn(async () => undefined),
    emit: jest.fn(() => ({ subscribe: jest.fn() })),
    ...overrides.workerServiceProducer,
  };
  const notificationService = {
    inAppNotification: jest.fn(),
    ...overrides.notificationService,
  };

  const service = new PostsService(
    postRepository as any,
    workerServiceProducer as any,
    {} as any,
    notificationService as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { convertTextToShortLinks: jest.fn() } as any,
    {} as any,
    {} as any,
    {} as any
  );

  return {
    service,
    postRepository,
    workerServiceProducer,
    notificationService,
  };
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

  it('keeps reconnect reminders in-app after the first emailed alert', async () => {
    const { service, notificationService } = buildService();
    jest.spyOn(service, 'getPostsRecursively').mockResolvedValue([
      {
        id: 'post-1',
        organizationId: 'org-1',
        integration: {
          refreshNeeded: true,
          providerIdentifier: 'linkedin',
          name: 'Joseph Rosenbaum',
        },
      },
    ] as any);

    await service.post('post-1');

    expect(notificationService.inAppNotification).toHaveBeenCalledWith(
      'org-1',
      expect.any(String),
      expect.any(String),
      false,
      false,
      'info'
    );
  });

  it('does not send a second generic email when token refresh already alerted', async () => {
    const { service, postRepository, notificationService } = buildService();
    jest.spyOn(service, 'getPostsRecursively').mockResolvedValue([
      {
        id: 'post-1',
        organizationId: 'org-1',
        integration: {
          refreshNeeded: false,
          providerIdentifier: 'linkedin',
          name: 'Joseph Rosenbaum',
        },
      },
    ] as any);
    jest.spyOn(service as any, 'postSocial').mockResolvedValue(undefined);

    await service.post('post-1');

    expect(postRepository.changeState).toHaveBeenCalledWith('post-1', 'ERROR');
    expect(notificationService.inAppNotification).not.toHaveBeenCalled();
  });
});

// Publication checkpoints must survive a follow-up failure for both providers.
import { LinkedInPartialPublicationError } from '../../../integrations/social/linkedin.publication';

describe('PostsService LinkedIn partial publication', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(['linkedin', 'linkedin-page'])(
    'keeps the %s main post published when its comment fails',
    async (providerIdentifier) => {
      const { service, postRepository, notificationService } = buildService();
      const result = {
        id: 'main',
        postId: 'urn:li:ugcPost:123',
        releaseURL: 'https://www.linkedin.com/feed/update/urn:li:ugcPost:123',
        status: 'posted',
      };
      const integration = {
        internalId: 'actor',
        token: 'token',
        tokenExpiration: dayjs().add(1, 'day').toDate(),
        providerIdentifier,
        organizationId: 'org',
      };
      const posts = [
        {
          id: 'main',
          organizationId: 'org',
          integration,
          content: 'Video',
          settings: '{}',
          image: '[]',
        },
        {
          id: 'comment',
          organizationId: 'org',
          content: 'Link',
          settings: '{}',
          image: '[]',
        },
      ];
      const updatePost = jest.fn(async () => {});
      (postRepository as any).updatePost = updatePost;
      (service as any)._integrationManager = {
        getSocialIntegration: () => ({
          editor: 'normal',
          post: jest.fn(async (_id, _token, details) => {
            await details[0].onPublished(result);
            expect(updatePost).toHaveBeenCalledWith(
              'main',
              result.postId,
              result.releaseURL
            );
            throw new LinkedInPartialPublicationError(
              [result],
              'comment',
              new Error('comment rejected')
            );
          }),
        }),
      };
      jest
        .spyOn(service, 'getPostsRecursively')
        .mockResolvedValue(posts as any);
      jest.spyOn(service as any, 'updateTags').mockResolvedValue(posts);
      jest.spyOn(service, 'updateMedia').mockResolvedValue([]);
      await service.post('main');
      expect(postRepository.changeState).toHaveBeenCalledWith(
        'comment',
        'ERROR',
        expect.anything()
      );
      expect(
        postRepository.changeState.mock.calls.some(([id]) => id === 'main')
      ).toBe(false);
      expect(notificationService.inAppNotification).toHaveBeenCalledWith(
        'org',
        'LinkedIn post published; follow-up needs attention',
        expect.stringContaining(result.releaseURL),
        true,
        false,
        'fail'
      );
    }
  );

  it('does not turn a published main post into ERROR when the warning notification fails', async () => {
    const { service, postRepository } = buildService({
      notificationService: {
        inAppNotification: jest.fn().mockRejectedValue(new Error('mail down')),
      },
    });
    const result = {
      id: 'main',
      postId: 'urn:li:share:123',
      releaseURL: 'https://www.linkedin.com/feed/update/urn:li:share:123',
      status: 'posted',
    };
    const posts = [
      {
        id: 'main',
        organizationId: 'org',
        integration: {
          providerIdentifier: 'linkedin',
          tokenExpiration: dayjs().add(1, 'day').toDate(),
        },
        content: 'Post',
        settings: '{}',
        image: '[]',
      },
      { id: 'comment', content: 'Link', settings: '{}', image: '[]' },
    ];
    (postRepository as any).updatePost = jest.fn();
    (service as any)._integrationManager = {
      getSocialIntegration: () => ({
        editor: 'normal',
        post: async () => {
          throw new LinkedInPartialPublicationError(
            [result],
            'comment',
            new Error('404')
          );
        },
      }),
    };
    jest.spyOn(service, 'getPostsRecursively').mockResolvedValue(posts as any);
    jest.spyOn(service as any, 'updateTags').mockResolvedValue(posts);
    jest.spyOn(service, 'updateMedia').mockResolvedValue([]);
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});
    await service.post('main');
    expect(
      postRepository.changeState.mock.calls.some(([id]) => id === 'main')
    ).toBe(false);
  });
});

describe('YouTube publication checkpoints', () => {
  function setup(result?: any) {
    const built = buildService({ postRepository: { updatePost: jest.fn() } });
    const integration = {
      id: 'yt-integration',
      organizationId: 'org-a',
      internalId: 'channel',
      providerIdentifier: 'youtube',
      token: 'test-access',
      tokenExpiration: new Date('2058-01-01'),
      disabled: false,
      refreshNeeded: false,
    };
    const row = {
      id: 'yt-post',
      organizationId: 'org-a',
      integration,
      content: 'Approved video',
      image: '[]',
      settings: '{}',
      publishDate: new Date(),
    };
    const provider = {
      identifier: 'youtube',
      editor: 'normal',
      post: jest.fn().mockResolvedValue(result),
    };
    const refresh = jest
      .fn()
      .mockResolvedValue({ accessToken: 'test-refreshed' });
    const digest = jest.fn();
    Object.assign(built.service, {
      _integrationManager: { getSocialIntegration: () => provider },
      _refreshIntegrationService: { refresh },
      _webhookService: { digestWebhooks: digest },
    });
    jest
      .spyOn(built.service, 'getPostsRecursively')
      .mockResolvedValue([row] as any);
    jest.spyOn(built.service, 'updateTags').mockResolvedValue([row] as any);
    jest.spyOn(built.service as any, 'updateMedia').mockResolvedValue([]);
    jest.spyOn(built.service as any, 'checkPlugs').mockResolvedValue(undefined);
    jest
      .spyOn(built.service as any, 'checkInternalPlug')
      .mockResolvedValue(undefined);
    return { ...built, integration, row, provider, refresh, digest };
  }
  afterEach(() => jest.restoreAllMocks());
  it.each([
    undefined,
    [],
    [
      {
        id: 'yt-post',
        postId: undefined,
        releaseURL: 'https://www.youtube.com/watch?v=undefined',
      },
    ],
    [
      {
        id: 'yt-post',
        postId: 'undefined',
        releaseURL: 'https://www.youtube.com/watch?v=undefined',
      },
    ],
  ])(
    'never emits a success digest or published state for an invalid result (%j)',
    async (result) => {
      const x = setup(result);
      jest.spyOn(console, 'error').mockImplementation(() => {});
      await x.service.post('yt-post');
      expect(x.postRepository.updatePost).not.toHaveBeenCalled();
      expect(x.postRepository.changeState).toHaveBeenCalledWith(
        'yt-post',
        'ERROR',
        expect.anything(),
        expect.anything()
      );
      expect(x.digest).not.toHaveBeenCalled();
      expect(
        x.notificationService.inAppNotification.mock.calls.some((call) =>
          String(call[1]).includes('has been published')
        )
      ).toBe(false);
    }
  );
  it('publishes and sends the digest only for a valid video ID/link', async () => {
    const x = setup([
      {
        id: 'yt-post',
        postId: 'aB_cD-12345',
        releaseURL: 'https://www.youtube.com/watch?v=aB_cD-12345',
      },
    ]);
    await x.service.post('yt-post');
    expect(x.postRepository.updatePost).toHaveBeenCalledWith(
      'yt-post',
      'aB_cD-12345',
      'https://www.youtube.com/watch?v=aB_cD-12345'
    );
    expect(x.digest).toHaveBeenCalledTimes(1);
    expect(
      x.notificationService.inAppNotification.mock.calls.some((call) =>
        String(call[1]).includes('has been published')
      )
    ).toBe(true);
  });
  it('does not refresh twice when an expired token was already refreshed before upload', async () => {
    const {
      RefreshToken,
      BadBody,
    } = require('@gitroom/nestjs-libraries/integrations/social.abstract');
    const x = setup();
    x.integration.tokenExpiration = new Date('2020-01-01');
    x.provider.post.mockRejectedValue(new RefreshToken('youtube'));
    await expect(
      (x.service as any).postSocial(x.integration, [x.row])
    ).rejects.toBeInstanceOf(BadBody);
    expect(x.provider.post).toHaveBeenCalledTimes(1);
    expect(x.refresh).toHaveBeenCalledTimes(1);
  });
  it('stops after one refresh rather than recursively retrying invalid authentication', async () => {
    const {
      RefreshToken,
      BadBody,
    } = require('@gitroom/nestjs-libraries/integrations/social.abstract');
    const x = setup();
    x.provider.post.mockRejectedValue(new RefreshToken('youtube'));
    await expect(
      (x.service as any).postSocial(x.integration, [x.row])
    ).rejects.toBeInstanceOf(BadBody);
    expect(x.provider.post).toHaveBeenCalledTimes(2);
    expect(x.refresh).toHaveBeenCalledTimes(1);
    expect(x.postRepository.updatePost).not.toHaveBeenCalled();
    expect(x.digest).not.toHaveBeenCalled();
  });
});
