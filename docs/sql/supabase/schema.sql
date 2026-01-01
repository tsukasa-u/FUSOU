-- ============================================================================
-- Unified Supabase Schema for FUSOU
-- Architectures: Authentication, Core Data (Legacy/Transition), Fleets
-- ============================================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- 1. Authentication & Security (Secure Data Distribution)
-- ============================================================================

-- Table: api_keys
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    key TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_email ON api_keys(LOWER(email));

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_api_keys_updated_at
    BEFORE UPDATE ON api_keys
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Table: trusted_devices
CREATE TABLE IF NOT EXISTS trusted_devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL,
    device_name TEXT,
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_user_device UNIQUE (user_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_trusted_devices_user_client 
    ON trusted_devices(user_id, client_id);

-- Table: verification_codes
CREATE TABLE IF NOT EXISTS verification_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    is_used BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_active_code UNIQUE (user_id, client_id, code)
);

CREATE INDEX IF NOT EXISTS idx_verification_codes_lookup 
    ON verification_codes(user_id, client_id, code, expires_at);

-- RLS Policies for Auth
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE trusted_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own api_keys" ON api_keys FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own api_keys" ON api_keys FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own api_keys" ON api_keys FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own api_keys" ON api_keys FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own trusted_devices" ON trusted_devices FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own trusted_devices" ON trusted_devices FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own trusted_devices" ON trusted_devices FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own verification_codes" ON verification_codes FOR SELECT USING (auth.uid() = user_id);

-- Cleanup Function
CREATE OR REPLACE FUNCTION cleanup_expired_verification_codes()
RETURNS void AS $$
BEGIN
    DELETE FROM verification_codes
    WHERE (expires_at < NOW() - INTERVAL '30 days')
       OR (is_used = true AND created_at < NOW() - INTERVAL '30 days');
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 2. Core Data (Datasets & Metrics)
-- Note: Logic transitioning to D1, but kept for legacy/compatibility
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dataset_name VARCHAR(255),
  dataset_ref VARCHAR(255) UNIQUE NOT NULL, -- Logical ID (e.g., organization/dataset-slug)
  
  -- State flags
  compaction_needed BOOLEAN DEFAULT FALSE,
  compaction_in_progress BOOLEAN DEFAULT FALSE,
  last_compacted_at TIMESTAMPTZ,
  
  -- Metadata
  file_size_bytes BIGINT,
  file_etag VARCHAR(255),
  compression_ratio DECIMAL(5, 2),
  row_count BIGINT,
  
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_datasets_user_id ON public.datasets(user_id);
CREATE INDEX IF NOT EXISTS idx_datasets_compaction_needed ON public.datasets(compaction_needed) WHERE compaction_needed = TRUE;

CREATE TABLE IF NOT EXISTS public.processing_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  workflow_instance_id VARCHAR(255),
  workflow_status VARCHAR(50) NOT NULL, -- QUEUED, RUNNING, COMPLETED, FAILED
  workflow_triggered_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  workflow_completed_at TIMESTAMPTZ,
  workflow_total_duration_ms INTEGER,
  
  error_message TEXT,
  error_step VARCHAR(100),
  retry_count INTEGER DEFAULT 0,
  
  files_processed INTEGER,
  fragments_merged_count INTEGER,
  fragments_legacy_count INTEGER,
  bytes_processed INTEGER,
  tables_extracted INTEGER,
  tables_merged INTEGER,
  avg_fragment_size_bytes INTEGER,
  compression_ratio DECIMAL(5, 2),
  
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_processing_metrics_dataset_id ON public.processing_metrics(dataset_id);

CREATE TABLE IF NOT EXISTS public.compaction_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  event_timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processing_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compaction_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "datasets_user_isolation" ON public.datasets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "datasets_user_insert" ON public.datasets FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "datasets_user_update" ON public.datasets FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "processing_metrics_user_isolation" ON public.processing_metrics FOR SELECT USING (EXISTS (SELECT 1 FROM public.datasets WHERE id = processing_metrics.dataset_id AND user_id = auth.uid()));
CREATE POLICY "compaction_history_user_isolation" ON public.compaction_history FOR SELECT USING (EXISTS (SELECT 1 FROM public.datasets WHERE id = compaction_history.dataset_id AND user_id = auth.uid()));

-- Triggers for timestamps
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_datasets_timestamp BEFORE UPDATE ON public.datasets FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_processing_metrics_timestamp BEFORE UPDATE ON public.processing_metrics FOR EACH ROW EXECUTE FUNCTION update_timestamp();


-- ============================================================================
-- 3. Game Data (Fleets)
-- ============================================================================

CREATE TABLE IF NOT EXISTS fleets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  tag text NOT NULL,
  title text,
  r2_key text,
  size_bytes integer,
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_public boolean NOT NULL DEFAULT false,
  share_token text,
  retention_policy text,
  UNIQUE (owner_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_fleets_owner_tag ON fleets (owner_id, tag);
CREATE INDEX IF NOT EXISTS idx_fleets_share_token ON fleets (share_token);

ALTER TABLE fleets ENABLE ROW LEVEL SECURITY;

CREATE POLICY fleets_owner_full_access ON fleets USING (owner_id = auth.uid()::uuid) WITH CHECK (owner_id = auth.uid()::uuid);
CREATE POLICY fleets_public_select ON fleets FOR SELECT USING (is_public = true);

-- ============================================================================
-- Grants
-- ============================================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.datasets TO authenticated;
GRANT SELECT, INSERT ON public.processing_metrics TO authenticated, service_role;
GRANT SELECT, INSERT ON public.compaction_history TO authenticated, service_role;
-- ============================================================================
-- Fix: Allow service_role to call rpc_ensure_dataset for Workflow
-- ============================================================================
-- Problem: Workflow uses service_role key, but RPC checks auth.uid() which is null
-- Solution: Skip auth check when called by service_role (has elevated privileges)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_ensure_dataset(
  dataset_id text,
  user_id text,
  table_name text DEFAULT NULL,
  period_tag text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_result jsonb;
  v_existing record;
  v_user_id_uuid uuid;
  v_is_service_role boolean;
BEGIN
  -- Convert user_id text to UUID
  v_user_id_uuid := user_id::uuid;

  -- Check if caller is service_role (bypasses RLS and auth checks)
  -- Service role has elevated privileges and is used by Cloudflare Workers
  v_is_service_role := (current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role');

  -- Verify ownership ONLY if not service_role
  IF NOT v_is_service_role THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Unauthorized: No authenticated user';
    END IF;
    IF auth.uid() <> v_user_id_uuid THEN
      RAISE EXCEPTION 'Unauthorized: user_id does not match authenticated user';
    END IF;
  END IF;

  IF dataset_id IS NULL OR trim(dataset_id) = '' THEN
    RAISE EXCEPTION 'dataset_id cannot be empty';
  END IF;

  -- Try to fetch existing dataset
  SELECT 
    datasets.id, 
    datasets.user_id, 
    datasets.compaction_needed, 
    datasets.compaction_in_progress
  INTO v_existing
  FROM public.datasets
  WHERE datasets.id = rpc_ensure_dataset.dataset_id::uuid
  LIMIT 1;

  -- If exists, return it (regardless of user_id when service_role)
  IF v_existing IS NOT NULL THEN
    -- For non-service_role, verify ownership
    IF NOT v_is_service_role AND v_existing.user_id <> v_user_id_uuid THEN
      RAISE EXCEPTION 'Unauthorized: Dataset belongs to another user';
    END IF;

    v_result := jsonb_build_object(
      'id', v_existing.id,
      'user_id', v_existing.user_id,
      'compaction_needed', v_existing.compaction_needed,
      'compaction_in_progress', v_existing.compaction_in_progress,
      'created', false
    );
    RETURN v_result;
  END IF;

  -- Ensure user exists in auth.users before creating dataset
  -- This prevents foreign key constraint violations
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_user_id_uuid) THEN
    RAISE EXCEPTION 'User with id % does not exist', v_user_id_uuid;
  END IF;

  -- If not found, create it (idempotent design)
  INSERT INTO public.datasets (
    id, 
    user_id, 
    dataset_name,
    dataset_ref,
    compaction_needed, 
    compaction_in_progress, 
    created_at, 
    updated_at
  )
  VALUES (
    rpc_ensure_dataset.dataset_id::uuid,
    v_user_id_uuid,
    COALESCE(table_name, 'unknown'),
    rpc_ensure_dataset.dataset_id, -- Use dataset_id as unique ref
    true,
    false,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  -- Fetch and return the dataset
  SELECT 
    datasets.id, 
    datasets.user_id, 
    datasets.compaction_needed, 
    datasets.compaction_in_progress
  INTO v_existing
  FROM public.datasets
  WHERE datasets.id = rpc_ensure_dataset.dataset_id::uuid
  LIMIT 1;

  v_result := jsonb_build_object(
    'id', COALESCE(v_existing.id, rpc_ensure_dataset.dataset_id::uuid),
    'user_id', COALESCE(v_existing.user_id, v_user_id_uuid),
    'compaction_needed', COALESCE(v_existing.compaction_needed, true),
    'compaction_in_progress', COALESCE(v_existing.compaction_in_progress, false),
    'created', (v_existing.id IS NOT NULL AND v_existing.created_at > NOW() - INTERVAL '1 second')
  );

  RETURN v_result;
END;
$$;

-- Grant execute to service_role and authenticated users
GRANT EXECUTE ON FUNCTION public.rpc_ensure_dataset(text, text, text, text) TO service_role, authenticated;

COMMENT ON FUNCTION public.rpc_ensure_dataset IS 
'Ensures dataset exists for given user. Service_role can create datasets for any user (used by Workflows).';
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
