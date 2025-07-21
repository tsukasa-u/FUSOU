import type { Meta, StoryObj } from "@storybook/web-components-vite";

import type { IconEquipmentProps } from "./equipment";
import "./equipment";

import { html } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";

import get_data from "../data/S@api_start2@getData.json";
// import require_info from "../data/S@api_get_member@require_info.json";
import common_icon_weapon from "../data/common_icon_weapon.json";
import common_icon_weapon_png from "../data/common_icon_weapon.png";
import album_slot2 from "../data/album_slot2.json";
import album_slot2_png from "../data/album_slot2.png";

const size_list = ["full", "none", "xs", "sm", "md", "lg", "xl"];

const IconEquipmentBasic = (args: IconEquipmentProps) => {
  return html`<icon-equipment
    icon_number=${args.icon_number}
    category_number=${args.category_number}
    size=${ifDefined(args.size)}
    ?empty_flag=${args.empty_flag}
  ></icon-equipment>`;
};

const IconEquipmentCatalog = () => {
  const category_icon_number = [
    ...new Set(
      get_data.api_data.api_mst_slotitem.map((x) =>
        String([x.api_type[1], x.api_type[3]])
      )
    ),
  ].map((s) => s.split(",").map((x) => Number(x)));

  return html`<div class="grid grid-cols-10 w-100 gap-4">
    ${category_icon_number.map(
      ([category_number, icon_number]) =>
        html`<icon-equipment
          icon_number=${icon_number}
          category_number=${category_number}
          size=${"xs"}
        ></icon-equipment>`
    )}
  </div>`;
};

const IconEquipmentCatalogDetail = () => {
  const category_icon_number = [
    ...new Set(
      get_data.api_data.api_mst_slotitem.map((x) =>
        String([x.api_type[1], x.api_type[2], x.api_type[3]])
      )
    ),
  ].map((s) => s.split(",").map((x) => Number(x)));

  const category = get_data.api_data.api_mst_slotitem_equiptype;
  // console.log(category);

  const icon_frames = common_icon_weapon.frames;
  const album_slot2_frames = album_slot2.frames;

  const bg_scale = 0.2;

  return html`<div class="grid gap-4">
    ${category_icon_number.map(
      ([album_slot_number, category_number, icon_number]) => {
        try {
          let icon_frame = (icon_frames as any)[
            `common_icon_weapon_id_${icon_number}`
          ].frame;
          let album_slot2_frame = (album_slot2_frames as any)[
            `album_slot2_id_${album_slot_number}`
          ].frame;
          return html`<div class="flex h-12 items-center">
            <div class="w-20">
              <icon-equipment
                icon_number=${icon_number}
                category_number=${album_slot_number}
                size=${"md"}
              ></icon-equipment>
            </div>
            <div class="w-20 h-full">
              <div
                class="h-full"
                style=${`overflow: hidden;
                background-repeat: no-repeat;
                width: ${icon_frame.w}px;
                hieght: ${icon_frame.h}px;
                background-position: top -${icon_frame.y}px left -${icon_frame.x}px;
                background-image: url('${common_icon_weapon_png}');`}
              ></div>
            </div>
            <div class="w-40">
              ${category.find((element) => element.api_id == category_number)!
                .api_name ?? "Unknown"}
            </div>
            <div class="w-80">
              ${get_data.api_data.api_mst_slotitem.find(
                (element) =>
                  element.api_type[2] == category_number &&
                  element.api_type[3] == icon_number
              )!.api_name ?? "Unknown"}
            </div>
            <div class="w-60 h-full" style="transform: translateY(-36px);">
              <div
                class="h-32"
                style=${`
                transform: scale(2);
                transform: rotateZ(-90deg);
                background-size: ${3199 * bg_scale}px, ${2595 * bg_scale}px;
                width: ${album_slot2_frame.w * bg_scale}px;
                hieght: ${album_slot2_frame.h * bg_scale}px;
                background-position: top -${album_slot2_frame.y * bg_scale}px left -${album_slot2_frame.x * bg_scale}px;
                background-image: url('${album_slot2_png}');
                `}
              ></div>
            </div>
          </div>`;
        } catch (e) {
          return html`<div class="flex h-12 items-center">
            <icon-equipment
              icon_number=${icon_number}
              category_number=${category_number}
              size=${"md"}
              class="w-20 h-full"
            ></icon-equipment>
            <div class="w-20">no keys</div>
            <div class="w-40">
              ${category.find((element) => element.api_id == category_number)!
                .api_name ?? "Unknown"}
            </div>
            <div class="w-80">
              ${get_data.api_data.api_mst_slotitem.find(
                (element) =>
                  element.api_type[2] == category_number &&
                  element.api_type[3] == icon_number
              )!.api_name ?? "Unknown"}
            </div>
          </div>`;
        }
      }
    )}
  </div>`;
};

const meta = {
  title: "FUSOU/icons/icon-equipment",
  tags: ["autodocs"],
} satisfies Meta<IconEquipmentProps>;

export default meta;
type Story = StoryObj<IconEquipmentProps>;

export const basic: Story = {
  render: (args: IconEquipmentProps) => IconEquipmentBasic(args),
  name: "Basic",
  argTypes: {
    icon_number: {
      control: { type: "select" },
      options: [1, 2, 3, 4, 5, 34],
    },
    category_number: {
      control: { type: "select" },
      options: [1, 2, 3, 4, 5],
    },
    size: {
      control: { type: "select" },
      options: size_list,

      table: {
        defaultValue: { summary: "xs" },
        type: {
          summary: size_list.join("\|"),
        },
      },
    },
    empty_flag: {
      control: "boolean",
    },
  },
  args: {
    icon_number: 1,
    category_number: 1,
    size: "full",
    empty_flag: false,
  },
};

export const catalog: Story = {
  render: () => IconEquipmentCatalog(),
  name: "Catalog",
  argTypes: {
    icon_number: {
      control: { disable: true },
    },
    category_number: {
      control: { disable: true },
    },
    size: {
      control: { disable: true },
    },
  },
};

export const catalog_detail: Story = {
  render: () => IconEquipmentCatalogDetail(),
  name: "CatalogDetail",
  argTypes: {
    icon_number: {
      control: { disable: true },
    },
    category_number: {
      control: { disable: true },
    },
    size: {
      control: { disable: true },
    },
  },
};
