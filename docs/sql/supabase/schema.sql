-- ============================================================================
-- Supabase PostgreSQL Schema - FUSOU Compaction Management
-- ============================================================================
-- This schema manages compaction state, processing metrics, and dataset tracking.
-- It integrates with Cloudflare Workers and Edge Functions for workflow orchestration.
--
-- Database: PostgreSQL (Supabase)
-- Generated: 2025-12-17 via CLI introspection
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- Main Compaction Management Tables
-- ============================================================================

-- Datasets: Tracks dataset metadata and compaction state
CREATE TABLE IF NOT EXISTS public.datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dataset_name VARCHAR(255) NOT NULL,
  dataset_ref VARCHAR(255) NOT NULL UNIQUE,
  
  -- Compaction state management
  compaction_needed BOOLEAN DEFAULT FALSE,
  compaction_in_progress BOOLEAN DEFAULT FALSE,
  last_compacted_at TIMESTAMPTZ,
  
  -- File metadata after compaction
  file_size_bytes INTEGER,
  file_etag VARCHAR(255),
  compression_ratio DECIMAL(5, 2),
  row_count INTEGER,
  
  -- Audit trail
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT datasets_user_dataset_unique UNIQUE (user_id, dataset_name)
);

CREATE INDEX IF NOT EXISTS idx_datasets_user_id ON public.datasets(user_id);
CREATE INDEX IF NOT EXISTS idx_datasets_compaction_needed ON public.datasets(compaction_needed) WHERE compaction_needed = TRUE;
CREATE INDEX IF NOT EXISTS idx_datasets_compaction_in_progress ON public.datasets(compaction_in_progress) WHERE compaction_in_progress = TRUE;
CREATE INDEX IF NOT EXISTS idx_datasets_last_compacted_at ON public.datasets(last_compacted_at DESC);

-- Processing Metrics: Records performance metrics for each compaction workflow
CREATE TABLE IF NOT EXISTS public.processing_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  
  -- Workflow execution identification
  workflow_instance_id VARCHAR(255) NOT NULL UNIQUE,
  workflow_triggered_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  
  -- Queue consumer timing
  consumer_select_duration_ms INTEGER,
  consumer_update_duration_ms INTEGER,
  consumer_workflow_trigger_duration_ms INTEGER,
  consumer_total_duration_ms INTEGER,
  
  -- Workflow step durations (milliseconds)
  step1_validate_duration_ms INTEGER,
  step2_metadata_duration_ms INTEGER,
  step3_list_fragments_duration_ms INTEGER,
  step4_extract_duration_ms INTEGER,
  step5_merge_duration_ms INTEGER,
  step6_finalize_duration_ms INTEGER,
  
  -- Workflow execution result
  workflow_total_duration_ms INTEGER,
  workflow_status VARCHAR(50) DEFAULT 'PENDING',  -- PENDING, RUNNING, COMPLETED, FAILED
  error_message TEXT,
  
  -- Fragment statistics
  fragments_total INTEGER,
  fragments_modern_count INTEGER,  -- Fragments with offset metadata
  fragments_legacy_count INTEGER,  -- Fragments without offset metadata
  
  -- Data processing statistics
  bytes_processed INTEGER,
  tables_extracted INTEGER,
  tables_merged INTEGER,
  
  -- Performance indicators
  avg_fragment_size_bytes INTEGER,
  compression_ratio DECIMAL(5, 2),
  
  -- Audit trail
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_processing_metrics_dataset_id ON public.processing_metrics(dataset_id);
CREATE INDEX IF NOT EXISTS idx_processing_metrics_workflow_id ON public.processing_metrics(workflow_instance_id);
CREATE INDEX IF NOT EXISTS idx_processing_metrics_status ON public.processing_metrics(workflow_status);
CREATE INDEX IF NOT EXISTS idx_processing_metrics_triggered_at ON public.processing_metrics(workflow_triggered_at DESC);

-- ============================================================================
-- Audit and Tracking
-- ============================================================================

-- Compaction History: Audit log for all compaction operations
CREATE TABLE IF NOT EXISTS public.compaction_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,  -- STARTED, COMPLETED, FAILED, CANCELLED
  event_timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_compaction_history_dataset_id ON public.compaction_history(dataset_id);
CREATE INDEX IF NOT EXISTS idx_compaction_history_event_type ON public.compaction_history(event_type);
CREATE INDEX IF NOT EXISTS idx_compaction_history_timestamp ON public.compaction_history(event_timestamp DESC);

-- ============================================================================
-- Row-Level Security Policies
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processing_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compaction_history ENABLE ROW LEVEL SECURITY;

-- Datasets: Users can only see their own datasets
CREATE POLICY "datasets_user_isolation" ON public.datasets
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "datasets_user_insert" ON public.datasets
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "datasets_user_update" ON public.datasets
  FOR UPDATE USING (auth.uid() = user_id);

-- Processing Metrics: Visible through datasets
CREATE POLICY "processing_metrics_user_isolation" ON public.processing_metrics
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.datasets
      WHERE id = processing_metrics.dataset_id
      AND user_id = auth.uid()
    )
  );

-- Compaction History: Visible through datasets
CREATE POLICY "compaction_history_user_isolation" ON public.compaction_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.datasets
      WHERE id = compaction_history.dataset_id
      AND user_id = auth.uid()
    )
  );

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Update timestamp on record modification
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_datasets_timestamp
BEFORE UPDATE ON public.datasets
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_processing_metrics_timestamp
BEFORE UPDATE ON public.processing_metrics
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- ============================================================================
-- Views for Monitoring and Reporting
-- ============================================================================

-- Latest compaction status for each dataset
CREATE OR REPLACE VIEW public.datasets_latest_status AS
SELECT
  d.id,
  d.user_id,
  d.dataset_name,
  d.compaction_needed,
  d.compaction_in_progress,
  d.last_compacted_at,
  d.file_size_bytes,
  d.compression_ratio,
  pm.workflow_instance_id,
  pm.workflow_total_duration_ms,
  pm.workflow_status
FROM public.datasets d
LEFT JOIN public.processing_metrics pm ON pm.dataset_id = d.id
WHERE (pm.created_at IS NULL OR pm.created_at = (
  SELECT MAX(created_at)
  FROM public.processing_metrics
  WHERE dataset_id = d.id
));

-- Compaction performance summary
CREATE OR REPLACE VIEW public.compaction_performance_summary AS
SELECT
  d.id,
  d.dataset_name,
  COUNT(pm.id) as compaction_count,
  AVG(pm.workflow_total_duration_ms) as avg_duration_ms,
  MIN(pm.workflow_total_duration_ms) as min_duration_ms,
  MAX(pm.workflow_total_duration_ms) as max_duration_ms,
  AVG(pm.compression_ratio) as avg_compression_ratio,
  MAX(pm.created_at) as last_execution
FROM public.datasets d
LEFT JOIN public.processing_metrics pm ON pm.dataset_id = d.id AND pm.workflow_status = 'COMPLETED'
GROUP BY d.id, d.dataset_name;

-- ============================================================================
-- Grants for RLS and Policies
-- ============================================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.datasets TO authenticated;
GRANT SELECT, INSERT ON public.processing_metrics TO authenticated, service_role;
GRANT SELECT, INSERT ON public.compaction_history TO authenticated, service_role;
