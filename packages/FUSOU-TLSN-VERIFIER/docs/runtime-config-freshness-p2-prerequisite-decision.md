# FUSOU TLSN — P2 Production Prerequisite Decision

## Status

**INVESTIGATION / DESIGN ONLY.** This is an independent review of the P2
coordination proposal and its Production prerequisites. It does not implement
or register a Durable Object, migration, binding, route, secret, Journal, R2
adapter, signer, HSM, deployment, or Cloudflare resource. It does not change
the APP/Worker wire contract or amend the normative protocol.

The following decisions remain **UNRESOLVED**:

- the Production clock provider and its time/uncertainty bounds for enforcing
  the normative at-most-eight-second issue lease;
- the Runtime Config Release Journal and its trusted append-time source;
- rollback-resistant operation replay state and the checkpoint protecting it;
- the Runtime Config HMAC verifier's key custody and timing guarantee;
- the Production signer's operation-idempotency and response-finalization
  contract.

The current issuer-core follow-up in
[runtime-config-freshness-protocol.md](./runtime-config-freshness-protocol.md#current-freshness-issuer-core-2026-11-07)
fixes the local contract: the lease is an authorization bound of at most
8,000 ms, not an SLO; expiry rejects signing/finalization but does not clear
an unresolved operation blocker. The prior P2 design's operational-target/SLO
wording is rejected and is not a protocol decision. Provider clock guarantees,
durable finalization, and Production recovery remain unimplemented.

## 1. Baseline and source inventory

### Baseline

- Repository: `tsukasa-u/FUSOU`
- Branch: `tlsn-first-testplay-candidate`
- Starting HEAD: `4fd995e1774750f9d93633382bbbd10a63368416`
- Starting parent: `839c4413fe035fc0b679d70125522d18514ec6ee`
- The actual branch, HEAD, and parent matched the requested baseline.
- The index was empty.
- The only pre-existing worktree edits were the root `justfile` and APP
  roaming `configs.toml`; both are protected and were not read, changed,
  staged, or committed.
- No source change, Cloudflare resource operation, secret access, external
  provider registration, Production API/R2 write, deployment, or testplay was
  performed.

### Source inventory

| Source inspected | Current evidence and limit |
|---|---|
| [runtime-config-freshness-protocol.md](./runtime-config-freshness-protocol.md) | The normative Section 5.3 grants an at-most-8-second issue lease, requires the signer to re-check it after signing, and says to discard a signature if the lease expires during signing. The protocol does not state that Release has a hard “must proceed by eight seconds” availability SLA. Section 6 makes exact Release Journal append the commit point. |
| [runtime-config-freshness-production-authority-design.md](./runtime-config-freshness-production-authority-design.md) | This is an implementation design, not evidence that the DO, Journal, R2 Worker adapter, HSM signer, or route exists. It assigns per-environment coordination to a new DO and distinguishes Journal commit from DO coordination state. |
| [runtime-config-freshness-do-coordination-design.md](./runtime-config-freshness-do-coordination-design.md) | The earlier design snapshot proposed a non-expiring blocker, fencing, writer-pending, exact-response finalization, and no time-based tombstone deletion, but mislabeled the eight-second bound as an operational target/SLO. That wording is rejected by the current issuer-core contract. Its physical signer-quiescence requirement is now distinguished from logical finalization fencing; Production adapters remain absent. Findings are detailed in Section 7. |
| [FIRST-TESTPLAY-READINESS.md](/home/ogu-h/Documents/GitHub/FUSOU/packages/FUSOU-TLSN-VERIFIER/FIRST-TESTPLAY-READINESS.md) | The checked-in readiness record reports test-only Freshness/Release behavior, Production Freshness as `NOT_IMPLEMENTED`, and Production/Stage A/B/C as `BLOCKED`. Its recorded audit base predates this baseline; no readiness status was changed or re-certified. |
| [domain.ts](/home/ogu-h/Documents/GitHub/FUSOU/packages/FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/domain.ts) and [signers.ts](/home/ogu-h/Documents/GitHub/FUSOU/packages/FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/signers.ts) | The current Freshness signer request carries operation IDs, request digest/nonce, environment/audience, lease/clock, current-state and fence bindings. `VerifiedCurrentFreshnessState` remains structurally constructible and does not attest itself; a Production signer must independently reload and verify trusted facts. |
| [freshness-issue.ts](/home/ogu-h/Documents/GitHub/FUSOU/packages/FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/freshness-issue.ts) | The provider-independent core verifies the challenge, state evidence, exact signed response, post-sign lease/state, and finalization receipt. Local tests use fake clock, test signer, map-backed store, and test witness; this is not a Production provider or durability/rollback proof. |
| APP [tlsn_runtime_config_freshness.rs](/home/ogu-h/Documents/GitHub/FUSOU/packages/FUSOU-APP/src-tauri/src/tlsn_runtime_config_freshness.rs) | The 10-second deadline is a Tokio `Instant` created immediately before the Freshness POST. The same deadline covers the POST/body, signed response verification, Manifest and five referenced artifact fetches, verification, and the pre-replace state-commit guard. The state writer performs temporary-file write/fsync, calls the deadline guard, then renames and syncs the parent directory; it has no deadline check after rename/fsync. Thus the source fails closed when the guard detects expiry before replacement, but it does not prove that the function returns within 10 seconds after the atomic replace begins. |
| APP [tlsn_runtime_config_runtime.rs](/home/ogu-h/Documents/GitHub/FUSOU/packages/FUSOU-APP/src-tauri/src/tlsn_runtime_config_runtime.rs) | `write_state_atomic_bytes` writes and syncs a temporary file, invokes `before_replace`, atomically replaces the state file, and syncs the parent directory. The 10-second guard runs before the replacement, not after it. |
| Worker [tlsn-runtime-config-freshness-test-adapters.mjs](/home/ogu-h/Documents/GitHub/FUSOU/packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-freshness-test-adapters.mjs) | `InMemoryReleaseCoordinationForTest` deletes leases via an injected clock and `issueFreshness` releases the lease in `finally`. Its fake signer, Journal, R2, clocks, and in-memory state do not establish remote-HSM cancellation, DO persistence, deployed timer, or PITR behavior. |
| Worker [binding_authority.ts](/home/ogu-h/Documents/GitHub/FUSOU/packages/FUSOU-TLSN-VERIFICATION-WORKER/src/binding_authority.ts), [src/index.ts](/home/ogu-h/Documents/GitHub/FUSOU/packages/FUSOU-TLSN-VERIFICATION-WORKER/src/index.ts), and [wrangler.toml](/home/ogu-h/Documents/GitHub/FUSOU/packages/FUSOU-TLSN-VERIFICATION-WORKER/wrangler.toml) | The existing `TlsnBindingAuthorityDurableObject` and `TLSN_BINDINGS` are for verification/session binding. The inspected Worker has no Runtime Config authority class/binding, Release Journal, Freshness route, or Runtime Config signer service. Its `TLSN_PRESENTATIONS` bucket and callback secrets must not be treated as those resources. |
| Worker [tlsn-runtime-config-release.mjs](/home/ogu-h/Documents/GitHub/FUSOU/packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-release.mjs) and [tlsn-runtime-config-r2-store.mjs](/home/ogu-h/Documents/GitHub/FUSOU/packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-r2-store.mjs) | The inspected Publisher and S3-compatible R2 store are Node/injected adapters, not a Worker Runtime Config authority or a Journal. The R2 helper does not automatically retry an ambiguous pointer write; an unchanged readback yields an outcome-unknown error. |
| Worker package [package.json](/home/ogu-h/Documents/GitHub/FUSOU/packages/FUSOU-TLSN-VERIFICATION-WORKER/package.json) | No Runtime Config Production DO test harness/provider integration is configured in the inspected package. |

The prior P2 commit changed design documents only; its commit contents were
read as source, not accepted as proof. This investigation changes only the
new decision document.

## 2. Meaning and feasibility of the eight-second lease

The normative rule is not silently redefined here. The following
interpretations have materially different behavior:

| Interpretation | Fit with normative Section 5.3 | Interaction with APP's 10-second deadline and `LATEST_AT_ISSUANCE` | Safety/availability conclusion |
|---|---|---|---|
| **Hard authorization cutoff:** a response may be signed/finalized only while a lease no older than eight seconds is valid. | This is the current local contract: at most 8,000 ms from lease acquisition, followed by lease and state rechecks and exact finalization. The Production clock provider and uncertainty bounds remain unselected. | The APP budget starts immediately before its POST and continues through the response, snapshot, five artifact fetches, verification, and state replacement guard. If the server consumes the full eight seconds, at most about two seconds remain, before accounting for request transit and response delivery. The APP deadline must not be extended. | **Selected contract; Production enforcement BLOCKED** pending an authoritative clock and mandatory durable response-finalization gate. |
| **Do not issue/accept a new operation after its age exceeds eight seconds, but let already-started signing finish.** | This is not equivalent to the normative post-sign lease-validity check. It may permit a signature to be returned after the authorization interval. | A late response can still be rejected by the APP's nonce, response-time, and 10-second checks, but those checks do not authorize a late server signature under the normative lease rule. | **REJECTED**; finalization must reject every expired/fenced operation and no response path may bypass it. |
| **Eight-second processing budget/SLO only.** | This changes “at most 8-second lease” into a performance target. The current protocol does not authorize that change. | An SLO overrun can consume the APP's remaining budget; the APP then fails closed. A response cannot be allowed to gain a fresh 10-second window on retry. | **REJECTED**; it is not the selected lease contract and must not be used to weaken the hard authorization bound. |
| **Release must always proceed by eight seconds.** | The protocol does not establish this availability SLA. | If Release force-commits while an issue operation can still finalize/return, it may invalidate the lease guarantee. A signer outage may outlast the APP deadline. | **NOT IMPLIED**; an eight-second Release progress SLA is not part of this contract. Unknown operations may block Release until a safe durable terminal transition or approved recovery. |

### Clock evidence

Cloudflare's [Workers performance documentation](https://developers.cloudflare.com/workers/runtime-apis/performance/)
states that deployed `Date.now()` and `performance.now()` advance only after
I/O and that `performance.timeOrigin` is zero. This is not a documented
monotonic cross-isolate clock, a bounded UTC source, or a DO-to-signer clock
agreement. Local timer tests are not evidence of deployed behavior.

DO alarms are at-least-once, one per DO, and may retry after failures; they
are wake-up/reconciliation signals, not an eight-second exact-expiry oracle.
The [DO lifecycle documentation](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)
also documents hibernation/restart and loss of in-memory state. Durable state
survives ordinary instance restart, but in-memory elapsed-time and active-job
knowledge do not constitute a durable clock or cancellation proof.

### Feasible safety boundary

There are two distinct properties:

1. **Physical cancellation:** the HSM/signer stops computing and cannot
   produce a signature.
2. **Logical non-delivery:** a late signature may exist, but no response
   can be accepted or returned through the authorized path after its issue
   operation is fenced.

Physical cancellation is not necessary for response safety if all of these
conditions are enforced:

- HSM output is available only to the trusted signer Worker, never directly
  to the APP/Gateway;
- every response path requires a DO finalization transaction binding the
  exact operation ID, request digest, nonce, lease ID, generation, fencing
  token, and exact signed response bytes/digest;
- expiry/revocation and finalization serialize in the same DO state machine;
- after expiry/revocation, finalization rejects the old token and the signer
  discards the signature; no direct, cached, callback, or retry path bypasses
  this check;
- the signer returns response bytes to its caller only after the finalization
  result is durably committed.

Under this model, the HSM may finish a timed-out request, but the result is an
orphan and cannot be returned. A response finalized before Release may arrive
after Release and still be valid as `LATEST_AT_ISSUANCE`: the protocol binds
the issuance point, not the later APP acceptance point. The APP's original
nonce and 10-second deadline govern whether that delayed response can still
be accepted.

This logical gate is a **candidate**, not a current guarantee. P1
`ProductionFreshnessResponseSigner` returns a response directly and does not
carry the issue ID, lease ID, or fence. A private P2-to-signer interface must
add those bindings and make finalization part of the signer method's internal
contract; that does not alter APP wire bytes. If the signer/Gateway is allowed
to return raw HSM output without that gate, physical cancellation or an
equivalent provider-enforced revocation is required.

### Cancellation/quiescence options

| Option | What it proves | Failure/late-result behavior | Status |
|---|---|---|---|
| Abort the caller's HTTP/RPC request or use a local timeout | Only that the local caller stopped waiting or stopped receiving that request. It does not establish that the remote signer/HSM did not receive or finish the command. | Remote signing may complete; a delayed response may still reach a live signer process. Never release a lease solely on a client abort. | Insufficient as cancellation proof. |
| Provider `cancel(job_id)` with terminal acknowledgement | Potentially proves remote work is canceled only if the provider contract states the acknowledgement is terminal, no signature can later be retrieved/delivered, and status is durable across provider restart. | A “request accepted” acknowledgement, HTTP disconnect, or best-effort cancellation is insufficient. Need stable operation ID and read-after-cancel status. | No HSM/provider is selected; **UNRESOLVED**. |
| DO fencing + mandatory response finalizer | Proves stale results cannot pass the authorization gate, even if the HSM continues and produces an orphan. It proves logical non-delivery, not physical quiescence. | A stale `finalizeIssue` is rejected. Gateway has no direct HSM route. A process holding raw output is inside the trusted signer boundary and must be prevented from bypassing the gate. | Preferred safety mechanism to evaluate; absent from Production code and not represented in P1 types. |
| Single synchronous signer process with no persisted job | Does not prove termination across Worker shutdown, RPC retry, request cancellation, deployment, or external HSM processing. | A restarted caller cannot distinguish “HSM never signed” from “signed, response lost” without an idempotency/status API. | Insufficient alone. |
| Durable signer operation ledger plus finalizer | Can return the same completed response on exact retry and distinguish pending/completed/canceled operations, if it is independently durable and rollback-protected. | If the ledger is only in the DO being PITR-restored, old pending IDs can reappear. If the ledger is only in signer memory, restart loses it. | Required for exact retries; provider and anti-rollback treatment **UNRESOLVED**. |

For a **physical quiescence proof**, the evidence would have to cover the
signer worker's internal job, the HSM/provider operation, result retrieval,
callback/queue retries, and every Gateway response path. No such end-to-end
contract or provider exists in the checked-in source. For **logical
non-delivery**, a trusted-code response gate can avoid waiting for physical
HSM cancellation, but the signer and Gateway then form part of the trusted
computing base and require human approval.

## 3. PITR anti-rollback options

DO SQLite PITR can restore SQL and KV state to a point within the prior 30
days. This can roll back operation IDs/digests, nonce records, lease
tombstones, pending Release state, result bytes, fencing counters, and any
key-policy metadata stored in that database. A DO cannot infer from restored
state that it has been restored.

| Candidate | Rollback detection and replay coverage | Checkpoint rollback / common-mode failure | Availability, retention, cost |
|---|---|---|---|
| **Independent monotonic checkpoint** | Store a head/epoch outside the DO and compare it before any state-changing RPC. It detects a restored DO only if the checkpoint records every relevant monotonic operation or a complete operation-log root. A Release-generation checkpoint alone does not detect reuse of a Freshness nonce/operation ID between Releases. | The checkpoint must not be restorable by the same actor/process as the DO. If it has PITR, add a second independently administered witness/quorum or an externally published signed head. If the checkpoint and DO can both be rolled back together, the rollback is undetectable. | Adds a remote write/consistency dependency to each protected transition. Quorum loss must fail closed. Retention can be compact if a signed monotonic sequence/root is sufficient, but proof and audit storage are still needed. |
| **External append-only operation journal** | Record each mutating RPC's `(epoch, role, operation_id, request_digest, state transition, result digest)` and the relevant signer/R2/Journal idempotency IDs. On DO restore, compare/replay or reject any old ID. A digest-only log detects but cannot reconstruct exact response bytes; store exact retry results or a content-addressed durable result reference. | The operation journal itself needs an independent checkpoint/witness. A journal and DO restored to mutually consistent old heads cannot detect their joint rollback. | Highest write/retention and operational burden. Every external side effect needs a prepared/completed protocol because there is no cross-service ACID transaction. Availability requires the log and witness. Strongest candidate for exact ID reuse detection. |
| **External restore/incarnation epoch** | Keep the current epoch outside DO SQLite; bind it into every HMAC preimage, operation ID namespace, lease/fence, and signer request. A packet signed under an old epoch is rejected after rotation. This invalidates old captured MAC bytes if all callers and verifier have switched. | A version/secret that can be reverted by the same deployment administrator is not a monotonic checkpoint. The epoch service/control plane needs separate permissions and an audit/witness. An uncontrolled restore that does not rotate the epoch is invisible. | Low data retention cost, but strict operational dependency and rollout coordination. Does not reconstruct lost tombstones or prevent a caller from re-signing a semantic duplicate under a new epoch unless operation IDs/ledger policy also reject it. |
| **Mandatory restore quarantine** | A maintenance gate stops all callers/signers before a planned restore, and blocks re-enable until Journal/R2 reconciliation, key/epoch rotation, and in-doubt issue resolution finish. It covers only restores performed through that controlled process. | It does not detect an unannounced restore or an operator bypass of the gate. The gate must be outside the PITR-restored DO and independently controlled. | Simple and human-intensive. Requires a documented, tested runbook, two-person approval, deployment control, and fail-closed routing. Not a standalone anti-rollback mechanism. |
| **Key rotation alone** | Invalidates old MAC bytes only if the old key is actually removed from every caller/verifier version. | Does not recover the tombstone or determine whether the same semantic operation was already used. If a valid caller signs an old operation under a new key, the restored DO may accept it unless the epoch/operation log blocks it. | Low storage cost but not sufficient for replay safety. Rotation must account for in-flight old Worker versions and permission propagation. |
| **Two or more independent witnesses** | Witnesses retain/check signed operation-log or Merkle-head checkpoints. Comparing independent heads detects a rollback/equivocation of one witness. | All-witness rollback, collusion, or common administration remains a common-mode risk. Define quorum, independent accounts/administrators, recovery, and public/auditor access. | Better anti-rollback assurance at additional latency, cost, retention, and availability dependency. Provider and quorum are unselected. |

### Required combined model

For the requested invariant “a DO restore cannot make an old authenticated
request valid again,” key rotation alone is insufficient. A viable candidate
must combine:

1. a restore epoch managed outside DO/D1/R2 state and included in every
   authenticated request;
2. an append-only operation log or equivalent checkpoint that covers each
   mutating `operation_id` and its request digest, not only Release generation;
3. a separate witness or independently controlled checkpoint protecting that
   log's own head from rollback;
4. a mandatory route/caller quarantine during restore, with re-enable gated on
   verification of the external epoch/checkpoint and Journal/R2 state;
5. exact-response/result retention or a proof that a compact monotonic
   sequence makes prior IDs permanently rejectable.

An unannounced PITR restore remains undetectable unless the control plane
provides a separately authenticated restore-generation event. No such event
or binding is registered. Production anti-rollback remains **BLOCKED**.

### Old signed Freshness responses

The existing APP checks the response nonce against the current request,
validates response/delegation time, and uses the same 10-second APP deadline.
An old response for a different nonce is not a response to a new challenge;
the nonce is not replaced by a server-supplied value. Exact replay for the
same still-pending challenge is acceptable only as an exact retry within the
original APP deadline. These APP checks mitigate response replay but do not
repair a rolled-back DO operation ledger or authorize reuse of an old RPC
operation ID.

## 4. Release Journal provider candidates

The commit point requires an authenticated current head, linearizable
compare-and-append, exact record retention, trusted append-time evidence,
idempotent exact retry, explicit conflict, recovery from ambiguous results,
and independently protected rollback state. A provider is not selected by
this document.

### Candidate comparison

| Candidate | Documented useful capability | Missing/unverified for the Release Journal contract | Assessment |
|---|---|---|---|
| **DO SQLite storage** | Strongly consistent, transactional per DO; a transaction can serialize a single environment's local head and append. | Same coordination/storage family, SQLite PITR can restore within 30 days, operators can modify state, and no independent append-time receipt or witness. | Suitable for coordination, not an independent Journal by itself. |
| **Cloudflare D1 primary + `batch()`** | Official D1 docs describe `batch()` as sequential SQL transactions; a failed statement aborts/rolls back the batch. Writes go to the primary. | D1 Time Travel restores in place to any minute in the last 30 days. Read replication is asynchronous; use a primary/latest session policy and prove `getHead` cannot be served stale. The database is mutable by its Worker/admin and has no built-in append-only or independent witness guarantee. Trusted append time is not established by `batch()`. | Plausible transactional journal component only with no stale replica reads, restricted writer/admin access, exact retry records, a trusted append-time design, and independent anti-rollback witness. Not selected. |
| **R2 immutable record objects + mutable head CAS** | Current official R2 docs state strong global read-after-write consistency; `If-Match`/`If-None-Match` conditions are evaluated atomically with the object write, and competing create-once writes have at most one winner. Bucket locks can block overwrite/delete of protected objects, including indefinite retention. | R2 has no native multi-object append transaction. A Journal would have to create the exact immutable generation record first, then CAS a single head object; record-orphan recovery and exact retries need conformance tests. A negative `NoSuchKey`/old-head read does **not** prove an earlier unknown write failed; it may commit after the read. Bucket-lock policy is configurable/removable by privileged account roles. The docs inspected do not provide a Journal-signed append-time receipt or independent checkpoint. | Strong candidate for immutable record storage and single-object head CAS, but not a complete Journal or independent trust boundary. No bucket/account/provider is selected. |
| **Single-primary relational/transactional database + hash chain** | A provider with documented serializable transactions/row locking can atomically compare the current generation/head and insert one exact record. A unique constraint can reject duplicate sequence numbers; an operation table can provide idempotency. | “Database transaction” alone does not make history append-only: privileged SQL/admin can update/delete/restore. Provider-specific read/write consistency, failover, commit timestamps, PITR, backup restoration, exact retry, and admin separation must be evidenced. | Strong general architecture candidate when paired with immutable checkpoints/witnesses; no provider selected. |
| **Transparency log / Merkle log** | Inclusion and consistency proofs can make later deletion or fork detectable to monitors that retain signed checkpoints. | A candidate service must still document linearizable submission/head semantics, exact duplicate submission, retention, authenticated append time, availability, restore behavior, and protection from split views. A signed tree head without independent monitors does not prove the log operator did not roll back or equivocate. | Strong audit/witness component; not accepted as a Journal until its exact API and witness model are selected and tested. |
| **Signed audit/event log only** | A signature authenticates the bytes signed by the log key. | A signature alone does not prove canonical chain position, atomicity, uniqueness, append-only retention, absence of an alternative fork, trusted append time, or recovery. | Insufficient alone. |

### R2-specific findings

Cloudflare's [R2 consistency model](https://developers.cloudflare.com/r2/reference/consistency/)
and [S3 API extensions](https://developers.cloudflare.com/r2/api/s3/extensions/)
give more precise pointer-CAS semantics than the prior P2 design recorded:

- `PutObject` conditional headers are atomic as part of the same single-object
  commit. Strong consistency means a completed write is immediately visible
  globally.
- A `NoSuchKey`/old-head read is not final if the earlier `PutObject` outcome
  is unknown; that in-flight write may commit after the read returns.
- Reconciliation must therefore never treat a negative read as proof of
  failed CAS. A candidate recovery technique is to repeat the *same* body and
  same expected ETag/conditional request: at most one conditional write may
  win, and the final object must be read back and byte-verified. This exact
  retry must be tested against the current Worker R2 API/SDK and the selected
  write method before being relied on.
- A two-step design could create a generation-specific immutable record with
  `If-None-Match: *`, then CAS one mutable `head` object with `If-Match`.
  The immutable record is an orphan until the head CAS succeeds. The record
  and head must bind exact generation, predecessor digest, record bytes, and
  request ID; a conflicting head is never overwritten.
- Bucket locks can retain records, but the current docs describe policy
  management through privileged dashboard/Wrangler/API actions. A Runtime
  Config Worker role must not also own lock-policy administration. Lock rules
  do not provide the independent witness or trusted append-time receipt.
- Cloudflare documents R2 permission changes as eventually consistent (up to
  a minute). Do not rely on immediate credential revocation as the only
  in-flight writer fence.

The existing Node S3 helper is conservative on ambiguous writes: it reads
back and reports `outcome unknown` rather than automatically retrying. It
does not validate the proposed Worker-side repeated-CAS recovery and does
not make R2 a Journal.

### Journal commit/recovery contract

Whichever provider is selected, a conformance adapter must support a
provider-specific operation ID and exact request digest, or prove that
repeating the exact conditional append is value-idempotent. On timeout:

1. Query an authenticated head/status from the authoritative write path, not
   an unconstrained read replica.
2. If the exact record/delegation is at the expected next chain position,
   treat append as committed and return the authenticated append receipt.
3. If the exact prior head is returned but the original write can still be
   in flight, do not start a different append. Resolve it through provider
   operation status or an exact idempotent CAS retry.
4. A conflicting head, missing record, unavailable status, or untrusted
   append timestamp keeps the Release pending and Freshness disabled.
5. Only after exact Journal commit is verified may the DO be repaired to
   `COMMITTED`; the DO is not the Journal.

The Journal's `appended_at` must be provider-generated or otherwise
independently attested, bound to the exact record and chain position, and
within an approved clock-error bound. A caller timestamp, R2 ETag, D1
bookmark, or Worker `Date.now()` is not sufficient by itself. Existing
protocol validation requires the append time and signed `authorized_at` to
fit the Release delegation; no provider/time source currently satisfies that
contract in registered Production.

## 5. HMAC key custody and rotation

### Role and key model

The request MAC is an RPC caller-authentication credential, not a signing
key, Journal commit authorization, or proof that a request body is semantically
valid. Candidate key identities are separate for at least:

- `(production, runtime-config-authority, key_id, rotation_epoch)`;
- `(production, release-signer, key_id, rotation_epoch)`;
- `(production, freshness-signer, key_id, rotation_epoch)`.

The MAC preimage must bind protocol/domain version, pinned environment,
expected role, operation, key ID and epoch, operation ID, lease/attempt ID,
fencing token where relevant, exact canonical body digest, and nonce.
Generation, epoch, and fence are strict canonical strings; they are not
coerced to JavaScript numbers. HMAC authentication does not replace runtime
validation of exact request schemas or independent Journal/R2/signer checks.

Never reuse the TLSN Result signing key, APP/bootstrap key, verification
callback secret, or queue/direct callback secret. Ed25519 Release and
Freshness signing keys remain separate, purpose-specific signing credentials;
they are not stored as Worker HMAC secrets.

### Cloudflare secret options and trust boundary

- Cloudflare [Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
  are encrypted secret bindings managed per Worker and are exposed to that
  Worker's code through `env`/`process.env`. A DO class implemented by that
  Worker receives its environment. This is useful for deployment-scoped
  HMAC values but does not give per-method or per-class secret ACLs.
- Cloudflare [Secrets Store](https://developers.cloudflare.com/secrets-store/)
  is account-level and was marked **open beta** in the documentation checked
  on 2026-11-02. Its Worker integration requires a secret with the `workers`
  scope and an authorized binding. The access-control docs distinguish
  Secrets Store Admin (manage values) from Secrets Store Deployer (bind to a
  Worker). This is a control-plane separation opportunity, not an HSM and not
  a runtime role boundary inside one Worker.
- Any code in the Worker that has a secret binding can use that secret. If a
  single Runtime Config Authority Worker implements the DO and loads all
  role HMAC keys, compromise of that Worker permits it to impersonate every
  role whose shared secret it holds. Separate key IDs reduce accidental
  reuse and credential-sharing scope but do not prevent the verifier itself
  from forging each role's MAC.
- Cloudflare DOs have no per-method roles. Service binding isolation does not
  provide a reliable caller identity: `ctx.access` does not propagate over
  service-binding HTTP/RPC. An internal service boundary or namespace
  binding is not itself proof of the caller role.

The trust owner must explicitly approve the Runtime Config Authority Worker
as a central HMAC verifier, or approve a different caller-authentication
architecture. A secret store must not be described as HSM custody for the
Release/Freshness signing keys.

### Rotation and PITR

1. A key ID identifies a concrete key; a separate monotonic rotation epoch
   identifies the active caller universe. Both are MAC-bound.
2. During overlap, an old key may authenticate only an exact retry whose
   operation ID and request digest are present in the rollback-protected
   operation ledger. It cannot authorize a new operation.
3. Rotation must disable old Worker versions/callers and account for in-flight
   requests before the old key is revoked. Do not use a time-based overlap
   alone.
4. After a controlled restore, disable all callers and signers, advance the
   externally administered epoch, rotate old role keys, reconcile the
   Journal/R2 head, resolve in-doubt signer operations, and only then
   re-enable traffic.
5. Rotation invalidates captured old MAC bytes only after all verifiers stop
   accepting the old key. It does not restore lost tombstones and does not
   prevent a trusted caller from re-signing a duplicate semantic operation
   under a new key unless the new epoch/operation ledger rejects it.
6. Never persist the sole current key epoch in the PITR-restored DO. The
   external epoch and its own anti-rollback/witness model are **UNRESOLVED**.

### Constant-time MAC verification

Cloudflare's [Web Crypto documentation](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
defines `crypto.subtle.verify()` as returning a boolean, but does not document
a constant-time guarantee for HMAC verification. The Web Cryptography API
description similarly defines a boolean verification result, not a timing
contract. Do not claim that `crypto.subtle.verify()` is proven constant-time
from those API descriptions, and do not replace it with a hand-written
early-exit `===` comparison.

Before Production, choose a verifier whose implementation/provider contract
or security assessment explicitly covers constant-time MAC verification for
this deployment, or obtain approval to change that requirement. Timing tests
alone cannot prove constant-time behavior. No such implementation/provider is
selected.

## 6. Independent review of the P2 coordination design

| Topic | Review result | Failure scenario / evidence | Required correction before implementation |
|---|---|---|---|
| `writer_pending` vs. issue acquisition | **Conditionally sound.** | If `beginRelease` and `acquireIssue` are transactions on the same DO state, one wins: Release first denies a new issue; issue first makes Release wait. The P2 design describes this serialization. A second uncoordinated DO/namespace or cached issue count would invalidate it. | One environment authority only; derive/verify unsettled operations from durable rows in the same transaction. Add actual Cloudflare DO concurrent-race tests. |
| Existing issue while writer pending | **Local contract implemented; Production adapter unverified.** | A grant that wins first may finish against the old head only while its lease/state remain valid. `writer_pending` blocks new grants; Release cannot mutate R2 or append Journal until the existing operation has a durable terminal result. Expiry alone is not drain evidence. | The provider must serialize finalization against the Release gate and retain unknown operations. Add actual Cloudflare DO concurrent-race tests before registration. |
| Signer response before finalization | **Provider-independent core implemented; Production path not connected.** | The core receives signer bytes, checks operation/request/lease/state and exact signature bytes, then calls the coordinator's durable finalizer. It returns nothing on rejection/unknown. No Production Worker calls this core or proves a universal return gate. | Connect only through approved signer/coordinator adapters; no route, cache, callback, or direct signer response may bypass the finalizer. No APP wire change is required. |
| Physical cancellation vs. finalization fence | **Local logical-return boundary defined; Production fence unverified.** | A late HSM result may exist, but must not be finalized or returned after expiry/fencing. The local core never proves remote computation stopped. If any response path bypasses the stateful finalizer, a local fence is insufficient. | Require a universal durable finalization/response gate and test it. Physical HSM cancellation is not claimed or used as a lease-release signal; unknown operations remain blocked until an approved fence/recovery transition. |
| Exact retry and external side effects | **Provider contract remains unimplemented.** | The internal signer request now carries operation IDs and a canonical digest; the local core refuses a different request under the same ID and does not automatically re-sign an unknown result. A test map is not an external provider ledger. | Every side-effect owner needs an operation ID + canonical digest + durable status/result lookup or a provider-proven exact idempotent operation. On unknown signer outcome, do not silently re-sign; retain `RESULT_UNKNOWN` until approved recovery. |
| HSM/provider timeout | **Fail-closed; provider recovery path unimplemented.** | A client timeout can occur after HSM acceptance. A retry without provider idempotency may produce a second signed payload with a new `authorized_at`/`issued_at`. | Use a provider operation ledger with exact payload digest, status, and result retrieval; do not automatically re-sign. HTTP timeout/caller abort and lease expiry do not release an unresolved blocker. |
| DO restart / ambiguous RPC | **Restart persistence is handled conceptually, not runtime-verified.** | Storage-touching in-flight requests may fail during DO restart; the client may not know whether a storage transaction committed. Memory-based status is lost. | Query the same durable operation ID and request digest after reconnect. Test `committed-but-reply-lost`, `not-committed`, deployment/restart, and duplicate RPC on Cloudflare's DO runtime. |
| Journal append succeeds, DO update fails | **Correct only conditional on the Journal contract.** | The P2 recovery rule verifies the exact record/delegation, append metadata, R2 pointer, and snapshot before reconstructing DO `COMMITTED`. Without a linearizable authenticated Journal head and independently trusted append metadata, a matching DO-local digest is not enough. | Keep Freshness blocked until the provider returns the exact committed record at the expected chain position; never issue a new generation during repair. Provider tests remain a prerequisite. |
| Freshness finalized, response lost | **Local recovery logic verified; Production persistence/access unverified.** | The core resolves an ambiguous finalization by looking up the same operation and validates exact finalized bytes before returning; a repeated finalized operation retrieves those bytes without signing again. The test store is map-backed, not DO persistence. | Persist exact finalized response bytes/result for the exact retry policy; authenticate result retrieval; no cache or Gateway route may bypass it. Test response loss before/after finalization in the approved provider runtime. |
| PITR plus key rotation | **Acknowledged but not resolved by P2.** | A DO-only ledger can roll back. Rotation makes old MAC bytes invalid only if the old key/epoch is no longer accepted; it does not restore a lost tombstone or prevent a new-key semantic duplicate. | Use external operation/checkpoint state plus a non-rollbackable incarnation epoch and mandatory quarantine; separately protect the checkpoint's own head. |
| Terminal tombstone retention | **Correctly identified as unbounded; compaction remains unresolved.** | UUID operation IDs cannot be compacted by a scalar high-water mark unless the caller/authority defines a strictly ordered epoch+sequence and the external checkpoint covers it. Time-based deletion reopens replay after rollback. | Choose permanent append retention or a proved monotonic-sequence/watermark protocol before schema implementation. Include cost, retention, and restore tests. |
| uint64 / SQLite | **Mostly sound; fence contract incomplete.** | P2 correctly rejects JS-number/SQLite-signed-integer use for unsigned counters and proposes canonical decimal text. It does not set the maximum width/exhaustion behavior for the new fencing counter. | Specify `fencing_token` width/encoding and non-wrap behavior; persist decimal text or fixed-width bytes; fail closed at exhaustion. Reuse P1 `uint64` only if explicitly approved for this new internal field. |
| DO transaction / external I/O boundary | **Sound as documented.** | A local SQLite transaction cannot include R2/Journal/HSM. Holding a DO transaction or `blockConcurrencyWhile()` across those calls creates lifecycle/concurrency hazards. | Keep intent/transition transactions short; external I/O and readback happen between transactions. Test that external adapters are never invoked inside the transaction callback. |
| R2 ambiguous outcome | **Needs the current provider-specific caveat.** | R2 explicitly documents that a negative read during an unknown in-flight Put does not prove the Put failed; it may commit later. The P2 design correctly says to stay blocked on unknown outcomes, but its decision matrix does not prescribe a safe repeated-CAS strategy. | Use the same exact conditional write against the same expected ETag only after validating the single-key atomicity contract; then read exact final bytes. A negative read alone never authorizes abort or a different CAS. |
| Eight-second semantics | **Normative maximum fixed; Production clock/finalizer evidence unresolved.** | The current contract is an at-most-8-second authorization lease, not an SLO. Expiry rejects signing/finalization but does not clear an unresolved operation. | Select a trusted clock/uncertainty bound and durable finalization adapter. Do not reinterpret the lease as a timeout or Release progress SLA. |
| APP 10-second budget | **Bounded pre-replace guard observed; hard return-time guarantee not proven.** | APP's 10 seconds covers remote fetch/verification and checks immediately before state replacement. Synchronous rename and directory fsync happen after that guard. A full eight-second server operation leaves at most about two seconds for APP artifacts/verification. | Do not widen the APP deadline. Measure and test the complete path; if a strict return deadline is required, decide the atomic-commit boundary and document the post-commit syscall limitation. No APP code change is made here. |

## 7. Blocker exit criteria

| Blocker | Status | Evidence required to close |
|---|---|---|
| Trusted lease clock | **UNRESOLVED** | Approve the provider, lease start/end sampling, and bounded time uncertainty for the fixed maximum 8-second authorization lease; demonstrate that finalization rejects expired operations. No eight-second progress SLA is implied. |
| Signer/HSM late result | **UNRESOLVED** | Approve and test a universal logical-finalization gate proving every response route is fenced and HSM output cannot reach APP/Gateway except after exact durable finalization. Physical HSM cancellation is not claimed. |
| Signer-side exact idempotency | **UNRESOLVED** | Stable signer operation ID, exact request digest, status/result lookup, duplicate/timeout tests, and an explicit policy for a signature that may have been produced but not persisted. |
| PITR replay protection | **BLOCKED** | Independent operation journal/checkpoint that covers operation IDs/digests and is itself rollback-protected; external incarnation epoch; enforced quarantine; same-DO+Journal rollback and old-packet tests. |
| Journal provider | **UNRESOLVED** | Provider-specific evidence for all Section 4 requirements, exact append receipt/time, retention, access separation, PITR/restore behavior, and ambiguous-outcome recovery conformance. |
| HMAC secret boundary | **UNRESOLVED** | Approved role/environment key owner, secret distribution, central verifier trust boundary, rotation/old-version shutdown procedure, and never-reuse evidence. |
| Constant-time HMAC verification | **UNRESOLVED** | Explicit provider/library guarantee or security assessment for the actual Worker runtime; a timing test by itself is insufficient. |
| Operation-result retention | **UNRESOLVED** | Exact response storage limits, retention, compaction/high-water algorithm, restore semantics, and cost approval. |
| Trusted append time | **BLOCKED** | Journal/provider-authenticated time bound for the exact appended record, compatible with Release delegation validation. Caller time, R2 ETag, or DO clock is insufficient. |

## 8. Implementation order and dependencies

Do not begin Production DO implementation until the first five decisions below
are approved. A local/test-only DO may be implemented later without bindings,
secrets, live Journal/R2/HSM calls, or Production readiness claims.

| Order | Work | Prerequisite / exit test |
|---|---|---|
| 0 | Select a trusted clock and APP deadline acceptance boundary. | Provider-specific time source and uncertainty bounds enforce the fixed maximum 8-second lease; no fake clock establishes Production timing. Preserve APP's 10-second deadline. |
| 1 | Connect the internal issue operation, lease/fence, signer binding, finalization, and finalized-result retrieval to approved adapters. | The provider-independent core and interface exist locally; Production operation ID persistence, finalization, and response-path registration remain absent. No APP wire bytes change. |
| 2 | Approve logical fencing as the Production response-safety mechanism. | Threat model names the signer Worker, HSM/provider, Gateway, and universal output gate. Late-signature and direct-bypass tests pass. Physical HSM cancellation is not claimed. |
| 3 | Select a rollback-resistant operation checkpoint and restore epoch control. | Demonstrate DO PITR, Journal rollback, joint rollback, old MAC, old operation ID, and old signer response behavior; checkpoint's own rollback is covered. |
| 4 | Select Journal architecture and append-time authority. | Provider adapter contract and conformance suite for linearizable head, compare-and-append, exact retries, conflicts, timestamps, retention, and restore. R2 may be evaluated for immutable records + one-head CAS, but not assumed to be a complete Journal. |
| 5 | Approve role/environment HMAC custody and constant-time implementation. | Secret admin/deployer separation, per-worker/per-environment bindings, central-verifier trust approval, old-version revocation, key IDs/epochs, and MAC verification evidence. |
| 6 | Implement the local SQLite coordinator and state machine in a new Runtime Config Authority package/Worker. | No `TLSN_BINDINGS` reuse. Real Workers Vitest tests cover races, restart, transaction boundaries, fencing, duplicate RPC, and exact response persistence. |
| 7 | Implement/test signer and external-provider idempotency separately. | HSM signed-but-reply-lost, operation status, cancellation, signer restart, exact retry, and orphan-signature tests. |
| 8 | Implement Journal/R2 adapters behind selected interfaces and run provider conformance tests. | R2 negative-read/in-flight-PUT cases, exact conditional retries, Journal append ambiguity, concurrent writers, and R2 immutable retention are tested. |
| 9 | Exercise controlled PITR/restore and re-enable gate. | Restore epoch/witness proves no old caller/signer packet is accepted; no production traffic before operator sign-off. |
| 10 | Only after all gates: register new per-environment DO migration/binding, secrets, signer services, routes, and deployment. | Explicit trust-owner approval and separate deployment acceptance. This investigation performs none of these operations. |

## 9. Human approval required

1. Which trusted clock provider and explicit uncertainty bounds may enforce the
   normative at-most-eight-second authorization lease?
2. Is the trusted security property “HSM work physically stops” or “no stale
   signature can pass the signer/DO finalization gate”? If logical fencing is
   accepted, the signer and Gateway become an explicit trusted computing
   boundary.
3. Which external operation-journal/checkpoint and independent witness may
   own the anti-rollback root? How is that root itself protected from restore
   or common-administrator rollback?
4. Which Journal provider/architecture is approved, including append-time
   authority, retention, operations staff, restore permissions, and
   independent audit?
5. Is a Cloudflare account-level Secrets Store in open beta acceptable for
   HMAC secrets, or must per-Worker/external secret custody be used? Who may
   bind, edit, rotate, or restore each role/environment key?
6. Is the Runtime Config Authority Worker, which verifies shared HMAC keys,
   approved as capable of impersonating all authenticated roles if
   compromised?
7. Which provider or reviewed primitive supplies the required constant-time
   MAC verification guarantee?
8. What exact operation-result and tombstone retention/cost is acceptable,
   and may a monotonic operation sequence replace permanent UUID tombstones?
9. Who can invoke PITR, who owns the quarantine gate, and what two-person or
   independent approval is required before re-enable?

No human decision is inferred from this investigation.

## 10. Readiness impact

| Area | Status |
|---|---|
| P2 prerequisites | **UNRESOLVED / BLOCKED** as detailed above. |
| Local SQLite coordinator adapter | **LOCAL_WORKERS_RUNTIME_VERIFIED**; the real issue core and DO adapter pass 16 pinned local-runtime integration cases, including concurrency and runtime recreation. This is not Production registration or authority. |
| Production DO / migration / binding | **NOT_IMPLEMENTED / NOT_REGISTERED**; the Production Worker still has no Runtime Config coordinator binding. |
| Production Release Journal and trusted append time | **NOT_IMPLEMENTED / BLOCKED**. |
| Production R2 Runtime Config adapter | **NOT_IMPLEMENTED**; R2 CAS is a candidate capability, not a registered adapter. |
| Production Release/Freshness signer and HSM | **NOT_IMPLEMENTED**. |
| RPC anti-replay after PITR | **BLOCKED** pending an independent operation checkpoint and restore epoch. |
| Production Freshness acceptance | **BLOCKED**. |
| Stage A — protocol-only testplay | **BLOCKED**. |
| Stage B — identity-bound testplay | **BLOCKED**. |
| Stage C — Production evidence delivery | **BLOCKED**. |

The readiness record's local/test-only results are not Production acceptance.
No readiness promotion, wire-contract change, trust-boundary change, or live
verification was performed.

The local DO tests use an explicitly configured fake clock and witness and a
temporary SQLite storage path. They verify persistence across Miniflare/workerd
recreation for the same DO ID, but do not establish trusted Production time,
independent rollback resistance, Journal durability, or HSM behavior. Hosted
CI is **NOT_CHECKED**. Production clock, Journal/checkpoint, witness/restore
epoch, HSM/signer, bindings, and deployment remain unresolved; Production
acceptance and Stages A/B/C remain **BLOCKED**.

## 11. Official specifications checked 2026-11-02

- [Durable Object SQLite storage and PITR](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)
- [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Workers performance and timers](https://developers.cloudflare.com/workers/runtime-apis/performance/)
- [Workers RPC](https://developers.cloudflare.com/workers/runtime-apis/rpc/)
- [Durable Object roles and permissions](https://developers.cloudflare.com/workers/authorization/durable-objects/)
- [Service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
- [R2 consistency model](https://developers.cloudflare.com/r2/reference/consistency/)
- [R2 S3 API extensions and conditional writes](https://developers.cloudflare.com/r2/api/s3/extensions/)
- [R2 bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/)
- [D1 database and `batch()`](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [D1 global read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/)
- [D1 Time Travel and backups](https://developers.cloudflare.com/d1/reference/time-travel/)
- [Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare Secrets Store](https://developers.cloudflare.com/secrets-store/)
- [Secrets Store Workers integration](https://developers.cloudflare.com/secrets-store/integrations/workers/)
- [Secrets Store access control](https://developers.cloudflare.com/secrets-store/access-control/)
- [Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
- [Web Cryptography API](https://www.w3.org/TR/webcrypto/)
