import {
  AnalyticsData,
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { google, youtube_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library/build/src/auth/oauth2client';
import axios from 'axios';
import { YoutubeSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/youtube.settings.dto';
import {
  BadBody,
  SocialAbstract,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import * as process from 'node:process';
import dayjs from 'dayjs';
import { GaxiosResponse } from 'gaxios/build/src/common';
import Schema$Video = youtube_v3.Schema$Video;
import { Rules } from '@gitroom/nestjs-libraries/chat/rules.description.decorator';

/**
 * Pure builders for the YouTube videos.insert request body. Exported so test-engineer
 * Phase 2 can unit-test request-body composition without invoking the googleapis
 * client factory. Each builder returns a fresh object/array per call — never mutate
 * a module-scoped value (S9 shared-mutable-array regression guard).
 */
export function buildYoutubeSnippet(
  settings: YoutubeSettingsDto,
  message: string
) {
  return {
    title: settings.title,
    description: message,
    ...(settings?.tags?.length
      ? { tags: settings.tags.map((p) => p.label) }
      : {}),
    ...(settings.categoryId ? { categoryId: settings.categoryId } : {}),
    ...(settings.defaultLanguage
      ? { defaultLanguage: settings.defaultLanguage }
      : {}),
  };
}

export function buildYoutubeStatus(settings: YoutubeSettingsDto) {
  // S3 belt-and-suspenders: even though the DTO rejects publishAt + non-private,
  // coerce here so a bad client that bypassed validation still produces a
  // YouTube-compatible request body.
  const status: Record<string, unknown> = {
    privacyStatus: settings.publishAt ? 'private' : settings.type,
    selfDeclaredMadeForKids: settings.selfDeclaredMadeForKids === 'yes',
  };
  if (settings.publishAt) status.publishAt = settings.publishAt;
  return status;
}

export function buildYoutubePartArray(settings: YoutubeSettingsDto): string[] {
  // Fresh array per invocation — do NOT lift to module scope or push onto a
  // shared array. Two-consecutive-calls regression guard (S9).
  const part = ['id', 'snippet', 'status'];
  if (settings.recordingDate) part.push('recordingDetails');
  return part;
}

export function buildYoutubeRequestBody(
  settings: YoutubeSettingsDto,
  message: string
) {
  const body: Record<string, unknown> = {
    snippet: buildYoutubeSnippet(settings, message),
    status: buildYoutubeStatus(settings),
  };
  if (settings.recordingDate) {
    body.recordingDetails = { recordingDate: settings.recordingDate };
  }
  return body;
}

const clientAndYoutube = () => {
  const client = new google.auth.OAuth2({
    clientId: process.env.YOUTUBE_CLIENT_ID,
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
    redirectUri: `${process.env.FRONTEND_URL}/integrations/social/youtube`,
  });

  const youtube = (newClient: OAuth2Client) =>
    google.youtube({
      version: 'v3',
      auth: newClient,
    });

  const youtubeAnalytics = (newClient: OAuth2Client) =>
    google.youtubeAnalytics({
      version: 'v2',
      auth: newClient,
    });

  const oauth2 = (newClient: OAuth2Client) =>
    google.oauth2({
      version: 'v2',
      auth: newClient,
    });

  return { client, youtube, oauth2, youtubeAnalytics };
};

@Rules('YouTube must have on video attachment, it cannot be empty')
export class YoutubeProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 1; // YouTube has strict upload quotas
  identifier = 'youtube';
  name = 'YouTube';
  isBetweenSteps = true;
  dto = YoutubeSettingsDto;
  scopes = [
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtube.force-ssl',
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtubepartner',
    'https://www.googleapis.com/auth/yt-analytics.readonly',
  ];

  editor = 'normal' as const;
  maxLength() {
    return 5000;
  }

  override handleErrors(body: string):
    | {
        type: 'refresh-token' | 'bad-body';
        value: string;
      }
    | undefined {
    if (body.includes('invalidTitle')) {
      return {
        type: 'bad-body',
        value:
          'We have uploaded your video but we could not set the title. Title is too long.',
      };
    }

    if (body.includes('failedPrecondition')) {
      return {
        type: 'bad-body',
        value:
          'We have uploaded your video but we could not set the thumbnail. Thumbnail size is too large.',
      };
    }

    if (body.includes('uploadLimitExceeded')) {
      return {
        type: 'bad-body',
        value:
          'You have reached your daily upload limit, please try again tomorrow.',
      };
    }

    if (body.includes('youtubeSignupRequired')) {
      return {
        type: 'bad-body',
        value:
          'You have to link your youtube account to your google account first.',
      };
    }

    if (body.includes('youtube.thumbnail')) {
      return {
        type: 'bad-body',
        value:
          'Your account is not verified, we have uploaded your video but we could not set the thumbnail. Please verify your account and try again.',
      };
    }

    if (body.includes('invalidPublishAt')) {
      return {
        type: 'bad-body',
        value:
          'The scheduled publish time is invalid (must be a future ISO 8601 timestamp with privacyStatus=private).',
      };
    }

    if (body.includes('invalidCategoryId')) {
      return {
        type: 'bad-body',
        value:
          "The provided YouTube category ID is not valid or not assignable in this channel's region.",
      };
    }

    return undefined;
  }

  async refreshToken(refresh_token: string): Promise<AuthTokenDetails> {
    const { client, oauth2 } = clientAndYoutube();
    client.setCredentials({ refresh_token });
    const { credentials } = await client.refreshAccessToken();
    const user = oauth2(client);
    const expiryDate = new Date(credentials.expiry_date!);
    const unixTimestamp =
      Math.floor(expiryDate.getTime() / 1000) -
      Math.floor(new Date().getTime() / 1000);

    const { data } = await user.userinfo.get();

    return {
      accessToken: credentials.access_token!,
      expiresIn: unixTimestamp!,
      refreshToken: credentials.refresh_token!,
      id: data.id!,
      name: data.name!,
      picture: data?.picture || '',
      username: '',
    };
  }

  async generateAuthUrl() {
    const state = makeId(7);
    const { client } = clientAndYoutube();
    return {
      url: client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        state,
        redirect_uri: `${process.env.FRONTEND_URL}/integrations/social/youtube`,
        scope: this.scopes.slice(0),
      }),
      codeVerifier: makeId(11),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const { client, oauth2 } = clientAndYoutube();
    const { tokens } = await client.getToken(params.code);
    client.setCredentials(tokens);
    const { scopes } = await client.getTokenInfo(tokens.access_token!);
    this.checkScopes(this.scopes, scopes);

    const user = oauth2(client);
    const { data } = await user.userinfo.get();

    const expiryDate = new Date(tokens.expiry_date!);
    const unixTimestamp =
      Math.floor(expiryDate.getTime() / 1000) -
      Math.floor(new Date().getTime() / 1000);

    return {
      accessToken: tokens.access_token!,
      expiresIn: unixTimestamp,
      refreshToken: tokens.refresh_token!,
      id: data.id!,
      name: data.name!,
      picture: data?.picture || '',
      username: '',
    };
  }

  async pages(accessToken: string) {
    const { client, youtube } = clientAndYoutube();
    client.setCredentials({ access_token: accessToken });
    const youtubeClient = youtube(client);

    try {
      // Get all channels the user has access to
      const response = await youtubeClient.channels.list({
        part: ['snippet', 'contentDetails', 'statistics'],
        mine: true,
      });

      const channels = response.data.items || [];

      return channels.map((channel) => ({
        id: channel.id!,
        name: channel.snippet?.title || 'Unnamed Channel',
        picture: {
          data: {
            url: channel.snippet?.thumbnails?.default?.url || '',
          },
        },
        username: channel.snippet?.customUrl || '',
        subscriberCount: channel.statistics?.subscriberCount || '0',
      }));
    } catch (error) {
      console.error('Failed to fetch YouTube channels:', error);
      return [];
    }
  }

  async fetchPageInformation(
    accessToken: string,
    data: { id: string }
  ) {
    const { client, youtube } = clientAndYoutube();
    client.setCredentials({ access_token: accessToken });
    const youtubeClient = youtube(client);

    try {
      const response = await youtubeClient.channels.list({
        part: ['snippet', 'contentDetails', 'statistics'],
        id: [data.id],
      });

      const channel = response.data.items?.[0];

      if (!channel) {
        throw new Error('Channel not found');
      }

      return {
        id: channel.id!,
        name: channel.snippet?.title || 'Unnamed Channel',
        access_token: accessToken,
        picture: channel.snippet?.thumbnails?.default?.url || '',
        username: channel.snippet?.customUrl || '',
      };
    } catch (error) {
      console.error('Failed to fetch YouTube channel information:', error);
      throw error;
    }
  }

  async reConnect(
    id: string,
    requiredId: string,
    accessToken: string
  ): Promise<Omit<AuthTokenDetails, 'refreshToken' | 'expiresIn'>> {
    const pages = await this.pages(accessToken);
    const findPage = pages.find((p) => p.id === requiredId);

    if (!findPage) {
      throw new Error('Channel not found');
    }

    const information = await this.fetchPageInformation(accessToken, {
      id: requiredId,
    });

    return {
      id: information.id,
      name: information.name,
      accessToken: information.access_token,
      picture: information.picture,
      username: information.username,
    };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[]
  ): Promise<PostResponse[]> {
    const [firstPost, ...comments] = postDetails;

    const { client, youtube } = clientAndYoutube();
    client.setCredentials({ access_token: accessToken });
    const youtubeClient = youtube(client);

    const { settings }: { settings: YoutubeSettingsDto } = firstPost;

    // S3 belt-and-suspenders: DTO already rejects publishAt + non-private at
    // ValidationPipe; this guards against any caller that bypasses the DTO.
    if (settings.publishAt && settings.type !== 'private') {
      throw new BadBody(
        'publishAt-requires-private',
        JSON.stringify({}),
        {} as any,
        'When publishAt is set, type must be "private" — YouTube requires this.'
      );
    }

    const response = await axios({
      url: firstPost?.media?.[0]?.path,
      method: 'GET',
      responseType: 'stream',
    });

    const all: GaxiosResponse<Schema$Video> = await this.runInConcurrent(
      async () =>
        youtubeClient.videos.insert({
          part: buildYoutubePartArray(settings),
          notifySubscribers: true,
          requestBody: buildYoutubeRequestBody(settings, firstPost?.message),
          media: {
            body: response.data,
          },
        }),
      true
    );

    if (settings?.thumbnail?.path) {
      await this.runInConcurrent(async () =>
        youtubeClient.thumbnails.set({
          videoId: all?.data?.id!,
          media: {
            body: (
              await axios({
                url: settings?.thumbnail?.path,
                method: 'GET',
                responseType: 'stream',
              })
            ).data,
          },
        })
      );
    }

    // S7: direct call (NOT runInConcurrent) so caption failures stay local
    // and do not get re-thrown as RefreshToken/BadBody by handleErrors().
    // S14: failure is silent (logged only) — never fails the post.
    if (settings?.captions?.path) {
      try {
        const captionStream = await axios({
          url: settings.captions.path,
          method: 'GET',
          responseType: 'stream',
        });

        await youtubeClient.captions.insert({
          part: ['snippet'],
          requestBody: {
            snippet: {
              videoId: all?.data?.id!,
              language: settings.captionsLanguage ?? 'en', // S10
              name: '',
              isDraft: false,
            },
          },
          media: {
            body: captionStream.data,
            mimeType: 'application/octet-stream', // S8
          },
        });
      } catch (err) {
        // S12: tolerate captionExists (idempotent re-upload) as soft-success.
        // S14: any other caption error is logged and swallowed.
        const message = this.captionErrorMessage(err);
        console.error(
          'YouTube caption upload failed (non-fatal):',
          message
        );
      }
    }

    return [
      {
        id: firstPost.id,
        releaseURL: `https://www.youtube.com/watch?v=${all?.data?.id}`,
        postId: all?.data?.id!,
        status: 'success',
      },
    ];
  }

  /**
   * Map caption-specific errors to user-friendly strings WITHOUT going through
   * handleErrors() — handleErrors can return type:'refresh-token' which would
   * escalate to an exception via runInConcurrent and defeat S7 isolation.
   */
  private captionErrorMessage(err: unknown): string {
    const body = JSON.stringify(err ?? '');
    if (body.includes('captionExists')) {
      return 'Caption track already exists for this language (treated as soft-success).';
    }
    if (body.includes('insufficientPermissions')) {
      return 'Caption upload requires the youtube.force-ssl scope. Please reconnect this YouTube channel.';
    }
    if (body.includes('invalidMetadata')) {
      return 'Caption metadata is invalid (check captionsLanguage BCP-47 tag).';
    }
    if (body.includes('contentRequired')) {
      return 'Caption file is empty or could not be fetched.';
    }
    return body.slice(0, 500);
  }

  async analytics(
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]> {
    try {
      const endDate = dayjs().format('YYYY-MM-DD');
      const startDate = dayjs().subtract(date, 'day').format('YYYY-MM-DD');

      const { client, youtubeAnalytics } = clientAndYoutube();
      client.setCredentials({ access_token: accessToken });

      const youtubeClient = youtubeAnalytics(client);
      const { data } = await youtubeClient.reports.query({
        ids: 'channel==MINE',
        startDate,
        endDate,
        metrics:
          'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,likes,subscribersLost',
        dimensions: 'day',
        sort: 'day',
      });

      const columns = data?.columnHeaders?.map((p) => p.name)!;
      const mappedData = data?.rows?.map((p) => {
        return columns.reduce((acc, curr, index) => {
          acc[curr!] = p[index];
          return acc;
        }, {} as any);
      });

      const acc = [] as any[];
      acc.push({
        label: 'Estimated Minutes Watched',
        data: mappedData?.map((p: any) => ({
          total: p.estimatedMinutesWatched,
          date: p.day,
        })),
      });

      acc.push({
        label: 'Average View Duration',
        average: true,
        data: mappedData?.map((p: any) => ({
          total: p.averageViewDuration,
          date: p.day,
        })),
      });

      acc.push({
        label: 'Average View Percentage',
        average: true,
        data: mappedData?.map((p: any) => ({
          total: p.averageViewPercentage,
          date: p.day,
        })),
      });

      acc.push({
        label: 'Subscribers Gained',
        data: mappedData?.map((p: any) => ({
          total: p.subscribersGained,
          date: p.day,
        })),
      });

      acc.push({
        label: 'Subscribers Lost',
        data: mappedData?.map((p: any) => ({
          total: p.subscribersLost,
          date: p.day,
        })),
      });

      acc.push({
        label: 'Likes',
        data: mappedData?.map((p: any) => ({
          total: p.likes,
          date: p.day,
        })),
      });

      return acc;
    } catch (err) {
      return [];
    }
  }
}
