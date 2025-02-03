// import { Slot, component$, useStylesScoped$, useTask$ } from '@builder.io/qwik';

// import { NDocks, Ships } from "../interface/port.ts";
// import { MstShips } from '../interface/get_data.ts';

// interface NDockProps {
//     nDock: NDocks;
//     ships: Ships;
//     mst_ships: MstShips;
// }
 
// export const Dock = component$<NDockProps>(({ nDock , ships, mst_ships}) => {

//     useStylesScoped$(`
//         div::before, div::after {
//         //   background-color: red;
//           width: 1px;
//         }
//     `);

//     useTask$(() => {
//         const interval = setInterval(() => {
//             const now_date = Math.floor(Date.now());
//             nDock.n_docks.forEach((_, key) => {
//                 if (nDock.n_docks[key].complete_time < now_date) {
//                     nDock.n_docks[key].counter = 0;
//                 } else {
//                     nDock.n_docks[key].counter = nDock.n_docks[key].complete_time - now_date;
//                 }
//             });
//         }, 1000);
//         return () => clearInterval(interval);
//     });

//     return (
//         <>
//             <li>
//                 <details open>
//                     <summary>
//                         <Slot name="icon_dock" />
//                         Dock
//                     </summary>
//                     <ul class="pl-0">
//                         { nDock.n_docks.map((_, key) => (
//                             <li class="h-6">
//                                 <a class="justify-start gap-0">
//                                     <div class="pl-2 pr-0.5 truncate flex-1 min-w-12">
//                                         <div class="w-24">
//                                             {nDock.n_docks[key].ship_id}
//                                             {/* { nDock.n_docks[key].ship_id != 0 ? mst_ships.mst_ships[ships.ships[nDock.n_docks[key].ship_id].id]?.name ?? "Unknown" : "----" } */}
//                                         </div>
//                                     </div>
//                                     <div class="divider divider-horizontal mr-0 ml-0 flex-none"></div>
//                                     <div class="w-auto">
//                                         <span class="countdown font-mono text-2xs">
//                                             <span style={{"--value":Math.floor(nDock.n_docks[key].counter/3600)}}></span>:
//                                             <span style={{"--value":Math.floor(nDock.n_docks[key].counter/60)%60}}></span>:
//                                             <span style={{"--value":Math.floor(nDock.n_docks[key].counter)%60}}></span>
//                                         </span>
//                                     </div>
//                                     <div class="divider divider-horizontal mr-0 ml-0 flex-none"></div>
//                                     <div>
//                                         {nDock.n_docks[key].ship_id == 0 ? "Empty" : (nDock.n_docks[key].counter == 0 ? "Complete" : "Building")}
//                                     </div>
//                                 </a>
//                             </li>
//                         )) }
//                     </ul>
//                 </details>
//             </li>
//         </>
//     );
// });