// ── Viewer Workspace: in-page multi-fleet browsing state ──
// Persists to localStorage; maximum MAX_ENTRIES entries with LRU eviction.

export interface ViewerEntry {
  id: string;
  name: string;
  memo: string;
  /** Source type — used for deduplication and badge display. */
  sourceType: "shareKey" | "simulatorUrl";
  /** Stable identifier for this source (e.g. 16-char short key, fleet tag, or base URL). */
  sourceValue: string;
  payloadKind: "exportedFleet" | "fleetSnapshot";
  payload: unknown;
  updatedAt: number;
  pinned: boolean;
}

export interface ViewerWorkspace {
  activeId: string | null;
  entries: ViewerEntry[];
}

const STORAGE_KEY = "__fusouViewerWorkspace";
const MAX_ENTRIES = 20;

export function loadWorkspace(): ViewerWorkspace {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { activeId: null, entries: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { activeId: null, entries: [] };
    const ws = parsed as ViewerWorkspace;
    ws.entries = (ws.entries ?? []).map((entry) => ({
      ...entry,
      memo: typeof (entry as { memo?: unknown }).memo === "string"
        ? (entry as { memo?: string }).memo ?? ""
        : "",
    }));
    return ws;
  } catch {
    return { activeId: null, entries: [] };
  }
}

function saveWorkspace(ws: ViewerWorkspace): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ws));
  } catch {
    // Storage quota exceeded — silently ignore.
  }
}

let _ws: ViewerWorkspace = loadWorkspace();

export function getWorkspace(): ViewerWorkspace {
  return _ws;
}

function findBySource(
  sourceType: ViewerEntry["sourceType"],
  sourceValue: string,
): ViewerEntry | null {
  return (
    _ws.entries.find(
      (e) => e.sourceType === sourceType && e.sourceValue === sourceValue,
    ) ?? null
  );
}

/**
 * Add or refresh an entry.
 * If a duplicate source already exists, refresh its payload/name and move it to front.
 * Returns the resulting entry.
 */
export function addEntry(
  entry: Omit<ViewerEntry, "id" | "updatedAt"> & { id?: string },
): ViewerEntry {
  const existing = findBySource(entry.sourceType, entry.sourceValue);
  if (existing) {
    existing.payload = entry.payload;
    existing.updatedAt = Date.now();
    if (entry.name) existing.name = entry.name;
    existing.memo = entry.memo;
    _ws.entries = [existing, ..._ws.entries.filter((e) => e.id !== existing.id)];
    saveWorkspace(_ws);
    return existing;
  }

  const newEntry: ViewerEntry = {
    id: entry.id ?? crypto.randomUUID(),
    name: entry.name,
    memo: entry.memo,
    sourceType: entry.sourceType,
    sourceValue: entry.sourceValue,
    payloadKind: entry.payloadKind,
    payload: entry.payload,
    updatedAt: Date.now(),
    pinned: entry.pinned ?? false,
  };

  let entries = [newEntry, ..._ws.entries];

  // LRU eviction: drop the oldest non-pinned entries when over the limit.
  if (entries.length > MAX_ENTRIES) {
    const pinned = entries.filter((e) => e.pinned);
    const unpinned = entries.filter((e) => !e.pinned);
    while (pinned.length + unpinned.length > MAX_ENTRIES && unpinned.length > 0) {
      unpinned.pop();
    }
    entries = [...pinned, ...unpinned];
  }

  _ws.entries = entries;
  saveWorkspace(_ws);
  return newEntry;
}

export function upsertEntry(
  entry: Omit<ViewerEntry, "updatedAt">,
): ViewerEntry {
  const duplicate = _ws.entries.find(
    (current) => current.id !== entry.id
      && current.sourceType === entry.sourceType
      && current.sourceValue === entry.sourceValue,
  );

  if (duplicate) {
    duplicate.name = entry.name;
    duplicate.payloadKind = entry.payloadKind;
    duplicate.payload = entry.payload;
    duplicate.pinned = entry.pinned;
    duplicate.updatedAt = Date.now();
    _ws.entries = [
      duplicate,
      ..._ws.entries.filter((current) => current.id !== duplicate.id && current.id !== entry.id),
    ];
    if (_ws.activeId === entry.id || _ws.activeId === duplicate.id) {
      _ws.activeId = duplicate.id;
    }
    saveWorkspace(_ws);
    return duplicate;
  }

  const target = _ws.entries.find((current) => current.id === entry.id);
  if (target) {
    target.name = entry.name;
    target.sourceType = entry.sourceType;
    target.sourceValue = entry.sourceValue;
    target.payloadKind = entry.payloadKind;
    target.payload = entry.payload;
    target.pinned = entry.pinned;
    target.updatedAt = Date.now();
    _ws.entries = [target, ..._ws.entries.filter((current) => current.id !== target.id)];
    saveWorkspace(_ws);
    return target;
  }

  return addEntry(entry);
}

export function removeEntry(id: string): void {
  _ws.entries = _ws.entries.filter((e) => e.id !== id);
  if (_ws.activeId === id) {
    _ws.activeId = _ws.entries[0]?.id ?? null;
  }
  saveWorkspace(_ws);
}

export function setActive(id: string): void {
  if (_ws.entries.some((e) => e.id === id)) {
    _ws.activeId = id;
    saveWorkspace(_ws);
  }
}

export function getActive(): ViewerEntry | null {
  if (!_ws.activeId) return null;
  return _ws.entries.find((e) => e.id === _ws.activeId) ?? null;
}
