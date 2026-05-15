import { DecksComponent } from "./../components/deck_port/decks.tsx";
import { SettingsComponent } from "../components/settings/settings.tsx";
import { DataCollectionStatusComponent } from "../components/settings/data_collection_status.tsx";

import { MaterialsComponent } from "./../components/materials/materials.tsx";
import { QuestsComponent } from "./../components/quests/quests.tsx";
import {
  AirBasesPortsProvider,
  AirBasesBattlesProvider,
  CellsContextProvider,
  DeckPortsProvider,
  DeckBattlesProvider,
  MaterialsProvider,
  MstSlotItemEquipTypesProvider,
  QuestsProvider,
  MstShipsProvider,
  MstSlotItemsProvider,
  MstStypesProvider,
  ShipsProvider,
  SlotItemsProvider,
} from "./../utility/provider.tsx";
import { BattlesComponent } from "../components/battles/battles.tsx";
import { AirBasesComponent } from "../components/airbase/air_bases.tsx";
import { ShipListComponent } from "../components/specification_table/ship_list.tsx";
import { EquipmentListComponent } from "../components/specification_table/equipment_list.tsx";
import { PolicyPanelComponent } from "../components/policy/policy_panel.tsx";
import {
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { location_route } from "../utility/location";
import { LogViewerComponent } from "../components/logger/log-viewer.tsx";

type AppTabKey =
  | "fleet"
  | "ship"
  | "equip"
  | "quest"
  | "data_collection"
  | "settings"
  | "logs"
  | "policy";

function App() {
  createEffect(location_route);
  const [activeTab, setActiveTab] = createSignal<AppTabKey>("fleet");
  const [canScrollLeft, setCanScrollLeft] = createSignal(false);
  const [canScrollRight, setCanScrollRight] = createSignal(false);
  let tabScrollContainer: HTMLDivElement | undefined;

  const updateTabScrollState = () => {
    if (!tabScrollContainer) return;
    const epsilon = 2;
    const maxLeft =
      tabScrollContainer.scrollWidth - tabScrollContainer.clientWidth - epsilon;
    setCanScrollLeft(tabScrollContainer.scrollLeft > epsilon);
    setCanScrollRight(tabScrollContainer.scrollLeft < maxLeft);
  };

  const scrollTabsBy = (deltaX: number) => {
    if (!tabScrollContainer) return;
    tabScrollContainer.scrollBy({ left: deltaX, behavior: "smooth" });
  };

  onMount(() => {
    const onScrollOrResize = () => updateTabScrollState();
    window.addEventListener("resize", onScrollOrResize);
    tabScrollContainer?.addEventListener("scroll", onScrollOrResize, {
      passive: true,
    });

    requestAnimationFrame(updateTabScrollState);

    onCleanup(() => {
      window.removeEventListener("resize", onScrollOrResize);
      tabScrollContainer?.removeEventListener("scroll", onScrollOrResize);
    });
  });

  createEffect(() => {
    activeTab();
    requestAnimationFrame(updateTabScrollState);
  });

  return (
    <>
      <div class="sticky top-0 z-100 border-b border-base-300 bg-base-100">
        <div class="flex items-center gap-1 px-1 py-0.5">
          <Show when={canScrollLeft() || canScrollRight()}>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              onClick={() => scrollTabsBy(-180)}
              disabled={!canScrollLeft()}
              aria-label="Scroll tabs left"
            >
              &lt;
            </button>
          </Show>

          <div
            ref={(el) => {
              tabScrollContainer = el;
            }}
            class="w-full min-w-0 flex-1 overflow-x-auto overflow-y-hidden scrollbar-hidden"
            data-tab-scroll-container
          >
        <div role="tablist" class="tabs tabs-border tabs-sm bg-base-100 whitespace-nowrap min-w-max w-max">
          <button
            role="tab"
            class={`tab px-3 ${activeTab() === "fleet" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("fleet")}
          >
            Fleet Info
          </button>
          <button
            role="tab"
            class={`tab px-3 ${activeTab() === "ship" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("ship")}
          >
            Ship Info
          </button>
          <button
            role="tab"
            class={`tab px-3 ${activeTab() === "equip" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("equip")}
          >
            Equip Info
          </button>
          <button
            role="tab"
            class={`tab px-3 ${activeTab() === "quest" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("quest")}
          >
            Quest Info
          </button>
          <button
            role="tab"
            class={`tab px-3 ${activeTab() === "data_collection" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("data_collection")}
          >
            Data Collection
          </button>
          <button
            role="tab"
            class={`tab px-3 ${activeTab() === "settings" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("settings")}
          >
            Settings
          </button>
          <button
            role="tab"
            class={`tab px-3 ${activeTab() === "logs" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("logs")}
          >
            Logs
          </button>
          <button
            role="tab"
            class={`tab px-3 ${activeTab() === "policy" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("policy")}
          >
            Policy
          </button>
        </div>
        </div>

          <Show when={canScrollLeft() || canScrollRight()}>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              onClick={() => scrollTabsBy(180)}
              disabled={!canScrollRight()}
              aria-label="Scroll tabs right"
            >
              &gt;
            </button>
          </Show>
        </div>
      </div>

      <div class={activeTab() === "fleet" ? "block" : "hidden"}>
        <div class="p-0 h-full">
          <ul class="menu menu-xs bg-base-100 w-full pl-0 flex pt-0">
            <MaterialsProvider>
              <MaterialsComponent />
            </MaterialsProvider>

            <MstSlotItemsProvider>
              <SlotItemsProvider>
                <ShipsProvider>
                  <MstShipsProvider>
                    <DeckPortsProvider>
                      <DecksComponent />
                      <AirBasesPortsProvider>
                        <AirBasesComponent />
                      </AirBasesPortsProvider>
                    </DeckPortsProvider>
                    <DeckBattlesProvider>
                      <AirBasesBattlesProvider>
                        <CellsContextProvider>
                          <BattlesComponent />
                        </CellsContextProvider>
                      </AirBasesBattlesProvider>
                    </DeckBattlesProvider>
                  </MstShipsProvider>
                </ShipsProvider>
              </SlotItemsProvider>
            </MstSlotItemsProvider>

            {/* <Dock nDock={nDock} ships={ships} mst_ships={mst_ships}>
                <IconFolder class="h-4 w-4" q:slot='icon_dock'/>
              </Dock> */}

            {/* <Expedition deckPort={deck} >
                <IconFolder class="h-4 w-4" q:slot='icon_expedition'/>
              </Expedition> */}

            {/* <Task>
                <IconFolder class="h-4 w-4" q:slot='icon_task'/>
              </Task> */}
            <div class="min-h-min min-w-min" />
          </ul>
        </div>
      </div>

      <div class={activeTab() === "ship" ? "block" : "hidden"}>
        <div class="pt-0 pb-0 pl-0 bg-base-100">
          <MstSlotItemsProvider>
            <SlotItemsProvider>
              <ShipsProvider>
                <MstShipsProvider>
                  <MstStypesProvider>
                    <ShipListComponent />
                  </MstStypesProvider>
                </MstShipsProvider>
              </ShipsProvider>
            </SlotItemsProvider>
          </MstSlotItemsProvider>
        </div>
      </div>

      <div class={activeTab() === "equip" ? "block" : "hidden"}>
        <div class="pt-0 pb-0 pl-0 bg-base-100">
          <MstSlotItemsProvider>
            <SlotItemsProvider>
              <MstSlotItemEquipTypesProvider>
                <EquipmentListComponent />
              </MstSlotItemEquipTypesProvider>
            </SlotItemsProvider>
          </MstSlotItemsProvider>
        </div>
      </div>

      <div class={activeTab() === "quest" ? "block" : "hidden"}>
        <div class="p-0 h-full">
          <ul class="menu menu-xs bg-base-100 w-full pl-0 flex pt-0">
            <QuestsProvider>
              <QuestsComponent />
            </QuestsProvider>
          </ul>
        </div>
      </div>

      <div class={activeTab() === "data_collection" ? "block" : "hidden"}>
        <div class="pt-0 pb-0 pl-0 bg-base-100">
          <DataCollectionStatusComponent />
        </div>
      </div>

      <div class={activeTab() === "settings" ? "block" : "hidden"}>
        <div class="pt-0 pb-0 pl-0 bg-base-100">
          <SettingsComponent />
        </div>
      </div>

      <div class={activeTab() === "logs" ? "block" : "hidden"}>
        <div class="pt-0 pb-0 pl-0 bg-base-100">
          <LogViewerComponent />
        </div>
      </div>

      <div class={activeTab() === "policy" ? "block" : "hidden"}>
        <div class="pt-0 pb-0 pl-0 bg-base-100">
          <PolicyPanelComponent />
        </div>
      </div>
    </>
  );
}

export default App;
