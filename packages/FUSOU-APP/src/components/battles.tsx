import { useCells } from "../utility/provider";
import type { JSX } from "solid-js";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  Show,
  Switch,
} from "solid-js";

import "../css/divider.css";
import IconChevronRightS from "../icons/chevron_right_s";
import {
  implementsAirBaseAirAttack,
  implementsAirBaseAssult,
  implementsCarrierBaseAssault,
  implementsClosingRaigeki,
  implementsFriendlyForceAttack,
  implementsHougeki,
  implementsMidnightHougeki,
  implementsOpeningAirAttack,
  implementsOpeningRaigeki,
  implementsOpeningTaisen,
  implementsSupportAttack,
} from "@ipc-bindings/user_guard";
import type { Battle } from "@ipc-bindings/battle";
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
import type { DeckShipIds } from "../utility/battles";
import {
  get_deck_ship_id,
  get_store_data_set_deck_ship,
} from "../utility/battles";
import type { DataSetParamShip, DataSetShip } from "../utility/get_data_set";
import { get_data_set_param_ship } from "../utility/get_data_set";
import { WrapCompactEquipComponent } from "./wrap_web_component";

export function BattlesComponent() {
  const [cells] = useCells();

  const [cell_index_selected, set_cell_index_selected] =
    createSignal<number>(0);

  const deck_ship_id = createMemo<DeckShipIds>(() => get_deck_ship_id());

  const store_data_set_deck_ship = createMemo<DataSetShip>(() =>
    get_store_data_set_deck_ship()
  );

  const battle_selected = createMemo<Battle | undefined>(() => {
    return cells.battles[cells.cell_index[cell_index_selected()]];
  });

  const cell = createMemo(() => {
    return cells.cells[cells.cell_index[cell_index_selected()]];
  });

  const store_data_set_param_ship = createMemo<DataSetParamShip>(() =>
    get_data_set_param_ship(battle_selected(), cell()?.destruction_battle)
  );

  createEffect(() => {
    set_cell_index_selected(
      cells.cell_index.length > 0 ? cells.cell_index.length - 1 : 0
    );
  });

  createEffect(() => {
    console.log(cells);
  });

  const show_battle = createMemo<boolean>(() => {
    if (Object.keys(cells.battles).length == 0) return false;
    if (
      Object.keys(cells.battles).find(
        (cell) => Number(cell) == cells.cell_index[cell_index_selected()]
      ) == undefined
    )
      return false;
    return true;
  });

  const show_cell = createMemo<boolean>(() => {
    return cells.cell_index.length > 0;
  });

  const battle_history = (): JSX.Element[] => {
    if (!show_battle()) return [];
    if (!battle_selected()?.battle_order) return [];

    const battle_history: JSX.Element[] = [];
    battle_selected()?.battle_order?.forEach((order) => {
      if (implementsAirBaseAssult(order)) {
        battle_history.push(
          <AirBaseAssaultComponent
            area_id={cells.maparea_id}
            battle_selected={battle_selected}
            store_data_set_param_ship={store_data_set_param_ship}
          />
        );
      }
      if (implementsCarrierBaseAssault(order)) {
        battle_history.push(
          <CarrierBaseAssaultComponent
            deck_ship_id={deck_ship_id}
            battle_selected={battle_selected}
            store_data_set_deck_ship={store_data_set_deck_ship}
            store_data_set_param_ship={store_data_set_param_ship}
          />
        );
      }
      if (implementsAirBaseAirAttack(order)) {
        battle_history.push(
          <AirBaseAirAttackComponent
            area_id={cells.maparea_id}
            battle_selected={battle_selected}
            store_data_set_param_ship={store_data_set_param_ship}
          />
        );
      }
      if (implementsOpeningAirAttack(order)) {
        battle_history.push(
          <OpeningAirAttackComponent
            deck_ship_id={deck_ship_id}
            battle_selected={battle_selected}
            store_data_set_deck_ship={store_data_set_deck_ship}
            store_data_set_param_ship={store_data_set_param_ship}
          />
        );
      }
      if (implementsSupportAttack(order)) {
        battle_history.push(
          <SupportAttackComponent
            deck_ship_id={deck_ship_id}
            battle_selected={battle_selected}
            store_data_set_deck_ship={store_data_set_deck_ship}
            store_data_set_param_ship={store_data_set_param_ship}
          />
        );
      }
      if (implementsOpeningTaisen(order)) {
        battle_history.push(
          <OpeningAntiSubmarineComponent
            deck_ship_id={deck_ship_id}
            battle_selected={battle_selected}
            store_data_set_deck_ship={store_data_set_deck_ship}
            store_data_set_param_ship={store_data_set_param_ship}
          />
        );
      }
      if (implementsOpeningRaigeki(order)) {
        battle_history.push(
          <OpeningTorpedoAttackComponent
            deck_ship_id={deck_ship_id}
            battle_selected={battle_selected}
            store_data_set_deck_ship={store_data_set_deck_ship}
            store_data_set_param_ship={store_data_set_param_ship}
          />
        );
      }
      if (implementsClosingRaigeki(order)) {
        battle_history.push(
          <ClosingTorpedoAttackComponent
            deck_ship_id={deck_ship_id}
            battle_selected={battle_selected}
            store_data_set_deck_ship={store_data_set_deck_ship}
            store_data_set_param_ship={store_data_set_param_ship}
          />
        );
      }
      if (implementsFriendlyForceAttack(order)) {
        battle_history.push(
          <FriendlyForceAttackComponent
            battle_selected={battle_selected}
            deck_ship_id={deck_ship_id}
            store_data_set_deck_ship={store_data_set_deck_ship}
            store_data_set_param_ship={store_data_set_param_ship}
          />
        );
      }
      if (implementsMidnightHougeki(order)) {
        battle_history.push(
          <MidnightShellingComponent
            deck_ship_id={deck_ship_id}
            battle_selected={battle_selected}
            store_data_set_deck_ship={store_data_set_deck_ship}
            store_data_set_param_ship={store_data_set_param_ship}
          />
        );
      }
      if (implementsHougeki(order)) {
        battle_history.push(
          <ShellingComponent
            deck_ship_id={deck_ship_id}
            battle_selected={battle_selected}
            store_data_set_deck_ship={store_data_set_deck_ship}
            store_data_set_param_ship={store_data_set_param_ship}
            shelling_idx={order.Hougeki - 1}
          />
        );
      }
    });
    return battle_history;
  };

  const serach_message = () => {
    const battle = battle_selected();
    const empty_message = (
      <>
        <div>___</div>
      </>
    );
    if (battle) {
      const reconnaissance = battle.reconnaissance
        ? battle.reconnaissance[0]
        : undefined;
      return (
        <>
          <Switch fallback={empty_message}>
            <Match when={reconnaissance == 1}>
              <div class="text-lime-500">
                Enemy in sight; Accuracy & Evacuation Up
              </div>
            </Match>
            <Match when={reconnaissance == 2}>
              <div class="text-lime-500">
                Enemy in sight; Accuracy & Evacuation Up
              </div>
            </Match>
            <Match when={reconnaissance == 3}>
              <div class="text-red-500">
                No Enemy in Sight; Some reconnaissance planes not returned;
                Anti-Air & Evacuation Down
              </div>
            </Match>
            <Match when={reconnaissance == 4}>
              <div class="text-red-500">
                No Enemy in Sight; Anti-Air & Evacuation Down
              </div>
            </Match>
            <Match when={reconnaissance == 5}>
              <div class="text-lime-500">
                Find Enemy; Accuracy & Evacuation Up
              </div>
            </Match>
            <Match when={reconnaissance == 6}>
              <div />
            </Match>
          </Switch>
        </>
      );
    } else {
      return <>{empty_message}</>;
    }
  };

  const form = () => {
    const formation = battle_selected()?.formation;
    const empty_message = (
      <>
        <div>_</div>
      </>
    );
    if (formation) {
      return (
        <Switch fallback={<div>{empty_message}</div>}>
          <Match when={formation[2] == 3}>
            <div class="text-lime-500">Crossing the T (Advantage)</div>
          </Match>
          <Match when={formation[2] == 1}>
            <div class="">Parallel</div>
          </Match>
          <Match when={formation[2] == 2}>
            <div class="">Head-on Engagement</div>
          </Match>
          <Match when={formation[2] == 4}>
            <div class="text-red-500">Crossing the T (Disadvantage)</div>
          </Match>
        </Switch>
      );
    } else {
      return <>{empty_message}</>;
    }
  };

  const display_serach = () => {
    return (
      <div class="flex felx-nowrap text-xs py-0.5 pl-2">
        Search : <span class="w-1" />
        <Show when={!battle_selected()?.reconnaissance} fallback={<div>_</div>}>
          {serach_message()}
        </Show>
      </div>
    );
  };

  const display_formation = () => {
    return (
      <>
        Formation : <span class="w-1" />
        <For each={battle_selected()?.formation?.slice(0, 2)}>
          {(formation, index) => (
            <>
              <div class={index() == 0 ? "text-lime-500" : "text-red-500"}>
                <Switch fallback={<div>_</div>}>
                  <Match when={formation == 1}>
                    <div>Line Ahead</div>
                  </Match>
                  <Match when={formation == 2}>
                    <div>Double Line</div>
                  </Match>
                  <Match when={formation == 3}>
                    <div>Diamond</div>
                  </Match>
                  <Match when={formation == 4}>
                    <div>Echelon</div>
                  </Match>
                  <Match when={formation == 5}>
                    <div>Line Abreast</div>
                  </Match>
                  <Match when={formation == 6}>
                    <div>Vanguard</div>
                  </Match>
                </Switch>
              </div>
              <Show when={index() == 0}>
                <div class="w-3 text-center">/</div>
              </Show>
            </>
          )}
        </For>
      </>
    );
  };

  const display_form = () => {
    return (
      <>
        Form : <span class="w-1" />
        {form()}
      </>
    );
  };

  const display_smoke_type = () => {
    return (
      <>
        Smoke Type : <span class="w-1" />
        <Show
          when={
            !battle_selected()?.smoke_type &&
            battle_selected()?.smoke_type !== 0
          }
          fallback={<div class="w-6 text-center">_</div>}
        >
          <Switch fallback={<div class="w-6 text-center">_</div>}>
            <Match when={battle_selected()?.smoke_type == 1}>
              <div>Signle</div>
            </Match>
            <Match when={battle_selected()?.smoke_type == 2}>
              <div>Double</div>
            </Match>
            <Match when={battle_selected()?.smoke_type == 3}>
              <div>Triple</div>
            </Match>
          </Switch>
        </Show>
      </>
    );
  };

  const display_ombat_ration = () => {
    return (
      <>
        Combat Ration : <span class="w-1" />
        <Show
          when={!battle_selected()?.combat_ration}
          fallback={<div class="w-6 text-center">_</div>}
        >
          <For
            each={battle_selected()?.combat_ration}
            fallback={<div class="w-6 text-center">_</div>}
          >
            {(ration) => (
              <div>
                <WrapCompactEquipComponent si={ration} name_flag={false} />
              </div>
            )}
          </For>
        </Show>
      </>
    );
  };

  const dispaly_balloon = () => {
    const balloon_id = 513;
    const deck_id = battle_selected()?.deck_id;
    let baloon_flag = false;
    if (deck_id) {
      const f_ship_ids = deck_ship_id()
        [deck_id].map((ship_id) => ship_id)
        .filter((id) => id > 0);
      const f_mst_slot_item = f_ship_ids
        ?.map((ship_id) =>
          Object.values(
            store_data_set_deck_ship()[ship_id]?.mst_slot_items
              ?.mst_slot_items ?? {}
          )
        )
        .flat();
      const f_balloon =
        f_mst_slot_item.findIndex((slot_item) => slot_item?.id == balloon_id) !=
        -1;
      const e_mst_slot_item = store_data_set_param_ship()
        .e_mst_slot_items.filter((slot_item) => slot_item)
        .map((slot_item) => Object.values(slot_item!.mst_slot_items))
        .flat();
      const e_balloon =
        e_mst_slot_item.findIndex((slot_item) => slot_item?.id == balloon_id) !=
        -1;
      baloon_flag = f_balloon || e_balloon;
    }
    return (
      <>
        Balloon : <span class="w-1" />
        <Show
          when={battle_selected()?.balloon_flag == 1 && baloon_flag}
          fallback={<div class="w-6 text-center">_</div>}
        >
          launched
        </Show>
      </>
    );
  };

  return (
    <>
      <li>
        <details open={true}>
          <summary class="flex">
            Battles
            <IconChevronRightS class="h-4 w-4" />
            <div>
              Map : {cells.maparea_id}-{cells.mapinfo_no}
            </div>
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
              <DestructionBattleSummaryComponent
                area_id={cells.maparea_id}
                cell={cell}
                store_data_set_param_ship={store_data_set_param_ship}
              />
              <DestructionBattleComponent
                area_id={cells.maparea_id}
                cell={cell}
                store_data_set_param_ship={store_data_set_param_ship}
              />
              <Show when={show_battle()}>
                {display_serach()}
                <div class="flex felx-nowrap text-xs py-0.5 pl-2">
                  {display_formation()}
                  <div class="divider divider-horizontal mr-0 ml-0" />
                  {display_form()}
                </div>
                <div class="flex felx-nowrap text-xs py-0.5 pl-2">
                  {display_smoke_type()}
                  <div class="divider divider-horizontal mr-0 ml-0" />
                  {display_ombat_ration()}
                  <div class="divider divider-horizontal mr-0 ml-0" />
                  {dispaly_balloon()}
                </div>
              </Show>
            </ul>
            <Show
              when={show_battle()}
              fallback={<div class="text-xs pl-4 py-1">No Battle Data ...</div>}
            >
              <ul class="pl-0">
                <BattleSummaryComponent
                  deck_ship_id={deck_ship_id}
                  battle_selected={battle_selected}
                  store_data_set_deck_ship={store_data_set_deck_ship}
                  store_data_set_param_ship={store_data_set_param_ship}
                />
                <For each={battle_history()}>{(battle) => <>{battle}</>}</For>
              </ul>
            </Show>
          </Show>
        </details>
      </li>
    </>
  );
}
