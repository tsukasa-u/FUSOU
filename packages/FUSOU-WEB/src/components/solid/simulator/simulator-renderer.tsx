/** @jsxImportSource solid-js */

import {
  Index,
  Show,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  useContext,
  type JSX,
} from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { useStore } from "@nanostores/solid";
import { render } from "solid-js/web";
import type {
  AirBaseSlot,
  FleetSlot,
  StatOverrides,
} from "../../../pages/simulator/lib/types";
import {
  AIRCRAFT_TYPES,
  RANGE_NAMES,
  SPEED_NAMES,
  STYPE_SHORT,
} from "../../../pages/simulator/lib/constants";
import {
  cardUrl,
  computeEquipBonuses,
  computeEquipSum,
  createWeaponIconEl,
} from "../../../pages/simulator/lib/equip-calc";
import { cachedFetch } from "../../../utility/fetchCache";
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

type ShipGrowthSummary = {
  ok: boolean;
  periods?: Array<{ period_tag: string; table_version: string }>;
};

type ShipGrowthCaps = {
  master_id: number;
  kaihi_max?: number;
  taisen_max?: number;
  sakuteki_max?: number;
  kaih_max?: number;
  tais_max?: number;
  saku_max?: number;
};

type NormalizedShipGrowthCaps = {
  master_id: number;
  kaihi_max: number;
  taisen_max: number;
  sakuteki_max: number;
};

type ShipGrowthBoundRow = {
  lv: number;
  kaihi_naked: number;
  taisen_naked: number;
  sakuteki_naked: number;
};

let shipGrowthPeriodPromise: Promise<{
  period_tag: string;
  table_version: string;
} | null> | null = null;
const shipGrowthCapsCache = new Map<number, NormalizedShipGrowthCaps | null>();

function normalizeShipGrowthCaps(
  raw: ShipGrowthCaps | null,
): NormalizedShipGrowthCaps | null {
  if (!raw) return null;
  return {
    master_id: raw.master_id,
    kaihi_max: Number(raw.kaihi_max ?? raw.kaih_max ?? 0),
    taisen_max: Number(raw.taisen_max ?? raw.tais_max ?? 0),
    sakuteki_max: Number(raw.sakuteki_max ?? raw.saku_max ?? 0),
  };
}

function deriveShipGrowthCapsFromBounds(
  masterId: number,
  bounds: ShipGrowthBoundRow[],
): NormalizedShipGrowthCaps | null {
  if (!Array.isArray(bounds) || bounds.length === 0) return null;
  const kaihiMax = Math.max(
    0,
    ...bounds.map((row) => Number(row.kaihi_naked || 0)),
  );
  const taisenMax = Math.max(
    0,
    ...bounds.map((row) => Number(row.taisen_naked || 0)),
  );
  const sakutekiMax = Math.max(
    0,
    ...bounds.map((row) => Number(row.sakuteki_naked || 0)),
  );
  return {
    master_id: masterId,
    kaihi_max: kaihiMax,
    taisen_max: taisenMax,
    sakuteki_max: sakutekiMax,
  };
}

function mergeShipGrowthCaps(
  primary: NormalizedShipGrowthCaps | null,
  fallback: NormalizedShipGrowthCaps | null,
): NormalizedShipGrowthCaps | null {
  if (!primary && !fallback) return null;
  if (!primary) return fallback;
  if (!fallback) return primary;
  return {
    master_id: primary.master_id,
    kaihi_max: primary.kaihi_max > 0 ? primary.kaihi_max : fallback.kaihi_max,
    taisen_max:
      primary.taisen_max > 0 ? primary.taisen_max : fallback.taisen_max,
    sakuteki_max:
      primary.sakuteki_max > 0 ? primary.sakuteki_max : fallback.sakuteki_max,
  };
}

function needsStatFallback(value: number[] | null | undefined): boolean {
  if (!Array.isArray(value) || value.length === 0) return true;
  return value.every((v) => !Number.isFinite(v) || v <= 0);
}

async function getLatestShipGrowthPeriod(): Promise<{
  period_tag: string;
  table_version: string;
} | null> {
  if (shipGrowthPeriodPromise) return shipGrowthPeriodPromise;
  shipGrowthPeriodPromise = (async () => {
    const res = await cachedFetch("/api/ship-growth/summary");
    if (!res.ok) return null;
    const json = (await res.json()) as ShipGrowthSummary;
    const latest = json.periods?.[0];
    return latest
      ? { period_tag: latest.period_tag, table_version: latest.table_version }
      : null;
  })().catch(() => null);
  return shipGrowthPeriodPromise;
}

async function getShipGrowthCaps(
  masterId: number,
): Promise<NormalizedShipGrowthCaps | null> {
  if (shipGrowthCapsCache.has(masterId))
    return shipGrowthCapsCache.get(masterId) ?? null;
  try {
    const latest = await getLatestShipGrowthPeriod();
    if (!latest) {
      shipGrowthCapsCache.set(masterId, null);
      return null;
    }
    const boundsRes = await cachedFetch(
      `/api/ship-growth/bounds?period_tag=${encodeURIComponent(latest.period_tag)}&table_version=${encodeURIComponent(latest.table_version)}&master_id=${masterId}`,
    );
    if (!boundsRes.ok) {
      shipGrowthCapsCache.set(masterId, null);
      return null;
    }
    const boundsJson = (await boundsRes.json()) as {
      caps?: ShipGrowthCaps[];
      bounds?: ShipGrowthBoundRow[];
    };
    const capFromCaps = normalizeShipGrowthCaps(
      (boundsJson.caps ?? []).find((row) => row.master_id === masterId) ?? null,
    );
    const capFromBounds = deriveShipGrowthCapsFromBounds(
      masterId,
      boundsJson.bounds ?? [],
    );
    const merged = mergeShipGrowthCaps(capFromCaps, capFromBounds);
    shipGrowthCapsCache.set(masterId, merged);
    return merged;
  } catch {
    shipGrowthCapsCache.set(masterId, null);
    return null;
  }
}

const isReadOnly = () => isWorkspaceReadOnly();

function prefetchCardOnce(url: string): void {
  if (prefetchedCardUrls.has(url)) return;
  prefetchedCardUrls.add(url);
  prefetchExternalUrlForExport(url);
}

function ProfBadge(props: { level: number; hovered?: boolean }): JSX.Element {
  const symbols = ["|", "|", "||", "|||", "\\", "\\\\", "\\\\\\", ">>"];
  const color = createMemo(() =>
    props.level <= 3 ? "#1976d2" : props.level <= 6 ? "#f57c00" : "#e65100",
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
        "text-shadow":
          "0 0 3px rgba(255,255,255,0.9), 0 0 6px rgba(255,255,255,0.7)",
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
        "text-shadow":
          "0 0 3px rgba(255,255,255,0.9), 0 0 6px rgba(255,255,255,0.7)",
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

  // createEffect is deferred until after the span ref is set, and re-runs
  // reactively whenever iconNum changes. Replaces the previous onMount +
  // createMemo anti-pattern (createMemo is for pure computations, not
  // side-effects; also called createWeaponIconEl twice on mount).
  createEffect(() => {
    host.replaceChildren(createWeaponIconEl(props.iconNum, 16));
  });

  return <span ref={host} class="shrink-0 inline-flex" />;
}

function DeleteIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" class="w-3.5 h-3.5">
      <path
        d="M4 4l8 8M12 4l-8 8"
        fill="none"
        stroke="currentColor"
        stroke-width="1.95"
        stroke-linecap="round"
      />
    </svg>
  );
}

// ── Slot equality helpers ──
// Each mutation emits a full deep-clone of all slots (state.ts:snapshotFleetState).
// Without a custom equality check every ShipCard re-evaluates its viewSlot memo
// and returns a new object reference, cascading into shipData recompute and a full
// "Show keyed" re-mount for all 24 slots even when only 1 changed.
// These helpers let the 23 unaffected slots skip the cascade entirely.

function shallowObjEqual(
  a: Record<string, number | undefined> | undefined,
  b: Record<string, number | undefined> | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

function fleetSlotEqual(
  prev: FleetSlot | null,
  next: FleetSlot | null,
): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;
  if (prev.shipId !== next.shipId || prev.shipLevel !== next.shipLevel)
    return false;
  if (
    prev.exSlotId !== next.exSlotId ||
    prev.exSlotImprovement !== next.exSlotImprovement
  )
    return false;
  const len = Math.max(prev.equipIds.length, next.equipIds.length);
  for (let i = 0; i < len; i++) {
    if (prev.equipIds[i] !== next.equipIds[i]) return false;
    if (prev.equipImprovement[i] !== next.equipImprovement[i]) return false;
    if (prev.equipProficiency[i] !== next.equipProficiency[i]) return false;
  }
  if (
    !shallowObjEqual(
      prev.statOverrides as Record<string, number | undefined> | undefined,
      next.statOverrides as Record<string, number | undefined> | undefined,
    )
  )
    return false;
  if (
    !shallowObjEqual(
      prev.instanceStats as Record<string, number | undefined> | undefined,
      next.instanceStats as Record<string, number | undefined> | undefined,
    )
  )
    return false;
  return true;
}

function airBaseSlotEqual(
  prev: AirBaseSlot | null,
  next: AirBaseSlot | null,
): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;
  const len = Math.max(prev.equipIds.length, next.equipIds.length);
  for (let i = 0; i < len; i++) {
    if (prev.equipIds[i] !== next.equipIds[i]) return false;
    if (prev.equipImprovement[i] !== next.equipImprovement[i]) return false;
    if (prev.equipProficiency[i] !== next.equipProficiency[i]) return false;
  }
  return true;
}

type StatDef = [
  label: string,
  key: string,
  base: number | null,
  max: number | null,
  isNumeric: boolean,
  fallbackBase?: number | null,
];

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
    .filter(
      (e): e is NonNullable<ReturnType<typeof getMasterSlotItem>> => e != null,
    );

  const sortieAircraft = equipped.filter(
    (e) => AIRCRAFT_TYPES.has(e.type?.[2] ?? -1) && (e.distance ?? 0) > 0,
  );
  if (sortieAircraft.length === 0) {
    return { baseRadius: 0, bonus: 0, finalRadius: 0 };
  }

  const baseRadius = Math.min(...sortieAircraft.map((e) => e.distance ?? 0));

  // Large flying boat (type 41) extends operational radius.
  const largeFlyingBoats = equipped.filter(
    (e) => (e.type?.[2] ?? -1) === 41 && (e.distance ?? 0) > 0,
  );
  let bonus = 0;
  if (largeFlyingBoats.length > 0) {
    const supportMax = Math.max(
      ...largeFlyingBoats.map((e) => e.distance ?? 0),
    );
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
  fallbackBase?: number | null;
  equipSums: Record<string, number>;
  equipBonuses: Record<string, number>;
  overrides: StatOverrides;
}): JSX.Element {
  const formatStatVal = (): string => {
    const ov = props.overrides[props.keyName];
    const baseVal = ov ?? props.base;
    if (baseVal == null) {
      return "-";
    }

    const bonusContrib = props.equipBonuses[props.keyName] || 0;
    const total =
      props.keyName === "leng"
        ? Math.max(baseVal, props.equipSums.leng || 0) + bonusContrib
        : baseVal + (props.equipSums[props.keyName] || 0) + bonusContrib;

    if (!props.isNumeric && props.keyName === "soku")
      return SPEED_NAMES[total] ?? String(total);
    if (!props.isNumeric && props.keyName === "leng")
      return RANGE_NAMES[total] ?? String(total);
    return String(total);
  };

  const bonusInfo = createMemo(() => {
    const eqStatVal = props.equipSums[props.keyName] || 0;
    const bonusVal = props.equipBonuses[props.keyName] || 0;
    const baseRef = props.base ?? props.fallbackBase ?? 0;
    const baseForDisplay = props.overrides[props.keyName] ?? baseRef;
    const effectiveEqDelta =
      props.keyName === "leng"
        ? Math.max(baseForDisplay, eqStatVal) - baseForDisplay
        : eqStatVal;
    const totalBonus = effectiveEqDelta + bonusVal;
    return { effectiveEqDelta, bonusVal, totalBonus, baseForDisplay };
  });

  return (
    <div class="grid grid-cols-[1.25rem_1fr_1.5rem] items-center gap-0 group/stat h-3.5 w-[5.9rem]">
      <span class="text-base-content/40 font-medium text-[10px]">
        {props.label}
      </span>

      <div class="flex items-center gap-0 justify-end min-w-0">
        <span
          class={`font-mono text-base-content/70 text-right tabular-nums w-[1.55rem] transition-colors text-[10px] ${
            props.overrides[props.keyName] != null
              ? "text-primary/80 font-bold"
              : ""
          }`}
          title={
            bonusInfo().totalBonus !== 0
              ? `素: ${bonusInfo().baseForDisplay}` +
                (bonusInfo().effectiveEqDelta
                  ? `, 装備: ${bonusInfo().effectiveEqDelta > 0 ? "+" : ""}${bonusInfo().effectiveEqDelta}`
                  : "") +
                (bonusInfo().bonusVal
                  ? `, ボーナス: ${bonusInfo().bonusVal > 0 ? "+" : ""}${bonusInfo().bonusVal}`
                  : "")
              : undefined
          }
        >
          {formatStatVal()}
        </span>
      </div>

      <span
        class="text-[10px] font-mono font-semibold tabular-nums leading-none w-6 text-left pl-px"
        style={{
          color:
            bonusInfo().totalBonus > 0
              ? "#b45309"
              : bonusInfo().totalBonus < 0
                ? "#c2410c"
                : undefined,
        }}
        title={
          bonusInfo().bonusVal !== 0
            ? `装備: ${bonusInfo().effectiveEqDelta > 0 ? "+" : ""}${bonusInfo().effectiveEqDelta}, ボーナス: ${
                bonusInfo().bonusVal > 0 ? "+" : ""
              }${bonusInfo().bonusVal}`
            : undefined
        }
      >
        {bonusInfo().totalBonus !== 0
          ? `${bonusInfo().totalBonus > 0 ? "+" : ""}${bonusInfo().totalBonus}`
          : ""}
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
  const viewSlot = createMemo(
    () => {
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
    },
    undefined,
    { equals: fleetSlotEqual },
  );

  const ship = createMemo(() => {
    const slot = viewSlot();
    return slot?.shipId != null ? getMasterShip(slot.shipId) : null;
  });

  const [shipGrowthCap, setShipGrowthCap] =
    createSignal<NormalizedShipGrowthCaps | null>(null);
  let shipGrowthFetchSeq = 0;
  createEffect(() => {
    const s = ship();
    const seq = ++shipGrowthFetchSeq;
    setShipGrowthCap(null);
    if (!s) return;

    const shouldLookupFallback =
      needsStatFallback(s.tais) ||
      needsStatFallback(s.kaih) ||
      needsStatFallback(s.saku);
    if (!shouldLookupFallback) return;

    void getShipGrowthCaps(s.id).then((cap) => {
      if (seq !== shipGrowthFetchSeq) return;
      setShipGrowthCap(cap);
    });
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
        ? computeEquipBonuses(
            slot.shipId,
            slot.equipIds,
            slot.exSlotId,
            slot.equipImprovement,
            slot.exSlotImprovement,
          )
        : {};
    const equipSums = computeEquipSum(slot.equipIds, slot.exSlotId);

    const leftStats: StatDef[] = [
      ["耐久", "taik", s.taik?.[0] ?? null, s.taik?.[1] ?? null, true],
      [
        "装甲",
        "souk",
        ist?.souk ?? s.souk?.[0] ?? null,
        s.souk?.[1] ?? null,
        true,
      ],
      [
        "回避",
        "kaih",
        ist?.kaih ?? null,
        null,
        true,
        shipGrowthCap()?.kaihi_max ?? null,
      ],
      [
        "搭載",
        "maxeq",
        s.maxeq ? s.maxeq.slice(0, slotCount).reduce((a, b) => a + b, 0) : null,
        null,
        true,
      ],
      ["速力", "soku", s.soku, 20, false],
      ["射程", "leng", s.leng, 5, false],
    ];

    const rightStats: StatDef[] = [
      [
        "火力",
        "houg",
        ist?.houg ?? s.houg?.[0] ?? null,
        s.houg?.[1] ?? null,
        true,
      ],
      [
        "雷装",
        "raig",
        ist?.raig ?? s.raig?.[0] ?? null,
        s.raig?.[1] ?? null,
        true,
      ],
      [
        "対空",
        "tyku",
        ist?.tyku ?? s.tyku?.[0] ?? null,
        s.tyku?.[1] ?? null,
        true,
      ],
      [
        "対潜",
        "tais",
        ist?.tais ?? s.tais?.[0] ?? null,
        s.tais?.[1] ?? null,
        true,
        shipGrowthCap()?.taisen_max ?? null,
      ],
      [
        "索敵",
        "saku",
        ist?.saku ?? null,
        null,
        true,
        shipGrowthCap()?.sakuteki_max ?? null,
      ],
      [
        "運",
        "luck",
        ist?.luck ?? s.luck?.[0] ?? null,
        s.luck?.[1] ?? null,
        true,
      ],
    ];

    return {
      s,
      slot,
      slotCount,
      leftStats,
      rightStats,
      equipBonuses,
      equipSums,
      statOverrides: slot.statOverrides ?? ({} as StatOverrides),
    };
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
            <span class="text-[10px] font-bold text-base-content/20">
              {props.idx + 1}
            </span>
            <div class="text-2xl leading-none text-base-content/15 group-hover:text-primary/50 transition-colors">
              +
            </div>
            <span class="text-[10px] text-base-content/20 group-hover:text-primary/40 transition-colors">
              艦を配置
            </span>
          </div>
        }
      >
        {(d) => {
          const imageUrl = cardUrl(d.slot.shipId!);
          if (imageUrl) prefetchCardOnce(imageUrl);
          const [cardImageUnavailable, setCardImageUnavailable] =
            createSignal(!imageUrl);
          const [exRowHovered, setExRowHovered] = createSignal(false);
          const [bulkEditOpen, setBulkEditOpen] = createSignal(false);
          const [bulkDraft, setBulkDraft] = createStore<Record<string, number>>(
            {},
          );
          const [overrideEnabled, setOverrideEnabled] = createSignal(false);

          const NON_EDITABLE_KEYS = new Set(["maxeq", "soku", "leng"]);
          const ZERO_FLOOR_STAT_KEYS = new Set(["tais", "kaih", "saku"]);
          const isEnemyShip = (d.slot.shipId ?? 0) >= 1500;

          const editableStats = createMemo(() => {
            return [...d.leftStats, ...d.rightStats].filter(
              (st) => st[4] && !NON_EDITABLE_KEYS.has(st[1]),
            );
          });

          const openBulkEdit = () => {
            if (isReadOnly()) return;
            const overrides = ensureFleetStatOverrides(liveSlot());
            const next: Record<string, number> = {};
            const allStats = [...d.leftStats, ...d.rightStats];
            for (const st of allStats) {
              const key = st[1];
              const baseRef = st[2] ?? st[5] ?? 0;
              next[key] = Number(overrides[key] ?? baseRef);
            }
            setBulkDraft(reconcile(next));
            setOverrideEnabled(false);
            setBulkEditOpen(true);
          };

          const setBulkValue = (key: string, value: number) => {
            setBulkDraft({ [key]: value });
          };

          const getBulkBounds = (st: StatDef): { lo: number; hi: number } => {
            const key = st[1];
            const baseRef = st[2] ?? st[5] ?? 0;
            const lo =
              ZERO_FLOOR_STAT_KEYS.has(key) || isEnemyShip ? 0 : baseRef;
            if (overrideEnabled()) return { lo, hi: Infinity };
            const normalHi = st[3] ?? st[5] ?? baseRef;
            const hi =
              key === "tais" ? Math.max(normalHi, baseRef + 9) : normalHi;
            return { lo, hi };
          };

          const bumpBulkValue = (st: StatDef, sign: 1 | -1) => {
            const key = st[1];
            const isNonEditable = NON_EDITABLE_KEYS.has(key);
            if (isNonEditable && !overrideEnabled()) return;
            const { lo, hi } = getBulkBounds(st);
            const step = st[1] === "soku" ? 5 : 1;
            const baseRef = st[2] ?? st[5] ?? 0;
            const cur = Number(bulkDraft[key] ?? baseRef);
            const next =
              hi === Infinity
                ? cur + step * sign
                : Math.max(lo, Math.min(hi, cur + step * sign));
            setBulkValue(key, next);
          };

          const saveBulkEdit = () => {
            const overrides = ensureFleetStatOverrides(liveSlot());
            const allStats = [...d.leftStats, ...d.rightStats];
            for (const st of allStats) {
              const key = st[1];
              const isNonEditable = NON_EDITABLE_KEYS.has(key);
              if (isNonEditable && !overrideEnabled()) continue;
              const baseRef = st[2] ?? st[5] ?? 0;
              const { lo, hi } = getBulkBounds(st);
              const raw = Number(bulkDraft[key] ?? baseRef);
              const next =
                hi === Infinity
                  ? raw
                  : Math.max(
                      lo,
                      Math.min(hi, Number.isFinite(raw) ? raw : baseRef),
                    );
              if (next === baseRef) delete overrides[key];
              else overrides[key] = next;
            }
            setBulkEditOpen(false);
            markSimulatorStateDirty("fleet");
          };

          // Fine-grained reactive component for each stat control.
          // Using a proper component (not a plain function) gives each control its own
          // reactive scope, so only the specific DOM attributes for the changed stat key
          // update on slider input — not the entire list.
          const BulkStatControl = (controlProps: { st: StatDef }) => {
            const st = controlProps.st;
            const key = st[1];
            const isNonEditable = NON_EDITABLE_KEYS.has(key);
            const isSpeedStat = key === "soku";
            const isRangeStat = key === "leng";
            const isLabeledStat = isSpeedStat || isRangeStat;
            const baseRef = st[2] ?? st[5] ?? 0;
            // Single memo so getBulkBounds (which reads overrideEnabled()) is
            // computed only once per reactive update instead of once per call site.
            const bounds = createMemo(() => getBulkBounds(st));
            const minVal = () => bounds().lo;
            const maxVal = () => bounds().hi;
            const isDisabled = () => isNonEditable && !overrideEnabled();
            const current = () => Number(bulkDraft[key] ?? baseRef);
            const pct = () => {
              const hi = maxVal();
              const lo = minVal();
              const cur = current();
              return hi <= lo || hi === Infinity
                ? 0
                : Math.max(0, Math.min(100, ((cur - lo) / (hi - lo)) * 100));
            };
            const labelMap = isSpeedStat ? SPEED_NAMES : RANGE_NAMES;
            const selectOptions = Object.entries(labelMap)
              .map(([value, label]) => [Number(value), label] as const)
              .sort((a, b) => a[0] - b[0]);

            return (
              <div
                class={`rounded-md border px-2 py-1.5 text-xs ${isDisabled() ? "border-base-200/30 bg-base-200/20 opacity-60" : "border-base-200/70 bg-base-100"}`}
              >
                {isLabeledStat ? (
                  <>
                    <div class="grid grid-cols-[1.75rem_1fr] items-center gap-2">
                      <span class="font-medium text-base-content/70">
                        {st[0]}
                      </span>
                      <div class="justify-self-end flex items-center justify-end leading-6">
                        <div class="w-30 flex items-center justify-end">
                          <select
                            class="select select-xs select-bordered h-6 py-0 px-2 w-24 text-xs"
                            value={String(current())}
                            disabled={isDisabled()}
                            onInput={(e) => {
                              if (isDisabled()) return;
                              const next = Number(
                                (e.currentTarget as HTMLSelectElement).value,
                              );
                              if (!Number.isFinite(next)) return;
                              setBulkValue(key, next);
                            }}
                          >
                            {selectOptions.map(([value, label]) => (
                              <option value={String(value)}>{label}</option>
                            ))}
                            {!selectOptions.some(
                              ([value]) => value === current(),
                            ) && (
                              <option value={String(current())}>
                                {labelMap[current()] ?? "不明"}
                              </option>
                            )}
                          </select>
                        </div>
                      </div>
                    </div>
                    {isDisabled() && (
                      <div class="mt-0.5 text-right text-[9px] text-base-content/40">
                        編集不可
                      </div>
                    )}
                  </>
                ) : (
                  <div>
                    <div class="grid grid-cols-[1.75rem_1fr] items-center gap-2">
                      <span class="font-medium text-base-content/70">
                        {st[0]}
                      </span>
                      <div class="justify-self-end flex items-center justify-end gap-1">
                        <div class="w-30 flex items-center justify-end gap-1">
                          <button
                            class="btn btn-ghost btn-xs h-5 min-h-0 px-1"
                            onClick={() => bumpBulkValue(st, -1)}
                            disabled={isDisabled()}
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min={String(minVal())}
                            value={String(current())}
                            class="input input-xs input-bordered w-14 text-center font-mono text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            disabled={isDisabled()}
                            onInput={(e) => {
                              if (isDisabled()) return;
                              const next = Number(
                                (e.currentTarget as HTMLInputElement).value,
                              );
                              if (!Number.isFinite(next)) return;
                              if (overrideEnabled()) {
                                setBulkValue(key, next);
                              } else {
                                setBulkValue(
                                  key,
                                  Math.max(minVal(), Math.min(maxVal(), next)),
                                );
                              }
                            }}
                          />
                          <button
                            class="btn btn-ghost btn-xs h-5 min-h-0 px-1"
                            onClick={() => bumpBulkValue(st, 1)}
                            disabled={isDisabled()}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                    {isDisabled() && (
                      <div class="mt-0.5 text-right text-[9px] text-base-content/40">
                        編集不可
                      </div>
                    )}
                  </div>
                )}
                {!isLabeledStat && (
                  <div class="mt-1">
                    {!isDisabled() ? (
                      <>
                        <input
                          type="range"
                          min={String(minVal())}
                          max={String(
                            maxVal() === Infinity ? minVal() + 1000 : maxVal(),
                          )}
                          value={String(
                            Math.min(
                              current(),
                              maxVal() === Infinity
                                ? minVal() + 1000
                                : maxVal(),
                            ),
                          )}
                          class="w-full h-1 align-middle cursor-pointer appearance-none rounded-none bg-base-300 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-0 [&::-webkit-slider-thumb]:h-0 [&::-moz-range-thumb]:w-0 [&::-moz-range-thumb]:h-0 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-transparent"
                          style={
                            {
                              background: `linear-gradient(to right, var(--color-primary) 0%, var(--color-primary) ${pct()}%, var(--color-base-300) ${pct()}%, var(--color-base-300) 100%)`,
                            } as any
                          }
                          onInput={(e) => {
                            const next = Number(
                              (e.currentTarget as HTMLInputElement).value,
                            );
                            setBulkValue(key, next);
                          }}
                        />
                        <div class="mt-0.5 flex items-center justify-between text-[9px] text-base-content/40 font-mono">
                          <span>min {minVal()}</span>
                          <span>
                            {maxVal() === Infinity
                              ? "max 制限外"
                              : key === "tais"
                                ? `max ${maxVal()}(+9)`
                                : `max ${maxVal()}`}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div class="text-[9px] text-base-content/40 font-mono">
                        編集不可
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          };

          createEffect(() => {
            setCardImageUnavailable(!imageUrl);
          });

          return (
            <>
              <div
                class="rounded-lg overflow-hidden border border-base-300/60 bg-base-100 group/card relative w-full max-w-md mx-auto"
                onMouseEnter={() => setCardHovered(true)}
                onMouseLeave={() => setCardHovered(false)}
              >
                <Show when={cardImageUnavailable()}>
                  <div class="absolute inset-0 z-0 flex items-center justify-end select-none pointer-events-none">
                    <div
                      class="h-full flex-none flex items-center justify-center"
                      style={{ "aspect-ratio": "327 / 450" }}
                    >
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
                        if (
                          selection.id !== currentShipId ||
                          selection.level !== undefined
                        ) {
                          applyShipSelectionAt(
                            props.fleetIndex,
                            props.idx,
                            selection,
                          );
                        }
                      });
                    }}
                  />
                </Show>

                <div
                  class="relative z-10 flex flex-col"
                  style={{
                    width: "62%",
                    background:
                      "linear-gradient(to right, var(--color-base-100) 75%, transparent 100%)",
                  }}
                >
                  <div
                    class="group/shiphead flex items-center gap-1.5 px-2 py-1 border-b border-base-200/60 cursor-pointer"
                    onClick={() => {
                      const currentShipId = liveSlot().shipId;
                      setShipModalTargetForFleet(props.fleetIndex, props.idx);
                      openShipModal(currentShipId, (selection) => {
                        if (
                          selection.id !== currentShipId ||
                          selection.level !== undefined
                        ) {
                          applyShipSelectionAt(
                            props.fleetIndex,
                            props.idx,
                            selection,
                          );
                        }
                      });
                    }}
                  >
                    <span class="text-[10px] font-bold bg-primary/15 text-primary rounded w-4 h-4 flex items-center justify-center shrink-0">
                      {props.idx + 1}
                    </span>
                    <span class="text-xs font-bold truncate flex-1 leading-tight">
                      {d.s.name}
                    </span>
                    <span class="text-[9px] px-1 py-0.5 rounded text-base-content/50 font-bold shrink-0">
                      {d.slot.shipLevel != null
                        ? `Lv.${d.slot.shipLevel}`
                        : "Lv.—"}
                    </span>
                    <span class="text-[9px] px-1 py-0.5 rounded bg-base-200/60 text-base-content/50 font-bold shrink-0">
                      {STYPE_SHORT[d.s.stype] ?? ""}
                    </span>
                    <button
                      class="w-5 h-5 inline-flex items-center justify-center leading-none rounded-md text-base-content/75 hover:text-primary transition-all duration-150 shrink-0"
                      title="諸元を一括編集"
                      onClick={(e) => {
                        e.stopPropagation();
                        openBulkEdit();
                      }}
                    >
                      <span class="text-[10px]">✎</span>
                    </button>
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
                        const equip =
                          isActive && d.slot.equipIds[i] != null
                            ? getMasterSlotItem(d.slot.equipIds[i]!)
                            : null;
                        const eqType2 = equip?.type?.[2] ?? 0;
                        const canShowProf =
                          equip && AIRCRAFT_TYPES.has(eqType2);

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
                              setEquipModalTargetForFleet(
                                props.fleetIndex,
                                props.idx,
                                i,
                              );
                              openEquipModal(current, (selection) => {
                                applyFleetEquipSelectionAt(
                                  props.fleetIndex,
                                  props.idx,
                                  i,
                                  selection,
                                );
                              });
                            }}
                          >
                            <span class="w-3 text-center text-[9px] text-base-content/25 font-mono shrink-0">
                              {isActive && d.s.maxeq?.[i] != null
                                ? String(d.s.maxeq[i])
                                : ""}
                            </span>

                            {equip ? (
                              <WeaponIcon iconNum={equip.type?.[3] ?? 0} />
                            ) : (
                              <div
                                style="width:16px;height:16px"
                                class="shrink-0"
                              ></div>
                            )}

                            <span
                              class={`truncate flex-1 leading-tight ${equip ? "text-base-content/80" : "text-base-content/15"}`}
                            >
                              {isActive ? (equip?.name ?? "—") : ""}
                            </span>

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
                                  <ProfBadge
                                    level={d.slot.equipProficiency[i] ?? 0}
                                    hovered={rowHovered()}
                                  />
                                </span>
                              ) : (
                                <span class="inline-block w-[2em]" />
                              )}

                              {equip ? (
                                <span
                                  title={`改修Lv${d.slot.equipImprovement[i] ?? 0} (クリックで変更)`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (isReadOnly()) return;
                                    cycleFleetEquipImprovement(liveSlot(), i);
                                  }}
                                >
                                  <ImpBadge
                                    level={d.slot.equipImprovement[i] ?? 0}
                                    hovered={rowHovered()}
                                  />
                                </span>
                              ) : (
                                <span class="inline-block w-[2.5em]" />
                              )}

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
                              ) : (
                                <span class="inline-block w-5 h-5" />
                              )}
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
                      setEquipModalTargetForFleet(
                        props.fleetIndex,
                        props.idx,
                        -1,
                      );
                      openEquipModal(current, (selection) => {
                        applyFleetExslotSelectionAt(
                          props.fleetIndex,
                          props.idx,
                          selection,
                        );
                      });
                    }}
                  >
                    <span class="text-[9px] text-warning/60 font-bold shrink-0 w-3 text-center">
                      補
                    </span>
                    {d.slot.exSlotId != null &&
                    getMasterSlotItem(d.slot.exSlotId) ? (
                      <WeaponIcon
                        iconNum={
                          getMasterSlotItem(d.slot.exSlotId!)?.type?.[3] ?? 0
                        }
                      />
                    ) : (
                      <div
                        style="width:16px;height:16px"
                        class="shrink-0"
                      ></div>
                    )}
                    <span
                      class={`truncate flex-1 leading-tight ${d.slot.exSlotId != null ? "text-base-content/80" : "text-base-content/15"}`}
                    >
                      {d.slot.exSlotId != null
                        ? (getMasterSlotItem(d.slot.exSlotId!)?.name ??
                          "補強増設")
                        : "補強増設"}
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
                          <ImpBadge
                            level={d.slot.exSlotImprovement ?? 0}
                            hovered={exRowHovered()}
                          />
                        </span>
                      ) : (
                        <span class="inline-block w-[2.5em]" />
                      )}
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
                      ) : (
                        <span class="inline-block w-5 h-5" />
                      )}
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
                            fallbackBase={ls[5] ?? null}
                            equipSums={d.equipSums}
                            equipBonuses={d.equipBonuses}
                            overrides={d.statOverrides}
                          />
                          <span></span>
                          <StatCell
                            label={rs[0]}
                            keyName={rs[1]}
                            base={rs[2]}
                            max={rs[3]}
                            isNumeric={rs[4]}
                            fallbackBase={rs[5] ?? null}
                            equipSums={d.equipSums}
                            equipBonuses={d.equipBonuses}
                            overrides={d.statOverrides}
                          />
                        </>
                      );
                    })}
                  </div>
                </div>
              </div>
              <Show when={bulkEditOpen()}>
                <div
                  class="fixed inset-0 z-120 bg-black/45 flex items-center justify-center p-3"
                  onClick={() => setBulkEditOpen(false)}
                >
                  <div
                    class="w-full max-w-xl bg-base-100 border border-base-300 rounded-lg shadow-lg"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div class="px-3 py-2.5 border-b border-base-200 flex items-center justify-between gap-2">
                      <h3 class="text-sm font-bold">諸元を一括編集</h3>
                      <div class="flex items-center gap-1.5">
                        <button
                          class={`px-2 py-1 text-xs rounded transition-colors ${overrideEnabled() ? "bg-warning/30 text-warning" : "bg-base-200 text-base-content"}`}
                          onClick={() => setOverrideEnabled(!overrideEnabled())}
                          title="有効化すると全パラメータを範囲外まで編集可能"
                        >
                          {overrideEnabled()
                            ? "制限外編集: ON"
                            : "制限外編集: OFF"}
                        </button>
                        <button
                          class="btn btn-ghost btn-xs w-6 h-6 min-h-0 p-0 flex items-center justify-center"
                          onClick={() => setBulkEditOpen(false)}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    <div class="max-h-[65vh] overflow-y-auto p-2.5">
                      {(() => {
                        const rowCount = Math.max(
                          d.leftStats.length,
                          d.rightStats.length,
                        );

                        return Array.from({ length: rowCount }).map(
                          (_, idx) => {
                            const ls = d.leftStats[idx] ?? null;
                            const rs = d.rightStats[idx] ?? null;

                            return (
                              <div class="grid grid-cols-2 gap-1.5">
                                {ls ? <BulkStatControl st={ls} /> : <div />}
                                {rs ? <BulkStatControl st={rs} /> : <div />}
                              </div>
                            );
                          },
                        );
                      })()}
                    </div>
                    <div class="px-3 py-2.5 border-t border-base-200 flex items-center justify-end gap-2">
                      <button
                        class="btn btn-ghost btn-sm h-8 min-h-0"
                        onClick={() => setBulkEditOpen(false)}
                      >
                        キャンセル
                      </button>
                      <button
                        class="btn btn-primary btn-sm h-8 min-h-0"
                        onClick={saveBulkEdit}
                      >
                        保存
                      </button>
                    </div>
                  </div>
                </div>
              </Show>
            </>
          );
        }}
      </Show>
    </ShipCardContext.Provider>
  );
}

function FleetSlotsView(props: { fleetIndex: 1 | 2 | 3 | 4 }): JSX.Element {
  // Each ShipCard subscribes to simulatorFleetState independently via useStore.
  // No top-level subscription needed here.
  return (
    <Index each={FLEET_SLOT_INDEXES}>
      {(idx) => <ShipCard fleetIndex={props.fleetIndex} idx={idx()} />}
    </Index>
  );
}

function AirBaseCard(props: { index: number }): JSX.Element {
  const $airbaseState = useStore(simulatorAirbaseState);
  const viewBase = createMemo(
    () => $airbaseState()[props.index] ?? null,
    undefined,
    { equals: airBaseSlotEqual },
  );
  const baseRadiusInfo = createMemo(() => {
    const base = viewBase();
    if (!base) return { baseRadius: 0, bonus: 0, finalRadius: 0 };
    return computeAirbaseActionRadius(base);
  });
  const hasSortieAircraft = createMemo(() => baseRadiusInfo().baseRadius > 0);

  return (
    <div class="border border-base-200 rounded-lg overflow-hidden">
      <div class="px-3 py-1.5 bg-base-200/30 border-b border-base-200/50 flex items-center justify-between gap-2">
        <span class="text-xs font-bold text-base-content/40">
          第{props.index + 1}基地
        </span>
        <span
          class="text-[10px] font-mono text-base-content/50"
          title={
            !hasSortieAircraft()
              ? "出撃可能な航空機が未配備"
              : baseRadiusInfo().bonus > 0
                ? `行動半径 ${baseRadiusInfo().baseRadius} + 大型飛行艇補正 ${baseRadiusInfo().bonus}`
                : undefined
          }
        >
          {hasSortieAircraft() ? baseRadiusInfo().finalRadius : "-"}
          {hasSortieAircraft() && baseRadiusInfo().bonus > 0
            ? ` (+${baseRadiusInfo().bonus})`
            : ""}
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
                <span class="w-3.5 text-center text-base-content/25 font-mono shrink-0">
                  {i + 1}
                </span>
                {equip() ? (
                  <WeaponIcon iconNum={equipIconNum()} />
                ) : (
                  <div style="width:16px;height:16px" class="shrink-0"></div>
                )}
                <span
                  class={`truncate flex-1 ${equip() ? "text-base-content/70" : "text-base-content/20 italic"}`}
                >
                  {equip()?.name ?? "—"}
                </span>

                <span class="ml-auto grid grid-cols-[2em_2.5em_2.5em_1.25rem] items-center justify-items-end gap-0.5 shrink-0">
                  {equipDistance() != null ? (
                    <span class="inline-flex items-center h-4 leading-none text-[10px] text-base-content/30 shrink-0">
                      {equipDistance()}
                    </span>
                  ) : (
                    <span class="inline-block w-[2.5em]" />
                  )}

                  {canShowProf() ? (
                    <span
                      title={`熟練度${prof()} (クリックで変更)`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isReadOnly()) return;
                        cycleAirBaseEquipProficiency(
                          getLiveAirBase(props.index),
                          i,
                        );
                      }}
                    >
                      <ProfBadge level={prof()} hovered={rowHovered()} />
                    </span>
                  ) : (
                    <span class="inline-block w-[2em]" />
                  )}

                  {equip() ? (
                    <span
                      title={`改修Lv${imp()} (クリックで変更)`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isReadOnly()) return;
                        cycleAirBaseEquipImprovement(
                          getLiveAirBase(props.index),
                          i,
                        );
                      }}
                    >
                      <ImpBadge level={imp()} hovered={rowHovered()} />
                    </span>
                  ) : (
                    <span class="inline-block w-[2.5em]" />
                  )}

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
                  ) : (
                    <span class="inline-block w-5 h-5" />
                  )}
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
  // Each AirBaseCard subscribes to simulatorAirbaseState independently via useStore.
  return (
    <Index each={AIRBASE_INDEXES}>{(i) => <AirBaseCard index={i()} />}</Index>
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

export function rerenderSolidSimulator(
  scope: SimulatorDirtyScope = "all",
): void {
  ensureSolidSimulatorMounted();
  markSimulatorStateDirty(scope);
}
