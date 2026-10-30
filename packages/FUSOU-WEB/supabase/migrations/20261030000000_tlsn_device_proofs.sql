BEGIN;

CREATE TABLE public.tlsn_device_proof_consumptions (
    device_id uuid NOT NULL REFERENCES public.user_devices(device_id) ON DELETE CASCADE,
    canonical_user_id uuid NOT NULL,
    device_pubkey bytea NOT NULL CHECK (octet_length(device_pubkey) = 32),
    proof_kind text NOT NULL CHECK (proof_kind IN ('authentication', 'possession')),
    proof_digest text NOT NULL CHECK (proof_digest ~ '^[a-f0-9]{64}$'),
    session_id uuid,
    binding_sha256 text,
    challenge_sha256 text,
    consumed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (device_id, proof_kind, proof_digest),
    CHECK (
        (proof_kind = 'authentication' AND session_id IS NULL
            AND binding_sha256 IS NULL AND challenge_sha256 IS NULL)
        OR
        (proof_kind = 'possession' AND session_id IS NOT NULL
            AND binding_sha256 IS NOT NULL AND binding_sha256 ~ '^[a-f0-9]{64}$'
            AND challenge_sha256 IS NOT NULL AND challenge_sha256 ~ '^[a-f0-9]{64}$')
    )
);

CREATE UNIQUE INDEX tlsn_device_proof_session_once
    ON public.tlsn_device_proof_consumptions(device_id, session_id)
    WHERE proof_kind = 'possession';
ALTER TABLE public.tlsn_device_proof_consumptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tlsn_device_proof_consumptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.tlsn_device_proof_consumptions TO service_role;

CREATE FUNCTION public.rpc_consume_tlsn_device_proof(
    p_kind text, p_user_id uuid, p_device_id uuid, p_expected_key bytea,
    p_proof_digest text, p_nonce text, p_session_id uuid,
    p_binding_sha256 text, p_challenge_sha256 text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    device public.user_devices%ROWTYPE;
BEGIN
    IF p_kind IS NULL OR p_kind NOT IN ('authentication', 'possession')
        OR p_user_id IS NULL OR p_device_id IS NULL OR p_expected_key IS NULL
        OR octet_length(p_expected_key) <> 32
        OR p_proof_digest IS NULL OR p_proof_digest !~ '^[a-f0-9]{64}$' THEN
        RAISE EXCEPTION 'invalid device proof arguments' USING ERRCODE = '22023';
    END IF;
    IF (p_kind = 'authentication' AND
        (p_nonce IS NULL OR p_nonce !~ '^[a-f0-9]{64}$'
            OR p_session_id IS NOT NULL OR p_binding_sha256 IS NOT NULL
            OR p_challenge_sha256 IS NOT NULL))
        OR (p_kind = 'possession' AND
        (p_nonce IS NOT NULL OR p_session_id IS NULL
            OR p_binding_sha256 IS NULL OR p_binding_sha256 !~ '^[a-f0-9]{64}$'
            OR p_challenge_sha256 IS NULL OR p_challenge_sha256 !~ '^[a-f0-9]{64}$')) THEN
        RAISE EXCEPTION 'invalid device proof context' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO device FROM public.user_devices
        WHERE device_id = p_device_id FOR UPDATE;
    IF NOT FOUND THEN RETURN 'device_unknown'; END IF;
    IF device.canonical_user_id <> p_user_id OR NOT EXISTS (
        SELECT 1 FROM auth.users WHERE id = p_user_id AND is_anonymous IS FALSE
    ) THEN RETURN 'device_owner_mismatch'; END IF;
    IF device.revoked_at IS NOT NULL THEN RETURN 'device_revoked'; END IF;
    IF device.device_pubkey <> p_expected_key OR device.pubkey_algo <> 'ed25519' THEN
        RETURN 'device_key_changed';
    END IF;

    IF p_kind = 'authentication' THEN
        INSERT INTO public.anon_sync_nonce_consumptions(device_id, nonce)
            VALUES (p_device_id, p_nonce) ON CONFLICT DO NOTHING;
        IF NOT FOUND THEN RETURN 'nonce_already_used'; END IF;
    END IF;
    INSERT INTO public.tlsn_device_proof_consumptions(
        device_id, canonical_user_id, device_pubkey, proof_kind, proof_digest,
        session_id, binding_sha256, challenge_sha256
    ) VALUES (
        p_device_id, device.canonical_user_id, device.device_pubkey, p_kind,
        p_proof_digest, p_session_id, p_binding_sha256, p_challenge_sha256
    ) ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN
        -- Roll back an authentication nonce inserted by this invocation as well.
        RAISE unique_violation USING MESSAGE = 'device_proof_replayed';
    END IF;
    UPDATE public.user_devices SET last_seen_at = clock_timestamp()
        WHERE device_id = p_device_id;
    RETURN 'ok';
EXCEPTION WHEN unique_violation THEN
    RETURN 'device_proof_replayed';
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_consume_tlsn_device_proof(
    text, uuid, uuid, bytea, text, text, uuid, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_consume_tlsn_device_proof(
    text, uuid, uuid, bytea, text, text, uuid, text, text
) TO service_role;

COMMIT;
