-- D1 Metrics Schema for Compaction Workflow
-- Tracks per-run outcomes for analytics (Supabase removed)

CREATE TABLE IF NOT EXISTS compaction_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success','failure')),
  workflow_total_duration_ms INTEGER NOT NULL,
  compression_ratio REAL,
  original_size_bytes INTEGER,
  error_step TEXT,
  error_message TEXT,
  created_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_compaction_metrics_dataset ON compaction_metrics(dataset_id);
CREATE INDEX IF NOT EXISTS idx_compaction_metrics_created ON compaction_metrics(created_at);
CREATE INDEX IF NOT EXISTS idx_compaction_metrics_status ON compaction_metrics(status);
