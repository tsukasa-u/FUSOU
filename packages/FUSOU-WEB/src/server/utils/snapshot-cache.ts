export type SnapshotCacheStatus =
  | "HIT"
  | "REFRESHED"
  | "REVALIDATED"
  | "MISS"
  | "RESET";

export interface CanonicalSnapshotBase {
  refreshed_at: number;
  db_synced_at: number;
}

type RefreshResult<T extends CanonicalSnapshotBase> = {
  snapshot: T;
  changed: boolean;
};

type SingleFlightResult<T extends CanonicalSnapshotBase> = {
  snapshot: T;
  cacheStatus: SnapshotCacheStatus;
};

const inflightSnapshotRefreshes = new Map<
  string,
  Promise<SingleFlightResult<CanonicalSnapshotBase>>
>();

export function isFreshSnapshot(refreshedAt: number, ttlMs: number): boolean {
  return Date.now() - refreshedAt < ttlMs;
}

export async function saveCanonicalSnapshotToKv<T extends CanonicalSnapshotBase>(
  kv: KVNamespace | undefined,
  key: string,
  value: T,
  expirationTtlSeconds: number,
): Promise<void> {
  if (!kv) return;
  await kv.put(key, JSON.stringify(value), {
    expirationTtl: expirationTtlSeconds,
  });
}

export async function invalidateCanonicalSnapshots(
  kv: KVNamespace | undefined,
  keys: string[],
): Promise<void> {
  if (!kv || keys.length === 0) return;
  await Promise.all(keys.map((key) => kv.delete(key)));
}

function runSingleFlightSnapshotRefresh<T extends CanonicalSnapshotBase>(
  cacheKey: string,
  loader: () => Promise<SingleFlightResult<T>>,
): Promise<SingleFlightResult<T>> {
  const existing = inflightSnapshotRefreshes.get(cacheKey) as
    | Promise<SingleFlightResult<T>>
    | undefined;
  if (existing) return existing;

  const promise = loader().finally(() => {
    inflightSnapshotRefreshes.delete(cacheKey);
  }) as Promise<SingleFlightResult<T>>;

  inflightSnapshotRefreshes.set(
    cacheKey,
    promise as Promise<SingleFlightResult<CanonicalSnapshotBase>>,
  );
  return promise;
}

export async function loadOrRefreshCanonicalSnapshot<
  T extends CanonicalSnapshotBase,
>(opts: {
  kv: KVNamespace | undefined;
  cacheKey: string;
  ttlMs: number;
  expirationTtlSeconds: number;
  probeWhenFresh?: boolean;
  isValidSnapshot: (value: unknown) => value is T;
  refreshFromDelta: (cached: T) => Promise<RefreshResult<T>>;
  loadFull: () => Promise<T>;
}): Promise<SingleFlightResult<T>> {
  const {
    kv,
    cacheKey,
    ttlMs,
    expirationTtlSeconds,
    probeWhenFresh = false,
    isValidSnapshot,
    refreshFromDelta,
    loadFull,
  } = opts;

  const cachedRaw = kv ? await kv.get(cacheKey, "json") : null;
  const cached = isValidSnapshot(cachedRaw) ? cachedRaw : null;

  if (cached && isFreshSnapshot(cached.refreshed_at, ttlMs) && !probeWhenFresh) {
    return { snapshot: cached, cacheStatus: "HIT" };
  }

  return runSingleFlightSnapshotRefresh(cacheKey, async () => {
    if (cached) {
      const refreshed = await refreshFromDelta(cached);
      await saveCanonicalSnapshotToKv(
        kv,
        cacheKey,
        refreshed.snapshot,
        expirationTtlSeconds,
      );
      return {
        snapshot: refreshed.snapshot,
        cacheStatus: refreshed.changed ? "REFRESHED" : "REVALIDATED",
      };
    }

    const full = await loadFull();
    await saveCanonicalSnapshotToKv(kv, cacheKey, full, expirationTtlSeconds);
    return { snapshot: full, cacheStatus: cachedRaw ? "RESET" : "MISS" };
  });
}
