import { SpecTable } from "../../../../../components/features/simulator/solid/shared-ui";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/simulator/solid/shared-ui/SpecTable",
  component: SpecTable,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "rows": [
      [
        "火力",
        5
      ],
      [
        "対空",
        3
      ],
      [
        "装甲",
        2
      ]
    ]
  },
};
