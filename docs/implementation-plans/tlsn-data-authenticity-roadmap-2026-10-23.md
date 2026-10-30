# FUSOU TLSN Data Authenticity Implementation Roadmap

**Status:** Exact-owner proof APIs/atomic DB claims, independent origin outcome,
partial approved-material collector and active mux-fork removal implemented.
Authority-durable origin attempts, complete Evidence assembly, trusted-time
coverage and full resource accounting remain `BLOCKED_CODE`; external execution
and Production acceptance remain blocked.
**Source baseline:** `tlsn-first-testplay-candidate` at
`e1d985bf326378346d1cf86b2e5269e3fe03cd95`.
**Contract:** [`tlsn-data-authenticity-contract.md`](../architecture/tlsn-data-authenticity-contract.md).

This plan sequences work from source-grounded contracts through local
verification, human gameplay, and Production acceptance. It does not authorize
external operations, select a design for unresolved questions, or claim that
any later gate has passed.

## Current implementation continuation

The latest continuation starts at `fc29aac29d454bf949510e0d97acbd3cd7e68e5b`.
The [current readiness record](../../packages/FUSOU-TLSN-VERIFIER/FIRST-TESTPLAY-READINESS.md)
supersedes historical build restrictions/counts below. Q1-Q5 now have explicit
user-directed implementation policy; do not ask the user to select it again.

1. **Completed locally:** existing WEB exact-owner proof handler + shared framing
   + PostgreSQL transaction/audit, concurrency/restart/revocation/rollback tests.
   No live migration, deployment or new enrollment/transfer authority.
2. **Completed locally:** immutable raw Runtime Config/registry/Inventory/Approval
   snapshot -> actual APP signer -> hash/length-indexed candidate files.
   Nineteen-role completion and all independent pins remain mandatory.
3. **Completed locally:** separate origin outcomes, explicit ambiguous send and
   post-response evidence failure tests. No second origin send.
4. **Next code, highest priority:** replace listener-global capture refusal with
   authority-durable logical-attempt reservation and a crash-safe APP pre-send
   journal; bind user/device, session/binding, approved target/profile and exact
   request digest. Reject concurrent duplicate/restart reuse; do not create a
   fresh attempt to hide an uncertain write. Preserve normal distinct operations.
5. **Then:** move approved Session preparation outside the selected request's
   latency-critical phase, revalidate authority validity immediately before send,
   and preserve explicit refusal/reconciliation instead of silent auth fallback.
6. **Then:** connect remaining role producers (owner observation/replay, health,
   capture metadata, semantic report and subject), using existing approved
   APIs/verifier derivation and independent external registries. Keep finalizer
   verification-before-atomic-publication; do not self-compare local auth material.
7. **Then:** complete trusted-time and whole-process/concurrency/queue budgets;
   approve and implement Production execution/delivery receipt contracts and
   full-Bundle remote retention separately. Real testplay/deployment needs human
   authorization and valid public inputs; it is not granted by these commits.

## Constraints

- Preserve existing user changes and keep the current branch/source as the
  baseline for each phase.
- Do not access protected configuration or verifier paths indirectly. Native
  GNU checking now target-gates the WASM bridge and uses the actual isolated
  APP graph; do not run protected-source WASM/provenance or configuration tests.
- Do not change the default Hudsucker route or make Rama the APP default.
  Active mux path patches are now removed using pinned upstream public setters;
  remaining sparse/owned-worker TLSN and Hudsucker forks are not approved or
  replaced by this follow-up.
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

### Tag validation and bounded release automation (2026-10-25)

Baseline: `90c1f56b932ffc047b8a9fc951f007c21bf45bfe`.
Local tag metadata contains `fusou-v0.0.0` through `fusou-v0.5.0` release
names, alongside unrelated archive/dataset tags. No remote tag or CI lookup
was performed. Existing `fusou-vX.Y.Z` is retained for stable Production;
new `fusou-dev-*` names are development-only. Dataset/archive names are
not reclassified. A development tag can point at any branch commit: no merge
or main ancestry is required. The ordinary operation is to tag the intended
commit, not to switch to main; this task creates/pushes no tags.

[`tlsn-tag-validation.yml`](../../.github/workflows/tlsn-tag-validation.yml)
checks out the exact pushed SHA without persisted credentials, checks that
the checkout matches it, validates the namespace, verifies committed/nonignored
lockfiles, and runs key-free Node contracts and static migration checks.
It has only contents-read permission, no environment, secrets or OIDC grant,
and runs no APP build, Rust, dependency install or deployment.
This checks lockfile presence/tracking, not dependency resolution or a build.

[`tlsn-release-eligibility.yml`](../../.github/workflows/tlsn-release-eligibility.yml)
is a read-only `workflow_run` coordinator whose definition must be installed
on the trusted default branch (main). It checks out main code, never the
triggering tag code, and queries run/ref/branch/content metadata through
[`release-eligibility.mjs`](../../scripts/release-eligibility.mjs):

- Require a successful same-repository push run from the exact validation
  workflow path; missing tag/run/API evidence fails, never defaults to main.
- Resolve lightweight/annotated tags to a full commit SHA; require equality
  with the tested SHA and reject moved tags.
- For Production only, independently resolve main and require the tag commit
  to be its ancestor, using comparison status and merge-base identity.
- Compare the validation workflow blob to the trusted coordinator checkout
  and recheck the tag after validation. No tag-provided executable or
  downloaded workflow artifact is run by this coordinator.

The JSON report records tag, tested/coordinator/main SHAs, validation run,
eligibility, explicit blockers, and deployment state. Artifact hashes,
Worker version and Runtime Config identity remain empty/null until real
linked release evidence exists. Production currently returns
`BLOCKED_EXTERNAL_INPUTS`, not a success-shaped release or deployment.
Failed/blocked reports are preserved and fail the coordinator job.
Actual GitHub event payloads, hosted execution, settings and API behavior
remain `NOT_CHECKED`; in particular missing tag identity in run metadata is
a rejection, not permission to guess a tag.

The old manual
[`publish_and_create_version_tag.yml`](../../.github/workflows/publish_and_create_version_tag.yml)
previously created/published APP releases independently of TLSN readiness.
It now explicitly fails before its privileged jobs; those jobs also name
`production-release`. This intentionally suspends that bypass path, rather
than pretending the missing APP/Worker/Runtime Config linkage is implemented.
Do not simply remove the stop to enable publishing. APP build, initialized
Worker deploy, post-deploy verification and final linked release reporting
are still implementation work; this task executes none of them.

#### One-time trust setup versus ordinary releases

Repository code alone cannot prevent a modified tag workflow from reading a
repository/org secret or obtaining an overly broad OIDC role. Before enabling
privileged automation, administrators must supply auditable evidence of:

1. All Production credentials removed from general repository/org visibility
   and scoped to a protected `production-release` Environment. Use distinct
   least-privilege credentials for unrelated docs/simulator workflows;
   moving one secret reference in YAML does not revoke its old exposure.
2. Environment deployment branch policy allowing **main branches only, not
   tags**; protected main/rulesets and trusted workflow/script review.
   A tag that modifies its own conditions must still be denied by this
   external policy. Settings, administrator bypass and access controls are
   not verified here. Reviewers may be an initial setup control, but are not
   a proposed recurring protocol-approval step.
3. If OIDC is later used, provider trust restricted to the approved
   repository/environment and trusted main-owned workflow identity, with
   least privilege. No OIDC request or grant was added here.
4. Existing Worker/storage/authority services, signer/root bootstrap and
   Runtime Config registration, versioned protocol decisions and independent
   public pins. Tags must not create accounts/buckets/services/keys or fill
   absent inputs with test values.

After this one-time setup and contract finalization, ordinary releases
should mechanically verify the selected tag SHA, required CI, locked build
and artifact hashes, initialized Worker deployment/version, signed Runtime
Config epoch/digests and the exact APP/Worker/config release linkage. A
future privileged job must consume a fresh trusted eligibility decision,
recheck mutable tag/deployment state before publication, and never execute
non-main-history candidate code with Production credentials. Current
read-only reports confer no such permission.

P0-01/P0-10 and Q1-Q5 are design-time decisions, not intended recurring
manual approvals for each tag or gameplay session. Once decided, encode
the approved revision/patch identities, wire semantics, vectors and policy
version in contracts/tests/CI and reject mismatches mechanically. Changing
those trust/contract versions is a separate governed operation. Existing
unresolved rows below remain unresolved; this task does not select their
semantics. Hostname-list correctness can be the routine operator input,
but initial public trust roots, service/credential setup, key rotation and
trusted release execution remain security assumptions, not properties
derived from a hostname list.

#### Evidence automation limits and concrete local progress

The graph now rejects a Result server identity that differs from the supplied
verified Presentation identity and requires that observed identity to be
canonical. It reuses the shared hostname validator and does not convert a
candidate identity into authority. The caller must still authenticate the
Presentation and semantic output: this local check is not TLSN/Web PKI
verification or proof that its result is wired into a deployed Worker.
Key-free structural tests also exercise canonical hostname rejection and the
existing Inventory/Target Approval resolver's membership, raw serialization
and digest/order constraints. No production hostname or trust root is added.

Presentation cryptography, Result signature/domain, required Production
Inventory/Approval digests, receipt/device/replay correlation and exact
archive readback remain separate required checks. Existing Rust verifier
source and local checks are not evidence of deployed generation/storage.
Runtime Config epoch checks plus a local accepted-epoch record can reject
rollback relative to that retained state; restoring/deleting OS-controlled
state can remove that history. No external monotonic checkpoint, process
attestation or rollback-proof OS storage is established here.

Rama provider decoupling and required future tests are recorded in the
[`migration plan`](../../packages/FUSOU-PROXY/proxy-https/RAMA_MIGRATION_PLAN.md).
Hudsucker remains default; the fork and shared capture-hook dependencies are
not removed. Source/static checks do not establish compiled or runtime parity.

| Remaining work class | Next concrete output / acceptance |
| --- | --- |
| Implementation | A main-owned privileged release consumer of the fresh eligibility report; immutable APP/Worker/config artifact linkage, hashes, initialized-only deployment and post-deploy verification. Must fail on missing/stale/mixed inputs and never accept arbitrary tag code before credentials. The old manual gate stays closed. |
| One-time external setup | Auditable credential relocation, main-only Environment policy, main/workflow governance, public bootstrap pins and existing service registration. Missing settings are `NOT_CHECKED`, not assumed absent or configured. |
| Protocol decisions | Resolve existing P0-01/P0-10/Q1-Q5 choices once; encode the selected contract versions, vectors and compatibility/migration rules in tests and release gates. No inferred wire/session semantics. |
| Not authorized / not executed | Rust/default+Rama checks, APP builds, hosted tag-event trials, service health/deployment and actual gameplay capture/offline verification. Require separately permitted execution and the actual SHA/artifact/readback results, not source/static assertions. |

#### Local validation for this change

The final run used:

```sh
env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE \
  node --test --test-reporter=spec \
  scripts/release-eligibility.test.mjs \
  scripts/release-workflow.test.mjs \
  scripts/production-target-contract.test.mjs \
  scripts/rama-migration-boundary.test.mjs \
  packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-trust-graph-test.mjs
```

Result: **64 PASS, 0 FAIL, 0 skipped**: graph 46, target policy 3,
mock release eligibility 10, workflow-source assertions 3, Rama-source
assertions 2. Inputs are synthetic; APIs are mocked; no keys are generated.
An intermediate 62-test run had three test-harness failures (undefined
fixture property versus serialized absence in both Result modes, and an
incorrect source slice ending at the first conditional test annotation);
these were corrected without weakening the expected identity rejection or
provider boundary, and both subsequent 62- and 64-test runs passed.
Installed PyYAML parsed the three changed workflows successfully;
this is YAML syntax validation, not GitHub Actions schema/actionlint or
hosted execution. No actionlint was available.

APP readiness/handoff and crypto fixture tests were not rerun because their
fixture paths generate ephemeral keys. No Cargo/Rust/WASM execution, APP
build, network/service request, deployment, gameplay or cryptographic proof
verification was performed. The normal scoped commit hook must still pass;
its static analysis is not a substitute for any of these runtime checks.
Protected source/config files are not test inputs. Only the explicit changed
paths are candidates for staging; global index metadata is not blob content.

### Release record and unsigned generation follow-up (2026-10-25)

Basis: `516948ecf1a322645f3956c2e8ee80a489a5bfc9`.
This supersedes the previous report's schema-v1 status semantics; historical
test counts above remain historical.

[`release-eligibility.mjs`](../../scripts/release-eligibility.mjs) now emits
schema v2. Tag validity is independent of artifact/deployment readiness:

| Axis/state | Meaning here |
| --- | --- |
| `TAG_INVALID` | Coordinator could not authenticate the run/tag/history/validation route. Error is recorded; no generation. |
| `DEVELOPMENT_VALIDATED` | Nonprivileged tag checks accepted, without querying main ancestry. No Production authorization. |
| `PRODUCTION_ELIGIBLE` | Exact tag/run/source and trusted validation workflow/main history accepted. Preserved even when later build/config inputs are blocked. |
| `BLOCKED_EXTERNAL_INPUTS` | Separate release/build readiness field. Missing public input pins/registrations or complete release linkage do not erase tag eligibility. |
| `RELEASE_ARTIFACTS_VALIDATED` | The manifest validator matched independently supplied references, raw artifacts/build records/evidence and observed CI metadata. This is byte/provenance linkage, not a claim of TLSN or release signatures. Only synthetic cases reached this in this task. |
| `DEPLOYMENT_VERIFIED` | Reserved for authenticated live deployment verification; no emitter/positive path is implemented here. Manifest self-assertion of this state is rejected. |

The coordinator checks out its immutable event SHA and requires the event ref
to be main. A missing/mismatching run ID or attempt is rejected, not inferred.
A valid eligibility job may finish successfully with a blocked release
record: green read-only CI is explicitly not successful Production release.
Tag failures and actual generation failures still fail the job.

#### Manifest v1: exact bytes and independent inputs

[`release-manifest.mjs`](../../scripts/release-manifest.mjs) defines
`fusou-release-manifest-v1`. It binds stable Production tag/version/source,
validation path/blob SHA/run/attempt, eligibility coordinator/run/attempt,
APP platform artifacts, Worker artifact/version, Runtime Config v2
epoch/envelope/root digest, Result signer/registry, Notary registry,
Session Authority ID, security registry set, Inventory/Target Approval,
check-evidence hashes and an explicitly unverified deployment state.

Serialization is the existing recursive sorted-key `canonicalJson`: UTF-8,
no BOM, indentation or trailing newline. Object construction order does not
change emitted bytes. Arrays retain order. Git commit/blob identifiers are
40-character hex; artifact/evidence hashes are SHA-256 of **actual raw bytes**
encoded base64url without padding. Epoch is a positive u64 decimal string;
run IDs/attempts/lengths are positive safe integers. Canonical parse comparison
rejects alternate key order/whitespace, duplicate/escaped duplicate keys and
unknown fields (including added credential fields). Record input is capped
at 1 MiB. This release-record contract does not change existing Result or
receipt wire/canonicalization rules.

The structural validator requires separate expected references and actual
artifact, build-record, check/registry/config readback bytes. It also requires
independently observed same-repository successful main-owned build run
metadata, including exact run attempt and workflow SHA. Expected references
must come from trusted main policy/control-plane records, never by copying
the downloaded manifest. Synthetic tests clone fixtures solely to test
mutations; that is not evidence of operational input independence.
Each check is a canonical `fusou-release-check-v1` record with check name,
`PASS` result, exact source/run/attempt/workflow, and a separately read-back
evidence digest. A failed check is rejected even when all its hashes and
expected record references match. This authenticates CI-linked records;
it does not reinterpret a record's `PASS` as independently executed TLSN
cryptography in this local task.

The Production adapter calls the **existing**
`verifyTlsnRuntimeConfigProductionEnvelope`: signature, independently pinned
inputs, expiry/epoch and registry checks are not replaced by JSON IDs.
It then binds the verified payload to release Worker/source/version/epoch,
signer/registry/security set and target digests, relates the Notary registry
to that signed set, queries build runs, and rechecks the current tag before
and after validation. Positive cryptographic execution of that adapter is
**NOT_CHECKED**; only its no-verification-input failure and pure linkage
mutations were run here. No module signs a release or permits publication.
`publication_authorized` remains false even after artifact linkage passes.

#### Implemented generation route, not an executed build

The existing read-only coordinator now calls
[`release-build.mjs`](../../scripts/release-build.mjs). It adds no external
Action dependency or new Action invocation: the existing checkout/setup-node/
github-script/upload-artifact steps are reused. Their existing mutable Action
references are not promoted to officially verified immutable pins; official
source/pin verification was not available without an external request.

Before any checkout/build, require the independently configured public
`FUSOU_RELEASE_PUBLIC_INPUTS_SHA256` pin and matching canonical
`scripts/release-public-build-inputs.json` on trusted main. That document is
**not supplied/created here** and contains only schema version, selected APP
source SHA, approved Worker reference, public APP inputs, registered Runtime
Config bootstrap inputs, exact Rust toolchain and platform. Existing Worker
reference/public-input/bootstrap validators apply. Missing inputs produce a
blocked record, not generated keys, dummy configuration or inferred services.
This is a bootstrap publication interface, not an intended per-tag manual
editing procedure: a future trusted initialized Worker/config publisher must
derive and pin changed release-specific references automatically.

The implemented Linux x86_64 driver rechecks eligibility, fetches/checks out
the exact accepted commit into a separate temporary repository, provisions
the existing Linux build prerequisites/selected Rust toolchain, enables
Corepack and installs frozen dependencies without install scripts. It uses
the existing `buildApprovedApp` no-bundle/locked/compiled-report comparison
path. The independently pinned public input provider replaces encrypted
dotenv loading: no DOTENV/updater signing secret is supplied, and public
input mutation is checked. Read-only source credentials are never persisted
or inherited by build commands; subprocess failure details are sanitized.

Before copying output, the driver checks exact binary hash/length, APP and
Worker source, active Worker version and compiled configuration comparisons,
then rechecks the live tag. Only binary bytes, the existing detailed APP
build record, a canonical run/source/platform provenance wrapper and the
release report are uploaded. Temporary source/target files are cleaned up.
`BUILD_OUTPUTS_GENERATED` is not `RELEASE_ARTIFACTS_VALIDATED`: Worker bundle,
complete linked manifest and independent consumer checks are still required.
No installer, updater signature, GitHub release or deployment is produced.
Only Linux x86_64 generation is implemented; no other platform is silently
omitted from a caller's required artifact inventory.

The old manual publish workflow remains stopped. New read-only code has no
sign/publish/deploy operation. The external main-only Environment policy,
credential relocation and branch governance remain **NOT_CHECKED**, and
must prevent modified tag workflows from accessing repository/org credentials
regardless of conditions in this checkout.

#### Decisions and remaining implementation

The [authenticity contract](../architecture/tlsn-data-authenticity-contract.md)
now adopts conservative **local delivery policy v1** with executable tests:
exact existing correlation tuple, no automatic retry, terminal uncertainty,
response distinct from pending proof, fresh authorization at readback, and
accepted-input memory limits only. It is not wired into APP/Worker and
does not mint authoritative attempts, alter signing bytes or resolve issuer
restart/recovery semantics. P0-01 exact dependency/license/security evidence,
P0-10 8/11-field precedence, receipt/wire format and independent vectors,
and WASM provenance remain unverified/unresolved where no safe source-derived
norm exists. These are one-time versioned compatibility work, not recurring
human approval prompts. No protected WASM source was inspected.

Next code acceptance: generate/hash a Worker bundle and its source/run record;
automatically publish initialized public Worker/config references; feed
downloaded artifacts into a clean trusted consumer without execution; connect
the real independent verifier/authorization clock to the delivery adapter;
implement authenticated post-deploy observation before any
`DEPLOYMENT_VERIFIED` transition. Keep the legacy stop until updater/package
parity, required platform inventory, release-signature registration,
fresh eligibility and one-publication/idempotency checks are implemented.

#### Executed follow-up validation

```sh
env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE \
  node --test --test-reporter=spec \
  scripts/release-eligibility.test.mjs \
  scripts/release-workflow.test.mjs \
  scripts/release-manifest.test.mjs \
  scripts/release-build.test.mjs \
  scripts/evidence-delivery-policy.test.mjs \
  scripts/production-target-contract.test.mjs \
  scripts/rama-migration-boundary.test.mjs \
  packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-trust-graph-test.mjs
```

Final result: **87 PASS, 0 FAIL, 0 skipped**. Counts: tag eligibility 10,
workflow source 4, manifest 10, injected synthetic build 4, delivery policy 5,
target policy 3, Rama/source+handshake audit 5, existing graph 46.
The first focused run exposed a misplaced nested export in the new manifest
module (two test files could not load); it was corrected and the related
suites rerun. No assertion or test was disabled.

Installed PyYAML parsed both changed workflows and the unchanged stopped
publish workflow. The coordinator's embedded JavaScript was syntax-compiled
with `AsyncFunction` **without executing it**. These checks are not actionlint,
GitHub event/permission validation or a hosted run. Explicit-path worktree
diff checks passed; staged-path checks and the normal scoped commit hook
are still required before committing.

The build tests inject nonexecuting synthetic bytes/records and temporary
output directories; the default native build driver was never called.
No actual APP/Worker release artifact, Production release manifest,
release signature, deployment or live readback was generated/verified.
No Cargo/Rust/WASM, game/service connection, signing-key generation, push
or tag operation was performed. Real-game TLSN remains `UNVERIFIED` and
Production acceptance remains `BLOCKED`.

### Independent release consumer and actual build-origin binding

Baseline: `tlsn-first-testplay-candidate`,
`6f6f33bda699de81eccd356c8f6d5e5bf38ed886`. This follow-up implements a
separate read-only workflow and data-only artifact consumer, not an executed
release or a Production acceptance result.

#### Generated outputs versus successful workflow runs

The producer now uploads one `release-transport.json` in an artifact named
`fusou-release-<coordinator-run-id>-<attempt>`. A blocked coordinator can still
finish successfully; its downloaded `BLOCKED_EXTERNAL_INPUTS` report remains
blocked and cannot become build proof. `BUILD_OUTPUTS_GENERATED` must include
actual output descriptors, raw binary bytes, detailed input records and
provenance. The build driver wraps the existing detailed APP record with
source/platform/run/attempt/workflow SHA, byte length, artifact digest and
Worker version before hashing it into provenance.

The independent consumer re-fetches the producer run, verifies its repository,
path, main ancestry, workflow blob, source workflow SHA and exact attempt,
then obtains exactly one named artifact from that run. API metadata is
checked again after download. Archive SHA-256 is recalculated before parsing
and after readback. Actual APP/Worker file hashes and lengths, detailed records,
provenance and report source/tag/run/attempt/version must all agree. The
manifest validator additionally requires opaque build proofs produced by this
byte/record validation; green run metadata alone no longer suffices.

Trust premise: protected main owns the build recipe, report producer and
consumer code; GitHub/API/runner and the selected compiler/dependency inputs
are trusted execution infrastructure. These are not signed SLSA attestations,
reproducibility proofs, or proof that a compromised builder actually compiled
rather than forged its records. Copying an artifact or its original records
from another run/attempt is rejected; an attacker controlling trusted main or
the runner is not ruled out by JSON and hashes.

#### Data-only artifact transport and API assumptions

The versioned transport contains canonical JSON with at most 64 basename-only
logical entries and canonical base64url raw bytes. No artifact code is loaded,
executed or placed in the consumer checkout. ZIP listing must consist of the
single literal `release-transport.json` member; installed `unzip -p` reads only
that member to stdout, never extracts paths or follows archived symlinks.
Temporary opaque ZIP files are removed in `finally`. Downloaded ZIP and expanded
transport admission limits are each 512 MiB, with subprocess output/time limits;
these are not total RSS or concurrent-memory guarantees.

The authenticated API request follows the documented 302 using a separate
HTTPS storage request without the GitHub token and without further redirects.
The API-selected short-lived storage URL is a trusted GitHub service response,
not an artifact-supplied URL. No storage URL or credential is recorded.

Official [artifact REST documentation](https://docs.github.com/en/rest/actions/artifacts?apiVersion=2022-11-28)
and the official upload Action output contract were inspected. `digest` and
`workflow_run` are nullable; artifact metadata has **no run_attempt field**.
Attempt binding uses the unique name plus downloaded report/records and the
independently fetched run attempt. Missing API digest is
`ARTIFACT_API_DIGEST_UNAVAILABLE`, not an invented digest. The ZIP's
`sha256:<hex>` digest, raw members' base64url SHA-256, and Git commit/blob SHA-1
identifiers are separate values.

New consumer and updated producer Actions use immutable commits confirmed
from official `actions/*` tag-ref API responses in this task:
checkout `11d5960a326750d5838078e36cf38b85af677262`;
setup-node `49933ea5288caeca8642d1e84afbd3f7d6820020`;
github-script `f28e40c7f34bde8b3046d885e986cb6290c5673b`;
upload-artifact `ea165f8d65b6e75b540449e92b4886f43607fa02`.
This verifies public source references, not hosted event payloads or repository
permission settings.

#### Complete assembly, independent expectations and remaining blockers

`scripts/release-consumer.mjs` exports a complete manifest assembler and a
separate consumer orchestration entry. Expectations are derived from fresh tag
validation APIs, producer API metadata, read-back output bytes and independent
public inputs. An optional producer manifest must equal this independently
assembled canonical record byte-for-byte; it never supplies `expected`.
Assembly alone returns `MANIFEST_ASSEMBLED`. Only the subsequent consumer
validation returns `RELEASE_ARTIFACTS_VALIDATED`, always with
`publication_authorized: false`, `deployment_status: NOT_CHECKED`, and
Production acceptance `BLOCKED`.

Independent inputs must come from the trusted-main file
`scripts/release-consumer-public-inputs.json`, pinned by the separately
configured `FUSOU_RELEASE_CONSUMER_INPUTS_SHA256` repository variable.
No file or pin is fabricated here. Canonical schema version 1, scope
`fusou-release-consumer-inputs-v1`, requires exactly:
`required_app_platforms`, `runtime_envelope`, and `verification`, in addition
to schema/scope. The envelope and five existing `independentInputs.*_raw`
fields use canonical base64url; `verification` otherwise supplies the existing
Runtime Config trusted signer, policy and independent pin contract.
Verification uses the consumer's current clock, not an artifact timestamp.
The real existing signature/freshness/independent-input verifier is the default;
no test key or unsigned envelope is accepted as a Production substitute.

Worker bundle, APP platform inventory, Runtime Config signer/root/epoch,
Result/Notary/security registries, Inventory/Approval and four check records
are joined to the same release. Check evidence must have actual read-back bytes
and exact source/run/attempt/workflow context. A PASS record plus a hash is not
an offline-verifier or archive execution receipt: the independent check
execution adapter is **NOT_IMPLEMENTED** and the default route explicitly
blocks with `INDEPENDENT_RELEASE_CHECK_EXECUTION_NOT_IMPLEMENTED`.
Missing implementation is classified as `BLOCKED_IMPLEMENTATION`, separately
from `BLOCKED_EXTERNAL_INPUTS`; supplying public pins cannot repair missing code.
The older Production verification entry also now requires a trusted check
executor. Only synthetic tests inject mock crypto/check executors.

Worker source metadata inspection found `src/origin-trust-contract.mjs` but no
tracked runtime entry, package manifest, Wrangler configuration or Worker
lockfile in the verification Worker project. The coordinator records
`TRACKED_WORKER_RUNTIME_AND_BUILD_RECIPE_NOT_AVAILABLE`; no placeholder bundle
or Worker builder was created. Missing real bundle/record and independent
public inputs are separately reported while retaining verified partial output
and tag results. The real route is therefore **BLOCKED**, not release-ready.

Both workflows have only contents/actions read permissions, immutable
trusted-main event checkouts, no Production environment/secrets/OIDC/write
permissions, and no signing/publication/deployment calls. Development reports
remain `NOT_APPLICABLE` to release consumption, without imposing main ancestry
on their tag commits. The legacy publication stop remains unchanged.
Environment policies, repository/org secret isolation, branch/tag rules and
actual workflow_run payloads remain **NOT_CHECKED**. Workflow text cannot keep
an arbitrary branch workflow away from Production secrets stored with overly
broad repository/org access; external credential isolation is still required.

#### Executed local verification and acceptance work

The exact safe suite executed from the repository root was:

```sh
env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --test \
  scripts/release-eligibility.test.mjs scripts/release-manifest.test.mjs \
  scripts/release-build.test.mjs scripts/release-consumer.test.mjs \
  scripts/release-transport.test.mjs scripts/evidence-delivery-policy.test.mjs \
  scripts/release-workflow.test.mjs scripts/production-target-contract.test.mjs \
  scripts/rama-migration-boundary.test.mjs \
  packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-trust-graph-test.mjs
```

Result: **110 PASS, 0 FAIL, 0 skipped**. Counts: eligibility 10, manifest 11,
injected build 4, consumer 14, transport/real synthetic ZIP 7, delivery 5,
workflow 5, targets 3, Rama 5, graph 46. The initial focused run had 12 PASS /
24 FAIL because basename validation rejected uppercase characters in
base64url-derived evidence names. The filename grammar was corrected, retaining
strict basename/canonical encoding requirements, and all tests rerun.
The VS Code test tool did not discover these Node tests; explicit Node commands
were used. Node YAML packages were absent; installed PyYAML parsed four
workflows and Node compiled five embedded scripts without executing them.
These checks are not actionlint or a GitHub-hosted execution.

No actual APP/Worker build, release artifact, positive Runtime Config signature
integration, Cargo/Rust/WASM, service connection, key generation, signing,
publication or deployment was executed. Hudsucker remains the default;
the five Rama source/handshake tests are static/synthetic, not Rust/runtime
equivalence. Q1-Q5/local delivery policy and unresolved P0-01/P0-10 protocol
compatibility are unchanged; no recurring human release approval was added.

Next acceptance, in order:

1. Restore the actual tracked Worker runtime, handlers, package/config/lock and
   approved unsigned build recipe. Generate bundle bytes plus source/toolchain/
   lock/run/attempt/provenance records; never replace missing runtime with fixtures.
2. Supply registered public Runtime Config/registry/target/bootstrap bytes and
   independent policy pins. Positive real signature verification must pass;
   wrong epoch/version/root/digest and missing inputs must fail.
3. Implement trusted archive-readback/offline/dependency/compiled-input check
   execution against actual source and evidence, then emit and independently
   verify run-bound receipts. Do not lift the missing-executor gate using PASS
   strings or self-attested hashes.
4. With execution permission, perform actual unsigned APP/Worker generation and
   a hosted consumer run, confirming real artifact API/payload/attempt/digest
   behavior. Only actual complete data may promote release artifact status.
5. Separately verify one-time credential/environment policies and implement
   signed publication/idempotency and authenticated post-deploy observation.
   None is authorized by this read-only consumer result.

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

## Worker location and independent execution adapters

Baseline for this follow-up: `tlsn-first-testplay-candidate`,
`635c55b2a62fb511f5758e9777ec73deeac26adb`.
Earlier statements that the inspected release revision lacks a Worker runtime
remain accurate **for that revision**, not for all repository history.

### Located implementation, not an inferred replacement

Local tracked-tree and history inspection found the real verification Worker
on the ordinary branch `tlsn-phase0-investigation`, at
`bd85ec7aa8eb7e7c598038fceb6e0dc8b5c1c8ff`.
That revision contains the Worker package manifest, Wrangler configurations,
`src/index.ts` Hono fetch handler, `TlsnBindingAuthorityDurableObject`,
verification job/queue and direct-verifier boundaries, signing/receipt helpers,
WASM build recipe, and `result_archive.ts` R2 write/readback implementation.
Its routes include `/health`, `/attestation/session`, `/verify/tlsn`,
`/verify/tlsn/sparse`, status/retry, and internal direct-verifier control/input/
completion handlers. The independent native verifier entrypoint is already
tracked on the release branch:
[`verify_fusou_tlsn_evidence.rs`](../../packages/FUSOU-TLSN-VERIFIER/src/bin/verify_fusou_tlsn_evidence.rs).
The separate battle-data/queue Worker and browser local worker are not substitutes.

The historical Worker uses the workspace pnpm lock, `build:wasm`, and the
production Wrangler recipe. The WASM build invokes native tooling and verifier
sources; it was inspected, **not executed**. No historical runtime was restored,
cherry-picked, or silently made compatible with the current release contracts.
The release SHA still lacks that implementation, so actual bundle generation
remains `BLOCKED_IMPLEMENTATION`.

[`release-worker-source.mjs`](../../scripts/release-worker-source.mjs) now checks
an explicit safe source allowlist at the exact target SHA, verifies returned Git
blob hashes, distinguishes missing files (404) from other API failures, and
records each input's raw-byte SHA-256 and length. The inventory is a minimum
recipe inventory, **not** a complete import closure or runtime semantic proof:
`SOURCE_INPUTS_PRESENT` retains `runtime_semantics: NOT_CHECKED` and
`bundle_status: NOT_CHECKED`.

The unsigned builder requires explicit execution authorization and a trusted
isolated recipe executor; none is registered by default. Its output adapter
checks source/context/toolchain/command snapshots, JS and WASM output bytes,
record/provenance, and the independently supplied Worker reference. The Worker
package is a canonical JSON container of original module bytes, not a deployed
version. `active_version_id` is a supplied reference, never generated from a
fixture or guessed from a Git SHA. There is no default executor or verified
actual bundle in this follow-up.

### Check propositions and evidence

[`release-checks.mjs`](../../scripts/release-checks.mjs) provides the concrete
capture/verification contracts below. Every execution receipt has scope
`fusou-release-check-execution-v1`, schema version 1, check name, repository,
source SHA, actual producer run/attempt/workflow SHA, raw input descriptors,
canonical input digest, result/exit code/error, and check-specific observations.
The existing `fusou-release-check-v1` record hashes those exact canonical bytes.
Input bytes remain raw; only explicitly defined JSON records/projections are
canonicalized. Git commit/blob SHA-1 and raw-byte SHA-256 are different fields.

| Check / proposition | Required data and execution | Consumer verification / remaining boundary |
| --- | --- | --- |
| `locked_dependencies`: the observed APP build used frozen/locked dependency inputs | Raw root package manifest, workspace pnpm lock, APP Cargo lock; successful exact frozen pnpm and locked Tauri commands; observed pnpm version; detailed APP record | Exact-SHA API bytes, complete command observations, package-manager version, Cargo lock digest, opaque API-origin build proof and run/attempt must agree. Existence of a lockfile alone does not pass. |
| `compiled_inputs`: APP and Worker outputs correspond to the independently registered public inputs | APP executable hash before/after report invocation, original stdout and exact report argv, APP/Worker records; Runtime Config reference/bootstrap, projection, public input and Worker toolchain pins | Reuses the existing APP report validators; checks raw record/output hashes, source recipe snapshot, Worker package modules, script/version reference, independent bootstrap signer and public projection. APP-only generation saves observations but does not invent a complete compiled-input PASS. |
| `archive_readback`: original and actually retrieved Presentation/Result bytes are identical | Trusted backend `get` callback, normalized observed backend/object/version/session/capture/job/attempt identity; original and readback bytes and timestamps | Checks bytes, lengths, hashes, role separation, attempt-derived archive paths and independent freshness/context. A typed capture capability, not JSON metadata or a PASS string, is required to authenticate the read. No real backend is connected. |
| `offline_verification`: the independently pinned native verifier actually accepted these same archived inputs | Explicit trusted executor, pinned executable, exact formal CLI arguments, all seven CLI file inputs, all 19 mandatory bundle artifacts, original stdout and exit code | Checks every raw digest/path, CLI/bundle registry equality, all native trust results, observed DNS identity, Runtime Config signer/Notary/authority pins, signed bundle source/capture/session, and identical archived Presentation/Result. Requires a typed execution capability; a JSON success report, serialized capability, foreign attempt or declared binary hash alone cannot authenticate execution. |

The archive attempt path is grounded in the historical
`verificationAttemptArchiveKeys` contract. The historical final Result envelope
does **not** contain job/attempt fields: those are storage/authority context,
not invented signed Result fields. Authenticating their live authority mapping
remains a backend integration requirement. Native signature verification and
the signed bundle's session/capture/source correlation are separate checks.

### Consumer wiring and fail-closed status

The independent read-only consumer now uses the concrete check adapters by
default. It verifies all raw evidence sidecars, including their filename hash,
before assembly. Missing external inputs preserve independently executable
check results; malformed evidence fails rather than being ignored.

Trusted-main public input files remain separately pinned:

- `scripts/release-consumer-public-inputs.json` with
  `FUSOU_RELEASE_CONSUMER_INPUTS_SHA256`;
- `scripts/release-public-build-inputs.json` with
  `FUSOU_RELEASE_PUBLIC_INPUTS_SHA256`;
- `scripts/release-check-public-inputs.json` with
  `FUSOU_RELEASE_CHECK_INPUTS_SHA256`.

No files or pin values were fabricated. The check policy has scope
`fusou-release-check-inputs-v1`, schema version 1, repository and exact source
SHA, Worker toolchain pins, authenticated archive context/freshness, and native
executable/input/argument/derived-identity pins. Candidate manifests never
provide these expected values.

Execution capabilities are intentionally process-local and cannot be
serialized into the producer artifact. A trusted adapter can use
`captureArchiveReadback` / `captureOfflineExecution` with an actual authenticated
backend / provisioned pinned executable; mock callbacks in tests only model
that boundary. The hosted consumer currently has **neither** adapter.
Consequently data-only transport does not bootstrap execution authority:

- archive intake absent:
  `AUTHENTICATED_ARCHIVE_READBACK_INTAKE_NOT_CONFIGURED`;
- native intake absent:
  `AUTHENTICATED_OFFLINE_EXECUTION_INTAKE_NOT_CONFIGURED`;
- missing independently registered public inputs:
  `BLOCKED_EXTERNAL_INPUTS`;
- missing target-SHA Worker implementation, executor, or authenticated intake:
  `BLOCKED_IMPLEMENTATION`.

This is not a remote execution-attestation wire protocol or a completed
cross-run authenticated intake. Such a protocol was not guessed from JSON
fields. Trusted main/runner code and registered backend/executor adapters are
trust roots; the records do not mathematically prove execution against a
compromised trusted runner. A fresh local epoch also does not prevent rollback
by an attacker controlling OS state or external storage.

All mock-only end-to-end success tests explicitly supply mock Runtime Config,
archive, and native-execution boundaries. Real release artifacts remain
`NOT_CHECKED`; signing/live deployment remain `NOT_CHECKED`, and Production
acceptance remains `BLOCKED`. `publication_authorized` remains `false`;
deployment remains `NOT_CHECKED`. No new Actions, permissions, Production
Environment, secrets, OIDC, signing/publication/deploy path, or legacy publishing
bypass was added. Hosted events, repository/organization secrets isolation,
Environment policies and branch protection remain `NOT_CHECKED`.

### Next implementation acceptance gates

1. Reconcile the located Worker runtime and its full dependency/import closure
   with the exact release SHA. Review Result/receipt/authority/Notary contracts
   before integrating it; then separately authorize actual locked JS/WASM
   bundle generation. Require real module bytes and source/toolchain/run-bound
   records, not the presence of filenames.
2. Register an authenticated archive adapter and its authority attempt mapping,
   then exercise real readback/mutation/truncation/cleanup failures. Register
   the independent native executable and permitted executor or an authenticated
   cross-run intake whose provenance can actually be validated. Producer JSON
   may never mint either execution capability.
3. Supply real independently authenticated Runtime Config, registry, trust
   root, Inventory and Approval bytes. Add machine-generated per-release policy
   acquisition from those authorities instead of requiring recurring manual
   design decisions or copying candidate manifest declarations.
4. Under separate authorization, run actual APP/Worker builds and native
   verification, then the hosted consumer against their real artifact
   metadata. Require all four authenticated checks before reporting
   `RELEASE_ARTIFACTS_VALIDATED`; do not infer deployment from it.
5. Only a separate authenticated live observation may establish deployment.
   Preserve the stopped legacy publication route and absence of publication
   authority throughout this phase.

No Cargo/Rust/WASM/native verifier, APP/Worker build, external service, actual
archive, gameplay, Production signing/deployment, or key generation was
executed. Q1-Q5 and existing protocol bytes were not redefined. The key-free
Rama boundary tests remain static contracts: Hudsucker stays the default,
Rama stays opt-in, and Rust runtime parity remains `NOT_CHECKED`.

Validation performed for this follow-up, from the repository root:

```sh
env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --test \
  scripts/release-eligibility.test.mjs \
  scripts/release-manifest.test.mjs \
  scripts/release-build.test.mjs \
  scripts/release-consumer.test.mjs \
  scripts/release-transport.test.mjs \
  scripts/release-worker-source.test.mjs \
  scripts/release-checks.test.mjs \
  scripts/evidence-delivery-policy.test.mjs \
  scripts/release-workflow.test.mjs \
  scripts/production-target-contract.test.mjs \
  scripts/rama-migration-boundary.test.mjs \
  packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-trust-graph-test.mjs
```

Final result: **161 PASS, 0 FAIL, 0 cancelled, 0 skipped**.
The focused first run of the two new test files had 34 PASS / 4 FAIL because
the new archive mutation test addressed an observation array as a map; it was
fixed. The first expanded regression had 150 PASS / 6 FAIL (a wrongly nested
new fixture helper and an error-message contract mismatch); both were fixed,
followed by 156 PASS. A later added test was accidentally registered inside
another test (159 PASS / 1 FAIL / 1 cancelled); it was moved to the top level
and the full command above was rerun to the final result. No assertions were
removed or weakened, and no tests were skipped.

The VS Code runner did not discover these Node test files; the explicit Node
runner above supplied the actual result. Separately, existing PyYAML parsed the
four named release/tag/legacy workflows; Node's async-function constructor
compiled all five embedded JavaScript bodies without invoking them. Static
permission checks and `node --check` of the new implementation/fixture/environment
modules passed. No dependency installation was needed. Scoped `git diff --check`
also passed. All successful execution/process/storage/authentication cases in
these tests are explicitly injected doubles, not live build or crypto evidence.

## Selective Worker runtime integration and release wiring

**Integration baseline:** `tlsn-first-testplay-candidate`,
`209a675c56ef30ac27e85b926add875b5560e902`.
**Historical source:** `tlsn-phase0-investigation`,
`bd85ec7aa8eb7e7c598038fceb6e0dc8b5c1c8ff`.
No branch merge or commit cherry-pick was performed.

### Selected source and current-contract changes

The following missing files were selectively restored from that exact commit,
not replaced with fixture implementations:

- `src/index.ts`, `binding_authority.ts`, `verification_jobs.ts`,
  `attestation_receipts.ts`, `private_key_validation_cache.ts`,
  `verifier_identity.ts`, `execution_boundary.ts`, `result_archive.ts`,
  `direct_verifier.ts`, `origin-trust-contract.d.mts`, `text-module.d.ts`;
- `tsconfig.json`;
- `scripts/build-wasm.mjs`, `verify-wasm-provenance.mjs`,
  `wasm-provenance.mjs`.

All paths above are relative to
[`FUSOU-TLSN-VERIFICATION-WORKER`](../../packages/FUSOU-TLSN-VERIFICATION-WORKER/).
The shared Origin contract and public Inventory/Approval bytes were already
identical to the historical source and were not overwritten. The historical
package's provisioning, key/fixture generation, benchmarks, remote tests and
deployment scripts were not imported. The new minimal package exposes only
WASM build, provenance verification and a no-build TypeScript check. The root
lock adds its importer without changing existing resolved dependency versions.
Wrangler resource names are historical references, not observed deployments.

Current adaptations:

- [`production-result-contract.mjs`](../../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/production-result-contract.mjs)
  requires independently configured
  `TLSN_PRODUCTION_ORIGIN_INVENTORY_SHA256` and
  `TLSN_PRODUCTION_TARGET_APPROVAL_ARTIFACT_SHA256`, then checks shipped raw
  bytes and the existing Inventory/Approval contract. An old `APPROVED` marker
  and date cannot establish current authority without those independent pins.
  No new Production pin was registered.
- Both sync and completion paths pass through the same Complete v2/Sparse v3
  profile, canonical Production DNS, raw Presentation digest and mandatory
  target-digest-pair checks. Existing V2 signing domains, native-derived signing
  byte comparisons and the separate Result envelope remain in place.
- Production archive writes carry source, session, job, attempt and hashed
  binding metadata. Readback verifies actual length/hash, metadata and the
  same R2 generation before the authority commit. Cleanup failures are explicit;
  a changed/unconfirmed generation requires reconciliation rather than blind
  deletion. Generation equality is not immutable retention.
- APP endpoint mappings were compared statically with the actual restored
  routes. This is not a live handler, Session Authority or Notary test.
  P0-01/P0-10 and unresolved wire semantics were not redefined.

### Unsigned build and independent consumption

[`release-worker-build.mjs`](../../scripts/release-worker-build.mjs) is now the
trusted driver used by [`release-build.mjs`](../../scripts/release-build.mjs).
It is disabled unless explicitly authorized. The coordinator passes that
authorization only when the public repository variable
`FUSOU_RELEASE_WORKER_BUILD_ENABLED` equals `true`; this task did not read or
change that external setting or run the workflow.

The future authorized recipe uses the exact APP checkout SHA, frozen pnpm
installation with lifecycle scripts disabled, offline/locked WASM compilation,
provenance verification, TypeScript checking, and Wrangler **dry-run only**.
The driver checks HEAD and actual source bytes before/after execution. Native
source fingerprints are collected separately from generated provenance, not
copied from that provenance as expected values. WASM authorization and explicit
release SHA/toolchain checks precede native collectors and tools.

The canonical Worker package contains actual JS/WASM modules and raw
`wasm-provenance.json`; the four generated WASM files are transported as
hash-addressed raw evidence. Records bind source SHA, run/attempt, trusted
workflow SHA, import closure, dependency manifests/lock, compiler/toolchain,
flags and raw output hashes/lengths. Worker package parsing uses the existing
transport admission limit, not the smaller 1 MiB metadata-record limit.

`worker.bin` is this data-only package, not a claimed Cloudflare deployment.
The expected Cloudflare script/version reference remains independent input;
neither a bundle SHA-256 nor a Git SHA is used to manufacture a version ID.
Deployment stays `NOT_CHECKED`.

The producer now transports both APP/Worker records and emits a
`compiled_inputs` receipt only when both real output paths and APP process
observations are supplied. APP-only generation remains distinguishable from
a complete release. A missing authorization produces
`WORKER_BUILD_EXECUTION_NOT_AUTHORIZED`, not a fabricated build.

The default independent consumer compares exact-source imports and raw Worker
contents, recomputes WASM hashes, and requires independently pinned
`worker_wasm_toolchain` and `worker_wasm_source_inputs` in the trusted check
policy. Missing pins yield `BLOCKED_EXTERNAL_INPUTS`; candidate record values
are not substituted. The shipped target bytes must also match authenticated
Runtime Config authority pins. Existing Runtime Config signature, expiry,
epoch and independent bootstrap/root verification remain required; Worker
environment digest pins do not replace them.

### Check execution boundaries

| Check | Implemented local boundary | Real execution status |
|---|---|---|
| `locked_dependencies` | Exact-source lock bytes, frozen/locked command receipts, run/attempt and toolchain comparison | Release build `NOT_CHECKED`; only offline dependency restoration for local type checking was performed |
| `compiled_inputs` | APP observations, APP/Worker records, raw WASM sidecars, independent source/toolchain/Runtime Config/target pins | Contract tests `VERIFIED`; actual APP/Worker compilation `NOT_CHECKED` |
| `archive_readback` | Runtime generation/metadata/byte checks and callback-based actual R2 `.get()` adapter with independent capture resolver | Mock backend only; authenticated hosted intake `BLOCKED_IMPLEMENTATION`, real archive `NOT_CHECKED` |
| `offline_verification` | Formal native CLI input/output and exact archive/session/binding correlation; opaque authenticated execution capability remains mandatory | Mock executor only; authenticated hosted intake `BLOCKED_IMPLEMENTATION`, real TLSN crypto `NOT_CHECKED` |

Serialized PASS/VERIFIED strings do not mint backend/native capabilities.
The R2 adapter reads observed metadata rather than echoing candidate expected
values. A capture registry/resolver and an authenticated cross-workflow intake
still need an agreed implementation; none was invented here.

The independent consumer can assemble/validate complete mock releases using
its existing manifest path. No complete **real** release manifest or actual
`RELEASE_ARTIFACTS_VALIDATED` was produced. No manifest self-declaration can
set `DEPLOYMENT_VERIFIED`. `publication_authorized` remains `false`.

### Executed verification in this integration

The following explicit command, from the repository root, was last rerun on
the final implementation (Node `v22.21.1`):

```sh
env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --test \
  scripts/release-eligibility.test.mjs \
  scripts/release-manifest.test.mjs \
  scripts/release-build.test.mjs \
  scripts/release-consumer.test.mjs \
  scripts/release-transport.test.mjs \
  scripts/release-worker-source.test.mjs \
  scripts/release-worker-integration.test.mjs \
  scripts/release-checks.test.mjs \
  scripts/evidence-delivery-policy.test.mjs \
  scripts/release-workflow.test.mjs \
  scripts/production-target-contract.test.mjs \
  scripts/rama-migration-boundary.test.mjs \
  packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-trust-graph-test.mjs
```

Final result: **189 PASS, 0 FAIL, 0 cancelled, 0 skipped**. This is a newly
executed result, not the previous phase's 161 PASS. The first expanded run in
this phase had 184 PASS before the additional independent-pin/producer cases.
The initial three-file targeted run (build/source/checks) had 54 PASS / 1 FAIL:
the new post-Worker tag recheck changed its exact count from two to three.
A later four-file targeted run (adding integration tests) had 74 PASS /
7 FAIL / 12 cancelled: a new test used an absent observation field and two
tests were inadvertently nested inside a mutation loop. The fixture was
corrected to use actual report descriptors and the tests were moved to the
top level. No assertions were weakened and no test was skipped.

Those targeted commands were:

```sh
env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --test \
  scripts/release-worker-source.test.mjs scripts/release-checks.test.mjs \
  scripts/release-build.test.mjs
env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --test \
  scripts/release-build.test.mjs scripts/release-worker-source.test.mjs \
  scripts/release-worker-integration.test.mjs scripts/release-checks.test.mjs
```

After changing the package/lock manifests, local dependency restoration used:

```sh
env COREPACK_ENABLE_NETWORK=0 PNPM_DISABLE_SELF_UPDATE_CHECK=1 CI=1 \
  pnpm --filter fusou-tlsn-verification-worker install \
  --offline --ignore-scripts --frozen-lockfile
env -u NODE_OPTIONS -u NODE_PATH node node_modules/typescript/lib/tsc.js \
  --noEmit --project packages/FUSOU-TLSN-VERIFICATION-WORKER/tsconfig.json
```

Both passed. Type checking used already-present ignored generated type
declarations; it does **not** verify a fresh WASM ABI or compiled module.
No native source collector was invoked by the tests: authorized build tests
inject source snapshots, command results and artifact bytes explicitly.
No full package test/build script was executed.

Static validation also passed: existing PyYAML parsed the four named
release/tag/legacy workflows and pnpm lock; Python `tomllib` parsed the
Worker config; Node's async-function constructor compiled all five embedded
JavaScript bodies without running them. `node --check` passed for
`release-worker-build.mjs`, `release-worker-imports.mjs` and
`verify-wasm-provenance.mjs`; scoped whitespace validation passed.

### Remaining acceptance gates

1. **External public inputs:** supply authenticated current target approval,
   signed Runtime Config v2/bootstrap/root/registry pins, expected Worker
   reference, independent exact-source WASM input fingerprints and compiler
   pins. Do not use historical marker/digests or the manifest as authority.
2. **Separately authorize real builds:** provision the pinned Rust/WASM/Clang
   toolchain and offline dependencies; build APP and Worker at one committed
   release SHA; verify fresh generated ABI, dry-run output names, raw bundle,
   provenance, APP reports and independently consumed receipts. Missing
   tools/outputs/source agreement must fail closed, with no deploy fallback.
3. **Authenticated execution intake:** connect actual R2 capture/version/session
   mapping and the formal pinned native verifier to independent consumer
   execution proofs. Require exact raw Presentation/Result/receipt/registry
   inputs and successful native TLSN/Notary/signature/identity/digest checks.
   Structural Node checks and mock stdout are insufficient.
4. **Separately authorize real deployment/gameplay:** confirm Session Authority,
   dedicated verifier/Result signer/Notary services, hosted-event and credential
   isolation policies, live Worker version/config and real human-gameplay
   evidence. Only authenticated live observation may establish deployment.

No Cargo/Rust/WASM execution, APP/Worker build, external service connection,
real archive, native cryptographic verification, real game, key generation,
Production signing/publication/deployment, push, PR or tag creation was
performed. Hudsucker remains the dependency/default; no Rust runtime
equivalence to Rama was claimed. Production acceptance remains **BLOCKED**.

## Authenticated cross-run execution evidence intake

This follow-up started on `tlsn-first-testplay-candidate` at
`78fc0b87d01313019e9d0caa6c4a6bb37a5a01a3`, with the selected task paths
and their index entries clean. The owner explicitly selected reuse of the
existing trusted coordinator and GitHub authentication contract. This does
not approve a new signing key, arbitrary collector workflow, historical target
approval, or Production trust pin.

### Authentication root and the six distinct verification layers

The root remains authenticated GitHub API metadata for `tsukasa-u/FUSOU`:
the existing main-history coordinator workflow, exact producer run/attempt,
workflow revision, unique attempt-qualified artifact name, repository identity,
artifact ID/API archive SHA-256, downloaded archive bytes, and metadata readback.
Git blob identity is not a raw evidence SHA-256 or a Cloudflare version ID.
No OIDC permission, new signature wire format, signing credential, or external
attestation issuer was added.

1. **Existence:** the required record, receipt, and raw inputs must be present;
   a `PASS` string or `authenticated: true` is not an existence proof.
2. **Byte binding:** existing raw artifact/evidence hashes and lengths are
   checked, including executable bytes. Downloaded files are copied and bound
   to a private transport capability; changing any file invalidates it.
3. **Issuer authentication:** the producer's
   [`release-execution-origin.mjs`](../../scripts/release-execution-origin.mjs)
   only records checks backed by its private, process-local build/capture
   capability. The JSON origin file is **not itself a signature**. The consumer
   requires the API-authenticated artifact and independently compares all
   pinned capture implementation Git blobs against its trusted main revision.
   The fixed allowlist covers 35 JavaScript modules plus the coordinator
   workflow; a literal local JavaScript import-closure regression test guards
   against omitting a transitive helper. Artifact contents cannot extend it.
4. **Execution scope:** source SHA, producer workflow SHA, run/attempt,
   validation run/attempt, tag, exact report, independently pinned public build
   inputs, check record, receipt, and raw-input digest must match.
5. **TLSN target correlation:** the independently pinned check policy, not
   the candidate's origin record, supplies archive capture/session/job/attempt/
   binding/source/object key/immutable generation expectations. Readback bytes
   must equal saved bytes, and those bytes must be the verifier inputs together
   with the required receipt/registry bundle artifacts. The named
   `resolvePinnedArchiveObject` enforces this policy-to-observation lookup; it
   is not a live R2 client or a newly authenticated registry service.
6. **Independent verifier result:** authenticated native execution reports
   are separately labeled `AUTHENTICATED_NATIVE_EXECUTION_REPORT`. Consumer
   native cryptographic reexecution remains `NOT_CHECKED`; Node structural
   checks are not TLSN/Notary/signature verification. Local capabilities remain
   labeled `LOCAL_CAPTURE_ONLY`, not cross-run authentication.

[`release-execution-intake.mjs`](../../scripts/release-execution-intake.mjs)
mints a new, private consumer proof only after these checks. It does not
deserialize a producer capability. Producer reruns, changed artifacts, changed
target scope, missing origin, and unattested checks are rejected or blocked.
Final consumption rechecks producer attempt and artifact metadata as well as
the existing live tag check. Revalidating the same immutable artifact against
the same scope within the required freshness window is intentionally
idempotent; no global single-use ledger is implemented or claimed.

Runtime Config, registry, and deployment attestation signatures retain their
existing scopes; they are not repurposed as arbitrary execution signatures.
Issuer/workflow and public input expectations come from trusted code,
independent API observations, and separately pinned consumer inputs, not
the candidate manifest. Current hostname/Inventory/Target Approval,
Runtime Config signature/expiry/epoch/root, Worker reference, and WASM
source/compiler requirements remain in their existing production validators.
Historical `APPROVED` markers do not supply these expectations.

### Four check paths and their actual evidence status

| Check | Implemented path | Evidence observed in this follow-up |
|---|---|---|
| `locked_dependencies` | Actual builder execution produces a nonserializable build capability; packaging binds frozen/locked commands, lockfile bytes, source, toolchain, records and run context; consumer authenticates the captured record. Worker import/source closure is independently checked with the compiled-input evidence. | Mock process/API contract tests only; real frozen/locked execution `NOT_CHECKED`. |
| `compiled_inputs` | The same build capability binds APP/Worker artifact and build/provenance bytes, APP invocation/output observations, Worker modules, WASM sidecars/source/compiler pins, compile/bootstrap inputs, public pins and Runtime Config reference. | Mock builds only; APP/Worker build, launch and fresh WASM ABI `NOT_CHECKED`. |
| `archive_readback` | Existing capture checks actual callback-returned bytes/version/metadata; origin packaging accepts only its private capture capability; intake and the pinned capture resolver bind exact raw inputs and immutable object metadata. | Mock backend only. Real R2 backend/capture registration in the producer workflow is `BLOCKED_IMPLEMENTATION`; real readback `NOT_CHECKED`. |
| `offline_verification` | Exact executable bytes/digest, independently expected version, before/after executable measurements, CLI arguments/input bytes, exit/stdout/structured native report and archive/receipt/registry correlation are required before capture and cross-run intake. | Mock executor only. The approved formal native launcher/version observation adapter is `BLOCKED_IMPLEMENTATION`; real native cryptographic verification `NOT_CHECKED`. |

The existing coordinator now packages capture-gated origin data, and the
existing trusted-main consumer invokes the intake by default. The coordinator
has no registered real archive/native collector: missing capabilities are
explicitly `unattested_checks`, never fabricated successful captures.
Serialized proofs, detached/unregistered signatures and bare JSON cannot
authorize a check. The APP-plus-Worker packaging loop also now includes shared
check files once, rather than duplicating them for each artifact.

### External registration and acceptance requirements

- **One-time authority setup:** authenticate the current canonical DNS
  allowlist and its Inventory/Target Approval authority; establish existing
  Runtime Config signer/bootstrap/epoch/registry roots, the approved Worker
  reference authority, and independent WASM source/compiler pins. Verify raw
  digests and scoped signatures independently. Missing values remain
  `BLOCKED_EXTERNAL_INPUTS`; never derive roots from the candidate or historical
  approval marker. This is not a request to manually reapprove hostnames on
  every ordinary release.
- **Machine-produced per-release expectations:** exact capture/session/job/
  generation data must come from an approved independent resolver/registry and
  be bound to the existing pinned check policy. The current file/pin contract
  verifies those inputs, but no live catalog generator or authenticated
  registry backend was implemented or contacted here. Register the concrete
  backend, immutable-version semantics and approved collection implementation
  once, then automate observations; do not substitute a per-release human
  `PASS` declaration.
- **Formal native execution:** register the existing verifier executable and
  input/output contract with an approved launcher that observes actual binary
  bytes/version, arguments, exit status and raw output. No guessed `--version`
  flag was introduced. Supply real measured execution under the pinned
  producer implementation and correlate all archive/receipt/registry bytes.
- **Hosted trust boundary:** actual GitHub hosted events, main/workflow
  protection, artifact API behavior and repository/organization credential
  isolation still require separately authorized observation. API mock PASS
  is not evidence that these settings exist or are correctly isolated.
- **Real release acceptance:** separately authorize exact-source APP/Worker/
  WASM builds, real archive capture and native verification, then require all
  authenticated raw evidence before accepting a real release. Separate live
  deployment/gameplay authorization and observation are still needed.

Arbitrary external producer workflows and new cryptographic issuers remain
unregistered and fail closed. This intake establishes a local implementation
for the approved coordinator-to-consumer path, not completed real-evidence or
Production acceptance.

### Commands executed and results

The first targeted run had **66 PASS / 3 FAIL / 0 cancelled / 0 skipped**:
the authentication phase was incorrectly nested inside the structural loop,
and a transport inventory assertion did not yet include the new origin file.
After fixing those causes, the same four-file command had **69 PASS / 0 FAIL**:

```sh
env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --test \
  scripts/release-build.test.mjs scripts/release-consumer.test.mjs \
  scripts/release-transport.test.mjs scripts/release-checks.test.mjs
```

Adding `scripts/release-execution-intake.test.mjs` to that command produced
**97 PASS / 0 FAIL**, then **103 PASS / 0 FAIL** after adding explicit
verification layers, pinned capture resolution and stale-capture rejection.
The final run below additionally includes the capture import-closure guard:

```sh
env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --test \
  scripts/release-eligibility.test.mjs \
  scripts/release-manifest.test.mjs \
  scripts/release-build.test.mjs \
  scripts/release-consumer.test.mjs \
  scripts/release-transport.test.mjs \
  scripts/release-worker-source.test.mjs \
  scripts/release-worker-integration.test.mjs \
  scripts/release-checks.test.mjs \
  scripts/release-execution-intake.test.mjs \
  scripts/evidence-delivery-policy.test.mjs \
  scripts/release-workflow.test.mjs \
  scripts/production-target-contract.test.mjs \
  scripts/rama-migration-boundary.test.mjs \
  packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-trust-graph-test.mjs
```

**224 PASS, 0 FAIL, 0 cancelled, 0 skipped**, newly executed in this follow-up.
The 35 additional intake tests cover issuer/subject/raw bytes/source/run/
attempt/workflow mismatches, missing/unattested evidence, serialized capability
rejection, artifact replacement/rerun, capture target/generation/freshness
correlation, native binary/version measurement and complete consumer behavior.
All positive execution tests use explicit GitHub/storage/process doubles.
They do not certify a real archive, bundle, executable execution or issuer.

Existing PyYAML parsed the four explicitly named tag/coordinator/consumer/
legacy workflows; Node's async-function constructor compiled their five
embedded JavaScript bodies without executing them. `node --check` passed
for these twelve explicitly named source/test files:

```sh
for file in \
  scripts/release-execution-origin.mjs scripts/release-execution-intake.mjs \
  scripts/release-execution-intake.test.mjs scripts/release-build.mjs \
  scripts/release-checks.mjs scripts/release-transport.mjs \
  scripts/release-consumer.mjs scripts/release-check-fixture.mjs \
  scripts/release-consumer-fixture.mjs scripts/release-build.test.mjs \
  scripts/release-checks.test.mjs scripts/release-transport.test.mjs
do
  env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --check "$file" || exit
done
```

The protected files and audited Result byte-binding test were not operated on.
No Cargo/Rust/WASM execution, APP/Worker actual build, external connection,
credential-backed service operation, real R2 readback, native cryptographic
verification, real gameplay, key/secret generation, Production signing,
deployment, publication, push, PR, or tag operation was performed.
Hudsucker and its dependencies/default were unchanged.
`publication_authorized: false`, deployment `NOT_CHECKED` and Production
acceptance **BLOCKED** remain mandatory, including the fully synthetic
consumer success test. No real `RELEASE_ARTIFACTS_VALIDATED` or
`DEPLOYMENT_VERIFIED` was established.

## Archive/native producer registration follow-up (2026-10-26)

Starting branch: `tlsn-first-testplay-candidate`; starting HEAD:
`832491c8d65b26a58ff11ebc856da9295236d45f`. The explicitly selected task
worktree/index paths were clean. No branch switch, reset, merge or cherry-pick
was used.

### Located contracts and deliberately unresolved interfaces

- The actual Worker writer
  [`result_archive.ts`](../../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/result_archive.ts)
  performs `put` then `get`, compares the returned opaque R2 `version` and
  authority custom metadata, and checks exact bytes before authority commit.
  [`archive-readback.mjs`](../../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-readback.mjs)
  already provides the concrete R2 binding reader. The resource binding is
  `TLSN_PRESENTATIONS` in the existing Worker configuration.
- This contract identifies a particular observed object generation; it is
  **not** an S3 ETag, S3 version ID, permanent immutable storage or verified
  retention. Reading the current key rejects an overwritten generation; it
  does not retrieve an old generation. Retention remains `NOT_CHECKED`.
- No approved Actions-to-R2-binding transport or independent live capture
  catalog is defined. The Worker routes have no archive export/readback
  endpoint. The writer does not export its generation into an authenticated
  capture catalog. A new HTTP protocol, S3-to-R2-version conversion, guessed
  credential or collector issuer was not invented.
- The formal executable is
  [`verify_fusou_tlsn_evidence`](../../packages/FUSOU-TLSN-VERIFIER/src/bin/verify_fusou_tlsn_evidence.rs).
  Its existing CLI/README define bundle and independent trust inputs, JSON
  success/rejection reports and nonzero rejection exit. The source supports
  `--help`, but no executable version/build-identity observation. The package
  version in Cargo metadata does not prove which binary was executed. The
  documented acquisition route requires a separately authorized Cargo build;
  no authenticated standalone native binary distribution/build-identity
  provenance contract was located in the inspected paths.
- Consequently the formal native launcher implementation stops at
  `FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED`. No guessed `--version`
  call, manifest-version substitution or mock launcher was registered.

### Source wiring implemented

[`release-evidence-producer.mjs`](../../scripts/release-evidence-producer.mjs)
is the explicit trusted coordinator entrypoint. It verifies the runtime
repository, exact main workflow ref, event, run/attempt and workflow SHA
against the API-derived eligibility report before any storage access.
Only Production-eligible, generated builds invoke it in the coordinator.

The archive path parses the independently pinned check policy, validates its
source/capture/session/job/attempt/binding/object-key/generation metadata
before I/O, reads exact digest-named saved source bytes, and invokes the
existing real R2 binding adapter. The independently pinned policy resolves
the observed capture; the object cannot nominate its own expected identity.
Readback bytes are recorded through the existing private capture capability.
The consumed check-policy digest is included in the producer report and
compared with the consumer's independently supplied pin during intake.

The host contract accepts an actual `bucket.get` binding plus its independently
configured backend identity. A boolean `authenticated` marker, backend name
alone, missing generation, wrong metadata or substituted bytes cannot produce
capture evidence. Missing saved inputs/settings are explicit blockers; actual
permission/storage errors surface as errors, not successful fallbacks.

`capturedChecks` connects the entrypoint to transport and origin packaging.
Only supported check names, matching record/receipt/raw evidence, private
capture capabilities and digest-named files are accepted. Extra module-like
files, forged proofs, conflicting bytes or attempts to replace locked/compiled
builder checks are rejected. New archive files are **not** appended to
`report.build.check_files`: doing so would mutate the captured build subject.
A combined APP/Worker build test preserves the real in-process builder
capability while independently attaching archive capture evidence.

The existing trusted-main coordinator calls this entrypoint and hands its
captures to packaging. It adds only the existing public check-policy pin;
no secrets, OIDC, write permission, external Action or deployment operation
was added. **There is still no Actions R2 binding provider**, so a configured
policy without that provider yields
`ACTIONS_R2_BINDING_TRANSPORT_NOT_REGISTERED`, not a real R2 observation.

The consumer can propagate the two known missing-implementation diagnostics
only as negative blockers, after matching their execution context. A declared
`PASS` cannot authorize a missing check. Actual acceptance still uses the
existing API-authenticated transport, trusted-main implementation parity,
independent policy and exact receipt/raw input checks. The capture TCB now
contains 37 JavaScript modules plus the coordinator workflow. No issuer or
Production pin was added.

### Check and evidence states

| Check | Source state | Real evidence in this follow-up |
|---|---|---|
| `locked_dependencies` | Existing capture/consumer meaning preserved; builder proof remains intact after archive attachment. | `NOT_CHECKED`; only mock frozen commands were exercised. |
| `compiled_inputs` | Existing APP/Worker/WASM/public-input checks preserved. | `NOT_CHECKED`; no actual build, launch or fresh ABI verification. |
| `archive_readback` | Concrete R2-binding collector core, coordinator registration, packaging and consumer intake connected. Host binding transport and live capture catalog remain `BLOCKED_IMPLEMENTATION`. | Mock bucket/API only; real R2 `NOT_CHECKED`. |
| `offline_verification` | Existing raw binary/version/input/argument/result validation retained; missing digest inventory and empty binaries now fail explicitly. Formal native launcher remains `BLOCKED_IMPLEMENTATION` pending its build-identity contract. | Mock executor only; real native cryptographic execution `NOT_CHECKED`. |

The collector reports `LOCAL_CAPTURE_ONLY`, not authenticated cross-run
execution. Only the independent intake authenticates the GitHub issuer/run
and subject. `AUTHENTICATED_NATIVE_EXECUTION_REPORT` remains an authenticated
producer report, never consumer native cryptographic reexecution.

### Settings and concrete restart conditions

Existing settings used: `FUSOU_RELEASE_CHECK_INPUTS_SHA256` with the trusted
check-policy file, existing build/consumer public pins, the standard GitHub
runtime workflow/ref/run/attempt metadata, and the Worker's
`TLSN_PRESENTATIONS` binding. The coordinator only has its existing read-only
GitHub token. Credential existence or repository settings were not observed.
No Actions R2 credential name is defined by the inspected contract, so none
was guessed or added.

To remove the remaining implementation blockers:

1. Approve a concrete authenticated, read-only Actions-to-binding transport
   and independent catalog that supplies the writer's actual generation and
   capture/session/job/attempt/binding/source mapping. Define backend identity,
   required existing credential configuration and catalog authenticity without
   treating S3 ETag as R2 `version`. Register this provider in trusted code.
2. Define the formal native executable acquisition/provenance and observed
   version/build identity contract. Then implement its measured launcher
   using the already defined CLI inputs/outputs. Actual command, binary
   before/after measurements, exit/output and all target input digests must
   remain bound to the approved producer implementation/run.
3. Supply current independently authenticated public pins and raw capture
   inputs. After separate permission for services/builds/native execution,
   observe real evidence and independent consumer acceptance. This follow-up
   supplies no authenticated real archive or native evidence.

One-time authority/provider registration must enable automated per-release
observations; it must not become repeated manual hostname approval or a human
`PASS` substitute.

### Exact validation commands and results

All commands were run from the repository root. The reviewed targeted command
was run three times: **123 PASS / 0 FAIL**, **122 PASS / 1 FAIL**, then
**123 PASS / 0 FAIL**, with zero cancelled/skipped each time. The intermediate
failure was a new test expecting singular `blocker`; the existing consumer
returns a `blockers` array. The test now asserts the exact one-element array;
the consumer API/assertions were not weakened.

```sh
env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --test \
  scripts/release-evidence-producer.test.mjs \
  scripts/release-execution-intake.test.mjs \
  scripts/release-checks.test.mjs \
  scripts/release-transport.test.mjs \
  scripts/release-workflow.test.mjs
```

The following full scoped command was run with independent capture attachment
and input/receipt substitution regressions, then again with the additional
self-declared success assertion. Both runs were
**262 PASS / 0 FAIL / 0 cancelled / 0 skipped**:

```sh
env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --test \
  scripts/release-eligibility.test.mjs scripts/release-manifest.test.mjs \
  scripts/release-build.test.mjs scripts/release-consumer.test.mjs \
  scripts/release-transport.test.mjs scripts/release-worker-source.test.mjs \
  scripts/release-worker-integration.test.mjs scripts/release-checks.test.mjs \
  scripts/release-execution-intake.test.mjs scripts/release-evidence-producer.test.mjs \
  scripts/evidence-delivery-policy.test.mjs scripts/release-workflow.test.mjs \
  scripts/production-target-contract.test.mjs scripts/rama-migration-boundary.test.mjs \
  packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-trust-graph-test.mjs
```

After explicitly checking the producer report schema/scope in intake, the
smallest affected two-file command passed **73 / 73**, with zero failures,
cancelled or skipped:

```sh
env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --test \
  scripts/release-evidence-producer.test.mjs scripts/release-execution-intake.test.mjs
```

Static validation: four explicit YAML workflows parsed and five embedded
JavaScript bodies compiled without execution, all PASS:

```sh
env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE python - <<'PY'
from pathlib import Path
import subprocess
import yaml
paths = ('.github/workflows/tlsn-tag-validation.yml', '.github/workflows/tlsn-release-eligibility.yml', '.github/workflows/tlsn-release-consumer.yml', '.github/workflows/publish_and_create_version_tag.yml')
count = 0
for path in paths:
    document = yaml.safe_load(Path(path).read_text())
    for job in document.get('jobs', {}).values():
        for step in job.get('steps', []):
            body = step.get('with', {}).get('script')
            if body is not None:
                subprocess.run(['node', '-e', 'const fs=require("node:fs");const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;new AsyncFunction(fs.readFileSync(0,"utf8"));'], input=body, text=True, check=True)
                count += 1
print(f'PASS: {len(paths)} workflow YAML files; {count} embedded JavaScript bodies compiled without execution.')
PY
```

Changed JavaScript syntax checks, all eight PASS:

```sh
for file in scripts/release-evidence-producer.mjs scripts/release-evidence-producer.test.mjs scripts/release-checks.mjs scripts/release-consumer.mjs scripts/release-transport.mjs scripts/release-execution-intake.mjs scripts/release-build.test.mjs scripts/release-workflow.test.mjs
do
  env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --check "$file"
done
```

All positive archive/native execution tests use explicit storage/API/process
doubles. Safe static reads include the formal CLI source, not its execution
or any protected source. Cargo/Rust/WASM/APP/Worker builds or execution,
formal native execution, external GitHub/R2/Cloudflare/authority/Notary calls,
real artifact verification, hosted events/credential isolation, gameplay and
Production observation are **NOT_RUN** under this task's authorization.
No new key/secret, deploy/publish/signing, push, PR or tag operation occurred.
Protected files, the audited Result byte-binding test and Hudsucker/default
dependencies were not operated on.

Source wiring and synthetic contract tests are verified, but actual producer
connectivity is not complete. No real `RELEASE_ARTIFACTS_VALIDATED` or
`DEPLOYMENT_VERIFIED` is established. `publication_authorized: false`,
deployment `NOT_CHECKED` and Production acceptance **BLOCKED** remain enforced.

## Read-only archive catalog and native identity investigation

Branch at entry: `tlsn-first-testplay-candidate`; actual entry HEAD:
`5f1474bac8b7854d93259485459b71a6fb4f14c1`, matching the requested baseline.
Entry worktree/index checks were limited to the allowed task paths and were
clean. Later checks and the local commit use explicit paths only. This section
describes source and synthetic verification, not observed external execution.

### Source implementation and independent expectations

- The real archive writer now returns a snapshot **after** its existing
  put/get, version/custom-metadata, exact-byte/length/hash checks. Failure and
  cleanup behavior remain in the writer; no snapshot is created on failure.
- Both Production callback and synchronous Result paths pass the Presentation
  and exact outer Result snapshots to `commitVerifiedResult`, still after
  both archives have been verified. Generic paths without Production inventory
  preserve their existing behavior.
- The existing binding authority saves a catalog in the **same storage
  transaction** as consumed binding state, exact Result bytes and optional raw
  verifier execution receipt bytes. Snapshot identity must match the authority's
  session/job/attempt/binding, Presentation digest and exact Result digest/key.
  The Result digest covers the entire envelope, including its consume receipt;
  no reserialized inner receipt is presented as original receipt bytes.
- Capture ID is the consumed binding ID. The two archive objects must have the
  same configured Worker source SHA. `created_at` is recorded by the authority
  at commit; `authority_used_at` separately preserves the consumed Result time.
  This source SHA and the `TLSN_BINDINGS`/`TLSN_PRESENTATIONS` binding names
  identify the source/configuration scope, **not independently authenticated
  deployment identity or provider configuration**.
- Existing consumed-result and replay RPCs return the optional catalog and
  check it against independently stored authority Result/receipt bytes. Legacy
  records without writer-observed generation cannot be backfilled from a
  producer's claims. Same snapshots/target can be retried idempotently; changed
  generation, digest, subject, or omission of an existing catalog cannot
  replace it. No global single-use ledger was introduced.
- `readAuthorityArchiveCatalog` reads the existing trusted authority interface,
  not an intake record. `createAuthorityCatalogReadback` checks the independent
  release source and subject/job lookup, then maps **only** Presentation/Result
  to authority-owned keys. It exposes get only, not put/delete/list. Readback
  metadata/version, raw length and digest must match the catalog. The exported
  catalog is a copy and cannot mutate the reader's private expectations.
- New modules are included in the Worker source/import inventory and trusted
  capture implementation parity set. No historical approval marker, new
  Production pin, key, signature wire format or credential was adopted.

The library read-only adapter accepts a trusted in-runtime authority reader and
R2 binding. It does **not** authenticate arbitrary callbacks or serialized JSON
across processes. No public HTTP route was mounted. The trusted producer
workflow still has no registered Actions-to-binding transport; its existing
pinned-policy local adapter is not reported as an authority-catalog service.
The independent consumer retains its existing API-authenticated producer
artifact/run/source/policy checks. It has **not** authenticated a real catalog
HTTP response or accepted new real archive/native evidence in this phase.

### R2 generation semantics: deliberately limited

The installed Workers types expose `R2Object.version` as a string, and the
existing binding read path uses `get(key)`. Its get options do not expose a
past-generation/version selector. The implemented guarantee is exactly
`CURRENT_OBJECT_VERSION_EQUALITY`: compare the currently returned opaque
version string and exact bytes with the authority snapshot.

This detects a changed observed version or changed bytes, but does not prevent
an overwrite, prove provider-level uniqueness/immutability, retain deleted
objects, or retrieve older generations. `version_id` in the existing check
format is **not** being redefined as an S3 VersionId or retrieval token.
`previous_generation_retrieval: NOT_IMPLEMENTED` and
`retention_status: NOT_CHECKED` are enforced catalog values. Claims upgrading
either are rejected. No conditional-write/write-once API was added without an
approved provider semantics contract. No external official documentation or
provider behavior was fetched/verified under the no-network restriction.

`EXACT_CONSUMED_BINDING` is a target scope, not an invented retention/freshness
period. Binding authorization TTL is not reused as archive TTL. An approved
HTTP authorization policy must separately define request expiration, catalog
access scope and any freshness limit. No expired-capture acceptance policy is
silently inferred.

### Authentication and native producer blockers

| Missing contract | Existing root and why it is insufficient | Required independent input/registration |
| --- | --- | --- |
| `ACTIONS_R2_BINDING_TRANSPORT_NOT_REGISTERED` | Coordinator/consumer GitHub API authentication proves run/artifact origin, not permission for a Worker HTTP request. No TLSN OIDC audience/claim policy or verifier is registered. | Owner-approved HTTP authentication/provider contract; repository/trusted workflow/revision/run/attempt/release scope and capture authorization; if OIDC is selected, independently registered audience, issuer/signature/JWKS/expiry policy and verified available claims. |
| Cross-run authority-catalog resolver | Durable Object consumed state now supplies independent generations/digests internally; an artifact JSON copy or callback cannot authenticate that state remotely. | Approved authenticated route from GitHub execution to the real authority and `TLSN_PRESENTATIONS` binding, subject/capture lookup authorization, source/deployment mapping, freshness policy and concrete environment/provider registration. |
| Retention/past-generation contract | Current version and bytes equality are not retention or historical retrieval. | Explicit provider/operations retention requirements and approved semantics, then authorized provider validation; missing guarantees remain NOT_CHECKED/NOT_IMPLEMENTED. |
| `FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED` | Existing private build proofs and artifact roles cover APP/Worker, not a formal native build. Formal CLI source has help but no observed `--version`/build-ID contract. An API-authenticated archive hash alone does not prove the native build recipe ran. | Trusted native builder workflow/revision/run/attempt, exact source and chosen committed dependency lock, compiler/toolchain and recipe pins, independently authenticated artifact acquisition and executable digest, and an execution capture adapter. |

The producer diagnostic now distinguishes the candidate identity model
`AUTHENTICATED_BUILD_PROVENANCE_AND_EXECUTABLE_SHA256` from a semantic version.
This is **not** a registered provenance wire contract or native success path.
No version string or `--version` call was invented. Existing native input,
executable/version, argument and output guards were not weakened. A future
versionless admission must explicitly reconcile those guards with authenticated
binary provenance rather than fill their version field with a fabricated
string. Native manifest-directory tracked inventory did not establish a
chosen committed native lockfile/build recipe; no Rust execution was used to
resolve that question.

No new long-lived Cloudflare token or secret name was introduced. Binding
configuration names were read from source only; credential existence,
environment registration and real deployment mapping remain **UNVERIFIED**.
These cannot be completed by local code changes alone. After owner-approved
contracts/registration, separately authorized validation must observe a real
identity, real authority catalog/R2 readback, authenticated producer artifact
intake and the formal native launcher. Consumer authentication of a native
execution report still does not mean the consumer independently reran native
cryptographic verification.

### Four checks and evidence states

| Check | Source state | Synthetic verification | Real artifact/authenticated external evidence |
| --- | --- | --- | --- |
| `locked_dependencies` | Existing frozen/locked execution and private origin checks preserved. | PASS in the selected Node regressions. | NOT_RUN in this phase. |
| `compiled_inputs` | Existing APP/Worker artifact roles and source/compiler/provenance pins preserved; no native role silently added. | PASS in the selected Node regressions. | NOT_RUN; no fresh WASM ABI or build claim. |
| `archive_readback` | Writer/authority catalog/internal read-only adapter implemented; Actions HTTP/provider remains BLOCKED_IMPLEMENTATION. | Actual writer and authority methods run with in-memory storage/R2 doubles; mutations/rollback/idempotence checked. | No real R2 or authenticated remote catalog evidence; BLOCKED_EXTERNAL_INPUTS and missing transport contract. |
| `offline_verification` | Diagnostic requirements clarified; formal native builder/launcher registration remains BLOCKED_IMPLEMENTATION. | Existing mock execution and rejection contracts preserved. | No executable run or authenticated real native report; no independent crypto rerun. |

### Exact local validation commands and outcomes

Commands below were run from the repository root. Output redirections and
summary extraction only write/read the named session logs. No package script
or automatic test discovery was used.

The same Node-only no-emit command passed three times (zero diagnostics):

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE packages/FUSOU-TLSN-VERIFICATION-WORKER/node_modules/.bin/tsc --noEmit -p packages/FUSOU-TLSN-VERIFICATION-WORKER/tsconfig.json > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/catalog-typecheck-initial.log 2>&1; result=$?; tail -n 28 /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/catalog-typecheck-initial.log; exit "$result"

cd /home/ogu-h/Documents/GitHub/FUSOU
env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE packages/FUSOU-TLSN-VERIFICATION-WORKER/node_modules/.bin/tsc --noEmit -p packages/FUSOU-TLSN-VERIFICATION-WORKER/tsconfig.json > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/catalog-typecheck-next.log 2>&1; result=$?; tail -n 18 /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/catalog-typecheck-next.log; exit "$result"

cd /home/ogu-h/Documents/GitHub/FUSOU
env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE packages/FUSOU-TLSN-VERIFICATION-WORKER/node_modules/.bin/tsc --noEmit -p packages/FUSOU-TLSN-VERIFICATION-WORKER/tsconfig.json > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/catalog-typecheck-final.log 2>&1; result=$?; tail -n 18 /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/catalog-typecheck-final.log; exit "$result"
```

Targeted Node run: initially **62 PASS / 28 FAIL**, caused by the new test's
incorrect exported authority class name. Correcting it and extending tests
gave **101 PASS / 0 FAIL**, cancelled/skipped zero. No assertion was removed,
weakened or skipped. Later private-expectation/rollback/replay additions are
included in the final full regression, not retroactively counted here.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --test scripts/release-archive-catalog.test.mjs scripts/release-worker-integration.test.mjs scripts/release-evidence-producer.test.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/catalog-node-targeted-initial.log 2>&1; result=$?; grep -E '^(not ok|# tests|# pass|# fail|# cancelled|# skipped|# duration)' /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/catalog-node-targeted-initial.log; exit "$result"

cd /home/ogu-h/Documents/GitHub/FUSOU
env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --test scripts/release-archive-catalog.test.mjs scripts/release-worker-integration.test.mjs scripts/release-evidence-producer.test.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/catalog-node-targeted-next.log 2>&1; result=$?; grep -E '^(not ok|# tests|# pass|# fail|# cancelled|# skipped|# duration)' /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/catalog-node-targeted-next.log; exit "$result"
```

Full explicit 16-file regression: first **302 PASS / 0 FAIL**, then
**303 PASS / 0 FAIL** after adding exported-catalog mutation isolation.
Cancelled/skipped zero in both runs.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --test scripts/release-eligibility.test.mjs scripts/release-manifest.test.mjs scripts/release-build.test.mjs scripts/release-consumer.test.mjs scripts/release-transport.test.mjs scripts/release-worker-source.test.mjs scripts/release-worker-integration.test.mjs scripts/release-checks.test.mjs scripts/release-execution-intake.test.mjs scripts/release-evidence-producer.test.mjs scripts/release-archive-catalog.test.mjs scripts/evidence-delivery-policy.test.mjs scripts/release-workflow.test.mjs scripts/production-target-contract.test.mjs scripts/rama-migration-boundary.test.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-trust-graph-test.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/catalog-node-regression.log 2>&1; result=$?; grep -E '^(not ok|# tests|# pass|# fail|# cancelled|# skipped|# duration)' /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/catalog-node-regression.log; exit "$result"

cd /home/ogu-h/Documents/GitHub/FUSOU
env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --test scripts/release-eligibility.test.mjs scripts/release-manifest.test.mjs scripts/release-build.test.mjs scripts/release-consumer.test.mjs scripts/release-transport.test.mjs scripts/release-worker-source.test.mjs scripts/release-worker-integration.test.mjs scripts/release-checks.test.mjs scripts/release-execution-intake.test.mjs scripts/release-evidence-producer.test.mjs scripts/release-archive-catalog.test.mjs scripts/evidence-delivery-policy.test.mjs scripts/release-workflow.test.mjs scripts/production-target-contract.test.mjs scripts/rama-migration-boundary.test.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-trust-graph-test.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/catalog-node-regression-final.log 2>&1; result=$?; grep -E '^(not ok|# tests|# pass|# fail|# cancelled|# skipped|# duration)' /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/catalog-node-regression-final.log; exit "$result"
```

Static checks: **7 changed JS files PASS**, **4 workflow YAML files PASS**,
**5 embedded JS bodies compile-only PASS**:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
for file in scripts/release-evidence-producer.mjs scripts/release-evidence-producer.test.mjs scripts/release-archive-catalog.test.mjs scripts/release-execution-intake.mjs scripts/release-worker-source.mjs scripts/release-worker-integration.test.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-catalog.mjs; do env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --check "$file" || exit; done; printf 'PASS: 7 changed JavaScript files syntax-checked without execution.\n'

cd /home/ogu-h/Documents/GitHub/FUSOU
env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE python3 - <<'PY'
from pathlib import Path
import subprocess
import yaml
paths = ('.github/workflows/tlsn-tag-validation.yml', '.github/workflows/tlsn-release-eligibility.yml', '.github/workflows/tlsn-release-consumer.yml', '.github/workflows/publish_and_create_version_tag.yml')
count = 0
for path in paths:
    document = yaml.safe_load(Path(path).read_text())
    for job in document.get('jobs', {}).values():
        for step in job.get('steps', []):
            body = step.get('with', {}).get('script')
            if body is not None:
                subprocess.run(['node', '-e', 'const fs=require("node:fs");const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;new AsyncFunction(fs.readFileSync(0,"utf8"));'], input=body, text=True, check=True)
                count += 1
print(f'PASS: {len(paths)} workflow YAML files; {count} embedded JavaScript bodies compiled without execution.')
PY
```

Source inspection and scoped Git metadata are not counted as test passes.
The normal commit hook was inspected: analysis materializes only allowed staged
blobs in a temporary repository, then runs local AST graph analysis there.
No APP/Worker/native build is part of that analysis.

### NOT_RUN and unchanged acceptance boundaries

- OIDC signature/issuer/audience/expiry and authenticated HTTP method/run/workflow
  rejection tests: **NOT_RUN**; there is no registered authentication policy or
  mounted endpoint. An all-reject stub/synthetic JWT success was not substituted
  for real protocol implementation.
- Authorized/unknown/expired capture HTTP requests: **NOT_RUN**; no registered
  HTTP scope/freshness contract. Internal unknown capture, unrelated
  subject/job, arbitrary key/role and storage absence cases are tested.
- GitHub API, Cloudflare, R2, authority, Notary and official-doc network access:
  **NOT_RUN**, expressly disallowed. No real credential was used or registered.
- Cargo/Rust/WASM, APP/Worker/native verifier build or executable invocation:
  **NOT_RUN**, expressly disallowed; Node no-emit/static parsing is not a build
  or native cryptographic verifier run.
- Real artifact verification, authenticated real catalog/native intake,
  Production execution/gameplay, deployment/publishing/signing, push/PR/tag:
  **NOT_RUN**. No new key/secret or Hudsucker/default dependency change.
- Prescribed protected files were not read, hashed, searched, edited or included
  in the commit. The audited Result byte-binding test remains unmodified.

Source catalog implementation and synthetic contracts are verified; full
Actions transport/native registration and real-evidence acceptance are not.
`RELEASE_ARTIFACTS_VALIDATED` and `DEPLOYMENT_VERIFIED` were not established.
`publication_authorized: false`, deployment **NOT_CHECKED**, Production
acceptance **BLOCKED** remain unchanged.

### Scoped local commit commands

The explicit path list below is also the changed-file inventory: writer,
authority, both Worker commit paths, catalog implementation/declarations,
source/TCB inventory, producer diagnostics, related Node tests and this record.
The normal pre-commit hook is retained. Commit SHA/parent and final scoped
worktree/index state are reported from Git after the local commit; no push is
authorized.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
git diff --check -- scripts/release-archive-catalog.test.mjs scripts/release-evidence-producer.mjs scripts/release-evidence-producer.test.mjs scripts/release-worker-integration.test.mjs scripts/release-worker-source.mjs scripts/release-execution-intake.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-catalog.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-catalog.d.mts packages/FUSOU-TLSN-VERIFICATION-WORKER/src/result_archive.ts packages/FUSOU-TLSN-VERIFICATION-WORKER/src/binding_authority.ts packages/FUSOU-TLSN-VERIFICATION-WORKER/src/index.ts docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
git add -- scripts/release-archive-catalog.test.mjs scripts/release-evidence-producer.mjs scripts/release-evidence-producer.test.mjs scripts/release-worker-integration.test.mjs scripts/release-worker-source.mjs scripts/release-execution-intake.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-catalog.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-catalog.d.mts packages/FUSOU-TLSN-VERIFICATION-WORKER/src/result_archive.ts packages/FUSOU-TLSN-VERIFICATION-WORKER/src/binding_authority.ts packages/FUSOU-TLSN-VERIFICATION-WORKER/src/index.ts docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
git diff --cached --check -- scripts/release-archive-catalog.test.mjs scripts/release-evidence-producer.mjs scripts/release-evidence-producer.test.mjs scripts/release-worker-integration.test.mjs scripts/release-worker-source.mjs scripts/release-execution-intake.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-catalog.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-catalog.d.mts packages/FUSOU-TLSN-VERIFICATION-WORKER/src/result_archive.ts packages/FUSOU-TLSN-VERIFICATION-WORKER/src/binding_authority.ts packages/FUSOU-TLSN-VERIFICATION-WORKER/src/index.ts docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
git -c commit.gpgsign=false commit --only -m "feat(tlsn): persist authority-backed archive capture catalog" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" -- scripts/release-archive-catalog.test.mjs scripts/release-evidence-producer.mjs scripts/release-evidence-producer.test.mjs scripts/release-worker-integration.test.mjs scripts/release-worker-source.mjs scripts/release-execution-intake.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-catalog.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-catalog.d.mts packages/FUSOU-TLSN-VERIFICATION-WORKER/src/result_archive.ts packages/FUSOU-TLSN-VERIFICATION-WORKER/src/binding_authority.ts packages/FUSOU-TLSN-VERIFICATION-WORKER/src/index.ts docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
git branch --show-current
git rev-parse HEAD HEAD^
git status --short -- scripts/release-archive-catalog.test.mjs scripts/release-evidence-producer.mjs scripts/release-evidence-producer.test.mjs scripts/release-worker-integration.test.mjs scripts/release-worker-source.mjs scripts/release-execution-intake.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-catalog.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-catalog.d.mts packages/FUSOU-TLSN-VERIFICATION-WORKER/src/result_archive.ts packages/FUSOU-TLSN-VERIFICATION-WORKER/src/binding_authority.ts packages/FUSOU-TLSN-VERIFICATION-WORKER/src/index.ts docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
```

## GitHub OIDC authenticated archive HTTP source implementation

Entry branch: `tlsn-first-testplay-candidate`; actual entry HEAD:
`b8672a6f234589593b891951b3359cf15f469066`, matching the requested baseline.
Initial explicit task-path worktree/index status was clean. The final commit
and scoped status are recorded from Git in the completion report.

### API and authentication contract

`POST /internal/tlsn/archive-readback/v1` is a **read operation**, not an archive
write. The Worker mounts the handler without exposing internal authority writes
or storage keys. Other methods return 405 after authentication; no query,
alternate endpoint, arbitrary object key, list or delete request is accepted.
Requests and responses use versioned contracts in
`src/archive-http-contract.mjs`.

The Worker requires two **public, independently provisioned configuration
inputs**, neither of which was registered or assigned Production values here:

- `TLSN_ARCHIVE_TRANSPORT_POLICY`: canonical JSON of the policy below.
- `TLSN_ARCHIVE_TRANSPORT_POLICY_SHA256`: base64url SHA-256 of those exact
  canonical UTF-8 bytes, supplied by trusted configuration management, not by
  the caller. A request cannot provide or override either value.

The Actions producer and independent consumer obtain the identical policy
object and digest through `archive_transport: {policy, policy_sha256}` in the
existing independently pinned `scripts/release-check-public-inputs.json`.
The outer file remains pinned by the existing
`FUSOU_RELEASE_CHECK_INPUTS_SHA256` public repository variable. A policy embedded
only in an evidence artifact is not an independent expectation.

Policy schema (field meanings, **not a Production configuration**):

| Field | Required independent meaning |
| --- | --- |
| `schema_version`, `scope` | `1`, `fusou-github-oidc-archive-read-v1` |
| `endpoint`, `audience` | Identical, dedicated canonical HTTPS URL ending in the exact API path above; no credentials/query/fragment. Must be owner-approved for the intended authority deployment. |
| `repository`, `repository_id` | Exact `tsukasa-u/FUSOU` and independently provisioned numeric-string GitHub repository ID. No real ID is selected by this change. |
| `workflow_ref` | Exact `tsukasa-u/FUSOU/.github/workflows/tlsn-release-eligibility.yml@refs/heads/main`. |
| `event_name`, `ref` | Exact `workflow_run`, `refs/heads/main`. |
| `clock_skew_seconds` | Explicit tolerance, integer 0..60; no implicit tolerance. |
| `max_token_age_seconds` | Explicit maximum token age, integer 1..600. |
| `max_object_bytes` | Explicit bound, at most 8 MiB per raw object; oversized captures fail, not truncate. This is a buffering admission limit, not a measured RSS guarantee. |
| `job_workflow_ref`, `job_workflow_sha` | Optional paired exact reusable-workflow expectations. If configured, both corresponding signed claims are mandatory. They are not assumed to exist otherwise. |
| `grants` | Nonempty bounded list of independently authorized execution/capture tuples; duplicate run/attempt/capture entries rejected. |

Each grant requires exact `workflow_sha`, numeric `run_id`/`run_attempt`,
`source_sha`, `capture_id`, `binding_id`, `verification_attempt_id`,
`lookup: {session_id, canonical_user_id, device_id, verification_job_id}`,
`not_before_ms`, `expires_at_ms`, `capture_not_before_ms` and
`capture_max_age_ms`. The source SHA and target lookup cannot be derived from
the request or OIDC `sha` claim. Capture ID must equal binding ID. Authorization
expiry and capture age are separate from token expiry and archive retention.

These grants are a fail-closed input interface, **not a recommendation to ask a
human to approve each release manually**. The source does not implement an
automated grant publisher. An owner-approved trusted coordinator/provider must
supply them from independently authenticated release eligibility, GitHub
run/attempt/revision and authority target metadata. Its registration and update
mechanism remain an external/provider blocker. Guessing such tuples or copying
them from intake records is not permitted.

JWT verification reuses already locked `jose@6.1.2` (now a direct exact Worker
dependency), rather than hand-written signature cryptography:

- Exact issuer `https://token.actions.githubusercontent.com`; fixed JWKS URL
  `https://token.actions.githubusercontent.com/.well-known/jwks`.
- RS256 only; bounded nonempty `kid`; JWT header key URLs/embedded keys and
  unsupported headers rejected. `jku`, `jwk` and `x5u` cannot select key sources.
- JOSE signature verification, mandatory `exp`/`iat`, maximum token age,
  optional `nbf`, finite ordered timestamps and bounded explicit clock skew.
  Audience must be the **single exact string**, not a broader audience array.
- Signed repository/name-ID, workflow ref/revision, event/ref and canonical
  run/attempt strings must match policy and the independent grant. No legacy
  `sub` format is treated as authority. Optional reusable-workflow expectations
  are enforced only when independently configured.
- Fixed-source JWKS retrieval has timeout/size bounds, no redirects, ten-minute
  cache age and a thirty-second unknown-key refresh cooldown. Unknown keys
  during cooldown fail closed; later refresh uses only the fixed source.
  Failed refresh does not accept a token with an unrecognized key.

No real GitHub token, live claims, issuer keys or endpoint availability were
observed. Required signed claims are enforced by source; if an actual token
lacks them, it is rejected. Local installed JOSE APIs and existing Workers
types were used; no external documentation/API retrieval was performed.

Request JSON has exactly ten fields:
`source_sha`, `workflow_sha`, `run_id`, `run_attempt`, `capture_id`,
`session_id`, `job_id`, `verification_attempt_id`, `binding_id`, `role`.
Only role `presentation` or `result` is allowed. User/device lookup and object
keys come from the independent grant and existing authority catalog, never the
request. Requests are bounded to 4096 bytes.

The handler calls the existing consumed-result RPC/transaction read through
`DurableObjectBindingAuthority`. It checks authority catalog identity/freshness,
then reads the catalog-resolved object using `TLSN_PRESENTATIONS`. R2-reported
size must fit the configured bound before body buffering. Current version,
custom metadata, exact raw size and digest must all match. Known storage,
authentication and validation failures produce explicit non-success responses;
there is no success-shaped fallback.

Success JSON is canonical `fusou-archive-http-response-v1` with:
`schema_version`, `scope`, `authorization`, `observed_at_ms`, `catalog`, and
base64url raw `bytes`. Schema/duplicate/extra-field checks prevent unexpected
fields from being persisted. Responses have `Cache-Control: no-store`.
No JWT, bearer credential or private key is emitted in JSON/logs/artifacts.

R2 semantics are unchanged: current opaque version equality and raw
length/digest checks, **not** historical generation selection, overwrite
prevention, deletion prevention or retention. Catalog values remain
`CURRENT_OBJECT_VERSION_EQUALITY`, `previous_generation_retrieval:
NOT_IMPLEMENTED`, `retention_status: NOT_CHECKED`.

### Actions and independent consumer connection

The build job remains without `id-token: write`; it explicitly disables HTTP
acquisition with `httpEnabled: false`. New job `archive-evidence`, on a
separate runner after `eligibility`, is the **only** OIDC-enabled job. It checks
out immutable trusted main, reevaluates live eligibility and authenticates the
primary artifact through GitHub API metadata/digest/readback. It does not build
or execute release/tag artifacts. Development tags produce NOT_APPLICABLE
without requesting an OIDC token. Existing pinned external Actions are reused;
no new Action implementation or long-lived secret was introduced.

The client requests a short-lived token from the runner-supplied Actions token
URL (HTTPS Actions host only), with the policy audience, then POSTs only to the
independently pinned HTTPS endpoint. Redirects are forbidden and responses are
bounded. Tokens remain in memory and are not included in execution evidence.
`workflow_sha` is the coordinator workflow revision, **not** the release SHA.

The producer stores both exact raw HTTP responses and Presentation/Result
bytes in the existing captured execution format (six explicitly validated
inputs rather than four for this opt-in transport). Downloaded raw bytes
populate `saved_*` after independent catalog/digest validation; they do not
represent a second remote source read. The authority writer snapshot supplies
the independent digest expectation. The original internal-binding path and
its four-input contract remain unchanged.

The isolated job emits a separate `fusou-archive-<run>-<attempt>` data-only
artifact. It retains the **exact original release report**, adds only archive
check/evidence/origin and negative production diagnostics, and cannot replace
build/native proofs. The consumer authenticates both artifacts independently
using the existing coordinator/GitHub model: immutable trusted workflow
implementation parity, completed successful main run, repository IDs,
run/attempt/source, unique artifact name/ID and API archive digest/readback.
All jobs in that authenticated workflow remain within that existing workflow
trust boundary; this is not a new cryptographic per-job attestation claim.

The consumer requires identical primary/supplemental release report bytes,
validates raw-response schema/catalog/version/size/digest and all target/run
correlations against the **independently pinned** policy, then authenticates the
archive execution origin before it can be skipped by a later missing check.
JWT expiry gates HTTP request admission; later report observation freshness
uses the existing independent archive `max_age_ms`, not token lifetime. Active
grant/capture validity is still required; an expired token cannot make a new
request, and a stale report is rejected.
The successful acquisition label is
`AUTHENTICATED_PRODUCER_REPORT_VERIFIED`.

That label means trusted producer HTTPS acquisition/report authentication,
**not a transferable signature on the HTTP JSON, an independently reverified
OIDC JWT at the consumer, or TLSN/native cryptographic verification**. The
Worker verifies the JWT; the consumer relies on the trusted HTTPS acquisition
implementation executed by the API-authenticated workflow. An
`authenticated: true` record alone is rejected. Missing supplemental artifacts,
origin, inputs, pins or remote success keep the check blocked.

### Source and real-evidence state

| Check | Source/contract state | Real evidence in this phase |
| --- | --- | --- |
| `locked_dependencies` | Preserved; no relaxation of frozen/locked execution proofs. | NOT_RUN |
| `compiled_inputs` | Preserved; HTTP modules/dependency included in Worker source closure. No new build or fresh WASM ABI claim. | NOT_RUN |
| `archive_readback` | OIDC handler, internal authority resolver, Actions client, isolated producer and independent supplemental intake implemented; synthetic tests PASS. | No real token, configured policy, HTTP/R2 readback or authenticated external artifact observed. BLOCKED_EXTERNAL_INPUTS until registration and authorized validation. |
| `offline_verification` | `FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED` maintained, no launcher/version success path added. | NOT_RUN / BLOCKED_IMPLEMENTATION |

The legacy `ACTIONS_R2_BINDING_TRANSPORT_NOT_REGISTERED` diagnostic remains for
the unconfigured legacy direct-binding path. The new HTTP path instead reports
specific policy/pin/grant/credential/HTTP failures. Source implementation is not
evidence that the endpoint is deployed or externally registered.

Remaining inputs/decisions:

1. Independently approved endpoint/deployment-to-authority mapping, repository
   ID, dedicated audience and trusted workflow/revision expectations.
2. Matching Worker public policy/digest and existing Actions/consumer public
   check-policy pin registration. No such setting is assumed present.
3. Approved automated independent grant provider, authorization lifetime,
   capture age/scope and update procedure; missing provider data means denial.
4. Explicit permission for runtime JWKS/Actions-token/HTTP/GitHub/R2 operations,
   followed by observation of actual claims, key rotation, expiration, scoped
   real catalog readback and independent consumer acceptance.
5. Any required retention/immutability provider guarantees remain separate.
   Native builder/provenance remains a different future phase.

These require repository/environment/provider ownership and authorized
external validation; local source changes cannot establish them.

### Exact commands and validation outcomes

All commands below run from `/home/ogu-h/Documents/GitHub/FUSOU`. Source
inspection used explicit allowed paths only. Initial/final branch and HEAD
queries used `git branch --show-current` and `git rev-parse HEAD`; scoped status
uses the exact path list recorded in the commit block below (the entry probe
used the existing subset before new paths were created).

Local dependency availability probe and offline restore:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
node --version
pnpm --version
test -d packages/FUSOU-WEB/node_modules/jose && printf 'Web jose installed\n'
test -d packages/FUSOU-TLSN-VERIFICATION-WORKER/node_modules/jose && printf 'Worker jose installed\n'
test -d node_modules/.pnpm/jose@6.1.2/node_modules/jose && printf 'Locked jose 6.1.2 store present\n'
CI=true pnpm install --offline --ignore-scripts --frozen-lockfile --filter fusou-tlsn-verification-worker
```

Node `v22.21.1`, pnpm `10.14.0`; locked local JOSE store present. The Worker
dependency was initially absent; after the explicit manifest/importer change,
offline restore passed without resolution/download or lifecycle scripts.

Targeted two-file run: initially **70 PASS / 2 FAIL**, then **72 PASS / 0 FAIL**,
cancelled/skipped zero. One failure exposed lazy supplemental-origin
authentication being bypassed by an earlier missing-native blocker; fixed by
eager independent archive validation/authentication, **not by relaxing the
test**. The other was a static deny-regex matching the job description's words
"execute ... artifacts"; the step description was renamed and the deny
assertion retained. Additional boundary cases are included in the final run.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --test scripts/release-archive-http.test.mjs scripts/release-workflow.test.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/oidc-targeted-initial.log 2>&1; result=$?; grep -E '^(not ok|# tests|# pass|# fail|# cancelled|# skipped|# duration)' /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/oidc-targeted-initial.log; exit "$result"

cd /home/ogu-h/Documents/GitHub/FUSOU
env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --test scripts/release-archive-http.test.mjs scripts/release-workflow.test.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/oidc-targeted-next.log 2>&1; result=$?; grep -E '^(not ok|# tests|# pass|# fail|# cancelled|# skipped|# duration)' /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/oidc-targeted-next.log; exit "$result"
```

Existing 16-file regression **303 PASS / 0 FAIL**; combined 17-file regression
**375 PASS / 0 FAIL**, followed by **376 PASS / 0 FAIL** with separate
token-admission/evidence-freshness regression coverage, cancelled/skipped zero.
The final combined command below was run twice (the named log holds the latest
376-test result):

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --test scripts/release-eligibility.test.mjs scripts/release-manifest.test.mjs scripts/release-build.test.mjs scripts/release-consumer.test.mjs scripts/release-transport.test.mjs scripts/release-worker-source.test.mjs scripts/release-worker-integration.test.mjs scripts/release-checks.test.mjs scripts/release-execution-intake.test.mjs scripts/release-evidence-producer.test.mjs scripts/release-archive-catalog.test.mjs scripts/evidence-delivery-policy.test.mjs scripts/release-workflow.test.mjs scripts/production-target-contract.test.mjs scripts/rama-migration-boundary.test.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-trust-graph-test.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/oidc-regression-initial.log 2>&1; result=$?; grep -E '^(not ok|# tests|# pass|# fail|# cancelled|# skipped|# duration)' /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/oidc-regression-initial.log; exit "$result"

cd /home/ogu-h/Documents/GitHub/FUSOU
env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --test scripts/release-eligibility.test.mjs scripts/release-manifest.test.mjs scripts/release-build.test.mjs scripts/release-consumer.test.mjs scripts/release-transport.test.mjs scripts/release-worker-source.test.mjs scripts/release-worker-integration.test.mjs scripts/release-checks.test.mjs scripts/release-execution-intake.test.mjs scripts/release-evidence-producer.test.mjs scripts/release-archive-catalog.test.mjs scripts/release-archive-http.test.mjs scripts/evidence-delivery-policy.test.mjs scripts/release-workflow.test.mjs scripts/production-target-contract.test.mjs scripts/rama-migration-boundary.test.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-trust-graph-test.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/oidc-regression-final.log 2>&1; result=$?; grep -E '^(not ok|# tests|# pass|# fail|# cancelled|# skipped|# duration)' /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/oidc-regression-final.log; exit "$result"
```

The following exact no-emit command passed **three times**, zero diagnostics.
It performs no Rust/WASM/Worker build or runtime execution:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE packages/FUSOU-TLSN-VERIFICATION-WORKER/node_modules/.bin/tsc --noEmit -p packages/FUSOU-TLSN-VERIFICATION-WORKER/tsconfig.json
```

Static checks: **14 JavaScript files PASS**, **4 YAML files PASS**,
**6 embedded JavaScript bodies compile-only PASS**:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
for file in packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-readback.mjs scripts/release-archive-http.mjs scripts/release-archive-job.mjs scripts/release-archive-http.test.mjs scripts/release-checks.mjs scripts/release-evidence-producer.mjs scripts/release-execution-intake.mjs scripts/release-consumer.mjs scripts/release-transport.mjs scripts/release-worker-source.mjs scripts/release-workflow.test.mjs; do env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --check "$file" || exit; done; printf 'PASS: 14 changed JavaScript files parsed without execution.\n'

cd /home/ogu-h/Documents/GitHub/FUSOU
env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE python3 - <<'PY'
from pathlib import Path
import subprocess
import yaml
paths = ('.github/workflows/tlsn-tag-validation.yml', '.github/workflows/tlsn-release-eligibility.yml', '.github/workflows/tlsn-release-consumer.yml', '.github/workflows/publish_and_create_version_tag.yml')
count = 0
for path in paths:
    document = yaml.safe_load(Path(path).read_text())
    for job in document.get('jobs', {}).values():
        for step in job.get('steps', []):
            body = step.get('with', {}).get('script')
            if body is not None:
                subprocess.run(['node', '-e', 'const fs=require("node:fs");const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;new AsyncFunction(fs.readFileSync(0,"utf8"));'], input=body, text=True, check=True)
                count += 1
print(f'PASS: {len(paths)} workflow YAML files; {count} embedded JavaScript bodies compiled without execution.')
PY
```

All positive OIDC/JWKS/HTTP/API/R2 cases are synthetic. RSA test keys are
ephemeral in-memory test keys generated by JOSE, never persisted or registered;
no Production key/secret was generated. Real GitHub JWT/keys, repository
settings, hosted isolation/permissions, real HTTPS endpoint/authority/R2,
retention and authenticated **real** consumer intake are **NOT_RUN** because
external access is prohibited. Cargo/Rust/WASM/APP/Worker/native build or
execution, official-document network access, deploy/publish/Production
signing, push/PR/tag are **NOT_RUN**. No Hudsucker/default dependency change.
Protected files were not accessed, including by test selectors. The audited
Result byte-binding test remains unmodified.

No real `RELEASE_ARTIFACTS_VALIDATED` or `DEPLOYMENT_VERIFIED` is established.
`publication_authorized: false`, deployment **NOT_CHECKED**, Production
acceptance **BLOCKED** remain in force.

### Scoped local commit and final Git verification

The explicit list is the changed-file inventory. New handler/contract/OIDC
modules and declaration implement the Worker path; the exact JOSE dependency
and lockfile importer support it; readback errors are typed for safe HTTP error
responses. Client/job/check/consumer/transport changes connect the trusted
acquisition and independent intake. Workflow/source/TCB inventories and tests
cover the new boundary. This roadmap is the verification record.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
set -- .github/workflows/tlsn-release-eligibility.yml pnpm-lock.yaml packages/FUSOU-TLSN-VERIFICATION-WORKER/package.json packages/FUSOU-TLSN-VERIFICATION-WORKER/src/index.ts packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-readback.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-readback.d.mts packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http.d.mts scripts/release-archive-http.mjs scripts/release-archive-job.mjs scripts/release-archive-http.test.mjs scripts/release-checks.mjs scripts/release-evidence-producer.mjs scripts/release-execution-intake.mjs scripts/release-consumer.mjs scripts/release-transport.mjs scripts/release-worker-source.mjs scripts/release-workflow.test.mjs docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
git diff --check -- "$@" && git add -- "$@" && git diff --cached --check -- "$@" && git -c commit.gpgsign=false commit --only -m "feat(tlsn): authenticate read-only archive transport with GitHub OIDC" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" -- "$@" > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/oidc-local-commit.log 2>&1; result=$?; tail -n 32 /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/oidc-local-commit.log; exit "$result"
```

The normal scoped pre-commit hook is retained, not bypassed; it analyzes the
explicit commit-only staged blobs in a temporary repository. It is not an
external security/Production verification. After a successful commit the same
explicit `set --` path list is used with:

```sh
git branch --show-current
git rev-parse HEAD HEAD^
git status --short -- "$@"
```

Commit SHA, hook outcome and final branch/scoped-clean result are reported
from the executed commands, not inferred from this record.

## Follow-up: independent archive provenance and automatic grant derivation

### Start and implemented scope

Start branch: `tlsn-first-testplay-candidate`. Actual start HEAD:
`8feb753a93d4803ab102d36f0fc57281ac554cbd`, matching the requested start.
The explicitly inspected task scope was clean. A subsequent scoped status
confirmed the same branch/HEAD and only the eight implementation/test changes
below before this roadmap update. No repository-wide status/diff was used.

| File | Purpose |
| --- | --- |
| [release-archive-provenance.mjs](../../scripts/release-archive-provenance.mjs) | Shared API-authenticated supplemental archive verification and explicit saved-byte online reacquisition |
| [release-grant-provider.mjs](../../scripts/release-grant-provider.mjs) | Compile a non-authorized grant candidate from independent GitHub, pinned policy and authority inputs |
| [release-execution-intake.mjs](../../scripts/release-execution-intake.mjs) | Reuse trusted implementation verification and include the new runtime modules in the source TCB |
| [release-consumer.mjs](../../scripts/release-consumer.mjs) | Use the shared verifier, expose the precise provenance scope, and reject unregistered dynamic grant publication |
| [release-archive-job.mjs](../../scripts/release-archive-job.mjs) | Wire opt-in candidate derivation, without issuing a successful archive check or execution origin |
| [release-evidence-producer.mjs](../../scripts/release-evidence-producer.mjs) | Prevent dynamic-provider policy from falling back to a successful static-grant path |
| [release-provenance-fixture.mjs](../../scripts/release-provenance-fixture.mjs) | Key-free local API/authority/HTTP doubles, not a real OIDC or service identity fixture |
| [release-provenance-grant.test.mjs](../../scripts/release-provenance-grant.test.mjs) | Provenance, independent expectation, grant derivation, replay, no-fallback and fail-closed contracts |
| This roadmap | Contracts, bounded guarantees, exact validation commands and unresolved inputs |

No workflow permissions, Worker routes, authority writes, Production
configuration, trust pins, dependencies or secrets were changed in this step.
The existing archive-only OIDC job and release eligibility gates remain.

### Report provenance: online authentication, not a detached signature

The producer is the trusted release workflow, which produces the archive
check/origin after its authenticated HTTPS acquisition. The consumer obtains
both primary and supplemental artifacts through authenticated GitHub
run/artifact metadata and HTTPS download, verifies the API archive digest, and
requires the exact same `release-report.json` bytes in both artifacts. Existing
input pins, live eligibility, source/run/attempt, execution subject/receipt,
trusted-main ancestry and implementation blob parity remain required.

`authenticateArchiveSupplement` is now the single shared implementation for
this boundary. It eagerly authenticates the archive origin before a missing
native check can stop the final release decision. The existing label
`AUTHENTICATED_PRODUCER_REPORT_VERIFIED` is retained **only** for this online,
trusted-workflow acquisition boundary. It is not evidence of a consumer-side
JWT signature verification, job-specific cryptographic attestation,
retention, or TLSN/native cryptographic verification.

`reauthenticateSavedArchive` makes subsequent verification explicit:

1. Its caller supplies independent repository ID, producer run/attempt,
   workflow SHA, trusted implementation SHA, release source SHA and validation
   run/attempt, plus the existing independently pinned public/check inputs.
   These must not be sourced from the saved report's own claims.
2. It reacquires live run, eligibility and both artifact identities/bytes
   using the existing authenticated GitHub adapter.
3. It applies the same producer/build/source/receipt/raw archive checks and
   rechecks both artifact metadata records after verification.
4. The saved six input files must match the reacquired input inventory and
   exact bytes. Missing/changed saved inputs are rejected.

The returned `archive_provenance` records
`verification_mode: GITHUB_API_REACQUISITION`,
`offline_signature_verification: NOT_IMPLEMENTED`,
`archive_integrity: RAW_VERSION_SIZE_DIGEST_CHECKED` and
`consumer_native_crypto_reexecution: NOT_CHECKED`, together with repository,
workflow/run/source, artifact identities and report/receipt/input digests.
This record is an observation of the verification invocation, **not** a
signature or transferable capability. Serialized JSON or an
`authenticated: true` field alone cannot authenticate it. The existing private
transport proof is process-local and must be minted again on reacquisition.
Authentication remains at the trusted workflow/run artifact boundary; GitHub
artifact metadata is not represented as a job-specific signed assertion.

### GitHub Artifact Attestations decision

Not adopted in this change. The existing online trust boundary can verify the
report's producer and exact content without adding a second signature scheme.
It does not solve detached offline report authentication. Scoped inspection
found no registered attestation action, verifier/root contract or dependency
in this release path. Repository visibility is **UNKNOWN**; feature
availability, attestation retrieval, verifier version/source and trust roots
are **UNVERIFIED** because external access is prohibited.

No `attestations: write`, action, key or custom signature protocol was added.
A self-asserted attestation, even one claiming the right subject, is not a
fallback: an unregistered attestation verification mode is rejected. The
wrong-subject/wrong-signer tests exercise that refusal only, **not** Sigstore
signature, certificate or transparency verification. Actual attestation
cryptographic verification remains **NOT_IMPLEMENTED** in this path and was
**NOT_RUN**.

### Automatic grant compiler and the remaining provider boundary

The existing independently pinned check public input can opt into
`grant_provider` with:

- `schema_version: 1`, `scope: fusou-release-grant-provider-v1`;
- `template`: the existing dedicated endpoint/OIDC bootstrap policy, with
  **no** `grants` field;
- `grant_ttl_ms`: positive and at most 600000;
- independently specified `capture_not_before_ms`, `capture_max_age_ms`;
- `subject.canonical_user_id` and `subject.device_id` for the existing
  authority lookup.

This is an additional public-input **contract**, not an installed Production
pin. Its outer trust root remains the existing independently configured
`FUSOU_RELEASE_CHECK_INPUTS_SHA256`. Endpoint/audience, repository ID and
workflow bootstrap identity cannot be learned from the request or report.
No new real values were guessed or registered.

The compiler requires the authenticated primary artifact capability, a fresh
GitHub producer run/attempt and trusted workflow implementation, live
release/validation eligibility, independent public/check pins, matching report
input identity, and the independently pinned archive/capture policy. It then
uses the existing direct, read-only consumed-authority interface to resolve
the catalog using the pinned session/user/device/job lookup. It checks
source/capture/session/job/attempt/binding, current expected object keys,
versions/digests/optional sizes, Result envelope digest and catalog freshness.
The existing consumed state/catalog transaction is not bypassed or rewritten.

The coordinator derives a candidate scope and short lifetime from these
inputs and its clock, rather than from producer `PASS` or request
`authenticated` fields. Output is explicitly
`DERIVED_NOT_AUTHORIZED`, `publication_authorized: false`, and
`ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED`. The candidate's hash
does not make it a new trust root.

**NOT_IMPLEMENTED / BLOCKED_IMPLEMENTATION:**

- `ARCHIVE_GRANT_AUTHORITY_READER_NOT_REGISTERED`: the Actions job does not
  have a registered, independently authenticated bridge to read the existing
  authority state. A direct injected test authority is not that bridge.
- `ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED`: there is no approved
  authenticated path to publish a coordinator/authority-derived grant into
  the endpoint's independently trusted authorization policy/provider.

The job can package a local candidate when a trusted direct reader is
injected; the real workflow does not inject one. Neither that candidate nor
its artifact authorizes HTTP reads. With `grant_provider` selected, job,
producer, consumer and saved-byte verifier fail closed; they do not fall
back to static grants, mint a successful archive check or issue a positive
execution origin. This does not introduce a per-release human approval
requirement, and manually registering each candidate is not the implemented
solution. A real provider requires a separately established authenticated
authority-read and grant-publication contract plus one-time public bootstrap
configuration.

### End-to-end and replay guarantees

Existing endpoint: `POST /internal/tlsn/archive-readback/v1`, read-only despite
POST. GitHub OIDC authenticates that HTTP caller separately from coordinator
and artifact authentication. Issuer remains exactly
`https://token.actions.githubusercontent.com`, fixed GitHub JWKS, RS256, and
audience exactly the independently configured dedicated HTTPS endpoint.
Repository/workflow/run claims and independent grant policy are still
required; `workflow_sha` is not the release source SHA. No OIDC token is
stored in the report, fixture artifact or provenance record.

The endpoint resolves permitted keys from authority catalog state, checks
current object version/size/raw digest, and returns evidence for independent
consumer checks. No arbitrary key, list, write or delete API was added.
The online consumer connection is implemented. The **dynamic** chain stops
before authorization at the two provider boundaries above; no real grant was
issued, no endpoint was contacted and no real archive was accepted.

Run/attempt/source/capture/lookup and lifetime mismatch is rejected. Expiry is
exclusive at `expires_at_ms`; future grants are rejected. Same-scope
idempotent re-verification is retained, not relabeled global one-use replay
prevention. There is no new one-use consumption ledger.

R2 `version` remains an opaque current-object metadata equality check plus
raw size/digest. Compiler catalog observations are not real R2 readback.
Historical generation retrieval remains **NOT_IMPLEMENTED**. Overwrite/delete
prevention, immutability and retention remain **NOT_CHECKED**; version equality
does not establish any of them.

| Existing check | Local contract state | Real evidence in this step |
| --- | --- | --- |
| `locked_dependencies` | Existing assertions preserved; key-free regression PASS | **UNVERIFIED**, not acquired/executed |
| `compiled_inputs` | Existing assertions preserved; formal native blocker retained | **UNVERIFIED**, native build identity contract **NOT_IMPLEMENTED** |
| `archive_readback` | Mock raw/version/size/digest/HTTP/provenance contracts PASS | **UNVERIFIED**, no real OIDC/R2/provider configuration checked |
| `offline_verification` | Existing receipt/check assertions preserved; no mock launcher | **UNVERIFIED**, formal native producer remains blocked |

`FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED` is retained even when local
archive provenance or candidate compilation succeeds. Synthetic reports do
not establish real `RELEASE_ARTIFACTS_VALIDATED` or `DEPLOYMENT_VERIFIED`.
`publication_authorized: false`, deployment **NOT_CHECKED**, Production
acceptance **BLOCKED** remain unchanged.

### Exact local validation commands and results

All commands below run from `/home/ogu-h/Documents/GitHub/FUSOU`. Side effects
were checked before execution: explicit Node test selectors use API, process,
authority and HTTP doubles; they do not execute release artifacts, services,
Worker/native code, Cargo/Rust/WASM/APP builds or key generation. Syntax
checks parse without evaluation. The TypeScript command is no-emit only.
Existing dependencies were reused; no install/package script was run.
Read-only source investigation used scoped `view`/`rg` calls.

1. Initial targeted run: **118 PASS, 0 FAIL, 0 cancelled, 0 skipped**.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --test scripts/release-provenance-grant.test.mjs scripts/release-execution-intake.test.mjs scripts/release-evidence-producer.test.mjs scripts/release-consumer.test.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/grant-provenance-targeted-initial.log 2>&1; result=$?; grep -E '^(not ok|# tests|# pass|# fail|# cancelled|# skipped|# duration)' /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/grant-provenance-targeted-initial.log; exit "$result"
```

2. First expanded regression: **336 PASS, 0 FAIL, 0 cancelled, 0 skipped**.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --test scripts/release-eligibility.test.mjs scripts/release-manifest.test.mjs scripts/release-build.test.mjs scripts/release-consumer.test.mjs scripts/release-transport.test.mjs scripts/release-worker-source.test.mjs scripts/release-worker-integration.test.mjs scripts/release-checks.test.mjs scripts/release-execution-intake.test.mjs scripts/release-evidence-producer.test.mjs scripts/release-archive-catalog.test.mjs scripts/release-provenance-grant.test.mjs scripts/evidence-delivery-policy.test.mjs scripts/release-workflow.test.mjs scripts/production-target-contract.test.mjs scripts/rama-migration-boundary.test.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-trust-graph-test.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/grant-provenance-regression.log 2>&1; result=$?; grep -E '^(not ok|# tests|# pass|# fail|# cancelled|# skipped|# duration)' /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/grant-provenance-regression.log; exit "$result"
```

3. Syntax-only check: **PASS, eight changed JavaScript modules**.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && for file in scripts/release-archive-provenance.mjs scripts/release-grant-provider.mjs scripts/release-provenance-fixture.mjs scripts/release-provenance-grant.test.mjs scripts/release-execution-intake.mjs scripts/release-archive-job.mjs scripts/release-evidence-producer.mjs scripts/release-consumer.mjs; do env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --check "$file" || exit; done; printf 'PASS: 8 changed JavaScript modules syntax-checked without evaluation.\n'
```

4. Worker static type check: **PASS**, no emit/build/runtime execution.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE packages/FUSOU-TLSN-VERIFICATION-WORKER/node_modules/.bin/tsc --noEmit -p packages/FUSOU-TLSN-VERIFICATION-WORKER/tsconfig.json
```

5. After adding seven explicit replay/no-fallback/native-blocker assertions,
   final syntax check and expanded regression: **343 PASS, 0 FAIL,
   0 cancelled, 0 skipped**. This includes 40 new key-free tests and the
   existing 303-test regression. There were **no failing runs** in this step.
   Source/test additions strengthened coverage rather than weakening an
   assertion or hiding a failure.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --check scripts/release-provenance-grant.test.mjs && env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --test scripts/release-eligibility.test.mjs scripts/release-manifest.test.mjs scripts/release-build.test.mjs scripts/release-consumer.test.mjs scripts/release-transport.test.mjs scripts/release-worker-source.test.mjs scripts/release-worker-integration.test.mjs scripts/release-checks.test.mjs scripts/release-execution-intake.test.mjs scripts/release-evidence-producer.test.mjs scripts/release-archive-catalog.test.mjs scripts/release-provenance-grant.test.mjs scripts/evidence-delivery-policy.test.mjs scripts/release-workflow.test.mjs scripts/production-target-contract.test.mjs scripts/rama-migration-boundary.test.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-trust-graph-test.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/grant-provenance-regression-final.log 2>&1; result=$?; grep -E '^(not ok|# tests|# pass|# fail|# cancelled|# skipped|# duration)' /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/grant-provenance-regression-final.log; exit "$result"
```

The existing OIDC crypto suite
[release-archive-http.test.mjs](../../scripts/release-archive-http.test.mjs)
is **NOT_RUN** in this step: its top-level `generateKeyPair` violates the
current prohibition on *all* key generation. Import/name-filtering it would
still generate keys. It is not modified or skipped internally.
The new tests use no key-generating fixture; the OIDC adapter double verifies
only that a claimed successful authentication cannot replace a missing or
wrong run grant. They do not test a real JWT signature. The key-generating
APP reference fixture is also **NOT_RUN**.

Real GitHub API/OIDC/Artifact Attestations, Cloudflare/R2/Notary/Session
Authority calls, CI dispatch, build/native execution, Production signing/
configuration/registration, deploy/publish, push/PR/tag are **NOT_RUN**.
No protected file was read, searched, compared, hashed, edited or included in
the commit scope. The previously audited byte-binding test is unchanged.

### Scoped metadata checks and local commit procedure

The actual pre-documentation metadata check was:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git branch --show-current && git rev-parse HEAD && git -c core.fsmonitor=false status --short --untracked-files=all -- scripts/release-archive-provenance.mjs scripts/release-grant-provider.mjs scripts/release-provenance-fixture.mjs scripts/release-provenance-grant.test.mjs scripts/release-execution-intake.mjs scripts/release-archive-job.mjs scripts/release-evidence-producer.mjs scripts/release-consumer.mjs docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md && tail -n 110 docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
```

Result: **PASS**, expected branch/HEAD and four modified/four new Node files;
the roadmap was then unmodified. The normal hook was inspected before use:
it reads only commit-index allowlisted blobs, materializes an isolated
temporary repository, and invokes local `code-review-graph update` and
`detect-changes --brief`. It is not an independent security/Production audit.
The explicit `commit --only` scope below prevents unrelated staged changes
from entering that hook or commit. Hook bypass and signing are not used.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
set -- scripts/release-archive-provenance.mjs scripts/release-grant-provider.mjs scripts/release-provenance-fixture.mjs scripts/release-provenance-grant.test.mjs scripts/release-execution-intake.mjs scripts/release-archive-job.mjs scripts/release-evidence-producer.mjs scripts/release-consumer.mjs docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
git diff --check -- "$@" && git add -- "$@" && git diff --cached --check -- "$@" && git -c commit.gpgsign=false commit --only -m "feat(release): reauthenticate archive provenance and derive scoped grant candidates" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" -- "$@" > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/grant-provenance-local-commit.log 2>&1; result=$?; tail -n 30 /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/grant-provenance-local-commit.log; exit "$result"
```

After the successful commit, reuse the exact nine-path `set --` list with:

```sh
git branch --show-current
git rev-parse HEAD HEAD^
git -c core.fsmonitor=false status --short --untracked-files=all -- "$@"
git diff --check HEAD^ HEAD -- "$@"
```

The actual hook/commit exit result, final commit SHA/parent and scoped-clean
state are reported from these commands, not inferred or pre-authorized by
this procedure. No real release/deployment acceptance is established by a
local commit.

## Follow-up: authority grant authorization feasibility and fail-closed boundaries

### Start state and stop decision

Requested and actual start branch: `tlsn-first-testplay-candidate`.
Requested and actual start HEAD:
`cc2434f721977dca87859f7b06acedcb59745a2e`. The explicit initial source,
workflow, fixture/test and roadmap scope was clean.

**The existing contracts are insufficient to implement authorized grant
issuance. Authorization/publication implementation stops here under the
requested stop condition.** This is not a completed authority-backed grant
provider. Existing blockers remain:

- `ARCHIVE_GRANT_AUTHORITY_READER_NOT_REGISTERED`
- `ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED`
- `FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED`

The first blocker refers to the missing independently authenticated
Actions-to-authority bridge, not absence of the internal catalog reader.
The second includes missing authorization inputs and authorized-grant
protocol/state, not merely a missing HTTP client.

### Evidence for the authorization boundary

| Role | Existing source and actual guarantee | Missing for grant authorization |
| --- | --- | --- |
| Authenticated Actions caller | [archive-oidc.mjs](../../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc.mjs) verifies fixed GitHub issuer/JWKS, RS256, dedicated audience and repository/workflow/run claims | Claims do not attest live tag eligibility, release source or independent release/capture policy approval |
| Trusted coordinator | [release-eligibility.mjs](../../scripts/release-eligibility.mjs), [release-execution-intake.mjs](../../scripts/release-execution-intake.mjs) and [workflow](../../.github/workflows/tlsn-release-eligibility.yml) use authenticated GitHub metadata, main history/workflow parity, run/attempt and independent input pins | These checks run in Actions/consumer; their private process-local proof cannot be serialized as an authority-verifiable approval |
| Existing authority | [binding_authority.ts](../../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/binding_authority.ts) stores consumed binding, exact Result, optional receipt and catalog together | No repository/workflow/run/eligibility approval record, independent release-input/capture-policy authorization record or approved ingestion interface |
| Internal catalog reader | [archive-catalog.mjs](../../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-catalog.mjs) resolves the consumed Result/catalog by binding and exact session/user/device/job; validates catalog/Result/receipt consistency | This is capture state, not authorization for a GitHub release/run to consume it |
| Candidate compiler | [release-grant-provider.mjs](../../scripts/release-grant-provider.mjs) independently checks GitHub/pinned inputs and reads catalog through an injected trusted direct reader | Output remains `DERIVED_NOT_AUTHORIZED`; no independently authenticated remote authorization decision/publisher |
| HTTP provider | [archive-http.mjs](../../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http.mjs) reads only after OIDC and a matching independently pinned static grant | No authorize/publish/grant-state read API; using this endpoint to obtain its own prerequisite grant is circular |
| Consumer | [release-archive-provenance.mjs](../../scripts/release-archive-provenance.mjs), [release-consumer.mjs](../../scripts/release-consumer.mjs) authenticate online GitHub artifacts and verify raw evidence against independent pins | No authorized grant artifact/state acquisition contract, issuer verification, revocation or grant-state recheck protocol |

Authority `BindingRecord`, `CommitVerifiedResultInput` and consumed lookup
contain binding/session/user/device/job/attempt/Result/archive information,
not an authenticated GitHub release authorization decision. Its HTTP switch
and internal RPC interface have no grant authorize/publish/read operation.
The Worker passes its independently configured static transport policy to
the existing read-only handler; no provider injection appears in the trusted
archive job. Scoped inspection found no release public-input JSON in the
scripts directory and no archive grant provider registration in the inspected
Worker configuration. External settings were **NOT_CHECKED**, not assumed
absent or registered.

OIDC authenticates a caller, but existing policy does not delegate to that
caller the power to install its own candidate as an authorization policy.
Candidate `candidate_policy` is structurally a transport spec; its computed
digest is not an independent authorization root. Copying it into Worker or
consumer pins would be a new trust decision, not successful independent
verification. Catalog writer binding names identify internal storage roles;
they are not a signed grant issuer identity. Origin Inventory, Target
Approval and Runtime Config do not define delegation for GitHub grant
publication and were not repurposed for it.

The authority could serve as a scoped internal catalog reader, as it already
does. It cannot be declared a grant authorizer merely because it owns that
catalog. No new authority, secret, signature domain, approval endpoint or
Production pin is introduced to hide this distinction.

### Grant schema, state transitions and concurrency limits

Existing transport policy v1 scopes static grants by workflow/source SHA,
run/attempt, capture/binding/verification attempt, exact subject/job lookup,
capture age and validity window. The policy has an independent pin and OIDC
bootstrap identity. Candidate v1 additionally records input/capture-policy/
catalog/artifact/object/Result/receipt bindings and explicitly blocks
publication.

An **authorized persisted grant** wire/storage protocol is not defined:
grant ID/schema, authenticated issuer, authorization-state/policy revision,
release-input identity, raw grant bytes/digest, revocation and compare-and-set
identity are not required/verified as one issued grant record. Their absence
is a protocol blocker. No guessed `AUTHORIZED` record or RPC was added.

Actual state transition remains:

```text
independent GitHub metadata + pinned inputs + consumed capture catalog
  -> DERIVED_NOT_AUTHORIZED candidate
  -> BLOCKED_IMPLEMENTATION (no registered authorization/publication provider)
```

Existing Result/catalog writes and consumed reads use authority storage
transactions. Same consumed-capture retries compare stored identity,
generation, bytes/receipt/catalog; changed targets are rejected. Those
transactions do **not** span coordinator GitHub I/O or a grant publication
decision. A future approved issuer would need independently verified
authorization inputs and a versioned authority/policy snapshot revalidated
at atomic persistence (or equivalent approved CAS), with consumer-visible
state identity. External I/O must not be held inside that storage transaction.
This describes a missing contract, not an implemented CAS design.

Same-scope candidate derivation at a fixed clock is deterministic and
read-only, including concurrent identical calls in the local double. This
does not test concurrent grant authorization or guarantee atomic publication.
No global one-use ledger is added. Existing static-grant expiry remains
exclusive at `expires_at_ms`; wrong scope/run/attempt/source and future/expired
grants remain rejected. Revoked authorized-grant handling is
**NOT_IMPLEMENTED**, not reported as passing a test.

### Implemented fail-closed correction

An independently pinned policy can contain `grant_provider: null`, `false`,
`0` or `""`. The previous truthiness checks treated those present but invalid
values like an omitted field and could attempt legacy static HTTP acquisition.
Also, the exported low-level check verifier lacked the provider gate, even
though its higher-level consumer rejected a truthy provider.

The shared [release-checks.mjs](../../scripts/release-checks.mjs) now detects
the **presence of the own `grant_provider` field**, not its truthiness:

- [release-archive-job.mjs](../../scripts/release-archive-job.mjs) routes a
  present provider to the candidate-only branch. Missing/invalid provider
  input does not produce a candidate, archive check or positive origin.
- [release-evidence-producer.mjs](../../scripts/release-evidence-producer.mjs),
  [release-consumer.mjs](../../scripts/release-consumer.mjs) and the
  [saved-byte verifier](../../scripts/release-archive-provenance.mjs) reject
  the unregistered provider before static-grant fallback.
- The independent `archive_readback` check also enforces the gate before
  archive/native authentication callbacks. `locked_dependencies` and
  `compiled_inputs` keep their existing verification behavior; native
  verification cannot bypass the missing verified archive.

Only omission preserves the existing static-policy path. Scalars are not a
new disable flag. No authority runtime/storage/interface, authorization
schema, source inventory, workflow permission, provider registration or
dependency was changed.

### Contract-test coverage versus unavailable authorization tests

Eight new key-free tests in
[release-provenance-grant.test.mjs](../../scripts/release-provenance-grant.test.mjs)
cover four malformed provider settings across job/producer/consumer/saved
verification, two independent low-level verifier refusal cases, candidate/
self-asserted authorization HTTP bodies, and concurrent candidate-only
derivation without authority writes. Authentication/transport/authority are
explicit local doubles; token/archive tripwires throw rather than connecting.

Existing candidate/static-readback/catalog tests still cover independent
repository/workflow/run/source/input pins, session/job/attempt/binding,
generation/raw size/digest, stale captures, unknown/expired grants,
idempotent consumed-state readback and changed-content rejection. The
mock authority catalog suite checks rollback of Result/catalog writes and
does not instantiate a deployed Durable Object.

| Requested behavior | Result and exact scope |
| --- | --- |
| Candidate or `PASS` / `authenticated: true` alone becomes authorization | **PASS refusal**, no issued grant; extra candidate/authorization HTTP fields rejected before authority/R2 reads |
| Provider/reader/trust input missing; invalid provider selects static fallback | **PASS refusal**, candidate/provider blockers maintained, no token acquisition or successful archive execution record |
| Identity/input/capture/version/size/digest mismatch; unknown/expired scope | Existing local candidate/static-reader/catalog contracts **PASS**, not authorized-grant protocol tests |
| Same candidate scope/content, including concurrent calls | **PASS candidate-only idempotence**, no authorization state writes |
| Only independently authorized candidates get persisted grants | **NOT_IMPLEMENTED / NOT_RUN**, issuer trust-input and issued-grant protocol missing |
| Conflicting issued grants, state change between authorization read and publish, atomic CAS | **NOT_IMPLEMENTED / NOT_RUN**, no publication transition to exercise |
| Unknown/revoked authorized grant state or independently fetched issued grant bytes | **NOT_IMPLEMENTED / NOT_RUN**, no issued-grant reader/protocol; static expiry tests are not a substitute |
| Grant authentication proves native/TLSN cryptography or retention | No such promotion; existing native blocker and retention limits maintained |

### Required inputs before a real provider can be connected

These are explicit unresolved contracts, not requests for per-release manual
approval:

1. An approved way for the existing authority to independently obtain or
   authenticate coordinator run/attempt, live tag eligibility, source SHA
   and pinned release/capture policy identity. Existing Actions-local proof
   cannot be submitted as authenticated JSON.
2. An independently authorized delegation/policy specifying who may publish
   a grant, which capture lookup they may use, and which immutable
   authorization/policy revision is checked during persistence. OIDC identity
   or a consumed capture alone does not provide that delegation.
3. An approved issued-grant storage/wire and scoped authenticated read
   interface, with issuer/state identity, exact bytes/digest, lifetime and
   revocation/conflict semantics. Reusing the existing catalog transaction
   requires this decision, not just an added storage key.
4. One-time independently registered public bootstrap inputs: existing
   endpoint/audience, repository ID, trusted workflow/revision policy,
   provider/authority identity and independent policy roots. New real values
   are not guessed, and their registration alone would not implement the
   missing protocol.

Once those contracts exist, run/attempt, live eligibility/source, capture
metadata/digests and short-lived grants can be derived automatically; the
same hostname allowlist must not become a per-release approval task.
Absent the inputs above, neither candidate hashes nor producer records can
authorize the missing state transition.

After future approved source integration and bootstrap, separate real
observations would still be required: authenticated OIDC claims and GitHub
metadata, persisted authority grant/read consistency and concurrency, exact
current R2 version/bytes, consumer reacquisition and native/TLSN evidence.
None was performed here. This step does not claim provider readiness from
local configuration or synthetic artifacts.

R2 continues to mean current version equality plus raw size/digest only.
Historical retrieval is **NOT_IMPLEMENTED**; overwrite/delete prevention,
immutability and retention are **NOT_CHECKED**. Report provenance remains
online GitHub metadata/artifact digest/trusted workflow verification:
`AUTHENTICATED_PRODUCER_REPORT_VERIFIED` is not detached signature verification
or native reexecution.

| Check | Existing local assertions | Real evidence this step |
| --- | --- | --- |
| `locked_dependencies` | Preserved, regression **PASS** | **UNVERIFIED** |
| `compiled_inputs` | Preserved, regression **PASS** | **UNVERIFIED**, no build executed |
| `archive_readback` | Strengthened provider refusal, regression **PASS** | **UNVERIFIED**, dynamic provider **BLOCKED** |
| `offline_verification` | Archive prerequisite and native blocker preserved | **UNVERIFIED**, `FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED` |

Formal native launcher/build identity/builder provenance remains outside this
step. `publication_authorized: false`, deployment **NOT_CHECKED**, Production
acceptance **BLOCKED** remain unchanged. No real
`RELEASE_ARTIFACTS_VALIDATED` or `DEPLOYMENT_VERIFIED` is established.

### Exact commands, failures, corrections and results

All shell commands in this follow-up are recorded below. Scoped source reads,
searches and config filename discovery used `view`/`rg`/`glob`, not broad
repository scans. Before tests, the key-free fixture/import path and local
tripwires were inspected. Existing regression selectors/fixtures were
previously inspected and checked for unexpected task-scope changes before
reuse. There is no key generation, external service access, real native
execution, Worker runtime or Cargo/Rust/WASM/APP build in these selectors;
Worker source/import checks use parse-only Node processes and mock data.

**1. Start metadata: PASS**, expected branch/HEAD, scoped status empty.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git branch --show-current && git rev-parse HEAD && git -c core.fsmonitor=false status --short --untracked-files=all -- scripts/release-grant-provider.mjs scripts/release-archive-provenance.mjs scripts/release-execution-intake.mjs scripts/release-consumer.mjs scripts/release-archive-http.mjs scripts/release-archive-job.mjs scripts/release-evidence-producer.mjs scripts/release-execution-origin.mjs scripts/release-transport.mjs scripts/release-checks.mjs scripts/release-provenance-fixture.mjs scripts/release-provenance-grant.test.mjs scripts/release-worker-source.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/binding_authority.ts packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-catalog.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/result_archive.ts packages/FUSOU-TLSN-VERIFICATION-WORKER/src/index.ts .github/workflows/tlsn-release-eligibility.yml docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
```

**2. Red reproduction: FAIL, 48 tests, 41 PASS / 7 FAIL / 0 cancelled /
0 skipped.** Four malformed-provider cases reached the throwing token-request
tripwire; two low-level checks incorrectly resolved instead of rejecting.
The seventh failure was in the newly added snapshot comparison: Node
`structuredClone(Buffer)` produces `Uint8Array`, so comparing the original
fixture Buffer subtype to the cloned expectation failed despite identical
bytes. Both snapshots are now normalized by the same cloning operation;
all state fields and exact bytes remain compared. Product changes fixed
provider presence detection and added the low-level gate. No assertion was
removed, weakened or skipped.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --test scripts/release-provenance-grant.test.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/authority-grant-red.log 2>&1; result=$?; grep -E '^(not ok|# tests|# pass|# fail|# cancelled|# skipped|# duration)' /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/authority-grant-red.log; exit "$result"
```

**3. Corrected targeted regression: PASS, 125 PASS / 0 FAIL / 0 cancelled /
0 skipped.**

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --test scripts/release-provenance-grant.test.mjs scripts/release-checks.test.mjs scripts/release-execution-intake.test.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/authority-grant-targeted.log 2>&1; result=$?; grep -E '^(not ok|# tests|# pass|# fail|# cancelled|# skipped|# duration)' /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/authority-grant-targeted.log; exit "$result"
```

**4. Regression selector/fixture metadata: PASS**, only this task's changed
provenance/grant test was dirty.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git -c core.fsmonitor=false status --short --untracked-files=all -- scripts/release-eligibility.test.mjs scripts/release-manifest.test.mjs scripts/release-build.test.mjs scripts/release-consumer.test.mjs scripts/release-transport.test.mjs scripts/release-worker-source.test.mjs scripts/release-worker-integration.test.mjs scripts/release-checks.test.mjs scripts/release-execution-intake.test.mjs scripts/release-evidence-producer.test.mjs scripts/release-archive-catalog.test.mjs scripts/release-provenance-grant.test.mjs scripts/evidence-delivery-policy.test.mjs scripts/release-workflow.test.mjs scripts/production-target-contract.test.mjs scripts/rama-migration-boundary.test.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-trust-graph-test.mjs scripts/release-check-fixture.mjs scripts/release-consumer-fixture.mjs scripts/release-provenance-fixture.mjs
```

**5. Parse-only static check: PASS**, six changed JavaScript files.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && for file in scripts/release-checks.mjs scripts/release-archive-provenance.mjs scripts/release-consumer.mjs scripts/release-evidence-producer.mjs scripts/release-archive-job.mjs scripts/release-provenance-grant.test.mjs; do env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --check "$file" || exit; done; printf 'PASS: 6 changed JavaScript modules parsed without evaluation.\n'
```

**6. Final expanded regression: PASS, 351 PASS / 0 FAIL / 0 cancelled /
0 skipped**, 17 explicit files, previous 343 tests preserved plus eight new.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --test scripts/release-eligibility.test.mjs scripts/release-manifest.test.mjs scripts/release-build.test.mjs scripts/release-consumer.test.mjs scripts/release-transport.test.mjs scripts/release-worker-source.test.mjs scripts/release-worker-integration.test.mjs scripts/release-checks.test.mjs scripts/release-execution-intake.test.mjs scripts/release-evidence-producer.test.mjs scripts/release-archive-catalog.test.mjs scripts/release-provenance-grant.test.mjs scripts/evidence-delivery-policy.test.mjs scripts/release-workflow.test.mjs scripts/production-target-contract.test.mjs scripts/rama-migration-boundary.test.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-trust-graph-test.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/authority-grant-regression.log 2>&1; result=$?; grep -E '^(not ok|# tests|# pass|# fail|# cancelled|# skipped|# duration)' /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/authority-grant-regression.log; exit "$result"
```

**7. Roadmap append anchor inspection: PASS**, only the final 18 lines.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && tail -n 18 docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
```

The key-generating OIDC crypto suite and APP reference fixture are
**NOT_RUN**; no import/name filter was used to execute their top-level key
generation. Worker TypeScript type check is **NOT_RUN this step** because no
TypeScript or Worker runtime contract changed; the previous step's result is
not counted as a current run. Authorized-grant positive/state-transition/
revocation/CAS tests are **NOT_RUN** for the missing-contract reasons above.
Real GitHub/OIDC/attestation/Cloudflare/R2/Notary/Session Authority, native
producer, CI, build, deploy/publish, Production signing/registration, new
keys/secrets and push/PR/tag are **NOT_RUN**.

Protected files and the previously audited Result byte-binding test were
not accessed/changed. No dependency restore or package scripts were run.

### Scoped local commit and final metadata verification

The seven-file commit scope is five Node implementation files, the existing
key-free test file and this roadmap. The normal scoped hook was inspected:
it rejects protected staged paths, reads only commit-index allowed blobs and
runs local AST graph analysis in a temporary repository. `commit --only`
isolates that scope; the hook is not bypassed and commit signing is disabled.
Its graph output is not an independent authorization or Production audit.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
set -- scripts/release-checks.mjs scripts/release-archive-provenance.mjs scripts/release-consumer.mjs scripts/release-evidence-producer.mjs scripts/release-archive-job.mjs scripts/release-provenance-grant.test.mjs docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
git diff --check -- "$@" && git add -- "$@" && git diff --cached --check -- "$@" && git -c commit.gpgsign=false commit --only -m "fix(release): fail closed on declared archive grant providers" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" -- "$@" > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/authority-grant-local-commit.log 2>&1; result=$?; tail -n 30 /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/authority-grant-local-commit.log; exit "$result"
```

The same exact seven-path list is used for final verification:

```sh
git branch --show-current
git rev-parse HEAD HEAD^
git -c core.fsmonitor=false status --short --untracked-files=all -- "$@"
git diff --check HEAD^ HEAD -- "$@"
```

Actual hook/commit result, final branch/commit/parent and scoped-clean status
are reported from the executed commands, not inferred from this procedure.
No authorized grant, real release or deployment acceptance is established by
the commit.

## Follow-up: grant authority delegation ADR

Start branch: `tlsn-first-testplay-candidate`. Actual start HEAD:
`b917fd2cdf3b56b644ade1271d01e8bf4c807d69`, matching the requested HEAD.
The explicit source/workflow/test/roadmap start scope and the subsequent
two-document scope were clean.

Added [ADR: TLSN Grant Authority Delegation](../architecture/adr-tlsn-grant-authority-delegation.md).
Scoped filename inspection found no existing ADR/decision document; the
existing architecture directory is used alongside its earlier TLSN contract.
Only the new ADR and this roadmap are changed. There are no runtime,
workflow, policy, inventory, provider, dependency or trust-pin edits.

### Decision, independent inputs and unresolved protocol

**Recommendation: Option A**, conditional on explicit one-time delegation
approval and closure of the ADR's `UNDEFINED_CONTRACT` rows. A dedicated
immutable-revision reusable workflow is the sole delegated eligibility
principal; the existing authority is the final authorizer/durable issuer.
This is a proposed trust delegation, **not approved or registered policy**.
OIDC job identity is not evidence of arbitrary successful steps.

The ADR compares A/B/C on authorization roots, independent verification,
reuse/new requirements and risks. A can reuse Actions-side authenticated
GitHub eligibility checks without introducing authority-side GitHub
credentials. B remains conditional on genuine independent authority
reverification, not serialized process-local proof. C adds a new actor/root
without solving the missing contract and is not selected.

Eight assurance boundaries remain distinct: caller identity, eligibility,
catalog read, grant decision, durable grant state, consumer reacquisition,
raw archive verification and native/TLSN cryptography. The source audit
identifies actual exports/paths and current static-policy restrictions.

The ADR contains:

- 14 bootstrap rows separating source-known issuer/algorithms/caller paths
  and input/inventory mechanisms from unverified real endpoint/deployment,
  repository/owner IDs, delegated workflow revision, public policy roots,
  grant roles/lifetime/revocation and read-path registration.
- 13 semantic grant requirements, a candidate-to-durable-to-reader state
  model, immutable bytes versus mutable revocation revision, idempotent retry
  without lifetime extension, conflict rejection and local transaction/CAS
  requirements. Exact wire schema/IDs/endpoints/digest domains are not invented.
- 12 explicit `UNDEFINED_CONTRACT` rows covering claim semantics/job
  isolation, delegation policy, automatic per-release input derivation,
  capture selection, deployment/state epoch, issue/read protocol, scope/
  encoding, revisions/revocation, freshness, cross-run readers, acquisition
  proof and migration/real acceptance.
- Separation of external GitHub/OIDC I/O from authority transactions and
  revalidation at commit/read/final consumer acceptance. No claim of an
  atomic transaction across GitHub and Durable Object state.

Current check/public input hashes include release-specific values; manually
repinning them each release is not the proposed automation. A stable approved
derivation policy and independently authorized capture-selection predicate
are prerequisites. One-time registration alone cannot close those missing
contracts. After approval **and** later implementation, per-release
run/source/input/capture derivation and bounded issuance/readback can be
automatic without per-release human approval.

The reader's own consumer run and the intended producer run are distinct.
Its proposed permission cannot depend on impersonating the producer or on
presenting the grant being fetched. No list/arbitrary-key/write/delete API
or candidate fallback is proposed as a shortcut.

`ARCHIVE_GRANT_AUTHORITY_READER_NOT_REGISTERED`,
`ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED` and
`FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED` remain in force.
The current `DERIVED_NOT_AUTHORIZED` state and own-field provider gate are
unchanged. `AUTHENTICATED_PRODUCER_REPORT_VERIFIED` retains only its existing
online acquisition meaning; no detached-signature/native claim is added.

All four checks retain their meanings and their real evidence is
**UNVERIFIED** in this step. R2 remains current version/size/raw digest
equality, not historical generation retrieval or retention. Real bootstrap/
deployment/identity/provider verification was **NOT_CHECKED**.
`publication_authorized: false`, deployment **NOT_CHECKED**, Production
acceptance **BLOCKED** remain unchanged. No real
`RELEASE_ARTIFACTS_VALIDATED` or `DEPLOYMENT_VERIFIED` is established.

### Exact commands and documentation-only validation

All shell commands for this step are recorded below. Source/document
investigation otherwise used scoped `view`/`rg`/`glob` reads. No external
documentation or service was contacted. This is a documentation design task,
not a runtime test or an external claim verification.

**1. Initial metadata: PASS**, expected branch/HEAD; explicit status empty.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git branch --show-current && git rev-parse HEAD && git -c core.fsmonitor=false status --short --untracked-files=all -- scripts/release-grant-provider.mjs scripts/release-archive-provenance.mjs scripts/release-execution-intake.mjs scripts/release-consumer.mjs scripts/release-archive-http.mjs scripts/release-archive-job.mjs scripts/release-checks.mjs scripts/release-evidence-producer.mjs scripts/release-provenance-grant.test.mjs scripts/release-worker-source.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/binding_authority.ts packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-catalog.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/result_archive.ts .github/workflows/tlsn-release-eligibility.yml docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
```

**2. New document scope/append anchor: PASS**, status empty, only the last
six roadmap lines inspected.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git -c core.fsmonitor=false status --short --untracked-files=all -- docs/architecture/adr-tlsn-grant-authority-delegation.md docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md && tail -n 6 docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
```

**3. First documentation check: FAIL (checker heading-count bug).**
The command is inspected before execution: built-in Node modules only;
content reads are exactly these two documents. Link targets are checked
against a literal allowlist **before** `lstat`; no linked source content,
symlink target, external URL, import, executable, recursive directory or
protected path is followed. It checks section/table coverage, proposal/state
markers, source basis and the roadmap cross-reference. Those are structural
consistency checks, not proof of the ADR's security or external feasibility.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFile, lstat } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
const root = process.cwd();
const adrPath = resolve(root, "docs/architecture/adr-tlsn-grant-authority-delegation.md");
const roadmapPath = resolve(root, "docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md");
const adr = await readFile(adrPath, "utf8");
const roadmap = await readFile(roadmapPath, "utf8");
const heading = "## Follow-up: grant authority delegation ADR";
assert.equal(roadmap.split(heading).length, 2);
const entry = roadmap.slice(roadmap.indexOf(heading));
assert(adr.includes("Status: **Proposed recommendation; delegation approval not granted.**"));
assert(adr.includes("Recommend **Option A**"));
assert(adr.includes("There is no runtime success path in this change."));
assert.deepEqual([...adr.matchAll(/^## (\d+)\. /gm)].map((m) => Number(m[1])), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
const rows = (pattern) => [...adr.matchAll(pattern)].map((m) => m[1]);
assert.deepEqual(rows(/^\| (B\d+) \|/gm), Array.from({ length: 8 }, (_, i) => `B${i + 1}`));
assert.deepEqual(rows(/^\| ([ABC]) \|/gm), ["A", "B", "C"]);
for (const [prefix, count] of [["P", 14], ["G", 13], ["U", 12]]) {
  assert.deepEqual(rows(new RegExp(`^\\| (${prefix}\\d{2}) \\|`, "gm")),
    Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(2, "0")}`));
}
for (const text of [adr, entry]) {
  for (const marker of ["b917fd2cdf3b56b644ade1271d01e8bf4c807d69", "UNDEFINED_CONTRACT",
    "DERIVED_NOT_AUTHORIZED", "ARCHIVE_GRANT_AUTHORITY_READER_NOT_REGISTERED",
    "ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED", "FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED",
    "AUTHENTICATED_PRODUCER_REPORT_VERIFIED", "publication_authorized: false", "NOT_CHECKED", "BLOCKED", "UNVERIFIED"]) {
    assert(text.includes(marker), marker);
  }
  assert(!/\bpublication_authorized\s*:\s*true\b/.test(text));
}
for (const field of ["job_workflow_ref", "job_workflow_sha", "workflow_sha", "repository_owner_id",
  "locked_dependencies", "compiled_inputs", "archive_readback", "offline_verification"]) assert(adr.includes(field), field);
const allowed = new Set([
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-catalog.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/binding_authority.ts",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/result_archive.ts",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs",
  "scripts/release-eligibility.mjs", "scripts/release-grant-provider.mjs",
  "scripts/release-archive-provenance.mjs", "scripts/release-consumer.mjs",
  "scripts/release-archive-http.mjs", "scripts/release-archive-job.mjs",
  "scripts/release-execution-intake.mjs", "scripts/release-worker-source.mjs",
  ".github/workflows/tlsn-release-eligibility.yml",
  "docs/architecture/tlsn-data-authenticity-contract.md",
  "docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md",
]);
const seen = new Set();
for (const [, href] of adr.matchAll(/\[[^\]\n]+\]\(([^)\s]+)\)/g)) {
  assert(!href.includes("://") && !href.startsWith("/"), "local relative link required");
  const target = resolve(dirname(adrPath), href);
  const name = relative(root, target);
  assert(allowed.has(name), `link outside explicit scope: ${name}`);
  assert((await lstat(target)).isFile(), `missing/nonregular link: ${name}`);
  seen.add(name);
}
assert.deepEqual([...seen].sort(), [...allowed].sort());
assert(entry.includes("[ADR: TLSN Grant Authority Delegation](../architecture/adr-tlsn-grant-authority-delegation.md)"));
console.log("PASS: 2 documents; 8 boundaries; 3 options; 14 bootstrap, 13 grant and 12 unresolved rows; 17 allowlisted links; proposal/status consistency.");
NODE
```

The first command above failed before link inspection: literal substring
counting also counted the heading string embedded in this recorded command
itself (3 split parts rather than 2). The retry preserves the exactly-one-
section assertion but matches a complete Markdown heading line, not quoted
JavaScript text. No document security invariant or scope check is relaxed.
**Corrected documentation check: PASS.** Two documents, eight boundaries,
three options, 14 bootstrap rows, 13 semantic grant rows, 12 unresolved
contracts and 17 allowlisted local links passed proposal/status consistency.
No runtime identity, cryptography or grant implementation was tested.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFile, lstat } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
const root = process.cwd();
const adrPath = resolve(root, "docs/architecture/adr-tlsn-grant-authority-delegation.md");
const roadmapPath = resolve(root, "docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md");
const adr = await readFile(adrPath, "utf8");
const roadmap = await readFile(roadmapPath, "utf8");
const headings = [...roadmap.matchAll(/^## Follow-up: grant authority delegation ADR$/gm)];
assert.equal(headings.length, 1);
const entry = roadmap.slice(headings[0].index);
assert(adr.includes("Status: **Proposed recommendation; delegation approval not granted.**"));
assert(adr.includes("Recommend **Option A**"));
assert(adr.includes("There is no runtime success path in this change."));
assert.deepEqual([...adr.matchAll(/^## (\d+)\. /gm)].map((m) => Number(m[1])), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
const rows = (pattern) => [...adr.matchAll(pattern)].map((m) => m[1]);
assert.deepEqual(rows(/^\| (B\d+) \|/gm), Array.from({ length: 8 }, (_, i) => `B${i + 1}`));
assert.deepEqual(rows(/^\| ([ABC]) \|/gm), ["A", "B", "C"]);
for (const [prefix, count] of [["P", 14], ["G", 13], ["U", 12]]) {
  assert.deepEqual(rows(new RegExp(`^\\| (${prefix}\\d{2}) \\|`, "gm")),
    Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(2, "0")}`));
}
for (const text of [adr, entry]) {
  for (const marker of ["b917fd2cdf3b56b644ade1271d01e8bf4c807d69", "UNDEFINED_CONTRACT",
    "DERIVED_NOT_AUTHORIZED", "ARCHIVE_GRANT_AUTHORITY_READER_NOT_REGISTERED",
    "ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED", "FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED",
    "AUTHENTICATED_PRODUCER_REPORT_VERIFIED", "publication_authorized: false", "NOT_CHECKED", "BLOCKED", "UNVERIFIED"]) {
    assert(text.includes(marker), marker);
  }
  assert(!/\bpublication_authorized\s*:\s*true\b/.test(text));
}
for (const field of ["job_workflow_ref", "job_workflow_sha", "workflow_sha", "repository_owner_id",
  "locked_dependencies", "compiled_inputs", "archive_readback", "offline_verification"]) assert(adr.includes(field), field);
const allowed = new Set([
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-catalog.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/binding_authority.ts",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/result_archive.ts",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs",
  "scripts/release-eligibility.mjs", "scripts/release-grant-provider.mjs",
  "scripts/release-archive-provenance.mjs", "scripts/release-consumer.mjs",
  "scripts/release-archive-http.mjs", "scripts/release-archive-job.mjs",
  "scripts/release-execution-intake.mjs", "scripts/release-worker-source.mjs",
  ".github/workflows/tlsn-release-eligibility.yml",
  "docs/architecture/tlsn-data-authenticity-contract.md",
  "docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md",
]);
const seen = new Set();
for (const [, href] of adr.matchAll(/\[[^\]\n]+\]\(([^)\s]+)\)/g)) {
  assert(!href.includes("://") && !href.startsWith("/"), "local relative link required");
  const target = resolve(dirname(adrPath), href);
  const name = relative(root, target);
  assert(allowed.has(name), `link outside explicit scope: ${name}`);
  assert((await lstat(target)).isFile(), `missing/nonregular link: ${name}`);
  seen.add(name);
}
assert.deepEqual([...seen].sort(), [...allowed].sort());
assert(entry.includes("[ADR: TLSN Grant Authority Delegation](../architecture/adr-tlsn-grant-authority-delegation.md)"));
console.log("PASS: 2 documents; 8 boundaries; 3 options; 14 bootstrap, 13 grant and 12 unresolved rows; 17 allowlisted links; proposal/status consistency.");
NODE
```

Runtime Node regression, OIDC crypto/key-generating fixtures, Worker
type/build/runtime, native/Cargo/Rust/WASM/APP, real GitHub/OIDC/attestation/
Cloudflare/R2/Notary/Session Authority, Production bootstrap/signing/
registration/deploy/publish, and push/PR/tag are **NOT_RUN**. No runtime file
changed; previous 351-test results are historical, not a current test run.
New delegated identity, issued-grant/CAS/revocation protocol and real
acceptance are **NOT_IMPLEMENTED / NOT_RUN**.

### Two-document local commit procedure

The normal scoped hook is retained. Only these two Markdown blobs enter its
isolated temporary analysis repository; code-review-graph output is not
approval of a trust policy or evidence of a running authority. Signing is
disabled and no hook bypass is used.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
set -- docs/architecture/adr-tlsn-grant-authority-delegation.md docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
git diff --check -- "$@" && git add -- "$@" && git diff --cached --check -- "$@" && git -c commit.gpgsign=false commit --only -m "docs(tlsn): propose grant authority delegation contract" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" -- "$@" > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/delegation-adr-local-commit.log 2>&1; result=$?; tail -n 24 /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/delegation-adr-local-commit.log; exit "$result"
```

With that same exact two-path list:

```sh
git branch --show-current
git rev-parse HEAD HEAD^
git -c core.fsmonitor=false status --short --untracked-files=all -- "$@"
git diff --check HEAD^ HEAD -- "$@"
```

Actual hook/commit exit result, final branch/commit/parent and scoped-clean
state are reported from the executed commands. This documentation commit
does not approve delegation or authorize publication.

## Option A source-only delegation bootstrap follow-up

Start branch: `tlsn-first-testplay-candidate`.
Start HEAD: `4505b8fcd6a5c145ba56fb9a8e56b2a690adecda` (matches request).
Explicit target scope was clean at the initial/repeated metadata checks.
See [ADR: TLSN Grant Authority Delegation](../architecture/adr-tlsn-grant-authority-delegation.md),
section 10, for source scope and the still-unapproved activation sequence.

### Source implementation versus actual authorization

- Added [bootstrap schema](../../scripts/tlsn-grant-delegation.v1.schema.json)
  and [draft policy](../../scripts/tlsn-grant-delegation.draft.json): version
  1, `fusou-grant-delegation-bootstrap-policy-v1`, 43 required scalar fields.
  Draft lifecycle is `PROPOSED`; operational/publication flags must be false.
  Source constants, design proposals and external inputs are annotated
  separately. No Production identity, revision, endpoint, TTL or policy
  approval is fabricated.
- Added [offline preflight and diagnostic helper](../../scripts/release-grant-delegation.mjs).
  Only the fixed schema/draft files are read through `readRegularFile`;
  there are no path/activation options, credential/environment/token reads,
  key generation, signing, network access or registration in the preflight.
  There is no root schema-validator dependency; the bounded flat profile
  validates only its explicit supported keywords and rejects unknown ones.
  It does not resolve/fetch schemas or claim full JSON Schema support.
- Added [reusable workflow source](../../.github/workflows/tlsn-grant-delegation.yml):
  **all jobs fixed-disabled**, as explicitly selected by the user. The sole
  job is `if: ${{ false }}`; read-only contents/actions permissions, pinned
  existing Actions, no OIDC/token/authority call or existing caller wiring.
  Its diagnostic source reuses `evaluateReleaseRun`; API interactions are
  tested only with local doubles. No workflow was executed.
- Added [key-free contracts](../../scripts/release-grant-delegation.test.mjs):
  17 tests for shape/version/missing fields, unsupported schema keywords,
  PROPOSED/ACTIVE/REVOKED self-claims, filled-but-unapproved inputs,
  provider-report refusal, runtime derivation versus bootstrap, metadata
  substitutions, three distinct SHAs, development exclusion, propagated
  errors, fixed-disabled workflow and unchanged runtime wiring.
- Updated the ADR. No existing candidate/compiler, provider/consumer,
  authority/OIDC/HTTP, production policy, source inventory or native
  implementation changed. `DERIVED_NOT_AUTHORIZED` remains candidate-only.

The workflow's `candidate_implementation_sha` is an untrusted diagnostic
code locator, **not** an approved reusable revision. Caller workflow SHA,
implementation locator and observed release source SHA are separate.
Signed `job_workflow_ref` / `job_workflow_sha` are not obtained:
delegated identity is `NOT_VERIFIED`, `job_workflow_sha` is null, and
`production_grant_eligible` is false even with `PRODUCTION_ELIGIBLE`.
The fixed-disabled checkout must not be promoted to an issuer by removing
the gate. A future isolated immutable trusted closure and its signed-claim
verification must be implemented and independently approved first.

| Layer | Observed local result | Not established |
| --- | --- | --- |
| Source shape | `SOURCE_CONTRACT_READY`, no validation errors for bundled draft | Complete U01-U12 authorization protocol or approved principal |
| Delegation approval | `BLOCKED_POLICY_NOT_APPROVED`; independent active pin `NOT_VERIFIED` | Real registration existence/absence, approval or policy authenticity |
| External inputs | `BLOCKED_EXTERNAL_INPUTS`; 22 missing bootstrap values/contracts | A populated local file is not independent registration evidence |
| Runtime implementation | `BLOCKED_IMPLEMENTATION` | Authorizer, durable issuer/provider, grant reader, revocation/CAS or active-root adapter |
| Diagnostic/candidate | `DERIVED_NOT_AUTHORIZED` | Issued grant, transfer of a process-local capability or static-policy fallback |

The 22 missing fields are issue/read audiences, repository/owner IDs,
delegate revision, authority endpoint/deployment/epoch, policy digest
contract/active registry identity, release-input derivation/capture selection,
grant issuer/scope/wire/TTL, freshness/clock/revocation/state revision-CAS,
consumer endpoint/identity and source-inventory contract.
Independent policy byte encoding/digest domain/root distribution remain
`UNDEFINED_CONTRACT`. Current check/public input pins and source hashes
cannot silently become delegation approval roots.

Grant authorization API, publication provider, authority/grant reader and
state protocol are source-level **NOT_IMPLEMENTED**. Actual external
registration is **NOT_VERIFIED**, not asserted absent by this offline tool.
In particular these existing blockers remain:

- `ARCHIVE_GRANT_AUTHORITY_READER_NOT_REGISTERED`
- `ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED`
- `FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED`

### Bootstrap once; derive release-specific inputs automatically

After remaining protocol decisions and separately allowed implementation:
independently approve/register repository/owner, immutable delegate closure,
caller/event/ref/eligibility and capture/subject selection policy,
authority/deployment/epoch, purpose-separated endpoints/audiences,
policy/input derivation roots, grant scope/wire/TTL/revocation/CAS and
consumer read identity. Actual final full revision must be obtained from
source, not guessed; caller `uses` must pin that approved full SHA.
Revision/ownership/deployment rotation requires controlled bootstrap
maintenance, not automatic self-registration.

Run/attempt, release source SHA, release/public/check/capture-policy digests,
capture/session/job/verification attempt/binding, object version/raw size/
digest and Result/optional receipt observations must subsequently be
derived from authenticated runtime metadata and independent authority state.
They are not concrete recurring bootstrap fields and do not require a
new human approval per release.

Issued-grant ID/version/canonical bytes/digest/receipt binding, logical
scope, actual lifetime/freshness, independent read identity, revocation/
revision/epoch and CAS remain undefined. Same-scope/same-content
nonrenewing idempotence, changed-content conflicts, external I/O outside
transactions and post-await policy/catalog/epoch revalidation remain ADR
requirements, not implemented or simulated successful issuance here.
No global one-time ledger is added.

After separate external permission: observe real reusable OIDC claim
semantics, trusted immutable loading, active policy distribution, live
eligibility, authority durable issue/restart/read/revoke/CAS and consumer
reacquisition. Actual R2 bytes/version and formal native/TLSN evidence
remain independent verification work. None of those operations ran.

### Exact verification commands and results

Source/import effects were inspected before execution. The four explicit
Node test files below use fixed allowlisted source reads, API/storage/
HTTP/executor doubles and the existing key-free fixtures, not a Worker
runtime or native process. The new CLI child-process test has an empty
environment and invokes only this Node preflight. Existing transport/
native helpers are not run with real services/executables. No package
script, dependency installation or build is invoked.
Audit/discovery used scoped `view`/`rg`/`glob`, never repository-wide scans.

**1. Repeated start/scope metadata: PASS**, expected branch/HEAD, scoped
status empty (the new paths did not yet exist).

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git branch --show-current && git rev-parse HEAD && git status --short -- scripts/release-grant-delegation.mjs scripts/release-grant-delegation.test.mjs scripts/tlsn-grant-delegation.v1.schema.json scripts/tlsn-grant-delegation.draft.json .github/workflows/tlsn-grant-delegation.yml docs/architecture/adr-tlsn-grant-authority-delegation.md docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
```

**2. Initial targeted contracts: PASS**, 80 PASS / 0 FAIL / 0 cancelled /
0 skipped. The 48 existing provenance/candidate tests are included, not
replaced or skipped.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --test scripts/release-grant-delegation.test.mjs scripts/release-eligibility.test.mjs scripts/release-provenance-grant.test.mjs scripts/release-workflow.test.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/delegation-bootstrap-tests.log 2>&1; result=$?; grep -E '^(not ok|# tests|# pass|# fail|# cancelled|# skipped|# duration)' /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/delegation-bootstrap-tests.log; exit "$result"
```

**3. Parse-only validation: PASS**, exit 0, both initially and after the
final source refinements. Exact same command ran twice:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --check scripts/release-grant-delegation.mjs && env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --check scripts/release-grant-delegation.test.mjs
```

**4. Actual offline CLI: PASS fail-closed behavior, expected exit 1**,
not operational success. Output: source shape `SOURCE_CONTRACT_READY`,
overall/policy `BLOCKED_POLICY_NOT_APPROVED`, external
`BLOCKED_EXTERNAL_INPUTS` with 22 missing fields and registration
`NOT_VERIFIED`, implementation `BLOCKED_IMPLEMENTATION`, all four
unattested checks and existing native blocker. No network/signing occurred.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node scripts/release-grant-delegation.mjs
```

**5. Final targeted contracts: PASS**, 80 PASS / 0 FAIL / 0 cancelled /
0 skipped. No intermediate test failure or suppressed exception occurred.
After the first PASS, the JSON Schema explicitly gained the JSON-safe
integer upper bound already enforced by Node, preventing schema/validator
drift; the workflow assertion was strengthened to recognize all legal job
identifier spellings. A malformed-bound case was added. No assertion was
removed or weakened.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --test scripts/release-grant-delegation.test.mjs scripts/release-eligibility.test.mjs scripts/release-provenance-grant.test.mjs scripts/release-workflow.test.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/delegation-bootstrap-final-tests.log 2>&1; result=$?; grep -E '^(not ok|# tests|# pass|# fail|# cancelled|# skipped|# duration)' /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/delegation-bootstrap-final-tests.log; exit "$result"
```

**6. Documentation/contract consistency: PASS**, exit 0: two documents,
8 boundaries, 14 bootstrap / 13 grant / 12 unresolved rows, 43 policy
fields, 22 missing inputs and 22 allowlisted links.
Only these two documents, the fixed bootstrap files and allowlisted link
metadata are read. The check never follows arbitrary links.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { lstat } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { readRegularFile } from "./scripts/release-files.mjs";
import { readDelegationBootstrapSources, inspectDelegationBootstrap } from "./scripts/release-grant-delegation.mjs";
const root = process.cwd();
const adrPath = resolve(root, "docs/architecture/adr-tlsn-grant-authority-delegation.md");
const roadmapPath = resolve(root, "docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md");
const [adrBytes, roadmapBytes, sources] = await Promise.all([
  readRegularFile(adrPath), readRegularFile(roadmapPath), readDelegationBootstrapSources(),
]);
const adr = adrBytes.toString("utf8"), roadmap = roadmapBytes.toString("utf8");
const heading = "## Option A source-only delegation bootstrap follow-up";
assert.equal(roadmap.split("\n").filter((line) => line === heading).length, 1);
const entry = roadmap.slice(roadmap.indexOf(`\n${heading}\n`));
assert.equal(adr.split("\n").filter((line) => line === "## 10. Nonoperational Option A source preparation").length, 1);
for (const [prefix, count] of [["B", 8], ["P", 14], ["G", 13], ["U", 12]]) {
  const rows = [...adr.matchAll(new RegExp(`^\\| (${prefix}\\d{${prefix === "B" ? 1 : 2}}) \\|`, "gm"))].map((match) => match[1]);
  assert.deepEqual(rows, Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(prefix === "B" ? 1 : 2, "0")}`));
}
for (const text of [adr, entry]) for (const marker of [
  "4505b8fcd6a5c145ba56fb9a8e56b2a690adecda", "SOURCE_CONTRACT_READY", "BLOCKED_IMPLEMENTATION",
  "BLOCKED_EXTERNAL_INPUTS", "BLOCKED_POLICY_NOT_APPROVED", "NOT_VERIFIED", "UNDEFINED_CONTRACT",
  "DERIVED_NOT_AUTHORIZED", "ARCHIVE_GRANT_AUTHORITY_READER_NOT_REGISTERED",
  "ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED", "FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED",
  "AUTHENTICATED_PRODUCER_REPORT_VERIFIED", "publication_authorized: false", "NOT_CHECKED", "BLOCKED", "UNVERIFIED",
]) assert(text.includes(marker), marker);
assert(!/\bpublication_authorized\s*:\s*true\b/.test(entry));
const report = inspectDelegationBootstrap(sources);
assert.equal(Object.keys(sources.schema.properties).length, 43);
assert.equal(report.external_inputs.missing.length, 22);
assert.equal(report.source_contract.status, "SOURCE_CONTRACT_READY");
assert.equal(sources.policy.lifecycle, "PROPOSED");
assert.equal(report.publication_authorized, false);
const allowed = new Set([
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-catalog.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/binding_authority.ts",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/result_archive.ts",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs",
  "scripts/release-eligibility.mjs", "scripts/release-grant-provider.mjs",
  "scripts/release-archive-provenance.mjs", "scripts/release-consumer.mjs",
  "scripts/release-archive-http.mjs", "scripts/release-archive-job.mjs",
  "scripts/release-execution-intake.mjs", "scripts/release-worker-source.mjs",
  ".github/workflows/tlsn-release-eligibility.yml",
  "docs/architecture/tlsn-data-authenticity-contract.md",
  "docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md",
  "scripts/tlsn-grant-delegation.v1.schema.json", "scripts/tlsn-grant-delegation.draft.json",
  "scripts/release-grant-delegation.mjs", "scripts/release-grant-delegation.test.mjs",
  ".github/workflows/tlsn-grant-delegation.yml",
]);
const seen = new Set();
for (const [, href] of adr.matchAll(/\[[^\]\n]+\]\(([^)\s]+)\)/g)) {
  assert(!href.includes("://") && !href.startsWith("/"));
  const target = resolve(dirname(adrPath), href), name = relative(root, target);
  assert(allowed.has(name), `link outside explicit scope: ${name}`);
  assert((await lstat(target)).isFile(), `missing/nonregular link: ${name}`);
  seen.add(name);
}
assert.deepEqual([...seen].sort(), [...allowed].sort());
console.log("PASS: 2 documents; 8 boundaries; 14 bootstrap, 13 grant, 12 unresolved rows; 43 policy fields; 22 missing inputs; 22 allowlisted links.");
NODE
```

### Real check state and deliberately unexecuted work

| Check | Current local scope | Real evidence |
| --- | --- | --- |
| `locked_dependencies` | Existing assertions preserved; no dependency changes | **UNVERIFIED** |
| `compiled_inputs` | Existing assertions preserved; no build | **UNVERIFIED** |
| `archive_readback` | Provider/preflight refusal and candidate regression PASS | **UNVERIFIED**, dynamic grant path **BLOCKED** |
| `offline_verification` | Archive prerequisite/native blocker preserved | **UNVERIFIED**, formal native identity **BLOCKED** |

`AUTHENTICATED_PRODUCER_REPORT_VERIFIED` is unchanged online report
provenance, not detached signature/grant authentication, retention or native
cryptographic verification. Neither grant authentication nor these
synthetic tests discharge `FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED`.
`publication_authorized: false`, deployment **NOT_CHECKED**, Production
acceptance **BLOCKED** remain unchanged. Actual `RELEASE_ARTIFACTS_VALIDATED`
and `DEPLOYMENT_VERIFIED` are not established.

Full/unreviewed package suites, key-generating OIDC fixtures, Worker/native/
Cargo/Rust/WASM/APP runtime/build/type checks, actual workflow execution,
GitHub API/OIDC/Cloudflare/R2/Notary/Session Authority connections, real
policy registration/keys/signing/deploy/publish, push/PR/tag and native
crypto acceptance: **NOT_RUN**, prohibited or unimplemented in this step.
The three protected paths and completed Result-byte-binding test were not
accessed or changed. Existing 351-test results are historical; this step
reports only the actual 80-test runs above.

### Seven-path local commit procedure

The following is the local commit procedure, not a predeclared successful
hook result. The actual hook/commit outcome and final metadata are reported
from its executed output. It retains the normal scoped hook; only these
seven blobs enter its isolated local analysis repository. No hook bypass
or signing is used.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
set -- scripts/release-grant-delegation.mjs scripts/release-grant-delegation.test.mjs scripts/tlsn-grant-delegation.v1.schema.json scripts/tlsn-grant-delegation.draft.json .github/workflows/tlsn-grant-delegation.yml docs/architecture/adr-tlsn-grant-authority-delegation.md docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
git diff --check -- "$@" && git add -- "$@" && git diff --cached --check -- "$@" && git -c commit.gpgsign=false commit --only -m "feat(tlsn): prepare nonoperational delegation bootstrap" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" -- "$@" > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/delegation-bootstrap-local-commit.log 2>&1; result=$?; tail -n 24 /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/delegation-bootstrap-local-commit.log; exit "$result"
```

Final metadata/whitespace checks use the same seven explicit paths:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
set -- scripts/release-grant-delegation.mjs scripts/release-grant-delegation.test.mjs scripts/tlsn-grant-delegation.v1.schema.json scripts/tlsn-grant-delegation.draft.json .github/workflows/tlsn-grant-delegation.yml docs/architecture/adr-tlsn-grant-authority-delegation.md docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
git branch --show-current
git rev-parse HEAD HEAD^
git -c core.fsmonitor=false status --short --untracked-files=all -- "$@"
git diff --check HEAD^ HEAD -- "$@"
```

Actual final commit/parent, hook outcome and scoped-clean state are reported
from the executed command; this procedure does not claim policy approval.

## Delegation bootstrap classification and minimal draft follow-up

Start branch: `tlsn-first-testplay-candidate`.
Start HEAD: `1ef6af67de90db90cb4202a52df960445f804f2b`, as requested.
The explicit initial scope was clean.
See [ADR section 11](../architecture/adr-tlsn-grant-authority-delegation.md)
and the [machine classification source](../../scripts/release-grant-delegation-classification.mjs).

### Classification, not deletion of security requirements

The existing 43-required-field schema and PROPOSED draft are preserved;
only the schema description clarifies the legacy annotation. No runtime
value or validation requirement was removed. The existing preflight now
adds exhaustive `classification.fields`, `legacy_missing_fields`, a
`minimal_manifest` projection, distinct bootstrap/registration diagnostics
and `readiness.complete: false`. Existing provider/candidate assertions,
policy, workflow gate, authority and consumer code are unchanged.

| Class | All 43 planning fields | Old 22 gaps |
| --- | --- | --- |
| `SOURCE_DERIVED` | 18 source constants or requirement labels | 0 |
| `DIAGNOSTIC_ONLY` | 3 local lifecycle/false flags | 0 |
| `ONE_TIME_BOOTSTRAP_INPUT` | 3 independently pinned selections | 3 |
| `UNDEFINED_CONTRACT` | 19 protocol/identity/derivation decisions | 19 |
| `RUNTIME_DERIVED` | 0 concrete runtime values in the schema | 0 |
| `AUTHORITY_STATE_DERIVED` | 0 concrete state observations in the schema | 0 |
| `EXTERNAL_REGISTRATION_REQUIRED` | 0 registration-only fields: endpoint/root/reader semantics must first be defined | 0 |

The three currently well-defined stable selections are `repository_id`,
`repository_owner_id` and `delegate_revision`. All remain null and
`NOT_VERIFIED`. They are **not a complete minimal activation bootstrap**;
`complete_minimum_established: false`, completeness `UNDEFINED_CONTRACT`.
The delegate pin selects an independently approved final issuer closure,
not the current diagnostic HEAD and not each release source SHA. Numeric
IDs can later be independently acquired automatically; they are not an
instruction for manual copying from producer output.

The 19 unresolved fields include issue/read audience and endpoint semantics,
issuer/deployment/epoch and root distribution, policy digest encoding,
automatic expected-input/capture selection, grant scope/wire/TTL/freshness,
revocation/CAS, independent reader identity and final trusted closure.
Once defined, some stable parameters may require one-time registration.
They are not falsely classified as settings that can be solved by entering
nonempty strings. U01-U12 remain blocking.

The generated draft manifest is a diagnostic projection using the existing
v1 schema, **not an additional acceptance schema**. It records actor/
destination/verification requirements; undefined U02 approval governance
and unimplemented authority/consumer registration are explicit. It does
not invent a registrar, endpoint, secret, key, active pin or authority
epoch. Every field has one primary category, public value/state, source/
ADR anchors, independent verification, blocker and derivation/approval/
registration flags. Invalid proposed values are marked and not echoed as
valid observations. Coverage errors remain fail-closed.

The five separate derivation records are:

1. Authenticated producer/validation run/attempt/caller context.
2. Live Production tag/source/main eligibility, separate from development.
3. Exact per-release public/check/capture-policy digests, preserving
   independent existing pins; automatic expected-input/selection still U03/U04.
4. Exact consumed capture/session/subject/job/attempt/binding authority lookup.
5. Catalog/current object version/raw size/digest, Result envelope and
   optional receipt observations.

The first three are runtime-derived; the last two are authority-state
derived. None is observed here; grant binding remains NOT_IMPLEMENTED.
The catalog's available facts do not authorize a release-to-subject lookup.
Grant scope/issued expiry/revocation/revision/epoch are not derivable from
an implemented issuer, because no issuer exists. CAS, post-await state
revalidation, external I/O outside transactions and nonrenewing same-scope
idempotence remain ADR requirements, not implemented guarantees. There is
no global one-time ledger.

### OIDC and actual readiness

Source facts: fixed GitHub issuer/JWKS, exact archive audience and configured
repository/caller/event/ref/run/attempt validation, optional reusable fields
constrained to the existing caller. Current archive OIDC does not enforce
owner ID and does not compare `sub`. Proposed Option A still requires
separately approved mandatory signed reusable identity and isolated
immutable implementation. Source/ref/caller/delegate SHA roles must not
be conflated, but their values need not differ.

Actual repository subject settings, immutable-subject configuration,
reusable signed-claim availability and current official GitHub subject
specification were not externally inspected. No `sub` string template is
assumed. Settings/claim configuration remain `NOT_VERIFIED`; current
official specification is `NOT_CHECKED_OFFLINE`. No repository setting
changed. Reusable identity alone is not successful-step attestation;
eligibility-to-issuance still lacks an authenticated authority observation
contract.

The reusable workflow remains fixed-disabled. Source shape is
`SOURCE_CONTRACT_READY`; bootstrap inputs are `BLOCKED_EXTERNAL_INPUTS` /
`NOT_VERIFIED`; policy remains `BLOCKED_POLICY_NOT_APPROVED`; external
registration is `NOT_VERIFIED`; implementation is `BLOCKED_IMPLEMENTATION`.
Full readiness remains false. Local ACTIVE/PASS/authenticated claims,
even with all planning strings populated, cannot change those facts.
Legacy `external_inputs.missing` remains for audit compatibility, explicitly
not a 22-value manual checklist.

`ARCHIVE_GRANT_AUTHORITY_READER_NOT_REGISTERED`,
`ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED` and
`FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED` remain unchanged.

### Exact commands, side effects and results

Scoped source reads/searches used `view`/`rg` only on the named source,
ADR and directly related files. No broad repository scan was performed.
Before tests, the new imports were inspected: the classification module
is pure data/projection code; Node source-evidence tests validate an
explicit eleven-path allowlist before reading. Existing key-free fixtures
and four previous selectors were unchanged except the preflight under test.
They use API/storage/HTTP/executor doubles, never real services, a Worker
runtime or native executables. No dependency/package script was run.

**1. Initial metadata: PASS**, expected branch/HEAD, explicit scope empty.
The planned classification JSON path was only a status selector and was
not created; classification is versioned source with generated JSON output.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git branch --show-current && git rev-parse HEAD && git -c core.fsmonitor=false status --short --untracked-files=all -- scripts/release-grant-delegation.mjs scripts/release-grant-delegation.test.mjs scripts/tlsn-grant-delegation.v1.schema.json scripts/tlsn-grant-delegation.draft.json scripts/tlsn-grant-delegation.classification.json scripts/release-grant-delegation-classification.mjs scripts/release-grant-delegation-classification.test.mjs docs/architecture/adr-tlsn-grant-authority-delegation.md docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md .github/workflows/tlsn-grant-delegation.yml
```

**2. Key-free contracts: PASS**, 91 PASS / 0 FAIL / 0 cancelled / 0 skipped:
11 new classification tests plus the previous 80 tests. All 48 existing
provenance/candidate tests and their assertions remain intact. No
intermediate failure, assertion weakening or skip occurred.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --test scripts/release-grant-delegation-classification.test.mjs scripts/release-grant-delegation.test.mjs scripts/release-eligibility.test.mjs scripts/release-provenance-grant.test.mjs scripts/release-workflow.test.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/delegation-classification-tests.log 2>&1; result=$?; grep -E '^(not ok|# tests|# pass|# fail|# cancelled|# skipped|# duration)' /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/delegation-classification-tests.log; exit "$result"
```

**3. Parse-only source/test validation: PASS**, three files, exit 0.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --check scripts/release-grant-delegation-classification.mjs && env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --check scripts/release-grant-delegation-classification.test.mjs && env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --check scripts/release-grant-delegation.mjs
```

**4. Actual CLI/report: PASS fail-closed behavior; expected exit 1**, printed
`preflight_exit=1`. This is not operational success. The sole write is the
named public diagnostic report in the session output directory; no
Production input, credential or token is read/written.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node scripts/release-grant-delegation.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/delegation-minimal-bootstrap-preflight.json; result=$?; printf 'preflight_exit=%s\n' "$result"; exit "$result"
```

**5. Persisted JSON shape and standalone draft: PASS**, exit 0, exact
43/22/3/19 counts and blocked flags. The only generated file is the named
public manifest, with exclusive creation (`wx`), not a new trust registration.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { readRegularFile } from "./scripts/release-files.mjs";
const report = JSON.parse(await readRegularFile(new URL("file:///home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/delegation-minimal-bootstrap-preflight.json")));
assert.equal(report.classification.fields.length, 43);
assert.equal(report.classification.legacy_missing_fields.length, 22);
assert.equal(report.classification.counts.ONE_TIME_BOOTSTRAP_INPUT, 3);
assert.equal(report.classification.counts.UNDEFINED_CONTRACT, 19);
assert.equal(report.readiness.complete, false);
assert.equal(report.external_registration.status, "NOT_VERIFIED");
assert.equal(report.publication_authorized, false);
const manifest = report.classification.minimal_manifest;
assert.equal(manifest.lifecycle, "PROPOSED");
assert.equal(manifest.complete_minimum_established, false);
await writeFile(new URL("file:///home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/delegation-minimal-bootstrap-manifest.draft.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ fields: 43, legacy_gaps: 22, counts: report.classification.counts,
  static_trust_selections: report.bootstrap_inputs.fields, protocol_gaps: manifest.undefined_contracts.length,
  readiness: report.readiness, policy: report.policy_approval.status,
  external_registration: report.external_registration.status, publication_authorized: report.publication_authorized }, null, 2));
NODE
```

**6. Documentation/artifact consistency: PASS**, exit 0: all 43 ADR field
names match the schema without duplication, all 24 allowlisted links
exist, saved report/manifest equal the current source projection, and
blocked states are consistent.
Only the two documents, existing fixed bootstrap sources, the two named
generated JSON deliverables and allowlisted link metadata are read.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH -u NODE_V8_COVERAGE node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { lstat } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { readRegularFile } from "./scripts/release-files.mjs";
import { readDelegationBootstrapSources, inspectDelegationBootstrap } from "./scripts/release-grant-delegation.mjs";
const root = process.cwd(), adrPath = resolve(root, "docs/architecture/adr-tlsn-grant-authority-delegation.md");
const roadmapPath = resolve(root, "docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md");
const files = "/home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/";
const [adrRaw, roadmapRaw, reportRaw, manifestRaw, sources] = await Promise.all([
  readRegularFile(adrPath), readRegularFile(roadmapPath),
  readRegularFile(`${files}delegation-minimal-bootstrap-preflight.json`),
  readRegularFile(`${files}delegation-minimal-bootstrap-manifest.draft.json`), readDelegationBootstrapSources(),
]);
const adr = adrRaw.toString("utf8"), roadmap = roadmapRaw.toString("utf8");
const heading = "## Delegation bootstrap classification and minimal draft follow-up";
assert.equal(roadmap.split("\n").filter((line) => line === heading).length, 1);
const entry = roadmap.slice(roadmap.indexOf(`\n${heading}\n`));
const adrHeading = "## 11. Bootstrap classification and minimal draft projection";
assert.equal(adr.split("\n").filter((line) => line === adrHeading).length, 1);
const section = adr.slice(adr.indexOf(`\n${adrHeading}\n`));
const tableRows = section.split("\n").filter((line) => /^\| `[A-Z_]+` \(\d+\) \|/.test(line));
const names = tableRows.flatMap((line) => [...line.split("|")[2].matchAll(/`([^`]+)`/g)].map((match) => match[1]));
assert.deepEqual(names.sort(), [...sources.schema.required].sort());
const current = inspectDelegationBootstrap(sources), saved = JSON.parse(reportRaw);
assert.deepEqual(saved, current);
assert.deepEqual(JSON.parse(manifestRaw), current.classification.minimal_manifest);
for (const text of [section, entry]) for (const marker of [
  "1ef6af67de90db90cb4202a52df960445f804f2b", "UNDEFINED_CONTRACT", "NOT_VERIFIED",
  "SOURCE_CONTRACT_READY", "BLOCKED_POLICY_NOT_APPROVED", "FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED",
  "publication_authorized: false", "NOT_CHECKED", "BLOCKED", "UNVERIFIED",
]) assert(text.includes(marker), marker);
assert.equal(current.readiness.complete, false);
const allowed = new Set([
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-catalog.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/binding_authority.ts",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/result_archive.ts",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http.mjs",
  "packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs",
  "scripts/release-eligibility.mjs", "scripts/release-grant-provider.mjs", "scripts/release-archive-provenance.mjs",
  "scripts/release-consumer.mjs", "scripts/release-archive-http.mjs", "scripts/release-archive-job.mjs",
  "scripts/release-execution-intake.mjs", "scripts/release-worker-source.mjs",
  ".github/workflows/tlsn-release-eligibility.yml", "docs/architecture/tlsn-data-authenticity-contract.md",
  "docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md",
  "scripts/tlsn-grant-delegation.v1.schema.json", "scripts/tlsn-grant-delegation.draft.json",
  "scripts/release-grant-delegation.mjs", "scripts/release-grant-delegation.test.mjs",
  ".github/workflows/tlsn-grant-delegation.yml", "scripts/release-grant-delegation-classification.mjs",
  "scripts/release-grant-delegation-classification.test.mjs",
]);
const seen = new Set();
for (const [, href] of adr.matchAll(/\[[^\]\n]+\]\(([^)\s]+)\)/g)) {
  assert(!href.includes("://") && !href.startsWith("/"));
  const target = resolve(dirname(adrPath), href), name = relative(root, target);
  assert(allowed.has(name), name);
  assert((await lstat(target)).isFile(), name); seen.add(name);
}
assert.deepEqual([...seen].sort(), [...allowed].sort());
console.log("PASS: 43 unique ADR fields; 24 allowlisted links; source/report/manifest equality; blocked state consistency.");
NODE
```

### Real check state and unexecuted work

| Check | Local contract result | Real evidence |
| --- | --- | --- |
| `locked_dependencies` | Existing assertions preserved | **UNVERIFIED** |
| `compiled_inputs` | Existing assertions preserved, no build | **UNVERIFIED** |
| `archive_readback` | Existing candidate/provider refusal preserved | **UNVERIFIED**, dynamic grant path **BLOCKED** |
| `offline_verification` | Existing archive prerequisite/native blocker preserved | **UNVERIFIED**, formal native identity **BLOCKED** |

Grant authentication is not native/TLSN cryptographic verification.
`AUTHENTICATED_PRODUCER_REPORT_VERIFIED` retains its existing online
GitHub metadata/archive/trusted workflow scope. Classification/source shape
does not establish real `RELEASE_ARTIFACTS_VALIDATED` or
`DEPLOYMENT_VERIFIED`.
`publication_authorized: false`, deployment **NOT_CHECKED**, Production
acceptance **BLOCKED** remain invariant.

Full/unreviewed suites, key-generating OIDC fixtures, Cargo/Rust/WASM/APP/
Worker/native build/runtime, external GitHub/docs/OIDC/Cloudflare/R2/
Notary/Session Authority, repository settings, policy registration/keys/
signing/deploy/publish, actual reusable workflow, native acceptance and
push/PR/tag are **NOT_RUN**, prohibited or unimplemented. Protected files
were not accessed; the completed Result-byte-binding test was not changed.
No new dependency, secret, root, endpoint or native identity was introduced.

### Six-path local commit procedure

This is the scoped local commit procedure; actual hook/commit outcome is
reported from its execution, not assumed in advance. The normal hook is
retained, signing disabled, and only these six blobs enter its local
analysis repository.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
set -- scripts/release-grant-delegation-classification.mjs scripts/release-grant-delegation-classification.test.mjs scripts/release-grant-delegation.mjs scripts/tlsn-grant-delegation.v1.schema.json docs/architecture/adr-tlsn-grant-authority-delegation.md docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
git diff --check -- "$@" && git add -- "$@" && git diff --cached --check -- "$@" && git -c commit.gpgsign=false commit --only -m "feat(tlsn): classify delegation bootstrap requirements" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" -- "$@" > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/delegation-classification-local-commit.log 2>&1; result=$?; tail -n 24 /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/delegation-classification-local-commit.log; exit "$result"
```

Final branch/commit/parent, scoped cleanliness and committed whitespace:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
set -- scripts/release-grant-delegation-classification.mjs scripts/release-grant-delegation-classification.test.mjs scripts/release-grant-delegation.mjs scripts/tlsn-grant-delegation.v1.schema.json docs/architecture/adr-tlsn-grant-authority-delegation.md docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
git branch --show-current
git rev-parse HEAD HEAD^
git -c core.fsmonitor=false status --short --untracked-files=all -- "$@" scripts/tlsn-grant-delegation.draft.json .github/workflows/tlsn-grant-delegation.yml
git diff --check HEAD^ HEAD -- "$@"
```

## Follow-up: enforce archive OIDC repository owner identity

### Actual starting state and scope

Branch: `tlsn-first-testplay-candidate`.
Start HEAD: `a1e08295994c0f1a429135422a5ecbba4c4f8f2d` (matches request).
Both initial explicit-path status checks below returned no changes.
Protected files were not accessed or included in operations.
No external connection, package install, key generation/signing,
Production setting change, build/runtime, deployment, publication,
push/PR/tag or completed Result-byte-binding test change was performed.

The existing Worker trust path reads only its configured archive policy
and independent SHA-256 pin, not request-body identity expectations.
The producer validates that same pinned contract before acquiring a
token; the consumer independently checks policy and exact response
authorization. Actual installed policy, repository/owner IDs, settings,
active pins and real signed tokens were not inspected.

### Eleven changed/new files

Paths are relative to the repository root.

| File | Purpose |
| --- | --- |
| `packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs` | Shared strict canonical GitHub ID and identity policy assertion; require owner ID; include it in exact response authorization |
| `packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc.mjs` | Assert policy before JWT/key access; require owner claims; call identity assertion only after JOSE verification; retain configured reusable checks |
| `packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc-claims.mjs` (new) | Key-free verified-payload assertion; strict repository/owner IDs and owner name consistency; preserve caller/job/run/time predicates |
| `scripts/release-worker-source.mjs` | Include the new module in the shipped Worker source/import closure |
| `scripts/release-provenance-fixture.mjs` | Add synthetic owner ID to the key-free policy fixture |
| `scripts/release-archive-http.test.mjs` | Align the existing RSA fixture and missing-claim assertions; parse only, never executed/imported |
| `scripts/release-archive-oidc-claims.test.mjs` (new) | 13 key-free tests for identities, independent pins, body/client boundaries, consumer metadata and maintained blockers |
| `scripts/release-grant-delegation-classification.mjs` | Update source enforcement fact without claiming external registration/acceptance |
| `scripts/release-grant-delegation-classification.test.mjs` | Replace the obsolete missing-enforcement observation with positive source enforcement assertions; preserve subject uncertainty |
| `docs/architecture/adr-tlsn-grant-authority-delegation.md` | Correct P04/current audit fact and document the tightened archive boundary, rollout prerequisites and evidence limitations |
| `docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md` | This execution record |

### Identity contract, approval boundary and unresolved identity work

Both `repository_id` and `repository_owner_id` must be **strings** matching
`^[1-9][0-9]*$` in policy and verified payload and must strictly equal their
independent expectations. No numeric conversion, owner-name/repository/
`sub` inference or request-body/producer fallback is used. IDs beyond
JavaScript's safe-number range remain exact strings. Missing/null, numeric
types, mismatch, leading zeroes, whitespace and unsupported forms reject.
Signed `repository_owner` must separately equal the owner component of the
pinned exact repository name; it never supplies the owner ID.

The preexisting server configuration/policy digest is the trust root,
not the new assertion or a local report. A bad/missing policy rejects
before JWT/JWKS or archive access; a bad verified identity rejects before
request-body processing. Errors expose fixed codes only. An old archive
policy lacking owner ID now fails closed: any future policy/pin rollout
must obtain independent IDs and approval, not add an automatic fallback.
No separate new OIDC policy schema or approval wire was invented.

JOSE signature/issuer/audience/time validation still precedes payload
identity use. The key-free assertion does not verify signatures or grant
approval. Policy-configured reusable identity still requires both exact
`job_workflow_ref` and `job_workflow_sha`, separate from caller workflow
and release source SHA. The existing policy only admits the old caller,
not Option A's new workflow. OIDC identity never attests eligibility-step
success. Actual repository subject/reusable settings, signed claim
availability and current official GitHub subject specification were not
externally inspected; **NOT_VERIFIED / NOT_CHECKED_OFFLINE**, with no
legacy/immutable `sub` assumption.

The bootstrap schema/draft are unchanged: 43 fields; source-derived 18,
diagnostic 3, static trust inputs 3, undefined contracts 19; legacy missing
list 22 (not a manual-input checklist). The owner string pattern already
matched this runtime contract; the draft remains null/`PROPOSED`.
The source diagnostic now says
`SOURCE_IMPLEMENTED_NOT_EXTERNALLY_OBSERVED`, not registered/approved.
The active policy pin remains **NOT_VERIFIED**. Preflight still reports
`SOURCE_CONTRACT_READY`, `BLOCKED_EXTERNAL_INPUTS`,
`BLOCKED_POLICY_NOT_APPROVED`, `BLOCKED_IMPLEMENTATION`,
`external_registration: NOT_VERIFIED`, `readiness.complete: false`.

### Commands, targets, side effects and results

All commands below run locally from the explicit repository root.
Before execution, each selected Node file and its direct imports was
checked for effects: unit helpers use synthetic payloads and in-memory
HTTP/authority/object/API/executor doubles. No real JWT signing, keys,
network, Worker host or build is used. The existing Worker-source tests
parse source fixtures and inject all build/I/O effects; they do not
compile Rust/WASM or start a Worker. The normal hook creates a local
temporary repository containing only the eleven commit paths and runs
local static graph analysis there.

| Validation | Result |
| --- | --- |
| Initial branch/HEAD and two explicit scope checks | **PASS**, expected branch/HEAD, no scoped changes |
| Seven key-free selectors, first run | **PASS 115 / FAIL 0 / skipped 0** (13 new + existing 91 + Worker-source 11) |
| Nine changed Node files, `node --check` | **PASS 9**, parse only |
| ADR-dependent classification/bootstrap selectors after documentation update | **PASS 28 / FAIL 0 / skipped 0**, exit 0 |
| Explicit working/staged whitespace, eleven paths including new files | **PASS**, exit 0; rechecked by the commit gate after this record update |
| Normal scoped hook and final committed whitespace | Required by the commit procedure below; actual result reported only after execution |
| RSA/JWKS integration in `scripts/release-archive-http.test.mjs` | **NOT_RUN**: module-load RSA key generation violates this task's constraints; no name filter bypass |
| Actual GitHub token/repository setting/active-pin acceptance, external services | **NOT_RUN**, prohibited; registration and acceptance **NOT_VERIFIED** |
| Cargo/Rust/WASM/APP/Worker/native builds/runtime and broader unreviewed suites | **NOT_RUN**, prohibited/outside scope |

There were **no failed test or syntax runs and no skipped assertions**.
No assertion was deleted/relaxed to avoid the new owner requirement.
The existing key-generating test was strengthened/aligned but not run.
The execution record's initial insertion point was corrected to preserve
historical ordering; no code/test fix was required after validation.

Initial metadata/scope command (PASS, exit 0):

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git branch --show-current && git rev-parse HEAD && git -c core.fsmonitor=false status --short --untracked-files=all -- packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc-claims.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.d.mts packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.d.ts scripts/release-archive-http.mjs scripts/release-execution-intake.mjs scripts/release-archive-http.test.mjs scripts/release-archive-oidc-claims.test.mjs scripts/release-provenance-fixture.mjs scripts/release-grant-delegation-classification.mjs scripts/release-grant-delegation-classification.test.mjs docs/architecture/adr-tlsn-grant-authority-delegation.md docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
```

Additional inventory target, before editing (PASS, no scoped changes):

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git -c core.fsmonitor=false status --short --untracked-files=all -- scripts/release-worker-source.mjs
```

Key-free regression (PASS 115/0/0, exit 0):

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH node --test scripts/release-archive-oidc-claims.test.mjs scripts/release-grant-delegation-classification.test.mjs scripts/release-grant-delegation.test.mjs scripts/release-eligibility.test.mjs scripts/release-provenance-grant.test.mjs scripts/release-workflow.test.mjs scripts/release-worker-source.test.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/oidc-owner-keyfree-tests.log 2>&1; result=$?; tail -n 30 /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/oidc-owner-keyfree-tests.log; exit "$result"
```

Parse-only validation (all nine PASS, exit 0; even the RSA fixture is not
executed by `--check`):

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && for file in packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc-claims.mjs scripts/release-worker-source.mjs scripts/release-provenance-fixture.mjs scripts/release-archive-http.test.mjs scripts/release-archive-oidc-claims.test.mjs scripts/release-grant-delegation-classification.mjs scripts/release-grant-delegation-classification.test.mjs; do env -u NODE_OPTIONS -u NODE_PATH node --check "$file" || exit; printf 'PASS node --check %s\n' "$file"; done
```

ADR-dependent revalidation after the documentation update
(PASS 28/0/0, exit 0):

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH node --test scripts/release-grant-delegation-classification.test.mjs scripts/release-grant-delegation.test.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/oidc-owner-doc-contract-tests.log 2>&1; result=$?; tail -n 18 /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/oidc-owner-doc-contract-tests.log; exit "$result"
```

Pre-commit working/staged whitespace, including both new files
(PASS, exit 0; explicitly scoped staging only, no hook bypass):

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
set -- packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc-claims.mjs scripts/release-worker-source.mjs scripts/release-provenance-fixture.mjs scripts/release-archive-http.test.mjs scripts/release-archive-oidc-claims.test.mjs scripts/release-grant-delegation-classification.mjs scripts/release-grant-delegation-classification.test.mjs docs/architecture/adr-tlsn-grant-authority-delegation.md docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --check -- "$@" && git -c core.fsmonitor=false add -- "$@" && git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --cached --check -- "$@"
```

### Preserved release/grant/native state

No grant API, issuance/authorization/persistence, CAS/revocation reader,
publication provider or eligibility-to-authority protocol was added or
enabled. The delegation draft is unapproved and the reusable workflow
remains fixed-disabled. Candidate/provider/consumer source contracts stay
fail closed, with only the documented owner requirement tightening
archive authentication/correlation. Existing `DERIVED_NOT_AUTHORIZED`,
`ARCHIVE_GRANT_AUTHORITY_READER_NOT_REGISTERED` and
`ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED` are unchanged.

| Check | Local contract | Actual production evidence |
| --- | --- | --- |
| `locked_dependencies` | Existing assertions maintained | **UNVERIFIED** |
| `compiled_inputs` | Existing assertions maintained, no build | **UNVERIFIED** |
| `archive_readback` | Owner/pin/consumer correlation tested; grant path **BLOCKED** | **UNVERIFIED** |
| `offline_verification` | `FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED` maintained | **UNVERIFIED**, formal native identity **BLOCKED** |

`publication_authorized: false`, deployment **NOT_CHECKED**, Production
acceptance **BLOCKED**. No real `RELEASE_ARTIFACTS_VALIDATED` or
`DEPLOYMENT_VERIFIED` is established by these unit/static checks.

### Eleven-path local commit procedure

The following exact procedure retains the normal scoped hook, disables
signing, checks whitespace and commits only these eleven paths. This is
not a push or trust registration. Hook/commit completion is reported from
the actual command outcome, not assumed by this procedure text.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
set -- packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc-claims.mjs scripts/release-worker-source.mjs scripts/release-provenance-fixture.mjs scripts/release-archive-http.test.mjs scripts/release-archive-oidc-claims.test.mjs scripts/release-grant-delegation-classification.mjs scripts/release-grant-delegation-classification.test.mjs docs/architecture/adr-tlsn-grant-authority-delegation.md docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --check -- "$@" && git -c core.fsmonitor=false add -- "$@" && git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --cached --check -- "$@" && git --no-pager -c core.fsmonitor=false -c commit.gpgsign=false commit --only -m "fix(tlsn): enforce archive OIDC repository owner identity" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" -- "$@" > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/oidc-owner-local-commit.log 2>&1; result=$?; tail -n 24 /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/oidc-owner-local-commit.log; exit "$result"
```

Final branch/commit/parent, explicit scope cleanliness (including unchanged
draft/workflow) and committed whitespace:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
set -- packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc-claims.mjs scripts/release-worker-source.mjs scripts/release-provenance-fixture.mjs scripts/release-archive-http.test.mjs scripts/release-archive-oidc-claims.test.mjs scripts/release-grant-delegation-classification.mjs scripts/release-grant-delegation-classification.test.mjs docs/architecture/adr-tlsn-grant-authority-delegation.md docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
git branch --show-current
git rev-parse HEAD HEAD^
git -c core.fsmonitor=false status --short --untracked-files=all -- "$@" scripts/tlsn-grant-delegation.draft.json scripts/tlsn-grant-delegation.v1.schema.json .github/workflows/tlsn-grant-delegation.yml
git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --check HEAD^ HEAD -- "$@"
```

## 2026-10-27: offline OIDC signature/claim integration fixture assessment

### Actual state and outcome

Start branch: `tlsn-first-testplay-candidate`.
Start HEAD: `365a1d078856c692eda2dd12ec3c961557b96acb`, matching the request.
Initial explicit scope and expanded helper/hook scope were clean.

**BLOCKED**: no provenance-known, test-only fixed signed JWT and matching
public JWK/JWKS usable by the current archive OIDC contract was found in
the checked source/test roots or shipped direct JOSE dependency.
**Signature/claim integration is NOT_RUN, not PASS.**
The integration implementation stops at this fixture prerequisite.
This is a diagnostic assessment, not a new runtime/public blocker enum.
It is not a repository-wide assertion about unchecked/private locations.

Only this roadmap is changed. Production verifier, fixtures, test
assertions, source inventory, schema, policy, workflow and dependencies
are unchanged. No token, key, credential, trust pin or signature was
generated, imported from an external service or registered.

### Fixed fixture search and provenance

The bounded search covered `scripts`, the verification Worker's `src`
and `scripts`, and the eight explicitly named test/fixture roots in the
commands below. Package/test directories were discovered with depth-two
metadata enumeration; it did not enumerate protected deeper source files.
No protected file was read, searched, compared, hashed, edited or staged.

| Candidate/source | Observation and disposition |
| --- | --- |
| `scripts/release-archive-http.test.mjs` | Synthetic local fixture, but module initialization calls `generateKeyPair("RS256")` twice, then exports public JWKs from those fresh keys. Each case uses `SignJWT.sign`; no persisted signed JWT/public JWKS pair is provided. **NOT_RUN and not imported** |
| `scripts/release-archive-oidc-claims.test.mjs` | Synthetic payload objects and `verifyToken` doubles, not signed JWT fixtures. Suitable for claim/HTTP/consumer contracts only |
| `scripts/release-provenance-fixture.mjs`, `release-check-fixture.mjs`, `release-consumer-fixture.mjs` | Synthetic token strings, public-input references and API/storage/executor doubles. No matching fixed signed RS256 OIDC JWT/JWKS |
| Other checked Worker fixture hits | Runtime/config fixtures generate Ed25519 keys; these are neither static OIDC JWT pairs nor permitted executions. Source inspection only |
| Installed direct `jose@6.1.2` | Worker manifest pins 6.1.2 and installed package metadata agrees. Resolved path is `node_modules/.pnpm/jose@6.1.2/node_modules/jose`. Its shipped files are runtime JS, type declarations, README/license/package metadata; no test/fixture files or fixed signed JWT/RSA JWK pair found |
| JOSE PEM search hit | Only PEM type-prefix checks in `dist/webapi/key/import.js`, not actual key material or a token fixture |
| Other eight test/fixture roots | No usable JWT/JWKS candidate found. A broad lexical search first matched three existing native `target/debug/.fingerprint` metadata paths; they were not used as fixtures. Repeating with target/dependency caches excluded returned no matches |

Dependency searches explicitly included ignored files with
`rg --no-ignore --hidden` and filesystem enumeration. Initial tool glob
results that omit ignored dependencies were not treated as absence proof.
No upstream checkout, package download/install, history-wide search,
session-log token recovery or external documentation/API request was used.

Making key generation lazy would still generate keys when a test runs;
it would not satisfy this task. There is no safe fixed-pair replacement
with which to remove the legacy test's side effects while preserving its
signature assertions. That test remains unchanged and unexecuted.
No substitute verifier, signature mock presented as crypto proof,
test-only authorization success path or permissive policy was added.

### Production verification trace: source evidence, not executed crypto

| Stage | Actual source path and order |
| --- | --- |
| Policy root | `handleArchiveHttp` requires server-configured canonical policy bytes and an independent matching digest before token processing. Body/producer labels cannot supply that pin |
| Token/header | `createArchiveOidcVerifier` validates policy, token type/size, then decodes only the protected header. RS256, bounded nonempty `kid`, optional `typ: JWT` and the existing header-key allowlist are required. JOSE's compact verifier also checks the three-part structure |
| Issuer/key source | Fixed GitHub issuer and its fixed JWKS URL. Existing `fetchKeys` injection is wrapped by the exact-URL check, redirect refusal, 200/non-redirect response requirement and 64 KiB body bound. Token `jku`/`jwk`/`x5u` cannot select another trust source |
| Algorithm/key selection | `jwtVerify` receives `algorithms: ["RS256"]`. JOSE `jwks/local.js` selects RSA keys by `kid` and optional algorithm/use/key-ops constraints and imports only public keys |
| Actual cryptographic path | `jwtVerify` -> `compactVerify` -> `flattenedVerify` -> JOSE `lib/verify.js` -> `crypto.subtle.verify`. JOSE rejects failed signatures before returning a verified payload |
| Registered claims/time | After compact signature verification, JOSE `validateClaimsSet` parses/validates the JWT claims, issuer, audience, required claims, `nbf`/`exp`/`iat`, maximum age and bounded clock tolerance. Existing `currentDate: new Date(nowMs)` allows fixed-time validation without changing token bytes |
| Repository/owner | Only after `await jwtVerify` does `assertVerifiedArchiveOidcClaims` compare exact repository, canonical string repository/owner IDs and owner-name consistency against independent policy. Names, body and `sub` do not supply IDs |
| Caller/reusable/run | Caller workflow/event/ref, workflow SHA and run/attempt checks remain; configured reusable identity requires both exact signed job workflow claims. `handleArchiveHttp` separately compares workflow/run context against its independent archive transport grant |
| HTTP binding/consumer | After authority catalog and exact archive readback checks, `archiveAuthorization` includes pinned owner ID and policy digest. `verifyArchiveHttpResponse` independently compares exact metadata, catalog identity and raw bytes; owner omission/tampering rejects |

The unverified payload is not used as an identity decision. Constructing
the JOSE remote key set at import does not fetch keys; lookup/reload does.
The existing factory already supports local JWKS response injection
without changing signature verification, and the HTTP handler already
supports a test verifier/time dependency. No new injection seam is needed.
The fixture absence, not missing clock/transport injection, is the blocker.

### What was and was not verified

| Boundary/cases | This task's evidence |
| --- | --- |
| Strict repository/owner IDs, missing/mismatched/wrong-type IDs, owner-name mismatch, configured job claims | Existing synthetic claim-policy assertions: **PASS**, not cryptographically authenticated payloads |
| Request-body self-assertion, missing/mismatched policy pin, `PROPOSED` policy, owner response binding mutation | Existing local helper/HTTP/consumer assertions: **PASS**, test verifier/API/storage doubles |
| Real valid RS256 fixed JWT -> current verifier -> owner policy -> HTTP response -> consumer | **NOT_RUN / BLOCKED**, no compatible fixed signed pair |
| Invalid signature/different public key, unknown kid, malformed JWKS, unsupported algorithm through the real verifier | **NOT_RUN**, no authenticated fixed baseline/pair; no synthetic rejection is represented as signature coverage |
| Signed issuer/audience/expiry/nbf/iat mismatch and signed identity/reusable negative variants | **NOT_RUN** in crypto integration; synthetic policy checks do not replace these cases |
| Actual GitHub issuer keys/identity, repository subject settings, real reusable claims and active policy pin | **NOT_VERIFIED**, external observation prohibited |
| Changed-module syntax checks | **NOT_RUN / not applicable**, no Node module changed; prior `node --check` evidence is not signature proof |

Existing claim-policy test: **13 PASS / 0 FAIL / 0 skipped**, unchanged
assertions, no new test count. Its verified-payload assertion is invoked
on synthetic objects; its HTTP tests inject `verifyToken` doubles.
The default signature verifier is not exercised by those tests.
There were no failed tests, no skipped assertions and no code fixes.
Search exit 1 below means normal "no matches", not a test failure.

To resume under the same restrictions, an independently provenance-known,
explicitly test-only **pre-existing** compact RS256 JWT plus its matching
public JWKS is required, with acceptable header/kid, fixed-time validity,
the exact current issuer/audience and repository/owner/caller/run claims.
Configured job workflow tests also need compatible signed job claims.
Keep fixture keys out of Production registration. A generic RSA vector
with incompatible claims cannot prove this Production verifier chain.
Changing signed payload/header bytes invalidates the signature:
post-signature negative-claim coverage needs corresponding pre-signed
variants, not re-signing or relabeling signature failure as policy failure.
No such pair or variants were obtained or fabricated here.

### Exact local commands and outcomes

All commands ran from the explicit repository root; reads were bounded
to the source/dependency/test paths described above. No package script,
build, Worker host or native verifier was run. The selected Node test
uses synthetic data/in-memory doubles; its source and helper imports
were checked before execution. Only local hashes/parse-only fixture
inspection are used, not key generation/signing or real service calls.

Initial branch/HEAD/scope: **PASS**, expected branch/HEAD, no scope changes:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git branch --show-current && git rev-parse HEAD && git -c core.fsmonitor=false status --short --untracked-files=all -- packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc-claims.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http.d.mts packages/FUSOU-TLSN-VERIFICATION-WORKER/package.json scripts/release-archive-http.mjs scripts/release-archive-http.test.mjs scripts/release-archive-oidc-claims.test.mjs scripts/release-worker-source.mjs docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
```

Dependency resolution: **PASS**, Worker link resolves to installed 6.1.2;
the root-level leaf resolution alone is not package/fixture evidence:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && readlink -f packages/FUSOU-TLSN-VERIFICATION-WORKER/node_modules/jose && readlink -f node_modules/jose
```

Safe-depth metadata discovery: **PASS**, eight test/fixture roots listed:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && find packages -mindepth 2 -maxdepth 2 -type f -name package.json -print && find packages -mindepth 2 -maxdepth 2 -type d \( -name test -o -name tests -o -name fixtures -o -name __tests__ \) -print
```

Installed dependency fixture/example discovery: exit 0; only package
metadata and the PEM syntax-check source matched, **no usable fixture**:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && find node_modules/.pnpm/jose@6.1.2/node_modules/jose -type f \( -iname '*test*' -o -iname '*fixture*' -o -iname '*.json' -o -iname '*.pem' -o -iname '*.jwt' -o -iname '*.jwk' -o -iname '*.jwks' \) -print; rg --no-ignore --hidden -l -g '*.{js,ts,md,json}' 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|BEGIN (RSA |EC )?(PUBLIC|PRIVATE) KEY|"kty"\s*:\s*"RSA"' node_modules/.pnpm/jose@6.1.2/node_modules/jose
```

Explicit repository roots: exit 0; three source/test identifier hits,
**no fixed signed pair**:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && rg --no-ignore --hidden -l -g '*.{mjs,cjs,js,ts,tsx,json,jwt,jwk,jwks,txt,pem,rs,md,yaml,yml}' 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|"kty"\s*:\s*"RSA"|BEGIN (RSA |EC )?(PUBLIC|PRIVATE) KEY|JWKS|RS256|SignJWT' scripts packages/FUSOU-TLSN-VERIFICATION-WORKER/src packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts packages/avro-wasm/test packages/FUSOU-WORKFLOW/test packages/FUSOU-WEB/test packages/FUSOU-URL-SHORTER/test packages/FUSOU-TLSN-VERIFIER/tests packages/FUSOU-TLSN-VERIFIER/fixtures packages/kc_api/tests packages/fusou-compaction-trigger/test
```

Dependency hit classification: **PASS**, only PEM format-prefix checks:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && rg --no-ignore --hidden -n -C 2 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|BEGIN (RSA |EC )?(PUBLIC|PRIVATE) KEY|"kty"\s*:\s*"RSA"' node_modules/.pnpm/jose@6.1.2/node_modules/jose/dist/webapi/key/import.js
```

Broader/split-fixture lexical search: exit 0, only three existing
`target/debug/.fingerprint` metadata hits, not test token/key material:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && rg --no-ignore --hidden -l -g '*.{mjs,cjs,js,ts,tsx,json,jwt,jwk,jwks,txt,pem,rs,md,yaml,yml}' 'RSA|[Jj][Ww][Tt]|[Jj][Ww][Kk]|jsonwebtoken|compactVerify|\bkty\b|token\.actions\.githubusercontent\.com' packages/avro-wasm/test packages/FUSOU-WORKFLOW/test packages/FUSOU-WEB/test packages/FUSOU-URL-SHORTER/test packages/FUSOU-TLSN-VERIFIER/tests packages/FUSOU-TLSN-VERIFIER/fixtures packages/kc_api/tests packages/fusou-compaction-trigger/test
```

Expanded helper/hook status before running the unchanged key-free test:
**PASS**, no changes:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git -c core.fsmonitor=false status --short --untracked-files=all -- 'scripts/release-*.mjs' 'packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-*.mjs' packages/FUSOU-TLSN-VERIFICATION-WORKER/src/origin-trust-contract.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-trust-contract.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-build-handoff.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-public-configuration.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/wasm-provenance.mjs .githooks/pre-commit scripts/scoped_code_review_graph.py
```

Final test-source search with native/dependency caches excluded:
exit **1 (no matches)**, not a test failure:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && rg --no-ignore --hidden -l -g '*.{mjs,cjs,js,ts,tsx,json,jwt,jwk,jwks,txt,pem,rs,md,yaml,yml}' -g '!**/target/**' -g '!**/node_modules/**' 'RSA|[Jj][Ww][Tt]|[Jj][Ww][Kk]|jsonwebtoken|compactVerify|\bkty\b|token\.actions\.githubusercontent\.com' packages/avro-wasm/test packages/FUSOU-WORKFLOW/test packages/FUSOU-WEB/test packages/FUSOU-URL-SHORTER/test packages/FUSOU-TLSN-VERIFIER/tests packages/FUSOU-TLSN-VERIFIER/fixtures packages/kc_api/tests packages/fusou-compaction-trigger/test
```

Unchanged claim-policy regression, **PASS 13 / FAIL 0 / skipped 0**, exit 0:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH node --test scripts/release-archive-oidc-claims.test.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/oidc-fixed-fixture-claims.log 2>&1; result=$?; tail -n 18 /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/oidc-fixed-fixture-claims.log; exit "$result"
```

### Unchanged authority/readiness and local commit procedure

Delegation remains `PROPOSED`/unapproved, the reusable workflow
fixed-disabled and the active trust pin **NOT_VERIFIED**.
`DERIVED_NOT_AUTHORIZED`,
`ARCHIVE_GRANT_AUTHORITY_READER_NOT_REGISTERED`,
`ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED` and
`FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED` are unchanged.
All four real checks (`locked_dependencies`, `compiled_inputs`,
`archive_readback`, `offline_verification`) remain **UNVERIFIED**.
`publication_authorized: false`, deployment **NOT_CHECKED**, Production
acceptance **BLOCKED**. No real `RELEASE_ARTIFACTS_VALIDATED` or
`DEPLOYMENT_VERIFIED` is established.

All signature/JWKS integration, real GitHub/OIDC/settings/active pins,
Cloudflare/R2/Notary/Session Authority, key generation/signing, package
installation, Cargo/Rust/WASM/APP/Worker/native build/runtime,
deploy/publish/push/PR/tag and broader suites are **NOT_RUN**.
The completed authoritative Result-byte-binding test is unchanged.

Working/staged whitespace check is restricted to this roadmap:
**PASS**, exit 0; repeated by the commit gate after this record update.
The normal hook must analyze only this one documentation path in its local
isolated repository; no hook bypass or signing is used. Actual
hook/commit/committed-whitespace completion is reported from execution,
not inferred from this procedure.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --check -- docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md && git -c core.fsmonitor=false add -- docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md && git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --cached --check -- docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
```

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --check -- docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md && git -c core.fsmonitor=false add -- docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md && git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --cached --check -- docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md && git --no-pager -c core.fsmonitor=false -c commit.gpgsign=false commit --only -m "docs(tlsn): record blocked offline OIDC signature integration" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" -- docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/oidc-fixed-fixture-local-commit.log 2>&1; result=$?; tail -n 20 /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/oidc-fixed-fixture-local-commit.log; exit "$result"
```

Post-commit metadata, explicit scope cleanliness and committed whitespace:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
git branch --show-current
git rev-parse HEAD HEAD^
git -c core.fsmonitor=false status --short --untracked-files=all -- docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md 'scripts/release-*.mjs' 'packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-*.mjs' packages/FUSOU-TLSN-VERIFICATION-WORKER/package.json scripts/tlsn-grant-delegation.draft.json scripts/tlsn-grant-delegation.v1.schema.json .github/workflows/tlsn-grant-delegation.yml
git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --check HEAD^ HEAD -- docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
```

## 2026-10-28: public RS256 reference assessed without external access

### Actual starting state and distinct prerequisite

Start/end branch: `tlsn-first-testplay-candidate`.
Start HEAD: `c5aaad95a01b75632fc2b438b848e946c229284b`, matching request.
Initial explicit scope, lockfile scope and scoped-hook scope were clean.

The requested generic-vector goal does **not** require a GitHub OIDC
positive fixture. A public generic RS256 vector could establish its own
signature and separately demonstrate unchanged GitHub rejection.
The blocker here is earlier: the referenced document's actual fixed
JWT/public-key bytes and immutable local source cannot be established.
No vector was adopted, and no crypto/rejection integration was run.
This is not rejection of a generic fixture for lacking GitHub claims.

The supplied reference is
`https://github.com/panva/jose/blob/main/src/jwt/verify.ts`.
It was **not fetched**. `main` is mutable; no release/commit content or
token/key bytes can be inferred from that URL. No offline copy of that
source/example was found in the bounded locations checked below.
No claim of global absence in uninspected locations is made.

### Local source/provenance findings

- The Worker's manifest and committed root lockfile both pin
  `jose@6.1.2`; the installed Worker link resolves to that package.
  The committed lock includes its package integrity, but that integrity
  is **not** a digest/provenance proof for an absent example vector.
- The installed 6.1.2 `dist/types/jwt/verify.d.ts` contains declarations
  and API descriptions, not the fixed token/public-key example. Its
  runtime counterpart is compiled verification code, not the source
  document. README links to `docs/jwt/verify/functions/jwtVerify.md`;
  that document and `src/jwt/verify.ts` are not shipped locally.
- Metadata enumeration also found installed directories named
  `jose@5.10.0` and `jose@6.2.12`. Searching these explicit package
  roots for compact JWT/example markers found no candidate. The
  inspected 5.10.0 verifier declaration also lacks the example.
  No runtime dependency was switched to either version.
- A bounded source/example filename search over all three package
  roots returned no matching source/example documents. A scoped
  repository source/doc search found no copy of the supplied reference,
  example issuer/audience markers or fixed compact JWT.
- The legacy `release-archive-http.test.mjs` still generates RSA keys
  during initialization and signs case tokens. It was inspected only,
  not imported/run, reused as a public fixed vector or modified.

| Fixture attribute | Evidence in this task |
| --- | --- |
| Adopted token/public SPKI/JWK | None |
| Immutable published source/version for the referenced example | **NOT_VERIFIED**, no locally available example bytes |
| Fixture SHA-256 | **NOT_RUN**, no adopted bytes; do not hash a URL, type declaration or package integrity and call it a vector digest |
| Exact `iss`, `aud`, `iat`, header, signature and required time claims | **NOT_CHECKED**, no local token to parse |
| Actual repository/owner claim absence in that token | **NOT_CHECKED**; the user describes a generic example, but its unavailable bytes were not independently inspected |
| Public-key/token signature correspondence | **NOT_RUN**, no known pair |

No example was reconstructed from memory, private key read, key generated,
token signed/re-signed, package installed, upstream source downloaded or
external API/provider contacted. A safe continuation needs an offline
copy containing the published original token and public key with source
identification/version/commit evidence; a mutable URL alone is insufficient.

### Source boundary and outcome classification

The unchanged production factory `createArchiveOidcVerifier` validates
policy and header before calling the locked `jwtVerify`; fixed RS256,
issuer, audience, required claims, maximum token age and fixed-time
mechanism remain intact. Only successful JOSE verification reaches
`assertVerifiedArchiveOidcClaims`. HTTP processing validates the independent
policy pin before authentication, and generates `archiveAuthorization`
only after authentication, independent context/catalog and raw readback
checks. Consumer exact metadata comparison still binds the pinned owner.

No new signature verifier, test-only authorization path or policy
exception was introduced. Fixed time cannot supply absent mandatory
claims/header fields; adding them would change signed bytes. Any future
test must record the actual first refusal stage, not relabel a header or
signature failure as post-signature owner-policy evidence.

These are diagnostic result categories, **not Production readiness**:

| Requested category/boundary | Actual result |
| --- | --- |
| `STATIC_VECTOR_VERIFIED` | **NOT_RUN / BLOCKED**, vector provenance/bytes unavailable locally |
| `OIDC_CLAIM_POLICY_REJECTED` for the public fixed vector | **NOT_RUN**, no adopted token; source refusal conditions are unchanged, not runtime rejection evidence |
| `GITHUB_OIDC_POSITIVE_INTEGRATION_BLOCKED` | **BLOCKED**, still no signed GitHub repository/owner positive integration; not this task's generic-vector objective |
| `PRODUCTION_TRUST_NOT_VERIFIED` | **NOT_VERIFIED**, real repository settings/subject/reusable claims/active pins and actual GitHub identity unobserved |
| Signature corruption and different-public-key rejection | **NOT_RUN**, no valid fixed baseline or second public vector/key adopted |
| HTTP binding generation/refusal/consumer test for that fixed JWT | **NOT_RUN**, no assertion of an exercised fixed-token HTTP path |

Only this roadmap is changed. Existing key-free assertions and all
production source, inventory, dependency, schema, policy and workflow
files are unchanged. The earlier **13 PASS** claim-policy result belongs
to the previous task; it is **not rerun or counted as new evidence here**.
No Node test or `node --check` was run in this documentation-only outcome.
There were no failed tests, skipped assertions or code/test fixes.
The two `rg` exit-1 results below are ordinary no-match discovery outcomes,
not test failures.

### Exact local commands and results

All commands use explicit safe paths. The source/doc inspections were
read-only and did not evaluate package modules. No protected files were
read, searched, compared, hashed, edited, staged or committed.

Initial metadata/scope: **PASS**, requested branch/HEAD, clean scope:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git branch --show-current && git rev-parse HEAD && git -c core.fsmonitor=false status --short --untracked-files=all -- packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc-claims.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/package.json scripts/release-archive-oidc-claims.test.mjs scripts/release-archive-http.test.mjs docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
```

Installed-version metadata/resolution: **PASS**, three named directories,
Worker resolves to 6.1.2:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && find node_modules/.pnpm -mindepth 1 -maxdepth 1 -type d -name 'jose@*' -print && readlink -f packages/FUSOU-TLSN-VERIFICATION-WORKER/node_modules/jose
```

Pinned package source/docs/example search: file enumeration exit 0,
`rg` exit **1 (no matches)**; only package metadata, verifier declaration
and compiled verifier were listed, not the referenced source/document:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && find node_modules/.pnpm/jose@6.1.2/node_modules/jose -maxdepth 5 -type f \( -path '*/src/jwt/verify.ts' -o -path '*/docs/jwt/verify/*' -o -path '*/jwt/verify.*' -o -name package.json \) -print; rg --no-ignore --hidden -l -g '*.{js,ts,md,json}' 'urn:example:(issuer|audience)|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A' node_modules/.pnpm/jose@6.1.2/node_modules/jose
```

Other named installed packages: `rg` exit **1 (no matches)**:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && rg --no-ignore --hidden -l -g '*.{js,ts,md,json}' 'urn:example:(issuer|audience)|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A' node_modules/.pnpm/jose@5.10.0/node_modules/jose node_modules/.pnpm/jose@6.2.12/node_modules/jose
```

Lockfile scope and committed pins: **PASS**, scope clean, committed
5.10.0/6.1.2 entries observed; no manifest/lock edits or install:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git -c core.fsmonitor=false status --short --untracked-files=all -- pnpm-lock.yaml && git --no-pager show HEAD:pnpm-lock.yaml | rg -n -A 3 'jose@5\.10\.0:|jose@6\.1\.2:'
```

Three-package source/example filenames: exit 0, **no matches**:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && find node_modules/.pnpm/jose@5.10.0/node_modules/jose node_modules/.pnpm/jose@6.1.2/node_modules/jose node_modules/.pnpm/jose@6.2.12/node_modules/jose -maxdepth 5 -type f \( -path '*/src/jwt/verify.ts' -o -path '*/docs/jwt/verify/*' -o -iname '*example*' \) -print
```

Additional bounded `view`/`rg` inspections covered the listed archive
modules, legacy RSA test initialization, 5.10.0/6.1.2 declarations,
6.1.2 README, Worker manifest and previous roadmap entry. Repository
`rg` used pattern
`panva/jose/blob/main/src/jwt/verify\.ts|urn:example:(issuer|audience)|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`,
glob `*.{mjs,ts,md,json}`, and only `scripts`, Worker `src`/`scripts`,
`docs/architecture`, `docs/implementation-plans`: **no matches** before
this new record was added.

Normal hook implementation scope: **PASS**, unchanged:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git -c core.fsmonitor=false status --short --untracked-files=all -- .githooks/pre-commit scripts/scoped_code_review_graph.py
```

### Preserved state and one-path local commit procedure

Delegation stays `PROPOSED`/unapproved, reusable workflow fixed-disabled.
`DERIVED_NOT_AUTHORIZED`,
`ARCHIVE_GRANT_AUTHORITY_READER_NOT_REGISTERED`,
`ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED` and
`FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED` are maintained.
All four real checks remain **UNVERIFIED**; `publication_authorized: false`,
deployment **NOT_CHECKED**, Production acceptance **BLOCKED**.
No real `RELEASE_ARTIFACTS_VALIDATED` or `DEPLOYMENT_VERIFIED` is established.
No `sub` format, actual reusable claim availability or active pin
registration is assumed.

All vector signature/claim/HTTP tests, key-generating suites, changed-module
syntax checks (no module changed), external fetch/API/provider/service
access, package installation, keys/signatures, Cargo/Rust/WASM/APP/Worker/
native build/runtime, deploy/publish/push/PR/tag are **NOT_RUN**.
No Result-byte-binding test or Hudsucker/default/dependency was changed.

The working/staged whitespace check below targets only this roadmap:
**PASS**, exit 0. The commit repeats it after this result update,
retains the normal scoped hook, disables signing
and isolates only this one documentation file. Actual hook/commit/final
committed-whitespace completion is reported from execution, not assumed
from this procedure text.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --check -- docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md && git -c core.fsmonitor=false add -- docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md && git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --cached --check -- docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
```

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --check -- docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md && git -c core.fsmonitor=false add -- docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md && git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --cached --check -- docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md && git --no-pager -c core.fsmonitor=false -c commit.gpgsign=false commit --only -m "docs(tlsn): record unavailable offline public RS256 vector" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" -- docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/public-rs256-vector-local-commit.log 2>&1; result=$?; tail -n 20 /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/public-rs256-vector-local-commit.log; exit "$result"
```

Final branch/HEAD/parent, explicit scope cleanliness and committed whitespace:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
git branch --show-current
git rev-parse HEAD HEAD^
git -c core.fsmonitor=false status --short --untracked-files=all -- docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md pnpm-lock.yaml packages/FUSOU-TLSN-VERIFICATION-WORKER/package.json 'packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-*.mjs' scripts/release-archive-http.test.mjs scripts/release-archive-oidc-claims.test.mjs scripts/tlsn-grant-delegation.draft.json scripts/tlsn-grant-delegation.v1.schema.json .github/workflows/tlsn-grant-delegation.yml
git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --check HEAD^ HEAD -- docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
```

## 2026-10-28: supplied fixed RS256 vector verified with locked JOSE

### Actual start, scope and fixture provenance

Branch: `tlsn-first-testplay-candidate`.
Start HEAD: `2c407ccd49d8b81a71d0bcd935f944c3f0185326`, matching request.
Initial explicit source/test/lock/hook scope was clean. Expanded helper
status before testing showed only the two expected new Node files.

The user supplied the complete public JWT/SPKI bytes, their SHA-256 pins
and an immutable upstream reference:
`https://github.com/panva/jose/blob/bafcb74f5fc070f4f5fd48b12c8bb90af832385e/src/jwt/verify.ts`.
Source repository: `panva/jose`; commit:
`bafcb74f5fc070f4f5fd48b12c8bb90af832385e`; path: `src/jwt/verify.ts`.
The user attests upstream commit metadata and independent RSA verification.
This task did not fetch or independently authenticate that upstream
metadata. It independently verified the supplied byte pins and signature
locally with the locked JOSE dependency. The earlier offline-source
blocker is resolved for **generic RS256 only**, not GitHub positive OIDC.

Three files are added/changed:

| File | Purpose |
| --- | --- |
| `scripts/release-archive-rs256-fixture.mjs` (new) | Frozen test-only public JWT/SPKI values and user-supplied immutable source metadata; no private key or generated material |
| `scripts/release-archive-rs256.test.mjs` (new) | Seven focused tests using real JOSE, digest gates, signature mutation, unchanged claim policy and HTTP/client refusal |
| This roadmap | Exact provenance, measured results, commands and remaining boundaries |

The JWT is a single ASCII string with no whitespace/newline. SPKI is an
LF-only UTF-8 string with no trailing newline. Digests below apply to the
**exported values' bytes**, not the JavaScript container file. Each crypto
test checks the original pins before public-key import. Separate drift
tests reject a JWT newline, SPKI trailing newline and CRLF conversion.
Only a derived negative token changes one signature character; the
original header/payload/signature and public SPKI remain unchanged.

| Byte identity | SHA-256, independently matched by tests |
| --- | --- |
| JWT ASCII bytes | `16a7986eb30312746c1b11f7559c30aa491b3d00209423ab16e3a6440567853c` |
| SPKI UTF-8 bytes, LF/no final LF | `5b21737c49135c0e17dfd44fe8b99842086718b3a9963552c95fed9d938166ed` |

Actual protected header is exactly `{ "alg": "RS256" }`: **no kid**.
Actual verified payload is exactly four fields:
`urn:example:claim: true`, `iat: 1669056488`,
`iss: urn:example:issuer`, `aud: urn:example:audience`.
There is **no exp**, repository/owner identity, caller/reusable workflow
identity or run/attempt. These are assertions over the real verified
payload, not a decoded unverified payload grafted into a GitHub identity.

### Real verification and refusal boundaries

The new test imports the existing Worker's JOSE webapi entry, asserting
installed package version and Worker dependency pin are both **6.1.2**;
the existing root lock importer pins that version. No dependency or
manifest/lock change was made.

`importSPKI(spki, "RS256")` imports only the public key.
Real `jwtVerify` verifies the original compact token with
`algorithms: ["RS256"]`, its published generic issuer/audience,
required `iat`/`iss`/`aud`, zero clock tolerance, maximum age 60 seconds,
and fixed time **1669056489000 ms** (iat + one second).
This generic test does not require the absent `exp`; **Production still
does**. Additional real JOSE tests reject a required-but-absent `exp`,
GitHub issuer mismatch, archive audience mismatch, age 61 seconds and
future iat. No clock or signed bytes are modified to evade those rules.

The same real verifier rejects the derived signature-only mutation with
`ERR_JWS_SIGNATURE_VERIFICATION_FAILED`. Mathematical signature
verification and public-key import are **not mocked**. Test tripwires
block global fetch and WebCrypto key generation/signing, and assert no
such attempted calls; production JWKS uses an explicit fail-if-called
local dependency as well. Fixtures/API/storage/executors are local
doubles, not a Worker host, build or native verifier.

The valid generic payload is passed **unchanged** to the existing
`assertVerifiedArchiveOidcClaims` with a fully validated independent
synthetic archive policy. It rejects with `ARCHIVE_OIDC_CLAIMS_INVALID`.
Its audience differs and repository/owner claims are absent. The
audience comparison is first and short-circuits: this is **whole-policy
refusal, not isolated evidence that owner comparison was reached**.
The existing 13 key-free tests separately preserve strict owner/repository
checks with synthetic payloads and matching-audience cases. No issuer,
audience, required identity or `sub` rule was weakened to force traversal.

For the original token, actual `createArchiveOidcVerifier` rejects at
the mandatory **kid header gate**, before JOSE/JWKS or issuer/time/owner
checks. Real `handleArchiveHttp` returns 401 with only
`ARCHIVE_OIDC_HEADER_INVALID`, for both an ordinary request and a body
self-asserting repository/owner IDs and approval. `acquireArchiveHttp`
rejects the local 401 before returning acquisition/consumer input.
JWKS, authority and object read counters all remain **zero**; no HTTP
authorization binding or success report is returned. Its synthetic
transport grant is valid at the fixed test time, so client refusal is
the observed HTTP refusal, not an expired client-side grant.

This is not an issuer/owner refusal *through* the production signature
path. No kid was added to the signed header, no payload claims were
filled from a body/record, and no test-only Production authorization
success path or alternate signature implementation was introduced.

| Diagnostic result | Actual evidence |
| --- | --- |
| `STATIC_VECTOR_VERIFIED` | **PASS**: exact supplied byte pins and actual JOSE 6.1.2 RS256 verification |
| `SIGNATURE_TAMPER_REJECTED` | **PASS**: real JOSE signature-verification failure, original vector preserved |
| `OIDC_CLAIM_POLICY_REJECTED` | **PASS**: real verified generic payload rejected by unchanged whole claim-policy function; audience-first limitation explicit |
| HTTP/client refusal | **PASS**: original token rejected at kid gate, 401/no binding/no acquisition result/no state/object/JWKS reads |
| `GITHUB_OIDC_POSITIVE_INTEGRATION_BLOCKED` | **BLOCKED**: no signed positive GitHub repository/owner fixture; not established by this public vector |
| `PRODUCTION_TRUST_NOT_VERIFIED` | **NOT_VERIFIED**: actual GitHub issuer keys/identity, repository subject settings, reusable claims and active policy pin unobserved |

These are test diagnostics, not new runtime/public readiness states.
Different-public-key refusal is **NOT_RUN**: no second existing public RSA
fixture was selected and none was generated. Production HTTP signature
or issuer/owner refusal after the kid gate, authorized binding from this
token and full release-consumer/report success are **NOT_RUN**, not PASS.

### Commands, effects, results and failure history

The two selected test modules and helper imports were inspected before
execution. Expanded metadata checks exclude protected paths. No private
key, key generation, signing, external connection, package install,
Cargo/Rust/WASM/APP/Worker/native build/runtime or broad package script
was used. The existing RSA key-generating test was read-only and
**NOT_RUN / not imported**, including filtered execution.

| Validation | Result |
| --- | --- |
| Initial metadata/scope | **PASS**, expected branch/HEAD, clean scoped files |
| Expanded helper status | **PASS**, only two expected untracked new modules |
| New fixture/test `node --check` | **PASS**, both modules, parse only |
| New seven tests plus unchanged key-free thirteen | **PASS 20 / FAIL 0 / skipped 0**, exit 0 |
| Three-path working/staged whitespace check below | **PASS**, exit 0; repeated at the commit gate after this result is recorded |
| Existing RSA/JWKS key-generating suite | **NOT_RUN**, prohibited key generation/signing |
| Production/native/network/deployment verification | **NOT_RUN**, prohibited/outside scope |

There were **no failed test/syntax runs, no skipped assertions and no
post-validation code/test fixes**. Existing claim-policy assertions are
unchanged. No real `RELEASE_ARTIFACTS_VALIDATED` or `DEPLOYMENT_VERIFIED`
is established.

Initial branch/HEAD/scope (exit 0):

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git branch --show-current && git rev-parse HEAD && git -c core.fsmonitor=false status --short --untracked-files=all -- scripts/release-archive-rs256-fixture.mjs scripts/release-archive-rs256.test.mjs scripts/release-archive-oidc-claims.test.mjs scripts/release-archive-http.test.mjs scripts/release-provenance-fixture.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc-claims.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/package.json pnpm-lock.yaml docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md .githooks/pre-commit scripts/scoped_code_review_graph.py
```

Expanded safe helper scope (exit 0, expected two new files only):

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git -c core.fsmonitor=false status --short --untracked-files=all -- 'scripts/release-*.mjs' 'packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-*.mjs' packages/FUSOU-TLSN-VERIFICATION-WORKER/src/origin-trust-contract.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-trust-contract.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-build-handoff.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-public-configuration.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/wasm-provenance.mjs
```

New-module parse-only checks (both PASS, exit 0):

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH node --check scripts/release-archive-rs256-fixture.mjs && env -u NODE_OPTIONS -u NODE_PATH node --check scripts/release-archive-rs256.test.mjs
```

Focused real-crypto and key-free regression (20/0/0, exit 0):

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH node --test scripts/release-archive-rs256.test.mjs scripts/release-archive-oidc-claims.test.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/fixed-rs256-contract-tests.log 2>&1; result=$?; tail -n 28 /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/fixed-rs256-contract-tests.log; exit "$result"
```

### Unchanged authority/readiness and three-path local commit procedure

Production source, caller/delegated workflows, trust inputs, source
inventory, policy/schema, grant/provider/reader and native identity
contracts are unchanged. This test-only fixture is not imported by the
Worker or registered as a GitHub/Production key.
Delegation stays `PROPOSED`/unapproved, reusable workflow fixed-disabled.
`DERIVED_NOT_AUTHORIZED`,
`ARCHIVE_GRANT_AUTHORITY_READER_NOT_REGISTERED`,
`ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED` and
`FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED` are maintained.
The four real checks (`locked_dependencies`, `compiled_inputs`,
`archive_readback`, `offline_verification`) remain **UNVERIFIED**.
`publication_authorized: false`, deployment **NOT_CHECKED**, Production
acceptance **BLOCKED**. No Result-byte-binding test or Hudsucker/default/
dependency was changed. No upstream commit metadata, GitHub/provider,
Cloudflare/R2/Notary/Session Authority or trust registry was contacted.

Working/staged whitespace targets only these three paths. The commit
repeats the gate, retains the normal scoped hook, disables signing and
isolates only the three selected files. Actual hook/commit/committed
whitespace completion is reported from execution, not assumed below.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
set -- scripts/release-archive-rs256-fixture.mjs scripts/release-archive-rs256.test.mjs docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --check -- "$@" && git -c core.fsmonitor=false add -- "$@" && git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --cached --check -- "$@"
```

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
set -- scripts/release-archive-rs256-fixture.mjs scripts/release-archive-rs256.test.mjs docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --check -- "$@" && git -c core.fsmonitor=false add -- "$@" && git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --cached --check -- "$@" && git --no-pager -c core.fsmonitor=false -c commit.gpgsign=false commit --only -m "test(tlsn): verify supplied public RS256 vector offline" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" -- "$@" > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/fixed-rs256-local-commit.log 2>&1; result=$?; tail -n 22 /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/fixed-rs256-local-commit.log; exit "$result"
```

Final branch/HEAD/parent, explicit scope cleanliness and committed whitespace:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
git branch --show-current
git rev-parse HEAD HEAD^
git -c core.fsmonitor=false status --short --untracked-files=all -- scripts/release-archive-rs256-fixture.mjs scripts/release-archive-rs256.test.mjs docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md pnpm-lock.yaml packages/FUSOU-TLSN-VERIFICATION-WORKER/package.json 'packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-*.mjs' scripts/release-archive-http.test.mjs scripts/release-archive-oidc-claims.test.mjs scripts/tlsn-grant-delegation.draft.json scripts/tlsn-grant-delegation.v1.schema.json .github/workflows/tlsn-grant-delegation.yml
git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --check HEAD^ HEAD -- scripts/release-archive-rs256-fixture.mjs scripts/release-archive-rs256.test.mjs docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
```

## 2026-10-28: verified payload reaches the first repository identity refusal

### Actual start and bounded change

Branch: `tlsn-first-testplay-candidate`.
Start HEAD: `883ba0698a7eb0ef58e5184324d42f2a4044fa2c`, matching request.
The initial explicit scope was clean. Before execution, expanded safe
helper status showed only `scripts/release-archive-rs256.test.mjs` modified.

Only that test module and this roadmap change. The new eighth
fixed-vector test adds **one** case; all previous seven fixed-vector and
thirteen key-free assertions remain intact. Public fixture, JOSE
dependency/lock, Production verifier/policy/defaults, active pins,
draft/schema and workflows are unchanged.

The existing fixture still pins the user-supplied offline public vector
from `panva/jose` commit
`bafcb74f5fc070f4f5fd48b12c8bb90af832385e`, `src/jwt/verify.ts`.
No upstream metadata was fetched or independently authenticated here.
The reused digest gates still require JWT ASCII SHA-256
`16a7986eb30312746c1b11f7559c30aa491b3d00209423ab16e3a6440567853c`
and LF/no-final-newline SPKI UTF-8 SHA-256
`5b21737c49135c0e17dfd44fe8b99842086718b3a9963552c95fed9d938166ed`.
Both assertions and real signature verification pass in this run.

### Same verified payload, matching test expectation, measured refusal

The new test calls the existing test-local `verifyGeneric`, which checks
both pins, uses real `jose@6.1.2` `importSPKI` and `jwtVerify`, and retains
the published generic issuer/audience, fixed iat + one-second clock,
RS256 allowlist, required generic claims and age limit. It separately
asserts the successful verified header and exact four-field payload
before invoking identity policy.

`assertVerifiedArchiveOidcClaims` receives that **same returned payload
object** directly: no copy, decoded substitute, Proxy, added claim or
resigning. Exact payload equality is checked again after refusal.

The identity helper takes a policy and clock, not an issuer override;
issuer is already verified by real JOSE and explicitly matched in the
test. Its minimal test-only expected identity uses the existing
key-free contract: canonical repository, independent string repository/
owner IDs, workflow/event/ref and skew. Only its audience is the
published `urn:example:audience`, matching the verified payload.
`assertArchiveIdentityPolicy` explicitly accepts this input.
This is **not** an HTTP transport specification, registered policy or
active pin: full `validateArchiveTransportSpec` continues to require
audience equal to its HTTPS archive endpoint. Nothing is registered,
re-pinned or published for this test.

A transparent read-recording Proxy wraps **only the frozen test policy**,
returning every value unchanged. After explicit issuer/audience and
missing-claim assertions, its read trace is reset. During the actual
existing claim assertion, the trace suffix from `audience` is required
to equal exactly `["audience", "repository"]`. Thus the test verifies the
audience comparison was traversed and the first missing repository
identity comparison was reached; it does not merely infer the cause
from a generic error code.

The observed exception is the existing `ArchiveTransportError`, status
**401**, with both code and message **`ARCHIVE_OIDC_CLAIMS_INVALID`**.
There is no more specific repository error in the current API, and none
was invented. The first failing expression is
`payload.repository === policy.repository`: verified payload has no
repository and the expected repository is canonical/nonempty.
Repository-ID, owner-ID, workflow and expiration predicates are later
and are **not reached by this signed-payload case**.

The previous mismatched-audience test is retained as a separate case.
This new case closes that specific audience-first limitation only.
Its `OIDC_REPOSITORY_IDENTITY_REJECTED` test name is a diagnostic label,
not a new runtime error or Production readiness state.

### HTTP/consumer, owner and Production boundaries

The new pure identity assertion throws before returning; it invokes no
HTTP binding/report/grant creation. It is not a new successful HTTP or
authorization path. The unchanged fixed-vector HTTP/client test still
uses the original token and Production verifier: missing kid causes
401, no authorization response/acquisition output, and zero JWKS,
authority and object reads. That remains an **earlier header refusal**,
not the new repository refusal transported through Production HTTP.
No HTTP audience/pin rule or signature verifier is relaxed to combine
those distinct paths.

All thirteen existing key-free tests pass, including owner absence,
type/format errors, independent policy mismatch with matching repository
ID, body self-claims, HTTP refusal, consumer owner-binding mutation and
nonoperational grant/bootstrap blockers. These use synthetic payloads,
not signed GitHub owner claims. The legacy RSA/JWKS HTTP test has
top-level key generation and per-case signing, so it remains
**NOT_RUN / not imported**, including filtered execution.

No positive signed GitHub repository/owner token is tested:
**GITHUB_OIDC_POSITIVE_INTEGRATION_BLOCKED**.
Actual GitHub identity, repository OIDC/subject settings, actual reusable
workflow claims and active trust pin remain unverified:
**PRODUCTION_TRUST_NOT_VERIFIED**.

### Exact commands and measured results

Selected modules/direct helpers and ordinary scoped hook were inspected
before execution. Existing fixture APIs/storage/executors are local
doubles; global fetch and WebCrypto generate/sign tripwires are retained,
and their no-call assertion passes. Public-key import and mathematical
verification are not mocked. No private key, generated key, new JWT
signature, external connection, package install, build, Worker host or
native verifier was used. Protected paths were not accessed.

| Validation | Actual result |
| --- | --- |
| Initial explicit Git metadata/status | **PASS**, expected branch/HEAD, scoped files clean |
| Expanded helper status before Node execution | **PASS**, only expected test modification |
| Modified test module syntax | **PASS**, exit 0, parse only |
| Fixed-vector and key-free selected Node suites | **PASS 21 / FAIL 0 / skipped 0**, exit 0: eight fixed-vector plus thirteen key-free |
| Working/staged two-path whitespace gate | **PASS**, exit 0; repeated at commit after this result is recorded |
| Legacy key-generating RSA/JWKS suite | **NOT_RUN**, prohibited side effects |
| Positive GitHub OIDC / real trust / native / deployment | **NOT_RUN / BLOCKED**, not established by this test |

No test or syntax run failed; no assertion was weakened or skipped, and
there were no code corrections after successful validation.

Initial branch/HEAD and explicit scope:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git branch --show-current && git rev-parse HEAD && git -c core.fsmonitor=false status --short --untracked-files=all -- scripts/release-archive-rs256-fixture.mjs scripts/release-archive-rs256.test.mjs scripts/release-archive-oidc-claims.test.mjs scripts/release-archive-http.test.mjs scripts/release-archive-http.mjs scripts/release-provenance-fixture.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc-claims.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/package.json pnpm-lock.yaml docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md .githooks/pre-commit scripts/scoped_code_review_graph.py
```

Expanded safe helper status:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git -c core.fsmonitor=false status --short --untracked-files=all -- 'scripts/release-*.mjs' 'packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-*.mjs' packages/FUSOU-TLSN-VERIFICATION-WORKER/src/origin-trust-contract.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-trust-contract.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-build-handoff.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-public-configuration.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/wasm-provenance.mjs
```

Parse-only check (PASS):

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH node --check scripts/release-archive-rs256.test.mjs
```

Selected real-signature and key-free regression (21/0/0, PASS):

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH node --test scripts/release-archive-rs256.test.mjs scripts/release-archive-oidc-claims.test.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/signed-payload-identity-tests.log 2>&1; result=$?; tail -n 34 /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/signed-payload-identity-tests.log; exit "$result"
```

### Preserved state and two-path local commit procedure

Delegation stays **PROPOSED / unapproved**, reusable workflow fixed-disabled.
`DERIVED_NOT_AUTHORIZED`,
`ARCHIVE_GRANT_AUTHORITY_READER_NOT_REGISTERED`,
`ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED` and
`FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED` are unchanged.
Four real evidence checks stay **UNVERIFIED**;
`publication_authorized: false`, deployment **NOT_CHECKED** and
Production acceptance **BLOCKED**. No Result-byte-binding test or
Hudsucker/default/dependency is modified. No push, PR, tag, deploy,
publish, Production signing or configuration change is performed.

Two-path working/staged whitespace check, followed by a repeated gate at
commit after recording its result:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
set -- scripts/release-archive-rs256.test.mjs docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --check -- "$@" && git -c core.fsmonitor=false add -- "$@" && git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --cached --check -- "$@"
```

Local-only, unsigned commit with the normal scoped hook retained and
only these two files selected. Hook completion is observed from execution,
not assumed from the tests:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
set -- scripts/release-archive-rs256.test.mjs docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --check -- "$@" && git -c core.fsmonitor=false add -- "$@" && git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --cached --check -- "$@" && git --no-pager -c core.fsmonitor=false -c commit.gpgsign=false commit --only -m "test(tlsn): connect verified payload to repository identity refusal" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" -- "$@" > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/signed-payload-identity-commit.log 2>&1; result=$?; tail -n 22 /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/signed-payload-identity-commit.log; exit "$result"
```

Final branch/HEAD/parent and explicit-scope status, unchanged input paths,
then committed two-path whitespace (final SHA reported from metadata):

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
git branch --show-current
git rev-parse HEAD HEAD^
git -c core.fsmonitor=false status --short --untracked-files=all -- scripts/release-archive-rs256-fixture.mjs scripts/release-archive-rs256.test.mjs docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md pnpm-lock.yaml packages/FUSOU-TLSN-VERIFICATION-WORKER/package.json 'packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-*.mjs' scripts/release-archive-http.test.mjs scripts/release-archive-oidc-claims.test.mjs scripts/tlsn-grant-delegation.draft.json scripts/tlsn-grant-delegation.v1.schema.json .github/workflows/tlsn-grant-delegation.yml
git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --check HEAD^ HEAD -- scripts/release-archive-rs256.test.mjs docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
```

## 2026-10-28: formal native identity audit blocked on authenticated build/distribution

### Actual start, scope and implementation decision

Branch: `tlsn-first-testplay-candidate`.
Start HEAD: `225c9c6752b54163407731ef85bdb91caf53b50b`, matching request.
Initial explicit scope and expanded helper/document scope were clean.

**Required provenance contracts cannot be safely defined from the existing
sources. Stop the new native implementation as requested, rather than create
a shape-only authenticated binary/report format or a mock success path.**
The lower-level CLI/raw-byte/report validators already exist and are reused
without change. No new schema, validator, native artifact role, launcher,
trust root, workflow, secret or dependency is added. No test cases are added
to pretend those missing contracts have been implemented.

Three existing documents change: verifier README (separate CLI usage from
binary authenticity), delegation ADR (source-backed identity/provenance
requirements and stopping boundary), and this roadmap (measured results,
exact commands and remaining work).

### Source audit: eight required links

| Link | Source-observed evidence / limitation |
| --- | --- |
| Formal CLI source identity | `packages/FUSOU-TLSN-VERIFIER/src/bin/verify_fusou_tlsn_evidence.rs`, package `fusou-tlsn-verifier`, auto-discovered binary. `main` emits one JSON object, exit 0 on success and exit 1 with REJECTED JSON on argument/verification errors. No binary/build/producer identity is emitted |
| Native recipe/target | README has `cargo +1.95.0 run --offline ... --bin verify_fusou_tlsn_evidence`; no `--locked`, release profile or explicit target. It is a usage example, not an authenticated build recipe. Existing release drivers build APP/Worker only; no native builder command was found in the reviewed scripts/workflows |
| Toolchain/lock/input expectations | Package manifest pins TLSN revision plus local sparse patches. A local v4 Cargo.lock exists but `git ls-files` excludes it and `git check-ignore --no-index` confirms it is ignored. No tracked root/package Cargo target config/toolchain file was listed. The APP preflight's 1.98.1 and README's 1.95.0 must not be silently selected as a native pin |
| Output raw bytes/digest | Generic native capture compares independent executable/input pins against callback-provided bytes. APP/Worker drivers have real output-read paths, but none is a native build/distribution path; none was executed |
| Trusted native builder | No approved native workflow/principal/revision/source closure is identified. Existing producer workflow parity is not a native builder registration. Build verification accepts only APP/Worker roles |
| Builder artifact/run/attempt | Existing GitHub API transport checks unique artifact ID/name, current run/attempt, repository/branch/SHA, ZIP digest/size and metadata freshness. It supports release/archive transports; it does not issue a formal native artifact provenance proof |
| Actual launched binary | No native launcher is configured. Generic callback-provided before/after buffers and synthetic version do not prove which executable was launched. CLI has no required version observation. No stderr or start/end process capture is defined there |
| Report/input/raw output correlation | Existing checks validate argv/layout/input/stdout pins, status/exit/trust/derived fields and exact archive/bundle source/capture/session/binding relation. Authentication is a separate private capability or trusted cross-run intake. None proves a formal native build identity or consumer-side crypto rerun |

The full source/requirements mapping and one-time versus derived future
inputs are in the ADR's dated native provenance stopping section. The
native minimum is a joint binding of executable raw SHA-256 bytes/length,
target, source repository/SHA/closure, compiler/toolchain, lock/recipe/flags,
trusted builder workflow/revision/run/attempt, artifact origin and an
independent provenance verification basis. No field value is chosen from a
self-declared build report to authenticate that same report.

The online provenance mode is **GITHUB_API_REACQUISITION**, not a detached
signature. Its saved-archive implementation explicitly reports offline
signature verification NOT_IMPLEMENTED and consumer native reexecution
NOT_CHECKED. Archive supplements cannot replace native/build origin.
New Artifact Attestations are not adopted by default: native builder,
repository/service eligibility, verifier and trust-policy integration have
not been established.

Complete native source-closure verification is not claimed. In particular,
the library declares a protected module; that file was not read, searched,
hashed, compared, staged or committed. No recipe collecting that closure
or build source was executed.

### Key-free regression and unimplemented refusal matrix

Two existing suites and their direct fixture helpers were reviewed before
execution. Fixtures use in-memory maps, GitHub/storage/process doubles,
synthetic executable bytes/JSON and mock capture capabilities. The only
formal CLI source read in those suites is the allowed binary source.
They do not build, launch a native process, generate keys, sign or contact
services. No legacy RSA/JWKS key-generating suite is imported.

The selected run is **80 PASS / 0 FAIL / 0 skipped**, exit 0.
This confirms the existing boundaries, **not native provenance or TLSN
cryptography**. Synthetic successful native reports/capabilities are
explicit mocks. All four real checks remain UNVERIFIED.

| Requested refusal boundary | Actual status in this phase |
| --- | --- |
| Executable pin missing/empty/changed; declared capture digest/argv/input mutation | Existing key-free cases PASS; callback/byte contract only, not a launched-binary observation |
| Args/raw input inventory, exit/stdout structured result, derived target, archive bytes/source/session/binding | Existing key-free cases PASS within their present checks; no new formal report fields or real evidence |
| Unauthenticated native report/capability or self-declared PASS/authenticated marker | Existing tests PASS: intake rejects fake/serialized/mismatched private proofs; producer consumer remains BLOCKED without native evidence |
| Correct synthetic executable pin without formal builder provenance | Collector still emits `FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED`, no native execution/check. This does not validate a real binary |
| Native build source/toolchain/target/lock/recipe mismatch | NOT_IMPLEMENTED / NOT_RUN as formal native identity checks. APP/Worker mismatch tests must not be relabeled as native build tests |
| Native trusted builder/revision/run/attempt/artifact provenance mismatch | NOT_IMPLEMENTED / NOT_RUN as native build authentication. Existing generic GitHub metadata tests/mocks do not establish this contract |
| Missing/unverified-signature/unknown-issuer native provenance | Native provenance verifier/distribution contract absent: BLOCKED / NOT_RUN, no signed provenance acceptance or rejection manufactured |
| Actual launched executable, stderr/start/end and execution-producer authentication | NOT_IMPLEMENTED / NOT_RUN for formal native launch |
| Real build, native/TLSN execution, external artifact/attestation verification | NOT_RUN, prohibited in this phase |

No test failed or was weakened/skipped, and no code fix was made. A guessed
ADR folder did not exist; its actual `docs/architecture` path was located
and read. This was a source-location lookup, not a failed test or evidence
of absent ADR. The discovered ignored native lock corrects any assumption
that an existing local Cargo.lock is committed release provenance.

### Exact commands and outcomes

Initial branch/HEAD and explicit scope: PASS / exit 0.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git branch --show-current && git rev-parse HEAD && git -c core.fsmonitor=false status --short --untracked-files=all -- packages/FUSOU-TLSN-VERIFIER/src/bin/verify_fusou_tlsn_evidence.rs packages/FUSOU-TLSN-VERIFIER/Cargo.toml packages/FUSOU-TLSN-VERIFIER/Cargo.lock Cargo.toml Cargo.lock rust-toolchain.toml scripts/release-worker-build.mjs scripts/release-build.mjs scripts/release-build-proof.mjs scripts/release-checks.mjs scripts/release-execution-intake.mjs scripts/release-execution-origin.mjs scripts/release-archive-provenance.mjs scripts/release-consumer.mjs scripts/release-native-identity.mjs scripts/release-native-identity.test.mjs docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md .github/workflows/tlsn-release-eligibility.yml .github/workflows/tlsn-grant-delegation.yml .githooks/pre-commit scripts/scoped_code_review_graph.py
```

Tracked root/package manifest, lock, target/toolchain configuration inventory:
PASS / exit 0; only the verifier Cargo.toml is listed.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git ls-files -- Cargo.toml Cargo.lock rust-toolchain rust-toolchain.toml .cargo/config .cargo/config.toml packages/FUSOU-TLSN-VERIFIER/Cargo.toml packages/FUSOU-TLSN-VERIFIER/Cargo.lock packages/FUSOU-TLSN-VERIFIER/rust-toolchain packages/FUSOU-TLSN-VERIFIER/rust-toolchain.toml packages/FUSOU-TLSN-VERIFIER/.cargo/config packages/FUSOU-TLSN-VERIFIER/.cargo/config.toml
```

Target-only ignore metadata: PASS / exit 0; prints the native Cargo.lock.
This reads ignore metadata, not dependency installation/resolution.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git check-ignore --no-index -- packages/FUSOU-TLSN-VERIFIER/Cargo.lock
```

Reviewed helper/document scope before execution/edits: PASS / exit 0, clean.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git -c core.fsmonitor=false status --short --untracked-files=all -- 'scripts/release-*.mjs' packages/FUSOU-TLSN-VERIFIER/README.md docs/architecture/adr-tlsn-grant-authority-delegation.md docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md 'packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-*.mjs' packages/FUSOU-TLSN-VERIFICATION-WORKER/src/origin-trust-contract.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-trust-contract.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-build-handoff.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-public-configuration.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/wasm-provenance.mjs
```

Explicit selected key-free suites: PASS 80/0/0 / exit 0.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH node --test scripts/release-evidence-producer.test.mjs scripts/release-checks.test.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/native-identity-existing-boundaries.log 2>&1; result=$?; tail -n 34 /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/native-identity-existing-boundaries.log; exit "$result"
```

Changed-module syntax: NOT_RUN / not applicable, documentation-only change.
Three-path working/staged whitespace: PASS / exit 0; repeated at commit
after this result is recorded.
No comprehensive package/test/build script was used.

### Remaining decision/registration and measurement work

Before code can authenticate a formal native artifact, approve the builder
principal/workflow immutable implementation and source/input closure;
native target/compiler/locked recipe/flags; native artifact distribution
role/member and independent online acquisition/verification expectations;
and permitted launcher/measurement/producer report contract. A local
lock must become a reviewed committed native input, not a transient hash.
No actual repository/owner ID, builder revision, artifact endpoint or
active pin is fabricated here.

After those contracts exist, separately authorized builds must observe
real native bytes, toolchain/recipe/lock digests and trusted run/attempt/
artifact origin; execution must capture real arguments, input bytes,
stdout/stderr, exit and evidence context. Consumer must independently
authenticate producer/build/artifact before accepting these measurements,
and still distinguish an authenticated native report from consumer-side
cryptographic reexecution. No TPM/process-image authority is a substitute.

`FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED` stays **maintained**,
not renamed to solved. Delegation remains PROPOSED/unapproved, reusable
workflow fixed-disabled, `DERIVED_NOT_AUTHORIZED`,
`ARCHIVE_GRANT_AUTHORITY_READER_NOT_REGISTERED`,
`ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED`, four real checks
UNVERIFIED, `publication_authorized: false`, deployment NOT_CHECKED and
Production acceptance BLOCKED. GitHub OIDC positive integration and real
trust/settings/pins remain unverified.

Three-path whitespace/stage command (repeated as commit gate after its
observed result is recorded):

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
set -- packages/FUSOU-TLSN-VERIFIER/README.md docs/architecture/adr-tlsn-grant-authority-delegation.md docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --check -- "$@" && git -c core.fsmonitor=false add -- "$@" && git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --cached --check -- "$@"
```

Unsigned local-only three-path commit, normal scoped hook retained.
Actual hook success is observed on execution, not assumed by this record:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
set -- packages/FUSOU-TLSN-VERIFIER/README.md docs/architecture/adr-tlsn-grant-authority-delegation.md docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --check -- "$@" && git -c core.fsmonitor=false add -- "$@" && git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --cached --check -- "$@" && git --no-pager -c core.fsmonitor=false -c commit.gpgsign=false commit --only -m "docs(tlsn): record formal native provenance stopping boundary" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" -- "$@" > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/native-identity-stopping-commit.log 2>&1; result=$?; tail -n 22 /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/native-identity-stopping-commit.log; exit "$result"
```

Final branch/HEAD/parent, explicit scope and committed whitespace:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
git branch --show-current
git rev-parse HEAD HEAD^
git -c core.fsmonitor=false status --short --untracked-files=all -- packages/FUSOU-TLSN-VERIFIER/README.md docs/architecture/adr-tlsn-grant-authority-delegation.md docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md packages/FUSOU-TLSN-VERIFIER/src/bin/verify_fusou_tlsn_evidence.rs packages/FUSOU-TLSN-VERIFIER/Cargo.toml packages/FUSOU-TLSN-VERIFIER/Cargo.lock 'scripts/release-*.mjs' .github/workflows/tlsn-release-eligibility.yml .github/workflows/tlsn-release-consumer.yml .github/workflows/tlsn-grant-delegation.yml
git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --check HEAD^ HEAD -- packages/FUSOU-TLSN-VERIFIER/README.md docs/architecture/adr-tlsn-grant-authority-delegation.md docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
```

## Native build inputs and provenance candidate: source-only implementation

Start branch `tlsn-first-testplay-candidate`, actual HEAD
`1a98e76ee941f902ea322a8d0e76749593bc873f`, matching the requested start.
The explicit task scope was initially clean. Protected files were not read,
searched, compared, hashed, edited, staged or committed. No broad repository
search/status/diff or comprehensive package/test/build script was used.

### Source progress and trust boundary

The formal CLI remains
`packages/FUSOU-TLSN-VERIFIER/src/bin/verify_fusou_tlsn_evidence.rs`.
Its existing JSON/exit/argv contract is unchanged. The native package now
explicitly declares its own workspace/resolver and binary target. Neither
the repository root nor `packages/` has a Cargo manifest. Existing path
dependencies include authenticity-core and the patched TLSN sparse workspace;
their separate locks are not collected into this change.

The existing Cargo-generated native v4 lock has been staged without changing
any bytes; only a native-path ignore exception was added. Original and
post-stage SHA-256 hex both equal
`a23d6d3363b0e2c34fc244fb74f51dd87aca80d2a4f31e6f0e9ca833c4c9a21c`
(72,356 bytes). TOML parsing confirms the native package/version and explicit
workspace/bin shape. Cargo was not executed: full manifest/lock consistency
and complete dependency/source closure remain **NOT_CHECKED**.

New source files:

- `scripts/release-native-policy.draft.json`: PROPOSED/unapproved, false
  operational/publication flags; repository/owner IDs and signer revision
  null, action contract/eligibility unchecked, verifier/launcher unimplemented.
- `scripts/release-native-build.mjs`: tracked four-input source-shape guard,
  fail-closed preflight, `--locked` candidate recipe, canonical byte-bound
  metadata and mock-only independent comparison interface.
- `scripts/release-native-build.test.mjs`: key-free synthetic input/metadata/
  artifact-origin/provenance controls and existing offline-check refusal.
- `.github/workflows/tlsn-native-build.yml`: reusable candidate with all
  three jobs literal `if: ${{ false }}` and `contents: read` only.

Rust `1.98.1`, `x86_64-unknown-linux-gnu`, release/default features, empty
extra Rust flags and explicit output directory are **UNAPPROVED candidate
values**, not formal pins inferred from a README. Recipe includes `--locked`;
no lock update or retry fallback exists. Candidate implementation locator,
binary source SHA and future approved workflow revision are separate roles.
No current commit is registered as a trusted native builder.

Metadata binds executable raw SHA-256 hex/length/path, source repository/IDs/
SHA, workflow path/SHA, run/attempt, compiler observation, four input/lock
byte descriptors and recipe/flags. Those declarations do not authenticate a
builder. The mock interface recomputes binary and metadata hashes, requires
independently supplied expectations, compares separately supplied normalized
artifact origin (ID/name/archive digest/repository/workflow/run/attempt),
and compares both subjects/predicate/context against a normalized mock result.
The archive digest is separate from the executable digest. This is not a
real SLSA/`gh` parser, GitHub artifact re-fetcher or signature verifier.
Expected values copied from the candidate's own metadata are not independent
policy. Mutation during the asynchronous mock is rejected.

`actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6` is retained as the
user-supplied candidate reference, not a trust root. Existing immutable
checkout/setup-node/github-script pins are reused. The requested action's
local metadata was unavailable; `gh` was not installed and network access
was prohibited. No CLI options/output schema or action inputs/permissions
were invented. Consequently no actual attest step or `id-token`/
`attestations` write permissions were added. Workflow metadata observation,
upload and attestation remain **NOT_IMPLEMENTED**, as do real attestation
adapter, authenticated native artifact acquisition and native launcher.
Preflight and the placeholder explicitly fail closed; even changing draft
approval labels cannot produce native/build authorization.

The existing independent consumer, app/worker artifact proof roles and
native report/collector validators are unchanged. Existing argument/input/
output/exit/archive/session/binding tests still use synthetic process/API
doubles. Native launcher measurement, stderr/start/end and real native
cryptographic verification are not implemented by this candidate. No
`--version`, key, new root, signature format or native success path was added.

### Checks and exact local commands

All commands below target explicit allowed paths or local parser package
names. They do not execute Cargo, Rust, native code, package lifecycle
scripts, workflow runs, signing or external services.

Start metadata/scoped state: **PASS**, exit 0.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git branch --show-current && git rev-parse HEAD && git -c core.fsmonitor=false status --short --untracked-files=all -- .gitignore packages/FUSOU-TLSN-VERIFIER/.gitignore packages/FUSOU-TLSN-VERIFIER/Cargo.toml packages/FUSOU-TLSN-VERIFIER/Cargo.lock packages/FUSOU-TLSN-VERIFIER/src/bin/verify_fusou_tlsn_evidence.rs .github/workflows/tlsn-native-build.yml scripts/release-native-build.mjs scripts/release-native-build.test.mjs scripts/release-native-policy.draft.json scripts/release-build-proof.mjs scripts/release-checks.mjs scripts/release-execution-intake.mjs scripts/release-evidence-producer.mjs scripts/release-consumer.mjs docs/architecture/adr-tlsn-grant-authority-delegation.md docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md .githooks/pre-commit scripts/scoped_code_review_graph.py
```

Manifest inventory/ignore/CLI availability: **PASS**, exit 0. Initially the
native lock matched `.gitignore:8:Cargo.lock`; it was not tracked. No `gh`
executable was found. These commands do not execute it.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git ls-files -- Cargo.toml .gitignore packages/.gitignore packages/FUSOU-TLSN-VERIFIER/.gitignore packages/FUSOU-TLSN-VERIFIER/Cargo.toml packages/FUSOU-TLSN-VERIFIER/Cargo.lock packages/authenticity/Cargo.toml packages/authenticity/authenticity-core/Cargo.toml packages/tlsn-alpha15-sparse/Cargo.toml packages/tlsn-alpha15-sparse/crates/tlsn/Cargo.toml && git check-ignore -v --no-index -- packages/FUSOU-TLSN-VERIFIER/Cargo.lock; command -v gh || true
```

Ancestor-manifest/native-ignore existence and CLI availability confirmation:
**PASS**, exit 0; three `ABSENT` values and `GH_NOT_INSTALLED`.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
for path in Cargo.toml packages/Cargo.toml packages/FUSOU-TLSN-VERIFIER/.gitignore; do if test -e "$path"; then printf 'PRESENT %s\n' "$path"; else printf 'ABSENT %s\n' "$path"; fi; done
if command -v gh; then printf 'GH_AVAILABLE\n'; else printf 'GH_NOT_INSTALLED\n'; fi
```

Local parser resolution/discovery: **PASS**, both commands exit 0.
Root resolution returned `NOT_INSTALLED`; existing pnpm-store parsers were
then found without installing dependencies. Earlier bounded file lookups
also found no local action metadata; a roadmap range exceeded the file end
and was narrowed. These were discovery misses, not test failures.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH node --input-type=module -e 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url); for (const name of ["yaml", "@iarna/toml", "smol-toml"]) { try { console.log(name + " " + require.resolve(name)); } catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error; console.log(name + " NOT_INSTALLED"); } }'
```

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH node --input-type=module -e 'import { readdirSync } from "node:fs"; console.log(readdirSync("node_modules/.pnpm").filter((name) => /^(yaml|js-yaml|smol-toml|@iarna\+toml)@/.test(name)).join("\n") || "NO_LOCAL_PARSER");'
```

Original lock hash and initial changed-module syntax: **PASS**, exit 0.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && sha256sum packages/FUSOU-TLSN-VERIFIER/Cargo.lock && env -u NODE_OPTIONS -u NODE_PATH node --check scripts/release-native-build.mjs && env -u NODE_OPTIONS -u NODE_PATH node --check scripts/release-native-build.test.mjs
```

Initial selected suite: **PASS**, 123/123, fail/skip/cancel 0, exit 0.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH node --test scripts/release-native-build.test.mjs scripts/release-evidence-producer.test.mjs scripts/release-checks.test.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/native-build-candidate-tests.log 2>&1; result=$?; tail -n 38 /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/native-build-candidate-tests.log; exit "$result"
```

Initial full YAML/TOML static parse: **PASS**, exit 0; no Cargo resolution.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NATIVE_ROOT, NATIVE_BINARY, NATIVE_WORKFLOW, NATIVE_POLICY, NATIVE_ATTEST_ACTION, nativeBuildRecipe } from './scripts/release-native-build.mjs';
const require = createRequire(import.meta.url);
const yaml = require('./node_modules/.pnpm/yaml@2.8.3/node_modules/yaml');
const toml = require('./node_modules/.pnpm/smol-toml@1.8.0/node_modules/smol-toml');
const source = readFileSync(NATIVE_WORKFLOW, 'utf8');
const parsed = yaml.parseDocument(source, { uniqueKeys: true });
assert.deepEqual(parsed.errors, []);
const workflow = parsed.toJS();
assert.deepEqual(Object.keys(workflow.on), ['workflow_call']);
assert.deepEqual(workflow.permissions, { contents: 'read' });
assert.deepEqual(Object.keys(workflow.jobs), ['preflight', 'candidate-build', 'attestation']);
for (const job of Object.values(workflow.jobs)) {
  assert.equal(job.if, '${{ false }}');
  assert.equal(job.permissions, undefined);
  for (const step of job.steps) if (step.uses) assert.match(step.uses, /^actions\/[a-z-]+@[0-9a-f]{40}$/);
}
assert.equal(workflow.jobs.attestation.steps[0].env.CANDIDATE_ACTION, NATIVE_ATTEST_ACTION);
const policy = JSON.parse(readFileSync(NATIVE_POLICY, 'utf8'));
assert.equal(policy.recipe_approval, 'UNAPPROVED');
assert.equal(policy.operational_enabled, false);
assert(source.includes('cargo ' + nativeBuildRecipe(policy.recipe).argv.join(' ')));
const manifest = toml.parse(readFileSync(`${NATIVE_ROOT}/Cargo.toml`, 'utf8'));
assert.equal(manifest.package.name, 'fusou-tlsn-verifier');
assert.equal(manifest.workspace.resolver, '2');
assert.deepEqual(manifest.bin, [{ name: NATIVE_BINARY, path: `src/bin/${NATIVE_BINARY}.rs` }]);
const lockRaw = readFileSync(`${NATIVE_ROOT}/Cargo.lock`);
const lock = toml.parse(lockRaw.toString('utf8'));
assert.equal(lock.version, 4);
assert.equal(lock.package.find((pkg) => pkg.name === manifest.package.name).version, manifest.package.version);
assert.equal(createHash('sha256').update(lockRaw).digest('hex'), 'a23d6d3363b0e2c34fc244fb74f51dd87aca80d2a4f31e6f0e9ca833c4c9a21c');
console.log('PASS: YAML fixed gates/action pins/permissions and candidate recipe; TOML workspace/bin/lock scope and unchanged lock bytes. Cargo resolution and attestation remain NOT_RUN.');
JS
```

After that successful first run, candidate checks were completed with seven
independent artifact-origin mismatch tests, an explicit recipe environment
and unregistered-acquisition blocker. No assertion was weakened or skipped;
no test/syntax/YAML/TOML failure occurred.

Final syntax plus selected suite: **PASS**, 130/130 (50 new candidate tests
plus 80 existing native/collector/consumer contracts), fail/skip/cancel 0,
exit 0. Fixtures/mock normalized verifiers use no key generation, signing,
network, build or native executable. Their consistency result is never real
signature/provenance/native verification.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH node --check scripts/release-native-build.mjs && env -u NODE_OPTIONS -u NODE_PATH node --check scripts/release-native-build.test.mjs && env -u NODE_OPTIONS -u NODE_PATH node --test scripts/release-native-build.test.mjs scripts/release-evidence-producer.test.mjs scripts/release-checks.test.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/native-build-candidate-final-tests.log 2>&1; result=$?; tail -n 26 /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/native-build-candidate-final-tests.log; exit "$result"
```

Exact seven-path stage, tracked-lock/unchanged-hash confirmation and actual
source preflight assertions: **PASS**, exit 0. Source result is
`SOURCE_CONTRACT_READY` (four-file tracked shape only), while authorization
remains `BLOCKED_IMPLEMENTATION`, false authenticated/build/publication
flags and Production BLOCKED. This assertion command's exit 0 means the
expected refusal was observed, not that a build was authorized.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git -c core.fsmonitor=false add -- .gitignore packages/FUSOU-TLSN-VERIFIER/Cargo.toml packages/FUSOU-TLSN-VERIFIER/Cargo.lock .github/workflows/tlsn-native-build.yml scripts/release-native-build.mjs scripts/release-native-build.test.mjs scripts/release-native-policy.draft.json && git ls-files --error-unmatch -- packages/FUSOU-TLSN-VERIFIER/Cargo.lock && sha256sum packages/FUSOU-TLSN-VERIFIER/Cargo.lock && env -u NODE_OPTIONS -u NODE_PATH node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readNativeBuildPreflight, NATIVE_BLOCKER } from './scripts/release-native-build.mjs';
const result = await readNativeBuildPreflight();
assert.equal(result.source_contract, 'SOURCE_CONTRACT_READY');
assert.equal(result.cargo_locked_consistency, 'NOT_CHECKED');
assert.equal(result.build_authorized, false);
assert.equal(result.authenticated, false);
assert(result.blockers.includes(NATIVE_BLOCKER));
console.log(JSON.stringify(result, null, 2));
JS
```

Final YAML/TOML parse, job gates/read-only permissions/action pins, exact
recipe argv/environment, native workspace/bin and original lock hash:
**PASS**, exit 0, using already installed local parsers only.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NATIVE_ROOT, NATIVE_BINARY, NATIVE_WORKFLOW, NATIVE_POLICY, NATIVE_ATTEST_ACTION, nativeBuildRecipe } from './scripts/release-native-build.mjs';
const require = createRequire(import.meta.url);
const yaml = require('./node_modules/.pnpm/yaml@2.8.3/node_modules/yaml');
const toml = require('./node_modules/.pnpm/smol-toml@1.8.0/node_modules/smol-toml');
const source = readFileSync(NATIVE_WORKFLOW, 'utf8');
const parsed = yaml.parseDocument(source, { uniqueKeys: true });
assert.deepEqual(parsed.errors, []);
const workflow = parsed.toJS();
assert.deepEqual(Object.keys(workflow.on), ['workflow_call']);
assert.deepEqual(workflow.permissions, { contents: 'read' });
assert.deepEqual(Object.keys(workflow.jobs), ['preflight', 'candidate-build', 'attestation']);
for (const job of Object.values(workflow.jobs)) {
  assert.equal(job.if, '${{ false }}');
  assert.equal(job.permissions, undefined);
  for (const step of job.steps) if (step.uses) assert.match(step.uses, /^actions\/[a-z-]+@[0-9a-f]{40}$/);
}
assert.equal(workflow.jobs.attestation.steps[0].env.CANDIDATE_ACTION, NATIVE_ATTEST_ACTION);
const policy = JSON.parse(readFileSync(NATIVE_POLICY, 'utf8'));
assert.equal(policy.recipe_approval, 'UNAPPROVED');
assert.equal(policy.operational_enabled, false);
const recipe = nativeBuildRecipe(policy.recipe);
assert(source.includes('cargo ' + recipe.argv.join(' ')));
assert.deepEqual(workflow.jobs['candidate-build'].steps.at(-1).env, recipe.environment);
const manifest = toml.parse(readFileSync(`${NATIVE_ROOT}/Cargo.toml`, 'utf8'));
assert.equal(manifest.package.name, 'fusou-tlsn-verifier');
assert.equal(manifest.workspace.resolver, '2');
assert.deepEqual(manifest.bin, [{ name: NATIVE_BINARY, path: `src/bin/${NATIVE_BINARY}.rs` }]);
const lockRaw = readFileSync(`${NATIVE_ROOT}/Cargo.lock`);
const lock = toml.parse(lockRaw.toString('utf8'));
assert.equal(lock.version, 4);
assert.equal(lock.package.find((pkg) => pkg.name === manifest.package.name).version, manifest.package.version);
assert.equal(createHash('sha256').update(lockRaw).digest('hex'), 'a23d6d3363b0e2c34fc244fb74f51dd87aca80d2a4f31e6f0e9ca833c4c9a21c');
console.log('PASS: final YAML gates/pins/read-only permissions/recipe environment; TOML workspace/bin/lock identity and unchanged lock bytes. No Cargo or attestation execution.');
JS
```

### Remaining non-executed work and maintained status

| Work | State / reason |
| --- | --- |
| Cargo resolution / `cargo build --locked` / compiler observation | **NOT_RUN**, build/native-tool execution prohibited; lock consistency NOT_CHECKED |
| Actual workflow / artifact upload / attestation issuance | **NOT_RUN**, prohibited; workflow fixed-disabled and API/approval incomplete |
| Actual `gh attestation verify` / online artifact reacquisition | **NOT_RUN**, prohibited external access; CLI absent and real adapter/acquisition role NOT_IMPLEMENTED |
| Native executable / real TLSN cryptographic evidence verification | **NOT_RUN**, prohibited; launcher/report authentication unresolved |
| Real GitHub OIDC positive integration / repository settings / active pins | **NOT_CHECKED**, outside this source-only stage |
| Delegation / reusable workflow | **PROPOSED** / unapproved; fixed-disabled |
| Four real evidence checks | **UNVERIFIED** |
| Publication / deployment / Production acceptance | `publication_authorized: false` / **NOT_CHECKED** / **BLOCKED** |

`DERIVED_NOT_AUTHORIZED`,
`ARCHIVE_GRANT_AUTHORITY_READER_NOT_REGISTERED`,
`ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED` and
`FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED` are maintained.
Actual preflight additionally names unregistered repository IDs/signer pin,
unapproved build pins, unchecked action/eligibility, unregistered attestation
verifier/acquisition and unimplemented launcher. Required later inputs are
independently approved native input closure/locked recipe, repository/owner
identity, immutable builder revision and isolation, verified action/API/
permissions/eligibility, consumer verifier/trust acquisition, artifact/member/
download identity and executable measurement/report contract. Real build,
attestation and execution observations are still necessary after registration.
No new key/root or package version substitutes for them.

### Scoped whitespace and local commit protocol

Ten-path working/staged whitespace result: **PASS**, exit 0. Repeated as the
final commit gate after recording that observed result. Documentation-only
edits after the passing code checks do not change the tested code.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
set -- .gitignore packages/FUSOU-TLSN-VERIFIER/Cargo.toml packages/FUSOU-TLSN-VERIFIER/Cargo.lock .github/workflows/tlsn-native-build.yml scripts/release-native-build.mjs scripts/release-native-build.test.mjs scripts/release-native-policy.draft.json packages/FUSOU-TLSN-VERIFIER/README.md docs/architecture/adr-tlsn-grant-authority-delegation.md docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --check -- "$@" && git -c core.fsmonitor=false add -- "$@" && git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --cached --check -- "$@"
```

Unsigned local-only commit, normal scoped hook retained. Actual hook/commit
outcome is observed when executing, not assumed by this pre-commit record:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
set -- .gitignore packages/FUSOU-TLSN-VERIFIER/Cargo.toml packages/FUSOU-TLSN-VERIFIER/Cargo.lock .github/workflows/tlsn-native-build.yml scripts/release-native-build.mjs scripts/release-native-build.test.mjs scripts/release-native-policy.draft.json packages/FUSOU-TLSN-VERIFIER/README.md docs/architecture/adr-tlsn-grant-authority-delegation.md docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --check -- "$@" && git -c core.fsmonitor=false add -- "$@" && git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --cached --check -- "$@" && git --no-pager -c core.fsmonitor=false -c commit.gpgsign=false commit --only -m "feat(tlsn): add nonoperational native build provenance candidate" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" -- "$@" > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/native-build-candidate-commit.log 2>&1; result=$?; tail -n 26 /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/native-build-candidate-commit.log; exit "$result"
```

Final branch/HEAD/parent, ten-path state/committed whitespace and unchanged
tracked lock verification use only the following explicit paths. Their
observed outcome and full end SHA are reported after commit, without trying
to write a commit's own hash inside itself.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
set -- .gitignore packages/FUSOU-TLSN-VERIFIER/Cargo.toml packages/FUSOU-TLSN-VERIFIER/Cargo.lock .github/workflows/tlsn-native-build.yml scripts/release-native-build.mjs scripts/release-native-build.test.mjs scripts/release-native-policy.draft.json packages/FUSOU-TLSN-VERIFIER/README.md docs/architecture/adr-tlsn-grant-authority-delegation.md docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
git branch --show-current && git rev-parse HEAD HEAD^ && git -c core.fsmonitor=false status --short --untracked-files=all -- "$@" && git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --check HEAD^ HEAD -- "$@" && git ls-files --error-unmatch -- packages/FUSOU-TLSN-VERIFIER/Cargo.lock && sha256sum packages/FUSOU-TLSN-VERIFIER/Cargo.lock
```

## 2026-10-28 official gh native provenance adapter and disabled issuance wiring

Start branch `tlsn-first-testplay-candidate`, actual HEAD
`ab2f35ba4781e8b544165ead911f927b3de9ee30`; explicit scope clean on both
initial inspection and the clarified attachment. No protected file was read,
searched, compared, hashed, modified, staged or committed. No broad repository
search/status/diff or unreviewed package/build script was used.

### Official contract and source implementation

Read-only public source retrieval was explicitly permitted. No GitHub REST,
attestation API, R2 or other operational service was contacted. The following
official URLs were fetched with `web_fetch`, not gh/API execution:

- CLI command (read in two bounded pages):
  `https://raw.githubusercontent.com/cli/cli/94c5a6fa2781cb8d6391e032c1943aa98c5d64f7/pkg/cmd/attestation/verify/verify.go`
- CLI output struct:
  `https://raw.githubusercontent.com/cli/cli/94c5a6fa2781cb8d6391e032c1943aa98c5d64f7/pkg/cmd/attestation/verification/sigstore.go`
- CLI version routing/format:
  `https://raw.githubusercontent.com/cli/cli/94c5a6fa2781cb8d6391e032c1943aa98c5d64f7/pkg/cmd/root/root.go`
  and `https://raw.githubusercontent.com/cli/cli/94c5a6fa2781cb8d6391e032c1943aa98c5d64f7/pkg/cmd/version/version.go`
- Sigstore result and certificate extensions:
  `https://raw.githubusercontent.com/sigstore/sigstore-go/ba85fa81ff9e14614e10d99eae43e8e59fc46531/pkg/verify/signed_entity.go`
  and `https://raw.githubusercontent.com/sigstore/sigstore-go/ba85fa81ff9e14614e10d99eae43e8e59fc46531/pkg/fulcio/certificate/extensions.go`
- Fixed action:
  `https://raw.githubusercontent.com/actions/attest/1e69f48acb82d1966a394da916b4c1698aa569d6/action.yml`
  and `https://raw.githubusercontent.com/actions/attest/1e69f48acb82d1966a394da916b4c1698aa569d6/README.md`
- Additional immutable candidate download action definition:
  `https://raw.githubusercontent.com/actions/download-artifact/d3f86a106a0bac45b974a628896c90dbdf5c8093/action.yml`
- Source-ref advisory:
  `https://github.com/cli/cli/security/advisories/GHSA-4mq3-hpgx-9cx8`

These reads succeeded. One bounded lookup for
`https://raw.githubusercontent.com/sigstore/sigstore-go/ba85fa81ff9e14614e10d99eae43e8e59fc46531/pkg/fulcio/certificate/certificate.go`
returned **404**; the supplied Summary contract and retrieved extension/result
definitions were sufficient, so no alternate schema was invented.

`release-native-attestation.mjs` now implements shell-free argv and a separate
stdout/stderr process boundary with timeout/output bounds, pinned
consumer-selected gh bytes, before/after artifact/executable hashing and
sanitized failure blockers. There is no producer-stdout input or offline
bundle fallback. Stable gh 2.x >= 2.102.0 is required; unknown/prerelease/future
major versions fail closed. Ref comparison is case-sensitive even after CLI
success. Captures record version, argv and raw-output digests, never tokens,
credential-bearing stderr or thrown process text.

The parser consumes the official array/result/media type, in-toto statement,
SHA-256 subjects, exact SLSA predicate, mandatory certificate identity/IDs/
digests/source/run fields and verified timestamp authorities/window. It
reuses the existing duplicate-key scanner via a named export (no change to
that scanner's implementation or its Result consumer). Unknown schemas,
empty results, malformed dates and duplicate/ambiguous results are blocked.
This candidate deliberately requires one result per lookup; it does not
silently pick the first of multiple attestations. `certificateIssuer` is
not the OIDC `issuer`. Opaque bundle/optional verifiedIdentity/predicate
contents are never an independent identity root.

`release-native-build.mjs` retains byte/recipe/compiler/origin validation and
adds `inspectNativeConsumerProvenance`, exported by `release-consumer.mjs`.
It correlates independent certificate source/signer/repository/run context,
captures verification for binary and metadata, and rechecks file/input
snapshots. Existing checks/execution intake, execution capabilities,
app/worker transport roles and native collector refusal are unchanged.
Parser success, mock process success and unregistered process captures all
remain `authenticated: false`; no offline execution proof is issued.
The draft policy remains byte-for-byte unchanged and unapproved.

The disabled workflow connects future tool observations/output hashing,
existing metadata v1 generation, immutable artifact packaging/download,
data-only readback, standard two-subject SLSA issuance and bundle packaging.
Actual rustc/Cargo observations are encoded together as canonical JSON in
the existing opaque `compiler_identity` string; no observation was fabricated
or executed here. A metadata workflow revision is a policy expectation,
not observed signer identity; later certificate matching is mandatory.
Source/GITHUB_SHA mismatch stops metadata generation.

All three literal false gates and the unconditional preflight refusal are
preserved. Only the signing job declares contents read/OIDC write/attestations
write. `create-storage-record: false` avoids artifact-metadata write.
Standard SLSA uses `subject-path` for binary and metadata with no custom
predicate inputs. New download pin is an inspected **UNAPPROVED candidate**;
existing other pins are reused. It is not independent consumer acquisition
authentication. Recipe Rust 1.98.1/Linux target/flags remain UNAPPROVED, not
"latest"; the reported Rust 1.99.1 release is not compatibility evidence
or authorization to update that pin.

### Exact commands and observed results

Initial branch/HEAD and explicit scope: **PASS**, exit 0.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git branch --show-current && git rev-parse HEAD && git -c core.fsmonitor=false status --short --untracked-files=all -- scripts/release-native-build.mjs scripts/release-native-build.test.mjs scripts/release-native-policy.draft.json scripts/release-native-attestation.mjs scripts/release-native-attestation.test.mjs scripts/release-native-metadata.mjs scripts/release-native-metadata.test.mjs scripts/release-checks.mjs scripts/release-consumer.mjs scripts/release-execution-intake.mjs .github/workflows/tlsn-native-build.yml packages/FUSOU-TLSN-VERIFIER/README.md docs/architecture/adr-tlsn-grant-authority-delegation.md docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md .githooks/pre-commit scripts/scoped_code_review_graph.py
```

Reconfirmed state and conditional permitted gh inspection: **PASS**, exit 0,
`GH_NOT_INSTALLED`. Both gh version/help were **NOT_RUN** because it was
absent. No install or real verification was attempted.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git branch --show-current && git rev-parse HEAD && git -c core.fsmonitor=false status --short --untracked-files=all -- scripts/release-native-build.mjs scripts/release-native-build.test.mjs scripts/release-native-policy.draft.json scripts/release-native-attestation.mjs scripts/release-native-attestation.test.mjs .github/workflows/tlsn-native-build.yml packages/FUSOU-TLSN-VERIFIER/README.md docs/architecture/adr-tlsn-grant-authority-delegation.md docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md && if command -v gh; then gh --version && gh attestation verify --help; else printf 'GH_NOT_INSTALLED; no installation or artifact verification\n'; fi
```

Initial seven-module syntax plus selected contracts: **PASS**, 193/193,
fail/skip/cancel 0, exit 0.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH node --check scripts/release-native-attestation.mjs && env -u NODE_OPTIONS -u NODE_PATH node --check scripts/release-native-attestation-fixture.mjs && env -u NODE_OPTIONS -u NODE_PATH node --check scripts/release-native-attestation.test.mjs && env -u NODE_OPTIONS -u NODE_PATH node --check scripts/release-native-build.mjs && env -u NODE_OPTIONS -u NODE_PATH node --check scripts/release-native-build.test.mjs && env -u NODE_OPTIONS -u NODE_PATH node --check scripts/release-consumer.mjs && env -u NODE_OPTIONS -u NODE_PATH node --check packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-contract.mjs && env -u NODE_OPTIONS -u NODE_PATH node --test scripts/release-native-attestation.test.mjs scripts/release-native-build.test.mjs scripts/release-evidence-producer.test.mjs scripts/release-checks.test.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/native-gh-adapter-tests.log 2>&1; result=$?; tail -n 35 /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/native-gh-adapter-tests.log; exit "$result"
```

Additional boundary regressions: **FAIL**, 0 PASS / 2 FAIL, exit 1, no skips.
They exposed single-line-only version parsing (official stable output also
contains the matching release URL) and `Date.parse` normalizing February 30.
Fixed by accepting only a matching optional release URL and explicitly
validating RFC3339 calendar/time fields before timestamp range checks.
Assertions were retained, not weakened or skipped.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH node --test --test-name-pattern='official-style gh version|timestamp calendar' scripts/release-native-attestation.test.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/native-gh-boundary-regressions-red.log 2>&1; result=$?; tail -n 55 /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/native-gh-boundary-regressions-red.log; exit "$result"
```

Post-fix syntax/contracts: **PASS**, 195/195, fail/skip/cancel 0, exit 0.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH node --check scripts/release-native-attestation.mjs && env -u NODE_OPTIONS -u NODE_PATH node --check scripts/release-native-build.mjs && env -u NODE_OPTIONS -u NODE_PATH node --check scripts/release-native-attestation.test.mjs && env -u NODE_OPTIONS -u NODE_PATH node --test scripts/release-native-attestation.test.mjs scripts/release-native-build.test.mjs scripts/release-evidence-producer.test.mjs scripts/release-checks.test.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/native-gh-adapter-final-tests.log 2>&1; result=$?; tail -n 25 /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/native-gh-adapter-final-tests.log; exit "$result"
```

Full YAML parse and syntax-only embedded scripts: **PASS**, exit 0.
Checks 5 shell blocks, 4 embedded Node bodies, 2 github-script bodies,
all fixed gates/pins and exact permission/subject scope. `bash -n`,
`node --check` and VM compilation do not execute script bodies. Local YAML
parser was already installed; no dependencies were installed.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Script } from 'node:vm';
const require = createRequire(import.meta.url);
const yaml = require('./node_modules/.pnpm/yaml@2.8.3/node_modules/yaml');
const parsed = yaml.parseDocument(readFileSync('.github/workflows/tlsn-native-build.yml', 'utf8'), { uniqueKeys: true });
assert.deepEqual(parsed.errors, []);
const workflow = parsed.toJS();
assert.deepEqual(Object.keys(workflow.on), ['workflow_call']);
assert.deepEqual(workflow.permissions, { contents: 'read' });
assert.deepEqual(Object.keys(workflow.jobs), ['preflight', 'candidate-build', 'attestation']);
let shellBlocks = 0, nodeBlocks = 0, githubBlocks = 0;
for (const [name, job] of Object.entries(workflow.jobs)) {
  assert.equal(job.if, '${{ false }}');
  assert.deepEqual(job.permissions, name === 'attestation' ? { contents: 'read', 'id-token': 'write', attestations: 'write' } : undefined);
  for (const step of job.steps) {
    if (step.uses) assert.match(step.uses, /^actions\/[a-z-]+@[0-9a-f]{40}$/);
    if (step.run) {
      const shell = spawnSync('/bin/bash', ['--noprofile', '--norc', '-n'], { input: step.run, encoding: 'utf8', env: { PATH: process.env.PATH } });
      assert.equal(shell.status, 0, shell.stderr); shellBlocks++;
      const bodies = [...step.run.matchAll(/node --input-type=module <<'JS'\n([\s\S]*?)\nJS/g)].map((match) => match[1]);
      bodies.push(...[...step.run.matchAll(/node --input-type=module -e '([^']*)'/g)].map((match) => match[1]));
      for (const body of bodies) {
        const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: body, encoding: 'utf8', env: { PATH: process.env.PATH } });
        assert.equal(syntax.status, 0, syntax.stderr); nodeBlocks++;
      }
    }
    if (step.with?.script) { new Script('(async () => {\n' + step.with.script + '\n})'); githubBlocks++; }
    if (step.uses?.startsWith('actions/attest@')) {
      assert.equal(step.uses, 'actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6');
      assert.equal(step.with['predicate-type'], undefined); assert.equal(step.with['predicate-path'], undefined);
      assert.equal(step.with['create-storage-record'], false);
      assert.deepEqual(step.with['subject-path'].trim().split('\n'), ['native-output/verify_fusou_tlsn_evidence', 'native-output/native-build-metadata.json']);
    }
  }
}
assert.equal(shellBlocks, 5); assert.equal(nodeBlocks, 4); assert.equal(githubBlocks, 2);
assert(workflow.jobs.preflight.steps.at(-1).run.includes('process.exitCode = 1'));
assert(workflow.jobs['candidate-build'].steps.some((step) => step.run?.includes('if (!result.build_authorized)')));
console.log(`PASS: fixed gates, scoped permissions, immutable pins, standard SLSA subjects; syntax-only ${shellBlocks} shell / ${nodeBlocks} Node / ${githubBlocks} github-script blocks. No scripts executed.`);
JS
```

After adding further missing-pin/capture/mandatory-timestamp cases and
reviewing existing consumer fixtures as synthetic/API/process doubles,
final selected syntax/tests: **PASS**, 211/211, fail/skip/cancel 0, exit 0.
Fixtures are schema examples, not real gh output/signed bundles.
Crypto generate/sign and external fetch tripwires remain intact.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH node --check scripts/release-native-attestation.test.mjs && env -u NODE_OPTIONS -u NODE_PATH node --test scripts/release-native-attestation.test.mjs scripts/release-native-build.test.mjs scripts/release-evidence-producer.test.mjs scripts/release-checks.test.mjs scripts/release-consumer.test.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/native-gh-consumer-final-tests.log 2>&1; result=$?; tail -n 25 /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/native-gh-consumer-final-tests.log; exit "$result"
```

Final version blocker classification was tightened to distinguish unparseable/
missing versions (`NATIVE_GH_VERSION_UNKNOWN`) from recognized unsupported
versions (`NATIVE_GH_VERSION_UNSUPPORTED`), with exact code assertions.
Repeated syntax plus the complete selected suite: **PASS**, 211/211,
fail/skip/cancel 0, exit 0.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && env -u NODE_OPTIONS -u NODE_PATH node --check scripts/release-native-attestation.mjs && env -u NODE_OPTIONS -u NODE_PATH node --check scripts/release-native-attestation.test.mjs && env -u NODE_OPTIONS -u NODE_PATH node --test scripts/release-native-attestation.test.mjs scripts/release-native-build.test.mjs scripts/release-evidence-producer.test.mjs scripts/release-checks.test.mjs scripts/release-consumer.test.mjs > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/native-gh-consumer-final-tests.log 2>&1; result=$?; tail -n 25 /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/native-gh-consumer-final-tests.log; exit "$result"
```

Unchanged draft/native manifest/lock and actual preflight: **PASS**, exit 0.
The observed refusal is `BLOCKED_IMPLEMENTATION`; source adapter/wiring
readiness is diagnostic, not native build or provenance authorization.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU && git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --exit-code HEAD -- scripts/release-native-policy.draft.json packages/FUSOU-TLSN-VERIFIER/Cargo.toml packages/FUSOU-TLSN-VERIFIER/Cargo.lock && env -u NODE_OPTIONS -u NODE_PATH node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readNativeBuildPreflight, NATIVE_BLOCKER } from './scripts/release-native-build.mjs';
const result = await readNativeBuildPreflight();
assert.equal(result.source_contract, 'SOURCE_CONTRACT_READY');
assert.equal(result.gh_verifier_adapter, 'SOURCE_IMPLEMENTED_NOT_RUN');
assert.equal(result.attestation_source_wiring, 'CANDIDATE_CONNECTED_UNAPPROVED');
assert.equal(result.build_authorized, false); assert.equal(result.authenticated, false);
assert.equal(result.cargo_locked_consistency, 'NOT_CHECKED');
assert.equal(result.offline_verification, NATIVE_BLOCKER);
assert.equal(result.publication_authorized, false);
assert.equal(result.deployment, 'NOT_CHECKED'); assert.equal(result.production_acceptance, 'BLOCKED');
console.log(JSON.stringify({ status: result.status, source: result.source_contract, adapter: result.gh_verifier_adapter, blockers: result.blockers }, null, 2));
JS
```

### Non-executed work, state and local persistence

**NOT_RUN**: Cargo/Rust/WASM/APP/Worker/native build or execution; real
`gh attestation verify` (online or offline); workflow execution; attestation
issuance; operational API calls; signing/key generation; deploy/publish.
No push, PR or tag was created. Hudsucker defaults/dependencies were unchanged.
Lock consistency/complete source closure, trusted builder/immutable revision,
repository/owner/bootstrap policy, executable verifier distribution/registration,
native acquisition proof and formal launcher/report authentication remain
unresolved. Source implementation does not discharge these conditions.

Delegation remains PROPOSED/unapproved, reusable workflow fixed-disabled,
`DERIVED_NOT_AUTHORIZED`, both archive-grant registration blockers and
`FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED` maintained. Four real checks
remain UNVERIFIED, `publication_authorized: false`, deployment NOT_CHECKED,
Production acceptance BLOCKED.

Eleven-path working/staged whitespace: **PASS**, exit 0. Repeat as the commit
gate after recording the observed result.

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
set -- scripts/release-native-build.mjs scripts/release-native-build.test.mjs scripts/release-native-attestation.mjs scripts/release-native-attestation-fixture.mjs scripts/release-native-attestation.test.mjs scripts/release-consumer.mjs .github/workflows/tlsn-native-build.yml packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-contract.mjs packages/FUSOU-TLSN-VERIFIER/README.md docs/architecture/adr-tlsn-grant-authority-delegation.md docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --check -- "$@" && git -c core.fsmonitor=false add -- "$@" && git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --cached --check -- "$@"
```

Cleanup only the three tool-generated public-source temporary captures:
**PASS**, exit 0.

```sh
rm -- /tmp/1793190698005-copilot-tool-output-0c5d9f33ba754f37b3c1a5bad4c43d11.txt /tmp/1793190698027-copilot-tool-output-392dcbbca41243eab19af289783c1a72.txt /tmp/1793190719107-copilot-tool-output-e2874c4e3c4441999ff61e4208110f7e.txt
```

Unsigned local-only commit through the unchanged normal scoped hook.
Outcome is observed on execution, not assumed in this pre-commit record:

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
set -- scripts/release-native-build.mjs scripts/release-native-build.test.mjs scripts/release-native-attestation.mjs scripts/release-native-attestation-fixture.mjs scripts/release-native-attestation.test.mjs scripts/release-consumer.mjs .github/workflows/tlsn-native-build.yml packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-contract.mjs packages/FUSOU-TLSN-VERIFIER/README.md docs/architecture/adr-tlsn-grant-authority-delegation.md docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
test "$(git branch --show-current)" = tlsn-first-testplay-candidate && test "$(git rev-parse HEAD)" = ab2f35ba4781e8b544165ead911f927b3de9ee30 && git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --check -- "$@" && git -c core.fsmonitor=false add -- "$@" && git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --cached --check -- "$@" && git --no-pager -c core.fsmonitor=false -c commit.gpgsign=false commit --only -m "feat(tlsn): wire blocked native attestation and official gh adapter" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" -- "$@" > /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/native-gh-adapter-commit.log 2>&1; result=$?; tail -n 28 /home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/native-gh-adapter-commit.log; exit "$result"
```

Final branch/HEAD/parent, eleven-path scope/committed whitespace and unchanged
draft/native inputs are observed after commit (the commit's own SHA cannot
be embedded in itself):

```sh
cd /home/ogu-h/Documents/GitHub/FUSOU
set -- scripts/release-native-build.mjs scripts/release-native-build.test.mjs scripts/release-native-attestation.mjs scripts/release-native-attestation-fixture.mjs scripts/release-native-attestation.test.mjs scripts/release-consumer.mjs .github/workflows/tlsn-native-build.yml packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-evidence-contract.mjs packages/FUSOU-TLSN-VERIFIER/README.md docs/architecture/adr-tlsn-grant-authority-delegation.md docs/implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md
git branch --show-current && git rev-parse HEAD HEAD^ && git -c core.fsmonitor=false status --short --untracked-files=all -- "$@" && git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --check HEAD^ HEAD -- "$@" && git --no-pager -c core.fsmonitor=false diff --no-ext-diff --no-textconv --exit-code HEAD^ HEAD -- scripts/release-native-policy.draft.json packages/FUSOU-TLSN-VERIFIER/Cargo.toml packages/FUSOU-TLSN-VERIFIER/Cargo.lock
```

## Nonblocking capture and local journal implementation follow-up

The local implementation separates normal Game Server proxy traffic from
optional TLSN capture without changing the existing evidence schema or
authority contract:

1. The APP starts the ordinary proxy first. Runtime Config refresh, preflight,
   Worker health validation and TLSN dependency construction run in a
   background task. The capture forwarder is installed only after success;
   failure leaves capture unavailable and ordinary proxy traffic active.
2. Capture admission is per matching request, not a listener-global one-shot.
   The route requires a ready prepared binding, a free one-request slot and
   supported bounded body framing. A not-ready binding, competing request,
   unsupported body or unavailable TLSN ingress slot follows the ordinary
   proxy before body consumption.
3. Default Hudsucker capture selection requires one bounded Content-Length no
   greater than the 128 KiB TLSN sent-data ceiling; the complete serialized
   request has the same 128 KiB ceiling. Its ingress collector adds a 1 MiB
   body cap, 10-second idle / 30-second completion timeout and eight-slot
   reservation. Non-target and not-ready requests bypass these TLSN-specific
   limits. A selected body read failure after partial consumption fails closed;
   it is not replayed through another route.
4. The APP journal durably appends a binding-derived attempt digest, canonical
   target and serialized request digest before origin transport I/O. It does
   not persist the binding value or raw request body. Restart converts an
   unfinished send into `UNKNOWN` and refuses reuse of that attempt digest.
   A successful origin response is returned without waiting for the journal's
   terminal `ResponseReceived` sync; a crash before that update remains
   conservatively `UNKNOWN`.
5. This local journal and the Worker Binding Authority's existing durable
   per-binding record do not form a stable logical Game Server attempt
   reservation. The Worker record does not bind an operation ID, request
   digest or origin-send intent, and a new binding cannot prove that a
   repeated logical operation is new. No endpoint, signer or ownership policy
   was added to fill that gap. Ambiguous writes remain non-retryable and the
   Game Server receipt remains `UNKNOWN`.

The source/test follow-up is locally verified: Proxy default library tests
122/122 pass, `rama-experimental` Proxy library tests 155/155 pass, the APP
`tlsn-production` library/binary check passes with existing warnings, and the
APP Runtime Config transport-gate tests 7/7 pass. These are local Rust tests,
including synthetic and loopback cases; they do not prove
deployed services, a real Presentation, user gameplay or Production
acceptance. The earlier Phase 1/authority policy questions remain unresolved;
these implementation changes do not authorize a new logical-attempt policy.
