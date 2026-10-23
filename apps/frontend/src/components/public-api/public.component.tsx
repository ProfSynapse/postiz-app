'use client';

import { useState, useCallback, useRef } from 'react';
import { useUser } from '../layout/user.context';
import { Button } from '@gitroom/react/form/button';
import copy from 'copy-to-clipboard';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useDecisionModal } from '@gitroom/frontend/components/layout/new-modal';
import { useSWRConfig } from 'swr';
export const PublicComponent = () => {
  const user = useUser();
  const { backendUrl } = useVariables();
  const toaster = useToaster();
  const fetch = useFetch();
  const decision = useDecisionModal();
  const { mutate } = useSWRConfig();
  const regenerationInFlight = useRef(false);
  const [regenerating, setRegenerating] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [reveal2, setReveal2] = useState(false);
  const copyToClipboard = useCallback(() => {
    toaster.show('API Key copied to clipboard', 'success');
    copy(user?.publicApi!);
  }, [user]);
  const copyToClipboard2 = useCallback(() => {
    toaster.show('MCP copied to clipboard', 'success');
    copy(`${backendUrl}/mcp/` + user?.publicApi);
  }, [user]);

  const t = useT();

  const regenerate = useCallback(async () => {
    if (regenerationInFlight.current || refreshRequired) return;
    regenerationInFlight.current = true;
    setRegenerating(true);
    try {
      const confirmed = await decision.open({
        title: t('regenerate_api_key', 'Regenerate API key?'),
        description: t('regenerate_api_key_warning', 'This immediately invalidates the current API key and MCP URL. Update every connected tool, including your CMS, automations and publishing scripts, with the replacement.'),
        approveLabel: t('regenerate_key', 'Regenerate key'),
        cancelLabel: t('cancel', 'Cancel'),
      });
      if (!confirmed) return;
      const response = await fetch('/settings/api-key/regenerate', {
        method: 'POST',
        body: JSON.stringify({ confirm: true }),
      });
      if (!response.ok) throw new Error('Regeneration not confirmed');
      const { apiKey } = await response.json();
      if (typeof apiKey !== 'string' || !/^[a-f0-9]{64}$/.test(apiKey)) {
        throw new Error('Regeneration not confirmed');
      }
      await mutate('/user/self', (current: typeof user) =>
        current?.orgId === user?.orgId ? { ...current, publicApi: apiKey } : current,
        { revalidate: false }
      );
      setReveal(false);
      setReveal2(false);
      toaster.show(t('api_key_regenerated', 'Key regenerated. Copy it into your API and MCP clients.'), 'success');
    } catch {
      // The server may have committed before the response was lost. Never retry
      // automatically or keep copying the now potentially invalid cached key.
      setRefreshRequired(true);
      toaster.show(t('api_key_regeneration_failed', 'Could not confirm regeneration. Refresh this page before trying again.'), 'warning');
    } finally {
      regenerationInFlight.current = false;
      setRegenerating(false);
    }
  }, [decision, fetch, mutate, refreshRequired, t, toaster, user]);

  if (!user || !user.publicApi) {
    return null;
  }
  return (
    <div className="flex flex-col">
      <h3 className="text-[20px]">{t('public_api', 'Public API')}</h3>
      <div className="text-customColor18 mt-[4px]">
        {t(
          'use_postiz_api_to_integrate_with_your_tools',
          'Use Postiz API to integrate with your tools.'
        )}
        <br />
        <a
          className="underline hover:font-bold hover:underline"
          href="https://docs.postiz.com/public-api"
          target="_blank"
        >
          {t(
            'read_how_to_use_it_over_the_documentation',
            'Read how to use it over the documentation.'
          )}
        </a>
        <a
          className="underline hover:font-bold hover:underline"
          href="https://www.npmjs.com/package/n8n-nodes-postiz"
          target="_blank"
        ><br />
          {t(
            'check_n8n',
            'Check out our N8N custom node for Postiz.'
          )}
        </a>
      </div>
      <div className="my-[16px] mt-[16px] bg-sixth border-fifth items-center border rounded-[4px] p-[24px] flex gap-[24px]">
        <div className="flex items-center">
          {refreshRequired ? t('api_key_refresh_required_short', 'Refresh to load the current key') : reveal ? (
            user.publicApi
          ) : (
            <>
              <div className="blur-sm">{user.publicApi.slice(0, -5)}</div>
              <div>{user.publicApi.slice(-5)}</div>
            </>
          )}
        </div>
        <div>
          {!reveal ? (
            <Button onClick={() => setReveal(true)} disabled={regenerating || refreshRequired}>
              {t('reveal', 'Reveal')}
            </Button>
          ) : (
            <Button onClick={copyToClipboard} disabled={regenerating || refreshRequired}>
              {t('copy_key', 'Copy Key')}
            </Button>
          )}
        </div>
      </div>

      {(user.role === 'ADMIN' || user.role === 'SUPERADMIN') && (
        <div className="mb-[24px] flex flex-col items-start gap-[8px]">
          <Button secondary onClick={regenerate} loading={regenerating} disabled={regenerating || refreshRequired}>
            {t('regenerate_key', 'Regenerate key')}
          </Button>
          <p className="text-customColor18" role={refreshRequired ? 'alert' : undefined}>
            {refreshRequired
              ? t('api_key_refresh_required', 'Refresh this page to load the current key before making another change.')
              : t('api_key_regeneration_hint', 'Regenerating replaces the key for both the Public API and MCP.')}
          </p>
        </div>
      )}

      <h3 className="text-[20px]">{t('mcp', 'MCP')}</h3>
      <div className="text-customColor18 mt-[4px]">
        {t(
          'connect_your_mcp_client_to_postiz_to_schedule_your_posts_faster',
          'Connect Postiz MCP server to your client (Http streaming) to schedule your posts faster.'
        )}
      </div>
      <div className="my-[16px] mt-[16px] bg-sixth border-fifth items-center border rounded-[4px] p-[24px] flex gap-[24px]">
        <div className="flex items-center">
          {refreshRequired ? t('api_key_refresh_required_short', 'Refresh to load the current key') : reveal2 ? (
            `${backendUrl}/mcp/` + user.publicApi
          ) : (
            <>
              <div className="blur-sm">
                {(`${backendUrl}/mcp/` + user.publicApi).slice(0, -5)}
              </div>
              <div>
                {(`${backendUrl}/mcp/` + user.publicApi).slice(-5)}
              </div>
            </>
          )}
        </div>
        <div>
          {!reveal2 ? (
            <Button onClick={() => setReveal2(true)} disabled={regenerating || refreshRequired}>
              {t('reveal', 'Reveal')}
            </Button>
          ) : (
            <Button onClick={copyToClipboard2} disabled={regenerating || refreshRequired}>
              {t('copy_key', 'Copy Key')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
