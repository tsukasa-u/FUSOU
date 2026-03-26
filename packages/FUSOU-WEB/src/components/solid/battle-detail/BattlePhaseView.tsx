/** @jsxImportSource solid-js */
import { For, Show, createMemo } from "solid-js";
import type { JSX } from "solid-js";
import type { BattleFleets } from "@/pages/battles/lib/types";
import { PHASE_NAMES, AIR_STATE } from "@/pages/battles/lib/constants";
import { transitionState } from "@/pages/battles/lib/helpers";
import {
  shipNameFromIndex,
  maxHpForShip,
  getRowHpSnapshot,
  ShipIndexBadge,
  PhaseParticipant,
  InlineHpMeter,
  OutcomeBadges,
  PhaseSummaryBadges,
  EquipmentBadgesFromSlotIds,
} from "./ui";

// ── Phase data helpers ────────────────────────────────────────────────────

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
    }));
  }
  return [];
}

function sumDamage(rows: Array<Record<string, unknown>>): number {
  let total = 0;
  for (const row of rows) {
    const dmg = row.damage;
    if (Array.isArray(dmg)) {
      for (const d of dmg) {
        total += Number(d ?? 0) || 0;
      }
    }
  }
  return total;
}

// ── Per-attack-type renderers ─────────────────────────────────────────────

function ShellingRows(props: {
  rows: Array<Record<string, unknown>>;
  fleets: BattleFleets | null;
  mstSlotItemById: Map<number, Record<string, unknown>> | null;
}): JSX.Element {
  return (
    <>
      <div class="mb-1 hidden text-[10px] uppercase tracking-wide text-base-content/45 md:grid md:grid-cols-[minmax(0,260px)_20px_minmax(0,1fr)] md:items-center">
        <span>攻撃艦</span>
        <span />
        <span>対象 / 結果</span>
      </div>
      <div class="space-y-2">
        <For each={props.rows}>
          {(row) => {
            const atkEnemy = Number(row.at_eflag ?? 0) !== 0;
            const attackerIdx = Number(row.at ?? 0) || 0;
            const attackerSide = atkEnemy ? ("enemy" as const) : ("friend" as const);
            const defenderSide = atkEnemy ? ("friend" as const) : ("enemy" as const);
            const attackerHpSnapshot = getRowHpSnapshot(row, attackerSide);
            const attackerCurrentHp = Number(attackerHpSnapshot[attackerIdx] ?? 0) || 0;
            const defs = Array.isArray(row.df) ? (row.df as unknown[]) : [];
            const dmgs = Array.isArray(row.damage) ? (row.damage as unknown[]) : [];
            const cls = Array.isArray(row.cl) ? (row.cl as unknown[]) : [];
            const protects = Array.isArray(row.protect_flag) ? (row.protect_flag as unknown[]) : [];
            const sis = Array.isArray(row.si) ? (row.si as unknown[]) : [];
            const defenderHpSnapshot = getRowHpSnapshot(row, defenderSide);

            return (
              <div class="rounded border border-base-300 bg-base-200 p-2 overflow-visible">
                <div class="grid gap-2 md:grid-cols-[260px_20px_minmax(0,1fr)] md:items-start overflow-visible">
                  <div class="space-y-1">
                    <PhaseParticipant
                      name={shipNameFromIndex(attackerSide, attackerIdx, props.fleets)}
                      side={attackerSide}
                      idx={attackerIdx}
                      hpCurrent={attackerCurrentHp}
                      hpMax={maxHpForShip(attackerSide, attackerIdx, attackerCurrentHp, props.fleets)}
                    />
                    <Show when={sis.length > 0}>
                      <div class="text-[10px] text-base-content/55 overflow-visible relative z-10">
                        <span class="inline-flex flex-nowrap items-center gap-1 whitespace-nowrap text-[10px] text-base-content/55">
                          <EquipmentBadgesFromSlotIds
                            slotIds={sis}
                            mstSlotItemById={props.mstSlotItemById}
                          />
                        </span>
                      </div>
                    </Show>
                  </div>
                  <div class="hidden md:flex md:items-center md:justify-center text-base-content/40">
                    →
                  </div>
                  <div class="space-y-1">
                    <Show
                      when={defs.length > 0}
                      fallback={<div class="text-xs text-base-content/40">対象不明</div>}
                    >
                      <For each={defs}>
                        {(d, i) => {
                          const defenderIdx = Number(d ?? 0) || 0;
                          const dmg = Number(dmgs[i()] ?? 0) || 0;
                          const crit = Number(cls[i()] ?? 0) >= 2;
                          const protect = Boolean(protects[i()]);
                          const beforeHp = Number(defenderHpSnapshot[defenderIdx] ?? 0) || 0;
                          const afterHp = Math.max(0, beforeHp - dmg);
                          const mHp = createMemo(() => maxHpForShip(defenderSide, defenderIdx, beforeHp, props.fleets));
                          const state = createMemo(() => transitionState(beforeHp, afterHp, mHp()));
                          return (
                            <div class="rounded bg-base-100 px-2 py-1 border border-base-300">
                              <div class="flex flex-wrap items-center gap-2 justify-between">
                                <div class="min-w-0">
                                  <div class="mb-1 flex items-center gap-1.5">
                                    <ShipIndexBadge idx={defenderIdx} />
                                    <div
                                      class={`text-xs font-semibold ${defenderSide === "enemy" ? "text-error" : "text-info"}`}
                                    >
                                      {shipNameFromIndex(defenderSide, defenderIdx, props.fleets)}
                                    </div>
                                  </div>
                                  <div class="text-[10px] text-base-content/65">
                                    <InlineHpMeter current={beforeHp} max={mHp()} />
                                    <span class="text-base-content/40">{" -> "}</span>
                                    <InlineHpMeter current={afterHp} max={mHp()} />
                                  </div>
                                </div>
                                <div class="flex flex-wrap gap-1">
                                  <OutcomeBadges
                                    damage={dmg}
                                    crit={crit}
                                    protect={protect}
                                    sunk={state().sunk}
                                    afterState={state().afterState}
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        }}
                      </For>
                    </Show>
                  </div>
                </div>
              </div>
            );
          }}
        </For>
      </div>
    </>
  );
}

function RaigekiRows(props: {
  data: Record<string, unknown>;
  title: string;
  fleets: BattleFleets | null;
}): JSX.Element {
  const fDam = () => (Array.isArray(props.data?.f_dam) ? (props.data.f_dam as unknown[]) : []);
  const eDam = () => (Array.isArray(props.data?.e_dam) ? (props.data.e_dam as unknown[]) : []);
  const fNow = () => getRowHpSnapshot(props.data, "friend");
  const eNow = () => getRowHpSnapshot(props.data, "enemy");

  const hits = () => {
    const fHits = fDam()
      .map((d, i) => ({
        side: "friend" as const,
        idx: i,
        dmg: Number(d ?? 0) || 0,
        beforeHp: fNow()[i],
      }))
      .filter((x) => x.dmg > 0);
    const eHits = eDam()
      .map((d, i) => ({
        side: "enemy" as const,
        idx: i,
        dmg: Number(d ?? 0) || 0,
        beforeHp: eNow()[i],
      }))
      .filter((x) => x.dmg > 0);
    return [...fHits, ...eHits];
  };

  return (
    <Show
      when={hits().length > 0}
      fallback={
        <div class="text-xs text-base-content/50">{props.title}: 有効打なし</div>
      }
    >
      <div class="space-y-1">
        <For each={hits()}>
          {(hit) => {
            const beforeHp = Number(hit.beforeHp ?? 0) || 0;
            const afterHp = Math.max(0, beforeHp - hit.dmg);
            const mHp = createMemo(() => maxHpForShip(hit.side, hit.idx, beforeHp, props.fleets));
            const state = createMemo(() => transitionState(beforeHp, afterHp, mHp()));
            return (
              <div class="rounded border border-base-300 bg-base-200 px-2 py-1">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="min-w-0">
                    <div class="mb-1 flex items-center gap-1.5">
                      <ShipIndexBadge idx={hit.idx} />
                      <div
                        class={`text-xs font-semibold ${hit.side === "enemy" ? "text-error" : "text-info"}`}
                      >
                        {shipNameFromIndex(hit.side, hit.idx, props.fleets)}
                      </div>
                    </div>
                    <div class="text-[10px] text-base-content/65">
                      <InlineHpMeter current={beforeHp} max={mHp()} />
                      <span class="text-base-content/40">{" -> "}</span>
                      <InlineHpMeter current={afterHp} max={mHp()} />
                    </div>
                  </div>
                  <div class="flex flex-wrap gap-1">
                    <OutcomeBadges
                      damage={hit.dmg}
                      crit={false}
                      protect={false}
                      sunk={state().sunk}
                      afterState={state().afterState}
                    />
                  </div>
                </div>
              </div>
            );
          }}
        </For>
      </div>
    </Show>
  );
}

function AirAttackRows(props: { data: Record<string, unknown> }): JSX.Element {
  const fDmg = () =>
    Array.isArray(props.data?.f_damages)
      ? (props.data.f_damages as number[]).reduce((s, d) => s + (Number(d ?? 0) || 0), 0)
      : 0;
  const eDmg = () =>
    Array.isArray(props.data?.e_damages)
      ? (props.data.e_damages as number[]).reduce((s, d) => s + (Number(d ?? 0) || 0), 0)
      : 0;
  const airLabel = () => {
    const sup = Number(props.data?.air_superiority ?? -1);
    return AIR_STATE[sup]?.label ?? "-";
  };
  return (
    <div class="grid gap-2 md:grid-cols-3 text-xs">
      <div class="rounded border border-base-300 bg-base-100 px-2 py-2">
        <div class="text-[10px] uppercase tracking-wide text-base-content/45">制空</div>
        <div class="font-semibold">{airLabel()}</div>
      </div>
      <div class="rounded border border-info/25 bg-info/5 px-2 py-2">
        <div class="text-[10px] uppercase tracking-wide text-base-content/45">味方被ダメ</div>
        <div class="font-semibold">{fDmg()}</div>
      </div>
      <div class="rounded border border-error/25 bg-error/5 px-2 py-2">
        <div class="text-[10px] uppercase tracking-wide text-base-content/45">敵被ダメ</div>
        <div class="font-semibold">{eDmg()}</div>
      </div>
    </div>
  );
}

// ── Single phase card ─────────────────────────────────────────────────────

function PhaseCard(props: {
  phaseType: Record<string, unknown>;
  phaseData: unknown;
  fleets: BattleFleets | null;
  mstSlotItemById: Map<number, Record<string, unknown>> | null;
}): JSX.Element {
  const phaseKey = () => Object.keys(props.phaseType)[0] ?? "";
  const phaseName = () => {
    const name = PHASE_NAMES[phaseKey()] ?? phaseKey();
    const subIdx = props.phaseType[phaseKey()] as number | null;
    return subIdx != null ? `${name} (${subIdx + 1})` : name;
  };

  const summaryBadges = (): (string | null)[] => {
    const key = phaseKey();
    if (key === "Hougeki" || key === "OpeningTaisen" || key === "MidnightHougeki") {
      const rows = normalizeShellingRows(props.phaseData);
      if (rows.length > 0) {
        return [`${rows.length}行動`, `総与ダメ ${sumDamage(rows)}`];
      }
    } else if (key === "OpeningRaigeki" || key === "ClosingRaigeki") {
      const pd = props.phaseData as Record<string, unknown> | null;
      const fTotal = Array.isArray(pd?.f_dam)
        ? (pd!.f_dam as unknown[]).reduce((s: number, d: unknown) => s + (Number(d ?? 0) || 0), 0)
        : 0;
      const eTotal = Array.isArray(pd?.e_dam)
        ? (pd!.e_dam as unknown[]).reduce((s: number, d: unknown) => s + (Number(d ?? 0) || 0), 0)
        : 0;
      return [`味方被ダメ ${fTotal}`, `敵被ダメ ${eTotal}`];
    } else if (key === "OpeningAirAttack" || key === "AirBaseAirAttack") {
      const first = Array.isArray(props.phaseData)
        ? (props.phaseData as Record<string, unknown>[])[0]
        : (props.phaseData as Record<string, unknown>);
      if (first) {
        const fTotal = Array.isArray(first.f_damages)
          ? (first.f_damages as unknown[]).reduce((s: number, d: unknown) => s + (Number(d ?? 0) || 0), 0)
          : 0;
        const eTotal = Array.isArray(first.e_damages)
          ? (first.e_damages as unknown[]).reduce((s: number, d: unknown) => s + (Number(d ?? 0) || 0), 0)
          : 0;
        const airLabel = AIR_STATE[Number(first.air_superiority ?? -1)]?.label ?? "-";
        return [airLabel, `味方被ダメ ${fTotal}`, `敵被ダメ ${eTotal}`];
      }
    } else if (key === "SupportAttack") {
      const pd = props.phaseData as Record<string, unknown> | null;
      const badges: string[] = [];
      if ((pd as any)?.support_hourai) {
        const totalDmg = ((pd as any).support_hourai.damage as number[] | undefined)?.reduce((s: number, d: number) => s + d, 0) ?? 0;
        badges.push(`砲雷 ${totalDmg}`);
      }
      if ((pd as any)?.support_airatack) {
        const eDmg = ((pd as any).support_airatack.e_damage?.damages as number[] | undefined)?.reduce((s: number, d: number) => s + d, 0) ?? 0;
        badges.push(`航空 ${eDmg}`);
      }
      return badges;
    }
    return [];
  };

  const phaseContent = (): JSX.Element => {
    const key = phaseKey();
    if (key === "Hougeki" || key === "OpeningTaisen" || key === "MidnightHougeki") {
      const rows = normalizeShellingRows(props.phaseData);
      if (rows.length > 0) {
        return (
          <ShellingRows
            rows={rows}
            fleets={props.fleets}
            mstSlotItemById={props.mstSlotItemById}
          />
        );
      }
    } else if (key === "OpeningRaigeki" || key === "ClosingRaigeki") {
      return (
        <RaigekiRows
          data={props.phaseData as Record<string, unknown>}
          title={phaseName()}
          fleets={props.fleets}
        />
      );
    } else if (key === "OpeningAirAttack" || key === "AirBaseAirAttack") {
      const first = Array.isArray(props.phaseData)
        ? (props.phaseData as Record<string, unknown>[])[0]
        : (props.phaseData as Record<string, unknown>);
      if (first) return <AirAttackRows data={first} />;
    } else if (key === "SupportAttack") {
      const pd = props.phaseData as any;
      return (
        <div>
          <Show when={pd?.support_hourai}>
            <div class="text-sm">
              敵被ダメ合計:{" "}
              <span class="font-mono text-error">
                {pd.support_hourai.damage?.reduce((s: number, d: number) => s + d, 0) ?? 0}
              </span>
            </div>
          </Show>
          <Show when={pd?.support_airatack}>
            <div class="text-sm">
              航空支援敵被ダメ:{" "}
              <span class="font-mono text-error">
                {pd.support_airatack.e_damage?.damages?.reduce(
                  (s: number, d: number) => s + d,
                  0,
                ) ?? 0}
              </span>
            </div>
          </Show>
        </div>
      );
    }
    return <div class="text-xs text-base-content/40">データなし</div>;
  };

  return (
    <div class="collapse collapse-arrow rounded-lg border border-base-300 bg-base-200">
      <input type="checkbox" checked />
      <div class="collapse-title font-bold">
        <div class="flex flex-wrap items-center justify-between gap-2 pr-6">
          <span>{phaseName()}</span>
          <span class="flex flex-wrap gap-1">
            <PhaseSummaryBadges items={summaryBadges()} />
          </span>
        </div>
      </div>
      <div class="collapse-content">{phaseContent()}</div>
    </div>
  );
}

// ── Phase extraction from battle ──────────────────────────────────────────

function extractPhaseEntries(
  battle: Record<string, unknown>,
): Array<{ type: Record<string, unknown>; data: unknown }> {
  const entries: Array<{ type: Record<string, unknown>; data: unknown }> = [];

  const phaseDataForKey = (
    battle: Record<string, unknown>,
    key: string,
    idx: number | null,
  ): unknown => {
    switch (key) {
      case "AirBaseAssult":
        return battle.air_base_assault;
      case "CarrierBaseAssault":
        return battle.carrier_base_assault;
      case "AirBaseAirAttack":
        return Array.isArray(battle.air_base_air_attacks)
          ? (battle.air_base_air_attacks as unknown[])[idx ?? 0]
          : (battle.air_base_air_attacks as any)?.attacks?.[idx ?? 0];
      case "OpeningAirAttack":
        return Array.isArray(battle.opening_air_attack)
          ? (battle.opening_air_attack as unknown[])[idx ?? 0]
          : battle.opening_air_attack;
      case "SupportAttack":
        return {
          support_hourai: battle.support_hourai,
          support_airatack: battle.support_airattack,
        };
      case "OpeningTaisen":
        return battle.opening_taisen;
      case "OpeningRaigeki":
        return battle.opening_raigeki;
      case "Hougeki":
        return Array.isArray(battle.hougeki)
          ? ((battle.hougeki as unknown[])[idx ?? 0] ?? battle.hougeki)
          : battle.hougeki;
      case "ClosingRaigeki":
        return battle.closing_raigeki;
      case "FriendlyForceAttack":
        return battle.friendly_force_attack;
      case "MidnightHougeki":
        return battle.midnight_hougeki;
      default:
        return null;
    }
  };

  if (
    Array.isArray(battle.battle_order) &&
    (battle.battle_order as unknown[]).length > 0 &&
    typeof (battle.battle_order as unknown[])[0] === "object"
  ) {
    for (const phaseType of battle.battle_order as Record<string, unknown>[]) {
      const key = Object.keys(phaseType)[0];
      const idx = phaseType[key] as number | null;
      entries.push({ type: phaseType, data: phaseDataForKey(battle, key, idx) });
    }
  } else {
    // Fallback for compact/legacy records
    if (battle.air_base_assault) entries.push({ type: { AirBaseAssult: 0 }, data: battle.air_base_assault });
    if (battle.carrier_base_assault) entries.push({ type: { CarrierBaseAssault: 0 }, data: battle.carrier_base_assault });
    if ((battle.air_base_air_attacks as any)?.attacks?.length || Array.isArray(battle.air_base_air_attacks))
      entries.push({ type: { AirBaseAirAttack: 0 }, data: phaseDataForKey(battle, "AirBaseAirAttack", 0) });
    if ((battle.opening_air_attack as any)?.length || Array.isArray(battle.opening_air_attack))
      entries.push({ type: { OpeningAirAttack: 0 }, data: phaseDataForKey(battle, "OpeningAirAttack", 0) });
    if (battle.support_hourai || battle.support_airattack) entries.push({ type: { SupportAttack: 0 }, data: phaseDataForKey(battle, "SupportAttack", null) });
    if (battle.opening_taisen) entries.push({ type: { OpeningTaisen: 0 }, data: battle.opening_taisen });
    if (battle.opening_raigeki) entries.push({ type: { OpeningRaigeki: 0 }, data: battle.opening_raigeki });
    if ((battle.hougeki as any)?.length || Array.isArray(battle.hougeki)) entries.push({ type: { Hougeki: 0 }, data: phaseDataForKey(battle, "Hougeki", 0) });
    if (battle.closing_raigeki) entries.push({ type: { ClosingRaigeki: 0 }, data: battle.closing_raigeki });
    if (battle.friendly_force_attack) entries.push({ type: { FriendlyForceAttack: 0 }, data: battle.friendly_force_attack });
    if (battle.midnight_hougeki) entries.push({ type: { MidnightHougeki: 0 }, data: battle.midnight_hougeki });
  }
  return entries;
}

// ── Exported component ────────────────────────────────────────────────────

export default function BattlePhaseView(props: {
  battle: Record<string, unknown>;
  fleets: BattleFleets | null;
  mstSlotItemById: Map<number, Record<string, unknown>> | null;
}): JSX.Element {
  const phases = () => extractPhaseEntries(props.battle);
  return (
    <Show
      when={phases().length > 0}
      fallback={
        <div class="text-center text-base-content/40 py-8">
          戦闘フェーズ情報がありません
        </div>
      }
    >
      <div class="space-y-4">
        <For each={phases()}>
          {(entry) => (
            <PhaseCard
              phaseType={entry.type}
              phaseData={entry.data}
              fleets={props.fleets}
              mstSlotItemById={props.mstSlotItemById}
            />
          )}
        </For>
      </div>
    </Show>
  );
}
