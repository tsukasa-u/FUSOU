import { createMemo, For, Show } from "solid-js";

import "../../../css/divider.css";
import type { Battle } from "@ipc-bindings/battle";
import IconShield from "../../../icons/shield";
import type { DeckShipIds } from "../../../utility/battles";
import type {
  DataSetParamShip,
  DataSetShip,
} from "../../../utility/get_data_set";
import {
  WrapCIMstEquipComponent,
  WrapEnemyShipComponent,
  WrapEnemyShipHPComponent,
  WrapNumberedEnemyShipComponent,
  WrapNumberedErrorShipComponent,
  WrapNumberedOwnShipComponent,
  WrapOwnShipComponent,
  WrapOwnShipHPComponent,
} from "../wrap_web_component";
import { DamageCommonComponent } from "../dmg";

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

  const midnight_hougeki = createMemo(() => {
    if (!show_shelling()) return undefined;
    const midnight_hougeki = props.battle_selected()?.midnight_hougeki;
    return midnight_hougeki ?? undefined;
  });

  const display_touch = () => {
    const midnight_touchplane = props.battle_selected()?.midnight_touchplane;
    const f_midnight_touchplane =
      (midnight_touchplane ? midnight_touchplane[0] : undefined) ?? 0;
    const e_midnight_touchplane =
      (midnight_touchplane ? midnight_touchplane[1] : undefined) ?? 0;
    return (
      <>
        touch : <span class="w-1" />
        <div class="w-6 flex justify-center">
          <Show
            when={f_midnight_touchplane > 0}
            fallback={<div class="w-6 text-center">_</div>}
          >
            <WrapCIMstEquipComponent
              si={f_midnight_touchplane}
              e_flag={false}
            />
          </Show>
        </div>
        <div class="w-3 text-center">/</div>
        <div class="w-6 flex justify-center">
          <Show
            when={e_midnight_touchplane > 0}
            fallback={<div class="w-6 text-center">_</div>}
          >
            <WrapCIMstEquipComponent si={e_midnight_touchplane} e_flag={true} />
          </Show>
        </div>
      </>
    );
  };

  const display_flare = () => {
    const midnight_flare_pos = props.battle_selected()?.midnight_flare_pos;
    const f_midnight_flare_pos = midnight_flare_pos
      ? midnight_flare_pos[0]
      : -1;
    const e_midnight_flare_pos = midnight_flare_pos
      ? midnight_flare_pos[1]
      : -1;
    return (
      <>
        Flare : <span class="w-1" />
        <Show
          when={midnight_flare_pos}
          fallback={
            <div class="flex flex-nowrap">
              <div class="w-24 text-center">___</div>
              <div class="w-3 text-center">/</div>
              <div class="w-24 text-center">___</div>
            </div>
          }
        >
          <div class="flex flex-nowrap place-items-center">
            <div class="w-24 flex justify-start">
              <Show
                when={f_midnight_flare_pos != -1}
                fallback={<div class="text-center">___</div>}
              >
                {/* <WrapNumberedOwnShipComponent
                  ship_idx={f_midnight_flare_pos}
                  deck_ship_id={props.deck_ship_id}
                  battle_selected={props.battle_selected}
                  store_data_set_deck_ship={props.store_data_set_deck_ship}
                /> */}
                <WrapOwnShipComponent
                  ship_idx={f_midnight_flare_pos}
                  deck_ship_id={props.deck_ship_id}
                  battle_selected={props.battle_selected}
                  store_data_set_deck_ship={props.store_data_set_deck_ship}
                  name_flag={true}
                />
              </Show>
            </div>
            <div class="w-3 text-center">/</div>
            <div class="w-24 flex justify-center">
              <Show
                when={e_midnight_flare_pos != -1}
                fallback={<div class="text-center">___</div>}
              >
                {/* <WrapNumberedEnemyShipComponent
                  ship_idx={e_midnight_flare_pos}
                  battle_selected={props.battle_selected}
                  store_data_set_param_ship={props.store_data_set_param_ship}
                /> */}
                <WrapEnemyShipComponent
                  ship_idx={e_midnight_flare_pos}
                  store_data_set_param_ship={props.store_data_set_param_ship}
                  name_flag={true}
                />
              </Show>
            </div>
          </div>
        </Show>
      </>
    );
  };

  const attacker_ship = (at: number, at_index: () => number) => {
    const at_eflag = midnight_hougeki()?.at_eflag;
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
    const at_eflag = midnight_hougeki()?.at_eflag;
    if (at_eflag) {
      if (at_eflag[at_index()] == 0) {
        return (
          <td>
            <WrapOwnShipHPComponent
              deck_ship_id={props.deck_ship_id}
              battle_selected={props.battle_selected}
              store_data_set_deck_ship={props.store_data_set_deck_ship}
              idx={at}
              f_now_hps={midnight_hougeki()?.f_now_hps[at_index()]}
            />
          </td>
        );
      } else {
        return (
          <td>
            <WrapEnemyShipHPComponent
              store_data_set_param_ship={props.store_data_set_param_ship}
              idx={at}
              e_now_hps={midnight_hougeki()?.e_now_hps[at_index()]}
            />
          </td>
        );
      }
    } else {
      return <td />;
    }
  };

  const defenser_ships = (at_index: () => number) => {
    if (midnight_hougeki()?.at_eflag) {
      if (midnight_hougeki()?.at_eflag?.[at_index()] == 0) {
        return (
          <td>
            <div class="flex flex-col">
              <For each={midnight_hougeki()?.df_list?.[at_index()]}>
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
                          midnight_hougeki()?.protect_flag?.[at_index()]?.[
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
              <For each={midnight_hougeki()?.df_list?.[at_index()]}>
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
                          midnight_hougeki()?.protect_flag?.[at_index()]?.[
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
            <For each={midnight_hougeki()?.df_list?.[at_index()]}>
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
    if (midnight_hougeki()?.at_eflag && midnight_hougeki()?.df_list) {
      if (midnight_hougeki()?.at_eflag?.[at_index()] == 0) {
        return (
          <td>
            <div class="flex flex-col">
              <For each={midnight_hougeki()?.df_list?.[at_index()]}>
                {(df) => (
                  <WrapEnemyShipHPComponent
                    store_data_set_param_ship={props.store_data_set_param_ship}
                    idx={df}
                    e_now_hps={midnight_hougeki()?.e_now_hps?.[at_index()]}
                  />
                )}
              </For>
            </div>
          </td>
        );
      } else {
        return (
          <td>
            <div class="flex flex-col">
              <For each={midnight_hougeki()?.df_list?.[at_index()]}>
                {(df) => (
                  <WrapOwnShipHPComponent
                    deck_ship_id={props.deck_ship_id}
                    battle_selected={props.battle_selected}
                    store_data_set_deck_ship={props.store_data_set_deck_ship}
                    idx={df}
                    f_now_hps={midnight_hougeki()?.f_now_hps[at_index()]}
                  />
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
          <For each={midnight_hougeki()?.damage?.[at_index()]}>
            {(dmg, dmg_index) => (
              <>
                <DamageCommonComponent
                  dmg={dmg}
                  critical_flag={
                    midnight_hougeki()?.cl_list?.[at_index()]?.[dmg_index()]
                  }
                />
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
            midnight_hougeki()?.df_list?.[at_index()].length == 1
              ? "flex flex-nowrap"
              : "flex flex-col"
          }
        >
          <Show when={midnight_hougeki()?.si_list?.[at_index()]}>
            <For each={midnight_hougeki()?.si_list?.[at_index()]}>
              {(si) => (
                <Show when={si}>
                  <WrapCIMstEquipComponent
                    si={si!}
                    e_flag={midnight_hougeki()?.at_eflag?.[at_index()] !== 0}
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
            <div class="pl-2 text-xs flex flex-nowrap items-center">
              {display_touch()}
              <div class="divider divider-horizontal mr-0 ml-0" />
              {display_flare()}
            </div>
            <table class="table table-xs">
              <thead>
                <tr>
                  <th class="w-2/8">Attack</th>
                  <th class="w-1/8">HP</th>
                  <th class="w-2/8">Defense</th>
                  <th class="w-1/8">HP</th>
                  <th class="w-1/8">Damage</th>
                  <th class="w-1/8">CI</th>
                </tr>
              </thead>
              <tbody>
                <Show when={midnight_hougeki()?.at_list}>
                  <For each={midnight_hougeki()?.at_list}>
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
