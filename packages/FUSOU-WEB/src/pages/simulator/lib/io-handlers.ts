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

export function loadFromUrl() {
  const params = new URLSearchParams(window.location.search);

  const data = params.get("data");
  if (data) {
    try {
      const parsed = JSON.parse(atob(data));
      applyExportedFleet(parsed);
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

        if (json.fleet1 || json.fleet2 || json.airBases) {
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
    const data = { fleet1: state.fleet1, fleet2: state.fleet2, airBases: state.airBases };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fleet-composition.json";
    a.click();
    URL.revokeObjectURL(url);
  });

  // Share (with URL shortening)
  document.getElementById("btn-share")?.addEventListener("click", async () => {
    try {
      const payload = { fleet1: state.fleet1, fleet2: state.fleet2, airBases: state.airBases };
      const encoded = btoa(JSON.stringify(payload));
      const longUrl = `${window.location.origin}/simulator?data=${encodeURIComponent(encoded)}`;

      const shorterBase = (window as any).__fusouUrlShorterBase as string | undefined;
      if (!shorterBase) {
        alert("短縮URL設定エラー: PUBLIC_URL_SHORTER_BASE が未設定です");
        return;
      }

      const normalizedShorterBase = shorterBase.trim().replace(/\/+$/, "");
      const res = await fetch(`${normalizedShorterBase}/api/shorten`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: longUrl }),
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        console.warn("URL shortener request failed:", res.status, errorText);
        alert("短縮URLの生成に失敗しました。設定または接続状態を確認してください。");
        return;
      }

      const data = await res.json() as { shortUrl: string };
      await navigator.clipboard.writeText(data.shortUrl);
      alert("共有URLをクリップボードにコピーしました");
    } catch {
      alert("クリップボードへのコピーに失敗しました");
    }
  });
}
