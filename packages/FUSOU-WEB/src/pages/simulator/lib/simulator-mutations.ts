// ── Centralized simulator state mutations ──

import { markSimulatorStateDirty, state } from "./state";
import type {
  AirBaseSlot,
  FleetSlot,
  MstEquipExslotShipData,
  MstEquipLimitExslotData,
  MstEquipShipData,
  MstShipData,
  MstSlotItemData,
  MstSlotItemEquipTypeData,
  MstStypeData,
  SlotItemEffectsData,
} from "./types";
import { emptyFleetSlot } from "./types";
import type {
  EquipModalSource,
  ShipModalSource,
  SideFilter,
} from "./simulator-selectors";

export * from "./simulator-selectors";

export function assignShipToFleetSlot(slot: FleetSlot, shipId: number | null): void {
  slot.shipId = shipId;
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
  slot.equipIds[equipIdx] = equipId;
  markSimulatorStateDirty("fleet");
}

export function cycleFleetExslotImprovement(slot: FleetSlot): void {
  const cur = slot.exSlotImprovement ?? 0;
  slot.exSlotImprovement = cur >= 10 ? 0 : cur + 1;
  markSimulatorStateDirty("fleet");
}

export function setFleetExslotEquip(slot: FleetSlot, equipId: number | null): void {
  slot.exSlotId = equipId;
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

export function setEquipModalTargetForFleet(slot: FleetSlot, equipIdx: number): void {
  state.equipModalTargetShipId = slot.shipId;
  state.equipModalTargetSlot = slot;
  state.equipModalTargetSlotIdx = equipIdx;
}

export function setEquipModalTargetForAirBase(): void {
  state.equipModalTargetShipId = null;
  state.equipModalTargetSlot = null;
  state.equipModalTargetSlotIdx = -1;
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
  base.equipIds[equipIdx] = equipId;
  markSimulatorStateDirty("airbase");
}

export function setFleetSectionCollapsed(index: number, collapsed: boolean): void {
  state.fleetSectionCollapsed[index] = collapsed;
  markSimulatorStateDirty("fleet");
}

export function toggleFleetSectionCollapsed(index: number): void {
  state.fleetSectionCollapsed[index] = !state.fleetSectionCollapsed[index];
  markSimulatorStateDirty("fleet");
}

export function setWorkspaceReadOnly(readOnly: boolean): void {
  state.isWorkspaceReadOnly = readOnly;
  markSimulatorStateDirty();
}

export function beginShipModalSession(
  currentId: number | null,
  cb: (id: number | null) => void,
): void {
  state.shipModalCb = cb;
  state.shipModalCurrentId = currentId;
}

export function setShipModalSideFilter(sideFilter: SideFilter): void {
  state.shipModalSideFilter = sideFilter;
}

export function setShipModalSource(source: ShipModalSource): void {
  state.shipModalSource = source;
}

export function consumeShipModalCallback(id: number | null): void {
  state.shipModalCb?.(id);
  state.shipModalCb = null;
}

export function beginEquipModalSession(
  currentId: number | null,
  cb: (id: number | null) => void,
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

export function consumeEquipModalCallback(id: number | null): void {
  state.equipModalCb?.(id);
  state.equipModalCb = null;
}

export function resetAllFleets(): void {
  [state.fleet1, state.fleet2, state.fleet3, state.fleet4].forEach((fleet) => {
    for (let i = 0; i < 6; i++) fleet[i] = emptyFleetSlot();
  });
  markSimulatorStateDirty("fleet");
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
  markSimulatorStateDirty();
}

export function replaceSnapshotSlotItems(
  slotItems: Record<number, { slotitem_id: number; level: number; alv: number }>,
): void {
  state.snapshotSlotItems = slotItems;
  markSimulatorStateDirty();
}

export function setSnapshotShipRecord(
  instanceId: number,
  ship: { shipId: number; level: number; name: string; stype: number },
): void {
  state.snapshotShips[instanceId] = ship;
  markSimulatorStateDirty();
}

export function setSnapshotSlotItemRecord(
  instanceId: number,
  slotItem: { slotitem_id: number; level: number; alv: number },
): void {
  state.snapshotSlotItems[instanceId] = slotItem;
  markSimulatorStateDirty();
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

export function setSlotItemEffects(slotItemEffects: SlotItemEffectsData | null): void {
  state.slotItemEffects = slotItemEffects;
  markSimulatorStateDirty();
}
