# TLSN Remote Worker Latency Investigation

Date: 2026-09-16
Status: measurement blocked; no latency result established
Scope: self-contained test Worker, test Durable Object, test R2, and dedicated Trigger.dev project

## Executive Status

| Area | Status | Evidence |
| --- | --- | --- |
| dotenvx secret/config persistence | PASS | Encrypted Worker environment and key file were used; secrets were not printed |
| Test Worker deployment | PASS | Final deployment `e38c3df9-7f0f-4c58-ba9f-272d5b8f7cf6` |
| Trigger deployment | PASS | Dedicated project deployment `20260915.3` |
| Remote preflight | PASS | Full matrix accepted: 20 samples, `p50,p95,p99,max`, concurrency `1,2,4,8` |
| Session issuance | PASS | `/attestation/session` returned HTTP `201`; final binding TTL was approximately 900 seconds |
| Remote asynchronous verification | BLOCKED | Status polling remained `202` until the five-minute limit |
| Latency report artifact | NOT GENERATED | The benchmark writes the report only after a complete row; no artifact was produced |
| 3000 ms target decision | NOT ESTABLISHED | No complete sample set or percentile summary exists |

The benchmark did not access the Game Server and did not replay a Game Server request. The fixture generator used repository-local synthetic TLSN fixture material with a newly issued remote binding for each session.

## Intended Measurement

The requested matrix was:

- 20 samples per case and concurrency level;
- fixture cases `p50`, `p95`, `p99`, and `max`;
- concurrency levels `1`, `2`, `4`, and `8`;
- client-visible latency compared with a 3000 ms target at P95, P99, and Max.

The benchmark command was:

```sh
pnpm run tlsn:benchmark:remote:self-contained
```

The preflight output confirmed the full matrix and reported `network_check: NOT RUN`. This is intentional: the run used the self-contained test authentication path and did not contact the Game Server or replay an origin request.

## Observed Timeline

### 1. Initial binding issuance failure

The first remote run failed before measurement while generating the synthetic fixture with `InvalidBinding`. Direct session requests then returned HTTP `503`.

The temporary diagnostic path identified `binding_conflict`. The reported Durable Object name was always:

```text
47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU
```

This is SHA-256 of the empty string in base64url form. Session IDs changed between requests, so the collision was not caused by UUID generation.

### 2. Binding collision root cause

The encrypted test environment contained an empty `TLSN_TEST_BINDING_VALUE`. The request helper returned that empty string, and `issueBinding` selected it through nullish coalescing:

```ts
const bindingValue = configuredBindingValue ?? createBindingValue(sessionId, nonce);
```

An empty string is not nullish, so every request used an empty binding value and mapped to the same Durable Object name. The fix normalizes a trimmed empty configured value to `undefined` before selecting the generated binding.

After redeployment, a direct session request returned HTTP `201`, a 36-character UUID session ID, and a 108-character binding value.

### 3. Binding expiry during polling

The remote setup script originally generated `TLSN_BINDING_TTL_SECONDS=60`, while the benchmark also originally stopped status polling after 60 seconds. One run returned HTTP `410` from status polling, consistent with `binding_expired`.

The remote benchmark configuration was changed to a 900-second binding TTL, and the benchmark polling default was extended to 300 seconds. The deployed Worker was then checked directly: a new session had an expiry delta of approximately 899.5 seconds.

### 4. Current blocker

With the 900-second binding TTL deployed, the full benchmark still did not complete. The command ended with:

```text
[tlsn-remote-benchmark] remote status polling exceeded configured maximum
```

This run no longer failed with `410`; it remained in the status-polling path until the five-minute limit. No per-row summary was printed and no JSON artifact was written.

## Problem Areas and Suspicious Paths

These are prioritized investigation targets, not established root causes unless explicitly marked above.

### A. Trigger task start or callback completion

The Worker accepted the verification request sufficiently to return a job, but the status record did not reach a terminal result within five minutes. The likely boundary is between Trigger task acceptance, Trigger execution, callback delivery, and Worker completion processing.

Check:

- whether `tlsn-verify-presentation` was actually started in project `proj_lmzecjnplfmdbugpacax`;
- whether the task can reach the Worker internal input and completion endpoints;
- whether the deployed Trigger environment contains the current Worker URL and callback secret;
- whether the callback is rejected by HMAC, schema, binding, profile, or job-state validation;
- whether the task fails before sending the metadata-only completion callback.

### B. Worker internal URL and deployment consistency

The public Worker endpoint was reachable and session issuance succeeded, but that does not prove that Trigger uses the same deployed Worker origin or current deployment configuration. The internal URL is injected from the encrypted test environment and should be compared with the public test Worker origin without printing secrets.

### C. Durable Object job state

The status route can remain `202` while a job is `processing` or `verifying`. A callback that is never accepted, a lease that is repeatedly renewed or recovered, or a job stuck before `consumed` would all present as prolonged polling. The next diagnostic should expose only a safe state classification and error code, never job payloads, binding values, tokens, or response bodies.

### D. Trigger/R2/WASM execution duration

The local synthetic roundtrip path previously failed with `NoBindingAuthority`, so it is not evidence that the remote Trigger path is healthy. The remote path may also be failing during R2 input handoff or WASM verification. The current benchmark does not persist partial rows when a single sample times out, which makes the failure less observable.

### E. Configuration update discipline

An initial attempt to update the encrypted TTL appeared not to affect the decrypted value; a retry succeeded and was verified with `dotenvx get`. Any future configuration change must verify the decrypted value before deployment and verify the deployed behavior afterward.

## Validation Performed

| Command or check | Result |
| --- | --- |
| Worker TypeScript diagnostics | PASS; no diagnostics in edited Worker and benchmark files |
| `pnpm run typecheck` | PASS |
| `pnpm test` | FAIL; manifest/reflight passed, but the available summary exposed no specific failing test |
| `pnpm run test:app-roundtrip` | FAIL; `real_tlsn::tests::app_remote_worker_e2e::app_remote_worker_full_synthetic_e2e` failed with `NoBindingAuthority` |
| Remote preflight | PASS |
| WASM build | PASS |
| Direct remote session issuance after fixes | PASS; HTTP `201` |
| Full remote benchmark | FAIL/INCOMPLETE; status polling exceeded 300 seconds |

Temporary diagnostic response fields and error instrumentation used during binding investigation were removed before the final Worker deployment.

## Evidence Boundary and Decision

This run establishes deployment reachability, test authentication, session issuance, and two configuration defects. It does not establish remote verification latency, Trigger completion latency, R2/WASM latency, or any P50/P95/P99/Max result.

The 3000 ms target is therefore:

```text
NOT ESTABLISHED
```

No production conclusion should be drawn from this run. The next useful measurement is a single remote job with safe phase/state diagnostics and Trigger run inspection. Once one job reaches `verified`, the full matrix can be rerun without changing the target definition.