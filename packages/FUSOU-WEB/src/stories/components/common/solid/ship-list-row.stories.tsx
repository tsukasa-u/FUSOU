import { fn } from "storybook/test";
import { ShipListRow } from "../../../../components/common/solid/ship-list-row";

export default {
  parameters: { renderer: "solid" },
  title: "Components/common/solid/ship-list-row",
  component: ShipListRow,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "active": false,
    "onSelect": fn(),
    "ship": {
      "id": 83,
      "name": "赤城",
      "stype": 11,
      "houg": [
        0,
        39
      ],
      "raig": [
        0,
        0
      ],
      "tyku": [
        32,
        69
      ],
      "souk": [
        28,
        54
      ]
    },
    "showStats": true
  },
};
