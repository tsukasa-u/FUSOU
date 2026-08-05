// ── I/O event handlers: import, share, load from URL, fleet load ──

import { applyFleetSnapshot, applyExportedFleet } from "./snapshot";
import type { FleetSlot } from "./types";
import {
  addEntry,
  updateEntryData,
  getActive,
  setActive,
  clearActive,
  type ViewerEntry,
} from "./viewer-workspace";
import { decodePayloadBase64, pickNumericRecord } from "./payload-codec";
import {
  getAirBaseState,
  getCombinedFleetType,
  getFleetState,
  getSnapshotShareState,
  hasSnapshotData,
} from "./simulator-selectors";
import { authFetch } from "@/utils/authFetch";

const _accessToken: string | null = (window as any).__fusouAccessToken ?? null;

function authHeaders(): HeadersInit {
  if (!_accessToken) return {};
  return { Authorization: `Bearer ${_accessToken}` };
}


type ShortenApiResponse = {
  ok: boolean;
  shortUrl?: string;
  error?: string;
  detail?: string;
  status?: number;
};

export type ShareOptions = {
  includeAirBases: boolean;
  includeDetailedStats: boolean;
  includeSnapshotData: boolean;
};

const SHARED_SNAPSHOT_SESSION_KEY = "__fusouSharedSnapshot";
let _isSnapshotPlayground = false;
let _playgroundDraft: Record<string, unknown> | null = null;

function encodePayloadBase64(payload: unknown): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function serializeFleetForShare(
  fleet: FleetSlot[],
  includeDetailedStats: boolean,
): FleetSlot[] {
  return fleet.map((slot) => {
    const row: FleetSlot = {
      shipId: slot.shipId ?? null,
      shipLevel: slot.shipLevel ?? null,
      equipIds: [...(slot.equipIds ?? [null, null, null, null, null])],
      equipImprovement: [...(slot.equipImprovement ?? [0, 0, 0, 0, 0])],
      equipProficiency: [...(slot.equipProficiency ?? [0, 0, 0, 0, 0])],
      exSlotId: slot.exSlotId ?? null,
      exSlotImprovement: slot.exSlotImprovement ?? 0,
    };

    if (includeDetailedStats) {
      const statOverrides = pickNumericRecord(slot.statOverrides);
      const instanceStats = pickNumericRecord(slot.instanceStats);
      if (statOverrides) row.statOverrides = statOverrides;
      if (instanceStats) row.instanceStats = instanceStats;
    }

    return row;
  });
}

function buildSharePayload(opts: ShareOptions) {
  const { fleet1, fleet2, fleet3, fleet4 } = getFleetState();
  const payload: Record<string, unknown> = {
    v: 2,
    fleet1: serializeFleetForShare(fleet1, opts.includeDetailedStats),
    fleet2: serializeFleetForShare(fleet2, opts.includeDetailedStats),
    fleet3: serializeFleetForShare(fleet3, opts.includeDetailedStats),
    fleet4: serializeFleetForShare(fleet4, opts.includeDetailedStats),
    shareOptions: opts,
    combinedFleetType: getCombinedFleetType(),
  };

  if (opts.includeAirBases) {
    payload.airBases = getAirBaseState().map((base) => ({
      equipIds: [...(base.equipIds ?? [null, null, null, null])],
      equipImprovement: [...(base.equipImprovement ?? [0, 0, 0, 0])],
      equipProficiency: [...(base.equipProficiency ?? [0, 0, 0, 0])],
    }));
  }

  return payload;
}

export async function createShareUrl(opts: ShareOptions): Promise<string> {
  const payload = buildSharePayload(opts);
  let snapshotPayload: Record<string, unknown> | undefined;

  if (opts.includeSnapshotData) {
    const data = buildSnapshotPayloadForShare();
    if (data.snapshotShips || data.snapshotSlotItems) {
      snapshotPayload = {
        ...(data.snapshotShips ? { snapshotShips: data.snapshotShips } : {}),
        ...(data.snapshotSlotItems ? { snapshotSlotItems: data.snapshotSlotItems } : {})
      };
    }
  }

  const base64Str = encodePayloadBase64(payload);
  const shareUrl = `${window.location.origin}/share/data?data=${encodeURIComponent(base64Str)}`;
  const requestBody: Record<string, unknown> = { url: shareUrl };

  if (snapshotPayload) {
    requestBody.snapshotPayload = snapshotPayload;
  }
  
  const res = await fetch("/api/shorten", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }

  const json = await res.json() as ShortenApiResponse;
  if (!json.ok || !json.shortUrl) {
    throw new Error(json.error || "Failed to shorten URL");
  }

  return new URL(json.shortUrl, window.location.origin).toString();
}

function buildSnapshotPayloadForShare() {
  return getSnapshotShareState();
}

export function buildCurrentPlaygroundPayload(): Record<string, unknown> {
  const payload = buildSharePayload({
    includeAirBases: true,
    includeDetailedStats: true,
    includeSnapshotData: false,
  });
  const snapshotPayload = buildSnapshotPayloadForShare();
  return {
    ...payload,
    ...(snapshotPayload.snapshotShips
      ? { snapshotShips: snapshotPayload.snapshotShips }
      : {}),
    ...(snapshotPayload.snapshotSlotItems
      ? { snapshotSlotItems: snapshotPayload.snapshotSlotItems }
      : {}),
  };
}

function rememberCurrentPlayground(): void {
  _playgroundDraft = buildCurrentPlaygroundPayload();
}

function getActiveWorkspaceEntry(): ViewerEntry | null {
  return getActive();
}

function applyPlaygroundDraftOrBlank(): void {
  if (_playgroundDraft) {
    applyExportedFleet(_playgroundDraft);
    setSnapshotPlaygroundMode(hasSnapshotData());
    return;
  }

  applyExportedFleet({
    fleet1: [],
    fleet2: [],
    fleet3: [],
    fleet4: [],
    airBases: [
      {
        equipIds: [null, null, null, null],
        equipImprovement: [0, 0, 0, 0],
        equipProficiency: [0, 0, 0, 0],
      },
      {
        equipIds: [null, null, null, null],
        equipImprovement: [0, 0, 0, 0],
        equipProficiency: [0, 0, 0, 0],
      },
      {
        equipIds: [null, null, null, null],
        equipImprovement: [0, 0, 0, 0],
        equipProficiency: [0, 0, 0, 0],
      },
    ],
  });
  setSnapshotPlaygroundMode(false);
}

export function finalizePlaygroundLoad(
  hasSnapshotDataBool: boolean = hasSnapshotData(),
): void {
  clearActive();
  _playgroundDraft = buildCurrentPlaygroundPayload();
  setSnapshotPlaygroundMode(hasSnapshotDataBool);
}

export function activateWorkspaceEntry(
  entry: ViewerEntry,
  rememberPlayground = true,
  savePrevious = true,
): void {
  const activeEntry = getActiveWorkspaceEntry();

  if (activeEntry && activeEntry.id !== entry.id) {
    if (savePrevious) {
      saveCurrentStateToEntry(activeEntry);
    }
  } else if (!activeEntry && rememberPlayground) {
    rememberCurrentPlayground();
  }

  setActive(entry.id);
  applyViewerEntry(entry);
  setSnapshotPlaygroundMode(false);
}

export function switchToPlayground(): void {
  const activeEntry = getActiveWorkspaceEntry();
  if (activeEntry) {
    saveCurrentStateToEntry(activeEntry);
  }
  clearActive();
  applyPlaygroundDraftOrBlank();
}


function applyViewerEntry(entry: ViewerEntry): void {
  if (entry.payloadKind === "exportedFleet") {
    applyExportedFleet(entry.payload as Record<string, unknown>);
  } else {
    applyFleetSnapshot(entry.payload as Record<string, unknown>);
  }
}

export function saveCurrentStateToEntry(entry: ViewerEntry): void {
  if (entry.sourceType !== "ownDeck") return;
  if (entry.locked) return;

  const mergedPayload = buildCurrentPlaygroundPayload();

  updateEntryData(entry.id, {
    payloadKind: "exportedFleet",
    payload: mergedPayload,
  });
}

export function createOwnDeckFromCurrentState(
  name: string,
  memo: string,
): ViewerEntry {
  const mergedPayload = buildCurrentPlaygroundPayload();

  return addEntry({
    name: name || `自分のデッキ ${new Date().toLocaleString()}`,
    memo,
    sourceType: "ownDeck",
    sourceValue: `playground:${crypto.randomUUID()}`,
    payloadKind: "exportedFleet",
    payload: mergedPayload,
    pinned: false,
    locked: false,
  });
}

function saveActiveOwnDeckIfNeeded(): void {
  const activeEntry = getActiveWorkspaceEntry();
  if (!activeEntry || activeEntry.sourceType !== "ownDeck") return;
  saveCurrentStateToEntry(activeEntry);
}


export function isSnapshotPlayground(): boolean { return _isSnapshotPlayground; }

function setSnapshotPlaygroundMode(enabled: boolean): void {
  _isSnapshotPlayground = enabled;
}

export async function loadFromUrl(): Promise<ViewerEntry | null> {
  const params = new URLSearchParams(window.location.search);
  let sharedSnapshotPayload: Record<string, unknown> | null = null;

  try {
    const rawSnapshotPayload = sessionStorage.getItem(
      SHARED_SNAPSHOT_SESSION_KEY,
    );
    if (rawSnapshotPayload) {
      const parsed = JSON.parse(rawSnapshotPayload);
      if (parsed && typeof parsed === "object") {
        sharedSnapshotPayload = parsed as Record<string, unknown>;
      }
      sessionStorage.removeItem(SHARED_SNAPSHOT_SESSION_KEY);
    }
  } catch {
    // Ignore malformed session payload and continue.
  }

  const data = params.get("data");
  if (data) {
    try {
      const parsed = decodePayloadBase64(data);
      if (parsed && typeof parsed === "object") {
        const merged = parsed as Record<string, unknown>;
        if (sharedSnapshotPayload) {
          if (sharedSnapshotPayload.snapshotShips && !merged.snapshotShips) {
            merged.snapshotShips = sharedSnapshotPayload.snapshotShips;
          }
          if (
            sharedSnapshotPayload.snapshotSlotItems &&
            !merged.snapshotSlotItems
          ) {
            merged.snapshotSlotItems = sharedSnapshotPayload.snapshotSlotItems;
          }
        }
        applyExportedFleet(merged);
        _playgroundDraft = merged;
        setSnapshotPlaygroundMode(hasSnapshotData());
        clearActive();
        return null;
      }
    } catch {
      // Invalid data param
    }
  }

  const fleetTag = params.get("fleet")?.trim();
  if (fleetTag) {
    if (!_accessToken) {
      console.warn("fleet param was provided but access token is unavailable");
      return null;
    }

    try {
      const res = await authFetch(
        `/api/fleet/snapshot/${encodeURIComponent(fleetTag)}`
      );
      if (res.ok) {
        const payload = (await res.json()) as {
          ok?: boolean;
          snapshot?: Record<string, unknown>;
        };
        if (payload.snapshot) {
          applyFleetSnapshot(payload.snapshot);
          _playgroundDraft = buildCurrentPlaygroundPayload();
          setSnapshotPlaygroundMode(true);
          clearActive();
        }
      }
    } catch {
      // Ignore invalid or unavailable fleet snapshot links.
    }
  }

  return null;
}

export function initIOEvents(_initialEntry?: ViewerEntry | null) {
  clearActive();
  _playgroundDraft = buildCurrentPlaygroundPayload();
  _isSnapshotPlayground = hasSnapshotData();

  window.addEventListener("beforeunload", () => {
    saveActiveOwnDeckIfNeeded();
  });
}
