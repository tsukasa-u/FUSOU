/** @jsxImportSource solid-js */

import type { JSX } from "solid-js";
import { Show, createSignal, createEffect } from "solid-js";
import { bannerUrl } from "@/features/simulator/equip-calc";
import { STYPE_NAMES } from "@/features/simulator/constants";

export type ShipListItem = {
  id: number;
  name: string;
  stype?: number | null;
};

export function ShipListRow(props: {
  ship: ShipListItem;
  active: boolean;
  onSelect: () => void;
  subtitle?: string;
}): JSX.Element {
  const defaultSubtitle = () => {
    const stypeLabel = props.ship.stype != null ? (STYPE_NAMES[props.ship.stype] ?? `艦種${props.ship.stype}`) : null;
    return stypeLabel ? `ID ${props.ship.id} / ${stypeLabel}` : `ID ${props.ship.id}`;
  };

  const imgSrc = () => bannerUrl(props.ship.id, { w: 192, f: "auto" });
  const [imgErrored, setImgErrored] = createSignal(!imgSrc());
  createEffect(() => {
    setImgErrored(!imgSrc());
  });

  return (
    <button
      class={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition border ${
        props.active
          ? "bg-primary/12 border-primary/35"
          : "hover:bg-primary/8 active:bg-primary/15 border-transparent"
      }`}
      onClick={props.onSelect}
    >
      <Show
        when={!imgErrored()}
        fallback={
          <div class="w-24 h-7 rounded shrink-0 bg-base-200 flex items-center justify-center">
            <span class="text-[10px] font-bold tracking-wide text-base-content/45">No Image</span>
          </div>
        }
      >
        <img
          src={imgSrc()}
          alt={props.ship.name}
          class="w-24 h-7 rounded shrink-0 object-cover"
          loading="lazy"
          onError={() => setImgErrored(true)}
        />
      </Show>
      <div class="min-w-0 text-left">
        <p class="text-sm leading-tight truncate font-medium" title={props.ship.name}>{props.ship.name}</p>
        <p class="text-[11px] text-base-content/45 leading-tight mt-0.5">
          {props.subtitle ?? defaultSubtitle()}
        </p>
      </div>
    </button>
  );
}
