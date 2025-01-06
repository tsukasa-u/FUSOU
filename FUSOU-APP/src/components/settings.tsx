import { invoke } from '@tauri-apps/api/tauri'
import { FadeToast, showFadeToast } from './fade_toast';
import { For } from 'solid-js';

export function SettingsComponent(){

    // useStylesScoped$(`
    //     div::before, div::after {
    //       width: 1px;
    //     }
    // `);

    let themes = [
        "default",
        "light",
        "dark",
        "cupcake",
        "bumblebee",
        "emerald",
        "corporate",
        "synthwave",
        "retro",
        "cyberpunk",
        "valentine",
        "halloween",
        "garden",
        "forest",
        "aqua",
        "lofi",
        "pastel",
        "fantasy",
        "wireframe",
        "black",
        "luxury",
        "dracula",
        "cmyk",
        "autumn",
        "business",
        "acid",
        "lemonade",
        "night",
        "coffee",
        "winter",
        "dim",
        "nord",
        "sunset"];
    
    return (
        <>
            <div class="breadcrumbs text-sm bg-base-300 fixed border-b-1 border-t-1 w-full rounded" style={{"z-index":"100"}}>
              <ul class="pl-4">
                <li><a class="link">Settings</a></li>
                <li><a class="link">Debug</a></li>
                <li><a class="link">Load Data</a></li>
              </ul>
            </div>

            <div class="h-8"></div>

            <div class="mx-4">
                <h1 class="pt-4 pb-2 text-2xl font-semibold">Settings</h1>
                
                <hr class="mt-4 mb-8" />
                <p class="py-2 text-xl font-semibold">Load Data</p>
                <p class="">Load saved response data when the API comes from. this app does not access KanColle server via API, it just copies response data.</p>
                <div class="mt-4 flex items-center justify-end">
                    <button class="btn btn-outline btn-wide" onClick={() => {
                        invoke("get_mst_ships");
                        invoke("get_slot_items");
                        invoke("get_mst_slot_items");
                        invoke("get_mst_equip_exslot_ships");
                        invoke("get_mst_slotitem_equip_types");
                        invoke("get_mst_equip_ships");
                        invoke("get_mst_stypes");
                        invoke("get_mst_useitems");
                        showFadeToast('setting_toast', "load all data");
                    }}>Load all data</button>
                </div>
                <hr class="mt-4 mb-4" />

                <div class="grid py-6">
                    <div id="load_mst_ships" class="py-2">
                        <h2 class="text-lg font-semibold leading-4">Load ship data</h2>
                        <p class="">Load the mst_ships data restored from API "/kcsapi/api_start2/get_data"</p>
                        <div class="mt-4 flex items-center justify-end">
                            <button class="btn btn-outline btn-wide" onClick={() => { invoke("get_mst_ships"); showFadeToast('setting_toast', "load mst_ships");  }}>Load mst ship data</button>
                        </div>
                    </div>
                    <div id="load_slot_items" class="py-2">
                        <h2 class="text-lg font-semibold leading-4 ">Load slotitems data</h2>
                        <p class="">Load the slotitems data restored from API  "/kcsapi/api_get_member/require_info"</p>
                        <div class="mt-4 flex items-center justify-end">
                            <button class="btn btn-outline btn-wide" onClick={() => { invoke("get_slot_items"); showFadeToast('setting_toast', "load slot_items");  }}>Load slot item data</button>
                        </div>
                    </div> 
                    <div id="load_mst_slot_items" class="py-2">
                        <h2 class="text-lg font-semibold leading-4 ">Load mst_slotitems data</h2>
                        <p class="">Load the mst_slotitems data restored from API "/kcsapi/api_start2/get_data"</p>
                        <div class="mt-4 flex items-center justify-end">
                            <button class="btn btn-outline btn-wide" onClick={() => { invoke("get_mst_slot_items"); showFadeToast('setting_toast', "load mst_slot_items"); }}>Load mst slot item data</button>
                        </div>
                    </div>
                    <div id="load_mst_equip_exslot_ships" class="py-2">
                        <h2 class="text-lg font-semibold leading-4 ">Load mst_equip_exslot_ships data</h2>
                        <p class="">Load the mst_equip_exslot_ships data restored from API "/kcsapi/api_start2/get_data"</p>
                        <div class="mt-4 flex items-center justify-end">
                            <button class="btn btn-outline btn-wide" onClick={() => { invoke("get_mst_equip_exslot_ships"); showFadeToast('setting_toast', "load mst_equip_exslot_ships"); }}>Load mst equip exslot ship data</button>
                        </div>
                    </div>
                    <div id="load_mst_slotitem_equip_types" class="py-2">
                        <h2 class="text-lg font-semibold leading-4 ">Load mst_slotitem_equip_types data</h2>
                        <p class="">Load the mst_slotitem_equip_types data restored from API "/kcsapi/api_start2/get_data"</p>
                        <div class="mt-4 flex items-center justify-end">
                            <button class="btn btn-outline btn-wide" onClick={() => { invoke("get_mst_slotitem_equip_types"); showFadeToast('setting_toast', "load mst_slotitem_equip_types"); }}>Load mst slot item equip types data</button>
                        </div>
                    </div>
                    <div id="load_mst_equip_ships" class="py-2">
                        <h2 class="text-lg font-semibold leading-4 ">Load mst_equip_ships data</h2>
                        <p class="">Load the mst_equip_ships data restored from API "/kcsapi/api_start2/get_data"</p>
                        <div class="mt-4 flex items-center justify-end">
                            <button class="btn btn-outline btn-wide" onClick={() => { invoke("get_mst_equip_ships"); showFadeToast('setting_toast', "load mst_equip_ships"); }}>Load mst equip ships data</button>
                        </div>
                    </div>
                    <div id="load_mst_stypes" class="py-2">
                        <h2 class="text-lg font-semibold leading-4 ">Load mst_stypes data</h2>
                        <p class="">Load the mst_stypes data restored from API "/kcsapi/api_start2/get_data"</p>
                        <div class="mt-4 flex items-center justify-end">
                            <button class="btn btn-outline btn-wide" onClick={() => { invoke("get_mst_stypes"); showFadeToast('setting_toast', "load mst_stypes"); }}>Load mst stypes data</button>
                        </div>
                    </div>
                    <div id="load_mst_useitems" class="py-2">
                        <h2 class="text-lg font-semibold leading-4 ">Load mst_useitems data</h2>
                        <p class="">Load the mst_useitems data restored from API "/kcsapi/api_start2/get_data"</p>
                        <div class="mt-4 flex items-center justify-end">
                            <button class="btn btn-outline btn-wide" onClick={() => { invoke("get_mst_useitems"); showFadeToast('setting_toast', "load mst_useitems"); }}>Load mst useitems data</button>
                        </div>
                    </div>
                </div>

                <hr class="mt-4 mb-8" />

                <div class="grid py-6">
                    <div id="load_mst_ships" class="py-2">
                        <h2 class="text-lg font-semibold leading-4 ">Change theme</h2>
                        <p class="">change theme you like to select drop down menu</p>
                        <div class="mt-4 flex items-center justify-end">
                            <div class="dropdown mb-72">
                                <div tabindex="0" role="button" class="btn btn-outline btn-wide">
                                    Theme
                                    <svg width="12px" height="12px" class="inline-block h-2 w-2 fill-current opacity-60" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2048 2048">
                                        <path d="M1799 349l242 241-1017 1017L7 590l242-241 775 775 775-775z"></path>
                                    </svg>
                                </div>
                                <ul tabindex="0" class="dropdown-content bg-base-200 rounded-md z-[1] w-64 outline outline-1 p-2 shadow max-h-80" style={"overflow-y:auto"}>
                                    <For each={themes}>
                                        {(theme) => (
                                            <li>
                                                <input type="radio" name="theme-dropdown" class="theme-controller btn btn-sm btn-block justify-start" aria-label={theme} value={theme} />
                                            </li>
                                        )}
                                    </For>
                                </ul>
                            </div>
                        </div>
                    </div>
                    <span class="h-8"></span>
                </div>
                
            </div>
            
            <FadeToast toast_id='setting_toast'></FadeToast>
        </>
    );
}