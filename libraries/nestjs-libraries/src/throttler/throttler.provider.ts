import { ThrottlerGuard } from '@nestjs/throttler';
import { ExecutionContext, Injectable } from '@nestjs/common';

/**
 * Which public API rate-limit bucket a request URL belongs to, or null when
 * the request is not throttled.
 *
 * Only post routes (/public/v1/posts...) and uploads (/public/v1/upload...)
 * are throttled (API_LIMIT per hour, default 30). Everything else, including
 * GET /public/v1/analytics/:integration, /public/v1/analytics/post/:postId and
 * the batch GET /public/v1/analytics/posts, is not throttled. The batch route
 * contains "/posts" in its path, so the bucket match is anchored on the
 * /public/v1/posts prefix rather than any "/posts" substring.
 */
export function publicApiThrottleBucket(url: string): 'posts' | 'other' | null {
  const path = (url || '').split('?')[0];
  if (/\/public\/v1\/posts(\/|$)/.test(path)) return 'posts';
  if (path.includes('/public/v1/upload')) return 'other';
  return null;
}

@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  public override async canActivate(
    context: ExecutionContext
  ): Promise<boolean> {
    const { url } = context.switchToHttp().getRequest();
    if (publicApiThrottleBucket(url)) {
      return super.canActivate(context);
    }

    return true;
  }

  protected override async getTracker(
    req: Record<string, any>
  ): Promise<string> {
    return req.org.id + '_' + (publicApiThrottleBucket(req.url) || 'other');
  }
}
