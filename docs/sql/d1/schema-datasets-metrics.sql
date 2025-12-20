-- ============================================================================
-- D1 Schema: Dataset Management (replaces Supabase tables)
-- ============================================================================
-- This schema consolidates datasets in D1 for:
-- 1. Cost efficiency (Cloudflare Free tier, no 500MB limit)
-- 2. Compaction state management (flags + metadata)
-- 3. Unified data model (single source of truth)
-- ============================================================================

-- ============================================================================
-- Datasets Table
-- ============================================================================
-- Tracks compaction state for each dataset/table combination
-- Migrated from Supabase to D1
-- ============================================================================

CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  dataset_name TEXT NOT NULL,
  dataset_ref TEXT NOT NULL UNIQUE,
  
  -- Compaction state management
  compaction_needed BOOLEAN DEFAULT FALSE,
  compaction_in_progress BOOLEAN DEFAULT FALSE,
  last_compacted_at TEXT,  -- ISO 8601 timestamp
  
  -- File metadata after compaction
  file_size_bytes INTEGER,
  file_etag TEXT,
  compression_ratio REAL,
  row_count INTEGER,
  
  -- Audit trail
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_datasets_user_id ON datasets(user_id);
CREATE INDEX IF NOT EXISTS idx_datasets_compaction_needed ON datasets(compaction_needed) WHERE compaction_needed = 1;
CREATE INDEX IF NOT EXISTS idx_datasets_compaction_in_progress ON datasets(compaction_in_progress) WHERE compaction_in_progress = 1;
CREATE INDEX IF NOT EXISTS idx_datasets_last_compacted_at ON datasets(last_compacted_at DESC);
