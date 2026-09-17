import test from "node:test";
import assert from "node:assert/strict";
import { buildWindow } from "../dist/trigger/compaction-tasks.js";

test("buildWindow - hourly calculates correct 1-hour window", () => {
  const now = Date.parse("2026-09-17T03:45:00Z");
  const window = buildWindow("hourly", now);
  assert.equal(window.end, Date.parse("2026-09-17T03:00:00Z"));
  assert.equal(window.start, Date.parse("2026-09-17T02:00:00Z"));
  assert.equal(window.end - window.start, 3_600_000);
});

test("buildWindow - daily calculates correct 1-day UTC window", () => {
  const now = Date.parse("2026-09-17T00:20:00Z");
  const window = buildWindow("daily", now);
  assert.equal(window.end, Date.parse("2026-09-17T00:00:00Z"));
  assert.equal(window.start, Date.parse("2026-09-16T00:00:00Z"));
  assert.equal(window.end - window.start, 86_400_000);
});

test("buildWindow - weekly calculates Monday-aligned 1-week window", () => {
  // Monday 00:40 UTC (standard cron trigger time)
  const mondayRun = Date.parse("2026-09-14T00:40:00Z");
  const window = buildWindow("weekly", mondayRun);
  assert.equal(window.end, Date.parse("2026-09-14T00:00:00Z"));
  assert.equal(window.start, Date.parse("2026-09-07T00:00:00Z"));
  assert.equal(window.end - window.start, 7 * 86_400_000);

  // Wednesday mid-week
  const wednesday = Date.parse("2026-09-16T15:30:00Z");
  const wedWindow = buildWindow("weekly", wednesday);
  assert.equal(wedWindow.end, Date.parse("2026-09-14T00:00:00Z"));
  assert.equal(wedWindow.start, Date.parse("2026-09-07T00:00:00Z"));

  // Sunday 23:59 UTC (just before Monday boundary)
  const sundayNight = Date.parse("2026-09-13T23:59:59.999Z");
  const sunWindow = buildWindow("weekly", sundayNight);
  assert.equal(sunWindow.end, Date.parse("2026-09-07T00:00:00Z"));
  assert.equal(sunWindow.start, Date.parse("2026-08-31T00:00:00Z"));
});
