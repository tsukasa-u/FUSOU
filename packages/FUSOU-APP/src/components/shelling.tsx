import { createMemo, For, Show } from "solid-js";
import "../css/divider.css";
import type { Battle } from "@ipc-bindings/battle";
import IconShield from "../icons/shield";
import { useDeckPorts } from "../utility/provider";
import "shared-ui";
import type { DataSetParamShip, DataSetShip } from "../utility/get_data_set";
import { calc_critical, type DeckShipIds } from "../utility/battles";
import {
  WrapCIMstEquipComponent,
  WrapEnemyShipHPComponent,
  WrapOwnShipHPComponent,
  WrapNumberedEnemyShipComponent,
  WrapNumberedOwnShipComponent,
} from "./wrap_web_component";

interface ShellingProps {
  shelling_idx: number;
  deck_ship_id: () => DeckShipIds;
  battle_selected: () => Battle | undefined;
  store_data_set_deck_ship: () => DataSetShip;
  store_data_set_param_ship: () => DataSetParamShip;
}

export function ShellingComponent(props: ShellingProps) {
  const [deck_ports] = useDeckPorts();

  const show_shelling = createMemo<boolean>(() => {
    if (props.battle_selected()) {
      let hougeki = props.battle_selected()?.hougeki;
      if (props.battle_selected()?.deck_id) {
        if (hougeki) {
          if (hougeki[props.shelling_idx]) return true;
        }
      }
    }
    return false;
  });

  const hougeki = createMemo(() => {
    if (!show_shelling()) return undefined;
    let hougeki = props.battle_selected()?.hougeki;
    return hougeki ? (hougeki[props.shelling_idx] ?? undefined) : undefined;
  });

  const attacker_ship = (at: number, at_index: () => number) => {
    if (hougeki()?.at_eflag[at_index()] == 0) {
      return (
        <td>
          <div class="flex flex-nowarp">
            <WrapNumberedOwnShipComponent
              ship_idx={at}
              combined_flag={deck_ports.combined_flag == 1}
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
          <div class="flex flex-nowarp">
            <WrapNumberedEnemyShipComponent
              ship_idx={at}
              combined_flag={
                props.battle_selected()?.enemy_ship_id?.length == 12
              }
              store_data_set_param_ship={props.store_data_set_param_ship}
            />
          </div>
        </td>
      );
    }
  };

  const attacker_hp = (at: number, at_index: () => number) => {
    if (hougeki()?.at_eflag[at_index()] == 0) {
      return (
        <td>
          <WrapOwnShipHPComponent
            deck_ship_id={props.deck_ship_id}
            battle_selected={props.battle_selected}
            store_data_set_deck_ship={props.store_data_set_deck_ship}
            idx_index={() => at_index()}
            idx={at}
            f_now_hps={hougeki()?.f_now_hps}
          />
        </td>
      );
    } else {
      return (
        <td>
          <WrapEnemyShipHPComponent
            store_data_set_param_ship={props.store_data_set_param_ship}
            idx_index={() => at_index()}
            idx={at}
            e_now_hps={hougeki()?.e_now_hps}
          />
        </td>
      );
    }
  };

  const defenser_ships = (at_index: () => number) => {
    if (hougeki()?.at_eflag[at_index()] == 0) {
      return (
        <td>
          <div class="flex flex-col">
            <For each={hougeki()?.df_list[at_index()]}>
              {(df, df_index) => (
                <div class="flex flex-nowarp">
                  <WrapNumberedEnemyShipComponent
                    ship_idx={df}
                    combined_flag={
                      props.battle_selected()?.enemy_ship_id?.length == 12
                    }
                    store_data_set_param_ship={props.store_data_set_param_ship}
                  />
                  <Show when={hougeki()?.protect_flag[at_index()][df_index()]}>
                    <IconShield class="h-5 w-5" />
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
            <For each={hougeki()?.df_list[at_index()]}>
              {(df, df_index) => (
                <div class="flex flex-nowarp">
                  <WrapNumberedOwnShipComponent
                    ship_idx={df}
                    combined_flag={deck_ports.combined_flag == 1}
                    deck_ship_id={props.deck_ship_id}
                    battle_selected={props.battle_selected}
                    store_data_set_deck_ship={props.store_data_set_deck_ship}
                  />
                  <Show when={hougeki()?.protect_flag[at_index()][df_index()]}>
                    <IconShield class="h-5 w-5" />
                  </Show>
                </div>
              )}
            </For>
          </div>
        </td>
      );
    }
  };

  const defenser_hps = (at_index: () => number) => {
    return (
      <td>
        <div class="flex flex-col">
          <For each={hougeki()?.df_list[at_index()]}>
            {(df) => {
              if (hougeki()?.at_eflag[at_index()] == 0) {
                return (
                  <div class="flex flex-nowarp">
                    <WrapEnemyShipHPComponent
                      store_data_set_param_ship={
                        props.store_data_set_param_ship
                      }
                      idx_index={() => at_index()}
                      idx={df}
                      e_now_hps={hougeki()?.e_now_hps}
                    />
                  </div>
                );
              } else {
                return (
                  <div class="flex flex-nowarp">
                    <WrapOwnShipHPComponent
                      deck_ship_id={props.deck_ship_id}
                      battle_selected={props.battle_selected}
                      store_data_set_deck_ship={props.store_data_set_deck_ship}
                      idx_index={() => at_index()}
                      idx={df}
                      f_now_hps={hougeki()?.f_now_hps}
                    />
                  </div>
                );
              }
            }}
          </For>
        </div>
      </td>
    );
  };

  const damages = (at_index: () => number) => {
    return (
      <td>
        <div class="flex flex-col">
          <For each={hougeki()?.damage[at_index()]}>
            {(dmg, dmg_index) => (
              <div
                class={calc_critical(
                  dmg,
                  hougeki()?.cl_list[at_index()][dmg_index()]
                )}
              >
                {dmg}
              </div>
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
            hougeki()?.df_list[at_index()].length == 1
              ? "flex flex-nowrap"
              : "flex flex-col"
          }
        >
          <Show when={!hougeki()?.si_list[at_index()]}>
            <For each={hougeki()?.si_list[at_index()]}>
              {(si) => (
                <Show when={!si}>
                  <WrapCIMstEquipComponent
                    si={si!}
                    e_flag={hougeki()?.at_eflag[at_index()] == 0}
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
          <summary>Shelling</summary>
          <ul class="pl-0">
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
                <For each={hougeki()?.at_list}>
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
              </tbody>
            </table>
          </ul>
        </details>
      </li>
    </Show>
  );
}
