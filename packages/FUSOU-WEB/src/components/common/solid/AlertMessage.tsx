/** @jsxImportSource solid-js */
import type { ParentProps } from "solid-js";
import { Show } from "solid-js";

type AlertType = "info" | "success" | "warning" | "error";

interface AlertMessageProps {
  type: AlertType;
  title?: string;
  class?: string;
}

function iconPath(type: AlertType): string {
  if (type === "info") {
    return "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z";
  }
  if (type === "success") {
    return "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z";
  }
  return "M12 9v4m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z";
}

export function AlertMessage(props: ParentProps<AlertMessageProps>) {
  const typeTextClass = () => `text-${props.type}`;

  return (
    <div class={`alert alert-${props.type} ${props.class ?? ""}`.trim()}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class={`w-5 h-5 shrink-0 stroke-current ${typeTextClass()}`}
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d={iconPath(props.type)}
        />
      </svg>
      <Show when={props.title} fallback={<span>{props.children}</span>}>
        <div>
          <div class={`font-semibold ${typeTextClass()}`}>{props.title}</div>
          <div class="leading-snug">{props.children}</div>
        </div>
      </Show>
    </div>
  );
}
