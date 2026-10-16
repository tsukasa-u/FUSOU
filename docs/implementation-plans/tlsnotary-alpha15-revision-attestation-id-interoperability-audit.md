# TLSNotary alpha.15 revision, Attestation ID, and interoperability audit

## Current dispositions

| Item | Status | Evidence and remaining condition |
| --- | --- | --- |
| P0-01 technical revision mapping | `PASS` for the factual source map; `P0-01` remains `BLOCKED_EXTERNAL_INPUTS` | The upstream tag/commit and dependency graph are identified below. The verifier executes local path-patched TLSN sources that diverge from upstream; independent compatibility, security, and license approval is still required. |
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
