import { invoke } from "@tauri-apps/api/core";
import { createSignal, For, Show, onMount } from "solid-js";
import { FadeToast, showFadeToast } from "./fade_toast";

type PendingRetryItemStatus = {
  id: string;
  pending_type: string;
  attempt_count: number;
  created_at: number;
  last_attempt_at?: number | null;
  next_due_at: number;
  seconds_until_next_due: number;
  expires_at: number;
};

type PendingRetryStatus = {
  total_pending: number;
  due_now_count: number;
  max_attempts: number;
  interval_seconds: number;
  ttl_seconds: number;
  now_epoch_seconds: number;
  next_due_at?: number | null;
  items: PendingRetryItemStatus[];
};

type SuppressionEntryStatus = {
  key: string;
  expires_at_ms: number;
  hash_prefix: string;
};

type SuppressionStatus = {
  scope?: string | null;
  entries: SuppressionEntryStatus[];
};

const formatEpochMillis = (value?: number | null) => {
  if (!value) return "-";
  return new Date(value).toLocaleString();
};

const formatEpochSeconds = (value?: number | null) => {
  if (!value) return "-";
  return new Date(value * 1000).toLocaleString();
};

const formatRemainingSeconds = (seconds: number) => {
  if (seconds <= 0) return "now";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

type SuppressionSectionProps = {
  title: string;
  description: string;
  loading: boolean;
  status: SuppressionStatus | null;
  onRefresh: () => Promise<void>;
};

type ConfirmModalState = {
  title: string;
  message: string;
  confirmLabel: string;
  confirmClass: string;
  action: () => Promise<void>;
};

const getErrorMessage = (error: unknown): string => {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
};

function SuppressionSection(props: SuppressionSectionProps) {
  return (
    <>
      <div class="divider divider-horizonal py-0 mt-4 mb-8" />

      <p class="py-2 text-xl font-semibold">{props.title}</p>
      <p class="px-px leading-5">{props.description}</p>
      <div class="mt-4 flex items-center justify-end">
        <button
          class="btn btn-secondary border-secondary-content"
          onClick={() => {
            void props.onRefresh();
          }}
          disabled={props.loading}
        >
          {props.loading ? "Refreshing..." : "Refresh suppression"}
        </button>
      </div>
      <Show when={props.status}>
        {(status) => (
          <div class="mt-4 p-4 bg-base-200 rounded-box text-sm space-y-2">
            <div>Scope: {status().scope ?? "-"}</div>
            <div>Active keys: {status().entries.length}</div>
            <Show when={status().entries.length > 0}>
              <div class="overflow-x-auto mt-2">
                <table class="table table-xs">
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>Hash</th>
                      <th>Expires</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={status().entries}>
                      {(entry) => (
                        <tr>
                          <td class="font-mono">{entry.key}</td>
                          <td class="font-mono">{entry.hash_prefix}</td>
                          <td>{formatEpochMillis(entry.expires_at_ms)}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
          </div>
        )}
      </Show>
    </>
  );
}

export function DataCollectionStatusComponent() {
  const [retryingPendingUploads, setRetryingPendingUploads] =
    createSignal<boolean>(false);
  const [pendingRetryStatus, setPendingRetryStatus] =
    createSignal<PendingRetryStatus | null>(null);
  const [loadingPendingRetryStatus, setLoadingPendingRetryStatus] =
    createSignal<boolean>(false);
  const [retryingItemId, setRetryingItemId] = createSignal<string | null>(null);
  const [deletingItemId, setDeletingItemId] = createSignal<string | null>(null);
  const [confirmModalState, setConfirmModalState] =
    createSignal<ConfirmModalState | null>(null);
  const [confirmSubmitting, setConfirmSubmitting] = createSignal<boolean>(false);
  const [activeAction, setActiveAction] = createSignal<string | null>(null);

  const [shipGrowthStatus, setShipGrowthStatus] =
    createSignal<SuppressionStatus | null>(null);
  const [loadingShipGrowthStatus, setLoadingShipGrowthStatus] =
    createSignal<boolean>(false);

  const [questTreeStatus, setQuestTreeStatus] =
    createSignal<SuppressionStatus | null>(null);
  const [loadingQuestTreeStatus, setLoadingQuestTreeStatus] =
    createSignal<boolean>(false);

  const [remodelStatus, setRemodelStatus] =
    createSignal<SuppressionStatus | null>(null);
  const [loadingRemodelStatus, setLoadingRemodelStatus] =
    createSignal<boolean>(false);

  const hasRunningOperation = () =>
    !!activeAction() ||
    retryingPendingUploads() ||
    !!retryingItemId() ||
    !!deletingItemId();

  const isUiLocked = () => hasRunningOperation() || confirmSubmitting();

  const runExclusive = async (actionKey: string, action: () => Promise<void>) => {
    if (hasRunningOperation()) return;
    try {
      setActiveAction(actionKey);
      await action();
    } finally {
      setActiveAction(null);
    }
  };

  const refreshPendingRetryStatus = async () => {
    try {
      setLoadingPendingRetryStatus(true);
      const status = await invoke<PendingRetryStatus>(
        "get_pending_upload_retry_status",
      );
      setPendingRetryStatus(status);
    } catch (e: any) {
      console.error("Failed to fetch pending retry status:", e);
      showFadeToast(
        "data_collection_toast",
        "Failed to load pending retry status",
      );
    } finally {
      setLoadingPendingRetryStatus(false);
    }
  };

  const refreshShipGrowthStatus = async () => {
    try {
      setLoadingShipGrowthStatus(true);
      const status = await invoke<SuppressionStatus | null>(
        "get_ship_growth_suppression_status",
      );
      setShipGrowthStatus(status);
    } catch (e: any) {
      console.error("Failed to fetch ship growth suppression status:", e);
      showFadeToast(
        "data_collection_toast",
        "Failed to load ship growth suppression status",
      );
    } finally {
      setLoadingShipGrowthStatus(false);
    }
  };

  const refreshQuestTreeStatus = async () => {
    try {
      setLoadingQuestTreeStatus(true);
      const status = await invoke<SuppressionStatus | null>(
        "get_quest_tree_suppression_status",
      );
      setQuestTreeStatus(status);
    } catch (e: any) {
      console.error("Failed to fetch quest tree suppression status:", e);
      showFadeToast(
        "data_collection_toast",
        "Failed to load quest tree suppression status",
      );
    } finally {
      setLoadingQuestTreeStatus(false);
    }
  };

  const refreshRemodelStatus = async () => {
    try {
      setLoadingRemodelStatus(true);
      const status = await invoke<SuppressionStatus | null>(
        "get_remodel_suppression_status",
      );
      setRemodelStatus(status);
    } catch (e: any) {
      console.error("Failed to fetch remodel suppression status:", e);
      showFadeToast(
        "data_collection_toast",
        "Failed to load remodel suppression status",
      );
    } finally {
      setLoadingRemodelStatus(false);
    }
  };

  const refreshAllStatuses = async () => {
    await Promise.all([
      refreshPendingRetryStatus(),
      refreshShipGrowthStatus(),
      refreshQuestTreeStatus(),
      refreshRemodelStatus(),
    ]);
  };

  onMount(() => {
    refreshAllStatuses();
  });

  const handleRetryPendingUploadsNow = async () => {
    await runExclusive("retry_all", async () => {
      try {
        setRetryingPendingUploads(true);
        await invoke("retry_pending_uploads_now");
        showFadeToast("data_collection_toast", "Pending upload retry triggered");
        await refreshAllStatuses();
      } catch (e: any) {
        console.error("Failed to trigger pending upload retry:", e);
        showFadeToast("data_collection_toast", getErrorMessage(e));
      } finally {
        setRetryingPendingUploads(false);
      }
    });
  };

  const handleRetryItemNow = async (id: string) => {
    await runExclusive(`retry_item:${id}`, async () => {
      try {
        setRetryingItemId(id);
        await invoke("retry_pending_upload_item_now", { id });
        showFadeToast("data_collection_toast", "Pending item retry triggered");
        await refreshPendingRetryStatus();
      } catch (e: any) {
        console.error("Failed to trigger pending item retry:", e);
        showFadeToast("data_collection_toast", getErrorMessage(e));
      } finally {
        setRetryingItemId(null);
      }
    });
  };

  const handleDeleteItem = async (id: string) => {
    await runExclusive(`delete_item:${id}`, async () => {
      try {
        setDeletingItemId(id);
        await invoke("delete_pending_upload_item", { id });
        showFadeToast("data_collection_toast", "Pending item deleted");
        await refreshPendingRetryStatus();
      } catch (e: any) {
        console.error("Failed to delete pending item:", e);
        showFadeToast("data_collection_toast", getErrorMessage(e));
      } finally {
        setDeletingItemId(null);
      }
    });
  };

  const requestConfirmAction = (state: ConfirmModalState) => {
    if (isUiLocked() || confirmModalState()) return;
    setConfirmModalState(state);
  };

  const closeConfirmModal = () => {
    if (confirmSubmitting() || hasRunningOperation()) return;
    setConfirmModalState(null);
  };

  const runConfirmedAction = async () => {
    const state = confirmModalState();
    if (!state || confirmSubmitting() || hasRunningOperation()) return;

    try {
      setConfirmSubmitting(true);
      await state.action();
      setConfirmModalState(null);
    } finally {
      setConfirmSubmitting(false);
    }
  };

  return (
    <>
      <h1 class="mx-6 pt-6 pb-2 text-3xl font-semibold">Uploads</h1>
      <div class="mx-6">
        <div class="divider divider-horizonal py-0 mt-4 mb-8" />

        <p class="py-2 text-xl font-semibold">Pending Upload Retry</p>
        <p class="px-px leading-5">
          Force retry pending uploads immediately without waiting for the next
          startup or retry interval. You can also retry or delete each pending
          item directly.
        </p>
        <div class="mt-4 flex items-center justify-end gap-2">
          <button
            class="btn btn-secondary border-secondary-content"
            onClick={refreshPendingRetryStatus}
            disabled={
              loadingPendingRetryStatus() || !!confirmModalState() || isUiLocked()
            }
          >
            {loadingPendingRetryStatus() ? "Refreshing..." : "Refresh status"}
          </button>
          <button
            class="btn btn-primary border-primary-content btn-wide"
            onClick={() =>
              requestConfirmAction({
                title: "Retry Pending Uploads",
                message:
                  "Run retry for all pending uploads right now? This may trigger many network requests.",
                confirmLabel: "Run Retry",
                confirmClass: "btn-primary",
                action: handleRetryPendingUploadsNow,
              })
            }
            disabled={retryingPendingUploads() || confirmSubmitting() || isUiLocked()}
          >
            {retryingPendingUploads()
              ? "Retrying pending uploads..."
              : "Retry pending uploads now"}
          </button>
        </div>
        <Show when={pendingRetryStatus()}>
          {(status) => (
            <div class="mt-4 p-4 bg-base-200 rounded-box text-sm space-y-2">
              <div>Total pending: {status().total_pending}</div>
              <div>Due now: {status().due_now_count}</div>
              <div>Max attempts: {status().max_attempts}</div>
              <div>Base interval: {status().interval_seconds}s</div>
              <div>TTL: {status().ttl_seconds}s</div>
              <div>Next due at: {formatEpochSeconds(status().next_due_at)}</div>
              <Show when={status().items.length > 0}>
                <div class="overflow-x-auto mt-2">
                  <table class="table table-xs">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Type</th>
                        <th>Attempt</th>
                        <th>Next due</th>
                        <th>Remaining</th>
                        <th>Expires</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={status().items.slice(0, 50)}>
                        {(item) => (
                          <tr>
                            <td class="font-mono">{item.id.slice(0, 8)}</td>
                            <td class="font-mono">{item.pending_type}</td>
                            <td>{item.attempt_count}</td>
                            <td>{formatEpochSeconds(item.next_due_at)}</td>
                            <td>
                              {formatRemainingSeconds(
                                item.seconds_until_next_due,
                              )}
                            </td>
                            <td>{formatEpochSeconds(item.expires_at)}</td>
                            <td>
                              <div class="flex items-center gap-1">
                                <button
                                  class="btn btn-xs btn-primary"
                                  disabled={
                                    retryingItemId() === item.id ||
                                    deletingItemId() === item.id ||
                                    confirmSubmitting() ||
                                    isUiLocked()
                                  }
                                  onClick={() =>
                                    requestConfirmAction({
                                      title: "Retry Pending Item",
                                      message: `Retry item ${item.id.slice(0, 8)} now?`,
                                      confirmLabel: "Retry Now",
                                      confirmClass: "btn-primary",
                                      action: () => handleRetryItemNow(item.id),
                                    })
                                  }
                                >
                                  {retryingItemId() === item.id
                                    ? "Retrying..."
                                    : "Retry now"}
                                </button>
                                <button
                                  class="btn btn-xs btn-error btn-outline"
                                  disabled={
                                    deletingItemId() === item.id ||
                                    retryingItemId() === item.id ||
                                    confirmSubmitting() ||
                                    isUiLocked()
                                  }
                                  onClick={() =>
                                    requestConfirmAction({
                                      title: "Delete Pending Item",
                                      message: `Delete pending item ${item.id.slice(0, 8)}? This cannot be undone.`,
                                      confirmLabel: "Delete",
                                      confirmClass: "btn-error",
                                      action: () => handleDeleteItem(item.id),
                                    })
                                  }
                                >
                                  {deletingItemId() === item.id
                                    ? "Deleting..."
                                    : "Delete"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </Show>
            </div>
          )}
        </Show>

        <SuppressionSection
          title="Ship Growth Suppression"
          description="Track the current local suppression keys for EXP, naked parameter bounds, and caps."
          loading={loadingShipGrowthStatus()}
          status={shipGrowthStatus()}
          onRefresh={refreshShipGrowthStatus}
        />

        <SuppressionSection
          title="Quest Tree Suppression"
          description="Track the current local suppression keys for quest tree data uploads."
          loading={loadingQuestTreeStatus()}
          status={questTreeStatus()}
          onRefresh={refreshQuestTreeStatus}
        />

        <SuppressionSection
          title="Remodel Suppression"
          description="Track the current local suppression keys for remodel data uploads."
          loading={loadingRemodelStatus()}
          status={remodelStatus()}
          onRefresh={refreshRemodelStatus}
        />
      </div>

      <Show when={confirmModalState()}>
        {(modalState) => (
          <dialog class="modal modal-open" open>
            <div class="modal-box">
              <h3 class="font-bold text-lg">{modalState().title}</h3>
              <p class="py-3">{modalState().message}</p>
              <div class="modal-action">
                <button
                  class="btn btn-ghost"
                  onClick={closeConfirmModal}
                  disabled={confirmSubmitting() || hasRunningOperation()}
                >
                  Cancel
                </button>
                <button
                  class={`btn ${modalState().confirmClass}`}
                  onClick={() => {
                    void runConfirmedAction();
                  }}
                  disabled={confirmSubmitting() || hasRunningOperation()}
                >
                  {confirmSubmitting() ? "Processing..." : modalState().confirmLabel}
                </button>
              </div>
            </div>
            <form method="dialog" class="modal-backdrop">
              <button onClick={closeConfirmModal}>close</button>
            </form>
          </dialog>
        )}
      </Show>

      <FadeToast toast_id="data_collection_toast" />
    </>
  );
}
