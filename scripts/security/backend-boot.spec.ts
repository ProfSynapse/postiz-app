import 'reflect-metadata';

jest.mock('@gitroom/nestjs-libraries/boot/boot.watchdog', () => ({
  startBootWatchdog: jest.fn(() => ({ mark: jest.fn() })),
}));
jest.mock('@gitroom/nestjs-libraries/sentry/initialize.sentry', () => ({ initializeSentry: jest.fn() }));
jest.mock('@gitroom/helpers/swagger/load.swagger', () => ({ loadSwagger: jest.fn() }));
jest.mock('../../apps/backend/src/app.module', () => ({ AppModule: class AppModule {} }));
jest.mock('@gitroom/backend/services/auth/permissions/subscription.exception', () => ({ SubscriptionExceptionFilter: class {} }));
jest.mock('@gitroom/nestjs-libraries/services/exception.filter', () => ({ HttpExceptionFilter: class {} }));
jest.mock('@gitroom/helpers/configuration/configuration.checker', () => ({
  ConfigurationChecker: class {
    readEnvFromProcess() {} check() {} hasIssues() { return false; }
  },
}));
jest.mock('@gitroom/nestjs-libraries/chat/start.mcp', () => ({ startMcp: jest.fn() }));
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { startMcp } from '@gitroom/nestjs-libraries/chat/start.mcp';

it('boots the backend HTTP listener before starting MCP, with external providers mocked', async () => {
  const calls: string[] = [];
  const app = {
    useGlobalPipes: jest.fn(), use: jest.fn(), useGlobalFilters: jest.fn(),
    listen: jest.fn(async () => { calls.push('listen'); }),
  };
  const create = jest.spyOn(NestFactory, 'create').mockResolvedValue(app as any);
  const log = jest.spyOn(Logger, 'log').mockImplementation(() => {});
  (startMcp as jest.Mock).mockImplementation(async () => { calls.push('mcp'); });
  try {
    await import('../../apps/backend/src/main');
    for (let i = 0; i < 8 && calls.length < 2; i++) await new Promise(setImmediate);
    expect(create).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ rawBody: true }));
    expect(app.useGlobalPipes).toHaveBeenCalledTimes(1);
    expect(app.useGlobalFilters).toHaveBeenCalledTimes(2);
    expect(calls).toEqual(['listen', 'mcp']);
    expect(startMcp).toHaveBeenCalledWith(app);
  } finally { create.mockRestore(); log.mockRestore(); }
});
