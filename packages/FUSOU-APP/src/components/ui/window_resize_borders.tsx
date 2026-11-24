import { getCurrentWindow } from "@tauri-apps/api/window";
import { Show } from "solid-js";
import { isTauri } from "../../utility/tauri";
import type { DockEdgeFlags } from "../../utility/window_layout";

type Props = {
  isMaximized: boolean;
  edges?: Partial<DockEdgeFlags>;
};

export function WindowResizeBorders(props: Props) {
  const appWindow = isTauri() ? getCurrentWindow() : null;

  const allowTop = () => props.edges?.top ?? true;
  const allowBottom = () => props.edges?.bottom ?? true;
  const allowLeft = () => props.edges?.left ?? true;
  const allowRight = () => props.edges?.right ?? true;

  const handleResize = (
    direction:
      | "North"
      | "South"
      | "East"
      | "West"
      | "NorthEast"
      | "NorthWest"
      | "SouthEast"
      | "SouthWest",
    event: MouseEvent,
  ) => {
    if (event.button !== 0 || !appWindow) return;
    event.preventDefault();
    event.stopPropagation();
    appWindow.startResizeDragging(direction).catch((err) => {
      console.warn("Resize dragging error:", err);
    });
  };

  return (
    <Show when={!props.isMaximized}>
      {/* Edges */}
      <Show when={allowTop()}>
        <div
          class="fixed top-0 left-2 right-2 h-1 cursor-ns-resize z-10000"
          onMouseDown={(e) => handleResize("North", e)}
        />
      </Show>
      <Show when={allowBottom()}>
        <div
          class="fixed bottom-0 left-2 right-2 h-1 cursor-ns-resize z-10000"
          onMouseDown={(e) => handleResize("South", e)}
        />
      </Show>
      <Show when={allowLeft()}>
        <div
          class="fixed left-0 top-2 bottom-2 w-1 cursor-ew-resize z-10000"
          onMouseDown={(e) => handleResize("West", e)}
        />
      </Show>
      <Show when={allowRight()}>
        <div
          class="fixed right-0 top-2 bottom-2 w-1 cursor-ew-resize z-10000"
          onMouseDown={(e) => handleResize("East", e)}
        />
      </Show>

      {/* Corners */}
      <Show when={allowTop() && allowLeft()}>
        <div
          class="fixed top-0 left-0 w-2 h-2 cursor-nwse-resize z-10001"
          onMouseDown={(e) => handleResize("NorthWest", e)}
        />
      </Show>
      <Show when={allowTop() && allowRight()}>
        <div
          class="fixed top-0 right-0 w-2 h-2 cursor-nesw-resize z-10001"
          onMouseDown={(e) => handleResize("NorthEast", e)}
        />
      </Show>
      <Show when={allowBottom() && allowLeft()}>
        <div
          class="fixed bottom-0 left-0 w-2 h-2 cursor-nesw-resize z-10001"
          onMouseDown={(e) => handleResize("SouthWest", e)}
        />
      </Show>
      <Show when={allowBottom() && allowRight()}>
        <div
          class="fixed bottom-0 right-0 w-2 h-2 cursor-nwse-resize z-10001"
          onMouseDown={(e) => handleResize("SouthEast", e)}
        />
      </Show>
    </Show>
  );
}
