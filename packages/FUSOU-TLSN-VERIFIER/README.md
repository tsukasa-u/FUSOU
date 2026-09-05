# FUSOU TLSN Verifier Foundation

This crate is an offline, fail-closed foundation for the FUSOU `require_info` TLSNotary adapter.

It currently provides:

- strict unpadded base64url and canonical UInt64 decimal parsing;
- non-overlapping transcript range validation and SHA-256 checking;
- strict HTTP/1.1 request/response framing, chunked decoding, and single-member gzip decoding;
- lossless `api_member_id` extraction from the fixed `svdata=` JSON path;
- strict binding-header parsing;
- canonical Verifier Result JSON and `VerifierResultSignBytes` construction.

It does not verify TLSNotary presentations, Notary signatures, Web PKI, authenticated transcript commitments, Ed25519 signatures, key registries, or privacy/persistence policy. The implementation therefore does not change the P0-05 gate: P0-05 remains `BLOCKED` until an authenticated alpha.15 FUSOU presentation and its evidence fixtures exist.

Run the focused checks with:

```text
cargo test --manifest-path packages/FUSOU-TLSN-VERIFIER/Cargo.toml
```
