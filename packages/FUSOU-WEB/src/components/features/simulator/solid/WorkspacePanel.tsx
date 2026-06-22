/* @jsxImportSource solid-js */
import { createSignal, createEffect, For, Show } from "solid-js";
import { useStore } from "@nanostores/solid";
import { workspaceStore, removeEntry, toggleLock, duplicateEntry, type ViewerEntry } from "@/features/simulator/viewer-workspace";
import { activateWorkspaceEntry, switchToPlayground, isSnapshotPlayground, createOwnDeckFromCurrentState } from "@/features/simulator/io-handlers";
import { hasSnapshotData } from "@/features/simulator/simulator-selectors";
import { workspaceAddModalRef, workspaceEditTarget } from "./WorkspaceAddModal";
import { simulatorDisplayRevision } from "@/features/simulator/state";

function LockIcon(props: { locked: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <Show when={props.locked}>
        <path d="M7 10V8a5 5 0 1 1 10 0v2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
        <rect x="5" y="10" width="14" height="10" rx="2.2" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="2.2" />
      </Show>
      <Show when={!props.locked}>
        <path d="M9 10V8a5 5 0 0 1 9.4-2.4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
        <path d="M15 10h4v10H5V10h7" fill="currentColor" fill-opacity="0.12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
      </Show>
    </svg>
  );
}

function hasSnapshotLink(entry: ViewerEntry): boolean {
  if (entry.payloadKind === "fleetSnapshot") return true;
  const payload = entry.payload as Record<string, unknown>;
  const snapshotShips = payload.snapshotShips;
  const snapshotSlotItems = payload.snapshotSlotItems;
  return (
    (!!snapshotShips && typeof snapshotShips === "object" && Object.keys(snapshotShips).length > 0) ||
    (!!snapshotSlotItems && typeof snapshotSlotItems === "object" && Object.keys(snapshotSlotItems).length > 0)
  );
}

export function WorkspacePanel() {
  const ws = useStore(workspaceStore);
  const displayRev = useStore(simulatorDisplayRevision);
  const [expanded, setExpanded] = createSignal(false);

  const isPlaygroundActive = () => ws().activeId === null;
  const activeEntry = () => ws().activeId ? ws().entries.find(e => e.id === ws().activeId) : null;
  
  const modeStatusText = () => {
    if (isPlaygroundActive()) return isSnapshotPlayground() ? "PLAYGROUND: SNAPSHOT" : "PLAYGROUND: BLANK";
    const e = activeEntry();
    if (!e) return "PLAYGROUND";
    return `WORKSPACE: ${e.sourceType === "ownDeck" ? "DECK" : "URL"}`;
  };

  const modeStatusClass = () => {
    if (isPlaygroundActive()) return isSnapshotPlayground() ? "badge badge-sm badge-info" : "badge badge-sm badge-ghost";
    const e = activeEntry();
    if (!e) return "badge badge-sm badge-ghost";
    return e.sourceType === "ownDeck" ? "badge badge-sm badge-success" : "badge badge-sm badge-accent";
  };

  const snapshotAvailable = () => {
    displayRev();
    return hasSnapshotData();
  };

  const handleAddCurrent = () => {
    if (!isPlaygroundActive()) return;
    const entry = createOwnDeckFromCurrentState(
      snapshotAvailable() ? `自分のデッキ（スナップショット由来） ${new Date().toLocaleTimeString()}` : "自分のデッキ",
      ""
    );
    activateWorkspaceEntry(entry);
  };

  const handleEdit = (e: MouseEvent, entry: ViewerEntry) => {
    e.stopPropagation();
    if (entry.locked) return;
    workspaceEditTarget[1](entry);
    workspaceAddModalRef.current?.showModal();
  };

  const handleToggleLock = (e: MouseEvent, entry: ViewerEntry) => {
    e.stopPropagation();
    toggleLock(entry.id);
  };

  const handleDelete = (e: MouseEvent, entry: ViewerEntry) => {
    e.stopPropagation();
    removeEntry(entry.id);
  };

  const handleDuplicate = (e: MouseEvent, entry: ViewerEntry) => {
    e.stopPropagation();
    const dup = duplicateEntry(entry.id);
    if (dup) activateWorkspaceEntry(dup);
  };

  const VISIBLE_COUNT = 5;
  const activeIndex = () => ws().activeId ? ws().entries.findIndex(e => e.id === ws().activeId) : -1;
  const shouldAutoExpand = () => activeIndex() >= VISIBLE_COUNT;
  const isExpanded = () => expanded() || shouldAutoExpand();
  const visibleEntries = () => isExpanded() ? ws().entries : ws().entries.slice(0, VISIBLE_COUNT);
  const hiddenCount = () => Math.max(0, ws().entries.length - visibleEntries().length);

  return (
    <section id="shared-workspace-panel" class="bg-base-100 rounded-xl shadow-sm border border-base-300/40 p-3 mb-5">
      <div class="flex items-center justify-between gap-1.5 mb-2">
        <div class="flex items-center gap-2 min-w-0">
          <h2 class="text-sm font-semibold shrink-0">ワークスペース</h2>
          <span id="workspace-mode-status" class={modeStatusClass()}>{modeStatusText()}</span>
        </div>
        <div class="flex items-center gap-0.5 shrink-0">
          <button
            id="btn-workspace-add-current"
            class="btn btn-ghost btn-xs gap-1"
            title={isPlaygroundActive() ? "現在のPlayground編成をワークスペースに追加" : "Playgroundでのみ利用できます"}
            disabled={!isPlaygroundActive()}
            onClick={handleAddCurrent}
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1-4l-3 3m0 0l-3-3m3 3V4"></path>
            </svg>
            <span class="hidden sm:inline text-[11px]">編成追加</span>
          </button>
          <button
            id="btn-workspace-add"
            class="btn btn-ghost btn-xs gap-1"
            title="共有URLをワークスペースに追加"
            onClick={() => {
              workspaceEditTarget[1](null);
              workspaceAddModalRef.current?.showModal();
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path>
            </svg>
            <span class="hidden sm:inline text-[11px]">URL追加</span>
          </button>
          <span class="text-xs text-base-content/50 pl-1">{ws().entries.length}件</span>
        </div>
      </div>

      <Show when={ws().entries.length === 0}>
        <p class="text-sm text-base-content/50 mb-2">他人の共有URLと自分のデッキを、ページ遷移せずに切り替えて管理できます。</p>
      </Show>

      <div class="space-y-2">
        <div
          id="workspace-playground-entry"
          class={`flex items-center gap-2 p-2 rounded-lg border text-sm cursor-pointer transition-colors ${
            isPlaygroundActive() ? "border-info bg-info/10" : "border-base-300/60 hover:border-info/50"
          }`}
          onClick={switchToPlayground}
        >
          <div class="flex-1 min-w-0">
            <div class="truncate font-medium">Playground</div>
            <div class="text-[11px] text-base-content/55 mt-0.5">
              {isSnapshotPlayground() ? "スナップショットを反映した作業中の編成" : "白紙状態から編成を作成する作業領域"}
            </div>
          </div>
        </div>
      </div>

      <div class="mt-3 border-t border-base-300/60 pt-3">
        <div class="flex items-center justify-between gap-2 mb-2">
          <span class="text-xs font-medium tracking-wide text-base-content/60">保存済み</span>
          <span class="text-[11px] text-base-content/45">一覧のみスクロールします</span>
        </div>
        
        <div class="max-h-[38vh] sm:max-h-[46vh] lg:max-h-112 overflow-y-auto pr-1">
          <div id="workspace-entry-list" role="list" class="space-y-2">
            <For each={visibleEntries()}>
              {(entry) => {
                const isActive = ws().activeId === entry.id;
                const isDeck = entry.sourceType === "ownDeck";
                const hasSnap = hasSnapshotLink(entry);
                
                return (
                  <div
                    data-entry-id={entry.id}
                    role="listitem"
                    class={`flex items-center gap-2 p-2 rounded-lg border text-sm cursor-pointer transition-colors ${
                      isActive ? "border-primary bg-primary/10" : "border-base-300/60 hover:border-primary/40"
                    }`}
                    onClick={() => activateWorkspaceEntry(entry)}
                  >
                    <div class="flex-1 min-w-0">
                      <div class="truncate font-medium">{entry.name}</div>
                      <Show when={entry.memo?.trim()}>
                        <div class="text-xs text-base-content/65 mt-0.5 line-clamp-2 overflow-hidden">
                          {entry.memo!.trim()}
                        </div>
                      </Show>
                    </div>

                    <span class={`badge badge-sm shrink-0 ${isDeck ? "badge-warning" : "badge-accent"}`}>
                      {isDeck ? "DECK" : "URL"}
                    </span>

                    <span class={`badge badge-sm shrink-0 ${hasSnap ? "badge-info" : "badge-ghost"}`}>
                      {hasSnap ? "SNAP" : "NO-SNAP"}
                    </span>

                    <button
                      class="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors"
                      aria-label={entry.locked ? "ロック解除" : "ロック"}
                      style={{
                        color: entry.locked ? "#dc2626" : "#16a34a",
                        "background-color": entry.locked ? "rgba(220, 38, 38, 0.10)" : "rgba(22, 163, 74, 0.10)",
                        border: `1px solid ${entry.locked ? "rgba(220, 38, 38, 0.20)" : "rgba(22, 163, 74, 0.20)"}`
                      }}
                      title={entry.locked ? "ロック中：R2再読込で上書きされません。クリックで解除" : "ロック解除中：R2再読込で上書きされます。クリックでロック"}
                      onClick={(e) => handleToggleLock(e, entry)}
                    >
                      <LockIcon locked={entry.locked || false} />
                    </button>

                    <button class="btn btn-ghost btn-xs shrink-0" title="この項目を複製" onClick={(e) => handleDuplicate(e, entry)}>
                      複製
                    </button>
                    <button class="btn btn-ghost btn-xs shrink-0" disabled={entry.locked} title={entry.locked ? "ロック中は編集できません" : "編集"} onClick={(e) => handleEdit(e, entry)}>
                      編集
                    </button>
                    <button class="btn btn-ghost btn-xs shrink-0" title="削除" onClick={(e) => handleDelete(e, entry)}>
                      ×
                    </button>
                  </div>
                );
              }}
            </For>
          </div>
        </div>

        <Show when={hiddenCount() > 0}>
          <div class="mt-2 flex items-center justify-between gap-2">
            <span class="text-xs text-base-content/55">他 {hiddenCount()}件が非表示</span>
            <button class="btn btn-xs" onClick={() => setExpanded(true)}>
              すべて表示する
            </button>
          </div>
        </Show>
      </div>
    </section>
  );
}
