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
import { createEffect } from "solid-js";
import { location_route } from "../utility/location";
import { LogViewerComponent } from "../components/logger/log-viewer.tsx";

function App() {
  createEffect(location_route);

  return (
    <>
      <div
        role="tablist"
        class="tabs tabs-border tabs-sm bg-base-100 grid grid-flow-col auto-cols-max overflow-x-auto"
      >
        <input
          type="radio"
          name="tabs_fleet"
          role="tab"
          class="tab whitespace-nowrap bg-base-100 px-3"
          aria-label="Fleet Info"
          checked={true}
        />
        <div role="tabpanel" class="tab-content col-span-full p-0 h-full">
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

        <input
          type="radio"
          name="tabs_fleet"
          role="tab"
          class="tab whitespace-nowrap bg-base-100 px-3"
          aria-label="Ship Info"
        />
        <div role="tabpanel" class="tab-content col-span-full pt-0 pb-0 pl-0 bg-base-100">
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

        <input
          type="radio"
          name="tabs_fleet"
          role="tab"
          class="tab whitespace-nowrap bg-base-100 px-3"
          aria-label="Equip Info"
        />
        <div role="tabpanel" class="tab-content col-span-full pt-0 pb-0 pl-0 bg-base-100">
          <MstSlotItemsProvider>
            <SlotItemsProvider>
              <MstSlotItemEquipTypesProvider>
                <EquipmentListComponent />
              </MstSlotItemEquipTypesProvider>
            </SlotItemsProvider>
          </MstSlotItemsProvider>
        </div>

        <input
          type="radio"
          name="tabs_fleet"
          role="tab"
          class="tab whitespace-nowrap bg-base-100 px-3"
          aria-label="Quest Info"
        />
        <div role="tabpanel" class="tab-content col-span-full p-0 h-full">
          <ul class="menu menu-xs bg-base-100 w-full pl-0 flex pt-0">
            <QuestsProvider>
              <QuestsComponent />
            </QuestsProvider>
          </ul>
        </div>

        <input
          type="radio"
          name="tabs_fleet"
          role="tab"
          class="tab whitespace-nowrap bg-base-100 px-3"
          aria-label="Data Collection"
        />
        <div role="tabpanel" class="tab-content col-span-full pt-0 pb-0 pl-0 bg-base-100">
          <DataCollectionStatusComponent />
        </div>

        <input
          type="radio"
          name="tabs_fleet"
          role="tab"
          class="tab whitespace-nowrap bg-base-100 px-3"
          aria-label="Settings"
        />
        <div role="tabpanel" class="tab-content col-span-full pt-0 pb-0 pl-0 bg-base-100">
          <SettingsComponent />
        </div>

        <input
          type="radio"
          name="tabs_fleet"
          role="tab"
          class="tab whitespace-nowrap bg-base-100 px-3"
          aria-label="Logs"
        />
        <div role="tabpanel" class="tab-content col-span-full pt-0 pb-0 pl-0 bg-base-100">
          <LogViewerComponent />
        </div>

        <input
          type="radio"
          name="tabs_fleet"
          role="tab"
          class="tab whitespace-nowrap bg-base-100 px-3"
          aria-label="Policy"
        />
        <div role="tabpanel" class="tab-content col-span-full pt-0 pb-0 pl-0 bg-base-100">
          <PolicyPanelComponent />
        </div>
      </div>
    </>
  );
}

export default App;
