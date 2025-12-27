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

# FUSOU-WEB (Cloudflare Pages)
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
│   ├── FUSOU-WEB          # Cloudflare Pages + Workers（サーバー）
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
- [Cloudflare Pages](https://developers.cloudflare.com/pages/)
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
