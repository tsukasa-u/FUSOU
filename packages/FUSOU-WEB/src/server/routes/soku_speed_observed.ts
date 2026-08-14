import { Hono } from "hono";
import type { Bindings, D1Database } from "../types";
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
  validateTokenPayloadWithSchema,
  verifySignedToken,
  safeWaitUntil,
} from "../utils";
import {
  getLatestMasterPeriodTag,
  validateCachedPeriodTag,
} from "../utils/period-tags";
import { SokuSpeedTokenPayloadSchema } from "../schemas/tokens";
import {
  LatestSokuSpeedPeriodRowSchema,
  parseSokuSpeedObservationRows,
  SokuSpeedIngestBodySchema,
  SokuSpeedExslotSchema,
  SokuSpeedSlotRowsSchema,
  ValidatedSokuSpeedIngestBodySchema,
  type SokuSpeedIngestBody,
} from "../schemas/soku-speed";

const SOKU_SPEED_COLLECTION_SWITCH_ENV = "SOKU_SPEED_COLLECTION_ENABLED";

const app = new Hono<{ Bindings: Bindings }>();
interface SlotEntry {
  slotitem_id: number;
  locked: boolean;
  level: number;
  alv: number;
}
interface SokuSpeedShipEntry {
  master_id: number;
  lv: number;
  soku_observed: number;
  slots: SlotEntry[];
  exslot?: SlotEntry | null;
}
function parseSokuSpeedIngestBody(value: unknown): SokuSpeedIngestBody | null {
  const result = SokuSpeedIngestBodySchema.safeParse(value);
  return result.success ? result.data : null;
}
function validateSokuSpeedIngestBody(
  body: SokuSpeedIngestBody | null,
):
  | { ok: true; datasetId: string; requestId: string; eventType: string }
  | { ok: false; error: string } {
  if (!body) return { ok: false, error: "Missing body" };
  const parsed = ValidatedSokuSpeedIngestBodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid request body",
    };
  }
  return {
    ok: true,
    datasetId: String(parsed.data.dataset_id ?? "").trim(),
    requestId: String(parsed.data.request_id ?? "").trim(),
    eventType: String(parsed.data.event_type ?? "").trim(),
  };
}

app.post("/ingest", async (c) => {
  const db = c.env.SOKU_SPEED_OBSERVED_DB;
  if (!db)
    return c.json({ error: "SOKU_SPEED_OBSERVED_DB not configured" }, 503);
  const masterDb = c.env.MASTER_DATA_INDEX_DB;
  if (!masterDb)
    return c.json({ error: "MASTER_DATA_INDEX_DB not configured" }, 503);
  // kill switch
  const env = createEnvContext(c);
  let collectionEnabled = false;
  try {
    collectionEnabled = parseStrictBoolean(
      getEnv(env, SOKU_SPEED_COLLECTION_SWITCH_ENV),
      SOKU_SPEED_COLLECTION_SWITCH_ENV,
    );
  } catch (err) {
    return c.json(
      {
        error:
          err instanceof Error
            ? err.message
            : `${SOKU_SPEED_COLLECTION_SWITCH_ENV} is invalid`,
      },
      500,
    );
  }
  if (!collectionEnabled) {
    return c.json({ error: "Soku speed collection is disabled" }, 503);
  }

  const signingSecret = getEnv(env, "SOKU_SPEED_SIGNING_SECRET");
  if (!signingSecret) {
    return c.json({ error: "SOKU_SPEED_SIGNING_SECRET is required" }, 500);
  }
  const uploadToken = c.req.header("X-Upload-Token");
  if (!uploadToken) {
    const authHeader = c.req.header("Authorization");
    const bearer = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : null;
    if (!bearer) return c.json({ error: "Unauthorized" }, 401);
    const user = await validateJWT(bearer);
    if (!user?.id)
      return c.json({ error: "Invalid or expired JWT token" }, 401);
    const handshakeBody = parseSokuSpeedIngestBody(
      await c.req.json().catch(() => null),
    );
    const validated = validateSokuSpeedIngestBody(handshakeBody);
    if (!validated.ok) return c.json({ error: validated.error }, 400);
    const bodyPeriodTag = String(handshakeBody?.period_tag ?? "").trim();
    const periodTagValidation = await validateCachedPeriodTag(
      c,
      bodyPeriodTag,
      {
        cacheKV: c.env.DATA_LOADER_CACHE_KV,
      },
    );
    if (!periodTagValidation.ok) {
      return c.json(
        { error: periodTagValidation.error },
        periodTagValidation.status,
      );
    }
    const bodyTableVersion = String(handshakeBody?.table_version ?? "").trim();
    const latestMaster = await getLatestMasterPeriodTag(masterDb, c.env.DATA_LOADER_CACHE_KV);
    if (!latestMaster) {
      return c.json({ error: "No master data available" }, 404);
    }
    if (
      latestMaster.period_tag !== bodyPeriodTag ||
      latestMaster.table_version !== bodyTableVersion
    ) {
      return c.json(
        {
          error: "STALE_PERIOD_UPLOAD_REJECTED",
          message:
            "soku_speed observations accept only latest master-data period/table_version",
          expected_period_tag: latestMaster.period_tag,
          expected_table_version: latestMaster.table_version,
          received_period_tag: bodyPeriodTag,
          received_table_version: bodyTableVersion,
        },
        409,
      );
    }
    const datasetToken = resolveDatasetToken(
      c.req.header("X-Dataset-Token"),
      handshakeBody?.dataset_token,
    );
    const datasetTokenSecret = getEnv(env, "DATASET_TOKEN_SECRET");
    const secretValidation = validateDatasetTokenSecret(datasetTokenSecret);
    if (!secretValidation.ok) {
      return c.json({ error: secretValidation.error }, 500);
    }
    const tokenValidation = await validateDatasetTokenWithConstraints({
      token: datasetToken,
      secret: datasetTokenSecret,
      expectedDatasetId: validated.datasetId,
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
    const declaredSize = Number(handshakeBody?.file_size ?? 0);
    if (!Number.isFinite(declaredSize) || declaredSize <= 0) {
      return c.json({ error: "file_size must be > 0" }, 400);
    }
    const tokenTtl = Math.max(
      300,
      Math.min(3600, 30 + Math.ceil(declaredSize / (10 * 1024 * 1024)) * 10),
    );
    const token = await generateSignedToken(
      {
        user_id: actingUserId,
        content_hash: contentHash,
        declared_size: declaredSize,
        dataset_id: validated.datasetId,
        request_id: validated.requestId,
        event_type: validated.eventType,
        period_tag: bodyPeriodTag,
        table_version: bodyTableVersion,
      },
      signingSecret,
      tokenTtl,
    );
    const uploadUrl = new URL(c.req.url);
    if (!uploadUrl.pathname.startsWith("/api/")) {
      uploadUrl.pathname =
        "/api" +
        (uploadUrl.pathname.startsWith("/")
          ? uploadUrl.pathname
          : "/" + uploadUrl.pathname);
    }
    return c.json({
      uploadUrl: uploadUrl.toString(),
      token,
      expiresAt: new Date(Date.now() + tokenTtl * 1000).toISOString(),
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
  if (!tokenPayload)
    return c.json({ error: "Invalid or expired upload token" }, 401);
  const validated = validateTokenPayloadWithSchema(
    tokenPayload,
    SokuSpeedTokenPayloadSchema,
  );
  if (!validated.valid) return c.json({ error: validated.error }, 400);
  const validatedPayload = validated.data;
  const contentHashHeader = c.req.header("content-hash");
  const rawBody = await c.req.arrayBuffer().catch(() => null);
  if (!rawBody) return c.json({ error: "Missing request body" }, 400);
  const digest = await crypto.subtle.digest("SHA-256", rawBody);
  const actualContentHash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (!timingSafeEqual(actualContentHash, validatedPayload.content_hash)) {
    return c.json({ error: "content-hash mismatch" }, 400);
  }
  if (
    contentHashHeader &&
    !timingSafeEqual(contentHashHeader, actualContentHash)
  ) {
    return c.json({ error: "content-hash header mismatch" }, 400);
  }
  if (rawBody.byteLength !== validatedPayload.declared_size) {
    return c.json({ error: "file_size mismatch" }, 400);
  }
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const body = parseSokuSpeedIngestBody(parsedBody);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);
  const bodyValidated = validateSokuSpeedIngestBody(body);
  if (!bodyValidated.ok) return c.json({ error: bodyValidated.error }, 400);
  if (
    !timingSafeEqual(
      String(body.request_id ?? ""),
      validatedPayload.request_id ?? "",
    )
  ) {
    return c.json({ error: "request_id mismatch" }, 400);
  }
  if (
    !timingSafeEqual(
      String(body.dataset_id ?? ""),
      validatedPayload.dataset_id ?? "",
    )
  ) {
    return c.json({ error: "dataset_id mismatch" }, 400);
  }
  const { period_tag, table_version } = body as {
    period_tag: string;
    table_version: string;
  };
  const periodTagValidation = await validateCachedPeriodTag(c, period_tag, {
    cacheKV: c.env.DATA_LOADER_CACHE_KV,
  });
  if (!periodTagValidation.ok) {
    return c.json(
      { error: periodTagValidation.error },
      periodTagValidation.status,
    );
  }
  const latestMaster = await getLatestMasterPeriodTag(masterDb, c.env.DATA_LOADER_CACHE_KV);
  if (!latestMaster) {
    return c.json({ error: "No master data available" }, 404);
  }
  if (
    latestMaster.period_tag !== period_tag ||
    latestMaster.table_version !== table_version
  ) {
    return c.json(
      {
        error: "STALE_PERIOD_UPLOAD_REJECTED",
        message:
          "soku_speed observations accept only latest master-data period/table_version",
        expected_period_tag: latestMaster.period_tag,
        expected_table_version: latestMaster.table_version,
        received_period_tag: period_tag,
        received_table_version: table_version,
      },
      409,
    );
  }
  if (
    typeof validatedPayload.period_tag === "string" &&
    !timingSafeEqual(validatedPayload.period_tag, period_tag)
  ) {
    return c.json({ error: "period_tag mismatch" }, 400);
  }
  if (
    typeof validatedPayload.table_version === "string" &&
    !timingSafeEqual(validatedPayload.table_version, table_version)
  ) {
    return c.json({ error: "table_version mismatch" }, 400);
  }
  const ships = body.ships as SokuSpeedShipEntry[];
  const nowSec = Math.floor(Date.now() / 1000);
  const stmts: ReturnType<D1Database["prepare"]>[] = [];
  const requestId = String(body.request_id ?? "").trim();
  const payloadHash = String(body.payload_hash ?? "").trim();
  const datasetId = String(body.dataset_id ?? "").trim();
  stmts.push(
    db
      .prepare(
        `INSERT INTO soku_speed_ingest_events         (request_id, payload_hash, dataset_id, period_tag, table_version, created_at)       VALUES (?, ?, ?, ?, ?, ?)       ON CONFLICT(request_id, payload_hash) DO NOTHING`,
      )
      .bind(
        requestId,
        payloadHash,
        datasetId,
        period_tag,
        table_version,
        nowSec,
      ),
  );
  for (const ship of ships) {
    const slotsJson = JSON.stringify(ship.slots);
    // Use empty string (not null) for no exslot so it can participate in the PRIMARY KEY.
    // Migration 0005 changed exslot_json to NOT NULL DEFAULT '' for this reason.
    const exslotJson = ship.exslot ? JSON.stringify(ship.exslot) : "";
    stmts.push(
      db
        .prepare(
          `INSERT INTO soku_speed_observations           (period_tag, master_id, lv, soku_observed, slots_json, exslot_json, table_version, updated_at)         VALUES (?, ?, ?, ?, ?, ?, ?, ?)         ON CONFLICT(period_tag, table_version, master_id, slots_json, exslot_json) DO UPDATE SET           soku_observed = MAX(soku_speed_observations.soku_observed, excluded.soku_observed),           lv = excluded.lv,           updated_at = excluded.updated_at`,
        )
        .bind(
          period_tag,
          ship.master_id,
          ship.lv,
          ship.soku_observed,
          slotsJson,
          exslotJson,
          table_version,
          nowSec,
        ),
    );
  }
  const BATCH_SIZE = 100;
  try {
    for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
      await db.batch(stmts.slice(i, i + BATCH_SIZE));
    }

    // Invalidate and pre-warm KV cache since D1 data changed
    const cacheKV = c.env.DATA_LOADER_CACHE_KV;
    if (cacheKV) {
      const cacheKey = `soku-speed-upgrade:v1:${period_tag}:${table_version}`;
      const prewarmTask = (async () => {
        try {
          await cacheKV.delete(cacheKey);
          const result = await db
            .prepare(
              `SELECT master_id, soku_observed, slots_json, exslot_json FROM soku_speed_observations WHERE period_tag = ? AND table_version = ?`
              )
              .bind(period_tag, table_version)
              .all();
            const rows = parseSokuSpeedObservationRows(result.results);
            const byMaster = new Map<
              number,
              Map<string, { soku_observed: number; item_ids: number[] }>
            >();
            for (const row of rows) {
              let parsedSlots: unknown;
              try {
                parsedSlots = JSON.parse(row.slots_json);
              } catch {
                continue;
              }
              const slotsResult = SokuSpeedSlotRowsSchema.safeParse(parsedSlots);
              if (!slotsResult.success) continue;
              const itemIds: number[] = [];
              for (const s of slotsResult.data) {
                if (s.slotitem_id > 0) itemIds.push(s.slotitem_id);
              }
              if (row.exslot_json) {
                let parsedExslot: unknown;
                try {
                  parsedExslot = JSON.parse(row.exslot_json);
                } catch {
                  parsedExslot = null;
                }
                const exslotResult = SokuSpeedExslotSchema.safeParse(parsedExslot);
                if (exslotResult.success && exslotResult.data) {
                  itemIds.push(exslotResult.data.slotitem_id);
                }
              }
              itemIds.sort((a, b) => a - b);
              if (!byMaster.has(row.master_id))
                byMaster.set(row.master_id, new Map());
              const comboKey = itemIds.join(",");
              const masterMap = byMaster.get(row.master_id)!;
              const existing = masterMap.get(comboKey);
              if (!existing) {
                masterMap.set(comboKey, {
                  soku_observed: row.soku_observed,
                  item_ids: itemIds,
                });
              } else {
                existing.soku_observed = Math.max(
                  existing.soku_observed,
                  row.soku_observed,
                );
              }
            }
            const data: Record<
              number,
              { soku_observed: number; item_ids: number[] }[]
            > = {};
            for (const [masterId, comboMap] of byMaster) {
              data[masterId] = Array.from(comboMap.values());
            }
            const responseString = JSON.stringify({
              ok: true,
              period_tag: period_tag,
              table_version: table_version,
              data,
            });
            await cacheKV.put(cacheKey, responseString, { expirationTtl: 86400 * 30 });
            await cacheKV.put(`soku-speed-upgrade:v1:latest`, responseString, { expirationTtl: 86400 * 30 });
          } catch (e) {
            console.error("[soku-speed] pre-warm error:", e);
          }
      })();

      safeWaitUntil(c, prewarmTask);
    }
  } catch (error) {
    return c.json(
      {
        error: "Failed to persist soku_speed observations",
        detail: String(error),
      },
      500,
    );
  }
  return c.json({ ok: true, ingested: ships.length, period_tag });
});
app.get("/speed-upgrade", async (c) => {
  const db = c.env.SOKU_SPEED_OBSERVED_DB;
  if (!db)
    return c.json({ error: "SOKU_SPEED_OBSERVED_DB not configured" }, 503);
  const requestedPeriodTag = (c.req.query("period_tag") ?? "").trim();
  const requestedTableVersion = (c.req.query("table_version") ?? "").trim();
  if (
    (requestedPeriodTag && !requestedTableVersion) ||
    (!requestedPeriodTag && requestedTableVersion)
  ) {
    return c.json(
      { error: "period_tag and table_version must be provided together" },
      400,
    );
  }
  let periodTag = requestedPeriodTag;
  let tableVersion = requestedTableVersion;
  const cacheKV = c.env.DATA_LOADER_CACHE_KV;

  if (!periodTag || !tableVersion) {
    if (cacheKV) {
      try {
        const cachedString = await cacheKV.get("soku-speed-upgrade:v1:latest", "text");
        if (cachedString) {
          const response = new Response(cachedString, {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
              "X-FUSOU-Cache": "HIT",
            }
          });
          return response;
        }
      } catch (e) {
        console.warn("[soku-speed] KV latest cache read error:", e);
      }
    }

    try {
      const masterDb = c.env.MASTER_DATA_INDEX_DB;
      const latestMasterPeriod = masterDb
        ? await getLatestMasterPeriodTag(masterDb, c.env.DATA_LOADER_CACHE_KV)
        : null;
      let latest = latestMasterPeriod;
      if (!latest) {
        const latestFallbackRow = await db
          .prepare(
            `SELECT period_tag, table_version               FROM soku_speed_observations               ORDER BY period_tag DESC, updated_at DESC               LIMIT 1`,
          )
          .first();
        const parsedLatestFallbackRow =
          LatestSokuSpeedPeriodRowSchema.safeParse(latestFallbackRow);
        latest = parsedLatestFallbackRow.success
          ? parsedLatestFallbackRow.data
          : null;
      }
      if (!latest) {
        const empty = c.json({
          ok: true,
          period_tag: null,
          table_version: null,
          data: {},
        });
        empty.headers.set(
          "Cache-Control",
          "public, max-age=60, stale-while-revalidate=300",
        );
        return empty;
      }
      periodTag = latest.period_tag;
      tableVersion = latest.table_version;
    } catch (err) {
      console.error("[soku-speed] Failed to resolve latest period/table:", err);
      return c.json({ error: "Failed to resolve speed upgrade period" }, 500);
    }
  }

  type AggEntry = { soku_observed: number; item_ids: number[] };

  const cacheKey = `soku-speed-upgrade:v1:${periodTag}:${tableVersion}`;

  if (cacheKV) {
    try {
      const cachedString = await cacheKV.get(cacheKey, "text");
      if (cachedString) {
        const response = new Response(cachedString, {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
            "X-FUSOU-Cache": "HIT",
          }
        });
        return response;
      }
    } catch (e) {
      console.warn("[soku-speed] KV cache read error:", e);
    }
  }
  let rows: ReturnType<typeof parseSokuSpeedObservationRows>;
  try {
    const result = await db
      .prepare(
        `SELECT master_id, soku_observed, slots_json, exslot_json         FROM soku_speed_observations         WHERE period_tag = ? AND table_version = ?`,
      )
      .bind(periodTag, tableVersion)
      .all();
    rows = parseSokuSpeedObservationRows(result.results);
  } catch (err) {
    const message = [
      String(err),
      typeof err === "object" && err !== null && "message" in err
        ? String((err as { message?: unknown }).message)
        : "",
      typeof err === "object" &&
      err !== null &&
      "cause" in err &&
      typeof (err as { cause?: unknown }).cause === "object" &&
      (err as { cause?: unknown }).cause !== null &&
      "message" in ((err as { cause?: { message?: unknown } }).cause ?? {})
        ? String((err as { cause?: { message?: unknown } }).cause?.message)
        : "",
    ]
      .join(" | ")
      .toLowerCase();

    if (message.includes("no such table: soku_speed_observations")) {
      const empty = c.json({
        ok: true,
        period_tag: periodTag,
        table_version: tableVersion,
        data: {},
      });
      empty.headers.set(
        "Cache-Control",
        "public, max-age=60, stale-while-revalidate=300",
      );
      return empty;
    }
    console.error(
      "[soku-speed] Failed to query speed-upgrade observations:",
      err,
    );
    return c.json({ error: "Failed to query speed upgrade observations" }, 500);
  }
  const byMaster = new Map<number, Map<string, AggEntry>>();
  for (const row of rows) {
    let parsedSlots: unknown;
    try {
      parsedSlots = JSON.parse(row.slots_json);
    } catch {
      continue;
    }
    const slotsResult = SokuSpeedSlotRowsSchema.safeParse(parsedSlots);
    if (!slotsResult.success) continue;
    const itemIds: number[] = [];
    for (const s of slotsResult.data) {
      if (s.slotitem_id > 0) itemIds.push(s.slotitem_id);
    }
    if (row.exslot_json) {
      let parsedExslot: unknown;
      try {
        parsedExslot = JSON.parse(row.exslot_json);
      } catch {
        parsedExslot = null;
      }
      const exslotResult = SokuSpeedExslotSchema.safeParse(parsedExslot);
      if (exslotResult.success && exslotResult.data) {
        itemIds.push(exslotResult.data.slotitem_id);
      }
    }
    itemIds.sort((a, b) => a - b);
    if (!byMaster.has(row.master_id)) byMaster.set(row.master_id, new Map());
    const comboKey = itemIds.join(",");
    const masterMap = byMaster.get(row.master_id)!;
    const existing = masterMap.get(comboKey);
    if (!existing) {
      masterMap.set(comboKey, {
        soku_observed: row.soku_observed,
        item_ids: itemIds,
      });
    } else {
      existing.soku_observed = Math.max(
        existing.soku_observed,
        row.soku_observed,
      );
    }
  }
  const data: Record<number, AggEntry[]> = {};
  for (const [masterId, comboMap] of byMaster) {
    data[masterId] = Array.from(comboMap.values());
  }

  const responseString = JSON.stringify({
    ok: true,
    period_tag: periodTag,
    table_version: tableVersion,
    data,
  });

  if (cacheKV) {
    const writeTask = (async () => {
      try {
        await cacheKV.put(cacheKey, responseString, { expirationTtl: 86400 * 30 });
        if (!requestedPeriodTag || !requestedTableVersion) {
          await cacheKV.put("soku-speed-upgrade:v1:latest", responseString, { expirationTtl: 86400 * 30 });
        }
      } catch (e) {
        console.error("[soku-speed] KV cache write error:", e);
      }
    })();
    safeWaitUntil(c, writeTask);
  }

  const response = new Response(responseString, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "X-FUSOU-Cache": "MISS",
    }
  });
  return response;
});
export default app;
