import { createMemo, For, Show } from "solid-js";

import type { Battle } from "@ipc-bindings/battle";
import IconShield from "../icons/shield";
import { useDeckPorts } from "../utility/provider";
import { calc_critical, DeckShipIds } from "../utility/battles";
import { DataSetParamShip, DataSetShip } from "../utility/get_data_set";

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

export function OpeningTorpedoAttackComponent(props: TorpedoSubmarineProps) {
  const [deck_ports] = useDeckPorts();

  const show_torpedo_attack = createMemo<boolean>(() => {
    if (!props.battle_selected()) return false;
    if (!props.battle_selected()?.deck_id) return false;
    const opening_raigeki = props.battle_selected()?.opening_raigeki;
    if (opening_raigeki) {
      if (
        !opening_raigeki.frai_list_items.some((val) => val) &&
        !opening_raigeki.erai_list_items.some((val) => val)
      )
        return false;
    } else return false;
    return true;
  });

  const opening_torpedo_damage = createMemo<TorpedoDamages>(() => {
    let opening_torpedo_damage: TorpedoDamages = {
      frai: {
        list: [],
        dict: {},
      },
      erai: {
        list: [],
        dict: {},
      },
    };
    const opening_raigeki = props.battle_selected()?.opening_raigeki;
    if (opening_raigeki) {
      opening_raigeki.frai_list_items.forEach((frai_list, i) => {
        if (frai_list != null) {
          frai_list.forEach((frai) => {
            if (opening_torpedo_damage.frai.list.includes(frai)) {
              opening_torpedo_damage.frai.dict[frai].ships.push(i);
            } else {
              opening_torpedo_damage.frai.list.push(frai);
              opening_torpedo_damage.frai.dict[frai] = {
                dmg: opening_raigeki.edam[frai],
                ships: [i],
                cl: opening_raigeki.ecl_list[frai],
              };
            }
          });
        }
      });
      opening_raigeki.erai_list_items.forEach((erai_list, i) => {
        if (erai_list != null) {
          erai_list.forEach((erai) => {
            if (opening_torpedo_damage.erai.list.includes(erai)) {
              opening_torpedo_damage.erai.dict[erai].ships.push(i);
            } else {
              opening_torpedo_damage.erai.list.push(erai);
              opening_torpedo_damage.erai.dict[erai] = {
                dmg: opening_raigeki.fdam[erai],
                ships: [i],
                cl: opening_raigeki.fcl_list[erai],
              };
            }
          });
        }
      });
    }
    return opening_torpedo_damage;
  });

  const f_attacker_ships = (frai: number) => {
    let ship_ids = props.deck_ship_id()[props.battle_selected()?.deck_id ?? 1];
    return (
      <td>
        <div class="flex flex-col">
          <For each={opening_torpedo_damage().frai.dict[frai].ships}>
            {(ship_idx, ship_id_index) => (
              <>
                <Show when={ship_id_index() > 0}>
                  <div class="h-px" />
                </Show>
                <div class="flex flex-nowrap">
                  <icon-fleet-number
                    size="xs"
                    e_flag={0}
                    fleet_number={props.battle_selected()?.deck_id ?? 1}
                    ship_number={ship_idx + 1}
                    combined_flag={deck_ports.combined_flag == 1}
                  />
                  <component-ship-modal
                    size="xs"
                    color=""
                    empty_flag={false}
                    name_flag={true}
                    ship={
                      props.store_data_set_deck_ship()[ship_ids[ship_idx]]?.ship
                    }
                    mst_ship={
                      props.store_data_set_deck_ship()[ship_ids[ship_idx]]
                        ?.mst_ship
                    }
                    slot_items={
                      props.store_data_set_deck_ship()[ship_ids[ship_idx]]
                        ?.slot_items
                    }
                    mst_slot_items={
                      props.store_data_set_deck_ship()[ship_ids[ship_idx]]
                        ?.mst_slot_items
                    }
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
          <For each={opening_torpedo_damage().erai.dict[erai].ships}>
            {(ship_idx, ship_idx_index) => (
              <>
                <Show when={ship_idx_index() > 0}>
                  <div class="h-px" />
                </Show>
                <div class="flex flex-nowrap">
                  <icon-fleet-number
                    size="xs"
                    e_flag={1}
                    fleet_number={1}
                    ship_number={ship_idx + 1}
                    combined_flag={
                      props.battle_selected()?.enemy_ship_id?.length == 12
                    }
                  />
                  <component-ship-masked-modal
                    size="xs"
                    ship_max_hp={
                      props.store_data_set_param_ship().e_ship_max_hp[ship_idx]
                    }
                    ship_param={
                      props.store_data_set_param_ship().e_ship_param[ship_idx]
                    }
                    ship_slot={
                      props.store_data_set_param_ship().e_ship_slot[ship_idx]
                    }
                    mst_ship={
                      props.store_data_set_param_ship().e_mst_ship[ship_idx]
                    }
                    mst_slot_items={
                      props.store_data_set_param_ship().e_mst_slot_items[
                        ship_idx
                      ]
                    }
                    color={props.store_data_set_param_ship().e_color[ship_idx]}
                    empty_flag={false}
                    name_flag={true}
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
    const opening_raigeki = props.battle_selected()?.opening_raigeki;
    const ship_ids =
      props.deck_ship_id()[props.battle_selected()?.deck_id ?? 1];
    return (
      <td>
        <div class="flex flex-col">
          <For each={opening_torpedo_damage().frai.dict[frai].ships}>
            {(ship_idx) => {
              let ship_id = ship_ids[ship_idx];
              let v_now = opening_raigeki
                ? opening_raigeki.f_now_hps[ship_idx]
                : undefined;
              let v_max =
                props.store_data_set_deck_ship()[ship_id]?.ship?.maxhp;
              return (
                <>
                  <component-color-bar-label
                    size="xs"
                    v_max={v_max ?? 0}
                    v_now={v_now ?? 0}
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
    const opening_raigeki = props.battle_selected()?.opening_raigeki;
    return (
      <td>
        <div class="flex flex-col">
          <For each={opening_torpedo_damage().erai.dict[erai].ships}>
            {(ship_idx) => {
              let v_now = opening_raigeki?.e_now_hps[ship_idx];
              let v_max = props.battle_selected()?.e_hp_max
                ? props.battle_selected()?.e_hp_max![ship_idx]
                : undefined;
              return (
                <>
                  <component-color-bar-label
                    size="xs"
                    v_max={v_max ?? 0}
                    v_now={v_now ?? 0}
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
    const ship_ids =
      props.deck_ship_id()[props.battle_selected()?.deck_id ?? 1];
    const opening_raigeki = props.battle_selected()?.opening_raigeki;
    return (
      <td>
        <div class="flex flex-nowrap">
          <icon-fleet-number
            size="xs"
            e_flag={0}
            fleet_number={props.battle_selected()?.deck_id ?? 1}
            ship_number={erai + 1}
            combined_flag={deck_ports.combined_flag == 1}
          />
          <component-ship-modal
            size="xs"
            empty_flag={false}
            name_flag={true}
            ship={props.store_data_set_deck_ship()[ship_ids[erai]]?.ship}
            mst_ship={
              props.store_data_set_deck_ship()[ship_ids[erai]]?.mst_ship
            }
            slot_items={
              props.store_data_set_deck_ship()[ship_ids[erai]]?.slot_items
            }
            mst_slot_items={
              props.store_data_set_deck_ship()[ship_ids[erai]]?.mst_slot_items
            }
            color=""
          />
          <Show
            when={
              opening_raigeki
                ? opening_raigeki.f_protect_flag.some((flag) => flag)
                : false
            }
          >
            <IconShield class="h-5 w-5" />
          </Show>
        </div>
      </td>
    );
  };

  const e_defenser_ship = (frai: number) => {
    const opening_raigeki = props.battle_selected()?.opening_raigeki;
    return (
      <td>
        <div class="flex flex-nowrap">
          <icon-fleet-number
            size="xs"
            e_flag={1}
            fleet_number={1}
            ship_number={frai + 1}
            combined_flag={props.battle_selected()?.enemy_ship_id?.length == 12}
          />
          <component-ship-masked-modal
            size="xs"
            ship_max_hp={props.store_data_set_param_ship().e_ship_max_hp[frai]}
            ship_param={props.store_data_set_param_ship().e_ship_param[frai]}
            ship_slot={props.store_data_set_param_ship().e_ship_slot[frai]}
            mst_ship={props.store_data_set_param_ship().e_mst_ship[frai]}
            mst_slot_items={
              props.store_data_set_param_ship().e_mst_slot_items[frai]
            }
            color={props.store_data_set_param_ship().e_color[frai]}
            empty_flag={false}
            name_flag={true}
          />
          <Show
            when={
              opening_raigeki
                ? opening_raigeki.e_protect_flag.some((flag) => flag)
                : false
            }
          >
            <IconShield class="h-5 w-5" />
          </Show>
        </div>
      </td>
    );
  };

  const f_defenser_hp = (erai: number) => {
    const ship_id =
      props.deck_ship_id()[props.battle_selected()?.deck_id ?? 1][erai];
    const opening_raigeki = props.battle_selected()?.opening_raigeki;
    let v_now = opening_raigeki?.f_now_hps[erai];
    let v_max = props.store_data_set_deck_ship()[ship_id]?.ship?.maxhp;
    return (
      <td>
        <component-color-bar-label
          size="xs"
          v_max={v_max ?? 0}
          v_now={v_now ?? 0}
        />
      </td>
    );
  };

  const e_defenser_hp = (frai: number) => {
    const opening_raigeki = props.battle_selected()?.opening_raigeki;
    let v_now = opening_raigeki?.e_now_hps[frai];
    let v_max = props.battle_selected()?.e_hp_max
      ? props.battle_selected()?.e_hp_max![frai]
      : undefined;
    return (
      <td>
        <component-color-bar-label
          size="xs"
          v_max={v_max ?? 0}
          v_now={v_now ?? 0}
        />
      </td>
    );
  };

  const f_damage = (erai: number) => {
    let cl_flag = opening_torpedo_damage().erai.dict[erai].cl;
    let dmg = opening_torpedo_damage().erai.dict[erai].dmg;
    return (
      <td>
        <div class={calc_critical(dmg, cl_flag)}>{dmg}</div>
      </td>
    );
  };

  const e_damage = (frai: number) => {
    let cl_flag = opening_torpedo_damage().frai.dict[frai].cl;
    let dmg = opening_torpedo_damage().frai.dict[frai].dmg;
    return (
      <td>
        <div class={calc_critical(dmg, cl_flag)}>{dmg}</div>
      </td>
    );
  };

  return (
    <Show when={show_torpedo_attack()}>
      <li>
        <details open={true}>
          <summary>Opening Torpedo Attack</summary>
          <ul class="pl-0">
            <table class="table table-xs">
              <thead>
                <tr>
                  <th>Attack</th>
                  <th>HP</th>
                  <th>Defense</th>
                  <th>HP</th>
                  <th>Damgage</th>
                </tr>
              </thead>
              <tbody>
                <For each={opening_torpedo_damage().frai.list}>
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
                <For each={opening_torpedo_damage().erai.list}>
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
