// ── Fleet snapshot application ──

import { state } from "./state";
import type { FleetSlot } from "./types";
import { emptyFleetSlot } from "./types";
import { computeEquipSum, computeEquipBonuses } from "./equip-calc";
import { renderAll } from "./airbase-renderer";
import { loadMasterDataFromJson } from "./data-loader";

export function applyFleetSnapshot(snapshot: Record<string, unknown>) {
  // Reset all fleets first so loading a smaller/older snapshot does not leave
  // stale ships in fleet3/fleet4 (or trailing slots in any fleet).
  [state.fleet1, state.fleet2, state.fleet3, state.fleet4].forEach((fleet) => {
    for (let i = 0; i < 6; i++) fleet[i] = emptyFleetSlot();
  });

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

  state.snapshotShips = {};
  state.snapshotSlotItems = slotItemMap;
  for (const s of ships) {
    const masterShipId = (s.s5d as number) ?? 0;
    const mst = state.mstShips[masterShipId];
    state.snapshotShips[s.i0d as number] = {
      shipId: masterShipId,
      level: (s.l0v as number) ?? 1,
      name: mst?.name ?? `Ship #${masterShipId}`,
      stype: mst?.stype ?? 0,
    };
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
        fleet[i] = emptyFleetSlot();
        continue;
      }
      const ship = shipMap[instanceId];
      if (!ship) {
        fleet[i] = emptyFleetSlot();
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

      fleet[i] = {
        shipId: masterShipId,
        shipLevel: (ship.l0v as number) ?? null,
        equipIds,
        equipImprovement,
        equipProficiency,
        exSlotId,
        exSlotImprovement,
        instanceStats: buildInstanceStats(ship, equipIds, exSlotId, equipImprovement, exSlotImprovement, masterShipId),
      };
    }
  }

  if (deckPorts.length > 0) {
    const sorted = [...deckPorts].sort((a, b) => ((a.i0d as number) ?? 0) - ((b.i0d as number) ?? 0));
    if (sorted[0]) {
      populateFleet(state.fleet1, (sorted[0].s3s as number[]) ?? []);
    }
    if (sorted[1]) {
      populateFleet(state.fleet2, (sorted[1].s3s as number[]) ?? []);
    }
    if (sorted[2]) {
      populateFleet(state.fleet3, (sorted[2].s3s as number[]) ?? []);
    }
    if (sorted[3]) {
      populateFleet(state.fleet4, (sorted[3].s3s as number[]) ?? []);
    }
  } else {
    // Legacy fallback
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

      state.fleet1[i] = {
        shipId: masterShipId,
        shipLevel: (ship.l0v as number) ?? null,
        equipIds,
        equipImprovement,
        equipProficiency,
        exSlotId,
        exSlotImprovement,
        instanceStats: buildInstanceStats(ship, equipIds, exSlotId, equipImprovement, exSlotImprovement, masterShipId),
      };
    }
  }

  renderAll();
}

export function applyExportedFleet(data: Record<string, unknown>) {
  // Same reset policy as snapshot load: imported data should be authoritative.
  [state.fleet1, state.fleet2, state.fleet3, state.fleet4].forEach((fleet) => {
    for (let i = 0; i < 6; i++) fleet[i] = emptyFleetSlot();
  });

  if (Array.isArray(data.fleet1)) {
    for (let i = 0; i < Math.min(data.fleet1.length, 6); i++) {
      const slot = data.fleet1[i] as FleetSlot;
      if (slot) {
        state.fleet1[i] = {
          shipId: slot.shipId ?? null,
          shipLevel: slot.shipLevel ?? null,
          equipIds: slot.equipIds ?? [null, null, null, null, null],
          equipImprovement: slot.equipImprovement ?? [0, 0, 0, 0, 0],
          equipProficiency: slot.equipProficiency ?? [0, 0, 0, 0, 0],
          exSlotId: slot.exSlotId ?? null,
          exSlotImprovement: slot.exSlotImprovement ?? 0,
        };
      }
    }
  }
  if (Array.isArray(data.fleet2)) {
    for (let i = 0; i < Math.min(data.fleet2.length, 6); i++) {
      const slot = data.fleet2[i] as FleetSlot;
      if (slot) {
        state.fleet2[i] = {
          shipId: slot.shipId ?? null,
          shipLevel: slot.shipLevel ?? null,
          equipIds: slot.equipIds ?? [null, null, null, null, null],
          equipImprovement: slot.equipImprovement ?? [0, 0, 0, 0, 0],
          equipProficiency: slot.equipProficiency ?? [0, 0, 0, 0, 0],
          exSlotId: slot.exSlotId ?? null,
          exSlotImprovement: slot.exSlotImprovement ?? 0,
        };
      }
    }
  }
  if (Array.isArray(data.fleet3)) {
    for (let i = 0; i < Math.min(data.fleet3.length, 6); i++) {
      const slot = data.fleet3[i] as FleetSlot;
      if (slot) {
        state.fleet3[i] = {
          shipId: slot.shipId ?? null,
          shipLevel: slot.shipLevel ?? null,
          equipIds: slot.equipIds ?? [null, null, null, null, null],
          equipImprovement: slot.equipImprovement ?? [0, 0, 0, 0, 0],
          equipProficiency: slot.equipProficiency ?? [0, 0, 0, 0, 0],
          exSlotId: slot.exSlotId ?? null,
          exSlotImprovement: slot.exSlotImprovement ?? 0,
        };
      }
    }
  }
  if (Array.isArray(data.fleet4)) {
    for (let i = 0; i < Math.min(data.fleet4.length, 6); i++) {
      const slot = data.fleet4[i] as FleetSlot;
      if (slot) {
        state.fleet4[i] = {
          shipId: slot.shipId ?? null,
          shipLevel: slot.shipLevel ?? null,
          equipIds: slot.equipIds ?? [null, null, null, null, null],
          equipImprovement: slot.equipImprovement ?? [0, 0, 0, 0, 0],
          equipProficiency: slot.equipProficiency ?? [0, 0, 0, 0, 0],
          exSlotId: slot.exSlotId ?? null,
          exSlotImprovement: slot.exSlotImprovement ?? 0,
        };
      }
    }
  }
  if (Array.isArray(data.airBases)) {
    for (let i = 0; i < Math.min(data.airBases.length, 3); i++) {
      const base = data.airBases[i] as { equipIds: (number | null)[]; equipImprovement?: number[]; equipProficiency?: number[] };
      if (base) {
        state.airBases[i] = {
          equipIds: base.equipIds ?? [null, null, null, null],
          equipImprovement: base.equipImprovement ?? [0, 0, 0, 0],
          equipProficiency: base.equipProficiency ?? [0, 0, 0, 0],
        };
      }
    }
  }
  if (data.masterData) {
    loadMasterDataFromJson(data.masterData, renderAll);
  }
  renderAll();
}
