# Cloudflare Verification Worker Trust Boundary

Status: local synthetic verification boundary only

This document describes the FUSOU TLSNotary alpha.15 verification boundary at commit `47aee45b53e06648c1b2ad3689b367b8c923fdec` and the Cloudflare Worker implementation currently tested from commit `3499bce06` onward.

## Scope

The Worker accepts one strict JSON field:

```json
{"presentation_base64":"<base64url without padding>"}
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
- selecting the configured alpha.15 trust root in test mode;
- checking the Presentation Notary key against the configured registry;
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

The profile authenticates the request binding as transcript data. It does not yet compare that value with an external Session/Binding authority.

## Environment separation

`TLSN_ENVIRONMENT` is required and accepts `test` or `production`.

- `test` may use `TLSN_TRUST_ROOT_CERTIFICATE_DER`. This is the path used by the synthetic fixture and must never contain production trust material or credentials.
- `production` currently fails closed as `verifier_unconfigured`. This is intentional because binding authority, replay state, and production Notary operations are not connected to the Worker request path. Production mode must not become a partially trusted mode by configuration alone.
- A missing or malformed registry, profile hash, verifier key, signing key, or required environment value fails closed.

The synthetic root certificate, synthetic server identity, synthetic Notary key, and synthetic member response are test artifacts. They are not production evidence.

## Binding authority and replay

The Rust crate contains an experimental in-process `ExperimentalBindingAuthority` that demonstrates the required semantics: issue a binding for one Session, match the authenticated Session ID and nonce, and consume the binding once. Its tests cover unknown bindings, Session swaps, nonce mismatches, and duplicate consumption.

That authority is not a Cloudflare Worker binding. The current Worker is stateless and does not perform any of these operations:

- lookup of an authority-issued binding;
- Session or challenge ownership validation;
- expiration validation;
- atomic single-use consumption;
- durable used-state storage;
- rejection of a repeated Presentation or attestation ID.

A Durable Object or another strongly consistent authority is required before production correlation can be claimed. Attestation ID, transcript hashes, and the Worker result signature provide audit data, not replay prevention.

## Result signature

The Worker signs only the WASM-produced binary signing bytes. The signing domain is `FUSOU-VERIFIER-RESULT-V1` and includes the authenticated member ID, Session ID, binding nonce and value, server identity, transcript hashes and sizes, disclosed ranges, alpha.15 attestation ID, profile, verifier key ID, and Notary key ID.

The returned result JSON has a fixed canonical property order. Reordering JSON properties does not change the signing bytes. Changing an authenticated signed field invalidates the Ed25519 signature.

This signature authenticates the verifier result to downstream consumers. It does not turn an authorityless binding into an authority-backed binding.

## Verification status matrix

| Boundary | Status | Evidence and limitation |
| --- | --- | --- |
| Pinned alpha.15 Presentation verification | PASS, local synthetic scope | Real alpha.15 `Presentation::verify` passes with the pinned commit. |
| Notary signature cryptography | PASS, local synthetic scope | alpha.15 verifies the embedded signature; synthetic key is now checked against a registry entry. |
| Notary approved-key registry | PASS, local synthetic scope | Worker requires an ID-to-key registry and rejects a mutated registry key. Production registry governance is unavailable. |
| Server certificate trust root | PASS, test scope | Synthetic root works through the explicit test-only trust-root path. Production trust policy is not validated. |
| Authenticated request binding extraction | PASS | Binding is parsed from authenticated request bytes with strict framing and value validation. |
| Authority-backed Session binding | BLOCKED | No Worker-accessible authority lookup or issued-binding comparison exists. |
| Authenticated member ID derivation | PASS | Member ID is parsed only from authenticated response bytes. |
| Disclosure profile enforcement | PASS, full-disclosure scope | Exact request/response parser and full transcript disclosure are enforced. Minimal selective disclosure is not implemented. |
| Verifier result signing | PASS, local synthetic scope | Worker Ed25519 signature verifies independently and binds authenticated fields. |
| Replay and expiry authority | BLOCKED | Worker is stateless; no TTL or atomic single-use state exists. |
| Cloudflare remote runtime | BLOCKED | Local Wrangler `unstable_dev` passes. No dedicated remote test Worker, safe fixture deployment, or observed remote response is recorded. |
| Cloudflare performance and memory | BLOCKED | No remote measurements. Local timings are not production capacity evidence. |
| `TLSN_VERIFICATION_BOUNDARY` | PASS, local synthetic scope only | The local Worker boundary is cryptographically exercised; authority and production claims remain excluded. |
| P0-05 production evidence | BLOCKED | Synthetic success does not satisfy production Game Server evidence. |

## Deployment gate

Do not deploy this Worker as a production verifier until all of the following exist and are tested against the deployed runtime:

1. an authority-backed binding lookup with Session, nonce, expiry, and atomic consume semantics;
2. durable replay state keyed by the authority binding and proof identity;
3. a governed production Notary registry with rotation and rollback procedures;
4. a production server certificate trust policy;
5. a dedicated Cloudflare test Worker and non-production fixture;
6. remote negative tests for identity, Notary key, trust root, binding, replay, malformed input, and signature failures;
7. remote latency, memory, and payload-limit measurements;
8. real Game Server evidence sufficient for P0-05.

## Security impact and rollback

The changes make missing or unapproved Notary configuration fail closed, prevent synthetic custom roots from being used in production mode, and keep production unavailable until missing authority state is connected. They do not add replay protection or authority-backed binding validation.

Rollback is the previous Worker version plus removal of the new test-only registry configuration. Do not roll back by enabling production mode with incomplete authority state. Any registry rotation must deploy the new registry and verifier version together, validate both old and new expected failure paths, and retain the prior Worker version for rollback.

## Validation performed

Local checks currently include:

- Rust verifier unit tests;
- feature-gated synthetic alpha.15 transport tests;
- Wrangler local positive and negative Worker smoke tests;
- independent Ed25519 signature verification;
- Notary registry mismatch rejection;
- production-mode fail-closed testing when configured with synthetic trust material.

These checks establish local behavior only. They do not establish production Game Server authenticity, Cloudflare remote behavior, operational key governance, replay resistance, or P0-05 evidence.
