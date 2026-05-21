// libraries/nestjs-libraries/src/database/prisma/posts/posts.service.update-media.spec.ts
//
// R5 fix coverage (plan §Risk Register R5; architect §1 file manifest entry
// for posts.service.ts). `getMediaById` now returns null when the media-
// janitor has hard-deleted the row; the pre-fix `.map(m => m.path.indexOf(...))`
// blew up on null. The fix inserts a null-and-path filter immediately before
// the downstream map.
//
// NG-1 — input contains an id-only entry whose media row was hard-deleted
//          (getMediaById → null). Pre-fix: throw. Post-fix: silently dropped.
// NG-2 — input contains an id-only entry whose media row exists. Post-fix:
//          mapped normally, URL constructed from FRONTEND_URL + path.
// NG-3 — mixed input (pass-through entry + missing-row entry). Only the
//          existing row survives; the post is updated with the surviving set.
//
// Counter-test-by-revert: NG-1 anchors the fix — reverting the filter line
// (or making it `.filter(m => true)`) MUST flip this test RED.
import { Test } from '@nestjs/testing';

jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: jest.fn(),
}));
jest.mock('@gitroom/nestjs-libraries/integrations/social.abstract', () => ({
  BadBody: class BadBody extends Error {},
  RefreshToken: class RefreshToken extends Error {},
}));
jest.mock('@sentry/nestjs', () => ({
  metrics: { count: jest.fn() },
  captureMessage: jest.fn(),
}));
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: {
    createStorage: jest.fn(() => ({})),
  },
}));

import { PostsService } from './posts.service';

function buildService(overrides: {
  mediaService?: Record<string, jest.Mock>;
  postRepository?: Record<string, jest.Mock>;
} = {}) {
  const mediaService = {
    getMediaById: jest.fn(),
    ...overrides.mediaService,
  };
  const postRepository = {
    updateImages: jest.fn(),
    ...overrides.postRepository,
  };
  // Constructor arg order (posts.service.ts:57-70):
  //  0 postRepository, 1 workerServiceProducer, 2 integrationManager,
  //  3 notificationService, 4 messagesService, 5 stripeService,
  //  6 integrationService, 7 mediaService, 8 shortLinkService,
  //  9 webhookService, 10 openaiService, 11 refreshIntegrationService
  const service = new PostsService(
    postRepository as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    mediaService as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, mediaService, postRepository };
}

describe('PostsService.updateMedia — R5 null-guard', () => {
  const ORIG_FRONTEND = process.env.FRONTEND_URL;
  const ORIG_UPLOAD = process.env.UPLOAD_DIRECTORY;
  const ORIG_STATIC = process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY;

  beforeAll(() => {
    process.env.FRONTEND_URL = 'https://app.example.test';
    process.env.UPLOAD_DIRECTORY = '/tmp/uploads-test';
    process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY = 'uploads';
  });

  afterAll(() => {
    if (ORIG_FRONTEND === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = ORIG_FRONTEND;
    if (ORIG_UPLOAD === undefined) delete process.env.UPLOAD_DIRECTORY;
    else process.env.UPLOAD_DIRECTORY = ORIG_UPLOAD;
    if (ORIG_STATIC === undefined)
      delete process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY;
    else process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY = ORIG_STATIC;
  });

  it('NG-1: an id-only entry whose row was hard-deleted is silently dropped (does NOT throw)', async () => {
    const { service, mediaService } = buildService({
      mediaService: {
        // R5 scenario: janitor hard-deleted the Media row between post-load
        // and updateMedia call. getMediaById returns null.
        getMediaById: jest.fn(async () => null),
      },
    });

    const result = await (service as any).updateMedia('post-1', [
      { id: 'media-gone' },
    ]);

    expect(mediaService.getMediaById).toHaveBeenCalledWith('media-gone');
    // Pre-fix this would throw `Cannot read properties of null`.
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it('NG-2: an id-only entry whose row exists is mapped (path + url constructed from env)', async () => {
    const { service, mediaService } = buildService({
      mediaService: {
        getMediaById: jest.fn(async () => ({
          id: 'media-ok',
          path: '/2025/06/15/hit.png',
        })),
      },
    });

    const result = await (service as any).updateMedia('post-1', [
      { id: 'media-ok' },
    ]);

    expect(mediaService.getMediaById).toHaveBeenCalledWith('media-ok');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'media-ok',
      type: 'image',
      url: 'https://app.example.test/uploads/2025/06/15/hit.png',
      path: '/tmp/uploads-test/2025/06/15/hit.png',
    });
  });

  it('NG-3: mixed input — existing-row entry + missing-row entry → only the existing one survives', async () => {
    const { service, mediaService } = buildService({
      mediaService: {
        getMediaById: jest.fn(async (id: string) => {
          if (id === 'media-ok') {
            return { id: 'media-ok', path: '/2025/01/02/a.png' };
          }
          return null;
        }),
      },
    });

    const result = await (service as any).updateMedia('post-1', [
      { id: 'media-ok' },
      { id: 'media-gone' },
    ]);

    expect(mediaService.getMediaById).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('media-ok');
  });

  it('NG-3b: a pass-through entry (path already set, no id-lookup needed) is preserved', async () => {
    const { service, mediaService } = buildService({
      mediaService: {
        // Should NOT be called for pass-through entries.
        getMediaById: jest.fn(),
      },
    });

    const result = await (service as any).updateMedia('post-1', [
      { id: 'inline-id', path: '/2025/01/02/inline.png' },
    ]);

    expect(mediaService.getMediaById).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: 'image',
      url: 'https://app.example.test/uploads/2025/01/02/inline.png',
    });
  });

  it('NG-3c: an entry returned from getMediaById with a null path is also dropped (defense-in-depth)', async () => {
    const { service } = buildService({
      mediaService: {
        getMediaById: jest.fn(async () => ({ id: 'media-stub', path: null })),
      },
    });

    const result = await (service as any).updateMedia('post-1', [
      { id: 'media-stub' },
    ]);

    expect(result).toHaveLength(0);
  });
});
