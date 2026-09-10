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
NOTARY_MAX_CONCURRENT_SESSIONS=1
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

The protocol E2E covers both the official alpha.15 example bounds
(`max_sent_data=1<<12`, `max_recv_data=1<<14`) and the current FUSOU bounds
(`128 KiB` and `4 MiB`), with signed Attestation validation. At the frozen
alpha.15 revision the FUSOU bounds reach the upstream mux default of 512
streams during preprocessing. Both MPC endpoints now use the local
alpha.15-compatible mux patch in `packages/tlsn-mux-alpha15`, which raises the
local cap to 10240 and the receive window to 2.5 GiB. Measurements failed at
2048, 4096, and 8192 streams and passed at 10240 for the fixture-backed FUSOU
E2E. This changes no mux frames or Attestation/Presentation format, but the
larger per-connection window requires an explicit memory and concurrency review
before Production deployment.

An ignored local resource benchmark keeps `max_recv_data=4 MiB` fixed and
varies only `max_sent_data`. The reported RSS is the combined Prover and Notary
fixture process, so it is not a per-side allocation breakdown or Production
safety evidence:

| `max_sent_data` | AES keystream blocks | RSS after commit | RSS after cleanup | elapsed |
| ---: | ---: | ---: | ---: | ---: |
| 4 KiB | 258 | 375 MiB | 373 MiB | 6.98 s |
| 16 KiB | 1,026 | 908 MiB | 511 MiB | 14.90 s |
| 32 KiB | 2,050 | 1,599 MiB | 571 MiB | 25.78 s |
| 64 KiB | 4,098 | 3,956 MiB | 1,125 MiB | 67.41 s |
| 128 KiB | 8,194 | 5,833 MiB | 1,749 MiB | 91.49 s |

Every cell passed the real alpha.15 MPC, Attestation signing, and Attestation
validation flow. In the corrected 128 KiB run, the combined process reached a
resident high-water mark of approximately 5.9 GiB and a virtual-address-space
peak of approximately 9.8 GiB. The commit-phase growth tracks the number of
AES keystream blocks, which is evidence for an MPC preprocessing/circuit
footprint rather than eager allocation of the 4 MiB receive bound. The
post-cleanup RSS also remained approximately 1.7 GiB, so allocator/runtime
retention and per-side attribution still require investigation.

The process-separated benchmark uses the same local TLSN server fixture, but
runs the Prover, Notary, and TLS fixture in separate processes connected only
over loopback. Each matrix cell is an independent sequential run. The values
below are the maximum observed `RSS/HWM` in KiB for each process; `sum HWM` is
the sum of independent process high-water marks, not an instantaneous combined
RSS measurement.

With `max_recv_data=4 MiB`, the sent-capacity matrix was:

| `max_sent_data` | Prover RSS/HWM KiB | Notary RSS/HWM KiB | Fixture RSS/HWM KiB | sum HWM KiB | elapsed |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 99 B | 189088/189088 | 86728/142416 | 13668/13668 | 345172 | 6 s |
| 256 B | 190240/190240 | 87296/143092 | 13780/13780 | 347112 | 6 s |
| 512 B | 195124/195124 | 103408/143848 | 13928/13928 | 352900 | 7 s |
| 1 KiB | 223200/223200 | 122640/159148 | 13708/13708 | 396056 | 7 s |
| 2 KiB | 241464/241464 | 98680/191276 | 13316/13316 | 446056 | 7 s |
| 4 KiB | 278860/278860 | 144204/245536 | 13536/13536 | 537932 | 10 s |
| 8 KiB | 362748/365908 | 88076/380148 | 13472/13472 | 759528 | 12 s |
| 16 KiB | 506396/506396 | 160648/556076 | 13668/13668 | 1076140 | 17 s |
| 32 KiB | 769192/781444 | 291804/999460 | 13856/13856 | 1794760 | 29 s |
| 64 KiB | 1890788/2548752 | 619292/2502536 | 13476/13476 | 5064764 | 72 s |
| 128 KiB | 2552264/2715592 | 1223744/3613068 | 13476/13476 | 6342136 | 97 s |

At the FUSOU bound, the independent HWM sum is approximately 6.05 GiB.
The Prover and Notary are both material contributors, while the fixture
process remains approximately 13 MiB. The growth is therefore not caused by
the fixture's small HTTP response or by the fixture process itself.

With `max_sent_data=99 B`, the receive-capacity matrix was:

| `max_recv_data` | Prover RSS/HWM KiB | Notary RSS/HWM KiB | Fixture RSS/HWM KiB | sum HWM KiB | elapsed |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 149 B | 190628/190628 | 88308/144844 | 13916/13916 | 349388 | 7 s |
| 256 B | 193596/193596 | 86480/142352 | 13632/13632 | 349580 | 7 s |
| 512 B | 190212/190212 | 87452/143052 | 13648/13648 | 346912 | 7 s |
| 1 KiB | 189628/189628 | 86024/142892 | 13532/13532 | 346052 | 7 s |
| 4 KiB | 197504/197504 | 88656/144128 | 13904/13904 | 355536 | 7 s |
| 16 KiB | 192448/192448 | 91420/147172 | 13504/13504 | 353124 | 8 s |
| 64 KiB | 182016/182016 | 82428/137864 | 13540/13540 | 333420 | 7 s |
| 256 KiB | 185908/185908 | 91128/146204 | 13768/13768 | 345880 | 7 s |
| 1 MiB | 190640/190640 | 89952/145852 | 13764/13764 | 350256 | 7 s |
| 4 MiB | 190068/190068 | 89560/145408 | 13796/13796 | 349272 | 7 s |

The receive matrix stayed within normal run-to-run variation while the sent
matrix scaled sharply. This is local fixture evidence for sent-capacity-driven
preprocessing, not proof that every future response fits in 4 MiB. The
production receive bound still requires an observed, privacy-reviewed natural
`require_info` response and a deployed memory-limit test.

The benchmark also validates the signed alpha.15 Attestation at every passing
cell. It does not connect to the Game Server, and it is not Production E2E
evidence.

## Operations

The service is self-hostable but not Production-ready merely because it
builds. Production requires a deployed endpoint, private-network/L4 ACLs,
operator ownership, a secret-manager-backed active key, an immutable public
key registry entry, rotation/revocation procedures, and an independently
verified FUSOU interoperability run.

`NOTARY_MAX_CONCURRENT_SESSIONS` defaults to `1` because a fixture-backed
FUSOU-bound alpha.15 session reached approximately 5.9 GiB resident
high-water mark during local measurement. Connections beyond the configured
semaphore are rejected before TLSNotary session setup. Increase this value only
after measuring the deployed host's memory limit and reserving capacity for the
mux, runtime, and kernel socket buffers.

Rotation is performed by deploying a new instance with a new `NOTARY_KEY_ID`
and key, registering its public key before cutover, switching traffic, then
marking the old key `VERIFY_ONLY` and later `RETIRED`. A compromised key is
marked `REVOKED`, issuance is blocked, and all FUSOU validators must receive
the updated registry before service resumes. `VERIFY_ONLY`, `RETIRED`, and
`REVOKED` instances fail closed at startup and cannot issue Attestations.

Recommended deployment: a small Linux VM or bare-metal systemd service on a
private network, behind an L4 firewall/ACL or WireGuard. The raw alpha.15
stream must not be placed behind an HTTP reverse proxy or a Cloudflare Worker.
