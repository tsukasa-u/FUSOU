import type { MessageBatch } from "@cloudflare/workers-types";
import { runCompactionJob } from "../src/server/compaction/job";
import type { Bindings } from "../src/server/types";

interface CompactionMessage {
  datasetId: string;
  table?: string;
}

export default {
  async queue(batch: MessageBatch<any>, env: Bindings) {
    for (const msg of batch.messages) {
      const body = msg.body || {};
      const datasetId = body.datasetId as string | undefined;
      const table = body.table as string | undefined;

      if (!datasetId) {
        console.error("[Compaction Queue] Missing datasetId", { body });
        msg.ack();
        continue;
      }

      try {
        const result = await runCompactionJob(env, datasetId, table);
        console.log("[Compaction Queue] Compaction finished", {
          datasetId,
          table,
          result,
        });
        msg.ack();
      } catch (err) {
        console.error("[Compaction Queue] Failed", {
          datasetId,
          table,
          error: String(err),
        });
        // Best-effort: forward to DLQ if available
        try {
          if (env.COMPACTION_DLQ) {
            await env.COMPACTION_DLQ.send({
              datasetId,
              table,
              error: String(err),
              failedAt: new Date().toISOString(),
            });
          }
        } catch (dlqErr) {
          console.error("[Compaction Queue] DLQ send failed", {
            error: String(dlqErr),
          });
        }
        // Avoid infinite retry loops: ack after DLQ
        msg.ack();
      }
    }
  },
};
