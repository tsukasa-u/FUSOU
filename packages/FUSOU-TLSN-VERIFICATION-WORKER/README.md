# FUSOU TLSNotary Verification Worker

This Worker is the authoritative verification boundary for FUSOU TLSNotary alpha.15 `require_info` Presentations.

The Worker issues a one-shot, authenticated Session/Binding context at `/attestation/session`. Session issuance requires the existing FUSOU device proof (`device_id`, the HMAC challenge nonce, and the Ed25519 signature over that nonce). The verifier accepts `presentation_base64`, `session_id`, `device_id`, and `binding` at `/verify/tlsn`. Rust/WASM verifies the Presentation and derives `verified_member_id` from authenticated response bytes. Client-provided member IDs are not accepted. Synthetic wire data is never treated as verified.

Both attestation endpoints require `Authorization: Bearer <Supabase access token>`. The Worker resolves the token through Supabase `/auth/v1/user`, uses the returned `auth.users.id` as the canonical user subject, rejects anonymous users, and never stores the raw token. For session issuance it forwards that bearer token and the existing device proof to the configured FUSOU-WEB device-proof endpoint. FUSOU-WEB remains the device-auth authority: it checks the existing HMAC challenge, `user_devices` owner and `revoked_at`, the DB public key, Ed25519 signature, and atomic nonce consumption. The Worker stores only the backend-derived device ID in the Durable Object. The canonical user ID and device ID are included in the signed verifier-result bytes. A binding issued to one user/device cannot be looked up or consumed under another user/device context.

The Worker does not implement a TLSNotary-specific device authentication scheme, receive a Supabase service-role key, or receive a device private key. A client-supplied `device_id` is only a selector/proof input; the authoritative device identity comes from the FUSOU-WEB verification response and the Durable Object record.

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

`pnpm test` runs Wrangler's local Worker runtime and checks device-proof session issuance through a synthetic FUSOU-WEB HTTP boundary, strict request validation, invalid/tampered Presentation rejection, user/device authority correlation, atomic single-use consumption including concurrent requests, expiry, identity and Notary fail-closed paths, and missing-configuration failure. FUSOU-WEB route tests cover the existing device-auth primitives and reject revoked, invalid-signature, owner-mismatch, and replayed proofs. It does not contact the Game Server or Notary.

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
- `TLSN_DEVICE_AUTH_URL` set to the FUSOU-WEB device-proof endpoint (`/api/auth/anonymous-sync/v2/device-proof` in the deployed API) for non-production environments
- `TLSN_SUPABASE_URL` and `TLSN_SUPABASE_PUBLISHABLE_KEY` for production Supabase access-token verification
- `TLSN_TEST_AUTH_USERS` only in `TLSN_ENVIRONMENT=test`, as a JSON map of test bearer tokens to non-anonymous user IDs

Production uses the `TLSN_PRODUCTION_*` equivalents, including `TLSN_PRODUCTION_DEVICE_AUTH_URL`, which must use HTTPS, and does not accept `TLSN_TEST_BINDING_VALUE`. The test environment may use `TLSN_TEST_BINDING_VALUE` only to seed the synthetic fixture binding; it is not a Prover authority.

`TLSN_SUPABASE_PUBLISHABLE_KEY` is a publishable client key, not a service-role key. Do not configure a service-role key in this Worker. Missing production auth configuration fails closed with `503 auth_unconfigured`; missing, unknown, malformed, or anonymous credentials return `401 unauthorized`.

Device proof integration is `PASS` in local synthetic scope only. The production trust contract is not complete until the deployed FUSOU-WEB endpoint, production device registry/revocation behavior, production trust material, a Notary key registry, replay/session authority, result-key publication and rotation, and performance evidence are exercised remotely. The test Worker and synthetic evidence do not satisfy that contract. Until then, `P0-05` remains blocked.
