import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Bindings, D1Database, D1Result } from "../types";
import {
  CORS_HEADERS,
  MAX_QUEST_TREE_UPLOAD_BYTES,
} from "../constants";
import {
  createEnvContext,
  generateSignedToken,
  getEnv,
  parseStrictBoolean,
  resolveDatasetToken,
  timingSafeEqual,
  validateDatasetTokenSecret,
  validateDatasetTokenWithConstraints,
  resolveDatasetTokenRevocationConfig,
  validateTokenPayloadWithSchema,
  verifySignedToken,
  safeWaitUntil,
  safeGetExecutionCtx,
} from "../utils";
import {
  invalidateCanonicalSnapshots,
  loadOrRefreshCanonicalSnapshot,
} from "../utils/snapshot-cache";
import { validateCachedPeriodTag } from "../utils/period-tags";
import { readBodyWithinLimit } from "../utils/upload";
import { QuestTreeUploadTokenPayloadSchema } from "../schemas/tokens";
import { PublicIdSchema } from "../schemas/public-id";
import {
  QuestCollectionSessionRowSchema,
  QuestIngestConflictRowSchema,
  QuestIngestEventIdRowSchema,
  QuestAppearanceEventRowSchema,
  QuestRuleRowsSchema,
  QuestRuleUpdatedRowSchema,
  QuestSnapshotPageRowSchema,
  QuestStateEventRowSchema,
  QuestTreeIngestBodySchema,
  ValidatedQuestTreeIngestBodySchema,
  type QuestListEntry,
  type QuestRuleRow,
  type QuestTreeIngestBody,
} from "../schemas/quest-tree";

const app = new Hono<{ Bindings: Bindings }>();

const GAP_THRESHOLD_MS = 30 * 60 * 1000;
const RECENT_WINDOW_MS = 10 * 60 * 1000;
const QUEST_TREE_HANDSHAKE_MAX_BYTES = MAX_QUEST_TREE_UPLOAD_BYTES + 64 * 1024;
const QUEST_CHANGES_CACHE_CONTROL =
  "public, max-age=60, stale-while-revalidate=300";

const KV_SNAPSHOT_TTL_MS = 60 * 60 * 1000;

function parseQuestRuleRowsStrict(value: unknown): QuestRuleRow[] {
  const parsed = QuestRuleRowsSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Invalid quest rule rows");
  }
  return parsed.data;
}
const KV_EXPIRATION_TTL_S = 7 * 24 * 60 * 60;

const QUEST_TREE_COLLECTION_SWITCH_ENV =
  "QUEST_TREE_EXPERIMENTAL_COLLECTION_ENABLED";

app.options(
  "*",
  (_c) => new Response(null, { status: 204, headers: CORS_HEADERS }),
);

type IngestBody = QuestTreeIngestBody;

type RulesSnapshot = {
  period_tag: string;
  table_version: string;
  target_quest_id: number;
  include_low: boolean;
  rows: QuestRuleRow[];
  refreshed_at: number;
  db_synced_at: number;
};

type GraphSnapshot = {
  period_tag: string;
  table_version: string;
  rows: QuestRuleRow[];
  refreshed_at: number;
  db_synced_at: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRulesSnapshot(v: unknown): v is RulesSnapshot {
  if (!isRecord(v)) return false;
  const s = v;
  return (
    typeof s["period_tag"] === "string" &&
    typeof s["table_version"] === "string" &&
    typeof s["target_quest_id"] === "number" &&
    typeof s["include_low"] === "boolean" &&
    Array.isArray(s["rows"]) &&
    typeof s["refreshed_at"] === "number" &&
    typeof s["db_synced_at"] === "number"
  );
}

function isGraphSnapshot(v: unknown): v is GraphSnapshot {
  if (!isRecord(v)) return false;
  const s = v;
  return (
    typeof s["period_tag"] === "string" &&
    typeof s["table_version"] === "string" &&
    Array.isArray(s["rows"]) &&
    typeof s["refreshed_at"] === "number" &&
    typeof s["db_synced_at"] === "number"
  );
}

function nowMs(): number {
  return Date.now();
}

async function invalidateQuestTreeCaches(
  cache: Cache,
  requestUrl: string,
): Promise<void> {
  const url = new URL(requestUrl);
  const targets = [
    new URL("/quest-tree/rules", url.origin).toString(),
    new URL("/quest-tree/graph", url.origin).toString(),
    new URL("/api/quest-tree/rules", url.origin).toString(),
    new URL("/api/quest-tree/graph", url.origin).toString(),
  ];

  for (const target of targets) {
    try {
      await cache.delete(new Request(target, { method: "GET" }));
    } catch (err) {
      console.warn("[quest-tree] Failed to invalidate cache:", target, err);
    }
  }
}

function scheduleQuestTreeTask(
  c: Context<{ Bindings: Bindings }>,
  task: Promise<unknown>,
): void {
  safeWaitUntil(c, task);
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
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `${prefix}-${Date.now()}-${random}`;
}

function isQuestTreeCollectionEnabled(
  env: ReturnType<typeof createEnvContext>,
): boolean {
  const raw = getEnv(env, QUEST_TREE_COLLECTION_SWITCH_ENV);
  return parseStrictBoolean(raw, QUEST_TREE_COLLECTION_SWITCH_ENV);
}

function parseJsonArray<T>(
  raw: unknown,
  parseItem: (value: unknown) => T | null,
): T[] {
  if (!raw || typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed
          .map(parseItem)
          .filter((value): value is T => value !== null)
      : [];
  } catch {
    return [];
  }
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    data as unknown as BufferSource,
  );
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

  const parsed = ValidatedQuestTreeIngestBodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid JSON body",
    };
  }

  const parsedBody = parsed.data;
  const datasetId = parsedBody.dataset_id ?? "";
  const requestId = parsedBody.request_id ?? "";
  const payloadHash = parsedBody.payload_hash ?? "";
  const eventType = parsedBody.event_type ?? "";
  const periodTag = parsedBody.period_tag ?? "";
  const tableVersion = parsedBody.table_version ?? "";
  const atMs = parsedBody.timestamp_ms ?? nowMs();

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

  const existingResult = await db
    .prepare(
      `SELECT id FROM quest_ingest_events WHERE request_id = ? AND payload_hash = ? LIMIT 1`,
    )
    .bind(requestId, payloadHash)
    .first<D1Result>();
  const parsedExisting = QuestIngestEventIdRowSchema.safeParse(existingResult);
  if (!parsedExisting.success) {
    return {
      status: 500,
      body: { error: "Invalid quest ingest lookup response" },
    };
  }

  if (parsedExisting.data?.id) {
    return {
      status: 200,
      body: { ok: true, idempotent: true, message: "already ingested" },
    };
  }

  const conflictResult = await db
    .prepare(
      `SELECT id, payload_hash
       FROM quest_ingest_events
       WHERE request_id = ?
       LIMIT 1`,
    )
    .bind(requestId)
    .first<D1Result>();
  const parsedConflict = QuestIngestConflictRowSchema.safeParse(conflictResult);
  if (!parsedConflict.success) {
    return {
      status: 500,
      body: { error: "Invalid quest conflict lookup response" },
    };
  }

  if (
    parsedConflict.data?.id &&
    parsedConflict.data.payload_hash !== payloadHash
  ) {
    return {
      status: 409,
      body: {
        error: "request_id conflict",
        message: "Same request_id already exists with different payload_hash",
        existing_request_id: requestId,
        existing_payload_hash: parsedConflict.data.payload_hash,
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

    const shouldEnqueueTask =
      session.bootstrapCompleted || bootstrapNowCompleted;
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
  // Compute SHA-256 hashes in parallel, then batch-insert to avoid N sequential D1 round-trips.
  type QuestCandidate = {
    questId: number;
    title: string;
    detail: string;
    questType: number;
    category: number;
    labelType: number;
    masterHash: string;
  };

  const candidates = await Promise.all(
    quests.map(async (q): Promise<QuestCandidate | null> => {
      const questId = toInt(q.quest_id);
      if (questId == null || questId <= 0) return null;

      const title = typeof q.title === "string" ? q.title.trim() : "";
      const detail = typeof q.detail === "string" ? q.detail.trim() : "";
      if (!title || !detail) return null;

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

      return {
        questId,
        title,
        detail,
        questType,
        category,
        labelType,
        masterHash,
      };
    }),
  );

  const stmts = candidates
    .filter((c): c is QuestCandidate => c !== null)
    .map((c) =>
      db
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
           WHERE quest_master_entries.master_hash <> excluded.master_hash`,
        )
        .bind(
          c.questId,
          periodTag,
          tableVersion,
          c.title,
          c.detail,
          c.questType,
          c.category,
          c.labelType,
          c.masterHash,
          nowMs(),
          nowMs(),
        ),
    );

  const BATCH_SIZE = 100;
  for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
    await db.batch(stmts.slice(i, i + BATCH_SIZE));
  }
}

export async function getOrCreateSession(
  db: D1Database,
  datasetId: string,
  atMs: number,
): Promise<{ sessionId: string; isNew: boolean; bootstrapCompleted: boolean }> {
  const latestResult = await db
    .prepare(
      `SELECT collection_session_id, ended_at_ms, bootstrap_completed_at_ms
       FROM quest_collection_sessions
       WHERE dataset_id = ?
       ORDER BY started_at_ms DESC
       LIMIT 1`,
    )
    .bind(datasetId)
    .first<D1Result>();
  const parsedLatest = QuestCollectionSessionRowSchema.safeParse(latestResult);
  if (!parsedLatest.success) {
    throw new Error("Invalid quest collection session lookup response");
  }
  const latest = parsedLatest.data;

  const latestSessionId = latest?.collection_session_id ?? null;
  const latestEndedAt = toInt(latest?.ended_at_ms) ?? null;
  const latestBootstrap = toInt(latest?.bootstrap_completed_at_ms) ?? null;

  if (
    latestSessionId &&
    latestEndedAt != null &&
    atMs - latestEndedAt <= GAP_THRESHOLD_MS
  ) {
    await db
      .prepare(
        `UPDATE quest_collection_sessions
         SET ended_at_ms = ?
         WHERE collection_session_id = ?`,
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
  const insertResult = await db
    .prepare(
      `INSERT OR IGNORE INTO quest_collection_sessions (
         collection_session_id,
         dataset_id,
         started_at_ms,
         ended_at_ms,
         start_reason,
         has_data_gap,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      sessionId,
      datasetId,
      atMs,
      atMs,
      latestSessionId ? "resume" : "bootstrap",
      latestSessionId ? 1 : 0,
      atMs,
    )
    .run();

  // INSERT OR IGNORE returns rows_written = 0 when UNIQUE(dataset_id, started_at_ms) fires,
  // meaning a concurrent request already inserted a session for this exact millisecond.
  // Re-query to get the canonical (winning) session so both requests converge on the same row.
  const inserted = (insertResult.meta?.rows_written ?? 1) > 0;
  let effectiveSessionId = sessionId;
  let effectiveBootstrapCompleted = false;
  if (!inserted) {
    const concurrentSessionResult = await db
      .prepare(
        `SELECT collection_session_id, ended_at_ms, bootstrap_completed_at_ms
         FROM quest_collection_sessions
         WHERE dataset_id = ? AND started_at_ms = ?`,
      )
      .bind(datasetId, atMs)
      .first<D1Result>();
    const parsedConcurrentSession = QuestCollectionSessionRowSchema.safeParse(
      concurrentSessionResult,
    );
    if (!parsedConcurrentSession.success) {
      throw new Error("Invalid concurrent quest session lookup response");
    }
    const concurrentSession = parsedConcurrentSession.data;
    if (!concurrentSession) {
      throw new Error("Concurrent quest collection session was not found");
    }
    effectiveSessionId = concurrentSession.collection_session_id;
    effectiveBootstrapCompleted =
      concurrentSession.bootstrap_completed_at_ms != null;
  }

  return {
    sessionId: effectiveSessionId,
    isNew: inserted,
    bootstrapCompleted: inserted ? false : effectiveBootstrapCompleted,
  };
}

async function markBootstrapCompleted(
  db: D1Database,
  sessionId: string,
  atMs: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE quest_collection_sessions
       SET bootstrap_completed_at_ms = ?, ended_at_ms = ?
       WHERE collection_session_id = ? AND bootstrap_completed_at_ms IS NULL`,
    )
    .bind(atMs, atMs, sessionId)
    .run();
  return Number(result.meta?.changes ?? 1) > 0;
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
       ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
    )
    .bind(
      taskId,
      datasetId,
      sessionId,
      Math.max(0, atMs - RECENT_WINDOW_MS),
      atMs + 1,
      atMs,
      atMs,
    )
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
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ingested', ?)`,
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
    await upsertQuestMasterEntries(
      db,
      params.periodTag,
      params.tableVersion,
      quests,
    );
    const visibleQuestIds = toVisibleQuestIds(quests);

    const previousSnapshotsResult = await db
      .prepare(
        `SELECT page_no, visible_quest_ids_json
       FROM questlist_snapshots
       WHERE dataset_id = ?
         AND collection_session_id = ?
       ORDER BY captured_at_ms DESC`,
      )
      .bind(params.datasetId, params.sessionId)
      .all();
    const parsedPreviousSnapshots = QuestSnapshotPageRowSchema.array().safeParse(
      previousSnapshotsResult.results ?? [],
    );
    if (!parsedPreviousSnapshots.success) {
      throw new Error("Invalid quest snapshot page rows");
    }
    const previousSnapshots = parsedPreviousSnapshots.data;

    const latestByPage = new Map<number, number[]>();
    for (const snap of previousSnapshots) {
      const page = toInt(snap.page_no);
      if (page == null || latestByPage.has(page)) continue;
      latestByPage.set(
        page,
        parseJsonArray(snap.visible_quest_ids_json, toInt),
      );
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
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      bootstrapNowCompleted = await markBootstrapCompleted(
        db,
        params.sessionId,
        params.atMs,
      );
    } else {
      const appeared = setDiff(visibleQuestIds, [...previousGlobalVisible]);
      if (appeared.length > 0) {
        const appearanceMs = nowMs();
        const appearStmts = appeared.map((targetQuestId) =>
          db
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
               ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 0, ?)`,
            )
            .bind(
              params.datasetId,
              params.sessionId,
              targetQuestId,
              params.atMs,
              params.eventType,
              params.periodTag,
              params.tableVersion,
              appearanceMs,
            ),
        );
        // D1 batch limit: 100 statements per call
        for (let i = 0; i < appearStmts.length; i += 100) {
          await db.batch(appearStmts.slice(i, i + 100));
        }
      }
    }
  } else if (params.questId != null && params.questId > 0) {
    const stateAfter =
      params.eventType === "start"
        ? "active"
        : params.eventType === "stop"
          ? "visible_inactive"
          : "claimed";

    const stateEventMs = nowMs();
    // Batch both writes atomically: if the Worker is killed between them the
    // quest_state_events row and quest_state_latest row would diverge.
    await db.batch([
      db
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
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          stateEventMs,
        ),
      db
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
             is_claimed = excluded.is_claimed`,
        )
        .bind(
          params.datasetId,
          params.questId,
          params.sessionId,
          stateAfter,
          params.atMs,
          params.eventType,
          params.periodTag,
          params.tableVersion,
          params.eventType === "complete" ? 1 : 0,
        ),
    ]);
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
    const handshakeRead = await readBodyWithinLimit(
      c.req.raw,
      QUEST_TREE_HANDSHAKE_MAX_BYTES,
    );
    if (handshakeRead.kind === "too_large") {
      return c.json({ error: "Request body exceeds maximum size" }, 413);
    }
    let rawHandshakeBody: unknown = null;
    if (handshakeRead.kind === "ok") {
      try {
        rawHandshakeBody = JSON.parse(
          new TextDecoder().decode(handshakeRead.data),
        );
      } catch {
        rawHandshakeBody = null;
      }
    }
    const handshakeParsed = QuestTreeIngestBodySchema.safeParse(
      rawHandshakeBody,
    );
    if (!handshakeParsed.success) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const handshakeBody = {
      ...handshakeParsed.data,
      quests: handshakeParsed.data.quests ?? [],
    };

    const validated = validateIngestBody(handshakeBody);
    if (!validated.ok) return c.json({ error: validated.error }, 400);
    const periodTagValidation = await validateCachedPeriodTag(
      c,
      validated.periodTag,
      { cacheKV: c.env.DATA_LOADER_CACHE_KV },
    );
    if (!periodTagValidation.ok) {
      return c.json(
        { error: periodTagValidation.error },
        periodTagValidation.status,
      );
    }

    // Require dataset_token possession and bind the request to its dataset_id.
    const datasetToken = resolveDatasetToken(
      c.req.header("X-Dataset-Token"),
      handshakeBody.dataset_token,
    );
    const datasetTokenSecret = getEnv(env, "DATASET_TOKEN_SECRET");
    // Validate secret length upfront
    const secretValidation = validateDatasetTokenSecret(datasetTokenSecret);
    if (!secretValidation.ok) {
      return c.json({ error: secretValidation.error }, 500);
    }
    const tokenValidation = await validateDatasetTokenWithConstraints({
      token: datasetToken,
      secret: datasetTokenSecret,
      expectedDatasetId: validated.datasetId,
      revocation: resolveDatasetTokenRevocationConfig(env),
      // expectedUserId は検証しない: 複数端末では端末ごとの匿名 user_id が異なるため。
      // データ帰属は dataset_id (public_id) の照合で担保する。
    });
    if (!tokenValidation.ok) {
      return c.json(
        { error: tokenValidation.error },
        tokenValidation.status ?? 401,
      );
    }
    // dataset_token.sub を actingUserId として使う（全端末で一貫した帰属者）
    const actingUserId = tokenValidation.token!.user_id;

    const contentHash = handshakeBody.content_hash ?? "";
    if (!contentHash) {
      return c.json({ error: "content_hash is required" }, 400);
    }

    const declaredSize = handshakeBody.file_size ?? 0;
    if (declaredSize <= 0) {
      return c.json({ error: "file_size must be > 0" }, 400);
    }
    if (declaredSize > MAX_QUEST_TREE_UPLOAD_BYTES) {
      return c.json(
        {
          error: `file_size exceeds maximum of ${MAX_QUEST_TREE_UPLOAD_BYTES} bytes`,
        },
        400,
      );
    }

    const token = await generateSignedToken(
      {
        user_id: actingUserId,
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
    // stripApiPrefix() in [...route].ts removes /api/ before Hono sees the URL;
    // restore it so Stage-2 clients post to the API endpoint.
    if (!uploadUrl.pathname.startsWith("/api/")) {
      uploadUrl.pathname =
        "/api" +
        (uploadUrl.pathname.startsWith("/")
          ? uploadUrl.pathname
          : `/${uploadUrl.pathname}`);
    }
    return c.json({
      uploadUrl: uploadUrl.toString(),
      token,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
  }

  const tokenPayload = await verifySignedToken(uploadToken, signingSecret);
  if (!tokenPayload)
    return c.json({ error: "Invalid or expired upload token" }, 401);

  const payloadValidation = validateTokenPayloadWithSchema(
    tokenPayload,
    QuestTreeUploadTokenPayloadSchema,
  );
  if (!payloadValidation.valid) {
    return c.json(
      { error: payloadValidation.error ?? "Invalid upload token payload" },
      400,
    );
  }
  const validatedPayload = payloadValidation.data;
  // user_id 照合は行わない: upload token の user_id は dataset_token.sub（帰属者）であり
  // JWT user_id（端末固有）と一致しないことがある。JWT 有効性は上で確認済み。

  const bodyResult = await readBodyWithinLimit(
    c.req.raw,
    MAX_QUEST_TREE_UPLOAD_BYTES,
  );
  if (bodyResult.kind === "missing") {
    return c.json({ error: "Upload payload is missing" }, 400);
  }
  if (bodyResult.kind === "too_large") {
    return c.json({ error: "request_too_large" }, 413);
  }
  const uploaded = bodyResult.data;

  const declaredSize = validatedPayload.declared_size;
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
  const expectedHash = validatedPayload.content_hash.toLowerCase();
  if (!timingSafeEqual(actualHash.toLowerCase(), expectedHash)) {
    return c.json(
      {
        error: "Content hash mismatch - data may be corrupted",
      },
      400,
    );
  }

  const rawBody = (() => {
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(uploaded));
      return parsed;
    } catch {
      return null;
    }
  })();
  if (rawBody === null) {
    return c.json({ error: "Invalid JSON upload payload" }, 400);
  }
  const bodyParsed = QuestTreeIngestBodySchema.safeParse(rawBody);
  if (!bodyParsed.success) {
    return c.json({ error: "Invalid JSON upload payload" }, 400);
  }
  const body = {
    ...bodyParsed.data,
    quests: bodyParsed.data.quests ?? [],
  };
  const verified = validateIngestBody(body);
  if (!verified.ok) return c.json({ error: verified.error }, 400);
  const periodTagValidation = await validateCachedPeriodTag(
    c,
    verified.periodTag,
    { cacheKV: c.env.DATA_LOADER_CACHE_KV },
  );
  if (!periodTagValidation.ok) {
    return c.json(
      { error: periodTagValidation.error },
      periodTagValidation.status,
    );
  }

  if (
    verified.datasetId !== validatedPayload.dataset_id ||
    verified.requestId !== validatedPayload.request_id ||
    verified.eventType !== validatedPayload.event_type
  ) {
    return c.json(
      { error: "Upload payload does not match upload token claims" },
      400,
    );
  }

  const result = await ingestQuestBody(db, body);

  // Best-effort cache invalidation after successful ingest
  if (result.status === 200) {
    const periodTag = (body.period_tag ?? "").trim();
    const tableVersion = (body.table_version ?? "").trim();
    if (periodTag && tableVersion) {
      scheduleQuestTreeTask(
        c,
        (async () => {
          await invalidateCanonicalSnapshots(c.env.DATA_LOADER_CACHE_KV, [
            `qtree:graph:${periodTag}:${tableVersion}`,
          ]);
          try {
            await app.request(
              `/graph?period_tag=${periodTag}&table_version=${tableVersion}`,
              {},
              c.env,
              safeGetExecutionCtx(c),
            );
          } catch (err) {
            console.warn("[quest-tree] Failed to pre-warm caches:", err);
          }
        })()
      );
    }

    const cache = (globalThis as { caches?: { default?: Cache } }).caches
      ?.default;
    if (cache) {
      scheduleQuestTreeTask(c, invalidateQuestTreeCaches(cache, c.req.url));
    }
  }

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

  const kv = c.env.DATA_LOADER_CACHE_KV;
  const cacheKey = `qtree:rules:${periodTag}:${tableVersion}:${target}:${includeLow ? 1 : 0}`;

  const { snapshot, cacheStatus } = await loadOrRefreshCanonicalSnapshot({
    kv,
    cacheKey,
    ttlMs: KV_SNAPSHOT_TTL_MS,
    expirationTtlSeconds: KV_EXPIRATION_TTL_S,
    probeWhenFresh: true,
    isValidSnapshot: isRulesSnapshot,
    refreshFromDelta: async (cached) => {
      const changedRowsResult = await db
        .prepare(
          `SELECT updated_at_ms
           FROM quest_rule_edges
           WHERE target_quest_id = ?
             AND period_tag = ?
             AND table_version = ?
             AND updated_at_ms > ?
           ORDER BY updated_at_ms DESC`,
        )
        .bind(target, periodTag, tableVersion, cached.db_synced_at)
        .all();
      const parsedChangedRows = z
        .array(z.object({ updated_at_ms: z.number().finite() }).passthrough())
        .safeParse(changedRowsResult.results ?? []);
      if (!parsedChangedRows.success) {
        throw new Error("Invalid quest rule change rows");
      }
      const changedRows = parsedChangedRows.data;

      if (changedRows.length === 0) {
        return {
          changed: false,
          snapshot: {
            ...cached,
            refreshed_at: Date.now(),
          },
        };
      }

      // Re-load the full current view for this target when anything changed.
      // This avoids stale rows when a rule's quality_tier transitions to/from low.
      const rows = parseQuestRuleRowsStrict(
        (
          await db
            .prepare(
              `SELECT rule_id, target_quest_id, prereq_set_json, set_size, class, support, confidence, lift, score, period_tag, table_version, is_primary, quality_tier, updated_at_ms
               FROM quest_rule_edges
               WHERE target_quest_id = ?
                 AND period_tag = ?
                 AND table_version = ?
                 AND (? = 1 OR quality_tier != 'low')
               ORDER BY is_primary DESC, score DESC`,
            )
            .bind(target, periodTag, tableVersion, includeLow ? 1 : 0)
            .all()
        ).results ?? [],
      );

      const maxUpdatedAt = changedRows.reduce(
        (max, row) => Math.max(max, Number(row.updated_at_ms) || 0),
        0,
      );

      return {
        changed: true,
        snapshot: {
          ...cached,
          rows,
          refreshed_at: Date.now(),
          db_synced_at: Math.max(cached.db_synced_at, maxUpdatedAt),
        },
      };
    },
    loadFull: async () => {
      const rows = parseQuestRuleRowsStrict(
        (
          await db
            .prepare(
              `SELECT rule_id, target_quest_id, prereq_set_json, set_size, class, support, confidence, lift, score, period_tag, table_version, is_primary, quality_tier, updated_at_ms
               FROM quest_rule_edges
               WHERE target_quest_id = ?
                 AND period_tag = ?
                 AND table_version = ?
                 AND (? = 1 OR quality_tier != 'low')
               ORDER BY is_primary DESC, score DESC`,
            )
            .bind(target, periodTag, tableVersion, includeLow ? 1 : 0)
            .all()
        ).results ?? [],
      );

      const maxUpdatedAt = rows.reduce(
        (max, row) => Math.max(max, Number(row.updated_at_ms) || 0),
        0,
      );

      return {
        period_tag: periodTag,
        table_version: tableVersion,
        target_quest_id: target,
        include_low: includeLow,
        rows,
        refreshed_at: Date.now(),
        db_synced_at: maxUpdatedAt,
      };
    },
  });

  const response = c.json({
    ok: true,
    target,
    period_tag: periodTag,
    table_version: tableVersion,
    rules: snapshot.rows,
  });
  response.headers.set(
    "Cache-Control",
    "public, max-age=3600, stale-while-revalidate=86400",
  );
  response.headers.set("X-FUSOU-Cache", cacheStatus);
  return response;
});

app.get("/graph", async (c) => {
  const db = c.env.QUEST_INDEX_DB;
  if (!db) return c.json({ error: "QUEST_INDEX_DB not configured" }, 503);

  const periodTag = (c.req.query("period_tag") ?? "latest").trim() || "latest";
  const tableVersion = (c.req.query("table_version") ?? "0.5").trim() || "0.5";

  const kv = c.env.DATA_LOADER_CACHE_KV;
  const cacheKey = `qtree:graph:${periodTag}:${tableVersion}`;

  const { snapshot, cacheStatus } = await loadOrRefreshCanonicalSnapshot({
    kv,
    cacheKey,
    ttlMs: KV_SNAPSHOT_TTL_MS,
    expirationTtlSeconds: KV_EXPIRATION_TTL_S,
    probeWhenFresh: true,
    isValidSnapshot: isGraphSnapshot,
    refreshFromDelta: async (cached) => {
      const changedTargetsResult = await db
        .prepare(
          `SELECT DISTINCT target_quest_id, updated_at_ms
           FROM quest_rule_edges
           WHERE period_tag = ?
             AND table_version = ?
             AND updated_at_ms > ?`,
        )
        .bind(periodTag, tableVersion, cached.db_synced_at)
        .all();
      const parsedChangedTargets = z
        .array(QuestRuleUpdatedRowSchema)
        .safeParse(changedTargetsResult.results ?? []);
      if (!parsedChangedTargets.success) {
        throw new Error("Invalid quest rule target change rows");
      }
      const changedTargets = parsedChangedTargets.data;

      if (changedTargets.length === 0) {
        return {
          changed: false,
          snapshot: {
            ...cached,
            refreshed_at: Date.now(),
          },
        };
      }

      const rowsByRuleId = new Map(
        cached.rows.map((row) => [row.rule_id, row]),
      );
      const targetSet = new Set<number>();
      for (const row of changedTargets) {
        const target = toInt(row.target_quest_id);
        if (target != null) targetSet.add(target);
      }

      for (const target of targetSet) {
        for (const [ruleId, row] of rowsByRuleId.entries()) {
          if (row.target_quest_id === target) rowsByRuleId.delete(ruleId);
        }

        const currentPrimaryRows = parseQuestRuleRowsStrict(
          (
            await db
              .prepare(
                `SELECT rule_id, target_quest_id, prereq_set_json, set_size, class, support, confidence, lift, score, period_tag, table_version, is_primary, quality_tier, updated_at_ms
                 FROM quest_rule_edges
                 WHERE period_tag = ?
                   AND table_version = ?
                   AND target_quest_id = ?
                   AND is_primary = 1
                 ORDER BY score DESC`,
              )
              .bind(periodTag, tableVersion, target)
              .all()
          ).results ?? [],
        );

        for (const row of currentPrimaryRows) {
          rowsByRuleId.set(row.rule_id, row);
        }
      }

      const maxUpdatedAt = changedTargets.reduce(
        (max, row) => Math.max(max, Number(row.updated_at_ms) || 0),
        0,
      );

      return {
        changed: true,
        snapshot: {
          ...cached,
          rows: Array.from(rowsByRuleId.values()).sort(
            (a, b) => b.score - a.score,
          ),
          refreshed_at: Date.now(),
          db_synced_at: Math.max(cached.db_synced_at, maxUpdatedAt),
        },
      };
    },
    loadFull: async () => {
      const rows = parseQuestRuleRowsStrict(
        (
          await db
            .prepare(
              `SELECT rule_id, target_quest_id, prereq_set_json, set_size, class, support, confidence, lift, score, period_tag, table_version, is_primary, quality_tier, updated_at_ms
               FROM quest_rule_edges
               WHERE period_tag = ?
                 AND table_version = ?
                 AND is_primary = 1
               ORDER BY score DESC`,
            )
            .bind(periodTag, tableVersion)
            .all()
        ).results ?? [],
      );

      const maxUpdatedAt = rows.reduce(
        (max, row) => Math.max(max, Number(row.updated_at_ms) || 0),
        0,
      );

      return {
        period_tag: periodTag,
        table_version: tableVersion,
        rows,
        refreshed_at: Date.now(),
        db_synced_at: maxUpdatedAt,
      };
    },
  });

  const nodes = new Set<number>();
  const graphEdges: Array<{
    from: number;
    to: number;
    score: number;
    class: string;
  }> = [];

  for (const row of snapshot.rows) {
    const target = toInt(row.target_quest_id);
    if (target == null) continue;
    const prereqs = parseJsonArray(row.prereq_set_json, toInt);

    nodes.add(target);
    for (const from of prereqs) {
      nodes.add(from);
      graphEdges.push({
        from,
        to: target,
        score: Number(row.score ?? 0),
        class: row.class,
      });
    }
  }

  const response = c.json({
    ok: true,
    period_tag: periodTag,
    table_version: tableVersion,
    nodes: [...nodes].sort((a, b) => a - b),
    edges: graphEdges,
  });
  response.headers.set(
    "Cache-Control",
    "public, max-age=3600, stale-while-revalidate=86400",
  );
  response.headers.set("X-FUSOU-Cache", cacheStatus);
  return response;
});

app.get("/changes", async (c) => {
  const db = c.env.QUEST_INDEX_DB;
  if (!db) return c.json({ error: "QUEST_INDEX_DB not configured" }, 503);

  const rawDatasetId = (c.req.query("dataset_id") ?? "").trim();
  const since = Math.max(0, toInt(c.req.query("since")) ?? 0);

  const parsedDatasetId = PublicIdSchema.safeParse(rawDatasetId);
  if (!parsedDatasetId.success) {
    return c.json({ error: "dataset_id must be a UUID v4 public_id" }, 400);
  }
  const datasetId = parsedDatasetId.data.toLowerCase();

  // Quest history is public aggregate data scoped by opaque dataset UUID.
  const appearanceResult = await db
    .prepare(
      `SELECT target_quest_id, appeared_at_ms, is_bootstrap_unknown
     FROM quest_appearance_events
     WHERE dataset_id = ? AND appeared_at_ms >= ?
     ORDER BY appeared_at_ms ASC
     LIMIT 500`,
    )
    .bind(datasetId, since)
    .all();
  const parsedAppearances = z
    .array(QuestAppearanceEventRowSchema)
    .safeParse(appearanceResult.results ?? []);
  if (!parsedAppearances.success) {
    return c.json({ error: "Invalid quest appearance rows" }, 500);
  }

  const stateResult = await db
    .prepare(
      `SELECT quest_id, event_type, state_after, timestamp_ms
     FROM quest_state_events
     WHERE dataset_id = ? AND timestamp_ms >= ?
     ORDER BY timestamp_ms ASC
     LIMIT 500`,
    )
    .bind(datasetId, since)
    .all();
  const parsedStates = z
    .array(QuestStateEventRowSchema)
    .safeParse(stateResult.results ?? []);
  if (!parsedStates.success) {
    return c.json({ error: "Invalid quest state rows" }, 500);
  }

  const response = c.json({
    ok: true,
    dataset_id: datasetId,
    since,
    appearances: parsedAppearances.data.map((row) => ({
      target_quest_id: row.target_quest_id,
      appeared_at_ms: row.appeared_at_ms,
      is_bootstrap_unknown: row.is_bootstrap_unknown,
    })),
    states: parsedStates.data.map((row) => ({
      quest_id: row.quest_id,
      event_type: row.event_type,
      state_after: row.state_after,
      timestamp_ms: row.timestamp_ms,
    })),
  });
  response.headers.set("Cache-Control", QUEST_CHANGES_CACHE_CONTROL);
  return response;
});

export default app;
