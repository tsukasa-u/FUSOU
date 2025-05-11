import { createSignal, createUniqueId, For, Match, Show, Switch, type Setter } from 'solid-js';
import { createStore } from 'solid-js/store';
import { MaterialSymbolsLightStorage } from '../../icons/solid/MaterialSymbolsLightStorage';
import { IconGoogleDrive } from '../../icons/solid/google_drive';
import { useStore } from '@nanostores/solid';
// import { Sessions, getSession } from '../states/supabaseSeetionMap';
import { Sessions } from '../states/persistentSupabaseSessionAtom';
import { IconGoogle } from '../../icons/solid/google';
import { check_file } from '../../db/googleDrive'

export default function LoadDataComponent() {

  const $Sessions = useStore(Sessions);

  const [show_select_provider_dialog, set_show_select_provider_dialog] = createSignal(false);
  const [show_select_accounts_dialog, set_show_select_accounts_dialog] = createSignal(false);
  const [select_provider, set_select_provider] = createSignal("");

  const [select_account_checkbox, set_select_account_checkbox] = createStore<boolean[]>(Array($Sessions().length))
  const [load_data_result, set_load_data_result] = createStore<({ result: boolean, err: string } | null)[]>(Array($Sessions().length).fill(null))

  type providerInfo = {
    id: string,
    name: string,
    access_token: string,
    expire_time: string,
    email: string,
  };
  const [provider_list, set_provider_list] = createStore<providerInfo[]>([])

  const show_modal = (name: string, fn: Setter<boolean>) => {
    fn(true);
    const dialogElement = document.getElementById(
      name,
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
  }

  return <>
    <div class="tabs tabs-border w-full ">
      <input type="radio" name="my_tabs_1" class="tab" aria-label="Local" />
      <div class="tab-content border-base-300 p-10 w-full">your local data</div>

      <input type="radio" name="my_tabs_1" class="tab" aria-label="Cloud" checked={true} />
      <div class="tab-content w-full">
        <div class="join join-vertical w-full">
          <div class="border-base-300 border-1 px-8 py-6 w-full join-item">
            Sign in beforehand and import your cloud data
            <div class="h-2"></div>
            <div class="grid grid-cols-4 gap-4 py-2">
              <div class="rounded-sm border-1 border-base-300 py-4 btn h-full" onClick={() => show_modal("select_provider_dialog", set_show_select_provider_dialog)}>
                <div class="h-full">
                  <MaterialSymbolsLightStorage class="size-16 mx-auto" />
                  <div class="h-2"></div>
                  <div class="text-center">Add Storage</div>
                </div>
                <Show when={show_select_provider_dialog}>
                  <dialog id="select_provider_dialog" class="modal">
                    <div class="modal-box">
                      <form method="dialog">
                        <button class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" onClick={() => hide_modal(set_show_select_provider_dialog)}>✕</button>
                      </form>
                      <h3 class="text-lg font-bold text-start">Add Your DataBase</h3>
                      <p class="py-4 text-start">Slect provider</p>

                      <div class="grid grid-cols-3 gap-4 py-2">
                        <div class="border-1 border-base-300 p-4 btn h-full" onClick={() => {
                          set_select_provider("google")
                          show_modal("select_accounts_dialog", set_show_select_accounts_dialog);
                        }}>
                          <div class="h-full">
                            <IconGoogleDrive class="size-8 mx-auto" />
                            <div class="h-2"></div>
                            <div class="text-center">Googl Drive</div>
                          </div>
                        </div>
                      </div>
                      <div class="modal-action">
                        <form method="dialog">
                          <button class="btn btn-info" onClick={() => hide_modal(set_show_select_provider_dialog)}>Done</button>
                        </form>
                      </div>
                    </div>
                    <form method="dialog" class="modal-backdrop">
                      <button onClick={() => hide_modal(set_show_select_provider_dialog)}>close</button>
                    </form>
                  </dialog>
                </Show>

                <Show when={show_select_accounts_dialog}>
                  <dialog id="select_accounts_dialog" class="modal">
                    <div class="modal-box">
                      <form method="dialog">
                        <button class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" onClick={() => hide_modal(set_show_select_accounts_dialog)}>✕</button>
                      </form>
                      <h3 class="text-lg font-bold text-start">Add Your DataBase</h3>
                      <p class="py-4 text-start">Slect accounts</p>

                      <ul class="list bg-base-100 rounded-box shadow-md text-left">
                        <li class="p-4 pb-2 text-xs opacity-60 tracking-wide">your accounts</li>
                        {
                          $Sessions().filter((s) => s.provider == select_provider()).map((session, i) => (
                            <li class="list-row" onClick={() => set_select_account_checkbox(i, !select_account_checkbox[i])}>
                              <div>
                                <Switch>
                                  <Match when={session.provider == "google"}>
                                    <IconGoogle class="size-10" />
                                  </Match>
                                </Switch>
                              </div>
                              <div>
                                <div>{session.username}</div>
                                <div class="text-xs font-semibold opacity-60">{session.email}</div>
                              </div>
                              <input type="checkbox" checked={select_account_checkbox[Number(i)]} class="checkbox my-auto checkbox-accent" />
                            </li>
                          ))
                        }
                      </ul>

                      <Show when={$Sessions().length == 0}>
                        <p class="py-4 text-start text-red-500">You have to SignIn your account at Sign In page</p>
                      </Show>

                      <div class="modal-action">
                        <form method="dialog">
                          <button class="btn btn-info" onClick={() => hide_modal(set_show_select_accounts_dialog)}>Done</button>
                        </form>
                      </div>
                    </div>
                    <form method="dialog" class="modal-backdrop">
                      <button onClick={() => hide_modal(set_show_select_accounts_dialog)}>close</button>
                    </form>
                  </dialog>
                </Show>
              </div>
              <For each={$Sessions()}>
                {(session, idx) => <>
                  <Show when={select_account_checkbox[idx()]}>
                    <div class="rounded-sm border-1 border-base-300 py-4 h-full">
                      <div class="h-full">
                        <Switch>
                          <Match when={session.provider == "google"}>
                            <IconGoogleDrive class="size-16 mx-auto" />
                          </Match>
                        </Switch>
                        <div class="h-2"></div>
                        <div class="text-center text-sm">{session.email}</div>
                      </div>
                    </div>
                  </Show>
                </>}
              </For>
            </div>
            <div class="h-2"></div>
            <div class="flex justify-end">
              <button class="btn btn-info" onClick={async () => {
                $Sessions().forEach(async (session, index) => {

                  if (select_account_checkbox[index]) {
                    let [result, status, message] = await check_file($Sessions()[index].providerToken, "fusou");
                    if (result) {
                      set_load_data_result(index, { result: true, err: "" });
                    } else {
                      set_load_data_result(index, { result: false, err: message });
                    }
                  } else {
                    set_load_data_result(index, null);
                  }
                });
              }}>Import Data</button>
            </div>
          </div>

          <Show when={load_data_result.filter((s) => s != null).length > 0}>
            <div class="border-base-300 border-1 px-8 py-6 w-full join-item">
              <For each={load_data_result}>
                {(load_data, index) => <>
                  <Show when={load_data?.result == false} fallback={<p>{$Sessions()[index()].email}: success to load data</p>}>
                    <p class="text-red-500">
                      {$Sessions()[index()].email}: failed to load data<br />{load_data?.err}</p>
                  </Show>
                </>}
              </For>
            </div>
          </Show>
        </div>
      </div>

      <input type="radio" name="my_tabs_1" class="tab" aria-label="DB" />
      <div class="tab-content border-base-300 p-10 w-full">global cloud data</div>
    </div>
  </>;
}