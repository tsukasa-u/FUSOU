import { expect, fn } from "storybook/test";

import { DecksComponent } from "../../components/deck_port/decks.tsx";
import {
  DeckPortsContext,
  MstMissionsContext,
  ShipsContext,
  MstShipsContext,
  MstSlotItemsContext,
  SlotItemsContext,
} from "../../utility/provider.tsx";
import type { MstMissions } from "@ipc-bindings/get_data.ts";
import type { DeckPorts } from "@ipc-bindings/port.ts";

import { ships } from "@fusou-testdata-ipc/ships.ts";
import { mst_ships } from "@fusou-testdata-ipc/mst_ships.ts";
import { slot_items } from "@fusou-testdata-ipc/slot_items.ts";
import { mst_slot_itmes } from "@fusou-testdata-ipc/mst_slot_items.ts";
import { deck_port } from "@fusou-testdata-ipc/deck_ports.ts";

export default {
  title: "components/deck_port/decks",
  component: DecksComponent,
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

const mockMstMissions: MstMissions = {
  mst_missions: {
    2: {
      id: 2,
      disp_no: "02",
      maparea_id: 1,
      name: "長距離練習航海",
      time: 30,
      reset_type: 0,
    },
    37: {
      id: 37,
      disp_no: "37",
      maparea_id: 5,
      name: "東京急行",
      time: 165,
      reset_type: 0,
    },
  },
};

export const WithExpeditions = {
  args: {},
  decorators: [
    (Story: any, context: any) => {
      const now = Date.now();
      const deckPortsWithMissions: DeckPorts = {
        ...deck_port,
        deck_ports: {
          ...deck_port.deck_ports,
          ...(deck_port.deck_ports[2]
            ? {
                2: {
                  ...deck_port.deck_ports[2]!,
                  name: "第二艦隊",
                  mission: [1, 2, now + 18 * 60 * 1000, 0],
                },
              }
            : {}),
          ...(deck_port.deck_ports[3]
            ? {
                3: {
                  ...deck_port.deck_ports[3]!,
                  name: "遠征用高速水雷戦隊",
                  mission: [3, 37, now + (2 * 3600 + 15 * 60) * 1000, 0],
                },
              }
            : {}),
        },
      };

      return (
        <ul class="menu menu-xs bg-base-100 w-full pl-0 flex pt-0">
          <MstSlotItemsContext.Provider value={[mst_slot_itmes]}>
            <SlotItemsContext.Provider value={[slot_items]}>
              <ShipsContext.Provider value={[ships]}>
                <MstShipsContext.Provider value={[mst_ships]}>
                  <MstMissionsContext.Provider value={[mockMstMissions]}>
                    <DeckPortsContext.Provider value={[deckPortsWithMissions]}>
                      <Story {...context.args} />
                    </DeckPortsContext.Provider>
                  </MstMissionsContext.Provider>
                </MstShipsContext.Provider>
              </ShipsContext.Provider>
            </SlotItemsContext.Provider>
          </MstSlotItemsContext.Provider>
        </ul>
      );
    },
  ],
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const summaries = Array.from(
      canvasElement.querySelectorAll('[data-testid^="deck-summary-"]'),
    );
    expect(summaries.length).toBeGreaterThanOrEqual(3);

    const firstHeight = summaries[0].getBoundingClientRect().height;
    expect(firstHeight).toBeCloseTo(24, 0);
    for (const summary of summaries) {
      expect(summary.getBoundingClientRect().height).toBeCloseTo(
        firstHeight,
        0,
      );
    }

    const mission2 = canvasElement.querySelector(
      '[data-testid="deck-mission-2"]',
    );
    const mission3 = canvasElement.querySelector(
      '[data-testid="deck-mission-3"]',
    );
    if (mission2 && mission3) {
      expect(mission2.getBoundingClientRect().left).toBeCloseTo(
        mission3.getBoundingClientRect().left,
        0,
      );
    }
  },
};
