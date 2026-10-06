# FUSOU Current APP Process Image Authority

Status: **AD-5 = OUT_OF_SCOPE; NOT_REQUIRED_FOR_COMMUNICATION_INTEGRITY_GOAL**
Decision date: 2026-10-05
Review date: 2026-10-07
Scope: current classification and preserved historical audit; AD-5 is not a readiness dependency.
Repository path: `docs/architecture/current-app-process-image-authority.md`
Audit baseline: `bc108e31ebb37167276cd68a530c973ad4b80c57` (`tlsn-phase0-investigation`)
Committed document revision at audit start: `31925cd8f91a85f31f69b844e1603d3b6ef80d76`
Latest review baseline: `b242759570b57ff0a78286b01ea9a6009ef1f588`

## Current classification (2026-10-07)

**AD-5 is `OUT_OF_SCOPE`, `NOT_REQUIRED_FOR_COMMUNICATION_INTEGRITY_GOAL`, and is not a readiness blocker.** The earlier audit treated `AUTHENTICATED_CURRENT_BINARY_IDENTITY_SOURCE` as an external prerequisite. Reassessment against FUSOU's security objective supersedes that requirement; no current-process authority is required, planned, or selected by this project.

FUSOU's primary assurance goal is to prevent or detect third-party in-transit tampering of communication between FUSOU APP and the Game Server, and to form independently verifiable evidence of that communication:

```text
Game Server identity
  -> Web PKI / TLS server authentication
  -> FUSOU APP <-> Game Server communication
  -> exact TLS transcript
  -> TLSN proof / Presentation
  -> Notary
  -> Verifier
  -> Result / Evidence
```

The browser-to-APP boundary is outside FUSOU's browser-integrity guarantee. The Game Server is responsible for validating the game meaning, consistency, and acceptability of values it receives. If the local OS is fully compromised, an attacker may change APP memory or data before TLS encryption; FUSOU does not claim that a client-side process attestation can prove such plaintext correct. This endpoint-compromise limitation does not negate TLS protection of encrypted in-transit bytes against a network MITM when endpoint TLS authentication and cryptographic processing remain trustworthy. Endpoint compromise and in-transit tampering are different threats. A genuine APP process identity must never be used to infer that its pre-encryption communication content is correct.

Authenticating the currently running APP executable/process as an independent trust root is outside this project's guarantee and does not establish the integrity or truth of pre-encryption APP data. TPM, Measured Boot, OS process measurement, remote attestation, and privileged helpers are not prerequisites and must not be implemented to unblock readiness. Their absence must not stop readiness; in-scope communication-evidence gates remain independently enforceable.

The remainder of this file preserves the earlier AD-5 audit and its contemporaneous requirements as history. Any statement below that calls the current-process source an external prerequisite, marks AD-5 unresolved/blocked, or compares candidate process-authority mechanisms is superseded by this classification and is not a current implementation or readiness requirement.

## Scope and immutable constraints

The provenance baseline is `1e548ce3c`. The earlier audit baseline was `db7a29ef831f334534eb408f948fd50e1de73ee3` (`Freeze TLSN failure artifact v2 contract`); this review rechecked the repository at `bc108e31ebb37167276cd68a530c973ad4b80c57`. The document was already tracked in that HEAD, with committed revision `31925cd8f91a85f31f69b844e1603d3b6ef80d76` before this uncommitted amendment. Failure-output redaction was introduced separately in `314089b13`; it does not change provenance semantics. The active external input remains `TLSN_CANARY_DEPLOYMENT_MANIFEST`. External Package v2 is historical and is not reactivated.

This record formalizes requirements and human decision inputs only. It does not change provenance v3, convert `CURRENT_BINARY_IDENTITY` into authenticated evidence, configure application pins, or authorize gameplay. It does not implement process measurement, a helper, TPM/IMA/fs-verity, Windows Code Integrity, macOS SecCode, code-signing integration, a readiness gate, or a new registry/service. It does not treat `current_exe()`, a self-hash, PID, updater signature, Main Worker Runtime Attestation, `/health`, or operator JSON as current-process authority. It creates no fixture authority and proposes no TSA, global registry, historical registry, revocation service, or separate nonce registry. Any such service would require a separate trust-model justification.

## 1. Architecture decision

### AD-5

Keep `AUTHENTICATED_CURRENT_BINARY_IDENTITY_SOURCE` as an external prerequisite. The authority owner, trust root, threat boundary, measurement semantics, and process-instance protocol are not sufficiently determined to select a security-complete architecture.

The repository has a frozen v3 contract that describes the required boundary but no implementation that satisfies it. Tauri release signing/updater configuration covers distribution artifacts, not the running process. OS/platform primitives may be ingredients, but none has been selected, configured, and verified as an independent source across FUSOU's intended targets. A privileged helper or hardware-backed quote alone would also leave unresolved trust and process-binding questions.

This is not “blocked because code is missing.” It is blocked because the source authority boundary and its trustable evidence are not yet specified. No readiness advancement follows from this decision.

### Candidate architecture comparison (not a selection)

These are conceptual authority models, not implementation plans. `Potential` means a model might support a property after its authority, protocol, OS semantics, and verification policy are specified. It is not evidence that FUSOU currently has the property. No candidate is selected or recommended because the accountable authority owner, independent control boundary, and accepted root of trust remain unresolved.

| Candidate | Authority concept | What it might contribute | Why it is not selected |
| --- | --- | --- | --- |
| A. OS-level measurement | An OS/platform authority reports identity or measurement for a specific live process/object under a declared policy. | A platform-governed observation, if the OS exposes the required process-to-image semantics and the relying verifier can authenticate them. | No OS API, policy, source identity, app pin, or tested process binding is selected. OS/vendor trust does not automatically establish independence from local administrators, the builder, or the APP. |
| B. Privileged local helper | A separately installed and privileged service observes the target APP through an OS process object and returns authenticated evidence. | A distinct local IPC and privilege boundary could observe and retain a reference to the target process while assessing it. | No helper or independently provisioned helper trust path exists. Ownership, privilege, IPC policy, same-user and administrator attacks, service replacement, and helper-to-builder provenance are unresolved. |
| C. Hardware/platform-backed remote attestation | A remote verifier validates a hardware-backed quote and a separately established OS/runtime/process measurement chain. | Hardware-backed key possession and quote freshness for values actually covered by the quote. | A quote alone does not identify the FUSOU process. Firmware/boot chain, event log, OS/runtime measurement, target process binding, verifier identity, and challenge policy are unresolved. |
| D. Independently signed runtime/deployment identity | An independent signer attests to deployment/runtime identity claims. | Authentication of the signer's explicitly scoped runtime or deployment statement, if its key/root and owner are independently trusted. | A signed deployment identity or Worker runtime statement is not a measurement of the APP's mapped image. Without an independent process measurement in the signed scope, this model cannot close AD-5. Existing Main Worker Runtime Attestation and `/health` are scoped to the Worker. |
| E. Hybrid | Two or more independently governed sources, such as OS measurement plus a remote verifier, or a helper plus hardware-backed evidence. | Separate components could cover measurement, process binding, freshness, and remote appraisal when each link has an authenticated and independently governed source. | Composition does not create authority. Each root, operator, measurement boundary, cross-binding, freshness/replay rule, lifecycle, and failure policy must be explicit. This is the highest operational and integration burden and no combination is selected. |

The comparison below is about capability in a future design, not current implementation. `Potential` requires explicit design and evidence; `Not inherent` means the candidate does not provide that property by itself; `Open` means the authority or policy is unspecified.

| Comparison axis | A. OS-level | B. Privileged helper | C. Hardware/remote | D. Signed runtime/deployment | E. Hybrid |
| --- | --- | --- | --- | --- | --- |
| Root of trust | OS/platform chain; exact root and policy open | Helper identity root, provisioned independently and pinned by the relying verifier | Hardware attestation chain plus verifier/source roots; exact chain open | Independent signer root; no APP-process root exists today | Separate roots for every component; composition root and pinning open |
| Authority independence | Depends on OS governance and resistance to in-scope local control | Possible only with separate operator, privilege, credentials, and verification path | Possible at hardware-key layer; administrative independence of the full chain is open | Depends on accountable signer ownership; a distinct key alone is insufficient | Must preserve independent control across components; otherwise weakest shared owner dominates |
| Process-object binding | Potential if the OS authority identifies the exact target process/object | Potential if it holds and validates a stable OS process reference | Not inherent in a platform quote; requires a separate process-binding link | Not inherent in deployment identity | Potential through a component that supplies and authenticates it |
| Image measurement | Potential under a defined OS measurement profile | Potential through a trusted observer; exact measurement semantics remain open | Quote may cover platform/boot values, not automatically the APP image | Not inherent in signed deployment claims | Potential only if one trusted component measures the relevant image |
| Builder Provenance binding | Separate verifier must compare source measurement with signed artifact identity/digest | Separate verifier must compare helper evidence with Builder Provenance | Quote chain must be cross-bound to Builder Provenance by a relying verifier | A deployment claim alone cannot establish the builder-to-process link | Each authority must be separately verified, then explicitly cross-bound |
| Freshness | Potential with a relying-verifier challenge and bounded validity | Potential with a challenge and a fresh observation | Quote nonce can help for quoted values; process measurement freshness still needs binding | Signed timestamp alone is not freshness; an authenticated challenge is required | Must define one challenge path and freshness for every evidence link |
| Replay resistance | Requires challenge binding and atomic one-use consumption | Requires challenge binding and atomic one-use consumption | Quote nonce alone does not prove relying-verifier consumption | Not inherent | Requires end-to-end one-use semantics; cannot inherit from one component alone |
| TOCTOU resistance | Potential if measurement is bound through use to the same process/object | Potential with retained process/object reference and a consuming-boundary recheck | Not inherent; quote-to-process and measurement-to-use links remain | Not inherent | Potential only if the chain remains valid through the consuming decision |
| Process substitution resistance | Potential if the source and consumer bind the same live process instance | Potential if helper binds the exact process object and rejects restart/replacement | Not inherent without OS/runtime process binding | Not inherent | Potential through independent process binding plus consumer validation |
| Installation substitution resistance | Potential only if the measured process image is compared to the approved installed artifact | Potential only if the helper measures the object actually used by the process | Not inherent in a machine/platform quote | Deployment identity does not establish installed APP bytes | Potential if install identity and current-process measurement are separately bound |
| Key lifecycle | OS/platform-specific lifecycle and status policy open | Helper signing-key custody and service identity lifecycle open | Hardware AK, endorsement, verifier, and source-key lifecycle open | Signer registry lifecycle can authorize claims, but cannot add measurement semantics | Multiple lifecycle policies and their interactions must be governed |
| Rotation | Platform-specific and open | Must rotate without allowing APP-controlled replacement; open | Attestation-key and verifier-root rotation open | Signer rotation does not cure missing process measurement | Coordinated rotation across roots is required; open |
| Revocation | Source status and failure policy open | Service/key revocation and offline behavior open | Attestation-key/device revocation and freshness policy open | Registry revocation covers signer authorization only | Revocation policy must cover all sources and cross-bindings |
| Compromise recovery | OS/vendor compromise boundary and recovery open | Service compromise, re-provisioning, and root recovery open | Hardware/platform, verifier, and key compromise recovery open | Signer compromise response cannot revoke process observations that were never made | Must handle compromise of each root and invalidate dependent evidence |
| Windows | Platform APIs/policy and process mapping unselected | Separate service, ACL, process handle, and signing boundary unselected | Hardware/OS measurement chain and process binding unselected | Deployment claims are OS-neutral but insufficient alone | Requires validated Windows-specific end-to-end profile |
| Linux | Kernel/platform measurement and local privilege boundary unselected | Service identity, IPC, namespaces, and process reference unselected | TPM/IMA/event-log chain does not by itself identify the APP process | Deployment claims are OS-neutral but insufficient alone | Requires validated Linux-specific end-to-end profile |
| macOS | SecCode/process measurement policy unselected | Service identity, entitlement, IPC, and process reference unselected | Platform attestation applicability and process binding unselected | Deployment claims are OS-neutral but insufficient alone | Requires validated macOS-specific end-to-end profile |
| Operational complexity | High and OS-specific; exact API/policy is open | High: install, privilege, updates, IPC, support, and recovery | Very high: hardware compatibility, verifier operation, and appraisal chain | Low for signing a claim, but inadequate to meet AD-5 alone | Very high due to multiple authorities, roots, protocols, and support paths |
| User experience | Potentially low friction if native policy works; permission/failure behavior open | Installation and privilege prompts/service maintenance likely; details open | Device eligibility, privacy, enrollment, and failure behavior open | Low friction, but does not satisfy the security objective by itself | Highest likely setup and recovery burden; not evaluated |
| Trust boundary | OS/platform authority -> relying verifier -> Builder Provenance comparison | Helper operator/service -> IPC/process object -> relying verifier -> Builder Provenance | Platform/hardware chain -> quote verifier -> process-measurement source -> Builder Provenance | Signer -> signed runtime/deployment claims only | Multiple separately accountable authorities -> relying verifier -> Builder Provenance |

No row is a current PASS for FUSOU. D is insufficient by itself; E is not a shortcut around naming and governing the measurement authority. The first decision remains who is accountable for the current-process measurement and which independently trusted root the relying verifier accepts. Only after that decision may an implementation mechanism be evaluated.

For any future Model C, keep these claims separate and verify each link: firmware/platform trust -> measured boot/PCR values -> event-log replay and appraisal -> quote signature and hardware-backed attestation-key identity -> relying-verifier identity and policy -> verifier/authority challenge nonce -> OS/runtime measurement -> exact target-process and APP-image binding -> Builder Provenance cross-binding. A valid quote can authenticate only the values covered by that quote under its key and nonce. It does not imply the later OS/runtime, process-image, or builder links.

## 2. Existing authority matrix

Repository evidence identifies roles and interfaces more clearly than accountable owners or key custody. An owner is listed as unresolved where code/configuration cannot establish organizational control. A root is the trust anchor accepted by the relying verifier, not a key merely carried by evidence. `AUTHORITY` is always limited to the named scope; `EVIDENCE`, `IDENTITY`, and `DIAGNOSTIC` rows are not interchangeable with it.

| Authority / evidence | Scope | Owner | Root of trust | What it proves | What it does not prove | Lifecycle |
| --- | --- | --- | --- | --- | --- | --- |
| `WEB_PKI` (`AUTHORITY`) | TLS server name and channel to an Origin under client policy. | CA operators and OS/browser trust-store operators. | Trust store and TLS validation policy of the specific client. | The authenticated TLS peer name/channel under that policy. | APP image, Worker code identity, Builder, or freshness of a process measurement. | Certificate and CA validity/revocation policy of the relevant trust store; independent of APP release lifecycle. |
| `NOTARY` (`AUTHORITY`) | TLSN Presentation/Notary claims in the protocol's signed scope. | FUSOU-NOTARY service operator; independent accountable owner is not evidenced. | Notary verification key selected by the deployment/verifier trust configuration. The offline adapter does not establish external registry provenance. | A Presentation verifies under the selected Notary key and protocol. | APP image, Worker/Verifier runtime, Auth ownership, or game-server identity. | Registry/key selection exists; independent owner, production status source, and compromise response are not established by this audit. |
| `RESULT_SIGNER` (`AUTHORITY`) | Exact signed Result fields/bytes in the Result signature domain. | Canary Result signer operator/key custodian; organizational independence is unresolved. | Root-signed Result key registry envelope where supplied to the relying verifier. Candidate production application pins remain unconfigured. | Signature validity and signer authorization under the accepted registry/root. | Truth beyond the verifier contract, a particular APP process, or APP authenticity. | Registry lifecycle/validity is checked by the verifier; historical authorization and physical signing time are not independently established by v3 semantics. |
| `VERIFIER_EXECUTION` (`AUTHORITY`) | Receipt binds job/attempt, Presentation and Result byte hashes, Verifier deployment/version, key, and issuance time. | Verifier receipt-key operator/custodian; independent organizational ownership is unresolved. | Verifier identity key registry cross-bound to a validated Runtime Attestation. Offline adapter receives prior runtime identity as an input and does not reverify its signature. | A valid receipt over the named attempt and exact bytes under the receipt key. | APP process/image, or claims outside the signed receipt fields. | Key registry and Runtime Attestation freshness/expiry are checked by the full verifier path; signer owner and compromise recovery remain unresolved. |
| `MAIN_WORKER_RUNTIME_ATTESTATION` (`AUTHORITY` for Worker identity) | Main Canary Worker deployment/version, workflow/manifest cross-bindings, health claims, Result signer and Dedicated Verifier identity. | Worker deployment operator and distinct Runtime Attestation key custodian; accountable independence is not established. | Ed25519 key in the repository's Canary Runtime Attestation key registry plus validated platform/deployment inputs. This is not an APP application pin. | The configured Main Worker runtime identity under its own signed contract and freshness window. | FUSOU APP, installed package, APP process, or gameplay client identity. | The inspected registry marks its key `ACTIVE` with no `not_after`; attestation/manifest freshness is checked. Organizational rotation and compromise recovery are not established. |
| Main Worker `/health` (`EVIDENCE` / `IDENTITY`) | HTTPS response fields for Worker deployment, version, commit, binding mode, and Result signer configuration. | Main Worker operator. | Web PKI authenticates the HTTPS endpoint; APP compares fields to expected configuration. Response fields are Worker self-report, not a separate signed APP statement. | A live HTTPS response consistent with the APP's configured Worker identity. | Independent Worker code measurement, APP process/image, or an authenticated APP measurement. | Request is time-bounded by client timeout; no separate signed health-response lifecycle or process authority exists. |
| `BUILDER_AUTHORITY` (`AUTHORITY` for build claims) | Signed `candidate_artifact_id`, `artifact_identity`, `binary_sha256`, source commit, workflow, toolchain, and builder identity. | FUSOU build workflow/operator is the apparent subject; separate accountable owner and key custody are unresolved. | A dedicated application-pinned Builder root is required by v3 but production pins are not configured. | Builder-signed artifact/build provenance claims when signature, signer authorization, and root trust pass. | Installation or execution, current process image, or independent measurement of the APP. | v3 checks current evidence validity and signer authorization; historical registry authorization/physical signing time are not proven. |
| Tauri updater signing (`AUTHORITY` for update artifact) | Tauri updater artifact/manifest verification under configured updater key. | Release workflow/operator and signing-key custodian; independent ownership is unresolved. | Updater public key in `tauri.conf.json`; release workflow uses `TAURI_SIGNING_PRIVATE_KEY` and verifies updater manifest/signatures. | Authenticity/integrity of an updater artifact within Tauri updater's signature scope. | Which artifact is installed now, package-to-process binding, mapped image, or current process instance. | Signing secret and manifest verification workflow exist; key rotation/revocation and post-install measurement are not established here. Windows `certificateThumbprint` and macOS `signingIdentity` are null. |
| `APP_CONFIGURATION` / approval (`AUTHORITY` only for signed approval) | Deterministic hashes of declared compile/runtime configuration projections; approval signs expected fingerprint/candidate fields. | APP configuration producer and separate approval authority; approver ownership is unresolved. | Contract defines projection; approval root is not configured as a production application pin. | Projection consistency and, if separately rooted, approval of the expected fingerprint. | Actual values loaded by a particular process, current APP binary, or approved source authority. | v3 evidence windows and key status are checked; production root and historical authorization are not established. |
| `INDEPENDENT_AUTHORITY_RECEIPT` (`AUTHORITY` for receipt claims) | Candidate, configuration, deployment, capture, and declared binary-hash claims in its signed fields. | Intended independent candidate authority is external and unnamed/unconfigured. | Dedicated receipt registry/root is required but production-pinned roots are absent. | The explicitly signed claims if the signature, authorization, validity, and root trust all pass. | Measurement of the current process unless the authority independently observes and signs it; builder truth or unsigned fields. | v3 lifecycle/status and evidence-validity checks exist; accountable owner, root pin, and historical authorization remain unresolved. |
| Candidate artifact identity (`EVIDENCE` / `IDENTITY`) | Canonical metadata and exact Presentation bytes; APP config projection hash and capture identifiers. | Candidate capture producer/operator; no independent authority is established by the hash. | None by itself; local bytes are recomputed. | Local consistency and cryptographic byte binding. Current output labels are `CRYPTOGRAPHICALLY_BOUND` and `LOCAL_CONSISTENCY`. | Independent authentication, installed image, or current process. | Capture timestamp is metadata; no authority lifecycle or freshness challenge is provided by identity hashing. |
| Candidate configuration binding (`EVIDENCE` / readiness assessment) | Separately assesses approval, Builder, candidate authority, deployment identity, and operator-supplied current-binary metadata. | Assessment code is repository-owned; each signed authority owner remains separate/unresolved. | Trust bundles and application roots are inputs; production application pins are not configured. Current binary authenticator is hardcoded absent. | Signature/lifecycle/payload consistency for supplied evidence and explicit missing predicates. | Authenticated current APP binary or readiness authorization while any required predicate is absent. | Current evidence windows and registry states are assessed; current-binary source and production pins are not implemented/configured. |
| `CURRENT_BINARY_IDENTITY` operator JSON (`IDENTITY`, untrusted metadata) | Schema-checked artifact identity, digest, source commit, provenance label, evidence digest. | Operator/input-file author. | None; a caller-selected file path and valid JSON are not a trust root. | Only that the supplied metadata parses and can be compared to signed Builder claims. | Source authority, installed artifact, current process, or authenticity of any stated digest. | No independent freshness, replay, signer lifecycle, or revocation semantics. |
| Device key / FUSOU-WEB device authority (`AUTHORITY` for device ownership; `EVIDENCE` for key possession) | Registered public key, device/user association and revocation checks; signatures cover protocol challenges/session fields. | Device-key holder; FUSOU-WEB service owns server-side registration/ownership/revocation data. | Registered public key in server-side device records plus server-side ownership/revocation checks and protocol challenge policy. Offline source-proof inputs do not independently authenticate that registry. | Possession of the corresponding key for the signed message, and online device ownership/revocation under the WEB contract. | APP authenticity, device OS integrity, or proof the signer is genuine FUSOU APP. | Online revoke state and replay-consumption tables exist in the route; local private key is a file (Unix `0600`; Windows app-data assumption), not an OS keyring/hardware process identity. |
| PID and `current_exe()` (`DIAGNOSTIC`) | PID is an operational selector; `current_exe()` reports an executable path in APP info output. | Local OS / calling APP. | None as an AD-5 trust root. | Diagnostic process/path metadata. | Stable process instance, measured mapped bytes, authority, or freshness. | PID reuse and path/object replacement are not addressed by these values; neither is used here as security identity. |
| `CURRENT_PROCESS_IMAGE_SOURCE_AUTHORITY` (absent) | Must authenticate a fresh measurement of the exact APP process/image and cross-bind it to Builder Provenance. | **Owner, administrative independence, credential generation/custody, and incident responder are unresolved.** | Dedicated application-pinned source root required; not configured. | Nothing today; this is an external prerequisite, not an existing authority. | It cannot inherit authority from Builder, `/health`, updater signature, PID, `current_exe()`, operator JSON, or device key. | No signer lifecycle, rotation, revocation/status, or compromise-recovery policy is selected. |

### C. Independence model and key-domain separation

Independence is a governance and control property, not a key-name or signature-format property. The following acceptance rules must be decided by accountable humans before selecting a source:

| Independence dimension | AD-5 requirement | Decision rule / unresolved input |
| --- | --- | --- |
| Owner independence | Builder must not be able to assert or mint the observation that its own artifact is currently running. Candidate and configuration-approval authorities must not silently become the process-measurement authority. | The same legal organization is not automatically disqualifying, but same owner, administrative principal, account, release workflow, or unilateral credential control is not independent. If APP developers and the proposed authority share organization, identify who can replace the APP/helper, change policy/root, issue statements, and respond to compromise. The relying party must explicitly accept any shared top-level administration or collusion threat; otherwise independence is not established. |
| Technical independence | The observation must come from a boundary that can inspect the target process and that the target APP cannot forge or rewrite. | APP-generated hashes, self-reported fields, APP-controlled IPC, or a helper replaceable/controlled by the APP user do not qualify. A helper would need an independently authenticated binary/service identity, OS-enforced privilege/IPC policy, protected credentials, and evidence that the measured process is the one in the protected session. None is selected. |
| Trust-root independence | Process Authority verification must not collapse into Builder authorization. | Separate signing keys under the same Builder-controlled root/account are key separation, not trust-root independence. Reusing the Builder root allows a Builder compromise/control to mint both build and process claims, defeating independent cross-checking. The default AD-5 requirement is a separately governed and separately pinned Process Authority root. Any shared root would be a material reduction of the independence claim and requires an explicit human decision; it is not accepted implicitly. |
| Operational independence | Key custody, issuance policy, root acceptance, lifecycle, revocation, and incident response must have named accountable operators. | Distinct role labels are insufficient. Name separate custodians/operators or document accepted shared control; define two-person/approval controls if required, rotation and emergency revocation authority, verifier fail-closed behavior, and recovery. These owners and policies are currently unknown. |

Builder Provenance alone is not an acceptable Process Authority statement: a Builder can attest to its build without observing what currently runs. A Candidate or configuration approval signature proves only its declared signed scope. If the same organization operates multiple roles, the threat model must state whether shared IAM, CI, cloud accounts, release permissions, senior administrators, or incident responders are within the trusted boundary.

For `CURRENT_PROCESS_IMAGE_SOURCE_AUTHORITY` to be independent of `BUILDER_AUTHORITY`, the process measurement must be produced by a separately controlled measurement boundary, with independently governed credentials, signing-key custody, lifecycle/incident response, and a root pinned by the relying application through a trusted configuration path. The source must not be able to rewrite or self-assert the builder receipt it compares against. The builder must not be able to mint the process-measurement statement merely because it created the binary.

If the builder signs “this is the current process,” no measurement independence remains: the builder can assert execution without observing it. A different key under the same builder-controlled root, account, workflow, or secret store gives cryptographic key separation but not independent control. Reusing the same signing key or application root across Builder, Candidate, Configuration Approval, and Process Image Source domains collapses those trust boundaries. Distinct signed scopes prevent signature transplantation; they do not make one operator independent from itself. The existing v3 key-reuse check is limited to registries co-evaluated in one assessment and makes no global uniqueness claim.

The required independence checks for the new source are separate:

- **From `BUILDER_AUTHORITY`:** the source measures a live process through a separately controlled platform/helper boundary; Builder cannot mint the measurement or alter the source's observation. Shared operator control, root, or signing custody fails this independence claim even if the keys differ.
- **From `CANDIDATE_AUTHORITY`:** candidate approval/receipt issuance must not let that authority self-assert process measurement. The process source needs separate owner, credential custody, root, and verification path; otherwise it is another candidate-authority claim, not an independent source.
- **From `CONFIGURATION_APPROVAL_AUTHORITY`:** approval of expected configuration must not authorize the source's measurement key or let the approver assert process identity. The source root and lifecycle must be separately governed and pinned for its own scope.

An application pin is mandatory: the relying application must receive the dedicated source root through trusted, release-controlled application configuration. A root bundled in source evidence or operator JSON is not a pin. Pin ownership, bootstrap, rotation, and compromise recovery remain UNRESOLVED.

## 3. Requirement matrix

### A. AD-5 security objective

The security objective is:

> The relying verifier can establish, with independently authenticated evidence bound to a fresh verifier-issued challenge, that the exact FUSOU APP process participating in the protected capture/gameplay session corresponds to an approved application artifact covered by trusted Builder Provenance.

Interpretation constraints:

- The relying verifier, not the APP's self-report, decides whether the evidence and cross-binding are acceptable.
- The process authority authenticates a current process observation; the Builder authority authenticates build/artifact claims. They are distinct claims and distinct authority domains.
- “Exact process” means a process instance and image relation defined by a selected platform measurement profile, not a PID or executable pathname alone.
- The session/capture scope must be bound to the assessed process evidence. A valid image measurement for a different process or session does not satisfy the objective.
- The statement proves only what its measurement profile includes. It does not implicitly prove runtime configuration, absence of all injected code, or machine integrity unless those are separately measured and accepted.
- This is a target security property, not a claim that any existing component currently provides it and not an implementation selection.

### Three separate claims

| Layer | Security question | Existing evidence and current status |
| --- | --- | --- |
| Artifact authenticity | Is this an artifact authorized by the accepted Builder authority? | Builder Provenance v2 has signed fields for candidate/artifact identity, digest, source, workflow, toolchain, and builder. Signature and registry checks exist, but production application-pinned Builder roots are not configured. Status: build claims are representable and verifiable; production trust is not established. |
| Installation authenticity | Is the APP image currently installed on this device cryptographically bound to that approved artifact? | Tauri updater public key/signing and updater-manifest verification cover updater artifacts. No trusted install receipt or inspection binds installed package bytes to a Builder artifact. Windows certificate thumbprint and macOS signing identity are null. Status: NOT ESTABLISHED. |
| Current-process authenticity | Is the process currently performing capture/gameplay the process whose mapped image corresponds to the approved artifact? | No process-object authority, mapped-image measurement, process-to-image binding, or measurement-to-Builder cross-binding exists. `current_exe()` is informational path output; PID is not an authority. Status: `UNVERIFIED / NOT_IMPLEMENTED`. |

The AD-5 objective is the third row. Artifact authenticity does not imply installation authenticity, and neither implies current-process authenticity. Do not compose these claims by treating a Builder signature as a live measurement.

### B. Authority statement semantic contract

The following are semantic requirements for future evidence, not a JSON schema or selected wire format. A field may be represented indirectly only if the relying verifier can establish the same property without trusting an APP-supplied label. The source authority signs a domain-separated statement over the accepted fields; the relying verifier validates the signature, authority scope, root, freshness, and each binding separately.

| Semantic field / claim | Why it is needed and threat addressed | Producer | Relying-verifier check |
| --- | --- | --- | --- |
| `authority_id`, `authority_scope`, signing key ID and algorithm | Identifies who is asserting the process observation and prevents scope/key substitution. | Independently governed Process Authority. | Resolve the key to the human-approved authority and exact process-measurement scope under the accepted root; reject unknown, retired, or wrong-scope keys. |
| `subject_installation` | Distinguishes the installation under assessment from another copy of the same release; addresses cross-installation replay and installer substitution. | Process Authority from an independently verifiable install context, if installation identity is in scope. | Verify the installation claim under its defined authority and bind it to the process object; never accept an operator path or version string alone. |
| `process_instance_identity` | Distinguishes the live process instance from another process, restart, or PID reuse. | Process Authority using its platform process-observation boundary. | Verify it identifies the challenged process instance and remains valid at the consuming decision; PID alone is not sufficient. |
| `process_object_identity` or equivalent binding proof | Shows that the authority measured through the same OS process object it identifies, rather than looking up a process by a reusable selector. A raw local handle value is not a portable proof. | Process Authority; exact representation is platform-specific and undecided. | Validate the signed object/process relation and reject object changes, exit, restart, or a response referring only to an untrusted PID/path. |
| `measurement_profile` | Defines what “image” means: on-disk bytes proven mapped, normalized loaded image, executable pages, modules, injection/JIT scope, and canonicalization. Prevents comparing unlike measurements. | Process Authority publishes a versioned profile; policy approval is a human input. | Require an approved profile and check that the measured value has the same preimage semantics as the comparison/derivation used for Builder Provenance. |
| `measured_image` | Supplies the actual measurement and relevant image/object relation; addresses modified, replaced, and patched images. | Process Authority from the process-bound measurement, not APP self-report. | Recompute/validate according to the approved profile or verify the authenticated measurement result; reject path-only or unsigned digest claims. |
| `artifact_identity` | Names the release artifact the process measurement is claimed to correspond to. | Process Authority references the artifact established by the separate Builder evidence. | Resolve and compare to the independently verified Builder Provenance; a filename, version, or bare hash without defined bytes is insufficient. |
| `builder_artifact_reference` | Selects the exact Builder Provenance statement/artifact record to cross-bind and prevents substituting another valid build's provenance. | Process Authority references an immutable Builder record identifier/digest; Builder still signs only its own statement. | Independently verify Builder signature, signer authorization, validity, and root; then compare candidate/artifact identity and compatible measurement values explicitly. Do not treat a reference as verification. |
| `challenge` | Establishes freshness and binds the response to this relying-verifier request, process target, and attempt; addresses stale and replayed evidence. | Generated by the relying verifier, not the APP. | Verify exact challenge, verifier identity, target/capture scope, expiry, unpredictable challenge policy, and one-use state. |
| `capture_scope` | Binds evidence to the candidate/capture/session or protected action for which it is consumed; addresses evidence transplantation between sessions. | Relying verifier defines scope; Process Authority signs the exact scope it measured for. | Compare every scope identifier to the active attempt/job and protected capture/gameplay request. |
| `issued_at` | Supplies the source's signed creation-time claim for policy and diagnostics. | Process Authority clock. | Treat as an issuer claim only; also enforce verifier-observed time and challenge validity. It is not an independent timestamp. |
| `expires_at` or bounded validity | Limits how long an observation may be used and narrows stale evidence windows. | Process Authority signs a bounded validity claim under policy. | Enforce a short policy maximum against verifier time; expiry alone does not prevent replay within the window or process change after measurement. |
| `subject_machine_or_platform_context` when cross-machine replay is in scope | Binds evidence to the intended machine/platform context; a machine label alone does not identify an APP process. | A separately authenticated platform identity source, if selected. | Validate the identity under an accepted root and bind it to the process evidence. Do not treat a serial number or APP-supplied machine ID as authority. |
| `authority_signature` | Authenticates the exact statement and prevents field substitution. | Process Authority signing key under independently controlled custody. | Verify signature over an unambiguous domain-separated encoding, then separately verify signer authorization, pinned root, status, and lifecycle. |

This contract intentionally does not prescribe field serialization, platform APIs, a nonce service, or a source. Measurement of a file that is not proven to be the image mapped by the subject process does not satisfy `measured_image` plus `process_object_identity`.

#### Builder relation: independent verification and cross-binding

The selected evidence relationship is a requirement, not an authority/implementation selection:

```text
Process Authority statement --independently verified under Process Authority root--+
  +--> relying verifier explicitly cross-binds
Builder Provenance -----------independently verified under Builder root-------------+    candidate, artifact, and compatible measurement
```

The alternative “Process Authority statement merely references a Builder record” is insufficient: a reference does not validate that record or prove the measurement matches it. The Process Authority statement must not be an extension of, or signed by, the Builder authority as a substitute for an independent observation. The relying verifier verifies each statement under its own accepted root, then compares the exact `candidate_artifact_id`, `artifact_identity`, and byte/measurement relation under the declared profile. If the Process Authority measurement is not byte-identical to Builder `binary_sha256`, a separately reviewed derivation must define the relation; opaque v3 `evidence_sha256` must not be reinterpreted as that measurement.

### Completed current-binary audit

| Requirement | Current evidence | Status | Missing authority |
| --- | --- | --- | --- |
| Artifact identity and digest | Builder Provenance v2 schema/signature payload supports `candidate_artifact_id`, `artifact_identity`, and `binary_sha256`. The provenance contract separately checks signer authorization and evidence validity. | `PARTIAL`; the claim format/verifier exists, but production application pins are not configured. | Independently governed Builder root delivered through trusted application configuration; verified artifact bytes/identity semantics. |
| Source and workflow provenance | Builder payload includes `source_commit`, `build_workflow_identity`, `toolchain_identity`, and `builder_identity`. | `PARTIAL`; signed claims can be checked, but no running-process link follows. | Trusted Builder authority plus process-measurement statement that names the same artifact/source claims. |
| Signer / registry scope | v3 separates Ed25519 signature verification, signer authorization, root trust, evidence validity, and candidate binding. | `PARTIAL`; production trust roots are not configured and historical authorization is not independently proven. | Application-pinned Builder root and governed registry lifecycle. |
| Installed image equals Builder artifact | Tauri updater key and release workflow sign/verify updater artifacts. No observed trusted install record or installed-file-to-provenance comparison. | `NOT_ESTABLISHED`. | Independent installation authority or OS/platform source binding the installed image object/digest to the trusted Builder artifact. |
| Installer/package identity to running image | Tauri package identity/version and updater configuration exist; Windows `certificateThumbprint` and macOS `signingIdentity` are null. | `NOT_IMPLEMENTED`. | A trusted chain from installer/package identity through installed object to the image mapped by the assessed process. |
| Running process object | No process handle/object identity is supplied to candidate assessment. PID is not treated as security identity. | `NOT_IMPLEMENTED`. | Independent source that identifies and retains/binds the exact live process instance; PID alone is insufficient. |
| Mapped executable measurement | APP info calls `std::env::current_exe()` and emits its path. There is no mapped-image measurement verifier. | `NOT_IMPLEMENTED`. | Independent platform/helper authority with defined measurement semantics for the image actually mapped by the target process. |
| Process-to-image binding | No evidence binds the process object to a measured image object or loaded image state. | `NOT_IMPLEMENTED`. | Source authority that measures through the same process object and proves object/image relation under a defined profile. |
| Measurement-to-Builder binding | Operator binary JSON can be compared to Builder fields. Candidate hash binding is local consistency only. | `NOT_IMPLEMENTED` for current process. | Independently authenticated measurement and explicit equality/derivation to trusted Builder artifact identity and compatible digest. |
| Process freshness | No relying-verifier challenge is signed together with a process/image observation. | `NOT_IMPLEMENTED`. | Challenge issuer other than the untrusted APP, short validity, source signature, and binding to the exact process instance. |
| Stale evidence and replay | Runtime Attestation freshness applies to Canary Worker deployment evidence, not APP process evidence. | `NOT_IMPLEMENTED` for APP. | Fresh challenge and atomic one-use state at the relying decision; Worker timestamps cannot substitute. |
| Other process, installation, restart, or PID reuse | No process-instance token/handle or install identity is evaluated by the binding assessment. | `NOT_IMPLEMENTED`. | Process-object and installation binding, with invalidation/reassessment on process exit, restart, or target change. |
| Executable/path substitution and TOCTOU | A reported path or later hash is not bound to the executable object mapped by the process or to its continued use. | `NOT_IMPLEMENTED`. | Stable object/process binding across measurement and the consuming capture/gameplay decision; explicit replacement and race policy. |

The implementation-level readiness path is explicit: `candidateConfigurationBindingAssessment()` sets `authenticatedBinary = null`; readiness requires `!!authenticatedBinary`; the report emits `authenticated_current_binary_identity.status = "UNVERIFIED"` and `readiness_gate = "BLOCKED"`. `CURRENT_BINARY_IDENTITY` is loaded from a caller-selected JSON path and remains metadata. Therefore the fixed result is `authenticated_current_binary = UNVERIFIED / NOT_IMPLEMENTED`.

Every row is required by the source prerequisite. `UNRESOLVED` means the property has neither a selected source nor a selected verification point in the current repository. The verification point shown is a design boundary, not implemented behavior.

| Property | Required | Candidate source | Verification point | Current status |
| --- | ---: | --- | --- | --- |
| Authority identity | YES | Platform/service/hardware identity under its independently governed credential chain | Relying verifier resolves the evidence signer to a dedicated source-authority identity and scope | UNRESOLVED |
| Authority authentication | YES | Signed source statement / authenticated platform response | Separate source-evidence verifier under an application-pinned root | UNRESOLVED |
| Process-instance identity | YES | OS process object/handle plus non-reusable creation identity; never PID alone | Source binds identity at measurement; consumer checks it is the challenged instance | UNRESOLVED |
| Current image measurement | YES | Measurement of the executable object actually mapped to that process, with a precisely versioned measurement profile | Source verifies process-to-object mapping and digest semantics; consumer verifies statement | UNRESOLVED |
| Artifact identity | YES | Builder-signed release/provenance record containing the candidate and artifact identity | Consumer loads/verifies trusted Builder Provenance v2 and compares its signed identity | Builder claim exists; source-side link UNRESOLVED |
| Builder binding | YES | Source statement references the same `candidate_artifact_id`, `artifact_identity`, and compatible image digest as Builder Provenance v2 | Candidate assessment performs an explicit cross-evidence comparison after both authorities verify | UNRESOLVED |
| Freshness | YES | Verifier-generated challenge, optionally combined with an independent authority challenge/quote nonce | Challenge issuer and relying verifier validate scope, entropy, expiry, response binding, and one-use state | UNRESOLVED |
| Replay resistance | YES | Fresh challenge signed into the source response | Existing relying-attempt state atomically consumes the challenge; no new global nonce service is presumed | UNRESOLVED |
| Substitution resistance | YES | Stable OS object/handle binding from measurement through assessment/use | Source measures through a live process reference and consumer rejects process/object mismatch or restart | UNRESOLVED |
| Authority root pin | YES | Dedicated source-authority root, delivered through trusted application configuration | Candidate/source verifier compares root identity to compiled/release-controlled application pin, never operator JSON | NOT CONFIGURED |
| Authority lifecycle | YES | Scoped signer registry with existing lifecycle vocabulary where applicable | Source verifier validates current status, scope, and validity separately from signature mathematics | UNRESOLVED |
| Lifecycle / compromise handling | YES | Independently governed key custody, rotation/revocation process, and incident response | Relying verifier checks the authorized lifecycle state and rejects compromised/retired credentials under a defined policy | UNRESOLVED |
| Revocation/status | AS NEEDED | Authority status channel/registry under a declared availability and freshness policy | Source verifier evaluates revocation/status at validation time and fails closed according to policy | UNRESOLVED; no service proposed |
| Historical verification | AS NEEDED | Authenticated versioned status/registry chronology only if a retrospective claim is required | Historical verifier proves signer authorization at the relevant time, not just signature validity | NOT REQUIRED for current-process readiness; v3 does not provide it |

### Freshness semantics

These time/challenge concepts are not interchangeable:

| Signal | Meaning | Limitation |
| --- | --- | --- |
| Source-generated timestamp | Source asserts when it created the statement | A signed timestamp proves only that the source signed that claim; it is not an independent time attestation. |
| Verifier-observed timestamp | Consumer records when it received/checked evidence | Does not show that a replayed source response was created then. It is useful only with a fresh challenge. |
| Verifier-generated challenge | Relying verifier creates unpredictable, scoped input before measurement | The source response must sign the exact challenge and measurement. The verifier must validate expiry and one-use state. |
| Remote authority challenge | Remote source issues a challenge for a request/session | Issuer identity, entropy, scope, expiry, and consumption semantics must be authenticated; it is distinct from a local verifier challenge. |
| Hardware quote nonce | Nonce included in a hardware-backed quote | Authenticates quote freshness only when quote verification and nonce policy pass; it does not by itself bind a FUSOU PID/image. |
| Process start time | OS-reported creation time/identity component | Not globally unique or a freshness authority; pair with an OS process object/handle and source challenge. |
| Deployment timestamp | Time a deployment system reports release/deploy activity | Does not prove which image a particular process currently maps or whether it was substituted. |

### E. Freshness model (minimum requirement, not selected architecture)

The following time values have distinct meanings and cannot substitute for one another:

| Value | Classification | What it can establish | What it cannot establish |
| --- | --- | --- | --- |
| Source `issued_at` | Authority-signed time claim | The source signed a statement containing this timestamp. | Independent physical time, a fresh verifier request, or non-replay. |
| Verifier receive time | Verifier observation | When this verifier received these bytes. | When the signed observation was created or whether it was replayed. |
| Process start/creation time | Supporting process-instance discriminator | A platform-reported creation value that may help distinguish a restart. | Globally unique process identity, trusted freshness, or challenge consumption. |
| Deployment time | Deployment-system event claim | A deployment system's report of release/deployment timing. | The APP image currently installed or mapped in a particular process. |
| Hardware quote nonce | Quote freshness input | Freshness of the values actually covered by a successfully verified quote. | FUSOU APP process identity unless the quote chain also measures and binds that exact process. |
| Verifier-issued challenge | Required freshness input | A fresh, scoped verifier request when the response authenticates the exact challenge and the verifier consumes it once. | That the measured process remains unchanged after the observation; use-time process binding is separately required. |

Minimum challenge-response constraint, still unimplemented and not an architecture selection:

1. A relying verifier other than the APP generates an unpredictable challenge and binds it to its identity, Process Authority/root, candidate and Builder reference, target process/install context, capture/session scope, expiry, and one-use attempt/job.
2. The authority measures through the same live process object it identifies and signs the exact challenge, process-instance/object binding, measurement profile/value, Builder reference, capture scope, and bounded validity in one statement.
3. The relying verifier verifies the Process Authority signature/root/scope and the Builder statement independently, then checks exact challenge, target, capture scope, expiry, measurement semantics, and explicit cross-binding.
4. The relying verifier atomically consumes the challenge in existing attempt/job state before accepting the protected capture/gameplay result. No new global nonce registry is assumed. If the actual consuming path cannot atomically enforce one-use, replay resistance is unmet and AD-5 remains blocked.
5. Evidence is invalidated if the target process exits, restarts, changes object, or no longer corresponds to the session at the consuming boundary. A short expiry narrows a window but does not itself prevent TOCTOU.

An APP-generated nonce is not a freshness authority: a compromised or substituted APP controls the request and cannot establish that a trusted source observed the current process. An APP nonce becomes useful only when an independently authenticated source measures the challenged process and signs the exact nonce, and the relying verifier owns the one-use decision.

### D. Process identity model

#### Process-instance binding

“The binary is trusted” is insufficient. The statement must mean “this exact measurement belongs to this process instance, observed for this assessment.”

| Candidate identifier/property | Design treatment |
| --- | --- |
| PID | Diagnostic selector only. PIDs are reused and can name a replacement process; never use alone as security identity. |
| Process creation/start time | Include as a supporting discriminator if supplied by the OS, but not as a unique cryptographic identity. |
| OS process handle/object identity | Preferred binding primitive for a local source: open/retain a handle with required access, inspect that referenced process, and reject if it exits or changes before completion. Exact rights/API remain platform-specific and unselected. |
| Executable path | Locator/diagnostic only. It can be mutable, redirected, replaced, or resolve to a different object later; it does not identify mapped bytes. |
| Executable object identity | Bind the process's mapped main executable to a stable file/object reference (file ID/inode plus volume/filesystem identity as applicable) while hashing/validating. A pathname is not an object identity. |
| Mapped image | Measurement subject, only when the source proves the measured bytes/pages belong to the identified process object under a versioned profile. |
| Code-signing identity | Evidence about a signer/designated requirement is supplemental. It is not a digest of the current mapped image and is not enough by itself. |
| Installation identity | Installation-level identity/claim. It may distinguish installations when authenticated, but does not prove which image a running process maps. |
| Machine/platform identity | Machine or platform scope only, if independently authenticated. It can constrain cross-machine replay but does not identify a particular APP process or installation by itself. |
| Kernel/platform measurement | Stronger only if the platform reports measurement for the same process/object and its trust chain/policy is independently validated. A machine boot measurement is not automatically an application measurement. |
| Process replacement/restart | Any exit, handle change, creation-identity change, or new process after measurement invalidates the evidence for “current process.” Reassess immediately at the consuming boundary. |
| Executable replacement | Hashing a path and later opening/executing it is TOCTOU-prone. Measure the object actually mapped, or prove stable object identity from mapping through measurement. |
| Same-user attacker | Must be explicitly in or out of scope. If in scope, ordinary user-level IPC and path checks are inadequate; the source needs OS-enforced isolation and anti-injection policy. |
| Privileged attacker | A local administrator/root/kernel compromise can generally subvert local observations. Excluding or detecting this requires a hardware/remote trust chain, not a stronger self-hash. |

`PID + current_exe() + SHA-256` does not satisfy AD-5: PID can be reused; `current_exe()` is a path lookup/diagnostic, not a stable mapped-object identity; hashing bytes at a path does not establish those bytes are mapped in the selected process; no independently trusted source authenticates the measurement; and replacement/restart between measurement and capture creates TOCTOU and replay/substitution opportunities. A digest is a comparison value, not an authority.

The measurement profile must state whether it hashes exact on-disk executable bytes proven to be mapped, normalized loaded image bytes, or measured executable pages. These values are not presumed equal. It must also state whether code injection, writable/executable pages, loaded modules, JIT code, and child processes are in scope. Evidence about an executable file alone cannot claim that all code currently executing inside the process is unmodified.

## 4. OS profile

FUSOU's Tauri bundle declares `targets: all`. Current release/check workflow matrices contain Ubuntu and Windows runners; macOS matrix entries are commented out. This shows intended packaging breadth, not equal runtime validation. The APP has Windows-specific bindings and Linux GTK/WebKit dependencies; no current APP process-image authority adapter is configured.

### Windows

- Authenticode/WinVerifyTrust can validate a file signature and signer chain under a policy; that is distribution/file validation, not proof that the inspected bytes are the image mapped by a particular live process.
- A process handle and file identity can support process/object binding, but PID, `current_exe()` path, and a later file hash remain vulnerable to reuse or replacement races unless the measured object is tied to the live mapping and rechecked at use.
- Windows Code Integrity policy or process code-identity signals would need their exact API, caller privilege, protection against same-user manipulation, and signed evidence format specified and tested. The present APP dependency only enables general foundation/threading/filesystem APIs; no WinTrust/code-integrity authority path is configured.
- `tauri.conf.json` currently has `bundle.windows.certificateThumbprint: null`. Do not infer Authenticode coverage from updater signing.

### macOS

- Code signatures, designated requirements, Team identity, and runtime code-signature validation can contribute signer/code-object claims. The selected verifier must still bind its result to the exact live process and measured image; signer identity or a valid bundle signature alone is insufficient.
- Notarization is a distribution assessment, not a fresh measurement of a running process.
- `tauri.conf.json` currently has `bundle.macOS.signingIdentity: null`. The macOS build rows are commented out in the current workflow matrices, so this audit cannot claim an exercised FUSOU macOS measurement path.
- No SecCode/process-code object integration or application-pinned platform-authority policy is configured in current APP source.

### Linux

- `current_exe()` plus SHA-256 measures bytes found through a path at one time. The path can be replaced, the executable can be unlinked/replaced after launch, and later path lookup need not identify the object mapped by the process. A digest has no authority or process binding by itself.
- An inode/file ID can distinguish filesystem objects only when paired with filesystem identity and a stable open object; it does not independently attest code pages or prevent same-user/root mutation.
- fs-verity can provide integrity for a verity-enabled file against a trusted digest, but FUSOU has no policy proving the expected digest or binding the file to the live process.
- IMA can measure/appraise executions under a configured kernel policy. A local measurement log is not independently authenticated by itself; TPM quote/PCR and event-log validation would be needed for a remote claim, and those still need a target-process/application binding layer.
- Distribution package signatures establish package provenance only. No IMA/fs-verity/TPM quote collector or verifier is configured in current APP source.

Across all profiles, platform capabilities are candidate mechanisms, not FUSOU authority until their exact source identity, policy, root pin, process binding, measurement semantics, challenge handling, and consumer verification are implemented and tested.

### F. Platform authority requirements (no API selection)

Each supported platform must provide the same security properties even if its evidence mechanism differs: an authenticated observation boundary; stable binding to the exact process instance/object; a defined measurement of the image actually mapped; a signed authority statement under an accepted root; verifier-issued freshness; replay rejection; and a cross-binding to Builder Provenance. These are requirements, not selected APIs or claims about current FUSOU support.

| Platform / evidence candidate | What it may prove | What it does not prove by itself | AD-5 requirement / current gap |
| --- | --- | --- | --- |
| Windows: process object/handle | A stable OS reference can help identify the process object inspected by a local authority. | A PID or handle value alone does not authenticate the authority, measure mapped bytes, or bind capture use. | Authority must retain/bind the same process object through measurement and acceptance, detect exit/restart, sign the observation, and bind it to a fresh verifier challenge. No such FUSOU path is selected. |
| Windows: Authenticode / package signature | Signature policy can establish signer/file claims for the signed file or package. | It does not by itself prove the inspected bytes are mapped by the target running process, fresh, unmodified after install, or the Builder artifact accepted by the relying verifier. | Require a separately trusted link from signed artifact/package to the actual mapped image and process object. Current `certificateThumbprint` is null; updater signing remains distribution scope. |
| Windows: Code Integrity / process code identity | A configured OS policy or process code-identity observation may contribute a platform-mediated execution/code claim. | The name of a facility or enabled policy does not establish exact image-measurement semantics, independent verifier trust, freshness, or Builder binding. | Select and validate policy, observer trust, process mapping semantics, challenge/signature format, and same-user/admin threat boundary before adoption. None is selected. |
| Linux: path hash | Hashes bytes obtained by opening a path at a particular time. | Does not show those bytes are the object mapped by the process; path replacement, unlinking, and hash/use races remain. It is not an authority. | Must bind a stable object and measurement to the exact process instance; pathname plus digest is insufficient. |
| Linux: inode/file ID and open file object | Can distinguish a filesystem object when paired with filesystem identity and a stable open reference. | Does not prove the object is the executable mapped by the target process, that executable pages are unchanged, or that a trusted source observed it. | Require process-to-object/mapping proof, authority authentication, freshness, and comparison to Builder semantics. |
| Linux: fs-verity | For a verity-enabled file, can enforce content integrity against a trusted digest under its filesystem/kernel policy. | Does not establish who authorized the digest, that the process maps that file, process identity, loaded-code integrity, or a fresh remote statement. | A separately accepted expected digest and process/object binding remain necessary; no FUSOU fs-verity policy or verifier exists. |
| Linux: IMA | Under a configured kernel policy, can measure/appraise selected events/files according to that policy. | A local log is not automatically an authenticated remote statement for this APP process; event semantics do not automatically bind the exact live process, capture session, or Builder artifact. | Require a validated policy, trusted log/quote appraisal where applicable, exact process/image relation, challenge response, and Builder cross-binding. No IMA collector/verifier is configured. |
| Linux: TPM quote | A verified quote can authenticate selected PCR values and a quote nonce under its attestation key. | Does not inherently measure or identify the FUSOU APP process, prove a particular file is mapped, or establish the Builder artifact relation. | Boot/event-log appraisal, target-process measurement, verifier challenge, process binding, and Builder cross-binding must each be established separately. No FUSOU end-to-end chain exists. |
| macOS: code signing / designated requirement | Can establish code-object signer or identity-rule claims for the object evaluated under the selected policy. | Does not by itself prove fresh mapped-image bytes for the exact process, prevent runtime substitution/injection, or bind the claim to Builder Provenance. | Require a process-object-specific measurement/validation, trusted authority statement, challenge, and explicit Builder comparison. Current signing identity is unset. |
| macOS: SecCode/process validation | May contribute an OS-mediated code identity/validation for a process under a chosen policy. | Does not automatically provide the required versioned byte-measurement semantics, relying-verifier challenge, process-to-capture continuity, or Builder artifact binding. | Specify and validate source identity, caller/policy boundary, exact process relation, freshness, and cross-binding before treating it as evidence. No FUSOU SecCode path is configured. |
| macOS: notarization | Establishes a distribution-time Apple assessment for the submitted software under notarization policy. | Does not attest which image is currently mapped by a live APP process or prove process freshness. | Distribution evidence may remain useful for artifact/install policy but cannot close current-process authenticity. Current signing identity and macOS CI coverage are absent. |

No platform row is an endorsed candidate. Platform-specific evidence may be combined only after the responsible authority, accepted root, measurement semantics, process binding, and verifier policy are selected; listing a platform primitive does not satisfy the human authority decision.

## Builder binding

Builder Provenance v2 already signs `candidate_artifact_id`, `artifact_identity`, `binary_sha256`, `source_commit`, `build_workflow_identity`, `toolchain_identity`, and `builder_identity`. A future process-source statement must not replace or be folded into that builder signature.

The intended relation is:

`measured current process image` -> `released artifact identity and digest` -> `trusted Builder Provenance v2`

The relying verifier must independently verify the source-authority statement and the builder statement under separate trust domains, then compare at least the exact candidate ID, artifact identity, and digest under a documented measurement profile. `artifact_identity` must resolve through a signed release/provenance record; a filename, version string, operator label, or bare hash equality is not a release-authority proof. Hash equality binds bytes only when both sides define the same canonical byte preimage.

Builder `binary_sha256` refers to the builder's artifact bytes. A platform may report mapped/normalized image measurements that are not byte-for-byte equal. If so, a signed and reviewed derivation/profile must bind that measurement to the release artifact; the verifier must not silently compare unlike digests. A new field such as `measured_executable_sha256` would have distinct semantics from v3 `evidence_sha256`. The latter remains an opaque, authority-signed commitment whose referent is unspecified; do not reinterpret it or rehash it as artifact bytes.

The APP configuration fingerprint remains a separate predicate. A process-image measurement does not prove the live runtime configuration values. The source must not claim a configuration fingerprint unless that configuration is independently measured under a separately defined profile.

## 5. Existing v3 integration

Preserve the three frozen signed evidence domains:

- `APPROVED_EXPECTED_CONFIGURATION_FINGERPRINT`
- `AUTHENTICATED_BUILDER_PROVENANCE`
- `INDEPENDENT_AUTHORITY_RECEIPT`

Do not add current-process identity fields to their signed payloads or change these v3 semantics:

- Ed25519 signature verification remains separate from signer authorization and root trust.
- `ACTIVE`, `VERIFY_ONLY`, `RETIRED`, and `REVOKED` retain their current meanings; current signer authorization is not inferred from signature validity alone.
- Signed `issued_at` remains an issuer claim, not independently attested physical signing time.
- Evidence validity remains enforced separately from issuance time.
- Application-pinned root remains the trust basis; production application pins remain NOT CONFIGURED.
- Historical signer authorization remains NOT PROVEN by the current registry snapshot model.
- `evidence_sha256` remains `AUTHORITY_SIGNED_OPAQUE_COMMITMENT`; its referent is not reinterpreted or implicitly rehashed.

Do not route the new source through the existing Builder signature verifier.

If a source is selected in a future change, the safest integration is a separate predicate named `AUTHENTICATED_CURRENT_BINARY_IDENTITY_SOURCE`, with its own evidence verifier, signed scope, source-authority identity and application-pinned root. Candidate assessment then cross-binds its verified measurement to Builder Provenance v2 and reports signature validity, source-root trust, freshness, process binding, artifact match, and overall candidate match separately. Readiness may consume that predicate only after all dimensions pass. `CURRENT_BINARY_IDENTITY` remains operator-supplied unverified metadata.

This ADR does not change the active `TLSN_CANARY_DEPLOYMENT_MANIFEST` contract or implement a new manifest field. It does not restore External Package v2. The human gameplay preflight remains a claim/report surface only and cannot authorize the source or turn operator evidence into independent verification.

## 6. G. AD-5 threat coverage model

The current implementation does not claim to defend the following threats for the APP process. Existing controls are listed at their actual scope; none is promoted into process-image authority.

| Threat | Required authority property | Potential evidence | Current repository coverage | Remaining gap |
| --- | --- | --- | --- | --- |
| Modified executable | Detect/reject a measured image that differs from the approved artifact. | Authenticated measurement of the image mapped by the target process plus verified Builder Provenance. | Updater signature covers an updater artifact only. | No process-bound image observation or Builder cross-binding. |
| Replaced executable | Bind the process to the exact installed object and reject replacement. | Installation identity plus stable process/object-to-image binding from an independent source. | Package/updater metadata identifies a release artifact. | No authenticated install instance or package-to-process chain. |
| Patched image | Detect post-install file/image modification before protected use. | Measurement profile covering mapped executable bytes/pages and policy for permitted code changes. | Distribution signing is scoped to release artifacts. | No current-image measurement, appraisal authority, or policy. |
| Process injection | Define and detect in-scope injected/modified executable code, not only on-disk changes. | Process measurement profile that states coverage for pages, modules, JIT, and injection. | No relevant APP-process authority. | No loaded-code measurement semantics or trusted observer. |
| Process substitution | Prove the process performing capture/gameplay is the authenticated target process. | Challenge-bound process-object identity tied to the capture/session scope. | Worker Runtime Attestation identifies a Worker; device proof identifies key possession. | Neither binds the FUSOU APP process to the protected capture/gameplay. |
| Helper substitution | Authenticate any helper and reject replacement or forged responses. | Independently rooted helper/service identity, protected key, authenticated IPC, and process-bound statement. | No helper exists. | No owner, root, privilege/IPC policy, lifecycle, or replacement detection. |
| Configuration substitution | Bind actual configuration consumed by the process to the approved expectation if this claim is required. | Separate independent measurement of the live configuration, bound to the assessed process/session. | Fingerprint contract hashes declared projections; signed approval is a separate domain. | Production pins are absent; no live-config observation is bound to this process. Image authenticity must not imply configuration authenticity. |
| PID reuse | Identify a non-reusable process instance and reject a replacement. | Stable OS process object plus supporting creation discriminator in an authenticated statement. | PID is diagnostic/operational only. | No process-object authority; PID alone is reusable. |
| Path replacement | Bind measurement to the mapped object rather than a mutable pathname. | Stable executable object identity plus proof that the same object is mapped in the target process. | `current_exe()` reports an informational path. | No object-to-mapping proof or authority. |
| TOCTOU | Preserve the measured process/object relation through protected capture/gameplay acceptance. | Retained process reference, use-time revalidation, challenge consumption, and invalidation on exit/change. | No process-image authorization gate exists. | No measurement-to-use continuity or atomic one-use decision. |
| Stale attestation | Require fresh evidence for this exact attempt. | Verifier-issued challenge, signed response, short validity, and atomic one-use state. | Worker Runtime Attestation has Worker-specific capture/manifest freshness checks. | Worker freshness does not establish APP freshness; no APP process challenge exists. |
| Cross-machine replay | Bind the evidence to the accepted machine/platform and target process when this threat is in scope. | Independently authenticated platform context plus challenge-bound process measurement. | No APP process attestation. | No accepted machine/platform root or process statement; machine identity alone would still not identify the process. |
| Cross-installation replay | Bind evidence to the installation instance under assessment. | Authenticated installation identity cross-bound to the running process object and artifact. | Candidate IDs and Builder claims identify candidate/release metadata. | No installation instance identity or installation-to-process chain. |
| Debug/test build promotion | Enforce production artifact policy and prove the running process is that artifact. | Trusted Builder policy/provenance plus independent current-process measurement and equality check. | Builder schema can state source/workflow/toolchain/builder identity. | Production Builder root is not pinned; no measurement binds claims to the APP process. |
| Old valid build replay | Enforce the accepted current artifact/version policy and fresh process evidence after restart. | Current policy decision, fresh challenge, process-instance binding, and Builder cross-binding. | v3 checks evidence validity separately from `issued_at`. | A valid old signature does not prove current execution; no process/install version binding or challenge exists. |

## 7. H. Human decision inputs (outside code)

The repository cannot choose or infer these accountable roles from a key ID, workflow, service name, or organization name. Humans must record the owner and accepted boundary before any implementation proposal:

| Required human input | Decision that must be recorded |
| --- | --- |
| Authority owner | Legal/accountable entity responsible for the truth and scope of current-process statements, including whether it is independent from Builder, Candidate, Configuration Approval, and APP development. |
| Authority operator | Team/personnel allowed to run measurement and issue statements; administrative boundary and shared IAM/cloud/CI controls. |
| Trust-root custodian | Who generates, protects, distributes, pins, and authorizes changes to the accepted Process Authority root; how bootstrap and recovery are trusted. |
| Signing-key custodian | Who controls key generation, storage/use, access review, rotation, emergency disablement, and evidence that the key was not exposed to the APP or Builder. |
| Verifier operator | Who operates the relying verifier, defines acceptance/fail-closed policy, issues challenges, and atomically consumes attempt/job state. |
| Revocation authority | Who may revoke a source/key/measurement policy, how the verifier learns current status, and what happens when status is unavailable. |
| Incident-response owner | Who investigates compromise, withdraws affected roots/evidence, communicates impact, and restores trust after recovery. |
| Accepted verifier root | Which independently authenticated root the relying verifier accepts, through what trusted bootstrap/pin path, and which entity is authorized to change that pin. |
| Independence and threat boundary | Whether shared organization/top-level administrators, Builder compromise, same-user attacks, administrator/root, kernel/firmware, or collusion are in scope and what separation is accepted. |
| Platform and protected-action scope | Which Windows/Linux/macOS versions and which capture/gameplay decisions require the claim; unsupported platforms must fail closed or be explicitly out of scope. |

No implementation may fill these values by inventing a repository owner, reusing an existing Builder/Worker/device root, or accepting operator JSON as authority.

## 8. I. AD-5 decision gate

Each item must be explicitly accepted by the accountable human owner and recorded in the architecture decision. Until then it is `OPEN`, AD-5 remains `NOT SELECTED`, and implementation is prohibited.

1. `OPEN` Accountable authority owner selected and scope of authority approved.
2. `OPEN` Process Authority root of trust selected, its custodian named, and its trusted bootstrap/pin path accepted.
3. `OPEN` Owner, technical, trust-root, and operational independence boundary accepted, including shared-organization and compromise assumptions.
4. `OPEN` Process measurement semantics selected, including mapped-image preimage, profile/version, injected/runtime code scope, and limitations.
5. `OPEN` Process-object and process-instance binding selected; PID/path-only evidence explicitly rejected.
6. `OPEN` Builder Provenance cross-binding semantics selected, with separate signature/root validation and defined digest/measurement relation.
7. `OPEN` Freshness, verifier-issued challenge, atomic consumption, replay rejection, expiry, and process restart/invalidation policy selected.
8. `OPEN` Authority lifecycle, signing-key custody, rotation, revocation/status, incident response, and recovery model selected.
9. `OPEN` Supported Windows/Linux/macOS scope, per-platform evidence requirements, and unsupported-platform behavior selected.
10. `OPEN` Relying-verifier operator, accepted root, acceptance/fail-closed policy, and protected capture/gameplay boundary selected.

Only when all ten items are formally resolved may a human update this record to `AD-5 = SELECTED`. That status records an architecture decision; it is not by itself approval to implement or enable gameplay. Implementation requires a separate scoped change and review after the decision. No current item is selected by this document.

## 9. Security gaps

Before selecting A, B, C, or a hybrid, the owner must resolve:

1. Who operates the source authority, who controls its signing credential, how it is generated/stored/rotated/revoked, and who responds to compromise.
2. Whether the source is independent of Builder, Candidate, and Configuration Approval in administrative control, signing custody, and verification path, not merely key ID or payload scope.
3. The in-scope attacker: same-user, other local user, administrator/root, kernel/firmware, malicious updater, or compromised builder. The required claims differ materially by boundary.
4. Exact per-OS measurement primitive, stable process/object handle, main-image byte definition, loaded-code mutation/injection scope, and how TOCTOU is prevented through the consuming decision.
5. Which relying verifier issues the challenge, how it binds candidate/process scope and expiry, how source signature verification works, and where one-use state is atomically consumed without assuming a new global nonce service.
6. How source-measured bytes map to the Builder Provenance v2 artifact digest/identity when the platform measurement representation differs from release bytes.
7. How the source root becomes an application pin through trusted release-controlled configuration rather than operator JSON; how pin rotation works without broadening scope.
8. Whether historical authorization/revocation is actually required. Current v3 registry semantics do not prove historical signer authorization; do not add a registry service unless a concrete requirement demands it.
9. How target OS coverage will be tested. Current workflow matrices do not exercise macOS, and Windows/Linux platform-specific policy cannot be inferred from Tauri's `targets: all` setting.

Until these are resolved, no candidate architecture is security-complete. A local helper may be independent from the APP process boundary while still not independent from a same-user or privileged attacker. A hardware quote may authenticate a platform measurement while still not identify the FUSOU process. The evidence must say exactly which of these claims it establishes.

## 10. Readiness

Required regression state remains:

| Gate/state | Required current result |
| --- | --- |
| `candidate_configuration_binding` | `UNVERIFIED` |
| `authenticated_current_binary` | `UNVERIFIED / NOT_IMPLEMENTED` |
| `candidate_readiness` | `BLOCKED` |
| `HUMAN_GAMEPLAY_GATE` | `BLOCKED` |
| `AD-5` | `unresolved / NOT_IMPLEMENTED` |
| `production_application_pins` | `NOT_CONFIGURED` |
| Active deployment contract | `TLSN_CANARY_DEPLOYMENT_MANIFEST` |
| Historical signer authorization | `NOT_PROVEN` under existing v3 semantics |
| `ACTIVE` / `VERIFY_ONLY` / `RETIRED` / `REVOKED` | Unchanged existing lifecycle semantics |
| Signed `issued_at` | Issuer-signed claim, not independent time attestation |
| `evidence_sha256` | Opaque commitment, unchanged |
| `network_access` | `NOT_USED` |
| `deployment` | `NOT_EXECUTED` |
| `gameplay` | `NOT_EXECUTED` |
| WASM CI Run #54 | Hosted Runner not acquired; steps not generated; WASM/security tests `NOT_RUN`; GitHub authentication unavailable, so no rerun |

No synthetic authority or fixture is accepted as production evidence. No `/health` result, updater signature, APP self-report, PID, or self-hash changes these states.
The Run #54 state is not a code/test failure. Historical local PASS results remain local-only and are not CI PASS results. No WASM workflow or Cargo configuration is changed by this ADR review.

## 11. Secret exposure

Previously observed credential-like output remains classified **`EXPOSURE_OBSERVED / VALUE_NOT_REPRODUCED / ROTATION_RECOMMENDED`**. No value is copied into this document, code, commit, or fixture.

The preceding redaction change fixes `error.name` and exception text in failure output, replaces non-null external consume errors with a generic message, and expands sensitive-key redaction for API/access key, authorization, bearer, and credential fields. `stage` and HTTP response status remain structured diagnostics. An exception-specific `error.code` field was not persisted before or after this change; therefore this change did not remove an existing structured code. If more diagnostics are needed, add an allowlisted stable code enum, never raw exception name/message or user-controlled code text.

## 12. Code changes and verification

This record changes no runtime security semantics and does not modify provenance v3 or readiness code. Failure-output redaction at `314089b13` is a separate implementation change; this ADR only records the authority boundary.

Verification record for the audit baseline `db7a29ef831f334534eb408f948fd50e1de73ee3` (measured before follow-up audit edits):

- `pnpm --dir packages/FUSOU-TLSN-VERIFICATION-WORKER exec node scripts/production-evidence-test.mjs`: passed.
- `pnpm --dir packages/FUSOU-TLSN-VERIFICATION-WORKER run test:candidate-configuration-binding`: 24 binding tests and 32 signature/lifecycle tests passed.
- Human gameplay preflight, canary readiness contract, and canary readiness report tests: passed; readiness stayed blocked.
- `CARGO_NET_OFFLINE=true cargo test --manifest-path packages/FUSOU-APP/src-tauri/Cargo.toml --lib --locked --offline`: 11 passed, 0 failed (8 existing compiler warnings).
- `node --check` on the directly relevant serializer, tests, candidate-binding/signature, preflight, and readiness JavaScript files: passed. Baseline `git diff --check`: passed on a clean worktree.
- Full APP `cargo test --manifest-path packages/FUSOU-APP/src-tauri/Cargo.toml --locked --offline` is blocked by the unrelated `tlsn_alpha15_key` example's undeclared `tlsn_attestation` and `bincode` dependencies; the requested library suite passed.
- Network access, release APIs, deployment, and gameplay were not executed.

These results identify the exact baseline tested; they do not claim that later audit edits were tested at this commit. Any implementation of the current-process authority remains prohibited until AD-5 is resolved. Future platform-specific validation must cover stale challenge, replay, PID reuse, process restart, file replacement between open/hash/exec, process-object mismatch, wrong builder artifact, wrong source root, and source/builder key-domain reuse.

### 2026-10-06 review record

- At review start, the worktree was clean at audit baseline `bc108e31ebb37167276cd68a530c973ad4b80c57`; this ADR was present in the tracked tree at `docs/architecture/current-app-process-image-authority.md`. Its last committed revision before this amendment was `31925cd8f91a85f31f69b844e1603d3b6ef80d76`.
- This amendment changes this ADR only. No process measurement, helper, hardware integration, readiness gate, production pin, workflow, Cargo configuration, deployment, or gameplay behavior was implemented or changed.
- `git diff --check` passed for the ADR amendment. Software tests were not run for this documentation-only audit.
- `network_access = NOT_USED`; `deployment = NOT_EXECUTED`; `gameplay = NOT_EXECUTED`.
- WASM CI Run #54 remains `NOT_RUN`: the hosted Runner was not acquired and no steps were generated. WASM/security tests remain `NOT_RUN`; GitHub authentication was unavailable, so no rerun was issued. Earlier local PASS results remain local-only and are not reported as CI PASS.

### 2026-10-07 initial human decision requirements review (superseded later the same day)

- At this initial review, the document formalized the AD-5 security objective, authority statement semantics, independence and key-domain separation, process identity, freshness, per-platform requirements, threat coverage, human decision inputs, and a ten-item decision gate. That decision framing is superseded by the same-day assurance-scope reclassification below.
- The only changed file is this ADR. Prior readiness and CI states are unchanged: `authenticated_current_binary = UNVERIFIED / NOT_IMPLEMENTED`; `candidate_readiness = BLOCKED`; `HUMAN_GAMEPLAY_GATE = BLOCKED`; `AD-5 = unresolved / NOT_IMPLEMENTED`; production application pins remain `NOT_CONFIGURED`; deployment and gameplay remain `NOT_EXECUTED`; network access remains `NOT_USED`; WASM Run #54 remains `NOT_RUN`.
- Validation for this review: Markdown diagnostics passed; `git diff --check` passed; worktree contains only this ADR amendment. No software tests were run for this documentation-only change.

### 2026-10-07 assurance-scope reclassification

- Current decision: `AD-5 = OUT_OF_SCOPE`; current APP process/image authenticity is `NOT_REQUIRED_FOR_COMMUNICATION_INTEGRITY_GOAL` and does not gate readiness. The earlier ten-item implementation gate is retained only as historical audit material.
- Readiness is not promoted by this change. The current offline readiness report remains `BLOCKED`; its first external dependency is `TARGET_IDENTITY` (approved Game Server identity and verifier key). P0-04 remains `PASS` per the existing Phase-0 ledger; P0-05 remains `BLOCKED` for production authenticated FUSOU Presentation/transcript, Notary, Verifier, Result, privacy, and runtime evidence.
- v3 signed evidence payloads, failure artifact v2/v3 semantics, TLSN Presentation/Notary semantics, Web PKI trust configuration, and WASM CI are unchanged. `CURRENT_BINARY_IDENTITY` is optional untrusted artifact metadata, not process evidence and not a readiness predicate.
- No TPM, Measured Boot, process attestation, helper, gameplay, Game Server probe, deployment, replay, injection, or external network action was performed.
- Final offline readiness report: `BLOCKED`; `network_access = NOT_USED`; `deployment_executed = false`. First external dependency is `TARGET_IDENTITY` with missing `TLSN_CANDIDATE_SERVER_IDENTITY` and `TLSN_CANDIDATE_VERIFIER_KEY_ID`. Candidate binding remains `BLOCKED` for its candidate bundle, approved configuration, trusted Builder, independent authority receipt, and authenticated deployment identity; neither `CURRENT_BINARY_IDENTITY` nor process-image authority is a missing input.
- Tests passed: `test:candidate-configuration-binding` (25 tests) and nested `test:candidate-configuration-signatures` (32 tests); `test:canary-readiness-contract`; `test:human-gameplay-preflight`.
- Markdown diagnostics passed for this ADR and the Cloudflare Verification Worker Trust Boundary document; `git diff --check` passed. README diagnostics report existing unrelated MD001/MD010 issues elsewhere in that long document.
- No game started, Game Server probe, request injection/replay, deployment, or external network action was performed.
