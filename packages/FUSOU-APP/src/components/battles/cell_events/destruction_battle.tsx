import { createMemo, For, Match, Show, Switch } from "solid-js";

import "../../../css/divider.css";
import { useAirBasesBattles } from "../../../utility/provider";
import type { Cell } from "@ipc-bindings/cells";
import type { DataSetParamShip } from "../../../utility/get_data_set";
import {
  WrapBaseHPComponent,
  WrapCIMstEquipComponent,
  WrapEnemyShipHPComponent,
  WrapNumberedEnemyShipComponent,
  WrapOwnPlaneEquipComponent,
} from "../wrap_web_component";
import { calc_critical } from "../../../utility/battles";

interface DestructionBattleProps {
  area_id: number;
  cell: () => Cell | undefined;
  store_data_set_param_ship: () => DataSetParamShip;
}

export function DestructionBattleComponent(props: DestructionBattleProps) {
  const [air_bases] = useAirBasesBattles();

  const show_destruction_battle = createMemo<boolean>(() => {
    if (!props.cell()) return false;

    if (!props.cell()?.destruction_battle) return false;
    if (!props.cell()?.destruction_battle?.air_base_attack.map_squadron_plane)
      return false;

    return true;
  });

  const show_damage = createMemo<boolean[][]>(() => {
    const show_damage: boolean[][] = [
      Array(6).fill(false),
      Array(6).fill(false),
    ];

    const destruction_battle = props.cell()?.destruction_battle;
    if (props.cell() == null || props.cell() == undefined) return show_damage;
    if (!destruction_battle) return show_damage;

    destruction_battle?.air_base_attack.e_damage.bak_flag?.forEach(
      (flag, idx) => {
        show_damage[0][idx] ||= flag == 1;
      }
    );
    destruction_battle?.air_base_attack.e_damage.rai_flag?.forEach(
      (flag, idx) => {
        show_damage[0][idx] ||= flag == 1;
      }
    );
    destruction_battle?.air_base_attack.f_damage.bak_flag?.forEach(
      (flag, idx) => {
        show_damage[1][idx] ||= flag == 1;
      }
    );
    destruction_battle?.air_base_attack.f_damage.rai_flag?.forEach(
      (flag, idx) => {
        show_damage[1][idx] ||= flag == 1;
      }
    );
    return show_damage;
  });

  const display_formation = () => {
    const destruction_battle = props.cell()?.destruction_battle;
    return (
      <>
        Formation : <span class="w-1" />
        <For each={destruction_battle?.formation.slice(0, 2)}>
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
                <span class="w-4">/</span>
              </Show>
            </>
          )}
        </For>
      </>
    );
  };

  const display_air_state = () => {
    const destruction_battle = props.cell()?.destruction_battle;
    return (
      <>
        Air State :{" "}
        <Switch fallback={<div class="w-6 flex justify-center">_</div>}>
          <Match
            when={destruction_battle?.air_base_attack.air_superiority == 0}
          >
            <div class="text-lime-500 pl-1">Air Supremacy</div>
          </Match>
          <Match
            when={destruction_battle?.air_base_attack.air_superiority == 1}
          >
            <div class="text-lime-500 pl-1">Air Superiority</div>
          </Match>
          {/* <Match
            when={destruction_battle?.air_base_attack.air_superiority == 2}
          >
            <div class="text-grey-500 pl-1">Air Parity</div>
          </Match>
          <Match
            when={destruction_battle?.air_base_attack.air_superiority == 3}
          >
            <div class="text-red-500 pl-1">Air Denial</div>
          </Match> */}
          <Match
            when={destruction_battle?.air_base_attack.air_superiority == 4}
          >
            <div class="text-red-500 pl-1">Air Incapability</div>
          </Match>
        </Switch>
      </>
    );
  };

  const display_touch = () => {
    const destruction_battle = props.cell()?.destruction_battle;
    const f_touch_plane =
      destruction_battle?.air_base_attack.f_damage.touch_plane ?? 0;
    const e_touch_plane =
      destruction_battle?.air_base_attack.e_damage.touch_plane ?? 0;
    return (
      <>
        touch : <span class="w-1" />
        <div class="w-6 flex justify-center">
          <Show when={f_touch_plane > 0} fallback={<div>_</div>}>
            <WrapCIMstEquipComponent e_flag={false} si={f_touch_plane} />
          </Show>
        </div>
        <div class="w-3 text-center">/</div>
        <div class="w-6 flex justify-center">
          <Show when={e_touch_plane > 0} fallback={<div>_</div>}>
            <WrapCIMstEquipComponent e_flag={true} si={e_touch_plane} />
          </Show>
        </div>
      </>
    );
  };

  const base_attacker_planes = () => {
    const base_ids = Object.keys(
      props.cell()?.destruction_battle?.air_base_attack.map_squadron_plane ?? {}
    );
    return (
      <td>
        <div class="flex flex-col">
          <For each={base_ids}>
            {(base_id) => (
              <For
                each={
                  air_bases.bases[(props.area_id << 16) | Number(base_id)]
                    ?.plane_info
                }
              >
                {(plane, idx) => (
                  <>
                    <Show when={plane != null}>
                      <Show when={idx() > 0}>
                        <div class="h-px" />
                      </Show>
                      <WrapOwnPlaneEquipComponent si={plane.slotid} />
                    </Show>
                  </>
                )}
              </For>
            )}
          </For>
        </div>
      </td>
    );
  };

  const e_defenser_ships = () => {
    const destruction_battle = props.cell()?.destruction_battle;
    return (
      <td>
        <For each={destruction_battle?.air_base_attack.e_damage.damages}>
          {(_, idx) => (
            <>
              <Show when={show_damage()[0][idx()]}>
                <Show when={idx() > 0}>
                  <div class="h-px" />
                </Show>
                <div class="flex flex-nowrap">
                  <WrapNumberedEnemyShipComponent
                    ship_idx={idx()}
                    battle_selected={() => undefined}
                    combined_flag={false}
                    store_data_set_param_ship={props.store_data_set_param_ship}
                  />
                </div>
              </Show>
            </>
          )}
        </For>
      </td>
    );
  };

  const e_defenser_hps = () => {
    const destruction_battle = props.cell()?.destruction_battle;
    return (
      <td>
        <div class="flex flex-col">
          <For each={destruction_battle?.air_base_attack.e_damage.damages}>
            {(_, idx) => (
              <>
                <Show when={show_damage()[0][idx()]}>
                  <Show when={idx() > 0}>
                    <div class="h-px" />
                  </Show>
                  <WrapEnemyShipHPComponent
                    e_now_hps={
                      destruction_battle?.air_base_attack.e_damage.now_hps
                    }
                    idx={idx()}
                    store_data_set_param_ship={props.store_data_set_param_ship}
                  />
                </Show>
              </>
            )}
          </For>
        </div>
      </td>
    );
  };

  const e_defenser_damages = () => {
    const destruction_battle = props.cell()?.destruction_battle;
    return (
      <td>
        <For each={destruction_battle?.air_base_attack.e_damage.damages}>
          {(dmg, dmg_index) => (
            <>
              <Show when={show_damage()[0][dmg_index()]}>
                <Show when={dmg_index() > 0}>
                  <div class="h-px" />
                </Show>
                <div
                  class={`text-sm my-auto ${calc_critical(
                    dmg,
                    destruction_battle?.air_base_attack.e_damage.cl?.[
                      dmg_index()
                    ]
                  )}`}
                >
                  {dmg}
                </div>
              </Show>
            </>
          )}
        </For>
      </td>
    );
  };

  const e_attacker_ships = () => {
    const destruction_battle = props.cell()?.destruction_battle;
    return (
      <td>
        <div class="flex flex-col">
          <For each={destruction_battle?.air_base_attack.e_damage.plane_from}>
            {(plane_flag, idx) => (
              <>
                <Show when={plane_flag != -1}>
                  <Show when={idx() > 0}>
                    <div class="h-px" />
                  </Show>
                  <div class="flex flex-nowrap">
                    <WrapNumberedEnemyShipComponent
                      ship_idx={idx()}
                      battle_selected={() => undefined}
                      combined_flag={false}
                      store_data_set_param_ship={
                        props.store_data_set_param_ship
                      }
                    />
                  </div>
                </Show>
              </>
            )}
          </For>
        </div>
      </td>
    );
  };

  const e_attacker_hps = () => {
    const destruction_battle = props.cell()?.destruction_battle;
    return (
      <td>
        <div class="flex flex-col">
          <For each={destruction_battle?.air_base_attack.e_damage.plane_from}>
            {(plane_flag, idx) => (
              <>
                <Show when={plane_flag != -1}>
                  <WrapEnemyShipHPComponent
                    e_now_hps={
                      destruction_battle?.air_base_attack.e_damage.now_hps
                    }
                    idx={idx()}
                    store_data_set_param_ship={props.store_data_set_param_ship}
                  />
                </Show>
              </>
            )}
          </For>
        </div>
      </td>
    );
  };

  const base_defenser_names = () => {
    const destruction_battle = props.cell()?.destruction_battle;
    return (
      <td>
        <For each={destruction_battle?.air_base_attack.f_damage.damages}>
          {(_, idx) => (
            <>
              <Show when={show_damage()[1][idx()]}>
                <Show when={idx() > 0}>
                  <div class="h-px" />
                </Show>
                <div class="flex flex-nowrap">
                  {air_bases.bases[(props.area_id << 16) | (idx() + 1)]?.name}
                </div>
              </Show>
            </>
          )}
        </For>
      </td>
    );
  };

  const base_defenser_hps = () => {
    const destruction_battle = props.cell()?.destruction_battle;
    return (
      <td>
        <div class="flex flex-col">
          <For
            each={destruction_battle?.air_base_attack.f_damage.damages ?? []}
          >
            {(_, idx) => (
              <>
                <Show when={show_damage()[1][idx()]}>
                  <WrapBaseHPComponent
                    max_hps={destruction_battle?.f_nowhps}
                    now_hps={
                      destruction_battle?.air_base_attack.f_damage.now_hps
                    }
                    idx={idx()}
                  />
                </Show>
              </>
            )}
          </For>
        </div>
      </td>
    );
  };

  const base_defenser_damages = () => {
    const destruction_battle = props.cell()?.destruction_battle;
    return (
      <td>
        <For each={destruction_battle?.air_base_attack.f_damage.damages}>
          {(dmg, dmg_index) => (
            <>
              <Show when={show_damage()[1][dmg_index()]}>
                <Show when={dmg_index() > 0}>
                  <div class="h-px" />
                </Show>
                <div
                  class={`text-sm my-auto ${calc_critical(
                    dmg,
                    destruction_battle?.air_base_attack.f_damage.cl?.[
                      dmg_index()
                    ]
                  )}`}
                >
                  {dmg}
                </div>
              </Show>
            </>
          )}
        </For>
      </td>
    );
  };

  return (
    <Show when={show_destruction_battle()}>
      <li>
        <details open={true}>
          <summary>Destruction Battle</summary>
          <div class="flex felx-nowrap text-xs py-0.5 pl-4">
            {display_formation()}
            <div class="divider divider-horizontal mr-0 ml-0" />
            {display_air_state()}
            <div class="divider divider-horizontal mr-0 ml-0" />
            {display_touch()}
          </div>
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
                <tr>
                  {base_attacker_planes()}
                  <td />
                  {e_defenser_ships()}
                  {e_defenser_hps()}
                  {e_defenser_damages()}
                </tr>
                <tr>
                  {e_attacker_ships()}
                  {e_attacker_hps()}
                  {base_defenser_names()}
                  {base_defenser_hps()}
                  {base_defenser_damages()}
                </tr>
              </tbody>
            </table>
          </ul>
        </details>
      </li>
    </Show>
  );
}
