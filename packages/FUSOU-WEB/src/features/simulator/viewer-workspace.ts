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

import { atom } from "nanostores";

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

export const workspaceStore = atom<ViewerWorkspace>(loadWorkspace());

export function getWorkspace(): ViewerWorkspace {
  return workspaceStore.get();
}

function findBySource(
  sourceType: ViewerEntry["sourceType"],
  sourceValue: string,
): ViewerEntry | null {
  const ws = workspaceStore.get();
  return (
    ws.entries.find(
      (e) => e.sourceType === sourceType && e.sourceValue === sourceValue,
    ) ?? null
  );
}

export function addEntry(
  entry: Omit<ViewerEntry, "id" | "updatedAt"> & { id?: string },
): ViewerEntry {
  const existing = findBySource(entry.sourceType, entry.sourceValue);
  const ws = workspaceStore.get();
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
    const newWs = { ...ws, entries: [existing, ...ws.entries.filter((e) => e.id !== existing.id)] };
    workspaceStore.set(newWs);
    saveWorkspace(newWs);
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

  let entries = [newEntry, ...ws.entries];

  if (entries.length > MAX_ENTRIES) {
    const pinned = entries.filter((e) => e.pinned);
    const unpinned = entries.filter((e) => !e.pinned);
    while (pinned.length + unpinned.length > MAX_ENTRIES && unpinned.length > 0) {
      unpinned.pop();
    }
    entries = [...pinned, ...unpinned];
    if (entries.length > MAX_ENTRIES) {
      entries = entries.slice(0, MAX_ENTRIES);
    }
  }

  const newWs = { ...ws, entries };
  workspaceStore.set(newWs);
  saveWorkspace(newWs);
  return newEntry;
}

export function upsertEntry(
  entry: Omit<ViewerEntry, "updatedAt">,
): ViewerEntry {
  const ws = workspaceStore.get();
  const duplicate = ws.entries.find(
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
    let newActiveId = ws.activeId;
    if (newActiveId === entry.id || newActiveId === duplicate.id) {
      newActiveId = duplicate.id;
    }
    const newWs = {
      activeId: newActiveId,
      entries: [
        duplicate,
        ...ws.entries.filter((current) => current.id !== duplicate.id && current.id !== entry.id),
      ]
    };
    workspaceStore.set(newWs);
    saveWorkspace(newWs);
    return duplicate;
  }

  const target = ws.entries.find((current) => current.id === entry.id);
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
    const newWs = { ...ws, entries: [target, ...ws.entries.filter((current) => current.id !== target.id)] };
    workspaceStore.set(newWs);
    saveWorkspace(newWs);
    return target;
  }

  return addEntry(entry);
}

export function removeEntry(id: string): void {
  const ws = workspaceStore.get();
  let newActiveId = ws.activeId;
  const newEntries = ws.entries.filter((e) => e.id !== id);
  if (newActiveId === id) {
    newActiveId = newEntries[0]?.id ?? null;
  }
  const newWs = { activeId: newActiveId, entries: newEntries };
  workspaceStore.set(newWs);
  saveWorkspace(newWs);
}

export function setActive(id: string): void {
  const ws = workspaceStore.get();
  if (ws.entries.some((e) => e.id === id)) {
    const newWs = { ...ws, activeId: id };
    workspaceStore.set(newWs);
    saveWorkspace(newWs);
  }
}

export function clearActive(): void {
  const ws = workspaceStore.get();
  if (ws.activeId !== null) {
    const newWs = { ...ws, activeId: null };
    workspaceStore.set(newWs);
    saveWorkspace(newWs);
  }
}

export function toggleLock(id: string): void {
  const ws = workspaceStore.get();
  const entry = ws.entries.find((e) => e.id === id);
  if (entry) {
    entry.locked = !entry.locked;
    workspaceStore.set({ ...ws });
    saveWorkspace(ws);
  }
}

export function updateEntryData(
  id: string,
  data: Pick<ViewerEntry, "payloadKind" | "payload">,
): ViewerEntry | null {
  const ws = workspaceStore.get();
  const entry = ws.entries.find((e) => e.id === id);
  if (!entry) return null;
  entry.payloadKind = data.payloadKind;
  entry.payload = data.payload;
  entry.updatedAt = Date.now();
  workspaceStore.set({ ...ws });
  saveWorkspace(ws);
  return entry;
}

export function duplicateEntry(id: string): ViewerEntry | null {
  const ws = workspaceStore.get();
  const src = ws.entries.find((e) => e.id === id);
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

  let newEntries = [duplicated, ...ws.entries];
  if (newEntries.length > MAX_ENTRIES) {
    newEntries = newEntries.slice(0, MAX_ENTRIES);
  }
  const newWs = { ...ws, entries: newEntries };
  workspaceStore.set(newWs);
  saveWorkspace(newWs);
  return duplicated;
}

export function getActive(): ViewerEntry | null {
  const ws = workspaceStore.get();
  if (!ws.activeId) return null;
  return ws.entries.find((e) => e.id === ws.activeId) ?? null;
}
