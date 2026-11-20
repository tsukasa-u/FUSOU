/** @jsxImportSource solid-js */
import { Show, For } from "solid-js";
import { useStore } from "@nanostores/solid";
import {
  workspaceStore,
  toggleLock,
  removeEntry,
  duplicateEntry,
  type ViewerEntry,
} from "@/features/simulator/viewer-workspace";
import {
  activateWorkspaceEntry,
  switchToPlayground,
  isSnapshotPlayground,
  buildCurrentPlaygroundPayload,
} from "@/features/simulator/io-handlers";
import { workspaceAddModalRef, workspaceEditTarget, workspaceModalMode } from "./WorkspaceAddModal";
import { setWorkspaceReadOnly } from "@/features/simulator/simulator-mutations";

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
  const snapshotShips = payload["snapshotShips"];
  const snapshotSlotItems = payload["snapshotSlotItems"];
  return (
    (!!snapshotShips && typeof snapshotShips === "object" && Object.keys(snapshotShips).length > 0) ||
    (!!snapshotSlotItems && typeof snapshotSlotItems === "object" && Object.keys(snapshotSlotItems).length > 0)
  );
}

export function WorkspacePanel(props: { onSelectEntry?: () => void }) {
  const ws = useStore(workspaceStore);

  const isPlaygroundActive = () => ws().activeId === null;

  const handleAddCurrent = () => {
    workspaceEditTarget[1](null);
    workspaceModalMode[1]("saveCurrent");
    workspaceAddModalRef.current?.showModal();
  };

  const handleSelectPlayground = () => {
    switchToPlayground();
    props.onSelectEntry?.();
  };

  const handleSelectEntry = (entry: ViewerEntry) => {
    activateWorkspaceEntry(entry);
    props.onSelectEntry?.();
  };

  const handleEdit = (e: MouseEvent, entry: ViewerEntry) => {
    e.stopPropagation();
    if (entry.locked) return;
    workspaceEditTarget[1](entry);
    workspaceModalMode[1]("edit");
    workspaceAddModalRef.current?.showModal();
  };

  const handleToggleLock = (e: MouseEvent, entry: ViewerEntry) => {
    e.stopPropagation();
    toggleLock(entry.id);
    if (ws().activeId === entry.id) {
      const updatedEntry = workspaceStore.get().entries.find(x => x.id === entry.id);
      if (updatedEntry) {
        setWorkspaceReadOnly(updatedEntry.locked ?? false);
      }
    }
  };

  const handleDelete = (e: MouseEvent, entry: ViewerEntry) => {
    e.stopPropagation();
    removeEntry(entry.id);
  };

  const handleDuplicate = (e: MouseEvent, entry: ViewerEntry) => {
    e.stopPropagation();
    const isActive = ws().activeId === entry.id;
    let customPayload: Record<string, unknown> | undefined = undefined;
    if (isActive) {
      customPayload = buildCurrentPlaygroundPayload();
      const dup = duplicateEntry(entry.id, customPayload);
      if (dup) activateWorkspaceEntry(dup, true, false);
      return;
    }
    
    const dup = duplicateEntry(entry.id);
    if (dup) activateWorkspaceEntry(dup, true, true);
  };

  return (
    <div class="space-y-6">
      {/* Top Banner & Actions Card */}
      {/* Main Grid: Playground & Saved Entries */}
      <div class="space-y-4">
        {/* Active / Playground Quick Access */}
        <div class="space-y-1.5">
          <h3 class="text-xs font-semibold text-base-content/60 uppercase tracking-wider">作業エリア (Playground)</h3>
          <div
            id="workspace-playground-entry"
            class={`fusou-card px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition-colors ${
              isPlaygroundActive() ? "border-primary bg-primary/10" : ""
            }`}
          >
            <div class="min-w-0 flex-1 space-y-0.5">
              <div class="flex items-center gap-2">
                <span class="font-bold text-sm">Playground</span>
                <Show when={isPlaygroundActive()}>
                  <span class="badge badge-primary badge-xs">現在編集中</span>
                </Show>
              </div>
              <p class="text-xs text-base-content/60 truncate">
                {isSnapshotPlayground() ? "スナップショットを反映した一時作業領域" : "白紙状態から作成する一時作業領域"}
              </p>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <button
                id="btn-workspace-save-current"
                type="button"
                class="fusou-btn-xs-secondary gap-1"
                onClick={handleAddCurrent}
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1-4l-3 3m0 0l-3-3m3 3V4" />
                </svg>
                <span>現在の編成を保存</span>
              </button>
              <button
                type="button"
                class="fusou-btn-xs-primary shrink-0 gap-1"
                onClick={handleSelectPlayground}
              >
                <span>編成タブで開く</span>
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd"></path>
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Saved Fleet Entries Section */}
        <div class="space-y-2 pt-2">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-semibold text-base-content/60 uppercase tracking-wider">
              保存済み編成一覧 ({ws().entries.length}件)
            </h3>
          </div>

          <Show
            when={ws().entries.length > 0}
            fallback={
              <div class="fusou-card p-8 text-center text-base-content/50 space-y-2">
                <p class="text-sm font-medium">保存された編成はまだありません。</p>
                <p class="text-xs">
                  上の「現在の編成を保存」ボタンを押すか、右上の「URL追加」から他の人の編成URLを取り込むことができます。
                </p>
              </div>
            }
          >
            <div id="workspace-entry-list" role="list" class="fusou-card overflow-hidden divide-y divide-base-300/60">
              <For each={ws().entries}>
                {(entry: ViewerEntry) => {
                  const isActive = () => ws().activeId === entry.id;
                  const isDeck = entry.sourceType === "ownDeck";
                  const hasSnap = hasSnapshotLink(entry);
                  
                  return (
                    <div
                      data-entry-id={entry.id}
                      role="listitem"
                      class={`px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                        isActive()
                          ? "bg-primary/10 border-l-2 border-l-primary"
                          : "hover:bg-base-200/40"
                      }`}
                    >
                      {/* 左側: 1行目（ワークスペース名・バッジ）＋ 2行目（メモ） */}
                      <div class="min-w-0 flex-1 space-y-0.5">
                        <div class="flex items-center flex-wrap gap-1.5 min-w-0">
                          <span class="truncate font-semibold text-sm">{entry.name}</span>
                          <Show when={isActive()}>
                            <span class="badge badge-primary badge-xs shrink-0">{entry.locked ? "編集中 (ロック)" : "編集中 (オートセーブ)"}</span>
                          </Show>
                          <span class={`badge badge-xs font-semibold shrink-0 ${isDeck ? "badge-warning" : "badge-accent"}`}>
                            {isDeck ? "DECK" : "URL"}
                          </span>
                          <span class={`badge badge-xs shrink-0 ${hasSnap ? "badge-info" : "badge-ghost"}`}>
                            {hasSnap ? "SNAP" : "NO-SNAP"}
                          </span>
                          <span class="text-[11px] text-base-content/50 shrink-0">
                            {isDeck ? (entry.locked ? "ロック中" : "オートセーブ") : "共有URL"}
                            <Show when={entry.updatedAt}>
                              {" · "}更新: {new Date(entry.updatedAt).toLocaleTimeString()}
                            </Show>
                          </span>
                        </div>

                        <div class="min-w-0">
                          <Show
                            when={entry.memo?.trim()}
                            fallback={
                              <div class="text-xs text-base-content/40 italic truncate">
                                メモなし
                              </div>
                            }
                          >
                            <p class="text-xs text-base-content/75 line-clamp-1 break-all leading-relaxed">
                              {entry.memo!.trim()}
                            </p>
                          </Show>
                        </div>
                      </div>

                      {/* 右側: 操作ボタン（すべて 24px / btn-xs で統一） */}
                      <div class="flex items-center gap-1.5 shrink-0 flex-wrap sm:flex-nowrap">
                        <button
                          type="button"
                          class="inline-flex items-center justify-center w-6 h-6 rounded-md transition-colors cursor-pointer"
                          aria-label={entry.locked ? "ロック解除" : "ロック"}
                          style={{
                            color: entry.locked ? "#dc2626" : "#16a34a",
                            "background-color": entry.locked ? "rgba(220, 38, 38, 0.10)" : "rgba(22, 163, 74, 0.10)",
                            border: `1px solid ${entry.locked ? "rgba(220, 38, 38, 0.20)" : "rgba(22, 163, 74, 0.20)"}`
                          }}
                          title={entry.locked ? "ロック中: R2再読込で上書きされません。クリックで解除" : "未ロック: クリックでロック"}
                          onClick={(e) => handleToggleLock(e, entry)}
                        >
                          <LockIcon locked={entry.locked || false} />
                        </button>
                        <button type="button" class="fusou-btn-xs-secondary" title="この編成を複製" onClick={(e) => handleDuplicate(e, entry)}>
                          複製
                        </button>
                        <button type="button" class="fusou-btn-xs-secondary" disabled={entry.locked} title={entry.locked ? "ロック中は編集できません" : "名前やメモの編集"} onClick={(e) => handleEdit(e, entry)}>
                          編集
                        </button>
                        <button type="button" class="fusou-btn-xs-secondary text-error" title="削除" onClick={(e) => handleDelete(e, entry)}>
                          削除
                        </button>
                        <button
                          type="button"
                          class="fusou-btn-xs-primary gap-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectEntry(entry);
                          }}
                        >
                          <span>開く</span>
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd"></path>
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
