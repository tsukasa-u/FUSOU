import { fn } from "storybook/test";
import { SuggestionItemButton } from "../../../../components/common/solid/SearchFilterBarBase";

export default {
  parameters: { renderer: "solid" },
  title: "Components/common/solid/SearchFilterBarBase/SuggestionItemButton",
  component: SuggestionItemButton,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "onClick": fn(),
    "title": "Storybook title"
  },
};
