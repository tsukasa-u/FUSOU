-- ============================================================================
-- 20260520010000_anon_sync_pepper_rotation_rpc.sql
--
-- Adds a single SECURITY DEFINER RPC to rotate anonymous-sync pepper safely
-- from tooling (service_role only).
--
-- This RPC performs the same SQL steps documented in:
--   docs/operations/web/ANON_SYNC_V2_ROTATION_RUNBOOK.md
-- while avoiding copy/paste mistakes in manual SQL execution.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rotate_anon_sync_pepper(
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
    runtime_row public.anon_sync_pepper_runtime%ROWTYPE;
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
      FROM public.anon_sync_pepper_runtime
         WHERE singleton = true
         FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'anon_sync_pepper_runtime row is missing';
    END IF;

    IF runtime_row.current_version = p_target_version THEN
        RAISE EXCEPTION 'target_version is already current: %', p_target_version;
    END IF;

    IF p_target_version = ANY(runtime_row.accept_versions) THEN
        RAISE EXCEPTION 'target_version is already accepted: %', p_target_version;
    END IF;

    vault_name := format('anon_sync_pepper_%s', p_target_version);
    description_text := COALESCE(
        NULLIF(trim(p_description), ''),
        format('anonymous sync pepper %s', p_target_version)
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

    INSERT INTO public.anon_sync_pepper_versions (
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

    UPDATE public.anon_sync_pepper_runtime
    SET
        current_version = p_target_version,
        accept_versions = new_accept_versions,
        version_epoch = version_epoch + 1,
        updated_at = now()
    WHERE singleton = true
    RETURNING version_epoch INTO updated_epoch;

    IF updated_epoch IS NULL THEN
        RAISE EXCEPTION 'failed to update anon_sync_pepper_runtime';
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

REVOKE ALL ON FUNCTION public.rotate_anon_sync_pepper(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rotate_anon_sync_pepper(text, text, text) TO service_role;
