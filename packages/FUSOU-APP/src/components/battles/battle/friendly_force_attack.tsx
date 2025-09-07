import { createMemo, For, Show } from "solid-js";

import type { Battle } from "@ipc-bindings/battle";
import IconShield from "../../../icons/shield";
import type { DeckShipIds } from "../../../utility/battles";
import { calc_critical } from "../../../utility/battles";
import type {
  DataSetParamShip,
  DataSetShip,
} from "../../../utility/get_data_set";
import {
  WrapCIMstEquipComponent,
  WrapEnemyShipComponent,
  WrapEnemyShipHPComponent,
  WrapFriendShipComponent,
  WrapFriendShipHPComponent,
  WrapNumberedEnemyShipComponent,
  WrapNumberedErrorShipComponent,
  WrapNumberedFriendShipComponent,
} from "../wrap_web_component";

interface FriendlyForceAttackProps {
  deck_ship_id: () => DeckShipIds;
  battle_selected: () => Battle | undefined;
  store_data_set_deck_ship: () => DataSetShip;
  store_data_set_param_ship: () => DataSetParamShip;
}

export function FriendlyForceAttackComponent(props: FriendlyForceAttackProps) {
  const show_shelling = createMemo<boolean>(() => {
    if (!props.battle_selected()) return false;
    if (!props.battle_selected()?.friendly_force_attack) return false;
    if (!props.battle_selected()?.friendly_force_attack?.fleet_info)
      return false;
    if (!props.battle_selected()?.friendly_force_attack?.support_hourai)
      return false;
    if (
      !props.battle_selected()?.friendly_force_attack?.support_hourai?.hougeki
    )
      return false;
    return true;
  });

  const display_flare = () => {
    const flare_pos =
      props.battle_selected()?.friendly_force_attack?.support_hourai?.flare_pos;
    const f_flare_pos = flare_pos?.[0] ?? -1;
    const e_flare_pos = flare_pos?.[1] ?? -1;
    return (
      <>
        Flare : <span class="w-1" />
        <Show
          when={flare_pos}
          fallback={
            <div>
              <div class="w-24 text-center">_</div>
              <div class="w-3 text-center">/</div>
              <div class="w-24 text-center">_</div>
            </div>
          }
        >
          <div class="w-24 flex justify-center">
            <Show when={f_flare_pos != -1} fallback={<div>_</div>}>
              <WrapFriendShipComponent
                ship_idx={f_flare_pos}
                store_data_set_param_ship={props.store_data_set_param_ship}
                name_flag={false}
              />
            </Show>
          </div>
          <div class="w-3 text-center">/</div>
          <div class="w-24 flex justify-center">
            <Show when={e_flare_pos != -1} fallback={<div>_</div>}>
              <WrapEnemyShipComponent
                ship_idx={e_flare_pos}
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
    const at_eflag =
      props.battle_selected()?.friendly_force_attack?.support_hourai?.hougeki
        .at_eflag;
    if (at_eflag) {
      if (at_eflag[at_index()] == 0) {
        return (
          <td>
            <div class="flex flex-nowrap">
              <WrapNumberedFriendShipComponent
                ship_idx={at}
                battle_selected={props.battle_selected}
                store_data_set_param_ship={props.store_data_set_param_ship}
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
    const at_eflag =
      props.battle_selected()?.friendly_force_attack?.support_hourai?.hougeki
        .at_eflag;
    if (at_eflag) {
      if (at_eflag[at_index()] == 0) {
        return (
          <td>
            <WrapFriendShipHPComponent
              store_data_set_param_ship={props.store_data_set_param_ship}
              idx={at}
              friend_now_hps={
                props.battle_selected()?.friendly_force_attack?.support_hourai
                  ?.hougeki.f_now_hps[at_index()]
              }
            />
          </td>
        );
      } else {
        return (
          <td>
            <WrapEnemyShipHPComponent
              idx={at}
              store_data_set_param_ship={props.store_data_set_param_ship}
              e_now_hps={
                props.battle_selected()?.friendly_force_attack?.support_hourai
                  ?.hougeki.e_now_hps[at_index()]
              }
            />
          </td>
        );
      }
    } else {
      return <td />;
    }
  };

  const defenser_ships = (at_index: () => number) => {
    const at_eflag =
      props.battle_selected()?.friendly_force_attack?.support_hourai?.hougeki
        .at_eflag;
    const df_list =
      props.battle_selected()?.friendly_force_attack?.support_hourai?.hougeki
        .df_list;
    const protect_flag =
      props.battle_selected()?.friendly_force_attack?.support_hourai?.hougeki
        ?.protect_flag;
    if (at_eflag) {
      if (at_eflag[at_index()] == 0) {
        return (
          <td>
            <div class="flex flex-col">
              <div class="flex flex-nowrap">
                <For each={df_list?.[at_index()]}>
                  {(df, df_index) => (
                    <div class="flex flex-nowrap">
                      <WrapNumberedEnemyShipComponent
                        ship_idx={df}
                        battle_selected={props.battle_selected}
                        store_data_set_param_ship={
                          props.store_data_set_param_ship
                        }
                      />
                      <Show when={protect_flag?.[at_index()]?.[df_index()]}>
                        <IconShield class="h-5 w-5" />
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </td>
        );
      } else {
        return (
          <td>
            <div class="flex flex-col">
              <div class="flex flex-nowrap">
                <For each={df_list?.[at_index()]}>
                  {(df, df_index) => (
                    <div class="flex flex-nowrap">
                      <WrapNumberedFriendShipComponent
                        ship_idx={df}
                        battle_selected={props.battle_selected}
                        store_data_set_param_ship={
                          props.store_data_set_param_ship
                        }
                      />
                      <Show when={protect_flag?.[at_index()]?.[df_index()]}>
                        <IconShield class="h-5 w-5" />
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </td>
        );
      }
    } else {
      return (
        <td>
          <div class="flex flex-col">
            <div class="flex flex-nowrap">
              <WrapNumberedErrorShipComponent />
            </div>
          </div>
        </td>
      );
    }
  };

  const defenser_hps = (at_index: () => number) => {
    const at_eflag =
      props.battle_selected()?.friendly_force_attack?.support_hourai?.hougeki
        .at_eflag;
    const df_list =
      props.battle_selected()?.friendly_force_attack?.support_hourai?.hougeki
        .df_list;
    if (at_eflag) {
      if (at_eflag[at_index()] == 0) {
        return (
          <td>
            <div class="flex flex-col">
              <For each={df_list?.[at_index()]}>
                {(df) => (
                  <WrapEnemyShipHPComponent
                    idx={df}
                    store_data_set_param_ship={props.store_data_set_param_ship}
                    e_now_hps={
                      props.battle_selected()?.friendly_force_attack
                        ?.support_hourai?.hougeki?.e_now_hps[at_index()]
                    }
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
              <For each={df_list?.[at_index()]}>
                {(df) => (
                  <WrapFriendShipHPComponent
                    store_data_set_param_ship={props.store_data_set_param_ship}
                    idx={df}
                    friend_now_hps={
                      props.battle_selected()?.friendly_force_attack
                        ?.support_hourai?.hougeki?.f_now_hps[at_index()]
                    }
                  />
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
            each={
              props.battle_selected()?.friendly_force_attack?.support_hourai
                ?.hougeki?.damage?.[at_index()]
            }
          >
            {(dmg, dmg_index) => (
              <>
                <div
                  class={`text-sm h-6 ${calc_critical(
                    dmg,
                    props.battle_selected()?.friendly_force_attack
                      ?.support_hourai?.hougeki?.cl_list?.[at_index()]?.[
                      dmg_index()
                    ]
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
            props.battle_selected()?.friendly_force_attack?.support_hourai
              ?.hougeki.df_list?.[at_index()]?.length == 1
              ? "flex flex-nowrap"
              : "flex flex-col"
          }
        >
          <Show
            when={
              props.battle_selected()?.friendly_force_attack?.support_hourai
                ?.hougeki.si_list?.[at_index()]
            }
          >
            <For
              each={
                props.battle_selected()?.friendly_force_attack?.support_hourai
                  ?.hougeki.si_list?.[at_index()]
              }
            >
              {(si) => (
                <Show when={si}>
                  <WrapCIMstEquipComponent
                    si={si!}
                    e_flag={
                      props.battle_selected()?.friendly_force_attack
                        ?.support_hourai?.hougeki.at_eflag?.[at_index()] !== 0
                    }
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
          <summary>Friendly Force Attack</summary>
          <ul class="pl-0">
            <div class="pl-2 text-xs flex felx-nowarp">{display_flare()}</div>
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
                <Show
                  when={
                    props.battle_selected()?.friendly_force_attack
                      ?.support_hourai?.hougeki.at_list
                  }
                >
                  <For
                    each={
                      props.battle_selected()?.friendly_force_attack
                        ?.support_hourai?.hougeki.at_list
                    }
                  >
                    {(at, at_index) => (
                      <tr>
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
