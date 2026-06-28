-- ----------------------------------------------------------------------------
-- Durable audit log for suspicious trust_tag issuance in anonymous sync v2.
-- This complements spreadsheet logging and preserves events even if external
-- notification sinks are temporarily unavailable.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.suspicious_trust_audit (
    attempt_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_user_id  uuid,
    device_id          uuid,
    dataset_id         text NOT NULL CHECK (dataset_id ~ '^[a-f0-9]{64}$'),
    trust_tag          text NOT NULL CHECK (trust_tag = 'suspicious'),
    attestation_level  text NOT NULL,
    details            jsonb,
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suspicious_trust_audit_created_at
ON public.suspicious_trust_audit (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_suspicious_trust_audit_dataset_id
ON public.suspicious_trust_audit (dataset_id);

ALTER TABLE public.suspicious_trust_audit ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.suspicious_trust_audit TO service_role;
