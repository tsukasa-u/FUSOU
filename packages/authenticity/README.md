# Authenticity library prototype

This directory contains local prototypes for reusable identity,
authentication, device-proof, and TLSNotary adapter boundaries. The
Edition-2024 workspace holds the higher-level crates; `authenticity-core` is
deliberately a separate Cargo workspace so Rust 1.81 consumers do not need to
parse those newer-edition members. This is not a FUSOU Production integration
or a new protocol contract.

## Crates

- `authenticity-core` provides provider-neutral principal, session, device,
  challenge, digest, verification-status, and canonical lowercase DNS
  hostname types. It also provides `is_valid_key_id`, the shared lexical
  check for non-empty ASCII alphanumeric IDs with `.`, `_`, or `-` and a
  maximum length of 128 bytes. It declares Rust 1.81 and Edition 2021 and is
  independently buildable; the other workspace crates remain Edition 2024
  and do not inherit that compatibility claim.
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
manifest declaration from a verified minimum. Rust 1.81 was not initially
installed; a `rustup target list --installed --toolchain 1.81` query
automatically provisioned it during this audit. Rust 1.81 checks and tests
below therefore use that provisioned 1.81.0 toolchain. All Rust 1.81 results
are for Linux x86_64; other operating systems and architectures were not
tested.

| Package | Edition | Declared `rust-version` | Current locked dependency evidence | Compiler evidence |
| --- | --- | --- | --- | --- |
| `authenticity-core` | 2021 | 1.81 | Its seven-package locked graph has only the direct dependency `thiserror` 1.0.69; dependency manifests declare MSRVs no higher than 1.71. It has no crate features or target-specific dependencies. | Rust 1.81.0 `check` passes; 3 unit tests pass and doctests run 0 tests. An independent path consumer compiles and passes 1 API smoke test. Verified only on Linux x86_64 with the tested locked graph. |
| `authenticity-auth` | 2024 | unset | The locked closure includes `zeroize` 1.9.1 and `base64ct` 1.8.3, each declaring 1.85. | Workspace tests pass on Linux x86_64 with 1.98.1; minimum unverified. |
| `authenticity-tlsn` | 2024 | unset | `clean-upstream-spike` resolves the pinned TLSN source and `mpz-fields` 0.1.0-alpha.6, declaring 1.95. | The adapter tests pass with that feature on Linux x86_64 with 1.98.1; minimum unverified. |
| `authenticity-consumer-example` | 2024 | unset | It enables `clean-upstream-spike`; its locked graph includes `mpz-fields` 1.95. | Workspace tests pass on Linux x86_64 with 1.98.1; minimum unverified. |

Edition 2024 itself requires a compiler that supports that edition (Rust 1.85
or newer). The package-level dependency evidence can require still newer
compilers. The higher-level workspace uses resolver 2 and a shared Edition
2024 default. `authenticity-core` is now excluded from that workspace and has
its own resolver-2 workspace with explicit Edition 2021, version, and license
metadata. Before this split, Cargo 1.81 failed while parsing the sibling
`authenticity-auth` Edition-2024 manifest even when asked to check only core.
The split permits a real external path dependency to build core without
changing the higher-level crates' edition or toolchain.

The independent `authenticity-core-consumer-smoke` crate depends only on
`authenticity-core` by path. Its Rust 1.81 test uses the public
`PrincipalId`, `DeviceId`, `SessionId`, `AuthorityKeyId`, `ServerIdentity`,
`IdentityError`, `is_valid_key_id`, `ChallengeId`, `Digest`, and
`VerificationStatus` APIs. `VerificationStatus` distinguishes status enum
variants, but core does not provide a type-level verified-evidence wrapper;
the smoke test does not treat the `Verified` variant as cryptographic proof.
Core also does not implement an authentication provider, TLSNotary
verification, Result signing, or trust policy. Those capabilities remain in
other crates or require external implementations.

The package has one direct dependency (`thiserror = "1.0"`) with its default
features and no optional feature flags. It declares `license = "MIT OR
Apache-2.0"` and `publish = false`; it has no `repository` metadata. The
package's own lockfile supports repeatable local MSRV tests, but neither it
nor the higher-level workspace lockfile constrains a downstream consumer's
dependency resolution. The consumer smoke test generated its own lockfile
under Rust 1.81 and resolved the same `thiserror` 1.0.69 graph. Future
compatible dependency updates still require an MSRV check.

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

The APP lockfile and higher-level authenticity-workspace lockfile are tracked.
The core and consumer-smoke workspaces have separate lockfiles for local
reproducible checks. The Proxy and TLSN Verifier lockfiles are ignored by the
repository. A lockfile reproduces repository tests; it does not pin versions
for a downstream project consuming a library. All authenticity packages
including core and the smoke consumer retain `publish = false`, so none are
presently crates.io-publishable. Core can be consumed from source using a Git
or path dependency, as verified by the smoke crate, but this does not establish
crates.io publication readiness. Before publication, owners must decide
repository metadata, review license-file completeness and package contents,
and complete the applicable security/API review. No such review is claimed
here.

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
projects. The current Linux x86_64 lock graph, unit tests, and independent path
consumer now pass with Rust 1.81.0, but no dedicated MSRV CI job exists, and
future dependency resolutions and non-Linux targets remain unverified.
Option B would simplify one workspace policy at the cost of raising the
pure-core floor to match the TLSN stack, unnecessarily excluding older
consumers. Package-specific support (option C) best separates these costs:

1. Keep Rust 1.81 as the `authenticity-core` declared floor and add a dedicated
   CI job for the core tests and independent consumer. Keep a current-stable
   higher-level workspace job as well; the whole Edition-2024 workspace is not
   expected to load with Rust 1.81.
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
policy. APP and Proxy manifests/dependencies and the higher-level crates'
MSRV declarations were not changed in this audit.

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

Run the higher-level workspace tests without network access:

```sh
cargo test --manifest-path packages/authenticity/Cargo.toml --workspace --locked --offline
```

The Rust 1.81 core package and independent path consumer have separate
workspaces and lockfiles; run both explicitly:

```sh
cargo +1.81 test --manifest-path packages/authenticity/authenticity-core/Cargo.toml --locked --offline
cargo +1.81 test --manifest-path packages/authenticity/authenticity-core-consumer-smoke/Cargo.toml --locked --offline
```

To run only the clean-upstream adapter tests:

```sh
cargo test --manifest-path packages/authenticity/Cargo.toml -p authenticity-tlsn --features clean-upstream-spike --locked --offline
```

Passing these tests does not change P0-01, P0-10, the Phase 0 runtime gate,
WASM provenance, Hosted CI, real testplay, or Production acceptance.
