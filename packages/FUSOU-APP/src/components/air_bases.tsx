import { useAirBases } from "../utility/provider.tsx";

// import "../css/divider.css";
import { createMemo, For, JSX } from "solid-js";
import IconChevronRightS from "../icons/chevron_right_s.tsx";

import "shared-ui";
import { get_data_set_equip } from "../utility/get_data_set.tsx";

export function AirBasesComponent() {
  const [air_bases] = useAirBases();

  const store_equip_data_set = createMemo(() => {
    const slot_id_list = Object.values(air_bases.bases)
      .map((base) => base?.plane_info)
      .flat()
      .map((palne) => palne?.slotid)
      .filter((id) => id)
      .map((id) => id!);
    return get_data_set_equip(slot_id_list);
  });

  const cond_state = createMemo<JSX.Element[][]>(() => {
    const set_cond_state = (cond: number): JSX.Element => {
      let cond_state: JSX.Element = <></>;
      if (cond == 1) cond_state = <></>;
      else if (cond == 2)
        cond_state = (
          <div class="h-4 w-4">
            <icon-caution-fill level={"middle"} size="full" />
          </div>
        );
      else if (cond == 3)
        cond_state = (
          <div class="h-4 w-4">
            <icon-caution-fill level={"high"} size="full" />
          </div>
        );
      return cond_state;
    };

    const states: JSX.Element[][] = [];
    Object.values(air_bases.bases).forEach((base) => {
      states.push([]);
      const state: JSX.Element[] = [];
      if (base) {
        base.plane_info.forEach((plane) => {
          state.push(set_cond_state(plane.cond ?? 0));
        });
      }
    });
    return states;
  });

  const base_action_state = createMemo<JSX.Element[]>(() => {
    const base_action_state: JSX.Element[] = [];
    Object.values(air_bases.bases).forEach((base) => {
      if (base?.action_kind == 1) base_action_state.push("Sortie");
      else if (base?.action_kind == 2) base_action_state.push("Defense");
      else if (base?.action_kind == 3) base_action_state.push("Evacuation");
      else if (base?.action_kind == 4) base_action_state.push("Rest");
      else if (base?.action_kind == 0) base_action_state.push("Standby");
      else base_action_state.push("Unknown");
    });
    return base_action_state;
  });

  return (
    <>
      <li>
        <details>
          <summary>Air Base</summary>
          <ul class="pl-0">
            <For
              each={Object.entries(air_bases.bases)}
              fallback={
                <div class="text-xs py-2">Loading Air Base Data ...</div>
              }
            >
              {([base_id, base], base_index) => (
                <>
                  <li>
                    <details>
                      <summary class="flex">
                        {Number(base_id) >> 16}
                        {"-"}
                        {Number(base_id) & 0xffff}
                        <div class="w-4">
                          <IconChevronRightS class="h-4 w-4" />
                        </div>
                        <div class="truncate w-32">{base?.name}</div>
                        <div class="divider divider-horizontal mr-0 ml-0 flex-none" />
                        <div class="flex-none">R : {base?.distance}</div>
                        <div class="divider divider-horizontal mr-0 ml-0 flex-none" />
                        <div class="flex-none">
                          {base_action_state()[base_index()]}
                        </div>
                        <span class="flex-auto" />
                      </summary>
                      <ul class="pl-0">
                        <For
                          each={base?.plane_info.filter(
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
                                      <div class="w-58">
                                        <component-equipment-modal
                                          size="xs"
                                          attr:onslot={plane.count ?? 0}
                                          slot_item={
                                            store_equip_data_set()[plane.slotid]
                                              ?.slot_item
                                          }
                                          mst_slot_item={
                                            store_equip_data_set()[plane.slotid]
                                              ?.mst_slot_item
                                          }
                                          name_flag={true}
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
                                        <div class="badge badge-md border-base-300 w-9 text-nowrap">
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
