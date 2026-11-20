import { For, Show } from "solid-js";
import { AlertMessage } from "ui";
import { CONFIRM_BUTTON_SIZE_CLASS } from "./action_result";

export interface RestartRequiredModalProps {
  open: boolean;
  changedLabels: readonly string[];
  restarting: boolean;
  error: string | null;
  onRestartNow: () => void;
  onRestartLater: () => void;
}

export function RestartRequiredModal(props: RestartRequiredModalProps) {
  return (
    <Show when={props.open}>
      <dialog
        class="modal modal-open fusou-restart-modal"
        open
        aria-modal="true"
        aria-labelledby="restart-required-modal-title"
        data-testid="restart-required-modal"
      >
        <div class="modal-box border space-y-4">
          <div class="flex items-start gap-3">
            <div class="mt-0.5 shrink-0 text-warning" aria-hidden="true">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="2"
                stroke="currentColor"
                class="w-5 h-5"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
                />
              </svg>
            </div>
            <div class="space-y-1 min-w-0">
              <h3
                id="restart-required-modal-title"
                class="font-bold text-base leading-snug"
              >
                Restart Required to Apply Changes
              </h3>
              <p class="text-xs text-base-content/70 leading-relaxed">
                Your settings have been saved to{" "}
                <code class="font-mono text-[11px]">configs.toml</code>. Restart
                FUSOU now to apply the updated configuration, or choose Restart
                Later to apply it on the next launch.
              </p>
            </div>
          </div>

          <Show when={props.changedLabels.length > 0}>
            <div class="bg-base-100/75 rounded-lg border border-warning/35 px-3.5 py-2.5 space-y-1.5">
              <div class="text-[11px] font-semibold uppercase tracking-wider text-base-content/60">
                Changes Waiting for Restart ({props.changedLabels.length})
              </div>
              <ul class="flex flex-wrap gap-1.5">
                <For each={props.changedLabels}>
                  {(label) => (
                    <li class="badge badge-sm badge-outline border-base-300 bg-base-100 text-base-content/85">
                      {label}
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </Show>

          <p class="text-xs text-base-content/60">
            Restarting closes the game window and cleanly shuts down the local
            proxy before relaunching FUSOU.
          </p>

          <Show when={props.error}>
            {(err) => (
              <AlertMessage type="error" title="Restart Failed">
                {err()}
              </AlertMessage>
            )}
          </Show>

          <div class="modal-action mt-2">
            <button
              type="button"
              class={`btn btn-outline ${CONFIRM_BUTTON_SIZE_CLASS}`}
              disabled={props.restarting}
              onClick={() => props.onRestartLater()}
            >
              Restart Later
            </button>
            <button
              type="button"
              class={`btn btn-primary enabled:border-primary-content ${CONFIRM_BUTTON_SIZE_CLASS}`}
              disabled={props.restarting}
              onClick={() => props.onRestartNow()}
            >
              <Show when={props.restarting}>
                <span class="loading loading-spinner loading-xs" />
              </Show>
              {props.restarting ? "Restarting..." : "Restart Now"}
            </button>
          </div>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button
            type="button"
            disabled={props.restarting}
            onClick={() => {
              if (!props.restarting) {
                props.onRestartLater();
              }
            }}
          >
            close
          </button>
        </form>
      </dialog>
    </Show>
  );
}
