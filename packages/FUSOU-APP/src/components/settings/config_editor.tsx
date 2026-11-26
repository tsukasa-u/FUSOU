import { invoke } from "@tauri-apps/api/core";
import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { AlertMessage } from "ui";
import { applyAppFont } from "../../utility/google_font";
import { isTauri } from "../../utility/tauri";
import { applyAppTheme, normalizeAppTheme } from "../../utility/theme";
import { applyUiConfigFromValues } from "../../utility/ui_config";
import { loadWindowLayoutState } from "../../utility/window_layout";
import {
  ActionSummaryGrid,
  createDesktopRuntimeSummary,
  formatActionTime,
  type ActionSummary,
} from "./action_result";
import {
  ADVANCED_CONFIG_SECTIONS,
  cloneConfigValues,
  DATA_SENDER_SPECS,
  DEFAULT_CONFIG_VALUES,
  DEFAULT_RESTART_REQUIRED_KEYS,
  DEFAULT_SERVER_OPTIONS,
  diffConfigValues,
  FIELD_SPEC_BY_KEY,
  formatStringArrayInput,
  getConfigKeyLabel,
  getRestartRequiredKeys,
  parseStringArrayInput,
  PRIMARY_CONFIG_SECTIONS,
  UI_CONFIG_SECTIONS,
  validateConfigChanges,
  type AppConfigsResponse,
  type ConfigFieldSpec,
  type ConfigSectionSpec,
  type ConfigValue,
  type ConfigValuesMap,
  type KcServerOption,
  type SaveAppConfigsResponse,
} from "./config_schema";
import { FontPickerField } from "./font_picker";
import { RestartRequiredModal } from "./restart_modal";

export interface ConfigEditorPreviewProps {
  initialValues?: ConfigValuesMap;
  defaults?: ConfigValuesMap;
  configPath?: string;
  platform?: string;
  systemFonts?: readonly string[];
  onSave?: (
    updates: ConfigValuesMap,
  ) => Promise<SaveAppConfigsResponse> | SaveAppConfigsResponse;
  onRestart?: () => Promise<void> | void;
  onOpenConfigFile?: () => Promise<void> | void;
}

const getErrorMessage = (error: unknown): string => {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
};

export function ConfigEditorComponent(props: {
  preview?: ConfigEditorPreviewProps;
}) {
  const [loading, setLoading] = createSignal(false);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [configPath, setConfigPath] = createSignal<string>("");
  const [platform, setPlatform] = createSignal<string>("windows");
  const [defaults, setDefaults] = createSignal<ConfigValuesMap>(
    cloneConfigValues(DEFAULT_CONFIG_VALUES),
  );
  const [baseline, setBaseline] = createSignal<ConfigValuesMap>(
    cloneConfigValues(DEFAULT_CONFIG_VALUES),
  );
  const [draft, setDraft] = createSignal<ConfigValuesMap>(
    cloneConfigValues(DEFAULT_CONFIG_VALUES),
  );
  const [serverList, setServerList] = createSignal<readonly KcServerOption[]>(
    DEFAULT_SERVER_OPTIONS,
  );
  const [restartKeySet, setRestartKeySet] = createSignal<ReadonlySet<string>>(
    DEFAULT_RESTART_REQUIRED_KEYS,
  );

  // Raw text buffers for number and string_array fields so editing never jumps mid-keystroke.
  const [rawInputs, setRawInputs] = createSignal<Record<string, string>>({});
  const [customServerMode, setCustomServerMode] = createSignal(false);

  const [saving, setSaving] = createSignal(false);
  const [saveSummary, setSaveSummary] = createSignal<ActionSummary | null>(
    null,
  );
  const [saveError, setSaveError] = createSignal<string | null>(null);
  const [pickingPathKey, setPickingPathKey] = createSignal<string | null>(null);

  const [systemFonts, setSystemFonts] = createSignal<string[]>([]);
  const [systemFontsLoading, setSystemFontsLoading] = createSignal(false);
  const [systemFontsError, setSystemFontsError] = createSignal<string | null>(
    null,
  );

  const loadSystemFonts = async () => {
    setSystemFontsError(null);
    if (props.preview) {
      setSystemFonts([...(props.preview.systemFonts ?? [])]);
      return;
    }
    if (!isTauri()) {
      setSystemFonts([]);
      return;
    }
    setSystemFontsLoading(true);
    try {
      const fonts = await invoke<string[]>("list_system_fonts");
      setSystemFonts(Array.isArray(fonts) ? fonts : []);
    } catch (err) {
      console.warn("Failed to list system fonts:", err);
      setSystemFontsError(getErrorMessage(err));
    } finally {
      setSystemFontsLoading(false);
    }
  };

  const [restartModalOpen, setRestartModalOpen] = createSignal(false);
  const [restartModalKeys, setRestartModalKeys] = createSignal<string[]>([]);
  const [pendingRestartKeys, setPendingRestartKeys] = createSignal<string[]>(
    [],
  );
  const [restarting, setRestarting] = createSignal(false);
  const [restartError, setRestartError] = createSignal<string | null>(null);

  const syncCustomServerMode = (
    values: ConfigValuesMap,
    servers: readonly KcServerOption[],
  ) => {
    const current = values["app.connect_kc_server.kc_server_name"];
    if (typeof current === "string" && current.trim().length > 0) {
      const known = servers.some((s) => s.hostname === current);
      setCustomServerMode(!known);
    } else {
      setCustomServerMode(false);
    }
  };

  const loadConfigs = async () => {
    setLoadError(null);

    if (props.preview) {
      const init = cloneConfigValues(
        props.preview.initialValues ?? DEFAULT_CONFIG_VALUES,
      );
      const defs = cloneConfigValues(
        props.preview.defaults ?? DEFAULT_CONFIG_VALUES,
      );
      setBaseline(init);
      setDraft(cloneConfigValues(init));
      setDefaults(defs);
      setConfigPath(props.preview.configPath ?? "configs.toml");
      setPlatform(props.preview.platform ?? "windows");
      setRawInputs({});
      syncCustomServerMode(init, serverList());
      return;
    }

    if (!isTauri()) {
      const defs = cloneConfigValues(DEFAULT_CONFIG_VALUES);
      setBaseline(defs);
      setDraft(cloneConfigValues(defs));
      setDefaults(cloneConfigValues(defs));
      setRawInputs({});
      syncCustomServerMode(defs, serverList());
      return;
    }

    setLoading(true);
    try {
      const res = await invoke<AppConfigsResponse>("get_app_configs");
      const mergedDefaults = {
        ...cloneConfigValues(DEFAULT_CONFIG_VALUES),
        ...cloneConfigValues(res.defaults),
      };
      const mergedValues = {
        ...cloneConfigValues(mergedDefaults),
        ...cloneConfigValues(res.values),
      };
      const servers =
        res.server_list.length > 0 ? res.server_list : DEFAULT_SERVER_OPTIONS;

      setConfigPath(res.config_path);
      setPlatform(res.platform);
      setDefaults(mergedDefaults);
      setBaseline(mergedValues);
      setDraft(cloneConfigValues(mergedValues));
      setServerList(servers);
      setRestartKeySet(new Set(res.restart_required_keys));
      setRawInputs({});
      syncCustomServerMode(mergedValues, servers);
    } catch (e) {
      console.error("Failed to load app configs:", e);
      setLoadError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    void loadConfigs();
    void loadSystemFonts();
  });

  const changedValues = createMemo(() => diffConfigValues(baseline(), draft()));
  const changedKeys = createMemo(() => Object.keys(changedValues()));
  const hasUnsavedChanges = createMemo(() => changedKeys().length > 0);
  const changedRestartKeys = createMemo(() =>
    getRestartRequiredKeys(changedKeys(), restartKeySet()),
  );
  const validationErrors = createMemo(() => {
    const errors = validateConfigChanges(changedValues());
    const raw = rawInputs();
    for (const [key, text] of Object.entries(raw)) {
      if (text.trim() === "" && typeof baseline()[key] === "number") {
        errors[key] = "Value is required.";
      }
    }
    return errors;
  });
  const hasValidationErrors = createMemo(
    () => Object.keys(validationErrors()).length > 0,
  );

  const isFieldDisabled = (spec: ConfigFieldSpec): boolean => {
    let current: ConfigFieldSpec | undefined = spec;
    const visited = new Set<string>();
    while (current?.dependsOn) {
      if (visited.has(current.key)) break;
      visited.add(current.key);
      if (draft()[current.dependsOn.key] !== current.dependsOn.equals) {
        return true;
      }
      current = FIELD_SPEC_BY_KEY.get(current.dependsOn.key);
    }
    return false;
  };

  const setDraftValue = (key: string, value: ConfigValue) => {
    setSaveError(null);
    setDraft((prev) => ({
      ...prev,
      [key]: Array.isArray(value) ? [...value] : value,
    }));
  };

  const handleNumberInput = (key: string, raw: string) => {
    setRawInputs((prev) => ({ ...prev, [key]: raw }));
    const trimmed = raw.trim();
    if (trimmed === "") return;
    if (!/^-?\d+$/.test(trimmed)) {
      setDraftValue(key, Number.NaN);
      return;
    }
    const parsed = Number.parseInt(trimmed, 10);
    setDraftValue(key, parsed);
  };

  const handleStringArrayInput = (key: string, raw: string) => {
    setRawInputs((prev) => ({ ...prev, [key]: raw }));
    setDraftValue(key, parseStringArrayInput(raw));
  };

  const applyImmediateFrontendEffects = async (
    updatedKeys: readonly string[],
    updatedValues: ConfigValuesMap,
  ) => {
    if (updatedKeys.includes("app.theme.theme")) {
      const theme = updatedValues["app.theme.theme"];
      if (typeof theme === "string") {
        applyAppTheme(normalizeAppTheme(theme));
      }
    }
    if (updatedKeys.includes("app.font.font_family")) {
      const font = updatedValues["app.font.font_family"];
      if (typeof font === "string") {
        const knownSystemFonts = new Set(
          systemFonts().map((name) => name.trim().toLowerCase()),
        );
        try {
          await applyAppFont(font, { knownSystemFonts, persistStorage: true });
        } catch (err) {
          console.warn("Failed to apply app font:", err);
        }
      }
    }
    if (updatedKeys.some((key) => key.startsWith("app.ui."))) {
      applyUiConfigFromValues(updatedValues);
    }
    if (
      updatedKeys.includes("app.kc_window.dock_position") ||
      updatedKeys.includes("app.kc_window.dock_panel_ratio_percent")
    ) {
      await loadWindowLayoutState();
    }
  };

  const handleSave = async () => {
    setSaveError(null);
    setSaveSummary(null);

    const updates = changedValues();
    const keys = Object.keys(updates);
    if (keys.length === 0) return;

    if (hasValidationErrors()) {
      setSaveError("Fix validation errors before saving.");
      return;
    }

    if (!props.preview && !isTauri()) {
      setSaveSummary(createDesktopRuntimeSummary("Save configuration"));
      return;
    }

    setSaving(true);
    try {
      let response: SaveAppConfigsResponse;
      if (props.preview?.onSave) {
        response = await props.preview.onSave(updates);
      } else if (props.preview) {
        const nextValues = {
          ...cloneConfigValues(baseline()),
          ...cloneConfigValues(updates),
        };
        const restartKeys = getRestartRequiredKeys(keys, restartKeySet());
        response = {
          values: nextValues,
          updated_keys: keys,
          restart_required: restartKeys.length > 0,
          restart_required_keys: restartKeys,
        };
      } else {
        response = await invoke<SaveAppConfigsResponse>("save_app_configs", {
          updates,
        });
      }

      const nextBaseline = {
        ...cloneConfigValues(baseline()),
        ...cloneConfigValues(response.values),
      };
      setBaseline(nextBaseline);
      setDraft(cloneConfigValues(nextBaseline));
      setRawInputs({});
      syncCustomServerMode(nextBaseline, serverList());

      await applyImmediateFrontendEffects(response.updated_keys, nextBaseline);

      if (response.restart_required) {
        const mergedPending = Array.from(
          new Set([...pendingRestartKeys(), ...response.restart_required_keys]),
        );
        setPendingRestartKeys(mergedPending);
        setRestartModalKeys(response.restart_required_keys);
        setRestartError(null);
        setRestartModalOpen(true);
        setSaveSummary({
          fields: [
            { label: "Result", value: "Saved", tone: "warning" },
            {
              label: "Updated",
              value: `${response.updated_keys.length} item(s)`,
              mono: true,
            },
            { label: "Apply Mode", value: "Restart required" },
            { label: "Saved At", value: formatActionTime(), mono: true },
          ],
        });
      } else {
        setSaveSummary({
          fields: [
            { label: "Result", value: "Saved", tone: "success" },
            {
              label: "Updated",
              value: `${response.updated_keys.length} item(s)`,
              mono: true,
            },
            { label: "Apply Mode", value: "Applied immediately" },
            { label: "Saved At", value: formatActionTime(), mono: true },
          ],
        });
      }
    } catch (e) {
      console.error("Failed to save app configs:", e);
      setSaveError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    const current = cloneConfigValues(baseline());
    setDraft(current);
    setRawInputs({});
    setSaveError(null);
    syncCustomServerMode(current, serverList());
  };

  const handleResetToDefaults = () => {
    const defs = cloneConfigValues(defaults());
    setDraft(defs);
    setRawInputs({});
    setSaveError(null);
    setSaveSummary(null);
    syncCustomServerMode(defs, serverList());
  };

  const handleOpenConfigFile = async () => {
    setSaveError(null);
    if (props.preview?.onOpenConfigFile) {
      await props.preview.onOpenConfigFile();
      return;
    }
    if (!isTauri()) {
      setSaveSummary(createDesktopRuntimeSummary("Open configs.toml"));
      return;
    }
    try {
      await invoke("open_config_file");
    } catch (e) {
      setSaveError(getErrorMessage(e));
    }
  };

  const handlePickPath = async (spec: ConfigFieldSpec) => {
    if (!isTauri()) {
      setSaveSummary(createDesktopRuntimeSummary("File picker"));
      return;
    }
    setPickingPathKey(spec.key);
    try {
      const currentValue = draft()[spec.key];
      const selected = await invoke<string | null>("pick_config_path", {
        mode: spec.pathMode ?? "directory",
        current_path: typeof currentValue === "string" ? currentValue : null,
      });
      if (selected) {
        setDraftValue(spec.key, selected);
      }
    } catch (e) {
      setSaveError(getErrorMessage(e));
    } finally {
      setPickingPathKey(null);
    }
  };

  const handleRestartNow = async () => {
    setRestartError(null);
    setRestarting(true);
    try {
      if (props.preview?.onRestart) {
        await props.preview.onRestart();
        setRestartModalOpen(false);
        setPendingRestartKeys([]);
        return;
      }
      if (!isTauri()) {
        setRestartError("Desktop runtime is required to restart FUSOU.");
        return;
      }
      await invoke("restart_app");
    } catch (e) {
      console.error("Failed to restart application:", e);
      setRestartError(getErrorMessage(e));
    } finally {
      setRestarting(false);
    }
  };

  const handleRestartLater = () => {
    if (restarting()) return;
    setRestartModalOpen(false);
  };

  const isFieldModified = (key: string) => key in changedValues();

  const renderFieldRow = (spec: ConfigFieldSpec) => {
    const disabled = () => isFieldDisabled(spec);
    const modified = () => isFieldModified(spec.key);
    const error = () => validationErrors()[spec.key];
    const requiresRestart = () => restartKeySet().has(spec.key);

    return (
      <div
        class={`p-4 space-y-2 transition-opacity ${
          disabled() ? "opacity-55" : ""
        }`}
        data-config-key={spec.key}
      >
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div class="space-y-0.5 min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-1.5">
              <label
                for={`cfg-${spec.key}`}
                class="text-sm font-semibold cursor-pointer"
              >
                {spec.label}
              </label>
              <Show when={requiresRestart()}>
                <span class="badge badge-xs badge-outline border-warning/60 text-warning">
                  Restart required
                </span>
              </Show>
              <Show when={spec.linuxOnly}>
                <span class="badge badge-xs badge-ghost">Linux / Wayland</span>
              </Show>
              <Show when={modified()}>
                <span class="badge badge-xs badge-primary">Modified</span>
              </Show>
            </div>
            <p class="text-xs text-base-content/65 leading-relaxed">
              {spec.description}
            </p>
          </div>

          {/* Right-side compact controls for boolean / select / number */}
          <Show when={spec.kind === "boolean"}>
            <div class="flex items-center justify-end shrink-0">
              <input
                id={`cfg-${spec.key}`}
                type="checkbox"
                class="toggle toggle-sm toggle-primary"
                checked={Boolean(draft()[spec.key])}
                disabled={disabled() || saving()}
                onChange={(e) =>
                  setDraftValue(spec.key, e.currentTarget.checked)
                }
              />
            </div>
          </Show>

          <Show when={spec.kind === "select"}>
            <div class="w-full sm:w-56 shrink-0">
              <select
                id={`cfg-${spec.key}`}
                class="select select-sm select-bordered w-full"
                value={String(draft()[spec.key] ?? "")}
                disabled={disabled() || saving()}
                onChange={(e) => setDraftValue(spec.key, e.currentTarget.value)}
              >
                <For each={spec.options ?? []}>
                  {(opt) => <option value={opt.value}>{opt.label}</option>}
                </For>
              </select>
            </div>
          </Show>

          <Show when={spec.kind === "number"}>
            <div class="flex items-center gap-1.5 w-full sm:w-44 shrink-0">
              <input
                id={`cfg-${spec.key}`}
                type="number"
                class={`input input-sm input-bordered w-full font-mono tabular-nums text-right ${
                  error() ? "input-error" : ""
                }`}
                min={spec.min}
                max={spec.max}
                step={spec.step ?? 1}
                disabled={disabled() || saving()}
                value={
                  rawInputs()[spec.key] ??
                  (typeof draft()[spec.key] === "number" &&
                  Number.isFinite(draft()[spec.key] as number)
                    ? String(draft()[spec.key])
                    : "")
                }
                onInput={(e) =>
                  handleNumberInput(spec.key, e.currentTarget.value)
                }
              />
              <Show when={spec.unit}>
                <span class="text-xs text-base-content/55 font-mono shrink-0 w-6">
                  {spec.unit}
                </span>
              </Show>
            </div>
          </Show>
        </div>

        {/* Full-width inputs for text / font / path / string_array / server */}
        <Show when={spec.kind === "text"}>
          <input
            id={`cfg-${spec.key}`}
            type="text"
            class={`input input-sm input-bordered w-full ${
              spec.url || spec.cron ? "font-mono text-xs" : ""
            } ${error() ? "input-error" : ""}`}
            placeholder={spec.placeholder}
            disabled={disabled() || saving()}
            value={String(draft()[spec.key] ?? "")}
            onInput={(e) => setDraftValue(spec.key, e.currentTarget.value)}
          />
        </Show>

        <Show when={spec.kind === "font"}>
          <FontPickerField
            id={`cfg-${spec.key}`}
            value={String(draft()[spec.key] ?? "")}
            placeholder={spec.placeholder}
            disabled={disabled() || saving()}
            systemFonts={systemFonts()}
            systemFontsLoading={systemFontsLoading()}
            systemFontsError={systemFontsError()}
            onChange={(value) => setDraftValue(spec.key, value)}
            onReloadSystemFonts={() => {
              void loadSystemFonts();
            }}
          />
        </Show>

        <Show when={spec.kind === "path"}>
          <div class="flex items-center gap-2">
            <input
              id={`cfg-${spec.key}`}
              type="text"
              class="input input-sm input-bordered flex-1 font-mono text-xs"
              placeholder={spec.placeholder}
              disabled={disabled() || saving()}
              value={String(draft()[spec.key] ?? "")}
              onInput={(e) => setDraftValue(spec.key, e.currentTarget.value)}
            />
            <button
              type="button"
              class="btn btn-outline btn-sm shrink-0"
              disabled={disabled() || saving() || pickingPathKey() !== null}
              onClick={() => {
                void handlePickPath(spec);
              }}
            >
              <Show when={pickingPathKey() === spec.key}>
                <span class="loading loading-spinner loading-xs" />
              </Show>
              Browse
            </button>
          </div>
        </Show>

        <Show when={spec.kind === "string_array"}>
          <input
            id={`cfg-${spec.key}`}
            type="text"
            class="input input-sm input-bordered w-full font-mono text-xs"
            placeholder={spec.placeholder}
            disabled={disabled() || saving()}
            value={
              rawInputs()[spec.key] ?? formatStringArrayInput(draft()[spec.key])
            }
            onInput={(e) =>
              handleStringArrayInput(spec.key, e.currentTarget.value)
            }
          />
        </Show>

        <Show when={spec.kind === "server"}>
          <div class="space-y-2">
            <select
              id={`cfg-${spec.key}`}
              class="select select-sm select-bordered w-full"
              disabled={disabled() || saving()}
              value={
                customServerMode()
                  ? "__custom__"
                  : String(draft()[spec.key] ?? "")
              }
              onChange={(e) => {
                const selected = e.currentTarget.value;
                if (selected === "__custom__") {
                  setCustomServerMode(true);
                } else {
                  setCustomServerMode(false);
                  setDraftValue(spec.key, selected);
                }
              }}
            >
              <option value="">Auto Listen (Detect automatically)</option>
              <For each={serverList()}>
                {(srv) => <option value={srv.hostname}>{srv.label}</option>}
              </For>
              <option value="__custom__">Custom hostname / IP...</option>
            </select>

            <Show when={customServerMode()}>
              <input
                type="text"
                class="input input-sm input-bordered w-full font-mono text-xs"
                placeholder={spec.placeholder}
                disabled={disabled() || saving()}
                value={String(draft()[spec.key] ?? "")}
                onInput={(e) => setDraftValue(spec.key, e.currentTarget.value)}
              />
            </Show>
          </div>
        </Show>

        <Show when={error()}>
          {(err) => <p class="text-xs text-error font-medium">{err()}</p>}
        </Show>
      </div>
    );
  };

  const renderSection = (section: ConfigSectionSpec) => (
    <section class="space-y-2.5">
      <h2 class="text-xs font-semibold uppercase tracking-wider text-base-content/60">
        {section.title}
      </h2>
      <div class="bg-base-100 rounded-box border border-base-300 divide-y divide-base-300">
        <For each={section.fields}>{(field) => renderFieldRow(field)}</For>

        {/* Render compact Data Senders grid inside Data Storage & Sync */}
        <Show when={section.id === "data_sync"}>
          <div class="p-4 space-y-3">
            <div class="space-y-0.5">
              <div class="flex flex-wrap items-center gap-1.5">
                <h3 class="text-sm font-semibold">
                  Specialized Observation Senders
                </h3>
                <span class="badge badge-xs badge-outline border-warning/60 text-warning">
                  Restart required
                </span>
              </div>
              <p class="text-xs text-base-content/65">
                Choose whether each telemetry collector uploads observations to
                FUSOU-WEB or saves local JSON Lines (
                <code class="font-mono text-[11px]">.jsonl</code>) files.
                <Show when={!draft()["app.auth.allow_auth"]}>
                  {" "}
                  Remote uploads require{" "}
                  <span class="font-medium text-base-content/85">
                    Enable Authentication &amp; Cloud Sync
                  </span>
                  .
                </Show>
              </p>
            </div>

            <div class="grid grid-cols-1 gap-2">
              <For each={DATA_SENDER_SPECS}>
                {(sender) => {
                  const modified = () =>
                    isFieldModified(sender.enableKey) ||
                    isFieldModified(sender.localKey);
                  const authEnabled = () =>
                    Boolean(draft()["app.auth.allow_auth"]);
                  return (
                    <div
                      class="rounded-lg border border-base-300 bg-base-200/20 px-3 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      data-sender-id={sender.id}
                    >
                      <div class="min-w-0 space-y-0.5">
                        <div class="flex items-center gap-1.5">
                          <span class="text-sm font-medium leading-tight">
                            {sender.label}
                          </span>
                          <Show when={modified()}>
                            <span class="badge badge-xs badge-primary">
                              Modified
                            </span>
                          </Show>
                        </div>
                        <p class="text-xs text-base-content/60">
                          {sender.description}
                        </p>
                      </div>

                      <div class="flex items-center gap-4 shrink-0">
                        <label
                          class={`flex items-center gap-2 text-xs ${
                            authEnabled()
                              ? "cursor-pointer"
                              : "cursor-not-allowed opacity-50"
                          }`}
                        >
                          <span class="text-base-content/75">Upload</span>
                          <input
                            type="checkbox"
                            class="toggle toggle-xs toggle-primary"
                            checked={Boolean(draft()[sender.enableKey])}
                            disabled={saving() || !authEnabled()}
                            onChange={(e) =>
                              setDraftValue(
                                sender.enableKey,
                                e.currentTarget.checked,
                              )
                            }
                          />
                        </label>
                        <label class="flex items-center gap-2 cursor-pointer text-xs">
                          <span class="text-base-content/75">Local JSONL</span>
                          <input
                            type="checkbox"
                            class="toggle toggle-xs toggle-primary"
                            checked={Boolean(draft()[sender.localKey])}
                            disabled={saving()}
                            onChange={(e) =>
                              setDraftValue(
                                sender.localKey,
                                e.currentTarget.checked,
                              )
                            }
                          />
                        </label>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </div>
        </Show>
      </div>
    </section>
  );

  const countSectionModifications = (section: ConfigSectionSpec): number =>
    section.fields.filter((f) => isFieldModified(f.key)).length;

  return (
    <div class="space-y-6" data-testid="config-editor">
      {/* Configuration File Bar */}
      <div class="bg-base-100 rounded-box border border-base-300 px-4 py-3 space-y-3">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div class="min-w-0 space-y-0.5">
            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold uppercase tracking-wider text-base-content/60">
                Configuration File
              </span>
              <Show when={loading()}>
                <span class="loading loading-spinner loading-xs" />
              </Show>
            </div>
            <div
              class="text-xs font-mono text-base-content/75 truncate"
              title={configPath() || "configs.toml"}
            >
              {configPath() || "configs.toml (preview defaults)"}
            </div>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <button
              type="button"
              class="btn btn-outline btn-xs"
              disabled={loading() || saving()}
              onClick={() => {
                void handleOpenConfigFile();
              }}
            >
              Open configs.toml
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              disabled={loading() || saving()}
              onClick={handleResetToDefaults}
            >
              Reset to Defaults
            </button>
          </div>
        </div>

        <Show when={loadError()}>
          {(err) => (
            <AlertMessage type="error" title="Failed to Load Configuration">
              {err()}
            </AlertMessage>
          )}
        </Show>

        <Show when={saveError()}>
          {(err) => (
            <AlertMessage type="error" title="Could Not Save Configuration">
              {err()}
            </AlertMessage>
          )}
        </Show>

        <ActionSummaryGrid summary={saveSummary()} />
      </div>

      {/* Persistent Pending Restart Notice (shown when user chose Restart Later) */}
      <Show when={pendingRestartKeys().length > 0 && !restartModalOpen()}>
        <div
          class="fusou-restart-pending-card rounded-box border p-4 space-y-3"
          data-testid="pending-restart-banner"
        >
          <AlertMessage type="warning" title="Restart Pending">
            Saved changes for{" "}
            {pendingRestartKeys().map(getConfigKeyLabel).join(", ")} will take
            effect after restarting FUSOU.
          </AlertMessage>
          <Show when={restartError()}>
            {(err) => (
              <AlertMessage type="error" title="Restart Failed">
                {err()}
              </AlertMessage>
            )}
          </Show>
          <div class="flex items-center justify-end gap-2">
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              disabled={restarting()}
              onClick={() => setPendingRestartKeys([])}
            >
              Dismiss
            </button>
            <button
              type="button"
              class="btn btn-primary enabled:border-primary-content btn-sm"
              disabled={restarting()}
              onClick={() => {
                void handleRestartNow();
              }}
            >
              <Show when={restarting()}>
                <span class="loading loading-spinner loading-xs" />
              </Show>
              {restarting() ? "Restarting..." : "Restart Now"}
            </button>
          </div>
        </div>
      </Show>

      {/* Primary Configuration Sections */}
      <For each={PRIMARY_CONFIG_SECTIONS}>
        {(section) => renderSection(section)}
      </For>

      {/* UI Visibility & Collapse Configuration (Collapsible Groups) */}
      <section class="space-y-2.5">
        <h2 class="text-xs font-semibold uppercase tracking-wider text-base-content/60">
          UI Display &amp; Layout
        </h2>
        <div class="bg-base-100 rounded-box border border-base-300 divide-y divide-base-300">
          <For each={UI_CONFIG_SECTIONS}>
            {(section) => {
              const visibleFields = createMemo(() =>
                section.fields.filter(
                  (field) => !field.linuxOnly || platform() === "linux",
                ),
              );
              const modCount = createMemo(() =>
                countSectionModifications(section),
              );

              return (
                <details
                  class="group"
                  data-config-ui-section={section.id}
                >
                  <summary class="px-4 py-3 flex items-center justify-between gap-2 cursor-pointer select-none text-sm font-medium text-base-content/85 hover:text-base-content hover:bg-base-200/30 transition-colors list-none">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <span>{section.title}</span>
                        <span class="badge badge-xs badge-ghost font-mono">
                          {visibleFields().length}
                        </span>
                        <Show when={modCount() > 0}>
                          <span class="badge badge-xs badge-primary">
                            {modCount()} modified
                          </span>
                        </Show>
                      </div>
                      <Show when={section.description}>
                        <div class="text-xs font-normal text-base-content/55 mt-0.5">
                          {section.description}
                        </div>
                      </Show>
                    </div>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      class="w-4 h-4 shrink-0 text-base-content/55 transition-transform duration-150 group-open:rotate-180"
                      aria-hidden="true"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                        clip-rule="evenodd"
                      />
                    </svg>
                  </summary>

                  <div class="border-t border-base-300 divide-y divide-base-300 bg-base-200/15">
                    <For each={visibleFields()}>
                      {(field) => renderFieldRow(field)}
                    </For>
                  </div>
                </details>
              );
            }}
          </For>
        </div>
      </section>

      {/* Advanced Configuration (Collapsible Groups) */}
      <section class="space-y-2.5">
        <h2 class="text-xs font-semibold uppercase tracking-wider text-base-content/60">
          Advanced Configuration
        </h2>
        <div class="bg-base-100 rounded-box border border-base-300 divide-y divide-base-300">
          <For each={ADVANCED_CONFIG_SECTIONS}>
            {(section) => {
              const visibleFields = createMemo(() =>
                section.fields.filter(
                  (field) => !field.linuxOnly || platform() === "linux",
                ),
              );
              const modCount = createMemo(() =>
                countSectionModifications(section),
              );

              return (
                <details
                  class="group"
                  data-config-advanced-section={section.id}
                >
                  <summary class="px-4 py-3 flex items-center justify-between gap-2 cursor-pointer select-none text-sm font-medium text-base-content/85 hover:text-base-content hover:bg-base-200/30 transition-colors list-none">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <span>{section.title}</span>
                        <span class="badge badge-xs badge-ghost font-mono">
                          {visibleFields().length}
                        </span>
                        <Show when={modCount() > 0}>
                          <span class="badge badge-xs badge-primary">
                            {modCount()} modified
                          </span>
                        </Show>
                      </div>
                      <Show when={section.description}>
                        <div class="text-xs font-normal text-base-content/55 mt-0.5">
                          {section.description}
                        </div>
                      </Show>
                    </div>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      class="w-4 h-4 shrink-0 text-base-content/55 transition-transform duration-150 group-open:rotate-180"
                      aria-hidden="true"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                        clip-rule="evenodd"
                      />
                    </svg>
                  </summary>

                  <div class="border-t border-base-300 divide-y divide-base-300 bg-base-200/15">
                    <For each={visibleFields()}>
                      {(field) => renderFieldRow(field)}
                    </For>
                  </div>
                </details>
              );
            }}
          </For>
        </div>
      </section>

      {/* Sticky Save Bar when there are unsaved changes */}
      <Show when={hasUnsavedChanges()}>
        <div
          class={`sticky bottom-3 z-20 fusou-config-save-bar rounded-box border px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
            changedRestartKeys().length > 0
              ? "fusou-config-save-bar-warning"
              : ""
          }`.trim()}
          data-testid="config-save-bar"
        >
          <div class="space-y-0.5 min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm font-semibold">
                {changedKeys().length} unsaved{" "}
                {changedKeys().length === 1 ? "change" : "changes"}
              </span>
              <Show
                when={changedRestartKeys().length > 0}
                fallback={
                  <span class="badge badge-xs badge-outline border-success/60 text-success">
                    Applies immediately
                  </span>
                }
              >
                <span class="badge badge-xs badge-outline border-warning/60 text-warning">
                  Restart required ({changedRestartKeys().length})
                </span>
              </Show>
            </div>
            <p class="text-xs text-base-content/65">
              {hasValidationErrors()
                ? "Fix highlighted validation errors before saving."
                : "Changes are written to configs.toml when you save."}
            </p>
          </div>

          <div class="flex items-center justify-end gap-2 shrink-0">
            <button
              type="button"
              class="btn btn-outline btn-sm"
              disabled={saving()}
              onClick={handleDiscard}
            >
              Discard
            </button>
            <button
              type="button"
              class="btn btn-primary enabled:border-primary-content btn-sm"
              disabled={saving() || hasValidationErrors()}
              onClick={() => {
                void handleSave();
              }}
            >
              <Show when={saving()}>
                <span class="loading loading-spinner loading-xs" />
              </Show>
              {saving() ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </Show>

      <RestartRequiredModal
        open={restartModalOpen()}
        changedLabels={restartModalKeys().map(getConfigKeyLabel)}
        restarting={restarting()}
        error={restartError()}
        onRestartNow={() => {
          void handleRestartNow();
        }}
        onRestartLater={handleRestartLater}
      />
    </div>
  );
}
