// ── Data loader: master data import, normalization, asset loading ──

import {
  addEquipExslotId,
  resetWeaponIconFrames,
  resetShipTypeIconFrames,
  setAssetBaseUrl,
  setBannerMap,
  setCardMap,
  setEquipCardMap,
  setEquipItemUpMap,
  setHasMasterData,
  setMasterEquipExslotShip,
  setMasterEquipLimitExslot,
  setMasterEquipShip,
  setMasterEquipType,
  setMasterShip,
  setMasterSlotItem,
  setMasterStype,
  setShipIconMap,
  setShipTypeIconFrame,
  setShipTypeSpriteSheetMeta,
  setShipTypeSpriteSheetUrl,
  setSlotItemEffects,
  setSpriteSheetMeta,
  setSpriteSheetUrl,
  setWeaponIconFrame,
} from "./simulator-mutations";
import { beginBulkLoad, endBulkLoad } from "./state";
import { getAssetBaseUrl, getMasterDataCounts } from "./simulator-selectors";
import type {
  MstShipData,
  MstSlotItemData,
  MstSlotItemEquipTypeData,
  SlotItemEffectsData,
  MstStypeData,
  MstEquipExslotData,
  MstEquipShipData,
  MstEquipExslotShipData,
  MstEquipLimitExslotData,
} from "./types";

export function normalizeMstSlotItem(raw: MstSlotItemData): MstSlotItemData {
  if (raw.kaih == null && raw.houk != null) {
    return { ...raw, kaih: raw.houk };
  }
  return raw;
}

export function updateDataStatus() {
  const statusEl = document.getElementById("data-status");
  const textEl = document.getElementById("data-status-text");
  const counts = getMasterDataCounts();
  const shipCount = counts.ships;
  const equipCount = counts.equips;

  if (!statusEl || !textEl) {
    // Some render paths may load data before the status elements are mounted.
    setHasMasterData(shipCount > 0 || equipCount > 0);
    return;
  }

  // Swap the alert color modifier without touching other classes (mb-*, py-*, hidden, …).
  function setAlertType(type: "info" | "success" | "warning") {
    for (const cls of ["alert-info", "alert-success", "alert-warning", "alert-error"] as const) {
      statusEl!.classList.remove(cls);
    }
    statusEl!.classList.add(`alert-${type}`);
  }

  // Show only the icon that matches the current state.
  function showIcon(active: "info" | "success" | "warning") {
    for (const t of ["info", "success", "warning"] as const) {
      document.getElementById(`data-status-icon-${t}`)?.classList.toggle("hidden", t !== active);
    }
  }

  statusEl.classList.remove("hidden");

  if (shipCount > 0 && equipCount > 0) {
    setHasMasterData(true);
    setAlertType("success");
    showIcon("success");
    textEl.textContent = `マスターデータ読込済み — 艦 ${shipCount}件 / 装備 ${equipCount}件`;
  } else if (shipCount > 0 || equipCount > 0) {
    setHasMasterData(true);
    setAlertType("warning");
    showIcon("warning");
    textEl.textContent = `一部マスターデータ読込済み — 艦 ${shipCount}件 / 装備 ${equipCount}件`;
  } else {
    setHasMasterData(false);
    setAlertType("warning");
    showIcon("warning");
    textEl.textContent = "マスターデータが未読込です";
  }
}

/**
 * Load equipment filtering tables from a JSON object (e.g. API snapshot).
 * Supports both keyed-object format and array format (Avro records now include key fields).
 *
 * Expected keys (all optional):
 *   mst_stypes:              Record<number, MstStypeData> | MstStypeData[]
 *   mst_equip_exslots:       Record<number, { equip: number }> | { equip: number }[]
 *   mst_equip_ships:         Record<number, MstEquipShipData> | MstEquipShipData[]
 *   mst_equip_exslot_ships:  Record<string, MstEquipExslotShipData> | MstEquipExslotShipData[]
 *   mst_equip_limit_exslots: Record<number, MstEquipLimitExslotData> | MstEquipLimitExslotData[]
 */
export function loadEquipFilterFromJson(obj: Record<string, unknown>) {
  // mst_stypes
  if (obj.mst_stypes && typeof obj.mst_stypes === "object") {
    if (Array.isArray(obj.mst_stypes)) {
      for (const v of obj.mst_stypes) {
        if (v && typeof v === "object" && "id" in v) {
          setMasterStype(v as MstStypeData);
        }
      }
    } else {
      for (const [k, v] of Object.entries(
        obj.mst_stypes as Record<string, unknown>,
      )) {
        if (v && typeof v === "object" && "id" in v) {
          setMasterStype({ ...(v as MstStypeData), id: Number(k) });
        }
      }
    }
  }

  // mst_equip_exslots
  if (obj.mst_equip_exslots && typeof obj.mst_equip_exslots === "object") {
    if (Array.isArray(obj.mst_equip_exslots)) {
      for (const v of obj.mst_equip_exslots) {
        if (v && typeof v === "object" && "equip" in v) {
          addEquipExslotId((v as MstEquipExslotData).equip);
        }
      }
    } else {
      for (const v of Object.values(
        obj.mst_equip_exslots as Record<string, unknown>,
      )) {
        if (v && typeof v === "object" && "equip" in v) {
          addEquipExslotId((v as MstEquipExslotData).equip);
        }
      }
    }
  }

  // mst_equip_ships — supports both keyed object and array (with ship_id field)
  if (obj.mst_equip_ships && typeof obj.mst_equip_ships === "object") {
    if (Array.isArray(obj.mst_equip_ships)) {
      for (const v of obj.mst_equip_ships) {
        if (v && typeof v === "object" && "ship_id" in v && "equip_type" in v) {
          setMasterEquipShip(v as MstEquipShipData);
        }
      }
    } else {
      for (const [k, v] of Object.entries(
        obj.mst_equip_ships as Record<string, unknown>,
      )) {
        if (v && typeof v === "object" && "equip_type" in v) {
          setMasterEquipShip({ ...(v as MstEquipShipData), ship_id: Number(k) });
        }
      }
    }
  }

  // mst_equip_exslot_ships — supports both keyed object and array (with slotitem_id field)
  if (
    obj.mst_equip_exslot_ships &&
    typeof obj.mst_equip_exslot_ships === "object"
  ) {
    if (Array.isArray(obj.mst_equip_exslot_ships)) {
      for (const v of obj.mst_equip_exslot_ships) {
        if (v && typeof v === "object" && "slotitem_id" in v) {
          setMasterEquipExslotShip(v as MstEquipExslotShipData);
        }
      }
    } else {
      for (const [k, v] of Object.entries(
        obj.mst_equip_exslot_ships as Record<string, unknown>,
      )) {
        if (v && typeof v === "object" && "req_level" in v) {
          setMasterEquipExslotShip({ ...(v as MstEquipExslotShipData), slotitem_id: Number(k) });
        }
      }
    }
  }

  // mst_equip_limit_exslots — supports both keyed object and array (with ship_id field)
  if (
    obj.mst_equip_limit_exslots &&
    typeof obj.mst_equip_limit_exslots === "object"
  ) {
    if (Array.isArray(obj.mst_equip_limit_exslots)) {
      for (const v of obj.mst_equip_limit_exslots) {
        if (v && typeof v === "object" && "ship_id" in v && "equip" in v) {
          setMasterEquipLimitExslot(v as MstEquipLimitExslotData);
        }
      }
    } else {
      for (const [k, v] of Object.entries(
        obj.mst_equip_limit_exslots as Record<string, unknown>,
      )) {
        if (v && typeof v === "object" && "equip" in v) {
          setMasterEquipLimitExslot({ ...(v as MstEquipLimitExslotData), ship_id: Number(k) });
        }
      }
    }
  }
}

export function loadMasterDataFromJson(json: unknown, renderAll: () => void) {
  if (typeof json !== "object" || json === null) return;
  const obj = json as Record<string, unknown>;

  beginBulkLoad();
  try {
    if (obj.mst_ships && typeof obj.mst_ships === "object") {
    if (Array.isArray(obj.mst_ships)) {
      for (const v of obj.mst_ships) {
        if (v && typeof v === "object" && "id" in v && "name" in v) {
          setMasterShip(v as MstShipData);
        }
      }
    } else {
      for (const [k, v] of Object.entries(
        obj.mst_ships as Record<string, unknown>,
      )) {
        if (v && typeof v === "object" && "id" in v && "name" in v) {
          setMasterShip({ ...(v as MstShipData), id: Number(k) });
        }
      }
    }
  }

    if (obj.mst_slot_items && typeof obj.mst_slot_items === "object") {
    if (Array.isArray(obj.mst_slot_items)) {
      for (const v of obj.mst_slot_items) {
        if (v && typeof v === "object" && "id" in v && "name" in v) {
          const item = normalizeMstSlotItem(v as MstSlotItemData);
          setMasterSlotItem(item);
        }
      }
    } else {
      for (const [k, v] of Object.entries(
        obj.mst_slot_items as Record<string, unknown>,
      )) {
        if (v && typeof v === "object" && "id" in v && "name" in v) {
          setMasterSlotItem({
            ...normalizeMstSlotItem(v as MstSlotItemData),
            id: Number(k),
          });
        }
      }
    }
  }

  // Optional: equipment type master for category display
    const equipTypeObj =
      (obj.mst_slotitem_equiptypes as unknown) ??
      (obj.mst_slotitem_equiptype as unknown);
    if (equipTypeObj && typeof equipTypeObj === "object") {
    if (Array.isArray(equipTypeObj)) {
      for (const v of equipTypeObj) {
        if (v && typeof v === "object" && "id" in v && "name" in v) {
          const rec = v as MstSlotItemEquipTypeData;
          setMasterEquipType(rec);
        }
      }
    } else {
      for (const [k, v] of Object.entries(equipTypeObj as Record<string, unknown>)) {
        if (v && typeof v === "object" && "name" in v) {
          const rec = v as MstSlotItemEquipTypeData;
          setMasterEquipType({ ...rec, id: Number(k) });
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

  // ── Equipment filtering tables (JSON import preserves keys) ──
    loadEquipFilterFromJson(obj);

    updateDataStatus();
  } finally {
    endBulkLoad("all");
  }
  renderAll();
}

async function fetchJsonSafe<T>(url: string, label: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[simulator] ${label} fetch failed`, {
        url,
        status: res.status,
      });
      return null;
    }

    try {
      return (await res.json()) as T;
    } catch (err) {
      console.error(`[simulator] ${label} json parse failed`, {
        url,
        error: String(err),
      });
      return null;
    }
  } catch (err) {
    console.error(`[simulator] ${label} fetch error`, {
      url,
      error: String(err),
    });
    return null;
  }
}

export async function loadMasterData(renderAll: () => void) {
  beginBulkLoad();
  try {
    const [
      shipData,
      equipData,
      bannerMapData,
      cardMapData,
      shipIconMapData,
      equipImageData,
      iconFrameData,
      shipTypeIconFrameData,
      synergyData,
      equipTypeData,
      stypeData,
      equipExslotData,
      equipShipData,
      equipExslotShipData,
      equipLimitExslotData,
    ] = await Promise.all([
    fetchJsonSafe<{ records: MstShipData[] }>(
      "/api/master-data/json?table_name=mst_ship",
      "mst_ship",
    ),
    fetchJsonSafe<{ records: MstSlotItemData[] }>(
      "/api/master-data/json?table_name=mst_slotitem",
      "mst_slotitem",
    ),
    fetchJsonSafe<{
      base_url: string;
      banners: Record<string, string>;
    }>("/api/asset-sync/ship-banner-map", "ship-banner-map"),
    fetchJsonSafe<{
      base_url: string;
      cards: Record<string, string>;
    }>("/api/asset-sync/ship-card-map", "ship-card-map"),
    fetchJsonSafe<{
      base_url: string;
      icons: Record<string, string>;
    }>("/api/asset-sync/ship-icon-map", "ship-icon-map"),
    fetchJsonSafe<{
      base_url: string;
      card: Record<string, string>;
      item_up: Record<string, string>;
    }>("/api/asset-sync/equip-image-map", "equip-image-map"),
    fetchJsonSafe<{
      frames: Record<
        string,
        { frame: { x: number; y: number; w: number; h: number } }
      >;
      meta?: { size?: { w: number; h: number } };
    }>("/api/asset-sync/weapon-icon-frames?v=2", "weapon-icon-frames"),
    fetchJsonSafe<{
      frames: Record<
        string,
        { frame: { x: number; y: number; w: number; h: number } }
      >;
      meta?: { size?: { w: number; h: number } };
    }>("/api/asset-sync/ship-type-icon-frames?v=1", "ship-type-icon-frames"),
    fetchJsonSafe<SlotItemEffectsData>(
      "/data/slot_item_effects.json",
      "slot_item_effects",
    ),
    fetchJsonSafe<{ records: MstSlotItemEquipTypeData[] }>(
      "/api/master-data/json?table_name=mst_slotitem_equiptype",
      "mst_slotitem_equiptype",
    ),
    fetchJsonSafe<{ records: MstStypeData[] }>(
      "/api/master-data/json?table_name=mst_stype",
      "mst_stype",
    ),
    fetchJsonSafe<{ records: MstEquipExslotData[] }>(
      "/api/master-data/json?table_name=mst_equip_exslot",
      "mst_equip_exslot",
    ),
    fetchJsonSafe<{ records: MstEquipShipData[] }>(
      "/api/master-data/json?table_name=mst_equip_ship",
      "mst_equip_ship",
    ),
    fetchJsonSafe<{ records: MstEquipExslotShipData[] }>(
      "/api/master-data/json?table_name=mst_equip_exslot_ship",
      "mst_equip_exslot_ship",
    ),
    fetchJsonSafe<{ records: MstEquipLimitExslotData[] }>(
      "/api/master-data/json?table_name=mst_equip_limit_exslot",
      "mst_equip_limit_exslot",
    ),
  ]);

    if (shipData?.records) {
    for (const s of shipData.records) {
      if (s && s.id != null && s.name) setMasterShip(s);
    }
  }

    if (equipData?.records) {
    for (const e of equipData.records) {
      if (e && e.id != null && e.name)
        setMasterSlotItem(normalizeMstSlotItem(e));
    }
  }

    if (bannerMapData?.base_url) setAssetBaseUrl(bannerMapData.base_url);
    if (bannerMapData?.banners) setBannerMap(bannerMapData.banners);

    if (cardMapData?.base_url && !getAssetBaseUrl())
      setAssetBaseUrl(cardMapData.base_url);
    if (cardMapData?.cards) setCardMap(cardMapData.cards);

    if (shipIconMapData?.base_url && !getAssetBaseUrl())
      setAssetBaseUrl(shipIconMapData.base_url);
    if (shipIconMapData?.icons) setShipIconMap(shipIconMapData.icons);

    if (equipImageData?.base_url && !getAssetBaseUrl())
      setAssetBaseUrl(equipImageData.base_url);
    if (equipImageData?.card) setEquipCardMap(equipImageData.card);
    if (equipImageData?.item_up) setEquipItemUpMap(equipImageData.item_up);

    if (iconFrameData?.frames) {
    resetWeaponIconFrames();
    for (const [name, entry] of Object.entries(iconFrameData.frames)) {
      const m = name.match(/_id_(\d+)$/);
      if (!m) continue;
      const { x, y, w, h } = entry.frame;
      setWeaponIconFrame(parseInt(m[1], 10), [x, y, w, h]);
    }
  }

    if (iconFrameData?.meta?.size) {
    setSpriteSheetMeta(iconFrameData.meta.size.w ?? 0, iconFrameData.meta.size.h ?? 0);
  }

    if (shipTypeIconFrameData?.frames) {
    resetShipTypeIconFrames();
    for (const [name, entry] of Object.entries(shipTypeIconFrameData.frames)) {
      const m = name.match(/_([0-9]+)$/);
      if (!m) continue;
      const { x, y, w, h } = entry.frame;
      setShipTypeIconFrame(parseInt(m[1], 10), [x, y, w, h]);
    }
  }

    if (shipTypeIconFrameData?.meta?.size) {
    setShipTypeSpriteSheetMeta(
      shipTypeIconFrameData.meta.size.w ?? 0,
      shipTypeIconFrameData.meta.size.h ?? 0,
    );
  }

    if (iconFrameData) {
    const pngKey = "assets/kcs2/img/common/common_icon_weapon.png";
    try {
      const pngRes = await fetch("/api/asset-sync/weapon-icons");
      if (pngRes.ok) {
        const pngBlob = await pngRes.blob();
        setSpriteSheetUrl(await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(pngBlob);
        }));
      } else {
        const assetBaseUrl = getAssetBaseUrl();
        setSpriteSheetUrl(assetBaseUrl
          ? `${assetBaseUrl}/${pngKey}`
          : "/api/asset-sync/weapon-icons");
      }
    } catch {
      const assetBaseUrl = getAssetBaseUrl();
      setSpriteSheetUrl(assetBaseUrl
        ? `${assetBaseUrl}/${pngKey}`
        : "/api/asset-sync/weapon-icons");
    }
  }

    if (shipTypeIconFrameData) {
    const pngKey = "assets/kcs2/img/organize/organize_ship.png";
    try {
      const pngRes = await fetch("/api/asset-sync/ship-type-icons");
      if (pngRes.ok) {
        const pngBlob = await pngRes.blob();
        setShipTypeSpriteSheetUrl(await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(pngBlob);
        }));
      } else {
        const assetBaseUrl = getAssetBaseUrl();
        setShipTypeSpriteSheetUrl(assetBaseUrl
          ? `${assetBaseUrl}/${pngKey}`
          : "/api/asset-sync/ship-type-icons");
      }
    } catch {
      const assetBaseUrl = getAssetBaseUrl();
      setShipTypeSpriteSheetUrl(assetBaseUrl
        ? `${assetBaseUrl}/${pngKey}`
        : "/api/asset-sync/ship-type-icons");
    }
  }

    if (synergyData?.effects && synergyData.cross_effects) {
    setSlotItemEffects(synergyData);
  }

    if (equipTypeData?.records) {
    for (const t of equipTypeData.records) {
      if (t && t.id != null && t.name) {
        setMasterEquipType(t);
      }
    }
  }

  // ── Equipment filtering tables ──
    if (stypeData?.records) {
    for (const s of stypeData.records) {
      if (s && s.id != null) setMasterStype(s);
    }
  }

    if (equipExslotData?.records) {
    for (const e of equipExslotData.records) {
      if (e && e.equip != null) addEquipExslotId(e.equip);
    }
  }

    if (equipShipData?.records) {
    for (const r of equipShipData.records) {
      if (r && r.ship_id != null && r.equip_type) {
        setMasterEquipShip(r);
      }
    }
  }

    if (equipExslotShipData?.records) {
    for (const r of equipExslotShipData.records) {
      if (r && r.slotitem_id != null) {
        setMasterEquipExslotShip(r);
      }
    }
  }

    if (equipLimitExslotData?.records) {
    for (const r of equipLimitExslotData.records) {
      if (r && r.ship_id != null && r.equip) {
        setMasterEquipLimitExslot(r);
      }
    }
  }

    console.info("[simulator] master data load summary", getMasterDataCounts());

    updateDataStatus();
  } finally {
    endBulkLoad("all");
  }
  renderAll();
}
