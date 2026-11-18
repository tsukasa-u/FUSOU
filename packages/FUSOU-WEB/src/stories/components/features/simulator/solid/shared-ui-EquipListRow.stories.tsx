import { createStorybookSimulatorEquip } from "../../../../storybook-fixtures";
import { fn } from "storybook/test";
import { EquipListRow } from "../../../../../components/features/simulator/solid/shared-ui";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/simulator/solid/shared-ui/EquipListRow",
  component: EquipListRow,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "active": false,
    "onSelect": fn(),
    "equip": createStorybookSimulatorEquip(),
    "showStatLabels": true,
    "showStats": true
  },
};
