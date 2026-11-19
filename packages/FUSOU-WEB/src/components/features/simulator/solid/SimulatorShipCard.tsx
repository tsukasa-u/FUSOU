/** @jsxImportSource solid-js */
import { Index, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { useStore } from "@nanostores/solid";
import type { FleetSlot, StatOverrides } from "@/features/simulator/types";
import { AIRCRAFT_TYPES, RANGE_NAMES, SPEED_NAMES, STYPE_SHORT } from "@/features/simulator/constants";
import { cardUrl, computeEquipBonuses, computeEquipSum, computeSuppressedEquipIds } from "@/features/simulator/equip-calc";
import { cachedFetch } from "@/utils/fetchCache";
import { openEquipModal } from "@/features/simulator/equip-modal";
import { openShipModal } from "@/features/simulator/ship-modal";
import { applyFleetEquipSelection, applyFleetExslotSelection, applyShipSelectionToFleetSlot, assignShipToFleetSlot, cycleFleetEquipImprovement, cycleFleetEquipProficiency, cycleFleetExslotImprovement, ensureFleetStatOverrides, setEquipModalTargetForFleet, setFleetEquip, setFleetExslotEquip, setShipModalTargetForFleet } from "@/features/simulator/simulator-mutations";
import { markSimulatorStateDirty, simulatorFleetState } from "@/features/simulator/state";
import { getFleetState, getMasterShip, getMasterSlotItem, isWorkspaceReadOnly } from "@/features/simulator/simulator-selectors";
import type { NormalizedShipGrowthCaps } from "@/features/simulator/ship-growth-utils";
import { ShipGrowthBoundsResponseSchema, ShipGrowthSummaryResponseSchema, deriveShipGrowthCapsFromBounds, mergeShipGrowthCaps, needsStatFallback, normalizeShipGrowthCaps, selectLatestShipGrowthPeriod } from "@/features/simulator/ship-growth-utils";
import { DeleteIcon, EquipSlotControls, EquipSlotRow } from "@/features/simulator/solid/renderer-parts";
import {
  SimulatorBulkStatControl,
  SIMULATOR_NON_EDITABLE_STAT_KEYS,
  type SimulatorStatDef,
} from "@/components/features/simulator/solid/SimulatorBulkStatControl";
import { SimulatorEmptyShipSlot } from "@/components/features/simulator/solid/SimulatorEmptyShipSlot";

const FLEET_EQUIP_SLOT_INDEXES = [0, 1, 2, 3, 4] as const;
const SHIP_CARD_IMAGE_ASPECT_RATIO = 327 / 450;
const MIN_SHIP_CARD_STATS_WIDTH = 220;
const isReadOnly = () => isWorkspaceReadOnly();
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


export function SimulatorShipCard(props: {
  fleetIndex: 1 | 2 | 3 | 4;
  idx: number;
}): JSX.Element {
  const liveSlot = () => getLiveFleetSlot(props.fleetIndex, props.idx);
  const [cardHovered, setCardHovered] = createSignal(false);
  const [cardElement, setCardElement] = createSignal<HTMLDivElement>();
  const [statsTableWidth, setStatsTableWidth] = createSignal("100%");

  createEffect(() => {
    const element = cardElement();
    if (!element) return;

    const updateStatsTableWidth = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (width <= 0 || height <= 0) return;

      const imageWidth = Math.min(width, height * SHIP_CARD_IMAGE_ASPECT_RATIO);
      const minWidth = Math.min(width, MIN_SHIP_CARD_STATS_WIDTH);
      setStatsTableWidth(`${Math.max(minWidth, width - imageWidth)}px`);
    };

    const observer = new ResizeObserver(updateStatsTableWidth);
    observer.observe(element);
    updateStatsTableWidth();
    onCleanup(() => observer.disconnect());
  });

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

    const leftStats: SimulatorStatDef[] = [
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

    const rightStats: SimulatorStatDef[] = [
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
      <Show
        when={shipData()}
        keyed
        fallback={
          <SimulatorEmptyShipSlot
            fleetIndex={props.fleetIndex}
            idx={props.idx}
            onSelect={() => {
              if (isReadOnly()) return;
              setShipModalTargetForFleet(props.fleetIndex, props.idx);
              openShipModal(null, (selection) => {
                applyShipSelectionAt(props.fleetIndex, props.idx, selection);
              });
            }}
          />
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

          const getBulkBounds = (st: SimulatorStatDef): { lo: number; hi: number } => {
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

          const bumpBulkValue = (st: SimulatorStatDef, sign: 1 | -1) => {
            const key = st[1];
            const isNonEditable = SIMULATOR_NON_EDITABLE_STAT_KEYS.has(key);
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
              const isNonEditable = SIMULATOR_NON_EDITABLE_STAT_KEYS.has(key);
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

          const renderBulkStatControl = (st: SimulatorStatDef | null) => {
            if (!st) return <div />;
            const key = st[1];
            const baseRef = st[2] ?? st[5] ?? 0;
            return (
              <SimulatorBulkStatControl
                st={st}
                current={() => Number(bulkDraft[key] ?? baseRef)}
                getBounds={() => getBulkBounds(st)}
                overrideEnabled={overrideEnabled}
                onValueChange={(value) => setBulkValue(key, value)}
                onBump={(sign) => bumpBulkValue(st, sign)}
              />
            );
          };

          createEffect(() => {
            setCardImageUnavailable(!imageUrl);
          });

          return (
            <>
              <div
                ref={setCardElement}
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

                  <div
                    class="grid grid-cols-2 gap-x-1.5 gap-y-0 px-2 py-0 text-[10px] border-t border-base-200/50 leading-none w-full"
                    style={{ width: statsTableWidth() }}
                  >
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
                                {renderBulkStatControl(ls)}
                                {renderBulkStatControl(rs)}
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
  );
}
