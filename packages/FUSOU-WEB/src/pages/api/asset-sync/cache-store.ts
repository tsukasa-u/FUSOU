type AssetKeyCache = {
  keys: string[];
  refreshedAt: number;
  expiresAt: number;
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
