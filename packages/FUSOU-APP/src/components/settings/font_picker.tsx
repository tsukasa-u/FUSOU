import { invoke } from "@tauri-apps/api/core";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import {
  formatCssFontFamily,
  loadGoogleFontForPreview,
} from "../../utility/google_font";
import { isTauri } from "../../utility/tauri";
import {
  FONT_PRESET_OPTIONS,
  GOOGLE_FONTS_BROWSE_URL,
} from "./config_schema";

export interface FontPickerFieldProps {
  id: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  systemFonts: readonly string[];
  systemFontsLoading: boolean;
  systemFontsError: string | null;
  onChange: (value: string) => void;
  onReloadSystemFonts: () => void;
}

type FontPickerTab = "google" | "system";
type PreviewStatus = "default" | "system" | "loading" | "google" | "custom";

export function FontPickerField(props: FontPickerFieldProps) {
  const [activeTab, setActiveTab] = createSignal<FontPickerTab>("google");
  const [systemQuery, setSystemQuery] = createSignal("");
  const [previewStatus, setPreviewStatus] =
    createSignal<PreviewStatus>("default");

  const systemFontSet = createMemo(
    () => new Set(props.systemFonts.map((font) => font.trim().toLowerCase())),
  );

  const isSelectedSystemFont = createMemo(() => {
    const trimmed = props.value.trim().toLowerCase();
    return trimmed.length > 0 && systemFontSet().has(trimmed);
  });

  const filteredSystemFonts = createMemo(() => {
    const q = systemQuery().trim().toLowerCase();
    if (!q) return props.systemFonts;
    return props.systemFonts.filter((font) => font.toLowerCase().includes(q));
  });

  // Load Google Font preview lazily when the draft value changes and isn't an installed system font
  createEffect(() => {
    const trimmed = props.value.trim();
    const isSystem = isSelectedSystemFont();

    if (!trimmed) {
      setPreviewStatus("default");
      return;
    }

    if (isSystem) {
      setPreviewStatus("system");
      return;
    }

    let cancelled = false;
    setPreviewStatus("loading");
    const timer = window.setTimeout(() => {
      void loadGoogleFontForPreview(trimmed).then((loaded) => {
        if (cancelled) return;
        setPreviewStatus(loaded ? "google" : "custom");
      });
    }, 350);

    onCleanup(() => {
      cancelled = true;
      window.clearTimeout(timer);
    });
  });

  const handleOpenGoogleFonts = async () => {
    if (isTauri()) {
      try {
        await invoke("open_external_url", { url: GOOGLE_FONTS_BROWSE_URL });
        return;
      } catch (err) {
        console.warn("Failed to open Google Fonts via opener:", err);
      }
    }
    window.open(GOOGLE_FONTS_BROWSE_URL, "_blank", "noopener,noreferrer");
  };

  const previewCssFamily = createMemo(() => formatCssFontFamily(props.value));

  return (
    <div class="space-y-3">
      {/* Direct input + reset */}
      <div class="flex items-center gap-2">
        <input
          id={props.id}
          type="text"
          class="input input-sm input-bordered flex-1"
          placeholder={props.placeholder ?? "Noto Sans JP / Yu Gothic UI"}
          disabled={props.disabled}
          value={props.value}
          onInput={(e) => props.onChange(e.currentTarget.value)}
        />
        <Show when={props.value.trim().length > 0}>
          <button
            type="button"
            class="btn btn-outline btn-sm shrink-0"
            disabled={props.disabled}
            onClick={() => props.onChange("")}
            title="Reset to the OS default UI font"
          >
            System Default
          </button>
        </Show>
      </div>

      {/* Live Preview */}
      <div class="rounded-lg border border-base-300 bg-base-200/35 px-3 py-2 space-y-1">
        <div class="flex flex-wrap items-center justify-between gap-2 text-[11px] text-base-content/60">
          <span>Preview</span>
          <Show when={previewStatus() === "default"}>
            <span class="badge badge-xs badge-ghost">System Default</span>
          </Show>
          <Show when={previewStatus() === "system"}>
            <span class="badge badge-xs badge-info badge-outline">
              Installed System Font
            </span>
          </Show>
          <Show when={previewStatus() === "google"}>
            <span class="badge badge-xs badge-success badge-outline">
              Google Fonts
            </span>
          </Show>
          <Show when={previewStatus() === "loading"}>
            <span class="badge badge-xs badge-ghost gap-1">
              <span class="loading loading-spinner loading-xs" />
              Checking Google Fonts...
            </span>
          </Show>
          <Show when={previewStatus() === "custom"}>
            <span class="badge badge-xs badge-warning badge-outline">
              Custom (Not found on Google Fonts — uses local if installed)
            </span>
          </Show>
        </div>
        <div
          class="space-y-0.5 text-base-content leading-relaxed"
          style={{
            "font-family": previewCssFamily() || undefined,
          }}
        >
          <div class="text-sm font-normal truncate">
            艦これ 鎮守府 FUSOU — 1234567890 ABCdef 漢字・ひらがな・カタカナ
          </div>
          <div class="text-xs font-bold truncate opacity-85">
            Bold / Semibold: 第一艦隊 出撃準備完了 1234567890
          </div>
        </div>
      </div>

      {/* Source selector tabs */}
      <div class="rounded-lg border border-base-300 bg-base-200/20 overflow-hidden">
        <div class="flex items-center justify-between border-b border-base-300 px-2 py-1.5 gap-2">
          <div class="flex items-center gap-1" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab() === "google"}
              class={`btn btn-xs ${
                activeTab() === "google" ? "btn-primary" : "btn-ghost"
              }`}
              disabled={props.disabled}
              onClick={() => setActiveTab("google")}
            >
              Google Fonts
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab() === "system"}
              class={`btn btn-xs gap-1.5 ${
                activeTab() === "system" ? "btn-primary" : "btn-ghost"
              }`}
              disabled={props.disabled}
              onClick={() => setActiveTab("system")}
            >
              <span>System Fonts</span>
              <Show when={props.systemFonts.length > 0}>
                <span class="badge badge-xs badge-ghost font-mono">
                  {props.systemFonts.length}
                </span>
              </Show>
            </button>
          </div>

          <Show when={activeTab() === "system"}>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              disabled={props.disabled || props.systemFontsLoading}
              onClick={() => props.onReloadSystemFonts()}
              title="Rescan installed OS fonts"
            >
              <Show when={props.systemFontsLoading}>
                <span class="loading loading-spinner loading-xs" />
              </Show>
              Refresh
            </button>
          </Show>
        </div>

        {/* Google Fonts tab */}
        <Show when={activeTab() === "google"}>
          <div class="p-3 space-y-2.5">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-md border border-base-300/80 bg-base-100 px-3 py-2">
              <div class="space-y-0.5 text-xs text-base-content/75">
                <p class="font-medium text-base-content">
                  Google Fonts から探す
                </p>
                <p class="text-[11px] text-base-content/65">
                  好みのフォント名をコピーして上の欄に貼り付けるか、下の定番プリセットから選択できます。
                </p>
                <div class="text-[11px] font-mono text-base-content/55 break-all">
                  {GOOGLE_FONTS_BROWSE_URL}
                </div>
              </div>
              <button
                type="button"
                class="btn btn-outline btn-xs shrink-0 gap-1"
                disabled={props.disabled}
                onClick={() => {
                  void handleOpenGoogleFonts();
                }}
              >
                <span>Google Fonts を開く</span>
                <svg
                  class="w-3 h-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2"
                  aria-hidden="true"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M14 3h7m0 0v7m0-7L10 14M5 5H4a1 1 0 00-1 1v14a1 1 0 001 1h14a1 1 0 001-1v-1"
                  />
                </svg>
              </button>
            </div>

            <div class="space-y-1.5">
              <div class="text-[11px] text-base-content/60">
                Recommended Google Fonts
              </div>
              <div class="flex flex-wrap gap-1.5">
                <For each={FONT_PRESET_OPTIONS}>
                  {(preset) => {
                    const isActive = () =>
                      props.value.trim().toLowerCase() ===
                      preset.toLowerCase();
                    return (
                      <button
                        type="button"
                        class={`btn btn-xs ${
                          isActive() ? "btn-primary" : "btn-outline"
                        }`}
                        disabled={props.disabled}
                        onClick={() => props.onChange(preset)}
                      >
                        {preset}
                      </button>
                    );
                  }}
                </For>
              </div>
            </div>
          </div>
        </Show>

        {/* System Installed Fonts tab */}
        <Show when={activeTab() === "system"}>
          <div class="p-3 space-y-2">
            <input
              type="text"
              class="input input-xs input-bordered w-full"
              placeholder="インストール済みフォントを検索... (例: Yu Gothic, Meiryo, BIZ, Hack)"
              disabled={props.disabled}
              value={systemQuery()}
              onInput={(e) => setSystemQuery(e.currentTarget.value)}
            />

            <Show when={props.systemFontsError}>
              {(err) => (
                <p class="text-xs text-error">
                  フォント一覧の取得に失敗しました: {err()}
                </p>
              )}
            </Show>

            <Show
              when={!props.systemFontsLoading}
              fallback={
                <div class="py-4 flex items-center justify-center gap-2 text-xs text-base-content/60">
                  <span class="loading loading-spinner loading-xs" />
                  <span>インストール済みフォントを読み込み中...</span>
                </div>
              }
            >
              <Show
                when={filteredSystemFonts().length > 0}
                fallback={
                  <p class="py-3 text-center text-xs text-base-content/60">
                    {props.systemFonts.length === 0
                      ? "インストール済みフォントが見つかりませんでした（デスクトップアプリ実行時に OS から一覧を取得します）。"
                      : "一致するフォントがありません。"}
                  </p>
                }
              >
                <div class="max-h-48 overflow-y-auto rounded-md border border-base-300 bg-base-100 divide-y divide-base-200">
                  <For each={filteredSystemFonts()}>
                    {(fontName) => {
                      const isActive = () =>
                        props.value.trim().toLowerCase() ===
                        fontName.toLowerCase();
                      return (
                        <button
                          type="button"
                          class={`w-full px-3 py-1.5 text-left flex items-center justify-between gap-2 text-xs transition-colors cursor-pointer ${
                            isActive()
                              ? "bg-primary/15 text-primary font-semibold"
                              : "hover:bg-base-200/60 text-base-content"
                          }`}
                          disabled={props.disabled}
                          onClick={() => props.onChange(fontName)}
                        >
                          <span
                            class="truncate text-sm"
                            style={{
                              "font-family": formatCssFontFamily(fontName),
                            }}
                          >
                            {fontName}
                          </span>
                          <span
                            class="text-[11px] text-base-content/55 shrink-0"
                            style={{
                              "font-family": formatCssFontFamily(fontName),
                            }}
                          >
                            鎮守府 Aa12
                          </span>
                        </button>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
