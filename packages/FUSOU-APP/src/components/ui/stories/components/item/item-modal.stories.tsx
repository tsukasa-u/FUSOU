import { ComponentItemModal } from "ui";
import type { ComponentItemModalProps } from "ui";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "FUSOU/components/items/component-item-modal",
  tags: ["autodocs"],
} satisfies Meta<ComponentItemModalProps>;

export default meta;
type Story = StoryObj<ComponentItemModalProps>;

export const basic: Story = {
  render: (args: ComponentItemModalProps) => (
    <ComponentItemModal
      item_number={args.item_number}
      name={args.name}
      description={args.description}
      count={args.count}
      size={args.size}
    />
  ),
  args: {
    item_number: 57,
    name: "勲章",
    description: "複数集めることで資源または改装設計図と交換可能です。",
    count: 14,
    size: "md",
  },
};

export const specialIconCode: Story = {
  ...basic,
  args: {
    item_number: 68,
    name: "秋刀魚",
    description: "期間限定の特別な食材です。",
    count: 3,
    size: "md",
  },
};
