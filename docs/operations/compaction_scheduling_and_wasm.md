# FUSOU データセットコンパクション設計・運用ドキュメント

最終更新: 2025-12-16
ブランチ: `r2_parquet`

---

## 目的

- データセットの連結済み Parquet 断片をテーブル単位で統合（コンパクション）し、Cloudflare R2 のストレージと Supabase メタデータを最適化する。
- Cloudflare Workers の 128MB メモリ制限に配慮した安全な実行基盤を提供する。

---

## 全体アーキテクチャ

- `fusou-upload`（Rust, FUSOU-APP/Tauri 用）
  - ユーザーアップロードの受け取り、Avro→Parquet 変換（MVP）、複数テーブル断片の連結保存、R2 へのアップロード。
  - Supabase の `datasets` テーブルにメタデータを保存。

- `FUSOU-WEB`（Astro + Cloudflare Pages）
  - API ハンドラ（`/src/pages/api/compact.ts`）から Workflow をトリガー、202 Accepted で即座に応答。
  - 定期実行（`/functions/_scheduled.ts`）で Supabase を参照し、必要なデータセットのみバッチ的に実行。

- `FUSOU-WORKFLOW`（Cloudflare Worker + TypeScript）
  - 4-Step Workflow で Parquet コンパクション実行:
    1. Supabase 検証
    2. R2 メタデータ取得
    3. Parquet 解析・圧縮・書き込み
    4. Supabase 更新
  - Thrift compact protocol デコーダ・エンコーダで完全実装（WASM 不要）

---

## スケジューリング（Cloudflare Pages Scheduled Functions）

ファイル: `packages/FUSOU-WEB/functions/_scheduled.ts`

- Supabase の `datasets` テーブルを参照し、`compaction_needed=true` のデータセットだけ最大 N 件（`MAX_DATASETS_PER_RUN`）を取得。
- 低並列（`CONCURRENCY=2`）で API `POST /api/compact` を呼び出し、250ms の小休止を挟みつつ順次処理。
- すべての制御値は環境変数で調整可能（`SCHEDULE_CONCURRENCY`, `MAX_DATASETS_PER_RUN`, `SCHEDULE_DELAY_MS`）。
- エラーはログ出力のみ（失敗時は Workflow が自動で `compaction_in_progress=false` に戻す）。

Cron 設定（Cloudflare Pages 側）例:
- UTC 02:00 毎日（Pages 設定画面からスケジュールを追加）

---

## API 仕様（FUSOU-WEB）

### POST `/api/compact`
- 役割: Workflow インスタンスを生成・トリガーして、指定データセットのコンパクション実行を開始する。
- 入力: `{ "datasetId": "<uuid>" }`
- 出力（成功）: `{ "status": "accepted", "message": "Compaction workflow started", "instanceId": "...", "dataset_id": "..." }`
- 出力（失敗）: `{ "status": "error", "message": "Error" }`
- 前処理（冪等性）:
  - `datasets.compaction_in_progress=true` （Pages でセット）
  - `datasets.compaction_needed=false` （Pages でセット）
- Workflow Step 4 での更新:
  - `datasets.compaction_in_progress=false`
  - `datasets.last_compacted_at=NOW`
  - `datasets.compaction_needed=false`
  - `datasets.file_size_bytes=<新ファイルサイズ>`
  - `datasets.file_etag=<R2 ETag>`
- Workflow 失敗時:
  - Supabase 更新なし
  - compaction_in_progress は true のまま
  - ログに詳細記録

### GET `/api/compact/status/:instanceId`
- 役割: Workflow の進捗状況を確認する。
- 出力: `{ "status": "running|success|error", "output": {...}, "error": null }`

### GET `/api/compact` (Health Check)
- 役割: API 稼働確認用。

---

## Workflow 実装（FUSOU-WORKFLOW）

ファイル: `packages/FUSOU-WORKFLOW/src/index.ts`

**DataCompactionWorkflow クラス**:

**Step 1: validate-dataset** (Supabase SELECT)
- 入力: `{ datasetId, bucketKey }`
- 処理: `SELECT id, compaction_needed, compaction_in_progress FROM datasets WHERE id = datasetId`
- リトライ: 3回 (exponential backoff: 5s, 10s, 20s)
- エラー: throw

**Step 2: get-file-metadata** (R2 head)
- 処理: `bucket.head(bucketKey)` でファイルサイズ確認
- エラー: throw

**Step 3: compact-with-wasm** (Parquet 処理)
- 処理:
  - `parseParquetMetadata()` で Thrift decode
  - `compactFragmentedRowGroups()` で Row Group マージ
  - `writeCompactedParquetFile()` で R2 書き込み
- リトライ: 2回 (linear backoff: 2s, 4s)
- 戻り値: `{ originalSize, compactedSize, rowGroupsBefore, rowGroupsAfter, compressionRatio, etag }`
- エラー: throw

**Step 4: update-metadata** (Supabase UPDATE)
- 処理:
  ```sql
  UPDATE datasets SET
    compaction_in_progress = false,
    compaction_needed = false,
    last_compacted_at = now(),
    file_size_bytes = compactedSize,
    file_etag = etag
  WHERE id = datasetId
  ```
- リトライ: 3回 (linear backoff: 1s, 2s, 3s)
- エラー: throw

---

## Parquet 解析・処理（FUSOU-WORKFLOW）

ファイル: `packages/FUSOU-WORKFLOW/src/parquet-compactor.ts`

**parseParquetMetadata()**:
- Thrift compact protocol デコード
- Footer から num_rows, row_groups 抽出

**compactFragmentedRowGroups()**:
- 健全な Row Group と断片化 RG を分類
- Range requests でデータ読み込み
- MergedRowGroup で再統合
- 戻り値: `{ newFileSize, newRowGroupCount, etag }`

**ThriftCompactReader**:
- zigzag/varint デコーディング
- フィールド読み込みと型変換

ファイル: `packages/FUSOU-WORKFLOW/src/parquet-writer.ts`

**writeCompactedParquetFile()**:
- 健全 RG データを Range requests で読み込み
- マージ RG データを読み込み
- 新 Parquet footer 生成（Thrift encode）
- ファイル組み立て: data + footer + metadataSize + magic bytes
- R2 `bucket.put()` で書き込み
- 戻り値: `{ newFileSize, etag }`

**generateParquetFooter()**:
- Thrift FileMetaData 構造生成
- RowGroups list, ColumnChunks, Version 等

**ThriftCompactWriter**:
- writeField(), writeI32/I64(), writeVarint() など
- バッファ自動拡張

---

## Supabase スキーマ（実装済み）

`datasets` テーブル:

```sql
CREATE TABLE datasets (
  id UUID PRIMARY KEY,
  compaction_in_progress BOOLEAN DEFAULT false,
  compaction_needed BOOLEAN DEFAULT false,
  last_compacted_at TIMESTAMP WITH TIME ZONE,
  file_size_bytes INTEGER,
  file_etag TEXT,
  -- その他カラム
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
```

RLS ポリシー:
- Service role (SECRET_KEY) は全操作許可

---

## 環境変数一覧

**FUSOU-WORKFLOW (Worker)**:
- 必須: `PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`
- バインディング: `BATTLE_DATA_BUCKET` (R2 bucket)

**FUSOU-WEB (Pages)**:
- Service Binding: `DATA_COMPACTION` → FUSOU-WORKFLOW
- 環境変数: `SCHEDULE_CONCURRENCY`, `MAX_DATASETS_PER_RUN`, `SCHEDULE_DELAY_MS` 等

---

## ビルド & 実行手順

### Workflow ビルド & デプロイ

### ローカル開発
```bash
npm run dev
```bash
cd packages/FUSOU-WORKFLOW
npm install
npm run dev
```

### Pages（API + スケジューラー）開発

```bash
cd packages/FUSOU-WEB
npm install
npm run dev
```

### 本番デプロイ

```bash
# Workflow Worker
cd packages/FUSOU-WORKFLOW
npm run build
wrangler deploy

# Pages（Service Binding で FUSOU-WORKFLOW を参照）
cd packages/FUSOU-WEB
npm run build
npm run deploy
```

---

## 運用のポイント

- Workflow は自動的に 3-2-3 回のリトライで信頼性を確保します。
- 失敗時は Supabase 更新が行われないため、アラート監視が重要です。
- データ一貫性チェック: 定期的に `file_etag` が実際の R2 ファイルハッシュと一致するか確認。
- ログはすべて JSON 構造化ログで記録。ログアグリゲーターに連携可能。

---

## 既知の制約と改善案

- Parquet の厳密なスキーママージは未実装（MVP は連結）。将来は DataFusion を用いたスキーマ整合・重複排除の導入を検討。
- メモリ効率: 現在は複数 Row Group を同時読み込みしないよう注意。将来的にはストリーミング処理を導入。
- R2 ETag による完全な冪等性: 現在は Workflow 再実行時に新しい ETag が生成される（非冪等）。完全な冪等性が必要な場合は別途ロック機構を検討。

---

## Supabase マイグレーションと RLS（追加）

マイグレーションファイルを `docs/sql/compaction/` に追加:
- `0001_add_compaction_flags.sql`: `public.datasets` に `compaction_in_progress`, `compaction_needed`, `last_compacted_at`, `file_size_bytes`, `file_etag` を追加。
- `0002_compaction_rls_policies.sql`: RLS ポリシーの雛形。組織のロールに合わせて調整してください。

適用手順（検証環境で先に実施）:
```bash
psql "$SUPABASE_DB_URL" -f docs/sql/compaction/0001_add_compaction_flags.sql
psql "$SUPABASE_DB_URL" -f docs/sql/compaction/0002_compaction_rls_policies.sql
```

---

**詳細は `docs/SUPABASE_DATA_SCHEMA.md` と `docs/COMPACTION_DESIGN_AND_OPERATIONS.md` を参照してください。**

---

## 次のアクション（運用者）

- Supabase マイグレーション適用（dev/stage）と RLS 検証。
- テスト用データセットを用意して Workflow 実行を検証。
- アラート・監視設定の導入。

---

## 変更履歴（本ブランチ）

- WASM 実装から TypeScript ネイティブ実装へ移行。
- Cloudflare Workflow を採用し、4-Step マルチステップ実行モデルを導入。
- Thrift compact protocol デコーダ・エンコーダを完全実装（parquet-compactor.ts, parquet-writer.ts）。
- Range requests でストリーミング処理を実装、メモリ効率を向上。
- Supabase に `file_size_bytes` と `file_etag` フィールドを追加。
- エラーハンドリングを強化（exponential/linear backoff retry）。

---

## 付録: 簡易 API テスト例

```bash
# Workflow トリガー
curl -X POST http://localhost:8787/compact \
  -H "Content-Type: application/json" \
  -d '{"datasetId":"550e8400-e29b-41d4-a716-446655440000","bucketKey":"550e8400-e29b-41d4-a716-446655440000"}'

# ステータス確認
curl http://localhost:8787/status/wf-instance-abc123
```
