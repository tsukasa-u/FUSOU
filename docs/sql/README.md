# Database Setup Guide

FUSOU プロジェクト用の複数データベース設定ガイドです。本プロジェクトでは、以下の2つのデータベースを使用しています：

## データベース構成

### 1. **D1 (Cloudflare D1)** - SQLite
フラグメント管理とメタデータ保存用の軽量データベース

- **用途**: 戦闘データフラグメントのインデックス管理
- **テーブル**: `battle_files` - R2アップロードファイルの追跡
- **スケール**: 小〜中規模（アップロード記録の管理）
- **アクセス**: Cloudflare Workers/Pages から直接アクセス

### 2. **Supabase (PostgreSQL)** - PostgreSQL
コンパクション状態管理とワークフローメトリクス用のメインデータベース

- **用途**: コンパクション状態、パフォーマンスメトリクス、ユーザー管理
- **テーブル**: `datasets`, `processing_metrics`, `compaction_history`
- **スケール**: 大規模（複数ユーザー、多数のメトリクス）
- **アクセス**: 認証ユーザーのみ（RLS対応）

## ディレクトリ構成

```
sql/
├── README.md                 ← このファイル
├── d1/                       ← D1 (Cloudflare D1) 用
│   ├── README.md
│   ├── schema.sql           ← D1 スキーマ定義
│   └── setup.sh             ← セットアップスクリプト
├── supabase/                ← Supabase (PostgreSQL) 用
│   ├── README.md
│   ├── schema.sql           ← Supabase スキーマ定義
│   └── setup.sh             ← セットアップスクリプト
└── verify_schema.sh         ← スキーマ検証スクリプト（レガシー）
```

## クイックスタート

### 新規開発者向け

#### 1. D1の初期化（ローカル + リモート両方）

```bash
# D1セットアップスクリプトの実行
cd /path/to/FUSOU/docs/sql/d1
./setup.sh              # ローカルD1を初期化
./setup.sh --remote     # リモートD1を初期化
```

#### 2. Supabaseの初期化（ローカル + リモート両方）

```bash
# Supabaseセットアップスクリプトの実行
cd /path/to/FUSOU/docs/sql/supabase
./setup.sh              # ローカルを初期化
./setup.sh --remote     # リモートを初期化
```

#### 3. スキーマの検証

```bash
# D1 の検証
npx wrangler d1 execute dev_kc_battle_index --command "PRAGMA table_info(battle_files);"

# Supabase の検証
npx supabase db list tables
```

### トラブルシューティング

```bash
# D1: 接続確認
npx wrangler d1 execute dev_kc_battle_index --command "SELECT 1;"

# D1: テーブル一覧
npx wrangler d1 execute dev_kc_battle_index --command "SELECT name FROM sqlite_master WHERE type='table';"

# Supabase: 接続確認
npx supabase db list tables

# Supabase: 特定テーブルの構造
npx supabase db list columns datasets
```

## CLI コマンドリファレンス

### Wrangler (D1)

```bash
# 接続先: packages/FUSOU-WEB

# ローカルD1でSQL実行
npx wrangler d1 execute dev_kc_battle_index --command "SELECT * FROM battle_files LIMIT 1;"

# リモートD1でSQL実行
npx wrangler d1 execute dev_kc_battle_index --remote --command "SELECT * FROM battle_files LIMIT 1;"

# ファイルから実行
npx wrangler d1 execute dev_kc_battle_index --file=../../docs/sql/d1/schema.sql

# スキーマ情報確認
npx wrangler d1 execute dev_kc_battle_index --command "PRAGMA table_info(battle_files);"
```

### Supabase CLI

```bash
# 接続先: プロジェクトルート

# プロジェクトをリンク
npx supabase link --project-ref <PROJECT_REF>

# リモートスキーマを取得
npx supabase db pull

# ローカルスキーマをリモートに適用
npx supabase db push

# テーブル一覧
npx supabase db list tables

# 特定テーブルの構造
npx supabase db list columns <table_name>

# マイグレーション一覧
npx supabase migration list

# ローカルデータベース起動
npx supabase start

# ローカルデータベース停止
npx supabase stop
```

## スキーマ概要

### D1: battle_files

```sql
CREATE TABLE battle_files (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,           -- R2 object key
  dataset_id TEXT NOT NULL,
  "table" TEXT NOT NULL,               -- api_port, api_ship, etc.
  size INTEGER NOT NULL,               -- bytes
  etag TEXT,                           -- R2 ETag
  uploaded_at TEXT NOT NULL,
  content_hash TEXT,
  uploaded_by TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  table_offsets TEXT DEFAULT NULL      -- Offset metadata (JSON)
);

-- インデックス
CREATE INDEX idx_battle_files_dataset_id ON battle_files(dataset_id);
CREATE INDEX idx_battle_files_table ON battle_files("table");
CREATE INDEX idx_battle_files_uploaded_at ON battle_files(uploaded_at DESC);
```

### Supabase: datasets

```sql
CREATE TABLE datasets (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  dataset_name VARCHAR(255) NOT NULL,
  compaction_needed BOOLEAN DEFAULT FALSE,
  compaction_in_progress BOOLEAN DEFAULT FALSE,
  last_compacted_at TIMESTAMPTZ,
  file_size_bytes INTEGER,
  file_etag VARCHAR(255),
  compression_ratio DECIMAL(5, 2),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

### Supabase: processing_metrics

```sql
CREATE TABLE processing_metrics (
  id UUID PRIMARY KEY,
  dataset_id UUID NOT NULL,
  workflow_instance_id VARCHAR(255) NOT NULL UNIQUE,
  step1_validate_duration_ms INTEGER,
  step2_metadata_duration_ms INTEGER,
  step3_list_fragments_duration_ms INTEGER,
  step4_extract_duration_ms INTEGER,
  step5_merge_duration_ms INTEGER,
  step6_finalize_duration_ms INTEGER,
  workflow_total_duration_ms INTEGER,
  workflow_status VARCHAR(50),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

## セットアップ検証

### 自動検証スクリプト

```bash
# 両方のデータベースを検証
./verify_schema.sh
```

### 手動検証

```bash
# Step 1: D1 テーブル確認
echo "=== D1 Tables ==="
npx wrangler d1 execute dev_kc_battle_index --command "SELECT name FROM sqlite_master WHERE type='table';"

# Step 2: D1 table_offsets カラム確認
echo "=== D1 table_offsets ==="
npx wrangler d1 execute dev_kc_battle_index --command "SELECT name FROM pragma_table_info('battle_files') WHERE name='table_offsets';"

# Step 3: Supabase テーブル確認
echo "=== Supabase Tables ==="
npx supabase db list tables

# Step 4: Supabase datasets テーブル確認
echo "=== Supabase datasets columns ==="
npx supabase db list columns datasets
```

## 本番環境へのデプロイ

### D1本番データベース

```bash
# スキーマの確認
npx wrangler d1 execute dev_kc_battle_index --remote --command "PRAGMA table_info(battle_files);"

# スキーマの適用（初回のみ）
npx wrangler d1 execute dev_kc_battle_index --remote --file=./d1/schema.sql

# 新しいカラムの追加
npx wrangler d1 execute dev_kc_battle_index --remote --command "ALTER TABLE battle_files ADD COLUMN IF NOT EXISTS table_offsets TEXT DEFAULT NULL;"
```

### Supabase本番データベース

```bash
# リモートスキーマを確認
npx supabase db pull

# 変更をプッシュ
npx supabase db push --remote

# マイグレーションを確認
npx supabase migration list
```

## 参照

- [D1 詳細ガイド](./d1/README.md)
- [Supabase 詳細ガイド](./supabase/README.md)
- [TABLE_OFFSET_COMPACTION.md](../operations/TABLE_OFFSET_COMPACTION.md) - コンパクション実装詳細
- [Cloudflare D1 ドキュメント](https://developers.cloudflare.com/d1/)
- [Supabase ドキュメント](https://supabase.com/docs)
