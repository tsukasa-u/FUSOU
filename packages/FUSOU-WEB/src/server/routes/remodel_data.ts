import { Hono } from "hono";
import type { Bindings } from "../types";
import {
  createEnvContext,
  generateSignedToken,
  getEnv,
  parseStrictBoolean,
  resolveDatasetToken,
  timingSafeEqual,
  validateDatasetTokenSecret,
  validateDatasetTokenWithConstraints,
  validateJWT,
  validateTokenPayload,
  verifySignedToken,
  safeWaitUntil,
  safeGetExecutionCtx,
} from "../utils";
import {
  invalidateCanonicalSnapshots,
  loadOrRefreshCanonicalSnapshot,
} from "../utils/snapshot-cache";
import {
  isValidPeriodTagDate,
  validateCachedPeriodTag,
} from "../utils/period-tags";

const REMODEL_COLLECTION_SWITCH_ENV = "REMODEL_DATA_COLLECTION_ENABLED";
const VALID_EVENT_TYPES = new Set(["slotlist", "detail"]);
const KV_SNAPSHOT_TTL_MS = 60 * 60 * 1000;
const KV_EXPIRATION_TTL_S = 7 * 24 * 60 * 60;

const app = new Hono<{ Bindings: Bindings }>();

type RemodelPeriodSummaryRow = {
  period_tag: string;
  table_version: string;
  dataset_count: number;
  slotitem_count: number;
};

type RemodelSummarySnapshot = {
  periods: RemodelPeriodSummaryRow[];
  refreshed_at: number;
  db_synced_at: number;
};

function isRemodelSummarySnapshot(v: unknown): v is RemodelSummarySnapshot {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    Array.isArray(s.periods) &&
    s.periods.every(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        typeof (p as Record<string, unknown>).period_tag === "string" &&
        typeof (p as Record<string, unknown>).table_version === "string",
    ) &&
    typeof s.refreshed_at === "number" &&
    typeof s.db_synced_at === "number"
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

function isValidInt(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && Number.isInteger(v);
}

// ── Validation ─────────────────────────────────────────────────────

type ValidResult = {
  ok: true;
  datasetId: string;
  requestId: string;
  payloadHash: string;
  eventType: "slotlist" | "detail";
  periodTag: string;
  tableVersion: string;
  timestampMs: number;
};
type InvalidResult = { ok: false; error: string };

function validateIngestBody(body: any): ValidResult | InvalidResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid JSON body" };
  }

  const datasetId = String(body.dataset_id ?? "").trim();
  if (!datasetId) return { ok: false, error: "dataset_id is required" };

  const requestId = String(body.request_id ?? "").trim();
  if (!requestId) return { ok: false, error: "request_id is required" };

  const payloadHash = String(body.payload_hash ?? "").trim();
  if (!/^[a-f0-9]{64}$/i.test(payloadHash)) {
    return {
      ok: false,
      error: "payload_hash must be a valid 64-char SHA-256 hex string",
    };
  }

  const eventType = String(body.event_type ?? "").trim();
  if (!VALID_EVENT_TYPES.has(eventType)) {
    return {
      ok: false,
      error: `event_type must be one of: ${[...VALID_EVENT_TYPES].join(", ")}`,
    };
  }

  const periodTag = String(body.period_tag ?? "").trim();
  if (!isValidPeriodTagDate(periodTag)) {
    return { ok: false, error: "period_tag must be a valid calendar date" };
  }

  const tableVersion = String(body.table_version ?? "").trim();
  if (!tableVersion) return { ok: false, error: "table_version is required" };

  const timestampMs = Number(body.timestamp_ms);
  if (!isValidInt(timestampMs) || timestampMs <= 0) {
    return { ok: false, error: "timestamp_ms must be a positive integer" };
  }

  // --- event_type 別フィールド検証 ---
  if (eventType === "slotlist") {
    if (
      !isValidInt(body.secretary_ship_master_id) ||
      body.secretary_ship_master_id <= 0
    ) {
      return {
        ok: false,
        error: "secretary_ship_master_id must be a positive integer",
      };
    }
    if (
      !isValidInt(body.weekday_jst) ||
      body.weekday_jst < 0 ||
      body.weekday_jst > 6
    ) {
      return { ok: false, error: "weekday_jst must be 0-6" };
    }
    if (!Array.isArray(body.entries) || body.entries.length === 0) {
      return {
        ok: false,
        error: "entries array is required and must not be empty",
      };
    }
    if (body.entries.length > 2000) {
      return {
        ok: false,
        error: "entries array exceeds maximum of 2000 elements",
      };
    }
    const intFields = [
      "remodel_id",
      "slotitem_master_id",
      "sp_type",
      "req_fuel",
      "req_bull",
      "req_steel",
      "req_bauxite",
      "req_buildkit",
      "req_remodelkit",
      "req_slot_id",
      "req_slot_num",
    ];
    for (const [i, entry] of body.entries.entries()) {
      for (const f of intFields) {
        if (!isValidInt(entry[f])) {
          return { ok: false, error: `entries[${i}].${f} must be an integer` };
        }
      }
    }
  }

  if (eventType === "detail") {
    if (!isValidInt(body.slotitem_master_id) || body.slotitem_master_id <= 0) {
      return {
        ok: false,
        error: "slotitem_master_id must be a positive integer",
      };
    }
    if (!isValidInt(body.remodel_id)) {
      return { ok: false, error: "remodel_id must be an integer" };
    }
    if (
      !isValidInt(body.certain_buildkit) ||
      !isValidInt(body.certain_remodelkit)
    ) {
      return {
        ok: false,
        error: "certain_buildkit and certain_remodelkit must be integers",
      };
    }
    if (!isValidInt(body.change_flag)) {
      return { ok: false, error: "change_flag must be an integer" };
    }
    for (const f of [
      "req_useitem_id",
      "req_useitem_id2",
      "req_useitem_num",
      "req_useitem_num2",
    ]) {
      if (body[f] != null && !isValidInt(body[f])) {
        return { ok: false, error: `${f} must be an integer or null` };
      }
    }
  }

  return {
    ok: true,
    datasetId,
    requestId,
    payloadHash,
    eventType: eventType as "slotlist" | "detail",
    periodTag,
    tableVersion,
    timestampMs,
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
  c: any,
  task: Promise<unknown>,
): void {
  safeWaitUntil(c, task);
}

// ── Public READ endpoint ───────────────────────────────────────────

/**
 * GET /summary — Aggregated overview of collected remodel data.
 * Returns distinct period_tags, dataset count, and slotitem coverage per period.
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
        const changedPeriods = ((
          await db
            .prepare(
              `SELECT period_tag, table_version, MAX(updated_at_ms) AS max_updated_at_ms
               FROM remodel_slotlist_entries
               WHERE updated_at_ms > ?
               GROUP BY period_tag, table_version`,
            )
            .bind(cached.db_synced_at)
            .all()
        ).results ?? []) as Array<{
          period_tag: string;
          table_version: string;
          max_updated_at_ms: number;
        }>;

        if (changedPeriods.length === 0) {
          return {
            changed: false,
            snapshot: {
              ...cached,
              refreshed_at: Date.now(),
            },
          };
        }

        const byPeriod = new Map(
          cached.periods.map((row) => [
            `${row.period_tag}:${row.table_version}`,
            row,
          ]),
        );

        for (const changed of changedPeriods) {
          const current = ((
            await db
              .prepare(
                `SELECT period_tag, table_version,
                      COUNT(DISTINCT dataset_id)         AS dataset_count,
                      COUNT(DISTINCT slotitem_master_id) AS slotitem_count
                 FROM remodel_slotlist_entries
                 WHERE period_tag = ? AND table_version = ?
                 GROUP BY period_tag, table_version`,
              )
              .bind(changed.period_tag, changed.table_version)
              .all()
          ).results ?? []) as RemodelPeriodSummaryRow[];

          const key = `${changed.period_tag}:${changed.table_version}`;
          if (current.length > 0) {
            byPeriod.set(key, current[0]);
          } else {
            byPeriod.delete(key);
          }
        }

        const maxUpdatedAt = changedPeriods.reduce(
          (max, row) => Math.max(max, Number(row.max_updated_at_ms) || 0),
          0,
        );

        const nextPeriods = Array.from(byPeriod.values())
          .sort((a, b) => {
            if (a.period_tag === b.period_tag) {
              return b.table_version.localeCompare(a.table_version, "en");
            }
            return b.period_tag.localeCompare(a.period_tag, "en");
          })
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
        const periodRows = ((
          await db
            .prepare(
              `SELECT period_tag, table_version,
                    COUNT(DISTINCT dataset_id)         AS dataset_count,
                    COUNT(DISTINCT slotitem_master_id) AS slotitem_count
               FROM remodel_slotlist_entries
               GROUP BY period_tag, table_version
               ORDER BY period_tag DESC, table_version DESC
               LIMIT 20`,
            )
            .all()
        ).results ?? []) as RemodelPeriodSummaryRow[];

        const maxUpdatedAtRow = (await db
          .prepare(
            `SELECT MAX(updated_at_ms) AS max_updated_at_ms FROM remodel_slotlist_entries`,
          )
          .first()) as { max_updated_at_ms?: number } | null;

        return {
          periods: periodRows,
          refreshed_at: Date.now(),
          db_synced_at: Math.max(
            0,
            Number(maxUpdatedAtRow?.max_updated_at_ms) || 0,
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

  const uploadToken = c.req.header("X-Upload-Token");

  // ── Stage 1: Handshake ─────────────────────────────────────────
  if (!uploadToken) {
    const authHeader = c.req.header("Authorization");
    const bearer = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : null;
    if (!bearer) return c.json({ error: "Unauthorized" }, 401);
    const user = await validateJWT(bearer);
    if (!user?.id)
      return c.json({ error: "Invalid or expired JWT token" }, 401);

    const handshakeBody = (await c.req.json().catch(() => null)) as
      | (Record<string, unknown> & {
          content_hash?: string;
          file_size?: number | string;
        })
      | null;

    const validated = validateIngestBody(handshakeBody);
    if (!validated.ok) return c.json({ error: validated.error }, 400);
    const periodTagValidation = await validateCachedPeriodTag(
      c,
      String(handshakeBody?.period_tag ?? "").trim(),
      { cacheKV: c.env.DATA_LOADER_CACHE_KV },
    );
    if (!periodTagValidation.ok) {
      return c.json(
        { error: periodTagValidation.error },
        periodTagValidation.status,
      );
    }

    // Require dataset_token to prove ownership of dataset_id
    const datasetToken = resolveDatasetToken(
      c.req.header("X-Dataset-Token"),
      (handshakeBody as Record<string, unknown>)?.dataset_token,
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
      // expectedUserId は検証しない: 複数端末では端末ごとの匿名 user_id が異なるため。
      // データ帰属は dataset_id (member_id_hash) の照合で担保する。
    });
    if (!tokenValidation.ok) {
      return c.json(
        { error: tokenValidation.error },
        tokenValidation.status ?? 401,
      );
    }
    const actingUserId = tokenValidation.token!.user_id;

    const contentHash = String(handshakeBody?.content_hash ?? "").trim();
    if (!contentHash) return c.json({ error: "content_hash is required" }, 400);

    const MAX_UPLOAD_SIZE = 5_000_000; // 5 MB
    const declaredSize = Number(handshakeBody?.file_size ?? 0);
    if (!Number.isFinite(declaredSize) || declaredSize <= 0) {
      return c.json({ error: "file_size must be > 0" }, 400);
    }
    if (declaredSize > MAX_UPLOAD_SIZE) {
      return c.json(
        { error: `file_size exceeds maximum of ${MAX_UPLOAD_SIZE} bytes` },
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

  // ── Stage 2: Execution ─────────────────────────────────────────
  const authHeader = c.req.header("Authorization");
  const bearer = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;
  if (!bearer) return c.json({ error: "Unauthorized" }, 401);
  const user = await validateJWT(bearer);
  if (!user?.id) return c.json({ error: "Invalid or expired JWT token" }, 401);

  const tokenPayload = await verifySignedToken(uploadToken, signingSecret);
  if (!tokenPayload)
    return c.json({ error: "Invalid or expired upload token" }, 401);

  const payloadValidation = validateTokenPayload(tokenPayload, [
    "content_hash",
    "declared_size",
    "dataset_id",
    "request_id",
    "event_type",
  ]);
  if (!payloadValidation.valid) {
    return c.json(
      { error: payloadValidation.error ?? "Invalid upload token payload" },
      400,
    );
  }
  // user_id 照合は行わない: upload token の user_id は dataset_token.sub（帰属者）であり
  // JWT user_id（端末固有）と一致しないことがある。JWT 有効性は上で確認済み。

  // Read binary body
  const bodyStream = c.req.raw.body;
  if (!bodyStream) return c.json({ error: "Upload payload is missing" }, 400);
  const uploaded = new Uint8Array(await new Response(bodyStream).arrayBuffer());

  // Size check
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

  // Hash check (timing-safe)
  const actualHash = (await sha256Hex(uploaded)).toLowerCase();
  const expectedHash = String(tokenPayload.content_hash ?? "").toLowerCase();
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

  // Parse JSON payload
  let body: Record<string, any>;
  try {
    body = JSON.parse(new TextDecoder().decode(uploaded));
  } catch {
    return c.json({ error: "Invalid JSON upload payload" }, 400);
  }

  const verified = validateIngestBody(body);
  if (!verified.ok) return c.json({ error: verified.error }, 400);
  const periodTagValidation = await validateCachedPeriodTag(
    c,
    String(body.period_tag ?? "").trim(),
    { cacheKV: c.env.DATA_LOADER_CACHE_KV },
  );
  if (!periodTagValidation.ok) {
    return c.json(
      { error: periodTagValidation.error },
      periodTagValidation.status,
    );
  }

  // Verify claims match payload
  if (
    verified.datasetId !== String(tokenPayload.dataset_id) ||
    verified.requestId !== String(tokenPayload.request_id) ||
    verified.eventType !== String(tokenPayload.event_type)
  ) {
    return c.json(
      { error: "Upload payload does not match upload token claims" },
      400,
    );
  }

  // ── INSERT ─────────────────────────────────────────────────────
  try {
    if (verified.eventType === "slotlist") {
      // D1 does not support BEGIN/COMMIT; use db.batch() for atomicity.
      const stmts = (body.entries as Array<Record<string, unknown>>).map(
        (entry) =>
          db
            .prepare(
              `INSERT OR REPLACE INTO remodel_slotlist_entries (
              dataset_id, period_tag, table_version,
              secretary_ship_master_id, weekday_jst,
              remodel_id, slotitem_master_id, sp_type,
              req_fuel, req_bull, req_steel, req_bauxite,
              req_buildkit, req_remodelkit,
              req_slot_id, req_slot_num,
              updated_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              verified.datasetId,
              verified.periodTag,
              verified.tableVersion,
              body.secretary_ship_master_id,
              body.weekday_jst,
              entry.remodel_id,
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
    } else if (verified.eventType === "detail") {
      await db
        .prepare(
          `INSERT OR REPLACE INTO remodel_detail_entries (
            dataset_id, period_tag, table_version,
            slotitem_master_id, remodel_id,
            certain_buildkit, certain_remodelkit,
            change_flag,
            req_useitem_id, req_useitem_id2, req_useitem_num, req_useitem_num2,
            updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          verified.datasetId,
          verified.periodTag,
          verified.tableVersion,
          body.slotitem_master_id,
          body.remodel_id,
          body.certain_buildkit,
          body.certain_remodelkit,
          body.change_flag,
          body.req_useitem_id ?? null,
          body.req_useitem_id2 ?? null,
          body.req_useitem_num ?? null,
          body.req_useitem_num2 ?? null,
          verified.timestampMs,
        )
        .run();
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
      } catch (err) {
        console.warn("[remodel-data] Failed to pre-warm caches:", err);
      }
    })()
  );

  // Best-effort cache invalidation after successful ingest
  const cache = (globalThis as { caches?: { default?: Cache } }).caches
    ?.default;
  if (cache) {
    scheduleRemodelTask(c, invalidateRemodelCaches(cache, c.req.url));
  }

  return c.json(responseBody);
});

export default app;
