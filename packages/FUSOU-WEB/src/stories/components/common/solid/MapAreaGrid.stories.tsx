import { fn } from "storybook/test";
import { MapAreaGrid } from "../../../../components/common/solid/MapAreaGrid";

export default {
  parameters: { renderer: "solid" },
  title: "Components/common/solid/MapAreaGrid",
  component: MapAreaGrid,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "groups": [
      {
        "areaId": "1",
        "areaName": "鎮守府海域",
        "totalAreaDrops": 2,
        "maps": [
          {
            "mapKey": "1-1",
            "name": "鎮守府正面海域",
            "drops": 2
          }
        ]
      }
    ],
    "onSelect": fn(),
    "selectedMapKey": "1-1"
  },
};
