# Queue ベースのコンパクション実装ガイド

最終更新: 2025-12-17

## 重要：dotenvx による環境変数管理

このプロジェクトは [dotenvx](https://dotenvx.com/) を使用して環境変数を暗号化管理しています。
詳細なセットアップ手順は [docs/DOTENVX_SETUP.md](../DOTENVX_SETUP.md) を参照してください。

**主要ポイント:**
- `.env` ファイルは暗号化してリポジトリにコミット可能
- `DOTENV_PRIVATE_KEY` のみを Cloudflare secret として設定
- FUSOU-WORKFLOW: `import '@dotenvx/dotenvx/config'` で自動ロード
- FUSOU-WEB: `dotenvx run` で開発環境の `.env` をロード

## アーキテクチャ概要

```
┌──────────────────────────────────────────────────┐
│ FUSOU-WEB (Cloudflare Pages)                    │
│                                                  │
│ 1. POST /api/compaction/sanitize-state          │ ← 手動トリガー
│ 2. POST /api/compaction/upload                  │ ← リアルタイムアップロード
│ 3. POST /api/compaction/trigger-scheduled       │ ← スケジュール実行
│    (GitHub Actions cron: 0 2 * * *)             │   (毎日 02:00 UTC)
│                                                  │
└─────────────┬────────────────────────────────────┘
              │ Queue に投入
              ▼
┌────────────────────────────────────────────────┐
│ COMPACTION_QUEUE                               │
│ (dev-kc-compaction-queue)                      │
│ Max batch: 10 messages                         │
│ Timeout: 30 seconds                            │
│ Max retries: 3                                 │
└────────────┬───────────────────────────────────┘
             │
             ▼
┌────────────────────────────────────────────────┐
│ Consumer Worker (FUSOU-WORKFLOW)               │
│ src/index.ts (export const queue)              │
│                                                │
│ Message を受け取る                             │
│ → Workflow instance 生成                      │
│ → Workflow 実行開始                           │
│ → Success: メッセージ ack                     │
│ → Error: Retry (max 3)                        │
│ → 3回失敗: DLQ へ                              │
└────────────┬───────────────────────────────────┘
             │ 失敗時
             ▼
┌────────────────────────────────────────────────┐
│ COMPACTION_DLQ                                 │
│ (dev-kc-compaction-dlq)                        │
│ Max batch: 5 messages                          │
│ Timeout: 60 seconds                            │
│ Max retries: 1                                 │
└────────────┬───────────────────────────────────┘
             │
             ▼
┌────────────────────────────────────────────────┐
│ DLQ Handler Worker (FUSOU-WORKFLOW)            │
│ src/dlq-handler.ts                             │
│                                                │
│ DLQ メッセージ処理                              │
│ → ログ記録                                     │
│ → 監視・アラート                                │
│ → メトリクス記録（将来実装）                    │
│ → Always ack（無限ループ防止）                │
└────────────────────────────────────────────────┘
```

## 実装ファイル

### 1. FUSOU-WEB
- **`functions/_scheduled.ts`** - 定期実行スケジューラー
  - 毎日 02:00 UTC に実行（wrangler.toml で設定）
  - `compaction_needed=true` のデータセットを取得
  - Queue に投入
## 実装ファイル構成

### 1. FUSOU-WEB

**API Integration (Hono + Astro):**
- **`src/pages/api/[...route].ts`** - Astro catch-all route → Hono app
- **`src/server/app.ts`** - Hono メインアプリ（全ルートをマウント）
- **`src/server/routes/compact.ts`** - Compaction API routes（Hono）
  - POST `/api/compaction/upload` - Parquet ファイルアップロード
  - POST `/api/compaction/sanitize-state` - 手動コンパクション
  - POST `/api/compaction/trigger-scheduled` - スケジュール実行（GitHub Actions用）
  - GET `/api/compaction/dlq-status` - DLQ ステータス確認

**ルーティング構造:**
- Astro: `/api/**` → `src/pages/api/[...route].ts`
- Astro → Hono: `app.fetch(request, env)`
- Hono: `app.route('/compaction', compactApp)`
- compactApp: `app.post('/upload', ...)` → `/api/compaction/upload`

**設計思想:**
- Astro Pages: ページ遷移、クッキー、セッション管理
- Hono: 純粋な REST API（JSON レスポンス、認証ヘッダー）
- Astro catch-all route が Hono app に全 API リクエストを委譲

**Scheduled Function:**
- **`functions/_scheduled.ts`** - Cloudflare Cron (注: Pages では使用不可)

### 2. FUSOU-WORKFLOW
- **`src/index.ts`** - Queue Consumer + DLQ Handler + Workflow
  - export const queue - Main Queue Consumer
  - export const dlq - DLQ Handler  
  - class DataCompactionWorkflow - Workflow 実装

## デプロイ手順

### 前提
- Cloudflare アカウント
- wrangler CLI インストール済み
- `pnpm` または `npm` インストール済み

### 1. FUSOU-WORKFLOW デプロイ

```bash
cd packages/FUSOU-WORKFLOW

# Dependencies インストール
pnpm install

# .env ファイル作成（.env.example をコピー）
cp .env.example .env
# .env を編集して実際の値を設定

# dotenvx で .env を暗号化
npx dotenvx encrypt

# DOTENV_PRIVATE_KEY を Worker secret として設定
# .env.keys ファイルから DOTENV_PRIVATE_KEY の値をコピーして実行
wrangler secret put DOTENV_PRIVATE_KEY
# プロンプトに表示されたら .env.keys の private key を貼り付け

# デプロイ
### 2. FUSOU-WEB デプロイ

```bash
cd packages/FUSOU-WEB

# Dependencies インストール
pnpm install

# .env ファイルが既に存在することを確認（なければ作成）

# 本番用 .env.production ファイル作成（オプション）
# .env.production を作成して本番環境の値を設定

# .env.production を暗号化（本番用の場合）
npx dotenvx encrypt -f .env.production

# ビルド（dotenvx が自動的に .env から読み込み）
npm run build

# Pages デプロイ
npx wrangler pages deploy dist

# Cloudflare Pages Dashboard で DOTENV_PRIVATE_KEY 設定
# Settings → Environment variables → Production
# DOTENV_PRIVATE_KEY = （.env.keys または .env.production.keys から取得した private key）
```

**重要：dotenvx と Cloudflare Pages**
- ローカル開発/ビルド: `dotenvx run -- astro build` が `.env` から環境変数を読み込み
- 本番環境: Cloudflare Pages が暗号化された `.env.production` + `DOTENV_PRIVATE_KEY` で復号化
- Astro/Cloudflare Functions では `locals.runtime.env` または `env` パラメータでアクセス
- dotenvx は暗号化により `.env` ファイルをリポジトリにコミット可能（安全）
```

**重要：** 
- ローカル開発では dotenvx が `.env` ファイルから環境変数を読み込みます
- 本番環境（Cloudflare）では Cloudflare Dashboard の Environment Variables から読み込まれます
- API endpoints と Cloudflare Functions は `locals.runtime.env` から環境変数を取得します

### 2.5. GitHub Actions スケジュール設定

**スケジュール実行のセットアップ:**

1. **GitHub Secret の追加:**
   - Repository Settings → Secrets and variables → Actions
   - `PAGES_DOMAIN` を追加（例: `fusou.pages.dev`）

2. **Workflow ファイル確認:**
   `.github/workflows/trigger_daily_compaction.yml` が以下の設定で存在すること：
   ```yaml
   on:
     schedule:
       - cron: '0 2 * * *'  # 毎日 02:00 UTC (11:00 JST)
     workflow_dispatch:      # 手動実行も可能
   ```

3. **手動テスト実行:**
   - GitHub → Actions → "Daily Compaction Trigger"
   - "Run workflow" ボタンで手動実行してテスト

**注意：** Cloudflare Pages は `[[triggers.crons]]` をサポートしていません。そのため GitHub Actions を外部 cron サービスとして使用し、`/api/compaction/trigger-scheduled` エンドポイントを呼び出します

### 3. Cloudflare Dashboard 設定

**Queues 作成:**
```bash
wrangler queues create dev-kc-compaction-queue
wrangler queues create dev-kc-compaction-dlq
```

**FUSOU-WORKFLOW Consumer 設定:**
- Workers → fusou-workflow → Triggers → Queues
- Consumer 1: `dev-kc-compaction-queue` (max_batch_size: 10, timeout: 30s)
- Consumer 2: `dev-kc-compaction-dlq` (max_batch_size: 5, timeout: 60s)

**FUSOU-WEB Cron 設定:**
- Pages → fusou-web → Functions → Triggers
- Cron: `0 2 * * *` (毎日 02:00 UTC)

## 動作フロー例

### 手動トリガー
```
1. User: curl -X POST https://your-site.pages.dev/api/compaction/sanitize-state -d '{"datasetId":"uuid-123"}'
2. FUSOU-WEB: Request 検証 → Queue に投入
3. Consumer: Message 受信 → Workflow インスタンス生成
4. Workflow: 4 step 実行 (validate → get-metadata → compact → update)
5. Result: Supabase 更新完了
```

### 定期実行
```
1. GitHub Actions: 02:00 UTC に Cron 実行
2. GitHub Actions: POST https://fusou.pages.dev/api/compaction/trigger-scheduled
3. trigger-scheduled: Supabase から pending dataset 取得（max 10）
4. trigger-scheduled: 各 dataset を Queue に投入（並列）
5. Consumer: Message batch 処理（max 10 並列）
6. Workflow: 各データセット コンパクション実行
7. Result: 完了 or DLQ 移動
```

**注意：** Cloudflare Pages は scheduled functions (`functions/_scheduled.ts`) をサポートしていません。代わりに GitHub Actions を外部 cron サービスとして使用し、API endpoint `/api/compaction/trigger-scheduled` を呼び出します。

### DLQ 処理
```
1. Consumer: 3回リトライ失敗
2. Automatic: Message を DLQ へ移動
3. DLQ Handler: DLQ message 受信
4. Logging: エラーログ記録
5. Alert: (将来) Slack/PagerDuty に通知
```

## テスト方法

### ローカル開発
```bash
# FUSOU-WEB local dev
cd packages/FUSOU-WEB
npm run dev

# 別ターミナル: 手動コンパクション API テスト
curl -X POST http://localhost:4321/api/compaction/sanitize-state \
  -H "Content-Type: application/json" \
  -d '{"datasetId":"test-uuid-123"}'

# スケジュール実行 API テスト
curl -X POST http://localhost:4321/api/compaction/trigger-scheduled
```

### 本番環境テスト
```bash
# スケジュール実行エンドポイントの手動テスト
curl -X POST https://fusou.pages.dev/api/compaction/trigger-scheduled

# GitHub Actions 手動実行
# GitHub → Actions → "Daily Compaction Trigger" → "Run workflow"

# Queue message 送信テスト
wrangler queues send dev-kc-compaction-queue '{"datasetId":"test-uuid","triggeredAt":"2025-12-17T00:00:00Z","priority":"manual"}'

# Consumer ログ確認
wrangler tail fusou-workflow

# DLQ メッセージ確認
wrangler queues consumer dev-kc-compaction-dlq
```

## トラブルシューティング

### スケジュール実行が動かない
1. GitHub Actions workflow が有効か確認
2. GitHub Secret `PAGES_DOMAIN` が設定されているか確認
3. GitHub Actions ログで HTTP status code 確認
4. `/api/compaction/trigger-scheduled` endpoint に直接アクセスして動作確認

### Message が処理されない
1. Consumer Worker が deployed か確認
2. Queue バインディングが正しいか確認
3. `wrangler tail fusou-workflow` でログ確認
4. Cloudflare Dashboard → Queues で状態確認

### DLQ メッセージが溜まる
1. エラーログを確認
2. Workflow インスタンス ID で詳細確認
3. Supabase 接続確認
4. R2 アクセス確認

### Cron が実行されない
1. `wrangler.toml` に `[[triggers.crons]]` が正しく記載されているか確認
2. Cloudflare Pages が Cron trigger をサポートしているか確認
3. Pages → Triggers タブで Cron status 確認

## 運用ポイント

- **Queue 監視**: Cloudflare Dashboard で `dev-kc-compaction-queue` のメッセージ数を定期確認
- **DLQ 監視**: DLQ メッセージ数が増える場合は Workflow エラーを調査
- **Cron スケジュール**: データセット数に応じて実行時刻を調整可能（`0 2 * * *` を編集）
- **メトリクス**: 将来的に DLQ Handler から metrics table に記録可能

## 将来の拡張

- [ ] DLQ メッセージを metrics table に記録
- [ ] Slack/PagerDuty アラート統合
- [ ] Queue 処理統計ダッシュボード
- [ ] 優先度付きキュー（priority フィールドを活用）
- [ ] バックオフ戦略の高度化
