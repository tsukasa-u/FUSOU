import { component$, useStyles$, useStore, useVisibleTask$, useTask$ } from '@builder.io/qwik'
import globalStyles from './tailwind.css?inline';

import { IconResume } from './components/icons/resume.tsx';
import { IconFile } from './components/icons/file.tsx';
import { IconFolder } from './components/icons/folder.tsx';
import { IconImage } from './components/icons/image.tsx';

import { Decks } from './components/decks.tsx';
import { Dock } from './components/dock.tsx';
import { Expedition } from './components/expedition.tsx';
import { Task } from './components/task.tsx';
import { Material } from './components/materials.tsx';

import { global_materials, global_ship, global_nDock, global_deck_port } from './components/interface/port.ts';
import { Materials, DeckPorts, Ships } from './components/interface/port.ts';

import { MstShips, MstSlotitems } from './components/interface/get_data.ts';
import { global_mst_ships, global_mst_slot_items } from './components/interface/get_data.ts';

import { SlotItems } from './components/interface/require_info.ts';
import { global_slotitems } from './components/interface/require_info.ts';

import { invoke } from '@tauri-apps/api/tauri'

// import 'tachyons';
import './app.css';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { Settings } from './components/settings.tsx';

function mergeObjects<T>(source: T, target: T): void {
  if (typeof source !== 'object' || source === null || typeof target !== 'object' || target === null) {
      return;
  }

  Object.keys(source).forEach(key => {
      const sourceValue = (source as any)[key];
      const targetValue = (target as any)[key];

      if (Array.isArray(sourceValue)) {
          if (sourceValue !== null) {
              (target as any)[key] = sourceValue;
          }
      } else if (typeof sourceValue === 'object' && sourceValue !== null) {
          if (typeof targetValue !== 'object' || targetValue === null) {
              (target as any)[key] = {};
          }
          mergeObjects(sourceValue, (target as any)[key]);
      } else if (sourceValue !== null) {
          (target as any)[key] = sourceValue;
      }
  });
}

export const App = component$(() => {
  useStyles$(globalStyles);

  useVisibleTask$(() => {
    invoke('close_splashscreen')
  });

  // let nDock = useStore(global_nDock);
  let deck = useStore(global_deck_port);
  let ships = useStore(global_ship);
  // let slot_items = global_slotitems;
  let slot_items = useStore(global_slotitems);
  let materials = useStore(global_materials);
  // let mst_ships = global_mst_ships;
  let mst_ships = useStore(global_mst_ships);
  // let mst_slot_items = global_mst_slot_items;
  let mst_slot_items = useStore(global_mst_slot_items);

  useTask$(({ cleanup }) => {
    let unlisten_set_kcs_materials: UnlistenFn;
    let unlisten_set_kcs_deck: UnlistenFn;
    let unlisten_set_kcs_ships: UnlistenFn;
    let unlisten_add_kcs_ships: UnlistenFn;
    let unlisten_set_kcs_slot_items: UnlistenFn;
    let unlisten_set_kcs_mst_ships: UnlistenFn;
    let unlisten_set_kcs_mst_slot_items: UnlistenFn;

    (async() => {
      unlisten_set_kcs_materials = await listen<Materials>('set-kcs-materials', event => {
        materials.materials = event.payload.materials;
        // console.log(materials);
      });
      unlisten_set_kcs_deck = await listen<DeckPorts>('set-kcs-deck-ports', event => {
        deck.deck_ports = event.payload.deck_ports;
        // console.log(deck);
      });
      unlisten_set_kcs_ships = await listen<Ships>('set-kcs-ships', event => {
        ships.ships = event.payload.ships;
        // console.log(ships);
      });
      unlisten_add_kcs_ships = await listen<Ships>('add-kcs-ships', event => {
        mergeObjects(event.payload.ships, ships.ships);
        // console.log(ships);
      });
      unlisten_set_kcs_mst_ships = await listen<MstShips>('set-kcs-mst-ships', event => {
        mst_ships.mst_ships = event.payload.mst_ships;
        // console.log(mst_ships);
      });
      unlisten_set_kcs_slot_items = await listen<SlotItems>('set-kcs-slot-items', event => {
        slot_items.slot_items = event.payload.slot_items;
        // console.log(slot_items);
      });
      unlisten_set_kcs_mst_slot_items = await listen<MstSlotitems>('set-kcs-mst-slot-items', event => {
        mst_slot_items.mst_slot_items = event.payload.mst_slot_items;
        // console.log(mst_slot_items);
      });
    })();

    cleanup(() => {
        if (unlisten_set_kcs_materials) unlisten_set_kcs_materials();
        if (unlisten_set_kcs_deck) unlisten_set_kcs_deck();
        if (unlisten_set_kcs_ships) unlisten_set_kcs_ships();
        if (unlisten_set_kcs_mst_ships) unlisten_set_kcs_mst_ships();
        if (unlisten_add_kcs_ships) unlisten_add_kcs_ships();
        if (unlisten_set_kcs_slot_items) unlisten_set_kcs_slot_items();
        if (unlisten_set_kcs_mst_slot_items) unlisten_set_kcs_mst_slot_items();
    });
  });

  return (
    <>
      <div class=" bg-base-200 h-screen">
        <div role="tablist" class="tabs tabs-bordered tabs-sm">
          <input type="radio" name="tabs_fleet" role="tab" class="tab [&::after]:w-16 bg-base-200 fixed" aria-label="Fleet Info" style={{"top":"0px", "left":"0px", "z-index":"100"}} defaultChecked />
          <div role="tabpanel" class="tab-content p-0 h-full">
            
            <div class="h-6"></div>

            <ul class="menu menu-xs bg-base-200 w-full pl-0 flex pt-0">
              <Material materials={materials}>
                <IconFolder class="h-4 w-4" q:slot='icon_material'/>
                <IconFile class="h-4 w-4" q:slot='icon_material_fuel'/>
                <IconFile class="h-4 w-4" q:slot='icon_material_bull'/>
                <IconFile class="h-4 w-4" q:slot='icon_material_steel'/>
                <IconFile class="h-4 w-4" q:slot='icon_material_bauxite'/>
                <IconFile class="h-4 w-4" q:slot='icon_material_bucket'/>
                <IconFile class="h-4 w-4" q:slot='icon_material_nail'/>
                <IconFile class="h-4 w-4" q:slot='icon_material_barnar'/>
                <IconFile class="h-4 w-4" q:slot='icon_material_screw'/>
              </Material>

              <Decks decks={deck} ships={ships} mst_ships={mst_ships} slot_items={global_slotitems} mst_slot_items={mst_slot_items}>
                <IconFolder class="h-4 w-4" q:slot='icon_fleets'/>
                <IconFile class="h-4 w-4" q:slot='icon_fleet1'/>
                <IconFile class="h-4 w-4" q:slot='icon_fleet2'/>
                <IconFile class="h-4 w-4" q:slot='icon_fleet3'/>
                <IconFile class="h-4 w-4" q:slot='icon_fleet4'/>
              </Decks>
              
              {/* <Dock nDock={nDock} ships={ships} mst_ships={mst_ships}>
                <IconFolder class="h-4 w-4" q:slot='icon_dock'/>
              </Dock> */}

              {/* <Expedition deckPort={deck} >
                <IconFolder class="h-4 w-4" q:slot='icon_expedition'/>
              </Expedition> */}

              {/* <Task>
                <IconFolder class="h-4 w-4" q:slot='icon_task'/>
              </Task> */}
              <div class="min-h-min"></div>
              
            </ul>
          </div>

          <input type="radio" name="tabs_fleet" role="tab" class="tab [&::after]:w-14 bg-base-200 fixed" aria-label="Ship Info" style={{"top":"0px", "left":"88px", "z-index":"100"}} />
          <div role="tabpanel" class="tab-content pt-0 pb-0 pl-0 bg-base-200">
          <div class="h-6"></div>
            under construction
          </div>
      
          <input type="radio" name="tabs_fleet" role="tab" class="tab [&::after]:w-14 bg-base-200 fixed" aria-label="Equi Info" style={{"top":"0px", "left":"168px", "z-index":"100"}} />
          <div role="tabpanel" class="tab-content pt-0 pb-0 pl-0 bg-base-200">
            <div class="h-6"></div>
              under construction
          </div>

          <input type="radio" name="tabs_fleet" role="tab" class="tab [&::after]:w-14 bg-base-200 fixed" aria-label="Settings" style={{"top":"0px", "left":"248px", "z-index":"100"}} />
          <div role="tabpanel" class="tab-content pt-0 pb-0 pl-0 bg-base-200">
            <div class="h-6"></div>
            <Settings></Settings>
          </div>
        </div>
      </div>
    </>
  )
});