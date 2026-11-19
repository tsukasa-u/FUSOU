import { For, Show } from "solid-js";
import type { IconMaterialProps } from "ui";
import { ComponentItemModal, IconMaterial } from "ui";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { item_list } from "../../icons/material_data";

import get_data from "@fusou-testdata-shared-ui/data/S@api_start2@getData.json";
import common_itemicons from "@fusou-testdata-shared-ui/data/common_itemicons.json";
import common_itemicons_png from "@fusou-testdata-shared-ui/data/common_itemicons.png";

const size_list = ["full", "none", "xs", "sm", "md", "lg", "xl"];
const itemMasterById = new Map(
  get_data.api_data.api_mst_useitem.map((item) => [item.api_id, item] as const),
);
const itemNames: Record<number, string> = Object.fromEntries(
  get_data.api_data.api_mst_useitem.map((item) => [item.api_id, item.api_name]),
);
const getItemName = (itemId: number) =>
  itemMasterById.get(itemId)?.api_name ?? `Item #${itemId}`;
const getItemDescription = (itemId: number) =>
  (itemMasterById.get(itemId)?.api_description ?? [])
    .filter(Boolean)
    .map((description) => description.replace(/<br\s*\/?>/gi, "\n"))
    .join("\n");
const iconCatalogItems = get_data.api_data.api_mst_useitem.filter((item) => {
  const cell = item_list[item.api_id]?.[0].trim();
  return Boolean(cell && cell !== "UN");
});

const IconMaterialBasic = (args: IconMaterialProps) => {
  return (
    <ComponentItemModal
      item_number={args.item_number}
      name={getItemName(args.item_number)}
      description={getItemDescription(args.item_number)}
      itemNames={itemNames}
      size={args.size}
    />
  );
};

const IconMaterialCatalog = () => {
  return (
    <div class="grid grid-cols-10 w-100 gap-4">
      <For each={iconCatalogItems}>
        {(item) => (
          <ComponentItemModal
            item_number={item.api_id}
            name={item.api_name}
            description={getItemDescription(item.api_id)}
            itemNames={itemNames}
            size="xs"
          />
        )}
      </For>
    </div>
  );
};

const IconMaterialCatalogDetail = () => {
  const itemicon_frames = Object.entries(common_itemicons.frames)
    .flatMap(([key, value]) => {
      const match = /^common_itemicons_id_(\d+)$/.exec(key);
      if (!match) return [];
      const id = Number(match[1]);
      const item = itemMasterById.get(id);
      if (!item) return [];
      return [
        {
          id,
          name: item.api_name,
          description: getItemDescription(id),
          frame: value.frame,
        },
      ];
    })
    .sort((a, b) => a.id - b.id);

  const bg_scale = 0.6;
  const atlasWidth = common_itemicons.meta.size.w;
  const atlasHeight = common_itemicons.meta.size.h;

  return (
    <div class="grid gap-4">
      <For each={itemicon_frames}>
        {(item) => (
          <div class="flex min-h-12 items-center gap-2">
            <span class="w-12 shrink-0">{item.id}</span>
            <ComponentItemModal
              item_number={item.id}
              name={item.name}
              description={item.description}
              itemNames={itemNames}
              size="md"
              class="p-0"
            >
              <div class="flex items-center gap-2" aria-hidden="true">
                <Show when={item_list[item.id]}>
                  <IconMaterial item_number={item.id} size="md" />
                </Show>
                <span
                  class="inline-block shrink-0 bg-no-repeat"
                  style={{
                    width: `${item.frame.w * bg_scale}px`,
                    height: `${item.frame.h * bg_scale}px`,
                    "background-size": `${atlasWidth * bg_scale}px ${atlasHeight * bg_scale}px`,
                    "background-position": `-${item.frame.x * bg_scale}px -${item.frame.y * bg_scale}px`,
                    "background-image": `url('${common_itemicons_png}')`,
                  }}
                />
              </div>
            </ComponentItemModal>
            <span class="w-40">{item.name}</span>
          </div>
        )}
      </For>
    </div>
  );
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
      options: iconCatalogItems.map((item) => item.api_id),
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
