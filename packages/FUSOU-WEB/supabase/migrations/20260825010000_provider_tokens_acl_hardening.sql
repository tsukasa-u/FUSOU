-- Provider OAuth tokens are server-managed secrets.
-- Keep the authenticated RLS workflows, but remove historical anonymous grants.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';
SET LOCAL search_path = public, extensions, pg_temp;

DO $$
BEGIN
    IF to_regclass('public.provider_tokens') IS NULL THEN
        RAISE EXCEPTION 'refusing provider token ACL hardening: provider_tokens is missing';
    END IF;
END;
$$;

ALTER TABLE public.provider_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.provider_tokens FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.provider_tokens TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.provider_tokens TO service_role;

DO $$
BEGIN
    IF has_table_privilege('anon', 'public.provider_tokens', 'SELECT')
       OR has_table_privilege('anon', 'public.provider_tokens', 'INSERT')
       OR has_table_privilege('anon', 'public.provider_tokens', 'UPDATE')
       OR has_table_privilege('anon', 'public.provider_tokens', 'DELETE') THEN
        RAISE EXCEPTION 'provider token ACL postflight failed: anonymous grants remain';
    END IF;

    IF NOT has_table_privilege('authenticated', 'public.provider_tokens', 'SELECT')
       OR NOT has_table_privilege('authenticated', 'public.provider_tokens', 'INSERT')
       OR NOT has_table_privilege('authenticated', 'public.provider_tokens', 'UPDATE') THEN
        RAISE EXCEPTION 'provider token ACL postflight failed: authenticated workflow grants missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_class
         WHERE oid = 'public.provider_tokens'::regclass
           AND relrowsecurity
    ) THEN
        RAISE EXCEPTION 'provider token ACL postflight failed: RLS is disabled';
    END IF;
END;
$$;

COMMIT;