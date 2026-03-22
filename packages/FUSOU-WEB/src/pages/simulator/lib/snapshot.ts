// ── Fleet snapshot application ──

import type { FleetSlot } from "./types";
import { computeEquipSum, computeEquipBonuses } from "./equip-calc";
import { renderAll } from "./airbase-renderer";
import { loadMasterDataFromJson } from "./data-loader";
import { pickNumericRecord } from "./payload-codec";
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

  const ships = (snapshot as { s3s?: Record<string, unknown>[] }).s3s ?? [];
  const slotItems = (snapshot as { s8s?: Record<string, unknown>[] }).s8s ?? [];
  const deckPorts = (snapshot as { d8k?: Record<string, unknown>[] }).d8k ?? [];

  const slotItemMap: Record<number, { slotitem_id: number; level: number; alv: number }> = {};
  for (const si of slotItems) {
    const iid = si.i0d as number;
    slotItemMap[iid] = {
      slotitem_id: (si.s9d as number) ?? 0,
      level: (si.l3l as number) ?? 0,
      alv: (si.a1v as number) ?? 0,
    };
  }

  const shipMap: Record<number, Record<string, unknown>> = {};
  for (const s of ships) {
    shipMap[s.i0d as number] = s;
  }

  clearSnapshotData();
  replaceSnapshotSlotItems(slotItemMap);
  for (const s of ships) {
    const masterShipId = (s.s5d as number) ?? 0;
    const mst = getMasterShip(masterShipId);
    setSnapshotShipRecord(s.i0d as number, {
      shipId: masterShipId,
      level: (s.l0v as number) ?? 1,
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
    return {
      houg: ((ship.k5u as number) ?? 0) - (snapEqSum.houg || 0) - (snapBonus.houg || 0),
      raig: ((ship.r4u as number) ?? 0) - (snapEqSum.raig || 0) - (snapBonus.raig || 0),
      tyku: ((ship.t3u as number) ?? 0) - (snapEqSum.tyku || 0) - (snapBonus.tyku || 0),
      souk: ((ship.s4u as number) ?? 0) - (snapEqSum.souk || 0) - (snapBonus.souk || 0),
      kaih: ((ship.k3i as number) ?? 0) - (snapEqSum.kaih || 0) - (snapBonus.kaih || 0),
      tais: ((ship.t4n as number) ?? 0) - (snapEqSum.tais || 0) - (snapBonus.tais || 0),
      saku: ((ship.s6i as number) ?? 0) - (snapEqSum.saku || 0) - (snapBonus.saku || 0),
      luck: ((ship.l3y as number) ?? 0) - (snapEqSum.luck || 0) - (snapBonus.luck || 0),
    };
  }

  function populateFleet(fleet: FleetSlot[], shipIds: number[]) {
    for (let i = 0; i < Math.min(shipIds.length, 6); i++) {
      const instanceId = shipIds[i];
      if (instanceId <= 0) {
        continue;
      }
      const ship = shipMap[instanceId];
      if (!ship) {
        continue;
      }

      const masterShipId = (ship.s5d as number) ?? 0;
      const slots = (ship.s2t as number[]) ?? [];
      const exSlotInstanceId = (ship.s5x as number) ?? 0;

      const equipIds: (number | null)[] = [null, null, null, null, null];
      const equipImprovement: number[] = [0, 0, 0, 0, 0];
      const equipProficiency: number[] = [0, 0, 0, 0, 0];

      for (let j = 0; j < Math.min(slots.length, 5); j++) {
        const slotInstanceId = slots[j];
        if (slotInstanceId <= 0) continue;
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
        shipLevel: (ship.l0v as number) ?? null,
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
    const sorted = [...deckPorts].sort((a, b) => ((a.i0d as number) ?? 0) - ((b.i0d as number) ?? 0));
    if (sorted[0]) {
      populateFleet(fleet1, (sorted[0].s3s as number[]) ?? []);
    }
    if (sorted[1]) {
      populateFleet(fleet2, (sorted[1].s3s as number[]) ?? []);
    }
    if (sorted[2]) {
      populateFleet(fleet3, (sorted[2].s3s as number[]) ?? []);
    }
    if (sorted[3]) {
      populateFleet(fleet4, (sorted[3].s3s as number[]) ?? []);
    }
  } else {
    // Legacy fallback
    const { fleet1 } = getFleetState();
    for (let i = 0; i < Math.min(ships.length, 6); i++) {
      const ship = ships[i];
      if (!ship) continue;
      const masterShipId = (ship.s5d as number) ?? 0;
      const slots = (ship.s2t as number[]) ?? [];

      const equipIds: (number | null)[] = [null, null, null, null, null];
      const equipImprovement: number[] = [0, 0, 0, 0, 0];
      const equipProficiency: number[] = [0, 0, 0, 0, 0];

      for (let j = 0; j < Math.min(slots.length, 5); j++) {
        const slotInstanceId = slots[j];
        if (slotInstanceId <= 0) continue;
        const si = slotItemMap[slotInstanceId];
        if (!si) continue;
        equipIds[j] = si.slotitem_id;
        equipImprovement[j] = si.level;
        equipProficiency[j] = si.alv;
      }

      const exSlotInstanceId = (ship.s5x as number) ?? 0;
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
        shipLevel: (ship.l0v as number) ?? null,
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
  const rawC11g = (snapshot as Record<string, unknown>).c11g;
  const combinedType = (typeof rawC11g === "number" && [0, 1, 2, 3].includes(rawC11g))
    ? (rawC11g as 0 | 1 | 2 | 3)
    : 0;
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

  function applyFleetArray(src: unknown, dst: FleetSlot[]) {
    if (!Array.isArray(src)) return;
    for (let i = 0; i < Math.min(src.length, 6); i++) {
      const slot = src[i] as FleetSlot;
      if (!slot) continue;

      const statOverrides = pickNumericRecord((slot as FleetSlot).statOverrides);
      const instanceStats = pickNumericRecord((slot as FleetSlot).instanceStats);

      replaceFleetSlot(dst, i, {
        shipId: slot.shipId ?? null,
        shipLevel: slot.shipLevel ?? null,
        equipIds: slot.equipIds ?? [null, null, null, null, null],
        equipImprovement: slot.equipImprovement ?? [0, 0, 0, 0, 0],
        equipProficiency: slot.equipProficiency ?? [0, 0, 0, 0, 0],
        exSlotId: slot.exSlotId ?? null,
        exSlotImprovement: slot.exSlotImprovement ?? 0,
        ...(statOverrides ? { statOverrides } : {}),
        ...(instanceStats ? { instanceStats } : {}),
      });
    }
  }

  const { fleet1, fleet2, fleet3, fleet4 } = getFleetState();
  applyFleetArray(data.fleet1, fleet1);
  applyFleetArray(data.fleet2, fleet2);
  applyFleetArray(data.fleet3, fleet3);
  applyFleetArray(data.fleet4, fleet4);

  if (data.snapshotShips && typeof data.snapshotShips === "object") {
    for (const [k, v] of Object.entries(data.snapshotShips as Record<string, unknown>)) {
      const rec = v as Record<string, unknown>;
      const iid = Number(k);
      if (!Number.isFinite(iid)) continue;
      const shipId = Number(rec.shipId ?? 0);
      const level = Number(rec.level ?? 1);
      const stype = Number(rec.stype ?? 0);
      const name = typeof rec.name === "string" ? rec.name : `Ship #${shipId}`;
      if (!Number.isFinite(shipId)) continue;
      setSnapshotShipRecord(iid, {
        shipId,
        level: Number.isFinite(level) ? level : 1,
        name,
        stype: Number.isFinite(stype) ? stype : 0,
      });
    }
  }

  if (data.snapshotSlotItems && typeof data.snapshotSlotItems === "object") {
    for (const [k, v] of Object.entries(data.snapshotSlotItems as Record<string, unknown>)) {
      const rec = v as Record<string, unknown>;
      const iid = Number(k);
      if (!Number.isFinite(iid)) continue;
      const slotitem_id = Number(rec.slotitem_id ?? 0);
      const level = Number(rec.level ?? 0);
      const alv = Number(rec.alv ?? 0);
      if (!Number.isFinite(slotitem_id)) continue;
      setSnapshotSlotItemRecord(iid, {
        slotitem_id,
        level: Number.isFinite(level) ? level : 0,
        alv: Number.isFinite(alv) ? alv : 0,
      });
    }
  }

  if (Array.isArray(data.airBases)) {
    for (let i = 0; i < Math.min(data.airBases.length, 3); i++) {
      const base = data.airBases[i] as { equipIds: (number | null)[]; equipImprovement?: number[]; equipProficiency?: number[] };
      if (base) {
        replaceAirBaseSlot(i, {
          equipIds: base.equipIds ?? [null, null, null, null],
          equipImprovement: base.equipImprovement ?? [0, 0, 0, 0],
          equipProficiency: base.equipProficiency ?? [0, 0, 0, 0],
        });
      }
    }
  }
  if (data.masterData) {
    loadMasterDataFromJson(data.masterData, renderAll);
  }
  } finally {
    endBulkLoad("all");
  }

  // Apply combined fleet type
  const rawCombined = data.combinedFleetType;
  const combinedType = (typeof rawCombined === "number" && [0, 1, 2, 3].includes(rawCombined))
    ? (rawCombined as 0 | 1 | 2 | 3)
    : 0;
  setCombinedFleetType(combinedType);

  // Apply per-fleet formation selections
  if (data.fleetFormations && typeof data.fleetFormations === "object") {
    const fms = data.fleetFormations as Record<string, unknown>;
    for (const k of [1, 2, 3, 4] as const) {
      const v = fms[String(k)];
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
