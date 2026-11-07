# TLSN Runtime Config Freshness — Lease, Fencing, and Journal Comparison

## Status

**READ-ONLY INVESTIGATION / DESIGN COMPARISON.** This report records a
comparison of:

- **A:** the normative eight-second exclusive issue lease;
- **B:** fencing/operation coordination, compared as issue-time B1 and
  pre-sign issue-commit B2 variants; and
- **C:** immutable snapshots with a linearizable Release Journal.

It does not implement a DO, route, RPC, Journal, R2 adapter, signer, HSM,
secret, binding, migration, test, or configuration. It does not change the
wire contract or readiness. No test or Production resource operation was run.

**Correction precedence:** Section 14 supplements and, where explicitly
stated, corrects the earlier comparison of B and C. In particular, it
separates Freshness linearization from output finalization, and distinguishes
C-read from C-log. Section 15 adds an independent review of Release-gate
coverage, PITR rollback detection, and delayed signer recovery. Sections 1–13
are retained as the original comparison; Sections 14 and 15 control where
earlier wording leaves either distinction ambiguous. No candidate is thereby
selected for Production.

**Current-source precedence:** Section 16 records the later local issuer-core
implementation and supersedes earlier P1 interface/current-source statements
in Sections 1–15. The maximum eight-second lease is fixed as an authorization
bound, not an SLO; its Production clock/provider enforcement remains
unselected. Production authority and acceptance remain blocked.

## 1. Baseline and inspected sources

### Initial comparison baseline

- Repository root: `/home/ogu-h/Documents/GitHub/FUSOU`
- Branch: `tlsn-first-testplay-candidate`
- HEAD: `f1a2ac3fe97b1cfe11b47a07f9fe0d75a36fb257`
- HEAD subject: `docs: record P2 freshness prerequisites`
- Parent: `4fd995e1774750f9d93633382bbbd10a63368416`
- This is the baseline for the initial A/B/C comparison only. No current
  local tracking-ref or GitHub remote state is asserted here.
- Recent relevant commits include `f1a2ac3fe` (P2 prerequisite decision),
  `4fd995e17` (P2 DO coordination design), and `839c4413f` (P1 domain
  contracts).

### LP supplement / correction baseline

- Date: `2026-11-02`
- Branch: `tlsn-first-testplay-candidate`
- HEAD read for this supplement: `18d871f5a7d40676aa1003857ed6c24d21a4095e`
- Parent: `f6c917100660423f13cd0b1c776a88d1372809b5`
- Section 14's source review was performed against this HEAD. No checkout,
  fetch, or GitHub remote query was performed for this supplement.
- At supplement start, the non-excluded index and worktree were clean. The
  protected paths were omitted from status and content inspection.

### P2 recovery review baseline

- Date: `2026-11-02`
- Branch: `tlsn-first-testplay-candidate`
- HEAD read for this review: `9f2541103ebcd5d38548d69804422c536657d8d9`
- HEAD subject: `docs: refine Freshness LP consistency`
- Parent: `18d871f5a7d40676aa1003857ed6c24d21a4095e`
- Section 15's source and official-document review is against this HEAD. No
  GitHub remote state is asserted.
- The protected `justfile` and APP roaming `configs.toml` were not read or
  diffed. The review's repository status check excluded both paths.

### Source inventory at the Section 14 baseline

| Source | Evidence at that baseline |
|---|---|
| [Freshness protocol](./runtime-config-freshness-protocol.md) | Normative `LATEST_AT_ISSUANCE`; Release Journal append is the Release commit point; DO `COMMITTED` is post-commit state; `issued_at` is sampled during an at-most-eight-second issue lease; the same lease is rechecked after signing; an expired signature is discarded. |
| [DO coordination design](./runtime-config-freshness-do-coordination-design.md) | Candidate `writer_pending`, operation/fence records, exact-response finalization, and PITR blockers. It calls eight seconds an operational target/SLO, which conflicts with the normative lease description and is not approved. |
| [Production Authority design](./runtime-config-freshness-production-authority-design.md) | Proposed DO/Journal/R2/Signer boundaries and recovery. No Production provider or runtime implementation is established by this document. |
| [P2 prerequisite decision](./runtime-config-freshness-p2-prerequisite-decision.md) | Prior investigation of cancellation, PITR, Journal, HMAC, and trust-boundary blockers. Re-read as a source document, not accepted as proof. |
| [Readiness record](../FIRST-TESTPLAY-READINESS.md) | Test-only Freshness/Release evidence is distinguished from Production acceptance; Production Freshness and Stage A/B/C remain blocked in the checked-in record. |
| [P1 signer interfaces](../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/signers.ts) | `FreshnessResponseSignerRequest` has no issue operation ID, lease ID, fencing token, or finalize receipt. The verified state fields are structurally constructible TypeScript values. |
| [P1 domain types](../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/domain.ts) | The APP wire request has a nonce but no explicit signer-operation ID or public fence. The Freshness response encodes `LATEST_AT_ISSUANCE`, timestamps, release generation, record digest, and manifest digest/ref. |
| [APP Freshness verifier](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_freshness.rs) | One monotonic ten-second deadline begins immediately before POST and is carried through response, Manifest, five artifacts, verification, and the final pre-rename guard. |
| [APP state writer](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_runtime.rs) | Writes/fsyncs a temporary high-water-state file, invokes the final guard, synchronously renames, then performs the platform-specific durability step. Rename changes the pathname; successful writer return is later. There is no post-rename deadline check. |
| [APP activation callers](../../FUSOU-APP/src-tauri/src/wrap_proxy.rs) and [startup caller](../../FUSOU-APP/src-tauri/src/lib.rs) | The startup refresh logs failure and does not install a runtime forwarder. The production proxy path installs the forwarder only after refresh returns a verified manifest and subsequent preflight, identity, health, and dependency checks succeed. |
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
   from the APP's ten-second monotonic verification/state-write deadline,
   which runs from before POST through the final pre-rename guard.
5. A Release may commit after a valid response is issued and before any of
   the APP's later local milestones. This is explicitly allowed by
   `LATEST_AT_ISSUANCE`; the protocol does not promise latest-at-rename,
   latest-at-durable-accept, or latest-at-exposure.

### APP validation, local state write, and exposure

The APP starts its Tokio monotonic deadline immediately before the Freshness
POST, after constructing the request and HTTP client. It uses that same
deadline for the POST and response body, immutable Manifest snapshot, five
sequential artifact reads, verification, state serialization/write, and the
final pre-rename guard. It does not reset the deadline for each fetch.

The server lease starts at server-side lease acquisition, not necessarily at
the APP's POST start. If `T_pre` is POST start to lease acquisition, `T_lease`
is lease acquisition through successful post-sign recheck/release, and
`T_post` is lease release through complete response receipt, the APP budget
remaining at response receipt is at most
`10 seconds - T_pre - T_lease - T_post`. With `T_lease` near its 8-second
maximum, the idealized remainder is near `2 seconds - T_pre - T_post`, not
always two seconds and not necessarily positive. Manifest/artifact retrieval,
verification and the state-write pre-rename work still need to fit afterward.
Section 14.11 distinguishes the protocol maximum from measured elapsed time
and identifies the unmeasured stages.

The APP verifies the Freshness signature, nonce, audience, Release record and
delegations, then fetches and hashes exact snapshot/artifact bytes. It
compares the result to the local high-water. A stored higher generation/
epoch rejects a lower one. Missing high-water can be established only through
the online proof and full verification; malformed state is not silently
reset to zero. If no newer value was previously persisted, an otherwise
valid N response issued before N+1 may still be accepted after N+1 commits.

The writer applies to the local Freshness high-water state bytes; it does not
write the verified Manifest as a runtime configuration file. After writing
and syncing a temporary file, it runs the final guard and performs
`APP_RENAME`. On Unix, successful parent-directory sync followed by writer
success is `APP_DURABLE_ACCEPT`. The verified Manifest is returned to the
caller only after that writer succeeds. The production proxy path reaches
`APP_EXPOSE` only after that return plus preflight, identity, health, and
dependency checks, when it successfully installs the Runtime Config-backed
forwarder.

If parent-directory sync fails after rename, the writer returns an error and
the refresh call does not return the new verified Manifest. The renamed
high-water bytes may nevertheless already be visible at the canonical path;
the failed sync does not roll the rename back, and a later state read may see
those bytes. In the traced production activation path the error prevents
forwarder installation, so this call does not expose the new Runtime Config.
On non-Unix platforms the source has no explicit parent-directory sync
(`sync_parent_directory` is a no-op; Windows uses a write-through rename).
Equivalence to the Unix parent-sync durability milestone is `UNRESOLVED`.

The final deadline guard is before rename. There is no post-rename deadline
check, so the ten-second deadline does not prove that rename, directory
sync, writer return, or later `APP_EXPOSE` completes by the ten-second mark.

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

### C-2 — APP_RENAME for N occurs after N+1 commit

The N response may reach `APP_RENAME` after N+1 under current
`LATEST_AT_ISSUANCE` if N was latest at its signed LP and the APP high-water
does not reject it. This does not imply `APP_DURABLE_ACCEPT` or
`APP_EXPOSE`; those require later independent steps to succeed. None of these
events proves N was latest at that APP-local event. The ten-second APP
deadline bounds the network/verification path through the final pre-rename
guard; the 30-second response TTL does not extend it. A requirement to reject
all responses that are stale at an APP-local milestone requires a different
protocol/coordination boundary.

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
  ambiguous Journal/R2 results, and APP local-state/activation tests.
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
| APP receives N after N+1 Release | ✓ | ✓ | ✓ | Verify exact current contract: a higher high-water value that is visible/loaded can reject N. Otherwise valid-at-issuance N may pass verification and reach `APP_RENAME`; `APP_DURABLE_ACCEPT` and `APP_EXPOSE` require their later steps to succeed. |
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
preserve the current `LATEST_AT_ISSUANCE` wire semantics with **B1's
issue-time LP** and an exact response-finalization gate, but make the
fence/operation ledger independent of DO PITR and require every output route
to pass that gate. This is only the least disruptive candidate, not an
implementation decision. Evaluate **C-log** as the alternative if an
approved, rollback-resistant Journal can atomically order Freshness issue
events and Release. Neither candidate is currently Production-ready.

## 14. Supplement and corrections: LP, finalization, and C variants

This section was added after re-reading the current protocol, P2 designs, P1
interfaces, APP implementation, Worker test adapter, tests, and shared
golden-vector fixture on the current HEAD. It records distinctions required
for future design; it does not revise the normative protocol or authorize a
Production implementation.

### 14.1 Current-source facts and limits

| Area | Confirmed source fact | Limit |
|---|---|---|
| Normative semantics | [The protocol](./runtime-config-freshness-protocol.md) specifies `LATEST_AT_ISSUANCE`. It samples `issued_at` after checking Journal/DO/R2/snapshot/Manifest while an at-most-8-second issue lease is active, then requires a post-sign check of that same lease and delegation. | It does not define a separate signed finalization receipt or a Freshness issue event in the Journal. |
| Release ordering | Exact successful Journal compare-and-append is the Release LP. R2 pointer CAS happens earlier in Release preparation and is not commit. DO `COMMITTED` is written after the Journal append and is coordination state, not a second Release LP. | A successful append with a lost ACK still has an LP; outcome recovery must read the exact Journal state. |
| Time limits | The APP starts one monotonic 10-second deadline immediately before the Freshness POST. The same deadline covers the response, Manifest, five sequential artifact reads, verification, state serialization/write, and the final pre-rename guard. | The maximum 8-second server lease has a different start point and is not an APP completion budget. The maximum 30-second response lifetime does not extend the APP deadline. No post-rename deadline check exists. |
| APP verification | [The APP verifier](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_freshness.rs) verifies the signed response, exact nonce/audience/environment, `LATEST_AT_ISSUANCE`, response/delegation times, Release Commit Record bindings, and `release_commit_record_appended_at <= issued_at`. It then verifies exact immutable Manifest and artifact bytes and the local state transition. | APP does not independently query the Journal or verify a Journal head-read/issue receipt; under the present contract the Freshness signer attests current Journal membership. |
| `APP_RENAME` | [The state writer](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_runtime.rs) atomically renames the synced temporary Freshness high-water state file over its canonical path after the final guard. | This is a namespace switch, not proof that the directory entry is durable, not Runtime Config exposure, and not a Freshness or Release LP. |
| `APP_DURABLE_ACCEPT` | On Unix, parent-directory sync succeeds and the state writer returns success; only then does Freshness `refresh()` return the verified Manifest. | A post-rename sync error returns failure although the new high-water bytes may remain visible. Non-Unix durability equivalence is `UNRESOLVED`. |
| `APP_EXPOSE` | [The production proxy activation path](../../FUSOU-APP/src-tauri/src/wrap_proxy.rs) installs the Runtime Config-backed forwarder after refresh, preflight, identity, health, and dependency checks succeed. | This is the first confirmed availability of the verified configuration to that forwarder, not an LP. Startup refresh and preflight-report generation alone do not install it. |
| P1 signer request | [The P1 signer interface](../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/signers.ts) defines `FreshnessResponseSignerRequest` with `operation: "ISSUE_LATEST_AT_ISSUANCE"`, `challenge`, `verifiedCurrentState`, and `freshnessDelegation`. `VerifiedCurrentFreshnessState` contains the Release head/record, append time, Manifest bytes/digest/ref, pointer ETag/generation, and epoch. | The request has no operation ID, issue-lease ID, fencing token, finalization receipt, or Journal-read receipt. Its TypeScript interfaces are structurally constructible, not runtime proof. |
| P1 wire | [The domain contract](../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/domain.ts) defines a response payload with `issued_at`, `expires_at`, Release head/Manifest bindings, and `LATEST_AT_ISSUANCE`; the request has a nonce. | The current payload/envelope has no field for an issue operation ID, read receipt, issue-event receipt, or DO finalization receipt. Unknown fields are rejected, so such proof cannot be added silently. |
| Worker path | The Worker [test adapter](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-freshness-test-adapters.mjs) acquires an in-memory lease, reads the fake Journal/DO/R2/snapshot, samples `issued_at`, creates the response signature, runs an optional `afterSign`, rechecks the lease/delegation, returns the response, and releases the lease in `finally`. | This is test-only and does not model Production DO persistence, HSM cancellation, remote result delivery, a finalization receipt, or a rollback-resistant operation ledger. |
| Existing tests/vectors | The test [suite](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-freshness-test.mjs) covers in-memory lease/release ordering and rejection of a test signing delay beyond eight seconds. The shared [golden vectors](../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/test/fixtures/freshness-v1-golden.json) cover the present wire request, response, delegations, Release record, and malformed cases. | They do not prove physical signer quiescence or exercise B1/B2/C-read/C-log receipts. No test is added or run by this document update. |
| Production status | The checked-in Worker runtime still has no Runtime Config Production route, authority DO, Journal provider, or Freshness signer service. [Readiness](../FIRST-TESTPLAY-READINESS.md) keeps Production acceptance and Stage A/B/C blocked. | Test-adapter success is not Production acceptance. |

At the Section 14 review, the P2 DO design's use of “operational target/SLO”
for eight seconds conflicted with the normative “at most 8-second issue
lease”; that supplement did not resolve the conflict. Section 16 now rejects
the SLO interpretation. Production clock/provider enforcement remains
unselected.

### 14.2 Linearization-point vocabulary

Use the following event names consistently. A point is meaningful only if
the operation is durably ordered against every competing Release operation
that can change the claimed current state.

| Event | Meaning | Is it a Freshness or Release LP? |
|---|---|---|
| `R_PREPARE` | Release candidate/artifact/snapshot validation and durable pending-attempt setup. | No. It is preparation. |
| `R_POINTER` | Successful conditional mutation of the mutable R2 pointer. | No under the current protocol. It precedes the Release commit. |
| `R_LP` | Successful atomic compare-and-append of the exact authorized Release record to the canonical Release Journal. | **Yes, Release LP.** If the append succeeded but its ACK was lost, the LP still occurred. |
| `R_DO_COMMITTED` | DO records the already appended exact Release and clears pending coordination state. | No. It is post-commit coordination state. |
| `F_READ` | A linearizable read returns a Journal head. | An observation in A/B1/B2/C-log. It is the candidate **C-read Freshness LP** only when its receipt/time and all currentness requirements are bound to the response. |
| `F_ISSUE_APPEND` | A typed Freshness issue event is atomically appended to a shared ordered Journal. | Candidate **C-log Freshness LP**. |
| `F_ISSUE_TIME` | The protocol-defined `issued_at` is sampled while the current Release state is protected by the valid issue gate, after all required checks. | **A and B1 Freshness LP** under the current lease-based semantics. It is not HSM signature time. |
| `F_DO_ISSUE_COMMIT` | A pre-sign issue-intent transaction freezes the operation and Release binding before HSM signing. | Candidate **B2 Freshness LP** only if a verified ordering protocol orders it against every `R_LP`; anti-rollback is a separate requirement. |
| `F_HSM` | HSM generates the signature bytes over a preimage. | No. It proves a key signed those bytes; it does not by itself prove the Journal was current or establish order. |
| `F_OUTPUT_FINALIZE` | A coordinator validates the exact operation/fence/result, persists exact signed response bytes or digest, and permits output. | A post-sign output/delivery gate, **not** the B2 LP. B2's candidate LP is the preceding `F_DO_ISSUE_COMMIT`. |
| `F_DURABLE_RESPONSE` | Exact signed bytes are stored for retry. | No. DO durability is not rollback resistance. |
| `F_DELIVERY` | HTTP response bytes are sent or observed by the APP. | No. Network delivery does not linearize currentness. |
| `APP_RENAME` | After the final guard and temporary-file sync, the atomic rename changes the canonical local high-water-state pathname. | Namespace visibility only; not directory durability, Runtime Config exposure, or a Freshness/Release LP. |
| `APP_DURABLE_ACCEPT` | On Unix, parent-directory sync succeeds and the state writer returns success; the verified Manifest can then be returned to its caller. | Local state durability for this writer path, not a Freshness or Release LP. Non-Unix durability equivalence is `UNRESOLVED`. |
| `APP_EXPOSE` | The production proxy path successfully installs the Runtime Config-backed forwarder after refresh and all downstream preflight/identity/health/dependency checks. | Makes the configuration available to that forwarder; not a Freshness or Release LP. First actual use can occur later. On non-Unix, successful writer return can precede exposure without an explicit parent-directory sync; the durability equivalence is `UNRESOLVED`. |

`APP_ACCEPT` is not a single event in this model. Use the specific milestone
(`APP_RENAME`, `APP_DURABLE_ACCEPT`, or `APP_EXPOSE`) whenever describing
local acceptance; none is a Freshness or Release LP.

On Unix, when all stages succeed, the local order is
`APP_RENAME < APP_DURABLE_ACCEPT < APP_EXPOSE`. The current non-Unix source
does not explicitly sync the parent directory (`sync_parent_directory` is a
no-op; Windows uses a write-through rename). It can return from the writer
and proceed to exposure, but equivalence to the defined
`APP_DURABLE_ACCEPT` milestone is not established.

The current Release ordering remains:

```text
R_PREPARE -> R_POINTER -> R_LP -> R_DO_COMMITTED
```

In particular, `R_POINTER < R_LP`. A Freshness operation that sees a changed
pointer while the Journal still says N must not infer that N+1 committed;
under the current contract, a pending Release or disagreement causes
Freshness to fail closed. Conversely, an N Freshness proof whose LP occurred
before `R_LP(N+1)` is not made false merely because `APP_RENAME`,
`APP_DURABLE_ACCEPT`, or `APP_EXPOSE` happens later. These APP-local events
remain distinct and can fail independently.

### 14.3 B1 — Issue-time LP, separate output finalization

#### Definition

B1 retains the current `LATEST_AT_ISSUANCE` meaning. Its Freshness LP is
`F_ISSUE_TIME`: the signer samples the response's exact `issued_at` **after**
verifying the current Journal record, matching DO `COMMITTED` state, R2
pointer and immutable snapshot/Manifest, while the same valid per-environment
issue gate prevents a Release pointer update/Journal append from interleaving.
The Journal-head read alone is not B1's LP; the HSM signing operation is not
its LP.

`issued_at` represents `F_ISSUE_TIME` only under the gate/clock assumption.
If the head is read at `t1`, Release changes are excluded, then `issued_at`
is sampled at `t2`, the unchanged head at `t2` is the fact being attested.
Without that exclusion, or an authenticated receipt that fixes the exact
head-read time, a signer-clock sample after a read is not proof that the same
head remained current until that sample.

The HSM signature signs a response whose payload includes the LP time and
head bindings. It authenticates the signer's statement about the state at
`F_ISSUE_TIME`; it does not make `F_HSM` the LP. A later
`F_OUTPUT_FINALIZE` checks whether this exact operation may be returned and
whether the required lease/fence remains valid. It may store the exact
response for retries. It does not move the already defined Freshness LP.

#### Release ordering around finalization

- **Release `R_LP` before `F_ISSUE_TIME`:** if the Release writer gate won
  first, B1 denies the issue grant. If a head was read before the Release
  but the issue gate did not protect the sample, the signer re-reads or
  rejects; it must not sign N as current at a time after N+1 committed.
- **Release after `F_ISSUE_TIME` but before the existing post-sign check or
  finalization:** with a correct active issue gate this ordering cannot
  happen: Release waits. If the eight-second lease expires, the DO rolls
  back, or a Release writer bypasses the gate, the current protocol requires
  the post-sign recheck to fail and the signature to be discarded. The
  candidate bytes are not returned. This is fail-closed availability loss;
  it does not retroactively move the LP to finalization.
- **Release after successful B1 finalization:** N was latest at
  `F_ISSUE_TIME`; N+1 can commit before the HTTP response arrives or before
  `APP_RENAME`, `APP_DURABLE_ACCEPT`, or `APP_EXPOSE`. That delayed N response
  remains semantically valid under `LATEST_AT_ISSUANCE`. APP rejects it if a
  higher high-water is observed; otherwise it may reach `APP_RENAME` within
  the pre-rename deadline and response-time rules. Durable acceptance and
  exposure still require their own successful steps.
- **B1 without a gate but with a durable issue receipt:** a rollback-resistant
  receipt that records `F_ISSUE_TIME` before `R_LP(N+1)` could permit exact
  N bytes to be finalized/delivered after N+1. That is not the current
  DO-only B1 candidate; it approaches C-log and requires an external,
  orderable operation record.

Thus, in the intended lease-based B1, an observed N+1 append before
`F_OUTPUT_FINALIZE` means either the issue lost its lease or a trust
assumption failed: reject and do not deliver. It is not enough to say “the
signature is valid.” If an independently verifiable issue receipt proves
`F_ISSUE_TIME(N) < R_LP(N+1)`, the earlier N claim can be delivered despite
the later Release, but this requires a different recovery proof than a
DO-only finalization row.

#### B1 contract impact

- **Wire:** can remain byte-for-byte unchanged only if APP continues to trust
  the Freshness signer to attest the protected issue-time facts, and the
  finalization proof stays internal. No APP-visible fence/receipt is then
  proven.
- **HSM preimage:** the existing Freshness response payload, including
  `issued_at`, nonce, audience, Release record and Manifest bindings.
- **Signer/DO:** add operation ID, request/body digest, lease/fence, strict
  state transitions, and exact response finalization/idempotent lookup to
  the internal interface. The Production signer must independently re-read
  and validate all security-relevant facts; TypeScript `Verified*` values
  are not proof.
- **Journal:** remains the Release authority and Release LP. No Freshness
  event is appended.
- **PITR:** a DO-only lease/finalization/tombstone may roll back. After a
  restore, the system must quarantine and compare an independent monotonic
  operation epoch/checkpoint or remain blocked. A signature and a restored
  `finalized=true` bit are insufficient.
- **HSM delay:** the current lease is rechecked after signing. The HSM need
  not be physically cancelled only if every response path is forced through
  the still-valid gate and a late result cannot bypass finalization. Under
  the normative rule, expired lease means discard, not late delivery.
- **Progress:** if the lease/gate remains unsettled and the old signer cannot
  be proven quiescent or safely fenced, Release may wait indefinitely. A
  timer by itself is not a safe unlock proof.

### 14.4 B2 — Pre-sign issue-commit LP (formerly called “Finalize-time LP”)

The earlier “Finalize-time LP” name is retained only as historical context.
The only coherent B2 interpretation in this document is a **pre-sign
issue-commit LP**. It finalizes an issue intent before HSM signing; it is not
the later finalization of signed response bytes.

#### Why post-sign output finalization cannot simply be renamed the LP

Suppose the signer has already built and HSM-signed a payload with
`issued_at=t2`, then at `t4` the DO stores the signature and labels the
operation finalized. If the Freshness LP is `t4`, the HSM signature does not
prove that N was current at `t4`; its signed `issued_at` is `t2`. A Release
could have committed N+1 between `t2` and `t4`. Calling the response
“finalized at t4” does not change its signed claim. Therefore, the current
post-sign `finalizeIssue(exact_response)` shape is an **output
finalization**, not a valid B2 LP. B2 can refer to a pre-sign intent
finalization only, and must name that event accordingly.

#### Minimal B2 pre-sign issue-commit candidate

To define B2's Freshness LP as an issue-intent finalization event before
signing, split the operation:

1. The signer validates the challenge and current N state, constructs a
   typed issue intent bound to operation ID, exact request digest/nonce,
   audience/environment, N Release record digest/generation, Manifest
   digest/ref, and Freshness delegation.
2. Before the final Freshness response signature, an atomic
   `commitFreshnessIssue` transaction verifies that N is still eligible, no
   Release writer won the gate, and the intent/fence match. It records an
   issue sequence and `issued_at`, and persists a receipt.
   **`F_DO_ISSUE_COMMIT` is the candidate B2 Freshness LP only if a separate
   cross-resource ordering rule and anti-rollback protection both hold.**
   A DO-local sequence or timestamp is not automatically trusted, and a
   monotonic checkpoint alone does not order this transaction against
   `R_LP`.
3. The Freshness signer verifies that receipt and HSM-signs the final
   response with `issued_at` and Release/Manifest bindings fixed by the
   receipt. The signed response must bind the receipt digest or its exact
   fields.
4. A separate `persistResponse`/`F_OUTPUT_FINALIZE` transition stores the
   exact signed response bytes/digest and permits output. This second
   transition is not the B2 LP. Exact retries return the same response only
   if the receipt and operation binding still verify.

The response's issue time is not known to the HSM before step 2. If the
design instead signs a pre-finalization response core, that core must omit
the final `issued_at`/LP proof and a subsequent authenticated receipt or
second signature must bind the core digest to the finalization event. This
is a new signature/wire protocol, not the existing one-signature payload
with a renamed timestamp.

#### Receipt and trust boundary

A B2 receipt must state at least:

- environment and protocol/scope;
- operation ID and exact challenge/request digest (including nonce and
  audience binding);
- Release generation/record digest and Manifest epoch/digest/ref;
- the finalized issue sequence/fence and trusted issue timestamp;
- exact Freshness delegation identity/digest and the response-core or
  exact unsigned response-payload/preimage digest it authorizes (not a
  digest of the eventual HSM signature bytes);
- the authority that issued the receipt and enough data to detect replay,
  conflicting finalization, and rollback.

The APP has no DO receipt verifier or receipt field in the current
Freshness contract. Options are: (a) the existing Freshness HSM key signs a
new response payload that includes and attests the receipt; (b) a Journal or
independent operation-ledger key signs the receipt and the APP verifies its
delegation/chain; or (c) a signed log/checkpoint proof is delivered with the
response. Option (a) adds no new public key by itself, but expands the
Freshness signer's trust assertion to include the DO gate decision, the
receipt's issue-time/sequence, and any anti-rollback result the signer claims.
The signature does not make those properties independent or prove them
without their underlying ordering/checkpoint evidence. Options (b)/(c)
introduce additional publicly verifiable trust material and APP verification
logic.

In all cases, the DO's local SQLite record is rollbackable through PITR.
Neither a DO response row nor a DO-generated counter proves non-rollback.
An independent monotonic checkpoint or restore-incarnation epoch can detect
DO rollback only if it is outside the DO restore domain and is checked before
any restored caller or signer resumes. It does **not**, by itself, prove
`F_DO_ISSUE_COMMIT < R_LP`. A same-key HSM signature over a receipt does not
independently prove either property; the signer must verify each required
anchor and ordering claim before signing.

#### Anti-rollback and cross-resource ordering are independent guarantees

| Guarantee | Candidate evidence | Does not prove | Current status |
|---|---|---|---|
| **A. Anti-rollback** | An independent monotonic checkpoint or restore-incarnation epoch records the DO operation/fence state and is consulted before any post-restore issue or Release operation. | It does not order `F_DO_ISSUE_COMMIT` relative to the Journal's `R_LP`, supply trusted time, or restore erased operation details. | `UNRESOLVED`: no checkpoint provider, independent recovery domain, or checkpoint rollback control is selected. |
| **B. Cross-resource ordering** | Either every Release writer and issue committer obey one DO gate (Release sets `writer_pending` before R2 mutation/Journal append; issue commit is denied while pending), or a common linearizable ordering authority orders both issue and Release events. The issue receipt binds the operation, expected Release generation/record digest, sequence, and time. | A monotonic epoch, an uncoordinated DO transaction, or trusted wall-clock timestamps alone do not prove the relation to `R_LP`. A gate is useful only if all Release, recovery, and administrative paths are forced through it. | `UNRESOLVED`: no production gate, universal-writer proof, common sequencer, or receipt verification exists. |

If the DO gate is the proposed ordering mechanism, its operation sequence
must prove that an issue commit won before any Release writer entered
`writer_pending`; a Release that entered first must prevent the issue commit.
The exact Release append remains later and outside the DO transaction. The
receipt/checkpoint must survive PITR, and every post-restore path must compare
it before resuming. If the required proof instead comes from ordering the
issue event and Release record in one Journal, B2 uses the same ordering
substrate as C-log, though B2 still has a separate pre-sign issue intent and
post-sign response finalization.

Receipt time/sequence, the relation to `R_LP`, receipt-authority rollback,
and recovery of ambiguous receipt ACKs are not established by the current
sources. Exact retry must use the same operation ID and request digest to
recover the same receipt; changed input must be rejected; an unresolved
outcome must quarantine rather than create a second LP. These remain
`UNRESOLVED`.

#### B2 release order, compatibility, and liveness

- If `R_LP(N+1)` wins before `F_DO_ISSUE_COMMIT`, B2 must not finalize an
  N response. It either rejects and starts a new operation over N+1 or
  returns failure.
- If `F_DO_ISSUE_COMMIT(N)` wins first under a verified shared gate or common
  sequencer, a later `R_LP(N+1)` does not invalidate the N issue-time fact.
  An anti-rollback checkpoint alone is insufficient to establish this order.
  The final N signature may be completed/delivered after N+1 only if the
  APP-verifiable receipt proves the order and the response remains within
  its validity and APP deadline.
- If Release admission and issue commit use the same DO writer gate and the
  issue operation is held until response persistence, the ordinary order is
  `F_DO_ISSUE_COMMIT -> F_HSM -> F_OUTPUT_FINALIZE -> R_LP`. A stuck HSM
  can block Release indefinitely. If the gate is released at B2 LP, Release
  may progress while HSM signing continues, but only a receipt that is
  checked against both independent anti-rollback evidence and the separately
  proven issue-vs-Release ordering can make the late response safe after a
  DO restore.
- HSM failure after `F_DO_ISSUE_COMMIT` leaves an issued intent without a
  deliverable signed response. Exact retry must reuse the same receipt and
  operation ID; if its 30-second response window has elapsed, APP rejects
  the result and a new issue operation is needed. A safe abort/revoke policy
  must not erase the historical LP or make its operation ID reusable.

| Question | B1 — issue-time LP | B2 — pre-sign issue-commit LP |
|---|---|---|
| LP | `issued_at` sampled under the valid current-state issue gate. | Pre-sign `F_DO_ISSUE_COMMIT`, only if cross-resource ordering is proved; anti-rollback anchoring is independently required. |
| `LATEST_AT_ISSUANCE` fit | Direct fit with current semantics when the lease truly protects the sample. | Possible only if the signed response binds the earlier issue-commit receipt and its `issued_at`; post-sign output finalization is not enough. |
| Current `issued_at` | Sampled before HSM signing, as current protocol and adapter do. | Must be supplied by the LP receipt and then signed; the existing interface has no receipt input. |
| HSM operation | Signs the current Freshness payload. | Signs after the LP receipt, or signs a pre-finalization core plus a separately authenticated receipt. |
| Output finalization | Separate permission/store point; not LP. | Still separate from the issue LP if exact signed bytes are stored after HSM. |
| APP/wire | No change only if Freshness signer remains the sole attestor and finalization stays internal. | To verify the receipt independently, new payload/envelope/domain fields and APP Rust validation are required. If signer alone attests, same root may remain but the signed claim/trust semantics change. |
| DO/Journal role | DO lease/fence enforces normal-operation exclusion; Journal remains Release commit authority. | DO gate can order operation admission only if every Release path obeys it. A checkpoint detects rollback; it does not prove issue/Release ordering. |
| PITR | DO gate/tombstone rollback is a blocker; external anti-rollback checkpoint/quarantine required. | Rollback may resurrect an old head/fence. Independent anti-rollback evidence and a separate cross-resource ordering proof are both required. |
| HSM delay | Expired/invalid lease means discard; a late signature must not bypass finalization. | LP may precede signing; late signature is usable only with receipt, valid time window, exact operation, and external anti-rollback verification. |
| Release progress | Can block until issue finalization or proven quiescence/revoke. | Can block if gate remains held until response persistence; can proceed sooner only with independently anchored LP and exact result recovery. |

**B2 conclusion:** A post-sign output-finalization LP is not established by
the current response signature plus a DO `finalized` flag. The viable B2
candidate is a pre-sign issue-commit LP bound into the HSM-signed response.
It still requires both an independent anti-rollback mechanism and a verified
ordering relation to `R_LP`; neither follows from a DO counter/checkpoint
alone. If that relation requires a shared ordered Journal, B2 uses C-log's
ordering substrate. These provider and trust guarantees remain `UNRESOLVED`.
Using the existing Freshness signer key for the final attestation avoids a
new public key only if the signer assumes and validates the DO/Journal
ordering and anti-rollback controls; that is still an expanded trust
assertion. B2 is not Production-ready.

### 14.5 C-read — linearizable Journal head read, no issue append

#### Candidate contract

C-read adds **no Freshness issue record** to the Journal. Its intended flow
is:

1. Validate the APP challenge; do not accept caller-supplied epoch, digest,
   head, pointer ETag, or Manifest reference as current state.
2. Perform a linearizable Journal head read returning Release head N.
3. Obtain an authenticated read receipt that binds environment, exact head
   generation/record digest, a monotonic Journal sequence or equivalent,
   read time, and the provider identity.
4. Fetch the exact immutable Manifest snapshot referenced by N and verify
   its exact bytes/digest and Manifest signature.
5. Verify the Release record/delegation and any required DO/R2 agreement.
   The current protocol checks a stable committed state and pointer/
   snapshot consistency; a head read alone does not prove those other reads
   were simultaneous.
6. Bind the read receipt/head/time into the Freshness response and sign it.
   The response `issued_at` must mean the receipt's read LP, not a later
   arbitrary signer-clock sample.
7. APP verifies the Freshness signature and receipt, exact Manifest/artifact
   bytes, nonce/audience, expiry/deadline, and local high-water.

`F_READ` is the C-read LP: the provider's atomic linearizable head-read
instant. Fetching the snapshot, HSM signature generation, response delivery,
and APP rename all occur later and are not the LP.

#### Receipt, time, and cross-resource consistency

A linearizable read has a serialization point, but “the API returned head N”
does not by itself give APP an independently verifiable time/sequence for
that point. The current response has `issued_at` and no read-receipt field.
To prove the read LP in the current response shape, the signer would have to
attest that its `issued_at` exactly represents the read LP; a later local
clock sample is insufficient if a Release can commit in between. A stronger
contract is a Journal-signed receipt with a monotonic sequence and trusted
timestamp, included in and bound by the response. The Journal/provider must
generate that receipt at the linearizable read, not the HTTP Gateway or
caller. Whether the receipt timestamp can equal the existing millisecond
`issued_at` without changing the protocol is **UNRESOLVED**.

The immutable Manifest is consistent with N only if its exact raw bytes
match the digest/ref in N. However, the present Release workflow updates the
mutable R2 pointer before `R_LP`. A Journal head read can therefore return N
while an N+1 pointer CAS is already in flight. To preserve the present
contract's Journal + DO + R2 agreement, C-read still needs one of:

- the existing DO issue gate held across the checks/read LP so Release
  cannot mutate the pointer/append between them;
- an atomic provider snapshot that jointly binds Journal head and the
  required pointer/DO state; or
- an approved protocol change making the immutable Journal head the sole
  currentness source and moving/removing the pointer/DO requirement.

No such cross-resource transaction/provider is present. C-read with a
linearizable Journal read **alone** is not sufficient under the current
multi-source contract.

If Release N+1 commits after `F_READ(N)` but before HSM signing, a response
for N can still be valid under `LATEST_AT_ISSUANCE` if its receipt proves
that exact read LP and all required point-in-time state. APP may let it pass
verification and reach `APP_RENAME` after N+1 only if a higher high-water
value is not visible/loaded and the 10-second deadline/30-second response
checks pass. `APP_DURABLE_ACCEPT` and `APP_EXPOSE` require their separate
later steps. If N+1 committed before
the read LP, the current head must be N+1; a stale N read is a provider
violation or must be rejected against a trustworthy monotonic receipt.

Because C-read creates no Journal issue event, Journal append cannot provide
exact retry state for the Freshness request. If exact retry/deduplication
is required across Worker crashes, an independent operation ledger must bind
the APP nonce/request digest to its result. The current P1 signer interface
has no operation ID; the current APP does not automatically retry the
Freshness POST.

### 14.6 C-log — Freshness issue event appended to a shared ordered Journal

#### Candidate event and protocol

C-log makes `F_ISSUE_APPEND` the Freshness LP by appending an immutable,
typed issue event to the same **linearizably ordered authority log** that
orders Release records. An example event binds:

- event schema/type and environment;
- unique issue operation ID and exact request/body digest, including nonce,
  audience and request scope;
- the latest committed Release generation and exact Release record digest;
- Manifest epoch/schema/digest/content-addressed ref;
- Freshness delegation key ID, delegation ID and exact delegation digest;
- previous **log-event** sequence/digest, distinct from previous Release
  generation/record digest;
- no caller-supplied “latest” value; all current fields are independently
  verified before append.

The Journal assigns authenticated `appended_at`, monotonic event sequence,
event digest, and previous-event linkage at the atomic append. These values
belong to the append receipt, not to an unsigned caller timestamp. The exact
successful append of the event is `F_ISSUE_APPEND`, the Freshness LP. The
Freshness HSM signature is generated after the LP and binds the exact event
digest/receipt and `issued_at=appended_at`. To avoid a signature/hash cycle,
the event can bind an authorized unsigned response intent or response-core
digest; it must not include the final signature whose preimage includes the
event digest.

APP can independently verify the receipt only if it has an authenticated
Journal receipt key/delegation or an independently verifiable log inclusion/
consistency proof and checkpoint. If the Freshness signer merely signs
“I read this Journal event,” APP trusts the Freshness signer rather than
independently verifying Journal issuance. The current APP trust/schema has
no Freshness issue-event proof or Journal receipt key, so independent receipt
verification needs domain/wire and Rust verifier changes.

#### Append concurrency, idempotency, and recovery

- **Issue event before Release append:** the total order is
  `F_ISSUE_APPEND(N) < R_LP(N+1)`. The N response remains valid at its
  issue LP even if HSM signing, delivery, `APP_RENAME`, `APP_DURABLE_ACCEPT`,
  or `APP_EXPOSE` happens after N+1.
- **Release append before issue event:** the issue append must serialize
  after N+1 and bind N+1 as the latest Release. If a request was prepared
  against N, an expected-head conflict rejects it; the signer re-reads N+1
  and starts/retries the exact operation under the approved retry contract.
  It must not append an issue event naming N after N+1.
- **R2 pointer CAS before Release append:** pointer mutation is still not
  `R_LP`, but a pending/inconsistent Release is rejected under the current
  contract. C-log requires the same Release writer gate across the
  pre-append pointer state, or an approved change to make Journal state
  sole authority.
- **Operation ID:** the Journal must support an exact operation lookup.
  Same ID/same request digest returns the exact existing issue event and
  receipt; same ID/different digest rejects. The operation tombstone/event
  must survive retention and PITR/restore. Do not retry under a new ID after
  an ambiguous append until the old operation is resolved.
- **ACK loss / Worker crash after append:** the LP exists if the append
  committed. Recover by linearizable `getByOperationId`/exact event lookup
  and verify bytes, event sequence, previous digest, receipt, and request
  digest. If unknown, use only provider-guaranteed exact idempotent retry;
  otherwise remain blocked. Never infer that a missing ACK means no LP.
- **Crash after append but before HSM signature:** the immutable issue event
  remains. A retry can sign the same receipt-bound response only if the
  operation and expiry policy permit it. If the response TTL/delegation or
  APP's 10-second deadline has elapsed, APP rejects; a new issue event is
  required for a new challenge. The old event remains a historical LP.
- **DO PITR:** an independent Journal event survives DO rollback only if the
  Journal is genuinely outside the DO restore domain. DO/Journal disagreement
  blocks until recovery. Joint rollback still requires an independent
  checkpoint/witness.

The current Release record/domain is organized around Release generations
and previous Release record digests. Interleaving issue events changes a
shared event-log head even though the latest Release generation does not
change. A production C-log design must define separate `event_sequence`
and `release_generation` projections and update Release compare-and-append/
authorization semantics so a Freshness event cannot silently invalidate or
bypass a pending Release authorization. A separate issue log would need an
atomic shared ordering service; two independent logs do not establish which
LP came first. This is a significant Journal/domain design change, not a
simple extra record type.

### 14.7 C-read versus C-log

| Axis | C-read | C-log |
|---|---|---|
| Freshness LP | Exact linearizable Journal head-read instant. | Exact successful append of a typed Freshness issue event. |
| Journal write per Freshness request | No. | Yes. |
| Receipt needed | Authenticated read receipt/time/sequence is needed to bind existing `issued_at` to the read LP; absent it, a later signer timestamp races the read. | Authenticated append receipt/time/sequence is needed; the append itself establishes ordering, while the receipt proves it to APP/recovery. |
| Snapshot binding | Release head must name immutable Manifest digest/ref; fetch/hash exact bytes. | Issue event binds exact Release record and Manifest digest/ref; fetch/hash exact bytes before or as part of append authorization. |
| Release N+1 after initial head N | N can be returned only if the exact read LP is receipt-bound and other required DO/R2 state was protected. Otherwise the N response can be stale at its signed time. | If issue event N appended first, N is valid even if N+1 appends/signature is delivered later. If Release N+1 append wins first, issue event must name N+1 or reject/retry. |
| Release mutable pointer race | Linearizable Journal read does not atomically bind R2 pointer/DO state; current contract still needs a gate or revised authority rule. | Same issue: event order alone does not make a pre-append R2 pointer mutation a Release commit; preserve the gate or revise currentness sources. |
| Exact retry after crash | Not represented in Journal; requires an independent operation ledger or a new challenge. | Journal event by operation ID can recover exact LP/result if the provider guarantees exact lookup/idempotency and retention. |
| APP verification | Current APP has no read-receipt field/key; wire/domain/Rust changes are needed for independently verifiable proof. | Current APP has no event/append-receipt fields/key; wire/domain/Rust changes are needed. |
| Release-log compatibility | Does not alter Release event format, but requires a receipt and correct cross-resource ordering. | Shared event stream changes Journal head semantics, Release CAS/authorization, chain projections, retention, and possibly signatures. |
| Safety blocker | Read receipt authenticity/time plus read/Release ordering and DO/R2 consistency. | Provider's ordered event append, receipt verification, exact idempotency, cross-log rollback, and Release-chain integration. |
| Progress | Signer delay need not hold a Release lock after a valid read LP, but APP may reject a response that misses its deadline/TTL. | Signer delay after append need not hold Release; a pending/ambiguous Journal append or unresolved operation can block recovery. |

#### B2 and C-log: shared ordering needs, different LPs

| Axis | B2 pre-sign issue commit | C-log |
|---|---|---|
| LP operation | DO issue-intent commit, only when its receipt is ordered against all Release LPs. | Successful Freshness event append to the same ordered Journal as Release events. |
| Shared requirement | Unique operation ID/digest, receipt authenticity, exact retry, APP-verifiable binding, rollback detection, and a cross-resource ordering rule. | The same receipt/retry/APP-verification and rollback properties, supplied by the common ordered event log. |
| Ordering mechanism | Could be a universal DO gate if every Release, recovery, and administrative writer obeys it; an anti-rollback checkpoint alone is not that gate. If that is insufficient, B2 needs a common sequencer/log. | Direct total order from the shared Journal append, if the provider actually guarantees it. |
| Anti-rollback | Independently anchor DO state/operation history; this does not prove issue-versus-Release order. | The Journal must itself resist/detect rollback or be compared to an independent checkpoint; shared ordering alone does not prove restore resistance. |
| Difference | LP is a pre-sign intent; HSM signing and `F_OUTPUT_FINALIZE` follow. Release Journal record format can remain separate only if the gate is authoritative. | The issue event itself is the LP and changes the shared event sequence; Release generation must remain a distinct projection. |
| Current status | `UNRESOLVED`: neither provider nor universal-gate proof is established. | `UNRESOLVED`: no provider or production shared-log contract is selected. |

### 14.8 Unified LP ordering matrix

In every row, `R_LP` means the exact Release Journal append, not Release
preparation, R2 pointer CAS, signer authorization, or DO `COMMITTED`.
`APP_RENAME`, `APP_DURABLE_ACCEPT`, and `APP_EXPOSE` are later APP-local
milestones and do not reorder either server-side LP. Their order is
`APP_RENAME < APP_DURABLE_ACCEPT < APP_EXPOSE` on the Unix path when
activation succeeds; non-Unix equivalence for `APP_DURABLE_ACCEPT` is
`UNRESOLVED`. Any `R_LP` may occur between these APP-local events.

| Method | Freshness LP | Release LP | Normal order | If N+1 Release LP occurs before the Freshness LP | If N+1 Release LP occurs after the Freshness LP |
|---|---|---|---|---|---|
| **A — lease** | `F_ISSUE_TIME`: `issued_at` sampled while the verified N state is protected by the active issue lease. | `R_LP`: exact Journal append. | Lease grant/check/sample/sign/post-sign check/release lease, then Release may mutate pointer and append: `F < R`. | Release gate wins and issue is denied; after N+1 commits, a new issue must verify N+1. | N response remains valid at issue time; it may arrive after N+1. A higher high-water value that is visible/loaded may reject it; otherwise it may reach `APP_RENAME`, with durability/exposure still pending. |
| **B1 — issue-time + output finalization** | Same `F_ISSUE_TIME` as A. `F_OUTPUT_FINALIZE` is a separate exact-response delivery gate, not the LP. | `R_LP`. | With a correct active operation/fence, Release waits for finalization/abort: `F < output-finalize < R`. | Release wins before issue grant; deny N. If release happens after `F` but before finalization because the gate expired/rolled back, baseline B1 rejects the response; a durable independent issue receipt would be needed to deliver it later. | Finalized N bytes remain valid for their earlier LP and may arrive after N+1. They may reach `APP_RENAME` if local high-water/deadline permit; durable acceptance and exposure are later steps. |
| **B2 — pre-sign issue commit** | `F_DO_ISSUE_COMMIT`: pre-sign issue-intent commit. It is an LP only if a verified gate/common sequencer orders it against every `R_LP`; anti-rollback must be proved separately. `F_OUTPUT_FINALIZE` is later output storage. | `R_LP`, the exact Release Journal append. | If the issue commit wins the shared ordering and its receipt proves the relation, `F < HSM < F_OUTPUT_FINALIZE`; Release can then append. | Release wins the shared ordering first; stale N issue commit rejects. A later issue must bind N+1. | N remains valid only if the issue receipt proves `F_DO_ISSUE_COMMIT < R_LP`; it may reach `APP_RENAME` if local high-water/deadline permit, while durable acceptance/exposure remain separate. An anti-rollback checkpoint alone is insufficient. |
| **C-read** | `F_READ`: linearizable Journal `getHead` read instant with an authenticated receipt/time and required DO/R2 consistency. | `R_LP`. | If head read/receipt is ordered first: `F < R`; HSM signature/delivery can follow. | Read returns N+1, or a stale N receipt is rejected. | N is valid at read time if receipt-bound and other current-state requirements were satisfied; it may reach `APP_RENAME` if the APP contract/high-water/deadline permit, with durable acceptance/exposure still pending. |
| **C-log** | `F_ISSUE_APPEND`: successful Freshness event append to the same ordered authority log. | `R_LP`: successful Release event append in that same orderable log. | Whichever append serializes first defines the order. `F(N) < R(N+1)` means N was latest at issue LP. | Release event wins; Freshness event must bind N+1 or append fails/retries. | Freshness event wins; N remains valid at the issue LP and may reach `APP_RENAME` if APP high-water/deadline permit; durable acceptance/exposure are separate. |

Important boundaries across the matrix:

- `R_PREPARE` and `R_POINTER` can precede `R_LP`; they do not mean N+1 is
  committed. Under the existing protocol, pending/inconsistent pointer/DO
  state fails closed for Freshness.
- `F_HSM` proves only signature generation over the specified bytes. It is
  not a current-head read, an LP, a Journal append, or permission to deliver.
- A DO finalization/write is not rollback-resistant merely because the
  transaction succeeded. PITR can restore prior DO state.
- `F_DELIVERY`, `APP_RENAME`, `APP_DURABLE_ACCEPT`, and `APP_EXPOSE` do not
  move the signed Freshness LP.
- For any ambiguous Journal append, the LP is determined by the Journal's
  actual atomic result, not the Worker timeout/ACK. Recovery needs an exact,
  authenticated read or provider-guaranteed exact retry.

### 14.9 Signature and finalization stages are different guarantees

| Stage | What it establishes | What it does not establish |
|---|---|---|
| HSM signature generated | The HSM produced signature bytes for a particular signing preimage. | That the caller received them, that the signature validates, that N was current, that an LP occurred, or that the result may be delivered. |
| Signature received by Worker | The Worker received a byte string from the HSM/API. | That the returned bytes are valid or match the request; network timeout/lost response remains ambiguous. |
| Signature validated by Worker | The bytes verify under the expected delegated key/domain and bind the intended payload. | That the bound state was current at its claimed LP or the response passed the operation/fence gate. |
| DO output finalization accepted | The DO accepted a matching operation/fence/result transition under its current stored state. | Release Journal commit, externally durable currentness, independent timestamp proof, or PITR resistance. |
| Exact response durably stored | The exact response can be read back in ordinary DO operation for idempotent retry. | That PITR cannot remove the row or that an older operation cannot be replayed after restore. |
| APP response delivered | The HTTP client observed some response bytes. | That APP verified the response or reached `APP_RENAME`, `APP_DURABLE_ACCEPT`, or `APP_EXPOSE`, or that it was latest at delivery. |
| APP local state rename | `APP_RENAME` makes the new high-water-state bytes visible at the canonical path after the pre-rename guard. | It does not prove the directory entry is durable, that the state writer returned success, or that a Runtime Config is exposed. |
| APP durable state acceptance | `APP_DURABLE_ACCEPT` follows successful parent-directory sync and state-writer return on Unix. | It is not a new Journal append, global latest-at-acceptance, Production deployment, or currentness after this point. |
| APP config exposure | `APP_EXPOSE` occurs when the validated Runtime Config-backed forwarder is installed and available. | It does not move either server-side LP; first use may occur later. |

For B1, `F_OUTPUT_FINALIZE` is a guard over an already defined issue-time
claim. For B2, an earlier authenticated issue-commit must define the LP; the
later exact response store remains a separate output-finalization stage.
Conflating these two meanings would make `issued_at`, HSM preimage, and
Release ordering ambiguous.

### 14.10 Required race/failure scenarios and diagram key

The following matrix applies to all five candidates. “Before” and “after”
refer to the actual LP, not message-send or ACK time.

| Scenario | A | B1 | B2 | C-read | C-log |
|---|---|---|---|---|---|
| 1. Normal Freshness and Release | `F_ISSUE_TIME`, post-sign lease check, then `R_LP`. | `F_ISSUE_TIME`, HSM, exact output finalize, then `R_LP`. | `F_DO_ISSUE_COMMIT` only under verified cross-resource ordering; anti-rollback checkpoint is separate; then HSM and response store. | `F_READ` receipt; Release append can follow. | Issue event append then Release event, or vice versa; the log sequence decides. |
| 2. Head N read, N+1 commits before HSM signing | Valid lease should prevent N+1 `R_LP`; if gate lost, post-check rejects. | Same; no finalize of stale operation without valid fence/receipt. | If N+1 wins before the ordered issue-commit LP, reject N. If it follows that LP, N may still be signed only when both ordering and anti-rollback evidence are valid. | N may be signed only if receipt proves the read LP preceded N+1 and the pointer/DO rule was met. | If Release append wins before issue append, re-read N+1; stale N append conflicts. |
| 3. HSM signature before output finalization, then N+1 `R_LP` | Normally impossible while the lease is active; if lease expired, discard signature. | Gate should prevent it; if it occurs due expiry/rollback, reject in baseline B1. | B2's LP is already before HSM; later N+1 is validly ordered after B2 only with the universal gate/common sequencer proof; checkpoint alone is insufficient. | N response may be finalized after N+1 only with exact read receipt and compatible current-state contract. | N issue event may be signed after N+1 if its event append preceded N+1. |
| 4. Finalization succeeds, Worker crashes before HTTP response | No durable exact-operation response in the existing protocol; do not infer delivery or fabricate retry. | Retrieve exact stored bytes by same operation ID/digest, or fail closed if the record is absent/rolled back. | Reuse B2 receipt and exact response operation; if no safe recovery, block/fail. No APP-local milestone occurs before the response is processed. | Journal has no Freshness event; needs a separate exact operation ledger or a new APP challenge. | Recover the event/receipt by operation ID, then finish the same response; never append a second event. |
| 5. Journal append succeeds, ACK is lost, Worker crashes | For Release, read exact current Journal record and recover DO `COMMITTED`; do not append another generation. | Same Release recovery; B1 Freshness itself has no Journal issue append. | Same Release recovery; B2 receipt source must also be checked. | Same Release recovery; C-read itself has no append ACK. | For both Release and Freshness issue append, exact `getByOperationId`/head read proves success; same-body exact retry only, otherwise blocked. |
| 6. DO PITR rolls back operation state | Quarantine; a lease/fence may have been resurrected or forgotten. Compare independent checkpoint/Journal and do not resume from DO alone. | Same; DO finalization/tombstone is not anti-rollback. | Quarantine unless external anti-rollback evidence detects the restore; separately re-establish issue-vs-Release order. A DO-only B2 LP is invalid after rollback uncertainty. | Journal read receipt may survive, but the current DO/R2 consistency contract can still fail closed. | Independent Journal event can survive DO rollback; joint Journal/checkpoint rollback still blocks without witness. |
| 7. Same operation ID retry | Current request contract does not define an internal op ID; exact retry semantics are not implemented. | Exact same ID+digest returns same stored response; different digest rejects; the external ledger must survive PITR. | Reuse same receipt/LP; differing digest rejects. Do not create a second LP under the same ID. | Journal alone cannot deduplicate; require external operation ledger or fresh nonce/new operation. | Return exact event/receipt for same ID+digest; reject same ID/different digest. |
| 8. Old N response arrives after N+1 commit | Valid only if N's LP preceded N+1; APP may reach `APP_RENAME` if high-water/deadline permit. | Same; finalization time is not substituted for issue time. | Valid only if receipt proves B2 LP preceded N+1 and both ordering/anti-rollback checks pass. | Valid only if `F_READ(N)` receipt preceded N+1 and other current-state constraints hold. | Valid only if issue event sequence precedes N+1. |

The following candidate diagrams show the ordered paths and representative
race, crash, retry, and restore branches. The shared APP diagram separately
shows `APP_RENAME`, `APP_DURABLE_ACCEPT`, and `APP_EXPOSE`, including
post-rename directory-sync failure. Each `opt` fragment is an independent
fault-injection variant, not a continuation of the preceding successful
trace. APP paths that show `APP_DURABLE_ACCEPT` assume the Unix parent-sync
path; non-Unix durability equivalence is `UNRESOLVED`. A normal diagram path
is not a Production implementation claim.

#### A — eight-second issue lease

```mermaid
sequenceDiagram
    autonumber
    participant APP
    participant F as Freshness signer
    participant DO
    participant J as Release Journal
    participant H as HSM
    participant R as Release worker
    participant R2

    APP->>F: Freshness challenge + nonce
    alt Release gate wins before issue lease
        R->>DO: writer_pending
        R->>R2: CAS pointer N+1 (not Release LP)
        R->>J: append exact N+1 record
        Note over J: R_LP(N+1)
        R->>DO: persist COMMITTED (post-commit)
        F->>DO: acquire issue lease
        DO-->>F: reject; no F_ISSUE_TIME
        F->>J: later read N+1; retry only under a new valid operation
    else Issue lease wins before Release
        F->>DO: acquire bounded issue lease
        DO-->>F: lease for current N
        R->>DO: beginRelease / set writer_pending
        DO-->>R: wait while issue lease is active
        F->>J: authenticated getHead = N
        F->>DO: verify COMMITTED = N
        F->>R2: verify pointer + immutable snapshot N
        F->>F: sample issued_at = F_ISSUE_TIME
        F->>H: sign response payload for N
        H-->>F: signature bytes generated
        alt Same lease remains valid
        F->>DO: revalidate same lease; release lease
        F-->>APP: signed response
        APP->>APP: verify; final guard; atomic rename = APP_RENAME
        APP->>APP: parent-directory sync and writer success = APP_DURABLE_ACCEPT
        APP->>APP: activation checks pass; install forwarder = APP_EXPOSE
        R->>R2: CAS pointer N+1 (not Release LP)
        R->>J: exact compare-and-append N+1
        Note over J: R_LP(N+1)
        R->>DO: persist COMMITTED (post-commit)
        else Lease expires or state rolls back during HSM delay
        Note over R,DO: Pending Release proceeds only after lease invalidation is proven
        R->>R2: CAS pointer N+1 after invalidation
        R->>J: append exact N+1 record = R_LP
        R->>DO: persist COMMITTED
        F->>DO: post-sign revalidate same lease
        DO-->>F: reject
        Note over F,APP: Discard signature; do not deliver
        end
    end

    opt Worker crashes after signature before delivery
        Note over F,APP: No APP_RENAME, APP_DURABLE_ACCEPT, or APP_EXPOSE; no exact signer operation ID exists
        APP->>F: retry only as a fresh protocol request after prior outcome is resolved
    end

    opt Release append ACK is lost
        R->>J: exact head/record readback
        J-->>R: exact N+1 record or conflicting head
        R->>DO: recover COMMITTED only from exact record and pointer
    end

    opt DO PITR
        DO-->>F: restored/uncertain issue state
        Note over DO,J: Quarantine; independent checkpoint required
    end

    opt N response arrives after N+1 Release
        APP->>APP: may reach APP_RENAME only if N LP < R_LP, deadline/TTL pass, and high-water permits
        APP->>APP: APP_DURABLE_ACCEPT / APP_EXPOSE require their later steps to succeed
    end
```

#### B1 — issue-time LP plus separate response finalization

```mermaid
sequenceDiagram
    autonumber
    participant APP
    participant F as Freshness signer
    participant DO
    participant J as Release Journal
    participant H as HSM
    participant R as Release worker
    participant R2
    participant L as External anti-rollback ledger

    APP->>F: challenge + nonce + operation binding
    alt Release wins before B1 issue LP
        R->>DO: set writer_pending
        R->>J: verify expected previous head N
        R->>R2: CAS pointer N+1 (not Release LP)
        R->>J: append N+1 = R_LP
        R->>DO: persist COMMITTED after exact append
        F->>DO: acquire issue gate
        DO-->>F: reject; no N LP
        F->>J: re-read N+1; retry only with a new valid operation
    else Freshness issue gate wins first
        F->>DO: acquire issue gate/fence
        DO-->>F: grant for N
        R->>DO: beginRelease / set writer_pending
        DO-->>R: wait until issue finalization or safe abort
        F->>J: verify exact current Release head N
        F->>F: sample issued_at = F_ISSUE_TIME (B1 LP)
        F->>H: sign response containing N and issued_at
        H-->>F: signature generated
        F->>F: validate signature/preimage and exact operation
        F->>DO: finalize exact response(op ID, digest, fence, bytes)
        DO->>L: anchor operation/fence against PITR
        L-->>DO: current external epoch/checkpoint
        DO-->>F: exact response durably finalized; release issue gate
        alt APP response delivered before Release LP
            F-->>APP: response delivery
            APP->>APP: verify; final guard; atomic rename = APP_RENAME
            APP->>APP: parent-directory sync and writer success = APP_DURABLE_ACCEPT
            APP->>APP: activation checks pass; install forwarder = APP_EXPOSE
            R->>J: verify expected previous head N
            R->>R2: CAS pointer N+1 (not Release LP)
            R->>J: append N+1 = R_LP
            R->>DO: persist COMMITTED after exact append
        else Release LP occurs before delayed response delivery
            R->>J: verify expected previous head N
            R->>R2: CAS pointer N+1 (not Release LP)
            R->>J: append N+1 = R_LP
            R->>DO: persist COMMITTED after exact append
            F-->>APP: delayed response for N
            APP->>APP: may reach APP_RENAME only if B1 LP < R_LP and high-water/time checks pass
            APP->>APP: APP_DURABLE_ACCEPT / APP_EXPOSE require their later steps to succeed
        end
    end

    opt Finalized response but Worker crashes before delivery
        F->>DO: exact retry by same operation ID + digest
        DO-->>F: return exact bytes only if external epoch and record still verify
    end

    opt Journal append ACK lost
        R->>J: query exact expected Release record
        J-->>R: exact committed bytes or conflict
        R->>DO: recover from exact Journal result
    end

    opt DO PITR
        DO-->>F: operation row/fence may be old
        F->>L: check independent epoch
        L-->>F: mismatch/unknown
        Note over F,APP: Quarantine; fail closed
    end
```

#### B2 — pre-sign issue-commit LP, then signing and output finalization

```mermaid
sequenceDiagram
    autonumber
    participant APP
    participant F as Freshness signer
    participant DO
    participant J as Release Journal
    participant H as HSM
    participant R as Release worker
    participant R2
    participant L as Independent checkpoint/receipt authority

    APP->>F: challenge + nonce
    alt Release N+1 wins before issue commit
        R->>DO: set writer_pending
        R->>R2: CAS pointer N+1 (not Release LP)
        R->>J: append N+1 = R_LP
        R->>DO: persist COMMITTED after exact append
        F->>DO: commit issue intent for stale N
        DO-->>F: reject; re-read N+1 or fail
        F->>J: read current head N+1
    else B2 issue commit wins
        F->>DO: acquire issue reservation for expected generation N
        DO-->>F: grant only if no Release is pending
        F->>J: read and verify candidate Release head N
        F->>DO: prepare exact issue intent; hold Release gate
        DO->>L: anchor reserved operation/fence against DO PITR
        L-->>DO: reservation checkpoint ACK; no R_LP order proof
        F->>DO: commit reserved intent = F_DO_ISSUE_COMMIT
        DO->>L: anchor exact committed operation digest
        L-->>DO: committed-state checkpoint ACK; no R_LP order proof
        DO-->>F: issue-commit receipt = F_DO_ISSUE_COMMIT (candidate LP only with proven ordering)
        Note over DO,J: Checkpoint detects rollback only; cross-resource order requires a universal gate or common sequencer
        Note over F,DO: Receipt must bind op/request digest, Release record, issue sequence/time, delegation, and unsigned response-payload/preimage digest; trusted time source is UNRESOLVED
        Note over DO,L: The two-phase checkpoint/recovery protocol is a requirement, not a verified provider guarantee
        par Release after B2 LP
            R->>DO: beginRelease after issue commit
            DO-->>R: admitted only after the issue reservation/commit
            R->>R2: CAS pointer N+1 (not Release LP)
            R->>J: append N+1 = R_LP
            R->>DO: persist COMMITTED after exact append
        and Finish signing and output finalization
            F->>H: sign final response binding receipt and issued_at
            H-->>F: signature generated
            F->>DO: persist exact signed response (F_OUTPUT_FINALIZE, not LP)
            DO-->>F: response bytes stored
            F-->>APP: signed response + required receipt proof
            APP->>APP: verify receipt/order, high-water/deadline/time; final guard + rename = APP_RENAME
            APP->>APP: parent-directory sync and writer success = APP_DURABLE_ACCEPT
            APP->>APP: activation checks pass; install forwarder = APP_EXPOSE
            Note over APP,J: If the receipt proves only anti-rollback and not F_DO_ISSUE_COMMIT < R_LP, fail closed; APP cannot infer order from its timestamp alone
        end
    end

    opt HSM fails or Worker crashes after B2 LP
        F->>DO: exact retry same op ID/digest/receipt
        DO-->>F: same receipt; never create a second LP
        Note over F,APP: If TTL/deadline has expired, do not deliver; keep audit record and fail closed
    end

    opt Issue-commit or checkpoint ACK is ambiguous
        F->>DO: lookup exact op ID + request digest
        DO-->>F: exact prior receipt or unresolved outcome
        Note over F,APP: Reuse only the exact receipt; unresolved status quarantines, and a fresh LP is not created
    end

    opt DO PITR erases issue state
        F->>L: verify external receipt/incarnation
        L-->>F: missing or mismatched anchor
        Note over F,APP: Do not trust restored DO state; if the checkpoint also rolled back or cannot be checked, quarantine
    end
```

#### C-read — linearizable head read, no Freshness issue append

```mermaid
sequenceDiagram
    autonumber
    participant APP
    participant F as Freshness signer
    participant J as Release Journal
    participant DO
    participant R2
    participant H as HSM
    participant R as Release worker

    APP->>F: challenge + nonce
    alt Release N+1 commits before F_READ
        R->>DO: set writer_pending
        R->>R2: pointer CAS N+1 (not Release LP)
        R->>J: append N+1 = R_LP
        R->>DO: persist COMMITTED after exact append
        F->>DO: acquire/read under current-state rules
        F->>J: linearizable getHead
        J-->>F: N+1; do not issue N
    else F_READ(N) precedes Release append
        F->>DO: acquire current-state gate if required by pointer contract
        F->>J: linearizable getHead
        J-->>F: N + authenticated read receipt/time = F_READ (C-read LP)
        F->>DO: release any read gate after receipt fixes F_READ
        par Validate immutable state and sign
            F->>R2: fetch exact immutable snapshot referenced by N
            F->>DO: verify COMMITTED/pointer under the selected contract
            F->>H: sign response binding receipt and issued_at
            H-->>F: signature generated
        and Release may append after the read
            R->>R2: pointer CAS N+1 (not Release LP)
            R->>J: append Release N+1 = R_LP
            R->>DO: persist COMMITTED after exact append
        end
        Note over F,DO: If the retained contract requires current DO/pointer=N, an intervening advance fails closed; C-read alone does not override it
        F-->>APP: response + read proof only if all required checks pass
        APP->>APP: verify signer/receipt/snapshot/artifacts; final guard + rename = APP_RENAME
        APP->>APP: parent-directory sync and writer success = APP_DURABLE_ACCEPT
        APP->>APP: activation checks pass; install forwarder = APP_EXPOSE
        Note over F,APP: N after N+1 may reach APP_RENAME only if receipt proves F_READ(N) < R_LP(N+1) and the contract permits that historical state
    end

    opt Worker crashes after HSM signature
        Note over F,J: C-read has no issue event; exact retry requires a separate operation ledger or a new challenge
    end

    opt Release append ACK lost
        R->>J: exact current-head/record readback
        J-->>R: resolve Release only from authenticated exact record
    end

    opt DO PITR
        DO-->>F: current state uncertain
        Note over F,J: Independent Journal receipt may survive; mismatched required DO state blocks
    end
```

#### C-log — shared ordered Journal issue append

```mermaid
sequenceDiagram
    autonumber
    participant APP
    participant F as Freshness signer
    participant J as Shared ordered Journal
    participant R2
    participant H as HSM
    participant R as Release worker
    participant DO

    APP->>F: challenge + nonce + operation ID
    alt Release gate wins before issue preparation
        R->>DO: set writer_pending
        R->>R2: pointer CAS N+1 (not Release LP)
        R->>J: append Release event N+1 = R_LP
        R->>DO: post-append COMMITTED coordination
        F->>DO: acquire issue gate
        DO-->>F: reject; no issue event or C-log LP
        F->>J: re-read current Release projection N+1
    else Freshness issue gate wins
        F->>DO: acquire issue gate; reject if writer_pending
        DO-->>F: gate for current projection
        F->>J: read current Release projection N
        F->>R2: verify exact snapshot/digest for N
        alt Release event nevertheless wins before issue append
            Note over F,R: Gate violation or uncoordinated writer; this branch must fail closed
            R->>R2: pointer CAS N+1 (not Release LP)
            R->>J: append Release event N+1 = R_LP
            R->>DO: post-append COMMITTED coordination
            F->>J: append issue event with expected projection N
            J-->>F: conflict; no C-log LP
            F->>J: re-read N+1; retry only under a new exact operation or fail
        else Issue event append wins
            F->>J: append typed issue event(op ID, request digest, N, snapshot)
            J-->>F: receipt(sequence, trusted time, event digest) = F_ISSUE_APPEND (C-log LP)
            Note over F,J: Atomic append establishes issue order before any later Release event
            par Complete signing and delivery
                F->>H: sign response binding event receipt and issued_at
                H-->>F: signature generated
                F-->>APP: signed response + verifiable issue receipt
                APP->>APP: verify log proof/snapshot/artifacts; final guard + rename = APP_RENAME
                APP->>APP: parent-directory sync and writer success = APP_DURABLE_ACCEPT
                APP->>APP: activation checks pass; install forwarder = APP_EXPOSE
            and Release after issue event
                R->>DO: beginRelease after issue append
                R->>R2: pointer CAS N+1 (not Release LP)
                R->>J: append Release event N+1 = R_LP
                R->>DO: post-append COMMITTED coordination
            end
            Note over F,APP: N is valid at its event LP even if signature or delivery follows N+1; APP must verify event order and local high-water
        end
    end

    opt Freshness append succeeds but ACK is lost and Worker crashes
        F->>J: getByOperationId(same ID, same request digest)
        J-->>F: exact existing event/receipt; no duplicate LP
        F->>H: finish exact receipt-bound response
    end

    opt Same operation ID with changed body
        F->>J: retry same ID, different request digest
        J-->>F: reject conflict; preserve original event
    end

    opt Release append ACK is lost
        R->>J: exact release/event-head lookup
        J-->>R: resolve only exact committed record and sequence
        R->>DO: recover post-commit coordination
    end

    opt DO PITR
        DO-->>R: restored coordination row
        R->>J: compare Journal Release projection/event sequence
        Note over DO,J: Quarantine if mismatch; joint rollback needs independent witness
    end

    opt N response arrives after N+1
        APP->>APP: may reach APP_RENAME only if issue event precedes N+1 and high-water/deadline permit
    end
```

#### APP local state milestones common to all five LP candidates

```mermaid
sequenceDiagram
    autonumber
    participant M as Runtime Config manager
    participant W as APP state writer
    participant P as TLSN forwarder slot

    Note over W: APP_DURABLE_ACCEPT path shown for Unix; non-Unix equivalence is UNRESOLVED
    M->>W: write verified Freshness high-water state
    W->>W: temporary write + file sync + final guard
    W->>W: atomic rename = APP_RENAME
    alt Parent-directory sync succeeds
        W->>W: sync parent and return success = APP_DURABLE_ACCEPT
        W-->>M: return Verified Runtime Config Manifest
        M->>P: preflight, identity, health, dependency checks; install
        P-->>M: installed = APP_EXPOSE
    else Parent-directory sync fails after rename
        W->>W: return error after APP_RENAME
        Note over W: New high-water bytes may be visible at the canonical path; rollback is not implied
        W-->>M: refresh returns error; no Verified Manifest is returned
        M->>P: do not install forwarder
        Note over M,P: APP_DURABLE_ACCEPT and APP_EXPOSE do not occur on this path
    end
```

### 14.11 Eight-second lease: safety versus timeouts and progress

The present normative contract still says **at most an eight-second issue
lease** and requires post-sign same-lease validation. This supplement does
not remove or extend that requirement. The table below distinguishes what a
candidate design needs for safety from unrelated operational time budgets.

| Timer/limit | Purpose | Does it establish currentness/order? |
|---|---|---|
| 8-second issue lease | Current normative cap on the exclusive issue operation. | No, not by itself. A clock expiry does not prove an HSM stopped or that a late response cannot be delivered. Current protocol combines the lease with an after-sign recheck. |
| Worker request timeout | Bounds one Worker invocation/resource usage. | No. Timeout/abort is not an LP and does not prove an external signer stopped. |
| HSM operation timeout/cancellation | Bounds signer work if provider offers terminal cancellation/status. | Only a verified provider contract can establish quiescence. It does not replace Release/issue ordering. |
| Operation recovery deadline | Operational policy for resolving `IN_DOUBT`. | No safe automatic unlock unless a durable fence/revoke or terminal signer status is proved. |
| 30-second response lifetime | Limits how long APP may accept signed response time. | No. It is not a lock, LP, or substitute for APP's request deadline. |
| APP 10-second monotonic deadline | Bounds one challenge from before POST through the last pre-rename guard. | No server-side ordering guarantee; a valid earlier LP response may still be rejected if slow. |
| SLO/latency target | Measures expected processing/availability. | No authorization and no safety proof. It must not be conflated with a hard lease or response expiry. |

#### Separate elapsed-time budgets and measurement status

The eight-second and ten-second values have different clocks and start
events. Let `t0` be the APP monotonic deadline start immediately before POST,
`ta` the server-side issue-lease acquisition time, `tr` the successful
post-sign recheck/lease release time, and `tb` the time the APP has received
the complete Freshness response body. Then:

```text
T_pre   = ta - t0       # request transit/queueing and server work before acquisition
T_lease = tr - ta       # lease-held issue operation, normative maximum <= 8 seconds
T_post  = tb - tr       # response completion/transfer after lease release
APP budget at body receipt = 10 seconds - T_pre - T_lease - T_post
```

The lease begins at server acquisition, not at `t0`; the normative maximum
does not imply a fixed two-second APP remainder. If `T_lease` is near eight
seconds, the idealized remainder is near `2 seconds - T_pre - T_post` and
may be small, zero, or negative. Network transit and queueing are not
included in the server lease but consume the APP deadline.

The APP source sets one `Instant` deadline immediately before the POST.
`reqwest` also has a 2-second connect timeout and a 10-second per-request
timeout, while `timeout_at` wraps the POST and complete response-body read;
Manifest and each of the five artifact fetches use the same outer deadline
sequentially, not five fresh ten-second budgets. Signature/metadata
verification, exact-byte hashing, state serialization, temporary-file write
and file sync must also finish before the final guard. The guard checks the
deadline immediately before rename. Rename, parent-directory sync, writer
return, and subsequent proxy activation are synchronous/later work without a
post-rename deadline check. Consequently, the ten-second value is not a
worst-case guarantee for `APP_DURABLE_ACCEPT` or `APP_EXPOSE`.

| Quantity | Evidence/status |
|---|---|
| Protocol lease hard maximum | `VERIFIED` as a normative maximum of 8 seconds; it is not an APP deadline or SLO. |
| Production lease acquisition-to-release elapsed time | `NOT MEASURED`; no Production Freshness route/DO is implemented. The test adapter creates `expires_at = acquired_at + 8,000 ms`, which is test behavior, not a Production timing result. |
| `T_pre`, `T_post`, and total POST-to-body time | `NOT MEASURED`; no representative network/queue timing data was collected. |
| Manifest and five sequential artifact fetch durations | `NOT MEASURED`; a shared deadline is enforced, but no latency distribution or worst-case evidence was collected. |
| Verification, hashing, state serialization, temp-file write/file sync | `NOT MEASURED`; no benchmark or worst-case bound was collected. |
| Rename, parent-directory sync, `APP_DURABLE_ACCEPT`, and forwarder activation duration | `NOT MEASURED`; these stages have no post-rename deadline check or demonstrated upper bound. |
| 30-second response lifetime | `VERIFIED` as a separate signed-response validity limit; it does not add time to either the 8-second lease or APP's 10-second deadline. |

| Candidate | Is an 8-second hard expiry logically necessary for its LP safety? | If the eight-second limit were formally removed, what replaces it? | Can Release block forever? |
|---|---|---|---|
| A | Not a substitute for safety; the current protocol nevertheless requires it. Safety needs an enforced gate through post-sign recheck and no bypass. | Protocol amendment plus a verified operation/fence mechanism, signer late-result rejection, clock/receipt model, and recovery policy. | Yes, if the gate is held and signer quiescence or safe revocation cannot be proved. A time-only unlock is unsafe. |
| B1 | No, the LP remains `issued_at` under a valid exclusive gate; but the current protocol requires max 8s and rejects after-sign expiry. | Durable issue operation ID/fence, external anti-rollback ledger, mandatory output finalization, and approved handling of signer work beyond eight seconds. | Yes, while `IN_DOUBT` holds the Release gate. |
| B2 | No as a logical requirement if a universal gate/common sequencer proves LP order and anti-rollback is separately controlled; the current protocol still requires the 8-second maximum. | No limit is changed here. Any future removal needs protocol-owner approval, the same cross-resource ordering proof, independent anti-rollback, late-result controls, exact retry, and response-expiry handling. | Yes if reservation/checkpoint outcome remains ambiguous or the gate is held through response persistence. Release can proceed after LP only when ordering is proven and the gate is safely released. |
| C-read | No, if a trusted read receipt and all current-state requirements are met. | Provider-signed read LP/sequence, receipt binding in response, and resolution of DO/R2 cross-resource races; amendment if receipt changes `issued_at` semantics. | No for the read itself. Yes only if the implementation additionally holds a DO issue gate and cannot recover it. |
| C-log | No, if the typed issue append is the LP in the same ordered log and exact receipt/retry works. | Shared-log event schema, operation ID and append receipt, proof/APP verification, retention/checkpoint, and Release chain integration. | HSM delay need not block Release after the event LP. An ambiguous shared Journal append can block until exact outcome is resolved; no time-only conclusion is safe. |

Removing or changing the normative eight-second limit is a protocol-owner
decision. A Worker timeout, response TTL, or operational SLO cannot be
substituted silently. Likewise, keeping a hard deadline does not prove
progress: a timeout followed by an unanchored lease deletion can let an old
signer response race a new Release.

### 14.12 Implementation impact — design only

“Observed” means present in current source; “required” means a future
candidate change inferred from this comparison, not code written in this
task.

| Surface | Observed now | B1 future impact | B2 future impact | C-read future impact | C-log future impact |
|---|---|---|---|---|---|
| Domain package | `FreshnessRequest`, `FreshnessResponsePayload/Envelope`, validators, and shared golden vectors exist. | Add internal op ID/digest/fence/result contracts. APP wire may remain if no receipt is public. | Add pre-sign issue-commit receipt/sequence binding and new signed payload semantics or receipt envelope; exact-schema validators and domains must change. | Add authenticated read-receipt type and response binding; current exact schema rejects unknown fields. | Add issue-event/receipt schemas, event digest/sequence, verifier, and signature binding. |
| Signer interface | `FreshnessResponseSignerRequest` accepts challenge, structurally typed `verifiedCurrentState`, and delegation only. | Bind operation ID, request digest, lease/fence, and exact finalization result; runtime revalidation remains mandatory. | Split reserved intent, pre-sign issue commit/receipt, HSM signing, and exact response persistence; verify order and anti-rollback claims separately. | Accept/verify Journal read receipt and required DO/R2 state; no generic read/sign request. | Accept/verify exact append receipt/event; exact operation lookup/retry API. |
| Verified types | `VerifiedCurrentFreshnessState` and `VerifiedDelegation` are normal structural interfaces. | Runtime-check raw/loaded state after every RPC; optional nominal branding is only local misuse defense. | Finalization receipt must be verified at signer boundary and not trusted because it is a TypeScript object. | Journal-signed receipt and consistency evidence need runtime validators. | Append event/receipt, sequence, previous event head, and operation record need runtime verification. |
| Worker route/signer | Production Freshness route/signer is not implemented; script path is test adapter. | New route/coordinator and universal output-finalization gate; no direct HSM-to-APP bypass. | New multi-stage coordinator and receipt validation; response is signed after LP. | Read-only Journal API and receipt-aware signer path; no issue append. | Shared ordered Journal client and exact issue-event idempotency; Release integration required. |
| DO coordination | No Runtime Config production DO class/binding. Existing verification/session binding DO is separate. | Store issue operation/fence/exact response; Release gate; anti-rollback checkpoint integration. | Store reserved intent, pre-sign commit/receipt, then exact response; gate all Release paths; use a separate anti-rollback checkpoint and quarantine after PITR. | Optional current-state gate if existing pointer/DO contract is retained; not a Journal receipt substitute. | May coordinate pointer gate, but cannot be the sole event sequencer if Journal append is LP. |
| Journal adapter | No selected Production Journal provider. | Existing Release `getHead`/append remains; external op ledger may be separate. | If the universal DO gate cannot prove relation to `R_LP`, use a common sequencer/shared ordering log; an anti-rollback checkpoint alone is insufficient. | Authenticated linearizable `getHead` plus signed read receipt/time/sequence. | Shared typed event log, cross-event append CAS, exact lookup, trusted receipt, retention, and separate Release projection. |
| APP Rust | Verifies current response payload and Release chain, Manifest, artifacts, timing, and high-water. | No change if proof remains wholly within trusted Freshness signer; otherwise verify receipt/fence. | Add receipt schema/signature/ordering validation and possibly store issue sequence/op high-water. | Verify Journal read receipt/key/sequence/time and bind to `issued_at`. | Verify issue event, receipt, sequence, release ordering, signature, and rollback/high-water policy. |
| APP state/high-water | Persists Manifest epoch/digest, Release generation/record digest, and Freshness delegation generation/digest. | Likely no change for internal-only operation fence; external anti-rollback remains server responsibility. | Consider monotonic issue/receipt sequence if needed to detect replay across local state rollback. | Persist receipt sequence only if the protocol requires local monotonicity beyond Release generation. | Persist/validate event sequence or operation state if required; do not weaken existing epoch/record high-water. |
| Golden vectors/tests | Shared current-wire vectors and APP/Worker tests exist for present contract. | Add exact retry, stale fence, response-finalize crash, PITR, release-vs-finalize race. | Add receipt signature, issue-commit/response-finalize separation, PITR, time/order boundary. | Add signed/stale read receipt, release-after-read, pointer/DO mismatch, snapshot digest mismatch. | Add append before/after Release, exact retry/conflicting body, ambiguous ACK, crash, event-chain consistency. |
| Readiness | Production Freshness and Stage A/B/C remain BLOCKED. | No status change until Production provider/HSM/DO evidence and review. | No status change; receipt trust and PITR blocker first. | No status change; Journal capability and APP contract first. | No status change; shared-log provider and protocol/wire approval first. |

No implementation impact above was applied. No source, test, configuration,
golden-vector, readiness, or wire file was modified.

### 14.13 Remaining human decisions and status

The following remain **UNRESOLVED**:

1. Whether the current eight-second maximum remains a hard normative lease,
   and what failure/recovery semantics the protocol owner approves. No change
   is made here.
2. Whether B1, B2, C-read, or C-log is the authorized Freshness LP model.
3. Whether a DO-only internal output gate is an acceptable trust boundary or
   the APP must independently verify a read/finalization/append receipt.
4. Which trusted source supplies a millisecond `issued_at` exactly aligned
   with the selected LP; no signer/DO/Journal clock relationship is assumed.
5. How the current Release writer gate and R2-before-Journal ordering
   interoperate with C-read/C-log without claiming pointer update is Release
   commit.
6. Whether a shared event Journal can preserve existing Release generation,
   previous-Release digest, pending authorization, and exact append semantics
   while interleaving Freshness events.
7. Which independently administered checkpoint prevents DO PITR or joint
   Journal/DO rollback, who controls restore quarantine, and how old
   operation IDs/tombstones are retained.
8. Whether the B2 receipt authority can prove issue-commit order against
   every Release append, how its own rollback and ambiguous ACK/exact retry
   are handled, and whether it is the same shared ordering substrate required
   by C-log or a universally enforced DO gate.
9. Whether B2/C-read/C-log receipt fields and trust material may change the
   current exact APP/Worker wire contract; this task did not make such a
   change.
10. How HSM late results, exact retries, response expiry, ACK ambiguity, and
   permanent `IN_DOUBT` states are resolved without false success.

**Readiness remains:** Production Freshness **BLOCKED**; Stage A, Stage B,
Stage C **BLOCKED**; Production acceptance **BLOCKED**. This document-only
supplement neither implements nor authorizes a Production authority.

### 14.14 Explicit conclusions

- **Does B1 fit existing `LATEST_AT_ISSUANCE`?** **Yes**, if the existing
  `issued_at` sample is the LP under an active gate that prevents Release
  append through the required post-sign validation, or if an equivalent
  authenticated issue receipt fixes the same point. The gate can be released
  after that validation; a later Release may precede response delivery or
  APP processing without moving the LP. Finalization is separate and does
  not move the LP. Under the current lease rule, a post-sign revalidation
  failure discards the response.
- **Does B2 work without an additional trust assertion?** **No.** A
  post-sign DO flag cannot redefine a previously signed `issued_at`. B2
  needs an LP receipt/time/sequence fixed before final response signing,
  independent anti-rollback protection, and a separately verified ordering
  relation to `R_LP`. A monotonic checkpoint alone proves neither the
  cross-resource order nor trusted issue time. If a universal DO gate cannot
  prove the relation, B2 needs a shared ordered authority of the kind C-log
  requires. The existing Freshness key could attest to the receipt without
  adding a public key, but that expands its trust assertion.
- **Is a C-read linearizable head read alone sufficient?** **No** under the
  current contract. It needs an authenticated receipt/time bound to
  `issued_at`, exact immutable snapshot binding, and a solution to the
  Journal/DO/R2 cross-resource race. The current APP wire has no read receipt.
- **Can C-log use Journal append as the Freshness LP?** **Yes, as a
  candidate**, if Freshness issue and Release records share one genuinely
  linearizable ordered log, issue append receipts are authenticated and
  exactly retryable, and Release generation/head semantics are redesigned
  for interleaved event types. None of those Production guarantees is
  currently selected or implemented.
- **Must eight seconds remain for Safety?** **Not inherently for the
  candidate LPs.** Safety requires authentic ordering, output gating, and
  rollback-resistant recovery; a duration alone proves none of them. The
  current protocol still imposes the eight-second maximum and post-sign
  recheck. Changing it requires explicit protocol approval.
- **Can Production implementation start now?** **No.** LP choice, clock/
  receipt source, provider capabilities, DO PITR anchor, exact retry and HSM
  recovery, wire approval, and Release/C-log ordering remain blockers.

## 15. Independent P2 recovery review: Release gate, PITR, and signer outcomes

This section records a source-grounded review of whether every authoritative
Release mutation is covered by the proposed gate, whether a restored DO can
reuse old authenticated operations, and how delayed HSM results can be made
safe. It supplements Sections 1–14; it does not select a provider, trust root,
or LP, and it does not implement a Worker, DO, R2 adapter, Journal, signer, or
recovery procedure.

### 15.1 Review baseline and source evidence

The prior Section 15 source review used the
`9f2541103ebcd5d38548d69804422c536657d8d9` HEAD recorded in Section 1. This
coverage-completion review was performed on `2026-11-02` against branch
`tlsn-first-testplay-candidate`, HEAD
`ab818c266361b582eef86d001afc40bf2c467706`, parent
`9f2541103ebcd5d38548d69804422c536657d8d9`; the expected HEAD matched. The
allowed-path worktree and index were clean at review start. The protected
paths were excluded from status inspection; no GitHub remote state is
asserted. Source findings below remain separate from proposed design
behavior.

| Source | Verified source fact | Limit |
|---|---|---|
| [Normative Freshness protocol](./runtime-config-freshness-protocol.md) | Release LP is the successful atomic append of the exact authorized Release record. The DO `COMMITTED` state is post-append coordination state. The issue lease is at most eight seconds and is rechecked after signing. | This is a protocol requirement, not evidence that a Production gate or Journal exists. |
| [DO coordination design](./runtime-config-freshness-do-coordination-design.md) and [Production Authority design](./runtime-config-freshness-production-authority-design.md) | Propose `writer_pending`, operation records, R2 pointer reconciliation, Journal append, exact-response finalization, and fail-closed recovery. | Proposed transactions and recovery are not implemented or runtime-tested. The DO design's “operational target/SLO” wording for eight seconds conflicts with the normative maximum and is not adopted here. |
| [P2 prerequisite decision](./runtime-config-freshness-p2-prerequisite-decision.md) | Identifies external operation history, independent rollback checkpoint, restore epoch, quarantine, and exact signer-result recovery as prerequisites. | Its candidate mechanisms still need provider, permission, and failure-injection evidence. |
| [Readiness record](../FIRST-TESTPLAY-READINESS.md) | Production Freshness and Stages A/B/C are recorded as blocked; test-only evidence is not Production acceptance. | No readiness status was changed or re-certified. |
| [P1 signer interfaces](../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/signers.ts) | `FreshnessResponseSignerRequest` carries the challenge and verified current state, but no durable issue-operation ID, fence, idempotency key, or finalization receipt. The Release request likewise does not define a provider operation-status contract. | TypeScript interfaces do not provide HSM idempotency, cancellation, status lookup, durable result retention, or output fencing. |
| [Freshness test adapter](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-freshness-test-adapters.mjs) | The in-memory coordinator gates a test Release, signs the response, rechecks the lease after the injected signing delay, and releases the lease in `finally`. Its lease-pruning helper removes expired leases. | The fake signer, injected clock, and in-memory state do not model a remote HSM result that can arrive after caller timeout, a Durable Object restart, or PITR. Automatic test-lease pruning is not proof that Production may clear an operation at eight seconds. |
| [Freshness tests](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-freshness-test.mjs) | Exercise test-adapter Release recovery, ambiguous R2 outcomes, issue/Release races, and delayed signing. | No Cloudflare Production DO, live R2, Production Journal, HSM, or Production signer integration is exercised. Tests were inspected, not run for this documentation review. |
| [Release publisher](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-release.mjs) and [production registration](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-production-registration.mjs) | `publishTlsnRuntimeConfig()` checks a registration object whose signer, independent pin, APP root, and endpoint are not registered and whose `production_publish_allowed` is `false`; it therefore fails closed in the checked-in state. The test publisher requires an in-memory test-only store. | This is current source gating, not proof about any deployed Worker or external credential holder. |
| [R2 store helper](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-r2-store.mjs) | Exports a Cloudflare R2-backed object-store helper with a conditional Manifest-pointer CAS and readback/reconciliation logic. | The exported helper does not itself call the Production registration assertion, and it is not a Release Journal or cross-resource transaction. No Production Runtime Config caller is registered in the checked-in Worker. |
| Worker [entrypoint](../../FUSOU-TLSN-VERIFICATION-WORKER/src/index.ts), [binding authority](../../FUSOU-TLSN-VERIFICATION-WORKER/src/binding_authority.ts), and [Wrangler configuration](../../FUSOU-TLSN-VERIFICATION-WORKER/wrangler.toml) | `TLSN_BINDINGS` and `TlsnBindingAuthorityDurableObject` serve verification/session binding. The inspected Worker has no Runtime Config authority binding or Freshness route. | This does not establish deployed bindings, account permissions, or that all external R2 credentials are controlled by this Worker. |
| APP [Freshness verifier](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_freshness.rs) and [state writer](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_runtime.rs) | APP sends a nonce-bound request, verifies the response and local high-water transition, fetches the Manifest and five referenced artifacts under one ten-second monotonic deadline, and guards the state-file replacement. | The current APP wire has no DO/Journal receipt or issue-operation field. APP acceptance does not prove a remote operation ledger is rollback-resistant. |

**Current implementation conclusion:** no checked-in Production Runtime
Config route, Runtime Config DO, Release Journal, or Production HSM signer
was found. The normal publisher entry is currently blocked by registration,
but the low-level R2 helper is an independent mutation capability for code
holding its credentials. Its use is not found outside the helper/tests in the
checked-in tree; reachability through deployment configuration, operator
credentials, or another repository is **UNRESOLVED**. It is therefore not
valid to claim that a Production Release gate currently covers every possible
pointer mutation path.

### 15.2 Official Cloudflare specifications checked

The following official pages were retrieved on `2026-11-02`. Their documented
capabilities do not establish an FUSOU Journal, cross-resource transaction,
or Production deployment.

| Official specification | Page last updated | Relevant guarantee / boundary |
|---|---:|---|
| [SQLite-backed Durable Object Storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) | 2026-09-21 | SQLite-backed DO storage is transactional and strongly consistent within the DO. PITR can restore SQL and KV contents to a point in the preceding 30 days. This permits operation rows, fences, and tombstones to be restored to an earlier state; it does not supply an application-level “was restored” bit. |
| [Access Durable Objects Storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/) | 2026-10-30 | Describes storage access from a Worker or externally. It does not show that FUSOU has enabled or restricted any particular external access path. |
| [Durable Objects roles and permissions](https://developers.cloudflare.com/workers/authorization/durable-objects/) | 2026-09-15 | DOs have no separate roles from their implementing Worker. Data Studio can query and modify SQLite-backed DO data and requires Editor access to the Worker. Administrative access is therefore part of the authority boundary and must be restricted/audited. |
| [Invoke Durable Object methods](https://developers.cloudflare.com/durable-objects/best-practices/create-durable-object-stubs-and-send-requests/) | 2026-04-21 | Public methods are callable through a DO stub by a Worker with the binding. A binding is not evidence that every signer, route, or administrative path follows the application-level Release gate. |
| [R2 consistency model](https://developers.cloudflare.com/r2/reference/consistency/) | 2026-10-14 | R2 reads/writes are strongly consistent; conditional writes are evaluated atomically at commit and same-key competitors serialize. A negative read does not prove that an earlier ambiguous in-flight write will not later commit. These guarantees do not create append-only history or a transaction with DO/Journal state. |
| HSM / signing provider contract | **NOT SELECTED / NOT VERIFIED** | No vendor/API is present in the source inventory. Cancellation, exact idempotency, durable status lookup, exact-result retrieval, and delayed-response suppression cannot be asserted. |

### 15.3 Release gate coverage and mutation paths

`R_LP` remains the successful Journal compare-and-append of the exact
authorized Release record. R2 pointer CAS is not `R_LP`; DO `COMMITTED` is
post-commit coordination state. The proposed gate is one per-environment
coordinator, but that Production owner, fence, and gate are
`NOT_IMPLEMENTED`. Every external call must occur outside a DO transaction;
persist intent first and reconcile before clearing the gate.

The table separates the required design from what current source proves.
`NOT_IMPLEMENTED` means no Production mechanism is present; a behavior in the
in-memory adapter is explicitly identified as test-only.

| Operation | Gate owner | Gate required | Operation ID | Expected generation | Fence check | External mutation | Recovery | Freshness race | Source evidence |
|---|---|---|---|---|---|---|---|---|---|
| Immutable candidate object write | Candidate writer/R2 credential; no Production Runtime Config gate owner is registered. | No only for content-addressed, immutable, orphan-safe writes; yes if a write can change an active alias/pointer or authority. | Required: stable content digest/key. Separate operation ID: `NOT_IMPLEMENTED`. | No active generation may change. Candidate generation is not authoritative before `R_PREPARE`; binding is `NOT_IMPLEMENTED`. | Enforce create-once semantics for exact key/body; no Release fence in the R2 helper. | R2 object `PutObject` under the artifacts namespace. | Exact readback; retain an orphan if the Release aborts. Never promote it by itself. | Safe only if Freshness never reads an uncommitted candidate as current. An alternate active-pointer update remains outside this row. | [R2 helper](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-r2-store.mjs); [publisher](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-release.mjs). |
| `beginRelease` / `R_PREPARE` | Required: one per-environment Runtime Config DO. Current: `NOT_IMPLEMENTED`; only the in-memory test coordinator exists. | Yes; atomically set `writer_pending` and persist the attempt before any mutable pointer write. | Test adapter has `attempt_id`; Production operation ID/idempotency contract is `NOT_IMPLEMENTED`. | Require current Journal generation/digest and expected pointer ETag, then candidate generation = current + 1. Test-only. | Test adapter checks prior generation/digest/ETag; Production fencing token/incarnation is `NOT_IMPLEMENTED`. | DO state write only; no external I/O in the transaction. | Resume the same attempt after restart; conflicting attempt or predecessor fails closed. Production durable recovery is `NOT_IMPLEMENTED`. | Must serialize with Freshness lease acquisition: Release-first denies issue; issue-first makes Release wait. Production serialization is `NOT_IMPLEMENTED`. | [test adapter](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-freshness-test-adapters.mjs); [P2 DO design](./runtime-config-freshness-do-coordination-design.md). |
| R2 pointer CAS / `R_POINTER` | Required: same per-environment DO gate owner. Current owner/fence: `NOT_IMPLEMENTED`. | Yes; gate stays held from durable write intent through exact readback. | Required: original Release attempt ID. Test adapter has one; Production idempotency/fence binding is `NOT_IMPLEMENTED`. | CAS expected prior ETag; verify the exact candidate Manifest digest and generation bound by `R_PREPARE`. Production generation binding is `NOT_IMPLEMENTED`. | Test adapter records `pointer_write_started`; a Production stale-owner/incarnation fence is `NOT_IMPLEMENTED`. | Conditional R2 `PutObject` changes the mutable Manifest pointer. This is not `R_LP`. | Query pointer and immutable snapshot; retry only the same exact CAS if the outcome is resolved/provider semantics permit it. An ambiguous write remains blocked. | No Freshness issue while writer gate is held. A direct R2 writer can bypass the proposed gate; credentials are `UNRESOLVED`. | [R2 store](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-r2-store.mjs); [test adapter](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-freshness-test-adapters.mjs). |
| Release Authority signing | Required: same DO gate plus a signer operation boundary. Current Production gate/signer: `NOT_IMPLEMENTED`. | Yes; sign only the exact persisted attempt after pointer readback and predecessor checks. | P1 carries `attempt_id` through `PendingReleaseAttemptBinding`; separate HSM operation/idempotency ID is `NOT_IMPLEMENTED`. | Sign candidate generation and previous Journal generation/digest exactly; no new generation on retry. | No Production signer fence/current-incarnation check. P1 signer request is not a provider status or output-fencing contract. | Production HSM operation: `NOT_IMPLEMENTED`; test adapter creates a test record. | Recover the exact signer operation/result or remain `IN_DOUBT`; never sign a changed timestamp/payload as a retry. | Gate blocks Freshness during Release. A stale signer output still needs a universal finalizer; it is `NOT_IMPLEMENTED`. | [signer interface](../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/signers.ts); [test adapter](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-freshness-test-adapters.mjs). |
| Journal compare-and-append / `R_LP` | Required: DO gate plus the selected Journal authority. Both Production resources: `NOT_IMPLEMENTED`. | Yes; hold the gate through authenticated append result/readback and DO reconciliation. | Required: stable Release attempt/append ID and exact record digest. Test record has `release_commit_id`; Journal operation idempotency is `NOT_IMPLEMENTED`. | Expected prior generation/head digest; successful append creates the next Release generation. Provider contract is `NOT_IMPLEMENTED`. | Must reject stale predecessor/fence. No Production fence or Journal adapter exists. | Journal append is the Release LP. Do not treat signing or R2 CAS as the LP. | Query exact record/position; exact retry only if selected provider guarantees it. Lost ACK otherwise remains `IN_DOUBT`. | Freshness remains blocked until append is resolved and current head is reconciled. | [protocol](./runtime-config-freshness-protocol.md); [test adapter](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-freshness-test-adapters.mjs). |
| DO `COMMITTED` | Required: same per-environment DO. Current Runtime Config DO: `NOT_IMPLEMENTED`. | Yes; post-`R_LP` transaction verifies the exact committed Journal/R2 result before releasing the writer gate. | Reuse the same Release attempt ID; Production durable operation record is `NOT_IMPLEMENTED`. | Must equal the generation/record actually appended at `R_LP`; never infer a commit from a DO-local counter. | Match current incarnation, exact attempt, Journal record digest, and R2 ETag. Production fence is `NOT_IMPLEMENTED`. | DO post-commit state write only; no second Journal append. | Reconstruct the projection only from independently authenticated Journal and matching R2 bytes; otherwise quarantine. | Deny Freshness until committed DO state agrees with the Release LP and R2 snapshot. | [protocol](./runtime-config-freshness-protocol.md); [test adapter](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-freshness-test-adapters.mjs). |
| R2 CAS recovery | Required: same DO recovery gate. Current Production gate: `NOT_IMPLEMENTED`. | Yes; keep writer pending and prevent a competing pointer mutation. | Original Release attempt ID and exact request digest; Production durable record is `NOT_IMPLEMENTED`. | Original expected ETag and candidate generation only; no increment during recovery. | Require exact current epoch/fence and pending attempt. Production fence: `NOT_IMPLEMENTED`. | Read R2; possibly retry the exact conditional pointer write after resolving the original outcome. | Exact pointer+snapshot match can advance recovery; prior pointer is safe only after the original request is definitively terminal. Otherwise remain `IN_DOUBT`. | Freshness stays denied while pointer outcome is ambiguous or inconsistent. | [R2 helper](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-r2-store.mjs); [test recovery](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-freshness-test-adapters.mjs). |
| Journal append recovery | Required: same DO gate and Journal provider. Current provider/status API: `NOT_IMPLEMENTED`. | Yes; do not admit another Release while exact append outcome is unknown. | Original attempt/append ID and byte-identical authorized record; provider exact lookup/retry is `NOT_IMPLEMENTED`. | Expected previous head and candidate generation must match the exact record position. | Validate current epoch and predecessor; no Production fencing is implemented. | Authenticated Journal query or exact idempotent append retry. | If the exact record is at the expected next position, proceed to DO projection; conflict, missing proof, or ambiguous head keeps quarantine. | Freshness denied until Journal head and current pointer are reconciled. | [protocol](./runtime-config-freshness-protocol.md); Production Journal is absent from [Worker bindings](../../FUSOU-TLSN-VERIFICATION-WORKER/wrangler.toml). |
| DO post-commit recovery | Required: same DO recovery gate, with Journal as commit authority. Current implementation: `NOT_IMPLEMENTED`. | Yes; recovery and ordinary Release/Freshness cannot mutate concurrently. | Original Release attempt ID; Production persistence is `NOT_IMPLEMENTED`. | Exact Journal generation, record digest, and matching R2 pointer/snapshot. | Check external incarnation and exact committed attempt; Production check is `NOT_IMPLEMENTED`. | DO projection write only, after reads outside the transaction. | Rebuild only from authenticated exact Journal record plus matching R2 state; do not append again. | Deny Freshness until the projection is repaired and the gate is safely cleared. | [test recovery](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-freshness-test-adapters.mjs); no Runtime Config DO binding in [Wrangler configuration](../../FUSOU-TLSN-VERIFICATION-WORKER/wrangler.toml). |
| Duplicate / retry | Required: same DO gate plus each external side-effect owner’s idempotency ledger. Production owners: `NOT_IMPLEMENTED`. | Yes; same ID+digest only; conflicting ID/body rejects. | Test `beginRelease` resumes the same `attempt_id`; P1 release contract has an attempt ID but no HSM/Journal exact-idempotency contract. | Preserve original generation and predecessor; never allocate a new generation for an unresolved retry. | Validate current incarnation/fence and exact digest; Production fencing is `NOT_IMPLEMENTED`. | Retry only exact R2/Journal/HSM operation with provider-supported idempotency. | Reuse exact durable output/result; no new signing or append on an ambiguous operation. | Freshness remains denied while a Release retry is unresolved. | [test adapter](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-freshness-test-adapters.mjs); [signer interface](../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/signers.ts). |
| Stale Worker / stale RPC | Required: DO validates a current external incarnation/fence on every operation; signer finalizer performs the same check. Current mechanisms: `NOT_IMPLEMENTED`. | Yes; stale deployments/callers must be rejected before external mutation and before output. | Stable operation ID plus signer/RPC request digest; P1 Freshness signer request has no operation ID/fence. | Compare to independently current Release generation and incarnation; a cached generation alone is insufficient. | External epoch + current fence required; neither is implemented. | Stale code could call an exposed R2 helper or return a delayed signer result if its credentials/path permit; actual reachability is `UNRESOLVED`. | Revoke/disable stale caller credentials and resolve its in-flight operations before re-enable. | Must not issue Freshness from stale state; no deployed gate exists to establish this today. | [signer interface](../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/signers.ts); [R2 helper](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-r2-store.mjs); [Worker entrypoint](../../FUSOU-TLSN-VERIFICATION-WORKER/src/index.ts). |
| Administrative mutation / alternate publisher | Required: Cloudflare account/IAM, Worker deploy, R2 credentials, and DO editor/restore authorities around the application gate. Actual principals: `UNRESOLVED`. | Yes; every privileged mutation must use the gate or force quarantine before/after mutation. Current control-plane enforcement is `UNRESOLVED`. | Audited admin change ID and target generation/digest required; not present in source. | Compare independently witnessed generation/head; a caller-chosen ETag is not authorization. | External epoch/fence and least-privilege credential control required; not implemented/verified. | R2 helper exports `createR2RuntimeConfigObjectStore()` and `createCloudflareR2RuntimeConfigObjectStore()`; their store exposes `compareAndSwapManifest()` without a registration assertion. | The regular `publishTlsnRuntimeConfig()` entry checks registration (currently false) and throws. The low-level capability can be called by code possessing the configured S3 credentials or injected client; repository search finds only helper definitions/tests, not a Production caller. Who holds credentials and whether other deployments exist is `UNRESOLVED`. | Direct pointer mutation can race Freshness unless every credential and alternate publisher is disabled or gated. | [R2 store](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-r2-store.mjs); [publisher](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-release.mjs); [registration](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-production-registration.mjs). |
| Restore / quarantine | Required: an independently administered restore controller/checkpoint owner and a universal traffic/signer gate. All are `NOT_IMPLEMENTED`. | Yes; quarantine before any restore or rollback-sensitive recovery and hold until independent reconciliation completes. | Restore event ID + new incarnation epoch; both are `NOT_IMPLEMENTED`. | Compare witnessed DO/Journal/R2 heads and operation-history watermark, not a restored DO generation alone. | Reject all old-epoch RPCs and outputs; verifier locations and epoch check are `NOT_IMPLEMENTED`. | DO PITR; any R2/Journal restore or privileged mutation must also be inventoried. | Advance external epoch, reconcile exact heads, resolve all `IN_DOUBT` operations, revoke stale callers, then dual-authorize re-enable. Missing evidence means remain quarantined. | Deny Freshness throughout quarantine and until all three authorities agree. | [DO PITR specification](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/); [DO roles](https://developers.cloudflare.com/workers/authorization/durable-objects/); no Production Runtime Config authority is in [Wrangler configuration](../../FUSOU-TLSN-VERIFICATION-WORKER/wrangler.toml). |

**Registration guard versus write capability:** `publishTlsnRuntimeConfig()`
calls `assertRuntimeConfigProductionSigningRegistered()` and currently
fails because registration is false. In contrast,
`createR2RuntimeConfigObjectStore()` accepts an S3 client, and
`createCloudflareR2RuntimeConfigObjectStore()` builds one from the
`TLSN_RUNTIME_CONFIG_R2_*` environment values (or accepts an injected client);
the returned object exposes `compareAndSwapManifest()`. Neither helper calls
the publisher registration assertion. The checked-in `rg` search found only
the helpers and test usages, not a Production caller. Source proves the
capability and its required credentials/client; it does not identify which
human, secret store, deployment, or external script possesses them. That
authorization inventory is **UNRESOLVED**. A conditional ETag CAS fences
concurrent writes to that pointer key, but it is not the Release LP or a
universal application gate.

**Coverage finding:** The test adapter demonstrates a single in-memory gate,
not Production route completeness. Gate/fence owners for all listed
Production mutations are `NOT_IMPLEMENTED`; administrative and external
credential reachability is `UNRESOLVED`. No pointer CAS is promoted to
`R_LP`, and DO `COMMITTED` remains post-commit state.

### 15.4 DO PITR anti-rollback candidates

DO transactions and strong consistency apply to the currently stored state;
they do not prevent an authorized PITR restore to an earlier state. A restored
database cannot determine from its own restored rows that it has moved
backward. Release LP ordering and anti-rollback are separate properties:
an external checkpoint can detect a DO head behind a retained witness, but
does not, by itself, prove whether `F_ISSUE_TIME` or `R_LP` happened first.

| Candidate | What it detects / replay coverage | Joint rollback and checkpoint protection | Availability, recovery, retention, cost |
|---|---|---|---|
| **R1 — Independent monotonic checkpoint** | Detects a DO head/epoch below an independently retained sequence/root. A Release-generation-only checkpoint does not detect reuse of a Freshness nonce or internal operation ID between Releases; it must cover the complete operation sequence/root to do that. | If DO and checkpoint roll back together, the rollback is invisible. The checkpoint needs a separately administered witness, quorum, or external publication whose own rollback is controlled. | Adds a remote check/write to protected transitions; outage must fail closed. A compact signed sequence/root may reduce storage, but proof data and audit retention remain required. |
| **R2 — External append-only operation journal** | Records each operation ID, epoch/role, request digest, state transition, external idempotency ID, and result digest; exact result bytes or a durable result reference are needed for exact retry. This is the strongest candidate for detecting old operation-ID/nonce reuse. | If this journal and DO are restored to mutually consistent old heads, the joint rollback is not detected without an independent checkpoint/witness. Append-only semantics and exact lookup are provider requirements, not assumptions. | Highest write and retention burden; every HSM/R2/Journal side effect needs a prepared/completed protocol. Journal or witness outage blocks issuance/release. |
| **R3 — External restore/incarnation epoch** | An epoch outside DO SQLite, included in all internal authenticated operation/HMAC inputs, fences old packets after an epoch advance. A public Freshness response needs a verifiable binding if APP is expected to validate that epoch. | An epoch authority that shares DO restore/admin control can itself roll back. Epoch change alone does not detect an unannounced restore or stop a semantic duplicate re-signed under the new epoch; pair it with operation history. | Low data retention, but requires coordinated deployment and key/verifier rollout. Re-enable waits until every caller rejects old epochs and exact in-flight results are resolved. |
| **R4 — Mandatory restore quarantine** | Stops known callers/signers before a planned restore and keeps routes disabled until Journal/R2 reconciliation, epoch/key transition, and signer `IN_DOUBT` resolution complete. | Does not detect an unannounced restore, compromised control plane, or administrator bypass. The quarantine control must be outside the restored DO and independently enforced. | Human-intensive and reduces availability during restore. Requires two-person approval, audited runbook, controlled credentials, and tested re-enable criteria. It is not standalone anti-rollback protection. |

#### Eight independently evaluated restore states

The Production Journal, external operation log, checkpoint, witness, and
incarnation-epoch service below are not registered: each is
`NOT_IMPLEMENTED`. “Detected” therefore describes what evidence could show
under the stated independent-source condition, not a current runtime
capability.

| State | Observable evidence | Independent comparison source | Detection result | Replay risk | Required quarantine | Safe recovery | Residual uncertainty |
|---|---|---|---|---|---|---|---|
| 1. DO only rollback | Restored DO rows may be internally consistent but show an older generation, tombstone set, or operation result. | Current authenticated Journal/R2 head plus an operation-history checkpoint outside the DO. | Detectable only if an independent head/sequence advanced and is not in the same rollback domain. The DO ledger alone cannot detect its own rollback. | Old operation IDs/nonces absent from restored rows may be accepted again. | Deny Freshness, Release, and signer-output RPCs until comparisons complete. | Rebuild the DO projection from exact authenticated external records; advance/check incarnation epoch; resolve pending results. | No Production Journal/checkpoint is implemented; R2 alone is mutable state and does not prove operation history. |
| 2. DO and R2 disagree | DO generation/ETag/digest differs from current R2 pointer or referenced snapshot. | Exact R2 GET/HEAD and immutable snapshot bytes; authenticated Journal if available. | Mismatch is observable, but which state is authoritative is not established by the disagreement itself. | Freshness could bind stale DO state or a pointer to a different Manifest if the gate is bypassed. | Keep writer and Freshness gates closed; prohibit pointer repair by an uncoordinated writer. | Repair only after the exact Journal commit record identifies the intended generation and R2 bytes can be verified; otherwise operator investigation. | No Production authority contract proves a precedence among conflicting stores. |
| 3. DO and Journal disagree | DO committed projection differs in generation, record digest, epoch, or exact bytes from Journal head. | Authenticated, linearizable Journal head/record and independent checkpoint. | Detectable if Journal is current and independent. If Journal and DO share a rollback domain, comparison can be false reassurance. | Restored DO may reissue old Freshness or retry an already-used Release attempt. | Block Freshness and new Releases; admit only fenced recovery. | Project exact Journal record into DO only after matching the referenced R2 pointer/snapshot and verifying the record/append metadata. | Journal provider, trusted append time, rollback behavior, and witness are unselected. |
| 4. DO and R2 rollback; Journal advances | DO and pointer show an older Manifest while Journal reports a later committed Release. | Authenticated Journal record/sequence plus the record's content-addressed Manifest and independent witness. | Mismatch is detectable if the Journal and witness are genuinely outside the DO/R2 rollback domain. | Old Manifest could be served if Freshness trusts rolled-back DO/R2. | Keep Freshness and all pointer writers quarantined. | Retrieve the exact Manifest by signed/content-addressed ref, verify its digest and Release record, then repair R2/DO under the same gate. | R2 restoration behavior, immutable retention, and Journal independence are not configured/verified. |
| 5. DO and Journal rollback; R2 advances | DO/Journal show older head while R2 pointer or snapshot appears newer. | Independent checkpoint/witness; R2 is only a comparison source unless its admin/restore domain is proven independent. | A mismatch is observable, but R2 alone cannot prove a committed Release or its order. | Old Release attempt IDs may be replayed; a newer R2 object might be an uncommitted candidate or unauthorized write. | Quarantine; do not promote the R2 pointer or roll it back based only on ETag. | Require a witnessed Release record for the newer generation; otherwise reconcile with operators and remain blocked. | No current authenticated Journal exists; whether R2 and Journal share administration/rollback control is `UNRESOLVED`. |
| 6. DO, R2, and Journal roll back together | All three appear mutually consistent at a prior generation. | Independent operation-history checkpoint and a separate witness outside all three rollback domains. | Undetectable if every source and checkpoint restores to the same prior state. A DO-internal ledger cannot detect this. | Every deleted nonce, operation ID, fence, and tombstone may be replayable. | Full quarantine; do not infer safety from cross-store agreement. | Recover from externally retained history, verify all nonterminal signer/provider operations, advance epoch, and dual-authorize re-enable. | No witness/provider or independent-admin boundary is selected; common-mode rollback is a hard blocker. |
| 7. Restored DO receives old-incarnation RPC | RPC has a valid old MAC/signature but carries an obsolete or absent incarnation epoch. | External monotonic epoch authority plus its independently protected checkpoint/witness. | Rejectable only if every DO ingress, Worker, signer, callback, and output finalizer checks the current epoch. This is `NOT_IMPLEMENTED`. | Old authenticated packets may reapply old operations; key rotation alone does not prove the operation was unused. | Keep all callers/output paths quarantined until epoch propagation is verified. | Epoch **issuer** must be a human-approved external authority; **storage** must be outside DO/R2 rollback and separately witnessed; **verifiers** must be every RPC ingress and finalizer. None is selected or implemented. | No concrete issuer, storage, witness, verifier coverage, or APP-visible receipt exists. |
| 8. Old operation ID / nonce / fence is reused after restore | Incoming operation ID/digest/fence may match a pre-restore request whose tombstone was lost. | Complete external operation log or witnessed monotonic sequence covering every operation ID/nonce and digest, not only Release generations. | Detectable only if that history is retained and independently current. Key rotation without history does not detect semantic reuse. | Duplicate HSM signing, Release append, or Freshness response can occur under a new key/epoch if policy permits reuse. | Reject every old/unknown operation until the history watermark and current epoch are checked. | Exact old operation must resolve to its retained result/terminal state; otherwise keep `IN_DOUBT` and quarantine. Do not mint a new ID to bypass it. | Operation ID/nonce retention, history compaction, checkpoint rollback, and quorum policy remain `UNRESOLVED`. |

Checkpoint and witness administration must be independent in both permission
scope and rollback domain. Two records controlled by the same account,
operator, restore workflow, or credentials are not independent witnesses.
The checkpoint itself needs its own monotonic protection; otherwise its
rollback recreates the same blind spot.

Quarantine can be released only by the approved restore authority plus a
separate reviewer after they verify: the current witnessed epoch/checkpoint;
authenticated exact Journal records and append positions; matching R2 pointer
and immutable snapshot bytes; no unresolved HSM/R2/Journal operation; old
Worker versions and credentials cannot act; every verifier enforces the new
epoch; and replay tests reject prior IDs/nonces/fences. Those authorities,
proof records, and permission separation are not present in current source,
so no presently available evidence authorizes quarantine release.

Key rotation alone is insufficient: it may reject old MAC bytes only after
every verifier/caller stops accepting the old key, but it cannot reconstruct
deleted tombstones or prove that a semantic operation was not already used.
The current P1 delegation mode is expiry-based; rotation does not retroactively
invalidate a signature already made under a still-accepted delegation. The
APP's request nonce, response lifetime, signature checks, and local high-water
state remain useful acceptance checks, but they are not an external Worker
operation ledger.

**Minimum combined recovery candidate (not selected):** independent
incarnation epoch + per-operation external journal/checkpoint + a separately
controlled witness + mandatory restore quarantine + exact result retention
or a proved monotonic watermark. If the operation journal and DO are restored
together without an independent witness, prior operation IDs/nonces may be
replayed undetected. After restore, old HMAC packets must fail the epoch
check; old signer responses must be blocked by the universal finalizer and
the current APP challenge/validity checks. A key change by itself proves
neither condition.

The controlled restore exit condition must require: callers and signer
submission/output routes are quarantined; the external checkpoint and
Journal/R2 heads are authenticated and reconciled; the restore epoch is
advanced outside DO state; every old key/Worker generation is prevented from
authorizing new work; every pending HSM/R2/Journal operation is resolved by
exact status/result evidence or remains blocked; and replay tests show old
operation IDs and HMAC packets are rejected. If any evidence is unavailable,
quarantine remains active.

### 15.5 HSM delayed result and `IN_DOUBT` recovery

The P1 signer contract exposes a Promise returning signature/result bytes but
does not carry a durable operation ID, request digest, provider job ID,
status-query contract, or cancellation receipt. No HSM provider is selected;
cancellation, idempotency, status query, and exact-result retrieval are all
`NOT_VERIFIED`. Consequently, a Worker timeout, disconnected RPC, deployment,
or DO restart cannot distinguish “HSM never accepted the request” from
“signature exists but its response is delayed/lost.”

| Signer event | Required state/evidence | Permitted action |
|---|---|---|
| Before remote submission | Persist operation ID, signer role/key ID, epoch/fence, exact canonical signing-preimage digest, challenge/attempt binding, and `SUBMISSION_PENDING`. | Submit only the exact persisted operation. |
| Provider may have accepted work; caller times out/crashes | Mark or retain `IN_DOUBT`; keep the relevant issue/Release gate. Timeout is not cancellation, and a restarted caller must query the same operation ID. | No new operation ID, changed timestamp/payload, direct response, or gate release. |
| Signature generated or received | Bind bytes to the operation ID and preimage digest; validate the returned signature and expected key/domain. | Do not treat generation, network receipt, or local validation as permission to deliver or as Release LP. |
| Logical finalization | A universal output gate verifies current epoch/fence, operation identity/digest, current state, response validity, and exact result, then durably stores the exact response/result before returning it. | On exact retry, return those exact stored bytes. Never re-sign a finalized or ambiguous operation. |
| Provider cancellation/status | Require a provider-defined terminal result that proves no signature/result can later be retrieved or delivered, and that status survives provider restart. | Only then may physical cancellation support clearing the pending operation. A best-effort cancel ACK is insufficient. |
| APP response delivery/acceptance | Delivery may fail after finalization. APP independently checks its outstanding nonce, audience, signature/delegations, time bounds, current local high-water state, and its own deadline. | Response loss retries retrieve the exact finalized bytes; APP acceptance is not evidence that the DO ledger is rollback-resistant. |

Physical HSM quiescence and logical non-delivery are different claims. A
provider may continue signing after a caller timeout; that can be safe only
if every route from provider result to APP is behind a stateful, universal
finalizer and stale results can never bypass it. A DO-only finalizer is not
rollback-resistant under PITR. The signer/gateway boundary, direct HSM
bindings, queues/callbacks, and admin access must therefore be part of the
trusted computing base. Current source does not prove a universal finalizer
or exclude a route that returns a raw signature; that bypass possibility
remains **UNRESOLVED**.

| Recovery candidate | Safety contribution | Remaining blocker |
|---|---|---|
| Provider cancellation with terminal acknowledgement | Could prove physical work/result delivery stopped if the provider contract is explicit, durable, and queryable by stable operation ID. | No provider/API is selected; cancellation semantics are **NOT_VERIFIED**. |
| DO fence plus mandatory output finalizer | Can provide logical non-delivery of a late result while leaving HSM work physically running. | Current signer interface has no operation/fence fields, no universal route is implemented, and DO PITR can restore the fence. This alone is insufficient. |
| Durable signer operation ledger | Can support exact retry and distinguish pending/completed/canceled outcomes if it retains the exact result. | A DO-only ledger can roll back; a signer-memory ledger is lost on restart. Independent anti-rollback is required. |
| Operation ledger + external witness + universal finalizer | Can combine result recovery, replay detection, and logical output fencing; physical cancellation need not be assumed if no output bypass exists. | Adds a new trust root, availability dependency, retention cost, and APP receipt/wire changes if APP must verify a new LP receipt. Provider and policy remain **UNRESOLVED**. |

For Release, unresolved signing or Journal outcomes keep `writer_pending`
active; for Freshness, a late result must pass the post-sign lease/fence
check and finalizer or be discarded. `F_HSM` is not `R_LP` or `F_ISSUE_TIME`.
`F_OUTPUT_FINALIZE` is not automatically rollback-resistant. The status
`IN_DOUBT` has no safe time-based TTL under the current evidence.

### 15.6 Cross-scenario failure review

The following ten cases are distinct. All Production gate/fence/checkpoint
mechanisms noted as required remain `NOT_IMPLEMENTED` unless explicitly
described as test-adapter behavior.

#### 1. Freshness issue is active when Release starts

- **Initial state:** DO/Journal/R2 agree at generation N; a Freshness issue has acquired its lease for N.
- **Event sequence:** Release request sets `writer_pending` while signing/current-state verification may still be in progress.
- **Safety risk:** R2 CAS or `R_LP` before the issue's required post-sign lease check could make the issued bytes inconsistent with `LATEST_AT_ISSUANCE`.
- **Current source can prevent:** The in-memory adapter serializes `acquireIssueLease` and `beginRelease`; issue-first makes Release wait, and a delayed test signature is rechecked.
- **Current source cannot prevent:** No Production DO gate is bound to the Worker; the adapter cannot enforce all R2 writers or stop a remote HSM result.
- **Required gate / fence / checkpoint:** One per-environment atomic gate; exact lease/attempt IDs and current generation; no R2/Journal mutation until the issue is terminal or logically revoked by a universal finalizer.
- **Safe recovery conditions:** Complete and post-sign-check the same issue before Release proceeds, or prove that every output path rejects its revoked fence.
- **Recovery impossible / quarantine conditions:** Lease state was PITR-restored, signer outcome is `IN_DOUBT`, or an alternate writer may have mutated the pointer; keep both issuance and Release side effects quarantined.

#### 2. Worker crashes after Release R2 CAS

- **Initial state:** `R_PREPARE` and pointer-write intent exist; conditional R2 CAS may be in flight or may have committed.
- **Event sequence:** R2 accepts or rejects the pointer CAS, then the Worker crashes before persisting readback.
- **Safety risk:** A retry or competing writer may overwrite a committed candidate or mistake a negative read for proof that the original request failed.
- **Current source can prevent:** The R2 helper reconciles ambiguous responses while its call is alive; the in-memory adapter has a simulated crash-after-CAS recovery path.
- **Current source cannot prevent:** No durable Production attempt state or cross-Worker recovery authority exists. An R2 negative read cannot rule out a prior in-flight write.
- **Required gate / fence / checkpoint:** Persist the exact attempt ID, expected ETag/generation, pointer-write-started bit, and incarnation fence before I/O; hold the writer gate.
- **Safe recovery conditions:** Exact candidate pointer and immutable snapshot match the attempt, or the original CAS is definitively terminal and the exact retry is allowed.
- **Recovery impossible / quarantine conditions:** Pointer result remains ambiguous, another generation appears, or DO and R2 disagree without authenticated `R_LP`; do not clear the gate.

#### 3. Journal append succeeds, then DO update fails

- **Initial state:** Exact authorization is durably associated with one pending attempt; R2 points at its candidate; Journal head is the prior generation.
- **Event sequence:** Journal append commits `R_LP`; the ACK or following DO `COMMITTED` transaction fails.
- **Safety risk:** A replacement Release may append twice or Freshness may use a stale DO projection.
- **Current source can prevent:** The test adapter's recovery checks exact record bytes/generation and matching R2 state before completing the DO projection.
- **Current source cannot prevent:** The adapter is in-memory; no Production Journal, durable DO, append receipt, or exact provider lookup is registered.
- **Required gate / fence / checkpoint:** Keep `writer_pending`; bind the original attempt and exact record digest; treat Journal as commit authority only after provider authentication and rollback protection.
- **Safe recovery conditions:** Read the exact record at the expected Journal position, verify signature/append metadata and R2 snapshot, then project that same record into DO without another append.
- **Recovery impossible / quarantine conditions:** Journal head is ambiguous, record conflicts with pending bytes, or its trusted position/time cannot be established; Freshness and new Releases remain blocked.

#### 4. DO PITR is followed by resubmission of an old Release operation

- **Initial state:** A Release operation ID, predecessor, or terminal tombstone existed after the PITR restore point; restored DO no longer shows it.
- **Event sequence:** An old Worker/RPC resends that operation using its old authenticated packet or reuses its ID.
- **Safety risk:** A duplicate pointer change, signature, or append can occur if the old ID appears new in restored state.
- **Current source can prevent:** Test-adapter checks reject a conflicting pending attempt and verify expected generation/record digest within its current memory state.
- **Current source cannot prevent:** No Production restore epoch or operation-history witness exists; DO-local state cannot detect its own rollback.
- **Required gate / fence / checkpoint:** External incarnation epoch on every authenticated operation plus a retained operation-ID/request-digest ledger and independent witness.
- **Safe recovery conditions:** Compare old ID/digest against witnessed history; return the retained exact terminal result or reject it, then reconcile Journal/R2.
- **Recovery impossible / quarantine conditions:** History/witness is unavailable or jointly rolled back, or old credentials can bypass the epoch check; do not execute the RPC.

#### 5. DO PITR is followed by resubmission of an old Freshness issue RPC

- **Initial state:** A Freshness challenge/issue record or tombstone may have existed after the restore point; restored DO has no such record.
- **Event sequence:** The old issue request is replayed to a Worker whose current-state view is also restored or stale.
- **Safety risk:** Re-signing the same internal operation or stale release state can produce an unauthorized delayed result; replaying an old response against a different APP request must also be rejected.
- **Current source can prevent:** APP verifies the current outstanding `request_nonce`; a response for a different nonce does not satisfy that challenge. The test adapter validates a current lease/head and post-sign lease again.
- **At the Section 15 source baseline:** the P1 signer request had no durable issue operation ID/fence, and no Production DO replay ledger or PITR epoch was present. A valid late response for the same outstanding nonce was not distinguished by a durable operation ledger. The later shared-core status is recorded in Section 16; Production durability remains unimplemented.
- **Required gate / fence / checkpoint:** External epoch and full issue-operation ledger, checked at signer ingress and the universal output finalizer; preserve exact response bytes for exact retry.
- **Safe recovery conditions:** Reject an old epoch or return the exact previously finalized result for the same operation; APP must still accept only its outstanding nonce and valid time window.
- **Recovery impossible / quarantine conditions:** Epoch/history is missing or a late signature can bypass finalization; do not issue or deliver a replacement response.

#### 6. HSM returns a delayed signature after timeout

- **Initial state:** Sign request may have reached HSM; caller has timed out and cannot determine whether signature bytes exist.
- **Event sequence:** HSM completes later and returns the signature to a restarted Worker, callback, or queue.
- **Safety risk:** Stale Release authorization or expired-lease Freshness bytes may be returned after the operation/gate was considered finished.
- **Current source can prevent:** Test adapter rechecks the issue lease and response/delegation time after its simulated signing delay.
- **Current source cannot prevent:** No HSM provider is selected; cancellation, idempotency, status query, and exact-result retrieval are `NOT_VERIFIED`. Test callback is not physical HSM cancellation.
- **Required gate / fence / checkpoint:** Stable operation ID/preimage digest, durable `IN_DOUBT`, current epoch/fence check, and universal output finalizer. Physical cancel is optional only if logical non-delivery is proved.
- **Safe recovery conditions:** Query/retrieve the exact operation, validate its result, and finalize only if current policy permits; otherwise prove every delivery path rejects it.
- **Recovery impossible / quarantine conditions:** Provider status is unknown and a bypass around finalizer cannot be excluded; retain `IN_DOUBT` without a time-based TTL.

#### 7. A second Worker recovers the same operation after the first crashes

- **Initial state:** Worker A may have submitted one external side effect; its durable operation/result status is unknown to Worker B.
- **Event sequence:** Worker B retries after A crashes or loses its RPC response.
- **Safety risk:** B may repeat HSM signing, R2 CAS, or Journal append with new bytes/IDs while A's result is still in flight.
- **Current source can prevent:** The test adapter uses an attempt ID, reuses persisted authorization bytes, and reconciles selected simulated R2/Journal states.
- **Current source cannot prevent:** Those states are in-memory/test-only; P1 signer and external-provider contracts do not establish cross-Worker idempotency or exact status retrieval.
- **Required gate / fence / checkpoint:** Shared durable operation ID+digest, one recovery owner/fence, provider idempotency/status, and external anti-rollback witness.
- **Safe recovery conditions:** B reads the same operation record and returns/reconciles the exact prior result; only one owner may advance its state.
- **Recovery impossible / quarantine conditions:** Provider cannot identify the original operation or exact result; B must not resubmit a semantically changed operation.

#### 8. `IN_DOUBT` Freshness issue remains while Release is requested

- **Initial state:** Freshness signing may be in flight or have produced an undelivered result; no terminal status/finalization evidence exists.
- **Event sequence:** Release tries to set `writer_pending` or advance R2 while the Freshness issue outcome is unresolved.
- **Safety risk:** Release could advance while a stale signer result remains deliverable, or Freshness could be acknowledged without knowing whether the post-sign lease check/finalizer ran.
- **Current source can prevent:** Test adapter holds/releases an in-memory lease and rejects a delayed signature after the lease expires.
- **Current source cannot prevent:** There is no Production `IN_DOUBT` record, HSM status contract, universal finalizer, or proof that late output cannot bypass the DO.
- **Required gate / fence / checkpoint:** Persist nonterminal issue state; Release waits until exact issue completion or logical revocation under an independent current fence.
- **Safe recovery conditions:** Exact terminal provider status/result is known, or rollback-resistant finalization guarantees late bytes cannot be delivered; then clear only the matching operation.
- **Recovery impossible / quarantine conditions:** Neither condition can be proved. The issue may block Release indefinitely; no automatic TTL is permitted.

#### 9. Release recovery and Freshness recovery start concurrently

- **Initial state:** Release recovery has an ambiguous external step while a Freshness retry/recovery is also requested.
- **Event sequence:** Both Workers read state and attempt R2/Journal/signer operations before either recovery is recorded as owner.
- **Safety risk:** Recovery can race itself, duplicate external effects, or allow Freshness against an unreconciled Release head.
- **Current source can prevent:** Test adapter `beginRecovery` sets `recovery_pending`/`writer_pending` and denies new issue leases in its single in-memory coordinator.
- **Current source cannot prevent:** No Production coordinator or cross-Worker recovery lock exists; recovery precedence/ownership is not specified by a provider contract.
- **Required gate / fence / checkpoint:** One durable recovery owner and epoch/fence, serialized transitions, and one external call at a time with persisted intent.
- **Safe recovery conditions:** Admit one exact recovery operation; Freshness remains denied until Release/R2/Journal agree. The policy choosing recovery priority must be human-approved.
- **Recovery impossible / quarantine conditions:** Both recovery attempts may have performed side effects or their owner/fence cannot be identified; freeze both and reconcile externally.

#### 10. DO, R2, and Journal state are mutually inconsistent

- **Initial state:** Current DO projection, R2 pointer/snapshot, and Journal head do not agree in generation, digest, ETag, or exact record.
- **Event sequence:** Freshness, Release, or repair is requested while no provider-independent ordering proof identifies the authoritative result.
- **Safety risk:** Majority voting or selecting the newest timestamp can expose an uncommitted Manifest, erase a committed Release, or sign stale Freshness.
- **Current source can prevent:** Test adapter checks for head/pointer/DO mismatch and fails closed before its simulated issue/commit transitions.
- **Current source cannot prevent:** No Production Journal/trusted append metadata or rollback witness exists to adjudicate conflicts.
- **Required gate / fence / checkpoint:** Quarantine every writer and issue route; compare against an independent authenticated Journal/checkpoint and exact immutable bytes.
- **Safe recovery conditions:** A verified `R_LP` record and independent position identify the committed generation, and its referenced R2 snapshot can be validated before repairing projections.
- **Recovery impossible / quarantine conditions:** Journal authority, trusted append position, or witness is ambiguous or rolled back with the other stores; remain quarantined for human investigation.

### 15.7 Recovery order, decisions, and readiness

Implementation remains blocked until the following dependency order is
approved and evidenced:

1. Human owners select the normative eight-second interpretation without
   silently treating the maximum as an SLO; define the permitted behavior
   when the HSM has not quiesced by the lease boundary.
2. Inventory all Worker deployments, DO bindings, R2 write credentials,
   Journal writers, signer routes/callbacks, restore operators, and Data
   Studio/editor roles. Establish that all authoritative mutations enter
   one gate or are disabled during quarantine.
3. Select and verify a Journal/sequencer contract: authenticated head,
   atomic compare-and-append, exact record retention, trusted append metadata,
   linearizable concurrent semantics, exact idempotent retry, conflict
   rejection, and rollback detection/protection.
4. Select independent anti-rollback state and its own witness/quorum,
   operation-ID/nonce retention policy, restore epoch owner, and quarantine
   authority. Prove what happens if any two resources, including the
   checkpoint and DO, are restored together.
5. Define Release and Freshness operation schemas, IDs, canonical digests,
   fences/epochs, exact result retention, `IN_DOUBT` state transitions,
   and safe recovery for ambiguous HSM, R2, Journal, and DO responses.
6. Require the universal finalizer and prove that no Worker, callback, queue,
   deployment, or administrator can return a raw HSM result around it.
   If a selected LP requires a receipt at APP, obtain explicit wire and
   trust-root approval before changing the APP contract.
7. Implement only after approval, then add real Cloudflare DO concurrency,
   restart/PITR, R2 ambiguity, Journal ACK-loss, signer-delay, stale-packet,
   and alternate-writer fault-injection tests. Test-only adapters are not
   substitutes for these checks.
8. Re-audit readiness independently. No Production acceptance follows from
   implementation or CI alone; external Notary/Game Server and real
   Production evidence remain separate acceptance work.

Human approval is required for the LP model, eight-second enforcement,
Journal/sequencer and trusted-time root, checkpoint/witness administration,
restore/quarantine authority, signer/HSM operation semantics, key/epoch
rotation and retention, administrative permission boundary, and any APP
wire/receipt change. Existing TLSN Result keys or verification callback
secrets must not be reused for Runtime Config authority.

**Readiness at this historical review:** Production Freshness **BLOCKED**;
Production Release Journal and Runtime Config authority
**NOT_IMPLEMENTED**; Stages A, B, and C **BLOCKED**; Production acceptance
**BLOCKED**. Normal APP/game traffic was not made dependent on this
unimplemented Runtime Config path by that documentation review. The
implementation and verification status is updated in Section 16.

## 16. Current issuer-core implementation update

This update supersedes earlier P1 interface and “no local issuer core”
statements in this document. It does not change the Freshness APP wire
schema, signature domain, or Production registration.

| Area | Current contract or source status | Evidence boundary |
|---|---|---|
| Time limits | APP request/verification deadline remains 10 seconds; Gateway HTTP deadline remains 7 seconds; Freshness issue lease is at most 8,000 ms and is an authorization bound, not an SLO. Lease validity is checked before signing and again before finalization. | Production monotonic-clock behavior and enforcement are not selected or verified. Lease expiry, caller abort, HTTP disconnect, and timeout do not prove signer quiescence or release an unresolved coordination blocker. |
| Request binding | Shared domain contracts now bind a stable issue operation ID to the canonical challenge/request digest, nonce, environment/audience, and expected operation. The issuer core obtains current-state evidence from its injected trusted-state adapter and checks that evidence against the request; an input `verified` or `production` declaration is not accepted as proof. | These are internal contracts. No APP wire field or signature domain was added. TypeScript types alone are not runtime evidence. |
| Lease and generation | The issue lease, clock reading, current Release state, generation/head, and fence are obtained through injected adapters and rechecked after signing. The signer result is bound to the operation and exact response bytes/digest. | The fake clock, fence, and state evidence verify local transition logic only; they do not establish Production time, Journal, or anti-rollback guarantees. |
| Finalization | The core verifies the signed response with the existing Freshness verifier and returns only the exact bytes accepted by successful finalization. A mismatch, expired lease, changed state, stale fence, or unknown persistence result returns no response bytes and retains an unresolved/unknown blocker. A caller abort alone does not clear it. | This is logical output fencing in the provider-independent core, not physical HSM cancellation and not proof that an external result cannot exist. |
| Duplicate and recovery behavior | A repeated operation ID with a different request is rejected. Re-entry for the same operation does not automatically invoke signing again; only a matching durably finalized exact result can be returned. Pending or ambiguous outcomes remain nonterminal across the local restart model. | Local snapshot/restart tests use injected in-memory state. They do not prove cross-isolate durability, Production restart behavior, or rollback resistance. |
| Provider boundary | The core defines adapter requirements for current-state verification, bounded clock evidence, operation admission, lease/fence revalidation, exact result persistence/retrieval, and atomic finalization. Unknown write/append outcomes must fail closed. Production adapters must also serialize against Release updates and provide an independent anti-rollback witness/checkpoint. | No Production Durable Object, Journal/sequencer, HSM, clock provider, witness, key provider, or route was selected or registered. Restoring a DO and its same rollback domain is not an independent witness. |
| Local tests | Domain issuer-core tests cover finalized exact-byte return, invalid request/state/lease/operation bindings, duplicate IDs, state or lease changes during signing, unknown finalization, restart-pending state, delayed results, caller abort, and local witness mismatch. | The domain suite passed 24 tests; domain typecheck passed; existing Worker Freshness regressions passed 42 tests. These are local results, not Hosted CI or Production evidence. |
| Readiness | The local issuer core is implemented and locally verified. Production Freshness/Release authority, independent external material, execution-receipt completeness, complete-bundle remote delivery, and real-service verification remain unimplemented or unverified. | Hosted CI is **NOT_CHECKED**. Stage A/B/C and Production acceptance remain **BLOCKED**. |

The former Section 15.7 recommendation to obtain a human decision about
whether the eight-second maximum is an SLO is superseded: it is not an SLO.
The unresolved Production question is how a selected provider proves and
enforces the lease's bounded clock and what safe recovery is possible when
external signing work remains in doubt. No time-based cleanup may erase that
blocker. The local map-backed restart and rollback-witness tests are candidate
coordination models only, not evidence of Production persistence or PITR
resistance.

The next Production implementation unit remains provider selection and
registration under explicit approval: a durable operation/finalization
adapter, a Release-serialized Journal and independent rollback witness, and a
clock/signer adapter with the required operation-status and exact-result
semantics. Until those dependencies are selected and verified, the
Production path must fail closed.
