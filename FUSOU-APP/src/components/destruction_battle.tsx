import { createMemo, For, Show } from "solid-js";

import "../css/divider.css";
import { SimpleShipNameComponent } from "./simple_ship_name";
import { useAirBases, useCells } from "../utility/provider";
import { EquimentComponent } from "./equipment";

interface DestructionBattleProps {
  area_id: number;
  cell_index_selected: () => number;
}

export function DestructionBattleComponent(props: DestructionBattleProps) {
  const [cells] = useCells();
  const [air_bases] = useAirBases();

  const show_destruction_battle = createMemo<boolean>(() => {
    if (Object.keys(cells.cells).length == 0) return false;
    if (
      Object.keys(cells.cells).find(
        (cell) => Number(cell) == props.cell_index_selected(),
      ) == undefined
    )
      return false;
    if (
      cells.cells[props.cell_index_selected()].destruction_battle == null ||
      cells.cells[props.cell_index_selected()].destruction_battle == undefined
    )
      return false;
    if (
      cells.cells[props.cell_index_selected()].destruction_battle!
        .air_base_attack.map_squadron_plane == null
    )
      return false;
    return true;
  });

  const show_damage = createMemo<boolean[][]>(() => {
    let show_damage: boolean[][] = [
      [false, false, false, false, false, false, false],
      [false, false, false, false, false, false, false],
    ];
    if (cells.cells[props.cell_index_selected()].destruction_battle == null)
      return show_damage;
    if (
      cells.cells[props.cell_index_selected()].destruction_battle!
        .air_base_attack.e_damage.bak_flag
    ) {
      cells.cells[
        props.cell_index_selected()
      ].destruction_battle!.air_base_attack.e_damage!.bak_flag!.forEach(
        (flag, idx) => {
          show_damage[0][idx] ||= flag == 1;
        },
      );
    }
    if (
      cells.cells[props.cell_index_selected()].destruction_battle!
        .air_base_attack.e_damage.rai_flag
    ) {
      cells.cells[
        props.cell_index_selected()
      ].destruction_battle!.air_base_attack.e_damage!.rai_flag!.forEach(
        (flag, idx) => {
          show_damage[0][idx] ||= flag == 1;
        },
      );
    }
    if (
      cells.cells[props.cell_index_selected()].destruction_battle!
        .air_base_attack.f_damage.bak_flag
    ) {
      cells.cells[
        props.cell_index_selected()
      ].destruction_battle!.air_base_attack.f_damage!.bak_flag!.forEach(
        (flag, idx) => {
          show_damage[1][idx] ||= flag == 1;
        },
      );
    }
    if (
      cells.cells[props.cell_index_selected()].destruction_battle!
        .air_base_attack.f_damage.rai_flag
    ) {
      cells.cells[
        props.cell_index_selected()
      ].destruction_battle!.air_base_attack.f_damage!.rai_flag!.forEach(
        (flag, idx) => {
          show_damage[1][idx] ||= flag == 1;
        },
      );
    }
    return show_damage;
  });

  return (
    <Show when={show_destruction_battle()}>
      <li>
        <details open={true}>
          <summary>Destruction Battle</summary>
          <ul class="pl-0">
            <table class="table table-xs">
              <thead>
                <tr>
                  <th>From</th>
                  <th>To</th>
                  <th>Attack</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <div class="flex flex-col">
                      <For
                        each={Object.keys(
                          cells.cells[props.cell_index_selected()]
                            .destruction_battle!.air_base_attack
                            .map_squadron_plane!,
                        )}
                      >
                        {(base_id) => (
                          <For
                            each={
                              air_bases.bases[
                                (props.area_id << 16) | Number(base_id)
                              ].plane_info
                            }
                          >
                            {(plane, idx) => (
                              <>
                                <Show when={plane != null}>
                                  <Show when={idx() > 0}>
                                    <div class="h-px" />
                                  </Show>
                                  <EquimentComponent
                                    slot_id={plane.slotid}
                                    name_flag={true}
                                  />
                                </Show>
                              </>
                            )}
                          </For>
                        )}
                      </For>
                    </div>
                  </td>
                  <td>
                    <For
                      each={
                        cells.cells[props.cell_index_selected()]
                          .destruction_battle!.air_base_attack.e_damage.damages
                      }
                    >
                      {(_, idx) => (
                        <>
                          <Show when={show_damage()[0][idx()]}>
                            <Show when={idx() > 0}>
                              <div class="h-px" />
                            </Show>
                            <SimpleShipNameComponent
                              ship_id={
                                cells.cells[props.cell_index_selected()]
                                  .destruction_battle!.ship_ke[idx()]
                              }
                              ship_max_hp={
                                cells.cells[props.cell_index_selected()]
                                  .destruction_battle?.e_maxhps[idx()] ?? 0
                              }
                              ship_param={null}
                              ship_slot={
                                cells.cells[props.cell_index_selected()]
                                  .destruction_battle?.e_slot[idx()]!
                              }
                            />
                          </Show>
                        </>
                      )}
                    </For>
                  </td>
                  <td>
                    <For
                      each={
                        cells.cells[props.cell_index_selected()]
                          .destruction_battle!.air_base_attack.e_damage.damages
                      }
                    >
                      {(dmg, idx) => (
                        <>
                          <Show when={show_damage()[0][idx()]}>
                            <Show when={idx() > 0}>
                              <div class="h-[4px]" />
                            </Show>
                            <div>{dmg}</div>
                          </Show>
                        </>
                      )}
                    </For>
                  </td>
                </tr>
                <tr>
                  <td>
                    <div class="flex flex-col">
                      <For
                        each={
                          cells.cells[props.cell_index_selected()]
                            .destruction_battle!.air_base_attack.e_damage
                            .plane_from
                        }
                      >
                        {(plane_flag, idx) => (
                          <>
                            <Show when={plane_flag != -1}>
                              <Show when={idx() > 0}>
                                <div class="h-px" />
                              </Show>
                              <SimpleShipNameComponent
                                ship_id={
                                  cells.cells[props.cell_index_selected()]
                                    .destruction_battle!.ship_ke[idx()]
                                }
                                ship_max_hp={
                                  cells.cells[props.cell_index_selected()]
                                    .destruction_battle?.e_maxhps[idx()] ?? 0
                                }
                                ship_param={null}
                                ship_slot={
                                  cells.cells[props.cell_index_selected()]
                                    .destruction_battle?.e_slot[idx()]!
                                }
                              />
                            </Show>
                          </>
                        )}
                      </For>
                    </div>
                  </td>
                  <td>
                    <For
                      each={
                        cells.cells[props.cell_index_selected()]
                          .destruction_battle!.air_base_attack.f_damage.damages
                      }
                    >
                      {(_, idx) => (
                        <>
                          <Show when={show_damage()[1][idx()]}>
                            <Show when={idx() > 0}>
                              <div class="h-px" />
                            </Show>
                            {
                              air_bases.bases[
                                (props.area_id << 16) | (idx() + 1)
                              ].name
                            }
                          </Show>
                        </>
                      )}
                    </For>
                  </td>
                  <td>
                    <For
                      each={
                        cells.cells[props.cell_index_selected()]
                          .destruction_battle!.air_base_attack.f_damage.damages
                      }
                    >
                      {(dmg, idx) => (
                        <>
                          <Show when={show_damage()[1][idx()]}>
                            <div>{dmg}</div>
                          </Show>
                        </>
                      )}
                    </For>
                  </td>
                </tr>
              </tbody>
            </table>
          </ul>
        </details>
      </li>
    </Show>
  );
}
