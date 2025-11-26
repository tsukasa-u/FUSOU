import { OpeningTorpedoAttackComponent } from "../../../components/battles/battle/opening_torpedo_attack.tsx";
import {
  DeckBattlesContext,
  ShipsContext,
  MstShipsContext,
  MstSlotItemsContext,
  SlotItemsContext,
  CellsContext,
  AirBasesBattlesContext,
} from "../../../utility/provider.tsx";

import { air_bases } from "@fusou-testdata-ipc/air_bases.ts";
import { ships } from "@fusou-testdata-ipc/ships.ts";
import { mst_ships } from "@fusou-testdata-ipc/mst_ships.ts";
import { slot_items } from "@fusou-testdata-ipc/slot_items.ts";
import { mst_slot_itmes } from "@fusou-testdata-ipc/mst_slot_items.ts";
import { ports_3_5 } from "@fusou-testdata-ipc/3-5/ports.ts";
import { cells_3_5 } from "@fusou-testdata-ipc/3-5/cells.ts";
import {
  get_deck_ship_id,
  get_battle_selected,
  get_store_data_set_deck_ship,
} from "../../../utility/battles.tsx";
import { get_data_set_param_ship } from "../../../utility/get_data_set.tsx";

export default {
  title: "components/battles/battle/opening_torpedo_attack",
  component: OpeningTorpedoAttackComponent,
  tags: ["autodocs"],
  args: {
    battle_index: 1,
    store_data_set_deck_ship: get_store_data_set_deck_ship,
    battle_selected: (x: number) => get_battle_selected(x),
    deck_ship_id: get_deck_ship_id,
    store_data_set_param_ship: (x: number) =>
      get_data_set_param_ship(get_battle_selected(x)),
  },
  render: function Render(args: any) {
    return (
      <OpeningTorpedoAttackComponent
        store_data_set_deck_ship={args.store_data_set_deck_ship}
        deck_ship_id={args.deck_ship_id}
        battle_selected={() => args.battle_selected(args.battle_index)}
        store_data_set_param_ship={() =>
          args.store_data_set_param_ship(args.battle_index)
        }
      />
    );
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
                  <DeckBattlesContext.Provider value={[ports_3_5]}>
                    <AirBasesBattlesContext.Provider value={[air_bases]}>
                      <CellsContext.Provider value={[cells_3_5]}>
                        <Story {...context.args} />
                      </CellsContext.Provider>
                    </AirBasesBattlesContext.Provider>
                  </DeckBattlesContext.Provider>
                </MstShipsContext.Provider>
              </ShipsContext.Provider>
            </SlotItemsContext.Provider>
          </MstSlotItemsContext.Provider>
        </ul>
      );
    },
  ],
};
