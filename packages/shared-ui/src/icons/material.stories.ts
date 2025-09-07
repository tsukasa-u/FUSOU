import type { Meta, StoryObj } from "@storybook/web-components-vite";

import { item_list, type IconMaterialProps } from "./material";
import "./material";

import { ifDefined } from "lit/directives/if-defined.js";
import { html } from "lit";

import get_data from "../data/S@api_start2@getData.json";
// import require_info from "../data/S@api_get_member@require_info.json";
import common_itemicons from "../data/common_itemicons.json";
import common_itemicons_png from "../data/common_itemicons.png";

const size_list = ["full", "none", "xs", "sm", "md", "lg", "xl"];

const IconMaterialBasic = (args: IconMaterialProps) => {
  return html`<icon-material
    item_number=${args.item_number}
    size=${ifDefined(args.size)}
  ></icon-material>`;
};

const IconMaterialCatalog = () => {
  return html`<div class="grid grid-cols-10 w-100 gap-4">
    ${Object.keys(item_list).map(
      (item_number) =>
        html`<icon-material
          item_number=${Number(item_number)}
          size=${"xs"}
        ></icon-material>`,
    )}
  </div>`;
};

const IconMaterialCatalogDetail = () => {
  console.log(get_data.api_data.api_mst_useitem);

  const itemicon_id_name = get_data.api_data.api_mst_useitem.map((icon) => [
    icon.api_id,
    icon.api_name,
  ]);

  const itemicons_frames = common_itemicons.frames;

  const bg_scale = 0.6;

  return html`<div class="grid gap-4">
    ${itemicon_id_name.map(([id, name]) => {
      try {
        const itemicons_frame = (itemicons_frames as any)[
          `common_itemicons_id_${id}`
        ].frame;
        return html`<div class="flex h-12 items-center">
          <h1 class="w-20">${id}</h1>
          <icon-material
            item_number=${Number(id)}
            size=${"md"}
            class="w-20 h-full"
          ></icon-material>
          <div class="w-20 h-full">
            <div
              class="h-full"
              style=${`overflow: hidden;
              background-size: ${635 * bg_scale}px, ${635 * bg_scale}px;
              width: ${itemicons_frame.w * bg_scale}px;
              hieght: ${itemicons_frame.h * bg_scale}px;
              background-position: top -${
                itemicons_frame.y * bg_scale
              }px left -${itemicons_frame.x * bg_scale}px;
                background-image: url('${common_itemicons_png}');`}
            ></div>
          </div>
          <div class="w-40">${name}</div>
        </div>`;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        return html`<div class="flex h-12 items-center">
          <h1 class="w-20">${id}</h1>
          <icon-material
            item_number=${Number(id)}
            size=${"md"}
            class="w-20 h-full"
          ></icon-material>
          <div class="w-20">no keys</div>
          <div class="w-40">${name}</div>
        </div>`;
      }
    })}
  </div>`;
};

const meta = {
  title: "FUSOU/icons/icon-material",
  tags: ["autodocs"],
} satisfies Meta<IconMaterialProps>;

export default meta;
type Story = StoryObj<IconMaterialProps>;

export const basic: Story = {
  render: (args: IconMaterialProps) => IconMaterialBasic(args),
  name: "Basic",
  argTypes: {
    item_number: {
      control: { type: "select" },
      options: [1, 2, 3, 4, 5],
    },
    size: {
      control: { type: "select" },
      options: size_list,
      table: {
        defaultValue: { summary: "xs" },
        type: {
          summary: size_list.join("|"),
        },
      },
    },
  },
  args: {
    item_number: 1,
    size: "full",
  },
};

export const catalog: Story = {
  render: () => IconMaterialCatalog(),
  name: "Catalog",
  argTypes: {
    item_number: {
      control: { disable: true },
    },
    size: {
      control: { disable: true },
    },
  },
};

export const catalog_detail: Story = {
  render: () => IconMaterialCatalogDetail(),
  name: "CatalogDetail",
  argTypes: {
    item_number: {
      control: { disable: true },
    },
    size: {
      control: { disable: true },
    },
  },
};
