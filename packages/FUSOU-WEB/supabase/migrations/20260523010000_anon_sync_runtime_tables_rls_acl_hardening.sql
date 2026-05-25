-- ============================================================================
-- 20260523010000_anon_sync_runtime_tables_rls_acl_hardening.sql
--
-- Hardens anonymous-sync runtime/version tables:
--   - Enable RLS
--   - Revoke all table privileges from PUBLIC, anon, authenticated
--   - Keep service_role read-only for operational status checks
--
-- Background:
-- Supabase default ACLs can grant broad table privileges to anon/authenticated
-- for newly created public tables. For runtime/version control tables, this
-- allows unauthorized mutation unless explicitly constrained.
-- ============================================================================

-- Pepper runtime/version tables
ALTER TABLE IF EXISTS public.anon_sync_pepper_runtime
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS public.anon_sync_pepper_versions
    ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.anon_sync_pepper_runtime
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.anon_sync_pepper_versions
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.anon_sync_pepper_runtime TO service_role;
GRANT SELECT ON TABLE public.anon_sync_pepper_versions TO service_role;

-- Recovery runtime/version tables
ALTER TABLE IF EXISTS public.anon_sync_recovery_runtime
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS public.anon_sync_recovery_versions
    ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.anon_sync_recovery_runtime
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.anon_sync_recovery_versions
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.anon_sync_recovery_runtime TO service_role;
GRANT SELECT ON TABLE public.anon_sync_recovery_versions TO service_role;
