import { ShipNameComponent } from "./ship_name";

import { createMemo, For, Show } from "solid-js";

import "../css/divider.css";
// import { SimpleShipNameComponent } from "./simple_ship_name";
import type { Battle } from "@ipc-bindings/battle";
import IconShield from "../icons/shield";
import { SimpleHpBar } from "./simple_hp_bar";
import { useDeckPorts, useShips } from "../utility/provider";
import IconFleetNumber from "../icons/fleet_number";
import { MstEquipmentComponent } from "./mst_equipment";
import "shared-ui";
import { DataSetParamShip, DataSetShip } from "src/utility/get_data_set";

interface ShellingProps {
  deck_ship_id: { [key: number]: number[] };
  battle_selected: () => Battle;
  shelling_idx: number;
  store_data_set_deck_ship: () => DataSetShip;
  store_data_set_param_ship: () => DataSetParamShip;
}

export function ShellingComponent(props: ShellingProps) {
  const [ships] = useShips();
  const [deck_ports] = useDeckPorts();

  const show_shelling = createMemo<boolean>(() => {
    if (props.battle_selected()) {
      let hougeki = props.battle_selected().hougeki ?? undefined;
      if (props.battle_selected().deck_id && props.battle_selected().hougeki) {
        if (hougeki) {
          if (hougeki[props.shelling_idx]) return true;
        }
      }
    }
    return false;
  });

  const hougeki = createMemo(() => {
    if (!show_shelling()) return undefined;
    let hougeki = props.battle_selected().hougeki ?? undefined;
    return hougeki ? (hougeki[props.shelling_idx] ?? undefined) : undefined;
  });

  return (
    <Show when={show_shelling()}>
      <li>
        <details open={true}>
          <summary>Shelling</summary>
          <ul class="pl-0">
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
                <For each={hougeki()?.at_list}>
                  {(at, at_index) => (
                    <tr class="rounded">
                      <td>
                        <div class="flex flex-nowarp">
                          <Show
                            when={hougeki().at_eflag[at_index()] == 0}
                            fallback={
                              <>
                                <icon-fleet-number
                                  size="xs"
                                  e_flag={1}
                                  fleet_number={1}
                                  ship_number={at + 1}
                                  combined_flag={
                                    props.battle_selected().enemy_ship_id
                                      ?.length == 12
                                  }
                                />
                                <component-ship-masked-modal
                                  size="xs"
                                  ship_max_hp={
                                    props.store_data_set_param_ship()
                                      .e_ship_max_hp[at]
                                  }
                                  ship_param={
                                    props.store_data_set_param_ship()
                                      .e_ship_param[at]
                                  }
                                  ship_slot={
                                    props.store_data_set_param_ship()
                                      .e_ship_slot[at]
                                  }
                                  mst_ship={
                                    props.store_data_set_param_ship()
                                      .e_mst_ship[at]
                                  }
                                  mst_slot_items={
                                    props.store_data_set_param_ship()
                                      .e_mst_slot_items[at]
                                  }
                                  color={
                                    props.store_data_set_param_ship().e_color[
                                      at
                                    ]
                                  }
                                  empty_flag={false}
                                  name_flag={true}
                                />
                              </>
                            }
                          >
                            <>
                              <icon-fleet-number
                                size="xs"
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
                          when={hougeki().at_eflag[at_index()] == 0}
                          fallback={
                            <SimpleHpBar
                              v_now={() => hougeki().e_now_hps[at_index()][at]}
                              v_max={() => props.battle_selected().e_hp_max[at]}
                            />
                          }
                        >
                          <SimpleHpBar
                            v_now={() => hougeki().f_now_hps[at_index()][at]}
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
                          <For each={hougeki().df_list[at_index()]}>
                            {(df, df_index) => (
                              <div class="flex flex-nowarp">
                                <Show
                                  when={hougeki().at_eflag[at_index()] == 1}
                                  fallback={
                                    <>
                                      <icon-fleet-number
                                        size="xs"
                                        e_flag={1}
                                        fleet_number={1}
                                        ship_number={df + 1}
                                        combined_flag={
                                          props.battle_selected().enemy_ship_id
                                            ?.length == 12
                                        }
                                      />
                                      <component-ship-masked-modal
                                        size="xs"
                                        ship_max_hp={
                                          props.store_data_set_param_ship()
                                            .e_ship_max_hp[df]
                                        }
                                        ship_param={
                                          props.store_data_set_param_ship()
                                            .e_ship_param[df]
                                        }
                                        ship_slot={
                                          props.store_data_set_param_ship()
                                            .e_ship_slot[df]
                                        }
                                        mst_ship={
                                          props.store_data_set_param_ship()
                                            .e_mst_ship[df]
                                        }
                                        mst_slot_items={
                                          props.store_data_set_param_ship()
                                            .e_mst_slot_items[df]
                                        }
                                        color={
                                          props.store_data_set_param_ship()
                                            .e_color[df]
                                        }
                                        empty_flag={false}
                                        name_flag={true}
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
                                    hougeki().protect_flag[at_index()][
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
                          <For each={hougeki().df_list[at_index()]}>
                            {(df) => (
                              <div class="flex flex-nowarp">
                                <Show
                                  when={hougeki().at_eflag[at_index()] == 1}
                                  fallback={
                                    <SimpleHpBar
                                      v_now={() =>
                                        hougeki().e_now_hps[at_index()][df]
                                      }
                                      v_max={() =>
                                        props.battle_selected().e_hp_max[df]
                                      }
                                    />
                                  }
                                >
                                  <SimpleHpBar
                                    v_now={() =>
                                      hougeki().f_now_hps[at_index()][df]
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
                          <For each={hougeki().damage[at_index()]}>
                            {(dmg, dmg_index) => (
                              <div
                                class={(() => {
                                  let cl_flag =
                                    hougeki().cl_list[at_index()][dmg_index()];
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
                      <td>
                        <div
                          class={
                            hougeki().df_list[at_index()].length == 1
                              ? "flex flex-nowrap"
                              : "flex flex-col"
                          }
                        >
                          <Show when={hougeki().si_list[at_index()] != null}>
                            <For each={hougeki().si_list[at_index()]}>
                              {(si) => (
                                <Show when={si != null}>
                                  <MstEquipmentComponent
                                    equip_id={si ?? 0}
                                    name_flag={true}
                                    compact={true}
                                    show_param={
                                      hougeki().at_eflag[at_index()] == 0
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
              </tbody>
            </table>
          </ul>
        </details>
      </li>
    </Show>
  );
}
