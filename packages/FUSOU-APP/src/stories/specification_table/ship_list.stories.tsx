import { expect, fn, waitFor } from "storybook/test";
import { createStore, reconcile } from "solid-js/store";
import { onMount } from "solid-js";

import { ShipListComponent } from "../../components/specification_table/ship_list.tsx";
import {
  ShipsContext,
  MstShipsContext,
  MstSlotItemsContext,
  SlotItemsContext,
  MstStypesContext,
} from "../../utility/provider.tsx";
import type { Ships } from "@ipc-bindings/port";
import type { MstShips, MstStypes } from "@ipc-bindings/get_data";
import { default_ships } from "@ipc-bindings/default_state/port";
import {
  default_mst_ships,
  default_mst_stypes,
} from "@ipc-bindings/default_state/get_data";

import { ships } from "@fusou-testdata-ipc/ships.ts";
import { mst_ships } from "@fusou-testdata-ipc/mst_ships.ts";
import { slot_items } from "@fusou-testdata-ipc/slot_items.ts";
import { mst_slot_itmes } from "@fusou-testdata-ipc/mst_slot_items.ts";
import { mst_stypes } from "@fusou-testdata-ipc/mst_stypes.ts";

export default {
  title: "components/specification table/ship_list",
  component: ShipListComponent,
  tags: ["autodocs"],
  // Use `fn` to spy on the onClick arg, which will appear in the actions panel once invoked: https://storybook.js.org/docs/essentials/actions#action-args
  args: { onClick: fn() },
};

export const WithDecorator = {
  args: {},
  decorators: [
    (Story: any, context: any) => {
      return (
        <div class="pt-0 pb-0 pl-0 bg-base-100 h-dvh flex flex-col">
          <MstSlotItemsContext.Provider value={[mst_slot_itmes]}>
            <SlotItemsContext.Provider value={[slot_items]}>
              <ShipsContext.Provider value={[ships]}>
                <MstShipsContext.Provider value={[mst_ships]}>
                  <MstStypesContext.Provider value={[mst_stypes]}>
                    <Story {...context.args} />
                  </MstStypesContext.Provider>
                </MstShipsContext.Provider>
              </ShipsContext.Provider>
            </SlotItemsContext.Provider>
          </MstSlotItemsContext.Provider>
        </div>
      );
    },
  ],
};

export const AsyncHydratedUncategorizedScroll = {
  render: () => {
    const [shipStore, setShipStore] = createStore<Ships>(
      structuredClone(default_ships),
    );
    const [mstShipStore, setMstShipStore] = createStore<MstShips>(
      structuredClone(default_mst_ships),
    );
    const [mstStypeStore, setMstStypeStore] = createStore<MstStypes>(
      structuredClone(default_mst_stypes),
    );

    onMount(() => {
      setTimeout(() => {
        setMstStypeStore(reconcile(mst_stypes));
        setMstShipStore(reconcile(mst_ships));
        setShipStore(reconcile(ships));
      }, 20);
    });

    return (
      <div
        class="pt-0 pb-0 pl-0 bg-base-100 h-dvh flex flex-col"
        style={{ width: "680px" }}
      >
        <MstSlotItemsContext.Provider value={[mst_slot_itmes]}>
          <SlotItemsContext.Provider value={[slot_items]}>
            <ShipsContext.Provider value={[shipStore]}>
              <MstShipsContext.Provider value={[mstShipStore]}>
                <MstStypesContext.Provider value={[mstStypeStore]}>
                  <ShipListComponent />
                </MstStypesContext.Provider>
              </MstShipsContext.Provider>
            </ShipsContext.Provider>
          </SlotItemsContext.Provider>
        </MstSlotItemsContext.Provider>
      </div>
    );
  },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    await waitFor(
      () => {
        const tbody = canvasElement.querySelector(".specification-vlist tbody");
        const rightBtn = canvasElement.querySelector(
          '[data-spec-scroll="header-right"]',
        ) as HTMLButtonElement | null;
        expect(tbody?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
        expect(rightBtn?.disabled).toBe(false);
      },
      { timeout: 3000 },
    );

    const header = canvasElement.querySelector(
      ".specification-header",
    ) as HTMLDivElement;
    const vlist = canvasElement.querySelector(
      ".specification-vlist",
    ) as HTMLDivElement;
    const rightBtn = canvasElement.querySelector(
      '[data-spec-scroll="header-right"]',
    ) as HTMLButtonElement;
    const leftBtn = canvasElement.querySelector(
      '[data-spec-scroll="header-left"]',
    ) as HTMLButtonElement;

    rightBtn.click();
    await waitFor(() => {
      expect(vlist.scrollLeft).toBeGreaterThan(0);
      expect(header.scrollLeft).toBe(vlist.scrollLeft);
      expect(leftBtn.disabled).toBe(false);
    });

    const beforeWheel = vlist.scrollLeft;
    const wheelEvent = new WheelEvent("wheel", {
      deltaY: 120,
      bubbles: true,
      cancelable: true,
    });
    header.dispatchEvent(wheelEvent);
    expect(wheelEvent.defaultPrevented).toBe(true);
    const afterWheel = vlist.scrollLeft;
    expect(afterWheel).toBeGreaterThan(beforeWheel);
    expect(header.scrollLeft).toBe(afterWheel);

    leftBtn.click();
    await waitFor(() => {
      expect(vlist.scrollLeft).toBeLessThan(afterWheel);
      expect(header.scrollLeft).toBe(vlist.scrollLeft);
    });
  },
};

export const FilterModalsTitlebarOffsetAndSearchControls = {
  render: () => (
    <div id="root" class="flex flex-col bg-base-100">
      <header
        data-tauri-drag-region
        class="h-8 shrink-0 bg-[#27272a] text-[#f1f5f9] flex items-center px-3 text-xs"
      >
        FUSOU
      </header>
      <div class="window-content-container flex-1 min-h-0 flex flex-col">
        <MstSlotItemsContext.Provider value={[mst_slot_itmes]}>
          <SlotItemsContext.Provider value={[slot_items]}>
            <ShipsContext.Provider value={[ships]}>
              <MstShipsContext.Provider value={[mst_ships]}>
                <MstStypesContext.Provider value={[mst_stypes]}>
                  <ShipListComponent />
                </MstStypesContext.Provider>
              </MstShipsContext.Provider>
            </ShipsContext.Provider>
          </SlotItemsContext.Provider>
        </MstSlotItemsContext.Provider>
      </div>
    </div>
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const titlebar = canvasElement.querySelector(
      "header[data-tauri-drag-region]",
    ) as HTMLElement;

    // Open Ship Name search modal
    const shipNameTrigger = Array.from(
      canvasElement.querySelectorAll(".specification-header th .btn"),
    ).find((el) => el.textContent?.trim() === "Ship Name") as HTMLElement;
    expect(shipNameTrigger).toBeDefined();
    shipNameTrigger.click();

    const searchDialog = canvasElement.querySelector(
      "#ship_spec_modal_search_name",
    ) as HTMLDialogElement;
    await waitFor(() => {
      expect(searchDialog.open).toBe(true);
    });

    const modalBox = searchDialog.querySelector(".modal-box") as HTMLElement;
    const titlebarRect = titlebar.getBoundingClientRect();
    const dialogRect = searchDialog.getBoundingClientRect();
    const boxRect = modalBox.getBoundingClientRect();

    // Backdrop starts at/below titlebar and modal-box keeps space below titlebar
    expect(dialogRect.top).toBeGreaterThanOrEqual(titlebarRect.bottom - 0.5);
    expect(boxRect.top).toBeGreaterThan(titlebarRect.bottom + 8);

    // All four corners remain rounded
    const boxStyle = window.getComputedStyle(modalBox);
    expect(parseFloat(boxStyle.borderTopLeftRadius)).toBeGreaterThan(0);
    expect(parseFloat(boxStyle.borderTopRightRadius)).toBeGreaterThan(0);
    expect(parseFloat(boxStyle.borderBottomLeftRadius)).toBeGreaterThan(0);
    expect(parseFloat(boxStyle.borderBottomRightRadius)).toBeGreaterThan(0);

    // Verify in-frame search input + clear (×) button geometry
    const inputWrapper = searchDialog.querySelector(".input") as HTMLElement;
    const textInput = inputWrapper.querySelector("input") as HTMLInputElement;
    const searchBtn = searchDialog.querySelector(
      'button[aria-label="Search"]',
    ) as HTMLButtonElement;

    expect(
      searchDialog.querySelector('button[aria-label="Clear search"]'),
    ).toBeNull();

    textInput.value = "吹雪";
    textInput.dispatchEvent(new Event("input", { bubbles: true }));

    await waitFor(() => {
      expect(
        searchDialog.querySelector('button[aria-label="Clear search"]'),
      ).not.toBeNull();
    });

    const clearBtn = searchDialog.querySelector(
      'button[aria-label="Clear search"]',
    ) as HTMLButtonElement;
    const resetBtn = Array.from(searchDialog.querySelectorAll("button")).find(
      (btn) => btn.textContent?.trim() === "Reset Filter",
    ) as HTMLButtonElement;
    expect(resetBtn.disabled).toBe(false);

    const wrapRect = inputWrapper.getBoundingClientRect();
    for (const btn of [clearBtn, searchBtn]) {
      const btnRect = btn.getBoundingClientRect();
      expect(btnRect.top).toBeGreaterThanOrEqual(wrapRect.top + 1);
      expect(btnRect.bottom).toBeLessThanOrEqual(wrapRect.bottom - 1);
      expect(btnRect.right).toBeLessThanOrEqual(wrapRect.right - 1);
    }

    clearBtn.click();
    await waitFor(() => {
      expect(textInput.value).toBe("");
      expect(resetBtn.disabled).toBe(true);
    });

    const doneBtn = Array.from(searchDialog.querySelectorAll("button")).find(
      (btn) => btn.textContent?.trim() === "Done",
    ) as HTMLButtonElement;
    doneBtn.click();
    await waitFor(() => {
      expect(searchDialog.open).toBe(false);
    });

    // Open Level range filter modal and test Reset Filter clears inputs cleanly
    const levelTrigger = Array.from(
      canvasElement.querySelectorAll(".specification-header th .btn"),
    ).find((el) => el.textContent?.trim() === "Level") as HTMLElement;
    expect(levelTrigger).toBeDefined();
    levelTrigger.click();

    const lvDialog = canvasElement.querySelector(
      "#ship_spec_modal_Level",
    ) as HTMLDialogElement;
    await waitFor(() => {
      expect(lvDialog.open).toBe(true);
    });

    const lvResetBtn = Array.from(lvDialog.querySelectorAll("button")).find(
      (btn) => btn.textContent?.trim() === "Reset Filter",
    ) as HTMLButtonElement;
    expect(lvResetBtn.disabled).toBe(true);

    const minInput = lvDialog.querySelector(
      'input[placeholder="Min"]',
    ) as HTMLInputElement;
    minInput.value = "50";
    minInput.dispatchEvent(new Event("input", { bubbles: true }));

    await waitFor(() => {
      expect(lvResetBtn.disabled).toBe(false);
    });

    lvResetBtn.click();
    await waitFor(() => {
      expect(minInput.value).toBe("");
      expect(lvResetBtn.disabled).toBe(true);
    });

    // Verify dark theme .btn-ghost active/hover background is visibly distinct from dark base-100
    const darkProbe = document.createElement("div");
    darkProbe.setAttribute("data-theme", "dark");
    darkProbe.className = "bg-base-100 p-2";
    const ghostIdle = document.createElement("button");
    ghostIdle.className = "btn btn-ghost btn-xs";
    ghostIdle.textContent = "Idle";
    const ghostActive = document.createElement("button");
    ghostActive.className = "btn btn-ghost btn-xs btn-active";
    ghostActive.textContent = "Active";
    darkProbe.append(ghostIdle, ghostActive);
    canvasElement.appendChild(darkProbe);

    expect(window.getComputedStyle(ghostActive).backgroundColor).not.toBe(
      window.getComputedStyle(ghostIdle).backgroundColor,
    );
    expect(window.getComputedStyle(ghostActive).backgroundColor).not.toBe(
      window.getComputedStyle(darkProbe).backgroundColor,
    );
    darkProbe.remove();
  },
};
