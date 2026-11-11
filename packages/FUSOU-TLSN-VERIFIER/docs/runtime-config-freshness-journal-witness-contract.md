# Freshness Journal and Independent Witness Contract

**Status: contract investigation and implementation proposal. No Production
provider or trust root is approved by this document.**

**Profile scope:** this contract defines the independent Journal/witness
requirements of `strict-journal-witness-v1`. The local
`cloudflare-operator-v1` profile does not satisfy or return this external
witness proof type and does not claim independent rollback detection. It uses
a distinct operator Release-state verifier and remains subject to its own
explicit profile/environment/chain binding. Strict witness absence continues
to fail closed; there is no profile fallback.

The earlier AWS/DynamoDB prototype recommendation below is an unadopted
historical candidate, not a required next step. The current Cloudflare-first
trust-model proposal is in
[runtime-config-freshness-contract-revision-proposal.md](./runtime-config-freshness-contract-revision-proposal.md).

**Historical snapshot (2026-11-09):** branch
`tlsn-first-testplay-candidate` at
`8a87314a055f45d37f1ae5b0524561575ab9b7ea`; Hosted run
[#115](https://github.com/tsukasa-u/FUSOU/actions/runs/42484486660) passed
three jobs for that baseline. At that snapshot the reader changes recorded
here were uncommitted and post-change Hosted CI was **NOT_CHECKED**.

**Current Hosted status (2026-11-10):** run
[#116](https://github.com/tsukasa-u/FUSOU/actions/runs/42638941184), attempt 1,
passed all three jobs for
`69d30a7b1e3c62ae06018e405af019c3a3fba727`. This updates CI evidence only;
the current Journal/witness trust decision, provider registrations and
Production acceptance remain unresolved or **BLOCKED**. See the current
[contract proposal](./runtime-config-freshness-contract-revision-proposal.md)
and [readiness status](../FIRST-TESTPLAY-READINESS.md) for the run details.

## Decision summary

The Release Record signature proves that an authorized Release Authority
signed those exact bytes. It does not prove that the record was appended,
that it won a unique append position, or that it is the current head.
Likewise, an append receipt proves only the claims it authenticates; it does
not prove that no later record exists.

For `strict-journal-witness-v1`, the required authority chain is:

1. A root-pinned Release delegation authorizes an exact Release Commit Record
   for `production`.
2. One canonical Journal atomically commits the exact Record and delegation
   reference against the expected previous head.
3. An authenticated append receipt binds the Record to a unique chain
   position, predecessor and bounded append time.
4. A separate fresh read proves that this committed Record is still the
   Journal head for the current issue operation.
5. An independently administered witness proves that the Journal head and
   restore epoch have not fallen behind its retained high-water checkpoint.
6. The SQLite Coordinator, R2 pointer, immutable Manifest and Manifest
   signature agree with that same Release.

Provider guarantees must be evidenced independently of this application
logic. The signed test fixtures are models of the contract, not Production
proof formats.

### Current status vocabulary

| Status | Meaning here |
|---|---|
| **VERIFIED** | The checked-in reader rejects a mismatch against the configured adapter output and exact bytes; local test-only proofs exercise that behavior. |
| **OBSERVED** | A capability or limitation is explicitly stated in the cited provider documentation. |
| **UNVERIFIED** | No provider-specific evidence currently proves the required Production guarantee. |
| **NOT_IMPLEMENTED** | There is no registered Production adapter, trust pin, credential, or operational path in the repository. |
| **NOT_CHECKED** | No post-change Hosted CI or live provider verification was performed. |
| **BLOCKED** | The system must not issue Production Freshness or claim Production acceptance. |

Repository source and configuration contain the DO Coordinator and R2
Manifest paths, but no approved Release Journal, append-time service, or
independent rollback-witness registration. The provider-neutral verifier
interfaces are not provider approval.

## Required Journal contract

### Canonical append

The Journal's successful compare-and-append transaction is the Release
commit linearization point. The Release Authority signature is an
authorization artifact, not a commit point.

| Claim | Required binding |
|---|---|
| Chain identity | A configured, pinned `chainId` and `environment=production`; values in a response cannot select their own trust domain. |
| Unique position | A canonical, monotonically increasing Journal position. The Journal must atomically compare the expected previous position and head digest. |
| Exact bytes | The committed entry is the exact canonical Release Commit Record bytes and exact delegation reference/bytes. Re-encoding, re-signing, or substituting a semantically equivalent JSON object is not the same append. |
| Release generation | `commit_generation` advances exactly by one; `previous_commit_generation` and `previous_commit_record_sha256` match the actual preceding committed Release. |
| Record identity | The receipt binds `release_commit_id`, SHA-256 of exact Record bytes, delegation digest, generation, Manifest epoch/digest/reference, and pointer ETag. |
| Concurrency | Two appends against the same expected head cannot both commit. One wins; the other returns a definite conflict or an outcome that remains unknown until reconciled. |
| Commit outcome | A signed Record without a successful append is never `COMMITTED`. The Journal's own linearized commit—not the signer or Coordinator—defines the Release. |

A provider transaction must create the immutable Record/operation entry and
advance the canonical head atomically, or provide an equivalent documented
linearization point. A two-object protocol without an atomic head CAS is not
sufficient.

### Append receipt and time

The receipt verifier must authenticate and bind at least:

- pinned provider, chain and environment;
- operation ID (`release_commit_id`) and exact Record/delegation digests;
- unique head position, generation and previous Record digest;
- `appended_at`, its trusted time-source identity and uncertainty;
- any provider request/transaction identifier needed to resolve an
  ambiguous result.

The append time is not a caller-supplied timestamp or an ordinary database
attribute. The verifier must pin the authority that authenticates it. The
entire uncertainty interval must be within the Release delegation's validity
window and must not precede the signed `authorized_at`. If time-source
uncertainty crosses either boundary, verification rejects.

The current reader now requires the verifier output to name the configured
append-time source and uncertainty. It checks that interval against the
verified delegation. This is an adapter contract, not evidence that any
Production time source exists or is trusted. The issue lease clock must also
be Production-trusted; the current local clock fixtures do not establish that.

### Current-head proof and stale-read resistance

An append receipt or a correctly signed old head is not a current-head proof.
The Journal must provide either:

1. a provider-authenticated, linearizable uncached current-head read, bound by
   the adapter to this request; or
2. a cryptographic current-head proof that binds a fresh request challenge and
   can be verified under an externally pinned trust root.

The per-read context is bound to:

- `environment`, pinned `chainId`, issue operation and signer-operation IDs;
- request digest and request nonce;
- lease ID, fencing token, lease interval and current-state binding;
- the issue clock ID, epoch, reading and uncertainty; and
- a fresh 32-byte reader nonce.

The returned proof must authenticate the context digest, exact head position,
predecessor digest, Record/receipt digests and authenticated observation
time. A fresh nonce prevents replay of a response from another read; it does
**not** make a stale cache linearizable. The provider must separately
guarantee that the authenticated response represents its current committed
head.

The checked-in reader now creates a per-read nonce, passes a
`FreshnessCurrentStateProofContext` to Journal and witness reads and
verifiers, and rejects claims whose context digest, configured provider,
chain, environment, predecessor, position or authenticated read time differs.
The observation time must use the issue lease's clock ID/epoch and fit wholly
inside the lease interval. Production clock provenance and the provider's
linearizability remain **UNVERIFIED**.

### Unknown append outcome

The provider adapter must use one stable operation identity and exact
request digest for every reconciliation:

1. If the response is lost, query by the same `release_commit_id` and exact
   Record digest.
2. If the exact operation/Record is present, report committed even if a later
   Release has advanced the current head.
3. If a conditional retry is supported, retry only the same exact bytes,
   operation ID and expected predecessor. Never allocate a new generation
   or operation ID to “try again.”
4. A different Record under the same ID, an unexpected head, or an
   unresolved provider result is **UNKNOWN/BLOCKED**.
5. A negative read by itself is not proof that an earlier request cannot
   still commit. Do not clear the writer blocker on that basis.

The permanent operation record is required even if a provider offers a
short-lived request-token idempotency feature. No retry path may create a
second canonical append or silently replace the authorized bytes.

## Independent rollback witness contract

The witness protects the Release high-water state:

`(environment, Journal chainId, restoreEpoch, checkpoint sequence,
generation, Record digest)`.

Its current-read proof must additionally bind the fresh per-read context,
pinned witness source, observation time and authenticated clock domain. A
signed checkpoint from an earlier read is not proof of the witness's current
high-water value.

The witness must be independent of the Journal, DO, R2 and any shared restore
operation for the threat being claimed. Independence requires an explicit
failure-domain review of:

- operators and administrative principals that can write, restore or delete
  each source;
- provider/account organization and recovery/control-plane roles;
- backup/PITR scope and whether a single restore can roll back multiple
  sources;
- witness signing-key custody and rotation;
- retention of checkpoint history and the current high-water value;
- access logging, alert ownership and two-person recovery controls.

A different cloud vendor, account, bucket, key, or Worker is not by itself
proof of independence.

The witness is expected to advance with each committed Release before the
Coordinator clears writer-pending and before Freshness may issue. Its update
must be compare-and-set/monotonic, operation-idempotent, and reconcilable
after a lost response. If the Journal is ahead, the witness is stale or
unavailable, or the restore epoch differs, quarantine issuance. A
Release-generation checkpoint does not record every Freshness operation ID;
replay/tombstone rollback of the DO issue ledger needs a separate external
operation-log/checkpoint contract.

| Failure/restore event | Required interpretation |
|---|---|
| Normal DO restart | Reload persisted SQLite state; it is not evidence of rollback or cancellation. |
| DO-only PITR/restore | Compare with current Journal, R2 and independent witness. Mismatch or missing state quarantines; never initialize generation zero. |
| Journal-only rollback | A higher external witness checkpoint must reject the old Journal head. |
| DO and R2 rollback | The Journal and witness must remain ahead and reject the restored projections. |
| Journal + DO + R2 rollback | Detectable only if the independent witness is outside that common restore/administrative scope and still returns its newer high-water state. |
| Witness-only rollback/replay | Fresh challenge, trusted current read and retained monotonic checkpoint must reject the old witness state; if the witness cannot establish currentness, quarantine. |
| Multiple sources restored together, including the witness | No automatic detection is claimed without another independent witness or external control-plane restore epoch. Block and require controlled recovery. |
| Planned restore | Disable issuance with a gate outside the restored state; reconcile exact Journal/R2/Manifest; record a new independently controlled restore epoch; require two-person approval before re-enabling. |
| Unplanned restore, provider ambiguity, witness mismatch or unavailable witness | Quarantine. Do not clear an issue blocker, re-sign, reset counters, or accept a lower epoch. Recovery requires exact current authorities plus the approved restore/runbook evidence. |

No witness provider, restore-epoch service, quorum, retention policy or
quarantine-release authority is selected or registered.

## Provider candidates

The table distinguishes a documented component capability from the complete
Release Journal/witness contract. “Not documented” means the source reviewed
does not establish the guarantee; it is not an inferred provider failure.

| Candidate | Documented capabilities | Missing or unverified | Assessment |
|---|---|---|---|
| Cloudflare Durable Objects SQLite | Per-object transactional, strongly consistent storage; SQLite PITR can restore data from the previous 30 days. [Storage docs](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) | Same platform/control plane as the current Coordinator; a DO restore can roll back its own head; no external append receipt, latest-head proof or independent witness. | Keep as Coordinator only; not the Journal or witness. |
| Cloudflare D1 | `batch()` runs ordered statements transactionally and rolls the sequence back on statement failure. [D1 API](https://developers.cloudflare.com/d1/worker-api/d1-database/) | Time Travel can restore the database in place to a point within 30 days; read replicas and session consistency do not by themselves prove a globally current head; no signed append receipt/time or independent rollback root. [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/) | Possible database component, but not a complete Journal and not independent from the current Cloudflare control plane. |
| Cloudflare R2 | Strong global read-after-write; `If-Match`/`If-None-Match` are atomic for one object. Docs explicitly warn that a negative read does not settle an earlier in-flight write. [Consistency](https://developers.cloudflare.com/r2/reference/consistency/), [conditional operations](https://developers.cloudflare.com/r2/api/s3/extensions/) | No multi-object Journal transaction or signed append-time receipt. Bucket locks can retain objects, but privileged configuration and shared restore scope still require review. [Bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/) | Existing pointer/Manifest store; not a current-head Journal or independent witness by itself. |
| Cloudflare K2 | Ordered durable streams, atomic batch production, server receive timestamps, configurable retention up to 30 days; currently public beta. [Overview](https://developers.cloudflare.com/k2/), [concepts](https://developers.cloudflare.com/k2/concepts/), [produce](https://developers.cloudflare.com/k2/features/produce/), [retention](https://developers.cloudflare.com/k2/configuration/) | No documented conditional compare-and-append/current-head proof or request-nonce-bound response. It does not deduplicate; error `10212` has unknown append outcome. Its timestamp is when a batch is received, not a documented signed Journal receipt. | Reject as canonical Journal. It may be evaluated for non-authoritative audit/event delivery only. |
| AWS DynamoDB, one Region | `TransactWriteItems` is atomic and supports conditional actions; transactional operations have serializable isolation. Base-table reads can be strongly consistent. [Transactions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html), [read consistency](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html) | `ClientRequestToken` idempotency is limited to 10 minutes; a permanent operation row and exact lookup are still required. The reviewed APIs do not document a signed append receipt or trusted transaction commit-time proof. PITR restores to a new table, but an operator can still repoint the adapter to a restored table. [API](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html), [restore behavior](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/pointintimerecovery_restores.html) | **Unadopted historical candidate only. Not a Production selection or required next task.** |
| Sigstore Rekor public transparency log | Sigstore describes an immutable, tamper-resistant ledger with entry lookup/inclusion and integrity verification; auditors can monitor consistency. The public service documents a 99.5% availability SLO. [Rekor overview](https://docs.sigstore.dev/logging/overview/), [Rekor specification](https://github.com/sigstore/architecture-docs/blob/main/rekor-spec.md) | This review did not establish a FUSOU-specific linearizable latest-head API, exact duplicate/idempotency behavior, trusted append-time accuracy, restore ownership or a bound on split views for a single client. Independent monitors must retain and compare checkpoints; publishing a signed checkpoint alone does not make it an independent current witness. | Candidate for an external checkpoint/monitor experiment if public disclosure is acceptable; not yet a Release Journal or approved witness. |

### Historical recommendation — superseded, not adopted

The preceding provider review proposed a single-Region DynamoDB conditional
Journal prototype. The user has clarified that AWS is not used and DynamoDB
was not an adopted requirement. That proposal is retained only as historical
comparison evidence; it is not the next implementation task.

The current Cloudflare-only candidate and its trade-offs are described in
[runtime-config-freshness-contract-revision-proposal.md](./runtime-config-freshness-contract-revision-proposal.md).
The older comparison does not register any provider, trust root, account,
clock, or witness.

## Current reader and issue-core mapping

| Contract surface | Checked by current code | Adapter/provider/operations boundary | Remaining gap |
|---|---|---|---|
| `FreshnessJournalCurrentHeadEvidence` | Reader hashes exact Record, delegation, append receipt and current-head proof bytes; then verifies the signed Release Record and delegation. | Journal verifier must authenticate the receipt/head proof and their relationship to the exact bytes. | No Production receipt or current-head proof format/provider is registered. |
| `VerifiedFreshnessJournalCurrentHead` | Reader checks configured provider/chain/time-source IDs, `production`, context digest, position shape, predecessor digest, exact evidence digests, append time and uncertainty. | The injected verifier must pin the actual provider/root, authenticate latestness, receipt and append time, and bind its output to the context. | TypeScript claims or a context hash are not cryptographic proof. Provider linearizability and clock provenance remain **UNVERIFIED**. |
| `FreshnessJournalCurrentHeadVerifier` | It now receives a fresh read context containing environment, chain, operation, lease/fence, clock and 32-byte read nonce; the reader checks the returned context digest. | The adapter must verify the context is authenticated by a fresh provider response/proof and must bypass stale caches. | The selected service has not demonstrated a nonce-bound current-head proof. |
| `FreshnessAntiRollbackWitnessVerifier` | It now receives the same per-read context; reader pins `expectedSourceId`, checks chain/environment/context/time, exact proof digest, restore epoch, generation, Record digest and canonical checkpoint sequence. | The verifier must authenticate the witness trust root and prove it is returning its current monotonic high-water state. | No independent witness root, provider, restore-epoch service, retention or quorum is selected. |
| Coordinator snapshot | SQLite transaction checks operation, lease, fence, blocker, writer-pending, current state and restore epoch; copied snapshot is compared with the Journal and witness. | Durable Object SQLite/PITR and its administration remain one rollback domain; RPC controls are not a witness. | A restore that affects all local state cannot be detected from the DO alone. |
| Issue core | Reads/verifies before signing and again after signing; finalization conditionally stores exact response bytes only for the same operation/lease/current-state binding. | Coordinator's configured clock and external signer/provider outcomes must meet their own trust contracts. | Provider exception/unknown result remains blocked; no automatic retry or blocker clearing is introduced. |

## Conformance cases

These are required adapter conformance cases. “Local model” means the signed
test-only fixture exercises application rejection/acceptance logic; it does
not emulate a provider's consistency, durability, timestamp or restore
guarantees.

| Case | Input/provider operation | Required result | Locally established |
|---|---|---|---|
| Valid current head | Exact Record/delegation/receipt plus fresh context-bound head and witness reads; matching Coordinator/R2/Manifest. | Verify all bindings, sign, re-read and finalize exact bytes. | The runtime issue test uses test-only signatures and actual SQLite RPC. |
| Valid old head replay | Previously valid head proof with a different read nonce, operation, lease or clock context. | Reject before signing or reject after signing on the final read; return no response bytes. | Runtime test replays prior Journal and witness proofs after signing; both reject. |
| Receipt/Record mismatch | Mutate Record, delegation, receipt, predecessor, position or receipt digest. | Reject before signer call. | Runtime mutation cases cover exact byte and receipt failure; non-genesis chain proof remains an adapter conformance case. |
| Append-time mutation/uncertainty | Change authenticated time or uncertainty; make its interval cross `authorized_at` or delegation boundary. | Reject before signing; never round the uncertainty inward. | Runtime test covers changed append time and uncertainty crossing the delegation interval with test-only receipt signatures. |
| Concurrent append | Two operations compare-and-append different records against the same prior head. | Exactly one canonical winner; loser is conflict/unknown and cannot overwrite or fork. | Not established by local reader tests; must be tested against the selected transaction provider. |
| Append succeeded, response lost | Provider commits exact operation then drops response. | Query the same operation ID and exact digest; classify success only from exact stored record/receipt. | Not established by local tests. |
| Query after unknown | Query returns exact operation, absent operation, unchanged head, or conflicting head. | Exact operation means committed. Absence alone is not final; use only the same conditional/idempotent operation. Conflict or unresolved read stays blocked. | Application state machine has local unknown/finalization tests; Journal-provider outcome is not implemented. |
| DO-only rollback | Restore Coordinator to older or missing state while Journal/witness remain current. | Reject mismatch/uninitialized state; quarantine; no zero reset. | Local state-mismatch rejection is covered, not Production PITR. |
| Journal + DO/R2 rollback | Restore all three to a matching older Release while witness remains newer. | Witness high-water mismatch rejects. If the witness shares the restore, no detection is claimed without another checkpoint. | No provider rollback test has been performed. |
| Witness stale/unavailable | Old proof, wrong source pin, timeout or provider exception. | Reject/quarantine; no signer call if found before signing; no response if found after signing. | Runtime tests cover stale-context, wrong-pin and corrupted test-only witness; no provider availability test. |
| Restore-epoch mismatch | Coordinator, Journal and witness report different epochs. | Reject and require the approved restore procedure; never infer a new epoch. | Local epoch mismatch cases only. |
| Wrong environment/chain/provider/time pin | Proof says another environment/chain/provider/time source or verifier root is not configured. | Reject; do not let evidence choose its own trust pin. | Wrong chain/time/witness source pins are locally rejected; no Production pins exist. |
| Missing adapter or self-asserted `PASS` | Missing verifier, empty bytes, or verifier returns a success-shaped value without required claims. | Fail closed before signing. | Runtime self-assertion and missing-provider cases are covered. |
| Release changes before signing | Journal/Coordinator/R2/witness disagree during initial read. | No signer call. | Existing runtime rejection cases cover the reader path. |
| Release changes during/after signing | A source changes or a proof is replayed for the final read. | Reject completed signer result; do not expose response bytes or clear an unresolved blocker incorrectly. | Runtime tests cover changed R2 state and replayed proofs; response bytes are not returned. |

## Historical next implementation candidate — superseded

The following unit was proposed before the user clarified that AWS is not
used and DynamoDB was not an adopted requirement. It is retained as historical
review context only; it is not a request for approval or the next required
task. See the current
[Cloudflare-first contract proposal](./runtime-config-freshness-contract-revision-proposal.md).

**One bounded unit:** implement a non-Production DynamoDB Release Journal
adapter prototype after account/Region approval.

- **Files:** a dedicated Worker-compatible adapter package with
  `src/dynamodb-release-journal.ts`, a typed table/API contract, and
  `test/dynamodb-release-journal.test.mjs`; wire it only into the local
  conformance harness, not a deployed Worker or production binding.
- **Input:** exact Release Record and delegation bytes; `release_commit_id`;
  expected prior chain position/generation/Record digest; configured
  environment/chain/table identity; and the reader's fresh proof context.
- **Output:** exact current-head/receipt material accepted by the existing
  reader contract, or an explicit unavailable/unknown/conflict error. Do not
  fabricate signed evidence. Because DynamoDB does not document the needed
  signed timestamp receipt, the prototype must fail closed for issuance until
  an approved time-source contract is attached.
- **Dependencies:** approved AWS account and Region, table ARN/pinned
  identity, scoped writer/read roles, restore/change-control ownership,
  Worker-compatible AWS authentication, and a separate time/witness decision.
- **Completion:** demonstrate atomic compare-and-append of head + immutable
  record + permanent operation row; exact operation lookup after response
  loss; one winner under concurrent append; no duplicate/different bytes
  under a reused operation ID; and linearizable base-table reads. Then run a
  disposable AWS-account contract suite. DynamoDB Local alone is only a local
  model and is not provider verification.
- **Required rejection tests:** stale/mismatched context; wrong table,
  environment or chain; wrong predecessor; duplicate ID with changed bytes;
  concurrent conflict; unknown outcome with negative read; restore/repoint to
  a prior table; missing/invalid append-time verifier; missing or stale
  independent witness.
- **Gate:** no Production registration, credential, deployment, Freshness
  issuance or readiness promotion until append-time and independent-witness
  decisions are separately approved and verified.

## Historical approval questions from the DynamoDB investigation

The former DynamoDB account/Region approval question is withdrawn. The other
items are historical notes, not prerequisites to start an AWS adapter. Current
trust-profile, clock, and key-custody decisions are listed in the
[Cloudflare-first contract proposal](./runtime-config-freshness-contract-revision-proposal.md#9-decisions-required-from-the-trust-owner).

At this document's historical 2026-11-09 snapshot, the Journal/witness
provider contracts were **UNVERIFIED / NOT_IMPLEMENTED** and post-change
Hosted CI was **NOT_CHECKED**. Run #116 supersedes only that CI status for its
SHA. The Journal/witness provider contracts remain
**UNVERIFIED / NOT_IMPLEMENTED**, and Production acceptance and Stages A/B/C
remain **BLOCKED**.
