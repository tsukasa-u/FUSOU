-- Supabase schema for fleets metadata
-- Save as docs/sql/supabase_fleets_schema.sql

-- Enable pgcrypto extension if not already enabled (for gen_random_uuid)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Fleets metadata table
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

-- Row Level Security (RLS) policies
-- Enable RLS on the table
ALTER TABLE fleets ENABLE ROW LEVEL SECURITY;

-- Owner can SELECT/UPDATE/DELETE their own rows
CREATE POLICY fleets_owner_full_access ON fleets
  USING (owner_id = auth.uid()::uuid)
  WITH CHECK (owner_id = auth.uid()::uuid);

-- Allow anonymous/public SELECT if is_public is true (no auth required)
CREATE POLICY fleets_public_select ON fleets
  FOR SELECT
  USING (is_public = true);

-- Allow SELECT by share_token via a supabase function or by proxying request through a Worker
-- (Supabase policies cannot directly read arbitrary headers; common pattern is to have a function
-- that sets a claim or to have the Worker validate token and call a restricted endpoint.)

-- Example UPSERT helper (replace schema/role names as needed):
-- INSERT INTO fleets (owner_id, tag, title, r2_key, size_bytes, version, updated_at, is_public, share_token)
-- VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8)
-- ON CONFLICT (owner_id, tag) DO UPDATE SET
--   title = EXCLUDED.title,
--   r2_key = EXCLUDED.r2_key,
--   size_bytes = EXCLUDED.size_bytes,
--   version = EXCLUDED.version,
--   updated_at = now(),
--   is_public = EXCLUDED.is_public,
--   share_token = COALESCE(EXCLUDED.share_token, fleets.share_token);

-- Notes:
-- - Adjust policies to match your Supabase Auth setup (auth.uid()).
-- - To support token-based read access, you can either have a Worker verify tokens
--   and call Supabase with a service role key, or implement per-request settings via
--   Postgres session variables set by an authenticated function.
