import { expect, fn, waitFor } from "storybook/test";
import { createStore, reconcile } from "solid-js/store";
import { onMount } from "solid-js";

import { EquipmentListComponent } from "../../components/specification_table/equipment_list.tsx";
import {
  ShipsContext,
  MstShipsContext,
  MstSlotItemsContext,
  SlotItemsContext,
  MstSlotItemEquipTypesContext,
} from "../../utility/provider.tsx";
import type { SlotItems } from "@ipc-bindings/require_info";
import type {
  MstSlotItemEquipTypes,
  MstSlotItems,
} from "@ipc-bindings/get_data";
import { default_slotitems } from "@ipc-bindings/default_state/require_info";
import {
  default_mst_slot_items,
  default_mst_slotitem_equip_types,
} from "@ipc-bindings/default_state/get_data";

import { ships } from "@fusou-testdata-ipc/ships.ts";
import { mst_ships } from "@fusou-testdata-ipc/mst_ships.ts";
import { slot_items } from "@fusou-testdata-ipc/slot_items.ts";
import { mst_slot_itmes } from "@fusou-testdata-ipc/mst_slot_items.ts";
import { mst_slot_item_equip_types } from "@fusou-testdata-ipc/mst_slot_item_equip_types.ts";

export default {
  title: "components/specification table/equipment_list",
  component: EquipmentListComponent,
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
                  <MstSlotItemEquipTypesContext.Provider
                    value={[mst_slot_item_equip_types]}
                  >
                    <Story {...context.args} />
                  </MstSlotItemEquipTypesContext.Provider>
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
    const [slotItemStore, setSlotItemStore] = createStore<SlotItems>(
      structuredClone(default_slotitems),
    );
    const [mstSlotItemStore, setMstSlotItemStore] = createStore<MstSlotItems>(
      structuredClone(default_mst_slot_items),
    );
    const [equipTypeStore, setEquipTypeStore] =
      createStore<MstSlotItemEquipTypes>(
        structuredClone(default_mst_slotitem_equip_types),
      );

    onMount(() => {
      setTimeout(() => {
        setEquipTypeStore(reconcile(mst_slot_item_equip_types));
        setMstSlotItemStore(reconcile(mst_slot_itmes));
        setSlotItemStore(reconcile(slot_items));
      }, 20);
    });

    return (
      <div
        class="pt-0 pb-0 pl-0 bg-base-100 h-dvh flex flex-col"
        style={{ width: "680px" }}
      >
        <MstSlotItemsContext.Provider value={[mstSlotItemStore]}>
          <SlotItemsContext.Provider value={[slotItemStore]}>
            <ShipsContext.Provider value={[ships]}>
              <MstShipsContext.Provider value={[mst_ships]}>
                <MstSlotItemEquipTypesContext.Provider value={[equipTypeStore]}>
                  <EquipmentListComponent />
                </MstSlotItemEquipTypesContext.Provider>
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

export const SearchModalClearAndResetControls = {
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
                <MstSlotItemEquipTypesContext.Provider
                  value={[mst_slot_item_equip_types]}
                >
                  <EquipmentListComponent />
                </MstSlotItemEquipTypesContext.Provider>
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
    const equipNameTrigger = Array.from(
      canvasElement.querySelectorAll(".specification-header th .btn"),
    ).find((el) => el.textContent?.trim() === "Equip Name") as HTMLElement;
    expect(equipNameTrigger).toBeDefined();
    equipNameTrigger.click();

    const searchDialog = canvasElement.querySelector(
      "#equipment_spec_modal_search_name",
    ) as HTMLDialogElement;
    await waitFor(() => {
      expect(searchDialog.open).toBe(true);
    });

    const modalBox = searchDialog.querySelector(".modal-box") as HTMLElement;
    expect(modalBox.getBoundingClientRect().top).toBeGreaterThan(
      titlebar.getBoundingClientRect().bottom + 8,
    );

    const inputWrapper = searchDialog.querySelector(".input") as HTMLElement;
    const textInput = inputWrapper.querySelector("input") as HTMLInputElement;
    textInput.value = "12.7cm";
    textInput.dispatchEvent(new Event("input", { bubbles: true }));

    await waitFor(() => {
      expect(
        searchDialog.querySelector('button[aria-label="Clear search"]'),
      ).not.toBeNull();
    });

    const clearBtn = searchDialog.querySelector(
      'button[aria-label="Clear search"]',
    ) as HTMLButtonElement;
    const wrapRect = inputWrapper.getBoundingClientRect();
    const clearRect = clearBtn.getBoundingClientRect();
    expect(clearRect.top).toBeGreaterThanOrEqual(wrapRect.top + 1);
    expect(clearRect.bottom).toBeLessThanOrEqual(wrapRect.bottom - 1);

    clearBtn.click();
    await waitFor(() => {
      expect(textInput.value).toBe("");
    });
  },
};
