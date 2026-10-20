/** @jsxImportSource solid-js */

import {
  Index,
  Show,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
} from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { useStore } from "@nanostores/solid";
import { WeaponIcon } from "@/components/features/simulator/solid/shared-ui";
import type {
  AirBaseSlot,
  FleetSlot,
  StatOverrides,
} from "@/features/simulator/types";
import {
  AIRCRAFT_TYPES,
  RANGE_NAMES,
  SPEED_NAMES,
  STYPE_SHORT,
} from "@/features/simulator/constants";
import {
  cardUrl,
  computeEquipBonuses,
  computeEquipSum,
  computeSuppressedEquipIds,
} from "@/features/simulator/equip-calc";
import { cachedFetch } from "@/utils/fetchCache";
import { openShipModal } from "@/features/simulator/ship-modal";
import { openEquipModal } from "@/features/simulator/equip-modal";
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
} from "@/features/simulator/simulator-mutations";
import {
  markSimulatorStateDirty,
  simulatorFleetState,
  simulatorAirbaseState,
  simulatorDisplayRevision,
  type SimulatorDirtyScope,
} from "@/features/simulator/state";
import {
  getAirBaseState,
  getFleetState,
  getVisibleAirbaseCount,
  getMasterShip,
  getMasterSlotItem,
  isWorkspaceReadOnly,
} from "@/features/simulator/simulator-selectors";
import type {
  NormalizedShipGrowthCaps,
} from "@/features/simulator/ship-growth-utils";
import {
  ShipGrowthBoundsResponseSchema,
  ShipGrowthSummaryResponseSchema,
  selectLatestShipGrowthPeriod,
  normalizeShipGrowthCaps,
  deriveShipGrowthCapsFromBounds,
  mergeShipGrowthCaps,
  needsStatFallback,
} from "@/features/simulator/ship-growth-utils";

const FLEET_SLOT_INDEXES = [0, 1, 2, 3, 4, 5] as const;
const STRIKE_FLEET_SLOT_INDEXES = [0, 1, 2, 3, 4, 5, 6] as const;
const FLEET_EQUIP_SLOT_INDEXES = [0, 1, 2, 3, 4] as const;
const AIRBASE_INDEXES = [0, 1, 2] as const;
const AIRBASE_EQUIP_SLOT_INDEXES = [0, 1, 2, 3] as const;

let shipGrowthPeriodPromise: Promise<{
  period_tag: string;
  table_version: string;
} | null> | null = null;
const shipGrowthCapsCache = new Map<number, NormalizedShipGrowthCaps | null>();


async function getLatestShipGrowthPeriod(): Promise<{
  period_tag: string;
  table_version: string;
} | null> {
  if (shipGrowthPeriodPromise) return shipGrowthPeriodPromise;
  shipGrowthPeriodPromise = (async () => {
    const res = await cachedFetch("/api/ship-growth/summary");
    if (!res.ok) return null;
    const parsed = ShipGrowthSummaryResponseSchema.safeParse(await res.json());
    if (!parsed.success || !parsed.data.ok) return null;
    const json = parsed.data;
    return selectLatestShipGrowthPeriod(json.periods);
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
      `/api/ship-growth/bounds?period_tag=${encodeURIComponent(latest.period_tag)}&table_version=${encodeURIComponent(latest.table_version)}`,
    );
    if (!boundsRes.ok) {
      shipGrowthCapsCache.set(masterId, null);
      return null;
    }
    const parsed = ShipGrowthBoundsResponseSchema.safeParse(
      await boundsRes.json(),
    );
    if (!parsed.success || !parsed.data.ok) {
      shipGrowthCapsCache.set(masterId, null);
      return null;
    }
    const boundsJson = parsed.data;
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


function ProfBadge(props: { level: number; hovered?: boolean }): JSX.Element {
  const symbols = ["", "|", "||", "|||", "\\", "\\\\", "\\\\\\", ">>"];
  const nextLevel = createMemo(() => (props.level >= 7 ? 0 : props.level + 1));
  const nextSymbol = createMemo(() => symbols[nextLevel()]);

  const colorClass = createMemo(() => {
    if (props.level <= 0) {
      // レベル0（未設定）時：クリックしたら遷移する先（Lv.1: |）の青色破線プレビュー
      return "text-blue-400/80 bg-base-100/95 border-dashed border-blue-400/50 hover:text-blue-300 hover:border-blue-400 hover:bg-blue-500/15 shadow-2xs";
    }
    if (props.level <= 3) return "text-blue-400 bg-base-100/90 border-blue-500/40 hover:bg-blue-500/25 hover:border-blue-400 shadow-2xs";
    if (props.level <= 6) return "text-amber-400 bg-base-100/90 border-amber-500/40 hover:bg-amber-500/25 hover:border-amber-400 shadow-2xs";
    return "text-orange-400 bg-base-100/90 border-orange-500/50 hover:bg-orange-500/25 hover:border-orange-400 font-extrabold shadow-2xs";
  });

  const isVisible = () => props.level > 0 || props.hovered;

  const displayText = () => {
    if (props.level > 0) return symbols[props.level] ?? ">>";
    // 0は表示せず、クリックしたら遷移する先の状態（"|"）を表示
    return symbols[1];
  };

  // 文字列の横幅圧縮（長体）：文字数（1文字・2文字・3文字）によらず熟練度バッジ全体の表示幅を均一に揃える
  const textScaleStyle = createMemo((): JSX.CSSProperties | undefined => {
    const text = displayText() ?? "";
    if (text.length >= 3) {
      // "|||", "\\\" など3文字
      return {
        display: "inline-block",
        transform: "scaleX(0.72)",
        "transform-origin": "center center",
      };
    }
    if (text.length === 2) {
      // "||", "\\", ">>" など2文字
      return {
        display: "inline-block",
        transform: "scaleX(0.88)",
        "transform-origin": "center center",
      };
    }
    return {
      display: "inline-block",
    };
  });

  const tooltipText = () => {
    if (props.level === 0) {
      return `熟練度: なし (クリックで「${symbols[1]}」に設定)`;
    }
    if (props.level >= 7) {
      return "熟練度: Lv.7 (>>) (クリックで解除)";
    }
    return `熟練度: Lv.${props.level} (${symbols[props.level]}) (クリックで「${nextSymbol()}」へ)`;
  };

  return (
    <span
      class={`shrink-0 cursor-pointer select-none text-[10px] leading-none font-mono font-bold inline-flex items-center justify-center w-7 h-4 px-0.5 rounded border transition-all duration-150 ${colorClass()} ${
        isVisible() ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
      }`}
      title={tooltipText()}
    >
      <span style={textScaleStyle()}>{displayText()}</span>
    </span>
  );
}

function ImpBadge(props: { level: number; hovered?: boolean }): JSX.Element {
  const isMax = () => props.level >= 10;
  const isVisible = () => props.level > 0 || props.hovered;

  const styleClass = createMemo(() => {
    if (props.level <= 0) {
      return "text-base-content/60 bg-base-100/95 border-dashed border-base-300 hover:text-teal-300 hover:border-teal-400/70 hover:bg-teal-500/15 shadow-2xs";
    }
    if (isMax()) {
      return "text-teal-300 bg-base-100/90 border-teal-400/60 hover:bg-teal-500/25 hover:border-teal-300 font-extrabold shadow-2xs";
    }
    return "text-teal-400 bg-base-100/90 border-teal-500/40 hover:bg-teal-500/25 hover:border-teal-400 shadow-2xs";
  });

  const displayText = () => {
    if (props.level <= 0) return "★0";
    if (isMax()) return "MAX";
    return `★${props.level}`;
  };

  // MAXの横幅を長体圧縮し、★9（全角1文字+半角数字1文字）と完全に同一の幅に揃える
  const textScaleStyle = createMemo((): JSX.CSSProperties | undefined => {
    if (isMax()) {
      return {
        display: "inline-block",
        transform: "scaleX(0.78)",
        "transform-origin": "center center",
        "letter-spacing": "-0.04em",
      };
    }
    return {
      display: "inline-block",
    };
  });

  return (
    <span
      class={`shrink-0 cursor-pointer select-none text-[10px] leading-none font-mono font-bold inline-flex items-center justify-center w-7 h-4 px-0.5 rounded border transition-all duration-150 ${styleClass()} ${
        isVisible() ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
      }`}
      title={
        props.level === 0
          ? "改修値: ★0 (クリックで★1へ)"
          : isMax()
            ? "改修値: MAX (クリックで★0へ)"
            : `改修値: ★${props.level} (クリックで${props.level + 1 === 10 ? "MAX" : `★${props.level + 1}`}へ)`
      }
    >
      <span style={textScaleStyle()}>{displayText()}</span>
    </span>
  );
}

function EditIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      class="w-3.5 h-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M11.5 2.5a1.77 1.77 0 0 1 2.5 2.5L5.5 13.5 2 14.5l1-3.5L11.5 2.5z" />
    </svg>
  );
}

function DeleteIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" class="w-3.5 h-3.5 shrink-0">
      <path
        d="M4 4l8 8M12 4l-8 8"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
      />
    </svg>
  );
}

interface EquipSlotControlsProps {
  /** 基地航空隊の行動半径 */
  distance?: number | null;
  /** 航空機スロットで熟練度を表示・操作可能か */
  canShowProf?: boolean;
  profLevel?: number;
  onCycleProf?: () => void;
  /** 装備が存在し改修値を表示・操作可能か */
  hasEquip?: boolean;
  impLevel?: number;
  onCycleImp?: () => void;
  /** 削除ボタンを表示・操作可能か */
  canDelete?: boolean;
  deleteTitle?: string;
  onDelete?: () => void;
  /** 行がホバーされているか */
  rowHovered: boolean;
  /** カード全体がホバーされているか */
  cardHovered?: boolean;
}

function EquipSlotControls(props: EquipSlotControlsProps): JSX.Element {
  return (
    <span class="ml-auto flex items-center justify-end gap-1 shrink-0">
      {props.distance !== undefined ? (
        props.distance != null ? (
          <span
            class="inline-flex items-center justify-center w-6 h-4 leading-none text-[10px] text-base-content/40 font-mono shrink-0 select-none"
            title={`行動半径: ${props.distance}`}
          >
            {props.distance}
          </span>
        ) : (
          <span class="w-6 shrink-0" />
        )
      ) : null}

      {props.canShowProf ? (
        <span
          class="shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            if (isReadOnly()) return;
            props.onCycleProf?.();
          }}
        >
          <ProfBadge level={props.profLevel ?? 0} hovered={props.rowHovered} />
        </span>
      ) : null}

      {props.hasEquip ? (
        <span
          class="shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            if (isReadOnly()) return;
            props.onCycleImp?.();
          }}
        >
          <ImpBadge level={props.impLevel ?? 0} hovered={props.rowHovered} />
        </span>
      ) : (
        <span class="w-7 shrink-0" />
      )}

      {props.canDelete ? (
        <button
          class={`w-5 h-5 inline-flex items-center justify-center leading-none rounded-md bg-base-100/90 backdrop-blur-xs border border-base-300/80 text-base-content/75 hover:bg-error hover:text-error-content hover:border-error shadow-2xs active:scale-90 transition-all duration-150 cursor-pointer shrink-0 ${
            props.rowHovered || props.cardHovered
              ? "opacity-100 scale-100"
              : "opacity-0 scale-95 pointer-events-none"
          }`}
          title={props.deleteTitle}
          onClick={(e) => {
            e.stopPropagation();
            if (isReadOnly()) return;
            props.onDelete?.();
          }}
        >
          <DeleteIcon />
        </button>
      ) : (
        <span class="w-5 h-5 shrink-0" />
      )}
    </span>
  );
}

interface EquipSlotRowProps {
  /** 左端のインデックス（機数、中隊番号、"補" など） */
  indexText: string;
  indexColorClass?: string | undefined;
  /** 装備アイコン番号（null/0/undefinedなら空き枠） */
  iconNum?: number | null | undefined;
  /** 装備名（null/undefinedなら emptyLabel を表示） */
  equipName?: string | null | undefined;
  emptyLabel?: string | undefined;
  /** 他装備によるシナジー低下警告 */
  isSuppressed?: boolean | undefined;
  /** クリック時のコールバック */
  onClick: () => void;
  title: string;
  disabled?: boolean | undefined;
  borderTopDashed?: boolean | undefined;
  /** 行ホバー状態を外部（EquipSlotControls）に伝えるための signal */
  onHoverChange?: ((hovered: boolean) => void) | undefined;
  /** 右側のコントロールコンポーネント */
  children: JSX.Element;
}

function EquipSlotRow(props: EquipSlotRowProps): JSX.Element {
  const hasEquip = () => Boolean(props.equipName);

  return (
    <div
      class={`group/slot flex items-center gap-1.5 px-2 h-7 text-xs cursor-pointer transition-colors ${
        props.disabled
          ? "opacity-40 select-none cursor-default"
          : "hover:bg-base-200/50"
      } ${props.borderTopDashed ? "border-t border-dashed border-base-200/60" : ""}`}
      title={props.title}
      onMouseEnter={() => props.onHoverChange?.(true)}
      onMouseLeave={() => props.onHoverChange?.(false)}
      onClick={props.onClick}
    >
      <span
        class={`w-4 text-center text-[10px] font-mono shrink-0 select-none leading-none inline-flex items-center justify-center ${
          props.indexColorClass ?? "text-base-content/30"
        }`}
      >
        {props.indexText}
      </span>

      {props.iconNum != null && props.iconNum > 0 ? (
        <WeaponIcon iconNum={props.iconNum} />
      ) : (
        <div style="width:16px;height:16px" class="shrink-0" />
      )}

      <span
        class={`truncate flex-1 text-[11px] leading-none inline-flex items-center gap-1 min-w-0 ${
          hasEquip()
            ? "text-base-content/85 group-hover/slot:text-primary transition-colors font-medium"
            : "text-base-content/30 italic"
        }`}
      >
        <span class="truncate">
          {props.equipName ?? (props.emptyLabel ?? "未配備")}
        </span>
        <Show when={props.isSuppressed}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            class="w-3.5 h-3.5 text-error shrink-0"
          >
            <title>他装備の影響によりシナジーが低下しています</title>
            <path
              fill-rule="evenodd"
              d="M8 2a.75.75 0 0 1 .75.75v8.69l3.22-3.22a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.22 3.22V2.75A.75.75 0 0 1 8 2Z"
              clip-rule="evenodd"
            />
          </svg>
        </Show>
      </span>

      {props.children}
    </div>
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
  const slot = getLiveFleet(fleetIndex)[idx];
  if (!slot) {
    throw new Error(`Fleet slot ${fleetIndex}:${idx} is unavailable`);
  }
  return slot;
}

function getLiveAirBase(index: number): AirBaseSlot {
  const base = getAirBaseState()[index];
  if (!base) {
    throw new Error(`Air base ${index} is unavailable`);
  }
  return base;
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
    const equipSumVal = props.equipSums[props.keyName] || 0;
    const bonusContrib = props.equipBonuses[props.keyName] || 0;

    if (baseVal == null) {
      // For range, fall back to equipment-derived value when ship master `leng` is null.
      if (props.keyName === "leng" && (equipSumVal > 0 || bonusContrib !== 0)) {
        const total = equipSumVal + bonusContrib;
        if (!props.isNumeric) return RANGE_NAMES[total] ?? String(total);
        return String(total);
      }
      return "-";
    }

    const total =
      props.keyName === "leng"
        ? Math.max(baseVal, equipSumVal) + bonusContrib
        : baseVal + equipSumVal + bonusContrib;

    if (!props.isNumeric && props.keyName === "soku")
      return SPEED_NAMES[total] ?? String(total);
    if (!props.isNumeric && props.keyName === "leng")
      return RANGE_NAMES[total] ?? String(total);
    return String(total);
  };

  const statText = createMemo(() => formatStatVal());

  // 文字列の横方向直接圧縮（長体 / 水平スケーリング）
  // 射程「超長」「超長+」、速力「高速+」などの複数文字テキストを文字の高さや太さを保ったままスマートに圧縮
  const textTransformStyle = createMemo((): JSX.CSSProperties | undefined => {
    const text = statText();
    if (text.length >= 3) {
      // "超長+", "高速+" など 3文字以上
      return {
        display: "inline-block",
        transform: "scaleX(0.72)",
        "transform-origin": "right center",
      };
    }
    if (text.length >= 2 && !props.isNumeric) {
      // "超長", "高速", "低速", "最速" など 2文字
      return {
        display: "inline-block",
        transform: "scaleX(0.85)",
        "transform-origin": "right center",
      };
    }
    return undefined;
  });

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
    <div class="grid grid-cols-[1.25rem_1fr_1.25rem] items-center gap-0 group/stat h-3.5 w-full min-w-0">
      <span class="text-base-content/40 font-medium text-[10px] whitespace-nowrap select-none">
        {props.label}
      </span>

      <div class="flex items-center gap-0 justify-end min-w-0 pr-0.5 overflow-visible">
        <span
          class={`font-mono text-base-content/70 text-right tabular-nums whitespace-nowrap transition-colors text-[10px] ${
            props.overrides[props.keyName] != null
              ? "text-primary/80 font-bold"
              : ""
          }`}
          style={textTransformStyle()}
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
          {statText()}
        </span>
      </div>

      <span
        class="text-[10px] font-mono font-semibold tabular-nums leading-none w-5 text-left pl-px whitespace-nowrap overflow-visible"
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
    const suppressedEquipIds =
      slot.shipId != null
        ? computeSuppressedEquipIds(
            slot.shipId,
            slot.equipIds,
            slot.exSlotId
          )
        : new Set<number>();

    const leftStats: StatDef[] = [
      ["耐久", "taik", s.taik?.[0] ?? null, s.taik?.[1] ?? null, true],
      [
        "装甲",
        "souk",
        ist?.["souk"] ?? s["souk"]?.[0] ?? null,
        s["souk"]?.[1] ?? null,
        true,
      ],
      [
        "回避",
        "kaih",
        ist?.["kaih"] ?? null,
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
        ist?.["houg"] ?? s["houg"]?.[0] ?? null,
        s["houg"]?.[1] ?? null,
        true,
      ],
      [
        "雷装",
        "raig",
        ist?.["raig"] ?? s["raig"]?.[0] ?? null,
        s["raig"]?.[1] ?? null,
        true,
      ],
      [
        "対空",
        "tyku",
        ist?.["tyku"] ?? s["tyku"]?.[0] ?? null,
        s["tyku"]?.[1] ?? null,
        true,
      ],
      [
        "対潜",
        "tais",
        ist?.["tais"] ?? s["tais"]?.[0] ?? null,
        s["tais"]?.[1] ?? null,
        true,
        shipGrowthCap()?.taisen_max ?? null,
      ],
      [
        "索敵",
        "saku",
        ist?.["saku"] ?? null,
        null,
        true,
        shipGrowthCap()?.sakuteki_max ?? null,
      ],
      [
        "運",
        "luck",
        ist?.["luck"] ?? s["luck"]?.[0] ?? null,
        s["luck"]?.[1] ?? null,
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
      suppressedEquipIds,
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
            title={`第${props.fleetIndex}艦隊 ${props.idx + 1}番艦: クリックして艦を配置`}
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
                      <span class="font-medium text-base-content/70 whitespace-nowrap">
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
                      <span class="font-medium text-base-content/70 whitespace-nowrap">
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
                            }
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
                      if (isReadOnly()) return;
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
                    width: "65%",
                    background:
                      "linear-gradient(to right, var(--color-base-100) 0%, var(--color-base-100) 80%, color-mix(in oklch, var(--color-base-100) 65%, transparent) 92%, transparent 100%)",
                  }}
                >
                  <div
                    class="group/shiphead flex items-center gap-1.5 px-2 py-1 border-b border-base-200/60 cursor-pointer hover:bg-base-200/50 transition-colors"
                    title="クリックして艦を変更"
                    onClick={() => {
                      if (isReadOnly()) return;
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
                    <span class="text-xs font-bold truncate flex-1 leading-tight group-hover/shiphead:text-primary transition-colors">
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
                      class={`w-5 h-5 inline-flex items-center justify-center leading-none rounded-md bg-base-100/90 backdrop-blur-xs border border-base-300/80 text-base-content/75 hover:bg-primary hover:text-primary-content hover:border-primary shadow-2xs active:scale-90 transition-all duration-150 shrink-0 cursor-pointer ${cardHovered() ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"}`}
                      title="艦の諸元（Lv・運・改修値）を一括編集"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isReadOnly()) return;
                        openBulkEdit();
                      }}
                    >
                      <EditIcon />
                    </button>
                    <button
                      class={`w-5 h-5 inline-flex items-center justify-center leading-none rounded-md bg-base-100/90 backdrop-blur-xs border border-base-300/80 text-base-content/75 hover:bg-error hover:text-error-content hover:border-error shadow-2xs active:scale-90 transition-all duration-150 shrink-0 cursor-pointer ${cardHovered() ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"}`}
                      title="この艦を編成から外す"
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
                          <EquipSlotRow
                            indexText={isActive && d.s.maxeq?.[i] != null ? String(d.s.maxeq[i]) : ""}
                            iconNum={equip?.type?.[3]}
                            equipName={isActive ? (equip?.name ?? null) : null}
                            emptyLabel={isActive ? "空きスロット" : ""}
                            isSuppressed={Boolean(equip && d.suppressedEquipIds.has(equip.id))}
                            disabled={!isActive}
                            title={
                              isActive
                                ? equip
                                  ? `${equip.name} (クリックして装備を変更)`
                                  : "空きスロット (クリックして装備を配置)"
                                : "スロットなし"
                            }
                            onHoverChange={setRowHovered}
                            onClick={() => {
                              if (!isActive) return;
                              const current = liveSlot().equipIds[i] ?? null;
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
                            <EquipSlotControls
                              canShowProf={Boolean(canShowProf)}
                              profLevel={d.slot.equipProficiency[i] ?? 0}
                              onCycleProf={() => cycleFleetEquipProficiency(liveSlot(), i)}
                              hasEquip={equip != null}
                              impLevel={d.slot.equipImprovement[i] ?? 0}
                              onCycleImp={() => cycleFleetEquipImprovement(liveSlot(), i)}
                              canDelete={equip != null && !isReadOnly()}
                              deleteTitle="この装備を外す"
                              onDelete={() => setFleetEquip(liveSlot(), i, null)}
                              rowHovered={rowHovered()}
                              cardHovered={cardHovered()}
                            />
                          </EquipSlotRow>
                        );
                      }}
                    </Index>
                  </div>

                  <EquipSlotRow
                    indexText="補"
                    indexColorClass="text-warning/80 font-bold"
                    iconNum={
                      d.slot.exSlotId != null
                        ? getMasterSlotItem(d.slot.exSlotId)?.type?.[3]
                        : null
                    }
                    equipName={
                      d.slot.exSlotId != null
                        ? (getMasterSlotItem(d.slot.exSlotId)?.name ?? "補強増設")
                        : null
                    }
                    emptyLabel="補強増設"
                    isSuppressed={Boolean(
                      d.slot.exSlotId != null &&
                        d.suppressedEquipIds.has(d.slot.exSlotId!),
                    )}
                    borderTopDashed={true}
                    title={
                      d.slot.exSlotId != null
                        ? `${getMasterSlotItem(d.slot.exSlotId)?.name ?? "補強増設"} (クリックして装備を変更)`
                        : "補強増設 (クリックして装備を配置)"
                    }
                    onHoverChange={setExRowHovered}
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
                    <EquipSlotControls
                      canShowProf={false}
                      hasEquip={d.slot.exSlotId != null}
                      impLevel={d.slot.exSlotImprovement ?? 0}
                      onCycleImp={() => cycleFleetExslotImprovement(liveSlot())}
                      canDelete={d.slot.exSlotId != null && !isReadOnly()}
                      deleteTitle="補強増設の装備を外す"
                      onDelete={() => setFleetExslotEquip(liveSlot(), null)}
                      rowHovered={exRowHovered()}
                      cardHovered={cardHovered()}
                    />
                  </EquipSlotRow>

                  <div class="grid grid-cols-2 gap-x-1.5 gap-y-0 px-2 py-0 text-[10px] border-t border-base-200/50 leading-none w-full">
                    {d.leftStats.map((ls, r) => {
                      const rs = d.rightStats[r];
                      if (!rs) return null;
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

export function FleetSlotsView(props: { fleetIndex: 1 | 2 | 3 | 4 }): JSX.Element {
  // Each ShipCard subscribes to simulatorFleetState independently via useStore.
  // 第3艦隊は遊撃艦隊として最大7隻編成に対応
  const indexes = () => (props.fleetIndex === 3 ? STRIKE_FLEET_SLOT_INDEXES : FLEET_SLOT_INDEXES);
  return (
    <Index each={indexes()}>
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
              <EquipSlotRow
                indexText={String(i + 1)}
                iconNum={equipIconNum()}
                equipName={equip()?.name}
                emptyLabel="未配備"
                title={
                  equip()
                    ? `${equip()?.name} (クリックして航空機を変更)`
                    : "空き中隊 (クリックして航空機を配備)"
                }
                onHoverChange={setRowHovered}
                onClick={() => {
                  const current = getLiveAirBase(props.index).equipIds[i] ?? null;
                  if (isReadOnly() && current == null) return;
                  setEquipModalTargetForAirBase(props.index, i);
                  openEquipModal(current, (selection) => {
                    applyAirBaseEquipSelectionAt(props.index, i, selection);
                  });
                }}
              >
                <EquipSlotControls
                  distance={equipDistance()}
                  canShowProf={canShowProf()}
                  profLevel={prof()}
                  onCycleProf={() =>
                    cycleAirBaseEquipProficiency(
                      getLiveAirBase(props.index),
                      i,
                    )
                  }
                  hasEquip={equip() != null}
                  impLevel={imp()}
                  onCycleImp={() =>
                    cycleAirBaseEquipImprovement(
                      getLiveAirBase(props.index),
                      i,
                    )
                  }
                  canDelete={equip() != null && !isReadOnly()}
                  deleteTitle="この基地航空隊の装備を外す"
                  onDelete={() => setAirBaseEquip(getLiveAirBase(props.index), i, null)}
                  rowHovered={rowHovered()}
                  cardHovered={false}
                />
              </EquipSlotRow>
            );
          }}
        </Index>
      </div>
    </div>
  );
}

export function AirBaseView(): JSX.Element {
  const displayRev = useStore(simulatorDisplayRevision);
  const count = createMemo(() => { displayRev(); return getVisibleAirbaseCount(); });
  return (
    <Index each={AIRBASE_INDEXES.slice(0, count())}>{(i) => <AirBaseCard index={i()} />}</Index>
  );
}

export function ensureSolidSimulatorMounted(): void {
  // Now handled declaratively by SimulatorFleetTab.tsx
}

export function rerenderSolidSimulator(
  scope: SimulatorDirtyScope = "all",
): void {
  ensureSolidSimulatorMounted();
  markSimulatorStateDirty(scope);
}
