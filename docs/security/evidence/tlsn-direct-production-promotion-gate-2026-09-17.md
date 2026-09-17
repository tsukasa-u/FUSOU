# TLSN Direct Production Promotion Gate

Date: 2026-09-17
Baseline: `b6defa83b7a7c0c5ce3a58ecb585d129d15778eb`
Scope: test-only Direct Service Binding path and promotion evidence; no canary or production deployment

## Decision

Production promotion status: **NOT_ESTABLISHED**.

The Direct architecture remains test-valid. This document does not approve a production or canary deployment. Queue and Trigger are not reintroduced by this work, and no retry mechanism is added.

## Promotion Matrix

| Gate | Status | Evidence or blocker |
| --- | --- | --- |
| Direct architecture remains test-only | PASS | `wrangler.toml` defines `TLSN_DIRECT_VERIFIER` only under `[env.test]`; canary and production have no Direct Service Binding |
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
| Test/canary/production fault-control separation | PASS | test deploy allowlist contains test controls; canary/production deployment contracts do not contain them; canary/production Wrangler environments have no Direct binding |
| Production resource and SLO evidence | NOT_ESTABLISHED | no production deployment, production traffic, production isolate measurement, or production SLO sample was collected |
| Bounded benchmark telemetry contract | PASS | public benchmark headers omit raw `job_id` and `trace_id`; they expose fixed-length SHA-256 identifiers, bounded diagnostics, timings, R2 counts, and terminal outcome; local regression asserts raw identifiers are absent |
| Production operational telemetry and age alerts | NOT_ESTABLISHED | bounded telemetry contract is implemented for verification evidence, but production collection, stuck-job detection, and alert delivery are not evidenced |
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

Benchmark headers may contain `job_id_sha256` and `trace_id_sha256` as fixed-length base64url SHA-256 correlation values. They must not contain the corresponding raw identifiers. Diagnostic values are limited to enumerated outcomes and booleans; queue message identifiers are represented only as a presence boolean.

The deterministic local Result race uses a lease shorter than the pause after Result persistence. The test-only object retention exists only to prove that an R2 object without a successful authority consume is not a client-authoritative Result. Production behavior does not retain failed attempt objects through this control.

## Remote Validation

The prepared malicious-callback command is:

```sh
pnpm run benchmark:tlsn-remote:malicious-callback
```

It requires two independent test binding values, a test-only callback secret, and encrypted dotenv inputs. It creates a failed binding, sends invalid-signature and valid-HMAC forged callbacks for wrong job, binding, session, user, device, Presentation, and profile, then verifies that the binding remains `not_verified`. It also creates a separate successful binding, checks a valid duplicate callback, sends a mutated callback, and verifies that the binding remains verified.

The command was executed against the configured test Worker. The bounded report is `packages/FUSOU-TLSN-VERIFICATION-WORKER/artifacts/tlsn-remote-malicious-callback.json`; it is evidence only for the test Worker and cannot establish a production SLO.

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

- A remote stale-attempt representation, including an independently evidenced expired lease, has not been collected.
- Production-like resource, cold-start, concurrency, latency, and SLO evidence remains absent.
- Stuck-job age alert delivery and dry-run observation remain unverified.
- The configuration audit proves environment binding and fault-control separation, but role-separated production key and trust-root provenance still requires an independently captured deployment record.

## SLO Boundary

The existing test-only Direct latency measurements are useful for implementation comparison, but they do not prove production performance. Production SLO status remains NOT_ESTABLISHED because production traffic, production Durable Object/R2 resources, production concurrency, cold starts, resource limits, callback delivery, and operational telemetry were not measured.

No claim is made that Direct meets a production latency target. The remote malicious callback corpus passes for the test Worker; no claim is made that remote mixed failures pass until their remote report exists.

## Rollout and Rollback

Rollout is blocked at this gate. The intended rollout, after all criteria pass, is test evidence review, canary deployment with the existing canary contract, canary observation, and an explicit production approval record. Rollback is the existing deployment rollback to the last approved production provenance; it does not enable Direct binding or add retries.
