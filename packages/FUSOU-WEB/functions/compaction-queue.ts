import type { MessageBatch } from "@cloudflare/workers-types";
import { runCompactionJob } from "../src/server/compaction/job";
import type { Bindings } from "../src/server/types";

interface CompactionMessage {
  datasetId: string;
  table?: string;
  triggeredAt?: string;
  priority?: 'realtime' | 'manual' | 'scheduled';
  metricId?: string;
}

export default {
  async queue(batch: MessageBatch<any>, env: Bindings) {
    console.info('[Compaction Queue Consumer] Processing batch', {
      messageCount: batch.messages.length,
      timestamp: new Date().toISOString(),
    });

    for (const msg of batch.messages) {
      const body = msg.body || {};
      const datasetId = body.datasetId as string | undefined;
      const table = body.table as string | undefined;
      const priority = body.priority as string | undefined;
      const metricId = body.metricId as string | undefined;
      const triggeredAt = body.triggeredAt as string | undefined;
      const periodTag = body.periodTag as string | undefined;

      console.info('[Compaction Queue Consumer] Processing message', {
        messageId: msg.id,
        datasetId,
        table,
        periodTag,
        priority,
        metricId,
        triggeredAt,
        timestamp: new Date().toISOString(),
      });

      if (!datasetId) {
        console.error("[Compaction Queue Consumer] Missing datasetId", { 
          body,
          messageId: msg.id,
        });
        msg.ack();
        continue;
      }

      try {
        console.debug(`[Compaction Queue Consumer] Starting runCompactionJob`, {
          datasetId,
          table,
          periodTag,
        });

        const result = await runCompactionJob(env, datasetId, table, periodTag);
        
        console.info("[Compaction Queue Consumer] Compaction job succeeded", {
          messageId: msg.id,
          datasetId,
          table,
          periodTag,
          priority,
          result,
          completedAt: new Date().toISOString(),
        });
        msg.ack();
      } catch (err) {
        console.error("[Compaction Queue Consumer] Compaction job failed", {
          messageId: msg.id,
          datasetId,
          table,
          periodTag,
          priority,
          error: String(err),
          errorMessage: (err as any)?.message,
          errorStack: (err as any)?.stack,
          failedAt: new Date().toISOString(),
        });

        // Best-effort: forward to DLQ if available
        try {
          console.info("[Compaction Queue Consumer] Attempting to send to DLQ", {
            datasetId,
            metricId,
          });

          if (env.COMPACTION_DLQ) {
            await env.COMPACTION_DLQ.send({
              datasetId,
              table,
              error: String(err),
              errorMessage: (err as any)?.message,
              failedAt: new Date().toISOString(),
              originalMessageId: msg.id,
            });

            console.info("[Compaction Queue Consumer] DLQ send succeeded", {
              datasetId,
              messageId: msg.id,
            });
          }
        } catch (dlqErr) {
          console.error("[Compaction Queue Consumer] DLQ send failed", {
            datasetId,
            originalError: String(err),
            dlqError: String(dlqErr),
          });
        }

        // Avoid infinite retry loops: ack after DLQ
        msg.ack();
      }
    }

    console.info('[Compaction Queue Consumer] Batch processing completed', {
      messageCount: batch.messages.length,
      timestamp: new Date().toISOString(),
    });
  },
};
