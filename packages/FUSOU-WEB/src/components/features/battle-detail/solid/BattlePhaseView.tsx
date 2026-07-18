/** @jsxImportSource solid-js */
import { For, Show, createMemo } from "solid-js";
import type { JSX } from "solid-js";
import type { BattleFleets } from "@/features/battles/types";
import { PHASE_NAMES, AIR_STATE } from "@/features/battles/constants";
import { transitionState } from "@/features/battles/helpers";
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
import { SpriteMotionCounts } from "./sprite-motion-counts";

// ── Phase data helpers ────────────────────────────────────────────────────

function normalizeShellingRows(data: unknown): Array<Record<string, unknown>> {
  const normalizeSi = (value: unknown): unknown[] => {
    if (Array.isArray(value)) return value;
    const n = Number(value ?? 0);
    return Number.isFinite(n) && n > 0 ? [n] : [];
  };

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
      si: normalizeSi((obj.si_list as unknown[])?.[idx] ?? []),
      protect_flag: (obj.protect_flag as unknown[])?.[idx] ?? [],
    }));
  }
  if (obj) {
    return [
      {
        ...obj,
        si: normalizeSi(obj.si),
      },
    ];
  }
  return [];
}

function pickHougekiRowsByRound(
  data: unknown,
  roundIdx: number | null,
): unknown {
  if (!Array.isArray(data)) return data;
  if (roundIdx == null) return data;

  const rows = data as Array<Record<string, unknown>>;
  const byIndex1 = rows.filter(
    (row) => Number(row.index_1 ?? Number.NaN) === roundIdx,
  );
  if (byIndex1.length > 0) return byIndex1;

  return rows[roundIdx] ?? data;
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

function normalizeNightSupportAttackData(
  battle: Record<string, unknown>,
): Record<string, unknown> | null {
  const nested = battle.night_support_attack as
    | Record<string, unknown>
    | null
    | undefined;
  const hourai = (nested?.hourai ?? battle.night_support_hourai) as
    | Record<string, unknown>
    | null
    | undefined;
  const airatack = (nested?.airatack ??
    nested?.airattack ??
    battle.night_support_airatack ??
    battle.night_support_airattack) as
    | Record<string, unknown>
    | null
    | undefined;

  if (!hourai && !airatack) return null;
  return { hourai, airatack };
}

function hasRaigekiActivity(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;

  const raiCandidates = [d.frai, d.f_rai, d.frai_list_items, d.erai, d.e_rai, d.erai_list_items];
  const hasTarget = raiCandidates.some((candidate) => {
    if (!Array.isArray(candidate)) return false;
    return candidate.some((row) => {
      if (Array.isArray(row)) {
        return row.some((v) => {
          const n = Number(v);
          return Number.isFinite(n) && n >= 0;
        });
      }
      const n = Number(row);
      return Number.isFinite(n) && n >= 0;
    });
  });
  if (hasTarget) return true;

  const damages = [d.fdam, d.f_dam, d.edam, d.e_dam];
  return damages.some(
    (arr) =>
      Array.isArray(arr) &&
      arr.some((v) => {
        const n = Number(v ?? 0) || 0;
        return n > 0;
      }),
  );
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
            const attackerSide = atkEnemy
              ? ("enemy" as const)
              : ("friend" as const);
            const defenderSide = atkEnemy
              ? ("friend" as const)
              : ("enemy" as const);
            const attackerHpSnapshot = getRowHpSnapshot(row, attackerSide);
            const attackerCurrentHp =
              Number(attackerHpSnapshot[attackerIdx] ?? 0) || 0;
            const defs = Array.isArray(row.df) ? (row.df as unknown[]) : [];
            const dmgs = Array.isArray(row.damage)
              ? (row.damage as unknown[])
              : [];
            const cls = Array.isArray(row.cl) ? (row.cl as unknown[]) : [];
            const protects = Array.isArray(row.protect_flag)
              ? (row.protect_flag as unknown[])
              : [];
            const sis = Array.isArray(row.si) ? (row.si as unknown[]) : [];
            const defenderHpSnapshot = getRowHpSnapshot(row, defenderSide);

            return (
              <div class="rounded border border-base-300 bg-base-200 p-2 overflow-visible">
                <div class="grid gap-2 md:grid-cols-[260px_20px_minmax(0,1fr)] md:items-start overflow-visible">
                  <div class="space-y-1">
                    <PhaseParticipant
                      name={shipNameFromIndex(
                        attackerSide,
                        attackerIdx,
                        props.fleets,
                      )}
                      side={attackerSide}
                      idx={attackerIdx}
                      hpCurrent={attackerCurrentHp}
                      hpMax={maxHpForShip(
                        attackerSide,
                        attackerIdx,
                        attackerCurrentHp,
                        props.fleets,
                      )}
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
                  <div class="flex items-center justify-center text-base-content/40">
                    →
                  </div>
                  <div class="space-y-1">
                    <Show
                      when={defs.length > 0}
                      fallback={
                        <div class="text-xs text-base-content/40">対象不明</div>
                      }
                    >
                      <For each={defs}>
                        {(d, i) => {
                          const defenderIdx = Number(d ?? 0) || 0;
                          const dmg = Number(dmgs[i()] ?? 0) || 0;
                          const crit = Number(cls[i()] ?? 0) >= 2;
                          const protect = Boolean(protects[i()]);
                          const beforeHp =
                            Number(defenderHpSnapshot[defenderIdx] ?? 0) || 0;
                          const afterHp = Math.max(0, beforeHp - dmg);
                          const mHp = createMemo(() =>
                            maxHpForShip(
                              defenderSide,
                              defenderIdx,
                              beforeHp,
                              props.fleets,
                            ),
                          );
                          const state = createMemo(() =>
                            transitionState(beforeHp, afterHp, mHp()),
                          );
                          return (
                            <div class="rounded bg-base-100 px-2 py-1 border border-base-300">
                              <div class="flex flex-wrap items-center gap-2 justify-between">
                                <div class="min-w-0">
                                  <div class="mb-1 flex items-center gap-1.5">
                                    <ShipIndexBadge idx={defenderIdx} />
                                    <div
                                      class={`text-xs font-semibold ${defenderSide === "enemy" ? "text-error" : "text-info"}`}
                                    >
                                      {shipNameFromIndex(
                                        defenderSide,
                                        defenderIdx,
                                        props.fleets,
                                      )}
                                    </div>
                                  </div>
                                  <div class="text-[10px] text-base-content/65">
                                    <InlineHpMeter
                                      current={beforeHp}
                                      max={mHp()}
                                    />
                                    <span class="text-base-content/40">
                                      {" -> "}
                                    </span>
                                    <InlineHpMeter
                                      current={afterHp}
                                      max={mHp()}
                                    />
                                  </div>
                                </div>
                                <div class="ml-auto flex min-w-[200px] flex-wrap justify-end gap-1">
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
  const fNow = () => getRowHpSnapshot(props.data, "friend");
  const eNow = () => getRowHpSnapshot(props.data, "enemy");
  const fDam = () =>
    Array.isArray(props.data?.f_dam) ? (props.data.f_dam as number[]) : [];
  const eDam = () =>
    Array.isArray(props.data?.e_dam) ? (props.data.e_dam as number[]) : [];
  const fCl = () =>
    Array.isArray(props.data?.f_cl) ? (props.data.f_cl as number[]) : [];
  const eCl = () =>
    Array.isArray(props.data?.e_cl) ? (props.data.e_cl as number[]) : [];
  const fRai = () =>
    Array.isArray(props.data?.f_rai) ? (props.data.f_rai as unknown[]) : [];
  const eRai = () =>
    Array.isArray(props.data?.e_rai) ? (props.data.e_rai as unknown[]) : [];

  interface RaigekiHit {
    atkSide: "friend" | "enemy";
    atkIdx: number;
    defSide: "friend" | "enemy";
    defIdx: number;
    dmg: number;
    crit: boolean;
  }

  const buildHits = (): RaigekiHit[] => {
    const hits: RaigekiHit[] = [];
    const fHpSnapshot = fNow();
    const eHpSnapshot = eNow();
    const sideLimit = (side: "friend" | "enemy"): number => {
      const fleetLen =
        side === "friend"
          ? props.fleets?.friendlyShips?.length ?? 0
          : props.fleets?.enemyShips?.length ?? 0;
      if (fleetLen > 0) return fleetLen;
      return side === "friend" ? fHpSnapshot.length : eHpSnapshot.length;
    };
    const isValidSideIndex = (
      side: "friend" | "enemy",
      idx: number,
    ): boolean => idx >= 0 && idx < sideLimit(side);

    const addHit = (
      atkSide: "friend" | "enemy",
      atkIdx: number,
      defSide: "friend" | "enemy",
      defIdx: number,
      dmg: number,
      crit: boolean,
    ) => {
      if (!isValidSideIndex(atkSide, atkIdx)) return;
      if (!isValidSideIndex(defSide, defIdx)) return;
      hits.push({ atkSide, atkIdx, defSide, defIdx, dmg: Math.max(0, dmg), crit });
    };
    // f_rai[i]: targets for friendly ship i.
    // Opening raigeki: array of arrays; Closing raigeki: flat array of ints.
    fRai().forEach((targets, atkIdx) => {
      if (Array.isArray(targets)) {
        for (const t of targets) {
          const defIdx = Number(t);
          if (!Number.isFinite(defIdx) || defIdx < 0) continue;
          addHit(
            "friend",
            atkIdx,
            "enemy",
            defIdx,
            Number(eDam()[defIdx] ?? 0) || 0,
            Number(eCl()[defIdx] ?? 0) >= 2,
          );
        }
      } else if (Number.isFinite(Number(targets)) && Number(targets) >= 0) {
        const defIdx = Number(targets);
        addHit(
          "friend",
          atkIdx,
          "enemy",
          defIdx,
          Number(eDam()[defIdx] ?? 0) || 0,
          Number(eCl()[defIdx] ?? 0) >= 2,
        );
      }
    });
    eRai().forEach((targets, atkIdx) => {
      if (Array.isArray(targets)) {
        for (const t of targets) {
          const defIdx = Number(t);
          if (!Number.isFinite(defIdx) || defIdx < 0) continue;
          addHit(
            "enemy",
            atkIdx,
            "friend",
            defIdx,
            Number(fDam()[defIdx] ?? 0) || 0,
            Number(fCl()[defIdx] ?? 0) >= 2,
          );
        }
      } else if (Number.isFinite(Number(targets)) && Number(targets) >= 0) {
        const defIdx = Number(targets);
        addHit(
          "enemy",
          atkIdx,
          "friend",
          defIdx,
          Number(fDam()[defIdx] ?? 0) || 0,
          Number(fCl()[defIdx] ?? 0) >= 2,
        );
      }
    });
    // Fallback when no rai mapping data available
    if (hits.length === 0) {
      fDam().forEach((d, i) => {
        const dmg = Number(d ?? 0) || 0;
        if (dmg > 0)
          hits.push({
            atkSide: "enemy",
            atkIdx: i,
            defSide: "friend",
            defIdx: i,
            dmg,
            crit: Number(fCl()[i] ?? 0) >= 2,
          });
      });
      eDam().forEach((d, i) => {
        const dmg = Number(d ?? 0) || 0;
        if (dmg > 0)
          hits.push({
            atkSide: "friend",
            atkIdx: i,
            defSide: "enemy",
            defIdx: i,
            dmg,
            crit: Number(eCl()[i] ?? 0) >= 2,
          });
      });
    }
    return hits.filter((hit) => {
      if (!isValidSideIndex(hit.atkSide, hit.atkIdx)) return false;
      if (!isValidSideIndex(hit.defSide, hit.defIdx)) return false;
      return true;
    });
  };

  const hits = () => buildHits();

  return (
    <Show
      when={hits().length > 0}
      fallback={
        <div class="text-xs text-base-content/50">
          {props.title}: 有効打なし
        </div>
      }
    >
      <div class="mb-1 hidden text-[10px] uppercase tracking-wide text-base-content/45 md:grid md:grid-cols-[minmax(0,260px)_20px_minmax(0,1fr)] md:items-center">
        <span>攻撃艦</span>
        <span />
        <span>対象 / 結果</span>
      </div>
      <div class="space-y-2">
        <For each={hits()}>
          {(hit) => {
            const defHpSnap = hit.defSide === "friend" ? fNow() : eNow();
            const atkHpSnap = hit.atkSide === "friend" ? fNow() : eNow();
            const beforeHp = Number(defHpSnap[hit.defIdx] ?? 0) || 0;
            const afterHp = Math.max(0, beforeHp - hit.dmg);
            const atkHp = Number(atkHpSnap[hit.atkIdx] ?? 0) || 0;
            const mHp = createMemo(() =>
              maxHpForShip(hit.defSide, hit.defIdx, beforeHp, props.fleets),
            );
            const state = createMemo(() =>
              transitionState(beforeHp, afterHp, mHp()),
            );
            return (
              <div class="rounded border border-base-300 bg-base-200 p-2">
                <div class="grid gap-2 md:grid-cols-[260px_20px_minmax(0,1fr)] md:items-start">
                  <PhaseParticipant
                    name={shipNameFromIndex(
                      hit.atkSide,
                      hit.atkIdx,
                      props.fleets,
                    )}
                    side={hit.atkSide}
                    idx={hit.atkIdx}
                    hpCurrent={atkHp}
                    hpMax={maxHpForShip(
                      hit.atkSide,
                      hit.atkIdx,
                      atkHp,
                      props.fleets,
                    )}
                  />
                  <div class="flex items-center justify-center text-base-content/40">
                    →
                  </div>
                  <div class="rounded bg-base-100 px-2 py-1 border border-base-300">
                    <div class="flex flex-wrap items-center gap-2 justify-between">
                      <div class="min-w-0">
                        <div class="mb-1 flex items-center gap-1.5">
                          <ShipIndexBadge idx={hit.defIdx} />
                          <div
                            class={`text-xs font-semibold ${hit.defSide === "enemy" ? "text-error" : "text-info"}`}
                          >
                            {shipNameFromIndex(
                              hit.defSide,
                              hit.defIdx,
                              props.fleets,
                            )}
                          </div>
                        </div>
                        <div class="text-[10px] text-base-content/65">
                          <InlineHpMeter current={beforeHp} max={mHp()} />
                          <span class="text-base-content/40">{" -> "}</span>
                          <InlineHpMeter current={afterHp} max={mHp()} />
                        </div>
                      </div>
                      <div class="ml-auto flex min-w-[200px] flex-wrap justify-end gap-1">
                        <OutcomeBadges
                          damage={hit.dmg}
                          crit={hit.crit}
                          protect={false}
                          sunk={state().sunk}
                          afterState={state().afterState}
                        />
                      </div>
                    </div>
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

function AirAttackRows(props: {
  data: Record<string, unknown>;
  fleets: BattleFleets | null;
}): JSX.Element {
  const fNow = () => getRowHpSnapshot(props.data, "friend");
  const eNow = () => getRowHpSnapshot(props.data, "enemy");
  const fPlaneFrom = () =>
    Array.isArray(props.data?.f_plane_from)
      ? (props.data.f_plane_from as number[])
      : [];
  const ePlaneFrom = () =>
    Array.isArray(props.data?.e_plane_from)
      ? (props.data.e_plane_from as number[])
      : [];
  const fDamages = () =>
    Array.isArray(props.data?.f_damages)
      ? (props.data.f_damages as number[])
      : [];
  const eDamages = () =>
    Array.isArray(props.data?.e_damages)
      ? (props.data.e_damages as number[])
      : [];
  const fCl = () =>
    Array.isArray(props.data?.f_cl) ? (props.data.f_cl as number[]) : [];
  const eCl = () =>
    Array.isArray(props.data?.e_cl) ? (props.data.e_cl as number[]) : [];
  const fBak = () =>
    Array.isArray(props.data?.f_bak_flag)
      ? (props.data.f_bak_flag as (number | null)[])
      : [];
  const eBak = () =>
    Array.isArray(props.data?.e_bak_flag)
      ? (props.data.e_bak_flag as (number | null)[])
      : [];
  const fRaiFlag = () =>
    Array.isArray(props.data?.f_rai_flag)
      ? (props.data.f_rai_flag as (number | null)[])
      : [];
  const eRaiFlag = () =>
    Array.isArray(props.data?.e_rai_flag)
      ? (props.data.e_rai_flag as (number | null)[])
      : [];
  const airLabel = () => {
    const label = AIR_STATE[Number(props.data?.air_superiority ?? -1)]?.label;
    return typeof label === "string" && label.length > 0 ? label : null;
  };
  const hasAnyAirSortie = () => fPlaneFrom().length > 0 || ePlaneFrom().length > 0;
  const hasAnyAirDamage = () =>
    fDefs().some((d) => d.dmg > 0) || eDefs().some((d) => d.dmg > 0);

  const eDefs = () =>
    eDamages()
      .map((dmg, i) => ({
        idx: i,
        dmg: Number(dmg) || 0,
        crit: Number(eCl()[i] ?? 0) >= 2,
      }))
      .filter(
        (d) =>
          d.dmg > 0 || (eBak()[d.idx] ?? 0) > 0 || (eRaiFlag()[d.idx] ?? 0) > 0,
      );

  const fDefs = () =>
    fDamages()
      .map((dmg, i) => ({
        idx: i,
        dmg: Number(dmg) || 0,
        crit: Number(fCl()[i] ?? 0) >= 2,
      }))
      .filter(
        (d) =>
          d.dmg > 0 || (fBak()[d.idx] ?? 0) > 0 || (fRaiFlag()[d.idx] ?? 0) > 0,
      );

  const renderDefenders = (
    defs: { idx: number; dmg: number; crit: boolean }[],
    defSide: "friend" | "enemy",
    hpSnap: () => unknown[],
  ) => (
    <div class="space-y-1">
      <Show
        when={defs.length > 0}
        fallback={<div class="text-xs text-base-content/40">有効打なし</div>}
      >
        <For each={defs}>
          {(def) => {
            const beforeHp = Number(hpSnap()[def.idx] ?? 0) || 0;
            const afterHp = Math.max(0, beforeHp - def.dmg);
            const mHp = createMemo(() =>
              maxHpForShip(defSide, def.idx, beforeHp, props.fleets),
            );
            const state = createMemo(() =>
              transitionState(beforeHp, afterHp, mHp()),
            );
            return (
              <div class="rounded bg-base-100 px-2 py-1 border border-base-300">
                <div class="flex flex-wrap items-center gap-2 justify-between">
                  <div class="min-w-0">
                    <div class="mb-1 flex items-center gap-1.5">
                      <ShipIndexBadge idx={def.idx} />
                      <div
                        class={`text-xs font-semibold ${defSide === "enemy" ? "text-error" : "text-info"}`}
                      >
                        {shipNameFromIndex(defSide, def.idx, props.fleets)}
                      </div>
                    </div>
                    <div class="text-[10px] text-base-content/65">
                      <InlineHpMeter current={beforeHp} max={mHp()} />
                      <span class="text-base-content/40">{" -> "}</span>
                      <InlineHpMeter current={afterHp} max={mHp()} />
                    </div>
                  </div>
                  <div class="ml-auto flex min-w-[200px] flex-wrap justify-end gap-1">
                    <OutcomeBadges
                      damage={def.dmg}
                      crit={def.crit}
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
      </Show>
    </div>
  );

  return (
    <div class="space-y-3">
      <Show when={airLabel() && (hasAnyAirSortie() || hasAnyAirDamage())}>
        <div class="flex items-center gap-2 text-xs text-base-content/55">
          <span class="font-semibold">制空: {airLabel()}</span>
        </div>
      </Show>
      {/* Friendly planes attacking enemies */}
      <Show when={fPlaneFrom().length > 0 || fDefs().length > 0}>
        <div class="rounded border border-base-300 bg-base-200 p-2">
          <div class="grid gap-2 md:grid-cols-[260px_20px_minmax(0,1fr)] md:items-start">
            <div class="space-y-1">
              <div class="text-[10px] uppercase tracking-wide text-base-content/45 mb-1">
                友軍艦載機
              </div>
              <For each={fPlaneFrom()}>
                {(shipIdx) => {
                  const h = Number(fNow()[shipIdx] ?? 0) || 0;
                  return (
                    <PhaseParticipant
                      name={shipNameFromIndex("friend", shipIdx, props.fleets)}
                      side="friend"
                      idx={shipIdx}
                      hpCurrent={h}
                      hpMax={maxHpForShip("friend", shipIdx, h, props.fleets)}
                    />
                  );
                }}
              </For>
            </div>
            <div class="flex items-center justify-center text-base-content/40">
              →
            </div>
            {renderDefenders(eDefs(), "enemy", eNow)}
          </div>
        </div>
      </Show>
      {/* Enemy planes attacking friendlies */}
      <Show when={ePlaneFrom().length > 0 || eDefs().length > 0}>
        <div class="rounded border border-base-300 bg-base-200 p-2">
          <div class="grid gap-2 md:grid-cols-[260px_20px_minmax(0,1fr)] md:items-start">
            <div class="space-y-1">
              <div class="text-[10px] uppercase tracking-wide text-base-content/45 mb-1">
                敵艦載機
              </div>
              <For each={ePlaneFrom()}>
                {(shipIdx) => {
                  const h = Number(eNow()[shipIdx] ?? 0) || 0;
                  return (
                    <PhaseParticipant
                      name={shipNameFromIndex("enemy", shipIdx, props.fleets)}
                      side="enemy"
                      idx={shipIdx}
                      hpCurrent={h}
                      hpMax={maxHpForShip("enemy", shipIdx, h, props.fleets)}
                    />
                  );
                }}
              </For>
            </div>
            <div class="flex items-center justify-center text-base-content/40">
              →
            </div>
            {renderDefenders(fDefs(), "friend", fNow)}
          </div>
        </div>
      </Show>
    </div>
  );
}

function readDestructionValue(
  source: Record<string, unknown>,
  key: string,
): number | null {
  const direct = source[key];
  if (direct != null) {
    const n = Number(direct);
    return Number.isFinite(n) ? n : null;
  }
  const nested = (source.air_base_attack as Record<string, unknown> | undefined)?.[key];
  if (nested != null) {
    const n = Number(nested);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function destructionLostKindLabel(lostKind: number | null): string {
  switch (lostKind) {
    case 0:
      return "None";
    case 1:
      return "Half squadron lost";
    case 2:
      return "One squadron lost";
    case 3:
      return "Two squadrons lost";
    case 4:
      return "Three squadrons lost";
    case 5:
      return "All squadrons lost";
    default:
      return "Unknown";
  }
}

function DestructionBattleCard(props: {
  data: Record<string, unknown>;
}): JSX.Element {
  const airSuperiority = () =>
    readDestructionValue(props.data, "air_superiority") ?? -1;
  const lostKind = () => readDestructionValue(props.data, "lost_kind");

  return (
    <div class="collapse collapse-arrow rounded-lg border border-base-300 bg-base-200">
      <input type="checkbox" checked />
      <div class="collapse-title font-bold">
        <div class="flex flex-wrap items-center justify-between gap-2 pr-6">
          <span>基地空襲 (Destruction Battle)</span>
          <span class="flex flex-wrap gap-1">
            <PhaseSummaryBadges
              items={[
                AIR_STATE[airSuperiority()]?.label ?? "-",
                `Lost: ${destructionLostKindLabel(lostKind())}`,
              ]}
            />
          </span>
        </div>
      </div>
      <div class="collapse-content">
        <div class="rounded border border-base-300 bg-base-100 p-2 text-sm">
          <SpriteMotionCounts
            counts={{
              f_sprite_fly_count: readDestructionValue(props.data, "f_sprite_fly_count"),
              e_sprite_fly_count: readDestructionValue(props.data, "e_sprite_fly_count"),
              f_sprite_crash_count: readDestructionValue(props.data, "f_sprite_crash_count"),
              e_sprite_crash_count: readDestructionValue(props.data, "e_sprite_crash_count"),
              f_sprite_damage_count: readDestructionValue(props.data, "f_sprite_damage_count"),
              e_sprite_damage_count: readDestructionValue(props.data, "e_sprite_damage_count"),
              f_sprite_non_normal_count: readDestructionValue(props.data, "f_sprite_non_normal_count"),
              e_sprite_non_normal_count: readDestructionValue(props.data, "e_sprite_non_normal_count"),
            }}
          />
        </div>
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
    return PHASE_NAMES[phaseKey()] ?? phaseKey();
  };

  const summaryBadges = (): (string | null)[] => {
    const key = phaseKey();
    if (
      key === "Hougeki" ||
      key === "OpeningTaisen" ||
      key === "MidnightHougeki"
    ) {
      const rows = normalizeShellingRows(props.phaseData);
      if (rows.length > 0) {
        return [`${rows.length}行動`, `総与ダメ ${sumDamage(rows)}`];
      }
    } else if (key === "OpeningRaigeki" || key === "ClosingRaigeki") {
      const pd = props.phaseData as Record<string, unknown> | null;
      const fTotal = Array.isArray(pd?.f_dam)
        ? (pd!.f_dam as unknown[]).reduce(
            (s: number, d: unknown) => s + (Number(d ?? 0) || 0),
            0,
          )
        : 0;
      const eTotal = Array.isArray(pd?.e_dam)
        ? (pd!.e_dam as unknown[]).reduce(
            (s: number, d: unknown) => s + (Number(d ?? 0) || 0),
            0,
          )
        : 0;
      return [`味方被ダメ ${fTotal}`, `敵被ダメ ${eTotal}`];
    } else if (key === "OpeningAirAttack" || key === "AirBaseAirAttack") {
      const first = Array.isArray(props.phaseData)
        ? (props.phaseData as Record<string, unknown>[])[0]
        : (props.phaseData as Record<string, unknown>);
      if (first) {
        const fTotal: number = Array.isArray(first.f_damages)
          ? Number(
              (first.f_damages as unknown[]).reduce(
                (s: number, d: unknown) => s + (Number(d ?? 0) || 0),
                0,
              ),
            )
          : 0;
        const eTotal: number = Array.isArray(first.e_damages)
          ? Number(
              (first.e_damages as unknown[]).reduce(
                (s: number, d: unknown) => s + (Number(d ?? 0) || 0),
                0,
              ),
            )
          : 0;
        const airLabel = AIR_STATE[Number(first.air_superiority ?? -1)]?.label;
        const badges: string[] = [];
        if (typeof airLabel === "string" && airLabel.length > 0) {
          badges.push(airLabel);
        }
        if (fTotal > 0 || eTotal > 0) {
          badges.push(`味方被ダメ ${fTotal}`, `敵被ダメ ${eTotal}`);
        }
        return badges;
      }
    } else if (key === "SupportAttack") {
      const pd = props.phaseData as Record<string, unknown> | null;
      const badges: string[] = [];
      if ((pd as any)?.support_hourai) {
        const totalDmg =
          ((pd as any).support_hourai.damage as number[] | undefined)?.reduce(
            (s: number, d: number) => s + d,
            0,
          ) ?? 0;
        badges.push(`砲雷 ${totalDmg}`);
      }
      if ((pd as any)?.support_airatack) {
        const eDmg =
          (
            (pd as any).support_airatack.e_damage?.damages as
              | number[]
              | undefined
          )?.reduce((s: number, d: number) => s + d, 0) ?? 0;
        badges.push(`航空 ${eDmg}`);
      }
      return badges;
    } else if (key === "NightSupportAttack") {
      const pd = props.phaseData as Record<string, unknown> | null;
      const badges: string[] = [];
      const totalDmg =
        ((pd as any)?.hourai?.damage as number[] | undefined)?.reduce(
          (s: number, d: number) => s + d,
          0,
        ) ?? 0;
      if ((pd as any)?.hourai) badges.push(`砲雷 ${totalDmg}`);
      if ((pd as any)?.airatack) {
        const eDmg =
          (
            (pd as any).airatack.e_damage?.damages as number[] | undefined
          )?.reduce((s: number, d: number) => s + d, 0) ?? 0;
        badges.push(`航空 ${eDmg}`);
      }
      return badges.length > 0 ? badges : ["夜間支援 0"];
    }
    return [];
  };

  const phaseContent = (): JSX.Element => {
    const key = phaseKey();
    if (
      key === "Hougeki" ||
      key === "OpeningTaisen" ||
      key === "MidnightHougeki"
    ) {
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
      if (first) return <AirAttackRows data={first} fleets={props.fleets} />;
    } else if (key === "NightSupportAttack") {
      const pd = props.phaseData as any;
      return (
        <div>
          <Show when={pd?.hourai}>
            <div class="text-sm">
              夜間支援敵被ダメ合計:{" "}
              <span class="font-mono text-error">
                {pd.hourai.damage?.reduce((s: number, d: number) => s + d, 0) ??
                  0}
              </span>
            </div>
          </Show>
          <Show when={pd?.airatack}>
            <div class="text-sm">
              夜間航空支援敵被ダメ合計:{" "}
              <span class="font-mono text-error">
                {pd.airatack.e_damage?.damages?.reduce(
                  (s: number, d: number) => s + d,
                  0,
                ) ?? 0}
              </span>
            </div>
          </Show>
        </div>
      );
    } else if (key === "SupportAttack") {
      const pd = props.phaseData as any;
      return (
        <div>
          <Show when={pd?.support_hourai}>
            <div class="text-sm">
              敵被ダメ合計:{" "}
              <span class="font-mono text-error">
                {pd.support_hourai.damage?.reduce(
                  (s: number, d: number) => s + d,
                  0,
                ) ?? 0}
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
        return pickHougekiRowsByRound(battle.hougeki, idx);
      case "ClosingRaigeki":
        return battle.closing_raigeki;
      case "FriendlyForceAttack":
        return battle.friendly_force_attack;
      case "NightSupportAttack":
        return normalizeNightSupportAttackData(battle);
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
    const presentKeys = new Set<string>();
    for (const phaseType of battle.battle_order as Record<string, unknown>[]) {
      const key = Object.keys(phaseType)[0];
      presentKeys.add(key);
      const idx = phaseType[key] as number | null;
      entries.push({
        type: phaseType,
        data: phaseDataForKey(battle, key, idx),
      });
    }
    if (!presentKeys.has("OpeningRaigeki") && hasRaigekiActivity(battle.opening_raigeki)) {
      entries.push({
        type: { OpeningRaigeki: 0 },
        data: battle.opening_raigeki,
      });
    }
    if (!presentKeys.has("ClosingRaigeki") && hasRaigekiActivity(battle.closing_raigeki)) {
      entries.push({
        type: { ClosingRaigeki: 0 },
        data: battle.closing_raigeki,
      });
    }
  } else {
    // Fallback for compact/legacy records
    if (battle.air_base_assault)
      entries.push({
        type: { AirBaseAssult: 0 },
        data: battle.air_base_assault,
      });
    if (battle.carrier_base_assault)
      entries.push({
        type: { CarrierBaseAssault: 0 },
        data: battle.carrier_base_assault,
      });
    if (
      (battle.air_base_air_attacks as any)?.attacks?.length ||
      Array.isArray(battle.air_base_air_attacks)
    )
      entries.push({
        type: { AirBaseAirAttack: 0 },
        data: phaseDataForKey(battle, "AirBaseAirAttack", 0),
      });
    if (
      (battle.opening_air_attack as any)?.length ||
      Array.isArray(battle.opening_air_attack)
    )
      entries.push({
        type: { OpeningAirAttack: 0 },
        data: phaseDataForKey(battle, "OpeningAirAttack", 0),
      });
    if (battle.support_hourai || battle.support_airattack)
      entries.push({
        type: { SupportAttack: 0 },
        data: phaseDataForKey(battle, "SupportAttack", null),
      });
    if (battle.opening_taisen)
      entries.push({ type: { OpeningTaisen: 0 }, data: battle.opening_taisen });
    if (battle.opening_raigeki)
      entries.push({
        type: { OpeningRaigeki: 0 },
        data: battle.opening_raigeki,
      });
    if (battle.hougeki)
      entries.push({
        type: { Hougeki: null },
        data: phaseDataForKey(battle, "Hougeki", null),
      });
    if (battle.closing_raigeki)
      entries.push({
        type: { ClosingRaigeki: 0 },
        data: battle.closing_raigeki,
      });
    if (battle.friendly_force_attack)
      entries.push({
        type: { FriendlyForceAttack: 0 },
        data: battle.friendly_force_attack,
      });
    if (normalizeNightSupportAttackData(battle))
      entries.push({
        type: { NightSupportAttack: 0 },
        data: phaseDataForKey(battle, "NightSupportAttack", null),
      });
    if (battle.midnight_hougeki)
      entries.push({
        type: { MidnightHougeki: 0 },
        data: battle.midnight_hougeki,
      });
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
  const destructionBattle = () =>
    (props.battle.destruction_battle as Record<string, unknown> | null) ?? null;
  return (
    <Show
      when={phases().length > 0 || !!destructionBattle()}
      fallback={
        <div class="text-center text-base-content/40 py-8">
          戦闘フェーズ情報がありません
        </div>
      }
    >
      <div class="space-y-4">
        <Show when={destructionBattle()}>{(db) => <DestructionBattleCard data={db()} />}</Show>
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
