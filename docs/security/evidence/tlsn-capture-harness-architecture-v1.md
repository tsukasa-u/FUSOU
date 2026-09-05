# TLSNotary Capture Harness Architecture v1

Status: infrastructure preparation only. The selected future server boundary is `FORK` as recorded in [TLSNotary Capture Architecture Decision v1](tlsn-capture-architecture-decision-v1.md). This document does not provide natural evidence for P0-04 or P0-05.

## Purpose

The Capture Harness gives a future natural-traffic collection path a deterministic artifact format. It preserves request and response payload bytes, records message boundaries and framing metadata, and computes independently checkable hashes.

The harness is evidence collection only. It cannot authorize a `member_id`, prove ownership or device identity, make claims about authenticated disclosure, or produce a TLSNotary Result.

## Current Data Flow

The current FUSOU HTTPS proxy uses hudsucker 0.23.0:

1. hudsucker delivers a structured Hyper request to `HttpHandler::handle_request`.
2. FUSOU collects the body and reconstructs the request before forwarding it.
3. hudsucker delivers a structured Hyper response to `HttpHandler::handle_response`.
4. FUSOU collects the body and reconstructs the response before forwarding it.
5. Existing persistence optionally decodes, stringifies, prefixes metadata, or sends text through the proxy channel.

The handler continues to provide structured logging, but raw capture is now
attached through the repository-local hudsucker fork after client-facing TLS
accept and before Hyper parsing. `RawCaptureHook` writes a
`PRIVATE_RAW_CAPTURE` artifact from `CaptureIo` and does not combine
handler-visible bodies with it. The artifact is finalized atomically after the
connection ends.

This integration proves the selected byte boundary with generated traffic. It
is not natural Game Client evidence: no natural capture has been collected,
and privacy authorization remains outside this harness. Persistent HTTP/1.1
message splitting is driven by Hyper lifecycle callbacks rather than a second
HTTP parser in the capture layer.

The source-backed layer and hook investigation is recorded in [TLSNotary Capture Hook Investigation v1](tlsn-capture-hook-investigation-v1.md).

## Exact-Wire Hook

A future lower-level collector must feed `ExactWireMessage::from_parts` from the client-facing TLS plaintext application stream, after MITM TLS decryption and before Hyper HTTP parsing, or from an equivalent server boundary with identical byte provenance. An upstream proxy-to-origin capture, handler-visible body, reconstructed message, TLS ciphertext capture, or TLS record capture must not be substituted for the natural client-facing HTTP transcript without separate equivalence evidence. The collector supplies:

- the complete request or response wire byte sequence;
- the source stream start offset;
- the exclusive source stream end offset.

For the current fork integration, `RawCaptureHook` records connection-level
directional wire streams and an ordered `messages[]` list. Each message stores
its direction, sequence, Hyper metadata, parse state, and a non-overlapping
direction-local range into the corresponding wire file. Request and response
bytes remain raw, including HTTP headers and chunk framing. Hyper may serialize
client-facing response headers such as `Date`, so upstream response literals
must not be used as expected client-facing wire bytes.

The hook finalizes an artifact only for a clean Hyper connection with complete
request/response lifecycle state. Malformed HTTP, truncated bodies, premature
close, capture failure, or an incomplete lifecycle produces no valid exact-wire
artifact. Bytes already forwarded before a post-write recorder failure are not
retried.

The constructor rejects offsets that do not equal the byte length. `ExactWireCapture::write_private_raw` stores the request and response wire payloads as `request-wire.bin` and `response-wire.bin`, with `EXACT_WIRE` and `PRIVATE_RAW_CAPTURE` markers.

The original hudsucker `HttpHandler` did not expose this exact-wire input, and
its public builder did not expose a per-CONNECT stream wrapper at the required
layer. The selected implementation is the maintained fork at
`packages/FUSOU-PROXY/hudsucker-fork`, which adds the smallest per-CONNECT hook
after TLS accept and before Hyper parsing. A replacement server boundary
remains a migration fallback and is not part of this harness work.

## Artifact and Hash Rules

Each artifact contains:

- `request-*.bin` and `response-*.bin` payload files;
- `manifest.json` with source, fidelity, privacy, headers/framing, and source-stream boundaries;
- request SHA-256 and response SHA-256;
- a complete artifact SHA-256 over a fixed magic value, length-delimited canonical manifest JSON, request bytes, and response bytes.

The canonical hash order is request payload followed by response payload. Source
stream offsets remain metadata and are validated independently. Message hashes
are computed over each recorded range. This avoids silently treating two
directional streams as one original TCP stream while still permitting ordered
message verification on persistent connections.

Serialization uses the declared Rust structure order and no timestamps. Identical inputs therefore produce an identical complete artifact hash even when written to different directories.

## Privacy Boundary

Capture is disabled by default. Enabling it requires both:

- `proxy.capture_enabled = true`;
- a non-empty absolute `proxy.capture_output_path`.

The proxy only captures the `require_info` endpoint. The private output path is separate from API/resource persistence and is never selected automatically from the repository evidence directories.

The sanitized fixture writer is a separate explicit operation. It can redact selected body byte sequences and credential-like headers, writes `SANITIZED_PENDING_REVIEW`, and always requires manual privacy review. A sanitized fixture is not natural evidence until its provenance and privacy review are independently recorded.

No capture artifact is automatically copied into `docs/security/evidence/`.

## Authority Boundary

The Capture Harness records bytes and provenance metadata. It does not:

- parse or authorize `member_id` claims;
- bind an artifact to a FUSOU account, device, or owner;
- submit a request to a Game Server;
- verify a TLSNotary attestation;
- select or alter the frozen TLSNotary alpha.15 profile;
- update the Phase 0 gate ledger.

P0-04 remains `BLOCKED` until a real natural Game Client/Game Server capture exists. P0-05 remains `BLOCKED` until a real authenticated alpha.15 disclosure fixture and strict verifier evidence exist. Synthetic Harness tests prove only harness behavior.

## Operational Flow

1. Enable the private capture path only in a controlled local environment.
2. Collect a natural `require_info` exchange without changing the request or response.
3. Preserve the private raw artifact and its manifest outside the repository.
4. Review and sanitize a copy using the explicit fixture writer.
5. Record provenance, privacy review, and verifier results separately.
6. Only then consider whether the resulting natural evidence satisfies a gate requirement.

The implementation intentionally does not add TLSNotary dependencies, authority logic, migrations, production resources, or Game Server request re-submission.
