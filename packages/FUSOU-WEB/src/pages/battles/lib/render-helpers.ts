import type { WeaponIconFrame, ShipInfo, BattleFleets } from "./types";
import { escHtml, getDamageState, hpFillClass, transitionState } from "./helpers";
import { AIR_STATE } from "./constants";
import { getWeaponIconCaches } from "./data-service";
import { isSafeImageUrl } from "@/utility/security";

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
  mstSlotItemById: Map<number, Record<string, unknown>> | null,
): { name: string; iconType: number | null } {
  const mst = mstSlotItemById?.get?.(Number(slotItemId ?? 0));
  if (!mst) {
    return { name: `装備${slotItemId}`, iconType: null };
  }
  const iconType =
    Array.isArray(mst.type) && (mst.type as unknown[]).length >= 4
      ? Number((mst.type as unknown[])[3] ?? 0) || null
      : null;
  return {
    name: String(mst.name ?? `装備${slotItemId}`),
    iconType,
  };
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
  mstSlotItemById: Map<number, Record<string, unknown>> | null,
): string {
  if (!Array.isArray(slotIds) || slotIds.length === 0) {
    return "";
  }
  return slotIds
    .map((slotId) => {
      const meta = slotItemMeta(slotId, mstSlotItemById);
      return renderEquipmentBadge({
        name: meta.name,
        iconType: meta.iconType,
        level: null,
      });
    })
    .join(" ");
}

export function renderCompactHpBadge(current: unknown, max: unknown): string {
  const damageState = getDamageState(current, max);
  const safeCurrent = Number(current ?? 0) || 0;
  const safeMax = Number(max ?? current ?? 0) || 0;
  const pct =
    safeMax > 0
      ? Math.max(0, Math.min(100, (safeCurrent / safeMax) * 100))
      : 0;
  const fillClass = hpFillClass(pct);

  return `<div class="inline-flex min-w-[92px] flex-col gap-1 rounded bg-base-100 px-2 py-1 ring-1 ring-base-300">
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
  const totalNow = ships.reduce(
    (sum, ship) => sum + (Number(ship.nowhp ?? 0) || 0),
    0,
  );
  const totalMax = ships.reduce(
    (sum, ship) => sum + (Number(ship.maxhp ?? ship.nowhp ?? 0) || 0),
    0,
  );
  const taiha = ships.filter(
    (ship) => getDamageState(ship.nowhp, ship.maxhp).label === "大破",
  ).length;
  const chuuha = ships.filter(
    (ship) => getDamageState(ship.nowhp, ship.maxhp).label === "中破",
  ).length;
  const totalLevel = ships.reduce(
    (sum, ship) => sum + (Number(ship.level ?? 0) || 0),
    0,
  );
  const avgLevel = Math.round(totalLevel / ships.length);
  return `<div class="mb-2 flex flex-wrap gap-2 text-[11px]">
    <span class="badge badge-outline">${sideLabel} ${ships.length}隻</span>
    <span class="badge badge-outline">総HP ${totalNow}/${totalMax}</span>
    <span class="badge badge-outline">平均Lv ${Number.isFinite(avgLevel) ? avgLevel : "-"}</span>
    ${taiha > 0 ? `<span class="badge badge-error badge-outline">大破 ${taiha}</span>` : ""}
    ${chuuha > 0 ? `<span class="badge badge-warning badge-outline">中破 ${chuuha}</span>` : ""}
  </div>`;
}

export function renderInlineHpMeter(
  current: unknown,
  max: unknown,
  extraClasses = "",
): string {
  const safeCurrent = Number(current ?? 0) || 0;
  const safeMax = Number(max ?? current ?? 0) || 0;
  const pct =
    safeMax > 0
      ? Math.max(0, Math.min(100, (safeCurrent / safeMax) * 100))
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
  const dmg = Number(opts.damage ?? 0) || 0;
  const badges: string[] = [];
  if (dmg <= 0) {
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
  idx: number,
  fleets: BattleFleets | null,
): string {
  const list =
    side === "friend" ? fleets?.friendlyShips : fleets?.enemyShips;
  const ship = Array.isArray(list) ? list[idx] : null;
  return ship?.name ?? `艦${idx + 1}`;
}

export function shipSlotLabel(_side: string, idx: number): string {
  return `${Number(idx ?? 0) + 1}番`;
}

export function shipDisplayLabel(
  side: "friend" | "enemy",
  idx: number,
  fleets: BattleFleets | null,
): string {
  return `${shipSlotLabel(side, idx)} ${shipNameFromIndex(side, idx, fleets)}`;
}

export function maxHpForShip(
  side: "friend" | "enemy",
  idx: number,
  fallbackHp: number,
  fleets: BattleFleets | null,
): number {
  const ship =
    (side === "friend"
      ? fleets?.friendlyShips
      : fleets?.enemyShips)?.[idx] ?? null;
  return Number(ship?.maxhp ?? fallbackHp ?? 0) || 0;
}

export function renderShipIndexBadge(side: string, idx: number): string {
  return `<span class="badge badge-ghost badge-sm">${shipSlotLabel(side, idx)}</span>`;
}

export function renderPhaseParticipant(
  name: string,
  side: string,
  idx: number,
  hpCurrent: number,
  hpMax: number,
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
        ship.nowhp ?? 0,
        ship.maxhp ?? ship.nowhp ?? 0,
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
    return Array.isArray(row?.f_now_hps)
      ? (row.f_now_hps as unknown[])
      : Array.isArray(row?.f_nowhps)
        ? (row.f_nowhps as unknown[])
        : [];
  }
  return Array.isArray(row?.e_now_hps)
    ? (row.e_now_hps as unknown[])
    : Array.isArray(row?.e_nowhps)
      ? (row.e_nowhps as unknown[])
      : [];
}

export function renderShellingRows(
  rows: Array<Record<string, unknown>>,
  fleets: BattleFleets | null,
  mstSlotItemById: Map<number, Record<string, unknown>> | null,
): string {
  const header = `<div class="mb-1 hidden text-[10px] uppercase tracking-wide text-base-content/45 md:grid md:grid-cols-[minmax(0,260px)_20px_minmax(0,1fr)] md:items-center">
    <span>攻撃艦</span>
    <span></span>
    <span>対象 / 結果</span>
  </div>`;

  const body = rows
    .map((row) => {
      const atkEnemy = Number(row.at_eflag ?? 0) !== 0;
      const attackerIdx = Number(row.at ?? 0) || 0;
      const attackerSide: "friend" | "enemy" = atkEnemy ? "enemy" : "friend";
      const attackerName = shipNameFromIndex(attackerSide, attackerIdx, fleets);
      const attackerHpSnapshot = getRowHpSnapshot(row, attackerSide);
      const attackerCurrentHp = Number(attackerHpSnapshot[attackerIdx] ?? 0) || 0;
      const attackerMaxHp = maxHpForShip(
        attackerSide,
        attackerIdx,
        attackerCurrentHp,
        fleets,
      );
      const defs = Array.isArray(row.df) ? (row.df as unknown[]) : [];
      const dmgs = Array.isArray(row.damage) ? (row.damage as unknown[]) : [];
      const cls = Array.isArray(row.cl) ? (row.cl as unknown[]) : [];
      const protects = Array.isArray(row.protect_flag)
        ? (row.protect_flag as unknown[])
        : [];
      const sis = Array.isArray(row.si) ? (row.si as unknown[]) : [];
      const defenderSide: "friend" | "enemy" = atkEnemy ? "friend" : "enemy";
      const defenderHpSnapshot = getRowHpSnapshot(row, defenderSide);
      const targetsHtml = defs
        .map((d, i) => {
          const defenderIdx = Number(d ?? 0) || 0;
          const defName = shipNameFromIndex(defenderSide, defenderIdx, fleets);
          const dmg = Number(dmgs[i] ?? 0) || 0;
          const crit = Number(cls[i] ?? 0) >= 2;
          const protect = Boolean(protects[i]);
          const beforeHp = Number(defenderHpSnapshot[defenderIdx] ?? 0) || 0;
          const mHp = maxHpForShip(defenderSide, defenderIdx, beforeHp, fleets);
          const afterHp = Math.max(0, beforeHp - dmg);
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
            ${eqText ? `<div class="text-[10px] text-base-content/55 break-words">${eqText}</div>` : ""}
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
  const fDam = Array.isArray(data?.f_dam) ? (data.f_dam as unknown[]) : [];
  const eDam = Array.isArray(data?.e_dam) ? (data.e_dam as unknown[]) : [];
  const fNow = getRowHpSnapshot(data, "friend");
  const eNow = getRowHpSnapshot(data, "enemy");
  const fHits = fDam
    .map((d, i) => ({
      side: "friend" as const,
      idx: i,
      dmg: Number(d ?? 0) || 0,
      beforeHp: fNow[i],
    }))
    .filter((x) => x.dmg > 0);
  const eHits = eDam
    .map((d, i) => ({
      side: "enemy" as const,
      idx: i,
      dmg: Number(d ?? 0) || 0,
      beforeHp: eNow[i],
    }))
    .filter((x) => x.dmg > 0);
  const rows = [...fHits, ...eHits]
    .map((hit) => {
      const name = shipNameFromIndex(hit.side, hit.idx, fleets);
      const beforeHp = Number(hit.beforeHp ?? 0) || 0;
      const mHp = maxHpForShip(hit.side, hit.idx, beforeHp, fleets);
      const afterHp = Math.max(0, beforeHp - hit.dmg);
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
  const fDmg = Array.isArray(data?.f_damages)
    ? (data.f_damages as number[]).reduce(
        (s, d) => s + (Number(d ?? 0) || 0),
        0,
      )
    : 0;
  const eDmg = Array.isArray(data?.e_damages)
    ? (data.e_damages as number[]).reduce(
        (s, d) => s + (Number(d ?? 0) || 0),
        0,
      )
    : 0;
  const sup = Number(data?.air_superiority ?? -1);
  const airLabel = AIR_STATE[sup]?.label ?? "-";
  return `<div class="grid gap-2 md:grid-cols-3 text-xs">
    <div class="rounded border border-base-300 bg-base-100 px-2 py-2">
      <div class="text-[10px] uppercase tracking-wide text-base-content/45">制空</div>
      <div class="font-semibold">${escHtml(airLabel)}</div>
    </div>
    <div class="rounded border border-info/25 bg-info/5 px-2 py-2">
      <div class="text-[10px] uppercase tracking-wide text-base-content/45">味方被ダメ</div>
      <div class="font-semibold">${fDmg}</div>
    </div>
    <div class="rounded border border-error/25 bg-error/5 px-2 py-2">
      <div class="text-[10px] uppercase tracking-wide text-base-content/45">敵被ダメ</div>
      <div class="font-semibold">${eDmg}</div>
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
