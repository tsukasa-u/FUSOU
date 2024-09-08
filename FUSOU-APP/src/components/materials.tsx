import { Slot, component$, useStylesScoped$ } from '@builder.io/qwik';

import { Material } from "./interface/port.tsx";

interface MaterialsProps {
    materials: Material;
}

export const Materials = component$<MaterialsProps>(({ materials }) => {


    useStylesScoped$(`
        div::before, div::after {
          width: 1px;
        }
    `);
    
    const icon_material_name: {[key:number]:string} = {
        0: "icon_material_fuel",
        1: "icon_material_bull",
        2: "icon_material_steel",
        3: "icon_material_bauxite",
        4: "icon_material_bucket",
        5: "icon_material_nail",
        6: "icon_material_barnar",
        7: "icon_material_screw",

    }
    
    return (
        <>
            <li>
                <details open>
                    <summary>
                        <Slot name="icon_material" />
                        Materials
                    </summary>
                    <ul class="pl-0">
                        <li class="h-6">
                            <a class="justify-start gap-0">
                                {materials.materials?.slice(0, 4).map((material, index) => (
                                    <>
                                        <Slot name={icon_material_name[index]} />
                                        <div class="w-10 flex justify-end">
                                            {material}
                                        </div>
                                        <div class="divider divider-horizontal mr-0 ml-0"></div>
                                    </>
                                ))}
                            </a>
                        </li>
                        <li class="h-6">
                            <a class="justify-start gap-0">
                                {materials.materials?.slice(4, 8).map((material, index) => (
                                    <>
                                        <Slot name={icon_material_name[index + 4]} />
                                        <div class="w-10 flex justify-end">
                                            {material}
                                        </div>
                                        <div class="divider divider-horizontal mr-0 ml-0"></div>
                                    </>
                                ))}
                            </a>
                        </li>
                    </ul>
                </details>
            </li>
        </>
    );
});