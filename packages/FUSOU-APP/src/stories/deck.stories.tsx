import { fn } from "storybook/test";

import { DeckComponent } from "../components/deck.tsx";
import {
  DeckPortsContext,
  ShipsContext,
  MstShipsContext,
  MstSlotItemsContext,
  SlotItemsContext,
} from "../utility/provider.tsx";

import { ships } from "./data/ships.ts";
import { mst_ships } from "./data/mst_ships.ts";
import { slot_items } from "./data/slot_items.ts";
import { mst_slot_itmes } from "./data/mst_slot_items.ts";
import { deck_port } from "./data/deck_ports.ts";

export default {
  title: "components/deck",
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
