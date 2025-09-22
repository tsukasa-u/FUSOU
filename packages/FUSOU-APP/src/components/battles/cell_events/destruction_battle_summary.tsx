import { createMemo, For, Show } from "solid-js";

import { useAirBasesBattles } from "../../../utility/provider";
import type { Cell } from "@ipc-bindings/cells";
import type { DataSetParamShip } from "../../../utility/get_data_set";
import "shared-ui";

interface ButtleSummaryProps {
  area_id: number;
  cell: () => Cell | undefined;
  store_data_set_param_ship: () => DataSetParamShip;
}

interface FleetInfo {
  f_base_id: number[];
  f_base_nowhps: (number | null)[];
  f_base_maxhps: number[];
  f_base_damages: number[] | null;
  e_main_ship_id: number[];
  e_main_nowhps: (number | null)[];
  e_main_maxhps: number[];
  e_main_damages: number[] | null;
}

export function DestructionBattleSummaryComponent(props: ButtleSummaryProps) {
  const [air_bases] = useAirBasesBattles();

  const show_summary = createMemo<boolean>(() => {
    if (!props.cell()) return false;

    if (!props.cell()?.destruction_battle) return false;
    if (!props.cell()?.destruction_battle?.air_base_attack.map_squadron_plane)
      return false;
    return true;
  });

  const fleet_info = createMemo<FleetInfo>(() => {
    const ret = {
      f_base_id: [],
      f_base_nowhps: [],
      f_base_maxhps: [],
      f_base_damages: [],
      e_main_ship_id: [],
      e_main_nowhps: [],
      e_main_maxhps: [],
      e_main_damages: [],
    };
    if (show_summary() == false) return ret;
    const destruction_battle = props.cell()?.destruction_battle;
    if (!destruction_battle) return ret;

    const f_base_id: number[] = [];
    Object.entries(air_bases.bases).forEach(([base_id, base]) => {
      if (base?.area_id == props.area_id) {
        f_base_id.push(Number(base_id));
      }
    });
    const f_base_nowhps: (number | null)[] = destruction_battle.f_nowhps.map(
      (hp, i) => {
        const dmg = destruction_battle.f_total_damages?.[i];
        return dmg ? hp - dmg : null;
      }
    );
    const f_base_maxhps: number[] = destruction_battle.f_maxhps;
    const f_base_damages: number[] | null = destruction_battle.f_total_damages;

    const e_main_ship_id: number[] = destruction_battle.ship_ke;
    const e_main_nowhps: (number | null)[] = destruction_battle.e_nowhps.map(
      (hp, i) => {
        const dmg = destruction_battle.e_total_damages?.[i];
        return dmg ? hp - dmg : null;
      }
    );
    const e_main_maxhps: number[] = destruction_battle.e_maxhps;
    const e_main_damages: number[] | null = destruction_battle.e_total_damages;

    return {
      f_base_id: f_base_id,
      f_base_nowhps: f_base_nowhps,
      f_base_maxhps: f_base_maxhps,
      f_base_damages: f_base_damages,
      e_main_ship_id: e_main_ship_id,
      e_main_nowhps: e_main_nowhps,
      e_main_maxhps: e_main_maxhps,
      e_main_damages: e_main_damages,
    };
  });

  const base_table_line = (idx: number) => {
    const base_name =
      air_bases.bases[fleet_info().f_base_id[idx]]?.name ?? "Unknown";
    return (
      <Show
        when={fleet_info().f_base_id.length > idx}
        fallback={
          <>
            <td>
              <div class="h-6" />
            </td>
            <td />
            <td />
          </>
        }
      >
        <td>
          <div class="flex flex-nowrap">{base_name}</div>
        </td>
        <td>
          <div class="flex-none">
            <component-color-bar-label
              size="xs"
              v_now={fleet_info().f_base_nowhps[idx] ?? 0}
              v_max={fleet_info().f_base_maxhps[idx] ?? 0}
            />
          </div>
        </td>
        <td>{fleet_info().f_base_damages?.[idx]}</td>
      </Show>
    );
  };

  const enemy_table_line = (idx: number) => {
    return (
      <Show
        when={fleet_info().e_main_ship_id.length > idx}
        fallback={
          <>
            <td>
              <div class="h-6" />
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
              color={props.store_data_set_param_ship().e_destruction_color[idx]}
              ship_param={
                props.store_data_set_param_ship().e_destruction_ship_param[idx]
              }
              ship_slot={
                props.store_data_set_param_ship().e_destruction_ship_slot[idx]
              }
              ship_max_hp={
                props.store_data_set_param_ship().e_destruction_ship_max_hp[idx]
              }
              mst_ship={
                props.store_data_set_param_ship().e_destruction_mst_ship[idx]
              }
              mst_slot_items={
                props.store_data_set_param_ship().e_destruction_mst_slot_items[
                  idx
                ]
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
        <td>{fleet_info().e_main_damages?.[idx]}</td>
      </Show>
    );
  };

  return (
    <Show when={show_summary()}>
      <li>
        <details open={true}>
          <summary>Desutruction Summary</summary>
          <ul class="pl-0">
            <table class="table table-xs">
              <thead>
                <tr>
                  <th>Air Base</th>
                  <th>HP</th>
                  <th>damage</th>
                  <th>Enemy</th>
                  <th>HP</th>
                  <th>damage</th>
                </tr>
              </thead>
              <tbody>
                <For
                  each={[0, 1, 2, 3, 4, 5, 6].slice(
                    0,
                    Math.max(
                      fleet_info().f_base_id.length,
                      fleet_info().e_main_ship_id.length
                    )
                  )}
                >
                  {(idx) => (
                    <tr class="rounded">
                      {base_table_line(idx)}
                      {enemy_table_line(idx)}
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
