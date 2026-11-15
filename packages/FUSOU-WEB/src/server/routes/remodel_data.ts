import { Hono, type Context } from "hono";
import type { Bindings } from "../types";
import {
  createEnvContext,
  getEnv,
  parseStrictBoolean,
  timingSafeEqual,
  safeWaitUntil,
  safeGetExecutionCtx,
} from "../utils";
import {
  invalidateCanonicalSnapshots,
  loadOrRefreshCanonicalSnapshot,
} from "../utils/snapshot-cache";
import {
  validateCachedPeriodTag,
} from "../utils/period-tags";
import { handleTwoStageUpload } from "../utils/upload";
import { UploadTokenPayloadSchema } from "../schemas/tokens";
import {
  RemodelDataIngestBodySchema,
  RemodelDetailArchiveRowSchema,
  RemodelChangedPeriodRowSchema,
  RemodelMaxUpdatedAtRowSchema,
  RemodelPeriodTagRowSchema,
  RemodelSlotlistArchiveRowSchema,
  parseRemodelEffectiveSummaryRows,
  parseRemodelPeriodSummaryRows,
  ValidatedRemodelDataIngestBodySchema,
  type RemodelDataIngestBody,
  type ValidatedRemodelDataIngestBody,
} from "../schemas/remodel-data";

const REMODEL_COLLECTION_SWITCH_ENV = "REMODEL_DATA_COLLECTION_ENABLED";
const KV_SNAPSHOT_TTL_MS = 60 * 60 * 1000;
const KV_EXPIRATION_TTL_S = 7 * 24 * 60 * 60;
const REMODEL_DATA_MAX_UPLOAD_BYTES = 5_000_000;
const REMODEL_DATA_HANDSHAKE_MAX_BYTES =
  REMODEL_DATA_MAX_UPLOAD_BYTES + 64 * 1024;

const app = new Hono<{ Bindings: Bindings }>();

type RemodelPeriodSummaryRow = ReturnType<
  typeof parseRemodelPeriodSummaryRows
>[number];

type RemodelSummarySnapshot = {
  periods: RemodelPeriodSummaryRow[];
  refreshed_at: number;
  db_synced_at: number;
};

function isRemodelSummarySnapshot(v: unknown): v is RemodelSummarySnapshot {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    Array.isArray(s["periods"]) &&
    s["periods"].every(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        typeof (p as Record<string, unknown>)["period_tag"] === "string",
    ) &&
      typeof s["refreshed_at"] === "number" &&
      typeof s["db_synced_at"] === "number"
  );
}

// ── Helpers ────────────────────────────────────────────────────────

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    data as unknown as BufferSource,
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function archiveAndResetOnPeriodSwitch(
  db: Bindings["REMODEL_INDEX_DB"],
  archiveBucket: Bindings["SHIP_GROWTH_ARCHIVE_BUCKET"] | undefined,
  incomingPeriodTag: string,
  nowMs: number,
): Promise<{
  stalePeriods: string[];
  latestPeriodTag: string | null;
  isStalePeriodTag: boolean;
}> {
  const periodsResult = await db
    .prepare(
      `SELECT DISTINCT period_tag FROM remodel_slotlist_entries
       UNION
       SELECT DISTINCT period_tag FROM remodel_detail_entries`,
    )
    .all();
  const parsedPeriods = RemodelPeriodTagRowSchema.array().safeParse(
    periodsResult.results ?? [],
  );
  if (!parsedPeriods.success) {
    throw new Error("Invalid remodel period rows");
  }
  const periods = parsedPeriods.data.map((row) => row.period_tag.trim()).filter(Boolean);

  const latestPeriodTag = periods.sort((a, b) => a.localeCompare(b)).at(-1) ?? null;
  if (latestPeriodTag && incomingPeriodTag < latestPeriodTag) {
    return { stalePeriods: [], latestPeriodTag, isStalePeriodTag: true };
  }

  const stalePeriods = periods.filter((tag) => tag !== incomingPeriodTag);
  if (stalePeriods.length === 0) {
    return { stalePeriods: [], latestPeriodTag, isStalePeriodTag: false };
  }

  if (!archiveBucket) {
    throw new Error(
      "SHIP_GROWTH_ARCHIVE_BUCKET is required when period_tag changes",
    );
  }

  const slotlistResult = await db
    .prepare(
      `SELECT period_tag, secretary_ship_master_id, weekday_jst,
              remodel_id, remodel_step_id, remodel_level, slotitem_master_id,
              sp_type, req_fuel, req_bull, req_steel, req_bauxite,
              req_buildkit, req_remodelkit, req_slot_id, req_slot_num,
              updated_at_ms
       FROM remodel_slotlist_entries
       WHERE period_tag <> ?
       ORDER BY secretary_ship_master_id, weekday_jst, slotitem_master_id, remodel_level`,
    )
    .bind(incomingPeriodTag)
    .all();
  const parsedSlotlistEntries = RemodelSlotlistArchiveRowSchema.array().safeParse(
    slotlistResult.results ?? [],
  );
  if (!parsedSlotlistEntries.success) {
    throw new Error("Invalid remodel slotlist archive rows");
  }

  const detailResult = await db
    .prepare(
      `SELECT period_tag, slotitem_master_id, remodel_id, remodel_step_id,
              remodel_level, certain_buildkit, certain_remodelkit,
              req_slot_id, req_slot_num, change_flag,
              req_useitem_id, req_useitem_id2, req_useitem_num, req_useitem_num2,
              updated_at_ms
       FROM remodel_detail_entries
       WHERE period_tag <> ?
       ORDER BY slotitem_master_id, remodel_level`,
    )
    .bind(incomingPeriodTag)
    .all();
  const parsedDetailEntries = RemodelDetailArchiveRowSchema.array().safeParse(
    detailResult.results ?? [],
  );
  if (!parsedDetailEntries.success) {
    throw new Error("Invalid remodel detail archive rows");
  }
  const slotlistEntries = parsedSlotlistEntries.data;
  const detailEntries = parsedDetailEntries.data;

  const archiveKey =
    `remodel/period-switch/${incomingPeriodTag}/${nowMs}-` +
    `${crypto.randomUUID()}.json`;
  await archiveBucket.put(
    archiveKey,
    JSON.stringify({
      archived_at_ms: nowMs,
      archived_period_tags: stalePeriods,
      incoming_period_tag: incomingPeriodTag,
      slotlist_entries: slotlistEntries,
      detail_entries: detailEntries,
    }),
    {
      httpMetadata: { contentType: "application/json" },
      customMetadata: {
        archived_period_tags: stalePeriods.join(","),
        incoming_period_tag: incomingPeriodTag,
      },
    },
  );

  return { stalePeriods, latestPeriodTag, isStalePeriodTag: false };
}

async function pruneStalePeriodsAfterSuccessfulIngest(
  db: Bindings["REMODEL_INDEX_DB"],
  incomingPeriodTag: string,
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM remodel_slotlist_entries
       WHERE period_tag <> ?
         AND ? >= (
           SELECT MAX(period_tag) FROM (
             SELECT period_tag FROM remodel_slotlist_entries
             UNION ALL SELECT period_tag FROM remodel_detail_entries
           )
         )`,
    )
    .bind(incomingPeriodTag, incomingPeriodTag)
    .run();
  await db
    .prepare(
      `DELETE FROM remodel_detail_entries
       WHERE period_tag <> ?
         AND ? >= (
           SELECT MAX(period_tag) FROM (
             SELECT period_tag FROM remodel_slotlist_entries
             UNION ALL SELECT period_tag FROM remodel_detail_entries
           )
         )`,
    )
    .bind(incomingPeriodTag, incomingPeriodTag)
    .run();
}

// ── Validation ─────────────────────────────────────────────────────

type ValidResult = {
  ok: true;
  body: ValidatedRemodelDataIngestBody;
  datasetId: string;
  requestId: string;
  payloadHash: string;
  eventType: "slotlist" | "detail";
  schemaVersion: number;
  periodTag: string;
  timestampMs: number;
};
type InvalidResult = { ok: false; error: string };

function parseRemodelDataIngestBody(
  value: unknown,
): RemodelDataIngestBody | null {
  const result = RemodelDataIngestBodySchema.safeParse(value);
  return result.success ? result.data : null;
}

function validateIngestBody(
  body: RemodelDataIngestBody | null,
): ValidResult | InvalidResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid JSON body" };
  }
  const result = ValidatedRemodelDataIngestBodySchema.safeParse(body);
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues[0]?.message ?? "Invalid JSON body",
    };
  }

  const parsedBody = result.data;
  return {
    ok: true,
    body: parsedBody,
    datasetId: parsedBody.dataset_id,
    requestId: parsedBody.request_id,
    payloadHash: parsedBody.payload_hash,
    eventType: parsedBody.event_type,
    schemaVersion: parsedBody.schema_version,
    periodTag: parsedBody.period_tag,
    timestampMs: parsedBody.timestamp_ms,
  };
}

// ── Cache helper ───────────────────────────────────────────────────

async function invalidateRemodelCaches(
  cache: Cache,
  requestUrl: string,
): Promise<void> {
  const url = new URL(requestUrl);
  const targets = [
    new URL("/remodel-data/summary", url.origin).toString(),
    new URL("/api/remodel-data/summary", url.origin).toString(),
    new URL("/remodel-data/effective-summary", url.origin).toString(),
    new URL("/api/remodel-data/effective-summary", url.origin).toString(),
  ];

  for (const target of targets) {
    try {
      await cache.delete(new Request(target, { method: "GET" }));
    } catch (err) {
      console.warn("[remodel-data] Failed to invalidate cache:", target, err);
    }
  }
}

function scheduleRemodelTask(
  c: Context<{ Bindings: Bindings }>,
  task: Promise<unknown>,
): void {
  safeWaitUntil(c, task);
}

// ── Public READ endpoint ───────────────────────────────────────────

/**
 * GET /summary — Aggregated overview of collected remodel data.
 * Returns distinct period_tags and slotitem coverage per period.
 * Cache: 1 h CF Cache.
 */
app.get("/summary", async (c) => {
  const db = c.env.REMODEL_INDEX_DB;
  if (!db) return c.json({ error: "REMODEL_INDEX_DB not configured" }, 503);

  try {
    const kv = c.env.DATA_LOADER_CACHE_KV;
    const cacheKey = "remodel:summary";

    const { snapshot, cacheStatus } = await loadOrRefreshCanonicalSnapshot({
      kv,
      cacheKey,
      ttlMs: KV_SNAPSHOT_TTL_MS,
      expirationTtlSeconds: KV_EXPIRATION_TTL_S,
      probeWhenFresh: true,
      isValidSnapshot: isRemodelSummarySnapshot,
      refreshFromDelta: async (cached) => {
        const changedPeriodsResult = await db
          .prepare(
            `SELECT period_tag, MAX(updated_at_ms) AS max_updated_at_ms
             FROM remodel_slotlist_effective_requirements
             WHERE updated_at_ms > ?
               GROUP BY period_tag`,
          )
          .bind(cached.db_synced_at)
          .all();
        const parsedChangedPeriods = RemodelChangedPeriodRowSchema.array().safeParse(
          changedPeriodsResult.results ?? [],
        );
        if (!parsedChangedPeriods.success) {
          throw new Error("Invalid remodel changed-period rows");
        }
        const changedPeriods = parsedChangedPeriods.data;

        if (changedPeriods.length === 0) {
          return {
            changed: false,
            snapshot: {
              ...cached,
              refreshed_at: Date.now(),
            },
          };
        }

        const byPeriod = new Map(cached.periods.map((row) => [row.period_tag, row]));

        for (const changed of changedPeriods) {
          const currentResult = await db
            .prepare(
              `SELECT period_tag,
                    COUNT(*)                            AS row_count,
                    COUNT(DISTINCT slotitem_master_id) AS slotitem_count
               FROM remodel_slotlist_effective_requirements
               WHERE period_tag = ?
               GROUP BY period_tag`,
            )
            .bind(changed.period_tag)
            .all();
          const current = parseRemodelPeriodSummaryRows(currentResult.results);

          const key = changed.period_tag;
          const currentRow = current[0];
          if (currentRow === undefined) {
            byPeriod.delete(key);
          } else {
            byPeriod.set(key, currentRow);
          }
        }

        const maxUpdatedAt = changedPeriods.reduce(
          (max, row) => Math.max(max, Number(row.max_updated_at_ms) || 0),
          0,
        );

        const nextPeriods = Array.from(byPeriod.values())
          .sort((a, b) => b.period_tag.localeCompare(a.period_tag, "en"))
          .slice(0, 20);

        return {
          changed: true,
          snapshot: {
            periods: nextPeriods,
            refreshed_at: Date.now(),
            db_synced_at: Math.max(cached.db_synced_at, maxUpdatedAt),
          },
        };
      },
      loadFull: async () => {
        const periodResult = await db
          .prepare(
            `SELECT period_tag,
                COUNT(*)                            AS row_count,
                COUNT(DISTINCT slotitem_master_id) AS slotitem_count
             FROM remodel_slotlist_effective_requirements
             GROUP BY period_tag
             ORDER BY period_tag DESC
             LIMIT 20`,
          )
          .all();
        const periodRows = parseRemodelPeriodSummaryRows(periodResult.results);

        const maxUpdatedAtRow = await db
          .prepare(
            `SELECT MAX(updated_at_ms) AS max_updated_at_ms FROM remodel_slotlist_effective_requirements`,
          )
          .first();
        const parsedMaxUpdatedAtRow =
          RemodelMaxUpdatedAtRowSchema.safeParse(maxUpdatedAtRow);
        const maxUpdatedAtMs = parsedMaxUpdatedAtRow.success
          ? parsedMaxUpdatedAtRow.data.max_updated_at_ms
          : undefined;

        return {
          periods: periodRows,
          refreshed_at: Date.now(),
          db_synced_at: Math.max(
            0,
            Number(maxUpdatedAtMs) || 0,
          ),
        };
      },
    });

    const response = c.json({ ok: true, periods: snapshot.periods });
    response.headers.set(
      "Cache-Control",
      "public, max-age=3600, stale-while-revalidate=86400",
    );
    response.headers.set("X-FUSOU-Cache", cacheStatus);
    return response;
  } catch (err) {
    console.error("[remodel-data] Failed to query summary:", err);
    return c.json({ error: "Failed to retrieve remodel summary" }, 500);
  }
});

/**
 * GET /effective-summary — req_slot 補完状況の集計。
 * slotlist 生値と detail 補完の内訳を period/tag 単位で返す。
 */
app.get("/effective-summary", async (c) => {
  const db = c.env.REMODEL_INDEX_DB;
  if (!db) return c.json({ error: "REMODEL_INDEX_DB not configured" }, 503);

  try {
    const result = await db
      .prepare(
        `SELECT
            period_tag,
            COUNT(*) AS total_rows,
            SUM(CASE WHEN req_slot_source = 'slotlist' THEN 1 ELSE 0 END) AS slotlist_rows,
            SUM(CASE WHEN req_slot_source = 'detail' THEN 1 ELSE 0 END) AS recovered_from_detail_rows,
            SUM(CASE WHEN req_slot_source = 'fallback_zero' THEN 1 ELSE 0 END) AS unresolved_fallback_rows
         FROM remodel_slotlist_effective_requirements
         GROUP BY period_tag
         ORDER BY period_tag DESC
         LIMIT 20`,
      )
      .all();
    const rows = parseRemodelEffectiveSummaryRows(result.results);

    const response = c.json({ ok: true, periods: rows });
    response.headers.set(
      "Cache-Control",
      "public, max-age=3600, stale-while-revalidate=86400",
    );
    return response;
  } catch (err) {
    console.error("[remodel-data] Failed to query effective summary:", err);
    return c.json({ error: "Failed to retrieve effective summary" }, 500);
  }
});

// ── Ingest route ───────────────────────────────────────────────────

app.post("/ingest", async (c) => {
  const db = c.env.REMODEL_INDEX_DB;
  if (!db) return c.json({ error: "REMODEL_INDEX_DB not configured" }, 503);

  // kill switch
  const env = createEnvContext(c);
  let collectionEnabled = false;
  try {
    collectionEnabled = parseStrictBoolean(
      getEnv(env, REMODEL_COLLECTION_SWITCH_ENV),
      REMODEL_COLLECTION_SWITCH_ENV,
    );
  } catch (err) {
    return c.json(
      {
        error:
          err instanceof Error
            ? err.message
            : `${REMODEL_COLLECTION_SWITCH_ENV} is invalid`,
      },
      500,
    );
  }
  if (!collectionEnabled) {
    return c.json({ error: "Remodel data collection is disabled" }, 503);
  }

  const signingSecret = getEnv(env, "REMODEL_DATA_SIGNING_SECRET");
  if (!signingSecret) {
    return c.json({ error: "REMODEL_DATA_SIGNING_SECRET is required" }, 500);
  }

  return handleTwoStageUpload(c, {
    signingSecret,
    requireDatasetToken: true,
    tokenTTL: () => 300,
    maxBodySize: REMODEL_DATA_MAX_UPLOAD_BYTES,
    maxPreparationBodySize: REMODEL_DATA_HANDSHAKE_MAX_BYTES,
    errorMessages: {
      preparationBodyTooLarge: "Request body exceeds maximum size",
      bodyTooLarge: "Upload payload exceeds maximum size",
    },
    preparationValidator: async (rawBody, _user, authContext) => {
      const handshakeBody = parseRemodelDataIngestBody(rawBody);
      const validated = validateIngestBody(handshakeBody);
      if (!validated.ok) return c.json({ error: validated.error }, 400);
      const periodTagValidation = await validateCachedPeriodTag(
        c,
        String(handshakeBody?.["period_tag"] ?? "").trim(),
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

      const contentHash = String(handshakeBody?.["content_hash"] ?? "").trim();
      if (!contentHash) return c.json({ error: "content_hash is required" }, 400);

      const declaredSize = Number(handshakeBody?.["file_size"] ?? 0);
      if (!Number.isFinite(declaredSize) || declaredSize <= 0) {
        return c.json({ error: "file_size must be > 0" }, 400);
      }
      if (declaredSize > REMODEL_DATA_MAX_UPLOAD_BYTES) {
        return c.json(
          {
            error: `file_size exceeds maximum of ${REMODEL_DATA_MAX_UPLOAD_BYTES} bytes`,
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
          schema_version: validated.schemaVersion,
        },
      };
    },
    executionProcessor: async (tokenPayload, uploaded) => {
      const payloadValidation =
        UploadTokenPayloadSchema.safeParse(tokenPayload);
      if (!payloadValidation.success) {
        return c.json(
          { error: payloadValidation.error.message ?? "Invalid upload token payload" },
          400,
        );
      }
      const validatedPayload = payloadValidation.data;

      if (uploaded.byteLength !== validatedPayload.declared_size) {
        return c.json(
          {
            error: "Data size mismatch",
            expected: validatedPayload.declared_size,
            actual: uploaded.byteLength,
          },
          400,
        );
      }

      const actualHash = (await sha256Hex(uploaded)).toLowerCase();
      const expectedHash = validatedPayload.content_hash.toLowerCase();
      if (!timingSafeEqual(actualHash, expectedHash)) {
        return c.json(
          {
            error: "Content hash mismatch - data may be corrupted",
            expected: expectedHash,
            actual: actualHash,
          },
          400,
        );
      }

      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(new TextDecoder().decode(uploaded));
      } catch {
        return c.json({ error: "Invalid JSON upload payload" }, 400);
      }
      const body = parseRemodelDataIngestBody(parsedBody);
      if (!body) return c.json({ error: "Invalid JSON body" }, 400);

      const verified = validateIngestBody(body);
      if (!verified.ok) return c.json({ error: verified.error }, 400);
      const validatedBody = verified.body;
      const periodTagValidation = await validateCachedPeriodTag(
        c,
        validatedBody.period_tag,
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
        verified.eventType !== validatedPayload.event_type ||
        verified.schemaVersion !== validatedPayload.schema_version
      ) {
        return c.json(
          { error: "Upload payload does not match upload token claims" },
          400,
        );
      }

      try {
        const archiveResult = await archiveAndResetOnPeriodSwitch(
          db,
          c.env.SHIP_GROWTH_ARCHIVE_BUCKET,
          verified.periodTag,
          verified.timestampMs,
        );
        if (archiveResult.isStalePeriodTag) {
          return c.json(
            {
              error: "Incoming period_tag is older than stored remodel data",
              incoming_period_tag: verified.periodTag,
              latest_period_tag: archiveResult.latestPeriodTag,
            },
            409,
          );
        }

        if (validatedBody.event_type === "slotlist") {
          const stmts = validatedBody.entries.map(
            (entry) =>
              db
                .prepare(
                  `INSERT OR REPLACE INTO remodel_slotlist_entries (
                  period_tag,
                  secretary_ship_master_id, weekday_jst,
                  remodel_id, remodel_step_id, remodel_level, slotitem_master_id, sp_type,
                  req_fuel, req_bull, req_steel, req_bauxite,
                  req_buildkit, req_remodelkit,
                  req_slot_id, req_slot_num,
                  updated_at_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .bind(
                  verified.periodTag,
                  validatedBody.secretary_ship_master_id,
                  validatedBody.weekday_jst,
                  entry.remodel_id,
                  entry.remodel_step_id ?? entry.remodel_id,
                  entry.remodel_level,
                  entry.slotitem_master_id,
                  entry.sp_type,
                  entry.req_fuel,
                  entry.req_bull,
                  entry.req_steel,
                  entry.req_bauxite,
                  entry.req_buildkit,
                  entry.req_remodelkit,
                  entry.req_slot_id,
                  entry.req_slot_num,
                  verified.timestampMs,
                ),
          );
          const BATCH_SIZE = 100;
          for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
            await db.batch(stmts.slice(i, i + BATCH_SIZE));
          }
        } else if (validatedBody.event_type === "detail") {
          await db
            .prepare(
              `INSERT OR REPLACE INTO remodel_detail_entries (
                period_tag,
                slotitem_master_id, remodel_id, remodel_step_id, remodel_level,
                certain_buildkit, certain_remodelkit,
                req_slot_id, req_slot_num,
                change_flag,
                req_useitem_id, req_useitem_id2, req_useitem_num, req_useitem_num2,
                updated_at_ms
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              verified.periodTag,
              validatedBody.slotitem_master_id,
              validatedBody.remodel_id,
              validatedBody.remodel_step_id ?? validatedBody.remodel_id,
              validatedBody.remodel_level,
              validatedBody.certain_buildkit,
              validatedBody.certain_remodelkit,
              validatedBody.req_slot_id ?? null,
              validatedBody.req_slot_num ?? null,
              validatedBody.change_flag,
              validatedBody.req_useitem_id ?? null,
              validatedBody.req_useitem_id2 ?? null,
              validatedBody.req_useitem_num ?? null,
              validatedBody.req_useitem_num2 ?? null,
              verified.timestampMs,
            )
            .run();
        }

        if (archiveResult.stalePeriods.length > 0) {
          await pruneStalePeriodsAfterSuccessfulIngest(db, verified.periodTag);
        }
      } catch (error) {
        console.error("remodel ingest DB write failed:", error);
        return c.json({ error: "Database write failed" }, 500);
      }

      const responseBody = {
        ok: true,
        event_type: verified.eventType,
        dataset_id: verified.datasetId,
        request_id: verified.requestId,
      };

      scheduleRemodelTask(
        c,
        (async () => {
          await invalidateCanonicalSnapshots(c.env.DATA_LOADER_CACHE_KV, [
            "remodel:summary",
          ]);
          try {
            await app.request(`/summary`, {}, c.env, safeGetExecutionCtx(c));
            await app.request(
              `/effective-summary`,
              {},
              c.env,
              safeGetExecutionCtx(c),
            );
          } catch (err) {
            console.warn("[remodel-data] Failed to pre-warm caches:", err);
          }
        })(),
      );

      const cache = (globalThis as { caches?: { default?: Cache } }).caches
        ?.default;
      if (cache) {
        scheduleRemodelTask(c, invalidateRemodelCaches(cache, c.req.url));
      }

      return c.json(responseBody);
    },
  });
});

export default app;
