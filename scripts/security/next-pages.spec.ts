jest.mock('@gitroom/frontend/components/launches/continue.integration', () => ({ ContinueIntegration: () => null }));
jest.mock('@gitroom/frontend/components/auth/forgot-return', () => ({ ForgotReturn: () => null }));
jest.mock('@gitroom/frontend/components/auth/register', () => ({ Register: () => null }));
jest.mock('@gitroom/frontend/components/auth/login.with.oidc', () => ({ LoginWithOidc: () => null }));
jest.mock('@gitroom/helpers/utils/is.general.server.side', () => ({ isGeneralServerSide: () => true }));
jest.mock('@gitroom/react/translation/get.translation.service.backend', () => ({ getT: async () => (_key: string, text: string) => text }));
jest.mock('@gitroom/helpers/utils/internal.fetch', () => ({ internalFetch: jest.fn() }));

import IntegrationPage from '../../apps/frontend/src/app/(app)/(site)/integrations/social/[provider]/page';
import ForgotPage from '../../apps/frontend/src/app/(app)/auth/forgot/[token]/page';
import RegisterPage from '../../apps/frontend/src/app/(app)/auth/page';
import { Register } from '@gitroom/frontend/components/auth/register';
import { internalFetch } from '@gitroom/helpers/utils/internal.fetch';

it('preserves OAuth callback state and code after awaiting provider and search params', async () => {
  const query = { state: 'offline-state', code: 'offline-code', refresh: 'true' };
  const page = await IntegrationPage({ params: Promise.resolve({ provider: 'linkedin' }), searchParams: Promise.resolve(query) });
  expect(page.props).toEqual({ provider: 'linkedin', searchParams: query });
});

it('passes the asynchronously resolved password-reset token to the client', async () => {
  const page = await ForgotPage({ params: Promise.resolve({ token: 'offline-token' }) });
  expect(page.props.token).toBe('offline-token');
});

it('preserves registration-disabled behavior and the provider callback exception', async () => {
  const previous = process.env.DISABLE_REGISTRATION;
  process.env.DISABLE_REGISTRATION = 'true';
  (internalFetch as jest.Mock).mockImplementation(async () => new Response(JSON.stringify({ register: false })));
  try {
    const blocked = await RegisterPage({ searchParams: Promise.resolve({}) });
    expect(blocked.type).not.toBe(Register);
    const callback = await RegisterPage({ searchParams: Promise.resolve({ provider: 'github' }) });
    expect(callback.type).toBe(Register);
  } finally {
    if (previous === undefined) delete process.env.DISABLE_REGISTRATION;
    else process.env.DISABLE_REGISTRATION = previous;
  }
});
