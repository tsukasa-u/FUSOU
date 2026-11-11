import { useMaterials } from "../../utility/provider.tsx";

import { createMemo, For, Show } from "solid-js";
import { EmptyValue, IconMaterial } from "ui";
import "../../css/divider.css";

export function MaterialsComponent() {
  const icon_material_converter: { [key: number]: number } = {
    0: 31,
    1: 32,
    2: 33,
    3: 34,
    4: 2,
    5: 1,
    6: 3,
    7: 4,
  };

  const [materials] = useMaterials();

  const materialEntries = createMemo(() => Object.values(materials.materials));

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
                    {(material, index) => (
                      <div class="flex flex-nowrap items-center shrink-0">
                        <div class="shrink-0">
                          <IconMaterial
                            item_number={icon_material_converter[index()]}
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
                    )}
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
