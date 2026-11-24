import { createSignal, onCleanup } from "solid-js";
import {
  beginSplitterDrag,
  endSplitterDrag,
  setDockPanelRatio,
  updateSplitterDrag,
  type EffectiveDockPosition,
} from "../../utility/window_layout";

interface SplitHandleProps {
  effectiveDockPosition: EffectiveDockPosition;
  isDragging?: boolean;
}

export function SplitHandle(props: SplitHandleProps) {
  const [localDragging, setLocalDragging] = createSignal(false);
  let rafId = 0;
  let pendingPoint: { x: number; y: number } | null = null;
  let activePointerId: number | null = null;

  const isHorizontalSplit = () =>
    props.effectiveDockPosition === "right" ||
    props.effectiveDockPosition === "left";

  const positionClass = () => {
    switch (props.effectiveDockPosition) {
      case "right":
        return "fusou-split-handle-left";
      case "left":
        return "fusou-split-handle-right";
      case "bottom":
        return "fusou-split-handle-top";
      case "top":
        return "fusou-split-handle-bottom";
    }
  };

  const stopDrag = () => {
    if (!localDragging()) return;
    setLocalDragging(false);
    activePointerId = null;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    pendingPoint = null;
    void endSplitterDrag();
  };

  const handlePointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement | null;
    if (target && typeof target.setPointerCapture === "function") {
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        // Ignore if capture is unsupported on the current platform
      }
    }
    activePointerId = e.pointerId;
    setLocalDragging(true);
    void beginSplitterDrag();
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!localDragging()) return;
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    pendingPoint = { x: e.screenX, y: e.screenY };
    if (!rafId) {
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        if (pendingPoint) {
          void updateSplitterDrag(pendingPoint.x, pendingPoint.y);
        }
      });
    }
  };

  const handlePointerUp = (e: PointerEvent) => {
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    const target = e.currentTarget as HTMLElement | null;
    if (target && typeof target.releasePointerCapture === "function") {
      try {
        target.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
    }
    stopDrag();
  };

  const handleDoubleClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void setDockPanelRatio(30);
  };

  onCleanup(() => {
    if (rafId) cancelAnimationFrame(rafId);
    if (localDragging()) {
      void endSplitterDrag();
    }
  });

  const dragging = () => localDragging() || Boolean(props.isDragging);

  return (
    <div
      role="separator"
      aria-orientation={isHorizontalSplit() ? "vertical" : "horizontal"}
      aria-label="Resize game and panel boundary"
      title="Drag to resize (Double-click to reset to 30%)"
      class={`fusou-split-handle ${positionClass()} ${
        dragging() ? "is-dragging" : ""
      }`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDblClick={handleDoubleClick}
    >
      <div class="fusou-split-grip" />
    </div>
  );
}
