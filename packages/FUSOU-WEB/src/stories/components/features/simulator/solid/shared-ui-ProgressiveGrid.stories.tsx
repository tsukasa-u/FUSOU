import { renderStorybookProgressiveGridItem } from "../../../../storybook-fixtures";
import { ProgressiveGrid } from "../../../../../components/features/simulator/solid/shared-ui";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/simulator/solid/shared-ui/ProgressiveGrid",
  component: ProgressiveGrid,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "data": [
      {
        "id": 1,
        "name": "Storybook item"
      }
    ],
    "children": renderStorybookProgressiveGridItem
  },
};
