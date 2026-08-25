export interface AssetIndexItem {
  key: string;
  contentHash: string | null;
  size: number;
  uploadedAt: number | null;
}

export interface AssetIndexResponse {
  keys: string[];
  items: AssetIndexItem[];
  total: number;
  refreshedAt: string;
  cacheExpiresAt: string;
  cached: boolean;
  incremental: boolean;  // true if this is a partial sync (since was provided)
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseAssetIndexResponse(value: unknown): AssetIndexResponse | null {
  if (!isJsonRecord(value)) return null;
  const keys = value["keys"];
  const rawItems = value["items"];
  if (
    !Array.isArray(keys) ||
    !keys.every((key): key is string => typeof key === "string") ||
    !Array.isArray(rawItems) ||
    typeof value["total"] !== "number" ||
    !Number.isFinite(value["total"]) ||
    typeof value["refreshedAt"] !== "string" ||
    typeof value["cacheExpiresAt"] !== "string" ||
    typeof value["cached"] !== "boolean" ||
    typeof value["incremental"] !== "boolean"
  ) {
    return null;
  }

  const items: AssetIndexItem[] = [];
  for (const rawItem of rawItems) {
    if (!isJsonRecord(rawItem)) return null;
    const { key, contentHash, size, uploadedAt } = rawItem;
    if (
      typeof key !== "string" ||
      (contentHash !== null && typeof contentHash !== "string") ||
      typeof size !== "number" ||
      !Number.isFinite(size) ||
      (uploadedAt !== null &&
        (typeof uploadedAt !== "number" || !Number.isFinite(uploadedAt)))
    ) {
      return null;
    }
    items.push({ key, contentHash, size, uploadedAt });
  }

  return {
    keys,
    items,
    total: value["total"],
    refreshedAt: value["refreshedAt"],
    cacheExpiresAt: value["cacheExpiresAt"],
    cached: value["cached"],
    incremental: value["incremental"],
  };
}

function parseHashCheckResponse(
  value: unknown,
): { exists: boolean; file?: { key: string } } | null {
  if (!isJsonRecord(value) || typeof value["exists"] !== "boolean") {
    return null;
  }
  const file = value["file"];
  if (file === undefined) return { exists: value["exists"] };
  if (!isJsonRecord(file) || typeof file["key"] !== "string") return null;
  return { exists: value["exists"], file: { key: file["key"] } };
}

/**
 * Fetch asset keys with metadata (including contentHash) from /asset-sync/keys.
 * Requires Authorization bearer token (Supabase access token).
 * 
 * @param baseUrl - Base URL for the API
 * @param accessToken - Supabase access token
 * @param since - Optional timestamp (ms since epoch) to fetch only files updated since then
 * @returns Asset index response with keys, items, and metadata
 */
export async function fetchAssetIndex(
  baseUrl: string,
  accessToken: string,
  since?: number
): Promise<AssetIndexResponse> {
  const url = new URL('/asset-sync/keys', baseUrl);
  if (since && since > 0) {
    url.searchParams.set('since', String(since));
  }
  
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch asset keys: ${res.status}`);
  }
  const data = parseAssetIndexResponse(await res.json());
  if (!data) {
    throw new Error("Invalid asset index response");
  }
  return data;
}

/**
 * Determine whether upload is needed by comparing content hash against D1 index.
 * If the hash exists, returns { shouldUpload: false }.
 */
export async function shouldUploadByHash(baseUrl: string, accessToken: string, contentHash: string) {
  const url = new URL('/asset-sync/check-hash', baseUrl);
  url.searchParams.set('hash', contentHash);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to check hash: ${res.status}`);
  }
  const data = parseHashCheckResponse(await res.json());
  if (!data) {
    throw new Error("Invalid asset hash response");
  }
  return {
    shouldUpload: !data.exists,
    existing: data.file,
  };
}

/**
 * Convenience helper: compute SHA-256 for ArrayBuffer and return hex string.
 */
export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(hash);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
