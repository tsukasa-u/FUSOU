import { describe, expect, it } from "vitest";
import type { Quest, QuestCompletion, Quests } from "@ipc-bindings/quest";
import { mergeQuestCache } from "./quest_cache";

function createQuest(no: number, title: string): Quest {
  return {
    no,
    category: 1,
    quest_type: 1,
    label_type: 1,
    state: 2,
    title,
    detail: "",
    voice_id: 0,
    get_material: [],
    bonus_flag: 0,
    progress_flag: 0,
    invalid_flag: 0,
    lost_badges: null,
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
  completed: Quests["completed"],
): Quests {
  return {
    timestamp: 1,
    page_no: 1,
    count: Object.keys(quests).length,
    completed_kind: 0,
    exec_count: 0,
    exec_type: 0,
    quests,
    completed,
  };
}

describe("mergeQuestCache", () => {
  it("preserves quests from other tabs and replaces records with matching IDs", () => {
    const daily = createQuest(1, "daily");
    const oldMonthly = createQuest(2, "old monthly");
    const updatedMonthly = createQuest(2, "monthly");
    const previous = createQuestList(
      { 1: daily, 2: oldMonthly },
      { 1: createCompletion(1, 1) },
    );
    const incoming = createQuestList(
      { 2: updatedMonthly },
      { 2: createCompletion(2, 2) },
    );

    expect(mergeQuestCache(previous, incoming)).toEqual({
      ...incoming,
      quests: { 1: daily, 2: updatedMonthly },
      completed: {
        1: createCompletion(1, 1),
        2: createCompletion(2, 2),
      },
    });
  });
});
