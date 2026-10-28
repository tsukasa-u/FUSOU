CREATE TABLE IF NOT EXISTS workflow_queue_receipts (
  message_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_compaction_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  run_id TEXT,
  owner TEXT,
  cutoff_id INTEGER,
  started_at INTEGER,
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1))
);

INSERT OR IGNORE INTO workflow_compaction_state (id) VALUES (1);
