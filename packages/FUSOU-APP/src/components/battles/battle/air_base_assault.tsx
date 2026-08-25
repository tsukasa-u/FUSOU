import { createMemo, For, Show } from "solid-js";

import type { Battle } from "@ipc-bindings/battle";
import IconShield from "../../../icons/shield";
import type { DataSetParamShip } from "../../../utility/get_data_set";
import { AirStateComponent } from "../shared/air_state";
import {
  ConnectedEnemyShipHP,
  ConnectedMstPlaneEquip,
  ConnectedNumberedEnemyShip,
} from "../connected_components";
import { DamageCommonComponent } from "../dmg";

interface AirDamageProps {
  area_id: number;
  battle_selected: () => Battle | undefined;
  store_data_set_param_ship: () => DataSetParamShip;
}

export function AirBaseAssaultComponent(props: AirDamageProps) {
  const show_air_attack = createMemo<boolean>(() => {
    if (!props.battle_selected()) return false;
    if (!props.battle_selected()?.air_base_assault) return false;
    return true;
  });

  const show_damage = createMemo<boolean[][]>(() => {
    const show_damage: boolean[][] = [
      new Array(12).fill(false),
      new Array(12).fill(false),
    ];
    const air_base_assault = props.battle_selected()?.air_base_assault;
    if (!air_base_assault) return show_damage;
    air_base_assault?.e_damage.bak_flag?.forEach((flag, idx) => {
      show_damage[0][idx] ||= flag == 1;
    });
    air_base_assault?.e_damage.rai_flag?.forEach((flag, idx) => {
      show_damage[0][idx] ||= flag == 1;
    });
    air_base_assault?.f_damage.bak_flag?.forEach((flag, idx) => {
      show_damage[1][idx] ||= flag == 1;
    });
    air_base_assault?.f_damage.rai_flag?.forEach((flag, idx) => {
      show_damage[1][idx] ||= flag == 1;
    });
    return show_damage;
  });

  const plane_ids = createMemo<number[]>(() => {
    const air_base_assault = props.battle_selected()?.air_base_assault;
    if (!air_base_assault) return [];

    return (air_base_assault.squadron_plane ?? []).filter(
      (squadron_plane) => squadron_plane != 0,
    );
  });

  const display_sprite_counts = () => {
    const assault = props.battle_selected()?.air_base_assault;
    if (!assault) return null;

    const f_fly = assault.f_sprite_fly_count;
    const e_fly = assault.e_sprite_fly_count;
    const f_crash = assault.f_sprite_crash_count ?? "?";
    const e_crash = assault.e_sprite_crash_count ?? "?";
    const f_damage = assault.f_sprite_damage_count ?? "?";
    const e_damage = assault.e_sprite_damage_count ?? "?";
    const f_non_normal = assault.f_sprite_non_normal_count ?? "?";
    const e_non_normal = assault.e_sprite_non_normal_count ?? "?";

    return (
      <div class="pl-2 text-xs">
        Sprite - Fly: {f_fly ?? "?"}/{e_fly ?? "?"}, Crash: {f_crash}/{e_crash},
        Damage: {f_damage}/{e_damage}, Non-Normal: {f_non_normal}/{e_non_normal}
      </div>
    );
  };

  const attacker_planes = () => {
    return (
      <td>
        <div class="flex flex-col">
          <For each={plane_ids()}>
            {(mst_slot_item_id, idx) => (
              <>
                <Show when={idx() > 0}>
                  <div class="h-px" />
                </Show>
                <ConnectedMstPlaneEquip si={mst_slot_item_id} />
              </>
            )}
          </For>
        </div>
      </td>
    );
  };

  const defenser_ships = () => {
    return (
      <td>
        <div class="flex flex-col">
          <For
            each={props.battle_selected()?.air_base_assault?.e_damage.damages}
          >
            {(_, idx) => (
              <>
                <Show when={show_damage()[0][idx()]}>
                  <Show when={idx() > 0}>
                    <div class="h-px" />
                  </Show>
                  <div class="flex flex-nowrap">
                    <ConnectedNumberedEnemyShip
                      battle_selected={props.battle_selected}
                      ship_idx={idx()}
                      store_data_set_param_ship={
                        props.store_data_set_param_ship
                      }
                    />
                    <Show
                      when={
                        props
                          .battle_selected()
                          ?.air_base_assault?.e_damage.protect_flag?.some(
                            (flag) => flag,
                          ) ?? false
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

  const defenser_hps = () => {
    return (
      <td>
        <div class="flex flex-col">
          <For
            each={props.battle_selected()?.air_base_assault?.e_damage.damages}
          >
            {(_, idx) => (
              <>
                <Show when={show_damage()[0][idx()]}>
                  <Show when={idx() > 0}>
                    <div class="h-px" />
                  </Show>
                  <ConnectedEnemyShipHP
                    e_now_hps={
                      props.battle_selected()?.air_base_assault?.e_damage
                        .now_hps
                    }
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

  const defenser_damages = () => {
    return (
      <td>
        <div class="flex flex-col">
          <For
            each={props.battle_selected()?.air_base_assault?.e_damage.damages}
          >
            {(dmg, idx) => (
              <>
                <Show when={show_damage()[0][idx()]}>
                  <Show when={idx() > 0}>
                    <div class="h-px" />
                  </Show>
                  <DamageCommonComponent
                    dmg={dmg}
                    critical_flag={
                      props.battle_selected()?.air_base_assault?.e_damage.cl?.[
                        idx()
                      ]
                    }
                  />
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
          <summary>Air Base Assault</summary>
          <ul class="pl-0">
            <AirStateComponent
              air_state={
                props.battle_selected()?.air_base_assault?.air_superiority
              }
            />
            {display_sprite_counts()}
            <table class="table table-xs">
              <thead>
                <tr>
                  <th class="w-3/8">Attack</th>
                  <th class="w-2/8">Defense</th>
                  <th class="w-1/8">HP</th>
                  <th class="w-1/8">Damage</th>
                  <th class="w-1/8" />
                </tr>
              </thead>
              <tbody>
                <tr class="rounded">
                  {attacker_planes()}
                  {defenser_ships()}
                  {defenser_hps()}
                  {defenser_damages()}
                </tr>
              </tbody>
            </table>
          </ul>
        </details>
      </li>
    </Show>
  );
}
