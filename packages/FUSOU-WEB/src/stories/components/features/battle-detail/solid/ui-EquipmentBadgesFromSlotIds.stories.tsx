import { createStorybookSlotItemMap } from "../../../../storybook-fixtures";
import { EquipmentBadgesFromSlotIds } from "../../../../../components/features/battle-detail/solid/ui";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/battle-detail/solid/ui/EquipmentBadgesFromSlotIds",
  component: EquipmentBadgesFromSlotIds,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "slotIds": [
      16
    ],
    "mstSlotItemById": createStorybookSlotItemMap()
  },
};
