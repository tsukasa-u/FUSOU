import { createMemo, For, Show } from "solid-js";

import type { Battle } from "@ipc-bindings/battle";
import IconShield from "../../../icons/shield";
import type {
  DataSetParamShip,
  DataSetShip,
} from "../../../utility/get_data_set";
import type { DeckShipIds } from "../../../utility/battles";
import {
  WrapEnemyShipHPComponent,
  WrapNumberedEnemyShipComponent,
  WrapNumberedSupportShipComponent,
  WrapSupportShipHPComponent,
} from "../wrap_web_component";

import "../../../css/battle_table_common.css";
import { DamageCommonComponent } from "../dmg";

interface NightSupportAttackProps {
  deck_ship_id: () => DeckShipIds;
  battle_selected: () => Battle | undefined;
  store_data_set_deck_ship: () => DataSetShip;
  store_data_set_param_ship: () => DataSetParamShip;
}

export function NightSupportAttackComponent(props: NightSupportAttackProps) {
  const show_night_support = createMemo<boolean>(() => {
    if (!props.battle_selected()) return false;
    if (!props.battle_selected()?.night_support_attack) return false;
    return true;
  });

  const show_night_support_hourai = createMemo<boolean>(() => {
    return props.battle_selected()?.night_support_attack?.hourai ? true : false;
  });

  const night_support_deck_id = () => {
    return (
      props.battle_selected()?.night_support_attack?.hourai?.deck_id ??
      props.battle_selected()?.night_support_attack?.airatack?.deck_id
    );
  };

  const ship_ids = () => {
    const deck_id = night_support_deck_id();
    if (!deck_id) return undefined;
    return props.deck_ship_id()[deck_id];
  };

  const attacker_ships = () => {
    return (
      <td>
        <div class="flex flex-col">
          <For each={ship_ids()}>
            {(_, idx) => (
              <>
                <Show when={idx() > 0}>
                  <div class="h-px" />
                </Show>
                <div class="flex flex-nowrap">
                  <WrapNumberedSupportShipComponent
                    ship_idx={idx()}
                    support_deck_id={night_support_deck_id()}
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
          <For each={ship_ids()}>
            {(_, idx) => (
              <>
                <Show when={idx() > 0}>
                  <div class="h-px" />
                </Show>
                <WrapSupportShipHPComponent
                  deck_ship_id={props.deck_ship_id}
                  idx={idx()}
                  support_deck_id={night_support_deck_id()}
                  store_data_set_deck_ship={props.store_data_set_deck_ship}
                />
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
                      ?.night_support_attack?.hourai?.protect_flag.some(
                        (flag) => flag,
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

  const defenser_hps = () => {
    return (
      <td>
        <For each={props.battle_selected()?.enemy_ship_id}>
          {(_, idx) => (
            <>
              <Show when={idx() > 0}>
                <div class="h-px" />
              </Show>
              <WrapEnemyShipHPComponent
                idx={idx()}
                store_data_set_param_ship={props.store_data_set_param_ship}
                e_now_hps={
                  props.battle_selected()?.night_support_attack?.hourai?.now_hps
                }
              />
            </>
          )}
        </For>
      </td>
    );
  };

  const damages = () => {
    return (
      <td>
        <div class="flex flex-col">
          <For
            each={props
              .battle_selected()
              ?.night_support_attack?.hourai?.damage.slice(
                0,
                props.battle_selected()?.enemy_ship_id?.length,
              )}
          >
            {(dmg, dmg_index) => (
              <>
                <Show when={dmg_index() > 0}>
                  <div class="h-px" />
                </Show>
                <DamageCommonComponent
                  dmg={dmg}
                  critical_flag={
                    props.battle_selected()?.night_support_attack?.hourai
                      ?.cl_list[dmg_index()]
                  }
                />
              </>
            )}
          </For>
        </div>
      </td>
    );
  };

  const night_air_total_damage = createMemo<number>(() => {
    const damages =
      props.battle_selected()?.night_support_attack?.airatack?.e_damage
        ?.damages;
    return damages?.reduce((sum, dmg) => sum + dmg, 0) ?? 0;
  });

  return (
    <Show when={show_night_support()}>
      <li>
        <details open={true}>
          <summary>Night Support Attack (夜間支援)</summary>
          <ul class="pl-0">
            <table class="table table-xs">
              <thead>
                <tr>
                  <th class="w-2/8">Attack</th>
                  <th class="w-1/8">HP</th>
                  <th class="w-2/8">Defense</th>
                  <th class="w-1/8">HP</th>
                  <th class="w-1/8">Damage</th>
                  <th class="w-1/8" />
                </tr>
              </thead>
              <tbody>
                <Show when={show_night_support_hourai()}>
                  <tr class="rounded">
                    {attacker_ships()}
                    {attacker_hps()}
                    {defenser_ships()}
                    {defenser_hps()}
                    {damages()}
                  </tr>
                </Show>
                <Show
                  when={
                    props.battle_selected()?.night_support_attack?.airatack
                      ?.e_damage
                  }
                >
                  <tr>
                    <td colspan={6} class="text-sm">
                      夜間航空支援敵被ダメ合計: {night_air_total_damage()}
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
