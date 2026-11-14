-- Migration: Drop quest_rule_edges inference output table and its indexes
-- Prerequisite inference tasks and rule/graph endpoints have been removed.
-- Lightweight quest data collection (sessions, snapshots, master entries,
-- state events, and appearance events) remains active.

DROP INDEX IF EXISTS idx_qruleedge_target_period_primary;
DROP INDEX IF EXISTS idx_qruleedge_target_period_updated;
DROP INDEX IF EXISTS idx_qruleedge_period_updated;
DROP TABLE IF EXISTS quest_rule_edges;
