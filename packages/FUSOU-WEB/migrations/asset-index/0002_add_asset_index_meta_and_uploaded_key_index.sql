-- ============================================================================
-- Migration: Add asset_index_meta and uploaded/key composite index
-- Date: 2026-06-01
-- Purpose:
--   1) Add revision metadata table for cache invalidation signaling.
--   2) Add index to optimize uploaded_at DESC + key DESC ordering queries.
-- ============================================================================

CREATE TABLE IF NOT EXISTS asset_index_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

INSERT INTO asset_index_meta (id, revision, updated_at)
VALUES (1, 0, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
ON CONFLICT(id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_files_uploaded_key
  ON files(uploaded_at DESC, key DESC);
