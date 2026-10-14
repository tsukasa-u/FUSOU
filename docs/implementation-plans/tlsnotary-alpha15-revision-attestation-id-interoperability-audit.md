# TLSNotary alpha.15 revision, Attestation ID, and interoperability audit

## Current dispositions

| Item | Status | Evidence and remaining condition |
| --- | --- | --- |
| P0-01 technical revision mapping | `PASS` for the factual source map; `P0-01` remains `BLOCKED_EXTERNAL_INPUTS` | The upstream tag/commit and dependency graph are identified below. The verifier executes local path-patched TLSN sources that diverge from upstream; independent compatibility, security, and license approval is still required. |
| P0-02 Attestation ID contract | `PASS_LOCAL_TESTS` | The exact upstream type/API, 16-byte length, upstream binary fixture, independently extracted ID, canonical JSON encoding, and Node invocation of the packaged Rust/WASM verifier are covered locally. |
| P0-10 cross-language determinism | `UNRESOLVED` | The upstream Presentation/Attestation ID boundary now has a direct Node-to-packaged-Rust/WASM test. Result, Session, Claim, receipt, transcript-range, canonical JSON, and signing-byte interoperability corpus remains incomplete. |
| Phase 0 runtime gate | `BLOCKED` | The P0-02 local contract evidence does not approve the locally patched TLSN revision or satisfy the other Phase 0 gates. Production acceptance remains `NO-GO`. |

The earlier `0/17 PASS` assessment described the state before this audit. P0-02 now has local test evidence; it does not change the Production runtime gate, for which no Phase 0 acceptance is claimed.

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

The packaged WASM test has an additional provenance limit. The checked-in
`wasm-provenance.json` names source commit
`95923de519fd6d382b596b92c06cff0cebc90987`, which is not an ancestor of the
audited checkout, and its recorded hashes for verifier source files do not
match the checkout. Its referenced build/provenance scripts are absent from
the current tracked paths. An offline rebuild with Rust 1.95.0 and wasm-pack
0.13.1 produced matching generated JavaScript and declarations but a different
WASM binary size (checked-in: 752,473 bytes; rebuilt: 755,685 bytes). No
generated artifact was replaced. The Node test proves behavior of the
packaged binary for the fixture; it does not prove that binary was reproduced
from current source.

Still missing before P0-10 can pass:

- independent shared vectors for Complete Result v2 and Sparse Result v3,
  including canonical bytes, signing bytes, and Node consumption/verification;
- Session receipt, consume receipt, and Claim bytes/field-binding vectors;
- shared canonical JSON, binary transcript/range, and cross-reference vectors
  with independently sourced expected bytes;
- Node-produced protocol vectors consumed by Rust for any protocol producer
  that actually exists, rather than adding a fictitious Node Presentation
  writer;
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
node --test packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-attestation-id-test.mjs
rustfmt --edition 2021 --check \
  packages/FUSOU-TLSN-VERIFIER/src/sparse_result.rs \
  packages/FUSOU-TLSN-VERIFIER/src/tlsn_alpha15.rs \
  packages/FUSOU-TLSN-VERIFIER/tests/offline_verifier_cli.rs
cargo clippy --manifest-path packages/FUSOU-TLSN-VERIFIER/Cargo.toml \
  --all-targets --locked -- -D warnings
git diff --check
```

The Rust suite completed with 83 unit tests and 3 offline CLI integration
tests passing; the Node test completed with 5 tests passing. Targeted rustfmt
and scoped `git diff --check` passed. Package-wide `cargo fmt -- --check`
reported formatting drift in untouched verifier files (`src/lib.rs` and
`src/wasm.rs`); all files changed for this audit pass targeted rustfmt, and
unrelated formatting was not rewritten. Strict Clippy exited nonzero on
existing lints across verifier code, including pre-existing argument-count,
borrow, default-initialization, and range-helper diagnostics; it did not
report the new CLI integration tests. These are local source/test checks
only. Hosted CI, Production operation, R2 service access, Notary service, and
real Game Server testplay were not performed. P0-03 through P0-09 and P0-11
through P0-17 are unchanged. P0-01 independent approval, the remaining P0-10
corpus, real TLSN testplay, and Production acceptance remain blocked.
