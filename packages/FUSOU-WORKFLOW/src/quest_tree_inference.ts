type D1DatabaseLike = D1Database;

type InferenceTask = {
  task_id: string;
  dataset_id: string;
  collection_session_id: string;
  from_ts: number;
  to_ts: number;
  status: string;
  retry_count: number;
};

type AppearanceEvent = {
  dataset_id: string;
  collection_session_id: string;
  target_quest_id: number;
  appeared_at_ms: number;
  period_tag: string;
  table_version: string;
  is_bootstrap_unknown: number;
};

type CandidateMetric = {
  prereq: number[];
  support: number;
  exposure: number;
  confidence: number;
  lift: number;
  score: number;
  setSize: number;
};

const RECENT_WINDOW_MS = 10 * 60 * 1000;
const MIN_OBS_SINGLE = 8;
const MIN_OBS_PAIR = 6;
const MIN_CONF_SINGLE = 0.55;
const MIN_CONF_PAIR = 0.65;
const MAX_TASK_RETRY_COUNT = 8;
const STALE_TASK_MS = 30 * 60 * 1000;
const MAX_STORED_PREREQUISITES = 20;
const MAX_SINGLE_CANDIDATES = 10;
const MAX_PAIR_QUESTS = 15;
const MAX_SAVED_CANDIDATES = 30;

function nowMs(): number {
  return Date.now();
}

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

function makeId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${random}`;
}

function combinationsOfTwo(values: number[]): number[][] {
  const pairs: number[][] = [];
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      const left = values[i];
      const right = values[j];
      if (left === undefined || right === undefined) continue;
      pairs.push([left, right]);
    }
  }
  return pairs;
}

function calcScore(support: number, exposure: number, confidence: number, lift: number): number {
  const alpha = 1;
  const beta = 3;
  const confidenceShrunk = (support + alpha) / (exposure + alpha + beta);
  return confidenceShrunk * lift;
}

function prereqHash(ids: number[]): string {
  return ids.join("+");
}

async function getCompletedAndRecentSets(
  db: D1DatabaseLike,
  datasetId: string,
  sessionId: string,
  atMs: number,
): Promise<{
  candidatePrerequisites: number[];
  recent: number[];
  hasCrossSessionInference: boolean;
}> {
  // Intentionally query full dataset history up to atMs.
  // Quests are often one-time completable, so period-only filtering would erase valid prerequisites.
  const rows = ((await db
    .prepare(
      `SELECT quest_id, event_type, timestamp_ms, collection_session_id
       FROM (
         SELECT quest_id, event_type, timestamp_ms, collection_session_id,
                ROW_NUMBER() OVER (PARTITION BY quest_id ORDER BY timestamp_ms DESC, id DESC) AS position
         FROM quest_state_events WHERE dataset_id = ? AND timestamp_ms <= ?
       ) WHERE position = 1
       ORDER BY timestamp_ms ASC`
    )
    .bind(datasetId, atMs)
    .all<{ quest_id: number; event_type: string; timestamp_ms: number; collection_session_id: string }>())
    .results ?? []);

  const latestByQuest = new Map<number, { eventType: string; ts: number; sessionId: string }>();
  const recent = new Set<number>();

  for (const row of rows) {
    const qid = toInt(row.quest_id);
    const ts = toInt(row.timestamp_ms);
    if (qid == null || ts == null) continue;
    latestByQuest.set(qid, {
      eventType: row.event_type,
      ts,
      sessionId: row.collection_session_id,
    });
    if (row.event_type === "complete" && atMs - ts <= RECENT_WINDOW_MS) {
      recent.add(qid);
    }
  }

  let hasCrossSessionInference = false;
  for (const [questId, info] of latestByQuest.entries()) {
    if (info.eventType === "complete") {
      if (info.sessionId !== sessionId) {
        hasCrossSessionInference = true;
      }
    }
  }

  const candidatePrerequisites = [...latestByQuest.entries()]
    .filter(
      ([questId, info]) =>
        info.eventType === "complete" &&
        (recent.has(questId) || info.sessionId === sessionId),
    )
    .sort(([, left], [, right]) => right.ts - left.ts)
    .slice(0, MAX_STORED_PREREQUISITES)
    .map(([questId]) => questId)
    .sort((a, b) => a - b);

  return {
    candidatePrerequisites,
    recent: [...recent].sort((a, b) => a - b),
    hasCrossSessionInference,
  };
}

async function recomputeRulesForTarget(
  db: D1DatabaseLike,
  targetQuestId: number,
  periodTag: string,
  tableVersion: string,
): Promise<void> {
  const occurrenceRows = ((await db
    .prepare(
      `SELECT o.occurrence_id, p.quest_id, p.is_recent
       FROM quest_occurrence_contexts o
       LEFT JOIN quest_occurrence_prerequisites p
         ON p.occurrence_id = o.occurrence_id AND p.is_completed = 1
       WHERE o.target_quest_id = ?
         AND o.period_tag = ?
         AND o.table_version = ?
         AND o.is_bootstrap_unknown = 0
       ORDER BY o.occurrence_id, p.quest_id ASC`
    )
    .bind(targetQuestId, periodTag, tableVersion)
    .all<{
      occurrence_id: string;
      quest_id: number | null;
      is_recent: number | null;
    }>())
    .results ?? []);

  const prerequisitesByOccurrence = new Map<string, number[]>();
  const recentCount = new Map<number, number>();
  for (const row of occurrenceRows) {
    const occurrencePrerequisites =
      prerequisitesByOccurrence.get(row.occurrence_id) ?? [];
    prerequisitesByOccurrence.set(row.occurrence_id, occurrencePrerequisites);

    const questId = toInt(row.quest_id);
    if (questId == null || questId === targetQuestId) continue;
    occurrencePrerequisites.push(questId);
    if (row.is_recent === 1) {
      recentCount.set(questId, (recentCount.get(questId) ?? 0) + 1);
    }
  }

  const totalOccurrences = prerequisitesByOccurrence.size;
  if (totalOccurrences === 0) {
    await db
      .prepare(
        `DELETE FROM quest_rule_candidates
         WHERE target_quest_id = ? AND period_tag = ? AND table_version = ?`
      )
      .bind(targetQuestId, periodTag, tableVersion)
      .run();
    await db
      .prepare(
        `DELETE FROM quest_rule_edges
         WHERE target_quest_id = ? AND period_tag = ? AND table_version = ?`
      )
      .bind(targetQuestId, periodTag, tableVersion)
      .run();
    return;
  }

  const singleCount = new Map<string, number>();
  const pairCount = new Map<string, number>();

  for (const occurrencePrerequisites of prerequisitesByOccurrence.values()) {
    const ids = [...new Set(occurrencePrerequisites)].sort((a, b) => a - b);
    for (const id of ids) {
      const key = prereqHash([id]);
      singleCount.set(key, (singleCount.get(key) ?? 0) + 1);
    }
  }

  const rankedSingles = [...singleCount.entries()]
    .map(([key, support]) => {
      const [questId] = key.split("+").map(Number);
      return {
        prereq: [questId ?? 0],
        support,
        recentSupport: recentCount.get(questId ?? 0) ?? 0,
      };
    })
    .sort(
      (left, right) =>
        right.support - left.support ||
        right.recentSupport - left.recentSupport ||
        (left.prereq[0] ?? 0) - (right.prereq[0] ?? 0),
    );

  const pairQuestIds = rankedSingles
    .slice(0, MAX_PAIR_QUESTS)
    .map((candidate) => candidate.prereq[0])
    .filter((questId): questId is number => questId != null);
  const pairQuestSet = new Set(pairQuestIds);
  for (const occurrencePrerequisites of prerequisitesByOccurrence.values()) {
    const ids = [...new Set(occurrencePrerequisites)]
      .filter((questId) => pairQuestSet.has(questId))
      .sort((a, b) => a - b);
    for (const pair of combinationsOfTwo(ids)) {
      const key = prereqHash(pair);
      pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
    }
  }

  const candidateSets = [
    ...rankedSingles.slice(0, MAX_SINGLE_CANDIDATES).map((candidate) => ({
      prereq: candidate.prereq,
      support: candidate.support,
      setSize: 1,
    })),
    ...[...pairCount.entries()]
      .filter(([, support]) => support >= 2)
      .map(([key, support]) => ({
        prereq: key.split("+").map(Number),
        support,
        setSize: 2,
      })),
  ];

  const candidateQuestIds = [
    ...new Set(candidateSets.flatMap((candidate) => candidate.prereq)),
  ].sort((a, b) => a - b);
  const exposureRows =
    candidateQuestIds.length === 0
      ? []
      : ((await db
          .prepare(
            `SELECT p.quest_id, p.occurrence_id
             FROM quest_occurrence_prerequisites p
             JOIN quest_occurrence_contexts o ON o.occurrence_id = p.occurrence_id
             WHERE o.period_tag = ?
               AND o.table_version = ?
               AND o.is_bootstrap_unknown = 0
               AND p.is_completed = 1
               AND p.quest_id IN (${candidateQuestIds.map(() => "?").join(", ")})`,
          )
          .bind(periodTag, tableVersion, ...candidateQuestIds)
          .all<{ quest_id: number; occurrence_id: string }>()).results ?? []);
  const occurrenceIdsByQuest = new Map<number, Set<string>>();
  for (const row of exposureRows) {
    const ids = occurrenceIdsByQuest.get(row.quest_id) ?? new Set<string>();
    ids.add(row.occurrence_id);
    occurrenceIdsByQuest.set(row.quest_id, ids);
  }

  const exposureFor = (prereq: number[]): number => {
    const firstId = prereq[0];
    if (firstId == null) return 1;
    const firstSet = occurrenceIdsByQuest.get(firstId) ?? new Set<string>();
    if (prereq.length === 1) return Math.max(1, firstSet.size);

    const secondId = prereq[1];
    if (secondId == null) return 1;
    const secondSet = occurrenceIdsByQuest.get(secondId) ?? new Set<string>();
    const [smaller, larger] =
      firstSet.size <= secondSet.size
        ? [firstSet, secondSet]
        : [secondSet, firstSet];
    let intersectionSize = 0;
    for (const occurrenceId of smaller) {
      if (larger.has(occurrenceId)) intersectionSize += 1;
    }
    return Math.max(1, intersectionSize);
  };

  const allAppearanceCountRow = (await db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM quest_appearance_events
       WHERE period_tag = ? AND table_version = ?`
    )
    .bind(periodTag, tableVersion)
    .first<{ c?: number }>());

  const allAppearanceCount = Math.max(1, toInt(allAppearanceCountRow?.c) ?? totalOccurrences);
  const baseRate = totalOccurrences / allAppearanceCount;

  const candidates: CandidateMetric[] = candidateSets.map(
    ({ prereq, support, setSize }) => {
      const exposure = exposureFor(prereq);
    const confidence = support / exposure;
    const lift = baseRate > 0 ? confidence / baseRate : confidence;
    const score = calcScore(support, exposure, confidence, lift);
      return { prereq, support, exposure, confidence, lift, score, setSize };
    },
  );
  candidates.sort((a, b) => b.score - a.score);
  const savedCandidates = candidates.slice(0, MAX_SAVED_CANDIDATES);

  const candidateByHash = new Map<string, CandidateMetric>();
  for (const candidate of savedCandidates) {
    candidateByHash.set(prereqHash(candidate.prereq), candidate);
  }
  const bestSingle =
    savedCandidates.find((candidate) => candidate.setSize === 1) ?? null;
  const bestPair =
    savedCandidates.find((candidate) => candidate.setSize === 2) ?? null;

  const nowForCandidates = nowMs();
  const publishStatements = [
    db
      .prepare(
        `DELETE FROM quest_rule_candidates
         WHERE target_quest_id = ? AND period_tag = ? AND table_version = ?`
      )
      .bind(targetQuestId, periodTag, tableVersion),
    db
      .prepare(
        `DELETE FROM quest_rule_edges
         WHERE target_quest_id = ? AND period_tag = ? AND table_version = ?`
      )
      .bind(targetQuestId, periodTag, tableVersion),
  ];

  // Prepare one INSERT per row so each statement stays well below Cloudflare D1's
  // 100 bound-parameter limit while still publishing atomically in a single db.batch().
  for (const candidate of savedCandidates) {
    const prereqJson = JSON.stringify(candidate.prereq);
    const hash = prereqHash(candidate.prereq);
    publishStatements.push(
      db
        .prepare(
          `INSERT INTO quest_rule_candidates (
             target_quest_id, prereq_set_hash, prereq_set_json, set_size,
             support, exposure, confidence, lift, score, period_tag,
             table_version, quality_tier, updated_at_ms
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          targetQuestId,
          hash,
          prereqJson,
          candidate.setSize,
          candidate.support,
          candidate.exposure,
          candidate.confidence,
          candidate.lift,
          candidate.score,
          periodTag,
          tableVersion,
          "high",
          nowForCandidates,
        ),
    );
  }

  let primaryPairHash: string | null = null;
  let primarySingleHash: string | null = null;

  if (
    bestPair &&
    bestPair.support >= MIN_OBS_PAIR &&
    bestPair.confidence >= MIN_CONF_PAIR &&
    (() => {
      const [leftId, rightId] = bestPair.prereq;
      if (leftId === undefined || rightId === undefined) return false;
      const left = candidateByHash.get(prereqHash([leftId]));
      const right = candidateByHash.get(prereqHash([rightId]));
      const leftScore = left?.score ?? 0;
      const rightScore = right?.score ?? 0;
      return bestPair.score > leftScore && bestPair.score > rightScore;
    })()
  ) {
    primaryPairHash = prereqHash(bestPair.prereq);
  } else if (
    bestSingle &&
    bestSingle.support >= MIN_OBS_SINGLE &&
    bestSingle.confidence >= MIN_CONF_SINGLE
  ) {
    primarySingleHash = prereqHash(bestSingle.prereq);
  }

  const nowForEdges = nowMs();
  for (const candidate of savedCandidates) {
    const prereqJson = JSON.stringify(candidate.prereq);
    const hash = prereqHash(candidate.prereq);

    let className = "candidate_hold";
    if (candidate.setSize === 1) {
      if (candidate.support >= MIN_OBS_SINGLE && candidate.confidence >= MIN_CONF_SINGLE) {
        className = "accepted_secondary";
      }
    } else if (candidate.setSize === 2) {
      if (candidate.support >= MIN_OBS_PAIR && candidate.confidence >= MIN_CONF_PAIR) {
        className = "accepted_secondary";
      }
    }

    const isPrimary = primaryPairHash === hash || primarySingleHash === hash ? 1 : 0;
    if (isPrimary) className = "accepted_primary";

    publishStatements.push(
      db
        .prepare(
          `INSERT INTO quest_rule_edges (
             rule_id, target_quest_id, prereq_set_json, set_size, class,
             support, confidence, lift, score, period_tag, table_version,
             is_primary, quality_tier, updated_at_ms
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          makeId("qrule"),
          targetQuestId,
          prereqJson,
          candidate.setSize,
          className,
          candidate.support,
          candidate.confidence,
          candidate.lift,
          candidate.score,
          periodTag,
          tableVersion,
          isPrimary,
          "high",
          nowForEdges,
        ),
    );
  }

  // Publish a target's candidates and edges in one D1 transaction.
  await db.batch(publishStatements);
}

async function processTask(
  db: D1DatabaseLike,
  task: InferenceTask,
): Promise<Set<string>> {
  const appearances = ((await db
    .prepare(
      `SELECT dataset_id, collection_session_id, target_quest_id, appeared_at_ms, period_tag, table_version, is_bootstrap_unknown
       FROM quest_appearance_events
       WHERE dataset_id = ?
         AND collection_session_id = ?
         AND appeared_at_ms >= ?
         AND appeared_at_ms < ?
       ORDER BY appeared_at_ms ASC`
    )
    .bind(task.dataset_id, task.collection_session_id, task.from_ts, task.to_ts)
    .all<AppearanceEvent>())
    .results ?? []);

  const touchedTargets = new Set<string>();

  for (const appearance of appearances) {
    const occurrenceId = `${appearance.collection_session_id}:${appearance.target_quest_id}:${appearance.appeared_at_ms}`;

    const sets = await getCompletedAndRecentSets(
      db,
      appearance.dataset_id,
      appearance.collection_session_id,
      appearance.appeared_at_ms,
    );

    const occurrenceStatements = [db
      .prepare(
        `INSERT INTO quest_occurrence_contexts (
           occurrence_id,
           dataset_id,
           collection_session_id,
           target_quest_id,
           occurred_at_ms,
           period_tag,
           table_version,
           is_bootstrap_unknown,
           has_cross_session_inference,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(occurrence_id) DO NOTHING`
      )
      .bind(
        occurrenceId,
        appearance.dataset_id,
        appearance.collection_session_id,
        appearance.target_quest_id,
        appearance.appeared_at_ms,
        appearance.period_tag,
        appearance.table_version,
        appearance.is_bootstrap_unknown,
        sets.hasCrossSessionInference ? 1 : 0,
        nowMs(),
      )
    ];
    occurrenceStatements.push(db.prepare(
      "DELETE FROM quest_occurrence_prerequisites WHERE occurrence_id = ?",
    ).bind(occurrenceId));

    for (const questId of sets.candidatePrerequisites) {
      occurrenceStatements.push(db
        .prepare(
          `INSERT OR IGNORE INTO quest_occurrence_prerequisites (
             occurrence_id,
             quest_id,
             is_recent,
             is_completed,
             created_at
           ) VALUES (?, ?, ?, 1, ?)`
        )
        .bind(occurrenceId, questId, sets.recent.includes(questId) ? 1 : 0, nowMs())
      );
    }
    await db.batch(occurrenceStatements);

    touchedTargets.add(`${appearance.target_quest_id}:${appearance.period_tag}:${appearance.table_version}`);
  }

  return touchedTargets;
}

export async function runQuestInferenceTasks(
  db: D1DatabaseLike,
  options?: { datasetId?: string; limit?: number },
): Promise<{ picked: number; completed: number; failed: number }> {
  const datasetId = (options?.datasetId ?? "").trim();
  const limit = Math.max(1, Math.min(200, options?.limit ?? 100));

  const now = nowMs();
  const recovered = await db.prepare(`
    UPDATE quest_inference_tasks
    SET status = 'failed', retry_count = retry_count + 1,
        error_message = 'Recovered stale running task', updated_at = ?
    WHERE status = 'running' AND updated_at < ?
  `).bind(now, now - STALE_TASK_MS).run();
  if (recovered.meta.changes) console.warn("[QuestInference] Recovered stale tasks", recovered.meta.changes);
  let tasks: InferenceTask[];
  if (datasetId) {
    const result = await db
      .prepare(
        `WITH picked AS (
           SELECT task_id
           FROM quest_inference_tasks
           WHERE status IN ('pending', 'failed')
             AND retry_count < ?
             AND dataset_id = ?
           ORDER BY created_at ASC
           LIMIT ?
         )
         UPDATE quest_inference_tasks
         SET status = 'running', updated_at = ?
         WHERE task_id IN (SELECT task_id FROM picked)
         RETURNING task_id, dataset_id, collection_session_id, from_ts, to_ts, status, retry_count`
      )
      .bind(MAX_TASK_RETRY_COUNT, datasetId, limit, now)
      .all<InferenceTask>();
    tasks = result.results ?? [];
  } else {
    const result = await db
      .prepare(
        `WITH picked AS (
           SELECT task_id
           FROM quest_inference_tasks
           WHERE status IN ('pending', 'failed')
             AND retry_count < ?
           ORDER BY created_at ASC
           LIMIT ?
         )
         UPDATE quest_inference_tasks
         SET status = 'running', updated_at = ?
         WHERE task_id IN (SELECT task_id FROM picked)
         RETURNING task_id, dataset_id, collection_session_id, from_ts, to_ts, status, retry_count`
      )
      .bind(MAX_TASK_RETRY_COUNT, limit, now)
      .all<InferenceTask>();
    tasks = result.results ?? [];
  }

  const successfulTasks: InferenceTask[] = [];
  const taskErrors = new Map<string, string>();
  const tasksByTarget = new Map<string, Set<string>>();
  const allTouchedTargets = new Set<string>();

  for (const task of tasks) {
    try {
      const touchedTargets = await processTask(db, task);
      successfulTasks.push(task);
      for (const key of touchedTargets) {
        allTouchedTargets.add(key);
        const taskIds = tasksByTarget.get(key) ?? new Set<string>();
        taskIds.add(task.task_id);
        tasksByTarget.set(key, taskIds);
      }
    } catch (err) {
      taskErrors.set(task.task_id, err instanceof Error ? err.message : String(err));
    }
  }

  for (const key of allTouchedTargets) {
    const [targetStr, periodTag, tableVersion] = key.split(":");
    const targetQuestId = Number(targetStr);
    if (
      !Number.isFinite(targetQuestId) ||
      periodTag === undefined ||
      tableVersion === undefined
    ) {
      continue;
    }
    try {
      await recomputeRulesForTarget(db, targetQuestId, periodTag, tableVersion);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      for (const taskId of tasksByTarget.get(key) ?? []) {
        taskErrors.set(taskId, message);
      }
    }
  }

  let completed = 0;
  let failed = 0;
  for (const task of successfulTasks) {
    const errorMessage = taskErrors.get(task.task_id);
    if (errorMessage !== undefined) {
      await db
        .prepare(
          `UPDATE quest_inference_tasks
           SET status = 'failed', retry_count = retry_count + 1, error_message = ?, updated_at = ?
           WHERE task_id = ?`,
        )
        .bind(errorMessage, nowMs(), task.task_id)
        .run();
      failed += 1;
      continue;
    }

    await db
      .prepare(
        `UPDATE quest_inference_tasks SET status = 'completed', updated_at = ? WHERE task_id = ?`,
      )
      .bind(nowMs(), task.task_id)
      .run();
    completed += 1;
  }

  for (const [taskId, errorMessage] of taskErrors) {
    if (successfulTasks.some((task) => task.task_id === taskId)) continue;
    await db
      .prepare(
        `UPDATE quest_inference_tasks
         SET status = 'failed', retry_count = retry_count + 1, error_message = ?, updated_at = ?
         WHERE task_id = ?`,
      )
      .bind(errorMessage, nowMs(), taskId)
      .run();
    failed += 1;
  }

  return { picked: tasks.length, completed, failed };
}
