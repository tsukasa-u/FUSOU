# TLSNotary Capture Hook Investigation v1

Status: source-backed architecture investigation and implementation record for
the selected `FORK` decision. This document does not provide natural evidence
for P0-04 or P0-05 and does not authorize production capture.

## Question and conclusion

The question is whether the current FUSOU HTTPS proxy architecture exposes a lower-level capture point for the exact request and response bytes needed by the frozen TLSNotary alpha.15 profile.

Conclusion:

- The existing FUSOU `HttpHandler` boundary cannot provide exact natural HTTP wire bytes.
- The upstream proxy-to-origin client has a usable custom connector boundary. A new connector/IO wrapper could observe upstream TLS plaintext or TLS ciphertext, but FUSOU does not currently install such a collector.
- The client-facing MITM TLS stream is handled inside hudsucker after CONNECT upgrade. hudsucker 0.23.0 has no public callback for wrapping that stream before Hyper parses it or after rustls decrypts it.
- Therefore, a complete natural Game Client request/response capture is not available through the original public integration. FUSOU now uses a maintained hudsucker fork with a per-stream IO hook; a replacement server boundary remains unnecessary for this integration.

The required TLSNotary capture layer is the client-facing TLS plaintext application stream: the serialized HTTP bytes sent by the natural client and returned by the proxy toward that client. Upstream proxy-to-origin bytes are a different serialization and must not be substituted for the client-facing transcript. TLS ciphertext and TLS record data are also different artifacts and are not HTTP request/response wire bytes.

## Scope and source snapshot

The investigation covers the checked-in FUSOU proxy and the versions resolved by `packages/FUSOU-PROXY/proxy-https/Cargo.lock`:

| Component | Version | Primary source inspected |
| --- | --- | --- |
| hudsucker | 0.23.0 | local Cargo registry `hudsucker-0.23.0/src` |
| hyper-util | 0.1.17 | local Cargo registry `hyper-util-0.1.17/src` |
| hyper-rustls | 0.27.7 | local Cargo registry `hyper-rustls-0.27.7/src` |
| tokio-rustls | 0.26.4 | local Cargo registry `tokio-rustls-0.26.4/src` |
| rustls | 0.23.35 | Cargo lock resolution |

The relevant dependency source is not vendored in this repository. The local source paths above, the lockfile versions and checksums, and the source symbols listed below are the reproducible primary-source anchors used for this finding.

## Current FUSOU path

`serve_proxy` constructs an upstream client using `HttpConnector`, `hyper_rustls::HttpsConnectorBuilder`, and `wrap_connector(http)`, then supplies that client to hudsucker through `Proxy::builder().with_client(client)`. This is an upstream connector composition point, not a client-facing server-stream hook. See `packages/FUSOU-PROXY/proxy-https/src/proxy_server_https.rs`.

For ordinary intercepted HTTP traffic, hudsucker performs this sequence:

1. Its `HttpHandler` receives a structured `Request<Body>`.
2. FUSOU's `LogHandler::handle_request` calls `body.collect()` and rebuilds the body as `Full`.
3. hudsucker sends the structured request through its Hyper client.
4. Its `HttpHandler` receives a structured `Response<Body>`.
5. FUSOU's `LogHandler::handle_response` collects and rebuilds the response body.

The relevant source anchors are:

- hudsucker `HttpHandler::{handle_request,handle_response}` in `hudsucker-0.23.0/src/lib.rs`.
- hudsucker `InternalProxy::proxy` in `hudsucker-0.23.0/src/proxy/internal.rs`, where `Incoming` is converted to hudsucker `Body` before the handler calls.
- FUSOU `LogHandler::{handle_request,handle_response}` in `packages/FUSOU-PROXY/proxy-https/src/proxy_server_https.rs`.
- hudsucker `Body` in `hudsucker-0.23.0/src/body.rs`, which stores structured body implementations such as `Incoming` and `Full`, not the original serialized HTTP stream.

At this point, the original request line, complete header serialization, HTTP framing bytes, source offsets, and transport read/write provenance are not available. The existing persistence path can additionally decode content encodings, stringify content, prefix metadata, and send `String` content through `StatusInfo`; those outputs cannot serve as authenticated raw transcript evidence.

## Client-facing MITM source path

The public hudsucker builder exposes `with_listener`, `with_client`, `with_http_handler`, and `with_server`. The listener accepts a `tokio::net::TcpListener`, the client configures the upstream Hyper client, the HTTP handler receives structured messages, and the server accepts a Hyper server builder. None of these APIs accepts a per-connection stream wrapper or a callback around the accepted stream.

The internal CONNECT path in `hudsucker-0.23.0/src/proxy/internal.rs` is the decisive source path:

1. `hyper::upgrade::on(&mut req)` obtains the upgraded client connection.
2. hudsucker reads the first four bytes and rewinds them.
3. For TLS, it calls `TlsAcceptor::from(server_config).accept(upgraded).await`.
4. It passes the resulting `tokio_rustls::server::TlsStream` directly to its private `serve_stream` function.
5. `serve_stream` invokes Hyper `serve_connection_with_upgrades`, where HTTP parsing begins.

This gives two possible internal observation positions, but neither is public in the current integration:

- Wrap `upgraded` before `TlsAcceptor::accept` to observe client-facing TLS ciphertext.
- Wrap the returned server `TlsStream` after `accept` and before `serve_stream` to observe client-facing decrypted HTTP application bytes.

The second position is the required HTTP transcript position. It is inside hudsucker's private implementation, so `with_http_handler` cannot reach it.

## Architecture decision

The formal implementation decision is **`FORK`**. The repository-local fork at
`packages/FUSOU-PROXY/hudsucker-fork` adds the smallest per-CONNECT stream hook
after `TlsAcceptor::accept` and before private `serve_stream`. `REPLACEMENT` is
retained only as a migration fallback. A separate upstream connector or
capture-side proxy is rejected as a natural transcript solution because it
observes FUSOU's reconstructed origin-side serialization.

The source-backed comparison, minimum fork patch surface, lifecycle rules,
prototype status, and unchanged gate disposition are recorded in [TLSNotary
Capture Architecture Decision v1](tlsn-capture-architecture-decision-v1.md).

## Upstream connector source path

The upstream leg has a different, real extension point.

`hyper-util-0.1.17/src/client/legacy/connect/mod.rs` defines the connector contract as a `Service<Uri>` whose response implements Hyper's `Read`, `Write`, and `Connection` traits. Its blanket implementation makes a custom `Service<Uri>` usable as a Hyper connector.

`hyper-rustls-0.27.7/src/connector/builder.rs` exposes `wrap_connector`, and `hyper-rustls-0.27.7/src/connector.rs` constructs a `MaybeHttpsStream` by applying `tokio_rustls::TlsConnector` to the lower connector's stream. This permits two distinct wrappers:

- An outer wrapper around `MaybeHttpsStream` observes the application plaintext that Hyper writes to and reads from the upstream TLS session.
- A wrapper around the lower `HttpConnector` response, before `TlsConnector::connect`, observes upstream TLS ciphertext on the TCP transport.

`tokio-rustls-0.26.4/src/client.rs` confirms that its `TlsStream<IO>` stores the underlying `IO` and exposes `get_ref`, `get_mut`, and `into_inner`. The public API therefore supports implementing those upstream transport wrappers without modifying rustls.

This is useful for transport diagnostics or for a future origin-side collector, but it does not capture the natural client's original bytes. FUSOU's client-facing request is parsed, reconstructed, normalized, and serialized again on the upstream leg. An upstream capture must therefore never be described as the client-facing exact transcript without an explicit equivalence proof, which the current architecture does not have.

Hyper's `capture_connection` API was also inspected. It captures only `Connected` metadata through a request extension; it does not capture stream bytes, HTTP framing, TLS plaintext, TLS ciphertext, or offsets.

## Capability matrix

| Required capability | Current handler | Upstream custom connector | Client-facing public hook | Complete path required |
| --- | --- | --- | --- | --- |
| Complete natural request bytes | No; structured request/body only | No; captures FUSOU's origin-side serialization | No | Server TLS plaintext wrapper before Hyper |
| Complete natural response bytes | No; structured response/body only | No; captures origin-side response serialization | No | Server TLS plaintext wrapper before Hyper |
| Exact byte lengths | Body length only after collection | Yes for bytes observed by wrapper | No | Per-direction byte counters |
| Direction and ordering | No transcript stream | Yes per wrapped connection, with pairing logic still required | No | Per-session directional recorder |
| Request/response boundaries | No source-stream boundaries | Not supplied by connector API; collector must parse HTTP/1.1 | No | Strict HTTP parser plus recorder |
| HTTP request line and header serialization | No original wire serialization | Yes for upstream bytes emitted by Hyper | No | Capture client-facing plaintext before Hyper parsing |
| HTTP framing bytes | No | Yes for upstream serialized bytes | No | Capture the target leg before parsing |
| Source stream offsets | No | Can be assigned by a directional recorder | No | Monotonic offsets per captured stream |
| TLS plaintext | No | Yes, outside the upstream rustls stream | No | Fork/replacement for client-facing stream |
| TLS ciphertext | No | Yes, below upstream rustls | No | Fork/replacement for client-facing upgraded stream |
| TLS record boundaries | No | Not surfaced as events; derive by parsing captured ciphertext | No | Ciphertext recorder plus TLS record parser if required |
| Hyper connection metadata | No raw bytes; metadata can exist | `capture_connection` only provides metadata | No | Not a substitute for transcript evidence |

The matrix distinguishes “possible with a new collector” from “available now”. No byte collector is currently installed in FUSOU, and no matrix row changes the natural capture count of zero.

## Architecture options

| Option | Result | Assessment |
| --- | --- | --- |
| A. Use the existing `HttpHandler` | Structured body and headers only | Reject. It cannot satisfy exact-wire evidence. |
| B. Add a custom IO/stream layer | Complete control on the upstream connector; client-facing capture remains unavailable | Partial. Useful only if the evidence target is explicitly origin-side, not sufficient for the natural client transcript. |
| C. Maintain a hudsucker fork | Add a per-CONNECT stream hook and wrap the server `TlsStream` before private `serve_stream`; optionally wrap the upgraded stream for ciphertext | Required candidate for the current proxy model. It carries maintenance and upgrade-path compatibility risk. |
| D. Keep the current architecture | No accessible complete exact-wire capture point | Correct current decision while evidence is absent: `IMPLEMENTATION = NO-GO`. |

If the project does not want to maintain a hudsucker fork, the alternative is a replacement server boundary that owns CONNECT upgrade, TLS termination, stream wrapping, and Hyper connection setup. Adding more logic to `LogHandler` does not provide that capability.

## Required specification wording

The existing Capture Harness description should be read with the following qualification:

> The exact-wire collector MUST attach to the client-facing TLS plaintext application stream after MITM TLS decryption and before Hyper HTTP parsing, or to an equivalent server boundary with identical byte provenance. An upstream connector capture, handler-visible body, decoded body, reconstructed request/response, TLS ciphertext capture, or TLS record capture MUST NOT be labeled as the natural client-facing HTTP transcript without separate equivalence evidence.

The `ExactWireMessage` input contract remains valid, but it is only an artifact contract. It does not prove that the current proxy can produce the required input. The producer must also record the stream identity, direction, ordering, message boundary method, and the layer identity (`CLIENT_FACING_TLS_PLAINTEXT_HTTP`) in its provenance.

## Gate and implementation disposition

This investigation changes no gate result and adds no runtime collector.

- Capture status remains `HANDLER_VISIBLE_BODY_ONLY_NOT_RAW_WIRE`.
- `P0-04 = BLOCKED`; natural capture count remains `0`.
- `P0-05 = BLOCKED`; no authenticated FUSOU disclosure, range evidence, digest golden, binding evidence, or strict verifier fixture exists.
- `PASS = 3`, `BLOCKED = 14`, `FAIL = 0` remains unchanged.
- `IMPLEMENTATION = NO-GO` remains unchanged.

No request replay, Game Server re-submission, TLSNotary dependency addition, or production capture enablement is authorized by this investigation.