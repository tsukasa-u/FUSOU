-- ============================================================================
-- Migration: Add quest-tree inference tables to BATTLE_INDEX_DB
-- Database: dev_kc_battle_index
-- Date: 2026-04-06
-- Purpose:
--   - Store quest ingest events and snapshots
--   - Track collection sessions (gap-aware)
--   - Persist occurrence contexts and inferred rules
-- ============================================================================

CREATE TABLE IF NOT EXISTS quest_collection_sessions (
  collection_session_id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  started_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER,
  start_reason TEXT NOT NULL DEFAULT 'resume',
  has_data_gap INTEGER NOT NULL DEFAULT 0,
  bootstrap_completed_at_ms INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_qsess_dataset_started
  ON quest_collection_sessions(dataset_id, started_at_ms DESC);

CREATE TABLE IF NOT EXISTS quest_ingest_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  collection_session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  quest_id INTEGER,
  page_no INTEGER,
  timestamp_ms INTEGER NOT NULL,
  period_tag TEXT NOT NULL,
  table_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ingested',
  created_at INTEGER NOT NULL,
  UNIQUE(request_id, payload_hash),
  FOREIGN KEY(collection_session_id) REFERENCES quest_collection_sessions(collection_session_id)
);

CREATE INDEX IF NOT EXISTS idx_qingest_dataset_ts
  ON quest_ingest_events(dataset_id, timestamp_ms DESC);

CREATE TABLE IF NOT EXISTS questlist_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id TEXT NOT NULL,
  collection_session_id TEXT NOT NULL,
  page_no INTEGER NOT NULL,
  snapshot_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  visible_quest_ids_json TEXT NOT NULL,
  captured_at_ms INTEGER NOT NULL,
  period_tag TEXT NOT NULL,
  table_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(collection_session_id) REFERENCES quest_collection_sessions(collection_session_id)
);

CREATE INDEX IF NOT EXISTS idx_qlist_dataset_session_page_ts
  ON questlist_snapshots(dataset_id, collection_session_id, page_no, captured_at_ms DESC);

CREATE TABLE IF NOT EXISTS quest_state_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id TEXT NOT NULL,
  collection_session_id TEXT NOT NULL,
  quest_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  state_after TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  period_tag TEXT NOT NULL,
  table_version TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(collection_session_id) REFERENCES quest_collection_sessions(collection_session_id)
);

CREATE INDEX IF NOT EXISTS idx_qstate_dataset_quest_ts
  ON quest_state_events(dataset_id, quest_id, timestamp_ms DESC);

CREATE TABLE IF NOT EXISTS quest_state_latest (
  dataset_id TEXT NOT NULL,
  quest_id INTEGER NOT NULL,
  collection_session_id TEXT NOT NULL,
  state TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  last_event_type TEXT NOT NULL,
  period_tag TEXT NOT NULL,
  table_version TEXT NOT NULL,
  is_claimed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(dataset_id, quest_id),
  FOREIGN KEY(collection_session_id) REFERENCES quest_collection_sessions(collection_session_id)
);

CREATE TABLE IF NOT EXISTS quest_appearance_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id TEXT NOT NULL,
  collection_session_id TEXT NOT NULL,
  target_quest_id INTEGER NOT NULL,
  appeared_at_ms INTEGER NOT NULL,
  source_event_type TEXT NOT NULL,
  source_event_id INTEGER,
  period_tag TEXT NOT NULL,
  table_version TEXT NOT NULL,
  is_bootstrap_unknown INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(dataset_id, collection_session_id, target_quest_id, appeared_at_ms),
  FOREIGN KEY(collection_session_id) REFERENCES quest_collection_sessions(collection_session_id)
);

CREATE INDEX IF NOT EXISTS idx_qappear_dataset_ts
  ON quest_appearance_events(dataset_id, appeared_at_ms DESC);

CREATE TABLE IF NOT EXISTS quest_inference_tasks (
  task_id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  collection_session_id TEXT NOT NULL,
  from_ts INTEGER NOT NULL,
  to_ts INTEGER NOT NULL,
  status TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(collection_session_id) REFERENCES quest_collection_sessions(collection_session_id)
);

CREATE INDEX IF NOT EXISTS idx_qtask_status_created
  ON quest_inference_tasks(status, created_at);

CREATE TABLE IF NOT EXISTS quest_occurrence_contexts (
  occurrence_id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  collection_session_id TEXT NOT NULL,
  target_quest_id INTEGER NOT NULL,
  occurred_at_ms INTEGER NOT NULL,
  period_tag TEXT NOT NULL,
  table_version TEXT NOT NULL,
  is_bootstrap_unknown INTEGER NOT NULL DEFAULT 0,
  has_cross_session_inference INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(collection_session_id) REFERENCES quest_collection_sessions(collection_session_id)
);

CREATE INDEX IF NOT EXISTS idx_qocc_target_period
  ON quest_occurrence_contexts(target_quest_id, period_tag, table_version);

CREATE TABLE IF NOT EXISTS quest_occurrence_prerequisites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurrence_id TEXT NOT NULL,
  quest_id INTEGER NOT NULL,
  is_recent INTEGER NOT NULL DEFAULT 0,
  is_completed INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE(occurrence_id, quest_id),
  FOREIGN KEY(occurrence_id) REFERENCES quest_occurrence_contexts(occurrence_id)
);

CREATE INDEX IF NOT EXISTS idx_qopr_occurrence
  ON quest_occurrence_prerequisites(occurrence_id);

CREATE TABLE IF NOT EXISTS quest_rule_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_quest_id INTEGER NOT NULL,
  prereq_set_hash TEXT NOT NULL,
  prereq_set_json TEXT NOT NULL,
  set_size INTEGER NOT NULL,
  support INTEGER NOT NULL,
  exposure INTEGER NOT NULL,
  confidence REAL NOT NULL,
  lift REAL NOT NULL,
  score REAL NOT NULL,
  period_tag TEXT NOT NULL,
  table_version TEXT NOT NULL,
  quality_tier TEXT NOT NULL DEFAULT 'high',
  updated_at_ms INTEGER NOT NULL,
  UNIQUE(target_quest_id, prereq_set_hash, period_tag, table_version)
);

CREATE INDEX IF NOT EXISTS idx_qrulecand_target_set
  ON quest_rule_candidates(target_quest_id, set_size, period_tag, table_version);

CREATE TABLE IF NOT EXISTS quest_rule_edges (
  rule_id TEXT PRIMARY KEY,
  target_quest_id INTEGER NOT NULL,
  prereq_set_json TEXT NOT NULL,
  set_size INTEGER NOT NULL,
  class TEXT NOT NULL,
  support INTEGER NOT NULL,
  confidence REAL NOT NULL,
  lift REAL NOT NULL,
  score REAL NOT NULL,
  period_tag TEXT NOT NULL,
  table_version TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  quality_tier TEXT NOT NULL DEFAULT 'high',
  updated_at_ms INTEGER NOT NULL,
  UNIQUE(target_quest_id, prereq_set_json, period_tag, table_version)
);

CREATE INDEX IF NOT EXISTS idx_qruleedge_target_period_primary
  ON quest_rule_edges(target_quest_id, period_tag, table_version, is_primary);
