/** @jsxImportSource solid-js */
import { For, Show } from "solid-js";
import type { SelectedCellFilter, SortieRoute } from "./types";
import { MAX_SORTIE_ROUTES } from "./constants";

type Props = {
  routes: SortieRoute[];
  selectedRoute: SortieRoute | null | undefined;
  selectedCellFilter: () => SelectedCellFilter | null;
  onSelectById: (id: string) => void;
  isRouteListTruncated: () => boolean;
  filteredRouteCount: () => number;
  cellLabel: (cellId: number, mapKey?: string) => string;
};

export default function SortieListPanel(props: Props) {
  return (
    <Show
      when={props.routes.length > 0}
      fallback={<div class="text-base-content/40">データ読込後に表示されます</div>}
    >
      <div class="mb-4">
        <label class="label py-1">
          <span class="label-text text-xs">表示するソーティー</span>
        </label>
        <select
          class="select select-bordered select-sm w-full max-w-md"
          value={props.selectedRoute?.sortieId || ""}
          onInput={(e) => props.onSelectById(e.currentTarget.value)}
        >
          <For each={props.routes}>
            {(route, idx) => (
              <option value={route.sortieId}>
                #{idx() + 1} {route.mapKey} (通過 {route.steps.length} / 戦闘 {route.battleCount})
              </option>
            )}
          </For>
        </select>
        <Show when={props.selectedCellFilter()}>
          {(selected) => (
            <div class="mt-2 text-xs text-base-content/60">
              {selected().label} に到達した出撃のみ表示中です。
            </div>
          )}
        </Show>
        <Show when={props.isRouteListTruncated()}>
          <div class="mt-2 text-xs text-warning">
            表示件数は {MAX_SORTIE_ROUTES} 件までです。条件に一致する出撃は合計 {props.filteredRouteCount()} 件あります。
          </div>
        </Show>
      </div>

      <Show when={props.selectedRoute}>
        {(selected) => (
          <div class="rounded-box bg-base-200 p-4 mb-4">
            <div class="flex flex-wrap items-center gap-2 mb-3">
              <span class="badge badge-accent badge-sm">
                出発: {props.cellLabel(selected().steps[0]?.cellId ?? -1, selected().mapKey)}
              </span>
              <span class="badge badge-success badge-sm">
                到達: {props.cellLabel(selected().steps[selected().steps.length - 1]?.cellId ?? -1, selected().mapKey)}
              </span>
              <span class="badge badge-ghost badge-sm">{selected().mapKey}</span>
              <span class="badge badge-outline badge-sm">通過 {selected().steps.length}</span>
              <span class="badge badge-outline badge-sm">戦闘 {selected().battleCount}</span>
            </div>

            <div class="overflow-x-auto">
              <table class="table table-zebra table-sm">
                <thead>
                  <tr>
                    <th>順番</th>
                    <th>セル</th>
                    <th>次の移動</th>
                    <th>遭遇敵</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={selected().steps}>
                    {(step, i) => {
                      const next = selected().steps[i() + 1];
                      return (
                        <tr>
                          <td>{`Step ${step.stepNo}`}</td>
                          <td>{props.cellLabel(step.cellId, selected().mapKey)}</td>
                          <td>
                            {next
                              ? `${props.cellLabel(step.cellId, selected().mapKey)} -> ${props.cellLabel(next.cellId, selected().mapKey)}`
                              : "到達"}
                          </td>
                          <td class="text-xs">{step.hasBattle ? step.enemy : "通過のみ"}</td>
                        </tr>
                      );
                    }}
                  </For>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Show>

      <div class="space-y-2">
        <For each={props.routes}>
          {(route, idx) => (
            <div class="p-3 rounded-box bg-base-200 text-sm">
              <div class="flex flex-wrap items-center gap-2 mb-1">
                <span class="badge badge-primary badge-sm">#{idx() + 1}</span>
                <span class="badge badge-ghost badge-sm">{route.mapKey}</span>
                <span class="text-base-content/70">通過 {route.steps.length} / 戦闘 {route.battleCount}</span>
              </div>
              <div class="font-mono text-xs break-all">{route.route}</div>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
