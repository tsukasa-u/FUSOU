import { createMemo, For, Show } from "solid-js";

import "../css/divider.css";
import { SimpleShipNameComponent } from "./simple_ship_name";
import type { Battle } from "@ipc-bindings/battle";
import { EquimentComponent } from "./equipment";
import { useAirBases, useSlotItems } from "../utility/provider";
import IconShield from "../icons/shield";
import { SimpleHpBar } from "./simple_hp_bar";
import IconFleetNumber from "../icons/fleet_number";

interface AirDamageProps {
  area_id: number;
  battle_selected: () => Battle;
}

export function AirBaseAssaultComponent(props: AirDamageProps) {
  const [slotitems] = useSlotItems();
  const [air_bases] = useAirBases();

  const show_air_attack = createMemo<boolean>(() => {
    if (props.battle_selected() == undefined) return false;
    if (props.battle_selected().air_base_assault == null) return false;
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
    if (props.battle_selected().air_base_assault == null) return show_damage;
    if (props.battle_selected().air_base_assault!.e_damage.bak_flag) {
      props
        .battle_selected()!
        .air_base_assault!.e_damage!.bak_flag!.forEach((flag, idx) => {
          show_damage[0][idx] ||= flag == 1;
        });
    }
    if (props.battle_selected().air_base_assault!.e_damage.rai_flag) {
      props
        .battle_selected()!
        .air_base_assault!.e_damage!.rai_flag!.forEach((flag, idx) => {
          show_damage[0][idx] ||= flag == 1;
        });
    }
    if (props.battle_selected().air_base_assault!.f_damage.bak_flag) {
      props
        .battle_selected()!
        .air_base_assault!.f_damage!.bak_flag!.forEach((flag, idx) => {
          show_damage[1][idx] ||= flag == 1;
        });
    }
    if (props.battle_selected().air_base_assault!.f_damage.rai_flag) {
      props
        .battle_selected()!
        .air_base_assault!.f_damage!.rai_flag!.forEach((flag, idx) => {
          show_damage[1][idx] ||= flag == 1;
        });
    }
    return show_damage;
  });

  const plane_info = createMemo<number[]>(() => {
    if (props.battle_selected().air_base_assault == null) return [];
    if (props.battle_selected().air_base_air_attacks == null) return [];

    let set_base_id: Set<number> = new Set(
      props
        .battle_selected()
        .air_base_air_attacks.attacks.map((attack) => attack.base_id)
    );
    let plane_info = Array.from(set_base_id.values())
      .map(
        (base_id) => air_bases.bases[(props.area_id << 16) | base_id].plane_info
      )
      .reduce((acc, val) => acc.concat(val), []);

    let ret: number[] = [];
    props
      .battle_selected()
      .air_base_assault!.squadron_plane.filter(
        (squadron_plane) => squadron_plane != 0
      )
      .forEach((squadron_plane) => {
        let idx = plane_info.findIndex(
          (plane) =>
            slotitems.slot_items[plane.slotid].slotitem_id == squadron_plane
        );
        if (idx != -1) {
          ret.push(plane_info[idx].slotid);
          delete plane_info[idx];
        }
      });

    return ret;
  });

  return (
    <Show when={show_air_attack()}>
      <li>
        <details open={true}>
          <summary>Air Base Assault</summary>
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
                <tr class="table_hover table_active rounded">
                  <td>
                    <div class="flex flex-col">
                      <For each={plane_info()}>
                        {(slot_id, idx) => (
                          <>
                            <Show when={idx() > 0}>
                              <div class="h-px" />
                            </Show>
                            <EquimentComponent
                              slot_id={slot_id}
                              name_flag={true}
                            />
                          </>
                        )}
                      </For>
                    </div>
                  </td>
                  <td>
                    <div class="flex flex-col">
                      <For
                        each={
                          props.battle_selected().air_base_assault!.e_damage
                            .damages ?? []
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
                                    .air_base_assault!.e_damage.protect_flag?.some(
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
                    </div>
                  </td>
                  <td>
                    <div class="flex flex-col">
                      <For
                        each={
                          props.battle_selected().air_base_assault!.e_damage
                            .damages ?? []
                        }
                      >
                        {(_, idx) => (
                          <>
                            <Show when={show_damage()[0][idx()]}>
                              <SimpleHpBar
                                v_now={() =>
                                  props.battle_selected().air_base_assault!
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
                    </div>
                  </td>
                  <td>
                    <div class="flex flex-col">
                      <For
                        each={
                          props.battle_selected().air_base_assault!.e_damage
                            .damages ?? []
                        }
                      >
                        {(dmg, idx) => (
                          <>
                            <Show when={show_damage()[0][idx()]}>
                              <Show when={idx() > 0}>
                                <div class="h-[4px]" />
                              </Show>
                              <div
                                class={(() => {
                                  let cl_flag =
                                    props.battle_selected().air_base_assault!
                                      .e_damage.cl![idx()];
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
              </tbody>
            </table>
          </ul>
        </details>
      </li>
    </Show>
  );
}
