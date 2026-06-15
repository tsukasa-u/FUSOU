/** @jsxImportSource solid-js */

import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
} from "solid-js";
import { cachedFetch } from "@/utils/fetchCache";
import { cardUrl } from "@/features/simulator/equip-calc";
import {
  getMasterSlotItem,
  getMasterSlotItems,
  getSlotItemEffects,
} from "@/features/simulator/simulator-selectors";
import {
  ENEMY_ID_THRESHOLD,
  SPEED_NAMES,
  STYPE_NAMES,
} from "@/features/simulator/constants";
import type {
  MstShipData,
  MstSlotItemData,
  TripleRule,
  QuadRule,
  PentaRule,
} from "@/features/simulator/types";
import {
  type NormalizedShipGrowthCaps,
  type ShipGrowthSummary,
  type ShipGrowthBoundsResponse,
  normalizeShipGrowthCaps,
  deriveShipGrowthCapsFromBounds,
  mergeShipGrowthCaps,
  needsStatFallback,
} from "@/features/simulator/ship-growth-utils";
import {
  statRangeLabel,
  statRangeLabelWithFallback,
  rangeDisplay,
  speedDisplay,
  equipDisplayTypeName,
  groupBy,
} from "@/features/simulator/display-utils";
import {
  normalizeEffects,
  normalizeCrossEffects,
  getSingleEntriesForEquip,
  getCrossEntriesForEquip,
  scoreSynergy,
  synergySignature,
  stackingSynergyRows,
  groupByMultiStat,
  groupByGenericStat,
  groupByEquipType,
  getCompatibilityMeta,
  decodeCombosForDisplay,
  comboBaseBonus,
  type MultiEntry,
  type MultiGroup,
  type MobilitySynergyRow,
} from "@/features/simulator/synergy-utils";
import {
  LazyRender,
  ProgressiveGrid,
  WeaponIcon,
  ImageFallbackBox,
  SpecTable,
  SynergyStatInline,
  CompatibilityBadges,
  EquipSlotGroup,
  MultiEntryDisplay,
} from "./shared-ui";

function ShipDetailPanel(props: {
  ship: MstShipData;
  onOpenEquip: (equipId: number) => void;
  expandEquippableEquip: boolean;
  expandSingleSynergy: boolean;
  expandPairSynergy: boolean;
  showMultiSynergy: boolean;
}): JSX.Element {
  const [shipGrowthCap, setShipGrowthCap] =
    createSignal<NormalizedShipGrowthCaps | null>(null);
  const [shipGrowthCapUpdatedAtIso, setShipGrowthCapUpdatedAtIso] =
    createSignal<string | null>(null);

  createEffect(() => {
    const shipId = props.ship.id;
    setShipGrowthCap(null);
    setShipGrowthCapUpdatedAtIso(null);

    let alive = true;
    (async () => {
      try {
        const summaryRes = await cachedFetch("/api/ship-growth/summary");
        if (!summaryRes.ok) return;

        const summaryJson = (await summaryRes.json()) as ShipGrowthSummary;
        const latest = summaryJson.periods?.[0];
        if (!latest) return;

        const boundsRes = await cachedFetch(
          `/api/ship-growth/bounds?period_tag=${encodeURIComponent(latest.period_tag)}&table_version=${encodeURIComponent(latest.table_version)}`,
        );
        if (!boundsRes.ok) return;

        const boundsJson = (await boundsRes.json()) as ShipGrowthBoundsResponse;
        const capFromCaps = normalizeShipGrowthCaps(
          (boundsJson.caps ?? []).find((row) => row.master_id === shipId) ??
            null,
        );
        const capFromBounds = deriveShipGrowthCapsFromBounds(
          shipId,
          boundsJson.bounds ?? [],
        );
        const cap = mergeShipGrowthCaps(capFromCaps, capFromBounds);

        if (alive) {
          setShipGrowthCap(cap);
          setShipGrowthCapUpdatedAtIso(
            typeof boundsJson.updated_at_iso === "string"
              ? boundsJson.updated_at_iso
              : null,
          );
        }
      } catch {
        // Non-critical: keep master-data original display when ship-growth lookup fails.
      }
    })();

    return () => {
      alive = false;
    };
  });

  const usesShipGrowthFallback = createMemo(() => {
    const cap = shipGrowthCap();
    if (!cap) return false;
    return (
      (needsStatFallback(props.ship.tais) && cap.taisen_max > 0) ||
      (needsStatFallback(props.ship.kaih) && cap.kaihi_max > 0) ||
      (needsStatFallback(props.ship.saku) && cap.sakuteki_max > 0)
    );
  });

  const shipSynergy = createMemo(() => {
    const effects = getSlotItemEffects();
    if (!effects)
      return {
        single: [],
        pair: [],
        speedSynergies: [],
        rangeSynergies: [],
        triple: [] as MultiGroup[],
        quad: [] as MultiGroup[],
        penta: [] as MultiGroup[],
      };

    const appliesToShip = (ships: number[] | null | undefined): boolean => {
      if (!Array.isArray(ships) || ships.length === 0) return true;
      return ships.includes(props.ship.id);
    };

    const single: Array<{
      equip: MstSlotItemData;
      base: Record<string, number>;
      star10: Record<string, number> | null;
      c2: Record<string, number> | null;
      c3: Record<string, number> | null;
    }> = [];
    const singleDedupe = new Set<string>();
    const _em = normalizeEffects(effects);
    const _cm = normalizeCrossEffects(effects);

    for (const rule of effects.effect_rules || []) {
      if (!appliesToShip(rule.ships)) continue;
      if (
        scoreSynergy(rule.b) === 0 &&
        scoreSynergy(rule.l) === 0 &&
        scoreSynergy(rule.c2) === 0 &&
        scoreSynergy(rule.c3) === 0
      )
        continue;

      for (const itemId of rule.items) {
        const key = String(itemId);
        if (singleDedupe.has(key)) continue;
        const equip = getMasterSlotItem(itemId);
        if (!equip || equip.id >= ENEMY_ID_THRESHOLD) continue;
        singleDedupe.add(key);
        single.push({
          equip,
          base: rule.b,
          star10: rule.l ?? null,
          c2: rule.c2 ?? null,
          c3: rule.c3 ?? null,
        });
      }
    }

    const pair: Array<{
      a: MstSlotItemData;
      b: MstSlotItemData;
      stats: Record<string, number>;
    }> = [];
    const pairDedupe = new Set<string>();

    for (const rule of effects.cross_rules || []) {
      if (!appliesToShip(rule.ships)) continue;
      if (scoreSynergy(rule.synergy) === 0) continue;

      for (const p of rule.pairs) {
        let a = getMasterSlotItem(p[0]);
        let b = getMasterSlotItem(p[1]);
        if (!a || !b || a.id >= ENEMY_ID_THRESHOLD || b.id >= ENEMY_ID_THRESHOLD) continue;

        if (a.sortno > b.sortno || (a.sortno === b.sortno && a.id > b.id)) {
          const tmp = a;
          a = b;
          b = tmp;
        }

        const dedupeKey = `${a.id}:${b.id}:${JSON.stringify(rule.synergy)}`;
        if (pairDedupe.has(dedupeKey)) continue;
        pairDedupe.add(dedupeKey);

        pair.push({ a, b, stats: rule.synergy });
      }
    }

    single.sort((x, y) => scoreSynergy(y.base) - scoreSynergy(x.base));
    pair.sort((x, y) => scoreSynergy(y.stats) - scoreSynergy(x.stats));

    const speedSynergies: MobilitySynergyRow[] = [];
    const rangeSynergies: MobilitySynergyRow[] = [];

    const pickStat = (
      stats: Record<string, number> | null | undefined,
      key: "soku" | "leng",
    ): number => {
      const raw = stats?.[key];
      return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
    };

    const maxStatBonus = (
      key: "soku" | "leng",
      ...sources: Array<Record<string, number> | null | undefined>
    ): number => {
      let best = 0;
      for (const src of sources) {
        const v = pickStat(src, key);
        if (v > best) best = v;
      }
      return best;
    };

    const pushUnique = (
      target: MobilitySynergyRow[],
      seen: Set<string>,
      payload: Omit<MobilitySynergyRow, "key">,
    ) => {
      if (payload.before === payload.after) return;
      const dedupeKey = [
        payload.sourceType,
        payload.equip.id,
        payload.partner?.id ?? 0,
        payload.before,
        payload.after,
      ].join(":");
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      target.push({ ...payload, key: dedupeKey });
    };

    const speedSeen = new Set<string>();
    const rangeSeen = new Set<string>();

    const hasSameSingleRangeEffect = (
      equipId: number,
      before: number,
      after: number,
    ): boolean =>
      rangeSynergies.some(
        (row) =>
          row.sourceType === "single" &&
          row.equip.id === equipId &&
          row.before === before &&
          row.after === after,
      );

    // Single equipment: aggregate the best possible (★10 / 2積み / 3積み を含む)
    // soku/leng change into a single row per equipment. Range additionally takes
    // the equipment's own `leng` into account because effective range becomes
    // max(ship.leng, equip.leng) once equipped.
    for (const row of single) {
      const sokuBonus = maxStatBonus(
        "soku",
        row.base,
        row.star10,
        row.c2,
        row.c3,
      );
      if (sokuBonus !== 0) {
        pushUnique(speedSynergies, speedSeen, {
          equip: row.equip,
          partner: null,
          sourceType: "single",
          before: props.ship.soku,
          after: props.ship.soku + sokuBonus,
        });
      }

      const lengBonus = maxStatBonus(
        "leng",
        row.base,
        row.star10,
        row.c2,
        row.c3,
      );
      const equipBaseLeng = Number(row.equip.leng ?? 0);
      const effectiveBase = Math.max(props.ship.leng, equipBaseLeng);
      const after = effectiveBase + lengBonus;
      if (after !== props.ship.leng) {
        pushUnique(rangeSynergies, rangeSeen, {
          equip: row.equip,
          partner: null,
          sourceType: "single",
          before: props.ship.leng,
          after,
        });
      }
    }

    // Pair (cross_effects): aggregate to one row per (a,b) showing pair-only
    // contribution to soku/leng. Equipment-side base bonuses are already shown
    // by the single rows above; here we surface only the cross synergy delta.
    for (const row of pair) {
      const sokuBonus = pickStat(row.stats, "soku");
      if (sokuBonus !== 0) {
        pushUnique(speedSynergies, speedSeen, {
          equip: row.a,
          partner: row.b,
          sourceType: "pair",
          before: props.ship.soku,
          after: props.ship.soku + sokuBonus,
        });
      }
      const lengBonus = pickStat(row.stats, "leng");
      if (lengBonus !== 0) {
        const before = props.ship.leng;
        const effectiveBase = Math.max(
          props.ship.leng,
          Number(row.a.leng ?? 0),
          Number(row.b.leng ?? 0),
        );
        const after = effectiveBase + lengBonus;
        if (hasSameSingleRangeEffect(row.a.id, before, after)) {
          continue;
        }
        pushUnique(rangeSynergies, rangeSeen, {
          equip: row.a,
          partner: row.b,
          sourceType: "pair",
          before,
          after,
        });
      }
    }

    // Leng-stacking pairs: detect pairs of distinct equips that each have an
    // individual leng bonus for this ship, where combining both yields higher
    // effective range than either alone. Cross-effect leng synergy (if any) is
    // included in the combined calculation.
    const singleWithLeng = single.filter(
      (row) => maxStatBonus("leng", row.base, row.star10, row.c2, row.c3) > 0,
    );
    for (let ai = 0; ai < singleWithLeng.length; ai++) {
      for (let bi = ai + 1; bi < singleWithLeng.length; bi++) {
        const rowA = singleWithLeng[ai];
        const rowB = singleWithLeng[bi];
        const maxLengA = maxStatBonus(
          "leng",
          rowA.base,
          rowA.star10,
          rowA.c2,
          rowA.c3,
        );
        const maxLengB = maxStatBonus(
          "leng",
          rowB.base,
          rowB.star10,
          rowB.c2,
          rowB.c3,
        );
        const pairKey = `${Math.min(rowA.equip.id, rowB.equip.id)}:${Math.max(rowA.equip.id, rowB.equip.id)}`;
        const crossEntry = normalizeCrossEffects(effects)[pairKey]?.find((e) =>
          appliesToShip(e.ships),
        );
        const crossLeng = pickStat(crossEntry?.synergy, "leng");
        const combinedLengBonus = maxLengA + maxLengB + crossLeng;
        const effectiveBase = Math.max(
          props.ship.leng,
          Number(rowA.equip.leng ?? 0),
          Number(rowB.equip.leng ?? 0),
        );
        const combinedAfter = effectiveBase + combinedLengBonus;
        const singleAfterA =
          Math.max(props.ship.leng, Number(rowA.equip.leng ?? 0)) + maxLengA;
        const singleAfterB =
          Math.max(props.ship.leng, Number(rowB.equip.leng ?? 0)) + maxLengB;
        if (combinedAfter <= Math.max(singleAfterA, singleAfterB)) continue;
        pushUnique(rangeSynergies, rangeSeen, {
          equip: rowA.equip,
          partner: rowB.equip,
          sourceType: "pair",
          before: props.ship.leng,
          after: combinedAfter,
        });
      }
    }

    const equippableRangePartners = Object.values(getMasterSlotItems())
      .filter((equip) => {
        if (equip.id >= ENEMY_ID_THRESHOLD) return false;
        if (Number(equip.leng ?? 0) <= 0) return false;
        const compat = getCompatibilityMeta(props.ship, equip);
        return compat.normalSlots.length > 0 || compat.exslot != null;
      })
      .sort(
        (a, b) =>
          Number(b.leng ?? 0) - Number(a.leng ?? 0) || a.sortno - b.sortno,
      );

    // Add standalone range changes from equipment's own leng attribute.
    // This covers equipment that changes effective range even without a synergy
    // bonus entry (e.g. a 超長 gun that raises ship's range from 長 to 超長).
    // Skip equips that already have a synergy-based range row to avoid
    // duplicates where the synergy entry already accounts for equip.leng via
    // effectiveBase (e.g. showing both 短→長 and 短→中 for the same radar).
    const equipsWithSynergyRange = new Set(
      rangeSynergies
        .filter((r) => r.sourceType === "single")
        .map((r) => r.equip.id),
    );
    for (const equip of equippableRangePartners) {
      const equipLeng = Number(equip.leng ?? 0);
      if (
        equipLeng > props.ship.leng &&
        !equipsWithSynergyRange.has(equip.id)
      ) {
        pushUnique(rangeSynergies, rangeSeen, {
          equip,
          partner: null,
          sourceType: "single",
          before: props.ship.leng,
          after: equipLeng,
        });
      }
    }

    // Removed combo range synergy loop per user request. Range synergies should only show the single equipment's standalone contribution.

    speedSynergies.sort(
      (x, y) => Math.abs(y.after - y.before) - Math.abs(x.after - x.before),
    );
    rangeSynergies.sort(
      (x, y) => Math.abs(y.after - y.before) - Math.abs(x.after - x.before),
    );

    // ── Multi-item (triple / quad / penta) synergies ────────────────
    // For each applicable rule:
    //   item_pool rules → pool display (any K of N items; shows rule.synergy as correction)
    //   combos_b64 / explicit → decode each combo, show net = single+pair+synergy (no limit)
    // Grouped by primary stat key for subcategory display.

    const buildMultiEntries = (
      rules: Array<TripleRule | QuadRule | PentaRule> | undefined,
      comboSize: number,
    ): MultiEntry[] => {
      if (!rules) return [];
      const all: MultiEntry[] = [];
      const _em = normalizeEffects(effects);
      const _cm = normalizeCrossEffects(effects);
      for (const rule of rules) {
        if (!appliesToShip(rule.ships)) continue;
        if (rule.category_pools) {
          const pools = rule.category_pools.map((p) =>
            p
              .map((id) => getMasterSlotItem(id))
              .filter(
                (it): it is MstSlotItemData =>
                  it != null && it.id < ENEMY_ID_THRESHOLD,
              ),
          );
          if (pools.some((p) => p.length === 0)) continue;
          if (scoreSynergy(rule.synergy) === 0) continue;
          all.push({
            kind: "category",
            pools,
            cancels_single: !!rule.cancels_single,
            correction: rule.synergy,
          });
        } else if (rule.item_pool) {
          // Pool rule: "any comboSize of these pool items" → show pool + correction
          const pool = rule.item_pool
            .map((id) => getMasterSlotItem(id))
            .filter(
              (it): it is MstSlotItemData =>
                it != null && it.id < ENEMY_ID_THRESHOLD,
            );
          if (pool.length < comboSize) continue;
          if (scoreSynergy(rule.synergy) === 0) continue;
          all.push({ kind: "pool", pool, comboSize, correction: rule.synergy });
        } else if (rule.fixed_items && rule.free_pool) {
          // Fixed+free rule: fixed items always present, any (comboSize-k) of free_pool
          const allPoolIds = [...rule.fixed_items, ...rule.free_pool];
          const pool = allPoolIds
            .map((id) => getMasterSlotItem(id))
            .filter(
              (it): it is MstSlotItemData =>
                it != null && it.id < ENEMY_ID_THRESHOLD,
            );
          if (pool.length < comboSize) continue;
          if (scoreSynergy(rule.synergy) === 0) continue;
          all.push({ kind: "pool", pool, comboSize, correction: rule.synergy });
        } else if (rule.implicants) {
          for (const implicant of rule.implicants) {
            const pools = implicant.map((p) =>
              p
                .map((id) => getMasterSlotItem(id))
                .filter(
                  (it): it is MstSlotItemData =>
                    it != null && it.id < ENEMY_ID_THRESHOLD,
                ),
            );
            if (pools.some((p) => p.length === 0)) continue;
            if (scoreSynergy(rule.synergy) === 0) continue;
            all.push({
              kind: "category",
              pools,
              cancels_single: !!rule.cancels_single,
              correction: rule.synergy,
            });
          }
        } else {
          // Explicit combos: decode up to 500 to prevent main-thread locking
          const combos = decodeCombosForDisplay(rule, comboSize);

          for (const comboIds of combos) {
            const items = comboIds.map((id) => getMasterSlotItem(id));
            if (items.some((it) => !it || it.id >= ENEMY_ID_THRESHOLD))
              continue;
            const base = comboBaseBonus(props.ship.id, comboIds, _em, _cm);
            for (const [k, v] of Object.entries(rule.synergy)) {
              if (v) base[k] = (base[k] || 0) + v;
            }
            if (scoreSynergy(base) > 0) {
              all.push({
                kind: "combo",
                combo: items as MstSlotItemData[],
                netStats: base,
              });
            }
          }
        }
      }
      return all;
    };

    const triple = groupByMultiStat(buildMultiEntries(effects.triple_rules, 3));
    const quad = groupByMultiStat(buildMultiEntries(effects.quad_rules, 4));
    const penta = groupByMultiStat(buildMultiEntries(effects.penta_rules, 5));

    const initialGroupMap = new Map<
      string,
      {
        a: MstSlotItemData;
        bGroup: MstSlotItemData[];
        stats: Record<string, number>;
      }
    >();
    for (const row of pair) {
      const statHash = synergySignature(row.stats);
      const key = `${row.a.id}::${statHash}`;
      let group = initialGroupMap.get(key);
      if (!group) {
        group = { a: row.a, bGroup: [], stats: row.stats };
        initialGroupMap.set(key, group);
      }
      group.bGroup.push(row.b);
    }

    const initialGroups = Array.from(initialGroupMap.values());
    for (const row of initialGroups) {
      row.bGroup.sort((a, b) => a.sortno - b.sortno || a.id - b.id);
    }

    // Pass 2: Group left-hand side (A items) if their B groups and stats match perfectly
    const finalGroupMap = new Map<
      string,
      {
        aGroup: MstSlotItemData[];
        bGroup: MstSlotItemData[];
        stats: Record<string, number>;
      }
    >();
    for (const row of initialGroups) {
      const bHash = row.bGroup.map((b) => b.id).join(",");
      const statHash = synergySignature(row.stats);
      const key = `${bHash}::${statHash}`;
      let group = finalGroupMap.get(key);
      if (!group) {
        group = { aGroup: [], bGroup: row.bGroup, stats: row.stats };
        finalGroupMap.set(key, group);
      }
      group.aGroup.push(row.a);
    }

    const pairGroups = Array.from(finalGroupMap.values());
    for (const row of pairGroups) {
      row.aGroup.sort((a, b) => a.sortno - b.sortno || a.id - b.id);
    }
    pairGroups.sort((a, b) => {
      const aIcon = a.aGroup[0].type?.[3] ?? 0;
      const bIcon = b.aGroup[0].type?.[3] ?? 0;
      if (aIcon !== bIcon) return aIcon - bIcon;
      return (
        a.aGroup[0].sortno - b.aGroup[0].sortno ||
        a.aGroup[0].id - b.aGroup[0].id
      );
    });

    const groupedSingle = groupByGenericStat(
      single,
      (row) => row.base,
      (row) => scoreSynergy(row.base),
    );
    const groupedPair = groupByGenericStat(
      pairGroups,
      (row) => row.stats,
      (row) => scoreSynergy(row.stats),
    );
    const groupedSpeed = groupByEquipType(
      speedSynergies,
      (row) => row.equip,
      (row) => row.after - row.before,
    );
    const groupedRange = groupByEquipType(
      rangeSynergies,
      (row) => row.equip,
      (row) => row.after - row.before,
    );

    return {
      single: groupedSingle,
      pair: groupedPair,
      speedSynergies: groupedSpeed,
      rangeSynergies: groupedRange,
      triple,
      quad,
      penta,
    };
  });

  let shipSynergyContainerRef!: HTMLElement;
  const [shipMinHeight, setShipMinHeight] = createSignal<number | null>(null);

  const [isSynergiesReady, setIsSynergiesReady] = createSignal(false);
  const deferredSynergies = createMemo(() => {
    if (!isSynergiesReady()) return null;
    return shipSynergy();
  });

  createEffect(() => {
    props.ship; // Track ship changes
    if (shipSynergyContainerRef) {
      setShipMinHeight(shipSynergyContainerRef.offsetHeight);
    }
    setIsSynergiesReady(false);
    setTimeout(() => {
      setIsSynergiesReady(true);
      setTimeout(() => setShipMinHeight(null), 50);
    }, 50); // Yield to let DOM paint the ship details first
  });

  const equippableGroups = createMemo(() => {
    const allies = Object.values(getMasterSlotItems())
      .filter((equip) => equip.id < ENEMY_ID_THRESHOLD)
      .sort((a, b) => a.sortno - b.sortno)
      .map((equip) => ({
        equip,
        compat: getCompatibilityMeta(props.ship, equip),
      }))
      .filter(
        (row) => row.compat.normalSlots.length > 0 || row.compat.exslot != null,
      );
    return groupBy(allies, (row) => equipDisplayTypeName(row.equip));
  });

  const specRows = createMemo<Array<[label: string, value: string | number]>>(
    () => [
      ["ID", props.ship.id],
      ["艦種", STYPE_NAMES[props.ship.stype] ?? `艦種${props.ship.stype}`],
      ["速力", SPEED_NAMES[props.ship.soku] ?? props.ship.soku],
      ["射程", rangeDisplay(props.ship.leng)],
      ["搭載スロット数", props.ship.slot_num],
      ["耐久", statRangeLabel(props.ship.taik)],
      ["装甲", statRangeLabel(props.ship.souk)],
      ["火力", statRangeLabel(props.ship.houg)],
      ["雷装", statRangeLabel(props.ship.raig)],
      ["対空", statRangeLabel(props.ship.tyku)],
      [
        "対潜",
        statRangeLabelWithFallback(
          props.ship.tais,
          shipGrowthCap()?.taisen_max,
        ),
      ],
      [
        "回避",
        statRangeLabelWithFallback(props.ship.kaih, shipGrowthCap()?.kaihi_max),
      ],
      [
        "索敵",
        statRangeLabelWithFallback(
          props.ship.saku,
          shipGrowthCap()?.sakuteki_max,
        ),
      ],
      ["運", statRangeLabel(props.ship.luck)],
      [
        "搭載内訳",
        props.ship.maxeq
          ? props.ship.maxeq.slice(0, props.ship.slot_num).join(" / ")
          : "-",
      ],
    ],
  );

  return (
    <article class="rounded-xl border border-base-300/70 bg-base-100 shadow-sm overflow-hidden">
      <div class="px-4 py-3 border-b border-base-200 bg-linear-to-r from-primary/10 to-transparent">
        <h2 class="font-semibold">艦詳細</h2>
      </div>

      <div class="p-4 space-y-4">
        <div class="grid grid-cols-1 xl:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)] gap-4 items-stretch">
          <div class="rounded-xl border border-base-300/70 bg-linear-to-b from-base-200 to-base-100 p-3 min-h-80 h-full flex flex-col items-center justify-center overflow-hidden xl:max-w-sm">
            <ImageFallbackBox
              src={cardUrl(props.ship.id)}
              alt={props.ship.name}
              class="w-full h-72 rounded-md"
              objectClass="w-full h-full object-contain object-center"
              fallbackText="No Image"
              loading={undefined}
              fetchpriority="high"
            />
          </div>
          <div class="min-w-0 h-full flex flex-col gap-2">
            <h3 class="text-2xl font-bold leading-tight">{props.ship.name}</h3>
            <p class="text-xs text-base-content/60">
              対潜/回避/索敵の欠損値は ship-growth
              データの上限値で補完表示しています。
            </p>
            <div>
              <SpecTable rows={specRows()} />
            </div>
          </div>
        </div>

        <section class="mb-8">
          <h4 class="text-md font-medium mb-2">装備可能な装備</h4>
          <div class="rounded-lg border border-base-300/70 p-2">
            <div class={`space-y-3 pr-1 ${props.expandEquippableEquip ? "" : "max-h-[40vh] overflow-y-auto"}`}>
              <For each={equippableGroups()}>
                {(group) => (
                  <LazyRender>
                  <div>
                    <h6 class="text-xs font-semibold text-base-content/60 mb-1.5 px-1">
                      {group.key}
                    </h6>
                    <ProgressiveGrid data={group.items} class="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-2">
                        {(row) => (
                          <button
                            class="w-full flex items-center gap-2 text-left rounded-lg border border-base-300/70 hover:border-primary/45 p-2 bg-base-100/50 transition"
                            onClick={() => props.onOpenEquip(row.equip.id)}
                            title={row.equip.name}
                          >
                            <span class="w-10 h-6 inline-flex items-center justify-center rounded bg-base-200/70 shrink-0">
                              <WeaponIcon iconNum={row.equip.type?.[3] ?? 0} />
                            </span>
                            <div class="min-w-0 flex-1">
                              <div class="text-sm font-medium truncate">
                                {row.equip.name}
                              </div>
                            </div>
                            <CompatibilityBadges
                              normalSlots={row.compat.normalSlots}
                              slotCount={props.ship.slot_num}
                              exslot={row.compat.exslot}
                            />
                          </button>
                        )}
                      </ProgressiveGrid>
</div>
</LazyRender>
)}
</For>
            </div>
          </div>
        </section>

        <section class="mb-8" ref={shipSynergyContainerRef} style={{ "min-height": shipMinHeight() != null ? `${shipMinHeight()}px` : undefined }}>
          <Show
            when={deferredSynergies()}
            fallback={
            <div class="py-12 flex flex-col items-center justify-center text-base-content/50">
              <span class="loading loading-spinner loading-md mb-2"></span>
              <p>シナジーデータを計算・描画しています...</p>
            </div>
          }
          >
            {(shipSynergy) => (
              <div class="space-y-8">
                <section>
                <h4 class="text-md font-medium mb-2">単体装備シナジー</h4>
                <Show
                  when={shipSynergy().single.length > 0}
                  fallback={
                    <div class="rounded-lg border border-dashed border-base-300 px-3 py-4 text-sm text-base-content/50">
                      この艦に設定された単体装備シナジーはありません
                    </div>
                  }
                >
                  <div class="rounded-lg border border-base-300/70 p-2">
                    <div class={`space-y-3 pr-1 ${props.expandSingleSynergy ? "" : "max-h-[36vh] overflow-y-auto"}`}>
                      <For each={shipSynergy().single}>
                        {(group) => (
<LazyRender>
<div>
                            <h6 class="text-xs font-semibold text-base-content/60 mb-1.5 px-1">
                              {group.label}系{" "}
                              <span class="font-normal text-base-content/60">
                                （{group.entries.length}件）
                              </span>
                            </h6>
                            <ProgressiveGrid
                              data={group.entries}
                              class="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-2"
                            >
                              {(row) => (
                                <div class="rounded border border-base-300/70 p-2 space-y-1">
                                  <button
                                    class="flex items-center gap-2 min-w-0 w-full text-left hover:underline"
                                    onClick={() =>
                                      props.onOpenEquip(row.equip.id)
                                    }
                                    title={row.equip.name}
                                  >
                                    <span class="w-5 h-5 inline-flex items-center justify-center rounded bg-base-200/70 shrink-0">
                                      <WeaponIcon
                                        iconNum={row.equip.type?.[3] ?? 0}
                                      />
                                    </span>
                                    <span class="text-sm font-medium truncate">
                                      {row.equip.name}
                                    </span>
                                  </button>
                                  <div class="text-xs text-base-content/70 inline-flex items-center h-5">
                                    基本
                                  </div>
                                  <SynergyStatInline stats={row.base} />
                                  <Show
                                    when={
                                      row.star10 != null &&
                                      scoreSynergy(row.star10 ?? undefined) > 0
                                    }
                                  >
                                    <div class="text-xs text-base-content/70 mt-1 inline-flex items-center h-5">
                                      改修★10
                                    </div>
                                    <SynergyStatInline stats={row.star10!} />
                                  </Show>
                                  <For
                                    each={stackingSynergyRows(row.c2, row.c3)}
                                  >
                                    {(stackRow) => (
                                      <>
                                        <div class="text-xs text-base-content/70 mt-1 inline-flex items-center h-5">
                                          {stackRow.label}
                                        </div>
                                        <SynergyStatInline
                                          stats={stackRow.stats}
                                        />
                                      </>
                                    )}
                                  </For>
                                </div>
                              )}
                            </ProgressiveGrid>
</div>
</LazyRender>
)}
</For>
                    </div>
                  </div>
                </Show>
                </section>

                <section>
                <h4 class="text-md font-medium mb-2">装備組み合わせシナジー</h4>
                <Show
                  when={shipSynergy().pair.length > 0}
                  fallback={
                    <div class="rounded-lg border border-dashed border-base-300 px-3 py-4 text-sm text-base-content/50">
                      この艦に設定された装備組み合わせシナジーはありません
                    </div>
                  }
                >
                  <div class="rounded-lg border border-base-300/70 p-2">
                    <div class={`space-y-3 pr-1 ${props.expandPairSynergy ? "" : "max-h-[30vh] overflow-y-auto"}`}>
                      <For each={shipSynergy().pair}>
                        {(group) => (
<LazyRender>
<div>
                            <h6 class="text-xs font-semibold text-base-content/60 mb-1.5 px-1">
                              {group.label}系{" "}
                              <span class="font-normal text-base-content/60">
                                （{group.entries.length}件）
                              </span>
                            </h6>
                            <ProgressiveGrid
                              data={group.entries}
                              class="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-2"
                            >
                              {(row) => (
                                <div class="rounded border border-base-300/70 p-2 space-y-1">
                                  <div class="flex flex-wrap items-center gap-1.5 text-xs text-base-content/70">
                                    <EquipSlotGroup
                                      slotItems={row.aGroup}
                                      currentEquipId={undefined}
                                      onOpenEquip={props.onOpenEquip}
                                    />
                                    <span>+</span>
                                    <EquipSlotGroup
                                      slotItems={row.bGroup}
                                      currentEquipId={undefined}
                                      onOpenEquip={props.onOpenEquip}
                                    />
                                  </div>
                                  <SynergyStatInline stats={row.stats} />
                                </div>
                              )}
                            </ProgressiveGrid>
</div>
</LazyRender>
)}
</For>
                    </div>
                  </div>
                </Show>
                </section>

                <section>
                <h4 class="text-md font-medium mb-2">速力シナジー</h4>
                <Show
                  when={shipSynergy().speedSynergies.length > 0}
                  fallback={
                    <div class="rounded-lg border border-dashed border-base-300 px-3 py-4 text-sm text-base-content/50">
                      この艦に設定された速力シナジーはありません
                    </div>
                  }
                >
                  <div class="rounded-lg border border-base-300/70 p-2">
                    <div class={`space-y-3 pr-1 ${props.expandSingleSynergy ? "" : "max-h-[24vh] overflow-y-auto"}`}>
                      <For each={shipSynergy().speedSynergies}>
                        {(group) => (
<LazyRender>
<div>
                            <h6 class="text-xs font-semibold text-base-content/60 mb-1.5 px-1">
                              {group.label}{" "}
                              <span class="font-normal text-base-content/60">
                                （{group.entries.length}件）
                              </span>
                            </h6>
                            <ProgressiveGrid
                              data={group.entries}
                              class="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-2"
                            >
                              {(row) => (
                                <div class="rounded border border-base-300/70 p-2 space-y-1">
                                  <div class="flex flex-wrap items-center gap-1.5 text-xs text-base-content/70">
                                    <button
                                      class="inline-flex items-center gap-1 min-w-0 hover:underline"
                                      onClick={() =>
                                        props.onOpenEquip(row.equip.id)
                                      }
                                      title={row.equip.name}
                                    >
                                      <span class="inline-flex w-5 h-5 items-center justify-center rounded bg-base-200/70 shrink-0">
                                        <WeaponIcon
                                          iconNum={row.equip.type?.[3] ?? 0}
                                        />
                                      </span>
                                      <span class="truncate max-w-40">
                                        {row.equip.name}
                                      </span>
                                    </button>
                                    <Show when={row.partner}>
                                      <>
                                        <span>+</span>
                                        <button
                                          class="inline-flex items-center gap-1 min-w-0 hover:underline"
                                          onClick={() =>
                                            props.onOpenEquip(row.partner!.id)
                                          }
                                          title={row.partner?.name}
                                        >
                                          <span class="inline-flex w-5 h-5 items-center justify-center rounded bg-base-200/70 shrink-0">
                                            <WeaponIcon
                                              iconNum={
                                                row.partner?.type?.[3] ?? 0
                                              }
                                            />
                                          </span>
                                          <span class="truncate max-w-40">
                                            {row.partner?.name}
                                          </span>
                                        </button>
                                      </>
                                    </Show>
                                  </div>
                                  <div class="flex flex-wrap items-center gap-1">
                                    <span
                                      class={`badge badge-outline badge-sm font-mono inline-flex items-center leading-none ${
                                        row.after - row.before > 0
                                          ? "border-info/55 text-info"
                                          : "border-error/45 text-error"
                                      }`}
                                    >
                                      速力 {speedDisplay(row.before)} →{" "}
                                      {speedDisplay(row.after)}
                                    </span>
                                  </div>
                                </div>
                              )}
                            </ProgressiveGrid>
</div>
</LazyRender>
)}
</For>
                    </div>
                  </div>
                </Show>
                </section>

                <section>
                <h4 class="text-md font-medium mb-2">射程シナジー</h4>
                <Show 
                  when={shipSynergy().rangeSynergies.length > 0}
                  fallback={
                    <div class="rounded-lg border border-dashed border-base-300 px-3 py-4 text-sm text-base-content/50">
                      この艦に設定された射程シナジーはありません
                    </div>
                  }
                >
                  <div class="rounded-lg border border-base-300/70 p-2">
                    <div class={`space-y-3 pr-1 ${props.expandSingleSynergy ? "" : "max-h-[24vh] overflow-y-auto"}`}>
                      <For each={shipSynergy().rangeSynergies}>
                        {(group) => (
<LazyRender>
<div>
                            <h6 class="text-xs font-semibold text-base-content/60 mb-1.5 px-1">
                              {group.label}{" "}
                              <span class="font-normal text-base-content/60">
                                （{group.entries.length}件）
                              </span>
                            </h6>
                            <ProgressiveGrid
                              data={group.entries}
                              class="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-2"
                            >
                              {(row) => (
                                <div class="rounded border border-base-300/70 p-2 space-y-1">
                                  <div class="flex flex-wrap items-center gap-1.5 text-xs text-base-content/70">
                                    <button
                                      class="inline-flex items-center gap-1 min-w-0 hover:underline"
                                      onClick={() =>
                                        props.onOpenEquip(row.equip.id)
                                      }
                                      title={row.equip.name}
                                    >
                                      <span class="inline-flex w-5 h-5 items-center justify-center rounded bg-base-200/70 shrink-0">
                                        <WeaponIcon
                                          iconNum={row.equip.type?.[3] ?? 0}
                                        />
                                      </span>
                                      <span class="truncate max-w-40">
                                        {row.equip.name}
                                      </span>
                                    </button>
                                    <Show when={row.partner}>
                                      <>
                                        <span>+</span>
                                        <button
                                          class="inline-flex items-center gap-1 min-w-0 hover:underline"
                                          onClick={() =>
                                            props.onOpenEquip(row.partner!.id)
                                          }
                                          title={row.partner?.name}
                                        >
                                          <span class="inline-flex w-5 h-5 items-center justify-center rounded bg-base-200/70 shrink-0">
                                            <WeaponIcon
                                              iconNum={
                                                row.partner?.type?.[3] ?? 0
                                              }
                                            />
                                          </span>
                                          <span class="truncate max-w-40">
                                            {row.partner?.name}
                                          </span>
                                        </button>
                                      </>
                                    </Show>
                                  </div>
                                  <div class="flex flex-wrap items-center gap-1">
                                    <span
                                      class={`badge badge-outline badge-sm font-mono inline-flex items-center leading-none ${
                                        row.after - row.before > 0
                                          ? "border-info/55 text-info"
                                          : "border-error/45 text-error"
                                      }`}
                                    >
                                      射程 {rangeDisplay(row.before)} →{" "}
                                      {rangeDisplay(row.after)}
                                    </span>
                                  </div>
                                </div>
                              )}
                            </ProgressiveGrid>
</div>
</LazyRender>
)}
</For>
                    </div>
                  </div>
                </Show>
                </section>

                <Show
                  when={
                    props.showMultiSynergy &&
                    (shipSynergy().triple.length > 0 ||
                      shipSynergy().quad.length > 0 ||
                      shipSynergy().penta.length > 0)
                  }
                >
                  <section class="mb-6">
                    <h4 class="font-medium mb-1">多装備シナジー</h4>
                    <p class="text-xs text-base-content/50 mb-4">
                      3〜5装備の組み合わせ。「コンボ」は合計補正値（単体＋ペア＋多装備補正の合計）。「プール」はその中の任意K個を同時装備した際の補正値を示します。
                    </p>
                    <div class="space-y-6">
                      <Show when={shipSynergy().triple.length > 0}>
                        <section class="mb-6">
                          <h4 class="font-medium mb-2">3装備シナジー</h4>
                          <div class="rounded-lg border border-base-300/70 p-3 mb-4 bg-base-50/50">
                            <div class={`space-y-4 pr-1 ${props.expandPairSynergy ? "" : "max-h-[36vh] overflow-y-auto"}`}>
                              <For each={shipSynergy().triple}>
                                {(group) => (
<LazyRender>
<div class="mb-2 last:mb-0">
                                    <h5 class="text-sm font-medium mb-2 border-b border-base-200 pb-1">
                                      {group.label}系{" "}
                                      <span class="font-normal text-base-content/60">
                                        （{group.entries.length}件）
                                      </span>
                                    </h5>
                                    <ProgressiveGrid
                                      data={group.entries}
                                      class="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-2"
                                    >
                                      {(entry) => (
                                        <MultiEntryDisplay
                                          entry={entry}
                                          onOpenEquip={props.onOpenEquip}
                                        />
                                      )}
                                    </ProgressiveGrid>
</div>
</LazyRender>
)}
</For>
                            </div>
                          </div>
                        </section>
                      </Show>

                      <Show when={shipSynergy().quad.length > 0}>
                        <section class="mb-6">
                          <h4 class="font-medium mb-2">4装備シナジー</h4>
                          <div class="rounded-lg border border-base-300/70 p-3 mb-4 bg-base-50/50">
                            <div class={`space-y-4 pr-1 ${props.expandPairSynergy ? "" : "max-h-[36vh] overflow-y-auto"}`}>
                              <For each={shipSynergy().quad}>
                                {(group) => (
<LazyRender>
<div class="mb-2 last:mb-0">
                                    <h5 class="text-sm font-medium mb-2 border-b border-base-200 pb-1">
                                      {group.label}系{" "}
                                      <span class="font-normal text-base-content/60">
                                        （{group.entries.length}件）
                                      </span>
                                    </h5>
                                    <ProgressiveGrid
                                      data={group.entries}
                                      class="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-2"
                                    >
                                      {(entry) => (
                                        <MultiEntryDisplay
                                          entry={entry}
                                          onOpenEquip={props.onOpenEquip}
                                        />
                                      )}
                                    </ProgressiveGrid>
</div>
</LazyRender>
)}
</For>
                            </div>
                          </div>
                        </section>
                      </Show>

                      <Show when={shipSynergy().penta.length > 0}>
                        <div class="rounded-lg border border-base-300/70 p-2">
                          <h5 class="text-sm font-medium mb-2">
                            5装備シナジー
                          </h5>
                          <div class="space-y-3">
                            <For each={shipSynergy().penta}>
                              {(group) => (
<LazyRender>
<div>
                                  <h6 class="text-xs font-semibold text-base-content/60 mb-1.5 px-1">
                                    {group.label}系{" "}
                                    <span class="font-normal text-base-content/60">
                                      （{group.entries.length}件）
                                    </span>
                                  </h6>
                                  <ProgressiveGrid
                                    data={group.entries}
                                    class={`grid grid-cols-1 sm:grid-cols-2 gap-2 ${props.expandPairSynergy ? "" : "max-h-[30vh] overflow-y-auto"}`}
                                  >
                                    {(entry) => (
                                      <MultiEntryDisplay
                                        entry={entry}
                                        onOpenEquip={props.onOpenEquip}
                                      />
                                    )}
                                  </ProgressiveGrid>
</div>
</LazyRender>
)}
</For>
                          </div>
                        </div>
                      </Show>
                    </div>
                  </section>
                </Show>
              </div>
            )}
          </Show>
        </section>
      </div>
    </article>
  );
}

export { ShipDetailPanel };
