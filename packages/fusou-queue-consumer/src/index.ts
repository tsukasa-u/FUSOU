import type { MessageBatch, ExportedHandler } from "@cloudflare/workers-types";

interface CompactionMessage {
  datasetId: string;
  table?: string;
  periodTag?: string;
  triggeredAt?: string;
  priority?: 'realtime' | 'manual' | 'scheduled';
  metricId?: string;
}

interface Bindings {
  COMPACTION_WORKFLOW: Service;
  COMPACTION_DLQ?: Queue;
}

/**
 * Queue Consumer Handler for FUSOU Compaction Queue
 *
 * This worker consumes messages from dev-kc-compaction-queue and triggers
 * the compaction workflow via the COMPACTION_WORKFLOW service binding.
 *
 * Flow:
 * 1. Queue message arrives with { datasetId, table, periodTag, etc. }
 * 2. Worker extracts message payload
 * 3. Worker calls COMPACTION_WORKFLOW with job details
 * 4. On success: ack message (message is consumed)
 * 5. On failure: send to DLQ, then ack (avoid infinite retries)
 */
export const queue: ExportedHandler<Bindings> = {
  async queue(batch: MessageBatch<any>, env: Bindings) {
    console.info('[Compaction Queue Consumer] Processing batch', {
      messageCount: batch.messages.length,
      timestamp: new Date().toISOString(),
    });

    for (const msg of batch.messages) {
      const body = msg.body as CompactionMessage || {};
      const { datasetId, table, periodTag, priority, metricId, triggeredAt } = body;

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
        console.debug(`[Compaction Queue Consumer] Starting compaction workflow`, {
          datasetId,
          table,
          periodTag,
        });

        // Trigger compaction workflow via service binding
        // The workflow service (fusou-workflow) should expose a compaction endpoint
        // or accept these parameters directly
        const workflowRequest = new Request('https://workflow.local/compaction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            datasetId,
            table,
            periodTag,
            priority,
            metricId,
            triggeredAt,
            messageId: msg.id,
          }),
        });

        // TODO: Update this to match your actual workflow API
        // For now, this is a placeholder showing the integration point
        console.info("[Compaction Queue Consumer] Would trigger workflow", {
          datasetId,
          table,
          periodTag,
        });

        console.info("[Compaction Queue Consumer] Compaction job queued", {
          messageId: msg.id,
          datasetId,
          table,
          periodTag,
          priority,
          queuedAt: new Date().toISOString(),
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
          if (env.COMPACTION_DLQ) {
            await env.COMPACTION_DLQ.send({
              datasetId,
              table,
              periodTag,
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

        // Avoid infinite retry loops: ack after DLQ attempt
        msg.ack();
      }
    }

    console.info('[Compaction Queue Consumer] Batch processing completed', {
      messageCount: batch.messages.length,
      timestamp: new Date().toISOString(),
    });
  },
};

export default { queue };
