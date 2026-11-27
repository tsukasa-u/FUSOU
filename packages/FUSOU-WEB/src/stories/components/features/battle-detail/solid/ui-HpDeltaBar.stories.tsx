import { HpDeltaBar } from "../../../../../components/features/battle-detail/solid/ui";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/battle-detail/solid/ui/HpDeltaBar",
  component: HpDeltaBar,
  tags: ["autodocs"],
  argTypes: {
    before: { control: { type: "number", min: 0, max: 350 } },
    after: { control: { type: "number", min: 0, max: 350 } },
    max: { control: { type: "number", min: 1, max: 350 } },
    barWidthClass: {
      control: "select",
      options: ["w-16", "w-[68px]", "w-20", "w-24", "w-32", "w-40"],
    },
    layout: {
      control: "select",
      options: ["inline", "stacked", "responsive"],
    },
    showNumbers: { control: "boolean" },
  },
};

export const LightDamage = {
  args: {
    before: 86,
    after: 68,
    max: 86,
    barWidthClass: "w-20",
    layout: "inline",
    showNumbers: true,
  },
};

export const HeavyDamageTaiha = {
  args: {
    before: 68,
    after: 15,
    max: 86,
    barWidthClass: "w-20",
    layout: "inline",
    showNumbers: true,
  },
};

export const Sunk = {
  args: {
    before: 42,
    after: 0,
    max: 66,
    barWidthClass: "w-20",
    layout: "inline",
    showNumbers: true,
  },
};

export const NoDamageMiss = {
  args: {
    before: 47,
    after: 47,
    max: 47,
    barWidthClass: "w-20",
    layout: "inline",
    showNumbers: true,
  },
};

export const CompactStacked = {
  args: {
    before: 68,
    after: 15,
    max: 86,
    barWidthClass: "w-[68px]",
    layout: "stacked",
    showNumbers: true,
  },
};

export const CompactStackedSunk = {
  args: {
    before: 42,
    after: 0,
    max: 66,
    barWidthClass: "w-[68px]",
    layout: "stacked",
    showNumbers: true,
  },
};
