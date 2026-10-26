import 'reflect-metadata';
import { INestApplication, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { PrismaClient, Role } from '@prisma/client';

jest.mock('@gitroom/nestjs-libraries/database/prisma/stars/stars.service', () => ({ StarsService: class StarsService {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class OrganizationService {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({ UsersService: class UsersService {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/prisma.service', () => ({ PrismaRepository: class PrismaRepository {} }));

import { SettingsController } from '../../apps/backend/src/api/routes/settings.controller';
import { AuthMiddleware } from '../../apps/backend/src/services/auth/auth.middleware';
import { PublicAuthMiddleware } from '../../apps/backend/src/services/auth/public.auth.middleware';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { StarsService } from '@gitroom/nestjs-libraries/database/prisma/stars/stars.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { HttpExceptionFilter } from '@gitroom/nestjs-libraries/services/exception.filter';

describe('organization API key regeneration over authenticated HTTP', () => {
  let app: INestApplication;
  let base: string;
  let role = 'ADMIN';
  let disabled = false;
  let actor = 'user-a';
  const origin = 'https://frontend.example.invalid';
  const previousEnv = { ...process.env };
  const databaseUrl = process.env.POSTIZ_MEMBERSHIP_TEST_DATABASE_URL;
  if (databaseUrl) {
    const url = new URL(databaseUrl);
    if (url.hostname !== 'postiz-membership-fixture-db' || url.pathname !== '/postiz_membership_fixture') {
      throw new Error('Membership integration tests require the disposable fixture database.');
    }
  }
  const database = databaseUrl ? new PrismaClient({ datasources: { db: { url: databaseUrl } } }) : undefined;
  // Apply the actual repository's select projection rather than inventing the
  // full membership shape at the service boundary. This catches missing fields
  // required by AuthMiddleware and the regeneration permission check.
  const model = database || {
    organization: {
      findMany: async ({ where, include }: any) => where.users.some.userId !== 'user-a' ? [] : [{
        id: 'org-a', apiKey: 'a'.repeat(64),
        users: [Object.fromEntries(Object.entries({ userId: 'user-a', role, disabled })
          .filter(([field]) => include.users.select[field]))],
      }],
    },
  };
  const repository = new OrganizationRepository({ model } as any, {} as any, {} as any);
  const regenerateApiKey = jest.fn(async (id: string, previousKey: string) => database
    ? repository.regenerateApiKey(id, previousKey)
    : { apiKey: 'b'.repeat(64) });
  const orgService = {
    getOrgsByUserId: (id: string) => repository.getOrgsByUserId(id),
    regenerateApiKey,
  };

  beforeAll(async () => {
    process.env.FRONTEND_URL = origin;
    process.env.JWT_SECRET = 'offline-session-fixture-secret';
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    if (database) {
      await database.organization.create({ data: {
        id: 'org-a', name: 'Disposable membership test', apiKey: 'a'.repeat(64),
        users: { create: { id: 'membership-a', role: 'ADMIN', user: { create: {
          id: 'user-a', email: 'fixture@example.invalid', providerName: 'LOCAL', timezone: 0,
        } } } },
      } });
      await database.organization.create({ data: { id: 'org-b', name: 'Other fixture', apiKey: 'c'.repeat(64) } });
    }
    @Module({
      controllers: [SettingsController],
      providers: [
        AuthMiddleware,
        { provide: OrganizationService, useValue: orgService },
        { provide: StarsService, useValue: {} },
        { provide: UsersService, useValue: {} },
      ],
    })
    class FixtureModule implements NestModule {
      configure(consumer: MiddlewareConsumer) { consumer.apply(AuthMiddleware).forRoutes(SettingsController); }
    }
    const module = await Test.createTestingModule({ imports: [FixtureModule] }).compile();
    app = module.createNestApplication({ logger: false });
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });
  afterAll(async () => { await app?.close(); await database?.$disconnect(); process.env = previousEnv; });
  beforeEach(async () => {
    role = 'ADMIN'; disabled = false; actor = 'user-a'; regenerateApiKey.mockClear();
    if (database) {
      await database.organization.update({ where: { id: 'org-a' }, data: { apiKey: 'a'.repeat(64) } });
      await database.userOrganization.update({ where: { id: 'membership-a' }, data: { role: 'ADMIN', disabled: false } });
    }
  });

  async function request({ authenticated = true, requestOrigin = origin as string | undefined, body = { confirm: true } as unknown } = {}) {
    if (database) await database.userOrganization.update({ where: { id: 'membership-a' }, data: { role: role as Role, disabled } });
    return fetch(base + '/settings/api-key/regenerate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(requestOrigin ? { origin: requestOrigin } : {}),
        ...(authenticated ? { auth: AuthService.signJWT({ id: actor, activated: true }) } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  it.each(['ADMIN', 'SUPERADMIN'])('allows a current %s member and returns only an uncached key', async (allowedRole) => {
    role = allowedRole;
    const response = await request({ body: { confirm: true, orgId: 'foreign-org' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const result = await response.json();
    expect(result).toEqual({ apiKey: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(regenerateApiKey).toHaveBeenCalledWith('org-a', 'a'.repeat(64));
    expect(regenerateApiKey).toHaveBeenCalledTimes(1);
    if (database) {
      expect(await repository.getOrgByApiKey('a'.repeat(64))).toBeNull();
      expect((await repository.getOrgByApiKey(result.apiKey))?.id).toBe('org-a');
      expect((await repository.getOrgByApiKey('c'.repeat(64)))?.id).toBe('org-b');
    }
  });
  it('rejects unauthenticated requests without changing a key', async () => {
    expect((await request({ authenticated: false })).status).toBe(401);
    expect(regenerateApiKey).not.toHaveBeenCalled();
  });
  it('does not let the public API key authenticate a regeneration request', async () => {
    const response = await fetch(base + '/settings/api-key/regenerate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, authorization: 'a'.repeat(64) },
      body: JSON.stringify({ confirm: true }),
    });
    expect(response.status).toBe(401);
    expect(regenerateApiKey).not.toHaveBeenCalled();
  });
  it('rejects ordinary members when billing is disabled', async () => {
    role = 'USER';
    expect((await request()).status).toBe(403);
    expect(regenerateApiKey).not.toHaveBeenCalled();
  });
  it('rejects a membership belonging to another user', async () => {
    actor = 'foreign-user';
    expect((await request()).status).toBe(401);
    expect(regenerateApiKey).not.toHaveBeenCalled();
  });
  it('rejects disabled members', async () => {
    disabled = true;
    expect((await request()).status).toBe(401);
    expect(regenerateApiKey).not.toHaveBeenCalled();
  });
  it.each(['https://attacker.invalid', 'null', '', origin + '.attacker.invalid'])('rejects untrusted or missing Origin %s', async (requestOrigin) => {
    expect((await request({ requestOrigin })).status).toBe(403);
    expect(regenerateApiKey).not.toHaveBeenCalled();
  });
  it.each([{}, { confirm: false }, { confirm: 'true' }])('requires literal confirmation %p', async (body) => {
    expect((await request({ body })).status).toBe(400);
    expect(regenerateApiKey).not.toHaveBeenCalled();
  });
});

describe('organization-scoped replacement and existing key authentication', () => {
  const oldKey = 'a'.repeat(64);
  const otherKey = 'c'.repeat(64);
  let records: { id: string; apiKey: string | null }[];
  let model: any;
  let repository: OrganizationRepository;
  beforeEach(() => {
    records = [{ id: 'org-a', apiKey: oldKey }, { id: 'org-b', apiKey: otherKey }];
    model = {
      updateMany: jest.fn(async ({ where, data }) => {
        const record = records.find((r) => r.id === where.id && r.apiKey === where.apiKey);
        if (!record) return { count: 0 };
        Object.assign(record, data);
        return { count: 1 };
      }),
      findFirst: jest.fn(async ({ where }) => records.find((r) => r.apiKey === where.apiKey) || null),
    };
    repository = new OrganizationRepository({ model: { organization: model } } as any, {} as any, {} as any);
  });
  it('generates distinct 256-bit keys, scopes the write, and invalidates the old API/MCP lookup', async () => {
    const first = await repository.regenerateApiKey('org-a', oldKey);
    expect(first.apiKey).toMatch(/^[a-f0-9]{64}$/);
    expect(model.updateMany).toHaveBeenCalledWith({ where: { id: 'org-a', apiKey: oldKey }, data: { apiKey: first.apiKey } });
    expect(await repository.getOrgByApiKey(oldKey)).toBeNull();
    expect((await repository.getOrgByApiKey(first.apiKey))?.id).toBe('org-a');
    expect((await repository.getOrgByApiKey(otherKey))?.id).toBe('org-b');
    const second = await repository.regenerateApiKey('org-a', first.apiKey);
    expect(second.apiKey).not.toBe(first.apiKey);
    expect(await repository.getOrgByApiKey(first.apiKey)).toBeNull();
  });
  it('rejects stale or foreign organization keys without changing any record', async () => {
    await expect(repository.regenerateApiKey('org-a', otherKey)).rejects.toThrow('The API key changed');
    await expect(repository.regenerateApiKey('missing', oldKey)).rejects.toThrow('The API key changed');
    expect(records).toEqual([{ id: 'org-a', apiKey: oldKey }, { id: 'org-b', apiKey: otherKey }]);
  });
  it('immediately rejects the old key in the public API middleware', async () => {
    const { apiKey } = await repository.regenerateApiKey('org-a', oldKey);
    const middleware = new PublicAuthMiddleware({ getOrgByApiKey: (key: string) => repository.getOrgByApiKey(key) } as any);
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() } as any;
    const next = jest.fn();
    await middleware.use({ headers: { authorization: oldKey } } as any, response, next);
    expect(response.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    await middleware.use({ headers: { authorization: apiKey } } as any, response, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
