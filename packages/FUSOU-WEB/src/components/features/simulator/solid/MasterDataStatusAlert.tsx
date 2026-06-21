/* @jsxImportSource solid-js */

import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { useStore } from "@nanostores/solid";
import { masterDataStatusStore } from "@/features/simulator/data-loader";

type AlertVariant = "info" | "success" | "warning";

function statusVariant(
  shipCount: number,
  equipCount: number,
  resultsLength: number,
): AlertVariant {
  if (shipCount > 0 && equipCount > 0) return "success";
  if (shipCount > 0 || equipCount > 0) return "warning";
  if (resultsLength > 0) return "info";
  return "warning";
}

export function MasterDataStatusAlert() {
  const status = useStore(masterDataStatusStore);
  const [detailsOpen, setDetailsOpen] = createSignal(false);

  const variant = createMemo(() =>
    statusVariant(
      status().shipCount,
      status().equipCount,
      status().results.length,
    ),
  );

  const statusText = createMemo(() => {
    const { shipCount, equipCount, results } = status();
    if (shipCount > 0 && equipCount > 0) {
      return `マスターデータ読込済み — 艦 ${shipCount}件 / 装備 ${equipCount}件`;
    }
    if (shipCount > 0 || equipCount > 0) {
      return `一部マスターデータ読込済み — 艦 ${shipCount}件 / 装備 ${equipCount}件`;
    }
    if (results.some((r) => r.status === "pending")) {
      return "マスターデータを読込中...";
    }
    return "マスターデータが未読込です";
  });

  const masterMetaText = createMemo(() => {
    const { masterPeriodTag, masterPeriodRevision } = status();
    if (!masterPeriodTag || masterPeriodRevision == null) return null;
    return `マスターデータ: ${masterPeriodTag} rev${masterPeriodRevision}`;
  });

  const synergyMetaText = createMemo(() => {
    const { synergyMetaText: metaText, hasSynergyData } = status();
    if (metaText) return `装備シナジーデータ: ${metaText}`;
    if (hasSynergyData) return "装備シナジーデータ読込済み";
    return null;
  });

  const hasDetailsToggle = createMemo(
    () =>
      status().results.some((r) => r.status === "failed") ||
      status().shipCount === 0,
  );

  createEffect(() => {
    if (!hasDetailsToggle()) {
      setDetailsOpen(false);
    }
  });

  return (
    <div
      id="data-status"
      data-testid="master-data-status"
      class={`alert text-sm py-2 mb-5 ${
        variant() === "success"
          ? "alert-success"
          : variant() === "info"
            ? "alert-info"
            : "alert-warning"
      }`}
    >
      <Show when={variant() === "info"}>
        <svg
          id="data-status-icon-info"
          class="shrink-0 w-5 h-5 stroke-current text-info"
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="2 2 22 22"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M4 12c0 4.418 3.582 8 8 8s8-3.582 8-8-3.582-8-8-8-8 3.582-8 8Zm8-4v4"
          ></path>
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 16h.01"
          ></path>
        </svg>
      </Show>

      <Show when={variant() === "success"}>
        <svg
          id="data-status-icon-success"
          class="shrink-0 w-5 h-5 stroke-current text-success"
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          ></path>
        </svg>
      </Show>

      <Show when={variant() === "warning"}>
        <svg
          id="data-status-icon-warning"
          class="shrink-0 w-5 h-5 stroke-current text-warning"
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          ></path>
        </svg>
      </Show>

      <span class="flex flex-col leading-tight gap-0.5 flex-1">
        <span class="flex items-center justify-between gap-2">
          <span id="data-status-text" class="text-sm">
            {statusText()}
          </span>
          <Show when={hasDetailsToggle()}>
            <button
              id="data-status-details-toggle"
              class="btn btn-xs btn-ghost"
              title="詳細ロード結果を表示/非表示"
              onClick={() => setDetailsOpen((open) => !open)}
            >
              詳細
            </button>
          </Show>
        </span>

        <Show when={masterMetaText()}>
          <span id="data-status-master-meta" class="text-[11px] opacity-70">
            {masterMetaText()}
          </span>
        </Show>

        <Show when={synergyMetaText()}>
          <span id="data-status-synergy-meta" class="text-[11px] opacity-70">
            {synergyMetaText()}
          </span>
        </Show>

        <Show when={status().results.length > 0}>
          <div id="data-status-details" class={`text-[11px] mt-2 ${detailsOpen() ? "" : "hidden"}`}>
            <For each={status().results}>
              {(result) => {
                const icon =
                  result.status === "success"
                    ? "✓"
                    : result.status === "failed"
                      ? "✗"
                      : "⋯";
                const iconClass =
                  result.status === "success"
                    ? "text-success"
                    : result.status === "failed"
                      ? "text-error"
                      : "text-info";
                const label =
                  result.recordCount != null && result.recordCount > 0
                    ? `${result.name} (${result.recordCount})`
                    : result.name;
                return (
                  <div class="flex items-center gap-1">
                    <span class={iconClass}>{icon}</span>
                    <span class="truncate">{label}</span>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </span>
    </div>
  );
}