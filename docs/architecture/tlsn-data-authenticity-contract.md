# FUSOU TLSN Data Authenticity Contract

**Status:** Source-derived contract with an implemented local delivery policy v1;
broader wire/authority questions remain open. Not Production acceptance.
**Repository basis:** `tlsn-first-testplay-candidate` at `e1d985bf326378346d1cf86b2e5269e3fe03cd95`.

This document separates contracts visible in the checked-in source from
requirements that still need an owner decision or external evidence. A source
implementation, a synthetic fixture, and an external deployment are different
evidence classes.

## Status vocabulary

Use only these labels for conclusions:

- `OBSERVED`: directly supported by checked-in source or an identified record.
- `UNVERIFIED`: plausible or implemented locally, but not independently
  established for the relevant runtime or external service.
- `NOT_CHECKED`: not inspected or not executed in this work.
- `BLOCKED`: cannot be accepted until a named decision, implementation, or
  evidence is supplied.
- `PASS`: a specific stated verification completed successfully; it does not
  promote a broader gate.
- `FAIL`: a specific stated verification failed.

The broader Q1-Q5 authority/runtime questions remain distinct from the
conservative local delivery policy adopted below. The local policy is code
and tests, not a recurring human approval procedure or a deployed APP policy.

## Scope and fixed requirements

The intended claim is that a FUSOU APP-to-Game-Server TLS exchange is with an
approved Game Server and that the exact TLS transcript and resulting evidence
can be independently verified through the chain:

```text
approved Game Server identity
  -> Web PKI / TLS
  -> exact request and response transcript
  -> TLSN Presentation and Notary verification
  -> Dedicated Verifier
  -> signed Result
  -> byte-identifiable archived evidence
  -> independent offline verification
```

The following requirements are fixed for this work:

- A Production target identity is a canonical lowercase DNS hostname. A URL,
  port, IP address, certificate fingerprint, or custom CA root is not an
  alternate identity.
- Production identity must be derived from the actual TLSN Presentation and
  compared with independently trusted Origin Inventory and Target Approval.
  A selected APP target or candidate configuration is an expectation, not
  authority for the observed peer.
- Origin TLS uses Web PKI and hostname validation. A test certificate or
  synthetic root is not Production trust.
- A Production Result must bind the exact Presentation bytes with
  `presentation_sha256` and must include both
  `origin_inventory_sha256` and `target_approval_artifact_sha256`. The two
  digests are a pair: neither may stand in for the other.
- A successful game response is not proof that proof generation, Notary
  processing, verification, signing, or evidence delivery succeeded.
- APP input correctness, APP process/image authority, measured boot, TPM,
  privileged helpers, and browser integrity are not claims of this contract.

## Source-observed implementation

| Boundary | Source-observed behavior | Limit of the observation |
|---|---|---|
| Route selection | `ExperimentalRequireInfoRoute` checks the exact `POST /kcsapi/api_get_member/require_info` on each request and selects capture only when a prepared forwarder binding is ready. Hudsucker and Rama both use per-request capture admission; clones share the slot, not a consumed listener-wide selection. | This is local process state, not a session/attempt authority or a durable logical-operation reservation. |
| Rama body handling | A request is selected only with one bounded `Content-Length` no greater than the 128 KiB TLSN sent-data ceiling. The selected body uses `Body::limited` under a 30-second timeout. Unready/busy/unsupported requests go to ordinary proxying before collection; selected-body collection failure fails closed. | These selected-route controls are not process-wide memory limits. Ordinary fallback is not a successful TLSN capture. |
| Serialized request | The HTTP/1.1 serializer accounts for the request line, each header and CRLF, generated `Content-Length` where needed, the binding header, the header terminator, and body. Length additions use `checked_add`; the complete serialized length is capped before `Vec::with_capacity`. | The 128 KiB ceiling is for the complete serialized sent request, not a 128 KiB permitted body. A body can be accepted by the collector and later rejected because headers and framing use part of that budget. |
| TLS transport | The Production origin transport uses the configured DNS identity, system trust roots, and a single-use send path. A local journal send intent is synced before origin I/O; an outcome classified `NotSent` may use ordinary proxying, but an ambiguous outcome never retries or falls back. | Source wiring does not establish a live Game Server or Notary operation. A transport failure after a write begins can leave the remote outcome unknown; the local journal is not an authoritative logical-attempt receipt. |
| Transcript and response | The transport records exact serialized request and raw response bytes. The verifier boundary compares their hashes to the exchange values. The origin response is returned before the deferred proof pipeline completes. | The browser-visible response is not an attestation or Result receipt. Proof failure after response return cannot undo the response already delivered. |
| Presentation verification | `RealAlpha15DedicatedVerifier` verifies the actual Presentation against the trusted Notary key and compares its observed server identity and transcript hashes with the expected values and captured exchange. It checks the binding session and nonce. | External Notary availability, deployed verifier behavior, and real Presentation evidence are not established by this source review. |
| Generic Result validators and signing bytes | Complete Result v2 and Sparse Result v3 include both inventory/approval digest slots in canonical JSON and signing bytes. Both generic validators reject a half-present pair but permit both digests to be absent. | Generic validation alone does not require Production provenance. This is distinct from the local Production Evidence Bundle checks below and from Worker-side generation/signing. |
| Local Production Evidence Bundle verifier | `evidence_bundle.rs::verify_bundle` calls `verify_production_target_approval` for Complete and Sparse Results. It rejects missing/incomplete digest pairs, compares both digests with SHA-256 of the externally supplied raw Inventory/Approval bytes, validates the Approval-to-Inventory relationship and membership in both trust sets, and checks that the Result's server identity matches the external identity used for those checks. | `OBSERVED` in local source; execution in this work is `NOT_CHECKED`. This does not establish deployed Worker generation/signing or real Production evidence. |
| Result and archive handoff | The local boundary separates signing and delivery. The Worker response is verified by the APP-side verifier; the local filesystem delivery path is not an immutable Production archive. | Durable, immutable Production storage, readback, retention, and independent archive verification are not established. |
| Runtime Config and APP | The APP source has a feature-gated Production TLSN assembly path, guarded binding issuance and origin transport, Runtime Config verification, Target Approval preflight, and Worker identity checks. The ordinary Hudsucker proxy starts before capture initialization runs in the background. | Rama remains an explicit experimental entry point, not the APP route. The checked-in Runtime Config bootstrap documentation reports release pins unregistered; actual deployed build inputs are `UNVERIFIED`. |
| Worker and authorities | The tracked Worker package contains contracts, scripts, and operator documentation. The operator runbook says the Worker runtime, Session Authority handler, Production archive, and evidence collector are not tracked in this checkout. | External deployments may exist, but their code, durability, replay behavior, and current runtime are `NOT_CHECKED`. |

Relevant source anchors:

- [`proxy_server_https.rs`](../../packages/FUSOU-PROXY/proxy-https/src/proxy_server_https.rs)
- [`rama_experimental.rs`](../../packages/FUSOU-PROXY/proxy-https/src/proxy_server_https/rama_experimental.rs)
- [`experimental_tlsn.rs`](../../packages/FUSOU-PROXY/proxy-https/src/experimental_tlsn.rs)
- [`real_tlsn.rs`](../../packages/FUSOU-PROXY/proxy-https/src/real_tlsn.rs)
- [`production_tlsn.rs`](../../packages/FUSOU-PROXY/proxy-https/src/production_tlsn.rs)
- [`wrap_proxy.rs`](../../packages/FUSOU-APP/src-tauri/src/wrap_proxy.rs)
- [`tlsn_runtime_config_manifest.rs`](../../packages/FUSOU-APP/src-tauri/src/tlsn_runtime_config_manifest.rs)
- [`tlsn_preflight.rs`](../../packages/FUSOU-APP/src-tauri/src/tlsn_preflight.rs)
- [`lib.rs`](../../packages/FUSOU-TLSN-VERIFIER/src/lib.rs)
- [`sparse_result.rs`](../../packages/FUSOU-TLSN-VERIFIER/src/sparse_result.rs)
- [`evidence_bundle.rs`](../../packages/FUSOU-TLSN-VERIFIER/src/evidence_bundle.rs)
- [`production-evidence-contract.mjs`](../../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-contract.mjs)
- [`production-evidence-operator-runbook.md`](../../packages/FUSOU-TLSN-VERIFICATION-WORKER/docs/production-evidence-operator-runbook.md)

## Identity, evidence, and Result rules

### Origin identity

The APP-selected target is a routing and preflight input. The Presentation's
verified server identity is the observation to compare against independently
verified Inventory and Approval artifacts. Production acceptance requires all
of the following to agree:

1. the canonical lowercase DNS identity independently approved for the test;
2. the identity authenticated from the TLSN Presentation;
3. membership and relationship in the exact approved Inventory and Target
   Approval artifacts;
4. the `server_identity` and both raw-artifact digests in the signed Result.

The verifier schema validates hostname syntax, but syntax validation alone
does not prove Inventory membership or that the two digests were generated
from the exact approved bytes.

### Result and byte binding

`presentation_sha256` must be computed over the exact serialized Presentation
bytes supplied to verification and stored without reserialization. The signed
Result's transcript request/response hashes are distinct fields from this
Presentation hash. The Production profile must require the Inventory and
Target Approval digest pair, and an independent verifier must recompute those
digests from the independently supplied raw artifacts.

The three implementation layers must be distinguished:

1. **Generic Result validation — `OBSERVED`:** Complete Result v2
   ([`VerifierResult`](../../packages/FUSOU-TLSN-VERIFIER/src/lib.rs)) and
   [Sparse Result v3](../../packages/FUSOU-TLSN-VERIFIER/src/sparse_result.rs)
   reject a half-present pair but allow both values to be `None`. Canonical
   JSON always includes both fields as unpadded base64url digest strings or
   `null`. Each optional digest occupies an ordered UInt16-length-prefixed
   signing field: 32 digest bytes when present, zero bytes when absent. This
   signs presence/absence as well as the values, but does not itself require
   their presence for Production.
2. **Local Production Evidence Bundle verification — `OBSERVED`:**
   [`verify_bundle` and `verify_production_target_approval`](../../packages/FUSOU-TLSN-VERIFIER/src/evidence_bundle.rs)
   require both digests, recompute SHA-256 from the independently supplied raw
   Inventory and Approval bytes, check the Approval's Inventory digest and
   target membership in both trust sets, and require the signed Result's
   server identity to equal the external identity checked against those sets.
   The same bundle path verifies the Result signature and actual Presentation;
   the presence of this local implementation is not an execution result.
   Type checking and tests in this work are `NOT_CHECKED`.
3. **Production Worker generation, signing, and delivery — `NOT_CHECKED`:**
   the [operator runbook](../../packages/FUSOU-TLSN-VERIFICATION-WORKER/docs/production-evidence-operator-runbook.md)
   identifies the missing tracked runtime/handler/archive coverage. The
   [APP-side remote Result adapter](../../packages/FUSOU-PROXY/proxy-https/src/real_tlsn.rs)
   consumes a received Result and can write local artifacts; it is not the
   Worker's signing implementation. Equivalent checks in a deployed Worker
   require separately supplied source and execution evidence; deployed
   behavior remains `UNVERIFIED`. Production acceptance remains `BLOCKED`.

### Evidence preservation

An evidence package must preserve distinct byte objects and relationships:

- exact Presentation bytes;
- exact outer Worker Result response bytes;
- parsed inner signed Result;
- session/consume receipt and replay digest, where applicable;
- raw Origin Inventory and Target Approval bytes;
- signatures, public key identities, and externally trusted registry material.

Hashes are checks over exact bytes, not reserialized JSON. Production acceptance
requires verified storage keys, sizes, digests, retention and readback, plus
independent offline verification. A local filesystem sink or synthetic
Presentation is not a substitute.

### Authentication and replay

The APP-side binding client verifies Auth/device/session material and signed
receipt fields before it issues a binding. This is source-level client
validation. It does not prove that the external authority persists a unique
logical attempt, rejects replay across restart, or supports a safe recovery
query. A connection ID is transport correlation; a Worker job ID is
asynchronous verification correlation. Neither is an approved logical
`attempt_id`.

## Nonblocking request admission, failure, and recovery contract

The APP starts the ordinary proxy before background Runtime Config refresh,
preflight, Worker health checks and TLSN dependency construction. It installs
the capture forwarder only after those checks pass. Initialization failure
leaves capture unavailable; it does not stop ordinary proxy traffic.

Capture admission is per-request, not a listener-global one-shot. A matching
request is selected only when a prepared binding is ready, the single-request
capture slot is free and the body framing is eligible. The default Hudsucker
path reserves its TLSN ingress slot before body collection. If capture is not
ready, admission is busy, the Content-Length is missing/unsupported/too large,
or TLSN ingress capacity is unavailable, the original unconsumed request
follows the ordinary proxy path. The prepared binding remains in use until its
proof task confirms cleanup; while it is unavailable, later target requests
use ordinary proxying rather than waiting on Worker/session acquisition.

The TLSN-selected body collector is bounded (1 MiB, 10-second idle timeout,
30-second completion timeout and eight reservations). These are not limits on
ordinary non-target or not-ready requests and not a process memory guarantee.
If body collection fails after it starts, the stream may already be consumed;
the request fails closed and is not forwarded as an empty body or retried.

Production APP wiring supplies a durable local JSONL origin-send journal. It
syncs a send-intent record before origin transport I/O, containing a
binding-derived attempt digest, canonical target and serialized-request
digest—not the binding value or raw request body. On restart, any unfinished
`send_started` attempt is durably closed as `unknown`; its attempt digest
cannot be reused. `response_received` persistence runs asynchronously after
the browser response, so a crash before that update is conservatively
recovered as `unknown`. A journal write failure before transport prevents the
origin send. A transport error classified `NotSent` may use the ordinary
proxy; an ambiguous outcome never falls back or automatically retries.

| Failure point | Observed consequence | Recovery guarantee |
|---|---|---|
| Background Runtime Config/health/Session prewarm unavailable | Capture remains uninstalled or not ready; request follows ordinary proxy before body read. | Ordinary traffic is not held for TLSN initialization; no capture/evidence claim is made. |
| Capture slot or TLSN ingress unavailable; unsupported/oversized body framing | Request remains unconsumed and follows ordinary proxy. | One ordinary path; no TLSN attempt is made. |
| Selected body read fails/times out/exceeds limit | Body may be partially consumed; request fails closed before TLSN origin transport. | No empty-body forwarding and no retry. |
| Binding claim/serialization fails before send | The selected capture attempt is abandoned; route may forward the untouched/reconstructed request ordinarily only where the body is available and the forwarder reports `NotSent`. | No authority rollback or logical-operation idempotency is established. |
| Journal send-intent write fails | No origin transport call is made; capture fails closed. | The request is not retried through another route after a durable-state failure. |
| Origin write/response fails after send may begin | Outcome is `Unknown`; no ordinary fallback or automatic resend. | Game Server receipt remains `UNKNOWN`; local journal restart recovery does not prove receipt. |
| Origin response succeeds; proof/Notary/Result fails | Browser response is already returned; the evidence pipeline records a separate failure. | Response delivery is not evidence completion, archive retention or acceptance. |
| Process restart with unfinished journal record | Recovery appends `unknown` and rejects reuse of the same binding-derived attempt digest. | This is local per-binding replay protection only, not a stable logical-operation reservation. |

The existing Worker Binding Authority durably stores per-binding/session
records, but its contract does not bind a stable Game Server operation ID,
request digest or origin-send intent. The APP journal cannot identify the same
logical game operation when it is presented after restart with a newly issued
binding. This remains an unresolved authority/idempotency boundary; no new
Worker endpoint, enrollment rule or ownership policy was invented.

## Conservative local delivery policy v1 (2026-10-25)

[`evidence-delivery-policy.mjs`](../../scripts/evidence-delivery-policy.mjs)
defines `fusou-evidence-delivery-policy-v1`, with key-free contract tests.
This is an **implemented, opt-in consumer adapter, NOT_WIRED into APP/Worker
runtime**, not a new receipt/signature format or an authority issuer.
The selected defaults favor rejecting incomplete evidence over retrying
possibly effectful Game Server requests:

| Issue | Selected local default / enforced transition | Cost and remaining boundary |
| --- | --- | --- |
| Q1 correlation | Immutable exact `(session_id, binding_value, capture_id)` tuple. A trusted verifier must return that same tuple and exact Presentation/Result hashes. Never merge evidence across tuples or turn connection/job IDs into authority. | These existing fields correlate artifacts; they do not establish a new globally unique logical attempt or restart/recovery authority. That broader scope is still unresolved. |
| Q2 failure/retry | `PENDING -> FAILED` on explicit evidence failure; `PENDING -> FAILED_UNCERTAIN` on uncertain send. Both are terminal; no retry event or transition revives them. `retry_permitted` is always false. | Availability is sacrificed after uncertainty. This adapter neither consumes an authority receipt nor authorizes another origin request. Authoritative reconciliation/idempotency remains unimplemented. |
| Q3 response/evidence | `ORIGIN_RESPONSE` only sets a separate response-delivered bit; evidence stays `PENDING`. Only exact archive readback plus trusted verifier success can produce `READBACK_ACCEPTED`. All terminal states reject further transitions. | Retains the source's asynchronous response/proof separation. No new UI/runtime wiring or claim of signed/archived proof from an HTTP response. |
| Q4 freshness | At delivery, after deferred verification, require `issued_at_ms <= now_ms < expires_at_ms` from the trusted verifier's authenticated authorization result. No grace period and no invented TTL. Missing authorization or clock fails closed. | No assumption that Runtime Config/key expiry equals session/receipt expiry. Actual receipt parsing, trusted-clock assumptions, pre-send revalidation and runtime integration remain separate obligations. |
| Q5 guarantee | Adopt accepted-input limits only (Option A), not peak/RSS claims. This local adapter admits at most 16 MiB per Presentation/Result/readback object before copying or invoking the verifier; release JSON records are capped at 1 MiB. | Four accepted buffers can require four snapshots; caller allocations, verifier/proof work, concurrency and OS memory are not bounded by these limits. A proof over 16 MiB is rejected even if cryptographically valid. This is an operational consumer limit, not a new TLSN wire limit or a replacement for existing 128 KiB body/serialized-request ceilings. |

`READBACK_ACCEPTED` is conditional on the trusted verifier interface. Tests
mock that interface; they do **not** perform TLSN/Notary/receipt signature
verification. The adapter requires a verifier function and clock, with no
successful default, and rejects changed verifier bytes and expired deferred
results. It snapshots inputs so external mutation during verification cannot
silently change the accepted bytes.

No rollout is authorized by these local tests. Runtime adoption must wire
the actual independent verifier and authenticated receipt validity fields,
exercise failure/expiry/restart cases, and preserve the existing authority
consumption semantics. The conservative rules are now version-controlled;
ordinary tags should check their policy version/tests, not solicit the same
human design decision again.

## Q1-Q5 implementation follow-up

The current user-directed contract fixes the intended policy: authority-durable
logical attempts, no resend after uncertain origin I/O, independent origin/evidence
outcomes, authority-bound expiry and measured resource bounds. The questions below
are the historical design inventory, **not** a request to choose those policies again.
This follow-up started at `fc29aac29d454bf949510e0d97acbd3cd7e68e5b`.

| Requirement | Implemented / verified now | Remaining code, not an approval inferred from tests |
|---|---|---|
| Q1 | WEB proof consumption is durable, atomic and device/context unique; existing DO owns session/binding consumption. APP now has a durable local send-intent journal keyed by a binding digest. | Neither constitutes a durable **logical origin attempt** reservation. The Worker record and local journal do not bind a stable Game Server operation ID; a newly issued binding cannot be correlated to the same logical request after restart. |
| Q2 | Independent `NotSent`, `Unknown`, `ResponseReceived` origin states; real transport reports `AmbiguousOriginSend` after send starts; no origin retry. Unfinished local send-intent recovers as `Unknown` and blocks reuse of that attempt digest. | Authority-correlated operation transitions and reconciliation remain absent; no claim that an unknown send was received or not received. |
| Q3 | Controlled proof/Worker/signing/archive failure tests receive the complete origin response first, preserve `ResponseReceived`, and record distinct evidence failure. APP Runtime Config/health/Session binding preparation is backgrounded; unavailable capture uses ordinary proxy before body collection. | A selected body read error after partial consumption fails closed. Complete archive/readback/Evidence Complete stages are not all connected. |
| Q4 | Existing signed Session/consume times, DO expiry, nonce window and registry/manifest/Result validity checks remain; audit consumption uses DB time. | The APP still uses local wall time for portions of validation. No new trusted time anchor/skew/restart protocol was implemented; do not claim local monotonic exchange time is authority wall time. |
| Q5 | TLSN-selected request bodies require a single Content-Length no greater than the 128 KiB sent-data ceiling; the Hudsucker collector additionally caps body collection at 1 MiB / 10 s idle / 30 s completion / 8 reservations. Ordinary/non-target requests bypass these TLSN-specific limits. Worker proof responses remain capped at 16 KiB, fetch 10 s. | The serialized request also has a 128 KiB total ceiling. Full concurrent connection/queue/TLSN/MPC/serializer/archive memory accounting, per-attempt budgets and process-wide memory bounds are not established. Input caps and mux windows are not process RSS guarantees. |

These remaining requirements are `BLOCKED_CODE`, not newly invented human
policy choices. Existing external signer/root/deployment approvals are separate.
No new auth fallback, process/image authority, privileged helper or retry was added.

### Historical broader design inventory

The local defaults above settle the consumer's fail-closed behavior. The
following original questions describe broader issuer, runtime and product
semantics not established by that adapter; those parts remain `BLOCKED`.

### Q1 — What is the authoritative attempt identity and scope?

Capture selection is now per-request rather than listener-global. The current
code also records a local attempt key derived from the authority binding and
recovers an unfinished send as `Unknown`. Those facts still do not define a
stable logical Game Server operation identity, its issuer, lifetime, request
binding or cross-process/restart idempotency. Connection IDs and Worker job IDs
are not substitutes for that missing logical attempt contract.

### Q2 — Which failures consume an attempt, and how can a retry be authorized?

Define the transition and recovery rule for body overflow, timeout, stream
error, binding/receipt uncertainty, serialization failure, pre-write failure,
partial send, origin response, Notary/Presentation failure, deferred Worker
verification, Result signing, and delivery. In particular, define how an
operator determines whether the Game Server may already have processed a
request before authorizing a new one.

### Q3 — What is the authoritative relationship between response and evidence?

The current code returns the origin response before the proof pipeline finishes.
Decide whether this remains the intended user experience and define the
externally visible states for response delivered, evidence pending, verified,
failed, and archived. A response must never be represented as a successful
verified Result.

### Q4 — Which expiry governs each operation?

The APP validates the authority receipt's time fields when issuing a binding,
and Runtime Config has its own freshness/epoch rules. Decide whether the
authority session/receipt must be revalidated immediately before origin send,
during deferred verification, and at Result delivery. Do not treat Runtime
Config expiry as session/attempt expiry.

### Q5 — What memory guarantee is required?

Choose the required level before implementing further limits:

| Option | Intended bound | Required controls | Not guaranteed by this option alone |
|---|---|---|---|
| A | Accepted body and serialized request sizes only | Explicit per-backend request/body ceilings and exact definition of what bytes count. | Peak per-request memory, concurrent requests, read-ahead, TLS buffers, or process RSS. |
| B | Per-request peak memory | A defined accounting model for ingress buffers, body chunks, coalescing, serializer output, TLS/proof data; allocation strategy and enforced per-request budget. | Total process memory under unbounded concurrent connections or background proof tasks. |
| C | Process-wide memory under concurrency | Option B plus bounded connections/tasks, admission control, budgets for TLS/proof/archive work, and load measurements under defined conditions. | OS/kernel allocations or external service memory unless separately included in the measurement boundary. |

The observed 128 KiB body/serialized-request constraints are accepted-input
limits, not a peak-memory guarantee. The
[FUSOU manifest](../../packages/FUSOU-PROXY/proxy-https/Cargo.toml) pins `rama`
and `rama-http-backend` to `=0.4.0`. The
[Rama adapter](../../packages/FUSOU-PROXY/proxy-https/src/proxy_server_https/rama_experimental.rs)
constructs `HttpServer::new_http1` and `HttpMitmRelay::new` without an explicit
HTTP/1 read-buffer size setting. The upstream
[`rama-http-core` 0.4.0 HTTP/1 builder source](https://docs.rs/rama-http-core/0.4.0/src/rama_http_core/server/conn/http1.rs.html#371-386)
describes `max_buf_size` as the maximum connection buffer size and states
“Default is ~400kb.” This is an approximate default description, not an
example setting or a FUSOU measurement. The builder
[initializes its override to `None`](https://docs.rs/rama-http-core/0.4.0/src/rama_http_core/server/conn/http1.rs.html#232-254);
that is not evidence that the underlying buffer has no limit.
The complete internal path from FUSOU's server/relay constructors to the
effective buffer limit has not been established in this review, and no
runtime execution or measurement was performed. Accordingly, no exact
ingress-buffer byte ceiling or peak-memory guarantee is asserted for FUSOU.
The adapter's one-byte
[`CaptureIo` read-chunk setting](../../packages/FUSOU-PROXY/proxy-https/src/capture_io.rs)
limits the space offered to the wrapped I/O in each `poll_read` call, not the
HTTP/1 builder's internal buffer allocation or peak memory. Body limiting
observes DATA only after it has arrived. The default Hudsucker selected-TLSN
path now reserves a bounded `RequestIngress` slot before collection; the
ordinary Hudsucker forwarding path still collects bodies without those
TLSN-specific caps. The optional Rama path has its own selected-body limit and
timeout. Both capture paths can materialize request bytes and the serializer
creates output bytes, so temporary copies and per-connection buffers may
coexist. No process-wide memory budget or bound on ordinary request buffering
is established here.

## Evidence gates

The following gates remain distinct:

| Gate | Current classification | Evidence required to change it |
|---|---|---|
| Source implementation | `OBSERVED` for the behaviors described above | Review against the exact source revision; source presence alone is not operational evidence. |
| Proxy Rust type checking and default Hudsucker tests for this follow-up | `PASS` | `cargo test --lib`: 122 PASS, 0 FAIL, exit 0. Local tests, not actual gameplay. |
| Rama synthetic and HTTP/1 loopback behavior | `PASS` | `cargo test --features rama-experimental --lib`: 155 PASS, 0 FAIL, exit 0; includes the 23 Rama module tests. |
| APP `tlsn-production` library/binary check | `PASS` | `cargo check --features tlsn-production --lib --bins`: exit 0; existing warnings remain. |
| APP TLSN Runtime Config transport-gate tests | `PASS` | APP `tlsn-production` library tests: 7 PASS, 0 FAIL, exit 0; fake/local gates only, not APP launch or live services. |
| Real Game Server TLSN evidence | `UNVERIFIED` | Human-operated gameplay producing non-synthetic TLSN Presentation and independently verifiable Result/archive. |
| Production acceptance | `BLOCKED` | Real deployment/runtime, authority, Notary, Game Server, immutable archive/readback, independent verification, and approved release evidence. |

The detailed phase and test plan is in
[`tlsn-data-authenticity-roadmap-2026-10-23.md`](../implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md).
