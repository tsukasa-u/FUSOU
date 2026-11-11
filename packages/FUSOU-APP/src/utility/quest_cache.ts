import type {
  Quest,
  QuestCompletion,
  QuestEvent,
  Quests,
} from "@ipc-bindings/quest";

type QuestCollection<T> = { [key: number]: T | undefined };

export type ClearedQuestRecord = {
  quest: Quest;
  completedAt: number;
};

export type QuestCacheState = Quests & {
  clearedQuests: { [key: number]: ClearedQuestRecord | undefined };
  periodTimestamps: { [key: number]: number | undefined };
};

export type QuestLikeState = Quests & {
  clearedQuests?: { [key: number]: ClearedQuestRecord | undefined };
  periodTimestamps?: { [key: number]: number | undefined };
};

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function jstToEpochMs(
  year: number,
  monthZeroBased: number,
  day: number,
  hour = 5,
): number {
  return Date.UTC(year, monthZeroBased, day, hour, 0, 0, 0) - JST_OFFSET_MS;
}

/**
 * Returns the latest KanColle quest reset boundary (05:00 JST) at or before `nowMs`
 * for periodic quest types, or `null` for non-periodic quests.
 */
export function getLatestQuestResetBoundaryMs(
  questType: number,
  labelType: number,
  nowMs: number,
): number | null {
  const jst = new Date(nowMs + JST_OFFSET_MS);
  const year = jst.getUTCFullYear();
  const month = jst.getUTCMonth();
  const day = jst.getUTCDate();

  switch (questType) {
    case 1: {
      // Daily: 05:00 JST every day
      const todayReset = jstToEpochMs(year, month, day, 5);
      return nowMs >= todayReset
        ? todayReset
        : jstToEpochMs(year, month, day - 1, 5);
    }
    case 2: {
      // Weekly: Monday 05:00 JST
      const daysSinceMonday = (jst.getUTCDay() + 6) % 7;
      const mondayReset = jstToEpochMs(year, month, day - daysSinceMonday, 5);
      return nowMs >= mondayReset
        ? mondayReset
        : jstToEpochMs(year, month, day - daysSinceMonday - 7, 5);
    }
    case 3: {
      // Monthly: 1st of month 05:00 JST
      const firstReset = jstToEpochMs(year, month, 1, 5);
      return nowMs >= firstReset
        ? firstReset
        : jstToEpochMs(year, month - 1, 1, 5);
    }
    case 5: {
      // Quarterly: Mar 1, Jun 1, Sep 1, Dec 1 at 05:00 JST
      if (labelType === 7) {
        if (month < 2) {
          return jstToEpochMs(year - 1, 11, 1, 5);
        }
        const quarterStartMonth = Math.floor((month - 2) / 3) * 3 + 2;
        const candidate = jstToEpochMs(year, quarterStartMonth, 1, 5);
        return nowMs >= candidate
          ? candidate
          : jstToEpochMs(year, quarterStartMonth - 3, 1, 5);
      }
      // Yearly: 1st of month (labelType - 100) at 05:00 JST
      if (labelType >= 101 && labelType <= 112) {
        const resetMonth = labelType - 101;
        const candidate = jstToEpochMs(year, resetMonth, 1, 5);
        return nowMs >= candidate
          ? candidate
          : jstToEpochMs(year - 1, resetMonth, 1, 5);
      }
      return null;
    }
    default:
      return null;
  }
}

export function isQuestPeriodExpired(
  lastSeenMs: number | undefined,
  questType: number,
  labelType: number,
  nowMs: number,
): boolean {
  if (lastSeenMs === undefined || lastSeenMs === null) return false;
  const boundary = getLatestQuestResetBoundaryMs(questType, labelType, nowMs);
  return boundary !== null && lastSeenMs < boundary;
}

export function createEmptyQuestCacheState(): QuestCacheState {
  return {
    timestamp: null,
    page_no: 0,
    count: 0,
    completed_kind: 0,
    exec_count: 0,
    exec_type: 0,
    quests: {},
    completed: {},
    clearedQuests: {},
    periodTimestamps: {},
  };
}

function shouldReplaceQuestOnTab(prevQuest: Quest, tabId: number): boolean {
  if (tabId === 0) return true;
  if (tabId >= 1 && tabId <= 5) return prevQuest.quest_type === tabId;
  if (tabId === 9) return prevQuest.state === 2 || prevQuest.state === 3;
  return false;
}

/**
 * Merges incoming `questlist` snapshots into cached quest state:
 * - Tab `0` (All) replaces every cached quest.
 * - Tabs `1..5` replace all cached quests matching that period/category (`quest_type === page_no`).
 * - Tab `9` (Active) reconciles active quests (`state === 2 | 3`) while preserving cached available quests.
 * - Periodic quests that crossed a JST 05:00 reset boundary are expired.
 * - Claimable (`state === 3`) quests that disappear within the same period are preserved in `clearedQuests`.
 */
export function mergeQuestState(
  previous: QuestLikeState,
  incoming: Quests,
): QuestCacheState {
  const nowMs = incoming.timestamp ?? Date.now();
  const tabId = incoming.page_no;

  const prevPeriodTimestamps = previous.periodTimestamps ?? {};
  const nextPeriodTimestamps: { [key: number]: number | undefined } = {
    ...prevPeriodTimestamps,
  };
  if (tabId === 0) {
    for (const typeId of [1, 2, 3, 4, 5]) {
      nextPeriodTimestamps[typeId] = nowMs;
    }
  } else if (tabId >= 1 && tabId <= 5) {
    nextPeriodTimestamps[tabId] = nowMs;
  }

  const incomingNos = new Set<number>();
  for (const [key, value] of Object.entries(incoming.quests)) {
    if (value !== undefined && value !== null) {
      incomingNos.add(value.no ?? Number(key));
    }
  }

  const nextCleared: { [key: number]: ClearedQuestRecord | undefined } = {};
  for (const [key, record] of Object.entries(previous.clearedQuests ?? {})) {
    if (!record) continue;
    const questNo = Number(key);
    if (incomingNos.has(questNo)) {
      // Re-appeared in questlist (either still claimable state=3 or re-unlocked next period).
      continue;
    }
    if (
      isQuestPeriodExpired(
        record.completedAt,
        record.quest.quest_type,
        record.quest.label_type,
        nowMs,
      )
    ) {
      continue;
    }
    nextCleared[questNo] = record;
  }

  const nextQuests: QuestCollection<Quest> = {};
  for (const [key, prevQuest] of Object.entries(previous.quests)) {
    if (!prevQuest) continue;
    const questNo = prevQuest.no ?? Number(key);
    if (incomingNos.has(questNo)) {
      continue;
    }

    const prevLastSeen =
      prevPeriodTimestamps[prevQuest.quest_type] ??
      previous.timestamp ??
      undefined;
    const expired = isQuestPeriodExpired(
      prevLastSeen,
      prevQuest.quest_type,
      prevQuest.label_type,
      nowMs,
    );
    if (expired) {
      continue;
    }

    if (shouldReplaceQuestOnTab(prevQuest, tabId)) {
      // Preserve claimable quests that vanished within the same reset period as turned-in cleared records.
      if (prevQuest.state === 3 && !nextCleared[questNo]) {
        nextCleared[questNo] = {
          quest: { ...prevQuest, state: 3, progress_flag: 3 },
          completedAt: nowMs,
        };
      }
      continue;
    }

    nextQuests[questNo] = prevQuest;
  }

  for (const [key, value] of Object.entries(incoming.quests)) {
    if (value !== undefined && value !== null) {
      nextQuests[value.no ?? Number(key)] = value;
    }
  }

  const nextCompleted: QuestCollection<QuestCompletion> = {};
  if (tabId !== 0) {
    for (const [key, value] of Object.entries(previous.completed)) {
      if (!value) continue;
      const questNo = Number(key);
      const prevQuest = previous.quests[questNo];
      if (tabId >= 1 && tabId <= 5 && prevQuest?.quest_type === tabId) {
        continue;
      }
      if (
        prevQuest &&
        isQuestPeriodExpired(
          prevPeriodTimestamps[prevQuest.quest_type] ??
            previous.timestamp ??
            undefined,
          prevQuest.quest_type,
          prevQuest.label_type,
          nowMs,
        )
      ) {
        continue;
      }
      nextCompleted[questNo] = value;
    }
  }
  for (const [key, value] of Object.entries(incoming.completed)) {
    if (value !== undefined && value !== null) {
      nextCompleted[Number(key)] = value;
    }
  }

  return {
    ...incoming,
    quests: nextQuests,
    completed: nextCompleted,
    clearedQuests: nextCleared,
    periodTimestamps: nextPeriodTimestamps,
  };
}

/**
 * Applies `api_req_quest/{start,stop,complete}` events immediately between `questlist` refreshes.
 */
export function applyQuestEventToState(
  previous: QuestLikeState,
  event: QuestEvent,
): QuestCacheState {
  const questId = event.quest_id;
  const nextQuests: QuestCollection<Quest> = { ...previous.quests };
  const nextCleared: { [key: number]: ClearedQuestRecord | undefined } = {
    ...(previous.clearedQuests ?? {}),
  };

  if (questId !== null && questId !== undefined) {
    const existing = nextQuests[questId];
    if (event.event_type === "complete") {
      delete nextQuests[questId];
      nextCleared[questId] = {
        quest: existing
          ? { ...existing, state: 3, progress_flag: 3 }
          : {
              no: questId,
              category: 0,
              quest_type: 0,
              label_type: 0,
              state: 3,
              title: `Quest #${questId}`,
              detail: "",
              voice_id: 0,
              get_material: [],
              bonus_flag: 0,
              progress_flag: 3,
              invalid_flag: 0,
              lost_badges: null,
            },
        completedAt: event.timestamp,
      };
    } else if (event.event_type === "start") {
      delete nextCleared[questId];
      if (existing) {
        nextQuests[questId] = { ...existing, state: 2 };
      }
    } else if (event.event_type === "stop") {
      delete nextCleared[questId];
      if (existing) {
        nextQuests[questId] = { ...existing, state: 1 };
      }
    }
  }

  return {
    timestamp: event.timestamp,
    page_no: previous.page_no,
    count: previous.count,
    completed_kind: previous.completed_kind,
    exec_count: previous.exec_count,
    exec_type: previous.exec_type,
    quests: nextQuests,
    completed: { ...previous.completed },
    clearedQuests: nextCleared,
    periodTimestamps: { ...(previous.periodTimestamps ?? {}) },
  };
}

/**
 * Returns display period badge label for a KanColle quest type and label type.
 */
export function getQuestPeriodLabel(
  questType: number,
  labelType: number,
): string | null {
  switch (questType) {
    case 1:
      return "Daily";
    case 2:
      return "Weekly";
    case 3:
      return "Monthly";
    case 4:
      return "Once";
    case 5:
      if (labelType === 7) return "Quarterly";
      if (labelType >= 101 && labelType <= 112) return "Yearly";
      return "Other";
    default:
      return null;
  }
}

export type FilterableQuestFields = {
  no: number;
  title: string;
  detail: string;
  quest_type: number;
  label_type: number;
  completionStatus?: string;
};

/**
 * Filters normalized quest entries against a search string matching number, title,
 * detail text, period badge, or completion status.
 */
export function filterQuestList<T extends FilterableQuestFields>(
  quests: readonly T[],
  query: string,
): T[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...quests];

  return quests.filter((q) => {
    if (q.title.toLowerCase().includes(normalized)) return true;
    if (q.detail.toLowerCase().includes(normalized)) return true;
    if (String(q.no).includes(normalized)) return true;
    const period = getQuestPeriodLabel(q.quest_type, q.label_type);
    if (period && period.toLowerCase().includes(normalized)) return true;
    if (
      q.completionStatus &&
      q.completionStatus.toLowerCase().includes(normalized)
    ) {
      return true;
    }
    return false;
  });
}

/**
 * Compatibility helper returning plain `Quests` payload after period-aware merging.
 */
export function mergeQuestCache(previous: Quests, incoming: Quests): Quests {
  const merged = mergeQuestState(previous, incoming);
  return {
    timestamp: merged.timestamp,
    page_no: merged.page_no,
    count: merged.count,
    completed_kind: merged.completed_kind,
    exec_count: merged.exec_count,
    exec_type: merged.exec_type,
    quests: merged.quests,
    completed: merged.completed,
  };
}
