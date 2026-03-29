/**
 * Unit tests for battle-map-flow pure utility functions.
 * Run with: node --test --import tsx/esm test/battle-map-flow-utils.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── dataUtils ────────────────────────────────────────────────────────────────
import {
  cellLabel,
  cellOverlayLabel,
  mapKeyOf,
  normalizeEpochMs,
  parseOfficialMapThemeMode,
  resolveRouteCellsWithPort,
} from "../src/components/solid/map-flow/battle-map-flow/dataUtils.ts";

// ── geometry ─────────────────────────────────────────────────────────────────
import {
  circleIntersectsRect,
  rectsOverlap,
} from "../src/components/solid/map-flow/battle-map-flow/geometry.ts";

// ── labelLayout ───────────────────────────────────────────────────────────────
import { estimateLabelWidth } from "../src/components/solid/map-flow/battle-map-flow/labelLayout.ts";

// ── constants ─────────────────────────────────────────────────────────────────
import { WIN_RANK_BADGES } from "../src/components/solid/map-flow/battle-map-flow/constants.ts";

// ─────────────────────────────────────────────────────────────────────────────

describe("mapKeyOf", () => {
  it("returns 0-0 when maparea_id is missing", () => {
    assert.equal(mapKeyOf({}), "0-0");
  });
  it("returns 0-0 when mapinfo_no is missing", () => {
    assert.equal(mapKeyOf({ maparea_id: 1 }), "0-0");
  });
  it("returns formatted key", () => {
    assert.equal(mapKeyOf({ maparea_id: 3, mapinfo_no: 4 }), "3-4");
  });
  it("handles null values", () => {
    assert.equal(mapKeyOf({ maparea_id: null, mapinfo_no: null }), "0-0");
  });
});

describe("normalizeEpochMs", () => {
  it("returns null for null input", () => {
    assert.equal(normalizeEpochMs(null), null);
  });
  it("returns null for undefined input", () => {
    assert.equal(normalizeEpochMs(undefined), null);
  });
  it("converts seconds to ms when value < 1e12", () => {
    const secs = 1_700_000_000;
    assert.equal(normalizeEpochMs(secs), secs * 1000);
  });
  it("keeps ms value unchanged when value >= 1e12", () => {
    const ms = 1_700_000_000_000;
    assert.equal(normalizeEpochMs(ms), ms);
  });
  it("returns null for 0", () => {
    assert.equal(normalizeEpochMs(0), null);
  });
});

describe("parseOfficialMapThemeMode", () => {
  it("accepts 'light'", () => {
    assert.equal(parseOfficialMapThemeMode("light"), "light");
  });
  it("accepts 'dark'", () => {
    assert.equal(parseOfficialMapThemeMode("dark"), "dark");
  });
  it("accepts 'auto'", () => {
    assert.equal(parseOfficialMapThemeMode("auto"), "auto");
  });
  it("defaults unknown strings to 'auto'", () => {
    assert.equal(parseOfficialMapThemeMode("neon"), "auto");
  });
  it("defaults null to 'auto'", () => {
    assert.equal(parseOfficialMapThemeMode(null), "auto");
  });
  it("defaults undefined to 'auto'", () => {
    assert.equal(parseOfficialMapThemeMode(undefined), "auto");
  });
});

describe("cellLabel", () => {
  it("returns '港(0)' for cell 0 with no labels", () => {
    assert.equal(cellLabel(0, undefined), "港(0)");
  });
  it("returns fallback text for non-zero cell with no labels", () => {
    assert.equal(cellLabel(3, undefined), "3マス");
  });
  it("formats custom label with cell id", () => {
    assert.equal(cellLabel(4, { 4: "D" }), "D(4)");
  });
  it("returns '-' for NaN cell id", () => {
    assert.equal(cellLabel(NaN, undefined), "-");
  });
  it("uses label from labels record", () => {
    assert.equal(cellLabel(1, { 1: "A" }), "A(1)");
  });
});

describe("cellOverlayLabel", () => {
  it("returns '港' for cell 0 with no labels", () => {
    assert.equal(cellOverlayLabel(0, undefined), "港");
  });
  it("returns cell id as string for non-zero cells without labels", () => {
    assert.equal(cellOverlayLabel(5, undefined), "5");
  });
  it("returns raw label string when available", () => {
    assert.equal(cellOverlayLabel(4, { 4: "D" }), "D");
  });
  it("returns '-' for NaN", () => {
    assert.equal(cellOverlayLabel(NaN, undefined), "-");
  });
});

describe("resolveRouteCellsWithPort", () => {
  const spots = [
    { cellId: 0, x: 0, y: 0 },
    { cellId: 1, x: 10, y: 0 },
    { cellId: 2, x: 20, y: 0 },
    { cellId: 5, x: 100, y: 0 }, // a second port far away
  ];

  it("returns cells unchanged when empty", () => {
    assert.deepEqual(resolveRouteCellsWithPort([], [0], spots), []);
  });

  it("returns cells unchanged when ports is empty", () => {
    assert.deepEqual(resolveRouteCellsWithPort([1, 2], [], spots), [1, 2]);
  });

  it("returns cells unchanged when port is already first cell", () => {
    assert.deepEqual(resolveRouteCellsWithPort([0, 1, 2], [0], spots), [0, 1, 2]);
  });

  it("prepends single port when not present", () => {
    assert.deepEqual(resolveRouteCellsWithPort([1, 2], [0], spots), [0, 1, 2]);
  });

  it("picks the nearest port when multiple ports exist", () => {
    // cell 1 (x=10) is closer to port 0 (x=0) than to port 5 (x=100)
    const result = resolveRouteCellsWithPort([1, 2], [0, 5], spots);
    assert.equal(result[0], 0);
    assert.deepEqual(result.slice(1), [1, 2]);
  });

  it("prepends first port when no spot found for first cell", () => {
    const result = resolveRouteCellsWithPort([99], [0], spots); // cellId 99 not in spots
    assert.equal(result[0], 0);
  });
});

describe("rectsOverlap", () => {
  const makeRect = (rectX: number, rectY: number, width: number, height: number) =>
    ({ rectX, rectY, width, height });

  it("returns true when rects overlap", () => {
    assert.equal(rectsOverlap(makeRect(0, 0, 10, 10), makeRect(5, 5, 10, 10)), true);
  });
  it("returns false when rects don't overlap horizontally", () => {
    assert.equal(rectsOverlap(makeRect(0, 0, 5, 5), makeRect(10, 0, 5, 5)), false);
  });
  it("returns false when rects don't overlap vertically", () => {
    assert.equal(rectsOverlap(makeRect(0, 0, 5, 5), makeRect(0, 10, 5, 5)), false);
  });
  it("returns false for touching edges (no actual overlap)", () => {
    assert.equal(rectsOverlap(makeRect(0, 0, 10, 10), makeRect(10, 0, 10, 10)), false);
  });
  it("returns true for identical rects", () => {
    assert.equal(rectsOverlap(makeRect(2, 2, 6, 6), makeRect(2, 2, 6, 6)), true);
  });
});

describe("circleIntersectsRect", () => {
  const makeRect = (rectX: number, rectY: number, width: number, height: number) =>
    ({ rectX, rectY, width, height });

  it("returns true when circle center is inside rect", () => {
    assert.equal(circleIntersectsRect(5, 5, 3, makeRect(0, 0, 10, 10)), true);
  });
  it("returns true when circle overlaps rect edge", () => {
    assert.equal(circleIntersectsRect(-1, 5, 3, makeRect(0, 0, 10, 10)), true);
  });
  it("returns false when circle is far from rect", () => {
    assert.equal(circleIntersectsRect(100, 100, 3, makeRect(0, 0, 10, 10)), false);
  });
  it("returns false when circle just touches rect corner (but not intersects)", () => {
    // Circle at (0,0) radius 1; nearest corner of [2,2,4,4] is at (2,2); distance=sqrt(8)>1
    assert.equal(circleIntersectsRect(0, 0, 1, makeRect(2, 2, 4, 4)), false);
  });
});

describe("estimateLabelWidth", () => {
  it("returns a positive number for non-empty text", () => {
    const width = estimateLabelWidth("ABC");
    assert.ok(width > 0, `Expected positive width, got ${width}`);
  });
  it("is wider for longer text", () => {
    const short = estimateLabelWidth("A");
    const long = estimateLabelWidth("ABCDEFG");
    assert.ok(long > short, `Expected ${long} > ${short}`);
  });
  it("returns a number for empty string", () => {
    const width = estimateLabelWidth("");
    assert.ok(typeof width === "number");
  });
  it("Japanese characters count as wide", () => {
    const japanese = estimateLabelWidth("港");
    const ascii = estimateLabelWidth("A");
    // Japanese chars should be wider than a single ASCII char
    assert.ok(japanese >= ascii, `Expected japanese ${japanese} >= ascii ${ascii}`);
  });
});

describe("WIN_RANK_BADGES", () => {
  it("contains badge for S rank", () => {
    assert.ok("S" in WIN_RANK_BADGES);
  });
  it("S badge is a non-empty string (CSS class)", () => {
    const s = WIN_RANK_BADGES["S"];
    assert.ok(typeof s === "string" && s.length > 0);
  });
  it("contains badge for each standard rank", () => {
    for (const rank of ["S", "A", "B", "C", "D"]) {
      assert.ok(rank in WIN_RANK_BADGES, `Missing badge for rank ${rank}`);
    }
  });
});
