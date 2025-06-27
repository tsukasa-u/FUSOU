import { ShipNameComponent } from "./ship_name";

import { createMemo, For, Show } from "solid-js";

import "../css/divider.css";
import { SimpleShipNameComponent } from "./simple_ship_name";
import { Battle } from "../interface/battle";
import IconShield from "../icons/shield";
import { SimpleHpBar } from "./simple_hp_bar";
import { useDeckPorts, useShips } from "../utility/provider";
import IconFleetNumber from "../icons/fleet_number";

interface TorpedoSubmarineProps {
  deck_ship_id: { [key: number]: number[] };
  battle_selected: () => Battle;
}

interface TorpedoDamage {
  list: number[];
  dict: {
    [key: number]: {
      dmg: number;
      ships: number[];
      cl: number;
    };
  };
}

interface TorpedoDamages {
  frai: TorpedoDamage;
  erai: TorpedoDamage;
}

export function OpeningTorpedoAttackComponent(props: TorpedoSubmarineProps) {
  const [ships] = useShips();
  const [deck_ports] = useDeckPorts();

  const show_torpedo_attack = createMemo<boolean>(() => {
    if (props.battle_selected() == undefined) return false;
    if (props.battle_selected().deck_id == null) return false;
    if (props.battle_selected().opening_raigeki == null) return false;
    if (
      props
        .battle_selected()
        .opening_raigeki.frai_list_items.findIndex((val) => val != null) ==
        -1 &&
      props
        .battle_selected()
        .opening_raigeki.erai_list_items.findIndex((val) => val != null) == -1
    )
      return false;
    return true;
  });

  const opening_torpedo_damage = createMemo<TorpedoDamages>(() => {
    let opening_torpedo_damage: TorpedoDamages = {
      frai: {
        list: [],
        dict: {},
      },
      erai: {
        list: [],
        dict: {},
      },
    };
    if (props.battle_selected().opening_raigeki == null)
      return opening_torpedo_damage;

    props
      .battle_selected()
      .opening_raigeki.frai_list_items.forEach((frai_list, i) => {
        if (frai_list != null) {
          frai_list.forEach((frai) => {
            if (opening_torpedo_damage.frai.list.includes(frai)) {
              opening_torpedo_damage.frai.dict[frai].ships.push(i);
            } else {
              opening_torpedo_damage.frai.list.push(frai);
              opening_torpedo_damage.frai.dict[frai] = {
                dmg: props.battle_selected().opening_raigeki.edam[frai],
                ships: [i],
                cl: props.battle_selected().opening_raigeki.ecl_list[frai],
              };
            }
          });
        }
      });
    props
      .battle_selected()
      .opening_raigeki.erai_list_items.forEach((erai_list, i) => {
        if (erai_list != null) {
          erai_list.forEach((erai) => {
            if (opening_torpedo_damage.erai.list.includes(erai)) {
              opening_torpedo_damage.erai.dict[erai].ships.push(i);
            } else {
              opening_torpedo_damage.erai.list.push(erai);
              opening_torpedo_damage.erai.dict[erai] = {
                dmg: props.battle_selected().opening_raigeki.fdam[erai],
                ships: [i],
                cl: props.battle_selected().opening_raigeki.fcl_list[erai],
              };
            }
          });
        }
      });
    return opening_torpedo_damage;
  });

  return (
    <Show when={show_torpedo_attack()}>
      <li>
        <details open={true}>
          <summary>Opening Torpedo Attack</summary>
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
                <For each={opening_torpedo_damage().frai.list}>
                  {(frai) => (
                    <tr class="table_hover table_active rounded">
                      <td>
                        <div class="flex flex-col">
                          <For
                            each={
                              opening_torpedo_damage().frai.dict[frai].ships
                            }
                          >
                            {(ship_id, ship_id_index) => (
                              <>
                                <Show when={ship_id_index() > 0}>
                                  <div class="h-px" />
                                </Show>
                                <div class="flex flex-nowrap">
                                  <IconFleetNumber
                                    class="h-6 -mt-1 pr-1"
                                    e_flag={0}
                                    fleet_number={1}
                                    ship_number={ship_id + 1}
                                    combined_flag={
                                      deck_ports.combined_flag == 1
                                    }
                                  />
                                  <ShipNameComponent
                                    ship_id={
                                      props.deck_ship_id[
                                        props.battle_selected().deck_id!
                                      ][ship_id]
                                    }
                                  />
                                </div>
                              </>
                            )}
                          </For>
                        </div>
                      </td>
                      <td>
                        <div class="flex flex-col">
                          <For
                            each={
                              opening_torpedo_damage().frai.dict[frai].ships
                            }
                          >
                            {(ship_id) => (
                              <>
                                <SimpleHpBar
                                  v_now={() =>
                                    props.battle_selected().opening_raigeki
                                      .f_now_hps[ship_id]
                                  }
                                  v_max={() =>
                                    ships.ships[
                                      props.deck_ship_id[
                                        props.battle_selected().deck_id!
                                      ][ship_id]
                                    ].maxhp
                                  }
                                />
                              </>
                            )}
                          </For>
                        </div>
                      </td>
                      <td>
                        <div class="flex flex-nowrap">
                          <IconFleetNumber
                            class="h-6 -mt-1 pr-1"
                            e_flag={1}
                            fleet_number={1}
                            ship_number={frai + 1}
                            combined_flag={
                              props.battle_selected().enemy_ship_id.length == 12
                            }
                          />
                          <SimpleShipNameComponent
                            ship_id={
                              props.battle_selected().enemy_ship_id[frai]
                            }
                            ship_max_hp={
                              props.battle_selected().e_hp_max![frai]
                            }
                            ship_param={props.battle_selected().e_params![frai]}
                            ship_slot={props.battle_selected().e_slot![frai]}
                          />
                          <Show
                            when={props
                              .battle_selected()
                              .opening_raigeki.e_protect_flag.some(
                                (flag) => flag == true,
                              )}
                          >
                            <IconShield class="h-5 w-5" />
                          </Show>
                        </div>
                      </td>
                      <td>
                        <SimpleHpBar
                          v_now={() =>
                            props.battle_selected().opening_raigeki.e_now_hps[
                              frai
                            ]
                          }
                          v_max={() => props.battle_selected().e_hp_max![frai]}
                        />
                      </td>
                      <td>
                        <div
                          class={(() => {
                            let cl_flag =
                              opening_torpedo_damage().frai.dict[frai].cl;
                            if (
                              cl_flag == 0 ||
                              opening_torpedo_damage().frai.dict[frai].dmg == 0
                            ) {
                              return "text-red-500";
                            } else if (cl_flag == 2) {
                              return "text-yellow-500";
                            }
                          })()}
                        >
                          {opening_torpedo_damage().frai.dict[frai].dmg}
                        </div>
                      </td>
                    </tr>
                  )}
                </For>
                <For each={opening_torpedo_damage().erai.list}>
                  {(erai) => (
                    <tr class="table_hover table_active rounded">
                      <td>
                        <div class="flex flex-col">
                          <For
                            each={
                              opening_torpedo_damage().erai.dict[erai].ships
                            }
                          >
                            {(ship_id, ship_id_index) => (
                              <>
                                <Show when={ship_id_index() > 0}>
                                  <div class="h-px" />
                                </Show>
                                <div class="flex flex-nowrap">
                                  <IconFleetNumber
                                    class="h-6 -mt-1 pr-1"
                                    e_flag={1}
                                    fleet_number={1}
                                    ship_number={ship_id + 1}
                                    combined_flag={
                                      props.battle_selected().enemy_ship_id
                                        .length == 12
                                    }
                                  />
                                  <SimpleShipNameComponent
                                    ship_id={
                                      props.battle_selected().enemy_ship_id[
                                        ship_id
                                      ]
                                    }
                                    ship_max_hp={
                                      props.battle_selected().e_hp_max![ship_id]
                                    }
                                    ship_param={
                                      props.battle_selected().e_params![ship_id]
                                    }
                                    ship_slot={
                                      props.battle_selected().e_slot![ship_id]
                                    }
                                  />
                                </div>
                              </>
                            )}
                          </For>
                        </div>
                      </td>
                      <td>
                        <div class="flex flex-col">
                          <For
                            each={
                              opening_torpedo_damage().erai.dict[erai].ships
                            }
                          >
                            {(ship_id) => (
                              <>
                                <SimpleHpBar
                                  v_now={() =>
                                    props.battle_selected().opening_raigeki
                                      .e_now_hps[ship_id]
                                  }
                                  v_max={() =>
                                    props.battle_selected().e_hp_max![ship_id]
                                  }
                                />
                              </>
                            )}
                          </For>
                        </div>
                      </td>
                      <td>
                        <div class="flex flex-nowrap">
                          <IconFleetNumber
                            class="h-6 -mt-1 pr-1"
                            e_flag={0}
                            fleet_number={1}
                            ship_number={erai + 1}
                            combined_flag={deck_ports.combined_flag == 1}
                          />
                          <ShipNameComponent
                            ship_id={
                              props.deck_ship_id[
                                props.battle_selected().deck_id!
                              ][erai]
                            }
                          />
                          <Show
                            when={props
                              .battle_selected()
                              .opening_raigeki.f_protect_flag.some(
                                (flag) => flag == true,
                              )}
                          >
                            <IconShield class="h-5 w-5" />
                          </Show>
                        </div>
                      </td>
                      <td>
                        <SimpleHpBar
                          v_now={() =>
                            props.battle_selected().opening_raigeki.f_now_hps[
                              erai
                            ]
                          }
                          v_max={() =>
                            ships.ships[
                              props.deck_ship_id[
                                props.battle_selected().deck_id!
                              ][erai]
                            ].maxhp
                          }
                        />
                      </td>
                      <td>
                        <div
                          class={(() => {
                            let cl_flag =
                              opening_torpedo_damage().erai.dict[erai].cl;
                            if (
                              cl_flag == 0 ||
                              opening_torpedo_damage().erai.dict[erai].dmg == 0
                            ) {
                              return "text-red-500";
                            } else if (cl_flag == 2) {
                              return "text-yellow-500";
                            }
                          })()}
                        >
                          {opening_torpedo_damage().erai.dict[erai].dmg}
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
