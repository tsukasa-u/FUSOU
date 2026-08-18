// ── Fleet snapshot application ──

import type { FleetSlot } from "./types";
import { computeEquipSum, computeEquipBonuses } from "./equip-calc";
import { renderAll } from "./airbase-renderer";
import { loadMasterDataFromJson } from "./data-loader";
import {
  combinedFleetTypeOrDefault,
  finiteNumberOrNull,
  jsonRecordOf,
  jsonRecordsOf,
  nullableNumberArray,
  pickNumericRecord,
} from "./payload-codec";
import { beginBulkLoad, endBulkLoad } from "./state";
import {
  clearSnapshotData,
  replaceAirBaseSlot,
  replaceFleetSlot,
  replaceSnapshotSlotItems,
  resetAllAirBases,
  resetAllFleets,
  setCombinedFleetType,
  setFleetFormation,
  setSnapshotShipRecord,
  setSnapshotSlotItemRecord,
} from "./simulator-mutations";
import { getFleetState, getMasterShip } from "./simulator-selectors";

export function applyFleetSnapshot(snapshot: Record<string, unknown>) {
  beginBulkLoad();
  try {
  // Reset all fleets first so loading a smaller/older snapshot does not leave
  // stale ships in fleet3/fleet4 (or trailing slots in any fleet).
  resetAllFleets();
  // Snapshot payloads do not carry airbase loadouts; clear stale bases as well.
  resetAllAirBases();

  const ships = jsonRecordsOf(snapshot["s3s"]);
  const slotItems = jsonRecordsOf(snapshot["s8s"]);
  const deckPorts = jsonRecordsOf(snapshot["d8k"]);

  const slotItemMap: Record<number, { slotitem_id: number; level: number; alv: number }> = {};
  for (const si of slotItems) {
    const iid = finiteNumberOrNull(si["i0d"]);
    if (iid === null) continue;
    slotItemMap[iid] = {
      slotitem_id: finiteNumberOrNull(si["s9d"]) ?? 0,
      level: finiteNumberOrNull(si["l3l"]) ?? 0,
      alv: finiteNumberOrNull(si["a1v"]) ?? 0,
    };
  }

  const shipMap: Record<number, Record<string, unknown>> = {};
  for (const s of ships) {
    const iid = finiteNumberOrNull(s["i0d"]);
    if (iid !== null) shipMap[iid] = s;
  }

  clearSnapshotData();
  replaceSnapshotSlotItems(slotItemMap);
  for (const s of ships) {
    const instanceId = finiteNumberOrNull(s["i0d"]);
    const masterShipId = finiteNumberOrNull(s["s5d"]);
    if (instanceId === null || masterShipId === null) continue;
    const mst = getMasterShip(masterShipId);
    setSnapshotShipRecord(instanceId, {
      shipId: masterShipId,
      level: finiteNumberOrNull(s["l0v"]) ?? 1,
      name: mst?.name ?? `Ship #${masterShipId}`,
      stype: mst?.stype ?? 0,
    });
  }

  function buildInstanceStats(
    ship: Record<string, unknown>,
    equipIds: (number | null)[],
    exSlotId: number | null,
    equipImprovement: number[],
    exSlotImprovement: number,
    masterShipId: number,
  ) {
    const snapEqSum = computeEquipSum(equipIds, exSlotId);
    const snapBonus = computeEquipBonuses(
      masterShipId,
      equipIds,
      exSlotId,
      equipImprovement,
      exSlotImprovement,
    );
    const statSources = [
      ["houg", "k5u"],
      ["raig", "r4u"],
      ["tyku", "t3u"],
      ["souk", "s4u"],
      ["kaih", "k3i"],
      ["tais", "t4n"],
      ["saku", "s6i"],
      ["luck", "l3y"],
    ] as const;
    const instanceStats: Record<string, number> = {};
    for (const [stat, source] of statSources) {
      const raw = finiteNumberOrNull(ship[source]);
      if (raw === null) continue;
      instanceStats[stat] =
        raw - (snapEqSum[stat] || 0) - (snapBonus[stat] || 0);
    }
    return instanceStats;
  }

  function populateFleet(fleet: FleetSlot[], shipIds: Array<number | null>) {
    for (let i = 0; i < Math.min(shipIds.length, 6); i++) {
      const instanceId = shipIds[i];
      if (instanceId == null || instanceId <= 0) {
        continue;
      }
      const ship = shipMap[instanceId];
      if (!ship) {
        continue;
      }

      const masterShipId = finiteNumberOrNull(ship["s5d"]);
      if (masterShipId === null) continue;
      const slots = nullableNumberArray(ship["s2t"]);
      const exSlotInstanceId = finiteNumberOrNull(ship["s5x"]) ?? 0;

      const equipIds: (number | null)[] = [null, null, null, null, null];
      const equipImprovement: number[] = [0, 0, 0, 0, 0];
      const equipProficiency: number[] = [0, 0, 0, 0, 0];

      for (let j = 0; j < Math.min(slots.length, 5); j++) {
        const slotInstanceId = slots[j];
        if (slotInstanceId == null || slotInstanceId <= 0) continue;
        const si = slotItemMap[slotInstanceId];
        if (!si) continue;
        equipIds[j] = si.slotitem_id;
        equipImprovement[j] = si.level;
        equipProficiency[j] = si.alv;
      }

      let exSlotId: number | null = null;
      let exSlotImprovement = 0;
      if (exSlotInstanceId > 0) {
        const exSi = slotItemMap[exSlotInstanceId];
        if (exSi) {
          exSlotId = exSi.slotitem_id;
          exSlotImprovement = exSi.level;
        }
      }

      replaceFleetSlot(fleet, i, {
        shipId: masterShipId,
        shipLevel: finiteNumberOrNull(ship["l0v"]),
        equipIds,
        equipImprovement,
        equipProficiency,
        exSlotId,
        exSlotImprovement,
        instanceStats: buildInstanceStats(ship, equipIds, exSlotId, equipImprovement, exSlotImprovement, masterShipId),
      });
    }
  }

  if (deckPorts.length > 0) {
    const { fleet1, fleet2, fleet3, fleet4 } = getFleetState();
    const sorted = [...deckPorts].sort(
      (a, b) =>
        (finiteNumberOrNull(a["i0d"]) ?? Number.MAX_SAFE_INTEGER) -
        (finiteNumberOrNull(b["i0d"]) ?? Number.MAX_SAFE_INTEGER),
    );
    if (sorted[0]) {
      populateFleet(fleet1, nullableNumberArray(sorted[0]["s3s"]));
    }
    if (sorted[1]) {
      populateFleet(fleet2, nullableNumberArray(sorted[1]["s3s"]));
    }
    if (sorted[2]) {
      populateFleet(fleet3, nullableNumberArray(sorted[2]["s3s"]));
    }
    if (sorted[3]) {
      populateFleet(fleet4, nullableNumberArray(sorted[3]["s3s"]));
    }
  } else {
    // Legacy fallback
    const { fleet1 } = getFleetState();
    for (let i = 0; i < Math.min(ships.length, 6); i++) {
      const ship = ships[i];
      if (!ship) continue;
      const masterShipId = finiteNumberOrNull(ship["s5d"]);
      if (masterShipId === null) continue;
      const slots = nullableNumberArray(ship["s2t"]);

      const equipIds: (number | null)[] = [null, null, null, null, null];
      const equipImprovement: number[] = [0, 0, 0, 0, 0];
      const equipProficiency: number[] = [0, 0, 0, 0, 0];

      for (let j = 0; j < Math.min(slots.length, 5); j++) {
        const slotInstanceId = slots[j];
        if (slotInstanceId == null || slotInstanceId <= 0) continue;
        const si = slotItemMap[slotInstanceId];
        if (!si) continue;
        equipIds[j] = si.slotitem_id;
        equipImprovement[j] = si.level;
        equipProficiency[j] = si.alv;
      }

      const exSlotInstanceId = finiteNumberOrNull(ship["s5x"]) ?? 0;
      let exSlotId: number | null = null;
      let exSlotImprovement = 0;
      if (exSlotInstanceId > 0) {
        const exSi = slotItemMap[exSlotInstanceId];
        if (exSi) {
          exSlotId = exSi.slotitem_id;
          exSlotImprovement = exSi.level;
        }
      }

      replaceFleetSlot(fleet1, i, {
        shipId: masterShipId,
        shipLevel: finiteNumberOrNull(ship["l0v"]),
        equipIds,
        equipImprovement,
        equipProficiency,
        exSlotId,
        exSlotImprovement,
        instanceStats: buildInstanceStats(ship, equipIds, exSlotId, equipImprovement, exSlotImprovement, masterShipId),
      });
    }
  }

  } finally {
    endBulkLoad("all");
  }

  // Apply combined fleet type from c11g (api_combined_flag)
  const rawC11g = snapshot["c11g"];
  const combinedType = combinedFleetTypeOrDefault(rawC11g);
  setCombinedFleetType(combinedType);
  setFleetFormation(1, 0);
  setFleetFormation(2, 0);
  setFleetFormation(3, 0);
  setFleetFormation(4, 0);

  renderAll();
}

export function applyExportedFleet(data: Record<string, unknown>) {
  beginBulkLoad();
  try {
  // Same reset policy as snapshot load: imported data should be authoritative.
  resetAllFleets();
  // Some legacy or external payloads don't include airBases; clear stale bases first.
  resetAllAirBases();
  clearSnapshotData();

  const fixedNullableSlots = (value: unknown, length: number) => {
    const source = nullableNumberArray(value);
    return Array.from({ length }, (_, index) => source[index] ?? null);
  };

  const fixedNumberSlots = (value: unknown, length: number) =>
    fixedNullableSlots(value, length).map((item) => item ?? 0);

  function parseFleetSlot(value: unknown): FleetSlot | null {
    const slot = jsonRecordOf(value);
    if (!slot) return null;
    const statOverrides = pickNumericRecord(slot["statOverrides"]);
    const instanceStats = pickNumericRecord(slot["instanceStats"]);
    return {
      shipId: finiteNumberOrNull(slot["shipId"]),
      shipLevel: finiteNumberOrNull(slot["shipLevel"]),
      equipIds: fixedNullableSlots(slot["equipIds"], 5),
      equipImprovement: fixedNumberSlots(slot["equipImprovement"], 5),
      equipProficiency: fixedNumberSlots(slot["equipProficiency"], 5),
      exSlotId: finiteNumberOrNull(slot["exSlotId"]),
      exSlotImprovement: finiteNumberOrNull(slot["exSlotImprovement"]) ?? 0,
      ...(statOverrides ? { statOverrides } : {}),
      ...(instanceStats ? { instanceStats } : {}),
    };
  }

  function applyFleetArray(src: unknown, dst: FleetSlot[]) {
    if (!Array.isArray(src)) return;
    for (let i = 0; i < Math.min(src.length, 6); i++) {
      const slot = parseFleetSlot(src[i]);
      if (slot) replaceFleetSlot(dst, i, slot);
    }
  }

  const { fleet1, fleet2, fleet3, fleet4 } = getFleetState();
  applyFleetArray(data["fleet1"], fleet1);
  applyFleetArray(data["fleet2"], fleet2);
  applyFleetArray(data["fleet3"], fleet3);
  applyFleetArray(data["fleet4"], fleet4);

  if (data["snapshotShips"] && typeof data["snapshotShips"] === "object") {
    const snapshotShips = jsonRecordOf(data["snapshotShips"]);
    for (const [k, v] of Object.entries(snapshotShips ?? {})) {
      const rec = jsonRecordOf(v);
      if (!rec) continue;
      const iid = finiteNumberOrNull(k);
      if (iid === null) continue;
      const shipId = finiteNumberOrNull(rec["shipId"]);
      if (shipId === null) continue;
      const level = finiteNumberOrNull(rec["level"]) ?? 1;
      const stype = finiteNumberOrNull(rec["stype"]) ?? 0;
      const name = typeof rec["name"] === "string" ? rec["name"] : `Ship #${shipId}`;
      setSnapshotShipRecord(iid, {
        shipId,
        level,
        name,
        stype,
      });
    }
  }

  if (data["snapshotSlotItems"] && typeof data["snapshotSlotItems"] === "object") {
    const snapshotSlotItems = jsonRecordOf(data["snapshotSlotItems"]);
    for (const [k, v] of Object.entries(snapshotSlotItems ?? {})) {
      const rec = jsonRecordOf(v);
      if (!rec) continue;
      const iid = finiteNumberOrNull(k);
      const slotitem_id = finiteNumberOrNull(rec["slotitem_id"]);
      if (iid === null || slotitem_id === null) continue;
      const level = finiteNumberOrNull(rec["level"]) ?? 0;
      const alv = finiteNumberOrNull(rec["alv"]) ?? 0;
      setSnapshotSlotItemRecord(iid, {
        slotitem_id,
        level,
        alv,
      });
    }
  }

  if (Array.isArray(data["airBases"])) {
    const airBases = data["airBases"];
    for (let i = 0; i < Math.min(airBases.length, 3); i++) {
      const base = jsonRecordOf(airBases[i]);
      if (base) {
        replaceAirBaseSlot(i, {
          equipIds: fixedNullableSlots(base["equipIds"], 4),
          equipImprovement: fixedNumberSlots(base["equipImprovement"], 4),
          equipProficiency: fixedNumberSlots(base["equipProficiency"], 4),
        });
      }
    }
  }
  if (data["masterData"]) {
    loadMasterDataFromJson(data["masterData"], renderAll);
  }
  } finally {
    endBulkLoad("all");
  }

  // Apply combined fleet type
  const rawCombined = data["combinedFleetType"];
  const combinedType = combinedFleetTypeOrDefault(rawCombined);
  setCombinedFleetType(combinedType);

  // Apply per-fleet formation selections
  if (data["fleetFormations"] && typeof data["fleetFormations"] === "object") {
    const fms = jsonRecordOf(data["fleetFormations"]);
    for (const k of [1, 2, 3, 4] as const) {
      const v = fms?.[String(k)];
      setFleetFormation(k, (typeof v === "number" && Number.isFinite(v)) ? Math.trunc(v) : 0);
    }
  } else {
    setFleetFormation(1, 0);
    setFleetFormation(2, 0);
    setFleetFormation(3, 0);
    setFleetFormation(4, 0);
  }

  renderAll();
}
