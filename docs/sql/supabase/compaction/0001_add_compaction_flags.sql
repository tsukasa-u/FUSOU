-- Supabase migration: add compaction flags and timestamps
-- Safe to run: additive columns only

BEGIN;

ALTER TABLE public.datasets
  ADD COLUMN IF NOT EXISTS compaction_in_progress boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS compaction_needed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_compacted_at timestamptz;

COMMENT ON COLUMN public.datasets.compaction_in_progress IS 'Set true during compaction to prevent duplicate runs';
COMMENT ON COLUMN public.datasets.compaction_needed IS 'Scheduler/producer sets true when fragments exist';
COMMENT ON COLUMN public.datasets.last_compacted_at IS 'Timestamp of last successful compaction';

COMMIT;
