# 匿名同期 v2 Pepper を Supabase Vault + Runtime State へ移す実装ガイド

最終更新: 2026-05-20
対象: FUSOU-WEB, Supabase, Cloudflare Workers

## 1. このドキュメントの結論

- Pepper の秘密値もローテーション状態も環境変数には置かない。
- Pepper 本体は Supabase Vault に 1 version 1 secret で保存する。
- current / accept / version_epoch は Supabase テーブルで管理する。
- Worker 環境変数に残すのは `CHALLENGE_HMAC_SECRET` と `DATASET_TOKEN_SECRET` のみとする。
- Pepper を実際に必要とするのは `register` と `refresh` だけなので、Vault / RPC 依存はその 2 経路に限定する。

この構成にすると、次を同時に解消できる。

- `PEPPER_V1`, `PEPPER_V2`, ... が増え続ける問題。
- `.env` / Dashboard / 実運用の secret 配置が乖離する問題。
- Pepper の version 情報と secret の保管場所が別物になって事故る問題。

## 2. Goals / Non-goals

### 2.1 Goals

- `api_member_id -> pid` の現行ドメインロジックを維持する。
- ユーザー操作ゼロと多端末自動集約を維持する。
- Pepper を env から完全に外し、専用 secret store に閉じ込める。
- Worker から `vault.decrypted_secrets` を直接読ませず、必要最小限の RPC だけを公開する。

### 2.2 Non-goals

- `auth.uid()` ベースへ移行すること。
- account linking UX を新設すること。
- `CHALLENGE_HMAC_SECRET` や `DATASET_TOKEN_SECRET` まで同時に Vault 化すること。
- 追跡連続性を維持したまま旧 version の受理期間をゼロにすること。

## 3. 採用する設計

### 3.1 役割分担

Worker 環境変数:

- `CHALLENGE_HMAC_SECRET`
- `DATASET_TOKEN_SECRET`
- Supabase 接続情報

Supabase Vault:

- `anon_sync_pepper_v1`
- `anon_sync_pepper_v2`
- `anon_sync_pepper_v3`

Supabase テーブル / 関数:

- `public.anon_sync_pepper_versions`
- `public.anon_sync_pepper_runtime`
- `public.get_anon_sync_pepper_bundle()`

### 3.2 リクエスト経路

Pepper を必要とする経路:

- `POST /anonymous-sync/v2/register`
- `POST /anonymous-sync/v2/refresh`

Pepper を必要としない経路:

- `GET /anonymous-sync/v2/challenge`
- `POST /anonymous-sync/v2/revoke`

これにより、Vault / RPC 依存はログイン相当の登録更新経路に限定できる。待機期間の有無はレイテンシではなく、旧 version の pid を持つ休眠端末をどこまで救うかで決まる。

### 3.3 なぜ overlap 期間がまだ必要か

`dataset_token` は 7 日 TTL で、クライアントは残り 1 日未満で `refresh` を呼ぶ。つまり、通常利用端末なら 1 週間以内に新 version へ寄るが、長期間 offline の端末は復帰時まで旧 version の pid を持ったまま残る。

したがって overlap 期間は次で決める。

- 通常利用端末だけ救えばよいなら 8 日前後。
- 休眠端末も無操作で救いたいなら 14 日以上。

これは DB が遅いかどうかではなく、追跡連続性をどこまで守るかの運用判断である。

## 4. Supabase 側の実装

### 4.1 テーブル設計

`public.anon_sync_pepper_versions`:

- `version` (`v1`, `v2`, ...)
- `vault_secret_name` (`anon_sync_pepper_v1` など)
- `created_at`
- `retired_at`

`public.anon_sync_pepper_runtime`:

- `singleton` (`true` 固定)
- `current_version`
- `accept_versions`
- `version_epoch`
- `updated_at`

補足:

- `accept_versions` は「重複なし」「全要素が未退役 version」「current_version を必ず含む」を強制する。
- `current_version` や `accept_versions` に残っている version を `retired_at` 更新で退役できないようにする。

### 4.2 Worker へ公開する RPC

Worker は `vault.decrypted_secrets` を直接読まない。代わりに `public.get_anon_sync_pepper_bundle()` を service role で呼び、受理対象 version のみをまとめて受け取る。

返却 JSON 例:

```json
{
  "current_version": "v2",
  "accept_versions": ["v2", "v1"],
  "version_epoch": 3,
  "entries": [
    { "version": "v2", "secret": "..." },
    { "version": "v1", "secret": "..." }
  ]
}
```

### 4.3 推奨 migration SQL

新規ファイル:

- `packages/FUSOU-WEB/supabase/migrations/20260520000000_anon_sync_pepper_vault_runtime.sql`

```sql
CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";

CREATE TABLE IF NOT EXISTS public.anon_sync_pepper_versions (
    version            text PRIMARY KEY CHECK (version ~ '^v[0-9]+$'),
    vault_secret_name  text NOT NULL UNIQUE,
    created_at         timestamptz NOT NULL DEFAULT now(),
    retired_at         timestamptz
);

CREATE TABLE IF NOT EXISTS public.anon_sync_pepper_runtime (
    singleton          boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    current_version    text NOT NULL,
    accept_versions    text[] NOT NULL CHECK (cardinality(accept_versions) >= 1),
    version_epoch      bigint NOT NULL DEFAULT 1,
    updated_at         timestamptz NOT NULL DEFAULT now()
);

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

REVOKE ALL ON FUNCTION public.get_anon_sync_pepper_bundle() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_anon_sync_pepper_bundle() TO service_role;
```

### 4.4 初期投入

```sql
SELECT vault.create_secret(
    'initial-pepper-secret-here',
    'anon_sync_pepper_v1',
    'anonymous sync pepper v1'
);

INSERT INTO public.anon_sync_pepper_versions (
    version,
    vault_secret_name
) VALUES (
    'v1',
    'anon_sync_pepper_v1'
)
ON CONFLICT (version) DO NOTHING;

INSERT INTO public.anon_sync_pepper_runtime (
    singleton,
    current_version,
    accept_versions,
    version_epoch
) VALUES (
    true,
    'v1',
    ARRAY['v1'],
    1
)
ON CONFLICT (singleton) DO NOTHING;
```

## 5. アプリケーション側の変更

### 5.1 `types.ts`

対象:

- `packages/FUSOU-WEB/src/server/types.ts`

変更内容:

- `PEPPER_CURRENT`, `PEPPER_ACCEPT`, `PEPPER_V*`, `PEPPER_SLOT_A/B` を全廃する。
- Pepper 用 env 定義はゼロにする。
- `CHALLENGE_HMAC_SECRET` と `DATASET_TOKEN_SECRET` は据え置く。

### 5.2 `pepper.ts`

対象:

- `packages/FUSOU-WEB/src/server/utils/pepper.ts`

変更内容:

- env 解決ベースの `resolvePepperConfig(...)` を廃止する。
- Supabase RPC を叩く `resolvePepperConfigFromVault(...)` を追加する。
- `PepperConfig` の外向き型は維持し、呼び出し側の差分を局所化する。
- Worker プロセス内に 60 秒程度の短い TTL キャッシュを置く。

キャッシュはレイテンシ最適化というより、同一 warm instance 上での無駄な RPC を避けるために入れる。TTL 中にローテーションが走っても `accept_versions` に旧版を残している限り整合性は壊れない。

### 5.3 `anonymous-sync-v2.ts`

対象:

- `packages/FUSOU-WEB/src/server/routes/anonymous-sync-v2.ts`

変更内容:

- `resolveConfig` を分割する。
  - sync: `resolveSharedConfig` (`challenge` / `dataset token` / Supabase 接続)
  - async: `resolvePepperConfigFromVault`
- `register` と `refresh` だけが Pepper RPC を読む。
- `challenge` と `revoke` は現行どおり Pepper 無関係のままにする。

### 5.4 変えないもの

- `packages/fusou-auth/src/manager.rs`
- `packages/fusou-auth/src/device_key.rs`
- `pid = HMAC-SHA256(pepper, api_member_id)`
- `user_devices`, `member_id_hash_rotations`, `user_member_map`

## 6. ローテーション手順

### 6.1 v1 -> v2 追加

1. Vault に新 secret を追加する。

```sql
-- 1 回目: create_secret
SELECT vault.create_secret(
    'new-pepper-secret-here',
    'anon_sync_pepper_v2',
    'anonymous sync pepper v2'
);

-- 再実行時: 既存 name がある場合は update_secret を使う
-- SELECT vault.update_secret(
--   '<existing-secret-uuid>',
--   'new-pepper-secret-here',
--   'anon_sync_pepper_v2',
--   'anonymous sync pepper v2'
-- );

INSERT INTO public.anon_sync_pepper_versions (
    version,
    vault_secret_name
) VALUES (
    'v2',
    'anon_sync_pepper_v2'
)
ON CONFLICT (version) DO UPDATE
SET
    vault_secret_name = EXCLUDED.vault_secret_name,
    retired_at = NULL;
```

1. runtime を切り替える。

```sql
UPDATE public.anon_sync_pepper_runtime
SET
    current_version = 'v2',
    accept_versions = ARRAY['v2', 'v1'],
    version_epoch = version_epoch + 1,
    updated_at = now()
WHERE singleton = true;
```

1. 収束を観測する。

```sql
SELECT salt_version, COUNT(*)
FROM public.user_member_map
GROUP BY 1
ORDER BY 1;

SELECT date_trunc('hour', rotated_at) AS hour, COUNT(*)
FROM public.member_id_hash_rotations
WHERE rotated_at > now() - interval '24 hours'
GROUP BY 1
ORDER BY 1;
```

### 6.2 旧 version の受理停止

```sql
UPDATE public.anon_sync_pepper_runtime
SET
    accept_versions = ARRAY['v2'],
    version_epoch = version_epoch + 1,
    updated_at = now()
WHERE singleton = true;

UPDATE public.anon_sync_pepper_versions
SET retired_at = now()
WHERE version = 'v1'
  AND retired_at IS NULL;
```

ここで初めて v1 は `refresh` 対象から外れる。必要であれば、その後に Vault UI から `anon_sync_pepper_v1` を削除する。

### 6.3 overlap 終了条件

次の 2 条件を満たすまで旧 version を `accept_versions` から外さない。

```sql
SELECT COUNT(*) AS remain_old
FROM public.user_member_map
WHERE salt_version = 'v1';

SELECT COUNT(*) AS recent_old_rotations
FROM public.member_id_hash_rotations
WHERE salt_version_from = 'v1'
  AND rotated_at > now() - interval '14 days';
```

- `remain_old = 0`
- `recent_old_rotations = 0` を監視期間で維持

## 7. セキュリティ / プライバシー / 観測

### 7.1 セキュリティ

- secret の保存先は Vault だけにする。
- Worker には `vault.decrypted_secrets` の直接参照権を与えない。
- Worker が受け取るのは `current_version` と `accept_versions` に必要な subset だけにする。
- ログには `version` と `version_epoch` だけを出し、secret 本体は出さない。
- `get_anon_sync_pepper_bundle()` は `SECURITY DEFINER` のため、`EXECUTE` を `service_role` だけに限定し、`anon` / `authenticated` には付与しない。

### 7.2 プライバシー

- `api_member_id` をサーバーに送る現行モデルは不変。
- `pid` 計算位置が Worker 内から Supabase Vault + RPC を経由する形になるが、クライアントに secret が出ることはない。

### 7.3 観測

最低限追加する。

- `register` / `refresh` の RPC 失敗率
- Worker 内 Pepper cache hit rate
- `current_version` と `salt_version` の分布
- `pepper_version_unknown` の発生件数

## 8. Rollout / Rollback

### 8.1 Rollout

1. migration を適用する。
2. Vault に v1 secret を投入する。
3. Worker を新しい RPC resolver 実装で deploy する。
4. `register` と `refresh` の smoke を通す。
5. 安定確認後に旧 `PEPPER_*` env を削除する。

### 8.2 Rollback

- Rollout 当日に Vault secret は削除しない。
- Rollout 前に旧 `PEPPER_*` の値を暗号化保管しておく（即時 rollback 用）。
- 旧 Worker リリースを保持し、必要なら env ベース実装へ即時戻せる状態を 1 リリース分だけ残す。
- rollback が必要になった場合は、旧 Worker を redeploy して旧 `PEPPER_*` env を一時復元する。

恒久的な二重経路は持たない。rollback 用の退路は切替当日のみ確保し、安定後は前方修正に寄せる。

## 9. 実装対象ファイル

- `packages/FUSOU-WEB/supabase/migrations/20260520000000_anon_sync_pepper_vault_runtime.sql`
- `packages/FUSOU-WEB/src/server/types.ts`
- `packages/FUSOU-WEB/src/server/utils/pepper.ts`
- `packages/FUSOU-WEB/src/server/routes/anonymous-sync-v2.ts`

## 10. 参照

- `docs/operations/web/ANON_SYNC_V2_ROTATION_RUNBOOK.md`
- `packages/FUSOU-WEB/src/server/routes/anonymous-sync-v2.ts`
- `packages/FUSOU-WEB/src/server/utils/pepper.ts`
- `packages/FUSOU-WEB/supabase/migrations/20260518000000_user_devices_and_rotations.sql`
