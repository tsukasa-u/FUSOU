# TLSNotary alpha.15 revision, Attestation ID, and interoperability audit

## Current dispositions

| Item | Status | Evidence and remaining condition |
| --- | --- | --- |
| P0-01 technical revision mapping | `PASS` for the factual source map; `P0-01` remains `BLOCKED_EXTERNAL_INPUTS` | The upstream tag/commit and dependency graph are identified below. The verifier executes local path-patched TLSN sources that diverge from upstream; independent compatibility, security, and license approval is still required. |
| P0-02 Attestation ID contract | `PASS_LOCAL_TESTS` | The exact upstream type/API, 16-byte length, upstream binary fixture, independently extracted ID, canonical JSON encoding, and Node invocation of the packaged Rust/WASM verifier are covered locally. |
| P0-10 cross-language determinism | `UNRESOLVED` | The upstream Presentation/Attestation ID boundary and a Node-produced, test-only Result registry envelope now have Node-to-packaged-Rust/WASM/Rust verifier coverage. The latter is only the outer registry envelope; it is not an inner Result signature golden. Result v2/v3, Session, Claim, receipt, transcript-range, canonical JSON, and signing-byte corpus remains incomplete. |
| Phase 0 runtime gate | `BLOCKED` | The P0-02 local contract evidence does not approve the locally patched TLSN revision or satisfy the other Phase 0 gates. Production acceptance remains `NO-GO`. |

The earlier `0/17 PASS` assessment described the state before this audit. P0-02 now has local test evidence; it does not change the Production runtime gate, for which no Phase 0 acceptance is claimed.

## Audit execution snapshot

- Repository: `tsukasa-u/FUSOU`; branch: `tlsn-first-testplay-candidate`.
- Start HEAD: `ef8bb412bd591cef84a1159e0f5edc2efe9c305b`.
- Start upstream comparison: `origin/tlsn-first-testplay-candidate`, equal to HEAD (`0` ahead / `0` behind).
- At start, the only worktree change was the user-owned
  `packages/FUSOU-APP/src-tauri/roaming/user/configs.toml`; no paths were staged.
  Its contents were not read, and it was not modified, formatted, staged, or
  committed during this audit.
- No branch merge/rebase, Hosted CI, Production operation, R2 access, Notary
  operation, or real Game Server testplay was performed.

## P0-01: pinned upstream revision and actual source path

The upstream reference is `https://github.com/tlsnotary/tlsn`, tag
`v0.1.0-alpha.15`, resolving to commit
`47aee45b53e06648c1b2ad3689b367b8c923fdec`. The tag identity was checked
against the commit. The direct manifests for `tlsn`, `tlsn-attestation`, and
`tlsn-core` name this revision.

That declaration is not the complete runtime source identity:

- APP, Proxy, and Verifier manifests patch `tlsn`, `tlsn-attestation`, and
  `tlsn-core` to local paths under `packages/tlsn-alpha15-sparse`. Cargo.lock
  therefore does not identify those patched source files as an upstream Git
  checkout.
- The local `tlsn-core` `transcript.rs` and `transcript/proof.rs` differ from
  the pinned upstream files. Upstream partial transcripts materialize an
  original-length buffer with zeroes in undisclosed positions; FUSOU stores
  authenticated bytes packed by range and verifies hash openings through
  `copy_authenticated_to`, rejecting unauthenticated reads. The explicit
  materialization methods are compatibility operations, not the cryptographic
  verification path.
- The compressed transcript fields retain the apparent upstream field order,
  but no cross-revision golden bincode corpus proves serialized sparse
  Presentation compatibility. Verification of the checked-in upstream full
  Presentation proves that fixture works with this local backend only; it does
  not establish complete upstream/fork wire compatibility.
- APP and Proxy also patch `tlsn-mux` to `packages/tlsn-mux-alpha15`. Its
  manifest names `tlsn-utils` but the path-patched source is not independently
  identified by a Git SHA in Cargo.lock. The lockfiles identify the related
  upstream `tlsn-utils` revision as
  `64722f7de999cbd41c0cab7312dade306d50ea5f`, but that alone does not prove
  the local path contents are byte-identical.
- Related locked revisions include `rs-merkle`
  `85f3e827451e18c21f110068b4322fb99d2f0a8c` and `mpz`
  `6ebfe619490c3155a589fc6a3be83b0976de19dc` (`v0.1.0-alpha.6`).

The feature path is APP `tlsn-production` to Proxy `alpha15-tlsn`; the
Proxy and Verifier manifests resolve the TLSN crates through their local
patches. The effective patched source, rather than the manifest's `git` line
alone, is therefore part of the implementation under review.

The upstream alpha.15 README declares MIT OR Apache-2.0 for the repository;
the `tlsn-attestation` package manifest does not independently declare a
license field. The upstream GitHub Security page had no published security
policy and no published advisory at the time it was checked. Absence of an
advisory or policy is not evidence of a security audit or safety. No
independent FUSOU security/license approver's review was present in the
repository evidence examined here.

Sources inspected:

- [TLSNotary alpha.15 release](https://github.com/tlsnotary/tlsn/releases/tag/v0.1.0-alpha.15)
- [Pinned upstream source tree](https://github.com/tlsnotary/tlsn/tree/47aee45b53e06648c1b2ad3689b367b8c923fdec)
- [Upstream README and license statement](https://github.com/tlsnotary/tlsn/blob/47aee45b53e06648c1b2ad3689b367b8c923fdec/README.md)
- [Upstream security policy](https://github.com/tlsnotary/tlsn/security/policy)
- [Upstream security advisories](https://github.com/tlsnotary/tlsn/security/advisories)
- Local effective dependency sources: `packages/FUSOU-TLSN-VERIFIER/Cargo.toml`,
  `packages/FUSOU-PROXY/proxy-https/Cargo.toml`,
  `packages/FUSOU-APP/src-tauri/Cargo.toml`,
  `packages/tlsn-alpha15-sparse/crates/core/src/transcript.rs`,
  `packages/tlsn-alpha15-sparse/crates/core/src/transcript/proof.rs`, and
  `packages/tlsn-mux-alpha15`.

**Approval required before P0-01 can pass:** an authorized reviewer must
approve (1) the upstream alpha.15 revision, (2) the exact local sparse
`tlsn-core` changes and their proof/wire compatibility, (3) the local
`tlsn-mux` source identity/diff, (4) the dependency license posture, and
(5) security/advisory and operational risk. No dependency or lockfile was
updated to make tests pass.

## P0-02: Attestation ID extraction contract

At the pinned upstream source, `tlsn_attestation::Uid` wraps `[u8; 16]`.
The Notary assigns the UID when it constructs the Attestation; this value is
not a hash of the transcript, Presentation, Result, or server identity.
After successful `Presentation::verify`, FUSOU reads
`output.attestation.header.id.0`. It preserves the 16 raw bytes without
hashing, truncation, byte-order conversion, or other transformation.

The input is the exact serialized Presentation bytes. The Rust adapter
deserializes the bincode object, rejects trailing bytes, calls
`Presentation::verify`, then reads the typed `header.id.0` field. There is no
raw Presentation byte offset or `N`-byte slice to guess: the fixed length is
the upstream `Uid([u8; 16])` field type. The Rust Result carries those raw 16
bytes. Rust/WASM JSON encodes them with `URL_SAFE_NO_PAD`, producing canonical,
unpadded base64url; no hash or other transform occurs before encoding. Node
rejects non-string values, invalid/noncanonical base64url, padding, any
decoded length other than 16, and any mismatch between the ID from the
verified Presentation and the ID in the verifier Result.

The shared vector
`packages/FUSOU-TLSN-VERIFIER/fixtures/tlsn-alpha15-attestation-id-vector.json`
records:

- official source repository, tag, commit, and fixture path;
- upstream Git blob SHA-1, exact byte length, and raw Presentation SHA-256;
- the upstream `Uid([u8; 16])` contract and extraction API;
- the verified raw ID hex/base64url values and observed server name.

The Rust test deserializes and verifies the checked-in upstream binary and
checks the source digest, raw ID, ID length, encoding, server name, and
serialized Notary verifying key. The Node test independently checks the source
file identity, canonical encoding, and malformed/mismatched ID rejection. It
also passes the exact Presentation bytes and vector Notary key to the checked-in
Rust/WASM verifier and checks the returned server identity and Attestation ID;
mutated Presentation bytes and a mutated trusted Notary key are rejected. This
is direct Node-to-packaged-Rust/WASM fixture coverage, not an independent
JavaScript implementation of TLSNotary verification. The expected ID is a
vector for this specific upstream fixture, not a universal fixed Attestation
ID.

The ID value was also independently extracted during this audit by a temporary
Cargo package outside the FUSOU workspace. It depended directly on
`tlsn-attestation` from commit
`47aee45b53e06648c1b2ad3689b367b8c923fdec`, with no FUSOU `[patch]` entries,
deserialized the same upstream fixture, called
`Presentation::verify(&CryptoProvider::default())`, and read
`output.attestation.header.id.0`. The upstream-only executable output
`effe1a316b1c91b41f6284f78409c6c2`, independently matching the vector. The
scratch project and its temporary lock/target files were removed; no repository
lockfile was changed.

Invalid Presentation encoding, truncation, trailing bytes, or failed
Presentation verification is rejected before the ID can be used. The
fixed-size type and downstream Result validation reject IDs of other lengths.
The contract is specific to the alpha.15 source revision; an upgrade requires
a new source review and vectors rather than silently inheriting this contract.

## P0-10: cross-language determinism boundary

### Evidence exercised in this audit

| Vector or path | Expected-data source | Rust path | Node path | Result and limit |
| --- | --- | --- | --- | --- |
| `tlsn-alpha15-attestation-id-vector.json` | Exact upstream alpha.15 Presentation bytes identified by Git blob SHA-1 and SHA-256; expected ID was separately extracted using the pinned upstream source without FUSOU Cargo patches. | `tlsn_alpha15.rs::real_alpha15_fixture_verifies_with_pinned_backend` verifies the Presentation, server identity, ID bytes, encoding, and serialized Notary key. | `production-evidence-attestation-id-test.mjs` checks the fixture digests and ID contract, invokes the packaged Rust/WASM verifier, compares its identity/ID output, and rejects Presentation/key mutations. | Local fixture and Node/WASM boundary pass. The packaged artifact's correspondence to the current Rust source is not established; see below. |
| Node-produced Result registry envelope in `tlsn-runtime-config-independent-v2-vector.json` | Fixed `test_only: true` Runtime Config vector containing a Node-produced, Ed25519-signed outer Result registry envelope. It is an implementation interoperability fixture, not an independent normative oracle. | `evidence_bundle.rs::node_produced_result_registry_envelope_vector_verifies_in_rust` verifies the root identity against the pins supplied by the test vector, the raw registry digest, and the canonical envelope signature; it also rejects a changed signature byte. | `tlsn-runtime-config-manifest-test.mjs` validates the same fixed vector and exercises Result registry signature/pin mutations. | Node-to-Rust outer-envelope interoperability is exercised locally, but this Rust test does not independently authenticate the Runtime Config envelope that supplies its pins. This does not test Complete/Sparse Result signing bytes or an inner Result signature. |
| Sparse Result v3 parser rejection cases | Negative inputs are mutations of a Rust-constructed canonical Sparse Result v3; they are not independently sourced wire-format goldens. | `sparse_result.rs::sparse_result_parser_rejects_noncanonical_or_ambiguous_json` and `sparse_result_rejects_invalid_attestation_id_and_range_lengths` reject unknown/duplicate/reordered fields, whitespace changes, padded base64url, trailing bytes, wrong ID length, and inconsistent range lengths. | No independent Node Sparse Result parser or matching shared corpus was found in the audited Worker path. | Rust-only rejection coverage; not cross-language determinism evidence. |
| Offline `require_info` CLI rejection | The checked-in upstream Presentation and its serialized verifying key; the test supplies a wrong expected identity or appends trailing bytes. | `tests/offline_verifier_cli.rs` runs the actual `verify_tlsn_require_info` binary and requires nonzero rejection with the expected diagnostic and no success-shaped stdout. | None. | Local fail-closed CLI cases pass. They do not constitute a positive FUSOU `require_info` evidence run. |
| Offline Evidence Bundle CLI precondition | No Evidence Bundle is fabricated; the test deliberately omits external authority inputs. | `tests/offline_verifier_cli.rs` runs `verify_fusou_tlsn_evidence` and checks machine-readable rejection for missing Evidence Root inputs. | None. | Local missing-authority rejection passes; no positive Production-shaped bundle was verified. |

The verifier's Complete Result v2 and Sparse Result v3 have Rust canonical
serialization and signing-byte implementations. The audited Node
`production-evidence-contract.mjs` enforces semantic evidence bindings, but
does not independently implement those Result signing bytes or verify the
inner Result signature. The Result and receipt trust edges are therefore not
cross-language merely because Node checks a Presentation digest or Attestation
ID.

Session Authority and consume receipt framing is implemented in Rust
`evidence_bundle.rs` under the
`FUSOU-ATTESTATION-SESSION-V1\0` and
`FUSOU-ATTESTATION-CONSUME-V1\0` domains. No corresponding JavaScript receipt
producer/validator or shared receipt vectors were found in the audited
verifier/Worker paths. `ClaimBindingBytes` is described in documentation, but
an executable Rust/Node implementation and shared Claim vector were not found.
Packed sparse transcript bytes and authenticated range verification are also
Rust-side; the audited Node path does not independently parse and validate
those ranges.

### Serialization and signature path matrix

This is a source audit of the current code paths, not a claim that every path
has an independent expected byte vector.

| Contract | Canonical input/output and exact-byte construction in source | Rust/WASM path | Node/Worker path | Executed evidence and unresolved boundary |
| --- | --- | --- | --- | --- |
| Complete Result v2 | `VerifierResult` uses manually ordered canonical JSON. `signing_bytes()` is `FUSOU-VERIFIER-RESULT-V2\0`, big-endian `u16` version, then these fields in source order: profile ID, profile digest, issuer, purpose, user ID, device ID, device challenge, verified member ID, Session ID, binding nonce/value, verifier/Notary key IDs, Attestation ID, Presentation digest, server identity, optional Origin Inventory and Target Approval digests, request size/digest/ranges, response size/digest/ranges. Variable values use `u16`-length prefixes; sizes use big-endian `u64`; each ranges vector uses big-endian `u32` count and each range's big-endian start, length, byte length, then raw bytes. The signature is excluded. | `lib.rs` canonicalizes and produces signing bytes; `wasm.rs` exposes Rust-derived bytes and signature attachment. `evidence_bundle.rs::verify_result_signature` recomputes them and verifies against the authenticated Result registry. The offline `verify_tlsn_require_info` emits an unsigned Result and bytes; `verify_fusou_tlsn_evidence` verifies an Evidence Bundle Result signature. | Packaged WASM JS glue exposes Rust byte/attach APIs. `production-evidence-contract.mjs` validates semantic bindings but does not independently derive bytes or verify the inner signature. `deployment-contract.mjs` contains `signResult` capability metadata, not an executable signer. | Rust-local stability and signed-field mutation tests exist. No independent Result v2 bytes/public-key/signature vector or Node/WASM Result-signature verification test was found. |
| Sparse Result v3 | `SparseVerifierResult` uses manually ordered canonical JSON. `signing_bytes()` starts with `FUSOU-VERIFIER-SPARSE-RESULT-V2\0` and version `3`, then ordered fields: profile ID, disclosure mode, profile digest, issuer, purpose, user/device IDs, device challenge, verified member ID, Session ID, binding nonce/value, verifier/Notary key IDs and Notary digest, Attestation ID, Presentation digest, server identity, optional Origin Inventory/Target Approval digests, request size/ranges, response size/ranges. It uses the same integer/length-prefix/range framing as the Complete Result, with raw disclosed range bytes. The signature is excluded. | `sparse_result.rs` parses, validates, canonicalizes, and constructs bytes. `wasm.rs` exposes Rust-derived signing-byte and signature-attachment APIs; Evidence Bundle verification uses the Rust `EvidenceResultView` path. | No executable Node Sparse Result byte serializer or inner-signature verifier was found in the audited Worker scripts. | Rust parser rejection and signing-byte mutation tests exist; there is no independent cross-language canonical-byte/signature vector. |
| Outer Result registry envelope | Node signs `canonicalJson` of seven fields (schema, scope, algorithm, root ID, root SPKI, digest of exact raw registry bytes, registry object) with Ed25519. The signature is outside the signed payload. Rust selects the same fields, recursively canonicalizes JSON, checks root ID/SPKI against caller-supplied trust pins, and verifies the registry and envelope raw-byte digests. | `evidence_bundle.rs::verify_result_registry_root` verifies this envelope. The added test consumes the fixed vector and rejects signature-byte mutation; its pin values come from the vector rather than an independent root authority. | `result-registry-envelope.mjs` implements Node creation/verification; the Runtime Config manifest test exercises the fixed Node-produced vector and mutation cases. | Node-to-Rust interoperability passes locally for the outer envelope only. The vector is test-only and Node-produced, so it is neither an external normative golden nor evidence for inner Result v2/v3 signatures. |
| Session and consume receipts | Rust frames ordered UTF-8 string fields after `FUSOU-ATTESTATION-SESSION-V1\0` or `FUSOU-ATTESTATION-CONSUME-V1\0`, a `0x0001` version marker, and big-endian `u16` length prefixes. Session field order is signer key ID, Session ID, user ID, device ID, device-auth nonce, nonce, device challenge, binding value, creation time, expiry time. Consume field order is signer key ID, Session ID, user ID, device ID, nonce, binding value, Presentation ID, used time. | `evidence_bundle.rs` constructs the bytes and verifies both receipt signatures. | No executable Node producer/verifier or shared receipt corpus was found. | Rust verification alone is not cross-language evidence; independent byte/signature vectors are absent. |
| Claim | The older `trusted-battle-and-telemetry-ingestion.md` layout has eight inputs (domain, purpose, Attestation ID, member ID, device ID, expected public ID, Challenge ID, Challenge nonce). `member-id-preemptive-attack-and-recovery.md` adds Session ID, binding nonce, and binding value. | No executable ClaimBindingBytes serializer/verifier was found in the verifier crate. | No executable matching Node serializer/verifier or shared Claim vector was found. | Normative field layout, encoding, and expected bytes remain unresolved; neither document is promoted to the executable contract by this audit. |
| Transcript ranges | Result JSON represents ranges using decimal-string start/length plus base64url bytes. Result signatures include a big-endian `u32` range count and each range's big-endian start, length, byte length, and raw bytes. The TLSN sparse Presentation uses the local Rust packed transcript/proof representation and authenticated range reads. | Rust validates ordering, bounds, and non-overlap and verifies sparse proof openings. | No independent Node parser/verifier for packed Presentation ranges was found. | Rust rejection tests exist, but there are no shared expected range bytes or Node↔Rust sparse Presentation vectors. |

The WASM `derive_*_verifier_result_signing_bytes` exports call the Rust
implementations. `attach_*_verifier_result_signature` checks signature length
and returns canonical Result JSON; it does not verify the signature. The
checked-in JavaScript glue is not an independent Result implementation, and
Node-to-WASM calls do not establish the source provenance of the checked-in
WASM binary.

The packaged WASM test has an additional provenance limit. The checked-in
`wasm-provenance.json` names source commit
`95923de519fd6d382b596b92c06cff0cebc90987`, which is not an ancestor of the
audited checkout. Its 554 listed source inputs include 177 paths whose
recorded hashes differ from the checkout or which are absent; the recorded
`build-wasm.mjs`, `wasm-provenance.mjs`, and `Cargo.lock` paths are absent.
The provenance input list does not include `configs.toml`. An earlier offline
optimized rebuild record using Rust 1.95.0 and wasm-pack 0.13.1 reports
755,685 bytes versus the checked-in 752,473 bytes, but the rebuilt binary SHA
was not retained. In this audit, a current-source offline `--no-opt` rebuild
using Rust 1.95.0 and wasm-pack 0.13.1 completed in an external `/dev/shm`
target/output directory. The checked-in WASM is 752,473 bytes with SHA-256
`57ea4e30f684f15c6f22fc26eb0995b9d8b961ba7de6edd82faaaf21dd62ab66`; the
unoptimized rebuilt WASM is 912,726 bytes with SHA-256
`8a0a8d6430a3290c05ec4bb2e7420e463ba0b791efbaeed61569053dcc7090a3`.
Generated JavaScript matched byte-for-byte (SHA-256
`47c8c02beba71dab4eed1c1dbd29e8a0a874c18dd913bd76a513b38070e1d986`) and
declarations matched byte-for-byte (SHA-256
`3a5345bf41c1f8712e2e3e921e8d1809af4d35b163f978abd3fd28580794004f`).
Because the current environment lacks `wasm-opt`, the new unoptimized output
is not a comparable reproduction of the optimized artifact. The optimized
rebuild's hash remains unavailable; the cause of the optimized binary
difference and artifact/source provenance remain `UNRESOLVED`. No checked-in
artifact was replaced.

Still missing before P0-10 can pass:

- independent shared vectors for Complete Result v2 and Sparse Result v3,
  including canonical bytes, signing bytes, and Node consumption/verification;
- Session receipt, consume receipt, and Claim bytes/field-binding vectors;
- shared canonical JSON, binary transcript/range, and cross-reference vectors
  with independently sourced expected bytes;
- independent Result signer public-key/signature expectations and a verified
  Production Result generation path; the added Node-to-Rust vector covers only
  the outer Result registry envelope;
- matching Rust/Node rejection vectors for invalid UTF-8, missing/unknown/
  duplicate fields, noncanonical numbers/encoding, malformed ranges, and
  byte/order mutations.

Result vectors must not be created by copying current Rust output into Node
expectations and calling that independent evidence. Existing local tests that
call one implementation twice, Runtime Config vectors, and fake signer/store
tests do not satisfy the missing TLSN protocol corpus.

## Commands and interpretation

```sh
cargo test --manifest-path packages/FUSOU-TLSN-VERIFIER/Cargo.toml --locked --quiet
node --test packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-manifest-test.mjs
node --test packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-attestation-id-test.mjs
rustfmt --edition 2021 --check packages/FUSOU-TLSN-VERIFIER/src/evidence_bundle.rs
git diff --check
```

From the repository root, the Rust suite completed with 84 unit tests and 3
offline CLI integration tests passing; `tlsn-runtime-config-manifest-test.mjs`
completed with 21 tests passing, and
`production-evidence-attestation-id-test.mjs` completed with 5 passing.
Changed-file rustfmt and `git diff --check` pass. The WASM no-opt build also
completed but is not an optimized artifact reproduction. Earlier package-wide
`cargo fmt -- --check` reported formatting drift in untouched verifier files
(`src/lib.rs` and `src/wasm.rs`); unrelated formatting was not rewritten.
Earlier strict Clippy reported existing verifier lints (argument-count,
borrow, default-initialization, and range-helper diagnostics); Clippy was not
rerun in this continuation. The first test command attempts in this
continuation used paths relative to the VS Code package working directory and
failed to locate repository files; rerunning from the repository root produced
the results above. These are local source/test checks only. Hosted CI,
Production operation, R2 service access, Notary service, and real Game Server
testplay were not performed. P0-03 through P0-09 and P0-11 through P0-17 are
unchanged. P0-01 independent approval, the remaining P0-10 corpus, real TLSN
testplay, and Production acceptance remain blocked.
