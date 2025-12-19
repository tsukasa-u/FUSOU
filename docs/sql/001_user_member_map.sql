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

-- RPC: Upsert user's member_id mapping
-- This function is called by the backend with service role and user JWT
-- It uses auth.uid() to ensure the user_id matches the authenticated user
create or replace function public.rpc_upsert_user_member_map(
  member_id_hash text,
  client_version text default null
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
  if member_id_hash is null or trim(member_id_hash) = '' then
    raise exception 'member_id_hash cannot be empty';
  end if;

  -- Check if this member_id_hash is already mapped to a different user
  if exists(
    select 1 from public.user_member_map
    where member_id_hash = rpc_upsert_user_member_map.member_id_hash
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
    rpc_upsert_user_member_map.member_id_hash,
    rpc_upsert_user_member_map.client_version,
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
