import { STORYBOOK_SAMPLE_SHIPS } from "../../../storybook-fixtures";
import { fn } from "storybook/test";
import { ShipCatalogPicker } from "../../../../components/common/solid/ShipCatalogPicker";

export default {
  parameters: { renderer: "solid" },
  title: "Components/common/solid/ShipCatalogPicker",
  component: ShipCatalogPicker,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "ships": STORYBOOK_SAMPLE_SHIPS,
    "selectedShipId": 83,
    "onSelectShip": fn(),
    "children": "選択中: 赤城 (ID 83)"
  },
};
