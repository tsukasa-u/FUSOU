# Rama Experimental Backend Status

## Decision

Rama is integrated as an optional experimental backend for side-by-side testing. It is not the default proxy and is not production-ready. The Hudsucker backend remains the normal runtime path. The Hudsucker fork remains in place and has a scoped WebSocket Upgrade lifecycle change; no TLSN fork is removed or changed.

The Rama implementation is compiled only with `rama-experimental`; no production configuration or runtime switch selects it.

## Existing Hudsucker Capture Contract

The proxy depends on the local `hudsucker` 0.23.0 fork. Its relevant FUSOU-specific API and use are:

| Extension | Current use |
| --- | --- |
| `HttpContext.connection_id` | Allocated once when Hudsucker accepts a TCP connection and reused for that connection's HTTP callbacks. |
| `ClientStreamHook::wrap` | Wraps the client-facing stream after downstream TLS termination and before Hyper parses it. FUSOU installs `RawCaptureHook`, which wraps it with `CaptureIo`. |
| Request/response callbacks | Record parsed-message metadata and offsets for ordinary HTTP messages. The WebSocket path now emits the 101 response start and completion callbacks at the Upgrade boundary. |
| `Body::with_completion` | Runs request/response completion callbacks when an ordinary body is consumed to completion; the 101 response uses the explicit Upgrade lifecycle instead. |
| `finish_with_status` | Reports the HTTP connection service result only. The separate `websocket_completed` callback reports the relay outcome after both forwarding directions finish or the Close-handshake deadline expires. `connection_aborted` reports an interrupted detached tunnel/relay task, and `wait_for_background_tasks` lets graceful proxy shutdown join capture persistence. |

`CaptureIo` records successful reads as request-direction bytes and successfully accepted writes as response-direction bytes. These are downstream client-facing plaintext bytes, not TLS records and not bytes reconstructed from HTTP objects. The Hudsucker integration test compares the resulting transcript to the bytes written by the client and received by it.

For Hudsucker WebSocket Upgrade, the fork completes the verified upstream WebSocket handshake before constructing the downstream 101. It calls `response_started` before returning the 101 and calls `response_completed` when Hyper's Upgrade future resolves. If the HTTP connection-finish callback wins that race, `RawCaptureHook` closes the 101 range at the captured `\r\n\r\n` boundary. Either completion path seals and finalizes the HTTP artifact exactly once. The two relay directions are observed together; a clean outcome requires Close frames received from and forwarded to both peers without an I/O/protocol failure. The 10-second deadline starts only after a Close frame is seen. A peer disconnect or task failure is reported separately from HTTP artifact eligibility.

Hudsucker's `Proxy::start` now owns CONNECT tunnel and WebSocket forwarding tasks in a `JoinSet`. Graceful shutdown closes task admission, aborts and joins remaining tunnels, drains queued tasks, and waits for tracked capture writers. Each tracked task reports cancellation through the hook; the WebSocket task also reports an unclean result. The WebSocket relay child is itself owned by a `JoinSet`, so aborting its parent cannot leave a detached relay behind. If the outer `Proxy::start` future is aborted, Tokio drops the task set and aborts its children; capture finalization is scheduled independently and remains alive long enough to complete. Rama uses a `JoinSet` for upgraded relays, a completion guard that reports unclean on panic/abort, and the capture-session guard to schedule cleanup after connection-task cancellation. Graceful Rama shutdown joins those writers after cancelling and joining connections.

The capture contract is now explicit: an `ExactWireCapture` contains HTTP messages only. Its Upgrade artifact is eligible once the downstream request and client-facing 101 are complete and the upstream accepted the WebSocket handshake. Later relay success or failure does not retroactively change that completed HTTP exchange; relay health is a distinct lifecycle result, not a property asserted by the HTTP artifact. A completed 101 is therefore retained after a one-sided Close, disconnect, or relay protocol error, while an upstream handshake rejection returns 502 and produces no 101 artifact. `verify_natural_capture_review` separately requires a POST `/require_info` exchange with a 200 response, so a 101 cannot qualify as natural acceptance evidence. Local CONNECT/TLS/WebSocket tests compare each artifact to that backend's client-observed HTTP bytes, not to a reserialization of HTTP objects.

The fork's default features are `decoder`, `rcgen-ca`, and `rustls-client`. HTTP/2 is a separate `http2` feature included by `full`; the `proxy-https` dependency does not enable `full` or `http2`. The current Hudsucker builder enables HTTP/1 for its upstream connector. Its WebSocket path forwards messages using `tokio-tungstenite`. Both backends now archive only the same semantic HTTP scope: the client-facing Upgrade request and 101 response; upgraded frames are relayed but excluded. Semantic 101 parity is verified for the shared fixed key/handshake fixture. Byte-for-byte parity is not the contract: a captured comparison found different header order (`Connection`/`Upgrade`) and `Date` capitalization (`Date`/`date`). Each backend preserves and verifies its own client-observed bytes; no common serializer or header-order normalization was added.

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
7. For WebSocket upgrades, the observer wraps both upgraded I/O streams and incrementally validates frame framing and Close payloads (mask direction, reserved bits/opcodes, control-frame constraints, allowed status code, and UTF-8 reason). Once the downstream 101 completes, Rama closes the response range, seals the recorder, removes the capture session from the map, writes the HTTP artifact, and releases the captured byte buffers before frame relay continues. A clean relay requires a close event, both peers' valid Close frames, and no relay I/O error; an unclean outcome is reported separately and does not invalidate the completed HTTP artifact. Invalid frames rejected by Rama's WebSocket decoder propagate as relay errors. The observer does not supply transcript bytes—the downstream `CaptureIo` remains the sole raw capture source.
   The whole WebSocket lifetime is not bounded by an outer timeout. Rama's 10-second timeout applies only after a Close handshake begins; valid long-lived sessions are not cut off by an idle timeout. EOF, relay I/O error, or an incomplete one-sided Close is classified unclean. The same timeout semantics apply to the Hudsucker relay.
8. The existing writer remains selective for completed, valid HTTP sessions containing a request target with `/api_get_member/require_info`; WebSocket cleanliness is not an artifact eligibility condition. Both backends' CONNECT/TLS/Upgrade tests verify that handshake bytes and manifest ranges remain unchanged after clean and unclean relay outcomes. All tests are synthetic and are not game-server observations.

## Audit Regression Fixes

- Removed the five-second timeout around the whole WebSocket relay. The ten-second bound is only for a Close handshake after it starts; long-lived WebSocket sessions are not cut off solely for exceeding five seconds.
- Listener-level connection task errors and panics are logged while the accept loop continues. A malformed HTTP client followed by valid parallel clients verifies listener recovery.
- CONNECT authority and the single `Host` header must match the configured authority. The configured authority port must match the fixed upstream socket port. Downstream SNI is checked before any upstream TCP connection is attempted.
- Upstream TLS verification failures after CONNECT return a tunneled 502 and do not start a capture. Tests reject both an untrusted root and a trusted certificate with the wrong hostname.
- Both backends now use the same HTTP evidence boundary and eligibility rule: a completed client-facing request/101 exchange is finalized before frame relay and is retained regardless of later relay outcome. Hudsucker now establishes upstream WebSocket handshake success before sending downstream 101, reports clean/unclean relay completion through `ClientStreamHook`, and awaits both directions with the same Close-handshake deadline as Rama. The HTTP connection-finish fallback and response-completion callback race to finalize one shared session; map identity and removal ensure only one writer wins. Rama likewise seals, writes, and removes the session before frame relay. Each E2E test compares the artifact to that backend's actual client-observed bytes and asserts that frames and bytes after the 101 boundary are excluded. A common fixture confirms semantic parity; raw serialized byte parity is not required because header order and casing differ. Read-ahead is constrained by one-byte reads in Rama. `CaptureIo` records only bytes successfully read or accepted by partial/vectored writes, including `Pending` retries.
- `CaptureRecorder` uses a shared I/O gate to serialize each underlying read/write poll with `seal` and `release`. The recorder-state mutex is held only for capacity checks and capture updates, not while calling the wrapped I/O. This keeps seal ordering deterministic without holding the state lock across transport code; if a response write succeeds but capture state becomes unavailable, the adapter returns the accepted byte count rather than retrying forwarded bytes. Separate read/write race tests exercise that boundary.
- The original full library run exposed a deadlock in `post_write_capture_failure_does_not_retry_forwarded_response`: the injected writer poisoned the recorder-state mutex while the adapter held it across the inner write poll. The shared I/O gate removed that lock inversion. The final feature-enabled library suite passed all 111 tests.
- A finalized recorder releases its captured buffers even while the sealed I/O wrapper remains alive for WebSocket relay. E2E tests assert that both backend session maps are empty before post-Upgrade frames are sent.
- Relay-level WebSocket Close timeout, disconnect without Close, and injected I/O error are classified unclean. Their completed HTTP handshake artifacts remain eligible; incomplete/non-Upgrade sessions are still rejected.
- Hudsucker CONNECT/TLS/Upgrade E2E cases cover clean Close, one-sided Close, client/upstream disconnect during a partial WebSocket frame, invalid upstream frame, failed upstream handshake, injected forwarder read/write I/O errors, a forwarder-task panic, graceful proxy shutdown with an open WebSocket, and outer `Proxy::start` task abort. `fork_proxy_shutdown_aborts_open_websocket_and_keeps_handshake_artifact` and `fork_proxy_outer_task_abort_closes_websocket_and_reports_unclean` assert 101 completion, the already-persisted handshake artifact, unclean notification, client/upstream socket closure, empty session map, released recorder payload, and writer completion. In the client partial-frame case, only a protocol Close control frame or EOF/error may reach upstream; incomplete application-frame bytes are rejected. The injected read/write faults enter through the test-only `WebSocketHandler` boundary after the real 101; they are not kernel-level fault simulations. The panic case exercises the `JoinError` path and verifies listener responsiveness. `completed_upgrade_artifact_is_stable_across_callback_orderings` deterministically checks that finish-before-response-completion and the reverse produce identical bytes, ranges, eligibility, session removal, and recorder release.
- Rama CONNECT/TLS/Upgrade E2E cases cover clean Close, one-sided Close, client/upstream disconnect during a partial WebSocket frame, and invalid continuation. `shutdown_aborts_open_websocket_and_keeps_handshake_capture` and `outer_task_abort_closes_websocket_and_reports_unclean` exercise graceful listener shutdown and cancellation of the outer `serve_with_capture_hook` future after 101. They assert client/upstream socket closure, exactly one unclean relay result, handshake artifact stability, empty session map, released recorder payload, and capture-writer completion. For completed 101 cases, both backends assert handshake-only bytes/ranges, session-map removal, and a separate clean/unclean outcome. The invalid-continuation test persists and verifies the completed handshake artifact before and after relay failure, and separately asserts that the invalid frame does not reach upstream. No-artifact assertions in the relay-only helper apply only when there was no completed HTTP handshake. A failed Hudsucker upstream handshake produces 502 rather than downstream 101 and no 101 artifact.
- The loopback disconnect cases use real local TCP/TLS sockets and actual FIN/EOF/close behavior, including disconnect after a partial frame; they are not injected handler errors. Kernel-generated RSTs, process termination, and every possible scheduler interleaving are not simulated by these tests.
- `CaptureIo` read/write seal races and release of sealed buffers have direct regression tests.
- `CaptureIo` read tests now cover bounded partial reads, a `Pending` retry, and an error after successfully captured partial bytes. Both `CaptureIo` and the WebSocket observer have `ExtensionsRef` delegation tests using marker values that survive the wrapper move.
- `ExactWireMetadata::from_components` has a direct test for preserving duplicate headers, order, and whitespace bytes.

## Verification Results

Commands were run only in `/tmp/fusou-rama-integrated-sandbox`, a sanitized mirror with a placeholder configuration file. The protected repository configuration and verifier source were not used as build inputs.

| Check | Result |
| --- | --- |
| `cargo test --offline --locked --lib --features rama-experimental` | PASS in the independent task-admission audit — 112 passed, 0 failed, 0 ignored. |
| Hudsucker fork `cargo test --offline --locked --lib` | PASS in the independent task-admission audit — 25 passed, 0 failed. |
| `cargo check --offline --locked --lib --features rama-experimental` | PASS in the independent task-admission audit. |
| `cargo check --offline --locked --lib` (default Hudsucker path) | PASS in the independent task-admission audit. |
| `cargo clippy --offline --locked --tests --features rama-experimental` | PASS in the independent task-admission audit with 21 existing library warnings; no warning points to the new task-lifecycle tests or the new capture-admission test. |
| `cargo clippy --offline --locked --tests --features rama-experimental -- -D warnings` | FAIL in the independent task-admission audit — the 21 existing library warnings are promoted to errors; none points to the new task-lifecycle or capture-admission test code. |
| `rustfmt --edition 2021 --check` on `hudsucker-fork/src/proxy/internal.rs` and `proxy-https/src/proxy_server_https.rs` | PASS in the independent task-admission audit. Stable rustfmt warns that two repository-config options require nightly. |
| `git diff --check -- <seven scoped proxy paths>` | PASS in the independent task-admission audit; exit code 0, scoped to the seven allowed paths. |
| `cargo test --offline --locked --all-targets` | BLOCKED — the sanitized mirror lacks `examples/ca/entity_key.pem` and `examples/ca/entity_cert.pem`, required by `examples/example.rs`; no CA asset or key was copied. |

Coverage in the passing library tests includes:

- Same three HTTP/1.1 request fixtures through Hudsucker and Rama: keep-alive reuse, a chunked POST body, small writes, response association, exact client-facing request/response wire equality, and message offsets.
- Two concurrent Rama client connections: two separate captures with each request paired to its own response. The same test now sends a mismatched CONNECT authority and malformed HTTP client first, confirms 403 and 400 respectively, then verifies the listener still serves both valid clients.
- `CaptureIo` short and vectored partial writes with `Pending` retries, plus short reads, read-side `Pending`, and a transport error after partial bytes: captures contain only successfully transferred bytes, in order, without retries duplicated. New checks cover flush/shutdown `Pending` retries and errors, and prove sealed Upgrade capture continues bidirectional I/O without recording WebSocket frames.
- `CaptureIo` and the upgraded WebSocket observer both preserve access to the inner Rama extensions.
- Trusted local upstream TLS success; untrusted-root and hostname-mismatch rejection.
- CONNECT authority port/socket mismatch rejection; downstream SNI mismatch without upstream TCP accept or capture; upstream TLS failure returned as a tunneled 502 without capture.
- Rama WebSocket HTTP/1.1 Upgrade, text and Close frame relay, handshake-only HTTP raw capture with exact client-observed bytes and manifest ranges, split-frame parsing, maximum/oversized control payloads, invalid status codes, invalid UTF-8 reasons, mask/RSV/opcode violations, and post-Close bytes.
- Relay-only WebSocket tests cover sessions held open for longer than five seconds, one-sided Close timeout, disconnect without a Close handshake, and injected relay I/O failure. These tests have no completed HTTP handshake; their no-artifact assertion applies only to that pre-handshake state.
- CONNECT/TLS/Upgrade end-to-end one-sided Close and invalid continuation: both persist the already completed handshake-only artifact, and the relay result is reported unclean. The invalid continuation is rejected before it reaches upstream; request/101 bytes and both manifest ranges are verified before and after the relay failure.
- Hudsucker CONNECT/TLS/WebSocket end-to-end characterization: text and Close frames relay, while the final artifact contains only the HTTP Upgrade request and client-facing 101 response with request and response message entries.
- Hudsucker injected read/write errors and child-task panic after the observed 101: each reports an unclean relay while retaining the completed HTTP handshake artifact. These are deterministic test-boundary faults, not proof of every operating-system socket error mode.
- Real loopback TCP/TLS client and upstream disconnects after Upgrade, including partial-frame EOF, are exercised independently from handler-boundary injected I/O faults. Graceful proxy shutdown and explicit outer-task abort are also exercised for both backends; the tests check peer socket closure separately from session-map removal and recorder-buffer release.
- Deterministic Hudsucker callback-order test: HTTP finish before response completion and response completion before finish yield the same artifact bytes, manifest ranges, eligibility, map cleanup, and released recorder payload.
- Direct `ExactWireMetadata::from_components` test for duplicate-header order and original whitespace bytes.
- `ExactWireMetadata::is_websocket_upgrade_request` recognizes a GET with `Upgrade: websocket` and a `Connection` Upgrade token. The Hudsucker upstream-rejection E2E verifies that an upstream 403 mapped to downstream 502 does not create a WebSocket capture artifact; only a completed 101 qualifies for this Upgrade artifact.

## Task, Socket, and Idle Policy

- At the completed 101 boundary, the session map entry is removed, the HTTP transcript is sealed and persisted, and the recorder payload is released. This does **not** end the WebSocket relay: an open connection can still own a relay task, downstream and upstream TCP/TLS sockets, and protocol/TLS buffers.
- Hudsucker graceful shutdown closes background task admission, aborts and joins the remaining CONNECT/Upgrade tasks, then waits for capture writers. Outer `Proxy::start` cancellation drops its `JoinSet`, which aborts child tasks; the cancellation callback reports an unclean relay and schedules capture cleanup. The E2Es `fork_proxy_shutdown_aborts_open_websocket_and_keeps_handshake_artifact` and `fork_proxy_outer_task_abort_closes_websocket_and_reports_unclean` exercise these two paths and verify both client and upstream socket closure.
- Rama graceful shutdown aborts and joins connection tasks; each `run_tunnel` owns WebSocket relays in a `JoinSet`. Dropping an active relay reports unclean through `WebSocketCompletionGuard`, while `CaptureSessionGuard` schedules session finalization. The server waits for capture writers after joining connections. `shutdown_aborts_open_websocket_and_keeps_handshake_capture` and `outer_task_abort_closes_websocket_and_reports_unclean` verify listener shutdown and cancellation of the outer server future separately.
- Open WebSockets have no idle timeout in either backend. One indefinitely idle session can retain two sockets, a relay task, and transport/protocol buffers, although its sealed HTTP capture session and captured payload are already released. Aggregate resource use can grow with the number and duration of open sessions. The existing ten-second deadline begins only after a Close handshake starts; EOF/disconnect and proxy shutdown terminate the tested sessions.
- Do not add an arbitrary idle timeout. A future policy needs measured game-session duration/traffic, acceptable reconnect behavior, and per-process socket/task/memory budgets so it does not cut off valid long-lived gameplay. Until those inputs exist, idle cleanup remains **UNVERIFIED** and an operational risk, not an implicit acceptance claim.

## Analyzer Gap Crosswalk

### Provenance and Replay

- The original full JSON output was recovered from `/tmp/1792416295110-copilot-tool-output-6620-91e44576-2bb9-49ba-bacf-8e34b728e7b0.txt`. Its summary is five changed files, 31 changed functions/classes, zero affected flows, 21 test gaps, and risk score 0.60. The 21 original names are itemized below; none were invented from the current source.
- The historical scoped snapshot path embedded in that output (`/tmp/fusou-scoped-audit-rjje0m6o/repo`) no longer exists. The exact original command, analyzer database, and fifth path are not recorded. The four source paths present in the JSON are `capture.rs`, `capture_io.rs`, `proxy_server_https.rs`, and `proxy_server_https/rama_experimental.rs`.
- The currently installed analyzer is `code-review-graph 2.3.6`. The current `scripts/scoped_code_review_graph.py` wrapper builds a temporary repository from staged paths, runs `update --base HEAD~1`, then `detect-changes --brief --base HEAD~1`. The recovered historical output is full JSON, so it cannot be proven to have come from this exact wrapper invocation.
- An approximate replay was run with explicit five-path snapshots reconstructed from `d2dfdc9f163b5ee9d874467107a44996bad50eb0..ff1f0b6cada220e8d81407dba7ae02d342ac7f2f`; the fifth path was `RAMA_MIGRATION_PLAN.md`, inferred from that commit's scoped diff. Commands:

  ```text
  code-review-graph update --repo <temporary five-path snapshot> --base HEAD~1
  code-review-graph detect-changes --repo <temporary five-path snapshot> --base HEAD~1
  ```

  This replay completed but returned 114 changed functions/classes, zero flows, 102 gaps, and risk 0.60. Since that differs from the recovered 31/21 output and the original snapshot/database is gone, the exact historical analyzer run is **NOT_REPRODUCIBLE**. The replay is not represented as a reproduction; the table below is an independent source-and-assertion audit of the recovered items against the current source.

### Item-by-Item Audit

| # | Original analyzer item | Disposition | Code path, assertions, and limits |
| --- | --- | --- | --- |
| 1 | `AsyncRead` | `COVERED` | `capture_io.rs` `CaptureIo::poll_read`; `captures_split_reads_exactly_across_pending_retries` and `retains_only_successfully_read_bytes_when_later_read_fails` assert captured successful bytes and exclude failed/Pending retries. |
| 2 | `poll_read` | `COVERED` | `sealing_capture_preserves_io_without_recording_upgrade_stream_bytes` and `seal_waits_for_in_flight_read_and_keeps_its_received_bytes` assert post-seal pass-through and deterministic seal/read ordering. |
| 3 | `AsyncWrite` | `COVERED` | `capture_io.rs` `CaptureIo::poll_write`; partial and vectored-write tests assert only accepted bytes are recorded in order. |
| 4 | `poll_write` | `COVERED` | `captures_only_bytes_accepted_by_partial_writes_after_pending`, `vectored_partial_writes_and_pending_retries_preserve_exact_order`, `post_write_capture_failure_does_not_retry_forwarded_response`, and `seal_waits_for_in_flight_write_and_keeps_its_accepted_bytes` cover partial, Pending, failure, and seal races. |
| 5 | `poll_flush` | `COVERED` | `flush_and_shutdown_forward_pending_retries` and `flush_and_shutdown_propagate_transport_errors` assert Pending retry and error propagation. |
| 6 | `poll_shutdown` | `COVERED` | The same tests separately assert shutdown Pending retry and transport-error propagation. |
| 7 | `CaptureIoTestExtension` | `COVERED` | `delegates_rama_extensions_reference` checks that the typed marker remains accessible through the wrapper. |
| 8 | `ScriptedReadIo` | `COVERED` | This is a test-only fixture used by split-read/Pending and partial-read-error tests; those tests assert resulting capture bytes. It is not a production I/O branch. |
| 9 | `ScriptedReadIo::new` | `COVERED` | The constructor's scripted actions are consumed by the read tests above; the observable read/capture results are asserted. |
| 10 | `read_websocket_frame` | `COVERED` | This is a test fixture helper in `proxy_server_https.rs`; CONNECT/TLS tests assert returned opcode/payload and exact frame bytes for data and Close frames. Malformed-frame behavior is tested in the Rama parser, not this helper. |
| 11 | `fork_proxy_captures_only_websocket_upgrade_handshake_bytes` | `COVERED` | The named item is itself an existing `#[tokio::test]`; it asserts client-observed request/101 wire bytes, two manifest message entries, and exclusion of relayed frames. The analyzer's “gap” label is a false positive for missing test coverage. |
| 12 | `mark_protocol_failure` | `COVERED` | `observer_rejects_invalid_frames_and_marks_partial_eof_unclean` asserts `InvalidData` and the failure flag; `invalid_continuation_through_connect_persists_handshake_capture` additionally proves the invalid frame is not forwarded upstream and the completed HTTP artifact remains. |
| 13 | `PendingWebSocketFrame` | `PARTIALLY_COVERED` | `WebSocketFrameParser` tests exercise split payload state, masking offsets, data before Close, and partial-frame EOF. They do not exhaust every extended-length/data-frame state transition. |
| 14 | `WebSocketFrameParser` | `PARTIALLY_COVERED` | Parser tests cover split Close frames, payload limits, status/UTF-8 validation, reserved bits/opcodes, and post-Close bytes. This observer validates framing/Close state, not every RFC 6455 data/fragmentation rule; Rama's decoder owns continuation validation. |
| 15 | `WebSocketFrameParser::new` | `COVERED` | Parser tests instantiate both mask modes and assert masked downstream and unmasked upstream Close frames are accepted. |
| 16 | `observe` | `PARTIALLY_COVERED` | The tests above cover valid split input, malformed control/Close frames, and bytes after Close. They do not establish every parser/scheduler interleaving or kernel-generated transport fault. |
| 17 | `valid_close_payload` | `COVERED` | `rejects_invalid_close_codes_reasons_and_control_frames` asserts empty and valid payloads, invalid status codes, one-byte payloads, and invalid UTF-8 reasons. |
| 18 | `WebSocketObserverTestExtension` | `COVERED` | `websocket_observer_delegates_rama_extensions_reference` asserts typed extension access through the observer. |
| 19 | `masked_close` | `COVERED` | This is a test-only frame builder exercised by split-frame, payload-limit, and invalid-Close parser assertions; it is not a production framing path. |
| 20 | `serve_with_capture_hook` | `PARTIALLY_COVERED` | Rama loopback CONNECT/TLS tests cover HTTP/1.1 capture, valid Upgrade, disconnects, shutdown, outer abort, and upstream handshake rejection. All kernel RST patterns and arbitrary scheduler/cancellation interleavings remain outside this evidence. |
| 21 | `abnormal_websocket_close_through_connect_does_not_persist_capture` | `NOT_REPRODUCIBLE` | **Historical item:** its function, source snapshot, and original test result are unavailable, so that historical expectation cannot be reproduced. **Current contract:** `abnormal_websocket_close_through_connect_persists_handshake_capture` verifies that a completed request/101 artifact persists unchanged after an unclean relay. The historical “does not persist” expectation is not the current contract and is not treated as a current implementation defect. |

The all-target proxy test `cargo test --offline --locked --all-targets` was attempted in an earlier validation and could not compile the example because the sanitized mirror lacked `examples/ca/entity_key.pem` and `examples/ca/entity_cert.pem`. No test assets or keys were copied. It was not rerun in this audit.

## Independent Audit: Task Admission and Cleanup

The Hudsucker fork was tested directly as well as through the proxy crate. Its closed-channel tests use a local upstream WebSocket fixture; no external endpoint is involved.

| Gap heuristic | Current evidence and disposition |
| --- | --- |
| `TrackedProxyTask::new`: ownership and completion | `completed_task_does_not_run_cancellation_callback`, `abort_reports_cancellation_once_and_join_reaps_task`, and `panic_reports_cancellation_once_as_join_failure` create and register the tracked future in a `JoinSet`. They assert normal `JoinSet` completion and no cancellation callback, or the corresponding cancelled/panicked `JoinError`, task reaping, and exactly one callback. The manager's receive-to-`JoinSet::spawn` path is source-traced in `Proxy::start`; exhaustive scheduler interleavings around shutdown are not established by these unit tests. |
| `TrackedProxyTask::disarm` | `disarm_drops_task_future_without_running_cancellation_callback` directly asserts that the future is dropped and its callback is not invoked. The CONNECT and WebSocket closed-manager tests exercise `disarm` at actual failed channel admission. Normal completion, panic, and cancellation remain distinguishable through the tracked future and `JoinSet` result. |
| `service_unavailable` — CONNECT | `process_connect::returns_service_unavailable_when_task_manager_is_closed` exercises the branch and asserts HTTP 503. The failed send's task is disarmed; the separate `disarm` unit test asserts no cancellation notification. CONNECT does not create a completed Upgrade artifact. |
| `service_unavailable` — WebSocket | `upgrade_websocket::returns_service_unavailable_when_task_manager_is_closed` completes a loopback upstream WebSocket handshake, asserts the client-facing method returns 503, and verifies the unadmitted task releases the upstream socket without forwarding a WebSocket message. The implementation emits the 503 response-start callback and never returns the prepared 101 response. |
| 503 capture eligibility and release | `unavailable_websocket_task_admission_releases_ineligible_capture` drives `RawCaptureHook` through `CaptureIo` with an Upgrade request and a client-facing 503. It asserts exact transferred request/response bytes, no artifact without a completed 101, session-map removal, and empty recorder snapshots. It tests the capture boundary separately from the fork's admission branch; it is not a single cross-crate end-to-end admission test. |
| Admission/shutdown timing | The manager closes admission, aborts and joins tracked tasks, then drops queued tasks during shutdown. A task already received is owned by the `JoinSet`; a queued task remains owned by the channel and its `Drop` callback runs when drained. The branch behavior is source-traced, but all possible send/close scheduler interleavings are **UNVERIFIED**; a deterministic test of each runtime scheduling interleaving would not establish kernel-level behavior. |
| `service_unavailable` helper itself | Directly testing the helper's empty 503 construction separately has low value: the two branch tests assert the returned status, and the WebSocket branch also checks the upstream-side effect. |

The commit-time scoped analyzer reported five symbol-level heuristics. They were mapped back to actual code rather than treated as missing production coverage:

| Analyzer heuristic | Classification | Evidence |
| --- | --- | --- |
| `Drop` / `drop` | **Existing unit coverage** for `TrackedProxyTask` cancellation and explicit task-future disposal; the remaining `drop` calls are ownership operations, not independent production branches. | `completed_task_does_not_run_cancellation_callback`, `abort_reports_cancellation_once_and_join_reaps_task`, `panic_reports_cancellation_once_as_join_failure`, and `disarm_drops_task_future_without_running_cancellation_callback`. |
| `upgrade_websocket` | **Existing unit and E2E coverage**; the symbol is not an uncovered branch. | Direct missing-authority/header and closed-manager tests, plus `fork_proxy_captures_only_websocket_upgrade_handshake_bytes`, the injected relay-failure cases, upstream-handshake rejection, and callback-ordering E2E. |
| `build_proxy` | **Low-value test helper detail**, not production behavior. Its closed receiver setup is exercised by CONNECT/WebSocket admission tests. | `process_connect::returns_service_unavailable_when_task_manager_is_closed` and `upgrade_websocket::returns_service_unavailable_when_task_manager_is_closed`. |
| `DropCounter` | **Test instrumentation**, directly exercised rather than an untested production symbol. | `disarm_drops_task_future_without_running_cancellation_callback` asserts its destructor count is one. |

This five-symbol commit-time list is separate from the recovered original 21-item output above. The 21 current-source dispositions are recorded item by item; the exact historical analyzer replay remains **NOT_REPRODUCIBLE** because its source snapshot and invocation are unavailable.

The commit hook for `ad331838a` separately reported five symbol-level gaps (`serve`, `is_websocket_upgrade_attempt`, `AbnormalWebSocketCase`, `upstream_websocket_handshake_failure_returns_502_without_capture`, and `run_abnormal_websocket_capture`). The new invalid-handshake test invokes `serve` and now covers both an explicit `Upgrade: websocket` header and WebSocket metadata without an `Upgrade` header; each malformed request returns 400 without calling upstream. The other three names are the test case enum, the test itself, and its fixture helper; the upstream-rejection E2E exercises that path and asserts 502, session cleanup, and no artifact. This hook output is separate from the recovered 21-item list; the uncovered detector branch has been covered by the follow-up test, while the remaining symbol-name gaps are test-mapping false positives.

The earlier WebSocket lifecycle E2Es remain distinct evidence: real loopback TCP/TLS FIN/EOF disconnect and shutdown cases verify peer socket closure, while handler-boundary injected faults verify relay error handling. Neither class proves every kernel RST or scheduler interleaving. Session-map removal, recorder-buffer release, task reaping, and peer socket closure are asserted separately where the named tests expose each resource.

## Hudsucker/Rama WebSocket Request Validation

Hudsucker previously dispatched only requests accepted by `hyper_tungstenite::is_upgrade_request`, which requires both `Connection: Upgrade` and an `Upgrade: websocket` token. Missing either header therefore fell through to ordinary upstream HTTP forwarding. Its `hyper_tungstenite::upgrade` call checks the WebSocket key and version, but does not validate the `Connection` or `Upgrade` headers itself. Hudsucker now classifies a WebSocket attempt from either the `Upgrade: websocket` token or one of the standard request metadata headers (`Sec-WebSocket-Key`, `Sec-WebSocket-Version`, `Sec-WebSocket-Protocol`, or `Sec-WebSocket-Extensions`), then requires `is_upgrade_request` before calling `hyper_tungstenite::upgrade` or connecting upstream.

| Input | Hudsucker result | Direct evidence |
| --- | --- | --- |
| Missing `Sec-WebSocket-Key`, with Upgrade and Connection headers | 400 before upstream connect; `hyper_tungstenite::upgrade` rejects the missing key. | `fork_proxy_rejects_missing_websocket_key_before_upstream_accept` asserts 400 and zero loopback accepts. |
| `Sec-WebSocket-Key` and `Sec-WebSocket-Version` without an Upgrade header | 400 before upstream connect; the attempt classifier prevents ordinary HTTP fallback, then the required Upgrade check rejects it. | `fork_proxy_rejects_websocket_metadata_without_upgrade_before_upstream_accept` asserts 400 and zero loopback accepts. |
| Missing `Connection: Upgrade` | 400 before upstream connect; the attempt classifier dispatches it to WebSocket validation, which rejects the incomplete header pair. | `fork_proxy_rejects_missing_connection_upgrade_before_upstream_accept` asserts 400 and zero loopback accepts. |
| Unsupported WebSocket version | 400 before upstream connect; `hyper_tungstenite::upgrade` accepts only version 13. | `fork_proxy_rejects_unsupported_websocket_version_before_upstream_accept` asserts 400 and zero loopback accepts. |
| Ordinary HTTP request | Continues through the ordinary upstream HTTP client path. | `fork_proxy_captures_persistent_tls_plaintext_without_retry` verifies three proxied HTTP exchanges and their captured bytes. |
| Valid WebSocket Upgrade | Client-facing 101 is returned only after the upstream WebSocket handshake succeeds. | `fork_proxy_captures_only_websocket_upgrade_handshake_bytes` and `fork_proxy_upstream_handshake_failure_does_not_send_101_or_capture`. |

The four malformed-request E2Es use the real Hudsucker proxy listener and intercepted loopback CONNECT/TLS connections. They assert the client-facing 400, a loopback upstream TCP accept count of zero, no 101 response artifact, no WebSocket outcome, eventual session-map removal, and recorder-buffer release. The tests wait for the session writer to release the retained recorder; they do not require that a non-101 ordinary HTTP error transaction can never be recorded.

Rama uses `is_websocket_upgrade_attempt` and calls `validate_http_client_request` before invoking the upstream WebSocket service. `rejects_invalid_websocket_handshakes_before_upstream_service` covers missing key, metadata without Upgrade, missing Connection, and unsupported version, asserting 400 and zero upstream-service calls. That is direct service-boundary evidence, not a TCP accept-counter test. The tested malformed cases now have matching pre-upstream rejection behavior; broader RFC validation parity is not established. Both backends keep their own client-observed wire bytes; byte-for-byte response formatting parity is not required.

## Remaining Work and Limitations

- Synthetic HTTP artifact scope, complete 101 boundaries, manifest ranges, and exclusion of post-Upgrade frames are **VERIFIED** for the tested Hudsucker and Rama paths. Each artifact matches its backend's client-observed bytes.
- Clean/unclean relay classification and independent HTTP artifact eligibility are **VERIFIED** for clean Close, one-sided Close, client disconnect, upstream disconnect, and malformed-frame cases exercised through CONNECT/TLS/Upgrade. Hudsucker's explicit `websocket_completed` callback reports these outcomes independently of `finish_with_status`.
- Hudsucker's injected forwarder read/write I/O failures and child-task panic/`JoinError` are **VERIFIED** through the CONNECT/TLS/Upgrade E2E at the WebSocket handler boundary. Real loopback TCP/TLS FIN/EOF disconnect, graceful shutdown, and explicit outer-task abort are **VERIFIED** for the named tests; kernel-generated RSTs and arbitrary scheduler/cancellation interleavings remain **UNVERIFIED**. Handler-boundary faults must not be represented as operating-system fault injection.
- HTTP/1.1 101 semantic parity is **VERIFIED** for the shared synthetic fixture. Byte-for-byte parity is **NOT_REQUIRED** by the current capture contract and was **OBSERVED** to differ in header order/casing. Each artifact is tested against the exact bytes its own client observed.
- Upgrade capture session-map cleanup before relay completion and finalized buffer release are **VERIFIED**. This is separate from socket/task lifetime: completed or injected-failure relay tasks terminate in the tested cases, but a valid open WebSocket can retain its task/socket indefinitely because there is intentionally no idle timeout. Rama's Close-handshake deadline starts only after a Close frame begins.
- HTTP/2 is not enabled in the current Hudsucker dependency configuration and is not implemented or tested by this Rama experiment.
- Rama's experimental configuration is intentionally fixed to one canonical authority and socket address. It is not connected to production target selection, Origin Inventory, or Target Approval.
- The Rama backend still uses the Hudsucker fork's certificate-authority trait and implementation. Removing that dependency requires a separately reviewed CA/certificate-cache design.
- `CaptureLimits::default()` remains unbounded. A production cap and the behavior on limit exhaustion need a separate policy decision; introducing an arbitrary cap could change ordinary HTTP relay behavior.
- Hudsucker and Rama's tested malformed WebSocket attempts are rejected before upstream connection/service dispatch as detailed in “Hudsucker/Rama WebSocket Request Validation.” This evidence does not establish every RFC handshake validation edge case.
- `upstream_websocket_handshake_failure_returns_502_without_capture` uses a local TLS upstream that rejects the WebSocket handshake with 403; the proxy returns 502, removes the capture session, and writes no artifact. Hudsucker's corresponding 403 case is covered by `fork_proxy_upstream_handshake_failure_does_not_send_101_or_capture`.
- The original analyzer output is recovered and all 21 items have current-source dispositions above. The exact historical replay is **NOT_REPRODUCIBLE**; the approximate replay differed and must not be presented as confirmation of the original 21-item result.
- No production deployment, real game-server, external-service, or real-gameplay validation was performed. The backend must not be described as production accepted.

## This Audit's Local Validation

Commands ran from the sanitized mirror; no production endpoint, Notary, R2, external CI, or example CA material was used.

| Command | Result |
| --- | --- |
| `cargo test --offline --locked --lib` (`hudsucker-fork`) | PASS — 25 passed, 0 failed. |
| `cargo test --offline --locked --lib --features rama-experimental` (`proxy-https`) | PASS — 118 passed, 0 failed, including four loopback Hudsucker malformed-Upgrade cases. |
| `cargo check --offline --locked --lib --features rama-experimental` (`proxy-https`) | PASS. |
| `cargo check --offline --locked --lib` (`proxy-https`) | PASS. |
| `cargo clippy --offline --locked --tests --features rama-experimental` (`proxy-https`) | PASS, exit 0; 21 existing warnings, none in the new Hudsucker validation/test hunks. |
| `cargo clippy --offline --locked --tests` (`hudsucker-fork`) | PASS, exit 0; one existing `needless_borrow` warning at `src/proxy/internal.rs:655`, outside the changed lines. |
| `rustfmt --check --edition 2021 packages/FUSOU-PROXY/hudsucker-fork/src/proxy/internal.rs packages/FUSOU-PROXY/proxy-https/src/proxy_server_https.rs` | PASS. |
| `git diff --check` scoped to the two Rust files and this migration plan | PASS. |

Strict Clippy with `-D warnings` was not rerun in this audit. The earlier recorded strict attempt failed on pre-existing diagnostics in `capture.rs`, `capture_io.rs`, and unrelated lines of `proxy_server_https.rs`; the standard Clippy runs above pass.

The four Hudsucker E2Es directly check the response status and loopback accept count; the full 118-test run also exercises the existing ordinary-HTTP and valid-WebSocket controls. The all-target example test was not rerun here; the earlier recorded CA asset blocker remains, and no keys or certificates were copied.

## Migration Gate

Keep Hudsucker as the default until all of the following are completed:

1. Preserve the tested HTTP-only Upgrade boundary: request and 101 handshake bytes are captured; upgraded WebSocket frames are relayed but are not part of this artifact. Add a separate evidence format only if frame capture becomes a requirement.
2. The current source-derived audit now adjudicates the recovered 21 names, but the exact historical analyzer run remains **NOT_REPRODUCIBLE**. If the analyzer summary is still an acceptance gate, rerun it against a saved, explicitly scoped snapshot with the invocation and database provenance preserved. Treat handler-boundary faults as scoped evidence; add kernel-level fault tests only if that stronger transport claim is required.
3. Replace the Hudsucker CA dependency with a reviewed implementation or adapter before removing the fork.
4. Decide and test a bounded `CaptureLimits` policy before production adoption; do not silently cap only one backend.
5. Re-run proxy tests and strict lint/format checks after separately addressing the repository's pre-existing diagnostics.

The optional Rama backend now exposes an explicit `serve_with_experimental_tlsn_dependencies` entry point. Its `rama-experimental` feature enables Rama's existing HTTP/hyperium conversion bridge at the adapter boundary. The entry point uses the same one-shot `require_info` route and backend-neutral `ExperimentalRequireInfoForwarder` as Hudsucker; the default `serve` path remains TLSN-disabled. APP startup is still wired only to Hudsucker, and this adapter does not establish real-game or Production evidence. TLSN dependencies, forks, Presentation, Verifier, and Notary were not changed.

The experimental Rama `require_info` path caps body collection at 128 KiB and applies a 30-second collection deadline. The 128 KiB value is the existing serialized HTTP request ceiling, not a permitted body size: request-line, headers, and the binding header also consume that budget, and the serializer checks the complete wire length before allocating its output buffer. A blocked one-shot request, oversized or failed body, and body timeout fail closed with `Connection: close`; the unread remainder is dropped rather than drained. This limit is specific to the selected experimental TLSN route and does not bound ordinary HTTP relay capture. Synthetic service tests and a local HTTP/1 framing test were added; they are not real-game TLSN evidence, and Cargo tests remain unverified where the repository's protected configuration read prevents safe compilation.
