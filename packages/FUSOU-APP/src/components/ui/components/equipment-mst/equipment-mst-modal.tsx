import { Component, createSignal, Show } from "solid-js";

import type { MstSlotItem } from "@ipc-bindings/get_data";

import { ComponentEquipmentMst } from "./equipment-mst";
import { ComponentEquipmentMstTable } from "./equipment-mst-table";

export interface ComponentEquipmentMstModalProps {
  mst_slot_item?: MstSlotItem;
  name_flag?: boolean;
  show_name?: boolean;
  show_param?: boolean;
  compact?: boolean;
  size: "xs" | "sm" | "md" | "lg" | "xl";
  empty_flag?: boolean;
  class?: string;
  classList?: any;
}

export const ComponentEquipmentMstModal: Component<ComponentEquipmentMstModalProps> = (props) => {
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
      <div class="modal-box materialsmodal-box-width">
        <form method="dialog">
          <button
            class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
            onClick={close_modal}
          >
            X
          </button>
        </form>
        <ComponentEquipmentMstTable
          mst_slot_item={props.mst_slot_item}
          show_param={props.show_param}
          show_name={props.show_name}
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
          <ComponentEquipmentMst
            size={props.size}
            empty_flag={props.empty_flag}
            mst_slot_item={props.mst_slot_item}
            compact={props.compact}
            name_flag={false}
          />
        </div>
      }
    >
      <div class="w-full cursor-pointer" onClick={open_modal}>
        <ComponentEquipmentMst
          mst_slot_item={props.mst_slot_item}
          size={props.size}
          name_flag={props.name_flag}
          compact={props.compact}
          empty_flag={props.empty_flag}
          show_name={props.show_name}
        />
      </div>
      <Show when={showDialog()}>
        {dialogTemplete()}
      </Show>
    </Show>
  );
};
