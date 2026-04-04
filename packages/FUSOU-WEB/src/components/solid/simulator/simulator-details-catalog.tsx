/** @jsxImportSource solid-js */

import { For, Show, createEffect, createMemo, createSignal, onMount, type JSX } from "solid-js";
import { render } from "solid-js/web";
import { bannerUrl, cardUrl, createWeaponIconEl, equipImageUrl } from "../../../pages/simulator/lib/equip-calc";
import {
  filterForExslot,
  getExslotSelectionRequirement,
  getNormalSlotAllowedIndexes,
  type EquipSelectionRequirement,
} from "../../../pages/simulator/lib/equip-filter";
import {
  getMasterShip,
  getMasterShips,
  getMasterSlotItem,
  getMasterSlotItems,
  getSlotItemEffects,
} from "../../../pages/simulator/lib/simulator-selectors";
import { ENEMY_ID_THRESHOLD, EQUIP_TYPE_NAMES, RANGE_NAMES, SPEED_NAMES, STYPE_NAMES } from "../../../pages/simulator/lib/constants";
import type { MstShipData, MstSlotItemData } from "../../../pages/simulator/lib/types";

type DetailsTab = "ship" | "equip";

function statRangeLabel(value: number[] | null | undefined): string {
  if (!value || value.length === 0) return "-";
  if (value.length === 1) return String(value[0]);
  return `${value[0]} - ${value[value.length - 1]}`;
}

function equipTypeName(typeId: number | null): string {
  if (typeId == null) return "不明";
  return EQUIP_TYPE_NAMES[typeId] ?? `種別${typeId}`;
}

function equipDisplayTypeName(equip: MstSlotItemData): string {
  return equipTypeName(equip.type?.[2] ?? null);
}

function rangeDisplay(value: number | null | undefined): string {
  if (value == null || value === 0) return "-";
  return RANGE_NAMES[value] ?? String(value);
}

function statValueOrDash(value: number | null | undefined): string | number {
  return value == null || value === 0 ? "-" : value;
}

type ListExpandSettings = {
  expandEquippableEquip: boolean;
  expandSingleSynergy: boolean;
  expandPairSynergy: boolean;
  expandSynergyShips: boolean;
  expandCompatibleShips: boolean;
};

const DEFAULT_EXPAND_SETTINGS: ListExpandSettings = {
  expandEquippableEquip: false,
  expandSingleSynergy: false,
  expandPairSynergy: false,
  expandSynergyShips: false,
  expandCompatibleShips: false,
};

const SYNERGY_STAT_LABELS: Record<string, string> = {
  houg: "火力",
  raig: "雷装",
  tyku: "対空",
  souk: "装甲",
  kaih: "回避",
  tais: "対潜",
  saku: "索敵",
  baku: "爆装",
  houm: "命中",
  luck: "運",
  leng: "射程",
};

const SYNERGY_STAT_ORDER = [
  "houg",
  "raig",
  "tyku",
  "tais",
  "baku",
  "houm",
  "saku",
  "souk",
  "kaih",
  "luck",
  "leng",
] as const;

type SynergyStatRows = Array<{ key: string; label: string; value: number }>;

function toSynergyStatRows(stats: Record<string, number> | undefined): SynergyStatRows {
  if (!stats) return [];
  const rows: SynergyStatRows = [];
  for (const key of SYNERGY_STAT_ORDER) {
    const value = stats[key];
    if (!value) continue;
    rows.push({ key, label: SYNERGY_STAT_LABELS[key] ?? key, value });
  }
  for (const [key, value] of Object.entries(stats)) {
    if (!value || SYNERGY_STAT_ORDER.includes(key as (typeof SYNERGY_STAT_ORDER)[number])) continue;
    rows.push({ key, label: SYNERGY_STAT_LABELS[key] ?? key, value });
  }
  return rows;
}

function scoreSynergy(stats: Record<string, number> | undefined): number {
  if (!stats) return 0;
  return Object.values(stats).reduce((sum, value) => sum + Math.abs(value || 0), 0);
}

function synergySignature(stats: Record<string, number> | undefined): string {
  const rows = toSynergyStatRows(stats);
  return rows.map((row) => `${row.key}:${row.value}`).join("|");
}

function stackingSynergyRows(
  c2: Record<string, number> | null | undefined,
  c3: Record<string, number> | null | undefined,
): Array<{ label: string; stats: Record<string, number> }> {
  const hasC2 = scoreSynergy(c2 ?? undefined) > 0;
  const hasC3 = scoreSynergy(c3 ?? undefined) > 0;
  if (!hasC2 && !hasC3) return [];
  if (hasC2 && hasC3 && synergySignature(c2 ?? undefined) === synergySignature(c3 ?? undefined)) {
    return [{ label: "2積み以上", stats: c2! }];
  }
  return [
    ...(hasC2 ? [{ label: "2積み", stats: c2! }] : []),
    ...(hasC3 ? [{ label: "3積み以上", stats: c3! }] : []),
  ];
}

function SynergyStatInline(props: { stats: Record<string, number> }): JSX.Element {
  const rows = createMemo(() => toSynergyStatRows(props.stats));
  return (
    <Show
      when={rows().length > 0}
      fallback={<span class="text-xs text-base-content/50">効果なし</span>}
    >
      <div class="flex flex-wrap items-center gap-1">
        <For each={rows()}>
          {(row) => (
            <span
              class={`badge badge-outline badge-sm font-mono inline-flex items-center leading-none ${
                row.value > 0
                  ? "border-info/55 text-info"
                  : "border-error/45 text-error"
              }`}
            >
              {row.label}{row.value > 0 ? `+${row.value}` : row.value}
            </span>
          )}
        </For>
      </div>
    </Show>
  );
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Array<{ key: string; items: T[] }> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const rows = map.get(key);
    if (rows) rows.push(item);
    else map.set(key, [item]);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "ja"))
    .map(([key, rows]) => ({ key, items: rows }));
}

function WeaponIcon(props: { iconNum: number }): JSX.Element {
  let host!: HTMLSpanElement;

  onMount(() => {
    host.replaceChildren(createWeaponIconEl(props.iconNum, 18));
  });

  createEffect(() => {
    props.iconNum;
    if (!host) return;
    host.replaceChildren(createWeaponIconEl(props.iconNum, 18));
  });

  return <span ref={host} class="inline-flex shrink-0" />;
}

function ImageFallbackBox(props: {
  src: string;
  alt: string;
  class: string;
  fallbackText?: string;
  objectClass?: string;
}): JSX.Element {
  const [errored, setErrored] = createSignal(!props.src);

  createEffect(() => {
    setErrored(!props.src);
  });

  return (
    <div class={`${props.class} overflow-hidden bg-base-200`}>
      <Show
        when={!errored()}
        fallback={
          <div class="w-full h-full flex items-center justify-center text-base-content/20 text-xs">
            {props.fallbackText ?? "No Image"}
          </div>
        }
      >
        <img
          src={props.src}
          alt={props.alt}
          class={props.objectClass ?? "w-full h-full object-cover"}
          loading="lazy"
          onError={() => setErrored(true)}
        />
      </Show>
    </div>
  );
}

function SpecTable(props: {
  rows: Array<[label: string, value: string | number]>;
}): JSX.Element {
  const pairedRows = createMemo(() => {
    const chunks: Array<Array<[label: string, value: string | number]>> = [];
    for (let index = 0; index < props.rows.length; index += 2) {
      chunks.push(props.rows.slice(index, index + 2));
    }
    return chunks;
  });

  return (
    <div class="overflow-x-auto rounded-xl border border-base-300/70">
      <table class="table table-fixed table-zebra table-sm w-full">
        <tbody>
          <For each={pairedRows()}>
            {(pair) => (
              <tr>
                <th class="w-28 md:w-36 text-base-content/65 font-medium">{pair[0]?.[0]}</th>
                <td class="font-mono text-right md:text-left">{pair[0]?.[1]}</td>
                <Show when={pair[1]} fallback={<><th class="hidden xl:table-cell"></th><td class="hidden xl:table-cell"></td></>}>
                  <th class="hidden xl:table-cell w-28 md:w-36 text-base-content/65 font-medium">{pair[1]?.[0]}</th>
                  <td class="hidden xl:table-cell font-mono text-right md:text-left">{pair[1]?.[1]}</td>
                </Show>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

type CompatibilityMeta = {
  normalSlots: number[];
  exslot: EquipSelectionRequirement | null;
};

function formatSlotIndexes(indexes: number[]): string {
  if (indexes.length === 0) return "";

  const ranges: string[] = [];
  let start = indexes[0];
  let end = indexes[0];

  for (let i = 1; i < indexes.length; i += 1) {
    const value = indexes[i];
    if (value === end + 1) {
      end = value;
      continue;
    }
    ranges.push(start === end ? `${start + 1}` : `${start + 1}-${end + 1}`);
    start = value;
    end = value;
  }

  ranges.push(start === end ? `${start + 1}` : `${start + 1}-${end + 1}`);
  return `${ranges.join(",")}番`;
}

function getCompatibilityMeta(ship: MstShipData, equip: MstSlotItemData): CompatibilityMeta {
  const normalSlots = ship.slot_num > 0 ? getNormalSlotAllowedIndexes(ship.id, equip) : [];
  const exslotList = filterForExslot(ship.id, [equip]);
  const exslotReq = exslotList && exslotList.length > 0 ? getExslotSelectionRequirement(ship.id, equip) : null;

  return {
    normalSlots,
    exslot: exslotReq,
  };
}

function CompatibilityBadges(props: {
  normalSlots: number[];
  slotCount: number;
  exslot: EquipSelectionRequirement | null;
}): JSX.Element {
  const exslotOnly = createMemo(() => props.normalSlots.length === 0 && props.exslot != null);
  const partialNormalSlots = createMemo(() =>
    props.normalSlots.length > 0 && props.normalSlots.length < props.slotCount
      ? formatSlotIndexes(props.normalSlots)
      : null,
  );

  return (
    <span class="ml-auto inline-flex flex-wrap items-center justify-end gap-1 shrink-0">
      <Show when={partialNormalSlots()}>
        <span class="badge badge-outline badge-xs">{partialNormalSlots()}</span>
      </Show>
      <Show when={exslotOnly()}>
        <span class="badge badge-warning badge-xs">補強のみ</span>
      </Show>
      <Show when={props.exslot != null && (props.exslot.level > 0 || props.exslot.alv > 0)}>
        <span class="badge badge-outline badge-xs border-warning text-warning">
          {[
            props.exslot!.level > 0 ? `補強★${props.exslot!.level}` : null,
            props.exslot!.alv > 0 ? `熟${props.exslot!.alv}` : null,
          ].filter(Boolean).join(" /")}
        </span>
      </Show>
    </span>
  );
}

function ShipListRow(props: {
  ship: MstShipData;
  active: boolean;
  onSelect: () => void;
}): JSX.Element {
  return (
    <button
      class={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition border ${
        props.active
          ? "bg-primary/12 border-primary/35"
          : "hover:bg-primary/8 active:bg-primary/15 border-transparent"
      }`}
      onClick={props.onSelect}
    >
      <ImageFallbackBox
        src={bannerUrl(props.ship.id)}
        alt={props.ship.name}
        class="w-24 h-7 rounded shrink-0"
        fallbackText="No Image"
      />
      <div class="min-w-0 text-left">
        <p class="text-sm leading-tight truncate font-medium" title={props.ship.name}>{props.ship.name}</p>
        <p class="text-[11px] text-base-content/45 leading-tight mt-0.5">
          ID {props.ship.id} / {STYPE_NAMES[props.ship.stype] ?? `艦種${props.ship.stype}`}
        </p>
      </div>
    </button>
  );
}

function EquipListRow(props: {
  equip: MstSlotItemData;
  active: boolean;
  onSelect: () => void;
}): JSX.Element {
  const iconNum = props.equip.type?.[3] ?? 0;

  return (
    <button
      class={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition border ${
        props.active
          ? "bg-accent/12 border-accent/35"
          : "hover:bg-primary/8 active:bg-primary/15 border-transparent"
      }`}
      onClick={props.onSelect}
    >
      <span class="w-5 h-5 inline-flex items-center justify-center rounded bg-base-200/70 shrink-0">
        <WeaponIcon iconNum={iconNum} />
      </span>
      <div class="min-w-0 text-left">
        <p class="text-sm leading-tight truncate font-medium" title={props.equip.name}>{props.equip.name}</p>
        <p class="text-[11px] text-base-content/45 leading-tight mt-0.5">
          ID {props.equip.id} / {equipDisplayTypeName(props.equip)}
        </p>
      </div>
    </button>
  );
}

function ShipDetailPanel(props: {
  ship: MstShipData;
  onOpenEquip: (equipId: number) => void;
  expandEquippableEquip: boolean;
  expandSingleSynergy: boolean;
  expandPairSynergy: boolean;
}): JSX.Element {
  const shipSynergy = createMemo(() => {
    const effects = getSlotItemEffects();
    if (!effects) return { single: [], pair: [] } as {
      single: Array<{ equip: MstSlotItemData; base: Record<string, number>; star10: Record<string, number> | null; c2: Record<string, number> | null; c3: Record<string, number> | null }>;
      pair: Array<{ a: MstSlotItemData; b: MstSlotItemData; stats: Record<string, number> }>;
    };

    const single: Array<{ equip: MstSlotItemData; base: Record<string, number>; star10: Record<string, number> | null; c2: Record<string, number> | null; c3: Record<string, number> | null }> = [];
    for (const [equipIdRaw, entries] of Object.entries(effects.effects)) {
      const equipId = Number(equipIdRaw);
      const equip = getMasterSlotItem(equipId);
      if (!equip || equip.id >= ENEMY_ID_THRESHOLD) continue;
      const matched = entries.find((entry) => entry.ships.includes(props.ship.id));
      if (!matched) continue;
      if (scoreSynergy(matched.b) === 0 && scoreSynergy(matched.l) === 0 && scoreSynergy(matched.c2) === 0 && scoreSynergy(matched.c3) === 0) continue;
      single.push({
        equip,
        base: matched.b,
        star10: matched.l ?? null,
        c2: matched.c2 ?? null,
        c3: matched.c3 ?? null,
      });
    }

    const pair: Array<{ a: MstSlotItemData; b: MstSlotItemData; stats: Record<string, number> }> = [];
    for (const entries of Object.values(effects.cross_effects)) {
      for (const entry of entries) {
        if (!entry.ships.includes(props.ship.id)) continue;
        const a = getMasterSlotItem(entry.items[0]);
        const b = getMasterSlotItem(entry.items[1]);
        if (!a || !b || a.id >= ENEMY_ID_THRESHOLD || b.id >= ENEMY_ID_THRESHOLD) continue;
        if (scoreSynergy(entry.synergy) === 0) continue;
        pair.push({ a, b, stats: entry.synergy });
      }
    }

    single.sort((x, y) => scoreSynergy(y.base) - scoreSynergy(x.base));
    pair.sort((x, y) => scoreSynergy(y.stats) - scoreSynergy(x.stats));
    return { single, pair };
  });

  const equippableGroups = createMemo(() => {
    const allies = Object.values(getMasterSlotItems())
      .filter((equip) => equip.id < ENEMY_ID_THRESHOLD)
      .sort((a, b) => a.sortno - b.sortno)
      .map((equip) => ({ equip, compat: getCompatibilityMeta(props.ship, equip) }))
      .filter((row) => row.compat.normalSlots.length > 0 || row.compat.exslot != null);
    return groupBy(allies, (row) => equipDisplayTypeName(row.equip));
  });

  const specRows = createMemo<Array<[label: string, value: string | number]>>(() => [
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
    ["対潜", statRangeLabel(props.ship.tais)],
    ["回避", statRangeLabel(props.ship.kaih)],
    ["索敵", statRangeLabel(props.ship.saku)],
    ["運", statRangeLabel(props.ship.luck)],
    ["搭載内訳", props.ship.maxeq ? props.ship.maxeq.slice(0, props.ship.slot_num).join(" / ") : "-"],
  ]);

  return (
    <article class="rounded-2xl border border-base-300/70 bg-base-100 shadow-sm overflow-hidden">
      <div class="px-4 py-3 border-b border-base-200 bg-linear-to-r from-primary/10 to-transparent">
        <h2 class="font-semibold">艦詳細</h2>
      </div>

      <div class="p-4 space-y-4">
        <div class="grid grid-cols-1 xl:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)] gap-4 items-stretch">
          <div class="rounded-2xl border border-base-300/70 bg-linear-to-b from-base-200 to-base-100 p-3 min-h-80 h-full flex flex-col items-center justify-center overflow-hidden xl:max-w-sm">
            <ImageFallbackBox
              src={cardUrl(props.ship.id)}
              alt={props.ship.name}
              class="w-full h-72 rounded-md"
              objectClass="w-full h-full object-contain object-center"
              fallbackText="No Image"
            />
          </div>
          <div class="min-w-0 h-full flex flex-col gap-2">
            <h3 class="text-2xl font-bold leading-tight">{props.ship.name}</h3>
            <div>
              <SpecTable rows={specRows()} />
            </div>
          </div>
        </div>

        <section>
          <h4 class="font-medium mb-2">装備可能な装備</h4>
          <div class={`space-y-3 pr-1 ${props.expandEquippableEquip ? "" : "max-h-[40vh] overflow-y-auto"}`}>
            <For each={equippableGroups()}>
              {(group) => (
                <div class="rounded-lg border border-base-300/70 p-2">
                  <h5 class="text-sm font-medium mb-2">{group.key}</h5>
                  <div class="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-1.5">
                    <For each={group.items.slice(0, 60)}>
                      {(row) => (
                        <button
                          class="w-full text-left flex items-center gap-2 rounded border border-base-300/70 hover:border-accent/45 px-2 py-1.5 transition"
                          onClick={() => props.onOpenEquip(row.equip.id)}
                          title={row.equip.name}
                        >
                          <span class="w-5 h-5 inline-flex items-center justify-center rounded bg-base-200/70 shrink-0">
                            <WeaponIcon iconNum={row.equip.type?.[3] ?? 0} />
                          </span>
                          <span class="text-xs truncate flex-1">{row.equip.name}</span>
                          <CompatibilityBadges
                            normalSlots={row.compat.normalSlots}
                            slotCount={props.ship.slot_num}
                            exslot={row.compat.exslot}
                          />
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </div>
        </section>

        <section>
          <h4 class="font-medium mb-2">装備シナジー</h4>
          <div class="space-y-3">
            <Show when={shipSynergy().single.length > 0} fallback={<div class="rounded-lg border border-dashed border-base-300 px-3 py-4 text-sm text-base-content/50">この艦に設定された単体装備シナジーはありません</div>}>
              <div class="rounded-lg border border-base-300/70 p-2">
                <h5 class="text-sm font-medium mb-2">単体装備シナジー</h5>
                <div class={`grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-2 pr-1 ${props.expandSingleSynergy ? "" : "max-h-[36vh] overflow-y-auto"}`}>
                  <For each={shipSynergy().single.slice(0, 80)}>
                    {(row) => (
                      <div class="rounded border border-base-300/70 p-2 space-y-1">
                        <button class="flex items-center gap-2 min-w-0 w-full text-left hover:underline" onClick={() => props.onOpenEquip(row.equip.id)} title={row.equip.name}>
                          <span class="w-5 h-5 inline-flex items-center justify-center rounded bg-base-200/70 shrink-0">
                            <WeaponIcon iconNum={row.equip.type?.[3] ?? 0} />
                          </span>
                          <span class="text-sm font-medium truncate">{row.equip.name}</span>
                        </button>
                        <div class="text-xs text-base-content/70 inline-flex items-center h-5">基本</div>
                        <SynergyStatInline stats={row.base} />
                        <Show when={row.star10 != null && scoreSynergy(row.star10 ?? undefined) > 0}>
                          <div class="text-xs text-base-content/70 mt-1 inline-flex items-center h-5">改修★10</div>
                          <SynergyStatInline stats={row.star10!} />
                        </Show>
                        <For each={stackingSynergyRows(row.c2, row.c3)}>
                          {(stackRow) => (
                            <>
                              <div class="text-xs text-base-content/70 mt-1 inline-flex items-center h-5">{stackRow.label}</div>
                              <SynergyStatInline stats={stackRow.stats} />
                            </>
                          )}
                        </For>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            <Show when={shipSynergy().pair.length > 0} fallback={<div class="rounded-lg border border-dashed border-base-300 px-3 py-4 text-sm text-base-content/50">この艦に設定された装備組み合わせシナジーはありません</div>}>
              <div class="rounded-lg border border-base-300/70 p-2">
                <h5 class="text-sm font-medium mb-2">装備組み合わせシナジー</h5>
                <div class={`grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-2 pr-1 ${props.expandPairSynergy ? "" : "max-h-[30vh] overflow-y-auto"}`}>
                  <For each={shipSynergy().pair.slice(0, 80)}>
                    {(row) => (
                      <div class="rounded border border-base-300/70 p-2 space-y-1">
                        <div class="flex flex-wrap items-center gap-1.5 text-xs text-base-content/70">
                          <button class="inline-flex items-center gap-1 min-w-0 hover:underline" onClick={() => props.onOpenEquip(row.a.id)} title={row.a.name}>
                            <span class="inline-flex w-5 h-5 items-center justify-center rounded bg-base-200/70 shrink-0">
                              <WeaponIcon iconNum={row.a.type?.[3] ?? 0} />
                            </span>
                            <span class="truncate max-w-40">{row.a.name}</span>
                          </button>
                          <span>+</span>
                          <button class="inline-flex items-center gap-1 min-w-0 hover:underline" onClick={() => props.onOpenEquip(row.b.id)} title={row.b.name}>
                            <span class="inline-flex w-5 h-5 items-center justify-center rounded bg-base-200/70 shrink-0">
                              <WeaponIcon iconNum={row.b.type?.[3] ?? 0} />
                            </span>
                            <span class="truncate max-w-40">{row.b.name}</span>
                          </button>
                        </div>
                        <SynergyStatInline stats={row.stats} />
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>
        </section>
      </div>
    </article>
  );
}

function EquipDetailPanel(props: {
  equip: MstSlotItemData;
  onOpenShip: (shipId: number) => void;
  onOpenEquip: (equipId: number) => void;
  expandSynergyShips: boolean;
  expandCompatibleShips: boolean;
}): JSX.Element {
  const equipSynergyShips = createMemo(() => {
    const effects = getSlotItemEffects();
    if (!effects) return [] as Array<{
      ship: MstShipData;
      base: Record<string, number> | null;
      star10: Record<string, number> | null;
      c2: Record<string, number> | null;
      c3: Record<string, number> | null;
      partners: Array<{ equip: MstSlotItemData; stats: Record<string, number> }>;
    }>;

    const singleEntries = effects.effects[String(props.equip.id)] ?? [];
    const crossEntries = Object.values(effects.cross_effects)
      .flat()
      .filter((entry) => entry.items[0] === props.equip.id || entry.items[1] === props.equip.id);

    const rows: Array<{
      ship: MstShipData;
      base: Record<string, number> | null;
      star10: Record<string, number> | null;
      c2: Record<string, number> | null;
      c3: Record<string, number> | null;
      partners: Array<{ equip: MstSlotItemData; stats: Record<string, number> }>;
    }> = [];

    for (const ship of Object.values(getMasterShips())) {
      if (ship.id >= ENEMY_ID_THRESHOLD) continue;

      const single = singleEntries.find((entry) => entry.ships.includes(ship.id));
      const partners = crossEntries
        .filter((entry) => entry.ships.includes(ship.id))
        .map((entry) => {
          const partnerId = entry.items[0] === props.equip.id ? entry.items[1] : entry.items[0];
          const partnerEquip = getMasterSlotItem(partnerId);
          if (!partnerEquip || partnerEquip.id >= ENEMY_ID_THRESHOLD || scoreSynergy(entry.synergy) === 0) return null;
          return { equip: partnerEquip, stats: entry.synergy };
        })
        .filter((x): x is { equip: MstSlotItemData; stats: Record<string, number> } => x != null)
        .sort((a, b) => scoreSynergy(b.stats) - scoreSynergy(a.stats));

      const hasSingle = single && (scoreSynergy(single.b) > 0 || scoreSynergy(single.l) > 0 || scoreSynergy(single.c2) > 0 || scoreSynergy(single.c3) > 0);
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

    rows.sort((a, b) => (a.ship.sort_id ?? a.ship.id) - (b.ship.sort_id ?? b.ship.id));
    return rows;
  });

  const compatibleShips = createMemo(() => {
    const ships = Object.values(getMasterShips())
      .filter((ship) => ship.id < ENEMY_ID_THRESHOLD)
      .sort((a, b) => (a.sort_id ?? a.id) - (b.sort_id ?? b.id));

    const rows = ships
      .map((ship) => ({ ship, compat: getCompatibilityMeta(ship, props.equip) }))
      .filter((row) => row.compat.normalSlots.length > 0 || row.compat.exslot != null);

    return groupBy(rows, (row) => STYPE_NAMES[row.ship.stype] ?? `艦種${row.ship.stype}`);
  });

  const specRows = createMemo<Array<[label: string, value: string | number]>>(() => {
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
  });

  return (
    <article class="rounded-2xl border border-base-300/70 bg-base-100 shadow-sm overflow-hidden">
      <div class="px-4 py-3 border-b border-base-200 bg-linear-to-r from-accent/10 to-transparent">
        <h2 class="font-semibold">装備詳細</h2>
      </div>

      <div class="p-4 space-y-4">
        <div class="grid grid-cols-1 xl:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)] gap-4 items-stretch">
          <div class="relative rounded-2xl border border-base-300/70 bg-linear-to-b from-base-200 to-base-100 p-3 min-h-64 h-full xl:max-w-sm flex items-end justify-center overflow-hidden">
            <ImageFallbackBox
              src={equipImageUrl(props.equip.id)}
              alt={props.equip.name}
              class="w-full h-56"
              objectClass="w-full h-full object-contain object-center"
              fallbackText="No Image"
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

        <section>
          <h4 class="font-medium mb-2">この装備のシナジー対象艦</h4>
          <Show when={equipSynergyShips().length > 0} fallback={<div class="rounded-lg border border-dashed border-base-300 px-3 py-6 text-sm text-base-content/50 text-center">この装備に設定されたシナジー対象艦はありません</div>}>
            <div class={`grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-2 pr-1 mb-4 ${props.expandSynergyShips ? "" : "max-h-[36vh] overflow-y-auto"}`}>
              <For each={equipSynergyShips()}>
                {(row) => (
                  <div
                    class="w-full flex flex-col rounded-lg border border-base-300/70 p-2 hover:border-primary/45 transition"
                  >
                    <button
                      class="flex items-center gap-2 min-w-0 w-full text-left hover:underline"
                      onClick={() => props.onOpenShip(row.ship.id)}
                      title={row.ship.name}
                    >
                      <ImageFallbackBox
                        src={bannerUrl(row.ship.id)}
                        alt={row.ship.name}
                        class="w-20 h-6 rounded shrink-0"
                        fallbackText="No Image"
                      />
                      <span class="text-sm font-medium truncate">{row.ship.name}</span>
                    </button>

                    <Show when={row.base != null && scoreSynergy(row.base ?? undefined) > 0}>
                      <div class="mt-2 text-xs text-base-content/70 inline-flex items-center h-5">単体シナジー</div>
                      <SynergyStatInline stats={row.base!} />
                    </Show>
                    <Show when={row.star10 != null && scoreSynergy(row.star10 ?? undefined) > 0}>
                      <div class="mt-1 text-xs text-base-content/70 inline-flex items-center h-5">改修★10</div>
                      <SynergyStatInline stats={row.star10!} />
                    </Show>
                    <For each={stackingSynergyRows(row.c2, row.c3)}>
                      {(stackRow) => (
                        <>
                          <div class="mt-1 text-xs text-base-content/70 inline-flex items-center h-5">{stackRow.label}</div>
                          <SynergyStatInline stats={stackRow.stats} />
                        </>
                      )}
                    </For>

                    <Show when={row.partners.length > 0}>
                      <div class="mt-2 text-xs font-medium text-base-content/60 inline-flex items-center h-5">他装備組み合わせ</div>
                      <div class="space-y-1 mt-1">
                        <For each={row.partners.slice(0, 8)}>
                          {(partner) => (
                            <div class="rounded border border-base-300/70 p-1.5">
                              <div class="flex flex-wrap items-center gap-1.5 text-xs text-base-content/70">
                                <button class="inline-flex items-center gap-1 min-w-0 hover:underline" onClick={() => props.onOpenEquip(props.equip.id)} title={props.equip.name}>
                                  <span class="inline-flex w-5 h-5 items-center justify-center rounded bg-base-200/70 shrink-0">
                                    <WeaponIcon iconNum={props.equip.type?.[3] ?? 0} />
                                  </span>
                                  <span class="truncate max-w-40">{props.equip.name}</span>
                                </button>
                                <span>+</span>
                                <button class="inline-flex items-center gap-1 min-w-0 hover:underline" onClick={() => props.onOpenEquip(partner.equip.id)} title={partner.equip.name}>
                                  <span class="inline-flex w-5 h-5 items-center justify-center rounded bg-base-200/70 shrink-0">
                                    <WeaponIcon iconNum={partner.equip.type?.[3] ?? 0} />
                                  </span>
                                  <span class="truncate max-w-40">{partner.equip.name}</span>
                                </button>
                              </div>
                              <SynergyStatInline stats={partner.stats} />
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>

        </section>

        <section>
          <h4 class="font-medium mb-2">装備可能な艦</h4>
          <p class="text-xs text-base-content/55 mb-2">
            補強増設の装備条件は表示しています。改修値が必要な条件は「補強枠条件」に併記します。
          </p>
          <div class={`space-y-3 pr-1 ${props.expandCompatibleShips ? "" : "max-h-[40vh] overflow-y-auto"}`}>
            <For each={compatibleShips()}>
              {(group) => (
                <div class="rounded-lg border border-base-300/70 p-2">
                  <h5 class="text-sm font-medium mb-2">{group.key}</h5>
                  <div class="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-1.5">
                    <For each={group.items}>
                      {(row) => {
                        return (
                          <button
                            class="w-full text-left rounded border border-base-300/70 hover:border-primary/45 px-2 py-1.5 transition"
                            onClick={() => props.onOpenShip(row.ship.id)}
                            title={row.ship.name}
                          >
                            <div class="flex items-center gap-2 min-w-0">
                              <ImageFallbackBox
                                src={bannerUrl(row.ship.id)}
                                alt={row.ship.name}
                                class="w-20 h-6 rounded shrink-0"
                                fallbackText="No Image"
                              />
                              <span class="text-xs truncate flex-1">{row.ship.name}</span>
                              <CompatibilityBadges
                                normalSlots={row.compat.normalSlots}
                                slotCount={row.ship.slot_num}
                                exslot={row.compat.exslot}
                              />
                            </div>
                            <Show when={row.compat.exslot != null && (row.compat.exslot.level > 0 || row.compat.exslot.alv > 0)}>
                              <p class="text-[10px] text-warning mt-1">
                                {`補強枠条件: ${[
                                  row.compat.exslot!.level > 0 ? `改修★${row.compat.exslot!.level}` : null,
                                  row.compat.exslot!.alv > 0 ? `熟練${row.compat.exslot!.alv}` : null,
                                ].filter(Boolean).join(" / ")}`}
                              </p>
                            </Show>
                          </button>
                        );
                      }}
                    </For>
                  </div>
                </div>
              )}
            </For>
            <Show when={compatibleShips().length === 0}>
              <div class="rounded-lg border border-dashed border-base-300 px-3 py-6 text-sm text-base-content/50 text-center">
                装備可能な艦はありません
              </div>
            </Show>
          </div>
        </section>
      </div>
    </article>
  );
}

function SimulatorDetailsCatalog(): JSX.Element {
  const [tab, setTab] = createSignal<DetailsTab>("ship");
  const [shipQuery, setShipQuery] = createSignal("");
  const [equipQuery, setEquipQuery] = createSignal("");
  const [selectedShipCategory, setSelectedShipCategory] = createSignal("all");
  const [selectedEquipCategory, setSelectedEquipCategory] = createSignal("all");
  const [selectedShipId, setSelectedShipId] = createSignal<number | null>(null);
  const [selectedEquipId, setSelectedEquipId] = createSignal<number | null>(null);
  const [expandSettings, setExpandSettings] = createSignal<ListExpandSettings>(DEFAULT_EXPAND_SETTINGS);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  let settingsDialogRef!: HTMLDialogElement;
  const [helpOpen, setHelpOpen] = createSignal(false);
  let helpDialogRef!: HTMLDialogElement;

  const allExpanded = createMemo(() => Object.values(expandSettings()).every(Boolean));

  createEffect(() => {
    if (settingsOpen()) settingsDialogRef.showModal();
    else settingsDialogRef.close();
  });

  createEffect(() => {
    if (helpOpen()) helpDialogRef.showModal();
    else helpDialogRef.close();
  });

  const allShips = createMemo(() =>
    Object.values(getMasterShips())
      .filter((ship) => ship.id < ENEMY_ID_THRESHOLD)
      .sort((a, b) => (a.sort_id ?? a.id) - (b.sort_id ?? b.id)),
  );

  const allEquips = createMemo(() =>
    Object.values(getMasterSlotItems())
      .filter((equip) => equip.id < ENEMY_ID_THRESHOLD)
      .sort((a, b) => a.sortno - b.sortno),
  );

  const shipCategories = createMemo(() =>
    [...new Set(allShips().map((ship) => STYPE_NAMES[ship.stype] ?? `艦種${ship.stype}`))]
      .sort((a, b) => a.localeCompare(b, "ja")),
  );

  const equipCategories = createMemo(() =>
    [...new Set(allEquips().map((equip) => equipDisplayTypeName(equip)))]
      .sort((a, b) => a.localeCompare(b, "ja")),
  );

  const filteredShips = createMemo(() => {
    const selectedCategory = selectedShipCategory();
    const q = shipQuery().trim().toLowerCase();
    return allShips().filter((ship) => {
      const category = STYPE_NAMES[ship.stype] ?? `艦種${ship.stype}`;
      if (selectedCategory !== "all" && category !== selectedCategory) return false;
      if (!q) return true;
      return ship.name.toLowerCase().includes(q) || String(ship.id).includes(q);
    });
  });

  const filteredEquips = createMemo(() => {
    const selectedCategory = selectedEquipCategory();
    const q = equipQuery().trim().toLowerCase();
    return allEquips().filter((equip) => {
      const category = equipDisplayTypeName(equip);
      if (selectedCategory !== "all" && category !== selectedCategory) return false;
      if (!q) return true;
      return equip.name.toLowerCase().includes(q) || String(equip.id).includes(q);
    });
  });

  const selectedShip = createMemo(() => {
    const id = selectedShipId();
    return id == null ? null : getMasterShip(id);
  });

  const selectedEquip = createMemo(() => {
    const id = selectedEquipId();
    return id == null ? null : getMasterSlotItem(id);
  });

  const groupedShips = createMemo(() =>
    groupBy(filteredShips(), (ship) => STYPE_NAMES[ship.stype] ?? `艦種${ship.stype}`),
  );

  const groupedEquips = createMemo(() =>
    groupBy(filteredEquips(), (equip) => equipDisplayTypeName(equip)),
  );

  function parsePositiveInt(raw: string | null): number | null {
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) return null;
    return value;
  }

  async function copyTextWithFallback(text: string): Promise<boolean> {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  function buildCurrentShareUrl(): string | null {
    const currentTab = tab();
    const currentShipId = selectedShipId();
    const currentEquipId = selectedEquipId();
    const key = currentTab === "ship"
      ? (currentShipId != null ? `ship:${currentShipId}` : null)
      : (currentEquipId != null ? `equip:${currentEquipId}` : null);
    if (!key) return null;

    const shareUrl = new URL("/simulator/d", window.location.origin);
    shareUrl.searchParams.set("key", key);
    return shareUrl.toString();
  }

  async function issueShareUrl(): Promise<void> {
    const shareUrl = buildCurrentShareUrl();
    if (!shareUrl) {
      alert("共有URLを生成できませんでした。艦または装備を選択してください。");
      return;
    }

    const copied = await copyTextWithFallback(shareUrl);
    if (copied) {
      alert("共有URLをクリップボードにコピーしました");
      return;
    }

    window.prompt("自動コピーに失敗しました。以下を手動でコピーしてください:", shareUrl);
  }

  createEffect(() => {
    if (selectedShipId() == null && allShips().length > 0) {
      setSelectedShipId(allShips()[0].id);
    }
    if (selectedEquipId() == null && allEquips().length > 0) {
      setSelectedEquipId(allEquips()[0].id);
    }
  });

  createEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialTab = params.get("tab");
    if (initialTab === "ship" || initialTab === "equip") {
      setTab(initialTab);
    }

    const shipFromQuery = parsePositiveInt(params.get("ship"));
    if (shipFromQuery != null && getMasterShip(shipFromQuery)) {
      setSelectedShipId(shipFromQuery);
    }

    const equipFromQuery = parsePositiveInt(params.get("equip"));
    if (equipFromQuery != null && getMasterSlotItem(equipFromQuery)) {
      setSelectedEquipId(equipFromQuery);
    }
  });

  createEffect(() => {
    const currentTab = tab();
    const currentShipId = selectedShipId();
    const currentEquipId = selectedEquipId();
    const url = new URL(window.location.href);
    url.searchParams.set("tab", currentTab);

    if (currentTab === "ship" && currentShipId != null) {
      url.searchParams.set("ship", String(currentShipId));
    } else {
      url.searchParams.delete("ship");
    }

    if (currentTab === "equip" && currentEquipId != null) {
      url.searchParams.set("equip", String(currentEquipId));
    } else {
      url.searchParams.delete("equip");
    }

    window.history.replaceState(window.history.state, "", url.toString());
  });

  return (
    <div class="space-y-4">
      <div class="rounded-xl border border-base-300/70 bg-base-100 p-2 flex flex-wrap gap-1.5">
        <a href="/simulator" class="btn btn-sm btn-outline">艦隊シミュレータ</a>
        <button class={`btn btn-sm ${tab() === "ship" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("ship")}>艦詳細</button>
        <button class={`btn btn-sm ${tab() === "equip" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("equip")}>装備詳細</button>
        <button class="btn btn-sm btn-ghost gap-1.5 ml-auto" onClick={() => { void issueShareUrl(); }}>
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
          共有URL
        </button>
        <button class="btn btn-sm btn-ghost gap-1.5" onClick={() => setSettingsOpen(true)}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          ><path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M10.325 4.317a1 1 0 011.35-.936l.964.429a1 1 0 00.88 0l.964-.429a1 1 0 011.35.936l.093 1.053a1 1 0 00.516.79l.9.52a1 1 0 01.364 1.365l-.53.918a1 1 0 000 .998l.53.918a1 1 0 01-.364 1.365l-.9.52a1 1 0 00-.516.79l-.093 1.053a1 1 0 01-1.35.936l-.964-.429a1 1 0 00-.88 0l-.964.429a1 1 0 01-1.35-.936l-.093-1.053a1 1 0 00-.516-.79l-.9-.52a1 1 0 01-.364-1.365l.53-.918a1 1 0 000-.998l-.53-.918a1 1 0 01.364-1.365l.9-.52a1 1 0 00.516-.79l.093-1.053z"
            ></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9a3 3 0 100 6 3 3 0 000-6z"></path></svg>
          表示設定
        </button>
        <button class="btn btn-sm btn-ghost gap-1.5" onClick={() => setHelpOpen(true)}>
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          使い方
        </button>
      </div>

      <dialog ref={settingsDialogRef} class="modal" onClose={() => setSettingsOpen(false)}>
        <div class="modal-box rounded-xl">
          <h3 class="font-bold text-lg mb-1">表示設定</h3>
          <p class="text-xs text-base-content/60 mb-4">各リストをスクロールなしで全件表示するかどうかを設定します。</p>
          <div class="space-y-3 text-sm">
            <label class="label w-full cursor-pointer justify-start gap-3 py-1">
              <input
                type="checkbox"
                class="checkbox checkbox-sm shrink-0"
                checked={allExpanded()}
                onChange={(e) => setExpandSettings({
                  expandEquippableEquip: e.currentTarget.checked,
                  expandSingleSynergy: e.currentTarget.checked,
                  expandPairSynergy: e.currentTarget.checked,
                  expandSynergyShips: e.currentTarget.checked,
                  expandCompatibleShips: e.currentTarget.checked,
                })}
              />
              <span class="label-text font-medium">すべてのリストを展開</span>
            </label>
            <p class="text-xs text-base-content/50 font-medium pt-1">艦詳細</p>
            <label class="label w-full cursor-pointer justify-start gap-3 py-1 pl-1">
              <input type="checkbox" class="checkbox checkbox-sm shrink-0"
                checked={expandSettings().expandEquippableEquip}
                onChange={(e) => setExpandSettings((prev) => ({ ...prev, expandEquippableEquip: e.currentTarget.checked }))}
              />
              <span class="label-text">装備可能な装備</span>
            </label>
            <label class="label w-full cursor-pointer justify-start gap-3 py-1 pl-1">
              <input type="checkbox" class="checkbox checkbox-sm shrink-0"
                checked={expandSettings().expandSingleSynergy}
                onChange={(e) => setExpandSettings((prev) => ({ ...prev, expandSingleSynergy: e.currentTarget.checked }))}
              />
              <span class="label-text">単体装備シナジー</span>
            </label>
            <label class="label w-full cursor-pointer justify-start gap-3 py-1 pl-1">
              <input type="checkbox" class="checkbox checkbox-sm shrink-0"
                checked={expandSettings().expandPairSynergy}
                onChange={(e) => setExpandSettings((prev) => ({ ...prev, expandPairSynergy: e.currentTarget.checked }))}
              />
              <span class="label-text">装備組み合わせシナジー</span>
            </label>
            <p class="text-xs text-base-content/50 font-medium pt-1">装備詳細</p>
            <label class="label w-full cursor-pointer justify-start gap-3 py-1 pl-1">
              <input type="checkbox" class="checkbox checkbox-sm shrink-0"
                checked={expandSettings().expandSynergyShips}
                onChange={(e) => setExpandSettings((prev) => ({ ...prev, expandSynergyShips: e.currentTarget.checked }))}
              />
              <span class="label-text">シナジー対象艦</span>
            </label>
            <label class="label w-full cursor-pointer justify-start gap-3 py-1 pl-1">
              <input type="checkbox" class="checkbox checkbox-sm shrink-0"
                checked={expandSettings().expandCompatibleShips}
                onChange={(e) => setExpandSettings((prev) => ({ ...prev, expandCompatibleShips: e.currentTarget.checked }))}
              />
              <span class="label-text">装備可能な艦</span>
            </label>
          </div>
          <div class="modal-action">
            <button class="btn btn-primary btn-sm" onClick={() => setSettingsOpen(false)}>閉じる</button>
          </div>
        </div>
        <form method="dialog" class="modal-backdrop"><button>close</button></form>
      </dialog>

      <dialog ref={helpDialogRef} class="modal" onClose={() => setHelpOpen(false)}>
        <div class="modal-box rounded-xl max-w-2xl max-h-[82vh] overflow-y-auto">
          <h3 class="font-bold text-lg mb-4">使い方 / 表示の見かた</h3>

          <section class="mb-5">
            <h4 class="font-semibold text-sm mb-2 text-base-content/80">ページ概要</h4>
            <p class="text-sm text-base-content/70 leading-relaxed">
              艦・装備のマスターデータを検索・閲覧できます。<strong>艦詳細</strong>タブでは艦のステータス・搭載可能装備・装備シナジーを、<strong>装備詳細</strong>タブでは装備のステータス・シナジー対象艦・装備可能艦を確認できます。
            </p>
          </section>

          <section class="mb-5">
            <h4 class="font-semibold text-sm mb-2 text-base-content/80">表示ラベルの規則</h4>
            <div class="overflow-x-auto rounded-lg border border-base-300/70">
              <table class="table table-sm w-full text-sm">
                <thead>
                  <tr class="text-base-content/60">
                    <th class="w-32">ラベル</th>
                    <th>意味</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class="font-medium">基本</td>
                    <td class="text-base-content/70">★0 で1枠装備したときの追加ステータス</td>
                  </tr>
                  <tr>
                    <td class="font-medium">改修★10</td>
                    <td class="text-base-content/70">★10 で1枠装備したときのボーナス（基本と値が異なる場合のみ表示）</td>
                  </tr>
                  <tr>
                    <td class="font-medium">2積み</td>
                    <td class="text-base-content/70">同じ装備を2枠装備したときの<strong>合計</strong>ボーナス（単純に 基本×2 と異なる場合のみ表示）</td>
                  </tr>
                  <tr>
                    <td class="font-medium">3積み以上</td>
                    <td class="text-base-content/70">同じ装備を3枠以上装備したときの合計ボーナス（2積みと値が異なる場合のみ表示）</td>
                  </tr>
                  <tr>
                    <td class="font-medium">2積み以上</td>
                    <td class="text-base-content/70">2積みと3積みで合計ボーナスが同じとき、まとめて表示</td>
                  </tr>
                  <tr>
                    <td>
                      <span class="badge badge-outline badge-sm font-mono border-info/55 text-info">対空+2</span>
                    </td>
                    <td class="text-base-content/70">青バッジ — バフ（プラス効果）</td>
                  </tr>
                  <tr>
                    <td>
                      <span class="badge badge-outline badge-sm font-mono border-error/45 text-error">対空-2</span>
                    </td>
                    <td class="text-base-content/70">赤バッジ — デバフ（マイナス効果）</td>
                  </tr>
                  <tr>
                    <td>
                      <span class="badge badge-warning badge-xs">補強のみ</span>
                    </td>
                    <td class="text-base-content/70">補強増設スロットにのみ装備可能</td>
                  </tr>
                  <tr>
                    <td>
                      <span class="badge badge-outline badge-xs border-warning text-warning">補強★5</span>
                    </td>
                    <td class="text-base-content/70">補強増設スロットへの装備に改修値またはそうていが必要</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="mb-5">
            <h4 class="font-semibold text-sm mb-3 text-base-content/80">装備シナジーの計算方法</h4>
            <div class="space-y-3 text-sm text-base-content/70 leading-relaxed">
              <p>
                装備によるステータス増減は <strong>単体装備シナジー</strong> と <strong>装備組み合わせシナジー</strong> の2種類があり、それらの合計が実際の効果です。
              </p>
              <div class="rounded-lg bg-base-200 border border-base-300/70 px-4 py-3 font-mono text-xs text-center">
                合計効果 ＝ Σ（単体シナジー） ＋ Σ（組み合わせシナジー）
              </div>
              <ul class="space-y-1 list-disc list-inside text-base-content/65">
                <li><strong>単体装備シナジー</strong>：その装備を1枠でも持つだけで発動するボーナス</li>
                <li><strong>装備組み合わせシナジー</strong>：特定の2種類を同時装備したときに加算される追加効果（単体シナジーとは独立して加減算される）</li>
              </ul>
            </div>
          </section>

          <section class="mb-5">
            <h4 class="font-semibold text-sm mb-3 text-base-content/80">計算例</h4>
            <div class="space-y-4 text-sm">

              <div class="rounded-lg border border-base-300/70 p-3">
                <p class="font-medium mb-2">例1 — 単体バフ ＋ 組み合わせバフ</p>
                <div class="space-y-1 text-base-content/70">
                  <p>装備A（単体シナジー: <span class="badge badge-outline badge-sm font-mono border-info/55 text-info">対空+3</span>）と 装備B（単体シナジー: なし）を同時装備</p>
                  <p>組み合わせシナジー A＋B: <span class="badge badge-outline badge-sm font-mono border-info/55 text-info">対空+2</span></p>
                  <p class="mt-2 font-medium text-base-content">→ 対空ボーナス合計 ＝ +3（単体A）＋ 0（単体B）＋ +2（組み合わせ）＝ <span class="text-info">+5</span></p>
                </div>
              </div>

              <div class="rounded-lg border border-base-300/70 p-3">
                <p class="font-medium mb-2">例2 — 組み合わせシナジーがデバフ（赤）の場合</p>
                <div class="space-y-1 text-base-content/70">
                  <p>装備X（単体シナジー: <span class="badge badge-outline badge-sm font-mono border-info/55 text-info">対空+4</span>）と 装備Z（単体シナジー: <span class="badge badge-outline badge-sm font-mono border-info/55 text-info">対空+1</span>）を同時装備</p>
                  <p>組み合わせシナジー X＋Z: <span class="badge badge-outline badge-sm font-mono border-error/45 text-error">対空-2</span></p>
                  <p class="mt-2 font-medium text-base-content">→ 対空ボーナス合計 ＝ +4（単体X）＋ +1（単体Z）＋ (−2)（組み合わせ）＝ <span class="text-info">+3</span></p>
                  <p class="text-xs text-base-content/55 mt-1">組み合わせが赤（デバフ）でも単体シナジーは別途有効。単体の+効果が完全に消えるわけではない。</p>
                </div>
              </div>

              <div class="rounded-lg border border-base-300/70 p-3">
                <p class="font-medium mb-2">例3 — 2積みシナジーの読み方（表示値 ＝ <em>合計</em>）</p>
                <div class="space-y-1 text-base-content/70">
                  <p>装備Wの単体シナジー</p>
                  <p class="pl-3">基本: <span class="badge badge-outline badge-sm font-mono border-info/55 text-info">対空+3</span></p>
                  <p class="pl-3">2積み: <span class="badge badge-outline badge-sm font-mono border-info/55 text-info">対空+4</span>　← これは2枠装備時の<strong>合計</strong>ボーナス</p>
                  <div class="mt-2 space-y-0.5 font-medium text-base-content">
                    <p>1枠装備時の対空ボーナス ＝ <span class="text-info">+3</span></p>
                    <p>2枠装備時の対空ボーナス ＝ <span class="text-info">+4</span>（単純な 2×3＝+6 にはならない）</p>
                    <p>2枠目の追加分 ＝ +4 − +3 ＝ <span class="text-base-content/70">+1 のみ</span></p>
                  </div>
                </div>
              </div>

              <div class="rounded-lg border border-base-300/70 p-3">
                <p class="font-medium mb-2">例4 — 2積みと3積みでシナジーが異なる場合</p>
                <div class="space-y-1 text-base-content/70">
                  <p>基本: <span class="badge badge-outline badge-sm font-mono border-info/55 text-info">火力+1</span>　2積み: <span class="badge badge-outline badge-sm font-mono border-info/55 text-info">火力+3</span>　3積み以上: <span class="badge badge-outline badge-sm font-mono border-info/55 text-info">火力+4</span></p>
                  <div class="mt-2 space-y-0.5 font-medium text-base-content">
                    <p>1枠: <span class="text-info">+1</span>　／　2枠: <span class="text-info">+3</span>（2枠目の追加 +2）　／　3枠以上: <span class="text-info">+4</span>（3枠目の追加 +1）</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div class="modal-action">
            <button class="btn btn-primary btn-sm" onClick={() => setHelpOpen(false)}>閉じる</button>
          </div>
        </div>
        <form method="dialog" class="modal-backdrop"><button>close</button></form>
      </dialog>

      <Show when={tab() === "ship"}>
        <section class="grid grid-cols-1 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-4 items-start">
          <aside class="rounded-2xl border border-base-300/70 bg-base-100 shadow-sm overflow-hidden">
            <div class="p-3 border-b border-base-200 bg-base-50/50 space-y-2">
              <select
                class="select select-bordered select-sm w-full"
                value={selectedShipCategory()}
                onChange={(event) => setSelectedShipCategory(event.currentTarget.value)}
              >
                <option value="all">すべての艦種</option>
                <For each={shipCategories()}>
                  {(category) => <option value={category}>{category}</option>}
                </For>
              </select>
              <input
                class="input input-bordered input-sm w-full"
                placeholder="艦名 / ID で検索"
                value={shipQuery()}
                onInput={(event) => setShipQuery(event.currentTarget.value)}
              />
            </div>
            <div class="p-2 max-h-[74vh] overflow-y-auto">
              <For each={groupedShips()}>
                {(group) => (
                  <section class="mb-2 last:mb-0">
                    <h4 class="px-2.5 py-1 text-[11px] font-semibold tracking-wide text-base-content/45 uppercase sticky top-0 bg-base-100/95 backdrop-blur-sm z-10">
                      {group.key}
                    </h4>
                    <div>
                      <For each={group.items}>
                        {(ship) => (
                          <ShipListRow
                            ship={ship}
                            active={selectedShipId() === ship.id}
                            onSelect={() => setSelectedShipId(ship.id)}
                          />
                        )}
                      </For>
                    </div>
                  </section>
                )}
              </For>
            </div>
          </aside>

          <Show when={selectedShip()} fallback={<div class="rounded-2xl border border-base-300/70 bg-base-100 p-4 text-base-content/50">艦を選択してください。</div>}>
            {(ship) => (
              <ShipDetailPanel
                ship={ship()}
                onOpenEquip={(equipId) => {
                  setSelectedEquipId(equipId);
                  setTab("equip");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                expandEquippableEquip={expandSettings().expandEquippableEquip}
                expandSingleSynergy={expandSettings().expandSingleSynergy}
                expandPairSynergy={expandSettings().expandPairSynergy}
              />
            )}
          </Show>
        </section>
      </Show>

      <Show when={tab() === "equip"}>
        <section class="grid grid-cols-1 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-4 items-start">
          <aside class="rounded-2xl border border-base-300/70 bg-base-100 shadow-sm overflow-hidden">
            <div class="p-3 border-b border-base-200 bg-base-50/50 space-y-2">
              <select
                class="select select-bordered select-sm w-full"
                value={selectedEquipCategory()}
                onChange={(event) => setSelectedEquipCategory(event.currentTarget.value)}
              >
                <option value="all">すべての装備種別</option>
                <For each={equipCategories()}>
                  {(category) => <option value={category}>{category}</option>}
                </For>
              </select>
              <input
                class="input input-bordered input-sm w-full"
                placeholder="装備名 / ID で検索"
                value={equipQuery()}
                onInput={(event) => setEquipQuery(event.currentTarget.value)}
              />
            </div>
            <div class="p-2 max-h-[74vh] overflow-y-auto">
              <For each={groupedEquips()}>
                {(group) => (
                  <section class="mb-2 last:mb-0">
                    <h4 class="px-2.5 py-1 text-[11px] font-semibold tracking-wide text-base-content/45 uppercase sticky top-0 bg-base-100/95 backdrop-blur-sm z-10">
                      {group.key}
                    </h4>
                    <div>
                      <For each={group.items}>
                        {(equip) => (
                          <EquipListRow
                            equip={equip}
                            active={selectedEquipId() === equip.id}
                            onSelect={() => setSelectedEquipId(equip.id)}
                          />
                        )}
                      </For>
                    </div>
                  </section>
                )}
              </For>
            </div>
          </aside>

          <Show when={selectedEquip()} fallback={<div class="rounded-2xl border border-base-300/70 bg-base-100 p-4 text-base-content/50">装備を選択してください。</div>}>
            {(equip) => (
              <EquipDetailPanel
                equip={equip()}
                onOpenShip={(shipId) => {
                  setSelectedShipId(shipId);
                  setTab("ship");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                onOpenEquip={(equipId) => {
                  setSelectedEquipId(equipId);
                  setTab("equip");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                expandSynergyShips={expandSettings().expandSynergyShips}
                expandCompatibleShips={expandSettings().expandCompatibleShips}
              />
            )}
          </Show>
        </section>
      </Show>
    </div>
  );
}

export function mountSimulatorDetailsCatalog(root: HTMLElement): void {
  render(() => <SimulatorDetailsCatalog />, root);
}
