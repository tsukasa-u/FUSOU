import type { SupabaseClient } from '@supabase/supabase-js';

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
  const data = await res.json();
  return data as AssetIndexResponse;
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
  const data = (await res.json()) as { exists?: boolean; file?: { key: string } };
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
