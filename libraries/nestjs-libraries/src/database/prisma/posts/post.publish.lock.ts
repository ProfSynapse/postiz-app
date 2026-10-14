import { randomUUID } from 'crypto';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

// Longer than the slowest provider path (LinkedIn waits up to 5 minutes for
// video readiness after a multi-part upload), short enough that a worker that
// dies mid-publish does not block the overdue-post cron for long.
const LOCK_TTL_MS = 20 * 60 * 1000;

const RELEASE_IF_OWNER = `if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0`;

export const postPublishLockKey = (id: string) => `post:publishing:${id}`;

/**
 * Claims the right to publish a post. Returns a release token, or null when
 * another worker is already publishing it.
 */
export async function acquirePostPublishLock(
  id: string
): Promise<string | null> {
  const token = randomUUID();
  const result = await ioRedis.set(
    postPublishLockKey(id),
    token,
    'PX',
    LOCK_TTL_MS,
    'NX'
  );
  return result === 'OK' ? token : null;
}

export async function releasePostPublishLock(id: string, token: string) {
  try {
    await ioRedis.eval(RELEASE_IF_OWNER, 1, postPublishLockKey(id), token);
  } catch (err) {
    // The TTL frees the lock anyway; never fail a publish over the release.
    console.warn(`Failed to release publish lock for post ${id}`, err);
  }
}

export async function isPostPublishing(id: string): Promise<boolean> {
  try {
    return (await ioRedis.exists(postPublishLockKey(id))) === 1;
  } catch {
    return false;
  }
}
