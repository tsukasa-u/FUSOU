// ── I/O event handlers: import, export, share, load from URL, fleet load ──

import { state } from "./state";
import { renderAll } from "./airbase-renderer";
import { loadMasterDataFromJson } from "./data-loader";
import { applyFleetSnapshot, applyExportedFleet } from "./snapshot";
import type { FleetSlot } from "./types";
import {
  addEntry,
  upsertEntry,
  removeEntry,
  duplicateEntry,
  setActive,
  clearActive,
  toggleLock,
  getWorkspace,
  type ViewerEntry,
} from "./viewer-workspace";
import { resolveShareInput } from "./share-resolver";

const _accessToken: string | null = (window as any).__fusouAccessToken ?? null;

function authHeaders(): HeadersInit {
  if (!_accessToken) return {};
  return { Authorization: `Bearer ${_accessToken}` };
}

async function copyTextWithFallback(text: string): Promise<boolean> {
  // Preferred modern API (requires secure context + user gesture)
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Continue to legacy fallback.
    }
  }

  // Legacy fallback for browsers where Clipboard API is unavailable/blocked.
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (ok) return true;
  } catch {
    // Fall through to manual prompt guidance.
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
let _isSnapshotPlayground = false;

function encodePayloadBase64(payload: unknown): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function decodePayloadBase64(data: string): unknown {
  // v2 UTF-8-safe decode path
  try {
    const binary = atob(data);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json);
  } catch {
    // Backward compatibility: older links used direct atob(JSON)
    return JSON.parse(atob(data));
  }
}

function pickNumericRecord(input: unknown): Record<string, number> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
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
  const payload: Record<string, unknown> = {
    v: 2,
    fleet1: serializeFleetForShare(state.fleet1, opts.includeDetailedStats),
    fleet2: serializeFleetForShare(state.fleet2, opts.includeDetailedStats),
    fleet3: serializeFleetForShare(state.fleet3, opts.includeDetailedStats),
    fleet4: serializeFleetForShare(state.fleet4, opts.includeDetailedStats),
    shareOptions: opts,
  };

  if (opts.includeAirBases) {
    payload.airBases = state.airBases.map((base) => ({
      equipIds: [...(base.equipIds ?? [null, null, null, null])],
      equipImprovement: [...(base.equipImprovement ?? [0, 0, 0, 0])],
      equipProficiency: [...(base.equipProficiency ?? [0, 0, 0, 0])],
    }));
  }

  return payload;
}

function buildSnapshotPayloadForShare() {
  return {
    snapshotShips: state.snapshotShips,
    snapshotSlotItems: state.snapshotSlotItems,
  };
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

  const payload = buildSharePayload({
    includeAirBases: true,
    includeDetailedStats: true,
    includeSnapshotData: false,
  });
  const snapshotPayload = buildSnapshotPayloadForShare();
  const mergedPayload = {
    ...payload,
    ...(snapshotPayload.snapshotShips ? { snapshotShips: snapshotPayload.snapshotShips } : {}),
    ...(snapshotPayload.snapshotSlotItems ? { snapshotSlotItems: snapshotPayload.snapshotSlotItems } : {}),
  };

  upsertEntry({
    id: entry.id,
    name: entry.name,
    memo: entry.memo,
    sourceType: entry.sourceType,
    sourceValue: entry.sourceValue,
    payloadKind: "exportedFleet",
    payload: mergedPayload,
    pinned: entry.pinned,
    locked: entry.locked ?? false,
  });
}

function createOwnDeckFromCurrentState(name: string, memo: string): ViewerEntry {
  const payload = buildSharePayload({
    includeAirBases: true,
    includeDetailedStats: true,
    includeSnapshotData: false,
  });
  const snapshotPayload = buildSnapshotPayloadForShare();
  const mergedPayload = {
    ...payload,
    ...(snapshotPayload.snapshotShips ? { snapshotShips: snapshotPayload.snapshotShips } : {}),
    ...(snapshotPayload.snapshotSlotItems ? { snapshotSlotItems: snapshotPayload.snapshotSlotItems } : {}),
  };

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
  const activeId = getWorkspace().activeId;
  if (!activeId) return;
  const activeEntry = getWorkspaceEntryById(activeId);
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

function getCoverageText(entry: ViewerEntry): string {
  const payload = entry.payload as Record<string, unknown>;

  const fleetLabels: string[] = [];
  if (entry.payloadKind === "fleetSnapshot") {
    const decks = Array.isArray(payload.d8k) ? (payload.d8k as Record<string, unknown>[]) : [];
    for (let i = 0; i < Math.min(decks.length, 4); i++) {
      const shipIds = Array.isArray(decks[i]?.s3s) ? (decks[i]?.s3s as number[]) : [];
      if (shipIds.some((id) => typeof id === "number" && id > 0)) fleetLabels.push(`F${i + 1}`);
    }
    return `艦隊:${fleetLabels.join(",") || "-"} / 基地:${"-"}`;
  }

  for (const idx of [1, 2, 3, 4]) {
    const fleet = payload[`fleet${idx}`];
    const rows = Array.isArray(fleet) ? (fleet as Record<string, unknown>[]) : [];
    const hasShip = rows.some((row) => typeof row?.shipId === "number" && row.shipId > 0);
    if (hasShip) fleetLabels.push(`F${idx}`);
  }

  const airBases = Array.isArray(payload.airBases) ? (payload.airBases as Record<string, unknown>[]) : [];
  let maxAirBaseIndex = 0;
  for (let i = 0; i < airBases.length; i++) {
    const equipIds = Array.isArray(airBases[i]?.equipIds) ? (airBases[i]?.equipIds as Array<number | null>) : [];
    const hasEquip = equipIds.some((id) => typeof id === "number" && id > 0);
    if (hasEquip) maxAirBaseIndex = i + 1;
  }

  return `艦隊:${fleetLabels.join(",") || "-"} / 基地:${maxAirBaseIndex > 0 ? `A1-A${maxAirBaseIndex}` : "-"}`;
}

function buildLockIconSvg(locked: boolean): string {
  if (locked) {
    return '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 10V8a5 5 0 1 1 10 0v2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 10V8a5 5 0 1 1 10 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M15 10h4v10H5V10h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function setSnapshotPlaygroundMode(enabled: boolean): void {
  _isSnapshotPlayground = enabled;
  const btn = document.getElementById("btn-workspace-add-current") as HTMLButtonElement | null;
  if (!btn) return;
  btn.disabled = !enabled;
  btn.title = enabled
    ? "現在の編成をワークスペースへ追加"
    : "スナップショット読込後のplaygroundでのみ利用できます";
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
  if (shareInput) {
    shareInput.value = "";
    shareInput.disabled = false;
  }
  if (confirmBtn) confirmBtn.textContent = "追加して切り替え";
}

function openWorkspaceEditModal(entry: ViewerEntry): void {
  const { modal, title, description, labelInput, memoInput, shareInput, confirmBtn } =
    getWorkspaceModalElements();
  if (!modal) return;

  modal.dataset.editEntryId = entry.id;
  if (title) title.textContent = "ワークスペース項目を編集";
  if (labelInput) labelInput.value = entry.name;
  if (memoInput) memoInput.value = entry.memo ?? "";
  if (shareInput) {
    if (entry.sourceType === "ownDeck") {
      shareInput.value = "";
      shareInput.disabled = true;
      if (description) {
        description.textContent = "自分のデッキ項目です。表示名とメモを更新できます。";
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
        description.textContent = "表示名・メモ・共有URLを更新できます。保存するとこの項目へ切り替えます。";
      }
    }
  }
  if (confirmBtn) confirmBtn.textContent = "保存して切り替え";
  modal.showModal();
}

/** Render the shared workspace panel chips from current workspace state. */
function renderWorkspacePanel() {
  const ws = getWorkspace();
  const list = document.getElementById("workspace-entry-list");
  const empty = document.getElementById("workspace-empty");
  const count = document.getElementById("workspace-count");

  if (!list) return;

  if (count) count.textContent = `${ws.entries.length}件`;

  if (ws.entries.length === 0) {
    if (empty) empty.style.display = "";
    list.innerHTML = "";
    return;
  }

  if (empty) empty.style.display = "none";
  list.innerHTML = "";

  for (const entry of ws.entries) {
    const isActive = entry.id === ws.activeId;

    const chip = document.createElement("div");
    chip.className = [
      "flex items-start gap-2 p-2 rounded-lg border text-sm cursor-pointer transition-colors",
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
    memoSpan.className = "text-xs text-base-content/65 mt-0.5 whitespace-pre-wrap break-words";
    memoSpan.textContent = entry.memo?.trim() ?? "";

    const coverageSpan = document.createElement("div");
    coverageSpan.className = "text-[11px] text-base-content/55 mt-0.5";
    coverageSpan.textContent = getCoverageText(entry);

    textBlock.appendChild(nameSpan);
    if (memoSpan.textContent) {
      textBlock.appendChild(memoSpan);
    }
    textBlock.appendChild(coverageSpan);

    const badge = document.createElement("span");
    badge.className = "badge badge-sm shrink-0 " + (entry.locked ? "badge-warning" : "badge-ghost");
    badge.textContent = entry.sourceType === "ownDeck" ? "DECK" : "URL";

    const lockBtn = document.createElement("button");
    lockBtn.className = "btn btn-ghost btn-xs shrink-0";
    lockBtn.innerHTML = buildLockIconSvg(Boolean(entry.locked));
    lockBtn.style.color = entry.locked ? "hsl(var(--wa))" : "hsl(var(--bc) / 0.55)";
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
    editBtn.title = "編集";
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
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
      setActive(duplicated.id);
      applyViewerEntry(duplicated);
      setSnapshotPlaygroundMode(false);
      renderWorkspacePanel();
    });

    chip.appendChild(textBlock);
    chip.appendChild(badge);
    chip.appendChild(lockBtn);
    chip.appendChild(dupBtn);
    chip.appendChild(editBtn);
    chip.appendChild(delBtn);

    chip.addEventListener("click", () => {
      const activeId = getWorkspace().activeId;
      if (activeId && activeId !== entry.id) {
        const currentEntry = getWorkspaceEntryById(activeId);
        if (currentEntry) saveCurrentStateToEntry(currentEntry);
      }
      setActive(entry.id);
      applyViewerEntry(entry);
      setSnapshotPlaygroundMode(false);
      renderWorkspacePanel();
    });

    list.appendChild(chip);
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
        setSnapshotPlaygroundMode(false);
        const sourceValue = `${window.location.origin}/simulator?data=${encodeURIComponent(data)}`;
        const entry = addEntry({
          name: "共有URL（現在）",
          memo: "",
          sourceType: "simulatorUrl",
          sourceValue,
          payloadKind: "exportedFleet",
          payload: merged,
          pinned: false,
        });
        setActive(entry.id);
        return entry;
      }
    } catch {
      // Invalid data param
    }
  }

  return null;
}

/** Wire up all I/O-related event listeners. Call once at init time. */
export function initIOEvents(_initialEntry?: ViewerEntry | null) {
  const shareModal = document.getElementById("share-settings-modal") as HTMLDialogElement | null;
  const shareConfirmBtn = document.getElementById("btn-share-confirm") as HTMLButtonElement | null;

  setSnapshotPlaygroundMode(false);

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
              clearActive();
              setSnapshotPlaygroundMode(true);

              const wsEntry = addEntry({
                name: entry.tag,
                memo: "",
                sourceType: "ownDeck",
                sourceValue: entry.tag,
                payloadKind: "fleetSnapshot",
                payload: result.snapshot,
                pinned: false,
              });
              if (wsEntry.locked) {
                // Keep the latest snapshot in playground even when locked entry is preserved in workspace.
                clearActive();
              }
              renderWorkspacePanel();
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

  // JSON Import
  const fileInput = document.getElementById("import-file-input") as HTMLInputElement;

  document.getElementById("btn-import")?.addEventListener("click", () => {
    fileInput.click();
  });

  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result as string);

        if (json.fleet1 || json.fleet2 || json.fleet3 || json.fleet4 || json.airBases) {
          applyExportedFleet(json);
          clearActive();
          const hasSnapshot = Object.keys(state.snapshotShips).length > 0 || Object.keys(state.snapshotSlotItems).length > 0;
          setSnapshotPlaygroundMode(hasSnapshot);
        } else if (json.mst_ships || json.mst_slot_items || json.ships || json.equipments) {
          loadMasterDataFromJson(json, renderAll);
        } else if (json.s3s) {
          applyFleetSnapshot(json);
          clearActive();
          setSnapshotPlaygroundMode(true);
        } else {
          alert("認識できないJSONフォーマットです");
        }
      } catch (e) {
        alert(`JSONの読込に失敗しました: ${e}`);
      }
      fileInput.value = "";
    };
    reader.readAsText(file);
  });

  // Export
  document.getElementById("btn-export")?.addEventListener("click", () => {
    const data = {
      fleet1: state.fleet1,
      fleet2: state.fleet2,
      fleet3: state.fleet3,
      fleet4: state.fleet4,
      airBases: state.airBases,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fleet-composition.json";
    a.click();
    URL.revokeObjectURL(url);
  });

  // Share (with URL shortening)
  document.getElementById("btn-share")?.addEventListener("click", () => {
    if (!shareModal) return;
    const includeSnapshotDataEl = document.getElementById("share-include-snapshot") as HTMLInputElement | null;
    const snapshotHintEl = document.getElementById("share-snapshot-hint");
    const hasSnapshot = Object.keys(state.snapshotShips).length > 0 || Object.keys(state.snapshotSlotItems).length > 0;
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
    if (!_isSnapshotPlayground) return;
    const hasSnapshot = Object.keys(state.snapshotShips).length > 0 || Object.keys(state.snapshotSlotItems).length > 0;
    const entry = createOwnDeckFromCurrentState(
      hasSnapshot ? `自分のデッキ（スナップショット由来） ${new Date().toLocaleTimeString()}` : "自分のデッキ",
      "",
    );
    setActive(entry.id);
    applyViewerEntry(entry);
    setSnapshotPlaygroundMode(false);
    renderWorkspacePanel();
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
        setActive(updated.id);
        applyViewerEntry(updated);
        setSnapshotPlaygroundMode(false);
        renderWorkspacePanel();
        modal?.close();
        resetWorkspaceModal();
        return;
      }

      if (!shareUrl) {
        if (!editingEntryId) {
          const entry = createOwnDeckFromCurrentState(label, memo);
          setActive(entry.id);
          applyViewerEntry(entry);
          setSnapshotPlaygroundMode(false);
          renderWorkspacePanel();
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
          setActive(entry.id);
          applyViewerEntry(entry);
          setSnapshotPlaygroundMode(false);
          renderWorkspacePanel();
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
