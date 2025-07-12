import type { Meta, StoryObj } from "@storybook/web-components-vite";

import type { IconMaterialProps } from "./material";
import {
  IconMaterialBasic,
  IconMaterialCatalog,
  IconMaterialCatalogDetail,
} from "./material";

const size_list = ["full", "none", "xs", "sm", "md", "lg", "xl"];

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
          summary: size_list.join("\|"),
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
