import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { isTauri } from "../../utility/tauri";
import { ThemeControllerComponent } from "../settings/theme";

type Props = {
  isMaximized: boolean;
  onMaximizeChange?: (maximized: boolean) => void;
};

export function CustomTitlebar(props: Props) {
  const appWindow = isTauri() ? getCurrentWindow() : null;

  // Volume state
  const [volume, setVolume] = createSignal<number>(100);
  const [isMuted, setIsMuted] = createSignal<boolean>(false);
  const [isVolumeMenuOpen, setIsVolumeMenuOpen] = createSignal<boolean>(false);

  // Status feedback
  const [isCapturing, setIsCapturing] = createSignal<boolean>(false);
  const [isReloading, setIsReloading] = createSignal<boolean>(false);

  let volumeDropdownRef: HTMLDivElement | undefined;
  let volumeDebounceTimer: number | null = null;

  // Sync volume with external webview & persist
  const updateVolume = (newVol: number, newMuted: boolean) => {
    setVolume(newVol);
    setIsMuted(newMuted);
    localStorage.setItem("fusou-external-volume", newVol.toString());
    localStorage.setItem("fusou-external-muted", newMuted ? "true" : "false");

    if (volumeDebounceTimer !== null) {
      clearTimeout(volumeDebounceTimer);
    }
    volumeDebounceTimer = window.setTimeout(() => {
      invoke("set_external_volume", {
        volume: newVol / 100,
        muted: newMuted,
      }).catch((err) => {
        console.warn("Failed to set external volume:", err);
      });
    }, 30);
  };

  const handleVolumeChange = (e: Event) => {
    const val = Number((e.target as HTMLInputElement).value);
    const newMuted = val === 0 ? true : false;
    updateVolume(val, newMuted);
  };

  const toggleMute = () => {
    updateVolume(volume(), !isMuted());
  };

  // Actions
  const handleScreenshot = async () => {
    if (isCapturing()) return;
    setIsCapturing(true);
    if (isTauri()) {
      try {
        await invoke("trigger_external_screenshot");
      } catch (err) {
        console.warn("Screenshot error:", err);
      } finally {
        setTimeout(() => setIsCapturing(false), 500);
      }
    } else {
      setTimeout(() => setIsCapturing(false), 500);
    }
  };

  const handleReload = async (e: MouseEvent) => {
    if (isReloading()) return;
    setIsReloading(true);

    if (e.shiftKey) {
      // Shift + Click: Reload application UI
      window.location.reload();
      return;
    }

    if (isTauri()) {
      try {
        await invoke("trigger_external_reload");
      } catch (err) {
        console.warn("Reload error:", err);
      } finally {
        setTimeout(() => setIsReloading(false), 500);
      }
    } else {
      setTimeout(() => setIsReloading(false), 500);
    }
  };

  // Close dropdown on outside click
  const handleDocumentClick = (e: MouseEvent) => {
    if (
      isVolumeMenuOpen() &&
      volumeDropdownRef &&
      !volumeDropdownRef.contains(e.target as Node)
    ) {
      setIsVolumeMenuOpen(false);
    }
  };

  // Window control actions
  const handleMinimize = () => {
    if (appWindow) {
      appWindow.minimize().catch(() => {});
    }
  };

  const handleToggleMaximize = () => {
    if (props.onMaximizeChange) {
      props.onMaximizeChange(!props.isMaximized);
    }
    if (appWindow) {
      appWindow.toggleMaximize().catch(() => {});
    }
  };

  const handleClose = () => {
    if (appWindow) {
      appWindow.close().catch(() => {});
    }
  };

  onMount(() => {
    // Restore saved volume
    const savedVol = localStorage.getItem("fusou-external-volume");
    const savedMuted = localStorage.getItem("fusou-external-muted");
    const initVol = savedVol !== null ? Number(savedVol) : 100;
    const initMuted = savedMuted === "true";
    setVolume(initVol);
    setIsMuted(initMuted);
    if (isTauri()) {
      invoke("set_external_volume", {
        volume: initVol / 100,
        muted: initMuted,
      }).catch(() => {});
    }

    // Listen for volume changes originating from the external window
    let unlisten: UnlistenFn | undefined;
    if (isTauri()) {
      listen<{ volume: number; muted: boolean }>(
        "fusou-volume-changed",
        (event) => {
          const newVol = Math.round(event.payload.volume * 100);
          const newMuted = event.payload.muted;
          setVolume(newVol);
          setIsMuted(newMuted);
          localStorage.setItem("fusou-external-volume", newVol.toString());
          localStorage.setItem(
            "fusou-external-muted",
            newMuted ? "true" : "false",
          );
        },
      )
        .then((fn) => {
          unlisten = fn;
        })
        .catch(() => {});
    }

    document.addEventListener("mousedown", handleDocumentClick);
    onCleanup(() => {
      if (unlisten) unlisten();
      document.removeEventListener("mousedown", handleDocumentClick);
    });
  });

  return (
    <header
      data-tauri-drag-region
      class={`h-8 bg-[#27272a] text-[#f1f5f9] select-none flex items-center justify-between px-2.5 z-9999 text-xs ${
        props.isMaximized ? "rounded-none" : "rounded-t-[10px]"
      }`}
      onDblClick={handleToggleMaximize}
    >
      {/* Left: App Title and Icon */}
      <div
        data-tauri-drag-region
        class="flex items-center gap-2 cursor-default"
      >
        <svg
          class="w-4 h-4 pointer-events-none"
          viewBox="0 0 1000 1000"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect
            x="150"
            y="73"
            width="750"
            height="225"
            rx="75"
            fill="#B5D95A"
          />
          <rect
            x="150"
            y="388"
            width="450"
            height="225"
            rx="75"
            fill="#96C54E"
          />
          <rect
            x="150"
            y="703"
            width="225"
            height="225"
            rx="75"
            fill="#76B142"
          />
        </svg>
        <span
          data-tauri-drag-region
          class="font-bold tracking-wider text-[11px] opacity-90"
        >
          FUSOU
        </span>
      </div>

      {/* Center / Utility Buttons */}
      <div
        class="flex items-center gap-1"
        onDblClick={(e) => e.stopPropagation()}
      >
        {/* Screenshot Button */}
        <button
          type="button"
          onClick={handleScreenshot}
          class={`fusou-tool-btn ${
            isCapturing() ? "fusou-active scale-95" : ""
          }`}
          title="Capture Screenshot (External Window)"
        >
          <svg
            class="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
            />
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>

        {/* Reload Button */}
        <button
          type="button"
          onClick={handleReload}
          class={`fusou-tool-btn ${
            isReloading() ? "fusou-active rotate-180" : ""
          }`}
          title="Reload External Window (Shift+Click: Reload App)"
        >
          <svg
            class="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>

        {/* Volume Control Popover */}
        <div class="relative" ref={volumeDropdownRef}>
          <button
            type="button"
            onClick={() => setIsVolumeMenuOpen(!isVolumeMenuOpen())}
            class={`fusou-tool-btn ${isVolumeMenuOpen() ? "fusou-active" : ""}`}
            title="Volume Control"
          >
            <Show
              when={!isMuted() && volume() > 0}
              fallback={
                <svg
                  class="w-3.5 h-3.5 text-error"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                  />
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
                  />
                </svg>
              }
            >
              <Show
                when={volume() > 50}
                fallback={
                  <svg
                    class="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M15.536 8.464a5 5 0 010 7.072m-4.243-8.486L7.586 11H6a1 1 0 00-1 1v0a1 1 0 001 1h1.586l3.707 3.95c.63.67 1.707.225 1.707-.707V7.757c0-.932-1.077-1.378-1.707-.707z"
                    />
                  </svg>
                }
              >
                <svg
                  class="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                  />
                </svg>
              </Show>
            </Show>
            <span class="text-[10px] w-6 text-right tabular-nums">
              {isMuted() ? "0%" : `${volume()}%`}
            </span>
          </button>

          {/* Popover panel */}
          <Show when={isVolumeMenuOpen()}>
            <div
              style={{
                position: "absolute",
                top: "32px",
                left: "50%",
                transform: "translateX(-50%)",
                width: "176px",
                "background-color": "#1d1c1c",
                color: "#f1f5f9",
                border: "1px solid #27272a",
                "border-radius": "8px",
                padding: "10px",
                "box-shadow":
                  "0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)",
                display: "flex",
                "flex-direction": "column",
                gap: "8px",
                "z-index": "10002",
              }}
            >
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "space-between",
                  "font-size": "12px",
                  "font-weight": "600",
                }}
              >
                <span>Sound Volume</span>
                <span
                  style={{
                    "font-size": "10px",
                    opacity: "0.7",
                    "font-variant-numeric": "tabular-nums",
                  }}
                >
                  {isMuted() ? "Muted" : `${volume()}%`}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={volume()}
                onInput={handleVolumeChange}
                class="fusou-custom-range"
              />
              <button
                type="button"
                onClick={toggleMute}
                class={`fusou-custom-mute-btn ${isMuted() ? "is-muted" : ""}`}
              >
                {isMuted() ? "Unmute" : "Mute Audio"}
              </button>
            </div>
          </Show>
        </div>

        <ThemeControllerComponent />
      </div>

      {/* Right: Window Controls */}
      <div class="flex items-center -mr-2.5 h-full">
        <button
          type="button"
          onClick={handleMinimize}
          class="fusou-win-btn"
          title="Minimize"
        >
          <svg class="w-3 h-3" viewBox="0 0 12 12">
            <rect fill="currentColor" width="10" height="1" x="1" y="6" />
          </svg>
        </button>

        <button
          type="button"
          onClick={handleToggleMaximize}
          class="fusou-win-btn"
          title={props.isMaximized ? "Restore" : "Maximize"}
        >
          <Show
            when={props.isMaximized}
            fallback={
              <svg class="w-3 h-3" viewBox="0 0 12 12">
                <rect
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1"
                  width="9"
                  height="9"
                  x="1.5"
                  y="1.5"
                />
              </svg>
            }
          >
            <svg class="w-3 h-3" viewBox="0 0 12 12">
              <rect
                fill="none"
                stroke="currentColor"
                stroke-width="1"
                width="7"
                height="7"
                x="3.5"
                y="1.5"
              />
              <polyline
                fill="none"
                stroke="currentColor"
                stroke-width="1"
                points="1.5,4 1.5,10.5 8,10.5"
              />
            </svg>
          </Show>
        </button>

        <button
          type="button"
          onClick={handleClose}
          class="fusou-win-btn fusou-win-close"
          title="Close"
        >
          <svg class="w-3 h-3" viewBox="0 0 12 12">
            <line
              x1="2"
              y1="2"
              x2="10"
              y2="10"
              stroke="currentColor"
              stroke-width="1.2"
            />
            <line
              x1="10"
              y1="2"
              x2="2"
              y2="10"
              stroke="currentColor"
              stroke-width="1.2"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}
