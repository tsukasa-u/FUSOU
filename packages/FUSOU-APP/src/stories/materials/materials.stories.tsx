import { fn } from "storybook/test";
import type { MstUseItemMetas, MstUseItems } from "@ipc-bindings/get_data";
import type { Materials } from "@ipc-bindings/port";

import { MaterialsComponent } from "../../components/materials/materials.tsx";
import {
  ShipsContext,
  MstUseItemMetasContext,
  MstUseItemsContext,
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
import get_data from "@fusou-testdata-shared-ui/data/S@api_start2@getData.json";

const mstUseItems: MstUseItems = {
  mst_use_items: Object.fromEntries(
    get_data.api_data.api_mst_useitem.map((item) => [
      item.api_id,
      { id: item.api_id, name: item.api_name },
    ]),
  ),
};
const mstUseItemMetas: MstUseItemMetas = { mst_use_item_metas: {} };
const storyMaterials: Materials = {
  ...materials,
  furniture_coin: 12000,
};

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
                  <MaterialsContext.Provider value={[storyMaterials]}>
                    <MstUseItemsContext.Provider value={[mstUseItems]}>
                      <MstUseItemMetasContext.Provider
                        value={[mstUseItemMetas]}
                      >
                        <Story {...context.args} />
                      </MstUseItemMetasContext.Provider>
                    </MstUseItemsContext.Provider>
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
