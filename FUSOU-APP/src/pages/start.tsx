import "../css/preview.css";
import "../css/divider.css";
import "../css/justify_self_center.css";
import { createSignal, For, Show } from "solid-js";
import { event, invoke } from "@tauri-apps/api";


let launch_options: {[key: string]: number} = {
    "run_proxy_server": 1,
    "open_app": 1,
    "open_kancolle": 1,
    "open_kancolle_with_webview": 1,
    "server": -1
};

let server_list: {[key: string]: string} = {
    "横須賀鎮守府":	"203.104.209.71",
    "新呉鎮守府":	"203.104.209.87",
    "佐世保鎮守府":	"125.6.184.215",
    "舞鶴鎮守府":	"203.104.209.183",
    "大湊警備府":	"203.104.209.150",
    "トラック泊地":	"203.104.209.134",
    "リンガ泊地":	"203.104.209.167",
    "ラバウル基地":	"203.104.209.199",
    "ショートランド泊地":	"125.6.189.7",
    "ブイン基地":	"125.6.189.39",
    "タウイタウイ泊地":	"125.6.189.71",
    "パラオ泊地":	"125.6.189.103",
    "ブルネイ泊地":	"125.6.189.135",
    "単冠湾泊地":	"125.6.189.167",
    "宿毛湾泊地":	"125.6.189.247",
    "幌筵泊地":	"125.6.189.215",
    "鹿屋基地":	"203.104.209.23",
    "岩川基地":	"203.104.209.39",
    "佐伯湾泊地":	"203.104.209.55",
    "柱島泊地":	"203.104.209.102",
}

function Start() {

    const [runProxyServer, setRunProxyServer] = createSignal<boolean>(Boolean(launch_options["run_proxy_server"]));
    const [openApp, setOpenApp] = createSignal<boolean>(Boolean(launch_options["open_app"]));
    const [openKancolle, setOpenKancolle] = createSignal<boolean>(Boolean(launch_options["open_kancolle"]));
    const [openKancolleWithWebView, setOpenKancolleWithWebView] = createSignal<boolean>(Boolean(launch_options["open_kancolle_with_webview"]));
    const [server, setServer] = createSignal<number>(launch_options["server"]);
  
    return (
      <>
      <div class="bg-base-200 h-screen">
        <div class="max-w-md justify-self-center bg-base-100 h-screen">
            <h1 class="mx-4 pt-4 text-2xl font-semibold">Launch Options</h1>
            <div class="divider mt-0 mb-0 w-11/12 justify-self-center"></div>
            <div class="mx-4 flex">
                <div class="grid">
                    <div id="load_mst_ships" class="py-2">
                        <h2 class="text-lg font-semibold leading-4 text-slate-700">Run Proxy Server</h2>
                        <p class="text-slate-600">Run proxy server to copy response data communicated between your pc and KanColle server</p>
                        <div class="mt-4 flex items-center justify-end">
                            <span class="flex-auto"></span>
                            <div class="form-control flex-none">
                                <label class="label cursor-pointer h-4">
                                    <span class="label-text mb-1.5 pr-2 h-4">
                                        <Show when={runProxyServer()}>
                                            On
                                        </Show>
                                        <Show when={!runProxyServer()}>
                                            Off
                                        </Show>
                                    </span>
                                    <input type="checkbox" onClick={() => { launch_options["run_proxy_server"] = Number(!runProxyServer()); setRunProxyServer(!runProxyServer()); }} class="toggle toggle-sm toggle-primary rounded-sm" checked={runProxyServer()}/>
                                </label>
                            </div>
                        </div>
                        <div class="flex flex-nowrap pt-4">
                            <div class="h-6 w-28 self-center ml-4 flex-none">
                                Your server
                            </div>
                            <select class="select select-sm select-bordered w-full" disabled={!runProxyServer()} onchange={(e) => { launch_options["server"] = e.target.selectedIndex-1; setServer(e.target.selectedIndex-1);}}>
                                <option disabled selected>Select your KanColle Server</option>
                                <For each={Object.keys(server_list)}>
                                    {(name, idx) => (
                                        <option selected={server() == idx()}>{name}</option>
                                    )}
                                </For>
                            </select>
                        </div>
                    </div>
                    <div id="load_mst_ships" class="py-2">
                        <h2 class="text-lg font-semibold leading-4 text-slate-700">Open App</h2>
                        <p class="text-slate-600">Open internal KanColle data viewer</p>
                        <div class="mt-4 flex items-center justify-end">
                            <span class="flex-auto"></span>
                            <div class="form-control flex-none">
                                <label class="label cursor-pointer h-4">
                                    <span class="label-text mb-1.5 pr-2 h-4">
                                        <Show when={openApp() && runProxyServer()}>
                                            On
                                        </Show>
                                        <Show when={!openApp() && runProxyServer()}>
                                            Off
                                        </Show>
                                        <Show when={!runProxyServer()}>
                                            Disable
                                        </Show>
                                    </span>
                                    <input type="checkbox" onClick={() => { launch_options["open_app"] = Number(!openApp()); setOpenApp(!openApp()); }} class="toggle toggle-sm toggle-primary rounded-sm" checked={openApp()} disabled={!runProxyServer()}/>
                                </label>
                            </div>
                        </div>
                    </div>
                    <div id="load_mst_ships" class="py-2">
                        <h2 class="text-lg font-semibold leading-4 text-slate-700">Open KanColle</h2>
                        <p class="text-slate-600">Open KanColle with WebView or native browser</p>
                        <div class="mt-4 flex items-center justify-end">
                            <span class="flex-auto"></span>
                            <div class="form-control flex-none">
                                <label class="label cursor-pointer h-4">
                                    <span class="label-text mb-1.5 pr-2 h-4">
                                        <Show when={openKancolle()}>
                                            On
                                        </Show>
                                        <Show when={!openKancolle()}>
                                            Off
                                        </Show>
                                    </span>
                                    <input type="checkbox" onClick={() => { launch_options["open_kancolle"] = Number(!openKancolle()); setOpenKancolle(!openKancolle()); }} class="toggle toggle-sm toggle-primary rounded-sm" checked={openKancolle()}/>
                                </label>
                            </div>
                        </div>
                        <div class="mx-4">
                            <div class="form-control">
                                <label class="label cursor-pointer">
                                    <input type="radio" name="radio-10" class="radio radio-secondary" disabled={!openKancolle()} checked={openKancolleWithWebView()} onclick={() => { launch_options["open_kancolle_with_webview"] = 1; setOpenKancolleWithWebView(true) }} />
                                    <span class="label-text">Open with WebView</span>
                                </label>
                            </div>
                            <div class="form-control">
                                <label class="label cursor-pointer">
                                    <input type="radio" name="radio-10" class="radio radio-secondary" disabled={!openKancolle()} checked={!openKancolleWithWebView()} onclick={() => { launch_options["open_kancolle_with_webview"] = 0; setOpenKancolleWithWebView(false) }} />
                                    <span class="label-text">Open with native browser</span>
                                </label>
                            </div>
                        </div>
                    </div>
                    {/* <div class="preview border-base-300 bg-base-100 rounded-box flex flex-wrap items-center justify-center gap-2 p-4 [border-width:var(--tab-border)]" style="">
                    </div> */}
                </div>
            </div>
            <div class="divider mt-0 mb-0 w-11/12 justify-self-center"></div>
            <div class="h-8"></div>
            <div class="flex justify-center">
                <a role="button" class="btn btn-wide" href="/app" onclick={() => { invoke("launch_with_options", {options: launch_options}); }}>Start</a>
            </div>
        </div>
      </div>
      </>
    );
  }
  
  export default Start;