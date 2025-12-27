-- Compaction Dashboard SQL Functions
-- これらを Supabase SQL Editor で実行してください

-- ===== Status Summary Function =====
CREATE OR REPLACE FUNCTION get_compaction_status_summary()
RETURNS TABLE (
  status TEXT,
  count BIGINT,
  avg_duration_ms INTEGER,
  last_updated TIMESTAMPTZ
) 
LANGUAGE sql
STABLE
AS $$
  SELECT 
    status::TEXT,
    COUNT(*) as count,
    ROUND(AVG(workflow_total_duration_ms))::INTEGER as avg_duration_ms,
    MAX(updated_at) as last_updated
  FROM processing_metrics
  WHERE created_at > NOW() - INTERVAL '24 hours'
  GROUP BY status
  ORDER BY count DESC;
$$;

-- ===== Compression Performance Summary =====
CREATE OR REPLACE FUNCTION get_compression_performance()
RETURNS TABLE (
  avg_compression_ratio NUMERIC,
  total_original_bytes BIGINT,
  total_compressed_bytes BIGINT,
  space_saved_bytes BIGINT,
  space_saved_percentage NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT 
    ROUND(AVG(compression_ratio), 2) as avg_compression_ratio,
    SUM(original_size_bytes) as total_original_bytes,
    SUM(compacted_size_bytes) as total_compressed_bytes,
    SUM(original_size_bytes - compacted_size_bytes) as space_saved_bytes,
    ROUND(
      100.0 * SUM(original_size_bytes - compacted_size_bytes) / 
      NULLIF(SUM(original_size_bytes), 0), 
      2
    ) as space_saved_percentage
  FROM processing_metrics
  WHERE status = 'success'
    AND created_at > NOW() - INTERVAL '7 days';
$$;

-- ===== DLQ Alert Function =====
CREATE OR REPLACE FUNCTION get_dlq_alerts()
RETURNS TABLE (
  dataset_id UUID,
  error_step TEXT,
  error_message TEXT,
  retry_count INTEGER,
  failed_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
  SELECT 
    dataset_id,
    error_step,
    error_message,
    COALESCE(
      (workflow_metadata->>'retry_count')::INTEGER, 
      0
    ) as retry_count,
    updated_at as failed_at
  FROM processing_metrics
  WHERE status = 'dlq_failure'
  ORDER BY updated_at DESC
  LIMIT 20;
$$;

-- ===== Grant Permissions (authenticated users can read) =====
GRANT EXECUTE ON FUNCTION get_compaction_status_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION get_compression_performance() TO authenticated;
GRANT EXECUTE ON FUNCTION get_dlq_alerts() TO authenticated;

-- ===== Usage Examples =====
-- SELECT * FROM get_compaction_status_summary();
-- SELECT * FROM get_compression_performance();
-- SELECT * FROM get_dlq_alerts();
