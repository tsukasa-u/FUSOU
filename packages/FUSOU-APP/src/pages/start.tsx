import "../css/preview.css";
import "../css/divider.css";
import "../css/justify_self_center.css";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onMount,
  Show,
  Switch,
} from "solid-js";
import { invoke } from "@tauri-apps/api/core";

import IconCheckBoxGreen from "../icons/check_box_green";
import IconCheckBoxRed from "../icons/check_box_red";

import { location_route } from "../utility/location";
import { createAsyncStore } from "@solidjs/router";

const launch_options: { [key: string]: number } = {
  run_proxy_server: 1,
  open_app: 1,
  open_kancolle: 1,
  open_kancolle_with_webview: 1,
  server: -1,
};

// Server list will be loaded dynamically from config
// Hardcoded as fallback defaults
const DEFAULT_SERVER_LIST: { [key: string]: string } = {
  横須賀鎮守府: "w01y.kancolle-server.com",
  新呉鎮守府: "w02k.kancolle-server.com",
  佐世保鎮守府: "w03s.kancolle-server.com",
  舞鶴鎮守府: "w04m.kancolle-server.com",
  大湊警備府: "w05o.kancolle-server.com",
  トラック泊地: "w06k.kancolle-server.com",
  リンガ泊地: "w07l.kancolle-server.com",
  ラバウル基地: "w08r.kancolle-server.com",
  ショートランド泊地: "w09s.kancolle-server.com",
  ブイン基地: "w10b.kancolle-server.com",
  タウイタウイ泊地: "w11t.kancolle-server.com",
  パラオ泊地: "w12p.kancolle-server.com",
  ブルネイ泊地: "w13b.kancolle-server.com",
  単冠湾泊地: "w14h.kancolle-server.com",
  幌筵泊地: "w15p.kancolle-server.com",
  宿毛湾泊地: "w16s.kancolle-server.com",
  鹿屋基地: "w17k.kancolle-server.com",
  岩川基地: "w18i.kancolle-server.com",
  佐伯湾泊地: "w19s.kancolle-server.com",
  柱島泊地: "w20h.kancolle-server.com",
};

function Start() {
  createEffect(location_route);
  const [isLaunching, setIsLaunching] = createSignal<boolean>(false);

  const [runProxyServer, setRunProxyServer] = createSignal<boolean>(
    Boolean(launch_options["run_proxy_server"]),
  );
  const [openApp, setOpenApp] = createSignal<boolean>(
    Boolean(launch_options["open_app"]),
  );
  const [openKancolle, setOpenKancolle] = createSignal<boolean>(
    Boolean(launch_options["open_kancolle"]),
  );
  const [openKancolleWithWebView, setOpenKancolleWithWebView] =
    createSignal<boolean>(
      Boolean(launch_options["open_kancolle_with_webview"]),
    );
  const [server, setServer] = createSignal<number>(launch_options["server"]);

  const [pacServerHealth, setPacServerHealth] = createSignal<number>(-1);
  const [proxyServerHealth, setProxyServerHealth] = createSignal<number>(-1);

  function check_server_status() {
    setPacServerHealth(-1);
    setProxyServerHealth(-1);

    invoke<string>("check_proxy_server_health")
      .then(() => {
        setProxyServerHealth(1);
      })
      .catch(() => {
        setProxyServerHealth(0);
      });

    invoke<string>("check_proxy_server_health")
      .then(() => {
        setPacServerHealth(1);
      })
      .catch(() => {
        setPacServerHealth(0);
      });
  }

  onMount(() => {
    check_server_status();
  });

  createEffect(() => {
    if (run_proxy_flag() == 1) {
      launch_options["run_proxy_server"] = Number(runProxyServer());
    } else {
      launch_options["run_proxy_server"] = 0;
    }
    if (run_app_flag() == 1) {
      launch_options["open_app"] = Number(openApp());
    } else {
      launch_options["open_app"] = 0;
    }
  });

  const run_proxy_flag = createMemo(() => {
    if (proxyServerHealth() == -1 || pacServerHealth() == -1) return 0;
    if (proxyServerHealth() == 0 && pacServerHealth() == 0) return 1;
    if (proxyServerHealth() == 1 && pacServerHealth() == 1) return 0;
    return -1;
  });

  const run_app_flag = createMemo(() => {
    if (proxyServerHealth() == -1 || pacServerHealth() == -1) return 0;
    if (proxyServerHealth() == 0 && pacServerHealth() == 0 && !runProxyServer())
      return 0;
    return 1;
  });

  const isStartDisabled = createMemo(() => {
    return (
      isLaunching() ||
      proxyServerHealth() == -1 ||
      pacServerHealth() == -1 ||
      run_proxy_flag() == -1
    );
  });

  const start_button_class = createMemo(() => {
    if (isStartDisabled()) {
      return "btn w-full btn-disabled btn-primary";
    }
    return "btn w-full btn-primary border-primary-content";
  });

  const handleStart = async (e: MouseEvent) => {
    e.preventDefault();
    if (isStartDisabled()) return;

    setIsLaunching(true);

    try {
      await invoke("launch_with_options", { options: launch_options });
    } catch (err) {
      console.error("Failed to launch with options:", err);
    } finally {
      setIsLaunching(false);
      window.location.href = "/app";
    }
  };

  const auto_listen = createAsyncStore<string>(async () => {
    const response_promise = invoke<string>("get_kc_server_name")
      .then((name) => {
        if (import.meta.env.DEV) console.log("name", name);
        return name !== "" ? name : "Auto Listen";
      })
      .catch(() => "Auto Listen");
    const server_name = await response_promise;
    return server_name !== "" ? server_name : "Auto Listen";
  });

  return (
    <>
      <div class="bg-base-100 min-h-dvh flex">
        <div class="bg-base-100 min-h-dvh flex flex-1" />
        <div class="max-w-md justify-self-center bg-base-100 h-fit mx-0">
          <h1 class="mx-4 pt-4 text-2xl font-semibold">Launch Options</h1>
          <div class="divider mt-0 mb-0 w-11/12 justify-self-center" />
          <div class="mx-4 flex">
            <div class="grid w-full">
              <div class="py-2" id="run-proxy-server-section">
                <div class="flex items-center justify-between gap-2">
                  <h2 class="text-lg font-semibold leading-4">
                    Run Proxy Server
                  </h2>
                  <button
                    type="button"
                    id="check-server-status-btn"
                    class="btn btn-sm btn-secondary border-secondary-content shrink-0"
                    onClick={check_server_status}
                  >
                    check server status
                  </button>
                </div>
                <p class="mt-1">
                  Run proxy server to copy responsed data from KC server{" "}
                </p>
                <div class="flex flex-nowrap mt-4">
                  <div class="flex flex-nowrap">
                    <Switch>
                      <Match when={proxyServerHealth() == -1}>
                        <div class="w-4 h-4">
                          <span class="loading loading-spinner loading-sm h-5 w-5 mt-1" />
                        </div>
                        <div class="h-6 self-center ml-4 text-nowrap  mb-[2.5px] pr-1">
                          checking proxy server status
                        </div>
                        <span class="loading loading-dots loading-xs mt-2" />
                      </Match>
                      <Match when={proxyServerHealth() == 0}>
                        <div class="w-4 h-4">
                          <IconCheckBoxRed class="h-6 w-6 mb-0.5 pr-1 text-base-100" />
                        </div>
                        <div class="h-6 self-center ml-4 text-nowrap mb-[2.5px] pr-1">
                          Proxy server is not running
                        </div>
                      </Match>
                      <Match when={proxyServerHealth() == 1}>
                        <div class="w-4 h-4">
                          <IconCheckBoxGreen class="h-6 w-6 mb-0.5 pr-1 text-base-100" />
                        </div>
                        <div class="h-6 self-center ml-4 text-nowrap mb-[2.5px] pr-1">
                          Proxy server is running
                        </div>
                      </Match>
                    </Switch>
                  </div>
                  <span class="flex-1" />
                  <div class="flex items-center justify-end">
                    <span class="flex-auto" />
                    <div class="form-control flex-none">
                      <label class="label cursor-pointer h-4">
                        <span class="label-text mb-1.5 pr-2 h-4">
                          <Show when={runProxyServer()}>On</Show>
                          <Show when={!runProxyServer()}>Off</Show>
                        </span>
                        <input
                          type="checkbox"
                          onClick={() => {
                            setRunProxyServer(!runProxyServer());
                          }}
                          class="toggle toggle-sm toggle-primary"
                          checked={runProxyServer()}
                          disabled={run_proxy_flag() <= 0}
                        />
                      </label>
                    </div>
                  </div>
                </div>
                <div class="flex flex-nowrap pt-4">
                  <div class="h-6 w-28 self-center ml-4 flex-none">
                    Your server
                  </div>
                  <select
                    class="select select-sm select-bordered w-full"
                    disabled={!runProxyServer()}
                    onChange={(e) => {
                      launch_options["server"] = e.target.selectedIndex;
                      setServer(e.target.selectedIndex);
                    }}
                  >
                    <option selected>{auto_listen() ?? "Auto Listen"}</option>
                    <For each={Object.keys(DEFAULT_SERVER_LIST)}>
                      {(name, idx) => (
                        <option selected={server() == idx() + 1}>{name}</option>
                      )}
                    </For>
                  </select>
                </div>
                <div class="flex flex-nowrap pt-2">
                  <Switch>
                    <Match when={pacServerHealth() == -1}>
                      <div class="w-4 h-4">
                        <span class="loading loading-spinner loading-sm h-5 w-5 mt-1" />
                      </div>
                      <div class="h-6 self-center ml-4 text-nowrap  mb-[2.5px] pr-1">
                        checking pac server status
                      </div>
                      <span class="loading loading-dots loading-xs mt-2" />
                    </Match>
                    <Match when={pacServerHealth() == 0}>
                      <div class="w-4 h-4">
                        <IconCheckBoxRed class="h-6 w-6 mb-0.5 pr-1 text-base-100" />
                      </div>
                      <div class="h-6 self-center ml-4 text-nowrap mb-[2.5px] pr-1">
                        Pac server is not running
                      </div>
                    </Match>
                    <Match when={pacServerHealth() == 1}>
                      <div class="w-4 h-4">
                        <IconCheckBoxGreen class="h-6 w-6 mb-0.5 pr-1 text-base-100" />
                      </div>
                      <div class="h-6 self-center ml-4 text-nowrap mb-[2.5px] pr-1">
                        Pac server is running
                      </div>
                    </Match>
                  </Switch>
                </div>
              </div>
              <Show when={run_proxy_flag() == -1}>
                <div role="alert" class="alert alert-error">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-6 w-6 shrink-0 stroke-current"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span>Something Wrong. Restart from System Tray.</span>
                </div>
              </Show>
              <div class="py-2">
                <h2 class="text-lg font-semibold leading-4">Open App</h2>
                <p class="">Open internal KanColle data viewer</p>
                <div class="mt-4 flex items-center justify-end">
                  <span class="flex-auto" />
                  <div class="form-control flex-none">
                    <label class="label cursor-pointer h-4">
                      <span class="label-text mb-1.5 pr-2 h-4">
                        <Show when={openApp() && runProxyServer()}>On</Show>
                        <Show when={!openApp() && runProxyServer()}>Off</Show>
                        <Show when={!runProxyServer()}>Disable</Show>
                      </span>
                      <input
                        type="checkbox"
                        onClick={() => {
                          setOpenApp(!openApp());
                        }}
                        class="toggle toggle-sm toggle-primary"
                        checked={openApp()}
                        disabled={run_app_flag() <= 0}
                      />
                    </label>
                  </div>
                </div>
              </div>
              <div class="py-2">
                <h2 class="text-lg font-semibold leading-4">Open KanColle</h2>
                <p class="">Open KanColle with WebView or native browser</p>
                <div class="mt-4 flex items-center justify-end">
                  <span class="flex-auto" />
                  <div class="form-control flex-none">
                    <label class="label cursor-pointer h-4">
                      <span class="label-text mb-1.5 pr-2 h-4">
                        <Show when={openKancolle()}>On</Show>
                        <Show when={!openKancolle()}>Off</Show>
                      </span>
                      <input
                        type="checkbox"
                        onClick={() => {
                          launch_options["open_kancolle"] =
                            Number(!openKancolle());
                          setOpenKancolle(!openKancolle());
                        }}
                        class="toggle toggle-sm toggle-primary"
                        checked={openKancolle()}
                      />
                    </label>
                  </div>
                </div>
                <div class="flex flex-nowrap pt-4">
                  <label
                    for="open-kancolle-target"
                    class="h-6 w-28 self-center ml-4 flex-none"
                  >
                    Open with
                  </label>
                  <select
                    id="open-kancolle-target"
                    class="select select-sm select-bordered w-full"
                    disabled={!openKancolle()}
                    value={openKancolleWithWebView() ? "webview" : "browser"}
                    onChange={(e) => {
                      const useWebView = e.currentTarget.value === "webview";
                      launch_options["open_kancolle_with_webview"] =
                        Number(useWebView);
                      setOpenKancolleWithWebView(useWebView);
                    }}
                  >
                    <option value="webview">WebView</option>
                    <option value="browser">Native browser</option>
                  </select>
                </div>
              </div>
              {/* <div class="preview border-base-300 bg-base-100 rounded-box flex flex-wrap items-center justify-center gap-2 p-4 [border-width:var(--tab-border)]" style="">
                    </div> */}
            </div>
          </div>
          <div class="h-4" />
          <div class="flex justify-center mx-4" id="start-button">
            <button
              type="button"
              class={start_button_class()}
              disabled={isStartDisabled()}
              onClick={handleStart}
            >
              <Show when={isLaunching()} fallback="Start">
                <span class="loading loading-spinner loading-sm mr-2" />
                Launching...
              </Show>
            </button>
          </div>
          <div class="h-12" />
        </div>
        <div class="bg-base-100 min-h-dvh flex flex-1" />
      </div>
    </>
  );
}

export default Start;
