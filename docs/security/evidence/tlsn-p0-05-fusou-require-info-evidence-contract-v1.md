# P0-05 FUSOU require_info evidence contract v1

Status: `CONTRACT_DEFINED; EVIDENCE_NOT_OBTAINED; P0-05 = BLOCKED`.

This document freezes the evidence contract for a future real FUSOU
authenticated `require_info` Presentation. It defines what a qualifying
alpha.15 Presentation must prove, which exact transcript bytes the FUSOU
profile consumes, and which evidence remains outside the Presentation. It does
not acquire, inspect, or create a natural capture, serialized Presentation,
replay, injection, Game Server request, or synthetic substitute.

The current phase decision remains:

```text
P0-04 = PASS
P0-05 = BLOCKED
IMPLEMENTATION = NO-GO
```

## 1. Purpose and scope

The contract applies to profile `fusou-require-info-v1` and the frozen alpha.15
adapter in
[`packages/FUSOU-TLSN-VERIFIER/src/tlsn_alpha15.rs`](../../../packages/FUSOU-TLSN-VERIFIER/src/tlsn_alpha15.rs).
The profile verifies one authenticated TLSNotary transcript containing one
FUSOU `require_info` request and its corresponding response. It does not
define a general HTTP parser, a general TLSNotary profile, or a privacy policy
for storing raw game responses.

This is a specification artifact, not authenticated evidence. A contract
status must never be used as an evidence-obtained status.

## 2. Trust boundaries

| Boundary | What it establishes | What it does not establish |
| --- | --- | --- |
| Frozen alpha.15 `Presentation::verify` | Attestation validity, Notary signature, server identity proof when disclosed, transcript commitment proof, transcript lengths, and authenticated disclosure ranges | FUSOU HTTP semantics, the FUSOU binding header, Session/Challenge ownership, or natural client provenance |
| FUSOU alpha.15 adapter | Exact raw transcript mapping, complete contiguous disclosure, SHA-256 values, strict request/response parsing, binding structure, and member-ID extraction | A production server allowlist, a server-side Session/Challenge match, privacy approval, or runtime delivery |
| FUSOU authority | Allowlisted server identity, Session/Challenge owner and nonce, single-use/freshness, and key registries | TLSNotary cryptographic verification |
| Runtime verifier and delivery path | No-resubmission behavior, Result signing, authenticated caller delivery, and operational observability | The authenticity of a Presentation that was not verified at the alpha.15 boundary |

The Notary-authenticated fields and FUSOU-derived fields must remain separate.
In particular, the FUSOU binding, profile ID, profile hash, Result signature,
key IDs, and Session/Challenge match are not claims supplied by the alpha.15
Notary signature.

## 3. Evidence classes

Evidence artifacts must carry one explicit classification:

| Class | Meaning | P0-05 treatment |
| --- | --- | --- |
| `OFFLINE_PARSER_FIXTURE` | Raw or sanitized HTTP fixture tested without TLSNotary verification | Tests parser behavior only |
| `MOCK_TLSN_VERIFICATION` | Deterministic adapter plumbing built from an internal test output | Tests adapter wiring only |
| `REAL_ALPHA15_VERIFICATION` | A serialized alpha.15 Presentation that passes the pinned upstream verifier | Proves the backend path, but not FUSOU evidence |
| `REAL_FUSOU_AUTHENTICATED_EVIDENCE` | A real Presentation that passes alpha.15 verification and the frozen FUSOU profile with a complete evidence manifest | Required for the authenticated disclosure sub-gate |
| `RUNTIME_EVIDENCE` | Evidence from the actual FUSOU authority, verifier, signer, and delivery runtime | Required for runtime and authority sub-gates |
| `CONTRACT_ONLY` | A specification of required evidence with no qualifying artifact | Does not change P0-05 |

The checked-in upstream `GET /` Presentation remains
`REAL_ALPHA15_VERIFICATION`. It is not a FUSOU `require_info` Presentation.

## 4. Frozen alpha.15 revision

The selected upstream source is:

```text
repository: https://github.com/tlsnotary/tlsn.git
ref: refs/tags/v0.1.0-alpha.15
commit: 47aee45b53e06648c1b2ad3689b367b8c923fdec
packages: tlsn-attestation and tlsn-core, version 0.1.0-alpha.15
```

The verifier entry point is:

```rust
presentation.verify(&CryptoProvider::default())
```

The Presentation transport used by the adapter is strict bincode: the entire
input must decode as one `tlsn_attestation::Presentation` and no trailing byte
is accepted. The adapter requires `PresentationOutput.server_name` and
`PresentationOutput.transcript`; a missing identity or transcript fails closed.

The verified output fields relevant to this profile are:

```text
attestation
server_name
connection_info
transcript
extensions
```

`connection_info` contains TLS connection-start time, TLS version, and the
sent/received transcript lengths. `ConnectionInfo.time` is not Notary issuance
time and is not a FUSOU v1 authority field. `extensions` are retained by the
upstream output but are not substituted for any FUSOU contract field.

## 5. Required Presentation properties

A qualifying Presentation must satisfy all of these conditions:

1. Its bytes are identified by a cryptographic hash and are decoded by the
   pinned alpha.15 type.
2. `Presentation::verify(&CryptoProvider::default())` succeeds.
3. The output contains an authenticated `server_name` and transcript.
4. The output transcript length agrees with the attested
   `connection_info.transcript_length` in both directions.
5. The sent and received authenticated ranges together cover every byte from
   offset `0` to the corresponding transcript length without a gap or overlap.
6. The request and response are taken from the same verified
   `PresentationOutput`; they cannot be paired from separate presentations.
7. The adapter, rather than the caller or a capture manifest, supplies the
   server identity, Attestation ID, transcript bytes, and authenticated ranges.

The current adapter intentionally requires complete disclosure before it reads
`PartialTranscript.sent_unsafe()` or `received_unsafe()`. An authenticated
partial transcript followed by caller-supplied or locally reconstructed bytes
is not a valid input to this profile.

## 6. Exact request disclosure contract

Let `N` be the verified sent transcript length. The authenticated sent range
contract is:

```text
authenticated sent coverage = 0..N
sent transcript bytes       = exact HTTP request wire bytes
sent digest                 = SHA-256(sent transcript bytes)
```

The coverage may be represented by multiple adjacent ranges, but the first
range must start at `0`, each next range must start at the previous end, and the
last end must equal `N`. Range bytes must equal the corresponding transcript
slice byte-for-byte. There is no untrusted completion step.

The request parser requires:

| Component | Required wire contract |
| --- | --- |
| Start line | Exactly `POST /kcsapi/api_get_member/require_info HTTP/1.1\r\n` |
| Header framing | Every header line ends in `\r\n`; the header block ends in `\r\n`; LF-only framing is rejected |
| Header names | HTTP token bytes; no whitespace before `:`; matching is ASCII case-insensitive |
| Header values | No control byte other than SP or HTAB; ordinary header value comparison trims OWS |
| `Host` | Exactly one header; its trimmed value equals the authenticated and allowlisted server identity byte-for-byte |
| `X-FUSOU-Attestation-Binding` | Exactly one header; its field name is case-insensitive; its raw value is exactly one ASCII SP followed by the binding value, with no trailing OWS |
| Body framing | Exactly one `Content-Length` or one `Transfer-Encoding`; duplicates and co-presence are rejected |
| `Content-Length` | Canonical unsigned decimal (`0` or a non-zero digit followed by digits), and the value equals the remaining body length exactly |
| `Transfer-Encoding` | If used, exactly `chunked` case-insensitively; chunk extensions and trailers are rejected; chunk size lines are hexadecimal and CRLF terminated |
| Request body | Framed bytes are preserved exactly. The current profile imposes no semantic body schema and does not decode request `Content-Encoding` |

Unknown non-framing headers are permitted by the current parser within its
header token, value, count, and size limits. They remain part of the
authenticated digest and must not be removed before verification.

The current default limits are 512,000 request transcript bytes, 65,536 HTTP
header bytes, and 128 headers. A limit violation is rejection, not truncation.

## 7. Exact response disclosure contract

Let `M` be the verified received transcript length. The authenticated received
range contract is:

```text
authenticated received coverage = 0..M
received transcript bytes       = exact HTTP response wire bytes
received digest                 = SHA-256(received transcript bytes)
```

The same contiguous-range and exact-byte rules from the request apply. The
response parser requires:

| Component | Required wire contract |
| --- | --- |
| Status line | Exactly `HTTP/1.1 200 OK\r\n` |
| Header and body framing | The same strict CRLF, header, `Content-Length`, and `Transfer-Encoding` rules as the request |
| `Content-Encoding` | Absent, `identity`, or one `gzip` value, case-insensitively; duplicate or other values are rejected |
| Gzip | One gzip member only; decompressed output is bounded; trailing compressed bytes are rejected |
| Body prefix | Exact byte prefix `svdata=` immediately followed by the JSON object; a BOM or leading JSON byte is rejected |
| Response body | After optional gzip decoding, the body must contain exactly one accepted JSON value with no trailing bytes |

The current default limits are 16,777,216 response transcript bytes and
16,777,216 decompressed body bytes. `Content-Type` is not a semantic
requirement of this profile. The raw compressed or chunked response wire bytes,
not a decoded substitute, are the bytes covered by `M` and the response digest.

### Required JSON path

The body after `svdata=` must be a JSON object containing both paths below:

```text
root.api_result                 = number token 1
root.api_data.api_basic.api_member_id = canonical decimal number token
```

The parser rejects duplicate object keys, escaped spellings of the target keys,
missing required objects or members, a BOM, invalid JSON, and trailing bytes.
`api_member_id` is returned as its original ASCII decimal lexeme. It must be
between 1 and 16 bytes, contain only ASCII digits, and begin with `1` through
`9`; strings, `0`, leading zeroes, signs, fractions, and exponents are rejected.
The configured JSON depth and string-size limits remain part of the fail-closed
parser contract.

## 8. Server identity

The server identity source is the verified alpha.15
`PresentationOutput.server_name`, which is produced by the authenticated
server identity proof and certificate validation. It is not accepted from a
caller field, natural-capture metadata, HTTP `Host`, or an Attestation ID
field.

The adapter compares that identity to the profile's trusted allowlist and then
requires the request `Host` to match it. The current production allowlist
registry is not linked; its constructor fails closed. A test-only profile is
not production authority and is classified as `MOCK_TLSN_VERIFICATION`.

The FUSOU v1 identity grammar is lowercase ASCII DNS labels: no empty labels,
uppercase bytes, trailing dot, leading/trailing hyphen, non-ASCII bytes, or
labels longer than 63 bytes; the complete identity is at most 253 bytes.

## 9. Attestation ID

The only accepted Attestation ID extraction is:

```rust
output.attestation.header.id.0
```

The value is the exact opaque `Uid(pub [u8; 16])` raw byte array. It is not a
hash-derived identity, string-normalized identifier, caller replacement, or
signature over the ID alone. The Notary signature covers the attestation
Header, including its ID and other Header fields. The FUSOU evidence manifest
must record the exact 16 bytes and their encoding used by the resulting
Verifier Result.

## 10. Binding and Session/Challenge

The request binding header value must be strict unpadded base64url. Re-encoding
the decoded bytes must reproduce the supplied value exactly; padding and
non-canonical spellings are rejected. The decoded bytes are exactly:

```text
FUSOU-ATTESTATION-BINDING-V1\0
  || u16be(16) || UUIDv4 bytes
  || u16be(32) || 32-byte nonce
```

The adapter obtains `session_id` and `binding_nonce` only from this
authenticated request header. A real P0-05 evidence set must additionally
prove, at the FUSOU authority boundary, that the pair matches the server-issued
Session/Challenge owner and nonce, is within the server-side lifecycle rules,
and is not reused. Parsing a client-provided binding value alone is not that
authority evidence.

## 11. Transcript digests and Result fields

The request digest is SHA-256 of the exact sent wire transcript, including the
request line, all preserved headers, CRLF delimiters, framing, and body bytes.
The response digest is SHA-256 of the exact received wire transcript, including
chunked or gzip wire encoding when present. The digest is computed only after
the alpha.15 verified transcript has been mapped and its ranges have been
validated.

The adapter carries the following authenticated or parser-derived values into
`AuthenticatedRequireInfo`:

```text
verified_member_id
binding / session_id / nonce
authenticated server identity
16-byte alpha.15 Attestation ID
request and response transcript sizes
request and response SHA-256 digests
authenticated request and response ranges
```

Profile hash, verifier and Notary key IDs, and the final Ed25519 signature are
separate FUSOU registry/signer inputs. A successful parser or a mock Result
construction is not a signed runtime Verifier Result.

## 12. Request/response pairing

The request and response must be the two directions of one verified alpha.15
Presentation. The adapter stores them together in one `AuthenticatedTranscript`
and does not expose a public constructor accepting arbitrary direction values.
The following substitutions are invalid:

- request bytes, response bytes, or ranges from different Presentations;
- an authenticated request paired with a locally generated response;
- a natural capture request paired with an unrelated Presentation response;
- a response whose binding or member ID is taken from another Session;
- caller-provided transcript bytes used to fill an authenticated range gap.

## 13. Fail-closed conditions

The verifier must reject when any of the following occurs:

- Presentation decoding fails, has trailing bytes, or alpha.15 verification
  fails;
- the server identity proof or transcript proof is absent or invalid;
- sent or received disclosure is incomplete, gapped, overlapping, out of order,
  out of bounds, or byte-inconsistent;
- the transcript size or SHA-256 value does not match the verified bytes;
- the identity is not in the trusted allowlist or the `Host` does not match;
- the target, HTTP framing, binding header, binding value, response status,
  compression, `svdata=` prefix, JSON path, or member-ID token is invalid;
- the binding cannot be matched to the server-side Session/Challenge;
- privacy approval, redaction/non-persistence controls, or runtime Result
  signature evidence is absent for a production decision.

No upstream fixture, offline parser fixture, mock adapter test, natural capture
alone, or contract document can override these failures.

## 14. P0-05 sub-gates

| Sub-gate | Status | Current basis |
| --- | --- | --- |
| Frozen alpha.15 revision and extraction path | `PASS` | Selected tag, commit, and verified source inspection |
| Linked alpha.15 decode and verification backend | `PASS` | Existing pinned adapter and upstream fixture tests |
| Strict FUSOU request/response parser | `PASS` | Offline parser tests and fixed parser source |
| Contract definition | `PASS` | This document |
| Real FUSOU authenticated Presentation | `BLOCKED` | No qualifying Presentation has been obtained |
| FUSOU complete authenticated ranges and digest golden | `BLOCKED` | No FUSOU Presentation evidence exists |
| Production server-identity allowlist | `BLOCKED` | Registry is not linked; construction fails closed |
| Session/Challenge ownership and single-use match | `BLOCKED` | FUSOU authority/runtime path is not linked |
| Privacy and full-response disclosure review | `BLOCKED` | Separate P0-15 evidence is absent |
| Runtime Result signing and delivery | `BLOCKED` | Dedicated verifier/runtime evidence is absent |

The contract being frozen changes none of the gate statuses. P0-05 remains
`BLOCKED` and implementation remains `NO-GO`.

## 15. Exact evidence still required for P0-05 PASS

A future evidence submission must contain, or securely reference, all of the
following without exposing secrets in the repository:

1. An authorized natural-client provenance record linking the exchange to the
   supported FUSOU-APP path, with no request injection, replay, standalone
   Game Server request, or capture-generated traffic.
2. The serialized alpha.15 Presentation bytes, a hash of those bytes, the
   exact selected revision, and a reproducible verification record showing
   strict decode, no trailing bytes, and successful `Presentation::verify`.
3. The verified server identity and Attestation ID, with the allowlist version
   or digest that authorized the identity.
4. Exact sent and received transcript sizes, SHA-256 digests, authenticated
   ranges, and enough privacy-reviewed byte evidence to demonstrate the request
   and response contract above. Redaction must not be presented as the raw
   authenticated transcript.
5. The authenticated binding value, decoded Session/Challenge identifiers, and
   an authority record proving owner, nonce, lifecycle, and single-use match.
6. Strict negative results for modified Presentation bytes, modified transcript
   bytes, modified ranges, partial disclosure, wrong identity, wrong target or
   Host, duplicate or malformed binding, wrong digest, and request/response
   cross-context substitution. Deterministic local tests remain supporting
   evidence, not a substitute for the real Presentation.
7. Privacy approval for the disclosed response, non-persistence and
   redaction evidence, plus runtime evidence for Result signing, authenticated
   delivery, and no Game Server re-submission.

Until this set exists and is reviewed, the only accurate classification is
`CONTRACT_ONLY` for this artifact and `REAL_FUSOU_AUTHENTICATED_EVIDENCE` is
absent.

## 16. Related evidence

- [`tlsn-p0-05-alpha15-backend-v1.md`](tlsn-p0-05-alpha15-backend-v1.md): linked backend and upstream fixture evidence.
- [`tlsn-p0-05-alpha15-adapter-v1.md`](tlsn-p0-05-alpha15-adapter-v1.md): adapter boundary and current negative matrix.
- [`tlsn-p0-04-p0-05-evidence-attempt-v1.json`](tlsn-p0-04-p0-05-evidence-attempt-v1.json): machine-readable evidence obtained status.
- [`tlsn-phase0-gate-ledger-v1.json`](tlsn-phase0-gate-ledger-v1.json): phase gate status and evidence index.