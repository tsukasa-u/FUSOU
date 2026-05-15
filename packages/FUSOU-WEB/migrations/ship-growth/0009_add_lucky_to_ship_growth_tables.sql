-- ============================================================================
-- Migration: Add lucky (運) parameter to ship growth derived tables
-- Date: 2026-04-19
-- Purpose: Collect ship luck value alongside kaihi/taisen/sakuteki naked stats.
--          - lucky_naked: minimum observed naked luck value at (master_id, lv)
--          New columns default to 0 to preserve backwards compatibility with
--          existing rows that pre-date luck collection.
-- ============================================================================

ALTER TABLE ship_growth_bounds ADD COLUMN lucky_naked INTEGER NOT NULL DEFAULT 0;
