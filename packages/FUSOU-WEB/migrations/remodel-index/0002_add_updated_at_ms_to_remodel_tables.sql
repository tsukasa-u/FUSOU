-- ============================================================================
-- Migration: Add updated_at_ms to remodel ingestion tables
-- Date: 2026-04-19
-- Purpose: Enable incremental (delta) snapshot refresh for remodel summary API.
-- ============================================================================

ALTER TABLE remodel_slotlist_entries
  ADD COLUMN updated_at_ms INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_rslot_updated_at_ms
  ON remodel_slotlist_entries(updated_at_ms);

ALTER TABLE remodel_detail_entries
  ADD COLUMN updated_at_ms INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_rdetail_updated_at_ms
  ON remodel_detail_entries(updated_at_ms);
