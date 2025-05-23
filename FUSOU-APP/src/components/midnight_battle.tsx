import { ShipNameComponent } from "./ship_name";

import { createMemo, For, Show } from "solid-js";

import "../css/divider.css";
import { SimpleShipNameComponent } from "./simple_ship_name";
import { Battle } from "../interface/battle";
import { MstEquipmentComponent } from "./mst_equipment";
import IconShield from "../icons/shield";
import { SimpleHpBar } from "./simple_hp_bar";
import { useDeckPorts, useShips } from "../utility/provider";
import IconFleetNumber from "../icons/fleet_number";

interface MidnightShellingProps {
  deck_ship_id: { [key: number]: number[] };
  battle_selected: () => Battle;
}

export function MidnightShellingComponent(props: MidnightShellingProps) {
  const [ships] = useShips();
  const [deck_ports] = useDeckPorts();

  const show_shelling = createMemo<boolean>(() => {
    if (props.battle_selected() == undefined) return false;
    if (props.battle_selected().deck_id == null) return false;
    if (props.battle_selected().midnight_hougeki == null) return false;
    return true;
  });

  const display_tooltip = () => {
    let tooltip_data = {
      sp_list: props.battle_selected()?.midnight_hougeki?.sp_list,
      si_list: props.battle_selected()?.midnight_hougeki?.si_list,
      at_eflag: props.battle_selected()?.midnight_hougeki?.at_eflag,
    };
    let tool_tip_string = Object.entries(tooltip_data).reduce(
      (acc, [key, value]) => {
        return acc + key + ": " + String(value) + ",\n";
      },
      "",
    );
    return tool_tip_string;
  };

  return (
    <Show when={show_shelling()}>
      <li>
        <details open={true}>
          <summary class="tooltip tooltip-right" data-tip={display_tooltip()}>
            Midnight Shelling
          </summary>
          <ul class="pl-0">
            <div class="pl-2 text-xs flex felx-nowarp">
              touch : <span class="w-1" />
              <div class="w-6 flex justify-center">
                <Show
                  when={props.battle_selected().midngiht_touchplane![0] > 0}
                  fallback={<div>_</div>}
                >
                  <MstEquipmentComponent
                    equip_id={props.battle_selected().midngiht_touchplane![0]}
                    name_flag={true}
                    compact={true}
                    show_param={true}
                  />
                </Show>
              </div>
              <div class="w-6 flex justify-center">
                <Show
                  when={props.battle_selected().midngiht_touchplane![1] > 0}
                  fallback={<div>_</div>}
                >
                  <MstEquipmentComponent
                    equip_id={props.battle_selected().midngiht_touchplane![1]}
                    name_flag={true}
                    compact={true}
                    show_param={true}
                  />
                </Show>
              </div>
              <div class="divider divider-horizontal mr-0 ml-0" />
              Flare : <span class="w-1" />
              <Show
                when={props.battle_selected().midnight_flare_pos != null}
                fallback={
                  <div>
                    <div class="w-24">_</div>
                    <div class="w-3">/</div>
                    <div class="w-24">_</div>
                  </div>
                }
              >
                <div class="w-24 flex justify-center">
                  <Show
                    when={props.battle_selected().midnight_flare_pos![0] != -1}
                    fallback={<div>_</div>}
                  >
                    <ShipNameComponent
                      ship_id={
                        props.deck_ship_id[props.battle_selected().deck_id!][
                          props.battle_selected().midnight_flare_pos![0]
                        ]
                      }
                    />
                  </Show>
                </div>
                <div class="w-3">/</div>
                <div class="w-24 flex justify-center">
                  <Show
                    when={props.battle_selected().midnight_flare_pos![1] != -1}
                    fallback={<div>_</div>}
                  >
                    <SimpleShipNameComponent
                      ship_id={
                        props.battle_selected().enemy_ship_id[
                          props.battle_selected().midnight_flare_pos![1]
                        ]
                      }
                      ship_param={
                        props.battle_selected().e_params![
                          props.battle_selected().midnight_flare_pos![1]
                        ]
                      }
                      ship_slot={
                        props.battle_selected().e_slot![
                          props.battle_selected().midnight_flare_pos![1]
                        ]
                      }
                      ship_max_hp={
                        props.battle_selected().e_hp_max![
                          props.battle_selected().midnight_flare_pos![1]
                        ]
                      }
                    />
                  </Show>
                </div>
              </Show>
            </div>
            <table class="table table-xs">
              <thead>
                <tr>
                  <th>From</th>
                  <th>HP</th>
                  <th>To</th>
                  <th>HP</th>
                  <th>Attack</th>
                  <th>CI</th>
                </tr>
              </thead>
              <tbody>
                <Show
                  when={
                    props.battle_selected().midnight_hougeki?.at_list != null
                  }
                >
                  <For each={props.battle_selected().midnight_hougeki?.at_list}>
                    {(at, at_index) => (
                      <tr class="table_hover table_active rounded">
                        <td>
                          <div class="flex flex-nowrap">
                            <Show
                              when={
                                props.battle_selected().midnight_hougeki
                                  ?.at_eflag![at_index()] == 0
                              }
                              fallback={
                                <>
                                  <IconFleetNumber
                                    class="h-6 -mt-1 pr-1"
                                    e_flag={1}
                                    fleet_number={1}
                                    ship_number={at + 1}
                                    combined_flag={
                                      props.battle_selected().enemy_ship_id
                                        .length == 12
                                    }
                                  />
                                  <SimpleShipNameComponent
                                    ship_id={
                                      props.battle_selected().enemy_ship_id[at]
                                    }
                                    ship_param={
                                      props.battle_selected().e_params![at]
                                    }
                                    ship_slot={
                                      props.battle_selected().e_slot![at]
                                    }
                                    ship_max_hp={
                                      props.battle_selected().e_hp_max![at]
                                    }
                                  />
                                </>
                              }
                            >
                              <>
                                <IconFleetNumber
                                  class="h-6 -mt-1 pr-1"
                                  e_flag={0}
                                  fleet_number={1}
                                  ship_number={at + 1}
                                  combined_flag={deck_ports.combined_flag == 1}
                                />
                                <ShipNameComponent
                                  ship_id={
                                    props.deck_ship_id[
                                      props.battle_selected().deck_id!
                                    ][at]
                                  }
                                />
                              </>
                            </Show>
                          </div>
                        </td>
                        <td>
                          <Show
                            when={
                              props.battle_selected().midnight_hougeki
                                ?.at_eflag![at_index()] == 0
                            }
                            fallback={
                              <SimpleHpBar
                                v_now={() =>
                                  props.battle_selected().midnight_hougeki!
                                    .e_now_hps![at_index()][at]
                                }
                                v_max={() =>
                                  props.battle_selected().e_hp_max![at]
                                }
                              />
                            }
                          >
                            <SimpleHpBar
                              v_now={() =>
                                props.battle_selected().midnight_hougeki!
                                  .f_now_hps![at_index()][at]
                              }
                              v_max={() =>
                                ships.ships[
                                  props.deck_ship_id[
                                    props.battle_selected().deck_id!
                                  ][at]
                                ].maxhp
                              }
                            />
                          </Show>
                        </td>
                        <td>
                          <div class="flex flex-col">
                            <For
                              each={
                                props.battle_selected().midnight_hougeki
                                  ?.df_list![at_index()]
                              }
                            >
                              {(df, df_index) => (
                                <div class="flex flex-nowrap">
                                  <Show
                                    when={
                                      props.battle_selected().midnight_hougeki
                                        ?.at_eflag![at_index()] == 1
                                    }
                                    fallback={
                                      <>
                                        <IconFleetNumber
                                          class="h-6 -mt-1 pr-1"
                                          e_flag={1}
                                          fleet_number={1}
                                          ship_number={df + 1}
                                          combined_flag={
                                            props.battle_selected()
                                              .enemy_ship_id.length == 12
                                          }
                                        />
                                        <SimpleShipNameComponent
                                          ship_id={
                                            props.battle_selected()
                                              .enemy_ship_id[df]
                                          }
                                          ship_param={
                                            props.battle_selected().e_params![
                                              df
                                            ]
                                          }
                                          ship_slot={
                                            props.battle_selected().e_slot![df]
                                          }
                                          ship_max_hp={
                                            props.battle_selected().e_hp_max![
                                              df
                                            ]
                                          }
                                        />
                                      </>
                                    }
                                  >
                                    <>
                                      <IconFleetNumber
                                        class="h-6 -mt-1 pr-1"
                                        e_flag={0}
                                        fleet_number={1}
                                        ship_number={df + 1}
                                        combined_flag={
                                          deck_ports.combined_flag == 1
                                        }
                                      />
                                      <ShipNameComponent
                                        ship_id={
                                          props.deck_ship_id[
                                            props.battle_selected().deck_id!
                                          ][df]
                                        }
                                      />
                                    </>
                                  </Show>
                                  <Show
                                    when={
                                      props.battle_selected().midnight_hougeki
                                        ?.protect_flag![at_index()][
                                        df_index()
                                      ] == true
                                    }
                                  >
                                    <IconShield class="h-5 w-5" />
                                  </Show>
                                </div>
                              )}
                            </For>
                          </div>
                        </td>
                        <td>
                          <div class="flex flex-col">
                            <For
                              each={
                                props.battle_selected().midnight_hougeki
                                  ?.df_list![at_index()]
                              }
                            >
                              {(df) => (
                                <div class="flex flex-nowrap">
                                  <Show
                                    when={
                                      props.battle_selected().midnight_hougeki
                                        ?.at_eflag![at_index()] == 1
                                    }
                                    fallback={
                                      <SimpleHpBar
                                        v_now={() =>
                                          props.battle_selected()
                                            .midnight_hougeki!.e_now_hps![
                                            at_index()
                                          ][df]
                                        }
                                        v_max={() =>
                                          props.battle_selected().e_hp_max![df]
                                        }
                                      />
                                    }
                                  >
                                    <SimpleHpBar
                                      v_now={() =>
                                        props.battle_selected()
                                          .midnight_hougeki!.f_now_hps![
                                          at_index()
                                        ][df]
                                      }
                                      v_max={() =>
                                        ships.ships[
                                          props.deck_ship_id[
                                            props.battle_selected().deck_id!
                                          ][df]
                                        ].maxhp
                                      }
                                    />
                                  </Show>
                                </div>
                              )}
                            </For>
                          </div>
                        </td>
                        <td>
                          <div class="flex flex-col">
                            <For
                              each={
                                props.battle_selected().midnight_hougeki
                                  ?.damage![at_index()]
                              }
                            >
                              {(dmg, dmg_index) => (
                                <Show when={dmg != -1}>
                                  <div
                                    class={(() => {
                                      let cl_flag =
                                        props.battle_selected().midnight_hougeki
                                          ?.cl_list![at_index()][dmg_index()];
                                      if (cl_flag == 0 || dmg == 0) {
                                        return "text-red-500";
                                      } else if (cl_flag == 2) {
                                        return "text-yellow-500";
                                      }
                                    })()}
                                  >
                                    {dmg}
                                  </div>
                                </Show>
                              )}
                            </For>
                          </div>
                        </td>
                        <td>
                          <div
                            class={
                              props.battle_selected().midnight_hougeki
                                ?.df_list![at_index()].length == 1
                                ? "flex flex-nowrap"
                                : "flex flex-col"
                            }
                          >
                            <Show
                              when={
                                props.battle_selected().midnight_hougeki
                                  ?.si_list![at_index()] != null
                              }
                            >
                              <For
                                each={
                                  props.battle_selected().midnight_hougeki
                                    ?.si_list![at_index()]
                                }
                              >
                                {(si) => (
                                  <Show when={si != null}>
                                    <MstEquipmentComponent
                                      equip_id={si ?? 0}
                                      name_flag={true}
                                      compact={true}
                                      show_param={
                                        props.battle_selected().midnight_hougeki
                                          ?.at_eflag![at_index()] == 0
                                      }
                                    />
                                  </Show>
                                )}
                              </For>
                            </Show>
                          </div>
                        </td>
                      </tr>
                    )}
                  </For>
                </Show>
              </tbody>
            </table>
          </ul>
        </details>
      </li>
    </Show>
  );
}
