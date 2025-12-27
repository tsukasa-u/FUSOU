# Queue Consumer デバッグガイド

キューにメッセージが溜まっている場合の診断・修復手順

## 問題の兆候

- キューに`dev-kc-compaction-queue`にメッセージが蓄積されている
- FUSOU-WORKFLOWがメッセージを読み取らない
- Parquet圧縮処理が実行されない

## 原因の特定手順

### Step 1: FUSOU-WORKFLOWがデプロイされているか確認

```bash
# Cloudflare Dashboard → Workers → Worker List
# 確認項目: "fusou-workflow" が表示されているか
```

**症状:** fusou-workflow が存在しない
- **原因:** Worker がデプロイされていない
- **対策:** 以下を実行

```bash
cd packages/FUSOU-WORKFLOW
npm run deploy
```

---

### Step 2: キューにメッセージがあるか確認

```
Cloudflare Dashboard → Queues → dev-kc-compaction-queue → Recent Messages
```

**症状:** メッセージが表示されている
- **次:** Step 3へ進む

**症状:** メッセージがない
- **原因:** FUSOU-WEB がキューに送信していない
- **対策:** battle_data.ts と compact.ts のキュー送信部分をログで確認

---

### Step 3: FUSOU-WORKFLOWが消費者として登録されているか確認

```
Cloudflare Dashboard → Queues → dev-kc-compaction-queue → Consumers
```

**症状:** Consumer リストに "fusou-workflow" が表示されている
- **次:** Step 4へ進む

**症状:** 何も表示されていない / fusou-workflow が見当たらない
- **原因:** wrangler.toml の `[[queues.consumers]]` 設定が正しくない or デプロイが不完全
- **対策:**
  1. `packages/FUSOU-WORKFLOW/wrangler.toml` を確認
     ```toml
     [[queues.consumers]]
     queue = "dev-kc-compaction-queue"
     max_batch_size = 10
     max_batch_timeout = 30
     max_retries = 3
     dead_letter_queue = "dev-kc-compaction-dlq"
     ```
  2. 再デプロイ: `npm run deploy`
  3. キャッシュをクリアして再確認

---

### Step 4: FUSOU-WORKFLOWのログを確認

```
Cloudflare Dashboard → Workers → fusou-workflow → Logs
```

**フィルター:** 過去1時間、"Queue Consumer" で検索

**正常ログの例:**
```json
{
  "message": "[Queue Router] Received batch",
  "batchSize": 5,
  "queueName": "dev-kc-compaction-queue",
  "timestamp": "2025-12-18T12:30:00Z"
}

{
  "message": "[Queue Consumer] Processing message",
  "datasetId": "dataset_001",
  "messageId": "msg_123",
  "timestamp": "2025-12-18T12:30:01Z"
}

{
  "message": "[Queue Consumer] Workflow dispatched successfully",
  "workflowInstanceId": "workflow_456",
  "timestamp": "2025-12-18T12:30:02Z"
}
```

**異常ログの例と対策:**

| ログ内容 | 原因 | 対策 |
|---------|------|------|
| `[Queue Router] Received batch` が表示されない | キューがポーリングされていない | 消費者登録の問題 → Step 3を再確認 |
| `Missing required field: datasetId` | メッセージ形式が不正 | FUSOU-WEB の送信側を確認 |
| `Workflow dispatch failed: ERROR` | DATA_COMPACTION バインディング問題 | wrangler.toml の `DATA_COMPACTION` バインディングを確認 |
| `Cannot find module '@supabase/supabase-js'` | 依存関係の欠落 | `npm install` → `npm run deploy` |

---

### Step 5: メッセージ形式を確認

期待される形式:

```json
{
  "datasetId": "string (required)",
  "triggeredAt": "2025-12-18T12:30:00Z (required)",
  "priority": "realtime|manual|scheduled (optional)",
  "metricId": "uuid (optional)",
  "table": "string (optional)",
  "periodTag": "YYYY-MM-DD (optional)"
}
```

FUSOU-WEB 側で送信時に検証:
- `compact.ts` L306 - Compaction queue send
- `battle_data.ts` L254 - Battle data queue send

---

## デバッグログの有効化

既に詳細ログを実装済み。以下を確認:

```typescript
// packages/FUSOU-WORKFLOW/src/index.ts

// Queue Router (L762-777)
console.info('[Queue Router] Received batch', {...})
console.info('[Queue Router] Routing to ...')

// Queue Consumer (L804-867)
console.info('[Queue Consumer] ===== BATCH START =====', {...})
console.info('[Queue Consumer] Processing message', {...})
console.info('[Queue Consumer] Workflow dispatched successfully', {...})
console.error('[Queue Consumer] Message processing failed', {...})
```

---

## よくある問題と解決策

### 問題A: キューは存在しているが消費者が登録されていない

```bash
# 解決策
cd packages/FUSOU-WORKFLOW
npm run deploy
```

その後、Cloudflare Dashboard で Consumers リストを更新(ページをリロード)

---

### 問題B: メッセージがキューに到達していない

FUSOU-WEB のログを確認:

```
POST /api/battle-data/upload
```

成功ログ: `[battle-data] Successfully enqueued to COMPACTION_QUEUE`
失敗ログ: `[battle-data] FAILED to enqueue to COMPACTION_QUEUE` → エラー内容を確認

**対策:**
1. FUSOU-WEB の `wrangler.toml` で `COMPACTION_QUEUE` バインディングが存在するか確認
   ```toml
   [[queues.producers]]
   queue = "dev-kc-compaction-queue"
   binding = "COMPACTION_QUEUE"
   ```

2. FUSOU-WEB を再デプロイ

---

### 問題C: ワークフローが始まらない

ログで以下を確認:

```
[Queue Consumer] Workflow dispatched successfully
```

このログが表示されているが、実際のワークフロー処理が開始されていない場合:

1. `env.DATA_COMPACTION` バインディングが正しいか確認
   ```toml
   [workflows]
   name = "data-compaction-workflow"
   binding = "DATA_COMPACTION"
   class_name = "DataCompactionWorkflow"
   ```

2. `DataCompactionWorkflow` クラスが正しくエクスポートされているか確認
   ```typescript
   export class DataCompactionWorkflow extends WorkflowEntrypoint<Env, CompactionParams> {
     async run(event: any, step: WorkflowStep) {
       // ...
     }
   }
   ```

---

## デプロイメントチェックリスト

```
[ ] FUSOU-WORKFLOW が Cloudflare にデプロイされている
[ ] Cloudflare Dashboard → Queues → Consumers に "fusou-workflow" が表示
[ ] 最新のログに "[Queue Consumer]" メッセージが表示
[ ] FUSOU-WEB が正常にメッセージをキューに送信している
[ ] メッセージ形式が期待形式と一致している
```

---

## 次のステップ

1. ログを確認して問題を特定
2. 上記の手順に従って対策を実行
3. Cloudflare Dashboard で再確認
4. 仍に解決しない場合は、ログの完全な出力を記録

---

## 参考

- [QUEUE_CONSUMER_MIGRATION.md](./QUEUE_CONSUMER_MIGRATION.md) - アーキテクチャ概要
- [FLOW_ANALYSIS_AND_BUGS.md](./FLOW_ANALYSIS_AND_BUGS.md) - フロー分析
