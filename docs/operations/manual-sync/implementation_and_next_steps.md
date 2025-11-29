## 実装済み項目と今後の作業（Manual Sync 実装まとめ）

以下はリポジトリに既に追加済みの実装と、あなた（運用者/開発者）が行う必要がある具体的な手順をまとめたドキュメントです。

**目的**: クライアントから手動でスナップショット（fleet）を送信 → ペイロードを Cloudflare R2 に保存 → Supabase にメタデータを保持 → 短縮 URL を通じてエッジで配信（ETag / 304 / キャッシュ）

---

**実装済み（リポジトリ内の主要ファイル）**
- `docs/sql/supabase_fleets_schema.sql` — Supabase 用の `fleets` テーブル定義と RLS ポリシー例。
- `packages/FUSOU-WEB/src/pages/api/fleet/snapshot.ts` — サンプルの `POST /api/fleet/snapshot` ハンドラ（ペイロード gzip → R2 PUT → Supabase に upsert）。サンプルのため本番向けハードニングが必要。
- `packages/FUSOU-WEB/src/workers/get_snapshot_worker.ts` — `GET /s/:token` 相当の Worker 実装（Supabase から metadata 取得 → R2 から payload 取得 → ETag / Cache-Control 応答）。JWKS を使った JWT 検証（署名検証）と鍵キャッシュを実装。
- `packages/FUSOU-APP/src/components/SnapshotViewer.tsx` — Solid 用の Snapshot ビューワーコンポーネント（`/s/:token` を fetch、If-None-Match / ETag を扱う）。
- `packages/FUSOU-APP/src/pages/viewer.tsx` — `/viewer/:token`（または `?token=`）で `SnapshotViewer` を表示するページ。
- `docs/scripts/test_get_snapshot_get.sh` — GET テスト用の curl スクリプト（マニュアルテスト用）。
- `docs/operations/manual-sync/manual_sync_runbook.md` — 運用ランブック（手動同期フロー、テスト手順の概要）。

---

**ルートとアクセス方法（まとめ）**
- アプリ内ビューワー: `/viewer/<token>` または `/viewer?token=<token>` にアクセスすると `SnapshotViewer` が読み込まれます（`packages/FUSOU-APP/src/pages/viewer.tsx`）。
- 実際のデータ取得 API: `GET /s/<token>` を Cloudflare Worker が処理します。Worker は Supabase の `fleets` メタデータを参照し、R2 から payload を取得して返します（ETag / 304 をサポート）。
- スナップショットのアップロード API（例）: `POST /api/fleet/snapshot`（`packages/FUSOU-WEB/src/pages/api/fleet/snapshot.ts`）

---

**あなたが行う必要のある具体ステップ（優先度順）**

1) Supabase にスキーマを適用する（必須）
  - ファイル: `docs/sql/supabase_fleets_schema.sql`
  - 例（ローカルから適用する場合）:
    ```bash
    export SUPABASE_DB_URL="postgres://<user>:<pass>@<host>:5432/<db>"
    psql "$SUPABASE_DB_URL" -f docs/sql/supabase_fleets_schema.sql
    ```
  - Supabase コンソールを使う場合はスキーマ SQL を貼り付けて実行してください。
  - 確認: テーブル `fleets` が作成され、RLS ポリシーが期待通りに有効化されていること。

2) Cloudflare 環境（Pages/Workers）に環境変数と R2 バインディングを設定する（必須）
  - 必要な環境変数（例）:
    - `ASSET_PAYLOAD_BUCKET` — R2 バケット名（Worker の R2 バインディング名と一致）
    - `SUPABASE_URL` — Supabase REST/GraphQL の URL
    - `SUPABASE_SERVICE_KEY` — Supabase の service_role キー（機密）。Worker がメタデータ参照に使用します。権限は最小化検討。
  - R2 のバインディングを Pages/Worker に追加（Cloudflare ダッシュボードまたは `wrangler` を利用）。

3) Worker デプロイ（`GET /s/:token` を動かす）
  - オプション: 私が `wrangler.toml` テンプレートを追加できます（必要なら指示ください）。
  - デプロイ手順（wrangler 使用例）:
    ```bash
    # 1. wrangler.toml を用意
    wrangler publish --env production
    ```
  - デプロイ後、`/s/<token>` が期待どおり 200/304 を返すか curl で確認してください。

4) アプリ側の `getAuthToken` を実装して、非公開スナップショットに対応する（必須 if private）
  - `packages/FUSOU-APP/src/components/SnapshotViewer.tsx` の `getAuthToken` スタブを、あなたが使っている認証クライアント（例: `supabase-js`）からアクセストークンを返す実装に置き換えてください。
  - 例（supabase-js の場合）:
    ```ts
    // 例: supabaseClient.auth.getSession() の結果から access_token を返す
    async function getAuthToken() {
      const { data } = await supabase.auth.getSession();
      return data?.session?.access_token ?? null;
    }
    ```

5) POST `/api/fleet/snapshot` の本番向けハードニング
  - 実装済みはサンプルのため、以下を追加で実施してください:
    - 最大受信サイズ制限（例: 5MB）とストリーミング受信の検討
    - idempotency-key or content-hash による重複 PUT の回避
    - レート制限（IP / API キーベース）、ログ出力
    - 受信データのスキーマ検証（JSON schema）

6) E2E テスト（手動→自動化）
  - マニュアルテスト手順（短い手順）:
    1. アプリ（または curl）で `POST /api/fleet/snapshot` にスナップショットを送る。
    2. Supabase の `fleets` テーブルにメタが入っていることを確認する。
    3. `GET /s/<token>` を curl で叩き、200 と JSON が返ることを確認する。
    4. 返却ヘッダの `ETag` を控え、`If-None-Match` をつけて 304 が返るか確認する。
  - `docs/scripts/test_get_snapshot_get.sh` を手元で編集して、環境に合わせた URL をセットして実行してください。

7) 運用面（推奨）
  - 保存容量と R2 のコスト管理：content-hash をキーにして重複排除し、古いバージョンの削除ポリシーを策定する。
  - 監視とアラート: POST の失敗率、Supabase の 5xx、Worker のエラー率を監視。
  - 定期バッチ（retention/prune）：cron（Cloudflare Workers Cron Triggers / 外部ジョブ）で古い R2 オブジェクトと DB メタを掃除。

---

**よくある問題と対処**
- 304 が返らない: Worker の ETag 値がメタデータ（`version` / `hash`）と一致するか確認してください。Cache-Control とレスポンス ETag を同時に設定することで CDN が正しく機能します。
- 非公開スナップショットで 401/403 が出る: `getAuthToken` が正しいアクセストークンを返しているか、トークンの署名（RS256）と exp/nbf を確認してください。Worker は JWKS を使って署名検証を行います。
- R2 に PUT できない: R2 のバインディング名と Worker の設定（`ASSET_PAYLOAD_BUCKET`）が一致しているか、権限があるか確認。

---

もしよければ、次に私が自動で行えること（選択）:
- `wrangler.toml` のテンプレート作成と Worker デプロイ手順の追加（あなたのアカウント情報は不要なテンプレートのみ）。
- `getAuthToken` を `supabase-js` に合わせて実装するパッチを作成（あなたの auth ファイルパスを教えてください）。
- `POST` エンドポイントに受信サイズ制限と idempotency-key チェックを追加する改修。

---

ファイル: `docs/operations/manual-sync/implementation_and_next_steps.md`
上記ファイルを作成しました。次に何を自動化しますか？
