# FUSOU TLSN Purpose and Freshness Contract Revision Proposal

**Status: local profile decision recorded; Production contract adoption remains
pending.** The selected `cloudflare-operator-v1` profile applies to the local
Runtime Config Freshness implementation and its tests only. It does not
authorize Production deployment, resource creation, key registration, or
acceptance. The existing `strict-journal-witness-v1` profile remains unchanged.

**Original review snapshot (2026-11-09):** branch
`tlsn-first-testplay-candidate`, baseline
`8a87314a055f45d37f1ae5b0524561575ab9b7ea`, Hosted run
[#115](https://github.com/tsukasa-u/FUSOU/actions/runs/42484486660). Run #115
passed three jobs for that earlier baseline.

**Current review status (2026-11-10):** repository root
`/home/ogu-h/Documents/GitHub/FUSOU`, branch
`tlsn-first-testplay-candidate`, HEAD
`69d30a7b1e3c62ae06018e405af019c3a3fba727`. Existing in-scope source and
documentation worktree edits were present and preserved; no change was staged.
Protected paths were excluded.

**Current Hosted evidence:** run
[#116](https://github.com/tsukasa-u/FUSOU/actions/runs/42638941184), attempt 1,
completed successfully for SHA `69d30a7b1e3c62ae06018e405af019c3a3fba727`.
All three jobs passed: `rust-tlsn-preflight`,
`proxy-capture-source-unit-tests`, and `node-contract-tests`. In the latter,
step 21, “Test independent TLSN verifier, CLI, and candidate finalizer,”
reported 149 Verifier library tests and 5 CLI tests passed; step 27, “Test
Freshness, Production Result, and candidate readiness contracts,” includes
the Coordinator runtime result of 56 passed and 0 failed. The captured job
logs contain no “An RPC stub was not disposed properly” warning.

These are **HOSTED_CI_VERIFIED** results for the exact commit only. They are
not Production service, real Game Server/Notary, clock, key-custody, witness,
restore, deployment, or Production-acceptance evidence. The dated
2026-11-09 “uncommitted” and Hosted `NOT_CHECKED` statements below describe
that earlier snapshot; run #116 supersedes only the Hosted status for SHA
`69d30a7b1e3c62ae06018e405af019c3a3fba727`.

**Follow-up implementation selection:** the user explicitly selected the
Cloudflare/operator profile for local integration and regression testing:
the SQLite DO is the canonical Release/issue state; R2 remains an exact
readback participant, not a transaction peer or independent witness; the
strict eight-second issue cutoff is replaced only in the new profile by
durable operation/fence/head checks; and purpose/environment-limited
Worker-readable Release/Freshness child keys are allowed in the profile.
APP 10-second and Gateway 7-second deadlines, signed-object validity checks,
Bootstrap-root offline custody, strict-profile witness checks, and
Production blockers are unchanged. This is not a claim that Cloudflare
provides a trusted error-bounded clock or HSM-equivalent key protection.

At this follow-up's start, in-scope source and documentation worktree changes
were already present and were preserved; no changes were staged. The protected
paths and audited canary test were not read or inspected. The tagged
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

The selected local implementation profile, with Production adoption pending,
is:

> Trust the Cloudflare control plane and authorized FUSOU release operators.
> Protect against network modification/replay, stale or mismatched individual
> resources, concurrent updates, and ordinary crashes/unknown outcomes by
> serialization, exact readback, and fail-closed quarantine. Do not claim
> automatic detection of malicious or accidental rollback of all Cloudflare
> state, Cloudflare-wide compromise, or a malicious authorized signer.

**Selected for local implementation, not Production approval:** use one
Cloudflare/operator profile: trust the named Cloudflare control-plane and
authorized FUSOU operator boundary instead of requiring an independent
rollback witness; replace the strict eight-second issue cutoff with durable
logical fencing and an Unknown state that never expires automatically; and
permit Worker-readable, purpose-limited Release/Freshness child keys while
keeping the Bootstrap root offline. Retain the existing signed-time and
expiry checks. This is the lowest-dependency local path without adding a
clock or HSM provider, while preserving the TLSN Presentation/Result/Evidence
verification chain.

This profile knowingly gives up automatic detection of a mutually consistent
Cloudflare rollback, resistance to raw child-key extraction from compromised
Worker code, and a hard elapsed-time cutoff on authorization. Those losses
are accepted for the local implementation/test profile, not asserted as
equivalent guarantees. Production adoption remains unapproved and blocked:
Cloudflare's documentation does not establish a bounded clock error, and no
Production operator, key, DO/R2 binding, endpoint, or recovery authority has
been registered. Until those Production prerequisites are separately
approved, the existing strict profile remains available and fail-closed.

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
| Release/Freshness concurrency control | A Release commit racing a Freshness issuance or finalization | The issue core uses a maximum 8-second lease, operation, fence, pre/post checks, exact finalization, and retained blockers. SQLite Coordinator behavior is locally runtime-tested; no Production DO binding exists. | A/B configuration prerequisite | The 8-second value is explicit in the current protocol and earlier implementation-scope instructions; the permanent threat-model rationale is not independently established | Keep the current gate until a decision; propose logical fencing with no timeout-based blocker release |
| Safe handling of Unknown | Retry/re-sign, false success, or blocker release after a lost response | The issue core retains unresolved blockers and only returns finalized exact bytes. The local test adapters establish behavior only in tests. | A/B | Explicit in prior Freshness instructions and current protocol | Maintain; never infer completion from timeout |
| Detect an isolated DO or R2 rollback | One current-state projection being restored while the other remains current | Cross-checks can reject mismatched DO/Journal/R2 state. DO SQLite PITR can restore that object's database; R2 conditional writes apply per object. Production restore tests are **NOT_CHECKED**. | A/B operations defense | Current design; whether this is a product-level requirement beyond fail-closed mismatch is not independently established | Maintain mismatch rejection; qualify the threat boundary |
| Detect simultaneous rollback across DO, Journal, R2, and operation history | A mutually consistent old state being restored across every current authority | Current reader requires an independent witness. The proposed Cloudflare-only profile cannot detect common rollback when every comparison source is restored together. No Production witness is registered. | A/B under current design; additional defense under the proposed profile | Current protocol/design requires it; its necessity to the original evidence-authenticity purpose is not established | **Guarantee-scope proposal**: optional only if the user accepts Cloudflare/operator trust |
| Non-exportable HSM key custody | Extraction of an online Release/Freshness private key | Existing authority design proposes separate HSM-backed purpose keys, but no Production signer is registered. Cloudflare Worker Secrets are encrypted values accessible to Worker code; this is not evidence of HSM non-exportability. | Production operation for A/B | HSM custody is a design-selected defense. Earlier scope instructions prohibited silently treating Worker Secrets as an HSM, but do not establish that HSM is necessary to the original evidence claim | Keep purpose separation and the offline Bootstrap root; propose explicitly accepting Worker-key extraction risk under the named operator trust profile |
| Trusted wall clock and uncertainty bound | Backdating, expired-delegation signing, or accepting a lease after its authorization window | Code carries clock ID/epoch/uncertainty and enforces the 8-second maximum. No Production clock adapter or clock-error evidence exists. Deployed Workers' `Date.now()`/`performance.now()` behavior is not a clock-accuracy guarantee. | A/B configuration prerequisite | The 8-second value is explicit in the current protocol and earlier implementation-scope instructions; whether its strict elapsed-time guarantee is a permanent product requirement is not established | Propose removing only the 8-second elapsed cutoff. Keep delegation, Manifest, Journal/Release, and Freshness-response validity checks; their Production clock assumption remains a separate decision and dependency |
| Complete Bundle remote readback/retention | Partial or transient delivery being mistaken for retained Production evidence | Stage C requires complete Bundle remote readback/retention and independently verifiable delivery receipt. Existing Worker raw Presentation/outer-Result archive write/readback is narrower and must remain. | C only for complete-Bundle retention | Explicit in this request and Stage C contract | Maintain as C; do not remove A/B raw archives |
| Production execution/delivery receipt authority | A local/Canary receipt being presented as Production authority | Stage C requires approved Production execution/delivery authority. Current catalog is not a Production retention or execution receipt; Canary receipts do not grant it. | C | Explicit in this request and Stage C contract | Maintain as **BLOCKED** until separately approved |
| Resistance to malicious Cloudflare administrators or total provider compromise | A privileged actor changing code, secrets, or all account state | No current code or reviewed Cloudflare component proves protection from the provider/control-plane administrator. | Beyond current A/B; Production operations | No explicit product requirement located; threat model must be chosen | Proposed trust boundary, not a claim; user decision required |

### Requirement class crosswalk

The table above separates these categories; the labels are not interchangeable:

- **1 — TLSN communication and Evidence authenticity:** actual approved-peer
  TLS, Presentation-observed identity/Web PKI, Notary verification, exact
  Presentation/Result bytes, user/device/session attribution at its stated
  Stage, one origin send per capture, and evidence preservation/re-verification.
  Complete-Bundle remote retention and Production delivery authority are
  Stage C additions, not substitutes for the A/B raw Presentation/Result path.
- **2 — Runtime Config Freshness:** Manifest/artifact authenticity, nonce and
  audience binding, replay rejection, APP high-water, `LATEST_AT_ISSUANCE`,
  Release/issue serialization, exact finalization, and persistent Unknown
  handling. The strict 8-second authorization cutoff is a current protocol
  rule but is proposed for explicit re-decision; it is not part of the TLS
  transcript's authenticity proof.
- **3 — Operational and compromise defenses:** detection of isolated restore
  mismatches, independent rollback checkpoints, clock-source assurance for
  time-validity claims, HSM custody, and resistance to privileged operators or
  provider compromise. These defend deployment/authority operations; their
  presence in a design does not establish that the original TLSN product
  claim requires them.
- **4 — Unapproved scope changes:** making the independent witness optional,
  trusting a mutually consistent Cloudflare rollback, replacing the hard
  8-second cutoff with logical fencing alone, or replacing HSM
  non-exportability with Worker-readable keys. Each is a proposal requiring
  the trust owner's explicit approval; none is active in source or policy.

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
| Issue lease at most 8 seconds | `strict-journal-witness-v1` authorization bound; issue/finalization is rejected outside the trusted reading interval. `cloudflare-operator-v1` has no elapsed-time cutoff. | Not an SLO, not a processing target, and not an automatic blocker expiry in either profile. |

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

The selected local `cloudflare-operator-v1` profile removes the strict
elapsed-time cutoff and uses durable operation/fence/head checks. It does not
reclassify eight seconds as an SLO, claim logical fencing is an equivalent
physical cutoff, or clear Unknown by timeout/restart. The strict profile
retains its eight-second authorization bound and remains blocked in Production
until its clock source and error bound are established. Both profiles retain
the signed validity checks, whose Production clock basis is not yet verified.

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
  The local profile permits purpose/environment-limited Worker-readable
  Release/Freshness child keys while trusting the authorized operator and
  deployment boundary. This weakens raw-key extraction resistance and is not
  a substitute for an HSM's non-exportability guarantee.
- Production adoption of Worker-readable child keys remains **NOT_APPROVED**.
  If the trust owner does not accept extraction by compromised Worker code,
  Release/Freshness Production signing remains **BLOCKED** until a
  non-exportable signer is registered. Do not move the Bootstrap root online
  or silently add another paid service.

### Witness scope

The existing witness is intended to compare
`(environment, chain, restoreEpoch, sequence, Release generation, Record
digest)` against a separately retained monotonic high-water. That is useful
only when its operator, credentials, restore scope, and retention are
independent for the specific rollback being claimed. Another DO namespace,
bucket, Worker, or key under the same Cloudflare administration is a separate
resource, not an independent authority.

Under the selected local trust profile, keep DO/R2 mismatch checks and
quarantine for an isolated restore, but do not require a separate witness to claim
protection against a malicious Cloudflare-wide administrator. Omission would
lose automatic detection of a mutually consistent rollback, including a
rollback of the DO issue-operation/tombstone ledger. A Release-generation
witness alone would not protect those issue tombstones. The user selected this reduced rollback scope for the local profile; the
strict reader's required-witness behavior remains unchanged and missing
witness must continue to fail closed there. Production adoption of the
operator profile is not approved.

## 5. Contract delta and implementation impact

The table below records the original proposed deltas. The selected local
profile implements its applicable source changes; it does not revise
Production gates or register Production authority.

| Contract surface | Current contract/source | Proposed delta | Classification |
|---|---|---|---|
| Evidence authenticity chain, observed identity, exact bytes, Notary and offline verification | Existing authenticity contract and Result/Presentation bindings | No change | 説明の整理のみ |
| User/device/session attribution | Stage B requirement; A does not by itself prove actor ownership | Clarify that actor attribution is B even though Result wire fields may be present | 説明の整理のみ |
| APP wire, Manifest v2, nonce, audience, high-water and exact artifact checks | Existing APP/Rust verifier and signed protocol | No change | 現行保証を維持した実装方法の変更 is not proposed |
| Raw Presentation and outer-Result write/readback on current Worker Production path | Existing A/B path dependency | Preserve; do not remove because full Bundle retention is Stage C | 説明の整理のみ |
| Complete Bundle remote retention and Production delivery authority | Stage C requirement, currently absent | Keep exclusively in C; implement a dedicated full-Bundle readback/retention/receipt path | 未解決で引き続きBLOCKED |
| Canonical Release Journal | Strict profile uses an external canonical Journal; its append is the Release commit point | Local operator profile uses the per-environment SQLite DO as canonical Release/issue state; R2 remains a separate saga participant | 保証範囲の変更を伴う提案; Production adoption pending |
| Independent rollback witness | Strict reader requires an independent witness and current-head proof | Local operator profile does not require or fabricate a witness; it does not detect common rollback | 保証範囲の変更を伴う提案; Production adoption pending |
| Current Release consistency | Strict reader compares Journal, Coordinator, R2 pointer/snapshot, Manifest and witness before/after signing | Operator reader verifies exact DO ledger, R2 bytes and Manifest; its state is a separate profile-specific type | 保証範囲の変更を伴う提案 |
| DO/Coordinator transaction | Existing SQLite snapshot and issue core are locally runtime-tested; Production binding is absent | Local append/head/install/finalization use the existing DO with short transactions; R2 I/O stays outside them | Local implementation complete; Production binding remains unregistered |
| Release append time and Freshness issue clock | Strict profile requires authenticated append/issue time and uncertainty | Operator profile uses runtime UTC observations and final expiry guards without claiming a bound; signed validity checks remain | Production clock basis remains **UNVERIFIED / BLOCKED** |
| HSM custody | Strict Production design proposes purpose-specific HSM signers; no signer is registered | Local operator profile permits Worker-readable purpose/environment-limited Release/Freshness child keys; Bootstrap root stays offline | Production adoption pending; raw-key extraction is an accepted local-profile risk |
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

**Historical Hosted status at this prototype note (2026-11-09, before the
subsequent push):** the candidate workflow had not yet run for the prototype
working tree; run [#115](https://github.com/tsukasa-u/FUSOU/actions/runs/42484486660)
covered baseline `8a87314a055f45d37f1ae5b0524561575ab9b7ea` only. This
historical statement is superseded for the committed SHA by run #116 recorded
at the start of this proposal and in Section 9. Neither run is Production
acceptance evidence. Stage A/B/C and Production acceptance remain **BLOCKED**.

### 7.1 Explicit Cloudflare/operator profile implementation — 2026-11-10

**Status:** the profile is implemented and verified in the local Workers
runtime only. Its stable identifier is `cloudflare-operator-v1`; the prior
`strict-journal-witness-v1` path remains separate, retains its eight-second
authorization lease and independent Journal/witness validation, and fails
closed when its witness is absent. Neither profile silently converts legacy
state or falls back to the other.

The local operator path uses the existing SQLite Durable Object Release
ledger and issue coordination. Release signature verification, SQLite
`LEDGER_COMMITTED`, exact R2 pointer/snapshot/reference/ETag readback,
`AVAILABLE`, and current-state binding installation remain distinct steps;
R2 and the DO are not a distributed transaction. Only a profile-specific
verified state can enter operator issue admission. The operation binds
profile, environment, chain, state, request digest, nonce, audience,
Release head and fence. Signing results remain private until exact response
bytes, length and digest pass signature, current-state, fence and expiry
checks and are durably finalized. Same-operation lookup returns only those
exact persisted bytes; timeout, negative R2 reads, restart or a new ID do not
clear Unknown or authorize re-signing.

For this profile, elapsed time alone does not reject an otherwise current
operation after eight seconds. Release/delegation, Manifest and Freshness
response expiry checks remain active. Runtime UTC is read from the Workers
host in source; the deterministic sequence used to test a Release delegation
expiring between verification and SQLite commit exists only in the local
test subclass. Neither the host clock nor local tests establish authenticated
time or a bounded clock error. APP's 10-second and Gateway's 7-second
deadlines are unchanged.

The pinned local suite passes **63/63** Coordinator cases: the existing 56
strict-profile cases plus seven explicit operator-profile cases, with no RPC
stub disposal warning. Domain tests pass **26/26** and Domain/Coordinator
typechecks pass. Gateway typecheck and its isolated Workers runtime
regression pass (eleven PASS checks). The shared Domain Node tests are the
selected Node wire-contract regression. The combined Worker-to-APP handoff
entrypoint was inspected but not run because it invokes APP Cargo as a child
process, an excluded indirect-read path. The candidate workflow already
invokes Domain, Gateway and Coordinator type/runtime checks in step 27; it
was not changed or rerun. Run #116 is pre-change Hosted evidence;
post-change Hosted status is **NOT_CHECKED**.

This local implementation does not register Production operators, genesis
checkpoint, DO/R2 bindings, endpoints or keys; does not provide external
rollback detection or HSM-equivalent custody; and does not authorize
Production operation. The APP still verifies Manifest v2 directly with the
offline Bootstrap root and enforces a 600-second Worker reference age.
Manifest signer delegation/APP compatibility and an operational process for
renewing the 24-hour Freshness delegation remain a separate required design
and implementation unit for continuous Production issuance.

### 7.2 Private Signer authorization audit — 2026-11-11

This section records the pre-Manifest-delegation local snapshot: Coordinator
runtime **65/65** was the result at that point. Section 7.3 records the
subsequent Manifest-only delegation implementation and current local result.

Independent local DO diagnostics reproduced that the private
`cloudflare-operator-v1` Signer could sign for a missing operation and for a
persisted `RESULT_UNKNOWN` operation. This identified a private Signer
authorization-boundary defect; it did not demonstrate a bypass of the normal
issue core or a public route.

The typed Signer now requires a durable, one-time SQLite claim before it
performs response signing. The transaction verifies the persisted
`IN_PROGRESS`/retained operation against the fixed profile, environment,
chain, operation and signer-operation IDs, exact request bytes/digest,
nonce/audience, fence, admission Release binding and current DO head/state.
It rejects a pending writer or any other retained blocker. A caller-supplied
operation ID no longer suppresses blockers on generic Release reads; the
issue-specific verified read requires the same exact request, operation,
fence, Release state and persisted signing claim. An existing database that
lacks the claim column migrates old rows to claimed, not to an assumed
unsigned state. Crypto remains outside the transaction. Duplicate claim,
signer error, timeout, response loss and restart never clear the claim or
authorize another signature; only exact finalized bytes are returned and
same-operation lookup remains a read of those stored bytes.

The new runtime cases exercise absent, `RESULT_UNKNOWN`, `REJECTED`,
`FINALIZED`, mismatched operation/signer/request/nonce/audience/chain/
Release/fence, blocker exclusion, concurrent calls, in-progress restart,
Unknown restart and exact finalization lookup. The private key's startup
pairing probe is outside the test counter: concurrent calls produced exactly
one Freshness response signature, while invalid and replayed calls produced
zero additional response signatures. Coordinator runtime passes **65/65**
(56 strict plus nine operator-profile cases), Domain passes **26/26**, and
both packages typecheck. No skips or RPC-stub disposal warning occurred.
Candidate workflow step 27 already invokes these checks. This is local source
and runtime evidence only: run #116 remains pre-change Hosted evidence,
changed-source Hosted is **NOT_CHECKED**, and Production/Stage A/B/C remain
**BLOCKED**.

### 7.3 Manifest-only child delegation and cross-language verification — 2026-11-11

**Status:** the local APP/Node/Domain implementation and common raw vectors are
connected; Production key registration, deployment, continuous issuance and
acceptance are **NOT_IMPLEMENTED / BLOCKED**. The baseline for this unit is
`tlsn-first-testplay-candidate` at
`47ff1f6a70f8825cbbc6ea8511a8400fd1382a3f`, for which Hosted run
[#117](https://github.com/tsukasa-u/FUSOU/actions/runs/42970415077), attempt 1,
passed. Run #117 predates this implementation. Hosted status after these local
changes is **NOT_CHECKED**.

The authentication formats are not interchangeable. V2 is the unchanged
envelope schema 2 with payload schema 2, verified directly by the external
offline Bootstrap root. V3 is envelope schema 3 with payload schema 2 and
contains the exact canonical root-delegation envelope bytes, encoded as
unpadded base64url. The child signature covers the exact canonical payload
bytes under the dedicated `FUSOU-TLSN-RUNTIME-CONFIG-MANIFEST-V3\0` domain and
Manifest child key ID; the root delegation has its own exact canonical
payload/signature bytes and
`FUSOU-TLSN-RUNTIME-CONFIG-MANIFEST-DELEGATION-V1\0` domain. Release and
Freshness `manifest_schema_version` continues to mean payload schema 2. The
immutable R2 Manifest reference and all Release/Freshness digest bindings
continue to cover SHA-256 of the entire raw envelope, including its delegation.
V3 verification failure never retries as v2 or treats the child key as a root
pin. Once a client has accepted a positive Manifest-delegation generation,
v2 downgrade is rejected.

The root-signed Manifest delegation binds the dedicated purpose and Ed25519
algorithm, child ID/public key, Production environment, SHA-256 of the exact
Manifest URL, envelope/payload schemas, approved-configuration digest,
generation, timestamps, maximum lifetime and
`expiry-and-client-high-water-v1` revocation mode. `not_before` cannot be later
than root-signed `issued_at`; `not_after - issued_at` is at most 86,400
seconds. The existing 30-second clock-skew policy remains a verification
tolerance, not extra signed lifetime or a trusted-clock claim. There is no
immediate revocation path: expiry and each client's generation high-water
bound the exposure, and route shutdown/key replacement does not revoke an
already extracted key on every client.

The canonical approved-configuration projection is versioned and exact-key
checked. It includes environment, Manifest URL digest, payload schema,
Worker account/name/deployment/version/commit/disclosure identity, all
compile inputs, Production authority pins (including Origin Inventory and
Target Approval) and Result Registry pins. Only Manifest epoch and validity
times plus Worker-reference digest/observation time are excluded for
reissuance. A refreshed reference must still match the approved identity,
build, compile inputs, public bindings and raw digest; observation time must
match the raw artifact and remain within the existing 600-second age limit.
Unknown payload, envelope or delegation fields are rejected, not omitted from
the projection. Any change to trust pins, target approvals, compile inputs or
artifact references therefore needs a new root-approved configuration digest
and delegation.

Node publication verifies the root delegation, exact Manifest URL/schema,
approved digest, child signer ID/key correspondence and validity before using
the child signer; it verifies the complete signed Manifest and independent
artifact bytes after signing, then reads back immutable objects and conditionally
publishes the mutable pointer. Release record, Freshness response, R2 pointer
and immutable snapshot remain bound to exact raw Manifest bytes. Strict and
`cloudflare-operator-v1` current-state readers use the offline Manifest root
and configured URL to verify v3 bytes. The APP uses the same verifier source
for v2/v3, checks all raw artifacts and preserves a separate
Manifest-authority generation/digest high-water scoped to Production and the
Manifest audience. A valid higher root-signed generation can advance by more
than one; equal generation is accepted only with the same delegation digest.
Existing epoch, Manifest digest, Release commit and Freshness-delegation
high-waters are retained by the authenticated state transition. Legacy state
without an audience is bound once to the current Bootstrap audience while its
existing high-waters are preserved; that migration does not assert an
historical audience binding. Malformed, cross-audience, failed or
deadline-exceeded state transitions do not write new high-water.

The common test-only raw vectors include valid root/child signatures,
signature/delegation/payload tampering, purpose/environment/audience/schema/
key mismatch, root/child-key mismatch, 24-hour duration and skew boundaries,
approved trust/config mutation, allowed observation/time reissuance with its
matching raw Worker artifact, canonical/unknown-field rejection, Manifest
epoch and delegation-generation rollback/equivocation, generation gaps, and
v2 downgrade. Node, Domain and the isolated APP-source Rust harness consume the same
vectors. The candidate workflow runs the Node Worker Manifest suite,
Domain tests/typecheck, Coordinator strict/operator runtime suite and locked
isolated APP-source harness. Local validation is **43/43** across the selected
Node Manifest/R2/publisher suites (Manifest file **26/26**) plus deterministic
vector `--check`, Domain **27/27** plus typecheck, Coordinator **66/66** runtime
cases, Gateway typecheck/runtime regression, and isolated APP-source Rust
**28/28 unit + 1/1 shared-vector test**. The harness directly includes APP
Manifest/Freshness source, but is not the full APP Cargo integration build.

The Gateway-to-APP Node integration entrypoint is not part of the final
selected run because it launches APP Cargo as a child. An earlier parallel
command inadvertently included it; that child build failed before tests with
`E0277` because the migrated legacy epoch-state helper lacked `Serialize`.
The derive is now present and the isolated APP-source harness passes, but the
child APP Cargo test was not rerun; full APP integration remains
**NOT_CHECKED**, and its indirect compile-time access was not audited. This is
not Hosted evidence: run #117 is the pre-change baseline and changed-source
Hosted CI is **NOT_CHECKED**. No Production key or external service was used.

### 7.4 One-time fixed-approval Cloudflare/operator genesis — local implementation

The production genesis contract is one-time admission for one explicitly
pinned target, not "missing state means genesis" and not a caller assertion.
The deployment operator is the trust anchor for the exact canonical
`FRESHNESS_GENESIS_APPROVAL_JSON` and the restricted
`FRESHNESS_GENESIS_ADMIN_CAPABILITY` secret. The capability authorizes entry
to the management operation; the immutable approval pins authorize which
initial materials and target that operation may install. This is the selected
Cloudflare/operator trust boundary, not a new external approval service or a
cryptographic proof of two-person review.

The approval fixes `environment=production`, the selected operator profile,
chain, named Coordinator and its actual DO ID, restore epoch, initial
position/generation `1`, exact Record/delegation/Manifest digests, Manifest
epoch/reference/URL/audience, and the Release and Manifest root public-key
pins. The Record and Manifest are independently verified under existing
verifiers and purpose/expiry rules. The Record must be the initial predecessor-
free checkpoint at the pinned generation and bind the approved Manifest.
Before durable admission, the existing R2 adapter must read back the exact
pointer and immutable snapshot bytes with the Record's pointer ETag.
The current Release Record schema has no `chain_id`; chain binding comes from
the fixed approval and Coordinator profile/config, not from a signed Record
field. The operator-managed `restore_epoch` is an initialization binding, not
an independent witness or common-rollback detector.

Verification and R2 I/O remain outside SQLite transactions. A short
`transactionSync` admits only the fixed operation when the target has no
profile, Release/issue/install history, pending operation or retained blocker;
it records the exact input binding and holds the writer gate. The existing
Release append and durable ledger path then run, followed by exact R2
readback/`AVAILABLE`, followed by the existing conditional bootstrap binding
install. These are separate saga stages, not a distributed transaction.
Freshness issuance is unavailable before the final install.

The operation ID is derived from the canonical approval, not caller input.
An identical same-operation request may inspect or continue the exact stored
operation through existing verified stages. Changed bytes cannot match the
approved digests. A different ID cannot select another genesis. Response loss,
restart, negative reads, or timeout do not clear a writer or Unknown blocker.
`RESULT_UNKNOWN` is retained across restart; only a same-operation positive
exact readback may continue. Conflicting evidence or an unsafe stage is
quarantined. Repeating an installed operation is a result lookup; a second
genesis or overwrite is rejected.

The local implementation and its negative/Unknown/restart/response-byte
checks are recorded in
[FIRST-TESTPLAY-READINESS.md](../FIRST-TESTPLAY-READINESS.md). Hosted CI after
these changes is **NOT_CHECKED**. The runtime suite uses the pinned
`2026-11-08` compatibility date and the example flags; parity with the
example's `2026-11-13` date is **NOT_CHECKED** because the pinned workerd does
not support that date. No Production resources, operator registration,
genesis materials, R2 writes, or deployment were performed. The deployment
example contains placeholders only. Stage A/B/C and Production acceptance
remain **BLOCKED**.

## 8. Cloudflare primary sources reviewed (checked 2026-11-10)

The following current Cloudflare documentation supports only the stated
component behaviors; it does not certify FUSOU's adapters or threat model.

- [SQLite-backed Durable Object Storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) (last updated 2026-09-21) and [Access Durable Objects Storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/): per-object transactional/strongly consistent storage and SQLite PITR for the previous 30 days.
- [Durable Objects roles and permissions](https://developers.cloudflare.com/workers/authorization/durable-objects/) (last updated 2026-09-15): DO access follows access to the Worker; there are no separate DO roles. Data Studio Editor access can query and modify DO SQLite data.
- [R2 consistency model](https://developers.cloudflare.com/r2/reference/consistency/) (last updated 2026-10-14): global read-after-write consistency; atomic conditional writes for one object; negative reads do not settle an earlier in-flight write.
- [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), [R2 conditional S3 operations](https://developers.cloudflare.com/r2/api/s3/extensions/), and [R2 Bucket Locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/) (last updated 2026-10-28): conditional object operations and configurable overwrite/delete retention, including indefinite retention. Retention and per-object conditions are not a current-head witness or a DO/R2 transaction.
- [Workers Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/) (last updated 2026-10-13): direct Worker-to-Worker calls without a public URL. A binding is not the DO's method-level authorization contract.
- [Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/) (last updated 2026-10-15): encrypted text values accessible to Worker code. This page does not establish HSM-style key non-exportability.
- [Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/) (last updated 2026-09-30): `CryptoKey` generation/import takes an `extractable` flag and export is limited to extractable keys. This API property does not stop Worker code from invoking an allowed `sign` operation and is not an HSM custody guarantee.
- [Workers performance and timers](https://developers.cloudflare.com/workers/runtime-apis/performance/) (last updated 2026-10-27): deployed `Date.now()` and `performance.now()` only advance after I/O; local development differs. This does not specify the bounded trusted clock required by the 8-second lease.

## 9. Decisions required from the trust owner

The Cloudflare/operator profile is selected for local implementation only.
The recommendations and contract text below are not Production trust-owner
approval. Production gates and the strict Journal/witness verifier remain
unchanged; no missing strict-profile witness may be converted to success.

| Decision | Recommendation (not approval) | Guarantees maintained | Lost or explicitly outside the proposed claim | Required contract/code change if chosen | Unresolved dependency |
|---|---|---|---|---|---|
| **A. Cloudflare/operator trust and rollback** | Selected for the local profile; **Production adoption not approved**. | Network tampering/replay rejection; signed exact Release/Manifest bytes; nonce/audience binding; APP high-water while it survives; DO serialization and permanent operation records; exact R2 byte/reference/ETag readback; detection of isolated mismatches; Unknown/quarantine behavior. `AVAILABLE` follows exact R2 readback, and a separate conditional current-state install is still required before issue admission. | No automatic detection of a self-consistent rollback of DO Release/issue history, R2 pointer/objects, Worker versions/bindings and Cloudflare-contained checkpoints. An old but still-valid signed configuration can be replayed until its existing validity/age checks reject it. Cloudflare-wide compromise and malicious privileged operators are outside the claim; a first-start APP has no local high-water. | Keep one per-environment SQLite Coordinator as canonical Release ledger; keep R2 as a separate saga participant, never a transaction peer. Use a distinct operator reader/state type, not the strict external-witness type. The local profile does not change Production registration gates. | Before Production operation, name the trusted Cloudflare/FUSOU principals and approve a two-person bootstrap/restore/recovery procedure with an operator record outside the restored state. If common-rollback detection is required, an independently administered failure domain is still needed; another DO, Worker, bucket, key or namespace in the same account is insufficient. |
| **B. Eight-second issue authorization bound** | The local operator profile replaces this cutoff with durable operation/fence/head checks; **Production adoption not approved**. APP's 10-second deadline and Gateway's 7-second deadline remain unchanged. | Exact request/nonce/audience binding; Release/issue serialization; pre/post-sign state checks; exact response-byte finalization; stale-fence rejection; same-operation result lookup; persistent Unknown. These are state/ordering guarantees, not an eight-second timing guarantee. | Lose the claim that a signer result outside an 8,000 ms uncertainty-bounded interval is always rejected. A signer may remain pending indefinitely; this sacrifices availability and does not prove physical signing stopped. A late signature must never leave the signer/finalization path except through successful durable finalization. | The operator state machine has no time-only issue cutoff; operation ID, request digest, fence, expected Release generation/current-state binding and finalization checks remain. Release is blocked by unresolved issue state; no new recovery authority was added. Retain all signed validity and expiry checks. | Ordinary runtime UTC is an operational assumption, not an authenticated bound. It is still used for signed delegation/Release/Manifest/Freshness-response validity and append/finalization checks. A bounded absolute-time claim remains unavailable without an approved source and error budget. |
| **C. Online Release/Freshness key custody** | The local profile permits Worker-readable, purpose-limited Release/Freshness child keys; **Production adoption not approved**. Keep the Bootstrap root offline and all signing purposes separate. | Offline root limits online key compromise from creating new delegations. Distinct Release, Freshness, Result, Session and Binding keys; typed operations; environment/audience/request/head binding; exact-state checks; rotation and freeze controls constrain authority. | A compromised Worker can read/export a Worker-readable secret and sign outside the Worker until the key is disabled/expired. HSM non-exportability would reduce raw-key extraction, but neither an HSM nor Worker key alone prevents abuse of an authorized signing API or approval of a wrong Release. | Use only typed purpose methods; no public generic `sign(bytes)`. Restrict Worker bindings, environment, operation, signer role and deployment/secret access; maintain delegation expiry, high-water, audit, emergency freeze and offline-root rotation. Never describe Worker Secrets or `extractable=false` as HSM custody. | No Production signer, key, binding or rotation procedure is registered. Production must explicitly accept raw child-key extraction by compromised Worker code; otherwise non-exportable custody remains a blocker. |

### Detailed consequence of the recommended issue-time change

The comparison below is about the issue authorization rule, not the APP or
Gateway deadlines and not signed-object validity. “Current” describes the
existing strict lease; “proposed” describes logical fencing and retained
Unknown state. Neither path treats timeout or cancellation as proof that a
signer stopped.

| Event | Current strict 8-second rule | Proposed logical-fencing rule | Required outcome / residual |
|---|---|---|---|
| Signer stalls and returns after 8 seconds | The response is outside the lease interval and must not finalize or be returned; the operation blocker remains until a known terminal result or approved recovery. | The result may finalize only if the same durable operation, request, fence, current Release binding and response-validity checks still hold. If the APP's 10-second deadline or Gateway's 7-second deadline has elapsed, that caller does not gain a longer acceptance deadline. | No response bypasses finalization. A late result may exist inside the signer path; the proposal does not claim physical cancellation. |
| Release update races signing | The writer gate and lease/current-state checks serialize the transition; an expired or stale issue cannot finalize. | An unresolved issue blocks the Release writer. If an explicitly authorized recovery/new fence wins first, the old result fails the finalization transaction's operation/fence/head checks. | Release and issue ordering is decided by DO transactions; no response is returned from an obsolete state. |
| A lease expires, then an old process returns | The old lease fails its time check even if the Release is unchanged. Expiry does not itself clear the blocker. | There is no time-only expiry. The result is accepted only while its operation and fence remain current; after recovery/fence advancement it is rejected. | Long-running work can block availability indefinitely. Recovery is an explicit state transition, not an elapsed-time guess. |
| Coordinator restarts during signing | Durable operation/blocker state survives; restart is not completion evidence. | The same durable operation/fence is reloaded; a callback from a prior attempt cannot finalize against changed state. | No in-memory map or restart-based lease cleanup. |
| Finalization succeeds but the HTTP response is lost | Query the same operation and return the exact persisted bytes/digest; do not re-sign or create a new operation. | Same behavior. The result is bound to the same nonce/request and is not reusable for a different request. | The APP's existing deadline and response expiry still apply; result lookup is not permission to extend either. |
| Operation remains `UNKNOWN` | Keep its blocker after timeout, cancellation and restart. | Keep its blocker indefinitely; do not retry under a new ID, generation or bytes. | Clear only from exact same-operation evidence or an authorized recovery that durably fences the old attempt and records its rationale. A negative read alone is insufficient. |

For both profiles, signing output is private to the issue/finalization path.
The only response bytes available to a caller are those durably committed by
the current operation's successful finalization. The proposed contract cannot
protect against an independently exposed signer API, a malicious authorized
operator, or logs/debug interfaces that leak raw signatures; those paths must
be absent and are not treated as equivalent to normal finalization.

### Clock semantics retained by either decision

The three elapsed-time limits remain distinct:

| Boundary | Current meaning | Proposal |
|---|---|---|
| APP 10 seconds | One local monotonic end-to-end acceptance deadline for the Freshness exchange, Manifest/artifact fetch, verification and guarded persistence. | Unchanged; it does not authorize the server to continue issuing after the client deadline. |
| Gateway 7 seconds | One HTTP forwarding/response deadline. Disconnect/timeout is not proof that signer work stopped or a blocker may be cleared. | Unchanged; it is not a lease-reclamation rule. |
| Issue authorization 8 seconds | Current clock-bounded cutoff for lease/sign/finalization. | Proposed for removal as an elapsed-time cutoff only; state/fence authorization remains. |

The proposal retains delegation `not_before`/`not_after`, Release authorization
and append-time comparisons, Manifest validity/reference-age rules, and the
Freshness response's 30-second maximum lifetime and 30-second skew checks.
Those are independent of the issue lease. The APP uses wall-clock UTC for
validity checks and a monotonic `Instant` for its 10-second deadline. Deployed
Workers' `Date.now()` and `performance.now()` advance only after I/O; the
official documentation publishes no authenticated error bound. Local
Miniflare/workerd timer behavior is not a Production clock proof.

The recommended reduced profile treats ordinary Cloudflare/host UTC as an
operational assumption for those existing absolute-time checks, not as an
authenticated or bounded clock. This is an explicit residual: if the trust
owner requires a demonstrated error bound for response expiry, delegation
validity or Release append time, that requirement remains **BLOCKED** until a
source and cross-component error budget are approved. Neither the logical
fence nor this proposal's recommendation proves clock accuracy or silently
removes those checks.

### Key-custody comparison by compromise event

- **Raw private-key extraction:** a Worker Secret is encrypted in storage but
  available to Worker code. Worker-readable key bytes can therefore be copied
  by compromised code and used outside the Worker until disabled or expired.
  An HSM non-exportable key reduces this extraction path. Web Crypto's
  `extractable=false` restricts exporting a `CryptoKey`; it does not make an
  environment secret non-readable to code that already received it.
- **Signing API abuse:** either key class can produce signatures when its
  authorized signing operation is invoked. HSM custody alone does not stop a
  caller with valid API access from asking it to sign an incorrect but
  syntactically valid Release. Typed purpose APIs, validation against the
  current operation/head, independent human approval and exact finalization
  are required in both profiles.
- **Worker code/deploy compromise:** with a Worker-readable key, code that
  obtains the secret may exfiltrate and use it independently. With HSM
  custody, the raw key remains non-exportable, but compromised code can still
  exercise whatever signing calls the HSM service authorizes. If a separate
  signer service enforces typed policy outside the compromised Worker, HSM
  adds a stronger boundary; that service is not currently registered.
- **Wrong Release approval:** neither HSM nor Worker Secrets determines
  whether a target/configuration is the intended one. Exact Manifest/Release
  verification, environment/audience binding, the writer gate and explicit
  approval remain necessary. A malicious authorized approver is trusted under
  the recommended profile.
- **Revocation and rotation:** immediately disable the route/key, freeze
  issuance and use the offline Bootstrap root to delegate a new purpose key
  with a higher generation. A stolen child key can sign offline until its
  delegation expires or clients learn a newer delegation; already-created
  signatures are not erased. A fresh APP without high-water may not know an
  out-of-band revocation. Bootstrap-root compromise remains a separate
  incident requiring a separately approved APP trust migration.
- **Purpose boundaries:** Bootstrap remains offline. Release, Freshness,
  Result, Session and Binding keys remain distinct by purpose/environment and
  audience. No Worker child can issue a new delegation, sign another
  purpose, mutate the ledger, or expose a general-purpose `sign(bytes)` API
  under the proposed application contract. These restrictions do not resist
  code with authority to bypass the typed API; that extraction/misuse risk is
  explicitly accepted only if the Worker-key option is approved.
  The Worker-readable custody decision here applies only to Runtime Config
  Release and Freshness child keys. Result, Session and Binding key custody
  remains under its separate existing contract and is not changed by this
  proposal.

### Candidate Production contract text — not adopted

> **Trust boundary.** For Runtime Config Freshness, FUSOU trusts the
> Cloudflare Workers/DO/R2 platform and the named FUSOU production operators.
> This includes Cloudflare-account principals able to deploy or change the
> relevant Worker code, routes, bindings and secret bindings; access or
> restore the Coordinator's SQLite state (including principals with
> modifying Data Studio/Worker access); change R2 objects, pointer, bucket
> policy or permissions; and operate Release, Freshness, key-rotation and
> recovery workflows. Named FUSOU Release approvers are trusted to approve
> the exact Manifest/artifact digests; named operators with signing or
> secret-binding access are trusted not to exfiltrate or misuse their
> delegated child keys. These principals are trusted not to maliciously alter
> code/state or present a self-consistent old state. The Cloudflare platform
> and control plane are trusted to preserve the current service state against
> adversaries outside this named administrative boundary.
>
> **Covered behavior.** With that state intact, the service rejects network
> tampering, nonce/audience replay, invalid signatures, changed exact bytes,
> wrong environment/chain, conflicting writes, mismatched R2 pointer or
> snapshot, and isolated restores that disagree with another current source.
> Release and issue operations use durable stable IDs, exact request bindings,
> fences, conditional transitions and exact readback. Unknown or inconsistent
> state returns no Freshness bytes and keeps the relevant blocker/quarantine.
> The existing TLSN Presentation, observed server identity, Notary,
> Inventory/Target Approval, Result, user/device/session and Evidence
> verification contracts are unchanged.
>
> **Release publication and issue ordering.** A Release operation is first
> recorded with its exact signed Record/delegation bytes and expected
> predecessor in the Coordinator's SQLite transaction. R2 writes and reads
> occur outside that transaction. `LEDGER_COMMITTED` records the DO ledger
> decision; it is not an issuance gate. The operation can become `AVAILABLE`
> only after readback matches the exact pointer, immutable snapshot bytes,
> digest, reference and ETag, and a later conditional transaction rechecks
> operation, predecessor, attempt and fence. `AVAILABLE` alone is also not a
> current-state binding: the profile's verifier must validate the signed
> Release/Manifest and R2 evidence, then conditionally install the binding
> against the still-current head before issue admission opens. DO and R2 are
> not one transaction. A mismatch, race or unknown write remains blocked.
>
> Issue admission, signing and finalization are serialized against Release
> mutation by the same per-environment Coordinator. The issue operation
> binds its stable ID, exact request digest/nonce/audience, current Release
> generation, fence and verified current-state binding. Release admission
> closes while an issue is unresolved. After signing, the issue path
> re-verifies current state and atomically finalizes only if the operation,
> head, fence and request still match. Only those persisted exact response
> bytes may be returned. If a Recovery operation advances the fence first,
> a late signature cannot finalize or be exposed through the normal response
> path.
>
> **Rollback and recovery.** No guarantee is made that the system can
> automatically detect malicious administrator action, Cloudflare-wide
> compromise, or a mutually consistent rollback of the Coordinator's Release
> and issue-operation history together with the R2 pointer/objects, Worker
> code/configuration and any Cloudflare-contained checkpoints. A different
> namespace, DO, bucket, Worker or key under the same administration is not
> an independent witness. Bootstrap is an explicit, one-time operation
> authorized by the named Release approvers for a specific environment/chain
> and exact initial Release. Absence of current-state data is not by itself
> proof of a new environment: any surviving ledger/operation history,
> malformed or corrupt state, or partial restore blocks bootstrap. Bootstrap
> cannot overwrite an existing binding.
>
> For a planned restore, two named operators approve a change record kept
> outside the Cloudflare state being restored, disable the Gateway/signer
> route, and preserve the pre-restore operation results/blockers. After
> restore they reconcile exact operation IDs/results; verify signed Release
> and Manifest bytes, pointer/snapshot bytes and ETag; inspect every
> issue/recovery blocker; and use a typed Coordinator recovery operation to
> record a new forward `restoreEpoch`. They then install/advance only through
> the normal conditional Release path. No generation/fence is reset and
> missing/corrupt state is not genesis. For an accidental restore or
> inconsistent state, issuance remains quarantined until the same evidence
> and approvals exist; timeout, restart, or a negative read does not prove
> that an earlier R2 write or signing operation will not complete.
>
> The external change record, two-person approval and `restoreEpoch` are
> operational controls, not cryptographic proof against a malicious
> Cloudflare administrator and not an independent witness. If all Cloudflare
> state is restored consistently, this profile cannot infer the former head.
> If a child key may have been extracted, operators disable the signer route
> and freeze issue/Release operations; resumption requires a new root-delegated
> purpose key and a higher delegation generation. Previously created
> signatures are not erased, and a fresh APP may not know an out-of-band
> revocation until it receives the new signed delegation.
>
> **Clock and issue authorization.** The APP's 10-second monotonic deadline
> and Gateway's 7-second HTTP deadline remain unchanged. The strict 8-second
> elapsed issue cutoff is replaced by durable operation/fence/head checks;
> no lease expiry, timeout, cancellation or restart clears an unresolved
> blocker. `UNKNOWN` remains blocked unless an existing, exact same-operation
> terminal result is available; this profile implementation adds no forced
> Unknown-clear or recovery authority. The contract does not claim that the
> signer physically stopped, and a late signature is never returned unless
> the current operation finalizes it.
>
> Delegation, Release/append-time, Manifest and Freshness-response validity
> checks remain in force. Under this proposed reduced profile, their
> timestamps rely on the ordinary Cloudflare/host UTC clocks as an
> operational assumption, not an authenticated source with a demonstrated
> error bound. If a bounded absolute-time guarantee is required, issue remains
> disabled until that clock source and error budget are separately approved.
>
> **Online key custody.** The Bootstrap root stays offline. Release,
> Freshness, Result, Session and Binding keys remain purpose- and
> environment-separated, with the existing purpose-specific root-signed
> delegation validity windows, typed
> operation-specific APIs, exact request/head binding, restricted Worker
> bindings and deployment/secret permissions, audit, freeze and rotation.
> This custody decision permits Worker-readable Runtime Config Release and
> Freshness child keys, with the accepted risk that compromised Worker code
> can extract and use them outside the Worker until revocation/expiry. It does
> not change Result, Session or Binding key custody. No generic `sign(bytes)`
> API is exposed. This option is not HSM-equivalent and does not prevent
> misuse by an authorized signing caller.
>
> **Before Production operation.** The trust owner must name the authorized
> principals, approve the rollback/key/clock risks, register environment-
> scoped Worker/DO/R2 bindings and roles, verify the real deployment and
> recovery process, and validate the ordinary-clock assumption or register
> a bounded time source if required. No local prototype or Hosted CI result
> supplies these approvals or proves real Game Server/Notary evidence.

The Runtime Config Freshness Cloudflare/operator profile is now the
explicitly selected local profile described in Sections 7.1–7.3. Its reduced
rollback, elapsed-time-cutoff and key-extraction guarantees apply only when
that fixed profile is selected; they do not alter the separate strict
Journal/witness profile, its eight-second lease, or Result/Session/Notary/
Inventory key contracts. The local selection is not Production operator,
resource, key or genesis approval. Do not treat a same-account Cloudflare
resource, logical fence or Worker Secret as an independent witness or
equivalent substitute for an out-of-scope guarantee.

### Local implementation unit completed; Production execution remains gated

The previously proposed first unit—an explicitly selected Cloudflare/operator
profile using the existing current-state reader, issue core, signer boundary,
SQLite Coordinator, Release ledger and R2 adapter—has been implemented and
locally verified as described in [Section 7.1](#71-explicit-cloudflareoperator-profile-implementation-2026-11-10).
The implementation adds no parallel Coordinator, public signer route,
generic `sign(bytes)` API, or forced Unknown-clear/recovery authority.

The remaining Production work is not an extension of this local verification:
the trust owner must still approve named operator roles and recovery
procedures, register the environment-specific DO/R2 bindings/endpoints and
keys, validate the deployed clock assumption, and verify actual restore and
issuance operations. The older 7.1 snapshot recorded Manifest v2 as the only
format; Section 7.3 supersedes that local implementation status with the
explicit root-delegated v3 format while retaining v2 compatibility and the
600-second Worker-reference limit. Continuous Production Manifest issuance,
Production child-key registration and the operational renewal of the
24-hour Freshness delegation remain unimplemented. No deployment or
Production acceptance is authorized here; Stage A/B/C and Production
acceptance remain **BLOCKED**.
