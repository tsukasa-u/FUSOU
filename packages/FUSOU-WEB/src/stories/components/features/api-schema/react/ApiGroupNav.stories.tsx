import { fn } from "storybook/test";
import ApiGroupNav from "../../../../../components/features/api-schema/react/ApiGroupNav";

export default {
  parameters: { renderer: "react" },
  title: "Components/features/api-schema/react/ApiGroupNav",
  component: ApiGroupNav,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "groups": [
      "Storybook item"
    ],
    "selectedGroup": "Storybook selectedGroup",
    "onGroupChange": fn(),
    "endpoints": [
      "Storybook item"
    ],
    "selectedEndpoint": "Storybook selectedEndpoint",
    "onEndpointChange": fn()
  },
};
