import type { Context } from "hono";
import type { R2Bucket, R2ObjectBody } from "@cloudflare/workers-types";
import { brotliCompress, brotliDecompress, constants } from "node:zlib";
import { promisify } from "node:util";
import type { Bindings, D1Database } from "../types";
import {
  ShipGrowthArchiveBoundsRowSchema,
  ShipGrowthArchiveCapsRowSchema,
  ShipGrowthBoundsUpdatedRowSchema,
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

export function getShipGrowthBoundsSnapshotKey(periodTag: string, tableVersion: string): string {
  return `snapshots/ship_growth/bounds/${periodTag}_${tableVersion}.json.br`;
}

export function getShipGrowthExpSnapshotKey(periodTag: string, tableVersion: string): string {
  return `snapshots/ship_growth/exp/${periodTag}_${tableVersion}.json.br`;
}

/**
 * Compresses any JSON-serializable value or string to Brotli Uint8Array (Quality 6).
 */
export async function compressJsonToBrotli(data: unknown): Promise<Uint8Array> {
  const jsonStr = typeof data === "string" ? data : JSON.stringify(data);
  const buf = Buffer.from(jsonStr, "utf-8");
  const compressed = await brotliCompressAsync(buf, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 6,
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
    },
  });
  return new Uint8Array(compressed.buffer, compressed.byteOffset, compressed.byteLength);
}

/**
 * Decompresses Brotli binary buffer into parsed JSON object.
 */
export async function decompressBrotliToJson<T>(data: ArrayBuffer | Uint8Array): Promise<T> {
  const buf = Buffer.from(data as ArrayBuffer);
  const decompressed = await brotliDecompressAsync(buf);
  return JSON.parse(decompressed.toString("utf-8")) as T;
}

/**
 * Streams an R2 snapshot object directly to client with Brotli encoding (10-30ms, zero-decompression).
 * Falls back to decompression only if client does not support Brotli encoding.
 */
export async function serveShipGrowthSnapshot(
  c: Context,
  r2Obj: R2ObjectBody,
  cacheControl = "public, max-age=3600, stale-while-revalidate=86400",
): Promise<Response> {
  const acceptEncoding = c.req.header("accept-encoding") || "";
  const supportsBrotli = acceptEncoding.includes("br");

  const headers = new Headers();
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", cacheControl);
  headers.set("X-FUSOU-Cache", "SNAPSHOT-HIT");
  headers.set("X-FUSOU-Data-Source", "R2-SNAPSHOT");
  if (r2Obj.httpEtag) {
    headers.set("ETag", r2Obj.httpEtag);
  }

  if (supportsBrotli) {
    headers.set("Content-Encoding", "br");
    return new Response(r2Obj.body as unknown as ReadableStream, { status: 200, headers });
  }

  // Fallback for rare HTTP clients that don't declare accept-encoding: br
  const buf = await r2Obj.arrayBuffer();
  const decompressed = await brotliDecompressAsync(Buffer.from(buf));
  return new Response(decompressed.toString("utf-8"), { status: 200, headers });
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
  await bucket.put(key, compressed, {
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
      contentEncoding: "br",
    },
    customMetadata: {
      created_at: String(Date.now()),
      ...customMetadata,
    },
  });
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

/**
 * Builds bounds snapshot for a period from D1.
 */
export async function buildShipGrowthBoundsSnapshotFromD1(
  db: D1Database,
  periodTag: string,
  tableVersion: string,
): Promise<ShipGrowthBoundsPayload> {
  const countRes = await db
    .prepare("SELECT COUNT(*) as c FROM ship_growth_bounds WHERE period_tag = ? AND table_version = ?")
    .bind(periodTag, tableVersion)
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
          "WHERE period_tag = ? AND table_version = ? " +
          "ORDER BY master_id ASC, lv ASC LIMIT ? OFFSET ?"
        ).bind(periodTag, tableVersion, BOUNDS_PAGE, offset)
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
      "WHERE period_tag = ? AND table_version = ?",
    )
    .bind(periodTag, tableVersion)
    .all();
  const parsedCaps = ShipGrowthCapsUpdatedRowSchema.array().safeParse(
    capsResult.results ?? [],
  );
  if (!parsedCaps.success) {
    throw new Error("Invalid ship-growth caps rows");
  }
  const capsRows = parsedCaps.data;

  return {
    ok: true,
    period_tag: periodTag,
    table_version: tableVersion,
    schema_version: 3,
    bounds: boundsRows.map((r) => ({
      master_id: r.master_id,
      lv: r.lv,
      kaihi_naked: r.kaihi_naked,
      taisen_naked: r.taisen_naked,
      sakuteki_naked: r.sakuteki_naked,
      lucky_naked: r.lucky_naked,
    })),
    caps: capsRows.map((r) => ({
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
  const rowsResult = await db
    .prepare(
      "SELECT lv, exp_current, updated_at FROM ship_level_exp_pairs " +
      "WHERE period_tag = ? AND table_version = ? " +
      "ORDER BY lv ASC",
    )
    .bind(periodTag, tableVersion)
    .all();
  const parsedRows = ShipGrowthExpUpdatedRowSchema.array().safeParse(
    rowsResult.results ?? [],
  );
  if (!parsedRows.success) {
    throw new Error("Invalid ship-growth exp rows");
  }
  return {
    ok: true,
    period_tag: periodTag,
    table_version: tableVersion,
    rows: parsedRows.data.map((r) => ({
      lv: r.lv,
      exp_current: r.exp_current,
    })),
  };
}

/**
 * Rebuilds all snapshots from D1 and R2 archives.
 */
export async function rebuildAllShipGrowthSnapshots(
  env: Bindings,
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

  // 1. List all archive objects in R2
  const archiveObjects: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page += 1) {
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
    if (!cursor) break;
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
    if (!obj) continue;
    const text = await obj.text();
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    if (!parsed || !parsed.rows) continue;

    const archivedAt = Number(parsed.archived_at) || 0;
    if (archivedAt > lastArchivedAtSec) lastArchivedAtSec = archivedAt;

    const boundsList = Array.isArray(parsed.rows.bounds) ? parsed.rows.bounds : [];
    const capsList = Array.isArray(parsed.rows.caps) ? parsed.rows.caps : [];

    for (const raw of boundsList) {
      const p = ShipGrowthArchiveBoundsRowSchema.safeParse(raw);
      if (!p.success) continue;
      const r = p.data;
      const periodKey = `${r.period_tag}/${r.table_version}`;
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
        existing.kaihi_naked = Math.min(existing.kaihi_naked, Math.max(0, r.kaihi_naked));
        existing.taisen_naked = Math.min(existing.taisen_naked, Math.max(0, r.taisen_naked));
        existing.sakuteki_naked = Math.min(existing.sakuteki_naked, Math.max(0, r.sakuteki_naked));
        existing.lucky_naked = Math.min(existing.lucky_naked, Math.max(0, r.lucky_naked));
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
        cExisting.kaihi_naked = Math.min(cExisting.kaihi_naked, Math.max(0, r.kaihi_naked));
        cExisting.taisen_naked = Math.min(cExisting.taisen_naked, Math.max(0, r.taisen_naked));
        cExisting.sakuteki_naked = Math.min(cExisting.sakuteki_naked, Math.max(0, r.sakuteki_naked));
        cExisting.lucky_naked = Math.min(cExisting.lucky_naked, Math.max(0, r.lucky_naked));
      }
    }

    for (const raw of capsList) {
      const p = ShipGrowthArchiveCapsRowSchema.safeParse(raw);
      if (!p.success) continue;
      const r = p.data;
      const periodKey = `${r.period_tag}/${r.table_version}`;
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
    bounds: any[];
    caps: any[];
  }> = [];

  for (const [periodKey, data] of pastPeriodsMap.entries()) {
    const parts = periodKey.split("/");
    const periodTag = parts[0] || "";
    const tableVersion = parts[1] || "";
    if (!periodTag || !tableVersion) continue;
    const boundsArr = Array.from(data.bounds.values()).sort(
      (a, b) => a.master_id - b.master_id || a.lv - b.lv,
    );
    const capsArr = Array.from(data.caps.values()).sort(
      (a, b) => a.master_id - b.master_id,
    );

    const payload: ShipGrowthBoundsPayload = {
      ok: true,
      period_tag: periodTag,
      table_version: tableVersion,
      schema_version: 3,
      bounds: boundsArr,
      caps: capsArr,
    };
    const key = getShipGrowthBoundsSnapshotKey(periodTag, tableVersion);
    await putShipGrowthSnapshot(archiveBucket, key, payload);
    generated.push(key);

    allPeriodsEntries.push({
      period_tag: periodTag,
      table_version: tableVersion,
      bounds: boundsArr,
      caps: capsArr,
    });
  }

  // 4. Query D1 for latest periods if db is provided
  const periodTagSet = new Map<string, { period_tag: string; table_version: string }>();

  // Add past periods from archives
  for (const periodKey of pastPeriodsMap.keys()) {
    const parts = periodKey.split("/");
    const periodTag = parts[0] || "";
    const tableVersion = parts[1] || "";
    if (!periodTag || !tableVersion) continue;
    periodTagSet.set(`${periodTag}_${tableVersion}`, { period_tag: periodTag, table_version: tableVersion });
  }

  if (db) {
    try {
      const d1PeriodsRes = await db
        .prepare("SELECT DISTINCT period_tag, table_version FROM ship_growth_bounds ORDER BY period_tag DESC, table_version DESC LIMIT 20")
        .all();
      const parsedD1Periods = ShipGrowthPeriodRowSchema.array().safeParse(d1PeriodsRes.results ?? []);
      if (parsedD1Periods.success) {
        for (const p of parsedD1Periods.data) {
          periodTagSet.set(`${p.period_tag}_${p.table_version}`, p);

          // Build & save bounds snapshot from D1
          const boundsPayload = await buildShipGrowthBoundsSnapshotFromD1(db, p.period_tag, p.table_version);
          const boundsKey = getShipGrowthBoundsSnapshotKey(p.period_tag, p.table_version);
          await putShipGrowthSnapshot(archiveBucket, boundsKey, boundsPayload);
          generated.push(boundsKey);

          // Also include in cumulative
          for (const b of boundsPayload.bounds) {
            const bKey = `${b.master_id}:${b.lv}`;
            const cExisting = cumulativeBoundsMap.get(bKey);
            if (!cExisting) {
              cumulativeBoundsMap.set(bKey, { ...b });
            } else {
              cExisting.kaihi_naked = Math.min(cExisting.kaihi_naked, b.kaihi_naked);
              cExisting.taisen_naked = Math.min(cExisting.taisen_naked, b.taisen_naked);
              cExisting.sakuteki_naked = Math.min(cExisting.sakuteki_naked, b.sakuteki_naked);
              cExisting.lucky_naked = Math.min(cExisting.lucky_naked, b.lucky_naked);
            }
          }
          for (const cap of boundsPayload.caps) {
            const cCap = cumulativeCapsMap.get(cap.master_id);
            if (!cCap) {
              cumulativeCapsMap.set(cap.master_id, { ...cap });
            } else {
              cCap.kaihi_max = Math.max(cCap.kaihi_max, cap.kaihi_max);
              cCap.taisen_max = Math.max(cCap.taisen_max, cap.taisen_max);
              cCap.sakuteki_max = Math.max(cCap.sakuteki_max, cap.sakuteki_max);
            }
          }

          // Also include in allPeriodsEntries
          allPeriodsEntries.push({
            period_tag: p.period_tag,
            table_version: p.table_version,
            bounds: boundsPayload.bounds,
            caps: boundsPayload.caps,
          });

          // Build & save exp snapshot from D1
          const expPayload = await buildShipGrowthExpSnapshotFromD1(db, p.period_tag, p.table_version);
          const expKey = getShipGrowthExpSnapshotKey(p.period_tag, p.table_version);
          await putShipGrowthSnapshot(archiveBucket, expKey, expPayload);
          generated.push(expKey);
        }
      }
    } catch (d1Err) {
      console.warn("[ship-growth] Failed to query D1 periods during snapshot rebuild:", d1Err);
    }
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
  await putShipGrowthSnapshot(archiveBucket, SHIP_GROWTH_CUMULATIVE_SNAPSHOT_KEY, cumulativePayload);
  generated.push(SHIP_GROWTH_CUMULATIVE_SNAPSHOT_KEY);

  // 6. Save all_periods snapshot
  allPeriodsEntries.sort((a, b) => b.period_tag.localeCompare(a.period_tag) || b.table_version.localeCompare(a.table_version));
  const allPeriodsPayload = {
    ok: true,
    periods: allPeriodsEntries,
    archive_object_count: archiveObjects.length,
  };
  await putShipGrowthSnapshot(archiveBucket, SHIP_GROWTH_ALL_PERIODS_SNAPSHOT_KEY, allPeriodsPayload);
  generated.push(SHIP_GROWTH_ALL_PERIODS_SNAPSHOT_KEY);

  // 7. Save summary snapshot
  const sortedPeriods = Array.from(periodTagSet.values()).sort(
    (a, b) => b.period_tag.localeCompare(a.period_tag) || b.table_version.localeCompare(a.table_version),
  );
  const summaryPayload: ShipGrowthSummaryPayload = {
    ok: true,
    periods: sortedPeriods,
    cumulative_available: cumulativePayload.bounds.length > 0 || archiveObjects.length > 0,
    archive_object_count: archiveObjects.length,
  };
  await putShipGrowthSnapshot(archiveBucket, SHIP_GROWTH_SUMMARY_SNAPSHOT_KEY, summaryPayload);
  generated.push(SHIP_GROWTH_SUMMARY_SNAPSHOT_KEY);

  return {
    generated,
    periods: sortedPeriods,
    archive_object_count: archiveObjects.length,
  };
}
