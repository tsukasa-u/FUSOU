import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

/**
 * POST /api/compaction/sanitize-state
 * 
 * Periodic maintenance job to:
 * - Reset `compaction_in_progress` flags stuck for >30 minutes
 * - Mark stale metrics as timeout
 * - Requeue datasets that timed out
 * 
 * Should be called by a cron job or manually via webhook
 */
export const POST: APIRoute = async ({ locals, request }) => {
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
    const compactionQueue = env.COMPACTION_QUEUE as Queue;

    if (!supabaseUrl || !supabaseKey) {
      return new Response(
        JSON.stringify({ error: 'Supabase not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // === Find datasets stuck in progress for >30 minutes ===
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    const { data: stuckDatasets, error: selectError } = await supabase
      .from('datasets')
      .select('id, compaction_in_progress')
      .eq('compaction_in_progress', true)
      .lt('updated_at', thirtyMinutesAgo);

    if (selectError) {
      throw new Error(`Failed to fetch stuck datasets: ${selectError.message}`);
    }

    console.info(`[Sanitize] Found ${stuckDatasets?.length || 0} stuck datasets`, {
      threshold: thirtyMinutesAgo,
      timestamp: new Date().toISOString(),
    });

    const resetIds: string[] = [];
    const requeueIds: string[] = [];

    // === Process each stuck dataset ===
    for (const dataset of stuckDatasets || []) {
      try {
        // Check if workflow actually completed
        const { data: metrics, error: metricsError } = await supabase
          .from('processing_metrics')
          .select('id, status, workflow_completed_at')
          .eq('dataset_id', dataset.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (metrics?.status === 'success' || metrics?.status === 'failure') {
          // Workflow completed but flag wasn't reset - just reset the flag
          await supabase
            .from('datasets')
            .update({ compaction_in_progress: false })
            .eq('id', dataset.id);

          resetIds.push(dataset.id);
          console.info(`[Sanitize] Reset flag for ${dataset.id} (workflow completed)`);
        } else {
          // Workflow didn't complete or no metrics found - mark as timeout and requeue
          await supabase
            .from('datasets')
            .update({
              compaction_in_progress: false,
              compaction_needed: true, // Mark for retry
            })
            .eq('id', dataset.id);

          await supabase
            .from('processing_metrics')
            .insert({
              dataset_id: dataset.id,
              workflow_instance_id: `timeout-${Date.now()}`,
              status: 'timeout',
              queued_at: new Date().toISOString(),
              error_message: 'Workflow timeout after 30 minutes',
              error_step: 'workflow_execution',
            });

          if (compactionQueue) {
            await compactionQueue.send({
              datasetId: dataset.id,
              triggeredAt: new Date().toISOString(),
              priority: 'realtime',
            });
          }

          requeueIds.push(dataset.id);
          console.info(`[Sanitize] Timeout + requeue for ${dataset.id}`);
        }
      } catch (error) {
        console.error(`[Sanitize] Error processing ${dataset.id}`, {
          error: String(error),
        });
      }
    }

    console.info(`[Sanitize] Completed`, {
      reset_count: resetIds.length,
      requeue_count: requeueIds.length,
      reset_ids: resetIds,
      requeue_ids: requeueIds,
      timestamp: new Date().toISOString(),
    });

    return new Response(
      JSON.stringify({
        success: true,
        reset_count: resetIds.length,
        requeue_count: requeueIds.length,
        details: {
          reset_ids: resetIds,
          requeue_ids: requeueIds,
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    const errorMessage = String(error);

    console.error('[Sanitize] Error', {
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
