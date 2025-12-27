<!-- markdownlint-disable MD032 MD040 MD025 MD022 MD007 MD010 -->
# Supabase データスキーマ・データフロー仕様書

最終更新: 2025-12-16 / ブランチ: `r2_parquet`

本ドキュメントは、Parquet コンパクション Workflow で使用される Supabase データベースの構造、フロー、エラー対応を詳細に記載したものです。

---

## 1. datasets テーブル定義

### スキーマ

| カラム | 型 | 制約 | 説明 |
|--------|-----|------|------|
| `id` | UUID | PRIMARY KEY | データセット ID |
| `compaction_in_progress` | boolean | DEFAULT false | 処理中フラグ（並行実行制御） |
| `compaction_needed` | boolean | DEFAULT false | 次回処理必要フラグ |
| `last_compacted_at` | timestamptz | NULLABLE | 最終処理時刻 |
| `file_size_bytes` | integer | NULLABLE | 現在のファイルサイズ（実値） |
| `file_etag` | string | NULLABLE | R2 ETag（ファイル版管理） |

### 補足カラム

実装時は以下も存在する可能性があります：
- `owner_id` (UUID)
- `dataset_name` (string)
- `description` (text)
- `created_at` (timestamptz)
- `updated_at` (timestamptz)
- `status` (string, enum)

---

## 2. データフロー詳細

### フェーズ 1: トリガー（Pages）

```
POST /api/compact { datasetId: "uuid-123" }
  ↓
FUSOU-WEB checks R2 file
  ↓
UPDATE datasets SET
  compaction_in_progress = true,
  compaction_needed = false
WHERE id = 'uuid-123'
  ↓
Workflow インスタンス生成
  ↓
202 Accepted 応答
```

### フェーズ 2: Workflow Step 1 - 検証読み込み

```
SELECT id, compaction_needed, compaction_in_progress
FROM datasets WHERE id = 'uuid-123'

期待値:
  - id: 'uuid-123'
  - compaction_needed: false （Pages が設定）
  - compaction_in_progress: true （Pages が設定）

エラーハンドリ:
  - データなし → throw
  - 接続エラー → 3回リトライ (exponential backoff)
```

### フェーズ 3: Workflow Step 2-3 - Parquet 処理

```
Parquet footer メタデータ解析
  ↓
Row Group フラグメント検出
  ↓
断片マージ処理
  ↓
新 Parquet ファイル生成
  ↓
R2 bucket.put(newFile)
  ↓
ETag 取得 (E.g., "3a4f8c2d")
```

### フェーズ 4: Workflow Step 4 - 結果保存

```
UPDATE datasets SET
  compaction_in_progress = false     ← 処理完了
  compaction_needed = false          ← 次回不要
  last_compacted_at = now()          ← 実行時刻
  file_size_bytes = 88080384         ← 新ファイルサイズ
  file_etag = '3a4f8c2d'             ← R2 ETag
WHERE id = 'uuid-123'

エラーハンドリング:
  - 接続エラー → 3回リトライ (linear backoff)
  - 失敗 → throw
```

### フェーズ 5: ステータス確認（任意）

```
GET /api/compact/status/wf-instance-abc123
  ↓
Response:
{
  status: 'success',
  output: {
    success: true,
    datasetId: 'uuid-123',
    originalSize: 104857600,
    compactedSize: 88080384,
    compressionRatio: 0.84,
    timestamp: '2025-12-16T10:30:00Z'
  }
}
```

---

## 3. データ値の追跡

### file_size_bytes の流れ

```
R2 bucket.head(datasetId)
  ├─ originalSize を取得
  └─ ログに記録

R2 bucket.put(newParquetFile)
  ├─ 新ファイルサイズ計算
  ├─ newFileSize := data.length + footer.length + 8 + 4
  └─ Workflow 戻り値に含める

compactFragmentedRowGroups() 出力
  └─ { newFileSize, newRowGroupCount, etag }

analyzeAndCompactParquet() 返却値
  └─ { originalSize, compactedSize, compressionRatio, etag }

Workflow.run() 最終戻り値
  └─ { success, datasetId, originalSize, compactedSize, compressionRatio, etag }

Supabase UPDATE (Step 4)
  └─ file_size_bytes := compactedSize
     file_etag := etag
```

### file_etag の流れ

```
R2 bucket.put(newParquetFile)
  └─ ETag 取得（ファイルハッシュ）
     例: "3a4f8c2d-12345678"

writeCompactedParquetFile() 返却
  └─ { newFileSize, etag }

compactFragmentedRowGroups() 返却
  └─ etag をパススルー

analyzeAndCompactParquet() 返却
  └─ etag をパススルー

Workflow.run() 最終戻り値
  └─ etag をクライアントに返却

Supabase UPDATE (Step 4)
  └─ file_etag := etag
     （将来：キャッシュ無効化、ファイル版追跡用）
```

---

## 4. 並行処理とロック戦略

### compaction_in_progress フラグの役割

```
フロー開始時:  false → true （Pages でセット）
  │
  ├─ 他の Workflow が同じ datasetId を検出
  ├─ Step 1 の SELECT で compaction_in_progress = true を読む
  └─ 検証ロジックでスキップ OR エラー（実装依存）
  
フロー完了時:  true → false （Workflow Step 4 でセット）
  │
  └─ 次の Workflow が処理開始可能
```

### 並行実行対策チェックリスト

✅ 実装完了:
- Pages トリガー時に `compaction_in_progress = true` をセット
- Workflow Step 4 で明示的に `false` に戻す
- 3回リトライで Supabase 通信信頼性向上

✓ 推奨（将来）:
- Supabase Advisory Lock による完全なロック
- タイムアウト時の自動復帰ロジック

---

## 5. エラーシナリオと対応

### シナリオ 1: Supabase 接続エラー (Step 1)

```
SELECT 実行 → 失敗
  ↓
リトライ #1 (delay: 5s, backoff: exp)
  ↓
リトライ #2 (delay: 10s)
  ↓
リトライ #3 (delay: 20s)
  ↓
全て失敗 → throw
  ↓
Workflow 失敗
  ↓
compaction_in_progress: true のまま残存
  └─ アラート設定が必要
```

**復旧手段**:
- 手動で `compaction_in_progress = false` にリセット
- スケジューラーが次回検出時に再処理

### シナリオ 2: R2 ファイル不在 (Step 2)

```
bucket.head(bucketKey)
  ↓
404 Not Found OR Error
  ↓
throw
  ↓
Workflow 失敗 (Step 2)
  ↓
compaction_in_progress: true のまま残存
  └─ ログに詳細エラーを記録
```

**原因**:
- ファイル削除済み
- bucketKey が間違っている
- R2 バケット権限不足

### シナリオ 3: Parquet 無効フォーマット (Step 3)

```
parseParquetMetadata() 実行
  ↓
Thrift デコード失敗
  ↓
throw "Invalid Parquet file"
  ↓
リトライ #1, #2 (linear backoff, 2回)
  ↓
全て失敗
  ↓
Workflow 失敗 (Step 3)
  ↓
compaction_in_progress: true のまま
  └─ ログに詳細エラーを記録
```

**復旧**:
- Parquet ファイル再作成
- 手動で `compaction_in_progress = false` リセット

### シナリオ 4: Supabase UPDATE 失敗 (Step 4)

```
UPDATE 実行 → 失敗
  ↓
リトライ #1, #2, #3 (linear backoff)
  ↓
全て失敗 → throw
  ↓
データ不整合状態:
  - R2: 新ファイルは書き込み済み ✓
  - Supabase: メタデータ未更新 ✗
  └─ compaction_in_progress: true のまま
```

**リスク**: メタデータ不整合（最悪）
- 新ファイルが古いメタデータで扱われる
- file_size_bytes が古い値のまま
- file_etag が記録されない

**復旧**:
- アラート発火（Workflow 失敗）
- 管理者が手動で UPDATE 実行
- または Workflow 再実行（R2 上書き）

### シナリオ 5: Workflow タイムアウト

```
Step 1-4 実行中に 30秒経過
  ↓
Worker プロセス強制終了
  ↓
compaction_in_progress: true のまま残存
  └─ データベース未更新
```

**対策**:
- ファイルサイズ制限で処理時間を短縮
- Range requests でメモリ効率化
- 非同期リトライ機構

---

## 6. データ整合性保証

### Read-After-Write 一貫性

```
✓ Workflow が R2 に書き込み
  ↓
✓ 直後に bucket.head() で確認可能
  ↓
✓ Supabase UPDATE で etag 記録
  └─ 同じファイルを追跡可能
```

### 冪等性

```
同じ datasetId で 2回実行:
  - 1回目: 元ファイル → 圧縮ファイル生成 → etag_1 記録
  - 2回目: 圧縮ファイル → 再圧縮ファイル生成 → etag_2 記録
    └─ 異なる etag で新ファイル生成（非冪等）
      ※ Parquet 連結処理が入力に依存するため
```

### トランザクション管理

```
R2 write と Supabase update は独立:
  ✗ 原子性なし（ACID 保証なし）
  
対策:
  ✓ 監視・アラート設定
  ✓ 定期的なデータ一貫性チェック
  ✓ 手動復旧プロセス
```

---

## 7. スケジューラー（_scheduled.ts）連携

### フロー

```
定期実行トリガー
  ↓
SELECT * FROM datasets WHERE compaction_needed = true
  ↓
結果セット例:
  [
    { id: 'uuid-1', compaction_in_progress: false, ... },
    { id: 'uuid-2', compaction_in_progress: false, ... },
  ]
  ↓
各データセットに対して:
  UPDATE datasets SET compaction_in_progress = true
  WHERE id = 'uuid-X'
  ↓
POST /api/compact { datasetId: 'uuid-X' }
  ↓
Workflow トリガー
  ↓
（並列度 2-4 で管理）
```

---

## 8. ログ・モニタリング

### ログポイント

| 箇所 | ログ内容 | 例 |
|-----|---------|-----|
| Workflow 開始 | `[Workflow] Starting compaction for dataset: uuid-123` | Step 1 |
| SELECT 成功 | `Dataset validation passed: { id, compaction_in_progress, compaction_needed }` | Step 1 |
| R2 head 成功 | `File metadata: size=104857600, etag=3a4f8c2d` | Step 2 |
| Parquet 解析 | `Parsed metadata: num_rows=1000000, num_row_groups=8` | Step 3 |
| Row Group マージ | `Compacted: 8 RGs → 2 RGs, compression=0.84` | Step 3 |
| R2 write 完了 | `File written to R2: size=88080384, etag=new-etag` | Step 3 |
| UPDATE 成功 | `Metadata updated: compaction_in_progress=false, file_size_bytes=88080384` | Step 4 |

### アラート設定（推奨）

- `compaction_in_progress = true` が 1時間以上
- Workflow インスタンス失敗
- Step 1 または Step 4 で全リトライ失敗

---

## 9. チェックリスト

### デプロイ前

- [ ] Supabase テーブル作成済み（6 カラム確認）
- [ ] RLS ポリシー設定（service role OK）
- [ ] R2 バケット作成済み
- [ ] 環境変数設定（PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY）
- [ ] Workflow Worker デプロイ完了

### 本番運用

- [ ] 定期的なデータ一貫性チェック
- [ ] アラート監視設定
- [ ] エラーログ定期確認
- [ ] 手動リセット手順書作成
- [ ] バックアップ戦略（R2 スナップショット等）

---

**補足**: 詳細な実装内容は `COMPACTION_DESIGN_AND_OPERATIONS.md` を参照してください。
