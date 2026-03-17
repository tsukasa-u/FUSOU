// ── Viewer Workspace: in-page multi-fleet browsing state ──
// Persists to localStorage; maximum MAX_ENTRIES entries with LRU eviction.

export interface ViewerEntry {
  id: string;
  name: string;
  /** Source type — used for deduplication and badge display. */
  sourceType: "shareKey" | "simulatorUrl" | "r2Tag" | "manual";
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
    return parsed as ViewerWorkspace;
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
    _ws.entries = [existing, ..._ws.entries.filter((e) => e.id !== existing.id)];
    saveWorkspace(_ws);
    return existing;
  }

  const newEntry: ViewerEntry = {
    id: entry.id ?? crypto.randomUUID(),
    name: entry.name,
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
