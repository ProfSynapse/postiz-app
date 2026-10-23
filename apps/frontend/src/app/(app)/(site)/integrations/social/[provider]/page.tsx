import { ContinueIntegration } from '@gitroom/frontend/components/launches/continue.integration';
export const dynamic = 'force-dynamic';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{
    provider: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { provider } = await params;
  const query = await searchParams;
  return <ContinueIntegration searchParams={query} provider={provider} />;
}
