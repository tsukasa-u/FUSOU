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
    return props.battle_selected()?.support_attack?.support_airatack
      ? true
      : false;
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

  const support_deck_id = () => {
    if (show_support_hourai()) {
      return props.battle_selected()?.support_attack?.support_hourai?.deck_id;
    } else if (show_support_airattack()) {
      return props.battle_selected()?.support_attack?.support_airatack?.deck_id;
    } else {
      return undefined;
    }
  };
  const ship_ids = () => {
    const deck_id = support_deck_id();
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
                    support_deck_id={support_deck_id()}
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
                  support_deck_id={support_deck_id()}
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
              <Show when={idx() > 0}>
                <div class="h-px" />
              </Show>
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
            each={props
              .battle_selected()
              ?.support_attack?.support_hourai?.damage.slice(
                0,
                props.battle_selected()?.enemy_ship_id?.length
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
                    props.battle_selected()?.support_attack?.support_hourai
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
                <Show when={idx() > 0}>
                  <div class="h-px" />
                </Show>
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
          each={props
            .battle_selected()
            ?.support_attack?.support_airatack?.e_damage.damages?.slice(
              0,
              props.battle_selected()?.enemy_ship_id?.length
            )}
        >
          {(dmg, dmg_index) => (
            <>
              <Show when={show_air_damage()[0][dmg_index()]}>
                <Show when={dmg_index() > 0}>
                  <div class="h-px" />
                </Show>
                <DamageCommonComponent
                  dmg={dmg}
                  critical_flag={
                    props.battle_selected()?.support_attack?.support_airatack
                      ?.e_damage?.cl?.[dmg_index()]
                  }
                />
              </Show>
            </>
          )}
        </For>
      </td>
    );
  };

  const display_air_sprite_counts = () => {
    const support_airatack = props.battle_selected()?.support_attack?.support_airatack;
    if (!support_airatack) return null;

    const f_fly = support_airatack.f_sprite_fly_count;
    const e_fly = support_airatack.e_sprite_fly_count;
    const f_crash = support_airatack.f_sprite_crash_count;
    const e_crash = support_airatack.e_sprite_crash_count;
    const f_damage = support_airatack.f_sprite_damage_count;
    const e_damage = support_airatack.e_sprite_damage_count;

    const sum_or_unknown = (a: number | null, b: number | null) => {
      if (a == null && b == null) return "?";
      return (a ?? 0) + (b ?? 0);
    };

    const f_non_normal = sum_or_unknown(f_crash, f_damage);
    const e_non_normal = sum_or_unknown(e_crash, e_damage);

    return (
      <div class="pl-2 text-xs font-mono">
        <div>Sprite Motion (F / E)</div>
        <div>Fly: {f_fly ?? "?"} / {e_fly ?? "?"}</div>
        <div>Crash: {f_crash ?? "?"} / {e_crash ?? "?"}</div>
        <div>Damage: {f_damage ?? "?"} / {e_damage ?? "?"}</div>
        <div>Non-Normal (Crash+Damage): {f_non_normal} / {e_non_normal}</div>
        <div>
          Loss Plane (S1+S2):
          {" "}
          {support_airatack.f_damage.loss_plane1}+{support_airatack.f_damage.loss_plane2}
          {" / "}
          {support_airatack.e_damage.loss_plane1}+{support_airatack.e_damage.loss_plane2}
        </div>
      </div>
    );
  };

  return (
    <Show when={show_support()}>
      <li>
        <details open={true}>
          <summary>Support Attack</summary>
          <ul class="pl-0">
            <Show when={show_support_airattack()}>
              {display_air_sprite_counts()}
            </Show>
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
