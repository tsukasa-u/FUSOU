import type { Component } from "solid-js";
import {
  item_list,
  material_icon_columns,
  material_icon_rows,
  material_icon_tables,
  getMaterialIconLocation,
} from "./material_data";
export {
  getMaterialIconLocation,
  item_list,
  material_icon_columns,
  material_icon_rows,
  material_icon_tables,
};

export interface IconMaterialProps {
  item_number: number;
  size?: "full" | "none" | "xs" | "sm" | "md" | "lg" | "xl";
  class?: string;
  classList?: any;
  cellOverride?: string;
  tableIdOverride?: number;
}

const class_size = {
  xs: "h-6",
  sm: "h-[27px]",
  md: "h-[30px]",
  lg: "h-[35px]",
  xl: "h-11",
  full: "h-full",
  none: "",
};
const get_primary_color = (item_number: number, tableIdOverride?: number) => {
  return (
    material_icon_tables[
      tableIdOverride ?? item_list[item_number ?? 0]?.[1] ?? 0
    ]?.color ?? "#FFFFFF"
  );
};

const get_name = (item_number: number, cellOverride?: string) => {
  return cellOverride ?? item_list[item_number ?? 0]?.[0] ?? "  ";
};

const bg_slash = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
  <path
    d={`M${i * 12 + 28 + 3} 132 ${i * 12 + 34 + 3} 116`}
    stroke="#303030"
    stroke-width="0.5"
    fill="none"
    fill-rule="evenodd"
  />
));

export const IconMaterial: Component<IconMaterialProps> = (props) => {
  const size = () => props.size ?? "xs";

  return (
    <svg
      fill="currentColor"
      stroke-width="1.5"
      stroke="currentColor"
      viewBox="0 0 151 151"
      xmlns="http://www.w3.org/2000/svg"
      xmlns:xlink="http://www.w3.org/1999/xlink"
      overflow="hidden"
      class={["cursor-inherit", class_size[size()]].join(" ")}
    >
      <text
        style={{
          "font-family": '"Roboto Mono", monospace',
          "font-optical-sizing": "auto",
          "font-weight": 500,
          "font-style": "normal",
        }}
        font-size="96"
        textLength="96"
        lengthAdjust="spacingAndGlyphs"
        transform="translate(28 104)"
      >
        {get_name(props.item_number, props.cellOverride)}
      </text>
      <path
        d="M9 32C9 19.85 18.85 10 31 10L119 10C131.15 10 141 19.85 141 32L141 120C141 132.15 131.15 142 119 142L31 142C18.85 142 9 132.15 9 120Z"
        stroke-width="4"
        stroke-linejoin="round"
        stroke-miterlimit="10"
        fill="none"
        fill-rule="evenodd"
      />
      <path
        d="M28 124 124 124"
        stroke={get_primary_color(props.item_number, props.tableIdOverride)}
        stroke-width="16"
        stroke-miterlimit="8"
        fill="none"
        fill-rule="evenodd"
      />
      {bg_slash}
    </svg>
  );
};
