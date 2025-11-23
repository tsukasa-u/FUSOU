import { AirBaseAssaultComponent } from "../../../components/battles/battle/air_base_assault.tsx";
import {
  DeckBattlesContext,
  ShipsContext,
  MstShipsContext,
  MstSlotItemsContext,
  SlotItemsContext,
  CellsContext,
  AirBasesBattlesContext,
} from "../../../utility/provider.tsx";

import { ships } from "@fusou-testdata-ipc/ships.ts";
import { mst_ships } from "@fusou-testdata-ipc/mst_ships.ts";
import { slot_items } from "@fusou-testdata-ipc/slot_items.ts";
import { mst_slot_itmes } from "@fusou-testdata-ipc/mst_slot_items.ts";
import { ports_6_5 } from "@fusou-testdata-ipc/6-5/ports.ts";
import { cells_6_5 } from "@fusou-testdata-ipc/6-5/cells.ts";
import { airbases_6_5 } from "@fusou-testdata-ipc/6-5/airbases.ts";
import {
  get_deck_ship_id,
  get_battle_selected,
  get_store_data_set_deck_ship,
} from "../../../utility/battles.tsx";
import { get_data_set_param_ship } from "../../../utility/get_data_set.tsx";

export default {
  title: "components/battles/battle/air_base_assault",
  component: AirBaseAssaultComponent,
  tags: ["autodocs"],
  args: {
    battle_index: 4,
    store_data_set_deck_ship: get_store_data_set_deck_ship,
    battle_selected: (x: number) => get_battle_selected(x),
    deck_ship_id: get_deck_ship_id,
    store_data_set_param_ship: (x: number) =>
      get_data_set_param_ship(get_battle_selected(x)),
    area_id: cells_6_5.maparea_id,
  },
  render: function Render(args: any) {
    return (
      <AirBaseAssaultComponent
        area_id={args.area_id}
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
                  <DeckBattlesContext.Provider value={[ports_6_5]}>
                    <AirBasesBattlesContext.Provider value={[airbases_6_5]}>
                      <CellsContext.Provider value={[cells_6_5]}>
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
