-- ============================================================================
-- Migration: Drop ship-growth dedupe/event tables and strengthen archive indexes
-- Date: 2026-04-10
-- Purpose:
--   - Remove ship_growth_payload_registry
--   - Remove ship_growth_ingest_events
--   - Add lookup indexes for active archive usage
-- ============================================================================

DROP TABLE IF EXISTS ship_growth_payload_registry;
DROP TABLE IF EXISTS ship_growth_ingest_events;

CREATE INDEX IF NOT EXISTS idx_sgarchive_period_new
  ON ship_growth_archive(period_tag_new, master_id, lv);

CREATE INDEX IF NOT EXISTS idx_sgarchive_archived_at
  ON ship_growth_archive(archived_at);
