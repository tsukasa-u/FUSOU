const DATABASE_NAME = "fusou-local-avro";
const DATABASE_VERSION = 1;
const STORE_NAME = "directory-handles";
const STORE_KEY = "selected";

export type StoredLocalDirectoryHandle = {
  handle: FileSystemDirectoryHandle;
  name: string;
  savedAt: number;
};

type StoredValue = StoredLocalDirectoryHandle & {
  key: string;
};

type IndexedDbFactory = Pick<IDBFactory, "open">;

function defaultIndexedDb(): IndexedDbFactory | null {
  if (typeof indexedDB === "undefined") return null;
  return indexedDB;
}

function isDirectoryHandle(value: unknown): value is FileSystemDirectoryHandle {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "directory"
  );
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
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
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
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

export function supportsLocalDirectoryHandlePersistence(
  factory: IndexedDbFactory | null = defaultIndexedDb(),
): boolean {
  return factory !== null;
}

export async function loadStoredLocalDirectoryHandle(
  factory: IndexedDbFactory | null = defaultIndexedDb(),
): Promise<StoredLocalDirectoryHandle | null> {
  if (!factory) return null;
  try {
    return await withDatabase(factory, async (database) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const value = await requestResult<StoredValue | undefined>(
        transaction.objectStore(STORE_NAME).get(STORE_KEY),
      );
      if (!value || !isDirectoryHandle(value.handle)) return null;
      return {
        handle: value.handle,
        name: value.name,
        savedAt: value.savedAt,
      };
    });
  } catch {
    return null;
  }
}

export async function saveLocalDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  factory: IndexedDbFactory | null = defaultIndexedDb(),
): Promise<boolean> {
  if (!factory || handle.kind !== "directory") return false;
  try {
    await withDatabase(factory, async (database) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({
        key: STORE_KEY,
        handle,
        name: handle.name,
        savedAt: Date.now(),
      } satisfies StoredValue);
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB write failed"));
        transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB write aborted"));
      });
    });
    return true;
  } catch {
    return false;
  }
}

export async function clearStoredLocalDirectoryHandle(
  factory: IndexedDbFactory | null = defaultIndexedDb(),
): Promise<boolean> {
  if (!factory) return false;
  try {
    await withDatabase(factory, async (database) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(STORE_KEY);
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB delete failed"));
        transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB delete aborted"));
      });
    });
    return true;
  } catch {
    return false;
  }
}