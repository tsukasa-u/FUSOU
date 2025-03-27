import {
  /*useBattles,*/ useCells,
  useDeckPorts /*useMstShips, useShips*/,
} from "../utility/provider";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  JSX,
  Match,
  Show,
  Switch,
} from "solid-js";

import "../css/divider.css";
import IconChevronRightS from "../icons/chevron_right_s";
import {
  Battle,
  implementsEnumAirBaseAirAttack,
  implementsEnumAirBaseAssult,
  implementsEnumCarrierBaseAssault,
  implementsEnumClosingRaigeki,
  implementsEnumFriendlyForceAttack,
  implementsEnumHougeki,
  implementsEnumMidnightHougeki,
  implementsEnumOpeningAirAttack,
  implementsEnumOpeningRaigeki,
  implementsEnumOpeningTaisen,
  implementsEnumSupportAttack,
} from "../interface/battle";
import { OpeningAntiSubmarineComponent } from "./opening_anti_submarine";
import { OpeningTorpedoAttackComponent } from "./opening_torpedo_attack";
import { ClosingTorpedoAttackComponent } from "./closing_torpedo_attack";
import { ShellingComponent } from "./shelling";
import { OpeningAirAttackComponent } from "./opening_air_attack";
import { AirBaseAirAttackComponent } from "./air_base_air_attack";
import { MidnightShellingComponent } from "./midnight_battle";
import { SupportAttackComponent } from "./support_attack";
import { FriendlyForceAttackComponent } from "./friendly_force_attack";
import { AirBaseAssaultComponent } from "./air_base_assault";
import { CarrierBaseAssaultComponent } from "./carrier_base_assault";
import { BattleSummaryComponent } from "./battle_summary";
import { DestructionBattleComponent } from "./destruction_battle";
import { DestructionBattleSummaryComponent } from "./destruction_battle_summary";
import { EquimentComponent } from "./equipment";

export function BattlesComponent() {
  // const [battles, ] = useBattles();
  // const [ships, ] = useShips();
  // const [mst_ships, ] = useMstShips();
  const [deck_ports] = useDeckPorts();
  const [cells] = useCells();

  const [cell_index_selected, set_cell_index_selected] =
    createSignal<number>(0);

  const deck_ship_id = createMemo<{ [key: number]: number[] }>(() => {
    const deck_ship_id: { [key: number]: number[] } = {};
    for (const j of Object.keys(deck_ports.deck_ports)) {
      for (const i of Object.keys(deck_ports.deck_ports[Number(j)].ship)) {
        if (deck_ship_id[Number(j)] ?? -1 > 0) {
          deck_ship_id[Number(j)].push(
            deck_ports.deck_ports[Number(j)].ship[Number(i)],
          );
        }
      }
      deck_ship_id[Number(j)] = deck_ports.deck_ports[Number(j)].ship;
    }
    return deck_ship_id;
  });

  const battle_selected = createMemo<Battle>(() => {
    return cells.battles[cells.cell_index[cell_index_selected()]];
  });

  createEffect(() => {
    set_cell_index_selected(
      cells.cell_index.length > 0 ? cells.cell_index.length - 1 : 0,
    );
  });

  const show_battle = createMemo<boolean>(() => {
    if (Object.keys(cells.battles).length == 0) return false;
    if (
      Object.keys(cells.battles).find(
        (cell) => Number(cell) == cells.cell_index[cell_index_selected()],
      ) == undefined
    )
      return false;
    return true;
  });

  const show_cell = createMemo<boolean>(() => {
    return cells.cell_index.length > 0;
  });

  const battle_history = createMemo<JSX.Element[]>(() => {
    if (!show_battle()) return [];
    if (battle_selected().battle_order == null) return [];

    const battle_history: JSX.Element[] = [];
    battle_selected().battle_order!.forEach((order) => {
      if (implementsEnumAirBaseAssult(order)) {
        battle_history.push(
          <AirBaseAssaultComponent
            area_id={cells.maparea_id}
            battle_selected={battle_selected}
          />,
        );
      }
      if (implementsEnumCarrierBaseAssault(order)) {
        battle_history.push(
          <CarrierBaseAssaultComponent battle_selected={battle_selected} />,
        );
      }
      if (implementsEnumAirBaseAirAttack(order)) {
        battle_history.push(
          <AirBaseAirAttackComponent
            area_id={cells.maparea_id}
            battle_selected={battle_selected}
          />,
        );
      }
      if (implementsEnumOpeningAirAttack(order)) {
        battle_history.push(
          <OpeningAirAttackComponent
            deck_ship_id={deck_ship_id()}
            battle_selected={battle_selected}
          />,
        );
      }
      if (implementsEnumSupportAttack(order)) {
        battle_history.push(
          <SupportAttackComponent
            deck_ship_id={deck_ship_id()}
            battle_selected={battle_selected}
          />,
        );
      }
      if (implementsEnumOpeningTaisen(order)) {
        battle_history.push(
          <OpeningAntiSubmarineComponent
            deck_ship_id={deck_ship_id()}
            battle_selected={battle_selected}
          />,
        );
      }
      if (implementsEnumOpeningRaigeki(order)) {
        battle_history.push(
          <OpeningTorpedoAttackComponent
            deck_ship_id={deck_ship_id()}
            battle_selected={battle_selected}
          />,
        );
      }
      if (implementsEnumClosingRaigeki(order)) {
        battle_history.push(
          <ClosingTorpedoAttackComponent
            deck_ship_id={deck_ship_id()}
            battle_selected={battle_selected}
          />,
        );
      }
      if (implementsEnumFriendlyForceAttack(order)) {
        battle_history.push(
          <FriendlyForceAttackComponent battle_selected={battle_selected} />,
        );
      }
      if (implementsEnumMidnightHougeki(order)) {
        battle_history.push(
          <MidnightShellingComponent
            deck_ship_id={deck_ship_id()}
            battle_selected={battle_selected}
          />,
        );
      }
      if (implementsEnumHougeki(order)) {
        battle_history.push(
          <ShellingComponent
            deck_ship_id={deck_ship_id()}
            battle_selected={battle_selected}
            shelling_idx={order.Hougeki - 1}
          />,
        );
      }
    });
    return battle_history;
  });

  const cell = createMemo(() => {
    return cells.cells[cells.cell_index[cell_index_selected()]];
  });

  return (
    <>
      <li>
        <details open={true}>
          <summary class="flex">
            Battles
            <IconChevronRightS class="h-4 w-4" />
            {/* <Show when={show_battle()}> */}
            <div>
              Map : {cells.maparea_id}-{cells.mapinfo_no}
            </div>
            <div class="divider divider-horizontal mr-0 ml-0" />
            <div>Boss Cell : {cells.bosscell_no}</div>
            {/* </Show> */}
            <span class="flex-auto" />
          </summary>
          <Show
            when={show_cell()}
            fallback={<div class="text-xs pl-4 py-1">No Cell Data ...</div>}
          >
            <ul class="pl-0">
              <div class="flex flex-row pl-2">
                <div class="h-4 mt-px pt-px">cells</div>
                <IconChevronRightS class="h-4 w-4 m-1 " />
                <For each={cells.cell_index}>
                  {(_, index) => (
                    <>
                      <Show when={index() > 0}>
                        <div class="divider divider-horizontal mr-0 ml-0 w-px" />
                      </Show>
                      <button
                        class={`${cell_index_selected() == index() ? "btn-active" : ""} btn btn-xs btn-square rounded-none`}
                        style={{ "box-shadow": "none" }}
                        onClick={() => {
                          set_cell_index_selected(index());
                        }}
                      >
                        {cells.cell_index[index()]}
                      </button>
                    </>
                  )}
                </For>
              </div>
              <DestructionBattleSummaryComponent area_id={cells.maparea_id} cell={cell} />
              <DestructionBattleComponent area_id={cells.maparea_id} cell={cell} />
              <Show when={show_battle()}>
                <div
                  class="flex felx-nowrap text-xs py-0.5 tooltip tooltip-right pl-2"
                  data-tip={battle_selected().reconnaissance}
                >
                  Search : <span class="w-1" />
                  <Show
                    when={battle_selected().reconnaissance !== null}
                    fallback={<div>_</div>}
                  >
                    <Switch fallback={<div>_</div>}>
                      <Match when={battle_selected().reconnaissance![0] == 1}>
                        <div class="text-lime-500">
                          Enemy in sight; Accuracy & Evacuation Up
                        </div>
                      </Match>
                      <Match when={battle_selected().reconnaissance![0] == 2}>
                        <div class="text-lime-500">
                          Enemy in sight; Accuracy & Evacuation Up
                        </div>
                      </Match>
                      <Match when={battle_selected().reconnaissance![0] == 3}>
                        <div class="text-red-500">
                          No Enemy in Sight; Some reconnaissance planes not
                          returned; Anti-Air & Evacuation Down
                        </div>
                      </Match>
                      <Match when={battle_selected().reconnaissance![0] == 4}>
                        <div class="text-red-500">
                          No Enemy in Sight; Anti-Air & Evacuation Down
                        </div>
                      </Match>
                      <Match when={battle_selected().reconnaissance![0] == 5}>
                        <div class="text-lime-500">
                          Find Enemy; Accuracy & Evacuation Up
                        </div>
                      </Match>
                      <Match when={battle_selected().reconnaissance![0] == 6}>
                        <div />
                      </Match>
                    </Switch>
                  </Show>
                </div>
                <div
                  class="flex felx-nowrap text-xs py-0.5 tooltip tooltip-right pl-2"
                  data-tip={battle_selected().formation}
                >
                  Formation : <span class="w-1" />
                  <For each={battle_selected().formation?.slice(0, 2)}>
                    {(formation, index) => (
                      <>
                        <Switch fallback={<div>_</div>}>
                          <Match when={formation == 1}>
                            <div
                              class={
                                index() == 0 ? "text-lime-500" : "text-red-500"
                              }
                            >
                              Line Ahead
                            </div>
                          </Match>
                          <Match when={formation == 2}>
                            <div
                              class={
                                index() == 0 ? "text-lime-500" : "text-red-500"
                              }
                            >
                              Double Line
                            </div>
                          </Match>
                          <Match when={formation == 3}>
                            <div
                              class={
                                index() == 0 ? "text-lime-500" : "text-red-500"
                              }
                            >
                              Diamond
                            </div>
                          </Match>
                          <Match when={formation == 4}>
                            <div
                              class={
                                index() == 0 ? "text-lime-500" : "text-red-500"
                              }
                            >
                              Echelon
                            </div>
                          </Match>
                          <Match when={formation == 5}>
                            <div
                              class={
                                index() == 0 ? "text-lime-500" : "text-red-500"
                              }
                            >
                              Line Abreast
                            </div>
                          </Match>
                          <Match when={formation == 6}>
                            <div
                              class={
                                index() == 0 ? "text-lime-500" : "text-red-500"
                              }
                            >
                              Vanguard
                            </div>
                          </Match>
                        </Switch>
                        <Show when={index() == 0}>
                          <span class="w-4">/</span>
                        </Show>
                      </>
                    )}
                  </For>
                  <div class="divider divider-horizontal mr-0 ml-0" />
                  {/* <span class="w-4"></span> */}
                  Form : <span class="w-1" />
                  <Switch fallback={<div>_</div>}>
                    <Match when={battle_selected().formation![2] == 3}>
                      <div class="text-lime-500">
                        Crossing the T (Advantage)
                      </div>
                    </Match>
                    <Match when={battle_selected().formation![2] == 1}>
                      <div class="">Parallel</div>
                    </Match>
                    <Match when={battle_selected().formation![2] == 2}>
                      <div class="">Head-on Engagement</div>
                    </Match>
                    <Match when={battle_selected().formation![2] == 4}>
                      <div class="text-red-500">
                        Crossing the T (Disadvantage)
                      </div>
                    </Match>
                  </Switch>
                </div>
                <Show when={battle_selected().smoke_type !== null && battle_selected().smoke_type !== 0}>
                  <div class="flex felx-nowrap text-xs py-0.5 pl-2">
                    Smoke Type : <span class="w-1" />
                    <Switch fallback={<div>_</div>}>
                      <Match when={battle_selected().smoke_type == 1}>
                        <div>Signle</div>
                      </Match>
                      <Match when={battle_selected().smoke_type == 2}>
                        <div>Double</div>
                      </Match>
                      <Match when={battle_selected().smoke_type == 3}>
                        <div>Triple</div>
                      </Match>
                    </Switch>
                  </div>
                </Show>
                <div class="flex felx-nowrap text-xs py-0.5 pl-2">
                  <Show when={battle_selected().smoke_type !== null && battle_selected().smoke_type !== 0}>
                      Smoke Type : <span class="w-1" />
                      <Switch fallback={<div>_</div>}>
                        <Match when={battle_selected().smoke_type == 1}>
                          <div>Signle</div>
                        </Match>
                        <Match when={battle_selected().smoke_type == 2}>
                          <div>Double</div>
                        </Match>
                        <Match when={battle_selected().smoke_type == 3}>
                          <div>Triple</div>
                        </Match>
                      </Switch>
                  </Show>
                  <Show when={battle_selected().combat_ration != null}>
                    <div class="divider divider-horizontal mr-0 ml-0" />
                    Combat Ration : <span class="w-1" />
                    <For each={battle_selected().combat_ration}>
                      {(ration) => (
                        <div><EquimentComponent slot_id={ration} name_flag={false} /></div>
                      )}
                    </For>
                  </Show>
                </div>
              </Show>
            </ul>
            <Show
              when={show_battle()}
              fallback={<div class="text-xs pl-4 py-1">No Battle Data ...</div>}
            >
              <ul class="pl-0">
                <BattleSummaryComponent
                  deck_ship_id={deck_ship_id()}
                  battle_selected={battle_selected}
                />
                <For each={battle_history()}>{(battle) => <>{battle}</>}</For>
                {/* <AirBaseAssaultComponent area_id={cells.maparea_id} battle_selected={battle_selected} />
                                <CarrierBaseAssaultComponent battle_selected={battle_selected} />
                                <AirBaseAirAttackComponent area_id={cells.maparea_id} battle_selected={battle_selected} />
                                <OpeningAirAttackComponent deck_ship_id={deck_ship_id()} battle_selected={battle_selected} />
                                <SupportAttackComponent deck_ship_id={deck_ship_id()} battle_selected={battle_selected} />
                                <OpeningAntiSubmarineComponent deck_ship_id={deck_ship_id()} battle_selected={battle_selected} />
                                <OpeningTorpedoAttackComponent deck_ship_id={deck_ship_id()} battle_selected={battle_selected} />
                                <ShellingComponent deck_ship_id={deck_ship_id()} battle_selected={battle_selected} />
                                <ClosingTorpedoAttackComponent deck_ship_id={deck_ship_id()} battle_selected={battle_selected} />
                                <FriendlyForceAttackComponent battle_selected={battle_selected} />
                                <MidnightShellingComponent deck_ship_id={deck_ship_id()} battle_selected={battle_selected} /> */}
              </ul>
            </Show>
          </Show>
        </details>
      </li>
    </>
  );
}
