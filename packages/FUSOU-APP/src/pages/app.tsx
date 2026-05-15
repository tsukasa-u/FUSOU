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
      <svg class="h-full w-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M5 7a3 3 0 106 0 3 3 0 00-6 0zM13 9a3 3 0 106 0 3 3 0 00-6 0zM2 20a5 5 0 0110 0M12 20a5 5 0 0110 0" />
      </svg>
    ),
  },
  {
    key: "ship",
    label: "Ship Info",
    icon: () => (
      <svg class="h-full w-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M3 19h18l-2-4H5l-2 4zM8 15V7h8v8" />
      </svg>
    ),
  },
  {
    key: "equip",
    label: "Equip Info",
    icon: () => (
      <svg class="h-full w-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M21 3l-6 6M17 3l4 4M14 10l-9 9M3 21l4-1-3-3-1 4z" />
      </svg>
    ),
  },
  {
    key: "quest",
    label: "Quest Info",
    icon: () => (
      <svg class="h-full w-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M8 4h8l1 2h3v14H4V6h3l1-2zM8 13l2.5 2.5L15.5 10.5" />
      </svg>
    ),
  },
  {
    key: "data_collection",
    label: "Uploads",
    icon: () => (
      <svg class="h-full w-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M12 3C7.6 3 4 4.3 4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6c0-1.7-3.6-3-8-3zM4 12c0 1.7 3.6 3 8 3s8-1.3 8-3M4 6c0 1.7 3.6 3 8 3s8-1.3 8-3M12 9v6M9.5 12.5L12 15l2.5-2.5" />
      </svg>
    ),
  },
  {
    key: "settings",
    label: "Settings",
    icon: () => (
      <svg class="h-full w-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06A1.65 1.65 0 0015 19.4a1.65 1.65 0 00-1 .6 1.65 1.65 0 00-.33 1V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-.33-1 1.65 1.65 0 00-1-.6 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-.6-1 1.65 1.65 0 00-1-.33H3a2 2 0 010-4h.09a1.65 1.65 0 001-.33 1.65 1.65 0 00.6-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-.6 1.65 1.65 0 00.33-1V3a2 2 0 014 0v.09a1.65 1.65 0 00.33 1 1.65 1.65 0 001 .6 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9c.27.3.47.66.6 1 .13.34.2.7.2 1.09s-.07.75-.2 1.09c-.13.34-.33.7-.6 1z" />
      </svg>
    ),
  },
  {
    key: "logs",
    label: "Logs",
    icon: () => (
      <svg class="h-full w-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M6 3h9l3 3v15H6V3zM9 10h6M9 14h6M9 18h4" />
      </svg>
    ),
  },
  {
    key: "policy",
    label: "Policy",
    icon: () => (
      <svg class="h-full w-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M12 3l8 4v6c0 5-3.5 7.5-8 8-4.5-.5-8-3-8-8V7l8-4zM9.5 12.5l2 2 3.5-3.5" />
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
                <button type="button" class="tab flex-none px-2 sm:px-3 gap-1">
                  <span class="h-4 w-4">{tab.icon()}</span>
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div
            role="tablist"
            class="tabs tabs-border tabs-sm bg-base-100 whitespace-nowrap overflow-hidden"
          >
            {TAB_DEFINITIONS.map((tab) => {
              const isActive = activeTab() === tab.key;
              const compact = compactTabs();
              return (
                <button
                  role="tab"
                  class={`tab min-w-0 ${
                    compact
                      ? isActive
                        ? "flex-none px-2 sm:px-2.5 gap-1"
                        : "flex-none w-7 min-w-7 px-0 gap-0"
                      : "flex-none px-2 sm:px-3 gap-1"
                  } ${isActive ? "tab-active" : ""}`}
                  onClick={() => setActiveTab(tab.key)}
                  title={tab.label}
                >
                  <span class={compact && !isActive ? "h-3.5 w-3.5" : "h-4 w-4"}>
                    {tab.icon()}
                  </span>
                  {(!compact || isActive) && (
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
