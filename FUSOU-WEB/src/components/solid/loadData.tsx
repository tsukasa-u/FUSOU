import { useStore } from '@nanostores/solid';
import { sidePageItems, addSidePageItem, deleteSidePageItem } from '../states/sidePageMap';
import { createSignal, createUniqueId, Show, type Setter } from 'solid-js';
import { createStore } from 'solid-js/store';

export default function LoadDataComponent() {

  const [show_select_provider_dialog, set_show_select_provider_dialog] = createSignal(false);

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
      <div class="tab-content border-base-300 px-8 py-6 w-full">
        <div class="">
          Import your cloud data
          <div class="grid grid-cols-4 gap-4 py-2">
            <div class="rounded-sm border-1 border-base-300 py-4 btn btn-ghost h-full" onClick={() => show_modal("select_provider_dialog", set_show_select_provider_dialog)}>
              <div class="h-full">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50" class="size-10 text-base-content mx-auto" fill="currentColor" stroke="currentColor">
                  <path d="M 25 2 C 12.309295 2 2 12.309295 2 25 C 2 37.690705 12.309295 48 25 48 C 37.690705 48 48 37.690705 48 25 C 48 12.309295 37.690705 2 25 2 z M 25 4 C 36.609824 4 46 13.390176 46 25 C 46 36.609824 36.609824 46 25 46 C 13.390176 46 4 36.609824 4 25 C 4 13.390176 13.390176 4 25 4 z M 24 13 L 24 24 L 13 24 L 13 26 L 24 26 L 24 37 L 26 37 L 26 26 L 37 26 L 37 24 L 26 24 L 26 13 L 24 13 z"></path>
                </svg>
                <div class="h-2"></div>
                <div class="text-center">Add Storage</div>
              </div>
              {/* <button class="btn" >open modal</button> */}
              <Show when={show_select_provider_dialog}>
                <dialog id="select_provider_dialog" class="modal">
                  <div class="modal-box">
                    <form method="dialog">
                      <button class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" onClick={() => hide_modal(set_show_select_provider_dialog)}>✕</button>
                    </form>
                    <h3 class="text-lg font-bold text-start">Add Your DataBase</h3>
                    <p class="py-4 text-start">Slect provider</p>

                    <div class="grid grid-cols-3 gap-4 py-2">
                      <div class="border-1 border-base-300 p-4 btn h-full">
                        <div class="h-full">
                          <svg viewBox="-0.01999999999999999 -0.88 939.13 843.29" xmlns="http://www.w3.org/2000/svg" class="size-8 mx-auto"><path d="M641.86 570.64H298.27l-147.13 257c17.7 9 37.8 14.77 50.8 14.77 135.16 0 411-2 547.93-2 14.08 0 27.26-4.8 39.08-12.32z" fill="#4185f3" /><path d="M151.14 827.65l147.13-257H.13c-.15 17.86 6.2 34.2 16.15 52.84C44 675.35 90.9 758.25 118.45 801.55c6.79 10.67 33.75 26.64 32.69 26.1z" fill="#1767d1" /><path d="M641.86 570.64L789 828.05c19.07-12.12 34.61-31.32 44.7-49 22.78-39.87 61.3-106.26 87.87-151.21 12.35-20.9 17.15-39.67 16.85-57.22z" fill="#e94235" /><path d="M298.3 570.66L469.92 272.3 316.54 16.58c-16.59 10.91-30.78 25.72-37.22 37C212.37 171 77.5 411.65 9.68 530.59a73.54 73.54 0 0 0-9.59 40.07z" fill="#30a753" /><path d="M641.85 570.66L469.92 272.3 619.09 16.87c16.59 10.92 34.8 25.43 41.24 36.72C727.28 171 862.15 411.65 930 530.59c7 12.23 9.11 26.07 8.43 40.07z" fill="#f9bc00" /><path d="M316.52 16.62l153.4 255.68L619.09 16.87c-15.4-9-37.21-14.33-58.33-15C502-.09 406.74-.88 355.47 1.35c-12.64.55-38.79 15.16-38.95 15.27z" fill="#0f8038" /></svg>
                          <div class="h-2"></div>
                          <div class="text-center">Googl Drive</div>

                        </div>
                      </div>

                      <div class="border-1 border-base-300 p-4 btn h-full">
                        <div class="h-full">

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
            </div>
            <div class="rounded-sm border-1 border-base-300 py-4 btn btn-ghost h-full">
            </div>
          </div>
        </div>
      </div>

      <input type="radio" name="my_tabs_1" class="tab" aria-label="DB" />
      <div class="tab-content border-base-300 p-10 w-full">global cloud data</div>
    </div>
  </>;
}