# FUSOU Attestation Operations - Setup and Configuration Guide

**Date**: 2026-07-05  
**Status**: Operational - Production deployed

## Overview

This guide documents the attestation infrastructure setup for FUSOU. The attestation system provides hardware-backed trust verification for battle data uploads from FUSOU-APP (Tauri client) to FUSOU-WEB (Cloudflare Workers backend).

## What Was Set Up

### 1. Attestation Config Signing Keypair (Ed25519)

**Generated**: 2026-07-05  
**Public Key** (base64, 32-byte):
```
cHY8mf/kCV+6aZ13GRuPo2fa+hbkh9umtfTQJeWGV18=
```

**Private Key Location**: Cloudflare Workers secret `ATTESTATION_CONFIG_SIGNING_PRIVATE_KEY`

**Usage**: The server signs the attestation configuration (released every 300 seconds) with this private key. Clients verify the signature using the public key.

### 2. Attestation Config JSON

**Current Configuration**:
```json
{
  "version": 1,
  "issued_at": "2026-07-05T00:00:00Z",
  "expires_at": "2027-07-05T00:00:00Z",
  "attestation_required": false
}
```

**Location**: Cloudflare Workers secret `ATTESTATION_CONFIG_JSON`

**Purpose**: 
- `version`: Configuration schema version (for backward compatibility)
- `issued_at` / `expires_at`: Config validity window
- `attestation_required`: If true, uploads without attestation are rejected
- `tpm` / `secure_enclave` (optional): Trust root certificates and persistent handles

### 3. Client-Side Configuration

**FUSOU-APP Environment** (`.env` via dotenvx):
```
APP_ATTESTATION_CONFIG_SIGNING_PUBLIC_KEY=cHY8mf/kCV+6aZ13GRuPo2fa+hbkh9umtfTQJeWGV18=
```

This public key is used to verify config signatures downloaded at app startup.

## Operational Flow

### Initial App Startup
1. App fetches `/api/attestation/config` → receives JSON + `X-FUSOU-Config-Signature` header
2. App verifies signature with `APP_ATTESTATION_CONFIG_SIGNING_PUBLIC_KEY`
3. Verified config is cached (fallback if endpoint fails)

### Upload with Attestation
1. App collects attestation report:
   - **If TPM available and cert chain configured**: TPM quote + AK certificate chain
   - **If TPM unavailable or cert chain empty**: Software fingerprint (deterministic hash of config + environment flags)
2. App sends upload with attestation claim
3. Server verifies:
   - If TPM: validates cert chain against configured trusted roots → `trust_tag = "hw_verified"`
   - If software fingerprint: validates schema matches server expectations → `trust_tag = "sw_verified"`
   - If verification fails → `trust_tag = "suspicious"` (logged for audit)

### Upload Without Attestation (Before Config Fetched)
- If `attestation_required = false` in config: upload is accepted as `trust_tag = "unverified"`
- If `attestation_required = true`: upload is rejected (503)

## Secrets Management

### Cloudflare Workers Secrets

Register secrets in the default environment (no `--env` flag):

```bash
cd packages/FUSOU-WEB

# Check current status
npx wrangler secret list | grep ATTESTATION

# Manual registration (if needed)
npx wrangler secret put ATTESTATION_CONFIG_SIGNING_PRIVATE_KEY < private-key.pem
npx wrangler secret put ATTESTATION_CONFIG_JSON < config.json

# Or use the management script (requires validation)
pnpm run manage-attestation-config-json -- status
```

### Dotenvx for App (FUSOU-APP)

```bash
cd /repo-root
pnpm exec dotenvx set APP_ATTESTATION_CONFIG_SIGNING_PUBLIC_KEY "<base64-32byte-pubkey>" \
  -f packages/FUSOU-APP/src-tauri/.env \
  -fk packages/.env.keys
```

## Deployment Status

| Component | Status | Details |
|-----------|--------|---------|
| FUSOU-WEB (`GET /api/attestation/config`) | ✅ Deployed | Returns signed config, caches for 300s |
| ATTESTATION_CONFIG_JSON | ✅ Registered | Valid through 2027-07-05 |
| ATTESTATION_CONFIG_SIGNING_PRIVATE_KEY | ✅ Registered | Ed25519 private key in secret store |
| FUSOU-APP with fallback logic | ✅ Built | TPM cert chain fallback compiled, ready for distribution |
| APP_ATTESTATION_CONFIG_SIGNING_PUBLIC_KEY | ✅ Updated | New public key in dotenvx .env |

## Next Steps

### Immediate
1. **Distribute updated FUSOU-APP** (with TPM fallback)
   - Users with TPM but no cert chain: will now use software_fingerprint instead of failing
   - Users without TPM: will use software_fingerprint as before
   
2. **Monitor initial uploads**
   - Watch audit logs for `trust_tag` distribution
   - Expect mix of `"unverified"` (before config fetch), `"sw_verified"` (after config fetch without TPM cert chain), and later `"hw_verified"` (when TPM chains are provisioned)

### Future: Hardware Trust Integration (Not yet configured)

Once TPM AK certificates are provisioned:

1. **Configure TPM trusted roots** in config:
   ```bash
   pnpm run manage-attestation-trusted-roots -- add \
     --name "tpm-root-prod-2026" \
     --cert @trusted-root.pem \
     --fingerprint <sha256-hash>
   ```

2. **Update config JSON**:
   ```json
   {
     ...
     "tpm": {
       "ak_cert_chain_b64": ["base64-leaf", "base64-root"],
       "persistent_handle": "0x81000001"
     }
   }
   ```

3. **Rotate attestation config**:
   ```bash
   pnpm run manage-attestation-config-json -- apply --config @new-config.json --confirm
   ```

4. **Users with provisioned TPM**: will start sending hardware-backed attestation reports → `trust_tag = "hw_verified"`

## Troubleshooting

### Upload shows `trust_tag = "suspicious"`

**Likely cause**: Config endpoint was 504 at app startup → app fell back to empty cert chain → server sees TPM claim with no chain

**Fix**: 
- Check server logs for attestation config endpoint errors
- Ensure ATTESTATION_CONFIG_JSON and ATTESTATION_CONFIG_SIGNING_PRIVATE_KEY are registered
- Trigger app restart to re-fetch config

### App can't verify config signature

**Likely cause**: `APP_ATTESTATION_CONFIG_SIGNING_PUBLIC_KEY` mismatch

**Check**:
```bash
# Current app key
cat packages/FUSOU-APP/src-tauri/.env | grep APP_ATTESTATION_CONFIG_SIGNING_PUBLIC_KEY

# Current server key
pnpm exec dotenvx get ATTESTATION_CONFIG_SIGNING_PRIVATE_KEY -f packages/FUSOU-WEB/wrangler.toml
```

### Config endpoint returns 503

**Cause**: ATTESTATION_CONFIG_JSON is not configured in secrets

**Fix**:
```bash
npx wrangler secret list | grep ATTESTATION_CONFIG_JSON
# If missing:
pnpm run manage-attestation-config-json -- apply --config @config.json --confirm
```

## Configuration Files Reference

- **Server config signing**: `packages/FUSOU-WEB/scripts/manage-attestation-config-signing-key.mjs`
- **Server config JSON**: `packages/FUSOU-WEB/scripts/manage-attestation-config-json.mjs`
- **Trusted roots**: `packages/FUSOU-WEB/scripts/manage-attestation-trusted-roots.mjs`
- **App attestation collection**: `packages/FUSOU-APP/src-tauri/src/attestation/mod.rs`
- **Server verification logic**: `packages/FUSOU-WEB/src/server/routes/__tests__/battle_data.trust-tag-derivation.test.ts`

## Security Notes

- **Private key**: Never expose in logs or client code. Kept in Cloudflare secrets only.
- **Public key**: Safe to distribute; updated via dotenvx rotation procedure.
- **Config tampering**: If config signature verification fails, app logs error and uses cached config; uploads proceed but may be marked `unverified` or `suspicious`.
- **Trusted roots**: SHA256 fingerprints stored server-side; certificate chain validation is fail-closed.

## References

- Trust tag classification: [packages/FUSOU-WEB/src/server/utils/trust-tag.ts](../../../packages/FUSOU-WEB/src/server/utils/trust-tag.ts)
- Config signing implementation: [packages/FUSOU-WEB/src/server/utils/attestation-config-sign.ts](../../../packages/FUSOU-WEB/src/server/utils/attestation-config-sign.ts)
- Server verification: [packages/FUSOU-WEB/src/server/utils/attestation-verifier.ts](../../../packages/FUSOU-WEB/src/server/utils/attestation-verifier.ts)
- App collection (Linux TPM): [packages/FUSOU-APP/src-tauri/src/attestation/linux_tpm.rs](../../../packages/FUSOU-APP/src-tauri/src/attestation/linux_tpm.rs)
- App collection (Windows TPM): [packages/FUSOU-APP/src-tauri/src/attestation/windows_tpm.rs](../../../packages/FUSOU-APP/src-tauri/src/attestation/windows_tpm.rs)
