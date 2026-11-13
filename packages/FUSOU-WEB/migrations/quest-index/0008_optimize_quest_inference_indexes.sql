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
