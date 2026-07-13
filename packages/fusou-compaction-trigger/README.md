# fusou-compaction-trigger

This package is a Trigger.dev execution package for battle Avro compaction jobs.

## Positioning

- It is not a general-purpose compaction library.
- It owns Trigger.dev schedules/tasks and runtime orchestration.
- It executes compaction jobs by calling FUSOU-WEB internal control-plane APIs.
- Core merge logic is shared via `@fusou/compaction-core`.

## Current scope

- Scheduled jobs: daily and weekly.
- Scheduled jobs are serialized on a shared queue (`concurrencyLimit: 1`) to avoid overlapping runs.
- Manual task: historical backfill compaction across arbitrary time windows (including period compaction).
- Operator scripts: local Trigger.dev start/deploy, manual backfill trigger, and R2-based D1 reindex repair.
- Reads source blocks metadata via internal API.
- Fetches block OCF payloads and writes merged output to R2.
- Registers output metadata back to battle index DB through internal API.

## Runtime

- Target runtime: Node.js on Trigger.dev.
- R2 access: S3-compatible endpoint + credentials for non-Workers runtime.

## Minimum env for terminal backfill

If you will use `pnpm run backfill*` from the terminal, the minimum required env is:

- `TRIGGER_SECRET_KEY`
- `INTERNAL_COMPACTION_BASE_URL`
- `INTERNAL_COMPACTION_TOKEN`
- `R2_BUCKET`
- `R2_S3_ENDPOINT`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

If you only deploy scheduled tasks and do not enqueue backfill from the terminal, `TRIGGER_SECRET_KEY` is not required.

## pnpm scripts

- `pnpm run dev`: start local Trigger.dev task runtime with dotenvx.
- `pnpm run deploy`: deploy the package to Trigger.dev with dotenvx.
- `pnpm run backfill:daily`: enqueue a daily backfill from the terminal for the full available range.
- `pnpm run backfill -- --tier weekly --tables battle,cells`: full-range manual form.
- `pnpm run backfill:daily -- --start 2025-01-01T00:00:00Z --end 2025-01-08T00:00:00Z`: narrow-range override when needed.
- `pnpm run reindex:archived-files`: dry-run R2 -> `archived_files` path normalization repair.
- `pnpm run reindex:archived-files:apply`: apply the `archived_files` repair.
- `pnpm run bootstrap:archived-files`: dry-run bootstrap of missing `archived_files` rows from current R2 keys.
- `pnpm run bootstrap:archived-files:apply`: apply bootstrap for `archived_files`.
- `pnpm run reindex:block-indexes`: dry-run `block_indexes` backfill.
- `pnpm run reindex:block-indexes:apply`: apply `block_indexes` backfill.
- `pnpm run reindex:all`: run both dry-run repair checks in sequence.
- `pnpm run reindex:all:apply`: apply both repair phases in sequence.
- `pnpm run battle-data:recover`: dry-run full recovery (`bootstrap + reindex`).
- `pnpm run battle-data:recover:apply`: apply full recovery (`bootstrap + reindex`).
- `pnpm run battle-data:verify`: print completion counters via `--phase d1-verify` (`archived_files_count`, `block_indexes_count`, `missing_index_rows`).

The old one-off migration entry points were intentionally removed. Ongoing maintenance is limited to the bootstrap/reindex flows that remain relevant after cutover:

- `archived_files` path/table_version repair from existing R2 objects.
- `archived_files` bootstrap from R2 when D1 is empty.
- `block_indexes` backfill for all `archived_files` rows.
  - If clone sources exist, clone is used first.
  - If clone sources do not exist (empty or partial D1), remaining rows are synthesized from `archived_files` metadata.

### Reindex definition (operational)

In this package, "reindex complete" means both tables are built and aligned:

- `archived_files_count == block_indexes_count`
- `missing_index_rows == 0` (calculated by `LEFT JOIN block_indexes ON file_id`)

Recommended reusable run sequence:

1. `pnpm run battle-data:recover` (dry-run)
2. `pnpm run battle-data:recover:apply` (apply)
3. `pnpm run battle-data:verify` (completion check)

## Non-goals

- This package is not intended to be imported by other runtime packages as a stable library API.
- If shared library needs grow, split reusable modules into a separate package later.

## Manual backfill task

The package exposes a manual Trigger.dev task with id `backfill-compaction`.

- It is not started automatically on deploy.
- It is intended for one-off backlog cleanup or controlled historical reprocessing.
- It scans source groups from `block_indexes`, so it can only process source data that is still indexed in D1.

### Supported tiers

- `daily`: runs `daily -> weekly -> period` in that order.
- `weekly`: runs `weekly -> period` in that order.
- `period`: runs `period` only, using the provided time range for discovery of closed historical source groups.

Period rollover auto-detection is disabled by design. Operators trigger period compaction manually via this backfill task.

When period is produced from weekly during backfill, the workflow also runs `period -> period` consolidation so each `(table_name, period_tag, table_version)` converges to a single period file unless source data volume forces multiple files upstream.

### Payload

Manual backfill can be started in two ways:

- Recommended: pass CLI arguments directly. Required value is only `tier`.
- If `start` and `end` are omitted, the task resolves the full available source range from D1 and processes that range.
- Optional advanced path: pass `--payload <json-file>` only if you explicitly want to keep a reusable JSON template.

CLI example:

```bash
pnpm run backfill:daily
```

Narrow-range example:

```bash
pnpm run backfill:daily -- --start 2025-01-01 --end 2025-01-08
```

Optional JSON payload example:

```json
{
  "tier": "daily",
  "source_tier": "hourly",
  "start_ms": 1735689600000,
  "end_ms": 1736294400000,
  "table_names": ["battle", "cells"],
  "chunk_limit": 200
}
```

### Notes

- Terminal operation is the primary expected path for these `pnpm` scripts.
- `TRIGGER_SECRET_KEY` is only needed for terminal-triggered backfill because the terminal helper enqueues the Trigger.dev task directly.
- `start` and `end` can be passed as Unix milliseconds, `YYYY-MM-DD`, or full ISO-8601 timestamps.
- `YYYY-MM-DD` is interpreted as UTC midnight.
- `start` and `end` are optional, but if you pass one you must pass both.
- `source_tier` is optional. If omitted, defaults are:
  - `daily -> hourly`
  - `weekly -> daily`
  - `period -> weekly`
- `start_ms` and `end_ms` define the historical scan range.
- For `daily` and `weekly`, the task walks aligned windows in that range.
- After the requested tier finishes, the task automatically continues with the higher tiers in order.
- For `period`, the range is used to discover historical weekly groups, then compaction runs at period scope.
- `table_names` is optional. If omitted, all built-in compaction target tables are scanned.

### Duration

- Manual backfill is configured with a long execution window so it can run a full cascade.
- Current `maxDuration` is `timeout.None` (no Trigger.dev execution timeout cap).

### How to run

1. Deploy the latest package version with `pnpm run deploy`.
2. If you want to enqueue from the terminal, set `TRIGGER_SECRET_KEY` in `.env`.
3. Run a tier shortcut without dates to process the full available range. For example, `pnpm run backfill:daily` now runs `daily -> weekly -> period`.
4. Add optional flags only when needed: `--tables battle,cells`, `--source-tier hourly`, `--chunk-limit 200`, `--start 2025-01-01 --end 2025-01-08`.
5. Start with a narrow time range and a small table subset before large backlog runs.

If you want to inspect or retry runs visually, the same task still appears in the Trigger.dev dashboard.

### Safety expectations

- Compaction output registration is separate from source cleanup.
- D1 source metadata cleanup is finalized before source R2 object deletion starts.
- Source R2 object deletion is best-effort; deletion failures are logged and should be handled by periodic storage hygiene.
- Historical backfill should be treated as an operator action, not as an always-on scheduled workflow.
