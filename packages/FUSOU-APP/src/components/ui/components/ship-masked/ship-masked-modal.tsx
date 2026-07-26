import { Component, createSignal, Show } from "solid-js";

import type { MstShip, MstSlotItems } from "@ipc-bindings/get_data";
import {
  default_mst_ship,
  default_mst_slot_items,
} from "@ipc-bindings/default_state/get_data";

import { ComponentShip } from "../ship/ship";
import { ComponentShipMaskedTable } from "./ship-masked-table";

export interface ComponentShipMaskedModalProps {
  mst_ship?: MstShip;
  mst_slot_items?: MstSlotItems;
  size: "xs" | "sm" | "md" | "lg" | "xl";
  color?: string;
  name_flag?: boolean;
  empty_flag?: boolean;
  ship_param: number[];
  ship_slot: number[];
  ship_max_hp: number;
  class?: string;
  classList?: any;
}

export const ComponentShipMaskedModal: Component<ComponentShipMaskedModalProps> = (props) => {
  let dialogRef: HTMLDialogElement | undefined;
  const [showDialog, setShowDialog] = createSignal(false);

  const mst_ship = () => props.mst_ship ?? default_mst_ship;
  const mst_slot_items = () => props.mst_slot_items ?? default_mst_slot_items;

  const open_modal = () => {
    setShowDialog(true);
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
        <ComponentShipMaskedTable
          mst_ship={mst_ship()}
          mst_slot_items={mst_slot_items()}
          ship_max_hp={props.ship_max_hp}
          ship_param={props.ship_param}
          ship_slot={props.ship_slot}
          size={props.size}
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
          mst_ship={mst_ship()}
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
