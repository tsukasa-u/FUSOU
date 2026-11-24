import { describe, expect, it } from "vitest";
import {
  cycleDockPosition,
  DOCK_POSITION_ORDER,
  getDockPositionLabel,
} from "./window_layout";

describe("window_layout", () => {
  it("cycles through all dock positions in order and wraps around", () => {
    let pos = DOCK_POSITION_ORDER[0];
    const visited = [pos];
    for (let i = 0; i < DOCK_POSITION_ORDER.length; i++) {
      pos = cycleDockPosition(pos);
      visited.push(pos);
    }
    expect(visited).toEqual([
      "right",
      "bottom",
      "left",
      "top",
      "auto",
      "right",
    ]);
  });

  it("provides human-readable labels for every dock position", () => {
    expect(getDockPositionLabel("auto")).toBe("Auto");
    expect(getDockPositionLabel("right")).toBe("Right");
    expect(getDockPositionLabel("bottom")).toBe("Bottom");
    expect(getDockPositionLabel("left")).toBe("Left");
    expect(getDockPositionLabel("top")).toBe("Top");
  });
});
