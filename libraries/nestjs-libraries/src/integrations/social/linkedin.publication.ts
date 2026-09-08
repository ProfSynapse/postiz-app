import type {
  PostDetails,
  PostResponse,
} from './social.integrations.interface';

/** A main post exists. Never restart the whole thread after this error. */
export class LinkedInPartialPublicationError extends Error {
  constructor(
    public readonly publishedPosts: PostResponse[],
    public readonly failedPostId: string,
    public readonly cause: unknown
  ) {
    super(
      'LinkedIn post published, but a follow-up comment or checkpoint failed'
    );
  }
}

export async function publishLinkedInThread(
  posts: PostDetails[],
  createMain: (post: PostDetails) => Promise<string>,
  createComment: (post: PostDetails, parentId: string) => Promise<string>
): Promise<PostResponse[]> {
  const responses: PostResponse[] = [];
  let currentId = posts[0].id;
  try {
    for (const [index, post] of posts.entries()) {
      currentId = post.id;
      const postId =
        post.published?.postId ||
        (index === 0
          ? await createMain(post)
          : await createComment(post, responses[0].postId));
      const result: PostResponse = post.published || {
        id: post.id,
        postId,
        releaseURL:
          index === 0
            ? `https://www.linkedin.com/feed/update/${postId}`
            : `${responses[0].releaseURL}?commentUrn=${encodeURIComponent(
                postId
              )}`,
        status: 'posted',
      };
      // Record success before awaiting persistence: an ambiguous DB failure must
      // still carry the accepted remote ID back to the caller.
      responses.push(result);
      if (!post.published) await post.onPublished?.(result);
    }
    return responses;
  } catch (error) {
    if (responses.length) {
      throw new LinkedInPartialPublicationError(responses, currentId, error);
    }
    throw error;
  }
}

/** Retry only explicit temporary responses, never an ambiguous network timeout. */
export async function retryLinkedInComment<T>(
  attempt: () => Promise<T>,
  wait: (ms: number) => Promise<unknown>
): Promise<T> {
  const delays = [5000, 10000, 20000, 40000, 60000];
  for (let retry = 0; ; retry++) {
    try {
      return await attempt();
    } catch (error) {
      let status: number | undefined;
      try {
        status = JSON.parse((error as { json?: string }).json || '{}').status;
      } catch {}
      if (status !== 404 || retry === delays.length) throw error;
      await wait(delays[retry]);
    }
  }
}
