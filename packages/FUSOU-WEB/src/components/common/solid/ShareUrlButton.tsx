/** @jsxImportSource solid-js */
import type { JSX } from "solid-js";

type Props = {
  id?: string;
  class?: string;
  disabled?: boolean;
  onClick: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
};

export function ShareUrlButton(props: Props): JSX.Element {
  return (
    <button
      id={props.id}
      type="button"
      class={`btn btn-sm btn-ghost gap-1.5 ${props.class ?? ""}`.trim()}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
        />
      </svg>
      共有URL
    </button>
  );
}
