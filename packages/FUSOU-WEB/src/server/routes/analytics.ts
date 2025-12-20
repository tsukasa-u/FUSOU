import { Hono } from 'hono';
import type { Bindings } from '../types';

const app = new Hono<{ Bindings: Bindings }>();

app.get('/compaction-metrics', async (c) => {
  const db = c.env.BATTLE_INDEX_DB;
  if (!db) {
    return c.json({ error: 'Server misconfiguration: BATTLE_INDEX_DB binding missing' }, 500);
  }

  // Pending count from datasets
  const pendingRow = await db
    .prepare('SELECT COUNT(1) AS cnt FROM datasets WHERE compaction_needed = 1')
    .first?.();
  const pendingCount = Number((pendingRow as any)?.cnt ?? 0);

  // Success/failure distribution in last 24 hours
  const distRows = await db
    .prepare(
      "SELECT status, COUNT(1) AS cnt FROM compaction_metrics WHERE created_at >= datetime('now','-1 day') GROUP BY status"
    )
    .all?.();
  const distMap: Record<string, number> = {};
  for (const r of (distRows?.results ?? [])) {
    const status = String((r as any).status ?? '');
    const cnt = Number((r as any).cnt ?? 0);
    distMap[status] = cnt;
  }
  const successCount = distMap['success'] ?? 0;
  const failureCount = distMap['failure'] ?? 0;

  // DLQ failures (approximate using recent failures list)
  const dlqRows = await db
    .prepare(
      'SELECT dataset_id, error_step, error_message, created_at FROM compaction_metrics WHERE status = "failure" ORDER BY created_at DESC LIMIT 10'
    )
    .all?.();
  const dlqFailures = (dlqRows?.results ?? []).map((r) => ({
    dataset_id: String((r as any).dataset_id ?? ''),
    error_step: (r as any).error_step ?? null,
    error_message: (r as any).error_message ?? null,
    created_at: (r as any).created_at,
  }));
  const dlqCount = dlqFailures.length;

  // Hourly performance buckets (recent hours present in metrics)
  const perfRows = await db
    .prepare(
      "SELECT strftime('%Y-%m-%dT%H:00:00Z', created_at) AS hour, SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success_count, SUM(CASE WHEN status='failure' THEN 1 ELSE 0 END) AS failure_count FROM compaction_metrics WHERE created_at >= datetime('now','-1 day') GROUP BY hour ORDER BY hour DESC LIMIT 12"
    )
    .all?.();
  const hourlyPerformance = (perfRows?.results ?? []).map((r) => ({
    hour: (r as any).hour,
    success_count: Number((r as any).success_count ?? 0),
    failure_count: Number((r as any).failure_count ?? 0),
  }));

  // Error analysis: top steps causing failures
  const errRows = await db
    .prepare(
      "SELECT error_step, COUNT(1) AS error_count, MAX(created_at) AS latest_error_at FROM compaction_metrics WHERE status = 'failure' AND error_step IS NOT NULL GROUP BY error_step ORDER BY error_count DESC LIMIT 10"
    )
    .all?.();
  const errorAnalysis = (errRows?.results ?? []).map((r) => ({
    error_step: (r as any).error_step,
    error_count: Number((r as any).error_count ?? 0),
    latest_error_at: (r as any).latest_error_at,
  }));

  const statusDistribution = [
    { status: 'pending', count: pendingCount },
    { status: 'success', count: successCount },
    { status: 'failure', count: failureCount },
    { status: 'dlq_failure', count: dlqCount },
  ];

  return c.json({
    status_distribution: statusDistribution,
    hourly_performance: hourlyPerformance,
    dlq_failures: dlqFailures,
    error_analysis: errorAnalysis,
    timestamp: new Date().toISOString(),
  });
});

export default app;
