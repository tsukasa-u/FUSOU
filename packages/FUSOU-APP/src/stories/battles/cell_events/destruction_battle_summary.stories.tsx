import { DestructionBattleSummaryComponent } from "../../../components/battles/cell_events/destruction_battle_summary.tsx";
import {
  DeckBattlesContext,
  ShipsContext,
  MstShipsContext,
  MstSlotItemsContext,
  SlotItemsContext,
  CellsContext,
  AirBasesBattlesContext,
} from "../../../utility/provider.tsx";

import { ships } from "../../data/ships.ts";
import { mst_ships } from "../../data/mst_ships.ts";
import { slot_items } from "../../data/slot_items.ts";
import { mst_slot_itmes } from "../../data/mst_slot_items.ts";
import { ports_6_5 } from "../../data/6-5/ports.ts";
import { cells_6_5 } from "../../data/6-5/cells.ts";
import { airbases_6_5 } from "../../data/6-5/airbases.ts";
import {
  get_battle_selected,
  get_cell_selected,
} from "../../../utility/battles.tsx";
import { get_data_set_param_ship } from "../../../utility/get_data_set.tsx";

export default {
  title: "components/battles/cell_events/destruction_battle_summary",
  component: DestructionBattleSummaryComponent,
  tags: ["autodocs"],
  args: {
    cell_index: 2,
    cell: (x: number) => get_cell_selected(x),
    store_data_set_param_ship: (x: number) =>
      get_data_set_param_ship(get_battle_selected(x)),
    area_id: cells_6_5.maparea_id,
  },
  render: function Render(args: any) {
    return (
      <DestructionBattleSummaryComponent
        area_id={args.area_id}
        cell={() => args.cell(args.cell_index)}
        store_data_set_param_ship={() =>
          args.store_data_set_param_ship(args.cell_index)
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
