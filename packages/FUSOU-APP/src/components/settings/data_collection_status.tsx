import { invoke } from "@tauri-apps/api/core";
import { createSignal, For, Show, onMount } from "solid-js";
import { isTauri } from "../../utility/tauri";
import {
  ActionSummaryGrid,
  COMPACT_ROW_BUTTON_SIZE_CLASS,
  CONFIRM_BUTTON_SIZE_CLASS,
  createDesktopRuntimeSummary,
  formatActionTime,
  SETTING_ROW_BUTTON_SIZE_CLASS,
  type ActionSummary,
} from "./action_result";

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
  if (!value) return "—";
  return new Date(value).toLocaleString();
};

const formatEpochSeconds = (value?: number | null) => {
  if (!value) return "—";
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
  result: ActionSummary | null;
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
    <div class="p-4 space-y-3">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="space-y-0.5 min-w-0">
          <h3 class="text-sm font-semibold">{props.title}</h3>
          <p class="text-xs text-base-content/65">{props.description}</p>
        </div>
        <button
          type="button"
          class={`btn btn-secondary enabled:border-secondary-content ${SETTING_ROW_BUTTON_SIZE_CLASS}`}
          onClick={() => {
            void props.onRefresh();
          }}
          disabled={props.loading}
        >
          <Show when={props.loading}>
            <span class="loading loading-spinner loading-xs" />
          </Show>
          {props.loading ? "Refreshing..." : "Refresh Suppression"}
        </button>
      </div>

      <Show when={props.status}>
        {(status) => (
          <div class="space-y-3 pt-1">
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-base-200/40 rounded-lg border border-base-300 px-3.5 py-2.5 text-xs">
              <div>
                <div class="text-base-content/55">Status</div>
                <div
                  class={`font-semibold mt-0.5 ${
                    status().entries.length > 0 ? "text-info" : "text-success"
                  }`}
                >
                  {status().entries.length > 0 ? "Active" : "Empty"}
                </div>
              </div>
              <div class="min-w-0">
                <div class="text-base-content/55">Scope</div>
                <div
                  class="font-mono truncate mt-0.5"
                  title={status().scope ?? "—"}
                >
                  {status().scope ?? "—"}
                </div>
              </div>
              <div>
                <div class="text-base-content/55">Active Keys</div>
                <div class="font-mono tabular-nums mt-0.5">
                  {status().entries.length}
                </div>
              </div>
            </div>

            <Show when={status().entries.length > 0}>
              <div class="overflow-x-auto rounded-lg border border-base-300">
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

      <ActionSummaryGrid summary={props.result} />
    </div>
  );
}

export function DataCollectionStatusComponent() {
  const [retryingPendingUploads, setRetryingPendingUploads] =
    createSignal<boolean>(false);
  const [pendingRetryStatus, setPendingRetryStatus] =
    createSignal<PendingRetryStatus | null>(null);
  const [pendingRetryResult, setPendingRetryResult] =
    createSignal<ActionSummary | null>(null);
  const [loadingPendingRetryStatus, setLoadingPendingRetryStatus] =
    createSignal<boolean>(false);
  const [retryingItemId, setRetryingItemId] = createSignal<string | null>(null);
  const [deletingItemId, setDeletingItemId] = createSignal<string | null>(null);
  const [confirmModalState, setConfirmModalState] =
    createSignal<ConfirmModalState | null>(null);
  const [confirmSubmitting, setConfirmSubmitting] =
    createSignal<boolean>(false);
  const [activeAction, setActiveAction] = createSignal<string | null>(null);

  const [shipGrowthStatus, setShipGrowthStatus] =
    createSignal<SuppressionStatus | null>(null);
  const [shipGrowthResult, setShipGrowthResult] =
    createSignal<ActionSummary | null>(null);
  const [loadingShipGrowthStatus, setLoadingShipGrowthStatus] =
    createSignal<boolean>(false);

  const [questTreeStatus, setQuestTreeStatus] =
    createSignal<SuppressionStatus | null>(null);
  const [questTreeResult, setQuestTreeResult] =
    createSignal<ActionSummary | null>(null);
  const [loadingQuestTreeStatus, setLoadingQuestTreeStatus] =
    createSignal<boolean>(false);

  const [remodelStatus, setRemodelStatus] =
    createSignal<SuppressionStatus | null>(null);
  const [remodelResult, setRemodelResult] = createSignal<ActionSummary | null>(
    null,
  );
  const [loadingRemodelStatus, setLoadingRemodelStatus] =
    createSignal<boolean>(false);

  const hasRunningOperation = () =>
    !!activeAction() ||
    retryingPendingUploads() ||
    !!retryingItemId() ||
    !!deletingItemId();

  const isUiLocked = () => hasRunningOperation() || confirmSubmitting();

  const requireDesktopRuntime = (
    scope: string,
    setResult: (summary: ActionSummary | null) => void,
  ): boolean => {
    if (isTauri()) return true;
    setResult(createDesktopRuntimeSummary(scope));
    return false;
  };

  const runExclusive = async (
    actionKey: string,
    action: () => Promise<void>,
  ) => {
    if (hasRunningOperation()) return;
    try {
      setActiveAction(actionKey);
      await action();
    } finally {
      setActiveAction(null);
    }
  };

  const refreshPendingRetryStatus = async () => {
    setPendingRetryResult(null);
    if (!requireDesktopRuntime("Pending retry status", setPendingRetryResult)) {
      setPendingRetryStatus(null);
      return;
    }
    try {
      setLoadingPendingRetryStatus(true);
      const status = await invoke<PendingRetryStatus>(
        "get_pending_upload_retry_status",
      );
      setPendingRetryStatus(status);
    } catch (e: any) {
      console.error("Failed to fetch pending retry status:", e);
      setPendingRetryStatus(null);
      setPendingRetryResult({
        fields: [
          { label: "Result", value: "Failed", tone: "error" },
          { label: "Target", value: "Pending queue" },
          { label: "Detail", value: getErrorMessage(e), truncate: true },
          { label: "Checked", value: formatActionTime(), mono: true },
        ],
      });
    } finally {
      setLoadingPendingRetryStatus(false);
    }
  };

  const createSuppressionRefresher =
    (
      command: string,
      scopeLabel: string,
      setLoading: (value: boolean) => void,
      setStatus: (value: SuppressionStatus | null) => void,
      setResult: (value: ActionSummary | null) => void,
    ) =>
    async () => {
      setResult(null);
      if (!requireDesktopRuntime(scopeLabel, setResult)) {
        setStatus(null);
        return;
      }
      try {
        setLoading(true);
        const status = await invoke<SuppressionStatus | null>(command);
        setStatus(status);
      } catch (e: any) {
        console.error(`Failed to fetch ${scopeLabel}:`, e);
        setStatus(null);
        setResult({
          fields: [
            { label: "Result", value: "Failed", tone: "error" },
            { label: "Target", value: scopeLabel },
            { label: "Detail", value: getErrorMessage(e), truncate: true },
            { label: "Checked", value: formatActionTime(), mono: true },
          ],
        });
      } finally {
        setLoading(false);
      }
    };

  const refreshShipGrowthStatus = createSuppressionRefresher(
    "get_ship_growth_suppression_status",
    "Ship growth suppression",
    setLoadingShipGrowthStatus,
    setShipGrowthStatus,
    setShipGrowthResult,
  );

  const refreshQuestTreeStatus = createSuppressionRefresher(
    "get_quest_tree_suppression_status",
    "Quest tree suppression",
    setLoadingQuestTreeStatus,
    setQuestTreeStatus,
    setQuestTreeResult,
  );

  const refreshRemodelStatus = createSuppressionRefresher(
    "get_remodel_suppression_status",
    "Remodel suppression",
    setLoadingRemodelStatus,
    setRemodelStatus,
    setRemodelResult,
  );

  const refreshAllStatuses = async () => {
    await Promise.all([
      refreshPendingRetryStatus(),
      refreshShipGrowthStatus(),
      refreshQuestTreeStatus(),
      refreshRemodelStatus(),
    ]);
  };

  onMount(() => {
    if (!isTauri()) return;
    void refreshAllStatuses();
  });

  const handleRetryPendingUploadsNow = async () => {
    setPendingRetryResult(null);
    if (
      !requireDesktopRuntime("Retry pending uploads", setPendingRetryResult)
    ) {
      return;
    }
    await runExclusive("retry_all", async () => {
      try {
        setRetryingPendingUploads(true);
        await invoke("retry_pending_uploads_now");
        await refreshAllStatuses();
        setPendingRetryResult({
          fields: [
            { label: "Result", value: "Triggered", tone: "success" },
            { label: "Target", value: "All pending" },
            { label: "Detail", value: "Retry batch completed" },
            { label: "Updated", value: formatActionTime(), mono: true },
          ],
        });
      } catch (e: any) {
        console.error("Failed to trigger pending upload retry:", e);
        setPendingRetryResult({
          fields: [
            { label: "Result", value: "Failed", tone: "error" },
            { label: "Target", value: "All pending" },
            { label: "Detail", value: getErrorMessage(e), truncate: true },
            { label: "Updated", value: formatActionTime(), mono: true },
          ],
        });
      } finally {
        setRetryingPendingUploads(false);
      }
    });
  };

  const handleRetryItemNow = async (id: string) => {
    setPendingRetryResult(null);
    if (!requireDesktopRuntime("Retry pending item", setPendingRetryResult)) {
      return;
    }
    await runExclusive(`retry_item:${id}`, async () => {
      try {
        setRetryingItemId(id);
        await invoke("retry_pending_upload_item_now", { id });
        await refreshPendingRetryStatus();
        setPendingRetryResult({
          fields: [
            { label: "Result", value: "Triggered", tone: "success" },
            { label: "Item", value: id.slice(0, 8), mono: true },
            { label: "Detail", value: "Item retry triggered" },
            { label: "Updated", value: formatActionTime(), mono: true },
          ],
        });
      } catch (e: any) {
        console.error("Failed to trigger pending item retry:", e);
        setPendingRetryResult({
          fields: [
            { label: "Result", value: "Failed", tone: "error" },
            { label: "Item", value: id.slice(0, 8), mono: true },
            { label: "Detail", value: getErrorMessage(e), truncate: true },
            { label: "Updated", value: formatActionTime(), mono: true },
          ],
        });
      } finally {
        setRetryingItemId(null);
      }
    });
  };

  const handleDeleteItem = async (id: string) => {
    setPendingRetryResult(null);
    if (!requireDesktopRuntime("Delete pending item", setPendingRetryResult)) {
      return;
    }
    await runExclusive(`delete_item:${id}`, async () => {
      try {
        setDeletingItemId(id);
        await invoke("delete_pending_upload_item", { id });
        await refreshPendingRetryStatus();
        setPendingRetryResult({
          fields: [
            { label: "Result", value: "Deleted", tone: "success" },
            { label: "Item", value: id.slice(0, 8), mono: true },
            { label: "Detail", value: "Pending item removed" },
            { label: "Updated", value: formatActionTime(), mono: true },
          ],
        });
      } catch (e: any) {
        console.error("Failed to delete pending item:", e);
        setPendingRetryResult({
          fields: [
            { label: "Result", value: "Failed", tone: "error" },
            { label: "Item", value: id.slice(0, 8), mono: true },
            { label: "Detail", value: getErrorMessage(e), truncate: true },
            { label: "Updated", value: formatActionTime(), mono: true },
          ],
        });
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
    <div class="bg-base-100 min-h-full">
      <div class="max-w-4xl mx-auto px-6 py-6 space-y-6">
        <header class="space-y-1">
          <h1 class="text-2xl font-bold tracking-tight">Uploads</h1>
          <p class="text-sm text-base-content/65">
            Inspect pending upload retry queues and local deduplication
            suppression keys.
          </p>
        </header>

        {/* Pending Uploads */}
        <section class="space-y-2.5">
          <h2 class="text-xs font-semibold uppercase tracking-wider text-base-content/60">
            Pending Uploads
          </h2>
          <div class="bg-base-100 rounded-box border border-base-300 divide-y divide-base-300">
            <div class="p-4 space-y-3">
              <div class="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div class="space-y-0.5 min-w-0">
                  <h3 class="text-sm font-semibold">Pending Upload Retry</h3>
                  <p class="text-xs text-base-content/65">
                    Force retry pending uploads immediately without waiting for
                    the next startup or retry interval. You can also retry or
                    delete each pending item directly.
                  </p>
                </div>
                <div class="flex flex-col sm:flex-row md:flex-col lg:flex-row sm:items-center md:items-end lg:items-center gap-2 shrink-0">
                  <button
                    type="button"
                    class={`btn btn-secondary enabled:border-secondary-content ${SETTING_ROW_BUTTON_SIZE_CLASS}`}
                    onClick={() => {
                      void refreshPendingRetryStatus();
                    }}
                    disabled={
                      loadingPendingRetryStatus() ||
                      !!confirmModalState() ||
                      isUiLocked()
                    }
                  >
                    <Show when={loadingPendingRetryStatus()}>
                      <span class="loading loading-spinner loading-xs" />
                    </Show>
                    {loadingPendingRetryStatus()
                      ? "Refreshing..."
                      : "Refresh Status"}
                  </button>
                  <button
                    type="button"
                    class={`btn btn-primary enabled:border-primary-content ${SETTING_ROW_BUTTON_SIZE_CLASS}`}
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
                    disabled={
                      retryingPendingUploads() ||
                      confirmSubmitting() ||
                      isUiLocked()
                    }
                  >
                    <Show when={retryingPendingUploads()}>
                      <span class="loading loading-spinner loading-xs" />
                    </Show>
                    {retryingPendingUploads()
                      ? "Retrying..."
                      : "Retry Pending Now"}
                  </button>
                </div>
              </div>

              <Show when={pendingRetryStatus()}>
                {(status) => (
                  <div class="space-y-3 pt-1">
                    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 bg-base-200/40 rounded-lg border border-base-300 px-3.5 py-2.5 text-xs">
                      <div>
                        <div class="text-base-content/55">Total Pending</div>
                        <div
                          class={`font-mono tabular-nums font-semibold mt-0.5 ${
                            status().total_pending > 0
                              ? "text-warning"
                              : "text-success"
                          }`}
                        >
                          {status().total_pending}
                        </div>
                      </div>
                      <div>
                        <div class="text-base-content/55">Due Now</div>
                        <div class="font-mono tabular-nums mt-0.5">
                          {status().due_now_count}
                        </div>
                      </div>
                      <div>
                        <div class="text-base-content/55">Max Attempts</div>
                        <div class="font-mono tabular-nums mt-0.5">
                          {status().max_attempts}
                        </div>
                      </div>
                      <div>
                        <div class="text-base-content/55">Base Interval</div>
                        <div class="font-mono tabular-nums mt-0.5">
                          {status().interval_seconds}s
                        </div>
                      </div>
                      <div>
                        <div class="text-base-content/55">TTL</div>
                        <div class="font-mono tabular-nums mt-0.5">
                          {status().ttl_seconds}s
                        </div>
                      </div>
                      <div>
                        <div class="text-base-content/55">Next Due</div>
                        <div class="font-mono tabular-nums mt-0.5">
                          {formatEpochSeconds(status().next_due_at)}
                        </div>
                      </div>
                    </div>

                    <Show when={status().items.length > 0}>
                      <div class="overflow-x-auto rounded-lg border border-base-300">
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
                                  <td class="font-mono">
                                    {item.id.slice(0, 8)}
                                  </td>
                                  <td class="font-mono">{item.pending_type}</td>
                                  <td>{item.attempt_count}</td>
                                  <td>
                                    {formatEpochSeconds(item.next_due_at)}
                                  </td>
                                  <td>
                                    {formatRemainingSeconds(
                                      item.seconds_until_next_due,
                                    )}
                                  </td>
                                  <td>{formatEpochSeconds(item.expires_at)}</td>
                                  <td>
                                    <div class="flex items-center gap-1">
                                      <button
                                        type="button"
                                        class={`btn btn-primary enabled:border-primary-content ${COMPACT_ROW_BUTTON_SIZE_CLASS}`}
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
                                            action: () =>
                                              handleRetryItemNow(item.id),
                                          })
                                        }
                                      >
                                        {retryingItemId() === item.id
                                          ? "Retrying..."
                                          : "Retry now"}
                                      </button>
                                      <button
                                        type="button"
                                        class={`btn btn-error btn-outline ${COMPACT_ROW_BUTTON_SIZE_CLASS}`}
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
                                            action: () =>
                                              handleDeleteItem(item.id),
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

              <ActionSummaryGrid summary={pendingRetryResult()} />
            </div>
          </div>
        </section>

        {/* Upload Suppression */}
        <section class="space-y-2.5">
          <h2 class="text-xs font-semibold uppercase tracking-wider text-base-content/60">
            Upload Suppression
          </h2>
          <div class="bg-base-100 rounded-box border border-base-300 divide-y divide-base-300">
            <SuppressionSection
              title="Ship Growth Suppression"
              description="Track the current local suppression keys for EXP, naked parameter bounds, and caps."
              loading={loadingShipGrowthStatus()}
              status={shipGrowthStatus()}
              result={shipGrowthResult()}
              onRefresh={refreshShipGrowthStatus}
            />

            <SuppressionSection
              title="Quest Tree Suppression"
              description="Track the current local suppression keys for quest tree data uploads."
              loading={loadingQuestTreeStatus()}
              status={questTreeStatus()}
              result={questTreeResult()}
              onRefresh={refreshQuestTreeStatus}
            />

            <SuppressionSection
              title="Remodel Suppression"
              description="Track the current local suppression keys for remodel data uploads."
              loading={loadingRemodelStatus()}
              status={remodelStatus()}
              result={remodelResult()}
              onRefresh={refreshRemodelStatus}
            />
          </div>
        </section>
      </div>

      <Show when={confirmModalState()}>
        {(modalState) => (
          <dialog class="modal modal-open" open>
            <div class="modal-box border border-base-300">
              <h3 class="font-bold text-lg">{modalState().title}</h3>
              <p class="py-3 text-sm text-base-content/80">
                {modalState().message}
              </p>
              <div class="modal-action">
                <button
                  type="button"
                  class={`btn btn-outline ${CONFIRM_BUTTON_SIZE_CLASS}`}
                  onClick={closeConfirmModal}
                  disabled={confirmSubmitting() || hasRunningOperation()}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  class={`btn ${modalState().confirmClass} ${CONFIRM_BUTTON_SIZE_CLASS}`}
                  onClick={() => {
                    void runConfirmedAction();
                  }}
                  disabled={confirmSubmitting() || hasRunningOperation()}
                >
                  {confirmSubmitting()
                    ? "Processing..."
                    : modalState().confirmLabel}
                </button>
              </div>
            </div>
            <form method="dialog" class="modal-backdrop">
              <button type="button" onClick={closeConfirmModal}>
                close
              </button>
            </form>
          </dialog>
        )}
      </Show>
    </div>
  );
}
