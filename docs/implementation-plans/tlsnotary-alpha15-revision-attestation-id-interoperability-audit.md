# TLSNotary alpha.15 revision, Attestation ID, and interoperability audit

## Current dispositions

| Item | Status | Evidence and remaining condition |
| --- | --- | --- |
| P0-01 technical revision mapping | `PASS` for the factual source map; `P0-01` remains `BLOCKED_EXTERNAL_INPUTS` | The upstream tag/commit and dependency graph are identified below. The verifier executes local path-patched TLSN sources that diverge from upstream; independent compatibility, security, and license approval is still required. |
| P0-02 Attestation ID contract | `PASS_LOCAL_TESTS` | The exact upstream type/API, 16-byte length, upstream binary fixture, independently extracted ID, canonical JSON encoding, and Node invocation of the packaged Rust/WASM verifier are covered locally. |
| P0-10 cross-language determinism | `UNRESOLVED` | A shared local corpus now covers Complete Result v2, Sparse Result v3, Session/consume receipts, Result range bytes, and contract-required rejection cases in separate Rust and Node reference tests. The corpus is generated independently of production serializers but is source-derived, test-only, and not an owner-approved normative oracle. Claim, receipt JSON canonicalization, TLSN sparse Presentation bytes, WASM provenance, and Production-shaped evidence remain unresolved. |
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
| Complete Result v2 | `VerifierResult` uses manually ordered canonical JSON. `signing_bytes()` is `FUSOU-VERIFIER-RESULT-V2\0`, big-endian `u16` version, then these fields in source order: profile ID, profile digest, issuer, purpose, user ID, device ID, device challenge, verified member ID, Session ID, binding nonce/value, verifier/Notary key IDs, Attestation ID, Presentation digest, server identity, optional Origin Inventory and Target Approval digests, request size/digest/ranges, response size/digest/ranges. Variable values use `u16`-length prefixes; sizes use big-endian `u64`; each ranges vector uses big-endian `u32` count and each range's big-endian start, length, byte length, then raw bytes. The signature is excluded. | `lib.rs` canonicalizes and produces signing bytes; `wasm.rs` exposes Rust-derived bytes and signature attachment. `evidence_bundle.rs::verify_result_signature` recomputes them and verifies against the authenticated Result registry. The offline `verify_tlsn_require_info` emits an unsigned Result and bytes; `verify_fusou_tlsn_evidence` verifies an Evidence Bundle Result signature. | Packaged WASM JS glue exposes Rust byte/attach APIs. `production-evidence-contract.mjs` validates semantic bindings but does not independently derive bytes or verify the inner signature. `deployment-contract.mjs` contains `signResult` capability metadata, not an executable signer. | The shared v1 corpus fixes the exact JSON, signing bytes, range wire bytes, digest, and OpenSSL-generated test signature. Rust parses and verifies via the actual inner Result signature verifier; the separate Node reference independently encodes and verifies the same bytes. This is local implementation evidence, not protocol-owner approval or a Production key/root test. |
| Sparse Result v3 | `SparseVerifierResult` uses manually ordered canonical JSON. `signing_bytes()` starts with `FUSOU-VERIFIER-SPARSE-RESULT-V2\0` and version `3`, then ordered fields: profile ID, disclosure mode, profile digest, issuer, purpose, user/device IDs, device challenge, verified member ID, Session ID, binding nonce/value, verifier/Notary key IDs and Notary digest, Attestation ID, Presentation digest, server identity, optional Origin Inventory/Target Approval digests, request size/ranges, response size/ranges. It uses the same integer/length-prefix/range framing as the Complete Result, with raw disclosed range bytes. The signature is excluded. | `sparse_result.rs` parses, validates, canonicalizes, and constructs bytes. `wasm.rs` exposes Rust-derived signing-byte and signature-attachment APIs; Evidence Bundle verification uses the Rust `EvidenceResultView` path. | No production Node Sparse Result serializer or inner-signature verifier was found. A test-only Node reference consumes the shared corpus without importing Rust/WASM or Worker serializers. | The same local corpus independently fixes canonical JSON, signing/range bytes, digest, and signature expectations; Rust parser, verifier and Node reference tests pass. It does not cover TLSN's packed sparse Presentation encoding or prove the packaged WASM's source provenance. |
| Outer Result registry envelope | Node signs `canonicalJson` of seven fields (schema, scope, algorithm, root ID, root SPKI, digest of exact raw registry bytes, registry object) with Ed25519. The signature is outside the signed payload. Rust selects the same fields, recursively canonicalizes JSON, checks root ID/SPKI against caller-supplied trust pins, and verifies the registry and envelope raw-byte digests. | `evidence_bundle.rs::verify_result_registry_root` verifies this envelope. The added test consumes the fixed vector and rejects signature-byte mutation; its pin values come from the vector rather than an independent root authority. | `result-registry-envelope.mjs` implements Node creation/verification; the Runtime Config manifest test exercises the fixed Node-produced vector and mutation cases. | Node-to-Rust interoperability passes locally for the outer envelope only. The vector is test-only and Node-produced, so it is neither an external normative golden nor evidence for inner Result v2/v3 signatures. |
| Session and consume receipts | Rust frames ordered UTF-8 string fields after `FUSOU-ATTESTATION-SESSION-V1\0` or `FUSOU-ATTESTATION-CONSUME-V1\0`, a `0x0001` version marker, and big-endian `u16` length prefixes. Session field order is signer key ID, Session ID, user ID, device ID, device-auth nonce, nonce, device challenge, binding value, creation time, expiry time. Consume field order is signer key ID, Session ID, user ID, device ID, nonce, binding value, Presentation ID, used time. | `evidence_bundle.rs` constructs the bytes and verifies both receipt signatures against the supplied test registry/pin in the corpus tests. | A test-only Node reference independently constructs and verifies both preimages; no Production Node receipt implementation is claimed. | The corpus fixes both receipt preimages, hashes, signatures, key IDs, registry bytes, and binding mutations. Its direct test keys are not Production trust roots. Receipt JSON canonicalization and unknown-field policy remain unspecified and unresolved. |
| Claim | The older `trusted-battle-and-telemetry-ingestion.md` layout has eight inputs (domain, purpose, Attestation ID, member ID, device ID, expected public ID, Challenge ID, Challenge nonce). `member-id-preemptive-attack-and-recovery.md` adds Session ID, binding nonce, and binding value. | No executable ClaimBindingBytes serializer/verifier was found in the verifier crate. | No executable matching Node serializer/verifier or shared Claim vector was found. | Normative field layout, encoding, and expected bytes remain unresolved; neither document is promoted to the executable contract by this audit. |
| Transcript ranges | Result JSON represents ranges using decimal-string start/length plus base64url bytes. Result signatures include a big-endian `u32` range count and each range's big-endian start, length, byte length, and raw bytes. The TLSN sparse Presentation uses the local Rust packed transcript/proof representation and authenticated range reads. | Rust validates ordering, bounds, and non-overlap and verifies sparse proof openings. The shared corpus fixes and compares the distinct Result range-wire bytes. | The Node reference validates Result range ordering/bounds and compares the same Result range-wire bytes. No independent Node parser/verifier for packed TLSN Presentation ranges was found. | Result range framing and selected invalid boundaries are covered locally. Full TLSN sparse Presentation binary encoding, proof openings, and Rust↔Node Presentation vectors remain unresolved. |

### Shared implementation corpus v1

The current continuation started from `96545076bc4e53083e4536a4159b3d2cb8dce0c3`
on `tlsn-first-testplay-candidate`; upstream was equal to that HEAD. The
pre-existing user-owned `configs.toml` remained untouched and unstaged.

`packages/FUSOU-TLSN-VERIFIER/fixtures/p010-cross-language-corpus-v1.json`
contains four positive, explicitly test-only vectors: Complete Result v2,
Sparse Result v3, Session receipt v1, and consume receipt v1. It also contains
34 Result rejection vectors and five receipt binding/signature mutation cases.
The result vectors include exact input/canonical JSON bytes, signing bytes,
range-wire bytes, SHA-256 values, signature bytes, key IDs, public keys, and a
direct test-only registry; the receipt vectors include exact receipt/session
inputs, authority registry bytes, preimages, digests, signatures, and direct
test-only key pins. The Result, Session, device, binding nonce, and Presentation
digest cross-references are asserted by both languages.

The independent generator is
`packages/FUSOU-TLSN-VERIFIER/tools/generate_p010_corpus.py`. It uses Python
3.12.3 standard-library JSON/struct encoding and OpenSSL 3.5.6 Ed25519
signatures; Result and receipt preimages are assembled manually and do not
call Rust/WASM/Worker serializers. The RFC 8032 §7.1 Test Vector 1 public key
and empty-message signature are also verified by Rust and Node. The Result key
is that published test key, and the receipt keys are deterministic public
test-only seeds. None is a Production key or trust root. Regenerate or verify
the fixture from the repository root with:

```sh
/bin/python3 packages/FUSOU-TLSN-VERIFIER/tools/generate_p010_corpus.py
/bin/python3 packages/FUSOU-TLSN-VERIFIER/tools/generate_p010_corpus.py --check
```

Rust consumes the corpus through the actual Result parser, canonical JSON and
`signing_bytes()` methods, `verify_result_signature`,
`verify_session_receipt`, and `verify_consume_receipt`. Node consumes the same
fixture with a test-only JavaScript reference implementation and Node crypto;
it imports neither Rust/WASM nor production Worker signing helpers. The
outer Result Registry envelope remains a separate test and is not covered by
these inner signature vectors. Node-to-WASM Attestation ID tests are another
separate integration boundary.

These are independent implementation outputs, not an approved normative
specification: the field layouts were audited from the source at the baseline
commit, then independently encoded and signed outside the tested Rust/Node
paths. No external protocol-owner approval or independently published
Complete/Sparse Result or receipt vector was found. The corpus therefore
establishes local cross-implementation agreement for the represented
source-derived contract, not final protocol authority or Production
acceptance.

Not covered by this corpus: the conflicting eight-field and eleven-field
ClaimBindingBytes descriptions; receipt JSON canonicalization/unknown-field
rules; complete TLSN sparse Presentation packed bytes and proof openings; a
Production-shaped positive Evidence Bundle with a verified trust chain; or
packaged WASM provenance. Existing synthetic in-memory require_info tests are
not an independently sourced Presentation fixture or a Production bundle.

The WASM `derive_*_verifier_result_signing_bytes` exports call the Rust
implementations. `attach_*_verifier_result_signature` checks signature length
and returns canonical Result JSON; it does not verify the signature. The
locally present generated JavaScript glue is not an independent Result
implementation, and Node-to-WASM calls do not establish the source provenance
of the local WASM binary.

The packaged WASM test has an additional provenance limit. The local,
Git-ignored `packages/FUSOU-TLSN-VERIFICATION-WORKER/src/wasm/wasm-provenance.json`
names source commit
`95923de519fd6d382b596b92c06cff0cebc90987`, which is not an ancestor of the
audited checkout. Its 554 listed source inputs include 177 paths whose
recorded hashes differ from the checkout or which are absent; the recorded
`build-wasm.mjs`, `wasm-provenance.mjs`, and `Cargo.lock` paths are absent.
The provenance input list does not include `configs.toml`. An earlier offline
optimized rebuild record using Rust 1.95.0 and wasm-pack 0.13.1 reports
755,685 bytes versus the locally present 752,473-byte artifact, but the rebuilt
binary SHA was not retained. In this audit, a current-source offline `--no-opt`
rebuild using Rust 1.95.0 and wasm-pack 0.13.1 completed in an external
`/dev/shm` target/output directory. The pre-existing local WASM is 752,473
bytes with SHA-256
`57ea4e30f684f15c6f22fc26eb0995b9d8b961ba7de6edd82faaaf21dd62ab66`; the
unoptimized rebuilt WASM is 912,726 bytes with SHA-256
`8a0a8d6430a3290c05ec4bb2e7420e463ba0b791efbaeed61569053dcc7090a3`.
Generated JavaScript matched byte-for-byte (SHA-256
`47c8c02beba71dab4eed1c1dbd29e8a0a874c18dd913bd76a513b38070e1d986`) and
declarations matched byte-for-byte (SHA-256
`3a5345bf41c1f8712e2e3e921e8d1809af4d35b163f978abd3fd28580794004f`).
The current checkout confirms that `src/wasm/.gitignore` ignores the generated
WASM, JavaScript, declarations, and provenance file; `git ls-files` contains no
WASM or provenance artifact. The local `src/wasm/fusou_tlsn_verifier_bg.wasm`
still has the previously recorded 752,473-byte size and SHA-256 above. This
continuation did not rebuild or modify it. Because the current environment
lacks `wasm-opt`, the unoptimized output is not a comparable reproduction of
the optimized artifact. The optimized rebuild's hash remains unavailable;
the cause of the optimized binary difference and artifact/source provenance
remain `UNRESOLVED`. The Node/WASM test exercised this pre-existing ignored
local artifact, not a tracked artifact.

Still missing before P0-10 can pass:

- an owner-approved normative Result/receipt field and encoding contract, or
  externally published golden vectors that resolve any source/spec divergence;
- the authoritative ClaimBindingBytes layout and independent Claim vectors;
- an explicit canonical JSON/field-inventory contract for receipt envelopes;
- a shared, valid TLSN sparse Presentation fixture and independent Node
  decoding/proof-opening path for the FUSOU-local packed representation;
- a Production-shaped positive Evidence Bundle and a verified independent
  trust chain; the corpus registries are direct test-only pins;
- verified packaged WASM provenance and source/artifact correspondence.

The new generator is independent of the tested serializers, but its Result
and receipt layouts are source-derived rather than owner-approved. Therefore,
local Rust/Node agreement does not promote P0-10 to PASS.

## Commands and interpretation

```sh
cargo test --locked --offline --manifest-path packages/FUSOU-TLSN-VERIFIER/Cargo.toml
node --test packages/FUSOU-TLSN-VERIFIER/tests/p010-corpus.test.mjs
/bin/python3 packages/FUSOU-TLSN-VERIFIER/tools/generate_p010_corpus.py --check
node --test packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-manifest-test.mjs
node --test packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-attestation-id-test.mjs
rustfmt --edition 2021 --check packages/FUSOU-TLSN-VERIFIER/src/evidence_bundle.rs
git diff --check
```

From the repository root, the current Rust suite completed with 90 unit tests
and 3 offline CLI integration tests passing; the shared Node corpus suite
completed with 8 tests passing; `tlsn-runtime-config-manifest-test.mjs`
completed with 21 tests passing, and
`production-evidence-attestation-id-test.mjs` completed with 5 passing. The
independent generator's `--check`, changed-file rustfmt, and `git diff --check`
pass. The WASM no-opt build also completed in the prior audit but is not an
optimized artifact reproduction. Earlier package-wide
`cargo fmt -- --check` reported formatting drift in untouched verifier files
(`src/lib.rs` and `src/wasm.rs`); unrelated formatting was not rewritten.
Earlier strict Clippy reported existing verifier lints (argument-count,
borrow, default-initialization, and range-helper diagnostics); Clippy was not
rerun in this continuation. The first test command attempts in this
continuation used paths relative to the VS Code package working directory and
failed to locate repository files; rerunning from the repository root produced
the results above. These are local source/test checks only. Hosted CI, Production operation, R2 service
access, Notary service, and real Game Server testplay were not performed.
P0-03 through P0-09 and P0-11 through P0-17 are unchanged. P0-01 independent
approval remains `BLOCKED_EXTERNAL_INPUTS`; P0-10 remains `UNRESOLVED` for the
specific items above; the Phase 0 runtime gate, real TLSN testplay, and
Production acceptance remain blocked.
