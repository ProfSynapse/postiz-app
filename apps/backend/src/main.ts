import { initializeSentry } from '@gitroom/nestjs-libraries/sentry/initialize.sentry';
initializeSentry('backend', true);

import { loadSwagger } from '@gitroom/helpers/swagger/load.swagger';
import { json } from 'express';

process.env.TZ = 'UTC';

import cookieParser from 'cookie-parser';
import { Logger, ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { SubscriptionExceptionFilter } from '@gitroom/backend/services/auth/permissions/subscription.exception';
import { HttpExceptionFilter } from '@gitroom/nestjs-libraries/services/exception.filter';
import { ConfigurationChecker } from '@gitroom/helpers/configuration/configuration.checker';

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

  const port = process.env.PORT || 3000;

  Logger.log(`Starting backend HTTP listener on port ${port}`, 'Bootstrap');
  await withStartupTimeout(
    'Backend HTTP listener startup',
    app.listen(port),
    BACKEND_STARTUP_TIMEOUT_MS
  );

  checkConfiguration(); // Do this last, so that users will see obvious issues at the end of the startup log without having to scroll up.

  Logger.log(`🚀 Backend is running on: http://localhost:${port}`);
  void startMcpAfterListen(app);
}

async function startMcpAfterListen(app: INestApplication) {
  // MCP/Mastra startup has previously hung during deployment. Keep it off the
  // critical HTTP readiness path; the copilot routes can still initialize it
  // lazily on request if this background startup times out.
  const mcpPromise = (async () => {
    const { startMcp } = await import(
      '@gitroom/nestjs-libraries/chat/start.mcp'
    );
    await startMcp(app);
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
