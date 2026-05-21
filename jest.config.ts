import { getJestProjectsAsync } from '@nx/jest';

// getJestProjectsAsync() reads project.json entries to discover jest configs. Two
// new media-janitor projects (apps/cron and the janitor integration suite)
// live outside of project.json registration to keep this PR additive and
// minimum-diff; they are spliced in explicitly here.
export default async () => ({
  projects: [
    ...(await getJestProjectsAsync()),
    '<rootDir>/apps/cron',
    '<rootDir>/libraries/nestjs-libraries/src/database/prisma/media/__integration__',
  ],
});
