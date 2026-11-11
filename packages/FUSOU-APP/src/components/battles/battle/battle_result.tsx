import { createMemo, Show } from "solid-js";

import type { Battle } from "@ipc-bindings/battle";
import { EmptySlot } from "ui";
import { ConnectedDropShip } from "../connected_components";

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
    const battleResult = props.battle_selected()?.battle_result;
    if (!battleResult) return false;
    if (
      battleResult.landing_hp_max === null ||
      battleResult.landing_hp_max === undefined ||
      battleResult.landing_hp_max <= 0
    ) {
      return false;
    }
    if (
      battleResult.landing_hp_now === null ||
      battleResult.landing_hp_now === undefined
    ) {
      return false;
    }
    return true;
  });

  const drop_ship_id = () =>
    props.battle_selected()?.battle_result?.drop_ship_id;

  return (
    <Show when={show_battle_result()}>
      <li>
        <details open={true}>
          <summary>Battle Result</summary>
          <ul class="pl-0">
            <div class="pl-2 text-xs flex flex-nowrap items-center">
              <div class="w-18 shrink-0 tabular-nums">
                Win Rank: {props.battle_selected()?.battle_result?.win_rank}
              </div>
              <div class="divider divider-horizontal mr-0 ml-0 shrink-0" />
              <div class="inline-flex items-center shrink-0">
                <span>Drop:</span>
                <div class="w-28 shrink-0 overflow-hidden pl-2 flex items-center">
                  <Show
                    when={drop_ship_id()}
                    fallback={
                      <EmptySlot
                        kind="ship"
                        size="xs"
                        showLabel={true}
                        labelWidthClass="flex-1"
                        widthClass="w-full"
                        label="No ship drop"
                      />
                    }
                  >
                    <ConnectedDropShip ship_id={drop_ship_id()!} />
                  </Show>
                </div>
              </div>
              <Show when={show_landing_hp()}>
                <div class="divider divider-horizontal mr-0 ml-0 shrink-0" />
                <span class="shrink-0 tabular-nums">
                  Landing HP:{" "}
                  {props.battle_selected()?.battle_result?.landing_hp_now} /{" "}
                  {props.battle_selected()?.battle_result?.landing_hp_max}
                </span>
                <Show
                  when={
                    props.battle_selected()?.battle_result?.landing_sub_value
                  }
                >
                  <div class="divider divider-horizontal mr-0 ml-0 shrink-0" />
                  <span class="shrink-0 tabular-nums">
                    Sub Value:{" "}
                    {props.battle_selected()?.battle_result?.landing_sub_value}
                  </span>
                </Show>
              </Show>
            </div>
          </ul>
        </details>
      </li>
    </Show>
  );
}
