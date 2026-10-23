// Start the boot watchdog before anything heavy loads (see boot.watchdog.ts).
// The backend stalls during module loading like workers and cron; when it
// does, nginx answers 502 and the deploy healthcheck fails. The timeouts in
// start() cannot help then: they run on the blocked event loop. The deadline
// leaves room for the 30-60s cold boot and a restart within Railway's 5
// minute healthcheck window.
import { startBootWatchdog } from '@gitroom/nestjs-libraries/boot/boot.watchdog';
const boot = startBootWatchdog('backend', 150_000);

import { initializeSentry } from '@gitroom/nestjs-libraries/sentry/initialize.sentry';
initializeSentry('backend', true);

import { loadSwagger } from '@gitroom/helpers/swagger/load.swagger';
import { json, Router } from 'express';
import { mountMcpRouter } from '../../../libraries/nestjs-libraries/src/chat/mcp.router';

process.env.TZ = 'UTC';

import cookieParser from 'cookie-parser';
import { Logger, ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { SubscriptionExceptionFilter } from '@gitroom/backend/services/auth/permissions/subscription.exception';
import { HttpExceptionFilter } from '@gitroom/nestjs-libraries/services/exception.filter';
import { ConfigurationChecker } from '@gitroom/helpers/configuration/configuration.checker';

boot.mark('modules loaded');

const MCP_STARTUP_TIMEOUT_MS = 30_000;
const BACKEND_STARTUP_TIMEOUT_MS = 180_000;

async function withStartupTimeout<T>(
  name: string,
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`${name} timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

async function start() {
  Logger.log('Backend bootstrap starting', 'Bootstrap');
  Logger.log('Loading backend AppModule', 'Bootstrap');
  const { AppModule } = await withStartupTimeout(
    'Backend AppModule import',
    import('./app.module'),
    BACKEND_STARTUP_TIMEOUT_MS
  );

  Logger.log('Creating Nest backend application', 'Bootstrap');
  const app = await withStartupTimeout(
    'Nest backend application creation',
    NestFactory.create(AppModule, {
      rawBody: true,
      cors: {
        ...(!process.env.NOT_SECURED ? { credentials: true } : {}),
        allowedHeaders: [
          'Content-Type',
          'Authorization',
          'x-copilotkit-runtime-client-gql-version',
        ],
        exposedHeaders: [
          'reload',
          'onboarding',
          'activate',
          'x-copilotkit-runtime-client-gql-version',
          ...(process.env.NOT_SECURED ? ['auth', 'showorg', 'impersonate'] : []),
        ],
        origin: [
          process.env.FRONTEND_URL,
          'http://localhost:6274',
          ...(process.env.MAIN_URL ? [process.env.MAIN_URL] : []),
        ],
      },
    }),
    BACKEND_STARTUP_TIMEOUT_MS
  );
  boot.mark('nest created');

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
    })
  );

  app.use('/copilot/*', (req: any, res: any, next: any) => {
    json({ limit: '50mb' })(req, res, next);
  });

  app.use(cookieParser());
  app.useGlobalFilters(new SubscriptionExceptionFilter());
  app.useGlobalFilters(new HttpExceptionFilter());

  loadSwagger(app);

  // Mount before Nest installs its final 404 handler. MCP can initialize in
  // the background later without placing its route after that handler.
  // Parse only MCP here so Stripe's raw-body handling remains independent.
  const mcpRouter = mountMcpRouter(app);

  const port = process.env.PORT || 3000;

  Logger.log(`Starting backend HTTP listener on port ${port}`, 'Bootstrap');
  await withStartupTimeout(
    'Backend HTTP listener startup',
    app.listen(port),
    BACKEND_STARTUP_TIMEOUT_MS
  );
  boot.mark('listening');

  checkConfiguration(); // Do this last, so that users will see obvious issues at the end of the startup log without having to scroll up.

  Logger.log(`🚀 Backend is running on: http://localhost:${port}`);
  void startMcpAfterListen(app, mcpRouter);
}

async function startMcpAfterListen(app: INestApplication, router: ReturnType<typeof Router>) {
  // MCP/Mastra startup has previously hung during deployment. Keep it off the
  // critical HTTP readiness path; the copilot routes can still initialize it
  // lazily on request if this background startup times out.
  const mcpPromise = (async () => {
    const { startMcp } = await import(
      '../../../libraries/nestjs-libraries/src/chat/start.mcp'
    );
    await startMcp(app, router);
  })();

  try {
    await withStartupTimeout(
      'MCP startup',
      mcpPromise,
      MCP_STARTUP_TIMEOUT_MS
    );
    Logger.log('MCP endpoint initialized', 'MCP');
  } catch (e) {
    Logger.warn(
      `MCP startup failed or timed out; backend will continue. The /mcp/:id endpoint will be unavailable until initialization succeeds. Reason: ${
        (e as Error)?.message ?? e
      }`,
      'MCP'
    );
    mcpPromise.catch(() => undefined);
  }
}

function checkConfiguration() {
  const checker = new ConfigurationChecker();
  checker.readEnvFromProcess();
  checker.check();

  if (checker.hasIssues()) {
    for (const issue of checker.getIssues()) {
      Logger.warn(issue, 'Configuration issue');
    }

    Logger.warn('Configuration issues found: ' + checker.getIssuesCount());
  } else {
    Logger.log('Configuration check completed without any issues');
  }
}

start().catch((e) => {
  Logger.error('Backend startup failed', e, 'Bootstrap');
  process.exit(1);
});
