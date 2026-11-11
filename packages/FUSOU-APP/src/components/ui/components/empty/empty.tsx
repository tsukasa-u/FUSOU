import type { Component } from "solid-js";
import { Show } from "solid-js";

import { IconEquipment } from "../../icons/equipment";
import { IconShip } from "../../icons/ship";

export type EmptySize = "xs" | "sm" | "md" | "lg" | "xl";

const valueSizeClasses: Record<EmptySize, string> = {
  xs: "h-6 text-xs",
  sm: "h-[27px] text-sm",
  md: "h-[30px] text-base",
  lg: "h-[35px] text-lg",
  xl: "h-11 text-xl",
};

const alignClasses = {
  left: "justify-start text-left",
  center: "justify-center text-center",
  right: "justify-end text-right",
} as const;

export interface EmptyValueProps {
  size?: EmptySize;
  widthClass?: string;
  align?: "left" | "center" | "right";
  text?: "-" | "—";
  label?: string;
  class?: string;
}

/**
 * Shared placeholder for absent text values in tables and battle summary strips.
 */
export const EmptyValue: Component<EmptyValueProps> = (props) => {
  const size = () => props.size ?? "xs";
  const align = () => props.align ?? "center";

  return (
    <span
      aria-label={props.label ?? "None"}
      class={[
        "inline-flex items-center shrink-0 select-none text-base-content/40 tabular-nums",
        valueSizeClasses[size()],
        alignClasses[align()],
        props.widthClass ?? "",
        props.class ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {props.text ?? "—"}
    </span>
  );
};

export interface EmptySlotProps {
  kind: "ship" | "equip";
  size?: EmptySize;
  showLabel?: boolean;
  labelWidthClass?: string;
  widthClass?: string;
  label?: string;
  class?: string;
}

/**
 * Shared placeholder for absent ship/equipment SVG slots with optional fixed-width label.
 */
export const EmptySlot: Component<EmptySlotProps> = (props) => {
  const size = () => props.size ?? "xs";

  return (
    <div
      aria-label={props.label ?? "None"}
      class={[
        "inline-flex items-center shrink-0 select-none cursor-default",
        props.widthClass ?? "",
        props.class ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div class="shrink-0">
        <Show
          when={props.kind === "ship"}
          fallback={
            <IconEquipment
              icon_number={0}
              category_number={0}
              size={size()}
              empty_flag={true}
            />
          }
        >
          <IconShip ship_stype={0} color="" size={size()} empty_flag={true} />
        </Show>
      </div>
      <Show when={props.showLabel}>
        <div
          class={[
            "pl-3 flex items-center min-w-0",
            props.labelWidthClass ?? "flex-1",
          ].join(" ")}
        >
          <EmptyValue size={size()} align="left" label={props.label} />
        </div>
      </Show>
    </div>
  );
};
