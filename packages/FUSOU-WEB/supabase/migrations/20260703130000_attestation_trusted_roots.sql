-- 20260703130000_attestation_trusted_roots.sql
--
-- Attestation trusted-root allowlist for TPM / Secure Enclave.
--
-- Purpose:
-- - Canonical source of trust anchors in Supabase
-- - Worker reads from Supabase, then caches in KV
-- - Environment variables remain break-glass fallback only

CREATE TABLE IF NOT EXISTS public.attestation_trusted_roots (
  id bigserial PRIMARY KEY,
  platform text NOT NULL,
  root_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  manufacturer text NOT NULL DEFAULT 'unknown',
  source text NOT NULL,
  description text,
  valid_from timestamptz,
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attestation_trusted_roots_platform_chk
    CHECK (platform IN ('tpm', 'secure_enclave')),
  CONSTRAINT attestation_trusted_roots_status_chk
    CHECK (status IN ('active', 'staged', 'retired', 'blocked')),
  CONSTRAINT attestation_trusted_roots_sha256_chk
    CHECK (root_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT attestation_trusted_roots_valid_range_chk
    CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  CONSTRAINT attestation_trusted_roots_platform_hash_key UNIQUE (platform, root_sha256)
);

CREATE INDEX IF NOT EXISTS idx_attestation_trusted_roots_lookup
  ON public.attestation_trusted_roots (platform, status, valid_from, valid_to);

CREATE OR REPLACE FUNCTION public.set_attestation_trusted_roots_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_attestation_trusted_roots_updated_at_trg
  ON public.attestation_trusted_roots;

CREATE TRIGGER set_attestation_trusted_roots_updated_at_trg
BEFORE UPDATE ON public.attestation_trusted_roots
FOR EACH ROW
EXECUTE FUNCTION public.set_attestation_trusted_roots_updated_at();

ALTER TABLE public.attestation_trusted_roots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attestation_trusted_roots_service_role_select
  ON public.attestation_trusted_roots;
CREATE POLICY attestation_trusted_roots_service_role_select
ON public.attestation_trusted_roots
FOR SELECT
TO service_role
USING (true);

DROP POLICY IF EXISTS attestation_trusted_roots_service_role_insert
  ON public.attestation_trusted_roots;
CREATE POLICY attestation_trusted_roots_service_role_insert
ON public.attestation_trusted_roots
FOR INSERT
TO service_role
WITH CHECK (true);

DROP POLICY IF EXISTS attestation_trusted_roots_service_role_update
  ON public.attestation_trusted_roots;
CREATE POLICY attestation_trusted_roots_service_role_update
ON public.attestation_trusted_roots
FOR UPDATE
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS attestation_trusted_roots_service_role_delete
  ON public.attestation_trusted_roots;
CREATE POLICY attestation_trusted_roots_service_role_delete
ON public.attestation_trusted_roots
FOR DELETE
TO service_role
USING (true);

REVOKE ALL ON TABLE public.attestation_trusted_roots FROM anon;
REVOKE ALL ON TABLE public.attestation_trusted_roots FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.attestation_trusted_roots TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.attestation_trusted_roots_id_seq TO service_role;
