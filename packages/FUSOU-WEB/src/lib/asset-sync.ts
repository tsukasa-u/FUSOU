import { URL } from "node:url";

/**
 * Fetch asset keys with metadata (including contentHash) from /asset-sync/keys.
 * Requires Authorization bearer token (Supabase access token).
 */
export async function fetchAssetIndex(baseUrl: string, accessToken: string) {
  const res = await fetch(new URL('/asset-sync/keys', baseUrl).toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch asset keys: ${res.status}`);
  }
  const data = await res.json();
  return data as {
    keys: string[];
    items: { key: string; contentHash: string | null; size: number; uploadedAt: number | null }[];
    total: number;
  };
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
