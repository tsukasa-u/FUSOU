/** @jsxImportSource solid-js */

import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
} from "solid-js";
import {
  bannerUrl,
  equipImageUrl,
  intersectSorted,
} from "@/features/simulator/equip-calc";

import {
  getMasterShip,
  getMasterShips,
  getMasterSlotItem,
  getMasterSlotItems,
  getSlotItemEffects,
  getSokuSpeedData,
} from "@/features/simulator/simulator-selectors";
import {
  ENEMY_ID_THRESHOLD,
  RANGE_NAMES,
  SPEED_NAMES,
  STYPE_NAMES,
} from "@/features/simulator/constants";
import type {
  MstShipData,
  MstSlotItemData,
  EquipEffect,
  CrossEffect,
  TripleRule,
  QuadRule,
  PentaRule,
} from "@/features/simulator/types";
import {
  equipDisplayTypeName,
  rangeDisplay,
  speedDisplay,
  statValueOrDash,
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
  buildMultiEntries,
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
  statKeyToLabel,
} from "./shared-ui";

function EquipDetailPanel(props: {
  equip: MstSlotItemData;
  onOpenShip: (shipId: number) => void;
  onOpenEquip: (equipId: number) => void;
  expandSynergyShips: boolean;
  expandCompatibleShips: boolean;
}): JSX.Element {
  let equipSynergyContainerRef!: HTMLDivElement;
  const [equipMinHeight, setEquipMinHeight] = createSignal<number | null>(null);

  const [isSynergiesReady, setIsSynergiesReady] = createSignal(false);
  createEffect(() => {
    props.equip; // Track equip changes
    if (equipSynergyContainerRef) {
      setEquipMinHeight(equipSynergyContainerRef.offsetHeight);
    }
    setIsSynergiesReady(false);
    setTimeout(() => {
      setIsSynergiesReady(true);
      setTimeout(() => setEquipMinHeight(null), 50);
    }, 50); // Yield to let DOM paint the equip details first
  });

  const equipSynergyShips = createMemo(() => {
    if (!isSynergiesReady()) return [];
    const effects = getSlotItemEffects();
    if (!effects)
      return [] as Array<{
        ship: MstShipData;
        base: Record<string, number> | null;
        star10: Record<string, number> | null;
        c2: Record<string, number> | null;
        c3: Record<string, number> | null;
        partners: Array<{
          equip: MstSlotItemData;
          stats: Record<string, number>;
        }>;
      }>;

    const singleEntries = getSingleEntriesForEquip(effects, props.equip.id);
    const crossEntries = getCrossEntriesForEquip(effects, props.equip.id);

    const rows: Array<{
      ship: MstShipData;
      base: Record<string, number> | null;
      star10: Record<string, number> | null;
      c2: Record<string, number> | null;
      c3: Record<string, number> | null;
      partners: Array<{
        equip: MstSlotItemData;
        stats: Record<string, number>;
      }>;
    }> = [];

    const relevantShipIds = new Set<number>();
    for (const entry of singleEntries) {
      for (const id of entry.ships) relevantShipIds.add(id);
    }
    for (const entry of crossEntries) {
      for (const id of entry.ships) relevantShipIds.add(id);
    }

    for (const shipId of relevantShipIds) {
      if (shipId >= ENEMY_ID_THRESHOLD) continue;
      const ship = getMasterShip(shipId);
      if (!ship) continue;

      const single = singleEntries.find((entry) =>
        entry.ships.includes(shipId),
      );
      const partners = crossEntries
        .filter((entry) => entry.ships.includes(shipId))
        .map((entry) => {
          const partnerId =
            entry.items[0] === props.equip.id ? entry.items[1] : entry.items[0];
          const partnerEquip = getMasterSlotItem(partnerId);
          if (
            !partnerEquip ||
            partnerEquip.id >= ENEMY_ID_THRESHOLD ||
            scoreSynergy(entry.synergy) === 0
          )
            return null;
          return { equip: partnerEquip, stats: entry.synergy };
        })
        .filter(
          (x): x is { equip: MstSlotItemData; stats: Record<string, number> } =>
            x != null,
        )
        .sort((a, b) => {
          const ta = a.equip.type?.[3] ?? 0;
          const tb = b.equip.type?.[3] ?? 0;
          return ta !== tb
            ? ta - tb
            : scoreSynergy(b.stats) - scoreSynergy(a.stats);
        });

      const hasSingle =
        single &&
        (scoreSynergy(single.b) > 0 ||
          scoreSynergy(single.l) > 0 ||
          scoreSynergy(single.c2) > 0 ||
          scoreSynergy(single.c3) > 0);
      if (!hasSingle && partners.length === 0) continue;

      rows.push({
        ship,
        base: single?.b ?? null,
        star10: single?.l ?? null,
        c2: single?.c2 ?? null,
        c3: single?.c3 ?? null,
        partners,
      });
    }

    rows.sort(
      (a, b) => (a.ship.sort_id ?? a.ship.id) - (b.ship.sort_id ?? b.ship.id),
    );
    return rows;
  });

  /** Triple / quad rules that include this equipment, grouped by combo. */
  const equipMultiSynergies = createMemo(() => {
    if (!isSynergiesReady())
      return {
        triple: [] as MultiGroup[],
        quad: [] as MultiGroup[],
        penta: [] as MultiGroup[],
      };
    const effects = getSlotItemEffects();
    const equipId = props.equip.id;
    if (!effects)
      return {
        triple: [] as MultiGroup[],
        quad: [] as MultiGroup[],
        penta: [] as MultiGroup[],
      };

    const _em = normalizeEffects(effects);
    const _cm = normalizeCrossEffects(effects);

    const buildEquipEntries = (
      rules: Array<TripleRule | QuadRule | PentaRule> | undefined,
      indices: number[] | undefined,
      comboSize: number,
    ): MultiEntry[] => {
      if (!rules || !indices) return [];
      const seenCombos = new Set<string>();
      const all: MultiEntry[] = [];

      for (const idx of indices) {
        const rule = rules[idx];

        if (rule.category_pools) {
          if (scoreSynergy(rule.synergy) === 0) continue;
          const pools = rule.category_pools.map((p) =>
            p
              .map((id) => getMasterSlotItem(id))
              .filter(
                (it): it is MstSlotItemData =>
                  it != null && it.id < ENEMY_ID_THRESHOLD,
              )
              .sort((a, b) => (a.type?.[3] ?? 0) - (b.type?.[3] ?? 0)),
          );
          if (pools.some((p) => p.length === 0)) continue;
          all.push({
            kind: "category",
            pools,
            cancels_single: !!rule.cancels_single,
            correction: rule.synergy,
            ships: rule.ships,
          });
        } else if (rule.item_pool) {
          if (scoreSynergy(rule.synergy) === 0) continue;
          const pool = rule.item_pool
            .map((id) => getMasterSlotItem(id))
            .filter(
              (it): it is MstSlotItemData =>
                it != null && it.id < ENEMY_ID_THRESHOLD,
            )
            .sort((a, b) => (a.type?.[3] ?? 0) - (b.type?.[3] ?? 0));
          if (pool.length < comboSize) continue;
          all.push({
            kind: "pool",
            pool,
            comboSize,
            correction: rule.synergy,
            ships: rule.ships,
          });
        } else if (rule.implicants) {
          if (scoreSynergy(rule.synergy) === 0) continue;
          for (const implicant of rule.implicants) {
            if (!implicant.some(p => p.includes(equipId))) continue;
            const pools = implicant.map((p) =>
              p.map((id) => getMasterSlotItem(id)).filter((it): it is MstSlotItemData => it != null && it.id < ENEMY_ID_THRESHOLD).sort((a, b) => (a.type?.[3] ?? 0) - (b.type?.[3] ?? 0))
            );
            if (pools.some((p) => p.length === 0)) continue;
            all.push({
              kind: "category",
              pools,
              cancels_single: !!rule.cancels_single,
              correction: rule.synergy,
              ships: rule.ships,
            });
          }
        } else if (rule.fixed_items && rule.free_pool) {
          const allPoolIds = [...rule.fixed_items, ...rule.free_pool];
          if (scoreSynergy(rule.synergy) === 0) continue;
          const pool = allPoolIds
            .map((id) => getMasterSlotItem(id))
            .filter(
              (it): it is MstSlotItemData =>
                it != null && it.id < ENEMY_ID_THRESHOLD,
            )
            .sort((a, b) => (a.type?.[3] ?? 0) - (b.type?.[3] ?? 0));
          if (pool.length < comboSize) continue;
          all.push({
            kind: "pool",
            pool,
            comboSize,
            correction: rule.synergy,
            ships: rule.ships,
          });
        } else {
          // Explicit combos: decode all, filter those containing this equip
          const combos = decodeCombosForDisplay(rule, comboSize);
          const shipIdForCalc = rule.ships.length > 0 ? rule.ships[0] : 0;
          for (const comboIds of combos) {
            if (!comboIds.includes(equipId)) continue;
            const key = comboIds
              .slice()
              .sort((a, b) => a - b)
              .join(":");
            if (seenCombos.has(key)) continue;
            seenCombos.add(key);
            const items = comboIds.map((id) => getMasterSlotItem(id));
            if (items.some((it) => !it || it.id >= ENEMY_ID_THRESHOLD))
              continue;

            items.sort((a, b) => (a!.type?.[3] ?? 0) - (b!.type?.[3] ?? 0));
            
            if (comboIds.length > 15) {
              const base: Record<string, number> = {};
              for (const id of comboIds) {
                const itemEntry = _em[String(id)]?.find((e) =>
                  e.ships.includes(shipIdForCalc),
                );
                if (itemEntry) {
                  for (const [k, v] of Object.entries(itemEntry.b ?? {}))
                    base[k] = (base[k] || 0) + v;
                }
              }
              for (const [k, v] of Object.entries(rule.synergy)) {
                if (v) base[k] = (base[k] || 0) + v;
              }
              all.push({
                kind: "combo",
                combo: items as MstSlotItemData[],
                netStats: base,
                ships: rule.ships,
              });
              continue;
            }

            const base = comboBaseBonus(shipIdForCalc, comboIds, _em, _cm);
            for (const [k, v] of Object.entries(rule.synergy)) {
              if (v) base[k] = (base[k] || 0) + v;
            }
            if (scoreSynergy(base) === 0) continue;
            all.push({
              kind: "combo",
              combo: items as MstSlotItemData[],
              netStats: base,
              ships: rule.ships,
            });
          }
        }
      }
      return all;
    };

    const triple = groupByMultiStat(
      buildEquipEntries(
        effects.triple_rules,
        effects.triple_rules_equip_index?.[String(equipId)],
        3,
      ),
    );
    const quad = groupByMultiStat(
      buildEquipEntries(
        effects.quad_rules,
        effects.quad_rules_equip_index?.[String(equipId)],
        4,
      ),
    );
    const penta = groupByMultiStat(
      buildEquipEntries(
        effects.penta_rules,
        effects.penta_rules_equip_index?.[String(equipId)],
        5,
      ),
    );
    return { triple, quad, penta };
  });

  const compatibleShips = createMemo(() => {
    if (!isSynergiesReady()) return [];
    const ships = Object.values(getMasterShips())
      .filter((ship) => ship.id < ENEMY_ID_THRESHOLD)
      .sort((a, b) => (a.sort_id ?? a.id) - (b.sort_id ?? b.id));

    const rows = ships
      .map((ship) => ({
        ship,
        compat: getCompatibilityMeta(ship, props.equip),
      }))
      .filter(
        (row) => row.compat.normalSlots.length > 0 || row.compat.exslot != null,
      );

    return groupBy(
      rows,
      (row) => STYPE_NAMES[row.ship.stype] ?? `艦種${row.ship.stype}`,
    );
  });

  type EquipMobShipEntry = {
    ship: MstShipData;
    single: { before: number; after: number } | null;
    partners: Array<{ equip: MstSlotItemData; before: number; after: number }>;
  };

  const [ready, setReady] = createSignal(false);
  createEffect(() => {
    if (isSynergiesReady()) {
      setTimeout(() => setReady(true), 0);
    } else {
      setReady(false);
    }
  });

  const equipMobilitySynergies = createMemo(() => {
    if (!ready()) return { speedEntries: [], rangeEntries: [] };
    const effects = getSlotItemEffects();
    const equipId = props.equip.id;
    const equipLeng = Number(props.equip.leng ?? 0);

    const speedMap = new Map<number, EquipMobShipEntry>();
    const rangeMap = new Map<number, EquipMobShipEntry>();

    const getOrCreate = (
      map: Map<number, EquipMobShipEntry>,
      ship: MstShipData,
    ): EquipMobShipEntry => {
      let e = map.get(ship.id);
      if (!e) {
        e = { ship, single: null, partners: [] };
        map.set(ship.id, e);
      }
      return e;
    };

    if (!effects) return { speedEntries: [], rangeEntries: [] };

    const singleEntries = getSingleEntriesForEquip(effects, equipId);

    // Cross entries involving this equip
    const crossEntriesByPartner: Array<{
      partnerId: number;
      entry: CrossEffect;
    }> = [];
    const crossEntries = getCrossEntriesForEquip(effects, equipId);
    for (const entry of crossEntries) {
      const partnerId =
        entry.items[0] === equipId ? entry.items[1] : entry.items[0];
      crossEntriesByPartner.push({ partnerId, entry });
    }

    // ── Speed synergy — derived from actual gameplay observations ──
    {
      const speedData = getSokuSpeedData();
      if (speedData) {
        for (const ship of Object.values(getMasterShips())) {
          if (ship.id >= ENEMY_ID_THRESHOLD) continue;
          const masterObs = speedData[ship.id];
          if (!masterObs) continue;

          // Group speed-upgrade observations by speed tier.
          const tierMap = new Map<number, number[][]>();
          for (const obs of masterObs) {
            if (obs.soku_observed <= ship.soku) continue;
            const list = tierMap.get(obs.soku_observed);
            if (list) list.push(obs.item_ids);
            else tierMap.set(obs.soku_observed, [obs.item_ids]);
          }

          for (const [sokuTier, idArrays] of tierMap) {
            let required = [...idArrays[0]];
            for (let k = 1; k < idArrays.length; k++) {
              required = intersectSorted(required, idArrays[k]);
            }

            const isReliable =
              required.length > 0
                ? required.includes(equipId)
                : idArrays.some((ids) => ids.includes(equipId));

            if (!isReliable) continue;

            const requiredForPartners =
              required.length > 0
                ? required
                : (idArrays.find((ids) => ids.includes(equipId)) ?? []);
            const withoutSelf = [...requiredForPartners];
            const selfIdx = withoutSelf.indexOf(equipId);
            if (selfIdx !== -1) withoutSelf.splice(selfIdx, 1);

            const e = getOrCreate(speedMap, ship);
            if (withoutSelf.length === 0) {
              if (!e.single || sokuTier > e.single.after) {
                e.single = { before: ship.soku, after: sokuTier };
              }
            } else {
              for (const pid of withoutSelf) {
                const partnerItem = getMasterSlotItem(pid);
                if (!partnerItem) continue;
                if (
                  !e.partners.some(
                    (p) =>
                      p.equip.id === partnerItem.id && p.after === sokuTier,
                  )
                ) {
                  e.partners.push({
                    equip: partnerItem,
                    before: ship.soku,
                    after: sokuTier,
                  });
                }
              }
            }
          }
        }
      }
    }

    // ── Range synergy ──
    const singleLengByShip = new Map<number, number>();
    for (const entry of singleEntries) {
      const maxLeng = Math.max(
        entry.b?.leng ?? 0,
        entry.l?.leng ?? 0,
        entry.c2?.leng ?? 0,
        entry.c3?.leng ?? 0,
      );
      if (maxLeng === 0) continue;
      for (const shipId of entry.ships) {
        const cur = singleLengByShip.get(shipId) ?? 0;
        if (maxLeng > cur) singleLengByShip.set(shipId, maxLeng);
      }
    }
    for (const [shipId, bonus] of singleLengByShip) {
      const ship = getMasterShip(shipId);
      if (!ship || ship.id >= ENEMY_ID_THRESHOLD) continue;
      const after = Math.max(ship.leng, equipLeng) + bonus;
      if (after === ship.leng) continue;
      const e = getOrCreate(rangeMap, ship);
      if (!e.single) e.single = { before: ship.leng, after };
    }
    for (const { partnerId, entry } of crossEntriesByPartner) {
      const leng = entry.synergy.leng ?? 0;
      if (leng === 0) continue;
      const partner = getMasterSlotItem(partnerId);
      if (!partner || partner.id >= ENEMY_ID_THRESHOLD) continue;
      for (const shipId of entry.ships) {
        const ship = getMasterShip(shipId);
        if (!ship || ship.id >= ENEMY_ID_THRESHOLD) continue;
        const after =
          Math.max(ship.leng, equipLeng, Number(partner.leng ?? 0)) + leng;
        if (after === ship.leng) continue;
        const e = getOrCreate(rangeMap, ship);
        if (!e.partners.some((p) => p.equip.id === partner.id)) {
          e.partners.push({ equip: partner, before: ship.leng, after });
        }
      }
    }
    const allSingleLengEntries: Array<{ equipId: number; entry: EquipEffect; maxLeng: number }> = [];
    if (effects.effect_rules) {
      for (const rule of effects.effect_rules) {
        const maxLeng = Math.max(rule.b?.leng ?? 0, rule.l?.leng ?? 0, rule.c2?.leng ?? 0, rule.c3?.leng ?? 0);
        if (maxLeng === 0) continue;
        for (const itemId of rule.items) {
           allSingleLengEntries.push({ equipId: itemId, entry: rule, maxLeng });
        }
      }
    }

    for (const [shipId, thisBonus] of singleLengByShip) {
      const ship = getMasterShip(shipId);
      if (!ship || ship.id >= ENEMY_ID_THRESHOLD) continue;
      const thisAfter = Math.max(ship.leng, equipLeng) + thisBonus;

      for (const { equipId: otherEquipId, entry: otherEntry, maxLeng: otherMaxLeng } of allSingleLengEntries) {
        if (otherEquipId === equipId) continue;
        if (!otherEntry.ships.includes(shipId)) continue;
        
        const otherEquip = getMasterSlotItem(otherEquipId);
        if (!otherEquip || otherEquip.id >= ENEMY_ID_THRESHOLD) continue;

        const pairKey = `${Math.min(equipId, otherEquipId)}:${Math.max(equipId, otherEquipId)}`;
        const crossEntryLocal = effects.cross_rules_equip_index
          ? crossEntries.find(
              (e) =>
                (e.items[0] === otherEquipId || e.items[1] === otherEquipId) &&
                e.ships.includes(shipId),
            )
          : normalizeCrossEffects(effects)[pairKey]?.find((e) =>
              e.ships.includes(shipId),
            );
        const crossLeng = crossEntryLocal?.synergy.leng ?? 0;
        const effectiveBase = Math.max(
          ship.leng,
          equipLeng,
          Number(otherEquip.leng ?? 0),
        );
        const combinedAfter =
          effectiveBase + thisBonus + otherMaxLeng + crossLeng;
        const otherAfter =
          Math.max(ship.leng, Number(otherEquip.leng ?? 0)) + otherMaxLeng;
        if (combinedAfter <= Math.max(thisAfter, otherAfter)) continue;

        const e = getOrCreate(rangeMap, ship);
        if (!e.partners.some((p) => p.equip.id === otherEquip.id)) {
          e.partners.push({
            equip: otherEquip,
            before: ship.leng,
            after: combinedAfter,
          });
        }
      }
    }

    const sortFn = (a: EquipMobShipEntry, b: EquipMobShipEntry) =>
      (a.ship.sort_id ?? a.ship.id) - (b.ship.sort_id ?? b.ship.id);
    const speedEntries = [...speedMap.values()].sort(sortFn);
    const rangeEntries = [...rangeMap.values()].sort(sortFn);
    return { speedEntries, rangeEntries };
  });

  const specRows = createMemo<Array<[label: string, value: string | number]>>(
    () => {
      const rows: Array<[label: string, value: string | number]> = [
        ["ID", props.equip.id],
        ["種別", equipDisplayTypeName(props.equip)],
        ["射程", rangeDisplay(props.equip.leng)],
        ["半径", statValueOrDash(props.equip.distance)],
        ["火力", statValueOrDash(props.equip.houg)],
        ["雷装", statValueOrDash(props.equip.raig)],
        ["対空", statValueOrDash(props.equip.tyku)],
        ["対潜", statValueOrDash(props.equip.tais)],
        ["爆装", statValueOrDash(props.equip.baku)],
        ["索敵", statValueOrDash(props.equip.saku)],
        ["命中", statValueOrDash(props.equip.houm)],
        ["装甲", statValueOrDash(props.equip.souk)],
        ["回避", statValueOrDash(props.equip.kaih)],
      ];
      return rows;
    },
  );

  return (
    <article class="rounded-xl border border-base-300/70 bg-base-100 shadow-sm overflow-hidden">
      <div class="px-4 py-3 border-b border-base-200 bg-linear-to-r from-accent/10 to-transparent">
        <h2 class="font-semibold">装備詳細</h2>
      </div>

      <div class="p-4 space-y-4">
        <div class="grid grid-cols-1 xl:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)] gap-4 items-stretch">
          <div class="relative rounded-xl border border-base-300/70 bg-linear-to-b from-base-200 to-base-100 p-3 min-h-64 h-full xl:max-w-sm flex items-end justify-center overflow-hidden">
            <ImageFallbackBox
              src={equipImageUrl(props.equip.id, { f: "auto" })}
              alt={props.equip.name}
              class="w-full h-56"
              objectClass="w-full h-full object-contain object-center"
              fallbackText="No Image"
              loading={undefined}
              fetchpriority="high"
            />
            <span class="absolute top-3 left-3 inline-flex h-7 items-center justify-center rounded bg-base-100/92 border border-base-300/70 px-1.5 shadow-sm">
              <WeaponIcon iconNum={props.equip.type?.[3] ?? 0} />
            </span>
          </div>
          <div class="min-w-0 h-full flex flex-col gap-3">
            <h3 class="text-2xl font-bold leading-tight">{props.equip.name}</h3>
            <div class="mt-auto">
              <SpecTable rows={specRows()} />
            </div>
          </div>
        </div>

        <div ref={equipSynergyContainerRef} style={{ "min-height": equipMinHeight() != null ? `${equipMinHeight()}px` : undefined }}>
        <Show
          when={isSynergiesReady()}
          fallback={
            <div class="py-12 flex flex-col items-center justify-center text-base-content/50">
              <span class="loading loading-spinner loading-md mb-2"></span>
              <p>装備条件とシナジーデータを計算・描画しています...</p>
            </div>
          }
        >
          <section class="mb-8">
            <h4 class="text-md font-medium mb-2">装備可能な艦</h4>
            <p class="text-xs text-base-content/55 mb-2">
              補強増設の装備条件は表示しています。改修値が必要な条件は「補強枠条件」に併記します。
            </p>
            <Show 
              when={compatibleShips().length > 0}
              fallback={
                <div class="rounded-lg border border-dashed border-base-300 px-3 py-6 text-sm text-base-content/50 text-center mt-4">
                  装備可能な艦はありません
                </div>
              }
            >
              <div class="rounded-lg border border-base-300/70 p-2">
              <div class={`space-y-3 pr-1 ${props.expandCompatibleShips ? "" : "max-h-[40vh] overflow-y-auto"}`}>
                <For each={compatibleShips()}>
                  {(group) => (
                    <LazyRender>
                    <div>
                      <h6 class="text-xs font-semibold text-base-content/60 mb-1.5 px-1">
                        {group.key}
                      </h6>
                      <ProgressiveGrid data={group.items} class="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-2">
                          {(row) => {
                            return (
                              <button
                                class="w-full flex items-center gap-2 text-left rounded-lg border border-base-300/70 hover:border-primary/45 p-2 bg-base-100/50 transition"
                                onClick={() => props.onOpenShip(row.ship.id)}
                                title={row.ship.name}
                              >
                                <ImageFallbackBox
                                  src={bannerUrl(row.ship.id, { f: "auto" })}
                                  alt={row.ship.name}
                                  class="w-20 h-6 rounded shrink-0"
                                  fallbackText="No Image"
                                  loading="lazy"
                                />
                                <span class="text-sm font-medium truncate flex-1">
                                  {row.ship.name}
                                </span>
                                <CompatibilityBadges
                                  normalSlots={row.compat.normalSlots}
                                  slotCount={row.ship.slot_num}
                                  exslot={row.compat.exslot}
                                />
                              </button>
                            );
                          }}
                        </ProgressiveGrid>
                    </div>
                    </LazyRender>
                  )}
                </For>
              </div>
            </div>
          </Show>
          </section>

          <div class="space-y-8">
            <section>
            <h4 class="text-md font-medium mb-2">この装備のシナジー対象艦</h4>
            <Show
              when={equipSynergyShips().length > 0}
              fallback={
                <div class="rounded-lg border border-dashed border-base-300 px-3 py-6 text-sm text-base-content/50 text-center">
                  この装備に設定されたシナジー対象艦はありません
                </div>
              }
            >
              <div class="rounded-lg border border-base-300/70 p-2">
                <div
                  class={`space-y-3 pr-1 ${props.expandSynergyShips ? "" : "max-h-[36vh] overflow-y-auto"}`}
                >
                  <For
                    each={(() => {
                      const rows = equipSynergyShips();
                      const grouped = new Map<number, typeof rows>();
                      for (const r of rows) {
                        if (!grouped.has(r.ship.stype))
                          grouped.set(r.ship.stype, []);
                        grouped.get(r.ship.stype)!.push(r);
                      }
                      return Array.from(grouped.entries())
                        .sort(([a], [b]) => a - b)
                        .map(([k, v]) => ({ stype: k, rows: v }));
                    })()}
                  >
                    {({ stype, rows }) => (
                      <LazyRender>
                      <div>
                        <h6 class="text-xs font-semibold text-base-content/60 mb-1.5 px-1">
                          {STYPE_NAMES[stype] ?? "不明"}{" "}
                          <span class="font-normal text-base-content/60">
                            （{rows.length}件）
                          </span>
                        </h6>
                        <ProgressiveGrid class="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-2" data={rows}>
                            {(row) => (
                              <div class="w-full flex flex-col rounded-lg border border-base-300/70 p-2 bg-base-100/50 space-y-1">
                                <button
                                  class="flex items-center gap-2 min-w-0 w-full text-left hover:underline"
                                  onClick={() => props.onOpenShip(row.ship.id)}
                                  title={row.ship.name}
                                >
                                  <ImageFallbackBox
                                    src={bannerUrl(row.ship.id, { f: "auto" })}
                                    alt={row.ship.name}
                                    class="w-20 h-6 rounded shrink-0"
                                    fallbackText="No Image"
                                    loading="lazy"
                                  />
                                  <span class="text-sm font-medium truncate">
                                    {row.ship.name}
                                  </span>
                                </button>

                                <Show
                                  when={
                                    row.base != null &&
                                    scoreSynergy(row.base ?? undefined) > 0
                                  }
                                >
                                  <div class="text-xs text-base-content/70 inline-flex items-center h-5">
                                    単体シナジー
                                  </div>
                                  <SynergyStatInline stats={row.base!} />
                                </Show>
                                <Show
                                  when={
                                    row.star10 != null &&
                                    scoreSynergy(row.star10 ?? undefined) > 0
                                  }
                                >
                                  <div class="mt-1 text-xs text-base-content/70 inline-flex items-center h-5">
                                    改修★10
                                  </div>
                                  <SynergyStatInline stats={row.star10!} />
                                </Show>
                                <For each={stackingSynergyRows(row.c2, row.c3)}>
                                  {(stackRow) => (
                                    <>
                                      <div class="mt-1 text-xs text-base-content/70 inline-flex items-center h-5">
                                        {stackRow.label}
                                      </div>
                                      <SynergyStatInline
                                        stats={stackRow.stats}
                                      />
                                    </>
                                  )}
                                </For>

                                <Show when={row.partners.length > 0}>
                                  <div class="mt-2 pt-2 border-t border-base-200/60 w-full flex flex-col">
                                    <div class="text-xs font-medium text-base-content/60 mb-1 px-0.5">
                                      他装備組み合わせ
                                    </div>
                                    <div class="space-y-1.5">
                                    <For each={row.partners.slice(0, 8)}>
                                      {(partner) => (
                                        <div class="rounded border border-base-300/70 p-1.5">
                                          <div class="flex flex-wrap items-center gap-1.5 text-xs text-base-content/70">
                                            <button
                                              class="inline-flex items-center gap-1 min-w-0 hover:underline text-primary font-bold transition-colors"
                                              onClick={() =>
                                                props.onOpenEquip(
                                                  props.equip.id,
                                                )
                                              }
                                              title={props.equip.name}
                                            >
                                              <span class="inline-flex w-5 h-5 items-center justify-center rounded bg-base-200/70 shrink-0">
                                                <WeaponIcon
                                                  iconNum={
                                                    props.equip.type?.[3] ?? 0
                                                  }
                                                />
                                              </span>
                                              <span class="truncate max-w-40">
                                                {props.equip.name}
                                              </span>
                                            </button>
                                            <span>+</span>
                                            <button
                                              class={`inline-flex items-center gap-1 min-w-0 hover:underline transition-colors ${partner.equip.id === props.equip.id ? "text-primary font-bold" : ""}`}
                                              onClick={() =>
                                                props.onOpenEquip(
                                                  partner.equip.id,
                                                )
                                              }
                                              title={partner.equip.name}
                                            >
                                              <span class="inline-flex w-5 h-5 items-center justify-center rounded bg-base-200/70 shrink-0">
                                                <WeaponIcon
                                                  iconNum={
                                                    partner.equip.type?.[3] ?? 0
                                                  }
                                                />
                                              </span>
                                              <span class="truncate max-w-40">
                                                {partner.equip.name}
                                              </span>
                                            </button>
                                          </div>
                                          <SynergyStatInline
                                            stats={partner.stats}
                                          />
                                        </div>
                                      )}
                                    </For>
                                    </div>
                                  </div>
                                </Show>
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
            <h4 class="text-md font-medium mb-2">この装備の速力シナジー対象艦</h4>
            <Show
              when={ready()}
              fallback={
                <div class="py-8 flex flex-col items-center justify-center text-base-content/50">
                  <span class="loading loading-spinner loading-md mb-2"></span>
                </div>
              }
            >
              <Show
                when={equipMobilitySynergies().speedEntries.length > 0}
                fallback={
                  <div class="rounded-lg border border-dashed border-base-300 px-3 py-6 text-sm text-base-content/50 text-center">
                    この装備に設定された速力シナジー対象艦はありません
                  </div>
                }
              >
                <div class="rounded-lg border border-base-300/70 p-2">
                  <div
                    class={`space-y-3 pr-1 ${props.expandSynergyShips ? "" : "max-h-[36vh] overflow-y-auto"}`}
                  >
                    <For
                      each={(() => {
                        const rows = equipMobilitySynergies().speedEntries;
                        const grouped = new Map<number, typeof rows>();
                        for (const r of rows) {
                          if (!grouped.has(r.ship.stype))
                            grouped.set(r.ship.stype, []);
                          grouped.get(r.ship.stype)!.push(r);
                        }
                        return Array.from(grouped.entries())
                          .sort(([a], [b]) => a - b)
                          .map(([k, v]) => ({ stype: k, rows: v }));
                      })()}
                    >
                      {({ stype, rows }) => (
                        <LazyRender>
                        <div>
                          <h6 class="text-xs font-semibold text-base-content/60 mb-1.5 px-1">
                            {STYPE_NAMES[stype] ?? "不明"}{" "}
                            <span class="font-normal text-base-content/60">
                              （{rows.length}件）
                            </span>
                          </h6>
                          <ProgressiveGrid class="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-2" data={rows}>
                              {(entry) => (
                                <div class="w-full flex flex-col rounded-lg border border-base-300/70 p-2 bg-base-100/50 space-y-1">
                                  <button
                                    class="flex items-center gap-2 min-w-0 w-full text-left hover:underline"
                                    onClick={() =>
                                      props.onOpenShip(entry.ship.id)
                                    }
                                    title={entry.ship.name}
                                  >
                                    <ImageFallbackBox
                                      src={bannerUrl(entry.ship.id, {
                                        f: "auto",
                                      })}
                                      alt={entry.ship.name}
                                      class="w-20 h-6 rounded shrink-0"
                                      fallbackText="No Image"
                                      loading="lazy"
                                    />
                                    <span class="text-sm font-medium truncate">
                                      {entry.ship.name}
                                    </span>
                                  </button>
                                  <Show when={entry.single != null}>
                                    <div class="text-xs text-base-content/70 inline-flex items-center h-5">
                                      単体
                                    </div>
                                    <div class="flex flex-wrap items-center gap-1">
                                      <span
                                        class={`badge badge-outline badge-sm font-mono inline-flex items-center leading-none ${
                                          entry.single!.after -
                                            entry.single!.before >
                                          0
                                            ? "border-info/55 text-info"
                                            : "border-error/45 text-error"
                                        }`}
                                      >
                                        速力{" "}
                                        {speedDisplay(entry.single!.before)} →{" "}
                                        {speedDisplay(entry.single!.after)}
                                      </span>
                                    </div>
                                  </Show>
                                  <Show when={entry.partners.length > 0}>
                                  <div class="mt-2 pt-2 border-t border-base-200/60 w-full flex flex-col">
                                    <div class="text-xs font-medium text-base-content/60 mb-1 px-0.5">
                                      他装備組み合わせ
                                    </div>
                                    <div class="space-y-1.5">
                                      <For each={entry.partners.slice(0, 8)}>
                                        {(partner) => (
                                          <div class="rounded border border-base-300/70 p-1.5">
                                            <div class="flex flex-wrap items-center gap-1.5 text-xs text-base-content/70">
                                              <button
                                                class="inline-flex items-center gap-1 min-w-0 hover:underline text-primary font-bold transition-colors"
                                                onClick={() =>
                                                  props.onOpenEquip(
                                                    props.equip.id,
                                                  )
                                                }
                                                title={props.equip.name}
                                              >
                                                <span class="inline-flex w-5 h-5 items-center justify-center rounded bg-base-200/70 shrink-0">
                                                  <WeaponIcon
                                                    iconNum={
                                                      props.equip.type?.[3] ?? 0
                                                    }
                                                  />
                                                </span>
                                                <span class="truncate max-w-40">
                                                  {props.equip.name}
                                                </span>
                                              </button>
                                              <span>+</span>
                                              <button
                                                class={`inline-flex items-center gap-1 min-w-0 hover:underline transition-colors ${partner.equip.id === props.equip.id ? "text-primary font-bold" : ""}`}
                                                onClick={() =>
                                                  props.onOpenEquip(
                                                    partner.equip.id,
                                                  )
                                                }
                                                title={partner.equip.name}
                                              >
                                                <span class="inline-flex w-5 h-5 items-center justify-center rounded bg-base-200/70 shrink-0">
                                                  <WeaponIcon
                                                    iconNum={
                                                      partner.equip.type?.[3] ??
                                                      0
                                                    }
                                                  />
                                                </span>
                                                <span class="truncate max-w-40">
                                                  {partner.equip.name}
                                                </span>
                                              </button>
                                            </div>
                                            <div class="flex flex-wrap items-center gap-1 mt-1">
                                              <span
                                                class={`badge badge-outline badge-sm font-mono inline-flex items-center leading-none ${
                                                  partner.after -
                                                    partner.before >
                                                  0
                                                    ? "border-info/55 text-info"
                                                    : "border-error/45 text-error"
                                                }`}
                                              >
                                                速力{" "}
                                                {speedDisplay(partner.before)} →{" "}
                                                {speedDisplay(partner.after)}
                                              </span>
                                            </div>
                                          </div>
                                        )}
                                      </For>
                                    </div>
                                  </div>
                                </Show>
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
            </Show>

            </section>
            <section>
            <h4 class="text-md font-medium mb-2">この装備の射程シナジー対象艦</h4>
            <Show
              when={ready()}
              fallback={
                <div class="py-8 flex flex-col items-center justify-center text-base-content/50">
                  <span class="loading loading-spinner loading-md mb-2"></span>
                </div>
              }
            >
              <Show
                when={equipMobilitySynergies().rangeEntries.length > 0}
                fallback={
                  <div class="rounded-lg border border-dashed border-base-300 px-3 py-6 text-sm text-base-content/50 text-center">
                    この装備に設定された射程シナジー対象艦はありません
                  </div>
                }
              >
                <div class="rounded-lg border border-base-300/70 p-2">
                  <div
                    class={`space-y-3 pr-1 ${props.expandSynergyShips ? "" : "max-h-[36vh] overflow-y-auto"}`}
                  >
                    <For
                      each={(() => {
                        const rows = equipMobilitySynergies().rangeEntries;
                        const grouped = new Map<number, typeof rows>();
                        for (const r of rows) {
                          if (!grouped.has(r.ship.stype))
                            grouped.set(r.ship.stype, []);
                          grouped.get(r.ship.stype)!.push(r);
                        }
                        return Array.from(grouped.entries())
                          .sort(([a], [b]) => a - b)
                          .map(([k, v]) => ({ stype: k, rows: v }));
                      })()}
                    >
                      {({ stype, rows }) => (
                        <LazyRender>
                        <div>
                          <h6 class="text-xs font-semibold text-base-content/60 mb-1.5 px-1">
                            {STYPE_NAMES[stype] ?? "不明"}{" "}
                            <span class="font-normal text-base-content/60">
                              （{rows.length}件）
                            </span>
                          </h6>
                          <ProgressiveGrid class="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-2" data={rows}>
                              {(entry) => (
                                <div class="w-full flex flex-col rounded-lg border border-base-300/70 p-2 bg-base-100/50 space-y-1">
                                  <button
                                    class="flex items-center gap-2 min-w-0 w-full text-left hover:underline"
                                    onClick={() =>
                                      props.onOpenShip(entry.ship.id)
                                    }
                                    title={entry.ship.name}
                                  >
                                    <ImageFallbackBox
                                      src={bannerUrl(entry.ship.id, {
                                        f: "auto",
                                      })}
                                      alt={entry.ship.name}
                                      class="w-20 h-6 rounded shrink-0"
                                      fallbackText="No Image"
                                      loading="lazy"
                                    />
                                    <span class="text-sm font-medium truncate">
                                      {entry.ship.name}
                                    </span>
                                  </button>
                                  <Show when={entry.single != null}>
                                    <div class="text-xs text-base-content/70 inline-flex items-center h-5">
                                      単体
                                    </div>
                                    <div class="flex flex-wrap items-center gap-1">
                                      <span
                                        class={`badge badge-outline badge-sm font-mono inline-flex items-center leading-none ${
                                          entry.single!.after -
                                            entry.single!.before >
                                          0
                                            ? "border-info/55 text-info"
                                            : "border-error/45 text-error"
                                        }`}
                                      >
                                        射程{" "}
                                        {rangeDisplay(entry.single!.before)} →{" "}
                                        {rangeDisplay(entry.single!.after)}
                                      </span>
                                    </div>
                                  </Show>
                                  <Show when={entry.partners.length > 0}>
                                  <div class="mt-2 pt-2 border-t border-base-200/60 w-full flex flex-col">
                                    <div class="text-xs font-medium text-base-content/60 mb-1 px-0.5">
                                      他装備組み合わせ
                                    </div>
                                    <div class="space-y-1.5">
                                      <For each={entry.partners.slice(0, 8)}>
                                        {(partner) => (
                                          <div class="rounded border border-base-300/70 p-1.5">
                                            <div class="flex flex-wrap items-center gap-1.5 text-xs text-base-content/70">
                                              <button
                                                class="inline-flex items-center gap-1 min-w-0 hover:underline text-primary font-bold transition-colors"
                                                onClick={() =>
                                                  props.onOpenEquip(
                                                    props.equip.id,
                                                  )
                                                }
                                                title={props.equip.name}
                                              >
                                                <span class="inline-flex w-5 h-5 items-center justify-center rounded bg-base-200/70 shrink-0">
                                                  <WeaponIcon
                                                    iconNum={
                                                      props.equip.type?.[3] ?? 0
                                                    }
                                                  />
                                                </span>
                                                <span class="truncate max-w-40">
                                                  {props.equip.name}
                                                </span>
                                              </button>
                                              <span>+</span>
                                              <button
                                                class={`inline-flex items-center gap-1 min-w-0 hover:underline transition-colors ${partner.equip.id === props.equip.id ? "text-primary font-bold" : ""}`}
                                                onClick={() =>
                                                  props.onOpenEquip(
                                                    partner.equip.id,
                                                  )
                                                }
                                                title={partner.equip.name}
                                              >
                                                <span class="inline-flex w-5 h-5 items-center justify-center rounded bg-base-200/70 shrink-0">
                                                  <WeaponIcon
                                                    iconNum={
                                                      partner.equip.type?.[3] ??
                                                      0
                                                    }
                                                  />
                                                </span>
                                                <span class="truncate max-w-40">
                                                  {partner.equip.name}
                                                </span>
                                              </button>
                                            </div>
                                            <div class="flex flex-wrap items-center gap-1 mt-1">
                                              <span
                                                class={`badge badge-outline badge-sm font-mono inline-flex items-center leading-none ${
                                                  partner.after -
                                                    partner.before >
                                                  0
                                                    ? "border-info/55 text-info"
                                                    : "border-error/45 text-error"
                                                }`}
                                              >
                                                射程{" "}
                                                {rangeDisplay(partner.before)} →{" "}
                                                {rangeDisplay(partner.after)}
                                              </span>
                                            </div>
                                          </div>
                                        )}
                                      </For>
                                    </div>
                                  </div>
                                </Show>
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
            </Show>
          

          <Show
            when={
              equipMultiSynergies().triple.length > 0 ||
              equipMultiSynergies().quad.length > 0 ||
              equipMultiSynergies().penta.length > 0
            }
          >
            <section>
              <h4 class="text-md font-medium mb-2">この装備を含む多装備シナジー</h4>
              <p class="text-xs text-base-content/50 mb-2">
                この装備が含まれる3・4装備の組み合わせ。ステータス種別ごとにグループ表示。
              </p>
              <div class="space-y-4">
                <Show when={equipMultiSynergies().triple.length > 0}>
                  <section class="mb-6">
                    <h4 class="font-medium mb-2">3装備シナジー</h4>
                    <div class="rounded-lg border border-base-300/70 p-3 mb-4 bg-base-50/50">
                      <div class={`space-y-4 pr-1 ${props.expandSynergyShips ? "" : "max-h-[36vh] overflow-y-auto"}`}>
                        <For each={equipMultiSynergies().triple}>
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
                                    currentEquipId={props.equip.id}
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

                <Show when={equipMultiSynergies().quad.length > 0}>
                  <section class="mb-6">
                    <h4 class="font-medium mb-2">4装備シナジー</h4>
                    <div class="rounded-lg border border-base-300/70 p-3 mb-4 bg-base-50/50">
                      <div class={`space-y-4 pr-1 ${props.expandSynergyShips ? "" : "max-h-[36vh] overflow-y-auto"}`}>
                        <For each={equipMultiSynergies().quad}>
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
                                    currentEquipId={props.equip.id}
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

                <Show when={equipMultiSynergies().penta.length > 0}>
                  <section class="mb-6">
                    <h4 class="font-medium mb-2">5装備シナジー</h4>
                    <div class="rounded-lg border border-base-300/70 p-3 mb-4 bg-base-50/50">
                      <div class={`space-y-4 pr-1 ${props.expandSynergyShips ? "" : "max-h-[36vh] overflow-y-auto"}`}>
                        <For each={equipMultiSynergies().penta}>
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
                                    currentEquipId={props.equip.id}
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
                            </div>
            </section>
          </Show>
          </section>
          </div>
        </Show>
        </div>
      </div>
    </article>
  );
}

export { EquipDetailPanel };
