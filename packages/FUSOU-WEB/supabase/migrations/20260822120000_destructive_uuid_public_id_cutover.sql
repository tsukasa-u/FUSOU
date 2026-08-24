-- Destructive UUID-only member identity cutover.
--
-- This migration intentionally preserves auth.users and kc_period_tag only.
-- All pre-cutover member identity, ownership, credential, and sync data is
-- deleted. No old identifier is backfilled, re-keyed, or retained.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';
SET LOCAL search_path = public, extensions, pg_temp;

DO $$
BEGIN
    IF to_regclass('auth.users') IS NULL THEN
        RAISE EXCEPTION 'refusing cutover: auth.users is missing';
    END IF;

    IF to_regclass('public.kc_period_tag') IS NULL THEN
        RAISE EXCEPTION 'refusing cutover: public.kc_period_tag is missing';
    END IF;

    IF to_regclass('vault.secrets') IS NULL THEN
        RAISE EXCEPTION 'refusing cutover: vault.secrets is missing';
    END IF;

    IF to_regclass('public.anon_sync_nonce_consumptions') IS NULL THEN
        RAISE EXCEPTION 'refusing cutover: public.anon_sync_nonce_consumptions is missing';
    END IF;

    IF to_regprocedure('public.gen_random_uuid()') IS NULL
         AND to_regprocedure('extensions.gen_random_uuid()') IS NULL
         AND to_regprocedure('pg_catalog.gen_random_uuid()') IS NULL THEN
        RAISE EXCEPTION 'refusing cutover: gen_random_uuid() is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conrelid = 'public.anon_sync_nonce_consumptions'::regclass
           AND contype = 'p'
           AND pg_get_constraintdef(oid) = 'PRIMARY KEY (device_id, nonce)'
    ) THEN
        RAISE EXCEPTION
            'refusing cutover: nonce consumption table must retain PRIMARY KEY (device_id, nonce)';
    END IF;
END;
$$;

-- Revoke legacy RPCs before dropping the tables referenced by their bodies.
DO $$
BEGIN
    IF to_regclass('public.anon_sync_pepper_runtime') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS validate_anon_sync_pepper_runtime_trg
            ON public.anon_sync_pepper_runtime;
    END IF;
    IF to_regclass('public.anon_sync_pepper_versions') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS prevent_retire_active_pepper_version_trg
            ON public.anon_sync_pepper_versions;
    END IF;
    IF to_regclass('public.anon_sync_recovery_runtime') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS validate_anon_sync_recovery_runtime_trg
            ON public.anon_sync_recovery_runtime;
    END IF;
    IF to_regclass('public.anon_sync_recovery_versions') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS prevent_retire_active_recovery_version_trg
            ON public.anon_sync_recovery_versions;
    END IF;
    IF to_regclass('public.user_identity_anchor') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS trg_user_identity_anchor_updated_at
            ON public.user_identity_anchor;
    END IF;
    DROP TRIGGER IF EXISTS on_auth_user_created
        ON auth.users;

    DROP FUNCTION IF EXISTS public.rpc_claim_member_with_code(text, text);
    DROP FUNCTION IF EXISTS public.rpc_generate_member_transfer_code(text, integer);
    DROP FUNCTION IF EXISTS public.rpc_upsert_user_member_map(text, text);
    DROP FUNCTION IF EXISTS public.rpc_get_current_user_member_map();
    DROP FUNCTION IF EXISTS public.rpc_get_member_conflict_hints(text);
    DROP FUNCTION IF EXISTS public.rpc_create_processing_metrics(text, text, text);
    DROP FUNCTION IF EXISTS public.rpc_finalize_compaction(text, text, bigint, bigint);
    DROP FUNCTION IF EXISTS public.rpc_record_compaction_metrics(text, text, jsonb);
    DROP FUNCTION IF EXISTS public.rpc_record_compaction_metrics(
        uuid, text, integer, integer, integer, integer, integer,
        bigint, bigint, text, text
    );
    DROP FUNCTION IF EXISTS public.rpc_set_compaction_flag(text, text, boolean);
    DROP FUNCTION IF EXISTS public.handle_new_user();

    DROP FUNCTION IF EXISTS public.get_anon_sync_pepper_bundle();
    DROP FUNCTION IF EXISTS public.rotate_anon_sync_pepper(text, text, text);
    DROP FUNCTION IF EXISTS public.ensure_anon_sync_pepper_runtime(text, text, text);
    DROP FUNCTION IF EXISTS public.finalize_anon_sync_pepper_accept(text, boolean);
    DROP FUNCTION IF EXISTS public.validate_anon_sync_pepper_runtime();
    DROP FUNCTION IF EXISTS public.prevent_retire_active_pepper_version();

    DROP FUNCTION IF EXISTS public.get_anon_sync_recovery_bundle();
    DROP FUNCTION IF EXISTS public.rotate_anon_sync_recovery_key(text, text, text);
    DROP FUNCTION IF EXISTS public.ensure_anon_sync_recovery_runtime(text, text, text);
    DROP FUNCTION IF EXISTS public.finalize_anon_sync_recovery_accept(text, boolean);
    DROP FUNCTION IF EXISTS public.validate_anon_sync_recovery_runtime();
    DROP FUNCTION IF EXISTS public.prevent_retire_active_recovery_version();
    DROP FUNCTION IF EXISTS public.set_user_identity_anchor_updated_at();
END;
$$;

-- Remove the old pending table from Realtime before replacing its payload shape.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM pg_publication p
          JOIN pg_publication_rel pr ON pr.prpubid = p.oid
         WHERE p.pubname = 'supabase_realtime'
           AND NOT p.puballtables
                     AND pr.prrelid = to_regclass('public.pending_member_syncs')
    ) THEN
        ALTER PUBLICATION supabase_realtime DROP TABLE public.pending_member_syncs;
    END IF;
END;
$$;

-- Purge member-owned data and credentials. auth.users and kc_period_tag are
-- deliberately excluded from this list. Some remote-only migrations already
-- removed processing_metrics and datasets, so absent relations are skipped.
DO $$
DECLARE
    table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'processing_metrics',
        'datasets',
        'provider_tokens',
        'api_keys',
        'trusted_devices',
        'verification_codes',
        'anon_sync_nonce_consumptions'
    ] LOOP
        IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
            EXECUTE format('DELETE FROM public.%I', table_name);
        END IF;
    END LOOP;
END;
$$;

-- Vault values are not read or logged. Delete only the versioned secrets owned
-- by the removed anonymous-sync pepper/recovery lifecycle.
DELETE FROM vault.secrets
 WHERE name ~ '^anon_sync_(pepper|recovery)_v[0-9]+$';

-- These tables contain only legacy member identity, transfer, recovery, or
-- realtime payload data. Dropping them also removes their old policies,
-- indexes, triggers, and table grants without using DROP ... CASCADE.
DROP TABLE IF EXISTS public.fleets;
DROP TABLE IF EXISTS public.member_transfer_history;
DROP TABLE IF EXISTS public.social_member_links;
DROP TABLE IF EXISTS public.member_id_hash_rotations;
DROP TABLE IF EXISTS public.recovery_relink_audit;
DROP TABLE IF EXISTS public.user_identity_anchor;
DROP TABLE IF EXISTS public.anon_sync_pepper_runtime;
DROP TABLE IF EXISTS public.anon_sync_pepper_versions;
DROP TABLE IF EXISTS public.anon_sync_recovery_runtime;
DROP TABLE IF EXISTS public.anon_sync_recovery_versions;
DROP TABLE IF EXISTS public.user_devices;
DROP TABLE IF EXISTS public.user_member_map;
DROP TABLE IF EXISTS public.pending_member_syncs;
DROP TABLE IF EXISTS public.member_id_mapping;

CREATE TABLE public.member_id_mapping (
    id            bigint GENERATED ALWAYS AS IDENTITY
                  (SEQUENCE NAME public.member_id_mapping_id_seq)
                  PRIMARY KEY,
    api_member_id text NOT NULL,
    public_id     uuid NOT NULL DEFAULT gen_random_uuid(),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_member_id_mapping_api_member_id UNIQUE (api_member_id),
    CONSTRAINT uq_member_id_mapping_public_id UNIQUE (public_id),
    CONSTRAINT chk_member_id_mapping_api_member_id
        CHECK (api_member_id ~ '^[0-9]{1,16}$'),
    CONSTRAINT chk_member_id_mapping_uuid_v4 CHECK (
        substring(public_id::text from 15 for 1) = '4'
        AND substring(public_id::text from 20 for 1) ~ '^[89ab]$'
    )
);

COMMENT ON TABLE public.member_id_mapping IS
    'Service-role-only mapping from api_member_id to a newly generated public UUID v4.';
COMMENT ON COLUMN public.member_id_mapping.api_member_id IS
    'Restricted registration key. Never return, log, or expose this value as a public identity.';
COMMENT ON COLUMN public.member_id_mapping.public_id IS
    'Random UUID v4 used as the public member and dataset identity.';

ALTER TABLE public.member_id_mapping ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.member_id_mapping FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.member_id_mapping_id_seq FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.user_member_map (
    user_id    uuid NOT NULL
               PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    public_id  uuid NOT NULL UNIQUE
               REFERENCES public.member_id_mapping(public_id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_user_member_map_uuid_v4 CHECK (
        substring(public_id::text from 15 for 1) = '4'
        AND substring(public_id::text from 20 for 1) ~ '^[89ab]$'
    )
);

COMMENT ON TABLE public.user_member_map IS
    'Canonical Supabase user ownership for a UUID-only public member identity.';

ALTER TABLE public.user_member_map ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.user_member_map FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.user_member_map TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_member_map TO service_role;

CREATE POLICY user_member_map_select_own
    ON public.user_member_map
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE TABLE public.user_devices (
    device_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    public_id         uuid NOT NULL
                       REFERENCES public.member_id_mapping(public_id) ON DELETE RESTRICT,
    device_pubkey     bytea NOT NULL,
    pubkey_algo       text NOT NULL DEFAULT 'ed25519',
    created_at        timestamptz NOT NULL DEFAULT now(),
    last_seen_at      timestamptz,
    revoked_at        timestamptz,
    revoked_reason    text,
    CONSTRAINT user_devices_device_id_uuid_v4 CHECK (
        substring(device_id::text from 15 for 1) = '4'
        AND substring(device_id::text from 20 for 1) ~ '^[89ab]$'
    ),
    CONSTRAINT user_devices_public_id_uuid_v4 CHECK (
        substring(public_id::text from 15 for 1) = '4'
        AND substring(public_id::text from 20 for 1) ~ '^[89ab]$'
    ),
    CONSTRAINT user_devices_pubkey_len CHECK (octet_length(device_pubkey) = 32),
    CONSTRAINT user_devices_algo_known CHECK (pubkey_algo IN ('ed25519')),
    CONSTRAINT user_devices_revoked_pair CHECK (
        (revoked_at IS NULL AND revoked_reason IS NULL)
        OR revoked_at IS NOT NULL
    ),
    CONSTRAINT user_devices_public_id_key UNIQUE (public_id, device_pubkey)
);

COMMENT ON TABLE public.user_devices IS
    'Ed25519 device registry keyed by the UUID-only public member identity.';
COMMENT ON COLUMN public.user_devices.device_pubkey IS
    'Raw 32-byte Ed25519 public key generated and retained by the client.';

CREATE INDEX idx_user_devices_canonical_user
    ON public.user_devices (canonical_user_id);
CREATE INDEX idx_user_devices_public_id_active
    ON public.user_devices (public_id)
    WHERE revoked_at IS NULL;

ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.user_devices FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.user_devices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_devices TO service_role;

CREATE POLICY user_devices_select_own
    ON public.user_devices
    FOR SELECT
    TO authenticated
    USING (auth.uid() = canonical_user_id);

CREATE TABLE public.pending_member_syncs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token           text NOT NULL UNIQUE,
    public_id       uuid
                    REFERENCES public.member_id_mapping(public_id) ON DELETE CASCADE,
    app_instance_id text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
    synced_at       timestamptz,
    CONSTRAINT pending_member_syncs_token_not_empty CHECK (token <> ''),
    CONSTRAINT pending_member_syncs_public_id_uuid_v4 CHECK (
        public_id IS NULL
        OR (
            substring(public_id::text from 15 for 1) = '4'
            AND substring(public_id::text from 20 for 1) ~ '^[89ab]$'
        )
    )
);

COMMENT ON TABLE public.pending_member_syncs IS
    'Short-lived Realtime handoff from the Web to FUSOU-APP carrying a public UUID only.';

CREATE INDEX idx_pending_syncs_app_instance
    ON public.pending_member_syncs (app_instance_id);
CREATE INDEX idx_pending_syncs_expires
    ON public.pending_member_syncs (expires_at);

ALTER TABLE public.pending_member_syncs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pending_member_syncs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pending_member_syncs TO service_role;

DO $$
BEGIN
        IF EXISTS (
                SELECT 1
                    FROM pg_publication
                 WHERE pubname = 'supabase_realtime'
                     AND NOT puballtables
        )
        AND NOT EXISTS (
                SELECT 1
                    FROM pg_publication p
                    JOIN pg_publication_rel pr ON pr.prpubid = p.oid
                 WHERE p.pubname = 'supabase_realtime'
                     AND pr.prrelid = 'public.pending_member_syncs'::regclass
        ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.pending_member_syncs;
    END IF;
END;
$$;

-- Keep the atomic nonce-consumption table, but never carry pre-cutover nonce
-- values into the new identity epoch.
ALTER TABLE public.anon_sync_nonce_consumptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.anon_sync_nonce_consumptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.anon_sync_nonce_consumptions TO service_role;

CREATE OR REPLACE FUNCTION public.rpc_register_public_id(
    p_api_member_id text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_api_member_id text := NULLIF(trim(p_api_member_id), '');
    v_public_id uuid;
BEGIN
    IF v_api_member_id IS NULL OR v_api_member_id !~ '^[0-9]{1,16}$' THEN
        RAISE EXCEPTION 'api_member_id must be 1-16 digit numeric string';
    END IF;

    SELECT public_id
      INTO v_public_id
      FROM public.member_id_mapping
     WHERE api_member_id = v_api_member_id;

    IF FOUND THEN
        RETURN v_public_id;
    END IF;

    INSERT INTO public.member_id_mapping (api_member_id)
    VALUES (v_api_member_id)
    ON CONFLICT (api_member_id) DO NOTHING
    RETURNING public_id INTO v_public_id;

    IF v_public_id IS NULL THEN
        SELECT public_id
          INTO v_public_id
          FROM public.member_id_mapping
         WHERE api_member_id = v_api_member_id;
    END IF;

    IF v_public_id IS NULL THEN
        RAISE EXCEPTION 'public_id registration did not produce a mapping';
    END IF;

    RETURN v_public_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_get_registered_public_id(
    p_api_member_id text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_api_member_id text := NULLIF(trim(p_api_member_id), '');
    v_public_id uuid;
BEGIN
    IF v_api_member_id IS NULL OR v_api_member_id !~ '^[0-9]{1,16}$' THEN
        RAISE EXCEPTION 'api_member_id must be 1-16 digit numeric string';
    END IF;

    SELECT public_id
      INTO v_public_id
      FROM public.member_id_mapping
     WHERE api_member_id = v_api_member_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'member is not registered';
    END IF;

    RETURN v_public_id;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_register_public_id(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_register_public_id(text) TO service_role;
REVOKE ALL ON FUNCTION public.rpc_get_registered_public_id(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_registered_public_id(text) TO service_role;

DO $$
BEGIN
    IF to_regprocedure('public.handle_new_user()') IS NOT NULL THEN
        RAISE EXCEPTION 'cutover postflight failed: legacy handle_new_user function remains';
    END IF;
    IF EXISTS (
        SELECT 1
          FROM pg_trigger
         WHERE tgrelid = 'auth.users'::regclass
           AND tgname = 'on_auth_user_created'
           AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION 'cutover postflight failed: legacy auth user trigger remains';
    END IF;
    IF has_table_privilege('anon', 'public.pending_member_syncs', 'SELECT')
       OR has_table_privilege('anon', 'public.pending_member_syncs', 'INSERT')
       OR has_table_privilege('anon', 'public.pending_member_syncs', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.pending_member_syncs', 'SELECT')
       OR has_table_privilege('authenticated', 'public.pending_member_syncs', 'INSERT')
       OR has_table_privilege('authenticated', 'public.pending_member_syncs', 'UPDATE') THEN
        RAISE EXCEPTION 'cutover postflight failed: pending sync client grants remain';
    END IF;
    IF EXISTS (SELECT 1 FROM public.member_id_mapping) THEN
        RAISE EXCEPTION 'cutover postflight failed: member_id_mapping is not empty';
    END IF;
    IF EXISTS (SELECT 1 FROM public.user_member_map) THEN
        RAISE EXCEPTION 'cutover postflight failed: user_member_map is not empty';
    END IF;
    IF EXISTS (SELECT 1 FROM public.user_devices) THEN
        RAISE EXCEPTION 'cutover postflight failed: user_devices is not empty';
    END IF;
    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
                     AND table_name IN (
                             'member_id_mapping', 'user_member_map', 'user_devices',
                             'pending_member_syncs', 'anon_sync_nonce_consumptions'
                     )
           AND column_name IN (
               'member_id_hash', 'pid', 'pid_from', 'pid_to',
               'recovery_id_hash', 'salt_version', 'hash_algorithm'
           )
    ) THEN
        RAISE EXCEPTION 'cutover postflight failed: legacy identity columns remain';
    END IF;
END;
$$;

COMMIT;
