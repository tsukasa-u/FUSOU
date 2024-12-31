import { DecksComponent } from './../components/decks.tsx';
import { SettingsComponent } from './../components/settings.tsx';


import { MaterialsComponent } from './../components/materials.tsx';
import { AirBasesProvider, BattleContextProvider, CellsContextProvider, DeckPortsProvider, MaterialsProvider, MstShipsProvider, MstSlotItemsProvider, ShipsProvider, SlotItemsProvider } from './../utility/provider.tsx';
import { BattlesComponent } from '../components/battles.tsx';
import { AirBasesComponent } from '../components/air_bases.tsx';

function App() {
  
  return (
    <>
      <div class=" bg-base-200 h-screen">
        <div role="tablist" class="tabs tabs-bordered tabs-sm">
          <div class="h-6 w-screen fixed bg-base-200 left-0 top-0 tab" style={{"z-index": "99"}}></div>

          <input type="radio" name="tabs_fleet" role="tab" class="tab [&::after]:w-18 bg-base-200 fixed" aria-label="Fleet Info" style={{"top":"0px", "left":"0px", "z-index":"100"}} checked={true}/>
          <div role="tabpanel" class="tab-content p-0 h-full">
            
            <div class="h-6"></div>

            <ul class="menu menu-xs bg-base-200 w-full pl-0 flex pt-0">
              <MaterialsProvider>
                <MaterialsComponent></MaterialsComponent>
              </MaterialsProvider>

              <MstSlotItemsProvider>
                <SlotItemsProvider>
                  <ShipsProvider>
                    <MstShipsProvider>
                      <DeckPortsProvider>
                        <DecksComponent />
                        <AirBasesProvider>
                          <AirBasesComponent />
                          <CellsContextProvider>
                            <BattleContextProvider>
                              <BattlesComponent />
                            </BattleContextProvider>
                          </CellsContextProvider>
                        </AirBasesProvider>
                      </DeckPortsProvider>
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
              <div class="min-h-min min-w-min"></div>
              
            </ul>
          </div>

          <input type="radio" name="tabs_fleet" role="tab" class="tab [&::after]:w-18 bg-base-200 fixed" aria-label="Ship Info" style={{"top":"0px", "left":"88px", "z-index":"100"}} />
          <div role="tabpanel" class="tab-content pt-0 pb-0 pl-0 bg-base-200">
          <div class="h-6"></div>
            under construction
          </div>
      
          <input type="radio" name="tabs_fleet" role="tab" class="tab [&::after]:w-18 bg-base-200 fixed" aria-label="Equip Info" style={{"top":"0px", "left":"168px", "z-index":"100"}} />
          <div role="tabpanel" class="tab-content pt-0 pb-0 pl-0 bg-base-200">
            <div class="h-6"></div>
              under construction
          </div>

          <input type="radio" name="tabs_fleet" role="tab" class="tab [&::after]:w-14 bg-base-200 fixed w-screen" aria-label="Settings" style={{"top":"0px", "left":"248px", "z-index":"100"}} />
          <div role="tabpanel" class="tab-content pt-0 pb-0 pl-0 bg-base-200">
            <div class="h-6"></div>
            <SettingsComponent></SettingsComponent>
          </div>
        </div>
      </div>
    </>
  );
}

export default App;