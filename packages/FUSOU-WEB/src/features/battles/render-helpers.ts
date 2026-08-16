import type {
  BattleFleets,
  MstSlotItemRecord,
  ShipInfo,
  WeaponIconFrame,
} from "./types";
import {
  averageNullableNumbers,
  escHtml,
  formatNullableNumber,
  getDamageState,
  hpFillClass,
  normalizeNullableNumber,
  sumNullableNumbers,
  transitionState,
} from "./helpers";
import { AIR_STATE } from "./constants";
import { getWeaponIconCaches } from "./data-service";
import { unknownArrayOf } from "./payload-guards";
import { isSafeImageUrl } from "@/utils/security";

function normalizeParticipantIndex(value: unknown): number | null {
  const index = normalizeNullableNumber(value);
  return index !== null && Number.isSafeInteger(index) && index >= 0
    ? index
    : null;
}

export function renderWeaponIconHtml(iconType: unknown): string {
  const iconId = Number(iconType ?? 0);
  const { frames, meta } = getWeaponIconCaches();
  if (!Number.isFinite(iconId) || iconId <= 0 || !frames) {
    return `<span class="inline-flex h-3.5 w-3.5 items-center justify-center rounded bg-base-300 text-[9px] text-base-content/50">?</span>`;
  }
  const frame: WeaponIconFrame | undefined = frames[iconId];
  if (!frame || frame.w <= 0 || frame.h <= 0 || meta.width <= 0 || meta.height <= 0) {
    return `<span class="inline-flex h-3.5 w-3.5 items-center justify-center rounded bg-base-300 text-[9px] text-base-content/50">?</span>`;
  }
  const size = 14;
  const ratioX = size / frame.w;
  const ratioY = size / frame.h;
  return `<span class="inline-block overflow-hidden rounded align-middle" style="width:${size}px;height:${size}px;">
    <img src="/api/asset-sync/weapon-icons" alt="" style="display:block;max-width:none;width:${meta.width * ratioX}px;height:${meta.height * ratioY}px;margin-left:-${frame.x * ratioX}px;margin-top:-${frame.y * ratioY}px;" />
  </span>`;
}

export function slotItemMeta(
  slotItemId: unknown,
  mstSlotItemById: Map<number, MstSlotItemRecord> | null = null,
): { name: string; iconType: number | null } {
  const id = Number(slotItemId ?? 0);
  if (!Number.isFinite(id) || id <= 0) {
    return { name: "", iconType: null };
  }
  const mst = mstSlotItemById?.get?.(id);
  if (!mst) {
    return { name: "", iconType: null };
  }
  const iconType =
    mst.type && mst.type.length >= 4
      ? Number(mst.type[3] ?? 0) || null
      : null;
  return {
    name: mst.name ?? "",
    iconType,
  };
}

function normalizeSlotIds(slotIds: unknown[]): number[] {
  const flat = slotIds.flatMap((id) => {
    if (Array.isArray(id)) return normalizeSlotIds(id);
    const n = Number(id ?? 0);
    return Number.isFinite(n) && n > 0 ? [n] : [];
  });
  return [...new Set(flat)];
}

export function renderEquipmentBadge(eq: {
  name?: string;
  iconType?: unknown;
  level?: unknown;
}): string {
  const name = eq?.name ?? "装備不明";
  const iconType = eq?.iconType ?? null;
  const level = eq?.level ?? null;
  return `<span class="inline-flex items-center gap-1 rounded bg-base-100 px-1.5 py-0.5 ring-1 ring-base-300">${renderWeaponIconHtml(iconType)}<span>${escHtml(name)}${level != null && Number(level) > 0 ? ` +${level}` : ""}</span></span>`;
}

export function renderEquipmentBadgesFromObjects(
  equipments: Array<{ name?: string; iconType?: unknown; level?: unknown }>,
): string {
  if (!Array.isArray(equipments) || equipments.length === 0) {
    return "装備なし";
  }
  return equipments.map((eq) => renderEquipmentBadge(eq)).join(" ");
}

export function renderEquipmentBadgesFromSlotIds(
  slotIds: unknown[],
  mstSlotItemById: Map<number, MstSlotItemRecord> | null,
): string {
  if (!Array.isArray(slotIds) || slotIds.length === 0) {
    return "";
  }
  return normalizeSlotIds(slotIds)
    .map((slotId) => {
      const meta = slotItemMeta(slotId, mstSlotItemById);
      if (!meta.name) return "";
      return renderEquipmentBadge({
        name: meta.name,
        iconType: meta.iconType,
        level: null,
      });
    })
    .filter((html) => html.length > 0)
    .join(" ");
}

export function renderCompactHpBadge(current: unknown, max: unknown): string {
  const damageState = getDamageState(current, max);
  const safeCurrent = formatNullableNumber(current);
  const safeMax = formatNullableNumber(max);
  const currentNumber = Number(current);
  const maxNumber = Number(max);
  const pct =
    Number.isFinite(currentNumber) && Number.isFinite(maxNumber) && maxNumber > 0
      ? Math.max(0, Math.min(100, (currentNumber / maxNumber) * 100))
      : 0;
  const fillClass = hpFillClass(pct);

  return `<div class="inline-flex min-w-23 flex-col gap-1 rounded bg-base-100 px-2 py-1 ring-1 ring-base-300">
    <div class="flex items-center justify-between gap-2 text-[11px] leading-none">
      <span class="font-mono">${safeCurrent}/${safeMax}</span>
      <span class="badge ${damageState.cls} badge-xs">${damageState.label}</span>
    </div>
    <div class="h-1.5 w-full overflow-hidden rounded-full bg-base-300">
      <div class="h-full ${fillClass} rounded-full transition-all" style="width:${pct}%"></div>
    </div>
  </div>`;
}

export function renderFleetSummary(ships: ShipInfo[], sideLabel: string): string {
  if (!Array.isArray(ships) || ships.length === 0) return "";
  const totalNow = sumNullableNumbers(ships.map((ship) => ship.nowhp));
  const totalMax = sumNullableNumbers(ships.map((ship) => ship.maxhp));
  const taiha = ships.filter(
    (ship) => getDamageState(ship.nowhp, ship.maxhp).label === "大破",
  ).length;
  const chuuha = ships.filter(
    (ship) => getDamageState(ship.nowhp, ship.maxhp).label === "中破",
  ).length;
  const avgLevel = averageNullableNumbers(ships.map((ship) => ship.level));
  return `<div class="mb-2 flex flex-wrap gap-2 text-[11px]">
    <span class="badge badge-outline">${sideLabel} ${ships.length}隻</span>
    <span class="badge badge-outline">総HP ${formatNullableNumber(totalNow)}/${formatNullableNumber(totalMax)}</span>
    <span class="badge badge-outline">平均Lv ${formatNullableNumber(avgLevel)}</span>
    ${taiha > 0 ? `<span class="badge badge-error badge-outline">大破 ${taiha}</span>` : ""}
    ${chuuha > 0 ? `<span class="badge badge-warning badge-outline">中破 ${chuuha}</span>` : ""}
  </div>`;
}

export function renderInlineHpMeter(
  current: unknown,
  max: unknown,
  extraClasses = "",
): string {
  const safeCurrent = formatNullableNumber(current);
  const safeMax = formatNullableNumber(max);
  const currentNumber = Number(current);
  const maxNumber = Number(max);
  const pct =
    Number.isFinite(currentNumber) && Number.isFinite(maxNumber) && maxNumber > 0
      ? Math.max(0, Math.min(100, (currentNumber / maxNumber) * 100))
      : 0;
  return `<span class="inline-flex items-center gap-1 ${extraClasses}">
    <span class="font-mono">${safeCurrent}/${safeMax}</span>
    <span class="inline-block h-1.5 w-12 overflow-hidden rounded-full bg-base-300 align-middle">
      <span class="block h-full ${hpFillClass(pct)} rounded-full" style="width:${pct}%"></span>
    </span>
  </span>`;
}

export function renderOutcomeBadges(opts: {
  damage: unknown;
  crit: boolean;
  protect: boolean;
  sunk: boolean;
  afterState: string;
}): string {
  const dmg = normalizeNullableNumber(opts.damage);
  const badges: string[] = [];
  if (dmg === null) {
    badges.push(`<span class="badge badge-ghost badge-sm">ダメージ不明</span>`);
  } else if (dmg <= 0) {
    badges.push(`<span class="badge badge-neutral badge-sm">MISS</span>`);
  } else {
    badges.push(
      `<span class="badge badge-outline badge-sm font-mono">-${dmg}</span>`,
    );
  }
  if (opts.crit)
    badges.push(`<span class="badge badge-error badge-sm">Critical</span>`);
  if (opts.protect)
    badges.push(`<span class="badge badge-warning badge-sm">防御</span>`);
  if (opts.sunk) {
    badges.push(`<span class="badge badge-neutral badge-sm">撃沈</span>`);
  } else if (opts.afterState === "大破") {
    badges.push(`<span class="badge badge-error badge-sm">大破</span>`);
  } else if (opts.afterState === "中破") {
    badges.push(`<span class="badge badge-warning badge-sm">中破</span>`);
  } else if (opts.afterState === "小破") {
    badges.push(`<span class="badge badge-info badge-sm">小破</span>`);
  }
  return badges.join("");
}

export function renderHPBar(
  current: number,
  max: number,
  label = "",
): string {
  const pct = max > 0 ? Math.max(0, (current / max) * 100) : 0;
  let color = "bg-success";
  if (pct <= 25) color = "bg-error";
  else if (pct <= 50) color = "bg-warning";
  else if (pct <= 75) color = "bg-info";
  return `<div class="flex items-center gap-2">
    <span class="text-[11px] w-12 text-base-content/60 truncate">${label}</span>
    <div class="flex-1 h-2.5 bg-base-300 rounded-full overflow-hidden">
      <div class="h-full ${color} rounded-full transition-all" style="width: ${pct}%"></div>
    </div>
    <span class="text-[11px] font-mono text-base-content/70 w-14 text-right">${current}/${max}</span>
  </div>`;
}

export function shipNameFromIndex(
  side: "friend" | "enemy",
  idx: number | null,
  fleets: BattleFleets | null,
): string {
  const list =
    side === "friend" ? fleets?.friendlyShips : fleets?.enemyShips;
  const ship = idx !== null && Array.isArray(list) ? list[idx] : null;
  return ship?.name ?? (idx === null ? "艦不明" : `艦${idx + 1}`);
}

export function shipSlotLabel(_side: string, idx: number | null): string {
  return idx === null ? "?番" : `${idx + 1}番`;
}

export function shipDisplayLabel(
  side: "friend" | "enemy",
  idx: number | null,
  fleets: BattleFleets | null,
): string {
  return `${shipSlotLabel(side, idx)} ${shipNameFromIndex(side, idx, fleets)}`;
}

export function maxHpForShip(
  side: "friend" | "enemy",
  idx: number | null,
  fallbackHp: number | null,
  fleets: BattleFleets | null,
): number | null {
  const ship =
    idx !== null
      ? (side === "friend"
          ? fleets?.friendlyShips
          : fleets?.enemyShips)?.[idx] ?? null
      : null;
  return ship?.maxhp ?? fallbackHp;
}

export function renderShipIndexBadge(side: string, idx: number | null): string {
  return `<span class="badge badge-ghost badge-sm">${shipSlotLabel(side, idx)}</span>`;
}

export function renderPhaseParticipant(
  name: string,
  side: string,
  idx: number | null,
  hpCurrent: number | null,
  hpMax: number | null,
): string {
  const tone = side === "enemy" ? "text-error" : "text-info";
  return `<div class="min-w-0 rounded bg-base-100 px-2 py-1 border border-base-300">
    <div class="mb-1 flex items-center gap-1.5">
      ${renderShipIndexBadge(side, idx)}
      <div class="truncate text-xs font-semibold ${tone}">${escHtml(name)}</div>
    </div>
    <div class="text-[10px] text-base-content/65">${renderInlineHpMeter(hpCurrent, hpMax)}</div>
  </div>`;
}

export function renderShipRows(ships: ShipInfo[], sideLabel: string): string {
  if (!Array.isArray(ships) || ships.length === 0) {
    return `<div class="text-sm text-base-content/40">データなし</div>`;
  }
  const rows = ships
    .map((ship) => {
      const hpBadge = renderCompactHpBadge(
        ship.nowhp,
        ship.maxhp,
      );
      const statText = `火${ship.karyoku ?? "-"} 雷${ship.raisou ?? "-"} 対${ship.taiku ?? "-"} 装${ship.soukou ?? "-"}`;
      const equipText = renderEquipmentBadgesFromObjects(ship.equipments);
      const safeBannerUrl = ship.bannerUrl && isSafeImageUrl(ship.bannerUrl)
        ? ship.bannerUrl
        : "";

      return `<div class="rounded-box bg-base-200 p-2">
        <div class="flex items-center gap-2 mb-1">
          ${safeBannerUrl ? `<img src="${escHtml(safeBannerUrl)}" alt="${escHtml(ship.name)}" class="h-6 w-24 rounded object-cover" loading="lazy" />` : ""}
          <div class="min-w-0">
            <div class="text-sm font-semibold truncate">${escHtml(ship.name)}</div>
            <div class="text-[11px] text-base-content/60">${ship.level ? `Lv${ship.level} / ` : ""}${statText}</div>
          </div>
          <div class="shrink-0">${hpBadge}</div>
        </div>
        <div class="mt-1 flex flex-wrap gap-1 text-[11px] text-base-content/75">${equipText}</div>
      </div>`;
    })
    .join("");
  return `${renderFleetSummary(ships, sideLabel)}${rows}`;
}

function getRowHpSnapshot(
  row: Record<string, unknown>,
  side: string,
): unknown[] {
  if (side === "friend") {
    return unknownArrayOf(row?.["f_now_hps"] ?? row?.["f_nowhps"]);
  }
  return unknownArrayOf(row?.["e_now_hps"] ?? row?.["e_nowhps"]);
}

export function renderShellingRows(
  rows: Array<Record<string, unknown>>,
  fleets: BattleFleets | null,
  mstSlotItemById: Map<number, MstSlotItemRecord> | null,
): string {
  const header = `<div class="mb-1 hidden text-[10px] uppercase tracking-wide text-base-content/45 md:grid md:grid-cols-[minmax(0,260px)_20px_minmax(0,1fr)] md:items-center">
    <span>攻撃艦</span>
    <span></span>
    <span>対象 / 結果</span>
  </div>`;

  const body = rows
    .map((row) => {
      const atkEnemy = Number(row["at_eflag"] ?? 0) !== 0;
      const attackerIdx = normalizeParticipantIndex(row["at"]);
      const attackerSide: "friend" | "enemy" = atkEnemy ? "enemy" : "friend";
      const attackerName = shipNameFromIndex(attackerSide, attackerIdx, fleets);
      const attackerHpSnapshot = getRowHpSnapshot(row, attackerSide);
      const attackerCurrentHp =
        attackerIdx === null
          ? null
          : normalizeNullableNumber(attackerHpSnapshot[attackerIdx]);
      const attackerMaxHp =
        attackerIdx === null
          ? null
          : maxHpForShip(
              attackerSide,
              attackerIdx,
              attackerCurrentHp,
              fleets,
            );
      const defs = unknownArrayOf(row["df"]);
      const dmgs = unknownArrayOf(row["damage"]);
      const cls = unknownArrayOf(row["cl"]);
      const protects = unknownArrayOf(row["protect_flag"]);
      const sis = unknownArrayOf(row["si"]);
      const defenderSide: "friend" | "enemy" = atkEnemy ? "friend" : "enemy";
      const defenderHpSnapshot = getRowHpSnapshot(row, defenderSide);
      const targetsHtml = defs
        .map((d, i) => {
          const defenderIdx = normalizeParticipantIndex(d);
          const defName = shipNameFromIndex(defenderSide, defenderIdx, fleets);
          const dmg = normalizeNullableNumber(dmgs[i]);
          const crit = Number(cls[i] ?? 0) >= 2;
          const protect = Boolean(protects[i]);
          const beforeHp =
            defenderIdx === null
              ? null
              : normalizeNullableNumber(defenderHpSnapshot[defenderIdx]);
          const mHp =
            defenderIdx === null
              ? null
              : maxHpForShip(defenderSide, defenderIdx, beforeHp, fleets);
          const afterHp =
            beforeHp !== null && dmg !== null
              ? Math.max(0, beforeHp - dmg)
              : null;
          const state = transitionState(beforeHp, afterHp, mHp);
          return `<div class="rounded bg-base-100 px-2 py-1 border border-base-300">
            <div class="flex flex-wrap items-center gap-2 justify-between">
              <div class="min-w-0">
                <div class="mb-1 flex items-center gap-1.5">
                  ${renderShipIndexBadge(defenderSide, defenderIdx)}
                  <div class="text-xs font-semibold ${defenderSide === "enemy" ? "text-error" : "text-info"}">${escHtml(defName)}</div>
                </div>
                <div class="text-[10px] text-base-content/65">${renderInlineHpMeter(beforeHp, mHp)} <span class="text-base-content/40">-></span> ${renderInlineHpMeter(afterHp, mHp)}</div>
              </div>
              <div class="flex flex-wrap gap-1">${renderOutcomeBadges({ damage: dmg, crit, protect, sunk: state.sunk, afterState: state.afterState })}</div>
            </div>
          </div>`;
        })
        .join("");
      const eqText =
        sis.length > 0
          ? `<span class="text-[10px] text-base-content/55">${renderEquipmentBadgesFromSlotIds(sis, mstSlotItemById)}</span>`
          : "";
      return `<div class="rounded border border-base-300 bg-base-200 p-2">
        <div class="grid gap-2 md:grid-cols-[minmax(0,260px)_20px_minmax(0,1fr)] md:items-start">
          <div class="space-y-1">
            ${renderPhaseParticipant(attackerName, attackerSide, attackerIdx, attackerCurrentHp, attackerMaxHp)}
            ${eqText ? `<div class="text-[10px] text-base-content/55 wrap-break-word">${eqText}</div>` : ""}
          </div>
          <div class="hidden md:flex md:items-center md:justify-center text-base-content/40">→</div>
          <div class="space-y-1">
            ${targetsHtml || `<div class="text-xs text-base-content/40">対象不明</div>`}
          </div>
        </div>
      </div>`;
    })
    .join("");

  return `${header}<div class="space-y-2">${body}</div>`;
}

export function renderRaigekiRows(
  data: Record<string, unknown>,
  title: string,
  fleets: BattleFleets | null,
): string {
  const fDam = unknownArrayOf(data?.["f_dam"]);
  const eDam = unknownArrayOf(data?.["e_dam"]);
  const fNow = getRowHpSnapshot(data, "friend");
  const eNow = getRowHpSnapshot(data, "enemy");
  const fHits = fDam
    .map((d, i) => ({
      side: "friend" as const,
      idx: i,
      dmg: normalizeNullableNumber(d),
      beforeHp: fNow[i],
    }))
    .filter((x): x is typeof x & { dmg: number } => x.dmg !== null && x.dmg >= 0);
  const eHits = eDam
    .map((d, i) => ({
      side: "enemy" as const,
      idx: i,
      dmg: normalizeNullableNumber(d),
      beforeHp: eNow[i],
    }))
    .filter((x): x is typeof x & { dmg: number } => x.dmg !== null && x.dmg >= 0);
  const rows = [...fHits, ...eHits]
    .map((hit) => {
      const name = shipNameFromIndex(hit.side, hit.idx, fleets);
      const beforeHp = normalizeNullableNumber(hit.beforeHp);
      const mHp = maxHpForShip(hit.side, hit.idx, beforeHp, fleets);
      const afterHp =
        beforeHp !== null
          ? Math.max(0, beforeHp - hit.dmg)
          : null;
      const state = transitionState(beforeHp, afterHp, mHp);
      return `<div class="rounded border border-base-300 bg-base-200 px-2 py-1">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="mb-1 flex items-center gap-1.5">
              ${renderShipIndexBadge(hit.side, hit.idx)}
              <div class="text-xs font-semibold ${hit.side === "enemy" ? "text-error" : "text-info"}">${escHtml(name)}</div>
            </div>
            <div class="text-[10px] text-base-content/65">${renderInlineHpMeter(beforeHp, mHp)} <span class="text-base-content/40">-></span> ${renderInlineHpMeter(afterHp, mHp)}</div>
          </div>
          <div class="flex flex-wrap gap-1">${renderOutcomeBadges({ damage: hit.dmg, crit: false, protect: false, sunk: state.sunk, afterState: state.afterState })}</div>
        </div>
      </div>`;
    })
    .join("");
  if (!rows) {
    return `<div class="text-xs text-base-content/50">${title}: 有効打なし</div>`;
  }
  return `<div class="space-y-1">${rows}</div>`;
}

export function renderAirAttackRows(data: Record<string, unknown>): string {
  const fDmg = sumNullableNumbers(unknownArrayOf(data?.["f_damages"]));
  const eDmg = sumNullableNumbers(unknownArrayOf(data?.["e_damages"]));
  const sup = Number(data?.["air_superiority"] ?? -1);
  const airLabel = AIR_STATE[sup]?.label ?? "";
  const hasAnySortie =
    unknownArrayOf(data?.["f_plane_from"]).length > 0 ||
    unknownArrayOf(data?.["e_plane_from"]).length > 0;
  const showAirLabel =
    airLabel.length > 0 &&
    (hasAnySortie || (fDmg !== null && fDmg > 0) || (eDmg !== null && eDmg > 0));
  return `<div class="grid gap-2 md:grid-cols-3 text-xs">
    <div class="rounded border border-base-300 bg-base-100 px-2 py-2">
      <div class="text-[10px] uppercase tracking-wide text-base-content/45">制空</div>
      <div class="font-semibold">${showAirLabel ? escHtml(airLabel) : ""}</div>
    </div>
    <div class="rounded border border-info/25 bg-info/5 px-2 py-2">
      <div class="text-[10px] uppercase tracking-wide text-base-content/45">味方被ダメ</div>
      <div class="font-semibold">${formatNullableNumber(fDmg)}</div>
    </div>
    <div class="rounded border border-error/25 bg-error/5 px-2 py-2">
      <div class="text-[10px] uppercase tracking-wide text-base-content/45">敵被ダメ</div>
      <div class="font-semibold">${formatNullableNumber(eDmg)}</div>
    </div>
  </div>`;
}

export function renderPhaseSummaryBadges(items: (string | null)[]): string {
  const filtered = items.filter(Boolean);
  if (filtered.length === 0) {
    return `<span class="badge badge-ghost badge-sm">記録なし</span>`;
  }
  return filtered
    .map(
      (item) =>
        `<span class="badge badge-outline badge-sm">${escHtml(item!)}</span>`,
    )
    .join("");
}
