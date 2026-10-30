# TLSNotary alpha.15 revision, Attestation ID, and interoperability audit

## Current dispositions

Latest local continuation starts at `fc29aac29d454bf949510e0d97acbd3cd7e68e5b`.
Its active mux mapping supersedes the earlier path-patch inventory below:

* APP and Proxy no longer path-patch `tlsn-mux`; locked native graphs compile
  exact upstream `tlsn-utils` `64722f7de999cbd41c0cab7312dade306d50ea5f`.
  The inactive copied directory remains historical, not a dependency.
* Its only runtime fork delta was defaults of 10,240 streams and a 2.5 GiB
  receive window versus upstream 512 / 1 GiB. Those **existing** APP/Proxy
  ceilings are preserved through upstream public setters behind opt-in
  `tlsn/fusou-large-mux`; standalone Verifier keeps upstream defaults.
  This does not eagerly allocate that window or establish an RSS bound.
* The active TLSN fork remains pinned against upstream
  `47aee45b53e06648c1b2ad3689b367b8c923fdec`. Cached source comparison identifies
  six changed runtime files: core transcript/proof, client backend notify,
  Session ownership/configuration, transcript authentication and verifier
  plumbing; manifests/tests/fixtures also differ. This is not a wholesale
  upstream fork removal or independent wire/security approval.
* Active Hudsucker 0.23.0 remains a fork of packaged upstream commit
  `7774ea8cd241560c1dee64376c0f4a9eaed497f0`: body completion,
  connection identity, builder hooks, internal handling and proxy lifecycle
  differ (`src/body.rs`, `src/lib.rs`, three `src/proxy` files), plus lockfile.
  Plaintext/connection hooks, cancellation and completion have actual callers;
  removing them without an equivalent is not safe. Rama stays experimental,
  not the APP default.
* Actual APP GNU check, 64 APP TLSN tests and 129 selected Proxy tests pass;
  each test set retains one pre-existing ignored harness-only test. Proxy tests
  include real **loopback synthetic** MPC/Notary and handler paths, not a real
  Notary/Game Server. WASM/provenance and real service execution were not run.

P0-01 independent revision/compatibility/security/license approval and P0-10
normative Claim/receipt JSON/sparse/WASM/Production corpus remain unresolved.
No previous local result is promoted into real Production acceptance.

| Item | Status | Evidence and remaining condition |
| --- | --- | --- |
| P0-01 technical revision mapping | `PASS_EVIDENCE` for the factual source map; `P0-01` remains `BLOCKED_EXTERNAL_INPUTS` | The pinned upstream and direct dependency paths are mapped, including observed TLSN production-source changes and the now-unpatched, explicitly configured upstream mux. Independent compatibility, security, and license approval is still required. |
| P0-02 Attestation ID contract | `PASS_LOCAL_TESTS` | The exact upstream type/API, 16-byte length, upstream binary fixture, independently extracted ID, canonical JSON encoding, and Node invocation of the packaged Rust/WASM verifier are covered locally. |
| P0-10 cross-language determinism | `UNRESOLVED` | A shared local corpus now covers Complete Result v2, Sparse Result v3, Session/consume receipt signing bytes, Result range bytes, and contract-required rejection cases in separate Rust and Node reference tests. The corpus is generated independently of production serializers but is source-derived, test-only, and not an owner-approved normative oracle. This continuation confirmed that the documented 8-field/11-field ClaimBindingBytes layouts have no recorded precedence or supersession, and that receipt JSON canonicalization/unknown-field policy has no approved wire contract. Claim, receipt JSON policy, TLSN sparse Presentation bytes, WASM provenance, and Production-shaped evidence remain unresolved. |
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
- The compressed transcript fields retain the apparent upstream field order.
  A new pinned clean-upstream sparse sample gives one cross-revision
  characterization: the patched verifier accepts the clean-upstream
  Presentation and serializes the verified sparse transcript to the exact
  bytes captured from the clean-upstream verifier. This is one sample from the
  same TLSNotary codebase and serializer family, not an independent
  implementation or a normative golden. It does not establish general
  upstream/fork wire compatibility.
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
- an owner-approved cross-language sparse-Presentation contract and an
  independent Node decoding/proof-opening implementation for the FUSOU-local
  packed representation. A clean-upstream generated characterization fixture
  is now checked in, but it is not an independent implementation oracle or a
  FUSOU `require_info`/Production fixture;
- a Production-shaped positive Evidence Bundle and a verified independent
  trust chain; the corpus registries are direct test-only pins;
- verified packaged WASM provenance and source/artifact correspondence.

The new generator is independent of the tested serializers, but its Result
and receipt layouts are source-derived rather than owner-approved. Therefore,
local Rust/Node agreement does not promote P0-10 to PASS.

## ClaimBindingBytes and receipt JSON authority audit

This audit continuation started on `tlsn-first-testplay-candidate` at
`913761ac9f30bc7ee1a9ba745ec9b6ab02b405af`; the tracked upstream ref matched
that HEAD (`0 ahead / 0 behind`), and the reported prior HEAD was the current
HEAD and its ancestor. The only pre-existing worktree change was the
user-owned `packages/FUSOU-APP/src-tauri/roaming/user/configs.toml`. Its
contents were not read; it was not modified, staged, or committed. This
continuation changes documentation only.

### Authority and source classification

- **Normative authority — `UNRESOLVED`:** the repository contains two
  specification-style ClaimBindingBytes descriptions but no approval record
  establishing an owner, precedence, deprecation, or migration. No versioned
  receipt JSON schema or receipt canonicalization approval was found. A Git
  commit message or a successful local test is implementation/design history,
  not protocol-owner approval.
- **Supporting source:** the pinned TLSNotary alpha.15 source defines the
  typed Attestation ID used by the verifier. It does not define FUSOU's
  application-layer Claim, Session Authority, or Binding Authority receipt
  wire contracts. The local TLSN path-patched source contains no
  `ClaimBindingBytes` or FUSOU receipt-domain definition.
- **Implementation facts — `OBSERVED`:** the documented layouts, current
  Rust receipt preimages, and parser behavior below can be established from
  repository sources. No executable ClaimBindingBytes implementation or
  Claim vector exists in the audited Rust/Node paths. The in-repository Worker
  evidence-contract module describes semantic predicates; it is not a receipt
  issuer, JSON serializer, or receipt signature verifier.
- **Unconfirmed assumption:** neither the newer date of the 11-field
  description nor its stated proof-copy rationale establishes that it
  normatively replaces the 8-field description.

### ClaimBindingBytes candidates

Both documents specify `u16_be(byte_length) || field_bytes` for each field
and Ed25519 over the resulting concatenation. The listed field order is part
of each candidate; no implementation or independent Claim golden bytes were
found.

| Order | 8-field candidate in `trusted-battle-and-telemetry-ingestion.md` | Encoding |
| ---: | --- | --- |
| 1 | domain tag `FUSOU-IDENTITY-CLAIM-V1` | 23 ASCII bytes |
| 2 | purpose `GAME_ACCOUNT_IDENTITY_V1` | 24 ASCII bytes |
| 3 | TLSNotary Attestation ID | raw `N` bytes; alpha.15's typed ID is 16 bytes |
| 4 | verified member ID | 1–16 decimal ASCII bytes |
| 5 | device ID | 16 RFC 4122 network-order UUID bytes |
| 6 | expected public ID | 16 RFC 4122 network-order UUID bytes |
| 7 | Challenge ID | 16 RFC 4122 network-order UUID bytes |
| 8 | Challenge nonce | 32 raw bytes |

| Order | 11-field candidate in `member-id-preemptive-attack-and-recovery.md` | Encoding |
| ---: | --- | --- |
| 1 | domain tag `FUSOU-IDENTITY-CLAIM-V1` | 23 ASCII bytes |
| 2 | purpose `GAME_ACCOUNT_IDENTITY_V1` | 24 ASCII bytes |
| 3 | Attestation Session ID | 16 RFC 4122 network-order UUID bytes |
| 4 | binding nonce | 32 raw bytes |
| 5 | binding value | exact ASCII bytes |
| 6 | TLSNotary Attestation ID | raw `N` bytes; alpha.15's typed ID is 16 bytes |
| 7 | verified member ID | decimal ASCII bytes |
| 8 | device ID | 16 RFC 4122 network-order UUID bytes |
| 9 | public ID | 16 RFC 4122 network-order UUID bytes |
| 10 | Challenge ID | 16 RFC 4122 network-order UUID bytes |
| 11 | Challenge nonce | 32 raw bytes |

The history shows that `36bd16331c` revised the older document's layout to
include `proof_purpose` and the TLSNotary Attestation ID in the 8-field form.
Commit `356aad0c0` later added the Session ID, binding nonce, and binding
value to the other document, in a different field order, and describes the
change as preventing proof-copy attacks. That commit changed
`member-id-preemptive-attack-and-recovery.md`; it did not edit or explicitly
deprecate the 8-field section in
`trusted-battle-and-telemetry-ingestion.md`. No version transition or
compatibility rule accompanies the two layouts.

The 11-field form explicitly signs the Session and binding context. The
8-field form does not include those three fields in the device signature;
it instead binds its listed Challenge, device, dataset, member, and
Attestation values. This is a real difference in signed inputs, not a
formatting variant. It is insufficient to conclude from that difference
alone that either document is the approved protocol or that one can safely
be substituted for already-created claims.

**Conclusion: `UNRESOLVED`.** The FUSOU identity/Claim protocol owner and the
authority responsible for accepting device-signed claims must approve one
versioned layout (or explicitly define a migration/dual-version policy),
including exact field types, ordering, encodings, verification behavior, and
independent positive and negative vectors. No candidate was selected and no
Claim test or implementation was added.

### Session/consume receipt JSON: current behavior versus contract

The current signature input is reconstructed from parsed field values; it is
not the raw JSON byte sequence. In the Rust implementation, both preimages
use a domain ending in NUL, a `0x0001` version marker, then UTF-8 strings
framed with big-endian `u16` byte lengths. The Session order is
`signer_key_id`, `session_id`, `canonical_user_id`, `device_id`,
`device_auth_nonce`, `nonce`, `device_challenge`, `binding_value`,
`created_at`, `expires_at`. The consume order is `signer_key_id`,
`session_id`, `canonical_user_id`, `device_id`, `nonce`, `binding_value`,
`presentation_id`, `used_at`. `schema_version`, `type`,
`signature_algorithm`, and the signature itself are checked separately and
are not in those preimages. These are current implementation facts, not an
approved wire specification.

| JSON / binding dimension | Current source behavior | Normative status |
| --- | --- | --- |
| Key order and whitespace | Parsers select named fields; signatures are over reconstructed ordered bytes, not serialized JSON. Reordering keys or changing whitespace without changing parsed values does not change this receipt signature input. | No canonical JSON byte contract found. |
| String escaping and Unicode | JSON escapes are parsed to strings, then those strings' UTF-8 bytes enter the preimage. There is no Unicode normalization step. Distinct raw JSON spellings that parse to the same strings therefore produce the same receipt preimage. | No normalization or raw-JSON signature rule approved. |
| Numbers, booleans, `null`, and required fields | Receipt preimage fields must be strings and missing/wrongly typed values fail. `schema_version` is checked as version 1 (typed `u8` in the Proxy response; integer `1` in the Evidence Bundle path). | Current type checks only; no full JSON schema approval. |
| Duplicate keys | Proxy deserializes `SessionAuthorityResponse`/`SessionReceipt` structs: duplicate known struct fields fail deserialization. The Evidence Bundle parser uses `serde_json::Value`, whose object representation retains the last value for a duplicate key. | The two paths differ; no approved duplicate-key policy. |
| Unknown keys | The Proxy receipt structs do not use `deny_unknown_fields`; extra fields are ignored. The Evidence Bundle's named-field reads ignore unconsumed keys. | No approved allow/deny inventory. |
| Timestamps | Proxy parses RFC 3339 and checks chronology, but includes the original timestamp strings in the preimage. The Evidence Bundle's authority-key time parser requires exactly `YYYY-MM-DDTHH:mm:ss.sssZ`; those original strings also enter the preimage. | Producer format and cross-path normalization are not approved. |
| Signature encoding and key role | Proxy checks an unpadded base64url signature round-trip and 64-byte length. Evidence Bundle uses its strict base64url decoder, verifies the preimage, and resolves the signer against a supplied authority registry/external pin. | Current verifier checks; not an issuer-approved JSON contract. |
| Cross-artifact binding | Session receipt fields are compared with the Session and device-authentication context; consume receipt fields are compared with the Session, user, and Presentation identifier. The selected authority key is checked separately from receipt JSON parsing. | Current Evidence Bundle checks; production issuer contract is not present here. |

The Proxy receives and verifies a Session Authority response; it does not
implement the authority that issues the receipt. The Proxy forwards the
Worker's parsed consume receipt as an artifact, while the Evidence Bundle
verifier performs its signature and cross-artifact checks. The
`production-evidence-contract.mjs` names semantic evidence fields and
authority predicates, but does not establish the exact JSON object schema or
the receipt's raw-byte canonicalization. The Evidence Bundle's artifact
manifest separately hashes exact artifact bytes; that raw-artifact integrity
check is not the receipt signature preimage.

**Conclusion: receipt JSON canonicalization and unknown/duplicate-field
policy remain `UNRESOLVED`.** The observed parser differences must not be
turned into a normative accept/reject rule without the Session/Binding
Authority owners approving a versioned JSON schema, signature-input rule,
timestamp representation, extension/unknown-field policy, duplicate-key
policy, and independent vectors. The current shared corpus fixes source-
derived receipt signing bytes/signatures and mutation cases; it does not fix
the JSON wire policy.

### Effect on P0-10 and required evidence

The shared corpus v1 Receipt vectors remain useful local cross-implementation
checks: Rust and the separate Node reference compare against fixed
source-derived preimages and signatures. They do not resolve which receipt
preimage or JSON policy the protocol owner approves. No Claim candidate is
encoded by the corpus. Therefore:

- ClaimBindingBytes contract: `UNRESOLVED`.
- Receipt preimage versus approved wire contract: `UNRESOLVED`.
- Receipt JSON canonicalization, duplicate and unknown field policy:
  `UNRESOLVED`.
- Existing source-derived Rust/Node receipt-vector agreement:
  local test evidence only; not normative `PASS`.
- P0-10 overall: `UNRESOLVED`.
- P0-01 remains `BLOCKED_EXTERNAL_INPUTS`; Phase 0 runtime gate remains
  `BLOCKED`. Hosted CI and real Game Server testplay were not run; Production
  acceptance remains blocked.

No Rust, Node, shared corpus, receipt, Claim, or WASM artifact was changed.
This documentation-only audit did not rerun the previously recorded corpus
tests. The other exclusions listed above—TLSN sparse Presentation packed
bytes/proof openings, Production-shaped positive Evidence Bundle, WASM
provenance, TLSNotary revision approval, Production trust roots/services,
and Device Binding/Session Authority Production integration—remain
unresolved and out of this audit's scope.

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

## Sparse Presentation packed-byte and proof-opening audit

### Execution snapshot

- Repository: `tsukasa-u/FUSOU`; branch:
  `tlsn-first-testplay-candidate`; start HEAD:
  `6175a9ebda905e74e60270c35f690d292e61e9ec`.
- The requested baseline is HEAD and therefore its own ancestor. The local
  tracking ref `origin/tlsn-first-testplay-candidate` was equal to HEAD
  (`0` ahead / `0` behind). The immediately preceding related commit is
  `6175a9ebd docs(tlsn): record Claim and receipt contract audit`.
- The only pre-existing worktree change was the user-owned
  `packages/FUSOU-APP/src-tauri/roaming/user/configs.toml`. Its contents were
  not read; it was not modified, staged, or committed.
- This continuation made no Rust, fixture, Cargo lockfile, or WASM changes.
  Hosted CI, external services, real Notary/Game Server operation, and
  Production testplay were not run.

### Source identity and evidence classes

The source declaration remains TLSNotary alpha.15 commit
`47aee45b53e06648c1b2ad3689b367b8c923fdec`, but the effective `tlsn`,
`tlsn-attestation`, and `tlsn-core` dependencies are path-patched to
`packages/tlsn-alpha15-sparse`. The local `tlsn-core` transcript and proof
files diverge from pinned upstream; `Presentation` verification and the
attestation proof files inspected here match the pinned upstream source.
This identifies implementation behavior, not an approved FUSOU wire
specification or external approval of the fork.

The locked `bincode` version is `1.3.3` in the TLSN workspace and the
downstream Verifier, APP, and HTTPS Proxy lockfiles. `rangeset` is `0.4.0` in
the local TLSN workspace lockfile (also the pinned upstream lockfile) and
`0.4.1` in the downstream Verifier, APP, and HTTPS Proxy lockfiles. The
`RangeSet` Serde conversion remains through `Vec<Range<T>>`; the `0.4.1`
source also changes its set mutation algorithms. With no independently fixed
sparse Presentation bytes, this dependency-version skew is an unresolved
compatibility risk, not proof that the serialized representation differs.

Evidence labels used below:

- `UPSTREAM_SOURCE`: behavior in the pinned alpha.15 files.
- `FUSOU_PATCHED_SOURCE`: behavior in the local path-patched TLSN files.
- `FUSOU_CALLER`: behavior added by FUSOU verifier/proxy code.
- `TEST_OBSERVATION`: behavior exercised by a named local test.
- `NORMATIVE_CONTRACT`: an owner-approved protocol or wire specification.
- `UNRESOLVED`: evidence does not establish the required contract.

No owner-approved FUSOU sparse-Presentation wire specification or independent
sparse serialized golden vector was found. The alpha.15 source map is not
classified as `NORMATIVE_CONTRACT`.

### Transcript ranges and packed representation

`UPSTREAM_SOURCE`: transcript ranges are Rust half-open
`Range<usize>` offsets in a direction-specific byte stream: `start` is
included and `end` is excluded. `RangeSet` represents a sorted set of
non-empty, non-overlapping, non-adjacent ranges. Construction from ranges
filters empty ranges and sorts/merges overlap or adjacency. Its Serde form is
`Vec<Range<T>>`; each `Range` serializes `start` then `end`. Deserialization
also converts the raw vector through `RangeSet::from`, so empty, unordered,
overlapping, or adjacent wire entries are normalized rather than being
uniformly rejected as noncanonical input. The compressed transcript's later
length and bounds checks apply to that normalized set. This describes the
current parser path; it does not define an approved malformed-wire policy.

`FUSOU_PATCHED_SOURCE`: `PartialTranscript` serializes through
`CompressedPartialTranscript`, whose field order is:

1. `sent_authed: Vec<u8>`
2. `received_authed: Vec<u8>`
3. `sent_idx: RangeSet<usize>`
4. `recv_idx: RangeSet<usize>`
5. `sent_total: usize`
6. `recv_total: usize`

The two data vectors contain authenticated bytes concatenated in ascending
range order; the index fields map those bytes back to half-open transcript
offsets, and the total fields preserve each original direction's length.
`bincode::serialize`/`deserialize` use bincode 1.3.3's legacy fixed-integer,
little-endian encoding: sequence lengths and `usize` values are encoded as
`u64`; range elements are start then end. The compressed-transcript
deserializer checks that each packed data length equals its normalized range
set's total length and that the maximum range end is within the direction's
total length. `copy_authenticated_to` additionally requires requested ranges
to be in bounds and a subset of authenticated ranges. Explicit
`materialize_sent`/`materialize_received` compatibility methods zero-fill
omitted bytes, but the proof-verification path reads authenticated packed
bytes instead.

These are `UPSTREAM_SOURCE`/`FUSOU_PATCHED_SOURCE` implementation facts. The
field order and bincode encoding have not been fixed by an independent
sparse-Presentation byte vector. A Rust round-trip test establishes only
round-trip behavior for values created by that implementation; it is not a
cross-language or normative golden test.

The TLSN packed representation is separate from FUSOU Result range signing.
FUSOU Result ranges use their own framing: big-endian `u32` count, followed
for each range by big-endian `u64` start, length, byte length, then raw range
bytes. The Result validator rejects zero-length ranges, overflow,
out-of-bounds ranges, mismatched byte lengths, unsorted starts, and overlap;
adjacent ranges are allowed. The Node P0-10 corpus test exercises this FUSOU
Result framing, not TLSN's bincode `PartialTranscript`.

### Proof openings and verification boundary

`UPSTREAM_SOURCE` and `FUSOU_PATCHED_SOURCE`: a `TranscriptProof` contains a
`PartialTranscript` followed by `PlaintextHashSecret` openings. Each opening
contains a direction, range set, hash algorithm, and blinder. Verification
checks transcript lengths against the attested connection lengths, requires
each opening to be in bounds and readable from authenticated packed bytes,
recomputes `H(message || blinder)`, matches that value and range to an
attestation commitment, and requires the union of verified openings to equal
the ranges marked authenticated in the partial transcript.

`Presentation::verify` delegates to Attestation verification (body/header
proof and Notary signature), then optional server-identity proof verification,
then optional transcript-proof verification. This proves the Presentation's
claims relative to its included attestation and key; trust in that Notary key
and any origin trust anchor remains a caller policy. Packed-range consistency
checks alone do not verify the cryptographic openings.

`FUSOU_CALLER`: the adapter deserializes the exact Presentation bytes, checks
that no trailing bytes remain, optionally compares the serialized Notary key
with a caller-supplied trusted key, invokes TLSN `Presentation::verify`, and
retains the returned `PartialTranscript`. It derives FUSOU ranges and bytes
from authenticated indices; sparse reads fail when they cross undisclosed
ranges. The Evidence Bundle path separately verifies the signed Result,
Presentation digest and trusted material, re-verifies the Presentation, and
compares Presentation-derived Result ranges and semantic fields. This source
path is not itself a successful Production-shaped Evidence Bundle test.

### Fixture and test coverage

The only checked-in Presentation binary files found in the inspected
Verifier/TLSN/APP/Proxy package trees are:

- `packages/FUSOU-TLSN-VERIFIER/fixtures/tlsn-alpha15-upstream-presentation.bin`
- `packages/tlsn-alpha15-sparse/crates/attestation/tests/fixtures/presentation.bin`

They are identical: `5,394` bytes and SHA-256
`cb9b3befb43df5157a4d5ac52080ba19d842f191fa346bfda1dfc4927b37e5b6`. The
upstream generator is
`packages/tlsn-alpha15-sparse/crates/attestation/tests/fixtures/generate_presentation_fixture.rs`.
It creates a test-only, full-disclosure Presentation; it is not a sparse
opening vector or a FUSOU `require_info` Presentation. The FUSOU fixture test
checks the serialized embedded Notary key against its vector and verifies
the Presentation with the pinned backend, but calls the verifier without an
independent trusted Notary key. It therefore does not establish a Production
Notary trust root.

A positive sparse cryptographic test does exist as a runtime-generated
synthetic integration test:
`FUSOU-PROXY/proxy-https/src/synthetic_tlsn.rs`,
`synthetic_transport_uses_alpha15_and_preserves_wire_bytes`. With
`FUSOU_SYNTHETIC_PROOF_MODE=sparse`, it constructs and serializes a sparse
Presentation, verifies it using a test Notary key and test root certificate,
checks that the ordinary complete-transcript profile rejects a hidden read,
and checks that the sparse `require_info` profile derives the expected
member ID while keeping the full response digest absent. This is
`TEST_OBSERVATION` for a generated synthetic path, not an independent fixture:
generation and verification use the local TLSN implementation, and the test
does not freeze independent expected sparse Presentation bytes or openings.

A separate clean-upstream sparse sample is now checked in at
`packages/FUSOU-TLSN-VERIFIER/fixtures/tlsn-alpha15-clean-upstream-sparse-presentation.bin`.
Its generator is
`packages/FUSOU-TLSN-VERIFIER/fixtures/alpha15-clean-upstream-sparse-generator/`,
whose Cargo dependencies are pinned to clean upstream commit
`47aee45b53e06648c1b2ad3689b367b8c923fdec`. The generator invokes upstream
`Presentation::verify` before serialization and then deserializes and verifies
the serialized bytes before writing outputs. The fixed Presentation is 5,510
bytes with SHA-256
`936c9fdf1c73f422c33ccf3899bf75986badc340c5e0ab7f611661e979d6fde4`.
Its 132-byte serialized packed transcript is checked in separately with SHA-256
`a83c06f9df388a8d5047e25eed9e2f67d54415e6c3cf6b1416b9def42552608e`; the
42-byte test Notary verifying key has SHA-256
`c4452de9c5869c38ff197033cd0e5beb8930813c3d4b89377faa777a85364b2a`.
The test-only signer uses private key `[42; 32]`; the extracted serialized key
is test material only and is not a Production trust registration.

The sample discloses request bytes `[0,3)` and `[10,16)` from a 35-byte
request, and response bytes `[0,3)` and `[137,145)` from a 145-byte response.
The checked-in vector records the exact opened bytes, source fixture hashes,
range convention, generator revision, generator source/manifest/lock hashes,
and output hashes. The Rust
`clean_upstream_sparse_fixture_verifies_with_patched_backend` test verifies
the Presentation with the patched adapter and fixture Notary key, checks the
authenticated ranges and total transcript lengths, and compares the patched
serializer's `PartialTranscript` bytes exactly with the upstream-generated
sidecar. It also checks the recorded generator source/manifest/lock hashes
and verifying-key length against the checked-in artifacts. Flipping the final
serialized opening byte is rejected by
`Presentation::verify`. For this serialization, the source field order places
the final `PlaintextHashSecret` blinder at the end of the `TranscriptProof`;
the test requires a `PresentationVerification` error for this mutation, after
decoding and trailing-byte checks have succeeded. Truncation is expected to
fail as `PresentationDecode`; an appended byte is expected to fail the
explicit trailing-byte check with the `trailing Presentation bytes` message
inside `PresentationDecode`. These observations do not establish every
possible opening mutation rule. The generator creates each output with
`create_new` so it refuses to overwrite an existing file. It writes the
Presentation and binary sidecars only; the JSON vector remains the expectation
record for the fixed checked-in sample and is not regenerated from randomized
output.

Classify this fixture as **separate checkout/revision implementation-derived
(category 3)**, not as an independent implementation or external normative
golden. The source and patched verifier share the TLSNotary codebase and
serializer family. The checked-in Presentation bytes are a fixed sample, but
the generator uses randomized Attestation UID and certificate-opening blinder,
so rerunning it does not reproduce the Presentation bytes/hash. The observed
packed-transcript byte equality is limited to this sample and does not approve
a FUSOU sparse wire contract.

Rust verifier tests also include synthetic in-memory `PartialTranscript`
reader cases. They test FUSOU parser/binding behavior, not independently
generated sparse TLSN proofs. The `no_syscall_verify` upstream fixture test
uses the full-disclosure binary. No independent Node bincode decoder or
TLSN proof verifier exists in the P0-10 corpus; the new fixture has no Node
consumer. Node-to-WASM checks, when run, are integration tests and not
independent JavaScript verification. The existing local WASM artifact was not
run or changed; its provenance remains `UNRESOLVED`.

### Verification and disposition

### alpha.15 sparse-workspace test restoration

The missing `crates/tls/server-fixture` manifest was caused by the partial
source import in commit `1238983b9`, not by sparse-checkout, ignore rules, a
submodule, or a later deletion. Pinned upstream alpha.15 revision
`47aee45b53e06648c1b2ad3689b367b8c923fdec` contains this test-only crate and
the related `crates/server-fixture/server` and `crates/server-fixture/certs`
packages. Their 42 restored files were checked against the pinned upstream Git
blob IDs. No placeholder crate or fixture was added, and no production trust
material or protocol implementation was changed.

The sparse workspace now has 14 members, including `data-fixtures` and those
three fixture packages, and excludes `examples-zk`. The active member manifests
and their referenced path dependencies have no missing source. Unused
workspace-dependency declarations for omitted upstream components remain
untouched. The complete upstream workspace was not copied: a separate local
source import differed from the pinned upstream tree, so it was not a safe
source of restoration.

The ignored lockfile initially matched the full upstream workspace, not this
14-member sparse workspace. Cargo generated a subset lockfile while resolving
offline; its SHA-256 is
`ee818790d5cb177d1d3311936bab77b182964748215f39bc82dc78e2fe33d5e7`. That
lockfile is tracked with this workspace repair so the focused `--locked`
commands below are reproducible. A full `cargo metadata --offline` still exits
101 because `wasip2 v1.0.3+wasi-0.2.9` is not cached; no online dependency
fetch was attempted. The selected tests do not build that target-specific
package.

Commands were run from the repository root:

| Command | Result | Scope |
| --- | --- | --- |
| `cargo run --locked --offline --manifest-path packages/FUSOU-TLSN-VERIFIER/fixtures/alpha15-clean-upstream-sparse-generator/Cargo.toml -- /tmp/fusou-alpha15-clean-upstream-review.presentation` | Succeeded; generated 5,510 bytes; new Presentation SHA-256 `1d0e7d3af873100bd11829555d68fc513425e8483051de0aa78bccae850c4d7f`; packed sidecar and public key matched checked-in files byte-for-byte | The generator verifies the serialized Presentation with clean upstream; randomized UID/blinder explain the differing Presentation digest |
| `cargo run --locked --offline --manifest-path packages/FUSOU-TLSN-VERIFIER/fixtures/alpha15-clean-upstream-sparse-generator/Cargo.toml -- packages/FUSOU-TLSN-VERIFIER/fixtures/tlsn-alpha15-clean-upstream-sparse-presentation.bin` | Expected failure (`AlreadyExists`); tracked Presentation SHA-256 remained `936c9fdf1c73f422c33ccf3899bf75986badc340c5e0ab7f611661e979d6fde4` | Confirms `create_new` prevents an explicitly targeted tracked fixture from being overwritten |
| `cargo test --locked --offline --manifest-path packages/FUSOU-TLSN-VERIFIER/Cargo.toml clean_upstream_sparse_fixture_verifies_with_patched_backend` | 1 passed | Cross-revision sparse Presentation characterization; exact packed sidecar comparison; truncation/trailing failures classified as decode; opening-byte mutation classified as Presentation verification failure |
| `cargo test --locked --offline --manifest-path packages/FUSOU-TLSN-VERIFIER/Cargo.toml alpha15` | 20 passed, 71 filtered; 3 offline CLI tests filtered | FUSOU alpha.15 adapter, including the new sparse fixture; not a full crate run |
| `FUSOU_SYNTHETIC_PROOF_MODE=sparse cargo test --locked --offline --manifest-path packages/FUSOU-PROXY/proxy-https/Cargo.toml --features synthetic-tlsn synthetic_transport_uses_alpha15_and_preserves_wire_bytes` | 1 passed, 95 filtered | Generated synthetic sparse Presentation integration; emitted an existing unused-import warning |
| `node --test packages/FUSOU-TLSN-VERIFIER/tests/p010-corpus.test.mjs` | 8 passed | Node Result/receipt corpus, including FUSOU Result range framing; not TLSN sparse bytes |
| `cargo metadata --offline --manifest-path packages/tlsn-alpha15-sparse/Cargo.toml --format-version 1` | Failed, exit 101 | Offline metadata requested uncached `wasip2 v1.0.3+wasi-0.2.9`; it did not prevent the focused host-target tests |
| `cargo test --locked --offline --manifest-path packages/tlsn-alpha15-sparse/Cargo.toml -p tlsn-core test_partial_transcript` | 10 passed, 77 filtered | Core transcript/range tests; the old full-workspace lock first had to be regenerated for the sparse workspace |
| `cargo test --locked --offline --manifest-path packages/tlsn-alpha15-sparse/Cargo.toml -p tlsn-attestation --test no_syscall_verify` | 1 passed | Attestation verification without syscalls |

The restored Rust sources are pinned upstream test-fixture code. The changed
Rust files passed targeted `rustfmt --check`; the vector JSON parsed and
`git diff --check` passed. No test was disabled or weakened.

| Contract item | Disposition |
| --- | --- |
| Pinned alpha.15 and local path-patch source mapping | `PASS` for factual source mapping; P0-01 approval remains `BLOCKED_EXTERNAL_INPUTS` |
| Full-disclosure upstream Presentation verification by FUSOU adapter | `PASS_LOCAL_TESTS` for the focused fixture test only |
| Generated synthetic sparse Presentation and FUSOU sparse parser path | `PASS_LOCAL_TESTS` for the feature-gated test; test-only, same-source generation |
| One clean-upstream sparse Presentation and exact packed-transcript comparison | `PASS_LOCAL_TESTS` as category-3 cross-revision characterization for this fixed sample only |
| Independent sparse Presentation golden and owner-approved wire contract | `UNRESOLVED` |
| Independent proof-opening implementation/vector and Node verifier | `UNRESOLVED` / `NOT_IMPLEMENTED` |
| Node independent TLSN Presentation verifier | `NOT_IMPLEMENTED`; Node-to-WASM remains integration-only |
| TLSN workspace core and `no_syscall_verify` tests | `PASS_LOCAL_TESTS` for the exact focused commands above |
| WASM provenance | `UNRESOLVED` |
| P0-10 overall | `UNRESOLVED` |

No normative FUSOU sparse-Presentation wire contract was established. Closing
the byte-level item still requires an authorized, versioned wire contract
(including serializer configuration and range normalization rules), an
independent implementation or externally grounded expected values, and an
independent Node verifier if cross-language verification is claimed. The
category-3 fixture and focused Rust tests establish only one clean-upstream to
patched-source compatibility observation. The sparse-workspace source blocker
is resolved for the focused Rust tests, but this does not establish an
independent golden vector or a normative contract. P0-01 remains
`BLOCKED_EXTERNAL_INPUTS`; Phase 0 runtime gate remains `BLOCKED`; Hosted CI
and real Game Server testplay remain `NOT_RUN`; Production acceptance remains
`BLOCKED`.

## P0-01 independent source review package

This continuation supersedes the earlier provisional source-map statements
above wherever they said that the `tlsn` verifier changes or the local
`tlsn-mux` source identity were not yet determined. It records source
observations for human review; it does not perform or imply approval.

### Review execution and comparison method

- The working branch was `tlsn-first-testplay-candidate` at
  `3c75454e73d48162d161a3c24e172145be777610`, tracking
  `origin/tlsn-first-testplay-candidate` at `0 ahead / 0 behind`. The prior
  audit commit `3c75454e...` was an ancestor of HEAD.
- The only pre-existing worktree changes were the user-owned `justfile` and
  APP `src-tauri/roaming/user/configs.toml`. Neither was read, changed,
  staged, or committed. No paths were staged at the start.
- The clean TLSNotary source was already present in the local Cargo Git cache
  at exact commit `47aee45b53e06648c1b2ad3689b367b8c923fdec`; no fetch or
  network access was used. Its tracked files were clean; Cargo had left an
  untracked `.cargo-ok` cache marker. The `tlsn-utils` checkout was at exact
  commit `64722f7de999cbd41c0cab7312dade306d50ea5f`.
- The comparison used the cached pinned worktrees and the tracked FUSOU path
  sources. The TLSNotary code differences in the relevant crate directories
  are exactly `core/src/transcript.rs`,
  `core/src/transcript/proof.rs`,
  `tlsn/src/transcript_internal/auth.rs`,
  `tlsn/src/verifier/verify.rs`, and test-only
  `attestation/tests/api.rs`. No production `Presentation::verify`,
  Attestation signature-verification, or identity-proof source file differs.
- The local `tlsn-mux` package manifest matches the pinned `mux/mux` manifest.
  Its code difference is limited to the default stream-count and
  connection-receive-window values in `src/lib.rs`; its local README and
  license files are also not byte-identical to the pinned parent-directory
  files. The relevant path is tracked in FUSOU.
- No code, fixture, Cargo manifest, lockfile, or WASM artifact was changed in
  this review. The focused test results below are previous recorded local
  results; no tests were rerun here. No Hosted CI or external operation was
  performed.

### Actual dependency closure and source identity

| Consumer | Declared dependency and effective source | Lock/source evidence and scope |
| --- | --- | --- |
| APP | `tlsn-attestation` declares TLSNotary alpha.15; `[patch]` maps `tlsn`, `tlsn-attestation`, and `tlsn-core` to `packages/tlsn-alpha15-sparse`. A separate `tlsn-utils` patch maps `tlsn-mux` to `packages/tlsn-mux-alpha15`. | APP `Cargo.lock` records patched path packages without a Git source. The `tlsn-utils` revision is `64722f7de999cbd41c0cab7312dade306d50ea5f`. |
| HTTPS Proxy | `tlsn` and `tlsn-formats` declare alpha.15; `[patch]` maps `tlsn`, `tlsn-attestation`, and `tlsn-core` to the same sparse source. Its `tlsn-utils` patch maps `tlsn-mux` to the FUSOU path package. | Proxy `Cargo.lock` records patched path packages and the full `tlsn-utils` revision above. |
| Dedicated Verifier | `tlsn`, `tlsn-attestation`, and `tlsn-core` declare alpha.15 and are patched to the sparse source. It has no `tlsn-utils` `[patch]`. | Verifier `Cargo.lock` resolves `tlsn-mux` from the pinned `tlsn-utils` Git revision, not from `packages/tlsn-mux-alpha15`. The offline Presentation verification path does not itself open mux streams, but this remains a distinct compiled dependency source. |
| Clean-upstream sparse generator | Direct TLSNotary Git dependencies use `47aee45b53e06648c1b2ad3689b367b8c923fdec`; it does not use the FUSOU path patch. | Its separate manifest and lockfile provide the clean-upstream side of the category-3 fixture comparison. |
| Sparse TLSNotary workspace | The tracked sparse subset is the FUSOU source import; its manifest pins relevant `tlsn-utils` Git dependencies to `64722f7` and its lock resolves the full revision. | The subset lock uses `rangeset 0.4.0`. Downstream APP, Proxy, Verifier, and clean generator locks resolve `rangeset 0.4.1`. |

The Cargo manifests name the upstream revision even where `[patch]` makes
local paths the effective source. Consequently the lockfiles do not, by
themselves, identify the contents of the patched TLSN crates. The relevant
local source is tracked in FUSOU and was compared against the pinned checkout.
The verifier's `tlsn-mux` source identity is independently mapped to the
locked `tlsn-utils` commit; APP and Proxy instead build the local changed
defaults. Other locked Git dependencies, including the recorded `mpz` and
`rs-merkle` revisions, were not independently security-reviewed in this
continuation. This is direct dependency/source mapping evidence, not a
security review of the full transitive dependency set.

No separate tracked FUSOU Notary Cargo manifest was found in the inspected
Cargo manifests. Therefore the local evidence establishes the mux patch in
APP and Proxy only. It does not establish which mux source or resource limits
an external Notary deploys, nor that both MPC endpoints require identical
local defaults.

### Security-relevant source differences

| Source | Pinned alpha.15 behavior | FUSOU behavior and security/compatibility effect | Existing evidence and limit |
| --- | --- | --- | --- |
| [`transcript.rs`](../../packages/tlsn-alpha15-sparse/crates/core/src/transcript.rs), `PartialTranscript` | Sparse transcript materialization used an original-length buffer with zeroes in undisclosed positions. | Stores authenticated bytes packed in range order, direction-specific `RangeSet<usize>` indices, and original total lengths. `copy_authenticated_to` checks total-length bounds and that requested ranges are a subset of authenticated ranges. `materialize_sent`/`materialize_received` still zero-fill only as explicit compatibility operations and are documented not to be used for cryptographic verification. This changes memory and internal serialization representation, not the TLSN opening algorithm by itself. | `test_partial_transcript` covers construction, length/range validation, serialization roundtrip, union, and subsequence cases; the clean-upstream sample checks one exact packed sidecar. General adversarial/property testing and independent decoding are absent. |
| [`proof.rs`](../../packages/tlsn-alpha15-sparse/crates/core/src/transcript/proof.rs), `TranscriptProof::verify_with_provider` | Read each opening from the full transcript buffer after checking its end bound. | Checks the partial transcript direction/length, reads opening bytes only via `copy_authenticated_to`, recomputes the hash with the opening blinder, matches the commitment, and requires the union of verified opening ranges to equal the transcript's authenticated ranges. The verification obligations remain present; the changed source of bytes is security-critical. | The sparse fixture rejects a changed opening; core tests cover out-of-bounds and commitment mismatch cases. A single changed final byte does not prove every malformed opening case. |
| [`auth.rs`](../../packages/tlsn-alpha15-sparse/crates/tlsn/src/transcript_internal/auth.rs) and [`verify.rs`](../../packages/tlsn-alpha15-sparse/crates/tlsn/src/verifier/verify.rs) | Plaintext authentication received a full contiguous plaintext slice and indexed it for revealed ranges. | Receives the verified `PartialTranscript` plus direction. Full disclosure reads the full authenticated range; sparse disclosure copies each revealed range from authenticated packed bytes, while unrevealed committed bytes remain blind for the ZK path. Sparse read errors become `PlaintextAuthError::Sparse` and propagate through `Result`; no catch-and-continue path was found. | The synthetic sparse Proxy test covers the local path; focused verifier tests cover parsing and sparse reads. They do not independently prove the MPC/ZK implementation for all adversarial record/range combinations. |
| `attestation/tests/api.rs` | Upstream test code read `sent_unsafe` / `received_unsafe`. | Test-only calls use the explicit zero-filling `materialize_*` API. No production Attestation or `Presentation` verifier source changed in this crate. | This is source compatibility for tests, not independent evidence about the changed cryptographic path. |
| [`tlsn-mux-alpha15/src/lib.rs`](../../packages/tlsn-mux-alpha15/src/lib.rs) | Default maximum was 512 streams and a 1 GiB aggregate receive-window ceiling. | Default maximum is 10,240 streams and aggregate receive-window ceiling 2.5 GiB to satisfy the crate's `256 KiB * max_num_streams` invariant. Frame encoding and stream protocol source are unchanged. The ceiling is a larger per-connection resource envelope; this review found no evidence that the entire ceiling is eagerly allocated. | No FUSOU test was identified that exercises memory pressure or adversarial stream growth at the changed defaults. The change needs resource/DoS review; it is not a demonstrated exploit. |
| Bincode / `RangeSet` | Pinned alpha.15 lock uses `bincode 1.3.3` and `rangeset 0.4.0`. | Downstream runtime locks use `bincode 1.3.3` and `rangeset 0.4.1`; the latter changes `union_mut` and `difference_mut` algorithms but retains the `Vec<Range<T>>` Serde conversion. Bincode's legacy helper functions use fixed-width little-endian encoding and `deserialize_from` allows trailing bytes; the FUSOU adapter checks the cursor against the exact Presentation byte length and rejects trailing data. Range deserialization normalizes through `RangeSet::from`, so noncanonical range lists are not necessarily rejected as noncanonical. | The generator and downstream verifier both resolve 0.4.1 for the fixture comparison; the sparse-workspace unit-test lock uses 0.4.0. One exact sample does not establish all serialization/version behavior or an owner-approved malformed-wire policy. |

### Trust material and verification-path audit

`Presentation::verify` remains the upstream alpha.15 implementation: it
verifies the Attestation, then any included server-identity proof, then any
included transcript proof. The FUSOU adapter additionally rejects trailing
Presentation bytes and requires verified server identity and transcript
outputs. A call with no trusted Notary key verifies relative to the key
embedded in the Presentation; it does not authorize that key as a FUSOU
Notary.

| Trust function | Material source and verification path | Failure behavior and evidence boundary |
| --- | --- | --- |
| Game Server Web PKI during capture | `OriginTarget` requires DNS host identity and the configured hostname to match. `OriginTlsConfig::new` loads platform-native certificates; the Prover TLS client uses that root store and `ServerName::Dns` for the approved identity. No certificate pin or custom root is added by this path. | Empty native roots fail configuration; TLS chain/hostname/handshake errors fail capture. Preflight's root-store check proves only that roots can be loaded, not that a particular server chain validates. `tlsn_origin_probe` has synthetic hostname, expiry, missing-intermediate and wrong-root tests; no real target was contacted. |
| Runtime Config / Worker / Session Authority HTTPS transport | APP and Proxy use `reqwest 0.12.28` with redirects disabled. In the resolved APP and Proxy feature graphs, `rustls-tls-webpki-roots` is enabled directly and `rustls-tls-native-roots` is enabled transitively through `object_store`; reqwest's default built-in-root settings load both sets for these clients. This transport PKI is distinct from the signed application-level config/receipt keys. | Invalid status, redirects, invalid response identity or invalid signatures fail their respective paths. The active root set is a Cargo feature-unification result, not an independently pinned per-client root policy. |
| TLSNotary Notary authentication | The signed Runtime Config binds the Notary endpoint and the Notary registry/key ID. Its canonical security-registry artifact is digest-bound by the signed manifest and checked against the `FUSOU_TLSN_NOTARY_VERIFYING_KEY` input. The Verifier checks the Result's Notary key ID against its externally supplied registry, compares the serialized Presentation verifying key to that registry value, then calls upstream `Presentation::verify`. | A missing or mismatched key fails closed. The production APP wiring sends the Presentation to `RemoteWorkerVerificationBackend`; the local `RealAlpha15DedicatedVerifier` is not the selected APP production backend. The tracked Worker package does not contain its Production request handler, so this checkout does not independently establish the deployed Worker's verification path. |
| Notary transport | `RealAlpha15OriginTransportFactory` connects to the configured Notary endpoint with `TcpStream`, not an HTTPS client. | The source establishes no Web PKI validation for the Notary socket. The Presentation's allowlisted Notary key authenticates the resulting proof, but does not itself establish transport confidentiality or availability. Whether the Notary protocol's own channel protections meet policy remains for Security review; no exploit or transport guarantee is inferred here. |
| Result signer | The Runtime Config signature binds the Result registry, its digest, the Result registry root key ID/SPKI and signer compile inputs. APP verifies the registry-root envelope before constructing `ResultSignatureVerifier`; that verifier checks the expected signer ID, SPKI equality, `ACTIVE` status, validity window and Result signature. | Missing/invalid registry or signature rejects the Result. This is distinct from the outer Runtime Config signature and from the Evidence Root used by offline verification. |
| Session Authority | APP obtains endpoint, key ID and Ed25519 SPKI from verified Runtime Config. `RemoteSessionBindingProvider` requires a Supabase Auth session and registered device key, signs the device challenge, then checks response/device/session/binding/expiry fields and verifies the Session Authority receipt with that key. | Invalid or expired receipt, key ID substitution, challenge mismatch or signature failure rejects binding. Offline bundle verification additionally requires an external Session Authority registry/key pin; APP's signed Runtime Config input is not that offline verifier's independent operator pin. |
| Runtime Config authority | `RuntimeConfigBootstrap::from_embedded` is the independent bootstrap: the manifest URL, signer key ID and signer SPKI are embedded inputs. The envelope and payload must be canonical, match the pinned signer ID/scope, and pass Ed25519 verification and freshness/epoch checks. The verified manifest then digest-binds the Worker reference, Origin Inventory, Target Approval, security registry set and Result registry envelope. | All three embedded bootstrap constants are `None`; `from_embedded` returns `Production Runtime Config bootstrap is not registered` before fetching. Startup logs that TLSN remains blocked; TLSN preflight and proxy startup fail when they require `refresh`. There is no unsigned fallback. |
| Evidence Bundle / offline trust | `verify_fusou_tlsn_evidence` requires caller-supplied Evidence Root ID/SPKI, Notary and Session/Binding Authority registries, Origin Inventory, Target Approval and `--trust-anchor-der`. The verifier compares the bundle's Notary/authority registries and raw trust-root artifact byte-for-byte with those external values, verifies the Result registry envelope under the Evidence Root, then verifies the Result and Presentation. The TLSN Presentation verifier replaces its default certificate verifier with a store containing only the supplied DER trust anchor. | Missing or mismatched external values reject the bundle. The bundle is not itself a trust anchor, and this verifier's external DER root is not automatically the APP's native roots or TLSN's default Mozilla roots. |

These roots are intentionally different input paths in the current source;
their difference alone is not a defect. No owner-approved policy establishes
that they must be equal, or that a chain accepted by one must be accepted by
the others. `Target Approval` is checked for canonical form, `APPROVED` status,
inventory digest and target membership, but the artifact has no separate
signature field: its digest is authorized through the signed Runtime Config
manifest. The authority and approval record behind that manifest signer remain
external inputs, not properties proven by the hostname, health response, or
artifact's status string alone.

### Existing test and evidence map

The table distinguishes previous recorded results from the no-syscall rerun
performed for this continuation.

| Test/evidence | Input and implementation path | Assertions and expected-value independence | What it does not establish |
| --- | --- | --- | --- |
| `clean_upstream_sparse_fixture_verifies_with_patched_backend` | Fixed 5,510-byte Presentation generated and verified by the clean checkout at `47aee45...`; patched FUSOU adapter verifies it using the fixture's 42-byte public Notary key. | Checks generator/manifest/lock hashes, fixture and sidecar lengths/hashes, direction-specific half-open ranges, disclosed bytes, total transcript lengths, no fabricated full digest, and exact equality of packed `PartialTranscript` bytes to the clean-upstream sidecar. Truncation and trailing bytes are classified as decode failures; final opening-byte mutation is classified as Presentation verification failure. | Category-3 same-codebase characterization only. The expected sidecar is not an independent implementation oracle or normative contract; the mutation assertion does not identify the failing proof sublayer. |
| `real_alpha15_fixture_verifies_with_pinned_backend` | 5,394-byte full-disclosure upstream fixture. | Checks fixture hash/length, Attestation ID encoding, included Notary key serialization, server identity, full transcript digests/ranges, and a profile/parser rejection. | Calls the no-allowlist helper; it does not establish Notary authorization. It is full disclosure, not sparse proof interoperability. |
| `cargo test --locked --offline --manifest-path packages/FUSOU-TLSN-VERIFIER/Cargo.toml alpha15` | Recorded result: 20 passed, 71 filtered; 3 offline CLI tests also filtered. | Exercises the FUSOU alpha.15 adapter and its local unit cases. | Focused filter only, not the entire Verifier suite, external Notary/Origin authority, or Production evidence. |
| `cargo test --locked --offline --manifest-path packages/tlsn-alpha15-sparse/Cargo.toml -p tlsn-core test_partial_transcript` | Recorded result: 10 passed; sparse-workspace lock uses `rangeset 0.4.0`. | Exercises partial transcript bounds, length consistency, serialization roundtrip, union, and subsequence behavior. | Not the downstream 0.4.1 runtime dependency and not independent cryptographic verification. |
| Previous `cargo test --locked --offline --manifest-path packages/tlsn-alpha15-sparse/Cargo.toml -p tlsn-attestation --test no_syscall_verify` record | 1 passed; full-disclosure fixture. | Calls upstream `Presentation::verify` and checks that server name and transcript are present. | The recorded command omitted the test comment's `RUSTFLAGS='--cfg getrandom_backend="unsupported"'`; it did not establish even that configured backend condition. |
| `RUSTFLAGS='--cfg getrandom_backend="unsupported"' cargo test --locked --offline --manifest-path packages/tlsn-alpha15-sparse/Cargo.toml -p tlsn-attestation --test no_syscall_verify` | Rerun in this audit: 1 passed using local rustc/cargo 1.98.1; pinned upstream CI declares Rust 1.95.0. | `RUSTFLAGS` is applied by Cargo to rustc invocations in the build. The lockfile's host test closure includes `getrandom 0.3.4`, whose `unsupported` backend returns `Error::UNSUPPORTED`; the test successfully deserializes the fixture, calls `Presentation::verify`, and asserts server name and transcript are present. | The same host dependency closure also contains `getrandom 0.2.17` through `ring` and test dependencies; that version has no `getrandom_backend` dispatch and is not disabled by this flag. The test has no syscall tracer and asserts only those two outputs. It supports the narrower statement that this verification succeeds with the `getrandom 0.3.4` backend disabled; it does not verify that every dependency/syscall path is unused, and it says nothing about system-wide syscall absence or Notary authorization. |
| `FUSOU_SYNTHETIC_PROOF_MODE=sparse cargo test --locked --offline --manifest-path packages/FUSOU-PROXY/proxy-https/Cargo.toml --features synthetic-tlsn synthetic_transport_uses_alpha15_and_preserves_wire_bytes` | Recorded result: 1 passed; runtime-generated local sparse Presentation, test Notary key, and test root certificate. | Checks serialization/wire-byte retention, cryptographic verification by the patched backend with explicit test root/key, disclosed profile fields, and rejection of a parser read crossing an undisclosed gap. | Producer and verifier are the same FUSOU/TLSN code lineage; no independent expected Presentation bytes, production Notary, or real server. |
| `node --test packages/FUSOU-TLSN-VERIFIER/tests/p010-corpus.test.mjs` | Recorded result: 8 passed; Rust/Node shared FUSOU Result and receipt corpus. | Independently in JavaScript encodes/checks FUSOU Result range framing, Result/receipt JSON and signing bytes against corpus expectations. | Does not decode TLSN bincode or verify Presentation proof openings; Node-to-WASM is not an independent JavaScript TLSN verifier. |
| `src/evidence_bundle.rs` offline verifier tests | Local fixed/test artifacts and mutation cases; `verify_bundle` requires Result, Presentation, registries, root, Target Approval, session/device artifacts, and semantic/capture records. | Tests include signed Presentation hash binding, Notary-key validation, current Target Approval/trust-set checks, and contract mutation rejection. The verifier code re-verifies the Presentation and compares derived Result fields against external registry/config inputs. | No successful real Production-shaped Evidence Bundle or external deployment evidence was found. Source-level implementation and unit tests are not Production acceptance. |

### License and attribution observations

- Pinned TLSNotary alpha.15 contains root `LICENSE-MIT` and
  `LICENSE-APACHE` files; its README says all repository crates are dual
  licensed MIT OR Apache-2.0. Several package manifests, including
  `tlsn-attestation`, `tlsn-data-fixtures`, and
  `tlsn-server-fixture-certs`, omit a `license` field. The imported
  `packages/tlsn-alpha15-sparse` subset contains no root license files.
  `tls-server-fixture` does declare `MIT OR Apache-2.0`.
- The local `tlsn-mux` package manifest declares `MIT OR Apache-2.0`, but its
  local `LICENSE-MIT` names `sinu` (2023), whereas pinned
  `tlsn-utils/mux/LICENSE-MIT` names Parity Technologies (2018). The local
  `LICENSE-APACHE` omits the upstream Appendix after “END OF TERMS AND
  CONDITIONS”. These are observed text differences, not a determination that
  either file is or is not legally sufficient.
- The clean-upstream sparse generator's `[42; 32]` signing key and checked-in
  serialized verifying key are test-only. The checked-in key fixture is
  public verifying material, not a Production trust registration. This does
  not settle source license, generated fixture, restored test-crate, or
  attribution obligations.
- No independent license/legal approval, notice inventory sign-off, or
  distribution decision is recorded. Do not edit or replace license files as
  part of this audit.

### Risk register for review

No confirmed exploitable vulnerability was established by this source review.
“Review priority” is not a vulnerability-severity finding.

| ID | Severity / rationale | Trigger and trust boundary | Existing mitigation | Unresolved evidence / additional work | Required disposition |
| --- | --- | --- | --- | --- | --- |
| P0-01-R1 | `UNASSESSED; HIGH review priority`: the sparse patch changes which bytes feed proof-opening verification. | Malformed, overlapping, out-of-bounds, or incomplete ranges at the Presentation-to-authenticated-transcript boundary. | Bounds and authenticated-subset checks; hash-opening-to-commitment matching; exact authenticated-range coverage; failures propagate. | Independent security review; fuzz/property tests for range normalization, lengths, packed offsets, and opening/commitment coverage; adversarial cases across runtime lock versions. | Independent security reviewer must approve or request fixes/evidence. |
| P0-01-R2 | `MEDIUM`: distinct or feature-unified trust stores can reject otherwise valid captures or accept chains outside the intended root policy. | Origin capture uses native platform roots; APP/Proxy reqwest clients resolve both native and WebPKI roots; `CryptoProvider::default()` uses Mozilla roots; offline bundle verification replaces that verifier with one externally supplied DER anchor. | Hostname/identity checks and explicit Notary/Result authority checks remain separate; the Evidence Bundle compares its root artifact to the external DER anchor byte-for-byte. | Specify the intended root policy for each transport and proof-verification boundary; test root-set divergence and migration cases, including actual APP production wiring. | Security/protocol owner decision and targeted test evidence. |
| P0-01-R3 | `MEDIUM`: semver-compatible `RangeSet` source versions have different mutation algorithms and workspace/runtime lock skew. | Range union/difference and serialization behavior when ranges are normalized or deserialized across the 0.4.0/0.4.1 boundary. | Both versions use the `Vec<Range<T>>` Serde conversion; downstream clean generator and verifier both lock 0.4.1 for the one sample. | Differential/property tests against both versions and an owner-approved canonical/malformed range policy. | Protocol owner approval or additional evidence; do not treat one fixture as general proof. |
| P0-01-R4 | `UNASSESSED; HIGH resource-review priority`: the mux's permitted per-connection limits increase substantially. | Remote stream growth against APP/Proxy connections using 10,240 streams and a 2.5 GiB receive-window ceiling. | Window cap remains finite; flow-control invariant ties the configured cap to stream count. | Measure actual allocation behavior; run bounded resource/DoS tests under the changed defaults; establish external Notary configuration and peer compatibility. | Security/release authority review; change defaults only through an approved decision. |
| P0-01-R5 | `UNASSESSED; legal/distribution blocker`: local mux notices differ and the imported sparse subset omits upstream root license files. | Distribution of patched/copied TLSNotary and `tlsn-mux` source or binaries. | Upstream root dual-license statement and package-level metadata exist for some, not all, packages. | Provenance, notice, license applicability, and restored/generated test-source inventory reviewed by authorized legal/licensing authority. | Legal approval or documented remediation before distribution; no coding-AI judgment. |
| P0-01-R6 | `MEDIUM`: APP/Proxy and Verifier compile different `tlsn-mux` source paths. | Any behavior relying on mux default resource limits across these components or an external Notary. | The observed source difference is configuration defaults only; Presentation verification does not operate a mux stream. | Confirm deployed endpoint roles and configuration; add cross-endpoint integration evidence if mux resource behavior is part of the protocol. | Protocol/release authority decision; external Notary source remains `UNKNOWN`. |

### Decisions required from authorized reviewers

All decisions below are `PENDING`; this audit author is not an approving
authority.

| Reviewer | Evidence to review | Approve only if | Reject or request more evidence if |
| --- | --- | --- | --- |
| Security reviewer | Pinned upstream diff, all four TLSN production-source changes, proof-opening/error propagation, trusted-key/root call paths, fixture limitations, and mux resource change. | Independent review finds the retained TLSN cryptographic obligations sound for the supported targets and the operational/resource bounds acceptable; findings and test evidence are recorded. | Any proof/range invariant, trust input, error path, or resource limit is unclear or lacks adversarial test evidence. |
| TLSN/FUSOU protocol owner | Bincode/range encoding, `.4.0`/`.4.1` source skew, packed transcript structure, exact sample/sidecar, Result boundary, versioning and compatibility matrix. | An owner-approved versioned wire contract fixes field order, serializer options, range normalization, malformed-input behavior, and compatibility policy; independent vectors/tests match it. | The contract or precedence is ambiguous, or a same-codebase sample is being treated as a normative oracle. |
| License/legal authority | Upstream root licenses/README, copied source provenance, local mux MIT/Apache differences, sparse subset omissions, package metadata, restored test-only crates and generated fixtures. | License choice, notices, attribution, redistribution, and test-fixture treatment are documented for the intended distribution. | Ownership, permission, notice completeness, or license applicability is uncertain. |
| Release authority | Security/protocol/legal outcomes, exact source and lock identities, test scope, runtime/Notary role, and intended first-testplay versus later-production use. | The exact revision/patch is explicitly authorized for a bounded scope with remaining gates and rollback/retirement conditions recorded. | Any mandatory approval remains pending, source identity differs, or the proposed scope depends on an unapproved exception. |

### P0-01 sub-dispositions

| Sub-item | Status | Meaning |
| --- | --- | --- |
| Pinned TLSNotary alpha.15 revision identity | `PASS_EVIDENCE` | Exact cached upstream commit and declared Git revision agree; no external fetch was needed. |
| TLSN patched-source correspondence | `PASS_EVIDENCE` | Relevant local crate trees were compared; exact production and test-only differing files are listed above. |
| `tlsn-mux` source identity | `PASS_EVIDENCE` | Local package maps to the pinned `tlsn-utils` revision with a precisely bounded source-default diff; notices are separately unresolved. |
| Direct dependency closure and lockfile mapping | `PASS_EVIDENCE` | APP, Proxy, Verifier, generator, and sparse workspace effective sources are distinguished. This is not a transitive dependency security audit. |
| Independent security review | `UNRESOLVED` | No authorized independent security review was performed or recorded. |
| License/attribution review | `BLOCKED_EXTERNAL_INPUTS` | Human legal/licensing decision and notice disposition are required. |
| Compatibility and normative wire contract | `UNRESOLVED` | Same-codebase characterization exists; no owner-approved contract or independent sparse golden exists. |
| Human approval record | `BLOCKED_EXTERNAL_INPUTS` | No reviewer decision or release authorization is recorded. |
| P0-01 overall | `BLOCKED_EXTERNAL_INPUTS` | Do not promote until required independent review and approvals are actually recorded. |

P0-10 remains `UNRESOLVED`; Phase 0 runtime gate remains `BLOCKED`; WASM
provenance remains `UNRESOLVED`; Hosted CI remains `NOT_RUN`; real TLSN
testplay remains `NOT_RUN`; Production acceptance remains `BLOCKED`.

## Reusable authenticity prototype boundary

A standalone local Rust workspace now explores provider-neutral identity
types, pluggable authentication and device-proof interfaces, and a
feature-gated adapter against the pinned clean TLSNotary alpha.15 source.
Details, limitations, and exact local test commands are in the
[authenticity prototype README](../../packages/authenticity/README.md).

The adapter uses the same clean-upstream sparse fixture as prior
characterization, verifies it with the exact declared upstream Git revision,
and extracts only authenticated disclosure ranges. This is an adapter-boundary
prototype, not an independent golden vector or security review. Its caller
supplies the expected hostname, serialized Notary key, and certificate trust
policy; no production registry, Target Approval, Origin Inventory, or Runtime
Config path is integrated.

The identity provider, device registry, replay store, and challenge authority
in the consumer are local test implementations. The challenge encoding is a
draft library-local format, not an approved FUSOU protocol contract. The
consumer report is explicitly non-self-authenticating; Result/Claim signing
and Evidence Bundle verification remain unimplemented. Because hostile
transcript-length-driven allocations in clean-upstream deserialization have
not been bounded, the production path-patched TLSNotary source remains in
place.

Local validation after the latest challenge audience and nonce checks:

| Command | Result |
| --- | --- |
| `cargo test --manifest-path packages/authenticity/Cargo.toml --workspace --locked --offline` | PASS: 2 core, 2 clean-upstream adapter, and 3 consumer integration tests |
| `cargo test --manifest-path packages/FUSOU-TLSN-VERIFIER/Cargo.toml --locked --offline` | PASS: 91 verifier unit tests and 3 CLI integration tests |

These are local test results only. They do not constitute external review,
Production validation, or approval. P0-01 remains `BLOCKED_EXTERNAL_INPUTS`,
P0-10 `UNRESOLVED`, Phase 0 runtime gate `BLOCKED`, WASM provenance
`UNRESOLVED`, Hosted CI `NOT_RUN`, real TLSN testplay `NOT_RUN`, and
Production acceptance `BLOCKED`.
