import { invoke } from "@tauri-apps/api/core";
import { createSignal, For, Show } from "solid-js";
import { AlertMessage } from "ui";
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
import {
  ConfigEditorComponent,
  type ConfigEditorPreviewProps,
} from "./config_editor";

type SessionHealth = {
  has_session: boolean;
  access_token_len: number;
  refresh_token_len: number;
  seems_valid: boolean;
  reason?: string | null;
};

interface DataLoaderItem {
  id: string;
  cmd: string;
  label: string;
  dataKey: string;
  endpoint: string;
}

// IMPORTANT: Load All relies on exact API dependency order (get_data -> member APIs).
const DATA_LOADER_ITEMS: readonly DataLoaderItem[] = [
  {
    id: "load_mst_ships",
    cmd: "get_mst_ships",
    label: "Master Ships",
    dataKey: "mst_ships",
    endpoint: "/kcsapi/api_start2/get_data",
  },
  {
    id: "load_mst_slot_items",
    cmd: "get_mst_slot_items",
    label: "Master Slot Items",
    dataKey: "mst_slot_items",
    endpoint: "/kcsapi/api_start2/get_data",
  },
  {
    id: "load_mst_equip_exslot_ships",
    cmd: "get_mst_equip_exslot_ships",
    label: "Master Exslot Ships",
    dataKey: "mst_equip_exslot_ships",
    endpoint: "/kcsapi/api_start2/get_data",
  },
  {
    id: "load_mst_slotitem_equip_types",
    cmd: "get_mst_slotitem_equip_types",
    label: "Master Equip Types",
    dataKey: "mst_slotitem_equip_types",
    endpoint: "/kcsapi/api_start2/get_data",
  },
  {
    id: "load_mst_equip_ships",
    cmd: "get_mst_equip_ships",
    label: "Master Equip Ships",
    dataKey: "mst_equip_ships",
    endpoint: "/kcsapi/api_start2/get_data",
  },
  {
    id: "load_mst_stypes",
    cmd: "get_mst_stypes",
    label: "Master Ship Types",
    dataKey: "mst_stypes",
    endpoint: "/kcsapi/api_start2/get_data",
  },
  {
    id: "load_mst_useitems",
    cmd: "get_mst_useitems",
    label: "Master Use Items",
    dataKey: "mst_useitems",
    endpoint: "/kcsapi/api_start2/get_data",
  },
  {
    id: "load_mst_useitem_metas",
    cmd: "get_mst_useitem_metas",
    label: "Master Use Item Meta",
    dataKey: "mst_useitem_metas",
    endpoint: "/kcsapi/api_start2/get_data",
  },
  {
    id: "load_slot_items",
    cmd: "get_slot_items",
    label: "Owned Slot Items",
    dataKey: "slot_items",
    endpoint: "/kcsapi/api_get_member/require_info",
  },
  {
    id: "load_use_items",
    cmd: "get_use_items",
    label: "Owned Use Items",
    dataKey: "use_items",
    endpoint: "/kcsapi/api_get_member/useitem",
  },
  {
    id: "load_pay_items",
    cmd: "get_pay_items",
    label: "Owned Pay Items",
    dataKey: "pay_items",
    endpoint: "/kcsapi/api_get_member/payitem",
  },
  {
    id: "load_quests",
    cmd: "get_quests",
    label: "Quest List",
    dataKey: "quests",
    endpoint: "/kcsapi/api_get_member/questlist",
  },
  {
    id: "load_n_docks",
    cmd: "get_n_docks",
    label: "Repair Docks",
    dataKey: "n_docks",
    endpoint: "/kcsapi/api_get_member/ndock",
  },
  {
    id: "load_mst_missions",
    cmd: "get_mst_missions",
    label: "Master Missions",
    dataKey: "mst_missions",
    endpoint: "/kcsapi/api_start2/get_data",
  },
];

export interface SettingsComponentProps {
  configPreview?: ConfigEditorPreviewProps;
  mode?: "app" | "start";
}

export function SettingsComponent(props: SettingsComponentProps = {}) {
  const isStartMode = () => props.mode === "start";
  const [sessionHealth, setSessionHealth] = createSignal<SessionHealth | null>(
    null,
  );
  const [sessionHealthError, setSessionHealthError] =
    createSignal<ActionSummary | null>(null);
  const [syncResult, setSyncResult] = createSignal<ActionSummary | null>(null);
  const [signOutResult, setSignOutResult] = createSignal<ActionSummary | null>(
    null,
  );
  const [loadAllResult, setLoadAllResult] = createSignal<ActionSummary | null>(
    null,
  );
  const [singleLoadResult, setSingleLoadResult] =
    createSignal<ActionSummary | null>(null);
  const [checkingHealth, setCheckingHealth] = createSignal(false);
  const [signingOut, setSigningOut] = createSignal(false);
  const [confirmSignOut, setConfirmSignOut] = createSignal(false);
  const [syncingSnapshot, setSyncingSnapshot] = createSignal(false);
  const [loadingDataKey, setLoadingDataKey] = createSignal<string | null>(null);

  const requireDesktopRuntime = (
    scope: string,
    setResult: (summary: ActionSummary | null) => void,
  ): boolean => {
    if (isTauri()) return true;
    setResult(createDesktopRuntimeSummary(scope));
    return false;
  };

  const handleManualSnapshotSync = async () => {
    setSyncResult(null);
    if (!requireDesktopRuntime("Snapshot sync", setSyncResult)) return;
    setSyncingSnapshot(true);
    try {
      await invoke("perform_snapshot_sync");
      setSyncResult({
        fields: [
          { label: "Result", value: "Triggered", tone: "success" },
          { label: "Target", value: "Snapshot", mono: true },
          { label: "Detail", value: "Sync started" },
          { label: "Updated", value: formatActionTime(), mono: true },
        ],
      });
    } catch (e) {
      console.error("manual snapshot sync failed:", e);
      setSyncResult({
        fields: [
          { label: "Result", value: "Failed", tone: "error" },
          { label: "Target", value: "Snapshot", mono: true },
          { label: "Detail", value: "Trigger failed" },
          { label: "Updated", value: formatActionTime(), mono: true },
        ],
      });
    } finally {
      setSyncingSnapshot(false);
    }
  };

  const handleCheckSessionHealth = async () => {
    setSessionHealthError(null);
    if (
      !requireDesktopRuntime("Session check", (summary) => {
        setSessionHealth(null);
        setSessionHealthError(summary);
      })
    ) {
      return;
    }
    setCheckingHealth(true);
    try {
      const health = await invoke<SessionHealth>(
        "check_supabase_session_health",
      );
      setSessionHealth(health);
    } catch (e) {
      console.error("Failed to check session health:", e);
      setSessionHealth(null);
      setSessionHealthError({
        fields: [
          { label: "Result", value: "Failed", tone: "error" },
          { label: "Target", value: "Supabase session" },
          { label: "Detail", value: "Health check error" },
          { label: "Checked", value: formatActionTime(), mono: true },
        ],
      });
    } finally {
      setCheckingHealth(false);
    }
  };

  const handleForceLocalSignOut = async () => {
    setSignOutResult(null);
    if (!requireDesktopRuntime("Local sign out", setSignOutResult)) {
      setConfirmSignOut(false);
      return;
    }
    setConfirmSignOut(false);
    setSigningOut(true);
    try {
      await invoke("force_local_sign_out");
      setSessionHealth(null);
      setSessionHealthError(null);
      setSignOutResult({
        fields: [
          { label: "Result", value: "Cleared", tone: "success" },
          { label: "Scope", value: "Local tokens" },
          { label: "Next Step", value: "Sign in again" },
          { label: "Updated", value: formatActionTime(), mono: true },
        ],
      });
    } catch (e) {
      console.error("Failed to force local sign out:", e);
      setSignOutResult({
        fields: [
          { label: "Result", value: "Failed", tone: "error" },
          { label: "Scope", value: "Local tokens" },
          { label: "Detail", value: "Clear failed" },
          { label: "Updated", value: formatActionTime(), mono: true },
        ],
      });
    } finally {
      setSigningOut(false);
    }
  };

  const handleLoadAllData = async () => {
    setLoadAllResult(null);
    if (!requireDesktopRuntime("Cached data", setLoadAllResult)) return;
    setLoadingDataKey("all");
    let loadedCount = 0;
    let currentDataKey = "";
    try {
      for (const item of DATA_LOADER_ITEMS) {
        currentDataKey = item.dataKey;
        await invoke(item.cmd);
        loadedCount += 1;
      }
      setLoadAllResult({
        fields: [
          { label: "Result", value: "Loaded", tone: "success" },
          {
            label: "Datasets",
            value: `${loadedCount} / ${DATA_LOADER_ITEMS.length}`,
            mono: true,
          },
          { label: "Order", value: "Dependency" },
          { label: "Updated", value: formatActionTime(), mono: true },
        ],
      });
    } catch (e) {
      console.error("Failed to load all data:", e);
      setLoadAllResult({
        fields: [
          { label: "Result", value: "Failed", tone: "error" },
          {
            label: "Datasets",
            value: `${loadedCount} / ${DATA_LOADER_ITEMS.length}`,
            mono: true,
          },
          {
            label: "Failed At",
            value: currentDataKey || "unknown",
            mono: true,
            truncate: true,
          },
          { label: "Updated", value: formatActionTime(), mono: true },
        ],
      });
    } finally {
      setLoadingDataKey(null);
    }
  };

  const handleLoadSingleData = async (item: DataLoaderItem) => {
    setSingleLoadResult(null);
    if (!requireDesktopRuntime(item.dataKey, setSingleLoadResult)) {
      return;
    }
    setLoadingDataKey(item.cmd);
    try {
      await invoke(item.cmd);
      setSingleLoadResult({
        fields: [
          { label: "Result", value: "Loaded", tone: "success" },
          { label: "Dataset", value: item.dataKey, mono: true, truncate: true },
          {
            label: "Endpoint",
            value: item.endpoint,
            mono: true,
            truncate: true,
          },
          { label: "Updated", value: formatActionTime(), mono: true },
        ],
      });
    } catch (e) {
      console.error(`Failed to invoke ${item.cmd}:`, e);
      setSingleLoadResult({
        fields: [
          { label: "Result", value: "Failed", tone: "error" },
          { label: "Dataset", value: item.dataKey, mono: true, truncate: true },
          {
            label: "Endpoint",
            value: item.endpoint,
            mono: true,
            truncate: true,
          },
          { label: "Updated", value: formatActionTime(), mono: true },
        ],
      });
    } finally {
      setLoadingDataKey(null);
    }
  };

  return (
    <div class="bg-base-100 min-h-full">
      <div class="max-w-4xl mx-auto px-6 py-6 space-y-6">
        <header class="space-y-1">
          <h1 class="text-2xl font-bold tracking-tight">Settings</h1>
          <p class="text-sm text-base-content/65">
            Configure FUSOU application preferences, manage snapshot sync,
            Supabase session diagnostics, and cached response loaders.
          </p>
        </header>

        {/* Application Configuration (configs.toml) */}
        <ConfigEditorComponent preview={props.configPreview} />

        {/* Sync & Application */}
        <section class="space-y-2.5">
          <h2 class="text-xs font-semibold uppercase tracking-wider text-base-content/60">
            Sync &amp; Application
          </h2>
          <div class="bg-base-100 rounded-box border border-base-300 divide-y divide-base-300">
            <div class="p-4 space-y-3">
              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div class="space-y-0.5 min-w-0">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <h3 class="text-sm font-semibold">Manual Snapshot Sync</h3>
                    <Show when={isStartMode()}>
                      <span class="badge badge-xs badge-ghost">
                        Available after launch
                      </span>
                    </Show>
                  </div>
                  <p class="text-xs text-base-content/65">
                    Trigger an immediate snapshot synchronization with the
                    configured server.
                  </p>
                </div>
                <button
                  type="button"
                  class={`btn btn-primary enabled:border-primary-content ${SETTING_ROW_BUTTON_SIZE_CLASS}`}
                  disabled={isStartMode() || syncingSnapshot()}
                  onClick={handleManualSnapshotSync}
                >
                  <Show when={syncingSnapshot()}>
                    <span class="loading loading-spinner loading-xs" />
                  </Show>
                  {syncingSnapshot() ? "Syncing..." : "Sync Snapshot"}
                </button>
              </div>
              <ActionSummaryGrid summary={syncResult()} />
            </div>

            <div class="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div class="space-y-0.5 min-w-0">
                <h3 class="text-sm font-semibold">Reload Application UI</h3>
                <p class="text-xs text-base-content/65">
                  Reload FUSOU dashboard pages without affecting the KanColle
                  game window.
                </p>
              </div>
              <button
                type="button"
                class={`btn btn-outline ${SETTING_ROW_BUTTON_SIZE_CLASS}`}
                onClick={() => window.location.reload()}
              >
                Reload UI
              </button>
            </div>
          </div>
        </section>

        {/* Session & Authentication */}
        <section class="space-y-2.5">
          <div class="flex items-center gap-2">
            <h2 class="text-xs font-semibold uppercase tracking-wider text-base-content/60">
              Session &amp; Authentication
            </h2>
            <Show when={isStartMode()}>
              <span class="badge badge-xs badge-ghost">
                Available after launch
              </span>
            </Show>
          </div>
          <div class="bg-base-100 rounded-box border border-base-300 divide-y divide-base-300">
            <div class="p-4 space-y-3">
              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div class="space-y-0.5 min-w-0">
                  <h3 class="text-sm font-semibold">Supabase Session Health</h3>
                  <p class="text-xs text-base-content/65">
                    Inspect cached session availability, token sizes, and
                    integrity.
                  </p>
                </div>
                <button
                  type="button"
                  class={`btn btn-secondary enabled:border-secondary-content ${SETTING_ROW_BUTTON_SIZE_CLASS}`}
                  onClick={handleCheckSessionHealth}
                  disabled={isStartMode() || checkingHealth()}
                >
                  <Show when={checkingHealth()}>
                    <span class="loading loading-spinner loading-xs" />
                  </Show>
                  {checkingHealth() ? "Checking..." : "Check Session Health"}
                </button>
              </div>

              <Show when={sessionHealth()}>
                {(h) => (
                  <div class="space-y-3 pt-1">
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-base-200/40 rounded-lg border border-base-300 px-3.5 py-2.5 text-xs">
                      <div>
                        <div class="text-base-content/55">Session</div>
                        <div
                          class={`font-semibold mt-0.5 ${
                            h().has_session ? "text-success" : "text-warning"
                          }`}
                        >
                          {h().has_session ? "Present" : "Missing"}
                        </div>
                      </div>
                      <div>
                        <div class="text-base-content/55">Status</div>
                        <div
                          class={`font-semibold mt-0.5 ${
                            h().seems_valid ? "text-success" : "text-error"
                          }`}
                        >
                          {h().seems_valid ? "Looks OK" : "Invalid / Corrupted"}
                        </div>
                      </div>
                      <div>
                        <div class="text-base-content/55">Access Token</div>
                        <div class="font-mono tabular-nums mt-0.5">
                          {h().access_token_len} chars
                        </div>
                      </div>
                      <div>
                        <div class="text-base-content/55">Refresh Token</div>
                        <div class="font-mono tabular-nums mt-0.5">
                          {h().refresh_token_len} chars
                        </div>
                      </div>
                    </div>

                    <Show when={h().reason}>
                      {(r) => (
                        <AlertMessage
                          type={h().seems_valid ? "info" : "warning"}
                        >
                          {r()}
                        </AlertMessage>
                      )}
                    </Show>
                  </div>
                )}
              </Show>
              <ActionSummaryGrid summary={sessionHealthError()} />
            </div>

            <div class="p-4 space-y-3">
              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div class="space-y-0.5 min-w-0">
                  <h3 class="text-sm font-semibold">Clear Local Session</h3>
                  <p class="text-xs text-base-content/65">
                    Remove the stored Supabase credentials on this device and
                    sign out locally.
                  </p>
                </div>
                <Show when={!confirmSignOut()}>
                  <button
                    type="button"
                    class={`btn btn-error btn-outline ${SETTING_ROW_BUTTON_SIZE_CLASS}`}
                    onClick={() => {
                      setSignOutResult(null);
                      setConfirmSignOut(true);
                    }}
                    disabled={isStartMode() || signingOut()}
                  >
                    {signingOut() ? "Signing out..." : "Force Local Sign Out"}
                  </button>
                </Show>
              </div>

              <Show when={confirmSignOut()}>
                <div class="space-y-3">
                  <AlertMessage type="warning" title="Confirm Local Sign Out">
                    This clears cached Supabase tokens on this device and
                    requires signing in again.
                  </AlertMessage>
                  <div class="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      class={`btn btn-outline ${CONFIRM_BUTTON_SIZE_CLASS}`}
                      onClick={() => setConfirmSignOut(false)}
                      disabled={signingOut()}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      class={`btn btn-error ${CONFIRM_BUTTON_SIZE_CLASS}`}
                      onClick={handleForceLocalSignOut}
                      disabled={signingOut()}
                    >
                      {signingOut() ? "Signing out..." : "Confirm Sign Out"}
                    </button>
                  </div>
                </div>
              </Show>
              <ActionSummaryGrid summary={signOutResult()} />
            </div>
          </div>
        </section>

        {/* Cached Game Data */}
        <section class="space-y-2.5">
          <div class="flex items-center gap-2">
            <h2 class="text-xs font-semibold uppercase tracking-wider text-base-content/60">
              Cached Game Data
            </h2>
            <Show when={isStartMode()}>
              <span class="badge badge-xs badge-ghost">
                Available after launch
              </span>
            </Show>
          </div>
          <div class="bg-base-100 rounded-box border border-base-300 divide-y divide-base-300">
            <div class="p-4 space-y-3">
              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div class="space-y-0.5 min-w-0">
                  <h3 class="text-sm font-semibold">Load All Cached Data</h3>
                  <p class="text-xs text-base-content/65">
                    Restore locally saved KanColle master and member response
                    data in dependency order without querying the game server.
                  </p>
                </div>
                <button
                  type="button"
                  class={`btn btn-primary enabled:border-primary-content ${SETTING_ROW_BUTTON_SIZE_CLASS}`}
                  disabled={isStartMode() || loadingDataKey() !== null}
                  onClick={handleLoadAllData}
                >
                  <Show when={loadingDataKey() === "all"}>
                    <span class="loading loading-spinner loading-xs" />
                  </Show>
                  {loadingDataKey() === "all" ? "Loading..." : "Load All Data"}
                </button>
              </div>
              <ActionSummaryGrid summary={loadAllResult()} />
            </div>

            <details class="group" data-testid="individual-dataset-loaders">
              <summary class="px-4 py-3 flex items-center justify-between gap-2 cursor-pointer select-none text-sm font-medium text-base-content/80 hover:text-base-content hover:bg-base-200/30 transition-colors list-none">
                <span class="flex items-center gap-2">
                  <span>Individual Dataset Loaders</span>
                  <span class="badge badge-xs badge-ghost font-mono">
                    {DATA_LOADER_ITEMS.length}
                  </span>
                </span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  class="w-4 h-4 text-base-content/55 transition-transform duration-150 group-open:rotate-180"
                  aria-hidden="true"
                >
                  <path
                    fill-rule="evenodd"
                    d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                    clip-rule="evenodd"
                  />
                </svg>
              </summary>

              <div class="px-4 pb-4 pt-2 space-y-3">
                <div class="grid grid-cols-1 gap-2.5">
                  <For each={DATA_LOADER_ITEMS}>
                    {(item) => (
                      <div
                        id={item.id}
                        class="rounded-lg border border-base-300 bg-base-200/20 px-3 py-2.5 flex items-center justify-between gap-3"
                      >
                        <div class="min-w-0">
                          <div class="text-sm font-medium leading-tight">
                            {item.label}
                          </div>
                          <div class="text-[11px] font-mono text-base-content/55 truncate mt-0.5">
                            {item.dataKey} · {item.endpoint}
                          </div>
                        </div>
                        <button
                          type="button"
                          class={`btn btn-secondary enabled:border-secondary-content ${COMPACT_ROW_BUTTON_SIZE_CLASS}`}
                          disabled={isStartMode() || loadingDataKey() !== null}
                          onClick={() => handleLoadSingleData(item)}
                        >
                          <Show when={loadingDataKey() === item.cmd}>
                            <span class="loading loading-spinner loading-xs" />
                          </Show>
                          Load
                        </button>
                      </div>
                    )}
                  </For>
                </div>
                <ActionSummaryGrid summary={singleLoadResult()} />
              </div>
            </details>
          </div>
        </section>
      </div>
    </div>
  );
}
