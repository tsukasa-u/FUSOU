import type { Bindings, D1Database } from "../src/server/types";

type ScheduledHandler = (event: any, env: Bindings, ctx: any) => Promise<void>;

const MAX_DATASETS_PER_RUN = Number(process.env.MAX_DATASETS_PER_RUN || 10);

async function fetchPendingDatasets(
  db: D1Database,
  limit: number
): Promise<Array<{ id: string; user_id: string }>> {
  const res = await db
    .prepare(
      `SELECT id, user_id
       FROM datasets
       WHERE compaction_needed = 1 AND compaction_in_progress = 0
       ORDER BY updated_at ASC
       LIMIT ?`
    )
    .bind(limit)
    .all?.();

  const rows = (res?.results || []) as Array<{ id: string; user_id: string }>;
  return rows;
}

async function enqueueDataset(
  datasetId: string,
  userId: string,
  compactionQueue: any
): Promise<void> {
  try {
    console.log(`[Scheduled] Enqueuing dataset: ${datasetId}`);

    await compactionQueue.send({
      datasetId: datasetId,
      triggeredAt: new Date().toISOString(),
      priority: "scheduled",
      userId: userId,
    });

    console.log(`[Scheduled] Enqueued: ${datasetId}`);
  } catch (error) {
    console.error(`[Scheduled] Failed to enqueue: ${datasetId}`, error);
    throw error;
  }
}

export const scheduled: ScheduledHandler = async (event, env, ctx) => {
  const db = env.BATTLE_INDEX_DB as unknown as D1Database | undefined;
  const compactionQueue = env.COMPACTION_QUEUE as any;

  if (!db || !compactionQueue) {
    console.log("[Scheduled] Missing environment configuration (D1 or Queue)");
    return;
  }

  try {
    const datasets = await fetchPendingDatasets(db, MAX_DATASETS_PER_RUN);
    if (datasets.length === 0) {
      console.log("[Scheduled] No pending datasets");
      return;
    }

    console.log(
      `[Scheduled] Enqueuing ${datasets.length} datasets to compaction queue`
    );

    const enqueuePromises = datasets.map((dataset) =>
      enqueueDataset(dataset.id, dataset.user_id, compactionQueue)
    );

    await Promise.all(enqueuePromises);

    console.log(
      `[Scheduled] Successfully enqueued ${datasets.length} datasets`
    );
  } catch (error) {
    console.error("[Scheduled] Fatal error:", error);
    throw error;
  }
};
