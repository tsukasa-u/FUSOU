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
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
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

type TabDefinition = {
  key: AppTabKey;
  label: string;
  icon: () => JSX.Element;
};

const TAB_DEFINITIONS: TabDefinition[] = [
  {
    key: "fleet",
    label: "Fleet Info",
    icon: () => (
      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M3 6h18M7 12h10M10 18h4" />
      </svg>
    ),
  },
  {
    key: "ship",
    label: "Ship Info",
    icon: () => (
      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M3 19h18l-2-4H5l-2 4zM8 15V7h8v8" />
      </svg>
    ),
  },
  {
    key: "equip",
    label: "Equip Info",
    icon: () => (
      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M14 4l6 6-8 8-6-6 8-8zM7 14l-3 6 6-3" />
      </svg>
    ),
  },
  {
    key: "quest",
    label: "Quest Info",
    icon: () => (
      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M9 11l3 3L22 4M2 12l5 5" />
      </svg>
    ),
  },
  {
    key: "data_collection",
    label: "Data Collection",
    icon: () => (
      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M4 4h16v16H4zM8 8h8M8 12h8M8 16h5" />
      </svg>
    ),
  },
  {
    key: "settings",
    label: "Settings",
    icon: () => (
      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06A1.65 1.65 0 0015 19.4a1.65 1.65 0 00-1 .6 1.65 1.65 0 00-.33 1V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-.33-1 1.65 1.65 0 00-1-.6 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-.6-1 1.65 1.65 0 00-1-.33H3a2 2 0 010-4h.09a1.65 1.65 0 001-.33 1.65 1.65 0 00.6-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-.6 1.65 1.65 0 00.33-1V3a2 2 0 014 0v.09a1.65 1.65 0 00.33 1 1.65 1.65 0 001 .6 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9c.27.3.47.66.6 1 .13.34.2.7.2 1.09s-.07.75-.2 1.09c-.13.34-.33.7-.6 1z" />
      </svg>
    ),
  },
  {
    key: "logs",
    label: "Logs",
    icon: () => (
      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M4 6h16M4 12h16M4 18h10" />
      </svg>
    ),
  },
  {
    key: "policy",
    label: "Policy",
    icon: () => (
      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M12 3l8 4v6c0 5-3.5 7.5-8 8-4.5-.5-8-3-8-8V7l8-4z" />
      </svg>
    ),
  },
];

function App() {
  createEffect(location_route);
  const [activeTab, setActiveTab] = createSignal<AppTabKey>("fleet");
  const [compactTabs, setCompactTabs] = createSignal(false);
  let tabContainer: HTMLDivElement | undefined;
  let tabMeasureList: HTMLDivElement | undefined;

  const updateCompactTabs = () => {
    if (!tabContainer || !tabMeasureList) return;
    const needsCompact = tabMeasureList.scrollWidth > tabContainer.clientWidth;
    setCompactTabs(needsCompact);
  };

  onMount(() => {
    const onResize = () => updateCompactTabs();
    const resizeObserver = new ResizeObserver(onResize);
    if (tabContainer) {
      resizeObserver.observe(tabContainer);
    }
    window.addEventListener("resize", onResize);

    requestAnimationFrame(updateCompactTabs);

    onCleanup(() => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", onResize);
    });
  });

  createEffect(() => {
    activeTab();
    requestAnimationFrame(updateCompactTabs);
  });

  return (
    <>
      <div class="sticky top-0 z-100 border-b border-base-300 bg-base-100">
        <div
          class="relative w-full"
          ref={(el) => {
            tabContainer = el;
          }}
        >
          <div
            class="pointer-events-none absolute left-0 top-0 h-0 overflow-hidden opacity-0"
            aria-hidden="true"
          >
            <div
              ref={(el) => {
                tabMeasureList = el;
              }}
              class="tabs tabs-border tabs-sm whitespace-nowrap min-w-max w-max"
            >
              {TAB_DEFINITIONS.map((tab) => (
                <button type="button" class="tab px-3">
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <div
            role="tablist"
            class="tabs tabs-border tabs-sm bg-base-100 whitespace-nowrap w-full overflow-hidden"
          >
            {TAB_DEFINITIONS.map((tab) => {
              const isActive = activeTab() === tab.key;
              return (
                <button
                  role="tab"
                  class={`tab px-2 sm:px-3 flex-1 min-w-0 gap-1 ${isActive ? "tab-active" : ""}`}
                  onClick={() => setActiveTab(tab.key)}
                  title={tab.label}
                >
                  {tab.icon()}
                  {(!compactTabs() || isActive) && (
                    <span class="truncate">{tab.label}</span>
                  )}
                </button>
              );
            })}
          </div>
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
