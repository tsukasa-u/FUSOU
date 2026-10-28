# FUSOU TLSN Verifier

This crate is the fail-closed FUSOU `require_info` TLSNotary adapter boundary. It
contains the strict parser and links the frozen TLSNotary alpha.15 verification
backend. Its Prover-owned TLS transport is wired into the APP's feature-gated
`tlsn-production` origin path through
[`wrap_proxy.rs`](../FUSOU-APP/src-tauri/src/wrap_proxy.rs) and
[`real_tlsn.rs`](../FUSOU-PROXY/proxy-https/src/real_tlsn.rs). This is source
wiring only: the embedded Runtime Config URL and signer pins are currently
unregistered, so enabling `proxy.tlsn.enabled` fails closed before the proxy
listener starts. The default-disabled ordinary proxy path is unaffected.

The cross-component guarantees and unresolved acceptance decisions are
documented in the [Data Authenticity Contract](../../docs/architecture/tlsn-data-authenticity-contract.md)
and its [implementation roadmap](../../docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md).

It currently provides:

- strict unpadded base64url and canonical UInt64 decimal parsing;
- non-overlapping transcript range validation and SHA-256 checking;
- strict HTTP/1.1 request/response framing, chunked decoding, and single-member gzip decoding;
- lossless `api_member_id` extraction from the fixed `svdata=` JSON path;
- strict binding-header parsing;
- canonical Verifier Result JSON and `VerifierResultSignBytes` construction;
- a pinned alpha.15 `Presentation` decoder and `Presentation::verify` call;
- strict rejection of malformed and trailing Presentation bytes;
- an `AuthenticatedTranscript` type that can only be created from the verified alpha.15 output;
- strict `require_info` request/response, server-identity, binding, digest, and full-disclosure checks;
- authenticated output to canonical `VerifierResult` construction, with the
	response-derived `verified_member_id` included in the canonical Result and
	its signing bytes; separate FUSOU signing inputs remain explicit.
- a local alpha.15 Proxy-mode transport harness that validates caller-supplied
  serialized request bytes before the Prover-owned TLS write, rejects retries,
  captures the exact synthetic-origin request/response, and builds a test-only
  complete serialized Presentation plus a selectively disclosed serialized
  Presentation whose authenticated gap is rejected by the strict parser;
- an explicitly opt-in `experimental` origin probe that accepts only a
-  Prover-owned alpha.15 `TlsConnection` and an actual serialized request,
  records the exact request/response, and extracts `api_member_id` with the
  strict parser;
- an offline TLS fixture proving that the verifier-owned origin forwarding path
	receives the exact request and response bytes.
- a Prover-owned response transport that completes a strict single
  `Content-Length` response without waiting for keep-alive EOF, and fails closed
  for `Transfer-Encoding`, missing framing, oversized headers/bodies, and
  incomplete bodies;
- a deferred proof boundary: the browser-visible response capture completes
  before TLSN prover/notary finalization runs in the background continuation.

FUSOU-PROXY also contains a default-off request-selection gate controlled by
`proxy.tlsn.enabled`. With the APP built using `tlsn-production`, the APP
validates Runtime Config, the selected Target Approval and Worker health before
starting the proxy, then supplies the production forwarder for the first actual
ordinary-play `POST /kcsapi/api_get_member/require_info` request. The embedded
Runtime Config bootstrap is not registered in this checkout, so this route
cannot currently be started from it. If the gate is reached without a usable
forwarder, the selected request fails closed with `503`; it is not retried or
sent through a fallback. Non-target requests and the default-disabled route
remain unchanged.

The backend is pinned to:

```text
repository: https://github.com/tlsnotary/tlsn.git
tag: refs/tags/v0.1.0-alpha.15
commit: 47aee45b53e06648c1b2ad3689b367b8c923fdec
```

The dependency declarations name that exact revision, but this is not the
complete runtime source identity: Cargo patches `tlsn`, `tlsn-attestation`,
and `tlsn-core` to local paths under `packages/tlsn-alpha15-sparse`. In
particular, the local `tlsn-core` transcript/proof implementation differs
from upstream alpha.15. Independent compatibility, security, and license
approval is still pending; see
[`tlsnotary-alpha15-revision-attestation-id-interoperability-audit.md`](../../docs/implementation-plans/tlsnotary-alpha15-revision-attestation-id-interoperability-audit.md).
The updated source review identifies four production-source changes in the
local TLSN subset (`tlsn-core` transcript/proof and `tlsn` plaintext
authentication/verifier plumbing), plus a test-only Attestation API change.
`Presentation::verify` itself remains the pinned upstream implementation.
APP and Proxy patch `tlsn-mux` to local resource defaults; the Verifier lockfile
uses the pinned upstream mux. The source mapping is now evidenced, but
independent security, wire-contract, license, and release decisions remain
pending. P0-01 remains `BLOCKED_EXTERNAL_INPUTS`; see the dossier for the
complete diff, trust-root path, risk, and approval tables.
The tracked checkout contains the APP transport path, but not a deployed
Production Worker runtime, Session Authority handler, Notary service, or
Production evidence collector. Runtime Config bootstrap inputs are unregistered
and the TLSN Production path therefore remains blocked. Local transport and
verifier tests do not establish the behavior of those external services or
Production acceptance.

`verify_alpha15_presentation` deserializes an upstream bincode Presentation,
rejects trailing bytes, calls `Presentation::verify`, and requires complete
sent/received disclosure for the current `require_info` Result profile. The
adapter itself retains alpha.15's `PartialTranscript` as authenticated packed
bytes plus total lengths; it does not materialize a full-length compatibility
buffer during Presentation verification. `AuthenticatedByteSource` can read
either legacy contiguous data or the verified sparse transcript, and rejects a
read crossing an undisclosed range. The strict parser is connected to this
reader, so sparse input fails closed at the first unauthenticated read. A raw
full-transcript SHA-256 is populated only when every byte is authenticated;
the existing Result schema refuses sparse output rather than encoding a fake
digest. It does not fabricate FUSOU evidence or signatures.

The synthetic proxy test verifies the selectively disclosed serialized
Presentation with its test root certificate and trusted Notary key. It checks
that alpha.15 verification succeeds, full transcript digests remain absent,
and the strict parser rejects the first read that crosses the undisclosed
range. This is a generated integration fixture, not production evidence.

## Selective disclosure status

The local alpha.15 fork is based on upstream commit
`47aee45b53e06648c1b2ad3689b367b8c923fdec`, with FUSOU-local changes.
`ProveConfig::reveal_sent` and
`reveal_recv` now produce a packed sparse `PartialTranscript`; proof
verification reads only the requested authenticated ranges. The live verifier
also assigns disclosed ranges directly and keeps undisclosed committed ranges
blind. `materialize_sent` and `materialize_received` remain explicit
compatibility operations and are outside the cryptographic verification path.

FUSOU's range reader and strict parser are connected to the verified sparse
output. The current `require_info` Result profile still requires the complete
HTTP request and response because hidden HTTP/JSON bytes could contain
framing, duplicate keys, escapes, or structural tokens, and the Result schema
commits to a raw full-transcript SHA-256. A sparse presentation may therefore
be inspected safely, but it is rejected for this profile unless the parser's
requested bytes are fully authenticated and a raw digest can be independently
computed. Sparse omitted bytes are never represented as authenticated zeros.

### Packed sparse Presentation audit

The alpha.15 `PartialTranscript` wire form is bincode 1.3.3's serialized
`CompressedPartialTranscript`: packed sent/received bytes, half-open range
indices, and original direction lengths. This is distinct from the FUSOU
Result's big-endian range signing bytes. The verifier delegates cryptographic
opening checks to TLSN `Presentation::verify`, then maps only authenticated
bytes into FUSOU ranges and parser reads.

A generated synthetic sparse Presentation is verified end-to-end by the
feature-gated Proxy test
`synthetic_transport_uses_alpha15_and_preserves_wire_bytes`; it uses test
Notary/root material and is not Production evidence. The existing upstream
binary fixture is full disclosure.

A second test-only fixture,
`fixtures/tlsn-alpha15-clean-upstream-sparse-presentation.bin`, was generated
and verified by a clean checkout pinned to TLSNotary alpha.15 commit
`47aee45b53e06648c1b2ad3689b367b8c923fdec`. The generator and a matching
packed-transcript sidecar and serialized test Notary key are under
`fixtures/alpha15-clean-upstream-sparse-generator/` and `fixtures/`. The Rust
test `clean_upstream_sparse_fixture_verifies_with_patched_backend` verifies
the proof with the patched backend, checks the exact `[start, end)` ranges and
their disclosed bytes, compares the patched `PartialTranscript` bincode bytes
with the clean-upstream sidecar, and confirms that changing the final opening
byte is rejected. The sample is 5,510 bytes (SHA-256
`936c9fdf1c73f422c33ccf3899bf75986badc340c5e0ab7f611661e979d6fde4`); its
132-byte packed-transcript sidecar has SHA-256
`a83c06f9df388a8d5047e25eed9e2f67d54415e6c3cf6b1416b9def42552608e`.

This is a category-3 clean-checkout/cross-revision characterization from the
same TLSNotary codebase and serializer family, not an independent
implementation, external normative golden, FUSOU `require_info` Presentation,
or Production evidence. The generator randomizes the Attestation UID and
certificate-opening blinder, so rerunning it does not reproduce the exact
Presentation bytes. The checked-in vector records the source, inputs, hashes,
and ranges. The generator writes a Presentation and its `.packed-transcript`
and `.notary-verifying-key` sidecars to the caller-supplied path, refuses to
overwrite any existing output, then deserializes and verifies the serialized
Presentation with clean upstream before writing the files. It does not rewrite
the JSON vector: that vector describes the fixed checked-in sample, while
randomized Presentation fields make a regenerated whole-Presentation hash
different. The Rust characterization test checks the recorded hashes of the
generator source, manifest, lockfile, Presentation, packed sidecar, and public
verifying-key fixture, plus the fixture lengths, ranges, and opened bytes.
Use a fresh output path for each generator run.

Node's shared P0-10 corpus tests FUSOU Result range framing, not TLSN bincode;
Node-to-WASM remains an integration test, not an independent JavaScript
verifier. Therefore a normative sparse Presentation contract, independent
golden, and cross-language proof-opening interoperability remain
`UNRESOLVED`; see the
[`audit dossier`](../../docs/implementation-plans/tlsnotary-alpha15-revision-attestation-id-interoperability-audit.md).

To regenerate a sample from the pinned clean upstream source (the Presentation
hash will vary because of upstream randomness), run from the repository root:

```text
cargo run --locked --offline --manifest-path packages/FUSOU-TLSN-VERIFIER/fixtures/alpha15-clean-upstream-sparse-generator/Cargo.toml -- /tmp/fusou-alpha15-clean-upstream-sparse.presentation
cargo test --locked --offline --manifest-path packages/FUSOU-TLSN-VERIFIER/Cargo.toml clean_upstream_sparse_fixture_verifies_with_patched_backend
```

The memory probe makes the unavoidable alpha.15 allocation visible without
contacting any external service:

```text
for size in 1048576 4194304 8388608 16777216 33554432; do
  cargo +1.95.0 run --offline --manifest-path packages/FUSOU-TLSN-VERIFIER/Cargo.toml --example alpha15_partial_memory -- "$size"
done
```

The probe creates 1/4/8/16/32 MiB total lengths per direction while disclosing
only two bytes per direction. The measured `VmSize` and `VmData` deltas were
zero for all five sizes in the sparse representation. This measures storage
behavior, not a complete large Presentation verification fixture; the checked
in alpha.15 fixture remains small.

The checked-in
`fixtures/tlsn-alpha15-upstream-presentation.bin` is a legitimate upstream
alpha.15 fixture (`5394` bytes, SHA-256
`cb9b3befb43df5157a4d5ac52080ba19d842f191fa346bfda1dfc4927b37e5b6`). Its
verification is classified as `REAL_ALPHA15_VERIFICATION`, not
`REAL_FUSOU_AUTHENTICATED_EVIDENCE`: it is not a FUSOU `require_info`
request/response and cannot unblock P0-05.

The fixture's Attestation ID contract is recorded in
`fixtures/tlsn-alpha15-attestation-id-vector.json`: upstream `Uid` is exactly
16 raw bytes, extracted from the verified Presentation's
`attestation.header.id.0`, with no hash or byte-order conversion. Result JSON
uses canonical unpadded base64url. The Node fixture test invokes the packaged
Rust/WASM verifier with the exact Presentation bytes and vector Notary key,
then checks its server identity and Attestation ID output; it also rejects
mutated Presentation bytes and a mutated trusted key. The expected fixture ID
was separately extracted with the official pinned alpha.15 source outside the
FUSOU Cargo patches and matched the vector; see the audit dossier.

This is direct Node-to-packaged-Rust/WASM fixture coverage, not an independent
JavaScript implementation of TLSNotary verification. At the checkpoint below,
Complete Result v2 / Sparse Result v3 signing bytes, Session and consume
receipts, Claim binding, and transcript-range cross-language determinism were
unresolved; the later shared-corpus continuation adds local Result/receipt
reference tests but does not resolve Claim, packed Presentation bytes, or
protocol-owner approval. The local, Git-ignored WASM provenance names a source
commit and input hashes that do not match the audited checkout; the packaged
binary test does not establish that the binary is reproducible from current
source. No generated WASM artifact was replaced during this audit.

### P0-10 cross-language audit checkpoint

This audit started on `tlsn-first-testplay-candidate` at
`ef8bb412bd591cef84a1159e0f5edc2efe9c305b`; the local upstream ref matched
that HEAD. The only pre-existing worktree change was the user-owned
`packages/FUSOU-APP/src-tauri/roaming/user/configs.toml`. Its contents were not
read, and it was not modified, staged, or committed.

Rust now consumes the Node-produced, `test_only` outer Result registry
envelope from `tlsn-runtime-config-independent-v2-vector.json`, verifies it
against the test-vector-supplied root pins, and rejects a mutated signature
byte. The Node Runtime Config manifest test exercises the same envelope. This
is outer-envelope interoperability only: the Rust test does not independently
authenticate the Runtime Config envelope supplying its pins, and this vector
does not cover Complete Result v2/Sparse Result v3 signing bytes or their
inner signatures. The Node `production-evidence-contract.mjs` remains a
semantic binding checker; deployment metadata mentioning `signResult` is not
an executable Result signer.

The audit record lists the exact Result v2/v3 domains and byte framing,
WASM/Rust/Node responsibilities, receipt domains, packed-range encoding, and
the unresolved conflicting Claim layouts in
[`tlsnotary-alpha15-revision-attestation-id-interoperability-audit.md`](../../docs/implementation-plans/tlsnotary-alpha15-revision-attestation-id-interoperability-audit.md).
It also records the prior current-source offline `--no-opt` rebuild: generated
JS and declarations matched the then-present local generated files
byte-for-byte, but the 912,726-byte unoptimized WASM differed from the
752,473-byte local optimized artifact recorded at that time. `wasm-opt` was
unavailable for that rebuild, and the provenance-declared source commit/input
hashes still do not map to this checkout. Artifact provenance therefore
remains unresolved.

At this earlier checkpoint, before the shared-corpus continuation below,
local checks were: Rust verifier suite **84 unit + 3 CLI integration tests
passed**; Node Runtime Config manifest suite **21 passed**; Node/WASM
Attestation ID suite **5 passed**. At that point Complete/Sparse Result,
Session/consume receipts, Claim, canonical JSON, and packed transcript ranges
did not yet have the shared corpus described below. This historical status
does not describe the later continuation: P0-10 remains `UNRESOLVED`, and
Hosted CI, Production runtime verification, and real Game Server testplay
were not run.

### P0-10 shared corpus continuation

The follow-up started from `96545076bc4e53083e4536a4159b3d2cb8dce0c3` on
`tlsn-first-testplay-candidate`, with upstream equal to HEAD. It adds
[`p010-cross-language-corpus-v1.json`](./fixtures/p010-cross-language-corpus-v1.json)
and [`generate_p010_corpus.py`](./tools/generate_p010_corpus.py), a test-only
reference corpus for Complete Result v2, Sparse Result v3, Session receipt,
and consume receipt. The four positive vectors fix exact canonical JSON,
signing bytes, Result range-wire bytes, hashes, signatures, public keys,
test-only registry bytes, and Result/Session/consume cross-references. The
corpus also contains 34 Result rejection vectors and five receipt binding or
signature mutation cases.

The generator uses Python 3.12.3 standard-library encoding and OpenSSL 3.5.6
for Ed25519 signatures. Rust tests consume the fixture through the production
Result parser, canonical serializer, inner signature verifier, and receipt
verifiers. The separate Node test uses built-in crypto and a test-only
reference encoder; it does not call Rust/WASM or Worker serialization code.
The corpus's Result key is the public RFC 8032 test key and its receipt keys
are deterministic test-only keys. These direct pins are not Production trust
roots. The byte layouts were independently encoded from the audited source
contract, but no protocol owner approved that contract and no independently
published FUSOU Result/receipt vectors were found.

Local verification from the repository root: Rust verifier suite **90 unit
tests + 3 offline CLI integration tests passed**; the new Node corpus suite
**8 passed**; Runtime Config manifest tests **21 passed**; Node/WASM
Attestation ID tests **5 passed**; corpus regeneration `--check`,
`rustfmt --check`, and `git diff --check` passed. Hosted CI was not run. The
Node/WASM Attestation ID test is a separate integration path and does not
establish the provenance of the local ignored WASM. Its binary SHA-256 remains
`57ea4e30f684f15c6f22fc26eb0995b9d8b961ba7de6edd82faaaf21dd62ab66`
(752,473 bytes), matching the prior audit record; Git tracks neither that
binary nor its provenance JSON. No WASM artifact was changed.

P0-10 remains `UNRESOLVED`. The subsequent Claim/receipt authority audit found
no approved precedence or migration between the documented 8-field and
11-field ClaimBindingBytes candidates. It also found no approved receipt JSON
canonicalization or duplicate/unknown-field policy: the Proxy's typed
Session-receipt parser and the Evidence Bundle's `serde_json::Value` parser
have different duplicate-key behavior, and neither behavior is elevated to
protocol policy. Shared corpus v1 receipt signatures remain
source-derived local comparison values, not normative receipt vectors. The
full evidence classification and candidate layouts are recorded in
[`tlsnotary-alpha15-revision-attestation-id-interoperability-audit.md`](../../docs/implementation-plans/tlsnotary-alpha15-revision-attestation-id-interoperability-audit.md).

The corpus covers Result range framing, not the FUSOU-local packed TLSN
sparse Presentation format; WASM provenance also remains unresolved. There
is no independently sourced positive FUSOU `require_info` Presentation or
Production-shaped Evidence Bundle in the corpus. The existing synthetic
in-memory flow is not Production acceptance evidence. P0-01 remains
`BLOCKED_EXTERNAL_INPUTS`; Phase 0 runtime gate remains `BLOCKED`. Hosted CI,
real testplay, Production runtime verification, and Production acceptance
were not run or promoted. This documentation-only audit did not rerun the
previously reported local corpus tests.

### First real-game testplay boundary

This checkout provides the offline TLSN and Evidence Bundle verifiers, not a
tracked Production Worker runtime, Session Authority service handler,
Result/archive implementation, or Production evidence collector. The APP's
Result verification and the offline verifier therefore do not prove that an
external service generated a Result or retained the corresponding archives.
The external deployment state is UNKNOWN until its source/version and execution
evidence are independently supplied.

The first real-game testplay is also blocked before capture by the unset,
fail-closed APP Runtime Config bootstrap and the runtime requirement that the
selected target already be in verified Target Approval. The source-level gate
map and its external-input requirements are in the
[operator runbook](../FUSOU-TLSN-VERIFICATION-WORKER/docs/production-evidence-operator-runbook.md).
P0-10 remains `UNRESOLVED`; the candidate pre-capture helper does not test it,
and no approved testplay exception was found. A local verifier pass or
category-3 fixture characterization is not a successful real testplay or
Production acceptance.

### alpha.15 sparse-workspace test restoration

The missing TLS server fixture manifest came from a partial source import.
Three test-only fixture packages (42 files) were restored from pinned upstream
revision `47aee45b53e06648c1b2ad3689b367b8c923fdec` after verifying their Git
blob IDs. The 14-member sparse workspace now has a tracked subset lockfile.
Focused `tlsn-core test_partial_transcript` tests passed (10/10), as did
`tlsn-attestation --test no_syscall_verify` (1/1) with the upstream CI
compile-time setting, using `--locked --offline`:

```text
RUSTFLAGS='--cfg getrandom_backend="unsupported"' cargo test --locked --offline --manifest-path packages/tlsn-alpha15-sparse/Cargo.toml -p tlsn-attestation --test no_syscall_verify
```

The upstream alpha.15 CI workflow pins Rust 1.95.0; the local rerun used
rustc/cargo 1.98.1. The lockfile's host test dependency closure includes
`getrandom 0.3.4` and `0.2.17`; only 0.3.4 honors this backend selection.
The test verifies one full-disclosure fixture and asserts a verified server
name and transcript are present. Its pass is evidence that this path succeeds
with the 0.3.4 backend disabled, not proof that every dependency avoids
syscalls; it does not trace syscalls or establish system-wide syscall absence.
Full offline `cargo metadata` remains blocked by uncached `wasip2`; the focused
host-target tests do not require it. This repairs the local test source closure
only: it does not establish a sparse golden vector, a normative wire contract,
or Production acceptance. See the
[`alpha.15 audit dossier`](../../docs/implementation-plans/tlsnotary-alpha15-revision-attestation-id-interoperability-audit.md)
for the source comparison, exact commands, and remaining state.

The production server-identity allowlist registry is also not linked. Its
constructor therefore rejects every identity until that trusted registry is
provided. Only test-only mock plumbing can create a profile for local parser
tests.

It does not provide the production server-identity allowlist, Session/Challenge
authority, FUSOU Ed25519 signing keys, Notary trust boundary, Web PKI policy,
FUSOU-App integration, or privacy/persistence review. The local transport test
proves the alpha.15 runtime and verifier flow over an in-memory synthetic
origin: exact origin request and response bytes, complete Prover/Verifier
transcript disclosure, local serialized Presentation verification with a
test-only trust root, response-derived `api_member_id`, and unsigned canonical
Result construction. This is experimental partial evidence only. It is not a
real Game Server, real Notary, production Dedicated Verifier, production
signer, or privacy/runtime evidence. The implementation therefore does not
change the P0-05 gate: P0-05 remains `BLOCKED` until an authenticated alpha.15
FUSOU Presentation and its evidence fixtures exist.

The `verify_tlsn_require_info` binary is an independent offline TLSN verifier
for a serialized alpha.15 Presentation. It requires the Presentation bytes,
trusted serialized Notary key, server identity, profile and session identity
inputs, and optionally a DER origin trust root. It verifies alpha.15
cryptography, complete disclosure, the fixed `require_info` HTTP profile, the
binding value, and the response-derived member ID, then emits the canonical
unsigned Result shape and its Result signing bytes. It does not verify the
FUSOU Result signature or the Evidence Root registry envelope; those are
verified by the separate production evidence verifier so the two trust
boundaries remain explicit.

The `verify_fusou_tlsn_evidence` binary is the independent post-hoc verifier
for a captured Evidence Bundle. `--bundle` accepts either the manifest path or
a directory containing `tlsn-production-evidence.json`. It reads only the
artifact paths declared by that manifest and emits one machine-readable JSON
object. A successful report contains `status: "VERIFIED"` and explicit trust
edges for the Evidence Root, Result registry, Result signature, Result-to-TLSN
binding, TLSN Presentation, Notary, and artifact manifest.

The bundle is not a trust anchor. The verifier requires these external inputs:

- `--evidence-root-key-id` and `--evidence-root-public-key-spki`: the
  independently pinned Root identity;
- `--trusted-notary-registry`: the known alpha.15 Notary registry file, which
  must match the bundle byte-for-byte;
- `--session-authority-registry`, `--session-authority-key-id`, and
  `--session-authority-public-key-spki`, plus the equivalent three
  `--binding-authority-*` options: independently pinned receipt authorities;
- `--canonical-user-id`, `--device-id`, and `--device-public-key`: the
  independently supplied authenticated subject/device identity;
- `--server-identity`, `--profile-sha256`, and `--verifier-key-id`: the static
  FUSOU profile configuration;
- `--origin-inventory` and `--target-approval`: the current canonical
  Production artifacts, checked byte-for-byte against the signed Result
  digests and checked for the observed server identity's membership in both
  trust sets. Both are required for this Production evidence verifier;
- `--trust-anchor-der`: the externally supplied origin trust root, which must
  match the captured `trust_root` artifact byte-for-byte.

These trust stores are separate by design in the current implementation:
Production origin capture uses platform-native roots, alpha.15
`CryptoProvider::default()` uses Mozilla roots, and offline Presentation
verification replaces that default with only the externally supplied DER
anchor. APP/Proxy `reqwest 0.12.28` clients use both native and WebPKI roots in
the resolved feature graph for HTTPS control-plane requests. No common-root
equivalence is implied or independently approved.

The verifier authenticates the exact raw Result registry bytes with the
Evidence Root-signed registry envelope, derives the Result signer by testing
the signed Result bytes against registry entries, and rejects ambiguous,
revoked, expired, and future keys. `ACTIVE`, `VERIFY_ONLY`, and `RETIRED` keys
are accepted when their validity window contains the manifest's
`capture_finished_at`; `REVOKED` keys are always rejected. This uses capture
time rather than the verifier's current clock, so historical evidence remains
verifiable after a rotation.

The Result schema currently does not carry a separate `signer_key_id` field.
The Rust verifier therefore derives the signer ID cryptographically from the
authenticated registry and requires it to match the manifest and health
identities. The signed Result remains compatible with the existing APP-side
signature verification; APP verification is runtime tamper detection, not the
final independent evidence proof.

### Native executable identity and distribution boundary

The CLI's evidence-verification contract does not authenticate the executable
that a caller launches. A package version, a claimed build record, a matching
digest supplied by that same record, or valid-looking JSON stdout is not
authenticated native build provenance.

The release path still blocks on
`FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED`. Its existing byte/argument/
report validators and process-local mock execution capabilities are not a
registered native builder, distributor or launcher. The documented invocation
below is a local usage example, not an approved locked build recipe, target
triple, toolchain identity, authenticated binary artifact or distribution pin.

Before native acceptance, independently approved expectations must bind the
executable's exact raw bytes/digest to source repository/SHA, complete build
inputs and lock bytes, compiler/toolchain, target, recipe/flags, trusted builder
workflow/revision, run/attempt and authenticated artifact acquisition.
Execution capture must additionally bind the actual launched executable,
arguments, input bytes, exit status and raw output to the expected evidence
context. Format validation, producer authentication and native cryptographic
verification remain separate results.

The [native provenance stopping boundary](../../docs/architecture/adr-tlsn-grant-authority-delegation.md#2026-10-28-native-executable-provenance-stopping-boundary)
and [dated audit/validation record](../../docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md)
record the missing contracts. No new key, attestation trust root, `--version`
option or native success path is implied.

The [source-only native candidate](../../scripts/release-native-build.mjs)
now identifies this standalone workspace and explicit binary target, tracks the
existing Cargo-generated lock bytes, and defines a `--locked` recipe,
raw-byte metadata, independent-expectation checks and a fail-closed preflight.
Rust `1.98.1`, `x86_64-unknown-linux-gnu`, release/default features, empty extra
Rust flags and the output directory are **UNAPPROVED candidate** choices.
Tracking the lock does not prove manifest consistency: Cargo resolution and
`cargo build --locked` were not run. The four-file source-shape check is not a
complete dependency/source closure.

The [builder candidate](../../.github/workflows/tlsn-native-build.yml) keeps all
three jobs fixed-disabled. Only the attestation job declares OIDC/attestation
write permissions; other jobs inherit read-only contents access. Its
[draft policy](../../scripts/release-native-policy.draft.json) does not register
repository IDs, an approved signer revision or a provenance verifier.
The fixed `actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6` source
now supplies a standard SLSA candidate step, with binary and metadata as
separate subjects and no custom predicate inputs. `create-storage-record`
is false, so no artifact-metadata write permission is requested. The source
captures future `rustc -Vv`/Cargo output in the existing opaque
`compiler_identity` string as canonical JSON, hashes actual output bytes,
packages metadata and transfers the exact same-run artifact ID to a separate
signing job. That job reads data only, not producer executables/scripts.
The input/recipe guard still refuses before any tool installation/build.
The metadata's workflow revision is an unverified policy expectation until
independently matched to the actual attestation certificate, not an observed
signer identity inferred from a caller or checkout.

The [official-schema gh adapter](../../scripts/release-native-attestation.mjs)
constructs argv with independent repository/signer/source pins, hashes the
consumer-selected gh executable and artifact before/after mock capture, and
requires stable gh 2.x >= 2.102.0. The built-in real-process path is disabled
on every OS: without an injected mock runner it refuses before reading the
executable or artifacts. Matching before/after hashes do not prove execution
identity. It accepts a matching optional release URL
in version output and compares source refs case-sensitively. It parses stdout
only, reuses the existing duplicate-key guard, checks the Sigstore media type,
subject SHA-256, predicate type, mandatory certificate identity/IDs/digests and
timestamp authority/window. This candidate conservatively rejects empty or
multiple results rather than choosing an ambiguous entry. Producer-controlled
predicate metadata is never an identity root.

The independent consumer exports `inspectNativeConsumerProvenance` for both
binary and metadata comparisons. There is still no registered native artifact
acquisition proof, authorized gh provider or formal native launcher. Pure
parser results and mock captures
remain `authenticated: false`; they cannot create an offline execution proof.
The synthetic fixtures are not real gh output or signed attestations.
Actual gh verification, build, attestation issuance and native execution were
not run. No Production acceptance state is advanced.

#### Mock inspection consistency and admission

The consumer copies candidate bytes and independent expectations before its
first asynchronous read. Nested inspections use owned policy/verifier settings
and captured mock callbacks, not caller objects that can be changed and restored
between reads. Each returned subject digest must match the consumer's original
binary or metadata digest. Final caller snapshots and file reads must still
match; restoring a file cannot make an inspection of different bytes consistent.
These checks do not prove what a real OS process launched.

The candidate environment is a new allowlist with an explicit `github.com` host,
HOME/XDG/config root and credential source `NONE`. `EMPTY_ISOLATED` is only a
mock contract label, not evidence that a real directory is isolated. Parent
tokens, debug, proxy and PATH values are not copied. No credential provider is
registered. Settings cannot be made operational by caller approval labels.

Native inspection requires independent positive byte budgets for the verifier,
binary and metadata; metadata is also bounded by the existing 1 MiB release
record ceiling. Fixture budgets are not approved release limits. The bounded
reader checks type/size before allocation, reads through the same handle,
probes for growth and checks final metadata. This is not a process-RSS limit,
an atomic immutable snapshot, authenticated acquisition or execution identity.
Legacy readers in source preflight and the fixed-disabled builder are outside
this consumer boundary; they must not be inherited by a formal provider.

All mock native entry points (including the standalone parser and normalized
candidate inspector) additionally require an explicit process-local
`resourceBudget` from `createNativeInspectionBudget`. There is no default.
This frozen controller is labelled `approval: UNAPPROVED`; it is implementation
admission, not registered policy, execution authority or a credential.
Consumer binary/metadata inspections share one operation and budget.
`UNAPPROVED` deliberately does not prohibit mock inspection: it is not formal
admission. Only the private controller identity admits those local operations;
copying its fields, changing `approval` or replacing the request's controller
cannot change an admitted operation. There is no approved-controller factory or
registration API. Without a mock runner, refusal precedes file access even if
the caller supplies an `APPROVED` label. A formal provider must reject these
mock controllers and obtain policy plus shared limits from its independent
registration root; it must not promote the existing factory.

| Required limit | Candidate enforcement |
|---|---|
| `max_bytes` | Cumulative managed byte-work per operation: candidate input/owned buffers, file buffers and growth probes, mock read/capture input and owned output, conservative JSON serialization/copy work and UTF-16 decoding work. Reservations precede managed copies/allocation; accounting is conservative and not credited back. The metadata structural preflight and existing canonical-record parser both decode; both decodes are charged. |
| `max_reads`, `max_captures` | Total read/capture attempts, including nested and final checks; no retry or queue. A successful two-subject consumer currently requires twelve reads and four captures. |
| `max_json_bytes`, `max_json_nodes`, `max_json_depth`, `max_string_length` | Iterative guards before cloning, JSON parsing and recursive canonical/duplicate-key checks. Keys count as nodes. Object size is conservatively estimated; raw text uses its actual byte length. String bounds count UTF-16 units for configuration values/keys and raw JSON string tokens (including escapes), so escaped tokens may be rejected more conservatively. Only bounded JSON configuration trees are accepted; accessors, cycles, sparse arrays, Map/Set and typed/shared-memory containers are rejected. Raw binary/capture buffers use the separate byte path. |
| `max_concurrent_operations` | Active operations sharing this controller; excess admission is rejected immediately. Multiplication by `max_bytes` must remain a safe integer. |
| `timeout_ms` | Monotonic cooperative deadline plus asynchronous cancellation. An optional caller `AbortSignal` is propagated without exposing its reason. Timeout/cancellation returns a fixed blocker; outstanding non-cooperative work retains its slot until settlement. |

JSON bytes remain subject to the existing 1 MiB record ceiling. Depth 64 is an
implementation ceiling protecting existing recursive helpers, not an approved
release policy or a default. Timer values must fit Node's timer range. Every
limit must otherwise be an explicitly supplied positive safe integer. Fixture
values have no release approval; production values and their registration are
still BLOCKED.

Operation disposal is private to the admission owner, not a scope method.
The owner's returned Promise is included in outstanding work even when it does
not use `scope.wait`; the synchronous API rejects and retains asynchronous
results. A body cannot return success while managed child work remains.
Completion accounting is per operation and idempotent through Promise
settlement; late completion cannot release a newer operation. Failed byte
reservations do not debit bytes, while failed read/capture attempts still count
as work. Charges are cumulative, not a refundable allocation pool.
Monotonic clock/timer functions are captured on module initialization.
Abort subscriptions resist `stopImmediatePropagation` and are disposed on
settlement/owner cleanup. This protects runtime reference changes after import,
not a compromised JavaScript runtime or arbitrary code loaded before bootstrap.
The abort-subscription contract uses Node's documented
[`events.addAbortListener`](https://nodejs.org/docs/latest-v22.x/api/events.html#eventsaddabortlistenersignal-listener)
and disposable cleanup (validated here on Node 22.21.1), not ordinary abort
listeners whose propagation another listener can stop.

Captured stdout/stderr are copied before later asynchronous work. File data
needed only for hashes is not retained across subsequent reads; candidate owned
byte snapshots are released once their validated digests are established.
Normalized mock-verifier exceptions, like process-runner exceptions, become
fixed nonsecret failure codes; their original messages/stacks are not reports.
These measures reduce simultaneous references but do not certify a peak RSS.
JSON object/engine overhead, garbage collection and caller-retained results are
not measured by byte-work accounting. Nor can an in-process mock callback be
prevented from allocating arbitrary memory or blocking the event loop: deadline
checks do not preempt synchronous JavaScript or `JSON.parse`. Distinct controllers
do not impose a process-global limit. Formal admission must use an independently
registered shared controller and provider-enforced OS/process limits and cleanup;
a permanently unresponsive callback intentionally leaves its controller slot
unavailable. No provider is enabled by these guards.

The audited consumer acquisition paths are verifier executable, binary and
metadata via `prepareNativeGhInspection` and the bounded reader. Policy/verifier/
manifest expectations are in-memory JSON snapshots, not fallback file reads.
Attestation input is bounded captured stdout; there is no bundle-file fallback.
`readNativeBuildPreflight` still uses the legacy reader for its fixed source,
lock, workflow and draft-policy inputs; the fixed-disabled builder also remains
outside this admission scope. These source/build paths and other unreviewed
repository readers are not certified by the consumer audit. A future provider
must admit every additional policy, manifest or attestation file explicitly.

#### Native execution provider migration contract (draft, not registered)

This contract is a design prerequisite, not an implemented provider or an
approved trust input. `NATIVE_GH_EXECUTION_IDENTITY_UNSUPPORTED` and
`FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED` remain blocking.

The common interface must own an opaque execution lease, not merely a pathname:
`prepare -> seal -> compare independent pins -> launch -> capture -> dispose`.
The lease must keep the approved executable image and input snapshots bound to
one invocation through exit and output capture. A fresh path lookup or a
post-execution hash cannot substitute for that binding. Unsupported platforms,
missing guarantees or failed isolation must refuse without a path-based fallback.

| Contract surface | Required evidence before registration |
|---|---|
| Provider bootstrap | Independently approved consumer deployment/package digest, complete implementation/runtime closure, ABI version and platform backend. The consumer's authorized installation/admission process must verify this identity independently of the unregistered gh being launched; self-reported digests, JSON approval labels and arbitrary callbacks are not registration. |
| Registration handle | A process-local capability tied to that admitted implementation and policy pin. Serialized producer reports or copied capability fields cannot mint it. Cross-run origin authentication remains a separate intake contract. |
| Request | Expected executable digest/length, approved provenance/source/build context, exact argv, role/path/input-byte manifest, evidence context and unique invocation identity. Paths identify acquisition locations, not execution authority. |
| Admission | Independently approved per-role and aggregate resource budgets; regular-file checks, owned inputs and an immutable-image or OS-binding guarantee covering the entire lease. No limits are learned from producer metadata. |
| Environment | Provider-created and checked private config/HOME/XDG/cwd, explicit host/network policy, allowlisted environment and an independently registered credential capability if required. Neither existing directory paths nor `NONE` prove authentication. Credentials and raw diagnostic exceptions must not enter reports. |
| Capture | Actual image/lease identity, executable and input digests/lengths, argv and nonsecret environment manifest, evidence context, invocation/exit/signal/timeout/output-limit status, owned stdout and privately retained stderr with report-safe digests. A report JSON boolean is not a capture proof. |
| Result | Distinct executable-identity, signature-verification, signer/build-authorization, producer-report-authentication and consumer-native-reexecution claims. Only the matching registered operation may issue its local proof; publication and deployment are separate gates. |
| Lifetime/failure | Retain executable/input binding until the child and capture are complete; dispose every resource on failure. Reject replay, missing measurements, output truncation and changed context. Do not retry through the legacy reader or another process backend. |

Backend choices are deliberately not interchangeable:

| Candidate | Assumptions and outstanding validation |
|---|---|
| Controlled immutable installation, any OS | The trusted consumer deployment must control file ownership/ACLs, every parent directory, update/replacement rules and loader/runtime dependencies for the lease lifetime. A read-only mode bit alone is insufficient. Root/kernel or trusted-deployment compromise is outside this proposed boundary; this does not add APP process/image authority. |
| Linux descriptor/sealed-image backend | OS primitives documented below support a concrete first implementation candidate: seal owned image bytes, compare independent pins, then `execveat` the same descriptor. Kernel/security-policy prerequisites, interpreter/loader closure, input layout and failure handling still require authorized integration tests. No Linux backend is implemented or registered. |
| macOS backend | No admitted handle/image-binding backend. Official API guarantees, supported versions and deployment isolation are NOT_CHECKED; do not infer Linux-equivalent semantics. |
| Windows backend | No admitted handle/image-binding backend. File sharing, replacement/reparse-point handling, image creation and supported API guarantees are NOT_CHECKED; a caller-supplied OS name is not admission. |

A small unprivileged Linux-first provider is the implementation candidate, not an
approved solution. The documentation review below establishes primitive
semantics, not their availability or correct composition on a deployment host.
No backend was executed by mock tests. Deployment ownership, complete runtime
closure and independent registration remain prerequisites. No TPM, privileged
helper, APP process attestation or browser integrity requirement is introduced.

##### Linux implementation feasibility (documentation checked 2026-10-29)

Threat model: acquisition paths, producer metadata, mock callbacks and request
approval labels are untrusted. They may change files before or during acquisition.
The independent consumer installation/admission authority must already trust the
provider package, native ABI, complete runtime closure and pinned policy through
a separately approved deployment root. That root and its provisioning are
NOT_IMPLEMENTED here. Kernel/administrator compromise, ptrace/process-memory
injection and hostile JavaScript in the provider's own process are not defeated
by file seals; isolating the admitted provider from those actors is a deployment
precondition, not APP process/image attestation.

| Stage | Concrete candidate mechanism and refusal conditions |
|---|---|
| Bootstrap/registration | Verify an independently installed provider closure against the consumer deployment root, then issue a nonserializable registration capability bound to provider digest/ABI/platform, policy digest, independent gh/verifier pins, approved role/aggregate limits and environment/network policy. The provider cannot verify its own bootstrap merely by echoing a digest, and the gh being admitted cannot authenticate that bootstrap. No caller-created resource controller or serialized report can mint this capability. Missing root/approval means no launch. |
| Prepare | Reserve approved work before acquisition/copies. Create private executable and input memfds; bounded-copy bytes from the acquired handles. Never expose writable mappings/fds to the producer. Create owned argv/env and bounded pipes, noninteractive stdin, private config/HOME/XDG/cwd, and an invocation-local input inventory. Path regularity and a matching pre/post stat alone do not authenticate acquisition. |
| Seal | For an executable use `memfd_create` with explicit `MFD_EXEC`, `MFD_ALLOW_SEALING` and close-on-exec policy. Before admission, add and read back `F_SEAL_WRITE`, `F_SEAL_GROW`, `F_SEAL_SHRINK`, `F_SEAL_EXEC`, then `F_SEAL_SEAL`. Writable shared mappings must be gone; `EBUSY`, unsupported flags/seals or security-policy rejection fail closed. Input-only memfds use `MFD_NOEXEC_SEAL` plus content/size seals. `F_SEAL_FUTURE_WRITE` alone is insufficient because old writable mappings can still modify contents. |
| Independent pin comparison | Hash and length-check the sealed descriptor bytes, not the original path, against the independently registered role pins; compare policy/provider/invocation context. Verify final seals. Seals give immutability, not provenance or permission to trust/execute those bytes. Reject scripts and, for the first candidate, dynamic ELF (`PT_INTERP`) or any unadmitted loader/runtime dependency. Actual gh/verifier distribution suitability for this restriction is UNVERIFIED. |
| Launch | Invoke `execveat(image_fd, "", argv, envp, AT_EMPTY_PATH)` on that same sealed image descriptor, not a `/proc` executable pathname or `execFile`. Direct descriptor selection binds the top-level executable; it does not bind ELF interpreters/shared objects. `execveat` returns only on error; child startup/error-pipe handling, signals and permitted inherited fds need a native implementation. Reject unsupported kernel/ABI/LSM/container policy; never fall back to path launch. |
| Verifier inputs | Seal every artifact, metadata, evidence/registry/policy file used by the child and bind their role/digest/length and layout to the lease. A child-opened `/proc/self/fd/N` input is only a candidate: explicit inherited descriptors, proc availability and pinned gh/verifier path/directory behavior need source review and integration tests. The official gh command documents a file-path operand, not an execution-by-handle or fd-input guarantee. Until every required input can be mapped without mutable-path fallback, launch remains BLOCKED. |
| Capture/timeout | Independently supervise the child, drain bounded stdout/stderr concurrently, own the bytes, and reject overflow/truncation, timeout, cancellation, startup failure or invalid exit state. Use a pidfd for task identity/signalling and `waitid` for reaping, with the documented `pidfd_open` child-lifetime conditions or atomic `CLONE_PIDFD`. A pidfd is not executable identity and does not kill descendants. A delegated cgroup v2 domain with approved limits and tree cleanup is a deployment candidate, not something Node byte-work emulates. |
| Dispose | No success before expected child exit, complete capture and validated input/image context. On cancellation/failure terminate the invocation tree, observe/reap termination, drain/close pipes, close image/input/pid fds and clean private directories. Do not reuse a lease or release an admission slot while work/descendants remain. If cleanup cannot be confirmed, quarantine the operation; an unresponsive task may continue consuming a slot. No retry through another backend. |

The candidate uses modern executable-memfd controls (`F_SEAL_EXEC` is documented
since Linux 6.3), not implicit legacy executable defaults. This is a proposed
minimum feature profile, not an approved supported-kernel list. Namespace
`vm.memfd_noexec=2` rejects executable memfd creation; do not lower that setting
or bypass an administrator policy. An unprivileged provider also needs any
cgroup delegation pre-provisioned by the deployment owner; no privileged helper
is introduced. `memory.max` can temporarily be exceeded, `cpu.max` is bandwidth
control (not a wall-clock timeout), and pid limits do not establish executable
identity. A process-tree escape/namespace policy and all finite values still
need explicit approval. macOS/Windows remain NOT_CHECKED and disabled.

Official/project documentation and the precise guarantees used:

- [Linux memfd API](https://man7.org/linux/man-pages/man2/memfd_create.2.html):
  anonymous file, sealing opt-in, fd lifetime; no implicit immutable image.
- [Linux file seals](https://man7.org/linux/man-pages/man2/F_GET_SEALS.2const.html):
  inode-wide, irreversible seals; content/size/execute-mode restrictions,
  writable-mapping failure, and the weaker future-write seal.
- [Kernel executable-memfd policy](https://docs.kernel.org/userspace-api/mfd_noexec.html):
  explicit EXEC/NX creation and hierarchical namespace rejection policy.
- [Linux execveat](https://man7.org/linux/man-pages/man2/execveat.2.html):
  empty path with `AT_EMPTY_PATH` executes the referenced fd; scripts and
  close-on-exec have a documented incompatibility.
- [Linux execve](https://man7.org/linux/man-pages/man2/execve.2.html):
  explicit argv/env, preserved process attributes, and ELF `PT_INTERP` loader
  behavior; sealing the main file is not a loader-closure guarantee.
- [Linux pidfd_open](https://man7.org/linux/man-pages/man2/pidfd_open.2.html):
  stable child reference, poll/signalling/wait uses and PID-reuse prerequisites.
- [Kernel cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html):
  delegation, `memory.max` caveats, `cpu.max`, `pids.max`, `cgroup.kill` tree
  termination and `cgroup.events` population observation. Available controllers,
  permissions and safe pre-execution placement are UNVERIFIED locally.
- [GitHub CLI attestation verify](https://cli.github.com/manual/gh_attestation_verify):
  file operand, default API acquisition and JSON verification output. This
  review made no API call and does not establish behavior of the pinned gh build.

Next implementation order: approve the bootstrap/deployment and attacker model;
review pinned executable/runtime and input-layout compatibility; implement an
unregistered native backend with synthetic image/input and cleanup tests in an
authorized environment; provision/approve shared limits and isolation; only then
consider independent registration and real attestation/evidence verification.
Pure Node lifecycle/reader guards can be implemented and tested now, but adding
a callback-shaped launcher or naming state-machine stages would not supply the
missing OS binding, closure or trust root. No native backend is added here.

Legacy priority before provider integration: first admit all offline evidence,
registry, policy and input-layout files (the callback-only `captureOfflineExecution`
in `scripts/release-checks.mjs` is not a registered provider); then any artifact/
bundle acquisition fallback introduced by that integration. The source-only
`readNativeBuildPreflight` and fixed-disabled builder remain lower-priority
legacy readers, outside consumer admission. The producer's saved archive-source
reader is a separate boundary, not certified by the native audit. The existing
report layer explicitly separates `AUTHENTICATED_NATIVE_EXECUTION_REPORT` from
`consumer_native_crypto_reexecution: NOT_CHECKED`.

Even a successfully bound executable still needs independently approved gh
distribution pins, actual attestation verification, signer/builder approval,
authenticated artifact acquisition and native evidence verification. An
`AUTHENTICATED_NATIVE_EXECUTION_REPORT` authenticates a producer report; it is
not consumer cryptographic reexecution. Until those separate contracts and real
evidence exist, publication stays false, deployment NOT_CHECKED and Production
acceptance BLOCKED.

##### Runtime closure and offline input boundary (source audit)

This is a source/documentation audit, not an inspection of a built ELF or an
authenticated distribution. No executable, launcher or real attestation was run.
There is no independently registered real gh/verifier pin or provider root.

| Execution dependency | Observed declaration/path | Unresolved admission requirement |
|---|---|---|
| Rust verifier | [`nativeBuildRecipe`](../../scripts/release-native-build.mjs) declares Rust 1.98.1, GNU x86-64, release/default features, empty Rust flags and a locked build. [`Cargo.toml`](Cargo.toml) and [`Cargo.lock`](Cargo.lock) include local authenticity/TLSN patches and cryptographic dependencies. | No static-runtime requirement, actual `PT_INTERP`/`DT_NEEDED`, linker/sysroot closure or admitted output digest. The four-entry preflight inventory explicitly says `complete_dependency_closure: NOT_CHECKED`; it is not the full crate/build/runtime closure. |
| TLSN trust anchor | [`verify_bundle`](src/evidence_bundle.rs) supplies the CLI DER bytes to [`verify_alpha15_presentation_with_trusted_notary_key_and_trust_anchor`](src/tlsn_alpha15.rs), replacing that verification's certificate-root provider. | This visible entry uses the supplied anchor, not an ambient OS CA selection. It does not certify every compiled dependency or admit that anchor independently. |
| gh image/runtime | [`prepareNativeGhInspection`](../../scripts/release-native-attestation.mjs) requires caller-supplied exact hex SHA-256; its version gate accepts stable 2.x starting at 2.102, not one exact version. Upstream v2.102.0's Linux release recipe sets `CGO_ENABLED=0`. | That upstream recipe is reference source, not a FUSOU-approved or inspected binary. It does not establish the closure of an arbitrary executable passing the version gate. No real distribution/pin is registered. |
| gh attestation acquisition | Current argv has a local artifact operand and no `--bundle`/custom-root option. Reference source opens that artifact, obtains attestations through the GitHub API and may fetch bundle URLs, with retries/concurrent downloads. Sigstore verifiers use TUF roots/targets/cache. | Approved acquisition mode, network endpoints/redirects, DNS, HTTP limits, root refresh/cache policy and source-to-capture binding are absent. A sealed gh image alone cannot make this an offline operation. |
| gh ambient dependencies | Reference source resolves config/authentication, including env/config/keyring; HTTP uses the Go transport. Linux CA files, resolver files and TUF cache are runtime dependencies even for a non-cgo build. | The mock allowlist excludes inherited tokens, PATH/proxy/loader variables and fixes HOME/XDG/host, but labels do not create private directories or prove isolation. No helper/subprocess/plugin-free closure has been established; package dependency on git is not proof this subcommand invokes git. |

`memfd` seals plus `execveat(AT_EMPTY_PATH)` can bind the top-level image, not its
interpreter, shared objects, configuration or later file/network reads.
The first candidate must reject scripts and any ELF interpreter/dynamic
dependency closure not independently admitted. Static ELF is not automatically
dependency-free. A dynamic backend would additionally need a pinned immutable
loader/library/config namespace for the lease lifetime; removing `LD_*` alone
does not remove RPATH/RUNPATH, loader cache/default directories or system preload.
Neither format currently has an enabled backend.

The Node offline inspection/capture boundary uses the native resource scope.
The Rust loader and a real native provider remain separate and unconnected:

| Input | Acquisition, ownership and integrity path | Remaining read/layout boundary |
|---|---|---|
| Bundle manifest | [`offlineLayout`](../../scripts/release-checks.mjs) takes owned bytes under explicit admission, strictly parses JSON, requires the 19 mandatory artifact roles and an exact independently expected input-digest inventory. | This is a synchronous Node snapshot, not an atomic filesystem acquisition or an immutable Rust input namespace. |
| Presentation, signed Result, Result registry/envelope, Notary registry | Per-role raw bytes in the manifest; both Node layout and Rust loader require `artifact_sha256` plus `byte_length`. Receipt/input-inventory descriptors still use their separate `sha256` field; there is no legacy hash-field fallback. | Hash equality is not signature/identity authority. Rust verification checks registry-envelope trust, Result signature, Presentation binding and authenticated semantics; mock stdout is not evidence that these ran. |
| Session, authenticated user, device identity/authentication, possession proof, consume receipt, replay | Same manifest-byte binding, then Rust session/authority/signature/identifier relationships. | Mixed inputs are rejected only through the relationships actually checked; byte digests alone do not prove a common generation. |
| Authority registries, capture metadata, semantic verification, health, trust root, subject | Same raw-artifact binding and subsequent Rust trust-graph checks. | Rust owns the bytes after loading, but acquisition is sequential, not an atomic filesystem snapshot. |
| Seven CLI files | Bundle plus Notary/session/binding registries, Origin Inventory, Target Approval and DER trust anchor. Node maps them to `<role>.input`; the three registries must equal their bundle copies. Rust also compares the anchor to bundled trust-root bytes and validates the Production target-digest pair. | CLI reads six files with unbounded `fs::read`; bundle loading separately reads manifest/artifact paths. `canonicalize` then `fs::read` is path reopening, not immutable-handle acquisition. Limits/digest checks do not precede those allocations. |
| Scalar pins/context and executable | Owned plain-JSON policy/context and owned executable bytes precede the first async turn; exact primitive argv is frozen. Caller-provided root/key IDs, SPKI, user/device/target/profile IDs and executable digest/version remain independently required inputs. | No independent acquisition/registration root for those inputs. The CLI has no implemented native version-observation contract. Before/after mock measurements cannot prove the executed image. |
| Capture and publication bytes | [`captureOfflineExecution`](../../scripts/release-checks.mjs) accepts only an explicit `mockExecutor`, with separate owned input/file maps, bounded owned stdout/stderr, exit status, receipt and digests. [`verifyOfflineExecution`](../../scripts/release-checks.mjs) checks both capture digests and the exact inventory, archive Result/Presentation readback and source/capture/session/binding context. | Mock output is not native execution. Mutable callback copies cannot alter the private snapshot, but a callback's transient writes or actual choice of processed bytes are not proven by a post-hash. No real stream/child supervision. Packaging/archive is not publication authorization. |

###### Node offline admission and snapshot contract

`captureOfflineExecution`, `offlineLayout` and `verifyOfflineExecution` require an
explicit `resourceBudget`; `verifyReleaseChecks` and its consumer wiring require
`offlineResourceBudget`. There is no default controller or official limit.
Missing/forged admission is rejected before parsing/copying/calling the mock.
The old `execute` callback cannot enable a formal execution path, even if a
`mockExecutor` is also supplied. A controller's `UNAPPROVED` label is not an
authorization decision; caller labels cannot issue registered provider, signer,
builder or resource-policy approval. Default formal consumption has no issuer
for this admission and stays blocked. Explicit local structural admission never
upgrades a report to native reexecution or authorizes publication.

One owner-bound operation covers input copies, layout, JSON validation, map
materialization, callback waits, stdout/stderr capture, receipt/output
materialization and proof checks. Copy/read counts, cumulative modeled byte-work,
JSON byte/depth/node/string limits, monotonic deadline, cancellation and
controller concurrency use the existing private scope, including failure paths.
Map entry counts use the JSON-node ceiling before materialization/sorting.
Byte-valued inventory objects use bounded own-data-property enumeration, without
invoking getters through `Object.entries`.
Both capture slots are admitted before invoking the mock. Partial work is not
retried or refunded as unperformed work. Subsequent operations start fresh
per-operation counters only after all retained work settles.
Stdout-only captures/receipts are rejected; empty stderr must still be captured
and bound by its digest. The owned check policy is parsed once per operation,
not reacquired after asynchronous callbacks.
Separate controllers remain separate admission domains, not process-global
limits. The larger fixture read count and timeout in
[`release-check-fixture.mjs`](../../scripts/release-check-fixture.mjs) are
explicit test-only values, not approved limits.

Private bytes, callback input bytes and callback file bytes have separate,
non-pooled backing ArrayBuffers, not merely non-overlapping Buffer views into a
shared Node allocation pool. SharedArrayBuffer-backed inputs and accessor-bearing
plain-JSON policies/output fields are rejected. The callback never receives the
private maps, policy, context or receipt. Result bytes/metadata are copied and
validated after settlement; retained callback references cannot mutate emitted
records. The consumer snapshots its offline/archive receipt inputs, policy bytes,
Runtime Config authority bytes and payload before its first async turn, and
provides separate copies to report-authentication callbacks.

Caller A-to-B-to-A changes cannot replace those private expected bytes. Frozen
argv prevents in-place argument substitution. Callback map mutations remaining
at settlement are rejected; transient changes to a callback's own mutable byte
copies are **not detected as execution events**. No comparison of start/end
digests proves what an arbitrary callback or a future native process consumed.
That requires the still-missing provider/input ABI.

[`parseNativeInspectionJson`](../../scripts/release-native-resources.mjs)
performs bounded fatal UTF-8 decoding and structural prechecks before
`JSON.parse` validates the complete grammar, then a character/token scan rejects
duplicate decoded keys per object, including escaped equivalents. String
contents are not mistaken for keys. The parsed tree is also structurally bounded.
This is not regex-only JSON parsing. Manifests, stdout, session JSON, Notary and
security-registry JSON use this inspection. Check-policy and receipt JSON must
additionally round-trip to the existing canonical record encoding; manifest
whitespace is not rejected merely for being noncanonical. Artifact descriptors
require `artifact_sha256`/`byte_length`/`path`; receipt inventories use
`sha256`/`byte_length`, with no substitution between these contracts. Presentation,
Result, signatures and other opaque artifacts retain their exact pinned bytes;
this Node layer does not independently perform their cryptography or certify
all Rust JSON loaders.

Timeout/cancel rejects the operation without producing successful capture
evidence. A noncooperative managed callback retains its execution slot until
settlement, including late rejection. A callback that never settles can therefore
consume that slot indefinitely. These are cooperative Node work limits, not
forced synchronous-JS termination, limits on callback-internal allocations,
RSS/GC guarantees, real stream backpressure, kernel isolation or child cleanup.
Upstream transport/evidence collection and legacy source/builder preflights are
not retroactively covered by the offline operation.

The layout rejects traversal, exact duplicate destinations and file/directory
prefix conflicts (including CLI input names), independent of descriptor order.
Shared directories are valid. Segment-tree collision checking avoids pairwise
path comparisons and repeated full-prefix storage. These are layout invariants,
not an OS materialization mechanism: the Rust manifest uses relative sibling
paths, so seven isolated `/proc/self/fd/N` arguments alone cannot supply its
artifact directory. A provider must deliver a sealed/read-only complete
namespace or an explicitly revised fd-native input ABI without mutable fallback.
No such namespace/ABI is implemented here.

Provider readiness, classified independently of mock success:

| Contract | Status | Source basis / missing condition |
|---|---|---|
| Bootstrap root | MISSING | Draft policy and migration contract only; no independent install/update/revocation or registration issuer. |
| Authorization | MISSING | Caller pins and `UNAPPROVED` controllers are not approved signer/builder/image/resource policies. |
| Immutable execution input | PARTIAL | Native owned snapshots/bounded reads and offline digest/layout checks exist; no sealed executable/runtime/input namespace or admitted launcher. |
| Execution isolation | MISSING | Mock environment contract exists; no registered OS backend, private filesystem/network/credential enforcement or descendant containment. |
| Capture | PARTIAL | Owned bounded native mock capture and offline receipts exist, but no actual child/image/exit-bound provider proof. |
| Cancellation and disposal | PARTIAL | [`release-native-resources.mjs`](../../scripts/release-native-resources.mjs) retains managed native/offline mock work until settlement; no real process-tree cleanup. |
| Evidence binding | PARTIAL | Exact role/input/report/archive digests and context checks exist; no registered image/runtime/input/capture evidence chain. |
| Aggregate budgets | PARTIAL | Node native/offline operations share work within each owner-bound scope and concurrency within the supplied controller. Independent controllers are independent domains; Rust input acquisition and an approved global issuer remain missing. |

Source/documentation references (not artifact authentication):

- [gh v2.102.0 release recipe](https://github.com/cli/cli/blob/v2.102.0/.goreleaser.yml)
  and [Go dependencies](https://github.com/cli/cli/blob/v2.102.0/go.mod).
- [gh command entry](https://github.com/cli/cli/blob/v2.102.0/pkg/cmd/attestation/verify/verify.go),
  [attestation selection](https://github.com/cli/cli/blob/v2.102.0/pkg/cmd/attestation/verify/attestation.go),
  [artifact file open](https://github.com/cli/cli/blob/v2.102.0/pkg/cmd/attestation/artifact/file.go),
  [API/bundle acquisition](https://github.com/cli/cli/blob/v2.102.0/pkg/cmd/attestation/api/client.go),
  [Sigstore verification](https://github.com/cli/cli/blob/v2.102.0/pkg/cmd/attestation/verification/sigstore.go)
  and [TUF/cache setup](https://github.com/cli/cli/blob/v2.102.0/pkg/cmd/attestation/verification/tuf.go).
- [gh authentication resolution](https://github.com/cli/cli/blob/v2.102.0/internal/config/config.go),
  [HTTP authentication](https://github.com/cli/cli/blob/v2.102.0/api/http_client.go),
  [transport](https://github.com/cli/go-gh/blob/v2.16.1/pkg/api/http_client.go)
  and [documented environment](https://cli.github.com/manual/gh_help_environment).
- [Go Linux CA locations](https://github.com/golang/go/blob/master/src/crypto/x509/root_linux.go)
  and [resolver dependencies](https://github.com/golang/go/blob/go1.27.1/src/net/conf.go):
  runtime files/network remain dependencies; these sources are not a pin for an inspected gh binary.
- [Linux dynamic loader](https://man7.org/linux/man-pages/man8/ld.so.8.html):
  interpreter/shared-object search, RPATH/RUNPATH, cache and loader variables.
- [Rust C-runtime linkage](https://doc.rust-lang.org/reference/linkage.html#static-and-dynamic-c-runtimes):
  target defaults/`crt-static` and the need to inspect actual output rather than
  infer static linkage from the GNU target or Cargo lockfile.

Linux remains an unregistered implementation candidate; macOS/Windows remain
NOT_CHECKED and disabled. Node offline input/JSON/mock-capture admission is
implemented locally, not approved for real execution. Next work is a chosen
immutable input ABI/runtime profile, followed by unregistered Linux backend tests
in an explicitly authorized environment. Registration still
requires independent provider/runtime/role pins, signer/builder authorization,
approved resource/isolation/network policies and bootstrap lifecycle. No secret
is required for this source audit; whether online gh needs a credential
capability remains an external policy decision. Missing prerequisites mean no
launch, not a fabricated approval or path-based fallback.

Example offline invocation (not run by the native identity audit):

```text
cargo +1.95.0 run --offline --manifest-path packages/FUSOU-TLSN-VERIFIER/Cargo.toml --bin verify_fusou_tlsn_evidence -- \
  --bundle evidence/tlsn-production-evidence.json \
  --evidence-root-key-id evidence-root-2026 \
  --evidence-root-public-key-spki ROOT_PUBLIC_KEY_SPKI_BASE64URL \
  --trusted-notary-registry trusted/notary-registry.json \
  --session-authority-registry trusted/session-authority-registry.json \
  --session-authority-key-id session-authority-2026 \
  --session-authority-public-key-spki SESSION_AUTHORITY_PUBLIC_KEY_SPKI_BASE64URL \
  --binding-authority-registry trusted/binding-authority-registry.json \
  --binding-authority-key-id binding-authority-2026 \
  --binding-authority-public-key-spki BINDING_AUTHORITY_PUBLIC_KEY_SPKI_BASE64URL \
  --canonical-user-id 11111111-1111-4111-8111-111111111111 \
  --device-id 22222222-2222-4222-8222-222222222222 \
  --device-public-key DEVICE_PUBLIC_KEY_BASE64URL \
  --server-identity game.example.com \
  --origin-inventory packages/configs/tlsn-origin-inventory.json \
  --target-approval packages/configs/tlsn-target-approval.json \
  --profile-sha256 PROFILE_SHA256_BASE64URL \
  --verifier-key-id verifier-2026 \
  --trust-anchor-der trusted/game-root.der
```

Complete Result v2 and sparse Result v3 sign the SHA-256 of the exact raw
Presentation bytes. Production Results additionally sign the current inventory
and Target Approval artifact digests as a required pair. This Production-only
verifier rejects Results without that pair and rejects bundles when either
external artifact is changed or does not approve the Result's server identity.

The command never contacts Worker, FUSOU-WEB, Supabase, Trigger.dev, a Game
Server, or a Notary. On rejection it exits non-zero and prints a JSON object
with the failing `trust_edge`, artifact, and when available the expected and
actual values.

The verifier crate's offline CLI integration tests cover rejection of a
cryptographically valid upstream Presentation when its authenticated identity
does not match the requested identity, rejection of trailing Presentation
bytes, and Evidence Bundle CLI rejection when external Evidence Root inputs
are missing. These negative-path tests do not provide a successful FUSOU
`require_info` Presentation or a Production-shaped Evidence Bundle.

Run the local verifier tests with:

```sh
cargo test --manifest-path packages/FUSOU-TLSN-VERIFIER/Cargo.toml --locked
node --test packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-attestation-id-test.mjs
```

Example invocation:

```text
cargo +1.95.0 run --offline --manifest-path packages/FUSOU-TLSN-VERIFIER/Cargo.toml --bin verify_tlsn_require_info -- \
  --presentation presentation.bin \
  --server-identity game.example.com \
  --profile-sha256 PROFILE_SHA256_BASE64URL \
  --verifier-key-id verifier-2026 \
  --notary-key-id notary-2026 \
  --canonical-user-id USER_UUID \
  --canonical-device-id DEVICE_UUID \
  --device-challenge DEVICE_CHALLENGE_BASE64URL \
  --notary-key-base64url SERIALIZED_NOTARY_KEY_BASE64URL \
  --trust-anchor-der trust-root.der
```

The experimental probe is distinct from the APP's feature-gated production
`ProverOwnedTlsTransport` path. The APP path validates Runtime Config, Target
Approval, and Worker identity/health before serving; because its embedded
bootstrap URL and signer pins are currently `None`, this checkout cannot start
that route. When all runtime gates are provisioned, the FUSOU-PROXY gate uses
the normal MITM handler's actual request metadata and forwards the selected
request through the supplied one-shot transport; it does not generate a
standalone `require_info` request. If no forwarder is available, it returns
`503`. Synthetic-origin tests cover the Prover-owned request/response boundary,
binding/replay rejection, alpha.15 Presentation verification, and unsigned
Result construction. The synthetic certificate chain and test signing inputs
are not production trust or signer evidence; real Game Server compatibility,
Notary-backed Presentation generation, Production Result signing, archive
collection, and runtime delivery remain unverified. P0-05 therefore remains
`BLOCKED`.

Run the focused checks with:

```text
cargo +1.95.0 test --manifest-path packages/FUSOU-TLSN-VERIFIER/Cargo.toml
cargo test --manifest-path packages/FUSOU-PROXY/proxy-https/Cargo.toml experimental_require_info_route
cargo test --manifest-path packages/FUSOU-PROXY/proxy-https/Cargo.toml selected_actual_request_uses_only_the_experimental_forwarder
cargo test --manifest-path packages/FUSOU-PROXY/proxy-https/Cargo.toml handler_routes_the_actual_request_once_without_production_fallback
```

The pinned `mpz-fields` dependency requires Rust 1.95 or newer.

The local origin integration checks can be run independently when iterating on
the Prover-owned wire path:

```text
cargo +1.95.0 test --manifest-path packages/FUSOU-TLSN-VERIFIER/Cargo.toml proxy_transport_authenticates_prover_owned_wire_bytes
cargo +1.95.0 test --manifest-path packages/FUSOU-TLSN-VERIFIER/Cargo.toml experimental_probe_runs_on_a_prover_owned_connection
```

These tests use an in-memory TLS origin and test-only trust/signing material.
They do not contact the Game Server or a Notary and do not change the
`P0-05 = BLOCKED` classification.

### Separate reusable-authenticity prototype

The [`packages/authenticity` workspace](../authenticity/README.md) is a
separate local prototype. Its optional clean-upstream alpha.15 adapter
characterizes the pinned upstream Presentation verifier and authenticated
range extraction; it does not replace this verifier's path-patched production
dependency. The adapter uses a synthetic fixture and caller-supplied trust
inputs, and its resistance to hostile transcript-length-driven allocation has
not been established. Its local authentication/device example is not
Supabase, production registration, a FUSOU Result, or an Evidence Bundle.
Passing its tests does not change P0-01, P0-10, Phase 0, or Production
acceptance.
