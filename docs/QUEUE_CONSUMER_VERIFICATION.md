# Cloudflare Queues コンシューマー接続確認ガイド

最終更新: 2025-12-18

## デプロイ確認結果

✅ **デプロイ成功**: 2025-12-18

```
Consumer for dev-kc-compaction-queue  ✅
Consumer for dev-kc-compaction-dlq    ✅
```

## 修正内容

### 1. TypeScript型シグネチャの修正

**問題**: 公式ドキュメントによると、queue ハンドラーには `ExecutionContext` パラメータが必要

**修正前**:
```typescript
async queue(batch: MessageBatch<any>, env: Env): Promise<void>
```

**修正後**:
```typescript
async queue(batch: MessageBatch<any>, env: Env, ctx: ExecutionContext): Promise<void>
```

**影響箇所**:
- `export default { queue(...) }` - メインエントリーポイント
- `export const queue = {...}` - メインキューハンドラー
- `export const queueDLQ = {...}` - DLQハンドラー

### 2. wrangler.toml 設定の確認

**現在の設定（正しい）**:

```toml
[[queues.consumers]]
queue = "dev-kc-compaction-queue"
max_batch_size = 10
max_batch_timeout = 30
max_retries = 3
dead_letter_queue = "dev-kc-compaction-dlq"

[[queues.consumers]]
queue = "dev-kc-compaction-dlq"
max_batch_size = 5
max_batch_timeout = 60
max_retries = 1
```

✅ **公式ドキュメント準拠**: https://developers.cloudflare.com/queues/configuration/configure-queues/

## Cloudflare Dashboard での確認手順

### Step 1: Worker の確認

```
Cloudflare Dashboard
  → Workers & Pages
    → fusou-workflow
```

**確認項目**:
- ✅ Status: Active
- ✅ Last deployed: 最新の日時
- ✅ URL: https://fusou-workflow.{account}.workers.dev

### Step 2: Queue Consumer の確認

```
Cloudflare Dashboard
  → Queues
    → dev-kc-compaction-queue
      → Consumers タブ
```

**期待される表示**:
```
Consumer: fusou-workflow
Status: Active
Max batch size: 10
Max batch timeout: 30 seconds
Max retries: 3
Dead letter queue: dev-kc-compaction-dlq
```

同様に `dev-kc-compaction-dlq` も確認:
```
Consumer: fusou-workflow
Status: Active
Max batch size: 5
Max batch timeout: 60 seconds
Max retries: 1
```

### Step 3: メッセージの確認

```
Cloudflare Dashboard
  → Queues
    → dev-kc-compaction-queue
      → Recent Messages
```

**症状**: メッセージが蓄積されている場合
- ✅ Consumer が登録されている → デプロイ直後のため、次のバッチまで待機中
- ❌ Consumer が表示されない → デプロイが完全でない（Step 2を再確認）

**バッチ処理のタイミング**:
- メッセージが10件に達する
- または30秒経過する
- いずれか早い方でバッチ処理が開始される

### Step 4: ログの確認

```
Cloudflare Dashboard
  → Workers & Pages
    → fusou-workflow
      → Logs (Real-time)
```

**期待されるログ**:
```json
{
  "message": "[Queue Router] Received batch",
  "batchSize": 5,
  "queueName": "dev-kc-compaction-queue",
  "timestamp": "2025-12-18T..."
}

{
  "message": "[Queue Consumer] ===== BATCH START =====",
  "batchSize": 5,
  "timestamp": "2025-12-18T..."
}

{
  "message": "[Queue Consumer] Processing message",
  "datasetId": "dataset_001",
  "messageId": "msg_123",
  "timestamp": "2025-12-18T..."
}

{
  "message": "[Queue Consumer] Workflow dispatched successfully",
  "workflowInstanceId": "workflow_456",
  "timestamp": "2025-12-18T..."
}
```

## トラブルシューティング

### 問題A: "No consumers connected" と表示される

**原因**: デプロイが完了していない、またはキャッシュの問題

**対策**:
1. ページをリロード（F5）
2. 5分待ってから再確認
3. 再デプロイ:
   ```bash
   cd packages/FUSOU-WORKFLOW
   npm run deploy
   ```

### 問題B: Consumer は表示されるが、メッセージが処理されない

**確認項目**:
1. **ログを確認**: `[Queue Router] Received batch` が表示されているか
   - 表示される → ハンドラーは動作している（Workflow側の問題）
   - 表示されない → バッチタイミング待ち（30秒以内 or 10件未満）

2. **メッセージ数を確認**: 10件以上あるか
   - 10件未満 → 30秒待つか、さらにメッセージを送信

3. **Worker のエラーログを確認**: エラーが出ていないか
   - エラーあり → エラー内容を確認して修正

### 問題C: DLQ にメッセージが移動する

**原因**: メッセージ処理が3回失敗した

**確認方法**:
```
Cloudflare Dashboard
  → Queues
    → dev-kc-compaction-dlq
      → Recent Messages
```

**対策**:
1. DLQ ログを確認:
   ```json
   {
     "message": "[DLQ Handler] Message in DLQ",
     "datasetId": "...",
     "error": "..."
   }
   ```

2. エラー内容に基づいて修正
3. 修正後、メッセージを再送信

## 公式ドキュメント参照

- [Configure Queues](https://developers.cloudflare.com/queues/configuration/configure-queues/)
- [JavaScript APIs](https://developers.cloudflare.com/queues/configuration/javascript-apis/)
- [Batching, Retries and Delays](https://developers.cloudflare.com/queues/configuration/batching-retries/)
- [Dead Letter Queues](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/)

## 次のステップ

1. ✅ デプロイ完了確認
2. ⏳ Cloudflare Dashboard で Consumer 接続確認（5分待機推奨）
3. ⏳ テストメッセージ送信
4. ⏳ ログで処理フロー確認

---

## 参考: 公式推奨構造

```typescript
// index.ts
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // HTTP ハンドラー
  },
  
  async queue(batch: MessageBatch, env: Env, ctx: ExecutionContext): Promise<void> {
    // Queue Consumer ハンドラー
    for (const message of batch.messages) {
      // 処理
      message.ack(); // 成功
      // または
      message.retry(); // リトライ
    }
  }
};
```

**重要**: 
- `ctx` パラメータは必須（`ctx.waitUntil()` などで使用可能）
- `message.ack()` で明示的に確認しない場合、ハンドラーが正常終了すると自動的に ack される
- エラーが投げられると、バッチ全体が retry される
