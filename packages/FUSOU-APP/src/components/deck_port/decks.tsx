import { DeckComponent } from "./deck";
import { useDeckPorts } from "../../utility/provider";
import { createMemo, For } from "solid-js";
import {
  createConfigDisclosure,
  isFleetVisible,
  useUiConfig,
} from "../../utility/ui_config";

export function DecksComponent() {
  const fleet_name: { [key: number]: string } = {
    1: "First Fleet",
    2: "Second Fleet",
    3: "Third Fleet",
    4: "Fourth Fleet",
  };

  const uiConfig = useUiConfig();
  const [isOpen, onToggle] = createConfigDisclosure(
    () => uiConfig.fleet_tab.open_fleets,
  );
  const [decks] = useDeckPorts();

  const allDeckEntries = createMemo(() => Object.entries(decks.deck_ports));
  const visibleDeckEntries = createMemo(() =>
    allDeckEntries().filter(([id]) =>
      isFleetVisible(uiConfig.fleets, Number(id)),
    ),
  );

  return (
    <>
      <li>
        <details open={isOpen()} onToggle={onToggle}>
          <summary>Fleets</summary>
          <ul class="pl-0">
            <For
              each={visibleDeckEntries()}
              fallback={
                <li class="text-xs py-2">
                  {allDeckEntries().length > 0
                    ? "All fleets are hidden by UI config."
                    : "Loading Fleet Data ..."}
                </li>
              }
            >
              {(item) => (
                <>
                  <DeckComponent
                    deck_id={Number(item[0])}
                    fleet_name={fleet_name[Number(item[0])]}
                  />
                </>
              )}
            </For>
          </ul>
        </details>
      </li>
    </>
  );
}
