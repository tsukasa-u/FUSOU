import type { Meta, StoryObj } from "@storybook/web-components-vite";

import type { IconEquipmentProps } from "./equipment";
import {
  IconEquipmentBasic,
  IconEquipmentCatalog,
  IconEquipmentCatalogDetail,
} from "./equipment";

const size_list = ["full", "none", "xs", "sm", "md", "lg", "xl"];

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
