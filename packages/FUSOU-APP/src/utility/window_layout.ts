import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { createStore } from "solid-js/store";
import { isTauri } from "./tauri";

export type WindowMode = "separate" | "combined";
export type DockPosition = "auto" | "right" | "bottom" | "left" | "top";
export type EffectiveDockPosition = "right" | "bottom" | "left" | "top";

export interface DockEdgeFlags {
  top: boolean;
  bottom: boolean;
  left: boolean;
  right: boolean;
}

export interface PlatformCapabilities {
  supports_separate_mode: boolean;
  supports_custom_titlebar: boolean;
  is_mobile: boolean;
}

export interface WindowLayoutState {
  configured_mode: WindowMode;
  effective_mode: WindowMode;
  dock_position: DockPosition;
  effective_dock_position: EffectiveDockPosition;
  panel_ratio_percent: number;
  game_visible: boolean;
  is_dragging_splitter: boolean;
  panel_edges: DockEdgeFlags;
  game_edges: DockEdgeFlags;
  platform_capabilities: PlatformCapabilities;
}

export const DOCK_POSITION_ORDER: readonly DockPosition[] = [
  "right",
  "bottom",
  "left",
  "top",
  "auto",
];

export const DEFAULT_WINDOW_LAYOUT_STATE: WindowLayoutState = {
  configured_mode: "separate",
  effective_mode: "separate",
  dock_position: "right",
  effective_dock_position: "right",
  panel_ratio_percent: 30,
  game_visible: false,
  is_dragging_splitter: false,
  panel_edges: { top: true, bottom: true, left: true, right: true },
  game_edges: { top: true, bottom: true, left: true, right: true },
  platform_capabilities: {
    supports_separate_mode: true,
    supports_custom_titlebar: true,
    is_mobile: false,
  },
};

const [windowLayoutState, setWindowLayoutState] =
  createStore<WindowLayoutState>({
    ...DEFAULT_WINDOW_LAYOUT_STATE,
    panel_edges: { ...DEFAULT_WINDOW_LAYOUT_STATE.panel_edges },
    game_edges: { ...DEFAULT_WINDOW_LAYOUT_STATE.game_edges },
    platform_capabilities: {
      ...DEFAULT_WINDOW_LAYOUT_STATE.platform_capabilities,
    },
  });

export function useWindowLayout(): WindowLayoutState {
  return windowLayoutState;
}

export function applyWindowLayoutState(next: WindowLayoutState): void {
  setWindowLayoutState({
    configured_mode: next.configured_mode,
    effective_mode: next.effective_mode,
    dock_position: next.dock_position,
    effective_dock_position: next.effective_dock_position,
    panel_ratio_percent: next.panel_ratio_percent,
    game_visible: next.game_visible,
    is_dragging_splitter: next.is_dragging_splitter,
    panel_edges: { ...next.panel_edges },
    game_edges: { ...next.game_edges },
    platform_capabilities: { ...next.platform_capabilities },
  });
}

export function cycleDockPosition(current: DockPosition): DockPosition {
  const index = DOCK_POSITION_ORDER.indexOf(current);
  if (index === -1) return "right";
  return DOCK_POSITION_ORDER[(index + 1) % DOCK_POSITION_ORDER.length];
}

export function getDockPositionLabel(pos: DockPosition): string {
  switch (pos) {
    case "auto":
      return "Auto";
    case "right":
      return "Right";
    case "bottom":
      return "Bottom";
    case "left":
      return "Left";
    case "top":
      return "Top";
  }
}

export async function loadWindowLayoutState(): Promise<WindowLayoutState> {
  if (!isTauri()) {
    return windowLayoutState;
  }
  try {
    const next = await invoke<WindowLayoutState>("get_window_layout_state");
    applyWindowLayoutState(next);
    return next;
  } catch (err) {
    console.warn("Failed to load window layout state:", err);
    return windowLayoutState;
  }
}

export async function subscribeWindowLayoutEvents(): Promise<UnlistenFn> {
  if (!isTauri()) {
    return () => {};
  }
  try {
    return await listen<WindowLayoutState>("fusou-layout-changed", (event) => {
      if (event.payload) {
        applyWindowLayoutState(event.payload);
      }
    });
  } catch (err) {
    console.warn("Failed to listen for layout change events:", err);
    return () => {};
  }
}

export async function setDockPosition(position: DockPosition): Promise<void> {
  if (!isTauri()) {
    setWindowLayoutState("dock_position", position);
    if (position !== "auto") {
      setWindowLayoutState("effective_dock_position", position);
    }
    return;
  }
  const next = await invoke<WindowLayoutState>("set_dock_position", {
    position,
  });
  applyWindowLayoutState(next);
}

export async function setDockPanelRatio(ratioPercent: number): Promise<void> {
  const clamped = Math.max(15, Math.min(80, Math.round(ratioPercent)));
  if (!isTauri()) {
    setWindowLayoutState("panel_ratio_percent", clamped);
    return;
  }
  const next = await invoke<WindowLayoutState>("set_dock_panel_ratio", {
    ratioPercent: clamped,
  });
  applyWindowLayoutState(next);
}

export async function openGamePane(): Promise<void> {
  if (!isTauri()) {
    setWindowLayoutState("game_visible", true);
    return;
  }
  const next = await invoke<WindowLayoutState>("open_game_pane");
  applyWindowLayoutState(next);
}

export async function closeGamePane(): Promise<void> {
  if (!isTauri()) {
    setWindowLayoutState("game_visible", false);
    return;
  }
  const next = await invoke<WindowLayoutState>("close_game_pane");
  applyWindowLayoutState(next);
}

export async function beginSplitterDrag(): Promise<void> {
  if (!isTauri()) return;
  await invoke("begin_splitter_drag");
}

export async function updateSplitterDrag(
  screenX: number,
  screenY: number,
): Promise<void> {
  if (!isTauri()) return;
  await invoke("update_splitter_drag", { screenX, screenY });
}

export async function endSplitterDrag(): Promise<void> {
  if (!isTauri()) return;
  await invoke("end_splitter_drag");
}
