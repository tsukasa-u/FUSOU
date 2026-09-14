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
| Sparse cryptographic scaling | PARTIAL | 1 MiB sparse fixture generation and cached verification passed; 4/8/16/32 MiB cases remain unmeasured |
| Full Presentation memory behavior | BLOCKED | The measured 1 MiB sparse fixture intentionally has no full Presentation; no large full-Presentation fixture was produced |
| Production evidence | BLOCKED | No Game Server, Notary, production Worker, or production Trigger execution was contacted |

PASS in this report means that the repository property was verified within the stated synthetic/offline boundary. It does not promote synthetic evidence to production evidence.

## Changes Covered

- Sparse semantic parsing now skips undisclosed bytes only inside unknown JSON string values. Required HTTP structure, semantic keys, member ID bytes, JSON framing, and malformed gaps remain fail-closed.
- Sparse Result signing uses profile `fusou-require-info-v2-sparse`, version `2`, disclosure mode `sparse`, and domain `FUSOU-VERIFIER-SPARSE-RESULT-V1\0`.
- Sparse Result signatures cover profile identity, subject identity, binding fields, Presentation hash, transcript sizes, and revealed range metadata/bytes.
- Worker and Trigger payloads carry explicit `profile` and `disclosure_mode`. Retry inherits the persisted profile; an explicit opposite profile is rejected with `409 verification_profile_mismatch`.
- The benchmark verifies generated Ed25519 signatures and checks rejection of signed-Result mutations.

## Reproduction Commands

All commands below are offline and use synthetic fixtures. Run from `packages/FUSOU-TLSN-VERIFICATION-WORKER` unless noted otherwise.

```sh
node scripts/production-evidence-test.mjs
pnpm run typecheck
node scripts/test.mjs --app-roundtrip-only
pnpm run build:wasm
FUSOU_SYNTHETIC_PROOF_MODE=sparse TLSN_SPARSE_CRYPTO_BENCHMARK_PADDING_BYTES=1048576 pnpm run generate:sparse-fixtures
TLSN_SPARSE_CRYPTO_BENCHMARK_PADDING_BYTES=1048576 node --expose-gc scripts/sparse-crypto-benchmark.mjs
node scripts/sparse-parser-memory-benchmark.mjs
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
- Rust verifier library tests: PASS, 61 passed, 0 failed.
- Synthetic proxy alpha.15 focused test: PASS, 1 passed, 0 failed.
- `git diff --check`: PASS.

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

| Padding | Response transcript | Presentation bytes | Disclosed bytes | WASM verify | Result signing | Mutation checks | Mutations rejected |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 MiB | 1,048,727 B | 1,924 B | 400 B | 10.85 ms | 2.31 ms | 8 | 8 |

The post-fix fixture SHA-256 was `557fcebd813ba26e4efbc947e8f0d050fff869e771412e8e867b545bf780a9a9`. The sparse Presentation has no full Presentation counterpart because it was generated in sparse mode. The mutation set covers revealed range bytes, transcript size, profile hash, disclosure mode, Presentation hash, binding value, profile ID, and range boundary.

The 1 MiB synthetic alpha.15 fixture took 243.36 ms wall-clock, with 131.66 ms in proof generation and 29.06 ms in `prover.prove`. Its peak Rust process RSS was 229,822,464 B. The 4/8/16/32 MiB cases were not forced; no larger cryptographic latency or memory claim is made. The existing 16 MiB Rust response limit and 8 MiB Trigger Presentation input limit were not raised to force the measurement.

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

- 1 MiB -> 229,822,464 B peak RSS (about 219 MiB) / 29.06 ms `prover.prove`.

Sparse cryptographic verification: `PASS` for the local synthetic 1 MiB case.

Sparse semantic verification: `PASS` in the local synthetic scope.

Sparse Result signing: `PASS`; 8/8 signed-Result mutations rejected.

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
