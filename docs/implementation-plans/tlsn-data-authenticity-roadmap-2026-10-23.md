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

**Current status:** Focused Node checks are `PASS` in the local follow-up
below. Rust/WASM, listener/CONNECT/TLS, real-service integration, and the
remaining decision-dependent cases are not established by those checks;
Phase 3 as a whole is not complete.

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

### Local follow-up: Result association, preflight, and reference consistency

This follow-up starts at
`504c6a1aa0673ab886c30626a6d64aa026bbd0af` on
`tlsn-first-testplay-candidate`. It addresses concrete input-consistency
failures without selecting a Q1-Q5 policy or authorizing live operations:

- [`deriveProductionTrustGraph`](../../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-contract.mjs)
  now requires binary `resultBytes` (`Buffer` or `Uint8Array`), valid UTF-8
  object JSON, and full JSON-value equality between the parsed artifact,
  `result`, and `semanticVerification.result`. Previously those three could
  describe different Results while the graph hashed only `resultBytes`.
  Result whitespace/key order may differ; the Result node still hashes the
  original supplied bytes, not a reserialization. This artifact is the inner
  Result JSON, not the outer Worker response envelope.
- The same constructor rejects a Session binding different from the Result's
  binding, empty/non-string bindings, and device authentication for a
  different device. These previously yielded a graph with inconsistent
  identities. The normal binding-node digests, topology, and unverified
  authority states are unchanged. These are association checks, not
  Session/consume receipt signature verification or device ownership proof.
- [`createPreCaptureReadiness`](../../packages/FUSOU-APP/scripts/testplay-pre-capture-readiness.mjs)
  reuses the shared fingerprint validator and projection hashes. It verifies
  the combined preimage, compile-time projection against the pinned Worker
  reference, and runtime projection against enabled candidate capture and
  the reported disclosure/response modes. Previously arbitrary hash-shaped
  values could pass. Disclosure must match the reference; existing `async`
  and `sync` modes remain supported, without choosing Q3.
  Missing/duplicate/non-passing required checks reject. The additive
  `gates.runtime_target_approval` field remains `REQUIRES_APP_RUNTIME`,
  separately from `gates.target_approval: POST_CAPTURE_REQUIRED`.
  Neither grants gameplay authorization or establishes an observed target.
- [`assertBuildReference`](../../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-build-handoff.mjs)
  reuses the existing Result signing identity/envelope validator and Notary
  registry consistency validator at reference consumption. It rejects
  corrupted registry signatures, unrelated or missing root/envelope inputs,
  changed raw registry bytes, a different Result signer, and Notary key
  mismatches before a build. It reuses existing active-key eligibility rules;
  it adds no Session/receipt expiry policy. The root is supplied by the
  independently pinned reference; this check cannot itself establish the
  external authority of that pin.

Execution evidence for this follow-up is `PASS`: 123 tests, zero failures,
zero skipped tests, using the following command from the repository root:

```sh
env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE \
  node --test --test-reporter=spec \
  packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-trust-graph-test.mjs \
  packages/FUSOU-APP/scripts/testplay-pre-capture-readiness.test.mjs \
  packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-build-handoff-test.mjs \
  packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-worker-deployment-reference-test.mjs \
  packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-worker-endpoint-mapping-test.mjs \
  packages/FUSOU-APP/scripts/testplay-verify.test.mjs \
  packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-manifest-test.mjs
```

The graph's 38 tests use structural fixtures, not valid TLSN Presentations
or signed Results. The 12 readiness tests use synthetic reports, including
Complete/Sparse and async/sync positive cases that retain the runtime,
post-capture, and human gates. Reference tests use ephemeral test keys;
control-plane requests and builds are mocked. Launcher recovery tests use
temporary synthetic configuration files and local test processes, never the
real APP configuration or an APP launch. Runtime Config tests use test-only
signing and object stores; Production signing remains blocked by the existing
registration guard. No Rust build, WASM integration, real service access,
deployment, or gameplay was executed.

| Phase 3 surface | Status | Evidence and remaining boundary |
| --- | --- | --- |
| Complete/Sparse Presentation/Result/Session/device graph association and identities | `PASS` | Local constructor tests only. No caller authenticates semantic outputs here; JavaScript/TypeScript call-site search found only the graph test, not a runtime collector. |
| APP local fingerprint/report consistency and gate preservation | `PASS` | Synthetic reports only; not binary execution, process authority, runtime proxy start, or gameplay permission. |
| Handoff/reference/endpoint mapping and Runtime Config consumers | `PASS` | Isolated build mocks, mock control plane, test-only signing/storage. Runtime Config preparation also consumes the strengthened reference validator. |
| Actual compiled APP, Rust/Node signed-byte interoperability, Presentation cryptography, listener/CONNECT/TLS | `NOT_CHECKED` | Existing definitions/source are not execution evidence. Cargo/Rust/WASM and the real launcher are excluded from this verification route. |
| Attempt competition, retry/recovery, response/evidence timing, expiry, memory guarantees | `BLOCKED` | Relevant Q1-Q5 decisions must precede new state/limit semantics and their tests. |
| Production Worker generation/signing, authority handlers, capture collector and archive persistence | `BLOCKED` | The checked Worker `src` index contains only the shared origin trust contract; the named runtime/archive entry candidates are not tracked. Obtain the actual implementation and deployment references, rather than inventing handlers or treating the local graph as wired runtime code. |

The checked JavaScript association/preflight/handoff surfaces have no further
identified independent defect after these fixes and the related tests.
This is not an exhaustive repository correctness claim. Remaining named
roadmap work crosses decision, external-input, or prohibited execution
boundaries above; it is not replaced by fixture evidence.

### Result duplicate-key resolution (2026-10-25)

**Baseline:** `068908bf337c88ce66910ce0c0e2673517bfbd78`.
**Source finding:** `OBSERVED`; Rust execution in this follow-up is
`NOT_CHECKED`.

The existing
[`parse_verifier_result` / `expect_result_field` / `parse_range_array`](../../packages/FUSOU-TLSN-VERIFIER/src/lib.rs)
read a fixed, single occurrence of each Complete Result v2 field and each
range's `start`, `length`, and `bytes`, then require the full input bytes to
equal `canonical_json()`. The
[`Sparse Result v3 parser`](../../packages/FUSOU-TLSN-VERIFIER/src/sparse_result.rs)
uses the same field/range helpers and canonical byte comparison. Neither
implements first-key/last-key precedence. Duplicate, unknown, reordered, or
escaped field names and noncanonical whitespace cannot pass those parsers.
The Sparse parser's existing negative test explicitly includes a duplicate
`version`; the Complete parser's tests include unknown fields and whitespace.
These are source observations, not newly executed Rust tests or closure of
P0-10.

In contrast, the graph constructor previously accepted duplicate keys whenever
`JSON.parse()`'s last value matched the supplied Result/semantic Result.
That mismatch is actionable without deciding receipt JSON policy or Sparse
Presentation wire semantics. The constructor now checks decoded object keys
for uniqueness in every object, including range objects. A lexical scan runs
only after `JSON.parse()` validates syntax; it tracks object/array scopes and
decodes key string tokens with `JSON.parse()`. It is not a replacement JSON
parser, schema validator, canonical serializer, or cryptographic verifier.
No dependency was added.

The graph still permits whitespace, key ordering, and equivalent escaped
unique keys for its local value-association check. This is deliberately not a
claim that its accepted bytes pass the stricter Rust Result parser. Complete
and Sparse Result verification must still use their actual parser, schema,
signing bytes and signature checks. The graph's Result node continues hashing
the exact supplied bytes, not decoded/re-encoded JSON.

The focused command below first produced 40 `PASS` / 4 `FAIL` out of 44
tests, reproducing missing duplicate rejection in both modes. After the fix:
44 `PASS`, zero `FAIL`, zero skipped. Added cases cover different and identical
duplicate values, escaped spellings of the same top-level key, nested range
duplicates, independent object key scopes, escaped string contents, and raw
hash preservation; existing formatting and byte-view cases remain.

```sh
env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE \
  node --test --test-reporter=spec \
  packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-trust-graph-test.mjs
```

Only structural fixtures and Node standard modules are used by this test.
No key, signature, real Presentation, receipt, or external-service evidence
was generated. The previous 123-test result above is historical, not a
rerun: readiness/handoff tests import a fixture that generates ephemeral
keys, which is prohibited in this follow-up. Those tests, Rust/WASM and the
real build/launcher remain `NOT_CHECKED` here. No further unrelated local
warning search is part of this bounded follow-up.

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
The tracked Worker operator runbook records missing runtime, Session Authority
handler, archive and collector source in the reviewed checkout. This does not
establish whether an external deployment exists. External existence,
implementation identity and behavior remain `UNVERIFIED` until operators
supply independently reviewable evidence.

### Operator handoff and restart conditions

Owner names below are roles, not an assertion that a particular person has
been appointed. No approvals, real endpoints, or trust material were supplied
by this local follow-up. Follow the existing
[`operator runbook`](../../packages/FUSOU-TLSN-VERIFICATION-WORKER/docs/production-evidence-operator-runbook.md)
and
[`revision/contract audit`](tlsnotary-alpha15-revision-attestation-id-interoperability-audit.md);
historical observations there are not current deployment evidence.

#### Approval requests: decisions must identify exact scope and revision

Each owner must return a dated approval/decision record identifying the
reviewer, source/contract revision, evidence, covered mode(s), exclusions and
stop conditions. No row is approved by this document. Q1-Q5 and P0-10 remain
`UNRESOLVED`; dependent implementation/gameplay is `BLOCKED`.

| Request / current status | Owner and next submission | Grounds and acceptance condition | Until accepted, do not |
| --- | --- | --- | --- |
| P0-01 dependency/patch approval — `BLOCKED` | Release/security approvers and license reviewer: approve or reject the exact upstream alpha.15 revision `47aee45b53e06648c1b2ad3689b367b8c923fdec`, local sparse patch set, and mux implementation for the candidate. | Use the revision audit's source map and independent-review package. The submission must identify patch/source digests, APP/Proxy/Verifier dependency differences, packed transcript/proof-opening effects, serializer compatibility, mux resource implications, license obligations and independent review findings/disposition. Missing evidence includes general adversarial/independent compatibility coverage and mux resource-pressure evidence noted in the dossier. Accept only an explicit authorized decision covering those risks and the exact candidate; a manifest revision or one passing sample is insufficient. | Infer independent security/license approval, change forks to hide gaps, or authorize a broader testplay scope than approved. |
| P0-10 ClaimBindingBytes — `UNRESOLVED` | Protocol owner, then human release authority: select precedence/supersession and applicability of the documented 8-field and 11-field layouts. | Return a versioned field/domain/encoding specification, migration/compatibility rules and expected bytes/rejections linked to the conflicting definitions in the revision audit. Accept when producers/consumers and allowed testplay scope are explicitly identified. | Choose a layout from current code or passing vectors and call it normative. |
| P0-10 receipt JSON — `UNRESOLVED` | Protocol/authority owners: decide canonicalization, duplicate/unknown-field handling and applicability for each receipt type. | Specify signed preimage versus raw artifact bytes, escaping, ordering, number rules, parser rejection rules and compatibility; approve examples and negative expectations. Result parser behavior does not settle receipt policy. | Apply the graph's Result duplicate check to receipts or silently change receipt signing semantics. |
| P0-10 Sparse Presentation — `UNRESOLVED` | Protocol owner: publish the normative Presentation wire contract, distinct from Sparse Result v3 JSON. | Specify serializer/version/configuration, integer/range encoding and normalization, packed transcript/opening semantics, trailing/malformed-byte policy and compatibility scope. Accept a versioned contract plus validation obligations grounded in the revision audit, not a source-derived sample alone. | Treat the existing sparse fixture or today's serializer output as the approved wire format. |
| P0-10 independent expectations — `UNRESOLVED` | Protocol owner and independent verifier/reviewer: provide independently grounded expected bytes, digests and rejection cases for the approved contracts. | Identify provenance, generation method, exact approved contract and independent implementation/reference; compare Complete/Sparse signing bytes and receipt framing separately from Presentation decoding. Existing local corpus is implementation evidence only. | Claim cross-language protocol approval from two source-derived implementations or generate replacement signatures/keys in this task. |
| P0-10 WASM provenance — `NOT_CHECKED` | Build/release and independent reviewers: supply an artifact-to-source provenance dossier from a separately authorized environment. | Identify artifact digest, exact approved source/patches, lock/toolchain/features/build inputs and reproducibility/verification records. Wrapper/source correspondence is not established by exported API names. No protected WASM source or Rust/WASM build was inspected/executed here; owner review and approved contract scope remain required. | Inspect protected source, build WASM here, or infer that a packaged artifact equals current Rust source. |
| Q1 attempt identity/scope — `UNRESOLVED` | Protocol/product and authority owners: decide scope (for example logical attempt versus connection/session), issuer, uniqueness, binding and restart behavior. | Use the authenticity contract's Q1 alternatives and competing-connection cases. Accept a versioned scope/state definition and cross-connection negative expectations. | Promote connection/job IDs to authority, add new attempt identifiers or replace the current scope by assumption. |
| Q2 failure/retry/recovery — `UNRESOLVED` | Protocol/authority owners: decide consumption and reconciliation at body rejection, authority uncertainty and possibly partial origin I/O. | Submit a state/side-effect table, recovery owner, idempotency constraints and failure/replay cases. Accept explicit rules preventing accidental duplicate Game Server effects. | Retry after uncertain send, silently recover through a new request, or invent receipt/authority reconciliation rules. |
| Q3 response/evidence timing — `UNRESOLVED` | Product/protocol and human release authority: decide whether pre-proof response return is intended and how pending/failure/verified/signed/archived states surface. | Base the decision on the contract's existing deferred pipeline; specify observable transitions, stop conditions and tests. Accept an explicit policy, not the local async/sync compatibility check. | Turn browser response or local preflight success into proof, or choose a new synchronous/asynchronous gameplay policy. |
| Q4 expiry/revalidation — `UNRESOLVED` | Session/Binding Authority and protocol owners: set session/receipt freshness, clock assumptions and checks at send, deferred verification and delivery. | Provide policy and boundary/restart tests distinct from Runtime Config lifetime and Result key eligibility. Accept explicit validation times and failure handling. | Reuse manifest/key expiry as receipt expiry, add timeouts as authorization policy, or relax stale-receipt checks. |
| Q5 memory boundary — `UNRESOLVED` | Proxy/product owners and resource reviewer: choose accepted-size-only, per-request peak or process-wide accounting and concurrency boundary. | Use the contract's Q5 choices, buffer-layer distinctions and measurement plan; identify included buffers/tasks and evidence needed for the chosen claim. Body and serialized-request limits remain separate. | Treat 128 KiB limits, `CaptureIo` read-chunk size or upstream approximate buffering defaults as measured peak/process memory guarantees. |

#### Operational submissions: public trust evidence, not secrets

Operators must supply approved public references, raw evidence and validation
records through the authorized process; do not submit private keys, access
tokens or unredacted credentials. Existing external deployment existence is
not inferred either way. `UNVERIFIED` records a lack of evidence here.

| Input / current status | Owner and next submission | Acceptance condition / next operation | Until accepted, do not |
| --- | --- | --- | --- |
| Runtime Config — `BLOCKED` | Trust authority and Runtime Config/release operators: approved endpoint, independent signer/root public pin, registration record, signed manifest, epoch and referenced raw artifacts. | Verify signature, source/deployment binding, active epoch/freshness and exact artifact digests with independently obtained pins; register the approved release inputs and publish/read back under authorized operations before runtime preflight. | Invent/register a signer or endpoint, publish here, or let local fingerprint consistency substitute for manifest authentication. |
| Canonical target / Inventory / Target Approval — `BLOCKED` | Authoritative target owner and deployment operator: actual lowercase DNS hostname, raw Inventory/Approval, signatures and approval relationship/membership evidence. | Independently verify raw hashes and signatures, Approval-to-Inventory relation and target membership before proxy start. After capture, match the Presentation-derived server identity and Result's mandatory digest pair to those exact artifacts. | Use a URL/IP/port/certificate pin/custom root as target identity, substitute candidate selection for observed identity, or bypass Target Approval. |
| Worker deployment / release reference — `UNVERIFIED` | Worker/release operator: actual implementation/source reference, deployed SHA/version and authenticated control-plane endpoint mapping, plus independent exact reference hash. | Match approved release inputs, active version and endpoint mapping using independent observation. Local reference validation checks consistency, not live existence; after validation prepare the candidate against that pin. | Infer deployed SHA from CI, fetch external control plane here, or claim absent tracked handlers prove no external service exists. |
| Result signing registry / root — `UNVERIFIED` | Trust authority and Result service operator: public signer identity, exact raw registry, signed registry envelope and independent root/key pins tied to the approved deployment. | Verify envelope signature and raw registry digest, signer membership/eligibility and reference/manifest consistency; independently verify the captured inner Result signature using the required signing domain. | Create a test root/signer as a Production substitute or treat graph value equality as signature verification. |
| Notary registry / key — `UNVERIFIED` | Notary operator and trust authority: deployed revision/patch identity, approved endpoint, exact registry and independently selected public verifying key. | Match registry membership, Runtime Config and APP inputs; actual Presentation verification must authenticate the Notary key and transcript under the approved implementation. | Infer real Notary participation from a mock or Presentation key without an independent trust pin. |
| Auth / registered device / Session / binding receipt — `UNVERIFIED` | WEB/Auth and authority operators: authenticated nonanonymous-user evidence, device ownership/revocation record, deployed authority references, public registries and exact signed receipts. | Verify signatures and same user/device/session/binding/Presentation association plus replay/consumption state under approved Q1/Q2/Q4 rules. Complete runtime gates before gameplay and recheck capture receipts independently. | Fabricate receipts, skip revocation/ownership, or elevate a synthetic device-authentication match into real Auth. |
| Actual Result generation / collector / archive — `UNVERIFIED` | Worker/verifier and evidence-storage operators: reviewable generation/signing/delivery/collector implementation and deployed identity, storage policy and exact capture/archive references. | Demonstrate the same raw Presentation produces the corresponding signed inner Result and outer response; retain applicable execution/consume receipts and exact envelope binding. Read back immutable archives, compare lengths/hashes to original bytes and record failure behavior. Resume evidence collection only with the approved path. | Treat local graph construction as runtime wiring, or mocks/local filesystem output as immutable Production storage. |
| Clean candidate APP build / pre-capture checks — `NOT_CHECKED` | Release operator: approved source/patch SHA, committed lock, locked dependencies, pinned toolchain, independent Worker reference and controlled public/bootstrap inputs; real build and compiled-input reports. | In a separately authorized environment, confirm build provenance, artifact hash, compiled-input comparison, local preflight and runtime Config/target/Auth gates. Hudsucker remains default; Rama is opt-in experimental. `LOCAL_APP_PREFLIGHT_PASS` alone grants no gameplay. | Run the protected-file-sensitive build/launcher here, infer actual binary behavior from mock tests, or introduce process/image authority/TPM. |
| Human gameplay authorization — `BLOCKED` | Human release authority: signed/dated scope naming operator, exact approved versions/modes/target, evidence plan and stop conditions after prerequisite review. | Explicitly approve the resolved dependency/wire/policy scope and real runtime inputs; only then may the named human use normal APP operations. If a narrower exception is proposed it must itself be explicitly approved, not inferred. | Have AI/tests contact the Game Server, waive P0-01/P0-10/Q decisions, or equate readiness with authorization. |
| Capture / readback / independent offline verification — `UNVERIFIED` | Human operator, storage operator and independent verifier: real same-communication Presentation, signed Result, applicable receipts, raw archives and separately acquired public trust references. | Verify Presentation cryptography, authenticated transcript/server identity and Notary trust; inner Result signature and exact Presentation/Inventory/Approval hashes; session/binding/receipt association; exact archive readback lengths/hashes and applicable outer response/execution receipt binding. Run an independent offline verifier with approved negative mutations and record exact versions/output. Only this can support evaluating the real-game gate; Production acceptance remains separate. | Replace real capture with fixtures, claim a hash is a TLSN proof, or promote a successful CLI/local test to Production acceptance. |

**Next human actions:** appoint the approval/service owners; return P0-01 and
the separate P0-10/Q decision records; provide the public operational input
package; authorize the actual build/runtime preflight; then authorize human
capture and independent verification. Record each accepted row's evidence,
reviewer and date before advancing its dependent operation. This is a
handoff request, not permission to execute any external step in this task.

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
