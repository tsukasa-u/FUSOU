# FUSOU TLSN Target Approval Decision

Status: **OPEN / UNRESOLVED**  
Audit baseline: `793153962422469ef322b0e5ce0ef8b40cdc4fb1` (`tlsn-phase0-investigation`)  
Decision owner: **UNKNOWN**  
Decision date: not decided

This document presents the authority models a human may choose. It does not select an authority, authorize any hostname, or change readiness/deployment gates. Repository evidence and inventory mechanics are detailed in the [Origin inventory audit](target-approval-inventory-audit.md).

## Security Objective

Establish an explicit, reviewable decision that a canonical DNS hostname is in FUSOU's intended Game Server verification scope, and bind that decision to the candidate and deployment that consume it. This policy decision is independent of whether a connection can be cryptographically authenticated.

The current contract remains:

```text
TARGET_APPROVAL_AUTHORITY.status = UNRESOLVED
TARGET_APPROVAL_AUTHORITY.owner = UNKNOWN
TARGET_APPROVAL_AUTHORITY.evidence_contract = UNRESOLVED
target approval = UNAPPROVED
readiness = BLOCKED
deployment = BLOCKED
```

No actual target, production evidence, new trust root, signature key, or approval artifact is introduced here. AD-5, process/image authority, TPM, remote attestation, current binary identity, Web PKI roots, certificate pinning, Origin DER inputs, Result signer trust, Notary trust, and Verifier execution identity are unchanged and outside this decision.

## Independent Trust Decisions

- **Target Approval:** “FUSOU intends to accept this DNS identity as a verification target.” It is a policy/ownership decision.
- **Web PKI/TLS:** “This TLS peer proved control of the certificate identity for this DNS hostname under the verifier's configured public trust roots.” This authenticates the peer; it does not authorize FUSOU to select that hostname.
- **TLSN Presentation:** Provides cryptographic evidence for the authenticated TLS session and transcript. It does not establish FUSOU's target-selection intent.
- **Notary:** Its separately trusted key authenticates the Presentation. Notary registry membership does not approve a Game Server target.
- **Verifier:** Its execution identity identifies which verifier ran. It does not approve the target.
- **Result signer:** Its signature authenticates the issued Result. It does not establish target-selection authority.

Therefore, `valid certificate != FUSOU-approved target`. A canonical hostname, a manifest match, inventory membership, a valid Presentation, or a valid Result is not by itself the missing Target Approval decision.

Certificate renewal, intermediate changes, and CA rotation remain compatible with hostname-only target configuration: if the same DNS identity is authenticated by a chain accepted by the verifier's existing Mozilla roots, FUSOU's target decision and hostname do not change. A root not accepted by that trust store requires a separate verifier trust-store decision; do not solve target approval by pinning certificates or adding a candidate root.

## Candidate Models

### Option A: Repository Inventory With Protected Review

```text
repository-managed target inventory
    -> defined protected review/change process
    -> allowed target set
```

**Trust assumptions:** The human decision explicitly makes a particular repository path and its protected branch/release process the approval record. GitHub or the selected Git host, its identity and access controls, review enforcement, and the integrity of the checked-out commit become part of the authority boundary. A commit author field alone is not proof of approval. A Git commit hash protects object integrity but does not prove who approved it, that policy-required reviews occurred, or that the selected commit is the newest non-revoked one.

**Required operations:** Name the responsible role; define who may propose, review, merge, release, and emergency-remove entries; set required independent review and bypass rules; make CI validate the source TOML and every generated/bundled copy on relevant changes; publish the exact reviewed commit/inventory digest used by each deployment; keep a durable audit trail; define branch/release protection and repository-account compromise recovery.

**Binding and lifecycle:** Bind the selected hostname and environment to the reviewed inventory revision, then bind that revision/digest to the existing deployment manifest/provenance path. This records which configuration was shipped; it does not make a review approval unless the protected review itself is the explicitly accepted policy evidence. Removing an entry and deploying a newer inventory can revoke it prospectively. A rollback to an older inventory can re-enable removed entries unless rollback policy, deployment authorization, or a monotonic version rule prevents that.

**Security semantics:** Integrity is available from Git objects and existing byte hashes, subject to trusting the repository host and build/deploy path. Authenticity, ownership, required review, freshness, publication, and approval auditability need explicit repository policy and evidence. Versioning can use commit/tree IDs plus a schema version; the current inventory has schema version 1 but no approval revision or lifecycle fields. Environment separation and exact candidate/deployment binding must be specified. Revocation is a reviewed removal plus deployment unless a separate emergency deny path is defined.

**Operational burden:** Lowest additional cryptographic/key-management burden and strongest fit with the current static-inventory, deployment-digest architecture. It still requires governance, CI/path-filter corrections, deployment provenance that identifies the reviewed revision, rollback rules, and repository-host trust. It is not currently established by this repository.

**Hostname-only and certificate rotation:** Fully compatible. Approval attaches to DNS identity and scope, not leaf/intermediate certificate bytes. Certificate/CA rotation does not require an inventory edit when Web PKI accepts the new chain.

### Option B: Separately Signed Target Approval Artifact

```text
Target Approval Authority
    -> signed, scoped approval artifact
    -> exact candidate hostname and environment
```

**Trust assumptions:** A verifier has an independently anchored approval root/key registry and accepts only artifacts within that authority's defined scope. Do not reuse or conflate Notary, Result signer, Runtime Attestation, or Verifier identity keys. A signature proves the artifact was signed by a key the verifier trusts; it does not prove that the key owner was authorized unless ownership, delegation, and key governance are defined.

**Required operations:** Select an accountable owner and bootstrap trust root; define authority keys, key IDs, roles/scope, custody, lifecycle, rotation/overlap, compromise revocation, and recovery; define a canonical schema and signature encoding; define issue time, not-before/expiry or explicit non-expiring semantics, inventory/target version, environment, exact canonical hostname, reason/reference, and any delegations; define revocation distribution/checking and fail-closed behavior when stale or unavailable; retain historical public keys, artifacts, and revocation state for evidence verification; bind the artifact digest and target/environment to deployment input and recorded deployment provenance.

**Security semantics:** Can provide strong integrity/authenticity if root provisioning and keys are trustworthy. Freshness needs expiry, a monotonic version, or an independently trusted current revocation snapshot; a signed but old artifact can otherwise be replayed. Revocation is not instantaneous for offline consumers without a distribution/expiry rule. Historical verification needs retained authority keys and status-at-time evidence. Environment separation, owner/delegation, publication and auditability all require schema and operational policy.

**Operational burden:** Highest of the listed models. It adds key custody, root bootstrap, issuance tooling, verifier logic, rotation/revocation operations, artifact retention, and outage/freshness behavior. It is justified only if an approval signature or authority independent from repository review is a real security requirement. Adding a signing artifact without independently governing its root would only move the unresolved authority question.

**Hostname-only and certificate rotation:** Compatible if the signed object names the canonical DNS identity, not certificate/SPKI/DER bytes. Certificate and CA rotation are handled by existing Web PKI and do not reissue target approval unless the hostname or approval scope changes.

### Option C: External Organizational Authority

An external Game Server owner/operator or another formally designated organization could authorize scope, but no such owner or relationship is inferred by this audit.

**Trust assumptions and required evidence:** Identify the organization and accountable role; prove that role's delegation; define how FUSOU authenticates the statement (for example, a verifiable signed statement, an authenticated maintained registry, or a controlled contractual/governance record); bind the exact canonical hostname, FUSOU environment/use, validity period/version, and approval scope; retain the statement and its verification context; define withdrawal, key/identity rotation, publication, and audit procedures. A contact name or an operator's assertion that an external party approved is not independently verifiable evidence.

**Security semantics:** Authenticity rests on the external organization's identity and delegation process. Freshness/revocation depend on its publication and withdrawal mechanism. FUSOU still needs local candidate/deployment binding and environment separation. Compromise recovery is shared: the organization must withdraw/replace its evidence, while FUSOU must stop accepting it and preserve history.

**Operational burden:** Depends on the external authority's existing process; potentially low if it publishes durable machine-verifiable approvals, high if FUSOU must manually validate correspondence and maintain provenance. This model can represent the actual ownership boundary better than repository-only approval, but there is no repository evidence that an eligible external authority or evidence channel exists.

**Hostname-only and certificate rotation:** Compatible when the external approval is scoped to DNS identity and use. Leaf/intermediate/CA rotation remains a separate Web PKI concern.

### Option D: Operator-Only Assertion

```text
operator supplies candidate hostname
    -> (not sufficient to conclude approved)
```

An environment variable, command-line argument, or manual deployment input can select a candidate. If that same assertion is treated as approval, there is no independent authority or durable evidence separating “the target I supplied” from “a target an authorized person approved.” It loses independently verifiable authenticity/ownership, review separation, durable auditability, reliable freshness/revocation, and resistance to accidental or malicious candidate substitution. Integrity is only that of the supplied value in that invocation. Deployment binding can record what was supplied, but not why it was authorized.

This does not itself weaken Web PKI peer authentication or TLSN proof verification. It fails the distinct policy objective of proving FUSOU accepted the target. It may be an explicit low-assurance manual operation for non-production only if a human changes the security objective and accepts the limitations; it is not a production approval model under the current objective. Hostname-only and certificate rotation are technically compatible, but do not repair the lost approval properties.

## Cross-Model Minimum Semantics To Decide

Before selecting a model, decide each property at the strength required by the threat model. Not every property implies an external signing service.

| Property | Concrete question |
| --- | --- |
| Ownership | Which named role/org can approve, and who can delegate or revoke that authority? |
| Authenticity | What evidence distinguishes an authorized approval from an ordinary configuration edit or operator input? |
| Integrity | Which exact canonical hostname, scope, and evidence bytes are protected against substitution? |
| Freshness/versioning | How is the current approval revision identified, and can an older approved state be replayed? |
| Revocation | How is a target removed urgently, how quickly does deployment stop accepting it, and what happens offline? |
| Rollback | May a deployment rollback restore a removed hostname? If not, where is the anti-rollback floor recorded? |
| Publication/auditability | Where is the approved decision published and how can an auditor reconstruct who approved what, when, and under which policy? |
| Candidate binding | Is approval for a single canonical DNS name or a set, and is environment/port/use included? |
| Deployment binding | What exact approval/inventory revision and digest are bound to the deployed Worker and its existing provenance? |
| Environment separation | Is scope shared by Production and Canary, or separately approved? The current Trigger architecture uses Production inventory and a separate fixed Canary identity. |
| Compromise recovery | What are the steps for compromised repository credentials, reviewer accounts, authority keys, or an external publisher? |

Certificate lifecycle is deliberately separate: target approval should normally be identity-scoped so that a valid Web PKI certificate/intermediate/CA rotation for the same hostname does not require target re-approval.

## Architecture-Fit Assessment, Not A Selection

**Option A is the lowest-change model to evaluate first**, because the current Production path already ships a static inventory, checks its bytes, and binds its digest into security/deployment identity. If humans explicitly make protected repository review the approval policy, the existing architecture can carry the approved set without adding a new signing root. However, current repository evidence does not establish the necessary branch/review controls; the inventory generator is absent; CI does not reliably trigger on all source files; and approval freshness, revocation, and rollback are undefined. Option A is therefore **not approved by this assessment**.

Option B is appropriate only if humans require a cryptographically distinct approval authority and are prepared to govern a second root/lifecycle. Option C is appropriate only if a real authorized external Game Server owner and verifiable evidence channel are identified. Option D is not sufficient for the stated production security objective.

## Human Decision Record: Unresolved

Before any real target is supplied, humans must explicitly decide:

1. Which model (A, B, C, or a clearly specified hybrid) is the approval policy; whether it covers Production, Canary, or both.
2. The accountable authority by role/organization and the permitted approvers/delegates; do not infer this from Git authorship.
3. Who may propose, approve, publish, remove, and reinstate a target; whether independent review is mandatory and what bypass is allowed.
4. The authoritative record and exact target scope: canonical hostname, port/use, environment, and whether approval is per-host or set-wide.
5. The required approval evidence and its authenticity/integrity proof; whether protected repository review is sufficient or a separate external signature/root is necessary.
6. How source, generated/bundled copies, schema version, and artifact hashes are produced and checked on every relevant change.
7. How the approved revision is bound to candidate configuration, deployment manifest, deployed Worker, and existing deployment provenance.
8. Freshness/expiry, historical retention, revocation latency, emergency disablement, and whether an offline verifier may use a cached approval.
9. Whether rollback can restore a revoked target and, if prohibited, the anti-rollback state and its authority.
10. Environment separation and Canary's fixed-target policy relative to the Production inventory.
11. Compromise recovery for the selected authority and its publication/deployment systems.

Until this record is made by humans, keep `owner: UNKNOWN`, `status: UNRESOLVED`, `evidence_contract: UNRESOLVED`; a valid candidate remains `UNAPPROVED`, readiness remains `BLOCKED`, and deployment remains rejected.