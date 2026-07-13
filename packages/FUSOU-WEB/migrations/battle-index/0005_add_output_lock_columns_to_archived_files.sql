-- Migration: Add output lock columns to archived_files for compaction concurrency control
-- Scope: battle-index

ALTER TABLE archived_files ADD COLUMN lock_token TEXT;
ALTER TABLE archived_files ADD COLUMN lock_expires_ms INTEGER;
ALTER TABLE archived_files ADD COLUMN lock_owner_run_key TEXT;

CREATE INDEX IF NOT EXISTS idx_archived_files_lock_expires
  ON archived_files(lock_expires_ms);

CREATE INDEX IF NOT EXISTS idx_archived_files_lock_owner
  ON archived_files(lock_owner_run_key);
