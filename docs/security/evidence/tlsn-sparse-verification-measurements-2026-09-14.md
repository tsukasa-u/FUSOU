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
| Sparse cryptographic scaling | PARTIAL | 0 and 1 KiB synthetic padding cases passed; 1 MiB and larger fixture generation exceeded the current 180-second budget |
| Full Presentation memory behavior | BLOCKED | No valid large alpha.15 cryptographic fixture was produced |
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
TLSN_SPARSE_CRYPTO_BENCHMARK_PADDING_BYTES=0,1024 node --expose-gc scripts/sparse-crypto-benchmark.mjs
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

Latest recorded run with synthetic response padding:

| Padding | Presentation bytes | Result bytes | Elapsed | Signature verified | Mutation checks | Mutations rejected |
| ---: | ---: | ---: | ---: | --- | ---: | ---: |
| 0 B | 1,999 B | 1,836 B | 12.94 ms | true | 8 | 8 |
| 1,024 B | 1,998 B | 1,839 B | 13.32 ms | true | 8 | 8 |

The mutation set covers revealed range bytes, transcript size, profile hash, disclosure mode, Presentation hash, binding value, profile ID, and range boundary. Presentation size and timing may vary slightly because a synthetic fixture is generated for each run.

A 1 MiB synthetic alpha.15 fixture and larger cases did not complete within the current 180-second fixture-generation budget. No large cryptographic latency or memory claim is made from those blocked cases. The existing 16 MiB Rust response limit and 8 MiB Trigger Presentation input limit were not raised to force the measurement.

## Production Boundary

No external network or production credential was used for these measurements. The following remain unverified and must not be inferred from this report:

- real Game Server connection;
- real TLSN Notary interaction;
- production Session/Binding authority;
- production Worker or Trigger execution;
- production result-key publication and rotation;
- full Presentation memory behavior at production-sized inputs.

Therefore `production_evidence` and `P0-05` remain `BLOCKED`.
