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

import { MstShips } from './components/interface/get_data.ts';
import { global_mst_ships } from './components/interface/get_data.ts';

import { invoke } from '@tauri-apps/api/tauri'

// import 'tachyons';
import './app.css';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { Deckss } from './components/deckss.tsx';

export const App = component$(() => {
  useStyles$(globalStyles);

  useVisibleTask$(() => {
    invoke('close_splashscreen')
  });

  let data = {}

  let nDock = useStore(global_nDock);
  let deck = useStore(global_deck_port);
  let ships = useStore(global_ship);
  let materials = useStore(global_materials);
  let mst_ships = useStore(global_mst_ships);

  useTask$(({ track, cleanup }) => {
    let unlisten_kcs_materials: UnlistenFn;
    let unlisten_kcs_deck: UnlistenFn;
    let unlisten_kcs_ships: UnlistenFn;
    let unlisten_kcs_mst_ships: UnlistenFn;

    (async() => {
      unlisten_kcs_materials = await listen<Materials>('set-kcs-materials', event => {
        // materials.materials = { ...materials.materials, ...event.payload.materials };
        materials.materials = event.payload.materials;
        // console.log("materials:", materials);
      });
      unlisten_kcs_deck = await listen<DeckPorts>('set-kcs-deck-ports', event => {
        // deck.deck_ports = { ...deck.deck_ports, ...event.payload.deck_ports };
        // Object.values(event.payload.deck_ports).forEach((deck_port) => {
          // deck.deck_ports[deck_port.id] = deck_port;
          // deck.deck_ports[deck_port.id].id = deck_port.id;
          // deck.deck_ports[deck_port.id].mission = deck_port.mission;
          // deck.deck_ports[deck_port.id].ship = deck_port.ship;
        // });
        deck.deck_ports = event.payload.deck_ports;
        // console.log("deck:", deck);
      });
      unlisten_kcs_ships = await listen<Ships>('set-kcs-ships', event => {
        // ships.ships = { ...ships.ships, ...event.payload.ships };
        ships.ships = event.payload.ships;
        // Object.values(event.payload.ships).forEach((ship) => {
        //   Object.entries(ship).forEach(([key, value]) => {
        //     ships.ships[ship.id][key] = value;
        //   });
          
          // ships.ships[ship.id] = ship;
        // });
        // console.log("ships:", ships);
        // console.log("ships:", ships.ships);
      });
      unlisten_kcs_mst_ships = await listen<MstShips>('set-kcs-mst-ships', event => {
        // mst_ships.mst_ships = { ...mst_ships.mst_ships, ...event.payload.mst_ships };
        mst_ships.mst_ships = event.payload.mst_ships;
        // console.log("mst_ships", mst_ships);
        // console.log("mst_ships", mst_ships.mst_ships);
      });

    })();

    cleanup(() => {
        if (unlisten_kcs_materials) unlisten_kcs_materials();
        if (unlisten_kcs_deck) unlisten_kcs_deck();
        if (unlisten_kcs_ships) unlisten_kcs_ships();
        if (unlisten_kcs_mst_ships) unlisten_kcs_mst_ships();
    });
  });

  return (
    <>
      <ul class="menu menu-xs bg-base-200 w-full pl-0 flex">
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

        <Decks decks={deck} ships={ships} mst_ships={mst_ships}>
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
        
      </ul>
    </>
  )
});