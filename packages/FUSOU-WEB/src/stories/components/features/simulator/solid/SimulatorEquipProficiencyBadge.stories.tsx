import { fn } from "storybook/test";
import { SimulatorEquipProficiencyBadge } from "../../../../../components/features/simulator/solid/SimulatorEquipProficiencyBadge";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/simulator/solid/SimulatorEquipProficiencyBadge",
  component: SimulatorEquipProficiencyBadge,
  argTypes: {
    level: { control: { type: "range", min: 0, max: 7, step: 1 } },
    hovered: { control: "boolean" },
    onCycle: { control: false },
  },
  tags: ["autodocs"],
};

export const Default = {
  args: { level: 4, hovered: true, onCycle: fn() },
};

export const HoveredAtZero = {
  args: { level: 0, hovered: true, onCycle: fn() },
};

export const MaximumLevel = {
  args: { level: 7, hovered: true, onCycle: fn() },
};
