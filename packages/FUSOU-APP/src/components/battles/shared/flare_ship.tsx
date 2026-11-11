import { Show, type JSX } from "solid-js";
import type { Battle } from "@ipc-bindings/battle";
import type { DeckShipIds } from "../../../utility/battles";
import type {
  DataSetParamShip,
  DataSetShip,
} from "../../../utility/get_data_set";
import { EmptySlot } from "ui";
import {
  ConnectedEnemyShip,
  ConnectedNumberedEnemyShip,
  ConnectedNumberedFriendShip,
  ConnectedOwnShip,
} from "../connected_components";

interface FlareShipProps {
  flarePos?: readonly number[] | null;
  battle_selected: () => Battle | undefined;
  store_data_set_param_ship: () => DataSetParamShip;
  deck_ship_id?: () => DeckShipIds;
  store_data_set_deck_ship?: () => DataSetShip;
  isFriendlyForce?: boolean;
}

/**
 * Shared night battle flare ship indicator with locked width on both friendly and enemy slots.
 */
export function FlareShipComponent(props: FlareShipProps): JSX.Element {
  const fPos = () => props.flarePos?.[0] ?? -1;
  const ePos = () => props.flarePos?.[1] ?? -1;

  const emptyShip = () => (
    <EmptySlot
      kind="ship"
      size="xs"
      showLabel={true}
      labelWidthClass="flex-1"
      widthClass="w-full"
    />
  );

  return (
    <div class="inline-flex items-center shrink-0">
      <span>Flare :</span>
      <span class="w-1" />
      <div class="flex flex-nowrap items-center shrink-0">
        <div class="w-24 shrink-0 overflow-hidden flex items-center">
          <Show when={props.flarePos && fPos() !== -1} fallback={emptyShip()}>
            <Show
              when={props.isFriendlyForce}
              fallback={
                <Show
                  when={props.deck_ship_id && props.store_data_set_deck_ship}
                  fallback={emptyShip()}
                >
                  <ConnectedOwnShip
                    ship_idx={fPos()}
                    deck_ship_id={props.deck_ship_id!}
                    battle_selected={props.battle_selected}
                    store_data_set_deck_ship={props.store_data_set_deck_ship!}
                    name_flag={true}
                  />
                </Show>
              }
            >
              <ConnectedNumberedFriendShip
                ship_idx={fPos()}
                battle_selected={props.battle_selected}
                store_data_set_param_ship={props.store_data_set_param_ship}
              />
            </Show>
          </Show>
        </div>
        <div class="w-3 text-center shrink-0">/</div>
        <div class="w-24 shrink-0 overflow-hidden flex items-center">
          <Show when={props.flarePos && ePos() !== -1} fallback={emptyShip()}>
            <Show
              when={props.isFriendlyForce}
              fallback={
                <ConnectedEnemyShip
                  ship_idx={ePos()}
                  store_data_set_param_ship={props.store_data_set_param_ship}
                  name_flag={true}
                />
              }
            >
              <ConnectedNumberedEnemyShip
                ship_idx={ePos()}
                battle_selected={props.battle_selected}
                store_data_set_param_ship={props.store_data_set_param_ship}
              />
            </Show>
          </Show>
        </div>
      </div>
    </div>
  );
}
