import { Component, createSignal, Show } from "solid-js";

import type { MstShip } from "@ipc-bindings/get_data";
import { default_mst_ship } from "@ipc-bindings/default_state/get_data";

import { ComponentShipMst } from "./ship";
import { ComponentShipMstTable } from "./ship-table";

export interface ComponentShipMstModalProps {
  mst_ship?: MstShip;
  size: "xs" | "sm" | "md" | "lg" | "xl";
  color?: string;
  name_flag?: boolean;
  empty_flag?: boolean;
  class?: string;
  classList?: any;
}

export const ComponentShipMstModal: Component<ComponentShipMstModalProps> = (props) => {
  let dialogRef: HTMLDialogElement | undefined;
  const [showDialog, setShowDialog] = createSignal(false);

  const mst_ship = () => props.mst_ship ?? default_mst_ship;

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
        <ComponentShipMstTable mst_ship={mst_ship()} />
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
          <ComponentShipMst
            size={props.size}
            empty_flag={props.empty_flag}
            name_flag={false}
          />
        </div>
      }
    >
      <div class="w-full cursor-pointer" onClick={open_modal}>
        <ComponentShipMst
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
