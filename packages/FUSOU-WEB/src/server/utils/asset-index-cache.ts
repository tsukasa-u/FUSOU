import { CACHE_TTL_SECONDS } from "../constants";
import type { D1Database } from "../types";

const ASSET_INDEX_SCHEMA_VERSION = 1;
const ASSET_INDEX_KEY_PREFIX = "asset-sync:index:v1";
const ASSET_INDEX_MANIFEST_KEY = `${ASSET_INDEX_KEY_PREFIX}:manifest`;
const ASSET_INDEX_REBUILD_LOCK_KEY = `${ASSET_INDEX_KEY_PREFIX}:rebuild-lock`;

const ASSET_INDEX_PAGE_SIZE = 2000;
const ASSET_INDEX_PAGE_MAX_BYTES = 20 * 1024 * 1024;
const ASSET_INDEX_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const ASSET_INDEX_MAX_STALE_MS = 24 * 60 * 60 * 1000;
const ASSET_INDEX_REBUILD_LOCK_TTL_SECONDS = 60;
const ASSET_INDEX_REBUILD_LOCK_WAIT_MS = 2000;
const ASSET_INDEX_REBUILD_LOCK_POLL_MS = 200;
const ASSET_INDEX_D1_BATCH_SIZE = 2000;

const JSON_ENCODER = new TextEncoder();

type NullableNumber = number | null;

type AssetIndexPageRange = {
  pageNo: number;
  maxUploadedAtMs: NullableNumber;
  minUploadedAtMs: NullableNumber;
};

type AssetIndexManifest = {
  schemaVersion: number;
  version: string;
  sourceRevision: number;
  refreshedAtMs: number;
  snapshotUpperMs: number;
  pageSize: number;
  pageMaxBytes: number;
  pageCount: number;
  total: number;
  maxUploadedAtMs: NullableNumber;
  minUploadedAtMs: NullableNumber;
  pageRanges: AssetIndexPageRange[];
  previousVersion: string | null;
  previousPageCount: number;
};

type AssetIndexPage = {
  version: string;
  pageNo: number;
  maxUploadedAtMs: NullableNumber;
  minUploadedAtMs: NullableNumber;
  items: AssetIndexItem[];
};

type D1AssetRow = {
  key?: unknown;
  content_hash?: unknown;
  size?: unknown;
  uploaded_at?: unknown;
};

type Cursor = {
  uploadedAt: number;
  key: string;
};

export type AssetIndexItem = {
  key: string;
  contentHash: string | null;
  size: number;
  uploadedAt: NullableNumber;
};

export type AssetSyncKeysResponse = {
  keys: string[];
  items: AssetIndexItem[];
  total: number;
  refreshedAt: string;
  cacheExpiresAt: string;
  cached: boolean;
  incremental: boolean;
  snapshotUpperAt: string;
  snapshotUpperMs: number;
  degraded?: boolean;
};

export async function bumpAssetIndexRevision(
  db: D1Database,
  updatedAtMs: number = Date.now(),
): Promise<number> {
  await ensureAssetIndexMetaInitialized(db, updatedAtMs);
  await db
    .prepare(
      "UPDATE asset_index_meta SET revision = revision + 1, updated_at = ? WHERE id = 1",
    )
    .bind(updatedAtMs)
    .run();
  return readAssetIndexRevision(db);
}

export async function getAssetSyncKeysResponse(opts: {
  db: D1Database;
  kv: KVNamespace;
  sinceMs: number | null;
}): Promise<AssetSyncKeysResponse> {
  const { db, kv, sinceMs } = opts;
  const manifest = await safeReadManifest(kv);
  const nowMs = Date.now();

  let revision: number;
  try {
    revision = await readAssetIndexRevision(db);
  } catch (err) {
    console.warn(
      "[asset-sync] failed to read asset_index_meta.revision; trying stale cache path",
      err,
    );

    if (manifest && isManifestWithinStaleWindow(manifest, nowMs)) {
      try {
        return await buildResponseFromManifest(kv, manifest, sinceMs, true);
      } catch (cacheErr) {
        console.warn(
          "[asset-sync] stale KV path failed after revision read error; falling back to D1",
          cacheErr,
        );
      }
    }

    return buildResponseFromD1(db, sinceMs);
  }

  if (manifest && isManifestUsable(manifest, revision, nowMs)) {
    try {
      return await buildResponseFromManifest(kv, manifest, sinceMs, false);
    } catch (err) {
      console.warn(
        "[asset-sync] KV manifest exists but page fetch failed; attempting rebuild",
        err,
      );
    }
  }

  try {
    const rebuilt = await rebuildAndServe({
      db,
      kv,
      sinceMs,
      revision,
      previousManifest: manifest,
    });
    if (rebuilt) {
      return rebuilt;
    }
  } catch (err) {
    console.warn("[asset-sync] rebuild path failed; falling back to D1", err);
  }

  return buildResponseFromD1(db, sinceMs);
}

async function rebuildAndServe(opts: {
  db: D1Database;
  kv: KVNamespace;
  sinceMs: number | null;
  revision: number;
  previousManifest: AssetIndexManifest | null;
}): Promise<AssetSyncKeysResponse | null> {
  const { db, kv, sinceMs, revision, previousManifest } = opts;

  const lockToken = await tryAcquireRebuildLock(kv);
  if (!lockToken) {
    return waitForFreshManifest(kv, revision, sinceMs);
  }

  try {
    const snapshotUpperMs = Date.now();
    const fullItems = await readItemsFromD1({
      db,
      sinceMs: null,
      snapshotUpperMs,
      batchSize: ASSET_INDEX_D1_BATCH_SIZE,
    });

    const refreshedAtMs = Date.now();
    const version = `${snapshotUpperMs}-${crypto.randomUUID()}`;
    const pages = buildPages(version, fullItems);
    const manifest = buildManifest({
      version,
      sourceRevision: revision,
      refreshedAtMs,
      snapshotUpperMs,
      pages,
      previousManifest,
    });

    await writePagesAndManifest(kv, pages, manifest);
    // Keep current and previous generation; delete one generation older keys.
    void cleanupRetiredVersion(kv, previousManifest).catch((err) => {
      console.warn("[asset-sync] old cache page cleanup failed", err);
    });

    const filteredItems = filterItemsBySince(fullItems, sinceMs);
    return buildKeysResponse(filteredItems, {
      cached: true,
      incremental: sinceMs !== null,
      refreshedAtMs,
      snapshotUpperMs,
    });
  } finally {
    await releaseRebuildLock(kv, lockToken);
  }
}

async function waitForFreshManifest(
  kv: KVNamespace,
  revision: number,
  sinceMs: number | null,
): Promise<AssetSyncKeysResponse | null> {
  const deadline = Date.now() + ASSET_INDEX_REBUILD_LOCK_WAIT_MS;

  while (Date.now() < deadline) {
    await delayMs(ASSET_INDEX_REBUILD_LOCK_POLL_MS);

    const manifest = await safeReadManifest(kv);
    if (!manifest) {
      continue;
    }

    if (!isManifestUsable(manifest, revision, Date.now())) {
      continue;
    }

    try {
      return await buildResponseFromManifest(kv, manifest, sinceMs, false);
    } catch {
      // Keep waiting until deadline.
    }
  }

  console.warn(
    "[asset-sync] rebuild lock contention timed out; switching to D1 fallback",
  );
  return null;
}

async function buildResponseFromD1(
  db: D1Database,
  sinceMs: number | null,
): Promise<AssetSyncKeysResponse> {
  const snapshotUpperMs = Date.now();
  const items = await readItemsFromD1({
    db,
    sinceMs,
    snapshotUpperMs,
    batchSize: ASSET_INDEX_D1_BATCH_SIZE,
  });

  return buildKeysResponse(items, {
    cached: false,
    incremental: sinceMs !== null,
    refreshedAtMs: Date.now(),
    snapshotUpperMs,
  });
}

async function buildResponseFromManifest(
  kv: KVNamespace,
  manifest: AssetIndexManifest,
  sinceMs: number | null,
  degraded: boolean,
): Promise<AssetSyncKeysResponse> {
  const pageNumbers = selectPageNumbers(manifest, sinceMs);
  const pages: AssetIndexPage[] = [];

  for (const pageNo of pageNumbers) {
    const page = await readPage(kv, manifest.version, pageNo);
    if (!page) {
      throw new Error(
        `missing cache page version=${manifest.version} page=${pageNo}`,
      );
    }
    pages.push(page);
  }

  const items = filterItemsBySince(
    pages.flatMap((page) => page.items),
    sinceMs,
  );

  return buildKeysResponse(items, {
    cached: true,
    incremental: sinceMs !== null,
    refreshedAtMs: manifest.refreshedAtMs,
    snapshotUpperMs: manifest.snapshotUpperMs,
    degraded,
  });
}

function buildKeysResponse(
  items: AssetIndexItem[],
  opts: {
    cached: boolean;
    incremental: boolean;
    refreshedAtMs: number;
    snapshotUpperMs: number;
    degraded?: boolean;
  },
): AssetSyncKeysResponse {
  const { cached, incremental, refreshedAtMs, snapshotUpperMs, degraded } =
    opts;

  const sortedItems = [...items].sort(compareItemsDesc);
  const keys = sortedItems.map((item) => item.key);
  const response: AssetSyncKeysResponse = {
    keys,
    items: sortedItems,
    total: sortedItems.length,
    refreshedAt: toIso(refreshedAtMs),
    cacheExpiresAt: toIso(refreshedAtMs + CACHE_TTL_SECONDS * 1000),
    cached,
    incremental,
    snapshotUpperAt: toIso(snapshotUpperMs),
    snapshotUpperMs,
  };

  if (degraded) {
    response.degraded = true;
  }

  return response;
}

function compareItemsDesc(a: AssetIndexItem, b: AssetIndexItem): number {
  const aTime = a.uploadedAt ?? -1;
  const bTime = b.uploadedAt ?? -1;
  if (aTime !== bTime) {
    return bTime - aTime;
  }
  if (a.key === b.key) {
    return 0;
  }
  return a.key > b.key ? -1 : 1;
}

function filterItemsBySince(
  items: AssetIndexItem[],
  sinceMs: number | null,
): AssetIndexItem[] {
  if (sinceMs === null) {
    return items;
  }
  return items.filter((item) => (item.uploadedAt ?? -1) > sinceMs);
}

function selectPageNumbers(
  manifest: AssetIndexManifest,
  sinceMs: number | null,
): number[] {
  if (manifest.pageCount <= 0) {
    return [];
  }

  if (sinceMs === null) {
    return Array.from({ length: manifest.pageCount }, (_, idx) => idx + 1);
  }

  if (manifest.pageRanges.length === manifest.pageCount) {
    const selected = manifest.pageRanges
      .filter(
        (range) =>
          range.maxUploadedAtMs === null || range.maxUploadedAtMs > sinceMs,
      )
      .map((range) => range.pageNo)
      .sort((a, b) => a - b);
    if (selected.length > 0) {
      return selected;
    }
    return [];
  }

  return Array.from({ length: manifest.pageCount }, (_, idx) => idx + 1);
}

function buildManifest(opts: {
  version: string;
  sourceRevision: number;
  refreshedAtMs: number;
  snapshotUpperMs: number;
  pages: AssetIndexPage[];
  previousManifest: AssetIndexManifest | null;
}): AssetIndexManifest {
  const {
    version,
    sourceRevision,
    refreshedAtMs,
    snapshotUpperMs,
    pages,
    previousManifest,
  } = opts;

  const total = pages.reduce((sum, page) => sum + page.items.length, 0);
  const maxUploadedAtMs = pages[0]?.maxUploadedAtMs ?? null;
  const minUploadedAtMs = pages[pages.length - 1]?.minUploadedAtMs ?? null;

  return {
    schemaVersion: ASSET_INDEX_SCHEMA_VERSION,
    version,
    sourceRevision,
    refreshedAtMs,
    snapshotUpperMs,
    pageSize: ASSET_INDEX_PAGE_SIZE,
    pageMaxBytes: ASSET_INDEX_PAGE_MAX_BYTES,
    pageCount: pages.length,
    total,
    maxUploadedAtMs,
    minUploadedAtMs,
    pageRanges: pages.map((page) => ({
      pageNo: page.pageNo,
      maxUploadedAtMs: page.maxUploadedAtMs,
      minUploadedAtMs: page.minUploadedAtMs,
    })),
    previousVersion: previousManifest?.version ?? null,
    previousPageCount: previousManifest?.pageCount ?? 0,
  };
}

function buildPages(
  version: string,
  items: AssetIndexItem[],
): AssetIndexPage[] {
  if (items.length === 0) {
    return [];
  }

  const pages: AssetIndexPage[] = [];
  let pageNo = 1;
  let current: AssetIndexItem[] = [];

  const flush = () => {
    if (current.length === 0) {
      return;
    }

    pages.push({
      version,
      pageNo,
      maxUploadedAtMs: current[0]?.uploadedAt ?? null,
      minUploadedAtMs: current[current.length - 1]?.uploadedAt ?? null,
      items: [...current],
    });

    current = [];
    pageNo += 1;
  };

  for (const item of items) {
    if (current.length === 0) {
      current.push(item);
      continue;
    }

    const candidate = [...current, item];
    const overCount = candidate.length > ASSET_INDEX_PAGE_SIZE;
    const overSize =
      estimatePageByteLength(version, pageNo, candidate) >
      ASSET_INDEX_PAGE_MAX_BYTES;

    if (overCount || overSize) {
      flush();
      current.push(item);

      const singleOver =
        estimatePageByteLength(version, pageNo, current) >
        ASSET_INDEX_PAGE_MAX_BYTES;
      if (singleOver) {
        flush();
      }
      continue;
    }

    current = candidate;
  }

  flush();
  return pages;
}

function estimatePageByteLength(
  version: string,
  pageNo: number,
  items: AssetIndexItem[],
): number {
  const maxUploadedAtMs = items[0]?.uploadedAt ?? null;
  const minUploadedAtMs = items[items.length - 1]?.uploadedAt ?? null;

  const page: AssetIndexPage = {
    version,
    pageNo,
    maxUploadedAtMs,
    minUploadedAtMs,
    items,
  };

  return JSON_ENCODER.encode(JSON.stringify(page)).length;
}

async function writePagesAndManifest(
  kv: KVNamespace,
  pages: AssetIndexPage[],
  manifest: AssetIndexManifest,
): Promise<void> {
  for (const page of pages) {
    await kv.put(pageKey(manifest.version, page.pageNo), JSON.stringify(page), {
      expirationTtl: ASSET_INDEX_CACHE_TTL_SECONDS,
    });
  }

  await kv.put(ASSET_INDEX_MANIFEST_KEY, JSON.stringify(manifest), {
    expirationTtl: ASSET_INDEX_CACHE_TTL_SECONDS,
  });
}

async function cleanupRetiredVersion(
  kv: KVNamespace,
  currentManifest: AssetIndexManifest | null,
): Promise<void> {
  if (
    !currentManifest?.previousVersion ||
    currentManifest.previousPageCount <= 0
  ) {
    return;
  }

  const deletes: Promise<void>[] = [];
  for (
    let pageNo = 1;
    pageNo <= currentManifest.previousPageCount;
    pageNo += 1
  ) {
    deletes.push(kv.delete(pageKey(currentManifest.previousVersion, pageNo)));
  }

  await Promise.allSettled(deletes);
}

function pageKey(version: string, pageNo: number): string {
  return `${ASSET_INDEX_KEY_PREFIX}:version:${version}:page:${pageNo}`;
}

async function readPage(
  kv: KVNamespace,
  version: string,
  pageNo: number,
): Promise<AssetIndexPage | null> {
  const raw = await kv.get(pageKey(version, pageNo), "json");
  if (!isObject(raw)) {
    return null;
  }

  const itemsRaw = Array.isArray(raw.items) ? raw.items : [];
  const items: AssetIndexItem[] = [];

  for (const item of itemsRaw) {
    if (!isObject(item)) {
      continue;
    }
    const key = typeof item.key === "string" ? item.key : null;
    if (!key) {
      continue;
    }
    items.push({
      key,
      contentHash:
        typeof item.contentHash === "string" ? item.contentHash : null,
      size: toNumber(item.size) ?? 0,
      uploadedAt: toNumber(item.uploadedAt),
    });
  }

  return {
    version,
    pageNo,
    maxUploadedAtMs: toNumber(raw.maxUploadedAtMs),
    minUploadedAtMs: toNumber(raw.minUploadedAtMs),
    items,
  };
}

function isManifestUsable(
  manifest: AssetIndexManifest,
  revision: number,
  nowMs: number,
): boolean {
  return (
    manifest.schemaVersion === ASSET_INDEX_SCHEMA_VERSION &&
    manifest.sourceRevision === revision &&
    isManifestWithinStaleWindow(manifest, nowMs)
  );
}

function isManifestWithinStaleWindow(
  manifest: AssetIndexManifest,
  nowMs: number,
): boolean {
  return nowMs - manifest.refreshedAtMs <= ASSET_INDEX_MAX_STALE_MS;
}

async function safeReadManifest(
  kv: KVNamespace,
): Promise<AssetIndexManifest | null> {
  try {
    return await readManifest(kv);
  } catch (err) {
    console.warn("[asset-sync] failed to parse cache manifest", err);
    return null;
  }
}

async function readManifest(
  kv: KVNamespace,
): Promise<AssetIndexManifest | null> {
  const raw = await kv.get(ASSET_INDEX_MANIFEST_KEY, "json");
  if (!isObject(raw)) {
    return null;
  }

  const schemaVersion = toNumber(raw.schemaVersion);
  const version = typeof raw.version === "string" ? raw.version : null;
  const sourceRevision = toNumber(raw.sourceRevision);
  const refreshedAtMs = toNumber(raw.refreshedAtMs);
  const snapshotUpperMs = toNumber(raw.snapshotUpperMs);
  const pageSize = toNumber(raw.pageSize);
  const pageMaxBytes = toNumber(raw.pageMaxBytes);
  const pageCount = toNumber(raw.pageCount);
  const total = toNumber(raw.total);

  if (
    schemaVersion === null ||
    version === null ||
    sourceRevision === null ||
    refreshedAtMs === null ||
    snapshotUpperMs === null ||
    pageSize === null ||
    pageMaxBytes === null ||
    pageCount === null ||
    total === null
  ) {
    return null;
  }

  const pageRanges = normalizePageRanges(raw.pageRanges, pageCount);

  return {
    schemaVersion,
    version,
    sourceRevision,
    refreshedAtMs,
    snapshotUpperMs,
    pageSize,
    pageMaxBytes,
    pageCount,
    total,
    maxUploadedAtMs: toNumber(raw.maxUploadedAtMs),
    minUploadedAtMs: toNumber(raw.minUploadedAtMs),
    pageRanges,
    previousVersion:
      typeof raw.previousVersion === "string" ? raw.previousVersion : null,
    previousPageCount: toNumber(raw.previousPageCount) ?? 0,
  };
}

function normalizePageRanges(
  value: unknown,
  pageCount: number,
): AssetIndexPageRange[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const ranges: AssetIndexPageRange[] = [];
  for (const entry of value) {
    if (!isObject(entry)) {
      continue;
    }

    const pageNo = toNumber(entry.pageNo);
    if (pageNo === null || pageNo < 1 || pageNo > pageCount) {
      continue;
    }

    ranges.push({
      pageNo,
      maxUploadedAtMs: toNumber(entry.maxUploadedAtMs),
      minUploadedAtMs: toNumber(entry.minUploadedAtMs),
    });
  }

  return ranges;
}

async function readItemsFromD1(opts: {
  db: D1Database;
  sinceMs: number | null;
  snapshotUpperMs: number;
  batchSize: number;
}): Promise<AssetIndexItem[]> {
  const { db, sinceMs, snapshotUpperMs, batchSize } = opts;

  const items: AssetIndexItem[] = [];
  let cursor: Cursor | null = null;

  while (true) {
    let sql =
      "SELECT key, content_hash, size, uploaded_at FROM files WHERE uploaded_at IS NOT NULL AND uploaded_at <= ?";
    const binds: Array<number | string> = [snapshotUpperMs];

    if (sinceMs !== null) {
      sql += " AND uploaded_at > ?";
      binds.push(sinceMs);
    }

    if (cursor) {
      sql += " AND (uploaded_at < ? OR (uploaded_at = ? AND key < ?))";
      binds.push(cursor.uploadedAt, cursor.uploadedAt, cursor.key);
    }

    sql += " ORDER BY uploaded_at DESC, key DESC LIMIT ?";
    binds.push(batchSize);

    const result = await db
      .prepare(sql)
      .bind(...binds)
      .all<D1AssetRow>();
    const batch = result.results || [];

    const parsedBatch: AssetIndexItem[] = [];
    for (const row of batch) {
      const key = typeof row.key === "string" ? row.key : null;
      const uploadedAt = toNumber(row.uploaded_at);
      if (!key || uploadedAt === null) {
        continue;
      }

      parsedBatch.push({
        key,
        contentHash:
          typeof row.content_hash === "string" ? row.content_hash : null,
        size: toNumber(row.size) ?? 0,
        uploadedAt,
      });
    }

    items.push(...parsedBatch);

    if (batch.length < batchSize || parsedBatch.length === 0) {
      break;
    }

    const last = parsedBatch[parsedBatch.length - 1];
    cursor = {
      uploadedAt: last.uploadedAt ?? 0,
      key: last.key,
    };
  }

  return items;
}

async function ensureAssetIndexMetaInitialized(
  db: D1Database,
  nowMs: number,
): Promise<void> {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS asset_index_meta (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)",
    )
    .run();

  await db
    .prepare(
      "INSERT INTO asset_index_meta (id, revision, updated_at) VALUES (1, 0, ?) ON CONFLICT(id) DO NOTHING",
    )
    .bind(nowMs)
    .run();
}

async function readAssetIndexRevision(db: D1Database): Promise<number> {
  const nowMs = Date.now();
  await ensureAssetIndexMetaInitialized(db, nowMs);

  const row = await db
    .prepare("SELECT revision FROM asset_index_meta WHERE id = 1 LIMIT 1")
    .first<{ revision?: unknown }>();

  const revision = toNumber(row?.revision);
  if (revision === null) {
    throw new Error("asset_index_meta.revision missing");
  }

  return revision;
}

async function tryAcquireRebuildLock(kv: KVNamespace): Promise<string | null> {
  const existing = await kv.get(ASSET_INDEX_REBUILD_LOCK_KEY);
  if (existing) {
    return null;
  }

  const token = crypto.randomUUID();
  await kv.put(ASSET_INDEX_REBUILD_LOCK_KEY, token, {
    expirationTtl: ASSET_INDEX_REBUILD_LOCK_TTL_SECONDS,
  });
  return token;
}

async function releaseRebuildLock(
  kv: KVNamespace,
  token: string,
): Promise<void> {
  try {
    const current = await kv.get(ASSET_INDEX_REBUILD_LOCK_KEY);
    if (current === token) {
      await kv.delete(ASSET_INDEX_REBUILD_LOCK_KEY);
    }
  } catch {
    // Lock release is best effort.
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return null;
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

async function delayMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
