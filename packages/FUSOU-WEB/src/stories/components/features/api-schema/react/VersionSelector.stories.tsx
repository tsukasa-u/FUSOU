import { fn } from "storybook/test";
import VersionSelector from "../../../../../components/features/api-schema/react/VersionSelector";

export default {
  parameters: { renderer: "react" },
  title: "Components/features/api-schema/react/VersionSelector",
  component: VersionSelector,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "versions": [
      "Storybook item"
    ],
    "selected": "Storybook selected",
    "onChange": fn()
  },
};
