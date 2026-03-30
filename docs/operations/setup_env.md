# FUSOU 新規開発者セットアップガイド

このガイドは、FUSOU プロジェクトに参画する新規開発者向けの完全なセットアップ手順です。

## 前提条件

- Node.js 18以上
- npm または yarn
- Git
- Docker（オプション、Supabase ローカル実行用）

## セットアップ手順

### ステップ 1: リポジトリのクローン

```bash
git clone https://github.com/tsukasa-u/FUSOU.git
cd FUSOU
npm install
```

### ステップ 2: 環境変数の設定

```bash
# FUSOU-APP (Tauri アプリ)
cd packages/FUSOU-APP
cp .env.example .env.local
# エディタで .env.local を編集

# FUSOU-WEB (Cloudflare Workers)
cd ../FUSOU-WEB
cp .env.example .env
cp .env.example .env.production
# dotenvx で暗号化
npx dotenvx encrypt -f .env.production
```

詳細は [DOTENVX_SETUP.md](./DOTENVX_SETUP.md) を参照してください。

### ステップ 3: D1 データベースの初期化

```bash
cd docs/sql/d1
./setup.sh              # ローカル D1 の初期化
./setup.sh --remote     # リモート D1 の初期化（本番）
```

または、手動で実行：

```bash
cd packages/FUSOU-WEB
npx wrangler d1 execute dev_kc_battle_index --file=../../docs/sql/d1/schema.sql
```

### ステップ 4: Supabase の初期化

#### ローカル（開発環境）

```bash
# プロジェクトをリンク
npx supabase link --project-ref <PROJECT_REF>

# リモートスキーマを取得
npx supabase db pull

# ローカル Supabase を起動
npx supabase start

# ローカルスキーマを適用
npx supabase db push
```

#### リモート（本番環境）

```bash
# リモートスキーマを確認
npx supabase db pull --skip-seed

# 変更をプッシュ
npx supabase db push --remote
```

セットアップスクリプト使用時：

```bash
cd docs/sql/supabase
./setup.sh              # ローカル初期化
./setup.sh --remote     # リモート初期化
```

### ステップ 5: 環境変数の確認

```bash
# D1
npx wrangler d1 execute dev_kc_battle_index --command "SELECT 1;"

# Supabase
npx supabase db list tables
```

### ステップ 6: ローカル開発環境の起動

```bash
# プロジェクトルートから

# Supabase ローカル（必要な場合）
npx supabase start

# FUSOU-WEB の開発サーバー起動
cd packages/FUSOU-WEB
npm run dev

# 別ターミナルで FUSOU-APP の開発
cd packages/FUSOU-APP
npm run dev

# 別ターミナルで FUSOU-WORKFLOW ローカルテスト
cd packages/FUSOU-WORKFLOW
npm run dev
```

## ディレクトリ構成の理解

```
FUSOU/
├── packages/
│   ├── FUSOU-APP          # Tauri デスクトップアプリ（戦闘データ収集）
│   ├── FUSOU-WEB          # Cloudflare Workers（サーバー）
│   ├── FUSOU-WORKFLOW     # Cloudflare Workers（コンパクションワークフロー）
│   ├── FUSOU-PROXY        # Rust + HTTPS Proxy（データ転送）
│   ├── kc_api             # Rust（KanColle API バインディング）
│   ├── fusou-auth         # Rust（認証ライブラリ）
│   ├── fusou-upload       # Rust（アップロード処理）
│   ├── shared-ui          # Web コンポーネント（共有UI）
│   └── configs            # Rust（設定管理）
├── docs/
│   ├── sql/               # データベーススキーマ定義
│   │   ├── d1/            # D1（SQLite）
│   │   └── supabase/      # Supabase（PostgreSQL）
│   ├── operations/        # 運用ガイド
│   ├── setup/             # セットアップガイド
│   └── ...
└── supabase/              # Supabase マイグレーション
```

## 主要なコマンド

### D1（Cloudflare SQLite）

```bash
cd packages/FUSOU-WEB

# ローカル実行
npx wrangler d1 execute dev_kc_battle_index --command "SELECT * FROM battle_files LIMIT 10;"

# リモート実行
npx wrangler d1 execute dev_kc_battle_index --remote --command "SELECT * FROM battle_files LIMIT 10;"

# ファイルから実行
npx wrangler d1 execute dev_kc_battle_index --file=../../docs/sql/d1/schema.sql
```

### Supabase

```bash
# プロジェクトをリンク
npx supabase link --project-ref <PROJECT_REF>

# リモートスキーマを取得
npx supabase db pull

# ローカルスキーマを適用
npx supabase db push

# テーブル一覧
npx supabase db list tables

# 特定テーブルの構造
npx supabase db list columns datasets

# ローカル Supabase 起動
npx supabase start

# ローカル Supabase 停止
npx supabase stop
```

### Wrangler（Cloudflare Workers）

```bash
cd packages/FUSOU-WEB

# ローカル開発
npm run dev

# リモートにデプロイ
npm run deploy

# ログ確認
npx wrangler tail
```

## トラブルシューティング

### D1 接続エラー

```bash
# 1. D1 が存在することを確認
npx wrangler d1 list

# 2. テーブルが存在することを確認
npx wrangler d1 execute dev_kc_battle_index --command "SELECT name FROM sqlite_master WHERE type='table';"

# 3. スキーマを再実行
npx wrangler d1 execute dev_kc_battle_index --file=../../docs/sql/d1/schema.sql
```

### Supabase 接続エラー

```bash
# 1. ログインを確認
npx supabase auth whoami

# 2. プロジェクトをリンク
npx supabase link --project-ref <PROJECT_REF>

# 3. リモートスキーマを確認
npx supabase db pull

# 4. ローカル Supabase を起動
npx supabase start
```

### 環境変数エラー

```bash
# 1. .env ファイルを確認
cat .env

# 2. dotenvx を使用して暗号化を確認
npx dotenvx keys list

# 3. ファイルをコピーし直す
cp .env.example .env
```

## 次のステップ

1. **コードの理解**: [README.md](../../README.md) でプロジェクト概要を確認
2. **開発ガイド**: [docs/](../) 配下のドキュメントを参照
3. **実装ガイド**: [TABLE_OFFSET_COMPACTION.md](../operations/TABLE_OFFSET_COMPACTION.md) でコンパクション実装を理解
4. **データベース**: [docs/sql/README.md](../sql/README.md) でデータベース詳細を確認

## 参照資料

### 公式ドキュメント

- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Supabase](https://supabase.com/docs)
- [PostgreSQL](https://www.postgresql.org/docs/)
- [SQLite](https://www.sqlite.org/docs.html)

### プロジェクトドキュメント

- [DOTENVX_SETUP.md](./DOTENVX_SETUP.md) - 環境変数管理
- [DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md) - デプロイメントチェック
- [TABLE_OFFSET_COMPACTION.md](./operations/TABLE_OFFSET_COMPACTION.md) - コンパクション実装

## サポート

質問や問題が発生した場合：

1. ドキュメントを再度確認
2. GitHub Issues で既存の問題を検索
3. GitHub Issues で新しい問題を作成
4. プロジェクトメンテナーに連絡


# Environment Setup Reference

# 環境設定 - FUSOU-WEB

このドキュメントは、Cloudflare Workers と Supabase の環境変数設定、および主要な API エンドポイントのテスト方法を説明します。

## 必須環境変数・バインディング

### Cloudflare Workers（Dashboard での設定）

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
1. Cloudflare Workers の `fusou` サービスを開く
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


# Dotenvx Specifics

<!-- markdownlint-disable MD032 MD040 MD025 MD022 MD007 MD010 MD031 MD024 MD029 MD036 MD041 MD003 MD034 -->
# dotenvx Configuration for FUSOU

## Overview
FUSOU uses [dotenvx](https://dotenvx.com/) for secure environment variable management with encryption support.

## Required Environment Variables

### FUSOU-WORKFLOW
- `PUBLIC_SUPABASE_URL`: Your Supabase project URL (e.g., https://xxxxx.supabase.co)
- `SUPABASE_SECRET_KEY`: Supabase service role key (secret)

### FUSOU-WEB
- `PUBLIC_SUPABASE_URL`: Your Supabase project URL (e.g., https://xxxxx.supabase.co)
- `SUPABASE_SECRET_KEY`: Supabase service role key (secret)

**Note:** Other variables in FUSOU-WEB/.env (Google OAuth, Signing Secrets, etc.) are optional and project-specific.

## Setup

### FUSOU-WORKFLOW (Cloudflare Workers)

1. **Create `.env` file:**
```bash
cd packages/FUSOU-WORKFLOW
cp .env.example .env
# Edit .env with your actual values
```

2. **Encrypt the `.env` file:**
```bash
npx dotenvx encrypt
```
This creates `.env.keys` with encryption keys.

3. **Set the private key as Worker secret:**
```bash
wrangler secret put DOTENV_PRIVATE_KEY
# Paste the private key from .env.keys when prompted
```

4. **Deploy:**
```bash
wrangler deploy
```

### FUSOU-WEB (Cloudflare Workers)

1. **Create `.env.production` for production:**
```bash
cd packages/FUSOU-WEB
# Create .env.production with production values
```

2. **Encrypt production environment:**
```bash
npx dotenvx encrypt -f .env.production
```

3. **Set `DOTENV_PRIVATE_KEY` in Cloudflare Dashboard:**
- Go to Cloudflare Workers → fusou → Settings → Variables and Secrets
- Select "Production" environment
- Add variable: `DOTENV_PRIVATE_KEY` = (value from `.env.production.keys`)

4. **Build and deploy:**
```bash
npm run build
npx wrangler deploy
```

## How It Works

### Cloudflare Workers (FUSOU-WORKFLOW)
- `import '@dotenvx/dotenvx/config'` at the top of `src/index.ts` automatically loads environment variables
- Local: reads from `.env` → `process.env`
- Production: decrypts `.env` using `DOTENV_PRIVATE_KEY` secret

### Cloudflare Workers (FUSOU-WEB)
- Build scripts use `dotenvx run` to load `.env` during development
- Production: Cloudflare Workers injects `DOTENV_PRIVATE_KEY` to decrypt `.env.production`
- Runtime access via `locals.runtime.env` or `env` parameter

## Security Benefits

1. **Encrypted storage**: `.env` files can be safely committed to git (encrypted)
2. **Key separation**: Only `DOTENV_PRIVATE_KEY` needs to be kept secret
3. **Environment isolation**: Different keys for dev/staging/production
4. **Version control**: Track environment variable changes in git

## Required Variables

### FUSOU-WORKFLOW
- `PUBLIC_SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_SECRET_KEY`: Supabase service role key

### FUSOU-WEB
- `PUBLIC_SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_SECRET_KEY`: Supabase service role key

## Troubleshooting

### "Cannot find DOTENV_PRIVATE_KEY"
- Ensure you ran `npx dotenvx encrypt`
- Check that `DOTENV_PRIVATE_KEY` is set as Worker secret
- Verify the key matches the one in `.env.keys`

### "Environment variables not loading"
- Verify `import '@dotenvx/dotenvx/config'` is at the top of entry file
- Check `.env` file exists and is properly formatted
- Ensure dotenvx is installed in package.json dependencies

## References
- [dotenvx Documentation](https://dotenvx.com/docs)
- [dotenvx with Cloudflare Workers](https://dotenvx.com/docs/platforms/cloudflare#cloudflare-workers)
