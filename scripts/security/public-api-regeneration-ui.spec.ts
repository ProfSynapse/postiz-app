/** @jest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { SWRConfig, default as useSWR } from 'swr';
import { UserContext } from '../../apps/frontend/src/components/layout/user.context';

const fetchMock = jest.fn();
const decision = jest.fn();
const show = jest.fn();
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({ useFetch: () => fetchMock }));
jest.mock('@gitroom/frontend/components/layout/new-modal', () => ({ useDecisionModal: () => ({ open: decision }) }));
jest.mock('@gitroom/react/toaster/toaster', () => ({ useToaster: () => ({ show }) }));
jest.mock('@gitroom/react/helpers/variable.context', () => ({ useVariables: () => ({ backendUrl: 'https://frontend.example.invalid/api' }) }));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({ useT: () => (_key: string, fallback: string) => fallback }));
jest.mock('copy-to-clipboard', () => ({ __esModule: true, default: jest.fn() }));
import copy from 'copy-to-clipboard';
import { PublicComponent } from '../../apps/frontend/src/components/public-api/public.component';

const oldKey = 'a'.repeat(64);
const newKey = 'b'.repeat(64);
function mount(role = 'ADMIN') {
  const initialUser = { orgId: 'org-a', publicApi: oldKey, role };
  function Harness() {
    const { data } = useSWR('/user/self', null);
    return React.createElement(UserContext.Provider, { value: data as any }, React.createElement(PublicComponent));
  }
  return render(React.createElement(SWRConfig, { value: { provider: () => new Map([['/user/self', { data: initialUser }]]) } }, React.createElement(Harness)));
}

describe('Public API regeneration control', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    decision.mockResolvedValue(true);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ apiKey: newKey }) });
  });
  afterEach(cleanup);
  it('explains invalidation and Cancel makes no request', async () => {
    decision.mockResolvedValue(false);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate key' }));
    await waitFor(() => expect(decision).toHaveBeenCalled());
    expect(decision.mock.calls[0][0].description).toContain('immediately invalidates');
    expect(decision.mock.calls[0][0].description).toContain('MCP URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('refreshes both the API key and MCP URL from the successful response', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate key' }));
    await waitFor(() => expect(show).toHaveBeenCalledWith(expect.stringContaining('Key regenerated'), 'success'));
    expect(fetchMock).toHaveBeenCalledWith('/settings/api-key/regenerate', { method: 'POST', body: '{"confirm":true}' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getAllByRole('button', { name: 'Reveal' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Copy Key' }));
    expect(copy).toHaveBeenLastCalledWith(newKey);
    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy Key' })[1]);
    expect(copy).toHaveBeenLastCalledWith('https://frontend.example.invalid/api/mcp/' + newKey);
  });
  it('prevents duplicate clicks while confirmation or the request is pending', async () => {
    let resolve: (value: boolean) => void;
    decision.mockReturnValue(new Promise<boolean>((r) => { resolve = r; }));
    mount();
    const button = screen.getByRole('button', { name: 'Regenerate key' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(decision).toHaveBeenCalledTimes(1);
    expect(button.hasAttribute('disabled')).toBe(true);
    await act(async () => { resolve!(true); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
  it.each(['network', 'rejection', 'invalid-response'])('requires a page refresh after uncertain failure: %s', async (failure) => {
    if (failure === 'network') fetchMock.mockRejectedValue(new Error('network'));
    if (failure === 'rejection') fetchMock.mockResolvedValue({ ok: false });
    if (failure === 'invalid-response') fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate key' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Regenerate key' }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByText(oldKey)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith(expect.stringContaining('Refresh this page'), 'warning');
  });
  it('does not offer regeneration to ordinary members', () => {
    mount('USER');
    expect(screen.queryByRole('button', { name: 'Regenerate key' })).toBeNull();
  });
});
