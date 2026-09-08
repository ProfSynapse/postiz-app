import {
  publishLinkedInThread,
  retryLinkedInComment,
  LinkedInPartialPublicationError,
} from './linkedin.publication';
import type {
  PostDetails,
  PostResponse,
} from './social.integrations.interface';

const mainId = 'urn:li:ugcPost:123';
const mainResult: PostResponse = {
  id: 'main',
  postId: mainId,
  releaseURL: `https://www.linkedin.com/feed/update/${mainId}`,
  status: 'posted',
};
const details = (): PostDetails[] => [
  { id: 'main', message: 'A video', settings: {} },
  { id: 'comment', message: 'The approved link', settings: {} },
];

describe('LinkedIn incremental publication', () => {
  it('persists the main post before requesting any comment', async () => {
    const posts = details();
    const events: string[] = [];
    posts[0].onPublished = async () => {
      events.push('persist-main');
    };
    posts[1].onPublished = async () => {
      events.push('persist-comment');
    };
    const result = await publishLinkedInThread(
      posts,
      async () => {
        events.push('create-main');
        return mainId;
      },
      async (_post, parent) => {
        expect(parent).toBe(mainId);
        events.push('create-comment');
        return 'urn:li:comment:(urn:li:activity:123,456)';
      }
    );
    expect(events).toEqual([
      'create-main',
      'persist-main',
      'create-comment',
      'persist-comment',
    ]);
    expect(result[1].postId).toContain('urn:li:comment:');
  });

  it('preserves accepted results when the next comment fails', async () => {
    const posts = [
      ...details(),
      { id: 'second', message: 'Second link', settings: {} },
    ];
    const createMain = jest.fn(async () => mainId);
    const error = { json: '{"status":403}' };
    const createComment = jest
      .fn()
      .mockResolvedValueOnce('urn:li:comment:(urn:li:activity:123,456)')
      .mockRejectedValueOnce(error);
    await expect(
      publishLinkedInThread(posts, createMain, createComment)
    ).rejects.toMatchObject({
      publishedPosts: [mainResult, expect.objectContaining({ id: 'comment' })],
      failedPostId: 'second',
      cause: error,
    });
    expect(createMain).toHaveBeenCalledTimes(1);
  });

  it('resumes comments without creating the main post again', async () => {
    const posts = details();
    posts[0].published = mainResult;
    const createMain = jest.fn();
    const createComment = jest.fn(
      async () => 'urn:li:comment:(urn:li:activity:123,456)'
    );
    await publishLinkedInThread(posts, createMain, createComment);
    expect(createMain).not.toHaveBeenCalled();
    expect(createComment).toHaveBeenCalledTimes(1);
  });

  it('skips comments that already have a publication checkpoint', async () => {
    const posts = details();
    posts[0].published = mainResult;
    posts[1].published = {
      ...mainResult,
      id: 'comment',
      postId: 'urn:li:comment:(urn:li:activity:123,456)',
    };
    const createMain = jest.fn();
    const createComment = jest.fn();
    await publishLinkedInThread(posts, createMain, createComment);
    expect(createMain).not.toHaveBeenCalled();
    expect(createComment).not.toHaveBeenCalled();
  });

  it('carries the remote ID when persistence fails and does not create comments', async () => {
    const posts = details();
    posts[0].onPublished = async () => {
      throw new Error('database unavailable');
    };
    const comment = jest.fn();
    await expect(
      publishLinkedInThread(posts, async () => mainId, comment)
    ).rejects.toMatchObject({
      publishedPosts: [mainResult],
      failedPostId: 'main',
    });
    expect(comment).not.toHaveBeenCalled();
  });

  it('does not label a rejected main post as partial success', async () => {
    const error = new Error('main rejected');
    await expect(
      publishLinkedInThread(
        details(),
        async () => {
          throw error;
        },
        jest.fn()
      )
    ).rejects.toBe(error);
    expect(error).not.toBeInstanceOf(LinkedInPartialPublicationError);
  });
});

describe('LinkedIn comment readiness retry', () => {
  it('retries a temporary 404 until the parent is available', async () => {
    const attempt = jest
      .fn()
      .mockRejectedValueOnce({ json: '{"status":404}' })
      .mockRejectedValueOnce({ json: '{"status":404}' })
      .mockResolvedValue('comment');
    const wait = jest.fn(async () => {});
    await expect(retryLinkedInComment(attempt, wait)).resolves.toBe('comment');
    expect(wait.mock.calls).toEqual([[5000], [10000]]);
  });

  it('stops after a bounded number of 404s', async () => {
    const error = { json: '{"status":404}' };
    const attempt = jest.fn().mockRejectedValue(error);
    const wait = jest.fn(async () => {});
    await expect(retryLinkedInComment(attempt, wait)).rejects.toBe(error);
    expect(attempt).toHaveBeenCalledTimes(6);
    expect(wait).toHaveBeenCalledTimes(5);
  });

  it.each([400, 401, 403, 500])(
    'does not retry HTTP %s here',
    async (status) => {
      const error = { json: JSON.stringify({ status }) };
      const attempt = jest.fn().mockRejectedValue(error);
      const wait = jest.fn();
      await expect(retryLinkedInComment(attempt, wait)).rejects.toBe(error);
      expect(attempt).toHaveBeenCalledTimes(1);
      expect(wait).not.toHaveBeenCalled();
    }
  );

  it('does not retry an ambiguous transport failure', async () => {
    const error = new Error('socket timed out after sending');
    const attempt = jest.fn().mockRejectedValue(error);
    await expect(retryLinkedInComment(attempt, jest.fn())).rejects.toBe(error);
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
