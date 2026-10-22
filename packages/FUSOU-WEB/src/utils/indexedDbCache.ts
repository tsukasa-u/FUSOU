/**
 * IndexedDB persistent cache for browser clients.
 * Safely falls back to no-op in SSR, Node, and Worker environments.
 */

export interface IdbCacheRecord {
  key: string;
  body: string;
  status: number;
  headers: [string, string][];
  storedAt: number;
  sizeBytes: number;
}

const DB_NAME = "fusou-client-cache";
const STORE_NAME = "cached-responses";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function getDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.resolve(null);
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = window.indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: "key" });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
          console.warn("[indexedDbCache] Failed to open IndexedDB", req.error);
          resolve(null);
        };
      } catch (err) {
        console.warn("[indexedDbCache] Exception opening IndexedDB", err);
        resolve(null);
      }
    });
  }
  return dbPromise;
}

export async function getIdbCache(key: string): Promise<IdbCacheRecord | null> {
  const db = await getDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        const record = req.result as IdbCacheRecord | undefined;
        resolve(record || null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function setIdbCache(record: IdbCacheRecord): Promise<void> {
  const db = await getDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function deleteIdbCache(key: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function clearIdbCache(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}