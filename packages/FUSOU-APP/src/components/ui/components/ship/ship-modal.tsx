import { Component, createSignal, Show } from "solid-js";

import type { Ship } from "@ipc-bindings/port";
import { default_ship } from "@ipc-bindings/default_state/port";

import type { MstShip, MstSlotItems } from "@ipc-bindings/get_data";
import {
  default_mst_ship,
  default_mst_slot_items,
} from "@ipc-bindings/default_state/get_data";

import type { SlotItems } from "@ipc-bindings/require_info";
import { default_slotitems } from "@ipc-bindings/default_state/require_info";

import { ComponentShip } from "./ship";
import { ComponentShipTable } from "./ship-table";

export interface ComponentShipModalProps {
  mst_ship?: MstShip;
  ship?: Ship;
  mst_slot_items?: MstSlotItems;
  slot_items?: SlotItems;
  size: "xs" | "sm" | "md" | "lg" | "xl";
  color?: string;
  name_flag?: boolean;
  empty_flag?: boolean;
  class?: string;
  classList?: any;
}

export const ComponentShipModal: Component<ComponentShipModalProps> = (props) => {
  let dialogRef: HTMLDialogElement | undefined;
  const [showDialog, setShowDialog] = createSignal(false);

  const open_modal = () => {
    setShowDialog(true);
    // Use setTimeout to ensure the dialog element is rendered before calling showModal()
    setTimeout(() => {
      dialogRef?.showModal();
    }, 0);
  };

  const close_modal = (e: Event) => {
    e.preventDefault();
    setShowDialog(false);
  };

  const dialogTemplete = () => (
    <dialog ref={dialogRef} class="modal">
      <div class="modal-box materials overflow-x-hidden">
        <form method="dialog">
          <button
            class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
            onClick={close_modal}
          >
            X
          </button>
        </form>
        <ComponentShipTable
          ship={props.ship ?? default_ship}
          mst_ship={props.mst_ship ?? default_mst_ship}
          mst_slot_items={props.mst_slot_items ?? default_mst_slot_items}
          slot_items={props.slot_items ?? default_slotitems}
          size="sm"
        />
      </div>
      <form method="dialog" class="modal-backdrop" onClick={close_modal}>
        <button>close</button>
      </form>
    </dialog>
  );

  return (
    <Show
      when={!props.empty_flag}
      fallback={
        <div class="w-full cursor-default">
          <ComponentShip
            size={props.size}
            empty_flag={props.empty_flag}
            name_flag={false}
          />
        </div>
      }
    >
      <div class="w-full cursor-pointer" onClick={open_modal}>
        <ComponentShip
          mst_ship={props.mst_ship}
          size={props.size}
          color={props.color}
          name_flag={props.name_flag}
        />
      </div>
      <Show when={showDialog()}>
        {dialogTemplete()}
      </Show>
    </Show>
  );
};
