import { fn } from "storybook/test";
import { FusouTabs } from "../../../../components/common/solid/FusouTabs";

export default {
  parameters: { renderer: "solid" },
  title: "Components/common/solid/FusouTabs",
  component: FusouTabs,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "tabs": [],
    "onTabChange": fn()
  },
};
