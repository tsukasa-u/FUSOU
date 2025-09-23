import { useMaterials } from "../../utility/provider.tsx";

import { For, Show } from "solid-js";
import "shared-ui";
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

  const show_materials = () => {
    return Object.values(materials.materials).some((value) => value ?? 0 > 0);
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
                <div class="justify-start gap-0 flex flex-nowrap">
                  <div class="w-[24px]" />
                  <a class="justify-start gap-0 flex flex-wrap gap-y-1">
                    <div class="justify-start gap-0 flex flex-nowrap">
                      <For
                        each={Object.values(materials.materials).slice(0, 4)}
                      >
                        {(material, index) => (
                          <>
                            <div class="h-5 w-5">
                              <icon-material
                                item_number={icon_material_converter[index()]}
                                size="full"
                              />
                            </div>
                            <div class="w-10 flex justify-end pt-0.5">
                              {material ?? "_"}
                            </div>
                            <div class="divider divider-horizontal mr-0 ml-0" />
                          </>
                        )}
                      </For>
                    </div>
                    <div class="justify-start gap-0 flex flex-nowrap">
                      <For
                        each={Object.values(materials.materials).slice(4, 8)}
                      >
                        {(material, index) => (
                          <>
                            <div class="h-5 w-5">
                              <icon-material
                                item_number={
                                  icon_material_converter[index() + 4]
                                }
                                size="full"
                              />
                            </div>
                            <div class="w-10 flex justify-end pt-0.5">
                              {material ?? "_"}
                            </div>
                            <div class="divider divider-horizontal mr-0 ml-0" />
                          </>
                        )}
                      </For>
                    </div>
                  </a>
                </div>
              </li>
            </Show>
          </ul>
        </details>
      </li>
    </>
  );
}
