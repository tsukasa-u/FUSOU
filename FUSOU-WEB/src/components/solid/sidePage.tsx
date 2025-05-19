import { useStore } from '@nanostores/solid';
import { sidePageSlected, setSidePageSlected, deleteSidePageSlected } from '../states/sidePageMap';
import { createEffect, createSignal, createUniqueId, Show, type Setter } from 'solid-js';
import { PageData, setPageData, getPageData, deletePageData, type PageInfo } from '../states/persistentPageData';

export default function SidePage() {

  // const $sidePageItems = useStore(PageData);
  const $sidePageSlected = useStore(sidePageSlected);
  const $pageData = useStore(PageData);

  const [show_add_page_dialog, set_show_add_page_dialog] = createSignal(false);
  const [show_rename_page_dialog, set_show_rename_page_dialog] = createSignal(false);
  const [rename_index, set_rename_index] = createSignal("");
  const [show_add_error_msg, set_show_add_error_msg] = createSignal(0);
  const [add_page_title, set_add_page_title] = createSignal("");
  const [side_page_selected, set_side_page_selected] = createSignal("");

  createEffect(() => {
    setSidePageSlected(side_page_selected())
  });

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

  const duplicate = (id: string) => {
    let duplicate_id = createUniqueId()
    // addSidePageItem({
    //   id: duplicate_id,
    //   name: $sidePageItems()[id].name + "-copy"
    // });
    let page_data = getPageData(id);
    setPageData({
      ...page_data,
      id: duplicate_id,
      name: page_data.name + "-copy",
    });
  }

  const check_name = (): string => {
    let page_title = add_page_title();
    if (add_page_title().length == 0) {
      page_title = "Untitled"
    }
    if ($pageData().some((v) => v.name == page_title) || page_title == "Untitled") {
      let index = 1
      page_title = page_title + "-" + index;
      while ($pageData().some((v) => v.name == page_title)) {
        index += 1;
        page_title = page_title.replace(/(.*)(-[0-9]+)/, `$1-`) + String(index);
      }
    }

    return page_title;
  }

  return (
    <>
      {$pageData().map((v) => [v.id, v] as [string, PageInfo]).map(([unique_id, sidePageItem]) => (
        <li>
          <div class={side_page_selected() == unique_id ? "join bg-orange-500 p-0" : "join p-0"}>
            <div class="truncate join-item py-2 px-3" onClick={() => { set_side_page_selected(unique_id) }}>{sidePageItem.name}</div>
            <div class="flex-1 join-item" onClick={() => { set_side_page_selected(unique_id) }}></div>
            <div class="dropdown dropdown-end join-item">
              <div tabindex="0" role="button" class="h-9 w-10 flex justify-center items-center">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 512" class="size-4 text-base-content">
                  {/* <!--!Font Awesome Free 6.7.2 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc.--> */}
                  <path d="M64 360a56 56 0 1 0 0 112 56 56 0 1 0 0-112zm0-160a56 56 0 1 0 0 112 56 56 0 1 0 0-112zM120 96A56 56 0 1 0 8 96a56 56 0 1 0 112 0z" />
                </svg>
              </div>
              <ul tabindex="0" class="dropdown-content menu bg-base-100 rounded-box z-1 w-52 p-2 shadow-sm">
                <li><a onClick={() => duplicate(unique_id)}>Duplicate</a></li>
                <li><a onClick={() => {
                  deletePageData(unique_id);
                  deleteSidePageSlected();
                }}>Delete</a></li>
                <li><a onClick={() => {
                  set_rename_index(unique_id);
                  show_modal("rename_dialog", set_show_rename_page_dialog);
                }}>Rename</a></li>
              </ul>
            </div>
          </div>
        </li>
      ))}

      <li>
        <a onClick={() => show_modal("add_page_modal", set_show_add_page_dialog)}>
          <div>Add New Page</div>
          <div></div>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" class="size-4 text-base-content">
            {/* <!--!Font Awesome Free 6.7.2 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc.--> */}
            <path d="M256 80c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 144L48 224c-17.7 0-32 14.3-32 32s14.3 32 32 32l144 0 0 144c0 17.7 14.3 32 32 32s32-14.3 32-32l0-144 144 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-144 0 0-144z" />
          </svg>
        </a>
      </li>

      <Show when={show_add_page_dialog()}>
        <dialog id="add_page_modal" class="modal">
          <div class="modal-box">
            <form method="dialog">
              <button class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" onClick={() => hide_modal(set_show_add_page_dialog)}>x</button>
            </form>
            <h3 class="text-lg font-bold">Add new Page</h3>
            <p class="py-4">Enter a new page name</p>
            <fieldset class="fieldset">
              <input type="text" placeholder="Untitled" class="input w-full focus:outline-0" onInput={(e) => {
                let check_result = $pageData().some((v) => v.name == e.target.value)
                set_show_add_error_msg(check_result ? 1 : 0)
                set_add_page_title(e.target.value);
              }} />
              <p class="label bg-text-red-300" id="add_page_error_msg_text">
                <Show when={show_add_error_msg() == 1}>
                  Duplicate names are exist
                </Show>
              </p>
            </fieldset>
            <div class="modal-action">
              <form method="dialog">
                <div class="flex flex-nowrap">
                  <button class="btn" onClick={() => hide_modal(set_show_add_page_dialog)}>Close</button>
                  <div class="w-4"></div>
                  <button class={"btn btn-info p-4"}
                    onClick={() => {
                      hide_modal(set_show_add_page_dialog);
                      let page_title = check_name();
                      let unique_id = createUniqueId()
                      // addSidePageItem(
                      //   {
                      //     id: createUniqueId(),
                      //     name: page_title
                      //   }
                      // );
                      let page_data = getPageData(unique_id);
                      setPageData({
                        ...page_data,
                        id: unique_id,
                        name: page_title,
                      });
                    }}>Create</button>
                </div>
              </form>
            </div>
          </div>
          <form method="dialog" class="modal-backdrop">
            <button onClick={() => hide_modal(set_show_add_page_dialog)}>close</button>
          </form>
        </dialog>
      </Show>

      <Show when={show_rename_page_dialog()}>
        <dialog id="rename_dialog" class="modal">
          <div class="modal-box">
            <form method="dialog">
              <button class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" onClick={() => hide_modal(set_show_rename_page_dialog)}>x</button>
            </form>
            <h3 class="text-lg font-bold">Rename page name</h3>
            <p class="py-4">Enter a new page name</p>
            <fieldset class="fieldset">
              <input type="text" placeholder="Untitled" class="input w-full focus:outline-0" value={getPageData(rename_index()).name} onInput={(e) => {
                let check_result = $pageData().some((v) => v.name == e.target.value)
                set_show_add_error_msg(check_result ? 1 : 0)
                set_add_page_title(e.target.value);
              }} />
              <p class="label bg-text-red-300" id="add_page_error_msg_text">
                <Show when={show_add_error_msg() == 1}>
                  Duplicate names are exist
                </Show>
              </p>
            </fieldset>
            <div class="modal-action">
              <form method="dialog">
                <div class="flex flex-nowrap">
                  <button class="btn" onClick={() => hide_modal(set_show_rename_page_dialog)}>Close</button>
                  <div class="w-4"></div>
                  <button class={"btn btn-info p-4"}
                    onClick={() => {
                      hide_modal(set_show_rename_page_dialog);
                      let page_title = check_name();
                      // console.log(page_title);
                      // addSidePageItem(
                      //   {
                      //     id: rename_index(),
                      //     name: page_title
                      //   }
                      // )
                      let page_data = getPageData(rename_index());
                      setPageData({
                        ...page_data,
                        name: page_title,
                      });
                    }}>Done</button>
                </div>
              </form>
            </div>
          </div>
          <form method="dialog" class="modal-backdrop">
            <button onClick={() => hide_modal(set_show_rename_page_dialog)}>close</button>
          </form>
        </dialog>
      </Show>
    </>
  )
}