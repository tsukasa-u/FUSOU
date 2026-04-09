import { Hono } from "hono";
import type { Bindings, D1Database, D1Result } from "../types";
import { CORS_HEADERS } from "../constants";
import {
  createEnvContext,
  generateSignedToken,
  getEnv,
  validateJWT,
  validateTokenPayload,
  verifySignedToken,
} from "../utils";

const app = new Hono<{ Bindings: Bindings }>();

const ALLOWED_EVENT_TYPES = new Set(["snapshot", "start", "stop", "complete"]);

const GAP_THRESHOLD_MS = 30 * 60 * 1000;
const RECENT_WINDOW_MS = 10 * 60 * 1000;
const MIN_OBS_SINGLE = 8;
const MIN_OBS_PAIR = 6;
const MIN_CONF_SINGLE = 0.55;
const MIN_CONF_PAIR = 0.65;

const QUEST_TREE_COLLECTION_SWITCH_ENV = "QUEST_TREE_EXPERIMENTAL_COLLECTION_ENABLED";

app.options("*", (_c) => new Response(null, { status: 204, headers: CORS_HEADERS }));

type QuestListEntry = {
  quest_id: number;
  type?: number;
  category?: number;
  label_type?: number;
  title?: string;
  detail?: string;
};

type IngestBody = {
  dataset_id?: string;
  request_id?: string;
  payload_hash?: string;
  event_type?: string;
  timestamp_ms?: number;
  period_tag?: string;
  table_version?: string;
  page_no?: number;
  quest_id?: number;
  quests?: QuestListEntry[];
};

function nowMs(): number {
  return Date.now();
}

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return Math.trunc(n);
    }
  }
  return null;
}

function makeId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${random}`;
}

function parseStrictBoolean(value: string | undefined, envKey: string): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  throw new Error(
    `${envKey} must be explicitly set to one of: true, false, 1, 0`
  );
}

function isQuestTreeCollectionEnabled(env: ReturnType<typeof createEnvContext>): boolean {
  const raw = getEnv(env, QUEST_TREE_COLLECTION_SWITCH_ENV);
  return parseStrictBoolean(raw, QUEST_TREE_COLLECTION_SWITCH_ENV);
}

function parseJsonArray<T>(raw: unknown): T[] {
  if (!raw || typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as unknown as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function validateIngestBody(body: IngestBody | null):
  | {
      ok: true;
      datasetId: string;
      requestId: string;
      payloadHash: string;
      eventType: string;
      periodTag: string;
      tableVersion: string;
      atMs: number;
    }
  | { ok: false; error: string } {
  if (!body) return { ok: false, error: "Invalid JSON body" };

  const datasetId = (body.dataset_id ?? "").trim();
  const requestId = (body.request_id ?? "").trim();
  const payloadHash = (body.payload_hash ?? "").trim();
  const eventType = (body.event_type ?? "").trim();
  const periodTag = (body.period_tag ?? "").trim();
  const tableVersion = (body.table_version ?? "").trim();
  const atMs = toInt(body.timestamp_ms) ?? nowMs();

  if (!datasetId) return { ok: false, error: "dataset_id is required" };
  if (!requestId) return { ok: false, error: "request_id is required" };
  if (!payloadHash) return { ok: false, error: "payload_hash is required" };
  if (!ALLOWED_EVENT_TYPES.has(eventType)) {
    return { ok: false, error: "event_type must be one of: snapshot, start, stop, complete" };
  }
  if (!periodTag) return { ok: false, error: "period_tag is required" };
  if (!tableVersion) return { ok: false, error: "table_version is required" };

  return {
    ok: true,
    datasetId,
    requestId,
    payloadHash,
    eventType,
    periodTag,
    tableVersion,
    atMs,
  };
}

async function ingestQuestBody(db: D1Database, body: IngestBody) {
  const validated = validateIngestBody(body);
  if (!validated.ok) {
    return { status: 400, body: { error: validated.error } };
  }

  const {
    datasetId,
    requestId,
    payloadHash,
    eventType,
    periodTag,
    tableVersion,
    atMs,
  } = validated;

  const existing = (await db
    .prepare(
      `SELECT id FROM quest_ingest_events WHERE request_id = ? AND payload_hash = ? LIMIT 1`
    )
    .bind(requestId, payloadHash)
    .first<D1Result>()) as { id?: number } | null;

  if (existing?.id) {
    return { status: 200, body: { ok: true, idempotent: true, message: "already ingested" } };
  }

  const sameRequestDifferentPayload = (await db
    .prepare(
      `SELECT id, payload_hash
       FROM quest_ingest_events
       WHERE request_id = ?
       LIMIT 1`
    )
    .bind(requestId)
    .first<D1Result>()) as { id?: number; payload_hash?: string } | null;

  if (
    sameRequestDifferentPayload?.id &&
    sameRequestDifferentPayload.payload_hash !== payloadHash
  ) {
    return {
      status: 409,
      body: {
        error: "request_id conflict",
        message: "Same request_id already exists with different payload_hash",
        existing_request_id: requestId,
        existing_payload_hash: sameRequestDifferentPayload.payload_hash ?? null,
      },
    };
  }

  const session = await getOrCreateSession(db, datasetId, atMs);

  const questId = toInt(body.quest_id);
  const pageNo = toInt(body.page_no) ?? 1;

  try {
    const { bootstrapNowCompleted } = await processIngestEvents(db, {
      datasetId,
      requestId,
      payloadHash,
      eventType,
      periodTag,
      tableVersion,
      atMs,
      sessionId: session.sessionId,
      isBootstrapCompleted: session.bootstrapCompleted,
      questId,
      pageNo,
      quests: (body.quests as QuestListEntry[] | undefined) ?? [],
    });

    const shouldEnqueueTask = session.bootstrapCompleted || bootstrapNowCompleted;
    const taskId = shouldEnqueueTask
      ? await enqueueTask(db, datasetId, session.sessionId, atMs)
      : null;

    return {
      status: 200,
      body: {
        ok: true,
        idempotent: false,
        collection_session_id: session.sessionId,
        task_id: taskId,
        task_enqueued: shouldEnqueueTask,
      },
    };
  } catch (err) {
    return {
      status: 500,
      body: {
        error: "ingest processing failed",
        detail: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

async function upsertQuestMasterEntries(
  db: D1Database,
  periodTag: string,
  tableVersion: string,
  quests: QuestListEntry[],
) {
  for (const q of quests) {
    const questId = toInt(q.quest_id);
    if (questId == null || questId <= 0) continue;

    const title = typeof q.title === "string" ? q.title.trim() : "";
    const detail = typeof q.detail === "string" ? q.detail.trim() : "";
    if (!title || !detail) continue;

    const questType = toInt(q.type) ?? 0;
    const category = toInt(q.category) ?? 0;
    const labelType = toInt(q.label_type) ?? 0;

    const masterHash = await sha256Hex(
      new TextEncoder().encode(
        JSON.stringify({
          questId,
          title,
          detail,
          questType,
          category,
          labelType,
        }),
      ),
    );

    await db
      .prepare(
        `INSERT INTO quest_master_entries (
           quest_id,
           period_tag,
           table_version,
           title,
           detail,
           quest_type,
           category,
           label_type,
           master_hash,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(quest_id, period_tag, table_version) DO UPDATE SET
           title = excluded.title,
           detail = excluded.detail,
           quest_type = excluded.quest_type,
           category = excluded.category,
           label_type = excluded.label_type,
           master_hash = excluded.master_hash,
           updated_at = excluded.updated_at
         WHERE quest_master_entries.master_hash <> excluded.master_hash`
      )
      .bind(
        questId,
        periodTag,
        tableVersion,
        title,
        detail,
        questType,
        category,
        labelType,
        masterHash,
        nowMs(),
        nowMs(),
      )
      .run();
  }
}

async function getOrCreateSession(
  db: D1Database,
  datasetId: string,
  atMs: number,
): Promise<{ sessionId: string; isNew: boolean; bootstrapCompleted: boolean }> {
  const latest = (await db
    .prepare(
      `SELECT collection_session_id, ended_at_ms, bootstrap_completed_at_ms
       FROM quest_collection_sessions
       WHERE dataset_id = ?
       ORDER BY started_at_ms DESC
       LIMIT 1`
    )
    .bind(datasetId)
    .first<D1Result>()) as
    | {
        collection_session_id?: string;
        ended_at_ms?: number | null;
        bootstrap_completed_at_ms?: number | null;
      }
    | null;

  const latestSessionId = latest?.collection_session_id ?? null;
  const latestEndedAt = toInt(latest?.ended_at_ms) ?? null;
  const latestBootstrap = toInt(latest?.bootstrap_completed_at_ms) ?? null;

  if (latestSessionId && latestEndedAt != null && atMs - latestEndedAt <= GAP_THRESHOLD_MS) {
    await db
      .prepare(
        `UPDATE quest_collection_sessions
         SET ended_at_ms = ?
         WHERE collection_session_id = ?`
      )
      .bind(atMs, latestSessionId)
      .run();

    return {
      sessionId: latestSessionId,
      isNew: false,
      bootstrapCompleted: latestBootstrap != null,
    };
  }

  const sessionId = makeId("qsess");
  await db
    .prepare(
      `INSERT INTO quest_collection_sessions (
         collection_session_id,
         dataset_id,
         started_at_ms,
         ended_at_ms,
         start_reason,
         has_data_gap,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(sessionId, datasetId, atMs, atMs, latestSessionId ? "resume" : "bootstrap", latestSessionId ? 1 : 0, atMs)
    .run();

  return { sessionId, isNew: true, bootstrapCompleted: false };
}

async function markBootstrapCompleted(db: D1Database, sessionId: string, atMs: number): Promise<void> {
  await db
    .prepare(
      `UPDATE quest_collection_sessions
       SET bootstrap_completed_at_ms = ?, ended_at_ms = ?
       WHERE collection_session_id = ?`
    )
    .bind(atMs, atMs, sessionId)
    .run();
}

function toVisibleQuestIds(quests: QuestListEntry[]): number[] {
  const set = new Set<number>();
  for (const q of quests) {
    const id = toInt(q.quest_id);
    if (id == null || id <= 0) continue;
    set.add(id);
  }
  return [...set].sort((a, b) => a - b);
}

function setDiff(next: number[], prev: number[]): number[] {
  const prevSet = new Set(prev);
  const diff: number[] = [];
  for (const id of next) {
    if (!prevSet.has(id)) diff.push(id);
  }
  return diff;
}

async function upsertQuestStateLatest(
  db: D1Database,
  params: {
    datasetId: string;
    questId: number;
    sessionId: string;
    state: string;
    eventType: string;
    atMs: number;
    periodTag: string;
    tableVersion: string;
    isClaimed: number;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO quest_state_latest (
         dataset_id,
         quest_id,
         collection_session_id,
         state,
         updated_at_ms,
         last_event_type,
         period_tag,
         table_version,
         is_claimed
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(dataset_id, quest_id) DO UPDATE SET
         collection_session_id = excluded.collection_session_id,
         state = excluded.state,
         updated_at_ms = excluded.updated_at_ms,
         last_event_type = excluded.last_event_type,
         period_tag = excluded.period_tag,
         table_version = excluded.table_version,
         is_claimed = excluded.is_claimed`
    )
    .bind(
      params.datasetId,
      params.questId,
      params.sessionId,
      params.state,
      params.atMs,
      params.eventType,
      params.periodTag,
      params.tableVersion,
      params.isClaimed,
    )
    .run();
}

async function enqueueTask(
  db: D1Database,
  datasetId: string,
  sessionId: string,
  atMs: number,
): Promise<string> {
  const taskId = makeId("qtask");
  await db
    .prepare(
      `INSERT INTO quest_inference_tasks (
         task_id,
         dataset_id,
         collection_session_id,
         from_ts,
         to_ts,
         status,
         retry_count,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`
    )
    .bind(taskId, datasetId, sessionId, Math.max(0, atMs - RECENT_WINDOW_MS), atMs + 1, atMs, atMs)
    .run();
  return taskId;
}

async function processIngestEvents(
  db: D1Database,
  params: {
    datasetId: string;
    requestId: string;
    payloadHash: string;
    eventType: string;
    periodTag: string;
    tableVersion: string;
    atMs: number;
    sessionId: string;
    isBootstrapCompleted: boolean;
    questId?: number | null;
    pageNo?: number;
    quests?: QuestListEntry[];
  },
): Promise<{ bootstrapNowCompleted: boolean }> {
  let bootstrapNowCompleted = false;

  await db
    .prepare(
      `INSERT INTO quest_ingest_events (
         request_id,
         payload_hash,
         dataset_id,
         collection_session_id,
         event_type,
         quest_id,
         page_no,
         timestamp_ms,
         period_tag,
         table_version,
         status,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ingested', ?)`
    )
    .bind(
      params.requestId,
      params.payloadHash,
      params.datasetId,
      params.sessionId,
      params.eventType,
      params.questId ?? null,
      params.pageNo ?? 1,
      params.atMs,
      params.periodTag,
      params.tableVersion,
      nowMs(),
    )
    .run();

  if (params.eventType === "snapshot") {
    const quests = Array.isArray(params.quests) ? params.quests : [];
    await upsertQuestMasterEntries(db, params.periodTag, params.tableVersion, quests);
    const visibleQuestIds = toVisibleQuestIds(quests);

    const previousSnapshots = ((await db
      .prepare(
        `SELECT page_no, visible_quest_ids_json
         FROM questlist_snapshots
         WHERE dataset_id = ?
           AND collection_session_id = ?
         ORDER BY captured_at_ms DESC`
      )
      .bind(params.datasetId, params.sessionId)
      .all<{ page_no: number; visible_quest_ids_json?: string }>())
      .results ?? []) as Array<{ page_no: number; visible_quest_ids_json?: string }>;

    const latestByPage = new Map<number, number[]>();
    for (const snap of previousSnapshots) {
      const page = toInt(snap.page_no);
      if (page == null || latestByPage.has(page)) continue;
      latestByPage.set(page, parseJsonArray<number>(snap.visible_quest_ids_json));
    }

    const previousGlobalVisible = new Set<number>();
    for (const ids of latestByPage.values()) {
      for (const id of ids) {
        previousGlobalVisible.add(id);
      }
    }

    await db
      .prepare(
        `INSERT INTO questlist_snapshots (
           dataset_id,
           collection_session_id,
           page_no,
           snapshot_hash,
           snapshot_json,
           visible_quest_ids_json,
           captured_at_ms,
           period_tag,
           table_version,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        params.datasetId,
        params.sessionId,
        params.pageNo ?? 1,
        params.payloadHash,
        JSON.stringify(quests),
        JSON.stringify(visibleQuestIds),
        params.atMs,
        params.periodTag,
        params.tableVersion,
        nowMs(),
      )
      .run();

    if (!params.isBootstrapCompleted) {
      await markBootstrapCompleted(db, params.sessionId, params.atMs);
      bootstrapNowCompleted = true;
    } else {
      const appeared = setDiff(visibleQuestIds, [...previousGlobalVisible]);
      for (const targetQuestId of appeared) {
        await db
          .prepare(
            `INSERT OR IGNORE INTO quest_appearance_events (
               dataset_id,
               collection_session_id,
               target_quest_id,
               appeared_at_ms,
               source_event_type,
               source_event_id,
               period_tag,
               table_version,
               is_bootstrap_unknown,
               created_at
             ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 0, ?)`
          )
          .bind(
            params.datasetId,
            params.sessionId,
            targetQuestId,
            params.atMs,
            params.eventType,
            params.periodTag,
            params.tableVersion,
            nowMs(),
          )
          .run();
      }
    }
  } else if (params.questId != null && params.questId > 0) {
    const stateAfter =
      params.eventType === "start"
        ? "active"
        : params.eventType === "stop"
          ? "visible_inactive"
          : "claimed";

    await db
      .prepare(
        `INSERT INTO quest_state_events (
           dataset_id,
           collection_session_id,
           quest_id,
           event_type,
           state_after,
           timestamp_ms,
           period_tag,
           table_version,
           payload_hash,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        params.datasetId,
        params.sessionId,
        params.questId,
        params.eventType,
        stateAfter,
        params.atMs,
        params.periodTag,
        params.tableVersion,
        params.payloadHash,
        nowMs(),
      )
      .run();

    await upsertQuestStateLatest(db, {
      datasetId: params.datasetId,
      questId: params.questId,
      sessionId: params.sessionId,
      state: stateAfter,
      eventType: params.eventType,
      atMs: params.atMs,
      periodTag: params.periodTag,
      tableVersion: params.tableVersion,
      isClaimed: params.eventType === "complete" ? 1 : 0,
    });
  }

  return { bootstrapNowCompleted };
}

app.post("/ingest", async (c) => {
  const db = c.env.QUEST_INDEX_DB;
  if (!db) return c.json({ error: "QUEST_INDEX_DB not configured" }, 503);

  const env = createEnvContext(c);
  let collectionEnabled = false;
  try {
    collectionEnabled = isQuestTreeCollectionEnabled(env);
  } catch (err) {
    return c.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "QUEST_TREE_EXPERIMENTAL_COLLECTION_ENABLED is invalid",
      },
      500,
    );
  }
  if (!collectionEnabled) {
    return c.json({ error: "Quest tree collection is disabled" }, 503);
  }

  const signingSecret = getEnv(env, "QUEST_TREE_SIGNING_SECRET");
  if (!signingSecret) {
    return c.json({ error: "QUEST_TREE_SIGNING_SECRET is required" }, 500);
  }

  const uploadToken = c.req.header("X-Upload-Token");

  if (!uploadToken) {
    const authHeader = c.req.header("Authorization");
    const bearer = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : null;
    if (!bearer) return c.json({ error: "Unauthorized" }, 401);

    const user = await validateJWT(bearer);
    if (!user?.id) return c.json({ error: "Invalid or expired JWT token" }, 401);

    const handshakeBody = (await c.req.json().catch(() => null)) as (IngestBody & {
      content_hash?: string;
      file_size?: number | string;
    }) | null;

    const validated = validateIngestBody(handshakeBody);
    if (!validated.ok) return c.json({ error: validated.error }, 400);

    const contentHash = (handshakeBody?.content_hash ?? "").toString().trim();
    if (!contentHash) {
      return c.json({ error: "content_hash is required" }, 400);
    }

    const declaredSize = Number(handshakeBody?.file_size ?? 0);
    if (!Number.isFinite(declaredSize) || declaredSize <= 0) {
      return c.json({ error: "file_size must be > 0" }, 400);
    }

    const token = await generateSignedToken(
      {
        user_id: user.id,
        content_hash: contentHash,
        declared_size: declaredSize,
        dataset_id: validated.datasetId,
        request_id: validated.requestId,
        event_type: validated.eventType,
      },
      signingSecret,
      300,
    );

    const uploadUrl = new URL(c.req.url);
    return c.json({
      uploadUrl: uploadUrl.toString(),
      token,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
  }

  const authHeader = c.req.header("Authorization");
  const bearer = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;
  if (!bearer) return c.json({ error: "Unauthorized" }, 401);

  const user = await validateJWT(bearer);
  if (!user?.id) return c.json({ error: "Invalid or expired JWT token" }, 401);

  const tokenPayload = await verifySignedToken(uploadToken, signingSecret);
  if (!tokenPayload) return c.json({ error: "Invalid or expired upload token" }, 401);

  const payloadValidation = validateTokenPayload(tokenPayload, [
    "content_hash",
    "declared_size",
    "dataset_id",
    "request_id",
    "event_type",
  ]);
  if (!payloadValidation.valid) {
    return c.json({ error: payloadValidation.error ?? "Invalid upload token payload" }, 400);
  }
  if (tokenPayload.user_id !== user.id) {
    return c.json({ error: "User mismatch - token generated for different user" }, 403);
  }

  const bodyStream = c.req.raw.body;
  if (!bodyStream) return c.json({ error: "Upload payload is missing" }, 400);
  const uploaded = new Uint8Array(await new Response(bodyStream).arrayBuffer());

  const declaredSize = Number(tokenPayload.declared_size);
  if (!Number.isFinite(declaredSize) || uploaded.byteLength !== declaredSize) {
    return c.json(
      {
        error: "Data size mismatch",
        expected: declaredSize,
        actual: uploaded.byteLength,
      },
      400,
    );
  }

  const actualHash = await sha256Hex(uploaded);
  const expectedHash = String(tokenPayload.content_hash ?? "").toLowerCase();
  if (actualHash.toLowerCase() !== expectedHash) {
    return c.json(
      {
        error: "Content hash mismatch - data may be corrupted",
        expected: expectedHash,
        actual: actualHash,
      },
      400,
    );
  }

  const body = (() => {
    try {
      return JSON.parse(new TextDecoder().decode(uploaded)) as IngestBody;
    } catch {
      return null;
    }
  })();
  if (!body) {
    return c.json({ error: "Invalid JSON upload payload" }, 400);
  }
  const verified = validateIngestBody(body);
  if (!verified.ok) return c.json({ error: verified.error }, 400);

  if (
    verified.datasetId !== String(tokenPayload.dataset_id) ||
    verified.requestId !== String(tokenPayload.request_id) ||
    verified.eventType !== String(tokenPayload.event_type)
  ) {
    return c.json({ error: "Upload payload does not match upload token claims" }, 400);
  }

  const result = await ingestQuestBody(db, body);

  return c.json(result.body, result.status as 200 | 400 | 409 | 500);
});

app.get("/rules", async (c) => {
  const db = c.env.QUEST_INDEX_DB;
  if (!db) return c.json({ error: "QUEST_INDEX_DB not configured" }, 503);

  const targetRaw = c.req.query("target");
  const target = toInt(targetRaw);
  const periodTag = (c.req.query("period_tag") ?? "latest").trim() || "latest";
  const tableVersion = (c.req.query("table_version") ?? "0.5").trim() || "0.5";
  const includeLow = c.req.query("include_low") === "1";

  if (target == null || target <= 0) {
    return c.json({ error: "target query is required" }, 400);
  }

  const rules = ((await db
    .prepare(
      `SELECT rule_id, target_quest_id, prereq_set_json, set_size, class, support, confidence, lift, score, period_tag, table_version, is_primary, quality_tier, updated_at_ms
       FROM quest_rule_edges
       WHERE target_quest_id = ?
         AND period_tag = ?
         AND table_version = ?
         AND (? = 1 OR quality_tier != 'low')
       ORDER BY is_primary DESC, score DESC`
    )
    .bind(target, periodTag, tableVersion, includeLow ? 1 : 0)
    .all())
    .results ?? []);

  return c.json({ ok: true, target, period_tag: periodTag, table_version: tableVersion, rules });
});

app.get("/graph", async (c) => {
  const db = c.env.QUEST_INDEX_DB;
  if (!db) return c.json({ error: "QUEST_INDEX_DB not configured" }, 503);

  const periodTag = (c.req.query("period_tag") ?? "latest").trim() || "latest";
  const tableVersion = (c.req.query("table_version") ?? "0.5").trim() || "0.5";

  const edges = ((await db
    .prepare(
      `SELECT target_quest_id, prereq_set_json, score, is_primary, class
       FROM quest_rule_edges
       WHERE period_tag = ?
         AND table_version = ?
         AND is_primary = 1
       ORDER BY score DESC`
    )
    .bind(periodTag, tableVersion)
    .all())
    .results ?? []) as Array<{
      target_quest_id: number;
      prereq_set_json: string;
      score: number;
      is_primary: number;
      class: string;
    }>;

  const nodes = new Set<number>();
  const graphEdges: Array<{ from: number; to: number; score: number; class: string }> = [];

  for (const row of edges) {
    const target = toInt(row.target_quest_id);
    if (target == null) continue;
    const prereqs = parseJsonArray<number>(row.prereq_set_json)
      .map((v) => toInt(v))
      .filter((v): v is number => v != null);

    nodes.add(target);
    for (const from of prereqs) {
      nodes.add(from);
      graphEdges.push({ from, to: target, score: Number(row.score ?? 0), class: row.class });
    }
  }

  return c.json({
    ok: true,
    period_tag: periodTag,
    table_version: tableVersion,
    nodes: [...nodes].sort((a, b) => a - b),
    edges: graphEdges,
  });
});

app.get("/changes", async (c) => {
  const db = c.env.QUEST_INDEX_DB;
  if (!db) return c.json({ error: "QUEST_INDEX_DB not configured" }, 503);

  const datasetId = (c.req.query("dataset_id") ?? "").trim();
  const since = Math.max(0, toInt(c.req.query("since")) ?? 0);

  if (!datasetId) {
    return c.json({ error: "dataset_id query is required" }, 400);
  }

  const appearances = ((await db
    .prepare(
      `SELECT target_quest_id, appeared_at_ms, collection_session_id, is_bootstrap_unknown
       FROM quest_appearance_events
       WHERE dataset_id = ? AND appeared_at_ms >= ?
       ORDER BY appeared_at_ms ASC
       LIMIT 500`
    )
    .bind(datasetId, since)
    .all())
    .results ?? []) as Array<{
      target_quest_id: number;
      appeared_at_ms: number;
      collection_session_id: string;
      is_bootstrap_unknown: number;
    }>;

  const states = ((await db
    .prepare(
      `SELECT quest_id, event_type, state_after, timestamp_ms, collection_session_id
       FROM quest_state_events
       WHERE dataset_id = ? AND timestamp_ms >= ?
       ORDER BY timestamp_ms ASC
       LIMIT 500`
    )
    .bind(datasetId, since)
    .all())
    .results ?? []);

  return c.json({ ok: true, dataset_id: datasetId, since, appearances, states });
});

export default app;
