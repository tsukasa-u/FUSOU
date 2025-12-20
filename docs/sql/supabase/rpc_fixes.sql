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
