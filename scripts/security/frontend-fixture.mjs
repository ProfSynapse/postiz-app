// Test-only backend and same-origin proxy. All unknown mutations fail closed.
// Run in the --internal Docker network; no production credentials or .env.
import { createServer, request } from 'node:http';
import { spawn } from 'node:child_process';
import { writeFile, mkdir, symlink } from 'node:fs/promises';
if (process.env.POSTIZ_ISOLATED_FIXTURE !== '1') throw new Error('Explicit fixture opt-in required');
const origin = process.env.POSTIZ_FIXTURE_ORIGIN || 'http://127.0.0.1:43120';
await mkdir('/tmp/postiz-fixture-uploads', { recursive: true });
await writeFile('/tmp/postiz-fixture-uploads/fixture.txt', 'final-image-upload-fixture');
await writeFile('/tmp/postiz-fixture-outside.txt', 'outside-dummy-fixture');
await symlink('/tmp/postiz-fixture-outside.txt', '/tmp/postiz-fixture-uploads/escape.txt').catch(error => { if (error.code !== 'EEXIST') throw error; });
const receipts = [];
const user = { id: 'fixture-user', email: 'fixture@example.invalid', name: 'Fixture User', role: 'ADMIN', orgId: 'fixture-org', tier: 'FREE', timezone: 0, activated: true, allowTrial: false, isTrailing: false, admin: false, picture: null };
const send = (res, body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const backend = createServer(async (req, res) => {
  const url = new URL(req.url, origin);
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > 102400) return send(res, {}, 413); }
  let body = {}; try { body = JSON.parse(raw || '{}'); } catch {}
  receipts.push({ method: req.method, path: url.pathname, authMatched: req.headers.auth === 'fixture-auth', organizationMatched: req.headers.showorg === 'fixture-org', oauthStateMatched: body.state === 'fixture-state', oauthCodeMatched: body.code === 'fixture-code', oauthRefreshMatched: body.refresh === 'true', resetTokenMatched: body.token === 'fixture-reset-token' });
  await writeFile('/receipts/frontend-requests.json', JSON.stringify(receipts, null, 2));
  if (url.pathname === '/auth/can-register') return send(res, { register: false });
  if (url.pathname === '/user/self') return send(res, user);
  if (url.pathname === '/user/organizations') return send(res, [{ id: 'fixture-org', name: 'Disposable fixture', role: 'ADMIN' }]);
  if (url.pathname === '/public/posts/fixture-post') return send(res, [{ id: 'fixture-post', content: 'Offline preview fixture', publishDate: '2026-10-25T12:30:00.000Z', image: '[]', integration: { name: 'Fixture account', profile: 'fixture', providerIdentifier: 'linkedin', picture: '/postiz.svg' } }]);
  if (url.pathname.endsWith('/comments')) return send(res, { comments: [], users: [] });
  if (url.pathname === '/posts' && req.method === 'GET') return send(res, { posts: [], comments: [] });
  if (['/sets', '/tags', '/customers'].includes(url.pathname) && req.method === 'GET') return send(res, []);
  if (url.pathname === '/signatures/default' && req.method === 'GET') return send(res, {});
  if (url.pathname === '/auth/forgot-return' && req.method === 'POST') return send(res, { reset: body.token === 'fixture-reset-token' });
  if (url.pathname === '/integrations/list') return send(res, { integrations: [] });
  if (url.pathname === '/copilot/chat' && body.operationName === 'availableAgents') return send(res, { data: { availableAgents: { agents: [] } } });
  if (url.pathname === '/posts/find-slot') return send(res, { date: '2026-10-25T12:30:00.000Z' });
  if (url.pathname === '/notifications' || url.pathname === '/notifications/list') return send(res, { notifications: [], total: 0 });
  if (url.pathname === '/auth/login' && req.method === 'POST') {
    res.setHeader('auth', 'fixture-auth');
    res.setHeader('showorg', 'fixture-org');
    res.setHeader('reload', 'true');
    res.setHeader('set-cookie', 'auth=fixture-auth; Path=/; SameSite=Lax');
    return send(res, { id: user.id });
  }
  if (/^\/integrations\/social\/[^/]+\/connect$/.test(url.pathname) && req.method === 'POST') return send(res, { msg: 'Offline callback accepted by fixture; provider blocked' }, 409);
  if (req.method !== 'GET') return send(res, { error: 'Fixture blocks sends, reset delivery, registration and publishing' }, 403);
  return send(res, {});
});
await new Promise(r => backend.listen(4301, '127.0.0.1', r));
const child = spawn(process.execPath, ['../../node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '4200'], {
  cwd: '/app/apps/frontend', stdio: 'inherit', env: { ...process.env, BACKEND_INTERNAL_URL: 'http://127.0.0.1:4301', NEXT_PUBLIC_BACKEND_URL: origin + '/fixture-api', FRONTEND_URL: origin, IS_GENERAL: 'true', DISABLE_REGISTRATION: 'true', NOT_SECURED: 'true', STORAGE_PROVIDER: process.env.POSTIZ_FIXTURE_STORAGE_PROVIDER || 'local', UPLOAD_DIRECTORY: '/tmp/postiz-fixture-uploads', NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_SENTRY_DSN: '', NEXT_PUBLIC_POSTHOG_KEY: '', NEXT_PUBLIC_POSTHOG_HOST: '', SENTRY_AUTH_TOKEN: '' },
});
const proxy = createServer((req, res) => {
  const fixture = req.url.startsWith('/fixture-api/');
  const upstream = request({ host: '127.0.0.1', port: fixture ? 4301 : 4200, path: fixture ? req.url.replace('/fixture-api', '') : req.url, method: req.method, headers: req.headers }, response => {
    const headers = { ...response.headers, 'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; frame-src 'none'" };
    res.writeHead(response.statusCode, headers); response.pipe(res);
  });
  upstream.on('error', () => send(res, { error: 'Frontend starting' }, 503));
  req.pipe(upstream);
});
await new Promise(r => proxy.listen(4300, '0.0.0.0', r));
const stop = () => { child.kill('SIGTERM'); backend.close(); proxy.close(); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('exit', code => { backend.close(); proxy.close(); process.exitCode = code || 0; });
