# FUSOU TLSN Data Authenticity Implementation Roadmap

**Status:** Release contracts and conservative local delivery policy implemented;
broader authority/wire semantics and external execution remain blocked.
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
