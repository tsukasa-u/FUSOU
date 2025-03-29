import { useMaterials } from "../utility/provider.tsx";

import { IconMaterial } from "../icons/material.tsx";

import "../css/divider.css";
import { For } from "solid-js";

export function MaterialsComponent() {
  const icon_material_converter: { [key: number]: number } = {
    0: 30,
    1: 31,
    2: 32,
    3: 33,
    4: 2,
    5: 1,
    6: 3,
    7: 4,
  };

  const [_materials] = useMaterials();

  return (
    <>
      <li>
        <details open>
          <summary>Materials</summary>
          <ul class="pl-0">
            <li class="h-auto">
              <a class="justify-start gap-0 flex flex-wrap gap-y-1">
                <div class="justify-start gap-0 flex flex-nowrap">
                  <For each={Object.values(_materials.materials).slice(0, 4)}>
                    {(material, index) => (
                      <>
                        <IconMaterial
                          item_number={icon_material_converter[index()]}
                          class="h-5 w-5"
                        />
                        <div class="w-10 flex justify-end pt-0.5">
                          {material}
                        </div>
                        <div class="divider divider-horizontal mr-0 ml-0" />
                      </>
                    )}
                  </For>
                </div>
                <div class="justify-start gap-0 flex flex-nowrap">
                  <For each={Object.values(_materials.materials).slice(4, 8)}>
                    {(material, index) => (
                      <>
                        <IconMaterial
                          item_number={icon_material_converter[index() + 4]}
                          class="h-5 w-5"
                        />
                        <div class="w-10 flex justify-end pt-0.5">
                          {material}
                        </div>
                        <div class="divider divider-horizontal mr-0 ml-0" />
                      </>
                    )}
                  </For>
                </div>
              </a>
            </li>
          </ul>
        </details>
      </li>
    </>
  );
}
