// ── Viewer Workspace: in-page multi-fleet browsing state ──
// Persists to localStorage; maximum MAX_ENTRIES entries with LRU eviction.

export interface ViewerEntry {
  id: string;
  name: string;
  memo: string;
  /** Source type — used for deduplication and badge display. */
  sourceType: "shareKey" | "simulatorUrl" | "ownDeck";
  /** Stable identifier for this source (e.g. short key, simulator URL, or own deck tag). */
  sourceValue: string;
  payloadKind: "exportedFleet" | "fleetSnapshot";
  payload: unknown;
  updatedAt: number;
  pinned: boolean;
  /** When true, addEntry dedup will not overwrite payload/name (e.g. R2 re-read won't clobber). */
  locked?: boolean;
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
      sourceType: (entry as { sourceType?: unknown }).sourceType === "snapshotTag"
        ? "ownDeck"
        : ((entry as { sourceType?: ViewerEntry["sourceType"] }).sourceType ?? "simulatorUrl"),
      memo: typeof (entry as { memo?: unknown }).memo === "string"
        ? (entry as { memo?: string }).memo ?? ""
        : "",
      locked: typeof (entry as { locked?: unknown }).locked === "boolean"
        ? (entry as { locked?: boolean }).locked ?? false
        : false,
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
    if (!existing.locked) {
      existing.payload = entry.payload;
      existing.payloadKind = entry.payloadKind;
      if (entry.name) existing.name = entry.name;
    }
    if (entry.memo || !existing.memo) {
      existing.memo = entry.memo;
    }
    existing.updatedAt = Date.now();
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
    locked: entry.locked ?? false,
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
    // Hard cap: if all entries are pinned and still over limit, drop oldest pinned.
    if (entries.length > MAX_ENTRIES) {
      entries = entries.slice(0, MAX_ENTRIES);
    }
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
    duplicate.memo = entry.memo;
    duplicate.payloadKind = entry.payloadKind;
    duplicate.payload = entry.payload;
    duplicate.pinned = entry.pinned;
    duplicate.locked = entry.locked ?? false;
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
    target.memo = entry.memo;
    target.sourceType = entry.sourceType;
    target.sourceValue = entry.sourceValue;
    target.payloadKind = entry.payloadKind;
    target.payload = entry.payload;
    target.pinned = entry.pinned;
    target.locked = entry.locked ?? false;
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

export function clearActive(): void {
  if (_ws.activeId !== null) {
    _ws.activeId = null;
    saveWorkspace(_ws);
  }
}

export function toggleLock(id: string): void {
  const entry = _ws.entries.find((e) => e.id === id);
  if (entry) {
    entry.locked = !entry.locked;
    saveWorkspace(_ws);
  }
}

export function updateEntryData(
  id: string,
  data: Pick<ViewerEntry, "payloadKind" | "payload">,
): ViewerEntry | null {
  const entry = _ws.entries.find((e) => e.id === id);
  if (!entry) return null;
  entry.payloadKind = data.payloadKind;
  entry.payload = data.payload;
  entry.updatedAt = Date.now();
  saveWorkspace(_ws);
  return entry;
}

export function duplicateEntry(id: string): ViewerEntry | null {
  const src = _ws.entries.find((e) => e.id === id);
  if (!src) return null;

  const duplicated: ViewerEntry = {
    ...src,
    id: crypto.randomUUID(),
    name: `${src.name} コピー`,
    sourceType: "ownDeck",
    sourceValue: `duplicate:${crypto.randomUUID()}`,
    updatedAt: Date.now(),
    locked: false,
  };

  _ws.entries = [duplicated, ..._ws.entries];
  if (_ws.entries.length > MAX_ENTRIES) {
    _ws.entries = _ws.entries.slice(0, MAX_ENTRIES);
  }
  saveWorkspace(_ws);
  return duplicated;
}

export function getActive(): ViewerEntry | null {
  if (!_ws.activeId) return null;
  return _ws.entries.find((e) => e.id === _ws.activeId) ?? null;
}
