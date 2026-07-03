# Attestation Config Signing Key Runbook

This runbook explains how to operate attestation-config signing keys safely.

## Scope

- Server endpoint: `GET /api/attestation/config`
- Server secret: `ATTESTATION_CONFIG_SIGNING_PRIVATE_KEY`
- App-side verifier key: `ATTESTATION_CONFIG_SIGNING_PUBLIC_KEY`
- Root trust secrets:
  - `INTEGRITY_TPM_AK_TRUSTED_ROOT_SHA256`
  - `INTEGRITY_SECURE_ENCLAVE_TRUSTED_ROOT_SHA256`

## Security Model

- Private key is server-only. Never ship it inside app binaries.
- Public key is not secret and can be embedded in the app build.
- FUSOU-APP verifies signatures with the embedded public key.
- In production builds, runtime env override for key/url is disabled in app code.

## About "env vars with JSON/PEM"

- Cloudflare Workers secrets/config are string bindings, so JSON/PEM as text is normal.
- Operationally, you can keep source material as files and pass file contents to `wrangler secret put`.
- Do not commit raw private keys.

## When INTEGRITY_SECURE_ENCLAVE_TRUSTED_ROOT_SHA256 is Required

This value is required only when processing `secure_enclave` attestation reports.

- If `secure_enclave` report arrives and the root list is missing, server returns fail-closed error (`attestation_trusted_root_unconfigured`, HTTP 503).
- If your deployment does not support secure enclave attestation yet, keep clients from sending `secure_enclave` reports.

## Script: manage-attestation-config-signing-key

Script location:

- `packages/FUSOU-WEB/scripts/manage-attestation-config-signing-key.mjs`

Package script:

- `pnpm run manage-attestation-config-signing-key -- <command> [options]`

### Commands

- `generate`
  - Generate a new Ed25519 keypair.
  - Default behavior hides private key from stdout.
- `status`
  - Check whether `ATTESTATION_CONFIG_SIGNING_PRIVATE_KEY` is registered in Wrangler secrets.
- `apply`
  - Put `ATTESTATION_CONFIG_SIGNING_PRIVATE_KEY` into Wrangler secret store.

### Options

- `--json`
- `--env <name>`
- `--public-out <path>`
- `--private-out <path>`
- `--show-private` (dangerous)
- `--allow-inline-private` (dangerous)

### Safe Examples

Generate keypair to files (recommended):

```bash
cd packages/FUSOU-WEB
pnpm run manage-attestation-config-signing-key -- generate \
  --public-out ../tmp/attestation-config-signing-public.b64 \
  --private-out ../tmp/attestation-config-signing-private.pem
```

Check target env status:

```bash
pnpm run manage-attestation-config-signing-key -- status --env production
```

Apply private key from file to Wrangler secret:

```bash
pnpm run manage-attestation-config-signing-key -- apply \
  --private-pem @../tmp/attestation-config-signing-private.pem \
  --env production \
  --confirm
```

## Rotation Procedure (No Dual-Key Acceptance)

This procedure assumes no simultaneous acceptance of old/new keys.

1. Generate new keypair.
2. Build and ship new FUSOU-APP with new `ATTESTATION_CONFIG_SIGNING_PUBLIC_KEY` embedded.
3. Wait until rollout reaches required adoption threshold.
4. Apply new server private key via script (`apply --confirm`).
5. Verify `/api/attestation/config` signature can be validated by updated clients.
6. Decommission old private key material.

## Related Scripts

Root trust rotation script (different purpose):

- `pnpm run manage-attestation-trusted-roots -- <command>`

Use it to update:

- `INTEGRITY_TPM_AK_TRUSTED_ROOT_SHA256`
- `INTEGRITY_SECURE_ENCLAVE_TRUSTED_ROOT_SHA256`

## Incident Response Notes

If key compromise is suspected:

1. Freeze config changes.
2. Generate new keypair immediately.
3. Ship app update with new public key.
4. Rotate server private key after sufficient app rollout.
5. Audit recent config versions and trust-tag anomalies.
