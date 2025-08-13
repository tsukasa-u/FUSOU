import { useAirBases } from "../utility/provider.tsx";

import "../css/divider.css";
import { createMemo, For, JSX } from "solid-js";
import { EquimentComponent } from "./equipment.tsx";
import IconCautionFill from "../icons/caution_fill.tsx";
import IconChevronRightS from "../icons/chevron_right_s.tsx";

export function AirBasesComponent() {
  const [air_bases] = useAirBases();

  const cond_state = createMemo<JSX.Element[][]>(() => {
    const set_cond_state = (cond: number): JSX.Element => {
      let cond_state: JSX.Element = <></>;
      if (cond == 1) cond_state = <></>;
      else if (cond == 2)
        cond_state = (
          <IconCautionFill class="h-4 w-4 fill-yellow-500 stroke-2" />
        );
      else if (cond == 3)
        cond_state = <IconCautionFill class="h-4 w-4 fill-red-500 stroke-2" />;
      return cond_state;
    };

    let states: JSX.Element[][] = [];
    Object.entries(air_bases.bases).forEach((base) => {
      states.push([]);
      let state: JSX.Element[] = [];
      base[1].plane_info.forEach((plane) => {
        state.push(set_cond_state(plane.cond ?? 0));
      });
    });
    return states;
  });

  const base_action_state = createMemo<JSX.Element[]>(() => {
    let base_action_state: JSX.Element[] = [];
    Object.entries(air_bases.bases).forEach((base) => {
      if (base[1].action_kind == 1) base_action_state.push("Sortie");
      else if (base[1].action_kind == 2) base_action_state.push("Defense");
      else if (base[1].action_kind == 3) base_action_state.push("Evacuation");
      else if (base[1].action_kind == 4) base_action_state.push("Rest");
      else if (base[1].action_kind == 0) base_action_state.push("Standby");
      else base_action_state.push("Unknown");
    });
    return base_action_state;
  });

  return (
    <>
      <li>
        <details open>
          <summary>Air Base</summary>
          <ul class="pl-0">
            <For
              each={Object.entries(air_bases.bases)}
              fallback={
                <div class="text-xs py-2">Loading Air Base Data ...</div>
              }
            >
              {(base, base_index) => (
                <>
                  <li>
                    <details open>
                      <summary class="flex">
                        {Number(base[0]) >> 16}
                        {"-"}
                        {Number(base[0]) & 0xffff}
                        <div class="w-4">
                          <IconChevronRightS class="h-4 w-4" />
                        </div>
                        <div class="truncate w-32">{base[1].name}</div>
                        <div class="divider divider-horizontal mr-0 ml-0 flex-none" />
                        <div class="flex-none">R : {base[1].distance}</div>
                        <div class="divider divider-horizontal mr-0 ml-0 flex-none" />
                        <div class="flex-none">
                          {base_action_state()[base_index()]}
                        </div>
                        <span class="flex-auto" />
                      </summary>
                      <ul class="pl-0">
                        <For
                          each={base[1].plane_info.filter(
                            (plane) => plane.slotid != 0
                          )}
                          fallback={
                            <li class="h-auto">
                              <div class="text-xs py-2">No Plane Data ...</div>
                            </li>
                          }
                        >
                          {(plane, plane_index) => (
                            <>
                              <li class="h-auto">
                                <a class="justify-start gap-x-0 gap-y-1 flex flex-wrap">
                                  <div class="justify-start gap-0 flex ">
                                    <div
                                      class="pl-2 pr-0.5 flex-1 min-w-12 content-center"
                                      style={{
                                        "overflow-x": "clip",
                                        "overflow-clip-margin":
                                          "content-box 4px",
                                      }}
                                    >
                                      <div class="w-48">
                                        <EquimentComponent
                                          slot_id={plane.slotid}
                                          name_flag={true}
                                          onslot={plane.count ?? 0}
                                        />
                                      </div>
                                    </div>
                                    <div class="divider divider-horizontal mr-0 ml-0 flex-none" />
                                    <div class=" flex-none">
                                      <div class="flex justify-center w-8 indicator">
                                        <div class="indicator-item indicator-top indicator-end">
                                          {
                                            cond_state()[base_index()][
                                              plane_index()
                                            ]
                                          }
                                        </div>
                                        <div class="badge badge-md border-inherit w-9">
                                          --
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </a>
                              </li>
                            </>
                          )}
                        </For>
                      </ul>
                    </details>
                  </li>
                </>
              )}
            </For>
          </ul>
        </details>
      </li>
    </>
  );
}
