import { fn } from "storybook/test";

import { MaterialsComponent } from "../../components/materials/materials.tsx";
import {
  ShipsContext,
  MstShipsContext,
  MstSlotItemsContext,
  SlotItemsContext,
  MaterialsContext,
} from "../../utility/provider.tsx";

import { ships } from "@fusou-testdata-ipc/ships.ts";
import { mst_ships } from "@fusou-testdata-ipc/mst_ships.ts";
import { slot_items } from "@fusou-testdata-ipc/slot_items.ts";
import { mst_slot_itmes } from "@fusou-testdata-ipc/mst_slot_items.ts";
import { materials } from "@fusou-testdata-ipc/materilas.ts";

export default {
  title: "components/materials/materials",
  component: MaterialsComponent,
  tags: ["autodocs"],
  // Use `fn` to spy on the onClick arg, which will appear in the actions panel once invoked: https://storybook.js.org/docs/essentials/actions#action-args
  args: { onClick: fn() },
};

export const WithDecorator = {
  args: {},
  decorators: [
    (Story: any, context: any) => {
      return (
        <ul class="menu menu-xs bg-base-100 w-full pl-0 flex pt-0">
          <MstSlotItemsContext.Provider value={[mst_slot_itmes]}>
            <SlotItemsContext.Provider value={[slot_items]}>
              <ShipsContext.Provider value={[ships]}>
                <MstShipsContext.Provider value={[mst_ships]}>
                  <MaterialsContext.Provider value={[materials]}>
                    <Story {...context.args} />
                  </MaterialsContext.Provider>
                </MstShipsContext.Provider>
              </ShipsContext.Provider>
            </SlotItemsContext.Provider>
          </MstSlotItemsContext.Provider>
        </ul>
      );
    },
  ],
};
