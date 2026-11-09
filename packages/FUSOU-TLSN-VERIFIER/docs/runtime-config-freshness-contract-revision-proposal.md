# FUSOU TLSN Purpose and Freshness Contract Revision Proposal

**Status: NON-NORMATIVE PROPOSAL.** This document does not amend the Phase 0
Freshness protocol, relax a runtime gate, register a provider, or establish
Production acceptance.

**Review date:** 2026-11-09

**Repository baseline:** `tlsn-first-testplay-candidate` at
`8a87314a055f45d37f1ae5b0524561575ab9b7ea`

**Hosted evidence:** run [#115](https://github.com/tsukasa-u/FUSOU/actions/runs/42484486660)
passed three jobs for that baseline only. It does not cover the current
uncommitted tree.

The working tree was already dirty at the original review start and the index
was empty. That review added this proposal and made only small wording
corrections to mark the earlier AWS/DynamoDB recommendation as unadopted; it
changed no source, runtime configuration, key, Worker binding, or Production
resource. The later local-only prototype and its source changes are recorded
in Section 7 below. The protected files and audited canary test were not read
or inspected. The tagged
[external_init_script.js](../../FUSOU-APP/src-tauri/src/window/scripts/external_init_script.js)
contains UI layout, refresh, and shortcut behavior; it is not an authenticity,
Freshness, or APP-integrity authority.

## Executive recommendation

FUSOU TLSN's central claim is **evidence authenticity**: a captured exchange
is with the approved Game Server, its exact TLS transcript is covered by a
TLSN Presentation and trusted Notary verification, and the signed Result and
retained evidence can be independently checked. Freshness is a supporting
configuration-distribution protocol. It does not replace or prove that
evidence chain.

Cloudflare Workers, one SQLite-backed Durable Object (DO) per production
environment, and R2 can provide a coherent design for ordinary network
attacks, replay, conditional writes, per-environment serialization, exact
byte checks, and fail-closed recovery. R2 and DO consistency are useful
component guarantees; they are not a cross-resource transaction, a
non-exportable signing-key service, an authenticated clock with a published
uncertainty bound, or an independent witness against a common Cloudflare
restore or administrator.

The candidate trust profile to review is:

> Trust the Cloudflare control plane and authorized FUSOU release operators.
> Protect against network modification/replay, stale or mismatched individual
> resources, concurrent updates, and ordinary crashes/unknown outcomes by
> serialization, exact readback, and fail-closed quarantine. Do not claim
> automatic detection of malicious or accidental rollback of all Cloudflare
> state, Cloudflare-wide compromise, or a malicious authorized signer.

This is **not approved** by this document. It changes the rollback threat
model and conflicts with the current protocol's mandatory independent Journal
and anti-rollback witness. Under this profile, the current missing-witness
gate must still fail closed until the user approves an explicit new contract
and code/test migration. The existing eight-second authorization lease also
remains a hard unresolved requirement: Cloudflare's documented Workers timer
behavior does not establish a trusted wall clock or a bounded clock error.
Therefore a Cloudflare-only design is a viable **proposal for a reduced trust
model**, not evidence that every current Production Freshness guarantee is
implementable with the current Cloudflare services.

AWS/DynamoDB is an unadopted historical candidate, not a required next task.

## 1. Purpose, requirements, provenance, and Stage

The source-derived authenticity contract defines the main chain as approved
Game Server identity -> Web PKI/TLS -> exact request/response transcript ->
TLSN Presentation and Notary verification -> Dedicated Verifier -> signed
Result -> byte-identifiable evidence -> independent offline verification.
The [Stage A/B/C contract](../DEVICE-PROOF-MATERIAL-LINEAGE.md) distinguishes
protocol evidence, identity binding, and Production delivery. The tables
below distinguish a user instruction from a design choice or an observed
implementation; source presence alone is not proof that a feature is a
product requirement.

| Requirement | Failure or attack addressed | Repository evidence and current status | Stage | Origin established by the available record | Disposition |
|---|---|---|---|---|---|
| Actual TLS communication with an approved Game Server | Evidence from the wrong peer, a synthetic fixture, or a substituted endpoint | The source-derived [authenticity contract](../../../docs/architecture/tlsn-data-authenticity-contract.md) specifies this claim. Proxy/TLSN source exists, but real Game Server capture is **UNVERIFIED**. | A; inherited by B | Explicit in this request and the current authenticity contract | Maintain |
| Identity observed from the actual Presentation; canonical DNS and Web PKI validation | Candidate configuration being mistaken for observed peer identity; certificate or hostname mismatch | Production identity must be canonical lowercase DNS derived from Presentation and compared with Inventory/Target Approval. Local verifier source exists; real Production materials remain **UNVERIFIED**. | A; inherited by B | Explicit in this request and the current authenticity contract | Maintain |
| Trusted Notary/TLSN verification | Forged or structurally invalid Presentation being accepted | The alpha.15 verification boundary exists in source; a local verifier is not proof of a real Notary-backed Presentation or deployed service. | A; inherited by B | Explicit in this request | Maintain |
| Exact Presentation bytes bound into signed Result | Re-serialization, archive substitution, or a Result referring to different evidence | Result v2/v3 and signing contracts bind `presentation_sha256`; Production also requires the Inventory/Target Approval digest pair. Source contracts/tests exist; real Production Result is **UNVERIFIED**. | A; inherited by B | Explicit in this request and existing Result contract | Maintain |
| User/device/session correspondence | Evidence being attributed to another user, device, session, or binding | Stage B adds owner/device, Session/Binding signatures, possession/challenge/replay, and all required roles. The Result shape contains identity fields; live owner enrollment/deployment remains **BLOCKED**. | B, not the protocol-only claim of A | Explicit in this request; Stage placement comes from the existing stage contract | Maintain; do not claim actor attribution in A |
| Evidence preservation and independent re-verification | Loss, mutation, or dependence on the original Worker for later verification | Local bundle verification and Worker raw Presentation/Result archive readback exist. The Worker archive catalog reports `retention_status: NOT_CHECKED`; complete-Bundle remote retention is not implemented. | Local evidence verification in A/B; complete remote delivery in C | Explicit in this request; local/remote split is established by the Stage contract | Maintain the current raw Presentation/Result path; reserve complete-Bundle retention for C |
| At most one Game Server send per capture | Duplicate origin side effects after timeout, cancellation, restart, or unknown send outcome | The repository records this as user-confirmed on 2026-11-06. An ambiguous post-start send ends the capture; a later request is a new capture, not semantic deduplication. | A/B | User-confirmed repository contract and explicit in this request | Maintain |
| Manifest and artifact authenticity | Substituted runtime configuration or artifact | APP verifies signed Manifest and referenced artifacts; the exact shared code and local tests exist. Production Freshness route/signers and actual bindings are not registered. | A/B | Explicit in this request; existing Manifest protocol | Maintain |
| Freshness nonce and response replay rejection | Reuse of a response for a different request/audience | APP request/response contracts bind the nonce and audience; APP checks signatures, expiry, and persisted high-water. Production endpoint is not registered. | A/B | Explicit in this request and existing protocol | Maintain |
| APP Manifest/delegation high-water | A client that has accepted a newer epoch accepting a lower one | APP persists epoch, Manifest digest, Release generation/record digest, and Freshness delegation high-water; rollback is rejected when that local state is intact. First-run and local-state rollback have different limits. | A/B | Explicit in this request and existing APP contract | Maintain; do not describe it as a global first-run anchor |
| `LATEST_AT_ISSUANCE` current Release | Signing a Freshness response for an older Release while the service state is healthy | The Phase 0 protocol and issue core specify this semantic. The reader cross-checks Journal, Coordinator, R2 pointer/snapshot, Manifest, and witness. Production adapters are **NOT_IMPLEMENTED**. | A/B configuration prerequisite | Explicit in prior Freshness instructions and current protocol, but a supporting control rather than the TLS transcript's authenticity proof | Maintain semantics; provider realization remains **BLOCKED** |
| Release/Freshness concurrency control | A Release commit racing a Freshness issuance or finalization | The issue core uses a maximum 8-second lease, operation, fence, pre/post checks, exact finalization, and retained blockers. SQLite Coordinator behavior is locally runtime-tested; no Production DO binding exists. | A/B configuration prerequisite | Explicit in prior Freshness instructions and current protocol | Maintain fail-closed behavior |
| Safe handling of Unknown | Retry/re-sign, false success, or blocker release after a lost response | The issue core retains unresolved blockers and only returns finalized exact bytes. The local test adapters establish behavior only in tests. | A/B | Explicit in prior Freshness instructions and current protocol | Maintain; never infer completion from timeout |
| Detect an isolated DO or R2 rollback | One current-state projection being restored while the other remains current | Cross-checks can reject mismatched DO/Journal/R2 state. DO SQLite PITR can restore that object's database; R2 conditional writes apply per object. Production restore tests are **NOT_CHECKED**. | A/B operations defense | Current design; whether this is a product-level requirement beyond fail-closed mismatch is not independently established | Maintain mismatch rejection; qualify the threat boundary |
| Detect simultaneous rollback across DO, Journal, R2, and operation history | A mutually consistent old state being restored across every current authority | Current reader requires an independent witness. The proposed Cloudflare-only profile cannot detect common rollback when every comparison source is restored together. No Production witness is registered. | A/B under current design; additional defense under the proposed profile | Current protocol/design requires it; its necessity to the original evidence-authenticity purpose is not established | **Guarantee-scope proposal**: optional only if the user accepts Cloudflare/operator trust |
| Non-exportable HSM key custody | Extraction of an online Release/Freshness private key | Existing authority design proposes separate HSM-backed purpose keys, but no Production signer is registered. Cloudflare Worker Secrets are encrypted values accessible to Worker code; this is not evidence of HSM non-exportability. | Production operation for A/B | Design-selected defense; explicit need/acceptance is not established by the original evidence claim | Keep keys separate and Bootstrap root offline; custody decision remains **BLOCKED** |
| Trusted wall clock and uncertainty bound | Backdating, expired-delegation signing, or accepting a lease after its authorization window | Code carries clock ID/epoch/uncertainty and enforces the 8-second maximum. No Production clock adapter or clock-error evidence exists. Deployed Workers' `Date.now()`/`performance.now()` behavior is not a clock-accuracy guarantee. | A/B configuration prerequisite | 8-second Freshness bound is explicit in the prior request/current protocol; the choice of trusted time authority is unresolved | Keep the hard bound; no timer fallback; Production remains **BLOCKED** |
| Complete Bundle remote readback/retention | Partial or transient delivery being mistaken for retained Production evidence | Stage C requires complete Bundle remote readback/retention and independently verifiable delivery receipt. Existing Worker raw Presentation/outer-Result archive write/readback is narrower and must remain. | C only for complete-Bundle retention | Explicit in this request and Stage C contract | Maintain as C; do not remove A/B raw archives |
| Production execution/delivery receipt authority | A local/Canary receipt being presented as Production authority | Stage C requires approved Production execution/delivery authority. Current catalog is not a Production retention or execution receipt; Canary receipts do not grant it. | C | Explicit in this request and Stage C contract | Maintain as **BLOCKED** until separately approved |
| Resistance to malicious Cloudflare administrators or total provider compromise | A privileged actor changing code, secrets, or all account state | No current code or reviewed Cloudflare component proves protection from the provider/control-plane administrator. | Beyond current A/B; Production operations | No explicit product requirement located; threat model must be chosen | Proposed trust boundary, not a claim; user decision required |

### Stage interpretation

- **A — `TLSN_PROTOCOL_TESTPLAY`:** authentic protocol evidence for a real
  Game Server. User/device ownership and complete-Bundle remote delivery are
  not implied.
- **B — `IDENTITY_BOUND_TESTPLAY`:** A plus authenticated user/device/session
  association and local finalization/independent evidence verification.
- **C — `PRODUCTION_EVIDENCE_DELIVERY`:** B plus complete-Bundle remote
  delivery, readback, retention, an approved delivery receipt authority, and
  operational acceptance.

All three stages and Production acceptance remain **BLOCKED**. In particular,
the request's list places user/device/session correspondence among the core
topics, while the repository's stage contract makes it a B addition. This
proposal keeps the cryptographic protocol claim separate from the actor
attribution claim.

## 2. Threat model under the Cloudflare trust candidate

The last column names whether the candidate **prevents**, **detects and stops**,
**trusts an operator**, or treats the event as **out of scope**. “Detect and
stop” means no Freshness response/evidence acceptance is returned; it is not
automatic recovery.

| Case | Existing or candidate control | Candidate result and category |
|---|---|---|
| 1. Network modification or replay | TLS and signature verification, exact-byte/digest binding, challenge nonce/audience, redirect/cache controls, APP high-water; invalid evidence fails closed. | **Prevent** tampering/replay within the cryptographic contract; **detect and stop** malformed or mismatched responses. Does not prove a real deployment or Notary operation. |
| 2. Replay of an old but correctly signed Manifest | Signature proves the bytes/signing authority, not latestness. APP nonce prevents response replay across challenges; local high-water rejects an older epoch after a newer one was accepted. Freshness service must read the live Release head. | **Detect and stop** a stale response against intact high-water/current state. A common rollback of all Cloudflare authorities can make the old state look current; that residual is **trusted** under this profile. |
| 3. APP first start vs. existing high-water | Existing clients compare epoch, digest, Release generation and delegation high-water. `PriorState::Missing` has no earlier local value to compare. | Existing state: **detect and stop** regression. First start: trust the live Cloudflare current-state service and signed chain; no device-local prior high-water exists. |
| 4. Concurrent Release, crash, lost response | One per-environment DO transaction serializes release/issue gates. R2 pointer CAS is a separate operation. Persist intent, read back exact bytes, reconcile by stable operation ID; Unknown retains the blocker. | **Prevent** conflicting local DO transitions; **detect and stop** mismatches and unresolved outcomes. There is no DO/R2 cross-resource transaction. |
| 5. R2 pointer-only or DO-only rollback | Compare exact pointer/ETag, immutable snapshot, Release head and Coordinator state; mismatch or missing state quarantines. R2 documents strong consistency and atomic conditions for one object. | **Detect and stop** when another comparison source remains current. Does not detect a mutually consistent restore of all sources. |
| 6. Planned restore by an authorized operator | Disable Freshness issuance, retain the release gate, reconcile the object pointer and signed Manifest, record an operator-approved restore event, verify current state, then re-enable. | **Trust the operator** and runbook. A restore epoch stored only in the restored DO is not an independent proof of history. |
| 7. Malicious administrator rolls back several Cloudflare resources together | No separate Cloudflare namespace/bucket/Worker provides an independent trust root by itself. | **Out of scope / trusted operator** under the candidate profile. Automatic detection is not claimed. A user who requires this protection must retain an independently administered witness beyond the common restore/control plane. |
| 8. Cloudflare account/control-plane compromise | Separate Workers, bindings, bucket policies and restricted roles reduce ordinary code access but remain in one provider administration domain. | **Out of scope** under the candidate profile. No Cloudflare-only claim of resisting provider-wide compromise. |
| 9. Release or Freshness signer compromise | Separate keys and purpose-limited APIs constrain a single key's authority. A malicious Freshness signer can still sign a new nonce with a false “latest” claim; a malicious Release signer can authorize a bad release within its delegation. | **Detect and stop** only where an independent verifier finds a concrete signature/schema/policy mismatch. Otherwise **trust the authorized signer**. A compromised signer is not neutralized by DO/R2 consistency. |
| 10. Bootstrap root compromise | Keep the root offline, use distinct delegations, and define a separate root-rotation/recovery procedure. | Root compromise can forge the trust chain; **out of scope** for this runtime design and requires a separately approved recovery ceremony. |
| 11. Malicious local APP user changes the clock, high-water file, or APP binary | APP validates signed material and persists high-water for ordinary operation; its local file and verifier are not remote authorities. | **Out of scope** for adversarial APP process/image integrity. Do not add TPM, measured boot, privileged helpers, or browser-integrity claims. Evidence remains independently verifiable by a trusted offline verifier. |

The candidate reduces the claim compared with the current P2 design: it accepts
the Cloudflare administrator and authorized release operators as trusted,
rather than promising independent detection of a mutually consistent
multi-resource rollback. If that is not acceptable, the current mandatory
witness remains required and a Cloudflare-only implementation is incomplete.

## 3. Cloudflare-centered minimum configuration

The following is a proposed role layout, not a statement that these
Production Workers or bindings exist. It reuses the present provider-neutral
interfaces and local SQLite runtime tests where possible.

```text
Offline Bootstrap root (never a Worker binding)
        |
        +-- Release Authority Worker / narrowly typed Release signer
        |       |
        |       +-- one ReleaseLedgerCoordinatorDO per environment
        |       |      proposed canonical Release log + issue coordinator
        |       |
        |       +-- R2 Runtime Config bucket
        |              immutable Manifest/artifacts + CAS mutable pointer
        |
APP --> public Freshness Gateway (7-second transport boundary)
              |
              +-- private Service Binding --> Freshness signer Worker
                                                |
                                                +-- ReleaseLedgerCoordinatorDO
                                                +-- read-only Runtime Config R2

APP --> public read-only Manifest/artifact path on the pinned origin

Existing verification Worker / Result signer / Binding DO remain separate
from the Release and Freshness signing roles.
```

| Role | Proposed responsibility | Boundary and current status |
|---|---|---|
| Bootstrap root | Offline root trust for Manifest and Release/Freshness delegations; never exposed to a Worker. | Preserve the current root trust and domain separation. Root custody/rotation is still an operational decision. |
| Release approval and signing | A release operator approves exact candidate Manifest/artifact digests. A purpose-limited Release signer authorizes one exact Release record; no generic `sign(bytes)` endpoint. | A dedicated Worker and Service Binding can isolate normal code paths. If the private key is a Worker Secret, Worker code can read it; this is not an HSM. No such Production signer is registered. |
| Canonical Release head and issue Coordinator | Under the reduced Cloudflare-trust profile, combine the application-level Release log, current head, writer gate, issue operation ledger, fencing, exact finalization, quarantine and restore marker in one SQLite-backed DO per environment. | One object's synchronous transaction can atomically compare/update its own rows. This moves the Release commit point to that DO transaction and is a contract change. The existing Coordinator is local/runtime-tested but has no Production binding/configuration. |
| R2 Runtime Config | Store exact signed Manifest envelope and content-addressed immutable snapshots/artifacts; update the one mutable pointer with conditional write; read back bytes and ETag before reopening the DO gate. | R2 strong consistency and one-object conditional writes help; object writes and DO transactions are not atomic together. Current publisher/tests use injected Node/S3-compatible/fake adapters, not a registered Production Runtime Config Worker binding. |
| Freshness Gateway | Validate the canonical APP request and audience, apply the 7-second HTTP boundary, call only the Freshness signer over a private binding, and return exact bounded response bytes. | The source Worker currently has no production route or signer binding and returns unavailable if bindings are absent. It is not an authority and must not hold state or keys. |
| Freshness signer | Acquire/resolve the issue operation, read the current DO head and R2 bytes, verify Release/Manifest signatures and bindings, sign only the challenge-bound response, recheck, and finalize exact bytes before returning. | Existing core enforces pre/post checks and exact finalization. The missing Production clock/key/DO/R2 adapters remain blockers. |
| APP and offline verifier | APP independently verifies the existing wire contract, nonce, signatures, Manifest/artifacts and local high-water. The offline verifier verifies the evidence Bundle from exact material. | Keep current Rust/JS contracts and exact byte handling. A trusted current-head answer is still an assertion by the Freshness signer; offline Result verification proves evidence authenticity, not live Release latestness. |
| Result/Session/Binding authority | Continue to use the existing purpose-specific Result, Session and Binding roles. | Do not merge their keys or authority with Release/Freshness. A Canary/execution receipt does not become Production delivery authority. |
| Evidence archive | Keep current raw Presentation and outer-Result archive write/readback required by the A/B Worker path. | The catalog presently covers Presentation and Result and reports retention as `NOT_CHECKED`; this is not a full Stage C Bundle. |
| Stage C delivery | Add complete-Bundle remote upload, exact readback, configured retention, and a separately approved Production delivery receipt authority. | R2 bucket-lock retention may be evaluated using the existing product, subject to configuration, cost, and operational review. It does not make a Journal or witness independent of Cloudflare administration. |

### DO boundary choices

**Dedicated Journal DO.** A SQLite-backed DO can serialize append operations
and current-head reads within its own instance. A typed append-only application
API can reject update/delete requests and atomically compare the expected
previous head. This is a useful logical Journal for the reduced trust profile.
It does not provide an external append receipt/time source or protection
against its own PITR restore.

**Journal DO separate from Coordinator DO.** This separates application
responsibilities and can narrow Worker bindings, but two DO instances do not
share a transaction. Release intent, pointer CAS, Journal append, Coordinator
finalization, and issue gates form a recovery protocol. If a call is lost
between any two steps, retain the gate and reconcile the same attempt; do not
assume rollback or retry changed bytes. Separate DO namespaces in one
Cloudflare account are not independent witnesses.

**Journal and Coordinator combined in one DO (candidate minimum).** A
single per-environment SQLite transaction can atomically append the local
Release log row, advance the current head, and serialize against issue
operations. This reduces internal cross-DO recovery and is the proposed
minimum for a trusted-Cloudflare profile. It also makes Journal and issue
tombstones share one restore domain, centralizes authority and throughput, and
means a PITR restore can rewind both. R2 remains an external saga participant.
This changes the current external-Journal commit contract and is not yet
approved.

**R2 and cross-resource operations.** A conditional pointer update has a
linearization point for that object only. The immutable snapshot write,
pointer CAS, DO transaction, and any signer call cannot be one atomic
transaction. Persist intent, perform one external operation, read back exact
bytes/ETag, then make the next DO transaction. R2 documents that a negative
read during an earlier in-flight write does not prove that write cannot later
commit. Unknown outcomes therefore keep issuance blocked.

**Append-only and retention.** An append-only DO RPC contract is an
application invariant, not administrator-immutable storage. Cloudflare
documents that DOs have no separate per-DO roles and that Editor access to
Data Studio can query and modify DO SQLite data. R2 Bucket Locks can prevent
object overwrite/deletion for configured periods, including indefinite
retention, but are bucket policy under Cloudflare administration. Neither
feature is an independent current-head witness.

**Service Bindings and account roles.** Service Bindings avoid a public URL
and give a Worker a direct route to another Worker. They are useful for
separating Gateway, signer and authority code and assigning narrower Worker
bindings. They do not authenticate an application-level method, create a DO
per-method ACL, or protect against an administrator who can change the
Workers/bindings. Enforce typed role authorization inside the DO and restrict
deployment/configuration roles; treat those controls as operator trust.

### Restore and recovery sequence

1. Disable new Freshness issuance by removing/disabling the Gateway route or
   signer binding, and mark the DO `QUARANTINED` through the authorized
   recovery path. Do not reset counters or initialize missing state as
   generation zero.
2. Resolve every release/issue operation by its stable operation ID and exact
   digest. `UNKNOWN`, an unavailable read, or an unresolved signer result
   keeps the blocker.
3. Verify the Release log/head, exact R2 pointer, content-addressed snapshot,
   Manifest signature, artifacts, and expected generation. A disagreement
   remains quarantined.
4. For a planned restore, record an operator-approved restore ticket outside
   the restored DO state, reconcile the intended current Release, and require
   a new authorized transition before re-enabling issuance. Under the
   Cloudflare-only profile this relies on trusted operators; it is not an
   independent proof against malicious account administrators.
5. Re-enable issuance only after a fresh read confirms a single consistent
   state and all operation blockers are terminal. Do not use an expired timer
   or the fact that a Worker restarted as proof of signer cancellation.

If the DO, R2 and all stored high-water state are restored together, this
runbook cannot cryptographically infer the former head. That is the guarantee
the reduced trust profile gives up.

## 4. Clock, key custody, and witness decisions

### Clock and deadlines

| Limit | Meaning | What it does not mean |
|---|---|---|
| APP 10 seconds | One monotonic deadline for the Freshness exchange, Manifest/artifact fetch, verification, and guarded local state acceptance. The current source checks the deadline before the atomic state replacement; it does not promise that all later filesystem sync/return work completes within ten seconds. | Not a Freshness authority clock and not a promise that a malicious local user cannot alter the APP. |
| Gateway 7 seconds | HTTP forwarding/response deadline. Disconnect or timeout does not prove that signer/DO/R2 work stopped. | Not permission to release a lease, clear an operation, or re-sign. |
| Issue lease at most 8 seconds | Current protocol's authorization bound; issue/finalization is rejected outside the trusted reading interval. | Not an SLO, not a processing target, and not an automatic blocker expiry. |

The issue core carries `clockId`, `clockEpoch`, `nowMs`, and
`uncertaintyMs`, checks them before/after signing, and bounds the entire
uncertainty interval. Those fields require a real source; a timestamp plus a
boolean does not authenticate time. APP's `tokio::time::Instant` is its local
monotonic deadline. It does not provide the signer's trusted UTC or
cross-restart epoch.

Cloudflare's current Workers timer documentation says deployed `Date.now()`
and `performance.now()` only advance after I/O for timing-side-channel
mitigation, while local development timers advance independently of I/O. It
does not publish an authenticated wall-clock accuracy/uncertainty bound for a
Worker or DO. Therefore neither `Date.now()`, `performance.now()`, an alarm,
nor local Miniflare tests establish the hard 8-second authorization cutoff.

**Proposal:** retain the current hard 8-second cutoff and keep Production
Freshness **BLOCKED** until a clock adapter with source identity, epoch,
monotonicity and a defensible uncertainty bound is selected and verified.
Do not silently re-label it as an SLO. An alternative contract that removes
the elapsed-time cutoff and relies only on logical fencing would be a
material change: an unresolved issue could block Release indefinitely, and
the current clock/lease semantics and tests would need a reviewed protocol
migration. No such change is made here.

### Key separation and custody

- Keep the Bootstrap root offline; do not bind or import its private key into
  a Worker.
- Keep Release authorization, Freshness response, Result, Session, and
  Binding keys purpose-separated with distinct signature domains and
  typed operations.
- A non-exportable HSM can reduce raw key extraction. It does not prevent an
  authorized but compromised signer API from issuing malicious signatures.
  API authorization, policy validation, rate/operation binding, monitoring,
  and key separation remain necessary.
- Cloudflare Worker Secrets are encrypted values accessible to Worker code.
  They can be considered only if the user accepts Worker-code/account
  administrators as trusted for online signing. They are not a substitute
  for an HSM's non-exportability guarantee.
- The Cloudflare-only Worker-Secret option would weaken key-extraction
  resistance and is **NOT_SELECTED**. If that loss is unacceptable and no
  existing HSM contract is available, Release/Freshness Production signing
  remains **BLOCKED**; do not move the root online or silently add another
  paid service.

### Witness scope

The existing witness is intended to compare
`(environment, chain, restoreEpoch, sequence, Release generation, Record
digest)` against a separately retained monotonic high-water. That is useful
only when its operator, credentials, restore scope, and retention are
independent for the specific rollback being claimed. Another DO namespace,
bucket, Worker, or key under the same Cloudflare administration is a separate
resource, not an independent authority.

Under the candidate trust profile, keep DO/R2 mismatch checks and quarantine
for an isolated restore, but do not require a separate witness to claim
protection against a malicious Cloudflare-wide administrator. Omission would
lose automatic detection of a mutually consistent rollback, including a
rollback of the DO issue-operation/tombstone ledger. A Release-generation
witness alone would not protect those issue tombstones. Until the user accepts
this limitation, the current reader's required-witness behavior remains
unchanged and missing witness must continue to fail closed.

## 5. Contract delta and implementation impact

Every item below is a proposal, not a revision already in force.

| Contract surface | Current contract/source | Proposed delta | Classification |
|---|---|---|---|
| Evidence authenticity chain, observed identity, exact bytes, Notary and offline verification | Existing authenticity contract and Result/Presentation bindings | No change | 説明の整理のみ |
| User/device/session attribution | Stage B requirement; A does not by itself prove actor ownership | Clarify that actor attribution is B even though Result wire fields may be present | 説明の整理のみ |
| APP wire, Manifest v2, nonce, audience, high-water and exact artifact checks | Existing APP/Rust verifier and signed protocol | No change | 現行保証を維持した実装方法の変更 is not proposed |
| Raw Presentation and outer-Result write/readback on current Worker Production path | Existing A/B path dependency | Preserve; do not remove because full Bundle retention is Stage C | 説明の整理のみ |
| Complete Bundle remote retention and Production delivery authority | Stage C requirement, currently absent | Keep exclusively in C; implement a dedicated full-Bundle readback/retention/receipt path | 未解決で引き続きBLOCKED |
| Canonical Release Journal | Current Phase 0 uses an external canonical Journal; append is Release commit point | Candidate combines Release log and issue Coordinator in one per-environment DO | 保証範囲の変更を伴う提案 (trust domain and commit authority move) |
| Independent rollback witness | Current reader requires an independent witness and current-head proof | Candidate makes it optional only under an explicitly accepted Cloudflare-operator trust profile | 保証範囲の変更を伴う提案 |
| Current Release consistency | Current reader compares Journal, Coordinator, R2 pointer/snapshot, Manifest and witness before/after signing | Candidate compares one DO authoritative head with exact R2 bytes; independent witness proof is removed only after contract approval | 保証範囲の変更を伴う提案 |
| DO/Coordinator transaction | Existing SQLite snapshot and issue core are locally runtime-tested; production binding is absent | Reuse the per-environment DO but add a single local append/head transaction; keep all R2 I/O outside it | 現行保証を維持した実装方法の変更, contingent on trust-profile approval |
| Release append time and Freshness lease clock | Current protocol needs authenticated append/issue time and uncertainty | Cloudflare documentation does not supply the required trusted bound; keep current checks with no fallback | 未解決で引き続きBLOCKED |
| HSM custody | Existing Production design selects purpose-specific HSM signers; no signer is registered | Do not substitute Worker Secrets unless user explicitly accepts weaker non-exportability | 未解決で引き続きBLOCKED |
| Shared restore and Cloudflare administrator compromise | Current witness design seeks independent rollback detection | Candidate trusts Cloudflare and authorized operators; full/common rollback and control-plane compromise are outside the claim | 保証範囲の変更を伴う提案 |
| AWS/DynamoDB | Earlier comparison only | Treat as unadopted historical candidate; it is not a prerequisite or the next implementation task | 説明の整理のみ |

No runtime `if missing witness then pass`, alternate unverified adapter,
wire-field removal, clock fallback, key fallback, or gate relaxation is
proposed. The current reader and production acceptance continue to fail
closed.

### Existing code and test impact if the proposal is approved

No code changes are made in this review. A later implementation would need to:

1. Add a Production-capable Cloudflare DO class/binding and migrations; the
   existing Coordinator package currently provides a local Workers runtime
   test path, not a registered Production DO.
2. Define one operation-idempotent, exact-byte append/read API and store the
   head, append records, issue operations, writer gate, fences, and unresolved
   outcomes in one SQLite transaction boundary.
3. Add a Production R2 binding/adapter for exact pointer/snapshot readback and
   conditional pointer update; preserve the current signed-envelope format
   and content-addressed snapshot.
4. Replace the external Journal/witness proof adapter only if the user
   accepts the proposed trust model. Do not manufacture a signed “proof” from
   a DO self-assertion or a `Verified`-named object.
5. Revisit the 8-second clock and online key custody separately. Passing
   local tests is not enough to mark either Production guarantee verified.
6. Preserve Gateway 7-second and APP 10-second deadlines, APP high-water,
   pre/post signing verification, exact finalization, and all existing
   fail-closed behavior.
7. Leave Game Server capture, exact Presentation/Result binding,
   user/device/session proof, raw archive readback, Stage C receipt authority,
   and Canary/Production separation unchanged.

## 6. Normal sequence and failure behavior for the candidate

### Release

1. An authorized operator approves a canonical Manifest/artifact set. The
   Release worker verifies exact bytes, schema, root/delegation, environment,
   epoch, Inventory/Target Approval pair, and all referenced artifacts.
2. The Release coordinator transaction sets `writer_pending`, records the
   stable attempt ID and expected prior head, and refuses new issue leases.
   Existing issue operations must become known terminal results; expiry alone
   never clears one.
3. Write content-addressed immutable Manifest/artifact objects to R2 and read
   them back byte-for-byte. Update the mutable signed-envelope pointer with a
   conditional write against the observed ETag (or approved genesis
   `If-None-Match: *`).
4. Read the pointer and immutable snapshot back and verify exact digest,
   reference, ETag, Manifest signature and Release bindings. Any mismatch or
   unknown write outcome retains the gate.
5. In one DO transaction, conditionally compare the expected prior head,
   append the exact authorized Release record to the application log and
   advance generation. This is the proposed logical commit point, not an
   R2/DO distributed transaction. The DO cannot query R2 inside that
   transaction and must not turn a caller's `verified` flag into evidence.
   Keep the writer gate closed until an authorized recovery/finalization call
   independently repeats exact R2 pointer/snapshot readback and confirms the
   recorded digest, reference and ETag. Any disagreement quarantines the
   committed head rather than serving it.
6. Query the same attempt ID after a lost response. Exact committed bytes
   resolve success; different bytes, a competing head, a negative read while
   the original write may be in flight, or provider error remains
   **UNKNOWN/BLOCKED**.

### Freshness

1. APP creates its one-use nonce and canonical audience-bound challenge.
   Gateway validates the request and applies its independent transport
   deadline, then calls the private signer binding.
2. The signer begins or retrieves only the same issue operation. The
   Coordinator DO denies admission while a Release/recovery gate is active
   and returns a lease/fence only from the current committed head.
3. The signer reads the current DO head and R2 pointer/snapshot, checks exact
   bytes, Release/Manifest signatures, delegations, environment and audience,
   then signs only the challenge-bound response.
4. The signer rechecks the lease/current state, verifies exact response bytes,
   and atomically finalizes the exact result under the same operation,
   request digest, fence, and current-state binding. Only then may Gateway
   return those bytes.
5. An unknown signer or finalization result returns no bytes and preserves
   the operation blocker. A repeated same issue operation may retrieve exact
   finalized bytes; that is not permission to retry a Game Server capture.
6. APP verifies the response, persisted high-water, Manifest and artifacts,
   then commits local high-water under its existing 10-second deadline. A
   different nonce requires a different response.

If the current clock requirement cannot be met, step 3 cannot be represented
as satisfying the current hard lease contract. The sequence then remains
design-only and Production Freshness stays **BLOCKED**.

## 7. Local prototype implementation and completion criteria

**Status (2026-11-09): implemented and verified as a local-only prototype.**
The trust-profile decision above is still open; it did not block implementing
the requested serialization and recovery model. The implementation uses the
existing Coordinator rather than copying it:

- [sqlite-freshness-issue-coordinator.ts](../../FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/src/sqlite-freshness-issue-coordinator.ts)
  persists Release operation, entry, and head state in the same SQLite-backed
  DO as Freshness issue operations.
- [release-ledger.ts](../../FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/src/release-ledger.ts)
  defines operation states and exact byte bindings.
- [r2-release-store.ts](../../FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/src/r2-release-store.ts)
  publishes immutable Manifest snapshots, conditionally updates the pointer,
  and verifies exact pointer/snapshot bytes and ETag.

The local state progression distinguishes `INTENT`, `R2_WRITE_PENDING`,
`R2_STAGED`, `LEDGER_COMMITTED`, `R2_READBACK_PENDING`, `AVAILABLE`,
`RESULT_UNKNOWN`, `QUARANTINED`, and `CONFLICT`. `LEDGER_COMMITTED` is only
the SQLite append linearization point; it does not open the Freshness writer
gate. `AVAILABLE` is reached only after exact R2 readback and a same-operation,
fence, predecessor, and head recheck in SQLite. It is still distinct from an
installed issue binding. The local-only install path now independently
verifies Release evidence, then conditionally bootstraps or advances the
Coordinator's current-state binding in a second SQLite transaction. Production
eligibility still requires the existing Journal evidence, independent
witness, trusted clock, and key custody.

**Inputs:** exact signed Release Commit Record and delegation bytes; stable
release operation ID; expected prior head/generation; signed Manifest bytes,
epoch/digest/immutable reference; exact pointer bytes/ETag readback; Freshness
operation ID, request digest/nonce/audience, lease/fence, and explicit clock
reading. Binding install uses a distinct install operation ID and proof
context; it does not invent an issue operation or lease for bootstrap.

**Outputs:** durable Release and install operation results and exact head or
binding snapshots. Repeating an operation ID with the same request returns
its stored result; conflicting bytes/bindings are rejected. An `INSTALLED`
result remains queryable after later advances and cannot roll back the current
binding. Unknown, verifying, and quarantined operations keep the relevant
writer/issue gate closed. `localAppendObservedAt` is the local Coordinator
clock observation needed by the current record verifier; it is not an
authenticated provider append receipt or trusted Production Journal time.

The Release reader now exposes an independent evidence-verification context
separate from the issue operation/lease context. The install proof binds its
mode, environment/chain, install and Release operation IDs/fences, expected
previous binding, target head, restore epoch, clock, nonce, and digest. Before
install, a synchronous SQLite transaction rechecks the still-`AVAILABLE`
head/operation, both fences, exact verified evidence bindings, restore epoch,
expected prior state, and issue/recovery blockers. R2 and signature
verification remain outside that transaction. The issue reader still
revalidates the installed state with its issue-specific operation, lease,
proof context, and Coordinator snapshot before and after signing; install does
not bypass exact response finalization.

Bootstrap is a separate, one-time path: a local-only explicit test
authorization and initial Release checkpoint are required. Absence of
current-state data alone is not treated as genesis; retained Release/install
history, malformed state, or an already completed bootstrap prevents
automatic rebootstrap. This is not a Production genesis contract. Advance
requires the expected old binding and Release predecessor. `VERIFYING`
attempts are not cleared by restart or timeout; stale verification or changed
state is rejected/quarantined, and only the same install operation can query
its durable result.

**Local conformance evidence:** Coordinator typecheck passes and the pinned
Miniflare/workerd suite passes **56/56**. The suite uses test-only signed
fixtures, a local DO bootstrap helper, and test-only R2 fault injection. It
covers the prior Release-ledger cases plus:

- explicit first-binding bootstrap, AVAILABLE-head advance, real issue-core
  signing/finalization, and no rollback from replaying an older install;
- same-operation result lookup after response loss and runtime recreation;
- rejection before install for `LEDGER_COMMITTED`, stale or changed head,
  fence, predecessor, restore epoch, witness, R2 pointer/snapshot/reference/
  ETag, and retained issue blockers;
- refusal to bootstrap from missing/corrupt state or to overwrite an existing
  binding.

- concurrent predecessor writers, exact operation idempotency, same-ID
  request conflict, exact Record bytes, and later-head lookup of the earlier
  operation;
- post-commit append-response loss, delayed R2 write with a negative read,
  same-operation reconciliation, post-append readback Unknown, restart
  persistence, and fail-closed missing/corrupt state;
- invalid Record/delegation, stale predecessor/generation/fence,
  wrong environment/chain, pointer/snapshot/ETag mismatch, and operation
  Manifest digest/reference corruption;
- writer admission and issue-finalization ordering, with no Freshness issue
  admitted while Release holds the writer fence or waits for exact readback.

These are local model tests, not evidence that Cloudflare provides an
authenticated Journal receipt, an independent witness, trusted time, HSM
custody, external rollback detection, or a cross-resource DO/R2 transaction.
The R2 adapter is a single-DO local integration; no Production bootstrap,
provider registration, external operation endpoint, deployment, or real
Production restore path was added.

**RPC cleanup status — 2026-11-09 follow-up:** the same 56 assertions now
pass with no RPC-stub warning in the pinned runtime. The earlier direct
Node-side `getDurableObjectNamespace().get()` call path left Workers RPC
capabilities behind Miniflare's platform proxy, which does not forward
`Symbol.dispose`. In a three-case bootstrap/advance/restart reproduction,
replacing real R2 reads with fixture reads left the warnings unchanged;
placing the same DO RPC calls in a Worker-owned execution context and
explicitly disposing their result/call handles removed them. The full suite
then passed through that same ownership boundary, including all rejection,
fault, response-loss and restart cases.

The harness now calls an allowlisted test-only Worker endpoint through
Miniflare's Worker fetch API. That Worker invokes the real DO RPC methods,
serializes only DTO values (preserving `Uint8Array`/`ArrayBuffer` bytes), and
disposes RPC handles before returning the data to Node. It is not a
Production route or authority, and does not change source gates, trust
checks or the APP wire format. The supervisor forwards all child output
unchanged and fails if the undisposed-stub warning recurs, even when all
assertions pass. Output closure and process-group cleanup remain bounded.

**Hosted/Production status:** the candidate workflow already runs Coordinator
typecheck and `test:runtime`, but no Hosted run was started for these
uncommitted changes. Run [#115](https://github.com/tsukasa-u/FUSOU/actions/runs/42484486660)
still covers only the baseline SHA. Stage A/B/C and Production acceptance
remain **BLOCKED**.

**Next validation unit:** after the user commits and pushes the intended
source and new files, confirm the candidate workflow for that exact revision,
including all 56 runtime cases and the warning-failure gate. No Hosted run
was started by this follow-up. Production acceptance remains separately
blocked by clock, key-custody, witness, genesis and live deployment evidence.

## 8. Cloudflare primary sources reviewed

The following current Cloudflare documentation supports only the stated
component behaviors; it does not certify FUSOU's adapters or threat model.

- [SQLite-backed Durable Object Storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) and [Access Durable Objects Storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/): per-object transactional/strongly consistent storage and SQLite PITR for the previous 30 days.
- [Durable Objects roles and permissions](https://developers.cloudflare.com/workers/authorization/durable-objects/): DO access follows access to the Worker; there are no separate DO roles. Data Studio Editor access can query and modify DO SQLite data.
- [R2 consistency model](https://developers.cloudflare.com/r2/reference/consistency/): global read-after-write consistency; atomic conditional writes for one object; negative reads do not settle an earlier in-flight write.
- [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), [R2 conditional S3 operations](https://developers.cloudflare.com/r2/api/s3/extensions/), and [R2 Bucket Locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/): conditional object operations and configurable overwrite/delete retention. These are not cross-resource transactions or an independent witness.
- [Workers Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/): direct Worker-to-Worker calls without a public URL. A binding is not the DO's method-level authorization contract.
- [Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/): encrypted text values accessible to Worker code. This page does not establish HSM-style key non-exportability.
- [Workers performance and timers](https://developers.cloudflare.com/workers/runtime-apis/performance/): deployed `Date.now()` and `performance.now()` only advance after I/O; local development differs. This does not specify the bounded trusted clock required by the 8-second lease.

## 9. Decisions required from the trust owner

1. **Trust boundary:** accept Cloudflare and authorized FUSOU administrators
   as trusted, with common rollback/control-plane compromise outside the
   guarantee, so the canonical Release log and Coordinator may share one DO
   and an independent external witness is not a baseline requirement? If not,
   the current independent-witness contract remains mandatory.
2. **Clock:** retain the hard 8-second authorization cutoff and leave
   Production blocked until a bounded clock is evidenced, or approve a
   separate protocol change to remove the elapsed-time cutoff in favor of
   logical fencing and indefinite blocking on unresolved work?
3. **Online key custody:** is an online Worker-readable delegated key
   acceptable under the Cloudflare-operator trust profile, or is non-exportable
   HSM custody mandatory even if it requires a separately approved provider?

Until those decisions and the remaining Production dependencies are resolved,
the current normative protocol, fail-closed reader, Stage A/B/C blockers, and
Production acceptance blocker remain unchanged.
