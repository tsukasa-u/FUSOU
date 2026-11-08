import { getCurrentWindow } from "@tauri-apps/api/window";
import { Show } from "solid-js";

type Props = {
  isMaximized: boolean;
};

export function WindowResizeBorders(props: Props) {
  const appWindow = getCurrentWindow();

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
    // Left click only
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    appWindow.startResizeDragging(direction).catch((err) => {
      console.warn("Resize dragging error:", err);
    });
  };

  return (
    <Show when={!props.isMaximized}>
      {/* Edges */}
      <div
        class="fixed top-0 left-2 right-2 h-1 cursor-ns-resize z-10000"
        onMouseDown={(e) => handleResize("North", e)}
      />
      <div
        class="fixed bottom-0 left-2 right-2 h-1 cursor-ns-resize z-10000"
        onMouseDown={(e) => handleResize("South", e)}
      />
      <div
        class="fixed left-0 top-2 bottom-2 w-1 cursor-ew-resize z-10000"
        onMouseDown={(e) => handleResize("West", e)}
      />
      <div
        class="fixed right-0 top-2 bottom-2 w-1 cursor-ew-resize z-10000"
        onMouseDown={(e) => handleResize("East", e)}
      />

      {/* Corners */}
      <div
        class="fixed top-0 left-0 w-2 h-2 cursor-nwse-resize z-10001"
        onMouseDown={(e) => handleResize("NorthWest", e)}
      />
      <div
        class="fixed top-0 right-0 w-2 h-2 cursor-nesw-resize z-10001"
        onMouseDown={(e) => handleResize("NorthEast", e)}
      />
      <div
        class="fixed bottom-0 left-0 w-2 h-2 cursor-nesw-resize z-10001"
        onMouseDown={(e) => handleResize("SouthWest", e)}
      />
      <div
        class="fixed bottom-0 right-0 w-2 h-2 cursor-nwse-resize z-10001"
        onMouseDown={(e) => handleResize("SouthEast", e)}
      />
    </Show>
  );
}
