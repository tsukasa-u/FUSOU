import { describe, expect, it } from "vitest";
import {
  compareTableVersions,
  countValidHps,
  hpScoreForDeck,
  normalizeHpValue,
} from "../helpers";

describe("battles helpers (0.6.0 schema compatibility)", () => {
  describe("normalizeHpValue", () => {
    it("returns positive integer and zero as is", () => {
      expect(normalizeHpValue(0)).toBe(0);
      expect(normalizeHpValue(45)).toBe(45);
      expect(normalizeHpValue("32")).toBe(32);
    });

    it("normalizes negative sentinel values (-1 in pre-0.6.0) to null", () => {
      expect(normalizeHpValue(-1)).toBeNull();
      expect(normalizeHpValue(-99)).toBeNull();
      expect(normalizeHpValue("-1")).toBeNull();
    });

    it("returns null for null, undefined, or malformed inputs", () => {
      expect(normalizeHpValue(null)).toBeNull();
      expect(normalizeHpValue(undefined)).toBeNull();
      expect(normalizeHpValue("unknown")).toBeNull();
    });
  });

  describe("countValidHps", () => {
    it("counts non-negative hp slots correctly for both pre-0.6.0 and post-0.6.0 schemas", () => {
      // pre-0.6.0 schema: sentinel -1 for dummy / empty slots
      const preV060 = [50, 40, 30, -1, -1, -1];
      expect(countValidHps(preV060)).toBe(3);

      // post-0.6.0 schema: null for dummy / empty slots
      const postV060 = [50, 40, 30, null, null, null];
      expect(countValidHps(postV060)).toBe(3);
    });

    it("returns 0 for empty or invalid snapshot array", () => {
      expect(countValidHps([])).toBe(0);
      expect(countValidHps([-1, null, undefined])).toBe(0);
    });
  });

  describe("hpScoreForDeck", () => {
    const ships = [
      { index: 0, nowhp: 50, maxhp: 50 },
      { index: 1, nowhp: 40, maxhp: 40 },
    ];

    it("produces identical match score for pre-0.6.0 (-1) and post-0.6.0 (null) dummy slots", () => {
      const scorePre = hpScoreForDeck(ships, [50, 40, -1, -1, -1, -1]);
      const scorePost = hpScoreForDeck(ships, [50, 40, null, null, null, null]);

      expect(scorePre).toBe(0);
      expect(scorePost).toBe(0);
      expect(scorePre).toBe(scorePost);
    });

    it("penalizes count mismatch between fleet ships and valid hp snapshot slots", () => {
      // 2 ships vs 1 valid HP slot (mismatch = 1 * 20 penalty)
      const score = hpScoreForDeck(ships, [50, null]);
      expect(score).toBe(20 + 50); // mismatch penalty (20) + missing 2nd ship hp (50)
    });
  });

  describe("compareTableVersions", () => {
    it("orders semver-like version strings correctly", () => {
      expect(compareTableVersions("0.6.0", "0.5.0")).toBeGreaterThan(0);
      expect(compareTableVersions("0.5.9", "0.6.0")).toBeLessThan(0);
      expect(compareTableVersions("0.6.0", "0.6.0")).toBe(0);
      expect(compareTableVersions("0.6.1", "0.6.0")).toBeGreaterThan(0);
    });
  });
});
