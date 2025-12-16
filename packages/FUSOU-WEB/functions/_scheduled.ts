import { createClient } from '@supabase/supabase-js';

type ScheduledHandler = (event: any, env: any, ctx: any) => Promise<void>;

const MAX_DATASETS_PER_RUN = Number(process.env.MAX_DATASETS_PER_RUN || 10);

async function fetchPendingDatasets(
  supabase: any,
  limit: number
): Promise<Array<{ id: string }>> {
  const { data, error } = await supabase
    .from('datasets')
    .select('id')
    .eq('compaction_needed', true)
    .eq('compaction_in_progress', false)
    .order('updated_at', { ascending: true })
    .limit(limit);

  if (error) throw new Error(`Supabase fetch failed: ${error.message}`);
  return data || [];
}

async function enqueueDataset(
  datasetId: string,
  compactionQueue: Queue
): Promise<void> {
  try {
    console.log(`[Scheduled] Enqueuing dataset: ${datasetId}`);

    // Queue に Message を送信（consumer が受け取って Workflow を実行）
    await compactionQueue.send({
      datasetId: datasetId,
      triggeredAt: new Date().toISOString(),
      priority: 'scheduled',
    });

    console.log(`[Scheduled] Enqueued: ${datasetId}`);
  } catch (error) {
    console.error(`[Scheduled] Failed to enqueue: ${datasetId}`, error);
    throw error;
  }
}

export const scheduled: ScheduledHandler = async (event, env, ctx) => {
  const supabaseUrl = env.PUBLIC_SUPABASE_URL as string;
  const supabaseKey = env.SUPABASE_SECRET_KEY as string;
  const compactionQueue = env.COMPACTION_QUEUE as Queue;

  if (!supabaseUrl || !supabaseKey || !compactionQueue) {
    console.log('[Scheduled] Missing environment configuration');
    return;
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch datasets needing compaction
    const datasets = await fetchPendingDatasets(supabase, MAX_DATASETS_PER_RUN);
    if (datasets.length === 0) {
      console.log('[Scheduled] No pending datasets');
      return;
    }

    console.log(`[Scheduled] Enqueuing ${datasets.length} datasets to compaction queue`);

    // Queue に各データセットを投入（並列処理）
    const enqueuePromises = datasets.map(dataset =>
      enqueueDataset(dataset.id, compactionQueue)
    );

    await Promise.all(enqueuePromises);

    console.log(`[Scheduled] Successfully enqueued ${datasets.length} datasets`);
  } catch (error) {
    console.error('[Scheduled] Fatal error:', error);
    throw error;
  }
};
