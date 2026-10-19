# Rama Experimental Backend Status

## Decision

Rama is integrated as an optional experimental backend for side-by-side testing. It is not the default proxy and is not production-ready. The Hudsucker backend remains the normal runtime path. Neither the Hudsucker fork nor any TLSN fork is removed or changed by this work.

The Rama implementation is compiled only with `rama-experimental`; no production configuration or runtime switch selects it.

## Existing Hudsucker Capture Contract

The proxy depends on the local `hudsucker` 0.23.0 fork. Its relevant FUSOU-specific API and use are:

| Extension | Current use |
| --- | --- |
| `HttpContext.connection_id` | Allocated once when Hudsucker accepts a TCP connection and reused for that connection's HTTP callbacks. |
| `ClientStreamHook::wrap` | Wraps the client-facing stream after downstream TLS termination and before Hyper parses it. FUSOU installs `RawCaptureHook`, which wraps it with `CaptureIo`. |
| Request/response callbacks | Record parsed-message metadata and start/end offsets while the byte stream itself is captured below the parser. |
| `Body::with_completion` | Runs request/response completion callbacks when a non-empty HTTP body is consumed to completion. |
| `finish_with_status` | Receives whether the Hudsucker HTTP connection service completed successfully; incomplete or failed sessions are not persisted. |

`CaptureIo` records successful reads as request-direction bytes and successfully accepted writes as response-direction bytes. These are downstream client-facing plaintext bytes, not TLS records and not bytes reconstructed from HTTP objects. The Hudsucker integration test compares the resulting transcript to the bytes written by the client and received by it.

`RawCaptureHook::response_completed` is currently a no-op. A response range is closed when the next request starts or when the connection is finalized; this means an upgraded response range may include subsequent WebSocket bytes. The Rama WebSocket regression preserves and checks that existing writer behavior rather than redefining the message boundary.

The fork's default features are `decoder`, `rcgen-ca`, and `rustls-client`. HTTP/2 is a separate `http2` feature included by `full`; the `proxy-https` dependency does not enable `full` or `http2`. The current Hudsucker builder enables HTTP/1 for its upstream connector. Its WebSocket path upgrades HTTP and forwards messages using `tokio-tungstenite`; the existing Hudsucker capture regression covers persistent HTTP/1.1, not WebSocket raw-byte/lifecycle parity.

## Rama Dependency and API Choice

- `rama = 0.4.0`, optional, with default features disabled and `http-backend`, `ws`, `rustls`, and `ring`.
- `rama-http-backend = 0.4.0`, optional direct dependency for its public `HttpServer` and `HttpMitmRelay` APIs.
- Both crates declare MSRV Rust 1.96.0 and license `MIT OR Apache-2.0`; the validation environment used Rust 1.98.1.
- `http-full` is intentionally not enabled. It enables additional features, including compression; in this workspace that feature set conflicted with the existing `zstd-sys` dependency constraints.
- The adapters use public Rama service and I/O APIs and Tokio `AsyncRead`/`AsyncWrite` wrappers. They do not depend on Rama private APIs.

`packages/FUSOU-PROXY/proxy-https/Cargo.lock` already contains the Rama 0.4.0 dependency entries. It was not rewritten from the sanitized offline mirror, whose only lockfile difference was an offline-resolved `psl` patch version.

## Experimental Data Flow

1. Rama assigns a monotonically increasing connection ID at TCP accept and rejects ID exhaustion.
2. The CONNECT handler validates the configured canonical DNS `host:port`, connects to the configured upstream socket, and completes upstream TLS before accepting the tunnel.
3. Upstream TLS uses explicit trust roots, `ServerVerifyMode::Auto`, and the configured DNS name. Untrusted roots and hostname mismatches fail closed.
4. After CONNECT upgrade, the existing Hudsucker CA trait generates the downstream leaf configuration. The downstream TLS provider rejects SNI that does not match the CONNECT host.
5. `CaptureIo` wraps the downstream TLS stream before `HttpMitmRelay` parses HTTP. It records only bytes actually read or accepted by the underlying I/O. A one-byte read cap is used in this experimental path to keep parser lifecycle offsets from including bytes read ahead from a following message.
6. `CaptureService` sends request/response lifecycle events to the same `RawCaptureHook` session and transcript writer used by Hudsucker. The upstream and downstream HTTP relay is explicitly HTTP/1.1.
7. For WebSocket upgrades, the observer wraps both upgraded I/O streams and incrementally recognizes valid Close frames on each peer's incoming byte stream. A capture is considered clean only when Rama reports a close event and both peers' Close frames were observed; otherwise the session is invalidated. The observer does not supply transcript bytes—the downstream `CaptureIo` remains the sole raw capture source.
   The relay has a 10-second internal close-handshake timeout and a shorter 5-second outer completion deadline. If the relay does not return before the outer deadline, the session is invalidated rather than persisted.
8. The existing writer remains selective: it persists only clean, non-invalid sessions containing a request target with `/api_get_member/require_info`. The WebSocket fixture uses that path so the test exercises the existing writer contract; it is synthetic and is not a game-server observation.

## Verification Results

Commands were run only in `/tmp/fusou-rama-integrated-sandbox`, a sanitized mirror with a placeholder configuration file. The protected repository configuration and verifier source were not used as build inputs.

| Check | Result |
| --- | --- |
| `cargo check --offline --locked --features rama-experimental --lib` | PASS |
| `cargo test --offline --locked --features rama-experimental --lib` | PASS — 73 passed, 0 failed |
| `rustfmt --check --edition 2024` on `src/proxy_server_https/rama_experimental.rs` | PASS |
| `cargo clippy --offline --locked --features rama-experimental --tests` | PASS with existing warnings: 21 library warnings and one additional test warning; no diagnostic points to `rama_experimental.rs`. |
| `cargo clippy --offline --locked --features rama-experimental --tests -- -D warnings` | FAIL — the same existing warnings in other proxy sources are promoted to errors. They were not mass-fixed as unrelated cleanup. |
| Package-wide `cargo fmt --check` | FAIL — reports formatting differences in other existing proxy-package files; the changed Rama module passes its direct formatter check. |

Coverage in the passing library tests includes:

- Same three HTTP/1.1 request fixtures through Hudsucker and Rama: keep-alive reuse, a chunked POST body, small writes, response association, exact client-facing request/response wire equality, and message offsets.
- Two concurrent Rama client connections: two separate captures with each request paired to its own response.
- Trusted local upstream TLS success; untrusted-root and hostname-mismatch rejection.
- CONNECT authority/downstream SNI mismatch rejection without capture.
- WebSocket HTTP/1.1 Upgrade, text and Close frames, exact downstream raw-wire capture, split-frame parsing, and rejection of incomplete/invalid close-frame state by the lifecycle predicate.

The all-target proxy test was not completed: the sanitized mirror does not contain the local example CA assets (`examples/ca/entity_key.pem` and `entity_cert.pem`) required to compile the example. No test assets or keys were copied into the repository.

## Remaining Work and Limitations

- Hudsucker/Rama WebSocket raw-capture parity is **NOT VERIFIED**. Rama's local WebSocket relay/capture test passes, but the existing Hudsucker regression test exercises HTTP/1.1 rather than WebSocket frames and lifecycle.
- An end-to-end incomplete-WebSocket-close integration case is **NOT CHECKED**; parser and clean-state predicate unit tests cover the incomplete state, and the successful integration case covers both Close frames.
- HTTP/2 is not enabled in the current Hudsucker dependency configuration and is not implemented or tested by this Rama experiment.
- Rama's experimental configuration is intentionally fixed to one canonical authority and socket address. It is not connected to production target selection, Origin Inventory, or Target Approval.
- The Rama backend still uses the Hudsucker fork's certificate-authority trait and implementation. Removing that dependency requires a separately reviewed CA/certificate-cache design.
- No production deployment, real game-server, external-service, or real-gameplay validation was performed. The backend must not be described as production accepted.

## Migration Gate

Keep Hudsucker as the default until all of the following are completed:

1. Add equivalent Hudsucker and Rama WebSocket fixtures and compare raw request/response bytes, upgrade lifecycle, abnormal closure handling, and persisted capture state.
2. Add an end-to-end incomplete WebSocket close test that proves no capture is persisted.
3. Reconfirm the complete capture contract and all enabled protocol paths against the fork source and regression tests.
4. Replace the Hudsucker CA dependency with a reviewed implementation or adapter before removing the fork.
5. Re-run proxy tests and strict lint/format checks after separately addressing the repository's pre-existing diagnostics.

TLSN APIs, dependencies, forks, Presentation, Verifier, and Notary are outside this migration and were not changed.
