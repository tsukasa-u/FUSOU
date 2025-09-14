import { createEffect, onCleanup } from "solid-js";
import "../../css/divider.css";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import { VList } from "virtua/solid";
import { createStore } from "solid-js/store";

export function LogViewerComponent() {
  type MessageVisitor = {
    datetime: string;
    level: string;
    target: string;
    metadata: string;
    message?: string;
    method?: string;
    uri?: string;
    status?: string;
    content_type?: string;
  };

  type LogEntry = {
    datetime: string;
    level: string;
    target: string;
    message: string;
  };

  const [logStore, setLogStore] = createStore<LogEntry[]>([]);

  createEffect(() => {
    let unlisten_data: UnlistenFn;
    (async () => {
      // eslint-disable-next-line solid/reactivity
      unlisten_data = await listen<MessageVisitor>("log-event", (event) => {
        if (import.meta.env.DEV) console.log("log-event");

        let message = event.payload.message ?? "";
        if (event.payload.content_type) {
          message += ` (${event.payload.content_type}) ${message}`;
        }
        if (event.payload.method && event.payload.uri) {
          message = `[${event.payload.method}] ${event.payload.uri} ${message}`;
        } else if (event.payload.status && event.payload.uri) {
          message = `[${event.payload.status}] ${event.payload.uri} ${message}`;
        }
        setLogStore(logStore.length, { ...event.payload, message });
      });
    })();

    onCleanup(() => {
      if (unlisten_data) unlisten_data();
    });
  });

  return (
    <>
      <div class="py-2 mx-4">
        <div class="mx-2 py-1 text-sm w-56">Log Table</div>
        <div class="h-2" />
        <VList
          data={logStore}
          style={{
            height: "calc(100dvh - 86px)",
          }}
          class="rounded-box border-base-300 border-1"
        >
          {(d) => (
            <div class="p-[2px] text-xs flex flex-nowrap">
              <div class="px-2 w-38 text-nowrap">{d.datetime}</div>
              <div class="px-2 w-14 flex-none">{d.level}</div>
              <div class="px-2">
                [{d.target}] {d.message}
              </div>
            </div>
          )}
        </VList>
      </div>
    </>
  );
}
