# D1 Database Setup Guide

このディレクトリには、Cloudflare D1データベースのスキーマ定義とセットアップスクリプトが含まれています。

## ファイル構成

- `avro-schema.sql` - D1の完全なスキーマ定義（Avro append モデル）
- `cleanup-parquet.sql` - 旧 Parquet 時代のテーブル/ビュー削除
- `setup.sh` - 新規開発者向けのセットアップスクリプト

## セットアップ方法

### 前提条件

- Node.js 18以上
- Wrangler CLI（`npm i -g wrangler`）
- Cloudflare アカウントでログイン（`wrangler login`）

### ステップ1: ローカルD1データベースの初期化

```bash
cd packages/FUSOU-WEB
npx wrangler d1 execute dev_kc_battle_index --file=../../docs/sql/d1/avro-schema.sql
npx wrangler d1 execute dev_kc_battle_index --file=../../docs/sql/d1/cleanup-parquet.sql
```

### ステップ2: リモートD1への適用（本番環境）

```bash
cd packages/FUSOU-WEB
npx wrangler d1 execute dev_kc_battle_index --remote --file=../../docs/sql/d1/avro-schema.sql
npx wrangler d1 execute dev_kc_battle_index --remote --file=../../docs/sql/d1/cleanup-parquet.sql
```

### ステップ3: スキーマ検証

```bash
cd packages/FUSOU-WEB
npx wrangler d1 execute dev_kc_battle_index --command "PRAGMA table_info(avro_files);"
npx wrangler d1 execute dev_kc_battle_index --command "PRAGMA table_info(avro_segments);"
```

## テーブル構成

### avro_files / avro_segments

Avro 追記ファイルとそのセグメントのメタデータ管理用テーブル。

**主なカラム:**
- `avro_files.file_key` - 仮想親キー（`datasetId/table/periodTag`）
- `avro_files.segment_count`, `avro_files.last_appended_at`
- `avro_segments.segment_key` - 実ファイルキー（`datasetId/table/periodTag.N.avro`）
- `avro_segments.segment_number`, `avro_segments.segment_size`, `avro_segments.created_at`

**用途:**
- セグメント化（512MB 超）に伴う連番 `.N.avro` の管理
- 最新セグメントの取得、期間集計ビューの基盤

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
