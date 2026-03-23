import type { FleetSlot, MstShipData } from "./types";
import { getMasterShip } from "./simulator-selectors";

export type CombinedFleetType = 0 | 1 | 2 | 3;

type FleetCounts = number[];

export type CombinedFleetValidation = {
  ok: boolean;
  mainErrors: string[];
  escortErrors: string[];
};

const DD_CLASS = new Set([1, 2]);
const DD_ONLY = new Set([2]);
const CL_CLASS = new Set([3, 4]);
const CRUISER_OR_ABOVE = new Set([3, 4, 5, 6, 8, 9, 10]);
const HEAVY_CRUISER_CLASS = new Set([5, 6]);
const BATTLESHIP_CLASS = new Set([8, 9, 10]);
const CARRIER_CLASS = new Set([7, 11, 18]);
const REGULAR_CARRIER_CLASS = new Set([11, 18]);
const SEAPLANE_TENDER_CLASS = new Set([16]);
const BATTLESHIP_NO_AVIATION = new Set([8, 9]);
const SUBMARINE_CLASS = new Set([13, 14]);

function speedBucket(soku: number | null | undefined): 0 | 1 | 2 | 3 | 4 {
  const speed = Number(soku ?? 0);
  if (speed > 15) return 0;
  if (speed > 10) return 1;
  if (speed > 5) return 2;
  if (speed > 0) return 3;
  return 4;
}

function initCounts(): FleetCounts {
  return Array.from({ length: 100 }, () => 0);
}

function countShip(counts: FleetCounts, ship: MstShipData): void {
  const stype = ship.stype;
  counts[stype]++;
  if (DD_CLASS.has(stype)) counts[60]++;
  if (DD_ONLY.has(stype)) counts[51]++;
  if (CL_CLASS.has(stype)) counts[52]++;
  if (HEAVY_CRUISER_CLASS.has(stype)) counts[53]++;
  if (BATTLESHIP_CLASS.has(stype)) counts[54]++;
  if (CARRIER_CLASS.has(stype)) counts[55]++;
  if (REGULAR_CARRIER_CLASS.has(stype)) counts[57]++;
  if (SEAPLANE_TENDER_CLASS.has(stype)) counts[56]++;
  if (BATTLESHIP_NO_AVIATION.has(stype)) counts[59]++;
  if (SUBMARINE_CLASS.has(stype)) counts[61]++;
  if (CRUISER_OR_ABOVE.has(stype)) counts[58]++;

  const speedType = speedBucket(ship.soku);
  const isBattleship = stype === 8 || stype === 9 || stype === 10;
  const isSpecialFast =
    isBattleship &&
    [364, 733].includes(ship.id) &&
    [2, 1, 0].includes(speedType);
  const isFastBattleship =
    isBattleship &&
    ((speedType === 1 || speedType === 0) || isSpecialFast);
  const isSlowBattleship =
    (stype === 9 || stype === 10) &&
    [2, 3, 4].includes(speedType) &&
    !isSpecialFast;
  if (isFastBattleship) {
    counts[63]++;
  }
  if (isSlowBattleship) {
    counts[62]++;
  }
  if (stype === 7 && (ship.tais?.[0] ?? 0) > 0) {
    counts[64]++;
  }
}

function buildCounts(fleet: FleetSlot[]): FleetCounts {
  const counts = initCounts();
  for (const slot of fleet) {
    if (slot.shipId == null) continue;
    const ship = getMasterShip(slot.shipId);
    if (!ship) continue;
    countShip(counts, ship);
  }
  return counts;
}

function firstShip(fleet: FleetSlot[]): MstShipData | null {
  const shipId = fleet[0]?.shipId;
  return shipId != null ? getMasterShip(shipId) : null;
}

function validateEscortFleet(type: CombinedFleetType, fleet2: FleetSlot[]): string[] {
  const errors: string[] = [];
  if (type === 0) return errors;
  if (fleet2[0]?.shipId == null) {
    return ["第2艦隊が空です。"];
  }

  const counts = buildCounts(fleet2);
  const flagship = firstShip(fleet2);
  if (!flagship) return ["第2艦隊が空です。"];

  if (type === 1 || type === 2) {
    if (counts[3] < 1) errors.push("軽巡洋艦の配備が必要です。");
    if (counts[3] > 1) errors.push("軽巡洋艦を２隻以上配備できません。");
    if (counts[51] < 2) errors.push("駆逐艦２隻以上の配備が必要です。");
    if (counts[53] > 2) errors.push("重巡級を３隻以上配備できません。");
    if (counts[56] > 1) errors.push("水上機母艦を２隻以上配備できません。");
    if (counts[62] > 0) errors.push("低速戦艦は配備できません。");
    if (counts[63] > 2) errors.push("高速戦艦を３隻以上配備できません。");
    if (counts[57] > 0) errors.push("正規空母は配備できません。");
    if (counts[7] > 1) errors.push("軽空母を２隻以上配備できません。");
    if (flagship.stype === 13 || flagship.stype === 14) errors.push("連合艦隊旗艦は潜水艦不可です。");
    return errors;
  }

  if (type === 3) {
    if (counts[60] < 3) errors.push("警戒隊は3隻以上の駆逐級が必要です。");
    if (flagship.stype !== 3 && flagship.stype !== 21) errors.push("警戒隊は軽巡/練巡の旗艦が必要です。");
    if (counts[4] > 0) errors.push("警戒隊に重雷装艦は配備できません。");
    if (counts[55] > 0) errors.push("警戒隊に航空母艦は配備できません。");
    if (counts[54] > 0) errors.push("警戒隊に戦艦は配備できません。");
    if (counts[61] > 0) errors.push("警戒隊に潜水艦は配備できません。");
    if (counts[16] > 0) errors.push("警戒隊に水上機母艦は配備できません。");
    if (counts[17] > 0) errors.push("警戒隊に揚陸艦は配備できません。");
    if (counts[19] > 0) errors.push("警戒隊に工作艦は配備できません。");
    if (counts[20] > 0) errors.push("警戒隊に潜水母艦は配備できません。");
    if (counts[22] > 0) errors.push("警戒隊に補給艦は配備できません。");
    if (counts[5] + counts[6] > 2) errors.push("重巡/航巡を計３隻以上配備できません。");
    if (counts[3] + counts[21] > 2) errors.push("警戒隊への軽巡級配備は最大２隻！");
  }
  return errors;
}

function validateMainFleet(type: CombinedFleetType, fleet1: FleetSlot[]): string[] {
  const errors: string[] = [];
  if (type === 0) return errors;
  const counts = buildCounts(fleet1);
  const flagship = firstShip(fleet1);
  if (!flagship) return errors;

  if (type === 1) {
    if (counts[55] < 2) errors.push("空母２隻以上の配備が必要です。");
    if (counts[55] > 4) errors.push("空母５隻以上は配備できません。");
    if (counts[54] > 2) errors.push("戦艦３隻以上は配備できません。");
    if (flagship.stype === 13 || flagship.stype === 14) errors.push("連合艦隊旗艦は潜水艦不可です。");
    return errors;
  }

  if (type === 2) {
    if (counts[54] > 4) errors.push("戦艦５隻以上は配備できません。");
    if (counts[53] > 4) errors.push("重巡級５隻以上は配備できません。");
    if (counts[58] < 2) errors.push("複数の巡洋艦以上の艦艇が必要です。");
    if (counts[57] > 1) errors.push("複数の正規空母は配備できません。");
    if (counts[57] === 1 && counts[7] > 0) errors.push("正規空母を含む２隻以上の航空母艦を配備できません。");
    if (counts[57] === 0 && counts[7] > 2) errors.push("３隻以上の航空母艦は配備できません。");
    if (flagship.stype === 13 || flagship.stype === 14) errors.push("連合艦隊旗艦は潜水艦不可です。");
    return errors;
  }

  if (type === 3) {
    if (counts[60] < 4) errors.push("輸送本隊は駆逐級４隻以上が必要です。");
    if (counts[4] > 0) errors.push("輸送本隊に重雷装艦は配備できません。");
    if (counts[5] > 0) errors.push("輸送本隊に重巡洋艦は配備できません。");
    if (counts[57] > 0) errors.push("輸送本隊に航空母艦は配備できません。");
    if (counts[7] - counts[64] > 0) errors.push("輸送本隊に航空母艦は配備できません。");
    if (counts[59] > 0) errors.push("輸送本隊に戦艦は配備できません。");
    if (counts[61] > 0) errors.push("輸送本隊に潜水艦は配備できません。");
    if (counts[19] > 1) errors.push("工作艦を2隻以上配備できません。");
    if (counts[64] > 1) errors.push("輸送本隊への軽空母配備は最大１隻！");
  }

  return errors;
}

export function validateCombinedFleet(type: CombinedFleetType, fleet1: FleetSlot[], fleet2: FleetSlot[]): CombinedFleetValidation {
  const mainErrors = validateMainFleet(type, fleet1);
  const escortErrors = validateEscortFleet(type, fleet2);
  return {
    ok: mainErrors.length === 0 && escortErrors.length === 0,
    mainErrors,
    escortErrors,
  };
}

function buildCountsWithCandidate(
  fleet: FleetSlot[],
  shipSlotIndex: number,
  shipId: number | null,
): FleetCounts {
  const counts = initCounts();
  for (let index = 0; index < fleet.length; index++) {
    const slot = fleet[index];
    const effectiveShipId = index === shipSlotIndex ? shipId : slot.shipId;
    if (effectiveShipId == null) continue;
    const ship = getMasterShip(effectiveShipId);
    if (!ship) continue;
    countShip(counts, ship);
  }
  return counts;
}

export function canAssignShipWithoutWorseningCombinedRules(
  type: CombinedFleetType,
  fleet1: FleetSlot[],
  fleet2: FleetSlot[],
  fleetIndex: 1 | 2 | 3 | 4,
  shipSlotIndex: number,
  shipId: number | null,
): boolean {
  if (type === 0) return true;
  if (fleetIndex !== 1 && fleetIndex !== 2) return true;
  if (shipId == null) return true;

  const ship = getMasterShip(shipId);
  if (!ship) return false;
  const counts = buildCountsWithCandidate(fleetIndex === 1 ? fleet1 : fleet2, shipSlotIndex, shipId);
  const isFlagship = shipSlotIndex === 0;

  if (fleetIndex === 2) {
    if ((type === 1 || type === 2)) {
      if (isFlagship && (ship.stype === 13 || ship.stype === 14)) return false;
      if (counts[3] > 1) return false;
      if (counts[53] > 2) return false;
      if (counts[56] > 1) return false;
      if (counts[62] > 0) return false;
      if (counts[63] > 2) return false;
      if (counts[57] > 0) return false;
      if (counts[7] > 1) return false;
      return true;
    }
    if (type === 3) {
      if (isFlagship && ship.stype !== 3 && ship.stype !== 21) return false;
      if (ship.stype === 4) return false;
      if (CARRIER_CLASS.has(ship.stype)) return false;
      if (BATTLESHIP_CLASS.has(ship.stype)) return false;
      if (SUBMARINE_CLASS.has(ship.stype)) return false;
      if ([16, 17, 19, 20, 22].includes(ship.stype)) return false;
      if (counts[5] + counts[6] > 2) return false;
      if (counts[3] + counts[21] > 2) return false;
      return true;
    }
  }

  if (fleetIndex === 1) {
    if (type === 1) {
      if (isFlagship && (ship.stype === 13 || ship.stype === 14)) return false;
      if (counts[55] > 4) return false;
      if (counts[54] > 2) return false;
      return true;
    }
    if (type === 2) {
      if (isFlagship && (ship.stype === 13 || ship.stype === 14)) return false;
      if (counts[54] > 4) return false;
      if (counts[53] > 4) return false;
      if (counts[57] > 1) return false;
      if (counts[57] === 1 && counts[7] > 0) return false;
      if (counts[57] === 0 && counts[7] > 2) return false;
      return true;
    }
    if (type === 3) {
      if (ship.stype === 4) return false;
      if (ship.stype === 5) return false;
      if (REGULAR_CARRIER_CLASS.has(ship.stype)) return false;
      if (ship.stype === 7 && (ship.tais?.[0] ?? 0) <= 0) return false;
      if (BATTLESHIP_NO_AVIATION.has(ship.stype)) return false;
      if (SUBMARINE_CLASS.has(ship.stype)) return false;
      if (counts[19] > 1) return false;
      if (counts[64] > 1) return false;
      return true;
    }
  }

  return true;
}
