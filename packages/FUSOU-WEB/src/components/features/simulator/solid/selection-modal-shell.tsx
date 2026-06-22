/** @jsxImportSource solid-js */

import type { JSX } from "solid-js";

export function SelectionModalShell(props: {
  id: string;
  dialogRef?: (el: HTMLDialogElement) => void;
  dialogClass?: string;
  boxClass?: string;
  onClose?: () => void;
  children: JSX.Element;
}): JSX.Element {
  const dialogClass = () =>
    `modal modal-middle z-1200${props.dialogClass ? " " + props.dialogClass : ""}`;
  const boxClass = () =>
    `modal-box p-0 flex flex-col rounded-xl relative z-1201 h-[80vh] max-h-[800px] ${props.boxClass ?? ""}`.trim();

  return (
    <dialog
      id={props.id}
      ref={props.dialogRef}
      class={dialogClass()}
      onClose={props.onClose}
    >
      <div class={boxClass()}>{props.children}</div>
      <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  );
}