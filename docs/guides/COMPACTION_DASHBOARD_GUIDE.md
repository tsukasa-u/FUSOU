# Compaction Dashboard 使用ガイド

## 概要

Queue-based Parquet Compaction システムのリアルタイム監視ダッシュボード。

## アクセス方法

```
https://your-domain.pages.dev/dashboard/compaction
```

## セットアップ

### 1. Supabase Functions を作成

```bash
cd /home/ogu-h/Documents/GitHub/FUSOU
psql "$SUPABASE_DB_URL" -f docs/sql/compaction_dashboard_functions.sql
```

作成される関数:
- `get_compaction_status_summary()` - ステータス集計（24時間）
- `get_compression_performance()` - 圧縮パフォーマンス（7日間）
- `get_dlq_alerts()` - DLQ 重大アラート（最新20件）

### 2. ダッシュボードの確認

ブラウザで `/dashboard/compaction` にアクセスすると、以下が表示されます：

**リアルタイムカード:**
- 🟡 Pending: Queue 待機中
- 🟢 Success: 成功（24時間以内）
- 🔴 Failures: 失敗
- 🟠 DLQ: Dead Letter Queue（要対応）

**グラフ:**
- Status Distribution（円グラフ）
- Hourly Performance（折れ線グラフ）

**アラート:**
- DLQ Failures（重大エラー一覧）
- Error Analysis（エラーステップ別集計）

## 監視すべきメトリクス

### 🚨 緊急対応が必要

**DLQ count > 0**
```sql
-- 原因調査
SELECT dataset_id, error_step, error_message, created_at
FROM processing_metrics
WHERE status = 'dlq_failure'
ORDER BY created_at DESC
LIMIT 10;
```

対応:
1. エラーメッセージを確認
2. 該当 dataset の状態をチェック
3. `compaction_in_progress` フラグがリセットされているか確認
4. 必要に応じて手動で再試行

### ⚠️ 注意が必要

**Failure rate > 10%**
```sql
-- 失敗率計算
SELECT 
  COUNT(CASE WHEN status = 'failure' THEN 1 END)::float / COUNT(*) * 100 as failure_rate
FROM processing_metrics
WHERE created_at > NOW() - INTERVAL '1 hour';
```

考えられる原因:
- Supabase rate limiting（Free tier）
- R2 一時的な問題
- ネットワーク不安定

**Average duration > 30秒**
```sql
-- 平均処理時間
SELECT ROUND(AVG(workflow_total_duration_ms) / 1000, 2) as avg_seconds
FROM processing_metrics
WHERE status = 'success'
  AND created_at > NOW() - INTERVAL '1 hour';
```

考えられる原因:
- Supabase クエリ遅延（retry 増加）
- R2 読み書き遅延
- ファイルサイズ増加

### 📊 パフォーマンス指標

**圧縮率の推移**
```sql
SELECT * FROM get_compression_performance();
```

期待値:
- `avg_compression_ratio`: 15-30%（Parquet + ZSTD）
- `space_saved_percentage`: 70-85%

**処理スループット**
```sql
SELECT 
  COUNT(*) as processed,
  COUNT(CASE WHEN status = 'success' THEN 1 END) as succeeded
FROM processing_metrics
WHERE created_at > NOW() - INTERVAL '1 hour';
```

目安:
- 通常時: 10-50 jobs/hour
- ピーク時: 100+ jobs/hour

## トラブルシューティング

### ダッシュボードが表示されない

**症状:** 白い画面 or エラーメッセージ

**原因1:** Supabase Functions が作成されていない
```bash
# Functions 存在確認
psql "$SUPABASE_DB_URL" -c "\df get_compaction_status_summary"

# 作成されていなければ実行
psql "$SUPABASE_DB_URL" -f docs/sql/compaction_dashboard_functions.sql
```

**原因2:** RLS ポリシー問題
```sql
-- Functions への権限確認
SELECT routine_name, routine_schema 
FROM information_schema.routines 
WHERE routine_name LIKE 'get_compaction%';
```

### データが表示されない

**症状:** "Loading..." のまま

**確認1:** API エンドポイント
```bash
curl https://your-domain.pages.dev/analytics/compaction-metrics
```

**確認2:** Supabase 接続
```bash
# Supabase URL と Secret Key が設定されているか
wrangler pages deployment tail --project-name=fusou-web
```

**確認3:** processing_metrics テーブル
```sql
SELECT COUNT(*) FROM processing_metrics;
```

### グラフが表示されない

**症状:** カードは表示されるが、グラフが空

**原因:** Chart.js が CDN からロードされていない

確認:
1. ブラウザの開発者ツール (F12) → Console
2. `Chart is not defined` エラーがないか確認
3. ネットワークタブで `chart.js` のロード確認

## API エンドポイント

### GET /analytics/compaction-metrics

**レスポンス:**
```json
{
  "status_distribution": [
    { "status": "success", "count": 150, "avg_duration_ms": 8500 },
    { "status": "pending", "count": 5, "avg_duration_ms": 0 },
    { "status": "failure", "count": 2, "avg_duration_ms": 12000 }
  ],
  "hourly_performance": [
    {
      "hour": "2025-12-17T10:00:00.000Z",
      "total_count": 45,
      "success_count": 43,
      "failure_count": 2,
      "avg_consumer_duration_ms": 3200,
      "avg_compression_ratio": 22.5,
      "avg_original_size_bytes": 5242880
    }
  ],
  "error_analysis": [
    {
      "error_step": "compact-rows",
      "error_count": 8,
      "latest_error_at": "2025-12-17T11:30:00.000Z"
    }
  ],
  "dlq_failures": [
    {
      "dataset_id": "uuid-here",
      "error_message": "Supabase rate limit exceeded",
      "error_step": "validate-dataset",
      "created_at": "2025-12-17T11:45:00.000Z"
    }
  ],
  "timestamp": "2025-12-17T12:00:00.000Z"
}
```

**キャッシュ:** 60秒

## 自動更新

ダッシュボードは **30秒ごと** に自動更新されます。

手動更新: ブラウザリロード (F5)

## アラート通知（今後の拡張）

現在は手動監視のみですが、将来的に以下を検討:

1. **Cloudflare Workers Cron**
   - DLQ count > 0 で Slack/Email 通知
   
2. **Supabase Edge Functions**
   - `processing_metrics` INSERT トリガー
   - `status = 'dlq_failure'` で webhook 発火

3. **Grafana/Prometheus**
   - Supabase PostgreSQL Exporter
   - カスタムアラートルール

## 関連ドキュメント

- [Compaction Workflow Design](../COMPACTION_DESIGN_AND_OPERATIONS.md)
- [Deployment Checklist](../DEPLOYMENT_CHECKLIST.md)
- [SQL Functions](../sql/compaction_dashboard_functions.sql)
