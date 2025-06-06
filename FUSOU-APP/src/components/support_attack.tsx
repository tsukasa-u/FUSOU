import { ShipNameComponent } from "./ship_name";

import { createMemo, For, Show } from "solid-js";

import "../css/divider.css";
import { SimpleShipNameComponent } from "./simple_ship_name";
import { Battle } from "../interface/battle";
import IconShield from "../icons/shield";
import { SimpleHpBar } from "./simple_hp_bar";
import { useShips } from "../utility/provider";
import IconFleetNumber from "../icons/fleet_number";

interface SupportAttackProps {
  deck_ship_id: { [key: number]: number[] };
  battle_selected: () => Battle;
}

export function SupportAttackComponent(props: SupportAttackProps) {
  const [ships] = useShips();

  const show_support = createMemo<boolean>(() => {
    if (props.battle_selected() == undefined) return false;
    if (props.battle_selected().deck_id == null) return false;
    if (props.battle_selected().support_attack == null) return false;
    return true;
  });

  const show_air_damage = createMemo<boolean[][]>(() => {
    let show_air_damage: boolean[][] = [
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
    if (props.battle_selected().support_attack == null) return show_air_damage;
    if (props.battle_selected().support_attack!.support_airatack == null)
      return show_air_damage;
    if (
      props.battle_selected().support_attack!.support_airatack!.e_damage
        .bak_flag
    ) {
      props
        .battle_selected()
        .support_attack!.support_airatack!.e_damage!.bak_flag!.forEach(
          (flag, idx) => {
            show_air_damage[0][idx] ||= flag == 1;
          },
        );
    }
    if (
      props.battle_selected().support_attack!.support_airatack!.e_damage
        .rai_flag
    ) {
      props
        .battle_selected()!
        .support_attack!.support_airatack!!.e_damage!.rai_flag!.forEach(
          (flag, idx) => {
            show_air_damage[0][idx] ||= flag == 1;
          },
        );
    }
    if (
      props.battle_selected().support_attack!.support_airatack!.f_damage
        .bak_flag
    ) {
      props
        .battle_selected()!
        .support_attack!.support_airatack!!.f_damage!.bak_flag!.forEach(
          (flag, idx) => {
            show_air_damage[1][idx] ||= flag == 1;
          },
        );
    }
    if (
      props.battle_selected().support_attack!.support_airatack!.f_damage
        .rai_flag
    ) {
      props
        .battle_selected()!
        .support_attack!.support_airatack!!.f_damage!.rai_flag!.forEach(
          (flag, idx) => {
            show_air_damage[1][idx] ||= flag == 1;
          },
        );
    }
    return show_air_damage;
  });

  return (
    <Show when={show_support()}>
      <li>
        <details open={true}>
          <summary>Support Attack</summary>
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
                    props.battle_selected().support_attack!.support_hourai !==
                    null
                  }
                >
                  <tr class="table_hover table_active rounded">
                    <td>
                      <div class="flex flex-col">
                        <For
                          each={
                            props.deck_ship_id[
                              props.battle_selected()!.support_attack!
                                .support_hourai!.deck_id
                            ] ??
                            props.battle_selected()!.support_attack!
                              .support_hourai!.ship_id
                          }
                        >
                          {(ship_id, idx) => (
                            <>
                              <Show when={idx() > 0}>
                                <div class="h-px" />
                              </Show>
                              <div class="flex flex-nowrap">
                                <IconFleetNumber
                                  class="h-6 -mt-1 pr-1"
                                  e_flag={0}
                                  fleet_number={1}
                                  ship_number={idx() + 1}
                                  combined_flag={false}
                                />
                                <ShipNameComponent ship_id={ship_id} />
                              </div>
                            </>
                          )}
                        </For>
                      </div>
                    </td>
                    <td>
                      <div class="flex flex-col">
                        <For
                          each={(
                            props.deck_ship_id[
                              props.battle_selected()!.support_attack!
                                .support_hourai!.deck_id
                            ] ??
                            props.battle_selected()!.support_attack!
                              .support_hourai!.ship_id
                          ).filter((ship_id) => ship_id != -1)}
                        >
                          {(ship_id) => (
                            <>
                              <SimpleHpBar
                                v_now={() => ships.ships[ship_id].nowhp}
                                v_max={() => ships.ships[ship_id].maxhp}
                              />
                            </>
                          )}
                        </For>
                      </div>
                    </td>
                    <td>
                      <For each={props.battle_selected().enemy_ship_id}>
                        {(ship_id, idx) => (
                          <>
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
                                ship_id={ship_id}
                                ship_max_hp={
                                  props.battle_selected().e_hp_max![idx()]
                                }
                                ship_param={
                                  props.battle_selected().e_params![idx()]
                                }
                                ship_slot={
                                  props.battle_selected().e_slot![idx()]
                                }
                              />
                              <Show
                                when={props
                                  .battle_selected()
                                  .support_attack!.support_hourai!.protect_flag.some(
                                    (flag) => flag == true,
                                  )}
                              >
                                <IconShield class="h-5 w-5" />
                              </Show>
                            </div>
                          </>
                        )}
                      </For>
                    </td>
                    <td>
                      <For each={props.battle_selected().enemy_ship_id}>
                        {(_, idx) => (
                          <>
                            <SimpleHpBar
                              v_now={() =>
                                props.battle_selected().support_attack!
                                  .support_hourai!.now_hps![idx()]
                              }
                              v_max={() =>
                                props.battle_selected().e_hp_max![idx()]
                              }
                            />
                          </>
                        )}
                      </For>
                    </td>
                    <td>
                      <For each={props.battle_selected().enemy_ship_id}>
                        {(_, idx) => (
                          <>
                            <Show when={idx() > 0}>
                              <div class="h-[4px]" />
                            </Show>
                            <div>
                              {
                                props.battle_selected().support_attack!
                                  .support_hourai!.damage[idx()]
                              }
                            </div>
                          </>
                        )}
                      </For>
                    </td>
                  </tr>
                </Show>
                <Show
                  when={
                    props.battle_selected().support_attack!.support_airatack !==
                    null
                  }
                >
                  <Show
                    when={
                      (
                        props.battle_selected().support_attack!
                          .support_airatack!.f_damage!.plane_from ?? []
                      ).length > 0
                    }
                  >
                    <tr class="table_hover table_active rounded">
                      <td>
                        <div class="flex flex-col">
                          {/* <For each={battle_selected().support_attack!.support_airatack!.f_damage.plane_from}> */}
                          <For
                            each={
                              props.deck_ship_id[
                                props.battle_selected()!.support_attack!
                                  .support_airatack!.deck_id
                              ] ??
                              props.battle_selected()!.support_attack!
                                .support_airatack!.ship_id
                            }
                          >
                            {(ship_id, idx) => (
                              <>
                                <Show when={idx() > 0}>
                                  <div class="h-px" />
                                </Show>
                                <div class="flex flex-nowrap">
                                  <IconFleetNumber
                                    class="h-6 -mt-1 pr-1"
                                    e_flag={0}
                                    fleet_number={1}
                                    ship_number={idx() + 1}
                                    combined_flag={false}
                                  />
                                  <ShipNameComponent ship_id={ship_id} />
                                </div>
                                {/* <ShipNameComponent ship_id={deck_ship_id[battle_selected().support_attack!.support_airatack!.deck_id][ship_idx]}></ShipNameComponent> */}
                              </>
                            )}
                          </For>
                        </div>
                      </td>
                      <td>
                        <div class="flex flex-col">
                          <For
                            each={
                              props.deck_ship_id[
                                props.battle_selected()!.support_attack!
                                  .support_airatack!.deck_id
                              ] ??
                              props.battle_selected()!.support_attack!
                                .support_airatack!.ship_id
                            }
                          >
                            {/* <For each={battle_selected().support_attack!.support_airatack!.f_damage.plane_from}> */}
                            {(ship_id) => (
                              <>
                                {/* <SimpleHpBar v_now={() => ships.ships[deck_ship_id[battle_selected().support_attack!.support_airatack!.deck_id][ship_idx]].nowhp} v_max={() => ships.ships[deck_ship_id[battle_selected().support_attack!.support_airatack!.deck_id][ship_idx]].maxhp}></SimpleHpBar> */}
                                <SimpleHpBar
                                  v_now={() => ships.ships[ship_id].nowhp}
                                  v_max={() => ships.ships[ship_id].maxhp}
                                />
                              </>
                            )}
                          </For>
                        </div>
                      </td>
                      <td>
                        <For
                          each={
                            props.battle_selected().support_attack!
                              .support_airatack!.e_damage.damages
                          }
                        >
                          {(_, idx) => (
                            <>
                              <Show when={show_air_damage()[0][idx()]}>
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
                                      .support_attack!.support_airatack!.e_damage.protect_flag?.some(
                                        (flag) => flag == true,
                                      )}
                                  >
                                    <IconShield class="h-5 w-5" />
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
                            props.battle_selected().support_attack!
                              .support_airatack!.e_damage.damages
                          }
                        >
                          {(_, idx) => (
                            <>
                              <Show when={show_air_damage()[0][idx()]}>
                                <SimpleHpBar
                                  v_now={() =>
                                    props.battle_selected().support_attack!
                                      .support_airatack!.e_damage.now_hps[idx()]
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
                            props.battle_selected().support_attack!
                              .support_airatack!.e_damage.damages
                          }
                        >
                          {(dmg, dmg_index) => (
                            <>
                              <Show when={show_air_damage()[0][dmg_index()]}>
                                <Show when={dmg_index() > 0}>
                                  <div class="h-[4px]" />
                                </Show>
                                <div
                                  class={(() => {
                                    let cl_flag =
                                      props.battle_selected().support_attack!
                                        .support_airatack!!.e_damage!.cl![
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
                </Show>
              </tbody>
            </table>
          </ul>
        </details>
      </li>
    </Show>
  );
}
