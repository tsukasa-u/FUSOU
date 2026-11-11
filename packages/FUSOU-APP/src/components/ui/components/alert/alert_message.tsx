import type { JSX, ParentProps } from "solid-js";
import { createSignal, Show } from "solid-js";

export type AlertType = "info" | "success" | "warning" | "error";

export interface AlertMessageProps {
  type: AlertType;
  title?: string;
  class?: string;
  role?: "alert" | "status";
  /** Optional expandable details panel toggled directly inside the alert. */
  details?: JSX.Element;
  detailsLabel?: string;
  detailsHideLabel?: string;
}

export const ALERT_ICON_PATHS: Record<AlertType, string> = {
  info: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  success: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  warning:
    "M12 9v4m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z",
  error: "M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z",
};

export const ALERT_VARIANT_CLASSES: Record<
  AlertType,
  { alert: string; text: string }
> = {
  info: { alert: "alert-info", text: "text-info" },
  success: { alert: "alert-success", text: "text-success" },
  warning: { alert: "alert-warning", text: "text-warning" },
  error: { alert: "alert-error", text: "text-error" },
};

/**
 * Shared soft-tinted status alert matching FUSOU-WEB alert surfaces.
 */
export function AlertMessage(props: ParentProps<AlertMessageProps>) {
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  const variant = () => ALERT_VARIANT_CLASSES[props.type];
  const role = () =>
    props.role ??
    (props.type === "error" || props.type === "warning" ? "alert" : "status");

  return (
    <div
      role={role()}
      class={`alert items-start ${variant().alert} ${props.class ?? ""}`.trim()}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class={`w-5 h-5 shrink-0 stroke-current mt-0.5 ${variant().text}`}
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d={ALERT_ICON_PATHS[props.type]}
        />
      </svg>
      <div class="min-w-0 flex-1 leading-snug">
        <Show when={props.title}>
          <div class={`font-semibold ${variant().text}`}>{props.title}</div>
        </Show>
        <div>{props.children}</div>
        <Show when={props.details && detailsOpen()}>
          <div class="mt-2 pt-2 border-t border-base-content/15 text-xs text-base-content/75">
            {props.details}
          </div>
        </Show>
      </div>
      <Show when={props.details}>
        <button
          type="button"
          class="btn btn-xs btn-ghost shrink-0 justify-self-end"
          aria-expanded={detailsOpen()}
          onClick={() => setDetailsOpen((prev) => !prev)}
        >
          {detailsOpen()
            ? (props.detailsHideLabel ?? "Hide details")
            : (props.detailsLabel ?? "Show details")}
        </button>
      </Show>
    </div>
  );
}
