import { describe, expect, it } from "vitest";
import {
  formatCompleteDateTimeFull,
  formatCompleteTime,
  formatRemainingTime,
  nextTimerDisplayMode,
  normalizeTimerDisplayMode,
  parseDeckMission,
  resolveTimerStatus,
} from "./timer";

describe("timer utilities", () => {
  it("formats remaining time as HH:MM:SS and clamps non-positive durations", () => {
    expect(formatRemainingTime(0)).toBe("00:00:00");
    expect(formatRemainingTime(-5000)).toBe("00:00:00");
    expect(formatRemainingTime(1000)).toBe("00:00:01");
    expect(formatRemainingTime(59_000)).toBe("00:00:59");
    expect(formatRemainingTime(3_661_000)).toBe("01:01:01");
    expect(formatRemainingTime(100 * 3600 * 1000 + 5 * 60 * 1000 + 9_000)).toBe(
      "100:05:09",
    );
  });

  it("formats OS local completion time for same-day and next-day timestamps", () => {
    const now = new Date(2026, 10, 21, 10, 15, 0).getTime();
    const sameDay = new Date(2026, 10, 21, 14, 35, 9).getTime();
    const nextDay = new Date(2026, 10, 22, 2, 5, 30).getTime();

    expect(formatCompleteTime(sameDay, now)).toBe("14:35:09");
    expect(formatCompleteTime(sameDay, now, { includeSeconds: false })).toBe(
      "14:35",
    );
    expect(formatCompleteTime(nextDay, now, { includeSeconds: false })).toBe(
      "11/22 02:05",
    );
    expect(formatCompleteTime(nextDay, now, { includeSeconds: true })).toBe(
      "11/22 02:05:30",
    );
    expect(formatCompleteDateTimeFull(sameDay)).toBe("2026/11/21 14:35:09");
    expect(formatCompleteTime(0, now)).toBe("—");
  });

  it("resolves operational timer statuses accurately", () => {
    const now = 1_700_000_000_000;
    expect(resolveTimerStatus(null, now)).toBe("idle");
    expect(resolveTimerStatus(0, now)).toBe("idle");
    expect(resolveTimerStatus(now + 120_000, now)).toBe("running");
    expect(resolveTimerStatus(now + 45_000, now)).toBe("soon");
    expect(resolveTimerStatus(now - 1_000, now)).toBe("complete");
    expect(
      resolveTimerStatus(now + 180_000, now, { forcedStatus: "recalled" }),
    ).toBe("recalled");
    expect(
      resolveTimerStatus(now - 5_000, now, { forcedStatus: "recalled" }),
    ).toBe("complete");
    expect(
      resolveTimerStatus(0, now, { forcedStatus: "locked" }),
    ).toBe("locked");
  });

  it("normalizes and cycles timer display modes", () => {
    expect(normalizeTimerDisplayMode("both")).toBe("both");
    expect(normalizeTimerDisplayMode("remaining")).toBe("remaining");
    expect(normalizeTimerDisplayMode("complete_at")).toBe("complete_at");
    expect(normalizeTimerDisplayMode("invalid")).toBe("both");

    expect(nextTimerDisplayMode("both")).toBe("remaining");
    expect(nextTimerDisplayMode("remaining")).toBe("complete_at");
    expect(nextTimerDisplayMode("complete_at")).toBe("both");
  });

  it("parses deck mission tuples with master mission lookup and fallbacks", () => {
    const mstMissions = {
      2: {
        id: 2,
        disp_no: "02",
        maparea_id: 1,
        name: "長距離練習航海",
        time: 30,
        reset_type: 0,
        return_flag: 1,
      },
      37: {
        id: 37,
        disp_no: "37",
        maparea_id: 5,
        name: "東京急行",
        time: 165,
        reset_type: 0,
        return_flag: 1,
      },
    };

    expect(parseDeckMission([0, 0, 0, 0], mstMissions)).toBeNull();
    expect(parseDeckMission([], mstMissions)).toBeNull();
    expect(parseDeckMission([1, 2, 1_700_001_800_000, 0], mstMissions)).toEqual({
      state: 1,
      missionId: 2,
      completeTimeMs: 1_700_001_800_000,
      dispNo: "02",
      name: "長距離練習航海",
      timerStatus: undefined,
    });
    expect(parseDeckMission([2, 37, 1_700_000_000_000, 0], mstMissions)).toEqual({
      state: 2,
      missionId: 37,
      completeTimeMs: 1_700_000_000_000,
      dispNo: "37",
      name: "東京急行",
      timerStatus: "complete",
    });
    expect(parseDeckMission([3, 99, 1_700_000_600_000, 0], mstMissions)).toEqual({
      state: 3,
      missionId: 99,
      completeTimeMs: 1_700_000_600_000,
      dispNo: "#99",
      name: "Mission #99",
      timerStatus: "recalled",
    });
  });
});
