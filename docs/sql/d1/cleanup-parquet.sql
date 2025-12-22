-- ============================================================================
-- Cleanup Script: Drop Parquet-era Battle Index Tables and Views
-- ============================================================================
-- WARNING: This operation is destructive. Run only after verifying that
--          Avro schema (avro_files / avro_segments) is fully adopted.
--          Consider keeping an archive (rename) if historical analysis is needed.
--
-- Usage (local):
--   npx wrangler d1 execute dev_kc_battle_index --local  --file=./docs/sql/d1/cleanup-parquet.sql
-- Usage (remote):
--   npx wrangler d1 execute dev_kc_battle_index --remote --file=./docs/sql/d1/cleanup-parquet.sql
-- ============================================================================

-- NOTE: Do not use explicit SQL transactions (BEGIN/COMMIT) in Cloudflare
-- Durable Objects storage. If you need atomicity there, wrap these statements
-- with state.storage.transaction() in JavaScript. For D1 via Wrangler CLI,
-- plain statements are fine without explicit BEGIN/COMMIT.

-- Drop Parquet-era views (if present)
DROP VIEW IF EXISTS battle_files_latest;
DROP VIEW IF EXISTS battle_files_period_summary;
DROP VIEW IF EXISTS battle_files_global_period_summary;

-- Drop Parquet-era indexes (dropping the table will drop indexes, but be explicit)
DROP INDEX IF EXISTS idx_battle_files_period;
DROP INDEX IF EXISTS idx_battle_files_period_tag;
DROP INDEX IF EXISTS idx_battle_files_latest;
DROP INDEX IF EXISTS idx_battle_files_uploaded_by;

-- Drop Parquet-era tables
DROP TABLE IF EXISTS battle_files;
DROP TABLE IF EXISTS battle_files_parquet_archive;  -- if previously archived by rename


-- ============================================================================
-- Clean up SQLite metadata (sqlite_sequence entries for dropped tables)
-- ============================================================================
-- Note: sqlite_sequence is SQLite's internal sequence/autoincrement tracking
--       table. After dropping battle_files, orphaned entries may remain.
--       We must clean them up to avoid confusion and ensure clean state.
-- ============================================================================
DELETE FROM sqlite_sequence 
WHERE name IN ('battle_files', 'battle_files_parquet_archive');

-- Verify cleanup (optional diagnostic view)
-- SELECT 'Remaining sqlite_sequence entries:';
-- SELECT name, seq FROM sqlite_sequence;

-- ============================================================================
-- Optional Cleanup (uncomment if you don't need append audit history)
-- Note: Only run if you intentionally do not use the audit trail table.
-- ============================================================================
-- DROP TABLE IF EXISTS avro_append_history;
