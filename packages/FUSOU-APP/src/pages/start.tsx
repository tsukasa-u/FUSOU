import "../css/preview.css";
import "../css/divider.css";
import "../css/justify_self_center.css";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  Show,
  Switch,
} from "solid-js";
import { invoke } from "@tauri-apps/api/core";

import IconCheckBoxGreen from "../icons/check_box_green";
import IconCheckBoxRed from "../icons/check_box_red";

import { location_route } from "../utility/location";
import { getRefreshToken, supabase } from "../utility/supabase";
import { useAuth } from "../utility/provider";
import { ThemeControllerComponent } from "../components/settings/theme";
import { createAsyncStore } from "@solidjs/router";

const launch_options: { [key: string]: number } = {
  run_proxy_server: 1,
  open_app: 1,
  open_kancolle: 1,
  open_kancolle_with_webview: 1,
  server: -1,
};

const server_list: { [key: string]: string } = {
  横須賀鎮守府: "w01y.kancolle-server.com", // 横須賀鎮守府
  新呉鎮守府: "w02k.kancolle-server.com", // 新呉鎮守府
  佐世保鎮守府: "w03s.kancolle-server.com", // 佐世保鎮守府
  舞鶴鎮守府: "w04m.kancolle-server.com", // 舞鶴鎮守府
  大湊警備府: "w05o.kancolle-server.com", // 大湊警備府
  トラック泊地: "w06k.kancolle-server.com", // トラック泊地
  リンガ泊地: "w07l.kancolle-server.com", // リンガ泊地
  ラバウル基地: "w08r.kancolle-server.com", // ラバウル基地
  ショートランド泊地: "w09s.kancolle-server.com", // ショートランド泊地
  ブイン基地: "w10b.kancolle-server.com", // ブイン基地
  タウイタウイ泊地: "w11t.kancolle-server.com", // タウイタウイ泊地
  パラオ泊地: "w12p.kancolle-server.com", // パラオ泊地
  ブルネイ泊地: "w13b.kancolle-server.com", // ブルネイ泊地
  単冠湾泊地: "w14h.kancolle-server.com", // 単冠湾泊地
  幌筵泊地: "w15p.kancolle-server.com", // 幌筵泊地
  宿毛湾泊地: "w16s.kancolle-server.com", // 宿毛湾泊地
  鹿屋基地: "w17k.kancolle-server.com", // 鹿屋基地
  岩川基地: "w18i.kancolle-server.com", // 岩川基地
  佐伯湾泊地: "w19s.kancolle-server.com", // 佐伯湾泊地
  柱島泊地: "w20h.kancolle-server.com", // 柱島泊地
  //     // "横須賀鎮守府":	"203.104.209.71",
  //     // "新呉鎮守府":	"203.104.209.87",
  //     // "佐世保鎮守府":	"125.6.184.215",
  //     // "舞鶴鎮守府":	"203.104.209.183",
  //     // "大湊警備府":	"203.104.209.150",
  //     // "トラック泊地":	"203.104.209.134",
  //     // "リンガ泊地":	"203.104.209.167",
  //     // "ラバウル基地":	"203.104.209.199",
  //     // "ショートランド泊地":	"125.6.189.7",
  //     // "ブイン基地":	"125.6.189.39",
  //     // "タウイタウイ泊地":	"125.6.189.71",
  //     // "パラオ泊地":	"125.6.189.103",
  //     // "ブルネイ泊地":	"125.6.189.135",
  //     // "単冠湾泊地":	"125.6.189.167",
  //     // "宿毛湾泊地":	"125.6.189.247",
  //     // "幌筵泊地":	"125.6.189.215",
  //     // "鹿屋基地":	"203.104.209.23",
  //     // "岩川基地":	"203.104.209.39",
  //     // "佐伯湾泊地":	"203.104.209.55",
  //     // "柱島泊地":	"203.104.209.102",
};

function open_auth_page() {
  invoke("check_open_window", { label: "main" }).then((flag) => {
    if (flag) {
      invoke("open_auth_page")
        .then(() => {
          console.log("open auth page");
        })
        .catch((err) => {
          console.error("open auth page error", err);
        });
    }
  });
}

function Start() {
  createEffect(location_route);

  const [runProxyServer, setRunProxyServer] = createSignal<boolean>(
    Boolean(launch_options["run_proxy_server"])
  );
  const [openApp, setOpenApp] = createSignal<boolean>(
    Boolean(launch_options["open_app"])
  );
  const [openKancolle, setOpenKancolle] = createSignal<boolean>(
    Boolean(launch_options["open_kancolle"])
  );
  const [openKancolleWithWebView, setOpenKancolleWithWebView] =
    createSignal<boolean>(
      Boolean(launch_options["open_kancolle_with_webview"])
    );
  const [server, setServer] = createSignal<number>(launch_options["server"]);

  const [pacServerHealth, setPacServerHealth] = createSignal<number>(-1);
  const [proxyServerHealth, setProxyServerHealth] = createSignal<number>(-1);

  const [advancesSettingsCollapse, setAdavncedSettingsCollpse] =
    createSignal<boolean>(false);

  const [authData, setAuthData] = useAuth();

  let tokensInput: HTMLInputElement | null = null;

  const parseAndApplyTokens = async (raw: string | null | undefined) => {
    if (!raw) return;
    try {
      const pairs = raw.split("&").map((p) => p.split("=", 2));
      const map: Record<string, string> = {};
      for (const [k, v] of pairs) {
        if (k) map[k] = v ?? "";
      }

      const access = map["supabase_access_token"];
      const refresh = map["supabase_refresh_token"];
      const provider = map["provider_refresh_token"];

      if (!access || !refresh || !provider) {
        console.error("Invalid token format, missing keys");
        return;
      }

      setAuthData({ accessToken: access, refreshToken: refresh });

      await invoke("set_refresh_token", {
        token: `${provider}&bearer`,
      });
      console.log("Tokens applied from clipboard/input");
    } catch (e) {
      console.error("Failed to parse/apply tokens:", e);
    }
  };

  // const navigate = useNavigate();

  createEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.access_token && session?.refresh_token) {
        invoke("set_supabase_session", {
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        }).catch((error) => {
          console.error("Failed to propagate Supabase session", error);
        });
      } else if (event === "SIGNED_OUT") {
        invoke("clear_supabase_session").catch((error) => {
          console.error("Failed to clear Supabase session", error);
        });
      }
    });

    onCleanup(() => {
      subscription.unsubscribe();
    });
  });

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

  createEffect(() => {
    if (authData.accessToken !== null && authData.refreshToken !== null) {
      supabase.auth
        .setSession({
          access_token: authData.accessToken,
          refresh_token: authData.refreshToken,
        })
        .then(({ data, error }) => {
          if (error) {
            console.error("Error setting session:", error);
          } else {
            console.log("Session set successfully:", data);
          }
        });
    }
  });

  createEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      if (import.meta.env.DEV) console.log("session", data, error);
      if (error) {
        console.error("Error getting session:", error);
        open_auth_page();
      } else {
        if (data.session == null) {
          open_auth_page();
        } else {
          if (data.session.user == null) {
            open_auth_page();
          } else {
            if (data.session.access_token && data.session.refresh_token) {
              invoke("set_supabase_session", {
                access_token: data.session.access_token,
                refresh_token: data.session.refresh_token,
              }).catch((error) => {
                console.error("Failed to propagate initial Supabase session", error);
              });
            }
            getRefreshToken(data.session.user.id)
              .then((refreshToken) => {
                if (refreshToken !== null) {
                  const token: string =
                    refreshToken + "&" + data.session.token_type;
                  invoke("set_refresh_token", {
                    token: token,
                  })
                    .then(() => {
                      console.log("refresh_token set");
                    })
                    .catch((err) => {
                      console.error("refresh_token error", err);
                    });
                } else {
                  console.error("Error getting refresh token");
                }
              })
              .catch((error) => {
                console.error("Error getting refresh token:", error);
              });
          }
        }
      }
    });
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

  const start_button_class = createMemo(() => {
    if (
      proxyServerHealth() == -1 ||
      pacServerHealth() == -1 ||
      run_proxy_flag() == -1
    )
      return "btn w-full btn-disabled btn-primary";
    return "btn w-full btn-primary border-primary-content";
  });

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
          <div class="flex flex-nowrap">
            <h1 class="mx-4 pt-4 text-2xl font-semibold">Launch Options</h1>
            <span class="flex-1" />
            <button
              class="place-self-end btn btn-sm btn-secondary border-secondary-content"
              onClick={check_server_status}
            >
              check server status
            </button>
            <span class="w-4" />
          </div>
          <div class="divider mt-0 mb-0 w-11/12 justify-self-center" />
          <div class="mx-4 flex">
            <div class="grid">
              <div class="py-2">
                <h2 class="text-lg font-semibold leading-4">
                  Run Proxy Server
                </h2>
                <p class="">
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
                        class={runProxyServer() ? "toggle toggle-sm toggle-primary rounded-sm [&::before]:rounded-xs bg-primary border-primary-content [&::before]:bg-emerald-50 [&::before]:border [&::before]:border-primary-content " : "toggle toggle-sm toggle-primary rounded-sm [&::before]:rounded-xs"}
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
                    class="select select-sm select-bordered w-full focus-within:outline-0 focus:outline-0"
                    disabled={!runProxyServer()}
                    onChange={(e) => {
                      launch_options["server"] = e.target.selectedIndex;
                      setServer(e.target.selectedIndex);
                    }}
                  >
                    <option selected>{auto_listen() ?? "Auto Listen"}</option>
                    <For each={Object.keys(server_list)}>
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
                        <IconCheckBoxRed class="h-6 w-6 mb-[2px] pr-1 text-base-100" />
                      </div>
                      <div class="h-6 self-center ml-4 text-nowrap mb-[2.5px] pr-1">
                        Pac server is not running
                      </div>
                    </Match>
                    <Match when={pacServerHealth() == 1}>
                      <div class="w-4 h-4">
                        <IconCheckBoxGreen class="h-6 w-6 mb-[2px] pr-1 text-base-100" />
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
                        class={openApp() ? "toggle toggle-sm toggle-primary rounded-sm [&::before]:rounded-xs bg-primary border-primary-content [&::before]:bg-emerald-50 [&::before]:border [&::before]:border-primary-content " : "toggle toggle-sm toggle-primary rounded-sm [&::before]:rounded-xs"}
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
                        class={openKancolle() ? "toggle toggle-sm toggle-primary rounded-sm [&::before]:rounded-xs bg-primary border-primary-content [&::before]:bg-emerald-50 [&::before]:border [&::before]:border-primary-content " : "toggle toggle-sm toggle-primary rounded-sm [&::before]:rounded-xs"}
                        checked={openKancolle()}
                      />
                    </label>
                  </div>
                </div>
                <div class="mx-4">
                  <div class="form-control">
                    <label class="label cursor-pointer">
                      <input
                        type="radio"
                        name="radio-10"
                        class={openKancolleWithWebView() ? "radio radio-secondary border-secondary-content [&:before]:bg-lime-50 [&:before]:border [&:before]:border-secondary-content bg-secondary" : "radio radio-secondary"}
                        disabled={!openKancolle()}
                        checked={openKancolleWithWebView()}
                        onClick={() => {
                          launch_options["open_kancolle_with_webview"] = 1;
                          setOpenKancolleWithWebView(true);
                        }}
                      />
                      <span class="label-text">Open with WebView</span>
                    </label>
                  </div>
                  <div class="form-control">
                    <label class="label cursor-pointer">
                      <input
                        type="radio"
                        name="radio-10"
                        class={!openKancolleWithWebView() ? "radio radio-secondary border-secondary-content [&:before]:bg-lime-50 [&:before]:border [&:before]:border-secondary-content bg-secondary" : "radio radio-secondary"}
                        disabled={!openKancolle()}
                        checked={!openKancolleWithWebView()}
                        onClick={() => {
                          launch_options["open_kancolle_with_webview"] = 0;
                          setOpenKancolleWithWebView(false);
                        }}
                      />
                      <span class="label-text">Open with native browser</span>
                    </label>
                  </div>
                </div>
              </div>
              {/* <div class="preview border-base-300 bg-base-100 rounded-box flex flex-wrap items-center justify-center gap-2 p-4 [border-width:var(--tab-border)]" style="">
                    </div> */}
            </div>
          </div>
          <div
            tabindex="0"
            class={
              "collapse collapse-arrow" +
              (advancesSettingsCollapse()
                ? " collapse-open"
                : " collapse-close")
            }
          >
            <a
              class="collapse-title text-lg font-semibold leading-4 cursor-pointer"
              id="advanced-settings"
              onClick={() =>
                setAdavncedSettingsCollpse(!advancesSettingsCollapse())
              }
            >
              Advanced Settings
            </a>
            <div class="collapse-content text-sm mx-4">
              <div class="font-semibold">
                Set provider (provider) (access/refresh) tokens
              </div>
              <fieldset class="fieldset">
                <legend class="fieldset-legen">input tokens for new session</legend>
                <div class="flex items-center gap-2">
                  <input
                    id="tokens"
                    ref={(el) => (tokensInput = el as HTMLInputElement)}
                    type="text"
                    class="flex-1 input input-sm focus-within:outline-0 focus:outline-0"
                    placeholder="provider_refresh_token=...&supabase_access_token=...&supabase_refresh_token=..."
                  />
                  <button
                    class="btn btn-sm btn-ghost"
                    onClick={async () => {
                      try {
                        const text = await navigator.clipboard.readText();
                        if (!tokensInput) return;
                        tokensInput.value = text;
                      } catch (e) {
                        console.error("Failed to read clipboard:", e);
                      }
                    }}
                    title="Paste from clipboard"
                  >
                    Paste
                  </button>
                  <button
                    class="btn btn-sm btn-secondary border-secondary-content"
                    onClick={() => parseAndApplyTokens(tokensInput?.value)}
                  >
                    Apply
                  </button>
                </div>
              </fieldset>

              <div class="h-4" />

              <div class="font-semibold">Set Theme</div>
              <div class="h-4" />
              <div class="flex justify-end">
                <ThemeControllerComponent />
              </div>
            </div>
          </div>
          <div class="h-4" />
          <div class="flex justify-center mx-4" id="start-button">
            <a
              role="button"
              class={start_button_class()}
              href="/app"
              onClick={() => {
                invoke("launch_with_options", { options: launch_options });
              }}
            >
              Start
            </a>
          </div>
          <div class="h-12" />
        </div>
        <div class="bg-base-100 min-h-dvh flex flex-1" />
      </div>
    </>
  );
}

export default Start;
