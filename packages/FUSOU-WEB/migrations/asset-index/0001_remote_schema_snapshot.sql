-- ============================================================================
-- Migration: Remote schema snapshot for ASSET_INDEX_DB
-- Date: 2026-06-01
-- Purpose:
--   Preserve the remote schema text in migration_dir before adding new changes.
--   This file is intentionally non-destructive for existing remote DBs.
-- ============================================================================

-- Remote schema snapshot (captured via `wrangler d1 export --remote --no-data`)
-- PRAGMA defer_foreign_keys=TRUE;
-- CREATE TABLE [files] ("key" text PRIMARY KEY,"size" integer,"uploaded_at" integer,"content_type" text,"uploader_id" text,"metadata" blob,"finder_tag" text, content_hash TEXT, created_at TEXT);
-- DELETE FROM sqlite_sequence;
-- CREATE INDEX idx_files_key
--   ON files(key);
-- CREATE INDEX idx_files_uploader
--   ON files(uploader_id, uploaded_at DESC);
-- CREATE INDEX idx_files_finder_tag
--   ON files(finder_tag);
-- CREATE INDEX idx_files_content_hash ON files(content_hash);

-- No-op statement so the migration is recordable without mutating schema.
SELECT 1;
