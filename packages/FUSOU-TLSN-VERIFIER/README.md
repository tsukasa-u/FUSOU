# FUSOU TLSN Verifier

This crate is the fail-closed FUSOU `require_info` TLSNotary adapter boundary. It
contains the strict parser and links the frozen TLSNotary alpha.15 verification
backend. It is not wired into a production Proxy, Dedicated Verifier, or Web
runtime.

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
- fixed `require_info` request/response, server-identity, binding, digest, and full-disclosure checks.
- authenticated output to canonical `VerifierResult` construction, with the
	separate FUSOU signing inputs remaining explicit.

The backend is pinned to:

```text
repository: https://github.com/tlsnotary/tlsn.git
tag: refs/tags/v0.1.0-alpha.15
commit: 47aee45b53e06648c1b2ad3689b367b8c923fdec
```

`tlsn-attestation` and `tlsn-core` are linked at that exact revision. The
top-level `tlsn` prover/runtime crate is intentionally not linked: this crate
only verifies serialized alpha.15 `Presentation` values.

`verify_alpha15_presentation` deserializes an upstream bincode Presentation,
rejects trailing bytes, calls `Presentation::verify`, requires complete
sent/received disclosure, and maps only the verified server identity,
Attestation ID, transcript bytes, digests, and authenticated ranges into the
sealed adapter type. It does not fabricate FUSOU evidence or signatures.

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
authority, FUSOU Ed25519 signing keys, runtime transport, Web PKI policy, or
privacy/persistence review. The upstream fixture proves alpha.15 verification
including its upstream cryptographic checks, but the implementation therefore
does not change the P0-05 gate: P0-05 remains `BLOCKED` until an authenticated
alpha.15 FUSOU presentation and its evidence fixtures exist.

Run the focused checks with:

```text
cargo test --manifest-path packages/FUSOU-TLSN-VERIFIER/Cargo.toml
```
