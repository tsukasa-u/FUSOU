---
title: 手動同期 (Sync) 実装ランブック
このドキュメントは、FUSOU の「ユーザー×タグ」単位で艦隊スナップショットを手動同期（Sync ボタン）する実装を、安全かつ運用しやすく導入するための実務ランブックです。
contributors: ["github-copilot"]
date: 2025-11-27
目次

- 概要と目的

- 前提（ツール・アカウント）

- 高レベル設計（Supabase + R2 + Worker）

- 実装ステップ（詳細、コマンド付き）

- セキュリティと危険箇所

- テスト計画（E2E）

- 運用（Retention / Monitoring / Cost）

- 受け入れ基準 (Acceptance Criteria)

- 付録: 便利コマンドとサンプル
- 概要と目的
- 前提（ツール・アカウント）
- 高レベル設計（Supabase + R2 + Worker）
- 実装ステップ（詳細、コマンド付き）
- セキュリティと危険箇所
- テスト計画（E2E）
- 運用（Retention / Monitoring / Cost）
- 受け入れ基準 (Acceptance Criteria)
- 付録: 便利コマンドとサンプル
- 概要と目的
- 前提（ツール・アカウント）
 ユーザーが自身の艦隊情報スナップショット（約1MB）を手動でサーバに保存できるようにする。

- 保存は `owner_id + tag` をキーとし、メタデータは Supabase（Postgres）、ペイロード本体は Cloudflare R2 に保存する。

- 閲覧者は短縮 URL（/s/:token）や共有リスト経由でデータを取得する。大量閲覧は Cloudflare の CDN/Cache が吸収する。
- 実装ステップ（詳細、コマンド付き）
- セキュリティと危険箇所
- テスト計画（E2E）
- 運用（Retention / Monitoring / Cost）
 ローカルツール: `psql`, `curl`, `jq`, `wrangler` (Cloudflare CLI), `supabase` CLI (任意)

- アカウント: Supabase プロジェクト、Cloudflare アカウント（Pages/Workers + R2）

- リポジトリ: このリポジトリの `docs/` に既に次が存在します:

   - `docs/sql/supabase_fleets_schema.sql` (スキーマ)

   - `packages/FUSOU-WEB/src/pages/api/fleet/snapshot.ts` (snapshot POST サンプル)

   - `docs/scripts/apply_supabase_schema.sh`, `docs/scripts/test_snapshot.sh` など
- 付録: 便利コマンドとサンプル

---

## 概要と目的

- ユーザーが自身の艦隊情報スナップショット（約1MB）を手動でサーバに保存できるようにする。

- 保存は `owner_id + tag` をキーとし、メタデータは Supabase（Postgres）、ペイロード本体は Cloudflare R2 に保存する。

- 閲覧者は短縮 URL（/s/:token）や共有リスト経由でデータを取得する。大量閲覧は Cloudflare の CDN/Cache が吸収する。

理由（短く）: Supabase は認証・RLS・UPSERT 等の管理機能があり、R2 は大きなオブジェクト保存が安価かつ CDN に親和性が高い。D1 は小さなキャッシュに向くが本体置き場には向かない。

- ユーザーが自身の艦隊情報スナップショット（約1MB）を手動でサーバに保存できるようにする。
- 保存は `owner_id + tag` をキーとし、メタデータは Supabase（Postgres）、ペイロード本体は Cloudflare R2 に保存する。
- 閲覧者は短縮 URL（/s/:token）や共有リスト経由でデータを取得する。大量閲覧は Cloudflare の CDN/Cache が吸収する。

理由（短く）: Supabase は認証・RLS・UPSERT 等の管理機能があり、R2 は大きなオブジェクト保存が安価かつ CDN に親和性が高い。D1 は小さなキャッシュに向くが本体置き場には向かない。

---

## 前提（ツール・アカウント）

- ローカルツール: `psql`, `curl`, `jq`, `wrangler` (Cloudflare CLI), `supabase` CLI (任意)

- アカウント: Supabase プロジェクト、Cloudflare アカウント（Pages/Workers + R2）

- リポジトリ: このリポジトリの `docs/` に既に次が存在します:

   - `docs/sql/supabase_fleets_schema.sql` (スキーマ)

   - `packages/FUSOU-WEB/src/pages/api/fleet/snapshot.ts` (snapshot POST サンプル)

   - `docs/scripts/apply_supabase_schema.sh`, `docs/scripts/test_snapshot.sh` など

前提が満たされない場合は、先に準備してください。CLI の導入やアカウント作成方法は Cloudflare / Supabase の公式チュートリアルを参照してください。

- ローカルツール: `psql`, `curl`, `jq`, `wrangler` (Cloudflare CLI), `supabase` CLI (任意)
- アカウント: Supabase プロジェクト、Cloudflare アカウント（Pages/Workers + R2）
- リポジトリ: このリポジトリの `docs/` に既に次が存在します:
  - `docs/sql/supabase_fleets_schema.sql` (スキーマ)
  - `packages/FUSOU-WEB/src/pages/api/fleet/snapshot.ts` (snapshot POST サンプル)
  - `docs/scripts/apply_supabase_schema.sh`, `docs/scripts/test_snapshot.sh` など

前提が満たされない場合は、先に準備してください。CLI の導入やアカウント作成方法は Cloudflare / Supabase の公式チュートリアルを参照してください。

---

## 高レベル設計（図と説明）

- FUSOU-APP (client) —ユーザーが Sync を押す→ POST `/api/fleet/snapshot` (Worker)

- Worker:

   - JWT を検証 → owner_id を決定

   - payload を gzip 圧縮 → R2 に PUT（key: `fleets/{owner}/{tag}/{version}-{hash}.json.gz`）

   - Supabase に metadata を UPSERT（owner_id, tag, r2_key, version, size, updated_at, share_token）

   - 非同期でエッジキャッシュ更新ジョブを登録（optional）

- Viewer: `/s/:token` Worker が metadata を確認し R2 から取得、ETag/Cache-Control を付けて返す（Cache miss 時に Supabase フallback）

合理性: 書き込みは canonical（Supabase）に集約し、読み取りは CDN/edge で最小コストで提供する。R2 はバイナリに最適、Supabase は権限制御とクエリに最適。

1. FUSOU-APP (client) —ユーザーが Sync を押す→ POST `/api/fleet/snapshot` (Worker)
   - payload を gzip 圧縮 → R2 に PUT（key: `fleets/{owner}/{tag}/{version}-{hash}.json.gz`）
   - Supabase に metadata を UPSERT（owner_id, tag, r2_key, version, size, updated_at, share_token）
   - 非同期でエッジキャッシュ更新ジョブを登録（optional）
3. Viewer: `/s/:token` Worker が metadata を確認し R2 から取得、ETag/Cache-Control を付けて返す（Cache miss 時に Supabase フallback）

合理性: 書き込みは canonical（Supabase）に集約し、読み取りは CDN/edge で最小コストで提供する。R2 はバイナリに最適、Supabase は権限制御とクエリに最適。

---

## 実装ステップ（詳細）

以下は順序通りに進める具体手順とコマンド、ファイル参照、注意点です。

### ステップ 1: スキーマを Supabase に適用する

目的: `fleets` テーブルを作成し、RLS ポリシーを有効にする。

コマンド:

```bash
export SUPABASE_DB_URL="postgres://<user>:<pass>@<host>:5432/<db>"
./docs/scripts/apply_supabase_schema.sh
```

注意:

- 本番 DB に直接適用しない。まず staging で動作検証する。

- `auth.uid()` が Supabase の JWT による `sub` と一致するか確認すること。

合格条件:

- `fleets` テーブルが作成されていること。

- RLS が有効化され、owner のみが自分の行を SELECT/UPDATE できることを確認。

以下は順序通りに進める具体手順とコマンド、ファイル参照、注意点です。

### ステップ 1: スキーマを Supabase に適用する

目的: `fleets` テーブルを作成し、RLS ポリシーを有効にする。

コマンド:

```bash
export SUPABASE_DB_URL="postgres://<user>:<pass>@<host>:5432/<db>"
./docs/scripts/apply_supabase_schema.sh
```

注意:
- 本番 DB に直接適用しない。まず staging で動作検証する。
- `auth.uid()` が Supabase の JWT による `sub` と一致するか確認すること。

合格条件:
- `fleets` テーブルが作成されていること。
- RLS が有効化され、owner のみが自分の行を SELECT/UPDATE できることを確認。

### ステップ 2: Cloudflare R2 バケットと Pages/Worker バインディングを作る

目的: Payload を保存する R2 バケットを準備する。

手順: Cloudflare Dashboard → R2 → Create bucket. 名前は `asset_payloads` など。

Pages/Worker の設定:

- Pages: Settings → Environment variables & secrets → add R2 binding (ASSET_PAYLOAD_BUCKET)

- Workers (wrangler): `wrangler.toml` に `r2_buckets` 設定を追加

注意:

- Binding 名とコード中の `ASSET_PAYLOAD_BUCKET` が一致すること。

合格条件:

- Worker の環境から R2 に PUT/GET できる（テストで確認）。

目的: Payload を保存する R2 バケットを準備する。

手順: Cloudflare Dashboard → R2 → Create bucket. 名前は `asset_payloads` など。

Pages/Worker の設定:
 - Pages: Settings → Environment variables & secrets → add R2 binding (ASSET_PAYLOAD_BUCKET)
 - Workers (wrangler): `wrangler.toml` に `r2_buckets` 設定を追加

注意:
 - Binding 名とコード中の `ASSET_PAYLOAD_BUCKET` が一致すること。

合格条件:
 - Worker の環境から R2 に PUT/GET できる（テストで確認）。

### ステップ 3: Secrets を設定する

目的: `SUPABASE_SERVICE_KEY` と必要な env を Worker に安全に設定する。

手順 (wrangler):

```bash
wrangler login
wrangler secret put SUPABASE_SERVICE_KEY
```

あるいは Pages dashboard の Environment variables に設定。

注意:

- service role key は非常に強力。ブラウザへ絶対露出しないこと。

合格条件: Worker から `SUPABASE_SERVICE_KEY` を参照でき、Supabase REST にアクセスできること。

目的: `SUPABASE_SERVICE_KEY` と必要な env を Worker に安全に設定する。

手順 (wrangler):

```bash
wrangler login
wrangler secret put SUPABASE_SERVICE_KEY
```

あるいは Pages dashboard の Environment variables に設定。

注意:
 - service role key は非常に強力。ブラウザへ絶対露出しないこと。

合格条件: Worker から `SUPABASE_SERVICE_KEY` を参照でき、Supabase REST にアクセスできること。

### ステップ 4: Snapshot POST エンドポイントの強化

目的: 既存サンプルを本番向けに改善する（JWT 検証、サイズ制限、idempotency、ログ）。

具体実装項目:

1. JWT 検証:

   - 署名検証: Supabase の JWKS を使って署名を検証するか、Supabase の `/auth/v1/user` を叩く（Worker から）

   - 検証後に `sub` を `owner_id` と一致させる。

2. Size limit: `content-length` or streaming limit (max 2MB).

3. Idempotency: クライアントから `idempotency-key` ヘッダ or `version` を受け取り二重書き込みを防ぐ。

4. Error handling: 502/5xx を返す前に詳細ログを残す。

5. Rate limiting: Worker-level token-bucket or Cloudflare rate limiting rules。

注意:

- JWT 検証は外部呼び出しを含む場合がありレイテンシ要因となる。キャッシュを工夫する。

合格条件:

- 正常 JWT の場合にのみアップロード成功。無効 JWT は 401 を返す。

目的: 既存サンプルを本番向けに改善する（JWT 検証、サイズ制限、idempotency、ログ）。

具体実装項目:
1. JWT 検証:
   - 署名検証: Supabase の JWKS を使って署名を検証するか、Supabase の `/auth/v1/user` を叩く（Worker から）
   - 検証後に `sub` を `owner_id` と一致させる。
2. Size limit: `content-length` or streaming limit (max 2MB).
3. Idempotency: クライアントから `idempotency-key` ヘッダ or `version` を受け取り二重書き込みを防ぐ。
4. Error handling: 502/5xx を返す前に詳細ログを残す。
5. Rate limiting: Worker-level token-bucket or Cloudflare rate limiting rules.

注意:
 - JWT 検証は外部呼び出しを含む場合がありレイテンシ要因となる。キャッシュを工夫する。

合格条件:
 - 正常 JWT の場合にのみアップロード成功。無効 JWT は 401 を返す。

### ステップ 5: GET `/s/:token` Worker を実装する

目的: 短縮 URL 経由で payload を返却し、ETag と Cache-Control をつけて 304 をサポートする。

実装フロー:

1. Worker receives `token` from path.

2. Query Supabase: `SELECT r2_key, version, is_public FROM fleets WHERE share_token = $1` using service key.

3. If not found: 404.

4. If `is_public` is false: require additional verification (token match is the auth).

5. Try to serve from Cache API. If miss: fetch object from R2 (`R2.get(r2_key)`), cache response.

6. Compute `ETag` from `version` and `hash` (or stored hash). If `If-None-Match` matches → return 304.

注意:

- Cache API keys must be constructed to prevent cache poisoning; include token or r2_key as cache key.

合格条件:

- Viewer が `/s/<token>` で 200 (or 304) を受け取り、レスポンスに `ETag` と `Cache-Control` が含まれる。

目的: 短縮 URL 経由で payload を返却し、ETag と Cache-Control をつけて 304 をサポートする。

実装フロー:
1. Worker receives `token` from path.
2. Query Supabase: `SELECT r2_key, version, is_public FROM fleets WHERE share_token = $1` using service key.
3. If not found: 404.
4. If `is_public` is false: require additional verification (token match is the auth).
5. Try to serve from Cache API. If miss: fetch object from R2 (`R2.get(r2_key)`), cache response.
6. Compute `ETag` from `version` and `hash` (or stored hash). If `If-None-Match` matches → return 304.

注意:
 - Cache API keys must be constructed to prevent cache poisoning; include token or r2_key as cache key.

合格条件:
 - Viewer が `/s/<token>` で 200 (or 304) を受け取り、レスポンスに `ETag` と `Cache-Control` が含まれる。

### ステップ 6: Client (FUSOU-APP) の Sync ボタン実装

目的: ユーザーが明示的に同期を行う UI を提供する。

実装要点:

- ボタン: `Sync` — 押下で payload を取得して `POST /api/fleet/snapshot` を呼ぶ。

- UI: 同期中インジケータ・成功/失敗ハンドリング・最終同期時刻表示

- Token: Client には Supabase Auth の JWT を使わせる（サインイン済みのユーザー）

注意:

- Client 側で `SUPABASE_SERVICE_KEY` を絶対に使わない。

合格条件:

- 実際に Sync して R2 にオブジェクトが作成され、Supabase metadata が更新される。

目的: ユーザーが明示的に同期を行う UI を提供する。

実装要点:
 - ボタン: `Sync` — 押下で payload を取得して `POST /api/fleet/snapshot` を呼ぶ。
 - UI: 同期中インジケータ・成功/失敗ハンドリング・最終同期時刻表示
 - Token: Client には Supabase Auth の JWT を使わせる（サインイン済みのユーザー）

注意:
 - Client 側で `SUPABASE_SERVICE_KEY` を絶対に使わない。

合格条件:
 - 実際に Sync して R2 にオブジェクトが作成され、Supabase metadata が更新される。

### ステップ 7: Retention / Pruning / Dedup

目的: ストレージを制御してコストを抑える。

実装案:

- デフォルトは「latest only」。必要時 `retention_policy` による履歴保存。

- Nightly job (Worker cron or Supabase scheduled function) が expired objects を削除。

- Dedup: content-hash を filename に入れて同一オブジェクトは参照共有。

注意: 削除は不可逆。運用でログとエクスポート手順を必須にする。

合格条件: 定期ジョブが意図したオブジェクトを削除し、総ストレージ使用量が見込内にあること。

目的: ストレージを制御してコストを抑える。

実装案:
 - デフォルトは「latest only」。必要時 `retention_policy` による履歴保存。
 - Nightly job (Worker cron or Supabase scheduled function) が expired objects を削除。
 - Dedup: content-hash を filename に入れて同一オブジェクトは参照共有。

注意: 削除は不可逆。運用でログとエクスポート手順を必須にする。

合格条件: 定期ジョブが意図したオブジェクトを削除し、総ストレージ使用量が見込内にあること。

---

## セキュリティと危険箇所（詳細）

1. `SUPABASE_SERVICE_KEY` の漏洩

 - リスク: DB の全操作ができる。悪意のある利用でデータ漏洩や改竄、削除が発生。

 - 対策: Worker の env のみ、アクセスは最小限、Git に入れない、定期ローテーション。

2. JWT の未検証/誤検証

 - リスク: 他者になりすましてアップロード可能。

 - 対策: JWKS で署名検証、`aud` / `iss` / `exp` をチェック、`sub` を owner_id と比較。

3. 大量 PUT / Egress コスト

 - リスク: 大量アップロードやダウンロードでコスト増。

 - 対策: サイズ上限、ユーザ毎クォータ、Cloudflare Cache の活用、最新のみ保存。

4. キャッシュの誤設定

 - リスク: private データがパブリックキャッシュに残る。

 - 対策: private は Worker で認証→cache-control: private, must-revalidate; public は explicit allow。

1. `SUPABASE_SERVICE_KEY` の漏洩
 - リスク: DB の全操作ができる。悪意のある利用でデータ漏洩や改竄、削除が発生。
 - 対策: Worker の env のみ、アクセスは最小限、Git に入れない、定期ローテーション。

2. JWT の未検証/誤検証
 - リスク: 他者になりすましてアップロード可能。
 - 対策: JWKS で署名検証、`aud` / `iss` / `exp` をチェック、`sub` を owner_id と比較。

3. 大量 PUT / Egress コスト
 - リスク: 大量アップロードやダウンロードでコスト増。
 - 対策: サイズ上限、ユーザ毎クォータ、Cloudflare Cache の活用、最新のみ保存。

4. キャッシュの誤設定
 - リスク: private データがパブリックキャッシュに残る。
 - 対策: private は Worker で認証→cache-control: private, must-revalidate; public は explicit allow。

---

## テスト計画（E2E）

1. 単体テスト

 - 圧縮・hash 関数、ETag ビルダ、R2 キーの組成をユニットテストする。

2. 結合テスト（Staging）

 - ステップ:

   - deploy Worker (staging)

   - run: `SITE_URL=https://staging-site.pages.dev AUTH_TOKEN=<jwt> OWNER_ID=<uuid> ./docs/scripts/test_snapshot.sh`

   - verify: Supabase に metadata が存在、R2 オブジェクトが存在

   - GET `/s/:token` を実行して 200 and ETag

   - Conditional GET with `If-None-Match` returns 304

3. 負荷テスト（オプション）

 - 小規模: 100 concurrent reads on `/s/:token` to ensure CDN / Worker scaling

1. 単体テスト
 - 圧縮・hash 関数、ETag ビルダ、R2 キーの組成をユニットテストする。

2. 結合テスト（Staging）
 - ステップ:
   - deploy Worker (staging)
   - run: `SITE_URL=https://staging-site.pages.dev AUTH_TOKEN=<jwt> OWNER_ID=<uuid> ./docs/scripts/test_snapshot.sh`
   - verify: Supabase に metadata が存在、R2 オブジェクトが存在
   - GET `/s/:token` を実行して 200 and ETag
   - Conditional GET with `If-None-Match` returns 304

3. 負荷テスト（オプション）
 - 小規模: 100 concurrent reads on `/s/:token` to ensure CDN / Worker scaling

---

## 運用（Monitoring / Alerts / Backups）

- 監視項目: R2 egress, R2 PUT/GET count, Worker error rate, Supabase write errors, D1 hit/miss (if used)

- アラート例: R2 egress > X GB/day, Worker error rate > 1% over 5m

- バックアップ: Supabase の定期バックアップを有効、重要メタはエクスポート

 - 監視項目: R2 egress, R2 PUT/GET count, Worker error rate, Supabase write errors, D1 hit/miss (if used)
 - アラート例: R2 egress > X GB/day, Worker error rate > 1% over 5m
 - バックアップ: Supabase の定期バックアップを有効、重要メタはエクスポート

---

## 受け入れ基準 (Acceptance Criteria)

最低基準:

- Staging 環境で `POST /api/fleet/snapshot` により R2 と Supabase が正しく更新される。

- `/s/:token` で payload を取得でき、`ETag` を使った 304 が動作する。

- JWT 未認証では 401、size limit 超過では 413 を返す。

運用基準:

- Edge キャッシュにより 90% 以上の読み取りが CDN にヒットする（測定期間により異なる）。

- Retention job により不要オブジェクトが自動削除されている。

最低基準:
 - Staging 環境で `POST /api/fleet/snapshot` により R2 と Supabase が正しく更新される。
 - `/s/:token` で payload を取得でき、`ETag` を使った 304 が動作する。
 - JWT 未認証では 401、size limit 超過では 413 を返す。

運用基準:
 - Edge キャッシュにより 90% 以上の読み取りが CDN にヒットする（測定期間により異なる）。
 - Retention job により不要オブジェクトが自動削除されている。

---

## 付録: 便利コマンドと小さなサンプル

- Apply schema (already added):

```bash
export SUPABASE_DB_URL="postgres://user:pass@host:5432/db"
./docs/scripts/apply_supabase_schema.sh
```

- Test snapshot POST (use test script):

```bash
export SITE_URL="https://your-site.pages.dev"
export AUTH_TOKEN="<test-jwt>"
export OWNER_ID="<uuid>"
./docs/scripts/test_snapshot.sh
```

- Conditional GET check:

```bash
curl -I "https://your-site/s/<token>" -H 'If-None-Match: W/"v123-<hash>"'
```

 - Apply schema (already added):
```bash
export SUPABASE_DB_URL="postgres://user:pass@host:5432/db"
./docs/scripts/apply_supabase_schema.sh
```

 - Test snapshot POST (use test script):
```bash
export SITE_URL="https://your-site.pages.dev"
export AUTH_TOKEN="<test-jwt>"
export OWNER_ID="<uuid>"
./docs/scripts/test_snapshot.sh
```

 - Conditional GET check:
```bash
curl -I "https://your-site/s/<token>" -H 'If-None-Match: W/"v123-<hash>"'
```

---

このドキュメントをベースに、私が `GET /s/:token` Worker の実装（コード + deploy 手順 + test script）を追加できます。続けて実装する場合は「はい、`GET` を実装して」とお伝えください。もし他に細かい要望（例: retention の具体ポリシー、ダッシュボード推奨）あれば教えてください。
