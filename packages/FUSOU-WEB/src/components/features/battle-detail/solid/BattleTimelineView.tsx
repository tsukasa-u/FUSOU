/** @jsxImportSource solid-js */
import { For, Show, createSignal, createMemo } from "solid-js";
import type { JSX } from "solid-js";
import type {
  BattleFleets,
  MstShipRecord,
  MstSlotItemRecord,
  TimelineEvent,
} from "@/features/battles/types";
import {
  FRIEND_COLORS,
  ENEMY_COLORS,
  DAMAGE_ZONES,
} from "@/features/battles/constants";
import {
  buildTimelineEvents,
  buildInitialHps,
} from "@/features/battles/timeline";
import { shipNameFromIndex, slotItemMeta, WeaponIcon } from "./ui";

// ── Layout & visual constants ─────────────────────────────────────────────

const LINE_H = 20;
const BASE_ROW_H = 28;
const CHART_W = 400;
const BRIDGE_W = 28;
const PAD_L = 10;
const PAD_R = 10;
const PAD_TOP = 26;
const PAD_BOT = 10;
const INNER_W = CHART_W - PAD_L - PAD_R;

/** Minimum vertical clearance (px) between consecutive diagonal segments. */
const MIN_DIAG_GAP = 10;
/**
 * Constant dy/dx slope for ALL diagonal HP transitions.
 * Sized so even a full 100% -> 0% drop fits within BASE_ROW_H - MIN_DIAG_GAP
 * without ever expanding single-ship row heights.
 */
const DIAG_SLOPE = (BASE_ROW_H - MIN_DIAG_GAP) / INNER_W;

/** Distinct color palettes for combined-fleet 2nd / escort fleets. */
const F2_COLORS = [
  "#10b981",
  "#14b8a6",
  "#22c55e",
  "#06b6d4",
  "#34d399",
  "#2dd4bf",
];
const E2_COLORS = [
  "#ec4899",
  "#eab308",
  "#a855f7",
  "#f472b6",
  "#facc15",
  "#c084fc",
];

function xHP(pct: number): number {
  return PAD_L + (pct / 100) * INNER_W;
}

function calcDiagDy(xFrom: number, xTo: number): number {
  return Math.abs(xTo - xFrom) * DIAG_SLOPE;
}

function shipPosLabel(
  side: "friend" | "enemy",
  idx: number,
  isCombined: boolean,
): string {
  if (side === "friend") {
    if (!isCombined) return `F${idx + 1}`;
    return idx < 6 ? `1-${idx + 1}` : `2-${idx - 5}`;
  }
  if (!isCombined) return `E${idx + 1}`;
  return idx < 6 ? `主${idx + 1}` : `随${idx - 5}`;
}

function shipLineStyle(
  side: "friend" | "enemy",
  idx: number,
): { color: string; dash: string | undefined } {
  if (side === "friend") {
    if (idx < 6) {
      return {
        color: FRIEND_COLORS[idx % FRIEND_COLORS.length] ?? "#3b82f6",
        dash: undefined,
      };
    }
    return {
      color: F2_COLORS[(idx - 6) % F2_COLORS.length] ?? "#10b981",
      dash: "3,2",
    };
  }
  if (idx < 6) {
    return {
      color: ENEMY_COLORS[idx % ENEMY_COLORS.length] ?? "#ef4444",
      dash: "6,2",
    };
  }
  return {
    color: E2_COLORS[(idx - 6) % E2_COLORS.length] ?? "#ec4899",
    dash: "2,2",
  };
}

function isNightPhase(phase: string): boolean {
  return (
    phase === "夜戦" ||
    phase === "友軍艦隊攻撃" ||
    phase === "夜間支援攻撃"
  );
}

// ── Grouped Timeline Row Model (supports multi-attacker & multi-defender) ─

interface ActorEntry {
  side: "friend" | "enemy" | "friendly_force" | "support" | "airbase";
  idx: number | null;
  pos: string;
  name: string;
  toneClass: string;
}

interface DefenderEntry {
  side: "friend" | "enemy" | "friendly_force";
  idx: number | null;
  pos: string;
  name: string;
  toneClass: string;
  damage: number;
  crit: boolean;
}

type TimelineDisplayRow =
  | {
      isPhaseHeader: true;
      phase: string;
      isLegacyAirbase: boolean;
    }
  | {
      isPhaseHeader: false;
      phase: string;
      actorRole: "main" | "airbase" | "support" | "friendly_force";
      attackers: ActorEntry[];
      defenders: DefenderEntry[];
      slotIds: number[];
    };

interface RowGeometry {
  top: number;
  baseH: number;
  centerY: number;
}

interface HpSnapshot {
  fHps: Array<number | null>;
  eHps: Array<number | null>;
}

function mstShipName(
  mstShipById: Map<number, MstShipRecord> | null | undefined,
  mstId: number | undefined,
): string | null {
  if (!mstId || !mstShipById) return null;
  const row = mstShipById.get(mstId);
  return row && typeof row["name"] === "string" && row["name"]
    ? row["name"]
    : null;
}

function toPositiveSlotIds(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function buildDisplayRows(
  rawEvents: TimelineEvent[],
  fleets: BattleFleets | null,
  mstShipById: Map<number, MstShipRecord> | null | undefined,
  mstSlotItemById: Map<number, MstSlotItemRecord> | null,
  fCombined: boolean,
  eCombined: boolean,
  legacyAirbasePhases: Set<string>,
): TimelineDisplayRow[] {
  const validEvents = rawEvents.filter((ev) => ev && ev.separator !== true);
  const grouped: Array<Extract<TimelineDisplayRow, { isPhaseHeader: false }>> =
    [];

  const resolveDefender = (
    ev: TimelineEvent,
  ): DefenderEntry | null => {
    const isFriendlyForceCounter =
      ev.actorRole === "friendly_force" && ev.defenderSide === "friend";
    if (isFriendlyForceCounter) {
      const idx = ev.defenderIdx;
      return {
        side: "friendly_force",
        idx: null,
        pos: idx !== null ? `友${idx + 1}` : "友軍",
        name: idx !== null ? `友軍${idx + 1}番艦` : "友軍艦隊",
        toneClass: "text-success",
        damage: ev.damage,
        crit: ev.crit,
      };
    }
    if (ev.defenderIdx === null) {
      return {
        side: ev.defenderSide,
        idx: null,
        pos: "-",
        name: "対象なし",
        toneClass: "text-base-content/45",
        damage: ev.damage,
        crit: ev.crit,
      };
    }
    const combined = ev.defenderSide === "friend" ? fCombined : eCombined;
    return {
      side: ev.defenderSide,
      idx: ev.defenderIdx,
      pos: shipPosLabel(ev.defenderSide, ev.defenderIdx, combined),
      name: shipNameFromIndex(ev.defenderSide, ev.defenderIdx, fleets),
      toneClass: ev.defenderSide === "friend" ? "text-info" : "text-error",
      damage: ev.damage,
      crit: ev.crit,
    };
  };

  let i = 0;
  while (i < validEvents.length) {
    const ev = validEvents[i]!;
    const role = ev.actorRole ?? "main";

    // Group coordinated salvos: air attacks sharing (phase, airBatchId, attackerSide), or support attacks in the same phase
    const isAirSalvo = ev.type === "air" && ev.airBatchId != null;
    const isSupportSalvo = role === "support";

    if (isAirSalvo || isSupportSalvo) {
      const batch: TimelineEvent[] = [ev];
      let j = i + 1;
      while (j < validEvents.length) {
        const next = validEvents[j]!;
        const sameGroup = isAirSalvo
          ? next.phase === ev.phase &&
            next.type === "air" &&
            next.airBatchId === ev.airBatchId &&
            next.attackerSide === ev.attackerSide
          : next.phase === ev.phase && (next.actorRole ?? "main") === "support";
        if (!sameGroup) break;
        batch.push(next);
        j++;
      }

      const attackers: ActorEntry[] = [];
      const seenAttackerKey = new Set<string>();
      const slotIds: number[] = [];

      for (const b of batch) {
        for (const sid of toPositiveSlotIds(b.slotItems)) {
          if (!slotIds.includes(sid)) slotIds.push(sid);
        }
        if (role === "support") {
          if (b.attackerMstShipId) {
            const key = `sup-${b.attackerMstShipId}`;
            if (!seenAttackerKey.has(key)) {
              seenAttackerKey.add(key);
              attackers.push({
                side: "support",
                idx: null,
                pos: `支${attackers.length + 1}`,
                name:
                  mstShipName(mstShipById, b.attackerMstShipId) ??
                  `艦ID:${b.attackerMstShipId}`,
                toneClass: "text-warning",
              });
            }
          }
        } else if (role === "airbase") {
          const baseNo = b.airbaseBaseNo ?? b.airbaseBaseNos?.[0] ?? null;
          const pos = baseNo ? `基地${baseNo}` : "基地";
          const bSlots = toPositiveSlotIds(b.slotItems);
          if (bSlots.length > 0) {
            for (const sid of bSlots) {
              const key = `ab-${pos}-${sid}`;
              if (!seenAttackerKey.has(key)) {
                seenAttackerKey.add(key);
                const meta = slotItemMeta(sid, mstSlotItemById);
                attackers.push({
                  side: "airbase",
                  idx: null,
                  pos,
                  name: meta.name || `装備#${sid}`,
                  toneClass: "text-info",
                });
              }
            }
          } else {
            const key = `ab-${pos}`;
            if (!seenAttackerKey.has(key)) {
              seenAttackerKey.add(key);
              attackers.push({
                side: "airbase",
                idx: null,
                pos,
                name: baseNo ? `第${baseNo}基地航空隊` : "基地航空隊",
                toneClass: "text-info",
              });
            }
          }
        } else {
          const group = Array.isArray(b.attackerGroup)
            ? b.attackerGroup.filter(
                (v) => Number.isFinite(Number(v)) && Number(v) >= 0,
              )
            : [];
          const combined = b.attackerSide === "friend" ? fCombined : eCombined;
          for (const shipIdx of group) {
            const key = `${b.attackerSide}-${shipIdx}`;
            if (!seenAttackerKey.has(key)) {
              seenAttackerKey.add(key);
              attackers.push({
                side: b.attackerSide,
                idx: shipIdx,
                pos: shipPosLabel(b.attackerSide, shipIdx, combined),
                name: shipNameFromIndex(b.attackerSide, shipIdx, fleets),
                toneClass:
                  b.attackerSide === "friend" ? "text-info" : "text-error",
              });
            }
          }
        }
      }

      if (attackers.length === 0) {
        if (role === "support") {
          attackers.push({
            side: "support",
            idx: null,
            pos: ev.phase === "夜間支援攻撃" ? "夜支" : "支援",
            name: ev.phase === "夜間支援攻撃" ? "夜間支援艦隊" : "支援艦隊",
            toneClass: "text-warning",
          });
        } else if (role === "airbase") {
          attackers.push({
            side: "airbase",
            idx: null,
            pos: "基地",
            name: "基地航空隊",
            toneClass: "text-info",
          });
        } else {
          attackers.push({
            side: ev.attackerSide,
            idx: null,
            pos: "航空",
            name: ev.attackerSide === "friend" ? "味方航空隊" : "敵航空隊",
            toneClass:
              ev.attackerSide === "friend" ? "text-info" : "text-error",
          });
        }
      }

      const defenders = batch
        .map(resolveDefender)
        .filter((d): d is DefenderEntry => d !== null);

      grouped.push({
        isPhaseHeader: false,
        phase: ev.phase,
        actorRole: role,
        attackers,
        defenders,
        slotIds,
      });
      i = j;
      continue;
    }

    // Individual attack row (may still have multiple attackers e.g. concentrated torpedo)
    const attackers: ActorEntry[] = [];
    const combined = ev.attackerSide === "friend" ? fCombined : eCombined;

    if (role === "friendly_force" && ev.attackerSide === "friend") {
      const ffName =
        mstShipName(mstShipById, ev.attackerMstShipId) ??
        (ev.attackerIdx !== null ? `友軍${ev.attackerIdx + 1}番艦` : "友軍艦隊");
      attackers.push({
        side: "friendly_force",
        idx: null,
        pos: ev.attackerIdx !== null ? `友${ev.attackerIdx + 1}` : "友軍",
        name: ffName,
        toneClass: "text-success",
      });
    } else if (ev.attackerIdx !== null) {
      attackers.push({
        side: ev.attackerSide,
        idx: ev.attackerIdx,
        pos: shipPosLabel(ev.attackerSide, ev.attackerIdx, combined),
        name: shipNameFromIndex(ev.attackerSide, ev.attackerIdx, fleets),
        toneClass: ev.attackerSide === "friend" ? "text-info" : "text-error",
      });
    } else if (Array.isArray(ev.attackerGroup) && ev.attackerGroup.length > 0) {
      for (const shipIdx of ev.attackerGroup) {
        if (!Number.isFinite(Number(shipIdx)) || shipIdx < 0) continue;
        attackers.push({
          side: ev.attackerSide,
          idx: shipIdx,
          pos: shipPosLabel(ev.attackerSide, shipIdx, combined),
          name: shipNameFromIndex(ev.attackerSide, shipIdx, fleets),
          toneClass: ev.attackerSide === "friend" ? "text-info" : "text-error",
        });
      }
    } else if (ev.attackerMstShipId) {
      attackers.push({
        side: ev.attackerSide,
        idx: null,
        pos: ev.attackerSide === "friend" ? "味方" : "敵",
        name:
          mstShipName(mstShipById, ev.attackerMstShipId) ??
          `艦ID:${ev.attackerMstShipId}`,
        toneClass: ev.attackerSide === "friend" ? "text-info" : "text-error",
      });
    } else {
      attackers.push({
        side: ev.attackerSide,
        idx: null,
        pos: ev.type === "raigeki" ? "雷撃" : "-",
        name: ev.attackerSide === "friend" ? "味方艦" : "敵艦",
        toneClass: ev.attackerSide === "friend" ? "text-info" : "text-error",
      });
    }

    const defender = resolveDefender(ev);
    grouped.push({
      isPhaseHeader: false,
      phase: ev.phase,
      actorRole: role,
      attackers,
      defenders: defender ? [defender] : [],
      slotIds: toPositiveSlotIds(ev.slotItems),
    });
    i++;
  }

  // Insert a dedicated Phase Header Row before every phase
  const rows: TimelineDisplayRow[] = [];
  let prevPhase = "";
  for (const row of grouped) {
    if (row.phase !== prevPhase) {
      rows.push({
        isPhaseHeader: true,
        phase: row.phase,
        isLegacyAirbase: legacyAirbasePhases.has(row.phase),
      });
      prevPhase = row.phase;
    }
    rows.push(row);
  }
  return rows;
}

function buildStepsForRows(
  rows: TimelineDisplayRow[],
  fInit: Array<number | null>,
  eInit: Array<number | null>,
): HpSnapshot[] {
  const steps: HpSnapshot[] = [];
  const fCur = [...fInit];
  const eCur = [...eInit];
  steps.push({ fHps: [...fCur], eHps: [...eCur] });

  for (const row of rows) {
    if (!row.isPhaseHeader) {
      for (const d of row.defenders) {
        if (d.side === "friend" && d.idx !== null) {
          const cur = fCur[d.idx];
          if (cur !== null && cur !== undefined) {
            fCur[d.idx] = Math.max(0, cur - d.damage);
          }
        } else if (d.side === "enemy" && d.idx !== null) {
          const cur = eCur[d.idx];
          if (cur !== null && cur !== undefined) {
            eCur[d.idx] = Math.max(0, cur - d.damage);
          }
        }
      }
    }
    steps.push({ fHps: [...fCur], eHps: [...eCur] });
  }
  return steps;
}

function rowTouchesShip(row: TimelineDisplayRow, shipKey: string | null): boolean {
  if (!shipKey || row.isPhaseHeader) return false;
  const [side, idxStr] = shipKey.split("-");
  const idx = Number(idxStr);
  return (
    row.attackers.some((a) => a.side === side && a.idx === idx) ||
    row.defenders.some((d) => d.side === side && d.idx === idx)
  );
}

// ── Legend Group sub-component ────────────────────────────────────────────

function LegendGroup(props: {
  label: string;
  toneClass: string;
  side: "friend" | "enemy";
  startIdx: number;
  endIdx: number;
  isCombined: boolean;
  fleets: BattleFleets | null;
  selectedShip: string | null;
  onToggleShip: (key: string) => void;
}): JSX.Element {
  const indices = createMemo(() => {
    const out: number[] = [];
    for (let i = props.startIdx; i < props.endIdx; i++) out.push(i);
    return out;
  });

  return (
    <div class="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10.5px]">
      <span class={`font-semibold w-12 shrink-0 ${props.toneClass}`}>
        {props.label}
      </span>
      <For each={indices()}>
        {(si) => {
          const style = shipLineStyle(props.side, si);
          const key = `${props.side}-${si}`;
          const isSelected = () => props.selectedShip === key;
          const isDimmed = () =>
            props.selectedShip !== null && props.selectedShip !== key;
          const name = createMemo(() =>
            shipNameFromIndex(props.side, si, props.fleets),
          );
          return (
            <button
              type="button"
              class={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border cursor-pointer transition-all ${
                isSelected()
                  ? "bg-base-200 border-base-content/40"
                  : "bg-transparent border-transparent hover:bg-base-200/60"
              }`}
              style={{ opacity: isDimmed() ? 0.42 : 1 }}
              onClick={() => props.onToggleShip(key)}
            >
              <svg width="14" height="4" class="shrink-0">
                <line
                  x1="0"
                  y1="2"
                  x2="14"
                  y2="2"
                  stroke={style.color}
                  stroke-width="2"
                  stroke-dasharray={style.dash}
                />
              </svg>
              <span class="font-mono text-[9.5px] text-base-content/55">
                {shipPosLabel(props.side, si, props.isCombined)}
              </span>
              <span class="truncate max-w-[72px] text-base-content/85">
                {name()}
              </span>
            </button>
          );
        }}
      </For>
    </div>
  );
}

// ── Main Timeline Component ───────────────────────────────────────────────

export default function BattleTimelineView(props: {
  battle: Record<string, unknown>;
  fleets: BattleFleets | null;
  mstSlotItemById: Map<number, MstSlotItemRecord> | null;
  mstShipById?: Map<number, MstShipRecord> | null;
  showPhaseSeparators?: boolean;
  showLegacyAirbasePhaseWarning?: boolean;
}): JSX.Element {
  const [hoveredRow, setHoveredRow] = createSignal<number | null>(null);
  const [selectedRow, setSelectedRow] = createSignal<number | null>(null);
  const [selectedShip, setSelectedShip] = createSignal<string | null>(null);

  const rawEvents = createMemo(() =>
    buildTimelineEvents(props.battle, props.fleets),
  );
  const initHps = createMemo(() => buildInitialHps(props.battle));

  const fCount = createMemo(
    () => props.fleets?.friendlyShips?.length || initHps().fInit.length || 6,
  );
  const eCount = createMemo(
    () => props.fleets?.enemyShips?.length || initHps().eInit.length || 6,
  );
  const fCombined = createMemo(() => fCount() > 6);
  const eCombined = createMemo(() => eCount() > 6);

  const legacyAirbasePhases = createMemo(() => {
    if (!props.showLegacyAirbasePhaseWarning) return new Set<string>();
    return new Set(
      rawEvents()
        .filter((ev) => ev.separator !== true && ev.actorRole === "airbase")
        .map((ev) => ev.phase),
    );
  });

  const rows = createMemo(() =>
    buildDisplayRows(
      rawEvents(),
      props.fleets,
      props.mstShipById,
      props.mstSlotItemById,
      fCombined(),
      eCombined(),
      legacyAirbasePhases(),
    ),
  );

  const steps = createMemo(() =>
    buildStepsForRows(rows(), initHps().fInit, initHps().eInit),
  );

  const maxHpFor = (side: "friend" | "enemy", idx: number): number | null => {
    const ship = (
      side === "friend" ? props.fleets?.friendlyShips : props.fleets?.enemyShips
    )?.[idx];
    const initArr = side === "friend" ? initHps().fInit : initHps().eInit;
    const m = ship?.maxhp ?? initArr[idx] ?? null;
    return m !== null && m > 0 ? m : null;
  };

  // Compute exact row vertical geometry:
  // Row height depends ONLY on ship line count (never stretched by diagonal length).
  const layout = createMemo(() => {
    const rList = rows();
    const geom: RowGeometry[] = [];
    let curY = PAD_TOP;

    for (let ri = 0; ri < rList.length; ri++) {
      const r = rList[ri]!;
      const lineCount = r.isPhaseHeader
        ? 1
        : Math.max(r.attackers.length, r.defenders.length, 1);
      const baseH = lineCount === 1 ? BASE_ROW_H : lineCount * LINE_H + 8;
      geom.push({
        top: curY,
        baseH,
        centerY: curY + baseH / 2,
      });
      curY += baseH;
    }

    return {
      geom,
      bodyEndY: curY,
      bodyH: curY - PAD_TOP,
      chartH: curY + PAD_BOT,
    };
  });

  // Build SVG polyline path for each ship (constant slope, centered around row centerY)
  const buildShipPolyline = (side: "friend" | "enemy", si: number) => {
    const hpKey = side === "friend" ? "fHps" : "eHps";
    const mHp = maxHpFor(side, si);
    const { color, dash } = shipLineStyle(side, si);
    const sList = steps();
    const { geom, bodyEndY } = layout();

    if (!mHp) return null;
    const initHp = sList[0]?.[hpKey]?.[si];
    if (initHp == null) return null;

    const initX = xHP(Math.min(100, (initHp / mHp) * 100));
    let d = `M ${initX.toFixed(1)} ${PAD_TOP.toFixed(1)}`;
    let prevX = initX;

    for (let ri = 0; ri < geom.length; ri++) {
      const g = geom[ri]!;
      const hp = sList[ri + 1]?.[hpKey]?.[si];
      if (hp == null) continue;
      const curX = xHP(Math.min(100, (hp / mHp) * 100));
      if (Math.abs(curX - prevX) < 0.1) {
        d += ` L ${curX.toFixed(1)} ${g.centerY.toFixed(1)}`;
      } else {
        const halfDy = calcDiagDy(prevX, curX) / 2;
        const yFrom = g.centerY - halfDy;
        const yTo = g.centerY + halfDy;
        d += ` L ${prevX.toFixed(1)} ${yFrom.toFixed(1)} L ${curX.toFixed(1)} ${yTo.toFixed(1)}`;
      }
      prevX = curX;
    }

    const endY = bodyEndY + 4;
    d += ` L ${prevX.toFixed(1)} ${endY.toFixed(1)}`;
    const lastHp = sList.at(-1)?.[hpKey]?.[si];
    const sunk = lastHp != null && lastHp <= 0;

    return {
      key: `${side}-${si}`,
      d,
      color,
      dash,
      startX: initX,
      endX: prevX,
      endY,
      sunk,
    };
  };

  const shipLines = createMemo(() => {
    const out: Array<NonNullable<ReturnType<typeof buildShipPolyline>>> = [];
    for (let i = 0; i < fCount(); i++) {
      const line = buildShipPolyline("friend", i);
      if (line) out.push(line);
    }
    for (let i = 0; i < eCount(); i++) {
      const line = buildShipPolyline("enemy", i);
      if (line) out.push(line);
    }
    return out;
  });

  // Diagonal drop highlights for BOTH pinned selectedRow and hoveredRow
  const activeDrops = createMemo(() => {
    const targets: Array<{ ri: number; pinned: boolean }> = [];
    const sel = selectedRow();
    const hov = hoveredRow();
    if (sel !== null) targets.push({ ri: sel, pinned: true });
    if (hov !== null && hov !== sel) targets.push({ ri: hov, pinned: false });

    const rList = rows();
    const sList = steps();
    const { geom } = layout();

    const segments: Array<{
      xFrom: number;
      yFrom: number;
      xTo: number;
      yTo: number;
      centerY: number;
      color: string;
      pinned: boolean;
      isMiss: boolean;
    }> = [];

    for (const { ri, pinned } of targets) {
      const r = rList[ri];
      const g = geom[ri];
      if (!r || r.isPhaseHeader || !g) continue;
      for (const d of r.defenders) {
        if ((d.side !== "friend" && d.side !== "enemy") || d.idx === null) {
          continue;
        }
        const hpKey = d.side === "friend" ? "fHps" : "eHps";
        const mHp = maxHpFor(d.side, d.idx);
        const before = sList[ri]?.[hpKey]?.[d.idx];
        const after = sList[ri + 1]?.[hpKey]?.[d.idx];
        if (!mHp || before == null || after == null) continue;
        const xFrom = xHP(Math.min(100, (before / mHp) * 100));
        const xTo = xHP(Math.min(100, (after / mHp) * 100));
        const halfDy = calcDiagDy(xFrom, xTo) / 2;
        const { color } = shipLineStyle(d.side, d.idx);
        segments.push({
          xFrom,
          yFrom: g.centerY - halfDy,
          xTo,
          yTo: g.centerY + halfDy,
          centerY: g.centerY,
          color,
          pinned,
          isMiss: Math.abs(xTo - xFrom) < 0.1,
        });
      }
    }
    return segments;
  });

  const toggleShip = (key: string) => {
    setSelectedShip((prev) => (prev === key ? null : key));
  };

  const toggleRow = (ri: number) => {
    setSelectedRow((prev) => (prev === ri ? null : ri));
  };

  return (
    <Show
      when={rows().length > 0}
      fallback={
        <div class="text-center text-base-content/40 py-8 text-sm">
          詳細イベントなし
        </div>
      }
    >
      <div class="space-y-2.5">
        {/* Status & Clear Selection Bar */}
        <div class="flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <span class="text-base-content/55">
            <span class="md:hidden">
              凡例または折れ線タップで艦のHP推移を強調（各攻撃の詳細は「フェーズ」タブで確認できます）
            </span>
            <span class="hidden md:inline">
              凡例・折れ線クリックで艦を絞り込み／グラフ・行クリックで選択固定
            </span>
          </span>
          <Show
            when={selectedShip() !== null || selectedRow() !== null}
            fallback={
              <span class="text-[10.5px] text-base-content/40">
                全艦 等透明度表示中
              </span>
            }
          >
            <button
              type="button"
              class="px-2 py-0.5 rounded border border-base-300 bg-base-200/80 text-[11px] font-medium text-base-content hover:bg-base-200 cursor-pointer"
              onClick={() => {
                setSelectedShip(null);
                setSelectedRow(null);
              }}
            >
              選択解除（すべて等透明度で表示）
            </button>
          </Show>
        </div>

        {/* Grouped Legend (Combined Fleet splits 1st/2nd & Main/Escort) */}
        <div class="space-y-1 pb-2.5 border-b border-base-300/60 select-none">
          <Show
            when={fCombined()}
            fallback={
              <LegendGroup
                label="味方艦隊"
                toneClass="text-info"
                side="friend"
                startIdx={0}
                endIdx={fCount()}
                isCombined={false}
                fleets={props.fleets}
                selectedShip={selectedShip()}
                onToggleShip={toggleShip}
              />
            }
          >
            <LegendGroup
              label="味方 第1"
              toneClass="text-info"
              side="friend"
              startIdx={0}
              endIdx={6}
              isCombined={true}
              fleets={props.fleets}
              selectedShip={selectedShip()}
              onToggleShip={toggleShip}
            />
            <LegendGroup
              label="味方 第2"
              toneClass="text-success"
              side="friend"
              startIdx={6}
              endIdx={fCount()}
              isCombined={true}
              fleets={props.fleets}
              selectedShip={selectedShip()}
              onToggleShip={toggleShip}
            />
          </Show>

          <Show
            when={eCombined()}
            fallback={
              <LegendGroup
                label="敵艦隊"
                toneClass="text-error"
                side="enemy"
                startIdx={0}
                endIdx={eCount()}
                isCombined={false}
                fleets={props.fleets}
                selectedShip={selectedShip()}
                onToggleShip={toggleShip}
              />
            }
          >
            <LegendGroup
              label="敵 主力"
              toneClass="text-error"
              side="enemy"
              startIdx={0}
              endIdx={6}
              isCombined={true}
              fleets={props.fleets}
              selectedShip={selectedShip()}
              onToggleShip={toggleShip}
            />
            <LegendGroup
              label="敵 随伴"
              toneClass="text-warning"
              side="enemy"
              startIdx={6}
              endIdx={eCount()}
              isCombined={true}
              fleets={props.fleets}
              selectedShip={selectedShip()}
              onToggleShip={toggleShip}
            />
          </Show>
        </div>

        <Show when={legacyAirbasePhases().size > 0}>
          <div class="rounded border border-warning/50 bg-warning/10 px-2.5 py-1.5 text-[11px] text-warning-content/90">
            0.6.0 未満の既知不具合: 基地航空隊が関与するフェーズの参照解決は正確でない可能性があります。
          </div>
        </Show>

        {/* Main Timeline Body:
            - Mobile (< md): Full-width responsive HP graph only (Option 1: clean overview)
            - Desktop (md+): Left SVG chart + Bridge + Strictly aligned right event list */}
        <div class="md:overflow-x-auto">
          <div class="flex md:min-w-[920px]">
            {/* Left SVG HP Trajectory Chart (full-width on mobile, fixed CHART_W on md+) */}
            <div class="w-full md:w-[400px] shrink-0 select-none">
              <svg
                width={CHART_W}
                height={layout().chartH}
                viewBox={`0 0 ${CHART_W} ${layout().chartH}`}
                class="block w-full md:w-[400px] h-auto text-base-content"
                style="overflow:visible;"
              >
                {/* Damage zone backgrounds */}
                <For each={[...DAMAGE_ZONES]}>
                  {(z) => (
                    <rect
                      x={xHP(z.from).toFixed(1)}
                      y={PAD_TOP}
                      width={(((z.to - z.from) / 100) * INNER_W).toFixed(1)}
                      height={layout().bodyH}
                      fill={z.fill}
                      opacity="0.06"
                    />
                  )}
                </For>

                {/* X-axis grid lines + percentage labels */}
                <For each={[0, 25, 50, 75, 100]}>
                  {(pct) => {
                    const heavy = pct === 0 || pct === 100;
                    return (
                      <>
                        <line
                          x1={xHP(pct).toFixed(1)}
                          y1={PAD_TOP}
                          x2={xHP(pct).toFixed(1)}
                          y2={layout().bodyEndY}
                          stroke="currentColor"
                          stroke-width={heavy ? 0.7 : 0.4}
                          opacity={heavy ? 0.25 : 0.14}
                        />
                        <text
                          x={xHP(pct).toFixed(1)}
                          y={PAD_TOP - 9}
                          text-anchor="middle"
                          font-size="9"
                          fill="currentColor"
                          opacity="0.5"
                        >
                          {pct}%
                        </text>
                      </>
                    );
                  }}
                </For>

                {/* Damage zone labels */}
                <For each={[...DAMAGE_ZONES].filter((z) => z.label)}>
                  {(z) => (
                    <text
                      x={xHP((z.from + z.to) / 2).toFixed(1)}
                      y={PAD_TOP - 1}
                      text-anchor="middle"
                      font-size="7.5"
                      fill={z.fill}
                      opacity="0.7"
                    >
                      {z.label}
                    </text>
                  )}
                </For>

                {/* Phase header bands & dashed separators (phase label shown inside chart on mobile) */}
                <For each={rows()}>
                  {(r, ri) => {
                    const g = () => layout().geom[ri()]!;
                    if (!r.isPhaseHeader) return null;
                    const night = isNightPhase(r.phase);
                    return (
                      <>
                        <rect
                          x={PAD_L}
                          y={g().top}
                          width={INNER_W}
                          height={g().baseH}
                          fill={night ? "#818cf8" : "#94a3b8"}
                          opacity={night ? 0.12 : 0.09}
                        />
                        <line
                          x1={PAD_L}
                          y1={g().top}
                          x2={CHART_W - PAD_R}
                          y2={g().top}
                          stroke={night ? "#818cf8" : "#64748b"}
                          stroke-width="1"
                          stroke-dasharray="3,3"
                          opacity="0.55"
                        />
                        <text
                          x={PAD_L + 5}
                          y={g().top + 16}
                          font-size="10"
                          font-weight="600"
                          fill={night ? "#818cf8" : "currentColor"}
                          opacity="0.88"
                          class="md:hidden"
                        >
                          {r.phase}
                        </text>
                      </>
                    );
                  }}
                </For>

                {/* Interactive row hit bands on SVG chart */}
                <For each={rows()}>
                  {(r, ri) => {
                    if (r.isPhaseHeader) return null;
                    const g = () => layout().geom[ri()]!;
                    const isSelRow = () => selectedRow() === ri();
                    const isHovRow = () => hoveredRow() === ri();
                    const isRel = () => rowTouchesShip(r, selectedShip());
                    return (
                      <>
                        <rect
                          x={PAD_L}
                          y={g().top}
                          width={INNER_W}
                          height={g().baseH}
                          fill={
                            isSelRow() || isHovRow()
                              ? "#4ea8ff"
                              : isRel()
                                ? "#3ecf8e"
                                : "transparent"
                          }
                          opacity={
                            isSelRow()
                              ? 0.18
                              : isHovRow()
                                ? 0.11
                                : isRel()
                                  ? 0.1
                                  : 0
                          }
                          style="cursor:pointer;"
                          onMouseEnter={() => setHoveredRow(ri())}
                          onMouseLeave={() => setHoveredRow(null)}
                          onClick={() => toggleRow(ri())}
                        />
                        <line
                          x1={PAD_L}
                          y1={g().centerY.toFixed(1)}
                          x2={(CHART_W - PAD_R).toFixed(1)}
                          y2={g().centerY.toFixed(1)}
                          stroke="currentColor"
                          stroke-width="0.3"
                          opacity={isSelRow() || isHovRow() ? 0.28 : 0.06}
                          pointer-events="none"
                        />
                      </>
                    );
                  }}
                </For>

                {/* Diagonal HP drop highlights (pinned selection + hover) */}
                <For each={activeDrops()}>
                  {(seg) => (
                    <Show
                      when={!seg.isMiss}
                      fallback={
                        <circle
                          cx={seg.xTo.toFixed(1)}
                          cy={seg.centerY.toFixed(1)}
                          r="4.8"
                          fill="none"
                          stroke={seg.color}
                          stroke-width="1.8"
                          opacity="0.85"
                          pointer-events="none"
                        />
                      }
                    >
                      <path
                        d={`M ${seg.xFrom.toFixed(1)} ${seg.yFrom.toFixed(1)} L ${seg.xTo.toFixed(1)} ${seg.yTo.toFixed(1)}`}
                        fill="none"
                        stroke={seg.color}
                        stroke-width={seg.pinned ? 10 : 8}
                        stroke-linecap="round"
                        opacity={seg.pinned ? 0.48 : 0.32}
                        pointer-events="none"
                      />
                      <circle
                        cx={seg.xFrom.toFixed(1)}
                        cy={seg.yFrom.toFixed(1)}
                        r="3.2"
                        fill={seg.color}
                        pointer-events="none"
                      />
                      <circle
                        cx={seg.xTo.toFixed(1)}
                        cy={seg.yTo.toFixed(1)}
                        r="3.8"
                        fill={seg.color}
                        stroke="#ffffff"
                        stroke-width="1.2"
                        pointer-events="none"
                      />
                    </Show>
                  )}
                </For>

                {/* Interactive Ship Polylines */}
                <For each={shipLines()}>
                  {(line) => {
                    const isSelected = () => selectedShip() === line.key;
                    const opacity = () =>
                      selectedShip() === null
                        ? 0.9
                        : isSelected()
                          ? 1
                          : 0.15;
                    const r = 3.5;
                    return (
                      <g
                        style={{
                          cursor: "pointer",
                          opacity: opacity(),
                          transition: "opacity 120ms ease",
                        }}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          toggleShip(line.key);
                        }}
                      >
                        <path
                          d={line.d}
                          fill="none"
                          stroke="transparent"
                          stroke-width="10"
                        />
                        <path
                          d={line.d}
                          fill="none"
                          stroke={line.color}
                          stroke-width={isSelected() ? 2.8 : 1.7}
                          stroke-linejoin="round"
                          stroke-dasharray={line.dash}
                        />
                        <circle
                          cx={line.startX.toFixed(1)}
                          cy={PAD_TOP}
                          r="2.6"
                          fill={line.color}
                        />
                        <Show
                          when={line.sunk}
                          fallback={
                            <circle
                              cx={line.endX.toFixed(1)}
                              cy={line.endY.toFixed(1)}
                              r="2.6"
                              fill="none"
                              stroke={line.color}
                              stroke-width="1.5"
                            />
                          }
                        >
                          <line
                            x1={(line.endX - r).toFixed(1)}
                            y1={(line.endY - r).toFixed(1)}
                            x2={(line.endX + r).toFixed(1)}
                            y2={(line.endY + r).toFixed(1)}
                            stroke={line.color}
                            stroke-width="2"
                          />
                          <line
                            x1={(line.endX + r).toFixed(1)}
                            y1={(line.endY - r).toFixed(1)}
                            x2={(line.endX - r).toFixed(1)}
                            y2={(line.endY + r).toFixed(1)}
                            stroke={line.color}
                            stroke-width="2"
                          />
                        </Show>
                      </g>
                    );
                  }}
                </For>

                {/* Anchor dots at right edge (desktop only) */}
                <For each={rows()}>
                  {(r, ri) => {
                    if (r.isPhaseHeader) return null;
                    const g = () => layout().geom[ri()]!;
                    const active = () =>
                      selectedRow() === ri() || hoveredRow() === ri();
                    return (
                      <circle
                        cx={(CHART_W - PAD_R).toFixed(1)}
                        cy={g().centerY.toFixed(1)}
                        r={active() ? 3.2 : 1.6}
                        fill={active() ? "#4ea8ff" : "#64748b"}
                        opacity={active() ? 1 : 0.35}
                        pointer-events="none"
                        class="hidden md:block"
                      />
                    );
                  }}
                </For>
              </svg>
            </div>

            {/* Bridge lines (desktop only) */}
            <div
              class="hidden md:block shrink-0"
              style={{ width: `${BRIDGE_W}px` }}
            >
              <svg
                width={BRIDGE_W}
                height={layout().chartH}
                style="display:block;overflow:visible;"
              >
                <For each={rows()}>
                  {(r, ri) => {
                    if (r.isPhaseHeader) return null;
                    const g = () => layout().geom[ri()]!;
                    const isSel = () => selectedRow() === ri();
                    const isHov = () => hoveredRow() === ri();
                    const isRel = () => rowTouchesShip(r, selectedShip());
                    return (
                      <line
                        x1="2"
                        y1={g().centerY.toFixed(1)}
                        x2={BRIDGE_W - 2}
                        y2={g().centerY.toFixed(1)}
                        stroke={
                          isSel() || isHov()
                            ? "#4ea8ff"
                            : isRel()
                              ? "#3ecf8e"
                              : "#94a3b8"
                        }
                        stroke-width={
                          isSel() ? 2.4 : isHov() ? 1.8 : isRel() ? 1.5 : 1
                        }
                        opacity={
                          isSel()
                            ? 1
                            : isHov()
                              ? 0.85
                              : isRel()
                                ? 0.75
                                : 0.22
                        }
                      />
                    );
                  }}
                </For>
              </svg>
            </div>

            {/* Right Event List (desktop only, strictly aligned columns + dedicated phase header rows) */}
            <div class="hidden md:block flex-1 min-w-[490px] border-l border-base-300/60 pl-3">
              {/* Column Headers aligned with PAD_TOP */}
              <div
                style={{ height: `${PAD_TOP}px` }}
                class="grid grid-cols-[142px_16px_196px_minmax(0,1fr)] items-end pb-1 gap-x-2 text-[10px] font-medium text-base-content/50"
              >
                <span>攻撃側</span>
                <span />
                <div class="flex items-center justify-between">
                  <span>防御側</span>
                  <span>ダメージ</span>
                </div>
                <span>使用装備</span>
              </div>

              <div>
                <For each={rows()}>
                  {(r, ri) => {
                    const g = () => layout().geom[ri()]!;
                    if (r.isPhaseHeader) {
                      const night = isNightPhase(r.phase);
                      return (
                        <div
                          style={{ height: `${g().baseH}px` }}
                          class={`flex items-center gap-2 px-2 border-t border-base-300/60 rounded-sm ${
                            night ? "bg-indigo-500/10" : "bg-base-200/70"
                          }`}
                        >
                          <span
                            class={`text-[11px] font-semibold ${
                              night ? "text-indigo-400" : "text-base-content"
                            }`}
                          >
                            {r.phase}
                          </span>
                          <Show when={r.isLegacyAirbase}>
                            <span class="rounded bg-warning/20 px-1.5 py-0.5 text-[9px] font-semibold text-warning border border-warning/40">
                              基地航空隊: 未解決の可能性
                            </span>
                          </Show>
                        </div>
                      );
                    }

                    const isSel = () => selectedRow() === ri();
                    const isHov = () => hoveredRow() === ri();
                    const isRel = () => rowTouchesShip(r, selectedShip());
                    const eqMetas = createMemo(() =>
                      r.slotIds
                        .map((id) => slotItemMeta(id, props.mstSlotItemById))
                        .filter((m) => m.name),
                    );

                    return (
                      <div
                        class="grid grid-cols-[142px_16px_196px_minmax(0,1fr)] items-center gap-x-2 px-1.5 border-t border-base-300/40 text-xs cursor-pointer transition-colors"
                        style={{
                          height: `${g().baseH}px`,
                          "background-color": isSel()
                            ? "rgba(78, 168, 255, 0.18)"
                            : isHov()
                              ? "rgba(78, 168, 255, 0.10)"
                              : isRel()
                                ? "rgba(62, 207, 142, 0.14)"
                                : undefined,
                          "box-shadow": isSel()
                            ? "inset 3px 0 0 #4ea8ff"
                            : isRel()
                              ? "inset 3px 0 0 #3ecf8e"
                              : undefined,
                        }}
                        onMouseEnter={() => setHoveredRow(ri())}
                        onMouseLeave={() => setHoveredRow(null)}
                        onClick={() => toggleRow(ri())}
                      >
                        {/* Attackers (all shown, stacked cleanly when multiple) */}
                        <div class="flex flex-col justify-center min-w-0">
                          <For each={r.attackers}>
                            {(a) => (
                              <div
                                class="flex items-center gap-1.5 min-w-0"
                                style={{ height: `${LINE_H}px` }}
                              >
                                <span
                                  class={`font-mono tabular-nums text-[10px] font-semibold w-8 shrink-0 ${a.toneClass}`}
                                >
                                  {a.pos}
                                </span>
                                <span
                                  class="text-[11px] truncate text-base-content"
                                  title={a.name}
                                >
                                  {a.name}
                                </span>
                              </div>
                            )}
                          </For>
                        </div>

                        {/* Arrow (vertically centered) */}
                        <span class="text-center text-[10px] font-mono text-base-content/35">
                          →
                        </span>

                        {/* Defenders + individual Damages (1:1 aligned, all shown) */}
                        <div class="flex flex-col justify-center min-w-0">
                          <For each={r.defenders}>
                            {(d) => (
                              <div
                                class="grid grid-cols-[136px_54px] items-center gap-x-1.5 min-w-0"
                                style={{ height: `${LINE_H}px` }}
                              >
                                <div class="flex items-center gap-1.5 min-w-0">
                                  <span
                                    class={`font-mono tabular-nums text-[10px] font-semibold w-8 shrink-0 ${d.toneClass}`}
                                  >
                                    {d.pos}
                                  </span>
                                  <span
                                    class="text-[11px] truncate text-base-content"
                                    title={d.name}
                                  >
                                    {d.name}
                                  </span>
                                </div>
                                <div class="text-right font-mono tabular-nums shrink-0">
                                  <Show
                                    when={d.damage > 0}
                                    fallback={
                                      <span class="text-[10px] text-base-content/35">
                                        MISS
                                      </span>
                                    }
                                  >
                                    <span
                                      class={
                                        d.crit
                                          ? "text-[12px] font-bold text-error"
                                          : "text-[11px] font-semibold text-base-content"
                                      }
                                    >
                                      -{d.damage}
                                    </span>
                                  </Show>
                                </div>
                              </div>
                            )}
                          </For>
                        </div>

                        {/* Equipment icons + primary name */}
                        <div
                          class="flex items-center gap-1 min-w-0 overflow-hidden"
                          title={eqMetas()
                            .map((m) => m.name)
                            .join(" / ")}
                        >
                          <Show
                            when={eqMetas().length > 0}
                            fallback={
                              <span class="text-[10px] text-base-content/35">
                                -
                              </span>
                            }
                          >
                            <span class="inline-flex items-center gap-0.5 shrink-0">
                              <For each={eqMetas().slice(0, 3)}>
                                {(meta) => (
                                  <WeaponIcon iconType={meta.iconType} />
                                )}
                              </For>
                            </span>
                            <span class="text-[10.5px] truncate text-base-content/65">
                              {eqMetas()[0]?.name}
                              {eqMetas().length > 1
                                ? ` +${eqMetas().length - 1}`
                                : ""}
                            </span>
                          </Show>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
