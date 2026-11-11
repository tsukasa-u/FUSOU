import { describe, expect, it } from "vitest";
import { createRoot } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import type {
  Quest,
  QuestCompletion,
  QuestEvent,
  Quests,
} from "@ipc-bindings/quest";
import type { QuestCacheState } from "./quest_cache";
import {
  applyQuestEventToState,
  createEmptyQuestCacheState,
  filterQuestList,
  getLatestQuestResetBoundaryMs,
  getQuestPeriodLabel,
  mergeQuestCache,
  mergeQuestState,
} from "./quest_cache";

function jstMs(isoLocalJst: string): number {
  return Date.parse(`${isoLocalJst}+09:00`);
}

function createQuest(
  no: number,
  title: string,
  overrides: Partial<Quest> = {},
): Quest {
  return {
    no,
    category: 2,
    quest_type: 1,
    label_type: 2,
    state: 2,
    title,
    detail: "",
    voice_id: 0,
    get_material: [],
    bonus_flag: 0,
    progress_flag: 0,
    invalid_flag: 0,
    lost_badges: null,
    ...overrides,
  };
}

function createCompletion(no: number, state: number): QuestCompletion {
  return {
    no,
    state,
    progress_flag: 0,
    c_flag: 0,
  };
}

function createQuestList(
  quests: Quests["quests"],
  completed: Quests["completed"] = {},
  page_no = 1,
  timestamp = jstMs("2026-11-10T12:00:00"),
): Quests {
  return {
    timestamp,
    page_no,
    count: Object.keys(quests).length,
    completed_kind: 0,
    exec_count: 0,
    exec_type: 0,
    quests,
    completed,
  };
}

describe("getLatestQuestResetBoundaryMs", () => {
  it("computes JST 05:00 reset boundaries for daily, weekly, monthly, quarterly, yearly", () => {
    expect(
      getLatestQuestResetBoundaryMs(1, 2, jstMs("2026-11-10T04:59:00")),
    ).toBe(jstMs("2026-11-09T05:00:00"));
    expect(
      getLatestQuestResetBoundaryMs(1, 2, jstMs("2026-11-10T05:00:00")),
    ).toBe(jstMs("2026-11-10T05:00:00"));

    // 2026-11-10 is Tuesday -> Monday was Nov 9
    expect(
      getLatestQuestResetBoundaryMs(2, 3, jstMs("2026-11-10T10:00:00")),
    ).toBe(jstMs("2026-11-09T05:00:00"));
    expect(
      getLatestQuestResetBoundaryMs(2, 3, jstMs("2026-11-09T04:59:00")),
    ).toBe(jstMs("2026-11-02T05:00:00"));

    // Monthly
    expect(
      getLatestQuestResetBoundaryMs(3, 6, jstMs("2026-11-01T04:59:00")),
    ).toBe(jstMs("2026-10-01T05:00:00"));

    // Quarterly (Mar, Jun, Sep, Dec)
    expect(
      getLatestQuestResetBoundaryMs(5, 7, jstMs("2026-06-01T04:59:00")),
    ).toBe(jstMs("2026-03-01T05:00:00"));
    expect(
      getLatestQuestResetBoundaryMs(5, 7, jstMs("2026-06-01T05:00:00")),
    ).toBe(jstMs("2026-06-01T05:00:00"));
    expect(
      getLatestQuestResetBoundaryMs(5, 7, jstMs("2026-01-15T12:00:00")),
    ).toBe(jstMs("2025-12-01T05:00:00"));

    // Yearly (labelType = 102 -> Feb 1 05:00 JST)
    expect(
      getLatestQuestResetBoundaryMs(5, 102, jstMs("2026-01-20T12:00:00")),
    ).toBe(jstMs("2025-02-01T05:00:00"));
    expect(
      getLatestQuestResetBoundaryMs(5, 102, jstMs("2026-02-01T05:00:00")),
    ).toBe(jstMs("2026-02-01T05:00:00"));

    // Once
    expect(
      getLatestQuestResetBoundaryMs(4, 1, jstMs("2026-11-10T12:00:00")),
    ).toBeNull();
  });
});

describe("mergeQuestCache / mergeQuestState", () => {
  it("replaces all quests within the incoming period tab while preserving other periods", () => {
    const staleDaily = createQuest(201, "old daily", { quest_type: 1 });
    const nextDaily = createQuest(202, "new daily", { quest_type: 1 });
    const monthly = createQuest(301, "monthly", {
      quest_type: 3,
      label_type: 6,
    });

    const previous = createQuestList(
      { 201: staleDaily, 301: monthly },
      { 201: createCompletion(201, 2), 301: createCompletion(301, 1) },
      1,
    );
    const incoming = createQuestList(
      { 202: nextDaily },
      { 202: createCompletion(202, 2) },
      1,
    );

    const merged = mergeQuestCache(previous, incoming);
    expect(merged.quests).toEqual({
      202: nextDaily,
      301: monthly,
    });
    expect(merged.completed).toEqual({
      202: createCompletion(202, 2),
      301: createCompletion(301, 1),
    });
  });

  it("replaces the entire quest cache when tab 0 (All) arrives", () => {
    const staleDaily = createQuest(201, "daily", { quest_type: 1 });
    const staleWeekly = createQuest(216, "weekly", {
      quest_type: 2,
      label_type: 3,
    });
    const currentMonthly = createQuest(301, "monthly", {
      quest_type: 3,
      label_type: 6,
    });

    const previous = createQuestList(
      { 201: staleDaily, 216: staleWeekly },
      {},
      2,
    );
    const incoming = createQuestList({ 301: currentMonthly }, {}, 0);

    const merged = mergeQuestState(previous, incoming);
    expect(merged.quests).toEqual({ 301: currentMonthly });
  });

  it("reconciles active quests on tab 9 while keeping cached available quests", () => {
    const availableDaily = createQuest(203, "available", {
      quest_type: 1,
      state: 1,
    });
    const staleAccepted = createQuest(204, "stale active", {
      quest_type: 1,
      state: 2,
    });
    const claimableBefore = createQuest(205, "achieved daily", {
      quest_type: 1,
      state: 3,
      progress_flag: 3,
    });
    const currentAccepted = createQuest(216, "current active", {
      quest_type: 2,
      label_type: 3,
      state: 2,
    });

    const t1 = jstMs("2026-11-10T10:00:00");
    const t2 = jstMs("2026-11-10T10:30:00");

    const previous = createQuestList(
      { 203: availableDaily, 204: staleAccepted, 205: claimableBefore },
      {},
      1,
      t1,
    );
    const incoming = createQuestList({ 216: currentAccepted }, {}, 9, t2);

    const merged = mergeQuestState(previous, incoming);
    expect(merged.quests).toEqual({
      203: availableDaily,
      216: currentAccepted,
    });
    expect(merged.clearedQuests[205]?.quest.state).toBe(3);
  });

  it("moves completed quests via QuestEvent and expires them after JST 05:00 reset", () => {
    const tDay1 = jstMs("2026-11-10T22:00:00");
    const tClear = jstMs("2026-11-10T22:15:00");
    const tAfterDailyReset = jstMs("2026-11-11T05:05:00");

    const dailyQuest = createQuest(201, "Daily Sortie", {
      quest_type: 1,
      label_type: 2,
      state: 3,
      progress_flag: 3,
    });
    const weeklyQuest = createQuest(216, "Weekly Sortie", {
      quest_type: 2,
      label_type: 3,
      state: 2,
    });

    let state = mergeQuestState(
      createEmptyQuestCacheState(),
      createQuestList({ 201: dailyQuest, 216: weeklyQuest }, {}, 0, tDay1),
    );

    const completeEvent: QuestEvent = {
      timestamp: tClear,
      event_type: "complete",
      quest_id: 201,
    };
    state = applyQuestEventToState(state, completeEvent);
    expect(state.quests[201]).toBeUndefined();
    expect(state.clearedQuests[201]?.quest.title).toBe("Daily Sortie");

    // Weekly tab update before daily reset preserves cleared daily quest and other non-expired quests
    state = mergeQuestState(
      state,
      createQuestList({ 216: weeklyQuest }, {}, 2, tClear + 1000),
    );
    expect(state.clearedQuests[201]).toBeDefined();

    // Opening Weekly tab after 05:00 JST expires daily cleared record while keeping weekly quest
    state = mergeQuestState(
      state,
      createQuestList({ 216: weeklyQuest }, {}, 2, tAfterDailyReset),
    );
    expect(state.clearedQuests[201]).toBeUndefined();
    expect(state.quests[216]).toBeDefined();
  });

  it("handles start and stop events cleanly", () => {
    const q = createQuest(301, "Exercise", { quest_type: 1, state: 1 });
    let state = mergeQuestState(
      createEmptyQuestCacheState(),
      createQuestList({ 301: q }, {}, 1, jstMs("2026-11-10T10:00:00")),
    );

    state = applyQuestEventToState(state, {
      timestamp: jstMs("2026-11-10T10:01:00"),
      event_type: "start",
      quest_id: 301,
    });
    expect(state.quests[301]?.state).toBe(2);

    state = applyQuestEventToState(state, {
      timestamp: jstMs("2026-11-10T10:02:00"),
      event_type: "stop",
      quest_id: 301,
    });
    expect(state.quests[301]?.state).toBe(1);
  });

  it("removes deleted period keys cleanly under SolidJS createStore + reconcile(unwrap(...))", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore<QuestCacheState>(
        createEmptyQuestCacheState(),
      );
      const t = jstMs("2026-11-10T11:00:00");
      const d1 = createQuest(201, "daily 1", { quest_type: 1, state: 2 });
      const d2 = createQuest(202, "daily 2", { quest_type: 1, state: 1 });
      const w1 = createQuest(214, "weekly 1", {
        quest_type: 2,
        label_type: 3,
        state: 2,
      });

      setStore(
        reconcile(
          mergeQuestState(
            unwrap(store),
            createQuestList({ 201: d1, 202: d2 }, {}, 1, t),
          ),
        ),
      );
      setStore(
        reconcile(
          mergeQuestState(
            unwrap(store),
            createQuestList({ 214: w1 }, {}, 2, t + 1000),
          ),
        ),
      );
      const initialSnapshot = unwrap(store);
      expect(Object.keys(initialSnapshot.quests).map(Number).sort()).toEqual([
        201, 202, 214,
      ]);

      // Replacing Daily (tab 1) with only d2 must delete d1 inside the reactive store while preserving w1
      setStore(
        reconcile(
          mergeQuestState(
            unwrap(store),
            createQuestList({ 202: d2 }, {}, 1, t + 2000),
          ),
        ),
      );
      const afterReplace = unwrap(store);
      expect(afterReplace.quests[201]).toBeUndefined();
      expect(afterReplace.quests[202]?.title).toBe("daily 2");
      expect(afterReplace.quests[214]?.title).toBe("weekly 1");

      // Completing d2 moves it out of quests and into clearedQuests inside reactive store
      setStore(
        reconcile(
          applyQuestEventToState(unwrap(store), {
            timestamp: t + 3000,
            event_type: "complete",
            quest_id: 202,
          }),
        ),
      );
      const afterComplete = unwrap(store);
      expect(afterComplete.quests[202]).toBeUndefined();
      expect(afterComplete.clearedQuests[202]?.quest.title).toBe("daily 2");
      dispose();
    });
  });

  it("filters quests by number, title, detail, period label, and completion status", () => {
    const items = [
      {
        no: 201,
        title: "敵艦隊を撃破せよ！",
        detail: "艦隊を出撃させ、敵艦隊を捕捉せよ！",
        quest_type: 1,
        label_type: 2,
      },
      {
        no: 216,
        title: "敵艦隊主力を撃滅せよ！",
        detail: "敵艦隊主力との交戦を敢行せよ！",
        quest_type: 2,
        label_type: 3,
      },
      {
        no: 402,
        title: "「遠征」を3回成功させよう！",
        detail: "本日中に遠征を3回以上成功させよ！",
        quest_type: 3,
        label_type: 6,
        completionStatus: "claimable",
      },
    ];

    expect(getQuestPeriodLabel(1, 2)).toBe("Daily");
    expect(getQuestPeriodLabel(5, 7)).toBe("Quarterly");
    expect(getQuestPeriodLabel(5, 105)).toBe("Yearly");

    expect(filterQuestList(items, "")).toHaveLength(3);
    expect(filterQuestList(items, "216").map((q) => q.no)).toEqual([216]);
    expect(filterQuestList(items, "演習")).toEqual([]);
    expect(filterQuestList(items, "遠征").map((q) => q.no)).toEqual([402]);
    expect(filterQuestList(items, "daily").map((q) => q.no)).toEqual([201]);
    expect(filterQuestList(items, "CLAIMABLE").map((q) => q.no)).toEqual([402]);
  });
});
