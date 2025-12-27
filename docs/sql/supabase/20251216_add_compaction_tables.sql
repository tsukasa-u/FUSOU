-- Supabase Migration: Compaction tracking and metrics tables

-- 1. datasets テーブル（既存を想定した拡張）
CREATE TABLE IF NOT EXISTS datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name VARCHAR NOT NULL,
  
  -- Compaction状態管理
  compaction_needed BOOLEAN DEFAULT false,
  compaction_in_progress BOOLEAN DEFAULT false,
  last_compacted_at TIMESTAMPTZ,
  
  -- ファイル情報
  file_size_bytes INTEGER,
  file_etag VARCHAR,
  
  -- 圧縮結果
  compression_ratio DECIMAL(5, 2),
  row_count INTEGER,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- datasetsテーブルのインデックス
CREATE INDEX IF NOT EXISTS idx_datasets_user ON datasets(user_id);
CREATE INDEX IF NOT EXISTS idx_datasets_compaction_needed ON datasets(compaction_needed, compaction_in_progress);
CREATE INDEX IF NOT EXISTS idx_datasets_updated_at ON datasets(updated_at DESC);

-- 2. processing_metrics テーブル（ロギング・監視用）
CREATE TABLE IF NOT EXISTS processing_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  workflow_instance_id VARCHAR NOT NULL,
  
  -- === Consumer段階（_scheduled.ts / Consumer Worker） ===
  consumer_select_duration_ms INTEGER,
  consumer_update_duration_ms INTEGER,
  consumer_workflow_trigger_duration_ms INTEGER,
  consumer_total_duration_ms INTEGER,
  
  -- === Workflow段階（4-step） ===
  step1_validate_duration_ms INTEGER,
  step2_metadata_duration_ms INTEGER,
  step3_compact_duration_ms INTEGER,
  step3_parquet_analysis_duration_ms INTEGER,
  step3_r2_upload_duration_ms INTEGER,
  step4_update_metadata_duration_ms INTEGER,
  workflow_total_duration_ms INTEGER,
  
  -- === 圧縮統計 ===
  original_size_bytes INTEGER,
  compressed_size_bytes INTEGER,
  compression_ratio DECIMAL(5, 2),
  
  -- === 処理結果 ===
  status VARCHAR DEFAULT 'pending', -- pending, success, failure, dlq_failure, timeout
  error_message TEXT,
  error_step VARCHAR, -- エラーが発生したステップ名（consumer, validate-dataset, get-file-metadata, compact-with-wasm, update-metadata）
  
  -- === タイムスタンプ ===
  queued_at TIMESTAMPTZ,
  consumer_started_at TIMESTAMPTZ,
  consumer_completed_at TIMESTAMPTZ,
  workflow_started_at TIMESTAMPTZ,
  workflow_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- processing_metricsテーブルのインデックス
CREATE INDEX IF NOT EXISTS idx_metrics_dataset ON processing_metrics(dataset_id);
CREATE INDEX IF NOT EXISTS idx_metrics_workflow_instance ON processing_metrics(workflow_instance_id);
CREATE INDEX IF NOT EXISTS idx_metrics_created ON processing_metrics(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_status ON processing_metrics(status);

-- Internal analytics schema (not exposed via APIs)
CREATE SCHEMA IF NOT EXISTS analytics;

-- Remove old views from public schema if they exist
DROP VIEW IF EXISTS public.metrics_hourly_summary CASCADE;
DROP VIEW IF EXISTS public.metrics_error_analysis CASCADE;

-- パフォーマンス分析用ビュー（内部用・API非公開）
CREATE OR REPLACE VIEW analytics.metrics_hourly_summary AS
SELECT
  DATE_TRUNC('hour', created_at) as hour,
  COUNT(*) as total_count,
  COUNT(CASE WHEN status = 'success' THEN 1 END) as success_count,
  COUNT(CASE WHEN status = 'failure' THEN 1 END) as failure_count,
  ROUND(AVG(consumer_total_duration_ms), 2) as avg_consumer_duration_ms,
  ROUND(AVG(workflow_total_duration_ms), 2) as avg_workflow_duration_ms,
  ROUND(AVG(compression_ratio), 2) as avg_compression_ratio,
  ROUND(AVG(original_size_bytes), 0)::INTEGER as avg_original_size_bytes,
  MIN(created_at) as period_start,
  MAX(created_at) as period_end
FROM public.processing_metrics
GROUP BY DATE_TRUNC('hour', created_at)
ORDER BY hour DESC;

-- エラー分析用ビュー（内部用・API非公開）
CREATE OR REPLACE VIEW analytics.metrics_error_analysis AS
SELECT
  error_step,
  COUNT(*) as error_count,
  STRING_AGG(DISTINCT error_message, '; ') as error_messages,
  MAX(created_at) as latest_error_at
FROM public.processing_metrics
WHERE status = 'failure'
GROUP BY error_step
ORDER BY error_count DESC;

-- Note: Internal views (metrics_hourly_summary, metrics_error_analysis) are in the analytics schema
-- and are not exposed via Supabase APIs. Access them directly via Postgres or through authenticated functions.

-- RLS（Row Level Security）ポリシー設定
ALTER TABLE datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_metrics ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Users can see their own datasets" ON datasets;
DROP POLICY IF EXISTS "Users can update their own datasets" ON datasets;
DROP POLICY IF EXISTS "Service role can insert datasets" ON datasets;
DROP POLICY IF EXISTS "Service role can access all metrics" ON processing_metrics;
DROP POLICY IF EXISTS "Users can read metrics for their datasets" ON processing_metrics;

-- Create policies
CREATE POLICY "Users can see their own datasets" ON datasets
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own datasets" ON datasets
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert datasets" ON datasets
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Service role can access all metrics" ON processing_metrics
  FOR ALL USING (true);

CREATE POLICY "Users can read metrics for their datasets" ON processing_metrics
  FOR SELECT USING (
    dataset_id IN (SELECT id FROM datasets WHERE user_id = auth.uid())
  );
