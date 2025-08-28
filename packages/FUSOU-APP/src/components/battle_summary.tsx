 

import { createMemo, For, Show } from "solid-js";

import "../css/divider.css";
import type { Battle } from "@ipc-bindings/battle";
import { useDeckPorts } from "../utility/provider";
import IconExit from "../icons/exit";
import type { DataSetParamShip, DataSetShip } from "../utility/get_data_set";
import type { DeckShipIds } from "../utility/battles";
import "shared-ui";

const friendly_force_number = 5;

interface ButtleSummaryProps {
  deck_ship_id: () => DeckShipIds;
  battle_selected: () => Battle | undefined;
  store_data_set_deck_ship: () => DataSetShip;
  store_data_set_param_ship: () => DataSetParamShip;
}

interface FleetInfo {
  f_main_ship_id: (number | null)[];
  f_main_nowhps: (number | null)[];
  f_main_maxhps: (number | null)[];
  f_main_damages: (number | null)[];
  f_main_escape: (boolean | null)[];
  f_escort_ship_id: (number | null)[];
  f_escort_nowhps: (number | null)[];
  f_escort_maxhps: (number | null)[];
  f_escort_damages: (number | null)[];
  f_escort_escape: (boolean | null)[];
  e_main_ship_id: (number | null)[];
  e_main_nowhps: number[];
  e_main_maxhps: number[];
  e_main_damages: number[];
  e_escort_ship_id: (number | null)[];
  e_escort_nowhps: number[];
  e_escort_maxhps: number[];
  e_escort_damages: number[];
  friend_ship_id: number[];
  friend_nowhps: number[];
  friend_maxhps: number[];
  friend_damages: number[];
}

function select_min(a: number[] | null, b: number[] | null): number[] {
  if (a == null) {
    if (b == null) return [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1];
    return b;
  }
  if (b == null) return a;

  const ret = [];
  for (let i = 0; i < a.length; i++) {
    ret.push(Math.min(a[i], b[i]));
  }
  if (!(ret.every((v, i) => v == a[i]) || ret.every((v, i) => v == b[i]))) {
    ret.map((_v, i) => {
      ret[i] = -1;
    });
  }
  return ret;
}

function add_array(a: number[], b: number[]): number[] {
  if (a == null) a = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  if (a.length == 0) a = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  if (b == null) b = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  if (b.length == 0) b = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const ret = [];
  for (let i = 0; i < a.length; i++) {
    ret.push(a[i] + b[i]);
  }
  return ret;
}

export function BattleSummaryComponent(props: ButtleSummaryProps) {
  const [deck_ports] = useDeckPorts();

  const show_summary = createMemo<boolean>(() => {
    if (props.battle_selected() == undefined) return false;
    return true;
  });

  const fleet_info = createMemo<FleetInfo>(() => {
    const battle = props.battle_selected();
    if (!battle)
      return {
        f_main_ship_id: [],
        f_main_nowhps: [],
        f_main_maxhps: [],
        f_main_damages: [],
        f_main_escape: [],
        f_escort_ship_id: [],
        f_escort_nowhps: [],
        f_escort_maxhps: [],
        f_escort_damages: [],
        f_escort_escape: [],
        e_main_ship_id: [],
        e_main_nowhps: [],
        e_main_maxhps: [],
        e_main_damages: [],
        e_escort_ship_id: [],
        e_escort_nowhps: [],
        e_escort_maxhps: [],
        e_escort_damages: [],
        friend_ship_id: [],
        friend_nowhps: [],
        friend_maxhps: [],
        friend_damages: [],
      };

    const null_list: null[] = Array(12).fill(null);

    const day_f_now_hps: number[] | null = battle.f_nowhps
      ? battle.f_nowhps
          .map((v, i) => v - battle.f_total_damages![i])
          .map((v) => Math.max(v, 0))
      : null;
    const day_e_now_hps: number[] | null =
      battle.e_nowhps !== null
        ? battle.e_nowhps
            .map((v, i) => v - battle.e_total_damages![i])
            .map((v) => Math.max(v, 0))
        : null;
    const midnight_f_now_hps: number[] | null =
      battle.midngiht_f_nowhps !== null
        ? battle.midngiht_f_nowhps
            .map((v, i) => v - battle.midnight_f_total_damages![i])
            .map((v) => Math.max(v, 0))
        : null;
    const midnight_e_now_hps: number[] | null =
      battle.midngiht_e_nowhps !== null
        ? battle.midngiht_e_nowhps
            .map((v, i) => v - battle.midnight_e_total_damages![i])
            .map((v) => Math.max(v, 0))
        : null;

    const f_damage: number[] = add_array(
      battle.f_total_damages ?? [],
      battle.midnight_f_total_damages ?? []
    );
    const e_damage: number[] = add_array(
      battle.e_total_damages ?? [],
      battle.midnight_e_total_damages ?? []
    );

    const f_now_hps: number[] = select_min(day_f_now_hps, midnight_f_now_hps);
    const e_now_hps: number[] = select_min(day_e_now_hps, midnight_e_now_hps);

    const f_escape: boolean[] = [...Array(12)].map((_, i) => {
      if (battle.escape_idx == null) return false;
      return battle.escape_idx.map((v) => v == i).filter((v) => v).length > 0;
    });

    let f_main_ship_id: (number | null)[] = battle.deck_id
      ? props.deck_ship_id()[battle.deck_id].filter((ship_id) => ship_id != -1)
      : [...null_list];
    let f_main_nowhps: (number | null)[] = f_main_ship_id
      ? f_now_hps.slice(0, f_main_ship_id.length)
      : [...null_list];
    let f_main_maxhps: (number | null)[] =
      battle.deck_id && f_main_ship_id
        ? props
            .deck_ship_id()
            [battle.deck_id].slice(0, f_main_ship_id.length)
            .map((ship_id) => {
              const ship = props.store_data_set_deck_ship()[ship_id]?.ship;
              return ship ? ship.maxhp : null;
            })
        : [...null_list];
    let f_main_damages: (number | null)[] = f_main_ship_id
      ? f_damage.slice(0, f_main_ship_id.length)
      : [...null_list];
    let f_main_escape: (boolean | null)[] = f_main_ship_id
      ? f_escape.slice(0, f_main_ship_id.length)
      : [...null_list];

    let f_escort_ship_id: (number | null)[] = [];
    let f_escort_nowhps: (number | null)[] = [];
    let f_escort_maxhps: (number | null)[] = [];
    let f_escort_damages: (number | null)[] = [];
    let f_escort_escape: (boolean | null)[] = [];

    const e_main_ship_id: (number | null)[] = battle.enemy_ship_id
      ? battle.enemy_ship_id.slice(0, 6)
      : [...null_list];
    const e_main_nowhps: number[] = e_now_hps.slice(0, 6);
    const e_main_maxhps: number[] = (battle.e_hp_max ?? []).slice(0, 6);
    const e_main_damages: number[] = e_damage.slice(0, 6);
    // let e_main_prams: number[][] = (battle.e_params ?? []).slice(0, 6);
    // let e_main_slot: number[][] = (battle.e_slot ?? []).slice(0, 6);
    // let e_main_yomi: (string | undefined)[] = get_enemy_yomi(e_main_ship_id);

    const e_escort_ship_id: (number | null)[] = battle.enemy_ship_id
      ? battle.enemy_ship_id.slice(6, 12)
      : [...null_list];
    const e_escort_nowhps: number[] = e_now_hps.slice(6, 12);
    const e_escort_maxhps: number[] = (battle.e_hp_max ?? []).slice(6, 12);
    const e_escort_damages: number[] = e_damage.slice(6, 12);
    // let e_escort_params: number[][] = (battle.e_params ?? []).slice(6, 12);
    // let e_escort_slot: number[][] = (battle.e_slot ?? []).slice(6, 12);
    // let e_escort_yomi: (string | undefined)[] =
    //   get_enemy_yomi(e_escort_ship_id);

    const friend_ship_id: number[] =
      battle.friendly_force_attack?.fleet_info.ship_id ?? [];
    const friend_nowhps: number[] =
      battle.friendly_force_attack?.fleet_info.now_hps ?? [];
    const friend_maxhps: number[] =
      battle.friendly_force_attack?.fleet_info.now_hps ?? [];
    const friend_damages: number[] = battle.friend_total_damages ?? [];
    // let friend_params: number[][] =
    //   battle.friendly_force_attack?.fleet_info.params ?? [];
    // let friend_slot: number[][] =
    //   battle.friendly_force_attack?.fleet_info.slot ?? [];

    if (deck_ports.combined_flag) {
      f_main_ship_id = props.deck_ship_id()[battle.deck_id ?? 1].slice(0, 6);
      f_main_nowhps = f_now_hps.slice(0, 6);
      f_main_maxhps = props
        .deck_ship_id()
        [battle.deck_id ?? 1].map((ship_id) => {
          const ship = props.store_data_set_deck_ship()[ship_id]?.ship;
          return ship ? ship.maxhp : null;
        })
        .slice(0, 6);
      f_main_damages = f_damage.slice(0, 6);
      f_main_escape = f_escape.slice(0, 6);

      f_escort_ship_id = props.deck_ship_id()[battle.deck_id ?? 1].slice(6, 12);
      f_escort_nowhps = f_now_hps.slice(6, 12);
      f_escort_maxhps = props
        .deck_ship_id()
        [battle.deck_id ?? 1].map((ship_id) => {
          const ship = props.store_data_set_deck_ship()[ship_id]?.ship;
          return ship ? ship.maxhp : null;
        })
        .slice(6, 12);
      f_escort_damages = f_damage.slice(6, 12);
      f_escort_escape = f_escape.slice(6, 12);
    }

    const ret: FleetInfo = {
      f_main_ship_id: f_main_ship_id,
      f_main_nowhps: f_main_nowhps,
      f_main_maxhps: f_main_maxhps,
      f_main_damages: f_main_damages,
      f_main_escape: f_main_escape,
      f_escort_ship_id: f_escort_ship_id,
      f_escort_nowhps: f_escort_nowhps,
      f_escort_maxhps: f_escort_maxhps,
      f_escort_damages: f_escort_damages,
      f_escort_escape: f_escort_escape,
      e_main_ship_id: e_main_ship_id,
      e_main_nowhps: e_main_nowhps,
      e_main_maxhps: e_main_maxhps,
      e_main_damages: e_main_damages,
      // e_main_prams: e_main_prams,
      // e_main_slot: e_main_slot,
      // e_main_yomi: e_main_yomi,
      e_escort_ship_id: e_escort_ship_id,
      e_escort_nowhps: e_escort_nowhps,
      e_escort_maxhps: e_escort_maxhps,
      e_escort_damages: e_escort_damages,
      // e_escort_params: e_escort_params,
      // e_escort_slot: e_escort_slot,
      // e_escort_yomi: e_escort_yomi,
      friend_ship_id: friend_ship_id,
      friend_nowhps: friend_nowhps,
      friend_maxhps: friend_maxhps,
      friend_damages: friend_damages,
      // friend_params: friend_params,
      // friend_slot: friend_slot,
    };

    return ret;
  });

  const f_main_table_line = (idx: number) => {
    const ship_id = fleet_info().f_main_ship_id[idx];
    const mst_ship = ship_id
      ? props.store_data_set_deck_ship()[ship_id].mst_ship
      : undefined;
    const ship = ship_id
      ? props.store_data_set_deck_ship()[ship_id].ship
      : undefined;
    const slot_items = ship_id
      ? props.store_data_set_deck_ship()[ship_id].slot_items
      : undefined;
    const mst_slot_items = ship_id
      ? props.store_data_set_deck_ship()[ship_id].mst_slot_items
      : undefined;
    const empty_line = (
      <>
        <td>{/* <div class="h-5" /> */}</td>
        <td />
        <td />
      </>
    );
    return (
      <Show
        when={(fleet_info().f_main_ship_id ?? []).length > idx}
        fallback={empty_line}
      >
        <td>
          <div class="flex flex-nowrap">
            <icon-fleet-number
              e_flag={0}
              fleet_number={1}
              ship_number={idx + 1}
              size="xs"
            />
            <component-ship-modal
              size="xs"
              color=""
              name_flag={true}
              empty_flag={false}
              mst_ship={mst_ship}
              mst_slot_items={mst_slot_items}
              ship={ship}
              slot_items={slot_items}
            />
            <Show when={fleet_info().f_main_escape[idx]}>
              <IconExit class="h-4 self-center ml-auto" />
            </Show>
          </div>
        </td>
        <td>
          <div class="flex-none">
            <component-color-bar-label
              size="xs"
              v_now={fleet_info().f_main_nowhps[idx] ?? 0}
              v_max={fleet_info().f_main_maxhps[idx] ?? 0}
            />
          </div>
        </td>
        <td class="my-auto text-sm">{fleet_info().f_main_damages[idx]}</td>
      </Show>
    );
  };

  const e_main_table_line = (idx: number) => {
    return (
      <Show
        when={fleet_info().e_main_ship_id.length > idx}
        fallback={
          <>
            <td>
              <div class="h-5" />
            </td>
            <td />
            <td />
          </>
        }
      >
        <td>
          <div class="flex flex-nowrap">
            <icon-fleet-number
              e_flag={1}
              fleet_number={1}
              ship_number={idx + 1}
              size="xs"
            />
            <component-ship-masked-modal
              size="xs"
              empty_flag={false}
              name_flag={true}
              color={props.store_data_set_param_ship().e_main_color[idx]}
              ship_param={
                props.store_data_set_param_ship().e_main_ship_param[idx]
              }
              ship_slot={
                props.store_data_set_param_ship().e_main_ship_slot[idx]
              }
              ship_max_hp={
                props.store_data_set_param_ship().e_main_ship_max_hp[idx]
              }
              mst_ship={props.store_data_set_param_ship().e_main_mst_ship[idx]}
              mst_slot_items={
                props.store_data_set_param_ship().e_main_mst_slot_items[idx]
              }
            />
          </div>
        </td>
        <td>
          <div class="flex-none">
            <component-color-bar-label
              size="xs"
              v_now={fleet_info().e_main_nowhps[idx] ?? 0}
              v_max={fleet_info().e_main_maxhps[idx] ?? 0}
            />
          </div>
        </td>
        <td class="my-auto text-sm">{fleet_info().e_main_damages[idx]}</td>
      </Show>
    );
  };

  const f_escort_table_line = (idx: number) => {
    const ship_id = fleet_info().f_escort_ship_id[idx];
    const mst_ship = ship_id
      ? props.store_data_set_deck_ship()[ship_id].mst_ship
      : undefined;
    const ship = ship_id
      ? props.store_data_set_deck_ship()[ship_id].ship
      : undefined;
    const slot_items = ship_id
      ? props.store_data_set_deck_ship()[ship_id].slot_items
      : undefined;
    const mst_slot_items = ship_id
      ? props.store_data_set_deck_ship()[ship_id].mst_slot_items
      : undefined;
    const empty_line = (
      <>
        <td>{/* <div class="h-5" /> */}</td>
        <td />
        <td />
      </>
    );
    return (
      <Show
        when={fleet_info().f_escort_ship_id.length > idx}
        fallback={empty_line}
      >
        <td class={fleet_info().f_escort_escape[idx] ? "text-blue-200" : ""}>
          <div class="flex flex-nowrap">
            <icon-fleet-number
              e_flag={0}
              fleet_number={2}
              ship_number={idx + 1}
              combined_flag={true}
              size="xs"
            />
            <component-ship-modal
              size="xs"
              color=""
              empty_flag={false}
              ship={ship}
              mst_ship={mst_ship}
              slot_items={slot_items}
              mst_slot_items={mst_slot_items}
              name_flag={true}
            />
          </div>
        </td>
        <td class={fleet_info().f_escort_escape[idx] ? "text-blue-200" : ""}>
          <div class="flex-none">
            <component-color-bar-label
              size="xs"
              v_max={fleet_info().f_escort_maxhps[idx] ?? 0}
              v_now={fleet_info().f_escort_nowhps[idx] ?? 0}
            />
          </div>
        </td>
        <td
          class={`my-auto text-sm ${fleet_info().f_escort_escape[idx] ? "text-blue-200" : ""}`}
        >
          {fleet_info().f_escort_damages[idx]}
        </td>
      </Show>
    );
  };

  const e_escort_table_line = (idx: number) => {
    const empty_line = (
      <>
        <td />
        <td />
        <td />
      </>
    );
    return (
      <Show
        when={fleet_info().e_escort_ship_id.length > idx}
        fallback={empty_line}
      >
        <td>
          <div class="flex flex-nowrap">
            <icon-fleet-number
              e_flag={1}
              fleet_number={2}
              ship_number={idx + 1}
              combined_flag={true}
              class="xs"
            />
            <component-ship-masked-modal
              size="xs"
              empty_flag={false}
              name_flag={true}
              color={props.store_data_set_param_ship().e_escort_color[idx]}
              ship_param={
                props.store_data_set_param_ship().e_escort_ship_param[idx]
              }
              ship_slot={
                props.store_data_set_param_ship().e_escort_ship_slot[idx]
              }
              ship_max_hp={
                props.store_data_set_param_ship().e_escort_ship_max_hp[idx]
              }
              mst_ship={
                props.store_data_set_param_ship().e_escort_mst_ship[idx]
              }
              mst_slot_items={
                props.store_data_set_param_ship().e_escort_mst_slot_items[idx]
              }
            />
          </div>
        </td>
        <td>
          <div class="flex-none">
            <component-color-bar-label
              size="xs"
              v_max={fleet_info().e_escort_maxhps[idx] ?? 0}
              v_now={fleet_info().e_escort_nowhps[idx] ?? 0}
            />
          </div>
        </td>
        <td class="my-auto text-sm">{fleet_info().e_escort_damages[idx]}</td>
      </Show>
    );
  };

  const f_friendly_table_line = (idx: number) => {
    return (
      <Show
        when={fleet_info().friend_ship_id.length > idx}
        fallback={
          <>
            <td />
            <td />
            <td />
          </>
        }
      >
        <td>
          <icon-fleet-number
            e_flag={0}
            fleet_number={friendly_force_number}
            ship_number={idx + 1}
            combined_flag={false}
            size="xs"
          />
          <component-ship-masked-modal
            size="xs"
            empty_flag={false}
            name_flag={true}
            color={props.store_data_set_param_ship().f_friend_color[idx]}
            ship_param={
              props.store_data_set_param_ship().f_friend_ship_param[idx]
            }
            ship_slot={
              props.store_data_set_param_ship().f_friend_ship_slot[idx]
            }
            ship_max_hp={
              props.store_data_set_param_ship().f_friend_ship_max_hp[idx]
            }
            mst_ship={props.store_data_set_param_ship().f_friend_mst_ship[idx]}
            mst_slot_items={
              props.store_data_set_param_ship().f_friend_mst_slot_items[idx]
            }
          />
        </td>
        <td>
          <div class="flex-none">
            <component-color-bar-label
              size="xs"
              v_max={fleet_info().friend_nowhps[idx] ?? 0}
              v_now={fleet_info().friend_maxhps[idx] ?? 0}
            />
          </div>
        </td>
        <td class="my-auto text-sm">{fleet_info().friend_damages[idx]}</td>
      </Show>
    );
  };

  return (
    <Show when={show_summary()}>
      <li>
        <details open={true}>
          <summary>Summary</summary>
          <ul class="pl-0">
            <table class="table table-xs">
              <thead>
                <tr>
                  <th>Own Main</th>
                  <th>HP</th>
                  <th>damage</th>
                  <th>Enemy Main</th>
                  <th>HP</th>
                  <th>damage</th>
                </tr>
              </thead>
              <tbody>
                <For
                  each={[0, 1, 2, 3, 4, 5, 6].slice(
                    0,
                    Math.max(
                      fleet_info().f_main_ship_id.length,
                      fleet_info().e_main_ship_id.length
                    )
                  )}
                >
                  {(idx) => (
                    <tr class="rounded">
                      {f_main_table_line(idx)}
                      {e_main_table_line(idx)}
                    </tr>
                  )}
                </For>
                <For
                  each={[0, 1, 2, 3, 4, 5].slice(
                    0,
                    Math.max(
                      fleet_info().f_escort_ship_id.length,
                      fleet_info().e_escort_ship_id.length
                    )
                  )}
                >
                  {(idx) => (
                    <tr class="rounded">
                      {f_escort_table_line(idx)}
                      {e_escort_table_line(idx)}
                    </tr>
                  )}
                </For>
                <Show when={props.battle_selected()?.friendly_force_attack}>
                  <For each={[0, 1, 2, 3, 4, 5]}>
                    {(idx) => (
                      <tr class="rounded">
                        {f_friendly_table_line(idx)}
                        <td />
                        <td />
                        <td />
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
