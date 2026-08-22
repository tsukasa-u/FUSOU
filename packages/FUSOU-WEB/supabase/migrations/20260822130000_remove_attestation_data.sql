-- Remove the retired TPM / Secure Enclave attestation data model.
--
-- Device challenge signatures and dataset-token issuance remain active for
-- Fleet authentication. This migration removes only the unused trust-root
-- registry and suspicious-attestation audit data.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';

-- Dropping the tables removes their rows, columns, policies, indexes,
-- triggers, and owned sequence. Drop the trigger function afterwards.
DROP TABLE IF EXISTS public.attestation_trusted_roots;
DROP TABLE IF EXISTS public.suspicious_trust_audit;
DROP SEQUENCE IF EXISTS public.attestation_trusted_roots_id_seq;
DROP FUNCTION IF EXISTS public.set_attestation_trusted_roots_updated_at();

DO $$
BEGIN
    IF to_regclass('public.attestation_trusted_roots') IS NOT NULL THEN
        RAISE EXCEPTION 'attestation_trusted_roots still exists after cleanup';
    END IF;
    IF to_regclass('public.suspicious_trust_audit') IS NOT NULL THEN
        RAISE EXCEPTION 'suspicious_trust_audit still exists after cleanup';
    END IF;
    IF to_regclass('public.attestation_trusted_roots_id_seq') IS NOT NULL THEN
        RAISE EXCEPTION 'attestation trusted-root sequence still exists after cleanup';
    END IF;
    IF to_regprocedure('public.set_attestation_trusted_roots_updated_at()') IS NOT NULL THEN
        RAISE EXCEPTION 'attestation trigger function still exists after cleanup';
    END IF;
END;
$$;

COMMIT;

COMMIT;