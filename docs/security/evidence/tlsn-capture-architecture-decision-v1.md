# TLSNotary Capture Architecture Decision v1

Status: architecture decision recorded; minimal fork integration implemented
for synthetic proof only. This document does not authorize production capture,
TLSNotary runtime integration, or a Phase 0 gate transition.

## Decision

**Selected option: `FORK`.** Maintain a small FUSOU-owned fork of hudsucker
0.23.0 with a per-CONNECT server-stream hook. The hook MUST run after the
client-facing MITM TLS accept succeeds and before Hyper receives the stream for
HTTP parsing.

The repository-local fork is at `packages/FUSOU-PROXY/hudsucker-fork` and is
selected by the `proxy-https` path dependency. Its `ClientStreamHook` runs at
the selected boundary. FUSOU's `RawCaptureHook` wraps the stream with
`CaptureIo<IO>` and writes private exact-wire artifacts after connection
finalization. This is an implementation-level synthetic proof, not natural
evidence or production approval.

## Required byte provenance

The target transcript remains:

```text
natural Game Client
  -> client-facing TCP
  -> hudsucker CONNECT upgrade
  -> MITM TLS accept/decrypt
  -> CaptureIo plaintext read/write hook
  -> Hyper HTTP parser and FUSOU HttpHandler
  -> upstream proxy client
```

The request bytes are the bytes read from the accepted server-side TLS stream
before Hyper parses them. The response bytes are the bytes written to that same
stream by Hyper before rustls encrypts them for the client. The capture layer
MUST NOT be placed below `TlsAcceptor::accept`, because that would record
client-facing TLS ciphertext rather than HTTP plaintext.

The evidence source is constrained separately from the byte boundary. Natural
evidence means ordinary FUSOU-APP startup and gameplay through the supported
Game Client and allowlisted Game Server. The hook observes that traffic only; it
does not issue a standalone request, inject a request into the client, replay a
capture, or retry a forwarded request. Synthetic integration traffic proves the
capture mechanism, not natural provenance. The repository currently does not
identify the exact gameplay action that first produces `require_info`, so that
fact must come from a manual controlled observation.

## Source-backed comparison

The comparison uses the resolved hudsucker 0.23.0 source in the local Cargo
registry and the current FUSOU source.

| Option | Source boundary | Preserves current hudsucker behavior | Natural client-facing bytes | Decision |
| --- | --- | --- | --- | --- |
| `FORK` | Patch `InternalProxy::process_connect` after `TlsAcceptor::accept` and before `InternalProxy::serve_stream` | Yes; CONNECT detection, certificates, Hyper server setup, HTTP/WebSocket handling, and existing handlers remain in place | Yes, with a per-stream plaintext wrapper | **Selected** |
| `REPLACEMENT` | FUSOU owns CONNECT upgrade, protocol sniffing, TLS accept, stream wrapping, Hyper connection setup, and lifecycle handling | No; those responsibilities must be reproduced and kept compatible | Yes, if the replacement is correct | Rejected for v1; migration fallback only |
| `SEPARATE_LAYER` | A custom upstream connector or separate capture-side proxy wraps the origin leg | Mostly, but it observes a different leg | No; it observes FUSOU's reconstructed upstream serialization | Rejected as a natural transcript solution |

### hudsucker source anchors

- `hudsucker-0.23.0/src/proxy/internal.rs`,
  `InternalProxy::process_connect`: obtains the upgraded client stream,
  recognizes TLS, calls `TlsAcceptor::accept(upgraded).await`, and then passes
  the resulting stream to `self.serve_stream(...)`.
- `hudsucker-0.23.0/src/proxy/internal.rs`,
  `InternalProxy::serve_stream`: builds the Hyper service and calls
  `serve_connection_with_upgrades`.
- `hudsucker-0.23.0/src/proxy/builder.rs`,
  `ProxyBuilder::with_http_handler` and `ProxyBuilder::with_server`: expose
  structured HTTP handling and a Hyper server builder, but no per-CONNECT
  stream wrapper or post-TLS callback.

### FUSOU source anchors

- `packages/FUSOU-PROXY/proxy-https/src/proxy_server_https.rs`,
  `serve_proxy`: builds the upstream `HttpsConnector`, Hyper client, and
  hudsucker `Proxy`.
- `packages/FUSOU-PROXY/proxy-https/src/proxy_server_https.rs`,
  `LogHandler::{handle_request,handle_response}`: receives structured Hyper
  messages after the original client-facing serialization has been consumed.
- `packages/FUSOU-PROXY/proxy-https/src/capture.rs`,
  `ExactWireCapture`: validates and persists externally collected exact bytes;
  it does not create the bytes or establish their provenance.
- `packages/FUSOU-PROXY/proxy-https/src/capture_io.rs`,
  `CaptureIo::{poll_read,poll_write}`: opt-in directional collector used by
  `RawCaptureHook` at the selected stream boundary.

### Separate-layer source anchors

- `hyper-rustls-0.27.7/src/connector/builder.rs`, `wrap_connector`: permits a
  custom connector around the upstream Hyper client.
- `hyper-util-0.1.17/src/client/legacy/connect/mod.rs`: defines the upstream
  connector service contract.

Those APIs make origin-side observation technically possible. They do not
provide the natural client's original request line, header spelling, framing,
or byte ordering after FUSOU has parsed and reconstructed the request.

## Minimum fork patch surface

The implemented fork contains the following semantic changes:

1. Add an optional per-CONNECT server-stream hook to the fork's proxy state and
   builder. The hook receives connection context and the accepted plaintext
   `TlsStream`.
2. In `InternalProxy::process_connect`, invoke the hook immediately after
   `TlsAcceptor::accept(upgraded).await` succeeds and before
   `self.serve_stream(...)`.
3. Preserve the existing `serve_stream` generic boundary so the wrapper still
   satisfies Hyper's read/write traits and all current handler, upgrade, and
   shutdown behavior remains in the upstream path.
4. Add fork-local tests for failed TLS handshakes, plaintext request/response
   capture, HTTP parse errors, connection close, and write-failure no-retry
   behavior. The proxy integration additionally exercises three persistent
   HTTP/1.1 request/response pairs, chunked request framing, fragmented IO,
   six ordered message ranges, and no request retry.

The fork has five source touch points (`lib`, `body`, `builder`, proxy state,
and `process_connect`), plus focused tests. The FUSOU application-side change
selects the path dependency and supplies the collector. The synthetic test
exercises CONNECT, TLS accept, Hyper forwarding, persistent message lifecycle,
and artifact finalization.
This remains smaller than a replacement server, which would own the entire
CONNECT-to-Hyper lifecycle.

The fork MUST be version-pinned to the hudsucker source it patches. A future
hudsucker upgrade requires a source re-diff of `process_connect`,
`serve_stream`, builder state transitions, TLS configuration, Hyper setup,
WebSocket upgrades, and shutdown behavior before the fork is rebased.

## Lifecycle and failure rules

The production collector, when eventually authorized, must follow this order:

1. Accept and decrypt the client-facing TLS stream.
2. Create a per-connection directional recorder around the resulting
   plaintext stream.
3. Give the wrapped stream to Hyper.
4. Parse and forward through the existing FUSOU handler.
5. Finalize only after the connection's request/response boundaries and capture
   limits have been validated.

Invalid TLS handshake bytes MUST never enter the plaintext recorder. A capture
limit failure MUST occur before forwarding whenever it can be determined
before the write. If a recorder fails after the underlying write has succeeded,
the write result MUST remain successful so the caller cannot retry already
forwarded bytes; the connection MUST then become unusable for further writes.
There must be no replay fallback.

The integrated collector implements these IO-level rules for one TLS
connection and finalizes the artifact after the Hyper connection ends. It
keeps complete directional wire streams separate from ordered message ranges.
Hyper's request and response lifecycle is authoritative for those ranges; the
collector does not implement an independent HTTP parser. A one-byte client
read quantum prevents parser read-ahead from crossing a lifecycle boundary.
Malformed or incomplete connections are not finalized as valid artifacts.
Natural-traffic validation and production privacy authorization remain future
work.

## Why replacement is not selected

Replacement would provide direct control over the desired boundary, but it
would also replace hudsucker's existing responsibilities: CONNECT upgrade,
initial protocol sniffing, generated certificate selection, TLS termination,
Hyper connection setup, HTTP/1.1 URI normalization, WebSocket upgrade behavior,
error handling, graceful shutdown, and integration with the current
`HttpHandler`. Reproducing those behaviors creates a wider compatibility and
security review surface than the capture requirement needs.

Replacement remains a valid migration fallback if the fork cannot track
hudsucker or if a future protocol requirement needs ownership of the whole
server boundary. It is deferred, not disproven.

## Security and maintenance rationale

The fork preserves the byte provenance required for a natural transcript while
keeping the existing proxy's tested protocol machinery. It also keeps the
capture wrapper below Hyper and above rustls, where request and response bytes
are observable without accepting ciphertext as HTTP evidence.

The main cost is maintenance: the fork must be rebased and revalidated against
hudsucker changes. That cost is bounded by the private hook location and the
focused compatibility tests. A separate upstream capture would have lower
maintenance cost but would produce the wrong evidence. A replacement would
avoid fork maintenance but incur a larger implementation and protocol-risk
surface.

No secrets, credentials, TLSNotary keys, or capture artifacts are added by this
decision. Capture remains disabled by default and private raw output remains
outside repository evidence directories.

## Integration status and acceptance gaps

The non-production integration currently provides:

- directional request/response byte recording;
- explicit post-TLS wrapping shape through `CaptureIo`;
- `ExactWireCapture` artifact integration from the real fork hook;
- atomic staging and finalization of private artifacts;
- limits and no-retry failure tests;
- Hyper parse-failure and failed-TLS tests.
- synthetic CONNECT/TLS/upstream integration with three persistent requests,
  six ordered message assertions, chunked framing, and exactly-three upstream
  request assertion.

The focused synthetic integration passes. It proves only generated client
traffic through the selected fork boundary. It does not prove natural Game
Client traffic, authenticated TLSNotary disclosure, verifier behavior, or
production capture authorization.

The evidence classes remain independent: synthetic capture correctness may be
validated in CI; natural capture requires ordinary gameplay, private raw
retention, provenance, and manual privacy review; authenticated evidence
requires TLSNotary verification and strict FUSOU disclosure validation.

## Gate disposition

This decision changes no evidence or gate status:

- natural capture count remains `0`;
- `P0-04 = BLOCKED`;
- `P0-05 = BLOCKED`;
- `PASS = 3`, `FAIL = 0`, `BLOCKED = 14` remains unchanged;
- `IMPLEMENTATION = NO-GO` remains unchanged.

Remaining blockers include natural capture, exact message-boundary proof,
authenticated disclosure, strict verifier evidence, and privacy review. No
TLSNotary dependency, standalone Game Server request, request replay/injection,
Game Server re-submission, or production capture enablement is authorized by
this document.
