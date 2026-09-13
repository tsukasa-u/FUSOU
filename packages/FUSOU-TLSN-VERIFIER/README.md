# FUSOU TLSN Verifier

This crate is the fail-closed FUSOU `require_info` TLSNotary adapter boundary. It
contains the strict parser and links the frozen TLSNotary alpha.15 verification
backend. Its Prover-owned TLS transport is not wired into a production origin
client, Dedicated Verifier, or Web runtime.

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
`proxy.experimental_tlsn_enabled`. When explicitly enabled, it detects the
first actual ordinary-play `POST /kcsapi/api_get_member/require_info` request
and fails closed with `503` because the production Session/Challenge authority,
Notary channel, binding injection, and Prover-owned origin transport are not
available. It never forwards that selected request through Production or
retries it. Non-target requests and the default-disabled Production route are
unchanged.

The backend is pinned to:

```text
repository: https://github.com/tlsnotary/tlsn.git
tag: refs/tags/v0.1.0-alpha.15
commit: 47aee45b53e06648c1b2ad3689b367b8c923fdec
```

`tlsn`, `tlsn-attestation`, and `tlsn-core` are linked at that exact revision.
The runtime dependency is currently used by the local transport skeleton and
offline tests. It is not wired into a production FUSOU-App origin transport, a
production Verifier service, or a Notary service.

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

The local alpha.15 fork is pinned to commit
`47aee45b53e06648c1b2ad3689b367b8c923fdec`. `ProveConfig::reveal_sent` and
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
- `--trust-anchor-der`: the externally supplied origin trust root, which must
  match the captured `trust_root` artifact byte-for-byte.

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

Example offline invocation:

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
  --profile-sha256 PROFILE_SHA256_BASE64URL \
  --verifier-key-id verifier-2026 \
  --trust-anchor-der trusted/game-root.der
```

The command never contacts Worker, FUSOU-WEB, Supabase, Trigger.dev, a Game
Server, or a Notary. On rejection it exits non-zero and prints a JSON object
with the failing `trust_edge`, artifact, and when available the expected and
actual values.

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

The experimental probe is not a production TLSN route and does not replace the
Hyper/rustls production origin client. The FUSOU-PROXY gate consumes the normal
MITM handler's actual request metadata only to select and block the request until
the missing transport is supplied; it does not generate a standalone
`require_info` request. Its synthetic-origin tests cover the Prover-owned
request/response boundary, binding/replay rejection, alpha.15 Presentation
verification, and unsigned Result construction. The synthetic certificate chain
and test signing inputs are not production trust or signer evidence; real Game
Server compatibility, Notary-backed Presentation generation, production Result
signing, and runtime delivery remain blocked. P0-05 therefore remains
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
