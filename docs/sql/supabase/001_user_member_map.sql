-- Migration: Create user_member_map table with RLS and RPC functions
-- Description: Maps Supabase auth.users.id to game member_id_hash for cross-device data consolidation
-- Date: 2025-12-20

-- ========================
-- Table Creation
-- ========================

create table if not exists public.user_member_map (
  user_id uuid primary key references auth.users(id) on delete cascade,
  member_id_hash text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  
  -- Optional metadata columns for tracking and audit
  salt_version text default 'v1', -- Track which salt version was used
  hash_algorithm text default 'sha256', -- Track hash algorithm for future migrations
  client_version text, -- Client version that created this mapping
  last_seen_at timestamptz -- Last time this member_id was used (for analytics)
);

-- Index for fast lookups by member_id_hash
create index if not exists idx_user_member_map_member_id_hash
  on public.user_member_map (member_id_hash);

-- Index for tracking last seen (analytics)
create index if not exists idx_user_member_map_last_seen
  on public.user_member_map (last_seen_at desc nulls last);

-- ========================
-- Trigger for updated_at
-- ========================

create or replace function public.set_updated_at()
returns trigger language plpgsql
set search_path = public, auth
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_member_map_updated_at on public.user_member_map;
create trigger trg_user_member_map_updated_at
  before update on public.user_member_map
  for each row
  execute function public.set_updated_at();

-- ========================
-- Row Level Security (RLS)
-- ========================

alter table public.user_member_map enable row level security;

-- Policy: Users can only select their own mapping
drop policy if exists user_member_map_select on public.user_member_map;
create policy user_member_map_select on public.user_member_map
  for select
  using (auth.uid() = user_id);

-- Policy: Users can only insert their own mapping
drop policy if exists user_member_map_insert on public.user_member_map;
create policy user_member_map_insert on public.user_member_map
  for insert
  with check (auth.uid() = user_id);

-- Policy: Users can only update their own mapping
drop policy if exists user_member_map_update on public.user_member_map;
create policy user_member_map_update on public.user_member_map
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Policy: Users can only delete their own mapping
drop policy if exists user_member_map_delete on public.user_member_map;
create policy user_member_map_delete on public.user_member_map
  for delete
  using (auth.uid() = user_id);

-- ========================
-- RPC Functions
-- ========================

-- Drop all overloads of old function to clear cache and allow parameter renaming
drop function if exists public.rpc_upsert_user_member_map(text, text);
drop function if exists public.rpc_upsert_user_member_map(text, text) cascade;
drop function if exists public.rpc_upsert_user_member_map(member_id_hash text, client_version text);
drop function if exists public.rpc_upsert_user_member_map(client_version text, member_id_hash text);

-- RPC: Upsert user's member_id mapping
-- This function is called by the backend with service role and user JWT
-- It uses auth.uid() to ensure the user_id matches the authenticated user
create or replace function public.rpc_upsert_user_member_map(
  p_member_id_hash text,
  p_client_version text default null
)
returns public.user_member_map
language plpgsql
security definer -- Runs with function owner's permissions
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.user_member_map;
begin
  -- Ensure user is authenticated
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  -- Validate member_id_hash is not empty
  if p_member_id_hash is null or trim(p_member_id_hash) = '' then
    raise exception 'member_id_hash cannot be empty';
  end if;

  -- Check if this member_id_hash is already mapped to a different user
  if exists(
    select 1 from public.user_member_map
    where user_member_map.member_id_hash = rpc_upsert_user_member_map.p_member_id_hash
      and user_id <> v_user_id
  ) then
    raise exception 'member_id_hash already mapped to another user';
  end if;

  -- Upsert the mapping
  insert into public.user_member_map (
    user_id,
    member_id_hash,
    client_version,
    last_seen_at
  )
  values (
    v_user_id,
    rpc_upsert_user_member_map.p_member_id_hash,
    rpc_upsert_user_member_map.p_client_version,
    now()
  )
  on conflict (user_id)
  do update set
    member_id_hash = excluded.member_id_hash,
    client_version = coalesce(excluded.client_version, user_member_map.client_version),
    last_seen_at = now(),
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

-- RPC: Get current user's member_id mapping
create or replace function public.rpc_get_current_user_member_map()
returns public.user_member_map
language sql
stable
security definer
set search_path = public, auth
as $$
  select * from public.user_member_map where user_id = auth.uid();
$$;

-- Grant execute permissions to authenticated users
grant execute on function public.rpc_upsert_user_member_map(text, text) to authenticated;
grant execute on function public.rpc_get_current_user_member_map() to authenticated;

-- ========================
-- FUSOU-WORKFLOW RPC Functions
-- ========================

-- RPC: Ensure dataset exists and belongs to user (select/insert in one transaction)
create or replace function public.rpc_ensure_dataset(
  dataset_id text,
  user_id text,
  table_name text default null,
  period_tag text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_result jsonb;
  v_existing record;
  v_user_id_uuid uuid;
begin
  -- Verify caller owns this user_id (via auth.uid())
  -- Convert user_id text to UUID
  v_user_id_uuid := user_id::uuid;

  if auth.uid() <> v_user_id_uuid then
    raise exception 'Unauthorized: user_id does not match authenticated user';
  end if;

  if dataset_id is null or trim(dataset_id) = '' then
    raise exception 'dataset_id cannot be empty';
  end if;

  -- Try to fetch existing dataset
  select datasets.id, datasets.user_id, datasets.compaction_needed, datasets.compaction_in_progress
  into v_existing
  from public.datasets
  where datasets.id = rpc_ensure_dataset.dataset_id
    and datasets.user_id = v_user_id_uuid
  limit 1;

  -- If exists, return it
  if v_existing is not null then
    v_result := jsonb_build_object(
      'id', v_existing.id,
      'user_id', v_existing.user_id,
      'compaction_needed', v_existing.compaction_needed,
      'compaction_in_progress', v_existing.compaction_in_progress,
      'created', false
    );
    return v_result;
  end if;

  -- If not found, create it (idempotent design)
  insert into public.datasets (
    id, user_id, name, compaction_needed, compaction_in_progress, created_at, updated_at
  )
  values (
    rpc_ensure_dataset.dataset_id,
    v_user_id_uuid,
    coalesce(table_name || '-' || period_tag, 'unknown-' || to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
    true,
    false,
    now(),
    now()
  )
  on conflict (id) do nothing;

  -- Fetch and return the dataset
  select datasets.id, datasets.user_id, datasets.compaction_needed, datasets.compaction_in_progress
  into v_existing
  from public.datasets
  where datasets.id = rpc_ensure_dataset.dataset_id
    and datasets.user_id = v_user_id_uuid
  limit 1;

  v_result := jsonb_build_object(
    'id', coalesce(v_existing.id, rpc_ensure_dataset.dataset_id),
    'user_id', coalesce(v_existing.user_id, v_user_id_uuid),
    'compaction_needed', coalesce(v_existing.compaction_needed, true),
    'compaction_in_progress', coalesce(v_existing.compaction_in_progress, false),
    'created', (v_existing is null)
  );

  return v_result;
end;
$$;

-- RPC: Set compaction_in_progress flag with ownership verification
create or replace function public.rpc_set_compaction_flag(
  dataset_id text,
  user_id text,
  in_progress boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_updated int;
  v_user_id_uuid uuid;
begin
  -- Convert user_id text to UUID
  v_user_id_uuid := user_id::uuid;

  if auth.uid() <> v_user_id_uuid then
    raise exception 'Unauthorized: user_id does not match authenticated user';
  end if;

  if dataset_id is null or trim(dataset_id) = '' then
    raise exception 'dataset_id cannot be empty';
  end if;

  update public.datasets
  set compaction_in_progress = rpc_set_compaction_flag.in_progress,
      updated_at = now()
  where datasets.id = rpc_set_compaction_flag.dataset_id
    and datasets.user_id = v_user_id_uuid
    and (rpc_set_compaction_flag.in_progress = true or datasets.compaction_in_progress = true);

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- RPC: Create processing_metrics record
create or replace function public.rpc_create_processing_metrics(
  dataset_id text,
  workflow_instance_id text,
  metric_status text default 'pending'
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_metric_id uuid;
begin
  insert into public.processing_metrics (
    dataset_id, workflow_instance_id, status, queued_at, workflow_started_at, created_at, updated_at
  )
  values (
    rpc_create_processing_metrics.dataset_id,
    rpc_create_processing_metrics.workflow_instance_id,
    rpc_create_processing_metrics.metric_status,
    now(),
    now(),
    now(),
    now()
  )
  returning id into v_metric_id;

  return v_metric_id;
end;
$$;

-- RPC: Finalize compaction with metadata update
create or replace function public.rpc_finalize_compaction(
  dataset_id text,
  user_id text,
  total_original_size bigint,
  total_compacted_size bigint
)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_compression_ratio numeric;
  v_updated int;
  v_user_id_uuid uuid;
begin
  -- Convert user_id text to UUID
  v_user_id_uuid := user_id::uuid;

  if auth.uid() <> v_user_id_uuid then
    raise exception 'Unauthorized: user_id does not match authenticated user';
  end if;

  v_compression_ratio := case
    when total_original_size > 0 then total_compacted_size::numeric / total_original_size::numeric
    else 1
  end;

  update public.datasets
  set compaction_in_progress = false,
      compaction_needed = false,
      last_compacted_at = now(),
      file_size_bytes = rpc_finalize_compaction.total_compacted_size,
      compression_ratio = v_compression_ratio,
      updated_at = now()
  where datasets.id = rpc_finalize_compaction.dataset_id
    and datasets.user_id = v_user_id_uuid;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- RPC: Record compaction completion metrics
create or replace function public.rpc_record_compaction_metrics(
  metric_id uuid,
  metric_status text,
  step1_duration int default null,
  step2_duration int default null,
  step3_duration int default null,
  step4_duration int default null,
  total_duration int default null,
  original_size bigint default null,
  compressed_size bigint default null,
  error_message text default null,
  error_step text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_compression_ratio numeric;
  v_updated int;
begin
  v_compression_ratio := case
    when original_size > 0 then compressed_size::numeric / original_size::numeric
    else null
  end;

  update public.processing_metrics
  set status = rpc_record_compaction_metrics.metric_status,
      step1_validate_duration_ms = rpc_record_compaction_metrics.step1_duration,
      step2_metadata_duration_ms = rpc_record_compaction_metrics.step2_duration,
      step3_compact_duration_ms = rpc_record_compaction_metrics.step3_duration,
      step4_update_metadata_duration_ms = rpc_record_compaction_metrics.step4_duration,
      workflow_total_duration_ms = rpc_record_compaction_metrics.total_duration,
      original_size_bytes = rpc_record_compaction_metrics.original_size,
      compressed_size_bytes = rpc_record_compaction_metrics.compressed_size,
      compression_ratio = v_compression_ratio,
      error_message = rpc_record_compaction_metrics.error_message,
      error_step = rpc_record_compaction_metrics.error_step,
      workflow_completed_at = now(),
      updated_at = now()
  where processing_metrics.id = rpc_record_compaction_metrics.metric_id;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- Grant execute permissions to authenticated users
grant execute on function public.rpc_ensure_dataset(text, text, text, text) to authenticated;
grant execute on function public.rpc_set_compaction_flag(text, text, boolean) to authenticated;
grant execute on function public.rpc_create_processing_metrics(text, text, text) to authenticated;
grant execute on function public.rpc_finalize_compaction(text, text, bigint, bigint) to authenticated;
grant execute on function public.rpc_record_compaction_metrics(uuid, text, int, int, int, int, int, bigint, bigint, text, text) to authenticated;

-- ========================
-- Comments
-- ========================

comment on table public.user_member_map is 'Maps Supabase users to game member IDs (hashed) for cross-device data consolidation';
comment on column public.user_member_map.user_id is 'Supabase auth user ID';
comment on column public.user_member_map.member_id_hash is 'Salted SHA-256 hash of game member ID';
comment on column public.user_member_map.salt_version is 'Version of salt used for hashing (for future migrations)';
comment on column public.user_member_map.hash_algorithm is 'Hash algorithm used (sha256)';
comment on column public.user_member_map.client_version is 'Client application version that created/updated this mapping';
comment on column public.user_member_map.last_seen_at is 'Last time this member_id was actively used (for analytics)';
comment on function public.rpc_upsert_user_member_map(text, text) is 'Upserts user member_id mapping with duplicate prevention';
comment on function public.rpc_get_current_user_member_map() is 'Retrieves current authenticated user member_id mapping';
