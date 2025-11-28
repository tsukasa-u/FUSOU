export type AssetKeyCache = {
  keys: string[];
  refreshedAt: number;
  expiresAt: number;
  etag: string;
};

const CACHE_FILE_KEY = "_system/keys-cache.json";

// Minimal definition to avoid circular deps or complex imports
type R2BucketBinding = {
  get(key: string): Promise<any>; // Using any for R2Object to avoid full type def
  put(key: string, value: any, options?: any): Promise<any>;
};

export async function getAssetKeyCache(
  bucket: R2BucketBinding
): Promise<AssetKeyCache | null> {
  try {
    const obj = await bucket.get(CACHE_FILE_KEY);
    if (!obj) return null;
    return await obj.json();
  } catch (e) {
    console.warn("Failed to read asset key cache", e);
    return null;
  }
}

export async function setAssetKeyCache(
  bucket: R2BucketBinding,
  payload: AssetKeyCache
): Promise<void> {
  try {
    await bucket.put(CACHE_FILE_KEY, JSON.stringify(payload), {
      httpMetadata: { contentType: "application/json" },
    });
  } catch (e) {
    console.warn("Failed to write asset key cache", e);
  }
}

export async function addKeyToAssetKeyCache(
  bucket: R2BucketBinding,
  key: string
): Promise<void> {
  try {
    const cache = await getAssetKeyCache(bucket);
    if (cache) {
      if (!cache.keys.includes(key)) {
        cache.keys.push(key);
        // We don't update refreshedAt/expiresAt to avoid extending TTL indefinitely with just one key
        await setAssetKeyCache(bucket, cache);
      }
    }
  } catch (e) {
    console.warn("Failed to update asset key cache", e);
  }
}

export function invalidateAssetKeyCache(): void {
  // No-op for remote cache as we don't want to delete it (expensive to rebuild)
  // We rely on addKeyToAssetKeyCache or natural expiration.
}
