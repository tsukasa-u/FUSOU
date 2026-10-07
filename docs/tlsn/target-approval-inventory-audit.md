# FUSOU TLSN Origin Inventory Audit

Audit baseline: `793153962422469ef322b0e5ce0ef8b40cdc4fb1` (`tlsn-phase0-investigation`)
Scope: the audit below records local repository files and Git history at its stated baseline. No GitHub API/settings, external owner, network probe, or production evidence was consulted. The implementation follow-up records the subsequently selected authority model and approval artifact.

Baseline conclusion: the inventory was an integrity-checked identity-selection/configuration input, **not an established Target Approval Authority**. Inventory membership remains separate from Target Approval.

See [Target Approval Decision](target-approval-decision.md) for the selected model and its limits. “Unknown” in the baseline audit means the repository evidence did not establish the property; it does not claim that no process exists outside the repository.

## Implementation Follow-up: 2026-10-07

- The selected model is `FUSOU_DEPLOYMENT_OPERATOR`, a human configuration/governance authority. It is not Web PKI, Notary, Result signer, Runtime Attestation, Verifier identity, or client process authority.
- `packages/configs/tlsn-target-approval.json` is a distinct canonical schema-version-1 Production record. It explicitly lists all 20 identities in the current canonical inventory, records `approved_at: 2026-10-07T04:48:07Z`, and binds the inventory's raw-byte SHA-256. Inventory edits do not automatically update or approve targets; they invalidate the record until an operator decision updates it.
- Readiness checks exact candidate membership; deploy preflight fails closed on invalid/missing approval; Production provenance binds the authority, status, environment, inventory digest, approval artifact digest, and approved set. Canary candidate validation remains separate from its Runtime Attestation and verifier identity.
- The security workflow now triggers on `configs.toml`, canonical JSON, shared text inventory, and approval JSON changes, and it fetches locked `proxy-https` dependencies before offline finalization tests. The inventory workflow filters now name the actual TOML and shared text paths.
- The user confirmed that the branch is unprotected, with no required checks or repository rulesets. The approval JSON is a declarative governance record; it is not signed and does not establish a named person's identity or prove protected review. CI path triggers do not enforce merge requirements.
- No real target connection, Presentation capture, Notary request, production deployment, or production evidence acquisition was performed.

## 1. Source and Generation

### APP server map

`packages/configs/configs.toml:[app.connect_kc_server.server_list]` contains 20 integer-indexed hostname mappings. The adjacent comments describe ordinary APP server selection; `kc_server_name` may also be empty or a hostname/IP. `packages/configs/src/configs.rs` deserializes this TOML for APP configuration and embeds `tlsn-origin-inventory.json` separately. Its Rust test compares all inventory entries to the shipped server map and asserts schema version 1, exactly 20 entries, unique indexes/identities, ordered index correspondence, and port 443.

### TLSN inventory artifacts

The repository contains:

- `packages/configs/tlsn-origin-inventory.json`: schema-version-1 inventory; its `source` field names the TOML table.
- `packages/configs/tlsn-origin-inventory.json.txt`: byte-identical text form consumed by Worker and Trigger build/runtime paths.
- No separate `packages/FUSOU-TLSN-VERIFICATION-WORKER/configs/tlsn-origin-inventory.json.txt` file exists at this baseline, despite that path appearing in one workflow filter.

**Generation method: UNKNOWN.** A repository-wide search at the baseline found no generator that parses `configs.toml` and emits the JSON and text files. The Rust test verifies semantic equality when run; JavaScript contract tests compare canonical JSON and the shared text bytes. The files are checked-in static snapshots, so this audit cannot establish whether maintainers generate them externally, copy them manually, or use an undocumented local command. Do not treat the `source` label as proof of automated derivation.

Consequently there are multiple operational data representations: TOML drives normal APP selection; JSON is embedded in the Rust library and is the canonical JSON input to TLSN inventory contracts; the shared `.json.txt` bytes are imported/bundled by Worker and Trigger. They must be updated consistently.

## 2. Change, Review, and Publication Evidence

### Git history

- Local `git blame` at the audit baseline records `Oguri Hideyuki` as the author for the current server-list rows, introduced in commit `2ebca01716` (2025-12-09). The adjacent TLSN comment was added in `14d8aae44` (2026-10-02).
- The TLSN inventory was introduced/migrated in `861d5f8b2` (2026-10-02) and provenance was hardened in `14d8aae44` (2026-10-02); local commit metadata records `Oguri Hideyuki` as author and committer for both.
- `git show` reports `Signature: N` for those two inventory commits. This states those Git objects are not signed; it is not a finding about the identity of the person behind the account.
- Git author/committer metadata is not a review or approval record. This local history does not establish pull-request reviewers, branch protection, required checks, who can bypass protections, or whether the remote branch can be rewritten.

### Review policy

At the audit baseline, owner, CODEOWNERS rule, required reviewer count, branch protection, merge/release approval, and bypass policy were not established by local repository evidence; remote hosting settings were not inspected. For this implementation follow-up, the user confirms this branch is unprotected and has no required checks or rulesets. A commit or CI result is not independent reviewer evidence; the selected authority is the explicit deployment-operator governance model.

### CI verification and trigger coverage

- `.github/workflows/check_build.yml` runs `cargo test --lib configs::tests:: -- --nocapture`, which includes the TOML↔embedded inventory test. This workflow has `workflow_dispatch` and a weekly schedule but no `push` or `pull_request` trigger. The test is useful, but repository workflow evidence does not make it a required per-change approval check.
- At the audit baseline, `.github/workflows/tlsn-trigger-origin-inventory.yml` omitted the source TOML and actual shared text inventory path and included a nonexistent Worker-local path. The implementation follow-up corrected those filters.
- The JavaScript contract verifies raw-byte equality between canonical JSON and the shared `.json.txt`, Trigger inclusion/configuration, and task/runtime digest mismatch rejection. It does not parse the TOML source.
- The Rust semantic test verifies the TOML mapping against the embedded JSON, but its current workflow schedule/manual trigger is separate from the inventory contract workflow.
- **Required status/review enforcement and workflow success as a merge prerequisite: UNKNOWN.** The repository files do not establish Git host-side required-check settings.

The baseline gap was a change-detection issue, not an approval decision. The implementation follow-up adds the relevant path triggers and Target Approval contract test; it does not configure branch protection or promote inventory membership to approval.

## 3. Integrity, Manifest, and Provenance Binding

### Configuration and build bytes

- `packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/origin-inventory-contract.mjs` reads the JSON and shared `.json.txt`, requires exact byte equality, parses the inventory, and computes a raw-byte SHA-256 of the JSON bytes.
- The Worker imports the shared `.json.txt` as text, parses it at module initialization, and in Production computes an inventory SHA-256 from those runtime bytes. Production security identity includes that digest in the production security-registry-set calculation.
- The Production preflight includes the inventory digest in its generated deployment/provenance report; the deployment-attestation validator recomputes the shipped digest and requires it to match Production provenance. The Production public manifest also binds the selected security-registry-set digest, which itself includes the inventory digest.
- Trigger build configuration includes the shared text file and records its raw-byte digest in a build-synchronized environment variable. Trigger task processing checks the bundled file against that build digest and checks the Worker task's inventory digest against Trigger runtime bytes. The Worker task identifies Production's policy as `inventory`; Canary uses a separate `fixed` identity and must not carry the Production inventory digest.

These controls establish which inventory bytes/configuration a local build, preflight, manifest/provenance, Worker, and Trigger expect to use, and detect specific copy/task mismatches. They do **not** authenticate an approver, establish a review, make an inventory member approved, or by themselves prevent an authorized/compromised deployment from shipping a changed inventory. Hashes are integrity/binding evidence, not approval authority.

### Deployment source

The Worker and Trigger consume checked-in inventory bytes from the same checkout/build inputs; deployment wrappers use the local package scripts and Wrangler/Trigger build configuration. At the audit baseline there was no Target Approval record. The implementation follow-up adds a separate Production record: Production provenance binds the approved set, and a Canary candidate must independently be in that set. This does not authenticate the TLS peer or alter Canary Runtime Attestation/verifier identity semantics.

The audit establishes the local source/build path, not what commit is currently deployed remotely or whether platform-side deployments are restricted to reviewed commits.

## 4. Entry Lifecycle and Recovery

| Lifecycle action | Repository evidence at baseline | Approval consequence |
| --- | --- | --- |
| Add target | Add a server index/hostname to TOML and keep JSON/text snapshots consistent; no generation command or approval field is present. | No named proposer/reviewer or approval record is established. |
| Change target | Edit hostname/index in source and update snapshots; current tests can detect mismatch when run. | No explicit change reason, approval scope, effective time, or independent review evidence is captured by inventory schema 1. |
| Remove target | Delete from the static target list and ship updated Worker/Trigger inputs. Membership is effectively list-based; no status/expiry/disable field exists. | No immediate runtime revocation mechanism is evidenced. Removal becomes effective only when the relevant deployment/build uses new bytes. |
| Disable target | No `active`, `revoked`, `valid_until`, or denylist mechanism exists in the inventory schema. | **UNKNOWN / not defined**; do not assume omission is instant revocation across already-built deployments. |
| Historical inventory | Git commits and build/provenance digests can identify historical bytes. | No approval event, reviewer evidence, or authority status-at-time is bound, so historical bytes are not historical approval evidence. |
| Roll back | An older Git revision/build may restore older inventory bytes; current hash checks verify consistency with that chosen build. | No anti-rollback floor or revocation-preserving rule is evidenced. Rollback may reinstate a previously removed target. |
| Compromise recovery | No inventory-authority incident runbook, reviewer-account recovery, or credential/release compromise procedure was found. | **UNKNOWN**; ordinary Git revert/redeploy is not a complete authority-compromise plan. |
| Publication | Static files are checked into Git and embedded/bundled by package build/deployment paths. | A public/protected release channel and proof that the deployed bytes passed an approval process are not established by these files. |

## 5. Findings Against the Approval Question

| Evidence category | Finding |
| --- | --- |
| Owner evidence | The selected authority role is `FUSOU_DEPLOYMENT_OPERATOR`; no individual is identified or inferred from Git metadata. |
| Review evidence | The user confirms this branch is unprotected and has no required checks or rulesets. No independent review proof is encoded. |
| Publication evidence | The checked-in `tlsn-target-approval.json` is the explicit Production record; its content is declarative and unsigned. |
| Integrity evidence | Exact inventory-byte digest, canonical approval serialization, explicit candidate membership, readiness/preflight checks, and Production provenance binding are implemented. Workflow paths cover relevant TOML/inventory/approval files; this does not establish required-check enforcement. |
| Lifecycle evidence | The record has no time-based expiry. Inventory-byte changes invalidate it and target removal requires a record change; anti-rollback, emergency-disable latency, named delegation, and compromise recovery remain undefined. |
| Trust authority | The selected model is `FUSOU_DEPLOYMENT_OPERATOR`. Inventory membership remains only an identity-selection input and does not imply approval. |

The current record approves 20 inventory identities and code rejects candidates outside that record. This does not close governance gaps around named approver identity, protected review, merge enforcement, rollback, or compromise recovery. Readiness and deployment remain blocked until each candidate and all independent gates pass. See the [decision document](target-approval-decision.md) for the decision and its limits.