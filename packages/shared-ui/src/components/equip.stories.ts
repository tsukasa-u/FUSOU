import type { Meta, StoryObj } from "@storybook/web-components-vite";

import type { EquipmentProps } from "./equip";
import {
  EquipmentBasic,
  EquipmentCatalog,
  EquipmentCatalogDetail,
} from "./equip";

const size_list = ["full", "none", "xs", "sm", "md", "lg", "xl"];

const meta = {
  title: "FUSOU/EQUIP",
  tags: ["autodocs"],
} satisfies Meta<EquipmentProps>;

export default meta;
type Story = StoryObj<EquipmentProps>;

export const basic: Story = {
  render: (args) => EquipmentBasic(args),
  name: "Basic",
  argTypes: {
    icon_number: {
      control: { type: "select" },
      options: [1, 2, 3, 4, 5],
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
  },
  args: {
    icon_number: 1,
    category_number: 1,
    size: "xs",
  },
};

export const catalog: Story = {
  render: (_) => EquipmentCatalog(),
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
  render: (_) => EquipmentCatalogDetail(),
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
