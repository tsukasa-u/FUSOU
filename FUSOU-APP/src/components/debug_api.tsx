import { createStore } from "solid-js/store";
import "../css/divider.css";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { useDebugApi } from "../utility/provider";
import { IconXMark } from "../icons/X-mark";
import IconChevronRight from "../icons/chevron_right";
import IconChevronDoubleRight from "../icons/chevron_double_right";
import IconChevronDoubleLeft from "../icons/chevron_double_left";
import IconChevronLeft from "../icons/chevron_left";
import IconSort from "../icons/sort";

export function DebugApi() {
  const [filecheackSignals, setFilecheackSignals] = createStore<boolean[]>([
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
  ]);
  const [fileApi, setFileApi] = createSignal<string[]>([]);
  const [pageCounter, setPageCounter] = createSignal<number>(1);
  const [apiCounter, setApiCounter] = createSignal<number>(0);
  const [checkBoxSignals, setCheckBoxSignals] = createSignal<boolean>(false);

  const [debug_api] = useDebugApi();

  createEffect(() => {
    invoke("read_dir", { path: "." });
    setPageCounter(1);
  });

  const fileExistSignals = createMemo<boolean[]>(() => {
    let signals: boolean[] = [];
    for (let i = 0; i < filecheackSignals.length; i++) {
      signals.push(
        fileApi().findIndex(
          (v) => v == debug_api[1][i + (pageCounter() - 1) * 10],
        ) < 0,
      );
    }
    return signals;
  });

  return (
    <>
      <div class="flex flex-nowrap">
        <h1 class="mx-4 pt-4 text-2xl font-semibold">Debug API</h1>
        <span class="flex-1" />
        <span class="w-4" />
      </div>

      <div class="mx-4">
        <hr class="mt-4 mb-4" />

        <select
          class="select select-sm w-full"
          onInput={(e) => {
            invoke("read_dir", { path: e.currentTarget.value });
            setPageCounter(1);
            setFilecheackSignals([
              false,
              false,
              false,
              false,
              false,
              false,
              false,
              false,
              false,
              false,
            ]);
          }}
        >
          <option disabled selected>
            Select directory
          </option>
          <For each={debug_api[0]}>{(dir) => <option>{dir}</option>}</For>
        </select>

        <hr class="mt-4 mb-4" />

        <div class="flex flex-nowrap">
          <div class="w-5/12">
            <div class="pb-4">
              <button
                class="btn btn-square bg-base-100"
                onClick={() => {
                  setCheckBoxSignals(!checkBoxSignals());
                  setFilecheackSignals(
                    fileExistSignals().map((v) =>
                      v ? checkBoxSignals() : false,
                    ),
                  );
                }}
              >
                <input
                  type="checkbox"
                  class="checkbox checkbox-md"
                  checked={checkBoxSignals()}
                />
              </button>
            </div>
            <ul class="menu menu-xs bg-base-100 rounded-box w-full">
              <For each={filecheackSignals}>
                {(signal, idx) => (
                  <Show
                    when={
                      debug_api[1][idx() + (pageCounter() - 1) * 10] !=
                      undefined
                    }
                    fallback={
                      <li>
                        <a class="h-6" />
                      </li>
                    }
                  >
                    <li>
                      <a
                        onClick={() => {
                          if (fileExistSignals()[idx()]) {
                            setFilecheackSignals({ [idx()]: !signal });
                          }
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={signal}
                          class="checkbox checkbox-xs"
                          disabled={!fileExistSignals()[idx()]}
                        />
                        {
                          debug_api[1][idx() + (pageCounter() - 1) * 10]
                            .split("/")
                            .reverse()[0]
                        }
                        {/* <input type="checkbox" checked={signal} class="checkbox checkbox-xs" disabled={false} />{debug_api[1][idx() + (pageCounter() - 1) * 10].split("/").reverse()[0]} */}
                      </a>
                    </li>
                  </Show>
                )}
              </For>
            </ul>
            <div class="grid grid-cols-4 gap-4 py-4 justify-self-center w-9/12">
              <button
                class="btn btn-square bg-base-100"
                onClick={() => {
                  setPageCounter(1);
                  setFilecheackSignals([
                    false,
                    false,
                    false,
                    false,
                    false,
                    false,
                    false,
                    false,
                    false,
                    false,
                  ]);
                  setCheckBoxSignals(false);
                }}
              >
                <IconChevronDoubleLeft class="h-4" />
              </button>
              <button
                class="btn btn-square bg-base-100"
                onClick={() => {
                  if (pageCounter() == 1) return;
                  setPageCounter(pageCounter() - 1);
                  setFilecheackSignals([
                    false,
                    false,
                    false,
                    false,
                    false,
                    false,
                    false,
                    false,
                    false,
                    false,
                  ]);
                  setCheckBoxSignals(false);
                }}
              >
                <IconChevronLeft class="h-4" />
              </button>
              <button
                class="btn btn-square bg-base-100"
                onClick={() => {
                  if (pageCounter() == Math.ceil(debug_api[1].length / 10))
                    return;
                  setPageCounter(pageCounter() + 1);
                  setFilecheackSignals([
                    false,
                    false,
                    false,
                    false,
                    false,
                    false,
                    false,
                    false,
                    false,
                    false,
                  ]);
                  setCheckBoxSignals(false);
                }}
              >
                <IconChevronRight class="h-4" />
              </button>
              <button
                class="btn btn-square bg-base-100"
                onClick={() => {
                  setPageCounter(Math.ceil(debug_api[1].length / 10));
                  setFilecheackSignals([
                    false,
                    false,
                    false,
                    false,
                    false,
                    false,
                    false,
                    false,
                    false,
                    false,
                  ]);
                  setCheckBoxSignals(false);
                }}
              >
                <IconChevronDoubleRight class="h-4" />
              </button>
            </div>
            <div class="justify-self-center w-28">
              <div class="flex flex-nowrap justify-center">
                {pageCounter()} / {Math.ceil(debug_api[1].length / 10)}
              </div>
            </div>
          </div>

          <div class="grid grid-rows-1 place-content-center self-center gap-4 w-1/6 p-4 h-36">
            <button
              class="btn btn-square bg-base-100"
              style={{ "z-index": 99 }}
              onClick={() => {
                // let file_list = fileApi();
                let file_list: string[] = [];
                for (const item of fileApi()) {
                  if (item !== undefined && item !== null && item !== "") file_list.push(item);
                }
                for (let i = 0; i < filecheackSignals.length; i++) {
                  if (filecheackSignals[i] && fileExistSignals()[i]) {
                    let file = debug_api[1][i + (pageCounter() - 1) * 10];
                    if (file !== undefined && file !== null && file !== "") file_list.push(file);
                  }
                }
                setFileApi(file_list);
              }}
            >
              <IconChevronRight class="h-4" />
            </button>
          </div>

          <div class="w-5/12">
            <div class="pb-4">
              <button
                class="btn btn-square bg-base-100"
                onClick={() => {
                  let file_list: string[] = [];
                  for (let i = 0; i < fileApi().length; i++) {
                    file_list.push(fileApi()[i]);
                  }
                  file_list.sort();
                  setFileApi(file_list);
                }}
              >
                <IconSort class="h-4" />
              </button>
              <span class="px-2" />
              <button
                class="btn btn-square bg-base-100"
                onClick={() => {
                  let file_list: string[] = [];
                  setFileApi(file_list);
                }}
              >
                <IconXMark class="h-4" />
              </button>
            </div>
            <div class="w-full h-96" style={{ "overflow-y": "auto" }}>
              <ul class="menu menu-xs bg-base-100 rounded-box w-full h-full">
                <For each={fileApi()}>
                  {(file, file_idx) => (
                    <li>
                      <a>
                        <div class="w-4 text-right">{file_idx() + 1}</div>
                        {file.split("/").reverse()[0]}
                        <span class="w-max" />
                        <button
                          class="btn btn-circle btn-xs"
                          onClick={() => {
                            let file_list: string[] = [];
                            for (let i = 0; i < fileApi().length; i++) {
                              if (i != file_idx()) {
                                file_list.push(fileApi()[i]);
                              }
                            }
                            setFileApi(file_list);
                          }}
                        >
                          <IconXMark class="h-4" />
                        </button>
                      </a>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </div>
        </div>

        <hr class="mt-4" />

        <div class="grid grid-cols-3 gap-4 py-4 justify-self-center w-2/6">
          <button
            class="btn bg-base-100"
            onClick={() => {
              setApiCounter(0);
            }}
          >
            Reset
          </button>
          <button
            class="btn bg-base-100"
            onClick={() => {
              if (apiCounter() >= fileApi().length) return;
              setApiCounter(apiCounter() + 1);
              invoke("read_emit_file", { path: fileApi()[apiCounter() - 1] });
            }}
          >
            Next
          </button>
        </div>
        <div class="bg-base-100 rounded-box p-2">
          file: ({apiCounter()}/{fileApi().length}) :
          <Show
            when={apiCounter() > 0 && fileApi().length > 0}
            fallback={"No file data"}
          >
            {fileApi()[apiCounter() - 1].split("/").reverse()[0]}
          </Show>
        </div>

        <hr class="mt-4" />
      </div>
    </>
  );
}
