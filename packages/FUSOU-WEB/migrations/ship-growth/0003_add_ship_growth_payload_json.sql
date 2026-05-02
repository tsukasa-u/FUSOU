-- ============================================================================
-- Migration: Preserve full ship-growth upload payload for reconstruction
-- Date: 2026-04-09
-- ============================================================================

ALTER TABLE ship_growth_ingest_events
  ADD COLUMN payload_json TEXT;
