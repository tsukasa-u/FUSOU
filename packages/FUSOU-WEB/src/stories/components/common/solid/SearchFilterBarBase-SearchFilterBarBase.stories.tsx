import { fn } from "storybook/test";
import { SearchFilterBarBase } from "../../../../components/common/solid/SearchFilterBarBase";

export default {
  parameters: { renderer: "solid" },
  title: "Components/common/solid/SearchFilterBarBase/SearchFilterBarBase",
  component: SearchFilterBarBase,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "searchQuery": () => (""),
    "onSearchChange": fn(),
    "activeFilterCount": 1,
    "onOpenFilterModal": fn(),
    "isOpen": () => (false),
    "onOpenChange": fn()
  },
};
