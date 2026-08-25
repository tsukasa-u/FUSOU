/** @jsxImportSource solid-js */
import type { JSX } from "solid-js";

type Props = {
  class?: string;
};

export function FilterIcon(props: Props): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      class={props.class ?? "h-4 w-4"}
      fill="none"
      viewBox="0 0 24 24"
      stroke-width="1.5"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M3.75 6.75h16.5L14 14.25v4.5l-4 2v-6.5L3.75 6.75Z"
      />
    </svg>
  );
}
