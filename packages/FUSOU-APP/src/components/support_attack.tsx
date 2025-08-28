import { createMemo, For, Show } from "solid-js";

import type { Battle } from "@ipc-bindings/battle";
import IconShield from "../icons/shield";
import { DataSetParamShip, DataSetShip } from "../utility/get_data_set";
import { calc_critical, DeckShipIds } from "../utility/battles";
import {
  WrapEnemyShipHPComponent,
  WrapNumberedEnemyShipComponent,
  WrapNumberedSupportShipComponent,
  WrapSupportShipHPComponent,
} from "./wrap_web_component";

interface SupportAttackProps {
  deck_ship_id: () => DeckShipIds;
  battle_selected: () => Battle | undefined;
  store_data_set_deck_ship: () => DataSetShip;
  store_data_set_param_ship: () => DataSetParamShip;
}

export function SupportAttackComponent(props: SupportAttackProps) {
  const show_support = createMemo<boolean>(() => {
    if (!props.battle_selected()) return false;
    if (!props.battle_selected()?.deck_id) return false;
    if (!props.battle_selected()?.support_attack) return false;
    return true;
  });

  const show_support_hourai = createMemo<boolean>(() => {
    return props.battle_selected()?.support_attack?.support_hourai
      ? true
      : false;
  });

  const show_support_airattack = createMemo<boolean>(() => {
    const f_plane_from =
      props.battle_selected()?.support_attack?.support_airatack?.f_damage
        .plane_from;
    if (f_plane_from) {
      if (f_plane_from.length > 0) {
        return true;
      }
    }

    return false;
  });

  const show_air_damage = createMemo<boolean[][]>(() => {
    const show_air_damage: boolean[][] = [
      new Array(12).fill(false),
      new Array(12).fill(false),
    ];

    const support_airatack =
      props.battle_selected()?.support_attack?.support_airatack;
    if (!support_airatack) return show_air_damage;

    support_airatack?.e_damage.bak_flag?.forEach((flag, idx) => {
      show_air_damage[0][idx] ||= flag == 1;
    });
    support_airatack?.e_damage.rai_flag?.forEach((flag, idx) => {
      show_air_damage[0][idx] ||= flag == 1;
    });
    support_airatack?.f_damage.bak_flag?.forEach((flag, idx) => {
      show_air_damage[1][idx] ||= flag == 1;
    });
    support_airatack?.f_damage.rai_flag?.forEach((flag, idx) => {
      show_air_damage[1][idx] ||= flag == 1;
    });
    return show_air_damage;
  });

  const support_deck_id =
    props.battle_selected()?.support_attack?.support_hourai?.deck_id;
  const ship_ids = support_deck_id
    ? props.deck_ship_id()[support_deck_id]
    : props.battle_selected()?.support_attack?.support_hourai?.ship_id;

  const attacker_ships = () => {
    return (
      <td>
        <div class="flex flex-col">
          <For each={ship_ids}>
            {(_, idx) => (
              <>
                <Show when={idx() > 0}>
                  <div class="h-px" />
                </Show>
                <div class="flex flex-nowrap">
                  <WrapNumberedSupportShipComponent
                    ship_idx={idx()}
                    support_deck_id={support_deck_id}
                    deck_ship_id={props.deck_ship_id}
                    store_data_set_deck_ship={props.store_data_set_deck_ship}
                  />
                </div>
              </>
            )}
          </For>
        </div>
      </td>
    );
  };

  const attacker_hps = () => {
    return (
      <td>
        <div class="flex flex-col">
          <For each={ship_ids}>
            {(_, idx) => (
              <>
                <WrapSupportShipHPComponent
                  deck_ship_id={props.deck_ship_id}
                  idx={idx()}
                  support_deck_id={support_deck_id}
                  store_data_set_deck_ship={props.store_data_set_deck_ship}
                />
              </>
            )}
          </For>
        </div>
      </td>
    );
  };

  const hourai_defenser_ships = () => {
    return (
      <td>
        <For each={props.battle_selected()?.enemy_ship_id}>
          {(_, idx) => (
            <>
              <Show when={idx() > 0}>
                <div class="h-px" />
              </Show>
              <div class="flex flex-nowrap">
                <WrapNumberedEnemyShipComponent
                  ship_idx={idx()}
                  battle_selected={props.battle_selected}
                  store_data_set_param_ship={props.store_data_set_param_ship}
                />
                <Show
                  when={
                    props
                      .battle_selected()
                      ?.support_attack?.support_hourai?.protect_flag.some(
                        (flag) => flag
                      ) ?? false
                  }
                >
                  <IconShield class="h-4 self-center ml-auto" />
                </Show>
              </div>
            </>
          )}
        </For>
      </td>
    );
  };

  const hourai_defenser_hps = () => {
    return (
      <td>
        <For each={props.battle_selected()?.enemy_ship_id}>
          {(_, idx) => (
            <>
              <WrapEnemyShipHPComponent
                idx={idx()}
                store_data_set_param_ship={props.store_data_set_param_ship}
                e_now_hps={
                  props.battle_selected()?.support_attack?.support_hourai
                    ?.now_hps
                }
              />
            </>
          )}
        </For>
      </td>
    );
  };

  const hourai_damages = () => {
    return (
      <td>
        <div class="flex flex-col">
          <For
            each={
              props.battle_selected()?.support_attack?.support_hourai?.damage
            }
          >
            {(dmg, dmg_index) => (
              <>
                <Show when={dmg_index() > 0}>
                  <div class="h-px" />
                </Show>
                <div
                  class={`text-sm my-auto ${calc_critical(
                    dmg,
                    props.battle_selected()?.support_attack?.support_hourai
                      ?.cl_list[dmg_index()]
                  )}`}
                >
                  {dmg}
                </div>
              </>
            )}
          </For>
        </div>
      </td>
    );
  };

  const airattack_defenser_ships = () => {
    return (
      <td>
        <For
          each={
            props.battle_selected()?.support_attack?.support_airatack?.e_damage
              .damages
          }
        >
          {(_, idx) => (
            <>
              <Show when={show_air_damage()[0][idx()]}>
                <Show when={idx() > 0}>
                  <div class="h-px" />
                </Show>
                <div class="flex flex-nowrap">
                  <WrapNumberedEnemyShipComponent
                    ship_idx={idx()}
                    battle_selected={props.battle_selected}
                    store_data_set_param_ship={props.store_data_set_param_ship}
                  />
                  <Show
                    when={
                      props
                        .battle_selected()
                        ?.support_attack?.support_airatack?.e_damage?.protect_flag?.some(
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
      </td>
    );
  };
  const airattack_defenser_hps = () => {
    return (
      <td>
        <For
          each={
            props.battle_selected()?.support_attack?.support_airatack?.e_damage
              .damages
          }
        >
          {(_, idx) => (
            <>
              <Show when={show_air_damage()[0][idx()]}>
                <WrapEnemyShipHPComponent
                  idx={idx()}
                  store_data_set_param_ship={props.store_data_set_param_ship}
                  e_now_hps={
                    props.battle_selected()?.support_attack?.support_airatack
                      ?.e_damage?.now_hps
                  }
                />
              </Show>
            </>
          )}
        </For>
      </td>
    );
  };

  const airattack_defenser_damages = () => {
    return (
      <td>
        <For
          each={
            props.battle_selected()?.support_attack?.support_airatack?.e_damage
              .damages
          }
        >
          {(dmg, dmg_index) => (
            <>
              <Show when={show_air_damage()[0][dmg_index()]}>
                <Show when={dmg_index() > 0}>
                  <div class="h-px" />
                </Show>
                <div
                  class={`text-sm my-auto ${calc_critical(
                    dmg,
                    props.battle_selected()?.support_attack?.support_airatack
                      ?.e_damage?.cl?.[dmg_index()]
                  )}`}
                >
                  {dmg}
                </div>
              </Show>
            </>
          )}
        </For>
      </td>
    );
  };

  return (
    <Show when={show_support()}>
      <li>
        <details open={true}>
          <summary>Support Attack</summary>
          <ul class="pl-0">
            <table class="table table-xs">
              <thead>
                <tr>
                  <th>Attack</th>
                  <th>HP</th>
                  <th>Defense</th>
                  <th>HP</th>
                  <th>Damage</th>
                </tr>
              </thead>
              <tbody>
                <Show when={show_support_hourai()}>
                  <tr class="rounded">
                    {attacker_ships()}
                    {attacker_hps()}
                    {hourai_defenser_ships()}
                    {hourai_defenser_hps()}
                    {hourai_damages()}
                  </tr>
                </Show>
                <Show when={show_support_airattack()}>
                  <tr class="rounded">
                    {attacker_ships()}
                    {attacker_hps()}
                    {airattack_defenser_ships()}
                    {airattack_defenser_hps()}
                    {airattack_defenser_damages()}
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
