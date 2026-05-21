// libraries/nestjs-libraries/src/database/prisma/media/__integration__/setup.ts
//
// Integration-suite scaffolding: a shared PrismaClient pointed at
// TEST_DATABASE_URL, plus a guard that auto-skips the suite when the env-var
// is unset.
//
// This file is INTENTIONALLY not auto-loaded as a Jest globalSetup — each
// spec file calls `getIntegrationContext()` so the skip semantics are visible
// at the describe-block level.
//
// Why a single shared client (not per-test): connection-pool churn at scale
// flakes in CI. The truncation helper between tests gives us isolation
// without paying connect/disconnect overhead per spec.
import { PrismaClient } from '@prisma/client';

type IntegrationContext =
  | { available: true; prisma: PrismaClient }
  | { available: false; reason: string };

let cached: IntegrationContext | null = null;

export function getIntegrationContext(): IntegrationContext {
  if (cached) return cached;

  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    cached = {
      available: false,
      reason:
        'TEST_DATABASE_URL is not set. Set it to a postgres:// URL pointing at a disposable test database to run the media-janitor integration suite. CI provisions one via the postgres:15 service container in .github/workflows/media-janitor-tests.yml.',
    };
    return cached;
  }

  const prisma = new PrismaClient({
    datasources: { db: { url } },
  });

  cached = { available: true, prisma };
  return cached;
}

/**
 * Use at the top of every describe block:
 *
 *   const ctx = getIntegrationContext();
 *   const itIfReady = ctx.available ? it : it.skip;
 *
 * — or pass the result into `describeIfDb`.
 */
export const describeIfDb = (
  title: string,
  body: (prisma: PrismaClient) => void
): void => {
  const ctx = getIntegrationContext();
  if (!ctx.available) {
    describe.skip(`${title} [skipped: ${ctx.reason}]`, () => {
      it('placeholder so the suite has a registered test', () => {
        expect(true).toBe(true);
      });
    });
    return;
  }
  describe(title, () => body(ctx.prisma));
};

/**
 * Tear down the shared client after the suite. Wire into Jest via:
 *
 *   afterAll(async () => { await disconnectIntegrationContext(); });
 *
 * Idempotent.
 */
export async function disconnectIntegrationContext(): Promise<void> {
  const ctx = cached;
  cached = null;
  if (ctx && ctx.available) {
    await ctx.prisma.$disconnect();
  }
}
