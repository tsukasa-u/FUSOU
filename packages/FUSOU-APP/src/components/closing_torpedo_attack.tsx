import { createMemo, For, Show } from "solid-js";

import type { Battle } from "@ipc-bindings/battle";
import IconShield from "../icons/shield";
import { calc_critical, DeckShipIds } from "../utility/battles";
import { DataSetParamShip, DataSetShip } from "../utility/get_data_set";
import {
  WrapEnemyShipHPComponent,
  WrapNumberedEnemyShipComponent,
  WrapNumberedOwnShipComponent,
  WrapOwnShipHPComponent,
} from "./wrap_web_component";

interface TorpedoSubmarineProps {
  deck_ship_id: () => DeckShipIds;
  battle_selected: () => Battle | undefined;
  store_data_set_deck_ship: () => DataSetShip;
  store_data_set_param_ship: () => DataSetParamShip;
}

interface TorpedoDamage {
  list: number[];
  dict: {
    [key: number]: {
      dmg: number;
      ships: number[];
      cl: number;
    };
  };
}

interface TorpedoDamages {
  frai: TorpedoDamage;
  erai: TorpedoDamage;
}

export function ClosingTorpedoAttackComponent(props: TorpedoSubmarineProps) {
  const show_torpedo_attack = createMemo<boolean>(() => {
    if (!props.battle_selected()) return false;
    if (!props.battle_selected()?.deck_id) return false;
    const closing_raigeki = props.battle_selected()?.closing_raigeki;
    if (closing_raigeki) {
      if (
        !closing_raigeki.frai.some((val) => val) &&
        !closing_raigeki.erai.some((val) => val)
      )
        return false;
    } else return false;
    return true;
  });

  const closing_torpedo_damage = createMemo<TorpedoDamages>(() => {
    let closing_torpedo_damage: TorpedoDamages = {
      frai: {
        list: [],
        dict: {},
      },
      erai: {
        list: [],
        dict: {},
      },
    };
    const closing_raigeki = props.battle_selected()?.closing_raigeki;
    if (closing_raigeki) {
      closing_raigeki.frai.forEach((frai, i) => {
        if (frai != -1) {
          if (closing_torpedo_damage.frai.list.includes(frai)) {
            closing_torpedo_damage.frai.dict[frai].ships.push(i);
          } else {
            closing_torpedo_damage.frai.list.push(frai);
            closing_torpedo_damage.frai.dict[frai] = {
              dmg: closing_raigeki.edam[frai],
              ships: [i],
              cl: closing_raigeki.ecl[frai],
            };
          }
        }
      });
      closing_raigeki.erai.forEach((erai, i) => {
        if (erai != -1) {
          if (closing_torpedo_damage.erai.list.includes(erai)) {
            closing_torpedo_damage.erai.dict[erai].ships.push(i);
          } else {
            closing_torpedo_damage.erai.list.push(erai);
            closing_torpedo_damage.erai.dict[erai] = {
              dmg: closing_raigeki.fdam[erai],
              ships: [i],
              cl: closing_raigeki.fcl[erai],
            };
          }
        }
      });
    }
    return closing_torpedo_damage;
  });
  const f_attacker_ships = (frai: number) => {
    return (
      <td>
        <div class="flex flex-col">
          <For each={closing_torpedo_damage().frai.dict[frai].ships}>
            {(ship_idx, ship_id_index) => (
              <>
                <Show when={ship_id_index() > 0}>
                  <div class="h-px" />
                </Show>
                <div class="flex flex-nowrap">
                  <WrapNumberedOwnShipComponent
                    ship_idx={ship_idx}
                    deck_ship_id={props.deck_ship_id}
                    battle_selected={props.battle_selected}
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

  const e_attacker_ships = (erai: number) => {
    return (
      <td>
        <div class="flex flex-col">
          <For each={closing_torpedo_damage().erai.dict[erai].ships}>
            {(ship_idx, ship_idx_index) => (
              <>
                <Show when={ship_idx_index() > 0}>
                  <div class="h-px" />
                </Show>
                <div class="flex flex-nowrap">
                  <WrapNumberedEnemyShipComponent
                    ship_idx={ship_idx}
                    battle_selected={props.battle_selected}
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

  const f_attacker_hps = (frai: number) => {
    const closing_raigeki = props.battle_selected()?.closing_raigeki;
    // const ship_ids =
    //   props.deck_ship_id()[props.battle_selected()?.deck_id ?? 1];
    return (
      <td>
        <div class="flex flex-col">
          <For each={closing_torpedo_damage().frai.dict[frai].ships}>
            {(ship_idx) => {
              return (
                <>
                  <WrapOwnShipHPComponent
                    deck_ship_id={props.deck_ship_id}
                    battle_selected={props.battle_selected}
                    store_data_set_deck_ship={props.store_data_set_deck_ship}
                    idx={ship_idx}
                    f_now_hps={closing_raigeki?.f_now_hps}
                  />
                </>
              );
            }}
          </For>
        </div>
      </td>
    );
  };

  const e_attacker_hps = (erai: number) => {
    const closing_raigeki = props.battle_selected()?.closing_raigeki;
    return (
      <td>
        <div class="flex flex-col">
          <For each={closing_torpedo_damage().erai.dict[erai].ships}>
            {(ship_idx) => {
              return (
                <>
                  <WrapEnemyShipHPComponent
                    store_data_set_param_ship={props.store_data_set_param_ship}
                    idx={ship_idx}
                    e_now_hps={closing_raigeki?.e_now_hps}
                  />
                </>
              );
            }}
          </For>
        </div>
      </td>
    );
  };

  const f_defenser_ship = (erai: number) => {
    const closing_raigeki = props.battle_selected()?.closing_raigeki;
    return (
      <td>
        <div class="flex flex-nowrap">
          <WrapNumberedOwnShipComponent
            ship_idx={erai}
            deck_ship_id={props.deck_ship_id}
            battle_selected={props.battle_selected}
            store_data_set_deck_ship={props.store_data_set_deck_ship}
          />
          <Show
            when={
              closing_raigeki
                ? closing_raigeki.f_protect_flag.some((flag) => flag)
                : false
            }
          >
            <IconShield class="h-4 self-center ml-auto" />
          </Show>
        </div>
      </td>
    );
  };

  const e_defenser_ship = (frai: number) => {
    const closing_raigeki = props.battle_selected()?.closing_raigeki;
    return (
      <td>
        <div class="flex flex-nowrap">
          <WrapNumberedEnemyShipComponent
            ship_idx={frai}
            battle_selected={props.battle_selected}
            store_data_set_param_ship={props.store_data_set_param_ship}
          />
          <Show
            when={
              closing_raigeki
                ? closing_raigeki.e_protect_flag.some((flag) => flag)
                : false
            }
          >
            <IconShield class="h-4 self-center ml-auto" />
          </Show>
        </div>
      </td>
    );
  };

  const f_defenser_hp = (erai: number) => {
    const closing_raigeki = props.battle_selected()?.closing_raigeki;
    return (
      <td>
        <WrapOwnShipHPComponent
          deck_ship_id={props.deck_ship_id}
          battle_selected={props.battle_selected}
          store_data_set_deck_ship={props.store_data_set_deck_ship}
          idx={erai}
          f_now_hps={closing_raigeki?.f_now_hps}
        />
      </td>
    );
  };

  const e_defenser_hp = (frai: number) => {
    const closing_raigeki = props.battle_selected()?.closing_raigeki;
    return (
      <td>
        <WrapEnemyShipHPComponent
          store_data_set_param_ship={props.store_data_set_param_ship}
          idx={frai}
          e_now_hps={closing_raigeki?.e_now_hps}
        />
      </td>
    );
  };

  const f_damage = (erai: number) => {
    let cl_flag = closing_torpedo_damage().erai.dict[erai].cl;
    let dmg = closing_torpedo_damage().erai.dict[erai].dmg;
    return (
      <td>
        <div class={`text-sm h-6 ${calc_critical(dmg, cl_flag)}`}>{dmg}</div>
      </td>
    );
  };

  const e_damage = (frai: number) => {
    let cl_flag = closing_torpedo_damage().frai.dict[frai].cl;
    let dmg = closing_torpedo_damage().frai.dict[frai].dmg;
    return (
      <td>
        <div class={`text-sm h-6 ${calc_critical(dmg, cl_flag)}`}>{dmg}</div>
      </td>
    );
  };

  return (
    <Show when={show_torpedo_attack()}>
      <li>
        <details open={true}>
          <summary>Closing Torpedo Attack</summary>
          <ul class="pl-0">
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
                <For each={closing_torpedo_damage().frai.list}>
                  {(frai) => (
                    <tr class="rounded">
                      {f_attacker_ships(frai)}
                      {f_attacker_hps(frai)}
                      {e_defenser_ship(frai)}
                      {e_defenser_hp(frai)}
                      {e_damage(frai)}
                    </tr>
                  )}
                </For>
                <For each={closing_torpedo_damage().erai.list}>
                  {(erai) => (
                    <tr class="rounded">
                      {e_attacker_ships(erai)}
                      {e_attacker_hps(erai)}
                      {f_defenser_ship(erai)}
                      {f_defenser_hp(erai)}
                      {f_damage(erai)}
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
