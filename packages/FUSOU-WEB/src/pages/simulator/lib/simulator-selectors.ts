// ── Centralized simulator state selectors (read-only access) ──

import { simulatorReadOnly, state } from "./state";
import type {
  AirBaseSlot,
  FleetSlot,
  MstEquipExslotShipData,
  MstEquipLimitExslotData,
  MstShipData,
  MstSlotItemData,
  SlotItemEffectsData,
} from "./types";

export type ShipModalSource = "snapshot" | "master";
export type EquipModalSource = "snapshot" | "master";
export type SideFilter = "ally" | "enemy" | "all";

export type EquipModalTarget = {
  kind: "fleet" | "airbase" | null;
  shipId: number | null;
  shipLevel: number | null;
  slot: FleetSlot | null;
  airBase: AirBaseSlot | null;
  fleetIndex: 1 | 2 | 3 | 4 | null;
  shipSlotIndex: number | null;
  airBaseIndex: number | null;
  slotIdx: number;
};

export function isFleetSectionVisible(index: number): boolean {
  return state.fleetSectionVisible[index] !== false;
}

export function isAirbaseSectionVisible(): boolean {
  return state.airbaseSectionVisible !== false;
}

export function getVisibleAirbaseCount(): number {
  const n = Number(state.visibleAirbaseCount ?? 3);
  return Number.isFinite(n) ? Math.max(0, Math.min(3, Math.trunc(n))) : 3;
}

export function isWorkspaceReadOnly(): boolean {
  return simulatorReadOnly.get();
}

export function getShipModalCurrentId(): number | null {
  return state.shipModalCurrentId;
}

export function getShipModalTarget(): {
  fleetIndex: 1 | 2 | 3 | 4 | null;
  shipSlotIndex: number | null;
} {
  return {
    fleetIndex: state.shipModalTargetFleetIndex,
    shipSlotIndex: state.shipModalTargetShipSlotIndex,
  };
}

export function getShipModalSideFilter(): SideFilter {
  return state.shipModalSideFilter;
}

export function getShipModalSource(): ShipModalSource {
  return state.shipModalSource;
}

export function getEquipModalCurrentId(): number | null {
  return state.equipModalCurrentId;
}

export function getEquipModalSideFilter(): SideFilter {
  return state.equipModalSideFilter;
}

export function getEquipModalSource(): EquipModalSource {
  return state.equipModalSource;
}

export function getEquipModalTarget(): EquipModalTarget {
  let slot: FleetSlot | null = null;
  let airBase: AirBaseSlot | null = null;
  let shipId: number | null = null;
  let shipLevel: number | null = null;

  if (
    state.equipModalTargetKind === "fleet"
    && state.equipModalTargetFleetIndex != null
    && state.equipModalTargetShipSlotIndex != null
  ) {
    const fleets = getFleetState();
    const fleet =
      state.equipModalTargetFleetIndex === 1
        ? fleets.fleet1
        : state.equipModalTargetFleetIndex === 2
        ? fleets.fleet2
        : state.equipModalTargetFleetIndex === 3
        ? fleets.fleet3
        : fleets.fleet4;
    slot = fleet[state.equipModalTargetShipSlotIndex] ?? null;
    shipId = slot?.shipId ?? null;
    shipLevel = slot?.shipLevel ?? null;
  } else if (
    state.equipModalTargetKind === "airbase"
    && state.equipModalTargetAirBaseIndex != null
  ) {
    airBase = getAirBaseState()[state.equipModalTargetAirBaseIndex] ?? null;
  }

  return {
    kind: state.equipModalTargetKind,
    shipId,
    shipLevel,
    slot,
    airBase,
    fleetIndex: state.equipModalTargetFleetIndex,
    shipSlotIndex: state.equipModalTargetShipSlotIndex,
    airBaseIndex: state.equipModalTargetAirBaseIndex,
    slotIdx: state.equipModalTargetSlotIdx,
  };
}

export function isAirBaseEquipModalTarget(): boolean {
  return (
    state.equipModalTargetKind === "airbase"
  );
}

export function hasSnapshotData(): boolean {
  return (
    Object.keys(state.snapshotShips).length > 0 ||
    Object.keys(state.snapshotSlotItems).length > 0
  );
}

export function hasSnapshotShips(): boolean {
  return Object.keys(state.snapshotShips).length > 0;
}

export function hasSnapshotSlotItems(): boolean {
  return Object.keys(state.snapshotSlotItems).length > 0;
}

export function getSnapshotShips(): typeof state.snapshotShips {
  return state.snapshotShips;
}

export function getSnapshotSlotItems(): typeof state.snapshotSlotItems {
  return state.snapshotSlotItems;
}

export function hasMasterData(): boolean {
  return state.hasMasterData;
}

export function getMasterShips(): typeof state.mstShips {
  return state.mstShips;
}

export function getMasterShip(shipId: number): MstShipData | null {
  return state.mstShips[shipId] ?? null;
}

export function getMasterSlotItems(): typeof state.mstSlotItems {
  return state.mstSlotItems;
}

export function getMasterSlotItem(slotItemId: number): MstSlotItemData | null {
  return state.mstSlotItems[slotItemId] ?? null;
}

export function getMasterEquipTypeName(typeId: number): string | null {
  return state.mstSlotItemEquipTypes[typeId]?.name ?? null;
}

export function getMasterStypes(): typeof state.mstStypes {
  return state.mstStypes;
}

export function getMasterEquipShipMap(): typeof state.mstEquipShip {
  return state.mstEquipShip;
}

export function getMasterEquipExslotShip(slotItemId: number): MstEquipExslotShipData | null {
  return state.mstEquipExslotShip[slotItemId] ?? null;
}

export function getMasterEquipLimitExslot(shipId: number): MstEquipLimitExslotData | null {
  return state.mstEquipLimitExslot[shipId] ?? null;
}

export function hasBaseExslotEquipType(typeId: number): boolean {
  return state.equipExslotSet.has(typeId);
}

// Backward-compatible alias kept for existing call sites.
export function hasBaseExslotEquipId(slotItemId: number): boolean {
  return hasBaseExslotEquipType(slotItemId);
}

export function getBaseExslotEquipCount(): number {
  return state.equipExslotSet.size;
}

export function getWeaponIconFrame(iconId: number): [number, number, number, number] | null {
  return state.weaponIconFrames[iconId] ?? null;
}

export function getSpriteSheetMeta(): { width: number; height: number; url: string } {
  return {
    width: state.spriteSheetW,
    height: state.spriteSheetH,
    url: state.spriteSheetUrl,
  };
}

export function getSlotItemEffects(): SlotItemEffectsData | null {
  return state.slotItemEffects;
}

export function getAssetBaseUrl(): string {
  return state.assetBaseUrl;
}

export function getBannerMap(): typeof state.bannerMap {
  return state.bannerMap;
}

export function getCardMap(): typeof state.cardMap {
  return state.cardMap;
}

export function getEquipCardMap(): typeof state.equipCardMap {
  return state.equipCardMap;
}

export function getEquipItemUpMap(): typeof state.equipItemUpMap {
  return state.equipItemUpMap;
}

export function getMasterDataCounts(): {
  ships: number;
  equips: number;
  equipTypes: number;
  stypes: number;
  equipShip: number;
} {
  return {
    ships: Object.keys(state.mstShips).length,
    equips: Object.keys(state.mstSlotItems).length,
    equipTypes: Object.keys(state.mstSlotItemEquipTypes).length,
    stypes: Object.keys(state.mstStypes).length,
    equipShip: Object.keys(state.mstEquipShip).length,
  };
}

export function getFleetState(): {
  fleet1: FleetSlot[];
  fleet2: FleetSlot[];
  fleet3: FleetSlot[];
  fleet4: FleetSlot[];
} {
  return {
    fleet1: state.fleet1,
    fleet2: state.fleet2,
    fleet3: state.fleet3,
    fleet4: state.fleet4,
  };
}

export function getAirBaseState(): AirBaseSlot[] {
  return state.airBases;
}

export function getSnapshotShareState(): {
  snapshotShips: typeof state.snapshotShips;
  snapshotSlotItems: typeof state.snapshotSlotItems;
} {
  return {
    snapshotShips: state.snapshotShips,
    snapshotSlotItems: state.snapshotSlotItems,
  };
}
