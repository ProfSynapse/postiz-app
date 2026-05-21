// apps/backend/jest.config.ts
// Per-project Jest config for postiz-backend.
//
// Wired in to close BL-1 from PR #7 (Phase 2 BullMQ hardening review):
// health.controller.spec.ts (the 2026-05-21 incident-regression coverage) was
// living in apps/backend/src with no Nx project to host it. Without this file,
// `nx run-many --target=test` would silently skip the spec, defeating the
// regression-prevention contract of the new probe specs.
//
// Discovered by the root jest.config.ts via @nx/jest's getJestProjects(),
// and runnable directly via `npx nx test postiz-backend`.
//
// Note: this is the FIRST app in the repo with Nx jest wiring. The template
// was copied from libraries/nestjs-libraries/jest.config.ts (the only existing
// example of the full triplet: jest.config.ts + project.json + tsconfig.spec.json).
// apps/workers / apps/frontend / apps/cron / apps/extension / apps/commands
// remain unwired — flagged as FUTURE in the BL-1 handoff so they can be
// retrofitted in a follow-up.

export default {
  displayName: 'postiz-backend',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    // isolatedModules:true (in tsconfig.spec.json) avoids cross-file type-checking
    // against pre-existing TS strict-mode violations in helpers. Per-file types
    // are still validated by ts-jest.
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  moduleNameMapper: {
    // Re-rooted from libraries/nestjs-libraries/jest.config.ts. apps/backend is
    // a sibling of libraries/, so the relative paths all share the same `../../`
    // climb to the workspace root.
    '^@gitroom/backend/(.*)$': '<rootDir>/src/$1',
    '^@gitroom/cron/(.*)$': '<rootDir>/../../apps/cron/src/$1',
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
