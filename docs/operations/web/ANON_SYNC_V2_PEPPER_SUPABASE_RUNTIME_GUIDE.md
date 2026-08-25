# 匿名同期 UUID public_id cutover 実装・安全ガイド

最終更新: 2026-08-22
対象: FUSOU-WEB、FUSOU-APP、Supabase、Cloudflare Workers、D1、R2

## 1. 結論

匿名同期の公開 member identity は、server-generated random UUID v4 `public_id` に統一します。

- `public_id` は `gen_random_uuid()` で新規生成する。
- `api_member_id` は service-role-only の registration input / mapping key に限定する。
- 旧 hash、pepper、salt、PID、recovery、rotation、fallback、cache は稼働系から削除する。
- 旧 member-owned data は backfill / re-key せず削除する。
- Supabase Auth の `auth.users` と `kc_period_tag` は保持する。
- content hash、payload hash、asset deduplication hash、master/reference data は member identity ではないため保持する。

## 2. Goals / non-goals

### Goals

- 新規登録のたびに、旧 ID と数学的関係を持たない UUID v4 を発行する。
- `api_member_id -> public_id` の mapping を service-role-only で管理する。
- Worker、APP、dataset token、fleet namespace、Realtime payload を UUID keyed contract に揃える。
- RLS、service-role isolation、Ed25519 device signature、challenge nonce HMAC、JWT validation、ownership check、rate limit を維持する。

### Non-goals

- 既存 member data を UUID に移行すること。
- 旧 token / PID を互換維持すること。
- 旧 Vault secret を rollback 用に残すこと。
- Supabase Auth user を作り直すこと。

## 3. Identity と ownership の契約

`public.member_id_mapping` は次の制約を持ちます。

- `api_member_id`: 1-16 桁の数字、unique
- `public_id`: `uuid NOT NULL DEFAULT gen_random_uuid()`、unique、UUID v4 check
- anon / authenticated / 直接 client には table privilege を付与しない
- registration と lookup は service-role-only RPC を経由する

RPC が mapping を返しても、それだけで ownership を確定しません。Worker は認証済み user、attested device、既存 `public_id` owner を同じ registration transaction の中で検証し、別 owner の上書きを拒否します。同じ登録の再試行だけは idempotent に扱います。

dataset token は UUID dataset ID だけを受理し、旧 text/hash/PID ID は拒否します。token の signature、expiry、audience、type と device/member ownership の検証を省略しません。

## 4. データ境界

### 保持

- `auth.users`
- `public.kc_period_tag`
- master/reference data
- content hash、payload hash、asset deduplication hash
- member identity と無関係な shared / derived data

### 削除

- `datasets`、`fleets`、processing metrics、provider tokens、API keys、trusted devices、verification codes
- nonce consumption rows
- 旧 transfer / social link / recovery / identity anchor / rotation / pending sync object
- D1 の固定 member-data allowlist に該当する rows
- R2 `dev-kc-fleets` bucket の `fleets/` prefix 全体
- Vault の versioned legacy secret 名 `anon_sync_pepper_v<N>` / `anon_sync_recovery_v<N>`

R2 `fleets/` は旧 namespace と新 namespace を共有するため、UUID registration / fleet write を再開する前に purge します。`dev-kc-assets`、battle data、master data、ship-growth archive、content-hash object は対象外です。

## 5. Supabase migration の安全性

正規 migration は `packages/FUSOU-WEB/supabase/migrations/20260822120000_destructive_uuid_public_id_cutover.sql` です。

migration は次の fail-closed guard を先に行います。

- `auth.users` が存在する。
- `kc_period_tag` が存在する。
- `vault.secrets` が存在する。
- `gen_random_uuid()` が利用可能である。

Vault cleanup は次の条件に完全一致する name だけを対象にします。

```sql
DELETE FROM vault.secrets
WHERE name ~ '^anon_sync_(pepper|recovery)_v[0-9]+$';
```

secret 値を select せず、`vault.decrypted_secrets` も参照しません。Supabase Vault の拡張や権限状態が想定と異なる場合、旧 secret を残したまま cutover を進めないため migration を失敗させます。

## 6. 運用前後の検証

事前の件数確認は secret 値ではなく name の count のみを使います。

```sql
SELECT count(*)
FROM vault.secrets
WHERE name ~ '^anon_sync_(pepper|recovery)_v[0-9]+$';
```

migration 後は count が 0 であること、旧 table/function/policy/publication が catalog に残っていないことを確認します。旧 migration ファイルや historical documentation に旧語が残ることは許容しますが、deployed catalog と active runtime に旧 identity object を残しません。

アプリ側では次を確認します。

- UUID registration / refresh が成功する。
- 非 UUID dataset ID と旧 token が拒否される。
- user/device ownership collision が 401/409 で停止する。
- fleet key と Realtime payload が `public_id` keyed である。
- `auth.users` を使う通常ログインが継続する。
- 現行 `DATASET_TOKEN_SECRET` と `CHALLENGE_HMAC_SECRET` は保持される。

## 7. rollback 制約

これは destructive cutover であり、down migration や旧 secret の再登録を rollback として扱いません。復旧調査が必要な場合は、backup / export を別環境へ復元して影響範囲を調べます。原環境へ旧 identity runtime を再投入する判断は、別途 security review と明示承認が必要です。

R2、D1、Supabase の apply はそれぞれ preflight が read-only であることを確認し、承認記録の後にだけ実行します。未検証の remote apply、Vault の secret 値の出力、allowlist 外の purge は行いません。

## 8. 参照実装

- UUID cutover migration: `packages/FUSOU-WEB/supabase/migrations/20260822120000_destructive_uuid_public_id_cutover.sql`
- D1 purge tool: `packages/FUSOU-WEB/scripts/purge-d1-member-data.mjs`
- R2 purge tool: `packages/FUSOU-WEB/scripts/purge-r2-fleet-data.mjs`
- cutover runbook: `docs/operations/web/ANON_SYNC_V2_ROTATION_RUNBOOK.md`
