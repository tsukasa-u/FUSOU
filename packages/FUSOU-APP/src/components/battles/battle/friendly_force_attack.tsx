import { createMemo, For, Show } from "solid-js";

import type { Battle } from "@ipc-bindings/battle";
import IconShield from "../../../icons/shield";
import type { DeckShipIds } from "../../../utility/battles";
import type {
  DataSetParamShip,
  DataSetShip,
} from "../../../utility/get_data_set";
import {
  ConnectedCIMstEquip,
  ConnectedEnemyShipHP,
  ConnectedFriendShipHP,
  ConnectedNumberedEnemyShip,
  ConnectedNumberedErrorShip,
  ConnectedNumberedFriendShip,
} from "../connected_components";
import { FlareShipComponent } from "../shared/flare_ship";
import { DamageCommonComponent } from "../dmg";

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
    return (
      <FlareShipComponent
        flarePos={
          props.battle_selected()?.friendly_force_attack?.support_hourai
            ?.flare_pos
        }
        battle_selected={props.battle_selected}
        store_data_set_param_ship={props.store_data_set_param_ship}
        isFriendlyForce={true}
      />
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
              <ConnectedNumberedFriendShip
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
              <ConnectedNumberedEnemyShip
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
            <ConnectedNumberedErrorShip />
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
            <ConnectedFriendShipHP
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
            <ConnectedEnemyShipHP
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
              <For each={df_list?.[at_index()]}>
                {(df, df_index) => (
                  <div class="flex flex-nowrap">
                    <ConnectedNumberedEnemyShip
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
                  <div class="flex flex-nowrap">
                    <ConnectedNumberedFriendShip
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
      }
    } else {
      return (
        <td>
          <div class="flex flex-col">
            <div class="flex flex-nowrap">
              <ConnectedNumberedErrorShip />
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
                  <ConnectedEnemyShipHP
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
                  <ConnectedFriendShipHP
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
                <DamageCommonComponent
                  dmg={dmg}
                  critical_flag={
                    props.battle_selected()?.friendly_force_attack
                      ?.support_hourai?.hougeki?.cl_list?.[at_index()]?.[
                      dmg_index()
                    ]
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
                  <ConnectedCIMstEquip
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
            <div class="pl-2 text-xs flex flex-nowrap items-center">
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
