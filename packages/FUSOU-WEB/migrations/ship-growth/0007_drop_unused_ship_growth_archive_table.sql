-- ============================================================================
-- Migration: Drop unused ship_growth_archive table
-- Date: 2026-04-10
-- Purpose:
--   - ship growth archive storage moved to R2 objects
--   - remove obsolete D1 table to avoid operational confusion
-- ============================================================================

DROP TABLE IF EXISTS ship_growth_archive;
