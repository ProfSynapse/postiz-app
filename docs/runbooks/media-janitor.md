# Media Janitor Runbook

Operator playbook for the cron-driven media-asset janitor that reclaims Railway local-volume disk by two-phase-deleting `Media` rows whose published-post window has aged past the configured threshold.

The janitor is **off by default**, **dry-run by default**, and **inert when `STORAGE_PROVIDER !== 'local'`** (Invariant 6). Cron host: `apps/cron/` (pm2-managed inside the Railway service container alongside backend, workers, and frontend).

Related docs:
- `docs/plans/media-janitor-plan.md` — full plan, risk register, invariants
- `docs/architecture/media-janitor.md` — file manifest, contracts, env-var surface

---

## 1. Pre-deploy (MANDATORY)

**Before** running `prisma db push` for the schema delta that adds `@@index([deletedAt])` on `Media` and `@@index([state, publishDate, deletedAt])` on `Post`, the operator MUST create both indexes against the production database using `CREATE INDEX CONCURRENTLY`. Running `prisma db push` against a populated `Media`/`Post` table without pre-created indexes takes an `ACCESS EXCLUSIVE` lock and will outage the entire app for the duration of the build (multi-minute on production-sized tables). This is risk **R7** in the plan.

### Step 1a — Name-collision pre-check (MUST run first)

Before issuing the `CREATE INDEX CONCURRENTLY` block, verify that no pre-existing production index already uses either target indexname. The `CREATE INDEX CONCURRENTLY IF NOT EXISTS` form is idempotent only on **exact name match** — if a same-name index with a different column definition exists in prod, the `IF NOT EXISTS` silently no-ops, Prisma's subsequent `db push` sees the index as already present, and prod is left with a stale-named-but-wrong-shaped index. The candidate query would then Seq Scan and the janitor's first real cycle would throughput-stall the cron worker.

Run against the production database via the Railway CLI (`railway run psql "$DATABASE_URL"` or the Railway DB shell) **before invoking `prisma db push`**:

```sql
-- Pre-deploy verification: ensure no name collisions with pre-existing prod indexes.
-- Expected: 0 rows. Non-zero rows BLOCK deploy until investigated.
SELECT indexname, indexdef FROM pg_indexes
WHERE indexname IN ('Media_deletedAt_idx', 'Post_state_publishDate_deletedAt_idx');
```

If any row is returned, **halt the deploy** and compare each returned `indexdef` against the target schema delta:

- Target `Media_deletedAt_idx` definition: `CREATE INDEX "Media_deletedAt_idx" ON public."Media" USING btree ("deletedAt")`.
- Target `Post_state_publishDate_deletedAt_idx` definition: `CREATE INDEX "Post_state_publishDate_deletedAt_idx" ON public."Post" USING btree ("state", "publishDate", "deletedAt")`.

A same-name index with a matching `indexdef` is benign — proceed to the `CREATE INDEX CONCURRENTLY` block (the `IF NOT EXISTS` will correctly no-op). A same-name index with a **different** `indexdef` will silently mask the migration and must be reconciled manually (typically: `DROP INDEX CONCURRENTLY "<name>";` followed by re-running the `CREATE INDEX CONCURRENTLY` block). Do not proceed with `prisma db push` until the pre-check returns 0 rows OR every returned row's `indexdef` matches the target.

### Step 1b — Create indexes

Run against the production database **before deploying the janitor branch**:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Media_deletedAt_idx" ON "Media" ("deletedAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Post_state_publishDate_deletedAt_idx"
  ON "Post" ("state", "publishDate", "deletedAt");
```

Notes:
- `CONCURRENTLY` cannot run inside a transaction — execute each statement standalone (e.g. via `psql` non-interactive, Railway DB shell, or a one-off migration script).
- `IF NOT EXISTS` makes this idempotent and safe to re-run.
- After both succeed, the `prisma db push` deploy is a no-op for these indexes (Prisma sees them present) and will not take the exclusive lock.
- Verify after creation:
  ```sql
  SELECT indexname, indexdef FROM pg_indexes
  WHERE indexname IN ('Media_deletedAt_idx', 'Post_state_publishDate_deletedAt_idx');
  ```

---

## 2. Phased Rollout

Follows plan §Implementation Sequence Phases A–E. Phases A–C are code merge (covered by CI + PR review). Phases D–E are the operator-driven production rollout.

### Step 1 — Pre-deploy indexes (Phase D, pre)

Run §1 Step 1a (name-collision pre-check) and §1 Step 1b (`CREATE INDEX CONCURRENTLY`) in order against the production database. **Do not proceed until the pre-check returns 0 rows (or matching `indexdef`s) AND both indexes exist.**

### Step 2 — Deploy with dry-run + enabled (Phase D)

Set Railway environment variables on the service running `apps/cron`:

```
MEDIA_JANITOR_ENABLED=true
MEDIA_JANITOR_DRY_RUN=true
MEDIA_JANITOR_CRON=0 3 * * *
STORAGE_PROVIDER=local            # required; janitor short-circuits otherwise
UPLOAD_DIRECTORY=/data/uploads    # MUST equal the Railway volume mount path
```

(Leave `MEDIA_JANITOR_AGE_DAYS`, `MEDIA_JANITOR_GRACE_DAYS`, `MEDIA_JANITOR_BATCH_SIZE` at their defaults for the first cycle.)

Deploy. The first cron tick will fire at the next `0 3 * * *` UTC boundary. In dry-run mode the repository txns ROLLBACK and no `unlink` is issued — the janitor only logs what it _would_ have done.

### Step 3 — Observe ≥1 cycle (24h)

After at least one full daily tick has fired, inspect logs (see §4 for grep cheatsheet) for:

- `media-janitor.run.start` and `media-janitor.run.end` events bracket a complete pass.
- `media-janitor.soft.summary` counts plausible: `scanned`, `eligible`, `transitioned` non-zero is expected if there are aged media; if all are zero the candidate query may not be matching — verify the schema delta indexes are live (see §1) and that some published-then-deleted posts exist past the age threshold.
- `media-janitor.hard.summary` counts plausible: `pathRejected` should be **0** in a healthy run. `resurrected` may be non-zero (this is normal during the race window, not an alert).
- No unexpected Sentry alerts. The only event that throw-and-captures to Sentry is `media-janitor.path-reject`; if any appear, do **not** flip dry-run off — diagnose first.

If counts are wrong or Sentry fires: rollback by flipping `MEDIA_JANITOR_ENABLED=false` (see §3) and iterate on configuration or code before re-attempting.

### Step 4 — Flip to destructive (Phase E)

Once dry-run cycle counts look correct and stable:

```
MEDIA_JANITOR_DRY_RUN=false
```

Redeploy. The next tick will perform real soft-deletes (Phase 1) and, after `GRACE_DAYS` has elapsed for previously soft-deleted rows, real hard-deletes + post-commit `unlink` (Phase 2). Monitor:

- Railway disk usage trending down (this is the reason the janitor exists).
- Sentry for `media-janitor.path-reject` (Sentry-captured) and log stream for `media-janitor.unlink.failed` (WARN-logged, not Sentry'd by default).

---

## 3. Rollback

Two levers, both safe and non-destructive during the grace window.

### Lever 1 — Halt the cron

```
MEDIA_JANITOR_ENABLED=false
```

Redeploy (or apply via Railway's runtime env-var update if the service hot-reloads). The next cron tick will short-circuit at the boot-time guard and emit no row mutations or unlinks. Use this lever first whenever something looks wrong — it stops bleeding immediately.

### Lever 2 — Revert soft-deletes (during grace window only)

A soft-delete sets `Media.deletedAt = NOW() - $AGE_DAYS days`. The row is inert (no longer eligible for re-use; no file unlinked yet) and remains revertible until `GRACE_DAYS` has elapsed and Phase 2 hard-deletes it.

To resurrect ALL soft-deleted media (use only if Lever 1 alone is insufficient and a recent dry-run-off cycle mis-classified):

```sql
UPDATE "Media" SET "deletedAt" = NULL WHERE "deletedAt" IS NOT NULL;
```

To resurrect a specific row:

```sql
UPDATE "Media" SET "deletedAt" = NULL WHERE id = '<media-id>';
```

**Once a row is hard-deleted (Phase 2 commit) the row is gone and the file is unlinked.** There is no Phase-2 rollback — recovery requires database backup restore. The `GRACE_DAYS=7` window is the safety net; do not shrink it without explicit re-review.

---

## 4. Log Grep Cheatsheet

The janitor emits structured one-line JSON to stdout, picked up by Railway's log aggregator. Inside the cron container, logs are also pm2-managed.

### Tail the cron logs

```sh
pm2 logs cron
```

(Or `pm2 logs cron --lines 1000 --nostream` for a bounded snapshot.)

### Grep patterns

All events share the `evt` field prefix `media-janitor.` and a per-tick `runId` of shape `mj-<isoStartedAt>-<6hex>` — use the `runId` to follow a single pass end-to-end.

| Purpose | Pattern |
|---|---|
| Phase 1 summary (per tick) | `pm2 logs cron \| grep media-janitor.soft.summary` |
| Phase 2 summary (per tick) | `pm2 logs cron \| grep media-janitor.hard.summary` |
| Path rejections (Sentry-captured, should be 0) | `pm2 logs cron \| grep media-janitor.path-reject` |
| Resurrection events (normal during race window) | `pm2 logs cron \| grep media-janitor.resurrect` |
| Unlink failures (WARN, post-commit) | `pm2 logs cron \| grep media-janitor.unlink.failed` |
| Loose match on path issues | `pm2 logs cron \| grep -E 'pathRejected\|path-reject'` |
| Follow one specific tick | `pm2 logs cron \| grep 'mj-2026-05-21T03:00'` |

For a JSON-aware view (if `jq` is available in the container):

```sh
pm2 logs cron --raw --nostream | grep media-janitor | jq -c 'select(.evt == "media-janitor.hard.summary") | {runId, hardDeleted, resurrected, pathRejected, bytesReclaimed}'
```

---

## 5. Operational Caveats

### STORAGE_PROVIDER must be `'local'` (Invariant 6, R10)

The janitor is INERT (zero side effects, returns immediately at boot-guard) when `STORAGE_PROVIDER !== 'local'`. If the deployment is ever flipped to R2/Cloudflare object storage mid-flight, the janitor stops touching anything — but **mid-tick changes** to `STORAGE_PROVIDER` are not safe (a running tick uses the value it captured at boot). To be safe: change `STORAGE_PROVIDER`, then redeploy (which restarts the cron container and re-evaluates the guard at the next tick).

Native R2/Cloudflare object deletion is out of scope for this janitor — tracked as follow-up F2 in the plan.

### Single-replica only (R15)

The current implementation assumes a single replica of `apps/cron`. Running multiple replicas concurrently would race on the same candidate rows; Phase 2's `FOR UPDATE` row-lock prevents corruption but produces wasted work and noisy `skipped-race` outcomes. **Do not horizontally scale the cron service** without first implementing the documented `pg_try_advisory_lock` mitigation (see plan §R15 / follow-up).

### Cron offset (R11)

The default `MEDIA_JANITOR_CRON='0 3 * * *'` is deliberately set to 03:00 UTC, far from the `*/16` minute ticks used by `PostNowPendingQueues` (the post-publishing cron). This avoids contention on shared DB connections and Sentry quota. If you change `MEDIA_JANITOR_CRON`, prefer hourly or daily expressions that do not align with `*/N` patterns the rest of the cron module uses.

### First-cycle expectation

After Step 2 (dry-run + enabled), expect **one full day** before the first cycle fires. To observe sooner during initial validation, you may temporarily set `MEDIA_JANITOR_CRON='*/15 * * * *'` for one or two ticks, then revert to `0 3 * * *` once counts look correct. Do not leave a sub-daily cadence in production after validation.

---

## 6. References

- Plan: `docs/plans/media-janitor-plan.md` (risk register, invariants, env-var surface)
- Architecture: `docs/architecture/media-janitor.md` (file manifest, contracts)
- Cron host: `apps/cron/src/cron.module.ts`
- Task entrypoint: `apps/cron/src/tasks/media.janitor.ts`
