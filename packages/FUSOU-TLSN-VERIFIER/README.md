# FUSOU TLSN Verifier Foundation

This crate is an offline, fail-closed foundation for the FUSOU `require_info` TLSNotary adapter.

It currently provides:

- strict unpadded base64url and canonical UInt64 decimal parsing;
- non-overlapping transcript range validation and SHA-256 checking;
- strict HTTP/1.1 request/response framing, chunked decoding, and single-member gzip decoding;
- lossless `api_member_id` extraction from the fixed `svdata=` JSON path;
- strict binding-header parsing;
- canonical Verifier Result JSON and `VerifierResultSignBytes` construction;
- a sealed alpha.15 adapter boundary in `src/tlsn_alpha15.rs`;
- an `AuthenticatedTranscript` type that can only be created from an internal verified-output hook;
- fixed `require_info` request/response, server-identity, binding, digest, and full-disclosure checks.
- authenticated output to canonical `VerifierResult` construction, with the
	separate FUSOU signing inputs remaining explicit.

The selected alpha.15 source is not linked in this repository. Therefore
`verify_alpha15_presentation` returns `UpstreamImplementationUnavailable` and no
Presentation bytes are treated as authenticated. The adapter boundary documents
the exact future input to `AuthenticatedTranscript` without inventing a
Presentation or a local signature.

The production server-identity allowlist registry is also not linked. Its
constructor therefore rejects every identity until that trusted registry is
provided. Only test-only mock plumbing can create a profile for local parser
tests.

It does not currently verify TLSNotary presentations, Notary signatures, Web PKI,
authenticated transcript commitments, Ed25519 signatures, key registries, or
privacy/persistence policy. The implementation therefore does not change the
P0-05 gate: P0-05 remains `BLOCKED` until an authenticated alpha.15 FUSOU
presentation and its evidence fixtures exist.

Run the focused checks with:

```text
cargo test --manifest-path packages/FUSOU-TLSN-VERIFIER/Cargo.toml
```
