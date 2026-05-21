// apps/cron/jest.config.ts
//
// Per-project Jest config for @gitroom/cron (the pm2-managed Nest cron app).
// Discovered by the root jest.config.ts via @nx/jest's getJestProjects().
//
// Mirrors libraries/nestjs-libraries/jest.config.ts so module-name mapping is
// consistent across the monorepo. Added in support of the media-janitor TEST
// phase (plan §Test Engineer I.1).
export default {
  displayName: 'cron',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  moduleNameMapper: {
    '^@gitroom/backend/(.*)$': '<rootDir>/../../apps/backend/src/$1',
    '^@gitroom/cron/(.*)$': '<rootDir>/src/$1',
    '^@gitroom/frontend/(.*)$': '<rootDir>/../../apps/frontend/src/$1',
    '^@gitroom/helpers/(.*)$': '<rootDir>/../../libraries/helpers/src/$1',
    '^@gitroom/nestjs-libraries/(.*)$':
      '<rootDir>/../../libraries/nestjs-libraries/src/$1',
    '^@gitroom/react/(.*)$':
      '<rootDir>/../../libraries/react-shared-libraries/src/$1',
    '^@gitroom/plugins/(.*)$': '<rootDir>/../../libraries/plugins/src/$1',
    '^@gitroom/workers/(.*)$': '<rootDir>/../../apps/workers/src/$1',
    '^@gitroom/extension/(.*)$': '<rootDir>/../../apps/extension/src/$1',
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};
