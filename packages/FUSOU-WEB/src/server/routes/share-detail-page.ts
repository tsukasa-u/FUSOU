import {
  buildShareBadRequestResponse,
  buildSharePageResponse,
} from "@/server/routes/share-page-common";

const KEY_RE = /^(ship|equip):(\d{1,7})$/;
const LOOKUP_CACHE_MAX_ENTRIES = 8;
const LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000;

type Selection = { kind: "ship" | "equip"; id: number };

type PreviewNameManifest = {
  ships: Record<string, string>;
  items: Record<string, string>;
};

type PreviewNameCacheEntry = {
  name: string | null;
  expiresAt: number;
};

type PreviewManifestCacheEntry = {
  data: PreviewNameManifest;
  expiresAt: number;
};

function jsonRecordOf(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringRecordOf(value: unknown): Record<string, string> {
  const record = jsonRecordOf(value);
  if (!record) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "string") result[key] = item;
  }
  return result;
}

const previewNameCacheByKey = new Map<string, PreviewNameCacheEntry>();
const previewManifestCacheByOrigin = new Map<
  string,
  PreviewManifestCacheEntry
>();

function setPreviewNameCache(cacheKey: string, name: string | null): void {
  previewNameCacheByKey.set(cacheKey, {
    name,
    expiresAt: Date.now() + LOOKUP_CACHE_TTL_MS,
  });
  if (previewNameCacheByKey.size <= LOOKUP_CACHE_MAX_ENTRIES) return;

  const oldestKey = previewNameCacheByKey.keys().next().value;
  if (typeof oldestKey === "string") {
    previewNameCacheByKey.delete(oldestKey);
  }
}

function setPreviewManifestCache(
  origin: string,
  data: PreviewNameManifest,
): void {
  previewManifestCacheByOrigin.set(origin, {
    data,
    expiresAt: Date.now() + LOOKUP_CACHE_TTL_MS,
  });
  if (previewManifestCacheByOrigin.size <= LOOKUP_CACHE_MAX_ENTRIES) return;

  const oldestKey = previewManifestCacheByOrigin.keys().next().value;
  if (typeof oldestKey === "string") {
    previewManifestCacheByOrigin.delete(oldestKey);
  }
}

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

function parseKey(key: string | null): Selection | null {
  if (!key) return null;
  const match = KEY_RE.exec(key.trim());
  if (!match) return null;
  return {
    kind: match[1] as "ship" | "equip",
    id: Number(match[2]),
  };
}

function resolveSelectionFromQuery(url: URL): Selection | null {
  const byKey = parseKey(url.searchParams.get("key"));
  if (byKey) return byKey;

  const shipId = parsePositiveInt(url.searchParams.get("ship"));
  if (shipId != null) return { kind: "ship", id: shipId };

  const equipId = parsePositiveInt(url.searchParams.get("equip"));
  if (equipId != null) return { kind: "equip", id: equipId };

  return null;
}

function buildTargetUrl(requestUrl: URL, selection: Selection): string {
  const target = new URL("/simulator", requestUrl.origin);
  if (selection.kind === "ship") {
    target.searchParams.set("tab", "ship");
    target.searchParams.set("ship", String(selection.id));
  } else {
    target.searchParams.set("tab", "equip");
    target.searchParams.set("equip", String(selection.id));
  }
  return target.toString();
}

async function getMasterNames(
  requestUrl: URL,
  tableName: "mst_ship" | "mst_slotitem",
  recordId: number,
): Promise<string | null> {
  const cacheKey = `${requestUrl.origin}:${tableName}:${recordId}`;
  const cached = previewNameCacheByKey.get(cacheKey);
  if (cached) {
    if (cached.expiresAt > Date.now()) {
      return cached.name;
    }
    previewNameCacheByKey.delete(cacheKey);
  }

  try {
    const dataUrl = new URL("/api/master-data/json", requestUrl.origin);
    dataUrl.searchParams.set("table_name", tableName);
    dataUrl.searchParams.set("record_id", String(recordId));
    const res = await fetch(dataUrl.toString());
    if (!res.ok) return null;

    const rawJson = await res.json();
    if (!jsonRecordOf(rawJson)) {
      return null;
    }
    const records = rawJson["records"];
    if (!Array.isArray(records)) return null;
    const rawRow = records[0];
    let row: Record<string, unknown> | null = null;
    if (jsonRecordOf(rawRow)) row = rawRow;
    const name =
      typeof row?.["name"] === "string"
        ? row["name"]
        : typeof row?.["api_name"] === "string"
          ? row["api_name"]
          : null;

    setPreviewNameCache(cacheKey, name);
    return name;
  } catch {
    return null;
  }
}

async function getPreviewNameManifest(
  requestUrl: URL,
): Promise<PreviewNameManifest> {
  const origin = requestUrl.origin;
  const cached = previewManifestCacheByOrigin.get(origin);
  if (cached) {
    if (cached.expiresAt > Date.now()) {
      return cached.data;
    }
    previewManifestCacheByOrigin.delete(origin);
  }

  try {
    const manifestUrl = new URL("/data/preview_name_manifest.json", origin);
    const res = await fetch(manifestUrl.toString());
    if (!res.ok) {
      return { ships: {}, items: {} };
    }

    const rawJson = await res.json();
    const json = jsonRecordOf(rawJson) ? rawJson : null;
    const manifest = {
      ships: stringRecordOf(json?.["ships"]),
      items: stringRecordOf(json?.["items"]),
    };
    if (
      Object.keys(manifest.ships).length > 0 ||
      Object.keys(manifest.items).length > 0
    ) {
      setPreviewManifestCache(origin, manifest);
    }
    return manifest;
  } catch {
    return { ships: {}, items: {} };
  }
}

async function resolvePreviewName(
  requestUrl: URL,
  selection: Selection,
): Promise<string | null> {
  const manifest = await getPreviewNameManifest(requestUrl);
  const manifestName =
    selection.kind === "ship"
      ? (manifest.ships[String(selection.id)] ?? null)
      : (manifest.items[String(selection.id)] ?? null);
  if (manifestName) {
    return manifestName;
  }

  return getMasterNames(
    requestUrl,
    selection.kind === "ship" ? "mst_ship" : "mst_slotitem",
    selection.id,
  );
}

function buildPreviewMeta(
  selection: Selection,
  name: string | null,
): { title: string; description: string } {
  if (selection.kind === "ship") {
    return {
      title: name
        ? `FUSOU 艦詳細: ${name}`
        : `FUSOU 艦詳細: ID ${selection.id}`,
      description: name
        ? `${name} (艦ID ${selection.id}) の詳細ページ共有リンク`
        : `艦 ID ${selection.id} の詳細ページ共有リンク`,
    };
  }

  return {
    title: name
      ? `FUSOU 装備詳細: ${name}`
      : `FUSOU 装備詳細: ID ${selection.id}`,
    description: name
      ? `${name} (装備ID ${selection.id}) の詳細ページ共有リンク`
      : `装備 ID ${selection.id} の詳細ページ共有リンク`,
  };
}

export async function handleShareDetailRequest(
  request: Request,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const selection = resolveSelectionFromQuery(requestUrl);
  if (!selection) {
    return buildShareBadRequestResponse("invalid key");
  }

  const targetUrl = buildTargetUrl(requestUrl, selection);
  const name = await resolvePreviewName(requestUrl, selection);
  const meta = buildPreviewMeta(selection, name);
  return buildSharePageResponse(request, targetUrl, {
    title: meta.title,
    description: meta.description,
    cacheControl: "public, max-age=60, s-maxage=300",
  });
}
