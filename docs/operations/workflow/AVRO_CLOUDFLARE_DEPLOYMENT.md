# Avro OCF Hot/Cold Architecture Cloudflare デプロイメントガイド

このドキュメントは、Avro Object Container File (OCF) 形式の Hot/Cold パイプラインを Cloudflare Workers + D1 + R2 環境にデプロイするための手順書です。

## ⚠️ CRITICAL: クライアント移行が必要

**STATUS (2025-12-24):** Hot/Cold システムは旧 Compaction システムと**互換性のない新メッセージフォーマット**を使用します。

**現在の状態:**
- ✅ Queue purged: 古いメッセージはすべてクリア済み
- ✅ Consumer updated: 古いフォーマットのメッセージは検出してスキップ
- ❌ Client NOT updated: FUSOU-APP はまだ古いフォーマットを送信中

**旧フォーマット（廃止予定）:**
```json
{
  "table": "battle",
  "avro_base64": "T2JqAQQU...",
  "datasetId": "73b5d4e...",
  "periodTag": "2025-12-18",
  "triggeredAt": "2025-12-24T03:42:47.111Z",
  "userId": "c5fb8495-..."
}
```

**新フォーマット（必須）:**
```json
{
  "dataset_id": "73b5d4e...",
  "table": "battle",
  "period_tag": "2025-12-18",
  "records": [
    {"env_uuid": "...", "uuid": "...", "index": 0, ...},
    {"env_uuid": "...", "uuid": "...", "index": 1, ...}
  ],
  "uploaded_by": "c5fb8495-..."
}
```

**本番利用前の必須対応:**

1. **Rust クライアント更新:** [FUSOU-APP/src-tauri/src/storage/providers/r2/provider.rs](../FUSOU-APP/src-tauri/src/storage/providers/r2/provider.rs) を修正:
   - Avro バイナリデータを JSON レコードにデコード
   - `records` 配列に個別レコードを格納
   - `datasetId` → `dataset_id`
   - `periodTag` → `period_tag`
   - `userId` → `uploaded_by`

2. **代替案:** FUSOU-WEB の `/api/battle-data/upload` エンドポイントを更新:
   - 受信した Avro base64 データをパース
   - レコード配列に変換
   - 新フォーマットでキューに送信

3. **更新クライアントのデプロイ:** R2StorageProvider を更新した FUSOU-APP をリビルドして配布

**現在の動作:**
- 旧フォーマットのメッセージは**警告ログを出して静かにスキップ**
- データ破損なし、ただしデータ取り込みもなし
- DLQ は蓄積しない（リトライ前にスキップ）

---

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

#### 1.1 `wrangler.toml` の確認と修正

```bash
cd packages/FUSOU-WORKFLOW
cat wrangler.toml
```

以下の設定を確認・修正：

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

# Queue バインディング（既存 Compaction Queue を再利用）
[[queues.consumers]]
queue = "dev-kc-compaction-queue"
binding = "BATTLE_QUEUE"
```

⚠️ **重要**: Queue は既存の `dev-kc-compaction-queue` を使用します（新規作成不要）

#### 1.2 Queue メッセージ形式の統一

既存の Compaction Queue は以下の **新形式** に統一します：

**新しいメッセージ形式**:
```json
{
  "dataset_id": "user-001",
  "table": "battle",
  "period_tag": "2025_12_24",
  "records": [
    { "timestamp": 1703423400000, "api_no": 1, "result": "success" }
  ],
  "uploaded_by": "user-id"
}
```

**設定変更**:
```bash
# D1 データベース ID 取得
wrangler d1 list

# R2 バケット ID 取得
wrangler r2 bucket list

# database_id と bucket_name を wrangler.toml に記載
```

#### 1.3 既存メッセージのクリア（重要）

既存の Avro base64 形式メッセージ（旧 Compaction）は処理されなくなります。
デプロイ前に Queue と DLQ をクリアしてください。

**Queue クリア手順**:

```bash
# 1. Cloudflare ダッシュボードでクリア（推奨）
# https://dash.cloudflare.com → Workers & Pages → Queues
# → dev-kc-compaction-queue → "Purge Queue" ボタンをクリック
# → dev-kc-compaction-dlq → "Purge Queue" ボタンをクリック
```

**wrangler CLI でクリア（未サポートの場合はダッシュボード使用）**:

```bash
# Queue の全メッセージを削除
wrangler queues purge dev-kc-compaction-queue

# DLQ の全メッセージを削除
wrangler queues purge dev-kc-compaction-dlq
```

⚠️ **注意**: この操作は元に戻せません。必要に応じて旧メッセージをバックアップしてください。

#### 1.4 環境変数設定

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

#### 2.1 データベース確認

```bash
# D1 データベース ID が既に存在するか確認
wrangler d1 list
```

#### 2.2 スキーマ適用

既存スキーマを確認：

```bash
# 既存のスキーマファイル
cat docs/sql/d1/hot-cold-schema.sql
```

スキーマ適用コマンド：

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

## 実装選択肢

### 既存 Compaction Queue との統合

新しい Avro Hot/Cold システムは **既存の `dev-kc-compaction-queue`** を直接使用します：

| 構成要素 | 役割 | メッセージ形式 |
|---------|------|--------------|
| `dev-kc-compaction-queue` | データ入力 Queue | 新形式（JSON: dataset_id, table, records...） |
| `buffer-consumer.ts` | Hot Storage Writer | D1 `buffer_logs` にバッファ |
| `cron.ts` | Archival Worker | Hot → Cold（R2 Avro OCF） |
| `reader.ts` | Hot/Cold Merger | 透過的な読み取り |

### メッセージ形式の変更

**旧形式（非互換）**:
```json
{
  "table": "battle",
  "avro_base64": "T2JqAQQW...",
  "datasetId": "...",
  "periodTag": "...",
  "triggeredAt": "...",
  "userId": "..."
}
```

**新形式（統一形式）**:
```json
{
  "dataset_id": "user-001",
  "table": "battle",
  "period_tag": "2025_12_24",
  "records": [
    { "timestamp": 1703423400000, "api_no": 1, "result": "success" },
    { "timestamp": 1703423401000, "api_no": 2, "result": "success" }
  ],
  "uploaded_by": "user-id"
}
```

⚠️ **重要**: 既存の旧形式メッセージは処理されません。DLQ に積まれたメッセージは削除してください。

---

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
