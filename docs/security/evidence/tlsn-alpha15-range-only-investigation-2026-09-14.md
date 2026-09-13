# TLSN alpha.15 Range-Only Verification Investigation

Date: 2026-09-14

Baseline commit: `6c96f4cd6b282470ef969dfa8b79661600e939c7`

TLSN source inspected locally at:

- repository: `tlsnotary/tlsn`
- tag: `v0.1.0-alpha.15`
- commit: `47aee45b53e06648c1b2ad3689b367b8c923fdec`

This report distinguishes cryptographic requirements from the alpha.15
representation/API. The local alpha.15 fork now uses sparse authenticated
storage and does not treat zero-filled bytes as authenticated. The current
FUSOU `require_info` Result profile remains complete-disclosure because its
raw full-transcript digest contract is unchanged.

## Upstream investigation

### Call graph

The post-hoc Presentation path is:

```text
bincode::deserialize::<Presentation>
  -> serde deserializes TranscriptProof
  -> serde deserializes PartialTranscript
  -> CompressedPartialTranscript::into
       -> retain total lengths, RangeSets, and packed disclosed bytes
Presentation::verify
  -> AttestationProof::verify
       -> BodyProof::verify_with_provider
            -> verify the transcript commitment fields against the Merkle root
       -> verify the Notary signature over the attestation header
  -> ServerIdentityProof::verify_with_provider
       -> verify the certificate/server identity binding
  -> TranscriptProof::verify_with_provider
       -> check transcript lengths
        -> for each PlaintextHashSecret:
          read packed authenticated plaintext[idx]
            hash plaintext[idx] || blinder
            compare with a Notary transcript commitment
       -> compare the authenticated range sets
  -> PresentationOutput { transcript: PartialTranscript }
```

The relevant upstream source is:

- `crates/attestation/src/presentation.rs:66-107`: `Presentation::verify`.
  This method invokes the attestation, identity, and transcript verifiers. It
  does not itself allocate the full transcript vector.
- `crates/core/src/transcript.rs`: `Transcript::to_partial`. The local fork
  collects only disclosed bytes in range order and retains total lengths.
- `crates/core/src/transcript.rs:166-250`: `PartialTranscript` and its
  compressed serialization form. Deserializing the compressed form expands it
  into full-length vectors.
- `crates/core/src/transcript.rs`: `PartialTranscript::new`, explicit
  `materialize_*` compatibility methods, and `copy_authenticated_to`.
- `crates/core/src/transcript/proof.rs`: the local
  `TranscriptProof::verify_with_provider` reads each opening through the sparse
  authenticated reader, then verifies the hash openings and authenticated
  range sets.
- `crates/core/src/transcript/proof.rs:230-366`:
  `TranscriptProofBuilder::build`. It calls `Transcript::to_partial` and then
  serializes the disclosed bytes and range metadata.
- `crates/attestation/src/proof.rs:51-76` and `:101-128`: Notary attestation
  signature and body Merkle verification.
- `crates/tlsn/src/verifier/verify.rs`: live TLS verifier handling of the
  received `PartialTranscript`.
- `crates/tlsn/src/transcript_internal/auth.rs`: the live plaintext verifier
  copies only authenticated ranges for both partial and complete disclosure;
  undisclosed committed ranges remain blind VM slices.

### Why the full-length vectors exist

`CompressedPartialTranscript` already contains the sparse information needed
on the wire: authenticated bytes, their `RangeSet`s, and the total sent and
received lengths. The expansion occurs because the public `PartialTranscript`
API promises contiguous `sent_unsafe()` and `received_unsafe()` slices and
implements `len_sent`, `len_received`, `contains`, `iter`, and range indexing
against those vectors.

Therefore, in the local fork:

- The transcript lengths are cryptographically relevant metadata and must be
  retained.
- The disclosed bytes, ranges, hash algorithm, blinder/opening, and matching
  Notary commitment are cryptographically relevant for a disclosed range.
- Materializing zero-filled bytes for every undisclosed offset is not required
  by the hash-opening check and is no longer done by the local fork.
- `TranscriptProof::verify_with_provider` uses
  `copy_authenticated_to`; a requested opening that crosses a gap fails.
- The live verifier uses the same reader for disclosed ranges and blind VM
  slices for omitted committed ranges.

Classification: **local sparse fork implemented**. The cryptographic verifier
needs total lengths and disclosed range material, but not a materialized byte
for every undisclosed offset. Explicit `materialize_*` methods remain only for
compatibility callers outside cryptographic verification.

### Authentication relation

For a disclosed range, alpha.15's relation is:

```text
Notary-signed attestation body
  -> transcript commitment PlaintextHash(direction, idx, H(bytes || blinder))
  -> Presentation TranscriptProof
       -> same direction and idx
       -> PlaintextHashSecret(algorithm, idx, blinder)
       -> disclosed bytes at idx
  -> verifier recomputes H(disclosed bytes || blinder)
  -> verifier matches the commitment and the authenticated RangeSet
```

`AttestationProof::verify` first checks the body fields against the Notary
Merkle root and verifies the Notary signature. `TranscriptProof::verify` then
checks the hash opening against those authenticated commitments. Range
metadata alone is not sufficient.

An undisclosed range can remain covered by a Notary commitment if the Prover
configured such a commitment, but alpha.15 does not provide its plaintext or a
raw full-transcript digest to the Presentation verifier. The verifier cannot
claim that an undisclosed byte was semantically inspected. In particular, the
current FUSOU full transcript SHA-256 cannot be recomputed from sparse ranges.

## Range-only API

### Existing API reusable

**NO** for a memory-bounded verifier boundary in upstream alpha.15. Its API
exposes `sent_unsafe()` and `received_unsafe()` as full contiguous slices. Its
`sent_authed()` and `received_authed()` expose range metadata, but not a
range-only authenticated byte source. The local fork replaces that internal
representation with packed authenticated bytes and explicit total lengths.

**YES** for the cryptographic opening semantics. The existing proof already
contains the range, algorithm, blinder, disclosed bytes, and commitment match
needed to verify each disclosed range.

### New API required

**YES**, upstream. The smallest compatible design is:

```text
PartialTranscript {
    sent_len: usize,
    received_len: usize,
    sent_ranges: RangeSet<usize>,
    received_ranges: RangeSet<usize>,
    sent_authed_bytes: Vec<u8>,
    received_authed_bytes: Vec<u8>,
}

AuthenticatedRange {
    direction: Direction,
    start: usize,
    bytes: borrowed-or-owned range bytes,
    verified_against: PlaintextHash commitment descriptor,
}
```

The range reader must accept only a range fully contained in one authenticated
range and must return an error for a gap. The verified result should retain
the total length and the authenticated range set. A full raw digest is an
optional separate field and must only be populated when independently
verified; it cannot be derived from the sparse range bytes.

The minimum upstream patch would:

1. Keep the existing compressed wire fields as the internal representation of
   `PartialTranscript` instead of expanding them on deserialization.
2. Add total-length, range iteration, and authenticated-range read methods.
3. Change `Transcript::to_partial` to collect only disclosed bytes.
4. Change `TranscriptProof::verify_with_provider` to use the range reader for
   each hash opening and length metadata, without calling `sent_unsafe` or
   `received_unsafe`.
5. Change the live `tlsn::verifier` plaintext path to read only disclosed
   ranges while retaining blind VM slices for undisclosed committed ranges.
6. Keep `sent_unsafe`/`received_unsafe` only as an explicitly materializing,
   deprecated compatibility method, or make the API break explicit in a major
   release. The verifier must not call that compatibility method.

This preserves the existing hash-opening and Notary verification semantics;
it changes only how authenticated bytes are stored and read.

### Prototype status

The FUSOU `AuthenticatedByteSource` is a fail-closed semantic boundary. It
validates range ordering, bounds, range count, disclosed-byte limits, and
rejects reads crossing an undisclosed gap. It now has a real sparse
`PartialTranscript` backend. `Presentation::verify` output is retained as
packed authenticated bytes, and the strict FUSOU parser is called through the
same reader. Tests cover a complete sparse fixture path and a gap crossing
that is rejected by the parser.

The current Result profile still requires complete parser input and a raw
full-transcript SHA-256. Incomplete sparse output is inspectable for range
metadata but cannot be converted to that Result; no digest is fabricated from
omitted bytes.

## Omitted-byte tamper experiment

The expected experiment is not representable as an alpha.15 Presentation
mutation:

1. The serialized partial transcript contains disclosed bytes, range metadata,
   and total lengths, not bytes for omitted offsets.
2. `CompressedPartialTranscript::into` retains packed disclosed bytes and
  total lengths; it does not create omitted-byte storage.
3. `TranscriptProof::verify_with_provider` hashes bytes at each requested
  opening index through the authenticated range reader.
4. Changing a disclosed byte or opening metadata causes the hash opening or
   range-set check to fail.
5. There is no mutable compatibility byte in an omitted gap for a verifier to
  accidentally inspect or modify.

Thus the result is not `PASS` for the requested omitted-byte mutation test.
It is **NOT TESTED / not representable through the current wire model** as a
mutation of an omitted plaintext byte. The sparse implementation preserves the
correct security property by having no omitted-byte storage at all. It
authenticates disclosed ranges against Notary commitments; it does not claim
semantic authentication of values that were intentionally not disclosed.

## Semantic parser

- Sparse request/response source boundary: **PASS / connected and fail-closed**.
- Gap-crossing strict parse: **PASS / tested**.
- Partial sparse `require_info` Result: **REJECTED by contract** because the
  current Result carries a raw full transcript SHA-256.

The current profile intentionally requires complete request and response
disclosure because it validates HTTP framing, duplicate headers, compression,
JSON structure, and the full request/response SHA-256 fields. A parser that
reads only selected syntax ranges would need a new profile contract defining
which omitted bytes are allowed and would not be able to preserve the current
full raw transcript digest without an additional cryptographic commitment
primitive.

The parser currently requests the complete HTTP message bytes. This preserves
the existing framing, duplicate-header, compression, JSON, and raw-digest
guarantees. A gap therefore produces an authenticated-read error before any
hidden bytes can affect semantic parsing. A future selective profile would
need an explicit syntax-range contract and a separate authenticated digest
model.

## Memory

The scaling probe creates `PartialTranscript::new(size, size)`, discloses two
bytes per direction, reads those authenticated ranges, and reports
`VmSize`, `VmData`, `VmRSS`, and `VmHWM`. Values are KiB; each requested size
is per direction.

| Each direction | VmSize before -> after | VmData before -> after | VmRSS before -> after | VmHWM before -> after |
| --- | ---: | ---: | ---: | ---: |
| 1 MiB | 3404 -> 3404 (+0) | 236 -> 236 (+0) | 2224 -> 2224 (+0) | 2224 -> 2224 (+0) |
| 4 MiB | 3404 -> 3404 (+0) | 236 -> 236 (+0) | 2276 -> 2276 (+0) | 2276 -> 2276 (+0) |
| 8 MiB | 3404 -> 3404 (+0) | 236 -> 236 (+0) | 2276 -> 2276 (+0) | 2276 -> 2276 (+0) |
| 16 MiB | 3404 -> 3404 (+0) | 236 -> 236 (+0) | 2220 -> 2220 (+0) | 2220 -> 2220 (+0) |
| 32 MiB | 3404 -> 3404 (+0) | 236 -> 236 (+0) | 2280 -> 2280 (+0) | 2280 -> 2280 (+0) |

Each run retained only two disclosed bytes per direction. The zero deltas show
that total transcript length is metadata and does not allocate a full vector.

The actual Presentation probe also ran the FUSOU alpha.15 adapter through
`Presentation::verify` using the checked-in fixture:

```text
presentation_bytes=5394
request_len=35
response_len=145
elapsed_ms=2
VmSize delta=0 KiB
VmRSS delta=1592 KiB
VmData delta=0 KiB
VmHWM delta=1592 KiB
```

This fixture is intentionally tiny and does not establish a 1/4/8/16/32 MiB
full-Presentation scaling curve. The scaling probe measures sparse storage;
the fixture probe confirms the actual Presentation verification path and its
process-lifetime peak metric.

## Before / after benchmark status

### Local alpha.15 sparse fork

```text
Presentation -> sparse PartialTranscript -> authenticated range reader
             -> disclosed-range hash checks
```

- Memory: proportional to disclosed bytes and range metadata; total lengths do
  not allocate transcript-sized vectors.
- CPU: hash-opening work is proportional to disclosed/opened bytes; range
  lookup adds bounded metadata work.
- Disclosed bytes: current FUSOU profile reveals 100% of both directions.
- Transcript size: retained as metadata plus packed authenticated bytes.

### FUSOU semantic boundary

```text
Presentation -> sparse authenticated ranges -> gap-rejecting reader
             -> strict HTTP/JSON parser
```

- Memory: proportional to authenticated bytes read by the strict parser and
  parser working state; sparse storage remains disclosure-sized.
- Disclosed bytes: profile-defined ranges, with the current Result profile
  requiring complete parser input.
- Full transcript digest: must be supplied through a separately designed
  authenticated commitment or removed from the sparse profile contract.

The range-only verifier is implemented in the local alpha.15 fork. The proxy
synthetic test also generates and verifies a serialized sparse Presentation,
then confirms that the current strict parser rejects a gap-crossing read. No
claim is made that the current FUSOU Result profile accepts an incomplete
disclosure.

## Final classification

**Case B: local fork required; sparse implementation complete for the
cryptographic and reader boundary.**

The alpha.15 cryptographic model can verify disclosed ranges without reading a
materialized byte for every omitted offset. The local fork implements the
storage/accessor and verifier changes while preserving hash-opening, Notary,
server-identity, and blind-ZK semantics. FUSOU remains complete-disclosure for
the existing Result schema until a sparse profile defines authenticated digest
semantics.

## Security regressions

- TLSN integrity: **PASS**. Existing `Presentation::verify` and hash-opening
  checks remain unchanged.
- Notary identity: **PASS**. Trusted Notary key checking remains unchanged.
- Server identity: **PASS**. Existing certificate/server identity validation
  remains unchanged and fail-closed.
- Evidence Root: **PASS**. No Evidence Root code or trust input changed.
- Result signature: **PASS**. No Result canonicalization or signing path changed.

## Remaining work

1. Upstream the local alpha.15 sparse `PartialTranscript` and range-reader
  changes if compatibility with the public TLSN repository is required.
2. Define whether a future sparse FUSOU profile retains a full raw transcript SHA-256;
   if so, add a separate authenticated full-transcript commitment/opening
   protocol.
3. Add a serialized sparse Presentation fixture and test disclosed-byte tamper
   failure plus range metadata/opening tamper failure.
4. Measure full Presentation verification at 1/4/8/16/32 MiB using generated
  authenticated fixtures; the current probe measures sparse storage only.
