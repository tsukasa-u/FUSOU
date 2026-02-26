-- ============================================================================
-- Migration: Create formula_results index table
-- Database: battle_index (reuses existing BATTLE_INDEX_DB binding)
-- Date: 2025-01-01
-- Purpose: Index table for formula analysis results stored in R2.
--          In production, formula JSON artifacts are stored in R2 under
--          `formulas/{id}.json`. This table provides fast listing/querying.
-- ============================================================================

CREATE TABLE IF NOT EXISTS formula_results (
    id              TEXT PRIMARY KEY,
    target          TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'candidate',
    best_formula_latex TEXT DEFAULT '',
    complexity      INTEGER DEFAULT 0,
    interval_accuracy REAL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_formula_results_status
    ON formula_results (status);

CREATE INDEX IF NOT EXISTS idx_formula_results_created_at
    ON formula_results (created_at DESC);
