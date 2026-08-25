import { Component, createSignal, Show } from "solid-js";

import type { SlotItem } from "@ipc-bindings/require_info";
import type { MstSlotItem } from "@ipc-bindings/get_data";

import { ComponentEquipment } from "./equipment";
import { ComponentEquipmentTable } from "./equipment-table";

export interface ComponentEquipmentModalProps {
  mst_slot_item?: MstSlotItem;
  slot_item?: SlotItem;
  ex_flag?: boolean;
  name_flag?: boolean;
  attr_onslot?: number;
  hide_onslot?: boolean;
  size: "xs" | "sm" | "md" | "lg" | "xl";
  empty_flag?: boolean;
  class?: string;
  classList?: any;
}

export const ComponentEquipmentModal: Component<ComponentEquipmentModalProps> = (props) => {
  let dialogRef: HTMLDialogElement | undefined;
  const [showDialog, setShowDialog] = createSignal(false);

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
      <div class="modal-box modal-box-width">
        <form method="dialog">
          <button
            class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
            onClick={close_modal}
          >
            X
          </button>
        </form>
        <ComponentEquipmentTable
          slot_item={props.slot_item}
          mst_slot_item={props.mst_slot_item}
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
          <ComponentEquipment
            size={props.size}
            empty_flag={props.empty_flag}
          />
        </div>
      }
    >
      <div class="w-full cursor-pointer" onClick={open_modal}>
        <ComponentEquipment
          slot_item={props.slot_item}
          mst_slot_item={props.mst_slot_item}
          size={props.size}
          name_flag={props.name_flag}
          ex_flag={props.ex_flag}
          attr_onslot={props.attr_onslot}
          hide_onslot={props.hide_onslot}
        />
      </div>
      <Show when={showDialog()}>
        {dialogTemplete()}
      </Show>
    </Show>
  );
};
