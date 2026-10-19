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
2. The CONNECT handler strictly parses the authority form and requires both the request authority and its single `Host` header to equal the configured canonical DNS `host:port`. Configuration also requires the authority port to equal the fixed upstream socket port; it does not provide implicit port translation.
3. After CONNECT upgrade, the existing Hudsucker CA trait generates the downstream leaf configuration. The downstream TLS provider rejects SNI that does not match the CONNECT host. Only after that downstream handshake succeeds does the proxy connect to the configured upstream socket.
4. Upstream TLS uses explicit trust roots, `ServerVerifyMode::Auto`, and the configured DNS name. Untrusted roots and hostname mismatches fail closed. If upstream TLS fails after downstream TLS is established, the client receives a tunneled `502 Bad Gateway`; no capture session is started.
5. `CaptureIo` wraps the downstream TLS stream before `HttpMitmRelay` parses HTTP. It records only bytes actually read or accepted by the underlying I/O. A one-byte read cap is used in this experimental path to keep parser lifecycle offsets from including bytes read ahead from a following message.
6. `CaptureService` sends request/response lifecycle events to the same `RawCaptureHook` session and transcript writer used by Hudsucker. The upstream and downstream HTTP relay is explicitly HTTP/1.1.
7. For WebSocket upgrades, the observer wraps both upgraded I/O streams and incrementally recognizes valid Close frames on each peer's incoming byte stream. A capture is considered clean only when Rama reports a close event, both peers' Close frames were observed, and no relay I/O error occurred; otherwise the session is invalidated. The observer does not supply transcript bytes—the downstream `CaptureIo` remains the sole raw capture source.
   The whole WebSocket lifetime is not bounded by an outer timeout. Rama's 10-second timeout applies only after a Close handshake begins, preserving connections that remain open longer than five seconds. EOF, relay I/O error, or a one-sided Close that does not complete within the close-handshake timeout is unclean and is not persisted. There is no separate idle timeout for a WebSocket connection that remains open without beginning a Close handshake.
8. The existing writer remains selective: it persists only clean, non-invalid sessions containing a request target with `/api_get_member/require_info`. The WebSocket fixture uses that path so the test exercises the existing writer contract; it is synthetic and is not a game-server observation.

## Audit Regression Fixes

- Removed the five-second timeout around the whole WebSocket relay. The ten-second bound is only for a Close handshake after it starts; long-lived WebSocket sessions are not cut off solely for exceeding five seconds.
- Listener-level connection task errors and panics are logged while the accept loop continues. A malformed HTTP client followed by valid parallel clients verifies listener recovery.
- CONNECT authority and the single `Host` header must match the configured authority. The configured authority port must match the fixed upstream socket port. Downstream SNI is checked before any upstream TCP connection is attempted.
- Upstream TLS verification failures after CONNECT return a tunneled 502 and do not start a capture. Tests reject both an untrusted root and a trusted certificate with the wrong hostname.
- Capture lifecycle ranges remain based on the existing parser callbacks; Upgrade response ranges can include later response-direction WebSocket bytes, as with the existing writer contract. Read-ahead is constrained by one-byte reads. `CaptureIo` records only successful reads and bytes accepted by partial or vectored writes, including `Pending` retries.
- Relay-level WebSocket Close timeout, disconnect without Close, and injected I/O error are all treated as unclean; the writer is not given a clean session to persist.

## Verification Results

Commands were run only in `/tmp/fusou-rama-integrated-sandbox`, a sanitized mirror with a placeholder configuration file. The protected repository configuration and verifier source were not used as build inputs.

| Check | Result |
| --- | --- |
| `cargo check --offline --locked --features rama-experimental --lib` | PASS |
| `cargo test --offline --locked --features rama-experimental --lib` | PASS — 77 passed, 0 failed |
| `cargo check --offline --locked --lib` (default Hudsucker path) | PASS |
| `rustfmt --check --edition 2024` on `src/proxy_server_https/rama_experimental.rs` | PASS |
| `rustfmt --check --edition 2024` on `src/capture_io.rs` | PASS |
| `cargo clippy --offline --locked --features rama-experimental --tests` | PASS with 21 existing library warnings and one additional existing test warning; no diagnostic points to `rama_experimental.rs`. |
| `cargo clippy --offline --locked --features rama-experimental --tests -- -D warnings` | FAIL — the same existing warnings in other proxy sources are promoted to errors. They were not mass-fixed as unrelated cleanup. |
| Package-wide `cargo fmt --check` | FAIL — reports formatting differences in other existing proxy-package files; the changed Rama module passes its direct formatter check. |

Coverage in the passing library tests includes:

- Same three HTTP/1.1 request fixtures through Hudsucker and Rama: keep-alive reuse, a chunked POST body, small writes, response association, exact client-facing request/response wire equality, and message offsets.
- Two concurrent Rama client connections: two separate captures with each request paired to its own response. The same test now sends a mismatched CONNECT authority and malformed HTTP client first, confirms 403 and 400 respectively, then verifies the listener still serves both valid clients.
- `CaptureIo` short and vectored partial writes with `Pending` retries: captures match only bytes accepted by the underlying writer, with no duplicates.
- Trusted local upstream TLS success; untrusted-root and hostname-mismatch rejection.
- CONNECT authority port/socket mismatch rejection; downstream SNI mismatch without upstream TCP accept or capture; upstream TLS failure returned as a tunneled 502 without capture.
- WebSocket HTTP/1.1 Upgrade, text and Close frames, exact downstream raw-wire capture, split-frame parsing, and rejection of incomplete/invalid close-frame state by the lifecycle predicate.
- Relay-level WebSocket sessions held open for longer than five seconds, one-sided Close timeout, disconnect without a Close handshake, and injected relay I/O failure. The abnormal cases are not considered clean and do not persist an artifact.

The all-target proxy test was not completed: the sanitized mirror does not contain the local example CA assets (`examples/ca/entity_key.pem` and `entity_cert.pem`) required to compile the example. No test assets or keys were copied into the repository.

## Remaining Work and Limitations

- Hudsucker/Rama WebSocket raw-capture parity is **NOT VERIFIED**. Rama's local WebSocket relay/capture test passes, but the existing Hudsucker regression test exercises HTTP/1.1 rather than WebSocket frames and lifecycle.
- Hudsucker/Rama WebSocket raw-capture parity remains **NOT VERIFIED**. The newly added abnormal WebSocket cases exercise Rama's relay/lifecycle and writer rejection; they do not add a Hudsucker WebSocket fixture.
- A full CONNECT/TLS/HTTP Upgrade end-to-end case that ends abnormally and proves the integrated session does not persist remains **NOT VERIFIED**; the new abnormal cases operate at the relay/lifecycle level.
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
