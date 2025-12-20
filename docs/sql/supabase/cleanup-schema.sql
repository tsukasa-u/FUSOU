-- ============================================================================
-- Supabase Cleanup: Remove Dataset Management Tables & Functions
-- ============================================================================
-- Consolidate to D1 for cost control and unified architecture
-- Keep auth tables only
-- ============================================================================

-- Drop dependent views first
DROP VIEW IF EXISTS analytics.metrics_hourly_summary;
DROP VIEW IF EXISTS analytics.metrics_error_analysis;

-- Drop RPC functions
DROP FUNCTION IF EXISTS public.rpc_ensure_dataset(text, text, text, text);

-- Drop tables (now managed in D1 only)
DROP TABLE IF EXISTS public.compaction_history;
DROP TABLE IF EXISTS public.processing_metrics;
DROP TABLE IF EXISTS public.datasets;

-- ============================================================================
-- Summary: Supabase now auth-only
-- D1 handles: datasets (state management only)
-- ===========================================================================
