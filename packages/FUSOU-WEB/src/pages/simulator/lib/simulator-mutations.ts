// ── Centralized simulator state mutations ──

import { markSimulatorStateDirty, simulatorReadOnly, simulatorCombinedFleetType, state } from "./state";
import { AIRCRAFT_TYPES } from "./constants";
import { filterForNormalSlot, getExslotSelectionRequirement } from "./equip-filter";
import type {
  AirBaseSlot,
  EquipSelection,
  FleetSlot,
  MstEquipExslotShipData,
  MstEquipLimitExslotData,
  MstEquipShipData,
  MstShipData,
  MstSlotItemData,
  MstSlotItemEquipTypeData,
  MstStypeData,
  ShipSelection,
  SlotItemEffectsData,
} from "./types";
import { emptyAirBase, emptyFleetSlot } from "./types";
import type {
  EquipModalSource,
  ShipModalSource,
  SideFilter,
} from "./simulator-selectors";
import { getMasterShip, getMasterSlotItem } from "./simulator-selectors";

export * from "./simulator-selectors";

export function setCombinedFleetType(type: 0 | 1 | 2 | 3): void {
  state.combinedFleetType = type;
  simulatorCombinedFleetType.set(type);
}

export function setFleetFormation(fleetIndex: 1 | 2 | 3 | 4, formationId: number): void {
  state.fleetFormations[fleetIndex] = Math.max(0, Math.trunc(formationId));
}

function clampInt(value: number | null | undefined, min: number, max: number, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  const n = Math.trunc(value);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function isValidAirBaseEquipId(equipId: number): boolean {
  const equip = getMasterSlotItem(equipId);
  if (!equip) return false;
  const type2 = equip.type?.[2] ?? -1;
  if (!AIRCRAFT_TYPES.has(type2)) return false;
  return (equip.distance ?? 0) > 0;
}

export function assignShipToFleetSlot(slot: FleetSlot, shipId: number | null): void {
  slot.shipId = shipId;
  if (shipId == null) slot.shipLevel = null;
  slot.equipIds = [null, null, null, null, null];
  slot.equipImprovement = [0, 0, 0, 0, 0];
  slot.equipProficiency = [0, 0, 0, 0, 0];
  slot.exSlotId = null;
  slot.exSlotImprovement = 0;
  delete slot.instanceStats;
  markSimulatorStateDirty("fleet");
}

export function applyShipSelectionToFleetSlot(
  slot: FleetSlot,
  selection: ShipSelection,
): void {
  slot.shipId = selection.id;
  if (selection.id == null) {
    slot.shipLevel = null;
  } else if (selection.level !== undefined) {
    slot.shipLevel = clampInt(selection.level, 1, 180, 1);
  }
  slot.equipIds = [null, null, null, null, null];
  slot.equipImprovement = [0, 0, 0, 0, 0];
  slot.equipProficiency = [0, 0, 0, 0, 0];
  slot.exSlotId = null;
  slot.exSlotImprovement = 0;
  delete slot.instanceStats;
  markSimulatorStateDirty("fleet");
}

export function cycleFleetEquipProficiency(slot: FleetSlot, equipIdx: number): void {
  const cur = slot.equipProficiency[equipIdx] ?? 0;
  slot.equipProficiency[equipIdx] = cur >= 7 ? 0 : cur + 1;
  markSimulatorStateDirty("fleet");
}

export function cycleFleetEquipImprovement(slot: FleetSlot, equipIdx: number): void {
  const cur = slot.equipImprovement[equipIdx] ?? 0;
  slot.equipImprovement[equipIdx] = cur >= 10 ? 0 : cur + 1;
  markSimulatorStateDirty("fleet");
}

export function setFleetEquip(slot: FleetSlot, equipIdx: number, equipId: number | null): void {
  const changed = slot.equipIds[equipIdx] !== equipId;
  slot.equipIds[equipIdx] = equipId;
  if (changed) {
    slot.equipImprovement[equipIdx] = 0;
    slot.equipProficiency[equipIdx] = 0;
  }
  markSimulatorStateDirty("fleet");
}

export function applyFleetEquipSelection(
  slot: FleetSlot,
  equipIdx: number,
  selection: EquipSelection,
): void {
  if (equipIdx < 0 || equipIdx >= 5) return;

  if (selection.id != null) {
    const shipId = slot.shipId;
    const equip = getMasterSlotItem(selection.id);
    if (!equip || shipId == null || getMasterShip(shipId) == null) return;

    const filtered = filterForNormalSlot(shipId, [equip], equipIdx);
    if (filtered && filtered.length === 0) return;
  }

  slot.equipIds[equipIdx] = selection.id;
  slot.equipImprovement[equipIdx] =
    selection.id == null ? 0 : clampInt(selection.level, 0, 10, 0);
  slot.equipProficiency[equipIdx] =
    selection.id == null ? 0 : clampInt(selection.alv, 0, 7, 0);
  markSimulatorStateDirty("fleet");
}

export function cycleFleetExslotImprovement(slot: FleetSlot): void {
  const cur = slot.exSlotImprovement ?? 0;
  slot.exSlotImprovement = cur >= 10 ? 0 : cur + 1;
  markSimulatorStateDirty("fleet");
}

export function setFleetExslotEquip(slot: FleetSlot, equipId: number | null): void {
  if (slot.exSlotId !== equipId) slot.exSlotImprovement = 0;
  slot.exSlotId = equipId;
  markSimulatorStateDirty("fleet");
}

export function applyFleetExslotSelection(
  slot: FleetSlot,
  selection: EquipSelection,
): void {
  if (selection.id != null) {
    const shipId = slot.shipId;
    const equip = getMasterSlotItem(selection.id);
    if (!equip || shipId == null || getMasterShip(shipId) == null) return;

    if (getExslotSelectionRequirement(shipId, equip) == null) return;
  }

  slot.exSlotId = selection.id;
  slot.exSlotImprovement =
    selection.id == null ? 0 : clampInt(selection.level, 0, 10, 0);
  markSimulatorStateDirty("fleet");
}

export function ensureFleetStatOverrides(slot: FleetSlot): NonNullable<FleetSlot["statOverrides"]> {
  if (!slot.statOverrides) {
    slot.statOverrides = {};
    // NOTE: do NOT call markSimulatorStateDirty here.
    // This function is called in the render path (StatCell initialisation).
    // Triggering a dirty notification during rendering causes a redundant
    // rerender on every initial mount. The object exists purely to hold
    // overrides; callers that actually mutate the overrides (e.g. updateDelta)
    // are responsible for emitting the dirty notification.
  }
  return slot.statOverrides;
}

export function setEquipModalTargetForFleet(
  fleetIndex: 1 | 2 | 3 | 4,
  shipSlotIndex: number,
  equipIdx: number,
): void {
  state.equipModalTargetKind = "fleet";
  state.equipModalTargetFleetIndex = fleetIndex;
  state.equipModalTargetShipSlotIndex = shipSlotIndex;
  state.equipModalTargetAirBaseIndex = null;
  state.equipModalTargetSlotIdx = equipIdx;
}

export function setEquipModalTargetForAirBase(
  airBaseIndex: number,
  equipIdx: number,
): void {
  state.equipModalTargetKind = "airbase";
  state.equipModalTargetFleetIndex = null;
  state.equipModalTargetShipSlotIndex = null;
  state.equipModalTargetAirBaseIndex = airBaseIndex;
  state.equipModalTargetSlotIdx = equipIdx;
}

export function cycleAirBaseEquipProficiency(base: AirBaseSlot, equipIdx: number): void {
  const cur = base.equipProficiency[equipIdx] ?? 0;
  base.equipProficiency[equipIdx] = cur >= 7 ? 0 : cur + 1;
  markSimulatorStateDirty("airbase");
}

export function cycleAirBaseEquipImprovement(base: AirBaseSlot, equipIdx: number): void {
  const cur = base.equipImprovement[equipIdx] ?? 0;
  base.equipImprovement[equipIdx] = cur >= 10 ? 0 : cur + 1;
  markSimulatorStateDirty("airbase");
}

export function setAirBaseEquip(base: AirBaseSlot, equipIdx: number, equipId: number | null): void {
  const changed = base.equipIds[equipIdx] !== equipId;
  base.equipIds[equipIdx] = equipId;
  if (changed) {
    base.equipImprovement[equipIdx] = 0;
    base.equipProficiency[equipIdx] = 0;
  }
  markSimulatorStateDirty("airbase");
}

export function applyAirBaseEquipSelection(
  base: AirBaseSlot,
  equipIdx: number,
  selection: EquipSelection,
): void {
  if (equipIdx < 0 || equipIdx >= 4) return;
  if (selection.id != null && !isValidAirBaseEquipId(selection.id)) return;

  base.equipIds[equipIdx] = selection.id;
  base.equipImprovement[equipIdx] =
    selection.id == null ? 0 : clampInt(selection.level, 0, 10, 0);
  base.equipProficiency[equipIdx] =
    selection.id == null ? 0 : clampInt(selection.alv, 0, 7, 0);
  markSimulatorStateDirty("airbase");
}

export function setFleetSectionVisible(index: number, visible: boolean): void {
  state.fleetSectionVisible[index] = visible;
}

export function setAirbaseSectionVisible(visible: boolean): void {
  state.airbaseSectionVisible = visible;
}

export function setVisibleAirbaseCount(count: number): void {
  const n = Number.isFinite(count) ? Math.trunc(count) : 3;
  state.visibleAirbaseCount = Math.max(0, Math.min(3, n));
}

export function setWorkspaceReadOnly(readOnly: boolean): void {
  state.isWorkspaceReadOnly = readOnly;
  simulatorReadOnly.set(readOnly);
}

export function beginShipModalSession(
  currentId: number | null,
  cb: (selection: ShipSelection) => void,
): void {
  state.shipModalCb = cb;
  state.shipModalCurrentId = currentId;
}

export function setShipModalTargetForFleet(
  fleetIndex: 1 | 2 | 3 | 4,
  shipSlotIndex: number,
): void {
  state.shipModalTargetFleetIndex = fleetIndex;
  state.shipModalTargetShipSlotIndex = shipSlotIndex;
}

export function setShipModalSideFilter(sideFilter: SideFilter): void {
  state.shipModalSideFilter = sideFilter;
}

export function setShipModalSource(source: ShipModalSource): void {
  state.shipModalSource = source;
}

export function consumeShipModalCallback(selection: ShipSelection): boolean {
  const cb = state.shipModalCb;
  state.shipModalCb = null;
  if (!cb) return false;
  try {
    cb(selection);
    return true;
  } catch (error) {
    console.error("[simulator] ship modal callback failed", error);
    return false;
  }
}

export function beginEquipModalSession(
  currentId: number | null,
  cb: (selection: EquipSelection) => void,
): void {
  state.equipModalCb = cb;
  state.equipModalCurrentId = currentId;
}

export function setEquipModalSideFilter(sideFilter: SideFilter): void {
  state.equipModalSideFilter = sideFilter;
}

export function setEquipModalSource(source: EquipModalSource): void {
  state.equipModalSource = source;
}

export function consumeEquipModalCallback(selection: EquipSelection): boolean {
  const cb = state.equipModalCb;
  state.equipModalCb = null;
  if (!cb) return false;
  try {
    cb(selection);
    return true;
  } catch (error) {
    console.error("[simulator] equip modal callback failed", error);
    return false;
  }
}

export function resetAllFleets(): void {
  [state.fleet1, state.fleet2, state.fleet3, state.fleet4].forEach((fleet) => {
    for (let i = 0; i < 6; i++) fleet[i] = emptyFleetSlot();
  });
  markSimulatorStateDirty("fleet");
}

export function resetAllAirBases(): void {
  for (let i = 0; i < 3; i++) {
    state.airBases[i] = emptyAirBase();
  }
  markSimulatorStateDirty("airbase");
}

export function replaceFleetSlot(fleet: FleetSlot[], index: number, slot: FleetSlot): void {
  fleet[index] = slot;
  markSimulatorStateDirty("fleet");
}

export function replaceAirBaseSlot(index: number, base: AirBaseSlot): void {
  state.airBases[index] = base;
  markSimulatorStateDirty("airbase");
}

export function clearSnapshotData(): void {
  state.snapshotShips = {};
  state.snapshotSlotItems = {};
}

export function replaceSnapshotSlotItems(
  slotItems: Record<number, { slotitem_id: number; level: number; alv: number }>,
): void {
  state.snapshotSlotItems = slotItems;
}

export function setSnapshotShipRecord(
  instanceId: number,
  ship: { shipId: number; level: number; name: string; stype: number },
): void {
  state.snapshotShips[instanceId] = ship;
}

export function setSnapshotSlotItemRecord(
  instanceId: number,
  slotItem: { slotitem_id: number; level: number; alv: number },
): void {
  state.snapshotSlotItems[instanceId] = slotItem;
}

export function setHasMasterData(hasMasterData: boolean): void {
  state.hasMasterData = hasMasterData;
  markSimulatorStateDirty();
}

export function setMasterShip(ship: MstShipData): void {
  state.mstShips[ship.id] = ship;
  markSimulatorStateDirty();
}

export function setMasterSlotItem(slotItem: MstSlotItemData): void {
  state.mstSlotItems[slotItem.id] = slotItem;
  markSimulatorStateDirty();
}

export function setMasterEquipType(equipType: MstSlotItemEquipTypeData): void {
  state.mstSlotItemEquipTypes[equipType.id] = equipType;
  markSimulatorStateDirty();
}

export function setMasterStype(stype: MstStypeData): void {
  state.mstStypes[stype.id] = stype;
  markSimulatorStateDirty();
}

export function addEquipExslotId(equipId: number): void {
  state.equipExslotSet.add(equipId);
  markSimulatorStateDirty();
}

export function setMasterEquipShip(record: MstEquipShipData): void {
  state.mstEquipShip[record.ship_id] = record;
  markSimulatorStateDirty();
}

export function setMasterEquipExslotShip(record: MstEquipExslotShipData): void {
  state.mstEquipExslotShip[record.slotitem_id] = record;
  markSimulatorStateDirty();
}

export function setMasterEquipLimitExslot(record: MstEquipLimitExslotData): void {
  state.mstEquipLimitExslot[record.ship_id] = record;
  markSimulatorStateDirty();
}

export function setAssetBaseUrl(assetBaseUrl: string): void {
  state.assetBaseUrl = assetBaseUrl;
  markSimulatorStateDirty();
}

export function setBannerMap(bannerMap: Record<string, string>): void {
  state.bannerMap = bannerMap;
  markSimulatorStateDirty();
}

export function setCardMap(cardMap: Record<string, string>): void {
  state.cardMap = cardMap;
  markSimulatorStateDirty();
}

export function setShipIconMap(shipIconMap: Record<string, string>): void {
  state.shipIconMap = shipIconMap;
  markSimulatorStateDirty();
}

export function setEquipCardMap(equipCardMap: Record<string, string>): void {
  state.equipCardMap = equipCardMap;
  markSimulatorStateDirty();
}

export function setEquipItemUpMap(equipItemUpMap: Record<string, string>): void {
  state.equipItemUpMap = equipItemUpMap;
  markSimulatorStateDirty();
}

export function resetWeaponIconFrames(): void {
  state.weaponIconFrames = {};
  markSimulatorStateDirty();
}

export function setWeaponIconFrame(iconId: number, frame: [number, number, number, number]): void {
  state.weaponIconFrames[iconId] = frame;
  markSimulatorStateDirty();
}

export function setSpriteSheetMeta(width: number, height: number): void {
  state.spriteSheetW = width;
  state.spriteSheetH = height;
  markSimulatorStateDirty();
}

export function setSpriteSheetUrl(spriteSheetUrl: string): void {
  state.spriteSheetUrl = spriteSheetUrl;
  markSimulatorStateDirty();
}

export function resetShipTypeIconFrames(): void {
  state.shipTypeIconFrames = {};
  markSimulatorStateDirty();
}

export function setShipTypeIconFrame(stype: number, frame: [number, number, number, number]): void {
  state.shipTypeIconFrames[stype] = frame;
  markSimulatorStateDirty();
}

export function setShipTypeSpriteSheetMeta(width: number, height: number): void {
  state.shipTypeSpriteSheetW = width;
  state.shipTypeSpriteSheetH = height;
  markSimulatorStateDirty();
}

export function setShipTypeSpriteSheetUrl(spriteSheetUrl: string): void {
  state.shipTypeSpriteSheetUrl = spriteSheetUrl;
  markSimulatorStateDirty();
}

export function setSlotItemEffects(slotItemEffects: SlotItemEffectsData | null): void {
  state.slotItemEffects = slotItemEffects;
  markSimulatorStateDirty();
}
