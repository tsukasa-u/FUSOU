import type { BattleFleets, TimelineEvent, TimelineStep } from "./types";
import {
  PHASE_NAMES,
  FRIEND_COLORS,
  ENEMY_COLORS,
  DAMAGE_ZONES,
} from "./constants";
import { escHtml } from "./helpers";
import {
  shipNameFromIndex,
  renderEquipmentBadgesFromSlotIds,
} from "./render-helpers";

// ── Layout constants (shared by builder + renderer) ───────────────────────

const ROW_H = 28;
const CHART_W = 420;
const PAD_L = 10;
const PAD_R = 10;
const PAD_TOP = 26;
const PAD_BOT = 8;
const INNER_W = CHART_W - PAD_L - PAD_R;
const EXTEND = ROW_H / 2;

function xHP(pct: number): string {
  return (PAD_L + (pct / 100) * INNER_W).toFixed(1);
}

function yStep(si: number): string {
  return (PAD_TOP + si * ROW_H + ROW_H / 2).toFixed(1);
}

// ── Event extraction ──────────────────────────────────────────────────────

function normalizeShellingRows(
  data: unknown,
): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data;
  const obj = data as Record<string, unknown> | null;
  if (obj?.at_list) {
    const atList = obj.at_list as unknown[];
    return atList.map((at, idx) => ({
      at,
      df: (obj.df_list as unknown[])?.[idx] ?? [],
      damage: (obj.damage as unknown[])?.[idx] ?? [],
      cl: (obj.cl_list as unknown[])?.[idx] ?? [],
      at_eflag: (obj.at_eflag as unknown[])?.[idx] ?? 0,
      si: (obj.si_list as unknown[])?.[idx] ?? [],
      protect_flag: (obj.protect_flag as unknown[])?.[idx] ?? [],
      f_now_hps: (obj.f_now_hps as unknown[])?.[idx] ?? [],
      e_now_hps: (obj.e_now_hps as unknown[])?.[idx] ?? [],
    }));
  }
  return [];
}

export function buildTimelineEvents(
  battle: Record<string, unknown>,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  function extractShellingEvents(
    rows: unknown,
    phaseLabel: string,
  ): void {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      const r = row as Record<string, unknown>;
      const atkEnemy = Number(r.at_eflag ?? 0) !== 0;
      const attackerIdx = Number(r.at ?? 0) || 0;
      const attackerSide: "friend" | "enemy" = atkEnemy ? "enemy" : "friend";
      const defenderSide: "friend" | "enemy" = atkEnemy ? "friend" : "enemy";
      const defs = Array.isArray(r.df) ? (r.df as unknown[]) : [];
      const dmgs = Array.isArray(r.damage) ? (r.damage as unknown[]) : [];
      const clsMask = Array.isArray(r.cl) ? (r.cl as unknown[]) : [];
      const sis = Array.isArray(r.si) ? (r.si as unknown[]) : [];
      const fHps = (Array.isArray(r.f_now_hps)
        ? r.f_now_hps
        : Array.isArray(r.f_nowhps)
          ? r.f_nowhps
          : []) as number[];
      const eHps = (Array.isArray(r.e_now_hps)
        ? r.e_now_hps
        : Array.isArray(r.e_nowhps)
          ? r.e_nowhps
          : []) as number[];

      for (let i = 0; i < defs.length; i++) {
        const defenderIdx = Number(defs[i] ?? 0) || 0;
        const dmg = Number(dmgs[i] ?? 0) || 0;
        const crit = Number(clsMask[i] ?? 0) >= 2;
        const beforeHp =
          defenderSide === "friend"
            ? Number(fHps[defenderIdx] ?? 0)
            : Number(eHps[defenderIdx] ?? 0);
        const afterHp = Math.max(0, beforeHp - dmg);
        events.push({
          phase: phaseLabel,
          type: "shelling",
          attackerSide,
          attackerIdx,
          defenderSide,
          defenderIdx,
          damage: dmg,
          crit,
          sunk: afterHp <= 0 && beforeHp > 0,
          slotItems: sis,
          fHps,
          eHps,
        });
      }
    }
  }

  function extractRaigekiEvents(
    data: unknown,
    phaseLabel: string,
  ): void {
    if (!data) return;
    const d = data as Record<string, unknown>;
    const fDam = Array.isArray(d.f_dam) ? (d.f_dam as unknown[]) : [];
    const eDam = Array.isArray(d.e_dam) ? (d.e_dam as unknown[]) : [];
    const fNow = (Array.isArray(d.f_now_hps)
      ? d.f_now_hps
      : Array.isArray(d.f_nowhps)
        ? d.f_nowhps
        : []) as number[];
    const eNow = (Array.isArray(d.e_now_hps)
      ? d.e_now_hps
      : Array.isArray(d.e_nowhps)
        ? d.e_nowhps
        : []) as number[];

    for (let i = 0; i < fDam.length; i++) {
      const dmg = Number(fDam[i] ?? 0) || 0;
      if (dmg <= 0) continue;
      const beforeHp = Number(fNow[i] ?? 0) || 0;
      const afterHp = Math.max(0, beforeHp - dmg);
      events.push({
        phase: phaseLabel,
        type: "raigeki",
        attackerSide: "enemy",
        attackerIdx: null,
        defenderSide: "friend",
        defenderIdx: i,
        damage: dmg,
        crit: false,
        sunk: afterHp <= 0 && beforeHp > 0,
        slotItems: [],
        fHps: fNow,
        eHps: eNow,
      });
    }
    for (let i = 0; i < eDam.length; i++) {
      const dmg = Number(eDam[i] ?? 0) || 0;
      if (dmg <= 0) continue;
      const beforeHp = Number(eNow[i] ?? 0) || 0;
      const afterHp = Math.max(0, beforeHp - dmg);
      events.push({
        phase: phaseLabel,
        type: "raigeki",
        attackerSide: "friend",
        attackerIdx: null,
        defenderSide: "enemy",
        defenderIdx: i,
        damage: dmg,
        crit: false,
        sunk: afterHp <= 0 && beforeHp > 0,
        slotItems: [],
        fHps: fNow,
        eHps: eNow,
      });
    }
  }

  const rawOrder = battle.battle_order as unknown[] | undefined;
  const hasObjectOrder =
    Array.isArray(rawOrder) &&
    rawOrder.length > 0 &&
    typeof rawOrder[0] === "object";

  if (hasObjectOrder) {
    for (const phaseType of rawOrder!) {
      const key = Object.keys(phaseType as Record<string, unknown>)[0];
      const idx = (phaseType as Record<string, unknown>)[key] as
        | number
        | null;
      const subLabel =
        idx !== null && idx !== undefined ? ` (${idx + 1})` : "";
      const phaseLabel = (PHASE_NAMES[key] ?? key) + subLabel;

      if (
        key === "Hougeki" ||
        key === "OpeningTaisen" ||
        key === "MidnightHougeki"
      ) {
        const raw =
          key === "Hougeki"
            ? Array.isArray(battle.hougeki)
              ? ((battle.hougeki as unknown[])[idx ?? 0] ?? battle.hougeki)
              : battle.hougeki
            : key === "OpeningTaisen"
              ? battle.opening_taisen
              : battle.midnight_hougeki;
        extractShellingEvents(normalizeShellingRows(raw), phaseLabel);
      } else if (key === "OpeningRaigeki") {
        extractRaigekiEvents(battle.opening_raigeki, phaseLabel);
      } else if (key === "ClosingRaigeki") {
        extractRaigekiEvents(battle.closing_raigeki, phaseLabel);
      }
    }
  } else {
    if (battle.opening_taisen) {
      extractShellingEvents(
        normalizeShellingRows(battle.opening_taisen),
        PHASE_NAMES.OpeningTaisen,
      );
    }
    if (battle.opening_raigeki) {
      extractRaigekiEvents(
        battle.opening_raigeki,
        PHASE_NAMES.OpeningRaigeki,
      );
    }
    if (battle.hougeki) {
      const rows = Array.isArray(battle.hougeki)
        ? (battle.hougeki as unknown[])
        : [battle.hougeki];
      rows.forEach((h, i) => {
        extractShellingEvents(
          normalizeShellingRows(h),
          `${PHASE_NAMES.Hougeki} (${i + 1})`,
        );
      });
    }
    if (battle.closing_raigeki) {
      extractRaigekiEvents(
        battle.closing_raigeki,
        PHASE_NAMES.ClosingRaigeki,
      );
    }
    if (battle.midnight_hougeki) {
      extractShellingEvents(
        normalizeShellingRows(battle.midnight_hougeki),
        PHASE_NAMES.MidnightHougeki,
      );
    }
  }

  return events;
}

export function buildInitialHps(battle: Record<string, unknown>): {
  fInit: number[];
  eInit: number[];
} {
  const fInit = (battle.midnight_f_nowhps ?? battle.f_nowhps ?? []) as number[];
  const eInit = (battle.midnight_e_nowhps ?? battle.e_nowhps ?? []) as number[];
  return { fInit, eInit };
}

// ── SVG Renderer ──────────────────────────────────────────────────────────

function buildSteps(
  events: TimelineEvent[],
  fInit: number[],
  eInit: number[],
): TimelineStep[] {
  const steps: TimelineStep[] = [];
  const fHpsCurrent = fInit.length > 0 ? [...fInit] : [];
  const eHpsCurrent = eInit.length > 0 ? [...eInit] : [];
  steps.push({
    fHps: [...fHpsCurrent],
    eHps: [...eHpsCurrent],
    eventIdx: -1,
  });
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.defenderSide === "friend" && ev.defenderIdx !== null) {
      fHpsCurrent[ev.defenderIdx] = Math.max(
        0,
        (fHpsCurrent[ev.defenderIdx] ?? 0) - ev.damage,
      );
    } else if (ev.defenderSide === "enemy" && ev.defenderIdx !== null) {
      eHpsCurrent[ev.defenderIdx] = Math.max(
        0,
        (eHpsCurrent[ev.defenderIdx] ?? 0) - ev.damage,
      );
    }
    steps.push({
      fHps: [...fHpsCurrent],
      eHps: [...eHpsCurrent],
      eventIdx: i,
    });
  }
  return steps;
}

function buildPhaseRegions(events: TimelineEvent[]): Array<{
  phase: string;
  start: number;
  end: number;
}> {
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

function renderShipLine(
  side: "friend" | "enemy",
  si: number,
  hpKey: "fHps" | "eHps",
  colors: string[],
  dashed: boolean,
  steps: TimelineStep[],
  fInit: number[],
  eInit: number[],
  fleets: BattleFleets | null,
): string {
  const ship =
    (side === "friend"
      ? fleets?.friendlyShips
      : fleets?.enemyShips)?.[si];
  const initArr = side === "friend" ? fInit : eInit;
  const initHp = Math.max(0, Number(initArr[si] ?? 0) || 0);
  const maxHp = Number(ship?.maxhp ?? initHp ?? 0) || initHp || 1;
  const color = colors[si % colors.length];

  const points = steps.map((step, s) => {
    const hp = Math.max(0, Number(step[hpKey][si] ?? maxHp) || 0);
    const pct = Math.min(100, (hp / maxHp) * 100);
    return { x: Number(xHP(pct)), y: Number(yStep(s)) };
  });

  const p0 = points[0];
  const pLast = points[points.length - 1];

  // Build path: upward stem → diagonal/vertical segments → downward stem
  let d =
    `M ${p0.x.toFixed(1)} ${(p0.y - EXTEND).toFixed(1)}` +
    ` L ${p0.x.toFixed(1)} ${p0.y.toFixed(1)}`;

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

  // Downward stem at end (symmetric with upward stem at start)
  const endX = pLast.x;
  const endY = pLast.y + EXTEND;
  d += ` L ${endX.toFixed(1)} ${endY.toFixed(1)}`;

  const dashAttr = dashed ? `stroke-dasharray="6,2"` : "";
  let svg =
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" ${dashAttr} opacity="0.9"/>`;

  // Start dot
  const initPct = Math.min(100, (initHp / maxHp) * 100);
  svg += `<circle cx="${xHP(initPct)}" cy="${(Number(yStep(0)) - EXTEND).toFixed(1)}" r="3" fill="${color}" opacity="0.9"/>`;

  // End marker
  const lastHp = Math.max(
    0,
    Number(steps[steps.length - 1][hpKey][si] ?? maxHp) || 0,
  );
  if (lastHp <= 0) {
    const r = 3.5;
    svg +=
      `<line x1="${(endX - r).toFixed(1)}" y1="${(endY - r).toFixed(1)}" x2="${(endX + r).toFixed(1)}" y2="${(endY + r).toFixed(1)}" stroke="${color}" stroke-width="2"/>` +
      `<line x1="${(endX + r).toFixed(1)}" y1="${(endY - r).toFixed(1)}" x2="${(endX - r).toFixed(1)}" y2="${(endY + r).toFixed(1)}" stroke="${color}" stroke-width="2"/>`;
  } else {
    svg += `<circle cx="${endX.toFixed(1)}" cy="${endY.toFixed(1)}" r="3" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.7"/>`;
  }

  return svg;
}

function renderLegendRow(
  side: "friend" | "enemy",
  count: number,
  colors: string[],
  dashed: boolean,
  fleets: BattleFleets | null,
): string {
  const sideLabel = side === "friend" ? "味方" : "敵";
  const textCls = side === "friend" ? "text-info" : "text-error";
  let row = `<div class="flex flex-wrap items-center gap-x-3 gap-y-0.5"><span class="text-[10px] font-bold ${textCls} w-7 shrink-0">${sideLabel}</span>`;
  for (let si = 0; si < count; si++) {
    const name = shipNameFromIndex(side, si, fleets);
    const color = colors[si % colors.length];
    const short = name.length > 6 ? name.slice(0, 5) + "…" : name;
    const lineSvg = dashed
      ? `<svg width="16" height="4" style="vertical-align:middle;"><line x1="0" y1="2" x2="16" y2="2" stroke="${color}" stroke-width="2" stroke-dasharray="5,2"/></svg>`
      : `<span style="display:inline-block;width:16px;height:2px;background:${color};border-radius:1px;vertical-align:middle;"></span>`;
    row += `<span class="inline-flex items-center gap-0.5 text-[10px]">${lineSvg}${si + 1}番 ${escHtml(short)}</span>`;
  }
  row += `</div>`;
  return row;
}

export function renderTimelineView(
  battle: Record<string, unknown>,
  fleets: BattleFleets | null,
  mstSlotItemById: Map<number, Record<string, unknown>> | null = null,
): string {
  const events = buildTimelineEvents(battle);
  const { fInit, eInit } = buildInitialHps(battle);
  const steps = buildSteps(events, fInit, eInit);

  const fCount = fleets?.friendlyShips?.length || fInit.length || 6;
  const eCount = fleets?.enemyShips?.length || eInit.length || 6;

  const chartH = PAD_TOP + steps.length * ROW_H + PAD_BOT;

  // ── Zone backgrounds ──────────────────────────────────────────────
  let zoneBgs = "";
  for (const z of DAMAGE_ZONES) {
    const x = xHP(z.from);
    const w = (((z.to - z.from) / 100) * INNER_W).toFixed(1);
    zoneBgs += `<rect x="${x}" y="${PAD_TOP}" width="${w}" height="${steps.length * ROW_H}" fill="${z.fill}" opacity="0.06"/>`;
  }

  // ── X-axis grid + labels ──────────────────────────────────────────
  let xAxis = "";
  for (const pct of [0, 25, 50, 75, 100]) {
    const x = xHP(pct);
    const heavy = pct === 0 || pct === 100;
    xAxis += `<line x1="${x}" y1="${PAD_TOP}" x2="${x}" y2="${(PAD_TOP + steps.length * ROW_H).toFixed(1)}" stroke="currentColor" stroke-width="${heavy ? 0.7 : 0.4}" opacity="${heavy ? 0.25 : 0.15}"/>`;
    xAxis += `<text x="${x}" y="${(PAD_TOP - 9).toFixed(1)}" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.5">${pct}%</text>`;
  }
  for (const z of DAMAGE_ZONES) {
    if (!z.label) continue;
    const mx = xHP((z.from + z.to) / 2);
    xAxis += `<text x="${mx}" y="${(PAD_TOP - 1).toFixed(1)}" text-anchor="middle" font-size="7" fill="${z.fill}" opacity="0.65">${z.label}</text>`;
  }

  // ── Horizontal step guides ────────────────────────────────────────
  let guides = "";
  for (let s = 0; s < steps.length; s++) {
    const y = yStep(s);
    guides += `<line x1="${PAD_L}" y1="${y}" x2="${(CHART_W - PAD_R).toFixed(1)}" y2="${y}" stroke="currentColor" stroke-width="0.3" opacity="0.07"/>`;
  }

  // ── Phase boundaries + night-battle background ────────────────────
  const phaseRegions = buildPhaseRegions(events);
  let phaseBounds = "";
  let nightBg = "";
  for (let ri = 0; ri < phaseRegions.length; ri++) {
    const reg = phaseRegions[ri];
    const isNight = reg.phase === "夜戦";
    if (isNight) {
      const nyY = (PAD_TOP + reg.start * ROW_H).toFixed(1);
      const nyH = ((reg.end - reg.start) * ROW_H).toFixed(1);
      nightBg += `<rect x="${PAD_L}" y="${nyY}" width="${INNER_W}" height="${nyH}" fill="#818cf8" opacity="0.07"/>`;
    }
    if (ri > 0) {
      const yB = (PAD_TOP + reg.start * ROW_H).toFixed(1);
      const lnColor = isNight ? "#818cf8" : "#94a3b8";
      const lnDash = isNight
        ? `stroke-dasharray="3,3"`
        : `stroke-dasharray="4,3"`;
      phaseBounds += `<line x1="${PAD_L}" y1="${yB}" x2="${(CHART_W - PAD_R).toFixed(1)}" y2="${yB}" stroke="${lnColor}" stroke-width="${isNight ? 1.2 : 1}" opacity="0.6" ${lnDash}/>`;
      phaseBounds += `<text x="${(PAD_L + 3).toFixed(1)}" y="${(Number(yB) + 9).toFixed(1)}" font-size="8" fill="${lnColor}" opacity="0.75">${escHtml(reg.phase)}</text>`;
    }
  }

  // ── Ship polylines ────────────────────────────────────────────────
  let lines = "";
  for (let si = 0; si < fCount; si++) {
    lines += renderShipLine(
      "friend", si, "fHps", FRIEND_COLORS, false,
      steps, fInit, eInit, fleets,
    );
  }
  for (let si = 0; si < eCount; si++) {
    lines += renderShipLine(
      "enemy", si, "eHps", ENEMY_COLORS, true,
      steps, fInit, eInit, fleets,
    );
  }

  // ── Hover bands, anchors, bridge lines ────────────────────────────
  let chartBands = "";
  let bridgeLines = "";
  let chartAnchors = "";
  const bridgeW = 34;

  for (let i = 0; i < events.length; i++) {
    const yCenter = Number(yStep(i));
    const ev = events[i];

    if (ev.defenderIdx !== null) {
      const hpKey: "fHps" | "eHps" =
        ev.defenderSide === "friend" ? "fHps" : "eHps";
      const ship =
        (ev.defenderSide === "friend"
          ? fleets?.friendlyShips
          : fleets?.enemyShips)?.[ev.defenderIdx];
      const initArr = ev.defenderSide === "friend" ? fInit : eInit;
      const initHp = Math.max(0, Number(initArr[ev.defenderIdx] ?? 0) || 0);
      const maxHp = Number(ship?.maxhp ?? initHp ?? 0) || initHp || 1;
      const hpFrom = Math.max(
        0,
        Number(steps[i]?.[hpKey]?.[ev.defenderIdx] ?? maxHp) || 0,
      );
      const hpTo = Math.max(
        0,
        Number(steps[i + 1]?.[hpKey]?.[ev.defenderIdx] ?? hpFrom) || 0,
      );
      const xFrom = Number(xHP(Math.min(100, (hpFrom / maxHp) * 100)));
      const xTo = Number(xHP(Math.min(100, (hpTo / maxHp) * 100)));
      const yFrom = Number(yStep(i));
      const dx = Math.abs(xFrom - xTo);
      if (dx >= 0.1) {
        const diagDy = Math.min((dx * ROW_H) / INNER_W, ROW_H);
        const midY = (yFrom + diagDy).toFixed(1);
        const bandD = `M ${xFrom.toFixed(1)} ${yFrom.toFixed(1)} L ${xTo.toFixed(1)} ${midY}`;
        chartBands += `<path d="${bandD}" fill="none" stroke="#3b82f6" stroke-linecap="round" stroke-linejoin="round" stroke-width="9" opacity="0" data-timeline-step="${i}" data-timeline-kind="band"/>`;
      }
    }

    chartAnchors += `<circle cx="${(CHART_W - PAD_R).toFixed(1)}" cy="${yCenter.toFixed(1)}" r="1.8" fill="#64748b" opacity="0.35" data-timeline-step="${i}" data-timeline-kind="anchor"/>`;
    bridgeLines += `<line x1="2" y1="${yCenter.toFixed(1)}" x2="${(bridgeW - 2).toFixed(1)}" y2="${yCenter.toFixed(1)}" stroke="#94a3b8" stroke-width="1" opacity="0.22" data-timeline-step="${i}" data-timeline-kind="connector"/>`;
  }

  // ── Legend ─────────────────────────────────────────────────────────
  const legendBlock = `<div class="space-y-1 mb-2 select-none">${renderLegendRow("friend", fCount, FRIEND_COLORS, false, fleets)}${renderLegendRow("enemy", eCount, ENEMY_COLORS, true, fleets)}</div>`;

  // ── Left panel (SVG chart) ────────────────────────────────────────
  const leftPanel =
    `<div class="shrink-0 select-none" style="width:${CHART_W}px;">` +
    `<svg width="${CHART_W}" height="${chartH}" style="overflow:visible;display:block;" class="text-base-content">` +
    zoneBgs + nightBg + xAxis + guides + phaseBounds + chartBands + lines + chartAnchors +
    `</svg></div>`;

  // ── Bridge panel ──────────────────────────────────────────────────
  const bridgePanel =
    `<div class="shrink-0" style="width:${bridgeW}px;">` +
    `<svg width="${bridgeW}" height="${chartH}" style="display:block;overflow:visible;">${bridgeLines}</svg>` +
    `</div>`;

  // ── Right panel (event list) ──────────────────────────────────────

  let rightPanel = `<div class="min-w-0 flex-1 border-l border-base-300/60 pl-3 overflow-hidden">`;
  rightPanel +=
    `<div style="height:${PAD_TOP}px;" class="flex items-end pb-1">` +
    `<span class="text-[9px] text-base-content/35 uppercase tracking-wide">攻撃者</span>` +
    `<span class="ml-auto text-[9px] text-base-content/35 uppercase tracking-wide pr-1">対象 / 結果</span>` +
    `</div>`;

  let lastPhaseEv = "";
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const phaseChanged = ev.phase !== lastPhaseEv;
    if (phaseChanged) lastPhaseEv = ev.phase;

    const atkIdx = ev.attackerIdx;
    const defIdx = ev.defenderIdx;
    const atkName =
      atkIdx !== null
        ? shipNameFromIndex(ev.attackerSide, atkIdx, fleets)
        : "-";
    const defName = shipNameFromIndex(ev.defenderSide, defIdx, fleets);
    const atkLabel = atkIdx !== null ? `${atkIdx + 1}番` : "?";
    const defLabel = `${defIdx + 1}番`;
    const atkShort =
      atkName.length > 6 ? atkName.slice(0, 5) + "…" : atkName;
    const defShort =
      defName.length > 6 ? defName.slice(0, 5) + "…" : defName;
    const atkColor = ev.attackerSide === "friend" ? "#3b82f6" : "#ef4444";
    const defColor = ev.defenderSide === "friend" ? "#3b82f6" : "#ef4444";

    const dmgHtml =
      ev.damage > 0
        ? ev.crit
          ? `<span class="font-mono font-bold text-[12px] tabular-nums" style="color:#f97316;min-width:52px;display:inline-block;text-align:right">-${ev.damage}</span>`
          : `<span class="font-mono font-semibold text-[11px] tabular-nums" style="color:${defColor};min-width:52px;display:inline-block;text-align:right">-${ev.damage}</span>`
        : `<span class="font-mono text-[9px] text-base-content/30" style="min-width:52px;display:inline-block;text-align:right">MISS</span>`;

    const ciItems = Array.isArray(ev.slotItems)
      ? ev.slotItems.filter((id) => Number(id) > 0).slice(0, 3)
      : [];
    const ciText =
      ciItems.length > 0
        ? `<span class="inline-flex shrink-0 items-center gap-0.5 text-[9px]">${renderEquipmentBadgesFromSlotIds(ciItems, mstSlotItemById)}</span>`
        : "";

    const topBorder =
      phaseChanged && i > 0
        ? "border-t-2 border-t-slate-400/45"
        : "border-t border-t-base-300/20";

    rightPanel +=
      `<div class="flex items-center gap-1.5 ${topBorder} transition-all duration-100 min-w-0" style="height:${ROW_H}px;overflow:hidden;" data-timeline-step="${i}" data-timeline-kind="row" onmouseenter="setTimelineStepHover(${i})" onmouseleave="setTimelineStepHover(null)">` +
      `<span class="shrink-0 font-bold text-[10px] tabular-nums" style="color:${atkColor}">${atkLabel}</span>` +
      `<span class="shrink-0 text-[9px] opacity-55 w-[44px] truncate">${escHtml(atkShort)}</span>` +
      `<span class="text-[9px] text-base-content/30 shrink-0">→</span>` +
      `<span class="shrink-0 font-bold text-[10px] tabular-nums" style="color:${defColor}">${defLabel}</span>` +
      `<span class="shrink-0 text-[9px] opacity-55 w-[44px] truncate">${escHtml(defShort)}</span>` +
      dmgHtml +
      ciText +
      `</div>`;
  }

  if (events.length === 0) {
    rightPanel += `<div class="py-4 text-xs text-base-content/40">詳細イベントなし</div>`;
  }
  rightPanel += `</div>`;

  return `<div class="overflow-hidden">${legendBlock}<div class="flex gap-0">${leftPanel}${bridgePanel}${rightPanel}</div></div>`;
}

// ── Hover interaction (to be bound to window) ─────────────────────────────

export function setTimelineStepHover(stepIdx: number | null): void {
  const timelineContent = document.getElementById("timeline-content");
  if (!timelineContent) return;

  const normalized = Number.isInteger(stepIdx) ? stepIdx : null;
  const nodes = Array.from(timelineContent.querySelectorAll("[data-timeline-step]"));
  for (const el of nodes) {
    const htmlEl = el as HTMLElement;
    const elStep = Number(htmlEl.getAttribute("data-timeline-step"));
    const kind = htmlEl.getAttribute("data-timeline-kind") || "";
    const active = normalized !== null && elStep === normalized;

    if (kind === "row") {
      htmlEl.style.backgroundColor = active
        ? "rgba(59, 130, 246, 0.08)"
        : "";
      htmlEl.style.transform = active ? "translateX(2px)" : "";
    } else if (kind === "connector") {
      htmlEl.style.opacity = active ? "0.9" : "0.22";
      htmlEl.style.strokeWidth = active ? "2.2" : "1";
    } else if (kind === "anchor") {
      htmlEl.style.opacity = active ? "1" : "0.35";
      htmlEl.style.r = active ? "3.2" : "1.8";
    } else if (kind === "band") {
      htmlEl.style.opacity = active ? "0.45" : "0";
      htmlEl.style.strokeWidth = active ? "9" : "8";
    }
  }
}

export function switchPhaseView(mode: "phase" | "timeline"): void {
  const phaseView = document.getElementById("phase-view");
  const timelineView = document.getElementById("timeline-view");
  const btnPhase = document.getElementById("btn-phase-view");
  const btnTimeline = document.getElementById("btn-timeline-view");
  if (mode === "timeline") {
    phaseView?.classList.add("hidden");
    timelineView?.classList.remove("hidden");
    btnPhase?.classList.remove("btn-active");
    btnTimeline?.classList.add("btn-active");
  } else {
    phaseView?.classList.remove("hidden");
    timelineView?.classList.add("hidden");
    btnPhase?.classList.add("btn-active");
    btnTimeline?.classList.remove("btn-active");
  }
}
