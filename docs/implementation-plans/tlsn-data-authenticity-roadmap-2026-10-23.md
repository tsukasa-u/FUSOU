# FUSOU TLSN Data Authenticity Implementation Roadmap

**Status:** Draft; pending Q1-Q5 decisions and human release authority.
**Source baseline:** `tlsn-first-testplay-candidate` at
`e1d985bf326378346d1cf86b2e5269e3fe03cd95`.
**Contract:** [`tlsn-data-authenticity-contract.md`](../architecture/tlsn-data-authenticity-contract.md).

This plan sequences work from source-grounded contracts through local
verification, human gameplay, and Production acceptance. It does not authorize
external operations, select a design for unresolved questions, or claim that
any later gate has passed.

## Constraints

- Preserve existing user changes and keep the current branch/source as the
  baseline for each phase.
- Do not access protected configuration or verifier paths indirectly. Until a
  safe approved verification route exists, do not run Cargo build, check, test,
  or Clippy.
- Do not change the default Hudsucker route, make Rama the APP default, remove
  the Hudsucker fork, or change TLSN forks as part of this plan.
- Do not introduce APP process/image authority, TPM, measured boot, privileged
  helpers, or browser integrity as readiness requirements.
- Do not contact a Production Worker, R2, Notary, or Game Server without
  separate explicit approval. The real Game Server test must be human gameplay
  through the APP.
- Keep every result classified using `OBSERVED`, `UNVERIFIED`, `NOT_CHECKED`,
  `BLOCKED`, `PASS`, or `FAIL`. A successful local or synthetic test does not
  promote a real-world gate.

## Phase 0 — Baseline and protected verification route

**Current status:** `OBSERVED` for local branch and source baseline;
`NOT_CHECKED` for full worktree state and any tests in this document task.

1. Record branch, HEAD, local upstream tracking SHA, ahead/behind, and scoped
   worktree state without querying protected paths.
2. Preserve current changes and distinguish pre-existing from new work.
3. Inventory only specific compiler/build entry points that might read
   protected files. Do not run a command merely to discover its behavior.
4. Select a validation environment only if the protected-file access path is
   demonstrably absent. Otherwise leave compilation and tests `NOT_CHECKED`.
5. Record source, test, synthetic, loopback, hosted, human-gameplay, and
   Production evidence as separate classes.

**Gate:** `BLOCKED` if a proposed check might read a protected path or if the
baseline cannot be established safely.

## Phase 1 — Approve the authenticity contract

**Current status:** Fixed identity and trust requirements are recorded in the
contract; Q1-Q5 are `BLOCKED` pending owner decisions.

Resolve Q1-Q5 in
[`tlsn-data-authenticity-contract.md`](../architecture/tlsn-data-authenticity-contract.md):

1. **Attempt identity and scope:** distinguish listener, connection,
   authenticated session, and logical attempt. Specify issuance, uniqueness,
   binding, expiry, and restart behavior.
2. **Failure/retry/recovery:** define which failures consume an attempt and
   how uncertainty after binding or origin I/O is reconciled without duplicate
   Game Server effects.
3. **Response/evidence states:** decide whether returning a Game Server
   response before proof completion remains intended; define pending, failure,
   verified, signed, and archived state transitions.
4. **Expiry:** define authority receipt/session freshness separately from
   Runtime Config freshness and state the checks required at origin send,
   deferred verification, and delivery.
5. **Memory:** select accepted-size-only, per-request peak, or process-wide
   bound; define included buffers, concurrency, tasks, and measurement boundary.

Do not assume the current listener-global one-shot is the final policy. Do not
add new identifiers or retry semantics until the authority owner approves
their meaning.

**Gate:** No behavior change that affects attempt scope, retries, expiry, or
memory guarantees before the relevant decision is recorded.

## Phase 2 — Implement approved attempt and memory controls

**Current status:** `BLOCKED` on Phase 1 decisions.

After approval, implement only the selected policy:

- Persist or obtain authoritative attempt state at the approved boundary;
  correlate connection, binding, request, Presentation, Result, and archive
  without treating `connection_id` or Worker `job_id` as a logical attempt.
- Make state transitions explicit for body rejection, authority uncertainty,
  serialization, origin send/response, proof, verification, signing, and
  delivery. No automatic retry after possibly partial origin I/O.
- Enforce separately named body and serialized-request ceilings. Apply the
  approved policy to Hudsucker and Rama, including Content-Length and
  chunked/streaming bodies.
- If peak-memory guarantees are selected, account for ingress read buffers,
  collected chunks, serializer allocation/copies, TLS/proof buffers, and
  concurrent connections/tasks. Do not claim that a byte cap alone bounds RSS.
- Specify HTTP/1 connection behavior when rejecting unread bodies. Do not
  rely on unlimited draining; test close/framing semantics at the actual
  listener boundary.
- Add or preserve a whole-collection deadline if approved; establish
  cancellation and resource-release behavior rather than assuming that dropping
  a future bounds all underlying work.

**Gate:** Source review confirms the implementation matches the approved
state/limit specification. Type checking and focused tests are still required
when a safe execution route is available.

## Phase 3 — Local protocol and integration verification

**Current status:** `NOT_CHECKED` for execution in this documentation task.

Use test layers appropriate to each claim:

| Test case | Required test layer | What the test must establish |
|---|---|---|
| Competing requests with different connection IDs | Synthetic route/forwarder test | Approved scope selects exactly the authorized attempt; no accidental cross-connection association. |
| Body exactly at and above each limit | Collector/serializer synthetic tests | Boundary behavior, overflow safety, no upstream/TLSN send on rejection. |
| Fixed-length and chunked bodies | HTTP body stream and HTTP/1 loopback | Actual streamed accumulation is bounded; `Content-Length` is only a precheck. |
| Body timeout and mid-stream error | Controlled body stream and HTTP/1 loopback | No empty/partial-body success, no fallback, bounded cancellation, correct close behavior. |
| Header-heavy request and binding insertion | Serializer test | Calculated length equals emitted bytes, including request line, header bytes/CRLF, binding, terminator, and body. |
| Selection followed by failure and retry | State-machine test plus authority contract test | The documented consumption/recovery policy is followed; no duplicate send. |
| Concurrent body collection and large ingress DATA | HTTP/1 loopback/load test | Observed buffering at the ingress and collector layers; measurements include the declared accounting boundary. |
| Hudsucker body path | Hudsucker regression tests | Approved limits and no behavior changes outside the targeted route. |
| Exact TLS transcript and Presentation binding | Synthetic TLS/Notary fixture | Exact bytes and cryptographic verification in the fixture only; not a real Game Server or Notary. |
| Result signatures and evidence association | Rust/Node cross-language vectors and offline verifier tests | Signed bytes, hashes, identity, receipt, and archive mutations reject as specified. |
| Public APP entry point | Explicit CONNECT/TLS integration test, if safely executable | APP-facing route selects the expected backend and preserves failure semantics; not real gameplay. |

Do not use test names as proof. Record the exact source revision, command,
output, fixture type, and which boundary is exercised. A loopback test that
omits CONNECT/TLS does not establish the public APP entry path.

**Gate:** Required local checks complete with `PASS` for each named test only.
Unavailable or unsafe checks remain `NOT_CHECKED` or `BLOCKED`.

### Local follow-up: Presentation byte binding in graph derivation

The follow-up based on `8757aeca8886e967106ba17fd1c338cd3ba3d14e` adds a
fail-closed check to
[`deriveProductionTrustGraph`](../../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-contract.mjs).
Before emitting a graph, it requires the semantic Result's and proxy
provenance's `presentation_sha256` to equal SHA-256 of the supplied raw
Presentation bytes. It reuses that digest for the Presentation node. This
enforces an existing byte-binding requirement; it does not decide Q1-Q5.

The standalone
[`production-evidence-trust-graph-test.mjs`](../../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-trust-graph-test.mjs)
imports only Node standard modules and the local contract module. From the
repository root, the focused command is:

```sh
env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --test packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-trust-graph-test.mjs
```

The initial run reproduced eight missing-rejection failures out of twelve
tests. After the fix, all twelve tests were `PASS`, with no skipped tests.
Complete and Sparse graph fixtures cover matching inputs, raw byte mutation,
missing/invalid Result hashes, mismatched proxy hashes, matching declarations
for the wrong raw bytes, and the existing Attestation ID mismatch rejection.
Graph topology, node digests, and unverified provenance status are preserved
for matching inputs.

These are synthetic structural fixtures, not valid cryptographic Presentations
or signed Results. The helper does not authenticate the caller's semantic
verification output or independently verify Result signatures, the outer
Result envelope, Inventory/Approval, or archives. It is not a deployed Worker
handler or a real-gameplay path. Rust checks, listener/CONNECT/TLS tests, and
external runtime behavior remain `NOT_CHECKED` in this follow-up. Phase 3 is
not complete; real-game TLSN evidence remains `UNVERIFIED` and Production
acceptance remains `BLOCKED`.

### Local follow-up: binary inputs and reloaded Sparse graph identities

The next follow-up is based on
`cc96021eec0ab2b6412f926888a80151caef2ae0`. Scoped JavaScript/TypeScript
call-site searches found the local graph test's `Buffer.from(...)` fixtures,
not a Worker runtime caller. `deriveProductionTrustGraph` now checks
`presentationBytes` with Node's `isUint8Array` before hashing or other binding
checks. This accepts `Buffer` and `Uint8Array`, including offset views, and
rejects strings, encoded text, other view types, and prototype-only lookalikes
with an explicit `TypeError`. It does not coerce input. The shared hash helper
still accepts strings for session bindings and challenges; its contract was
not changed.

For Phase 3 evidence association checks,
`assertTrustGraphNodeIdentities` previously used reference equality for each
identity field. Consequently, separately JSON-parsed Sparse response ranges
were rejected even when all values matched. It now uses Node's
`isDeepStrictEqual` for field values. Object key order does not affect this
in-memory comparison, but range order, field presence, types, offsets,
lengths, and byte strings must match. This is not normalization of raw evidence
bytes or signed JSON, and topology validation still runs first.

The same standalone graph test command above exercises both changes using
synthetic structural fixtures. Before the input guard, twenty tests produced
fourteen `PASS` and six `FAIL`; after the guard, all twenty were `PASS`.
Adding identity regressions reproduced two false rejections out of twenty-eight
tests before the value-comparison fix. After both fixes, all twenty-eight were
`PASS`, with no skipped tests. Coverage retains the earlier digest and
Attestation ID checks and adds byte-view acceptance, invalid-type rejection,
JSON-reloaded identities, scalar mismatches, topology rejection, and changed
Sparse range content/types/order/fields.

These changes guard local graph construction and comparison only. Expected
identities must still come from independently verified inputs; comparing them
does not authenticate either side. No signature, Presentation cryptography,
archive readback, Worker/APP wiring, or external runtime was verified here.
Q1-Q5 remain undecided. Rust/WASM integration remains `NOT_CHECKED`, real-game
TLSN evidence remains `UNVERIFIED`, and Production acceptance remains `BLOCKED`.

## Phase 4 — External dependencies and operator evidence

**Current status:** `BLOCKED` until responsible operators provide independently
verified external inputs.

Before gameplay, the human release authority and service owners must provide
and verify:

- approved Runtime Config bootstrap endpoint/key, signed manifest, and active
  epoch/version;
- exact Origin Inventory and Target Approval raw bytes and signatures, with
  their relationship and target membership;
- deployed APP/Worker/Authority/Notary/Verifier versions and trust pins;
- authenticated Auth session, registered device identity, authority receipt,
  expiry, and attempt/idempotency behavior;
- deployed verifier and result-signing implementation, signer public key and
  registry;
- immutable Production evidence storage, exact keys, retention, readback,
  lengths, and hashes;
- an independent offline verifier and independently acquired references.

Do not fill missing inputs with test values. Do not infer deployed identity from
CI, source comments, a health response alone, or the package being verified.
The tracked Worker operator runbook reports that the Worker runtime,
Session Authority handler, archive implementation, and collector are not
present in this checkout; an external implementation must be supplied and
reviewed rather than assumed.

**Gate:** `BLOCKED` while any required endpoint, trust root, authority,
deployment, archive, or independent reference is absent or unverified.

## Phase 5 — Human Gameplay Gate

**Current status:** `UNVERIFIED`; no human gameplay evidence is established by
this plan.

Only after Phase 4 approval, a human uses the ordinary APP gameplay path. The
human and operator record:

1. actual target selected from an authoritative source;
2. APP/runtime/Worker/Authority/Notary/Verifier identities and version
   references;
3. observed TLSN Presentation server identity and cryptographic verification;
4. exact Presentation, transcript, binding/receipt, and signed Result bytes;
5. Result signature and required Presentation/Inventory/Approval digests;
6. exact archive retrieval, readback, byte lengths, and locally recomputed
   hashes;
7. separate-machine offline verification using independently acquired trust
   references;
8. negative checks for altered bytes, wrong target, wrong attempt, duplicate
   processing, replay, and mismatched archive.

Do not have an AI or test harness contact the real Game Server to manufacture
gameplay evidence. Synthetic fixtures remain synthetic and cannot pass this
gate.

**Gate:** `PASS` only when a human-generated, non-synthetic capture has a
complete independently verifiable chain. Any missing edge remains
`UNVERIFIED` or `BLOCKED`.

## Phase 6 — Production acceptance and release

**Current status:** `BLOCKED`.

After Phase 5, validate the approved release-tag path, deployed code and
Runtime Config, Result signer and verifier versions, immutable archive
behavior, restart/recovery, replay rejection, and independent evidence
verification. A failed acceptance check must stop release. Bind the deployed
version, policy, trust references, Result, and stored evidence in the operator
record.

**Gate:** Production acceptance is a separate decision from human testplay.
It remains `BLOCKED` until every approved Production acceptance criterion has
its own evidence.

## Existing documentation

- The current source status for APP/Proxy/Verifier and external blockers is
  summarized in
  [`packages/FUSOU-TLSN-VERIFIER/pkg/README.md`](../../packages/FUSOU-TLSN-VERIFIER/pkg/README.md).
- The earlier Game Identity implementation plan remains a related workstream,
  not a substitute for the unresolved Q1-Q5 decisions or this acceptance gate:
  [`tlsnotary-game-identity-attestation-v1-implementation-plan.md`](./tlsnotary-game-identity-attestation-v1-implementation-plan.md).
- TLSN alpha.15 source mapping and interoperability gaps remain governed by
  [`tlsnotary-alpha15-revision-attestation-id-interoperability-audit.md`](./tlsnotary-alpha15-revision-attestation-id-interoperability-audit.md).
- Rama remains experimental and Hudsucker remains the default; see
  [`RAMA_MIGRATION_PLAN.md`](../../packages/FUSOU-PROXY/proxy-https/RAMA_MIGRATION_PLAN.md).
