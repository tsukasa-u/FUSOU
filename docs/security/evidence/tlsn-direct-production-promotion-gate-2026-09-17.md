# TLSN Direct Production Promotion Gate

Date: 2026-09-17
Baseline: `846cf669af2ce499f8b6bc0d97fb4ddc917a3ad2`
Scope: test-only Direct Service Binding path and promotion evidence; no canary or production deployment

## Decision

Production promotion status: **NOT_ESTABLISHED**.

The Direct architecture remains test-valid. This document does not approve a production or canary deployment. Queue and Trigger are not reintroduced by this work, and no retry mechanism is added.

## Promotion Matrix

| Gate | Status | Evidence or blocker |
| --- | --- | --- |
| Direct architecture remains test/evidence-only | PASS | `wrangler.toml` defines `TLSN_DIRECT_VERIFIER` only under the test/evidence environments; canary and production have no Direct Service Binding |
| Isolated evidence deployment | PASS | Dedicated evidence Worker/verifier, evidence R2/DO resources, `environment=test`, `deployment_role=evidence`, random bindings, and `execution_mode=direct`; deploy command: `pnpm -w run tlsn:deploy:evidence` |
| Test Direct success/failure/timeout | PASS | `scripts/test.mjs`, `Direct success, service-binding failure, timeout` assertions |
| Request-scoped mixed fault control | PASS | `X-FUSOU-TLSN-Test-Fault` is accepted only when `TLSN_ENVIRONMENT` is `test`; local `header_failure` and `header_timeout` cases pass |
| Result PUT before consume rejection | PASS | local Result race: `result_put=1`, `result_delete=0`, `result_put_before_consume_rejected=true`, `result_object_retained=true`, no consume completion; remote harness sends the same test-only pause control |
| Remote Result-race evidence | PASS | remote test Worker exit `0`: one Direct invocation, Result PUT retained before rejected consume, no delete, retry returned `409 verification_retry_disabled`, and hashed job/trace telemetry correlated with the submitted values |
| Failed Result is not authoritative | PASS | failed public status remains `not_verified`; retained test object is not exposed by status |
| Consumed binding resists late failure/mutation | PASS | local duplicate completion remains idempotent; mismatched callback after consumed does not change verified status |
| Authenticated malformed callback is non-mutating | PASS | wrong Presentation/profile acquisition returns a bounded error without finalizing the binding |
| Remote malicious callback corpus | PASS | Test Worker report `packages/FUSOU-TLSN-VERIFICATION-WORKER/artifacts/tlsn-remote-malicious-callback.json`: all 10 forged callbacks returned bounded rejection outcomes; failed binding remained `not_verified`; consumed duplicate was accepted idempotently; mutated callback returned `422 verification_result_mismatch`; consumed binding remained verified |
| Remote mixed failure concurrency 4 | PASS | remote test Worker exit `0`: failure, timeout, and two successes each used an independent canonical binding; every attempt had one Direct invocation and matching hashed telemetry |
| Remote mixed failure concurrency 8 | PASS | remote test Worker exit `0`: failure and timeout remained `not_verified` with zero Result PUT; six successes were verified with one Result PUT and consumed authority state; all attempts had matching hashed telemetry |
| Remote Direct evidence resource behavior | PASS | [`tlsn-remote-evidence-direct-c1-c4-c8.json`](../../../packages/FUSOU-TLSN-VERIFICATION-WORKER/artifacts/tlsn-remote-evidence-direct-c1-c4-c8.json): 65/65 samples completed and consumed; no Result deletes; max verifier concurrency 1/2/3 at C=1/4/8; cold/warm proxy observations 1+4, 4+16, and 8+32 |
| Remote Direct latency regression target | PASS | Same artifact: client-visible max 2522.9 ms at C=1, 2626.4 ms at C=4, and 2922.5 ms at C=8; every row is `MEASURED WITHIN TARGET` against the existing 3000 ms benchmark target |
| Direct Presentation byte fast path | PASS (local) | Direct keeps the initial input R2 PUT, sends the original Presentation bytes through the Service Binding with signed metadata, verifies the received SHA-256, and skips only the verifier-side input R2 GET; local Direct Case A/B/C and mixed-failure suites pass |
| Optimized remote Direct resource behavior | PASS (evidence only) | [`tlsn-remote-direct-fastpath-c1-c4-c8.json`](../../../packages/FUSOU-TLSN-VERIFICATION-WORKER/artifacts/tlsn-remote-direct-fastpath-c1-c4-c8.json): 65/65 samples completed and consumed; input PUT/DELETE and Result PUT matched every successful sample, Result DELETE remained zero, and verifier-side `worker_presentation_get` was absent |
| Optimized remote Direct latency | PASS (evidence only) | Same artifact: client-visible p50 was 2421.8 ms at C=1, 2276.7 ms at C=4, and 2238.7 ms at C=8; maxima were 2730.3, 2617.8, and 2716.7 ms, respectively, within the existing 3000 ms regression target |
| Real Presentation payload scaling | NOT_ESTABLISHED | [`tlsn-remote-direct-payload-scaling.json`](../../../packages/FUSOU-TLSN-VERIFICATION-WORKER/artifacts/tlsn-remote-direct-payload-scaling.json) and the optimized remote artifact: available real sparse Presentations were approximately 3.5 KiB (3459-3461 bytes); all 4 KiB-8 MiB target bands lack sufficient real fixture coverage; no padding was used |
| Remote stale-attempt and lease fencing | PASS | [`tlsn-remote-evidence-stale-attempt.json`](../../../packages/FUSOU-TLSN-VERIFICATION-WORKER/artifacts/tlsn-remote-evidence-stale-attempt.json): lease 5000 ms, post-result pause 7000 ms, Result PUT 1, consume rejected, retained Result, late callback 1, stale attempt rejected, terminal `lease_expired`, retry 409 |
| Test/canary/production fault-control separation | PASS | test deploy allowlist contains test controls; canary/production deployment contracts do not contain them; canary/production Wrangler environments have no Direct binding |
| Stuck-job age detector dry run | PASS | [`tlsn-stuck-job-age-alert-dry-run.json`](../../../packages/FUSOU-TLSN-VERIFICATION-WORKER/artifacts/tlsn-stuck-job-age-alert-dry-run.json): bounded processing/verifying state counts and one verifying age alert were classified; production delivery remains `NOT_ESTABLISHED` |
| Production resource and SLO evidence | NOT_ESTABLISHED | no production deployment, production traffic, production isolate measurement, or production SLO sample was collected |
| Bounded benchmark telemetry contract | PASS | public benchmark headers omit raw `job_id` and `trace_id`; they expose fixed-length SHA-256 identifiers, bounded diagnostics, timings, R2 counts, and terminal outcome; local regression asserts raw identifiers are absent |
| Production operational telemetry and age alerts | NOT_ESTABLISHED | bounded telemetry and the test-only age-detector dry run are evidenced, but production collection and alert delivery are not |
| Promotion decision | NOT_ESTABLISHED | production-resource, production SLO, and operational alert gates remain open |

## Evidence Contract

Public and remote artifacts may contain only:

- HTTP status;
- bounded public status booleans and status codes;
- Direct invocation count;
- Result PUT count and Result hash presence, never the hash value;
- consume completion boolean;
- bounded completion failure code;
- bounded retention and deletion booleans;
- timing values and aggregate concurrency.

Artifacts must not contain callback bodies, HMAC values, callback secrets, access tokens, binding values, nonces, Presentation bytes, signed Result JSON, signatures, or raw exception text.

Benchmark artifacts may additionally contain bounded Presentation, Result, request, and client-response byte counts, plus aggregate phase durations. These counts do not include payload contents or cryptographic material.

Benchmark headers may contain `job_id_sha256` and `trace_id_sha256` as fixed-length base64url SHA-256 correlation values. They must not contain the corresponding raw identifiers. Diagnostic values are limited to enumerated outcomes and booleans; queue message identifiers are represented only as a presence boolean.

The deterministic local Result race uses a lease shorter than the pause after Result persistence. The test-only object retention exists only to prove that an R2 object without a successful authority consume is not a client-authoritative Result. Production behavior does not retain failed attempt objects through this control.

## Remote Validation

The prepared malicious-callback command is:

```sh
pnpm run benchmark:tlsn-remote:malicious-callback
```

It requires two independent test binding values, a test-only callback secret, and encrypted dotenv inputs. It creates a failed binding, sends invalid-signature and valid-HMAC forged callbacks for wrong job, binding, session, user, device, Presentation, and profile, then verifies that the binding remains `not_verified`. It also creates a separate successful binding, checks a valid duplicate callback, sends a mutated callback, and verifies that the binding remains verified.

The command was executed against the configured test Worker. The bounded report is `packages/FUSOU-TLSN-VERIFICATION-WORKER/artifacts/tlsn-remote-malicious-callback.json`; it is evidence only for the test Worker and cannot establish a production SLO.

The isolated Direct evidence benchmark was run with:

```sh
pnpm exec dotenvx run --strict --overload -f packages/FUSOU-TLSN-VERIFICATION-WORKER/.env -fk packages/.env.keys -- env TLSN_REMOTE_BENCHMARK_WORKER_URL=https://fusou-tlsn-verification-evidence.ogu-hide-u-425.workers.dev TLSN_REMOTE_AUTH_MODE=test TLSN_REMOTE_EXPECTED_ENVIRONMENT=evidence TLSN_REMOTE_EXECUTION_MODE=direct TLSN_REMOTE_CONCURRENCY=1,4,8 TLSN_REMOTE_SAMPLE_COUNT=5 TLSN_REMOTE_CASES=p50 TLSN_REMOTE_BENCHMARK_REPORT_PATH=packages/FUSOU-TLSN-VERIFICATION-WORKER/artifacts/tlsn-remote-evidence-direct-c1-c4-c8.json pnpm --dir packages/FUSOU-TLSN-VERIFICATION-WORKER run benchmark:tlsn-remote
```

The stale-attempt evidence was run against the same evidence Worker after an evidence-only deploy with `TLSN_TEST_VERIFICATION_LEASE_MS=5000` and `TLSN_TEST_POST_RESULT_DELAY_MS=7000`:

```sh
pnpm exec dotenvx run --strict --overload -f packages/FUSOU-TLSN-VERIFICATION-WORKER/.env -fk packages/.env.keys -- env TLSN_REMOTE_BENCHMARK_WORKER_URL=https://fusou-tlsn-verification-evidence.ogu-hide-u-425.workers.dev TLSN_REMOTE_AUTH_MODE=test TLSN_REMOTE_EXPECTED_ENVIRONMENT=evidence TLSN_REMOTE_EXPECTED_LEASE_MS=5000 TLSN_REMOTE_STALE_SETTLE_MS=8000 TLSN_REMOTE_STALE_REPORT_PATH=packages/FUSOU-TLSN-VERIFICATION-WORKER/artifacts/tlsn-remote-evidence-stale-attempt.json pnpm --dir packages/FUSOU-TLSN-VERIFICATION-WORKER run benchmark:tlsn-remote:stale-attempt
```

The age-alert dry run command was `pnpm --dir packages/FUSOU-TLSN-VERIFICATION-WORKER run test:stuck-job-age-alert`; its report is `packages/FUSOU-TLSN-VERIFICATION-WORKER/artifacts/tlsn-stuck-job-age-alert-dry-run.json`.

The optimized Direct path was deployed and measured only on the isolated evidence Worker. The report is `packages/FUSOU-TLSN-VERIFICATION-WORKER/artifacts/tlsn-remote-direct-fastpath-c1-c4-c8.json`; it contains 65/65 successful samples across C=1/4/8, bounded byte telemetry, and no verifier-side `worker_presentation_get`. The benchmark used cached real sparse fixtures without padding or arbitrary payload append. No canary or production binding/configuration is part of this change.

There was no separate production callback HTTP hop to remove. The optimization removes the verifier-side Presentation R2 GET by carrying the original bytes in the existing Service Binding invocation. The initial input R2 PUT, signed metadata HMAC, Presentation hash binding, Result PUT, and Durable Object consume remain authoritative checks.

## Canary Entry Criteria

Canary entry requires all of the following to be independently evidenced:

1. Remote malicious callback corpus is PASS with no state corruption.
2. Remote mixed-failure concurrency is PASS with independent binding, attempt, Result, and terminal-state outcomes.
3. Test Result-race Case A/B/C evidence is PASS, including late callback fencing and consumed-state monotonicity.
4. Canary configuration contains no test fault controls, no test callback secret, no test binding values, and no Direct Service Binding.
5. Canary resource limits, cold-start behavior, concurrency, and latency are measured on canary resources.
6. Operational telemetry and age alerts are deployed and observed in a dry run.
7. The production SLO target and error budget are defined from production-like evidence, not test-only timing.
8. A signed deployment provenance record names the exact commit, configuration identity, trust root, verifier key, and result-key registry.

Until each condition is PASS, the canary gate remains NOT_ESTABLISHED.

## Telemetry and Alerting Contract

The production path should emit bounded, aggregation-safe fields only:

- deployment role and commit identity;
- execution mode;
- terminal outcome and bounded failure code;
- callback authentication/schema outcome;
- lease acquisition and lease-expiry counts;
- Result PUT, consume, and missing/mismatched Result counts;
- Direct or asynchronous invocation timeout/non-OK counts;
- sampled p50/p95/p99/max completion latency;
- age histogram for `processing` and `verifying` jobs.

An alert must fire when a job remains `processing` or `verifying` beyond the configured lease plus an operational margin, when terminal failure or callback non-OK rates exceed the approved threshold, when a consumed binding lacks a valid Result, or when the latency SLO burns its error budget. Alert payloads must contain only aggregate counts, bounded codes, deployment identity, and safe time windows.

Production telemetry and alert delivery remain NOT_ESTABLISHED until a production-like environment records and verifies these fields without secret or user-data leakage.

## Result Authority State Machine

```text
active -> processing -> verifying -> consumed
					   |             |
					   +-> failed    +-> verified status after matching Result validation

R2 Result PUT is non-authoritative until the Durable Object consume transition succeeds.
Lease expiry or verifier failure moves verifying -> failed.
Status returns verified only when the binding is consumed and the matching R2 object
passes the stored SHA-256 and final Result schema checks.
```

The local race deliberately pauses after the Result PUT while the lease expires. This proves that a retained R2 object alone cannot promote a binding to `verified`. Consumed callbacks are idempotent; callbacks after `failed` are rejected and cannot revive the binding.

## Remaining Gaps

- Production-like resource, cold-start, concurrency, latency, and SLO evidence remains absent; the measured resource and latency artifact is isolated evidence only.
- Real large Presentation fixtures and request-transcript coverage remain absent; the payload scaling artifact deliberately reports those bands as NOT_ESTABLISHED.
- Stuck-job age alert delivery remains unverified; only the bounded test-only detector dry run is PASS.
- The configuration audit proves environment binding and fault-control separation, but role-separated production key and trust-root provenance still requires an independently captured deployment record.

## SLO Boundary

The isolated evidence Worker recorded Direct latency within the existing 3000 ms benchmark regression target at C=1/4/8, but this does not prove production performance. Production SLO status remains NOT_ESTABLISHED because production traffic, production Durable Object/R2 resources, production concurrency, cold starts, resource limits, callback delivery, and operational telemetry were not measured.

No claim is made that Direct meets a production latency target. The remote malicious callback corpus, mixed-failure evidence, Direct benchmark, stale-attempt evidence, and age-detector dry run are all test/evidence-environment results only.

## Rollout and Rollback

Rollout is blocked at this gate. The intended rollout, after all criteria pass, is test evidence review, canary deployment with the existing canary contract, canary observation, and an explicit production approval record. Rollback is the existing deployment rollback to the last approved production provenance; it does not enable Direct binding or add retries.
