import {
  useMaterials,
  useMstUseItemMetas,
  useMstUseItems,
} from "../../utility/provider.tsx";

import { createMemo, For, Show } from "solid-js";
import { ComponentItemModal, EmptyValue } from "ui";
import "../../css/divider.css";
import { buildUseItemNameMap } from "../../utility/item_shelves.ts";
import {
  material_icon_name_by_number,
  material_icon_number_by_index,
} from "../ui/icons/material_data";

export function MaterialsComponent() {
  const [materials] = useMaterials();
  const [mstUseItems] = useMstUseItems();
  const [mstUseItemMetas] = useMstUseItemMetas();

  const materialEntries = createMemo(() => Object.values(materials.materials));
  const itemNames = createMemo(() =>
    buildUseItemNameMap(mstUseItems, mstUseItemMetas),
  );

  const show_materials = () => {
    return materialEntries().some((value) => (value ?? 0) > 0);
  };

  return (
    <>
      <li>
        <details open>
          <summary>Materials</summary>
          <ul class="pl-0">
            <Show
              when={show_materials()}
              fallback={
                <li class="text-xs py-2">
                  Loading Material Data ... or resources are completely depleted
                </li>
              }
            >
              <li class="h-auto">
                <div class="flex flex-wrap items-center gap-y-1.5 pl-2">
                  <For each={materialEntries()}>
                    {(material, index) => {
                      return (
                        <div class="flex flex-nowrap items-center shrink-0">
                          <div class="shrink-0">
                            <ComponentItemModal
                              item_number={
                                material_icon_number_by_index[index()] ?? 0
                              }
                              name={
                                material_icon_name_by_number[
                                  material_icon_number_by_index[index()] ?? 0
                                ] ??
                                `Item #${material_icon_number_by_index[index()] ?? 0}`
                              }
                              description=""
                              itemNames={itemNames()}
                              count={material ?? undefined}
                              size="xs"
                            />
                          </div>
                          <div class="w-12 h-6 flex justify-end items-center pr-1 text-xs tabular-nums">
                            <Show
                              when={material !== undefined && material !== null}
                              fallback={
                                <EmptyValue
                                  size="xs"
                                  align="right"
                                  widthClass="w-full"
                                />
                              }
                            >
                              {material}
                            </Show>
                          </div>
                          <Show when={index() < materialEntries().length - 1}>
                            <div class="divider divider-horizontal mr-0 ml-0 my-0.5 h-5" />
                          </Show>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </li>
            </Show>
          </ul>
        </details>
      </li>
    </>
  );
}
