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
┌──────────────────────────────────┐
│ FUSOU-WEB (Cloudflare Pages)    │
│                                  │
│ 1. POST /api/compact             │ ← 手動トリガー
│ 2. POST /upload                  │ ← リアルタイムアップロード
│ 3. _scheduled.ts (Cron daily)    │ ← 定期実行（毎日 02:00 UTC）
│                                  │
└─────────────┬────────────────────┘
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
│ src/consumer.ts                                │
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

- **`src/pages/api/compact.ts`** - 手動トリガーエンドポイント
  - POST リクエストで Queue に投入

- **`src/pages/api/upload.ts`** - アップロード完了時
  - アップロード完了後に Queue に投入（オプション）

### 2. FUSOU-WORKFLOW
- **`src/consumer.ts`** - Queue Consumer
  - Message batch 受け取り
  - Workflow instance 生成
  - リトライ・DLQ 送信処理

- **`src/dlq-handler.ts`** - DLQ Handler
  - 失敗メッセージのログ記録
  - アラート機能（将来実装）

- **`src/index.ts`** - Workflow メイン
  - 既存実装、変更なし

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
# 以下を追加：
#   PUBLIC_SUPABASE_URL = https://your-project.supabase.co
#   SUPABASE_SECRET_KEY = your-secret-key（Show as secret にチェック）
```

**重要：** 
- ローカル開発では dotenvx が `.env` ファイルから環境変数を読み込みます
- 本番環境（Cloudflare）では Cloudflare Dashboard の Environment Variables から読み込まれます
- `_scheduled.ts` と Cloudflare Functions は `env` パラメータから環境変数を取得します

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
1. User: curl -X POST https://your-site.pages.dev/api/compact -d '{"datasetId":"uuid-123"}'
2. FUSOU-WEB: Request 検証 → Queue に投入
3. Consumer: Message 受信 → Workflow インスタンス生成
4. Workflow: 4 step 実行 (validate → get-metadata → compact → update)
5. Result: Supabase 更新完了
```

### 定期実行
```
1. Cron: 02:00 UTC → _scheduled.ts トリガー
2. _scheduled.ts: Supabase から pending dataset 取得
3. _scheduled.ts: 各 dataset を Queue に投入（並列）
4. Consumer: Message batch 処理（max 10 並列）
5. Workflow: 各データセット コンパクション実行
6. Result: 完了 or DLQ 移動
```

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

# 別ターミナル: _scheduled テスト
curl -X POST http://localhost:8787/api/compact \
  -H "Content-Type: application/json" \
  -d '{"datasetId":"test-uuid-123"}'
```

### 本番環境テスト
```bash
# Queue message 送信テスト
wrangler queues send dev-kc-compaction-queue '{"datasetId":"test-uuid","triggeredAt":"2025-12-17T00:00:00Z","priority":"manual"}'

# Consumer ログ確認
wrangler tail fusou-workflow

# DLQ メッセージ確認
wrangler queue tail dev-kc-compaction-dlq
```

## トラブルシューティング

### Message が処理されない
1. Consumer Worker が deployed か確認
2. Queue バインディングが正しいか確認
3. `wrangler tail` でログ確認
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
