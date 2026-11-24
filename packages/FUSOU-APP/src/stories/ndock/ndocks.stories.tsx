import { expect } from "storybook/test";
import { NDocksComponent } from "../../components/ndock/ndocks.tsx";
import {
  MstShipsContext,
  MstSlotItemsContext,
  NDocksContext,
  ShipsContext,
  SlotItemsContext,
} from "../../utility/provider.tsx";
import type { NDocks } from "@ipc-bindings/port.ts";

import { ships } from "@fusou-testdata-ipc/ships.ts";
import { mst_ships } from "@fusou-testdata-ipc/mst_ships.ts";
import { slot_items } from "@fusou-testdata-ipc/slot_items.ts";
import { mst_slot_itmes } from "@fusou-testdata-ipc/mst_slot_items.ts";

const FIXED_NOW_MS = new Date(2026, 10, 21, 13, 11, 15).getTime();

const sampleShipIds = Object.keys(ships.ships).map(Number);
const firstShipId = sampleShipIds[0] ?? 0;
const secondShipId = sampleShipIds[1] ?? firstShipId;

const mockNDocks: NDocks = {
  n_docks: [
    {
      id: 1,
      state: 1,
      ship_id: firstShipId,
      complete_time: FIXED_NOW_MS + (2 * 3600 + 18 * 60 + 30) * 1000,
      counter: (2 * 3600 + 18 * 60 + 30) * 1000,
      item1: 120,
      item2: 0,
      item3: 240,
      item4: 0,
    },
    {
      id: 2,
      state: 1,
      ship_id: secondShipId,
      complete_time: FIXED_NOW_MS + 45 * 1000,
      counter: 45 * 1000,
      item1: 40,
      item2: 0,
      item3: 80,
      item4: 0,
    },
    {
      id: 3,
      state: 0,
      ship_id: 0,
      complete_time: 0,
      counter: 0,
      item1: 0,
      item2: 0,
      item3: 0,
      item4: 0,
    },
    {
      id: 4,
      state: -1,
      ship_id: 0,
      complete_time: 0,
      counter: 0,
      item1: 0,
      item2: 0,
      item3: 0,
      item4: 0,
    },
  ],
};

export default {
  title: "components/ndock/ndocks",
  component: NDocksComponent,
  tags: ["autodocs"],
  args: { nowMs: FIXED_NOW_MS },
};

export const WithDecorator = {
  args: { nowMs: FIXED_NOW_MS },
  decorators: [
    (Story: any, context: any) => (
      <ul class="menu menu-xs bg-base-100 w-full pl-0 flex pt-0">
        <MstSlotItemsContext.Provider value={[mst_slot_itmes]}>
          <SlotItemsContext.Provider value={[slot_items]}>
            <ShipsContext.Provider value={[ships]}>
              <MstShipsContext.Provider value={[mst_ships]}>
                <NDocksContext.Provider value={[mockNDocks]}>
                  <Story {...context.args} />
                </NDocksContext.Provider>
              </MstShipsContext.Provider>
            </ShipsContext.Provider>
          </SlotItemsContext.Provider>
        </MstSlotItemsContext.Provider>
      </ul>
    ),
  ],
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const timerCells = Array.from(
      canvasElement.querySelectorAll('[data-testid="ndock-timer-cell"]'),
    );
    const statusCells = Array.from(
      canvasElement.querySelectorAll('[data-testid="ndock-status-cell"]'),
    );
    expect(timerCells.length).toBe(4);
    expect(statusCells.length).toBe(4);

    const firstTimerWidth = timerCells[0].getBoundingClientRect().width;
    const firstStatusLeft = statusCells[0].getBoundingClientRect().left;
    for (const cell of timerCells) {
      expect(cell.getBoundingClientRect().width).toBeCloseTo(
        firstTimerWidth,
        0,
      );
    }
    for (const cell of statusCells) {
      expect(cell.getBoundingClientRect().left).toBeCloseTo(firstStatusLeft, 0);
    }
  },
};
