import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.config({
    extends: ['next/core-web-vitals', 'next/typescript'],
    rules: {
      'react/no-unescaped-entities': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'react/display-name': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/prefer-as-const': 'off',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'off',
    },
  }),
  // Media-janitor clock invariant (architect-locked invariant #2):
  // NO `new Date()` / `Date.now()` may appear in janitor source files.
  // ClockService is the sole exempt site. Violation = MERGE BLOCK.
  // See: docs/architecture/media-janitor.md §6
  {
    files: [
      'apps/cron/src/tasks/media.janitor.ts',
      'libraries/nestjs-libraries/src/database/prisma/media/media.janitor.service.ts',
      'libraries/nestjs-libraries/src/database/prisma/media/media.janitor.repository.ts',
      'libraries/nestjs-libraries/src/upload/media.path.resolver.ts',
      'libraries/nestjs-libraries/src/upload/path.confinement.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message:
            'Use ClockService.now() in media-janitor code. Direct `new Date()` is banned by invariant #2.',
        },
        {
          selector:
            "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message:
            'Use ClockService.nowMs() in media-janitor code. Direct `Date.now()` is banned by invariant #2.',
        },
      ],
    },
  },
];

export default eslintConfig;
