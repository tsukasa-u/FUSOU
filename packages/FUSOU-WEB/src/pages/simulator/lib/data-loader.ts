// ── Data loader: master data import, normalization, asset loading ──

import { state } from "./state";
import type { MstShipData, MstSlotItemData, SlotItemEffectsData } from "./types";

export function normalizeMstSlotItem(raw: MstSlotItemData): MstSlotItemData {
  if (raw.kaih == null && raw.houk != null) {
    return { ...raw, kaih: raw.houk };
  }
  return raw;
}

export function updateDataStatus() {
  const statusEl = document.getElementById("data-status")!;
  const textEl = document.getElementById("data-status-text")!;
  const shipCount = Object.keys(state.mstShips).length;
  const equipCount = Object.keys(state.mstSlotItems).length;

  if (shipCount > 0 && equipCount > 0) {
    state.hasMasterData = true;
    statusEl.className = "alert alert-success mb-5 py-2";
    textEl.textContent = `マスターデータ読込済み — 艦娘 ${shipCount}件 / 装備 ${equipCount}件`;
  } else if (shipCount > 0 || equipCount > 0) {
    state.hasMasterData = true;
    statusEl.className = "alert alert-warning mb-5 py-2";
    textEl.textContent = `一部マスターデータ読込済み — 艦娘 ${shipCount}件 / 装備 ${equipCount}件`;
  } else {
    state.hasMasterData = false;
    statusEl.className = "alert alert-warning mb-5 py-2";
    textEl.textContent = "マスターデータが未読込です";
  }
}

export function loadMasterDataFromJson(json: unknown, renderAll: () => void) {
  if (typeof json !== "object" || json === null) return;
  const obj = json as Record<string, unknown>;

  if (obj.mst_ships && typeof obj.mst_ships === "object") {
    if (Array.isArray(obj.mst_ships)) {
      for (const v of obj.mst_ships) {
        if (v && typeof v === "object" && "id" in v && "name" in v) {
          state.mstShips[(v as MstShipData).id] = v as MstShipData;
        }
      }
    } else {
      for (const [k, v] of Object.entries(obj.mst_ships as Record<string, unknown>)) {
        if (v && typeof v === "object" && "id" in v && "name" in v) {
          state.mstShips[Number(k)] = v as MstShipData;
        }
      }
    }
  }

  if (obj.mst_slot_items && typeof obj.mst_slot_items === "object") {
    if (Array.isArray(obj.mst_slot_items)) {
      for (const v of obj.mst_slot_items) {
        if (v && typeof v === "object" && "id" in v && "name" in v) {
          const item = normalizeMstSlotItem(v as MstSlotItemData);
          state.mstSlotItems[item.id] = item;
        }
      }
    } else {
      for (const [k, v] of Object.entries(obj.mst_slot_items as Record<string, unknown>)) {
        if (v && typeof v === "object" && "id" in v && "name" in v) {
          state.mstSlotItems[Number(k)] = normalizeMstSlotItem(v as MstSlotItemData);
        }
      }
    }
  }

  if (obj.ships && !obj.mst_ships) {
    loadMasterDataFromJson({ mst_ships: obj.ships }, renderAll);
  }
  if (obj.equipments && !obj.mst_slot_items) {
    loadMasterDataFromJson({ mst_slot_items: obj.equipments }, renderAll);
  }

  updateDataStatus();
  renderAll();
}

export async function loadMasterData(renderAll: () => void) {
  try {
    const [shipRes, equipRes, bannerRes, cardRes, equipImgRes, iconFrameRes, synergyRes] = await Promise.all([
      fetch("/api/master-data/json?table_name=mst_ship"),
      fetch("/api/master-data/json?table_name=mst_slotitem"),
      fetch("/api/asset-sync/ship-banner-map"),
      fetch("/api/asset-sync/ship-card-map"),
      fetch("/api/asset-sync/equip-image-map"),
      fetch("/api/asset-sync/weapon-icon-frames"),
      fetch("/data/slot_item_effects.json"),
    ]);

    if (shipRes.ok) {
      const shipData = (await shipRes.json()) as { records: MstShipData[] };
      if (shipData.records) {
        for (const s of shipData.records) {
          if (s && s.id != null && s.name) state.mstShips[s.id] = s;
        }
      }
    }

    if (equipRes.ok) {
      const equipData = (await equipRes.json()) as { records: MstSlotItemData[] };
      if (equipData.records) {
        for (const e of equipData.records) {
          if (e && e.id != null && e.name) state.mstSlotItems[e.id] = normalizeMstSlotItem(e);
        }
      }
    }

    if (bannerRes.ok) {
      const mapData = (await bannerRes.json()) as { base_url: string; banners: Record<string, string> };
      if (mapData.base_url) state.assetBaseUrl = mapData.base_url;
      if (mapData.banners) state.bannerMap = mapData.banners;
    }

    if (cardRes.ok) {
      const mapData = (await cardRes.json()) as { base_url: string; cards: Record<string, string> };
      if (mapData.base_url && !state.assetBaseUrl) state.assetBaseUrl = mapData.base_url;
      if (mapData.cards) state.cardMap = mapData.cards;
    }

    if (equipImgRes.ok) {
      const eMap = (await equipImgRes.json()) as { base_url: string; card: Record<string, string>; item_up: Record<string, string> };
      if (eMap.base_url && !state.assetBaseUrl) state.assetBaseUrl = eMap.base_url;
      if (eMap.card) state.equipCardMap = eMap.card;
      if (eMap.item_up) state.equipItemUpMap = eMap.item_up;
    }

    if (iconFrameRes.ok) {
      const atlas = (await iconFrameRes.json()) as {
        frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
        meta?: { size?: { w: number; h: number } };
      };
      if (atlas.frames) {
        state.weaponIconFrames = {};
        for (const [name, entry] of Object.entries(atlas.frames)) {
          const m = name.match(/_id_(\d+)$/);
          if (!m) continue;
          const { x, y, w, h } = entry.frame;
          state.weaponIconFrames[parseInt(m[1], 10)] = [x, y, w, h];
        }
      }
      if (atlas.meta?.size) {
        state.spriteSheetW = atlas.meta.size.w ?? 0;
        state.spriteSheetH = atlas.meta.size.h ?? 0;
      }
      const pngKey = "assets/kcs2/img/common/common_icon_weapon.png";
      try {
        const pngRes = await fetch("/api/asset-sync/weapon-icons");
        if (pngRes.ok) {
          const pngBlob = await pngRes.blob();
          state.spriteSheetUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(pngBlob);
          });
        } else {
          state.spriteSheetUrl = state.assetBaseUrl ? `${state.assetBaseUrl}/${pngKey}` : "/api/asset-sync/weapon-icons";
        }
      } catch {
        state.spriteSheetUrl = state.assetBaseUrl ? `${state.assetBaseUrl}/${pngKey}` : "/api/asset-sync/weapon-icons";
      }
    }

    if (synergyRes.ok) {
      const synData = (await synergyRes.json()) as SlotItemEffectsData;
      if (synData.effects && synData.cross_effects) {
        state.slotItemEffects = synData;
      }
    }
  } catch {
    // Server unavailable
  }

  updateDataStatus();
  renderAll();
}
