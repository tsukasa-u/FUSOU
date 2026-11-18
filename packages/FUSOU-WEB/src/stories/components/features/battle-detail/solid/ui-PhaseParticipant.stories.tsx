import { PhaseParticipant } from "../../../../../components/features/battle-detail/solid/ui";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/battle-detail/solid/ui/PhaseParticipant",
  component: PhaseParticipant,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "name": "Storybook name",
    "side": "friend",
    "idx": 1,
    "hpCurrent": 1,
    "hpMax": 1
  },
};
