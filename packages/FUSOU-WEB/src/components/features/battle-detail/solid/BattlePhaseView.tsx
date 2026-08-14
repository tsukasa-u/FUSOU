/** @jsxImportSource solid-js */
import { For, Show, createMemo } from "solid-js";
import type { JSX } from "solid-js";
import type { BattleFleets } from "@/features/battles/types";
import { PHASE_NAMES, AIR_STATE } from "@/features/battles/constants";
import { transitionState } from "@/features/battles/helpers";
import { buildTimelineEvents } from "@/features/battles/timeline";
import {
  shipNameFromIndex,
  maxHpForShip,
  ShipIndexBadge,
  PhaseParticipant,
  InlineHpMeter,
  OutcomeBadges,
  PhaseSummaryBadges,
  EquipmentBadgesFromSlotIds,
} from "./ui";
import { SpriteMotionCounts } from "./sprite-motion-counts";
import type { TimelineEvent } from "@/features/battles/types";

function isAirbaseInvolvedPhaseKey(key: string): boolean {
  return (
    key === "AirBaseAirAttack" ||
    key === "AirBaseAssult" ||
    key === "CarrierBaseAssault"
  );
}

function mstShipNameFromId(
  mstShipById: Map<number, Record<string, unknown>> | null | undefined,
  id: number | null | undefined,
): string | null {
  const n = Number(id ?? 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  const row = mstShipById?.get(n);
  const name = row ? String(row["name"] ?? "") : "";
  return name.length > 0 ? name : null;
}

// ── Phase data helpers ────────────────────────────────────────────────────

function pickHougekiRowsByRound(
  data: unknown,
  roundIdx: number | null,
): unknown {
  if (!Array.isArray(data)) return data;
  if (roundIdx == null) return data;

  const rows = data as Array<Record<string, unknown>>;
  const byIndex1 = rows.filter(
    (row) => Number(row["index_1"] ?? Number.NaN) === roundIdx,
  );
  if (byIndex1.length > 0) return byIndex1;

  return rows[roundIdx] ?? data;
}

function normalizeNightSupportAttackData(
  battle: Record<string, unknown>,
): Record<string, unknown> | null {
  const nested = battle["night_support_attack"] as
    | Record<string, unknown>
    | null
    | undefined;
  const hourai = (nested?.["hourai"] ?? battle["night_support_hourai"]) as
    | Record<string, unknown>
    | null
    | undefined;
  const airatack = (nested?.["airatack"] ??
    nested?.["airattack"] ??
    battle["night_support_airatack"] ??
    battle["night_support_airattack"]) as
    | Record<string, unknown>
    | null
    | undefined;

  if (!hourai && !airatack) return null;
  return { hourai, airatack };
}

function hasRaigekiActivity(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;

  const raiCandidates = [d["frai"], d["f_rai"], d["frai_list_items"], d["erai"], d["e_rai"], d["erai_list_items"]];
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

  const damages = [d["fdam"], d["f_dam"], d["edam"], d["e_dam"]];
  return damages.some(
    (arr) =>
      Array.isArray(arr) &&
      arr.some((v) => {
        const n = Number(v ?? 0) || 0;
        return n > 0;
      }),
  );
}

function RaigekiRows(props: {
  events: TimelineEvent[];
  title: string;
  fleets: BattleFleets | null;
}): JSX.Element {
  interface ResolvedRaigekiHit {
    attackerSide: "friend" | "enemy";
    attackerIdx: number | null;
    attackerGroup: number[];
    defenderSide: "friend" | "enemy";
    defenderIdx: number;
    dmg: number;
    crit: boolean;
    beforeHp: number;
    afterHp: number;
    atkHp: number;
    sunk: boolean;
  }

  const resolvedHits = (): ResolvedRaigekiHit[] => {
    const evs = props.events;
    if (evs.length === 0) return [];
    const first = evs[0];
    const fState = Array.isArray(first.fHps)
      ? first.fHps.map((v) => Number(v ?? 0) || 0)
      : [];
    const eState = Array.isArray(first.eHps)
      ? first.eHps.map((v) => Number(v ?? 0) || 0)
      : [];

    return evs
      .filter((ev) => ev.type === "raigeki" && ev.defenderIdx !== null)
      .map((ev) => {
        const attackerGroup = Array.isArray(ev.attackerGroup)
          ? ev.attackerGroup
          : [];
        const atkPool = ev.attackerSide === "friend" ? fState : eState;
        const defPool = ev.defenderSide === "friend" ? fState : eState;
        const atkHp =
          ev.attackerIdx !== null
            ? Number(atkPool[ev.attackerIdx] ?? 0) || 0
            : 0;
        const defIdx = ev.defenderIdx as number;
        const beforeHp = Number(defPool[defIdx] ?? 0) || 0;
        const afterHp = Math.max(0, beforeHp - Math.max(0, ev.damage));
        defPool[defIdx] = afterHp;
        return {
          attackerSide: ev.attackerSide,
          attackerIdx: ev.attackerIdx,
          attackerGroup,
          defenderSide: ev.defenderSide,
          defenderIdx: defIdx,
          dmg: ev.damage,
          crit: ev.crit,
          beforeHp,
          afterHp,
          atkHp,
          sunk: ev.sunk,
        };
      });
  };

  const attackerLabel = (hit: ResolvedRaigekiHit): string => {
    if (hit.attackerGroup.length > 1) {
      return hit.attackerGroup.map((idx) => `${idx + 1}番`).join("+");
    }
    return hit.attackerIdx !== null ? `${hit.attackerIdx + 1}番` : "-";
  };

  const attackerName = (hit: ResolvedRaigekiHit): string => {
    if (hit.attackerGroup.length > 1) {
      return hit.attackerGroup
        .map((idx) => shipNameFromIndex(hit.attackerSide, idx, props.fleets))
        .join(" / ");
    }
    if (hit.attackerIdx === null) return "不明";
    return shipNameFromIndex(hit.attackerSide, hit.attackerIdx, props.fleets);
  };

  return (
    <Show
      when={resolvedHits().length > 0}
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
        <For each={resolvedHits()}>
          {(hit) => {
            const mHp = createMemo(() =>
              maxHpForShip(
                hit.defenderSide,
                hit.defenderIdx,
                hit.beforeHp,
                props.fleets,
              ),
            );
            const state = createMemo(() =>
              transitionState(hit.beforeHp, hit.afterHp, mHp()),
            );
            const multiAttack = () => hit.attackerGroup.length > 1;
            return (
              <div class="rounded border border-base-300 bg-base-200 p-2">
                <div class="grid gap-2 md:grid-cols-[260px_20px_minmax(0,1fr)] md:items-start">
                  <Show
                    when={!multiAttack() && hit.attackerIdx !== null}
                    fallback={
                      <div class="rounded bg-base-100 px-2 py-1 border border-base-300">
                        <div class="mb-1 flex items-center gap-1.5">
                          <div
                            class={`text-[10px] font-mono font-bold ${hit.attackerSide === "enemy" ? "text-error" : "text-info"}`}
                          >
                            {attackerLabel(hit)}
                          </div>
                          <div class="text-xs font-semibold text-base-content/70">
                            {attackerName(hit)}
                          </div>
                        </div>
                      </div>
                    }
                  >
                    <PhaseParticipant
                      name={shipNameFromIndex(
                        hit.attackerSide,
                        hit.attackerIdx as number,
                        props.fleets,
                      )}
                      side={hit.attackerSide}
                      idx={hit.attackerIdx as number}
                      hpCurrent={hit.atkHp}
                      hpMax={maxHpForShip(
                        hit.attackerSide,
                        hit.attackerIdx as number,
                        hit.atkHp,
                        props.fleets,
                      )}
                    />
                  </Show>
                  <div class="flex items-center justify-center text-base-content/40">
                    →
                  </div>
                  <div class="rounded bg-base-100 px-2 py-1 border border-base-300">
                    <div class="flex flex-wrap items-center gap-2 justify-between">
                      <div class="min-w-0">
                        <div class="mb-1 flex items-center gap-1.5">
                          <ShipIndexBadge idx={hit.defenderIdx} side={hit.defenderSide} />
                          <div class="text-xs font-semibold text-base-content/70">
                            {shipNameFromIndex(
                              hit.defenderSide,
                              hit.defenderIdx,
                              props.fleets,
                            )}
                          </div>
                        </div>
                        <div class="text-[10px] text-base-content/65">
                          <InlineHpMeter current={hit.beforeHp} max={mHp()} />
                          <span class="text-base-content/40">{" -> "}</span>
                          <InlineHpMeter current={hit.afterHp} max={mHp()} />
                        </div>
                      </div>
                      <div class="ml-auto flex min-w-[200px] flex-wrap justify-end gap-1">
                        <OutcomeBadges
                          damage={hit.dmg}
                          crit={hit.crit}
                          protect={false}
                          sunk={hit.sunk || state().sunk}
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

function AirAttackBatchRows(props: {
  events: TimelineEvent[];
  fleets: BattleFleets | null;
  mstSlotItemById: Map<number, Record<string, unknown>> | null;
  mstShipById: Map<number, Record<string, unknown>> | null;
}): JSX.Element {
  const batches = createMemo(() => {
    const map = new Map<number, TimelineEvent[]>();
    let fallbackId = -1;
    for (const ev of props.events) {
      if (ev.type !== "air" || ev.separator === true) continue;
      const id = Number.isFinite(Number(ev.airBatchId))
        ? Number(ev.airBatchId)
        : fallbackId--;
      const rows = map.get(id) ?? [];
      rows.push(ev);
      map.set(id, rows);
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, rows]) => rows);
  });

  const resolvedRows = (rows: TimelineEvent[]) => {
    if (rows.length === 0) return [] as Array<{
      event: TimelineEvent;
      beforeHp: number | null;
      afterHp: number | null;
    }>;
    const first = rows[0];
    const fState = Array.isArray(first.fHps)
      ? first.fHps.map((v) => Number(v ?? 0) || 0)
      : [];
    const eState = Array.isArray(first.eHps)
      ? first.eHps.map((v) => Number(v ?? 0) || 0)
      : [];

    return rows.map((ev) => {
      if (ev.defenderIdx === null) {
        return { event: ev, beforeHp: null, afterHp: null };
      }
      const defPool = ev.defenderSide === "friend" ? fState : eState;
      const beforeHp = Number(defPool[ev.defenderIdx] ?? 0) || 0;
      const afterHp = Math.max(0, beforeHp - Math.max(0, ev.damage));
      defPool[ev.defenderIdx] = afterHp;
      return { event: ev, beforeHp, afterHp };
    });
  };

  const batchLabel = (rows: TimelineEvent[]): string => {
    const first = rows[0];
    if (first?.actorRole === "airbase") return "基地航空隊";
    if (first?.actorRole === "support") return "支援航空攻撃";
    return "艦載機";
  };

  const renderAttackerBlock = (ev: TimelineEvent): JSX.Element => {
    const group = Array.isArray(ev.attackerGroup)
      ? ev.attackerGroup.filter(
          (v) => Number.isFinite(Number(v)) && Number(v) >= 0,
        )
      : [];
    const slotIds = Array.isArray(ev.slotItems)
      ? ev.slotItems
          .map((v) => Number(v ?? 0))
          .filter((n) => Number.isFinite(n) && n > 0)
      : [];
    const sourceLabel =
      ev.attackerSide === "friend"
        ? ev.actorRole === "airbase"
          ? "基地航空隊"
          : "友軍艦載機"
        : "敵艦載機";
    const preserveFormationDuplicates = ev.actorRole === "airbase";

    return (
      <div class="space-y-1">
        <div class="text-[10px] uppercase tracking-wide text-base-content/45 mb-1">
          {sourceLabel}
        </div>
        <Show when={slotIds.length > 0}>
          <div class="text-[10px] text-base-content/55">
            <EquipmentBadgesFromSlotIds
              slotIds={slotIds}
              mstSlotItemById={props.mstSlotItemById}
              preserveDuplicates={preserveFormationDuplicates}
            />
          </div>
        </Show>
        <Show when={group.length > 0}>
          <For each={group}>
            {(shipIdx) => {
              const idx = Number(shipIdx);
              const hpPool = ev.attackerSide === "friend" ? ev.fHps : ev.eHps;
              const h = Number(hpPool[idx] ?? 0) || 0;
              return (
                <PhaseParticipant
                  name={shipNameFromIndex(ev.attackerSide, idx, props.fleets)}
                  side={ev.attackerSide}
                  idx={idx}
                  hpCurrent={h}
                  hpMax={maxHpForShip(ev.attackerSide, idx, h, props.fleets)}
                />
              );
            }}
          </For>
        </Show>
        <Show when={group.length === 0 && !!ev.attackerMstShipId}>
          <div class="rounded bg-base-100 px-2 py-1 border border-base-300 text-xs font-semibold text-base-content/70">
            {mstShipNameFromId(props.mstShipById, ev.attackerMstShipId) ??
              `艦ID:${ev.attackerMstShipId}`}
          </div>
        </Show>
      </div>
    );
  };

  const renderDefenderRows = (
    rows: Array<{ event: TimelineEvent; beforeHp: number | null; afterHp: number | null }>,
  ): JSX.Element => {
    const effective = rows.filter(
      (r) => r.event.defenderIdx !== null && r.beforeHp !== null && r.afterHp !== null,
    );
    if (effective.length === 0) {
      return (
        <div class="rounded bg-base-100 px-2 py-1 border border-base-300 h-full">
          <div class="h-full min-h-[56px] flex items-center justify-between text-xs">
            <span class="text-base-content/40">対象なし</span>
            <span class="font-semibold text-base-content/55">MISS</span>
          </div>
        </div>
      );
    }

    return (
      <div class="space-y-1">
        <For each={effective}>
          {(row) => {
            const ev = row.event;
            const beforeHp = row.beforeHp as number;
            const afterHp = row.afterHp as number;
            const mHp = createMemo(() =>
              maxHpForShip(
                ev.defenderSide,
                ev.defenderIdx as number,
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
                      <ShipIndexBadge idx={ev.defenderIdx as number} side={ev.defenderSide} />
                      <div class="text-xs font-semibold text-base-content/70">
                        {shipNameFromIndex(
                          ev.defenderSide,
                          ev.defenderIdx as number,
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
                      damage={ev.damage}
                      crit={ev.crit}
                      protect={false}
                      sunk={ev.sunk || state().sunk}
                      afterState={state().afterState}
                    />
                  </div>
                </div>
              </div>
            );
          }}
        </For>
      </div>
    );
  };

  return (
    <Show
      when={batches().length > 0}
      fallback={<div class="text-xs text-base-content/50">有効打なし</div>}
    >
      <div class="space-y-4">
        <For each={batches()}>
          {(batch, i) => {
            const rows = resolvedRows(batch);
            const friendRows = rows.filter((r) => r.event.attackerSide === "friend");
            const enemyRows = rows.filter((r) => r.event.attackerSide === "enemy");
            const firstFriend = friendRows[0]?.event;
            const firstEnemy = enemyRows[0]?.event;

            return (
              <div class="space-y-2">
                <Show when={batches().length > 1}>
                  <div class="text-xs font-bold">{batchLabel(batch)} 第{i() + 1}波</div>
                </Show>
                <Show when={!!firstFriend}>
                  <div class="rounded border border-base-300 bg-base-200 p-2">
                    <div class="grid gap-2 md:grid-cols-[260px_20px_minmax(0,1fr)] md:items-stretch">
                      {renderAttackerBlock(firstFriend as TimelineEvent)}
                      <div class="flex items-center justify-center text-base-content/40">→</div>
                      {renderDefenderRows(friendRows)}
                    </div>
                  </div>
                </Show>
                <Show when={!!firstEnemy}>
                  <div class="rounded border border-base-300 bg-base-200 p-2">
                    <div class="grid gap-2 md:grid-cols-[260px_20px_minmax(0,1fr)] md:items-stretch">
                      {renderAttackerBlock(firstEnemy as TimelineEvent)}
                      <div class="flex items-center justify-center text-base-content/40">→</div>
                      {renderDefenderRows(enemyRows)}
                    </div>
                  </div>
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </Show>
  );
}

function UnifiedAttackRows(props: {
  events: TimelineEvent[];
  title: string;
  fleets: BattleFleets | null;
  mstSlotItemById: Map<number, Record<string, unknown>> | null;
  mstShipById: Map<number, Record<string, unknown>> | null;
}): JSX.Element {
  interface ResolvedEventRow {
    event: TimelineEvent;
    beforeHp: number | null;
    afterHp: number | null;
    atkHp: number;
  }

  const resolvedRows = (): ResolvedEventRow[] => {
    const evs = props.events.filter((ev) => ev.separator !== true);
    if (evs.length === 0) return [];
    const first = evs[0];
    const fState = Array.isArray(first.fHps)
      ? first.fHps.map((v) => Number(v ?? 0) || 0)
      : [];
    const eState = Array.isArray(first.eHps)
      ? first.eHps.map((v) => Number(v ?? 0) || 0)
      : [];

    return evs.map((ev) => {
      const atkPool = ev.attackerSide === "friend" ? fState : eState;
      const defPool = ev.defenderSide === "friend" ? fState : eState;
      const atkHp =
        ev.attackerIdx !== null
          ? Number(atkPool[ev.attackerIdx] ?? 0) || 0
          : 0;
      if (ev.defenderIdx === null) {
        return { event: ev, beforeHp: null, afterHp: null, atkHp };
      }
      const beforeHp = Number(defPool[ev.defenderIdx] ?? 0) || 0;
      const afterHp = Math.max(0, beforeHp - Math.max(0, ev.damage));
      defPool[ev.defenderIdx] = afterHp;
      return { event: ev, beforeHp, afterHp, atkHp };
    });
  };

  const attackerLabel = (ev: TimelineEvent): string => {
    const group = Array.isArray(ev.attackerGroup)
      ? ev.attackerGroup.filter(
          (v) => Number.isFinite(Number(v)) && Number(v) >= 0,
        )
      : [];
    if (group.length > 0) return group.map((idx) => `${idx + 1}番`).join("+");
    if (ev.attackerIdx !== null) return `${ev.attackerIdx + 1}番`;
    if (ev.type === "air") return "航空";
    if (ev.type === "raigeki") return "雷撃";
    return "-";
  };

  const attackerName = (ev: TimelineEvent): string => {
    const group = Array.isArray(ev.attackerGroup)
      ? ev.attackerGroup.filter(
          (v) => Number.isFinite(Number(v)) && Number(v) >= 0,
        )
      : [];
    if (group.length > 1) {
      return group
        .map((idx) => shipNameFromIndex(ev.attackerSide, idx, props.fleets))
        .join(" / ");
    }
    if (group.length === 1) {
      return shipNameFromIndex(ev.attackerSide, Number(group[0]), props.fleets);
    }
    if (ev.attackerIdx !== null) {
      return shipNameFromIndex(ev.attackerSide, ev.attackerIdx, props.fleets);
    }
    if (ev.attackerMstShipId) {
      return (
        mstShipNameFromId(props.mstShipById, ev.attackerMstShipId) ??
        `艦ID:${ev.attackerMstShipId}`
      );
    }
    return "-";
  };

  return (
    <Show
      when={resolvedRows().length > 0}
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
        <For each={resolvedRows()}>
          {(row) => {
            const ev = row.event;
            const mHp = createMemo(() => {
              if (ev.defenderIdx === null || row.beforeHp === null) return 1;
              return maxHpForShip(
                ev.defenderSide,
                ev.defenderIdx,
                row.beforeHp,
                props.fleets,
              );
            });
            const state = createMemo(() => {
              if (row.beforeHp === null || row.afterHp === null) {
                return { sunk: false, afterState: "" };
              }
              return transitionState(row.beforeHp, row.afterHp, mHp());
            });

            return (
              <div class="rounded border border-base-300 bg-base-200 p-2">
                <div class="grid gap-2 md:grid-cols-[260px_20px_minmax(0,1fr)] md:items-stretch">
                  <Show
                    when={ev.attackerIdx !== null}
                    fallback={
                      <div class="rounded bg-base-100 px-2 py-1 border border-base-300">
                        <div class="mb-1 flex items-center gap-1.5">
                          <div
                            class={`text-[10px] font-mono font-bold ${ev.attackerSide === "enemy" ? "text-error" : "text-info"}`}
                          >
                            {attackerLabel(ev)}
                          </div>
                          <div class="text-xs font-semibold text-base-content/70">
                            {attackerName(ev)}
                          </div>
                        </div>
                        <Show when={(ev.slotItems?.length ?? 0) > 0}>
                          <div class="text-[10px] text-base-content/55">
                            <EquipmentBadgesFromSlotIds
                              slotIds={ev.slotItems}
                              mstSlotItemById={props.mstSlotItemById}
                              preserveDuplicates={ev.actorRole === "airbase"}
                            />
                          </div>
                        </Show>
                      </div>
                    }
                  >
                    <div class="space-y-1">
                      <PhaseParticipant
                        name={shipNameFromIndex(
                          ev.attackerSide,
                          ev.attackerIdx as number,
                          props.fleets,
                        )}
                        side={ev.attackerSide}
                        idx={ev.attackerIdx as number}
                        hpCurrent={row.atkHp}
                        hpMax={maxHpForShip(
                          ev.attackerSide,
                          ev.attackerIdx as number,
                          row.atkHp,
                          props.fleets,
                        )}
                      />
                      <Show when={(ev.slotItems?.length ?? 0) > 0}>
                        <div class="text-[10px] text-base-content/55">
                          <EquipmentBadgesFromSlotIds
                            slotIds={ev.slotItems}
                            mstSlotItemById={props.mstSlotItemById}
                            preserveDuplicates={ev.actorRole === "airbase"}
                          />
                        </div>
                      </Show>
                    </div>
                  </Show>
                  <div class="flex items-center justify-center text-base-content/40">→</div>
                  <div class="rounded bg-base-100 px-2 py-1 border border-base-300 h-full">
                    <Show
                      when={ev.defenderIdx !== null && row.beforeHp !== null && row.afterHp !== null}
                      fallback={
                        <div class="h-full min-h-[56px] flex items-center justify-between text-xs">
                          <span class="text-base-content/40">対象なし</span>
                          <span class="font-semibold text-base-content/55">MISS</span>
                        </div>
                      }
                    >
                      <div class="flex flex-wrap items-center gap-2 justify-between">
                        <div class="min-w-0">
                          <div class="mb-1 flex items-center gap-1.5">
                            <ShipIndexBadge idx={ev.defenderIdx as number} side={ev.defenderSide} />
                            <div class="text-xs font-semibold text-base-content/70">
                              {shipNameFromIndex(
                                ev.defenderSide,
                                ev.defenderIdx as number,
                                props.fleets,
                              )}
                            </div>
                          </div>
                          <div class="text-[10px] text-base-content/65">
                            <InlineHpMeter current={row.beforeHp as number} max={mHp()} />
                            <span class="text-base-content/40">{" -> "}</span>
                            <InlineHpMeter current={row.afterHp as number} max={mHp()} />
                          </div>
                        </div>
                        <div class="ml-auto flex min-w-[200px] flex-wrap justify-end gap-1">
                          <OutcomeBadges
                            damage={ev.damage}
                            crit={ev.crit}
                            protect={false}
                            sunk={ev.sunk || state().sunk}
                            afterState={state().afterState}
                          />
                        </div>
                      </div>
                    </Show>
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

function readDestructionValue(
  source: Record<string, unknown>,
  key: string,
): number | null {
  const direct = source[key];
  if (direct != null) {
    const n = Number(direct);
    return Number.isFinite(n) ? n : null;
  }
  const nested = (source["air_base_attack"] as Record<string, unknown> | undefined)?.[key];
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
  battle: Record<string, unknown>;
  phaseType: Record<string, unknown>;
  phaseData: unknown;
  fleets: BattleFleets | null;
  mstSlotItemById: Map<number, Record<string, unknown>> | null;
  mstShipById: Map<number, Record<string, unknown>> | null;
  showLegacyAirbasePhaseWarning?: boolean;
}): JSX.Element {
  const phaseKey = () => Object.keys(props.phaseType)[0] ?? "";
  const phaseName = () => {
    return PHASE_NAMES[phaseKey()] ?? phaseKey();
  };

  const timelineEvents = createMemo(() =>
    buildTimelineEvents(props.battle, props.fleets),
  );

  const raigekiEventsForPhase = createMemo(() =>
    timelineEvents().filter(
      (ev) =>
        ev.type === "raigeki" &&
        ev.phase === phaseName() &&
        ev.separator !== true,
    ),
  );

  const phaseEventsForPhase = createMemo(() =>
    timelineEvents().filter(
      (ev) => ev.phase === phaseName() && ev.separator !== true,
    ),
  );

  const summaryBadges = (): (string | null)[] => {
    const key = phaseKey();
    const phaseEvents = phaseEventsForPhase();
    const damageToFriend = phaseEvents
      .filter((ev) => ev.defenderSide === "friend")
      .reduce((s, ev) => s + (Number(ev.damage ?? 0) || 0), 0);
    const damageToEnemy = phaseEvents
      .filter((ev) => ev.defenderSide === "enemy")
      .reduce((s, ev) => s + (Number(ev.damage ?? 0) || 0), 0);

    if (
      key === "Hougeki" ||
      key === "OpeningTaisen" ||
      key === "MidnightHougeki"
    ) {
      const shellingEvents = phaseEvents.filter((ev) => ev.type === "shelling");
      if (shellingEvents.length > 0) {
        const total = shellingEvents.reduce(
          (s, ev) => s + (Number(ev.damage ?? 0) || 0),
          0,
        );
        return [`${shellingEvents.length}行動`, `総与ダメ ${total}`];
      }
    } else if (key === "OpeningRaigeki" || key === "ClosingRaigeki") {
      return [`味方被ダメ ${damageToFriend}`, `敵被ダメ ${damageToEnemy}`];
    } else if (key === "OpeningAirAttack" || key === "AirBaseAirAttack" || key === "AirBaseAssult" || key === "CarrierBaseAssault") {
      const waves = (key === "AirBaseAirAttack" && Array.isArray(props.phaseData))
        ? (props.phaseData as Record<string, unknown>[])
        : (Array.isArray(props.phaseData) ? [props.phaseData[0]] : [props.phaseData as Record<string, unknown>]);
      let fTotal = 0;
      let eTotal = 0;
      let airLabels = new Set<string>();
      
      for (const wave of waves) {
        if (!wave) continue;
        fTotal += Array.isArray(wave.f_damages) ? Number((wave.f_damages as unknown[]).reduce((s: number, d: unknown) => s + (Number(d ?? 0) || 0), 0)) : 0;
        eTotal += Array.isArray(wave.e_damages) ? Number((wave.e_damages as unknown[]).reduce((s: number, d: unknown) => s + (Number(d ?? 0) || 0), 0)) : 0;
        const airLabel = AIR_STATE[Number(wave.air_superiority ?? -1)]?.label;
        if (typeof airLabel === "string" && airLabel.length > 0) {
          airLabels.add(airLabel);
        }
      }
      
      const badges: string[] = [];
      if (airLabels.size > 0) {
        badges.push([...airLabels].join(", "));
      }
      if (damageToFriend > 0 || damageToEnemy > 0) {
        badges.push(`味方被ダメ ${damageToFriend}`, `敵被ダメ ${damageToEnemy}`);
      } else {
        badges.push("被害なし");
      }
      return badges;
    } else if (key === "SupportAttack") {
      return damageToFriend > 0 || damageToEnemy > 0
        ? [`味方被ダメ ${damageToFriend}`, `敵被ダメ ${damageToEnemy}`]
        : ["被害なし"];
    } else if (key === "NightSupportAttack") {
      return damageToFriend > 0 || damageToEnemy > 0
        ? [`味方被ダメ ${damageToFriend}`, `敵被ダメ ${damageToEnemy}`]
        : ["夜間支援 0"];
    } else if (key === "FriendlyForceAttack") {
      return damageToFriend > 0 || damageToEnemy > 0
        ? [`味方被ダメ ${damageToFriend}`, `敵被ダメ ${damageToEnemy}`]
        : ["被害なし"];
    }
    return [];
  };

  const phaseContent = (): JSX.Element => {
    const key = phaseKey();
    if (key === "OpeningRaigeki" || key === "ClosingRaigeki") {
      return (
        <RaigekiRows
          events={raigekiEventsForPhase()}
          title={phaseName()}
          fleets={props.fleets}
        />
      );
    }

    if (
      key === "OpeningAirAttack" ||
      key === "AirBaseAirAttack" ||
      key === "AirBaseAssult" ||
      key === "CarrierBaseAssault"
    ) {
      return (
        <AirAttackBatchRows
          events={phaseEventsForPhase()}
          fleets={props.fleets}
          mstSlotItemById={props.mstSlotItemById}
          mstShipById={props.mstShipById}
        />
      );
    }

    if (
      key === "Hougeki" ||
      key === "OpeningTaisen" ||
      key === "MidnightHougeki" ||
      key === "SupportAttack" ||
      key === "NightSupportAttack" ||
      key === "FriendlyForceAttack"
    ) {
      return (
        <UnifiedAttackRows
          events={phaseEventsForPhase()}
          title={phaseName()}
          fleets={props.fleets}
          mstSlotItemById={props.mstSlotItemById}
          mstShipById={props.mstShipById}
        />
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
      <div class="collapse-content">
        <Show
          when={
            !!props.showLegacyAirbasePhaseWarning &&
            isAirbaseInvolvedPhaseKey(phaseKey())
          }
        >
          <div class="alert alert-warning mb-3 py-2">
            <span class="text-xs">
              この基地航空隊フェーズは table_version 0.6.0 未満の既知不具合により、
              参照解決結果が正確でない可能性があります。
            </span>
          </div>
        </Show>
        {phaseContent()}
      </div>
    </div>
  );
}

// ── Phase extraction from battle ──────────────────────────────────────────

function extractPhaseEntries(
  battle: Record<string, unknown>,
  opts?: { legacyAirbaseWarning?: boolean },
): Array<{ type: Record<string, unknown>; data: unknown }> {
  const entries: Array<{ type: Record<string, unknown>; data: unknown }> = [];
  const legacyAirbaseWarning = !!opts?.legacyAirbaseWarning;

  const phaseDataForKey = (
    battle: Record<string, unknown>,
    key: string,
    idx: number | null,
  ): unknown => {
    switch (key) {
      case "AirBaseAssult":
        return battle["air_base_assault"];
      case "CarrierBaseAssault":
        return battle["carrier_base_assault"];
      case "AirBaseAirAttack":
        return Array.isArray(battle["air_base_air_attacks"])
          ? battle["air_base_air_attacks"]
          : (battle["air_base_air_attacks"] as any)?.attacks;
      case "OpeningAirAttack":
        return Array.isArray(battle["opening_air_attack"])
          ? (battle["opening_air_attack"] as unknown[])[idx ?? 0]
          : battle["opening_air_attack"];
      case "SupportAttack":
        return {
          support_hourai: battle["support_hourai"],
          support_airatack: battle["support_airattack"],
        };
      case "OpeningTaisen":
        return battle["opening_taisen"];
      case "OpeningRaigeki":
        return battle["opening_raigeki"];
      case "Hougeki":
        return pickHougekiRowsByRound(battle["hougeki"], idx);
      case "ClosingRaigeki":
        return battle["closing_raigeki"];
      case "FriendlyForceAttack":
        return battle["friendly_force_attack"];
      case "NightSupportAttack":
        return normalizeNightSupportAttackData(battle);
      case "MidnightHougeki":
        return battle["midnight_hougeki"];
      default:
        return null;
    }
  };

  if (
    Array.isArray(battle["battle_order"]) &&
    (battle["battle_order"] as unknown[]).length > 0 &&
    typeof (battle["battle_order"] as unknown[])[0] === "object"
  ) {
    const presentKeys = new Set<string>();
    for (const phaseType of battle["battle_order"] as Record<string, unknown>[]) {
      const key = Object.keys(phaseType)[0];
      presentKeys.add(key);
      const idx = phaseType[key] as number | null;
      entries.push({
        type: phaseType,
        data: phaseDataForKey(battle, key, idx),
      });
    }
    if (!presentKeys.has("OpeningRaigeki") && hasRaigekiActivity(battle["opening_raigeki"])) {
      entries.push({
        type: { OpeningRaigeki: 0 },
        data: battle["opening_raigeki"],
      });
    }
    if (!presentKeys.has("ClosingRaigeki") && hasRaigekiActivity(battle["closing_raigeki"])) {
      entries.push({
        type: { ClosingRaigeki: 0 },
        data: battle["closing_raigeki"],
      });
    }
  } else {
    // Fallback for compact/legacy records
    const hasAirBaseAssault =
      !!battle["air_base_assault"] && typeof battle["air_base_assault"] === "object";
    const hasCarrierBaseAssault =
      !!battle["carrier_base_assault"] &&
      typeof battle["carrier_base_assault"] === "object";
    const hasAirBaseAirAttacks =
      !!(battle["air_base_air_attacks"] as any)?.attacks?.length ||
      Array.isArray(battle["air_base_air_attacks"]);

    // Legacy (<0.6.0) data can lose air_base_air_attacks while assault is present.
    // Keep phase list explicit by showing a placeholder phase card for the unresolved segment.
    if (
      legacyAirbaseWarning &&
      (hasAirBaseAssault || hasCarrierBaseAssault) &&
      !hasAirBaseAirAttacks
    ) {
      entries.push({
        type: { AirBaseAirAttack: 0 },
        data: null,
      });
    }

    if (battle["air_base_assault"] && typeof battle["air_base_assault"] === "object")
      entries.push({
        type: { AirBaseAssult: 0 },
        data: battle["air_base_assault"],
      });
    if (battle["carrier_base_assault"] && typeof battle["carrier_base_assault"] === "object")
      entries.push({
        type: { CarrierBaseAssault: 0 },
        data: battle["carrier_base_assault"],
      });
    if (hasAirBaseAirAttacks)
      entries.push({
        type: { AirBaseAirAttack: 0 },
        data: phaseDataForKey(battle, "AirBaseAirAttack", 0),
      });
    if (
      (battle["opening_air_attack"] as any)?.length ||
      Array.isArray(battle["opening_air_attack"])
    )
      entries.push({
        type: { OpeningAirAttack: 0 },
        data: phaseDataForKey(battle, "OpeningAirAttack", 0),
      });
    if (battle["support_hourai"] || battle["support_airattack"])
      entries.push({
        type: { SupportAttack: 0 },
        data: phaseDataForKey(battle, "SupportAttack", null),
      });
    if (battle["opening_taisen"])
      entries.push({ type: { OpeningTaisen: 0 }, data: battle["opening_taisen"] });
    if (battle["opening_raigeki"] && typeof battle["opening_raigeki"] === "object")
      entries.push({
        type: { OpeningRaigeki: 0 },
        data: battle["opening_raigeki"],
      });
    if (battle["hougeki"] && (Array.isArray(battle["hougeki"]) || (battle["hougeki"] as any).length))
      entries.push({
        type: { Hougeki: 0 },
        data: phaseDataForKey(battle, "Hougeki", 0),
      });
    if (battle["closing_raigeki"] && typeof battle["closing_raigeki"] === "object")
      entries.push({
        type: { ClosingRaigeki: 0 },
        data: battle["closing_raigeki"],
      });
    if (battle["friendly_force_attack"])
      entries.push({
        type: { FriendlyForceAttack: 0 },
        data: battle["friendly_force_attack"],
      });
    if (normalizeNightSupportAttackData(battle))
      entries.push({
        type: { NightSupportAttack: 0 },
        data: phaseDataForKey(battle, "NightSupportAttack", null),
      });
    if (battle["midnight_hougeki"])
      entries.push({
        type: { MidnightHougeki: 0 },
        data: battle["midnight_hougeki"],
      });
  }
  return entries;
}

// ── Exported component ────────────────────────────────────────────────────

export default function BattlePhaseView(props: {
  battle: Record<string, unknown>;
  fleets: BattleFleets | null;
  mstSlotItemById: Map<number, Record<string, unknown>> | null;
  mstShipById: Map<number, Record<string, unknown>> | null;
  showLegacyAirbasePhaseWarning?: boolean;
}): JSX.Element {
  const phases = () =>
    extractPhaseEntries(props.battle, {
      legacyAirbaseWarning: props.showLegacyAirbasePhaseWarning,
    });
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
              battle={props.battle}
              phaseType={entry.type}
              phaseData={entry.data}
              fleets={props.fleets}
              mstSlotItemById={props.mstSlotItemById}
              mstShipById={props.mstShipById}
              showLegacyAirbasePhaseWarning={
                props.showLegacyAirbasePhaseWarning
              }
            />
          )}
        </For>
      </div>
    </Show>
  );
}
