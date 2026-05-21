# Architecture: Media-Asset Janitor

> Distilled from `docs/plans/media-janitor-plan.md` on 2026-05-21. This doc is
> an **index** of file-level contracts; it does not re-litigate plan decisions.
> Locked plan items: D1–D7 (architect), SD1–SD8 (security), invariants 1–10.

Cron-driven NestJS service in `apps/cron/` that reclaims Railway local-volume disk via a two-phase delete (soft → 7-day grace → hard) against `Media` rows whose published-post window aged past 7 days. Off-by-default, dry-run-by-default, short-circuits when `STORAGE_PROVIDER !== 'local'`. Path-traversal + TOCTOU defenses are layered: resolver pre-flight + LocalStorage authoritative gate. Plan ref: §Summary.

---

## 1. File Manifest

Every file landed in this PR. Phase = build order (A → B → C, per plan §Implementation Sequence).
Owner = backend / database / devops / test (test column added for clarity).

### NEW files

| Path | Purpose (one sentence) | Owner | Phase |
|---|---|---|---|
| `apps/cron/src/tasks/media.janitor.ts` | `@Cron` entrypoint; env-gates + boot guards + delegates to service. | backend | C |
| `libraries/nestjs-libraries/src/database/prisma/media/media.janitor.service.ts` | Orchestrates soft-delete pass then hard-delete pass; owns error containment + structured logging. | backend | C |
| `libraries/nestjs-libraries/src/database/prisma/media/media.janitor.repository.ts` | Raw SQL + Prisma txn boundary; `findSoftDeleteCandidates`, `markSoftDeleted`, `hardDeleteBatch`, `getReferenceStatus`, `resurrectMedia`. | database | B |
| `libraries/nestjs-libraries/src/upload/media.path.resolver.ts` | Pre-flight classifier; wraps `confineAndVerify`; returns discriminated union `{kind:'local',...} \| {kind:'remote'} \| {kind:'rejected',...}`. | backend | A |
| `libraries/nestjs-libraries/src/upload/path.confinement.ts` | Shared pure helper `confineAndVerify(path, root)`; reused by resolver + LocalStorage. | backend | A |
| `libraries/nestjs-libraries/src/upload/path.confinement.error.ts` | Typed `PathConfinementError`. | backend | A |
| `libraries/nestjs-libraries/src/services/clock.service.ts` | Injectable wall clock; sole exempt site from the `new Date()` ban. | backend | A |
| `docs/runbooks/media-janitor.md` | Operator playbook: rollout, rollback levers, log-grep cheatsheet. **(devops writes — manifest entry only.)** | devops | C |

### MODIFIED files

| Path | Change | Owner | Phase |
|---|---|---|---|
| `libraries/nestjs-libraries/src/database/prisma/schema.prisma` | Add `@@index([deletedAt])` on `Media` (line ~217); add `@@index([state, publishDate, deletedAt])` on `Post` (line ~417). **No column delta.** | database | A |
| `libraries/nestjs-libraries/src/upload/local.storage.ts` | Re-assert root confinement inside `removeFile`; throw `PathConfinementError` on rejection. Defense-in-depth gate (SD1). | backend | A |
| `apps/cron/src/cron.module.ts` | Register `MediaJanitor`, `MediaJanitorService`, `MediaJanitorRepository`, `ClockService`, `MediaPathResolver`. | backend | C |
| `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts` | Null-guard inside `updateMedia` map at lines ~191–200 (R5 fix). | backend | B |
| `.env.example` | Add `# === Media Janitor` block (6 vars). **(devops writes — manifest entry only.)** | devops | C |
| `railway.toml` | Comment-only: document volume-mount must equal `UPLOAD_DIRECTORY`. **(devops writes.)** | devops | C |
| ESLint config (root) | `no-restricted-syntax` rule banning `new Date()` / `Date.now()` in janitor paths; optional SR-1 fs.unlink ban. | backend | A |

**Out-of-scope manifest entries** (deliberately NOT added in this PR):
- No `/health/deep` `janitor` probe. Observability is structured JSON logs + Sentry only. IF a future operator-visible health surface is needed, extend `/health/deep` (parallel + `withTimeout(3000)` + `describeError` sanitization) rather than add a parallel endpoint. Source: secretary memory `1be1feee`.
- No status DTO consumed by frontend → no `@nestjs/swagger` or `import 'reflect-metadata'` concerns apply. Janitor is operator-facing only. Source: secretary memory `b0e7a118`.

Plan ref: §File layout (DOTTED naming), §Schema delta, §Implementation Sequence.

---

## 2. Module Boundary

`MediaJanitor` is wired inside `CronModule` directly (no separate `MediaJanitorModule` — matches existing `CheckMissingQueues` / `PostNowPendingQueues` style at `apps/cron/src/cron.module.ts`). Public surface is the `@Cron` provider plus three injected collaborators.

```typescript
// apps/cron/src/cron.module.ts (additions)
import { MediaJanitor } from '@gitroom/cron/tasks/media.janitor';
import { MediaJanitorService } from '@gitroom/nestjs-libraries/database/prisma/media/media.janitor.service';
import { MediaJanitorRepository } from '@gitroom/nestjs-libraries/database/prisma/media/media.janitor.repository';
import { MediaPathResolver } from '@gitroom/nestjs-libraries/upload/media.path.resolver';
import { ClockService } from '@gitroom/nestjs-libraries/services/clock.service';

providers: [
  FILTER,
  CheckMissingQueues,
  PostNowPendingQueues,
  MediaJanitor,                  // task
  MediaJanitorService,           // orchestration
  MediaJanitorRepository,        // raw SQL + txn
  MediaPathResolver,             // pre-flight path classification
  ClockService,                  // injectable wall clock
];
```

Exported public symbols (consumed only inside `apps/cron`):
- `MediaJanitor` (provider; bears `@Cron('0 3 * * *')`)
- `MediaJanitorService` (orchestrator; called by `MediaJanitor.handleCron`)

Repository, resolver, and clock are internal to `libraries/nestjs-libraries/`; `UploadModule` already `@Global` so `MediaPathResolver` should be added to its `providers` + `exports` rather than re-declared.

Plan ref: §File layout, §Architecture Overview.

---

## 3. Repository Contract

`MediaJanitorRepository` owns ALL SQL for the janitor. Inject `PrismaRepository<'media'>` for non-txn reads and `PrismaService` (or `PrismaTransaction`) for `$transaction` access. Signatures below derived from the existing `MediaRepository` style at `media/media.repository.ts` (inferred, annotated where so).

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type TxClient = Prisma.TransactionClient;

export interface SoftDeleteCandidate {
  id: string;
  path: string;
  organizationId: string;
  fileSize: number;
}

export interface ReferenceStatus {
  lastPublishedAt: Date | null;
  publishedCount: number;
  nonPublishedCount: number;
}

export interface HardDeleteRowOutcome {
  mediaId: string;
  path: string;
  fileSize: number;
  result:
    | 'deleted'                            // row deleted, file unlink pending
    | 'resurrected-fk-relinked'            // User.pictureId / Agency.logoId reappeared
    | 'resurrected-nonpub-ref'             // DRAFT/QUEUE/ERROR ref appeared
    | 'resurrected-no-pub-ref'             // last PUBLISHED ref disappeared
    | 'skipped-race';                      // row lock empty (concurrent run / state change)
}

@Injectable()
export class MediaJanitorRepository {
  // Phase 1 read. Streaming cursor with BATCH_SIZE cap; no txn (auth re-check is in hardDeleteBatch).
  findSoftDeleteCandidates(opts: {
    ageDays: number;       // integer crosses JS->SQL (invariant #3)
    batchSize: number;
  }): Promise<SoftDeleteCandidate[]>;

  // Phase 1 transition. UPDATE Media SET deletedAt = NOW() - $ageDays * INTERVAL '1 day'
  // WHERE id IN ($ids) AND deletedAt IS NULL. Idempotent via WHERE filter; single non-txn UPDATE.
  markSoftDeleted(opts: { ids: string[]; ageDays: number }): Promise<{ transitioned: number }>;

  // Phase 2. Per row: REPEATABLE READ txn -> SELECT ... FOR UPDATE -> getReferenceStatus re-check
  // -> DELETE or resurrectMedia -> COMMIT. One outcome per id. Unlinks happen POST-COMMIT in service.
  hardDeleteBatch(opts: {
    graceDays: number;
    ageDays: number;       // for floor on Media.deletedAt
    batchSize: number;
  }): Promise<HardDeleteRowOutcome[]>;

  // Canonical eligibility (plan §Canonical eligibility SQL). INTRA-TXN to satisfy SD5.
  getReferenceStatus(tx: TxClient, mediaId: string): Promise<ReferenceStatus>;

  // RESURRECT: UPDATE Media SET deletedAt = NULL WHERE id = $1. Called from inside the
  // hardDeleteBatch txn on re-check failure. Caller WARN-logs; not a Sentry alert.
  resurrectMedia(tx: TxClient, id: string): Promise<void>;
}
```

**Transaction expectations**
- `findSoftDeleteCandidates`, `markSoftDeleted`, `getReferenceStatus` (standalone) — no txn.
- `hardDeleteBatch` — opens ONE `REPEATABLE READ` txn per candidate row. Plan §Concurrency / isolation.
- `getReferenceStatus` (in-txn variant) — MUST be called with the live txn client to satisfy SD5.

**Locking expectations**
- `hardDeleteBatch` step 2: `SELECT ... FOR UPDATE` on the Media row (plan §Per-candidate hard-delete sequence). Empty result → `skipped-race`.

Plan ref: §Eligibility predicate, §Canonical eligibility SQL, §Two-phase state machine, §Concurrency / isolation, invariants #3/#4/#5/#9.

---

## 4. Service Contract

`MediaJanitorService` orchestrates the two phases and owns observability + error containment. Service does NOT compute timestamps in JS — it passes integer `ageDays`/`graceDays` to the repository (invariant #3).

```typescript
import { Injectable } from '@nestjs/common';

export interface JanitorRunOptions {
  runId: string;          // format: mj-<isoStartedAt>-<6hex>
  dryRun: boolean;        // when true, txns ROLLBACK; no unlinks issued
  ageDays: number;
  graceDays: number;
  batchSize: number;
  wallClockBudgetMs?: number;  // optional cap; defaults applied by task layer
}

export interface SoftPhaseSummary {
  scanned: number;
  eligible: number;
  transitioned: number;
  errors: number;
  bytesReclaimedEstimate: number;
}

export interface HardPhaseSummary {
  scanned: number;
  candidates: number;
  hardDeleted: number;
  resurrected: number;       // sum across all 3 resurrect reasons
  pathRejected: number;      // resolver or LocalStorage rejection (Sentry-captured)
  unlinkErrors: number;      // post-commit ENOENT excluded
  bytesReclaimed: number;
}

@Injectable()
export class MediaJanitorService {
  // Phase 1: find candidates, transition deletedAt.  Per-row errors logged + counted,
  // never rethrown.  DryRun: skip the markSoftDeleted call entirely; log what would change.
  runSoftDeletePhase(opts: JanitorRunOptions): Promise<SoftPhaseSummary>;

  // Phase 2: hardDeleteBatch + post-commit unlink loop via IUploadProvider.removeFile
  // ONLY after MediaPathResolver.resolveForDelete returns {kind:'local'}.
  // Per-row errors (path-reject, unlink failure) logged + counted, never rethrown.
  // DryRun: repository runs txn but ROLLBACKs; no unlinks.
  runHardDeletePhase(opts: JanitorRunOptions): Promise<HardPhaseSummary>;
}
```

**Error containment**
- Both phase methods MUST catch per-row exceptions and continue. A single bad path or txn error MUST NOT abort the pass.
- `media-janitor.path-reject` events Sentry-capture (plan §Observability). Other per-row errors WARN-log only.
- Phase-level errors (e.g. DB unreachable) rethrow → surfaces in Sentry via existing `CronModule` `SentryModule.forRoot()` wiring.

**Unlink ordering** (post-commit, plan §Per-candidate hard-delete sequence step 5):
1. Service receives `HardDeleteRowOutcome[]` from repository (txns already committed).
2. For each outcome with `result === 'deleted'`: call `MediaPathResolver.resolveForDelete(path, uploadRoot)`. Skip with structured log on `rejected` or `kind: 'remote'`.
3. On `{kind:'local', absolutePath}`: call `IUploadProvider.removeFile(absolutePath)`. `ENOENT` log INFO; other errors log WARN `unlink.failed`.

Plan ref: §Two-phase state machine, §Observability, invariants #4/#5/#10.

---

## 5. Resolver + Path-Guard Contract

Two-layer defense. `MediaPathResolver` is pre-flight (attribution-rich); `LocalStorage.removeFile` is authoritative re-confine (SD1).

**Codebase-grounding note (secretary memory `02db174a`)**: `CustomFileValidationPipe` at `libraries/nestjs-libraries/src/upload/custom.upload.validation.ts:11` gates only `/upload-server`. `/upload-simple`, `/upload-from-url`, public-api `/upload` BYPASS it. Therefore stored `Media.path` values are NOT guaranteed to have passed MIME/size validation. Resolver MUST treat every `Media.path` as untrusted input.

**Codebase-grounding note (secretary memory `62760f39`)**: `ValidUrlPath` at `libraries/helpers/src/utils/valid.url.path.ts:28-46` is a NO-OP when `RESTRICT_UPLOAD_DOMAINS` is unset. Janitor MUST NOT delegate path checks to it. The SD1+SD2 confinement contract below is the AUTHORITATIVE boundary.

```typescript
// libraries/nestjs-libraries/src/upload/path.confinement.ts
export type ConfinementReason =
  | 'traversal'
  | 'symlink'
  | 'non_regular_file'
  | 'realpath_failed'
  | 'control_char'
  | 'unsupported_scheme';

export async function confineAndVerify(
  mediaPath: string,
  uploadRoot: string,
): Promise<
  | { ok: true; absolutePath: string }
  | { ok: false; reason: ConfinementReason }
>;
```

Implements the 8-step algorithm verbatim from plan §Path-confinement contract (control-char reject → classify → `path.resolve` → `path.relative` reject → `realpath` → re-confine → `lstat.isFile()` → success). Pure function; exhaustively unit-testable (SD3).

```typescript
// libraries/nestjs-libraries/src/upload/path.confinement.error.ts
export class PathConfinementError extends Error {
  constructor(
    public readonly reason: ConfinementReason,
    public readonly input: string,
  ) { super(`path-confinement rejected: ${reason}`); }
}
```

```typescript
// libraries/nestjs-libraries/src/upload/media.path.resolver.ts
import { Injectable } from '@nestjs/common';

export type ResolverContext = { runId: string; mediaId: string };

export type ResolveResult =
  | { kind: 'local'; absolutePath: string }
  | { kind: 'remote'; reason: 'http_scheme'; url: string }
  | { kind: 'rejected'; reason: ConfinementReason | 'unknown_shape' };

@Injectable()
export class MediaPathResolver {
  constructor(/* injects FRONTEND_URL + UPLOAD_DIRECTORY env values */) {}

  // Pre-flight classifier used by the janitor service.  Classifies in this order
  // (load-bearing, plan §Path-confinement contract):
  //   1. startsWith(`${FRONTEND_URL}/uploads/`)              -> local; extract suffix -> confineAndVerify
  //   2. /^\/\d{4}\/\d{2}\/\d{2}\//                          -> local (legacy relative; see posts.service.ts:188-200) -> confineAndVerify
  //   3. /^https?:\/\//                                      -> remote (row-delete only; no syscall)
  //   4. else                                                -> rejected (unknown_shape)
  // NEVER throws; returns a discriminated union.  Caller is responsible for
  // logging + skip-decision based on .kind.
  resolveForDelete(
    mediaPath: string,
    ctx: ResolverContext,
  ): Promise<ResolveResult>;
}
```

**LocalStorage re-confine (defense-in-depth; SD1)**:

```typescript
// libraries/nestjs-libraries/src/upload/local.storage.ts (modified)
async removeFile(filePath: string): Promise<void> {
  const result = await confineAndVerify(filePath, this.uploadDirectory);
  if (!result.ok) throw new PathConfinementError(result.reason, filePath);
  await fs.promises.unlink(result.absolutePath);  // ENOENT propagates to caller
}
```

**Invariant** (#1): no janitor code path may call `fs.unlink` / `fs.promises.unlink` directly. All deletions flow through `IUploadProvider.removeFile` AFTER `MediaPathResolver.resolveForDelete(...)` returned `{kind:'local'}`. Grep-auditable at PR review; optionally enforced by SR-1 ESLint rule.

Plan ref: §Path-confinement contract, §Three in-the-wild Media.path shapes, SD1–SD4, invariants #1/#7/#8.

---

## 6. ClockService Contract

Sole exempt site from the `new Date()` / `Date.now()` ban. Minimal surface; thin enough to back with a `FakeClockService` test double (plan §Clock contract).

```typescript
// libraries/nestjs-libraries/src/services/clock.service.ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class ClockService {
  now(): Date { return new Date(); }
  nowMs(): number { return Date.now(); }
}
```

**ESLint-banned-pattern list** (`no-restricted-syntax`):
- `apps/cron/src/tasks/media.janitor.ts`
- `libraries/nestjs-libraries/src/database/prisma/media/media.janitor.service.ts`
- `libraries/nestjs-libraries/src/database/prisma/media/media.janitor.repository.ts`
- `libraries/nestjs-libraries/src/upload/media.path.resolver.ts`
- `libraries/nestjs-libraries/src/upload/path.confinement.ts`

Patterns banned: `NewExpression[callee.name='Date']`, `CallExpression[callee.object.name='Date'][callee.property.name='now']`. ClockService impl file is the only exempt site. CI grep is belt + braces (test `clock-restriction.spec.ts`).

**Cutoff topology** (invariant #3): integer `ageDays` and `graceDays` are the ONLY time inputs that cross JS → SQL. SQL builds `NOW() - ($1::int * INTERVAL '1 day')` inline. No JS-computed `Date` is ever sent as an eligibility cutoff.

Plan ref: §Clock contract, invariants #2/#3.

---

## 7. Env-var Surface

Copied verbatim from plan §Env-var surface. All vars defaulted safe; misconfig at boot force-disables + logs.

| Var | Default | Notes |
|-----|---------|-------|
| `MEDIA_JANITOR_ENABLED` | `false` | Kill switch; off by default |
| `MEDIA_JANITOR_DRY_RUN` | `true` | Force-on for first prod cycle |
| `MEDIA_JANITOR_AGE_DAYS` | `7` | Locked policy |
| `MEDIA_JANITOR_GRACE_DAYS` | `7` | Locked policy |
| `MEDIA_JANITOR_BATCH_SIZE` | `100` | Per-tick cap; raise on disk pressure |
| `MEDIA_JANITOR_CRON` | `'0 3 * * *'` | 03:00 UTC daily; far from `*/16` post-publish cron |

**Boot-time guards** (force-disable + log on misconfig, in `MediaJanitor.handleCron`):
- `ENABLED=true` AND `STORAGE_PROVIDER !== 'local'` → disable, log warning (invariant #6).
- `ENABLED=true` AND `UPLOAD_DIRECTORY` unset/non-absolute → disable, log error.
- `ENABLED=true` AND `FRONTEND_URL` unset → disable, log error (resolver cannot classify).
- SR-5 startup root sanity-check (refuse `/`, `/tmp`, `/etc`, etc.) — RECOMMENDED. Per secretary memory `593b51a0`, if a startup-time async check is added wrap in `Promise.race(check, withTimeout(30000))` + try/catch + orphaned-promise `.catch` per `startMcp` pattern.

Plan ref: §Env-var surface, SD7, invariant #6.

---

## 8. Invariants Verification Table

The 10 plan invariants with their verifier + mechanism. Violation = MERGE BLOCK.

| # | Invariant | Verifier | Mechanism |
|---|---|---|---|
| 1 | Path: every unlink-bound string from `MediaPathResolver` → `LocalStorage.removeFile`; no direct `fs.unlink` in janitor. | code-review + test-engineer | Grep audit at PR; optional SR-1 ESLint rule; resolver/LocalStorage unit tests. |
| 2 | Clock: no `new Date()` / `Date.now()` in janitor files except `ClockService`. | CI | ESLint `no-restricted-syntax` + grep test `clock-restriction.spec.ts`. |
| 3 | Cutoff: no JS-computed timestamp crosses JS→SQL as eligibility cutoff; integer day-counts only. | code-review + test-engineer | Repository signatures take `ageDays`/`graceDays: number`; SQL builds `NOW() - ($1::int * INTERVAL '1 day')`. EXPLAIN + integration tests. |
| 4 | Txn: hard-delete row mutations inside REPEATABLE READ txn with `FOR UPDATE`; unlinks AFTER commit; dryRun ROLLBACK. | test-engineer | `state-transitions.integration.spec.ts`, `idempotency.integration.spec.ts`, `dry-run-default.integration.spec.ts`. |
| 5 | Idempotency: re-running a tick safe under all states; UPDATE filtered by `deletedAt IS NULL`; unlink ENOENT = success. | test-engineer | `idempotency.integration.spec.ts`. |
| 6 | Storage-backend: janitor INERT when `STORAGE_PROVIDER !== 'local'`. | test-engineer | Smoke + integration test (`media.janitor.cron.spec.ts`); boot-time guard log assertion. |
| 7 | Symlink: leaf symlink rejected (lstat); intermediate symlink escaping root rejected (realpath → re-confine). | test-engineer + security | `path-guard.spec.ts` with adversarial fixtures (security-engineer-supplied). |
| 8 | Three-shape classification per resolver order; all other shapes rejected with typed reason. | test-engineer | `path-guard.spec.ts` + `post-image.parser.spec.ts`. |
| 9 | Resurrect: phase-2 re-check failure → `UPDATE deletedAt=NULL`; NEVER `DELETE` on re-check failure. | test-engineer | `resurrection-rc1..rc6.integration.spec.ts`; counter-test-by-revert mandated. |
| 10 | Disk-orphan: unlink failure post-commit WARN-logs, never rolls back row delete; dangling-row NOT acceptable. | code-review + test-engineer | Service contract review; integration test simulating unlink failure mid-pass. |

Plan ref: §Invariants.

---

## 9. Distillation Notes (inferred-signature items, flagged for HANDOFF)

No blocking contradictions found in the plan. Three minor shape choices that backend-coder + database-engineer may adjust without architect re-engagement:

1. **`findSoftDeleteCandidates` cursor vs batch** — plan §Cross-Cutting R14 mentions "streaming cursor"; the signature above commits to a batched return. If a streaming `AsyncIterable<SoftDeleteCandidate>` is preferred, adjust at code-write.
2. **`HardDeleteRowOutcome` resurrect sub-types** — explicit union (`resurrected-fk-relinked` / `-nonpub-ref` / `-no-pub-ref`) lifted from plan §Per-candidate hard-delete sequence so service can route logs without re-querying. Flat `resurrected: true + reason: string` is a stylistic alternative.
3. **`MediaPathResolver` env injection** — assumed Nest config injection of `FRONTEND_URL` + `UPLOAD_DIRECTORY`. Mirror existing `process.env.X` direct reads if that is the house style.
