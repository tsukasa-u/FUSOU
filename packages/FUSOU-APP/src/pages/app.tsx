import type { JSX } from "solid-js";
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
import { createEffect, createSignal, For } from "solid-js";
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
};

const TAB_DEFINITIONS: TabDefinition[] = [
  { key: "fleet", label: "Fleet" },
  { key: "ship", label: "Ship" },
  { key: "equip", label: "Equip" },
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
                  <DeckPortsProvider>
                    <AirBasesPortsProvider>
                      <DeckBattlesProvider>
                        <AirBasesBattlesProvider>
                          <CellsContextProvider>
                            <QuestsProvider>{props.children}</QuestsProvider>
                          </CellsContextProvider>
                        </AirBasesBattlesProvider>
                      </DeckBattlesProvider>
                    </AirBasesPortsProvider>
                  </DeckPortsProvider>
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
  const [activeTab, setActiveTab] = createSignal<AppTabKey>("fleet");

  return (
    <AppProviders>
      <div class="sticky top-0 z-100 border-b border-base-300 bg-base-100">
        <div
          role="tablist"
          class="tabs tabs-border tabs-sm bg-base-100 flex-wrap"
        >
          <For each={TAB_DEFINITIONS}>
            {(tab) => {
              const isActive = activeTab() === tab.key;
              return (
                <button
                  role="tab"
                  class={`tab${isActive ? " tab-active" : ""}`}
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
            <MaterialsComponent />
            <DecksComponent />
            <AirBasesComponent />
            <BattlesComponent />
            <div class="min-h-min min-w-min" />
          </ul>
        </div>
      </div>

      <div class={activeTab() === "ship" ? "block" : "hidden"}>
        <div class="pt-0 pb-0 pl-0 bg-base-100">
          <ShipListComponent />
        </div>
      </div>

      <div class={activeTab() === "equip" ? "block" : "hidden"}>
        <div class="pt-0 pb-0 pl-0 bg-base-100">
          <EquipmentListComponent />
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
    </AppProviders>
  );
}

export default App;
