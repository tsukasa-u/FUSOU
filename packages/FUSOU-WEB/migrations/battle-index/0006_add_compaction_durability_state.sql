-- Migration: Persist D1/R2 compaction durability and source-consumption state
-- Scope: battle-index

ALTER TABLE archived_files ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE archived_files ADD COLUMN output_etag TEXT;
ALTER TABLE archived_files ADD COLUMN output_verified_at_ms INTEGER;
ALTER TABLE archived_files ADD COLUMN source_cleanup_completed_at_ms INTEGER;
ALTER TABLE archived_files ADD COLUMN output_error TEXT;

UPDATE archived_files
SET lifecycle_state = 'pending'
WHERE lifecycle_state = 'ready'
  AND compression_codec = 'pending';

CREATE INDEX IF NOT EXISTS idx_archived_files_lifecycle_state
  ON archived_files(lifecycle_state, last_modified_at);

CREATE TABLE compaction_output_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  output_file_id INTEGER NOT NULL,
  source_file_id INTEGER NOT NULL,
  source_file_path TEXT NOT NULL,
  archived_source_path TEXT NOT NULL,
  source_r2_state TEXT NOT NULL DEFAULT 'pending',
  source_d1_state TEXT NOT NULL DEFAULT 'active',
  created_at_ms INTEGER NOT NULL,
  moved_at_ms INTEGER,
  d1_deleted_at_ms INTEGER,
  UNIQUE(output_file_id, source_file_id),
  FOREIGN KEY(output_file_id) REFERENCES archived_files(id)
);

CREATE INDEX IF NOT EXISTS idx_compaction_output_sources_output_state
  ON compaction_output_sources(output_file_id, source_r2_state, source_d1_state);

CREATE INDEX IF NOT EXISTS idx_compaction_output_sources_source
  ON compaction_output_sources(source_file_id, source_d1_state);
