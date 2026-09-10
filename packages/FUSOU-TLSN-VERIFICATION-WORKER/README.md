# FUSOU TLSNotary Verification Worker

This Worker is the authoritative verification boundary for FUSOU TLSNotary alpha.15 `require_info` Presentations.

The Worker issues a one-shot, authenticated Session/Binding context at `/attestation/session`. Session issuance requires the existing FUSOU device proof (`device_id`, the HMAC challenge nonce, and the Ed25519 signature over that nonce). Every Session also receives a fresh 32-byte TLSN device challenge. `/verify/tlsn` requires `presentation_base64`, `session_id`, `device_id`, `binding`, and `device_proof` (`challenge`, `sig`); the signature covers the current device, Session, binding, and challenge context. Rust/WASM verifies the Presentation and derives `verified_member_id` from authenticated response bytes. Client-provided member IDs are not accepted. Synthetic wire data is never treated as verified.

Both attestation endpoints require `Authorization: Bearer <Supabase access token>`. The Worker resolves the token through Supabase `/auth/v1/user`, uses the returned `auth.users.id` as the canonical user subject, rejects anonymous users, and never stores the raw token. For session issuance it forwards that bearer token and the existing device proof to the configured FUSOU-WEB generic device-proof endpoint. During verification it forwards the bearer token and TLSN-specific proof context to the dedicated `/api/auth/anonymous-sync/v2/tlsn-device-proof` endpoint. FUSOU-WEB remains the device-auth authority: both paths use `user_devices` owner and `revoked_at`; the TLSN path verifies Ed25519 over the canonical proof message and atomically consumes its SHA-256 digest through the existing nonce table. The Worker stores only the backend-derived device ID and TLSN challenge in the Durable Object. The canonical user ID, device ID, and device challenge are included in the signed verifier-result bytes. A binding issued to one user/device cannot be looked up or consumed under another user/device context.

The Worker does not own a TLSN device registry, receive a Supabase service-role key, or receive a device private key. A client-supplied `device_id` is only a selector/proof input; the authoritative device identity comes from the FUSOU-WEB verification response and the Durable Object record. The generic device proof and TLSN proof are separate one-shot proofs and cannot be reused across Sessions or bindings.

## Local development

Requirements:

- Rust toolchain `1.95.0`
- Rust target `wasm32-unknown-unknown`
- `wasm-pack`
- A wasm-capable Clang compiler for ring's C backend

Build and run the fail-closed smoke tests:

```sh
rustup target add wasm32-unknown-unknown --toolchain 1.95.0
RUSTUP_TOOLCHAIN=1.95.0 pnpm test
```

The build script discovers `clang`, `clang-18`, or `clang-17`. Set `CC_wasm32_unknown_unknown` when Clang is installed outside `PATH`.

`pnpm test` runs Wrangler's local Worker runtime and checks device-proof session issuance plus verify-time TLSN possession through a synthetic FUSOU-WEB HTTP boundary, strict request validation, invalid/tampered Presentation rejection, user/device authority correlation, atomic single-use consumption including concurrent requests, expiry, identity and Notary fail-closed paths, and missing-configuration failure. FUSOU-WEB route tests cover the generic and TLSN device-auth primitives and reject revoked, invalid-signature, owner-mismatch, malformed-context, and replayed proofs. It does not contact the Game Server or Notary.

## Configuration

Configure these Worker values before deployment:

- `TLSN_BINDINGS` Durable Object binding for `TlsnBindingAuthorityDurableObject`
- `TLSN_BINDING_TTL_SECONDS` between `1` and `3600`
- `TLSN_SERVER_IDENTITY`
- `TLSN_PROFILE_SHA256`
- `TLSN_VERIFIER_KEY_ID`
- `TLSN_NOTARY_KEY_ID`
- `TLSN_NOTARY_REGISTRY`
- `TLSN_TRUST_ROOT_CERTIFICATE_DER` when the configured verification profile requires a custom trust root
- `TLSN_DEVICE_AUTH_URL` set to the FUSOU-WEB device-proof endpoint (`/api/auth/anonymous-sync/v2/device-proof` in the deployed API) for the test/non-production runtime
- `TLSN_DEVICE_POSSESSION_AUTH_URL` set to the dedicated FUSOU-WEB TLSN possession endpoint (`/api/auth/anonymous-sync/v2/tlsn-device-proof` in the deployed API) for the test/non-production runtime
- `TLSN_CANDIDATE_*` deployment values for the production candidate identity, FUSOU-WEB endpoints, Supabase URL/key, and host allowlists
- `TLSN_PRODUCTION_NOTARY_REGISTRY` is the single public Notary registry input for the Production Worker, production evidence verifier, and APP public manifest. The selected `TLSN_CANDIDATE_NOTARY_KEY_ID` entry must be the same alpha.15 public verifying key passed to the APP.
- Production public configuration additionally requires `TLSN_PRODUCTION_NOTARY_ENDPOINT`, `TLSN_PRODUCTION_SESSION_AUTHORITY_ENDPOINT`, `TLSN_PRODUCTION_VERIFICATION_ENDPOINT`, and `TLSN_PRODUCTION_ORIGIN_PORT`. These values are validated offline and emitted as `tlsn-production-public-manifest.json` after a passing preflight.
- `TLSN_SECURITY_REGISTRY_SET_SHA256` for non-secret deployment and trust-registry identity
- `TLSN_TEST_AUTH_USERS` only in `TLSN_ENVIRONMENT=test`, as a JSON map of test bearer tokens to non-anonymous user IDs

- Deployment roles use separate result-signing inputs. Canary requires `TLSN_CANARY_RESULT_SIGNING_PRIVATE_KEY_PKCS8`, `TLSN_CANARY_RESULT_PUBLIC_KEY_SPKI`, `TLSN_CANARY_RESULT_SIGNER_KEY_ID`, and `TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY`. Production requires the corresponding `TLSN_PRODUCTION_RESULT_SIGNING_PRIVATE_KEY_PKCS8`, `TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI`, `TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID`, and `TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY`. The private key is used only by the matching Worker; the public SPKI and registry are published for independent verification.
- A result signing registry is a JSON object with `schema_version: 1`, `scope: "tlsn-result-signing-key-registry"`, and a non-empty `keys` array. Each entry has a unique `key_id`, Ed25519 `public_key_spki`, `status`, `not_before`, and nullable `not_after`. Valid statuses are `ACTIVE`, `VERIFY_ONLY`, `RETIRED`, and `REVOKED`. The configured signer must match an `ACTIVE` registry entry and be inside its validity window. Rotation adds the new `ACTIVE` key while retaining the previous key as `VERIFY_ONLY`; retired or revoked keys cannot sign new results.
- Remote validation uses an independent `TLSN_REMOTE_ATTESTATION_SIGNING_PRIVATE_KEY_PKCS8`. Production receives only `TLSN_ATTESTATION_SIGNER_KEY_ID` and `TLSN_ATTESTATION_SIGNER_PUBLIC_KEY_SPKI` as its trust anchor and never receives the attestation private key. `TLSN_MAX_ATTESTATION_AGE_SECONDS` defaults to `900` and is bounded to `1..86400`.
- Device URLs must use HTTPS, match an allowlisted DNS hostname, contain no credentials/query/fragment/alternate port, and use the exact deployed FUSOU-WEB API paths. `TLSN_CANDIDATE_SUPABASE_URL` must satisfy the same HTTPS and clean-origin policy and match `TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS`. Production does not accept `TLSN_TEST_BINDING_VALUE`. The test environment may use `TLSN_TEST_BINDING_VALUE` only to seed the synthetic fixture binding; it is not a Prover authority.

`TLSN_SUPABASE_PUBLISHABLE_KEY` is a publishable client key, not a service-role key. Do not configure a service-role key in this Worker. Missing production auth configuration fails closed with `503 auth_unconfigured`; missing, unknown, malformed, or anonymous credentials return `401 unauthorized`.

## Production Trust Contract

The following values are the Production source of truth. The raw registry JSON is kept byte-for-byte identical wherever it is captured or compared; its hash is an identity field, not a replacement for the registry contents. Every Notary registry value is canonical base64url for the pinned alpha.15 bincode `tlsn_attestation::signing::VerifyingKey` using the FUSOU Notary `K256` algorithm and compressed SEC1 public key.

| Authority | Public source | Private source | Consumers |
| --- | --- | --- | --- |
| TLSN alpha.15 Notary | `TLSN_PRODUCTION_NOTARY_REGISTRY` plus selected `TLSN_CANDIDATE_NOTARY_KEY_ID` | Notary deployment only | Worker, offline evidence verifier, public manifest, APP selected verifying key |
| Session Authority | `TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_ID`, `TLSN_PRODUCTION_SESSION_AUTHORITY_PUBLIC_KEY_SPKI`, and `TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_REGISTRY` | `TLSN_PRODUCTION_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8` | Worker issuance, offline evidence verifier, public manifest |
| Binding Authority | `TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_ID`, `TLSN_PRODUCTION_BINDING_AUTHORITY_PUBLIC_KEY_SPKI`, and `TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_REGISTRY` | `TLSN_PRODUCTION_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8` | Worker consume receipts, offline evidence verifier; never APP |

The Production workflow connects those public values to preflight and Worker `--var` inputs, and connects the Session/Binding private keys and the existing Result signing private key to the temporary secrets file. No private authority material is written to the public manifest or sent to the APP.

The public manifest schema is:

```json
{
	"schema_version": 1,
	"scope": "tlsn-production-public-config",
	"notary": {
		"endpoint": "host:port",
		"key_id": "...",
		"verifying_key": "...",
		"registry_entry": { "key_id": "...", "verifying_key": "..." },
		"registry_sha256": "..."
	},
	"session_authority": {
		"endpoint": "https://.../attestation/session",
		"key_id": "...",
		"public_key_spki": "...",
		"key_registry_sha256": "..."
	},
	"verification_endpoint": "https://.../verify/tlsn",
	"origin": {
		"server_identity": "...",
		"trust_roots": ["..."],
		"port": 443
	}
}
```

`pnpm run render:app-config` maps this manifest to APP public TLSN settings and receives the local artifact path as a separate argument. APP receives no Binding Authority registry, private key, bearer token, service credential, device key, or Cloudflare credential.

For rotation, publish the new Notary registry and selected key together, then regenerate the public manifest and APP config. For Session or Binding Authority rotation, publish the new public SPKI, key ID, registry, and matching private secret as one deployment unit. The new key must be `ACTIVE`; the previous Session/Binding key may remain `VERIFY_ONLY` for historical receipt verification, but must not issue new receipts. Validate the old/new registry hashes and public-key identities offline before deployment, and retain the previous complete configuration for rollback.

## Deployment preflight

Run the preflight in the same CI environment that supplies the production Worker variables:

```sh
pnpm run preflight:production
```

`scripts/production-inputs.json` is the explicit production input contract and the deploy wrapper's allowlist. The preflight checks required production variables, clean HTTPS URLs and exact FUSOU-WEB paths, DNS allowlists, profile/security digests, Notary registry membership, result-key publication, and the absence of test fixtures, service-role keys, and device-private-key variables. It writes only non-secret failure metadata to `artifacts/tlsn-deployment-preflight.json` or `TLSN_PREFLIGHT_REPORT_PATH`, plus `artifacts/tlsn-production-provenance.json` or `TLSN_PROVENANCE_REPORT_PATH`; it never prints configuration values.

The passing Production preflight also writes the public-only `tlsn-production-public-manifest.json`. It contains the Notary endpoint, selected Notary key ID and registry entry, Session Authority endpoint/key ID/public SPKI and registry hash, Verification Worker endpoint, server identity, trust-root DER bytes, and origin port. It contains no private key, bearer token, service credential, device key, or Cloudflare credential. Use `pnpm run render:app-config -- --manifest <manifest> --output <configs.toml> --artifact-output-path <local-directory>` to create an APP config; the artifact path is intentionally supplied separately because it is APP-local.

Use `pnpm run deploy:production` for the guarded deploy entry point. It runs the preflight, captures the previous production identity, runs remote validation against the canary, verifies the fresh report, deploys only after that gate passes, and performs post-deploy identity and unauthenticated smoke checks. It injects non-secret manifest inputs through Wrangler `--var` and uploads the signing key and trust root through a temporary mode-600 secrets file. Wrangler authentication remains CLI-only; a failed prerequisite cannot deploy.

The complete offline contract check is `pnpm run test:production-roundtrip`. It generates synthetic authority keys and an X.509 root, uses a pinned alpha.15 K256 key, runs Production preflight, validates the public manifest, renders the APP TLSN fragment, parses it through the APP config loader, and requires APP preflight `ready=true`. It does not contact a Game Server, Notary, Worker, Supabase, or any other remote service.

## Remote validation

`scripts/remote-validation.mjs` exercises deployed HTTP boundaries and verifies the returned Ed25519 result independently in Node.js. It writes `artifacts/tlsn-remote-validation.json` with the current workflow run, commit, validation ID, and validation timestamps. Declared `production_evidence` and `p0_05` blocks are report status only; any other blocked or failed check prevents the gate from passing and returns a non-zero exit code. `scripts/verify-remote-gate.mjs` recomputes the Canary provenance and remote report hashes and writes an immutable `tlsn-remote-validation-attestation.json` only after the report passes.

The attestation is schema version 2 with scope `tlsn-remote-validation-attestation`. Its signature covers a fixed canonical JSON payload containing the workflow context, canary provenance hash, remote report hash, security identity hash, validation window, validation ID, and creation time. It carries `signature_algorithm: "Ed25519"`, `attestation_signer_key_id`, and `signature_base64url`. Production verifies the signature against the configured attestation public SPKI, requires the expected workflow context and canary identity, recomputes both artifact hashes, and rejects future or stale validation results.

The verify Worker used by the synthetic fixture may have one fixed `TLSN_TEST_BINDING_VALUE`. Session sampling must use a separate Worker URL without that variable; the harness requires `binding_mode: random` and at least 100 unique session IDs, binding values, and device challenges, so fixed-binding reuse cannot masquerade as a benchmark. The cold/warm WASM metric is explicitly labeled as binding-mismatch measurement and is not valid-verification performance. Concurrent replay uses a separate fixed-binding Worker and requires exactly one success. Payload/resource and per-field signed-result mutation matrices are included. Revocation and expiry checks likewise require separate Worker URLs and disposable test devices; when both run, expiry uses unrevoked User B. Revocation is opt-in and permanently revokes the configured device.

Required harness inputs are supplied through CI secrets or a local secret manager, never committed:

- `TLSN_REMOTE_WORKER_URL`, `TLSN_REMOTE_SESSION_BENCHMARK_URL`, `TLSN_REMOTE_WEB_ORIGIN`, and `TLSN_REMOTE_SUPABASE_URL`
- `TLSN_REMOTE_SUPABASE_PUBLISHABLE_KEY`, `TLSN_REMOTE_ACCESS_TOKEN_A`, `TLSN_REMOTE_DEVICE_ID_A`, and either `TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL` or `TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_FILE`
- `TLSN_REMOTE_FIXTURE_JSON`, `TLSN_REMOTE_RESULT_PUBLIC_KEY_SPKI`, and `TLSN_REMOTE_EXPECTED_MEMBER_ID` (the last value may instead be `expected_member_id` in the fixture)

Set `TLSN_REMOTE_ACCESS_TOKEN_B`, `TLSN_REMOTE_DEVICE_ID_B`, and the corresponding device key to enable cross-user attacks. Set `TLSN_REMOTE_FIXTURE_B_JSON` to a fixture with a different binding value for context swapping. Set `TLSN_REMOTE_REVOCATION_WORKER_URL` and `TLSN_REMOTE_RUN_REVOCATION=true` for verify-time revocation; set `TLSN_REMOTE_EXPIRY_WORKER_URL` and `TLSN_REMOTE_RUN_EXPIRY=true` for expiry. A sanitized log export can be scanned with `TLSN_REMOTE_LOG_EXPORT`.

Run it with:

```sh
pnpm run validate:remote
```

Status: authenticated user ownership `PASS`; authenticated device ownership `PASS`; current device possession proof `PASS, local synthetic scope`; TLSN/device cryptographic binding `PASS, local synthetic scope`; replay/expiry `PASS`; production evidence `BLOCKED`; `P0-05` `BLOCKED`. The remote report always records `production_evidence` and `p0_05` as `BLOCKED`, even when every synthetic check passes. The production trust contract is not complete until the deployed FUSOU-WEB endpoints, production device registry/revocation behavior, production trust material, a Notary key registry, replay/session authority, result-key publication and rotation, and performance evidence are exercised remotely. The test Worker and synthetic evidence do not satisfy that contract.

`production_evidence` is governed by the `tlsn-production-evidence` contract. Its status remains `BLOCKED` until independently captured evidence verifies a real production Game Server connection, TLSN Notary interaction, FUSOU-WEB authentication and device possession, replay and binding authorities, verifier trust root, result signer, public-key publication, and the complete production capture. Passing synthetic checks, signing a remote report, or verifying the attestation does not satisfy these requirements and cannot unlock `production_evidence` or `P0-05`.
The Production job independently verifies the attestation, its artifact hashes, the current workflow context, the Canary/Production security identity match, and the previous-known-good identity change report before deployment. No bypass variable is used for declared blocked evidence, and both `production_evidence` and `p0_05` remain `BLOCKED`.

## Production Evidence Capture

`pnpm run capture:production-evidence` is a standalone evidence verifier. The preferred input is `TLSN_PRODUCTION_EVIDENCE_BUNDLE_PATH`, a directory emitted by FUSOU-APP containing `presentation.bin`, `metadata.json`, the APP-issued `session.json`, `device-authentication.json`, `possession-proof.json`, `worker-verification.json`, `result.json`, and `consume-receipt.json`. Bundle mode consumes the already-used Session and signed Result, so it does not issue a second Session or submit the Presentation for a second first-use verification, and it does not require a device private key. For legacy standalone input, set `TLSN_PRODUCTION_EVIDENCE_PRESENTATION_PATH` to raw Presentation bytes and `TLSN_PRODUCTION_EVIDENCE_PRESENTATION_PROVENANCE_JSON` to its sidecar; that mode requires a registered device private key and performs the first Worker verification itself. Both modes require a real production Worker, FUSOU-WEB and Supabase origins, a non-anonymous access token, the production result signing registry, and `TLSN_PRODUCTION_NOTARY_REGISTRY`. The sidecar must identify `fusou-proxy-production-tlsn`, declare `capture_provenance: "production"`, set `synthetic`, `test`, `canary`, and `local` to `false`, record the exact `POST /kcsapi/api_get_member/require_info HTTP/1.1` profile, include the Presentation SHA-256, and include a separate `proxy_provenance` object. The sidecar is capture metadata, not TLSN authority evidence: without `TLSN_PRODUCTION_PROXY_PROVENANCE_PIN_JSON`, its proxy cryptographic predicate remains `UNVERIFIED`; a self-declared signature cannot become `VERIFIED`. A pin must contain the external Ed25519 public key, signer key ID, proxy identity, deployment ID, and binary identity. Fixture bytes, candidate registries, member IDs, request/response declarations, and metadata-only provenance cannot satisfy this input contract. The alpha.15 verifier derives the server identity, transcript digests/ranges, HTTP profile, and member ID directly from the cryptographically verified Presentation. The authenticated request binding must match the APP-issued Session binding and encoded session ID. The harness independently verifies the signed Result and verifies one-shot replay rejection without making any Game Server request.

The harness never promotes the gate: the manifest governance status, `production_evidence`, `p0_05`, and independent governance status remain `BLOCKED`, including when capture and semantic verification pass. `pnpm run verify:production-evidence` performs offline verification of the manifest signature, trusted workflow/deployment identities, artifact hashes, captured Notary and result registries, captured trust root, alpha.15 Presentation cryptography, strict HTTP semantics, authenticated member derivation, direct Presentation-to-Session freshness, session/device/subject binding, Result-to-Presentation correlation, proxy provenance status, and replay evidence. Synthetic declarations, metadata-only manifests, altered artifacts, stale manifests, wrong signer keys, unrelated Result/Presentation pairings, old Presentations paired with fresh Sessions, and context substitutions are rejected or remain blocked.

The evidence signer uses `TLSN_PRODUCTION_EVIDENCE_SIGNER_KEY_ID`, `TLSN_PRODUCTION_EVIDENCE_SIGNER_PUBLIC_KEY_SPKI`, and `TLSN_PRODUCTION_EVIDENCE_SIGNING_PRIVATE_KEY_PKCS8`. These are separate from both the remote attestation signer and the Worker Result signer; the private key is used only by the capture job and is never sent to the Worker. Live capture credentials and device keys must be supplied through the CI secret manager and are not committed.
