import { fn } from "storybook/test";

import { ClosingTorpedoAttackComponent } from "../../../components/battles/battle/closing_torpedo_attack.tsx";
import {
  DeckPortsContext,
  ShipsContext,
  MstShipsContext,
  MstSlotItemsContext,
  SlotItemsContext,
  CellsContext,
} from "../../../utility/provider.tsx";

import { ships } from "../../data/ships.ts";
import { mst_ships } from "../../data/mst_ships.ts";
import { slot_items } from "../../data/slot_items.ts";
import { mst_slot_itmes } from "../../data/mst_slot_items.ts";
import { deck_port } from "../../data/deck_ports.ts";
import { cells } from "../../data/cells.ts";
import {
  get_deck_ship_id,
  get_battle_selected,
  get_store_data_set_deck_ship,
} from "../../../utility/battles.tsx";
import { get_data_set_param_ship } from "../../../utility/get_data_set.tsx";

export default {
  title: "components/closing_torpedo_attack",
  component: ClosingTorpedoAttackComponent,
  tags: ["autodocs"],
  // Use `fn` to spy on the onClick arg, which will appear in the actions panel once invoked: https://storybook.js.org/docs/essentials/actions#action-args
  args: {
    onClick: fn(),
    store_data_set_deck_ship: get_store_data_set_deck_ship,
    battle_selected: () => get_battle_selected(1),
    deck_ship_id: get_deck_ship_id,
    store_data_set_param_ship: () =>
      get_data_set_param_ship(get_battle_selected(1)),
  },
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
                    <CellsContext.Provider value={[cells]}>
                      <Story {...context.args} />
                    </CellsContext.Provider>
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
