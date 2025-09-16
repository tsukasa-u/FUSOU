import { fn } from "storybook/test";

import { ShipListComponent } from "../../components/specification_table/ship_list.tsx";
import {
  ShipsContext,
  MstShipsContext,
  MstSlotItemsContext,
  SlotItemsContext,
  MstStypesContext,
} from "../../utility/provider.tsx";

import { ships } from "../data/ships.ts";
import { mst_ships } from "../data/mst_ships.ts";
import { slot_items } from "../data/slot_items.ts";
import { mst_slot_itmes } from "../data/mst_slot_items.ts";
import { mst_stypes } from "../data/mst_stypes.ts";

export default {
  title: "components/specification table/ship_list",
  component: ShipListComponent,
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
                  <MstStypesContext.Provider value={[mst_stypes]}>
                    <Story {...context.args} />
                  </MstStypesContext.Provider>
                </MstShipsContext.Provider>
              </ShipsContext.Provider>
            </SlotItemsContext.Provider>
          </MstSlotItemsContext.Provider>
        </div>
      );
    },
  ],
};
