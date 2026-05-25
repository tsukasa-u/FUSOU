-- ============================================================================
-- 20260523000000_anon_sync_vault_rpc_acl_hardening.sql
--
-- Hardens EXECUTE ACLs for anonymous-sync Vault RPCs.
--
-- Why this migration exists:
-- Supabase environments can have default privileges that grant EXECUTE on newly
-- created functions to anon/authenticated. For Vault-related SECURITY DEFINER
-- RPCs this is too broad. We must explicitly revoke anon/authenticated/public
-- and grant only service_role.
-- ============================================================================

-- Read bundle RPCs
REVOKE ALL ON FUNCTION public.get_anon_sync_pepper_bundle()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_anon_sync_pepper_bundle()
TO service_role;

REVOKE ALL ON FUNCTION public.get_anon_sync_recovery_bundle()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_anon_sync_recovery_bundle()
TO service_role;

-- Rotation RPCs
REVOKE ALL ON FUNCTION public.rotate_anon_sync_pepper(text, text, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_anon_sync_pepper(text, text, text)
TO service_role;

REVOKE ALL ON FUNCTION public.rotate_anon_sync_recovery_key(text, text, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_anon_sync_recovery_key(text, text, text)
TO service_role;

-- Bootstrap RPCs
REVOKE ALL ON FUNCTION public.ensure_anon_sync_pepper_runtime(text, text, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_anon_sync_pepper_runtime(text, text, text)
TO service_role;

REVOKE ALL ON FUNCTION public.ensure_anon_sync_recovery_runtime(text, text, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_anon_sync_recovery_runtime(text, text, text)
TO service_role;

-- Finalize RPCs
REVOKE ALL ON FUNCTION public.finalize_anon_sync_pepper_accept(text, boolean)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_anon_sync_pepper_accept(text, boolean)
TO service_role;

REVOKE ALL ON FUNCTION public.finalize_anon_sync_recovery_accept(text, boolean)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_anon_sync_recovery_accept(text, boolean)
TO service_role;
