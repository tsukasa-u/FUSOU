-- Create synergy_manifest table for tracking sp_effect_item.json generation
CREATE TABLE synergy_manifest (
  id INTEGER PRIMARY KEY,
  period_tag TEXT NOT NULL,
  period_revision INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  sp_effect_sha256 TEXT NOT NULL,
  api_start2_batch_hash TEXT NOT NULL,
  generator_version TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  upload_status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)),
  completed_at INTEGER,
  
  UNIQUE(period_tag, period_revision)
);

-- Indexes for efficient querying
CREATE INDEX idx_synergy_manifest_period_completed 
  ON synergy_manifest(period_tag, upload_status, period_revision DESC);

CREATE INDEX idx_synergy_manifest_hash 
  ON synergy_manifest(period_tag, content_hash);
