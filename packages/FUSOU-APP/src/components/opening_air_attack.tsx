import { ShipNameComponent } from "./ship_name";

import { createMemo, For, Match, Show, Switch } from "solid-js";

import "../css/divider.css";
import { SimpleShipNameComponent } from "./simple_ship_name";
import type { Battle } from "@ipc-bindings/battle";
import { MstEquipmentComponent } from "./mst_equipment";
import IconShield from "../icons/shield";
import { SimpleHpBar } from "./simple_hp_bar";
import { useDeckPorts, useShips } from "../utility/provider";
import IconFleetNumber from "../icons/fleet_number";

interface AirDamageProps {
  deck_ship_id: { [key: number]: number[] };
  battle_selected: () => Battle;
}

export function OpeningAirAttackComponent(props: AirDamageProps) {
  const [ships] = useShips();
  const [deck_ports] = useDeckPorts();

  const show_air_attack = createMemo<boolean>(() => {
    if (props.battle_selected() == undefined) return false;
    if (props.battle_selected().deck_id == null) return false;
    if (props.battle_selected().opening_air_attack == null) return false;
    if (
      props.battle_selected().opening_air_attack.f_damage.plane_from == null &&
      props.battle_selected().opening_air_attack.e_damage.plane_from == null
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
    if (props.battle_selected().opening_air_attack == null) return show_damage;
    if (props.battle_selected().opening_air_attack.e_damage.bak_flag) {
      props
        .battle_selected()!
        .opening_air_attack!.e_damage!.bak_flag!.forEach((flag, idx) => {
          show_damage[0][idx] ||= flag == 1;
        });
    }
    if (props.battle_selected().opening_air_attack.e_damage.rai_flag) {
      props
        .battle_selected()!
        .opening_air_attack!.e_damage!.rai_flag!.forEach((flag, idx) => {
          show_damage[0][idx] ||= flag == 1;
        });
    }
    if (props.battle_selected().opening_air_attack.f_damage.bak_flag) {
      props
        .battle_selected()!
        .opening_air_attack!.f_damage!.bak_flag!.forEach((flag, idx) => {
          show_damage[1][idx] ||= flag == 1;
        });
    }
    if (props.battle_selected().opening_air_attack.f_damage.rai_flag) {
      props
        .battle_selected()!
        .opening_air_attack!.f_damage!.rai_flag!.forEach((flag, idx) => {
          show_damage[1][idx] ||= flag == 1;
        });
    }
    return show_damage;
  });

  return (
    <Show when={show_air_attack()}>
      <li>
        <details open={true}>
          <summary>Opening Air Attack</summary>
          <ul class="pl-0">
            <div class="pl-2 text-xs flex felx-nowarp">
              Air State :{" "}
              <Switch fallback={<div />}>
                <Match
                  when={
                    props.battle_selected().opening_air_attack
                      .air_superiority == 0
                  }
                >
                  <div class="text-lime-500 pl-1">Air Supremacy</div>
                </Match>
                <Match
                  when={
                    props.battle_selected().opening_air_attack
                      .air_superiority == 1
                  }
                >
                  <div class="text-lime-500 pl-1">Air Superiority</div>
                </Match>
                {/* <Match when={props.battle_selected().opening_air_attack.air_superiority == 2}>
                  <div class="text-grey-500 pl-1">Air Parity</div>
                </Match>
                <Match when={props.battle_selected().opening_air_attack.air_superiority == 3}>
                  <div class="text-red-500 pl-1">Air Denial</div>
                </Match> */}
                <Match
                  when={
                    props.battle_selected().opening_air_attack
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
                    (props.battle_selected().opening_air_attack!.f_damage!
                      .touch_plane ?? 0) > 0
                  }
                  fallback={<div>_</div>}
                >
                  <MstEquipmentComponent
                    equip_id={
                      props.battle_selected().opening_air_attack!.f_damage!
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
                    (props.battle_selected().opening_air_attack!.e_damage!
                      .touch_plane ?? 0) > 0
                  }
                  fallback={<div>_</div>}
                >
                  <MstEquipmentComponent
                    equip_id={
                      props.battle_selected().opening_air_attack!.e_damage!
                        .touch_plane!
                    }
                    name_flag={true}
                    compact={true}
                    show_param={true}
                  />
                </Show>
              </div>
              <div class="divider divider-horizontal mr-0 ml-0" />
              CI : <span class="w-1" />
              <div class="flex justify-center">
                <Show
                  when={
                    props.battle_selected().opening_air_attack!.air_fire != null
                  }
                  fallback={<div>_</div>}
                >
                  <div class="w-24">
                    <ShipNameComponent
                      ship_id={
                        props.deck_ship_id[props.battle_selected().deck_id!][
                          props.battle_selected().opening_air_attack!.air_fire!
                            .idx
                        ]
                      }
                      compact={false}
                    />
                  </div>
                </Show>
                <span class="px-1"> </span>
                <Show
                  when={
                    props.battle_selected().opening_air_attack!.air_fire != null
                  }
                  fallback={<div>_</div>}
                >
                  <For
                    each={
                      props.battle_selected().opening_air_attack!.air_fire!
                        .use_item
                    }
                  >
                    {(item_id, idx) => (
                      <>
                        <Show when={idx() > 0}>
                          <div class="w-1" />
                        </Show>
                        <MstEquipmentComponent
                          equip_id={item_id}
                          name_flag={true}
                          compact={true}
                          show_param={true}
                        />
                      </>
                    )}
                  </For>
                </Show>
              </div>
            </div>
            <Show
              when={
                (
                  props.battle_selected().opening_air_attack!.f_damage!
                    .plane_from ?? []
                ).length > 0 ||
                (
                  props.battle_selected().opening_air_attack!.e_damage!
                    .plane_from ?? []
                ).length > 0
              }
            >
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
                        props.battle_selected().opening_air_attack!.f_damage!
                          .plane_from ?? []
                      ).length > 0
                    }
                  >
                    <tr class="table_hover table_active rounded">
                      <td>
                        <div class="flex flex-col">
                          <For
                            each={
                              props.battle_selected().opening_air_attack
                                .f_damage.plane_from
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
                                    e_flag={0}
                                    fleet_number={1}
                                    ship_number={ship_idx + 1}
                                    combined_flag={
                                      deck_ports.combined_flag == 1
                                    }
                                  />
                                  <ShipNameComponent
                                    ship_id={
                                      props.deck_ship_id[
                                        props.battle_selected().deck_id!
                                      ][ship_idx]
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
                              props.battle_selected().opening_air_attack
                                .f_damage.plane_from
                            }
                          >
                            {(ship_idx) => (
                              <>
                                <SimpleHpBar
                                  v_now={() =>
                                    props.battle_selected().opening_air_attack
                                      .f_damage.now_hps![ship_idx]
                                  }
                                  v_max={() =>
                                    ships.ships[
                                      props.deck_ship_id[
                                        props.battle_selected().deck_id!
                                      ][ship_idx]
                                    ].maxhp
                                  }
                                />
                              </>
                            )}
                          </For>
                        </div>
                      </td>
                      <td>
                        <For
                          each={
                            props.battle_selected().opening_air_attack.e_damage
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
                                      props.battle_selected().enemy_ship_id[
                                        idx()
                                      ]
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
                                      .opening_air_attack.e_damage.protect_flag?.some(
                                        (flag) => flag == true
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
                            props.battle_selected().opening_air_attack.e_damage
                              .damages
                          }
                        >
                          {(_, idx) => (
                            <>
                              <Show when={show_damage()[0][idx()]}>
                                <SimpleHpBar
                                  v_now={() =>
                                    props.battle_selected().opening_air_attack
                                      .e_damage.now_hps![idx()]
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
                            props.battle_selected().opening_air_attack.e_damage
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
                                        .opening_air_attack!.e_damage!.cl![
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
                  <Show
                    when={
                      (
                        props.battle_selected().opening_air_attack!.e_damage!
                          .plane_from ?? []
                      ).length > 0
                    }
                  >
                    <tr class="table_hover table_active rounded">
                      <td>
                        <div class="flex flex-col">
                          {/* Is this correct? */}
                          <For
                            each={
                              props.battle_selected().opening_air_attack
                                .e_damage.plane_from
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
                                      props.battle_selected().enemy_ship_id[
                                        ship_idx
                                      ]
                                    }
                                    ship_slot={
                                      props.battle_selected().e_slot![ship_idx]
                                    }
                                    ship_param={
                                      props.battle_selected().e_params![
                                        ship_idx
                                      ]
                                    }
                                    ship_max_hp={
                                      props.battle_selected().e_hp_max![
                                        ship_idx
                                      ]
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
                              props.battle_selected().opening_air_attack
                                .e_damage.plane_from
                            }
                          >
                            {(ship_idx) => (
                              <>
                                <SimpleHpBar
                                  v_now={() =>
                                    props.battle_selected().opening_air_attack
                                      .e_damage.now_hps![ship_idx]
                                  }
                                  v_max={() =>
                                    props.battle_selected().e_hp_max![ship_idx]
                                  }
                                />
                              </>
                            )}
                          </For>
                        </div>
                      </td>
                      <td>
                        <For
                          each={
                            props.battle_selected().opening_air_attack.f_damage
                              .damages
                          }
                        >
                          {(_, idx) => (
                            <>
                              <Show when={show_damage()[1][idx()]}>
                                <Show when={idx() > 0}>
                                  <div class="h-px" />
                                </Show>
                                <div class="flex flex-nowrap">
                                  <IconFleetNumber
                                    class="h-6 -mt-1 pr-1"
                                    e_flag={0}
                                    fleet_number={1}
                                    ship_number={idx() + 1}
                                    combined_flag={
                                      deck_ports.combined_flag == 1
                                    }
                                  />
                                  <ShipNameComponent
                                    ship_id={
                                      props.deck_ship_id[
                                        props.battle_selected().deck_id!
                                      ][idx()]
                                    }
                                  />
                                  <Show
                                    when={props
                                      .battle_selected()
                                      .opening_air_attack.f_damage.protect_flag?.some(
                                        (flag) => flag == true
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
                            props.battle_selected().opening_air_attack.f_damage
                              .damages
                          }
                        >
                          {(_, idx) => (
                            <>
                              <Show when={show_damage()[1][idx()]}>
                                <SimpleHpBar
                                  v_now={() =>
                                    props.battle_selected().opening_air_attack
                                      .f_damage.now_hps![idx()]
                                  }
                                  v_max={() =>
                                    ships.ships[
                                      props.deck_ship_id[
                                        props.battle_selected().deck_id!
                                      ][idx()]
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
                            props.battle_selected().opening_air_attack.f_damage
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
                                        .opening_air_attack!.f_damage!.cl![
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
            </Show>
          </ul>
        </details>
      </li>
    </Show>
  );
}
