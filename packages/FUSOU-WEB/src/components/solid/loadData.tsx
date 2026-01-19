/** @jsxImportSource solid-js */

import {
  createMemo,
  createSignal,
  For,
  Match,
  Show,
  Switch,
  type Setter,
} from "solid-js";
import { createStore } from "solid-js/store";
import { MaterialSymbolsLightStorage } from "../../icons/solid/MaterialSymbolsLightStorage";
import { IconGoogleDrive } from "../../icons/solid/google_drive";
import { useStore } from "@nanostores/solid";
// import { Sessions, getSession } from '../states/supabaseSeetionMap';
import {
  Sessions,
  setSession,
  type SessionInfo,
} from "../states/persistentSupabaseSessionAtom";
import { IconGoogle } from "../../icons/solid/google";
import { check_file, refreshToken } from "../../db/googleDrive";
import {
  getPageData,
  PageData,
  setPageData,
  type PageStrageInfo,
} from "../states/persistentPageData";
import { sidePageSlected } from "../states/sidePageMap";

export default function LoadDataComponent() {
  const $Sessions = useStore(Sessions);
  const $PageData = useStore(PageData);
  const $sidePageSlected = useStore(sidePageSlected);

  const [show_select_provider_dialog, set_show_select_provider_dialog] =
    createSignal(false);
  const [show_select_accounts_dialog, set_show_select_accounts_dialog] =
    createSignal(false);
  const [select_provider, set_select_provider] = createSignal("");

  // const [select_account_checkbox, set_select_account_checkbox] = createStore<
  //   boolean[]
  // >(Array($Sessions().length));
  type SelectionFlag = { id: string; flag: boolean };

  const [select_account_checkbox, set_select_account_checkbox] = createStore({
    check: $Sessions().map((v: SessionInfo): SelectionFlag => ({
      id: v.id,
      flag: false,
    })),
    get_check(id: string): boolean {
      return (
        this.check.find((v: SelectionFlag) => v.id === id)?.flag ?? false
      );
    },
  });
  const [load_data_result, set_load_data_result] = createStore<
    ({ provider: String; email: String; result: boolean; err: string } | null)[]
  >(Array($Sessions().length).fill(null));

  const show_modal = (name: string, fn: Setter<boolean>) => {
    fn(true);
    const dialogElement = document.getElementById(
      name
    ) as HTMLDialogElement | null;
    dialogElement?.showModal();
  };

  const hide_modal = (fn: Setter<boolean>) => {
    const sleep = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    (async () => {
      fn(false);
      await sleep(10);
    })();
  };

  const PageDataDrive = createMemo(() => {
    let pagedata = $PageData().find((v) => v.id == $sidePageSlected().id);
    let storage_list = pagedata?.storage ?? [];
    let ret = storage_list.filter(
      (storage) =>
        $Sessions().find(
          (session, _index) =>
            session.provider == storage.provider &&
            session.email == storage.email &&
            select_account_checkbox.get_check(session.id)
        ) == undefined
    );
    return ret;
  });

  return (
    <>
      <div class="tabs tabs-border w-full ">
        <input type="radio" name="my_tabs_1" class="tab" aria-label="Local" />
        <div class="tab-content border-base-300 border-2 rounded-sm p-10 w-full">
          your local data
        </div>

        <input
          type="radio"
          name="my_tabs_1"
          class="tab"
          aria-label="Cloud"
          checked={true}
        />
        <div class="tab-content w-full">
          <div class="join join-vertical w-full">
            <div class="border-base-300 border-2 px-8 py-6 w-full join-item">
              Sign in beforehand and import your cloud data
              <div class="h-2"></div>
              <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 py-2">
                <div
                  class="rounded-sm border-2 border-base-300 py-4 btn h-full"
                  onClick={() =>
                    show_modal(
                      "select_provider_dialog",
                      set_show_select_provider_dialog
                    )
                  }
                >
                  <div class="h-full">
                    <MaterialSymbolsLightStorage class="size-16 mx-auto" />
                    <div class="h-2"></div>
                    <div class="text-center">Add Storage</div>
                  </div>
                  <Show when={show_select_provider_dialog}>
                    <dialog id="select_provider_dialog" class="modal">
                      <div class="modal-box">
                        <form method="dialog">
                          <button
                            class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
                            onClick={() =>
                              hide_modal(set_show_select_provider_dialog)
                            }
                          >
                            ✕
                          </button>
                        </form>
                        <h3 class="text-lg font-bold text-start">
                          Add Your DataBase
                        </h3>
                        <p class="py-4 text-start">Slect provider</p>

                        <div class="grid grid-cols-3 gap-4 py-2">
                          <div
                            class="border-2 border-base-300 p-4 btn h-full"
                            onClick={() => {
                              set_select_provider("google");
                              show_modal(
                                "select_accounts_dialog",
                                set_show_select_accounts_dialog
                              );
                            }}
                          >
                            <div class="h-full">
                              <IconGoogleDrive class="size-8 mx-auto" />
                              <div class="h-2"></div>
                              <div class="text-center">Googl Drive</div>
                            </div>
                          </div>
                        </div>
                        <div class="modal-action">
                          <form method="dialog">
                            <button
                              class="btn btn-info"
                              onClick={() =>
                                hide_modal(set_show_select_provider_dialog)
                              }
                            >
                              Done
                            </button>
                          </form>
                        </div>
                      </div>
                      <form method="dialog" class="modal-backdrop">
                        <button
                          onClick={() =>
                            hide_modal(set_show_select_provider_dialog)
                          }
                        >
                          close
                        </button>
                      </form>
                    </dialog>
                  </Show>

                  <Show when={show_select_accounts_dialog}>
                    <dialog id="select_accounts_dialog" class="modal">
                      <div class="modal-box">
                        <form method="dialog">
                          <button
                            class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
                            onClick={() =>
                              hide_modal(set_show_select_accounts_dialog)
                            }
                          >
                            ✕
                          </button>
                        </form>
                        <h3 class="text-lg font-bold text-start">
                          Add Your DataBase
                        </h3>
                        <p class="py-4 text-start">Slect accounts</p>

                        <ul class="list bg-base-100 rounded-box shadow-md text-left">
                          <li class="p-4 pb-2 text-xs opacity-60 tracking-wide">
                            your accounts
                          </li>
                          {$Sessions()
                            .filter((s) => s.provider == select_provider())
                            .map((session) => (
                              <li
                                class="list-row"
                                onClick={() => {
                                  set_select_account_checkbox("check", (v) => [
                                    ...v.filter((v) => v.id !== session.id),
                                    {
                                      id: session.id,
                                      flag: !select_account_checkbox.get_check(
                                        session.id
                                      ),
                                    },
                                  ]);
                                  // console.log(select_account_checkbox);
                                }}
                              >
                                <div>
                                  <Switch>
                                    <Match when={session.provider == "google"}>
                                      <IconGoogle class="size-10" />
                                    </Match>
                                  </Switch>
                                </div>
                                <div>
                                  <div>{session.username}</div>
                                  <div class="text-xs font-semibold opacity-60">
                                    {session.email}
                                  </div>
                                </div>
                                <input
                                  type="checkbox"
                                  checked={select_account_checkbox.get_check(
                                    session.id
                                  )}
                                  class="checkbox my-auto checkbox-accent"
                                />
                              </li>
                            ))}
                        </ul>

                        <Show when={$Sessions().length == 0}>
                          <p class="py-4 text-start text-red-500">
                            You have to SignIn your account at Sign In page
                          </p>
                        </Show>

                        <div class="modal-action">
                          <form method="dialog">
                            <button
                              class="btn btn-info"
                              onClick={() =>
                                hide_modal(set_show_select_accounts_dialog)
                              }
                            >
                              Done
                            </button>
                          </form>
                        </div>
                      </div>
                      <form method="dialog" class="modal-backdrop">
                        <button
                          onClick={() =>
                            hide_modal(set_show_select_accounts_dialog)
                          }
                        >
                          close
                        </button>
                      </form>
                    </dialog>
                  </Show>
                </div>
                <For each={$Sessions()}>
                  {(session) => (
                    <>
                      <Show
                        when={select_account_checkbox.get_check(session.id)}
                      >
                        <div class="rounded-sm border-2 border-base-300 py-4 h-full">
                          <div class="h-full">
                            <Switch>
                              <Match when={session.provider == "google"}>
                                <IconGoogleDrive class="size-16 mx-auto" />
                              </Match>
                            </Switch>
                            <div class="h-2"></div>
                            <div class="text-center text-sm">
                              {session.email}
                            </div>
                          </div>
                        </div>
                      </Show>
                    </>
                  )}
                </For>
                <For each={PageDataDrive()}>
                  {(storage) => (
                    <>
                      <div class="rounded-sm border-2 border-base-300 py-4 h-full opacity-50 border-dashed">
                        <div class="h-full">
                          <Switch>
                            <Match when={storage.provider == "google"}>
                              <IconGoogleDrive class="size-16 mx-auto" />
                            </Match>
                          </Switch>
                          <div class="h-2"></div>
                          <div class="text-center text-sm">{storage.email}</div>
                        </div>
                      </div>
                    </>
                  )}
                </For>
              </div>
              <div class="h-2"></div>
              <div class="flex justify-end">
                <button
                  class="btn btn-info w-40"
                  onClick={async (e) => {
                    e.target.classList.add("btn-disabled");
                    let storage_data: PageStrageInfo[] = [];
                    $Sessions().forEach(async (session, index) => {
                      if (select_account_checkbox.get_check(session.id)) {
                        let refreshedToken = await refreshToken(
                          session.providerRefreshToken
                        );
                        if (refreshedToken.newRefreshToken) {
                          setSession({
                            ...session,
                            providerRefreshToken:
                              refreshedToken.newRefreshToken,
                            providerToken: refreshedToken.accessToken,
                          });
                        } else {
                          setSession({
                            ...session,
                            providerToken: refreshedToken.accessToken,
                          });
                        }
                        let [result, message] = await check_file(
                          session.providerToken,
                          "fusou"
                        );
                        if (result) {
                          set_load_data_result(index, {
                            provider: session.provider,
                            email: session.email,
                            result: true,
                            err: "",
                          });
                        } else {
                          set_load_data_result(index, {
                            provider: session.provider,
                            email: session.email,
                            result: false,
                            err: message,
                          });
                        }
                        storage_data.push({
                          id: session.id,
                          email: session.email,
                          provider: session.provider,
                          fillter: select_account_checkbox.get_check(
                            session.id
                          ),
                          access_token: session.providerToken,
                          refresh_token: session.providerRefreshToken,
                        });
                      } else {
                        set_load_data_result(index, null);
                      }
                    });
                    let pagedata = getPageData(sidePageSlected.get().id);
                    setPageData({
                      ...pagedata,
                      storage: storage_data,
                    });
                    e.target.classList.remove("btn-disabled");
                  }}
                >
                  Register Storage
                </button>
              </div>
            </div>

            <Show when={load_data_result.filter((s) => s != null).length > 0}>
              <div class="border-base-300 border-t-0 border-2 px-8 py-6 w-full join-item">
                <For each={load_data_result}>
                  {(load_data, _index) => (
                    <>
                      <Show when={load_data !== null}>
                        <Switch>
                          <Match when={load_data?.result == true}>
                            <p>
                              {`[${load_data!.provider}] ${load_data!.email} : success to load data`}
                            </p>
                          </Match>
                          <Match when={load_data?.result == false}>
                            <p class="text-red-500">
                              {`[${load_data!.provider}] ${load_data!.email} : failed to load data`}
                              <br />
                              {`${load_data?.err}`}
                            </p>
                          </Match>
                        </Switch>
                      </Show>
                    </>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>

        <input type="radio" name="my_tabs_1" class="tab" aria-label="DB" />
        <div class="tab-content border-base-300 border-2 rounded-sm p-10 w-full">
          global cloud data
        </div>
      </div>
    </>
  );
}
