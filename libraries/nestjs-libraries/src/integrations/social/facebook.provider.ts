import {
  AnalyticsData,
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import dayjs from 'dayjs';
import { SocialAbstract } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { FacebookDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/facebook.dto';
import { DribbbleDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/dribbble.dto';

// Per-post insights need a Graph version that knows the media-view metrics.
const FACEBOOK_POST_INSIGHTS_VERSION = 'v23.0';
// Lifetime post metrics -> public label. post_impressions* are deprecated.
const FACEBOOK_POST_METRICS: Record<string, string> = {
  post_total_media_view_unique: 'Reach',
  post_media_view: 'Views',
  post_clicks: 'Clicks',
  post_reactions_by_type_total: 'Reactions',
};
// video_insights metrics (videos and reels; Meta omits the ones that don't apply).
const FACEBOOK_VIDEO_METRICS: Record<string, string> = {
  total_video_views: 'Views',
  fb_reels_total_plays: 'Plays',
  total_video_reactions_by_type_total: 'Reactions',
  post_video_likes_by_reaction_type: 'Reactions',
  post_video_social_actions: 'Engagement',
};

export class FacebookProvider extends SocialAbstract implements SocialProvider {
  identifier = 'facebook';
  name = 'Facebook Page';
  isBetweenSteps = true;
  scopes = [
    'pages_show_list',
    'business_management',
    'pages_manage_posts',
    'pages_manage_engagement',
    'pages_read_engagement',
    'read_insights',
  ];
  override maxConcurrentJob = 100; // Facebook has reasonable rate limits
  editor = 'normal' as const;
  maxLength() {
    return 63206;
  }
  dto = FacebookDto;

  override handleErrors(body: string):
    | {
        type: 'refresh-token' | 'bad-body';
        value: string;
      }
    | undefined {
    // Access token validation errors - require re-authentication
    if (body.indexOf('Error validating access token') > -1) {
      return {
        type: 'refresh-token' as const,
        value: 'Please re-authenticate your Facebook account',
      };
    }

    if (body.indexOf('490') > -1) {
      return {
        type: 'refresh-token' as const,
        value: 'Access token expired, please re-authenticate',
      };
    }

    if (body.indexOf('REVOKED_ACCESS_TOKEN') > -1) {
      return {
        type: 'refresh-token' as const,
        value: 'Access token has been revoked, please re-authenticate',
      };
    }

    if (body.indexOf('1366046') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Photos should be smaller than 4 MB and saved as JPG, PNG',
      };
    }

    if (body.indexOf('1390008') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'You are posting too fast, please slow down',
      };
    }

    // Content policy violations
    if (body.indexOf('1346003') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Content flagged as abusive by Facebook',
      };
    }

    if (body.indexOf('1404006') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          "We couldn't post your comment, A security check in facebook required to proceed.",
      };
    }

    if (body.indexOf('1404102') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Content violates Facebook Community Standards',
      };
    }

    // Permission errors
    if (body.indexOf('1404078') > -1) {
      return {
        type: 'refresh-token' as const,
        value: 'Page publishing authorization required, please re-authenticate',
      };
    }

    if (body.indexOf('1609008') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Cannot post Facebook.com links',
      };
    }

    // Parameter validation errors
    if (body.indexOf('2061006') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid URL format in post content',
      };
    }

    if (body.indexOf('1349125') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid content format',
      };
    }

    if (body.indexOf('Name parameter too long') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Post content is too long',
      };
    }

    // Service errors - checking specific subcodes first
    if (body.indexOf('1363047') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Facebook service temporarily unavailable',
      };
    }

    if (body.indexOf('1609010') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Facebook service temporarily unavailable',
      };
    }

    return undefined;
  }

  async refreshToken(refresh_token: string): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 0,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
    };
  }

  async generateAuthUrl() {
    const state = makeId(6);
    return {
      url:
        'https://www.facebook.com/v20.0/dialog/oauth' +
        `?client_id=${process.env.FACEBOOK_APP_ID}` +
        `&redirect_uri=${encodeURIComponent(
          `${process.env.FRONTEND_URL}/integrations/social/facebook`
        )}` +
        `&state=${state}` +
        `&scope=${this.scopes.join(',')}`,
      codeVerifier: makeId(10),
      state,
    };
  }

  async reConnect(
    id: string,
    requiredId: string,
    accessToken: string
  ): Promise<Omit<AuthTokenDetails, 'refreshToken' | 'expiresIn'>> {
    const information = await this.fetchPageInformation(accessToken, {
      page: requiredId,
    });

    return {
      id: information.id,
      name: information.name,
      accessToken: information.access_token,
      picture: information.picture,
      username: information.username,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const getAccessToken = await (
      await fetch(
        'https://graph.facebook.com/v20.0/oauth/access_token' +
          `?client_id=${process.env.FACEBOOK_APP_ID}` +
          `&redirect_uri=${encodeURIComponent(
            `${process.env.FRONTEND_URL}/integrations/social/facebook${
              params.refresh ? `?refresh=${params.refresh}` : ''
            }`
          )}` +
          `&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
          `&code=${params.code}`
      )
    ).json();

    const { access_token } = await (
      await fetch(
        'https://graph.facebook.com/v20.0/oauth/access_token' +
          '?grant_type=fb_exchange_token' +
          `&client_id=${process.env.FACEBOOK_APP_ID}` +
          `&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
          `&fb_exchange_token=${getAccessToken.access_token}&fields=access_token,expires_in`
      )
    ).json();

    const { data } = await (
      await fetch(
        `https://graph.facebook.com/v20.0/me/permissions?access_token=${access_token}`
      )
    ).json();

    const permissions = data
      .filter((d: any) => d.status === 'granted')
      .map((p: any) => p.permission);
    this.checkScopes(this.scopes, permissions);

    const { id, name, picture } = await (
      await fetch(
        `https://graph.facebook.com/v20.0/me?fields=id,name,picture&access_token=${access_token}`
      )
    ).json();

    return {
      id,
      name,
      accessToken: access_token,
      refreshToken: access_token,
      expiresIn: dayjs().add(59, 'days').unix() - dayjs().unix(),
      picture: picture?.data?.url || '',
      username: '',
    };
  }

  async pages(accessToken: string) {
    const { data } = await (
      await fetch(
        `https://graph.facebook.com/v20.0/me/accounts?fields=id,username,name,picture.type(large)&access_token=${accessToken}`
      )
    ).json();

    return data;
  }

  async fetchPageInformation(accessToken: string, data: { page: string }) {
    const pageId = data.page;
    const {
      id,
      name,
      access_token,
      username,
      picture: {
        data: { url },
      },
    } = await (
      await fetch(
        `https://graph.facebook.com/v20.0/${pageId}?fields=username,access_token,name,picture.type(large)&access_token=${accessToken}`
      )
    ).json();

    return {
      id,
      name,
      access_token,
      picture: url,
      username,
    };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<FacebookDto>[]
  ): Promise<PostResponse[]> {
    const [firstPost, ...comments] = postDetails;

    let finalId = '';
    let finalUrl = '';
    if ((firstPost?.media?.[0]?.path?.indexOf('mp4') || -2) > -1) {
      const {
        id: videoId,
        permalink_url,
        ...all
      } = await (
        await this.fetch(
          `https://graph.facebook.com/v20.0/${id}/videos?access_token=${accessToken}&fields=id,permalink_url`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              file_url: firstPost?.media?.[0]?.path!,
              description: firstPost.message,
              published: true,
            }),
          },
          'upload mp4'
        )
      ).json();

      finalUrl = 'https://www.facebook.com/reel/' + videoId;
      finalId = videoId;
    } else {
      const uploadPhotos = !firstPost?.media?.length
        ? []
        : await Promise.all(
            firstPost.media.map(async (media) => {
              const { id: photoId } = await (
                await this.fetch(
                  `https://graph.facebook.com/v20.0/${id}/photos?access_token=${accessToken}`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      url: media.path,
                      published: false,
                    }),
                  },
                  'upload images slides'
                )
              ).json();

              return { media_fbid: photoId };
            })
          );

      const {
        id: postId,
        permalink_url,
        ...all
      } = await (
        await this.fetch(
          `https://graph.facebook.com/v20.0/${id}/feed?access_token=${accessToken}&fields=id,permalink_url`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              ...(uploadPhotos?.length ? { attached_media: uploadPhotos } : {}),
              ...(firstPost?.settings?.url
                ? { link: firstPost.settings.url }
                : {}),
              message: firstPost.message,
              published: true,
            }),
          },
          'finalize upload'
        )
      ).json();

      finalUrl = permalink_url;
      finalId = postId;
    }

    const postsArray = [];
    let commentId = finalId;
    for (const comment of comments) {
      const data = await (
        await this.fetch(
          `https://graph.facebook.com/v20.0/${commentId}/comments?access_token=${accessToken}&fields=id,permalink_url`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              ...(comment.media?.length
                ? { attachment_url: comment.media[0].path }
                : {}),
              message: comment.message,
            }),
          },
          'add comment'
        )
      ).json();

      commentId = data.id;
      postsArray.push({
        id: comment.id,
        postId: data.id,
        releaseURL: data.permalink_url,
        status: 'success',
      });
    }
    return [
      {
        id: firstPost.id,
        postId: finalId,
        releaseURL: finalUrl,
        status: 'success',
      },
      ...postsArray,
    ];
  }

  async analytics(
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]> {
    const until = dayjs().endOf('day').unix();
    const since = dayjs().subtract(date, 'day').unix();

    // Meta removed the impressions/reach Page Insights metrics
    // (page_impressions_unique, page_posts_impressions_unique, ...) in favour
    // of "views" metrics. A single invalid metric makes Meta reject the whole
    // request, so request them together first and fall back to one by one.
    const metrics = [
      'page_total_media_view_unique',
      'page_media_view',
      'page_post_engagements',
      'page_daily_follows_unique',
      'page_video_views',
    ];

    const loadInsights = async (metric: string) =>
      (
        await fetch(
          `https://graph.facebook.com/v20.0/${id}/insights?metric=${metric}&access_token=${accessToken}&period=day&since=${since}&until=${until}`
        )
      ).json();

    const batch = await loadInsights(metrics.join(','));
    let data = batch.data;

    if (batch.error) {
      console.error(
        `[facebook] page insights batch request failed: ${batch.error.message}`
      );
      const results = await Promise.all(
        metrics.map(async (metric) => {
          const res = await loadInsights(metric);
          if (res.error) {
            console.error(
              `[facebook] page insights metric ${metric} failed: ${res.error.message}`
            );
          }
          return res.data || [];
        })
      );
      data = results.flat();
    }

    return (
      data?.map((d: any) => ({
        label:
          d.name === 'page_total_media_view_unique'
            ? 'Page Reach'
            : d.name === 'page_post_engagements'
            ? 'Posts Engagement'
            : d.name === 'page_daily_follows_unique'
            ? 'Page followers'
            : d.name === 'page_video_views'
            ? 'Videos views'
            : 'Content Views',
        percentageChange: 5,
        data: d?.values?.map((v: any) => ({
          total: v.value,
          date: dayjs(v.end_time).format('YYYY-MM-DD'),
        })),
      })) || []
    );
  }

  /**
   * Per-post insights. Ported from upstream gitroomhq/postiz-app 5cca81e0 and
   * its fixes (9948b072, b64b2c00: video_insights for bare video ids) and
   * adapted to the current metrics used by this fork's Page analytics (#22):
   * post_impressions* were removed by Meta in 2026, so reach and views come
   * from post_total_media_view_unique and post_media_view.
   *
   * The stored releaseId shape tells the post type apart: feed posts are
   * `{pageId}_{postId}`, videos are a bare video id with no `insights` edge.
   */
  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    date: number
  ): Promise<AnalyticsData[]> {
    const today = dayjs().format('YYYY-MM-DD');
    const video = !postId.includes('_');
    const metrics = video ? FACEBOOK_VIDEO_METRICS : FACEBOOK_POST_METRICS;

    try {
      const rows = await this.loadPostInsights(
        accessToken,
        postId,
        video ? 'video_insights' : 'insights',
        Object.keys(metrics)
      );

      const totals = new Map<string, number>();
      for (const row of rows) {
        const label = metrics[row?.name];
        const value = row?.values?.[0]?.value;
        if (!label) continue;
        // *_by_type metrics are objects keyed by reaction/action type.
        const total =
          value && typeof value === 'object'
            ? Object.values(value as Record<string, number>).reduce(
                (sum: number, v) => sum + (Number(v) || 0),
                0
              )
            : Number(value);
        if (!Number.isFinite(total)) continue;
        // Video and reels variants of the same measure share one label.
        totals.set(label, Math.max(totals.get(label) ?? 0, total));
      }

      if (!video) {
        const engagement = await this.loadPostEngagement(accessToken, postId);
        for (const [label, value] of Object.entries(engagement)) {
          if (Number.isFinite(value)) totals.set(label, value);
        }
      }

      return [...totals].map(([label, total]) => ({
        label,
        percentageChange: 0,
        data: [{ total: String(total), date: today }],
      }));
    } catch (err) {
      console.error('[facebook] post insights request failed');
      return [];
    }
  }

  private async loadPostInsights(
    accessToken: string,
    postId: string,
    edge: 'insights' | 'video_insights',
    metrics: string[]
  ): Promise<any[]> {
    const response = await fetch(
      `https://graph.facebook.com/${FACEBOOK_POST_INSIGHTS_VERSION}/${encodeURIComponent(
        postId
      )}/${edge}?${new URLSearchParams({ metric: metrics.join(',') })}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
      }
    );
    const body = await response.json().catch(() => ({}));
    if (response.ok && Array.isArray(body?.data)) return body.data;
    // One invalid metric makes Meta reject the whole request (see #22): retry
    // the metrics one by one and keep the ones that succeed.
    if (body?.error?.code === 100 && metrics.length > 1) {
      const rows: any[] = [];
      for (const metric of metrics) {
        rows.push(
          ...(await this.loadPostInsights(accessToken, postId, edge, [metric]))
        );
      }
      return rows;
    }
    // Stories and posts without this edge answer "nonexisting field".
    if (!/nonexisting field/i.test(body?.error?.message || '')) {
      console.error(
        `[facebook] post ${edge} metric ${
          metrics.length === 1 ? metrics[0] : 'batch'
        } failed: ${body?.error?.code || response.status}`
      );
    }
    return [];
  }

  private async loadPostEngagement(
    accessToken: string,
    postId: string
  ): Promise<Record<string, number>> {
    const response = await fetch(
      `https://graph.facebook.com/${FACEBOOK_POST_INSIGHTS_VERSION}/${encodeURIComponent(
        postId
      )}?${new URLSearchParams({
        fields: 'shares,comments.summary(true).limit(0)',
      })}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
      }
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return {};
    return {
      ...(Number.isFinite(body?.comments?.summary?.total_count)
        ? { Comments: body.comments.summary.total_count }
        : {}),
      // `shares` is omitted entirely when a post has never been shared.
      Shares: Number(body?.shares?.count ?? 0),
    };
  }
}
