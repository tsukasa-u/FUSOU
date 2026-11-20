import { fn } from "storybook/test";
import NodeDetailPanel from "../../../../../components/features/api-schema/react/NodeDetailPanel";

export default {
  parameters: { renderer: "react" },
  title: "Components/features/api-schema/react/NodeDetailPanel",
  component: NodeDetailPanel,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "onClose": fn(),
    "node": {
      "id": "storybook-record",
      "type": "default",
      "position": {
        "x": 0,
        "y": 0
      },
      "data": {
        "recordName": "Storybook record",
        "fields": []
      }
    },
    "mode": "record"
  },
};
