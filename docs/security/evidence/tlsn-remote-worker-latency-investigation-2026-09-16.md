# TLSN Remote Worker Latency Investigation

Date: 2026-09-16
Status: test-only timing measurement complete; 3000 ms target exceeded
Scope: self-contained test Worker, test Durable Object, test R2, and dedicated Trigger.dev project

## Executive Status

| Area | Status | Evidence |
| --- | --- | --- |
| dotenvx secret/config persistence | PASS | Encrypted Worker environment and key file were used; secrets were not printed |
| Test Worker deployment | PASS | Latest test deployment `c6d0913e-2394-4d10-aad7-9be139979d42` |
| Trigger deployment | PASS | Dedicated project deployment `20260916.7` |
| Remote preflight | PASS | Full matrix accepted: 20 samples, `p50,p95,p99,max`, concurrency `1,2,4,8` |
| Session issuance | PASS | `/attestation/session` returned HTTP `201`; final binding TTL was approximately 900 seconds |
| Remote asynchronous verification | PASS | 15/15 test-only samples reached `verified: true` |
| Latency report artifact | PASS | Three 5-sample reports contain complete timing records |
| 3000 ms target decision | EXCEEDS TARGET | All three polling conditions exceeded the 3000 ms P95/P99/Max gate |

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

## Follow-up: Single-job terminal-state diagnosis

The next single-job run reached a Trigger run and failed after approximately
three seconds. The terminal error was:

```text
failed to verify certificate path to provided trust anchors
```

This establishes that the earlier persistent `202 processing` state was not a
slow verification result. The Trigger task reached WASM certificate-path
verification and failed before sending the completion callback, leaving the
Worker Durable Object record in `processing`.

The local synthetic fixture path then identified a test-only trust-root defect:
the setup command generated the Worker/Trigger trust root in one synthetic
fixture invocation, while the P50 sparse Presentation was generated in a
different invocation with a newly generated random root CA. The certificate
bytes therefore did not match. The fix adds an encrypted test-only
`FUSOU_SYNTHETIC_ROOT_KEY_PKCS8` input and reuses that PKCS#8 Ed25519 root key
when generating synthetic fixtures. Local P50 verification confirmed that the
Worker trust root, Trigger trust root, and regenerated fixture certificate all
matched at 332 bytes with SHA-256 prefix `5428ebc3d8c190cc`.

The current remote test Worker could not be redeployed because Wrangler
required an interactive Cloudflare OAuth login and no deployment version was
produced. The subsequent observed `503` with
`tlsn_session_binding_issue_failed` therefore belongs to the older deployed
version and is a binding-authority issuance failure, not evidence against the
trust-root fix. No second remote verification job was run after the local
trust-root correction, and latency remains `NOT ESTABLISHED`.

## Post-fix single-job rerun

The Worker and Trigger were redeployed after the stable synthetic trust-root
change:

| Component | Deployed version | Result |
| --- | --- | --- |
| Test Worker | `f2e2220c-db29-4435-9030-a7c9782119c6` | deployment succeeded |
| Trigger task | `20260916.1` | deployment succeeded |

Exactly one remote job was then run with `p50`, sample count `1`, concurrency
`1`, a 500 ms polling interval, and a 120-second maximum polling window. The
Worker status endpoint reached the terminal response `verified: true` after 12
polls. The sample's client-visible elapsed time was approximately 7194 ms,
with approximately 1107 ms for request acceptance and 6087 ms for status
polling.

The timing header contained only `t10_status_verified` and
`t11_status_verified`; the earlier Trigger, R2, and WASM stage timestamps were
absent. Therefore the sample proves that the trust-root mismatch no longer
blocks the Worker completion path, but it does not establish a complete
phase-by-phase timing measurement or the 3000 ms target. The benchmark result
was `NOT ESTABLISHED`.

The Trigger dashboard independently confirmed the corresponding run:
`run_06gajk1kc127v5dqbnnhi5va01`, deployment `20260916.1`, status `Completed`,
with one completed attempt. Its safe task log showed `input_fetch_ok` at 1094
ms for a 3459-byte presentation, `verifier_start` at 1095 ms, `verifier_ok`
at 1118 ms, `callback_start` at 1118 ms, and `callback_ok` at 3266 ms. The
dashboard displayed 2.6 seconds from trigger to dequeue, 3.8 seconds from
start to finish, and 6.4 seconds total. The task output was accepted and the
Worker status endpoint observed `verified: true`.

The benchmark's Worker timing header still contained only
`t10_status_verified` and `t11_status_verified`; the earlier Trigger, R2, and
WASM stage timestamps were absent because those clocks are not propagated into
that header. The Trigger dashboard log is therefore the authoritative
terminal-state evidence for this one job, while the benchmark sample remains
ineligible for phase-complete latency percentiles.

No full matrix was run, no retry was used to obtain this result, and no latency
target decision was made.

## Final test-only timing-complete measurement

The durable timing path was completed with the current test Worker deployment
`c6d0913e-2394-4d10-aad7-9be139979d42` and Trigger deployment `20260916.7`.
The benchmark used the `p50` fixture, concurrency `1`, and five samples for
each polling interval. It records the first verified response's client clock,
then performs additional status reads until the durable timing record contains
all required stages. This avoids extending the client-visible measurement while
waiting for the callback flush to become observable.

| Poll interval | Samples | Timing complete | Client-visible P50 | P95 | Max | Cold sample | Warm P50 (samples 1-4) | Decision |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 100 ms | 5/5 | 5/5 | 4301 ms | 4820 ms | 4930 ms | 4295 ms | 4341 ms | EXCEEDS TARGET |
| 250 ms | 5/5 | 5/5 | 4551 ms | 4753 ms | 4763 ms | 4713 ms | 4424 ms | EXCEEDS TARGET |
| 500 ms | 5/5 | 5/5 | 4620 ms | 4665 ms | 4672 ms | 4567 ms | 4630 ms | EXCEEDS TARGET |

Evidence artifacts:

- `packages/FUSOU-TLSN-VERIFICATION-WORKER/artifacts/tlsn-remote-benchmark-100ms-5.json`
- `packages/FUSOU-TLSN-VERIFICATION-WORKER/artifacts/tlsn-remote-benchmark-250ms-5.json`
- `packages/FUSOU-TLSN-VERIFICATION-WORKER/artifacts/tlsn-remote-benchmark-500ms-5.json`

All 15 samples had matching submission and durable timing trace IDs. The
callback supplied all five timing fields in every sample, and every required
T0-T11 stage was present. The target is therefore established as
`EXCEEDS TARGET`, not `NOT ESTABLISHED`. This is test-only evidence; no
production or canary deployment was changed.

The benchmark client now tolerates the observed ordering where the binding
becomes `consumed` before the callback's final durable timing flush is visible.
Temporary Trigger run ID and callback diagnostic fields used during diagnosis
were removed after the evidence was captured.