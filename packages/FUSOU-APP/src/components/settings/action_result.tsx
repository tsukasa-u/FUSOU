import { For, Show } from "solid-js";

export const SETTING_ROW_BUTTON_SIZE_CLASS = "btn-sm w-full sm:w-48 shrink-0";
export const CONFIRM_BUTTON_SIZE_CLASS = "btn-sm flex-1 sm:flex-none sm:w-40";
export const COMPACT_ROW_BUTTON_SIZE_CLASS = "btn-xs w-20 shrink-0";

export type ResultTone = "success" | "warning" | "error" | "info";

export type ResultField = {
  label: string;
  value: string;
  tone?: ResultTone;
  mono?: boolean;
  truncate?: boolean;
};

export type ActionSummary = {
  fields: ResultField[];
};

const TONE_TEXT_CLASS: Record<ResultTone, string> = {
  success: "text-success",
  warning: "text-warning",
  error: "text-error",
  info: "text-info",
};

export const formatActionTime = () => new Date().toLocaleTimeString();

export const createDesktopRuntimeSummary = (scope: string): ActionSummary => ({
  fields: [
    { label: "Status", value: "Unavailable", tone: "warning" },
    { label: "Scope", value: scope, mono: true, truncate: true },
    { label: "Detail", value: "Desktop runtime required" },
    { label: "Checked", value: formatActionTime(), mono: true },
  ],
});

/**
 * Compact key-value result grid matching the Supabase Session Health summary card.
 */
export function ActionSummaryGrid(props: { summary: ActionSummary | null }) {
  return (
    <Show when={props.summary}>
      {(summary) => (
        <div
          role="status"
          class={`grid grid-cols-2 ${
            summary().fields.length <= 3 ? "sm:grid-cols-3" : "sm:grid-cols-4"
          } gap-3 bg-base-200/40 rounded-lg border border-base-300 px-3.5 py-2.5 text-xs`}
        >
          <For each={summary().fields}>
            {(field) => (
              <div class="min-w-0">
                <div class="text-base-content/55">{field.label}</div>
                <div
                  class={`mt-0.5 ${
                    field.tone
                      ? `${TONE_TEXT_CLASS[field.tone]} font-semibold`
                      : "font-medium"
                  } ${field.mono ? "font-mono tabular-nums" : ""} ${
                    field.truncate ? "truncate" : ""
                  }`.trim()}
                  title={field.truncate ? field.value : undefined}
                >
                  {field.value}
                </div>
              </div>
            )}
          </For>
        </div>
      )}
    </Show>
  );
}
