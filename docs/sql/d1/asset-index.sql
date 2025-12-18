-- ============================================================================
-- Cloudflare D1 Schema - Asset Files Index Database
-- ============================================================================
-- This schema manages the metadata for asset files (PNG, JPG, etc.) stored in R2.
--
-- Database: dev_kc_asset_index
-- Purpose: Asset sync service metadata tracking
-- ============================================================================

-- Asset Files Table for Asset Sync Service
CREATE TABLE IF NOT EXISTS files (
  -- Primary key
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- R2 object key (full path) - immutable
  key TEXT NOT NULL UNIQUE,

  -- File metrics
  size INTEGER NOT NULL,      -- bytes
  content_type TEXT DEFAULT "application/octet-stream",

  -- Content validation
  content_hash TEXT,          -- SHA-256 hex string

  -- Timestamps (UTC, Unix milliseconds)
  uploaded_at INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,

  -- Audit trail
  uploader_id TEXT NOT NULL,  -- Supabase user ID

  -- Asset classification
  finder_tag TEXT DEFAULT NULL,  -- Asset tag/category

  -- Additional metadata
  metadata TEXT DEFAULT NULL   -- JSON object for extensibility
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_files_key 
  ON files(key);

CREATE INDEX IF NOT EXISTS idx_files_uploader 
  ON files(uploader_id, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_files_finder_tag 
  ON files(finder_tag);

CREATE INDEX IF NOT EXISTS idx_files_content_hash
  ON files(content_hash);
