-- Keep the active Web credential workflows available after the UUID cutover.
-- These tables contain no anonymous member identity and are intentionally
-- empty after the destructive cutover, but their schemas remain runtime API
-- dependencies.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';
SET LOCAL search_path = public, extensions, pg_temp;

DO $$
BEGIN
    IF to_regclass('auth.users') IS NULL THEN
        RAISE EXCEPTION 'refusing credential schema restore: auth.users is missing';
    END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.api_keys (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    key        text NOT NULL,
    email      text NOT NULL,
    is_active  boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT api_keys_key_key UNIQUE (key)
);

CREATE TABLE IF NOT EXISTS public.trusted_devices (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_id    text NOT NULL,
    device_name  text,
    last_used_at timestamptz NOT NULL DEFAULT now(),
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT unique_user_device UNIQUE (user_id, client_id)
);

CREATE TABLE IF NOT EXISTS public.verification_codes (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_id  text NOT NULL,
    code       text NOT NULL,
    expires_at timestamptz NOT NULL,
    is_used    boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT unique_active_code UNIQUE (user_id, client_id, code)
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key
    ON public.api_keys (key);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id
    ON public.api_keys (user_id);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_user_client
    ON public.trusted_devices (user_id, client_id);
CREATE INDEX IF NOT EXISTS idx_verification_codes_lookup
    ON public.verification_codes (user_id, client_id, code, expires_at);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trusted_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_codes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.api_keys FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.trusted_devices FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.verification_codes FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.api_keys TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.trusted_devices TO authenticated, service_role;
GRANT SELECT ON TABLE public.verification_codes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.verification_codes TO service_role;

DROP POLICY IF EXISTS "Users can delete own api_keys" ON public.api_keys;
CREATE POLICY "Users can delete own api_keys"
    ON public.api_keys FOR DELETE TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own api_keys" ON public.api_keys;
CREATE POLICY "Users can insert own api_keys"
    ON public.api_keys FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own api_keys" ON public.api_keys;
CREATE POLICY "Users can update own api_keys"
    ON public.api_keys FOR UPDATE TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own api_keys" ON public.api_keys;
CREATE POLICY "Users can view own api_keys"
    ON public.api_keys FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own trusted_devices" ON public.trusted_devices;
CREATE POLICY "Users can delete own trusted_devices"
    ON public.trusted_devices FOR DELETE TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own trusted_devices" ON public.trusted_devices;
CREATE POLICY "Users can insert own trusted_devices"
    ON public.trusted_devices FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own trusted_devices" ON public.trusted_devices;
CREATE POLICY "Users can view own trusted_devices"
    ON public.trusted_devices FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own verification_codes" ON public.verification_codes;
CREATE POLICY "Users can view own verification_codes"
    ON public.verification_codes FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_api_keys_updated_at ON public.api_keys;
CREATE TRIGGER trigger_api_keys_updated_at
    BEFORE UPDATE ON public.api_keys
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.cleanup_expired_verification_codes()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    DELETE FROM public.verification_codes
     WHERE expires_at < now()
        OR is_used = true;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_expired_verification_codes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_verification_codes() TO service_role;

DO $$
DECLARE
    table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['api_keys', 'trusted_devices', 'verification_codes'] LOOP
        IF to_regclass(format('public.%I', table_name)) IS NULL THEN
            RAISE EXCEPTION 'credential schema restore failed: public.% missing', table_name;
        END IF;
    END LOOP;

    IF EXISTS (
        SELECT 1
          FROM (VALUES
              ('api_keys', 'id'),
              ('api_keys', 'user_id'),
              ('api_keys', 'key'),
              ('api_keys', 'email'),
              ('api_keys', 'is_active'),
              ('api_keys', 'created_at'),
              ('api_keys', 'updated_at'),
              ('trusted_devices', 'id'),
              ('trusted_devices', 'user_id'),
              ('trusted_devices', 'client_id'),
              ('trusted_devices', 'device_name'),
              ('trusted_devices', 'last_used_at'),
              ('trusted_devices', 'created_at'),
              ('verification_codes', 'id'),
              ('verification_codes', 'user_id'),
              ('verification_codes', 'client_id'),
              ('verification_codes', 'code'),
              ('verification_codes', 'expires_at'),
              ('verification_codes', 'is_used'),
              ('verification_codes', 'created_at')
          ) AS required_columns(table_name, column_name)
         WHERE NOT EXISTS (
             SELECT 1
               FROM information_schema.columns c
              WHERE c.table_schema = 'public'
                AND c.table_name = required_columns.table_name
                AND c.column_name = required_columns.column_name
         )
    ) THEN
        RAISE EXCEPTION 'credential schema restore failed: required column missing';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM (VALUES
              ('api_keys', 'api_keys_pkey'),
              ('api_keys', 'api_keys_key_key'),
              ('trusted_devices', 'trusted_devices_pkey'),
              ('trusted_devices', 'unique_user_device'),
              ('verification_codes', 'verification_codes_pkey'),
              ('verification_codes', 'unique_active_code')
          ) AS required_constraints(table_name, constraint_name)
         WHERE NOT EXISTS (
             SELECT 1
               FROM pg_constraint c
              WHERE c.connamespace = 'public'::regnamespace
                AND c.conrelid = format('public.%s', required_constraints.table_name)::regclass
                AND c.conname = required_constraints.constraint_name
         )
    ) THEN
        RAISE EXCEPTION 'credential schema restore failed: required constraint missing';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM (VALUES
              ('api_keys', 'api_keys_user_id_fkey'),
              ('trusted_devices', 'trusted_devices_user_id_fkey'),
              ('verification_codes', 'verification_codes_user_id_fkey')
          ) AS required_foreign_keys(table_name, constraint_name)
         WHERE NOT EXISTS (
             SELECT 1
               FROM pg_constraint c
              WHERE c.connamespace = 'public'::regnamespace
                AND c.conrelid = format('public.%s', required_foreign_keys.table_name)::regclass
                AND c.conname = required_foreign_keys.constraint_name
                AND c.contype = 'f'
                AND c.confrelid = 'auth.users'::regclass
         )
    ) THEN
        RAISE EXCEPTION 'credential schema restore failed: auth.users foreign key missing';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM (VALUES ('api_keys'), ('trusted_devices'), ('verification_codes'))
              AS protected_tables(table_name)
         WHERE NOT EXISTS (
             SELECT 1
               FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public'
                AND c.relname = protected_tables.table_name
                AND c.relrowsecurity
         )
    ) THEN
        RAISE EXCEPTION 'credential schema restore failed: RLS is disabled';
    END IF;
END;
$$;

COMMIT;