import { Hono } from "hono";
import type { Bindings, D1Database } from "../types";
import {
  createEnvContext,
  generateSignedToken,
  getEnv,
  resolveDatasetToken,
  timingSafeEqual,
  validateDatasetTokenSecret,
  validateDatasetTokenWithConstraints,
  validateJWT,
  validateTokenPayload,
  verifySignedToken,
} from "../utils";
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
interface SokuSpeedIngestBody {
  dataset_id?: unknown;
  dataset_token?: unknown;
  request_id?: unknown;
  payload_hash?: unknown;
  event_type?: unknown;
  period_tag?: unknown;
  table_version?: unknown;
  ships?: unknown;
  content_hash?: unknown;
  file_size?: unknown;
}
function isValidInt(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value)
  );
}
function validateSokuSpeedIngestBody(
  body: SokuSpeedIngestBody | null,
):
  | { ok: true; datasetId: string; requestId: string; eventType: string }
  | { ok: false; error: string } {
  if (!body) return { ok: false, error: "Missing body" };
  const datasetId = String(body.dataset_id ?? "").trim();
  if (!datasetId) return { ok: false, error: "dataset_id is required" };
  if (!/^[a-f0-9]{64}$/i.test(datasetId)) {
    return {
      ok: false,
      error: "dataset_id must be a 64-character SHA-256 hex string",
    };
  }
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
  if (eventType !== "snapshot") {
    return { ok: false, error: 'event_type must be "snapshot"' };
  }
  if (
    !body.period_tag ||
    !/^\d{4}-\d{2}-\d{2}$/.test(String(body.period_tag))
  ) {
    return { ok: false, error: "Invalid period_tag (expected YYYY-MM-DD)" };
  }
  if (!body.table_version) {
    return { ok: false, error: "table_version is required" };
  }
  if (!Array.isArray(body.ships) || body.ships.length === 0) {
    return {
      ok: false,
      error: "ships array is required and must not be empty",
    };
  }
  for (const [index, ship] of (body.ships as unknown[]).entries()) {
    const s = ship as Record<string, unknown>;
    if (
      !isValidInt(s.master_id) ||
      !isValidInt(s.lv) ||
      !isValidInt(s.soku_observed)
    ) {
      return { ok: false, error: `ships[${index}] has invalid numeric fields` };
    }
    if (
      !Array.isArray(s.slots) ||
      (s.slots as unknown[]).some((slot) => {
        const sl = slot as Record<string, unknown>;
        return (
          !isValidInt(sl.slotitem_id) ||
          typeof sl.locked !== "boolean" ||
          !isValidInt(sl.level) ||
          !isValidInt(sl.alv)
        );
      })
    ) {
      return { ok: false, error: `ships[${index}].slots has invalid fields` };
    }
  }
  return { ok: true, datasetId, requestId, eventType };
}
async function resolveLatestMasterPeriod(
  masterDb: D1Database,
): Promise<{ period_tag: string; table_version: string } | null> {
  const latest = (await masterDb
    .prepare(
      `SELECT period_tag, table_version       FROM master_data_index       WHERE upload_status = 'completed'       ORDER BY completed_at DESC, period_revision DESC       LIMIT 1`,
    )
    .first()) as { period_tag: string; table_version: string } | null;
  return latest;
}
app.post("/ingest", async (c) => {
  const db = c.env.SOKU_SPEED_OBSERVED_DB;
  if (!db)
    return c.json({ error: "SOKU_SPEED_OBSERVED_DB not configured" }, 503);
  const masterDb = c.env.MASTER_DATA_INDEX_DB;
  if (!masterDb)
    return c.json({ error: "MASTER_DATA_INDEX_DB not configured" }, 503);
  const env = createEnvContext(c);
  const signingSecret = getEnv(env, "SHIP_GROWTH_SIGNING_SECRET");
  if (!signingSecret) {
    return c.json({ error: "SHIP_GROWTH_SIGNING_SECRET is required" }, 500);
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
    const handshakeBody = (await c.req
      .json()
      .catch(() => null)) as SokuSpeedIngestBody | null;
    const validated = validateSokuSpeedIngestBody(handshakeBody);
    if (!validated.ok) return c.json({ error: validated.error }, 400);
    const bodyPeriodTag = String(handshakeBody?.period_tag ?? "").trim();
    const bodyTableVersion = String(handshakeBody?.table_version ?? "").trim();
    const latestMaster = await resolveLatestMasterPeriod(masterDb);
    if (!latestMaster) {
      return c.json({ error: "No completed master data period found" }, 503);
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
  const validated = validateTokenPayload(tokenPayload);
  if (!validated.valid) return c.json({ error: validated.error }, 400);
  const contentHashHeader = c.req.header("content-hash");
  const rawBody = await c.req.arrayBuffer().catch(() => null);
  if (!rawBody) return c.json({ error: "Missing request body" }, 400);
  const digest = await crypto.subtle.digest("SHA-256", rawBody);
  const actualContentHash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (!timingSafeEqual(actualContentHash, tokenPayload.content_hash ?? "")) {
    return c.json({ error: "content-hash mismatch" }, 400);
  }
  if (
    contentHashHeader &&
    !timingSafeEqual(contentHashHeader, actualContentHash)
  ) {
    return c.json({ error: "content-hash header mismatch" }, 400);
  }
  if (rawBody.byteLength !== tokenPayload.declared_size) {
    return c.json({ error: "file_size mismatch" }, 400);
  }
  let body: SokuSpeedIngestBody;
  try {
    body = JSON.parse(new TextDecoder().decode(rawBody)) as SokuSpeedIngestBody;
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const bodyValidated = validateSokuSpeedIngestBody(body);
  if (!bodyValidated.ok) return c.json({ error: bodyValidated.error }, 400);
  if (
    !timingSafeEqual(
      String(body.request_id ?? ""),
      tokenPayload.request_id ?? "",
    )
  ) {
    return c.json({ error: "request_id mismatch" }, 400);
  }
  if (
    !timingSafeEqual(
      String(body.dataset_id ?? ""),
      tokenPayload.dataset_id ?? "",
    )
  ) {
    return c.json({ error: "dataset_id mismatch" }, 400);
  }
  const { period_tag, table_version } = body as {
    period_tag: string;
    table_version: string;
  };
  const latestMaster = await resolveLatestMasterPeriod(masterDb);
  if (!latestMaster) {
    return c.json({ error: "No completed master data period found" }, 503);
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
    typeof tokenPayload.period_tag === "string" &&
    !timingSafeEqual(tokenPayload.period_tag, period_tag)
  ) {
    return c.json({ error: "period_tag mismatch" }, 400);
  }
  if (
    typeof tokenPayload.table_version === "string" &&
    !timingSafeEqual(tokenPayload.table_version, table_version)
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
    const exslotJson = ship.exslot ? JSON.stringify(ship.exslot) : null;
    stmts.push(
      db
        .prepare(
          `INSERT INTO soku_speed_observations           (period_tag, master_id, lv, soku_observed, slots_json, exslot_json, table_version, updated_at)         VALUES (?, ?, ?, ?, ?, ?, ?, ?)         ON CONFLICT(period_tag, table_version, master_id, slots_json) DO UPDATE SET           soku_observed = excluded.soku_observed,           lv = excluded.lv,           exslot_json = excluded.exslot_json,           updated_at = excluded.updated_at`,
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
  type ObsRow = {
    master_id: number;
    soku_observed: number;
    slots_json: string;
    exslot_json: string | null;
  };
  let periodTag = requestedPeriodTag;
  let tableVersion = requestedTableVersion;
  if (!periodTag || !tableVersion) {
    try {
      const masterDb = c.env.MASTER_DATA_INDEX_DB;
      const latest = masterDb
        ? await resolveLatestMasterPeriod(masterDb)
        : ((await db
            .prepare(
              `SELECT period_tag, table_version               FROM soku_speed_observations               ORDER BY period_tag DESC, updated_at DESC               LIMIT 1`,
            )
            .first()) as { period_tag: string; table_version: string } | null);
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
  let rows: ObsRow[];
  try {
    const result = await db
      .prepare(
        `SELECT master_id, soku_observed, slots_json, exslot_json         FROM soku_speed_observations         WHERE period_tag = ? AND table_version = ?`,
      )
      .bind(periodTag, tableVersion)
      .all();
    rows = (result.results ?? []) as ObsRow[];
  } catch (err) {
    console.error(
      "[soku-speed] Failed to query speed-upgrade observations:",
      err,
    );
    return c.json({ error: "Failed to query speed upgrade observations" }, 500);
  }
  type AggEntry = { soku_observed: number; item_ids: number[] };
  const byMaster = new Map<number, Map<string, AggEntry>>();
  for (const row of rows) {
    let slots: Array<{ slotitem_id: number }>;
    try {
      slots = JSON.parse(row.slots_json) as Array<{ slotitem_id: number }>;
    } catch {
      continue;
    }
    const itemIds: number[] = [];
    for (const s of slots) {
      if (s.slotitem_id > 0) itemIds.push(s.slotitem_id);
    }
    if (row.exslot_json) {
      try {
        const ex = JSON.parse(row.exslot_json) as {
          slotitem_id: number;
        } | null;
        if (ex && ex.slotitem_id > 0) itemIds.push(ex.slotitem_id);
      } catch {
        /* skip malformed exslot */
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
  const response = c.json({
    ok: true,
    period_tag: periodTag,
    table_version: tableVersion,
    data,
  });
  response.headers.set(
    "Cache-Control",
    "public, max-age=3600, stale-while-revalidate=86400",
  );
  return response;
});
export default app;
