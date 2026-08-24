BEGIN;

-- Atomic, service-role-only rate-limit buckets for anonymous-sync v2.
-- The Worker stores only a SHA-256 bucket key, never a raw IP or public key.
CREATE TABLE IF NOT EXISTS public.anon_sync_rate_limits (
    bucket_key         text PRIMARY KEY,
    window_started_at  timestamptz NOT NULL,
    request_count      integer NOT NULL CHECK (request_count > 0)
);

ALTER TABLE public.anon_sync_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.anon_sync_rate_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.anon_sync_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.rpc_consume_anon_sync_rate_limit(
    p_bucket_key text,
    p_limit integer,
    p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_count integer;
BEGIN
    IF p_bucket_key IS NULL OR length(p_bucket_key) <> 64
       OR p_bucket_key !~ '^[0-9a-f]{64}$'
       OR p_limit < 1
       OR p_window_seconds < 1 THEN
        RAISE EXCEPTION 'invalid anonymous-sync rate-limit arguments';
    END IF;

    DELETE FROM public.anon_sync_rate_limits
     WHERE window_started_at < now() - make_interval(secs => p_window_seconds * 2);

    INSERT INTO public.anon_sync_rate_limits (
        bucket_key,
        window_started_at,
        request_count
    ) VALUES (
        p_bucket_key,
        now(),
        1
    )
    ON CONFLICT (bucket_key) DO UPDATE
       SET window_started_at = CASE
           WHEN public.anon_sync_rate_limits.window_started_at
                <= now() - make_interval(secs => p_window_seconds)
           THEN now()
           ELSE public.anon_sync_rate_limits.window_started_at
       END,
           request_count = CASE
           WHEN public.anon_sync_rate_limits.window_started_at
                <= now() - make_interval(secs => p_window_seconds)
           THEN 1
           ELSE public.anon_sync_rate_limits.request_count + 1
       END
    RETURNING request_count INTO v_count;

    RETURN v_count <= p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_consume_anon_sync_rate_limit(text, integer, integer)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_consume_anon_sync_rate_limit(text, integer, integer)
    TO service_role;

COMMIT;
