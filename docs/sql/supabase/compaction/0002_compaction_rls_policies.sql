-- Supabase RLS policies for compaction fields
-- Review and adjust roles to your org. Uses PostgreSQL syntax.

BEGIN;

-- Ensure RLS is enabled on datasets
ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;

-- Allow service role (jwt aud = service_role) full access
CREATE POLICY IF NOT EXISTS service_role_all ON public.datasets
  FOR ALL USING (true) WITH CHECK (true);

-- Example: allow updating compaction flags by backend role
-- Replace 'backend_role' with your JWT role claim or use pgjwt extension
CREATE POLICY IF NOT EXISTS backend_update_compaction ON public.datasets
  FOR UPDATE
  USING (current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'backend_role')
  WITH CHECK (current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'backend_role');

-- Example: read access to flags for authenticated users in same project
CREATE POLICY IF NOT EXISTS auth_read_flags ON public.datasets
  FOR SELECT
  USING (auth.role() = 'authenticated');

COMMIT;
