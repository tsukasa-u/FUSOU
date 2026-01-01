-- ============================================================================
-- Supabase Cleanup Script
-- Drops legacy tables and functions moved to D1
-- ============================================================================

DROP FUNCTION IF EXISTS rpc_ensure_dataset(text, text, text, text);
DROP TABLE IF EXISTS compaction_history;
DROP TABLE IF EXISTS processing_metrics;
DROP TABLE IF EXISTS datasets;
