// libraries/nestjs-libraries/src/integrations/social/youtube.provider.spec.ts
//
// Phase 2: Provider integration spec for YoutubeProvider.post() and its
// error-handling surfaces. Mocks googleapis at module-top + axios + spies on
// runInConcurrent (inherited from SocialAbstract).
//
// Risk-tier HIGH coverage:
//   - S7 caption-isolation: captions.insert failure MUST NOT fail the post.
//   - S7 caption-direct-call: captions.insert MUST NOT go through runInConcurrent.
//   - S10 captionsLanguage default 'en' fallback.
//   - S12 captionExists tolerated as soft-success.
//   - S3 BadBody throw at provider line 369 (DTO-bypass defensive guard).
//   - handleErrors() new branches (invalidPublishAt, invalidCategoryId).
//   - captionErrorMessage() substring matches (4 patterns).
//
// Expected counter-test-by-revert cardinalities (per pact-testing-strategies):
//   - Remove caption try/catch → {2 fail} (caption-rejects-still-success +
//     caption-upstream-axios-still-success).
//   - Replace direct captions.insert with runInConcurrent → {1 fail}
//     (runInConcurrent-call-count assertion).
//   - Remove S3 BadBody guard → {1 fail} (provider-level S3 guard test).

import { Readable } from 'node:stream';
import { BadBody } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { gaxiosOkResponse } from './__fixtures__/youtube.fixtures';

// --- Module mocks ----------------------------------------------------------
// concurrency.service has a module-load-time Bottleneck.IORedisConnection side
// effect that fails when ioRedis is unmocked. Replace it with a pass-through
// so the import graph for youtube.provider.ts loads cleanly.
jest.mock('@gitroom/helpers/utils/concurrency.service', () => ({
  concurrency: async (_id: string, _max: number, fn: () => Promise<unknown>) =>
    fn(),
}));

// googleapis is heavy; we replace it entirely. The provider's `clientAndYoutube()`
// factory calls `google.auth.OAuth2`, `google.youtube`, `google.oauth2`,
// `google.youtubeAnalytics`. We expose `videos.insert`, `thumbnails.set`,
// `captions.insert` as accessible jest.fn()s.

const videosInsert = jest.fn();
const thumbnailsSet = jest.fn();
const captionsInsert = jest.fn();
const userinfoGet = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: jest.fn(),
        refreshAccessToken: jest.fn(),
        getToken: jest.fn(),
        getTokenInfo: jest.fn(),
        generateAuthUrl: jest.fn(),
      })),
    },
    youtube: jest.fn(() => ({
      videos: { insert: videosInsert },
      thumbnails: { set: thumbnailsSet },
      captions: { insert: captionsInsert },
      channels: { list: jest.fn() },
    })),
    oauth2: jest.fn(() => ({ userinfo: { get: userinfoGet } })),
    youtubeAnalytics: jest.fn(() => ({ reports: { query: jest.fn() } })),
  },
  // Provider imports `youtube_v3` for a TS namespace import; expose an empty
  // object so the import resolves at runtime.
  youtube_v3: {},
}));

// axios — the provider streams the video body and thumbnail/caption files.
jest.mock('axios', () => {
  const mockAxios: any = jest.fn(async (config: any) => ({
    data: Readable.from([Buffer.from('mock-bytes')]),
  }));
  mockAxios.get = jest.fn();
  return { __esModule: true, default: mockAxios };
});

// Imports MUST come after jest.mock calls so the mocked modules are loaded.
import axios from 'axios';
import {
  YoutubeProvider,
} from './youtube.provider';

// --- Helpers --------------------------------------------------------------

function makeSettings(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Provider test',
    type: 'public',
    selfDeclaredMadeForKids: 'no',
    tags: [] as Array<{ value: string; label: string }>,
    ...overrides,
  };
}

function makePostDetails(settings: any, message = 'Body') {
  return [
    {
      id: 'post-1',
      message,
      media: [{ id: 'media-1', path: 'https://cdn.example.com/video.mp4' }],
      settings,
    },
  ] as any;
}

function videoIdResponse(id = 'vid_abc') {
  return gaxiosOkResponse({ id });
}

// --- Spec ----------------------------------------------------------------

describe('YoutubeProvider', () => {
  let provider: YoutubeProvider;
  let runInConcurrentSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new YoutubeProvider();
    // The provider calls runInConcurrent for videos.insert + thumbnails.set
    // but NOT for captions.insert (S7). Spy so we can assert call count.
    runInConcurrentSpy = jest
      .spyOn(provider, 'runInConcurrent' as any)
      // Default: pass through to the inner function so the mock returns work.
      .mockImplementation(async (fn: any) => fn());
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Default mock returns
    videosInsert.mockResolvedValue(videoIdResponse('vid_abc'));
    thumbnailsSet.mockResolvedValue(gaxiosOkResponse({}));
    captionsInsert.mockResolvedValue(gaxiosOkResponse({}));
    (axios as unknown as jest.Mock).mockImplementation(async () => ({
      data: Readable.from([Buffer.from('mock-bytes')]),
    }));
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  // --- Legacy-shape backwards compat ----------------------------------------

  describe('legacy backwards compatibility', () => {
    it('uploads with notifySubscribers:true and legacy request body (no new fields)', async () => {
      const result = await provider.post(
        'integration-1',
        'token',
        makePostDetails(makeSettings({ title: 'Legacy', type: 'public' }))
      );

      expect(videosInsert).toHaveBeenCalledTimes(1);
      const callArg = videosInsert.mock.calls[0][0];
      expect(callArg.notifySubscribers).toBe(true);
      expect(callArg.part).toEqual(['id', 'snippet', 'status']);
      expect(callArg.requestBody.snippet).toMatchObject({
        title: 'Legacy',
        description: 'Body',
      });
      expect(callArg.requestBody.snippet).not.toHaveProperty('categoryId');
      expect(callArg.requestBody.status).toMatchObject({
        privacyStatus: 'public',
      });
      expect(callArg.requestBody).not.toHaveProperty('recordingDetails');
      expect(result).toEqual([
        {
          id: 'post-1',
          releaseURL: 'https://www.youtube.com/watch?v=vid_abc',
          postId: 'vid_abc',
          status: 'success',
        },
      ]);
    });

    it('sets thumbnail via runInConcurrent when settings.thumbnail.path is set', async () => {
      await provider.post(
        'i',
        'token',
        makePostDetails(
          makeSettings({
            thumbnail: { id: 't', path: 'https://cdn.example.com/t.png' },
          })
        )
      );
      expect(thumbnailsSet).toHaveBeenCalledTimes(1);
      // runInConcurrent invoked exactly twice: videos + thumbnail (NOT for captions).
      expect(runInConcurrentSpy).toHaveBeenCalledTimes(2);
    });
  });

  // --- S3 provider-level defensive guard ------------------------------------

  describe('S3 defensive guard (publishAt + non-private)', () => {
    it('throws BadBody when publishAt is set with type=public (DTO bypass scenario)', async () => {
      // Simulates a caller bypassing the DTO ValidationPipe (e.g., internal
      // call, future MCP route). Provider must still reject.
      await expect(
        provider.post(
          'i',
          'token',
          makePostDetails(
            makeSettings({
              type: 'public',
              publishAt: '2026-06-15T14:00:00.000Z',
            })
          )
        )
      ).rejects.toBeInstanceOf(BadBody);

      // And videos.insert MUST NOT have been called.
      expect(videosInsert).not.toHaveBeenCalled();
    });

    it('allows publishAt when type=private (happy path)', async () => {
      await provider.post(
        'i',
        'token',
        makePostDetails(
          makeSettings({
            type: 'private',
            publishAt: '2026-06-15T14:00:00.000Z',
          })
        )
      );
      expect(videosInsert).toHaveBeenCalledTimes(1);
      const body = videosInsert.mock.calls[0][0].requestBody;
      expect(body.status.publishAt).toBe('2026-06-15T14:00:00.000Z');
      expect(body.status.privacyStatus).toBe('private');
    });
  });

  // --- Per-field forwarding to googleapis -----------------------------------

  describe('new-field forwarding to videos.insert', () => {
    it('forwards categoryId into snippet', async () => {
      await provider.post(
        'i',
        'token',
        makePostDetails(makeSettings({ categoryId: '22' }))
      );
      expect(videosInsert.mock.calls[0][0].requestBody.snippet.categoryId).toBe(
        '22'
      );
    });

    it('forwards defaultLanguage into snippet', async () => {
      await provider.post(
        'i',
        'token',
        makePostDetails(makeSettings({ defaultLanguage: 'en-US' }))
      );
      expect(
        videosInsert.mock.calls[0][0].requestBody.snippet.defaultLanguage
      ).toBe('en-US');
    });

    it("appends 'recordingDetails' to part and emits recordingDetails block", async () => {
      await provider.post(
        'i',
        'token',
        makePostDetails(makeSettings({ recordingDate: '2026-05-15' }))
      );
      const arg = videosInsert.mock.calls[0][0];
      expect(arg.part).toContain('recordingDetails');
      expect(arg.requestBody.recordingDetails).toEqual({
        recordingDate: '2026-05-15',
      });
    });

    it("does NOT include 'recordingDetails' in part across consecutive calls with mixed settings (S9 regression)", async () => {
      await provider.post(
        'i',
        'token',
        makePostDetails(makeSettings({ recordingDate: '2026-05-15' }))
      );
      // Reset call history on videosInsert but NOT module-scope module state.
      videosInsert.mockClear();
      await provider.post(
        'i',
        'token',
        makePostDetails(makeSettings()) // no recordingDate this time
      );
      const arg = videosInsert.mock.calls[0][0];
      expect(arg.part).toEqual(['id', 'snippet', 'status']);
      expect(arg.part).not.toContain('recordingDetails');
      expect(arg.requestBody).not.toHaveProperty('recordingDetails');
    });
  });

  // --- Captions: S7, S8, S10, S12, S14 -------------------------------------

  describe('captions block — S7 isolation + S10 default + S12 soft-success', () => {
    const captionSettings = (extra: Record<string, unknown> = {}) =>
      makeSettings({
        captions: {
          id: 'cap',
          path: 'https://cdn.example.com/cap.srt',
        },
        ...extra,
      });

    it('calls captions.insert when settings.captions.path is set', async () => {
      await provider.post('i', 'token', makePostDetails(captionSettings()));
      expect(captionsInsert).toHaveBeenCalledTimes(1);
    });

    it("defaults snippet.language to 'en' when captionsLanguage is unset (S10)", async () => {
      await provider.post('i', 'token', makePostDetails(captionSettings()));
      const arg = captionsInsert.mock.calls[0][0];
      expect(arg.requestBody.snippet.language).toBe('en');
    });

    it('uses settings.captionsLanguage when set', async () => {
      await provider.post(
        'i',
        'token',
        makePostDetails(captionSettings({ captionsLanguage: 'es' }))
      );
      const arg = captionsInsert.mock.calls[0][0];
      expect(arg.requestBody.snippet.language).toBe('es');
    });

    it("sets mimeType='application/octet-stream' on the captions media body (S8)", async () => {
      await provider.post('i', 'token', makePostDetails(captionSettings()));
      const arg = captionsInsert.mock.calls[0][0];
      expect(arg.media.mimeType).toBe('application/octet-stream');
    });

    it('captions.insert is called DIRECTLY, NOT via runInConcurrent (S7 anchor)', async () => {
      // S7 isolation: caption failures must not be re-thrown as BadBody by
      // SocialAbstract.runInConcurrent → handleErrors path. Verify no captions
      // call passed through runInConcurrent.
      await provider.post('i', 'token', makePostDetails(captionSettings()));
      // runInConcurrent invoked for videos.insert only (no thumbnail in fixture).
      expect(runInConcurrentSpy).toHaveBeenCalledTimes(1);
      expect(captionsInsert).toHaveBeenCalledTimes(1);
    });

    it("returns status:'success' when captions.insert rejects (S7+S14 — highest claim-load)", async () => {
      captionsInsert.mockRejectedValueOnce(
        new Error('YouTube returned 500 — caption upload broken')
      );

      const result = await provider.post(
        'i',
        'token',
        makePostDetails(captionSettings())
      );

      expect(result).toEqual([
        {
          id: 'post-1',
          releaseURL: 'https://www.youtube.com/watch?v=vid_abc',
          postId: 'vid_abc',
          status: 'success',
        },
      ]);
      expect(errorSpy).toHaveBeenCalled();
      const errArgs = errorSpy.mock.calls
        .find((args) =>
          typeof args[0] === 'string' && args[0].includes('caption')
        );
      expect(errArgs).toBeDefined();
    });

    it("returns status:'success' when upstream axios for captions throws BEFORE captions.insert", async () => {
      // Default axios mock succeeds for the video stream (first call) but
      // rejects for the captions stream (second call).
      (axios as unknown as jest.Mock)
        .mockImplementationOnce(async () => ({
          data: Readable.from([Buffer.from('video-bytes')]),
        }))
        .mockImplementationOnce(async () => {
          throw new Error('captions URL 404');
        });

      const result = await provider.post(
        'i',
        'token',
        makePostDetails(captionSettings())
      );
      expect(result[0].status).toBe('success');
      // captions.insert never called because axios threw first.
      expect(captionsInsert).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });

    it("tolerates captionExists 409 as soft-success (S12)", async () => {
      captionsInsert.mockRejectedValueOnce({
        message: 'captionExists',
        errors: [{ reason: 'captionExists' }],
      });

      const result = await provider.post(
        'i',
        'token',
        makePostDetails(captionSettings())
      );

      expect(result[0].status).toBe('success');
      // captionErrorMessage should have produced the soft-success string.
      const messages = errorSpy.mock.calls.flatMap((args) =>
        args.map((a: unknown) => (typeof a === 'string' ? a : JSON.stringify(a)))
      );
      expect(
        messages.some((m) => m.includes('soft-success') || m.includes('captionExists'))
      ).toBe(true);
    });

    it('caption failure does NOT prevent thumbnail upload when both are set', async () => {
      captionsInsert.mockRejectedValueOnce(new Error('caption boom'));

      await provider.post(
        'i',
        'token',
        makePostDetails(
          captionSettings({
            thumbnail: { id: 't', path: 'https://cdn.example.com/t.png' },
          })
        )
      );

      expect(thumbnailsSet).toHaveBeenCalledTimes(1);
      // runInConcurrent called for video + thumbnail = 2 (captions still direct).
      expect(runInConcurrentSpy).toHaveBeenCalledTimes(2);
    });
  });

  // --- handleErrors new branches --------------------------------------------

  describe('handleErrors() new branches', () => {
    it('maps invalidPublishAt to a publish-time bad-body message', () => {
      const out = provider.handleErrors('{"error":"invalidPublishAt"}');
      expect(out).toEqual({
        type: 'bad-body',
        value: expect.stringContaining('publish'),
      });
    });

    it('maps invalidCategoryId to a category bad-body message', () => {
      const out = provider.handleErrors('{"error":"invalidCategoryId"}');
      expect(out).toEqual({
        type: 'bad-body',
        value: expect.stringContaining('category'),
      });
    });

    it('does not match unrelated YouTube errors (returns undefined)', () => {
      expect(provider.handleErrors('{"error":"unknownThing"}')).toBeUndefined();
    });

    it('still maps the pre-existing branches (invalidTitle / failedPrecondition / etc.)', () => {
      expect(provider.handleErrors('invalidTitle')).toBeDefined();
      expect(provider.handleErrors('failedPrecondition')).toBeDefined();
      expect(provider.handleErrors('uploadLimitExceeded')).toBeDefined();
      expect(provider.handleErrors('youtubeSignupRequired')).toBeDefined();
      expect(provider.handleErrors('youtube.thumbnail')).toBeDefined();
    });
  });

  // --- captionErrorMessage substring mapping --------------------------------

  describe('captionErrorMessage() substring mapping', () => {
    // captionErrorMessage is private; we exercise it indirectly by injecting
    // each substring as a caption failure and inspecting console.error output.

    async function captureCaptionError(errorBody: unknown): Promise<string> {
      captionsInsert.mockRejectedValueOnce(errorBody);
      await provider.post(
        'i',
        'token',
        makePostDetails(
          makeSettings({
            captions: { id: 'cap', path: 'https://cdn.example.com/x.srt' },
          })
        )
      );
      const captionMsg = errorSpy.mock.calls
        .map((args) =>
          args
            .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
            .join(' ')
        )
        .find((line) => line.includes('caption') || line.includes('Caption'));
      expect(captionMsg).toBeDefined();
      return captionMsg!;
    }

    it('maps captionExists to soft-success message', async () => {
      const msg = await captureCaptionError({ reason: 'captionExists' });
      expect(msg).toContain('soft-success');
    });

    it('maps insufficientPermissions to scope-reconnect message', async () => {
      const msg = await captureCaptionError({
        reason: 'insufficientPermissions',
      });
      expect(msg.toLowerCase()).toContain('scope');
    });

    it('maps invalidMetadata to BCP-47 hint message', async () => {
      const msg = await captureCaptionError({ reason: 'invalidMetadata' });
      expect(msg).toContain('BCP-47');
    });

    it('maps contentRequired to empty-caption message', async () => {
      const msg = await captureCaptionError({ reason: 'contentRequired' });
      expect(msg.toLowerCase()).toContain('empty');
    });

    it('falls through to a truncated raw error body when no substring matches', async () => {
      const longErr = 'x'.repeat(1000);
      const msg = await captureCaptionError({ reason: longErr });
      // Truncation guard at 500 chars (captionErrorMessage line 480).
      // The console.error format includes a prefix, so check the err body
      // length only — strip the "YouTube caption upload failed (non-fatal):"
      // prefix.
      const stripped = msg.replace(/^.*non-fatal\):\s*/, '');
      expect(stripped.length).toBeLessThanOrEqual(500);
    });
  });
});
