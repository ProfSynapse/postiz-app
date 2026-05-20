// libraries/nestjs-libraries/jest.config.ts
// Per-project Jest config for @gitroom/nestjs-libraries.
// Discovered by the root jest.config.ts via @nx/jest's getJestProjects(),
// and runnable directly via `npx nx test nestjs-libraries`.

export default {
  displayName: 'nestjs-libraries',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  moduleNameMapper: {
    '^@gitroom/backend/(.*)$': '<rootDir>/../../apps/backend/src/$1',
    '^@gitroom/cron/(.*)$': '<rootDir>/../../apps/cron/src/$1',
    '^@gitroom/frontend/(.*)$': '<rootDir>/../../apps/frontend/src/$1',
    '^@gitroom/helpers/(.*)$': '<rootDir>/../helpers/src/$1',
    '^@gitroom/nestjs-libraries/(.*)$': '<rootDir>/src/$1',
    '^@gitroom/react/(.*)$': '<rootDir>/../react-shared-libraries/src/$1',
    '^@gitroom/plugins/(.*)$': '<rootDir>/../plugins/src/$1',
    '^@gitroom/workers/(.*)$': '<rootDir>/../../apps/workers/src/$1',
    '^@gitroom/extension/(.*)$': '<rootDir>/../../apps/extension/src/$1',
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};
