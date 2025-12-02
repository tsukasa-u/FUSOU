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
  const [showScrollButton, setShowScrollButton] = createSignal(true);

  // Scroll behavior tuning constants
  // Small margin to tolerate minor layout shifts when judging "at bottom".
  const SCROLL_BOTTOM_MARGIN_PX = 8;
  // If remaining scroll distance is below this threshold, treat as near bottom
  // and auto-scroll on new logs.
  const NEAR_BOTTOM_THRESHOLD_PX = 200;
  // Extra padding to ensure reaching absolute bottom with virtualized lists.
  const EXTRA_SCROLL_PADDING_PX = 400;

  const MAX_ITERATIONS = 10;

  // Load all logs from backend on mount
  onMount(() => reloadLogs());

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

  // Helper function to process message payload
  const processMessagePayload = (payload: MessageVisitor): string => {
    let message = payload.message ?? "";
    if (payload.content_type) {
      message += ` (${payload.content_type}) ${message}`;
    }
    if (payload.method && payload.uri) {
      message = `[${payload.method}] ${payload.uri} ${message}`;
    } else if (payload.status && payload.uri) {
      message = `[${payload.status}] ${payload.uri} ${message}`;
    }
    return message;
  };

  // Helper function to add log entry to store
  const addLogEntry = (payload: MessageVisitor) => {
    const message = processMessagePayload(payload);
    setLogStore(logStore.length, {
      datetime: payload.datetime || "",
      level: payload.level || "",
      target: payload.target || "",
      message,
    });
  };

  // Helper function to reload all logs
  const reloadLogs = async () => {
    setIsLoading(true);
    try {
      const allLogs = await invoke<MessageVisitor[]>("get_all_logs");
      setLogStore([]);
      allLogs.forEach(addLogEntry);
    } catch (error) {
      console.error("Failed to reload logs:", error);
    } finally {
      setIsLoading(false);
      setTimeout(checkScrollPosition, 200);
    }
  };

  // Helper function to clear all filters
  const clearFilters = () => {
    setSearch("");
    setLevelFilter("ALL");
    setTargetFilter("ALL");
  };

  // Reference to the list container so we can auto-scroll to bottom on new logs
  let listContainer: HTMLDivElement | undefined;
  let vlistScrollElement: HTMLElement | undefined;

  // Handle scroll to detect if user is at bottom (element-based)
  const handleScroll = () => {
    const scrollElement = vlistScrollElement || findScrollElement();
    if (!scrollElement) return;
    
    const { scrollTop, scrollHeight, clientHeight } = scrollElement;
    const maxScroll = scrollHeight - clientHeight;
    const remaining = maxScroll - scrollTop;
    
    // If remaining scroll is within margin, we're at bottom
    const isAtBottom = remaining <= SCROLL_BOTTOM_MARGIN_PX;
    setShowScrollButton(!isAtBottom);
  };

  // Find the actual scrollable element
  const findScrollElement = (): HTMLElement | null => {
    if (!listContainer) return null;
    
    // VList creates a scrollable div inside - find it by checking all children
    const walkElements = (el: Element): HTMLElement | null => {
      if (el instanceof HTMLElement) {
        const style = window.getComputedStyle(el);
        const isScrollable = 
          (style.overflow === 'auto' || style.overflow === 'scroll' ||
           style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight;
        
        if (isScrollable) {
          el.removeEventListener('scroll', handleScroll);
          el.addEventListener('scroll', handleScroll, { passive: true });
          return el;
        }
      }
      
      for (const child of Array.from(el.children)) {
        const found = walkElements(child);
        if (found) return found;
      }
      return null;
    };
    
    const found = walkElements(listContainer);
    if (found) {
      vlistScrollElement = found;
      return found;
    }
    
    return listContainer;
  };

  // Check initial scroll position after mount
  const checkScrollPosition = () => {
    handleScroll();
  };

  // Scroll to bottom function - handles virtualized list by scrolling in stages
  const scrollToBottom = () => {
    if (!listContainer) return;
    
    const scrollElement = findScrollElement();
    if (!scrollElement) {
      return;
    }

    
    // Function to scroll and check if we need to continue
    const scrollStep = (iteration: number) => {
      const { scrollTop, scrollHeight, clientHeight } = scrollElement;
      const maxScroll = scrollHeight - clientHeight;
      const remaining = maxScroll - scrollTop;
    
      
      // If we're within threshold of bottom, we're done
      if (remaining <= SCROLL_BOTTOM_MARGIN_PX) {
        setTimeout(() => checkScrollPosition(), 100);
        return;
      }
      
      if (iteration > MAX_ITERATIONS) {
        setTimeout(() => checkScrollPosition(), 100);
        return;
      }
      
      // Scroll to current max
      scrollElement.scrollTo({
        top: maxScroll + EXTRA_SCROLL_PADDING_PX,
        behavior: iteration === 1 ? 'smooth' : 'auto', // Smooth only first time
      });
      
      // Wait for layout update and continue
      setTimeout(() => scrollStep(iteration + 1), 150);
    };
    
    scrollStep(1);
  };

  // Copy all visible logs to clipboard
  const copyLogsToClipboard = async () => {
    const logs = filteredLogs();
    const text = logs
      .map((entry) => `${entry.datetime} [${entry.level}] [${entry.target}] ${entry.message}`)
      .join('\n');
    
    try {
      await navigator.clipboard.writeText(text);
      // Optional: Show a toast or notification
      console.log('Logs copied to clipboard');
    } catch (error) {
      console.error('Failed to copy logs:', error);
    }
  };

  // Auto-scroll to the latest log when filteredLogs grows
  createEffect(() => {
    const len = filteredLogs().length;
    // run after DOM updates
    setTimeout(() => {
      try {
        const scrollElement = vlistScrollElement || findScrollElement();
        if (scrollElement) {
          // Check if already at bottom before auto-scrolling
          const { scrollTop, scrollHeight, clientHeight } = scrollElement;
          const isNearBottom = scrollHeight - scrollTop - clientHeight < NEAR_BOTTOM_THRESHOLD_PX;
          if (isNearBottom) {
            // Add extra padding to ensure we reach the absolute bottom
            scrollElement.scrollTop = scrollElement.scrollHeight + EXTRA_SCROLL_PADDING_PX;
          }
          // Re-evaluate button visibility shortly after content settles
          setTimeout(checkScrollPosition, SCROLL_BOTTOM_MARGIN_PX * 25);
        }
      } catch (e) {
        // ignore
      }
    }, 0);
    return len;
  });

  createEffect(() => {
    let unlisten_data: UnlistenFn;
    (async () => {
      // eslint-disable-next-line solid/reactivity
      unlisten_data = await listen<MessageVisitor>("log-event", (event) => {
        addLogEntry(event.payload);
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
            onClick={clearFilters}
          >
            Clear
          </button>
          <button
            class="btn btn-ghost btn-sm shrink-0"
            onClick={reloadLogs}
            disabled={isLoading()}
          >
            {isLoading() ? "Loading..." : "Reload"}
          </button>
        </div>

        <div class="h-2" />
        <div class="relative">
          <div
            ref={(el) => {
              listContainer = el as HTMLDivElement;
              // Attach scroll listener to the outer container and do initial check
              setTimeout(() => {
                listContainer?.removeEventListener('scroll', handleScroll);
                listContainer?.addEventListener('scroll', handleScroll, { passive: true });
                checkScrollPosition();
              }, 100);
            }}
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
        
          {/* Floating buttons */}
          <div class="absolute bottom-4 right-4 flex flex-col gap-2">
          {showScrollButton() && (
            <button
              class="btn btn-circle btn-primary shadow-lg"
              onClick={scrollToBottom}
              title="Scroll to bottom"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </button>
          )}
          <button
            class="btn btn-circle btn-secondary shadow-lg"
            onClick={copyLogsToClipboard}
            title="Copy logs to clipboard"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
        </div>
        </div>
      </div>
    </>
  );
}
