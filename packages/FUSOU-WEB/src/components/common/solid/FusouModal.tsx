/** @jsxImportSource solid-js */
import { Show, type JSX } from "solid-js";

export interface FusouModalProps {
  ref?: ((el: HTMLDialogElement) => void) | { current: HTMLDialogElement | null } | HTMLDialogElement;
  id?: string;
  title: string | JSX.Element;
  description?: string | JSX.Element;
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "5xl";
  actions?: JSX.Element;
  onClose?: () => void;
  backdropClick?: () => void;
  children: JSX.Element;
  class?: string;
}

export function FusouModal(props: FusouModalProps) {
  const maxWidthClass = () => {
    switch (props.maxWidth) {
      case "sm":
        return "max-w-sm";
      case "lg":
        return "max-w-lg";
      case "xl":
        return "max-w-xl";
      case "2xl":
        return "max-w-2xl";
      case "3xl":
        return "max-w-3xl";
      case "4xl":
        return "max-w-4xl";
      case "5xl":
        return "max-w-5xl";
      case "md":
      default:
        return "max-w-md";
    }
  };

  const assignRef = (el: HTMLDialogElement) => {
    if (typeof props.ref === "function") {
      props.ref(el);
    } else if (props.ref && typeof props.ref === "object" && "current" in props.ref) {
      (props.ref as { current: HTMLDialogElement | null }).current = el;
    }
  };

  return (
    <dialog
      ref={assignRef}
      id={props.id}
      class={`modal ${props.class ?? ""}`.trim()}
      onClose={props.onClose}
    >
      <div class={`modal-box w-11/12 rounded-xl bg-base-100 ${maxWidthClass()}`}>
        <h3 class="mb-1 text-lg font-bold">{props.title}</h3>
        <Show when={props.description}>
          <p class="mb-4 text-xs text-base-content/60">{props.description}</p>
        </Show>

        {props.children}

        <Show when={props.actions}>
          <div class="modal-action">
            {props.actions}
          </div>
        </Show>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button type="submit" aria-label="閉じる" onClick={props.backdropClick}></button>
      </form>
    </dialog>
  );
}

export default FusouModal;
