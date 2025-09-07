import { createMemo, For, Show } from "solid-js";

import type { Battle } from "@ipc-bindings/battle";
import { useAirBasesBattles, useSlotItems } from "../../../utility/provider";
import IconShield from "../../../icons/shield";
import type { DataSetParamShip } from "../../../utility/get_data_set";
import { calc_critical } from "../../../utility/battles";
import {
  WrapEnemyShipHPComponent,
  WrapNumberedEnemyShipComponent,
  WrapOwnPlaneEquipComponent,
} from "../wrap_web_component";

interface AirDamageProps {
  area_id: number;
  battle_selected: () => Battle | undefined;
  store_data_set_param_ship: () => DataSetParamShip;
}

export function AirBaseAssaultComponent(props: AirDamageProps) {
  const [slotitems] = useSlotItems();
  const [air_bases] = useAirBasesBattles();

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

  const plane_info = createMemo<number[]>(() => {
    if (!props.battle_selected()?.air_base_assault) return [];
    if (!props.battle_selected()?.air_base_air_attacks) return [];

    const set_base_id: Set<number> = new Set(
      props
        .battle_selected()
        ?.air_base_air_attacks?.attacks.map((attack) => attack.base_id)
    );
    const plane_info = Array.from(set_base_id.values())
      .map(
        (base_id) =>
          air_bases.bases[(props.area_id << 16) | base_id]?.plane_info
      )
      .reduce((acc, val) => (acc && val ? acc.concat(val) : acc), []);

    const ret: number[] = [];
    if (plane_info) {
      props
        .battle_selected()
        ?.air_base_assault?.squadron_plane.filter(
          (squadron_plane) => squadron_plane != 0
        )
        .forEach((squadron_plane) => {
          const idx = plane_info.findIndex(
            (plane) =>
              slotitems.slot_items[plane.slotid]?.slotitem_id == squadron_plane
          );
          if (idx && idx != -1) {
            ret.push(plane_info[idx].slotid);
            delete plane_info[idx];
          }
        });
    }
    return ret;
  });

  const attacker_planes = () => {
    return (
      <td>
        <div class="flex flex-col">
          <For each={plane_info()}>
            {(slot_id, idx) => (
              <>
                <Show when={idx() > 0}>
                  <div class="h-px" />
                </Show>
                <WrapOwnPlaneEquipComponent si={slot_id} />
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
                    <WrapNumberedEnemyShipComponent
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
                            (flag) => flag
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
                  <WrapEnemyShipHPComponent
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
                  <div
                    class={`text-sm my-auto ${calc_critical(
                      dmg,
                      props.battle_selected()?.air_base_assault?.e_damage.cl?.[
                        idx()
                      ]
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
          <summary>Air Base Assault</summary>
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
