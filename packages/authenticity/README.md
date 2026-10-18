# Authenticity library prototype

This directory is a standalone Rust workspace exploring reusable identity,
authentication, device-proof, and TLSNotary adapter boundaries. It is a local
prototype, not a FUSOU Production integration or a new protocol contract.

## Crates

- `authenticity-core` provides provider-neutral principal, session, device,
  challenge, digest, verification-status, and canonical lowercase DNS
  hostname types. It also provides `is_valid_key_id`, the shared lexical
  check for non-empty ASCII alphanumeric IDs with `.`, `_`, or `-` and a
  maximum length of 128 bytes. This crate targets Rust 1.81 and Edition 2021;
  the other workspace crates remain Edition 2024 and do not inherit that
  compatibility claim.
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

## Existing FUSOU reuse

The APP Runtime Config Manifest validator and HTTPS Proxy Result registry
validator use `authenticity-core::is_valid_key_id` for the identical
1-to-128-byte ASCII syntax they previously implemented locally. Their error
mapping, registry lookup, signer scope, status and validity-window checks,
trust anchors, and signature verification remain in their existing crates.
The Verifier's separate 1-to-64-byte key ID rule is intentionally not migrated.
The core crate has no TLSNotary dependency; the broader authenticity workspace
and its TLSNotary adapter are not established as Rust 1.81 compatible.

## MSRV and publication status

There is no repository-wide MSRV policy, and the versions below distinguish a
manifest declaration from a verified minimum. At this audit, Rust 1.81 was not
installed. The package tests listed here pass on Rust 1.98.1 for the stated
host/feature configuration; they do not establish the lowest supported
compiler.

| Package | Edition | Declared `rust-version` | Current locked dependency evidence | Compiler evidence |
| --- | --- | --- | --- | --- |
| `authenticity-core` | 2021 | 1.81 | Its seven-package closure declares no dependency MSRV above 1.71 (`thiserror` 1.0.69 and proc-macro dependencies). | Workspace tests pass on Linux x86_64 with 1.98.1. Rust 1.81 and a separate downstream consumer build are unverified. |
| `authenticity-auth` | 2024 | unset | The locked closure includes `zeroize` 1.9.1 and `base64ct` 1.8.3, each declaring 1.85. | Workspace tests pass on Linux x86_64 with 1.98.1; minimum unverified. |
| `authenticity-tlsn` | 2024 | unset | `clean-upstream-spike` resolves the pinned TLSN source and `mpz-fields` 0.1.0-alpha.6, declaring 1.95. | The adapter tests pass with that feature on Linux x86_64 with 1.98.1; minimum unverified. |
| `authenticity-consumer-example` | 2024 | unset | It enables `clean-upstream-spike`; its locked graph includes `mpz-fields` 1.95. | Workspace tests pass on Linux x86_64 with 1.98.1; minimum unverified. |

Edition 2024 itself requires a compiler that supports that edition (Rust 1.85
or newer). The package-level dependency evidence can require still newer
compilers. The workspace uses resolver 2 and a shared Edition 2024 default,
while `authenticity-core` explicitly overrides that default with Edition 2021.

The consuming FUSOU packages have separate compatibility constraints:

- APP declares Edition 2021 / Rust 1.81, but its committed lockfile's Linux
  default graph includes `aws-config` 1.12.0 (Rust 1.94.1) through
  `fusou-upload`, `tauri` 2.12.3 (Edition 2024 / Rust 1.90), and `time` 0.3.55
  (Rust 1.88). Its `tlsn-production` feature adds the TLSN path-patched graph,
  including `mpz-fields` 1.95. The manifest declaration is therefore
  inconsistent with the currently resolved build graph.
- Proxy has Edition 2021 but no `rust-version`. Its current local resolution
  includes `hyper-rustls` 0.27.10 (Rust 1.85) and the `aws-config` 1.94.1
  dependency path through `fusou-upload`. Enabling `alpha15-tlsn` also adds
  the TLSN path-patched graph and `mpz-fields` 1.95.
- The TLSN Verifier has Edition 2021 but no `rust-version`. It consumes the
  path-patched TLSN crates, which use Edition 2024; its locked host and
  `wasm32-unknown-unknown` graphs include `mpz-fields` 1.95. The wasm target
  was checked on Rust 1.98.1, not on Rust 1.81.
- The path-patched `tlsn`, `tlsn-core`, `tlsn-attestation`, and `tlsn-mux`
  packages declare Edition 2024 and no `rust-version`. The TLSN graph is tied
  to the pinned alpha.15 source and the pinned `mpz` alpha.6 source; its
  resolved MSRV is feature-dependent.

The APP and Proxy manifests use semver ranges, not MSRV upper bounds. For
example, the APP's `tauri = "2.9.5"` and `time = "0.3.43"` constraints resolve
to newer compatible releases in its lockfile. The key ID migration commit
added the core path package but changed no third-party package versions. The
APP lockfile was introduced as a committed file by the lockfile-reproducibility
change; there is no earlier committed lock graph from which to determine
exactly when each resolved dependency raised its MSRV.

The APP lockfile and authenticity-workspace lockfile are tracked. The Proxy
and TLSN Verifier lockfiles are ignored by the repository. A lockfile
reproduces the repository-root development/test resolution; it does not pin
versions for a downstream project consuming a library. All authenticity
members currently set `publish = false`, so they are not presently
crates.io-publishable packages. The public API and 0.1.0 version do not yet
constitute a published stability or support commitment.

The active APP build matrix uses stable Rust on Ubuntu x86_64/ARM64 and
Windows x86_64/ARM64 runners; the macOS entries are commented out. The
TLSN-candidate preflight separately pins Rust 1.98.1 on Ubuntu and tests APP
with `tlsn-production`. No dedicated authenticity-workspace or Rust 1.81
workflow was found. The local offline all-features metadata resolution for
APP/Proxy is blocked because `tokio-stream` 0.1.19 is not cached; default and
the APP `tlsn-production` and Proxy `alpha15-tlsn` configurations were
inspected separately.

### Recommended policy

Option A is viable for the pure core and preserves reuse by Rust 1.81
projects, but it remains a target rather than a verified guarantee until
Rust 1.81 CI and a downstream consumer pass. Option B would simplify one
workspace policy at the cost of raising the pure-core floor to match the
TLSN stack, unnecessarily excluding older consumers. Package-specific
support (option C) best separates these costs:

1. Keep Rust 1.81 as the `authenticity-core` target only after a Rust 1.81 CI
   job runs the core tests and a minimal external consumer. Its current
   dependency metadata is compatible, but that is not a compiler
   verification. Keep a current-stable workspace job as well.
2. Set and verify separate MSRVs for `authenticity-auth`, the TLSN adapter,
   and examples. The adapter's opt-in `clean-upstream-spike` currently needs
   a much newer graph; a package-level MSRV cannot vary by feature, so either
   document/test the feature floor or split that adapter into a separate
   package before public release.
3. Do not raise the APP's declared minimum or downgrade its dependencies in
   this prototype audit. Keeping 1.81 would require compatible versions across
   its active Tauri, AWS, time, and TLSN graphs plus platform/feature tests.
   Raising it to match the current graph would affect users, local toolchains,
   CI, and release builds; the `tlsn-production` graph already reaches 1.95,
   and the complete all-features ceiling remains unresolved. Either choice
   needs an owner decision and a security/feature review of any downgrades.

Avoid exact dependency pins solely to preserve an unverified MSRV. Maintain
the selected floor with an explicit minimum-toolchain CI job and a dependency
resolution check that does not rely only on the repository lockfile.
This is an evidence-based recommendation, not an owner-approved release
policy. No package MSRV or application dependency was changed in this audit.

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
