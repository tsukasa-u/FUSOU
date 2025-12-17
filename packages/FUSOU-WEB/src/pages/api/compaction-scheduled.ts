import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import type { Bindings } from "../../server/types";

const MAX_DATASETS_PER_RUN = Number(process.env.MAX_DATASETS_PER_RUN || 10);

async function fetchPendingDatasets(
  supabase: any,
  limit: number
): Promise<Array<{ id: string }>> {
  const { data, error } = await supabase
    .from("datasets")
    .select("id")
    .eq("compaction_needed", true)
    .eq("compaction_in_progress", false)
    .order("updated_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(`Supabase fetch failed: ${error.message}`);
  return data || [];
}

async function enqueueDataset(
  datasetId: string,
  compactionQueue: any
): Promise<void> {
  try {
    console.log(`[Scheduled] Enqueuing dataset: ${datasetId}`);

    await compactionQueue.send({
      datasetId: datasetId,
      triggeredAt: new Date().toISOString(),
      priority: "scheduled",
    });

    console.log(`[Scheduled] Enqueued: ${datasetId}`);
  } catch (error) {
    console.error(`[Scheduled] Failed to enqueue: ${datasetId}`, error);
    throw error;
  }
}

export const POST: APIRoute = async ({ request }) => {
  const env = (request as any).context?.cloudflare?.env as Bindings;

  const supabaseUrl = env?.PUBLIC_SUPABASE_URL as string;
  const supabaseKey = env?.SUPABASE_SECRET_KEY as string;
  const compactionQueue = env?.COMPACTION_QUEUE as any;

  if (!supabaseUrl || !supabaseKey || !compactionQueue) {
    console.log("[Scheduled] Missing environment configuration");
    return new Response(
      JSON.stringify({
        error: "Missing environment configuration",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    const datasets = await fetchPendingDatasets(supabase, MAX_DATASETS_PER_RUN);
    if (datasets.length === 0) {
      console.log("[Scheduled] No pending datasets");
      return new Response(
        JSON.stringify({
          success: true,
          message: "No pending datasets",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    console.log(
      `[Scheduled] Enqueuing ${datasets.length} datasets to compaction queue`
    );

    const enqueuePromises = datasets.map((dataset) =>
      enqueueDataset(dataset.id, compactionQueue)
    );

    await Promise.all(enqueuePromises);

    console.log(
      `[Scheduled] Successfully enqueued ${datasets.length} datasets`
    );

    return new Response(
      JSON.stringify({
        success: true,
        enqueuedCount: datasets.length,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[Scheduled] Fatal error:", error);
    return new Response(
      JSON.stringify({
        error: String(error),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};
