-- ============================================================================
-- 20260521010000_anon_sync_vault_ops_rpc.sql
--
-- Operational helper RPCs to reduce manual SQL mistakes for anonymous-sync
-- pepper/recovery runtime lifecycle.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bootstrap pepper runtime from empty state.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_anon_sync_pepper_runtime(
    p_initial_version text,
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
BEGIN
    IF p_initial_version IS NULL OR p_initial_version !~ '^v[0-9]+$' THEN
        RAISE EXCEPTION 'initial_version must match ^v[0-9]+$: %', p_initial_version;
    END IF;

    IF p_secret IS NULL OR length(p_secret) < 32 THEN
        RAISE EXCEPTION 'secret must be at least 32 chars';
    END IF;

    SELECT *
      INTO runtime_row
      FROM public.anon_sync_pepper_runtime
     WHERE singleton = true
     FOR UPDATE;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'already_initialized', true,
            'current_version', runtime_row.current_version,
            'accept_versions', runtime_row.accept_versions,
            'version_epoch', runtime_row.version_epoch
        );
    END IF;

    vault_name := format('anon_sync_pepper_%s', p_initial_version);
    description_text := COALESCE(
        NULLIF(trim(p_description), ''),
        format('anonymous sync pepper %s', p_initial_version)
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
        p_initial_version,
        vault_name
    )
    ON CONFLICT (version) DO UPDATE
    SET
        vault_secret_name = EXCLUDED.vault_secret_name,
        retired_at = NULL;

    INSERT INTO public.anon_sync_pepper_runtime (
        singleton,
        current_version,
        accept_versions,
        version_epoch,
        updated_at
    ) VALUES (
        true,
        p_initial_version,
        ARRAY[p_initial_version],
        1,
        now()
    );

    RETURN jsonb_build_object(
        'already_initialized', false,
        'current_version', p_initial_version,
        'accept_versions', ARRAY[p_initial_version],
        'version_epoch', 1,
        'vault_secret_name', vault_name
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- Bootstrap recovery runtime from empty state.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_anon_sync_recovery_runtime(
    p_initial_version text,
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
BEGIN
    IF p_initial_version IS NULL OR p_initial_version !~ '^v[0-9]+$' THEN
        RAISE EXCEPTION 'initial_version must match ^v[0-9]+$: %', p_initial_version;
    END IF;

    IF p_secret IS NULL OR length(p_secret) < 32 THEN
        RAISE EXCEPTION 'secret must be at least 32 chars';
    END IF;

    SELECT *
      INTO runtime_row
      FROM public.anon_sync_recovery_runtime
     WHERE singleton = true
     FOR UPDATE;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'already_initialized', true,
            'current_version', runtime_row.current_version,
            'accept_versions', runtime_row.accept_versions,
            'version_epoch', runtime_row.version_epoch
        );
    END IF;

    vault_name := format('anon_sync_recovery_%s', p_initial_version);
    description_text := COALESCE(
        NULLIF(trim(p_description), ''),
        format('anonymous sync recovery key %s', p_initial_version)
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
        p_initial_version,
        vault_name
    )
    ON CONFLICT (version) DO UPDATE
    SET
        vault_secret_name = EXCLUDED.vault_secret_name,
        retired_at = NULL;

    INSERT INTO public.anon_sync_recovery_runtime (
        singleton,
        current_version,
        accept_versions,
        version_epoch,
        updated_at
    ) VALUES (
        true,
        p_initial_version,
        ARRAY[p_initial_version],
        1,
        now()
    );

    RETURN jsonb_build_object(
        'already_initialized', false,
        'current_version', p_initial_version,
        'accept_versions', ARRAY[p_initial_version],
        'version_epoch', 1,
        'vault_secret_name', vault_name
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- Finalize pepper accept set (keep one version only).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_anon_sync_pepper_accept(
    p_keep_version text,
    p_retire_others boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
    runtime_row public.anon_sync_pepper_runtime%ROWTYPE;
    updated_epoch bigint;
    retired_count bigint := 0;
BEGIN
    IF p_keep_version IS NULL OR p_keep_version !~ '^v[0-9]+$' THEN
        RAISE EXCEPTION 'keep_version must match ^v[0-9]+$: %', p_keep_version;
    END IF;

    SELECT *
      INTO runtime_row
      FROM public.anon_sync_pepper_runtime
     WHERE singleton = true
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'anon_sync_pepper_runtime row is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.anon_sync_pepper_versions v
        WHERE v.version = p_keep_version
          AND v.retired_at IS NULL
    ) THEN
        RAISE EXCEPTION 'keep_version is unknown or retired: %', p_keep_version;
    END IF;

    UPDATE public.anon_sync_pepper_runtime
    SET
        current_version = p_keep_version,
        accept_versions = ARRAY[p_keep_version],
        version_epoch = version_epoch + 1,
        updated_at = now()
    WHERE singleton = true
    RETURNING version_epoch INTO updated_epoch;

    IF updated_epoch IS NULL THEN
        RAISE EXCEPTION 'failed to update anon_sync_pepper_runtime';
    END IF;

    IF p_retire_others THEN
        UPDATE public.anon_sync_pepper_versions
        SET retired_at = now()
        WHERE retired_at IS NULL
          AND version <> p_keep_version;

        GET DIAGNOSTICS retired_count = ROW_COUNT;
    END IF;

    RETURN jsonb_build_object(
        'previous_current_version', runtime_row.current_version,
        'new_current_version', p_keep_version,
        'accept_versions', ARRAY[p_keep_version],
        'version_epoch', updated_epoch,
        'retired_count', retired_count
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- Finalize recovery accept set (keep one version only).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_anon_sync_recovery_accept(
    p_keep_version text,
    p_retire_others boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
    runtime_row public.anon_sync_recovery_runtime%ROWTYPE;
    updated_epoch bigint;
    retired_count bigint := 0;
BEGIN
    IF p_keep_version IS NULL OR p_keep_version !~ '^v[0-9]+$' THEN
        RAISE EXCEPTION 'keep_version must match ^v[0-9]+$: %', p_keep_version;
    END IF;

    SELECT *
      INTO runtime_row
      FROM public.anon_sync_recovery_runtime
     WHERE singleton = true
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'anon_sync_recovery_runtime row is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.anon_sync_recovery_versions v
        WHERE v.version = p_keep_version
          AND v.retired_at IS NULL
    ) THEN
        RAISE EXCEPTION 'keep_version is unknown or retired: %', p_keep_version;
    END IF;

    UPDATE public.anon_sync_recovery_runtime
    SET
        current_version = p_keep_version,
        accept_versions = ARRAY[p_keep_version],
        version_epoch = version_epoch + 1,
        updated_at = now()
    WHERE singleton = true
    RETURNING version_epoch INTO updated_epoch;

    IF updated_epoch IS NULL THEN
        RAISE EXCEPTION 'failed to update anon_sync_recovery_runtime';
    END IF;

    IF p_retire_others THEN
        UPDATE public.anon_sync_recovery_versions
        SET retired_at = now()
        WHERE retired_at IS NULL
          AND version <> p_keep_version;

        GET DIAGNOSTICS retired_count = ROW_COUNT;
    END IF;

    RETURN jsonb_build_object(
        'previous_current_version', runtime_row.current_version,
        'new_current_version', p_keep_version,
        'accept_versions', ARRAY[p_keep_version],
        'version_epoch', updated_epoch,
        'retired_count', retired_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_anon_sync_pepper_runtime(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_anon_sync_pepper_runtime(text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.ensure_anon_sync_recovery_runtime(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_anon_sync_recovery_runtime(text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.finalize_anon_sync_pepper_accept(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_anon_sync_pepper_accept(text, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.finalize_anon_sync_recovery_accept(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_anon_sync_recovery_accept(text, boolean) TO service_role;
