# FUSOU データセットコンパクション設計・実装・運用ドキュメント

最終更新: 2025-12-16 / ブランチ: `r2_parquet`

本ドキュメントは、Cloudflare Workflow による Parquet コンパクションの設計、実装内容、運用方法、128MB メモリ制限を踏まえたチューニング指針を詳細にまとめたものです。

---

## 1. 背景と目的

- FUSOU はユーザーのアップロードした各テーブルのデータを **raw 連結バイナリ**（各テーブルの Parquet 断片を連結）として R2 に保存します。
- 後段の分析や配信効率のため、テーブル単位で **最適化ファイル（optimized Parquet）** に再編成（コンパクション）します。
- コンパクションは **Cloudflare Workflow**（マルチステップ非同期処理）上で **TypeScript ネイティブ**実装として実行し、Supabase メタデータを参照・更新します。

---

## 2. コンポーネント構成

### 2.1 FUSOU-WORKFLOW（Cloudflare Worker + TypeScript）

- **実行モデル**: `DataCompactionWorkflow` クラスで 4-step フロー実装
- **Step 1: validate-dataset**
  - Supabase から dataset レコード取得（SELECT with 3x retry）
  - `compaction_needed`, `compaction_in_progress` の状態確認
- **Step 2: get-file-metadata**
  - R2 `bucket.head()` でファイル存在確認とサイズ取得
- **Step 3: compact-with-wasm**
  - TypeScript ネイティブ実装（WASM不要）
  - Parquet footer メタデータ解析（Thrift compact protocol デコード）
  - 断片化 Row Group の検出とマージ
  - 新 Parquet ファイル生成と R2 `bucket.put()` で書き込み
  - ETag 取得して返却
- **Step 4: update-metadata**
  - Supabase UPDATE で 5 フィールド更新（3x retry）
    - `compaction_in_progress := false`
    - `compaction_needed := false`
    - `last_compacted_at := now()`
    - `file_size_bytes := compactedSize` (実値)
    - `file_etag := etag` (R2 ETag)

### 2.2 FUSOU-WEB（Astro + Cloudflare Pages）

- `src/pages/api/compact.ts`:
  - API ハンドラー（トリガーポイント）
  - リクエスト検証、Workflow インスタンス生成
  - 202 Accepted レスポンス返却
  
- `src/pages/api/compact/status/[instanceId].ts`:
  - ステータス確認エンドポイント
  - Workflow の進捗情報取得

- `functions/_scheduled.ts`:
  - 定期実行スケジューラー
  - `compaction_needed = true` のデータセット検出
  - 順次 `POST /api/compact` でトリガー

### 2.3 Supabase（PostgreSQL + REST）

- テーブル: `datasets`
- 実装カラム:
  - `id`（UUID, PRIMARY KEY）
  - `compaction_in_progress`（boolean）
  - `compaction_needed`（boolean）
  - `last_compacted_at`（timestamptz, nullable）
  - `file_size_bytes`（integer）
  - `file_etag`（string）

### 2.4 Cloudflare R2

- S3 互換ストレージ
- 保存構造:
  - `{dataset_id}` キーで Parquet ファイル保存
  - ETag で ファイルバージョン追跡

---

## 3. 実装詳細

### 3.1 Workflow エントリーポイント（`packages/FUSOU-WORKFLOW/src/index.ts`）

**DataCompactionWorkflow クラス**:
```typescript
class DataCompactionWorkflow extends WorkflowEntrypoint<Env, CompactionParams> {
  async run(event, step) {
    // Step 1-4 を順次実行
  }
}
```

**Step 1: validate-dataset**
- Supabase SELECT でデータセット存在確認
- リトライ: 3回、exponential backoff
- エラー時: throw

**Step 2: get-file-metadata**
- R2 `bucket.head(bucketKey)` でファイルメタデータ取得
- ファイルサイズ確認

**Step 3: compact-with-wasm**
- `analyzeAndCompactParquet()` 呼び出し
- `compactFragmentedRowGroups()` でマージ処理
- `writeCompactedParquetFile()` で R2 書き込み
- リトライ: 2回、linear backoff
- 戻り値: `{ newFileSize, newRowGroupCount, etag }`

**Step 4: update-metadata**
- Supabase UPDATE で 5フィールド同時更新
- リトライ: 3回、linear backoff
- エラー時: throw

**HTTP ハンドラー**:
- `POST /compact { datasetId }` → Workflow インスタンス生成 → 202 Accepted
- `GET /status/:instanceId` → Workflow 進捗状況
- `GET /` → ヘルスチェック

### 3.2 Parquet 解析・処理（`packages/FUSOU-WORKFLOW/src/parquet-compactor.ts`）

**parseParquetMetadata()**:
- Thrift compact protocol デコード
- FileMetaData から num_rows, row_groups を抽出

**compactFragmentedRowGroups()**:
- 健全な Row Group と断片化 RG を分類
- 断片化 RG のデータを Range requests で読み込み
- MergedRowGroup 構造で再統合
- 出力: `{ newFileSize, newRowGroupCount, etag }`

**ThriftCompactReader**:
- 39個の write メソッドで Thrift encoding サポート
- Zigzag/Varint エンコーディング実装

### 3.3 Parquet ファイル書き込み（`packages/FUSOU-WORKFLOW/src/parquet-writer.ts`）

**writeCompactedParquetFile()**:
- 健全な Row Group データ読み込み（Range requests）
- マージ Row Group データ読み込み
- 新 Parquet footer 生成（Thrift compact protocol）
- ファイル組み立て: data + footer + metadataSize + magic bytes
- R2 `bucket.put()` で書き込み
- 戻り値: `{ newFileSize, etag }`

**generateParquetFooter()**:
- Thrift FileMetaData 生成
- Version, CreatedBy, RowGroups list など

**ThriftCompactWriter**:
- writeField(), writeI32/I64(), writeVarint() など
- バッファ自動拡張機能

---

## 4. リソース制限と対策

Cloudflare Workers の制限:
- **メモリ**: 128MB（ハード制限）
- **CPU時間**: 30秒（ページロード）/ 30分（Durable Objects）
- **ネットワーク I/O**: レート制限なし（Supabase/R2 側の制限を受ける）

**対策**:

| 制限 | 対策 |
|-----|------|
| メモリ 128MB | Range requests でストリーミング処理。複数 Row Group の同時読み込み避ける |
| CPU 30秒 | Parquet 連結のみ実装。圧縮/デコード/複雑集約は将来対応 |
| ネットワーク | リトライ戦略（exponential/linear backoff）で対応 |

**Workflow の強み**:
- 複数ステップで分割実行で CPU 時間をリセット
- ビルトイン retry メカニズム（指数/線形バックオフ）
- ステップ失敗時の部分復旧対応

---

## 5. 環境変数一覧

**必須**（Worker 環境変数）:
- `PUBLIC_SUPABASE_URL`: Supabase API エンドポイント
- `SUPABASE_SECRET_KEY`: Supabase service role キー
- `BATTLE_DATA_BUCKET`: R2 バケット（Binding）

**オプション**（Pages から Workflow へ伝播）:
- `WORKFLOW_INSTANCE_TIMEOUT_MS`（デフォルト: 30000ms）

---

## 6. 実行手順（ローカル/本番）

### 6.1 ローカルでの確認

Worker 開発:
```bash
cd packages/FUSOU-WORKFLOW
npm install
npm run dev
```

Workflow トリガー:
```bash
curl -X POST http://localhost:8787/compact \
  -H "Content-Type: application/json" \
  -d '{"datasetId":"uuid-123","bucketKey":"uuid-123"}'
```

### 6.2 本番デプロイ（Cloudflare）

```bash
cd packages/FUSOU-WORKFLOW
npm run build
wrangler deploy
```

FUSOU-WEB との連携:
```bash
cd packages/FUSOU-WEB
# Service Binding を wrangler.toml で設定
# [[services]]
# binding = "DATA_COMPACTION"
# service = "fusou-workflow"
npm run build
npm run deploy
```

---

## 7. データフロー

**全体フロー**:
```
ユーザーアップロード (FUSOU-APP/fusou-upload)
  ↓
R2 に Parquet ファイル保存
  ↓
POST /api/compact (FUSOU-WEB)
  ↓
Workflow インスタンス生成 (FUSOU-WORKFLOW)
  ├─ Step 1: Supabase SELECT（3x retry）
  ├─ Step 2: R2 bucket.head()
  ├─ Step 3: Parquet 解析・圧縮・書き込み（2x retry）
  └─ Step 4: Supabase UPDATE（3x retry）
  ↓
202 Accepted レスポンス返却
  ↓
スケジューラー定期実行 (FUSOU-WEB/_scheduled.ts)
  ↓
compaction_needed=true のデータセット自動処理
```

**Supabase 操作**:
- **SELECT** (Step 1): `compaction_needed`, `compaction_in_progress` 確認
- **UPDATE** (Step 4): 5フィールド同時更新
  - `compaction_in_progress := false`
  - `compaction_needed := false`
  - `last_compacted_at := now()`
  - `file_size_bytes := compactedSize`
  - `file_etag := etag`

---

## 8. 拡張計画（ロードマップ）

**短期（現在）**:
- ✅ Parquet 連結による Row Group マージ
- ✅ Thrift compact protocol デコード・エンコード
- ✅ R2 Range requests によるストリーミング処理
- ✅ Supabase フラグ管理

**中期（予定）**:
- DataFusion SQL による本格 Parquet マージ（スキーマ整合、重複排除）
- チャンク/ストリーミングアップロード（メモリ削減）
- 詳細メトリクス記録（処理時間、圧縮率、エラー分類）
- Supabase Advisory Lock による完全な並行制御

**長期（検討中）**:
- 複数テーブルの同時 compaction
- キャッシュ層の導入（頻繁にアクセスされるファイル）
- より高度な圧縮戦略

---

## 9. トラブルシューティング

| 症状 | 原因 | 対策 |
|-----|------|------|
| **Workflow が Step 1 で失敗** | Supabase 接続エラー | `SUPABASE_SECRET_KEY` 確認、ネットワーク確認 |
| **Step 2 で R2 ファイル不在** | ファイル削除済み or 存在しない | `bucketKey` が正しいか確認 |
| **Step 3 で Parquet 解析失敗** | 無効なファイルフォーマット | Parquet ファイル検証ツール使用 |
| **Step 4 で Supabase UPDATE 失敗** | RLS ポリシー or 接続エラー | RLS ポリシー確認、retry 回数確認 |
| **メモリ不足（OOM）** | 大きなファイル処理 | ファイルサイズを制限、Range requests 活用 |
| **Workflow タイムアウト** | ネットワーク遅延 | リトライ戦略調整、timeout 値拡張 |

---

## 10. 付録: 主要ファイルパス

- Workflow エントリー: `packages/FUSOU-WORKFLOW/src/index.ts`
- Parquet 解析: `packages/FUSOU-WORKFLOW/src/parquet-compactor.ts`
- Parquet 書き込み: `packages/FUSOU-WORKFLOW/src/parquet-writer.ts`
- Pages API: `packages/FUSOU-WEB/src/pages/api/compact.ts`
- Pages スケジューラー: `packages/FUSOU-WEB/functions/_scheduled.ts`
- Workflow 設定: `packages/FUSOU-WORKFLOW/wrangler.toml`
- Pages 設定: `packages/FUSOU-WEB/wrangler.toml`

---

本ドキュメントの内容に沿って、Cloudflare Workers の 128MB メモリ制限に配慮した安全な運用が可能です。ご不明点や追加要件があれば、強化版の実装（DataFusion マージ、ストリーミング化、詳細監視等）をご提案・実装します。
