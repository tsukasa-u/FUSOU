# TEMP: member_id_hash / dataset_id ユーザー側露出監査 (2026-05-23)

## 1. 監査対象

対象コード:

- `packages/FUSOU-WEB/src/**`
- `packages/FUSOU-APP/src-tauri/src/**`
- `packages/fusou-auth/src/**`
- `packages/fusou-upload/src/**`

監査観点:

- URL / クエリへの露出
- ブラウザ保存領域への露出
- API 応答への露出
- ネットワーク送信への露出
- ローカルファイルへの露出
- ログへの露出

## 2. 重大所見

### 2.1 URL / クエリ露出

所見:

- APP の `open_auth_page_with_member_id` は `member_id_hash` を URL クエリに付与する。
- `packages/FUSOU-APP/src-tauri/src/auth/auth_server.rs:44`
- `packages/FUSOU-APP/src-tauri/src/auth/auth_server.rs:49`

- legacy deep link 経路で callback URL に `member_id_hash` を付与する。
- `packages/FUSOU-APP/src-tauri/src/builder_setup/single_instance.rs:123`
- `packages/FUSOU-APP/src-tauri/src/builder_setup/single_instance.rs:124`

評価:

- URL 履歴、ブラウザ拡張、プロキシログ、OSログへの残留リスクがある。

補足:

- 現行 WEB の主経路は `fusou://sync` だが、legacy 経路はコード上残存する。

### 2.2 sessionStorage 露出

所見:

- `memberIdHash` を sessionStorage に平文保存している。
- `packages/FUSOU-WEB/src/pages/auth/local/signin.astro:467`
- `packages/FUSOU-WEB/src/pages/auth/local/signin.astro:755`
- `packages/FUSOU-WEB/src/pages/auth/local/signin.astro:838`

評価:

- 同一セッション上の XSS / 拡張機能から参照される可能性がある。

### 2.3 API 応答露出

所見 A:

- `/api/user/member-map` が `member_id_hash` を返す。
- `packages/FUSOU-WEB/src/server/routes/user.ts:99`
- `packages/FUSOU-WEB/src/server/routes/user.ts:101`

所見 B:

- 匿名認証 v2 の register / refresh 応答に `pid` が含まれる。
- `packages/FUSOU-WEB/src/server/routes/anonymous-sync-v2.ts:1072`
- `packages/FUSOU-WEB/src/server/routes/anonymous-sync-v2.ts:1075`
- `packages/FUSOU-WEB/src/server/routes/anonymous-sync-v2.ts:1599`

関連:

- APP 側で `pid` を `dataset_id` として保存している。
- `packages/fusou-auth/src/manager.rs:698`
- `packages/fusou-auth/src/manager.rs:809`

注意:

- `/anonymous-sync/v2/devices` は `pid_masked` のみ返却しており配慮あり。
- `packages/FUSOU-WEB/src/server/routes/anonymous-sync-v2.ts:1150`

### 2.4 battle_data 応答露出

所見:

- `/chunks`, `/latest`, `/global/chunks`, `/global/latest` で `dataset_id` を返却している。
- `packages/FUSOU-WEB/src/server/routes/battle_data.ts:895`
- `packages/FUSOU-WEB/src/server/routes/battle_data.ts:910`
- `packages/FUSOU-WEB/src/server/routes/battle_data.ts:972`
- `packages/FUSOU-WEB/src/server/routes/battle_data.ts:1071`
- `packages/FUSOU-WEB/src/server/routes/battle_data.ts:1509`

周辺条件:

- battle_data は通常ルートとしてマウントされる。
- `packages/FUSOU-WEB/src/server/app.ts:206`

- CORS デフォルトは `*`。
- `packages/FUSOU-WEB/src/server/constants.ts:9`

評価:

- API 利用形態によっては `dataset_id` 観測が容易になる可能性がある。

## 3. 中程度所見

### 3.1 ローカルファイル露出

所見 A:

- `member_id_hash` キャッシュを `.member_id_cache.json` に保存。
- `packages/FUSOU-APP/src-tauri/src/auth/member_id_cache.rs:23`
- `packages/FUSOU-APP/src-tauri/src/auth/member_id_cache.rs:61`

所見 B:

- `fusou-auth-dataset-token.json` に dataset_id キーで token を保存。
- `packages/FUSOU-APP/src-tauri/src/lib.rs:201`
- `packages/FUSOU-APP/src-tauri/src/lib.rs:208`
- `packages/fusou-auth/src/types.rs:51`
- `packages/fusou-auth/src/manager.rs:116`

### 3.2 ログ露出

所見 A:

- APP 側 debug ログで `member_id_hash` を含む body を出力する可能性。
- `packages/FUSOU-APP/src-tauri/src/builder_setup/single_instance.rs:338`
- `packages/FUSOU-APP/src-tauri/src/builder_setup/single_instance.rs:343`

所見 B:

- ブラウザ console に `memberIdHash` を直接出力。
- `packages/FUSOU-WEB/src/pages/auth/local/signin.astro:744`

所見 C:

- request_id に dataset_id を埋め込む実装。
- `packages/FUSOU-APP/src-tauri/src/senders/quest_tree_sender.rs:150`
- `packages/FUSOU-APP/src-tauri/src/senders/ship_growth_sender.rs:356`

### 3.3 ネットワーク送信露出

所見:

- APP -> WEB ingest payload に `dataset_id` を含む。
- `packages/FUSOU-APP/src-tauri/src/senders/quest_tree_sender.rs:156`
- `packages/FUSOU-APP/src-tauri/src/senders/ship_growth_sender.rs:369`
- `packages/FUSOU-APP/src-tauri/src/storage/providers/r2/provider.rs:699`
- `packages/fusou-upload/src/uploader.rs:162`
- `packages/fusou-upload/src/uploader.rs:178`

- `X-Dataset-Token` を送信する。
- `packages/fusou-upload/src/uploader.rs:350`

注記:

- TLS 前提でも、ローカルプロキシやデバッグツールでは観測可能。

## 4. 改善済み箇所

### 4.1 callback URL でのハッシュ露出抑止

- 現在は OAuth callback チェーンで `member_id_hash` を受け渡していない。
- `mih-hint` cookie 経路は削除済み（URL/cookie の両方で callback 受け渡しを廃止）。
- `packages/FUSOU-WEB/src/pages/api/local_auth/signin.ts:101`
- `packages/FUSOU-WEB/src/pages/api/local_auth/callback.ts:120`
- `packages/FUSOU-WEB/src/pages/auth/local/callback.astro:61`

### 4.2 member-lookup 応答最小化

- `check-hash` は user_id/email を返さず `exists` 中心。
- `packages/FUSOU-WEB/src/server/routes/member-lookup.ts:116`
- `packages/FUSOU-WEB/src/server/routes/member-lookup.ts:123`

### 4.3 devices 応答のマスキング

- devices 一覧では `pid_masked` を返却。
- `packages/FUSOU-WEB/src/server/routes/anonymous-sync-v2.ts:1150`

## 5. 潜在露出 (現時点未使用)

所見:

- `MemberIdSyncButton` は生値表示コードを持つが、実参照は確認できない。
- 表示コード: `packages/FUSOU-WEB/src/components/solid/MemberIdSyncButton.tsx:134`
- 参照検索: `<MemberIdSyncButton` の使用ヒットなし

## 6. 推奨対策

### P0 (即時)

- legacy URL 経路 (`open_auth_page_with_member_id`, `request-member-id`) を停止。
- `signin.astro` の生値 console 出力を削除またはマスク。
- `single_instance.rs` の body ログをマスク。

### P1 (短期)

- sessionStorage の生ハッシュ保持を廃止し、短命トークン/フラグ化。
- `/api/user/member-map` の応答を `linked: true/false` へ最小化。
- battle_data 応答から `dataset_id` を原則除外し、必要時のみ管理系で返却。

### P2 (中期)

- `member_id_cache` / dataset_token ストアを暗号化または OS セキュアストアへ移行。
- `member_id_hash` / `dataset_id` / `pid` のログマスキングを共通化。

## 7. 結論

`member_id_hash` 相当値 (`dataset_id`, `pid`) は現在も複数チャネルでユーザー側に露出する。
最優先は URL 経路・sessionStorage・API 応答・ログの削減であり、続いてローカル保存のハードニングを実施すべきである。
