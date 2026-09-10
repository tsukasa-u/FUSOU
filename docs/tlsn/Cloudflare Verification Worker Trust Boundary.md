# Cloudflare Verification Worker Trust Boundary

Status: local synthetic verification boundary with authenticated user and device ownership; production remains blocked

This document describes the FUSOU TLSNotary alpha.15 verification boundary at commit `47aee45b53e06648c1b2ad3689b367b8c923fdec` and the current Cloudflare Worker implementation in this working tree.

## Scope

The Worker requires a Supabase Bearer access token on `/attestation/session` and `/verify/tlsn`. It resolves the token through Supabase `/auth/v1/user`, rejects anonymous users, and uses the returned `auth.users.id` as the canonical user subject. Session issuance forwards the existing FUSOU device proof to FUSOU-WEB's generic `/api/auth/anonymous-sync/v2/device-proof` endpoint in the deployed API. Each issued Session also contains a fresh 32-byte TLSN device challenge, returned as a 43-character base64url `device_challenge`. Verification requires a separate TLSN-specific device proof signed over the current device, Session, binding, and challenge context:

```json
{"presentation_base64":"<base64url without padding>","session_id":"<UUIDv4>","device_id":"<UUIDv4>","binding":"<base64url without padding>","device_proof":{"challenge":"<43-char base64url>","sig":"<base64 signature>"}}
```

The Worker checks that `device_proof.challenge` equals the challenge issued for the Session/Binding. It forwards the proof context to FUSOU-WEB's dedicated `/api/auth/anonymous-sync/v2/tlsn-device-proof` endpoint, which proves current private-key possession against the existing `user_devices` row. The endpoint verifies the device signature and consumes the canonical message digest; it is not the generic session-issued HMAC nonce and cannot be reused across Sessions or bindings.

The Rust/WASM verifier is responsible for:

- decoding exactly one alpha.15 `Presentation` with no trailing bytes;
- verifying the alpha.15 Presentation and its Notary signature;
- verifying the authenticated server identity against the configured identity;
- requiring complete transcript disclosure for the current profile;
- parsing the exact `require_info` request and response bytes;
- deriving `binding_value` from the authenticated request transcript;
- deriving `verified_member_id` only from the authenticated response transcript;
- carrying the backend-derived device identity into the canonical result;
- producing canonical result JSON and domain-separated signing bytes.

The Worker is responsible for:

- strict request and configuration parsing;
- selecting test or production-specific alpha.15 trust configuration;
- checking the Presentation Notary key against the configured registry;
- issuing and looking up Session/Binding records through a Durable Object;
- matching authority state against authenticated user, device, Session ID, nonce, and binding value;
- requiring a fresh TLSN device challenge and matching the authenticated WASM result's `device_challenge` to the request proof;
- delegating current device private-key possession, ownership, revocation, and TLSN proof replay to FUSOU-WEB;
- atomically consuming an active binding after proof verification and before returning the result;
- signing only WASM-produced signing bytes with the configured Ed25519 key;
- returning generic failure responses and `Cache-Control: no-store` on success.

The Worker does not establish device authority itself. FUSOU-WEB remains the existing device-auth authority and uses no new TLSN device registry. Its generic bearer-bound endpoint resolves the device row from `user_devices`, requires the non-anonymous bearer user to equal `canonical_user_id`, rejects `revoked_at`, verifies the existing HMAC challenge nonce and DB public key's Ed25519 signature, consumes `(device_id, nonce)`, and returns only the DB-derived device ID for Session issuance. Its dedicated TLSN endpoint repeats the owner and revocation checks, verifies Ed25519 over the canonical `FUSOU-TLSN-DEVICE-PROOF-V1\0` message, and consumes `SHA-256(message)` through the same `anon_sync_nonce_consumptions` table. The standalone Worker has no Supabase service-role key and no device private key. A client-supplied device ID is only a lookup/proof selector and must match the backend result, WASM result, and Durable Object record.

## Trust model

A valid alpha.15 proof authenticates the TLS connection, the disclosed server identity, and the disclosed transcript bytes. It does not by itself prove that a binding was issued for a FUSOU Session, that a proof is being used for the first time, or that the Notary is an approved FUSOU Notary.

The Worker now enforces the Notary part with an explicit registry. Test/non-production uses `TLSN_NOTARY_KEY_ID` and `TLSN_NOTARY_REGISTRY`; Production uses the canonical `TLSN_CANDIDATE_NOTARY_KEY_ID` selection from `TLSN_PRODUCTION_NOTARY_REGISTRY`. The same Production registry bytes are supplied to the offline evidence verifier, while the public manifest carries its selected entry and registry hash for APP configuration. Each entry is URL-safe base64 of the exact bincode serialization of the pinned alpha.15 `tlsn_attestation::signing::VerifyingKey`. The WASM verifier compares that registry value with `Presentation::verifying_key()` before accepting the Presentation.

The result field `notary_key_id` is therefore meaningful only when the registry lookup succeeds. It is not, by itself, a trust anchor. The result also contains `canonical_user_id`, `device_id`, and the 32-byte `device_challenge`, which are generated or checked from the authenticated Supabase user, FUSOU-WEB device proof, and Session authority respectively and included in the canonical JSON and Ed25519 signing bytes.

### Production authority contract

Production has three separate signing authorities:

- Session Authority: `TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_ID`, public SPKI, and key registry are the public source of truth; `TLSN_PRODUCTION_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8` is the Worker-only signing secret. The Worker issues Session receipts and the offline evidence verifier checks them against the same registry.
- Binding Authority: `TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_ID`, public SPKI, and key registry are the public source of truth; `TLSN_PRODUCTION_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8` is the Worker-only signing secret. The Worker signs consume receipts and the offline evidence verifier checks them. APP receives none of this material.
- Result signer: the role-specific Production Result public key, registry, and private key remain separate from both authority registries.

The Production workflow supplies the public values as Worker configuration and the private values as secrets. A successful offline preflight emits `tlsn-production-public-manifest.json`, whose schema contains only the Notary endpoint/selected key/registry hash, Session endpoint/key/hash, Verification endpoint, server identity, trust-root DER bytes, and origin port. The APP renderer consumes that manifest and receives its artifact directory separately.

Rotation is atomic at the configuration-contract level: publish the new registry and selected key, matching public SPKI/key ID and private secret, regenerate the manifest and APP config, then validate the new identities offline. The new authority key must be `ACTIVE`; the prior key may remain `VERIFY_ONLY` for historical receipt verification and must not issue new receipts. Keep the previous complete registry/configuration for rollback.

## Disclosure profile

Profile ID: `fusou-require-info-v1`

The authenticated request must contain all of the following exact semantics:

- method `POST`;
- target `/kcsapi/api_get_member/require_info`;
- HTTP/1.1 framing;
- exactly one `Host` header matching the configured authenticated server identity;
- exactly one `X-Attestation-Binding` header;
- a strict FUSOU binding value with UUIDv4 Session ID and a 32-byte nonce;
- a valid `Content-Length` header and body framing;
- no conflicting transfer framing or trailing bytes.

The authenticated response must contain an accepted status, exact framing, the expected `svdata=` prefix, valid JSON, and one canonical numeric `api_member_id` at the required path. The current alpha.15 adapter requires the entire sent and received transcripts to be disclosed. Selective ranges are not accepted as a substitute for the parser input.

The profile authenticates the request binding as transcript data. The Worker compares that authenticated value and Session ID with the external Session/Binding authority before consuming the binding.

## Environment separation

`TLSN_ENVIRONMENT` is required and accepts `test` or `production`. `TLSN_BINDING_TTL_SECONDS` is bounded to one hour. `TLSN_BINDINGS` points to the SQLite-backed Durable Object authority.

- `test` may use `TLSN_TRUST_ROOT_CERTIFICATE_DER`. This is the path used by the synthetic fixture and must never contain production trust material or credentials.
- `test` may use `TLSN_TEST_BINDING_VALUE` only to seed the deterministic synthetic fixture. It is not a Prover authority and is rejected when production configuration is selected.
- `production` selects only `TLSN_PRODUCTION_*` fields and requires a production trust root. It also requires `TLSN_SUPABASE_URL` and `TLSN_SUPABASE_PUBLISHABLE_KEY`; no service-role key is accepted or needed. No production Worker deployment or production trust material has been performed in this phase.
- A missing or malformed registry, profile hash, verifier key, signing key, or required environment value fails closed.

The synthetic root certificate, synthetic server identity, synthetic Notary key, and synthetic member response are test artifacts. They are not production evidence.

## Binding authority and replay

The Rust crate contains an experimental in-process `ExperimentalBindingAuthority` that demonstrates the required semantics: issue a binding for one Session, match the authenticated Session ID and nonce, and consume the binding once. Its tests cover unknown bindings, Session swaps, nonce mismatches, and duplicate consumption.

The Worker now uses `TlsnBindingAuthorityDurableObject`, one strongly consistent DO instance per SHA-256(binding value). The DO stores the Session ID, canonical user ID, device ID, nonce, binding, creation and expiry timestamps, status, used timestamp, Presentation ID, and a fresh TLSN device challenge. Lookup performs request-time expiry checks and compares the authenticated user and device before verification; an alarm marks expired records, and a storage transaction makes consume single-use under concurrent requests. User, device, session, nonce, and consumed-binding conflicts return HTTP `409`.

Device proof replay and TLSN binding replay are separate one-shot authorities. FUSOU-WEB consumes the canonical device-proof digest before the Worker consumes the Durable Object binding. Therefore a repeated or concurrently losing device proof can return `device_proof_replayed` even when the binding itself has not yet been consumed. This ordering preserves one-shot semantics for both state machines; it may intentionally burn a valid device proof if a later binding-consume race loses.

Local Wrangler tests observed the following: missing and unknown authentication are rejected, a binding cannot cross users, unknown binding and Session mismatch are rejected, expired bindings return `binding_expired`, two concurrent requests produce exactly one success and one `binding_consumed`, and a subsequent duplicate is rejected. These are synthetic test-authority results only; they do not establish production operational readiness.

## Result signature

The Worker signs only the WASM-produced binary signing bytes. The signing domain is `FUSOU-VERIFIER-RESULT-V1` and includes the canonical user ID, backend-derived device ID, 32-byte TLSN device challenge, authenticated member ID, Session ID, binding nonce and value, server identity, transcript hashes and sizes, disclosed ranges, alpha.15 attestation ID, profile, verifier key ID, and Notary key ID.

The returned result JSON has a fixed canonical property order. Reordering JSON properties does not change the signing bytes. Changing an authenticated signed field invalidates the Ed25519 signature.

This signature authenticates the verifier result to downstream consumers after authority correlation and consume. It does not turn synthetic evidence or test authority state into production evidence.

## Verification status matrix

| Boundary | Status | Evidence and limitation |
| --- | --- | --- |
| Pinned alpha.15 Presentation verification | PASS, local synthetic scope | Real alpha.15 `Presentation::verify` passes with the pinned commit. |
| Notary signature cryptography | PASS, local synthetic scope | alpha.15 verifies the embedded signature; synthetic key is now checked against a registry entry. |
| Notary approved-key registry | PASS, local synthetic scope | Worker requires an ID-to-key registry and rejects a mutated registry key. Production registry governance is unavailable. |
| Server certificate trust root | PASS, test scope | Synthetic root works through the explicit test-only trust-root path. Production trust policy is not validated. |
| Authenticated request binding extraction | PASS | Binding is parsed from authenticated request bytes with strict framing and value validation. |
| Authority-backed Session binding | PASS, local test scope | Durable Object lookup compares authenticated user context with authenticated Session ID, nonce, and binding value. Production authority operations are not deployed. |
| Authenticated member ID derivation | PASS | Member ID is parsed only from authenticated response bytes. |
| Disclosure profile enforcement | PASS, full-disclosure scope | Exact request/response parser and full transcript disclosure are enforced. Minimal selective disclosure is not implemented. |
| Verifier result signing | PASS, local synthetic scope | Worker Ed25519 signature verifies independently and binds authenticated fields. |
| Replay and expiry authority | PASS, local test scope | Local tests observed atomic concurrent consume, duplicate rejection, and `410 binding_expired`. |
| Authenticated user ownership | PASS | Local tests reject missing/unknown credentials, reject cross-user binding use, and reject signed canonical-user mutation. |
| Authenticated device ownership | PASS | FUSOU-WEB route tests exercise the existing challenge, DB public-key, owner, revocation, signature, and nonce-consumption path; Worker smoke tests bind the returned device ID into the Durable Object and signed result. The synthetic bridge is not production evidence. |
| Current device possession proof | PASS, local synthetic scope | Each Session receives a fresh DO challenge; Worker smoke and FUSOU-WEB route tests verify Ed25519 possession over the current Session/binding/challenge context using the existing `user_devices` authority. |
| TLSN/device cryptographic binding | PASS, local synthetic scope | The challenge is passed into WASM, included in the signed verifier result, compared at the Worker boundary, and bound to the FUSOU-WEB proof message. |
| Replay/expiry | PASS | Device-proof digest consumption and Durable Object binding consumption are independently atomic; local tests cover replay, concurrent use, and expiry. |
| Cloudflare remote runtime | NOT RUN in this phase | No authenticated remote Worker validation or production deployment was performed. |
| Cloudflare performance and memory | UNMEASURED | No remote performance or memory evidence was collected in this phase. |
| `TLSN_VERIFICATION_BOUNDARY` | PASS, local synthetic scope only | Cryptography, authenticated user/device ownership, and authority paths were exercised with synthetic evidence; production claims remain excluded. |
| Production evidence | BLOCKED | No production trust material, deployed authority evidence, or remote runtime validation exists. |
| P0-05 production evidence | BLOCKED | Synthetic success does not satisfy production Game Server evidence. |

## Deployment gate

Do not deploy this Worker as a production verifier until all of the following exist and are tested against the deployed runtime:

1. production authority configuration and operational ownership for Session, nonce, expiry, and atomic consume semantics;
2. durable production replay state keyed by the authority binding and proof identity;
3. a governed production Notary registry with rotation and rollback procedures;
4. a production server certificate trust policy;
5. a dedicated Cloudflare test Worker and non-production fixture;
6. remote negative tests for identity, Notary key, trust root, binding, replay, malformed input, and signature failures;
7. remote memory and payload-limit measurements, plus broader latency evidence;
8. real Game Server evidence sufficient for P0-05.
9. deployed FUSOU-WEB generic and TLSN device-proof endpoints with remote tests for revoked, owner-mismatched, invalid-signature, stale, context-tampered, and replayed proofs;

## Security impact and rollback

The changes make missing or unapproved Notary configuration fail closed, prevent synthetic custom roots from being selected through production configuration, add durable user/device authority correlation and replay protection, and keep Supabase service-role credentials and device private keys out of the standalone Worker. They do not establish production trust material, production key governance, or P0-05 evidence.

Rollback is the previous Worker version plus removal of the new test-only registry configuration. Do not roll back by enabling production mode with incomplete authority state. Any registry rotation must deploy the new registry and verifier version together, validate both old and new expected failure paths, and retain the prior Worker version for rollback.

## Validation performed

Checks currently include:

- Rust verifier unit tests;
- feature-gated synthetic alpha.15 transport tests;
- Wrangler local positive and negative Worker smoke tests;
- independent Ed25519 signature verification;
- Notary registry mismatch rejection;
- production-mode fail-closed testing without production trust configuration;
- local DO tests for context mismatch, expiry, duplicate, and concurrent consume;
- FUSOU-WEB generic and TLSN device-proof tests for owner mismatch, revocation, invalid signature, malformed context, and atomic replay;
- local synthetic Worker checks for positive device binding, signed device-ID tampering, missing device proof, context tampering, replay, concurrent consume, and expiry.

These checks establish synthetic local behavior only. They do not establish production Game Server authenticity, production operational key governance, production memory or payload limits, remote Worker behavior, or P0-05 evidence.
