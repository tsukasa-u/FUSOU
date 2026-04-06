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

function parseJsonArray<T>(raw: unknown): T[] {
  if (!raw || typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function combinationsOfTwo(values: number[]): number[][] {
  const pairs: number[][] = [];
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      pairs.push([values[i], values[j]]);
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
): Promise<{ completed: number[]; recent: number[]; hasCrossSessionInference: boolean }> {
  // Intentionally query full dataset history up to atMs.
  // Quests are often one-time completable, so period-only filtering would erase valid prerequisites.
  const rows = ((await db
    .prepare(
      `SELECT quest_id, event_type, timestamp_ms, collection_session_id
       FROM quest_state_events
       WHERE dataset_id = ?
         AND timestamp_ms <= ?
       ORDER BY timestamp_ms ASC`
    )
    .bind(datasetId, atMs)
    .all<{ quest_id: number; event_type: string; timestamp_ms: number; collection_session_id: string }>())
    .results ?? []) as Array<{
      quest_id: number;
      event_type: string;
      timestamp_ms: number;
      collection_session_id: string;
    }>;

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

  const completed: number[] = [];
  let hasCrossSessionInference = false;
  for (const [questId, info] of latestByQuest.entries()) {
    if (info.eventType === "complete") {
      completed.push(questId);
      if (info.sessionId !== sessionId) {
        hasCrossSessionInference = true;
      }
    }
  }

  completed.sort((a, b) => a - b);
  return { completed, recent: [...recent].sort((a, b) => a - b), hasCrossSessionInference };
}

async function getExposureForPrereq(
  db: D1DatabaseLike,
  prereq: number[],
  periodTag: string,
  tableVersion: string,
): Promise<number> {
  if (prereq.length === 1) {
    const row = (await db
      .prepare(
        `SELECT COUNT(DISTINCT o.occurrence_id) AS c
         FROM quest_occurrence_contexts o
         JOIN quest_occurrence_prerequisites p
           ON p.occurrence_id = o.occurrence_id
         WHERE o.period_tag = ?
           AND o.table_version = ?
           AND o.is_bootstrap_unknown = 0
           AND p.is_completed = 1
           AND p.quest_id = ?`
      )
      .bind(periodTag, tableVersion, prereq[0])
      .first<{ c?: number }>()) as { c?: number } | null;
    return Math.max(1, toInt(row?.c) ?? 0);
  }

  if (prereq.length === 2) {
    const row = (await db
      .prepare(
        `SELECT COUNT(DISTINCT o.occurrence_id) AS c
         FROM quest_occurrence_contexts o
         JOIN quest_occurrence_prerequisites p1
           ON p1.occurrence_id = o.occurrence_id
         JOIN quest_occurrence_prerequisites p2
           ON p2.occurrence_id = o.occurrence_id
         WHERE o.period_tag = ?
           AND o.table_version = ?
           AND o.is_bootstrap_unknown = 0
           AND p1.is_completed = 1
           AND p2.is_completed = 1
           AND p1.quest_id = ?
           AND p2.quest_id = ?`
      )
      .bind(periodTag, tableVersion, prereq[0], prereq[1])
      .first<{ c?: number }>()) as { c?: number } | null;
    return Math.max(1, toInt(row?.c) ?? 0);
  }

  return 1;
}

async function recomputeRulesForTarget(
  db: D1DatabaseLike,
  targetQuestId: number,
  periodTag: string,
  tableVersion: string,
): Promise<void> {
  const occurrences = ((await db
    .prepare(
      `SELECT occurrence_id
       FROM quest_occurrence_contexts
       WHERE target_quest_id = ?
         AND period_tag = ?
         AND table_version = ?
         AND is_bootstrap_unknown = 0`
    )
    .bind(targetQuestId, periodTag, tableVersion)
    .all<{ occurrence_id: string }>())
    .results ?? []) as Array<{ occurrence_id: string }>;

  const totalOccurrences = occurrences.length;
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

  for (const { occurrence_id: occurrenceId } of occurrences) {
    const prereqs = ((await db
      .prepare(
        `SELECT quest_id
         FROM quest_occurrence_prerequisites
         WHERE occurrence_id = ?
           AND is_completed = 1
         ORDER BY quest_id ASC`
      )
      .bind(occurrenceId)
      .all<{ quest_id: number }>())
      .results ?? []) as Array<{ quest_id: number }>;

    const ids = prereqs
      .map((row) => toInt(row.quest_id))
      .filter((v): v is number => v != null)
      .filter((v) => v !== targetQuestId);

    for (const id of ids) {
      const key = prereqHash([id]);
      singleCount.set(key, (singleCount.get(key) ?? 0) + 1);
    }
    for (const pair of combinationsOfTwo(ids)) {
      const key = prereqHash(pair);
      pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
    }
  }

  const allAppearanceCountRow = (await db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM quest_appearance_events
       WHERE period_tag = ? AND table_version = ?`
    )
    .bind(periodTag, tableVersion)
    .first<{ c?: number }>()) as { c?: number } | null;

  const allAppearanceCount = Math.max(1, toInt(allAppearanceCountRow?.c) ?? totalOccurrences);
  const baseRate = totalOccurrences / allAppearanceCount;

  const candidates: CandidateMetric[] = [];

  for (const [key, supportRaw] of singleCount.entries()) {
    const ids = key.split("+").map((s) => Number(s));
    const support = supportRaw;
    const exposure = await getExposureForPrereq(db, ids, periodTag, tableVersion);
    const confidence = support / exposure;
    const lift = baseRate > 0 ? confidence / baseRate : confidence;
    const score = calcScore(support, exposure, confidence, lift);
    candidates.push({ prereq: ids, support, exposure, confidence, lift, score, setSize: 1 });
  }

  for (const [key, supportRaw] of pairCount.entries()) {
    const ids = key.split("+").map((s) => Number(s));
    const support = supportRaw;
    const exposure = await getExposureForPrereq(db, ids, periodTag, tableVersion);
    const confidence = support / exposure;
    const lift = baseRate > 0 ? confidence / baseRate : confidence;
    const score = calcScore(support, exposure, confidence, lift);
    candidates.push({ prereq: ids, support, exposure, confidence, lift, score, setSize: 2 });
  }

  candidates.sort((a, b) => b.score - a.score);

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

  let bestSingle: CandidateMetric | null = null;
  let bestPair: CandidateMetric | null = null;
  const candidateByHash = new Map<string, CandidateMetric>();

  for (const candidate of candidates) {
    if (candidate.setSize === 1 && !bestSingle) bestSingle = candidate;
    if (candidate.setSize === 2 && !bestPair) bestPair = candidate;

    const prereqJson = JSON.stringify(candidate.prereq);
    const hash = prereqHash(candidate.prereq);
    candidateByHash.set(hash, candidate);
    await db
      .prepare(
        `INSERT INTO quest_rule_candidates (
           target_quest_id,
           prereq_set_hash,
           prereq_set_json,
           set_size,
           support,
           exposure,
           confidence,
           lift,
           score,
           period_tag,
           table_version,
           quality_tier,
           updated_at_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        nowMs(),
      )
      .run();
  }

  let primaryPairHash: string | null = null;
  let primarySingleHash: string | null = null;

  if (
    bestPair &&
    bestPair.support >= MIN_OBS_PAIR &&
    bestPair.confidence >= MIN_CONF_PAIR &&
    (() => {
      const left = candidateByHash.get(prereqHash([bestPair.prereq[0]]));
      const right = candidateByHash.get(prereqHash([bestPair.prereq[1]]));
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

  for (const candidate of candidates) {
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

    await db
      .prepare(
        `INSERT INTO quest_rule_edges (
           rule_id,
           target_quest_id,
           prereq_set_json,
           set_size,
           class,
           support,
           confidence,
           lift,
           score,
           period_tag,
           table_version,
           is_primary,
           quality_tier,
           updated_at_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        nowMs(),
      )
      .run();
  }
}

async function processTask(db: D1DatabaseLike, task: InferenceTask): Promise<void> {
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
    .results ?? []) as AppearanceEvent[];

  const touchedTargets = new Set<string>();

  for (const appearance of appearances) {
    const occurrenceId = `${appearance.collection_session_id}:${appearance.target_quest_id}:${appearance.appeared_at_ms}`;

    const existing = (await db
      .prepare(`SELECT occurrence_id FROM quest_occurrence_contexts WHERE occurrence_id = ? LIMIT 1`)
      .bind(occurrenceId)
      .first<{ occurrence_id?: string }>()) as { occurrence_id?: string } | null;

    if (existing?.occurrence_id) {
      touchedTargets.add(`${appearance.target_quest_id}:${appearance.period_tag}:${appearance.table_version}`);
      continue;
    }

    const sets = await getCompletedAndRecentSets(
      db,
      appearance.dataset_id,
      appearance.collection_session_id,
      appearance.appeared_at_ms,
    );

    await db
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
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      .run();

    for (const questId of sets.completed) {
      await db
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
        .run();
    }

    touchedTargets.add(`${appearance.target_quest_id}:${appearance.period_tag}:${appearance.table_version}`);
  }

  for (const key of touchedTargets) {
    const [targetStr, periodTag, tableVersion] = key.split(":");
    const targetQuestId = Number(targetStr);
    if (!Number.isFinite(targetQuestId)) continue;
    await recomputeRulesForTarget(db, targetQuestId, periodTag, tableVersion);
  }
}

export async function runQuestInferenceTasks(
  db: D1DatabaseLike,
  options?: { datasetId?: string; limit?: number },
): Promise<{ picked: number; completed: number; failed: number }> {
  const datasetId = (options?.datasetId ?? "").trim();
  const limit = Math.max(1, Math.min(200, options?.limit ?? 100));

  const now = nowMs();
  const tasks = datasetId
    ? (((await db
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
        .all<InferenceTask>())
        .results ?? []) as InferenceTask[])
    : (((await db
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
        .all<InferenceTask>())
        .results ?? []) as InferenceTask[]);

  let completed = 0;
  let failed = 0;

  for (const task of tasks) {
    try {
      await processTask(db, task);
      await db
        .prepare(`UPDATE quest_inference_tasks SET status = 'completed', updated_at = ? WHERE task_id = ?`)
        .bind(nowMs(), task.task_id)
        .run();
      completed += 1;
    } catch (err) {
      await db
        .prepare(
          `UPDATE quest_inference_tasks
           SET status = 'failed', retry_count = retry_count + 1, error_message = ?, updated_at = ?
           WHERE task_id = ?`
        )
        .bind(err instanceof Error ? err.message : String(err), nowMs(), task.task_id)
        .run();
      failed += 1;
    }
  }

  return { picked: tasks.length, completed, failed };
}
