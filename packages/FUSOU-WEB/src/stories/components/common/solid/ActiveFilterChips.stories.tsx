import { fn } from "storybook/test";
import { ActiveFilterChips } from "../../../../components/common/solid/ActiveFilterChips";

export default {
  parameters: { renderer: "solid" },
  title: "Components/common/solid/ActiveFilterChips",
  component: ActiveFilterChips,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "items": [
      {
        "key": "period",
        "label": "期間",
        "value": "2026-02-13",
        "onRemove": fn()
      },
      {
        "key": "map",
        "label": "海域",
        "value": "1-1",
        "onRemove": fn()
      }
    ]
  },
};
