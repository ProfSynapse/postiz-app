# October 2026 Postiz security migration

> Round2 validation supersedes the original pending image/UI/high-triage gates below: see [round2 validation](2026-10-22-postiz-round2-validation.md) and [queue handoff](2026-10-22-postiz-queue-handoff.md). Owner account acceptance/rollout and24 residual high entries remain open.


This branch prepares a migration from deployed source `ebe8f341f9e3395d893909e083f8ae26c41aeef2`. It does not deploy it. Production runtime verification, full build checks and rollout approval remain required.

## Runtime and framework changes

- Pin Node **22.23.4** in the Docker base (verified multi-platform index digest), engine minimum, `.nvmrc`, Volta and CI. Keep pnpm **10.6.1** and use the frozen lockfile in Docker and the janitor test workflow.
- Upgrade Next and its ESLint config to **15.5.28**, retaining declared React **18.3.1** peers for existing libraries. **App Router uses Next's bundled React 19 internally**; the declared peer range does not establish UI compatibility. The override applies to Neynar's nested Next dependency too. Real UI/integration smoke testing and a reviewed React 19 dependency plan are release gates.
- Await `cookies()`, `headers()`, route `params` and `searchParams`; preserve auth/organization forwarding, registration restrictions, reset tokens, preview sharing and social OAuth callback values. Move the preview date's `ssr: false` dynamic import into a Client Component. Remove an invalid async Client Component declaration in the extension modal.
- Upgrade Sharp to **0.35.5** across the graph; limit Next build workers to two and enable Next 15's documented Webpack memory optimization. Add Sentry's Next 15 request-error hook. Keep its v10 root config export while the repository uses legacy TypeScript module resolution. Align ESLint 9 and its TypeScript/React plugins with the existing flat config; Next 15's flat-config adapter failed with ESLint 8 options.

## Additional critical dependency paths

Sentry packages move together to **10.76.2**. Version-scoped overrides keep XML-parser, form-data, proxy-addr, shell-quote, Handlebars, protobufjs, Piscina and basic-ftp on compatible patched release lines. Undici 7 and DOMPurify 3 have matching patched-line overrides.

Bcrypt **6.0.0** retains `hashSync`/`compareSync` and the `$2a$`/`$2b$` formats, while removing the obsolete node-pre-gyp/tar install chain. Tests verify an upstream bcrypt 5.1.1 vector as well as a new hash and wrong-password rejection. No password rehash or database migration is introduced by this branch.

Pigment **0.0.31**, a patch satisfying Neynar's peer range, updates its own transformer to a release using Happy DOM 20. The actual transformer's VM context is checked under Node 22. The direct unused canvas package is removed and `canvas: "-"` disables transitive optional native canvas support in JSDOM/Jest. Application source has no Node-canvas imports; browser HTML canvas remains unaffected. JSDOM text parsing is tested. A future feature requiring server-side canvas rendering must explicitly revisit this decision.

## Evidence and advisory scope

The baseline production lock graph has **3,131 snapshots / 2,557 package names**. Its advisory/range entries are **17 critical, 187 high, 191 moderate and 33 low**. The candidate graph has **3,195 snapshots / 2,547 package names**, **zero critical**, **144 high, 157 moderate and 23 low** entries. Counts are advisory/range entries, not unique vulnerabilities, installed endpoint exposures or exploitable paths. Remaining high findings include Multer, Axios, MCP, Hono and parsing/build libraries; they need separate reachability and compatibility triage. This branch is not a complete dependency-security clearance.

`pnpm audit:production --output /tmp/postiz-audit.json` traverses all workspace production roots and optional edges, resolves npm aliases, checks each snapshot once, submits bounded registry bulk requests, and filters exact versions using semver. It deliberately includes tools incorrectly classified as production and optional/platform-specific paths. It does not infer process or exploit reachability. It fails closed on unresolved edges and exits nonzero for critical findings. A synthetic alias/cycle/dev-root/range fixture verifies the traversal. It runs with a **512 MB** heap, avoiding pnpm audit's repeated-path expansion. Container OS packages, global PM2/pnpm and runtime drift are outside this lock audit.

The original report should be interpreted with these conditions:

- Node's fullwidth-IP issue CVE-2026-105483 affects Node 24/26, not the deployed Node 22. Other October Node 22 issues still require this update.
- The Next `use cache` typed-array RCE concerns Cache Components. No `use cache` source was found; it is not established for this Next 14 app.
- The SVG image RCE advisory requires glibc Linux. Postiz's Alpine base uses musl. The AVIF path and other Next advisories still motivate the supported-version migration. Windows-only advisories do not establish Linux exposure.
- Sentry's tunnel bypass requires configured `tunnelRoute` and additional route/auth conditions. No `tunnelRoute` is configured here.

Sources: [Next 15 React behavior](https://nextjs.org/blog/next-15#react-19), [Node October release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases), [Next security update](https://nextjs.org/blog/nextjs-security-update-october-14-2026), [Next 15 migration guide](https://nextjs.org/docs/app/guides/upgrading/version-15), [Sentry tunnel advisory](https://github.com/getsentry/sentry-javascript/security/advisories/GHSA-mchm-gjx6-7h55), [Pigment patch](https://github.com/mui/pigment-css/releases/tag/v0.0.31), [bcrypt 6 release](https://github.com/kelektiv/node.bcrypt.js/releases/tag/v6.0.0).

## Repeatable isolated validation

Use Node 22.23.4 and the pinned pnpm. Do not copy a production `.env` into this worktree. All external providers in the focused tests are mocked; they do not publish or send.

```sh
flock /tmp/synaptic-cve-remediation-heavy.lock env NODE_OPTIONS=--max-old-space-size=2048 pnpm install --frozen-lockfile --ignore-scripts --network-concurrency=4 --child-concurrency=2
flock /tmp/synaptic-cve-remediation-heavy.lock pnpm exec prisma generate --schema libraries/nestjs-libraries/src/database/prisma/schema.prisma
flock /tmp/synaptic-cve-remediation-heavy.lock env NODE_OPTIONS=--max-old-space-size=2048 pnpm test:security
pnpm audit:production --output /tmp/postiz-audit.json
```

The backend bootstrap spec executes the actual entrypoint with mocked AppModule, Nest application listener and external providers. Existing tests exercise the watchdog, health failures, cron supervisor, token refresh, BullMQ transport/heartbeats, upload confinement and LinkedIn/YouTube mocks. This is not a real database/Redis/provider boot or end-to-end production authentication test.

Confirmed validation: **25 Jest suites / 300 tests**, **5 Node tests** (audit algorithm, Pigment VM, JSDOM, Sharp, Sentry native profiling), generated Prisma client without DB access, and full **backend/workers/cron** builds with a 3 GB heap on Node 22.23.4. Backend at 2 GB and frontend at 2 GB exhausted their heaps. The final full frontend production build **passed**, including lint, types, page generation and route output, with a 3 GB heap after the ESLint/Sentry config-resolution fixes. Standalone frontend TypeScript checking and the final frozen-lock check also pass. Nonblocking Sass/Sentry deprecations and existing image/React-hook lint warnings remain. The production graph audit completed in **3.02 seconds** with **157,480 KiB maximum RSS** under its 512 MB heap cap. Full build results and the final test receipt are recorded in the implementation handoff. A PR must wait for required builds/checks to pass. The repository's PR workflow publishes a container, so no PR is opened automatically by this handoff.

## Owner-authorized rollout procedure

1. Review this branch and remaining high-advisory triage. On an isolated runner with sufficient memory, require a frozen install and `pnpm run build` for frontend, backend, workers and cron; run `pnpm test:security`. Do not bypass type checks to release the migration.
2. Build a fresh candidate Docker image from this commit with `--pull`, and record the resulting digest. Verify Node, Next and Sharp **inside the final image**, including native Sharp and bcrypt loading on musl. The checked Node base index is `sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914`; its linux/amd64 manifest is `sha256:025b8e975a61d94e33abeafaad1255ef44e4898cf1a1b6446860009c72e6d284` and config declares `NODE_VERSION=22.23.4`.
3. Use a separate staging database, Redis namespace/service, upload volume and test-only credentials. Preserve existing secret values without printing or rotating them. Postiz startup currently runs `prisma db push`; inspect its proposed schema effect and take a verified backup before authorizing any production start. This branch changes no Prisma schema.
4. In staging, verify backend readiness/deep health, frontend login/logout and disabled registration, password reset, OAuth reconnect/callback state, preview sharing, local and object-storage upload/download, Sharp processing, cron startup, worker heartbeat, delayed-job enqueue/consume and token refresh. Use nonpublishing mock/test integrations. Check Neynar/Farcaster UI, extension modal and Sentry initialization specifically. Do not publish test posts to real accounts.
5. Coordinate Redis **8.2.9+** and queue persistence with the n8n-data remediation owner; do not change Redis settings from this branch. Verify no lost/double-consumed delayed jobs, worker reconnect and heartbeat recovery across restart.
6. Only after owner approval, deploy the exact tested image, inspect all web/backend/worker/cron runtime versions and digests, and observe health and due-job timing. Roll back the whole app image to the recorded previous digest if compatibility fails; retain the database/Redis/upload volumes and credentials. Review DB effects before any restore; do not roll back by destructive schema push.
