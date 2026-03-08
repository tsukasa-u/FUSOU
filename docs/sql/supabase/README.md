# Supabase Database Setup Guide

このディレクトリには、Supabase PostgreSQLデータベースのスキーマ定義とセットアップスクリプトが含まれています。

## ファイル構成

- `schema.sql` - Supabaseの完全なスキーマ定義
- `setup.sh` - 新規開発者向けのセットアップスクリプト

## セットアップ方法

### 前提条件

- Node.js 18以上
- Supabase CLI（`npm i -g supabase`）
- Supabase アカウントでログイン（`supabase login`）
- プロジェクトがリンク済み（`supabase link`）

### ステップ1: スキーマの確認

```bash
# リモートスキーマを取得
cd /path/to/FUSOU
npx supabase db pull
```

### ステップ2: ローカルスキーマの初期化

```bash
cd /path/to/FUSOU
npx supabase start
npx supabase db push
```

### ステップ3: スキーマ検証

```bash
# 全テーブル一覧
npx supabase db list tables

# 特定テーブルの構造
npx supabase db list columns datasets
npx supabase db list columns processing_metrics
```

### ステップ4: Edge Functions のデプロイ

```bash
# ローカルテスト
npx supabase functions serve compaction_handler

# デプロイ
npx supabase functions deploy compaction_handler
```

## テーブル構成

### datasets

コンパクション状態と処理メトリクスを管理するメインテーブル

**主要カラム:**
- `id` - UUID プライマリキー
- `user_id` - ユーザーID
- `dataset_name` - データセット名
- `compaction_needed` - コンパクション必要フラグ
- `compaction_in_progress` - コンパクション進行中フラグ
- `last_compacted_at` - 最終コンパクション日時
- `file_size_bytes` - コンパクション後のファイルサイズ
- `file_etag` - コンパクション後のファイルETag
- `compression_ratio` - 圧縮率

**用途:**
- コンパクション状態の管理
- ユーザーごとのデータセット追跡
- ファイルサイズと圧縮率の統計

### processing_metrics

コンパクションワークフロー各ステップのパフォーマンスメトリクスを記録

**主要カラム:**
- `id` - UUID プライマリキー
- `dataset_id` - データセットID
- `workflow_instance_id` - ワークフロー実行ID
- `step1_validate_duration_ms` - バリデーション処理時間
- `step2_metadata_duration_ms` - メタデータ更新時間
- `step3_compact_duration_ms` - コンパクション処理時間
- `step4_extract_duration_ms` - テーブル抽出時間
- `step5_merge_duration_ms` - テーブルマージ時間
- `step6_finalize_duration_ms` - ファイナライズ時間

**用途:**
- パフォーマンス監視
- ボトルネック分析
- SLA達成度の追跡

## Edge Functions

### compaction_handler

Cloudflare Queues からのコンパクションメッセージを処理する Edge Function

**トリガー:**
- Cloudflare Queue からのメッセージ受信
- GitHub Actions からの定期実行（日本時間 11:00）

**処理フロー:**
1. メッセージの検証
2. コンパクション状態の確認
3. ワークフロー実行
4. メトリクスの記録

## トラブルシューティング

### スキーマが同期されていない

```bash
# リモートスキーマを取得
npx supabase db pull

# ローカルスキーマを確認
npx supabase db list tables

# 差分を確認
npx supabase migration list
```

### Edge Function のテスト

```bash
# ローカルで実行
npx supabase functions serve

# リモートで実行
curl -X POST https://<PROJECT_ID>.supabase.co/functions/v1/compaction_handler \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"dataset_id":"<DATASET_ID>"}'
```

### データベース接続

```bash
# PostgreSQL クライアントで接続
psql "postgresql://postgres:<PASSWORD>@<HOST>:5432/postgres"

# SQL を実行
SELECT * FROM datasets LIMIT 1;
SELECT * FROM processing_metrics LIMIT 1;
```

## 参照

- [Supabase ドキュメント](https://supabase.com/docs)
- [PostgreSQL ドキュメント](https://www.postgresql.org/docs/)
- [../../../docs/operations/TABLE_OFFSET_COMPACTION.md](../../../docs/operations/TABLE_OFFSET_COMPACTION.md) - オフセットベースコンパクション実装ガイド
