import { ShipNameComponent } from "./ship_name";

import { createMemo, For, Show } from "solid-js";

import "../css/divider.css";
import { SimpleShipNameComponent } from "./simple_ship_name";
import type { Battle } from "@ipc-bindings/battle";
import { MstEquipmentComponent } from "./mst_equipment";
import IconShield from "../icons/shield";
import { SimpleHpBar } from "./simple_hp_bar";
import { useDeckPorts, useShips } from "../utility/provider";
import IconFleetNumber from "../icons/fleet_number";
import {
  calc_critical,
  get_mst_slot_item,
  type DeckShipIds,
} from "../utility/battles";
import { DataSetParamShip, DataSetShip } from "../utility/get_data_set";

interface MidnightShellingProps {
  deck_ship_id: () => DeckShipIds;
  battle_selected: () => Battle | undefined;
  store_data_set_deck_ship: () => DataSetShip;
  store_data_set_param_ship: () => DataSetParamShip;
}

export function MidnightShellingComponent(props: MidnightShellingProps) {
  const [ships] = useShips();
  const [deck_ports] = useDeckPorts();

  const show_shelling = createMemo<boolean>(() => {
    if (!props.battle_selected()) return false;
    if (!props.battle_selected()?.deck_id) return false;
    if (!props.battle_selected()?.midnight_hougeki) return false;
    return true;
  });

  const midngiht_hougeki = createMemo(() => {
    if (!show_shelling()) return undefined;
    let midnight_hougeki = props.battle_selected()?.midnight_hougeki;
    return midnight_hougeki ?? undefined;
  });

  const diplay_touch = () => {
    let midngiht_touchplane = props.battle_selected()?.midngiht_touchplane;
    let f_midngiht_touchplane =
      (midngiht_touchplane ? midngiht_touchplane[0] : undefined) ?? 0;
    let e_midngiht_touchplane =
      (midngiht_touchplane ? midngiht_touchplane[1] : undefined) ?? 0;
    return (
      <>
        touch : <span class="w-1" />
        <div class="w-6 flex justify-center">
          <Show when={f_midngiht_touchplane > 0} fallback={<div>_</div>}>
            <component-equipment-mst-modal
              size="xs"
              compact={true}
              empty_flag={false}
              name_flag={false}
              show_name={true}
              show_param={true}
              mst_slot_item={get_mst_slot_item(f_midngiht_touchplane)}
            />
          </Show>
        </div>
        <div class="w-6 flex justify-center">
          <Show when={e_midngiht_touchplane > 0} fallback={<div>_</div>}>
            <component-equipment-mst-modal
              size="xs"
              compact={true}
              empty_flag={false}
              name_flag={false}
              show_name={true}
              show_param={false}
              mst_slot_item={get_mst_slot_item(e_midngiht_touchplane)}
            />
          </Show>
        </div>
      </>
    );
  };

  const display_flare = () => {
    let midnight_flare_pos = props.battle_selected()?.midnight_flare_pos;
    let f_midnight_flare_pos = midnight_flare_pos ? midnight_flare_pos[0] : -1;
    let e_midnight_flare_pos = midnight_flare_pos ? midnight_flare_pos[1] : -1;
    let f_ship_id =
      props.deck_ship_id()[props.battle_selected()?.deck_id ?? 1][
        f_midnight_flare_pos
      ];
    return (
      <>
        Flare : <span class="w-1" />
        <Show
          when={!midnight_flare_pos}
          fallback={
            <div>
              <div class="w-24">_</div>
              <div class="w-3">/</div>
              <div class="w-24">_</div>
            </div>
          }
        >
          <div class="w-24 flex justify-center">
            <Show when={f_midnight_flare_pos != -1} fallback={<div>_</div>}>
              <component-ship-modal
                size="xs"
                color=""
                empty_flag={false}
                name_flag={false}
                ship={props.store_data_set_deck_ship()[f_ship_id]?.ship}
                mst_ship={props.store_data_set_deck_ship()[f_ship_id]?.mst_ship}
                slot_items={
                  props.store_data_set_deck_ship()[f_ship_id]?.slot_items
                }
                mst_slot_items={
                  props.store_data_set_deck_ship()[f_ship_id]?.mst_slot_items
                }
              />
            </Show>
          </div>
          <div class="w-3">/</div>
          <div class="w-24 flex justify-center">
            <Show when={e_midnight_flare_pos != -1} fallback={<div>_</div>}>
              <component-ship-masked-modal
                size="xs"
                ship_max_hp={
                  props.store_data_set_param_ship().e_ship_max_hp[
                    e_midnight_flare_pos
                  ]
                }
                ship_param={
                  props.store_data_set_param_ship().e_ship_param[
                    e_midnight_flare_pos
                  ]
                }
                ship_slot={
                  props.store_data_set_param_ship().e_ship_slot[
                    e_midnight_flare_pos
                  ]
                }
                mst_ship={
                  props.store_data_set_param_ship().e_mst_ship[
                    e_midnight_flare_pos
                  ]
                }
                mst_slot_items={
                  props.store_data_set_param_ship().e_mst_slot_items[
                    e_midnight_flare_pos
                  ]
                }
                color={
                  props.store_data_set_param_ship().e_color[
                    e_midnight_flare_pos
                  ]
                }
                empty_flag={false}
                name_flag={false}
              />
            </Show>
          </div>
        </Show>
      </>
    );
  };

  const attacker_ship = (at: number, at_index: () => number) => {
    const at_eflag = midngiht_hougeki()?.at_eflag;
    if (at_eflag) {
      if (at_eflag[at_index()] == 0) {
        let ship_id =
          props.deck_ship_id()[props.battle_selected()?.deck_id ?? 1][at];
        return (
          <td>
            <div class="flex flex-nowrap">
              <icon-fleet-number
                size="xs"
                e_flag={0}
                fleet_number={props.battle_selected()?.deck_id ?? 1}
                ship_number={at + 1}
                combined_flag={deck_ports.combined_flag == 1}
              />
              <component-ship-modal
                size="xs"
                color=""
                empty_flag={false}
                name_flag={true}
                ship={props.store_data_set_deck_ship()[ship_id]?.ship}
                mst_ship={props.store_data_set_deck_ship()[ship_id]?.mst_ship}
                slot_items={
                  props.store_data_set_deck_ship()[ship_id]?.slot_items
                }
                mst_slot_items={
                  props.store_data_set_deck_ship()[ship_id]?.mst_slot_items
                }
              />
            </div>
          </td>
        );
      } else {
        return (
          <td>
            <div class="flex flex-nowrap">
              <icon-fleet-number
                size="xs"
                e_flag={1}
                fleet_number={1}
                ship_number={at + 1}
                combined_flag={
                  props.battle_selected()?.enemy_ship_id?.length == 12
                }
              />
              <component-ship-masked-modal
                size="xs"
                ship_max_hp={
                  props.store_data_set_param_ship().e_ship_max_hp[at]
                }
                ship_param={props.store_data_set_param_ship().e_ship_param[at]}
                ship_slot={props.store_data_set_param_ship().e_ship_slot[at]}
                mst_ship={props.store_data_set_param_ship().e_mst_ship[at]}
                mst_slot_items={
                  props.store_data_set_param_ship().e_mst_slot_items[at]
                }
                color={props.store_data_set_param_ship().e_color[at]}
                empty_flag={false}
                name_flag={true}
              />
            </div>
          </td>
        );
      }
    } else {
      return (
        <td>
          <div class="flex flex-nowrap">
            <icon-fleet-number
              size="xs"
              e_flag={0}
              fleet_number={0}
              ship_number={0}
              combined_flag={false}
            />
            <component-ship-masked-modal
              size="xs"
              ship_max_hp={0}
              ship_param={[0, 0, 0, 0]}
              ship_slot={[0, 0, 0, 0]}
              mst_ship={undefined}
              mst_slot_items={undefined}
              color=""
              empty_flag={false}
              name_flag={true}
            />
          </div>
        </td>
      );
    }
  };

  return (
    <Show when={show_shelling()}>
      <li>
        <details open={true}>
          <summary>Midnight Shelling</summary>
          <ul class="pl-0">
            <div class="pl-2 text-xs flex felx-nowarp">
              {diplay_touch()}
              <div class="divider divider-horizontal mr-0 ml-0" />
              {display_flare()}
            </div>
            <table class="table table-xs">
              <thead>
                <tr>
                  <th>Attack</th>
                  <th>HP</th>
                  <th>Defense</th>
                  <th>HP</th>
                  <th>Damage</th>
                  <th>CI</th>
                </tr>
              </thead>
              <tbody>
                <Show when={!midngiht_hougeki()?.at_list}>
                  <For each={midngiht_hougeki()?.at_list}>
                    {(at, at_index) => (
                      <tr class="rounded">
                        {attacker_ship(at, at_index)}
                        <td>
                          <Show
                            when={midngiht_hougeki()?.at_eflag[at_index()] == 0}
                            fallback={
                              <SimpleHpBar
                                v_now={() =>
                                  midngiht_hougeki()!.e_now_hps[at_index()][at]
                                }
                                v_max={() =>
                                  props.battle_selected().e_hp_max[at]
                                }
                              />
                            }
                          >
                            <SimpleHpBar
                              v_now={() =>
                                midngiht_hougeki()!.f_now_hps[at_index()][at]
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
                            <For each={midngiht_hougeki()?.df_list[at_index()]}>
                              {(df, df_index) => (
                                <div class="flex flex-nowrap">
                                  <Show
                                    when={
                                      midngiht_hougeki()?.at_eflag[
                                        at_index()
                                      ] == 1
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
                                            props.battle_selected().e_params[df]
                                          }
                                          ship_slot={
                                            props.battle_selected().e_slot[df]
                                          }
                                          ship_max_hp={
                                            props.battle_selected().e_hp_max[df]
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
                                      midngiht_hougeki()?.protect_flag[
                                        at_index()
                                      ][df_index()] == true
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
                            <For each={midngiht_hougeki()?.df_list[at_index()]}>
                              {(df) => (
                                <div class="flex flex-nowrap">
                                  <Show
                                    when={
                                      midngiht_hougeki()?.at_eflag[
                                        at_index()
                                      ] == 1
                                    }
                                    fallback={
                                      <SimpleHpBar
                                        v_now={() =>
                                          props.battle_selected()
                                            .midnight_hougeki.e_now_hps[
                                            at_index()
                                          ][df]
                                        }
                                        v_max={() =>
                                          props.battle_selected().e_hp_max[df]
                                        }
                                      />
                                    }
                                  >
                                    <SimpleHpBar
                                      v_now={() =>
                                        midngiht_hougeki().f_now_hps[
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
                            <For each={midngiht_hougeki()?.damage[at_index()]}>
                              {(dmg, dmg_index) => (
                                <Show when={dmg != -1}>
                                  <div
                                    class={(() => {
                                      let cl_flag =
                                        midngiht_hougeki()?.cl_list[at_index()][
                                          dmg_index()
                                        ];
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
                              midngiht_hougeki()?.df_list[at_index()].length ==
                              1
                                ? "flex flex-nowrap"
                                : "flex flex-col"
                            }
                          >
                            <Show
                              when={
                                midngiht_hougeki()?.si_list[at_index()] != null
                              }
                            >
                              <For
                                each={midngiht_hougeki()?.si_list[at_index()]}
                              >
                                {(si) => (
                                  <Show when={si != null}>
                                    <MstEquipmentComponent
                                      equip_id={si ?? 0}
                                      name_flag={true}
                                      compact={true}
                                      show_param={
                                        midngiht_hougeki()?.at_eflag[
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
