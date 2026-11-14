-- Migration: Lightweight quest collection and storage compaction
-- Drops dead Worker-based inference tables and quest_state_latest (zero readers),
-- removes redundant indexes, caps questlist_snapshots to the latest global snapshot
-- per dataset without full JSON payload blobs, deduplicates quest_master_entries to
-- one canonical row per quest_id, and prunes stale quest_ingest_events idempotency logs.

-- 1. Drop dead legacy inference tables (prerequisites first due to FK on occurrence_id)
DROP TABLE IF EXISTS quest_occurrence_prerequisites;
DROP TABLE IF EXISTS quest_occurrence_contexts;
DROP TABLE IF EXISTS quest_inference_tasks;
DROP TABLE IF EXISTS quest_rule_candidates;

-- 2. Drop unread mirror table
DROP TABLE IF EXISTS quest_state_latest;

-- 3. Drop duplicate session index (idx_qsess_dataset_started_unique already covers (dataset_id, started_at_ms))
DROP INDEX IF EXISTS idx_qsess_dataset_started;

-- 4. Prune legacy non-'all' rule edges once the canonical 'all'/'all' scope has been published
DELETE FROM quest_rule_edges
WHERE (period_tag != 'all' OR table_version != 'all')
  AND EXISTS (
    SELECT 1
    FROM quest_rule_edges
    WHERE period_tag = 'all'
      AND table_version = 'all'
  );

-- 5. Rebuild questlist_snapshots without snapshot_json / redundant metadata,
--    retaining only the latest page_no = 0 row per dataset for active session diffing.
CREATE TABLE IF NOT EXISTS questlist_snapshots_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id TEXT NOT NULL,
  collection_session_id TEXT NOT NULL,
  page_no INTEGER NOT NULL,
  visible_quest_ids_json TEXT NOT NULL,
  captured_at_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(dataset_id, page_no),
  FOREIGN KEY(collection_session_id) REFERENCES quest_collection_sessions(collection_session_id)
);

INSERT OR IGNORE INTO questlist_snapshots_new (
  dataset_id,
  collection_session_id,
  page_no,
  visible_quest_ids_json,
  captured_at_ms,
  created_at
)
SELECT q.dataset_id,
       q.collection_session_id,
       q.page_no,
       q.visible_quest_ids_json,
       q.captured_at_ms,
       q.created_at
FROM questlist_snapshots q
WHERE q.page_no = 0
  AND q.id = (
    SELECT q2.id
    FROM questlist_snapshots q2
    WHERE q2.dataset_id = q.dataset_id
      AND q2.page_no = 0
    ORDER BY q2.captured_at_ms DESC, q2.id DESC
    LIMIT 1
  );

DROP INDEX IF EXISTS idx_qlist_dataset_session_page_ts;
DROP TABLE questlist_snapshots;
ALTER TABLE questlist_snapshots_new RENAME TO questlist_snapshots;

-- 6. Rebuild quest_master_entries keyed solely by quest_id,
--    deduplicating per-period / per-table-version copies into the latest entry per quest.
CREATE TABLE IF NOT EXISTS quest_master_entries_new (
  quest_id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  quest_type INTEGER NOT NULL,
  category INTEGER NOT NULL,
  label_type INTEGER NOT NULL,
  master_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO quest_master_entries_new (
  quest_id,
  title,
  detail,
  quest_type,
  category,
  label_type,
  master_hash,
  created_at,
  updated_at
)
SELECT m.quest_id,
       m.title,
       m.detail,
       m.quest_type,
       m.category,
       m.label_type,
       m.master_hash,
       m.created_at,
       m.updated_at
FROM quest_master_entries m
WHERE NOT EXISTS (
  SELECT 1
  FROM quest_master_entries m2
  WHERE m2.quest_id = m.quest_id
    AND (
      m2.updated_at > m.updated_at
      OR (
        m2.updated_at = m.updated_at
        AND (
          m2.period_tag > m.period_tag
          OR (m2.period_tag = m.period_tag AND m2.table_version > m.table_version)
        )
      )
    )
);

DROP INDEX IF EXISTS idx_qmaster_period_table;
DROP TABLE quest_master_entries;
ALTER TABLE quest_master_entries_new RENAME TO quest_master_entries;

-- 7. Prune expired quest_ingest_events idempotency logs (> 14 days) and replace unused index
--    with a compact created_at index for bounded per-session cleanup.
DROP INDEX IF EXISTS idx_qingest_dataset_ts;
DELETE FROM quest_ingest_events
WHERE created_at < (CAST(strftime('%s', 'now') AS INTEGER) * 1000 - 1209600000);
CREATE INDEX IF NOT EXISTS idx_qingest_created_at
  ON quest_ingest_events(created_at);
