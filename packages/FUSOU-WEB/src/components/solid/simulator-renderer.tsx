/** @jsxImportSource solid-js */

import { createMemo, createSignal, onMount, type JSX } from "solid-js";
import { render } from "solid-js/web";
import type { AirBaseSlot, FleetSlot } from "../../pages/simulator/lib/types";
import { AIRCRAFT_TYPES, RANGE_NAMES, SPEED_NAMES, STYPE_SHORT } from "../../pages/simulator/lib/constants";
import { cardUrl, computeEquipBonuses, computeEquipSum, createWeaponIconEl } from "../../pages/simulator/lib/equip-calc";
import { prefetchExternalUrlForExport } from "../../pages/simulator/lib/image-capture";
import { openShipModal } from "../../pages/simulator/lib/ship-modal";
import { openEquipModal } from "../../pages/simulator/lib/equip-modal";
import {
  assignShipToFleetSlot,
  cycleAirBaseEquipImprovement,
  cycleAirBaseEquipProficiency,
  cycleFleetEquipImprovement,
  cycleFleetEquipProficiency,
  cycleFleetExslotImprovement,
  ensureFleetStatOverrides,
  setAirBaseEquip,
  setEquipModalTargetForAirBase,
  setEquipModalTargetForFleet,
  setFleetEquip,
  setFleetExslotEquip,
} from "../../pages/simulator/lib/simulator-mutations";
import { markSimulatorStateDirty, onSimulatorStateDirty, type SimulatorDirtyScope } from "../../pages/simulator/lib/state";
import { getAirBaseState, getFleetState, getMasterShip, getMasterSlotItem, isWorkspaceReadOnly } from "../../pages/simulator/lib/simulator-selectors";

let mounted = false;
let rerenderQueued = false;
let pendingFleetRerender = false;
let pendingAirbaseRerender = false;
let unsubscribeStateDirty: (() => void) | null = null;
const [fleetRenderVersion, setFleetRenderVersion] = createSignal(0);
const [airbaseRenderVersion, setAirbaseRenderVersion] = createSignal(0);
const prefetchedCardUrls = new Set<string>();

const isReadOnly = () => isWorkspaceReadOnly();

function touchAnyRenderVersion(): void {
  fleetRenderVersion();
  airbaseRenderVersion();
}

function scheduleRerender(scope: SimulatorDirtyScope = "all"): void {
  if (scope === "fleet" || scope === "all") pendingFleetRerender = true;
  if (scope === "airbase" || scope === "all") pendingAirbaseRerender = true;

  if (rerenderQueued) return;
  rerenderQueued = true;
  queueMicrotask(() => {
    rerenderQueued = false;

    if (pendingFleetRerender) {
      pendingFleetRerender = false;
      setFleetRenderVersion((v) => v + 1);
    }
    if (pendingAirbaseRerender) {
      pendingAirbaseRerender = false;
      setAirbaseRenderVersion((v) => v + 1);
    }
  });
}

function prefetchCardOnce(url: string): void {
  if (prefetchedCardUrls.has(url)) return;
  prefetchedCardUrls.add(url);
  prefetchExternalUrlForExport(url);
}

function ProfBadge(props: { level: number }): JSX.Element {
  const symbols = ["|", "|", "||", "|||", "\\", "\\\\", "\\\\\\", ">>"];
  const color =
    props.level === 0
      ? "#1976d2"
      : props.level <= 3
      ? "#1976d2"
      : props.level <= 6
      ? "#f57c00"
      : "#e65100";

  return (
    <span
      class="shrink-0 cursor-pointer select-none text-[11px] leading-none font-bold mr-0.5 inline-block w-[2em] text-center"
      style={{
        color,
        "text-shadow": "0 0 3px rgba(255,255,255,0.9), 0 0 6px rgba(255,255,255,0.7)",
        opacity: props.level === 0 ? "0" : "1",
        transition: props.level === 0 ? "opacity 0.15s" : undefined,
      }}
    >
      {symbols[props.level] ?? ">>"}
    </span>
  );
}

function ImpBadge(props: { level: number }): JSX.Element {
  return (
    <span
      class="shrink-0 cursor-pointer select-none text-[11px] leading-none font-bold min-w-[2em] text-right"
      style={{
        color: "#00897b",
        "text-shadow": "0 0 3px rgba(255,255,255,0.9), 0 0 6px rgba(255,255,255,0.7)",
        opacity: props.level > 0 ? "1" : "0",
        transition: props.level > 0 ? undefined : "opacity 0.15s",
      }}
    >
      {props.level > 0 ? `★${props.level}` : "★"}
    </span>
  );
}

function WeaponIcon(props: { iconNum: number }): JSX.Element {
  let host!: HTMLSpanElement;

  onMount(() => {
    host.innerHTML = "";
    host.appendChild(createWeaponIconEl(props.iconNum, 16));
  });

  createMemo(() => {
    touchAnyRenderVersion();
    if (!host) return;
    host.innerHTML = "";
    host.appendChild(createWeaponIconEl(props.iconNum, 16));
  });

  return <span ref={host} class="shrink-0 inline-flex" />;
}

type StatDef = [label: string, key: string, base: number | null, max: number | null, isNumeric: boolean];

function StatCell(props: {
  fleet: FleetSlot[];
  slot: FleetSlot;
  idx: number;
  label: string;
  keyName: string;
  base: number | null;
  max: number | null;
  isNumeric: boolean;
  equipSums: Record<string, number>;
  equipBonuses: Record<string, number>;
}): JSX.Element {
  const overrides = ensureFleetStatOverrides(props.slot);
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
    fleetRenderVersion();
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

function ShipCard(props: { fleet: FleetSlot[]; idx: number; slot: FleetSlot }): JSX.Element {
  const ship = createMemo(() => {
    fleetRenderVersion();
    return props.slot.shipId != null ? getMasterShip(props.slot.shipId) : null;
  });

  const shipData = createMemo(() => {
    const s = ship();
    if (!s) return null;

    const slotCount = s.slot_num ?? 4;
    const ist = props.slot.instanceStats;
    const equipBonuses =
      props.slot.shipId != null
        ? computeEquipBonuses(props.slot.shipId, props.slot.equipIds, props.slot.exSlotId, props.slot.equipImprovement, props.slot.exSlotImprovement)
        : {};
    const equipSums = computeEquipSum(props.slot.equipIds, props.slot.exSlotId);

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

    return { s, slotCount, leftStats, rightStats, equipBonuses, equipSums };
  });

  if (!shipData()) {
    return (
      <div
        class="group border-2 border-dashed border-base-300/50 rounded-lg flex flex-col items-center justify-center gap-0.5 cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-all min-h-[88px]"
        onClick={() => {
          if (isReadOnly()) return;
          openShipModal(null, (id) => {
            assignShipToFleetSlot(props.fleet[props.idx], id);
          });
        }}
      >
        <span class="text-[10px] font-bold text-base-content/20">{props.idx + 1}</span>
        <div class="text-2xl leading-none text-base-content/15 group-hover:text-primary/50 transition-colors">+</div>
        <span class="text-[10px] text-base-content/20 group-hover:text-primary/40 transition-colors">艦娘を配置</span>
      </div>
    );
  }

  const { s, slotCount, leftStats, rightStats, equipBonuses, equipSums } = shipData()!;
  const imageUrl = cardUrl(props.slot.shipId!);
  prefetchCardOnce(imageUrl);

  return (
    <div class="rounded-lg overflow-hidden border border-base-300/60 bg-base-100 group/card relative max-w-sm">
      <img
        src={imageUrl}
        alt={s.name}
        class="absolute inset-0 w-full h-full object-contain object-right pointer-events-none select-none"
        loading="lazy"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
        onClick={() => {
          openShipModal(props.slot.shipId, (id) => {
            if (id !== props.slot.shipId) assignShipToFleetSlot(props.fleet[props.idx], id);
          });
        }}
      />

      <div class="relative z-10 flex flex-col" style={{ width: "62%", background: "linear-gradient(to right, var(--color-base-100) 75%, transparent 100%)" }}>
        <div
          class="flex items-center gap-1.5 px-2 py-1 border-b border-base-200/60 cursor-pointer"
          onClick={() => {
            openShipModal(props.slot.shipId, (id) => {
              if (id !== props.slot.shipId) assignShipToFleetSlot(props.fleet[props.idx], id);
            });
          }}
        >
          <span class="text-[10px] font-bold bg-primary/15 text-primary rounded w-4 h-4 flex items-center justify-center shrink-0">{props.idx + 1}</span>
          <span class="text-xs font-bold truncate flex-1 leading-tight">{s.name}</span>
          <span class="text-[9px] px-1 py-0.5 rounded text-base-content/50 font-bold shrink-0">{props.slot.shipLevel != null ? `Lv.${props.slot.shipLevel}` : "Lv.—"}</span>
          <span class="text-[9px] px-1 py-0.5 rounded bg-base-200/60 text-base-content/50 font-bold shrink-0">{STYPE_SHORT[s.stype] ?? ""}</span>
          <button
            class="w-4 h-4 flex items-center justify-center rounded text-base-content/20 hover:text-error hover:bg-error/10 opacity-0 group-hover/card:opacity-100 transition-all shrink-0 text-[10px]"
            onClick={(e) => {
              e.stopPropagation();
              if (isReadOnly()) return;
              assignShipToFleetSlot(props.fleet[props.idx], null);
            }}
          >
            ✕
          </button>
        </div>

        <div class="divide-y divide-base-200/40">
          {Array.from({ length: 5 }).map((_, i) => {
            const isActive = i < slotCount;
            const equip = isActive && props.slot.equipIds[i] != null ? getMasterSlotItem(props.slot.equipIds[i]!) : null;
            const eqType2 = equip?.type?.[2] ?? 0;
            const canShowProf = equip && AIRCRAFT_TYPES.has(eqType2);

            return (
              <div
                class={
                  isActive
                    ? "group/equip flex items-center gap-1 px-1.5 py-0.5 text-[11px] cursor-pointer hover:bg-base-200/30 transition-colors"
                    : "flex items-center gap-1 px-1.5 py-0.5 text-[11px]"
                }
                onClick={() => {
                  if (!isActive || isReadOnly()) return;
                  setEquipModalTargetForFleet(props.slot, i);
                  openEquipModal(props.slot.equipIds[i], (id) => {
                    setFleetEquip(props.fleet[props.idx], i, id);
                  });
                }}
              >
                <span class="w-3 text-center text-[9px] text-base-content/25 font-mono shrink-0">{isActive && s.maxeq?.[i] != null ? String(s.maxeq[i]) : ""}</span>

                {equip ? <WeaponIcon iconNum={equip.type?.[3] ?? 0} /> : <div style="width:16px;height:16px" class="shrink-0"></div>}

                <span class={`truncate flex-1 leading-tight ${equip ? "text-base-content/80" : "text-base-content/15"}`}>{isActive ? equip?.name ?? "—" : ""}</span>

                {canShowProf ? (
                  <span
                    title={`熟練度${props.slot.equipProficiency[i] ?? 0} (クリックで変更)`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isReadOnly()) return;
                      cycleFleetEquipProficiency(props.fleet[props.idx], i);
                    }}
                    class="group-hover/equip:[&>span]:opacity-40"
                  >
                    <ProfBadge level={props.slot.equipProficiency[i] ?? 0} />
                  </span>
                ) : null}

                {equip ? (
                  <span
                    title={`改修Lv${props.slot.equipImprovement[i] ?? 0} (クリックで変更)`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isReadOnly()) return;
                      cycleFleetEquipImprovement(props.fleet[props.idx], i);
                    }}
                    class="group-hover/equip:[&>span]:opacity-40"
                  >
                    <ImpBadge level={props.slot.equipImprovement[i] ?? 0} />
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>

        <div
          class="group/ex flex items-center gap-1 px-1.5 py-0.5 text-[11px] cursor-pointer hover:bg-base-200/30 transition-colors border-t border-dashed border-base-200/50"
          onClick={() => {
            if (isReadOnly()) return;
            setEquipModalTargetForFleet(props.slot, -1);
            openEquipModal(props.slot.exSlotId, (id) => {
              setFleetExslotEquip(props.fleet[props.idx], id);
            });
          }}
        >
          <span class="text-[9px] text-warning/60 font-bold shrink-0 w-3 text-center">補</span>
          {props.slot.exSlotId != null && getMasterSlotItem(props.slot.exSlotId)
            ? <WeaponIcon iconNum={getMasterSlotItem(props.slot.exSlotId!)?.type?.[3] ?? 0} />
            : <div style="width:16px;height:16px" class="shrink-0"></div>}
          <span class={`truncate flex-1 leading-tight ${props.slot.exSlotId != null ? "text-base-content/80" : "text-base-content/15"}`}>
            {props.slot.exSlotId != null ? getMasterSlotItem(props.slot.exSlotId!)?.name ?? "補強増設" : "補強増設"}
          </span>
          {props.slot.exSlotId != null ? (
            <span
              title={`改修Lv${props.slot.exSlotImprovement ?? 0} (クリックで変更)`}
              onClick={(e) => {
                e.stopPropagation();
                if (isReadOnly()) return;
                cycleFleetExslotImprovement(props.fleet[props.idx]);
              }}
              class="group-hover/ex:[&>span]:opacity-40"
            >
              <ImpBadge level={props.slot.exSlotImprovement ?? 0} />
            </span>
          ) : null}
        </div>

        <div class="grid grid-cols-[5.9rem_0.25rem_5.9rem] gap-x-0 gap-y-0 px-1.5 py-0 text-[10px] border-t border-base-200/50 leading-none w-fit">
          {leftStats.map((ls, r) => {
            const rs = rightStats[r];
            return (
              <>
                <StatCell
                  fleet={props.fleet}
                  slot={props.slot}
                  idx={props.idx}
                  label={ls[0]}
                  keyName={ls[1]}
                  base={ls[2]}
                  max={ls[3]}
                  isNumeric={ls[4]}
                  equipSums={equipSums}
                  equipBonuses={equipBonuses}
                />
                <span></span>
                <StatCell
                  fleet={props.fleet}
                  slot={props.slot}
                  idx={props.idx}
                  label={rs[0]}
                  keyName={rs[1]}
                  base={rs[2]}
                  max={rs[3]}
                  isNumeric={rs[4]}
                  equipSums={equipSums}
                  equipBonuses={equipBonuses}
                />
              </>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FleetSlotsView(props: { fleetIndex: 1 | 2 | 3 | 4 }): JSX.Element {
  const slots = createMemo(() => {
    fleetRenderVersion();
    const fleets = getFleetState();
    const fleet =
      props.fleetIndex === 1
        ? fleets.fleet1
        : props.fleetIndex === 2
        ? fleets.fleet2
        : props.fleetIndex === 3
        ? fleets.fleet3
        : fleets.fleet4;

    return fleet.map((slot, idx) => <ShipCard fleet={fleet} idx={idx} slot={slot} />);
  });

  return <>{slots()}</>;
}

function AirBaseCard(props: { base: AirBaseSlot; index: number }): JSX.Element {
  return (
    <div class="border border-base-200 rounded-lg overflow-hidden">
      <div class="px-3 py-1.5 bg-base-200/30 text-xs font-bold text-base-content/40 border-b border-base-200/50">第{props.index + 1}基地</div>
      <div class="divide-y divide-base-200/50">
        {Array.from({ length: 4 }).map((_, i) => {
          const equip = props.base.equipIds[i] != null ? getMasterSlotItem(props.base.equipIds[i]!) : null;
          const eqType2 = equip?.type?.[2] ?? 0;
          const canShowProf = equip && AIRCRAFT_TYPES.has(eqType2);

          return (
            <div
              class="group/base flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer hover:bg-base-200/40 transition-colors"
              onClick={() => {
                if (isReadOnly()) return;
                setEquipModalTargetForAirBase();
                openEquipModal(props.base.equipIds[i], (id) => {
                  setAirBaseEquip(props.base, i, id);
                });
              }}
            >
              <span class="w-3.5 text-center text-base-content/25 font-mono shrink-0">{i + 1}</span>
              {equip ? <WeaponIcon iconNum={equip.type?.[3] ?? 0} /> : <div style="width:16px;height:16px" class="shrink-0"></div>}
              <span class={`truncate flex-1 ${equip ? "text-base-content/70" : "text-base-content/20 italic"}`}>{equip?.name ?? "—"}</span>

              {canShowProf ? (
                <span
                  title={`熟練度${props.base.equipProficiency[i] ?? 0} (クリックで変更)`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isReadOnly()) return;
                    cycleAirBaseEquipProficiency(props.base, i);
                  }}
                  class="group-hover/base:[&>span]:opacity-40"
                >
                  <ProfBadge level={props.base.equipProficiency[i] ?? 0} />
                </span>
              ) : null}

              {equip ? (
                <span
                  title={`改修Lv${props.base.equipImprovement[i] ?? 0} (クリックで変更)`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isReadOnly()) return;
                    cycleAirBaseEquipImprovement(props.base, i);
                  }}
                  class="group-hover/base:[&>span]:opacity-40"
                >
                  <ImpBadge level={props.base.equipImprovement[i] ?? 0} />
                </span>
              ) : null}

              {equip?.distance != null ? <span class="text-[10px] text-base-content/30 shrink-0">半径{equip.distance}</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AirBaseView(): JSX.Element {
  const cards = createMemo(() => {
    airbaseRenderVersion();
    return getAirBaseState().map((base, i) => <AirBaseCard base={base} index={i} />);
  });

  return <>{cards()}</>;
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

  if (!unsubscribeStateDirty) {
    const unsubs: Array<() => void> = [];
    unsubs.push(onSimulatorStateDirty("fleet", () => scheduleRerender("fleet")));
    unsubs.push(onSimulatorStateDirty("airbase", () => scheduleRerender("airbase")));
    unsubscribeStateDirty = () => {
      unsubs.forEach((unsub) => unsub());
    };
  }

  mounted = true;
}

export function rerenderSolidSimulator(scope: SimulatorDirtyScope = "all"): void {
  ensureSolidSimulatorMounted();
  markSimulatorStateDirty(scope);
}
