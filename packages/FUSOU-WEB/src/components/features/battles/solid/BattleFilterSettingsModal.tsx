/** @jsxImportSource solid-js */
import { For, Show } from "solid-js";
import type { PeriodSummary } from "./types";

type Props = {
  ref: (element: HTMLDialogElement) => void;
  periods: () => PeriodSummary[];
  selectedPeriodIndex: () => number;
  loadingPeriods: () => boolean;
  loading: () => boolean;
  onPeriodChange: (index: number) => void;
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
    <dialog ref={props.ref} class="modal">
      <div class="modal-box w-11/12 max-w-md rounded-xl bg-base-100">
        <h3 class="mb-1 text-lg font-bold">フィルター</h3>
        <p class="mb-4 text-xs text-base-content/60">
          表示する戦闘データの期間・海域・結果を設定します。
        </p>

        <div class="space-y-4 text-sm">
          <div class="form-control space-y-2">
            <label for="battle-filter-period" class="text-xs font-semibold text-base-content/60">
              期間
            </label>
            <select
              id="battle-filter-period"
              class="select select-bordered select-sm w-full"
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

          <Show when={props.showMapFilter}>
            <div class="form-control space-y-2">
              <label for="battle-filter-map" class="text-xs font-semibold text-base-content/60">
                海域
              </label>
              <select
                id="battle-filter-map"
                class="select select-bordered select-sm w-full"
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
                class="select select-bordered select-sm w-full"
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

        <div class="modal-action">
          <form method="dialog">
            <button type="submit" class="btn btn-primary btn-sm">閉じる</button>
          </form>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button type="submit" aria-label="閉じる"></button>
      </form>
    </dialog>
  );
}
