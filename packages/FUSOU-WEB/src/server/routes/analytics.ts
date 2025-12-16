import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import type { Bindings } from '../types';
import { CORS_HEADERS } from '../constants';

const app = new Hono<{ Bindings: Bindings }>();

// CORS preflight
app.options('*', (_c) => new Response(null, { status: 204, headers: CORS_HEADERS }));

// GET /analytics/compaction-metrics
app.get('/compaction-metrics', async (c) => {
  const env = c.env;
  const supabase = createClient(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false },
  });

  try {
    // Status distribution (via SQL function if available)
    const { data: statusData, error: statusError } = await supabase
      .rpc('get_compaction_status_summary');
    if (statusError) throw statusError;

    // Hourly performance (last 24h)
    const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: hourlyData, error: hourlyError } = await supabase
      .from('processing_metrics')
      .select('created_at, status, consumer_total_duration_ms, workflow_total_duration_ms, compression_ratio, original_size_bytes')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false });
    if (hourlyError) throw hourlyError;

    const hourlyMap = new Map<string, any>();
    (hourlyData || []).forEach((row) => {
      const hour = new Date(row.created_at).toISOString().slice(0, 13) + ':00:00.000Z';
      if (!hourlyMap.has(hour)) {
        hourlyMap.set(hour, {
          hour,
          total_count: 0,
          success_count: 0,
          failure_count: 0,
          durations: [],
          compressions: [],
          sizes: [],
        });
      }
      const slot = hourlyMap.get(hour);
      slot.total_count++;
      if (row.status === 'success') slot.success_count++;
      if (row.status === 'failure') slot.failure_count++;
      if (row.consumer_total_duration_ms) slot.durations.push(row.consumer_total_duration_ms);
      if (row.compression_ratio) slot.compressions.push(row.compression_ratio);
      if (row.original_size_bytes) slot.sizes.push(row.original_size_bytes);
    });

    const processedHourly = Array.from(hourlyMap.values()).map((h) => ({
      hour: h.hour,
      total_count: h.total_count,
      success_count: h.success_count,
      failure_count: h.failure_count,
      avg_consumer_duration_ms: h.durations.length > 0
        ? Math.round(h.durations.reduce((a: number, b: number) => a + b, 0) / h.durations.length)
        : 0,
      avg_compression_ratio: h.compressions.length > 0
        ? Math.round((h.compressions.reduce((a: number, b: number) => a + b, 0) / h.compressions.length) * 100) / 100
        : 0,
      avg_original_size_bytes: h.sizes.length > 0
        ? Math.round(h.sizes.reduce((a: number, b: number) => a + b, 0) / h.sizes.length)
        : 0,
    }));

    // Error analysis (top 10)
    const { data: errorRows, error: errorErr } = await supabase
      .from('processing_metrics')
      .select('error_step, error_message, created_at')
      .eq('status', 'failure')
      .order('created_at', { ascending: false })
      .limit(100);
    if (errorErr) throw errorErr;

    const errorMap = new Map<string, any>();
    (errorRows || []).forEach((row) => {
      const step = row.error_step || 'unknown';
      if (!errorMap.has(step)) {
        errorMap.set(step, { error_step: step, error_count: 0, latest_error_at: row.created_at });
      }
      const agg = errorMap.get(step);
      agg.error_count++;
      if (new Date(row.created_at) > new Date(agg.latest_error_at)) agg.latest_error_at = row.created_at;
    });
    const processedErrors = Array.from(errorMap.values())
      .sort((a, b) => b.error_count - a.error_count)
      .slice(0, 10);

    // DLQ failures (recent)
    const { data: dlqRows, error: dlqErr } = await supabase
      .from('processing_metrics')
      .select('dataset_id, error_message, error_step, created_at')
      .eq('status', 'dlq_failure')
      .order('created_at', { ascending: false })
      .limit(10);
    if (dlqErr) throw dlqErr;

    return c.json({
      status_distribution: statusData,
      hourly_performance: processedHourly,
      error_analysis: processedErrors,
      dlq_failures: dlqRows,
      timestamp: new Date().toISOString(),
    }, 200, {
      ...CORS_HEADERS,
      'Cache-Control': 'public, max-age=60',
    });
  } catch (error) {
    console.error('[Analytics API] Error:', error);
    return c.json({ error: 'Failed to fetch metrics' }, 500, CORS_HEADERS);
  }
});

export default app;
