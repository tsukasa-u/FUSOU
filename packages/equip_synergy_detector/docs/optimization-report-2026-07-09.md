# equip_synergy_detector optimization report (2026-07-09)

## Scope

This document records the performance and portability investigation performed for `equip_synergy_detector`.

Constraints kept throughout the successful path:

- `strict_nminus1 = true`
- `allow_duplicate_items = true`
- correctness judged against the reference JSON output

The validated fastest equivalent result was:

- `node24_opt_w8_s256`
- runtime: Node 24
- result: `101.88s`
- correctness: `equivalent`

The operational defaults were updated to this validated path:

- workers: `8` max by default
- schedule shards: `256`
- strict mode: on
- duplicate-item mode: on

## What AST parsing is used for

`extract-ast.js` parses `output/deobfuscated.js` with `acorn` and extracts a routing table for equipment bonus logic into `synergy_dict*.json`.

What it helps with:

- identifies candidate bonus rules without repeatedly black-box probing the whole bundle
- reduces the amount of logic that `scan-ast.js` needs to consider per phase

What it does not solve:

- the expensive part of the job is still combination enumeration and strict N-1 validation in `scan-ast.js`
- AST parsing alone does not produce the final answer or remove the need for runtime validation

In the successful optimization path, AST parsing remained useful as preprocessing, but the main speedup came from runtime-side improvements in `scan-ast.js`, especially rule indexing by ship and safe parallel scheduling.

The scheduler estimate is intentionally conservative:

- it counts only items that are actually equipable by the ship under the current slot restrictions
- it includes normal-slot permission checks, slot-index restrictions, and exslot-specific rules
- it does not try to simulate every synergy condition while estimating work, because that would make the scheduler as expensive as the scan itself
- improvement stars are handled later in the actual effect evaluation via `getMakeSlot(itemId, star)` and are therefore not part of the scheduler estimate

That means the order is useful for load balancing, not for exact combinatorial accounting. Exact correctness is still validated by the actual scan output comparison.

## Successful attempts

### 1. Node 24 optimized parallel scan

Configuration:

- runtime: Node 24
- workers: 8
- schedule shards: 256
- strict mode: enabled
- duplicate-item mode: enabled

Outcome:

- `101.88s`
- equivalent to reference output
- fastest successful and correctness-preserving run in the benchmark set

Why it worked:

- ship-local rule indexing reduced repeated rule scans
- weighted parallel scheduling distributed heavy ships better
- 8 workers stayed within a correctness-safe operating range in measured runs
- the estimator already filtered out items that cannot be equipped because of normal-slot, exslot, and ship-specific permission checks

Comparison against other successful Node runs:

- faster than `node24_baseline_prev` (`111.37s`)
- faster than `node24_w8_s128` (`118.62s`)
- faster than `node24_w8_s256` (`117.85s`)
- faster than `node22_baseline_prev` (`115.89s`)
- faster than `node20_baseline_recheck` (`133.04s`)

### 2. Minimal kernel extraction for load-time reduction

Artifacts created during investigation:

- `output/minimal_kernel_bundle.js`
- `output/kernel_load_bench.json`
- `output/bench/report/kernel_runtime_results.tsv`

Outcome:

- full bundle load: `1.231s`
- minimal kernel load: `0.206s`
- same observed synergy key count: `291`

Interpretation:

- useful as a load-surface reduction experiment
- not adopted as the production path because runtime portability and end-to-end execution parity were not completed

## Failed or rejected attempts

### 1. Node 24 with 16 workers

Variants observed:

- `node24_opt_w16_s256`
- `node24_opt_w16_s512`
- `node24_opt_maglev_w16_s512`

Failure mode:

- runtime completed
- output was `different`, not `equivalent`

Reason for rejection:

- user requirement was strict correctness with duplicate-item mode preserved
- faster wall-clock is irrelevant if output diverges

Operational consequence:

- defaults were capped to a validated worker count of 8

### 2. Turbofan-only and Maglev tuning beyond validated preset

Observed results:

- `node24_w8_s256_maglev`: `119.91s`, equivalent but slower than best
- `node24_w8_s256_turbofan`: `175.38s`, equivalent but much slower
- `node24_opt_turbofan_w16_s512`: `186.32s`, different and slow

Reason for rejection:

- no correctness gain
- slower than the validated best preset
- in some high-worker combinations also diverged

### 3. Bun runtime

Observed result:

- `bun_parallel_recheck`: fail

Failure mode:

- slot shard exited with code 1

Interpretation:

- current pipeline depends on Node-oriented process and module behavior
- Bun was not a drop-in runtime for this workload

### 4. QuickJS runtime

Observed result:

- `quickjs_qjs_recheck`: fail

Failure mode:

- `require is not defined`

Interpretation:

- current scripts are CommonJS/Node-oriented
- QuickJS shell environment does not satisfy those assumptions directly

### 5. GraalJS runtime

Observed result:

- `graaljs_js_recheck`: fail

Failure mode:

- `Cannot load module: path`
- minimal-kernel probe later failed with `window is not defined`

Interpretation:

- runtime surface still depends on Node builtins and browser globals in places
- extraction reduced load cost but did not eliminate platform assumptions

### 6. Hermes

Observed result:

- `hermesc_compile_recheck`: success

Failure mode in practice:

- compile-only success, no equivalent end-to-end runtime path established

Interpretation:

- compilation viability alone was insufficient for adoption

### 7. GraalVM native-image sanity route

Observed result:

- `graalvm_native_image_sanity`: success (`12.72s`)

Reason it was not adopted:

- this was only a Java sanity sample, not the real JS synergy pipeline
- no end-to-end correctness-preserving synergy output was produced through this path

### 8. `ts-migrate -> Cheerp` attempt

Work area:

- `output/tsmigrate_cheerp_try/`

Observed results:

- `ts-migrate-full` started successfully
- produced `src/deobfuscated.ts`
- default-memory run OOMed during `declare-missing-class-properties`
- 16GB retry did not complete in a usable timeframe
- strict project typecheck had `377782` errors
- relaxed project typecheck still had `291663` errors
- relaxed emit did produce syntactically valid JS
- Cheerp compiler was not installed at `/opt/cheerp/bin/clang++`

Interpretation:

- raw bundle-scale TypeScript migration is too large and too dynamic to be a practical direct route here
- even when TS text exists, it is far from a usable typed input for native compilation

### 9. Minimal kernel cross-runtime execution

Observed results from `kernel_runtime_results.tsv`:

- Node runtime probe failed because the probe expected a different exported shape
- GraalJS failed with `window is not defined`
- QuickJS failed because `require` was unavailable
- Hermes compiled bytecode with warnings only

Interpretation:

- extraction was enough to reduce load size
- extraction was not enough to make the bundle runtime-neutral

## Code changes kept

The codebase was cleaned to retain the validated path and remove experiment-first defaults.

Kept direction:

- `generate-synergy-latest.sh` now defaults to the validated safe preset
- `scan-ast-parallel.js` defaults align with the validated preset
- benchmark summary file keeps only the best equivalent result in `output/bench/report/final_results.tsv`
- `verify-best-600-650.sh` was added for repeatable revalidation

Removed direction:

- stale experimental benchmark and kernel-extraction scripts were removed from the main code path
- detailed trial history was moved into this document instead of staying as active operational code

## Verification performed after cleanup

Checks run:

- syntax and diagnostics for modified JS files
- validated preset regeneration and comparison command wiring
- benchmark result curation

Recommended verification command for future reruns:

```bash
pnpm run verify:best:600-650
```

This command keeps the required correctness constraints:

- strict mode on
- duplicate-item mode on

## Summary

Production recommendation:

- use Node 24 when available
- use workers `8`
- use schedule shards `256`
- keep strict N-1 enabled
- keep duplicate-item mode enabled

Rejected options were rejected for one of two reasons only:

- they were slower than the validated best path
- they produced different results or failed to run end-to-end
