import { mkdtemp, writeFile, rm, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

jest.mock('next/headers', () => ({ cookies: jest.fn() }));
import { cookies } from 'next/headers';
import { internalFetch } from '@gitroom/helpers/utils/internal.fetch';
import { GET } from '../../apps/frontend/src/app/(app)/api/uploads/[[...path]]/route';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

describe('Next 15 request APIs and runtime compatibility', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it('forwards auth and organization from asynchronously resolved cookies', async () => {
    process.env.BACKEND_INTERNAL_URL = 'http://backend.invalid';
    (cookies as jest.Mock).mockResolvedValue(new Map([
      ['auth', { value: 'test-auth' }], ['showorg', { value: 'test-org' }],
    ]));
    const response = new Response('{}');
    const fetchMock = jest.fn().mockResolvedValue(response);
    global.fetch = fetchMock;
    expect(await internalFetch('/auth/can-register')).toBe(response);
    expect(cookies).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('http://backend.invalid/auth/can-register', expect.objectContaining({
      cache: 'no-store', credentials: 'include',
      headers: expect.objectContaining({ auth: 'test-auth', showorg: 'test-org' }),
    }));
  });

  it('serves local media after awaiting catch-all route parameters', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'postiz-media-'));
    try {
      process.env.UPLOAD_DIRECTORY = directory;
      process.env.STORAGE_PROVIDER = 'local';
      await writeFile(path.join(directory, 'sample.txt'), 'media fixture');
      const response = await GET({} as any, { params: Promise.resolve({ path: ['sample.txt'] }) });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('media fixture');
      expect(response.headers.get('content-length')).toBe('13');
      expect(response.headers.get('content-type')).toContain('text/plain');
      expect((await GET({} as any, { params: Promise.resolve({}) })).status).toBe(404);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('checks local storage at request time and confines download paths and symlinks', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'postiz-download-'));
    const root = path.join(directory, 'uploads');
    try {
      await mkdir(root);
      await writeFile(path.join(directory, 'outside.txt'), 'outside dummy fixture');
      await symlink(path.join(directory, 'outside.txt'), path.join(root, 'escape.txt'));
      await writeFile(path.join(root, 'inside.txt'), 'inside');
      process.env.UPLOAD_DIRECTORY = root;
      process.env.STORAGE_PROVIDER = 'local';
      for (const segments of [['..', 'outside.txt'], ['escape.txt'], ['missing.txt']]) {
        expect((await GET({} as any, { params: Promise.resolve({ path: segments }) })).status).toBe(404);
      }
      process.env.STORAGE_PROVIDER = 'cloudflare';
      expect((await GET({} as any, { params: Promise.resolve({ path: ['inside.txt'] }) })).status).toBe(404);
      process.env.STORAGE_PROVIDER = 'local';
      const response = await GET({} as any, { params: Promise.resolve({ path: ['inside.txt'] }) });
      expect(await response.text()).toBe('inside');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('bcrypt v6 retains existing $2b$ password hash compatibility', () => {
    // Upstream v5.1.1 test vector (test/sync.test.js, hash_compare_invalid_strings).
    // https://github.com/kelektiv/node.bcrypt.js/blob/v5.1.1/test/sync.test.js
    const legacyHash = '$2a$10$XOPbrlUPQdwdJUpSrIF6X.LbE14qsMmKGhM1A8W9iqaG3vv1BD7WC';
    expect(AuthService.comparePassword('envy1362987212538', legacyHash)).toBe(true);
    expect(AuthService.comparePassword('envy1362987212538', legacyHash.replace('$2a$', '$2b$'))).toBe(true);
    expect(AuthService.comparePassword('wrong password', legacyHash)).toBe(false);
    const hash = AuthService.hashPassword('offline-fixture-password');
    expect(hash).toMatch(/^\$2[ab]\$10\$/);
    expect(AuthService.comparePassword('offline-fixture-password', hash)).toBe(true);
    expect(AuthService.comparePassword('wrong', hash)).toBe(false);
  });
});
