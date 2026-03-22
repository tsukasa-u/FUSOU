// ── I/O event handlers: import, share, load from URL, fleet load ──

import { renderAll } from "./airbase-renderer";
import { loadMasterDataFromJson } from "./data-loader";
import { applyFleetSnapshot, applyExportedFleet } from "./snapshot";
import {
  stripSvdataPrefix,
  detectResponseKind,
  convertPortToSnapshot,
  convertRequireInfoToSnapshot,
  convertGetDataToMasterData,
  mergeSnapshots,
} from "./api-response-parser";
import type { FleetSlot } from "./types";
import {
  addEntry,
  upsertEntry,
  removeEntry,
  duplicateEntry,
  updateEntryData,
  getActive,
  setActive,
  clearActive,
  toggleLock,
  getWorkspace,
  type ViewerEntry,
} from "./viewer-workspace";
import { resolveShareInput } from "./share-resolver";
import { decodePayloadBase64, pickNumericRecord } from "./payload-codec";
import {
  setWorkspaceReadOnly,
} from "./simulator-mutations";
import {
  getAirBaseState,
  getCombinedFleetType,
  getFleetState,
  getSnapshotShareState,
  hasSnapshotData,
} from "./simulator-selectors";

const _accessToken: string | null = (window as any).__fusouAccessToken ?? null;

function authHeaders(): HeadersInit {
  if (!_accessToken) return {};
  return { Authorization: `Bearer ${_accessToken}` };
}

async function copyTextWithFallback(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

type ShortenApiResponse = {
  ok: boolean;
  shortUrl?: string;
  error?: string;
  detail?: string;
  status?: number;
};

type ShareOptions = {
  includeAirBases: boolean;
  includeDetailedStats: boolean;
  includeSnapshotData: boolean;
};

const SHARED_SNAPSHOT_SESSION_KEY = "__fusouSharedSnapshot";
const WORKSPACE_MEMO_MAX_LENGTH = 300;
const WORKSPACE_COLLAPSED_VISIBLE_COUNT = 6;
let _isSnapshotPlayground = false;
let _playgroundDraft: Record<string, unknown> | null = null;
let _workspaceListExpanded = false;

function encodePayloadBase64(payload: unknown): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function serializeFleetForShare(fleet: FleetSlot[], includeDetailedStats: boolean): FleetSlot[] {
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

function buildSnapshotPayloadForShare() {
  return getSnapshotShareState();
}

function buildCurrentPlaygroundPayload(): Record<string, unknown> {
  const payload = buildSharePayload({
    includeAirBases: true,
    includeDetailedStats: true,
    includeSnapshotData: false,
  });
  const snapshotPayload = buildSnapshotPayloadForShare();
  return {
    ...payload,
    ...(snapshotPayload.snapshotShips ? { snapshotShips: snapshotPayload.snapshotShips } : {}),
    ...(snapshotPayload.snapshotSlotItems ? { snapshotSlotItems: snapshotPayload.snapshotSlotItems } : {}),
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
      { equipIds: [null, null, null, null], equipImprovement: [0, 0, 0, 0], equipProficiency: [0, 0, 0, 0] },
      { equipIds: [null, null, null, null], equipImprovement: [0, 0, 0, 0], equipProficiency: [0, 0, 0, 0] },
      { equipIds: [null, null, null, null], equipImprovement: [0, 0, 0, 0], equipProficiency: [0, 0, 0, 0] },
    ],
  });
  setSnapshotPlaygroundMode(false);
}

function finalizePlaygroundLoad(snapshotMode: boolean = hasSnapshotData(), rerender = false): void {
  clearActive();
  // Playground should always stay editable even if a locked workspace item was
  // active immediately before loading.
  setWorkspaceReadOnly(false);
  _playgroundDraft = buildCurrentPlaygroundPayload();
  setSnapshotPlaygroundMode(snapshotMode);
  if (rerender) renderWorkspacePanel();
}

function activateWorkspaceEntry(entry: ViewerEntry, rememberPlayground = true): void {
  const activeEntry = getActiveWorkspaceEntry();

  if (activeEntry && activeEntry.id !== entry.id) {
    saveCurrentStateToEntry(activeEntry);
  } else if (!activeEntry && rememberPlayground) {
    rememberCurrentPlayground();
  }

  setActive(entry.id);
  applyViewerEntry(entry);
  setSnapshotPlaygroundMode(false);
  renderWorkspacePanel();
}

function switchToPlayground(): void {
  const activeEntry = getActiveWorkspaceEntry();
  if (activeEntry) {
    saveCurrentStateToEntry(activeEntry);
  }
  clearActive();
  setWorkspaceReadOnly(false);
  applyPlaygroundDraftOrBlank();
  renderWorkspacePanel();
}

function getShareOptions(): ShareOptions {
  const includeAirBasesEl = document.getElementById("share-include-airbase") as HTMLInputElement | null;
  const includeDetailedStatsEl = document.getElementById("share-include-detailed-stats") as HTMLInputElement | null;
  const includeSnapshotDataEl = document.getElementById("share-include-snapshot") as HTMLInputElement | null;

  return {
    includeAirBases: includeAirBasesEl?.checked ?? true,
    includeDetailedStats: includeDetailedStatsEl?.checked ?? true,
    includeSnapshotData: includeSnapshotDataEl?.checked ?? false,
  };
}

function applyViewerEntry(entry: ViewerEntry): void {
  if (entry.payloadKind === "exportedFleet") {
    applyExportedFleet(entry.payload as Record<string, unknown>);
  } else {
    applyFleetSnapshot(entry.payload as Record<string, unknown>);
  }
}

function saveCurrentStateToEntry(entry: ViewerEntry): void {
  if (entry.sourceType !== "ownDeck") return;
  if (entry.locked) return;

  const mergedPayload = buildCurrentPlaygroundPayload();

  updateEntryData(entry.id, {
    payloadKind: "exportedFleet",
    payload: mergedPayload,
  });
}

function createOwnDeckFromCurrentState(name: string, memo: string): ViewerEntry {
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

function getWorkspaceModalElements() {
  return {
    modal: document.getElementById("workspace-add-modal") as HTMLDialogElement | null,
    title: document.getElementById("workspace-modal-title"),
    description: document.getElementById("workspace-modal-description"),
    labelInput: document.getElementById("workspace-entry-label") as HTMLInputElement | null,
    memoInput: document.getElementById("workspace-entry-memo") as HTMLTextAreaElement | null,
    shareInput: document.getElementById("workspace-share-input") as HTMLInputElement | null,
    confirmBtn: document.getElementById("btn-workspace-add-confirm") as HTMLButtonElement | null,
  };
}

function getWorkspaceEntryById(id: string): ViewerEntry | null {
  return getWorkspace().entries.find((entry) => entry.id === id) ?? null;
}

function buildLockIconSvg(locked: boolean): string {
  if (locked) {
    return '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 10V8a5 5 0 1 1 10 0v2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><rect x="5" y="10" width="14" height="10" rx="2.2" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="2.2"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9 10V8a5 5 0 0 1 9.4-2.4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M15 10h4v10H5V10h7" fill="currentColor" fill-opacity="0.12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function setSnapshotPlaygroundMode(enabled: boolean): void {
  _isSnapshotPlayground = enabled;
  const btn = document.getElementById("btn-workspace-add-current") as HTMLButtonElement | null;
  if (!btn) return;
  const isPlayground = getWorkspace().activeId === null;
  btn.disabled = !isPlayground;
  btn.title = isPlayground
    ? "現在のplayground編成をワークスペースへ追加"
    : "playgroundでのみ利用できます";
}

function hasSnapshotLink(entry: ViewerEntry): boolean {
  if (entry.payloadKind === "fleetSnapshot") return true;
  const payload = entry.payload as Record<string, unknown>;
  const snapshotShips = payload.snapshotShips;
  const snapshotSlotItems = payload.snapshotSlotItems;
  const hasShips = !!snapshotShips && typeof snapshotShips === "object" && Object.keys(snapshotShips).length > 0;
  const hasItems = !!snapshotSlotItems && typeof snapshotSlotItems === "object" && Object.keys(snapshotSlotItems).length > 0;
  return hasShips || hasItems;
}

function renderWorkspaceModeIndicator(): void {
  const el = document.getElementById("workspace-mode-status");
  if (!el) return;
  const activeId = getWorkspace().activeId;
  if (!activeId) {
    if (_isSnapshotPlayground) {
      el.textContent = "PLAYGROUND: SNAPSHOT";
      el.className = "badge badge-sm badge-info";
    } else {
      el.textContent = "PLAYGROUND: BLANK";
      el.className = "badge badge-sm badge-ghost";
    }
    return;
  }
  const active = getWorkspaceEntryById(activeId);
  if (!active) {
    el.textContent = "PLAYGROUND";
    el.className = "badge badge-sm badge-ghost";
    return;
  }
  const typeLabel = active.sourceType === "ownDeck" ? "DECK" : "URL";
  el.textContent = `WORKSPACE: ${typeLabel}`;
  el.className = active.sourceType === "ownDeck"
    ? "badge badge-sm badge-success"
    : "badge badge-sm badge-accent";
}

function syncLockedEditState(): void {
  const activeId = getWorkspace().activeId;
  const active = activeId ? getWorkspaceEntryById(activeId) : null;
  const locked = Boolean(active?.locked);
  const lockedMessage = "ロック中のため編集できません";
  setWorkspaceReadOnly(locked);

  const deckCaptureArea = document.getElementById("deck-capture-area") as HTMLElement | null;
  if (deckCaptureArea) {
    deckCaptureArea.title = locked ? lockedMessage : "";
  }

  const blockingButtons = ["btn-load-fleet", "btn-import"];
  for (const id of blockingButtons) {
    const btn = document.getElementById(id) as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = locked;
      btn.title = locked ? lockedMessage : "";
    }
  }

  const modeBadge = document.getElementById("workspace-mode-status") as HTMLElement | null;
  if (modeBadge) {
    modeBadge.title = locked ? lockedMessage : "";
  }

  const shipGrid = document.getElementById("ship-modal-grid") as HTMLElement | null;
  const equipGrid = document.getElementById("equip-modal-grid") as HTMLElement | null;
  if (shipGrid) shipGrid.title = locked ? lockedMessage : "";
  if (equipGrid) equipGrid.title = locked ? lockedMessage : "";
}

function resetWorkspaceModal(): void {
  const { modal, title, description, labelInput, memoInput, shareInput, confirmBtn } =
    getWorkspaceModalElements();
  if (modal) delete modal.dataset.editEntryId;
  if (title) title.textContent = "ワークスペースにURLを追加";
  if (description) {
    description.textContent = "共有URL（/s/xxxx or /simulator?data=...）を追加できます。URLを空欄のまま保存すると現在の編成を自分のデッキとして追加します。";
  }
  if (labelInput) labelInput.value = "";
  if (memoInput) memoInput.value = "";
  if (labelInput) labelInput.disabled = false;
  if (memoInput) memoInput.disabled = false;
  if (shareInput) {
    shareInput.value = "";
    shareInput.disabled = false;
  }
  if (confirmBtn) confirmBtn.textContent = "追加して切り替え";
  if (confirmBtn) confirmBtn.disabled = false;
}

function openWorkspaceEditModal(entry: ViewerEntry): void {
  const { modal, title, description, labelInput, memoInput, shareInput, confirmBtn } =
    getWorkspaceModalElements();
  if (!modal) return;

  modal.dataset.editEntryId = entry.id;
  if (title) title.textContent = "ワークスペース項目を編集";
  if (labelInput) labelInput.value = entry.name;
  if (memoInput) memoInput.value = entry.memo ?? "";
  if (labelInput) labelInput.disabled = Boolean(entry.locked);
  if (memoInput) memoInput.disabled = Boolean(entry.locked);
  if (shareInput) {
    if (entry.sourceType === "ownDeck") {
      shareInput.value = "";
      shareInput.disabled = true;
      if (description) {
        description.textContent = entry.locked
          ? "ロック中のデッキは編集できません。"
          : "自分のデッキ項目です。表示名とメモを更新できます。";
      }
    } else {
      shareInput.value =
        entry.sourceType === "shareKey"
          ? entry.sourceValue
          : entry.sourceType === "simulatorUrl"
            ? entry.sourceValue
            : "";
      shareInput.disabled = false;
      if (description) {
        description.textContent = entry.locked
          ? "ロック中の項目は編集できません。"
          : "表示名・メモ・共有URLを更新できます。保存するとこの項目へ切り替えます。";
      }
    }
  }
  if (confirmBtn) {
    confirmBtn.textContent = "保存して切り替え";
    confirmBtn.disabled = Boolean(entry.locked);
  }
  modal.showModal();
}

/** Render the shared workspace panel chips from current workspace state. */
function renderWorkspacePanel() {
  const ws = getWorkspace();
  const playgroundHost = document.getElementById("workspace-playground-entry");
  const list = document.getElementById("workspace-entry-list");
  const listFooter = document.getElementById("workspace-entry-list-footer");
  const empty = document.getElementById("workspace-empty");
  const count = document.getElementById("workspace-count");

  if (!playgroundHost || !list) return;

  renderWorkspaceModeIndicator();
  syncLockedEditState();

  if (count) count.textContent = `${ws.entries.length}件`;

  if (ws.entries.length === 0) {
    if (empty) empty.style.display = "";
  } else {
    if (empty) empty.style.display = "none";
  }

  if (ws.entries.length <= WORKSPACE_COLLAPSED_VISIBLE_COUNT) {
    _workspaceListExpanded = false;
  }

  playgroundHost.innerHTML = "";
  list.innerHTML = "";
  if (listFooter) listFooter.innerHTML = "";

  const activeIndex = ws.activeId ? ws.entries.findIndex((entry) => entry.id === ws.activeId) : -1;
  const shouldAutoExpandForActive = activeIndex >= WORKSPACE_COLLAPSED_VISIBLE_COUNT;
  const isExpanded = _workspaceListExpanded || shouldAutoExpandForActive;
  const visibleEntries = isExpanded
    ? ws.entries
    : ws.entries.slice(0, WORKSPACE_COLLAPSED_VISIBLE_COUNT);
  const hiddenCount = Math.max(0, ws.entries.length - visibleEntries.length);

  const playgroundChip = document.createElement("div");
  const isPlaygroundActive = ws.activeId === null;
  playgroundChip.className = [
    "flex items-center gap-2 p-2 rounded-lg border text-sm cursor-pointer transition-colors",
    isPlaygroundActive
      ? "border-info bg-info/10"
      : "border-base-300/60 hover:border-info/50",
  ].join(" ");

  const playgroundText = document.createElement("div");
  playgroundText.className = "flex-1 min-w-0";
  const playgroundName = document.createElement("div");
  playgroundName.className = "truncate font-medium";
  playgroundName.textContent = "Playground";
  const playgroundDesc = document.createElement("div");
  playgroundDesc.className = "text-[11px] text-base-content/55 mt-0.5";
  playgroundDesc.textContent = _isSnapshotPlayground
    ? "スナップショットを反映した作業中の編成"
    : "白紙状態から編成を作成する作業領域";
  playgroundText.appendChild(playgroundName);
  playgroundText.appendChild(playgroundDesc);

  playgroundChip.appendChild(playgroundText);
  playgroundChip.addEventListener("click", () => {
    switchToPlayground();
  });
  playgroundHost.appendChild(playgroundChip);

  for (const entry of visibleEntries) {
    const isActive = entry.id === ws.activeId;

    const chip = document.createElement("div");
    chip.className = [
      "flex items-center gap-2 p-2 rounded-lg border text-sm cursor-pointer transition-colors",
      isActive
        ? "border-primary bg-primary/10"
        : "border-base-300/60 hover:border-primary/40",
    ].join(" ");
    chip.dataset.entryId = entry.id;

    const textBlock = document.createElement("div");
    textBlock.className = "flex-1 min-w-0";

    const nameSpan = document.createElement("div");
    nameSpan.className = "truncate font-medium";
    nameSpan.textContent = entry.name;

    const memoSpan = document.createElement("div");
    memoSpan.className = "text-xs text-base-content/65 mt-0.5 line-clamp-2 overflow-hidden";
    memoSpan.textContent = entry.memo?.trim() ?? "";

    textBlock.appendChild(nameSpan);
    if (memoSpan.textContent) {
      textBlock.appendChild(memoSpan);
    }

    const badge = document.createElement("span");
    badge.className = "badge badge-sm shrink-0 " + (entry.sourceType === "ownDeck" ? "badge-warning" : "badge-accent");
    badge.textContent = entry.sourceType === "ownDeck" ? "DECK" : "URL";

    const snapshotBadge = document.createElement("span");
    snapshotBadge.className = "badge badge-sm shrink-0 " + (hasSnapshotLink(entry) ? "badge-info" : "badge-ghost");
    snapshotBadge.textContent = hasSnapshotLink(entry) ? "SNAP" : "NO-SNAP";

    const lockBtn = document.createElement("button");
    lockBtn.className = "shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors";
    lockBtn.innerHTML = buildLockIconSvg(Boolean(entry.locked));
    lockBtn.style.color = entry.locked ? "#dc2626" : "#16a34a";
    lockBtn.style.backgroundColor = entry.locked ? "rgba(220, 38, 38, 0.10)" : "rgba(22, 163, 74, 0.10)";
    lockBtn.style.border = `1px solid ${entry.locked ? "rgba(220, 38, 38, 0.20)" : "rgba(22, 163, 74, 0.20)"}`;
    lockBtn.title = entry.locked
      ? "ロック中：R2再読込で上書きされません。クリックで解除"
      : "ロック解除中：R2再読込で上書きされます。クリックでロック";
    lockBtn.setAttribute("aria-label", entry.locked ? "ロック中" : "ロック解除中");
    lockBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleLock(entry.id);
      renderWorkspacePanel();
    });

    const editBtn = document.createElement("button");
    editBtn.className = "btn btn-ghost btn-xs shrink-0";
    editBtn.textContent = "編集";
    editBtn.title = entry.locked ? "ロック中は編集できません" : "編集";
    editBtn.disabled = Boolean(entry.locked);
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (entry.locked) return;
      openWorkspaceEditModal(entry);
    });

    const delBtn = document.createElement("button");
    delBtn.className = "btn btn-ghost btn-xs shrink-0";
    delBtn.textContent = "×";
    delBtn.title = "削除";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeEntry(entry.id);
      renderWorkspacePanel();
    });

    const dupBtn = document.createElement("button");
    dupBtn.className = "btn btn-ghost btn-xs shrink-0";
    dupBtn.textContent = "複製";
    dupBtn.title = "この項目を複製";
    dupBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const duplicated = duplicateEntry(entry.id);
      if (!duplicated) return;
      activateWorkspaceEntry(duplicated);
    });

    chip.appendChild(textBlock);
    chip.appendChild(badge);
    chip.appendChild(snapshotBadge);
    chip.appendChild(lockBtn);
    chip.appendChild(dupBtn);
    chip.appendChild(editBtn);
    chip.appendChild(delBtn);

    chip.addEventListener("click", () => {
      activateWorkspaceEntry(entry);
    });

    list.appendChild(chip);
  }

  if (listFooter && ws.entries.length > WORKSPACE_COLLAPSED_VISIBLE_COUNT) {
    const footerWrap = document.createElement("div");
    footerWrap.className = "flex items-center justify-between gap-2";

    const footerText = document.createElement("span");
    footerText.className = "text-xs text-base-content/55";
    footerText.textContent = isExpanded
      ? `${ws.entries.length}件を表示中`
      : `${visibleEntries.length}件を表示中 / あと${hiddenCount}件`;

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "btn btn-ghost btn-xs";
    toggleBtn.textContent = isExpanded ? "折りたたむ" : `さらに表示 (${hiddenCount})`;
    toggleBtn.setAttribute("aria-expanded", isExpanded ? "true" : "false");
    toggleBtn.addEventListener("click", () => {
      _workspaceListExpanded = !isExpanded;
      renderWorkspacePanel();
    });

    footerWrap.appendChild(footerText);
    footerWrap.appendChild(toggleBtn);
    listFooter.appendChild(footerWrap);
  }
}

export async function loadFromUrl(): Promise<ViewerEntry | null> {
  const params = new URLSearchParams(window.location.search);
  let sharedSnapshotPayload: Record<string, unknown> | null = null;

  try {
    const rawSnapshotPayload = sessionStorage.getItem(SHARED_SNAPSHOT_SESSION_KEY);
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
          if (sharedSnapshotPayload.snapshotSlotItems && !merged.snapshotSlotItems) {
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

  return null;
}

// ── API Response Paste Dialog ──

interface ApiPasteCallbacks {
  onApplyExportedFleet(json: Record<string, unknown>): void;
  onApplySnapshot(json: Record<string, unknown>): void;
  onLoadMasterData(json: Record<string, unknown>): void;
}

function initApiPasteDialog(cb: ApiPasteCallbacks): void {
  const modal = document.getElementById("api-paste-modal") as HTMLDialogElement | null;

  const portTextarea = document.getElementById("api-paste-port") as HTMLTextAreaElement | null;
  const requireTextarea = document.getElementById("api-paste-require") as HTMLTextAreaElement | null;
  const masterTextarea = document.getElementById("api-paste-master") as HTMLTextAreaElement | null;

  function setFieldMessage(
    section: "port" | "require" | "master",
    msg: string,
    kind: "info" | "success" | "error" = "info",
  ): void {
    const el = document.getElementById(`api-paste-message-${section}`);
    if (!el) return;
    el.textContent = msg;
    el.className = `text-xs mt-1 min-h-[1.2em] ${
      kind === "success" ? "text-success" : kind === "error" ? "text-error" : "text-base-content/60"
    }`;
  }

  function setBadge(section: "port" | "require" | "master", text: string, success: boolean): void {
    const badge = document.getElementById(`api-paste-status-${section}`);
    if (!badge) return;
    badge.textContent = text;
    badge.className = success ? "badge badge-success badge-sm" : "badge badge-ghost badge-sm";
  }

  function tryParseJson(textarea: HTMLTextAreaElement | null, section: "port" | "require" | "master"): Record<string, unknown> | null {
    const raw = textarea?.value ?? "";
    if (!raw.trim()) return null; // empty is not an error — just skip
    try {
      return JSON.parse(stripSvdataPrefix(raw));
    } catch {
      setFieldMessage(section, "JSONのパースに失敗しました", "error");
      return null;
    }
  }

  function resetAll(): void {
    if (portTextarea) portTextarea.value = "";
    if (requireTextarea) requireTextarea.value = "";
    if (masterTextarea) masterTextarea.value = "";
    for (const s of ["port", "require", "master"] as const) {
      setFieldMessage(s, "");
      setBadge(s, "未読込", false);
    }
  }

  // Open dialog
  document.getElementById("btn-import")?.addEventListener("click", () => {
    if (!modal) return;
    modal.showModal();
  });

  // Apply — parse all non-empty textareas at once
  document.getElementById("btn-api-paste-apply")?.addEventListener("click", () => {
    // Clear previous messages
    for (const s of ["port", "require", "master"] as const) setFieldMessage(s, "");

    let hadError = false;

    // --- master data (getData) ---
    const masterJson = tryParseJson(masterTextarea, "master");
    if (masterJson) {
      const kind = detectResponseKind(masterJson);
      if (kind === "getData") {
        cb.onLoadMasterData(convertGetDataToMasterData(masterJson));
        setBadge("master", "読込済み", true);
        setFieldMessage("master", "マスターデータを読み込みました", "success");
        if (masterTextarea) masterTextarea.value = "";
      } else if (masterJson.mst_ships || masterJson.mst_slot_items || masterJson.ships || masterJson.equipments) {
        cb.onLoadMasterData(masterJson);
        setBadge("master", "読込済み", true);
        setFieldMessage("master", "マスターデータを読み込みました", "success");
        if (masterTextarea) masterTextarea.value = "";
      } else {
        setFieldMessage("master", "api_start2/getData のレスポンスではありません", "error");
        hadError = true;
      }
    }

    // --- port ---
    const portJson = tryParseJson(portTextarea, "port");
    if (portJson) {
      const kind = detectResponseKind(portJson);
      if (kind === "port") {
        // Normal port response — needs require_info too
        const reqJson = tryParseJson(requireTextarea, "require");
        if (reqJson) {
          const reqKind = detectResponseKind(reqJson);
          if (reqKind === "requireInfo") {
            const portSnap = convertPortToSnapshot(portJson);
            const reqSnap = convertRequireInfoToSnapshot(reqJson);
            const snapshot = mergeSnapshots(portSnap, reqSnap);
            cb.onApplySnapshot(snapshot);
            setBadge("port", `${portSnap.s3s.length}隻 / ${portSnap.d8k.length}艦隊`, true);
            setBadge("require", `${reqSnap.s8s.length}件`, true);
            setFieldMessage("port", "編成に反映しました", "success");
            setFieldMessage("require", "編成に反映しました", "success");
            if (portTextarea) portTextarea.value = "";
            if (requireTextarea) requireTextarea.value = "";
          } else {
            setFieldMessage("require", "api_get_member/require_info のレスポンスではありません", "error");
            hadError = true;
          }
        } else if (!requireTextarea?.value.trim()) {
          setFieldMessage("require", "port と合わせて require_info も貼り付けてください", "error");
          hadError = true;
        } else {
          hadError = true; // parse error already set by tryParseJson
        }
      } else if (portJson.fleet1 || portJson.fleet2 || portJson.fleet3 || portJson.fleet4 || portJson.airBases) {
        cb.onApplyExportedFleet(portJson);
        setBadge("port", "反映済み", true);
        setFieldMessage("port", "エクスポート済み編成を反映しました", "success");
        if (portTextarea) portTextarea.value = "";
      } else if (portJson.s3s) {
        cb.onApplySnapshot(portJson);
        setBadge("port", "反映済み", true);
        setFieldMessage("port", "スナップショットを反映しました", "success");
        if (portTextarea) portTextarea.value = "";
      } else {
        setFieldMessage("port", "api_port/port のレスポンスではありません", "error");
        hadError = true;
      }
    }

    // --- require_info only (no port) ---
    if (!portJson && requireTextarea?.value.trim()) {
      const reqJson = tryParseJson(requireTextarea, "require");
      if (reqJson) {
        setFieldMessage("require", "require_info 単体では反映できません。port も貼り付けてください", "error");
        hadError = true;
      }
    }

    if (!hadError && !portJson && !masterJson) {
      setFieldMessage("port", "いずれかのテキストエリアにデータを貼り付けてください", "info");
    }
  });

  // Reset
  document.getElementById("btn-api-paste-reset")?.addEventListener("click", () => {
    resetAll();
  });
}

/** Wire up all I/O-related event listeners. Call once at init time. */
export function initIOEvents(_initialEntry?: ViewerEntry | null) {
  const shareModal = document.getElementById("share-settings-modal") as HTMLDialogElement | null;
  const shareConfirmBtn = document.getElementById("btn-share-confirm") as HTMLButtonElement | null;

  clearActive();
  _playgroundDraft = buildCurrentPlaygroundPayload();
  setSnapshotPlaygroundMode(hasSnapshotData());

  window.addEventListener("beforeunload", () => {
    saveActiveOwnDeckIfNeeded();
  });

  // R2 fleet load
  document.getElementById("btn-load-fleet")?.addEventListener("click", async () => {
    const modal = document.getElementById("load-fleet-modal") as HTMLDialogElement;
    modal.showModal();

    const listContainer = document.getElementById("fleet-list-container")!;

    if (!_accessToken) {
      listContainer.innerHTML = '<p class="text-base-content/60 text-sm">この機能を利用するには<a href="/auth/signin" class="link link-primary">ログイン</a>が必要です</p>';
      return;
    }

    listContainer.innerHTML = '<span class="loading loading-spinner loading-sm"></span>';

    try {
      const res = await fetch("/api/fleet/snapshots/list", { headers: authHeaders() });
      if (res.status === 401 || res.status === 403) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        const msg = body.error ?? "認証エラー";
        const escaped = msg.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        listContainer.innerHTML = `<p class="text-warning text-sm">${escaped}</p>`;
        return;
      }
      if (!res.ok) {
        listContainer.innerHTML = '<p class="text-error text-sm">読込に失敗しました</p>';
        return;
      }
      const data = (await res.json()) as { ok: boolean; tags: { tag: string; uploaded: string; size: number }[] };
      if (!data.tags || data.tags.length === 0) {
        listContainer.innerHTML = '<p class="text-base-content/40">保存された艦隊データがありません</p>';
        return;
      }

      listContainer.innerHTML = "";
      for (const entry of data.tags) {
        const btn = document.createElement("button");
        btn.className = "btn btn-ghost btn-sm w-full justify-start gap-2";
        const uploaded = entry.uploaded ? new Date(entry.uploaded).toLocaleString() : "";
        btn.innerHTML = `<span class="flex-1 text-left">${entry.tag}</span><span class="text-xs text-base-content/40">${uploaded}</span>`;
        btn.addEventListener("click", async () => {
          try {
            const snapRes = await fetch(`/api/fleet/snapshot/${encodeURIComponent(entry.tag)}`, { headers: authHeaders() });
            if (snapRes.ok) {
              const result = (await snapRes.json()) as { ok: boolean; snapshot: Record<string, unknown> };
              applyFleetSnapshot(result.snapshot);
              finalizePlaygroundLoad(true, true);
              modal.close();
            } else {
              alert("スナップショットの読込に失敗しました");
            }
          } catch {
            alert("読込エラー");
          }
        });
        listContainer.appendChild(btn);
      }
    } catch {
      listContainer.innerHTML = '<p class="text-error text-sm">読込エラー</p>';
    }
  });

  initApiPasteDialog({
    onApplyExportedFleet(json) {
      applyExportedFleet(json);
      finalizePlaygroundLoad(hasSnapshotData(), true);
    },
    onApplySnapshot(json) {
      applyFleetSnapshot(json);
      finalizePlaygroundLoad(true, true);
    },
    onLoadMasterData(json) {
      loadMasterDataFromJson(json, renderAll);
    },
  });

  // Share (with URL shortening)
  document.getElementById("btn-share")?.addEventListener("click", () => {
    if (!shareModal) return;
    const includeSnapshotDataEl = document.getElementById("share-include-snapshot") as HTMLInputElement | null;
    const snapshotHintEl = document.getElementById("share-snapshot-hint");
    const hasSnapshot = hasSnapshotData();
    if (includeSnapshotDataEl) {
      includeSnapshotDataEl.checked = hasSnapshot;
      includeSnapshotDataEl.disabled = !hasSnapshot;
    }
    if (snapshotHintEl) {
      snapshotHintEl.textContent = hasSnapshot
        ? "スナップショット情報を共有に含めます。"
        : "この編成にはスナップショット情報がないため選択できません。";
    }
    shareModal.showModal();
  });

  shareConfirmBtn?.addEventListener("click", async () => {
    const opts = getShareOptions();
    const payload = buildSharePayload(opts);
    const snapshotPayload = opts.includeSnapshotData
      ? buildSnapshotPayloadForShare()
      : undefined;
    const encoded = encodePayloadBase64(payload);
    const longUrl = `${window.location.origin}/simulator?data=${encodeURIComponent(encoded)}`;

    let shortUrl = "";
    try {
      const res = await fetch("/api/shorten", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: longUrl, snapshotPayload }),
      });

      const responseText = await res.text();
      let data: ShortenApiResponse | null = null;
      try {
        data = JSON.parse(responseText) as ShortenApiResponse;
      } catch {
        console.warn("URL shortener response is not JSON:", responseText.slice(0, 300));
        alert("短縮URL応答の形式が不正です。時間をおいて再度お試しください。");
        return;
      }

      if (!res.ok || !data.ok) {
        console.warn("URL shortener normalized error:", res.status, data);
        const message = [data.error, data.detail]
          .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
          .join("\n");
        alert(message || "短縮URLの生成に失敗しました。設定または接続状態を確認してください。");
        return;
      }

      shortUrl = (data.shortUrl ?? "").trim();
      if (!shortUrl) {
        console.warn("URL shortener response missing shortUrl:", data);
        alert("短縮URL応答が不正です。時間をおいて再度お試しください。");
        return;
      }
    } catch (error) {
      console.warn("URL shortener request threw:", error);
      alert("短縮URLの生成に失敗しました。ネットワーク状態を確認してください。");
      return;
    }

    const copied = await copyTextWithFallback(shortUrl);
    if (copied) {
      shareModal?.close();
      alert("共有URLをクリップボードにコピーしました");
      return;
    }

    // Last-resort manual copy guidance.
    shareModal?.close();
    window.prompt("自動コピーに失敗しました。以下を手動でコピーしてください:", shortUrl);
  });

  // ── Workspace: open add modal ──
  document.getElementById("btn-workspace-add")?.addEventListener("click", () => {
    resetWorkspaceModal();
    const modal = document.getElementById(
      "workspace-add-modal",
    ) as HTMLDialogElement | null;
    modal?.showModal();
  });

  // ── Workspace: quick add current composition ──
  document.getElementById("btn-workspace-add-current")?.addEventListener("click", () => {
    const hasSnapshot = hasSnapshotData();
    const entry = createOwnDeckFromCurrentState(
      hasSnapshot ? `自分のデッキ（スナップショット由来） ${new Date().toLocaleTimeString()}` : "自分のデッキ",
      "",
    );
    activateWorkspaceEntry(entry);
  });

  // ── Workspace: confirm add ──
  document
    .getElementById("btn-workspace-add-confirm")
    ?.addEventListener("click", async () => {
      const { modal, labelInput, memoInput, shareInput, confirmBtn } =
        getWorkspaceModalElements();
      const editingEntryId = modal?.dataset.editEntryId ?? "";

      const label = labelInput?.value.trim() ?? "";
      const memoRaw = memoInput?.value.trim() ?? "";
      const memo = memoRaw.slice(0, WORKSPACE_MEMO_MAX_LENGTH);
      const shareUrl = shareInput?.value.trim() ?? "";
      const editingEntry = editingEntryId ? getWorkspaceEntryById(editingEntryId) : null;

      if (editingEntry?.sourceType === "ownDeck") {
        if (editingEntry.locked) {
          alert("ロック中のデッキは編集できません");
          return;
        }
        let payloadSource = editingEntry;
        if (getWorkspace().activeId === editingEntry.id) {
          saveCurrentStateToEntry(editingEntry);
          payloadSource = getWorkspaceEntryById(editingEntry.id) ?? editingEntry;
        }

        const updated = upsertEntry({
          id: payloadSource.id,
          name: label || payloadSource.name,
          memo,
          sourceType: payloadSource.sourceType,
          sourceValue: payloadSource.sourceValue,
          payloadKind: payloadSource.payloadKind,
          payload: payloadSource.payload,
          pinned: payloadSource.pinned,
          locked: payloadSource.locked ?? false,
        });
        activateWorkspaceEntry(updated);
        modal?.close();
        resetWorkspaceModal();
        return;
      }

      if (!shareUrl) {
        if (!editingEntryId) {
          const entry = createOwnDeckFromCurrentState(label, memo);
          activateWorkspaceEntry(entry);
          modal?.close();
          resetWorkspaceModal();
          return;
        }
        alert("共有URLを入力してください");
        return;
      }

      if (confirmBtn) confirmBtn.disabled = true;

      try {
        if (shareUrl) {
          const resolved = await resolveShareInput(shareUrl);
          if (!resolved.ok) {
            alert(resolved.error);
            return;
          }
          const entry = editingEntryId
            ? upsertEntry({
              id: editingEntryId,
              name: label || resolved.sourceValue.slice(0, 40),
              memo,
              sourceType: resolved.sourceType,
              sourceValue: resolved.sourceValue,
              payloadKind: resolved.payloadKind,
              payload: resolved.payload,
              pinned: false,
            })
            : addEntry({
            name: label || resolved.sourceValue.slice(0, 40),
            memo,
            sourceType: resolved.sourceType,
            sourceValue: resolved.sourceValue,
            payloadKind: resolved.payloadKind,
            payload: resolved.payload,
            pinned: false,
          });
          activateWorkspaceEntry(entry);
          modal?.close();
          resetWorkspaceModal();
        }
      } finally {
        if (confirmBtn) confirmBtn.disabled = false;
      }
    });

  // ── Workspace: initial render ──
  renderWorkspacePanel();
}
