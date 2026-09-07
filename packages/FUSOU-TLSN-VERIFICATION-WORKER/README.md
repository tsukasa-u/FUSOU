# FUSOU TLSNotary Verification Worker

This Worker is the authoritative verification boundary for FUSOU TLSNotary alpha.15 `require_info` Presentations.

The Worker issues a one-shot, authenticated Session/Binding context at `/attestation/session`. The verifier accepts `presentation_base64`, `session_id`, and `binding` at `/verify/tlsn`. Rust/WASM verifies the Presentation and derives `verified_member_id` from authenticated response bytes. Client-provided member IDs are not accepted. Synthetic wire data is never treated as verified.

Both attestation endpoints require `Authorization: Bearer <Supabase access token>`. The Worker resolves the token through Supabase `/auth/v1/user`, uses the returned `auth.users.id` as the canonical user subject, rejects anonymous users, and never stores the raw token. The Durable Object records that subject with the binding, and the canonical user ID is included in the signed verifier-result bytes. A binding issued to one user cannot be looked up or consumed by another user.

This package currently binds proofs to an authenticated user, not to a FUSOU device. The existing FUSOU device-key registration and challenge/signature/revocation path is not connected to this standalone Worker. No client-supplied `device_id` or public key is trusted as a substitute; device-level ownership remains blocked until that server-side path is integrated.

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
- `TLSN_SUPABASE_URL` and `TLSN_SUPABASE_PUBLISHABLE_KEY` for production Supabase access-token verification
- `TLSN_TEST_AUTH_USERS` only in `TLSN_ENVIRONMENT=test`, as a JSON map of test bearer tokens to non-anonymous user IDs

Production uses the `TLSN_PRODUCTION_*` equivalents and does not accept `TLSN_TEST_BINDING_VALUE`. The test environment may use `TLSN_TEST_BINDING_VALUE` only to seed the synthetic fixture binding; it is not a Prover authority.

`TLSN_SUPABASE_PUBLISHABLE_KEY` is a publishable client key, not a service-role key. Do not configure a service-role key in this Worker. Missing production auth configuration fails closed with `503 auth_unconfigured`; missing, unknown, malformed, or anonymous credentials return `401 unauthorized`.

The production trust contract is not complete until production trust material, a notary key registry, replay/session authority, result-key publication and rotation, device proof integration, and performance evidence exist. The test Worker and synthetic evidence do not satisfy that contract. Until then, `P0-05` remains blocked.
