# Compaction / Analytics Overview

最新実装に合わせたコンパクション関連の要約です。運用フローと主要エンドポイントをこのドキュメントに集約しました。

## アーキテクチャ概要

- エントリ: Cloudflare Pages (Astro) + Hono API (`src/server/app.ts`)
- ストレージ: R2 (`BATTLE_DATA_BUCKET`)
- メタデータ: Supabase (`datasets`, `processing_metrics`)
- 非同期処理: Cloudflare Queues + Workflows (`fusou-workflow`)
- 可観測性: DLQ記録 (`processing_metrics.status = dlq_failure`) とダッシュボードAPI/ページ

## Hono API エンドポイント

- POST `/compaction/upload`
  - FormData: datasetId, tableId, file(.parquet)
  - JWT必須。R2保存→Supabase登録→Queue `priority: realtime`（withRetry）。
- POST `/compaction/sanitize-state`
  - JSON: { datasetId }
  - JWT必須・所有者チェック。手動復旧。Queue `priority: manual`（withRetry）。
- POST `/compaction/trigger-scheduled`
  - `compaction_needed=true` かつ `compaction_in_progress=false` を取得し、メトリクス一括作成→Queue一括投入（withRetry + Promise.allSettled）。
- GET `/compaction/dlq-status`
  - `failure`/`dlq_failure` を返却。
- GET `/analytics/compaction-metrics`
  - ステータス分布、直近24hの時間帯別集計、エラー上位10、DLQ最新10件を返却。`Cache-Control: public, max-age=60`。

## セキュリティ / バリデーション

- 全API JWT必須（upload/sanitize-state はユーザーID照合）。
- /upload: `.parquet`のみ許可、`MAX_UPLOAD_BYTES`超過は413、Queue送信はwithRetry。
- グローバルCORS: `CORS_HEADERS`を全レスポンスに適用。OPTIONSは204でハンドル。

## ワークフロー概要（fusou-workflow）

- キューコンシューマが受信→Step1-4で検証・メタ取得・WASMコンパクション・メタ更新。
- DLQハンドラ: `processing_metrics.status = dlq_failure` を記録し、datasetフラグをリセット。
- リトライ: Supabase/R2/Queue送信で指数/線形バックオフ（withRetry）。

## ダッシュボード

- ページ: `src/pages/dashboard/compaction.astro`
- データ取得: `/analytics/compaction-metrics`（Hono実装）
- 表示: ステータス分布、時間帯別パフォーマンス、DLQ一覧、エラー上位。

## 参考ドキュメント

- `docs/COMPACTION_DESIGN_AND_OPERATIONS.md` … 詳細設計と運用手順
- `docs/sql/compaction_dashboard_functions.sql` … Supabase関数（集計用）
- `docs/SUPABASE_DATA_SCHEMA.md` … データスキーマ
- `docs/operations/compaction_workflow_deploy.md` … デプロイ手順
