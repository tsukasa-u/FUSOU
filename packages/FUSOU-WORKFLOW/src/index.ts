import { handleRead as handleHybridRead } from "./reader";
import { handleCron } from "./cron";
import { handleBufferConsumerChunked } from "./buffer-consumer";
import { runQuestInferenceTasks } from "./quest_tree_inference";
import {
  cleanupOrphanedMasterData,
  handleCleanupRequest,
} from "./master_data_cleanup";

interface Env {
  BATTLE_DATA_BUCKET: R2Bucket;
  BATTLE_INDEX_DB: D1Database;
  QUEST_INDEX_DB?: D1Database;
  MASTER_DATA_BUCKET?: R2Bucket;
  MASTER_DATA_INDEX_DB?: D1Database;
  OUTPUT_KEY_NAME?: string;
  COMPACTION_QUEUE?: Queue<any>;
  // TiDB Cloud Serverless connection URL
  TIDB_KC_DB_URL?: string;
  // Cleanup job auth token
  MASTER_DATA_CLEANUP_TOKEN?: string;
  // Bearer token required for /battle-data/upload (must be set; endpoint is disabled without it)
  UPLOAD_INGEST_TOKEN?: string;
  // Optional cap for task batch size. Defaults to 100.
  QUEST_TREE_CRON_LIMIT?: string;
  // Required explicit switch for experimental quest collection/inference.
  QUEST_TREE_EXPERIMENTAL_COLLECTION_ENABLED?: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
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
      batch as unknown as MessageBatch<any>,
      env as any,
    );
  },
};

const queueDLQ = {
  async queue(batch: MessageBatch<unknown>, _env: Env, _ctx: ExecutionContext) {
    for (const message of batch.messages) {
      console.error("[DLQ] Unhandled message", {
        id: message.id,
        body: message.body,
      });
      message.ack();
    }
  },
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

/** Timing-safe string equality using XOR byte-by-byte comparison */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

function parseStrictBoolean(value: string | undefined, envKey: string): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  throw new Error(`${envKey} must be explicitly set to one of: true, false, 1, 0`);
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
      const uploadToken = env.UPLOAD_INGEST_TOKEN;
      if (!uploadToken) {
        return new Response(
          JSON.stringify({ error: "Upload endpoint disabled: UPLOAD_INGEST_TOKEN not configured" }),
          { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
        );
      }
      const authHeader = request.headers.get("Authorization") ?? "";
      const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (!timingSafeEqual(provided, uploadToken)) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
        );
      }
      // Authenticated upload handler: accept base64 Avro slices and enqueue
      try {
        const payload: any = await request.json();
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
        const messages = slices.map((b64) => ({
          body: {
            dataset_id,
            table,
            period_tag,
            table_version,
            avro_base64: b64,
          },
        }));
        await (env.COMPACTION_QUEUE as any).sendBatch(messages as any);
        return new Response(
          JSON.stringify({ status: "accepted", enqueued: messages.length }),
          {
            status: 202,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          },
        );
      } catch (err) {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
    }

    if (path === "/read" && request.method === "GET") {
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
    const queueName = (batch as { queue?: string }).queue as string | undefined;
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
