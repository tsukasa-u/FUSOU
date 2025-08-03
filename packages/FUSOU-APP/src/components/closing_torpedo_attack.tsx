import { ShipNameComponent } from "./ship_name";

import { createMemo, For, Show } from "solid-js";

import "../css/divider.css";
import { SimpleShipNameComponent } from "./simple_ship_name";
import type { Battle } from "@ipc-bindings/battle";
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

export function ClosingTorpedoAttackComponent(props: TorpedoSubmarineProps) {
  const [ships] = useShips();
  const [deck_port] = useDeckPorts();

  const show_torpedo_attack = createMemo<boolean>(() => {
    if (props.battle_selected() == undefined) return false;
    if (props.battle_selected().deck_id == null) return false;
    if (props.battle_selected().closing_raigeki == null) return false;
    if (
      props
        .battle_selected()
        .closing_raigeki.frai.findIndex((val) => val != null) == -1 &&
      props
        .battle_selected()
        .closing_raigeki.erai.findIndex((val) => val != null) == -1
    )
      return false;
    return true;
  });

  const closing_torpedo_damage = createMemo<TorpedoDamages>(() => {
    let closing_torpedo_damage: TorpedoDamages = {
      frai: {
        list: [],
        dict: {},
      },
      erai: {
        list: [],
        dict: {},
      },
    };
    if (props.battle_selected().closing_raigeki == null)
      return closing_torpedo_damage;

    props.battle_selected().closing_raigeki.frai.forEach((frai, i) => {
      if (frai != -1) {
        if (closing_torpedo_damage.frai.list.includes(frai)) {
          closing_torpedo_damage.frai.dict[frai].ships.push(i);
        } else {
          closing_torpedo_damage.frai.list.push(frai);
          closing_torpedo_damage.frai.dict[frai] = {
            dmg: props.battle_selected().closing_raigeki.edam[frai],
            ships: [i],
            cl: props.battle_selected().closing_raigeki.ecl[frai],
          };
        }
      }
    });
    props.battle_selected().closing_raigeki.erai.forEach((erai, i) => {
      if (erai != -1) {
        if (closing_torpedo_damage.erai.list.includes(erai)) {
          closing_torpedo_damage.erai.dict[erai].ships.push(i);
        } else {
          closing_torpedo_damage.erai.list.push(erai);
          closing_torpedo_damage.erai.dict[erai] = {
            dmg: props.battle_selected().closing_raigeki.fdam[erai],
            ships: [i],
            cl: props.battle_selected().closing_raigeki.fcl[erai],
          };
        }
      }
    });

    return closing_torpedo_damage;
  });

  return (
    <Show when={show_torpedo_attack()}>
      <li>
        <details open={true}>
          <summary>Closing Torpedo Attack</summary>
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
                <For each={closing_torpedo_damage().frai.list}>
                  {(frai) => (
                    <tr class="table_hover table_active rounded">
                      <td>
                        <div class="flex flex-col">
                          <For
                            each={
                              closing_torpedo_damage().frai.dict[frai].ships
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
                                    combined_flag={deck_port.combined_flag == 1}
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
                              closing_torpedo_damage().frai.dict[frai].ships
                            }
                          >
                            {(ship_id) => (
                              <>
                                <SimpleHpBar
                                  v_now={() =>
                                    props.battle_selected().closing_raigeki
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
                              .closing_raigeki.e_protect_flag.some(
                                (flag) => flag == true
                              )}
                          >
                            <IconShield class="h-5 w-5" />
                          </Show>
                        </div>
                      </td>
                      <td>
                        <SimpleHpBar
                          v_now={() =>
                            props.battle_selected().closing_raigeki.e_now_hps[
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
                              closing_torpedo_damage().frai.dict[frai].cl;
                            if (
                              cl_flag == 0 ||
                              closing_torpedo_damage().frai.dict[frai].dmg == 0
                            ) {
                              return "text-red-500";
                            } else if (cl_flag == 2) {
                              return "text-yellow-500";
                            }
                          })()}
                        >
                          {closing_torpedo_damage().frai.dict[frai].dmg}
                        </div>
                      </td>
                    </tr>
                  )}
                </For>
                <For each={closing_torpedo_damage().erai.list}>
                  {(erai) => (
                    <tr class="table_hover table_active rounded">
                      <td>
                        <div class="flex flex-col">
                          <For
                            each={
                              closing_torpedo_damage().erai.dict[erai].ships
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
                              closing_torpedo_damage().erai.dict[erai].ships
                            }
                          >
                            {(ship_id) => (
                              <>
                                <SimpleHpBar
                                  v_now={() =>
                                    props.battle_selected().closing_raigeki
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
                            e_flag={1}
                            fleet_number={1}
                            ship_number={erai + 1}
                            combined_flag={deck_port.combined_flag == 1}
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
                              .closing_raigeki.f_protect_flag.some(
                                (flag) => flag == true
                              )}
                          >
                            <IconShield class="h-5 w-5" />
                          </Show>
                        </div>
                      </td>
                      <td>
                        <SimpleHpBar
                          v_now={() =>
                            props.battle_selected().closing_raigeki.f_now_hps[
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
                              closing_torpedo_damage().erai.dict[erai].cl;
                            if (
                              cl_flag == 0 ||
                              closing_torpedo_damage().erai.dict[erai].dmg == 0
                            ) {
                              return "text-red-500";
                            } else if (cl_flag == 2) {
                              return "text-yellow-500";
                            }
                          })()}
                        >
                          {closing_torpedo_damage().erai.dict[erai].dmg}
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
