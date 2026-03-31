# デプロイ後の設定確認チェックリスト

## 🔧 Cloudflare Workers (FUSOU-WEB)

### 環境変数設定

- [ ] **DOTENV_PRIVATE_KEY**
  - `packages/FUSOU-WEB/.env.production.keys` から値をコピー
  - Dashboard → Settings → Environment Variables → Production
  - キー: `DOTENV_PRIVATE_KEY`
  - 値: `.env.production.keys` の DOTENV_PRIVATE_KEY の値

- [ ] **PUBLIC_SUPABASE_URL**
  - 値: `https://your-project.supabase.co`
  - スコープ: Production

- [ ] **SUPABASE_SECRET_KEY**
  - 値: Supabase Project Settings → API Keys → Service Role Key
  - スコープ: Production

### サービスバインディング確認

- [ ] **COMPACTION_WORKFLOW** バインディング
  - Dashboard → Settings → Functions → Service bindings
  - Binding: `COMPACTION_WORKFLOW`
  - Service: `fusou-workflow` (同じアカウント)

### R2 バケット確認

- [ ] **ASSETS_BUCKET** → `dev-kc-assets` (存在確認)
- [ ] **ASSET_SYNC_BUCKET** → `dev-kc-assets` or 専用バケット (存在確認)
- [ ] **FLEET_SNAPSHOT_BUCKET** → `dev-kc-fleets` (存在確認)
- [ ] **BATTLE_DATA_BUCKET** → `dev-kc-battle-data` (存在確認)

### D1 データベース確認（新規）

- [ ] **ASSET_INDEX_DB** → `dev_kc_asset_index` (既存、アセット索引用)
- [ ] **BATTLE_INDEX_DB** → `dev_kc_battle_index` (新規、バトルデータ索引用)
  - Cloudflare Dashboard → D1 → 「Create database」
  - 作成後、`wrangler.toml` の `database_id` を更新
  - SQL初期化: `wrangler d1 execute <database_id> --file docs/sql/battle_index_init.sql`

### キュー設定確認

- [ ] **COMPACTION_QUEUE** バインディング
  - Dashboard → Queues → `dev-kc-compaction-queue` (作成済み確認)

---

## 🔧 Cloudflare Workers (FUSOU-WORKFLOW)

### 環境変数設定 (Workers)

- [ ] **DOTENV_PRIVATE_KEY** (Secret)

  ```bash
  wrangler secret put DOTENV_PRIVATE_KEY
  # 値: .env.keys から DOTENV_PRIVATE_KEY をペースト
  ```

- [ ] **PUBLIC_SUPABASE_URL** (Environment Variable)

  ```toml
  # wrangler.toml に [vars] セクションで設定
  # または Dashboard → Settings → Variables
  ```

- [ ] **SUPABASE_SECRET_KEY** (Secret)

  ```bash
  wrangler secret put SUPABASE_SECRET_KEY
  ```

### Workflow 定義確認

- [ ] **DataCompactionWorkflow** クラス
  - `src/index.ts` で export されている
  - 4-step workflow が実装されている

### キュー Consumer 確認

- [ ] **dev-kc-compaction-queue** Consumer
  - `max_batch_size: 10`
  - `max_batch_timeout: 30`
  - `max_retries: 3`
  - `dead_letter_queue: dev-kc-compaction-dlq`

### キュー DLQ Handler 確認

- [ ] **dev-kc-compaction-dlq** Consumer
  - `max_batch_size: 5`
  - `max_batch_timeout: 60`
  - `max_retries: 1`

---

## 📋 GitHub Actions

### GitHub Secrets 設定

- [ ] **FUSOU_WEB_BASE_URL**
  - 値: `https://fusou.dev` (または本番ドメイン)
  - Repository Settings → Secrets and variables → Actions

### ワークフロー確認

- [ ] **.github/workflows/trigger_daily_compaction.yml**
  - 有効化確認: Actions タブで見えるか
  - Cron: `0 2 * * *` (毎日 02:00 UTC)
  - 手動トリガー: `workflow_dispatch` が有効

### 手動テスト実行

- [ ] Actions → "Daily Compaction Trigger" → "Run workflow" でテスト実行
  - HTTP Status: 200 or 201 が返ってくる
  - ログに "Enqueued" メッセージが表示される

---

## 📊 Supabase

### テーブル作成確認

- [ ] **datasets** テーブル
  - カラム: `id, user_id, name, compaction_needed, compaction_in_progress, last_compacted_at, file_size_bytes, file_etag, compression_ratio, row_count, created_at, updated_at`
  - インデックス: `idx_datasets_user`, `idx_datasets_compaction_needed`, `idx_datasets_updated_at`

- [ ] **processing_metrics** テーブル
  - カラム: Consumer/Workflow 段階の処理時間、圧縮統計、処理結果
  - インデックス: `idx_metrics_dataset`, `idx_metrics_workflow_instance`, `idx_metrics_created`, `idx_metrics_status`

### ビュー確認

- [ ] **analytics.metrics_hourly_summary** ビュー
  - スキーマ: `analytics` (public ではない)
  - アクセス: Postgres コンソール経由のみ

- [ ] **analytics.metrics_error_analysis** ビュー
  - スキーマ: `analytics` (public ではない)
  - アクセス: Postgres コンソール経由のみ

### RLS ポリシー確認

- [ ] **datasets** テーブル RLS
  - `Users can see their own datasets` (SELECT)
  - `Users can update their own datasets` (UPDATE)

- [ ] **processing_metrics** テーブル RLS
  - `Service role can access all metrics` (ALL)
  - `Users can read metrics for their datasets` (SELECT)

---

## 🧪 エンドツーエンドテスト

### API エンドポイントテスト

```bash
# 1. スケジュール実行のテスト
curl -X POST https://fusou.dev/api/compaction/trigger-scheduled \
  -H "Content-Type: application/json" \
  -H "X-ADMIN-TOKEN: <your-admin-token>"

# Expected: { "success": true, "enqueued": 0-N, "datasets": [...] }
# Note: Requires ADMIN_TOKEN to be configured in Cloudflare Workers secrets.

# 2. 手動コンパクションのテスト
curl -X POST https://fusou.dev/api/compaction/sanitize-state \
  -H "Content-Type: application/json" \
  -d '{"datasetId":"<uuid>"}'

# Expected: { "success": true, "datasetId": "<uuid>", "message": "..." }
```

### ログ確認

- [ ] Cloudflare Workers (FUSOU-WEB): `wrangler tail fusou`
- [ ] Cloudflare Workers: `wrangler tail fusou-workflow`
- [ ] キュー状態: `wrangler queues list`

---

## ⚠️ よくある見落とし

1. **dotenvx DOTENV_PRIVATE_KEY が設定されていない**
  - FUSOU-WEB / FUSOU-WORKFLOW の両 Worker で必須
   - `wrangler secret put` で設定済み確認

2. **FUSOU_WEB_BASE_URL Secret がない**
  - GitHub Actions で `secrets.FUSOU_WEB_BASE_URL` が使用される
   - Repository Settings で設定確認

3. **キューが作成されていない**
   - `dev-kc-compaction-queue` と `dev-kc-compaction-dlq` が存在するか確認
   - Cloudflare Dashboard → Queues

4. **R2 バケットの権限不足**
  - FUSOU-WEB Worker / FUSOU-WORKFLOW Worker から該当バケットへのアクセス確認
   - wrangler.toml の `bucket_name` とダッシュボード上の実際の名前が一致

5. **Supabase との接続テスト**
   - `PUBLIC_SUPABASE_URL` と `SUPABASE_SECRET_KEY` が正しい値か確認
   - Supabase コンソール → SQL Editor で直接データ取得テスト

6. **ビューのセキュリティ警告**
   - `analytics` スキーマに移動済み確認
   - `public` スキーマに同名ビューが残っていないか確認

---

## 📞 トラブルシューティング

### エンドポイントが 404

- `src/pages/api/[...route].ts` が存在するか確認
- `src/server/app.ts` で `/compaction` ルートがマウントされているか確認

### キューに投入されない

- COMPACTION_QUEUE バインディングが正しいか確認
- Supabase で `datasets` テーブルから正しくデータが取得できるか確認

### Workflow が実行されない

- COMPACTION_WORKFLOW バインディングが FUSOU-WEB Worker から見えるか確認
- BATTLE_DATA_BUCKET へのアクセス権限確認
- Workflow のスキーマが正しいか確認

---

## 🎯 デプロイ完了時のチェック

```bash
# すべての環境変数が設定されている
wrangler env list

# キューが作成されている
wrangler queues list

# API エンドポイントが応答する
curl https://fusou.dev/api/compaction/trigger-scheduled

# DLQ ステータスエンドポイント確認
curl https://fusou.dev/api/compaction/dlq-status | jq

# ログに エラーがない
wrangler tail fusou
wrangler tail fusou-workflow
```

### DLQ 監視クエリ（Supabase SQL Editor）

```sql
-- DLQ 失敗レコードの確認
SELECT 
  dataset_id,
  workflow_instance_id,
  status,
  error_message,
  error_step,
  created_at,
  workflow_completed_at
FROM processing_metrics
WHERE status IN ('failure', 'dlq_failure')
ORDER BY created_at DESC
LIMIT 20;

-- DLQ 失敗統計
SELECT 
  status,
  error_step,
  COUNT(*) as count
FROM processing_metrics
WHERE status IN ('failure', 'dlq_failure')
  AND created_at > now() - interval '7 days'
GROUP BY status, error_step
ORDER BY count DESC;
```

最後に GitHub Actions で手動実行してみる → 完了! 🎉
