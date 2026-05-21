-- ============================================================================
-- 20260520000000_anon_sync_pepper_vault_runtime.sql
--
-- Anonymous sync v2 の pepper 秘密と運用状態を Supabase Vault + Postgres テーブル
-- に移管する。詳細は
--   docs/operations/web/ANON_SYNC_V2_PEPPER_SUPABASE_RUNTIME_GUIDE.md
-- を参照。Vault 拡張は既存マイグレーション 20251217040555_remote_schema.sql で
-- 有効化済みだが、冪等性のため IF NOT EXISTS で再宣言する。
--
-- ロールアウト後、Worker は環境変数 PEPPER_CURRENT / PEPPER_ACCEPT / PEPPER_V*
-- を読まなくなり、SECURITY DEFINER の get_anon_sync_pepper_bundle() RPC 経由で
-- だけ pepper を解決する。
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";

-- ----------------------------------------------------------------------------
-- pepper 世代カタログ。世代追加・退役のたびに INSERT / UPDATE する。
-- 退役は retired_at に NOT NULL を立てるが、現行 / 受理対象の世代は
-- prevent_retire_active_pepper_version トリガで保護する。
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.anon_sync_pepper_versions (
    version            text PRIMARY KEY CHECK (version ~ '^v[0-9]+$'),
    vault_secret_name  text NOT NULL UNIQUE,
    created_at         timestamptz NOT NULL DEFAULT now(),
    retired_at         timestamptz
);

-- ----------------------------------------------------------------------------
-- ランタイム状態。シングルトン行 (singleton = true) のみ保持し、
-- current_version / accept_versions / version_epoch を一貫して更新する。
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.anon_sync_pepper_runtime (
    singleton          boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    current_version    text NOT NULL,
    accept_versions    text[] NOT NULL CHECK (cardinality(accept_versions) >= 1),
    version_epoch      bigint NOT NULL DEFAULT 1,
    updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- ランタイム整合性チェック。
--   1. current_version は accept_versions に含まれていなければならない
--   2. accept_versions に重複があってはならない
--   3. accept_versions の全要素および current_version は
--      anon_sync_pepper_versions に存在し、かつ retired_at IS NULL である
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_anon_sync_pepper_runtime()
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
            FROM public.anon_sync_pepper_versions v
            WHERE v.version = accepted_version
              AND v.retired_at IS NULL
        ) THEN
            RAISE EXCEPTION 'accept_versions contains unknown or retired version: %', accepted_version;
        END IF;
    END LOOP;

    IF NOT EXISTS (
        SELECT 1
        FROM public.anon_sync_pepper_versions v
        WHERE v.version = NEW.current_version
          AND v.retired_at IS NULL
    ) THEN
        RAISE EXCEPTION 'current_version is unknown or retired: %', NEW.current_version;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_anon_sync_pepper_runtime_trg
ON public.anon_sync_pepper_runtime;

CREATE TRIGGER validate_anon_sync_pepper_runtime_trg
BEFORE INSERT OR UPDATE ON public.anon_sync_pepper_runtime
FOR EACH ROW
EXECUTE FUNCTION public.validate_anon_sync_pepper_runtime();

-- ----------------------------------------------------------------------------
-- Worker から呼び出される唯一の pepper 取得 API。
-- - vault.decrypted_secrets を直接読まずに SECURITY DEFINER で集約する
-- - accept_versions に対応する全世代の Vault シークレットを解決し、JSON を返す
-- - 1 つでも解決失敗 / 短すぎる場合は EXCEPTION で fail-closed
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_anon_sync_pepper_bundle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
    runtime_row public.anon_sync_pepper_runtime%ROWTYPE;
    entries jsonb;
    expected_count integer;
    resolved_count integer;
BEGIN
    SELECT *
    INTO runtime_row
    FROM public.anon_sync_pepper_runtime
    WHERE singleton = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'anon_sync_pepper_runtime row is missing';
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
    JOIN public.anon_sync_pepper_versions versions
      ON versions.version = accepted.version
    JOIN vault.decrypted_secrets secrets
      ON secrets.name = versions.vault_secret_name;

    IF entries IS NULL THEN
        RAISE EXCEPTION 'accepted pepper entries could not be resolved';
    END IF;

    expected_count := cardinality(runtime_row.accept_versions);
    resolved_count := jsonb_array_length(entries);
    IF resolved_count <> expected_count THEN
        RAISE EXCEPTION
            'accepted pepper entries mismatch: expected %, resolved %',
            expected_count,
            resolved_count;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(entries) AS entry
        WHERE COALESCE(length(entry->>'secret'), 0) < 32
    ) THEN
        RAISE EXCEPTION 'resolved pepper secret is too short (min 32 chars)';
    END IF;

    RETURN jsonb_build_object(
        'current_version', runtime_row.current_version,
        'accept_versions', runtime_row.accept_versions,
        'version_epoch', runtime_row.version_epoch,
        'entries', entries
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 現行 / 受理対象世代の誤退役を防ぐ。retired_at を立てたい場合は事前に
-- anon_sync_pepper_runtime から該当世代を外す必要がある。
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_retire_active_pepper_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.retired_at IS NOT NULL
       AND OLD.retired_at IS NULL
       AND EXISTS (
           SELECT 1
           FROM public.anon_sync_pepper_runtime r
           WHERE r.singleton = true
             AND (
                 r.current_version = NEW.version
                 OR NEW.version = ANY(r.accept_versions)
             )
       ) THEN
        RAISE EXCEPTION
            'cannot retire active pepper version: %',
            NEW.version;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_retire_active_pepper_version_trg
ON public.anon_sync_pepper_versions;

CREATE TRIGGER prevent_retire_active_pepper_version_trg
BEFORE UPDATE OF retired_at ON public.anon_sync_pepper_versions
FOR EACH ROW
EXECUTE FUNCTION public.prevent_retire_active_pepper_version();

-- ----------------------------------------------------------------------------
-- get_anon_sync_pepper_bundle() は SECURITY DEFINER で Vault に到達するため、
-- 呼び出し権限を厳格に制御する。Worker は SUPABASE_SECRET_KEY (service_role JWT)
-- を使って RPC を叩く。anon / authenticated / public への付与は禁止。
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_anon_sync_pepper_bundle() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_anon_sync_pepper_bundle() TO service_role;
