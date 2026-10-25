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

### Operator handoff and restart conditions

Owner names below are roles, not an assertion that a particular person has
been appointed. No approvals, real endpoints, or trust material were supplied
by this local follow-up. Follow the existing
[`operator runbook`](../../packages/FUSOU-TLSN-VERIFICATION-WORKER/docs/production-evidence-operator-runbook.md)
and
[`revision/contract audit`](tlsnotary-alpha15-revision-attestation-id-interoperability-audit.md);
historical observations there are not current deployment evidence.

| Item | Classification | Status | Required evidence or decision | Responsible role | Resume after resolution |
| --- | --- | --- | --- | --- | --- |
| P0-01 revision/patch approval | Human approval | `BLOCKED` | Explicit approval of upstream alpha.15 revision `47aee45b53e06648c1b2ad3689b367b8c923fdec`, exact sparse transcript/proof-opening patches and mux source/diff, compatibility, license and independent security review recorded in the revision audit. Source mapping is not approval. | Release/security approvers and license reviewer | Approve the exact dependency/patch set for Phase 0 and the candidate build. |
| P0-10 Sparse/cross-language contract | Protocol decision | `BLOCKED` | Versioned precedence for ClaimBindingBytes 8-/11-field layouts, receipt JSON canonicalization/unknown fields, normative Sparse Presentation serialization/range semantics, independent expected values and WASM provenance. Source-derived fixtures are not a normative oracle. | Protocol owner and human release authority | Fix the approved implementation/testplay scope and independent interoperability expectations; no unapproved exploratory exception. |
| Q1-Q5 | Protocol/product decision | `BLOCKED` | Attempt scope; failure/retry/recovery; response/evidence states; Session/receipt freshness and revalidation; accepted-size versus per-request/process-wide memory boundary. | Protocol/product owners and human release authority | Implement only the approved Phase 2 controls and dependent Phase 3 tests. |
| Runtime Config bootstrap | External trust/release inputs | `BLOCKED` | Independently approved endpoint and signer/root pin, registered production signer, signed manifest, active epoch and raw digest-bound artifacts. Local signing/publication registration is still gated. | Trust authority and Runtime Config/release operators | Supply controlled APP build inputs, publish/read back the approved manifest, then run runtime preflight. |
| Actual target, Origin Inventory and Target Approval | External target/approval evidence | `BLOCKED` | Canonical lowercase DNS target from an authoritative source, exact raw artifacts, signatures, relationship and membership. APP selection is only an expectation. | Human target owner and deployment operator | Runtime must verify approval before proxy start; post-capture must independently match Presentation-derived identity. |
| Worker deployment/reference and Result authority | External implementation/deployment evidence | `UNVERIFIED` | Actual runtime/collector/archive source, deployed SHA/version, exact endpoint mapping, independently pinned reference hash, Result signer registry/envelope/root pins and observed generation/signing/delivery. | Worker/release and evidence-storage operators | Review the implementation, obtain the real pinned reference, then prepare the APP candidate and archive readback. |
| Notary | External service/trust evidence | `UNVERIFIED` | Deployed revision/patch identity, endpoint, raw registry and selected key from independent trust information. | Notary operator and trust authority | Verify the configured trust binding, then capture against the approved real Notary. |
| Auth/device/Session and Binding Authority | External authenticated authority | `UNVERIFIED` | Nonanonymous Auth, registered device ownership and revocation state, deployed handlers/registries, signed Session/consume receipts bound to the same device/session/binding/Presentation, and replay state. | WEB/Auth and authority operators | Establish the authenticated APP session and runtime gates; independently verify receipts and replay after capture. |
| Clean approved APP candidate build | Local/release preparation | `NOT_CHECKED` | Approved APP SHA/patch set, committed lockfile, locked dependencies, pinned toolchain, independent Worker reference and controlled public/bootstrap inputs. Mock build success is not a build. | Release operator | In an authorized environment, perform the real build, compiled-input comparison and local/runtime preflight. This task must not run that protected-file-sensitive path. |
| Human gameplay authorization | Human approval | `BLOCKED` | Approved dependency/wire scope, target, operator, evidence plan and stop conditions, with all pre-capture runtime gates satisfied. | Human release authority | Human-only APP gameplay; a local readiness report never substitutes for this decision. |
| Real capture, archive and independent verification | Human/service evidence | `UNVERIFIED` | Same-communication raw Presentation, transcript, signed Result, Session/consume receipts, independent keys/registries/Inventory/Approval, exact archive keys/readback/lengths/hashes, and separate-machine offline verification including negative mutations. | Human operator, evidence-storage operator and independent verifier | Evaluate the human gameplay gate; only then evaluate the separate Production acceptance criteria. |

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
