/** @jsxImportSource solid-js */
import { For, Show } from "solid-js";
import { FusouModal } from "@/components/common/solid/FusouModal";
import type { PeriodSummary } from "./types";

type Props = {
  ref: (element: HTMLDialogElement) => void;
  periods: () => PeriodSummary[];
  selectedPeriodIndex: () => number;
  loadingPeriods: () => boolean;
  loading: () => boolean;
  onPeriodChange: (index: number) => void;
  searchQuery?: () => string;
  onSearchChange?: (query: string) => void;
  startDate?: () => string;
  onStartDateChange?: (val: string) => void;
  endDate?: () => string;
  onEndDateChange?: (val: string) => void;
  mapOptions: () => string[];
  mapFilter: () => string;
  onMapFilterChange: (filter: string) => void;
  resultFilter: () => string;
  onResultFilterChange: (filter: string) => void;
  showMapFilter: boolean;
  showResultFilter: boolean;
};

function periodLabel(period: PeriodSummary): string {
  if (period.period_tag === "latest") return "最新期間";
  if (period.period_tag === "all") return "全期間";
  return period.table_version
    ? `${period.period_tag} (v${period.table_version})`
    : period.period_tag;
}

export default function BattleFilterSettingsModal(props: Props) {
  const mapOptions = () => {
    const options = props.mapOptions();
    const currentMap = props.mapFilter();
    return currentMap && !options.includes(currentMap)
      ? [currentMap, ...options]
      : options;
  };

  return (
    <FusouModal
      ref={props.ref}
      id="battle-filter-settings-modal"
      title="検索・フィルター"
      description="表示する戦闘データのキーワード・期間・日付・海域・結果を設定します。"
      maxWidth="md"
      actions={
        <form method="dialog">
          <button type="submit" class="btn btn-primary btn-sm">閉じる</button>
        </form>
      }
    >
      <div class="space-y-4 text-sm">
        <Show when={props.searchQuery && props.onSearchChange}>
          <div class="form-control space-y-1.5">
            <label for="battle-filter-search" class="text-xs font-semibold text-base-content/60">
              キーワード検索
            </label>
            <div class="relative flex items-center">
              <input
                id="battle-filter-search"
                type="search"
                class="input input-bordered input-sm w-full pr-8 text-xs focus:outline-none focus:border-primary focus:ring-0 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
                placeholder="艦名・海域・マス等で検索..."
                value={props.searchQuery?.() ?? ""}
                onInput={(event) => props.onSearchChange?.(event.currentTarget.value)}
              />
              <Show when={props.searchQuery?.()}>
                <button
                  type="button"
                  class="absolute right-2.5 size-4 rounded hover:bg-base-200 flex items-center justify-center text-base-content/40 hover:text-base-content text-xs cursor-pointer"
                  onClick={() => props.onSearchChange?.("")}
                  title="キーワードをクリア"
                >
                  ✕
                </button>
              </Show>
            </div>
          </div>

          {/* キーワード検索とフィルター設定を区切る水平線 */}
          <hr class="border-base-300/80 my-2" />
        </Show>

        <div class="form-control space-y-2">
          <label for="battle-filter-period" class="text-xs font-semibold text-base-content/60">
            期間
          </label>
          <select
            id="battle-filter-period"
            class="select select-bordered select-sm w-full focus:outline-none focus:border-primary focus:ring-0"
            value={props.selectedPeriodIndex().toString()}
            onChange={(event) => props.onPeriodChange(Number(event.currentTarget.value))}
            disabled={props.loadingPeriods() || props.loading()}
          >
            <Show when={props.loadingPeriods()}>
              <option value={props.selectedPeriodIndex().toString()}>読込中...</option>
            </Show>
            <For each={props.periods()}>
              {(period, index) => (
                <option value={index().toString()}>{periodLabel(period)}</option>
              )}
            </For>
          </select>
        </div>

        <Show when={props.startDate && props.onStartDateChange && props.endDate && props.onEndDateChange}>
          <div class="form-control space-y-1.5">
            <label class="text-xs font-semibold text-base-content/60 flex items-center justify-between">
              <span>日付範囲 (カレンダー指定)</span>
              <Show when={props.startDate?.() || props.endDate?.()}>
                <button
                  type="button"
                  class="text-[11px] text-primary hover:underline cursor-pointer"
                  onClick={() => {
                    props.onStartDateChange?.("");
                    props.onEndDateChange?.("");
                  }}
                >
                  リセット
                </button>
              </Show>
            </label>
            <div class="flex items-center gap-2">
              <input
                id="battle-filter-start-date"
                type="date"
                class="input input-bordered input-sm flex-1 text-xs focus:outline-none focus:border-primary focus:ring-0"
                value={props.startDate?.() ?? ""}
                onInput={(event) => props.onStartDateChange?.(event.currentTarget.value)}
                aria-label="絞り込み開始日"
              />
              <span class="text-xs text-base-content/40 select-none">〜</span>
              <input
                id="battle-filter-end-date"
                type="date"
                class="input input-bordered input-sm flex-1 text-xs focus:outline-none focus:border-primary focus:ring-0"
                value={props.endDate?.() ?? ""}
                onInput={(event) => props.onEndDateChange?.(event.currentTarget.value)}
                aria-label="絞り込み終了日"
              />
            </div>
            <p class="text-[10px] text-base-content/40">
              指定した日付範囲の戦闘のみを絞り込みます（開始日・終了日のみの指定も可能）。
            </p>
          </div>
        </Show>

        <Show when={props.showMapFilter}>
          <div class="form-control space-y-2">
            <label for="battle-filter-map" class="text-xs font-semibold text-base-content/60">
              海域
            </label>
            <select
              id="battle-filter-map"
              class="select select-bordered select-sm w-full focus:outline-none focus:border-primary focus:ring-0"
              value={props.mapFilter()}
              onChange={(event) => props.onMapFilterChange(event.currentTarget.value)}
            >
              <option value="">全海域</option>
              <For each={mapOptions()}>
                {(map) => <option value={map}>{map}</option>}
              </For>
            </select>
          </div>
        </Show>

        <Show when={props.showResultFilter}>
          <div class="form-control space-y-2">
            <label for="battle-filter-result" class="text-xs font-semibold text-base-content/60">
              戦闘結果
            </label>
            <select
              id="battle-filter-result"
              class="select select-bordered select-sm w-full focus:outline-none focus:border-primary focus:ring-0"
              value={props.resultFilter()}
              onChange={(event) => props.onResultFilterChange(event.currentTarget.value)}
            >
              <option value="">全結果</option>
              <option value="S">S勝利</option>
              <option value="A">A勝利</option>
              <option value="B">B勝利</option>
              <option value="C">C敗北</option>
              <option value="D">D敗北</option>
            </select>
          </div>
        </Show>
      </div>
    </FusouModal>
  );
}
