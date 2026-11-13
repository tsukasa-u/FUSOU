# W-06 Compaction Lock Specification Assessment

Date: 2026-11-12

## Assessment

The W-06 instruction in the execution runbook describes a different compaction
lock implementation from the one present in this checkout. It asks for
`acquireLock` to update `compaction_state.status` and
`compaction_state.last_started_at`, but neither that function nor those columns
exist in the current code and schema.

The current implementation uses an owner/run model:

- [`src/db/compaction-state.ts`](../../packages/FUSOU-WORKFLOW/src/db/compaction-state.ts)
  exports `claimCompaction`, which reads `workflow_compaction_state` and rejects
  an existing owner with `CompactionBusyError` (lines 21-30).
- On a successful claim it updates `run_id`, `owner`, `cutoff_id`, and
  `started_at` in a transaction (lines 63-65). It does not update a `status` or
  `last_started_at` column.
- `releaseCompaction` clears `owner` only when both the owner and run ID match
  (lines 104-107).
- The table definition in
  [`schema.sql`](../../docs/sql/turso/schema.sql) and
  [`migration_0001_workflow_durability.sql`](../../docs/sql/turso/migration_0001_workflow_durability.sql)
  contains `id`, `run_id`, `owner`, `cutoff_id`, `started_at`, and `published`;
  it contains no `status`, `last_started_at`, or `updated_at` columns.
- [`test/durability.test.ts`](../../packages/FUSOU-WORKFLOW/test/durability.test.ts)
  asserts that a second claim fails while the first owner holds the lock, then
  explicitly releases the first claim and verifies that the same run and cutoff
  are resumed (lines 35-45).

## Change disposition

No W-06 code change was made. Applying the runbook SQL verbatim would target
nonexistent tables/columns and fail. Adding similarly named columns or changing
`started_at` without a schema and behavior decision would also be unsafe:
`started_at` currently represents the persisted compaction run start, while
`owner` is the lock, and the existing contract requires explicit owner release.
Updating a timestamp alone would not define or implement recovery for an
abandoned owner.

## Audit follow-up

Please confirm whether W-06 refers to a different revision of the workflow
compaction code. If it is intended to apply to this owner/run implementation,
the requirement should specify the intended recovery policy (including whether
and when an abandoned owner may be cleared) and whether a separate lock-attempt
timestamp and schema migration are required. The current exclusive-claim and
explicit-release behavior should remain unchanged until that decision is made.
