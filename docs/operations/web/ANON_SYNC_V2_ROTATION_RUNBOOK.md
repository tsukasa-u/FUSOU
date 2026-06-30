# 匿名同期 v2 / Pepper ローテーション運用ランブック（内部）

## 1. 目的

本書は、匿名同期 v2（pepper + Ed25519 device key）について、以下を運用観点で整理した内部資料です。

- 実装済み機能の一覧
- 本番運用手順
- ローテーション手順
- 検証とロールバック手順

注記:

- 本書は現行実装（Supabase Vault + `public.anon_sync_pepper_runtime` テーブルで pepper 秘密と世代状態を管理する方式）の運用手順を扱う。
- 設計詳細・SQL 定義・段階的ローテーションの不変条件は `docs/operations/web/ANON_SYNC_V2_PEPPER_SUPABASE_RUNTIME_GUIDE.md` に集約しており、本書はそちらを前提に運用フローのみを記述する。

---

## 2. 実装済み機能

### 2.1 サーバー API（FUSOU-WEB）

実装ファイル:

- `packages/FUSOU-WEB/src/server/routes/anonymous-sync-v2.ts`
- `packages/FUSOU-WEB/src/server/utils/pepper.ts`

公開経路（`/api/auth` 配下）:

- `POST /anonymous-sync/v2/register`
  - `api_member_id`, `device_pub`, `attestation` を受け付ける
  - サーバー側で `pid = HMAC-SHA256(pepper_current, api_member_id)` を計算
  - `user_member_map` の canonical owner を作成/復元
  - `user_devices` に公開鍵を登録
  - `dataset_token` を発行

- `GET /anonymous-sync/v2/challenge?device_id=...`
  - 端末 nonce を発行

- `POST /anonymous-sync/v2/refresh`
  - nonce と端末署名を検証
  - `dataset_token` を再発行
  - 必要時に pid を current pepper へ移行
  - `member_id_hash_rotations` に履歴を記録

- `POST /anonymous-sync/v2/revoke`
  - 同一 canonical user 配下の target device を失効

### 2.2 セキュリティ制御

- pepper はサーバー secret としてのみ保持
- Ed25519 公開鍵登録 + challenge 署名検証
- stateless challenge nonce 発行/検証
- nonce ワンタイム化（DB: `anon_sync_nonce_consumptions` の一意制約）
- refresh 冪等化（KV: `refresh-result:{device_id}:{nonce}`）
- register 経路で pid 単位レート制限

### 2.3 Supabase スキーマ

マイグレーション:

- `packages/FUSOU-WEB/supabase/migrations/20260518000000_user_devices_and_rotations.sql`
- `packages/FUSOU-WEB/supabase/migrations/20260520000000_anon_sync_pepper_vault_runtime.sql`
- `packages/FUSOU-WEB/supabase/migrations/20260520010000_anon_sync_pepper_rotation_rpc.sql`
- `packages/FUSOU-WEB/supabase/migrations/20260521000000_anon_sync_recovery_hmac_runtime.sql`
- `packages/FUSOU-WEB/supabase/migrations/20260521010000_anon_sync_vault_ops_rpc.sql`
- `packages/FUSOU-WEB/supabase/migrations/20260522000000_anon_sync_nonce_consumptions.sql`
- `packages/FUSOU-WEB/supabase/migrations/20260523000000_anon_sync_vault_rpc_acl_hardening.sql`

テーブル:

- `public.user_devices`
  - `device_id`, `canonical_user_id`, `pid`, `device_pubkey`, revoke metadata

- `public.member_id_hash_rotations`
  - `pid_from`, `pid_to`, `salt_version_from`, `salt_version_to`, `rotated_at`

- `public.user_member_map`（v2 利用形態）
  - `member_id_hash` に pid を保持
  - `salt_version`, `hash_algorithm` を回転時に更新

- `public.anon_sync_pepper_versions`
  - pepper 世代カタログ。`version`, `vault_secret_name`, `retired_at`

- `public.anon_sync_pepper_runtime`
  - シングルトン行で `current_version` / `accept_versions` / `version_epoch` を保持

- `public.anon_sync_recovery_versions`
  - 復旧用 HMAC キー世代カタログ。`version`, `vault_secret_name`, `retired_at`

- `public.anon_sync_recovery_runtime`
  - シングルトン行で recovery key の `current_version` / `accept_versions` / `version_epoch` を保持

- `public.user_identity_anchor`
  - `canonical_user_id` と `recovery_id_hash` の 1:1 紐付け

- `public.recovery_relink_audit`
  - recovery fallback による再リンク許可/拒否の監査ログ

- `public.anon_sync_nonce_consumptions`
  - refresh nonce の一回消費を原子的に確定する（`(device_id, nonce)` 主キー）
  - アプリ側で 5 分ごと（インスタンス単位）に 30 分より古い行をクリーンアップする

関数:

- `public.get_anon_sync_pepper_bundle()` (SECURITY DEFINER, `service_role` のみ EXECUTE)
  - Vault から accept_versions 全入りのシークレットを集約し JSON で返す
  - Worker (`resolvePepperConfigFromVault`) はこの RPC だけを叫ぶ

- `public.get_anon_sync_recovery_bundle()` (SECURITY DEFINER, `service_role` のみ EXECUTE)
  - recovery key の accept_versions を集約して JSON を返す
  - Worker は `pepper_version_unknown` 時の連続性回復判定に使う

### 2.4 SDK 実装（fusou-auth）

実装ファイル:

- `packages/fusou-auth/src/device_key.rs`
- `packages/fusou-auth/src/manager.rs`

追加 API:

- `register_device_v2(...)`
- `refresh_dataset_token_v2(...)`
- `revoke_device_v2(...)`
- `ensure_dataset_token_v2(...)`
- `resolve_dataset_id_for_upload(...)`

device key の実装内容:

- 端末ごとに Ed25519 keypair を 1 回生成
- ローカルに `device-key.json` 形式で永続化
- register 成功後に `device_id` を保存
- refresh/revoke で challenge 署名を生成

重要:

- `manage-anon-sync-vault` がローテーションする「秘密」は、サーバー側の HMAC 系 secret（pepper/recovery）です。
- Rust SDK の `device-key.json`（端末の Ed25519 秘密鍵）はローテーション対象ではありません。
- `device-key.json` を失効/再発行したい場合は `/anonymous-sync/v2/revoke` + 再 register で端末単位に実施します。

### 2.5 APP 設定（configs.toml）

設定ファイル:

- `packages/configs/configs.toml`

v2 endpoint キー:

- `anonymous_sync_v2_register_endpoint`
- `anonymous_sync_v2_challenge_endpoint`
- `anonymous_sync_v2_refresh_endpoint`
- `anonymous_sync_v2_revoke_endpoint`

### 2.6 運用補助

- Pepper ローテーションは Supabase 側の SQL オブジェクト (`vault` / `anon_sync_pepper_*`) を正とする。
- 誤操作を減らすため、運用は `pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- ...` を正とする。
- `manage-anon-sync-vault` は `rotate_anon_sync_pepper` / `rotate_anon_sync_recovery_key` を呼び、既定で dry-run、`--confirm` 指定時のみ更新する。
- `manage-anon-sync-vault` は bootstrap / rotate / finalize をまとめて扱う。既定は dry-run で、`--confirm` 指定時のみ更新する。
- 安全のため `--secret` / `--service-role-key` 引数は無効化している。機密は環境変数で渡す。
- 手作業での SQL 実行が必要な場合は
  `docs/operations/web/ANON_SYNC_V2_PEPPER_SUPABASE_RUNTIME_GUIDE.md` の §6・§7 テンプレートを使う。

---

## 3. 必須ランタイム設定

### 3.1 FUSOU-WEB Worker Secrets / Vars

- `DATASET_TOKEN_SECRET`
- `CHALLENGE_HMAC_SECRET`
- `SUPABASE_SECRET_KEY` (`get_anon_sync_pepper_bundle` RPC を service_role で叫ぶために必須)
- `PUBLIC_SUPABASE_URL`

Worker は Vault から pepper を取得するため、`PEPPER_*` 系の環境変数は一切使わない。

### 3.1.1 シークレット管理マップ（保存場所と更新手段）

| 対象                           | 代表名                                                 | 保存場所                                                                | 変更方法                                                                                          | ランタイム参照                    |
| ------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------- |
| Pepper 本体（秘密値）          | `anon_sync_pepper_v<N>`                                | Supabase Vault (`vault.secrets`)                                        | `manage-anon-sync-vault` の `bootstrap-pepper` / `rotate-pepper`（または Vault UI + SQL/RPC）     | `get_anon_sync_pepper_bundle()`   |
| Recovery 本体（秘密値）        | `anon_sync_recovery_v<N>`                              | Supabase Vault (`vault.secrets`)                                        | `manage-anon-sync-vault` の `bootstrap-recovery` / `rotate-recovery`（または Vault UI + SQL/RPC） | `get_anon_sync_recovery_bundle()` |
| 受理世代セット（秘密ではない） | `current_version`, `accept_versions`, `version_epoch`  | `public.anon_sync_pepper_runtime` / `public.anon_sync_recovery_runtime` | `manage-anon-sync-vault` の `rotate-*` / `finalize-*`（または SQL/RPC）                           | bundle RPC の戻り値               |
| dataset_token 署名鍵           | `DATASET_TOKEN_SECRET`                                 | Cloudflare Worker Secret                                                | `wrangler secret put` で更新                                                                      | Worker env から直接参照           |
| challenge HMAC 鍵              | `CHALLENGE_HMAC_SECRET`                                | Cloudflare Worker Secret                                                | `wrangler secret put` で更新                                                                      | Worker env から直接参照           |
| Supabase service role key      | `SUPABASE_SECRET_KEY`                                  | Cloudflare Worker Secret                                                | `wrangler secret put` で更新                                                                      | Supabase RPC 実行に使用           |
| 運用入力用 env（実行時のみ）   | `ANON_SYNC_PEPPER_SECRET`, `ANON_SYNC_RECOVERY_SECRET` | オペレータ端末のシェル環境 / `.env`                                     | `manage-anon-sync-vault` 実行時に読み取り（fail-fast）                                            | 永続ランタイムには保持しない      |

補足:

- Vault UI だけを変更しても `accept_versions` は変わらない。`runtime` テーブル（通常は `manage-anon-sync-vault` 経由）を更新する必要がある。
- 変更反映に再ビルドは不要。Worker の in-memory キャッシュ TTL（60 秒）を過ぎると新設定が参照される。
- ローテーション対象 secret は次の 2 つ: `anon_sync_pepper_v<N>` / `anon_sync_recovery_v<N>`（= `ANON_SYNC_PEPPER_SECRET` / `ANON_SYNC_RECOVERY_SECRET` の投入元）。

### 3.2 Supabase

- `user_devices` / `member_id_hash_rotations` を含む migration を適用
- `anon_sync_pepper_versions` / `anon_sync_pepper_runtime` を含む migration (`20260520000000_*.sql`) を適用
- `rotate_anon_sync_pepper` RPC を含む migration (`20260520010000_anon_sync_pepper_rotation_rpc.sql`) を適用
- `anon_sync_recovery_*` / `user_identity_anchor` / `recovery_relink_audit` を含む migration (`20260521000000_anon_sync_recovery_hmac_runtime.sql`) を適用
- `ensure_*` / `finalize_*` RPC を含む migration (`20260521010000_anon_sync_vault_ops_rpc.sql`) を適用
- Vault RPC ACL hardening migration (`20260523000000_anon_sync_vault_rpc_acl_hardening.sql`) を適用
- 初期 pepper を Vault に投入し、`anon_sync_pepper_versions` / `anon_sync_pepper_runtime` を投入済みにする（手順: GUIDE §4.4 参照）
- 初期 recovery key を Vault に投入し、`anon_sync_recovery_versions` / `anon_sync_recovery_runtime` を投入済みにする
- Worker の service role 接続が有効であることを確認

### 3.3 クライアント endpoint

- `configs.toml` の v2 endpoint がデプロイ先 origin と一致していること

---

## 4. 運用手順

### 4.1 v2 有効化（固定運用）

1. DB migration を適用する。

```bash
cd packages/FUSOU-WEB
# 例: supabase db push
```

1. Worker secret/var を設定する。

- `DATASET_TOKEN_SECRET` を投入
- `CHALLENGE_HMAC_SECRET` を投入
- Vault 初期シークレットを `vault.create_secret('...', 'anon_sync_pepper_v1', ...)` で投入
- `anon_sync_pepper_versions` / `anon_sync_pepper_runtime` を投入 (GUIDE §4.4)
- Worker 環境に `PEPPER_*` 系は設定しない

1. WEB をデプロイする。

```bash
cd packages/FUSOU-WEB
pnpm run build
# 標準の deploy フローを実行
```

1. API 疎通を確認する。

- `POST /api/auth/anonymous-sync/v2/register`
- `GET /api/auth/anonymous-sync/v2/challenge`
- `POST /api/auth/anonymous-sync/v2/refresh`
- `POST /api/auth/anonymous-sync/v2/revoke`
- `POST /api/auth/anonymous-sync` が `410 Gone` を返す（legacy v1 は無効）

1. クライアントの token 更新経路を確認する。

- `ensure_dataset_token_v2` が稼働
- `resolve_dataset_id_for_upload` で dataset_id が解決

### 4.2 ローテーション手順（例: v1 -> v2）

適用対象 SQL（どれを適用するか）:

- 既存環境でローテーション CLI を使う場合は、少なくとも次の migration が必要。
  - `20260520000000_anon_sync_pepper_vault_runtime.sql`
  - `20260520010000_anon_sync_pepper_rotation_rpc.sql`
  - `20260521000000_anon_sync_recovery_hmac_runtime.sql`
  - `20260521010000_anon_sync_vault_ops_rpc.sql`
  - `20260522000000_anon_sync_nonce_consumptions.sql`
  - `20260523000000_anon_sync_vault_rpc_acl_hardening.sql`
- 新規環境を初期構築する場合は `supabase/migrations` 配下を時系列順にすべて適用する。
- `supabase/migrations` 配下の既存 migration は履歴として必要なため削除しない。

事前に必要な環境変数:

- `ANON_SYNC_PEPPER_SECRET`
  - 必須。今回ローテーションで投入する「新しい pepper 値」を設定する。
  - `DATASET_TOKEN_SECRET` や `CHALLENGE_HMAC_SECRET` ではない。
- `ANON_SYNC_RECOVERY_SECRET`
  - 必須。今回ローテーションで投入する「新しい recovery key 値」を設定する。
- `PUBLIC_SUPABASE_URL`（または `SUPABASE_URL`）
- `SUPABASE_SECRET_KEY`（または `SUPABASE_SERVICE_ROLE_KEY`）
- `20260522000000_anon_sync_nonce_consumptions.sql` が適用されていること（refresh nonce の同時実行再利用を防ぐため）。

CLI の fail-fast 仕様:

- `bootstrap-pepper` / `bootstrap-recovery` は `--initial-version v<N>` の明示指定が必須。
- `--secret-env <ENV_NAME>` を明示指定した場合、`<ENV_NAME>` が未設定なら CLI はエラーで停止する。
- `--secret-env` を省略した場合も、既定 env（pepper は `ANON_SYNC_PEPPER_SECRET`、recovery は `ANON_SYNC_RECOVERY_SECRET`）が未設定なら CLI はエラーで停止する。

`pnpm run manage-anon-sync-vault` は `dotenvx` 経由で `.env` を読むため、通常は
Supabase URL / service-role key は `.env` から供給される。
secret は必ず環境変数で明示指定する（自動生成フォールバックなし）。

CLI 実行の基本ルール:

- `manage-anon-sync-vault` は `--confirm` がない限り更新しない。必ず「dry-run -> 出力確認 -> --confirm」の順で進める。
- `pepper` と `recovery` は同じフェーズでペア実行する（片系だけ先行しない）。
- 判定ゲートは `status --json` を使う。`ok: true` を次工程の開始条件にする。
- ローテーション対象世代（例: `v2`）は pepper/recovery で同じ値を使う。
- Vault RPC の実行権限は `service_role` のみを許可し、`anon` / `authenticated` を必ず拒否する。

ACL 検証クエリ（ローテーション前後で必ず実行）:

```sql
SELECT
  has_function_privilege('anon', 'public.get_anon_sync_pepper_bundle()', 'EXECUTE') AS anon_can_exec_pepper_bundle,
  has_function_privilege('authenticated', 'public.get_anon_sync_pepper_bundle()', 'EXECUTE') AS auth_can_exec_pepper_bundle,
  has_function_privilege('service_role', 'public.get_anon_sync_pepper_bundle()', 'EXECUTE') AS service_can_exec_pepper_bundle,
  has_function_privilege('anon', 'public.get_anon_sync_recovery_bundle()', 'EXECUTE') AS anon_can_exec_recovery_bundle,
  has_function_privilege('authenticated', 'public.get_anon_sync_recovery_bundle()', 'EXECUTE') AS auth_can_exec_recovery_bundle,
  has_function_privilege('service_role', 'public.get_anon_sync_recovery_bundle()', 'EXECUTE') AS service_can_exec_recovery_bundle;
```

期待値:

- `anon_can_exec_* = false`
- `auth_can_exec_* = false`
- `service_can_exec_* = true`

#### 4.2.1 初期化フェーズ（runtime が空のときだけ実施）

判定条件:

- `pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- status --json` で
  `pepper.runtime` または `recovery.runtime` が `null`。

実行順:

```bash
# 0) 事前状態確認
pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- status --json

# 1) dry-run（初期化計画の確認）
pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- \
  bootstrap-pepper --initial-version v1 --json
pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- \
  bootstrap-recovery --initial-version v1 --json

# 2) 実適用
pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- \
  bootstrap-pepper --initial-version v1 --confirm --json
pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- \
  bootstrap-recovery --initial-version v1 --confirm --json

# 3) 反映確認
pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- status --json
```

期待結果:

- `status --json` が `ok: true`。
- `pepper.runtime.current_version = v1` かつ `recovery.runtime.current_version = v1`。
- `accept_versions = ["v1"]`。

補足:

- 既に初期化済み環境で bootstrap を実行すると `already_initialized: true` が返る（no-op）。

#### 4.2.2 ローテーションフェーズ（例: v1 -> v2）

実行順:

```bash
# 0) 事前状態確認
pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- status --json

# 1) dry-run（回転計画の確認）
pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- \
  rotate-pepper --target-version v2 --json
pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- \
  rotate-recovery --target-version v2 --json

# 2) 実適用
pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- \
  rotate-pepper --target-version v2 --confirm --json
pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- \
  rotate-recovery --target-version v2 --confirm --json

# 3) 反映確認
pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- status --json
```

dry-run で確認する項目:

- `current_version` が期待どおり（例: `v1`）。
- `planned_accept_versions` の先頭が `target_version`（例: `v2`）。
- `planned_version_epoch` が +1 になっている。

実適用後の期待結果:

- `status --json` で `pepper.runtime.current_version = v2`。
- `status --json` で `recovery.runtime.current_version = v2`。
- `accept_versions` に `v2` と旧版（例: `v1`）が共存。

#### 4.2.3 収束フェーズ（finalize）

前提:

- `user_member_map.salt_version` の旧版残数が運用上の許容値まで低下。
- `member_id_hash_rotations` と `recovery_relink_audit` に異常増加がない。

実行順:

```bash
# 0) dry-run（keep-version の妥当性確認）
pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- \
  finalize-pepper --keep-version v2 --retire-others --json
pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- \
  finalize-recovery --keep-version v2 --retire-others --json

# 1) 実適用
pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- \
  finalize-pepper --keep-version v2 --retire-others --confirm --json
pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- \
  finalize-recovery --keep-version v2 --retire-others --confirm --json

# 2) 最終確認
pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- status --json
```

最終期待結果:

- `pepper.runtime.accept_versions = ["v2"]`。
- `recovery.runtime.accept_versions = ["v2"]`。
- 必要に応じて旧版の `retired_at` が設定される（`--retire-others` 指定時）。

#### 4.2.4 適用後の観測と削除ポリシー

WEB を再デプロイする必要はない（環境変数を触らないため）。キャッシュは最大 60 秒で反映される。

収束観測 SQL:

```sql
SELECT salt_version, count(*)
FROM public.user_member_map
GROUP BY 1
ORDER BY 1;

SELECT date_trunc('hour', rotated_at) AS hour, count(*)
FROM public.member_id_hash_rotations
WHERE rotated_at > now() - interval '24 hours'
GROUP BY 1
ORDER BY 1;

SELECT outcome, reason, count(*)
FROM public.recovery_relink_audit
WHERE created_at > now() - interval '24 hours'
GROUP BY 1, 2
ORDER BY 1, 2;
```

旧版 secret の削除ポリシー:

- `salt_version='v1'` が残っている間は `anon_sync_pepper_v1` を物理削除しない。
- 「accept から除外」と「secret 物理削除」を同時に実施しない。
- 追跡連続性を維持するため、まず分布と復帰率を監視してから段階的に退役する。

詳細な SQL テンプレートと不変条件は
`docs/operations/web/ANON_SYNC_V2_PEPPER_SUPABASE_RUNTIME_GUIDE.md` の §6、§7 を正とする。
本書のコマンドが使えない場合のみ手作業 SQL を選ぶ。

### 4.3 端末失効手順

1. 呼び出し端末で challenge を取得する。

1. `revoke|{caller_device_id}|{target_device_id}|{nonce}` を署名する。

1. `POST /api/auth/anonymous-sync/v2/revoke` を実行する。

1. `user_devices.revoked_at` 更新を確認する。

---

## 5. 検証手順

1. WEB 側の静的/監査チェックを実行する。

```bash
cd packages/FUSOU-WEB
pnpm run astro check
pnpm run audit:anon-sync-v1
```

1. SDK/APP 側チェックを実行する。

```bash
cd packages/fusou-auth
cargo check --all-targets

cd ../FUSOU-APP/src-tauri
cargo check --all-targets
```

1. 必要に応じてスモーク E2E を実行する。

```bash
cd packages/FUSOU-WEB
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:4401'
$env:PLAYWRIGHT_REUSE_SERVER='true'
pnpm run e2e:simulator:smoke
```

---

## 6. ロールバック手順

1. まず旧世代が accept に残っているかを `status` で確認する。

```bash
pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- status
```

1. 旧世代が accept に残っている場合は finalize で current を戻す（pepper/recovery の両方）。

```bash
pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- \
  finalize-pepper --keep-version <old> --confirm
pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- \
  finalize-recovery --keep-version <old> --confirm
```

1. 旧世代が accept から外れている場合は rotate で `<old>` を再投入する（pepper/recovery の両方）。

```bash
pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- \
  rotate-pepper --target-version <old> --confirm
pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- \
  rotate-recovery --target-version <old> --confirm
```

1. `<old>` の Vault secret が削除済みの場合は、復旧元 secret を先に再登録してから実行する。

1. キャッシュ反映に最大 60 秒待機し、第 5 章の検証手順を再実行する。

1. `member_id_hash_rotations` は監査用途として保持する。

---

## 7. 参照（実装の一次情報）

- `docs/operations/web/ANON_SYNC_V2_PEPPER_SUPABASE_RUNTIME_GUIDE.md`
- `packages/FUSOU-WEB/src/server/routes/anonymous-sync-v2.ts`
- `packages/FUSOU-WEB/src/server/utils/pepper.ts`
- `packages/FUSOU-WEB/supabase/migrations/20260518000000_user_devices_and_rotations.sql`
- `packages/FUSOU-WEB/supabase/migrations/20260520000000_anon_sync_pepper_vault_runtime.sql`
- `packages/FUSOU-WEB/supabase/migrations/20260521000000_anon_sync_recovery_hmac_runtime.sql`
- `packages/fusou-auth/src/device_key.rs`
- `packages/fusou-auth/src/manager.rs`
- `packages/configs/configs.toml`

---

## 8. 設計上の不変条件（plan からの吸収）

v2 設計の根拠となる不変条件を、計画書を残さない前提で本書に固定する。

### 8.1 pid 計算式

- `pid = HMAC-SHA256(pepper_vN, api_member_id)`（hex 64 文字）
- pepper はサーバー secret 専用で、クライアントには返さない
- `user_member_map.member_id_hash` カラムに pid を格納し、`salt_version` で世代を識別

### 8.2 Nonce/KV キーと TTL

| キー                                 | TTL        | 用途                  |
| ------------------------------------ | ---------- | --------------------- |
| `anon-sync-rate:{pid}`               | 1h sliding | register のレート制限 |
| `refresh-result:{device_id}:{nonce}` | 5m         | refresh の冪等再送    |

### 8.3 既知バグの状態（plan §0.5 吸収）

| ID    | 概要                                                          | 状態                                                                             |
| ----- | ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Bug-1 | `member_id_hash` 大文字許容によるレート bypass / 重複 mapping | 修正済み（`anonymous-sync.ts` / `utils.ts` / `member-lookup.ts` を小文字厳格化） |
| Bug-2 | KV sliding window が閉じない                                  | 未修正・影響軽微（v3 で fixed window へ）                                        |
| Bug-3 | `fusou-auth-attempt.json` に `member_id_hash` 平文保存        | 未修正・影響限定（v2 移行完了後に `device_id` のみへ）                           |
| Bug-4 | Windows でセッションファイルの権限未設定                      | 未修正・低リスク（OS keyring 移行で解消予定）                                    |

### 8.4 残存リスク

- 初回 register は first-write-wins。`api_member_id` を知る攻撃者が先に register する余地は残る
- 登録後の refresh は Ed25519 + nonce ワンタイム消費で防御
- pepper 流出時は本書 §4.2 のローテーションで全 pid を切替可能（完全リカバリ）

### 8.5 容量見積もり（Workers Paid + Supabase Free）

- Requests: DAU 1,000 × 起動 3 回 × 3 req ≒ 270k/月
- KV write: 270k + `refresh-result` 加算
- Supabase auth.users: 端末数ベース（Free 50,000 MAU で十分）
- `user_devices` 行サイズ ≒ 200B / 端末
