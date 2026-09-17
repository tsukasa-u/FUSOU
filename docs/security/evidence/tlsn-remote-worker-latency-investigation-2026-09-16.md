# TLSN Remote Worker Latency Investigation

Date: 2026-09-16
Status: post-one-shot Direct audit complete; production promotion NOT APPROVED
Scope: test-only Direct Service Binding, test Durable Object, and test R2; production and canary unchanged

The current promotion gate and follow-up evidence contract are tracked in
`docs/security/evidence/tlsn-direct-production-promotion-gate-2026-09-17.md`.

## Executive Status

| Area | Status | Evidence |
| --- | --- | --- |
| HEAD baseline | PASS | `2014e18b2321cd44878d77e24ad61d330e9b16af` |
| Direct concurrency matrix | PASS | `65/65` samples successful and timing-complete at concurrency `1,4,8` |
| Direct latency target | MEASURED WITHIN TARGET | Client-visible P99/Max was `626/626`, `662/662`, and `817/817 ms` for concurrency `1,4,8` |
| Direct terminal failure and no retry | PASS | Remote Service Binding failure and timeout both became terminal `not_verified`; retry returned `409` |
| Result PUT -> consume rejection race | NOT_ESTABLISHED | Remote race attempt observed `result_put_count: 0`; no claim is made |
| State-machine and public response audit | PASS / CODE-AUDITED | Local lease, stale callback, terminal failure, result-authority, and response assertions passed |
| Production/canary separation | PASS | Direct Service Binding and fault controls exist only in test configuration |
| Production promotion decision | NOT APPROVED | Production RSS, hard limits, production concurrency/SLO, malicious callback, and mixed-failure evidence remain incomplete |

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

## Test-only Queue A/B preparation

The Worker now has a test-only Queue execution mode, selected with
`TLSN_EXECUTION_MODE=queue`. The test Wrangler environment declares the
`TLSN_VERIFICATION_QUEUE` producer and consumer with batch size `1`; the base,
canary, and production environments remain unchanged.

Queue messages contain only the job metadata, profile, and Presentation hash.
The consumer validates the message schema, signs an in-process callback, and
routes it through the existing authenticated completion path. The completion
path still performs the Durable Object lookup and lease, R2 Presentation read
and hash check, Worker WASM verification, Result signing, Result persistence,
attempt-fenced consume, and input cleanup. The Queue message is therefore a
dispatch hint and is not an authorization source.

The remote benchmark accepts `TLSN_REMOTE_EXECUTION_MODE=trigger|queue` and
uses mode-specific required timing stages. Trigger timing now includes module
evaluation completion and WASM verifier initialization start/end. Queue timing
includes consumer start, Worker verifier start/end, and in-process callback
dispatch/response stages. Both modes use the same fixture generation,
authentication, profile, polling, Result schema, and target decision.

The Queue resource, test Worker deployment, and remote A/B traffic were then
performed using the same p50 fixture at concurrency `1` and five samples. The
results and the deferred benchmark-telemetry follow-up are recorded below.

## Test-only Queue A/B measurement and deferred telemetry follow-up

The initial Queue comparison used `max_batch_timeout = 0` and completed five
samples with test Worker version `909f5606-790e-4370-affe-23ebb201f68f`. The
Trigger comparison used test Worker version
`43a7367e-93bd-4a71-9622-6b6f9b478b45` and Trigger deployment `20260916.7`.
Both runs used the p50 fixture, concurrency `1`, a 100 ms polling interval,
and complete durable timing records.

| Execution mode | Timing complete | Client P50 | P95 | Max | Decision |
| --- | ---: | ---: | ---: | ---: | --- |
| Queue, `max_batch_timeout=0` | 5/5 | 3349 ms | 6795 ms | 6795 ms | EXCEEDS TARGET |
| Trigger baseline | 5/5 | 5220 ms | 7906 ms | 7906 ms | EXCEEDS TARGET |

The largest Queue phases in the baseline were Queue delivery (`trigger_queue_start`)
at P50 `1042 ms` and P95 `4033 ms`, followed by client-side status polling at
P50 `2562 ms` and P95 `5770 ms` in the saved artifact. Worker Queue verifier
time was P50 `246 ms` and P95 `289 ms`, so WASM verification was not the
dominant latency source.

The benchmark durable timing flush was then moved from the synchronous response
path to `ExecutionContext.waitUntil`. Queue test Worker version
`213f5fd6-168d-42df-8326-14e4152d00f9` completed five further samples:

| Execution mode | Timing complete | Client P50 | P95 | Max | Queue wait P50 | Queue wait P95 | Decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Queue, deferred flush | 5/5 | 3181 ms | 7445 ms | 7445 ms | 641 ms | 5245 ms | EXCEEDS TARGET |

The deferred-flush run reduced P50 by approximately `168 ms`, but worsened the
observed tail by approximately `650 ms`; this five-sample result does not show
a statistically reliable latency improvement. Queue callback dispatch remained
approximately `1684 ms` at P50, while Queue verifier time remained only
`323 ms` at P50 and `368 ms` at P95. The single post-change smoke sample was
also complete but remained above target at approximately `5138 ms`.

A matching five-sample Trigger run was attempted with Worker version
`734ccf72-9e0f-40a2-87d3-8c38a62f9036` and Trigger deployment `20260916.8`.
Four of five samples had complete timing. One sample reached `verified` before
the final callback timing flush became visible; another complete sample had a
Trigger scheduling delay of approximately `46464 ms`. The run therefore has
`NOT ESTABLISHED` target status and is not used as a replacement for the
complete Trigger baseline.

The current evidence identifies the optimization boundary:

- Queue delivery tail latency and Trigger platform scheduling are the largest
	asynchronous costs.
- The Queue callback path, including R2 and Durable Object operations, is the
	next significant cost.
- Worker WASM verification is comparatively small.
- Deferring benchmark persistence removes measurement overhead from the
	response path, but does not reduce Queue delivery or platform scheduling
	latency.

The Queue path has a lower observed P50 than the Trigger baseline, but both
paths exceed the 3000 ms P95/P99/Max gate, and the Queue tail remains highly
variable. This test-only evidence does not support replacing Trigger in
production. No production or canary Worker was deployed or modified.

Evidence artifacts:

- `packages/FUSOU-TLSN-VERIFICATION-WORKER/artifacts/tlsn-remote-benchmark-queue-0timeout-p50-c1-poll100-5.json`
- `packages/FUSOU-TLSN-VERIFICATION-WORKER/artifacts/tlsn-remote-benchmark-trigger-p50-c1-poll100-5.json`
- `packages/FUSOU-TLSN-VERIFICATION-WORKER/artifacts/tlsn-remote-benchmark-queue-deferred-flush-p50-c1-poll100-5.json`
- `packages/FUSOU-TLSN-VERIFICATION-WORKER/artifacts/tlsn-remote-benchmark-trigger-deferred-flush-p50-c1-poll100-5.json`

## Queue delivery and callback decomposition

The requested Phase A/B instrumentation was added to the test Worker and
deployed as test deployment `71c15de1-8a45-43a7-b46f-e5ce27af9eea`. It records
Queue producer send start/completion, Queue message acceptance, the consumer
entry points, `Message.id`, `Message.timestamp`, and `Message.attempts`. The
message timestamp is retained as metadata only: it is the message creation
timestamp, not a Cloudflare consumer scheduling timestamp. Cloudflare does not
expose the latter through the standard Queue `Message` API, so no
cross-runtime delivery duration is derived from it.

The callback breakdown records HMAC authentication, callback schema parsing,
completion entry, Durable Object binding lookup, lease acquisition, R2
Presentation read and hash, WASM verification, Result signing, Result R2
persistence, Durable Object consume, and completion response readiness. The
benchmark report retains raw timestamps, high-resolution durations where the
runtime exposes them, and safe Queue message diagnostics. Fast sub-millisecond
stages may appear as `0 ms` in the current Worker runtime's timing resolution;
they are not interpreted as absent work.

## Queue direct completion experiment

The Queue consumer no longer performs an `app.fetch()` call to the same
Worker's `/internal/tlsn/verification-complete` route. The HTTP route still
owns raw-body size limiting, HMAC verification, callback schema validation, and
execution-mode selection. Queue delivery constructs the same callback body and
HMAC, then invokes the shared authenticated completion implementation directly.
The shared implementation preserves binding authority lookup, profile and
identity checks, lease ownership, Presentation hash validation, WASM
verification, Result signing, private Result persistence, attempt-fenced
consume, input cleanup, and deferred timing persistence. Queue messages remain
dispatch hints and are not authorization sources.

The direct path was measured with the same requested conditions as the earlier
Queue baseline: p50 fixture, concurrency `1`, 100 ms polling, and five samples.
The test Worker deployment was `71c15de1-8a45-43a7-b46f-e5ce27af9eea`.

| Queue path | Timing complete | Client P50 | P95 | P99 | Max | Queue delivery P50 | Queue delivery P95 | Callback dispatch P50 | Callback dispatch P95 | Decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| HTTP completion hop baseline | 5/5 | 3349 ms | 6795 ms | 6795 ms | 6795 ms | 1042 ms | 4033 ms | 2126 ms | 2262 ms | EXCEEDS TARGET |
| Direct shared completion | 5/5 | 3231 ms | 4110 ms | 4110 ms | 4110 ms | 418 ms | 1646 ms | 1800 ms | 2479 ms | EXCEEDS TARGET |

The direct run's detailed P50/P95 phases were: Queue send `411/815 ms`, DO
binding lookup `424/479 ms`, lease acquisition `137/145 ms`, Presentation R2
read `304/373 ms`, Result persistence `455/1128 ms`, DO consume `118/132 ms`,
and completion response `178/197 ms`. Queue verifier time was `304/373 ms`.
The callback authentication, schema, Presentation hash, WASM, and signing
durations were below the deployed runtime's millisecond resolution in this
five-sample run. The aggregate direct callback dispatch remained
`1800/2479 ms`, so removing the local HTTP route hop did not bring the client
latency under the 3000 ms gate.

The before/after samples are matched on benchmark configuration but were taken
at different times and have only five observations each. The lower direct-path
P50 and improved P95 are therefore evidence that the hop can be removed, not a
controlled estimate of the hop's exact causal savings; Queue delivery itself
varied substantially between runs. The result does not support a production
Queue migration, and no production or canary configuration was changed.

The latest direct-path report is:

- `packages/FUSOU-TLSN-VERIFICATION-WORKER/artifacts/tlsn-remote-benchmark.json`

Local validation after the implementation passed `pnpm run typecheck`,
`pnpm exec tsc --noEmit`, benchmark script syntax checking, and `git diff
--check`. The existing `pnpm test` suite could not reach its callback/lease
regression assertions because its Supabase setup returned HTTP `503` instead
of the expected session `201`; this is an environment blocker, not a passed
security regression result.

## Completion path I/O integration investigation

The investigation was continued from commit
`cf9a8cec80e1b05f8c73f891526b952ae00f08ea`. Only the test Worker was deployed;
production and canary were not deployed or modified. The first optimization
was deliberately limited to the safest authority-side integration:
`lookupVerificationJob` and `acquireVerification` were combined into the
existing atomic Durable Object transaction used by `acquireVerification`.

### Phase 1: dependency and ordering map

The completion path has the following ownership and dependency model:

| Step | Owner/type | Depends on | Security-required ordering | Implementation-only serialization |
| --- | --- | --- | --- | --- |
| Queue receive | Cloudflare Queue dispatch | Queue send | No authority decision is made; the message is only a dispatch hint | Queue scheduling is outside the Worker completion code |
| Binding lookup + lease | One Durable Object transaction | Authenticated callback identity, job ID, presentation ID, profile, current status | Yes. Identity, binding, expiry, duplicate state, and attempt fencing must be checked before granting verifier ownership | The previous separate job lookup was redundant |
| Presentation GET | R2 GET | A valid acquired lease and the authority's input key | Yes. Reading before ownership would permit work for a stale or duplicate callback and can race cleanup | The GET itself cannot be parallelized with lease acquisition because the input key is authority state |
| Presentation SHA-256 | Worker CPU/Web Crypto | Presentation bytes from R2 | Yes. The digest must match the authority-bound presentation ID before verification | No meaningful remote I/O is involved |
| WASM verification | Worker CPU/WASM | Valid lease, verified Presentation bytes, profile and identity fields | Yes. Skipping or moving it after result persistence would weaken result authority | No remote I/O dependency |
| Result signing | Worker CPU/Web Crypto | Verified prepared result and derived signing bytes | Yes. The signed result is the only result eligible for persistence | No meaningful remote I/O is involved |
| Result PUT | R2 PUT | Signed final response and its SHA-256 | Yes. It must complete before authoritative consume records its object key and hash | It cannot safely race consume |
| DO consume | Durable Object transaction | Result PUT, result SHA-256, object key, lease attempt ID | Yes. This is the authoritative terminal transition and rejects stale owners | None without changing result authority |
| Input cleanup | R2 DELETE, plus failure lease release | Successful consume for input deletion; active lease for failure release | Successful cleanup must not precede consume; failure release must remain attempt-fenced | The successful-path DELETE can be deferred after consume, but was not changed in this one-optimization experiment |
| Status becomes verified | DO lookup followed by R2 GET/hash/parse on status polling | Consumed record, result key/hash, persisted Result | Yes. Client response is verified only after the authoritative record and persisted Result agree | Polling observation is separate from server completion |

The optimized path is therefore:

```text
Queue receive
	-> shared authenticated completion (HMAC + schema, no same-Worker HTTP hop)
	-> one DO transaction: lookup, identity/profile/presentation checks, expiry check, lease
	-> Presentation R2 GET + SHA-256 validation
	-> WASM verification
	-> Result signing
	-> Result R2 PUT
	-> DO authoritative consume with result SHA/key and attempt fencing
	-> input cleanup and failure-safe lease release
	-> status polling: DO lookup + Result R2 GET/hash/parse
	-> verified response
```

### Phase 2: binding lookup and lease integration

The authority transaction now validates session ID, canonical user ID, device
ID, verification job ID, presentation ID, profile, required input/result keys,
replay digest presence, binding expiry, consumed state, and an existing live
lease before writing `status: verifying`. A new attempt ID and result key are
written in the same transaction. The completion path still requires the
returned record to be `verifying` and to contain the requested attempt ID
before it reads R2 or runs WASM.

This preserves the relevant invariants:

- A stale attempt cannot consume because consume still requires the stored
	attempt ID, job ID, result key, result SHA-256, and live lease.
- A duplicate callback observes an existing lease or consumed state and does
	not obtain a second verifier owner.
- Expired, processing, verifying, consumed, and binding-expired states retain
	their existing authority decisions.
- Queue fields remain dispatch hints; the authority record remains the source
	of binding ID, session ID, canonical user ID, device ID, profile, and object
	keys.

### Phase 3: Presentation GET ordering

The three candidate orderings were evaluated as follows:

| Option | Decision | Reason |
| --- | --- | --- |
| A. Lease -> R2 GET -> verify | KEEP | The lease fences duplicate callbacks and stale attempts before remote input work. Hash binding and WASM verification remain mandatory. |
| B. R2 GET -> hash -> lease -> verify | DO NOT USE | The input key still comes from authority state, so this does not remove the DO dependency. It permits stale/duplicate callbacks to consume R2 work before ownership and makes cleanup races harder to reason about. |
| C. R2 GET and DO lease in parallel | DO NOT USE | The R2 key is authority-owned, and a pre-lease read can race expiry, duplicate ownership, or input deletion. Even if the final lease check rejects the work, the optimization spends remote I/O before the security gate and does not safely reduce the required authority interaction. |

Presentation substitution remains blocked by comparing the R2 bytes' SHA-256
with the authority-bound `presentation_id` and callback `presentation_id`.
Result authority remains independent of the Queue message.

### Phase 4 and 5: Result and R2 dependency review

The completion success path uses these R2 operations:

| Operation | Required? | Role |
| --- | --- | --- |
| Presentation GET | Yes | Supplies the bytes for hash binding and WASM verification |
| Presentation hash | Yes | Binds the fetched bytes to the claimed Presentation |
| Result PUT | Yes | Persists the exact signed response before DO consume |
| Result GET during status | Yes | Revalidates the persisted bytes against the authoritative Result SHA-256 before returning verified |
| Result GET on duplicate consumed callback | Yes | Prevents an accepted callback response from bypassing persisted-result integrity checks |
| R2 HEAD or metadata lookup | Not used | No separate HEAD or metadata-only access exists in this path |
| Input DELETE | Required cleanup | Removes the input after authoritative consume; failure cleanup removes an unconsumed attempt Result |

There is no duplicate Presentation GET, Result PUT, Result HEAD, or metadata
lookup in the successful completion request. Result PUT cannot be parallelized
with consume: consuming first would allow the DO to become authoritative for a
Result that is not yet durable. The current `finally` path also invokes the
attempt-fenced release method after success; the authority treats release on a
consumed record as a no-op. Removing that post-consume no-op is a possible next
small change, but it was intentionally not combined with this experiment.

### Phase 6: server completion versus client observation

The benchmark now reports both `server_completion` and `client_observation`.
`server_completion` is measured from the accepted `202` timestamp to
`t10_consume_completed`, the authoritative DO transition. `client_observation`
is measured from the client receiving the accepted response until the client
receives the first verified status response. `client_visible` includes request
acceptance as well.

The repaired test deployment was
`88c49f12-395d-4bcc-941f-510495d93128`. The run used p50, concurrency `1`,
100 ms polling, and five samples. All five samples reached complete timing.

| Phase | P50 | P95 | P99/Max | Interpretation |
| --- | ---: | ---: | ---: | --- |
| Queue send | 163 ms | 620 ms | 620 ms | Producer request to Queue acceptance |
| Queue delivery/start | 441 ms | 3742 ms | 3742 ms | Dominant tail before consumer entry |
| Fused DO lookup + lease | 447 ms | 488 ms | 488 ms | One authoritative DO interaction |
| Presentation R2 input | 345 ms | 680 ms | 680 ms | Includes R2 GET; hash was below 1 ms in the report |
| WASM verification | 0 ms | 0 ms | 0 ms | Below effective millisecond reporting resolution |
| Result persistence | 585 ms | 1036 ms | 1036 ms | Signed Result R2 PUT |
| DO consume | 152 ms | 161 ms | 161 ms | Authoritative consume transaction |
| Completion response | 198 ms | 214 ms | 214 ms | Includes the measured response-readiness phase |
| Server authoritative completion | 2014 ms | 5622 ms | 5622 ms | Accepted `202` to DO consume |
| Client observation | 2013 ms | 5642 ms | 5642 ms | Accepted response to first verified status |
| Client-visible | 2527 ms | 6505 ms | 6505 ms | Includes request acceptance and polling |

The artifact is:

- `packages/FUSOU-TLSN-VERIFICATION-WORKER/packages/FUSOU-TLSN-VERIFICATION-WORKER/artifacts/tlsn-remote-benchmark-do-fused-repaired-p50-c1-poll100-5.json`

The run exited with status `1` because the target gate was exceeded. This is a
completed measurement, not a benchmark execution failure. With five samples,
these values are directional evidence only and are not population estimates.

### Phase 9 and 10: result and next action

| Path | Phase structure |
| --- | --- |
| Current before this experiment | `Queue -> DO lookup -> DO lease -> R2 GET/hash -> WASM -> sign -> R2 PUT -> DO consume -> cleanup -> poll/status Result GET` |
| Optimized test path | `Queue -> shared HMAC/schema completion -> one DO lookup+validation+lease -> R2 GET/hash -> WASM -> sign -> R2 PUT -> DO consume -> cleanup -> poll/status Result GET` |

Compared with the earlier direct-completion run, this five-sample run measured
client-visible P50 `2527 ms` and P95 `6505 ms`. The earlier run measured
`3231/4110 ms`; the difference is not attributable solely to DO fusion because
Queue scheduling and R2 timing varied between runs. Relative to the same
repaired run's server completion, the remaining P95 is dominated by Queue
delivery (`3742 ms`), while the largest completion-path I/O phase is Result
persistence (`1036 ms`). The 3000 ms target was not reached at P95 or Max.

The next single change should be the safe removal of the post-consume no-op
lease release. Failure-path lease release must remain attempt-fenced. Input
cleanup should remain a separate later experiment rather than being combined
with this change. The no-op release removal must be measured separately before
any parallel R2/DO change is considered. No verification skip, binding skip,
hash skip, result-authority weakening, or production/canary deployment is
justified by the current five-sample evidence.

## Phase 11: test-only Direct Worker execution path

The next experiment replaced only the dispatch mechanism. The Queue baseline
request path remained unchanged, while a separate test-only Verifier Worker was
added behind a Cloudflare Service Binding:

```text
Request Worker
	 -> TLSN_DIRECT_VERIFIER Service Binding
	 -> fusou-tlsn-verifier-test
	 -> shared authenticated completion
	 -> test Durable Object namespace + test R2 bucket
```

The Request Worker still authenticates the user and device, derives the
Presentation ID, persists the Presentation, claims the binding, and returns
`202`. It schedules the Service Binding invocation with `ExecutionContext` so
the request is not held open by verifier execution. The verifier Worker accepts
only the bounded, HMAC-authenticated internal completion request and then calls
the existing completion implementation. Its Durable Object binding references
the Request Worker's test namespace, and both Workers use the test R2 bucket.
The Service Binding is therefore a dispatch boundary, not an authorization
source.

The Direct path preserves the same security ordering and invariants as Queue:

- binding authority remains the source of truth;
- session, canonical user, device, job, profile, disclosure mode, and
  Presentation ID remain authority-bound;
- the Presentation is fetched only after the verification lease is acquired;
- Presentation SHA-256, WASM verification, result signing, Result SHA-256,
  Result R2 PUT, authoritative DO consume, attempt fencing, stale-attempt
  rejection, failure release, and input cleanup remain enabled;
- the dedicated `TLSN_DIRECT_CALLBACK_SECRET` authenticates dispatch, but does
  not authorize a binding or result.

The test-only deployment sequence was:

| Component | Version | Scope |
| --- | --- | --- |
| Verifier Worker `fusou-tlsn-verifier-test` | `88878e23-e0e2-4943-b073-306529fa8b71` | Direct service target |
| Request Worker Direct deployment | `f29351d3-4143-4e13-af8e-783bfe28b36c` | Direct path |
| Request Worker Queue baseline | `be434c29-c52e-48ce-9a99-093a6a8e1739` | Queue path |
| Request Worker Trigger comparison | `48b9bd7b-729f-4fd0-b7d8-c55f6dd69d5f` | Trigger path |

All measurements used the p50 fixture, concurrency `1`, 100 ms polling, and
five samples. Every row completed `5/5` samples with `5/5` complete timing. The
primary metric is server completion, from accepted `202` to authoritative DO
consume. The secondary metric is client-visible, from client request start to
the first verified status response. These results are directional evidence
only, not statistical generalizations from five observations.

| Execution path | Dispatch P50/P95 | Server completion P50/P95 | Client-visible P50/P95 | Decision |
| --- | ---: | ---: | ---: | --- |
| Trigger | `301/3018 ms` | `3485/6358 ms` | `4424/7392 ms` | EXCEEDS TARGET |
| Queue | `438/1870 ms` | `1704/3168 ms` | `2283/3841 ms` | EXCEEDS TARGET |
| Direct Worker | `7/58 ms` | `241/326 ms` | `635/708 ms` | MEASURED WITHIN TARGET |
| Durable Object immediate execution | `NOT_ESTABLISHED` | `NOT_ESTABLISHED` | `NOT_ESTABLISHED` | NOT RUN |

For Queue, dispatch is Queue message acceptance to Queue consumer execution
start. For Trigger, it is Trigger task acceptance to Trigger execution start.
For Direct, it is Request Worker dispatch start to Verifier Worker execution
start. The Direct Worker route currently awaits the shared completion path
before returning its Service Binding response. Consequently,
`direct_invocation_accepted` is recorded after completion and is not a valid
startup timestamp; `direct_invocation_startup` is the valid dispatch-to-
`t3_direct_execution_started` measurement used above. Trigger and Direct
timestamps cross runtime/Worker clocks and are not clock-skew corrected; the
exact Direct startup value is therefore directional, while the server
completion measurement remains the primary comparison.

Direct dispatch is test-only and is now one-shot. The Request Worker schedules
it with `waitUntil`; a rejected or non-OK Service Binding invocation records a
bounded internal `verification_failure_code` and transitions the authority to
`failed`. The public status is then HTTP `200` with
`{ verified: false, status: "not_verified", job_id }`. The compatibility retry
endpoint returns `verification_retry_disabled` and never re-enqueues the job.
This preserves the distinction between a failed verification attempt and an
expired binding while keeping failure reasons out of the unsigned external
status response.

The Direct artifact reported these additional phases:

| Direct phase | P50 | P95 |
| --- | ---: | ---: |
| Service Binding invocation startup | 7 ms | 58 ms |
| Presentation R2 input | 45 ms | 72 ms |
| Presentation hash | 0 ms | 0 ms |
| Result persistence | 124 ms | 198 ms |
| DO consume | 19 ms | 26 ms |
| Client observation | 387 ms | 500 ms |

The corresponding Queue artifact reported Queue send `154/413 ms`, Queue
delivery/start `438/1870 ms`, Presentation R2 input `278/326 ms`, Result
persistence `451/827 ms`, and DO consume `111/115 ms`. The Queue delivery tail
is therefore removed from the critical path by Direct invocation in this run;
the Direct server P95 is approximately `2.84 s` lower than Queue, and the
client-visible P95 is approximately `3.13 s` lower. The Direct path also stayed
below the 3000 ms target for both reported server completion and client-visible
P95/Max gates.

The Trigger comparison is included for architectural context, not as a claim
that five samples characterize Trigger scheduling. Its dispatch P95 was
`3018 ms`, and its server completion P95 was `6358 ms`; the Trigger platform
startup tail remains separate from the Worker completion phases.

Durable Object immediate execution was not implemented or deployed. The
repository does not yet establish that the Durable Object runtime can safely
execute the TLSN WASM verifier under the required execution time and memory
conditions. Its runtime suitability is therefore explicitly `NOT_ESTABLISHED`,
and the Service Binding path is sufficient for this experiment.

Evidence artifacts:

- `packages/FUSOU-TLSN-VERIFICATION-WORKER/artifacts/tlsn-remote-benchmark-queue-ab-p50-c1-poll100-5.json`
- `packages/FUSOU-TLSN-VERIFICATION-WORKER/artifacts/tlsn-remote-benchmark-trigger-ab-p50-c1-poll100-5.json`
- `packages/FUSOU-TLSN-VERIFICATION-WORKER/artifacts/tlsn-remote-benchmark-direct-ab-p50-c1-poll100-5.json`

The first attempted Direct benchmark command did not propagate
`TLSN_REMOTE_EXECUTION_MODE` through dotenvx and produced a Queue-mode artifact;
that artifact is excluded above. The corrected Direct artifact explicitly
records `configuration.execution_mode: "direct"`.

## Phase 12: conclusion and next action

1. Queue delivery tail is a real bottleneck in this test-only comparison. The
	Queue dispatch P95 was `1870 ms`, while Direct startup P95 was `58 ms`; the
	Direct path reduced server completion P95 from `3168 ms` to `326 ms`.
2. Direct Worker invocation improved server completion P50/P95 from
	`1704/3168 ms` to `241/326 ms`, and client-visible P50/P95 from
	`2283/3841 ms` to `635/708 ms`.
3. The Direct path reached the 3000 ms target under this five-sample test-only
	run. This is strong evidence for the hypothesis, but not a population-level
	performance claim.
4. The next optimization should remain the previously identified
	post-consume no-op lease release removal, measured separately. Result PUT,
	DO consume, input cleanup, status schema, and Result authority must not be
	changed in that experiment.

No production or canary Worker was deployed or modified. The Direct Service
Binding exists only under the test Wrangler environment. The test environment
was restored to Queue defaults after the benchmark (`TLSN_EXECUTION_MODE=queue`
and `TLSN_REMOTE_EXECUTION_MODE=queue`). Switching to Direct or Trigger still
uses the same production/canary-independent test Worker deployment commands.

## Phase 13: one-shot terminal failure semantics

The test-only verification state machine now treats a failed verification
attempt as terminal:

- `processing` and `verifying` can transition to `failed` exactly once, with a
	bounded internal code such as `service_binding_failed`, `verifier_failed`,
	`presentation_read_failed`, `result_persistence_failed`, or
	`lease_expired`.
- A failed record cannot be claimed again, acquired again, or released back to
	`processing`. Failure finalization is idempotent for already `failed` and
	`consumed` records, so a late callback cannot overwrite a successful consume.
- Lease expiry finalizes `failed`; binding TTL expiry remains `expired`.
- Test Queue messages are acknowledged after a completion failure and the test
	Wrangler consumer is configured with `max_retries = 0`. Trigger test tasks
	use `maxAttempts = 1`. Production and canary retry configuration was not
	changed.
- The external failure response intentionally contains no raw error, stack,
	binding value, presentation bytes, or sensitive verifier data.

Local verification after the change:

| Check | Result |
| --- | --- |
| Worker `tsc --noEmit` | PASS |
| Test harness `node --check` | PASS |
| Local Direct success/failure/timeout and exactly-once checks | PASS |
| Local Trigger app roundtrip, retry-disabled, and result-authority checks | PASS |
| Local lease expiry, stale callback, and terminal failure checks | PASS |
| Local package suite | PASS |
| Remote failure/timeout validation | NOT_ESTABLISHED; no dedicated remote failure/timeout run was completed |
| Earlier remote Direct/Queue five-sample benchmark | NOT_ESTABLISHED; the key was loaded successfully, but the deployed endpoint emitted Trigger timing (`t2_trigger_*`) while the benchmark was configured for Direct or Queue, so timing completeness was never established |

The local Direct success/failure/timeout harness is established, including
Service Binding connectivity through the named test verifier Worker. The local
Trigger roundtrip now reaches the valid Result state before exercising
`verification_result_mismatch`; a substituted callback after consume is
rejected and cannot overwrite the consumed Result. Existing remote Direct
latency figures above are unchanged and do not include this terminal-failure
change. The later remote one-sample diagnostic confirmed that the deployed
endpoint is currently Trigger-backed: the Result became observable in about
5.8 seconds, but the report contained only `t2_trigger_submitted` and
`t2_trigger_task_accepted` among the execution-mode-specific stages. No
production or canary deployment was performed.

## Phase 14: current remote Trigger verification

The current test endpoint was verified with the execution mode that its timing
records actually expose. The command used the encrypted environment from
`packages/.env.keys`, overrode only the benchmark mode to `trigger`, and ran
the p50 fixture at concurrency `1` for five samples. No production or canary
Worker was deployed or modified.

| Check | Result |
| --- | --- |
| Remote auth and preflight | PASS; test auth, random binding mode, and p50 fixture accepted |
| Remote verification completion | PASS; `5/5` samples reached `verified: true` |
| Durable timing completeness | PASS; `5/5` samples complete, trace IDs present and submission-matched |
| Client-visible latency | P50 `3727 ms`, P95/P99/Max `4012 ms` |
| Server completion | P50 `3045 ms`, P95 `3210 ms`, Max `3210 ms` |
| 3000 ms target | `EXCEEDS TARGET` |

The report contains all required Trigger timing stages for every sample. The
largest measured P50 phases were Trigger input fetch (`1079 ms`), Trigger task
start to callback (`1214 ms`), Result persistence (`654 ms`), and callback
entry to lease (`519 ms`). Trigger verifier execution itself was approximately
`24 ms` at P50, so the target miss is not caused by WASM verification time.

Evidence artifact:

- `packages/FUSOU-TLSN-VERIFICATION-WORKER/artifacts/tlsn-remote-benchmark-trigger-current-p50-c1-5.json`

This run establishes successful remote verification and a test-only latency
result. It does not establish a production latency SLO, because the run used
the synthetic test Worker, test Durable Object/R2, test authentication, and
the dedicated Trigger path. The benchmark's non-zero exit code is intentional:
`EXCEEDS TARGET` is a completed measurement, not a verification failure.

## Phase 15: post-one-shot Direct remote proof

The post-one-shot Direct path was deployed and exercised only in the test
environment. The final normal Direct deployment used Request Worker version
`c7802f8d-9ec6-4235-a0a9-0c373c2a3bf2` and Verifier Worker version
`e2091310-573a-4423-b60d-b8375579d83e`. Production and canary were not
deployed or modified.

### Direct success benchmark

The run used the real `p50` fixture, concurrency `1`, five samples, and 100 ms
status polling. The artifact explicitly records
`configuration.execution_mode: "direct"`.

| Check | Result |
| --- | --- |
| Successful samples | `5/5` |
| Timing-complete samples | `5/5` |
| Submission/durable trace match | `5/5` |
| Server completion P50/P95/Max | `192/225/225 ms` |
| Client-visible P50/P95/P99/Max | `477/564/564/564 ms` |
| Direct startup P50/P95/Max | `5/40/40 ms` |
| Direct invocation diagnostic count | `1` for every sample |
| Signed Result, Result SHA-256, authoritative consume | PASS for every sample |
| 3000 ms target | `MEASURED WITHIN TARGET` |

Evidence artifact:

- `packages/FUSOU-TLSN-VERIFICATION-WORKER/artifacts/tlsn-remote-direct-post-one-shot.json`

The current post-one-shot Direct result is compared with the current remote
Trigger baseline above, not with the historical pre-one-shot Direct sample:

| Execution mode | Server completion P50/P95 | Client-visible P50/P95 | Target |
| --- | ---: | ---: | --- |
| Direct, post-one-shot | `192/225 ms` | `477/564 ms` | MEASURED WITHIN TARGET |
| Trigger, current baseline | `3045/3210 ms` | `3727/4012 ms` | EXCEEDS TARGET |
| Direct, pre-one-shot historical sample | `241/326 ms` | `635/708 ms` | historical only |

The three rows are not a controlled statistical comparison: the Direct and
Trigger runs are five-sample test-only measurements taken at different times,
and the historical Direct row predates one-shot failure semantics. They do
establish that the corrected post-one-shot Direct deployment completed the
requested remote success path without Queue or Trigger timing stages.

### Direct failure, timeout, and retry proof

The test-only Direct verifier has bounded fault controls. They are gated by
`TLSN_ENVIRONMENT=test`; no production or canary configuration contains these
controls. The remote scenario harness emits only status shapes, timing markers,
invocation count, and retry result; it does not emit presentations, tokens,
signatures, Result bodies, Result hashes, or internal failure codes.

| Scenario | Deployment controls | Submit | Terminal state | Direct invocation count | Late/accepted callback | Retry |
| --- | --- | ---: | --- | ---: | --- | --- |
| Service Binding failure | Verifier returns `503` | `202` | `200 not_verified` | `1` | accepted `false` | `409 verification_retry_disabled` |
| Direct timeout | Verifier delay `250 ms`, Request timeout `50 ms` | `202` | `200 not_verified` | `1` | stable after late-callback window; accepted `false` | `409 verification_retry_disabled` |

The failure run used Request/Verifier versions
`8f48b43c-4481-452f-a103-95dcad083012` /
`38eca0b9-e915-4ae3-9708-c75c22bc229d`; the timeout run used
`83184f58-8515-41b8-aa3d-8ab29dd1330b` /
`78b0d276-3da8-44c4-93e6-1a16d3679ec5`. Both runs returned the exact retry
schema:

```json
{
	"verified": false,
	"status": "not_verified",
	"error": "verification_retry_disabled"
}
```

The timeout run waited through the delayed verifier callback and then read the
terminal state again. The failed authority state remained terminal, with no
Result PUT or consume marker, so the late callback did not create an
authoritative Result.

### Result persistence race boundary

A separate test-only attempt used a 10-second verification lease and a
12-second post-Result delay. It reached terminal `not_verified` and retry
`409`, but the safe timing diagnostics reported `result_put_count: 0` and
`consume_completed: false`. The run therefore did not prove the narrower
“Result PUT completed before consume rejected by lease expiry” race.

| Requested race | Result |
| --- | --- |
| Lease expiry with late Direct callback | PASS; remote timeout scenario above |
| Result persisted before consume failure | `NOT_ESTABLISHED`; Result PUT was not observed |

No claim is made for the Result-persisted-before-consume race. The existing
ordering remains code-audited: Result PUT and its SHA-256 are required before
the Durable Object consume transition, and status verification requires the
authoritative record plus a matching persisted Result.

### Security invariant audit

| Invariant | Assessment | Evidence boundary |
| --- | --- | --- |
| Service Binding is dispatch only, not authority | PASS | Test Direct success/failure; completion rechecks the Durable Object |
| Durable Object is the source of truth | PASS | Success consume and terminal failure status; code audit |
| Presentation ID and fetched-byte SHA-256 binding | PASS | Completion code and local substitution tests; no remote malicious substitution run |
| Profile/disclosure binding | PASS | Authority checks and local sparse/complete tests |
| Malicious Prover cannot bypass verification | CODE-AUDITED | Profile, Presentation hash, verifier, signing, and consume gates remain mandatory; no remote adversarial corpus was run |
| Lease and attempt fencing | PASS | Local lease/stale-attempt tests and remote timeout terminal state |
| Stale callback cannot overwrite terminal state | PASS | Remote delayed timeout callback remained `not_verified`; local stale callback test |
| Signed Result and Result SHA-256 | PASS | All five Direct success samples had signed Result, Result SHA, and consume evidence |
| Consume-before-cleanup ordering | CODE-AUDITED | Completion orders consume before input cleanup; Result race remote proof is not established |
| Terminal failure and no retry | PASS | Remote failure and timeout both returned terminal `not_verified` and exact retry-disabled `409` |
| Lease expiry becomes failed/not verified | PASS | Local lease-expiry test and remote Direct timeout behavior |

This audit is test-only evidence plus a source-level invariant review. It is
not a production SLO, a remote malicious-Prover penetration test, or proof of
the unobserved Result-persistence race. No production or canary Worker was
deployed or modified.

## Phase 16: final post-one-shot Direct audit

The final audit was performed from HEAD
`2014e18b2321cd44878d77e24ad61d330e9b16af`. The requested constraints were
held throughout this phase: no architecture change, no Queue or Trigger
reintroduction, no retry mechanism, no production or canary deployment, and no
security-invariant relaxation.

### Direct concurrency matrix

The run used the real `p50` fixture, five samples per concurrency level, 100 ms
status polling, and the test-only Direct execution mode. The benchmark artifact
is `packages/FUSOU-TLSN-VERIFICATION-WORKER/artifacts/tlsn-remote-direct-concurrency-1-4-8-p50-5.json`.

| Request concurrency | Samples | Server completion P50/P95/P99/Max | Client-visible P50/P95/P99/Max | Direct startup P50/P95/P99/Max | Target |
| ---: | ---: | --- | --- | --- | --- |
| 1 | 5/5 complete | `226/249/249/249 ms` | `514.71/626.23/626.23/626.23 ms` | `5/39/39/39 ms` | MEASURED WITHIN TARGET |
| 4 | 20/20 complete | `191/359/405/405 ms` | `529.51/658.37/662.06/662.06 ms` | `5/36/40/40 ms` | MEASURED WITHIN TARGET |
| 8 | 40/40 complete | `205/327/379/379 ms` | `573.65/736.93/817.01/817.01 ms` | `5/56/59/59 ms` | MEASURED WITHIN TARGET |

Secondary phase metrics were complete for every sample. The relevant P50/P95/P99/Max
values were:

| Request concurrency | Worker R2 input | WASM verification | Result persistence | DO consume |
| ---: | --- | --- | --- |
| 1 | `45/111/111/111 ms` | `0/0/0/0 ms` | `86/146/146/146 ms` | `18/24/24/24 ms` |
| 4 | `39/51/69/69 ms` | `0/0/0/0 ms` | `83/259/299/299 ms` | `22/24/26/26 ms` |
| 8 | `42/89/244/244 ms` | `0/0/0/0 ms` | `97/157/273/273 ms` | `22/26/29/29 ms` |

The zero-valued WASM phase means below the deployed millisecond timing
resolution; it is not a proof of zero CPU cost. The observed maximum verifier
concurrency was `1` at request concurrency `1`, and `1..2` at request
concurrency `4` and `8`. This is an observation from this deployment, not a
Cloudflare isolate limit or a production capacity guarantee.

### State-machine audit

The Durable Object remains the only authority for the binding and Result
terminal state. The audited transitions are:

| From | To | Authority operation | Audit result |
| --- | --- | --- | --- |
| `active` | `processing` | `claim` | Identity, nonce, expiry, profile, and job fields are checked in one transaction |
| `processing` | `verifying` | `acquire` | Attempt ID, lease expiry, result key, profile, and binding expiry are fenced atomically |
| `verifying` | `consumed` | `consume` | Live lease, attempt ID, job ID, result key, Result SHA-256, identity, and Presentation ID are required |
| `processing` or `verifying` | `failed` | `fail` or lease-expiry alarm | Failure is terminal and removes attempt authority fields |
| `active`, `processing`, or `verifying` | `expired` | Binding TTL check or alarm | Binding expiry is distinct from verification failure |
| `failed` | terminal | all later claim/acquire/consume paths | Later work receives `verification_failed` or a bounded conflict |
| `consumed` | terminal | duplicate consume only when the same Result authority matches | A late callback cannot overwrite the consumed record |

The `release` operation can only return the current `verifying` attempt to
`processing` when its attempt ID matches. It is a no-op for `failed` and
`consumed`; it cannot revive a terminal failure. The local lease-fencing,
stale-callback, terminal-failure, retry-disabled, and Result-authority tests
passed. The remote timeout also remained terminal after its delayed callback.

### Public response leakage audit

The public routes expose bounded response shapes:

| Route/state | External response | Leakage assessment |
| --- | --- | --- |
| Initial asynchronous accept | `202` with `verified: false`, `status: queued`, `job_id`, and optional test benchmark trace | No Presentation, binding value, token, signature, stack, or raw exception |
| Status `processing` | `202` with `verified: false`, `status: processing`, `job_id` | No internal failure code or Result body |
| Status `failed` | `200` with `verified: false`, `status: not_verified`, `job_id` | Internal `VerificationFailureCode` is withheld |
| Status `consumed` | Strict signed final response schema | Only the intended signed Result, signer metadata, consume receipt, and device replay digest are returned |
| Retry endpoint | `409` with `verification_retry_disabled` | No re-enqueue or attempt mutation occurs |
| Internal callback authentication failure | `401 unauthorized` outside test HMAC diagnostics | Callback secrets and HMAC mismatch details are not public |
| Unexpected completion exception | `422 verification_failed` internally, terminal public status | Raw exception and stack are withheld |

Authentication and input rejection may return bounded codes such as
`invalid_request`, `unauthorized`, `device_challenge_mismatch`, or
`verification_result_unavailable`. These are contract-level classifications,
not raw authority records or exception text. The test-only HMAC diagnostic
header is gated by `TLSN_ENVIRONMENT=test` and is not a production response
path.

### Direct Service Binding and malicious callback audit

The Direct Service Binding is a dispatch boundary only. The Request Worker
constructs the callback body and signs the job ID plus body digest with the
test-only Direct callback secret. The verifier route requires the matching job
header, HMAC signature, strict callback schema, and then performs the shared
completion path. The callback payload cannot authorize a binding by itself:
the Durable Object rechecks session, user, device, job, profile, Presentation
ID, lease, attempt, and Result authority.

Local malicious-callback and tamper coverage passed for callback signature,
callback identity, callback profile, Presentation substitution, Result
substitution, stale attempts, and replay after consume. A dedicated remote
malicious-callback corpus was not run and is therefore `NOT_ESTABLISHED`.
The remote timeout callback was not malicious, but it did confirm that a late
callback does not change the terminal failed state.

The Wrangler configuration confirms that `TLSN_DIRECT_VERIFIER` and the
dedicated verifier Worker are present only under `[env.test]`. Canary and
production have no Direct Service Binding, no Direct callback secret, and no
test fault controls. The test verifier references the test Durable Object
namespace and test R2 bucket. Production and canary configuration were not
changed.

### Result PUT to consume race

The source ordering remains correct: the signed final response is hashed, the
Result is persisted to R2, and only then does the authority consume transaction
record the Result object key and SHA-256. Status reads require both the
authoritative consumed record and a matching persisted Result hash.

The remote race attempt deliberately used a longer post-Result delay and a
shorter verification lease. It reached terminal `not_verified`, but its safe
diagnostics reported `result_put_count: 0` and `consume_completed: false`.
The run therefore did not observe a completed Result PUT followed by a
lease-fenced consume rejection. This requested race remains:

```text
NOT_ESTABLISHED
```

The implementation was not changed to make the race easier to reproduce, and
no result-authority ordering was relaxed.

### Mixed-failure concurrency

The existing test fault control is global to the verifier Worker and does not
provide deterministic request-level failure selection. A test-only fail-once
experiment produced `4/4` verified requests because a Worker isolate-global
counter cannot be treated as a cross-isolate coordination primitive. Adding a
new Durable Object or R2 fault-control protocol would change the test
architecture and was rejected under the task constraints.

Mixed failure concurrency is therefore:

```text
NOT_ESTABLISHED
```

The single-request Direct failure, timeout, terminal state, late callback, and
retry-disabled behavior remain remotely established as documented above.

### Worker resources and observability

The concurrency artifact measured a `150080` byte source fixture and
approximately `3459-3460` byte sparse Presentations. It measured timing phases,
R2 operation counts, terminal state, Result SHA-256 presence, Direct invocation
count, trace matching, and observed verifier concurrency. It did not measure
Worker isolate RSS, WASM linear-memory peak, CPU time at sub-millisecond
resolution, platform hard memory/CPU limits, production concurrency, or
production cold-start behavior. No such limits are configured in the test,
canary, or production Wrangler files.

Production operational telemetry should be added or verified before promotion
without recording sensitive payloads. The minimum bounded fields are:

- deployment identity, execution mode, hashed job/trace identifiers, and profile;
- request acceptance, Direct dispatch start/finish, lease acquisition, R2 input/result operations, consume, and status-observation durations;
- terminal state and bounded failure code, including service-binding failure, lease expiry, Result persistence failure, and consume rejection;
- Result PUT count, consume outcome, late-callback count, and observed verifier concurrency;
- sampled p50/p95/p99/max latency and an age alert for jobs remaining `processing` or `verifying`.

Telemetry must exclude access tokens, callback secrets, binding values, nonce
values, Presentation bytes, raw Result bodies, signatures, stack traces, and
unbounded exception text. Alerts should cover terminal-failure rate,
`result_put_before_consume_rejected`, lease-expiry rate, Direct dispatch
non-OK/timeout rate, missing Result objects, and latency SLO burn.

### SLO boundary and production decision

The 3000 ms boundary was measured for the test-only Direct path at request
concurrency `1`, `4`, and `8`; every row was below the boundary for server
completion and client-visible P95/P99/Max. This establishes a test-environment
performance result for the `p50` fixture. It does not establish a production
SLO because production traffic, production isolate resources, production
concurrency, production cold starts, and production telemetry were not used.

| Decision item | Status | Reason |
| --- | --- | --- |
| Keep Direct implementation test-only | APPROVED | Success, failure, timeout, fencing, and concurrency evidence are available |
| Change production or canary configuration | NOT DONE | Explicit task constraint; Direct binding remains absent there |
| Claim production 3000 ms SLO | NOT APPROVED | Only test-only measurements exist |
| Claim Result PUT -> consume race proof | NOT APPROVED | Remote evidence observed no Result PUT before failure |
| Claim remote malicious callback resistance | NOT APPROVED | Local coverage passed; no dedicated remote malicious corpus |
| Claim mixed-failure concurrency isolation | NOT APPROVED | No deterministic request-level test control exists without new coordination |
| Promote Direct to production | NOT APPROVED | Resource, observability, and the three evidence gaps above remain |

The final status is therefore **test-only Direct evidence complete; production
promotion not approved**. This conclusion preserves the existing authority,
one-shot terminal failure, Result ordering, and no-retry behavior and does not
reintroduce Queue or Trigger execution.