import type { JSX } from "solid-js";
import { DecksComponent } from "./../components/deck_port/decks.tsx";
import { SettingsComponent } from "../components/settings/settings.tsx";
import { DataCollectionStatusComponent } from "../components/settings/data_collection_status.tsx";

import { MaterialsComponent } from "./../components/materials/materials.tsx";
import { NDocksComponent } from "./../components/ndock/ndocks.tsx";
import { ItemsComponent } from "./../components/items/items.tsx";
import { QuestsComponent } from "./../components/quests/quests.tsx";
import {
  AirBasesPortsProvider,
  AirBasesBattlesProvider,
  CellsContextProvider,
  DeckPortsProvider,
  DeckBattlesProvider,
  MaterialsProvider,
  MstMissionsProvider,
  MstSlotItemEquipTypesProvider,
  MstUseItemMetasProvider,
  MstUseItemsProvider,
  NDocksProvider,
  PayItemsProvider,
  QuestsProvider,
  MstShipsProvider,
  MstSlotItemsProvider,
  MstStypesProvider,
  ShipsProvider,
  SlotItemsProvider,
  UseItemsProvider,
} from "./../utility/provider.tsx";
import { BattlesComponent } from "../components/battles/battles.tsx";
import { AirBasesComponent } from "../components/airbase/air_bases.tsx";
import { ShipListComponent } from "../components/specification_table/ship_list.tsx";
import { EquipmentListComponent } from "../components/specification_table/equipment_list.tsx";
import { PolicyPanelComponent } from "../components/policy/policy_panel.tsx";
import { createEffect, createMemo, createSignal, For, onMount, Show } from "solid-js";
import { location_route } from "../utility/location";
import { LogViewerComponent } from "../components/logger/log-viewer.tsx";
import { loadUiConfig, useUiConfig } from "../utility/ui_config.ts";

type AppTabKey =
  | "fleet"
  | "ship"
  | "equip"
  | "item"
  | "quest"
  | "data_collection"
  | "settings"
  | "logs"
  | "policy";

type TabDefinition = {
  key: AppTabKey;
  label: string;
};

const TAB_DEFINITIONS: TabDefinition[] = [
  { key: "fleet", label: "Fleet" },
  { key: "ship", label: "Ship" },
  { key: "equip", label: "Equip" },
  { key: "item", label: "Item" },
  { key: "quest", label: "Quest" },
  { key: "data_collection", label: "Uploads" },
  { key: "settings", label: "Settings" },
  { key: "logs", label: "Logs" },
  { key: "policy", label: "Policy" },
];

function AppProviders(props: { children: JSX.Element }) {
  return (
    <MaterialsProvider>
      <MstSlotItemsProvider>
        <SlotItemsProvider>
          <ShipsProvider>
            <MstShipsProvider>
              <MstStypesProvider>
                <MstSlotItemEquipTypesProvider>
                  <MstUseItemsProvider>
                    <MstUseItemMetasProvider>
                      <UseItemsProvider>
                        <PayItemsProvider>
                          <DeckPortsProvider>
                            <NDocksProvider>
                              <MstMissionsProvider>
                                <AirBasesPortsProvider>
                                  <DeckBattlesProvider>
                                    <AirBasesBattlesProvider>
                                      <CellsContextProvider>
                                        <QuestsProvider>
                                          {props.children}
                                        </QuestsProvider>
                                      </CellsContextProvider>
                                    </AirBasesBattlesProvider>
                                  </DeckBattlesProvider>
                                </AirBasesPortsProvider>
                              </MstMissionsProvider>
                            </NDocksProvider>
                          </DeckPortsProvider>
                        </PayItemsProvider>
                      </UseItemsProvider>
                    </MstUseItemMetasProvider>
                  </MstUseItemsProvider>
                </MstSlotItemEquipTypesProvider>
              </MstStypesProvider>
            </MstShipsProvider>
          </ShipsProvider>
        </SlotItemsProvider>
      </MstSlotItemsProvider>
    </MaterialsProvider>
  );
}

function App() {
  createEffect(location_route);
  const uiConfig = useUiConfig();
  const [activeTab, setActiveTab] = createSignal<AppTabKey>("fleet");

  onMount(() => {
    void loadUiConfig();
  });

  const isTabVisible = (key: AppTabKey): boolean => {
    switch (key) {
      case "fleet":
        return uiConfig.tabs.show_fleet;
      case "ship":
        return uiConfig.tabs.show_ship;
      case "equip":
        return uiConfig.tabs.show_equip;
      case "item":
        return uiConfig.tabs.show_item;
      case "quest":
        return uiConfig.tabs.show_quest;
      case "data_collection":
        return uiConfig.tabs.show_uploads;
      case "logs":
        return uiConfig.tabs.show_logs;
      case "policy":
        return uiConfig.tabs.show_policy;
      case "settings":
        return true;
    }
  };

  const visibleTabs = createMemo(() =>
    TAB_DEFINITIONS.filter((tab) => isTabVisible(tab.key)),
  );

  createEffect(() => {
    const visible = visibleTabs();
    if (!visible.some((tab) => tab.key === activeTab())) {
      setActiveTab(visible[0]?.key ?? "settings");
    }
  });

  const isViewportLockedTab = () =>
    activeTab() === "ship" || activeTab() === "equip" || activeTab() === "logs";

  return (
    <AppProviders>
      <div class={isViewportLockedTab() ? "h-full flex flex-col min-h-0" : ""}>
        <div class="sticky top-0 z-100 border-b border-base-300 bg-base-100 shrink-0">
          <div
            role="tablist"
            class="tabs tabs-border tabs-sm bg-base-100 flex-wrap"
          >
            <For each={visibleTabs()}>
              {(tab) => {
                return (
                  <button
                    role="tab"
                    class="tab"
                    classList={{ "tab-active": activeTab() === tab.key }}
                    aria-selected={activeTab() === tab.key}
                    onClick={() => setActiveTab(tab.key)}
                  >
                    {tab.label}
                  </button>
                );
              }}
            </For>
          </div>
        </div>

        <div class={activeTab() === "fleet" ? "block" : "hidden"}>
          <div class="p-0 h-full">
            <ul class="menu menu-xs bg-base-100 w-full pl-0 flex pt-0">
              <Show when={uiConfig.fleet_tab.show_materials}>
                <MaterialsComponent />
              </Show>
              <Show when={uiConfig.fleet_tab.show_fleets}>
                <DecksComponent />
              </Show>
              <Show when={uiConfig.fleet_tab.show_repair_docks}>
                <NDocksComponent />
              </Show>
              <Show when={uiConfig.fleet_tab.show_air_bases}>
                <AirBasesComponent />
              </Show>
              <Show when={uiConfig.fleet_tab.show_battles}>
                <BattlesComponent />
              </Show>
              <div class="min-h-min min-w-min" />
            </ul>
          </div>
        </div>

        <div
          class={
            activeTab() === "ship"
              ? "flex-1 min-h-0 flex flex-col bg-base-100"
              : "hidden"
          }
        >
          <div class="pt-0 pb-0 pl-0 bg-base-100 flex-1 min-h-0 flex flex-col">
            <ShipListComponent />
          </div>
        </div>

        <div
          class={
            activeTab() === "equip"
              ? "flex-1 min-h-0 flex flex-col bg-base-100"
              : "hidden"
          }
        >
          <div class="pt-0 pb-0 pl-0 bg-base-100 flex-1 min-h-0 flex flex-col">
            <EquipmentListComponent />
          </div>
        </div>

        <div class={activeTab() === "item" ? "block" : "hidden"}>
          <div class="p-0 h-full">
            <ul class="menu menu-xs bg-base-100 w-full pl-0 flex pt-0">
              <ItemsComponent />
            </ul>
          </div>
        </div>

        <div class={activeTab() === "quest" ? "block" : "hidden"}>
          <div class="p-0 h-full">
            <ul class="menu menu-xs bg-base-100 w-full pl-0 flex pt-0">
              <QuestsComponent />
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

        <div
          class={
            activeTab() === "logs"
              ? "flex-1 min-h-0 flex flex-col bg-base-100"
              : "hidden"
          }
        >
          <div class="pt-0 pb-0 pl-0 bg-base-100 flex-1 min-h-0 flex flex-col">
            <LogViewerComponent />
          </div>
        </div>

        <div class={activeTab() === "policy" ? "block" : "hidden"}>
          <div class="pt-0 pb-0 pl-0 bg-base-100">
            <PolicyPanelComponent />
          </div>
        </div>
      </div>
    </AppProviders>
  );
}

export default App;
