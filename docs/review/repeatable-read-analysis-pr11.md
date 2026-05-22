# RepeatableRead Load-Bearing Analysis — PR #11 FAIL #1

**Scope**: `MediaJanitorRepository.processHardDeleteRow` (libraries/nestjs-libraries/src/database/prisma/media/media.janitor.repository.ts:222-347). Advisory only — Path B already in-flight by backend-coder.

**Line-number note**: task references `repository.ts:288` are stale post-Path-B. Actual landmarks: `$transaction` isolation option at line 306; catch handler with `isSerializationFailure(err) → skipped-race` at lines 308-346; `isSerializationFailure` helper at lines 71-76.

## Headline

**Path B is safe.** RepeatableRead is NOT load-bearing for any invariant inside `processHardDeleteRow` beyond the EvalPlanQual-vs-40001 interaction that Path B itself consumes. Cross-row consistency is enforced by `FOR UPDATE` + intra-txn re-reads, which work identically under READ COMMITTED.

## Q1 — Does Path B weaken any RR invariants?

No. Path B catches SQLSTATE 40001 OUTSIDE the `$transaction` closure, so all in-txn mutations (`resurrectMedia` UPDATE, `Media` DELETE) are already discarded by Postgres' abort. The catch handler does not need to compensate. The `dryRun` path remains intact via `DryRunRollback`. The four mutating branches (resurrect-fk-relinked, resurrect-nonpub-ref, resurrect-no-pub-ref, deleted) are unchanged.

Three concurrency hazards exist in the txn:

1. **Two janitors on same `mediaId`** — Path B's target. Under RR, the loser aborts with 40001 (no EvalPlanQual). Path B classifies this as `skipped-race`.
2. **App-layer write setting `User.pictureId` / `SocialMediaAgency.logoId` post-candidate-scan** — guarded by FK re-check at lines 253-256 inside the lock window. Would work under RC.
3. **New non-published `Post` referencing the media** — guarded by `getReferenceStatus` at line 271 inside the lock window. Would work under RC.

Hazards 2 and 3 are guarded by the `FOR UPDATE` lock + intra-txn re-reads, not by RR phantom protection. RR is load-bearing ONLY for the 40001 signal Path B consumes.

## Q2 — What would Path A (RC) need?

Switching to `Prisma.TransactionIsolationLevel.ReadCommitted` would require:

- **Remove** the `isSerializationFailure(err)` catch branch (lines 325-336) — RC never fires 40001 for this lock pattern.
- **Rely on** the existing `locked.length === 0` branch (lines 240-249) for the row-vanished case — under RC, EvalPlanQual re-runs the WHERE predicate after the lock is acquired, so a concurrently-DELETEd or concurrently-`deletedAt:NULL`-resurrected row returns empty here. This is already correct.
- **Keep** the FK re-check and `getReferenceStatus` — those are lock-scoped, not isolation-scoped.
- **Telemetry cost**: lose the explicit `media-janitor.hard-delete.race-loss` log at line 326. Race-losses become silent `skipped-race` returns instead of warn-logged.

Path A is structurally feasible; the only real trade is observability.

## Q3 — Wider audit needed?

**No.** `grep -rn "RepeatableRead" libraries/nestjs-libraries/src/database/prisma/` returns exactly one production usage: `media.janitor.repository.ts:306`. The spec at `two-phase.integration.spec.ts:458` is a comment. Path B's fix is therefore complete-in-scope; no other repository has this 40001-silent-loss shape.

## Recommendation

Backend-coder's Path B is correct as implemented. No additional invariants to preserve. Closing as APPROVE.
