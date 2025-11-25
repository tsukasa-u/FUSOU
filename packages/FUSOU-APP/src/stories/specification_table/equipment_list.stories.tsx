import { fn } from "storybook/test";

import { EquipmentListComponent } from "../../components/specification_table/equipment_list.tsx";
import {
  ShipsContext,
  MstShipsContext,
  MstSlotItemsContext,
  SlotItemsContext,
  MstSlotItemEquipTypesContext,
} from "../../utility/provider.tsx";

import { ships } from "@fusou-testdata-ipc/ships.ts";
import { mst_ships } from "@fusou-testdata-ipc/mst_ships.ts";
import { slot_items } from "@fusou-testdata-ipc/slot_items.ts";
import { mst_slot_itmes } from "@fusou-testdata-ipc/mst_slot_items.ts";
import { mst_slot_item_equip_types } from "@fusou-testdata-ipc/mst_slot_item_equip_types.ts";

export default {
  title: "components/specification table/equipment_list",
  component: EquipmentListComponent,
  tags: ["autodocs"],
  // Use `fn` to spy on the onClick arg, which will appear in the actions panel once invoked: https://storybook.js.org/docs/essentials/actions#action-args
  args: { onClick: fn() },
};

export const WithDecorator = {
  args: {},
  decorators: [
    (Story: any, context: any) => {
      return (
        <div class="pt-0 pb-0 pl-0 bg-base-100">
          <MstSlotItemsContext.Provider value={[mst_slot_itmes]}>
            <SlotItemsContext.Provider value={[slot_items]}>
              <ShipsContext.Provider value={[ships]}>
                <MstShipsContext.Provider value={[mst_ships]}>
                  <MstSlotItemEquipTypesContext.Provider
                    value={[mst_slot_item_equip_types]}
                  >
                    <Story {...context.args} />
                  </MstSlotItemEquipTypesContext.Provider>
                </MstShipsContext.Provider>
              </ShipsContext.Provider>
            </SlotItemsContext.Provider>
          </MstSlotItemsContext.Provider>
        </div>
      );
    },
  ],
};
