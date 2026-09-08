/** @jsxImportSource solid-js */
import { For, Show, type JSX } from "solid-js";

export interface MapAreaItem {
  mapKey: string;
  name?: string;
  badge?: string | number;
  drops?: number;
  badgeClass?: string;
}

export interface MapAreaGroup {
  areaId: string;
  areaName?: string;
  subText?: string | JSX.Element;
  totalAreaDrops?: number;
  maps: Array<string | MapAreaItem>;
}

export interface MapAreaGridProps {
  groups: MapAreaGroup[];
  selectedMapKey?: string;
  onSelect: (mapKey: string) => void;
  getMapName?: (mapKey: string) => string | undefined;
  getAreaName?: (areaId: string) => string | undefined;
}

export const MapAreaGrid = (props: MapAreaGridProps) => {
  return (
    <div class="space-y-6">
      <For each={props.groups}>
        {(area) => {
          const areaTitle = () => {
            if (area.areaName) return `${area.areaId} ${area.areaName}`;
            if (props.getAreaName) {
              const name = props.getAreaName(area.areaId);
              return name ? `${area.areaId} ${name}` : area.areaId;
            }
            return area.areaId;
          };

          const subText = () => {
            if (area.subText) return area.subText;
            if (area.totalAreaDrops !== undefined) return `計 ${area.totalAreaDrops}件`;
            return undefined;
          };

          return (
            <div>
              <h4 class="font-bold text-sm text-base-content/80 mb-3 border-b border-base-200 pb-1 flex justify-between items-center">
                <span>{areaTitle()}</span>
                <Show when={subText()}>
                  {(st) => (
                    <span class="font-mono text-xs text-base-content/60">
                      {st()}
                    </span>
                  )}
                </Show>
              </h4>

              <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                <For each={area.maps}>
                  {(item) => {
                    const mapKey = typeof item === "string" ? item : item.mapKey;
                    const mapName = () => {
                      if (typeof item !== "string" && item.name) return item.name;
                      return props.getMapName ? props.getMapName(mapKey) : undefined;
                    };
                    const badge =
                      typeof item !== "string"
                        ? (item.badge ?? item.drops)
                        : undefined;
                    const badgeClass =
                      typeof item !== "string" && item.badgeClass
                        ? item.badgeClass
                        : "badge badge-accent badge-sm font-mono";
                    const isSelected = () => props.selectedMapKey === mapKey;

                    return (
                      <button
                        type="button"
                        class={`btn h-auto py-2 flex flex-col items-center gap-1 transition-all ${
                          isSelected()
                            ? "btn-primary shadow-sm"
                            : "btn-outline hover:bg-base-200 hover:text-base-content hover:border-base-300"
                        }`}
                        onClick={() => props.onSelect(mapKey)}
                      >
                        <div class="flex items-center gap-2">
                          <span class="font-bold text-base">{mapKey}</span>
                          <Show when={badge !== undefined}>
                            <span class={badgeClass}>{badge}</span>
                          </Show>
                        </div>
                        <Show when={mapName()}>
                          {(name) => (
                            <span class="text-[10px] font-normal opacity-75 max-w-full truncate px-1">
                              {name()}
                            </span>
                          )}
                        </Show>
                      </button>
                    );
                  }}
                </For>
              </div>
            </div>
          );
        }}
      </For>
    </div>
  );
};
