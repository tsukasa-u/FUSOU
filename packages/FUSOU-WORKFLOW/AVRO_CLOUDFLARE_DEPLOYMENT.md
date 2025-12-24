# Avro OCF Hot/Cold Architecture Cloudflare デプロイメントガイド

このドキュメントは、Avro Object Container File (OCF) 形式の Hot/Cold パイプラインを Cloudflare Workers + D1 + R2 環境にデプロイするための手順書です。

## 概要

### アーキテクチャの変更点

**Before（JSON + Hot Only）:**
- Buffer Storage: D1 `buffer_logs` テーブルに JSON 形式で保存
- 無制限保持によるストレージ肥大化
- Hot のみアクセス、Cold archival なし

**After（Avro OCF + Hot/Cold）:**
- Buffer Storage: D1 `buffer_logs` にユーザーデータを保持（Hot, 数時間～数日）
- Archival: 定期 Cron で Avro OCF 形式に圧縮して R2 に保存（Cold）
- Block Index: D1 `block_indexes` テーブルで各ユーザーデータの位置情報を記録
- Reader: Hot と Cold のデータを透過的にマージして提供

### メリット

- **ストレージ効率化**: Deflate 圧縮により約 70% 削減（テスト実績）
- **スケーラビリティ**: 無制限の Cold ストレージ（R2）
- **読み取り高速化**: ブロックインデックスによる Range リード対応
- **ユーザー分離保証**: 各ユーザーデータを独立ブロックに封入（汚染なし）

---

## 前提条件

### 必須環境

```bash
# Node.js >= 18 (モダン Fetch API + crypto.getRandomValues)
node --version

# npm >= 9
npm --version

# Wrangler CLI
npm install -g wrangler@latest
wrangler --version

# Git
git --version
```

### Cloudflare アカウント準備

1. **Cloudflare ダッシュボード** にログイン
2. **Workers & Pages** 設定を確認
3. **D1 Database** サービス有効化
4. **R2 Object Storage** バケット作成（命名: `battle-data`）
5. **API Token** 生成
   - Permissions: Worker Scripts, D1, R2
   - 保存: `.env` ファイルに記載

### ローカルテスト完了確認

```bash
cd packages/FUSOU-WORKFLOW

# TypeScript コンパイル
npx tsc --outDir dist

# Hot/Cold 統合テスト
node test/test-hot-cold.mjs

# 50-user randomized 負荷テスト
node test/test-rust-schema-runs.mjs
```

✅ すべてのテストが Pass していることを確認

---

## デプロイメント手順

### Step 1: Wrangler プロジェクト設定

#### 1.1 `wrangler.toml` の確認

```bash
cd packages/FUSOU-WORKFLOW
cat wrangler.toml
```

以下の設定が存在することを確認：

```toml
name = "fusou-workflow"
type = "service"
main = "src/index.ts"
compatibility_date = "2024-11-15"

# D1 Database バインディング
[[d1_databases]]
binding = "BATTLE_INDEX_DB"
database_name = "battle-index"
database_id = "xxxx-xxxx-xxxx-xxxx"  # 実際の ID に置き換え

# R2 バケットバインディング
[[r2_buckets]]
binding = "BATTLE_DATA_BUCKET"
bucket_name = "battle-data"

# Queue バインディング（Buffer Consumer 用）
[[queues.consumers]]
queue = "battle-ingest"
binding = "BATTLE_QUEUE"
```

#### 1.2 ID 取得

```bash
# D1 データベース ID 取得
wrangler d1 list

# R2 バケット ID 取得
wrangler r2 bucket list
```

⚠️ **重要**: `database_id` と `bucket_name` は環境に合わせて変更してください。

#### 1.3 環境変数設定

```bash
# .env ファイルを作成（.gitignore に入れる）
cat > .env.local << 'EOF'
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_API_TOKEN=your-api-token
CLOUDFLARE_DATABASE_ID=xxxx-xxxx-xxxx-xxxx
EOF
```

---

### Step 2: D1 マイグレーション（初回のみ）

#### 2.1 データベース作成

```bash
# D1 データベースが存在しない場合は作成
wrangler d1 create battle-index

# コマンド実行後に database_id が出力されるので wrangler.toml に記載
```

#### 2.2 スキーママイグレーション

既存スキーマを確認：

```bash
# 既存のスキーマファイル
cat docs/sql/d1/hot-cold-schema.sql
```

以下の 3 つのテーブルがスキーマに含まれています：

**buffer_logs** (Hot Storage)
```sql
CREATE TABLE IF NOT EXISTS buffer_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  data BLOB NOT NULL,           -- JSON 形式のユーザーデータ
  uploaded_by TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_buffer_search 
  ON buffer_logs (dataset_id, table_name, timestamp);
```

**archived_files** (Cold Storage Manifest)
```sql
CREATE TABLE IF NOT EXISTS archived_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL UNIQUE,
  file_size INTEGER,
  compression_codec TEXT,        -- 'deflate', 'snappy', or NULL
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  last_modified_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_archived_path 
  ON archived_files (file_path);
```

**block_indexes** (Block-level Metadata for Range Reads)
```sql
CREATE TABLE IF NOT EXISTS block_indexes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  file_id INTEGER NOT NULL,
  start_byte INTEGER NOT NULL,
  length INTEGER NOT NULL,
  record_count INTEGER NOT NULL,
  start_timestamp INTEGER NOT NULL,
  end_timestamp INTEGER NOT NULL,
  FOREIGN KEY (file_id) REFERENCES archived_files(id)
);

CREATE INDEX IF NOT EXISTS idx_block_indexes_dataset_table
  ON block_indexes(dataset_id, table_name, start_timestamp, end_timestamp);
```

#### 2.3 スキーマ適用

```bash
# ローカル D1 で実行（テスト）
wrangler d1 execute battle-index --local --file docs/sql/d1/hot-cold-schema.sql

# 本番環境に適用
wrangler d1 execute battle-index --file docs/sql/d1/hot-cold-schema.sql

# テーブル確認
wrangler d1 execute battle-index "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

✅ `buffer_logs`, `archived_files`, `block_indexes` テーブルが作成されたことを確認

---

### Step 3: R2 バケット設定

#### 3.1 バケット作成（初回のみ）

```bash
wrangler r2 bucket create battle-data

# リージョン指定が必要な場合
wrangler r2 bucket create battle-data --jurisdiction eu
```

#### 3.2 バケットポリシー設定（オプション）

読み取り公開が不要な場合は設定不要。必要な場合：

```bash
# バケット公開ポリシー JSON を作成
cat > r2-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::battle-data/*"
    }
  ]
}
EOF

# ポリシー適用（Cloudflare Dashboard から手動で設定が推奨）
```

#### 3.3 ライフサイクル設定（30日後自動削除）

```bash
# R2 Lifecycle Rules を設定（Dashboard から設定）
# または Cloudflare API 経由で設定
```

---

### Step 4: ソースコード確認とビルド

#### 4.1 Avro 実装ファイルの確認

```bash
ls -la src/
# 以下のファイルが存在することを確認:
# - avro-manual.ts    (手動 Avro OCF 実装)
# - utils/avro.ts     (ヘッダー・ブロックビルダー)
# - buffer-consumer.ts
# - cron.ts
# - reader.ts
```

#### 4.2 TypeScript コンパイル

```bash
npx tsc --outDir dist

# コンパイルエラーがないことを確認
echo $?
# 0 = 成功
```

#### 4.3 ローカル動作確認

```bash
# ローカル D1 + R2 シミュレーション環境でテスト
wrangler dev --local

# 別ターミナルでリクエスト送信
curl -X POST http://localhost:8787/buffer \
  -H "Content-Type: application/json" \
  -d '{
    "dataset_id": "test-user-001",
    "table": "battle",
    "records": [{"api_no": 1, "result": "success"}]
  }'
```

---

### Step 5: デプロイ（本番環境）

#### 5.1 デプロイ前チェック

```bash
# 変更ファイル確認
git status

# 未コミットがあれば commit
git add -A
git commit -m "Deploy Avro hot/cold pipeline"
```

#### 5.2 本番デプロイ

```bash
# Wrangler デプロイ（D1 + R2 本番に反映）
wrangler deploy

# デプロイ完了メッセージを確認
# "Deployed to https://fusou-workflow.workers.dev"
```

#### 5.3 デプロイ後動作確認

```bash
# ログを確認
wrangler tail

# 本番エンドポイントでテスト
curl -X POST https://fusou-workflow.workers.dev/buffer \
  -H "Content-Type: application/json" \
  -d '{
    "dataset_id": "test-user-production",
    "table": "battle",
    "period_tag": "2025_12_24",
    "records": [{"api_no": 100, "result": "success"}]
  }'
```

---

## 運用手順

### 定期監視タスク

#### Cron Archiver 実行確認

```bash
# D1 から最新の archived_files を確認
wrangler d1 execute battle-index \
  "SELECT id, file_path, file_size, created_at FROM archived_files ORDER BY id DESC LIMIT 10;"

# R2 にアップロード確認
wrangler r2 object list battle-data --recursive | head -20
```

#### Hot ストレージ使用量確認

```bash
wrangler d1 execute battle-index \
  "SELECT COUNT(*) as record_count, SUM(LENGTH(data)) as total_bytes FROM buffer_logs;"
```

期待値：
- `record_count`: 数百～数千（数時間分のデータ）
- `total_bytes`: 10MB 以下（1 日に 1 回 Archival される）

#### Block Index の整合性確認

```bash
wrangler d1 execute battle-index << 'EOF'
SELECT 
  f.id,
  f.file_path,
  COUNT(b.id) as block_count,
  SUM(b.record_count) as total_records,
  SUM(b.length) as total_length,
  f.file_size
FROM archived_files f
LEFT JOIN block_indexes b ON f.id = b.file_id
GROUP BY f.id
ORDER BY f.id DESC
LIMIT 10;
EOF
```

✅ `total_length ≈ file_size - header_size` であることを確認（同期マーカー分の誤差は許容）

---

## トラブルシューティング

### 問題 1: D1 接続エラー

```
Error: D1_ERROR: SQLITE_CANTOPEN
```

**原因**: Database ID が不正、または権限なし

**解決策**:
```bash
# wrangler.toml の database_id を確認
wrangler d1 list

# 正しい ID に更新して再デプロイ
wrangler deploy
```

---

### 問題 2: R2 アップロード失敗

```
Error: BUCKET_NOT_FOUND
```

**原因**: R2 バケット名が誤り、または未作成

**解決策**:
```bash
# バケット確認
wrangler r2 bucket list

# 必要に応じて作成
wrangler r2 bucket create battle-data

# wrangler.toml の bucket_name を確認
```

---

### 問題 3: Avro デコード失敗

```
Error: Sync marker mismatch
```

**原因**: Deflate 圧縮エラー、または ブロック境界の算出誤り

**解決策**:
```bash
# ローカルで再テスト
node test/test-hot-cold.mjs

# 詳細ログ確認
wrangler tail --format pretty

# 必要に応じてロールバック
git revert HEAD
wrangler deploy
```

---

### 問題 4: Out of Memory

```
Error: Memory quota exceeded
```

**原因**: 大規模ユーザー数 (50+) を一度に Archival

**解決策**: Cron 設定を変更して実行頻度を上げる

```toml
# wrangler.toml
[env.production.triggers.crons]
crons = ["0 * * * *"]  # 毎時間実行に変更
```

---

## ロールバック手順

### 即座ロールバック（最後の commit に戻す）

```bash
# ローカルで前のバージョンに戻す
git log --oneline | head -5
git revert <commit-hash>

# 本番デプロイ
wrangler deploy
```

### データベース初期化（全データ削除）

⚠️ **警告**: 本番環境で実行する場合は必ずバックアップ後に実行

```bash
# Buffer ログクリア（Hot ストレージのみ）
wrangler d1 execute battle-index "DELETE FROM buffer_logs;"

# Archived ファイルメタデータクリア
wrangler d1 execute battle-index "DELETE FROM archived_files;"
wrangler d1 execute battle-index "DELETE FROM block_indexes;"

# R2 ファイル削除（手動）
wrangler r2 object delete battle-data/battle/2025_12_*.avro
```

---

## パフォーマンステューニング

### D1 クエリ最適化

```sql
-- インデックス追加（大量アクセスの場合）
CREATE INDEX idx_buffer_logs_timestamp 
  ON buffer_logs(timestamp DESC);

-- 分析クエリの実行統計確認
ANALYZE;
```

### R2 Range リード設定

```typescript
// reader.ts で自動的に Range リードが有効化される
// Block Index からオフセット取得 → R2.get() with range option
```

---

## 本番環境チェックリスト

- [ ] D1 マイグレーション完了 & テーブル確認
- [ ] R2 バケット作成 & 書き込み権限確認
- [ ] Wrangler CLI 最新版インストール
- [ ] `wrangler.toml` の database_id, bucket_name 確認
- [ ] `.env` ファイル設定（Git 除外）
- [ ] ローカル テスト全 PASS
  - [ ] `test-hot-cold.mjs`
  - [ ] `test-rust-schema-runs.mjs`
- [ ] コミット & Git log 確認
- [ ] `wrangler deploy` 実行
- [ ] ログ確認（`wrangler tail`）
- [ ] 본 운영 요청 test
- [ ] 모니터링 대시보드 설정

---

## 関連ファイル

| ファイル | 説明 |
|---------|------|
| [docs/sql/d1/hot-cold-schema.sql](../../docs/sql/d1/hot-cold-schema.sql) | **D1 スキーマ定義**（buffer_logs, archived_files, block_indexes） |
| `src/avro-manual.ts` | 手動 Avro OCF 実装（エンコード・デコード） |
| `src/utils/avro.ts` | Avro ヘッダー・ブロックビルダー |
| `src/buffer-consumer.ts` | Hot ストレージ (D1) ライター |
| `src/cron.ts` | Archival Cron (Hot → Cold) |
| `src/reader.ts` | Hot/Cold マージリーダー |
| `test/test-hot-cold.mjs` | 統合テスト（ブロック境界検証） |
| `test/test-rust-schema-runs.mjs` | 50-user 負荷テスト |
| `wrangler.toml` | Cloudflare Workers 設定 |

---

## サポート

### ログ確認

```bash
# リアルタイムログ（本番）
wrangler tail

# ローカルデバッグログ
wrangler dev --local
# ブラウザ DevTools (F12) で Worker スクリプト実行確認
```

### GitHub Issues

問題が発生した場合：
1. `FUSOU-WORKFLOW` パッケージを確認
2. 関連テスト (`test/test-hot-cold.mjs`) を実行
3. `git log` で最後のコミットを確認
4. issue を作成（ログとコマンドを含める）

---

**最終更新**: 2025年12月24日
**バージョン**: Avro OCF Hot/Cold v1.0
