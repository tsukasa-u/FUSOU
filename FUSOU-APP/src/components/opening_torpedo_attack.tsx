// import { useBattles, useCells } from '../utility/provider';
// import { ShipNameComponent } from './ship_name';

// import { Accessor, createMemo, For, Show } from 'solid-js';

// import "../css/divider.css";
// import { EnemyNameComponent } from './enemy_name';
// import { Battle } from '../interface/battle';

// interface TorpedoSubmarineProps {
//     deck_ship_id: Accessor<{ [key: number]: number[] }>;
//     battle_selected: Accessor<Battle>;
//     cell_index_selected: Accessor<number>;
// }

// export function OpeningTorpedoAttackComponent({deck_ship_id, battle_selected, cell_index_selected}: TorpedoSubmarineProps) {

//     const [battles, ] = useBattles();
//     const [cells, ] = useCells();
    
//     const show_torpedo_attack = createMemo<boolean>(() => {
//         console.log(battles.battles[cells.cell_index[cell_index_selected()]]);
//         if (battles.cells.length == 0) return false;
//         if (battles.cells.find((cell) => cell == cells.cell_index[cell_index_selected()]) == undefined) return false;
//         if (battles.battles[cells.cell_index[cell_index_selected()]].opening_raigeki == null) return false;
//         if (battles.battles[cells.cell_index[cell_index_selected()]].opening_raigeki.frai.find((val) => val==-1) == undefined) return false;
//         if (battles.battles[cells.cell_index[cell_index_selected()]].opening_raigeki.erai.find((val) => val==-1) == undefined) return false;
//         return true;
//     });

//     return (
//         <Show when={show_torpedo_attack()}>
//             <li>
//                 <details open={true}>
//                     <summary>
//                         Opening Torpedo Attack
//                     </summary>
//                     <ul class="pl-0">
//                         <table class="table table-xs">
//                             <thead>
//                                 <tr>
//                                     <th>From</th>
//                                     <th>To</th>
//                                     <th>Attack</th>
//                                 </tr>
//                             </thead>
//                             <tbody>
//                                 <For each={battle_selected().opening_raigeki.frai}>
//                                     {(frai, frai_index) => (
//                                         <Show when={frai != -1}>
//                                             <tr>
//                                                 <td>
//                                                     <ShipNameComponent ship_id={deck_ship_id()[1][frai_index()]}></ShipNameComponent>
//                                                 </td>
//                                                 <td>
//                                                     <EnemyNameComponent ship_id={battle_selected().enemy_ship_id[frai]}></EnemyNameComponent>
//                                                 </td>
//                                                 <td >
//                                                     <div class={
//                                                         (() => {
//                                                             let cl_flag = battle_selected().opening_raigeki.fcl[frai_index()];
//                                                             if (cl_flag==0) {
//                                                                 return "text-red-500";
//                                                             } else if (cl_flag==1) {
//                                                                 return "text-yellow-500";
//                                                             } else if (cl_flag==2) {
//                                                                 return "text-yellow-500";
//                                                             }
//                                                         })()
//                                                     }>{battle_selected().opening_raigeki.fdam[frai_index()]}</div>
//                                                 </td>
//                                             </tr>
//                                         </Show>
//                                     )}
//                                 </For>
//                                 <For each={battle_selected().opening_raigeki.erai}>
//                                     {(erai, erai_index) => (
//                                         <Show when={erai != -1}>
//                                             <tr>
//                                                 <td>
//                                                     <ShipNameComponent ship_id={deck_ship_id()[1][erai]}></ShipNameComponent>
//                                                 </td>
//                                                 <td>
//                                                     <EnemyNameComponent ship_id={battle_selected().enemy_ship_id[erai_index()]}></EnemyNameComponent>
//                                                 </td>
//                                                 <td >
//                                                     <div class={
//                                                         (() => {
//                                                             let cl_flag = battle_selected().opening_raigeki.ecl[erai_index()];
//                                                             if (cl_flag==0) {
//                                                                 return "text-red-500";
//                                                             } else if (cl_flag==1) {
//                                                                 return "text-yellow-500";
//                                                             } else if (cl_flag==2) {
//                                                                 return "text-yellow-500";
//                                                             }
//                                                         })()
//                                                     }>{battle_selected().opening_raigeki.edam[erai_index()]}</div>
//                                                 </td>
//                                             </tr>
//                                         </Show>
//                                     )}
//                                 </For>
//                             </tbody>
//                         </table>
//                     </ul>
//                 </details>
//             </li>
//         </Show>
//     );
// }