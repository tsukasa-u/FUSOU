# D1-based Analytics API

Endpoint: /analytics/compaction-metrics

Response shape:

- status_distribution: [{ status: 'pending'|'success'|'failure'|'dlq_failure', count: number }]
- hourly_performance: [{ hour: string, success_count: number, failure_count: number }]
- dlq_failures: [{ dataset_id: string, error_step?: string|null, error_message?: string|null, created_at: string }]
- timestamp: ISO8601 string

Data sources:

- pending: D1 `datasets` (`compaction_needed = 1`)
- success/failure: D1 `compaction_metrics` in the last 24 hours
- dlq_failures: latest 10 rows from `compaction_metrics` with `status = 'failure'` (approximation)
- hourly_performance: buckets by `created_at` hour from `compaction_metrics` in the last 24 hours

Notes:

- This API is read-only and uses `BATTLE_INDEX_DB`.
- Ensure the `compaction_metrics` table exists per `docs/sql/d1/compaction_metrics.sql`.
