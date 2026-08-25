BEGIN;

-- Serialize registrations per public identity and cap active device rows.
-- This limits resource exhaustion; it is not a substitute for enrollment proof.
CREATE OR REPLACE FUNCTION public.rpc_register_user_device(
    p_public_id uuid,
    p_device_pubkey_hex text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_canonical_user_id uuid;
    v_device_id uuid;
    v_revoked_at timestamptz;
    v_active_count integer;
    v_max_active_devices constant integer := 16;
BEGIN
    IF p_public_id IS NULL THEN
        RAISE EXCEPTION 'public_id is required';
    END IF;
    IF p_device_pubkey_hex IS NULL
       OR p_device_pubkey_hex !~ '^[0-9a-fA-F]{64}$' THEN
        RAISE EXCEPTION 'device public key must be 32-byte hexadecimal';
    END IF;

    -- Lock the mapping row so concurrent registrations for this public_id
    -- observe one consistent active-device count.
    PERFORM 1
      FROM public.member_id_mapping
     WHERE public_id = p_public_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'public_id_unknown';
    END IF;

    SELECT user_id
      INTO v_canonical_user_id
      FROM public.user_member_map
     WHERE public_id = p_public_id
     FOR UPDATE;
    IF v_canonical_user_id IS NULL THEN
        RAISE EXCEPTION 'canonical_owner_missing';
    END IF;

    SELECT device_id, revoked_at
      INTO v_device_id, v_revoked_at
      FROM public.user_devices
     WHERE public_id = p_public_id
       AND device_pubkey = decode(p_device_pubkey_hex, 'hex')
     FOR UPDATE;

    IF FOUND THEN
        IF v_revoked_at IS NOT NULL THEN
            RAISE EXCEPTION 'device_revoked';
        END IF;
        UPDATE public.user_devices
           SET last_seen_at = now()
         WHERE device_id = v_device_id;
        RETURN v_device_id;
    END IF;

    SELECT count(*)::integer
      INTO v_active_count
      FROM public.user_devices
     WHERE public_id = p_public_id
       AND revoked_at IS NULL;
    IF v_active_count >= v_max_active_devices THEN
        RAISE EXCEPTION 'device_limit_reached';
    END IF;

    INSERT INTO public.user_devices (
        canonical_user_id,
        public_id,
        device_pubkey
    ) VALUES (
        v_canonical_user_id,
        p_public_id,
        decode(p_device_pubkey_hex, 'hex')
    )
    RETURNING device_id INTO v_device_id;

    RETURN v_device_id;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_register_user_device(uuid, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_register_user_device(uuid, text)
    TO service_role;

COMMIT;