// libraries/nestjs-libraries/src/upload/media.path.resolver.spec.ts
//
// Unit coverage for MediaPathResolver — the pre-flight discriminated-union
// classifier (architect §5, plan §Three in-the-wild Media.path shapes,
// invariant #8).
//
// The resolver layer is non-throwing by contract; every input maps to one of
// three kinds: local | remote | rejected. Path-confinement filesystem checks
// are exercised by path.confinement.spec.ts — this spec focuses on the
// classification ORDER (modern → legacy → http(s) → unknown) and the
// resolver's no-throw contract.
import { promises as fsp } from 'fs';
import { mkdtemp, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { MediaPathResolver } from './media.path.resolver';

describe('MediaPathResolver.resolveForDelete', () => {
  let resolver: MediaPathResolver;
  let root: string;
  let rootRaw: string;
  const originalFrontendUrl = process.env.FRONTEND_URL;
  const originalUploadDir = process.env.UPLOAD_DIRECTORY;
  const FRONTEND = 'https://app.example.test';

  const ctx = { runId: 'mj-test-000000', mediaId: 'media-abc' };

  beforeAll(async () => {
    rootRaw = await mkdtemp(path.join(tmpdir(), 'mj-resolver-'));
    root = await fsp.realpath(rootRaw);
    await mkdir(path.join(root, '2025', '06', '15'), { recursive: true });
    await writeFile(path.join(root, '2025', '06', '15', 'hit.png'), 'PNG');

    process.env.FRONTEND_URL = FRONTEND;
    process.env.UPLOAD_DIRECTORY = root;
    resolver = new MediaPathResolver();
  });

  afterAll(async () => {
    if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontendUrl;
    if (originalUploadDir === undefined) delete process.env.UPLOAD_DIRECTORY;
    else process.env.UPLOAD_DIRECTORY = originalUploadDir;
    await fsp.rm(rootRaw, { recursive: true, force: true }).catch(() => {});
  });

  describe('classification ordering (load-bearing, plan §Path-confinement contract)', () => {
    it('1. modern URL: FRONTEND_URL/uploads/... -> local', async () => {
      const result = await resolver.resolveForDelete(
        `${FRONTEND}/uploads/2025/06/15/hit.png`,
        ctx
      );
      expect(result.kind).toBe('local');
      if (result.kind === 'local') {
        expect(result.absolutePath).toBe(
          path.join(root, '2025', '06', '15', 'hit.png')
        );
      }
    });

    it('2. legacy relative: /YYYY/MM/DD/... -> local', async () => {
      const result = await resolver.resolveForDelete(
        '/2025/06/15/hit.png',
        ctx
      );
      expect(result.kind).toBe('local');
    });

    it('3. http(s) NOT matching FRONTEND_URL -> remote (row-delete only)', async () => {
      const result = await resolver.resolveForDelete(
        'https://cdn.cloudflare.com/img.png',
        ctx
      );
      expect(result.kind).toBe('remote');
      if (result.kind === 'remote') {
        expect(result.reason).toBe('http_scheme');
        expect(result.url).toBe('https://cdn.cloudflare.com/img.png');
      }
    });

    it('3b. http:// (non-TLS) NOT matching FRONTEND_URL -> remote', async () => {
      const result = await resolver.resolveForDelete(
        'http://legacy.example.com/img.jpg',
        ctx
      );
      expect(result.kind).toBe('remote');
    });

    it('4. unknown shape -> rejected with unknown_shape', async () => {
      const result = await resolver.resolveForDelete(
        'just-a-filename.png',
        ctx
      );
      expect(result.kind).toBe('rejected');
      if (result.kind === 'rejected') expect(result.reason).toBe('unknown_shape');
    });

    it('4b. empty string -> rejected (unknown_shape)', async () => {
      const result = await resolver.resolveForDelete('', ctx);
      expect(result.kind).toBe('rejected');
      if (result.kind === 'rejected') expect(result.reason).toBe('unknown_shape');
    });

    it('4c. non-string input -> rejected (unknown_shape), does NOT throw', async () => {
      const result = await resolver.resolveForDelete(
        null as unknown as string,
        ctx
      );
      expect(result.kind).toBe('rejected');
    });
  });

  describe('confinement rejections propagate as rejected.<reason>', () => {
    it('traversal -> rejected with traversal reason', async () => {
      const result = await resolver.resolveForDelete(
        '/2025/06/15/../../../etc/passwd',
        ctx
      );
      expect(result.kind).toBe('rejected');
      if (result.kind === 'rejected') expect(result.reason).toBe('traversal');
    });

    it('realpath_failed -> rejected with realpath_failed reason', async () => {
      const result = await resolver.resolveForDelete(
        '/2025/06/15/nope.png',
        ctx
      );
      expect(result.kind).toBe('rejected');
      if (result.kind === 'rejected')
        expect(result.reason).toBe('realpath_failed');
    });
  });

  describe('UPLOAD_DIRECTORY guard (defense-in-depth)', () => {
    it('returns rejected when UPLOAD_DIRECTORY is unset', async () => {
      const saved = process.env.UPLOAD_DIRECTORY;
      delete process.env.UPLOAD_DIRECTORY;
      try {
        const localResolver = new MediaPathResolver();
        const result = await localResolver.resolveForDelete(
          '/2025/06/15/hit.png',
          ctx
        );
        expect(result.kind).toBe('rejected');
        if (result.kind === 'rejected')
          expect(result.reason).toBe('realpath_failed');
      } finally {
        process.env.UPLOAD_DIRECTORY = saved;
      }
    });
  });

  describe('no-throw contract', () => {
    it('never throws even on filesystem error for a malformed path', async () => {
      await expect(
        resolver.resolveForDelete('/2025/06/15/\x00null', ctx)
      ).resolves.toBeDefined();
    });

    it('never throws for non-string input', async () => {
      await expect(
        resolver.resolveForDelete(undefined as unknown as string, ctx)
      ).resolves.toBeDefined();
    });
  });
});
