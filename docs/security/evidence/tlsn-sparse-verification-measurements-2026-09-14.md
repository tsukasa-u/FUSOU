# TLSNotary Sparse Verification Measurements

Date: 2026-09-14
Audience: independent audit AI
Scope: repository-owned TLSN alpha.15 sparse verification, sparse Result signing, Worker/Trigger profile integrity, and offline performance measurements.

## Executive Status

| Area | Status | Evidence boundary |
| --- | --- | --- |
| Sparse semantic verification | PASS | Synthetic alpha.15 Presentations and authenticated sparse parser tests only |
| Sparse Result schema and signing | PASS | Ed25519 signing, verification, mutation matrix, and cross-profile rejection passed offline |
| Worker/Trigger profile integrity | PASS | Local Wrangler Worker and synthetic Trigger callback passed complete/sparse retry matrix |
| Sparse parser memory behavior | PASS | Synthetic 1/4/8/16/32 MiB parser benchmark |
| Sparse cryptographic scaling | PASS | Required 4 KiB/16 KiB/64 KiB/256 KiB/512 KiB/1 MiB sparse matrix passed offline; 4/8/16/32 MiB extensions remain unmeasured |
| Full Presentation memory behavior | BLOCKED | The measured 1 MiB sparse fixture intentionally has no full Presentation; no large full-Presentation fixture was produced |
| Production evidence | BLOCKED | No Game Server, Notary, production Worker, or production Trigger execution was contacted |

PASS in this report means that the repository property was verified within the stated synthetic/offline boundary. It does not promote synthetic evidence to production evidence.

## Changes Covered

- Sparse semantic parsing now skips undisclosed bytes only inside unknown JSON string values. Required HTTP structure, semantic keys, member ID bytes, JSON framing, and malformed gaps remain fail-closed.
- Sparse Result signing uses profile `fusou-require-info-v2-sparse`, version `2`, disclosure mode `sparse`, and domain `FUSOU-VERIFIER-SPARSE-RESULT-V1\0`.
- Sparse Result signatures cover profile identity, subject identity, binding fields, Presentation hash, transcript sizes, and revealed range metadata/bytes.
- The sparse cryptographic claim covers only transcript ranges explicitly committed by the prover and disclosed in the sparse Result. Undisclosed transcript bytes are outside the claim scope; total transcript sizes remain signed metadata.
- Worker and Trigger payloads carry explicit `profile` and `disclosure_mode`. Retry inherits the persisted profile; an explicit opposite profile is rejected with `409 verification_profile_mismatch`.
- The benchmark verifies generated Ed25519 signatures and checks rejection of named signed-Result mutations, including disclosed bytes, range boundaries, and transcript sizes.

## Reproduction Commands

All commands below are offline and use synthetic fixtures. Run from `packages/FUSOU-TLSN-VERIFICATION-WORKER` unless noted otherwise.

```sh
node scripts/production-evidence-test.mjs
pnpm run typecheck
node scripts/test.mjs --app-roundtrip-only
pnpm run build:wasm
TLSN_SPARSE_CRYPTO_BENCHMARK_PADDING_BYTES=4096,16384,65536,262144,524288,1048576 pnpm run generate:sparse-fixtures
TLSN_SPARSE_CRYPTO_BENCHMARK_PADDING_BYTES=4096,16384,65536,262144,524288,1048576 node --expose-gc scripts/sparse-crypto-benchmark.mjs
node scripts/sparse-parser-memory-benchmark.mjs
pnpm run benchmark:sparse-scope

# Real repository fixture statistics; no network or credentials are used.
pnpm run stats:require-info-fixtures
```

Rust regression commands from the repository root:

```sh
CARGO_NET_OFFLINE=true cargo +1.95.0 test --lib --manifest-path packages/FUSOU-TLSN-VERIFIER/Cargo.toml
CARGO_NET_OFFLINE=true cargo +1.95.0 test --quiet --manifest-path packages/FUSOU-PROXY/proxy-https/Cargo.toml --features synthetic-tlsn --lib synthetic_tlsn::tests::synthetic_transport_uses_alpha15_and_preserves_wire_bytes -- --exact --nocapture
```

## Validation Results

- `node scripts/production-evidence-test.mjs`: PASS. Manifest, semantic, sparse Result, identity, replay, registry, and mutation checks completed successfully.
- `pnpm run typecheck`: PASS. WASM build and TypeScript checks completed successfully.
- `node scripts/test.mjs --app-roundtrip-only`: PASS. Complete and sparse Trigger flows, sparse Result version/profile, retry inheritance, and opposite-profile `409` rejection completed successfully.
- Rust verifier library tests: PASS, 62 passed, 0 failed.
- Sparse scope regression: PASS. Equal-length hidden response mutation remained valid; disclosed-range mutations rejected 2/2; transcript-size and general Result mutations rejected 8/8; complete-mode sanity passed; cross-profile verification was blocked.
- Synthetic proxy alpha.15 focused test: PASS, 3 passed, 0 failed.
- `git diff --check`: PASS.

## Real `require_info` Fixture Statistics

The offline `stats:require-info-fixtures` command inspected the repository-local
`packages/FUSOU-PROXY-DATA/<epoch>/kcsapi` corpus. It found 373 Q fixtures and
373 S fixtures across 16 epochs. Q/S pairing is reported only by ordinal within
each epoch; the Q and S metadata timestamps are not asserted equal.

These files are API fixtures, not raw HTTP transcripts. Each file contains a
metadata preamble followed by a query-string request or an `svdata=` response
body. They do not contain an HTTP status line, HTTP headers, TLS framing, or a
proven request/response transcript boundary. Therefore the HTTP transcript size
for this corpus is `NOT_ESTABLISHED`.

| Measurement | Min | P50 | P90 | P95 | P99 | P99.9 | Max | Mean |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Request fixture body bytes | 62 | 62 | 62 | 62 | 62 | 62 | 62 | 62.00 |
| Response fixture body bytes | 144,022 | 150,080 | 164,515 | 165,258 | 165,751 | 165,752 | 165,752 | 152,803.86 |
| Response JSON bytes after `svdata=` | 144,015 | 150,073 | 164,508 | 165,251 | 165,744 | 165,745 | 165,745 | 152,796.86 |

All 373 responses began with `svdata=`, parsed as JSON, had `api_result == 1`,
and contained every required `api_data` path used by the DTO and sparse semantic
validation, including `api_data.api_basic.api_member_id`. Metadata preambles were
54, 91, or 118 bytes. The script prints no query values, tokens, or response
bodies.

The largest observed fixture body is 165,752 bytes, so it is below the current
16 MiB `MAX_RESPONSE_TRANSCRIPT_BYTES` candidate by 16,611,464 bytes. This is
body-size headroom only; it does not validate the candidate limit or establish a
wire transcript limit. The real corpus supports production-representative API
body measurements at roughly 141-162 KiB. The existing 1 MiB and 32 MiB sparse
measurements remain synthetic stress cases, not representative real payload
sizes; 32 MiB has no corpus-based justification.

## Parser Memory Measurement

Latest recorded Linux/Node `v22.21.1` run:

| Transcript | Sparse disclosed | Sparse ratio | Sparse parse | Sparse RSS delta | Materialized parse | Materialized RSS delta |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 MiB | 134 B | 0.0001277924 | 1.168753 ms | 61,440 B | 1.044763 ms | 2,113,536 B |
| 4 MiB | 134 B | 0.0000319481 | 1.315778 ms | 57,344 B | 3.834926 ms | 8,409,088 B |
| 8 MiB | 134 B | 0.0000159740 | 0.987403 ms | 36,864 B | 7.996145 ms | 16,793,600 B |
| 16 MiB | 135 B | 0.0000080466 | 1.285620 ms | 53,248 B | 17.224014 ms | 33,570,816 B |
| 32 MiB | 135 B | 0.0000040233 | 1.042368 ms | 57,344 B | 42.031784 ms | 67,125,248 B |

The sparse parser retained only the disclosed semantic boundaries. The materialized comparison intentionally retained the complete synthetic response and is not a cryptographic verification measurement.

## Sparse Cryptographic Measurement

Latest recorded cached run with synthetic response padding:

| Padding | Transcript | Committed | Committed ratio | Disclosed | Disclosed ratio | Sparse Presentation | Fixture generation | `prover.prove` | Prover peak RSS | VmData | VmSize | WASM verify | Status |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 4 KiB | 4,493 B | 397 B | 0.088360 | 397 B | 0.034873 | 1,921 B | 190.584 ms | 48.522 ms | 165,486,592 B | 323,162,112 B | 4,507,070,464 B | 12.693 ms | PASS |
| 16 KiB | 16,782 B | 398 B | 0.023716 | 398 B | 0.009012 | 1,921 B | 179.714 ms | 41.225 ms | 144,867,328 B | 269,107,200 B | 4,507,070,464 B | 12.172 ms | PASS |
| 64 KiB | 65,934 B | 398 B | 0.006036 | 398 B | 0.002268 | 1,921 B | 184.438 ms | 45.184 ms | 163,127,296 B | 313,229,312 B | 4,507,070,464 B | 12.307 ms | PASS |
| 256 KiB | 262,543 B | 399 B | 0.001520 | 399 B | 0.000572 | 1,923 B | 184.624 ms | 42.119 ms | 173,256,704 B | 321,888,256 B | 4,507,070,464 B | 12.435 ms | PASS |
| 512 KiB | 524,687 B | 399 B | 0.000760 | 399 B | 0.000286 | 1,924 B | 199.998 ms | 16.305 ms | 188,887,040 B | 373,219,328 B | 4,507,070,464 B | 10.954 ms | PASS |
| 1 MiB | 1,048,976 B | 400 B | 0.000381 | 400 B | 0.000144 | 1,924 B | 219.725 ms | 29.161 ms | 220,073,984 B | 358,289,408 B | 4,508,643,328 B | 11.060 ms | PASS |

The disclosed ratio is relative to the response transcript; the committed ratio is relative to the combined request and response transcript. The sparse Presentation has no full Presentation counterpart because it was generated in sparse mode. The named mutation set covers revealed range bytes, transcript size, profile hash, disclosure mode, Presentation hash, binding value, profile ID, and range boundary. The request-side parser also rejects a sparse request when the authenticated `X-Attestation-Binding` value is hidden from the disclosed ranges.

The current 1 MiB synthetic alpha.15 fixture took 219.725 ms inside the fixture generator, with 120.166 ms in proof generation and 29.161 ms in `prover.prove`. Its peak Rust process RSS was 220,073,984 B. The 4/8/16/32 MiB cases were not forced; no larger cryptographic latency or memory claim is made. The existing 16 MiB Rust response limit and 8 MiB Trigger Presentation input limit were not raised to force the measurement.

### Sparse prover allocation root cause

Root cause:

- Before the fix, sparse mode committed the hidden response padding as well as the disclosed prefix and suffix. Alpha.15 `prove_plaintext` computes `commit union reveal`, allocates that union in the MPC VM, and builds the AES/ciphertext circuit over every allocated byte.
- The packed sparse `PartialTranscript` and the verifier's compatibility materialization were not the source of the 20 GiB peak. The large allocation occurred in the prover's ZK VM path.
- The sparse path now commits only the response ranges that it reveals. Hidden padding remains undisclosed and is not represented as an authenticated claim in the sparse profile.

Affected phase:

- `prover.prove`, specifically plaintext allocation and ciphertext/keystream circuit construction.

Complexity:

- At the TLSN layer, memory and circuit work are `O(C + R)`, where `C` is the committed plaintext range length and `R` is the revealed range length. The alpha.15 MPC VM has a large per-byte constant, so committing a 1 MiB hidden range is not a memory-bounded sparse operation.

Before:

- 1 MiB -> 21,728,813,056 B peak RSS (about 20.24 GiB) / 384.92 s `prover.prove`.

After:

- 1 MiB -> 220,073,984 B peak RSS (about 210 MiB) / 29.16 ms `prover.prove` in the current matrix run.

Sparse cryptographic verification: `PASS` for the local synthetic 1 MiB case.

Sparse semantic verification: `PASS` in the local synthetic scope.

Sparse Result signing: `PASS`; 8/8 general signed-Result mutations and 2/2 disclosed-range mutations rejected.

Sparse claim scope regression: `PASS`; equal-length hidden response mutation changed raw response bytes but preserved the transcript size, disclosed ranges, disclosed-byte digest, and verified member ID. Both sparse Results remained valid by design. Changing disclosed bytes, range boundaries, or signed transcript size was rejected.

Complete-mode sanity: `PASS` for a separate 4 KiB complete fixture and the complete verifier. Sparse and complete fixtures produced the same verified member ID (`16189463`); applying the wrong verifier to the wrong Presentation profile was blocked.

Full Presentation memory: `BLOCKED`; sparse fixtures intentionally do not contain a full Presentation.

Production evidence: `BLOCKED`; no Game Server, Notary, Worker, or Trigger execution was used.

## Production Boundary

No external network or production credential was used for these measurements. The following remain unverified and must not be inferred from this report:

- real Game Server connection;
- real TLSN Notary interaction;
- production Session/Binding authority;
- production Worker or Trigger execution;
- production result-key publication and rotation;
- full Presentation memory behavior at production-sized inputs.

Therefore `production_evidence` and `P0-05` remain `BLOCKED`.
