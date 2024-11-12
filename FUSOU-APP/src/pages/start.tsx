import "../css/preview.css";
import "../css/divider.css";
import { createSignal, Show } from "solid-js";


let launch_options: {[key: string]: boolean} = {
    "run_proxy_server": true,
    "open_app": true,
    "open_kancolle": true,
    "open_kancolle_with_webview": true,
};

function Start() {

    const [runProxyServer, setRunProxyServer] = createSignal<boolean>(launch_options["run_proxy_server"]);
    const [openApp, setOpenApp] = createSignal<boolean>(launch_options["open_app"]);
    const [openKancolle, setOpenKancolle] = createSignal<boolean>(launch_options["open_kancolle"]);
    const [openKancolleWithWebView, setOpenKancolleWithWebView] = createSignal<boolean>(launch_options["open_kancolle_with_webview"]);
  
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
                                    <input type="checkbox" onClick={() => { launch_options["run_proxy_server"] = !runProxyServer(); setRunProxyServer(!runProxyServer()); }} class="toggle toggle-sm toggle-primary rounded-sm" checked={runProxyServer()}/>
                                </label>
                            </div>
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
                                    <input type="checkbox" onClick={() => { launch_options["open_app"] = !openApp(); setOpenApp(!openApp()); }} class="toggle toggle-sm toggle-primary rounded-sm" checked={openApp()} disabled={!runProxyServer()}/>
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
                                    <input type="checkbox" onClick={() => { launch_options["open_kancolle"] = !openKancolle(); setOpenKancolle(!openKancolle()); }} class="toggle toggle-sm toggle-primary rounded-sm" checked={openKancolle()}/>
                                </label>
                            </div>
                        </div>
                        <div class="mx-4">
                            <div class="form-control">
                                <label class="label cursor-pointer">
                                    <input type="radio" name="radio-10" class="radio radio-secondary" disabled={!openKancolle()} checked={openKancolleWithWebView()} onclick={() => { launch_options["open_kancolle_with_webview"] = true; setOpenKancolleWithWebView(true) }} />
                                    <span class="label-text">Open with WebView</span>
                                </label>
                            </div>
                            <div class="form-control">
                                <label class="label cursor-pointer">
                                    <input type="radio" name="radio-10" class="radio radio-secondary" disabled={!openKancolle()} checked={!openKancolleWithWebView()} onclick={() => { launch_options["open_kancolle_with_webview"] = false; setOpenKancolleWithWebView(false) }} />
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
                <a role="button" class="btn btn-wide" href="/app">Start</a>
            </div>
        </div>
      </div>
      </>
    );
  }
  
  export default Start;