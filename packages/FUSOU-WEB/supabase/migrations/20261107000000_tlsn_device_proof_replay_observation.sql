BEGIN;

CREATE FUNCTION public.rpc_observe_tlsn_device_proof_replay(
    p_user_id uuid, p_device_id uuid, p_expected_key bytea,
    p_proof_digest text, p_session_id uuid,
    p_binding_sha256 text, p_challenge_sha256 text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    device public.user_devices%ROWTYPE;
    proof public.tlsn_device_proof_consumptions%ROWTYPE;
BEGIN
    IF p_user_id IS NULL OR p_device_id IS NULL OR p_expected_key IS NULL
        OR octet_length(p_expected_key) <> 32
        OR p_proof_digest IS NULL OR p_proof_digest !~ '^[a-f0-9]{64}$'
        OR p_session_id IS NULL
        OR p_binding_sha256 IS NULL OR p_binding_sha256 !~ '^[a-f0-9]{64}$'
        OR p_challenge_sha256 IS NULL OR p_challenge_sha256 !~ '^[a-f0-9]{64}$' THEN
        RAISE EXCEPTION 'invalid TLSN proof replay observation arguments'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO device FROM public.user_devices
        WHERE device_id = p_device_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'device_unknown');
    END IF;
    IF device.canonical_user_id <> p_user_id OR NOT EXISTS (
        SELECT 1 FROM auth.users WHERE id = p_user_id AND is_anonymous IS FALSE
    ) THEN
        RETURN jsonb_build_object('status', 'device_owner_mismatch');
    END IF;
    IF device.revoked_at IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'device_revoked');
    END IF;
    IF device.device_pubkey <> p_expected_key OR device.pubkey_algo <> 'ed25519' THEN
        RETURN jsonb_build_object('status', 'device_key_changed');
    END IF;

    SELECT * INTO proof FROM public.tlsn_device_proof_consumptions
        WHERE device_id = p_device_id
            AND canonical_user_id = p_user_id
            AND device_pubkey = p_expected_key
            AND proof_kind = 'possession'
            AND proof_digest = p_proof_digest
            AND session_id = p_session_id
            AND binding_sha256 = p_binding_sha256
            AND challenge_sha256 = p_challenge_sha256;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'device_proof_not_consumed');
    END IF;

    RETURN jsonb_build_object(
        'status', 'device_proof_replayed',
        'canonical_user_id', proof.canonical_user_id,
        'device_id', proof.device_id,
        'proof_kind', proof.proof_kind,
        'proof_digest', proof.proof_digest,
        'session_id', proof.session_id,
        'binding_sha256', proof.binding_sha256,
        'challenge_sha256', proof.challenge_sha256,
        'consumed_at', proof.consumed_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_observe_tlsn_device_proof_replay(
    uuid, uuid, bytea, text, uuid, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_observe_tlsn_device_proof_replay(
    uuid, uuid, bytea, text, uuid, text, text
) TO service_role;

COMMIT;
