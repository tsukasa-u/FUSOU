import { component$, useStyles$, useStore, useVisibleTask$ } from '@builder.io/qwik'
import globalStyles from './tailwind.css?inline';

import { IconResume } from './components/icons/resume.tsx';
import { IconFile } from './components/icons/file.tsx';
import { IconFolder } from './components/icons/folder.tsx';
import { IconImage } from './components/icons/image.tsx';

import { Deck } from './components/deck.tsx';
import { Dock } from './components/dock.tsx';
import { Expedition } from './components/expedition.tsx';
import { Task } from './components/task.tsx';

import { invoke } from '@tauri-apps/api/tauri'

// import 'tachyons';
import './app.css';

export const App = component$(() => {
  useStyles$(globalStyles);

  useVisibleTask$(() => {
    invoke('close_splashscreen')
  });

  const nDock = useStore([{ship_id: 1, complete_time: 1722010682963, counter: 0}, {ship_id: 2, complete_time: 1630000000000, counter: 0}, {ship_id: 3, complete_time: 1630000000000, counter: 0}]);
  const deck = useStore([{id: 1, ship: [1, 2, 3], mission: {mission_id: 0, complete_time: 0, counter: 0}}, {id: 2, ship: [1, 2, 3], mission: {mission_id: 0, complete_time: 0, counter: 0}}, {id: 3, ship: [1, 2, 3], mission: {mission_id: 0, complete_time: 0, counter: 0}}, {id: 4, ship: [1, 2, 3], mission: {mission_id: 0, complete_time: 0, counter: 0}}]);
  const ship = useStore({1: {ship_name: "Yamato", cond: 49, nowhp: 80, maxhp: 80, fuel: 100, max_fuel: 100}, 2: {ship_name: "Musashi", cond: 49, nowhp: 80, maxhp: 80, fuel: 100, max_fuel: 100}, 3: {ship_name: "Shinano", cond: 49, nowhp: 80, maxhp: 80, fuel: 100, max_fuel: 100}});

  return (
    <>
      <ul class="menu menu-xs bg-base-200 w-full pl-0 flex">
        <li>
          <details open>
            <summary>
              <IconFolder class="h-4 w-4" />
              Fleets
            </summary>
            <ul class="pl-0">
              {/* <Deck deckPort={ deck[1] } ships={ {1: ship} }> */}
              <Deck deckPort={ deck[1] } ships={ ship }>
                <IconFile class="h-4 w-4" q:slot='icon_fleet'/>
                {/* <IconFile class="h-4 w-4" q:slot='icon_ship' /> */}
              </Deck>
              <Deck deckPort={ deck[2] } ships={ ship }>
                <IconFile class="h-4 w-4" q:slot='icon_fleet'/>
                {/* <IconFile class="h-4 w-4" q:slot='icon_ship' /> */}
              </Deck>
              <Deck deckPort={ deck[3] } ships={ ship }>
                <IconFile class="h-4 w-4" q:slot='icon_fleet'/>
                {/* <IconFile class="h-4 w-4" q:slot='icon_ship' /> */}
              </Deck>
              <Deck deckPort={ deck[0]} ships={ ship }>
                <IconFile class="h-4 w-4" q:slot='icon_fleet'/>
                {/* <IconFile class="h-4 w-4" q:slot='icon_ship' /> */}
              </Deck>
            </ul>
          </details>
        </li>
        
        <Dock nDock={nDock} ships={{1: {ship_name: "Yamato", cond: 49, nowhp: 80, maxhp: 80, fuel: 100, max_fuel: 100}, 2: {ship_name: "Musashi", cond: 49, nowhp: 80, maxhp: 80, fuel: 100, max_fuel: 100}, 3: {ship_name: "Shinano", cond: 49, nowhp: 80, maxhp: 80, fuel: 100, max_fuel: 100}}}>
          <IconFolder class="h-4 w-4" q:slot='icon_dock'/>
        </Dock>

        <Expedition deckPort={ deck } >
          <IconFolder class="h-4 w-4" q:slot='icon_expedition'/>
        </Expedition>

        <Task>
          <IconFolder class="h-4 w-4" q:slot='icon_task'/>
        </Task>
        
      </ul>
    </>
  )
});