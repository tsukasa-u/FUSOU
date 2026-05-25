-- v2 anonymous-sync (pepper ベースの匿名同期) で必要となる DB オブジェクトを追加する。
--
-- 背景:
--   旧 /anonymous-sync (v1) は salt をクライアントに埋め込んで member_id_hash を
--   計算する設計で、salt 漏洩で任意アカウントの dataset_token を取得できる弱点が
--   あった。新 /anonymous-sync/v2 では pepper をサーバー側 secret として保持し、
--   端末ごとに Ed25519 keypair で本人性を担保する。
--
-- 本マイグレーションで追加するもの:
--   1. public.user_devices            : 端末 Ed25519 公開鍵レジストリ
--   2. public.member_id_hash_rotations: pepper ローテーション履歴
--   3. public.user_member_map         : hash_algorithm に "hmac-sha256" を許容
--      (v1 は 'sha256' のままで互換維持)
--
-- 既存の user_member_map / user_anonymous_data 系テーブルには破壊的変更を加えず、
-- 旧 /anonymous-sync (v1) と新 /anonymous-sync/v2/* が並走可能な状態を作る。

-- ---------------------------------------------------------------------------
-- 1. user_devices
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_devices (
    device_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    pid                text NOT NULL,
    device_pubkey      bytea NOT NULL,
    pubkey_algo        text NOT NULL DEFAULT 'ed25519',
    registered_at      timestamptz NOT NULL DEFAULT now(),
    last_seen_at       timestamptz,
    revoked_at         timestamptz,
    revoked_reason     text,
    CONSTRAINT user_devices_pid_format CHECK (pid ~ '^[a-f0-9]{64}$'),
    CONSTRAINT user_devices_pubkey_len CHECK (octet_length(device_pubkey) = 32),
    CONSTRAINT user_devices_algo_known CHECK (pubkey_algo IN ('ed25519')),
    CONSTRAINT user_devices_revoked_pair CHECK (
        (revoked_at IS NULL AND revoked_reason IS NULL)
        OR (revoked_at IS NOT NULL)
    ),
    UNIQUE (pid, device_pubkey)
);

CREATE INDEX IF NOT EXISTS idx_user_devices_pid_active
    ON public.user_devices (pid)
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_devices_canonical_user
    ON public.user_devices (canonical_user_id);

COMMENT ON TABLE public.user_devices IS
    'Device registry for v2 anonymous-sync. One row per (pid, device_pubkey). canonical_user_id is the Supabase auth user owning the data; device_pubkey is the Ed25519 raw 32-byte public key stored client-side and used to sign refresh/revoke challenges.';
COMMENT ON COLUMN public.user_devices.pid IS
    'HMAC-SHA256(pepper_vN, api_member_id) hex string. Mirrors user_member_map.member_id_hash for the v2 flow.';
COMMENT ON COLUMN public.user_devices.device_pubkey IS
    'Ed25519 raw 32-byte public key generated client-side and stored in Stronghold/OS keyring.';
COMMENT ON COLUMN public.user_devices.canonical_user_id IS
    'Supabase auth user. CASCADE: when the canonical user is deleted (e.g., 30-day inactivity), device rows are removed and re-registration happens transparently.';

ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_devices_select_own ON public.user_devices;
CREATE POLICY user_devices_select_own ON public.user_devices
    FOR SELECT
    TO authenticated
    USING (auth.uid() = canonical_user_id);

-- INSERT / UPDATE / DELETE は service role (Worker 内 admin client) のみで実施するため
-- authenticated には付与しない。
GRANT SELECT ON public.user_devices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_devices TO service_role;

-- ---------------------------------------------------------------------------
-- 2. member_id_hash_rotations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.member_id_hash_rotations (
    rotation_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_user_id  uuid NOT NULL,
    pid_from           text NOT NULL,
    salt_version_from  text NOT NULL,
    pid_to             text NOT NULL,
    salt_version_to    text NOT NULL,
    rotated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT rotations_pid_from_format CHECK (pid_from ~ '^[a-f0-9]{64}$'),
    CONSTRAINT rotations_pid_to_format   CHECK (pid_to ~ '^[a-f0-9]{64}$'),
    CONSTRAINT rotations_versions_format CHECK (
        salt_version_from ~ '^v[0-9]+$'
        AND salt_version_to ~ '^v[0-9]+$'
    )
);

-- 履歴は canonical user 削除に追従させない (監査・復旧用途で残す)。
-- canonical_user_id は意図的に FK にしない。

CREATE INDEX IF NOT EXISTS idx_rotations_from ON public.member_id_hash_rotations(pid_from);
CREATE INDEX IF NOT EXISTS idx_rotations_to   ON public.member_id_hash_rotations(pid_to);
CREATE INDEX IF NOT EXISTS idx_rotations_user ON public.member_id_hash_rotations(canonical_user_id);

COMMENT ON TABLE public.member_id_hash_rotations IS
    'Pepper rotation audit log. One row per device-driven pid migration from an old pepper version to the current one. Decoupled from auth.users lifecycle (no FK on canonical_user_id) so the history survives canonical user deletion for forensic continuity.';

ALTER TABLE public.member_id_hash_rotations ENABLE ROW LEVEL SECURITY;

-- service role 専用テーブル。authenticated には公開しない (canonical_user_id が
-- 露出する pid 履歴は調査用途で service role のみ閲覧)。
GRANT SELECT, INSERT ON public.member_id_hash_rotations TO service_role;

-- ---------------------------------------------------------------------------
-- 3. user_member_map.hash_algorithm に "hmac-sha256" を許容
-- ---------------------------------------------------------------------------
--
-- 既存 v1 行は hash_algorithm='sha256' のまま残し、v2 経由で作成・更新された
-- 行は 'hmac-sha256' で書き込む。アプリ側コードは algorithm をキーとした分岐は
-- 行わず、salt_version を信頼の源にする。CHECK 制約は元々存在しない想定だが、
-- 将来導入する場合に備えて記録的にコメントだけ残す。

COMMENT ON COLUMN public.user_member_map.salt_version IS
    'Pepper/salt generation tag. v1 = legacy SHA-256(api_member_id || SALT). v2+ = HMAC-SHA256(pepper_vN, api_member_id).';
COMMENT ON COLUMN public.user_member_map.hash_algorithm IS
    'Hash algorithm: "sha256" (v1) or "hmac-sha256" (v2+). salt_version is the authoritative selector.';
