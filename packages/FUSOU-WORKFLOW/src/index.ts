import { handleRead as handleHybridRead } from "./reader";
import { handleCron } from "./cron";
import { handleBufferConsumerChunked } from "./buffer-consumer";
import type { QueueMessage, QueueSendBatchItem } from "./types";
import {
  recomputeAllRuleTargets,
  runQuestInferenceTasks,
} from "./quest_tree_inference";
import {
  cleanupOrphanedMasterData,
  handleCleanupRequest,
} from "./master_data_cleanup";
import { z } from "zod";
import { timingSafeEqual } from "./utils/auth";

const UploadIngestPayloadSchema = z.object({
  dataset_id: z.string().optional(),
  datasetId: z.string().optional(),
  table: z.string().optional(),
  period_tag: z.string().optional(),
  periodTag: z.string().optional(),
  table_version: z.string().optional(),
  tableVersion: z.string().optional(),
  slices: z.array(z.string().min(1)).optional(),
});

const QuestInferenceRecomputeRequestSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const QuestInferenceRunRequestSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  datasetId: z.string().trim().min(1).optional(),
});

interface Env {
  BATTLE_DATA_BUCKET: R2Bucket;
  BATTLE_INDEX_DB: D1Database;
  WORKFLOW_STATE_KV?: KVNamespace;
  QUEST_INDEX_DB?: D1Database;
  MASTER_DATA_BUCKET?: R2Bucket;
  MASTER_DATA_INDEX_DB?: D1Database;
  OUTPUT_KEY_NAME?: string;
  COMPACTION_QUEUE?: Queue<QueueMessage>;
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
  // Cleanup job auth token
  MASTER_DATA_CLEANUP_TOKEN?: string;
  // Bearer token required for /battle-data/upload and /read (disabled without it)
  UPLOAD_INGEST_TOKEN?: string;
  // Optional cap for task batch size. Defaults to 100.
  QUEST_TREE_CRON_LIMIT?: string;
  // Required explicit switch for experimental quest collection/inference.
  QUEST_TREE_EXPERIMENTAL_COLLECTION_ENABLED?: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Hybrid reader: delegate to reader.ts (buffer_logs + block_indexes)
async function handleRead(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  // Allow backward-compatible params: table or table_name
  const url = new URL(request.url);
  if (!url.searchParams.get("table_name") && url.searchParams.get("table")) {
    url.searchParams.set("table_name", url.searchParams.get("table")!);
  }
  return handleHybridRead(new Request(url.toString(), request), env);
}

const queueConsumer = {
  async queue(batch: MessageBatch<unknown>, env: Env, _ctx: ExecutionContext) {
    if (!env.BATTLE_INDEX_DB) {
      console.error("[Queue] Missing BATTLE_INDEX_DB binding");
      batch.messages.forEach((m) => m.retry());
      return;
    }
    // Delegate to chunked bulk-insert consumer for performance and consistency
    await handleBufferConsumerChunked(
      batch,
      env,
    );
  },
};

const queueDLQ = {
  async queue(batch: MessageBatch<unknown>, env: Env, _ctx: ExecutionContext) {
    for (const message of batch.messages) {
      try {
        const key = `dead-letter/${encodeURIComponent(batch.queue)}/${encodeURIComponent(message.id)}.json`;
        await env.BATTLE_DATA_BUCKET.put(key, JSON.stringify({
          id: message.id, queue: batch.queue, timestamp: message.timestamp.toISOString(),
          body: message.body,
        }), { httpMetadata: { contentType: "application/json" } });
        console.error("[DLQ] Message persisted for manual recovery", { id: message.id, key });
        message.ack();
      } catch (error) {
        console.error("[DLQ] Persistence failed", { id: message.id, error });
        message.retry({ delaySeconds: 300 });
      }
    }
  },
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

function parseStrictBoolean(value: string | undefined, envKey: string): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  throw new Error(`${envKey} must be explicitly set to one of: true, false, 1, 0`);
}

function readStrictBooleanSafe(value: string | undefined, envKey: string): boolean | null {
  try {
    return parseStrictBoolean(value, envKey);
  } catch {
    return null;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function requireUploadIngestAuth(
  request: Request,
  env: Env,
  endpointName: string,
): Response | null {
  const token = env.UPLOAD_INGEST_TOKEN;
  if (!token) {
    return jsonResponse(
      { error: `${endpointName} disabled: UPLOAD_INGEST_TOKEN not configured` },
      403,
    );
  }
  const authHeader = request.headers.get("Authorization") ?? "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!timingSafeEqual(provided, token)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  return null;
}

async function parseOptionalJsonObject(
  request: Request,
): Promise<{ data: Record<string, unknown> } | { error: Response }> {
  const raw = await request.text();
  if (!raw.trim()) {
    return { data: {} };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: jsonResponse({ error: "Invalid JSON body" }, 400) };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: jsonResponse({ error: "JSON body must be an object" }, 400) };
  }
  return { data: parsed as Record<string, unknown> };
}

async function runQuestInferenceCron(env: Env): Promise<void> {
  const enabled = parseStrictBoolean(
    env.QUEST_TREE_EXPERIMENTAL_COLLECTION_ENABLED,
    "QUEST_TREE_EXPERIMENTAL_COLLECTION_ENABLED",
  );
  if (!enabled) {
    console.log("[scheduled] quest inference cron skipped: experimental collection disabled");
    return;
  }

  const limit = Math.min(200, parsePositiveInt(env.QUEST_TREE_CRON_LIMIT, 100));
  if (!env.QUEST_INDEX_DB) {
    console.warn("[scheduled] quest inference cron skipped: QUEST_INDEX_DB is not configured");
    return;
  }
  const result = await runQuestInferenceTasks(env.QUEST_INDEX_DB, { limit });
  console.log("[scheduled] quest inference cron completed", result);
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (path === "/battle-data/upload" && request.method === "POST") {
      // Require bearer token auth (fail closed if not configured)
      const authError = requireUploadIngestAuth(request, env, "Upload endpoint");
      if (authError) return authError;
      // Authenticated upload handler: accept base64 Avro slices and enqueue
      try {
        const rawPayload: unknown = await request.json();
        const parsedPayload = UploadIngestPayloadSchema.safeParse(rawPayload);
        if (!parsedPayload.success) {
          return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
            status: 400,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          });
        }
        const payload = parsedPayload.data;
        const dataset_id = payload?.dataset_id ?? payload?.datasetId;
        const table = payload?.table;
        const period_tag =
          payload?.period_tag ?? payload?.periodTag ?? "latest";
        const table_version = payload?.table_version ?? payload?.tableVersion;
        const slices: string[] = Array.isArray(payload?.slices)
          ? payload.slices
          : [];
        if (!dataset_id || !table || !slices.length) {
          return new Response(
            JSON.stringify({ error: "Missing dataset_id, table, or slices" }),
            {
              status: 400,
              headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            },
          );
        }
        if (!/^[a-f0-9]{64}$/i.test(String(dataset_id))) {
          return new Response(
            JSON.stringify({ error: "dataset_id must be a 64-character SHA-256 hex string" }),
            {
              status: 400,
              headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            },
          );
        }
        if (!table_version) {
          return new Response(
            JSON.stringify({ error: "Missing table_version" }),
            {
              status: 400,
              headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            },
          );
        }
        if (!env.COMPACTION_QUEUE) {
          return new Response(
            JSON.stringify({
              error: "Queue binding COMPACTION_QUEUE is missing",
            }),
            {
              status: 500,
              headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            },
          );
        }
        const messages: QueueSendBatchItem[] = slices.map((b64) => ({
          body: {
            datasetId: dataset_id,
            table,
            periodTag: period_tag,
            tableVersion: table_version,
            avro_base64: b64,
          },
        }));
        const sizes = messages.map((message) => new TextEncoder().encode(JSON.stringify(message.body)).byteLength + 100);
        if (messages.length > 100 || sizes.some((size) => size > 128000) ||
            sizes.reduce((sum, size) => sum + size, 0) > 256000) {
          return new Response(JSON.stringify({ error: "Upload exceeds Queue message or batch size limits" }), {
            status: 413, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          });
        }
        await env.COMPACTION_QUEUE.sendBatch(messages);
        return new Response(
          JSON.stringify({ status: "accepted", enqueued: messages.length }),
          {
            status: 202,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          },
        );
      } catch (err) {
        console.error("[Upload] Request failed:", err);
        const invalidJson = err instanceof SyntaxError;
        return new Response(JSON.stringify({ error: invalidJson ? "Invalid JSON body" : "Queue enqueue failed" }), {
          status: invalidJson ? 400 : 503,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
    }

    if (path === "/admin/compact" && request.method === "POST") {
      const authError = requireUploadIngestAuth(request, env, "Admin compact endpoint");
      if (authError) return authError;

      try {
        console.log("[Admin] Manual compaction triggered via /admin/compact");
        await handleCron(env);
        return jsonResponse({ status: "success", message: "Compaction completed successfully" }, 200);
      } catch (err) {
        console.error("[Admin] Manual compaction failed:", err);
        return jsonResponse(
          { error: "Compaction failed", detail: err instanceof Error ? err.message : String(err) },
          500,
        );
      }
    }

    if (path === "/admin/quest-inference/recompute" && request.method === "POST") {
      const authError = requireUploadIngestAuth(
        request,
        env,
        "Admin quest-inference recompute endpoint",
      );
      if (authError) return authError;
      if (!env.QUEST_INDEX_DB) {
        return jsonResponse({ error: "Quest index database not configured" }, 503);
      }

      const bodyResult = await parseOptionalJsonObject(request);
      if ("error" in bodyResult) return bodyResult.error;

      const parsedParams = QuestInferenceRecomputeRequestSchema.safeParse({
        ...(url.searchParams.has("limit") ? { limit: url.searchParams.get("limit") } : {}),
        ...(url.searchParams.has("offset") ? { offset: url.searchParams.get("offset") } : {}),
        ...bodyResult.data,
      });
      if (!parsedParams.success) {
        return jsonResponse(
          { error: "Invalid request parameters", issues: parsedParams.error.issues },
          400,
        );
      }

      const limit = parsedParams.data.limit ?? 50;
      const offset = parsedParams.data.offset ?? 0;

      try {
        const result = await recomputeAllRuleTargets(env.QUEST_INDEX_DB, { limit, offset });
        return jsonResponse({ status: "success", ...result, limit, offset }, 200);
      } catch (err) {
        console.error("[Admin] Quest rule recomputation failed:", err);
        return jsonResponse(
          {
            error: "Quest inference recomputation failed",
            detail: err instanceof Error ? err.message : String(err),
          },
          500,
        );
      }
    }

    if (path === "/admin/quest-inference/run" && request.method === "POST") {
      const authError = requireUploadIngestAuth(
        request,
        env,
        "Admin quest-inference run endpoint",
      );
      if (authError) return authError;
      if (!env.QUEST_INDEX_DB) {
        return jsonResponse({ error: "Quest index database not configured" }, 503);
      }

      const bodyResult = await parseOptionalJsonObject(request);
      if ("error" in bodyResult) return bodyResult.error;

      const parsedParams = QuestInferenceRunRequestSchema.safeParse({
        ...(url.searchParams.has("limit") ? { limit: url.searchParams.get("limit") } : {}),
        ...(url.searchParams.has("datasetId") ? { datasetId: url.searchParams.get("datasetId") } : {}),
        ...bodyResult.data,
      });
      if (!parsedParams.success) {
        return jsonResponse(
          { error: "Invalid request parameters", issues: parsedParams.error.issues },
          400,
        );
      }

      const limit = parsedParams.data.limit ?? 50;
      const datasetId = parsedParams.data.datasetId;

      try {
        const result = await runQuestInferenceTasks(env.QUEST_INDEX_DB, {
          limit,
          ...(datasetId ? { datasetId } : {}),
        });
        const cronEnabled = readStrictBooleanSafe(
          env.QUEST_TREE_EXPERIMENTAL_COLLECTION_ENABLED,
          "QUEST_TREE_EXPERIMENTAL_COLLECTION_ENABLED",
        );
        return jsonResponse(
          { status: "success", ...result, limit, cronEnabled },
          200,
        );
      } catch (err) {
        console.error("[Admin] Quest inference run failed:", err);
        return jsonResponse(
          {
            error: "Quest inference execution failed",
            detail: err instanceof Error ? err.message : String(err),
          },
          500,
        );
      }
    }

    if (path === "/read" && request.method === "GET") {
      const readAuthError = requireUploadIngestAuth(request, env, "Read endpoint");
      if (readAuthError) return readAuthError;

      return handleRead(request, env, ctx);
    }

    if (path === "/master-data/cleanup" && request.method === "POST") {
      // Manual cleanup trigger endpoint
      if (!env.MASTER_DATA_INDEX_DB || !env.MASTER_DATA_BUCKET) {
        return new Response(
          JSON.stringify({ error: "Master data storage not configured" }),
          {
            status: 503,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          },
        );
      }
      return handleCleanupRequest(request, {
        MASTER_DATA_BUCKET: env.MASTER_DATA_BUCKET,
        MASTER_DATA_INDEX_DB: env.MASTER_DATA_INDEX_DB,
        ...(env.MASTER_DATA_CLEANUP_TOKEN !== undefined ? { MASTER_DATA_CLEANUP_TOKEN: env.MASTER_DATA_CLEANUP_TOKEN } : {}),
      });
    }

    if (path === "/" && request.method === "GET") {
      return new Response(
        JSON.stringify({ status: "ok", service: "fusou-ingest" }),
        {
          status: 200,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        },
      );
    }

    return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
  },
  async queue(
    batch: MessageBatch<unknown>,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const queueName = batch.queue;
    const target =
      queueName && queueName.toLowerCase().includes("dlq") ? "dlq" : "main";
    if (target === "dlq") {
      return queueDLQ.queue(batch, env, ctx);
    }
    return queueConsumer.queue(batch, env, ctx);
  },
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    // Delegate scheduled archiving to cron.ts
    ctx.waitUntil(handleCron(env));

    // Also run master data cleanup during scheduled cron
    if (env.MASTER_DATA_INDEX_DB && env.MASTER_DATA_BUCKET) {
      ctx.waitUntil(
        cleanupOrphanedMasterData({
          MASTER_DATA_BUCKET: env.MASTER_DATA_BUCKET,
          MASTER_DATA_INDEX_DB: env.MASTER_DATA_INDEX_DB,
        }).catch((err) => {
          console.error("[scheduled] Master data cleanup error:", err);
        }),
      );
    }

    ctx.waitUntil(
      runQuestInferenceCron(env).catch((err) => {
        console.error("[scheduled] Quest inference cron error:", err);
      }),
    );
  },
};
