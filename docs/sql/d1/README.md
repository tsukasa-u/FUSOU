# D1 Database Setup Guide

このディレクトリには、Cloudflare D1データベースのスキーマ定義とセットアップスクリプトが含まれています。

## ファイル構成

- `schema.sql` - D1の完全なスキーマ定義
- `setup.sh` - 新規開発者向けのセットアップスクリプト

## セットアップ方法

### 前提条件

- Node.js 18以上
- Wrangler CLI（`npm i -g wrangler`）
- Cloudflare アカウントでログイン（`wrangler login`）

### ステップ1: ローカルD1データベースの初期化

```bash
cd packages/FUSOU-WEB
npx wrangler d1 execute dev_kc_battle_index --file=../../docs/sql/d1/schema.sql
```

### ステップ2: リモートD1への適用（本番環境）

```bash
cd packages/FUSOU-WEB
npx wrangler d1 execute dev_kc_battle_index --remote --file=../../docs/sql/d1/schema.sql
```

### ステップ3: スキーマ検証

```bash
cd packages/FUSOU-WEB
npx wrangler d1 execute dev_kc_battle_index --command "PRAGMA table_info(battle_files);"
```

## テーブル構成

### battle_files

R2にアップロードされた戦闘データのフラグメント情報を管理するインデックステーブル

**主要カラム:**
- `id` - プライマリキー
- `key` - R2オブジェクトキー
- `dataset_id` - データセットID
- `table` - テーブル名（api_port, api_ship等）
- `size` - ファイルサイズ
- `table_offsets` - 連結Parquetファイル内の各テーブルのオフセットメタデータ
- `uploaded_at` - アップロード日時
- `uploaded_by` - アップロードユーザーID

**用途:**
- 戦闘データフラグメントのトラッキング
- オフセットベースのテーブル抽出
- コンパクションワークフローでの参照

## トラブルシューティング

### テーブルが存在しないエラー

```bash
# スキーマの再実行
npx wrangler d1 execute dev_kc_battle_index --file=../../docs/sql/d1/schema.sql
```

### スキーマの確認

```bash
# ローカルD1のテーブル情報
npx wrangler d1 execute dev_kc_battle_index --command "SELECT name FROM sqlite_master WHERE type='table';"

# リモートD1のテーブル情報
npx wrangler d1 execute dev_kc_battle_index --remote --command "SELECT name FROM sqlite_master WHERE type='table';"
```

## 参照

- [Cloudflare D1 ドキュメント](https://developers.cloudflare.com/d1/)
- [../../../docs/operations/TABLE_OFFSET_COMPACTION.md](../../../docs/operations/TABLE_OFFSET_COMPACTION.md) - オフセットベースコンパクション実装ガイド
