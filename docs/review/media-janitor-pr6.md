# Peer Review Synthesis — media-janitor PR #6

**PR**: https://github.com/ProfSynapse/postiz-app/pull/6
**Branch**: `feature/media-janitor`
**Head**: d2611a1a (TEST phase) on top of e3b5385a / b81dbbc2 / b93e9824 / ac6b568b / c1d531b2 / 2bbe5455
**Reviewers**: architect, test-engineer, backend-coder, database-engineer, security-engineer (5 in parallel)
**Date**: 2026-05-21

---

## Headline

**5/5 reviewers PROCEED to merge — subject to fixing 2 BLOCKING code findings and 1 BLOCKING-Doc runbook addition.**

- **0** BLOCKING findings from architect, database-engineer, security-engineer (independent angles)
- **1** BLOCKING from backend-coder (self-found, invariant #6 violation)
- **1** BLOCKING from test-engineer (testability/discoverability — git binary-classification of a spec file)
- **1** BLOCKING-Doc from database-engineer (pre-deploy index-name collision verification SQL missing from runbook)
- **11** MINOR findings (some duplicates between reviewers — deduplicated below)
- **10** FUTURE / NIT items
- Verdicts: APPROVE-with-Minor (database-engineer), ACCEPT WITH MINOR FINDINGS (architect), PROCEED (security-engineer), 1 BLOCKING + 3 MINOR + 5 FUTURE (backend-coder), 1 BLOCKING + 3 MINOR + 2 FUTURE (test-engineer)

---

## BLOCKING findings (must fix before merge)

| ID | Title | Reviewer | File | Fix shape |
|----|-------|----------|------|-----------|
| **B1-backend** | `MediaJanitorService` constructor eagerly calls `UploadFactory.createStorage()` — violates invariant #6 (janitor INERT when `STORAGE_PROVIDER !== 'local'`); can crash cron boot in misconfigured cloudflare env (S3Client instantiated at module init) | backend-coder | `libraries/nestjs-libraries/src/database/prisma/media/media.janitor.service.ts:77` | **Lazy getter** (Option B per backend-coder): private `_uploadProvider` + getter that constructs on first access. Drop the constructor assignment. First call at `attemptUnlink` line 311 is AFTER the `STORAGE_PROVIDER === 'local'` guard has admitted us. Minimal diff. |
| **B1-test** | Literal NUL bytes (`\x00`) in `path.confinement.spec.ts` (lines 198, 348) cause git to classify the 363-line file as **binary**. `git diff --numstat` reports `-`; `gh pr view 6 --json files` shows additions:0/deletions:0; the spec is invisible in GitHub PR UI and skipped by grep tooling. CI still executes it (jest matches by filename), so this is review-UX/discoverability not runtime — but it disqualifies the spec from PR-review feedback. | test-engineer | `libraries/nestjs-libraries/src/upload/path.confinement.spec.ts:198,348` | Replace raw NUL fixtures with `String.fromCharCode(0)` template literal: `const NUL = String.fromCharCode(0); const evil = \`/2025/01/02/evil${NUL}.png\`;`. Source file stays UTF-8; test still asserts NUL-byte rejection. Verify with `file <path>` (should say ASCII/UTF-8) and `git diff --numstat` (should show numeric counts). |
| **H-1-db** (BLOCKING-Doc) | Pre-deploy runbook lacks a verification SQL block to detect prod index-name collisions BEFORE `prisma db push`. Two new indexes (`Media_deletedAt_idx`, `Post_state_publishDate_deletedAt_idx`) — if any collide with a pre-existing prod index of the same name but different column definition, the migration will fail mid-deploy. | database-engineer (amendment) | `docs/runbooks/media-janitor.md` | Add a 6-line SQL block to the runbook's pre-deploy section: `SELECT indexname, indexdef FROM pg_indexes WHERE indexname IN ('Media_deletedAt_idx', 'Post_state_publishDate_deletedAt_idx');` — expected 0 rows. Non-zero rows BLOCK deploy until investigated. |

**Action**: Auto-dispatched to fixers in parallel. See `## Remediation dispatch` below.

---

## MINOR findings (user-gate question pending)

(Architect M1 + Backend M2 deduplicated — same finding, different reviewers caught it.)

| ID | Title | Reviewer | File / Location | Fix shape |
|----|-------|---------|-----------------|-----------|
| **M-doc-resolver** | `MediaPathResolver` doc-comment lies: claims registered in `UploadModule (@Global)` per architect §2, but actually registered in `CronModule.providers`. Will mislead the next reader. | architect M1, backend M2 (dupe) | `libraries/.../media/media.path.resolver.ts:28-29` | 2-line doc rewrite: "Registered as a provider in CronModule (apps/cron/src/cron.module.ts). Future refactor to UploadModule is tracked as Future F-1." |
| **M-exhaustive** | `handleOutcome` switch lacks exhaustiveness check. If repository adds a new `HardDeleteRowResult` variant, switch silently falls through. | backend M1 | `media.janitor.service.ts:232-268` | Add `default: { const _exhaustive: never = outcome; throw new Error(\`Unknown outcome: ${_exhaustive}\`); }` |
| **M-sentry** | Missing `Sentry.captureException` in repository per-row catch — failures are logged but not telemetered to Sentry. | backend M3 | `media.janitor.repository.ts:277-283` | Add `Sentry.captureException(err, { extra: { mediaId } })` inside the catch. Defer to user — may be intentional noise-control. |
| **M-scenario-w** | SCENARIO-W: `void ageDays` in `hardDeleteBatch` is math-sound today but cements a latent footgun. If a future refactor changes soft-delete-stamp semantics (e.g., stamps `NOW()` instead of `NOW() - ageDays`), the hard-delete floor silently shifts by `ageDays` days. Mitigated by inline comment + integration test + invariant #4 + FOR UPDATE re-check. | architect M2 | `media.janitor.repository.ts:162-168` | (a) Arch-doc annotation noting floor depends on stamp semantics, OR (b) typed assertion `assertSoftDeleteStampSemantics(...)` that grep-audits the soft-delete UPDATE expression. Optional belt-and-braces. |
| **M-localstorage-spec** | `LocalStorage.removeFile` re-assertion wrapper has no dedicated spec — only the underlying `verifyAbsolutePath` is tested in isolation. Defense-in-depth wiring at storage layer is not pinned. | test M1 | `libraries/.../upload/local.storage.ts:93-99` (no spec) | Add ~30-line unit spec stubbing `fs.unlink` to assert (a) `PathConfinementError` propagates without unlinking, (b) clean path triggers unlink. |
| **M-e2e-wiring** | No spec exercises `MediaJanitorService + real MediaPathResolver + real LocalStorage` together. Unit tests mock `resolveForDelete`; integration tests touch only the repository. Wiring-regression seam is undefended. | test M2 | (cross-cutting) | Add a small e2e spec (mock fs.unlink, exercise the full resolver→storage stack on representative shapes). |
| **M-test-dburl-comment** | Workflow `unit` job sets `TEST_DATABASE_URL: ''` — redundant given `--selectProjects` + `--testPathPattern` already exclude integration specs. Belt-and-braces but adds confusion. | test M3 | `.github/workflows/media-janitor-tests.yml` | One-line comment for clarity (or remove the redundant env var). |
| **M-rc3-race** | RC-3 race (concurrent grace-expire vs resurrect on same id) not explicitly tested. Postgres EvalPlanQual + REPEATABLE READ + FOR UPDATE makes it correct by construction, runbook §R15 forbids multi-replica deploy, but a regression-pin would be valuable. | database-engineer M-1 | `__integration__/two-phase.integration.spec.ts` | (a) Add concurrent-tick integration test driving two REPEATABLE READ txns serializing on FOR UPDATE asserting `skipped-race` on loser, OR (b) add a code comment in `processHardDeleteRow` citing Postgres EvalPlanQual as the race-safety mechanism. |
| **M-explain-conservative** | EXPLAIN assertion only checks Media is not Seq-Scanned; the dominant cost is the `image LIKE '%<m.id>%'` residual against `Post`, which at production volumes could become a hot path. Composite `(state, publishDate, deletedAt)` index pre-narrows but does NOT eliminate the LIKE residual. | database-engineer M-2 | `__integration__/candidate-query.integration.spec.ts` | Add a follow-up ticket / runbook note to MONITOR candidate-query latency at production data volumes after the first dry-run cycle. Long-term fix (deferred): normalized `post_media` join table. |
| **M-toctou-fk-recheck** ⚠ | Phase-1 soft-delete TOCTOU: `findSoftDeleteCandidates` runs OUTSIDE any transaction. A `User.pictureId = mediaId` set between candidate selection and `markSoftDeleted UPDATE` results in a referenced row being soft-deleted (deletedAt stamped) for up to `graceDays`. App-level read paths filtering on `deletedAt IS NULL` treat the User's profile picture as missing for up to 7 days. **Phase-2 hard-delete IS fail-safe** (FK NO ACTION aborts the txn), so this is a logical-consistency window, not data-loss. Architect's "HARD-BLOCK" claim conflated soft-delete-stamp-while-referenced (this window) with hard-delete-while-referenced (correctly fail-safe). | security-engineer S-MINOR-1 | `media.janitor.repository.ts:75-141` | Add `WHERE NOT EXISTS (SELECT 1 FROM User u WHERE u.pictureId = Media.id) AND NOT EXISTS (SELECT 1 FROM SocialMediaAgency a WHERE a.logoId = Media.id)` to the `markSoftDeleted` UPDATE. Re-asserts FK predicate at UPDATE time. One extra subquery per stamped row eliminates the up-to-graceDays inconsistency window. **Recommend landing in this PR — tightens the model cleanly.** |
| **M-forbidden-roots** | `FORBIDDEN_ROOTS` contains only 12 well-known system roots. Missing: `/opt /srv /boot /lib /lib32 /lib64 /mnt /media /run` and any custom mounts. `UPLOAD_DIRECTORY=/opt` would pass the gate, giving operator a false sense of coverage. Not exploitable via DB write — operator-misconfig protection scope. | security-engineer S-MINOR-2 | `apps/cron/src/tasks/media.janitor.ts:44-57,180-187` | (a) Doc FORBIDDEN_ROOTS as a non-exhaustive sample + runbook check that UPLOAD_DIRECTORY is a dedicated volume mount, OR (b) flip to ALLOWLIST model (stronger but bigger lift). |

---

## FUTURE / NIT items (out of scope for this PR)

| ID | Title | Reviewer |
|----|-------|----------|
| F-resolver-placement | Refactor `MediaPathResolver` registration to `UploadModule (@Global)` so any future non-cron consumer (admin operations, etc.) gets it for free | architect F1 |
| F-arch-doc-erratum | Arch-doc §5 LocalStorage pseudocode shows `confineAndVerify(filePath, uploadRoot)` but step-2 shape-classification would reject an absolute path — backend correctly split into `confineAndVerify` + `verifyAbsolutePath`. Doc-fix erratum architect will author. | architect F2 |
| F-bytesreclaimed | Naming nuance in dryRun summaries — `bytesReclaimed` reports estimated bytes for dryRun; consider `bytesEstimated` vs `bytesActuallyReclaimed` distinction. | architect F3 |
| F-explain-pg-version | EXPLAIN regex `/Seq Scan on "Media"\|Seq Scan on Media\b/` is sound for PG 12-17 (formatting stable). Document the PG-version coupling in workflow comment (workflow pins postgres:15). | test F1 |
| F-post-image-jsonb | `post.image` parser SQL-LIKE / JS-semantic divergence is intentional today (safety-side false-positives). Watch-item for eventual `Post.image → jsonb` migration (Risk Register R1.5). | test F2 |
| F-backend-nits-1..5 | Backend-coder identified 5 future/nit items spanning naming, future ergonomics, and small refactors that survive the deliverable in clean form. | backend-coder F1–F5 |
| S-FUTURE-1 | If `Media.id` ever becomes attacker-controlled, the `LIKE '%"<m.id>"%'` pattern is fragile (regex-meta-character DoS, not exfil). UUIDs are non-attacker-controlled today. | security-engineer | 
| S-INFO-1 | Future-proof `PathConfinementError.input` by marking it `private`/`non-loggable` so a future logger refactor cannot accidentally include the offending path in error reports. | security-engineer |

---

## Verifications confirmed (no action)

- All 10 architect invariants honored by code-shape audit (architect)
- 5 architect-locked `HardDeleteRowResult` variants match service `handleOutcome` switch byte-for-byte (backend)
- DryRunRollback sentinel pattern correctly causes Prisma ROLLBACK while propagating in-memory outcome (backend)
- All 5 providers registered in `CronModule` with correct DI dependency chain (backend)
- Post-commit unlink loop has no missing awaits / unhandled rejections; correct ENOENT/PathConfinementError/other classification (backend)
- Resolver's 3-shape `ResolveResult` discriminated union used exhaustively at the only call site via TS control-flow narrowing (backend)
- RC-1 vs RC-4 counter-test pair is correctly asymmetric (test-engineer, verified by inspection)
- `describeIfDb` auto-skip pattern in CI: unit job runs without DB, integration job provisions postgres:15 with healthcheck (test-engineer)
- All 10 architect invariants have spec-level assertions (test-engineer)
- 8 ConfinementReason bypass attempts (symlink-after-realpath, %-encoded, double-encoded, UNC, NUL byte, modernPrefix substring, legacy-relative absolute escape, suffix-after-prefix `..`) all REJECT correctly (security-engineer)
- DRY_RUN strict literal-'false' parsing is fail-safe across casing/whitespace/truthy variants (security-engineer)
- STORAGE_PROVIDER kill-switch parsing is fail-safe across undefined/empty/casing/whitespace (security-engineer)
- Resurrection-WARN and Sentry capture do NOT leak Media.path or user IDs (security-engineer)
- Phase-2 hard-delete IS fail-safe under hostile FK race via REPEATABLE READ + FOR UPDATE + Postgres NO ACTION (security-engineer)
- Schema delta is minimal+additive (2 @@index, no column delta); names align with Prisma conventions for runbook `CREATE INDEX CONCURRENTLY` (database-engineer)
- Repository contract correctly consumed by `MediaJanitorService`: dryRun propagated, skipped-race no-op, all 3 resurrect outcomes routed to non-unlink branch (database-engineer)
- REPEATABLE READ + FOR UPDATE + intra-txn re-check is the right isolation choice; Postgres EvalPlanQual handles concurrent-grace-expire-vs-resurrect race correctly (database-engineer)

---

## Out-of-scope (separate tickets, per user constraint)

- **SR-3** `/save-media` write-side path traversal (HIGH) — separate ticket
- **SR-4** Read-side `/api/uploads/[[...path]]` path traversal (HIGH) — separate ticket

---

## Remediation dispatch

| Item | Fixer | Rationale |
|------|-------|-----------|
| B1-backend | backend-coder (Reviewer-to-Fixer Reuse) | Most context on the fix; recommended Option B (lazy-getter pattern). |
| B1-test | test-engineer (Reviewer-to-Fixer Reuse) | Authored the spec; cleanest hand to apply `String.fromCharCode(0)` rewrite. |
| H-1-db | database-engineer (Reviewer-to-Fixer Reuse) | Authored the runbook amendment; knows exact SQL + column-definition assertion. Runbook is docs, no app code touched. |

All three are independent (different files) — dispatched concurrently.

---

## User-gate question (pending)

After BLOCKING fixes land and verify-only re-review passes, the user will be asked whether to review the 11 MINOR findings + 10 FUTURE items, with per-recommendation gate questions for each MINOR.

Recommended for in-PR landing (high signal, low cost):
- **M-toctou-fk-recheck** (security) — tightens the model cleanly
- **M-doc-resolver** (architect/backend dupe) — 2-line doc fix
- **M-exhaustive** (backend) — future-proofing future variants

Recommended for follow-up tickets:
- M-localstorage-spec, M-e2e-wiring (test coverage expansion)
- M-rc3-race (regression-pin test)
- M-explain-conservative (production monitoring)
- M-scenario-w (latent footgun, mitigated today)
- M-forbidden-roots (operator-misconfig protection)
- M-sentry (defer to user — may be intentional noise control)
- M-test-dburl-comment (one-line clarity)
