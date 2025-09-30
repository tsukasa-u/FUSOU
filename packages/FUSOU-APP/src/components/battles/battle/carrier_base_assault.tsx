import { createMemo, For, Show } from "solid-js";

import type { Battle } from "@ipc-bindings/battle";
import IconShield from "../../../icons/shield";
import type { DeckShipIds } from "../../../utility/battles";
import type {
  DataSetParamShip,
  DataSetShip,
} from "../../../utility/get_data_set";
import {
  WrapEnemyShipHPComponent,
  WrapNumberedEnemyShipComponent,
  WrapNumberedOwnShipComponent,
  WrapOwnShipHPComponent,
} from "../wrap_web_component";
import { DamageCommonComponent } from "../dmg";

interface AirDamageProps {
  deck_ship_id: () => DeckShipIds;
  battle_selected: () => Battle | undefined;
  store_data_set_deck_ship: () => DataSetShip;
  store_data_set_param_ship: () => DataSetParamShip;
}

export function CarrierBaseAssaultComponent(props: AirDamageProps) {
  const show_air_attack = createMemo<boolean>(() => {
    if (!props.battle_selected()) return false;
    if (!props.battle_selected()?.deck_id) return false;
    if (!props.battle_selected()?.carrier_base_assault) return false;
    if (
      !props.battle_selected()?.carrier_base_assault?.f_damage.plane_from &&
      !props.battle_selected()?.carrier_base_assault?.e_damage.plane_from
    )
      return false;
    return true;
  });

  const show_damage = createMemo<boolean[][]>(() => {
    const show_damage: boolean[][] = [
      new Array(12).fill(false),
      new Array(12).fill(false),
    ];
    const carrier_base_assault = props.battle_selected()?.carrier_base_assault;
    if (!carrier_base_assault) return show_damage;
    carrier_base_assault?.e_damage.bak_flag?.forEach((flag, idx) => {
      show_damage[0][idx] ||= flag == 1;
    });
    carrier_base_assault?.e_damage.rai_flag?.forEach((flag, idx) => {
      show_damage[0][idx] ||= flag == 1;
    });
    carrier_base_assault?.f_damage.bak_flag?.forEach((flag, idx) => {
      show_damage[1][idx] ||= flag == 1;
    });
    carrier_base_assault?.f_damage.rai_flag?.forEach((flag, idx) => {
      show_damage[1][idx] ||= flag == 1;
    });
    return show_damage;
  });

  const show_f_plane_from = () => {
    return (
      (
        props.battle_selected()?.carrier_base_assault?.f_damage?.plane_from ??
        []
      ).length > 0
    );
  };

  const show_e_plane_from = () => {
    return (
      (
        props.battle_selected()?.carrier_base_assault?.e_damage?.plane_from ??
        []
      ).length > 0
    );
  };

  const f_attacker_ships = () => {
    const carrier_base_assault = props.battle_selected()?.carrier_base_assault;
    return (
      <td>
        <div class="flex flex-col">
          <For each={carrier_base_assault?.f_damage.plane_from}>
            {(ship_idx, idx) => (
              <>
                <Show when={idx() > 0}>
                  <div class="h-px" />
                </Show>
                <div class="flex flex-nowrap">
                  <WrapNumberedOwnShipComponent
                    battle_selected={props.battle_selected}
                    store_data_set_deck_ship={props.store_data_set_deck_ship}
                    ship_idx={ship_idx}
                    deck_ship_id={props.deck_ship_id}
                  />
                </div>
              </>
            )}
          </For>
        </div>
      </td>
    );
  };

  const f_attacker_hps = () => {
    const carrier_base_assault = props.battle_selected()?.carrier_base_assault;
    return (
      <td>
        <div class="flex flex-col">
          <For each={carrier_base_assault?.f_damage.plane_from}>
            {(ship_idx, idx) => (
              <>
                <Show when={idx() > 0}>
                  <div class="h-px" />
                </Show>
                <WrapOwnShipHPComponent
                  f_now_hps={carrier_base_assault?.f_damage.now_hps}
                  battle_selected={props.battle_selected}
                  deck_ship_id={props.deck_ship_id}
                  idx={ship_idx}
                  store_data_set_deck_ship={props.store_data_set_deck_ship}
                />
              </>
            )}
          </For>
        </div>
      </td>
    );
  };

  const e_defenser_ships = () => {
    const carrier_base_assault = props.battle_selected()?.carrier_base_assault;
    return (
      <td>
        <For each={carrier_base_assault?.e_damage.damages}>
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
                    store_data_set_param_ship={props.store_data_set_param_ship}
                  />
                  <Show
                    when={
                      carrier_base_assault?.e_damage.protect_flag?.some(
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

  const e_defenser_hps = () => {
    const carrier_base_assault = props.battle_selected()?.carrier_base_assault;
    return (
      <td>
        <For each={carrier_base_assault?.e_damage.damages}>
          {(_, idx) => (
            <>
              <Show when={show_damage()[0][idx()]}>
                <WrapEnemyShipHPComponent
                  e_now_hps={carrier_base_assault?.e_damage.now_hps}
                  idx={idx()}
                  store_data_set_param_ship={props.store_data_set_param_ship}
                />
              </Show>
            </>
          )}
        </For>
      </td>
    );
  };

  const e_defenser_damages = () => {
    const carrier_base_assault = props.battle_selected()?.carrier_base_assault;
    return (
      <td>
        <For each={carrier_base_assault?.e_damage.damages}>
          {(dmg, dmg_index) => (
            <>
              <Show when={show_damage()[0][dmg_index()]}>
                <Show when={dmg_index() > 0}>
                  <div class="h-px" />
                </Show>
                <DamageCommonComponent
                  dmg={dmg}
                  critical_flag={
                    carrier_base_assault?.e_damage.cl?.[dmg_index()]
                  }
                />
              </Show>
            </>
          )}
        </For>
      </td>
    );
  };

  const e_attacker_ships = () => {
    const carrier_base_assault = props.battle_selected()?.carrier_base_assault;
    return (
      <td>
        <div class="flex flex-col">
          <For each={carrier_base_assault?.e_damage.plane_from}>
            {(ship_idx, idx) => (
              <>
                <Show when={idx() > 0}>
                  <div class="h-px" />
                </Show>
                <div class="flex flex-nowrap">
                  <WrapNumberedEnemyShipComponent
                    battle_selected={props.battle_selected}
                    ship_idx={ship_idx}
                    store_data_set_param_ship={props.store_data_set_param_ship}
                  />
                </div>
              </>
            )}
          </For>
        </div>
      </td>
    );
  };

  const e_attacker_hps = () => {
    const carrier_base_assault = props.battle_selected()?.carrier_base_assault;
    return (
      <td>
        <div class="flex flex-col">
          <For each={carrier_base_assault?.e_damage.plane_from}>
            {(ship_idx, idx) => (
              <>
                <Show when={idx() > 0}>
                  <div class="h-px" />
                </Show>
                <div class="flex flex-nowrap">
                  <WrapEnemyShipHPComponent
                    e_now_hps={carrier_base_assault?.e_damage.now_hps}
                    idx={ship_idx}
                    store_data_set_param_ship={props.store_data_set_param_ship}
                  />
                </div>
              </>
            )}
          </For>
        </div>
      </td>
    );
  };

  const f_defenser_ships = () => {
    const carrier_base_assault = props.battle_selected()?.carrier_base_assault;
    return (
      <td>
        <For each={carrier_base_assault?.f_damage.damages}>
          {(_, idx) => (
            <>
              <Show when={show_damage()[1][idx()]}>
                <Show when={idx() > 0}>
                  <div class="h-px" />
                </Show>
                <div class="flex flex-nowrap">
                  <WrapNumberedOwnShipComponent
                    battle_selected={props.battle_selected}
                    deck_ship_id={props.deck_ship_id}
                    store_data_set_deck_ship={props.store_data_set_deck_ship}
                    ship_idx={idx()}
                  />
                  <Show
                    when={
                      carrier_base_assault?.f_damage.protect_flag?.some(
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

  const f_defenser_hps = () => {
    const carrier_base_assault = props.battle_selected()?.carrier_base_assault;
    return (
      <td>
        <For each={carrier_base_assault?.f_damage.damages}>
          {(_, idx) => (
            <>
              <Show when={show_damage()[1][idx()]}>
                <Show when={idx() > 0}>
                  <div class="h-px" />
                </Show>
                <WrapOwnShipHPComponent
                  f_now_hps={carrier_base_assault?.f_damage.now_hps}
                  battle_selected={props.battle_selected}
                  deck_ship_id={props.deck_ship_id}
                  store_data_set_deck_ship={props.store_data_set_deck_ship}
                  idx={idx()}
                />
              </Show>
            </>
          )}
        </For>
      </td>
    );
  };

  const f_defenser_damages = () => {
    const carrier_base_assault = props.battle_selected()?.carrier_base_assault;
    return (
      <td>
        <For each={carrier_base_assault?.f_damage.damages}>
          {(dmg, dmg_index) => (
            <>
              <Show when={show_damage()[1][dmg_index()]}>
                <Show when={dmg_index() > 0}>
                  <div class="h-px" />
                </Show>
                <DamageCommonComponent
                  dmg={dmg}
                  critical_flag={
                    carrier_base_assault?.f_damage.cl?.[dmg_index()]
                  }
                />
              </Show>
            </>
          )}
        </For>
      </td>
    );
  };

  return (
    <Show when={show_air_attack()}>
      <li>
        <details open={true}>
          <summary>Carrier Base Assault</summary>
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
                <Show when={show_f_plane_from()}>
                  <tr class="rounded">
                    {f_attacker_ships()}
                    {f_attacker_hps()}
                    {e_defenser_ships()}
                    {e_defenser_hps()}
                    {e_defenser_damages()}
                  </tr>
                </Show>
                <Show when={show_e_plane_from()}>
                  <tr class="rounded">
                    {e_attacker_ships()}
                    {e_attacker_hps()}
                    {f_defenser_ships()}
                    {f_defenser_hps()}
                    {f_defenser_damages()}
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
