import { createMemo, For, Show } from "solid-js";

import type { Battle } from "@ipc-bindings/battle";
import IconShield from "../icons/shield";
import { DataSetParamShip, DataSetShip } from "../utility/get_data_set";
import { calc_critical, DeckShipIds } from "../utility/battles";
import {
  WrapEnemyShipHPComponent,
  WrapNumberedEnemyShipComponent,
  WrapNumberedErrorShipComponent,
  WrapNumberedOwnShipComponent,
  WrapOwnShipHPComponent,
} from "./wrap_web_component";

interface AntiSubmarineProps {
  deck_ship_id: () => DeckShipIds;
  battle_selected: () => Battle | undefined;
  store_data_set_deck_ship: () => DataSetShip;
  store_data_set_param_ship: () => DataSetParamShip;
}

export function OpeningAntiSubmarineComponent(props: AntiSubmarineProps) {
  const show_anti_submarine = createMemo<boolean>(() => {
    if (!props.battle_selected()) return false;
    if (!props.battle_selected()?.deck_id) return false;
    if (!props.battle_selected()?.opening_taisen) return false;
    return true;
  });

  const attacker_ship = (at: number, at_index: () => number) => {
    const at_eflag = props.battle_selected()?.opening_taisen?.at_eflag;
    if (at_eflag) {
      if (at_eflag[at_index()] == 0) {
        return (
          <td>
            <div class="flex flex-nowarp">
              <WrapNumberedOwnShipComponent
                ship_idx={at}
                battle_selected={props.battle_selected}
                deck_ship_id={props.deck_ship_id}
                store_data_set_deck_ship={props.store_data_set_deck_ship}
              />
            </div>
          </td>
        );
      } else {
        return (
          <td>
            <div class="flex flex-nowarp">
              <WrapNumberedEnemyShipComponent
                ship_idx={at}
                battle_selected={props.battle_selected}
                store_data_set_param_ship={props.store_data_set_param_ship}
              />
            </div>
          </td>
        );
      }
    } else {
      return (
        <td>
          <div class="flex flex-nowarp">
            <WrapNumberedErrorShipComponent />
          </div>
        </td>
      );
    }
  };

  const attacker_hp = (at: number, at_index: () => number) => {
    const at_eflag = props.battle_selected()?.opening_taisen?.at_eflag;
    if (at_eflag) {
      if (at_eflag[at_index()] == 0) {
        return (
          <td>
            <WrapOwnShipHPComponent
              f_now_hps={
                props.battle_selected()?.opening_taisen?.f_now_hps[at_index()]
              }
              battle_selected={props.battle_selected}
              deck_ship_id={props.deck_ship_id}
              idx={at}
              store_data_set_deck_ship={props.store_data_set_deck_ship}
            />
          </td>
        );
      } else {
        return (
          <td>
            <WrapEnemyShipHPComponent
              e_now_hps={
                props.battle_selected()?.opening_taisen?.e_now_hps[at_index()]
              }
              idx={at}
              store_data_set_param_ship={props.store_data_set_param_ship}
            />
          </td>
        );
      }
    } else {
      return <td />;
    }
  };

  const defenser_ships = (at_index: () => number) => {
    const df_list = props.battle_selected()?.opening_taisen?.df_list;
    const at_eflag = props.battle_selected()?.opening_taisen?.at_eflag;
    const protect_flag = props.battle_selected()?.opening_taisen?.protect_flag;
    if (at_eflag) {
      if (at_eflag[at_index()] == 0) {
        return (
          <td>
            <div class="flex flex-col">
              <For each={df_list?.[at_index()]}>
                {(df, df_index) => (
                  <div class="flex flex-nowarp">
                    <WrapNumberedEnemyShipComponent
                      ship_idx={df}
                      battle_selected={props.battle_selected}
                      store_data_set_param_ship={
                        props.store_data_set_param_ship
                      }
                    />
                    <Show when={protect_flag?.[at_index()]?.[df_index()]}>
                      <IconShield class="h-4 self-center ml-auto" />
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </td>
        );
      } else {
        return (
          <td>
            <div class="flex flex-col">
              <For each={df_list?.[at_index()]}>
                {(df, df_index) => (
                  <div class="flex flex-nowarp">
                    <WrapNumberedOwnShipComponent
                      ship_idx={df}
                      deck_ship_id={props.deck_ship_id}
                      battle_selected={props.battle_selected}
                      store_data_set_deck_ship={props.store_data_set_deck_ship}
                    />
                    <Show when={protect_flag?.[at_index()]?.[df_index()]}>
                      <IconShield class="h-4 self-center ml-auto" />
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </td>
        );
      }
    } else {
      return (
        <td>
          <div class="flex flex-col">
            <For each={df_list?.[at_index()]}>
              {() => (
                <div class="flex flex-nowarp">
                  <WrapNumberedErrorShipComponent />
                </div>
              )}
            </For>
          </div>
        </td>
      );
    }
  };

  const defenser_hps = (at_index: () => number) => {
    const df_list = props.battle_selected()?.opening_taisen?.df_list;
    const at_eflag = props.battle_selected()?.opening_taisen?.at_eflag;
    if (at_eflag) {
      if (at_eflag[at_index()] == 0) {
        return (
          <td>
            <div class="flex flex-col">
              <For each={df_list?.[at_index()]}>
                {(df) => (
                  <div class="flex flex-nowarp">
                    <WrapEnemyShipHPComponent
                      e_now_hps={
                        props.battle_selected()?.opening_taisen?.e_now_hps[
                          at_index()
                        ]
                      }
                      idx={df}
                      store_data_set_param_ship={
                        props.store_data_set_param_ship
                      }
                    />
                  </div>
                )}
              </For>
            </div>
          </td>
        );
      } else {
        return (
          <td>
            <div class="flex flex-col">
              <For each={df_list?.[at_index()]}>
                {(df) => (
                  <div class="flex flex-nowarp">
                    <WrapOwnShipHPComponent
                      battle_selected={props.battle_selected}
                      deck_ship_id={props.deck_ship_id}
                      f_now_hps={
                        props.battle_selected()?.opening_taisen?.f_now_hps[
                          at_index()
                        ]
                      }
                      idx={df}
                      store_data_set_deck_ship={props.store_data_set_deck_ship}
                    />
                  </div>
                )}
              </For>
            </div>
          </td>
        );
      }
    } else {
      return (
        <td>
          <div class="flex flex-col" />
        </td>
      );
    }
  };

  const damages = (at_index: () => number) => {
    return (
      <td>
        <div class="flex flex-col">
          <For
            each={props.battle_selected()?.opening_taisen?.damage?.[at_index()]}
          >
            {(dmg, dmg_index) => (
              <>
                <div
                  class={`text-sm h-6 ${calc_critical(
                    dmg,
                    props.battle_selected()?.opening_taisen?.cl_list?.[
                      at_index()
                    ]?.[dmg_index()]
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

  return (
    <Show when={show_anti_submarine()}>
      <li>
        <details open={true}>
          <summary>Opening Anti-submarine</summary>
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
                <For each={props.battle_selected()?.opening_taisen?.at_list}>
                  {(at, at_index) => (
                    <tr class="rounded">
                      {attacker_ship(at, at_index)}
                      {attacker_hp(at, at_index)}
                      {defenser_ships(at_index)}
                      {defenser_hps(at_index)}
                      {damages(at_index)}
                    </tr>
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
