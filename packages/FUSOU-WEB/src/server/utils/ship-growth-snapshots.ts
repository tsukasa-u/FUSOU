import type { Context } from "hono";
import type { R2Bucket, R2ObjectBody } from "@cloudflare/workers-types";
import { brotliCompress, brotliDecompress, constants } from "node:zlib";
import { promisify } from "node:util";
import { z } from "zod";
import { compareTableVersions } from "../../features/battles/helpers";
import type { Bindings, D1Database } from "../types";
import {
  ShipGrowthArchiveBoundsRowSchema,
  ShipGrowthArchiveCapsRowSchema,
  ShipGrowthBoundsUpdatedRowSchema,
  ShipGrowthBoundsRowSchema,
  ShipGrowthCapsRowSchema,
  ShipGrowthCapsUpdatedRowSchema,
  ShipGrowthCountRowSchema,
  ShipGrowthExpUpdatedRowSchema,
  ShipGrowthPeriodRowSchema,
} from "../schemas/ship-growth";

const brotliCompressAsync = promisify(brotliCompress);
const brotliDecompressAsync = promisify(brotliDecompress);

// Snapshot R2 Key constants
export const SHIP_GROWTH_SNAPSHOT_PREFIX = "snapshots/ship_growth/";
export const SHIP_GROWTH_SUMMARY_SNAPSHOT_KEY = "snapshots/ship_growth/summary.json.br";
export const SHIP_GROWTH_CUMULATIVE_SNAPSHOT_KEY = "snapshots/ship_growth/cumulative.json.br";
export const SHIP_GROWTH_ALL_PERIODS_SNAPSHOT_KEY = "snapshots/ship_growth/all_periods.json.br";
export const SHIP_GROWTH_MANIFEST_KEY = `${SHIP_GROWTH_SNAPSHOT_PREFIX}manifest.json`;
export const MAX_SHIP_GROWTH_JSON_BYTES = 16 * 1024 * 1024;

const ManifestSchema = z.object({
  schema_version: z.literal(1),
  generation: z.string().min(1),
  objects: z.record(z.string().startsWith(`${SHIP_GROWTH_SNAPSHOT_PREFIX}generations/`)),
});
type SnapshotManifest = z.infer<typeof ManifestSchema>;
class SnapshotPublicationConflict extends Error {}

async function loadManifest(bucket: R2Bucket) {
  const object = await bucket.get(SHIP_GROWTH_MANIFEST_KEY);
  return object
    ? { manifest: ManifestSchema.parse(await object.json()), etag: object.etag }
    : null;
}

export async function getShipGrowthSnapshot(
  bucket: R2Bucket,
  key: string,
): Promise<R2ObjectBody | null> {
  const current = await loadManifest(bucket);
  if (!current) return bucket.get(key);
  const physicalKey = current.manifest.objects[key];
  if (!physicalKey) return null;
  const object = await bucket.get(physicalKey);
  if (!object) throw new Error(`Published ship-growth snapshot is missing: ${physicalKey}`);
  return object;
}

async function publishManifest(
  bucket: R2Bucket,
  manifest: SnapshotManifest,
  previousEtag: string | undefined,
): Promise<void> {
  const json = JSON.stringify(manifest);
  const history = await bucket.put(
    `${SHIP_GROWTH_SNAPSHOT_PREFIX}generations/${manifest.generation}/manifest.json`,
    json,
    { httpMetadata: { contentType: "application/json" } },
  );
  if (!history) throw new Error("Failed to save ship-growth manifest history");
  const result = await bucket.put(SHIP_GROWTH_MANIFEST_KEY, json, {
    httpMetadata: { contentType: "application/json" },
    onlyIf: previousEtag ? { etagMatches: previousEtag } : { etagDoesNotMatch: "*" },
  });
  if (!result) throw new SnapshotPublicationConflict("Ship-growth publication conflict; retry with fresh inputs");
}

/**
 * Normalizes table version string to standard semantic version format (e.g. "0.5" -> "0.5.0").
 */
export function normalizeTableVersion(version: string): string {
  const trimmed = (version || "").trim();
  if (trimmed === "0.5") {
    return "0.5.0";
  }
  return trimmed;
}

export function getShipGrowthBoundsSnapshotKey(periodTag: string, tableVersion: string): string {
  const effectiveVersion = normalizeTableVersion(tableVersion);
  return `snapshots/ship_growth/bounds/${periodTag}_${effectiveVersion}.json.br`;
}

export function getShipGrowthExpSnapshotKey(periodTag: string, tableVersion: string): string {
  const effectiveVersion = normalizeTableVersion(tableVersion);
  return `snapshots/ship_growth/exp/${periodTag}_${effectiveVersion}.json.br`;
}

/**
 * Compresses any JSON-serializable value or string to Brotli Uint8Array (Quality 6).
 */
export async function compressJsonToBrotli(data: unknown): Promise<Uint8Array> {
  const jsonStr = typeof data === "string" ? data : JSON.stringify(data);
  const buf = Buffer.from(jsonStr, "utf-8");
  if (buf.byteLength > MAX_SHIP_GROWTH_JSON_BYTES) {
    throw new Error("Ship-growth JSON exceeds the 16 MiB snapshot limit");
  }
  const compressed = await brotliCompressAsync(buf, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 6,
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
    },
  });
  if (compressed.byteLength > MAX_SHIP_GROWTH_JSON_BYTES) {
    throw new Error("Compressed ship-growth snapshot exceeds the 16 MiB input limit");
  }
  return new Uint8Array(compressed.buffer, compressed.byteOffset, compressed.byteLength);
}

/**
 * Decompresses Brotli binary buffer into parsed JSON object.
 */
export async function decompressBrotliToJson<T>(data: ArrayBuffer | Uint8Array): Promise<T> {
  const buf = data instanceof Uint8Array ? Buffer.from(data) : Buffer.from(data);
  if (buf.byteLength > MAX_SHIP_GROWTH_JSON_BYTES) {
    throw new Error("Ship-growth snapshot exceeds the 16 MiB input limit");
  }
  // Legacy snapshots can contain plain JSON under a .br key.
  try {
    return JSON.parse(buf.toString("utf-8")) as T;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  const decoded = await brotliDecompressAsync(buf, { maxOutputLength: MAX_SHIP_GROWTH_JSON_BYTES });
  return JSON.parse(decoded.toString("utf-8")) as T;
}

/**
 * Serves an R2 snapshot object as decompressed plain JSON text.
 * NOTE: We deliberately do NOT return Content-Encoding: br directly from Worker,
 * because browser fetch() does not transparently decompress Brotli from Worker responses,
 * causing JSON parse failures in cachedFetch ("Unexpected token ... is not valid JSON").
 * Cloudflare CDN handles edge gzip/br compression automatically for plain JSON responses.
 */
export async function serveShipGrowthSnapshot(
  _c: Context,
  r2Obj: R2ObjectBody,
  cacheControl = "public, max-age=3600, stale-while-revalidate=86400",
): Promise<Response> {
  const headers = new Headers();
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", cacheControl);
  headers.set("X-FUSOU-Cache", "SNAPSHOT-HIT");
  headers.set("X-FUSOU-Data-Source", "R2-SNAPSHOT");
  if (r2Obj.httpEtag) {
    headers.set("ETag", r2Obj.httpEtag);
  }

  if (r2Obj.size > MAX_SHIP_GROWTH_JSON_BYTES) {
    throw new Error("Ship-growth snapshot exceeds the 16 MiB input limit");
  }
  const value = z.object({ ok: z.literal(true) }).passthrough()
    .parse(await decompressBrotliToJson<unknown>(await r2Obj.arrayBuffer()));
  return new Response(JSON.stringify(value), { status: 200, headers });
}

/**
 * Saves a Brotli-compressed JSON snapshot to R2.
 */
export async function putShipGrowthSnapshot(
  bucket: R2Bucket,
  key: string,
  data: unknown,
  customMetadata?: Record<string, string>,
): Promise<void> {
  const compressed = await compressJsonToBrotli(data);
  const result = await bucket.put(key, compressed, {
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
      contentEncoding: "br",
    },
    customMetadata: {
      created_at: String(Date.now()),
      ...customMetadata,
    },
  });
  if (!result) throw new Error(`Failed to write ship-growth snapshot: ${key}`);
}

export interface ShipGrowthBoundsPayload {
  ok: true;
  period_tag: string;
  table_version: string;
  schema_version: 3;
  bounds: Array<{
    master_id: number;
    lv: number;
    kaihi_naked: number;
    taisen_naked: number;
    sakuteki_naked: number;
    lucky_naked: number;
  }>;
  caps: Array<{
    master_id: number;
    kaihi_max: number;
    taisen_max: number;
    sakuteki_max: number;
  }>;
}

export interface ShipGrowthExpPayload {
  ok: true;
  period_tag: string;
  table_version: string;
  exp: Array<{
    lv: number;
    exp_current: number;
  }>;
  rows: Array<{
    lv: number;
    exp_current: number;
  }>;
}

export interface ShipGrowthSummaryPayload {
  ok: true;
  periods: Array<{
    period_tag: string;
    table_version: string;
  }>;
  cumulative_available: boolean;
  archive_object_count: number;
}

type Bound = ShipGrowthBoundsPayload["bounds"][number];
type Cap = ShipGrowthBoundsPayload["caps"][number];

function emptyPeriod() {
  return { bounds: new Map<string, Bound>(), caps: new Map<number, Cap>() };
}

function observedMinimum(a: number, b: number): number {
  return a > 0 && b > 0 ? Math.min(a, b) : Math.max(0, a, b);
}

function mergeBound(rows: Map<string, Bound>, row: Bound): void {
  const key = `${row.master_id}:${row.lv}`;
  const current = rows.get(key);
  rows.set(key, {
    master_id: row.master_id,
    lv: row.lv,
    kaihi_naked: observedMinimum(current?.kaihi_naked ?? 0, row.kaihi_naked),
    taisen_naked: observedMinimum(current?.taisen_naked ?? 0, row.taisen_naked),
    sakuteki_naked: observedMinimum(current?.sakuteki_naked ?? 0, row.sakuteki_naked),
    lucky_naked: observedMinimum(current?.lucky_naked ?? 0, row.lucky_naked),
  });
}

function mergeCap(rows: Map<number, Cap>, row: Cap): void {
  const current = rows.get(row.master_id);
  rows.set(row.master_id, {
    master_id: row.master_id,
    kaihi_max: Math.max(current?.kaihi_max ?? 0, row.kaihi_max),
    taisen_max: Math.max(current?.taisen_max ?? 0, row.taisen_max),
    sakuteki_max: Math.max(current?.sakuteki_max ?? 0, row.sakuteki_max),
  });
}

async function listDatabasePeriods(db: D1Database) {
  const result = await db.prepare(
    "SELECT period_tag, table_version FROM ship_growth_bounds " +
    "UNION SELECT period_tag, table_version FROM ship_growth_caps " +
    "UNION SELECT period_tag, table_version FROM ship_level_exp_pairs",
  ).all();
  return ShipGrowthPeriodRowSchema.array().parse(result.results ?? []);
}

/**
 * Builds bounds snapshot for a period from D1.
 */
export async function buildShipGrowthBoundsSnapshotFromD1(
  db: D1Database,
  periodTag: string,
  tableVersion: string,
): Promise<ShipGrowthBoundsPayload> {
  const version = normalizeTableVersion(tableVersion);
  const legacyVersion = version === "0.5.0" ? "0.5" : version;
  const countRes = await db
    .prepare("SELECT COUNT(*) as c FROM ship_growth_bounds WHERE period_tag = ? AND table_version IN (?, ?)")
    .bind(periodTag, version, legacyVersion)
    .first();
  const parsedCount = ShipGrowthCountRowSchema.safeParse(countRes);
  if (!parsedCount.success) {
    throw new Error("Invalid ship-growth bounds count row");
  }
  const totalRows = parsedCount.data.c;

  const BOUNDS_PAGE = 5000;
  let boundsRows: Array<{
    master_id: number;
    lv: number;
    kaihi_naked: number;
    taisen_naked: number;
    sakuteki_naked: number;
    lucky_naked: number;
  }> = [];

  if (totalRows > 0) {
    const stmts: ReturnType<D1Database["prepare"]>[] = [];
    for (let offset = 0; offset < totalRows; offset += BOUNDS_PAGE) {
      stmts.push(
        db.prepare(
          "SELECT master_id, lv, kaihi_naked, taisen_naked, sakuteki_naked, lucky_naked, updated_at " +
          "FROM ship_growth_bounds " +
          "WHERE period_tag = ? AND table_version IN (?, ?) " +
          "ORDER BY master_id ASC, lv ASC LIMIT ? OFFSET ?"
        ).bind(periodTag, version, legacyVersion, BOUNDS_PAGE, offset)
      );
    }
    const BATCH_LIMIT = 100;
    for (let i = 0; i < stmts.length; i += BATCH_LIMIT) {
      const batchResults = await db.batch(stmts.slice(i, i + BATCH_LIMIT));
      for (const res of batchResults) {
        const parsedRows = ShipGrowthBoundsUpdatedRowSchema.array().safeParse(
          res.results ?? [],
        );
        if (!parsedRows.success) {
          throw new Error("Invalid ship-growth bounds rows");
        }
        boundsRows = boundsRows.concat(parsedRows.data);
      }
    }
  }

  const capsResult = await db
    .prepare(
      "SELECT master_id, kaihi_max, taisen_max, sakuteki_max, updated_at " +
      "FROM ship_growth_caps " +
      "WHERE period_tag = ? AND table_version IN (?, ?)",
    )
    .bind(periodTag, version, legacyVersion)
    .all();
  const parsedCaps = ShipGrowthCapsUpdatedRowSchema.array().safeParse(
    capsResult.results ?? [],
  );
  if (!parsedCaps.success) {
    throw new Error("Invalid ship-growth caps rows");
  }
  const capsRows = parsedCaps.data;

  const merged = emptyPeriod();
  for (const row of boundsRows) mergeBound(merged.bounds, row);
  for (const row of capsRows) mergeCap(merged.caps, row);
  return {
    ok: true,
    period_tag: periodTag,
    table_version: version,
    schema_version: 3,
    bounds: [...merged.bounds.values()].map((r) => ({
      master_id: r.master_id,
      lv: r.lv,
      kaihi_naked: r.kaihi_naked,
      taisen_naked: r.taisen_naked,
      sakuteki_naked: r.sakuteki_naked,
      lucky_naked: r.lucky_naked,
    })),
    caps: [...merged.caps.values()].map((r) => ({
      master_id: r.master_id,
      kaihi_max: r.kaihi_max,
      taisen_max: r.taisen_max,
      sakuteki_max: r.sakuteki_max,
    })),
  };
}

/**
 * Builds exp snapshot for a period from D1.
 */
export async function buildShipGrowthExpSnapshotFromD1(
  db: D1Database,
  periodTag: string,
  tableVersion: string,
): Promise<ShipGrowthExpPayload> {
  const version = normalizeTableVersion(tableVersion);
  const legacyVersion = version === "0.5.0" ? "0.5" : version;
  const rowsResult = await db
    .prepare(
      "SELECT lv, exp_current, updated_at FROM ship_level_exp_pairs " +
      "WHERE period_tag = ? AND table_version IN (?, ?) " +
      "ORDER BY lv ASC",
    )
    .bind(periodTag, version, legacyVersion)
    .all();
  const parsedRows = ShipGrowthExpUpdatedRowSchema.array().safeParse(
    rowsResult.results ?? [],
  );
  if (!parsedRows.success) {
    throw new Error("Invalid ship-growth exp rows");
  }
  const byLevel = new Map<number, number>();
  for (const row of parsedRows.data) {
    const previous = byLevel.get(row.lv);
    if (previous !== undefined && previous !== row.exp_current) {
      throw new Error(`Conflicting ship-growth EXP observations at level ${row.lv}`);
    }
    byLevel.set(row.lv, row.exp_current);
  }
  const mappedRows = [...byLevel].map(([lv, exp_current]) => ({
    lv,
    exp_current,
  }));
  return {
    ok: true,
    period_tag: periodTag,
    table_version: version,
    exp: mappedRows,
    rows: mappedRows,
  };
}

/**
 * Rebuilds all snapshots from D1 and R2 archives.
 */
export async function rebuildAllShipGrowthSnapshots(
  env: Pick<Bindings, "SHIP_GROWTH_ARCHIVE_BUCKET">,
  db?: D1Database,
): Promise<{
  generated: string[];
  periods: Array<{ period_tag: string; table_version: string }>;
  archive_object_count: number;
}> {
  const archiveBucket = env.SHIP_GROWTH_ARCHIVE_BUCKET;
  if (!archiveBucket) {
    throw new Error("SHIP_GROWTH_ARCHIVE_BUCKET is not configured");
  }

  const generated: string[] = [];
  const previous = await loadManifest(archiveBucket);
  const generation = crypto.randomUUID();
  const objects: Record<string, string> = {};
  const save = async (key: string, value: unknown) => {
    const physicalKey = `${SHIP_GROWTH_SNAPSHOT_PREFIX}generations/${generation}/${key.slice(SHIP_GROWTH_SNAPSHOT_PREFIX.length)}`;
    await putShipGrowthSnapshot(archiveBucket, physicalKey, value);
    objects[key] = physicalKey;
    generated.push(physicalKey);
  };

  // 1. List all archive objects in R2
  const archiveObjects: string[] = [];
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  while (true) {
    const listed = await archiveBucket.list({
      prefix: "ship-growth/archive/",
      ...(cursor !== undefined ? { cursor } : {}),
      limit: 100,
    });
    for (const obj of listed.objects) {
      archiveObjects.push(obj.key);
    }
    if (!listed.truncated) break;
    cursor = listed.cursor;
    if (!cursor || seenCursors.has(cursor)) {
      throw new Error("Incomplete ship-growth archive listing");
    }
    seenCursors.add(cursor);
  }

  // 2. Aggregate data from all archive objects
  const pastPeriodsMap = new Map<string, {
    bounds: Map<string, { master_id: number; lv: number; kaihi_naked: number; taisen_naked: number; sakuteki_naked: number; lucky_naked: number }>;
    caps: Map<number, { master_id: number; kaihi_max: number; taisen_max: number; sakuteki_max: number }>;
  }>();

  const cumulativeBoundsMap = new Map<string, { master_id: number; lv: number; kaihi_naked: number; taisen_naked: number; sakuteki_naked: number; lucky_naked: number }>();
  const cumulativeCapsMap = new Map<number, { master_id: number; kaihi_max: number; taisen_max: number; sakuteki_max: number }>();
  let lastArchivedAtSec = 0;

  for (const key of archiveObjects) {
    const obj = await archiveBucket.get(key);
    if (!obj) throw new Error(`Missing ship-growth archive: ${key}`);
    if (obj.size > MAX_SHIP_GROWTH_JSON_BYTES) {
      throw new Error(`Ship-growth archive exceeds the 16 MiB limit: ${key}`);
    }
    const text = await obj.text();
    const parsed = z.object({
      archived_at: z.number().finite(),
      rows: z.object({
        bounds: z.array(ShipGrowthArchiveBoundsRowSchema),
        caps: z.array(ShipGrowthArchiveCapsRowSchema),
      }),
    }).passthrough().parse(JSON.parse(text));

    const archivedAt = Number(parsed.archived_at) || 0;
    if (archivedAt > lastArchivedAtSec) lastArchivedAtSec = archivedAt;

    const boundsList = Array.isArray(parsed.rows.bounds) ? parsed.rows.bounds : [];
    const capsList = Array.isArray(parsed.rows.caps) ? parsed.rows.caps : [];

    for (const raw of boundsList) {
      const p = ShipGrowthArchiveBoundsRowSchema.safeParse(raw);
      if (!p.success) throw new Error(`Invalid ship-growth bounds in ${key}`);
      const r = p.data;
      const normalizedVersion = normalizeTableVersion(r.table_version);
      const periodKey = `${r.period_tag}/${normalizedVersion}`;
      if (!pastPeriodsMap.has(periodKey)) {
        pastPeriodsMap.set(periodKey, { bounds: new Map(), caps: new Map() });
      }
      const pEntry = pastPeriodsMap.get(periodKey)!;
      const bKey = `${r.master_id}:${r.lv}`;

      // Per-period min merge
      const existing = pEntry.bounds.get(bKey);
      if (!existing) {
        pEntry.bounds.set(bKey, {
          master_id: r.master_id,
          lv: r.lv,
          kaihi_naked: Math.max(0, r.kaihi_naked),
          taisen_naked: Math.max(0, r.taisen_naked),
          sakuteki_naked: Math.max(0, r.sakuteki_naked),
          lucky_naked: Math.max(0, r.lucky_naked),
        });
      } else {
        mergeBound(pEntry.bounds, r);
      }

      // Cumulative min merge
      const cExisting = cumulativeBoundsMap.get(bKey);
      if (!cExisting) {
        cumulativeBoundsMap.set(bKey, {
          master_id: r.master_id,
          lv: r.lv,
          kaihi_naked: Math.max(0, r.kaihi_naked),
          taisen_naked: Math.max(0, r.taisen_naked),
          sakuteki_naked: Math.max(0, r.sakuteki_naked),
          lucky_naked: Math.max(0, r.lucky_naked),
        });
      } else {
        mergeBound(cumulativeBoundsMap, r);
      }
    }

    for (const raw of capsList) {
      const p = ShipGrowthArchiveCapsRowSchema.safeParse(raw);
      if (!p.success) throw new Error(`Invalid ship-growth caps in ${key}`);
      const r = p.data;
      const normalizedVersion = normalizeTableVersion(r.table_version);
      const periodKey = `${r.period_tag}/${normalizedVersion}`;
      if (!pastPeriodsMap.has(periodKey)) {
        pastPeriodsMap.set(periodKey, { bounds: new Map(), caps: new Map() });
      }
      const pEntry = pastPeriodsMap.get(periodKey)!;

      const existingCap = pEntry.caps.get(r.master_id);
      if (!existingCap) {
        pEntry.caps.set(r.master_id, {
          master_id: r.master_id,
          kaihi_max: r.kaihi_max,
          taisen_max: r.taisen_max,
          sakuteki_max: r.sakuteki_max,
        });
      } else {
        existingCap.kaihi_max = Math.max(existingCap.kaihi_max, r.kaihi_max);
        existingCap.taisen_max = Math.max(existingCap.taisen_max, r.taisen_max);
        existingCap.sakuteki_max = Math.max(existingCap.sakuteki_max, r.sakuteki_max);
      }

      const cCap = cumulativeCapsMap.get(r.master_id);
      if (!cCap) {
        cumulativeCapsMap.set(r.master_id, {
          master_id: r.master_id,
          kaihi_max: r.kaihi_max,
          taisen_max: r.taisen_max,
          sakuteki_max: r.sakuteki_max,
        });
      } else {
        cCap.kaihi_max = Math.max(cCap.kaihi_max, r.kaihi_max);
        cCap.taisen_max = Math.max(cCap.taisen_max, r.taisen_max);
        cCap.sakuteki_max = Math.max(cCap.sakuteki_max, r.sakuteki_max);
      }
    }
  }

  // 3. Save past periods bounds snapshots
  const allPeriodsEntries: Array<{
    period_tag: string;
    table_version: string;
    bounds: Bound[];
    caps: Cap[];
  }> = [];

  // 4. Query D1 for latest periods if db is provided
  const periodTagSet = new Map<string, { period_tag: string; table_version: string }>();

  // Add past periods from archives
  for (const periodKey of pastPeriodsMap.keys()) {
    const parts = periodKey.split("/");
    const periodTag = parts[0] || "";
    const tableVersion = normalizeTableVersion(parts[1] || "");
    if (!periodTag || !tableVersion) continue;
    periodTagSet.set(`${periodTag}_${tableVersion}`, { period_tag: periodTag, table_version: tableVersion });
  }

  if (db) {
    const processed = new Set<string>();
    for (const p of await listDatabasePeriods(db)) {
      const version = normalizeTableVersion(p.table_version);
      const periodKey = `${p.period_tag}/${version}`;
      if (processed.has(periodKey)) continue;
      processed.add(periodKey);
      periodTagSet.set(`${p.period_tag}_${version}`, { period_tag: p.period_tag, table_version: version });
      const payload = await buildShipGrowthBoundsSnapshotFromD1(db, p.period_tag, version);
      const data = pastPeriodsMap.get(periodKey) ?? emptyPeriod();
      for (const row of payload.bounds) {
        mergeBound(data.bounds, row);
        mergeBound(cumulativeBoundsMap, row);
      }
      for (const row of payload.caps) {
        mergeCap(data.caps, row);
        mergeCap(cumulativeCapsMap, row);
      }
      pastPeriodsMap.set(periodKey, data);
      await save(
        getShipGrowthExpSnapshotKey(p.period_tag, version),
        await buildShipGrowthExpSnapshotFromD1(db, p.period_tag, version),
      );
    }
  }

  for (const [periodKey, data] of pastPeriodsMap) {
    const [periodTag, tableVersion] = periodKey.split("/");
    if (!periodTag || !tableVersion) throw new Error(`Invalid ship-growth period: ${periodKey}`);
    const bounds = [...data.bounds.values()].sort((a, b) => a.master_id - b.master_id || a.lv - b.lv);
    const caps = [...data.caps.values()].sort((a, b) => a.master_id - b.master_id);
    await save(getShipGrowthBoundsSnapshotKey(periodTag, tableVersion), {
      ok: true, period_tag: periodTag, table_version: tableVersion, schema_version: 3, bounds, caps,
    });
    const expKey = getShipGrowthExpSnapshotKey(periodTag, tableVersion);
    if (!objects[expKey]) {
      await save(expKey, { ok: true, period_tag: periodTag, table_version: tableVersion, exp: [], rows: [] });
    }
    allPeriodsEntries.push({ period_tag: periodTag, table_version: tableVersion, bounds, caps });
  }

  // 5. Save cumulative snapshot
  const cumulativePayload = {
    ok: true,
    bounds: Array.from(cumulativeBoundsMap.values()).sort(
      (a, b) => a.master_id - b.master_id || a.lv - b.lv,
    ),
    caps: Array.from(cumulativeCapsMap.values()).sort(
      (a, b) => a.master_id - b.master_id,
    ),
    archive_object_count: archiveObjects.length,
    last_archived_at_sec: lastArchivedAtSec,
  };
  await save(SHIP_GROWTH_CUMULATIVE_SNAPSHOT_KEY, cumulativePayload);

  // 6. Save all_periods snapshot (include both entries and periods for universal schema compatibility)
  allPeriodsEntries.sort((a, b) => a.period_tag.localeCompare(b.period_tag) || compareTableVersions(a.table_version, b.table_version));
  const allPeriodsPayload = {
    ok: true,
    entries: allPeriodsEntries,
    periods: allPeriodsEntries,
    archive_object_count: archiveObjects.length,
  };
  await save(SHIP_GROWTH_ALL_PERIODS_SNAPSHOT_KEY, allPeriodsPayload);

  // 7. Save summary snapshot
  const sortedPeriods = Array.from(periodTagSet.values()).sort(
    (a, b) => b.period_tag.localeCompare(a.period_tag) || compareTableVersions(b.table_version, a.table_version),
  );
  const summaryPayload: ShipGrowthSummaryPayload = {
    ok: true,
    periods: sortedPeriods,
    cumulative_available: cumulativePayload.bounds.length > 0 || archiveObjects.length > 0,
    archive_object_count: archiveObjects.length,
  };
  await save(SHIP_GROWTH_SUMMARY_SNAPSHOT_KEY, summaryPayload);

  await publishManifest(archiveBucket, { schema_version: 1, generation, objects }, previous?.etag);

  return {
    generated,
    periods: sortedPeriods,
    archive_object_count: archiveObjects.length,
  };
}

export async function refreshShipGrowthPeriodSnapshots(
  env: Pick<Bindings, "SHIP_GROWTH_ARCHIVE_BUCKET">,
  db: D1Database,
  periodTag: string,
  tableVersion: string,
): Promise<void> {
  const bucket = env.SHIP_GROWTH_ARCHIVE_BUCKET;
  if (!bucket) throw new Error("SHIP_GROWTH_ARCHIVE_BUCKET is not configured");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const current = await loadManifest(bucket);
      if (!current) {
        await rebuildAllShipGrowthSnapshots(env, db);
        return;
      }
      const version = normalizeTableVersion(tableVersion);
      const bounds = await buildShipGrowthBoundsSnapshotFromD1(db, periodTag, version);
      const boundsKey = getShipGrowthBoundsSnapshotKey(periodTag, version);
      const previousBoundsKey = current.manifest.objects[boundsKey];
      if (previousBoundsKey) {
        const object = await bucket.get(previousBoundsKey);
        if (!object) throw new Error("Published ship-growth bounds object is missing");
        const previousBounds = z.object({
          bounds: z.array(ShipGrowthBoundsRowSchema),
          caps: z.array(ShipGrowthCapsRowSchema),
        }).parse(await decompressBrotliToJson<unknown>(await object.arrayBuffer()));
        const merged = emptyPeriod();
        for (const row of [...previousBounds.bounds, ...bounds.bounds]) mergeBound(merged.bounds, row);
        for (const row of [...previousBounds.caps, ...bounds.caps]) mergeCap(merged.caps, row);
        bounds.bounds = [...merged.bounds.values()].sort((a, b) => a.master_id - b.master_id || a.lv - b.lv);
        bounds.caps = [...merged.caps.values()].sort((a, b) => a.master_id - b.master_id);
      }
      const exp = await buildShipGrowthExpSnapshotFromD1(db, periodTag, version);
      const summaryKey = current.manifest.objects[SHIP_GROWTH_SUMMARY_SNAPSHOT_KEY];
      if (!summaryKey) throw new Error("Published ship-growth summary is missing");
      const summaryObject = await bucket.get(summaryKey);
      if (!summaryObject) throw new Error("Published ship-growth summary object is missing");
      const summary = z.object({
        ok: z.literal(true),
        periods: z.array(ShipGrowthPeriodRowSchema),
        cumulative_available: z.boolean(),
        archive_object_count: z.number().int().nonnegative(),
      }).parse(await decompressBrotliToJson<unknown>(await summaryObject.arrayBuffer()));
      const periods = new Map(summary.periods.map((row) => [`${row.period_tag}/${row.table_version}`, row]));
      periods.set(`${periodTag}/${version}`, { period_tag: periodTag, table_version: version });
      summary.periods = [...periods.values()].sort((a, b) =>
        b.period_tag.localeCompare(a.period_tag) || compareTableVersions(b.table_version, a.table_version));
      summary.cumulative_available ||= bounds.bounds.length > 0;
      const readAggregate = async (key: string) => {
        const physicalKey = current.manifest.objects[key];
        if (!physicalKey) throw new Error(`Published ship-growth aggregate is missing: ${key}`);
        const object = await bucket.get(physicalKey);
        if (!object) throw new Error(`Published ship-growth aggregate object is missing: ${key}`);
        return decompressBrotliToJson<unknown>(await object.arrayBuffer());
      };
      const cumulative = z.object({
        ok: z.literal(true),
        bounds: z.array(ShipGrowthBoundsRowSchema),
        caps: z.array(ShipGrowthCapsRowSchema),
      }).passthrough().parse(await readAggregate(SHIP_GROWTH_CUMULATIVE_SNAPSHOT_KEY));
      const mergedCumulative = emptyPeriod();
      for (const row of [...cumulative.bounds, ...bounds.bounds]) mergeBound(mergedCumulative.bounds, row);
      for (const row of [...cumulative.caps, ...bounds.caps]) mergeCap(mergedCumulative.caps, row);
      cumulative.bounds = [...mergedCumulative.bounds.values()].sort((a, b) => a.master_id - b.master_id || a.lv - b.lv);
      cumulative.caps = [...mergedCumulative.caps.values()].sort((a, b) => a.master_id - b.master_id);
      const allPeriods = z.object({
        ok: z.literal(true),
        entries: z.array(z.object({
          period_tag: z.string(),
          table_version: z.string(),
          bounds: z.array(ShipGrowthBoundsRowSchema),
          caps: z.array(ShipGrowthCapsRowSchema),
        })),
      }).passthrough().parse(await readAggregate(SHIP_GROWTH_ALL_PERIODS_SNAPSHOT_KEY));
      const entries = new Map(allPeriods.entries.map((entry) => [
        `${entry.period_tag}/${entry.table_version}`, entry,
      ]));
      entries.set(`${periodTag}/${version}`, {
        period_tag: periodTag, table_version: version, bounds: bounds.bounds, caps: bounds.caps,
      });
      allPeriods.entries = [...entries.values()].sort((a, b) =>
        a.period_tag.localeCompare(b.period_tag) || compareTableVersions(a.table_version, b.table_version));
      allPeriods["periods"] = allPeriods.entries;
      const generation = crypto.randomUUID();
      const objects = { ...current.manifest.objects };
      for (const [key, payload] of [
        [getShipGrowthBoundsSnapshotKey(periodTag, version), bounds],
        [getShipGrowthExpSnapshotKey(periodTag, version), exp],
        [SHIP_GROWTH_SUMMARY_SNAPSHOT_KEY, summary],
        [SHIP_GROWTH_CUMULATIVE_SNAPSHOT_KEY, cumulative],
        [SHIP_GROWTH_ALL_PERIODS_SNAPSHOT_KEY, allPeriods],
      ] as const) {
        const physicalKey = `${SHIP_GROWTH_SNAPSHOT_PREFIX}generations/${generation}/${key.slice(SHIP_GROWTH_SNAPSHOT_PREFIX.length)}`;
        await putShipGrowthSnapshot(bucket, physicalKey, payload);
        objects[key] = physicalKey;
      }
      await publishManifest(bucket, { schema_version: 1, generation, objects }, current.etag);
      return;
    } catch (error) {
      if (!(error instanceof SnapshotPublicationConflict) || attempt === 2) throw error;
    }
  }
}
