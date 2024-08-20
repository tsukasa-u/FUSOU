import { component$, useSignal, Slot } from '@builder.io/qwik'
import { Accordion } from '@qwik-ui/headless';
import { LuChevronDown } from '@qwikest/icons/lucide';

// import '@blueprintui/themes/compact/index.min.css';
// import '@blueprintui/themes/dark/index.min.css';

// import '@primer/css/utilities/index.scss';

// import '@blueprintui/themes/index.min.css';

import '@blueprintui/components/include/divider.js';
import '@blueprintui/components/include/tree.js';
import '@blueprintui/icons/include.js';
import '@blueprintui/icons/shapes/user.js';
import '@blueprintui/components/include/progress-bar.js';
import '@blueprintui/components/include/divider.js';

import 'tachyons';
import './app.css';

// import "open-props/postcss/style";

// /* optional imports that use the props */
// import "open-props/postcss/normalize";
// import "open-props/postcss/buttons";
// import OpenProps from 'open-props'; // module
// import Colors from 'open-props/src/colors';

export const App = component$(() => {
  
  return (
    <>

  <bp-progress-bar value="75" class="hp-full"></bp-progress-bar>
  <bp-progress-bar value="75" class="slight-damage" ></bp-progress-bar>
  <bp-progress-bar value="75" class="half-damage"></bp-progress-bar>
  <bp-progress-bar value="75" class="heavy-damage"></bp-progress-bar>

      <bp-tree interaction="auto">
        <bp-tree-item interaction="auto" class="bt bl b--black-80" expanded>
          Fleet
          <bp-tree-item interaction="auto" class="bt bl b--black-40 ml2" expanded>
            1st Fleet
            <bp-tree-item class="bt bl b--black-20 ml2 h1_5">
              <span class="ml1"></span>
              <div class=" w-40 fusou-overflow f5">第三〇号海防艦</div>

              <div class="dt-columm w-20 h1">
                <hp class="w-10 f8">10/34</hp>
                <bp-progress-bar value="75" class="hp-full w-25 relative top-0_25"></bp-progress-bar>
              </div>
              <bp-progress-bar value="75" class="hp-full w-10"></bp-progress-bar>
              <bp-progress-bar value="75" class="hp-full w-10"></bp-progress-bar>
            </bp-tree-item>
            <bp-tree-item class="bt bl b--black-20 ml2"><span class="ml1"></span>五十鈴改二</bp-tree-item>
            <bp-tree-item class="bt bl b--black-20 ml2"><span class="ml1"></span>初月改二</bp-tree-item>
            <bp-tree-item class="bt bl b--black-20 ml2"><span class="ml1"></span>清霜改二丁</bp-tree-item>
            <bp-tree-item class="bt bl b--black-20 ml2"><span class="ml1"></span>長波改二</bp-tree-item>
            <bp-tree-item class="bt bl b--black-20 ml2"><span class="ml1"></span>ーー</bp-tree-item>
          </bp-tree-item>
          <bp-tree-item interaction="auto" class="bt bl b--black-40 ml2">
            2nd Fleet
            <bp-tree-item class="bt b--black-20 ml3">Item 2-1</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml3">Item 2-2</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml3">Item 2-3</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml3">Item 2-4</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml3">Item 2-5</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml3">Item 2-6</bp-tree-item>
          </bp-tree-item>
          <bp-tree-item interaction="auto" class="bt bl b--black-40 ml2">
            3rd Fleet
            <bp-tree-item class="bt b--black-20 ml3 h2">Item 3-1</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml3">Item 3-2</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml3">Item 3-3</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml3">Item 3-4</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml3">Item 3-5</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml3">Item 3-6</bp-tree-item>
          </bp-tree-item>
          <bp-tree-item interaction="auto" class="bt bl b--black-40 ml2">
            4th Fleet
            <bp-tree-item class="bt b--black-20 ml3">Item 4-1</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml3">Item 4-2</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml3">Item 4-3</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml3">Item 4-4</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml3">Item 4-5</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml3">Item 4-6</bp-tree-item>
          </bp-tree-item>
        </bp-tree-item>
        <bp-tree-item interaction="auto" class="bt b--black-80">
          Expedition
          <bp-tree-item class="bt b--black-40 ml3">Item 3-3-1</bp-tree-item>
          <bp-tree-item class="bt b--black-40 ml3">Item 3-3-2</bp-tree-item>
          <bp-tree-item class="bt b--black-40 ml3">Item 3-3-3</bp-tree-item>
        </bp-tree-item>
        <bp-tree-item interaction="auto" class="bt b--black-80">
          Repair
          <bp-tree-item class="bt b--black-40 ml3">Item 3-3-1</bp-tree-item>
          <bp-tree-item class="bt b--black-40 ml3">Item 3-3-2</bp-tree-item>
          <bp-tree-item class="bt b--black-40 ml3">Item 3-3-3</bp-tree-item>
        </bp-tree-item>
        <bp-tree-item interaction="auto" class="bt b--black-80">
          Task
          <bp-tree-item class="bt b--black-40 ml3">Item 3-3-1</bp-tree-item>
          <bp-tree-item class="bt b--black-40 ml3">Item 3-3-2</bp-tree-item>
          <bp-tree-item class="bt b--black-40 ml3">Item 3-3-3</bp-tree-item>
        </bp-tree-item>
        <bp-tree-item interaction="auto" class="bt b--black-80">
          Fleet
          <bp-tree-item interaction="auto" class="bt b--black-40 ml2" expanded>
            1st Fleet
            <bp-tree-item class="bt b--black-20 ml2"><span class="ml1"></span>夕張改二</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml2"><span class="ml1"></span>五十鈴改二</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml2"><span class="ml1"></span>初月改二</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml2"><span class="ml1"></span>清霜改二丁</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml2"><span class="ml1"></span>長波改二</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml2"><span class="ml1"></span>ーー</bp-tree-item>
          </bp-tree-item>
          <bp-tree-item interaction="auto" class="bt b--black-40 ml2">
            2
            <bp-tree-item class="bt b--black-20 ml3">Item 2-1</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml3">Item 2-2</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml3">Item 2-3</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml3">Item 2-4</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml3">Item 2-5</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml3">Item 2-6</bp-tree-item>
          </bp-tree-item>
          <bp-tree-item interaction="auto" class="bt b--black-40 ml2">
            3
            <bp-tree-item class="bt b--black-20 ml3">Item 3-1</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml3">Item 3-2</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml3">Item 3-3</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml3">Item 3-4</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml3">Item 3-5</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml3">Item 3-6</bp-tree-item>
          </bp-tree-item>
          <bp-tree-item interaction="auto" class="bt b--black-40 ml2">
            4
            <bp-tree-item class="bt b--black-20 ml3">Item 4-1</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml3">Item 4-2</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml3">Item 4-3</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml3">Item 4-4</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml3">Item 4-5</bp-tree-item>
            <bp-tree-item class="bt b--black-20 ml3">Item 4-6</bp-tree-item>
          </bp-tree-item>
        </bp-tree-item>
        
        <bp-tree-item interaction="auto" class="bt b--black-80">
          Map
          <bp-tree-item class="bt b--black-40 ml3">MAP</bp-tree-item>
        </bp-tree-item>
        <bp-tree-item interaction="auto" class="bt b--black-80">
          Log
          <bp-tree-item class="bt b--black-40 ml3">LOG</bp-tree-item>
        </bp-tree-item>
        
      </bp-tree>
      
      {/* <simple-greeting name="World"></simple-greeting> */}
    </>
  )
});
