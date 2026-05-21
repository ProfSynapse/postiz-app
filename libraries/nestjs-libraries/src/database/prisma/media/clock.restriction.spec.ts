// libraries/nestjs-libraries/src/database/prisma/media/clock.restriction.spec.ts
//
// Belt-and-braces enforcement of invariant #2 (architect §6, plan §Clock
// contract). ESLint `no-restricted-syntax` rules in eslint.config.mjs ban
// `new Date()` and `Date.now()` in the 5 janitor source files; this spec is
// the runtime grep that fires even when ESLint is skipped (e.g., a stale
// pre-commit hook). ClockService is the SOLE exempt site.
//
// Reading from a fixed list (not glob) keeps the assertion auditable and
// failure messages precise — if a new janitor file is added, this list must
// be updated alongside the ESLint config (cross-reference: this spec exists
// because ESLint can be disabled per-line; the test cannot).
import { readFileSync } from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../../../../../');

const BANNED_FILES = [
  'apps/cron/src/tasks/media.janitor.ts',
  'libraries/nestjs-libraries/src/database/prisma/media/media.janitor.service.ts',
  'libraries/nestjs-libraries/src/database/prisma/media/media.janitor.repository.ts',
  'libraries/nestjs-libraries/src/upload/media.path.resolver.ts',
  'libraries/nestjs-libraries/src/upload/path.confinement.ts',
];

const EXEMPT_FILE =
  'libraries/nestjs-libraries/src/services/clock.service.ts';

const NEW_DATE_RE = /\bnew\s+Date\s*\(/;
const DATE_NOW_RE = /\bDate\s*\.\s*now\s*\(/;

// Strip line-comments (// ...) and block-comments (/* ... */) before scanning.
// Janitor files use comments to REFERENCE the banned patterns in plan/spec
// citations; those mentions are not actual uses.
const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');

describe('clock invariant #2: no new Date() / Date.now() in janitor files', () => {
  it.each(BANNED_FILES)('%s contains no `new Date()` calls', (relPath) => {
    const code = stripComments(
      readFileSync(path.join(REPO_ROOT, relPath), 'utf8')
    );
    expect(code).not.toMatch(NEW_DATE_RE);
  });

  it.each(BANNED_FILES)('%s contains no `Date.now()` calls', (relPath) => {
    const code = stripComments(
      readFileSync(path.join(REPO_ROOT, relPath), 'utf8')
    );
    expect(code).not.toMatch(DATE_NOW_RE);
  });

  it('ClockService is the exempt site and DOES use both', () => {
    const code = readFileSync(
      path.join(REPO_ROOT, EXEMPT_FILE),
      'utf8'
    );
    // This is the counter-test-by-revert anchor: if the grep regex drifts and
    // stops catching the patterns, this assertion catches the drift.
    expect(code).toMatch(NEW_DATE_RE);
    expect(code).toMatch(DATE_NOW_RE);
  });
});
