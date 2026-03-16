// ── I/O event handlers: import, export, share, load from URL, fleet load ──

import { state } from "./state";
import { renderAll } from "./airbase-renderer";
import { loadMasterDataFromJson } from "./data-loader";
import { applyFleetSnapshot, applyExportedFleet } from "./snapshot";
import type { FleetSlot } from "./types";

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

export function loadFromUrl() {
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
      }
    } catch {
      // Invalid data param
    }
  }

  const fleetTag = params.get("fleet");
  if (fleetTag && _accessToken) {
    fetch(`/api/fleet/snapshot/${encodeURIComponent(fleetTag)}`, { headers: authHeaders() })
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((result: any) => {
        applyFleetSnapshot(result.snapshot as Record<string, unknown>);
      })
      .catch(() => {});
  }
}

/** Wire up all I/O-related event listeners. Call once at init time. */
export function initIOEvents() {
  const shareModal = document.getElementById("share-settings-modal") as HTMLDialogElement | null;
  const shareConfirmBtn = document.getElementById("btn-share-confirm") as HTMLButtonElement | null;

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
      const data = (await res.json()) as { ok: boolean; tags: { tag: string; r2_key: string; uploaded: string; size: number }[] };
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
        } else if (json.mst_ships || json.mst_slot_items || json.ships || json.equipments) {
          loadMasterDataFromJson(json, renderAll);
        } else if (json.s3s) {
          applyFleetSnapshot(json);
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
}
