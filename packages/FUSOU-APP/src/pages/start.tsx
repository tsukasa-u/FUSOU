import "../css/preview.css";
import "../css/divider.css";
import "../css/justify_self_center.css";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
} from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { AlertMessage } from "ui";

import { location_route } from "../utility/location";
import { isTauri } from "../utility/tauri";
import { SettingsComponent } from "../components/settings/settings.tsx";
import { LogViewerComponent } from "../components/logger/log-viewer.tsx";
import { PolicyPanelComponent } from "../components/policy/policy_panel.tsx";
import IconRocket from "../icons/rocket.tsx";

type StartTabKey = "start" | "settings" | "logs" | "policy";
type ServerHealthStatus = -1 | 0 | 1;

export interface StartProps {
  previewHealth?: {
    proxy: ServerHealthStatus;
    pac: ServerHealthStatus;
  };
}

type StartTabDefinition = {
  key: StartTabKey;
  label: string;
};

const START_TAB_DEFINITIONS: StartTabDefinition[] = [
  { key: "start", label: "Start" },
  { key: "settings", label: "Settings" },
  { key: "logs", label: "Logs" },
  { key: "policy", label: "Policy" },
];

// Server list fallback defaults
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

export function StartPage(props: StartProps = {}) {
  createEffect(location_route);

  const [activeTab, setActiveTab] = createSignal<StartTabKey>("start");
  const isViewportLockedTab = () => activeTab() === "logs";

  const [isLaunching, setIsLaunching] = createSignal<boolean>(false);
  const [runProxyServer, setRunProxyServer] = createSignal<boolean>(true);
  const [openApp, setOpenApp] = createSignal<boolean>(true);
  const [openKancolle, setOpenKancolle] = createSignal<boolean>(true);
  const [server, setServer] = createSignal<number>(-1);
  const [autoListenLabel, setAutoListenLabel] =
    createSignal<string>("Auto Listen");

  const [pacServerHealth, setPacServerHealth] =
    createSignal<ServerHealthStatus>(-1);
  const [proxyServerHealth, setProxyServerHealth] =
    createSignal<ServerHealthStatus>(-1);

  function check_server_status() {
    setPacServerHealth(-1);
    setProxyServerHealth(-1);

    if (!isTauri()) {
      setProxyServerHealth(0);
      setPacServerHealth(0);
      return;
    }

    invoke<string>("check_proxy_server_health")
      .then(() => {
        setProxyServerHealth(1);
      })
      .catch(() => {
        setProxyServerHealth(0);
      });

    invoke<string>("check_pac_server_health")
      .then(() => {
        setPacServerHealth(1);
      })
      .catch(() => {
        setPacServerHealth(0);
      });
  }

  onMount(() => {
    if (props.previewHealth) {
      setProxyServerHealth(props.previewHealth.proxy);
      setPacServerHealth(props.previewHealth.pac);
    } else {
      check_server_status();
    }

    if (isTauri()) {
      invoke<string>("get_kc_server_name")
        .then((name) => {
          if (import.meta.env.DEV) console.log("name", name);
          setAutoListenLabel(name !== "" ? name : "Auto Listen");
        })
        .catch(() => {
          setAutoListenLabel("Auto Listen");
        });
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

  const isCheckingStatus = createMemo(
    () => proxyServerHealth() == -1 || pacServerHealth() == -1,
  );

  const isStateMismatch = createMemo(() => run_proxy_flag() === -1);

  const isProxyStackRunning = createMemo(
    () => proxyServerHealth() === 1 && pacServerHealth() === 1,
  );

  const mismatchDetail = createMemo(() => {
    if (proxyServerHealth() === 1 && pacServerHealth() === 0) {
      return "Proxy server is running, but PAC server is stopped. Restart FUSOU from the System Tray.";
    }
    if (proxyServerHealth() === 0 && pacServerHealth() === 1) {
      return "PAC server is running, but Proxy server is stopped. Restart FUSOU from the System Tray.";
    }
    return "Something went wrong. Restart FUSOU from the System Tray.";
  });

  const isStartDisabled = createMemo(() => {
    return isLaunching() || isCheckingStatus() || isStateMismatch();
  });

  const handleStart = async (e: MouseEvent) => {
    e.preventDefault();
    if (isStartDisabled()) return;

    const options: Record<string, number> = {
      run_proxy_server: run_proxy_flag() === 1 ? Number(runProxyServer()) : 0,
      open_app: run_app_flag() === 1 ? Number(openApp()) : 0,
      open_kancolle: Number(openKancolle()),
      server: server(),
    };

    setIsLaunching(true);

    let launchSucceeded = false;
    try {
      await invoke("launch_with_options", { options });
      launchSucceeded = true;
    } catch (err) {
      console.error("Failed to launch with options:", err);
    } finally {
      setIsLaunching(false);
    }
    if (launchSucceeded && options["open_app"] !== 0) {
      window.location.href = "/app";
    }
  };

  return (
    <div class={isViewportLockedTab() ? "h-full flex flex-col min-h-0" : ""}>
      <div class="sticky top-0 z-100 border-b border-base-300 bg-base-100 shrink-0">
        <div
          role="tablist"
          class="tabs tabs-border tabs-sm bg-base-100 flex-wrap"
        >
          <For each={START_TAB_DEFINITIONS}>
            {(tab) => (
              <button
                type="button"
                role="tab"
                class="tab"
                classList={{ "tab-active": activeTab() === tab.key }}
                aria-selected={activeTab() === tab.key}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            )}
          </For>
        </div>
      </div>

      {/* Start Tab */}
      <div class={activeTab() === "start" ? "block" : "hidden"}>
        <div class="bg-base-100 min-h-full">
          <div class="max-w-4xl mx-auto px-6 py-6 space-y-6">
            <header class="space-y-1">
              <h1 class="text-2xl font-bold tracking-tight">Launch Options</h1>
              <p class="text-sm text-base-content/65">
                Configure proxy routing, choose which windows to open, and
                launch FUSOU.
              </p>
            </header>

            {/* Proxy Server */}
            <section class="space-y-2.5" id="run-proxy-server-section">
              <h2 class="text-xs font-semibold uppercase tracking-wider text-base-content/60">
                Proxy Server
              </h2>
              <div class="bg-base-100 rounded-box border border-base-300 divide-y divide-base-300">
                <div class="p-4 space-y-3">
                  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div class="space-y-0.5 min-w-0">
                      <div class="flex flex-wrap items-center gap-1.5">
                        <h3 class="text-sm font-semibold">Run Proxy Server</h3>
                        <Show when={isProxyStackRunning()}>
                          <span class="badge badge-xs badge-success badge-outline">
                            Already running
                          </span>
                        </Show>
                        <Show when={isStateMismatch()}>
                          <span class="badge badge-xs badge-error badge-outline">
                            State mismatch
                          </span>
                        </Show>
                      </div>
                      <p class="text-xs text-base-content/65">
                        Run the local proxy server to observe response data from
                        the KanColle server.
                      </p>
                    </div>
                    <div class="flex items-center justify-end gap-3 shrink-0">
                      <label class="flex items-center gap-2 cursor-pointer text-xs">
                        <span class="text-base-content/75">
                          <Show when={runProxyServer()} fallback="Off">
                            On
                          </Show>
                        </span>
                        <input
                          type="checkbox"
                          class="toggle toggle-sm toggle-primary"
                          checked={runProxyServer()}
                          disabled={run_proxy_flag() <= 0}
                          onChange={(e) =>
                            setRunProxyServer(e.currentTarget.checked)
                          }
                        />
                      </label>
                    </div>
                  </div>

                  <Show when={isStateMismatch()}>
                    <div class="space-y-2">
                      <AlertMessage type="error" title="Proxy State Mismatch">
                        {mismatchDetail()}
                      </AlertMessage>
                      <div class="flex justify-end">
                        <button
                          type="button"
                          id="check-server-status-btn"
                          class="btn btn-ghost btn-xs"
                          disabled={isCheckingStatus()}
                          onClick={check_server_status}
                        >
                          <Show when={isCheckingStatus()}>
                            <span class="loading loading-spinner loading-xs" />
                          </Show>
                          {isCheckingStatus()
                            ? "Checking..."
                            : "Recheck status"}
                        </button>
                      </div>
                    </div>
                  </Show>
                </div>

                <div class="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div class="space-y-0.5 min-w-0">
                    <label
                      for="start-server-select"
                      class="text-sm font-semibold cursor-pointer"
                    >
                      KanColle Server
                    </label>
                    <p class="text-xs text-base-content/65">
                      Select your server or keep Auto Listen to use the
                      configured server automatically.
                    </p>
                  </div>
                  <select
                    id="start-server-select"
                    class="select select-sm select-bordered w-full sm:w-64 shrink-0"
                    disabled={!runProxyServer()}
                    value={server() === -1 ? "0" : String(server())}
                    onChange={(e) => {
                      const idx = e.currentTarget.selectedIndex;
                      setServer(idx === 0 ? -1 : idx);
                    }}
                  >
                    <option value="0">{autoListenLabel()}</option>
                    <For each={Object.keys(DEFAULT_SERVER_LIST)}>
                      {(name, idx) => (
                        <option value={String(idx() + 1)}>{name}</option>
                      )}
                    </For>
                  </select>
                </div>
              </div>
            </section>

            {/* Application Windows */}
            <section class="space-y-2.5">
              <h2 class="text-xs font-semibold uppercase tracking-wider text-base-content/60">
                Application Windows
              </h2>
              <div class="bg-base-100 rounded-box border border-base-300 divide-y divide-base-300">
                <div class="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div class="space-y-0.5 min-w-0">
                    <h3 class="text-sm font-semibold">Open App</h3>
                    <p class="text-xs text-base-content/65">
                      Open the internal FUSOU KanColle data viewer dashboard.
                    </p>
                  </div>
                  <label class="flex items-center justify-end gap-2 cursor-pointer text-xs shrink-0">
                    <span class="text-base-content/75">
                      <Show when={openApp() && runProxyServer()}>On</Show>
                      <Show when={!openApp() && runProxyServer()}>Off</Show>
                      <Show when={!runProxyServer()}>Disabled</Show>
                    </span>
                    <input
                      type="checkbox"
                      class="toggle toggle-sm toggle-primary"
                      checked={openApp()}
                      disabled={run_app_flag() <= 0}
                      onChange={(e) => setOpenApp(e.currentTarget.checked)}
                    />
                  </label>
                </div>

                <div class="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div class="space-y-0.5 min-w-0">
                    <h3 class="text-sm font-semibold">Open KanColle</h3>
                    <p class="text-xs text-base-content/65">
                      Open the KanColle game page in the built-in WebView.
                    </p>
                  </div>
                  <label class="flex items-center justify-end gap-2 cursor-pointer text-xs shrink-0">
                    <span class="text-base-content/75">
                      <Show when={openKancolle()} fallback="Off">
                        On
                      </Show>
                    </span>
                    <input
                      type="checkbox"
                      class="toggle toggle-sm toggle-primary"
                      checked={openKancolle()}
                      onChange={(e) => setOpenKancolle(e.currentTarget.checked)}
                    />
                  </label>
                </div>
              </div>
            </section>

            {/* Launch Action */}
            <section class="pt-2 space-y-3 text-center" id="start-button">
              <div class="space-y-1">
                <h2 class="text-sm font-semibold text-base-content">
                  Ready to Launch?
                </h2>
                <p class="text-xs text-base-content/65">
                  Review your proxy and window options above. Click Start to
                  launch the selected services and windows.
                </p>
              </div>
              <div class="flex justify-center">
                <button
                  type="button"
                  class="btn btn-primary enabled:border-primary-content w-full sm:w-5/8"
                  disabled={isStartDisabled()}
                  onClick={handleStart}
                >
                  <Show
                    when={isLaunching()}
                    fallback={
                      <>
                        <IconRocket
                          class="h-4 w-4 shrink-0"
                          aria-hidden="true"
                        />
                        <span>Start</span>
                      </>
                    }
                  >
                    <span class="loading loading-spinner loading-sm" />
                    Launching...
                  </Show>
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>

      {/* Settings Tab (auth/runtime actions disabled before launch) */}
      <div class={activeTab() === "settings" ? "block" : "hidden"}>
        <div class="pt-0 pb-0 pl-0 bg-base-100">
          <SettingsComponent mode="start" />
        </div>
      </div>

      {/* Logs Tab */}
      <div
        class={
          activeTab() === "logs"
            ? "flex-1 min-h-0 flex flex-col bg-base-100"
            : "hidden"
        }
      >
        <div class="pt-0 pb-0 pl-0 bg-base-100 flex-1 min-h-0 flex flex-col">
          <LogViewerComponent />
        </div>
      </div>

      {/* Policy Tab */}
      <div class={activeTab() === "policy" ? "block" : "hidden"}>
        <div class="pt-0 pb-0 pl-0 bg-base-100">
          <PolicyPanelComponent showBackLink={false} />
        </div>
      </div>
    </div>
  );
}

function Start() {
  return <StartPage />;
}

export default Start;
