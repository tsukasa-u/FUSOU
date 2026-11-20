import { createStorybookSimulatorSlotItems } from "../../../../storybook-fixtures";
import { fn } from "storybook/test";
import { EquipSlotGroup } from "../../../../../components/features/simulator/solid/shared-ui";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/simulator/solid/shared-ui/EquipSlotGroup",
  component: EquipSlotGroup,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "slotItems": createStorybookSimulatorSlotItems(),
    "onOpenEquip": fn()
  },
};
