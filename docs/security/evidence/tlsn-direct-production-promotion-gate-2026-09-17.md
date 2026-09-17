# TLSN Direct Production Promotion Gate

Date: 2026-09-17
Baseline: `5d4043092106cbe35168fecc94b8a7fb92f009e8`
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
| Result PUT before consume rejection | PASS | local Result race: `result_put=1`, `result_delete=0`, `result_put_before_consume_rejected=true`, `result_object_retained=true`, no consume completion |
| Failed Result is not authoritative | PASS | failed public status remains `not_verified`; retained test object is not exposed by status |
| Consumed binding resists late failure/mutation | PASS | local duplicate completion remains idempotent; mismatched callback after consumed does not change verified status |
| Authenticated malformed callback is non-mutating | PASS | wrong Presentation/profile acquisition returns a bounded error without finalizing the binding |
| Remote malicious callback corpus | PASS | Test Worker report `packages/FUSOU-TLSN-VERIFICATION-WORKER/artifacts/tlsn-remote-malicious-callback.json`: all 10 forged callbacks returned bounded rejection outcomes; failed binding remained `not_verified`; consumed duplicate was accepted idempotently; mutated callback returned `422 verification_result_mismatch`; consumed binding remained verified |
| Remote mixed failure concurrency | NOT_ESTABLISHED | local request-scoped controls pass; remote concurrency evidence has not been collected |
| Test/canary/production fault-control separation | PASS | test deploy allowlist contains test controls; canary/production deployment contracts do not contain them; canary/production Wrangler environments have no Direct binding |
| Production resource and SLO evidence | NOT_ESTABLISHED | no production deployment, production traffic, production isolate measurement, or production SLO sample was collected |
| Production operational telemetry and age alerts | NOT_ESTABLISHED | bounded telemetry contract is specified below, but production collection and alert delivery are not evidenced |
| Promotion decision | NOT_ESTABLISHED | remote mixed-failure, production-resource, and operational gates remain open |

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

## SLO Boundary

The existing test-only Direct latency measurements are useful for implementation comparison, but they do not prove production performance. Production SLO status remains NOT_ESTABLISHED because production traffic, production Durable Object/R2 resources, production concurrency, cold starts, resource limits, callback delivery, and operational telemetry were not measured.

No claim is made that Direct meets a production latency target. The remote malicious callback corpus passes for the test Worker; no claim is made that remote mixed failures pass until their remote report exists.

## Rollout and Rollback

Rollout is blocked at this gate. The intended rollout, after all criteria pass, is test evidence review, canary deployment with the existing canary contract, canary observation, and an explicit production approval record. Rollback is the existing deployment rollback to the last approved production provenance; it does not enable Direct binding or add retries.
