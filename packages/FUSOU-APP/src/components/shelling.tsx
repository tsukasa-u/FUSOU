import { createMemo, For, Show } from "solid-js";
import "../css/divider.css";
import type { Battle } from "@ipc-bindings/battle";
import IconShield from "../icons/shield";
import { useDeckPorts } from "../utility/provider";
import "shared-ui";
import type { DataSetParamShip, DataSetShip } from "../utility/get_data_set";
import {
  calc_critical,
  get_mst_slot_item,
  type DeckShipIds,
} from "../utility/battles";

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
    return (
      <td>
        <div class="flex flex-nowarp">
          <Show
            when={hougeki()?.at_eflag[at_index()] == 0}
            fallback={
              <>
                <icon-fleet-number
                  size="xs"
                  e_flag={1}
                  fleet_number={1}
                  ship_number={at + 1}
                  combined_flag={
                    props.battle_selected()?.enemy_ship_id?.length == 12
                  }
                />
                <component-ship-masked-modal
                  size="xs"
                  ship_max_hp={
                    props.store_data_set_param_ship().e_ship_max_hp[at]
                  }
                  ship_param={
                    props.store_data_set_param_ship().e_ship_param[at]
                  }
                  ship_slot={props.store_data_set_param_ship().e_ship_slot[at]}
                  mst_ship={props.store_data_set_param_ship().e_mst_ship[at]}
                  mst_slot_items={
                    props.store_data_set_param_ship().e_mst_slot_items[at]
                  }
                  color={props.store_data_set_param_ship().e_color[at]}
                  empty_flag={false}
                  name_flag={true}
                />
              </>
            }
          >
            <>
              <icon-fleet-number
                size="xs"
                e_flag={0}
                fleet_number={1}
                ship_number={at + 1}
                combined_flag={deck_ports.combined_flag == 1}
              />
              <component-ship-modal
                size="xs"
                color=""
                empty_flag={false}
                name_flag={true}
                ship={props.store_data_set_deck_ship()[at]?.ship}
                mst_ship={props.store_data_set_deck_ship()[at]?.mst_ship}
                slot_items={props.store_data_set_deck_ship()[at]?.slot_items}
                mst_slot_items={
                  props.store_data_set_deck_ship()[at]?.mst_slot_items
                }
              />
            </>
          </Show>
        </div>
      </td>
    );
  };

  const attacker_hp = (at: number, at_index: () => number) => {
    if (hougeki()?.at_eflag[at_index()] == 0) {
      let v_now = hougeki()?.f_now_hps[at_index()][at];
      let v_max = props.store_data_set_deck_ship()[at]?.ship?.maxhp;
      return (
        <td>
          <component-color-bar-label
            size="xs"
            v_max={v_max ?? 0}
            v_now={v_now ?? 0}
          />
        </td>
      );
    } else {
      let v_now = hougeki()?.e_now_hps[at_index()][at];
      let v_max = props.battle_selected()?.e_hp_max
        ? props.battle_selected()?.e_hp_max![at]
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
    }
  };

  const defenser_ships = (at_index: () => number) => {
    return (
      <td>
        <div class="flex flex-col">
          <For each={hougeki()?.df_list[at_index()]}>
            {(df, df_index) => (
              <div class="flex flex-nowarp">
                <Show
                  when={hougeki()?.at_eflag[at_index()] == 1}
                  fallback={
                    <>
                      <icon-fleet-number
                        size="xs"
                        e_flag={1}
                        fleet_number={1}
                        ship_number={df + 1}
                        combined_flag={
                          props.battle_selected()?.enemy_ship_id?.length == 12
                        }
                      />
                      <component-ship-masked-modal
                        size="xs"
                        ship_max_hp={
                          props.store_data_set_param_ship().e_ship_max_hp[df]
                        }
                        ship_param={
                          props.store_data_set_param_ship().e_ship_param[df]
                        }
                        ship_slot={
                          props.store_data_set_param_ship().e_ship_slot[df]
                        }
                        mst_ship={
                          props.store_data_set_param_ship().e_mst_ship[df]
                        }
                        mst_slot_items={
                          props.store_data_set_param_ship().e_mst_slot_items[df]
                        }
                        color={props.store_data_set_param_ship().e_color[df]}
                        empty_flag={false}
                        name_flag={true}
                      />
                    </>
                  }
                >
                  <>
                    <icon-fleet-number
                      size="xs"
                      e_flag={0}
                      fleet_number={1}
                      ship_number={df + 1}
                      combined_flag={deck_ports.combined_flag == 1}
                    />
                    <component-ship-modal
                      size="xs"
                      empty_flag={false}
                      name_flag={true}
                      ship={props.store_data_set_deck_ship()[df]?.ship}
                      mst_ship={props.store_data_set_deck_ship()[df]?.mst_ship}
                      slot_items={
                        props.store_data_set_deck_ship()[df]?.slot_items
                      }
                      mst_slot_items={
                        props.store_data_set_deck_ship()[df]?.mst_slot_items
                      }
                      color=""
                    />
                  </>
                </Show>
                <Show when={hougeki()?.protect_flag[at_index()][df_index()]}>
                  <IconShield class="h-5 w-5" />
                </Show>
              </div>
            )}
          </For>
        </div>
      </td>
    );
  };

  const defenser_hps = (at_index: () => number) => {
    return (
      <td>
        <div class="flex flex-col">
          <For each={hougeki()?.df_list[at_index()]}>
            {(df) => {
              if (hougeki()?.at_eflag[at_index()] == 0) {
                let v_now = hougeki()?.f_now_hps[at_index()][df];
                let v_max = props.store_data_set_deck_ship()[df]?.ship?.maxhp;
                return (
                  <div class="flex flex-nowarp">
                    <component-color-bar-label
                      size="xs"
                      v_max={v_max ?? 0}
                      v_now={v_now ?? 0}
                    />
                  </div>
                );
              } else {
                let v_now = hougeki()?.e_now_hps[at_index()][df];
                let v_max = props.battle_selected()?.e_hp_max
                  ? props.battle_selected()?.e_hp_max![df]
                  : undefined;
                return (
                  <div class="flex flex-nowarp">
                    <component-color-bar-label
                      size="xs"
                      v_max={v_max ?? 0}
                      v_now={v_now ?? 0}
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
                  <component-equipment-mst-modal
                    size="xs"
                    compact={true}
                    empty_flag={false}
                    name_flag={false}
                    show_name={true}
                    show_param={hougeki()?.at_eflag[at_index()] == 0}
                    mst_slot_item={get_mst_slot_item(si!)}
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
                  <th>Damgage</th>
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
