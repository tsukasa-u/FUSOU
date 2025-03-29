import { ShipNameComponent } from "./ship_name";

import { createMemo, For, Show } from "solid-js";

import "../css/divider.css";
import { SimpleShipNameComponent } from "./simple_ship_name";
import { Battle } from "../interface/battle";
import IconShield from "../icons/shield";
import { useDeckPorts, useShips } from "../utility/provider";
import { SimpleHpBar } from "./simple_hp_bar";
import IconFleetNumber from "../icons/fleet_number";

interface AirDamageProps {
  battle_selected: () => Battle;
}

export function CarrierBaseAssaultComponent(props: AirDamageProps) {

  const [ships, ] = useShips();
  const [deck_ports, ] = useDeckPorts();

  const show_air_attack = createMemo<boolean>(() => {
    if (props.battle_selected() == undefined) return false;
    if (props.battle_selected().deck_id == null) return false;
    if (props.battle_selected().carrier_base_assault! == null) return false;
    if (
      props.battle_selected().carrier_base_assault!.f_damage.plane_from ==
        null &&
      props.battle_selected().carrier_base_assault!.e_damage.plane_from == null
    )
      return false;
    return true;
  });

  const show_damage = createMemo<boolean[][]>(() => {
    let show_damage: boolean[][] = [
      [
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
      ],
      [
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
      ],
    ];
    if (props.battle_selected().carrier_base_assault! == null)
      return show_damage;
    if (props.battle_selected().carrier_base_assault!.e_damage.bak_flag) {
      props
        .battle_selected()!
        .carrier_base_assault!.e_damage!.bak_flag!.forEach((flag, idx) => {
          show_damage[0][idx] ||= flag == 1;
        });
    }
    if (props.battle_selected().carrier_base_assault!.e_damage.rai_flag) {
      props
        .battle_selected()!
        .carrier_base_assault!.e_damage!.rai_flag!.forEach((flag, idx) => {
          show_damage[0][idx] ||= flag == 1;
        });
    }
    if (props.battle_selected().carrier_base_assault!.f_damage.bak_flag) {
      props
        .battle_selected()!
        .carrier_base_assault!.f_damage!.bak_flag!.forEach((flag, idx) => {
          show_damage[1][idx] ||= flag == 1;
        });
    }
    if (props.battle_selected().carrier_base_assault!.f_damage.rai_flag) {
      props
        .battle_selected()!
        .carrier_base_assault!.f_damage!.rai_flag!.forEach((flag, idx) => {
          show_damage[1][idx] ||= flag == 1;
        });
    }
    return show_damage;
  });

  return (
    <Show when={show_air_attack()}>
      <li>
        <details open={true}>
          <summary>Carrier Base Assault</summary>
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
                <Show
                  when={
                    (
                      props.battle_selected().carrier_base_assault!.f_damage!
                        .plane_from ?? []
                    ).length > 0
                  }
                >
                  <tr class="table_hover table_active rounded">
                    <td>
                      <div class="flex flex-col">
                        <For
                          each={
                            props.battle_selected().carrier_base_assault!
                              .f_damage!.plane_from
                          }
                        >
                          {(ship_idx, idx) => (
                            <>
                              <Show when={idx() > 0}>
                                <div class="h-px" />
                              </Show>
                              <div class="flex flex-nowrap">
                                <IconFleetNumber
                                  class="h-6 -mt-1 pr-1"
                                  e_flag={1}
                                  fleet_number={1}
                                  ship_number={ship_idx + 1}
                                  combined_flag={deck_ports.combined_flag == 1}
                                />
                                <ShipNameComponent
                                  ship_id={
                                    deck_ports.deck_ports[
                                      props.battle_selected().deck_id!
                                    ].ship[ship_idx]
                                  }
                                />
                              </div>
                            </>
                          )}
                        </For>
                      </div>
                    </td>
                    <td><div class="flex flex-col">
                        <For
                          each={
                            props.battle_selected().carrier_base_assault!
                              .f_damage!.plane_from
                          }
                        >
                          {(ship_idx) => (
                            <>
                              <SimpleHpBar v_now={() => props.battle_selected().carrier_base_assault!.f_damage!.now_hps[ship_idx]} v_max={() => ships.ships[deck_ports.deck_ports[props.battle_selected().deck_id!].ship[ship_idx]].maxhp} />
                            </>
                          )}
                        </For>
                      </div>
                    </td>
                    <td>
                      <For
                        each={
                          props.battle_selected().carrier_base_assault!.e_damage
                            .damages
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
                                  combined_flag={
                                    props.battle_selected().enemy_ship_id
                                      .length == 12
                                  }
                                />
                                <SimpleShipNameComponent
                                  ship_id={
                                    props.battle_selected().enemy_ship_id[idx()]
                                  }
                                  ship_slot={
                                    props.battle_selected().e_slot![idx()]
                                  }
                                  ship_param={
                                    props.battle_selected().e_params![idx()]
                                  }
                                  ship_max_hp={
                                    props.battle_selected().e_hp_max![idx()]
                                  }
                                />
                                <Show
                                  when={props
                                    .battle_selected()
                                    .carrier_base_assault!.e_damage.protect_flag?.some(
                                      (flag) => flag == true,
                                    )}
                                >
                                  <IconShield class="h-4 w-4" />
                                </Show>
                              </div>
                            </Show>
                          </>
                        )}
                      </For>
                    </td>
                    <td>
                      <For
                        each={
                          props.battle_selected().carrier_base_assault!.e_damage
                            .damages
                        }
                      >
                        {(_, idx) => (
                          <>
                            <Show when={show_damage()[0][idx()]}>
                              <SimpleHpBar
                                v_now={() =>
                                  props.battle_selected().carrier_base_assault!
                                    .e_damage.now_hps[idx()]
                                }
                                v_max={() =>
                                  props.battle_selected().e_hp_max![idx()]
                                }
                              />
                            </Show>
                          </>
                        )}
                      </For>
                    </td>
                    <td>
                      <For
                        each={
                          props.battle_selected().carrier_base_assault!.e_damage
                            .damages
                        }
                      >
                        {(dmg, dmg_index) => (
                          <>
                            <Show when={show_damage()[0][dmg_index()]}>
                              <Show when={dmg_index() > 0}>
                                <div class="h-[4px]" />
                              </Show>
                              <div
                                class={(() => {
                                  let cl_flag =
                                    props.battle_selected()
                                      .carrier_base_assault!.e_damage!.cl![
                                      dmg_index()
                                    ] ?? 0;
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
                          </>
                        )}
                      </For>
                    </td>
                  </tr>
                  <tr class="table_hover table_active rounded">
                    <td>
                      <div class="flex flex-col">
                        <For
                          each={
                            props.battle_selected().carrier_base_assault!
                              .e_damage!.plane_from
                          }
                        >
                          {(ship_idx, idx) => (
                            <>
                              <Show when={idx() > 0}>
                                <div class="h-px" />
                              </Show>
                              <div class="flex flex-nowrap">
                                <IconFleetNumber
                                  class="h-6 -mt-1 pr-1"
                                  e_flag={1}
                                  fleet_number={1}
                                  ship_number={ship_idx + 1}
                                  combined_flag={
                                    props.battle_selected().enemy_ship_id
                                      .length == 12
                                  }
                                />
                                <SimpleShipNameComponent
                                  ship_id={
                                    props.battle_selected().enemy_ship_id[ship_idx]
                                  }
                                  ship_slot={
                                    props.battle_selected().e_slot![ship_idx]
                                  }
                                  ship_param={
                                    props.battle_selected().e_params![ship_idx]
                                  }
                                  ship_max_hp={
                                    props.battle_selected().e_hp_max![ship_idx]
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
                            props.battle_selected().carrier_base_assault!
                              .e_damage!.plane_from
                          }
                        >
                          {(ship_idx) => (
                            <>
                              <div class="flex flex-nowrap">
                                <SimpleHpBar
                                  v_now={() =>
                                    props.battle_selected().carrier_base_assault!
                                      .e_damage!.now_hps[ship_idx]
                                  }
                                  v_max={() =>
                                    props.battle_selected().e_hp_max![ship_idx]
                                  }
                                />
                              </div>
                            </>
                          )}
                        </For>
                      </div>
                    </td>
                    <td>
                      <For
                        each={
                          props.battle_selected().carrier_base_assault!.f_damage
                            .damages
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
                                  combined_flag={deck_ports.combined_flag == 1}
                                />
                                <ShipNameComponent
                                  ship_id={
                                    deck_ports.deck_ports[
                                      props.battle_selected().deck_id!
                                    ].ship[idx()]
                                  }
                                />
                                <Show
                                  when={props
                                    .battle_selected()
                                    .carrier_base_assault!.f_damage.protect_flag?.some(
                                      (flag) => flag == true,
                                    )}
                                >
                                  <IconShield class="h-4 w-4" />
                                </Show>
                              </div>
                            </Show>
                          </>
                        )}
                      </For>
                    </td>
                    <td>
                      <For
                        each={
                          props.battle_selected().carrier_base_assault!.f_damage
                            .damages
                        }
                      >
                        {(_, idx) => (
                          <>
                            <Show when={show_damage()[0][idx()]}>
                              <SimpleHpBar
                                v_now={() =>
                                  props.battle_selected().carrier_base_assault!
                                    .f_damage.now_hps[idx()]
                                }
                                v_max={() =>
                                  ships.ships[
                                    deck_ports.deck_ports[
                                      props.battle_selected().deck_id!
                                    ].ship[idx()]
                                  ].maxhp
                                  
                                }
                              />
                            </Show>
                          </>
                        )}
                      </For>
                    </td>
                    <td>
                      <For
                        each={
                          props.battle_selected().carrier_base_assault!.f_damage
                            .damages
                        }
                      >
                        {(dmg, dmg_index) => (
                          <>
                            <Show when={show_damage()[1][dmg_index()]}>
                              <Show when={dmg_index() > 0}>
                                <div class="h-[4px]" />
                              </Show>
                              <div
                                class={(() => {
                                  let cl_flag =
                                    props.battle_selected()
                                      .carrier_base_assault!.f_damage!.cl![
                                      dmg_index()
                                    ] ?? 0;
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
                          </>
                        )}
                      </For>
                    </td>
                  </tr>
                </Show>
              </tbody>
            </table>
          </ul>
        </details>
      </li>
    </Show>
  );
}
