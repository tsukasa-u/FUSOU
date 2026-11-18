import { ShipDropCard } from "../../../../../components/features/drops/solid/ShipDropCard";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/drops/solid/ShipDropCard",
  component: ShipDropCard,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "shipId": 1,
    "shipName": "Storybook shipName",
    "backs": 1,
    "overallRateLabel": "Storybook overallRateLabel",
    "overallRateStr": "Storybook overallRateStr",
    "overallCount": 1,
    "dropLocs": []
  },
};
