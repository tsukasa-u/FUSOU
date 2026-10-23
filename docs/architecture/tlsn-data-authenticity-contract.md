# FUSOU TLSN Data Authenticity Contract

**Status:** Draft for decision; not an implementation or Production acceptance.
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

The Q1-Q5 items below remain decision requests. Recommendations are not
approved behavior.

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
| Route selection | `ExperimentalRequireInfoRoute` selects the first exact `POST /kcsapi/api_get_member/require_info` and shares its `Arc<Mutex<...>>` state across clones. The Rama listener clones one route into per-connection services. | This is listener-scoped, process-memory state, not a session/attempt authority. Hudsucker's request handler uses the same route abstraction. |
| Rama body handling | The selected Rama request checks an oversized `Content-Length`, then applies a 128 KiB `Body::limited` collector under one 30-second timeout. `Blocked` requests fail before body collection. | These are selected-route controls only. They are not process-wide memory limits and do not limit Hudsucker's body collection. |
| Serialized request | The HTTP/1.1 serializer accounts for the request line, each header and CRLF, generated `Content-Length` where needed, the binding header, the header terminator, and body. Length additions use `checked_add`; the complete serialized length is capped before `Vec::with_capacity`. | The 128 KiB ceiling is for the complete serialized sent request, not a 128 KiB permitted body. A body can be accepted by the collector and later rejected because headers and framing use part of that budget. |
| TLS transport | The Production origin transport uses the configured DNS identity, system trust roots, and a single-use send path. The forwarder commits its `Sent` state before transport I/O and has no retry/fallback path. | Source wiring does not establish a live Game Server or Notary operation. A transport failure after a write begins can leave the remote outcome unknown. |
| Transcript and response | The transport records exact serialized request and raw response bytes. The verifier boundary compares their hashes to the exchange values. The origin response is returned before the deferred proof pipeline completes. | The browser-visible response is not an attestation or Result receipt. Proof failure after response return cannot undo the response already delivered. |
| Presentation verification | `RealAlpha15DedicatedVerifier` verifies the actual Presentation against the trusted Notary key and compares its observed server identity and transcript hashes with the expected values and captured exchange. It checks the binding session and nonce. | External Notary availability, deployed verifier behavior, and real Presentation evidence are not established by this source review. |
| Result fields and signing bytes | The Rust `VerifierResult` includes `presentation_sha256`, `server_identity`, transcript sizes/hashes, and both inventory/approval digest slots in canonical JSON and signing bytes. Validation rejects a half-present digest pair. | Generic validation permits both digests to be absent. A Production-specific path must require both. No tracked Production Worker runtime that generates and signs that Result was identified. |
| Result and archive handoff | The local boundary separates signing and delivery. The Worker response is verified by the APP-side verifier; the local filesystem delivery path is not an immutable Production archive. | Durable, immutable Production storage, readback, retention, and independent archive verification are not established. |
| Runtime Config and APP | The APP source has a feature-gated Production TLSN assembly path, guarded binding issuance and origin transport, Runtime Config verification, Target Approval preflight, and Worker identity checks. APP startup calls the Hudsucker entry point. | Rama remains an explicit experimental entry point, not the APP route. The checked-in Runtime Config bootstrap documentation reports release pins unregistered; actual deployed build inputs are `UNVERIFIED`. |
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

The current generic Rust Result validator requires the two digest options to
be both present or both absent and includes both optional values in its
signing bytes. That is not equivalent to a Production-required pair. The
Production-specific enforcement and Worker signing implementation are
`BLOCKED` pending tracked implementation and independent validation.

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

## One-shot, failure, and recovery contract

The observed route state is `Ready -> Selected` before request body collection.
The first matching request consumes the listener-shared opportunity. A later
matching request is `Blocked`. There is no rollback after body overflow,
timeout, stream error, binding failure, serialization failure, origin failure,
proof failure, or Result delivery failure.

The forwarder has another one-shot state machine. It consumes the binding
provider before awaiting binding issuance and commits `Sent` before transport
I/O. The existing implementation therefore avoids automatic retry after a
possibly partial send. Its scope is the forwarder instance, and it is not a
durable authority record.

| Failure point | Observed consequence | Recovery guarantee |
|---|---|---|
| Request selected; body read fails, times out, or exceeds limit | Listener route remains consumed; Rama fails closed before forwarder/upstream. | No same-listener retry; a new attempt requires a decision and authoritative issuance. |
| Binding issuance or receipt verification fails | Request does not reach origin; single-use guard may already be consumed. | No rollback/idempotency query is established. |
| Serialization fails after binding issuance | No origin send; forwarder and provider state are consumed. | No retry contract is established. |
| Origin send or response read fails | No fallback or automatic resend; remote processing may be unknown after I/O begins. | Reconcile with an authority before any new attempt; that mechanism is not present. |
| Origin response succeeds; proof/Notary/Presentation verification fails | Response has already been returned; background state records failure. | No proof recovery or durable job record is established by the local state machine. |
| Verification defers to a Worker job | A job ID is logged; local state becomes deferred. | Durable job polling, restart recovery, and idempotency are not established here. |
| Result signing/delivery fails | Browser response remains delivered; local pipeline records failure. | No durable replay or archive readback recovery is established. |
| Process restart or repeated request | In-memory route/forwarder state is lost on restart; same-listener retries are blocked before restart. | Cross-process uniqueness and replay rejection require authority-side state not established in this checkout. |

Do not describe any of these failures as retryable or recoverable until the
logical attempt identifier, authority idempotency, and recovery procedure are
approved and evidenced.

## Open decisions Q1-Q5

These are the only decision requests in this document. They remain `BLOCKED`;
no option below is an adopted policy.

### Q1 — What is the authoritative attempt identity and scope?

Choose and define whether one-shot applies to a listener, TCP connection,
authenticated session, or logical verification attempt. Define who issues the
identity, its uniqueness, lifetime, binding fields, and cross-process/restart
behavior. Current source establishes only listener-local gate state,
forwarder-local state, session IDs, connection IDs, request correlation, and
asynchronous job IDs. It does not establish a unique logical attempt ID.

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
limits, not a peak-memory guarantee. Rama's HTTP/1 configuration uses a
417,792-byte read-buffer ceiling; body limiting observes DATA only after it has
arrived. The Rama collector materializes the body and the serializer creates
the serialized output, so temporary copies and per-connection buffers may
coexist. Hudsucker's selected request currently passes through an unbounded
`body.collect()` and additional body copies. No global concurrency cap or
process memory budget is established here.

## Evidence gates

The following gates remain distinct:

| Gate | Current classification | Evidence required to change it |
|---|---|---|
| Source implementation | `OBSERVED` for the behaviors described above | Review against the exact source revision; source presence alone is not operational evidence. |
| Rust type checking and tests for this documentation task | `NOT_CHECKED` | Not run; Cargo may read protected configuration, and this task permits no build/test. |
| Rama synthetic and HTTP/1 loopback behavior | `OBSERVED` in source/test definitions; current execution `NOT_CHECKED` | Safe approved execution on the exact revision, with test scope identified. |
| Hudsucker regression | `NOT_CHECKED` for this task | Safe test execution on the exact revision; no claim from Rama-only tests. |
| Real Game Server TLSN evidence | `UNVERIFIED` | Human-operated gameplay producing non-synthetic TLSN Presentation and independently verifiable Result/archive. |
| Production acceptance | `BLOCKED` | Real deployment/runtime, authority, Notary, Game Server, immutable archive/readback, independent verification, and approved release evidence. |

The detailed phase and test plan is in
[`tlsn-data-authenticity-roadmap-2026-10-23.md`](../implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md).
