/** @jsxImportSource solid-js */

import { Index, Show, createContext, createEffect, createMemo, createSignal, onMount, useContext, type JSX } from "solid-js";
import { useStore } from "@nanostores/solid";
import { render } from "solid-js/web";
import type { AirBaseSlot, FleetSlot } from "../../../pages/simulator/lib/types";
import { AIRCRAFT_TYPES, RANGE_NAMES, SPEED_NAMES, STYPE_SHORT } from "../../../pages/simulator/lib/constants";
import { cardUrl, computeEquipBonuses, computeEquipSum, createWeaponIconEl } from "../../../pages/simulator/lib/equip-calc";
import { prefetchExternalUrlForExport } from "../../../pages/simulator/lib/image-capture";
import { openShipModal } from "../../../pages/simulator/lib/ship-modal";
import { openEquipModal } from "../../../pages/simulator/lib/equip-modal";
import {
  applyAirBaseEquipSelection,
  applyFleetEquipSelection,
  applyFleetExslotSelection,
  applyShipSelectionToFleetSlot,
  assignShipToFleetSlot,
  cycleAirBaseEquipImprovement,
  cycleAirBaseEquipProficiency,
  cycleFleetEquipImprovement,
  cycleFleetEquipProficiency,
  cycleFleetExslotImprovement,
  ensureFleetStatOverrides,
  setAirBaseEquip,
  setFleetEquip,
  setFleetExslotEquip,
  setEquipModalTargetForAirBase,
  setEquipModalTargetForFleet,
  setShipModalTargetForFleet,
} from "../../../pages/simulator/lib/simulator-mutations";
import {
  markSimulatorStateDirty,
  simulatorFleetState,
  simulatorAirbaseState,
  type SimulatorDirtyScope,
} from "../../../pages/simulator/lib/state";
import {
  getAirBaseState,
  getFleetState,
  getMasterShip,
  getMasterSlotItem,
  isWorkspaceReadOnly,
} from "../../../pages/simulator/lib/simulator-selectors";


let mounted = false;
const prefetchedCardUrls = new Set<string>();
const FLEET_SLOT_INDEXES = [0, 1, 2, 3, 4, 5] as const;
const FLEET_EQUIP_SLOT_INDEXES = [0, 1, 2, 3, 4] as const;
const AIRBASE_INDEXES = [0, 1, 2] as const;
const AIRBASE_EQUIP_SLOT_INDEXES = [0, 1, 2, 3] as const;

const isReadOnly = () => isWorkspaceReadOnly();

function prefetchCardOnce(url: string): void {
  if (prefetchedCardUrls.has(url)) return;
  prefetchedCardUrls.add(url);
  prefetchExternalUrlForExport(url);
}

function ProfBadge(props: { level: number; hovered?: boolean }): JSX.Element {
  const symbols = ["|", "|", "||", "|||", "\\", "\\\\", "\\\\\\", ">>"];
  const color = createMemo(() =>
    props.level <= 3 ? "#1976d2" : props.level <= 6 ? "#f57c00" : "#e65100"
  );
  const opacity = createMemo(() => {
    if (props.level === 0) return props.hovered ? "0.25" : "0";
    return "1";
  });

  return (
    <span
      class="shrink-0 cursor-pointer select-none text-[11px] leading-none font-bold mr-0.5 inline-block w-[2em] text-center"
      style={{
        color: color(),
        "text-shadow": "0 0 3px rgba(255,255,255,0.9), 0 0 6px rgba(255,255,255,0.7)",
        opacity: opacity(),
        transition: "opacity 0.15s",
      }}
    >
      {symbols[props.level] ?? ">>"}
    </span>
  );
}

function ImpBadge(props: { level: number; hovered?: boolean }): JSX.Element {
  const opacity = createMemo(() => {
    if (props.level === 0) return props.hovered ? "0.25" : "0";
    return "1";
  });
  return (
    <span
      class="shrink-0 cursor-pointer select-none text-[11px] leading-none font-bold inline-block w-[2.5em] text-right"
      style={{
        color: "#00897b",
        "text-shadow": "0 0 3px rgba(255,255,255,0.9), 0 0 6px rgba(255,255,255,0.7)",
        opacity: opacity(),
        transition: "opacity 0.15s",
      }}
    >
      {props.level > 0 ? `★${props.level}` : "★"}
    </span>
  );
}

function WeaponIcon(props: { iconNum: number }): JSX.Element {
  let host!: HTMLSpanElement;

  onMount(() => {
    host.replaceChildren(createWeaponIconEl(props.iconNum, 16));
  });

  createMemo(() => {
    props.iconNum;
    if (!host) return;
    host.replaceChildren(createWeaponIconEl(props.iconNum, 16));
  });

  return <span ref={host} class="shrink-0 inline-flex" />;
}

function DeleteIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" class="w-3.5 h-3.5">
      <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.95" stroke-linecap="round" />
    </svg>
  );
}

type StatDef = [label: string, key: string, base: number | null, max: number | null, isNumeric: boolean];

interface ShipCardContextValue {
  fleetIndex: 1 | 2 | 3 | 4;
  idx: number;
}

const ShipCardContext = createContext<ShipCardContextValue>();

function useShipCardContext(): ShipCardContextValue {
  const ctx = useContext(ShipCardContext);
  if (!ctx) throw new Error("ShipCardContext is not available");
  return ctx;
}

function getLiveFleet(fleetIndex: 1 | 2 | 3 | 4): FleetSlot[] {
  const fleets = getFleetState();
  return fleetIndex === 1
    ? fleets.fleet1
    : fleetIndex === 2
    ? fleets.fleet2
    : fleetIndex === 3
    ? fleets.fleet3
    : fleets.fleet4;
}

function getLiveFleetSlot(fleetIndex: 1 | 2 | 3 | 4, idx: number): FleetSlot {
  return getLiveFleet(fleetIndex)[idx];
}

function getLiveAirBase(index: number): AirBaseSlot {
  return getAirBaseState()[index];
}

function applyShipSelectionAt(
  fleetIndex: 1 | 2 | 3 | 4,
  shipSlotIndex: number,
  selection: Parameters<typeof applyShipSelectionToFleetSlot>[1],
): void {
  const targetSlot = getLiveFleetSlot(fleetIndex, shipSlotIndex);
  if (!targetSlot) return;
  applyShipSelectionToFleetSlot(targetSlot, selection);
}

function applyFleetEquipSelectionAt(
  fleetIndex: 1 | 2 | 3 | 4,
  shipSlotIndex: number,
  equipSlotIndex: number,
  selection: Parameters<typeof applyFleetEquipSelection>[2],
): void {
  const targetSlot = getLiveFleetSlot(fleetIndex, shipSlotIndex);
  if (!targetSlot) return;
  applyFleetEquipSelection(targetSlot, equipSlotIndex, selection);
}

function applyFleetExslotSelectionAt(
  fleetIndex: 1 | 2 | 3 | 4,
  shipSlotIndex: number,
  selection: Parameters<typeof applyFleetExslotSelection>[1],
): void {
  const targetSlot = getLiveFleetSlot(fleetIndex, shipSlotIndex);
  if (!targetSlot) return;
  applyFleetExslotSelection(targetSlot, selection);
}

function applyAirBaseEquipSelectionAt(
  airBaseIndex: number,
  equipSlotIndex: number,
  selection: Parameters<typeof applyAirBaseEquipSelection>[2],
): void {
  const targetBase = getLiveAirBase(airBaseIndex);
  if (!targetBase) return;
  applyAirBaseEquipSelection(targetBase, equipSlotIndex, selection);
}

function computeAirbaseActionRadius(base: AirBaseSlot): {
  baseRadius: number;
  bonus: number;
  finalRadius: number;
} {
  const equipped = base.equipIds
    .map((id) => (id != null ? getMasterSlotItem(id) : null))
    .filter((e): e is NonNullable<ReturnType<typeof getMasterSlotItem>> => e != null);

  const sortieAircraft = equipped.filter((e) => AIRCRAFT_TYPES.has(e.type?.[2] ?? -1) && (e.distance ?? 0) > 0);
  if (sortieAircraft.length === 0) {
    return { baseRadius: 0, bonus: 0, finalRadius: 0 };
  }

  const baseRadius = Math.min(...sortieAircraft.map((e) => e.distance ?? 0));

  // Large flying boat (type 41) extends operational radius.
  const largeFlyingBoats = equipped.filter((e) => (e.type?.[2] ?? -1) === 41 && (e.distance ?? 0) > 0);
  let bonus = 0;
  if (largeFlyingBoats.length > 0) {
    const supportMax = Math.max(...largeFlyingBoats.map((e) => e.distance ?? 0));
    bonus = Math.max(0, Math.min(3, Math.floor((supportMax - baseRadius) / 2)));
  }

  return {
    baseRadius,
    bonus,
    finalRadius: baseRadius + bonus,
  };
}

function StatCell(props: {
  label: string;
  keyName: string;
  base: number | null;
  max: number | null;
  isNumeric: boolean;
  equipSums: Record<string, number>;
  equipBonuses: Record<string, number>;
}): JSX.Element {
  const card = useShipCardContext();
  const overrides = ensureFleetStatOverrides(getLiveFleetSlot(card.fleetIndex, card.idx));
  const [editing, setEditing] = createSignal(false);

  const currentNumericVal = (key: string, base: number | null): number => overrides[key] ?? base ?? 0;

  const formatStatVal = (): string => {
    const ov = overrides[props.keyName];
    const baseVal = ov ?? props.base;
    if (baseVal == null) return "—";

    const bonusContrib = props.equipBonuses[props.keyName] || 0;
    const total =
      props.keyName === "leng"
        ? Math.max(baseVal, props.equipSums.leng || 0) + bonusContrib
        : baseVal + (props.equipSums[props.keyName] || 0) + bonusContrib;

    if (!props.isNumeric && props.keyName === "soku") return SPEED_NAMES[total] ?? String(total);
    if (!props.isNumeric && props.keyName === "leng") return RANGE_NAMES[total] ?? String(total);
    return String(total);
  };

  const updateDelta = (sign: 1 | -1): void => {
    if (isReadOnly()) return;
    if (props.base == null && overrides[props.keyName] == null) return;

    const cur = currentNumericVal(props.keyName, props.base);
    const lo = props.base ?? 0;
    const hi = props.max ?? 9999;
    const step = props.keyName === "soku" ? 5 : 1;
    const next = Math.max(lo, Math.min(hi, cur + step * sign));

    if (next === props.base) delete overrides[props.keyName];
    else overrides[props.keyName] = next;

    markSimulatorStateDirty("fleet");
  };

  const bonusInfo = createMemo(() => {
    const eqStatVal = props.equipSums[props.keyName] || 0;
    const bonusVal = props.equipBonuses[props.keyName] || 0;
    const baseForDisplay = currentNumericVal(props.keyName, props.base);
    const effectiveEqDelta = props.keyName === "leng" ? Math.max(baseForDisplay, eqStatVal) - baseForDisplay : eqStatVal;
    const totalBonus = effectiveEqDelta + bonusVal;
    return { effectiveEqDelta, bonusVal, totalBonus, baseForDisplay };
  });

  return (
    <div class="grid grid-cols-[1.25rem_1fr_1.5rem] items-center gap-0 group/stat h-3.5 w-[5.9rem]">
      <span class="text-base-content/40 font-medium text-[10px]">{props.label}</span>

      <div class="flex items-center gap-0 justify-end min-w-0">
        <button
          class="w-3.5 h-3.5 flex items-center justify-center rounded text-base-content/20 hover:text-primary hover:bg-primary/10 opacity-0 group-hover/stat:opacity-100 transition-all text-[9px] font-bold shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            updateDelta(-1);
          }}
        >
          -
        </button>

        {!editing() ? (
          <span
            class={`font-mono text-base-content/70 text-right tabular-nums w-[1.55rem] cursor-pointer hover:text-primary transition-colors text-[10px] ${
              overrides[props.keyName] != null ? "text-primary/80 font-bold" : ""
            }`}
            title={
              bonusInfo().totalBonus !== 0
                ? `素: ${bonusInfo().baseForDisplay}` +
                  (bonusInfo().effectiveEqDelta ? `, 装備: ${bonusInfo().effectiveEqDelta > 0 ? "+" : ""}${bonusInfo().effectiveEqDelta}` : "") +
                  (bonusInfo().bonusVal ? `, ボーナス: ${bonusInfo().bonusVal > 0 ? "+" : ""}${bonusInfo().bonusVal}` : "")
                : undefined
            }
            onClick={(e) => {
              e.stopPropagation();
              if (isReadOnly()) return;
              if (props.base == null && overrides[props.keyName] == null) return;
              setEditing(true);
            }}
          >
            {formatStatVal()}
          </span>
        ) : (
          <input
            type="number"
            class="w-[1.55rem] h-3.5 text-[10px] font-mono text-right border border-primary/40 rounded px-0.5 bg-base-100 outline-none focus:border-primary"
            value={String(currentNumericVal(props.keyName, props.base))}
            min={String(props.base ?? 0)}
            max={props.max != null ? String(props.max) : undefined}
            onBlur={(e) => {
              const v = Number.parseInt((e.currentTarget as HTMLInputElement).value, 10);
              if (!Number.isNaN(v)) {
                const lo = props.base ?? 0;
                const hi = props.max ?? 9999;
                const clamped = Math.max(lo, Math.min(hi, v));
                if (clamped === props.base) delete overrides[props.keyName];
                else overrides[props.keyName] = clamped;
              }
              setEditing(false);
              markSimulatorStateDirty("fleet");
            }}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") (ev.currentTarget as HTMLInputElement).blur();
              if (ev.key === "Escape") {
                delete overrides[props.keyName];
                setEditing(false);
                markSimulatorStateDirty("fleet");
              }
            }}
            ref={(el) => {
              queueMicrotask(() => {
                if (!editing()) return;
                el.focus();
                el.select();
              });
            }}
          />
        )}

        <button
          class="w-3.5 h-3.5 flex items-center justify-center rounded text-base-content/20 hover:text-primary hover:bg-primary/10 opacity-0 group-hover/stat:opacity-100 transition-all text-[9px] font-bold shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            updateDelta(1);
          }}
        >
          +
        </button>
      </div>

      <span
        class="text-[10px] font-mono font-semibold tabular-nums leading-none w-6 text-left pl-px"
        style={{ color: bonusInfo().totalBonus > 0 ? "#b45309" : bonusInfo().totalBonus < 0 ? "#c2410c" : undefined }}
        title={
          bonusInfo().bonusVal !== 0
            ? `装備: ${bonusInfo().effectiveEqDelta > 0 ? "+" : ""}${bonusInfo().effectiveEqDelta}, ボーナス: ${
                bonusInfo().bonusVal > 0 ? "+" : ""
              }${bonusInfo().bonusVal}`
            : undefined
        }
      >
        {bonusInfo().totalBonus !== 0 ? `${bonusInfo().totalBonus > 0 ? "+" : ""}${bonusInfo().totalBonus}` : ""}
      </span>
    </div>
  );
}

function ShipCard(props: {
  fleetIndex: 1 | 2 | 3 | 4;
  idx: number;
}): JSX.Element {
  const cardCtx: ShipCardContextValue = {
    fleetIndex: props.fleetIndex,
    idx: props.idx,
  };
  const liveSlot = () => getLiveFleetSlot(props.fleetIndex, props.idx);
  const [cardHovered, setCardHovered] = createSignal(false);
  const $fleetState = useStore(simulatorFleetState);
  const viewSlot = createMemo(() => {
    const fleets = $fleetState();
    const fleet =
      props.fleetIndex === 1
        ? fleets.fleet1
        : props.fleetIndex === 2
        ? fleets.fleet2
        : props.fleetIndex === 3
        ? fleets.fleet3
        : fleets.fleet4;
    return fleet[props.idx] ?? null;
  });

  const ship = createMemo(() => {
    const slot = viewSlot();
    return slot?.shipId != null ? getMasterShip(slot.shipId) : null;
  });

  const shipData = createMemo(() => {
    const s = ship();
    if (!s) return null;

    const slot = viewSlot();
    if (!slot) return null;

    const slotCount = s.slot_num ?? 4;
    const ist = slot.instanceStats;
    const equipBonuses =
      slot.shipId != null
        ? computeEquipBonuses(slot.shipId, slot.equipIds, slot.exSlotId, slot.equipImprovement, slot.exSlotImprovement)
        : {};
    const equipSums = computeEquipSum(slot.equipIds, slot.exSlotId);

    const leftStats: StatDef[] = [
      ["耐久", "taik", s.taik?.[0] ?? null, s.taik?.[1] ?? null, true],
      ["装甲", "souk", ist?.souk ?? s.souk?.[0] ?? null, s.souk?.[1] ?? null, true],
      ["回避", "kaih", ist?.kaih ?? null, null, true],
      ["搭載", "maxeq", s.maxeq ? s.maxeq.slice(0, slotCount).reduce((a, b) => a + b, 0) : null, null, true],
      ["速力", "soku", s.soku, 20, false],
      ["射程", "leng", s.leng, 5, false],
    ];

    const rightStats: StatDef[] = [
      ["火力", "houg", ist?.houg ?? s.houg?.[0] ?? null, s.houg?.[1] ?? null, true],
      ["雷装", "raig", ist?.raig ?? s.raig?.[0] ?? null, s.raig?.[1] ?? null, true],
      ["対空", "tyku", ist?.tyku ?? s.tyku?.[0] ?? null, s.tyku?.[1] ?? null, true],
      ["対潜", "tais", ist?.tais ?? s.tais?.[0] ?? null, s.tais?.[1] ?? null, true],
      ["索敵", "saku", ist?.saku ?? null, null, true],
      ["運", "luck", ist?.luck ?? s.luck?.[0] ?? null, s.luck?.[1] ?? null, true],
    ];

    return { s, slot, slotCount, leftStats, rightStats, equipBonuses, equipSums };
  });

  return (
    <ShipCardContext.Provider value={cardCtx}>
      <Show
        when={shipData()}
        keyed
        fallback={
          <div
            class="group w-full max-w-md mx-auto border-2 border-dashed border-base-300/50 rounded-lg flex flex-col items-center justify-center gap-0.5 cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-all min-h-[88px]"
            onClick={() => {
              if (isReadOnly()) return;
              setShipModalTargetForFleet(props.fleetIndex, props.idx);
              openShipModal(null, (selection) => {
                applyShipSelectionAt(props.fleetIndex, props.idx, selection);
              });
            }}
          >
            <span class="text-[10px] font-bold text-base-content/20">{props.idx + 1}</span>
            <div class="text-2xl leading-none text-base-content/15 group-hover:text-primary/50 transition-colors">+</div>
            <span class="text-[10px] text-base-content/20 group-hover:text-primary/40 transition-colors">艦を配置</span>
          </div>
        }
      >
        {(d) => {
          const imageUrl = cardUrl(d.slot.shipId!);
          if (imageUrl) prefetchCardOnce(imageUrl);
          const [cardImageUnavailable, setCardImageUnavailable] = createSignal(!imageUrl);
          const [exRowHovered, setExRowHovered] = createSignal(false);
          createEffect(() => {
            setCardImageUnavailable(!imageUrl);
          });

          return (
            <div
              class="rounded-lg overflow-hidden border border-base-300/60 bg-base-100 group/card relative w-full max-w-md mx-auto"
              onMouseEnter={() => setCardHovered(true)}
              onMouseLeave={() => setCardHovered(false)}
            >
              <Show when={cardImageUnavailable()}>
                <div class="absolute inset-0 z-0 flex items-center justify-end select-none pointer-events-none">
                  <div class="h-full flex-none flex items-center justify-center" style={{ "aspect-ratio": "327 / 450" }}>
                    <div class="text-[10px] font-bold tracking-wide text-base-content/45">
                      No Image
                    </div>
                  </div>
                </div>
              </Show>

              <Show when={imageUrl.length > 0}>
                <img
                  src={imageUrl}
                  alt={d.s.name}
                  class="absolute inset-0 z-0 w-full h-full object-contain object-right cursor-pointer select-none"
                  loading="lazy"
                  onLoad={() => setCardImageUnavailable(false)}
                  onError={() => setCardImageUnavailable(true)}
                  onClick={() => {
                    const currentShipId = liveSlot().shipId;
                    setShipModalTargetForFleet(props.fleetIndex, props.idx);
                    openShipModal(currentShipId, (selection) => {
                      if (selection.id !== currentShipId || selection.level !== undefined) {
                        applyShipSelectionAt(props.fleetIndex, props.idx, selection);
                      }
                    });
                  }}
                />
              </Show>

              <div
                class="relative z-10 flex flex-col"
                style={{ width: "62%", background: "linear-gradient(to right, var(--color-base-100) 75%, transparent 100%)" }}
              >
                <div
                  class="group/shiphead flex items-center gap-1.5 px-2 py-1 border-b border-base-200/60 cursor-pointer"
                  onClick={() => {
                    const currentShipId = liveSlot().shipId;
                    setShipModalTargetForFleet(props.fleetIndex, props.idx);
                    openShipModal(currentShipId, (selection) => {
                      if (selection.id !== currentShipId || selection.level !== undefined) {
                        applyShipSelectionAt(props.fleetIndex, props.idx, selection);
                      }
                    });
                  }}
                >
                  <span class="text-[10px] font-bold bg-primary/15 text-primary rounded w-4 h-4 flex items-center justify-center shrink-0">{props.idx + 1}</span>
                  <span class="text-xs font-bold truncate flex-1 leading-tight">{d.s.name}</span>
                  <span class="text-[9px] px-1 py-0.5 rounded text-base-content/50 font-bold shrink-0">{d.slot.shipLevel != null ? `Lv.${d.slot.shipLevel}` : "Lv.—"}</span>
                  <span class="text-[9px] px-1 py-0.5 rounded bg-base-200/60 text-base-content/50 font-bold shrink-0">{STYPE_SHORT[d.s.stype] ?? ""}</span>
                  <button
                    class={`sim-delete-btn w-5 h-5 inline-flex items-center justify-center leading-none rounded-md text-base-content/75 hover:text-error transition-all duration-150 shrink-0 ${cardHovered() ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}
                    title="艦を外す"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isReadOnly()) return;
                      assignShipToFleetSlot(liveSlot(), null);
                    }}
                  >
                    <DeleteIcon />
                  </button>
                </div>

                <div class="divide-y divide-base-200/40">
                  <Index each={FLEET_EQUIP_SLOT_INDEXES}>
                    {(slotIdx) => {
                      const i = slotIdx();
                      const [rowHovered, setRowHovered] = createSignal(false);
                      const isActive = i < d.slotCount;
                      const equip = isActive && d.slot.equipIds[i] != null ? getMasterSlotItem(d.slot.equipIds[i]!) : null;
                      const eqType2 = equip?.type?.[2] ?? 0;
                      const canShowProf = equip && AIRCRAFT_TYPES.has(eqType2);

                      return (
                        <div
                          class={
                            isActive
                              ? "group/equip flex items-center gap-1 px-1.5 py-0.5 h-6 text-[11px] cursor-pointer hover:bg-base-200/30 transition-colors"
                              : "flex items-center gap-1 px-1.5 py-0.5 h-6 text-[11px]"
                          }
                          onMouseEnter={() => setRowHovered(true)}
                          onMouseLeave={() => setRowHovered(false)}
                          onClick={() => {
                            if (!isActive) return;
                            const current = liveSlot().equipIds[i];
                            if (isReadOnly() && current == null) return;
                            setEquipModalTargetForFleet(props.fleetIndex, props.idx, i);
                            openEquipModal(current, (selection) => {
                              applyFleetEquipSelectionAt(props.fleetIndex, props.idx, i, selection);
                            });
                          }}
                        >
                          <span class="w-3 text-center text-[9px] text-base-content/25 font-mono shrink-0">{isActive && d.s.maxeq?.[i] != null ? String(d.s.maxeq[i]) : ""}</span>

                          {equip ? <WeaponIcon iconNum={equip.type?.[3] ?? 0} /> : <div style="width:16px;height:16px" class="shrink-0"></div>}

                          <span class={`truncate flex-1 leading-tight ${equip ? "text-base-content/80" : "text-base-content/15"}`}>{isActive ? equip?.name ?? "—" : ""}</span>

                          <span class="ml-auto grid grid-cols-[2em_2.5em_1.25rem] items-center justify-items-end gap-0.5 shrink-0">
                            {canShowProf ? (
                              <span
                                title={`熟練度${d.slot.equipProficiency[i] ?? 0} (クリックで変更)`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isReadOnly()) return;
                                  cycleFleetEquipProficiency(liveSlot(), i);
                                }}
                              >
                                <ProfBadge level={d.slot.equipProficiency[i] ?? 0} hovered={rowHovered()} />
                              </span>
                            ) : <span class="inline-block w-[2em]" />}

                            {equip ? (
                              <span
                                title={`改修Lv${d.slot.equipImprovement[i] ?? 0} (クリックで変更)`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isReadOnly()) return;
                                  cycleFleetEquipImprovement(liveSlot(), i);
                                }}
                              >
                                <ImpBadge level={d.slot.equipImprovement[i] ?? 0} hovered={rowHovered()} />
                              </span>
                            ) : <span class="inline-block w-[2.5em]" />}

                            {equip && !isReadOnly() ? (
                              <button
                                class={`sim-delete-btn w-5 h-5 inline-flex items-center justify-center leading-none rounded-md text-base-content/75 hover:text-error transition-all duration-150 ${cardHovered() ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}
                                title="装備を外す"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFleetEquip(liveSlot(), i, null);
                                }}
                              >
                                <DeleteIcon />
                              </button>
                            ) : <span class="inline-block w-5 h-5" />}
                          </span>
                        </div>
                      );
                    }}
                  </Index>
                </div>

                <div
                  class="group/ex flex items-center gap-1 px-1.5 py-0.5 h-6 text-[11px] cursor-pointer hover:bg-base-200/30 transition-colors border-t border-dashed border-base-200/50"
                  onMouseEnter={() => setExRowHovered(true)}
                  onMouseLeave={() => setExRowHovered(false)}
                  onClick={() => {
                    const current = liveSlot().exSlotId;
                    if (isReadOnly() && current == null) return;
                    setEquipModalTargetForFleet(props.fleetIndex, props.idx, -1);
                    openEquipModal(current, (selection) => {
                      applyFleetExslotSelectionAt(props.fleetIndex, props.idx, selection);
                    });
                  }}
                >
                  <span class="text-[9px] text-warning/60 font-bold shrink-0 w-3 text-center">補</span>
                  {d.slot.exSlotId != null && getMasterSlotItem(d.slot.exSlotId)
                    ? <WeaponIcon iconNum={getMasterSlotItem(d.slot.exSlotId!)?.type?.[3] ?? 0} />
                    : <div style="width:16px;height:16px" class="shrink-0"></div>}
                  <span class={`truncate flex-1 leading-tight ${d.slot.exSlotId != null ? "text-base-content/80" : "text-base-content/15"}`}>
                    {d.slot.exSlotId != null ? getMasterSlotItem(d.slot.exSlotId!)?.name ?? "補強増設" : "補強増設"}
                  </span>
                  <span class="ml-auto grid grid-cols-[2em_2.5em_1.25rem] items-center justify-items-end gap-0.5 shrink-0">
                    <span class="inline-block w-[2em]" />
                    {d.slot.exSlotId != null ? (
                      <span
                        title={`改修Lv${d.slot.exSlotImprovement ?? 0} (クリックで変更)`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isReadOnly()) return;
                          cycleFleetExslotImprovement(liveSlot());
                        }}
                      >
                        <ImpBadge level={d.slot.exSlotImprovement ?? 0} hovered={exRowHovered()} />
                      </span>
                    ) : <span class="inline-block w-[2.5em]" />}
                    {d.slot.exSlotId != null && !isReadOnly() ? (
                      <button
                        class={`sim-delete-btn w-5 h-5 inline-flex items-center justify-center leading-none rounded-md text-base-content/75 hover:text-error transition-all duration-150 ${cardHovered() ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}
                        title="補強増設装備を外す"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFleetExslotEquip(liveSlot(), null);
                        }}
                      >
                        <DeleteIcon />
                      </button>
                    ) : <span class="inline-block w-5 h-5" />}
                  </span>
                </div>

                <div class="grid grid-cols-[5.9rem_0.25rem_5.9rem] gap-x-0 gap-y-0 px-1.5 py-0 text-[10px] border-t border-base-200/50 leading-none w-fit">
                  {d.leftStats.map((ls, r) => {
                    const rs = d.rightStats[r];
                    return (
                      <>
                        <StatCell
                          label={ls[0]}
                          keyName={ls[1]}
                          base={ls[2]}
                          max={ls[3]}
                          isNumeric={ls[4]}
                          equipSums={d.equipSums}
                          equipBonuses={d.equipBonuses}
                        />
                        <span></span>
                        <StatCell
                          label={rs[0]}
                          keyName={rs[1]}
                          base={rs[2]}
                          max={rs[3]}
                          isNumeric={rs[4]}
                          equipSums={d.equipSums}
                          equipBonuses={d.equipBonuses}
                        />
                      </>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        }}
      </Show>
    </ShipCardContext.Provider>
  );
}

function FleetSlotsView(props: { fleetIndex: 1 | 2 | 3 | 4 }): JSX.Element {
  const $fleetState = useStore(simulatorFleetState);
  createMemo(() => $fleetState());

  return (
    <Index each={FLEET_SLOT_INDEXES}>
      {(idx) => (
        <ShipCard fleetIndex={props.fleetIndex} idx={idx()} />
      )}
    </Index>
  );
}

function AirBaseCard(props: { index: number }): JSX.Element {
  const $airbaseState = useStore(simulatorAirbaseState);
  const viewBase = createMemo(() => {
    return $airbaseState()[props.index] ?? null;
  });
  const baseRadiusInfo = createMemo(() => {
    const base = viewBase();
    if (!base) return { baseRadius: 0, bonus: 0, finalRadius: 0 };
    return computeAirbaseActionRadius(base);
  });
  const hasSortieAircraft = createMemo(() => baseRadiusInfo().baseRadius > 0);

  return (
    <div class="border border-base-200 rounded-lg overflow-hidden">
      <div class="px-3 py-1.5 bg-base-200/30 border-b border-base-200/50 flex items-center justify-between gap-2">
        <span class="text-xs font-bold text-base-content/40">第{props.index + 1}基地</span>
        <span
          class="text-[10px] font-mono text-base-content/50"
          title={
            !hasSortieAircraft()
              ? "出撃可能な航空機が未配備"
              :
            baseRadiusInfo().bonus > 0
              ? `行動半径 ${baseRadiusInfo().baseRadius} + 大型飛行艇補正 ${baseRadiusInfo().bonus}`
              : undefined
          }
        >
          {hasSortieAircraft() ? baseRadiusInfo().finalRadius : "-"}
          {hasSortieAircraft() && baseRadiusInfo().bonus > 0 ? ` (+${baseRadiusInfo().bonus})` : ""}
        </span>
      </div>
      <div class="divide-y divide-base-200/50">
        <Index each={AIRBASE_EQUIP_SLOT_INDEXES}>
          {(slotIdx) => {
          const i = slotIdx();
          const equip = createMemo(() => {
            const base = viewBase();
            if (!base) return null;
            const equipId = base.equipIds[i];
            return equipId != null ? getMasterSlotItem(equipId) : null;
          });
          const equipIconNum = createMemo(() => equip()?.type?.[3] ?? 0);
          const equipDistance = createMemo(() => equip()?.distance ?? null);
          const canShowProf = createMemo(() => {
            const eq = equip();
            const eqType2 = eq?.type?.[2] ?? 0;
            return Boolean(eq && AIRCRAFT_TYPES.has(eqType2));
          });
          const prof = () => viewBase()?.equipProficiency[i] ?? 0;
          const imp = () => viewBase()?.equipImprovement[i] ?? 0;
          const [rowHovered, setRowHovered] = createSignal(false);

          return (
            <div
              class="group/base flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 h-8 text-xs cursor-pointer hover:bg-base-200/40 transition-colors"
              onMouseEnter={() => setRowHovered(true)}
              onMouseLeave={() => setRowHovered(false)}
              onClick={() => {
                const current = getLiveAirBase(props.index).equipIds[i];
                if (isReadOnly() && current == null) return;
                setEquipModalTargetForAirBase(props.index, i);
                openEquipModal(current, (selection) => {
                  applyAirBaseEquipSelectionAt(props.index, i, selection);
                });
              }}
            >
              <span class="w-3.5 text-center text-base-content/25 font-mono shrink-0">{i + 1}</span>
              {equip() ? <WeaponIcon iconNum={equipIconNum()} /> : <div style="width:16px;height:16px" class="shrink-0"></div>}
              <span class={`truncate flex-1 ${equip() ? "text-base-content/70" : "text-base-content/20 italic"}`}>{equip()?.name ?? "—"}</span>

              <span class="ml-auto grid grid-cols-[2em_2.5em_2.5em_1.25rem] items-center justify-items-end gap-0.5 shrink-0">
                {equipDistance() != null ? (
                  <span class="inline-flex items-center h-4 leading-none text-[10px] text-base-content/30 shrink-0">{equipDistance()}</span>
                ) : <span class="inline-block w-[2.5em]" />}

                {canShowProf() ? (
                  <span
                    title={`熟練度${prof()} (クリックで変更)`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isReadOnly()) return;
                      cycleAirBaseEquipProficiency(getLiveAirBase(props.index), i);
                    }}
                  >
                    <ProfBadge level={prof()} hovered={rowHovered()} />
                  </span>
                ) : <span class="inline-block w-[2em]" />}

                {equip() ? (
                  <span
                    title={`改修Lv${imp()} (クリックで変更)`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isReadOnly()) return;
                      cycleAirBaseEquipImprovement(getLiveAirBase(props.index), i);
                    }}
                  >
                    <ImpBadge level={imp()} hovered={rowHovered()} />
                  </span>
                ) : <span class="inline-block w-[2.5em]" />}

                {equip() && !isReadOnly() ? (
                  <button
                    class="sim-delete-btn sim-delete-btn-airbase w-5 h-5 inline-flex items-center justify-center leading-none rounded-md text-base-content/75 opacity-0 scale-95 group-hover/base:opacity-100 group-hover/base:scale-100 hover:text-error transition-all duration-150 -mr-0.5"
                    title="装備を外す"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAirBaseEquip(getLiveAirBase(props.index), i, null);
                    }}
                  >
                    <DeleteIcon />
                  </button>
                ) : <span class="inline-block w-5 h-5" />}
              </span>
            </div>
          );
        }}
        </Index>
      </div>
    </div>
  );
}

function AirBaseView(): JSX.Element {
  const $airbaseState = useStore(simulatorAirbaseState);
  createMemo(() => $airbaseState());

  return (
    <Index each={AIRBASE_INDEXES}>
      {(i) => <AirBaseCard index={i()} />}
    </Index>
  );
}

export function ensureSolidSimulatorMounted(): void {
  if (mounted) return;

  const fleet1El = document.getElementById("fleet-1-slots");
  const fleet2El = document.getElementById("fleet-2-slots");
  const fleet3El = document.getElementById("fleet-3-slots");
  const fleet4El = document.getElementById("fleet-4-slots");
  const airbaseEl = document.getElementById("air-bases");

  if (!fleet1El || !fleet2El || !fleet3El || !fleet4El || !airbaseEl) return;

  render(() => <FleetSlotsView fleetIndex={1} />, fleet1El);
  render(() => <FleetSlotsView fleetIndex={2} />, fleet2El);
  render(() => <FleetSlotsView fleetIndex={3} />, fleet3El);
  render(() => <FleetSlotsView fleetIndex={4} />, fleet4El);
  render(() => <AirBaseView />, airbaseEl);

  mounted = true;
}

export function rerenderSolidSimulator(scope: SimulatorDirtyScope = "all"): void {
  ensureSolidSimulatorMounted();
  markSimulatorStateDirty(scope);
}
