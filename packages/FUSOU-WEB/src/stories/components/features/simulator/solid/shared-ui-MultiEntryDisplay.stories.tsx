import { createStorybookSimulatorEquip } from "../../../../storybook-fixtures";
import { fn } from "storybook/test";
import { MultiEntryDisplay } from "../../../../../components/features/simulator/solid/shared-ui";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/simulator/solid/shared-ui/MultiEntryDisplay",
  component: MultiEntryDisplay,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "onOpenEquip": fn(),
    "entry": {
      "kind": "combo",
      "combo": [
        createStorybookSimulatorEquip()
      ],
      "netStats": {
        "houg": 3
      },
      "suppressed_components": []
    }
  },
};
