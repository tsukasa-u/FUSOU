import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/dlq-status
 * 
 * Lightweight DLQ monitoring endpoint
 * Returns recent DLQ messages and queue depth summary
 * 
 * Response: {
 *   dlq_recent_count: number,
 *   dlq_messages: Array<{ dataset_id, error_message, timestamp }>,
 *   processing_summary: { total_pending, total_failed, total_success }
 * }
 */
export const GET: APIRoute = async ({ locals }) => {
  try {
    // === Admin Authentication Check ===
    if (!locals.user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // TODO: Add role-based access control (admin only)
    // For now, any authenticated user can access

    const env = locals.runtime.env;
    const supabaseUrl = env.PUBLIC_SUPABASE_URL as string;
    const supabaseKey = env.SUPABASE_SECRET_KEY as string;

    if (!supabaseUrl || !supabaseKey) {
      return new Response(
        JSON.stringify({ error: 'Supabase not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // === Fetch recent DLQ entries (past 24 hours) ===
    const { data: dlqMessages = [], error: dlqError } = await supabase
      .from('processing_metrics')
      .select('dataset_id, error_message, created_at')
      .eq('status', 'dlq')
      .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(20);

    if (dlqError) {
      console.error('[DLQ API] DLQ fetch failed:', dlqError.message);
      return new Response(
        JSON.stringify({ error: `Failed to fetch DLQ: ${dlqError.message}` }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // === Fetch processing summary ===
    const { data: summary = [] } = await supabase
      .from('processing_metrics')
      .select('status')
      .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString());

    const summaryCount = {
      total_pending: summary.filter((s) => s.status === 'pending').length,
      total_success: summary.filter((s) => s.status === 'success').length,
      total_failed: summary.filter((s) => s.status === 'failure').length,
      total_dlq: summary.filter((s) => s.status === 'dlq').length,
    };

    console.info('[DLQ API] Status check completed', {
      dlq_count: dlqMessages.length,
      summary: summaryCount,
      timestamp: new Date().toISOString(),
    });

    return new Response(
      JSON.stringify({
        dlq_recent_count: dlqMessages.length,
        dlq_messages: dlqMessages.map((m) => ({
          dataset_id: m.dataset_id,
          error_message: m.error_message,
          timestamp: m.created_at,
        })),
        processing_summary: summaryCount,
        last_updated: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    const errorMessage = String(error);

    console.error('[DLQ API] Error', {
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });

    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
