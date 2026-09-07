# Cloudflare Verification Worker Trust Boundary

Status: local synthetic verification boundary plus remote test Worker validation; production blocked

This document describes the FUSOU TLSNotary alpha.15 verification boundary at commit `47aee45b53e06648c1b2ad3689b367b8c923fdec` and the Cloudflare Worker implementation currently tested from commit `3499bce06` onward.

## Scope

The Worker issues a one-shot Session/Binding context at `/attestation/session` and accepts this strict JSON shape at `/verify/tlsn`:

```json
{"presentation_base64":"<base64url without padding>","session_id":"<UUIDv4>","binding":"<base64url without padding>"}
```

The Rust/WASM verifier is responsible for:

- decoding exactly one alpha.15 `Presentation` with no trailing bytes;
- verifying the alpha.15 Presentation and its Notary signature;
- verifying the authenticated server identity against the configured identity;
- requiring complete transcript disclosure for the current profile;
- parsing the exact `require_info` request and response bytes;
- deriving `binding_value` from the authenticated request transcript;
- deriving `verified_member_id` only from the authenticated response transcript;
- producing canonical result JSON and domain-separated signing bytes.

The Worker is responsible for:

- strict request and configuration parsing;
- selecting test or production-specific alpha.15 trust configuration;
- checking the Presentation Notary key against the configured registry;
- issuing and looking up Session/Binding records through a Durable Object;
- matching authority state against authenticated Session ID, nonce, and binding value;
- atomically consuming an active binding after proof verification and before returning the result;
- signing only WASM-produced signing bytes with the configured Ed25519 key;
- returning generic failure responses and `Cache-Control: no-store` on success.

## Trust model

A valid alpha.15 proof authenticates the TLS connection, the disclosed server identity, and the disclosed transcript bytes. It does not by itself prove that a binding was issued for a FUSOU Session, that a proof is being used for the first time, or that the Notary is an approved FUSOU Notary.

The Worker now enforces the Notary part with an explicit registry. `TLSN_NOTARY_KEY_ID` selects an entry in `TLSN_NOTARY_REGISTRY`. Each entry is URL-safe base64 of the exact bincode serialization of the pinned alpha.15 `tlsn_attestation::signing::VerifyingKey`. The WASM verifier compares that registry value with `Presentation::verifying_key()` before accepting the Presentation.

The result field `notary_key_id` is therefore meaningful only when the registry lookup succeeds. It is not, by itself, a trust anchor.

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
- `production` selects only `TLSN_PRODUCTION_*` fields and requires a production trust root. No production Worker deployment or production trust material has been performed in this phase.
- A missing or malformed registry, profile hash, verifier key, signing key, or required environment value fails closed.

The synthetic root certificate, synthetic server identity, synthetic Notary key, and synthetic member response are test artifacts. They are not production evidence.

## Binding authority and replay

The Rust crate contains an experimental in-process `ExperimentalBindingAuthority` that demonstrates the required semantics: issue a binding for one Session, match the authenticated Session ID and nonce, and consume the binding once. Its tests cover unknown bindings, Session swaps, nonce mismatches, and duplicate consumption.

The Worker now uses `TlsnBindingAuthorityDurableObject`, one strongly consistent DO instance per SHA-256(binding value). The DO stores the Session ID, nonce, binding, creation and expiry timestamps, status, used timestamp, and Presentation ID. Lookup performs request-time expiry checks; an alarm marks expired records, and a storage transaction makes consume single-use under concurrent requests.

Local Wrangler tests and the remote test Worker observed the following: unknown binding and Session mismatch are rejected, expired bindings return `binding_expired`, two concurrent requests produce exactly one success and one `binding_consumed`, and a subsequent duplicate is rejected. These are test-authority results only; they do not establish production operational readiness.

## Result signature

The Worker signs only the WASM-produced binary signing bytes. The signing domain is `FUSOU-VERIFIER-RESULT-V1` and includes the authenticated member ID, Session ID, binding nonce and value, server identity, transcript hashes and sizes, disclosed ranges, alpha.15 attestation ID, profile, verifier key ID, and Notary key ID.

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
| Authority-backed Session binding | PASS, local and remote test scope | Durable Object lookup compares client context with authenticated Session ID, nonce, and binding value. Production authority operations are not deployed. |
| Authenticated member ID derivation | PASS | Member ID is parsed only from authenticated response bytes. |
| Disclosure profile enforcement | PASS, full-disclosure scope | Exact request/response parser and full transcript disclosure are enforced. Minimal selective disclosure is not implemented. |
| Verifier result signing | PASS, local synthetic scope | Worker Ed25519 signature verifies independently and binds authenticated fields. |
| Replay and expiry authority | PASS, local and remote test scope | Local and remote tests observed atomic concurrent consume, duplicate rejection, and `410 binding_expired`. |
| Cloudflare remote runtime | PASS, test Worker only | `fusou-tlsn-verification-test` returned remote Session `201`, positive verification `200`, replay `422 binding_consumed`, concurrent `[200, 422]`, and expiry `410 binding_expired`. |
| Cloudflare performance and memory | PARTIAL, remote test scope | Three synthetic samples: Session/authority latency min/median/max `543/579/604 ms`; verification total `136/185/246 ms`; request bytes `2570/2573/2575`; response `1656` bytes. WASM init and memory were not exposed by the Worker and remain unmeasured. |
| `TLSN_VERIFICATION_BOUNDARY` | PASS, local and remote test scope only | Cryptography and authority paths were exercised with synthetic evidence; production claims remain excluded. |
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

## Security impact and rollback

The changes make missing or unapproved Notary configuration fail closed, prevent synthetic custom roots from being selected through production configuration, and add durable test-authority correlation and replay protection. They do not establish production trust material, production key governance, or P0-05 evidence.

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
- remote test Worker checks for positive verification, replay, concurrent consume, expiry, and observed latency/payload samples.

These checks establish synthetic local behavior and the deployed test Worker only. They do not establish production Game Server authenticity, production operational key governance, production memory or payload limits, or P0-05 evidence.
