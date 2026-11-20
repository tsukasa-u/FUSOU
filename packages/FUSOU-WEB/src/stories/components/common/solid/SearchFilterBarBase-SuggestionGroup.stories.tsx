import { fn } from "storybook/test";
import { SuggestionGroup } from "../../../../components/common/solid/SearchFilterBarBase";

export default {
  parameters: { renderer: "solid" },
  title: "Components/common/solid/SearchFilterBarBase/SuggestionGroup",
  component: SuggestionGroup,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "title": "Storybook title"
  },
};
