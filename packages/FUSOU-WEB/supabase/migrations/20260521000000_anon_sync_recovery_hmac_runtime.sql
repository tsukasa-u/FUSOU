-- ============================================================================
-- 20260521000000_anon_sync_recovery_hmac_runtime.sql
--
-- Adds recovery-HMAC runtime for continuity-safe relink.
--
-- Goals:
--   1. Keep member_id plain text out of DB.
--   2. Allow pepper hard-cut during incidents while preserving continuity via
--      a separate recovery HMAC key family.
--   3. Keep recovery key lifecycle explicit and service_role-only.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";

-- ----------------------------------------------------------------------------
-- Recovery key version catalog and runtime singleton.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.anon_sync_recovery_versions (
    version            text PRIMARY KEY CHECK (version ~ '^v[0-9]+$'),
    vault_secret_name  text NOT NULL UNIQUE,
    created_at         timestamptz NOT NULL DEFAULT now(),
    retired_at         timestamptz
);

CREATE TABLE IF NOT EXISTS public.anon_sync_recovery_runtime (
    singleton          boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    current_version    text NOT NULL,
    accept_versions    text[] NOT NULL CHECK (cardinality(accept_versions) >= 1),
    version_epoch      bigint NOT NULL DEFAULT 1,
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.validate_anon_sync_recovery_runtime()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    accepted_version text;
BEGIN
    IF NOT (NEW.current_version = ANY(NEW.accept_versions)) THEN
        RAISE EXCEPTION 'current_version must be included in accept_versions';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM unnest(NEW.accept_versions) AS item(version)
        GROUP BY item.version
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'accept_versions must not contain duplicates';
    END IF;

    FOREACH accepted_version IN ARRAY NEW.accept_versions LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM public.anon_sync_recovery_versions v
            WHERE v.version = accepted_version
              AND v.retired_at IS NULL
        ) THEN
            RAISE EXCEPTION 'accept_versions contains unknown or retired version: %', accepted_version;
        END IF;
    END LOOP;

    IF NOT EXISTS (
        SELECT 1
        FROM public.anon_sync_recovery_versions v
        WHERE v.version = NEW.current_version
          AND v.retired_at IS NULL
    ) THEN
        RAISE EXCEPTION 'current_version is unknown or retired: %', NEW.current_version;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_anon_sync_recovery_runtime_trg
ON public.anon_sync_recovery_runtime;

CREATE TRIGGER validate_anon_sync_recovery_runtime_trg
BEFORE INSERT OR UPDATE ON public.anon_sync_recovery_runtime
FOR EACH ROW
EXECUTE FUNCTION public.validate_anon_sync_recovery_runtime();

-- ----------------------------------------------------------------------------
-- Worker-only recovery bundle resolver (SECURITY DEFINER).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_anon_sync_recovery_bundle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
    runtime_row public.anon_sync_recovery_runtime%ROWTYPE;
    entries jsonb;
    expected_count integer;
    resolved_count integer;
BEGIN
    SELECT *
    INTO runtime_row
    FROM public.anon_sync_recovery_runtime
    WHERE singleton = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'anon_sync_recovery_runtime row is missing';
    END IF;

    SELECT jsonb_agg(
        jsonb_build_object(
            'version', versions.version,
            'secret', secrets.decrypted_secret
        )
        ORDER BY array_position(runtime_row.accept_versions, versions.version)
    )
    INTO entries
    FROM unnest(runtime_row.accept_versions) AS accepted(version)
    JOIN public.anon_sync_recovery_versions versions
      ON versions.version = accepted.version
    JOIN vault.decrypted_secrets secrets
      ON secrets.name = versions.vault_secret_name;

    IF entries IS NULL THEN
        RAISE EXCEPTION 'accepted recovery entries could not be resolved';
    END IF;

    expected_count := cardinality(runtime_row.accept_versions);
    resolved_count := jsonb_array_length(entries);
    IF resolved_count <> expected_count THEN
        RAISE EXCEPTION
            'accepted recovery entries mismatch: expected %, resolved %',
            expected_count,
            resolved_count;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(entries) AS entry
        WHERE COALESCE(length(entry->>'secret'), 0) < 32
    ) THEN
        RAISE EXCEPTION 'resolved recovery secret is too short (min 32 chars)';
    END IF;

    RETURN jsonb_build_object(
        'current_version', runtime_row.current_version,
        'accept_versions', runtime_row.accept_versions,
        'version_epoch', runtime_row.version_epoch,
        'entries', entries
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_retire_active_recovery_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.retired_at IS NOT NULL
       AND OLD.retired_at IS NULL
       AND EXISTS (
           SELECT 1
           FROM public.anon_sync_recovery_runtime r
           WHERE r.singleton = true
             AND (
                 r.current_version = NEW.version
                 OR NEW.version = ANY(r.accept_versions)
             )
       ) THEN
        RAISE EXCEPTION
            'cannot retire active recovery version: %',
            NEW.version;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_retire_active_recovery_version_trg
ON public.anon_sync_recovery_versions;

CREATE TRIGGER prevent_retire_active_recovery_version_trg
BEFORE UPDATE OF retired_at ON public.anon_sync_recovery_versions
FOR EACH ROW
EXECUTE FUNCTION public.prevent_retire_active_recovery_version();

-- ----------------------------------------------------------------------------
-- Recovery anchor (continuity index) and relink audit.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_identity_anchor (
    canonical_user_id  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    recovery_id_hash   text NOT NULL UNIQUE CHECK (recovery_id_hash ~ '^[a-f0-9]{64}$'),
    recovery_version   text NOT NULL CHECK (recovery_version ~ '^v[0-9]+$'),
    assurance_level    text NOT NULL DEFAULT 'device_signature'
                       CHECK (assurance_level IN ('device_signature', 'access_token', 'manual')),
    last_verified_at   timestamptz NOT NULL DEFAULT now(),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_identity_anchor_last_verified_at
ON public.user_identity_anchor (last_verified_at DESC);

CREATE OR REPLACE FUNCTION public.set_user_identity_anchor_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_identity_anchor_updated_at
ON public.user_identity_anchor;

CREATE TRIGGER trg_user_identity_anchor_updated_at
BEFORE UPDATE ON public.user_identity_anchor
FOR EACH ROW
EXECUTE FUNCTION public.set_user_identity_anchor_updated_at();

CREATE TABLE IF NOT EXISTS public.recovery_relink_audit (
    attempt_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_user_id  uuid,
    device_id          uuid,
    outcome            text NOT NULL,
    reason             text,
    details            jsonb,
    created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_identity_anchor ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_relink_audit ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.user_identity_anchor TO service_role;
GRANT SELECT, INSERT ON public.recovery_relink_audit TO service_role;

-- ----------------------------------------------------------------------------
-- Extend existing mapping table with recovery fields.
-- ----------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.user_member_map
    ADD COLUMN IF NOT EXISTS recovery_id_hash text;

ALTER TABLE IF EXISTS public.user_member_map
    ADD COLUMN IF NOT EXISTS recovery_version text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'user_member_map_recovery_id_hash_format'
    ) THEN
        ALTER TABLE public.user_member_map
            ADD CONSTRAINT user_member_map_recovery_id_hash_format
            CHECK (
                recovery_id_hash IS NULL
                OR recovery_id_hash ~ '^[a-f0-9]{64}$'
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'user_member_map_recovery_version_format'
    ) THEN
        ALTER TABLE public.user_member_map
            ADD CONSTRAINT user_member_map_recovery_version_format
            CHECK (
                recovery_version IS NULL
                OR recovery_version ~ '^v[0-9]+$'
            );
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_member_map_recovery_id_hash_unique
ON public.user_member_map (recovery_id_hash)
WHERE recovery_id_hash IS NOT NULL;

COMMENT ON COLUMN public.user_member_map.recovery_id_hash IS
    'Recovery continuity anchor: HMAC-SHA256(recovery_key_vN, api_member_id).';
COMMENT ON COLUMN public.user_member_map.recovery_version IS
    'Version tag used to generate recovery_id_hash.';

-- ----------------------------------------------------------------------------
-- Rotation RPC (service_role only).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rotate_anon_sync_recovery_key(
    p_target_version text,
    p_secret text,
    p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
    runtime_row public.anon_sync_recovery_runtime%ROWTYPE;
    vault_name text;
    secret_id uuid;
    description_text text;
    existing_version text;
    new_accept_versions text[];
    updated_epoch bigint;
BEGIN
    IF p_target_version IS NULL OR p_target_version !~ '^v[0-9]+$' THEN
        RAISE EXCEPTION 'target_version must match ^v[0-9]+$: %', p_target_version;
    END IF;

    IF p_secret IS NULL OR length(p_secret) < 32 THEN
        RAISE EXCEPTION 'secret must be at least 32 chars';
    END IF;

    SELECT *
      INTO runtime_row
      FROM public.anon_sync_recovery_runtime
     WHERE singleton = true
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'anon_sync_recovery_runtime row is missing';
    END IF;

    IF runtime_row.current_version = p_target_version THEN
        RAISE EXCEPTION 'target_version is already current: %', p_target_version;
    END IF;

    IF p_target_version = ANY(runtime_row.accept_versions) THEN
        RAISE EXCEPTION 'target_version is already accepted: %', p_target_version;
    END IF;

    vault_name := format('anon_sync_recovery_%s', p_target_version);
    description_text := COALESCE(
        NULLIF(trim(p_description), ''),
        format('anonymous sync recovery key %s', p_target_version)
    );

    SELECT s.id
      INTO secret_id
      FROM vault.secrets s
     WHERE s.name = vault_name
     LIMIT 1;

    IF secret_id IS NULL THEN
        PERFORM vault.create_secret(p_secret, vault_name, description_text);
    ELSE
        PERFORM vault.update_secret(secret_id, p_secret, vault_name, description_text);
    END IF;

    INSERT INTO public.anon_sync_recovery_versions (
        version,
        vault_secret_name
    ) VALUES (
        p_target_version,
        vault_name
    )
    ON CONFLICT (version) DO UPDATE
    SET
        vault_secret_name = EXCLUDED.vault_secret_name,
        retired_at = NULL;

    new_accept_versions := ARRAY[p_target_version];
    FOREACH existing_version IN ARRAY runtime_row.accept_versions LOOP
        IF existing_version <> p_target_version THEN
            new_accept_versions := array_append(new_accept_versions, existing_version);
        END IF;
    END LOOP;

    UPDATE public.anon_sync_recovery_runtime
    SET
        current_version = p_target_version,
        accept_versions = new_accept_versions,
        version_epoch = version_epoch + 1,
        updated_at = now()
    WHERE singleton = true
    RETURNING version_epoch INTO updated_epoch;

    IF updated_epoch IS NULL THEN
        RAISE EXCEPTION 'failed to update anon_sync_recovery_runtime';
    END IF;

    RETURN jsonb_build_object(
        'previous_current_version', runtime_row.current_version,
        'new_current_version', p_target_version,
        'accept_versions', new_accept_versions,
        'version_epoch', updated_epoch,
        'vault_secret_name', vault_name
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_anon_sync_recovery_bundle() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_anon_sync_recovery_bundle() TO service_role;

REVOKE ALL ON FUNCTION public.rotate_anon_sync_recovery_key(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rotate_anon_sync_recovery_key(text, text, text) TO service_role;
