import { createMemo, For, Show } from "solid-js";

import { SimpleShipNameComponent } from "./simple_ship_name";
import type { Battle } from "@ipc-bindings/battle";
import { MstEquipmentComponent } from "./mst_equipment";
import IconShield from "../icons/shield";
import { SimpleHpBar } from "./simple_hp_bar";
import IconFleetNumber from "../icons/fleet_number";

interface FriendlyForceAttackProps {
  battle_selected: () => Battle;
}

export function FriendlyForceAttackComponent(props: FriendlyForceAttackProps) {
  const show_shelling = createMemo<boolean>(() => {
    if (props.battle_selected() == undefined) return false;
    if (props.battle_selected().friendly_force_attack == null) return false;
    if (props.battle_selected().friendly_force_attack.fleet_info == null)
      return false;
    if (props.battle_selected().friendly_force_attack.support_hourai == null)
      return false;
    props.battle_selected().friendly_force_attack.support_hourai.hougeki;
    return true;
  });

  return (
    <Show when={show_shelling()}>
      <li>
        <details open={true}>
          <summary>Friendly Force Attack</summary>
          <ul class="pl-0">
            <div class="pl-2 text-xs flex felx-nowarp">
              Flare : <span class="w-1" />
              <Show
                when={
                  props.battle_selected().friendly_force_attack.support_hourai!
                    .flare_pos != null
                }
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
                    when={
                      props.battle_selected().friendly_force_attack!
                        .support_hourai.flare_pos![0] != -1
                    }
                    fallback={<div>_</div>}
                  >
                    <SimpleShipNameComponent
                      ship_id={
                        props.battle_selected().friendly_force_attack!
                          .fleet_info.ship_id[
                          props.battle_selected().friendly_force_attack!
                            .support_hourai.flare_pos![0]
                        ]
                      }
                      ship_param={
                        props.battle_selected().friendly_force_attack!
                          .fleet_info.params[
                          props.battle_selected().friendly_force_attack!
                            .support_hourai.flare_pos![0]
                        ]
                      }
                      ship_slot={
                        props.battle_selected().friendly_force_attack!
                          .fleet_info.slot[
                          props.battle_selected().friendly_force_attack!
                            .support_hourai.flare_pos![0]
                        ]
                   
                        ship_max_hp={
                        props.battle_selected().friendly_force_attack!
                          .fleet_info.now_hps[
                          props.battle_selected().friendly_force_attack!
                            .support_hourai.flare_pos![0]
                        ]
                      }
                    />
                    {/* <ShipNameComponent ship_id={battle_selected().friendly_force_attack.fleet_info.ship_id[battle_selected().friendly_force_attack.support_hourai.flare_pos![0]]}></ShipNameComponent> */}
                  </Show>
                </div>
                <div class="w-3">/</div>
                <div class="w-24 flex justify-center">
                  <Show
                    when={
                      props.battle_selected().friendly_force_attack!
                        .support_hourai.flare_pos![1] != -1
                    }
                    fallback={<div>_</div>}
                  >
                    <SimpleShipNameComponent
                      ship_id={
                        props.battle_selected().enemy_ship_id[
                          props.battle_selected().friendly_force_attack!
                            .support_hourai.flare_pos![1]
                        ]
                      }
                      ship_param={
                        props.battle_selected().e_params![
                          props.battle_selected().friendly_force_attack!
                            .support_hourai.flare_pos![1]
                        ]
                      }
                      ship_slot={
                        props.battle_selected().e_slot![
                          props.battle_selected().friendly_force_attack!
                            .support_hourai.flare_pos![1]
                        ]
                      }
                      ship_max_hp={
                        props.battle_selected().e_hp_max![
                          props.battle_selected().friendly_force_attack!
                            .support_hourai.flare_pos![1]
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
                    props.battle_selected().friendly_force_attack!
                      .support_hourai.hougeki.at_list != null
                  }
                >
                  <For
                    each={
                      props.battle_selected().friendly_force_attack!
                        .support_hourai.hougeki.at_list
                    }
                  >
                    {(at, at_index) => (
                      <tr>
                        <td>
                          <div class="flex flex-nowrap">
                            <Show
                              when={
                                props.battle_selected().friendly_force_attack!
                                  .support_hourai.hougeki.at_eflag![
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
                                  fleet_number={3}
                                  ship_number={at + 1}
                                  combined_flag={false}
                                />
                                <SimpleShipNameComponent
                                  ship_id={
                                    props.battle_selected()
                                      .friendly_force_attack.fleet_info
                                      .ship_id[at]
                                  }
                                  ship_param={
                                    props.battle_selected()
                                      .friendly_force_attack.fleet_info.params[
                                      at
                                    ]
                                  }
                                  ship_slot={
                                    props.battle_selected()
                                      .friendly_force_attack.fleet_info.slot[
                                      at
                                    ]
                                  }
                                  ship_max_hp={
                                    props.battle_selected()
                                      .friendly_force_attack.fleet_info
                                      .now_hps[at]
                                  }
                                />
                              </>
                            </Show>
                          </div>
                        </td>
                        <td>
                          <Show
                            when={
                              props.battle_selected().friendly_force_attack!
                                .support_hourai.hougeki.at_eflag![
                                at_index()
                              ] == 0
                            }
                            fallback={
                              <SimpleHpBar
                                v_now={() =>
                                  props.battle_selected().friendly_force_attack!
                                    .support_hourai.hougeki.e_now_hps[
                                    at_index()
                                  ][at]
                                }
                                v_max={() =>
                                  props.battle_selected().e_hp_max![at]
                                }
                              />
                            }
                          >
                            <SimpleHpBar
                              v_now={() =>
                                props.battle_selected().friendly_force_attack!
                                  .support_hourai.hougeki.f_now_hps![
                                  at_index()
                                ][at]
                              }
                              v_max={() =>
                                props.battle_selected().friendly_force_attack!
                                  .fleet_info.now_hps[at]
                              }
                            />
                          </Show>
                        </td>
                        <td>
                          <div class="flex flex-col">
                            <For
                              each={
                                props.battle_selected().friendly_force_attack!
                                  .support_hourai.hougeki.df_list![at_index()]
                              }
                            >
                              {(df, df_index) => (
                                <div class="flex flex-nowrap">
                                  <Show
                                    when={
                                      props.battle_selected()
                                        .friendly_force_attack.support_hourai!
                                        .hougeki.at_eflag![at_index()] == 1 &&
                                      df != -1
                                    }
                                    fallback={
                                      <>
                                        <IconFleetNumber
                                          class="h-6 -mt-1 pr-1"
                                          e_flag={0}
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
                                        e_flag={1}
                                        fleet_number={3}
                                        ship_number={df + 1}
                                        combined_flag={false}
                                      />
                                      <SimpleShipNameComponent
                                        ship_id={
                                          props.battle_selected()
                                            .friendly_force_attack.fleet_info
                                            .ship_id[df]
                                        }
                                        ship_param={
                                          props.battle_selected()
                                            .friendly_force_attack.fleet_info
                                            .params[df]
                                        }
                                        ship_slot={
                                          props.battle_selected()
                                            .friendly_force_attack.fleet_info
                                            .slot[df]
                                        }
                                        ship_max_hp={
                                          props.battle_selected()
                                            .friendly_force_attack.fleet_info
                                            .now_hps[df]
                                        }
                                      />
                                    </>
                                  </Show>
                                  <Show
                                    when={
                                      props.battle_selected()
                                        .friendly_force_attack.support_hourai!
                                        .hougeki.protect_flag![at_index()][
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
                                props.battle_selected().friendly_force_attack!
                                  .support_hourai.hougeki.df_list![at_index()]
                              }
                            >
                              {(df) => (
                                <Show
                                  when={
                                    props.battle_selected()
                                      .friendly_force_attack.support_hourai!
                                      .hougeki.at_eflag![at_index()] == 0
                                  }
                                  fallback={
                                    <SimpleHpBar
                                      v_now={() =>
                                        props.battle_selected()
                                          .friendly_force_attack!
                                          .support_hourai.hougeki.e_now_hps[
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
                                        .friendly_force_attack.support_hourai!
                                        .hougeki.f_now_hps![at_index()][df]
                                    }
                                    v_max={() =>
                                      props.battle_selected()
                                        .friendly_force_attack.fleet_info
                                        .now_hps[df]
                                    }
                                  />
                                </Show>
                              )}
                            </For>
                          </div>
                        </td>
                        <td>
                          <div class="flex flex-col">
                            <For
                              each={
                                props.battle_selected().friendly_force_attack!
                                  .support_hourai.hougeki.damage![at_index()]
                              }
                            >
                              {(dmg, dmg_index) => (
                                <Show when={dmg != -1}>
                                  <div
                                    class={(() => {
                                      let cl_flag =
                                        props.battle_selected()
                                          .friendly_force_attack!
                                          .support_hourai.hougeki.cl_list![
                                          at_index()
                                        ][dmg_index()];
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
                              props.battle_selected().friendly_force_attack!
                                .support_hourai.hougeki.df_list![at_index()]
                                .length == 1
                                ? "flex flex-nowrap"
                                : "flex flex-col"
                            }
                          >
                            <Show
                              when={
                                props.battle_selected().friendly_force_attack!
                                  .support_hourai.hougeki.si_list![
                                  at_index()
                                ] != null
                              }
                            >
                              <For
                                each={
                                  props.battle_selected().friendly_force_attack!
                                    .support_hourai.hougeki.si_list![
                                    at_index()
                                  ]
                                }
                              >
                                {(si) => (
                                  <Show when={si != null}>
                                    <MstEquipmentComponent
                                      equip_id={si ?? 0}
                                      name_flag={true}
                                      compact={true}
                                      show_param={
                                        props.battle_selected()
                                          .friendly_force_attack!
                                          .support_hourai.hougeki?.at_eflag![
                                          at_index()
                                        ] == 0
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
