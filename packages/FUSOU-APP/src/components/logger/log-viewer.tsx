import {
  createEffect,
  onCleanup,
  createSignal,
  createMemo,
  For,
  onMount,
} from "solid-js";
import "../../css/divider.css";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
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
  const [isLoading, setIsLoading] = createSignal(false);

  // UI state for search and filters
  const [search, setSearch] = createSignal("");
  const [levelFilter, setLevelFilter] = createSignal<string>("ALL");
  const [targetFilter, setTargetFilter] = createSignal<string>("ALL");

  // Load all logs from backend on mount
  onMount(async () => {
    setIsLoading(true);
    try {
      const allLogs = await invoke<MessageVisitor[]>("get_all_logs");
      // Process and add all logs to the store
      allLogs.forEach((payload) => {
        let message = payload.message ?? "";
        if (payload.content_type) {
          message += ` (${payload.content_type}) ${message}`;
        }
        if (payload.method && payload.uri) {
          message = `[${payload.method}] ${payload.uri} ${message}`;
        } else if (payload.status && payload.uri) {
          message = `[${payload.status}] ${payload.uri} ${message}`;
        }
        setLogStore(logStore.length, {
          datetime: payload.datetime || "",
          level: payload.level || "",
          target: payload.target || "",
          message,
        });
      });
    } catch (error) {
      console.error("Failed to load logs:", error);
    } finally {
      setIsLoading(false);
    }
  });

  // Derive unique targets from the store for the target filter dropdown
  const uniqueTargets = createMemo(() => {
    const set = new Set<string>();
    for (const e of logStore) set.add(e.target || "");
    return Array.from(set).filter((t) => t !== "");
  });

  // Simple color palette and deterministic assignment for unknown targets
  const palette = [
    "bg-sky-100 text-sky-800",
    "bg-emerald-100 text-emerald-800",
    "bg-rose-100 text-rose-800",
    "bg-amber-100 text-amber-800",
    "bg-indigo-100 text-indigo-800",
    "bg-violet-100 text-violet-800",
  ];

  function targetBadgeClass(target: string) {
    const wellKnown: Record<string, string> = {
      runtime: "bg-gray-100 text-gray-800",
      network: "bg-sky-100 text-sky-800",
      storage: "bg-emerald-100 text-emerald-800",
      api: "bg-indigo-100 text-indigo-800",
    };
    if (target in wellKnown) return wellKnown[target];
    // fallback deterministic hash
    let h = 0;
    for (let i = 0; i < target.length; i++)
      h = (h * 31 + target.charCodeAt(i)) | 0;
    const idx = Math.abs(h) % palette.length;
    return palette[idx];
  }

  // Color mapping for log levels
  function levelBadgeClass(level: string) {
    const map: Record<string, string> = {
      TRACE: "bg-gray-100 text-gray-800",
      DEBUG: "bg-sky-100 text-sky-800",
      INFO: "bg-emerald-100 text-emerald-800",
      WARN: "bg-amber-100 text-amber-800",
      ERROR: "bg-rose-100 text-rose-800",
    };
    return map[level] ?? "bg-gray-100 text-gray-800";
  }

  // Compute filtered logs based on search and filters
  const filteredLogs = createMemo(() => {
    const q = search().trim().toLowerCase();
    return logStore.filter((entry) => {
      if (levelFilter() !== "ALL" && entry.level !== levelFilter())
        return false;
      if (targetFilter() !== "ALL" && entry.target !== targetFilter())
        return false;
      if (!q) return true;
      return (
        entry.message.toLowerCase().includes(q) ||
        entry.target.toLowerCase().includes(q) ||
        entry.datetime.toLowerCase().includes(q)
      );
    });
  });

  // Reference to the list container so we can auto-scroll to bottom on new logs
  let listContainer: HTMLDivElement | undefined;

  // Auto-scroll to the latest log when filteredLogs grows
  createEffect(() => {
    const len = filteredLogs().length;
    // run after DOM updates
    setTimeout(() => {
      if (listContainer) {
        try {
          // Try to find rendered log entries and scroll the last one into view.
          const items = listContainer.querySelectorAll("[data-log-entry]");
          const last = items[items.length - 1] as HTMLElement | undefined;
          if (last && typeof last.scrollIntoView === "function") {
            last.scrollIntoView({ block: "end", behavior: "auto" });
            return;
          }
          // Fallback: scroll the container to bottom
          listContainer.scrollTop = listContainer.scrollHeight + 100; // extra padding
        } catch (e) {
          // ignore
        }
      }
    }, 0);
    return len;
  });

  createEffect(() => {
    let unlisten_data: UnlistenFn;
    (async () => {
      // eslint-disable-next-line solid/reactivity
      unlisten_data = await listen<MessageVisitor>("log-event", (event) => {
        // if (import.meta.env.DEV) console.log("log-event");

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
        <div class="flex flex-wrap items-center gap-2">
          <div class="mx-2 py-1 text-sm shrink-0">Log Table</div>
          <input
            class="input input-sm flex-1 min-w-[200px] max-w-md"
            placeholder="Search messages, target, datetime..."
            value={search()}
            onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          />
          <select
            class="select select-sm min-w-[120px]"
            value={levelFilter()}
            onChange={(e) =>
              setLevelFilter((e.target as HTMLSelectElement).value)
            }
          >
            <option value="ALL">All levels</option>
            <option value="TRACE">TRACE</option>
            <option value="DEBUG">DEBUG</option>
            <option value="INFO">INFO</option>
            <option value="WARN">WARN</option>
            <option value="ERROR">ERROR</option>
          </select>
          <select
            class="select select-sm min-w-[120px]"
            value={targetFilter()}
            onChange={(e) =>
              setTargetFilter((e.target as HTMLSelectElement).value)
            }
          >
            <option value="ALL">All targets</option>
            <For each={uniqueTargets()}>
              {(t) => <option value={t}>{t}</option>}
            </For>
          </select>
          <button
            class="btn btn-ghost btn-sm shrink-0"
            onClick={() => {
              setSearch("");
              setLevelFilter("ALL");
              setTargetFilter("ALL");
            }}
          >
            Clear
          </button>
          <button
            class="btn btn-ghost btn-sm shrink-0"
            onClick={async () => {
              setIsLoading(true);
              try {
                const allLogs = await invoke<MessageVisitor[]>("get_all_logs");
                setLogStore([]);
                allLogs.forEach((payload) => {
                  let message = payload.message ?? "";
                  if (payload.content_type) {
                    message += ` (${payload.content_type}) ${message}`;
                  }
                  if (payload.method && payload.uri) {
                    message = `[${payload.method}] ${payload.uri} ${message}`;
                  } else if (payload.status && payload.uri) {
                    message = `[${payload.status}] ${payload.uri} ${message}`;
                  }
                  setLogStore(logStore.length, {
                    datetime: payload.datetime || "",
                    level: payload.level || "",
                    target: payload.target || "",
                    message,
                  });
                });
              } catch (error) {
                console.error("Failed to reload logs:", error);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading()}
          >
            {isLoading() ? "Loading..." : "Reload"}
          </button>
        </div>

        <div class="h-2" />
        <div
          ref={(el) => (listContainer = el as HTMLDivElement)}
          class="rounded-box border-base-300 border"
          style={{ height: "calc(100dvh - 140px)", overflow: "auto" }}
        >
          <VList
            data={filteredLogs()}
            style={{
              height: "100%",
            }}
          >
            {(d) => (
              <div
                data-log-entry
                class="p-1 text-xs flex items-start gap-2 min-w-0"
              >
                <div class="px-2 shrink-0 text-nowrap text-[11px]">
                  {d.datetime}
                </div>
                <div class="px-2 shrink-0 w-16">
                  <span
                    class={`px-2 py-0.5 rounded-md text-[10px] whitespace-nowrap inline-block text-center w-full ${levelBadgeClass(d.level)}`}
                  >
                    {d.level}
                  </span>
                </div>
                <div class="px-2 flex-1 min-w-0 wrap-break-word">
                  <span
                    class={`px-2 py-0.5 rounded-full text-[11px] mr-2 whitespace-nowrap ${targetBadgeClass(d.target)}`}
                  >
                    {d.target}
                  </span>
                  <span class="break-all">{d.message}</span>
                </div>
              </div>
            )}
          </VList>
        </div>
      </div>
    </>
  );
}
