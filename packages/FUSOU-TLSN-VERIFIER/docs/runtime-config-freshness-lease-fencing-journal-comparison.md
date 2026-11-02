# TLSN Runtime Config Freshness — Lease, Fencing, and Journal Comparison

## Status

**READ-ONLY INVESTIGATION / DESIGN COMPARISON.** This report records a
comparison of:

- **A:** the normative eight-second exclusive issue lease;
- **B:** a fencing token with durable response finalization; and
- **C:** immutable snapshots with a linearizable Release Journal.

It does not implement a DO, route, RPC, Journal, R2 adapter, signer, HSM,
secret, binding, migration, test, or configuration. It does not change the
wire contract or readiness. No test or Production resource operation was run.

The eight-second value is **UNRESOLVED as a human decision**. It is not
assumed that it must be retained, removed, or changed. The current normative
protocol describes a lease with a maximum eight-second lifetime and a
post-sign validation; the P2 DO design's description of eight seconds as an
“operational target/SLO” conflicts with that protocol and is not an approved
reinterpretation.

## 1. Baseline and inspected sources

### Git baseline

- Repository root: `/home/ogu-h/Documents/GitHub/FUSOU`
- Branch: `tlsn-first-testplay-candidate`
- HEAD: `f1a2ac3fe97b1cfe11b47a07f9fe0d75a36fb257`
- HEAD subject: `docs: record P2 freshness prerequisites`
- Parent: `4fd995e1774750f9d93633382bbbd10a63368416`
- The local `origin/tlsn-first-testplay-candidate` ref matched HEAD; the
  local left/right commit count was `0 / 0`. No fetch was performed, so this
  is not a claim about the current GitHub remote.
- The relevant, non-excluded worktree and index paths were clean. User-
  designated excluded paths were omitted from status, diff, and this report.
- Recent relevant commits include `f1a2ac3fe` (P2 prerequisite decision),
  `4fd995e17` (P2 DO coordination design), and `839c4413f` (P1 domain
  contracts).

The earlier status report recorded the local branch as ahead by one commit.
The current local tracking ref now matches HEAD; the reason for that change
was not investigated.

### Source inventory

| Source | Current evidence |
|---|---|
| [Freshness protocol](./runtime-config-freshness-protocol.md) | Normative `LATEST_AT_ISSUANCE`; Release Journal append is the Release commit point; DO `COMMITTED` is post-commit state; `issued_at` is sampled during an at-most-eight-second issue lease; the same lease is rechecked after signing; an expired signature is discarded. |
| [DO coordination design](./runtime-config-freshness-do-coordination-design.md) | Candidate `writer_pending`, operation/fence records, exact-response finalization, and PITR blockers. It calls eight seconds an operational target/SLO, which conflicts with the normative lease description and is not approved. |
| [Production Authority design](./runtime-config-freshness-production-authority-design.md) | Proposed DO/Journal/R2/Signer boundaries and recovery. No Production provider or runtime implementation is established by this document. |
| [P2 prerequisite decision](./runtime-config-freshness-p2-prerequisite-decision.md) | Prior investigation of cancellation, PITR, Journal, HMAC, and trust-boundary blockers. Re-read as a source document, not accepted as proof. |
| [Readiness record](../FIRST-TESTPLAY-READINESS.md) | Test-only Freshness/Release evidence is distinguished from Production acceptance; Production Freshness and Stage A/B/C remain blocked in the checked-in record. |
| [P1 signer interfaces](../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/signers.ts) | `FreshnessResponseSignerRequest` has no issue operation ID, lease ID, fencing token, or finalize receipt. The verified state fields are structurally constructible TypeScript values. |
| [P1 domain types](../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/domain.ts) | The APP wire request has a nonce but no explicit signer-operation ID or public fence. The Freshness response encodes `LATEST_AT_ISSUANCE`, timestamps, release generation, record digest, and manifest digest/ref. |
| [APP Freshness verifier](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_freshness.rs) | One monotonic ten-second deadline begins immediately before POST and is carried through response, Manifest, five artifacts, verification, and the final pre-rename guard. |
| [APP state writer](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_runtime.rs) | Writes/fsyncs a temporary file, invokes the final guard, synchronously renames, then syncs the parent directory. Rename is the acceptance/persistence linearization point; there is no post-rename deadline check. |
| [Freshness constants](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-freshness.mjs) | `maxIssueLeaseMs` is 8,000 and response lifetime is 30,000 ms in the test-oriented domain implementation. |
| [Freshness test adapter](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-freshness-test-adapters.mjs) | In-memory lease pruning, writer gate, fake Journal/R2, and a test-only signer flow. It has no Production DO/HSM or external operation ledger. |
| [Freshness tests](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-freshness-test.mjs) | Tests cover in-memory release recovery, R2 ambiguity, issue/release races, multiple leases, and a simulated signing delay beyond eight seconds. Tests were inspected but not run here. |
| [R2 store helper](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-r2-store.mjs) | Node/S3-compatible helper; ambiguous pointer writes are read back and remain outcome-unknown if unresolved. It is not a Production Journal. |
| Worker [entrypoint](../../FUSOU-TLSN-VERIFICATION-WORKER/src/index.ts) and [Wrangler configuration](../../FUSOU-TLSN-VERIFICATION-WORKER/wrangler.toml) | No checked-in Runtime Config Freshness route or Runtime Config authority DO binding. Existing `TLSN_BINDINGS` is for verification/session binding. |

## 2. Current contract and implementation boundary

### Current normative behavior

1. `LATEST_AT_ISSUANCE` means that the Release committed at the response's
   issuance point is the latest canonical Release. The protocol identifies
   the Freshness currentness point as the signer sampling `issued_at` after
   verifying the Journal head, matching DO state, R2 pointer/snapshot, and
   Manifest while the issue lease is active.
2. The Release linearization point is the Journal's successful atomic
   compare-and-append of the exact authorized Release record. A Release HSM
   signature alone is not a commit. DO `COMMITTED` is post-Journal
   coordination state.
3. The Freshness lease blocks Release pointer mutation/Journal append across
   the protected issue/sign interval. After signing, the signer revalidates
   the same lease and discards the signature on failure.
4. The response has a maximum 30-second validity interval. This is separate
   from the APP's ten-second monotonic end-to-end request/acceptance deadline.
5. A Release may commit after a valid response is issued and before APP
   acceptance. This is explicitly allowed by `LATEST_AT_ISSUANCE`; the
   protocol does not promise `LATEST_AT_ACCEPTANCE`.

### APP acceptance and high-water

The APP starts its Tokio monotonic deadline immediately before the Freshness
POST. It uses that same deadline for the response, immutable Manifest
snapshot, five artifact reads, verification, and final state guard. It does
not reset the timeout for individual fetches. A full eight-second server
lease therefore leaves at most approximately two seconds for the rest of the
APP path, and less after request transit/response delivery; no measured
latency evidence proves that the remainder is sufficient.

The APP verifies the Freshness signature, nonce, audience, Release record and
delegations, then fetches and hashes exact snapshot/artifact bytes. It
compares the result to the local high-water. A stored higher generation/
epoch rejects a lower one. Missing high-water can be established only through
the online proof and full verification; malformed state is not silently
reset to zero. If no newer value was previously persisted, an otherwise
valid N response issued before N+1 may still be accepted after N+1 commits.

The atomic writer checks the deadline and signed time immediately before
rename. The rename is the persistence/acceptance linearization point; parent
directory sync follows. A post-rename sync error is returned without exposing
the verified config, though the new bytes may already be at the canonical
path. A strict guarantee that the function returns before exactly ten
seconds—including the synchronous rename and post-rename filesystem sync—is
not separately established by a post-rename timer check.

### What is implemented

The eight-second lease, in-memory DO-like coordination, test Journal, fake
R2, and fake signer are test scaffolding. The delay test constructs a
test signature, advances an injected clock in an `afterSign` callback, then
checks the lease and rejects the response. It does not stop or query a remote
HSM operation. No Production Freshness route, Runtime Config DO, Journal
provider, HSM signer, or Worker RPC finalizer is present in the inspected
source.

## 3. Safety invariants for comparison

### S1 — Freshness meaning

For the current protocol, the proof is: **the signed Release record was the
latest canonical Release at the defined `issued_at` currentness point**.
The record is obtained from the Journal head, with its exact digest,
generation, append metadata, and content-addressed Manifest snapshot.
`LATEST_AT_ISSUANCE` does not mean latest when the APP later renames its local
state file or begins gameplay.

### S2 — Stale response after a newer Release

An N response issued after N+1 commits must not be generated. An N response
issued before N+1 commits may arrive after that commit and remain valid under
the current contract, subject to APP deadline, response time, nonce, and
local high-water. If APP has already persisted N+1, the high-water rejects N.
If the requirement is to reject every N response arriving after N+1, the
protocol must change to a latest-at-acceptance guarantee or provide a new
acceptance-time coordination step.

### S3 — HSM delay and timeout

Caller timeout, Worker context cancellation, HSM terminal cancellation,
HSM completion, delayed result delivery, DO finalization, and APP response
delivery are separate events. Cloudflare RPC documentation describes
asynchronous calls and lifecycle behavior but does not establish exactly-once
execution, durable acknowledgement, or terminal cancellation of an external
HSM job. Treat an absent RPC reply as an ambiguous outcome.

### S4 — Release/Freshness order

`beginRelease`/issue grant must serialize at one authority. If issue wins
first, Release must not update the pointer or append the Journal record until
the issue is finalized or logically revoked. If Release admission wins,
new issue grants are denied. Exact Release Journal append remains the Release
linearization point.

### S5 — Fault recovery and anti-rollback

Restart/retry must query the same operation ID and digest. R2 or Journal
ambiguity is not equivalent to failure. DO PITR can restore operation state,
fence counters, and tombstones; a DO-only ledger is not rollback-resistant.
A separate Journal may detect a DO head behind the Journal, but does not
detect every replay of an operation that never reached that Journal. DO and
Journal rollback to mutually consistent old states require an independent
checkpoint/witness to detect.

## 4. A — Existing eight-second exclusive lease

### State and expiry

The normative/test model is:

```text
lease acquired for current generation N (maximum 8 seconds)
  -> Journal/DO/R2/snapshot/Manifest validation
  -> issued_at sampled while lease is active
  -> Freshness response signed
  -> same lease and delegation revalidated
  -> exact response returned; lease released
```

There is no normative lease renewal operation. The eight seconds are a hard
maximum lifetime of the exclusion/authorization lease, not merely an SLO and
not the response lifetime. The exact trusted clock, cross-worker clock error,
and production expiry mechanism are unresolved. The protocol also does not
state that Release must commit by the eighth second.

When Release begins while a lease exists, the coordination design sets
`writer_pending`/`WAITING_FOR_LEASES`, denies new issue grants, and waits
before R2 CAS or Journal append. After expiry, the test adapter prunes the
lease on a later method call. There is no Production DO to establish how
expiry is evaluated.

### HSM delay, restart, and retry

Lease expiry does not stop HSM work. Safety requires that any result from a
signing call pass the post-sign lease check and that no direct, cached, or
callback path can return a signature around that check. The existing delay
test checks the fake signer's return path, not physical HSM cancellation or a
late response delivered after Worker restart.

The APP request has a random nonce, but the current internal contract does
not define a signer operation ID or exact same-body retry result. A repeated
challenge may acquire a new lease and create a new response. On a lost
response, caller-visible outcome may be unknown.

### Safety / Liveness / Availability

- **Safety:** conditional on a correct lease clock and mandatory
  post-sign validation. A late signature must be discarded; HSM cancellation
  is not implied by expiry.
- **Liveness:** a trusted hard expiry can bound ordinary Release waiting. If
  the DO is unavailable or cannot establish lease expiry, Release must block.
  A DO that retains a crashed operation without expiry/recovery can block
  indefinitely.
- **Availability:** clock error can cause early rejection (Freshness
  availability loss) or late expiry (safety failure). DO failure blocks
  both safe issue coordination and Release progression.

The lease is a useful normal-operation serialization guard, but eight seconds
alone does not provide either HSM quiescence or anti-rollback.

## 5. B — Fencing token plus finalization

### Candidate protocol

1. Derive a stable operation ID from the environment and challenge nonce, or
   allocate a unique ID and persist the nonce/body digest binding.
2. In one DO transaction, verify stable `COMMITTED` state and no writer gate,
   persist the exact challenge digest/current Release head, and allocate a
   unique fencing token.
3. The signer independently verifies the current Journal record and exact
   snapshot/Manifest. It submits a purpose-specific HSM operation bound to
   the same operation ID and payload digest.
4. The HSM result is not returned directly. The signer invokes
   `finalizeIssue(operation_id, digest, fence, release_head, exact_response)`.
5. In one DO transaction, the finalizer verifies that the exact operation is
   still active and bound to the same current Release, then stores the exact
   response bytes/digest and marks the operation terminal.
6. Only a successful durable finalization response may be returned to the
   Gateway/APP. A retry of the same ID/digest returns the exact stored bytes;
   the same ID with a different digest rejects.
7. Release sets `writer_pending` in the same coordination authority. If an
   issue grant won first, Release waits while that issue can finalize against
   N. If the Release gate won first, issue grant rejects. Journal append
   remains the Release commit point.

The token should be a non-wrapping `(external incarnation epoch, monotonic
sequence)` or equivalent. A DO-local counter alone is insufficient because
PITR restores old counters. If multiple issues can coexist, each needs a
distinct operation token. A Release barrier must prevent later issue grants;
an explicit revoke must invalidate old finalizers.

The token need not be added to the APP-signed payload merely to gate internal
delivery: it must, however, bind the internal operation and exact HSM result.
Adding a token to the payload does not make it current or anti-rollback
resistant. If APP is expected to validate the fence itself, a signed,
rollback-resistant current fence proof and likely a wire change are required.

### Finalization and races

- **Finalize before Release append:** the response is valid for N at its
  issue point. Release may append N+1 afterward; delayed APP receipt remains
  allowed by `LATEST_AT_ISSUANCE`.
- **Release append before finalize:** the old N finalizer must reject.
  A DO-only finalizer can enforce this in ordinary operation only if Release
  cannot bypass the DO gate.
- **Finalize acknowledgement lost:** query the same operation ID. Return
  exact persisted bytes if terminal; otherwise remain unknown. Do not silently
  create a different operation.
- **Worker crash after HSM signature:** the operation remains `SIGNING` or
  `IN_DOUBT`. Query a durable signer/HSM operation status or safely revoke
  its fence. Without either, Release can remain blocked indefinitely.
- **DO PITR after finalization:** the finalization row and fence may roll
  back. A DO “finalized” flag is not an independent trust root. A
  rollback-resistant operation ledger/incarnation epoch is required, and
  the finalizer must reject stale state after restore.

Logical fencing can make a late HSM signature an unusable orphan without
physically cancelling the HSM **only if** every response path requires the
finalizer. This is a signer/Gateway trust-boundary claim, not a Cloudflare
or HSM guarantee. A journal read performed before the DO finalize also has a
TOCTOU window unless the active DO gate still prevents Release append or the
finalization is ordered by the Journal itself.

### Safety / Liveness / Availability

- **Safety:** strong against delayed results only with universal output
  gating and a rollback-resistant fence. Fencing alone is not enforcement.
- **Liveness:** if timeout/crash leaves `IN_DOUBT` and no exact status or safe
  revocation exists, Release can stop indefinitely. A rollback-resistant
  logical revoke can restore progress without requiring physical HSM stop.
- **Availability:** DO, external epoch/checkpoint, and operation-result
  storage become required. Any unavailable trust source fails closed.

## 6. C — Snapshot plus linearizable Journal

### C-read: point-in-time head proof

A C-read signer first obtains a current Journal head, fetches and verifies
the exact immutable Manifest snapshot referenced by that record, then
obtains a final linearizable head read and requires it to match. The
`getHead` read must serialize with Release append and return an authenticated
head plus a trusted read timestamp/sequence suitable to bind the Freshness
`issued_at`. A stale replica, cache, or caller timestamp is not sufficient.

If Release appends N+1 after the final read, N remains a valid
`LATEST_AT_ISSUANCE` result **only if** the protocol defines the linearizable
head read/receipt time as the issuance point and the response binds that
receipt. If `issued_at` remains a later signer-clock sample, the read/sign
race remains. Current source has no Journal read receipt API or response
field for it.

The signer must use the immutable snapshot reference/digest in the Journal
record, not infer currentness from the mutable R2 pointer. During a Release,
R2 pointer CAS may precede Journal append; under the existing protocol that
candidate is not yet committed. C can serve old committed N during that
interval only if the Journal is the sole currentness authority and the
current protocol's DO/pointer agreement requirement is revised accordingly.

### C-1 — N read, N+1 commit, then N signed

```text
t0: linearizable head read says N
t1: Release Journal append commits N+1
t2: signer creates signature naming N
```

If `t0` is the documented LP and the signed `issued_at` is the authenticated
receipt time at `t0`, the proof says “N was latest at t0”; N+1 at `t1` does
not invalidate it. If issuance is `t2` or `issued_at` is sampled at `t2`,
the N response is stale and must be rejected. This difference is the main
C-read semantic requirement.

### C-2 — APP accepts N after N+1 commit

The N response can be accepted after N+1 under current `LATEST_AT_ISSUANCE`
if N was latest at its signed LP and APP has not already persisted a higher
high-water. It is not proof that N is latest at APP rename/acceptance.
The ten-second APP deadline bounds the current request path; the 30-second
response TTL does not extend it. A requirement to reject all responses that
are stale at acceptance requires a different protocol/coordination boundary.

### C-log: append a Freshness issue record

If Journal cannot attest a linearizable read time, a stronger candidate is a
typed Freshness issue event in the same ordered log as Release records. It
binds `operation_id`, request digest/nonce, Release head, and trusted issue
time. The Freshness issue append is the issue LP; a later Release append is
ordered after it. Exact operation lookup supports retry and PITR-independent
tombstones.

This makes every Freshness request a Journal write, increases retention and
availability cost, and requires a log format that orders Release and issue
records without confusing Release generations. It is not present in the
current protocol/source. Either C-read with an authenticated read receipt or
C-log requires a selected Journal provider and rollback-resistant witness.

### Safety / Liveness / Availability

- **Safety:** C-read can prove currentness at its read LP only with
  linearizable read semantics, an authenticated receipt/time, immutable
  snapshot binding, and rollback protection. C-log makes the ordering
  explicit but needs a durable issue-operation contract.
- **Liveness:** signer delay does not hold a Release lock. A timeout may leave
  an unusable issue record, but need not block Release. Exact retries must
  recover or reject the same operation.
- **Availability:** Freshness depends on the Journal and immutable snapshot.
  C-log adds a Journal write to every issuance. Journal unavailability blocks
  Freshness; it also blocks Release append.

## 7. A/B/C comparison

| Axis | A — lease | B — fence/finalize | C — Journal snapshot |
|---|---|---|---|
| Safety basis | Valid lease clock + post-sign validation + no bypass | Exact operation-bound finalizer + enforced fence + anti-rollback epoch | C-read: linearizable read receipt; C-log: issue append ordered with Release |
| Freshness LP | Normative `issued_at` sample under lease | Durable finalization/issue operation, ordered before Release | C-read head receipt time; C-log issue record append |
| Release LP | Journal exact append | Journal exact append | Journal exact append |
| HSM delay | Expiry does not stop HSM; late result must fail post-check | Old fence cannot finalize; physical stop is optional only with universal gate | No Release lock; result is valid only for the defined read/issue LP |
| Eight-second hard expiry | Current normative limit; clock enforcement unresolved | Not inherently needed for Safety, but removing it requires protocol approval | No lock expiry needed for Safety if Journal LP is exact; current spec must be reconciled |
| Release stoppage | Can block on DO/clock/lease uncertainty | Can block indefinitely on `IN_DOUBT` unless safe revoke/status exists | Not blocked by signer, but Journal availability is required |
| Worker crash | No operation result ledger in current contract | Durable operation result/status or safe revoke required | Journal issue receipt/result supports recovery if implemented |
| DO PITR | Lease/tombstone rollback | Fence/finalize rollback unless external epoch/checkpoint | Reduced if Journal alone is authority; Journal rollback remains |
| Journal rollback | Not solved by DO | Not solved by DO finalization | Fatal to C without independent witness/checkpoint |
| APP verification | Existing wire; signer attestation trusted | Internal gate can preserve wire; public proof needs receipt | Receipt/sequence proof may require domain, APP Rust, and golden-vector changes |
| External base | Production DO, trusted expiry, HSM, Journal | DO, HSM operation IDs, external anti-rollback ledger/checkpoint | Linearizable Journal read/append, timestamp, immutable snapshots, witness |
| Implementation scope | Production lease DO/signer route and provider proof | New operation/fence/finalize interface, DO state, external rollback protection | Journal API/schema, exact receipt/issue records, Freshness/APP contract as needed |
| Ops complexity | Moderate in normal operation; subtle clock behavior | High recovery/retention burden | Highest Journal write, proof, and retention burden |
| Unresolved trust | DO/signer clock relation; HSM output path | Finalizer completeness; independent epoch; provider idempotency | Journal linearizability, read timestamp, rollback witness, retention |

## 8. Required external guarantees

Official Cloudflare documentation was checked on **2026-11-02**:

- [SQLite-backed Durable Object storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
  documents transactional/strongly consistent storage and PITR to a point
  within the prior 30 days. This supports local DO CAS, not cross-service
  atomicity or rollback resistance.
- [DO lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)
  documents hibernation/restart. In-flight RPC/storage behavior can return
  errors on shutdown; restart is not a signal that external HSM work stopped.
- [DO alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
  documents one alarm per object and at-least-once execution/retries. An alarm
  is not an exact eight-second clock.
- [Workers performance/timers](https://developers.cloudflare.com/workers/runtime-apis/performance/)
  documents that deployed timer APIs advance after I/O and that
  `performance.timeOrigin` is zero. No DO-to-signer clock-error bound was
  found.
- [Workers RPC](https://developers.cloudflare.com/workers/runtime-apis/rpc/)
  and [RPC lifecycle](https://developers.cloudflare.com/workers/runtime-apis/rpc/lifecycle/)
  describe asynchronous RPC and execution-context lifecycle. No general
  exactly-once, durable-acknowledgement, or external-HSM terminal-cancel
  guarantee was found. Application-level operation IDs and idempotency are
  required.
- [Service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
  do not propagate Access context to the downstream Worker; a binding is not
  a per-method role ACL.
- [R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/)
  and [S3 API extensions](https://developers.cloudflare.com/r2/api/s3/extensions/)
  document strong consistency and atomic conditional Put evaluation.
  A negative read does not prove an earlier unknown in-flight Put failed.
  This can support a single-object CAS, not a complete append-only Journal.
- [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/),
  [read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/),
  and [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
  document sequential transactional batches, session sequential consistency,
  potentially stale replicas, and rollback to a point in the prior 30 days.
  These pages do not establish an independent append-only Journal contract.

The following are distinct and must each be established for a selected
provider: linearizable `getHead`; atomic append; durable acknowledgement;
exactly-once execution; idempotent retry; rollback resistance; trusted
timestamp. No Journal/checkpoint provider is selected or verified.

## 9. Implementation scope if a mode is approved

- **Domain/signers:** B likely needs private operation ID, request digest,
  lease/fence, finalization result, and exact retry contracts in the signer
  interface. C may need a Journal read receipt or Freshness issue-record
  proof in the domain/wire model.
- **Worker:** a Runtime Config authority route and new DO namespace are
  required; the verification `TLSN_BINDINGS` DO is not the authority.
  Current Freshness files under `scripts/` are test adapters, not the
  production route.
- **DO state machine:** B needs durable operation states, fencing,
  writer-pending, exact response persistence, revoke/recovery, and
  anti-rollback integration. Transactions cannot span Journal/R2/HSM calls.
- **Journal adapter:** C needs authenticated linearizable head receipts or
  append-only Freshness issue records; both need exact operation lookup,
  timestamp authority, retention, recovery, and external checkpoint.
- **APP Rust:** an internal B finalization gate may keep the existing response
  wire. APP-visible fence/Journal proof, or a changed meaning/source for
  `issued_at`, may require changes in Rust verification and persistent
  high-water state.
- **Shared tests:** any wire change requires JS/Rust golden vectors. Both
  schemes require multi-Worker concurrency, DO restart/PITR, HSM delay,
  ambiguous Journal/R2 results, and APP acceptance tests.
- **Readiness:** update only after implementation and hosted/provider evidence.
  No readiness status is promoted by this investigation.

## 10. Fault-injection test plan

The following tests are proposed. “S”, “L”, and “A” mean Safety, Liveness,
and Availability respectively; they are not test results.

| Test | S | L | A | Required assertion |
|---|:---:|:---:|:---:|---|
| HSM response delayed beyond eight seconds | ✓ | ✓ | ✓ | A rejects expired result; B stale fence cannot finalize; C result is valid only under its exact receipt/issue LP. |
| HSM result arrives after Release N+1 append | ✓ |  | ✓ | No unfinalized N result is returned after N+1; a previously finalized N response is treated according to `LATEST_AT_ISSUANCE`. |
| Signer crashes after HSM signature, before finalize | ✓ | ✓ | ✓ | Recover exact same operation/result or remain `IN_DOUBT`; never assume timeout stopped HSM. |
| DO restarts between signature and finalize | ✓ | ✓ | ✓ | Query durable operation by same ID/digest; preserve or fail closed. |
| DO PITR restores stale issue/fence/tombstone state | ✓ | ✓ | ✓ | External epoch/checkpoint detects rollback; do not re-enable from DO state alone. |
| Journal append succeeds but acknowledgement is lost | ✓ | ✓ | ✓ | Exact current-head/record readback recovers same commit; no new generation. |
| Journal append remains outcome-unknown | ✓ | ✓ | ✓ | Do not infer failure from a negative/stale read; remain blocked or exact-retry per provider contract. |
| Same operation ID + same body digest | ✓ | ✓ |  | Return exact recorded result; do not repeat external side effect. |
| Same operation ID + different body digest | ✓ |  |  | Reject without mutating the old operation. |
| Concurrent multiple Freshness requests and Release | ✓ | ✓ | ✓ | Verify single order at DO or Journal LP and no uncoordinated path. |
| Stale fencing token at finalize | ✓ |  |  | Reject; do not return bytes through any Gateway path. |
| Manifest snapshot missing or digest mismatch | ✓ |  | ✓ | No Freshness response; no fallback to mutable pointer/current cache. |
| APP receives N after N+1 Release | ✓ | ✓ | ✓ | Verify exact current contract: high-water rejects N only if N+1 was already accepted locally; otherwise valid-at-issuance N may be accepted. |
| APP high-water lost or corrupt | ✓ | ✓ | ✓ | Missing requires full online proof; corrupt state never resets silently to zero. |
| Ambiguous R2 conditional pointer write | ✓ | ✓ | ✓ | Exact readback or same conditional request only; never confuse pointer success with Journal commit. |
| DO and Journal disagree; then both are restored | ✓ | ✓ | ✓ | Single-source mismatch blocks/reconciles; joint rollback is detected only with independent witness. |

## 11. Unresolved decisions and human approvals

1. Does the eight-second rule remain a hard maximum issue lease, or is a
   protocol amendment desired? Do not label it an SLO without approval.
2. Is the Freshness LP the current signer-sampled `issued_at`, a Journal
   read-receipt timestamp, or an append-only issue event?
3. Is the desired guarantee strictly `LATEST_AT_ISSUANCE`, or must APP reject
   a response that has become stale by local acceptance?
4. Is a universal signer/Gateway finalization gate an approved trust boundary,
   or is physical HSM/provider cancellation required?
5. Which external epoch/operation ledger/checkpoint protects against DO PITR,
   and who independently protects that checkpoint?
6. Which Journal provider meets linearizable read/append, trusted
   append/read time, exact retention, idempotency, restore, and administrator
   separation requirements?
7. Is a per-Freshness Journal write acceptable, including its latency,
   retention, cost, and outage impact?
8. What operation/result retention and tombstone-compaction policy is
   approved?
9. Who owns restore quarantine and service re-enable approval?

No trust-boundary decision is inferred here.

## 12. Readiness

| Area | Status |
|---|---|
| Normative eight-second semantics and clock enforcement | **UNRESOLVED** |
| Production DO / Freshness route / fence finalizer | **NOT_IMPLEMENTED** |
| Production HSM operation cancellation/status/idempotency | **NOT_CHECKED / UNRESOLVED** |
| Production Release Journal and trusted read/append timestamp | **NOT_IMPLEMENTED / BLOCKED** |
| PITR anti-rollback operation checkpoint | **BLOCKED** |
| Production Freshness acceptance | **BLOCKED** |
| Stage A / Stage B / Stage C | **BLOCKED** |

No tests, builds, typechecks, live R2 operations, HSM calls, deployments, or
testplays were run. This report does not promote readiness.

## 13. Conclusion

- **Is eight seconds inherently required for Safety?** No. Safety comes from
  correct ordering and rejection of stale finalization, not from the number
  eight. But the current normative protocol imposes an eight-second maximum
  lease, so implementation may not remove/reinterpret it without approval.
- **What replaces it if removed?** A fully enforced operation-bound
  finalizer and rollback-resistant fence/epoch (B), or a Journal operation
  that linearizes the Freshness issue with Release (C-log). A token or DO
  boolean alone is insufficient.
- **Can removing it permanently stop Release?** Yes. If a durable issue
  remains `IN_DOUBT` and neither exact signer status nor a safe
  rollback-resistant revoke exists, B must keep Release blocked. C avoids
  waiting on the signer but depends on the Journal being available.
- **Which best matches current `LATEST_AT_ISSUANCE`?** B is closest to the
  current lease-protected `issued_at` flow. C-read can match only if the
  Journal read receipt itself defines and binds the issuance point. C-log can
  provide a clear LP but adds a new Journal operation and retention model.
- **May Production implementation proceed?** No. The eight-second rule,
  issuance LP, anti-rollback root, Journal provider, and signer/HSM
  recovery contract need decisions and evidence first.

**Recommended candidate for further design, not an implementation approval:**
preserve the current `LATEST_AT_ISSUANCE` wire semantics with B's exact
response-finalization gate, but make the fence/operation ledger independent
of DO PITR and require every output route to pass that gate. Evaluate C-log
as the alternative if a suitable linearizable Journal can atomically order
Freshness issuance and Release. Neither candidate is currently
Production-ready.
