BEGIN;

-- Persist the refresh response beside the consumed nonce so a concurrent
-- retry remains idempotent even when the optional KV cache is unavailable.
ALTER TABLE public.anon_sync_nonce_consumptions
    ADD COLUMN IF NOT EXISTS refresh_result_token text,
    ADD COLUMN IF NOT EXISTS refresh_result_expires_at integer;

ALTER TABLE public.anon_sync_nonce_consumptions
    ADD CONSTRAINT anon_sync_nonce_refresh_result_pair CHECK (
        (refresh_result_token IS NULL AND refresh_result_expires_at IS NULL)
        OR (refresh_result_token IS NOT NULL AND refresh_result_expires_at IS NOT NULL)
    );

COMMENT ON COLUMN public.anon_sync_nonce_consumptions.refresh_result_token IS
    'The dataset token issued for a refresh nonce, retained for concurrent retry idempotency.';
COMMENT ON COLUMN public.anon_sync_nonce_consumptions.refresh_result_expires_at IS
    'Unix expiration timestamp for refresh_result_token.';

COMMIT;