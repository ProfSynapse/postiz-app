import { NextRequest } from 'next/server';
import { middleware } from '../../apps/frontend/src/middleware';
jest.mock('@gitroom/helpers/utils/internal.fetch', () => ({ internalFetch: jest.fn() }));

describe('public frontend redirects behind an internal Next listener', () => {
  const before = process.env.FRONTEND_URL;
  beforeEach(() => { process.env.FRONTEND_URL = 'https://frontend.example.invalid:8443'; });
  afterAll(() => { if (before === undefined) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = before; });
  it('redirects a signed-in login request to the public origin', async () => {
    const response = await middleware(new NextRequest('http://localhost:4200/auth/login', { headers: { cookie: 'auth=fixture' } }));
    expect(response.headers.get('location')).toBe('https://frontend.example.invalid:8443/');
  });
  it('preserves protected modal routing without trusting Host', async () => {
    const response = await middleware(new NextRequest('http://localhost:4200/modal/dark/all', { headers: { host: 'untrusted.invalid' } }));
    expect(response.headers.get('location')).toBe('https://frontend.example.invalid:8443/auth/login-required');
  });
  it('does not treat an auth string inside the query as an auth route', async () => {
    const response = await middleware(new NextRequest('http://localhost:4200/private?return=/auth'));
    expect(response.headers.get('location')).toBe('https://frontend.example.invalid:8443/auth?return=/auth');
  });
});
