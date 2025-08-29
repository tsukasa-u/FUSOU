import { createMemo, For, Match, Show, Switch } from "solid-js";

import "../css/divider.css";
import type { Battle } from "@ipc-bindings/battle";
import IconShield from "../icons/shield";
import type { DeckShipIds } from "../utility/battles";
import { calc_critical } from "../utility/battles";
import type { DataSetParamShip, DataSetShip } from "../utility/get_data_set";
import {
  WrapCIMstEquipComponent,
  WrapEnemyShipHPComponent,
  WrapNumberedEnemyShipComponent,
  WrapNumberedOwnShipComponent,
  WrapOwnShipComponent,
  WrapOwnShipHPComponent,
} from "./wrap_web_component";

interface AirDamageProps {
  deck_ship_id: () => DeckShipIds;
  battle_selected: () => Battle | undefined;
  store_data_set_deck_ship: () => DataSetShip;
  store_data_set_param_ship: () => DataSetParamShip;
}

export function OpeningAirAttackComponent(props: AirDamageProps) {
  const show_air_attack = createMemo<boolean>(() => {
    if (!props.battle_selected()) return false;
    if (!props.battle_selected()?.deck_id) return false;
    if (!props.battle_selected()?.opening_air_attack) return false;
    if (
      !props.battle_selected()?.opening_air_attack?.f_damage.plane_from &&
      !props.battle_selected()?.opening_air_attack?.e_damage.plane_from
    )
      return false;
    return true;
  });

  const show_damage = createMemo<boolean[][]>(() => {
    const show_damage: boolean[][] = [
      new Array(12).fill(false),
      new Array(12).fill(false),
    ];
    const airattack = props.battle_selected()?.opening_air_attack;
    if (!airattack) return show_damage;
    airattack?.e_damage?.bak_flag?.forEach((flag, idx) => {
      show_damage[0][idx] ||= flag == 1;
    });
    airattack?.e_damage?.rai_flag?.forEach((flag, idx) => {
      show_damage[0][idx] ||= flag == 1;
    });
    airattack?.f_damage?.bak_flag?.forEach((flag, idx) => {
      show_damage[1][idx] ||= flag == 1;
    });
    airattack?.f_damage?.rai_flag?.forEach((flag, idx) => {
      show_damage[1][idx] ||= flag == 1;
    });
    return show_damage;
  });

  const display_air_state = () => {
    const air_state =
      props.battle_selected()?.opening_air_attack?.air_superiority;
    return (
      <>
        Air State :{" "}
        <Switch fallback={<div />}>
          <Match when={air_state == 0}>
            <div class="text-lime-500 pl-1">Air Supremacy</div>
          </Match>
          <Match when={air_state == 1}>
            <div class="text-lime-500 pl-1">Air Superiority</div>
          </Match>
          <Match when={air_state == 4}>
            <div class="text-red-500 pl-1">Air Incapability</div>
          </Match>
        </Switch>
      </>
    );
  };

  const display_touch = () => {
    const f_touch_plane =
      props.battle_selected()?.opening_air_attack?.f_damage.touch_plane;
    const e_touch_plane =
      props.battle_selected()?.opening_air_attack?.e_damage.touch_plane;

    return (
      <>
        touch : <span class="w-1" />
        <div class="w-6 flex justify-center">
          <Show
            when={(f_touch_plane ?? 0) > 0}
            fallback={<div class="w-6 text-center">_</div>}
          >
            <WrapCIMstEquipComponent e_flag={false} si={f_touch_plane!} />
          </Show>
        </div>
        <div class="w-3 text-center">/</div>
        <div class="w-6 flex justify-center">
          <Show
            when={(e_touch_plane ?? 0) > 0}
            fallback={<div class="w-6 text-center">_</div>}
          >
            <WrapCIMstEquipComponent e_flag={true} si={e_touch_plane!} />
          </Show>
        </div>
      </>
    );
  };

  const display_cut_in = () => {
    const air_fire = props.battle_selected()?.opening_air_attack?.air_fire;
    const air_fire_idx = air_fire?.idx;
    return (
      <>
        CI : <span class="w-1" />
        <div class="flex justify-center">
          <Show when={air_fire && air_fire_idx} fallback={<div>_</div>}>
            <div class="w-24">
              <WrapOwnShipComponent
                battle_selected={props.battle_selected}
                deck_ship_id={props.deck_ship_id}
                name_flag={true}
                ship_idx={air_fire_idx!}
                store_data_set_deck_ship={props.store_data_set_deck_ship}
              />
            </div>
          </Show>
          <div class="w-1" />
          <Show when={air_fire} fallback={<div>_</div>}>
            <For each={air_fire?.use_item}>
              {(item_id, idx) => (
                <>
                  <Show when={idx() > 0}>
                    <div class="w-1" />
                  </Show>
                  <WrapCIMstEquipComponent e_flag={false} si={item_id} />
                </>
              )}
            </For>
          </Show>
        </div>
      </>
    );
  };

  const show_f_plane_from = () => {
    return (
      (props.battle_selected()?.opening_air_attack?.f_damage?.plane_from ?? [])
        .length > 0
    );
  };

  const show_e_plane_from = () => {
    return (
      (props.battle_selected()?.opening_air_attack?.e_damage?.plane_from ?? [])
        .length > 0
    );
  };

  const f_attacker_ships = () => {
    const airattack = props.battle_selected()?.opening_air_attack;
    return (
      <td>
        <div class="flex flex-col">
          <For each={airattack?.f_damage?.plane_from}>
            {(ship_idx, idx) => (
              <>
                <Show when={idx() > 0}>
                  <div class="h-px" />
                </Show>
                <div class="flex flex-nowrap">
                  <WrapNumberedOwnShipComponent
                    battle_selected={props.battle_selected}
                    deck_ship_id={props.deck_ship_id}
                    ship_idx={ship_idx}
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

  const f_attacker_hps = () => {
    const airattack = props.battle_selected()?.opening_air_attack;
    return (
      <td>
        <div class="flex flex-col">
          <For each={airattack?.f_damage?.plane_from}>
            {(ship_idx) => (
              <>
                <WrapOwnShipHPComponent
                  battle_selected={props.battle_selected}
                  deck_ship_id={props.deck_ship_id}
                  f_now_hps={airattack?.f_damage.now_hps}
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
    const airattack = props.battle_selected()?.opening_air_attack;
    return (
      <td>
        <For each={airattack?.e_damage.damages}>
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
                      airattack?.e_damage.protect_flag?.some((flag) => flag) ??
                      false
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
    const airattack = props.battle_selected()?.opening_air_attack;
    return (
      <td>
        <For each={airattack?.e_damage?.damages}>
          {(_, idx) => (
            <>
              <Show when={show_damage()[0][idx()]}>
                <Show when={idx() > 0}>
                  <div class="h-px" />
                </Show>
                <WrapEnemyShipHPComponent
                  e_now_hps={airattack?.e_damage?.now_hps}
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
    const airattack = props.battle_selected()?.opening_air_attack;
    return (
      <td>
        <For each={airattack?.e_damage.damages}>
          {(dmg, dmg_index) => (
            <>
              <Show when={show_damage()[0][dmg_index()]}>
                <Show when={dmg_index() > 0}>
                  <div class="h-px" />
                </Show>
                <div
                  class={`text-sm my-auto ${calc_critical(
                    dmg,
                    airattack?.e_damage.cl?.[dmg_index()],
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

  const e_attacker_ships = () => {
    const airattack = props.battle_selected()?.opening_air_attack;
    return (
      <td>
        <div class="flex flex-col">
          <For each={airattack?.e_damage?.plane_from}>
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
    const airattack = props.battle_selected()?.opening_air_attack;
    return (
      <td>
        <div class="flex flex-col">
          <For each={airattack?.e_damage.plane_from}>
            {(ship_idx) => (
              <>
                <WrapEnemyShipHPComponent
                  e_now_hps={airattack?.e_damage.now_hps}
                  idx={ship_idx}
                  store_data_set_param_ship={props.store_data_set_param_ship}
                />
              </>
            )}
          </For>
        </div>
      </td>
    );
  };

  const f_defenser_ships = () => {
    const airattack = props.battle_selected()?.opening_air_attack;
    return (
      <td>
        <For each={airattack?.f_damage?.damages}>
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
                    ship_idx={idx()}
                    store_data_set_deck_ship={props.store_data_set_deck_ship}
                  />
                  <Show
                    when={
                      airattack?.f_damage.protect_flag?.some((flag) => flag) ??
                      false
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
    const airattack = props.battle_selected()?.opening_air_attack;
    return (
      <td>
        <For each={airattack?.f_damage?.damages}>
          {(_, idx) => (
            <>
              <Show when={show_damage()[1][idx()]}>
                <Show when={idx() > 0}>
                  <div class="h-px" />
                </Show>
                <WrapOwnShipHPComponent
                  battle_selected={props.battle_selected}
                  deck_ship_id={props.deck_ship_id}
                  f_now_hps={airattack?.f_damage.now_hps}
                  idx={idx()}
                  store_data_set_deck_ship={props.store_data_set_deck_ship}
                />
              </Show>
            </>
          )}
        </For>
      </td>
    );
  };

  const f_defenser_damages = () => {
    const airattack = props.battle_selected()?.opening_air_attack;
    return (
      <td>
        <For each={airattack?.f_damage.damages}>
          {(dmg, dmg_index) => (
            <>
              <Show when={show_damage()[1][dmg_index()]}>
                <Show when={dmg_index() > 0}>
                  <div class="h-px" />
                </Show>
                <div
                  class={`text-sm my-auto ${calc_critical(
                    dmg,
                    airattack?.f_damage.cl?.[dmg_index()],
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
    <Show when={show_air_attack()}>
      <li>
        <details open={true}>
          <summary>Opening Air Attack</summary>
          <ul class="pl-0">
            <div class="pl-2 text-xs flex felx-nowarp">
              {display_air_state()}
              <div class="divider divider-horizontal mr-0 ml-0" />
              {display_touch()}
              <div class="divider divider-horizontal mr-0 ml-0" />
              {display_cut_in()}
            </div>
            <Show when={show_f_plane_from() || show_e_plane_from()}>
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
            </Show>
          </ul>
        </details>
      </li>
    </Show>
  );
}
