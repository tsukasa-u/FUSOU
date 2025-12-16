import { createClient } from "@supabase/supabase-js";
import type { Bindings } from "../types";
// Note: We'll dynamically import workflow module later once pathing is finalized

export type CompactionResult = {
  status: "ok" | "partial" | "no_fragments" | "offloaded";
  copied?: Array<{ table: string; sourceKey: string; compactedKey: string; size: number }>;
  failures?: Array<{ table: string; reason: string }>;
  delegated?: { workflowInvocationId?: string };
};

/**
 * Synchronous compaction helper (best-effort):
 * - For a dataset (and optional table), pick the latest fragment from D1
 * - Copy it to a compacted R2 prefix (no merge; pass-through compaction)
 * - Update Supabase datasets/processing_metrics to success/failure
 */
export async function runCompactionJob(
  env: Bindings,
  datasetId: string,
  tableFilter?: string,
  periodTagFilter?: string
): Promise<CompactionResult> {
  const { BATTLE_INDEX_DB: indexDb, BATTLE_DATA_BUCKET: bucket } = env;
  if (!indexDb || !bucket) {
    throw new Error("Missing BATTLE_INDEX_DB or BATTLE_DATA_BUCKET binding");
  }

  // === オフロード方針: FUSOU-WORKFLOW にコンパクションを委譲 ===
  // Pages 側でCPU/メモリを消費せず、Queue/Service Binding 経由で実行
  if ((env as any).COMPACTION_WORKFLOW) {
    try {
      // Service binding 経由でワークフローを呼び出す（擬似RPC）
      const workflowRes = await (env as any).COMPACTION_WORKFLOW.fetch("/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ datasetId, table: tableFilter, periodTag: periodTagFilter }),
      });
      const json = await workflowRes.json();
      return { status: "offloaded", delegated: { workflowInvocationId: json?.invocationId } };
    } catch (err) {
      // 方針によりフォールバックは行わずエラーを返す
      console.error("[compaction] workflow delegation failed; aborting (no fallback)", err);
      throw new Error("Workflow delegation failed");
    }
  }


  // Service bindingが無い場合もエラーを返す（フォールバック無し）
  throw new Error("COMPACTION_WORKFLOW binding not configured; cannot compact on Pages");
}
