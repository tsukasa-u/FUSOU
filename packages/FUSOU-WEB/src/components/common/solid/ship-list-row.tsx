/** @jsxImportSource solid-js */

import type { JSX } from "solid-js";
import { Show, createSignal, createEffect } from "solid-js";
import { bannerUrl } from "@/features/simulator/equip-calc";
import { STYPE_NAMES } from "@/features/simulator/constants";
import { StatPill } from "@/components/features/simulator/solid/shared-ui";

export type ShipListItem = {
  id: number;
  name: string;
  stype?: number | null;
  houg?: number[] | null;
  raig?: number[] | null;
  tyku?: number[] | null;
  souk?: number[] | null;
};

export function ShipListRow(props: {
  ship: ShipListItem;
  active: boolean;
  onSelect: () => void;
  subtitle?: string;
  showStatLabels?: boolean;
  showStats?: boolean;
}): JSX.Element {
  const shipMetaLabel = () => {
    const stypeLabel =
      props.ship.stype != null
        ? (STYPE_NAMES[props.ship.stype] ?? `艦種${props.ship.stype}`)
        : null;
    return stypeLabel ? `${stypeLabel} ID ${props.ship.id}` : `ID ${props.ship.id}`;
  };

  const defaultSubtitle = () => {
    const stypeLabel = props.ship.stype != null ? (STYPE_NAMES[props.ship.stype] ?? `艦種${props.ship.stype}`) : null;
    return stypeLabel ? `ID ${props.ship.id} / ${stypeLabel}` : `ID ${props.ship.id}`;
  };

  const imgSrc = () => bannerUrl(props.ship.id, { f: "auto" });
  const [imgErrored, setImgErrored] = createSignal(!imgSrc());
  createEffect(() => {
    setImgErrored(!imgSrc());
  });

  return (
    <button
      class={`w-full h-[52px] flex items-center gap-2 px-2.5 py-2 rounded-lg transition border overflow-hidden ${
        props.active
          ? "bg-primary/12 border-primary/35"
          : "hover:bg-primary/8 active:bg-primary/15 border-transparent"
      }`}
      aria-label={`${props.ship.name} ID ${props.ship.id}`}
      onClick={props.onSelect}
    >
      <Show
        when={!imgErrored()}
        fallback={
          <div class="w-28 h-8 rounded shrink-0 bg-base-200 flex items-center justify-center">
            <span class="text-[10px] font-bold tracking-wide text-base-content/45">No Image</span>
          </div>
        }
      >
        <img
          src={imgSrc()}
          alt={props.ship.name}
          class="w-28 h-8 rounded shrink-0 object-cover"
          loading="lazy"
          onError={() => setImgErrored(true)}
        />
      </Show>
      <div class="min-w-0 text-left">
        <p class="text-sm leading-tight truncate font-medium" title={props.ship.name}>{props.ship.name}</p>
        <div class="text-[11px] text-base-content/45 leading-tight mt-0.5 min-w-0 flex items-center gap-1.5 whitespace-nowrap">
          <span class="truncate min-w-0 inline flex-1 md:hidden">{shipMetaLabel()}</span>
          <span class="hidden md:inline truncate min-w-0 flex-1">{props.subtitle ?? defaultSubtitle()}</span>
          <Show when={props.showStats ?? true}>
            <span class="inline-flex items-center gap-1 shrink-0 md:hidden">
              <StatPill label="火" value={props.ship.houg?.[0]} tone="fire" showLabel={props.showStatLabels ?? true} hideLabelOnTiny />
              <StatPill label="雷" value={props.ship.raig?.[0]} tone="torpedo" showLabel={props.showStatLabels ?? true} hideLabelOnTiny />
              <StatPill label="空" value={props.ship.tyku?.[0]} tone="aa" showLabel={props.showStatLabels ?? true} hideLabelOnTiny />
              <StatPill label="装" value={props.ship.souk?.[0]} tone="armor" showLabel={props.showStatLabels ?? true} hideLabelOnTiny />
            </span>
          </Show>
        </div>
      </div>
      <Show when={props.showStats ?? true}>
        <div class="ml-auto hidden shrink-0 items-center justify-end gap-1 whitespace-nowrap overflow-hidden text-right min-w-0 max-w-48 md:flex">
          <StatPill label="火" value={props.ship.houg?.[0]} tone="fire" showLabel={props.showStatLabels ?? true} />
          <StatPill label="雷" value={props.ship.raig?.[0]} tone="torpedo" showLabel={props.showStatLabels ?? true} />
          <StatPill label="空" value={props.ship.tyku?.[0]} tone="aa" showLabel={props.showStatLabels ?? true} />
          <StatPill label="装" value={props.ship.souk?.[0]} tone="armor" showLabel={props.showStatLabels ?? true} />
        </div>
      </Show>
    </button>
  );
}
