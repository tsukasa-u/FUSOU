import { DecksComponent } from "./../components/deck_port/decks.tsx";
import { SettingsComponent } from "../components/settings/settings.tsx";

import { MaterialsComponent } from "./../components/materials/materials.tsx";
import {
  AirBasesPortsProvider,
  AirBasesBattlesProvider,
  CellsContextProvider,
  DeckPortsProvider,
  DeckBattlesProvider,
  MaterialsProvider,
  MstShipsProvider,
  MstSlotItemEquipTypesProvider,
  MstSlotItemsProvider,
  MstStypesProvider,
  ShipsProvider,
  SlotItemsProvider,
} from "./../utility/provider.tsx";
import { BattlesComponent } from "../components/battles/battles.tsx";
import { AirBasesComponent } from "../components/airbase/air_bases.tsx";
import { ShipListComponent } from "../components/specification_table/ship_list.tsx";
import { EquipmentListComponent } from "../components/specification_table/equipment_list.tsx";
import { createEffect } from "solid-js";
import { location_route } from "../utility/location";

function App() {
  createEffect(location_route);

  return (
    <>
      <div class="bg-base-100 fixed w-dvw h-[33px] border-b-1 border-base-300 z-99" />
      <div role="tablist" class="tabs tabs-border tabs-sm bg-base-100">
        <input
          type="radio"
          name="tabs_fleet"
          role="tab"
          class="tab [&::after]:w-18 bg-base-100"
          aria-label="Fleet Info"
          style={{
            position: "sticky",
            top: "0px",
            left: "0px",
            "z-index": "100",
            "border-radius": 0,
          }}
          checked={true}
        />
        <div role="tabpanel" class="tab-content p-0 h-full">
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
          class="tab [&::after]:w-18 bg-base-100"
          aria-label="Ship Info"
          style={{
            position: "sticky",
            top: "0px",
            left: "0px",
            "z-index": "100",
            "border-radius": 0,
          }}
        />
        <div role="tabpanel" class="tab-content pt-0 pb-0 pl-0 bg-base-100">
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
          class="tab [&::after]:w-18 bg-base-100"
          aria-label="Equip Info"
          style={{
            position: "sticky",
            top: "0px",
            left: "0px",
            "z-index": "100",
            "border-radius": 0,
          }}
        />
        <div role="tabpanel" class="tab-content pt-0 pb-0 pl-0 bg-base-100">
          <MstSlotItemsProvider>
            <SlotItemsProvider>
              {/* <ShipsProvider>
                  <MstShipsProvider>
                    <MstStypesProvider> */}
              <MstSlotItemEquipTypesProvider>
                <EquipmentListComponent />
              </MstSlotItemEquipTypesProvider>
              {/* </MstStypesProvider>
                  </MstShipsProvider>
                </ShipsProvider> */}
            </SlotItemsProvider>
          </MstSlotItemsProvider>
        </div>

        <input
          type="radio"
          name="tabs_fleet"
          role="tab"
          class="tab [&::after]:w-18 bg-base-100"
          aria-label="Settings"
          style={{
            position: "sticky",
            top: "0px",
            left: "0px",
            "z-index": "100",
            "border-radius": 0,
          }}
        />
        <div role="tabpanel" class="tab-content pt-0 pb-0 pl-0 bg-base-100">
          <SettingsComponent />
        </div>
      </div>
    </>
  );
}

export default App;
