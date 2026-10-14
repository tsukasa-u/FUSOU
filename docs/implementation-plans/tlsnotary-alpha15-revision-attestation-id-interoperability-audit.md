# TLSNotary alpha.15 revision, Attestation ID, and interoperability audit

## Current dispositions

| Item | Status | Evidence and remaining condition |
| --- | --- | --- |
| P0-01 technical revision mapping | `PASS` for the factual source map; `P0-01` remains `BLOCKED_EXTERNAL_INPUTS` | The upstream tag/commit and dependency graph are identified below. The verifier executes local path-patched TLSN sources that diverge from upstream; independent compatibility, security, and license approval is still required. |
| P0-02 Attestation ID contract | `PASS_LOCAL_TESTS` | The exact upstream type/API, 16-byte length, upstream binary fixture, independently extracted ID, and canonical JSON encoding are captured by the shared Rust/Node vector. |
| P0-10 cross-language determinism | `UNRESOLVED` | Only the Attestation ID byte/string boundary is covered here. Rust/Node Result, Session, Claim, transcript range, canonical JSON, and signing-byte corpus is incomplete. |
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
checks the source digest, raw ID, ID length, encoding, and server name. The
Node test independently checks the source file identity, canonical encoding,
and malformed/mismatched ID rejection. The expected ID is a vector for this
specific upstream fixture, not a universal fixed Attestation ID.

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

The new shared static vector exercises Rust extraction against upstream
Presentation bytes and Node validation/binding of the corresponding ID
representation. It is not a live Rust/WASM-to-Node process handoff and does
not demonstrate Node-generated protocol bytes consumed by Rust. It does not
claim that Node can produce or verify TLSNotary Presentations; no Node
Presentation writer is part of this protocol path.

Still missing before P0-10 can pass:

- independent shared vectors for Complete Result v2 and Sparse Result v3,
  including Rust signing bytes and Node consumption;
- Session receipt, consume receipt, and Claim bytes/field binding vectors;
- canonical JSON and binary/range vectors with independently sourced expected
  bytes, including boundary values and rejection cases;
- live Rust/WASM output consumed by Node and Node-produced protocol vectors
  consumed by Rust where those producers actually exist;
- shared corpus coverage for invalid UTF-8, missing/unknown/duplicate fields,
  noncanonical numbers/encoding, malformed ranges, and byte/order mutations.

Existing local tests that call one implementation twice, Runtime Config
vectors, and fake signer/store tests do not satisfy these missing TLSN
protocol vectors.

## Commands and interpretation

```sh
cargo test --manifest-path packages/FUSOU-TLSN-VERIFIER/Cargo.toml --locked
node --test packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-attestation-id-test.mjs
```

These are local source/test checks only. No Hosted CI, Production operation,
R2 service access, Notary service, or real Game Server testplay is evidence
for this audit; none was performed here. P0-03 through P0-09 and P0-11 through
P0-17 are unchanged. P0-01 approval, the remaining P0-10 corpus, real TLSN
testplay, and Production acceptance remain blocked.
