const DATABASE_NAME = "fusou-simulator-master-data";
const DATABASE_VERSION = 1;
const STORE_NAME = "master-cache";

export interface MasterCacheEntry<T = unknown> {
  key: string;
  data: T;
  etag?: string | null;
  periodTag?: string | null;
  periodRevision?: number | null;
  tableVersion?: string | null;
  savedAt: number;
}

export type IndexedDbFactory = Pick<IDBFactory, "open">;

export function defaultIndexedDb(): IndexedDbFactory | null {
  if (typeof indexedDB === "undefined") return null;
  return indexedDB;
}

export function supportsMasterDataCache(
  factory: IndexedDbFactory | null = defaultIndexedDb(),
): boolean {
  return factory !== null;
}

function openDatabase(factory: IndexedDbFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

async function withDatabase<T>(
  factory: IndexedDbFactory,
  action: (database: IDBDatabase) => Promise<T>,
): Promise<T> {
  const database = await openDatabase(factory);
  try {
    return await action(database);
  } finally {
    database.close();
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

/**
 * 単一キーのキャッシュエントリを取得します。
 */
export async function loadMasterDataCache<T>(
  key: string,
  factory: IndexedDbFactory | null = defaultIndexedDb(),
): Promise<MasterCacheEntry<T> | null> {
  if (!factory) return null;
  try {
    return await withDatabase(factory, async (database) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const entry = await requestResult<MasterCacheEntry<T> | undefined>(
        transaction.objectStore(STORE_NAME).get(key),
      );
      return entry ?? null;
    });
  } catch (error) {
    console.warn(`[master-data-cache] failed to load cache for ${key}:`, error);
    return null;
  }
}

/**
 * 全キャッシュエントリを1回のトランザクションで一括取得します。
 */
export async function loadAllCachedMasterData(
  factory: IndexedDbFactory | null = defaultIndexedDb(),
): Promise<Map<string, MasterCacheEntry>> {
  const map = new Map<string, MasterCacheEntry>();
  if (!factory) return map;
  try {
    return await withDatabase(factory, async (database) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const entries = await requestResult<MasterCacheEntry[]>(
        transaction.objectStore(STORE_NAME).getAll(),
      );
      for (const entry of entries) {
        if (entry && typeof entry.key === "string") {
          map.set(entry.key, entry);
        }
      }
      return map;
    });
  } catch (error) {
    console.warn("[master-data-cache] failed to load all cached data:", error);
    return map;
  }
}

/**
 * 単一キーのキャッシュエントリを保存します。
 */
export async function saveMasterDataCache<T>(
  key: string,
  data: T,
  meta?: {
    etag?: string | null;
    periodTag?: string | null;
    periodRevision?: number | null;
    tableVersion?: string | null;
  },
  factory: IndexedDbFactory | null = defaultIndexedDb(),
): Promise<boolean> {
  if (!factory) return false;
  try {
    await withDatabase(factory, async (database) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({
        key,
        data,
        etag: meta?.etag ?? null,
        periodTag: meta?.periodTag ?? null,
        periodRevision: meta?.periodRevision ?? null,
        tableVersion: meta?.tableVersion ?? null,
        savedAt: Date.now(),
      } satisfies MasterCacheEntry<T>);
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () =>
          reject(transaction.error ?? new Error("IndexedDB write failed"));
        transaction.onabort = () =>
          reject(transaction.error ?? new Error("IndexedDB write aborted"));
      });
    });
    return true;
  } catch (error) {
    console.warn(`[master-data-cache] failed to save cache for ${key}:`, error);
    return false;
  }
}

/**
 * キャッシュを全削除します（ログアウトや手動リフレッシュ用）。
 */
export async function clearMasterDataCache(
  factory: IndexedDbFactory | null = defaultIndexedDb(),
): Promise<boolean> {
  if (!factory) return false;
  try {
    await withDatabase(factory, async (database) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).clear();
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () =>
          reject(transaction.error ?? new Error("IndexedDB clear failed"));
        transaction.onabort = () =>
          reject(transaction.error ?? new Error("IndexedDB clear aborted"));
      });
    });
    return true;
  } catch (error) {
    console.warn("[master-data-cache] failed to clear cache:", error);
    return false;
  }
}
