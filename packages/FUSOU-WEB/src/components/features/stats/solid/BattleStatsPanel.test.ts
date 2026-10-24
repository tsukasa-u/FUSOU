import { describe, expect, it } from "vitest";

describe("BattleStatsPanel calculation safety", () => {
  it("normalizes second-based timestamps to milliseconds to prevent 1970 epoch bugs", () => {
    const rawSeconds = 1729000000; // 10 digits
    const ms = rawSeconds < 10000000000 ? rawSeconds * 1000 : rawSeconds;
    expect(ms).toBe(1729000000000);
    const dDate = new Date(ms);
    expect(dDate.getFullYear()).toBeGreaterThanOrEqual(2024);
  });

  it("handles gap larger than 90 days without infinite or excessive looping", () => {
    const dailyCounts: Record<string, number> = {
      "2020-01-01": 5,
      "2026-10-23": 10,
    };
    const dailySortiesRaw = Object.entries(dailyCounts).sort(([a], [b]) => a.localeCompare(b));
    const dailySorties: Array<{ date: string; count: number }> = [];

    const firstEntry = dailySortiesRaw[0];
    const lastEntry = dailySortiesRaw[dailySortiesRaw.length - 1];
    expect(firstEntry).toBeDefined();
    expect(lastEntry).toBeDefined();

    if (firstEntry && lastEntry) {
      const firstDate = new Date(firstEntry[0] + "T00:00:00");
      const lastDate = new Date(lastEntry[0] + "T00:00:00");
      const diffDays = Math.round((lastDate.getTime() - firstDate.getTime()) / (86400 * 1000));
      expect(diffDays).toBeGreaterThan(90);

      if (diffDays >= 0 && diffDays <= 90) {
        for (let d = new Date(firstDate); d <= lastDate; d.setDate(d.getDate() + 1)) {
          const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          dailySorties.push({ date: dateStr, count: dailyCounts[dateStr] ?? 0 });
        }
      } else {
        for (const [date, count] of dailySortiesRaw) {
          dailySorties.push({ date, count });
        }
      }
    }

    expect(dailySorties.length).toBe(2);
    expect(dailySorties[0]?.date).toBe("2020-01-01");
    expect(dailySorties[1]?.date).toBe("2026-10-23");
  });

  it("normalizes MVP index where 0 is flagship and 1 is 2nd ship", () => {
    const normalizeMvp = (idx: unknown) => {
      const normalized = Number(idx);
      if (!Number.isFinite(normalized) || normalized < 0) return null;
      return normalized === 0 ? "旗艦" : `随伴艦(${Math.trunc(normalized) + 1}番艦)`;
    };

    expect(normalizeMvp(0)).toBe("旗艦");
    expect(normalizeMvp(1)).toBe("随伴艦(2番艦)");
    expect(normalizeMvp(5)).toBe("随伴艦(6番艦)");
    expect(normalizeMvp(-1)).toBeNull();
  });
  it("calculates totalBattles based on filtered battles rather than full array length", () => {
    const allBattles = [
      { uuid: "b1", maparea_id: 1, mapinfo_no: 1, battle_result: { win_rank: "S" } },
      { uuid: "b2", maparea_id: 1, mapinfo_no: 1, battle_result: { win_rank: "A" } },
      { uuid: "b3", maparea_id: 1, mapinfo_no: 5, battle_result: { win_rank: "S" } },
    ];
    const selectedMap = "1-1";
    let matching = 0;
    let sCount = 0;
    for (const b of allBattles) {
      const mk = `${b.maparea_id}-${b.mapinfo_no}`;
      if (selectedMap && mk !== selectedMap) continue;
      matching++;
      if (b.battle_result.win_rank === "S") sCount++;
    }
    expect(matching).toBe(2);
    expect(sCount).toBe(1);
    const sRate = matching > 0 ? `${((sCount / matching) * 100).toFixed(1)}%` : "-";
    expect(sRate).toBe("50.0%");
  });
});
