# TLSN alpha.15 Range-Only Verification Investigation

Date: 2026-09-14

Baseline commit: `6c96f4cd6b282470ef969dfa8b79661600e939c7`

TLSN source inspected locally at:

- repository: `tlsnotary/tlsn`
- tag: `v0.1.0-alpha.15`
- commit: `47aee45b53e06648c1b2ad3689b367b8c923fdec`

This report distinguishes cryptographic requirements from the alpha.15
representation/API. It does not treat zero-filled bytes as authenticated and
does not change the current FUSOU `require_info` profile to sparse disclosure.

## Upstream investigation

### Call graph

The post-hoc Presentation path is:

```text
bincode::deserialize::<Presentation>
  -> serde deserializes TranscriptProof
  -> serde deserializes PartialTranscript
  -> CompressedPartialTranscript::into
       -> vec![0; sent_total]
       -> vec![0; recv_total]
       -> copy disclosed bytes into those vectors
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
            read plaintext[idx]
            hash plaintext[idx] || blinder
            compare with a Notary transcript commitment
       -> compare the authenticated range sets
  -> PresentationOutput { transcript: PartialTranscript }
```

The relevant upstream source is:

- `crates/attestation/src/presentation.rs:66-107`: `Presentation::verify`.
  This method invokes the attestation, identity, and transcript verifiers. It
  does not itself allocate the full transcript vector.
- `crates/core/src/transcript.rs:133-155`: `Transcript::to_partial`. The
  Prover-side proof builder calls this and allocates zero-filled vectors of the
  complete transcript lengths before copying disclosed ranges.
- `crates/core/src/transcript.rs:166-250`: `PartialTranscript` and its
  compressed serialization form. Deserializing the compressed form expands it
  into full-length vectors.
- `crates/core/src/transcript.rs:253-320`: `PartialTranscript::new`,
  `sent_unsafe`, `received_unsafe`, and authenticated range accessors.
- `crates/core/src/transcript/proof.rs:50-137`:
  `TranscriptProof::verify_with_provider`. It uses the full slices for length
  checks and indexes disclosed opening ranges, then verifies the hash openings
  and authenticated range sets.
- `crates/core/src/transcript/proof.rs:230-366`:
  `TranscriptProofBuilder::build`. It calls `Transcript::to_partial` and then
  serializes the disclosed bytes and range metadata.
- `crates/attestation/src/proof.rs:51-76` and `:101-128`: Notary attestation
  signature and body Merkle verification.
- `crates/tlsn/src/verifier/verify.rs:41-157`: live TLS verifier handling of
  the received `PartialTranscript`. It passes the full slices into plaintext
  authentication, although the partial path allocates and assigns only the
  `commit` union `reveal` ranges to the ZK VM.
- `crates/tlsn/src/transcript_internal/auth.rs:85-177`: the live plaintext
  verifier reads `plaintext[range]` for disclosed ranges and uses blind VM
  slices for undisclosed committed ranges.

### Why the full-length vectors exist

`CompressedPartialTranscript` already contains the sparse information needed
on the wire: authenticated bytes, their `RangeSet`s, and the total sent and
received lengths. The expansion occurs because the public `PartialTranscript`
API promises contiguous `sent_unsafe()` and `received_unsafe()` slices and
implements `len_sent`, `len_received`, `contains`, `iter`, and range indexing
against those vectors.

Therefore:

- The transcript lengths are cryptographically relevant metadata and must be
  retained.
- The disclosed bytes, ranges, hash algorithm, blinder/opening, and matching
  Notary commitment are cryptographically relevant for a disclosed range.
- Materializing zero-filled bytes for every undisclosed offset is not required
  by the hash-opening check.
- The current `TranscriptProof::verify_with_provider` uses a contiguous slice
  because that is the existing `PartialTranscript` API, not because it hashes
  undisclosed zero-filled bytes.
- `Presentation::verify` returns the already expanded `PartialTranscript`; the
  allocation is therefore an upstream representation/API consequence around
  verification, not an independent cryptographic operation inside
  `Presentation::verify`.

Classification: **C + D**, with a smaller **B-shaped** API requirement. The
cryptographic verifier needs total lengths and disclosed range material, but
not a materialized byte for every undisclosed offset. alpha.15's public type
and compatibility accessors force the materialization.

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

**NO** for a memory-bounded verifier boundary. The existing API exposes
`sent_unsafe()` and `received_unsafe()` as full contiguous slices. The existing
`sent_authed()` and `received_authed()` expose range metadata, but not a
range-only authenticated byte source.

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
rejects reads crossing an undisclosed gap. It currently wraps alpha.15's
already materialized bytes, so it is **not** an actual range-only
`Presentation::verify` result. `from_verified_alpha15_partial` rejects
incomplete alpha.15 disclosure. This is intentional: the current profile is
not allowed to silently accept a zero-filled sparse transcript.

A cryptographically connected sparse prototype therefore requires the
upstream patch above. No fake local adapter was added.

## Omitted-byte tamper experiment

The expected experiment is not representable as an alpha.15 Presentation
mutation:

1. The serialized partial transcript contains disclosed bytes, range metadata,
   and total lengths, not bytes for omitted offsets.
2. `CompressedPartialTranscript::into` creates zero-filled compatibility
   storage for omitted offsets only after deserialization.
3. `TranscriptProof::verify_with_provider` hashes bytes at each opening index;
   it does not hash the zero-filled gaps.
4. Changing a disclosed byte or opening metadata causes the hash opening or
   range-set check to fail.
5. Changing a byte in the compatibility zero-filled gap is not a change to the
   serialized Presentation and is not observed by the proof verifier.

Thus the result is not `PASS` for the requested omitted-byte mutation test.
It is **NOT TESTED / not representable through the current wire model**, and
zero-filled omitted bytes must not be called authenticated. The proposed
upstream range-only API would preserve this property by having no mutable
omitted-byte storage at all. It would authenticate disclosed ranges against
Notary commitments; it would not claim semantic authentication of values that
were intentionally not disclosed.

## Semantic parser

- Sparse request parser: **FAIL / not implemented**.
- Sparse response parser: **FAIL / not implemented**.
- Full transcript materialization in the current `require_info` profile:
  **YES**.

The current profile intentionally requires complete request and response
disclosure because it validates HTTP framing, duplicate headers, compression,
JSON structure, and the full request/response SHA-256 fields. A parser that
reads only selected syntax ranges would need a new profile contract defining
which omitted bytes are allowed and would not be able to preserve the current
full raw transcript digest without an additional cryptographic commitment
primitive.

The current FUSOU range boundary remains fail-closed and preserves the
existing strict parser checks. It is not connected to a sparse Presentation
until the upstream API exposes authenticated range bytes without full-vector
materialization.

## Memory

The scaling probe allocates `PartialTranscript::new(size, size)` and touches
both directions in one process. `VmHWM` is included as the process peak
resident metric. Values are KiB; each requested size is per direction.

| Each direction | VmSize before -> after | VmData before -> after | VmRSS before -> after | VmHWM before -> after |
| --- | ---: | ---: | ---: | ---: |
| 1 MiB | 3332 -> 5388 (+2056) | 236 -> 2292 (+2056) | 2112 -> 2120 (+8) | 2112 -> 2120 (+8) |
| 4 MiB | 3332 -> 11532 (+8200) | 236 -> 8436 (+8200) | 2112 -> 2120 (+8) | 2112 -> 2120 (+8) |
| 8 MiB | 3332 -> 19724 (+16392) | 236 -> 16628 (+16392) | 2112 -> 2120 (+8) | 2112 -> 2120 (+8) |
| 16 MiB | 3332 -> 36108 (+32776) | 236 -> 33012 (+32776) | 2112 -> 2120 (+8) | 2112 -> 2120 (+8) |
| 32 MiB | 3332 -> 68876 (+65544) | 236 -> 65780 (+65544) | 2116 -> 2124 (+8) | 2116 -> 2124 (+8) |

The VmData/VmSize delta is approximately twice the requested size because the
probe creates one full vector per direction. Linux zero pages make RSS/HWM a
poor indicator until those pages are written, so the virtual/data metrics are
the relevant evidence for this allocation path.

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
full-Presentation scaling curve. The scaling probe isolates the upstream
full-vector allocation, while the fixture probe confirms the actual
Presentation verification path and its process-lifetime peak metric.

## Before / after benchmark status

### Current alpha.15

```text
Presentation -> PartialTranscript full vectors -> disclosed-range hash checks
```

- Memory: linear in total sent plus received transcript length at the
  `PartialTranscript` representation boundary.
- CPU: hash-opening work is proportional to disclosed/opened bytes; vector
  zero-initialization/copy adds representation overhead.
- Disclosed bytes: current FUSOU profile reveals 100% of both directions.
- Transcript size: retained in full vectors and metadata.

### Proposed range-only verifier

```text
Presentation -> sparse authenticated ranges -> range-based semantic parser
```

- Memory: proportional to disclosed bytes, range metadata, and parser working
  state, if the upstream storage and verifier changes above are implemented.
- CPU: hash-opening work remains proportional to disclosed/opened bytes; range
  lookup adds bounded metadata work.
- Disclosed bytes: profile-defined ranges only.
- Full transcript digest: must be supplied through a separately designed
  authenticated commitment or removed from the sparse profile contract.

No before/after performance claim is made because the upstream range-only
verifier is not implemented in this repository.

## Final classification

**Case B: upstream API change required.**

The alpha.15 cryptographic model can verify disclosed ranges without reading a
materialized byte for every omitted offset, but the current public and
serialized `PartialTranscript` API expands sparse data into full-length
vectors. A safe implementation needs the upstream storage/accessor and
verifier changes described above. FUSOU must remain complete-disclosure until
that API and a compatible semantic profile exist.

## Security regressions

- TLSN integrity: **PASS**. Existing `Presentation::verify` and hash-opening
  checks remain unchanged.
- Notary identity: **PASS**. Trusted Notary key checking remains unchanged.
- Server identity: **PASS**. Existing certificate/server identity validation
  remains unchanged and fail-closed.
- Evidence Root: **PASS**. No Evidence Root code or trust input changed.
- Result signature: **PASS**. No Result canonicalization or signing path changed.

## Remaining work

1. Propose and review the alpha.15 upstream `PartialTranscript` sparse storage
   and range-reader patch.
2. Adapt `TranscriptProof::verify_with_provider` and the live verifier plaintext
   path to the range reader.
3. Define whether the sparse profile retains a full raw transcript SHA-256;
   if so, add a separate authenticated full-transcript commitment/opening
   protocol.
4. Implement a sparse strict HTTP/JSON parser only after the authenticated
   range API and profile contract are complete.
5. Add a real range-only Presentation fixture and test disclosed-byte tamper
   failure plus range metadata/opening tamper failure.
6. Measure full Presentation verification at 1/4/8/16/32 MiB using generated
   authenticated fixtures after the upstream patch.
