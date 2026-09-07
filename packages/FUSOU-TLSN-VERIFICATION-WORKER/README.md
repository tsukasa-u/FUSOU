# FUSOU TLSNotary Verification Worker

This Worker is the authoritative verification boundary for FUSOU TLSNotary alpha.15 `require_info` Presentations.

The Worker issues a one-shot Session/Binding context at `/attestation/session`. The verifier accepts `presentation_base64`, `session_id`, and `binding` at `/verify/tlsn`. Rust/WASM verifies the Presentation and derives `verified_member_id` from authenticated response bytes. Client-provided member IDs are not accepted. Synthetic wire data is never treated as verified.

## Local development

Requirements:

- Rust toolchain `1.95.0`
- Rust target `wasm32-unknown-unknown`
- `wasm-pack`
- A wasm-capable Clang compiler for ring's C backend

Build and run the fail-closed smoke tests:

```sh
rustup target add wasm32-unknown-unknown --toolchain 1.95.0
RUSTUP_TOOLCHAIN=1.95.0 pnpm test
```

The build script discovers `clang`, `clang-18`, or `clang-17`. Set `CC_wasm32_unknown_unknown` when Clang is installed outside `PATH`.

`pnpm test` runs Wrangler's local Worker runtime and checks Session issuance, strict request validation, invalid/tampered Presentation rejection, authority correlation, atomic single-use consumption including concurrent requests, expiry, identity and Notary fail-closed paths, and missing-configuration failure. It does not contact the Game Server or Notary.

## Configuration

Configure these Worker values before deployment:

- `TLSN_BINDINGS` Durable Object binding for `TlsnBindingAuthorityDurableObject`
- `TLSN_BINDING_TTL_SECONDS` between `1` and `3600`
- `TLSN_SERVER_IDENTITY`
- `TLSN_PROFILE_SHA256`
- `TLSN_VERIFIER_KEY_ID`
- `TLSN_NOTARY_KEY_ID`
- `TLSN_NOTARY_REGISTRY`
- `TLSN_SIGNING_PRIVATE_KEY_PKCS8`
- `TLSN_TRUST_ROOT_CERTIFICATE_DER` when the configured verification profile requires a custom trust root

Production uses the `TLSN_PRODUCTION_*` equivalents and does not accept `TLSN_TEST_BINDING_VALUE`. The test environment may use `TLSN_TEST_BINDING_VALUE` only to seed the synthetic fixture binding; it is not a Prover authority.

The production trust contract is not complete until production trust material, a notary key registry, replay/session authority, result-key publication and rotation, and performance evidence exist. The test Worker and synthetic evidence do not satisfy that contract. Until then, `P0-05` remains blocked.
