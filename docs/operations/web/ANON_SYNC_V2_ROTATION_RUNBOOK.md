# 匿名同期 UUID public_id cutover 運用 runbook

## 1. 目的と適用範囲

本書は、匿名同期の pepper / PID identity から、Supabase が登録時に生成する UUID v4 `public_id` へ切り替える破壊的 cutover の手順です。

この cutover は旧 member-owned data を削除します。旧 ID を新 UUID へ backfill / re-key しません。既存の `auth.users` と `kc_period_tag`、content hash、payload hash、asset deduplication hash、master/reference data は保持します。

対象の cleanup:

- Supabase の member-owned data、旧 identity / recovery / rotation / sync object
- Vault の `anon_sync_pepper_v<N>` と `anon_sync_recovery_v<N>` secret
- 固定 D1 database の inventory（全 table / row / column を保持）
- 固定 R2 bucket `dev-kc-fleets` の prefix `fleets/` の inventory（object は保持）

## 2. 禁止事項

- 本書の `--apply` を明示承認なしに実行しない。
- 旧 secret の値、Vault の `decrypted_secrets`、object key、metadata、checksum を出力・保存しない。
- `auth.users` を削除しない。
- D1 の固定 allowlist 外の table、R2 の `fleets/` 外の object、Supabase の master/reference data を削除しない。
- 旧 runtime、旧 RPC、旧 secret を rollback window のために再有効化しない。

## 3. 実行前チェック

1. UUID-only の Worker / APP をリリース候補として用意する。新コードが必要とする Supabase migration、D1 schema、R2 namespace を確認する。
2. fleet write、anonymous-sync registration/refresh、関連 batch を凍結する。D1/R2 の既存データは保持し、固定範囲の inventory だけを取得する。
3. 既存のバックアップ / export 方針を確認し、アクセス制限・保存期間・破棄担当を記録する。復旧用コピーに旧 hash / secret を残す必要がない場合は作成しない。
4. Supabase migration の適用対象を確認する。

```bash
supabase db push --linked --dry-run
```

5. Vault の secret 値ではなく、対象名の件数だけを事前記録する。

```sql
SELECT count(*) AS legacy_anon_sync_vault_secret_count
FROM vault.secrets
WHERE name ~ '^anon_sync_(pepper|recovery)_v[0-9]+$';
```

6. 変更担当、承認者、実行時刻、対象環境、バックアップ識別子を運用記録に残す。

## 4. 実行順

### 4.1 新コードを凍結状態で配備

旧 runtime / RPC の削除前に、Worker と APP が UUID-only のコードを参照する状態にします。まだ新規 member / fleet write を許可しません。

### 4.2 R2 fleet namespace を inventory

`purge-r2-fleet-data.mjs` は固定 bucket と prefix だけを対象にします。`--plan` は API request を行わず、`--remote` は list の count-only inventory です。`--apply` は実行しません。R2 object はこの cutover では削除しません。

```bash
node packages/FUSOU-WEB/scripts/purge-r2-fleet-data.mjs --plan
node packages/FUSOU-WEB/scripts/purge-r2-fleet-data.mjs --remote
```

件数、bucket、prefix だけを確認し、object は保持します。

### 4.3 D1 shared data を inventory

`purge-d1-member-data.mjs` は名称に反して preservation-only です。Fleet-owned D1 table の allowlist は空で、全 D1 table、row、column を保持したまま inventory を出力します。

```bash
node packages/FUSOU-WEB/scripts/purge-d1-member-data.mjs
node packages/FUSOU-WEB/scripts/purge-d1-member-data.mjs --remote
```

対象 DB は `dev-kc-battle-index`、`dev-kc-quest-index`、`dev-kc-remodel-index`、`dev-kc-soku-speed-observed`、`dev-kc-ship-growth` の固定集合です。件数、table、column を確認し、D1 の削除は行いません。

### 4.4 Supabase UUID cutover migration を適用

migration の dry-run と承認を経て適用します。

```bash
supabase db push --linked --dry-run
supabase db push --linked
```

`20260822120000_destructive_uuid_public_id_cutover.sql` は次を同一 transaction で行います。

- member-owned data と旧 identity / recovery / rotation / sync data の削除
- `vault.secrets` から、正規表現に完全一致する旧 pepper / recovery secret の削除
- 旧 table / function の削除
- service-role-only の `api_member_id -> public_id` mapping と UUID keyed table の作成
- `auth.users` と `kc_period_tag` の保持

`vault.secrets` が存在しない場合は migration が fail closed します。Vault UI で secret 値を開いたり、`vault.decrypted_secrets` を query したりしません。

### 4.5 smoke test と再開

migration の commit 後に次を確認します。

- 新規 registration が UUID v4 `public_id` を受け取る。
- 非 UUID dataset ID、旧 token、旧 v1 endpoint が拒否される。
- 別 user / device の ownership collision が上書きなく拒否される。
- dataset token の signature、expiry、audience、type、device/member ownership 検証が継続する。
- fleet upload / download が `fleets/<public_id>/...` namespace を使う。
- Realtime pending sync が `public_id` payload を使う。

問題がなければ write freeze を解除します。解除前に、古い client が再登録ループを起こしていないことをログで確認します。

## 5. postflight SQL

Vault の secret 値を取得せず、対象名の残数を確認します。

```sql
SELECT count(*) AS remaining_legacy_anon_sync_vault_secrets
FROM vault.secrets
WHERE name ~ '^anon_sync_(pepper|recovery)_v[0-9]+$';
```

旧 public table が残っていないことを確認します。

```sql
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'member_transfer_history',
    'social_member_links',
    'member_id_hash_rotations',
    'recovery_relink_audit',
    'user_identity_anchor',
    'anon_sync_pepper_runtime',
    'anon_sync_pepper_versions',
    'anon_sync_recovery_runtime',
    'anon_sync_recovery_versions',
    'pending_member_syncs'
  );
```

旧 function、policy、Realtime publication が残っていないことも live catalog で確認します。確認対象の function 名は `get_anon_sync_pepper_bundle`、`get_anon_sync_recovery_bundle`、`rotate_anon_sync_pepper`、`rotate_anon_sync_recovery_key`、`ensure_anon_sync_pepper_runtime`、`ensure_anon_sync_recovery_runtime`、`finalize_anon_sync_pepper_accept`、`finalize_anon_sync_recovery_accept` です。

`auth.users` の件数が保持され、`kc_period_tag` が利用可能であることも確認します。R2/D1 は各 inventory tool の結果で対象範囲と保持状態を確認します。

## 6. rollback と事故対応

この migration と data purge には通常の down migration による rollback はありません。誤削除が疑われる場合は、対象環境への再投入や旧 runtime の再有効化をせず、承認済み backup / export を使った別環境で復旧可能性を調査します。

- Supabase の `auth.users` は保持されるため、認証ユーザー自体は cutover の削除対象ではありません。
- member-owned data と旧 Vault secret は migration 適用後に通常操作で復元できません。D1 rows と R2 fleet objects はこの cutover では保持します。
- R2 inventory が失敗した場合は prefix 外へ対象を広げず、件数と API エラーだけを記録します。
- migration が途中で失敗した場合は transaction rollback の結果を確認し、schema catalog と migration history を調査してから再判断します。
- 旧 secret を復元して旧 identity 経路を再開することを rollback 手段にしません。

## 7. 実行記録

最低限、次だけを監査記録に残します。

- 対象環境、migration version、実行者、承認者、UTC 時刻
- Supabase / D1 / R2 の preflight 件数と postflight 結果
- backup / export の識別子と保存期限
- smoke test の結果、未検証項目、事故対応の ticket

secret 値、旧 ID の一覧、R2 object key、metadata、checksum は記録しません。
