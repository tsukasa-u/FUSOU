import { createEffect, onCleanup, createSignal, createMemo, For } from "solid-js";
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

  // UI state for search and filters
  const [search, setSearch] = createSignal("");
  const [levelFilter, setLevelFilter] = createSignal<string>("ALL");
  const [targetFilter, setTargetFilter] = createSignal<string>("ALL");

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
    for (let i = 0; i < target.length; i++) h = (h * 31 + target.charCodeAt(i)) | 0;
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
      if (levelFilter() !== "ALL" && entry.level !== levelFilter()) return false;
      if (targetFilter() !== "ALL" && entry.target !== targetFilter()) return false;
      if (!q) return true;
      return (
        entry.message.toLowerCase().includes(q) ||
        entry.target.toLowerCase().includes(q) ||
        entry.datetime.toLowerCase().includes(q)
      );
    });
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
        <div class="flex items-center gap-2">
          <div class="mx-2 py-1 text-sm w-56">Log Table</div>
          <input
            class="input input-sm w-72"
            placeholder="Search messages, target, datetime..."
            value={search()}
            onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          />
          <select class="select select-sm" value={levelFilter()} onChange={(e) => setLevelFilter((e.target as HTMLSelectElement).value)}>
            <option value="ALL">All levels</option>
            <option value="TRACE">TRACE</option>
            <option value="DEBUG">DEBUG</option>
            <option value="INFO">INFO</option>
            <option value="WARN">WARN</option>
            <option value="ERROR">ERROR</option>
          </select>
          <select class="select select-sm" value={targetFilter()} onChange={(e) => setTargetFilter((e.target as HTMLSelectElement).value)}>
            <option value="ALL">All targets</option>
            <For each={uniqueTargets()}>{(t) => <option value={t}>{t}</option>}</For>
          </select>
          <button class="btn btn-ghost btn-sm" onClick={() => { setSearch(""); setLevelFilter("ALL"); setTargetFilter("ALL"); }}>
            Clear
          </button>
        </div>

        <div class="h-2" />
        <VList
          data={filteredLogs()}
          style={{
            height: "calc(100dvh - 120px)",
          }}
          class="rounded-box border-base-300 border"
        >
          {(d) => (
            <div class="p-1 text-xs flex items-center gap-2">
              <div class="px-2 w-40 text-nowrap">{d.datetime}</div>
              <div class="px-2 w-14 flex-none">
                <span class={`px-2 py-0.5 rounded-md text-[10px] ${levelBadgeClass(d.level)}`}>{d.level}</span>
              </div>
              <div class="px-2">
                <span class={`px-2 py-0.5 rounded-full text-[11px] mr-2 ${targetBadgeClass(d.target)}`}>{d.target}</span>
                {d.message}
              </div>
            </div>
          )}
        </VList>
      </div>
    </>
  );
}
