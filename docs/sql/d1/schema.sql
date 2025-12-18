-- ============================================================================
-- Cloudflare D1 Schema - Asset Files Index Database (DEPRECATED)
-- ============================================================================
-- This file is maintained for reference only.
-- Use separate schema files instead:
--   - asset-index.sql: Asset sync service schema
--   - battle-index.sql: Battle data pipeline schema
--
-- ============================================================================
-- Stores metadata for uploaded asset files (PNG, JPG, etc.)
-- Used by the asset-sync endpoint for managing game resource files

CREATE TABLE IF NOT EXISTS files (
  -- Primary key
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- R2 object key (full path) - immutable
  key TEXT NOT NULL UNIQUE,

  -- File metadata
  size INTEGER NOT NULL,                -- bytes
  content_type TEXT DEFAULT "application/octet-stream",

  -- Content validation
  content_hash TEXT,                    -- SHA-256 hex string for integrity check

  -- Timestamps (UTC)
  uploaded_at INTEGER NOT NULL,         -- Unix timestamp in milliseconds

  -- Uploader information
  uploader_id TEXT NOT NULL,            -- Supabase user ID

  -- Asset classification (optional)
  finder_tag TEXT DEFAULT NULL,         -- Category or finder-related tag

  -- Additional metadata (JSON)
  metadata TEXT DEFAULT NULL,           -- JSON object for additional properties

  -- Audit trail
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for common asset queries
CREATE INDEX IF NOT EXISTS idx_files_key 
  ON files(key);
CREATE INDEX IF NOT EXISTS idx_files_uploader 
  ON files(uploader_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_finder_tag 
  ON files(finder_tag);
