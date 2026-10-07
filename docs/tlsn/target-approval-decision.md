# FUSOU TLSN Target Approval Decision

Status: **DECIDED / IMPLEMENTED**
Audit baseline: `793153962422469ef322b0e5ce0ef8b40cdc4fb1` (`tlsn-phase0-investigation`)
Decision authority: **FUSOU_DEPLOYMENT_OPERATOR** (role; no individual inferred)
Decision date: 2026-10-07

This document records the selected authority model and its current Production approval set. The alternatives below remain design context, not active choices. Repository evidence and inventory mechanics are detailed in the [Origin inventory audit](target-approval-inventory-audit.md).

## Security Objective

Establish an explicit, reviewable decision that a canonical DNS hostname is in FUSOU's intended Game Server verification scope, and bind that decision to the candidate and deployment that consume it. This policy decision is independent of whether a connection can be cryptographically authenticated.

The active contract is:

```text
TARGET_APPROVAL_AUTHORITY.status = RESOLVED
TARGET_APPROVAL_AUTHORITY.authority_model = FUSOU_DEPLOYMENT_OPERATOR
TARGET_APPROVAL_AUTHORITY.evidence_contract = TLSN_TARGET_APPROVAL_JSON_V1
Production approval = 20 identities, bound to the current inventory SHA-256
readiness = BLOCKED until candidate and all independent gates pass
deployment = rejected unless the approval record and deployment preflight validate
```

The approval record is `packages/configs/tlsn-target-approval.json`; its current Production target set contains all 20 identities in the canonical Origin inventory at the recorded inventory digest. This decision does not assert live endpoint ownership or acquire production evidence. No new trust root, signature key, or certificate pinning is introduced. AD-5, process/image authority, TPM, remote attestation, current binary identity, Web PKI roots, Origin DER inputs, Result signer trust, Notary trust, and Verifier execution identity remain outside this decision.

## Independent Trust Decisions

- **Target Approval:** “FUSOU intends to accept this DNS identity as a verification target.” It is a policy/ownership decision.
- **Web PKI/TLS:** “This TLS peer proved control of the certificate identity for this DNS hostname under the verifier's configured public trust roots.” This authenticates the peer; it does not authorize FUSOU to select that hostname.
- **TLSN Presentation:** Provides cryptographic evidence for the authenticated TLS session and transcript. It does not establish FUSOU's target-selection intent.
- **Notary:** Its separately trusted key authenticates the Presentation. Notary registry membership does not approve a Game Server target.
- **Verifier:** Its execution identity identifies which verifier ran. It does not approve the target.
- **Result signer:** Its signature authenticates the issued Result. It does not establish target-selection authority.

Therefore, `valid certificate != FUSOU-approved target`. A canonical hostname, a manifest match, inventory membership, a valid Presentation, or a valid Result is not by itself the missing Target Approval decision.

Certificate renewal, intermediate changes, and CA rotation remain compatible with hostname-only target configuration: if the same DNS identity is authenticated by a chain accepted by the verifier's existing Mozilla roots, FUSOU's target decision and hostname do not change. A root not accepted by that trust store requires a separate verifier trust-store decision; do not solve target approval by pinning certificates or adding a candidate root.

## Selected Model: FUSOU_DEPLOYMENT_OPERATOR

FUSOU's deployment operator is the human configuration/governance authority that approves the Game Server hostname set used for verification. The repository record is separate from both `configs.toml` and the generated/static Origin inventory. Runtime candidate strings and inventory membership alone never constitute approval.

The approval contract requires `status == APPROVED`, the current raw canonical inventory SHA-256 to equal `inventory_sha256`, and a canonical HTTPS inventory identity to be present in the explicit `targets` list. The record uses canonical JSON serialization and an RFC3339 `approved_at`; it has no time-based expiry. Changing inventory bytes invalidates the record until the operator updates the approval. Removing a target from the approval list revokes it for subsequent validated builds/deployments.

The current record explicitly approves all 20 Production inventory identities. Readiness and deployment checks enforce record validity and candidate membership; Production preflight provenance binds the authority model, status, environment, inventory digest, approval artifact digest, and approved set. Canary candidate validation uses the same Production-scoped set without changing Canary Runtime Attestation or verifier-identity semantics.

**Governance limit:** This is an operator-governance record, not a cryptographic signature or proof of a named person's identity. The user confirmed that `tlsn-phase0-investigation` is unprotected and has no required checks or repository rulesets. The implementation does not treat branch protection, Git author metadata, or workflow success as evidence of who approved the record. The path-filter repair makes relevant CI run when the files change, but does not make those checks required merge controls.

## Alternative Models Considered

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

## Lifecycle Semantics and Remaining Governance

The selected record implements identity/environment scope, exact-byte integrity, inventory and candidate binding, and prospective revocation through a changed approval set. The following governance properties are not supplied by the JSON schema itself and must not be inferred from it:

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

## Alternatives Not Selected

The decision selects operator governance recorded in a separate approval artifact; it does not select protected repository review as the authority. The branch is currently unprotected, so the repository does not provide independent reviewer or required-check evidence. CI path filters now cover the source TOML, canonical JSON, shared text inventory, and approval artifact, but remain execution triggers rather than merge-policy enforcement.

Options B and C were not selected; no separate signing root or external Game Server authority is configured. An ad hoc operator-supplied hostname (Option D) is not approval; deployment requires the durable record and its exact candidate/inventory checks.

## Decision Record: 2026-10-07

The FUSOU deployment operator decision recorded for this change is:

1. Authority model: `FUSOU_DEPLOYMENT_OPERATOR`, a human governance role, not an individual inferred from repository metadata.
2. Scope: the Production set of 20 canonical HTTPS identities in the Origin inventory whose raw bytes match the record's `inventory_sha256`.
3. Record: `packages/configs/tlsn-target-approval.json`, schema version 1, canonical serialization, explicit approved targets, and `approved_at: 2026-10-07T04:48:07Z`.
4. Validity: current inventory digest match plus exact candidate membership. The record does not expire by time; inventory changes invalidate it, and target removal requires an explicit record change.
5. Binding: readiness checks the candidate; deploy preflight rejects invalid/missing approval; Production provenance binds the approval artifact and inventory digests and the approved set.
6. Separation: approval does not establish Web PKI peer authentication, Notary trust, Result signer trust, Runtime Attestation, Verifier identity, or client process authority. AD-5 remains `OUT_OF_SCOPE`.
7. Governance caveat: no named approver/signature or protected-branch evidence is encoded. The user confirms no branch protection, required checks, or rulesets are configured for this branch.

The record does not mean the system is generally ready: missing candidate configuration, Notary and other independent readiness gates continue to block readiness/deployment. No real Game Server was contacted, no Presentation was captured, no Notary was contacted, and no deployment was performed for this decision.