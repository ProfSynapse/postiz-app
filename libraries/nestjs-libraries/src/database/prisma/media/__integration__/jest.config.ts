// libraries/nestjs-libraries/src/database/prisma/media/__integration__/jest.config.ts
//
// Dedicated Jest project for the media-janitor integration suite (plan I.2).
//
// Co-located with the implementation path (not at the literal plan path
// `libraries/nestjs-libraries/src/services/media-janitor/`) because the
// janitor source lives under `database/prisma/media/`. Co-location keeps
// `find . -name '*.integration.spec.ts'` and the per-PR test impact analysis
// honest — the spec sits next to what it covers.
//
// These tests require a real Postgres reachable via TEST_DATABASE_URL.
// `media-janitor.integration.setup.ts` SKIPS the suite when the env-var is
// unset, so the project is safe to leave registered on developer machines
// without a Postgres service.
//
// CI integration: `.github/workflows/media-janitor-tests.yml` provisions a
// postgres:15 service container and sets TEST_DATABASE_URL before invoking
// `npx jest --selectProjects media-janitor-integration`.
export default {
  displayName: 'media-janitor-integration',
  preset: '../../../../../../../jest.preset.js',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/**/*.integration.spec.ts'],
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      { tsconfig: '<rootDir>/../../../../../tsconfig.spec.json' },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  moduleNameMapper: {
    '^@gitroom/backend/(.*)$':
      '<rootDir>/../../../../../../../apps/backend/src/$1',
    '^@gitroom/cron/(.*)$': '<rootDir>/../../../../../../../apps/cron/src/$1',
    '^@gitroom/frontend/(.*)$':
      '<rootDir>/../../../../../../../apps/frontend/src/$1',
    '^@gitroom/helpers/(.*)$':
      '<rootDir>/../../../../../../helpers/src/$1',
    '^@gitroom/nestjs-libraries/(.*)$':
      '<rootDir>/../../../../$1',
    '^@gitroom/plugins/(.*)$':
      '<rootDir>/../../../../../../plugins/src/$1',
  },
  // Per-test transactional rollback isn't quite right for janitor tests
  // because the SUT itself opens transactions; we use truncate-between-tests
  // via the helper in `seed.helpers.ts`.
  testTimeout: 30_000,
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};
