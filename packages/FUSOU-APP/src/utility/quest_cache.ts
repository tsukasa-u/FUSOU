import type { Quests } from "@ipc-bindings/quest";

type QuestCollection<T> = { [key: number]: T | undefined };

function mergeQuestEntries<T>(
  previous: QuestCollection<T>,
  updates: QuestCollection<T>,
): QuestCollection<T> {
  const merged = { ...previous };
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined && value !== null) {
      merged[Number(key)] = value;
    }
  }
  return merged;
}

export function mergeQuestCache(previous: Quests, incoming: Quests): Quests {
  return {
    ...incoming,
    quests: mergeQuestEntries(previous.quests, incoming.quests),
    completed: mergeQuestEntries(previous.completed, incoming.completed),
  };
}
