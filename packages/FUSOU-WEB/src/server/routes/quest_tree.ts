import { Hono } from "hono";
import { z } from "zod";
import type { Bindings, D1Database, D1Result } from "../types";
import {
  CORS_HEADERS,
  MAX_QUEST_TREE_UPLOAD_BYTES,
} from "../constants";
import {
  createEnvContext,
  getEnv,
  parseStrictBoolean,
  timingSafeEqual,
} from "../utils";
import { validateCachedPeriodTag } from "../utils/period-tags";
import { handleTwoStageUpload } from "../utils/upload";
import { QuestTreeUploadTokenPayloadSchema } from "../schemas/tokens";
import { PublicIdSchema } from "../schemas/public-id";
import {
  QuestCollectionSessionRowSchema,
  QuestIngestConflictRowSchema,
  QuestAppearanceEventRowSchema,
  QuestSnapshotPageRowSchema,
  QuestStateEventRowSchema,
  QuestTreeIngestBodySchema,
  ValidatedQuestTreeIngestBodySchema,
  type QuestListEntry,
  type QuestTreeIngestBody,
} from "../schemas/quest-tree";

const app = new Hono<{ Bindings: Bindings }>();

const GAP_THRESHOLD_MS = 30 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 60 * 1000;
const INGEST_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const INGEST_CLEANUP_BATCH_LIMIT = 200;
const QUEST_TREE_HANDSHAKE_MAX_BYTES = MAX_QUEST_TREE_UPLOAD_BYTES + 64 * 1024;
const QUEST_CHANGES_CACHE_CONTROL =
  "public, max-age=60, stale-while-revalidate=300";

const QUEST_TREE_COLLECTION_SWITCH_ENV =
  "QUEST_TREE_EXPERIMENTAL_COLLECTION_ENABLED";

app.options(
  "*",
  (_c) => new Response(null, { status: 204, headers: CORS_HEADERS }),
);

type IngestBody = QuestTreeIngestBody;

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

export async function ingestQuestBody(db: D1Database, body: IngestBody) {
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

  const questId = toInt(body.quest_id);
  const pageNo = toInt(body.page_no) ?? 0;

  if (eventType === "snapshot" && pageNo !== 0) {
    return {
      status: 200,
      body: {
        ok: true,
        idempotent: false,
        skipped: true,
        collection_session_id: null,
        task_id: null,
        task_enqueued: false,
      },
    };
  }

  const existingResult = await db
    .prepare(
      `SELECT id, payload_hash
       FROM quest_ingest_events
       WHERE request_id = ?
       LIMIT 1`,
    )
    .bind(requestId)
    .first<D1Result>();
  const parsedExisting = QuestIngestConflictRowSchema.safeParse(existingResult);
  if (!parsedExisting.success) {
    return {
      status: 500,
      body: { error: "Invalid quest ingest lookup response" },
    };
  }

  if (parsedExisting.data?.id) {
    if (parsedExisting.data.payload_hash === payloadHash) {
      return {
        status: 200,
        body: { ok: true, idempotent: true, message: "already ingested" },
      };
    }
    return {
      status: 409,
      body: {
        error: "request_id conflict",
        message: "Same request_id already exists with different payload_hash",
        existing_request_id: requestId,
        existing_payload_hash: parsedExisting.data.payload_hash,
      },
    };
  }

  const session = await getOrCreateSession(db, datasetId, atMs);

  try {
    if (session.isNew) {
      const retentionCutoffMs = nowMs() - INGEST_RETENTION_MS;
      await db
        .prepare(
          `DELETE FROM quest_ingest_events
           WHERE id IN (
             SELECT id
             FROM quest_ingest_events
             WHERE created_at < ?
             LIMIT ?
           )`,
        )
        .bind(retentionCutoffMs, INGEST_CLEANUP_BATCH_LIMIT)
        .run();
    }

    await processIngestEvents(db, {
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

    return {
      status: 200,
      body: {
        ok: true,
        idempotent: false,
        collection_session_id: session.sessionId,
        task_id: null,
        task_enqueued: false,
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
  quests: QuestListEntry[],
) {
  if (quests.length === 0) return;

  // Compute SHA-256 hashes in parallel and skip DB writes for unchanged quests.
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

  const uniqueByQuestId = new Map<number, QuestCandidate>();
  for (const c of candidates) {
    if (c) uniqueByQuestId.set(c.questId, c);
  }
  const uniqueCandidates = [...uniqueByQuestId.values()];
  if (uniqueCandidates.length === 0) return;

  const existingHashByQuestId = new Map<number, string>();
  const QUERY_CHUNK = 90;
  for (let i = 0; i < uniqueCandidates.length; i += QUERY_CHUNK) {
    const chunkIds = uniqueCandidates
      .slice(i, i + QUERY_CHUNK)
      .map((c) => c.questId);
    const placeholders = chunkIds.map(() => "?").join(", ");
    const existingRows = await db
      .prepare(
        `SELECT quest_id, master_hash
         FROM quest_master_entries
         WHERE quest_id IN (${placeholders})`,
      )
      .bind(...chunkIds)
      .all<{ quest_id: unknown; master_hash: unknown }>();
    for (const row of existingRows.results ?? []) {
      const qid = toInt(row.quest_id);
      const hash = typeof row.master_hash === "string" ? row.master_hash : "";
      if (qid != null && hash) {
        existingHashByQuestId.set(qid, hash);
      }
    }
  }

  const changedCandidates = uniqueCandidates.filter(
    (c) => existingHashByQuestId.get(c.questId) !== c.masterHash,
  );
  if (changedCandidates.length === 0) return;

  const timestamp = nowMs();
  const stmts = changedCandidates.map((c) =>
    db
      .prepare(
        `INSERT INTO quest_master_entries (
           quest_id,
           title,
           detail,
           quest_type,
           category,
           label_type,
           master_hash,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(quest_id) DO UPDATE SET
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
        c.title,
        c.detail,
        c.questType,
        c.category,
        c.labelType,
        c.masterHash,
        timestamp,
        timestamp,
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
    if (atMs - latestEndedAt >= SESSION_TOUCH_INTERVAL_MS) {
      await db
        .prepare(
          `UPDATE quest_collection_sessions
           SET ended_at_ms = ?
           WHERE collection_session_id = ?`,
        )
        .bind(atMs, latestSessionId)
        .run();
    }

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

function prepareMarkBootstrapCompleted(
  db: D1Database,
  sessionId: string,
  atMs: number,
) {
  return db
    .prepare(
      `UPDATE quest_collection_sessions
       SET bootstrap_completed_at_ms = ?, ended_at_ms = ?
       WHERE collection_session_id = ? AND bootstrap_completed_at_ms IS NULL`,
    )
    .bind(atMs, atMs, sessionId);
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

function buildQuestIngestEventStatement(
  db: D1Database,
  params: {
    requestId: string;
    payloadHash: string;
    datasetId: string;
    sessionId: string;
    eventType: string;
    questId?: number | null;
    pageNo?: number;
    atMs: number;
    periodTag: string;
    tableVersion: string;
  },
  createdAtMs: number,
) {
  return db
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
      params.pageNo ?? 0,
      params.atMs,
      params.periodTag,
      params.tableVersion,
      createdAtMs,
    );
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
): Promise<{ bootstrapNowCompleted: boolean; appearedCount: number }> {
  let bootstrapNowCompleted = false;
  let appearedCount = 0;

  if (params.eventType === "snapshot") {
    const pageNo = params.pageNo ?? 0;
    const eventNow = nowMs();

    if (pageNo !== 0) {
      await buildQuestIngestEventStatement(db, params, eventNow).run();
      return { bootstrapNowCompleted: false, appearedCount: 0 };
    }

    const quests = Array.isArray(params.quests) ? params.quests : [];
    await upsertQuestMasterEntries(db, quests);
    const visibleQuestIds = toVisibleQuestIds(quests);
    const visibleQuestIdsJson = JSON.stringify(visibleQuestIds);

    const previousSnapshotsResult = await db
      .prepare(
        `SELECT page_no, visible_quest_ids_json
         FROM questlist_snapshots
         WHERE dataset_id = ?
           AND collection_session_id = ?
           AND page_no = 0
         LIMIT 1`,
      )
      .bind(params.datasetId, params.sessionId)
      .all();
    const parsedPreviousSnapshots = QuestSnapshotPageRowSchema.array().safeParse(
      previousSnapshotsResult.results ?? [],
    );
    if (!parsedPreviousSnapshots.success) {
      throw new Error("Invalid quest snapshot page rows");
    }
    const previousGlobal = parsedPreviousSnapshots.data.find(
      (snap) => toInt(snap.page_no) === 0,
    );
    const shouldUpsertSnapshot =
      !previousGlobal ||
      previousGlobal.visible_quest_ids_json !== visibleQuestIdsJson;

    const batchStatements = [
      buildQuestIngestEventStatement(db, params, eventNow),
    ];

    if (shouldUpsertSnapshot) {
      batchStatements.push(
        db
          .prepare(
            `INSERT INTO questlist_snapshots (
               dataset_id,
               collection_session_id,
               page_no,
               visible_quest_ids_json,
               captured_at_ms,
               created_at
             ) VALUES (?, ?, 0, ?, ?, ?)
             ON CONFLICT(dataset_id, page_no) DO UPDATE SET
               collection_session_id = excluded.collection_session_id,
               visible_quest_ids_json = excluded.visible_quest_ids_json,
               captured_at_ms = excluded.captured_at_ms,
               created_at = excluded.created_at
             WHERE questlist_snapshots.collection_session_id <> excluded.collection_session_id
                OR questlist_snapshots.visible_quest_ids_json <> excluded.visible_quest_ids_json`,
          )
          .bind(
            params.datasetId,
            params.sessionId,
            visibleQuestIdsJson,
            params.atMs,
            eventNow,
          ),
      );
    }

    let bootstrapStmtIndex = -1;
    let appearanceStartIndex = -1;
    if (!params.isBootstrapCompleted) {
      bootstrapStmtIndex = batchStatements.length;
      batchStatements.push(
        prepareMarkBootstrapCompleted(db, params.sessionId, params.atMs),
      );
    } else if (previousGlobal) {
      const appeared = setDiff(
        visibleQuestIds,
        parseJsonArray(previousGlobal.visible_quest_ids_json, toInt),
      );
      if (appeared.length > 0) {
        appearanceStartIndex = batchStatements.length;
        for (const targetQuestId of appeared) {
          batchStatements.push(
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
                eventNow,
              ),
          );
        }
      }
    }

    // D1 batch limit: 100 statements per call.
    const batchResults: Array<{ meta?: { changes?: unknown } }> = [];
    for (let i = 0; i < batchStatements.length; i += 100) {
      const chunkResults = await db.batch(batchStatements.slice(i, i + 100));
      batchResults.push(
        ...(chunkResults as Array<{ meta?: { changes?: unknown } }>),
      );
    }

    if (bootstrapStmtIndex >= 0) {
      bootstrapNowCompleted =
        Number(batchResults[bootstrapStmtIndex]?.meta?.changes ?? 1) > 0;
    }
    if (appearanceStartIndex >= 0) {
      for (let i = appearanceStartIndex; i < batchResults.length; i += 1) {
        appearedCount += Number(batchResults[i]?.meta?.changes ?? 0);
      }
    }
  } else {
    const stateEventMs = nowMs();
    const batchStatements = [
      buildQuestIngestEventStatement(db, params, stateEventMs),
    ];

    if (params.questId != null && params.questId > 0) {
      const stateAfter =
        params.eventType === "start"
          ? "active"
          : params.eventType === "stop"
            ? "visible_inactive"
            : "claimed";

      batchStatements.push(
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
      );
    }

    await db.batch(batchStatements);
  }

  return { bootstrapNowCompleted, appearedCount };
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

  return handleTwoStageUpload(c, {
    signingSecret,
    requireDatasetToken: true,
    tokenTTL: () => 300,
    maxBodySize: MAX_QUEST_TREE_UPLOAD_BYTES,
    maxPreparationBodySize: QUEST_TREE_HANDSHAKE_MAX_BYTES,
    errorMessages: {
      preparationBodyTooLarge: "Request body exceeds maximum size",
      bodyTooLarge: "request_too_large",
    },
    preparationValidator: async (rawBody, _user, authContext) => {
      const handshakeParsed = QuestTreeIngestBodySchema.safeParse(rawBody);
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

      if (authContext.datasetToken?.dataset_id !== validated.datasetId) {
        return c.json({ error: "dataset_id mismatch" }, 403);
      }

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

      return {
        tokenPayload: {
          content_hash: contentHash,
          declared_size: declaredSize,
          dataset_id: validated.datasetId,
          request_id: validated.requestId,
          event_type: validated.eventType,
        },
      };
    },
    executionProcessor: async (tokenPayload, uploaded) => {
      const payloadValidation =
        QuestTreeUploadTokenPayloadSchema.safeParse(tokenPayload);
      if (!payloadValidation.success) {
        return c.json(
          { error: payloadValidation.error.message ?? "Invalid upload token payload" },
          400,
        );
      }
      const validatedPayload = payloadValidation.data;

      const declaredSize = validatedPayload.declared_size;
      if (uploaded.byteLength !== declaredSize) {
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
          { error: "Content hash mismatch - data may be corrupted" },
          400,
        );
      }

      let rawBody: unknown;
      try {
        rawBody = JSON.parse(new TextDecoder().decode(uploaded));
      } catch {
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
      return c.json(result.body, result.status as 200 | 400 | 409 | 500);
    },
  });
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
