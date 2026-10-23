# Postiz high advisory triage follow-up

Advisory/range entries, one exact shortest route per lock snapshot; not exhaustive runtime reachability. Source conditions are code inspection and primary maintainer advisory review; no live configuration/credentials read. Tests listed separately do not establish every conditional feature.

Prior counts: {'low': 23, 'high': 144, 'moderate': 157}. Final: {'low': 16, 'moderate': 72, 'high': 24}.

All primary metadata and exact snapshot paths are in `high-triage.json`; primary advisory JSON receipts are in the artifact `advisories/` directory. The following runtime classification is conservative; feature-unverified is an open condition, not a dev-only dismissal.

## @fastify/busboy

Classification: feature-unverified. High range entries: 2 → 0. Final versions: 3.2.1.

Copilot GraphQL fetch multipart parser; adversary-controlled multipart boundary/header parsing is required; no public file route was established for this copy.

Same major patch; final HTTP fixtures cover Nest Multer separately.

Exact prior route example: . → @copilotkit/runtime → graphql-yoga → @whatwg-node/fetch → @whatwg-node/node-fetch → @fastify/busboy.

- [GHSA-xjh9-v7x6-24jw](https://github.com/fastify/busboy/security/advisories/GHSA-xjh9-v7x6-24jw): `>=3.1.0 <3.2.1`, checked `3.2.0`; upstream fixed 3.2.1.
- [GHSA-x8mw-p69m-v3mx](https://github.com/fastify/busboy/security/advisories/GHSA-x8mw-p69m-v3mx): `>=1.0.0 <3.2.1`, checked `3.2.0`; upstream fixed 3.2.1.

## @graphql-tools/utils

Classification: runtime-feature-unverified. High range entries: 2 → 2. Final versions: 10.11.0.

Copilot runtime imports GraphQL Yoga. Prototype pollution requires mergeDeep on attacker keys or mergeIncrementalResult with non-primitive path segments; no federation/subgraph/defer input route proven in Postiz.

No 10.x fix; upgrade coordinated Copilot/Yoga/GraphQL tools to utils >=12.0.2, test streaming GraphQL without provider execution; do not force utils12 under consumers10.

Exact prior route example: . → @copilotkit/runtime → @graphql-yoga/plugin-defer-stream → @graphql-tools/utils.

- [GHSA-7mx3-vvmw-hjmv](https://github.com/ardatan/graphql-tools/security/advisories/GHSA-7mx3-vvmw-hjmv): `<=12.0.0`, checked `10.11.0`; upstream fixed 12.0.1.
- [GHSA-c4qx-w738-7hr3](https://github.com/ardatan/graphql-tools/security/advisories/GHSA-c4qx-w738-7hr3): `>=10.10.1 <=12.0.1`, checked `10.11.0`; upstream fixed 12.0.2.

## @grpc/grpc-js

Classification: runtime-feature-unverified. High range entries: 3 → 0. Final versions: 1.14.6.

Nest microservices dependency; affected HTTP/2/gRPC stream or metadata handling requires a listening gRPC server/client. Postiz configures its custom BullMQ transport, no gRPC listener in source.

Same major fixed patch; protocol prerequisites remain distinct from installed reachability.

Exact prior route example: . → @nestjs/microservices → @grpc/grpc-js.

- [GHSA-5375-pq7m-f5r2](https://github.com/grpc/grpc-node/security/advisories/GHSA-5375-pq7m-f5r2): `>=1.14.0 <1.14.4`, checked `1.14.3`; upstream fixed 1.9.16, 1.10.12, 1.11.4, 1.12.7, 1.13.5, 1.14.4.
- [GHSA-99f4-grh7-6pcq](https://github.com/grpc/grpc-node/security/advisories/GHSA-99f4-grh7-6pcq): `>=1.14.0 <1.14.4`, checked `1.14.3`; upstream fixed 1.9.16, 1.10.12, 1.11.4, 1.12.7, 1.13.5, 1.14.4.
- [GHSA-m9gg-hp2v-232j](https://github.com/grpc/grpc-node/security/advisories/GHSA-m9gg-hp2v-232j): `>=1.14.0 <1.14.5`, checked `1.14.3`; upstream fixed 1.13.6, 1.14.5.

## @hono/node-server

Classification: runtime-feature-unverified. High range entries: 1 → 0. Final versions: 1.19.17.

MCP/Mastra may use the Node HTTP adapter; request authority/Host and static-file prerequisites depend on adapter configuration. Postiz passes existing Nest req/res to Mastra instead of serveStatic.

Keep on patched 1.x and verify actual Mastra HTTP interface.

Exact prior route example: . → @modelcontextprotocol/sdk → @hono/node-server.

- [GHSA-wc8c-qw6v-h7f6](https://github.com/honojs/node-server/security/advisories/GHSA-wc8c-qw6v-h7f6): `<1.19.10`, checked `1.19.7`; upstream fixed 1.19.10.

## @langchain/core

Classification: runtime-feature-unverified. High range entries: 1 → 0. Final versions: 0.3.80.

Copilot/LangChain serializer can accept attacker-shaped lc markers in metadata, then deserialize via load with secrets available. No application load() or LangSmith prompt pull found.

Use fixed 0.3 line; no forced LangChain1 migration.

Exact prior route example: . → @langchain/core.

- [GHSA-r399-636x-v7f6](https://github.com/langchain-ai/langchainjs/security/advisories/GHSA-r399-636x-v7f6): `<0.3.80`, checked `0.3.79`; upstream fixed 1.1.8, 0.3.80.

## @modelcontextprotocol/sdk

Classification: runtime. High range entries: 5 → 0. Final versions: 1.32.1.

start.mcp.ts mounts authenticated /mcp/:id using Mastra MCPServer; per-session transport/server routing matters. URI-template issue needs exploded resource templates; OAuth leak needs HTTP authProvider; experimental task issue needs taskStore (not configured). Validation exhaustion requires untrusted tool arrays/records; version upgrade alone does not enable the optional limit.

Patch every SDK1 copy; cap parsed JSON body100KiB,10000 elements and depth64 before Mastra Zod validation. A checked pnpm patch to Mastra0.13.5 uses pre-parsed Nest req.body instead of rereading an ended raw stream; Postiz rejects unparsed/non-JSON POSTs. Real concurrent SDK sessions, valid/invalid tool calls and input rejection pass on local HTTP. Final-image actual application MCP listing is tracked separately.

Exact prior route example: . → @modelcontextprotocol/sdk.

- [GHSA-345p-7cg4-v4c7](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-345p-7cg4-v4c7): `>=1.10.0 <=1.25.3`, checked `1.25.1`; upstream fixed 1.26.0.
- [GHSA-8r9q-7v3j-jr4g](https://github.com/modelcontextprotocol/typescript-sdk/issues/965): `>=1.3.0 <1.25.2`, checked `1.25.1`; upstream fixed 1.25.2.
- [GHSA-6qxp-vccf-f47h](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6qxp-vccf-f47h): `>=1.12.0 <1.31.0`, checked `1.25.1`; upstream fixed 1.31.0.
- [GHSA-22jm-h49p-29qw](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-22jm-h49p-29qw): `>=1.24.0 <1.32.0`, checked `1.25.1`; upstream fixed 1.32.0.
- [GHSA-46jr-4wx8-v453](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-46jr-4wx8-v453): `>=1.3.0 <1.32.0`, checked `1.25.1`; upstream fixed 1.32.0.

## @nestjs/microservices

Classification: runtime-conditional. High range entries: 2 → 2. Final versions: 10.4.20.

TCP/RabbitMQ remote pattern serialization advisories require those listeners. workers/main.ts uses only custom BullMqServer with source-defined string handlers and Redis jobs; no built-in TCP/RMQ transport is configured.

No 10.x fix; coordinated Nest11 >=11.2.5 (or12 >=12.0.3) core/common/platform/microservices migration with transport regression. Do not force only microservices across Nest major.

Exact prior route example: . → @nestjs/microservices.

- [GHSA-hpwf-8g29-85qm](https://github.com/nestjs/nest/security/advisories/GHSA-hpwf-8g29-85qm): `<=11.1.18`, checked `10.4.20`; upstream fixed 11.1.19.
- [GHSA-m8vh-jmq9-5rjg](https://github.com/nestjs/nest/security/advisories/GHSA-m8vh-jmq9-5rjg): `<11.2.4`, checked `10.4.20`; upstream fixed 11.2.4, 12.0.2.

## @opentelemetry/auto-instrumentations-node

Classification: runtime-feature-unverified. High range entries: 1 → 1. Final versions: 0.62.2.

Mastra telemetry dependency; Prometheus crash requires an enabled Prometheus metric exporter endpoint and malformed HTTP request. No exporter/port9464 configuration in app source; effective auto-config not established.

Coordinate telemetry SDK/exporter >=0.217 and auto instrumentation >=0.75 with Mastra instead of replacing isolated 0.x minors.

Exact prior route example: . → @mastra/core → @opentelemetry/auto-instrumentations-node.

- [GHSA-q7rr-3cgh-j5r3](https://github.com/open-telemetry/opentelemetry-js/security/advisories/GHSA-q7rr-3cgh-j5r3): `>=0.55.0 <0.75.0`, checked `0.62.2`; upstream fixed 0.75.0.

## @opentelemetry/exporter-prometheus

Classification: runtime-feature-unverified. High range entries: 1 → 1. Final versions: 0.203.0.

Crashes only when exporter server is actually started and attacker reaches it, commonly port9464; imported SDK alone does not establish listener.

Upgrade Mastra telemetry suite to exporter >=0.217; staging inspect listening ports and exporter configuration without reading secrets.

Exact prior route example: . → @mastra/core → @opentelemetry/sdk-node → @opentelemetry/exporter-prometheus.

- [GHSA-q7rr-3cgh-j5r3](https://github.com/open-telemetry/opentelemetry-js/security/advisories/GHSA-q7rr-3cgh-j5r3): `<0.217.0`, checked `0.203.0`; upstream fixed 0.217.0.

## @opentelemetry/propagator-jaeger

Classification: runtime-feature-unverified. High range entries: 1 → 1. Final versions: 2.0.1.

Malformed percent-encoded uber-trace-id/uberctx header must reach an active JaegerPropagator; no explicit Jaeger configuration found. Mastra/Sentry automatic instrumentation remains configuration dependent.

Coordinate propagator >=2.9 with the telemetry graph; do not independently mix Mastra telemetry SDK generations.

Exact prior route example: . → @mastra/core → @opentelemetry/sdk-node → @opentelemetry/propagator-jaeger.

- [GHSA-45rx-2jwx-cxfr](https://github.com/open-telemetry/opentelemetry-js/security/advisories/GHSA-45rx-2jwx-cxfr): `<2.9.0`, checked `2.0.1`; upstream fixed 2.9.0.

## @opentelemetry/sdk-node

Classification: runtime-feature-unverified. High range entries: 1 → 1. Final versions: 0.203.0.

Prometheus issue needs the SDK configured to start that exporter (including env selection). App has no explicit prometheus exporter; live settings uninspected.

Mastra SDK update to >=0.217 and exporter compatibility rehearsal.

Exact prior route example: . → @mastra/core → @opentelemetry/sdk-node.

- [GHSA-q7rr-3cgh-j5r3](https://github.com/open-telemetry/opentelemetry-js/security/advisories/GHSA-q7rr-3cgh-j5r3): `>=0.57.0 <0.217.0`, checked `0.203.0`; upstream fixed 0.217.0.

## @tiptap/core

Classification: browser-runtime-conditional. High range entries: 1 → 1. Final versions: 3.14.0.

Editor imports Tiptap3; ReDoS specifically requires default Markdown attribute parsers createAtomBlockMarkdownSpec/createBlockMarkdownSpec on attacker Markdown. No use of those Markdown helpers found; HTML/rich text editor is used.

Align all @tiptap packages from3.14 to >=3.30.5 together and test editor paste/Markdown roundtrip, plugins and React19. Do not override core alone against older extension peers.

Exact prior route example: . → @tiptap/extension-bold → @tiptap/core.

- [GHSA-j95f-988m-3j2f](https://github.com/ueberdosis/tiptap/security/advisories/GHSA-j95f-988m-3j2f): `>=3.7.0 <3.30.5`, checked `3.14.0`; upstream fixed 3.30.5.

## axios

Classification: runtime. High range entries: 17 → 0. Final versions: 1.20.0.

Used for remote media, provider streams and JSON uploads. Redirect proxy leaks need authenticated proxy to direct redirect; NO_PROXY ReDoS needs nonempty NO_PROXY plus proxy and redirects; prototype gadgets need another prototype pollution primitive. HTTP/2 advisories need adapter selection; browser cookie-name issue needs attacker config; no live proxy config inspected.

Patch all Axios1 copies and follow-redirects; test real redirects, binary/stream/JSON/FormData and finite fetch response limits.

Exact prior route example: . → axios.

- [GHSA-q8qp-cvcw-x6jj](https://github.com/axios/axios/security/advisories/GHSA-q8qp-cvcw-x6jj): `>=1.0.0 <1.15.2`, checked `1.13.2`; upstream fixed 1.15.2.
- [GHSA-hfxv-24rg-xrqf](https://github.com/axios/axios/security/advisories/GHSA-hfxv-24rg-xrqf): `>=1.0.0 <1.16.0`, checked `1.13.2`; upstream fixed 1.16.0, 0.32.0.
- [GHSA-777c-7fjr-54vf](https://github.com/axios/axios/security/advisories/GHSA-777c-7fjr-54vf): `>=1.7.0 <1.16.0`, checked `1.13.2`; upstream fixed 1.16.0.
- [GHSA-p92q-9vqr-4j8v](https://github.com/axios/axios/security/advisories/GHSA-p92q-9vqr-4j8v): `>=1.0.0 <1.16.0`, checked `1.13.2`; upstream fixed 1.16.0, 0.32.0.
- [GHSA-j5f8-grm9-p9fc](https://github.com/axios/axios/security/advisories/GHSA-j5f8-grm9-p9fc): `>=1.0.0 <1.16.0`, checked `1.13.2`; upstream fixed 1.16.0, 0.32.0.
- [GHSA-3g43-6gmg-66jw](https://github.com/axios/axios/security/advisories/GHSA-3g43-6gmg-66jw): `>=1.0.0 <1.15.2`, checked `1.13.2`; upstream fixed 1.15.2, 0.31.1.
- [GHSA-35jp-ww65-95wh](https://github.com/axios/axios/security/advisories/GHSA-35jp-ww65-95wh): `>=1.0.0 <1.16.0`, checked `1.13.2`; upstream fixed 1.16.0.
- [GHSA-pmwg-cvhr-8vh7](https://github.com/axios/axios/security/advisories/GHSA-pmwg-cvhr-8vh7): `>=1.0.0 <1.15.1`, checked `1.13.2`; upstream fixed 1.15.1, 0.31.1.
- [GHSA-pf86-5x62-jrwf](https://github.com/axios/axios/security/advisories/GHSA-pf86-5x62-jrwf): `>=1.0.0 <1.15.1`, checked `1.13.2`; upstream fixed 1.15.1, 0.31.1.
- [GHSA-6chq-wfr3-2hj9](https://github.com/axios/axios/security/advisories/GHSA-6chq-wfr3-2hj9): `>=1.0.0 <1.15.1`, checked `1.13.2`; upstream fixed 1.15.1, 0.31.1.
- [GHSA-43fc-jf86-j433](https://github.com/axios/axios/security/advisories/GHSA-43fc-jf86-j433): `>=1.0.0 <=1.13.4`, checked `1.13.2`; upstream fixed 1.13.5, 0.30.3.
- [GHSA-gcfj-64vw-6mp9](https://github.com/axios/axios/security/advisories/GHSA-gcfj-64vw-6mp9): `>=1.15.2 <1.18.0`, checked `1.16.0`; upstream fixed 0.33.0, 1.18.0.
- [GHSA-m8m8-qj5v-23w3](https://github.com/axios/axios/security/advisories/GHSA-m8m8-qj5v-23w3): `>=1.15.2 <1.20.0`, checked `1.16.0`; upstream fixed 1.20.0.
- [GHSA-mghh-pgcx-3jjj](https://github.com/axios/axios/security/advisories/GHSA-mghh-pgcx-3jjj): `>=1.15.0 <1.20.0`, checked `1.16.0`; upstream fixed 1.20.0.
- [GHSA-x97p-jq2g-jp4f](https://github.com/axios/axios/security/advisories/GHSA-x97p-jq2g-jp4f): `>=1.15.1 <1.20.0`, checked `1.16.0`; upstream fixed 0.34.0, 1.20.0.
- [GHSA-3pq3-5fj3-cg6v](https://github.com/axios/axios/security/advisories/GHSA-3pq3-5fj3-cg6v): `>=1.13.0 <1.20.0`, checked `1.13.2, 1.16.0`; upstream fixed 1.20.0.
- [GHSA-542g-h47m-68v8](https://github.com/axios/axios/security/advisories/GHSA-542g-h47m-68v8): `>=1.13.0 <1.20.0`, checked `1.13.2, 1.16.0`; upstream fixed 1.20.0.

## basic-ftp

Classification: build-feature-unverified. High range entries: 1 → 1. Final versions: 5.3.1.

Neynar openapi-generator proxy agent get-uri path. Quadratic list parser requires FTP Client.list on malicious Unix listing, not ordinary HTTP request. No direct FTP application use found.

No5.x fix; update generator/get-uri/proxy chain to basic-ftp >=6.2.1 and verify generator/runtime import, or remove unused generator from production packaging.

Exact prior route example: . → @neynar/nodejs-sdk → @openapitools/openapi-generator-cli → proxy-agent → pac-proxy-agent → get-uri → basic-ftp.

- [GHSA-c475-qrg2-pj4r](https://github.com/patrickjuchli/basic-ftp/security/advisories/GHSA-c475-qrg2-pj4r): `<=6.2.0`, checked `5.3.1`; upstream fixed 6.2.1.

## brace-expansion

Classification: build-and-feature-unverified. High range entries: 15 → 0. Final versions: 1.1.20, 2.1.6, 5.0.11.

Nest CLI glob chain plus possible transitive consumers; expansion attacks require attacker-controlled glob and huge brace expansion, not just static source paths.

Patch each compatible major independently; never force brace-expansion5 into older APIs.

Exact prior route example: . → @nestjs/cli → fork-ts-checker-webpack-plugin → minimatch → brace-expansion.

- [GHSA-mh99-v99m-4gvg](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-mh99-v99m-4gvg): `<1.1.17`, checked `1.1.12`; upstream fixed 5.0.8, 3.0.3, 2.1.3, 1.1.17.
- [GHSA-mh99-v99m-4gvg](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-mh99-v99m-4gvg): `>=2.0.0 <2.1.3`, checked `2.0.2`; upstream fixed 5.0.8, 3.0.3, 2.1.3, 1.1.17.
- [GHSA-mh99-v99m-4gvg](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-mh99-v99m-4gvg): `>=4.0.0 <5.0.8`, checked `5.0.5`; upstream fixed 5.0.8, 3.0.3, 2.1.3, 1.1.17.
- [GHSA-rgw5-rvv9-x895](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-rgw5-rvv9-x895): `>=4.0.0 <5.0.9`, checked `5.0.5`; upstream fixed 1.1.18, 2.1.4, 3.0.6, 5.0.9.
- [GHSA-rgw5-rvv9-x895](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-rgw5-rvv9-x895): `>=2.0.0 <2.1.4`, checked `2.0.2`; upstream fixed 1.1.18, 2.1.4, 3.0.6, 5.0.9.
- [GHSA-rgw5-rvv9-x895](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-rgw5-rvv9-x895): `<1.1.18`, checked `1.1.12`; upstream fixed 1.1.18, 2.1.4, 3.0.6, 5.0.9.
- [GHSA-3jxr-9vmj-r5cp](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-3jxr-9vmj-r5cp): `>=2.0.0 <2.1.2`, checked `2.0.2`; upstream fixed 5.0.7, 1.1.16, 2.1.2.
- [GHSA-3jxr-9vmj-r5cp](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-3jxr-9vmj-r5cp): `<1.1.16`, checked `1.1.12`; upstream fixed 5.0.7, 1.1.16, 2.1.2.
- [GHSA-3jxr-9vmj-r5cp](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-3jxr-9vmj-r5cp): `>=3.0.0 <5.0.7`, checked `5.0.5`; upstream fixed 5.0.7, 1.1.16, 2.1.2.
- [GHSA-qhr7-859c-m2p7](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-qhr7-859c-m2p7): `>=4.0.0 <5.0.11`, checked `5.0.5`; upstream fixed 5.0.11, 3.0.8, 2.1.6, 1.1.20.
- [GHSA-6j4f-fj2g-mc7p](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-6j4f-fj2g-mc7p): `<1.1.19`, checked `1.1.12`; upstream fixed 5.0.10, 3.0.7, 2.1.5, 1.1.19.
- [GHSA-6j4f-fj2g-mc7p](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-6j4f-fj2g-mc7p): `>=2.0.0 <2.1.5`, checked `2.0.2`; upstream fixed 5.0.10, 3.0.7, 2.1.5, 1.1.19.
- [GHSA-6j4f-fj2g-mc7p](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-6j4f-fj2g-mc7p): `>=4.0.0 <5.0.10`, checked `5.0.5`; upstream fixed 5.0.10, 3.0.7, 2.1.5, 1.1.19.
- [GHSA-qhr7-859c-m2p7](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-qhr7-859c-m2p7): `<1.1.20`, checked `1.1.12`; upstream fixed 5.0.11, 3.0.8, 2.1.6, 1.1.20.
- [GHSA-qhr7-859c-m2p7](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-qhr7-859c-m2p7): `>=2.0.0 <2.1.6`, checked `2.0.2`; upstream fixed 5.0.11, 3.0.8, 2.1.6, 1.1.20.

## braces

Classification: build-and-feature-unverified. High range entries: 1 → 1. Final versions: 3.0.3.

Nest CLI/chokidar glob parser; stack exhaustion needs deeply nested attacker-controlled brace pattern. Static build globs observed; no app-provided brace pattern found.

Maintainer lists no patched release through3.0.3; parent parser update/depth guard or restrict patterns. No vulnerable-pattern exploit is run.

Exact prior route example: . → @nestjs/cli → chokidar → braces.

- [GHSA-vfj7-8cjw-p6xm](https://github.com/micromatch/braces/issues/70): `<=3.0.3`, checked `3.0.3`; upstream fixed None.

## browserslist

Classification: build. High range entries: 2 → 0. Final versions: 4.28.7.

Nest webpack/build browser targets; exploit needs malicious targets/config/resolution data. Build uses repository configuration.

Compatible 4.x patch and final production builds.

Exact prior route example: . → @nestjs/cli → webpack → browserslist.

- [GHSA-c83g-rgw3-j3cx](https://github.com/browserslist/browserslist/security/advisories/GHSA-c83g-rgw3-j3cx): `<=4.28.6`, checked `4.28.1`; upstream fixed 4.28.7.
- [GHSA-73wf-gq98-2v4g](https://github.com/browserslist/browserslist/security/advisories/GHSA-73wf-gq98-2v4g): `<=4.28.6`, checked `4.28.1`; upstream fixed 4.28.7.

## cross-spawn

Classification: build-platform-conditional. High range entries: 1 → 1. Final versions: 5.1.0, 7.0.6.

Legacy SWC binary-check/execa chain; ReDoS needs crafted spawn command/argument escaping (not ordinary provider HTTP). Windows escaping is particularly relevant; final image is Linux/musl.

No5.x backport; update legacy SWC CLI/bin-wrapper/execa chain to cross-spawn >=6.0.6/7.0.5 and rerun build.

Exact prior route example: . → @nestjs/cli → @swc/cli → @mole-inc/bin-wrapper → bin-check → execa → cross-spawn.

- [GHSA-3xgq-45jj-v275](https://github.com/moxystudio/node-cross-spawn/pull/160): `<6.0.6`, checked `5.1.0`; upstream fixed 7.0.5, 6.0.6.

## defu

Classification: browser-feature-unverified. High range entries: 1 → 0. Final versions: 6.1.5.

WalletConnect unstorage/h3 transitive merge; attacker object structure must reach unsafe merge with prototype keys.

Same6.x patch.

Exact prior route example: . → @postiz/wallets → @solana/wallet-adapter-walletconnect → @walletconnect/solana-adapter → @walletconnect/universal-provider → @walletconnect/keyvaluestorage → unstorage → h3 → defu.

- [GHSA-737v-mqg7-c878](https://github.com/unjs/defu/security/advisories/GHSA-737v-mqg7-c878): `<=6.1.4`, checked `6.1.4`; upstream fixed 6.1.5.

## fast-uri

Classification: runtime-feature-unverified. High range entries: 8 → 0. Final versions: 3.1.7.

MCP AJV URI parser paths; URL canonicalization/serialize used as trust decision with crafted host/path is prerequisite, not any JSON validation.

Same3.x patch.

Exact prior route example: . → @modelcontextprotocol/sdk → ajv → fast-uri.

- [GHSA-f65p-4m7j-42xc](https://github.com/fastify/fast-uri/security/advisories/GHSA-f65p-4m7j-42xc): `>=3.0.0 <3.1.6`, checked `3.1.0`; upstream fixed 2.4.5, 3.1.6, 4.1.3.
- [GHSA-jqff-g426-hqxp](https://github.com/fastify/fast-uri/security/advisories/GHSA-jqff-g426-hqxp): `>=3.0.0 <3.1.6`, checked `3.1.0`; upstream fixed 2.4.5, 3.1.6, 4.1.3.
- [GHSA-7p8r-x3mc-p8w7](https://github.com/fastify/fast-uri/security/advisories/GHSA-7p8r-x3mc-p8w7): `>=3.0.0 <3.1.5`, checked `3.1.0`; upstream fixed 2.4.4, 3.1.5, 4.1.2.
- [GHSA-v2hh-gcrm-f6hx](https://github.com/fastify/fast-uri/security/advisories/GHSA-v2hh-gcrm-f6hx): `>=3.0.0 <=3.1.3`, checked `3.1.0`; upstream fixed 2.4.3, 3.1.4, 4.1.1.
- [GHSA-4c8g-83qw-93j6](https://github.com/fastify/fast-uri/security/advisories/GHSA-4c8g-83qw-93j6): `>=3.0.0 <3.1.3`, checked `3.1.0`; upstream fixed 4.0.1, 3.1.3, 2.4.2.
- [GHSA-q3j6-qgpj-74h6](https://github.com/fastify/fast-uri/security/advisories/GHSA-q3j6-qgpj-74h6): `>=3.0.0 <=3.1.0`, checked `3.1.0`; upstream fixed 3.1.1, 2.4.1.
- [GHSA-v39h-62p7-jpjc](https://github.com/fastify/fast-uri/security/advisories/GHSA-v39h-62p7-jpjc): `>=3.0.0 <=3.1.1`, checked `3.1.0`; upstream fixed 3.1.2, 2.4.1.
- [GHSA-qw65-cvwx-89v3](https://github.com/fastify/fast-uri/security/advisories/GHSA-qw65-cvwx-89v3): `>=3.0.0 <3.1.7`, checked `3.1.0`; upstream fixed 2.4.6, 3.1.7, 4.1.4.

## follow-redirects

Classification: runtime. High range entries: 2 → 0. Final versions: 1.16.1.

Nested Axios redirect handling; array headers or customized sensitiveHeaders can bypass stripping in1.16.0. Application outbound requests are real, such special options not found.

Same1.x patch, HTTP redirect tests.

Exact prior route example: . → @langchain/community → ibm-cloud-sdk-core → axios → follow-redirects.

- [GHSA-q3jh-wrc6-jgq8](https://github.com/follow-redirects/follow-redirects/security/advisories/GHSA-q3jh-wrc6-jgq8): `>=1.16.0 <1.16.1`, checked `1.16.0`; upstream fixed 1.16.1.
- [GHSA-8r9p-f939-6h3c](https://github.com/follow-redirects/follow-redirects/security/advisories/GHSA-8r9p-f939-6h3c): `>=1.16.0 <1.16.1`, checked `1.16.0`; upstream fixed 1.16.1.

## h3

Classification: browser-feature-unverified. High range entries: 2 → 0. Final versions: 1.15.6.

WalletConnect unstorage chain; SSE field injection needs untrusted event fields; TE.TE requires exposed HTTP server/parser path. No h3 listener in application source.

Same1.x patch.

Exact prior route example: . → @postiz/wallets → @solana/wallet-adapter-walletconnect → @walletconnect/solana-adapter → @walletconnect/universal-provider → @walletconnect/keyvaluestorage → unstorage → h3.

- [GHSA-22cc-p3c6-wpvm](https://github.com/h3js/h3/security/advisories/GHSA-22cc-p3c6-wpvm): `<1.15.6`, checked `1.15.4`; upstream fixed 2.0.1-rc.15, 1.15.6.
- [GHSA-mp2g-9vg9-f4cg](https://github.com/h3js/h3/security/advisories/GHSA-mp2g-9vg9-f4cg): `<=1.15.4`, checked `1.15.4`; upstream fixed 1.15.5.

## hono

Classification: runtime-feature-unverified. High range entries: 4 → 0. Final versions: 4.13.13.

Mastra Hono dependency. JWT/JWK issues require corresponding middleware and algorithm settings; serveStatic needs affected file adapter; CORS issue requires credentials true and omitted/wildcard origin. Nest CORS specifies allowed origins; Postiz MCP mounts existing Nest handler.

Same4.x patch and actual MCP HTTP tests; library-specific endpoints remain feature dependent.

Exact prior route example: . → @mastra/core → hono.

- [GHSA-3vhc-576x-3qv4](https://github.com/honojs/hono/security/advisories/GHSA-3vhc-576x-3qv4): `<4.11.4`, checked `4.11.1`; upstream fixed 4.11.4.
- [GHSA-f67f-6cw9-8mq4](https://github.com/honojs/hono/security/advisories/GHSA-f67f-6cw9-8mq4): `<4.11.4`, checked `4.11.1`; upstream fixed 4.11.4.
- [GHSA-q5qw-h33p-qvwr](https://github.com/honojs/hono/security/advisories/GHSA-q5qw-h33p-qvwr): `<4.12.4`, checked `4.11.1`; upstream fixed 4.12.4.
- [GHSA-88fw-hqm2-52qc](https://github.com/honojs/hono/security/advisories/GHSA-88fw-hqm2-52qc): `<4.12.25`, checked `4.11.1`; upstream fixed 4.12.25.

## http-cache-semantics

Classification: runtime-feature-unverified. High range entries: 1 → 0. Final versions: 4.3.0.

Transloadit got cache chain; requires shared cache and max-stale reuse across users. No shared got cache configured in source.

Same4.x patch.

Exact prior route example: . → transloadit → got → cacheable-request → http-cache-semantics.

- [GHSA-ch52-4w7c-c8xp](https://github.com/kornelski/http-cache-semantics/issues/56): `<=4.2.0`, checked `4.2.0`; upstream fixed None.

## image-size

Classification: platform-build. High range entries: 2 → 2. Final versions: 1.2.1.

Optional React Native Metro CLI brought by React i18next peers. Malformed ICNS/HEIF/JXL must reach this parser; web application uses Sharp and no Metro build is performed in this Linux image.

No1.x fix; move optional RN/Metro graph out of web runtime or update Metro to image-size >=2.0.3 with API compatibility.

Exact prior route example: . → react-i18next → react-native → @react-native/community-cli-plugin → metro → image-size.

- [GHSA-5p2g-fcmc-qvqq](https://web.archive.org/web/20260224152152/https://github.com/image-size/image-size/pull/439): `>=1.2.0 <=2.0.2`, checked `1.2.1`; upstream fixed 2.0.3.
- [GHSA-w3rx-r6r6-pgpr](https://web.archive.org/web/20260224152152/https://github.com/image-size/image-size/pull/439): `>=0.6.3 <=2.0.2`, checked `1.2.1`; upstream fixed 2.0.3.

## immutable

Classification: build. High range entries: 3 → 0. Final versions: 5.1.8.

Sass dependency. Prototype and hash collision/list overflow advisories require attacker-controlled objects/keys/list sizes; app builds repository styles, not uploaded Sass.

Same5.x patch.

Exact prior route example: . → sass → immutable.

- [GHSA-wf6x-7x77-mvgw](https://github.com/immutable-js/immutable-js/security/advisories/GHSA-wf6x-7x77-mvgw): `>=5.0.0 <5.1.5`, checked `5.1.4`; upstream fixed 5.1.5, 4.3.8, 3.8.3.
- [GHSA-v56q-mh7h-f735](https://github.com/immutable-js/immutable-js/security/advisories/GHSA-v56q-mh7h-f735): `>=5.0.0-beta.1 <5.1.8`, checked `5.1.4`; upstream fixed 5.1.8, 4.3.9, 3.8.4.
- [GHSA-xvcm-6775-5m9r](https://github.com/immutable-js/immutable-js/security/advisories/GHSA-xvcm-6775-5m9r): `>=5.0.0-beta.1 <5.1.8`, checked `5.1.4`; upstream fixed 5.1.8, 4.3.9, 3.8.4.

## ip-address

Classification: build-feature-unverified. High range entries: 1 → 0. Final versions: 10.3.1.

Generator proxy socks chain; leading-zero parsing becomes SSRF only if parsed address is used as access control and then resolved differently.

Same10.x patch.

Exact prior route example: . → @neynar/nodejs-sdk → @openapitools/openapi-generator-cli → proxy-agent → socks-proxy-agent → socks → ip-address.

- [GHSA-mwp4-54f8-5fhr](https://github.com/beaugunderson/ip-address/security/advisories/GHSA-mwp4-54f8-5fhr): `<=10.3.0`, checked `10.1.0`; upstream fixed 10.3.1.

## js-cookie

Classification: browser-feature-unverified. High range entries: 1 → 0. Final versions: 3.0.6.

React-email rendering/beautifier chain; assign instance prototype injection requires attacker-supplied options, no direct Postiz js-cookie use found.

Same3.x patch.

Exact prior route example: . → resend → @react-email/render → js-beautify → js-cookie.

- [GHSA-qjx8-664m-686j](https://github.com/js-cookie/js-cookie/security/advisories/GHSA-qjx8-664m-686j): `<=3.0.5`, checked `3.0.5`; upstream fixed 3.0.7.

## js-yaml

Classification: runtime-and-build-feature-unverified. High range entries: 6 → 0. Final versions: 3.15.2, 4.3.2.

Swagger and LangChain YAML loaders; expensive merge/omap requires attacker YAML reaching parser; app Swagger schema derives from source, no uploaded YAML route found.

Patch3.x/4.x independently, preserving loader APIs.

Exact prior route example: . → @langchain/community → js-yaml.

- [GHSA-52cp-r559-cp3m](https://github.com/nodeca/js-yaml/security/advisories/GHSA-52cp-r559-cp3m): `>=4.0.0 <4.3.0`, checked `4.1.1, 4.1.0`; upstream fixed 3.15.0, 4.3.0.
- [GHSA-52cp-r559-cp3m](https://github.com/nodeca/js-yaml/security/advisories/GHSA-52cp-r559-cp3m): `>=3.0.0 <3.15.0`, checked `3.14.2`; upstream fixed 3.15.0, 4.3.0.
- [GHSA-5p4m-2wfm-xmqj](https://github.com/nodeca/js-yaml/security/advisories/GHSA-5p4m-2wfm-xmqj): `>=3.0.0 <3.15.1`, checked `3.14.2`; upstream fixed 4.3.1, 3.15.1.
- [GHSA-5p4m-2wfm-xmqj](https://github.com/nodeca/js-yaml/security/advisories/GHSA-5p4m-2wfm-xmqj): `>=4.0.0 <4.3.1`, checked `4.1.1, 4.1.0`; upstream fixed 4.3.1, 3.15.1.
- [GHSA-2883-xcg3-v3hh](https://github.com/nodeca/js-yaml/security/advisories/GHSA-2883-xcg3-v3hh): `>=3.0.0 <3.15.2`, checked `3.14.2`; upstream fixed 4.3.2, 3.15.2.
- [GHSA-2883-xcg3-v3hh](https://github.com/nodeca/js-yaml/security/advisories/GHSA-2883-xcg3-v3hh): `>=4.0.0 <4.3.2`, checked `4.1.1, 4.1.0`; upstream fixed 4.3.2, 3.15.2.

## jsondiffpatch

Classification: runtime-feature-unverified. High range entries: 1 → 1. Final versions: 0.6.0.

Mastra AI5 dependency; pollution requires patch/jsonpatch.patch on attacker delta/path. No direct application patch API found; AI state internals need separate fixture.

No0.6 backport; update AI/Mastra consumer to jsondiffpatch >=0.7.6 and test streaming state patches. Avoid forcing 0.7 into pinned0.6 consumer.

Exact prior route example: . → @mastra/core → ai → jsondiffpatch.

- [GHSA-j4fx-xxwh-2485](https://github.com/benjamine/jsondiffpatch/commit/381c0125efab49f6f0dbc08317d01d55717672af): `<0.7.6`, checked `0.6.0`; upstream fixed 0.7.6.

## langchain

Classification: runtime-feature-unverified. High range entries: 1 → 0. Final versions: 0.3.37.

Same serialization-to-load lc marker trust boundary as @langchain/core; direct app load() absent, Copilot internals conditional.

Patched0.3 release.

Exact prior route example: . → @copilotkit/runtime → langchain.

- [GHSA-r399-636x-v7f6](https://github.com/langchain-ai/langchainjs/security/advisories/GHSA-r399-636x-v7f6): `<0.3.37`, checked `0.3.36`; upstream fixed 1.2.3, 0.3.37.

## langsmith

Classification: runtime-feature-unverified. High range entries: 1 → 1. Final versions: 0.3.87.

Public pullPrompt/pullPromptCommit fetches remote manifest, then deserializes config including secret references. Application contains no prompt Hub pulls; enabling future AI features needs review.

No0.3 fix; coordinated LangSmith >=0.6 with LangChain callback types and deliberate trusted Hub policy.

Exact prior route example: . → @langchain/community → langsmith.

- [GHSA-3644-q5cj-c5c7](https://github.com/langchain-ai/langsmith-sdk/security/advisories/GHSA-3644-q5cj-c5c7): `<0.6.0`, checked `0.3.87`; upstream fixed 0.8.0, 0.6.0.

## linkify-it

Classification: browser-runtime. High range entries: 2 → 0. Final versions: 5.0.2.

Tiptap/ProseMirror Markdown link parser; malicious text or mailto may cause quadratic scan when parsed.

Same5.x patch.

Exact prior route example: . → @tiptap/pm → prosemirror-markdown → markdown-it → linkify-it.

- [GHSA-22p9-wv53-3rq4](https://github.com/markdown-it/linkify-it/security/advisories/GHSA-22p9-wv53-3rq4): `<=5.0.0`, checked `5.0.0`; upstream fixed 5.0.1.
- [GHSA-v245-v573-v5vm](https://github.com/markdown-it/linkify-it/security/advisories/GHSA-v245-v573-v5vm): `<=5.0.1`, checked `5.0.0`; upstream fixed 5.0.2.

## lodash

Classification: runtime-conditional. High range entries: 1 → 0. Final versions: 4.18.0.

Direct lodash import uses chunk and utility operations. Code injection requires untrusted _.template imports key names; no template() use found in application source.

Patched4.x line.

Exact prior route example: . → lodash.

- [GHSA-r5fr-rjxr-66jc](https://github.com/lodash/lodash/security/advisories/GHSA-r5fr-rjxr-66jc): `>=4.0.0 <=4.17.23`, checked `4.17.21`; upstream fixed 4.18.0.

## lodash-es

Classification: browser-runtime-conditional. High range entries: 1 → 0. Final versions: 4.18.0.

Polotno/react-color utility dependency; template imports injection needs attacker controlled template options, no app template use found.

Patched4.x line.

Exact prior route example: . → polotno → react-color → lodash-es.

- [GHSA-r5fr-rjxr-66jc](https://github.com/lodash/lodash/security/advisories/GHSA-r5fr-rjxr-66jc): `>=4.0.0 <=4.17.23`, checked `4.17.22`; upstream fixed 4.18.0.

## markdown-it

Classification: browser-runtime. High range entries: 2 → 0. Final versions: 14.3.3.

ProseMirror Markdown parsing; crafted multiline link definitions/smartquotes cause quadratic rendering if those parsers/options run on user text.

Same14.x patch; production browser build checks consumer compatibility.

Exact prior route example: . → @tiptap/pm → prosemirror-markdown → markdown-it.

- [GHSA-gfr2-rv44-r23c](https://github.com/markdown-it/markdown-it/security/advisories/GHSA-gfr2-rv44-r23c): `>=14.1.0 <14.3.3`, checked `14.1.0`; upstream fixed 14.3.3, 15.0.3.
- [GHSA-r7fv-28h4-cvq7](https://github.com/markdown-it/markdown-it/security/advisories/GHSA-r7fv-28h4-cvq7): `<14.3.2`, checked `14.1.0`; upstream fixed 15.0.2, 14.3.2.

## minimatch

Classification: build-and-feature-unverified. High range entries: 9 → 0. Final versions: 10.2.5, 3.1.4, 8.0.6, 9.0.7.

Build glob consumers; attacks require hostile wildcard/extglob pattern rather than merely untrusted path input.

Separate3/8/9 compatible patches.

Exact prior route example: . → @nestjs/cli → fork-ts-checker-webpack-plugin → minimatch.

- [GHSA-3ppc-4f35-3m26](https://github.com/isaacs/minimatch/security/advisories/GHSA-3ppc-4f35-3m26): `<3.1.3`, checked `3.1.2`; upstream fixed 10.2.1, 9.0.6, 8.0.5, 7.4.7, 6.2.1, 5.1.7, 4.2.4, 3.1.3.
- [GHSA-3ppc-4f35-3m26](https://github.com/isaacs/minimatch/security/advisories/GHSA-3ppc-4f35-3m26): `>=8.0.0 <8.0.5`, checked `8.0.4`; upstream fixed 10.2.1, 9.0.6, 8.0.5, 7.4.7, 6.2.1, 5.1.7, 4.2.4, 3.1.3.
- [GHSA-3ppc-4f35-3m26](https://github.com/isaacs/minimatch/security/advisories/GHSA-3ppc-4f35-3m26): `>=9.0.0 <9.0.6`, checked `9.0.5, 9.0.1`; upstream fixed 10.2.1, 9.0.6, 8.0.5, 7.4.7, 6.2.1, 5.1.7, 4.2.4, 3.1.3.
- [GHSA-7r86-cg39-jmmj](https://github.com/isaacs/minimatch/security/advisories/GHSA-7r86-cg39-jmmj): `<3.1.3`, checked `3.1.2`; upstream fixed 10.2.3, 9.0.7, 8.0.6, 7.4.8, 6.2.2, 5.1.8, 4.2.5, 3.1.3.
- [GHSA-7r86-cg39-jmmj](https://github.com/isaacs/minimatch/security/advisories/GHSA-7r86-cg39-jmmj): `>=8.0.0 <8.0.6`, checked `8.0.4`; upstream fixed 10.2.3, 9.0.7, 8.0.6, 7.4.8, 6.2.2, 5.1.8, 4.2.5, 3.1.3.
- [GHSA-7r86-cg39-jmmj](https://github.com/isaacs/minimatch/security/advisories/GHSA-7r86-cg39-jmmj): `>=9.0.0 <9.0.7`, checked `9.0.5, 9.0.1`; upstream fixed 10.2.3, 9.0.7, 8.0.6, 7.4.8, 6.2.2, 5.1.8, 4.2.5, 3.1.3.
- [GHSA-23c5-xmqv-rm74](https://github.com/isaacs/minimatch/security/advisories/GHSA-23c5-xmqv-rm74): `<3.1.4`, checked `3.1.2`; upstream fixed 10.2.3, 9.0.7, 8.0.6, 7.4.8, 6.2.2, 5.1.8, 4.2.5, 3.1.4.
- [GHSA-23c5-xmqv-rm74](https://github.com/isaacs/minimatch/security/advisories/GHSA-23c5-xmqv-rm74): `>=8.0.0 <8.0.6`, checked `8.0.4`; upstream fixed 10.2.3, 9.0.7, 8.0.6, 7.4.8, 6.2.2, 5.1.8, 4.2.5, 3.1.4.
- [GHSA-23c5-xmqv-rm74](https://github.com/isaacs/minimatch/security/advisories/GHSA-23c5-xmqv-rm74): `>=9.0.0 <9.0.7`, checked `9.0.5, 9.0.1`; upstream fixed 10.2.3, 9.0.7, 8.0.6, 7.4.8, 6.2.2, 5.1.8, 4.2.5, 3.1.4.

## multer

Classification: runtime. High range entries: 6 → 0. Final versions: 2.5.0.

Authenticated media upload-server/upload-simple and public API-key upload use Nest FileInterceptor; parser attacks occur before per-file validation. Both direct1.x and Nest nested2.0.2 are affected; authentication reduces attacker set but is not dev-only.

Upgrade both to2.5; cap metadata to32 fields, depth32, array index1024, bound binary parsing at the existing1GiB video ceiling and one file, and map new MulterError codes to controlled400. Real Nest multipart+storage tests, malformed body/index handling and listener survival. Binary upload size policy remains application-specific; this does not claim unrestricted multipart buffering is safe.

Exact prior route example: . → multer.

- [GHSA-xf7r-hgr6-v32p](https://github.com/expressjs/multer/security/advisories/GHSA-xf7r-hgr6-v32p): `<2.1.0`, checked `1.4.5-lts.2, 2.0.2`; upstream fixed 2.1.0.
- [GHSA-v52c-386h-88mc](https://github.com/expressjs/multer/security/advisories/GHSA-v52c-386h-88mc): `<2.1.0`, checked `1.4.5-lts.2, 2.0.2`; upstream fixed 2.1.0.
- [GHSA-5528-5vmv-3xc2](https://github.com/expressjs/multer/security/advisories/GHSA-5528-5vmv-3xc2): `<2.1.1`, checked `1.4.5-lts.2, 2.0.2`; upstream fixed 2.1.1.
- [GHSA-72gw-mp4g-v24j](https://github.com/expressjs/multer/security/advisories/GHSA-72gw-mp4g-v24j): `>=1.0.0 <2.2.0`, checked `1.4.5-lts.2, 2.0.2`; upstream fixed 2.2.0, 3.0.0-alpha.2.
- [GHSA-wc9g-mqfw-jrwm](https://github.com/expressjs/multer/security/advisories/GHSA-wc9g-mqfw-jrwm): `<2.3.0`, checked `1.4.5-lts.2, 2.0.2`; upstream fixed 2.3.0.
- [GHSA-535w-7cp7-47q4](https://github.com/expressjs/multer/security/advisories/GHSA-535w-7cp7-47q4): `<2.3.0`, checked `1.4.5-lts.2, 2.0.2`; upstream fixed 2.3.0.

## music-metadata

Classification: runtime-feature-conditional. High range entries: 1 → 1. Final versions: 7.14.0.

images.slides.ts uses parseBuffer with explicit audio/mpeg on speech bytes from configured ElevenLabs video feature. ASF issue requires ASF Header Extension with zero size; forced MP3 parser does not establish that path. Feature also needs ElevenLabs, Transloadit, OpenAI and Fal configuration, not inspected.

No7.x/CJS fixed line; migrate video helper to async ESM-compatible music-metadata >=11.12.3 and test MP3 duration plus safe ASF rejection in a bounded child process.

Exact prior route example: . → music-metadata.

- [GHSA-v6c2-xwv6-8xf7](https://github.com/Borewit/music-metadata/security/advisories/GHSA-v6c2-xwv6-8xf7): `<=11.12.1`, checked `7.14.0`; upstream fixed 11.12.3.

## nanoid

Classification: browser-and-runtime-conditional. High range entries: 5 → 0. Final versions: 3.3.18, 5.1.16.

Uppy IDs and transitive generators; non-secure/custom generators need invalid negative/zero/overflow size, not ordinary default ID generation.

Patched3.x/5.x separately.

Exact prior route example: . → @uppy/core → nanoid.

- [GHSA-28wg-ghj8-5hjv](https://github.com/ai/nanoid/commit/6ccc67bbaba71d3d77a21d9b636f4171a268ce49): `>=4.0.0 <5.1.16`, checked `5.1.6`; upstream fixed 3.3.16, 5.1.16.
- [GHSA-28wg-ghj8-5hjv](https://github.com/ai/nanoid/commit/6ccc67bbaba71d3d77a21d9b636f4171a268ce49): `<3.3.16`, checked `3.3.11`; upstream fixed 3.3.16, 5.1.16.
- [GHSA-2v37-7h3g-55p8](https://github.com/ai/nanoid/commit/cb3626d0f3342fdf179cd425fd9c4fbb92c7d0e7): `<3.3.18`, checked `3.3.11`; upstream fixed 5.1.6, 3.3.18.
- [GHSA-xwg4-73v4-xw9w](https://github.com/ai/nanoid/security/advisories/GHSA-xwg4-73v4-xw9w): `>=4.0.0 <5.1.11`, checked `5.1.6`; upstream fixed 3.3.12, 5.1.11.
- [GHSA-xwg4-73v4-xw9w](https://github.com/ai/nanoid/security/advisories/GHSA-xwg4-73v4-xw9w): `<3.3.12`, checked `3.3.11`; upstream fixed 3.3.12, 5.1.11.

## node-forge

Classification: runtime-feature-conditional. High range entries: 5 → 1. Final versions: 1.4.0.

Google auth google-p12-pem path converts P12 credentials to PEM; exposed signature verification and arbitrary cert chain verification are different prerequisites. App uses OAuth, no direct forge verification call found. Live account/key format uninspected.

Upgrade1.4 removes several findings; nested DigestAlgorithm issue has no fixed release listed through1.4.0. Remove legacy P12 path via supported Google auth updates or upstream complete fix; do not claim all Forge advisories fixed.

Exact prior route example: . → @copilotkit/runtime → @langchain/google-gauth → google-auth-library → gtoken → google-p12-pem → node-forge.

- [GHSA-2328-f5f3-gj25](https://github.com/digitalbazaar/forge/security/advisories/GHSA-2328-f5f3-gj25): `<=1.3.3`, checked `1.3.3`; upstream fixed 1.4.0.
- [GHSA-q67f-28xg-22rw](https://github.com/digitalbazaar/forge/security/advisories/GHSA-q67f-28xg-22rw): `<1.4.0`, checked `1.3.3`; upstream fixed 1.4.0.
- [GHSA-5m6q-g25r-mvwx](https://github.com/digitalbazaar/forge/security/advisories/GHSA-5m6q-g25r-mvwx): `<1.4.0`, checked `1.3.3`; upstream fixed 1.4.0.
- [GHSA-ppp5-5v6c-4jwp](https://github.com/digitalbazaar/forge/security/advisories/GHSA-cfm4-qjh2-4765): `<1.4.0`, checked `1.3.3`; upstream fixed 1.4.0.
- [GHSA-86w9-cpqp-85rv](https://github.com/digitalbazaar/forge/issues/1149): `<=1.4.0`, checked `1.3.3`; upstream fixed None.

## nodemailer

Classification: runtime-feature-conditional. High range entries: 4 → 4. Final versions: 7.0.11.

node.mailer.provider.ts SMTP createTransport uses host/port/secure and user/pass, sends controlled HTML/from and application recipient. raw bypass needs attacker message-level raw options (not passed); OAuth TLS issue needs OAuth2 token fetch (not configured); address parser DoS needs hostile/large recipient/from value. EMAIL_PROVIDER and live SMTP settings uninspected.

No7.x backport; stage Nodemailer >=10.0.6 plus matching types, test MIME/address parsing/SMTP auth+TLS against local sink, then owner SMTP acceptance. Do not force major10 without those checks.

Exact prior route example: . → nodemailer.

- [GHSA-p6gq-j5cr-w38f](https://github.com/nodemailer/nodemailer/security/advisories/GHSA-p6gq-j5cr-w38f): `<=9.0.0`, checked `7.0.11`; upstream fixed 9.0.1.
- [GHSA-2x7j-588g-ccc2](https://github.com/nodemailer/nodemailer/security/advisories/GHSA-2x7j-588g-ccc2): `<9.1.0`, checked `7.0.11`; upstream fixed 9.1.0.
- [GHSA-r7g4-qg5f-qqm2](https://github.com/nodemailer/nodemailer/security/advisories/GHSA-r7g4-qg5f-qqm2): `<=8.0.7`, checked `7.0.11`; upstream fixed 8.0.8.
- [GHSA-v53p-9fqp-m79j](https://github.com/nodemailer/nodemailer/security/advisories/GHSA-v53p-9fqp-m79j): `<=10.0.5`, checked `7.0.11`; upstream fixed 10.0.6.

## path-to-regexp

Classification: runtime-conditional. High range entries: 2 → 0. Final versions: 0.1.13, 3.3.0, 8.4.0.

Express4 and MCP Express5 routing; ReDoS requires multi-parameter route patterns or sequential optional groups. Routes are source-defined; attacker path alone is not all prerequisites.

Patch0.1/8 independently preserving Express router contracts.

Exact prior route example: . → @modelcontextprotocol/sdk → express → router → path-to-regexp.

- [GHSA-j3q9-mxjg-w52f](https://github.com/pillarjs/path-to-regexp/security/advisories/GHSA-j3q9-mxjg-w52f): `>=8.0.0 <8.4.0`, checked `8.3.0`; upstream fixed 8.4.0.
- [GHSA-37ch-88jc-xwx2](https://github.com/pillarjs/path-to-regexp/security/advisories/GHSA-37ch-88jc-xwx2): `<0.1.13`, checked `0.1.12`; upstream fixed 0.1.13.

## picomatch

Classification: build-and-feature-unverified. High range entries: 2 → 0. Final versions: 2.3.2, 4.0.4.

Tailwind/glob consumers; hostile extglob quantifier pattern is required, not fixed app build globs.

Patch2/4 separately.

Exact prior route example: . → tailwindcss → micromatch → picomatch.

- [GHSA-c2c7-rcm5-vvqj](https://github.com/micromatch/picomatch/security/advisories/GHSA-c2c7-rcm5-vvqj): `<2.3.2`, checked `2.3.1`; upstream fixed 4.0.4, 3.0.2, 2.3.2.
- [GHSA-c2c7-rcm5-vvqj](https://github.com/micromatch/picomatch/security/advisories/GHSA-c2c7-rcm5-vvqj): `>=4.0.0 <4.0.4`, checked `4.0.1, 4.0.3`; upstream fixed 4.0.4, 3.0.2, 2.3.2.

## postcss

Classification: build. High range entries: 2 → 0. Final versions: 8.5.18.

Next/Tailwind process styles with previous sourcemap comments; arbitrary file read requires attacker CSS/sourceMappingURL during build. No uploaded CSS build route found.

Same8.x patch, actual Alpine full frontend build.

Exact prior route example: . → @tailwindcss/postcss → postcss.

- [GHSA-6g55-p6wh-862q](https://github.com/postcss/postcss/security/advisories/GHSA-6g55-p6wh-862q): `<=8.5.11`, checked `8.5.6, 8.4.31`; upstream fixed 8.5.12.
- [GHSA-r28c-9q8g-f849](https://github.com/postcss/postcss/security/advisories/GHSA-r28c-9q8g-f849): `<=8.5.17`, checked `8.5.6, 8.4.31`; upstream fixed 8.5.18.

## preact

Classification: browser-runtime. High range entries: 1 → 0. Final versions: 10.28.2.

Uppy compressor UI; JSON VNode injection requires attacker JSON delivered to rendering as VNode in vulnerable version.

Same10.x patch.

Exact prior route example: . → @uppy/compressor → preact.

- [GHSA-36hm-qxxp-pg3m](https://github.com/preactjs/preact/security/advisories/GHSA-36hm-qxxp-pg3m): `>=10.28.0 <10.28.2`, checked `10.28.0`; upstream fixed 10.26.10, 10.27.3, 10.28.2.

## prosemirror-view

Classification: browser-runtime. High range entries: 1 → 0. Final versions: 1.42.3.

Editor paste handling can render hostile rich-text markup; source uses Tiptap/ProseMirror editor.

Same1.x patch; actual extension/editor hydration fixture.

Exact prior route example: . → @tiptap/pm → prosemirror-view.

- [GHSA-c8x8-7fp4-3x9w](https://github.com/ProseMirror/prosemirror-view/security/advisories/GHSA-c8x8-7fp4-3x9w): `<1.42.3`, checked `1.41.4`; upstream fixed 1.42.3.

## rollup

Classification: build. High range entries: 1 → 0. Final versions: 4.59.0.

Mastra deployer bundles code; path traversal needs malicious module/input file names during bundling. User posts do not initiate a deployment bundle in inspected source.

Same4.x patch.

Exact prior route example: . → mastra → @mastra/deployer → rollup.

- [GHSA-mw96-cpmx-2vgc](https://github.com/rollup/rollup/security/advisories/GHSA-mw96-cpmx-2vgc): `>=4.0.0 <4.59.0`, checked `4.50.2`; upstream fixed 2.80.0, 3.30.0, 4.59.0.

## serialize-javascript

Classification: build. High range entries: 1 → 1. Final versions: 6.0.2.

Nest webpack Terser cache serialization; injection requires attacker RegExp.flags or Date.toISOString override passed to serialize and generated code evaluation, not ordinary JSON text.

No6.x fix; update webpack/Terser chain to serializer >=7.0.3 and verify Node22 build compatibility instead of blindly forcing major7.

Exact prior route example: . → @nestjs/cli → webpack → terser-webpack-plugin → serialize-javascript.

- [GHSA-5c6j-r48x-rmvq](https://github.com/yahoo/serialize-javascript/security/advisories/GHSA-5c6j-r48x-rmvq): `<=7.0.2`, checked `6.0.2`; upstream fixed 7.0.3.

## socket.io-parser

Classification: browser-feature-unverified. High range entries: 2 → 0. Final versions: 4.2.7.

Torus wallet adapter socket.io-client; malicious Socket.IO binary attachment headers must reach connected wallet transport.

Same4.x patch.

Exact prior route example: . → @postiz/wallets → @solana/wallet-adapter-torus → @toruslabs/solana-embed → @toruslabs/base-controllers → @toruslabs/broadcast-channel → socket.io-client → socket.io-parser.

- [GHSA-2m8v-j782-fhvr](https://github.com/socketio/socket.io/security/advisories/GHSA-2m8v-j782-fhvr): `>=4.0.0 <4.2.7`, checked `4.2.4`; upstream fixed 4.2.7, 3.4.5, 3.3.6.
- [GHSA-677m-j7p3-52f9](https://github.com/socketio/socket.io/security/advisories/GHSA-677m-j7p3-52f9): `>=4.0.0 <4.2.6`, checked `4.2.4`; upstream fixed 3.3.5, 3.4.4, 4.2.6.

## source-map-js

Classification: build. High range entries: 1 → 0. Final versions: 1.2.2.

Sass source maps; malformed indexed section offset must reach source-map consumer, not generated source maps alone.

Same1.x patch.

Exact prior route example: . → sass → source-map-js.

- [GHSA-68fv-2mgg-jv7q](https://github.com/7rulnik/source-map-js/issues/76): `>=1.0.0 <1.2.2`, checked `1.2.1`; upstream fixed 1.2.2.

## tmp

Classification: build. High range entries: 1 → 1. Final versions: 0.0.33.

Nest CLI/inquirer/external-editor; traversal requires attacker prefix/postfix/dir option to temp helper, not standard fixed editor path.

No0.0 backport; update inquirer/external-editor to tmp >=0.2.6 with callback/cleanup API checks.

Exact prior route example: . → @nestjs/cli → inquirer → external-editor → tmp.

- [GHSA-ph9p-34f9-6g65](https://github.com/raszi/node-tmp/security/advisories/GHSA-ph9p-34f9-6g65): `<0.2.6`, checked `0.0.33`; upstream fixed 0.2.6.

## ws

Classification: runtime-and-browser. High range entries: 2 → 0. Final versions: 7.5.11, 8.21.0.

Direct ws and wallet/websocket consumers; memory DoS requires malicious peer sending tiny fragments without restrictive receiver limits. No direct application ws listener found; transitive clients remain possible.

Patch7/8 independently; final lock keeps older major compatibility.

Exact prior route example: . → ws.

- [GHSA-96hv-2xvq-fx4p](https://github.com/websockets/ws/security/advisories/GHSA-96hv-2xvq-fx4p): `>=8.0.0 <8.21.0`, checked `8.18.3, 8.18.0, 8.17.1`; upstream fixed 5.2.5, 6.2.4, 7.5.11, 8.21.0.
- [GHSA-96hv-2xvq-fx4p](https://github.com/websockets/ws/security/advisories/GHSA-96hv-2xvq-fx4p): `>=7.0.0 <7.5.11`, checked `7.5.10`; upstream fixed 5.2.5, 6.2.4, 7.5.11, 8.21.0.

