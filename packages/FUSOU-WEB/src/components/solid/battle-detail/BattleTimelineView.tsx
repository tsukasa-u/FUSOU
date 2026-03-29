/** @jsxImportSource solid-js */
import { For, Show, createSignal, createMemo } from "solid-js";
import type { JSX } from "solid-js";
import type { BattleFleets, TimelineEvent, TimelineStep } from "@/pages/battles/lib/types";
import {
  PHASE_NAMES,
  FRIEND_COLORS,
  ENEMY_COLORS,
  DAMAGE_ZONES,
} from "@/pages/battles/lib/constants";
import { buildTimelineEvents, buildInitialHps } from "@/pages/battles/lib/timeline";
import { shipNameFromIndex, EquipmentBadgesFromSlotIds } from "./ui";

// ── Layout constants (mirrored from timeline.ts) ──────────────────────────

const ROW_H = 28;
const CHART_W = 420;
const PAD_L = 10;
const PAD_R = 10;
const PAD_TOP = 26;
const PAD_BOT = 8;
const INNER_W = CHART_W - PAD_L - PAD_R;
const EXTEND = ROW_H / 2;

function xHP(pct: number): number {
  return PAD_L + (pct / 100) * INNER_W;
}

function yStep(si: number): number {
  return PAD_TOP + si * ROW_H + ROW_H / 2;
}

// ── Pure computation helpers ──────────────────────────────────────────────

function buildSteps(
  events: TimelineEvent[],
  fInit: number[],
  eInit: number[],
): TimelineStep[] {
  const steps: TimelineStep[] = [];
  const fCur = fInit.length > 0 ? [...fInit] : [];
  const eCur = eInit.length > 0 ? [...eInit] : [];
  steps.push({ fHps: [...fCur], eHps: [...eCur], eventIdx: -1 });
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.defenderSide === "friend" && ev.defenderIdx !== null) {
      fCur[ev.defenderIdx] = Math.max(0, (fCur[ev.defenderIdx] ?? 0) - ev.damage);
    } else if (ev.defenderSide === "enemy" && ev.defenderIdx !== null) {
      eCur[ev.defenderIdx] = Math.max(0, (eCur[ev.defenderIdx] ?? 0) - ev.damage);
    }
    steps.push({ fHps: [...fCur], eHps: [...eCur], eventIdx: i });
  }
  return steps;
}

function buildPhaseRegions(
  events: TimelineEvent[],
): Array<{ phase: string; start: number; end: number }> {
  const regions: Array<{ phase: string; start: number; end: number }> = [];
  let ph = "";
  let phStart = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i].phase !== ph) {
      if (ph !== "") regions.push({ phase: ph, start: phStart, end: i });
      ph = events[i].phase;
      phStart = i;
    }
  }
  if (ph !== "") regions.push({ phase: ph, start: phStart, end: events.length });
  return regions;
}

// ── Ship polyline path builder ────────────────────────────────────────────

interface ShipLineData {
  d: string;
  color: string;
  dashed: boolean;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  sunk: boolean;
}

function buildShipLine(
  side: "friend" | "enemy",
  si: number,
  hpKey: "fHps" | "eHps",
  colors: string[],
  dashed: boolean,
  steps: TimelineStep[],
  fInit: number[],
  eInit: number[],
  fleets: BattleFleets | null,
): ShipLineData {
  const ship = (side === "friend" ? fleets?.friendlyShips : fleets?.enemyShips)?.[si];
  const initArr = side === "friend" ? fInit : eInit;
  const initHp = Math.max(0, Number(initArr[si] ?? 0) || 0);
  const maxHp = Number(ship?.maxhp ?? initHp ?? 0) || initHp || 1;
  const color = colors[si % colors.length];

  const points = steps.map((step, s) => {
    const hp = Math.max(0, Number(step[hpKey][si] ?? maxHp) || 0);
    const pct = Math.min(100, (hp / maxHp) * 100);
    return { x: xHP(pct), y: yStep(s) };
  });

  const p0 = points[0];
  const pLast = points[points.length - 1];

  let d = `M ${p0.x.toFixed(1)} ${(p0.y - EXTEND).toFixed(1)} L ${p0.x.toFixed(1)} ${p0.y.toFixed(1)}`;
  for (let p = 1; p < points.length; p++) {
    const prev = points[p - 1];
    const curr = points[p];
    const dx = Math.abs(curr.x - prev.x);
    if (dx < 0.1) {
      d += ` L ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
    } else {
      const diagDy = Math.min((dx * ROW_H) / INNER_W, ROW_H);
      const midY = (prev.y + diagDy).toFixed(1);
      d += ` L ${curr.x.toFixed(1)} ${midY} L ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
    }
  }

  const endX = pLast.x;
  const endY = pLast.y + EXTEND;
  d += ` L ${endX.toFixed(1)} ${endY.toFixed(1)}`;

  const lastHp = Math.max(0, Number(steps[steps.length - 1][hpKey][si] ?? maxHp) || 0);

  return {
    d,
    color,
    dashed,
    startX: xHP(Math.min(100, (initHp / maxHp) * 100)),
    startY: p0.y - EXTEND,
    endX,
    endY,
    sunk: lastHp <= 0,
  };
}

// ── SVG sub-components ────────────────────────────────────────────────────

function ShipPolyline(props: { line: ShipLineData }): JSX.Element {
  const r = 3.5;
  return (
    <>
      <path
        d={props.line.d}
        fill="none"
        stroke={props.line.color}
        stroke-width="1.8"
        stroke-linejoin="round"
        stroke-dasharray={props.line.dashed ? "6,2" : undefined}
        opacity="0.9"
      />
      {/* Start dot */}
      <circle
        cx={props.line.startX.toFixed(1)}
        cy={props.line.startY.toFixed(1)}
        r="3"
        fill={props.line.color}
        opacity="0.9"
      />
      {/* End marker (X if sunk, circle if alive) */}
      <Show
        when={props.line.sunk}
        fallback={
          <circle
            cx={props.line.endX.toFixed(1)}
            cy={props.line.endY.toFixed(1)}
            r="3"
            fill="none"
            stroke={props.line.color}
            stroke-width="1.5"
            opacity="0.7"
          />
        }
      >
        <line
          x1={(props.line.endX - r).toFixed(1)}
          y1={(props.line.endY - r).toFixed(1)}
          x2={(props.line.endX + r).toFixed(1)}
          y2={(props.line.endY + r).toFixed(1)}
          stroke={props.line.color}
          stroke-width="2"
        />
        <line
          x1={(props.line.endX + r).toFixed(1)}
          y1={(props.line.endY - r).toFixed(1)}
          x2={(props.line.endX - r).toFixed(1)}
          y2={(props.line.endY + r).toFixed(1)}
          stroke={props.line.color}
          stroke-width="2"
        />
      </Show>
    </>
  );
}

function LegendRow(props: {
  side: "friend" | "enemy";
  count: number;
  colors: string[];
  dashed: boolean;
  fleets: BattleFleets | null;
}): JSX.Element {
  const sideLabel = props.side === "friend" ? "味方" : "敵";
  const textCls = props.side === "friend" ? "text-info" : "text-error";
  return (
    <div class="flex flex-wrap items-center gap-x-3 gap-y-0.5">
      <span class={`text-[10px] font-bold ${textCls} w-7 shrink-0`}>{sideLabel}</span>
      <For each={Array.from({ length: props.count }, (_, i) => i)}>
        {(si) => {
          const color = props.colors[si % props.colors.length];
          const short = createMemo(() => {
            const name = shipNameFromIndex(props.side, si, props.fleets);
            return name.length > 6 ? name.slice(0, 5) + "…" : name;
          });
          return (
            <span class="inline-flex items-center gap-0.5 text-[10px]">
              <Show
                when={props.dashed}
                fallback={
                  <span
                    class="inline-block rounded align-middle"
                    style={{ width: "16px", height: "2px", background: color }}
                  />
                }
              >
                <svg width="16" height="4" style="vertical-align:middle;">
                  <line
                    x1="0" y1="2" x2="16" y2="2"
                    stroke={color}
                    stroke-width="2"
                    stroke-dasharray="5,2"
                  />
                </svg>
              </Show>
              {si + 1}番{" "}{short()}
            </span>
          );
        }}
      </For>
    </div>
  );
}

// ── Hover band data ───────────────────────────────────────────────────────

interface HoverBandData {
  eventIdx: number;
  d: string;
}

function buildHoverBands(
  events: TimelineEvent[],
  steps: TimelineStep[],
  fInit: number[],
  eInit: number[],
  fleets: BattleFleets | null,
): HoverBandData[] {
  const bands: HoverBandData[] = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.defenderIdx === null) continue;
    const hpKey: "fHps" | "eHps" = ev.defenderSide === "friend" ? "fHps" : "eHps";
    const ship = (ev.defenderSide === "friend" ? fleets?.friendlyShips : fleets?.enemyShips)?.[ev.defenderIdx];
    const initArr = ev.defenderSide === "friend" ? fInit : eInit;
    const initHp = Math.max(0, Number(initArr[ev.defenderIdx] ?? 0) || 0);
    const maxHp = Number(ship?.maxhp ?? initHp ?? 0) || initHp || 1;
    const hpFrom = Math.max(0, Number(steps[i]?.[hpKey]?.[ev.defenderIdx] ?? maxHp) || 0);
    const hpTo = Math.max(0, Number(steps[i + 1]?.[hpKey]?.[ev.defenderIdx] ?? hpFrom) || 0);
    const xFrom = xHP(Math.min(100, (hpFrom / maxHp) * 100));
    const xTo = xHP(Math.min(100, (hpTo / maxHp) * 100));
    const yFrom = yStep(i);
    const dx = Math.abs(xFrom - xTo);
    if (dx >= 0.1) {
      const diagDy = Math.min((dx * ROW_H) / INNER_W, ROW_H);
      const midY = (yFrom + diagDy).toFixed(1);
      bands.push({
        eventIdx: i,
        d: `M ${xFrom.toFixed(1)} ${yFrom.toFixed(1)} L ${xTo.toFixed(1)} ${midY}`,
      });
    }
  }
  return bands;
}

// ── Main Timeline Component ───────────────────────────────────────────────

export default function BattleTimelineView(props: {
  battle: Record<string, unknown>;
  fleets: BattleFleets | null;
  mstSlotItemById: Map<number, Record<string, unknown>> | null;
}): JSX.Element {
  const [hoveredStep, setHoveredStep] = createSignal<number | null>(null);

  const events = createMemo(() => buildTimelineEvents(props.battle));
  const initHps = createMemo(() => buildInitialHps(props.battle));
  const steps = createMemo(() => buildSteps(events(), initHps().fInit, initHps().eInit));
  const phaseRegions = createMemo(() => buildPhaseRegions(events()));

  const fCount = createMemo(() =>
    props.fleets?.friendlyShips?.length || initHps().fInit.length || 6,
  );
  const eCount = createMemo(() =>
    props.fleets?.enemyShips?.length || initHps().eInit.length || 6,
  );
  const chartH = createMemo(() => PAD_TOP + steps().length * ROW_H + PAD_BOT);

  const friendLines = createMemo(() =>
    Array.from({ length: fCount() }, (_, si) =>
      buildShipLine(
        "friend", si, "fHps", FRIEND_COLORS, false,
        steps(), initHps().fInit, initHps().eInit, props.fleets,
      ),
    ),
  );
  const enemyLines = createMemo(() =>
    Array.from({ length: eCount() }, (_, si) =>
      buildShipLine(
        "enemy", si, "eHps", ENEMY_COLORS, true,
        steps(), initHps().fInit, initHps().eInit, props.fleets,
      ),
    ),
  );
  const hoverBands = createMemo(() =>
    buildHoverBands(events(), steps(), initHps().fInit, initHps().eInit, props.fleets),
  );

  const bridgeW = 34;

  return (
    <Show
      when={events().length > 0}
      fallback={
        <div class="text-center text-base-content/40 py-8">詳細イベントなし</div>
      }
    >
      <div class="overflow-hidden">
        {/* Legend */}
        <div class="space-y-1 mb-2 select-none">
          <LegendRow side="friend" count={fCount()} colors={FRIEND_COLORS} dashed={false} fleets={props.fleets} />
          <LegendRow side="enemy" count={eCount()} colors={ENEMY_COLORS} dashed={true} fleets={props.fleets} />
        </div>

        <div class="flex gap-0">
          {/* Left panel: SVG chart */}
          <div class="shrink-0 select-none" style={{ width: `${CHART_W}px` }}>
            <svg
              width={CHART_W}
              height={chartH()}
              style="overflow:visible;display:block;"
              class="text-base-content"
            >
              {/* Zone backgrounds */}
              <For each={[...DAMAGE_ZONES]}>
                {(z) => (
                  <rect
                    x={xHP(z.from).toFixed(1)}
                    y={PAD_TOP}
                    width={((z.to - z.from) / 100 * INNER_W).toFixed(1)}
                    height={steps().length * ROW_H}
                    fill={z.fill}
                    opacity="0.06"
                  />
                )}
              </For>

              {/* Night battle bg */}
              <For each={phaseRegions().filter((r) => r.phase === "夜戦")}>
                {(reg) => (
                  <rect
                    x={PAD_L}
                    y={PAD_TOP + reg.start * ROW_H}
                    width={INNER_W}
                    height={(reg.end - reg.start) * ROW_H}
                    fill="#818cf8"
                    opacity="0.07"
                  />
                )}
              </For>

              {/* X-axis grid lines + labels */}
              <For each={[0, 25, 50, 75, 100]}>
                {(pct) => {
                  const heavy = pct === 0 || pct === 100;
                  return (
                    <>
                      <line
                        x1={xHP(pct).toFixed(1)} y1={PAD_TOP}
                        x2={xHP(pct).toFixed(1)} y2={PAD_TOP + steps().length * ROW_H}
                        stroke="currentColor"
                        stroke-width={heavy ? 0.7 : 0.4}
                        opacity={heavy ? 0.25 : 0.15}
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

              {/* Zone labels */}
              <For each={[...DAMAGE_ZONES].filter((z) => z.label)}>
                {(z) => (
                  <text
                    x={xHP((z.from + z.to) / 2).toFixed(1)}
                    y={PAD_TOP - 1}
                    text-anchor="middle"
                    font-size="7"
                    fill={z.fill}
                    opacity="0.65"
                  >
                    {z.label}
                  </text>
                )}
              </For>

              {/* Horizontal step guides */}
              <For each={Array.from({ length: steps().length }, (_, i) => i)}>
                {(s) => (
                  <line
                    x1={PAD_L}
                    y1={yStep(s).toFixed(1)}
                    x2={(CHART_W - PAD_R).toFixed(1)}
                    y2={yStep(s).toFixed(1)}
                    stroke="currentColor"
                    stroke-width="0.3"
                    opacity="0.07"
                  />
                )}
              </For>

              {/* Phase boundaries */}
              <For each={phaseRegions()}>
                {(reg, ri) => {
                  if (ri() === 0) return null;
                  const isNight = reg.phase === "夜戦";
                  const lnColor = isNight ? "#818cf8" : "#94a3b8";
                  const yB = PAD_TOP + reg.start * ROW_H;
                  return (
                    <>
                      <line
                        x1={PAD_L} y1={yB}
                        x2={CHART_W - PAD_R} y2={yB}
                        stroke={lnColor}
                        stroke-width={isNight ? 1.2 : 1}
                        opacity="0.6"
                        stroke-dasharray={isNight ? "3,3" : "4,3"}
                      />
                      <text
                        x={PAD_L + 3} y={yB + 9}
                        font-size="8" fill={lnColor} opacity="0.75"
                      >
                        {reg.phase}
                      </text>
                    </>
                  );
                }}
              </For>

              {/* Hover bands */}
              <For each={hoverBands()}>
                {(band) => (
                  <path
                    d={band.d}
                    fill="none"
                    stroke="#3b82f6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width={hoveredStep() === band.eventIdx ? 9 : 8}
                    opacity={hoveredStep() === band.eventIdx ? 0.45 : 0}
                  />
                )}
              </For>

              {/* Ship polylines */}
              <For each={friendLines()}>
                {(line) => <ShipPolyline line={line} />}
              </For>
              <For each={enemyLines()}>
                {(line) => <ShipPolyline line={line} />}
              </For>

              {/* Anchor dots at right edge */}
              <For each={Array.from({ length: events().length }, (_, i) => i)}>
                {(i) => (
                  <circle
                    cx={(CHART_W - PAD_R).toFixed(1)}
                    cy={yStep(i).toFixed(1)}
                    r={hoveredStep() === i ? 3.2 : 1.8}
                    fill="#64748b"
                    opacity={hoveredStep() === i ? 1 : 0.35}
                  />
                )}
              </For>
            </svg>
          </div>

          {/* Bridge panel */}
          <div class="shrink-0" style={{ width: `${bridgeW}px` }}>
            <svg width={bridgeW} height={chartH()} style="display:block;overflow:visible;">
              <For each={Array.from({ length: events().length }, (_, i) => i)}>
                {(i) => (
                  <line
                    x1="2" y1={yStep(i).toFixed(1)}
                    x2={bridgeW - 2} y2={yStep(i).toFixed(1)}
                    stroke="#94a3b8"
                    stroke-width={hoveredStep() === i ? 2.2 : 1}
                    opacity={hoveredStep() === i ? 0.9 : 0.22}
                  />
                )}
              </For>
            </svg>
          </div>

          {/* Right panel: event list */}
          <div class="min-w-0 flex-1 border-l border-base-300/60 pl-3 overflow-hidden">
            <div
              style={{ height: `${PAD_TOP}px` }}
              class="flex items-end pb-1"
            >
              <span class="text-[9px] text-base-content/35 uppercase tracking-wide">攻撃者</span>
              <span class="ml-auto text-[9px] text-base-content/35 uppercase tracking-wide pr-1">
                対象 / 結果
              </span>
            </div>

            <For each={events()}>
              {(ev, i) => {
                const phaseChanged = () => {
                  const idx = i();
                  return idx === 0 || events()[idx - 1]?.phase !== ev.phase;
                };
                const atkIdx = ev.attackerIdx;
                const defIdx = ev.defenderIdx;
                const atkLabel = atkIdx !== null ? `${atkIdx + 1}番` : "?";
                const defLabel = `${defIdx + 1}番`;
                const atkShort = createMemo(() => {
                  const n = atkIdx !== null
                    ? shipNameFromIndex(ev.attackerSide, atkIdx, props.fleets)
                    : "-";
                  return n.length > 6 ? n.slice(0, 5) + "…" : n;
                });
                const defShort = createMemo(() => {
                  const n = shipNameFromIndex(ev.defenderSide, defIdx, props.fleets);
                  return n.length > 6 ? n.slice(0, 5) + "…" : n;
                });
                const atkColor = ev.attackerSide === "friend" ? "#3b82f6" : "#ef4444";
                const defColor = ev.defenderSide === "friend" ? "#3b82f6" : "#ef4444";

                const topBorder = () =>
                  phaseChanged() && i() > 0
                    ? "border-t-2 border-t-slate-400/45"
                    : "border-t border-t-base-300/20";

                const ciItems = Array.isArray(ev.slotItems)
                  ? ev.slotItems.filter((id) => Number(id) > 0).slice(0, 3)
                  : [];

                return (
                  <div
                    class={`flex items-center gap-1.5 ${topBorder()} transition-all duration-100 min-w-0`}
                    style={{
                      height: `${ROW_H}px`,
                      overflow: "hidden",
                      "background-color":
                        hoveredStep() === i() ? "rgba(59, 130, 246, 0.08)" : undefined,
                      transform: hoveredStep() === i() ? "translateX(2px)" : undefined,
                    }}
                    onMouseEnter={() => setHoveredStep(i())}
                    onMouseLeave={() => setHoveredStep(null)}
                  >
                    <span
                      class="shrink-0 font-bold text-[10px] tabular-nums"
                      style={{ color: atkColor }}
                    >
                      {atkLabel}
                    </span>
                    <span class="shrink-0 text-[9px] opacity-55 w-11 truncate">
                      {atkShort()}
                    </span>
                    <span class="text-[9px] text-base-content/30 shrink-0">→</span>
                    <span
                      class="shrink-0 font-bold text-[10px] tabular-nums"
                      style={{ color: defColor }}
                    >
                      {defLabel}
                    </span>
                    <span class="shrink-0 text-[9px] opacity-55 w-11 truncate">
                      {defShort()}
                    </span>
                    <Show
                      when={ev.damage > 0}
                      fallback={
                        <span
                          class="font-mono text-[9px] text-base-content/30"
                          style={{ "min-width": "52px", display: "inline-block", "text-align": "right" }}
                        >
                          MISS
                        </span>
                      }
                    >
                      <span
                        class={`font-mono tabular-nums ${
                          ev.crit
                            ? "font-bold text-[12px]"
                            : "font-semibold text-[11px]"
                        }`}
                        style={{
                          color: ev.crit ? "#f97316" : defColor,
                          "min-width": "52px",
                          display: "inline-block",
                          "text-align": "right",
                        }}
                      >
                        -{ev.damage}
                      </span>
                    </Show>
                    <Show when={ciItems.length > 0}>
                      <span class="inline-flex shrink-0 items-center gap-0.5 text-[9px]">
                        <EquipmentBadgesFromSlotIds
                          slotIds={ciItems}
                          mstSlotItemById={props.mstSlotItemById}
                        />
                      </span>
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        </div>
      </div>
    </Show>
  );
}
