# 環境設定 - FUSOU-WEB

このドキュメントは、Cloudflare Pages/Workers と Supabase の環境変数設定、および主要な API エンドポイントのテスト方法を説明します。

## 必須環境変数・バインディング

### Cloudflare Pages（Dashboard での設定）

以下の R2 バケットバインディングと環境変数を設定してください：

**R2 バケットバインディング:**
- `ASSETS_BUCKET` → `dev-kc-assets` (静的アセット保存)
- `FLEET_SNAPSHOT_BUCKET` → `dev-kc-fleets` (艦隊スナップショット)
- `BATTLE_DATA_BUCKET` → `dev-kc-battle-data` (ゲームデータ)

**D1 データベースバインディング:**
- `ASSET_INDEX_DB` → `dev_kc_asset_index` (アセットインデックス)

**Service バインディング:**
- `COMPACTION_WORKFLOW` → `fusou-workflow` (コンパクション Workflow)

**環境変数:**
- `PUBLIC_SUPABASE_URL` - 例: `https://xyz.supabase.co`
- `PUBLIC_SUPABASE_PUBLISHABLE_KEY` - Supabase 公開キー

**Secrets（Cloudflare Dashboard から設定）:**
- `SUPABASE_SECRET_KEY` - Supabase service_role キー（秘密保持）
- `ASSET_UPLOAD_SIGNING_SECRET` - アセットアップロード署名用秘密鍵
- `FLEET_SNAPSHOT_SIGNING_SECRET` - スナップショット署名用秘密鍵
- `BATTLE_DATA_SIGNING_SECRET` - バトルデータ署名用秘密鍵

### 設定方法

**Dashboard 経由:**
1. Cloudflare Pages プロジェクトを開く
2. `Settings` → `Environment variables`
3. 上記の環境変数を `Production` / `Preview` 環境に追加

**wrangler CLI 経由（Secrets 設定例）:**
```bash
wrangler login
wrangler secret put SUPABASE_SECRET_KEY --account-id <account-id>
```

## 主要 API エンドポイント

### POST `/api/compact`
- 役割: Parquet コンパクション Workflow をトリガー
- リクエスト: `{ "datasetId": "<uuid>" }`
- レスポンス: `{ "status": "accepted", "instanceId": "..." }`

### GET `/api/compact/status/:instanceId`
- 役割: Workflow 進捗確認
- レスポンス: `{ "status": "running|success|error", "output": {...} }`

### POST `/api/fleet/snapshot`
- 役割: 艦隊スナップショット保存
- リクエスト: JSON ペイロード + `Idempotency-Key` ヘッダ
- レスポンス: `{ "ok": true, "r2_key": "..." }`

### GET `/api/assets`
- 役割: アセット情報取得
- レスポンス: アセットリスト

## Supabase テーブルセットアップ

必要なテーブル（SQL）:
- `datasets` - コンパクション対象データセット管理
- `fleet_snapshots` - 艦隊スナップショット履歴
- `processing_metrics` - 処理メトリクス記録

詳細は [docs/SUPABASE_DATA_SCHEMA.md](../SUPABASE_DATA_SCHEMA.md) を参照。

## セキュリティに関する注意

- `SUPABASE_SECRET_KEY` は絶対にクライアント側に露出させない
- JWT 検証と RLS（Row-Level Security）ポリシーを設定
- 署名付き URL は時間制限付きで発行
