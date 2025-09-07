import { createMemo, For, Show } from "solid-js";

import type { AirBaseAirAttack, Battle } from "@ipc-bindings/battle";
import { useAirBasesBattles } from "../../../utility/provider";
import IconShield from "../../../icons/shield";
import type { DataSetParamShip } from "../../../utility/get_data_set";
import { calc_critical } from "../../../utility/battles";
import {
  WrapCIMstEquipComponent,
  WrapEnemyShipHPComponent,
  WrapNumberedEnemyShipComponent,
  WrapOwnPlaneEquipComponent,
} from "../wrap_web_component";

interface AirDamageProps {
  area_id: number;
  battle_selected: () => Battle | undefined;
  store_data_set_param_ship: () => DataSetParamShip;
}

export function AirBaseAirAttackComponent(props: AirDamageProps) {
  const [air_bases] = useAirBasesBattles();

  const show_air_attack = createMemo<boolean>(() => {
    if (!props.battle_selected()) return false;
    if (!props.battle_selected()?.air_base_air_attacks) return false;
    return true;
  });

  const show_damage = createMemo<boolean[][]>(() => {
    const show_damage: boolean[][] = [];
    if (!show_air_attack()) return show_damage;
    props
      .battle_selected()
      ?.air_base_air_attacks?.attacks.forEach((attack, attack_idx) => {
        show_damage.push(new Array(12).fill(false));
        if (attack.e_damage.bak_flag) {
          attack.e_damage.bak_flag.forEach((flag, idx) => {
            show_damage[attack_idx][idx] ||= flag == 1;
          });
        }
        if (attack.e_damage.rai_flag) {
          attack.e_damage.rai_flag.forEach((flag, idx) => {
            show_damage[attack_idx][idx] ||= flag == 1;
          });
        }
      });
    return show_damage;
  });

  const display_touch = (attack: AirBaseAirAttack) => {
    const f_touch_plane = attack.f_damage.touch_plane ?? 0;
    const e_touch_plane = attack.e_damage.touch_plane ?? 0;
    return (
      <>
        touch : <span class="w-1" />
        <div class="w-6 flex justify-center">
          <Show when={f_touch_plane > 0} fallback={<div>_</div>}>
            <WrapCIMstEquipComponent e_flag={false} si={f_touch_plane} />
          </Show>
        </div>
        <div class="w-3 text-center">/</div>
        <div class="w-6 flex justify-center">
          <Show when={e_touch_plane > 0} fallback={<div>_</div>}>
            <WrapCIMstEquipComponent e_flag={true} si={e_touch_plane} />
          </Show>
        </div>
      </>
    );
  };

  const attacker_planes = (attack: AirBaseAirAttack) => {
    const f_plane_list = air_bases.bases[
      (props.area_id << 16) | attack.base_id
    ]?.plane_info.filter((palne) => palne.slotid != 0);
    return (
      <td>
        <div class="flex flex-col">
          <For each={f_plane_list}>
            {(plane, idx) => (
              <>
                <Show when={plane != null}>
                  <Show when={idx() > 0}>
                    <div class="h-px" />
                  </Show>
                  <WrapOwnPlaneEquipComponent si={plane.slotid} />
                </Show>
              </>
            )}
          </For>
        </div>
      </td>
    );
  };

  const defenser_ships = (
    attack: AirBaseAirAttack,
    attack_idx: () => number
  ) => {
    return (
      <td>
        <div class="flex flex-col">
          <For each={attack.e_damage.damages ?? []}>
            {(_, idx) => (
              <>
                <Show when={show_damage()[attack_idx()][idx()]}>
                  <Show when={idx() > 0}>
                    <div class="h-px" />
                  </Show>
                  <div class="flex flex-nowrap">
                    <WrapNumberedEnemyShipComponent
                      store_data_set_param_ship={
                        props.store_data_set_param_ship
                      }
                      ship_idx={idx()}
                      battle_selected={props.battle_selected}
                    />
                    <Show
                      when={
                        attack.e_damage.protect_flag?.some((flag) => flag) ??
                        false
                      }
                    >
                      <IconShield class="h-4 self-center ml-auto" />
                    </Show>
                  </div>
                </Show>
              </>
            )}
          </For>
        </div>
      </td>
    );
  };

  const defenser_hps = (attack: AirBaseAirAttack, attack_idx: () => number) => {
    return (
      <td>
        <div class="flex flex-col">
          <For each={attack.e_damage.damages}>
            {(_, idx) => (
              <>
                <Show when={show_damage()[attack_idx()][idx()]}>
                  <WrapEnemyShipHPComponent
                    e_now_hps={attack.e_damage.now_hps}
                    idx={idx()}
                    store_data_set_param_ship={props.store_data_set_param_ship}
                  />
                </Show>
              </>
            )}
          </For>
        </div>
      </td>
    );
  };

  const defenser_damages = (
    attack: AirBaseAirAttack,
    attack_idx: () => number
  ) => {
    return (
      <td>
        <div class="flex flex-col">
          <For each={attack.e_damage.damages ?? []}>
            {(dmg, idx) => (
              <>
                <Show when={show_damage()[attack_idx()][idx()]}>
                  <Show when={idx() > 0}>
                    <div class="h-px" />
                  </Show>
                  <div
                    class={`text-sm my-auto ${calc_critical(
                      dmg,
                      attack.e_damage.cl?.[idx()]
                    )}`}
                  >
                    {dmg}
                  </div>
                </Show>
              </>
            )}
          </For>
        </div>
      </td>
    );
  };

  return (
    <Show when={show_air_attack()}>
      <li>
        <details open={true}>
          <summary>Air Base Air Attack</summary>
          <ul class="pl-0">
            <table class="table table-xs">
              <thead>
                <tr>
                  <th>Attack</th>
                  <th>To</th>
                  <th>Defense</th>
                  <th>Damage</th>
                </tr>
              </thead>
              <tbody>
                <For
                  each={props.battle_selected()?.air_base_air_attacks?.attacks}
                >
                  {(attack, attack_idx) => (
                    <>
                      <div class="flex flex-nowrap pl-2">
                        {display_touch(attack)}
                      </div>
                      <tr class="rounded">
                        {attacker_planes(attack)}
                        {defenser_ships(attack, attack_idx)}
                        {defenser_hps(attack, attack_idx)}
                        {defenser_damages(attack, attack_idx)}
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
