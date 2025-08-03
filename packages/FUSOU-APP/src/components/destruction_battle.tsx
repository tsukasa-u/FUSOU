import { createMemo, For, Match, Show, Switch } from "solid-js";

import "../css/divider.css";
import { SimpleShipNameComponent } from "./simple_ship_name";
import { useAirBases, useCells } from "../utility/provider";
import { EquimentComponent } from "./equipment";
import { SimpleHpBar } from "./simple_hp_bar";
import IconFleetNumber from "../icons/fleet_number";
import { MstEquipmentComponent } from "./mst_equipment";
import type { Cell } from "@ipc-bindings/cells";

interface DestructionBattleProps {
  area_id: number;
  cell: () => Cell;
}

export function DestructionBattleComponent(props: DestructionBattleProps) {
  const [cells] = useCells();
  const [air_bases] = useAirBases();

  const show_destruction_battle = createMemo<boolean>(() => {
    if (Object.keys(cells.cells).length == 0) return false;

    // if (
    //   Object.keys(cells.cells).find(
    //     (cell) => Number(cell) == props.cell_index_selected(),
    //   ) == undefined
    // )
    //   return false;

    // let cell = cells.cells[props.cell_index_selected()];

    if (props.cell() == null || props.cell() == undefined) return false;

    if (
      props.cell().destruction_battle == null ||
      props.cell().destruction_battle == undefined
    )
      return false;
    if (
      props.cell().destruction_battle!.air_base_attack.map_squadron_plane ==
      null
    )
      return false;

    return true;
  });

  const show_damage = createMemo<boolean[][]>(() => {
    let show_damage: boolean[][] = [
      [false, false, false, false, false, false, false],
      [false, false, false, false, false, false, false],
    ];
    // let cell = cells.cells[props.cell_index_selected()];
    if (props.cell() == null || props.cell() == undefined) return show_damage;
    if (
      props.cell().destruction_battle == null ||
      props.cell().destruction_battle == undefined
    )
      return show_damage;

    if (props.cell().destruction_battle!.air_base_attack.e_damage.bak_flag) {
      props
        .cell()
        .destruction_battle!.air_base_attack.e_damage!.bak_flag!.forEach(
          (flag, idx) => {
            show_damage[0][idx] ||= flag == 1;
          }
        );
    }
    if (props.cell().destruction_battle!.air_base_attack.e_damage.rai_flag) {
      props
        .cell()
        .destruction_battle!.air_base_attack.e_damage!.rai_flag!.forEach(
          (flag, idx) => {
            show_damage[0][idx] ||= flag == 1;
          }
        );
    }
    if (props.cell().destruction_battle!.air_base_attack.f_damage.bak_flag) {
      props
        .cell()
        .destruction_battle!.air_base_attack.f_damage!.bak_flag!.forEach(
          (flag, idx) => {
            show_damage[1][idx] ||= flag == 1;
          }
        );
    }
    if (props.cell().destruction_battle!.air_base_attack.f_damage.rai_flag) {
      props
        .cell()
        .destruction_battle!.air_base_attack.f_damage!.rai_flag!.forEach(
          (flag, idx) => {
            show_damage[1][idx] ||= flag == 1;
          }
        );
    }
    return show_damage;
  });

  return (
    <Show when={show_destruction_battle()}>
      <li>
        <details open={true}>
          <summary>Destruction Battle</summary>
          <div class="flex felx-nowrap text-xs py-0.5 pl-4">
            Formation : <span class="w-1" />
            <For each={props.cell().destruction_battle!.formation.slice(0, 2)}>
              {(formation, index) => (
                <>
                  <Switch fallback={<div>_</div>}>
                    <Match when={formation == 1}>
                      <div
                        class={index() == 0 ? "text-lime-500" : "text-red-500"}
                      >
                        Line Ahead
                      </div>
                    </Match>
                    <Match when={formation == 2}>
                      <div
                        class={index() == 0 ? "text-lime-500" : "text-red-500"}
                      >
                        Double Line
                      </div>
                    </Match>
                    <Match when={formation == 3}>
                      <div
                        class={index() == 0 ? "text-lime-500" : "text-red-500"}
                      >
                        Diamond
                      </div>
                    </Match>
                    <Match when={formation == 4}>
                      <div
                        class={index() == 0 ? "text-lime-500" : "text-red-500"}
                      >
                        Echelon
                      </div>
                    </Match>
                    <Match when={formation == 5}>
                      <div
                        class={index() == 0 ? "text-lime-500" : "text-red-500"}
                      >
                        Line Abreast
                      </div>
                    </Match>
                    <Match when={formation == 6}>
                      <div
                        class={index() == 0 ? "text-lime-500" : "text-red-500"}
                      >
                        Vanguard
                      </div>
                    </Match>
                  </Switch>
                  <Show when={index() == 0}>
                    <span class="w-4">/</span>
                  </Show>
                </>
              )}
            </For>
            <div class="divider divider-horizontal mr-0 ml-0" />
            Air State :{" "}
            <Switch fallback={<div class="w-6 flex justify-center">_</div>}>
              <Match
                when={
                  props.cell().destruction_battle!.air_base_attack!
                    .air_superiority == 0
                }
              >
                <div class="text-lime-500 pl-1">Air Supremacy</div>
              </Match>
              <Match
                when={
                  props.cell().destruction_battle!.air_base_attack!
                    .air_superiority == 1
                }
              >
                <div class="text-lime-500 pl-1">Air Superiority</div>
              </Match>
              {/* <Match when={props.cell().destruction_battle!.air_base_attack!
                    .air_superiority == 2}>
                <div class="text-grey-500 pl-1">Air Parity</div>
              </Match>
              <Match when={props.cell().destruction_battle!.air_base_attack!
                    .air_superiority == 3}>
                <div class="text-red-500 pl-1">Air Denial</div>
              </Match> */}
              <Match
                when={
                  props.cell().destruction_battle!.air_base_attack!
                    .air_superiority == 4
                }
              >
                <div class="text-red-500 pl-1">Air Incapability</div>
              </Match>
            </Switch>
            <div class="divider divider-horizontal mr-0 ml-0" />
            touch : <span class="w-1" />
            <div class="w-6 flex justify-center">
              <Show
                when={
                  (props.cell().destruction_battle!.air_base_attack!.f_damage!
                    .touch_plane ?? 0) > 0
                }
                fallback={<div>_</div>}
              >
                <MstEquipmentComponent
                  equip_id={
                    props.cell().destruction_battle!.air_base_attack!.f_damage!
                      .touch_plane!
                  }
                  name_flag={true}
                  compact={true}
                  show_param={true}
                />
              </Show>
            </div>
            <div class="w-6 flex justify-center">
              <Show
                when={
                  (props.cell().destruction_battle!.air_base_attack!.e_damage!
                    .touch_plane ?? 0) > 0
                }
                fallback={<div>_</div>}
              >
                <MstEquipmentComponent
                  equip_id={
                    props.cell().destruction_battle!.air_base_attack!.e_damage!
                      .touch_plane!
                  }
                  name_flag={true}
                  compact={true}
                  show_param={true}
                />
              </Show>
            </div>
          </div>
          <ul class="pl-0">
            <table class="table table-xs">
              <thead>
                <tr>
                  <th>From</th>
                  <th>HP</th>
                  <th>To</th>
                  <th>HP</th>
                  <th>Attack</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <div class="flex flex-col">
                      <For
                        each={Object.keys(
                          props.cell().destruction_battle!.air_base_attack
                            .map_squadron_plane!
                        )}
                      >
                        {(base_id) => (
                          <For
                            each={
                              air_bases.bases[
                                (props.area_id << 16) | Number(base_id)
                              ].plane_info
                            }
                          >
                            {(plane, idx) => (
                              <>
                                <Show when={plane != null}>
                                  <Show when={idx() > 0}>
                                    <div class="h-px" />
                                  </Show>
                                  <EquimentComponent
                                    slot_id={plane.slotid}
                                    name_flag={true}
                                  />
                                </Show>
                              </>
                            )}
                          </For>
                        )}
                      </For>
                    </div>
                  </td>
                  <td />
                  <td>
                    <For
                      each={
                        props.cell().destruction_battle!.air_base_attack
                          .e_damage.damages
                      }
                    >
                      {(_, idx) => (
                        <>
                          <Show when={show_damage()[0][idx()]}>
                            <Show when={idx() > 0}>
                              <div class="h-px" />
                            </Show>
                            <div class="flex flex-nowrap">
                              <IconFleetNumber
                                class="h-6 -mt-1 pr-1"
                                e_flag={1}
                                fleet_number={1}
                                ship_number={idx() + 1}
                                combined_flag={false}
                              />
                              <SimpleShipNameComponent
                                ship_id={
                                  props.cell().destruction_battle!.ship_ke[
                                    idx()
                                  ]
                                }
                                ship_max_hp={
                                  props.cell().destruction_battle?.e_maxhps[
                                    idx()
                                  ] ?? 0
                                }
                                ship_param={null}
                                ship_slot={
                                  props.cell().destruction_battle?.e_slot[
                                    idx()
                                  ]!
                                }
                              />
                            </div>
                          </Show>
                        </>
                      )}
                    </For>
                  </td>
                  <td>
                    <div class="flex flex-col">
                      <For
                        each={
                          props.cell().destruction_battle!.air_base_attack
                            .e_damage.damages ?? []
                        }
                      >
                        {(_, idx) => (
                          <>
                            <Show when={show_damage()[0][idx()]}>
                              <SimpleHpBar
                                v_now={() =>
                                  props.cell().destruction_battle!
                                    .air_base_attack.e_damage.now_hps![idx()]
                                }
                                v_max={() =>
                                  props.cell().destruction_battle?.e_nowhps[
                                    idx()
                                  ] ?? 0
                                }
                              />
                            </Show>
                          </>
                        )}
                      </For>
                    </div>
                  </td>
                  <td>
                    <For
                      each={
                        props.cell().destruction_battle!.air_base_attack
                          .e_damage.damages
                      }
                    >
                      {(dmg, idx) => (
                        <>
                          <Show when={show_damage()[0][idx()]}>
                            <Show when={idx() > 0}>
                              <div class="h-[4px]" />
                            </Show>
                            <div>{dmg}</div>
                          </Show>
                        </>
                      )}
                    </For>
                  </td>
                </tr>
                <tr>
                  <td>
                    <div class="flex flex-col">
                      <For
                        each={
                          props.cell().destruction_battle!.air_base_attack
                            .e_damage.plane_from
                        }
                      >
                        {(plane_flag, idx) => (
                          <>
                            <Show when={plane_flag != -1}>
                              <Show when={idx() > 0}>
                                <div class="h-px" />
                              </Show>
                              <div class="flex flex-nowrap">
                                <IconFleetNumber
                                  class="h-6 -mt-1 pr-1"
                                  e_flag={1}
                                  fleet_number={1}
                                  ship_number={idx() + 1}
                                  combined_flag={false}
                                />
                                <SimpleShipNameComponent
                                  ship_id={
                                    props.cell().destruction_battle!.ship_ke[
                                      idx()
                                    ]
                                  }
                                  ship_max_hp={
                                    props.cell().destruction_battle?.e_maxhps[
                                      idx()
                                    ] ?? 0
                                  }
                                  ship_param={null}
                                  ship_slot={
                                    props.cell().destruction_battle?.e_slot[
                                      idx()
                                    ]!
                                  }
                                />
                              </div>
                            </Show>
                          </>
                        )}
                      </For>
                    </div>
                  </td>
                  <td>
                    <div class="flex flex-col">
                      <For
                        each={
                          props.cell().destruction_battle!.air_base_attack
                            .e_damage.plane_from
                        }
                      >
                        {(plane_flag, idx) => (
                          <>
                            <Show when={plane_flag != -1}>
                              <SimpleHpBar
                                v_now={() =>
                                  props.cell().destruction_battle!
                                    .air_base_attack.e_damage.now_hps![idx()]
                                }
                                v_max={() =>
                                  props.cell().destruction_battle?.e_nowhps[
                                    idx()
                                  ] ?? 0
                                }
                              />
                            </Show>
                          </>
                        )}
                      </For>
                    </div>
                  </td>
                  <td>
                    <For
                      each={
                        props.cell().destruction_battle!.air_base_attack
                          .f_damage.damages
                      }
                    >
                      {(_, idx) => (
                        <>
                          <Show when={show_damage()[1][idx()]}>
                            <Show when={idx() > 0}>
                              <div class="h-px" />
                            </Show>
                            <div class="flex flex-nowrap">
                              {/* <IconFleetNumber
                                class="h-6 -mt-1 pr-1"
                                e_flag={1}
                                fleet_number={1}
                                ship_number={idx() + 1}
                                combined_flag={false}
                              /> */}
                              {
                                air_bases.bases[
                                  (props.area_id << 16) | (idx() + 1)
                                ].name
                              }
                            </div>
                          </Show>
                        </>
                      )}
                    </For>
                  </td>
                  <td>
                    <div class="flex flex-col">
                      <For
                        each={
                          props.cell().destruction_battle!.air_base_attack
                            .f_damage.damages ?? []
                        }
                      >
                        {(_, idx) => (
                          <>
                            <Show when={show_damage()[1][idx()]}>
                              <SimpleHpBar
                                v_now={() =>
                                  props.cell().destruction_battle!
                                    .air_base_attack.f_damage.now_hps![idx()]
                                }
                                v_max={() =>
                                  props.cell().destruction_battle?.f_nowhps[
                                    idx()
                                  ] ?? 0
                                }
                              />
                            </Show>
                          </>
                        )}
                      </For>
                    </div>
                  </td>
                  <td>
                    <For
                      each={
                        props.cell().destruction_battle!.air_base_attack
                          .f_damage.damages
                      }
                    >
                      {(dmg, idx) => (
                        <>
                          <Show when={show_damage()[1][idx()]}>
                            <div>{dmg}</div>
                          </Show>
                        </>
                      )}
                    </For>
                  </td>
                </tr>
              </tbody>
            </table>
          </ul>
        </details>
      </li>
    </Show>
  );
}
