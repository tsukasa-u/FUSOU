import { BattlesComponent } from "../../components/battles/battles.tsx";
import {
  DeckBattlesContext,
  ShipsContext,
  MstShipsContext,
  MstSlotItemsContext,
  SlotItemsContext,
  CellsContext,
  AirBasesBattlesContext,
} from "../../utility/provider.tsx";

import { ships } from "../data/ships.ts";
import { mst_ships } from "../data/mst_ships.ts";
import { slot_items } from "../data/slot_items.ts";
import { mst_slot_itmes } from "../data/mst_slot_items.ts";
import { air_bases } from "../data/air_bases.ts";

import { ports_1_5 } from "../data/1-5/ports.ts";
import { cells_1_5 } from "../data/1-5/cells.ts";
import { cells_1_6 } from "../data/1-6/cells.ts";
import { ports_1_6 } from "../data/1-6/ports.ts";
import { cells_2_5 } from "../data/2-5/cells.ts";
import { ports_2_5 } from "../data/2-5/ports.ts";
import { cells_3_5 } from "../data/3-5/cells.ts";
import { ports_3_5 } from "../data/3-5/ports.ts";
import { cells_4_5 } from "../data/4-5/cells.ts";
import { ports_4_5 } from "../data/4-5/ports.ts";
import { cells_5_5 } from "../data/5-5/cells.ts";
import { ports_5_5 } from "../data/5-5/ports.ts";
import { ports_6_5 } from "../data/6-5/ports.ts";
import { cells_6_5 } from "../data/6-5/cells.ts";
import { airbases_6_5 } from "../data/6-5/airbases.ts";

import { Switch, Match } from "solid-js";

const map_tags = ["1-5", "1-6", "2-5", "3-5", "4-5", "5-5", "6-5"] as const;

export default {
  title: "components/battles/battles",
  component: BattlesComponent,
  tags: ["autodocs"],
  argTypes: {
    map_tag: {
      options: map_tags,
      control: { type: "select" },
      table: {
        type: {
          summary: map_tags.join("\|"),
        },
      },
    },
  },
  render: function Render(args: any) {
    return (
      <Switch>
        <Match when={args.map_tag === "1-5"}>
          <DeckBattlesContext.Provider value={[ports_1_5]}>
            <AirBasesBattlesContext.Provider value={[air_bases]}>
              <CellsContext.Provider value={[cells_1_5]}>
                <BattlesComponent />
              </CellsContext.Provider>
            </AirBasesBattlesContext.Provider>
          </DeckBattlesContext.Provider>
        </Match>
        <Match when={args.map_tag === "1-6"}>
          <DeckBattlesContext.Provider value={[ports_1_6]}>
            <AirBasesBattlesContext.Provider value={[air_bases]}>
              <CellsContext.Provider value={[cells_1_6]}>
                <BattlesComponent />
              </CellsContext.Provider>
            </AirBasesBattlesContext.Provider>
          </DeckBattlesContext.Provider>
        </Match>
        <Match when={args.map_tag === "2-5"}>
          <DeckBattlesContext.Provider value={[ports_2_5]}>
            <AirBasesBattlesContext.Provider value={[air_bases]}>
              <CellsContext.Provider value={[cells_2_5]}>
                <BattlesComponent />
              </CellsContext.Provider>
            </AirBasesBattlesContext.Provider>
          </DeckBattlesContext.Provider>
        </Match>
        <Match when={args.map_tag === "3-5"}>
          <DeckBattlesContext.Provider value={[ports_3_5]}>
            <AirBasesBattlesContext.Provider value={[air_bases]}>
              <CellsContext.Provider value={[cells_3_5]}>
                <BattlesComponent />
              </CellsContext.Provider>
            </AirBasesBattlesContext.Provider>
          </DeckBattlesContext.Provider>
        </Match>
        <Match when={args.map_tag === "4-5"}>
          <DeckBattlesContext.Provider value={[ports_4_5]}>
            <AirBasesBattlesContext.Provider value={[air_bases]}>
              <CellsContext.Provider value={[cells_4_5]}>
                <BattlesComponent />
              </CellsContext.Provider>
            </AirBasesBattlesContext.Provider>
          </DeckBattlesContext.Provider>
        </Match>
        <Match when={args.map_tag === "5-5"}>
          <DeckBattlesContext.Provider value={[ports_5_5]}>
            <AirBasesBattlesContext.Provider value={[air_bases]}>
              <CellsContext.Provider value={[cells_5_5]}>
                <BattlesComponent />
              </CellsContext.Provider>
            </AirBasesBattlesContext.Provider>
          </DeckBattlesContext.Provider>
        </Match>
        <Match when={args.map_tag === "6-5"}>
          <DeckBattlesContext.Provider value={[ports_6_5]}>
            <AirBasesBattlesContext.Provider value={[airbases_6_5]}>
              <CellsContext.Provider value={[cells_6_5]}>
                <BattlesComponent />
              </CellsContext.Provider>
            </AirBasesBattlesContext.Provider>
          </DeckBattlesContext.Provider>
        </Match>
      </Switch>
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
                  <Story {...context.args} />
                </MstShipsContext.Provider>
              </ShipsContext.Provider>
            </SlotItemsContext.Provider>
          </MstSlotItemsContext.Provider>
        </ul>
      );
    },
  ],
};
