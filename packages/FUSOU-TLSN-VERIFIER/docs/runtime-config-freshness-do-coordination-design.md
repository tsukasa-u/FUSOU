# Runtime Config Freshness DO Coordination — P2 Design

## Status and scope

**DESIGN ONLY.** This document specifies a candidate coordination model. It
does not implement or register a Durable Object, migration, binding, RPC,
Journal, R2 adapter, signer, route, secret, or deployment. It does not change
the APP/Worker wire contract or Production readiness.

The Phase 0 protocol remains the normative wire specification. This design
finds that its current “at most 8-second issue lease” description cannot safely
be implemented as a DO wall-clock expiry that automatically removes an
in-flight lease. The P2 implementation must preserve the 8-second operational
target without using expiry as a lock-release event. If the protocol owner
requires a hard 8-second authorization cutoff, a trusted clock and a
demonstrable signer cancellation/fencing contract are still required; neither
is established by the current source or Cloudflare documentation. Until that
conflict is resolved, P2 Production implementation is **BLOCKED**.

The selected safe coordination candidate is an explicit, durable issue
operation with a fencing token, a persisted writer gate, and no time-based
automatic lease release. A signer timeout or crash leaves the operation
unsettled and blocks Release until recovery proves the old signer cannot
produce or return a response. This favors safety over availability.

## Baseline

- Repository: `tsukasa-u/FUSOU`
- Branch: `tlsn-first-testplay-candidate`
- Start HEAD: `839c4413fe035fc0b679d70125522d18514ec6ee`
- Parent: `83eecbfd3a145dc1773d4ce45c48da4a1f7bd2c1`
- The branch, HEAD, and parent matched the requested baseline.
- The index was empty.
- Existing local edits to the root `justfile` and
  `packages/FUSOU-APP/src-tauri/roaming/user/configs.toml` were present and
  remain out of scope. They were not changed or staged.
- No Production API, R2, Durable Object, HSM, deployment, Game Server, or
  Notary operation was performed.
- Cloudflare official documentation was checked on **2026-11-02**; URLs and
  their relevant guarantees are listed below.

## Decision summary

1. A clock deadline is not a safe mechanism to clear a live Freshness issue
   operation. At eight seconds, the request may be considered overdue, but the
   durable issue record remains a blocker until explicit completion or proven
   cancellation.
2. The DO serializes only local state transitions. All Journal, R2, HSM, and
   service calls happen outside a DO storage transaction.
3. A Release that wins `beginRelease` sets `writer_pending` atomically and
   blocks new issue grants. Any issue granted earlier remains a blocker until
   it is settled. Release cannot CAS the pointer or append the Journal record
   while an issue operation is unsettled.
4. A Freshness signer may return bytes only after a final DO transition
   validates the same issue ID, generation, fence, and request digest and
   durably records the exact response. An orphan signature is never a
   successful response.
5. Journal append of the exact authorized Release record is the Release commit
   point. DO `COMMITTED` is only post-append coordination state.
6. Operation records, lease IDs, and terminal tombstones cannot be deleted
   based on a DO timer. A bounded retention policy requires an independently
   anchored replay checkpoint; none is selected.
7. SQLite PITR can roll back DO operation and fencing state. A Journal head
   can detect some Release rollbacks, but not all RPC replay-cache rollbacks.
   The system cannot claim rollback-resistant RPC replay protection until an
   external anti-rollback control is selected and tested.
8. The APP's existing single 10-second request-to-acceptance deadline and
   existing Freshness response contract remain unchanged. Eight seconds is an
   operational budget, not permission to extend the APP deadline or accept a
   stale response.

## Source investigation

The checked-out source, rather than a prior report or commit message, was used
for this design.

| Source | Observed fact |
|---|---|
| `docs/runtime-config-freshness-protocol.md` | Section 5.3 requires an at-most-8-second issue lease, reads the Journal/DO/R2/snapshot/Manifest, samples `issued_at` while the lease is valid, checks the same lease after signing, and discards a signature if the lease or delegation expires. Sections 6–7 define `PREPARED`, `POINTER_COMMITTED`, `COMMITTED`, recovery, and Journal append as Release commit point. |
| `docs/runtime-config-freshness-production-authority-design.md` | The design assigns coordination to a per-environment DO, sets a writer gate before external mutation, and requires role-specific HMAC RPC. It identifies Production DO, Journal, R2, and signer services as unimplemented. This document links to the present clock/replay/PITR follow-up. |
| `FIRST-TESTPLAY-READINESS.md` | The inspected readiness record reports the in-memory Freshness/release tests as test-only and Production Freshness as `NOT_IMPLEMENTED`; trust-owner/Production registration and Stage A/B/C remain `BLOCKED`. Its recorded audit base predates this P2 baseline; it was not updated here. |
| `FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/domain.ts` | P1 exports wire/domain types and validation contracts, including string-encoded generation values and verified-result interfaces. These are TypeScript-level values, not runtime proof at a Worker/RPC trust boundary. |
| `FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/signers.ts` | P1 Release and Freshness signer requests are purpose-specific, but contain structurally constructible `PendingReleaseAttemptBinding`, `VerifiedJournalHeadBinding`, `VerifiedDelegation`, and `VerifiedCurrentFreshnessState` values. A Production signer must independently reload and verify trusted facts; it must not accept those structures as proof. |
| `FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/test/fixtures/freshness-v1-golden.json` | P1 has shared wire vectors. This design makes no changes to them and does not claim new cross-language test results. |
| Worker `src/index.ts` and `wrangler.toml` | The inspected Worker has no Runtime Config Freshness route, Runtime Config authority binding, Runtime Config Journal, or Runtime Config signer service binding. Existing `TLSN_BINDINGS` is for verification/session binding and is not the Runtime Config authority. |
| Worker `src/binding_authority.ts` | `TlsnBindingAuthorityDurableObject` implements a different verification-binding lifecycle. It uses its own state and alarm behavior; it is not a Freshness coordination implementation and must not be reused as one. |
| Worker `scripts/tlsn-runtime-config-freshness-test-adapters.mjs` | `InMemoryReleaseCoordinationForTest` prunes leases using its injected test clock, stores `expires_at_ms`, gates Release on leases, and releases a lease in `finally`. Its `issueFreshness` model is in-memory and does not model an isolate/process crash or a non-cancellable remote signer. It is not evidence that a Production timer safely releases a lease. |
| Worker `scripts/tlsn-runtime-config-release.mjs` and `scripts/tlsn-runtime-config-r2-store.mjs` | The existing publisher/object-store paths are Node/test-oriented, with injected signer and S3-compatible client interfaces. They are not a Worker Runtime Config authority, a Production Journal, or a Worker R2 adapter. |
| Worker `package.json` | The inspected package provides typecheck/build scripts but no configured Cloudflare Vitest DO integration suite for this authority. |

No source or readiness file was changed for this task.

## Cloudflare runtime facts and consequences

Official documentation was retrieved on 2026-11-02:

| Cloudflare documentation | Verified runtime fact | Design consequence |
|---|---|---|
| [SQLite-backed Durable Object Storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) | DO storage is transactional and strongly consistent; storage methods are implicitly atomic/isolated; the runtime uses input/output gates around storage operations. SQLite PITR can restore SQL and KV contents to any point in the prior 30 days. | Use one SQLite-backed DO per environment for local CAS/state transitions. Keep all authority state durable. Treat every operation row, lease row, fence counter, and tombstone as rollbackable by PITR. Storage gates do not create a transaction with R2, Journal, or HSM. |
| [Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/) | DO instances can hibernate with in-memory state discarded, cold start, and restart on runtime/code lifecycle events. Pending operations have lifecycle limits; when an instance shuts down, storage-touching in-flight requests can fail and must be retried. | Never keep an issue count, fence, writer gate, or release state only in memory. Restart is not a release signal. A new instance must load durable state and preserve all unsettled blockers. |
| [Performance and timers](https://developers.cloudflare.com/workers/runtime-apis/performance/) | In deployed Workers, `Date.now()` and `performance.now()` only advance after I/O; `performance.timeOrigin` is `0`. Local development timers do not reproduce the deployed timer behavior. | There is no verified DO-to-signer clock bound or reliable eight-second lease-expiry proof from these timers. A clock jump after an awaited R2/Journal/HSM operation can make a deadline check disagree with the actual ordering/progress of a different worker. Never use such a deadline to remove the blocker. |
| [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/) | Each DO has one alarm. Alarms are at-least-once; handler failures are retried with exponential backoff starting at two seconds, for up to six retries. Alarm operations use the storage API. | An alarm may wake a reconciler or emit an operational signal. It is not a precise lease-expiry mechanism and must never clear a lease, advance a fence, authorize a Release, or permit a signer response. |
| [Workers RPC](https://developers.cloudflare.com/workers/runtime-apis/rpc/) | Public RPC methods on a DO can be invoked by Workers on the same account that bind to it. RPC arguments/results are structured-clone values. | A namespace binding controls which Worker can call the DO, but it does not prove a caller's business role or preserve TypeScript nominal brands. Validate every DTO and MAC at runtime. |
| [Durable Object roles and permissions](https://developers.cloudflare.com/workers/authorization/durable-objects/) | Durable Objects do not have per-object/per-method roles; access is determined by access to the implementing Worker. | Do not treat a DO namespace binding as a Release-signer/Freshness-signer/Authority role boundary. Use narrow methods and authenticated, role-specific requests. |
| [Service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/) | Service bindings can make an internal Worker inaccessible from the public Internet, but `ctx.access` does not propagate between Workers over HTTP or RPC. | Internal routing is useful isolation, not caller authentication. Do not assume Cloudflare Access context authenticates a downstream RPC. |

These pages document platform behavior, not an external signer clock, an HSM
cancellation guarantee, an exactly-once HSM operation, or an anti-rollback
checkpoint. None of those guarantees is assumed here.

## Lease/fencing candidates

The current protocol's eight-second bound is kept as an operational target.
It is **not** treated as a safe automatic unlock. The APP's 10-second deadline
is not extended to compensate for a longer server request.

| Candidate | Safety | Availability / crash recovery | Clock and signer behavior | Decision |
|---|---|---|---|---|
| **A. DO wall-clock deadline** | Unsafe as an automatic release condition. A forward jump or a timer advancing after I/O can expire a row while the signer is still processing. A backward/frozen timer can retain it indefinitely. | Appears available when the row expires, but can let Release mutate while an old signer can still return. Restart does not repair the proof. | Requires bounded DO wall-clock behavior and a relation to signer/HSM time that Cloudflare does not document. An alarm is not exact. | Reject as a correctness boundary. |
| **B. Generation/fencing token alone** | Rejects an old token only if every signer result and response path checks it at a trusted finalization gate. A token alone does not stop a signer that already holds a signature from returning it outside that gate. DO counter rollback under PITR can revive old values. | Good for detecting stale local operations in a non-rolled-back database; recovery still needs an external anchor. | Does not require a clock, but requires all response sinks and signer calls to obey the fence. A delayed signer may keep running. | Use fencing as a necessary check, not as the only lease/recovery protocol. |
| **C. Two-phase DO and signer-clock validation** | A pre-sign check and post-sign check do not by themselves serialize Release with a signature already in flight. Separate clocks cannot atomically prove that the lease remains live. | Can reject late responses if the signer stops, but timeout/cancellation of the HSM or downstream response path is unproven. | Requires signer clock bounds and cancellation semantics. A DO-side comparison still has no documented cross-worker clock bound. | Use independent signature-time validation as defense in depth; do not use it to release the DO blocker. |
| **D. Explicit durable operation, writer-pending, fencing, explicit completion/recovery** | Safe under the stated gate: Release waits for every pre-existing issue operation; only the exact fenced operation can finalize and return; an unsettled signer blocks. No wall clock can clear it. PITR remains a separate anti-rollback gap. | Fail-closed but may block Release indefinitely after signer/HSM/network failure. Restart preserves the blocker. Recovery needs proof that the old signer cannot return or deliver. | No lease-expiry clock is assumed. The 8-second target can trigger an operational timeout/alert only; timeout does not free the blocker. | **Selected P2 candidate.** |
| **E. External linearizable lease/cancellation or signer executor** | Could support safe revocation only if every signing/response sink enforces a fencing generation and the external authority proves old work is quiescent before reuse. | Can improve recovery if provider is durable and independently operated; provider outage still fails closed. | Requires an approved provider with documented monotonic state, cancellation semantics, and restore/rollback controls. | Not selected or assumed. Provider and trust boundary are unresolved. |

### Selected lease semantics

- Grant is a durable issue-operation row with an unguessable `lease_id`,
  unique `operation_id`, canonical request digest, current Release generation,
  and fencing token.
- The lease does **not** disappear when a timestamp passes, an alarm fires, an
  isolate restarts, a request times out, or an RPC caller disconnects.
- The eight-second value is an issuance-operation budget/SLO. A service may
  stop waiting and mark the operation `IN_DOUBT` at that budget, but it may
  not infer that the HSM/signer stopped or that a signature cannot still be
  delivered.
- A response is eligible only after exact post-sign finalization under the
  same live operation and fence. The signer/gateway must have no alternate
  return path that bypasses this finalization.
- Normal terminal states are `COMPLETED` or `ABORTED_SAFE`. `ABORTED_SAFE` is
  allowed after signing begins only when the signer/HSM integration proves
  that outstanding signing and response delivery have been cancelled or
  fenced. Otherwise the state is `IN_DOUBT` and blocks Release.
- Release can set `writer_pending` while issues exist. This blocks new grants
  but does not revoke a lease granted earlier; the existing issue may finish
  under the old current generation. Release pointer CAS and Journal append
  wait until all such issues are terminal.
- A forced recovery transition increments the durable fence and tombstones
  the old lease only after an independently verified quiescence/revocation
  event. Updating the DO row alone is not proof that a remote signer stopped.
- This changes only internal coordination semantics; it does not add fields
  to the APP request/response. The current normative “at most 8 seconds”
  requirement remains a P2 blocker until its hard authorization meaning is
  either supported by approved clock/cancellation evidence or formally
  revised. The design does not silently redefine it as a guaranteed timeout.

## RPC authentication and replay model

### Closed request and MAC contract

The P2 RPC DTO is exact-schema, versioned, and rejects unknown fields. Its
authenticated claims include:

- protocol version, fixed Production environment, caller role, operation;
- key ID, unique operation ID, lease ID when applicable, fencing token when
  applicable;
- SHA-256 digest of the exact canonical operation body;
- a fresh nonce and audit timestamps;
- HMAC over a domain-separated canonical encoding of every claim above,
  excluding only the MAC field itself.

The body digest is computed from the exact canonical JSON bytes defined by the
runtime-config domain contract. The outer RPC encoding must also be exact:
schema validation, canonical JSON, no duplicate/unknown fields, canonical
unpadded base64url where used, and no numeric coercion for generation/fence
values. The receiver reconstructs the canonical preimage; caller-provided
digest text is not trusted.

Each environment/role/key ID has a distinct secret. The DO is pinned to one
environment and compares the request environment to its configured value.
The method's expected role is configured server-side; the request cannot
select which key or role policy it wants. An Authority key cannot call a
Freshness-signer method merely by changing the role field. Release signer,
Freshness signer, and Release Authority use separate credentials and
capabilities. No Result-signing key or verification callback secret is
reused.

Use the platform cryptographic verification primitive (for example
`crypto.subtle.verify` for HMAC) through a narrow verifier contract. Do not
implement an early-exit MAC comparison with `===` or a hand-written byte
loop. The Production implementation must verify and document the constant-time
property of its chosen platform/provider primitive; if that property cannot be
established, it is a launch blocker. Secrets and MACs are never logged or
included in errors.

`issued_at`/`expires_at` can be included for audit and, after approved clock
bounds exist, additional rejection. They are not the replay defense and do
not permit an operation row or lease to be deleted. A nonce alone is also not
replay protection unless its use is recorded durably and protected against
rollback.

### Operation IDs, exact retries, and leases

Every mutating RPC has a unique `operation_id`. The DO transaction checks the
operation record before changing state:

1. An existing ID with the same environment, role, operation, and canonical
   request digest is an exact retry. Return the recorded state/result without
   repeating an external side effect.
2. The same ID with any different role, operation, or request digest is
   rejected. Do not overwrite or “repair” the old request.
3. A new operation ID may proceed only if the current durable state and
   fencing checks allow it.
4. An in-progress exact retry returns `IN_PROGRESS`; it does not start a
   second signer call or Journal/R2 write.
5. A completed response operation stores the exact response bytes (or an
   equally exact, durably recoverable representation) so an exact retry does
   not re-sign. Response-size/storage cost and retention limits must be tested
   before deployment.
6. A `lease_id` is unique and never reused. Completion, safe abort, or
   revocation leaves a terminal tombstone. “Expired” is not a state that
   allows the same ID to be acquired again.

The replay ledger and tombstones have no time-based deletion in this
candidate. Their growth requires a retention/checkpoint design. Deleting them
without a rollback-resistant watermark would violate exact-retry and replay
invariants.

### Key rotation

- Provision unrelated keys for each `(environment, role, key_id)` tuple.
- New operations use the active key ID. During an overlap, a retiring key may
  authenticate only an exact retry already present in the operation ledger;
  it may not authorize a new operation.
- Revoke the old key after known in-flight operations are terminal. Do not
  use a time window as the only overlap boundary.
- A PITR restore is a security incident: disable callers/signers first,
  reconcile durable Release state against the independent Journal, rotate
  role keys and the external restore/incarnation epoch, then explicitly
  re-enable the service.
- Rotating a key invalidates captured old MAC bytes, but does not reconstruct
  a tombstone lost by PITR if a caller can re-authenticate an old semantic
  operation under the new key. An external monotonic operation/incarnation
  checkpoint or equivalent enforced caller protocol is still required.

### PITR and replay guarantees

SQLite PITR can restore the DO database to an earlier point in the prior 30
days. Therefore it can roll back the committed coordination head, pending
attempt, writer gate, issue rows, operation results, operation IDs, nonce
records, terminal lease tombstones, HMAC key state stored in SQLite, and the
fencing counter.

The DO cannot detect its own rollback solely from restored state. A live
independent Journal can detect a DO head older than a Journal commit and
permit exact-record Release recovery. It cannot prove that a pre-append
operation ID, issue lease, or RPC nonce was not already used if the Journal
head did not change. A Journal and DO restored to mutually consistent old
heads are also indistinguishable without a third independent checkpoint.

Required Production rule: no DO PITR restore may be made live until an
out-of-band restore procedure has disabled all callers, changed a
non-rollbackable incarnation/key epoch, reconciled the current Journal and R2
state, and cleared any in-doubt signer operation with independently verifiable
evidence. Cloudflare does not document an automatic callback that would make
the DO detect an operator-triggered PITR restore. An unannounced or
uncontrolled restore is therefore **BLOCKED** for Production use.

The Journal provider is unselected, and no external replay checkpoint exists.
Consequently, this design does **not** claim that a DO-only operation table
can meet the requested rollback-resistant replay invariant. Production RPC
replay protection remains **BLOCKED** until that independent control is
selected, owned, and tested.

## Proposed state schema

One SQLite-backed Runtime Config coordinator is routed per environment. This
is a new namespace/class, not the existing `TLSN_BINDINGS` verification DO.
The `environment` is stored in state and pinned in deployment configuration;
every request must match both.

| Record | Durable fields and invariants |
|---|---|
| `control` (one row) | `schema_version`; pinned `environment`; `state_version` as canonical decimal text; current committed Release generation, record digest, Manifest epoch/digest/ref, pointer ETag, commit ID and authenticated Journal append metadata; pending attempt ID; `writer_pending`; `recovery_state`; next fencing token as canonical decimal text. Active issue count is derived from issue rows or transactionally cross-checked, never trusted from an in-memory cache. |
| `release_attempt` (at most one nonterminal row) | Exact attempt ID/request digest; candidate generation, epoch, Manifest digest/ref and immutable object identifiers; expected previous generation/record digest/Journal head/ETag; `PREPARED`/`WAITING_FOR_LEASES`/`POINTER_COMMITTED`/append/recovery state; durable pointer-write-started bit; exact persisted authorization bytes and digest; exact Journal result/append metadata after verified append. Caller-supplied values are expectations only. |
| `issue_operation` | Unique operation ID and canonical request digest; role/environment; request nonce; challenge digest; unique lease ID; current Release generation; fencing token; operation state; whether signing started; exact response bytes and digest if finalized; terminal reason/tombstone. No wall-clock TTL may delete a nonterminal row. |
| `rpc_operation` / idempotency record | Operation ID, expected role/environment/operation, exact authenticated request digest, outcome state, exact durable result or result reference. Same ID plus different digest is a hard rejection. Retention/compaction is blocked pending external anti-rollback policy. |
| `key_policy` (non-secret metadata only) | Allowed `(role, key_id, state)` values and rotation generation. HMAC key bytes remain in the approved secret system, not SQLite. Current key policy alone is not rollback-resistant. |
| `recovery` | `NORMAL`, `RELEASE_WAITING_FOR_ISSUES`, `SIGNER_IN_DOUBT`, `JOURNAL_RECONCILIATION_REQUIRED`, or `RESTORE_QUARANTINED`, with exact operation/attempt IDs and evidence digests. Recovery cannot be cleared by a timeout or alarm. |

Generation, epoch, and fence values follow the P1 wire representation: parse
canonical decimal strings into `BigInt`, enforce their defined unsigned
range, and fail closed on overflow. Do not convert a 64-bit generation/fence
to a JavaScript `number` or rely on SQLite signed integer arithmetic for an
unsigned value. Persist canonical decimal text (or a specified fixed-width
binary encoding) and compare only after exact parsing. No counter wraps.

The SQLite schema must enforce uniqueness for operation/lease/attempt IDs.
All control-row and related operation-row changes occur in one local storage
transaction. There is no transaction spanning a DO and external service.

## State transitions and linearization

### Release

```text
COMMITTED
  -> writer_pending + WAITING_FOR_ISSUES (if any issue is unsettled)
  -> PREPARED
  -> POINTER_WRITE_PENDING
  -> POINTER_COMMITTED
  -> AUTHORIZATION_STORED
  -> JOURNAL_APPEND_PENDING
  -> JOURNAL_COMMITTED
  -> COMMITTED
```

`beginRelease` is one DO transaction: validate the exact prior head and
attempt ID, persist `writer_pending`, reject new Freshness grants, and either
wait for prior issue operations or enter `PREPARED`. The existing issue
operations are not invalidated by that gate.

The Authority Worker performs R2 CAS outside the transaction. It persists
`POINTER_WRITE_PENDING` first. Only exact pointer/snapshot readback and the
observed ETag allow the DO to enter `POINTER_COMMITTED`. The Release signer
then independently reloads that exact pending attempt and authorizes only
`AUTHORIZE_JOURNAL_APPEND`. The signature is stored exactly; it is not a
commit. Journal compare-and-append of those exact record/delegation bytes is
the release commit point. After authenticated exact Journal readback and R2
reconciliation, a DO transaction records `COMMITTED`.

The DO must not call R2, Journal, or HSM inside `storage.transaction()`,
`blockConcurrencyWhile()`, or another lock held across I/O. Persist intent,
perform one external operation, read back/reconcile, then make a new local
transaction. `blockConcurrencyWhile()` is appropriate only for bounded
initialization/migration work, not the orchestration.

### Freshness

```text
LEASE_ACQUIRED -> SIGNING -> LEASE_VALIDATED -> RELEASED
                                      \-> IN_DOUBT (if finalization is unknown)
LEASE_ACQUIRED/SIGNING -> ABORTED_SAFE (only with proof signing cannot return)
```

1. The DO transaction checks `COMMITTED`, absence of writer/recovery gates,
   exact RPC idempotency state, and allocates an issue row with current
   generation and fencing token.
2. The Freshness signer independently verifies the authenticated Journal
   head, exact committed record/delegation, DO head, R2 pointer/snapshot, full
   Manifest, request audience/nonce, and its own delegation. Caller-provided
   epoch, digest, ETag, pointer, Journal head, or P1 “verified” object is never
   treated as authority.
3. It samples `issued_at` after those checks while the issue row blocks
   Release. It signs only the exact P1 Freshness response for that challenge
   and current state.
4. A final DO transaction checks the same operation ID, request digest,
   lease ID, generation, and fence; stores the exact response/result; marks
   the operation terminal; and releases the Release blocker atomically.
   Release may proceed only after all such rows are terminal.
5. The signer/gateway returns only the bytes durably finalized above. A
   network failure after finalization is retried using the same operation ID
   and returns the same bytes; it does not sign again. The APP's existing
   nonce and 10-second end-to-end deadline remain authoritative for acceptance.

If Release sets `writer_pending` after a Freshness grant, that already-granted
issue may finish against the still-current generation; Release waits. If
Release wins first, a new issue is denied. These outcomes are serialized by
the DO transaction, not by comparing clocks.

### RPC operation semantics

| Operation | Role | Permitted state effect |
|---|---|---|
| `beginRelease` / pointer observation / Journal commit observation | Runtime Config Authority | Exact-attempt coordination changes only. It cannot sign. |
| `readPendingReleaseForAuthorization` | Release signer | Read one exact pending attempt and trusted prior-head binding. No mutation or arbitrary signing. |
| `authorizeJournalAppend` | Release signer | Return authorization only for the exact pending attempt after independent verification. Never append Journal or mark DO committed. |
| `acquireIssue` / `beginSigning` / `finalizeIssue` / `abortIssue` | Freshness signer | Acquire/complete one exact challenge-bound issue operation; never mutate Release current state. |
| `getCurrentCommitted` / `getPending` | Authorized internal roles | Return a typed DTO. It is an input to independent verification, not proof by itself. |
| Recovery operations | Restricted Authority/recovery role | Reconcile exact attempt/Journal/R2 evidence or quarantine. Cannot clear an in-doubt issue without signer quiescence proof. |

These are proposed method families, not implemented RPC names or bindings.
The signer interfaces remain purpose-specific; no generic `sign(bytes)` method
is introduced.

## Crash, restart, duplicate, and timeout matrix

For all rows, an exact retry must use the same operation ID and canonical
request digest. A changed body under the same ID rejects. “Read back” means
authenticate and verify exact bytes and expected chain position; a matching
digest alone is not sufficient. No recovery path treats a signer signature
alone as a commit.

### Release

| Failure point | Durable state | Retry/readback rule | Gate and deadline effect |
|---|---|---|---|
| Before `beginRelease` | No pending attempt; immutable candidate objects may be orphaned. | Validate current Journal/DO/R2 head again. A new attempt ID is required if the old attempt was never durably admitted. | Freshness may proceed only from the stable current `COMMITTED` head. No pointer/Journal mutation occurred. |
| `beginRelease` transaction result ambiguous | Either no row or exact pending row; a successful DO transaction is atomic. | Query DO by the same attempt ID. If present, exact retry resumes that attempt; if absent and no rollback occurred, retry exact input. | If present, writer gate is durable and new issue grants stop. |
| `WAITING_FOR_ISSUES` saved | `writer_pending=true`; prior issue rows remain unsettled. | Exact same attempt resumes only when all earlier issues become terminal. Do not clear rows by timeout/alarm. | Existing Freshness requests may finish; no new issue, pointer CAS, or Journal append. APP's deadline is unchanged. |
| `PREPARED` saved | Candidate, previous head, and attempt ID are durable; pointer-write-started is false. | Verify candidate snapshot and prior Journal/DO state. Exact retry may proceed to persist write intent. | Freshness blocked by pending release. Before pointer intent, safe abort is possible only if no pointer write was admitted. |
| Release signer authorization call in progress | `POINTER_COMMITTED`; writer gate and exact attempt remain durable. | Query signer operation ledger by same operation ID. Exact retry only; do not assume timeout stopped HSM signing. | Freshness remains blocked. No Journal append until exact authorization bytes are stored. |
| Authorization returned, DO save not completed | HSM signature may exist only as an orphan. | Read signer’s idempotent result by exact operation ID or reauthorize the same attempt after revalidating all facts. Persist one exact result; never treat it as commit. | Release stays pending; Freshness blocked. No APP acceptance. |
| Pointer write intent saved, R2 CAS not yet issued | `POINTER_WRITE_PENDING`; CAS outcome is conservatively uncertain after restart. | Read pointer and snapshot. Do not infer “not sent” from DO state alone after the intent was committed. | Release remains writer; Freshness blocked. |
| R2 CAS in progress or result timeout | Durable write intent; external result may be unknown. | Exact pointer/snapshot/ETag readback is required. If the result cannot be established, remain blocked. Retry only if the selected R2 adapter proves its exact conditional write is safely idempotent; no such Production adapter is selected. | No Journal append and no Freshness while pointer outcome is ambiguous. |
| R2 CAS succeeded, DO update not saved | Pointer may contain candidate; DO still has pre-commit coordination state. | Read exact candidate bytes, immutable snapshot bytes, expected ETag, and prior/current state. Promote only after all agree. | Release remains pending; Freshness blocked. |
| `POINTER_COMMITTED` saved | Exact R2 pointer/snapshot and observed ETag are recorded; no Journal commit yet. | Continue only with same attempt and same verified prior Journal head. | Freshness blocked. A pointer is not a commit. |
| Journal append not yet called | Exact authorization is durably stored; Journal remains at prior head. | Re-read authenticated head. Append only exact stored bytes against exact expected prior head. | No Freshness. |
| Journal append in progress/ambiguous | DO has `JOURNAL_APPEND_PENDING`; Journal may or may not have committed. | Read linearizable Journal head. Exact record/delegation at expected next position means success. Exact prior head permits only exact-byte compare-and-append if provider guarantees it. Any other head/unavailable provider blocks. | No Freshness until reconciliation. Do not create a new generation or authorization. |
| Journal append succeeded, DO `COMMITTED` update failed | Journal is authoritative; DO still pending. | Verify exact record bytes, digest, delegation, generation, predecessor, authenticated append time, R2 pointer and immutable snapshot; only then reconstruct the same DO committed row. | Freshness remains blocked until repair commits. This is the required Journal recovery case. |
| DO `COMMITTED` saved | Coordination head should match Journal/R2. | Every reader still compares DO with live Journal/R2; DO status alone is not proof. Exact retry returns saved result. | Freshness may proceed after independent equality checks. |
| DO isolate hibernates/restarts at any point | SQLite state persists; in-memory fields are lost. | Reconstruct from durable state. Resume the same operation only after external readback. | Never infer a lease ended or a pending release vanished from restart. |
| DO PITR restores an earlier state | Any operation, pointer-intent, or fence record may be missing/rolled back. | Keep service quarantined; reconcile Journal/R2 plus out-of-band restore epoch and replay checkpoint. If missing state cannot be proved, remain blocked. | No Freshness/Release until controlled restore procedure completes. APP deadline is unrelated and unchanged. |

### Freshness

| Failure point | Durable state | Retry/readback rule | Gate and 10-second APP deadline effect |
|---|---|---|---|
| Before lease acquisition | No issue row unless the acquisition transaction committed but its reply was lost. | Query by exact operation ID. If absent, exact retry may acquire; if present, continue that same operation. | Release may proceed if no row exists. APP's original deadline continues; no new 10-second window is granted by retry. |
| Lease acquisition committed, reply lost | `LEASE_ACQUIRED`, request digest, generation, lease ID, and fence are durable. | Exact retry returns the same lease/result; never allocate a second lease for the same operation ID. | Release sets writer pending and waits. Freshness signer resumes or safely aborts. |
| DO/Journal/R2 reads in progress | Issue row remains unsettled; external reads are not inside a DO transaction. | Re-read and independently verify all sources. A read timeout is not evidence that signing stopped if a signing request may already have started. | New Freshness blocked once Release begins; Release waits for terminal issue. If APP deadline elapses, APP rejects without extending it. |
| Immutable snapshot/Manifest verification in progress | Issue row remains unsettled; no signer response exists yet. | Exact operation retry may resume verification. If the signer proves no signing was started, an explicit safe abort can release the blocker. | Release waits until abort is durable; no pointer CAS/append races the issue. |
| Signer/HSM call in progress | `SIGNING`; remote work may outlive local timeout/disconnect. | Query the signer/HSM by idempotency ID if supported. Otherwise mark `IN_DOUBT`; do not launch a distinct signing operation or free the lease. | Release remains blocked indefinitely absent quiescence proof. APP may time out at its existing 10 seconds and fail closed. |
| Signature acquired, finalization not attempted | Signature is orphaned until exact finalization succeeds; it is not returned. | Validate exact lease/fence/request and persist exact response through `finalizeIssue`. If the result is ambiguous, query the operation record and signer ledger; do not create a new operation. | Release still waits. APP cannot accept an unfinalized response. |
| Finalization transaction in progress | Transaction atomically either records exact result/terminal state or does not. | Query exact operation ID. If committed, return stored bytes; otherwise retry the same finalization. | If finalization wins before Release admission, Release sees terminal issue. If Release admission wins, it waits for this already-granted issue. |
| Finalization committed, response not returned | Exact response bytes/result and terminal tombstone are durable; issue blocker is cleared. | Exact retry returns those bytes and never re-signs. Different body under the same ID rejects. | Release may proceed. APP still checks the original nonce and original 10-second deadline. |
| Response returned but caller lost it | Same as finalized; terminal operation record persists. | Exact retry returns same exact bytes, subject to APP's original deadline. Do not issue a fresh response for that operation ID. | A response arriving after the APP deadline is rejected by the unchanged APP contract; no deadline extension. |
| Timeout/disconnect after signing began | `IN_DOUBT` unless cancellation/quiescence is proven. | An abort is accepted only with an auditable signer/HSM cancellation/fence result that closes every return path. Otherwise keep the blocker and escalate. | Release remains blocked. The request fails closed at the APP deadline; service availability may be lost. |
| DO isolate restarts | Durable issue row remains; memory is lost. | Re-load the issue row. Do not use restart as cancellation evidence. | Release waits for the same row to become terminal. |
| DO PITR rolls back issue/replay row | Old operation ID, lease, or fence may appear unused. | Quarantine; require out-of-band incarnation/key rotation plus an independent replay checkpoint. DO-only inspection cannot prove the record was never used. | No Production signer or Freshness response until anti-rollback recovery is verified. |

## Journal and external-system boundary

- The DO is the per-environment **coordination** authority for mutually
  exclusive pending Release and issue operations. It is not an independent
  anti-rollback witness.
- The Release Journal is the durable append-only **commit history**. Atomic
  compare-and-append of the exact authorized record is the Release commit
  point.
- DO `COMMITTED` is derived coordination state after a verified Journal
  append. It cannot supersede the Journal.
- On recovery after Journal append, the only permitted commit repair is
  reconstruction from the exact committed record, its delegation sidecar,
  authenticated append metadata, the exact R2 pointer, and the exact
  immutable snapshot.
- An HSM signature obtained but not appended is orphan authorization, never a
  commit and never APP input.
- A Journal head that is behind/ahead of the DO unexpectedly blocks
  Freshness. An unchanged prior Journal head may permit exact retry only under
  the selected provider's documented linearizable compare-and-append
  semantics.
- A DO and Journal restored to the same old state cannot be detected without
  an independently administered checkpoint. The Journal provider, its
  retention, append-time source, independent checkpoint, and restore
  ownership are unselected. Production Freshness must remain disabled until
  these are approved and tested.
- R2 pointer ETags and candidate-provided values are observations/expected CAS
  inputs, not latest-state authority. The signer independently reads and
  verifies the R2 pointer, snapshot, and exact bytes.

## P1 signer-interface trust boundary

The P1 signer interfaces are appropriately purpose-specific but their
TypeScript interfaces are structurally constructible. `VerifiedDelegation`,
`VerifiedJournalHeadBinding`, and `VerifiedCurrentFreshnessState` are not
cryptographic evidence merely because their names begin with “Verified”.
Structured-clone RPC also cannot turn a TypeScript brand into a trust proof.

P2/P5 signer requirements:

- Treat every RPC DTO and P1 request object as untrusted input.
- Re-parse and verify exact raw delegation/record bytes, signature domain,
  key ID, environment, audience, purpose, validity, digest, and binding at the
  signer boundary.
- Release signer independently loads the pending attempt from the DO,
  re-reads the exact prior Journal head and R2 facts, verifies that the
  `AUTHORIZE_JOURNAL_APPEND` request matches that one attempt, and has no API
  for arbitrary bytes.
- Freshness signer independently loads the granted challenge/lease, reads the
  Journal/DO/R2/snapshot/Manifest, verifies every binding, and signs only
  `LATEST_AT_ISSUANCE` for that challenge.
- DO enforces state transition, role, environment, operation/request digest,
  and fence. It does not prove the Journal, R2 object, Manifest, delegation,
  or signature contents correct.
- Journal verifies and linearizes append; R2 adapters verify conditional
  writes/readback; immutable snapshot/Manifest verifiers prove exact bytes and
  signature; the HSM signs only the signer-validated purpose-specific
  payload.
- A nominal TypeScript brand/private constructor can reduce accidental local
  misuse after runtime validation. It is defense in depth only and must be
  reconstructed after each RPC boundary. It cannot replace independent
  runtime verification.

## Unresolved blockers

1. **Eight-second contract:** Cloudflare's deployed timers and the absence of
   a DO/signer clock bound do not prove an exact 8-second lease. No
   auto-expiry is safe. The normative contract needs either approved clock and
   cancellation evidence or a formally approved internal semantic revision.
2. **Signer cancellation/quiescence:** No HSM/provider contract proves that a
   timed-out signing operation cannot later produce or deliver a signature.
   Until then `IN_DOUBT` blocks Release; there is no safe automatic recovery.
3. **PITR anti-rollback:** DO-only operation IDs, replay cache, tombstones, and
   counters can roll back. No independent operation checkpoint or mandatory
   controlled-restore/epoch rotation mechanism is registered.
4. **Journal provider:** No provider is selected for authenticated linearizable
   `getHead`, atomic compare-and-append, exact record retention, trusted
   append-time metadata, restore protection, or independent checkpoint.
5. **HMAC key custody/rotation:** No Runtime Config role/environment secrets,
   key IDs, rotation operator, or rollback-independent restore epoch is
   registered. The cryptographic runtime's constant-time HMAC verification
   contract must be confirmed.
6. **Storage/retention:** Exact RPC retry requires durable operation results
   and tombstones. Maximum result size, retention, storage growth, and
   anti-rollback compaction policy are not selected.
7. **R2 Production semantics:** The inspected S3-compatible Node helper is not
   a Worker R2 authority adapter. A production pointer CAS/readback contract
   and ambiguity policy remain to be implemented and integration-tested.

These are design blockers, not evidence that Cloudflare lacks the
capabilities; no unverified capability is assumed.

## P2 implementation roadmap

No item below is implemented by this design. Do not bind the new class to
`TLSN_BINDINGS`.

| Order | Proposed files/component | Implementation and required tests |
|---|---|---|
| 0. Resolve semantics and external gates | Update the normative protocol/authority design only after explicit approval; select Journal and restore/replay control. | Decide whether eight seconds is a hard authorization cutoff or an operational target. Approve signer cancellation/quiescence and controlled PITR procedure. No Production activation while unresolved. |
| 1. Coordinator state/SQLite | New package `packages/FUSOU-TLSN-RUNTIME-CONFIG-AUTHORITY/src/coordinator-durable-object.ts`, `src/state-model.ts`, and a separate Wrangler config/migration. | Schema constraints; safe decimal/uint64 parse; state initialization; no missing-state genesis; restart/hydration; transaction-local CAS; prove no HSM/R2/Journal call occurs inside transactions. |
| 2. Authenticated RPC DTOs | `src/rpc-auth.ts`, `src/rpc-contract.ts`, and role-specific RPC methods in the coordinator package. | Golden HMAC bytes; exact canonical schema; unknown field; wrong MAC/domain/key ID/role/environment/operation; body-digest mismatch; malformed base64url; key overlap; no secret/MAC logging; test platform MAC verification contract. |
| 3. Replay/idempotency and fencing | `src/operation-ledger.ts` and SQLite operation/lease records. | Exact retry returns one result; same ID/different body rejects; duplicate lease ID rejects forever; stale fence rejects; crash at each local transaction; no clock- or alarm-driven lease deletion; overflow does not wrap. |
| 4. Release coordinator | `src/release-coordinator.ts`, `src/r2-client.ts`, `src/journal-client.ts` interfaces only until providers are approved. | Concurrent issue-vs-release races; writer gate; pointer intent/CAS/readback ambiguity; exact stored authorization; Journal prior/exact/conflicting head; recovery only from exact Journal record + R2; no Journal append before stored authorization. |
| 5. Freshness coordinator | `src/freshness-coordinator.ts`; typed Freshness-signer RPC client. | Two concurrent issue leases; Release waits for every issue; exact challenge/nonce/digest; `issued_at` sampled while gate held; finalization atomically stores exact bytes/releases lease; signer timeout leaves `IN_DOUBT`; APP 10-second deadline remains unchanged. |
| 6. Restore/recovery controls | `src/restore-quarantine.ts` plus external checkpoint/rotation integration selected by trust owner. | PITR rollback scenarios for pre/post Release and Freshness operations; stale old HMAC packet rejected after restore; lost operation tombstone detected; DO+Journal rollback blocker; re-enable impossible without verified restore epoch/checkpoint. |
| 7. Runtime tests and independent review | New `vitest.config.ts` and `test/coordinator-durable-object.test.ts` using Cloudflare's Workers Vitest/DO integration, plus package scripts. | Real SQLite DO concurrency, restart/migration, alarm duplicate/retry behavior, crash injection at every matrix row, provider ambiguity, retention growth, role isolation, and no external call in a storage transaction. Keep Node in-memory adapter tests explicitly test-only. |

Before any deployed route, add the new DO namespace and per-environment
migration to a new Runtime Config Authority Worker configuration, not the
verification Worker. Verify generated binding types and deploy access control.
Do not register HMAC secrets, signer services, production routes, or credentials
as part of the local P2 implementation until trust-owner/provider approvals.

## Readiness and status

| Area | Status after this design |
|---|---|
| P2 DO coordination design | **OBSERVED / DESIGN ONLY** — candidate model and failure modes documented; no DO behavior is implemented or runtime-verified. |
| Eight-second hard expiry | **UNVERIFIED / BLOCKED** — no clock/cancellation proof; auto-release rejected. |
| RPC replay after PITR | **BLOCKED** — DO-only replay records can roll back; external checkpoint/controlled restore is not registered. |
| Runtime Config Production DO, Journal, R2 adapter, signer, route, secrets | **NOT_IMPLEMENTED**. |
| Release Journal provider and independent checkpoint | **NOT_CHECKED / BLOCKED** — provider and trust owner remain external dependencies. |
| P1 signer inputs as runtime trust proof | **UNVERIFIED** — interfaces are structurally constructible; Production signers do not exist. |
| Production Freshness acceptance | **BLOCKED**. |
| Stage A — protocol-only testplay | **BLOCKED**. |
| Stage B — identity-bound testplay | **BLOCKED**. |
| Stage C — Production evidence delivery | **BLOCKED**. |

This design does not change APP, browser, Game Server, Result signer, or
readiness boundaries. It does not claim Production acceptance or real
testplay evidence.

## Cloudflare references checked 2026-11-02

- https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- https://developers.cloudflare.com/durable-objects/api/alarms/
- https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/
- https://developers.cloudflare.com/workers/runtime-apis/performance/
- https://developers.cloudflare.com/workers/runtime-apis/rpc/
- https://developers.cloudflare.com/workers/authorization/durable-objects/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
