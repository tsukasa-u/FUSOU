-- ============================================================================
-- Unified D1 Schema for FUSOU
-- Architectures: Ingestion, Archival, Assets, Datasets
-- Database: dev_kc_battle_index
-- ============================================================================

-- ============================================================================
-- 1. Ingestion Buffer (Fallback for TiDB)
-- ============================================================================
CREATE TABLE IF NOT EXISTS buffer_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id TEXT NOT NULL,
    table_name TEXT NOT NULL,
    period_tag TEXT NOT NULL,
    schema_version TEXT DEFAULT 'v1',
    timestamp INTEGER NOT NULL,
    data BLOB NOT NULL,
    uploaded_by TEXT,
    created_at INTEGER DEFAULT (unixepoch('now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_buffer_logs_dataset ON buffer_logs(dataset_id);
CREATE INDEX IF NOT EXISTS idx_buffer_logs_upload ON buffer_logs(uploaded_by);

-- ============================================================================
-- 2. Archival Metadata (Avro OCF)
-- ============================================================================
CREATE TABLE IF NOT EXISTS archived_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL UNIQUE,
    file_size INTEGER,
    compression_codec TEXT,
    schema_version TEXT,
    created_at INTEGER,
    last_modified_at INTEGER
);

CREATE TABLE IF NOT EXISTS block_indexes (
    dataset_id TEXT NOT NULL,
    table_name TEXT NOT NULL,
    schema_version TEXT,
    period_tag TEXT,
    file_id INTEGER NOT NULL,
    start_byte INTEGER NOT NULL,
    length INTEGER NOT NULL,
    record_count INTEGER,
    start_timestamp INTEGER,
    end_timestamp INTEGER,
    PRIMARY KEY (dataset_id, file_id),
    FOREIGN KEY (file_id) REFERENCES archived_files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_block_indexes_table_period ON block_indexes(table_name, period_tag);
CREATE INDEX IF NOT EXISTS idx_block_indexes_time ON block_indexes(start_timestamp);

-- ============================================================================
-- 3. Datasets Management
-- ============================================================================
CREATE TABLE IF NOT EXISTS datasets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    dataset_name TEXT NOT NULL,
    dataset_ref TEXT NOT NULL UNIQUE,
    
    -- Compaction/Archival flags
    compaction_needed BOOLEAN DEFAULT FALSE,
    compaction_in_progress BOOLEAN DEFAULT FALSE,
    last_compacted_at TEXT,  -- ISO 8601 timestamp
    
    -- Metadata
    file_size_bytes INTEGER,
    file_etag TEXT,
    compression_ratio REAL,
    row_count INTEGER,
    
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_datasets_user_id ON datasets(user_id);
CREATE INDEX IF NOT EXISTS idx_datasets_compaction ON datasets(compaction_needed) WHERE compaction_needed = 1;

-- ============================================================================
-- 4. Asset Files Index
-- ============================================================================
CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    size INTEGER NOT NULL,
    content_type TEXT DEFAULT "application/octet-stream",
    content_hash TEXT,
    uploaded_at INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    uploader_id TEXT NOT NULL,
    finder_tag TEXT DEFAULT NULL,
    metadata TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_files_key ON files(key);
CREATE INDEX IF NOT EXISTS idx_files_uploader ON files(uploader_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_finder_tag ON files(finder_tag);
