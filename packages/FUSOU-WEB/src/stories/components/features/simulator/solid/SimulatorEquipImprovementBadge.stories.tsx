import { fn } from "storybook/test";
import { SimulatorEquipImprovementBadge } from "../../../../../components/features/simulator/solid/SimulatorEquipImprovementBadge";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/simulator/solid/SimulatorEquipImprovementBadge",
  component: SimulatorEquipImprovementBadge,
  argTypes: {
    level: { control: { type: "range", min: 0, max: 10, step: 1 } },
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
  args: { level: 10, hovered: true, onCycle: fn() },
};
