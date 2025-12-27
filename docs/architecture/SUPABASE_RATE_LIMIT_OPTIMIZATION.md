# Supabase Free Tier 最適化ガイド

## 概要

Supabase Free プランで運用する場合、**shared infrastructure** 上で動作するため、リソース効率を最大化する必要があります。本ドキュメントでは、Queue ベースの Parquet 圧縮システムに対して実装した最適化を説明します。

## Free プラン の制限

| 項目 | Free | Pro |
|------|------|-----|
| データベース容量 | 500 MB | 8 GB |
| インフラ | Shared | Dedicated |
| 接続数制限 | なし | あり（PgBouncer 接続プール） |
| Rate Limiting | あり | あり |
| レイテンシ | 可変 | 低遅延保証 |

**Free での推奨**: 接続プール、バッチ処理、リトライロジックで負荷を平準化

---

## 実装した3つの最適化

### 1️⃣ リトライロジック（指数バックオフ）

**目的**: 一時的な rate limit エラーに対応

**実装**:
```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isRateLimitError = 
        (error as any)?.message?.includes('429') ||
        (error as any)?.status === 429;

      if (!isRateLimitError || attempt === maxRetries - 1) throw error;

      const delay = baseDelay * Math.pow(2, attempt); // 1s, 2s, 4s
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

**使用例**:
```typescript
const insertResult = await withRetry(async () => {
  const result = await supabase.from('datasets').insert(...).select();
  if (result.error) throw result.error;
  return result;
});
```

**効果**:
- 429 エラーで最大3回再試行
- 指数バックオフで Supabase のキャパシティ回復を待つ
- Cloudflare Workers の自動リトライと組み合わせ

---

### 2️⃣ バッチメトリクス挿入

**目的**: `/trigger-scheduled` で複数 dataset を処理する際、クエリ数を最小化

**最適化前**（10 datasets の場合）:
```
Query 1: SELECT datasets WHERE compaction_needed=true (10件取得)
Query 2-11: INSERT processing_metrics (各dataset ごと)
→ 合計 11 クエリ
```

**最適化後**:
```typescript
// 1つのバッチで全メトリクス作成
const metricsPayload = datasets.map((d) => ({
  dataset_id: d.id,
  workflow_instance_id: `scheduled-${Date.now()}-${d.id}`,
  status: 'pending',
  queued_at: new Date().toISOString(),
}));

const metricsInsertResult = await withRetry(async () => {
  const result = await supabase
    .from('processing_metrics')
    .insert(metricsPayload)        // ← バッチ挿入
    .select('id, dataset_id');
  
  if (result.error) throw result.error;
  return result;
});
```

**効果**:
- `INSERT` クエリを 10 → 1 に削減
- 同一トランザクション内で一括処理
- Supabase の負荷を平準化

---

### 3️⃣ 統一されたリトライ設定（Workflow）

**目的**: Workflow のすべてのステップに一貫性のあるリトライポリシーを適用

**実装**:
```typescript
// Standard retry config for Supabase operations
const SUPABASE_RETRY_CONFIG = {
  limit: 3,
  delay: '2 seconds',
  backoff: 'exponential' as const,
};

// Step 1: Validate Dataset
const validation = await step.do('validate-dataset', {
  retries: SUPABASE_RETRY_CONFIG  // ← 統一設定
}, async () => {
  // ... Supabase operation
});

// Step 2: Set in-progress flag
await step.do('set-in-progress-flag', {
  retries: SUPABASE_RETRY_CONFIG  // ← 統一設定
}, async () => {
  // ... Supabase operation
});
```

**効果**:
- Workflow の各ステップで一貫したリトライ戦略
- 設定の一元管理でメンテナンス性向上
- Supabase Free 特有の rate limiting に対応

---

## 現在のアクセスパターン分析

### スケジュール起動（1日1回, 02:00 UTC）

```
1. SELECT datasets (compaction_needed=true, compaction_in_progress=false)
   ↓
2. BATCH INSERT processing_metrics (N records)    ← 最適化
   ↓
3. QUEUE SEND (N messages)
   ↓
4. Workflow Step 1: SELECT datasets (validation)
5. Workflow Step 2: UPDATE datasets (set flag)
6. Workflow Step 3: COMPACT (R2 read, no DB)
7. Workflow Step 4: UPDATE datasets (metrics)

推定負荷: ~20-25 クエリ（N datasets = 10の場合）
```

### リアルタイムアップロード

```
1. R2 PUT file
2. INSERT datasets
3. INSERT processing_metrics  ← with retry
4. QUEUE SEND
5. Workflow（同上）

推定負荷: ~4-5 クエリ/upload
```

### 監視エンドポイント

```
GET /dlq-status:
1. SELECT processing_metrics (status='failure')

推定負荷: ~1 クエリ/check
```

---

## トラブルシューティング

### 症状: 「429 Too Many Requests」エラー

**原因**: 
- バッチ処理がなく、各dataset で個別にクエリ
- リトライなし

**対策**:
1. バッチメトリクス挿入を確認（`trigger-scheduled` で 1 INSERT のみ）
2. リトライロジック のログを確認
3. `/dlq-status` で失敗原因を特定

```bash
# ログ確認
curl https://$PAGES_DOMAIN/api/compaction/dlq-status | jq '.failures[] | {error_message, error_step}'
```

### 症状: Workflow が頻繁にタイムアウト

**原因**:
- Supabase リクエスト が slow
- Shared infrastructure の過負荷

**対策**:
1. `trigger-scheduled` を 02:00 UTC（夜間）に設定済み ✅
2. リトライ config で delay を増加
   ```typescript
   delay: '5 seconds'  // 2 秒 → 5 秒に増加
   ```
3. `limit` を 2 に削減（リトライ回数）
   ```typescript
   limit: 2  // Fast fail pattern
   ```

---

## Supabase Pro へのアップグレード判定基準

以下の場合、Pro への移行を検討：

- **接続数エラー**: 同時実行 Workflow が 10 以上
- **Rate limit**: 1秒あたり 100+ クエリ
- **レイテンシ**: 平均 500ms 以上

**Pro のメリット**:
- PgBouncer 接続プール（最大同時接続数を増加）
- Dedicated infrastructure（リソース保証）
- Connection pooling（コスト削減）

---

## モニタリング

### ダッシュボード

Supabase Dashboard → Analytics でリアルタイムモニタリング:

1. **Database**: Query 実行数、遅延時間
2. **Auth**: Session 数
3. **Storage**: R2 のバイト転送量

### 処理メトリクスのクエリ

```sql
-- 過去24時間の処理統計
SELECT
  DATE_TRUNC('hour', created_at) AS hour,
  status,
  COUNT(*) as count,
  AVG(EXTRACT(EPOCH FROM (completed_at - queued_at))) as avg_duration_sec
FROM processing_metrics
WHERE created_at > now() - interval '24 hours'
GROUP BY hour, status
ORDER BY hour DESC;

-- 失敗原因の分析
SELECT
  error_step,
  error_message,
  COUNT(*) as count
FROM processing_metrics
WHERE status = 'failure'
  AND created_at > now() - interval '7 days'
GROUP BY error_step, error_message
ORDER BY count DESC;
```

---

## ベストプラクティス

| 項目 | 推奨値 | 理由 |
|------|--------|------|
| Batch Insert Size | 10-50 records | Supabase Free では 50+ で遅延増加 |
| Retry Max Attempts | 3 | Exponential backoff: 1s, 2s, 4s |
| Retry Delay | 2 秒（初回） | Free tier の recover time |
| Concurrent Workflows | ≤ 5 | Shared infrastructure の負荷制限 |
| scheduled trigger時間 | 02:00 UTC | ユーザーオフピーク時間 |

---

## 関連ファイル

- `/packages/FUSOU-WEB/src/server/routes/compact.ts` - `withRetry()` 実装
- `/packages/FUSOU-WORKFLOW/src/index.ts` - `SUPABASE_RETRY_CONFIG` 定義
- `/docs/sql/20251216_add_compaction_tables.sql` - RLS ポリシー設定

---

## デプロイメント チェックリスト

- [ ] `withRetry()` が全エンドポイントで使用されている
- [ ] `/trigger-scheduled` でバッチ挿入を確認
- [ ] Workflow のリトライ設定が統一されている（SUPABASE_RETRY_CONFIG）
- [ ] GitHub Actions cron が 02:00 UTC に設定
- [ ] DLQ モニタリング (`/dlq-status`) が動作
- [ ] 処理メトリクスダッシュボードで成功率 ≥ 99% を確認

---

**Last Updated**: 2025-12-17  
**Status**: ✅ Production Ready for Free Tier
