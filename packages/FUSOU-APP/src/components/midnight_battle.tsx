import { createMemo, For, Show } from "solid-js";

import "../css/divider.css";
import type { Battle } from "@ipc-bindings/battle";
import IconShield from "../icons/shield";
import { calc_critical, type DeckShipIds } from "../utility/battles";
import { DataSetParamShip, DataSetShip } from "../utility/get_data_set";
import {
  WrapCIMstEquipComponent,
  WrapEnemyShipComponent,
  WrapEnemyShipHPComponent,
  WrapNumberedEnemyShipComponent,
  WrapNumberedErrorShipComponent,
  WrapNumberedOwnShipComponent,
  WrapOwnShipComponent,
  WrapOwnShipHPComponent,
} from "./wrap_web_component";

interface MidnightShellingProps {
  deck_ship_id: () => DeckShipIds;
  battle_selected: () => Battle | undefined;
  store_data_set_deck_ship: () => DataSetShip;
  store_data_set_param_ship: () => DataSetParamShip;
}

export function MidnightShellingComponent(props: MidnightShellingProps) {
  const show_shelling = createMemo<boolean>(() => {
    if (!props.battle_selected()) return false;
    if (!props.battle_selected()?.deck_id) return false;
    if (!props.battle_selected()?.midnight_hougeki) return false;
    return true;
  });

  const midngiht_hougeki = createMemo(() => {
    if (!show_shelling()) return undefined;
    let midnight_hougeki = props.battle_selected()?.midnight_hougeki;
    return midnight_hougeki ?? undefined;
  });

  const display_touch = () => {
    let midngiht_touchplane = props.battle_selected()?.midngiht_touchplane;
    let f_midngiht_touchplane =
      (midngiht_touchplane ? midngiht_touchplane[0] : undefined) ?? 0;
    let e_midngiht_touchplane =
      (midngiht_touchplane ? midngiht_touchplane[1] : undefined) ?? 0;
    return (
      <>
        touch : <span class="w-1" />
        <div class="w-6 flex justify-center">
          <Show when={f_midngiht_touchplane > 0} fallback={<div>_</div>}>
            <WrapCIMstEquipComponent
              si={f_midngiht_touchplane}
              e_flag={false}
            />
          </Show>
        </div>
        <div class="w-3 text-center">/</div>
        <div class="w-6 flex justify-center">
          <Show when={e_midngiht_touchplane > 0} fallback={<div>_</div>}>
            <WrapCIMstEquipComponent si={e_midngiht_touchplane} e_flag={true} />
          </Show>
        </div>
      </>
    );
  };

  const display_flare = () => {
    let midnight_flare_pos = props.battle_selected()?.midnight_flare_pos;
    let f_midnight_flare_pos = midnight_flare_pos ? midnight_flare_pos[0] : -1;
    let e_midnight_flare_pos = midnight_flare_pos ? midnight_flare_pos[1] : -1;
    return (
      <>
        Flare : <span class="w-1" />
        <Show
          when={midnight_flare_pos}
          fallback={
            <div class="flex flex-nowrap">
              <div class="w-24 text-center">_</div>
              <div class="w-3 text-center">/</div>
              <div class="w-24 text-center">_</div>
            </div>
          }
        >
          <div class="w-24 flex justify-center">
            <Show when={f_midnight_flare_pos != -1} fallback={<div>_</div>}>
              <WrapOwnShipComponent
                ship_idx={f_midnight_flare_pos}
                deck_ship_id={props.deck_ship_id}
                battle_selected={props.battle_selected}
                store_data_set_deck_ship={props.store_data_set_deck_ship}
                name_flag={false}
              />
            </Show>
          </div>
          <div class="w-3 text-center">/</div>
          <div class="w-24 flex justify-center">
            <Show when={e_midnight_flare_pos != -1} fallback={<div>_</div>}>
              <WrapEnemyShipComponent
                ship_idx={e_midnight_flare_pos}
                store_data_set_param_ship={props.store_data_set_param_ship}
                name_flag={false}
              />
            </Show>
          </div>
        </Show>
      </>
    );
  };

  const attacker_ship = (at: number, at_index: () => number) => {
    const at_eflag = midngiht_hougeki()?.at_eflag;
    if (at_eflag) {
      if (at_eflag[at_index()] == 0) {
        return (
          <td>
            <div class="flex flex-nowrap">
              <WrapNumberedOwnShipComponent
                ship_idx={at}
                deck_ship_id={props.deck_ship_id}
                battle_selected={props.battle_selected}
                store_data_set_deck_ship={props.store_data_set_deck_ship}
              />
            </div>
          </td>
        );
      } else {
        return (
          <td>
            <div class="flex flex-nowrap">
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
          <div class="flex flex-nowrap">
            <WrapNumberedErrorShipComponent />
          </div>
        </td>
      );
    }
  };

  const attacker_hp = (at: number, at_index: () => number) => {
    const at_eflag = midngiht_hougeki()?.at_eflag;
    if (at_eflag) {
      if (at_eflag[at_index()] == 0) {
        return (
          <td>
            <WrapOwnShipHPComponent
              deck_ship_id={props.deck_ship_id}
              battle_selected={props.battle_selected}
              store_data_set_deck_ship={props.store_data_set_deck_ship}
              idx={at}
              f_now_hps={midngiht_hougeki()?.f_now_hps[at_index()]}
            />
          </td>
        );
      } else {
        return (
          <td>
            <WrapEnemyShipHPComponent
              store_data_set_param_ship={props.store_data_set_param_ship}
              idx={at}
              e_now_hps={midngiht_hougeki()?.e_now_hps[at_index()]}
            />
          </td>
        );
      }
    } else {
      return <td />;
    }
  };

  const defenser_ships = (at_index: () => number) => {
    if (midngiht_hougeki()?.at_eflag) {
      if (midngiht_hougeki()?.at_eflag?.[at_index()] == 0) {
        return (
          <td>
            <div class="flex flex-col">
              <For each={midngiht_hougeki()?.df_list?.[at_index()]}>
                {(df, df_index) => {
                  return (
                    <div class="flex flex-nowrap">
                      <WrapNumberedEnemyShipComponent
                        ship_idx={df}
                        battle_selected={props.battle_selected}
                        store_data_set_param_ship={
                          props.store_data_set_param_ship
                        }
                      />
                      <Show
                        when={
                          midngiht_hougeki()?.protect_flag?.[at_index()]?.[
                            df_index()
                          ]
                        }
                      >
                        <IconShield class="h-4 self-center ml-auto" />
                      </Show>
                    </div>
                  );
                }}
              </For>
            </div>
          </td>
        );
      } else {
        return (
          <td>
            <div class="flex flex-col">
              <For each={midngiht_hougeki()?.df_list?.[at_index()]}>
                {(df, df_index) => {
                  return (
                    <div class="flex flex-nowrap">
                      <WrapNumberedOwnShipComponent
                        ship_idx={df}
                        deck_ship_id={props.deck_ship_id}
                        battle_selected={props.battle_selected}
                        store_data_set_deck_ship={
                          props.store_data_set_deck_ship
                        }
                      />
                      <Show
                        when={
                          midngiht_hougeki()?.protect_flag?.[at_index()]?.[
                            df_index()
                          ]
                        }
                      >
                        <IconShield class="h-4 self-center ml-auto" />
                      </Show>
                    </div>
                  );
                }}
              </For>
            </div>
          </td>
        );
      }
    } else {
      return (
        <td>
          <div class="flex flex-col">
            <For each={midngiht_hougeki()?.df_list?.[at_index()]}>
              {() => {
                return (
                  <div class="flex flex-nowrap">
                    <WrapNumberedErrorShipComponent />
                  </div>
                );
              }}
            </For>
          </div>
        </td>
      );
    }
  };

  const defenser_hps = (at_index: () => number) => {
    if (midngiht_hougeki()?.at_eflag && midngiht_hougeki()?.df_list) {
      if (midngiht_hougeki()?.at_eflag?.[at_index()] == 0) {
        return (
          <td>
            <div class="flex flex-col">
              <For each={midngiht_hougeki()?.df_list?.[at_index()]}>
                {(df) => (
                  <div class="flex flex-nowrap">
                    <WrapEnemyShipHPComponent
                      store_data_set_param_ship={
                        props.store_data_set_param_ship
                      }
                      idx={df}
                      e_now_hps={midngiht_hougeki()?.e_now_hps?.[at_index()]}
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
              <For each={midngiht_hougeki()?.df_list?.[at_index()]}>
                {(df) => (
                  <div class="flex flex-nowrap">
                    <WrapOwnShipHPComponent
                      deck_ship_id={props.deck_ship_id}
                      battle_selected={props.battle_selected}
                      store_data_set_deck_ship={props.store_data_set_deck_ship}
                      idx={df}
                      f_now_hps={midngiht_hougeki()?.f_now_hps[at_index()]}
                    />
                  </div>
                )}
              </For>
            </div>
          </td>
        );
      }
    } else {
      return <td />;
    }
  };

  const damages = (at_index: () => number) => {
    return (
      <td>
        <div class="flex flex-col">
          <For each={midngiht_hougeki()?.damage?.[at_index()]}>
            {(dmg, dmg_index) => (
              <>
                <div
                  class={`text-sm h-6 ${calc_critical(
                    dmg,
                    midngiht_hougeki()?.cl_list?.[at_index()]?.[dmg_index()]
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

  const cut_in = (at_index: () => number) => {
    return (
      <td>
        <div
          class={
            midngiht_hougeki()?.df_list?.[at_index()].length == 1
              ? "flex flex-nowrap"
              : "flex flex-col"
          }
        >
          <Show when={midngiht_hougeki()?.si_list?.[at_index()]}>
            <For each={midngiht_hougeki()?.si_list?.[at_index()]}>
              {(si) => (
                <Show when={si}>
                  <WrapCIMstEquipComponent
                    si={si!}
                    e_flag={midngiht_hougeki()?.at_eflag?.[at_index()] !== 0}
                  />
                </Show>
              )}
            </For>
          </Show>
        </div>
      </td>
    );
  };

  return (
    <Show when={show_shelling()}>
      <li>
        <details open={true}>
          <summary>Midnight Shelling</summary>
          <ul class="pl-0">
            <div class="pl-2 text-xs flex flex-nowrap">
              {display_touch()}
              <div class="divider divider-horizontal mr-0 ml-0" />
              {display_flare()}
            </div>
            <table class="table table-xs">
              <thead>
                <tr>
                  <th>Attack</th>
                  <th>HP</th>
                  <th>Defense</th>
                  <th>HP</th>
                  <th>Damage</th>
                  <th>CI</th>
                </tr>
              </thead>
              <tbody>
                <Show when={midngiht_hougeki()?.at_list}>
                  <For each={midngiht_hougeki()?.at_list}>
                    {(at, at_index) => (
                      <tr class="rounded">
                        {attacker_ship(at, at_index)}
                        {attacker_hp(at, at_index)}
                        {defenser_ships(at_index)}
                        {defenser_hps(at_index)}
                        {damages(at_index)}
                        {cut_in(at_index)}
                      </tr>
                    )}
                  </For>
                </Show>
              </tbody>
            </table>
          </ul>
        </details>
      </li>
    </Show>
  );
}
