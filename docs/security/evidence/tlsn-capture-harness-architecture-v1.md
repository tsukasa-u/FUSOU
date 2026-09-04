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

The opt-in `require_info` capture hook runs at this handler boundary. It writes a `PRIVATE_STRUCTURED_VIEW` artifact containing the handler-visible body bytes and structured headers. The manifest explicitly marks this as `HANDLER_VISIBLE_BODY_ONLY_NOT_RAW_WIRE`.

This current hook is useful for plumbing and artifact validation. It is not exact natural transcript evidence: the original HTTP request/response bytes, wire framing, header spelling, chunk boundaries, and TLS record boundaries are no longer available at this boundary.

The source-backed layer and hook investigation is recorded in [TLSNotary Capture Hook Investigation v1](tlsn-capture-hook-investigation-v1.md).

## Exact-Wire Hook

A future lower-level collector must feed `ExactWireMessage::from_parts` from the client-facing TLS plaintext application stream, after MITM TLS decryption and before Hyper HTTP parsing, or from an equivalent server boundary with identical byte provenance. An upstream proxy-to-origin capture, handler-visible body, reconstructed message, TLS ciphertext capture, or TLS record capture must not be substituted for the natural client-facing HTTP transcript without separate equivalence evidence. The collector supplies:

- the complete request or response wire byte sequence;
- the source stream start offset;
- the exclusive source stream end offset.

The constructor rejects offsets that do not equal the byte length. `ExactWireCapture::write_private_raw` stores the request and response wire payloads as `request-wire.bin` and `response-wire.bin`, with `EXACT_WIRE` and `PRIVATE_RAW_CAPTURE` markers.

The current hudsucker `HttpHandler` does not expose this exact-wire input, and its public builder does not expose a per-CONNECT stream wrapper at the required layer. The selected implementation path is a maintained hudsucker fork that adds the smallest per-CONNECT hook after TLS accept and before Hyper parsing. A replacement server boundary remains a migration fallback and must not be introduced as part of this harness work.

## Artifact and Hash Rules

Each artifact contains:

- `request-*.bin` and `response-*.bin` payload files;
- `manifest.json` with source, fidelity, privacy, headers/framing, and source-stream boundaries;
- request SHA-256 and response SHA-256;
- a complete artifact SHA-256 over a fixed magic value, length-delimited canonical manifest JSON, request bytes, and response bytes.

The canonical hash order is request payload followed by response payload. Source stream offsets remain metadata and are validated independently. This avoids silently treating two directional streams as one original TCP stream.

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
