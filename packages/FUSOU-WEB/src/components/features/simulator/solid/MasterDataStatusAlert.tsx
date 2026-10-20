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
      status().shipCount === 0 ||
      status().results.length > 0,
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
      class="rounded-lg border border-base-300 p-2.5 bg-base-200/40 text-xs mb-3 space-y-1"
    >
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          <span
            class={`w-2 h-2 rounded-full shrink-0 ${
              variant() === "success"
                ? "bg-success"
                : variant() === "info"
                  ? "bg-info"
                  : "bg-warning"
            }`}
          />
          <span id="data-status-text" class="font-semibold text-base-content/90 truncate">
            {statusText()}
          </span>
        </div>
        <Show when={hasDetailsToggle()}>
          <button
            id="data-status-details-toggle"
            type="button"
            class="fusou-btn-ghost btn-xs text-[11px] h-6 min-h-0 px-2 shrink-0"
            title="詳細ロード結果を表示/非表示"
            onClick={() => setDetailsOpen((open) => !open)}
          >
            {detailsOpen() ? "閉じる" : "詳細"}
          </button>
        </Show>
      </div>

      <div class="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-base-content/60 pl-4">
        <Show when={masterMetaText()}>
          <span id="data-status-master-meta">
            {masterMetaText()}
          </span>
        </Show>
        <Show when={synergyMetaText()}>
          <span id="data-status-synergy-meta">
            {synergyMetaText()}
          </span>
        </Show>
      </div>

      <Show when={status().results.length > 0 && detailsOpen()}>
        <div id="data-status-details" class="text-[11px] pt-1.5 mt-1 border-t border-base-300/60 grid grid-cols-2 gap-1 pl-4">
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
    </div>
  );
}
