# Authenticity library prototype

This directory is a standalone Rust workspace exploring reusable identity,
authentication, device-proof, and TLSNotary adapter boundaries. It is a local
prototype, not a FUSOU Production integration or a new protocol contract.

## Crates

- `authenticity-core` provides provider-neutral principal, session, device,
  challenge, digest, verification-status, and canonical lowercase DNS
  hostname types.
- `authenticity-auth` defines extension points for identity providers, device
  registration lookup, and replay storage. Its authenticator checks the
  returned issuer, audience, anonymous-identity policy, and authentication
  times. A provider implementation remains responsible for validating token
  signatures, issuer/audience claims, and revocation before returning claims.
- `authenticity-tlsn` exposes an optional `clean-upstream-spike` adapter using
  TLSNotary alpha.15 at commit
  `47aee45b53e06648c1b2ad3689b367b8c923fdec`. The adapter rejects oversized,
  malformed, or trailing-byte inputs; checks the supplied serialized Notary
  verifying key; calls the upstream Presentation verifier; matches the
  authenticated server identity to the requested DNS hostname; and extracts
  only bytes covered by authenticated disclosure ranges.
- `consumer-example` composes those interfaces using a local-only identity
  provider, test signing keys, an in-memory device registry, and an in-memory
  replay store. It emits a non-self-authenticating diagnostic report.

## Authentication and device proof

The authentication provider is a trusted extension point, not a token
implementation. `AuthenticationPolicy` compares provider-verified issuer and
audience values exactly and rejects expired, not-yet-valid, or disallowed
anonymous identities.

The draft device challenge binds the authority key ID, principal issuer and
subject, audience, session, device, purpose, challenge ID, nonce, evidence
digest, and timestamps in domain-separated signing bytes. The verifier checks
the authority signature, request/session bindings, challenge lifetime,
registered device status, and strict Ed25519 device proof before consuming
the challenge ID and nonce. A production `ReplayProtectionStore` must consume
both values atomically and durably, and fail closed when unavailable. This
draft encoding is library-local and has not been approved as a FUSOU wire
contract.

This prototype does not enroll or revoke devices, implement a production
identity provider, manage authority keys, or provide a durable replay store.
The example's deterministic keys and in-memory stores are test-only.

## TLSNotary adapter boundary

The adapter takes the expected hostname, serialized Notary verifying key, and
server-certificate trust policy as explicit caller inputs. It does not obtain
them from an Origin Inventory, Target Approval, Notary registry, Runtime
Config, or production trust root. The fixture is synthetic and is derived
from the TLSNotary codebase; it is characterization evidence, not an
independent golden vector or independent implementation oracle.

The clean-upstream adapter is deliberately feature-gated as a spike. A byte
limit and bincode decode limit constrain the encoded input, but they are not an
aggregate heap-allocation or CPU budget. Serde's per-container cautious
preallocation does not establish a total bound for hostile nested sequence
lengths. Until that behavior has a demonstrated bound or a safe upstream
mitigation, this spike must not be exposed to remote attacker-controlled
Presentations or used in Production. The existing FUSOU production
path-patched source is therefore retained; this workspace does not remove or
replace that patch.

## Not implemented

- FUSOU Result or Claim generation, signing, or signature verification.
- Evidence Bundle construction, external Evidence Root verification, or
  independent evidence acceptance.
- Origin Inventory, Target Approval, production Notary/Result registries, or
  signed Runtime Config bootstrap.
- Browser input integrity, APP process/image authority, or authorization
  policy.
- Production Supabase Auth, device registration, key lifecycle, or external
  service operations.

The example's report explicitly labels the fixture and local provider, marks
itself non-self-authenticating, and records Result-signature and Evidence
Bundle verification as `NOT_IMPLEMENTED`.

## Local checks

Run the workspace tests without network access:

```sh
cargo test --manifest-path packages/authenticity/Cargo.toml --workspace --locked --offline
```

To run only the clean-upstream adapter tests:

```sh
cargo test --manifest-path packages/authenticity/Cargo.toml -p authenticity-tlsn --features clean-upstream-spike --locked --offline
```

Passing these tests does not change P0-01, P0-10, the Phase 0 runtime gate,
WASM provenance, Hosted CI, real testplay, or Production acceptance.
