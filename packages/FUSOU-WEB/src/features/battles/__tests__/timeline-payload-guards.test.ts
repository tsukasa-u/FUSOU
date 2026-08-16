import { describe, expect, it } from "vitest";
import { getDamageState } from "../helpers";
import { renderCompactHpBadge, renderOutcomeBadges } from "../render-helpers";
import { nullableNumberArray, parseFiniteNumber } from "../payload-guards";
import { buildInitialHps, buildTimelineEvents } from "../timeline";

describe("timeline payload guards", () => {
  it("preserves valid zero while classifying missing and invalid numbers", () => {
    expect(parseFiniteNumber(0)).toEqual({ value: 0, status: "valid" });
    expect(parseFiniteNumber("0")).toEqual({ value: 0, status: "valid" });
    expect(parseFiniteNumber(null)).toEqual({
      value: null,
      status: "missing",
    });
    expect(parseFiniteNumber("not-a-number")).toEqual({
      value: null,
      status: "invalid",
    });
  });

  it("normalizes shelling numeric strings and ignores malformed rows", () => {
    const events = buildTimelineEvents({
      battle_order: [{ Hougeki: 0 }],
      hougeki: [
        {
          at: "0",
          at_eflag: 0,
          df: ["0"],
          damage: ["5"],
          cl: ["2"],
          f_now_hps: ["10"],
          e_now_hps: ["10"],
          si: ["42"],
        },
        "malformed",
      ],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "shelling",
      attackerIdx: 0,
      defenderIdx: 0,
      damage: 5,
      crit: true,
      slotItems: [42],
    });
  });

  it("keeps zero-damage events but skips events with missing damage", () => {
    const events = buildTimelineEvents({
      battle_order: [{ Hougeki: 0 }],
      hougeki: [
        {
          at: 0,
          at_eflag: 0,
          df: [0, 1],
          damage: [0, null],
          f_now_hps: [10, 10],
          e_now_hps: [10, 10],
        },
      ],
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.damage).toBe(0);
  });

  it("keeps valid zero damage across air, raigeki, and support phases", () => {
    const airEvents = buildTimelineEvents({
      battle_order: [{ OpeningAirAttack: 0 }],
      opening_air_attack: {
        e_damages: [0, null],
        e_now_hps: [10, 10],
      },
    });
    const raigekiEvents = buildTimelineEvents({
      battle_order: [{ ClosingRaigeki: 0 }],
      closing_raigeki: {
        edam: [0, null],
        e_now_hps: [10, 10],
      },
    });
    const supportEvents = buildTimelineEvents({
      battle_order: [{ SupportAttack: 0 }],
      support_attack: {
        support_hourai: {
          damage: [0, null],
          now_hps: [10, 10],
          cl_list: [0, 0],
          ship_id: [0, 0],
        },
      },
    });

    expect(airEvents.filter((event) => event.type === "air")).toMatchObject([
      { defenderIdx: 0, damage: 0 },
    ]);
    expect(raigekiEvents).toMatchObject([
      { type: "raigeki", defenderIdx: 0, damage: 0 },
    ]);
    expect(supportEvents).toMatchObject([
      { type: "shelling", defenderIdx: 0, damage: 0 },
    ]);
  });

  it("normalizes initial HP arrays without trusting their runtime type", () => {
    expect(
      buildInitialHps({ f_nowhps: ["10", "8"], e_nowhps: ["12", "9"] }),
    ).toEqual({ fInit: [10, 8], eInit: [12, 9] });
    expect(buildInitialHps({ f_nowhps: ["bad"], e_nowhps: null })).toEqual({
      fInit: [null],
      eInit: [],
    });
    expect(nullableNumberArray([100, 0, undefined, "50"])).toEqual([
      100,
      0,
      null,
      50,
    ]);
    expect(
      buildInitialHps({ f_nowhps: [0, 10], e_nowhps: [0, 20] }),
    ).toEqual({
      fInit: [0, 10],
      eInit: [0, 20],
    });
  });

  it("renders unknown HP and damage separately from valid zero", () => {
    expect(getDamageState(0, 100).label).toBe("大破");
    expect(getDamageState(null, 100).label).toBe("不明");
    expect(renderCompactHpBadge(0, 100)).toContain("0/100");
    expect(renderCompactHpBadge(null, 100)).toContain("?/100");
    expect(renderOutcomeBadges({
      damage: 0,
      crit: false,
      protect: false,
      sunk: false,
      afterState: "健在",
    })).toContain("MISS");
    expect(renderOutcomeBadges({
      damage: null,
      crit: false,
      protect: false,
      sunk: false,
      afterState: "不明",
    })).not.toContain("MISS");
  });
});
