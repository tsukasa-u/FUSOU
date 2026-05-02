-- ============================================================================
-- Migration: Add global payload registry for ship-growth deduplication
-- Date: 2026-04-09
-- ============================================================================

CREATE TABLE IF NOT EXISTS ship_growth_payload_registry (
  period_tag        TEXT NOT NULL,
  table_version     TEXT NOT NULL,
  payload_hash      TEXT NOT NULL,
  first_request_id  TEXT NOT NULL,
  first_dataset_id  TEXT NOT NULL,
  first_created_at  INTEGER NOT NULL,
  last_seen_at      INTEGER NOT NULL,
  seen_count        INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (period_tag, table_version, payload_hash)
);

CREATE INDEX IF NOT EXISTS idx_sg_payload_registry_last_seen
  ON ship_growth_payload_registry(last_seen_at);
