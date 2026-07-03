# Attestation Config Signing Key Runbook

This runbook explains how to operate attestation-config signing keys safely.

## Scope

- Server endpoint: `GET /api/attestation/config`
- Server secret: `ATTESTATION_CONFIG_SIGNING_PRIVATE_KEY`
- App-side verifier key env: `APP_ATTESTATION_CONFIG_SIGNING_PUBLIC_KEY` (dotenvx managed)
- Root trust secrets:
  - `INTEGRITY_TPM_AK_TRUSTED_ROOT_SHA256`
  - `INTEGRITY_SECURE_ENCLAVE_TRUSTED_ROOT_SHA256`

Related detailed design/operations note:

- `docs/operations/web/TPM_ATTESTATION_TRUST_MODEL_AND_CA.md`
- `pnpm run manage-attestation-trusted-roots-supabase -- <command>`

## Security Model

- Private key is server-only. Never ship it inside app binaries.
- Public key is not secret, but should still be managed as controlled config.
- FUSOU-APP verifies signatures with `APP_ATTESTATION_CONFIG_SIGNING_PUBLIC_KEY`.
- Endpoint is managed via centralized `configs.toml`; verifier key is injected via dotenvx.

## File-First Secret Management

- Treat JSON/PEM/CSV as managed secret files in your repository-external secret workflow.
- At deploy time, inject file contents into Cloudflare secret/config bindings.
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
2. Distribute new verifier public key by updating `APP_ATTESTATION_CONFIG_SIGNING_PUBLIC_KEY` in app dotenvx inputs.
3. Wait until rollout reaches required adoption threshold.
4. Apply new server private key via script (`apply --confirm`).
5. Verify `/api/attestation/config` signature can be validated by updated clients.
6. Decommission old private key material.

Dotenvx update example (FUSOU-APP):

```bash
cd /repo-root
pnpm exec dotenvx set APP_ATTESTATION_CONFIG_SIGNING_PUBLIC_KEY "<base64-32byte-ed25519-pubkey>" \
  -f packages/FUSOU-APP/src-tauri/.env \
  -fk packages/.env.keys
```

## Related Scripts

Root trust rotation script (different purpose):

- `pnpm run manage-attestation-trusted-roots -- <command>`

Attestation config JSON generation/validation/apply script:

- `pnpm run manage-attestation-config-json -- <command>`

Example:

```bash
cd packages/FUSOU-WEB

# validate local JSON file before injection
pnpm run manage-attestation-config-json -- validate --config @./attestation-config.next.json

# print canonical JSON (exact string that will be injected)
pnpm run manage-attestation-config-json -- print --config @./attestation-config.next.json

# apply as Wrangler secret string
pnpm run manage-attestation-config-json -- apply \
  --config @./attestation-config.next.json \
  --env production \
  --confirm
```

Use `manage-attestation-trusted-roots` to update:

- `INTEGRITY_TPM_AK_TRUSTED_ROOT_SHA256`
- `INTEGRITY_SECURE_ENCLAVE_TRUSTED_ROOT_SHA256`

## Incident Response Notes

If key compromise is suspected:

1. Freeze config changes.
2. Generate new keypair immediately.
3. Ship app update with new public key.
4. Rotate server private key after sufficient app rollout.
5. Audit recent config versions and trust-tag anomalies.
