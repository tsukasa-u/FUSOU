import { createMemo, For, Show } from "solid-js";

import "../css/divider.css";
import { SimpleShipNameComponent } from "./simple_ship_name";
import { useAirBases, useCells } from "../utility/provider";
import { SimpleHpBar } from "./simple_hp_bar";
import IconFleetNumber from "../icons/fleet_number";
import { Cell } from "../interface/cells";

interface ButtleSummaryProps {
  area_id: number;
  cell: () => Cell;
}

interface FleetInfo {
  f_base_id: number[];
  f_base_nowhps: number[];
  f_base_maxhps: number[];
  f_base_damages: number[];
  e_main_ship_id: number[];
  e_main_nowhps: number[];
  e_main_maxhps: number[];
  e_main_damages: number[];
  e_main_prams: (number[] | null)[];
  e_main_slot: number[][];
}

export function DestructionBattleSummaryComponent(props: ButtleSummaryProps) {
  const [cells] = useCells();
  const [air_bases] = useAirBases();

  const show_summary = createMemo<boolean>(() => {
    if (Object.keys(cells.cells).length == 0) return false;

    if (props.cell() == null || props.cell() == undefined) return false;
    
    if (
      props.cell().destruction_battle == null ||
      props.cell().destruction_battle == undefined
    )
      return false;
    if (
      props.cell().destruction_battle!
        .air_base_attack.map_squadron_plane == null
    )
      return false;
    return true;
  });

  const fleet_info = createMemo<FleetInfo>(() => {
    let ret =  {
        f_base_id: [],
        f_base_nowhps: [],
        f_base_maxhps: [],
        f_base_damages: [],
        e_main_ship_id: [],
        e_main_nowhps: [],
        e_main_maxhps: [],
        e_main_damages: [],
        e_main_prams: [[]],
        e_main_slot: [[]],
      };
    if (show_summary() == false) return ret;

    // let f_base_id: number[] = Object.keys(props.cell()
    //     .destruction_battle!.air_base_attack
    //     .map_squadron_plane!).map((base_id) => {
    //         return (props.area_id << 16) | Number(base_id);
    //     });

    let f_base_id: number[] = [];
    Object.entries(air_bases.bases).forEach(([base_id, base]) => {
        // if ((Number(base_id) & (props.area_id << 16)) != 0) {
            // if (base.action_kind = ) {
            if (base.area_id == props.area_id) {
                f_base_id.push(Number(base_id));
            }
            // }
        // }
    });
    
    let f_base_nowhps: number[] = props.cell().destruction_battle!.f_nowhps.map((hp, i) => hp - props.cell().destruction_battle!.f_total_damages![i]);
    let f_base_maxhps: number[] = props.cell().destruction_battle!.f_maxhps;
    let f_base_damages: number[] = props.cell().destruction_battle!.f_total_damages!;


    let e_main_ship_id: number[] = props.cell().destruction_battle!.ship_ke;
    let e_main_nowhps: number[] = props.cell().destruction_battle!.e_nowhps.map((hp, i) => hp - props.cell().destruction_battle!.e_total_damages![i]);
    let e_main_maxhps: number[] = props.cell().destruction_battle!.e_maxhps;
    let e_main_damages: number[] = props.cell().destruction_battle!.e_total_damages!;
    let e_main_prams: (number[] | null)[] = props.cell().destruction_battle!.ship_ke.map(() => null);
    let e_main_slot: number[][] = props.cell().destruction_battle?.e_slot!

    return {
        f_base_id: f_base_id,
        f_base_nowhps: f_base_nowhps,
        f_base_maxhps: f_base_maxhps,
        f_base_damages: f_base_damages,
        e_main_ship_id: e_main_ship_id,
        e_main_nowhps: e_main_nowhps,
        e_main_maxhps: e_main_maxhps,
        e_main_damages: e_main_damages,
        e_main_prams: e_main_prams,
        e_main_slot: e_main_slot,
    };
  });

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
                      fleet_info().e_main_ship_id.length,
                    ),
                  )}
                >
                  {(idx) => (
                    <tr class="table_hover table_active rounded">
                      <Show
                        when={fleet_info().f_base_id.length > idx}
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
                              {
                                air_bases.bases[
                                    fleet_info().f_base_id[idx]
                                ].name
                              }
                            </div>
                        </td>
                        <td>
                          <div class="flex-none">
                            <SimpleHpBar
                              v_now={() => fleet_info().f_base_nowhps[idx]}
                              v_max={() => fleet_info().f_base_maxhps[idx]}
                            />
                          </div>
                        </td>
                        <td>{fleet_info().f_base_damages[idx]}</td>
                      </Show>
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
                            <IconFleetNumber
                              class="h-6 -mt-1 pr-1"
                              e_flag={1}
                              fleet_number={1}
                              ship_number={idx + 1}
                            />
                            <SimpleShipNameComponent
                              ship_id={fleet_info().e_main_ship_id[idx]}
                              ship_param={fleet_info().e_main_prams[idx]}
                              ship_slot={fleet_info().e_main_slot[idx]}
                              ship_max_hp={fleet_info().e_main_maxhps[idx]}
                            />
                          </div>
                        </td>
                        <td>
                          <div class="flex-none">
                            <SimpleHpBar
                              v_now={() => fleet_info().e_main_nowhps[idx]}
                              v_max={() => fleet_info().e_main_maxhps[idx]}
                            />
                          </div>
                        </td>
                        <td>{fleet_info().e_main_damages[idx]}</td>
                      </Show>
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
