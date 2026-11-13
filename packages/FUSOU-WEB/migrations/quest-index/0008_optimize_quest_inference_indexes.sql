-- ============================================================================
-- Migration: Optimize quest-tree inference indexes to eliminate full table scans
-- Date: 2026-11-12
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_qopr_quest_completed_occ
  ON quest_occurrence_prerequisites(quest_id, is_completed, occurrence_id);

CREATE INDEX IF NOT EXISTS idx_qocc_period_ver_boot_occ
  ON quest_occurrence_contexts(period_tag, table_version, is_bootstrap_unknown, occurrence_id);

-- Deduplicate any legacy known appearance rows before enforcing uniqueness.
DELETE FROM quest_appearance_events
WHERE is_bootstrap_unknown = 0
  AND id NOT IN (
    SELECT MIN(id)
    FROM quest_appearance_events
    WHERE is_bootstrap_unknown = 0
    GROUP BY dataset_id, target_quest_id, period_tag, table_version
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_qappear_dataset_target_period_unique
  ON quest_appearance_events(dataset_id, target_quest_id, period_tag, table_version)
  WHERE is_bootstrap_unknown = 0;

-- Deduplicate legacy known occurrence rows (deleting child prerequisites first
-- since quest_occurrence_prerequisites lacks ON DELETE CASCADE) before enforcing uniqueness.
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
