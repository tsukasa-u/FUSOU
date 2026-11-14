-- ============================================================================
-- Migration: Deduplicate quest_occurrence_contexts and enforce uniqueness
-- Date: 2026-11-13
-- ============================================================================
-- 0008 deduplicated quest_appearance_events, and on fresh databases also
-- deduplicates quest_occurrence_contexts. For databases where the original 0008
-- had already been applied, pre-existing duplicate occurrence rows across
-- sessions remained and still need cleanup plus the unique index.
--
-- Child rows in quest_occurrence_prerequisites must be removed first because its
-- FOREIGN KEY(occurrence_id) lacks ON DELETE CASCADE.

CREATE INDEX IF NOT EXISTS idx_qocc_dedup_lookup
  ON quest_occurrence_contexts(
    is_bootstrap_unknown,
    dataset_id,
    target_quest_id,
    period_tag,
    table_version,
    occurred_at_ms,
    created_at,
    occurrence_id
  );

DELETE FROM quest_occurrence_prerequisites
WHERE occurrence_id IN (
  SELECT occurrence_id
  FROM (
    SELECT
      occurrence_id,
      ROW_NUMBER() OVER (
        PARTITION BY dataset_id, target_quest_id, period_tag, table_version
        ORDER BY occurred_at_ms ASC, created_at ASC, occurrence_id ASC
      ) AS rn
    FROM quest_occurrence_contexts
    WHERE is_bootstrap_unknown = 0
  )
  WHERE rn > 1
);

DELETE FROM quest_occurrence_contexts
WHERE occurrence_id IN (
  SELECT occurrence_id
  FROM (
    SELECT
      occurrence_id,
      ROW_NUMBER() OVER (
        PARTITION BY dataset_id, target_quest_id, period_tag, table_version
        ORDER BY occurred_at_ms ASC, created_at ASC, occurrence_id ASC
      ) AS rn
    FROM quest_occurrence_contexts
    WHERE is_bootstrap_unknown = 0
  )
  WHERE rn > 1
);

DROP INDEX IF EXISTS idx_qocc_dedup_lookup;

CREATE UNIQUE INDEX IF NOT EXISTS idx_qocc_dataset_target_period_unique
  ON quest_occurrence_contexts(dataset_id, target_quest_id, period_tag, table_version)
  WHERE is_bootstrap_unknown = 0;
