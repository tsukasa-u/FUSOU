# FUSOU alpha.15 Notary

Standalone raw TCP Notary for the FUSOU TLSNotary `v0.1.0-alpha.15` client.

Pinned upstream revision:

```text
47aee45b53e06648c1b2ad3689b367b8c923fdec
```

This service implements the upstream alpha.15 MPC flow only:

1. Accept a raw TCP connection.
2. Run `Session` and the alpha.15 `Verifier` in MPC mode.
3. Complete `verify()` and close the TLSNotary session.
4. Read `bincode(AttestationRequest)` until the client write-half reaches EOF.
5. Build and sign a real alpha.15 `Attestation` with `secp256k1`.
6. Write `bincode(Attestation)`, flush, and close the socket.

The Notary never opens a Game Server connection. In alpha.15 MPC mode the
FUSOU Prover owns the origin TCP connection; this service only participates in
the MPC/session protocol and signs the resulting Attestation.

## Run

A signing key is mandatory. The private key is unpadded base64url encoding of
exactly 32 bytes and must be supplied by a secret manager or mounted secret.
No key values belong in this repository or a container image.

Environment:

```text
NOTARY_LISTEN_HOST=10.0.0.10
NOTARY_LISTEN_PORT=7047
NOTARY_KEY_ID=notary-2026-09
NOTARY_KEY_STATUS=ACTIVE
NOTARY_SIGNING_KEY_SOURCE=file
NOTARY_SIGNING_KEY_FILE=/run/secrets/fusou-notary-signing-key
NOTARY_SESSION_TIMEOUT_SECS=300
NOTARY_MAX_ATTESTATION_REQUEST_BYTES=16777216
```

The default listener is loopback (`127.0.0.1:7047`) so an accidental start is
not Internet-exposed. The request size limit is bounded to 64 MiB.

On startup the binary logs the public alpha.15 `VerifyingKey` in the exact
bincode/base64url form consumed by the current FUSOU verifier, plus a JSON
export containing the key ID and algorithm. The private key is never logged.

## Checks

```bash
cargo fmt --manifest-path packages/FUSOU-NOTARY/Cargo.toml -- --check
cargo check --manifest-path packages/FUSOU-NOTARY/Cargo.toml
cargo test --manifest-path packages/FUSOU-NOTARY/Cargo.toml
cargo clippy --manifest-path packages/FUSOU-NOTARY/Cargo.toml --all-targets -- -D warnings
```

The included tests cover key parsing/export, active-key enforcement, EOF
handling, and request-size rejection. A protocol E2E using a real FUSOU
client and a real alpha.15 server fixture is a separate gate; local tests or
fixtures are not Production evidence.

The protocol E2E currently uses the official alpha.15 example bounds
(`max_sent_data=1<<12`, `max_recv_data=1<<14`) and passes through signed
Attestation validation. The current FUSOU client requests larger bounds
(`128 KiB` and `4 MiB`); at the frozen alpha.15 revision those values reach
the upstream mux default of 512 streams during preprocessing. Each peer
enforces its own local mux limit, and `tlsn::Session::new` does not expose a
custom mux configuration. The standalone Notary cannot raise the peer
client's mux limit, so unchanged-client FUSOU
interoperability remains an explicit blocker until that client-side protocol
configuration is resolved. This package does not silently claim that gate is
passed.

## Operations

The service is self-hostable but not Production-ready merely because it
builds. Production requires a deployed endpoint, private-network/L4 ACLs,
operator ownership, a secret-manager-backed active key, an immutable public
key registry entry, rotation/revocation procedures, and an independently
verified FUSOU interoperability run.

Rotation is performed by deploying a new instance with a new `NOTARY_KEY_ID`
and key, registering its public key before cutover, switching traffic, then
marking the old key `VERIFY_ONLY` and later `RETIRED`. A compromised key is
marked `REVOKED`, issuance is blocked, and all FUSOU validators must receive
the updated registry before service resumes. `VERIFY_ONLY`, `RETIRED`, and
`REVOKED` instances fail closed at startup and cannot issue Attestations.

Recommended deployment: a small Linux VM or bare-metal systemd service on a
private network, behind an L4 firewall/ACL or WireGuard. The raw alpha.15
stream must not be placed behind an HTTP reverse proxy or a Cloudflare Worker.
