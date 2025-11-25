import { fn } from "storybook/test";

import { DeckComponent } from "../../components/deck_port/deck.tsx";
import {
  DeckPortsContext,
  ShipsContext,
  MstShipsContext,
  MstSlotItemsContext,
  SlotItemsContext,
} from "../../utility/provider.tsx";

import { ships } from "@fusou-testdata-ipc/ships.ts";
import { mst_ships } from "@fusou-testdata-ipc/mst_ships.ts";
import { slot_items } from "@fusou-testdata-ipc/slot_items.ts";
import { mst_slot_itmes } from "@fusou-testdata-ipc/mst_slot_items.ts";
import { deck_port } from "@fusou-testdata-ipc/deck_ports.ts";

export default {
  title: "components/deck_port/deck",
  component: DeckComponent,
  tags: ["autodocs"],
  // Use `fn` to spy on the onClick arg, which will appear in the actions panel once invoked: https://storybook.js.org/docs/essentials/actions#action-args
  args: { onClick: fn(), deck_id: 1, fleet_name: "test_fleet" },
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
                  <DeckPortsContext.Provider value={[deck_port]}>
                    <Story {...context.args} />
                  </DeckPortsContext.Provider>
                </MstShipsContext.Provider>
              </ShipsContext.Provider>
            </SlotItemsContext.Provider>
          </MstSlotItemsContext.Provider>
        </ul>
      );
    },
  ],
};
