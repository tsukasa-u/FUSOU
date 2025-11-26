export type AssetKeyCache = {
  keys: string[];
  refreshedAt: number;
  expiresAt: number;
  etag: string;
};

let assetKeyCache: AssetKeyCache | null = null;

export function getAssetKeyCache(): AssetKeyCache | null {
  return assetKeyCache;
}

export function setAssetKeyCache(payload: AssetKeyCache): void {
  assetKeyCache = payload;
}

export function invalidateAssetKeyCache(): void {
  assetKeyCache = null;
}
