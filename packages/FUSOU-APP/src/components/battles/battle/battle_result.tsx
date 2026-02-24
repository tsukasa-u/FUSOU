import { createMemo, Show } from "solid-js";

import type { Battle } from "@ipc-bindings/battle";
import { WrapDropShipComponent } from "../wrap_web_component";

interface BattleResultProps {
  battle_selected: () => Battle | undefined;
}

export function BattleResultComponent(props: BattleResultProps) {
  const show_battle_result = createMemo(() => {
    if (!props.battle_selected()) return false;
    if (!props.battle_selected()?.battle_result) return false;
    return true;
  });

  const show_landing_hp = createMemo<boolean>(() => {
    if (!props.battle_selected()) return false;
    if (!props.battle_selected()?.battle_result) return false;
    if (!props.battle_selected()?.battle_result?.landing_hp_max) return false;
    if (!props.battle_selected()?.battle_result?.landing_hp_now) return false;
    // if (props.battle_selected()?.battle_result?.landing_sub_value) return false;
    return true;
  });

  const get_drop_ship = () => {
    const drop_ship_id = props.battle_selected()?.battle_result?.drop_ship_id;
    if (!drop_ship_id) return <> </>;
    return <WrapDropShipComponent ship_id={drop_ship_id} />;
  };

  return (
    <Show when={show_battle_result()}>
      <li>
        <details open={true}>
          <summary>Battle Result</summary>
          <ul class="pl-0">
            <div class="pl-2 text-xs flex flex-nowrap items-center">
              Win Rank: {props.battle_selected()?.battle_result?.win_rank}
              <div class="divider divider-horizontal mr-0 ml-0" />
              Drop: <div class="px-2">{get_drop_ship()}</div>
              <Show when={show_landing_hp()}>
                <div class="divider divider-horizontal mr-0 ml-0" />
                Landing HP:{" "}
                {props.battle_selected()?.battle_result?.landing_hp_now} /{" "}
                {props.battle_selected()?.battle_result?.landing_hp_max}
                <Show
                  when={
                    props.battle_selected()?.battle_result?.landing_sub_value
                  }
                >
                  <div class="divider divider-horizontal mr-0 ml-0" />
                  Sub Value:{" "}
                  {props.battle_selected()?.battle_result?.landing_sub_value}
                </Show>
              </Show>
            </div>
          </ul>
        </details>
      </li>
    </Show>
  );
}
