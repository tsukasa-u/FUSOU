-- ============================================================================
-- 20260522000000_anon_sync_nonce_consumptions.sql
--
-- Adds an atomic nonce-consumption table for anonymous-sync v2 refresh path.
-- This prevents same device+nonce from being consumed concurrently when
-- multiple requests race.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.anon_sync_nonce_consumptions (
    device_id    uuid NOT NULL,
    nonce        text NOT NULL CHECK (nonce ~ '^[a-f0-9]{64}$'),
    consumed_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (device_id, nonce)
);

CREATE INDEX IF NOT EXISTS idx_anon_sync_nonce_consumptions_consumed_at
ON public.anon_sync_nonce_consumptions (consumed_at DESC);

ALTER TABLE public.anon_sync_nonce_consumptions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON public.anon_sync_nonce_consumptions TO service_role;
