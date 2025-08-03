import { ShipNameComponent } from "./ship_name";

import { createMemo, For, Show } from "solid-js";

import "../css/divider.css";
import { SimpleShipNameComponent } from "./simple_ship_name";
import type { Battle } from "@ipc-bindings/battle";
import IconShield from "../icons/shield";
import { SimpleHpBar } from "./simple_hp_bar";
import { useDeckPorts, useShips } from "../utility/provider";
import IconFleetNumber from "../icons/fleet_number";

interface AntiSubmarineProps {
  deck_ship_id: { [key: number]: number[] };
  battle_selected: () => Battle;
}

export function OpeningAntiSubmarineComponent(props: AntiSubmarineProps) {
  const [ships] = useShips();
  const [deck_ports] = useDeckPorts();

  const show_anti_submarine = createMemo<boolean>(() => {
    if (props.battle_selected() == undefined) return false;
    if (props.battle_selected().deck_id == null) return false;
    if (props.battle_selected().opening_taisen == null) return false;
    return true;
  });

  return (
    <Show when={show_anti_submarine()}>
      <li>
        <details open={true}>
          <summary>Opening Anti-submarine</summary>
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
                <For each={props.battle_selected().opening_taisen.at_list}>
                  {(at, at_index) => (
                    <tr class="table_hover table_active rounded">
                      <td>
                        <div class="flex flex-nowarp">
                          <Show
                            when={
                              props.battle_selected().opening_taisen.at_eflag[
                                at_index()
                              ] == 0
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
                                  ship_slot={
                                    props.battle_selected().e_slot![at]
                                  }
                                  ship_param={
                                    props.battle_selected().e_params![at]
                                  }
                                  ship_max_hp={
                                    props.battle_selected().e_hp_max![at]
                                  }
                                  display={false}
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
                            props.battle_selected().opening_taisen.at_eflag[
                              at_index()
                            ] == 0
                          }
                          fallback={
                            <SimpleHpBar
                              v_now={() =>
                                props.battle_selected().opening_taisen
                                  .e_now_hps[at_index()][at]
                              }
                              v_max={() =>
                                props.battle_selected().e_hp_max![at]
                              }
                            />
                          }
                        >
                          <SimpleHpBar
                            v_now={() =>
                              props.battle_selected().opening_taisen.f_now_hps[
                                at_index()
                              ][at]
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
                              props.battle_selected().opening_taisen.df_list[
                                at_index()
                              ]
                            }
                          >
                            {(df, df_index) => (
                              <div class="flex flex-nowarp">
                                <Show
                                  when={
                                    props.battle_selected().opening_taisen
                                      .at_eflag[at_index()] == 1
                                  }
                                  fallback={
                                    <>
                                      <IconFleetNumber
                                        class="h-6 -mt-1 pr-1"
                                        e_flag={1}
                                        fleet_number={1}
                                        ship_number={df + 1}
                                        combined_flag={
                                          props.battle_selected().enemy_ship_id
                                            .length == 12
                                        }
                                      />
                                      <SimpleShipNameComponent
                                        ship_id={
                                          props.battle_selected().enemy_ship_id[
                                            df
                                          ]
                                        }
                                        ship_slot={
                                          props.battle_selected().e_slot![df]
                                        }
                                        ship_param={
                                          props.battle_selected().e_params![df]
                                        }
                                        ship_max_hp={
                                          props.battle_selected().e_hp_max![df]
                                        }
                                        display={true}
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
                                    props.battle_selected().opening_taisen
                                      .protect_flag[at_index()][df_index()] ==
                                    true
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
                              props.battle_selected().opening_taisen.df_list[
                                at_index()
                              ]
                            }
                          >
                            {(df) => (
                              <div class="flex flex-nowarp">
                                <Show
                                  when={
                                    props.battle_selected().opening_taisen
                                      .at_eflag[at_index()] == 1
                                  }
                                  fallback={
                                    <SimpleHpBar
                                      v_now={() =>
                                        props.battle_selected().opening_taisen
                                          .e_now_hps[at_index()][df]
                                      }
                                      v_max={() =>
                                        props.battle_selected().e_hp_max![df]
                                      }
                                    />
                                  }
                                >
                                  <SimpleHpBar
                                    v_now={() =>
                                      props.battle_selected().opening_taisen
                                        .f_now_hps[at_index()][df]
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
                              props.battle_selected().opening_taisen.damage[
                                at_index()
                              ]
                            }
                          >
                            {(dmg, dmg_index) => (
                              <div
                                class={(() => {
                                  let cl_flag =
                                    props.battle_selected().opening_taisen
                                      .cl_list[at_index()][dmg_index()];
                                  if (cl_flag == 0 || dmg == 0) {
                                    return "text-red-500";
                                  } else if (cl_flag == 2) {
                                    return "text-yellow-500";
                                  }
                                })()}
                              >
                                {dmg}
                              </div>
                            )}
                          </For>
                        </div>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </ul>
        </details>
      </li>
    </Show>
  );
}
