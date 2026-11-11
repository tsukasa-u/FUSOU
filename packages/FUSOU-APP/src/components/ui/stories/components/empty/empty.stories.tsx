import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { EmptySlot, EmptyValue } from "../../../components/empty";

const meta: Meta = {
  title: "UI/Components/Empty",
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj;

export const AllPlaceholders: Story = {
  render: () => (
    <div class="flex flex-col gap-4 p-4 text-xs">
      <div class="flex items-center gap-4">
        <span class="w-28 text-base-content/60">EmptyValue (—)</span>
        <EmptyValue size="xs" widthClass="w-12" />
        <EmptyValue size="sm" widthClass="w-12" />
        <EmptyValue size="md" widthClass="w-12" />
      </div>
      <div class="flex items-center gap-4">
        <span class="w-28 text-base-content/60">EmptySlot (equip)</span>
        <EmptySlot kind="equip" size="xs" />
        <EmptySlot kind="equip" size="xs" showLabel={true} widthClass="w-28" />
      </div>
      <div class="flex items-center gap-4">
        <span class="w-28 text-base-content/60">EmptySlot (ship)</span>
        <EmptySlot kind="ship" size="xs" />
        <EmptySlot kind="ship" size="xs" showLabel={true} widthClass="w-28" />
      </div>
    </div>
  ),
};
