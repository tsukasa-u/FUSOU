import { createMemo, For, Show } from "solid-js";

import "../css/divider.css";
import { SimpleShipNameComponent } from "./simple_ship_name";
import type { Battle } from "@ipc-bindings/battle";
import { EquimentComponent } from "./equipment";
import { useAirBases } from "../utility/provider";
import IconShield from "../icons/shield";
import { SimpleHpBar } from "./simple_hp_bar";
import IconFleetNumber from "../icons/fleet_number";
import { MstEquipmentComponent } from "./mst_equipment";

interface AirDamageProps {
  area_id: number;
  battle_selected: () => Battle;
}

export function AirBaseAirAttackComponent(props: AirDamageProps) {
  const [air_bases] = useAirBases();

  const show_air_attack = createMemo<boolean>(() => {
    if (props.battle_selected() == undefined) return false;
    if (props.battle_selected().air_base_air_attacks == null) return false;
    return true;
  });

  const show_damage = createMemo<boolean[][]>(() => {
    let show_damage: boolean[][] = [];
    if (!show_air_attack()) return show_damage;
    props
      .battle_selected()
      .air_base_air_attacks!.attacks.forEach((attack, attack_idx) => {
        show_damage.push([
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
        ]);
        if (attack.e_damage.bak_flag) {
          attack.e_damage.bak_flag!.forEach((flag, idx) => {
            show_damage[attack_idx][idx] ||= flag == 1;
          });
        }
        if (attack.e_damage.rai_flag) {
          attack.e_damage.rai_flag!.forEach((flag, idx) => {
            show_damage[attack_idx][idx] ||= flag == 1;
          });
        }
      });
    return show_damage;
  });

  return (
    <Show when={show_air_attack()}>
      <li>
        <details open={true}>
          <summary>Air Base Air Attack</summary>
          <ul class="pl-0">
            <table class="table table-xs">
              <thead>
                <tr>
                  <th>From</th>
                  <th>To</th>
                  <th>HP</th>
                  <th>Attack</th>
                </tr>
              </thead>
              <tbody>
                <For
                  each={props.battle_selected().air_base_air_attacks!.attacks}
                >
                  {(attack, attack_idx) => (
                    <>
                      <div class="flex flex-nowrap pl-2">
                        touch : <span class="w-1" />
                        <div class="w-6 flex justify-center">
                          <Show
                            when={(attack!.f_damage!.touch_plane ?? 0) > 0}
                            fallback={<div>_</div>}
                          >
                            <MstEquipmentComponent
                              equip_id={attack!.f_damage!.touch_plane!}
                              name_flag={true}
                              compact={true}
                              show_param={true}
                            />
                          </Show>
                        </div>
                        <div class="w-6 flex justify-center">
                          <Show
                            when={(attack!.e_damage!.touch_plane ?? 0) > 0}
                            fallback={<div>_</div>}
                          >
                            <MstEquipmentComponent
                              equip_id={attack!.e_damage!.touch_plane!}
                              name_flag={true}
                              compact={true}
                              show_param={true}
                            />
                          </Show>
                        </div>
                      </div>
                      <tr class="table_hover table_active rounded">
                        <td>
                          <div class="flex flex-col">
                            <For
                              each={air_bases.bases[
                                (props.area_id << 16) | attack.base_id
                              ].plane_info.filter((palne) => palne.slotid != 0)}
                            >
                              {(plane, idx) => (
                                <>
                                  <Show when={plane != null}>
                                    <Show when={idx() > 0}>
                                      <div class="h-px" />
                                    </Show>
                                    <EquimentComponent
                                      slot_id={plane.slotid}
                                      name_flag={true}
                                    />
                                  </Show>
                                </>
                              )}
                            </For>
                          </div>
                        </td>
                        <td>
                          <div class="flex flex-col">
                            <For each={attack.e_damage.damages ?? []}>
                              {(_, idx) => (
                                <>
                                  <Show
                                    when={show_damage()[attack_idx()][idx()]}
                                  >
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
                                        ship_max_hp={
                                          props.battle_selected().e_hp_max![
                                            idx()
                                          ]
                                        }
                                        ship_param={
                                          props.battle_selected().e_params![
                                            idx()
                                          ]
                                        }
                                        ship_slot={
                                          props.battle_selected().e_slot![idx()]
                                        }
                                      />
                                      <Show
                                        when={attack.e_damage.protect_flag?.some(
                                          (flag) => flag == true
                                        )}
                                      >
                                        <IconShield class="h-5 w-5" />
                                      </Show>
                                    </div>
                                  </Show>
                                </>
                              )}
                            </For>
                          </div>
                        </td>
                        <td>
                          <div class="flex flex-col">
                            <For each={attack.e_damage.damages ?? []}>
                              {(_, idx) => (
                                <>
                                  <Show
                                    when={show_damage()[attack_idx()][idx()]}
                                  >
                                    <SimpleHpBar
                                      v_now={() =>
                                        attack.e_damage.now_hps[idx()]
                                      }
                                      v_max={() =>
                                        props.battle_selected().e_hp_max![idx()]
                                      }
                                    />
                                  </Show>
                                </>
                              )}
                            </For>
                          </div>
                        </td>
                        <td>
                          <div class="flex flex-col">
                            <For each={attack.e_damage.damages ?? []}>
                              {(dmg, idx) => (
                                <>
                                  <Show
                                    when={show_damage()[attack_idx()][idx()]}
                                  >
                                    <Show when={idx() > 0}>
                                      <div class="h-[4px]" />
                                    </Show>
                                    <div
                                      class={(() => {
                                        let cl_flag =
                                          attack.e_damage!.cl![idx()];
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
                          </div>
                        </td>
                      </tr>
                    </>
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
