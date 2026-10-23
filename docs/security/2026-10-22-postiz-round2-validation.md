# Postiz follow-up round 2

Prepared locally, not deployed. This follow-up preserves the original migration commits and receipts. No push, PR (which would publish a container), image push, cloud build, production connection, credential action or Railway mutation was performed.

## Changes

- Patch runtime HTTP packages on compatible release lines: Axios1.20.0, MCP SDK1.32.1, Hono4.13.13 and Multer2.5.0, plus scoped compatible transitive fixes. Keep the supported Next15/Node22/Sharp migration and immutable Node base pin.
- Bound multipart metadata and map new Multer parser failures to controlled400/413 responses. Bound MCP JSON bytes, elements and nesting before validation. Keep organization API-key lookup/authentication.
- Patch Mastra0.13.5's actual HTTP adapter to consume Nest's parsed request body rather than waiting forever on an already-ended stream. A narrow pnpm patch covers both ESM/CJS distributions, with upstream-byte provenance.
- Actual compiled backend tests also found unresolved dynamic workspace aliases and MCP mounting after Nest's terminal404 middleware. Use relative lazy imports and mount its router before listen. A named parser wrapper keeps Nest's ordinary JSON/raw-body parser installed elsewhere; this preserves auth JSON and Stripe raw-body handling.
- Runtime upload serving no longer depends on build-time storage variables. Local reads use confined real paths and real file streaming; cloud configuration declines local filesystem reads. Keep runtime uploads and credentials outside Docker context while retaining upload API source.
- Queue transport no longer logs full job packets. Queue handoff documents source producer/cron/worker behavior and concrete Redis cutover/reconciliation checks.

## Advisory interpretation

The new bounded production audit reports advisory/range entries, not exploit counts. Full exact snapshot paths, primary maintainer advisory receipts and source/config prerequisites for every one of the original53 high packages are in `high-triage.json` and `docs/security/2026-10-22-postiz-high-triage.md`. Remaining majors/absent fixes are explicitly open. They include runtime SMTP/AI/editor/telemetry paths and conditional transports, as well as build/platform paths; they are not collectively dismissed as dev-only.

## Evidence boundaries

Actual loopback HTTP checks use real Axios adapters/redirects/streams, actual Nest Multer and real storage, and real concurrent SDK/Mastra sessions. Actual Alpine image checks use native Sharp AVIF, bcrypt legacy/fresh hashes and Sentry C++ profiling. Disposable PostgreSQL and Redis have dummy records only and no public ports. Their internal network blocks provider egress. Application MCP lists tools but does not execute publishing tools. Backend login and authenticated uploads use real Prisma/auth/filesystem code.

Frontend fixtures run actual production Next output and browser hydration against a test-only backend. They exercise rendering, cookies/organization forwarding and callback parameter transport; they do not establish live OAuth/provider correctness, SMTP delivery, secure cross-domain cookies or optional wallet/Farcaster account flows. Unknown fixture mutations and external browser connections are blocked. No messages or posts are sent.

## Queue coordination

Read `docs/security/2026-10-22-postiz-queue-handoff.md` before the Social Redis cutover. Source defaults are prefix `bull`, URL-selected DB (default0 only if omitted), and seven registered handler queues, plus orphan/star producers to inventory. Live index/AOF/TLS remain unverified. Actual dummy RDB restart compares waiting/delayed/scheduler IDs/times/pause state and verifies worker drain/readiness/heartbeat. Completed-ID replay and active-ID successor deduplication demonstrate why exactly-once effects cannot be promised. Normal image startup performs `prisma db push` and starts all PM2 processes together; maintenance ordering needs an owner-reviewed launch override.

Owner acceptance and rollout remain open. Task8a48a9ab-093e-43c8-bf13-860d5ea5d1a6 remains in_progress. Preserve image/data/upload volumes and reconcile interrupted external effects before any owner-authorized rollback or replay.

## Final verified candidate

- Application source commit: `d5724c59bfb2c34695d1738a00edc037e6802b52`; branch `security/postiz-runtime-20261022`. Later handoff commits change documentation only.
- Actual `Dockerfile.dev` local image: `postiz-security:20261022-r2`, ID `sha256:aab94dec00c15b99f59ac0bb095c8df4175848ade24229473b522c534bb5eebc`. Docker inspect reports the same local RepoDigest. No remote push or registry publication was performed.
- Base remains `node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914`. Build context9.589MB; inspected ignore rules exclude credentials/runtime uploads while retaining upload API source. No production `.env`, token, account or data copy was used.
- Build: `DOCKER_BUILDKIT=0 docker build --pull --memory=5g --memory-swap=5g --cpu-period=100000 --cpu-quota=200000 --shm-size=256m -f Dockerfile.dev ...`. All four production builds, frontend lint/types/page generation and frozen install passed. Node heap3GB; two CPUs/workers; each expensive phase acquired the shared flock. Heavy operations were serialized; busy locks were waited on with bounded retries.
- Inside final image: Node22.23.4/musl, Next15.5.28, Sharp0.35.5 AVIF encode/decode, bcrypt6 legacy/fresh hash comparison, Sentry10.76.2 actual native C++ profiling start/stop pass. Declared React18.3.1; Next App Router uses its bundled19.2.0-canary runtime. No claim that the declared18 peer establishes compatibility.
- `pnpm test:security` **inside this final Alpine image**:27 Jest suites/316 tests and7 Node tests pass, max2 workers. All native app modules are the actual image's modules. The extra reconnect/cloud/browser test programs are test harnesses; they do not replace application/native modules.
- Final bounded audit after the last lock change:3,140 production/optional snapshots,2,529 names, **0 critical/24 high/72 moderate/16 low advisory/range entries**. High144→24 across53→18 affected package names. The lock audit excludes OS/global package security and does not infer exploitation.

## Real interfaces and fixture boundaries

| Check | Actual interface | Fixture boundary |
| --- | --- | --- |
| Axios/Multer | Local HTTP JSON/headers/status/streams, real redirects/credential stripping, fetch-adapter size ceiling, actual LocalStorage download; Axios FormData through Nest FileInterceptor/storage, truncated and bounded multipart errors | Loopback endpoints/files only; no external download/provider |
| MCP | Two actual SDK/Mastra HTTP sessions and harmless valid/invalid calls; final compiled Nest endpoint initializes and lists actual tools with real PostgreSQL API-key lookup | Actual publishing tools are listed, never executed; protocol fixture tools have harmless handlers |
| Backend auth/upload | Actual final backend entrypoint, real Prisma/user/bcrypt login, disabled registration POST, organization header, wrong password and authenticated PNG upload/storage/error mapping | Disposable PostgreSQL17/Redis8.2.9, dummy credentials and records, internal Docker network; no providers/sends |
| Queue | Actual producer/server/heartbeat/health/publish-lock code, two workers at concurrency1, Prisma dummy writes, global pause/active drain, RDB save/restart/inventory, delayed/scheduler preservation and replay/dedup evidence | Harmless handlers replace publishing controllers; this is not full production cron/provider boot |
| Reconnect | Same worker process reconnects after real disposable Redis restart, consumes one job, writes a fresh heartbeat | One dummy handler/concurrency1; idle restart, not an external-effect crash test |
| Next HTTP | Six real production page responses, public redirect origin/query semantics, real upload bytes and traversal/symlink rejection; runtime Cloudflare selection refuses an existing local file | Test backend; cloud object-storage API not configured or called |
| Browser | Hydrated login/public calendar redirect, disabled registration, reset-token form, preview local date, async OAuth code/state/refresh and cookie/org forwarding; extension TipTap text edit without save/schedule | Backend responses/test credentials only. Reset/OAuth succeed against stubs, not real accounts. Extension supplies one dummy channel metadata response; all mutations/providers remain blocked |

The original mocked backend entrypoint/provider tests remain part of the316-test total. They are not relabeled as real DB/Redis boot. Actual infrastructure and final-backend receipts are separate.

## Compatibility issues caught by actual execution

The first final-image attempt passed builds but failed actual MCP startup/listing: lazy workspace aliases were not rewritten, the router was registered after Nest's terminal404 middleware, and registering a named `jsonParser` caused Nest to skip ordinary auth/raw-body parsing. Real socket/bootstrap tests exposed and verified the scoped fixes.

Actual Next server startup then exposed Neynar0.9.7's embedded React18 JSX runtime. Pinning maintainer Neynar1.2.22 retains the consumed context/settings API and supports React18/19; the actual context renders with Next19. A later login click exposed react-loading2.0.3's embedded React16 (React#525). Its eight spin-only call sites now share a current-runtime SVG spinner. The real loading Button renders with Next19 and actual browser login/reset interactions pass. Browser redirects exposed the internal Next listen address; they now use trusted `FRONTEND_URL`, not request Host, with pathname-based auth matching. Three real NextRequest tests and production HTTP/browser checks pass.

T3 preview handled the main browser flows. Its extension wait returned `Preview automation waitFor timed out after 15000ms.` twice with an empty integration fixture. Following the tool fallback rule, an existing Playwright installation and existing T3 headless-shell binary ran the extension with one dummy channel; editor hydration/text editing passed with no React/page errors. GPU disabled; two-renderer limit/512MB JS heap. No browser or host runtime was installed or changed.

Expected CSP failures deliberately block Stripe.js, external Google stylesheet/flag image and Copilot update checking; these features are not accepted here. The first host proxy's16-connection cap caused502 chunk loads and was raised to128. Initial native-form GET used dummy values only; final hydrated login is an observed POST. Internal Docker networks disable published ports, so a temporary loopback host proxy exposed only the fixture via tailnet Serve8461. Both were removed. One HTTP assertion originally compared encoded query strings byte-for-byte; it now checks identical origin/path/query values (`/auth` versus `%2Fauth` are the same value). Those failed attempt receipts are retained.

The stub login also set a host-only cookie in addition to the app's client domain cookie. The fixture host cookie was explicitly cleared for logged-out pages. This is not acceptance of production secure cross-domain logout/cookies.

## Residual work and rollout gate

All18 remaining high packages have exact routes, primary sources, prerequisites and next changes in the high-triage report: GraphQL tools, Nest microservices, four OpenTelemetry packages, Tiptap core, basic-ftp, braces, cross-spawn, image-size, jsondiffpatch, LangSmith, music-metadata, node-forge, Nodemailer, serialize-javascript and tmp. Several need coordinated major releases or have no fixed compatible line. Runtime SMTP/AI/editor/telemetry items are not dismissed as development dependencies. No arbitrary whole-graph major override was applied.

Owner acceptance still covers real OAuth/accounts/reconnect, SMTP/reset delivery, secure domain cookies/logout, optional Neynar/Farcaster/wallet/payment flows, object storage, full cron/provider behavior and reviewed production rollout/queue reconciliation. Retain the exact tested app image and follow the separate queue handoff with the n8n-data owner. Current production image/process/config/AOF/TLS/DB effects remain unverified. Image startup still performs `prisma db push`; do not authorize a live start without reviewing it. No Prisma schema change is introduced here. Local fixtures and Serve mapping have been removed; final image/receipts remain local. Nexus task stays in_progress for owner acceptance, not production fixed.

Evidence: `/home/profsynapse/.t3/scratch/2026-10-22-there-s-recently-been-a-17c15cd7/postiz-agent-round2/README.md`, machine-readable validation, raw logs, advisory JSON, patches and SHA256 manifest. Original round1 evidence/commits are preserved separately.

Sources: [Neynar maintainer package metadata](https://registry.npmjs.org/@neynar/react/1.2.22), [React older-element error](https://react.dev/errors/525), [Next15 React behavior](https://nextjs.org/blog/next-15#react-19). Exact dependency advisories are linked in the high-triage report.
