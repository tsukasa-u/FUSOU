# FUSOU Current APP Process Image Authority

Status: Architecture decision record, **AD-5: authority source and mechanism not yet selected**
Decision date: 2026-10-05
Review date: 2026-10-06
Scope: design only; no authority, trust root, runtime verifier, or readiness gate is implemented here.
Repository path: `docs/architecture/current-app-process-image-authority.md`
Audit baseline: `bc108e31ebb37167276cd68a530c973ad4b80c57` (`tlsn-phase0-investigation`)
Committed document revision at audit start: `31925cd8f91a85f31f69b844e1603d3b6ef80d76`

## Scope and immutable constraints

The provenance baseline is `1e548ce3c`. The earlier audit baseline was `db7a29ef831f334534eb408f948fd50e1de73ee3` (`Freeze TLSN failure artifact v2 contract`); this review rechecked the repository at `bc108e31ebb37167276cd68a530c973ad4b80c57`. The document was already tracked in that HEAD, with committed revision `31925cd8f91a85f31f69b844e1603d3b6ef80d76` before this uncommitted amendment. Failure-output redaction was introduced separately in `314089b13`; it does not change provenance semantics. The active external input remains `TLSN_CANARY_DEPLOYMENT_MANIFEST`. External Package v2 is historical and is not reactivated.

This record does not change provenance v3, convert `CURRENT_BINARY_IDENTITY` into authenticated evidence, configure application pins, or authorize gameplay. It does not treat `current_exe()`, a self-hash, PID, updater signature, Main Worker Runtime Attestation, `/health`, or operator JSON as current-process authority. It creates no fixture authority and proposes no TSA, global registry, historical registry, revocation service, or separate nonce registry. Any such service would require a separate trust-model justification.

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

### Independence and key-domain separation

For `CURRENT_PROCESS_IMAGE_SOURCE_AUTHORITY` to be independent of `BUILDER_AUTHORITY`, the process measurement must be produced by a separately controlled measurement boundary, with independently governed credentials, signing-key custody, lifecycle/incident response, and a root pinned by the relying application through a trusted configuration path. The source must not be able to rewrite or self-assert the builder receipt it compares against. The builder must not be able to mint the process-measurement statement merely because it created the binary.

If the builder signs “this is the current process,” no measurement independence remains: the builder can assert execution without observing it. A different key under the same builder-controlled root, account, workflow, or secret store gives cryptographic key separation but not independent control. Reusing the same signing key or application root across Builder, Candidate, Configuration Approval, and Process Image Source domains collapses those trust boundaries. Distinct signed scopes prevent signature transplantation; they do not make one operator independent from itself. The existing v3 key-reuse check is limited to registries co-evaluated in one assessment and makes no global uniqueness claim.

The required independence checks for the new source are separate:

- **From `BUILDER_AUTHORITY`:** the source measures a live process through a separately controlled platform/helper boundary; Builder cannot mint the measurement or alter the source's observation. Shared operator control, root, or signing custody fails this independence claim even if the keys differ.
- **From `CANDIDATE_AUTHORITY`:** candidate approval/receipt issuance must not let that authority self-assert process measurement. The process source needs separate owner, credential custody, root, and verification path; otherwise it is another candidate-authority claim, not an independent source.
- **From `CONFIGURATION_APPROVAL_AUTHORITY`:** approval of expected configuration must not authorize the source's measurement key or let the approver assert process identity. The source root and lifecycle must be separately governed and pinned for its own scope.

An application pin is mandatory: the relying application must receive the dedicated source root through trusted, release-controlled application configuration. A root bundled in source evidence or operator JSON is not a pin. Pin ownership, bootstrap, rotation, and compromise recovery remain UNRESOLVED.

## 3. Requirement matrix

### Security objective: three separate claims

| Layer | Security question | Existing evidence and current status |
| --- | --- | --- |
| Artifact authenticity | Is this an artifact authorized by the accepted Builder authority? | Builder Provenance v2 has signed fields for candidate/artifact identity, digest, source, workflow, toolchain, and builder. Signature and registry checks exist, but production application-pinned Builder roots are not configured. Status: build claims are representable and verifiable; production trust is not established. |
| Installation authenticity | Is the APP image currently installed on this device cryptographically bound to that approved artifact? | Tauri updater public key/signing and updater-manifest verification cover updater artifacts. No trusted install receipt or inspection binds installed package bytes to a Builder artifact. Windows certificate thumbprint and macOS signing identity are null. Status: NOT ESTABLISHED. |
| Current-process authenticity | Is the process currently performing capture/gameplay the process whose mapped image corresponds to the approved artifact? | No process-object authority, mapped-image measurement, process-to-image binding, or measurement-to-Builder cross-binding exists. `current_exe()` is informational path output; PID is not an authority. Status: `UNVERIFIED / NOT_IMPLEMENTED`. |

The AD-5 objective is the third row. Artifact authenticity does not imply installation authenticity, and neither implies current-process authenticity. Do not compose these claims by treating a Builder signature as a live measurement.

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

Minimum future challenge-response shape, still unimplemented:

1. A relying verifier other than the APP generates a cryptographically unpredictable challenge and binds it to verifier/source identity, candidate/capture scope, intended process request, and a short expiry.
2. The source measures through the same live process object it identifies and signs the challenge, process-instance identity, measurement profile/digest, builder-artifact reference, and creation time in one statement.
3. The relying verifier checks the pinned source key, exact challenge/scope, expiry, source signature, measurement profile, and builder cross-binding.
4. The verifier atomically marks that challenge consumed in the existing attempt/job state. No global nonce registry is specified. If the consuming workflow has no suitable atomic one-use state, replay resistance remains unresolved and the architecture remains blocked.

An APP-generated nonce is not a freshness authority: a compromised or substituted APP controls the request and cannot establish that a trusted source observed the current process. An APP nonce becomes useful only when an independently authenticated source measures the challenged process and signs the exact nonce, and the relying verifier owns the one-use decision.

### Process-instance binding

“The binary is trusted” is insufficient. The statement must mean “this exact measurement belongs to this process instance, observed for this assessment.”

| Candidate identifier/property | Design treatment |
| --- | --- |
| PID | Diagnostic selector only. PIDs are reused and can name a replacement process; never use alone as security identity. |
| Process creation/start time | Include as a supporting discriminator if supplied by the OS, but not as a unique cryptographic identity. |
| OS process handle/object identity | Preferred binding primitive for a local source: open/retain a handle with required access, inspect that referenced process, and reject if it exits or changes before completion. Exact rights/API remain platform-specific and unselected. |
| Executable object identity | Bind the process's mapped main executable to a stable file/object reference (file ID/inode plus volume/filesystem identity as applicable) while hashing/validating. A pathname is not an object identity. |
| Code-signing identity | Evidence about a signer/designated requirement is supplemental. It is not a digest of the current mapped image and is not enough by itself. |
| Kernel/platform measurement | Stronger only if the platform reports measurement for the same process/object and its trust chain/policy is independently validated. A machine boot measurement is not automatically an application measurement. |
| Process replacement/restart | Any exit, handle change, creation-identity change, or new process after measurement invalidates the evidence for “current process.” Reassess immediately at the consuming boundary. |
| Executable replacement | Hashing a path and later opening/executing it is TOCTOU-prone. Measure the object actually mapped, or prove stable object identity from mapping through measurement. |
| Same-user attacker | Must be explicitly in or out of scope. If in scope, ordinary user-level IPC and path checks are inadequate; the source needs OS-enforced isolation and anti-injection policy. |
| Privileged attacker | A local administrator/root/kernel compromise can generally subvert local observations. Excluding or detecting this requires a hardware/remote trust chain, not a stronger self-hash. |

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

## 6. AD-5 threat model

The current implementation does not claim to defend the following threats for the APP process. Existing controls are listed at their actual scope; none is promoted into process-image authority.

| Threat | Required security property | Current protection | Gap / missing authority |
| --- | --- | --- | --- |
| Modified executable | Detect and reject bytes or executable state that differ from the approved Builder artifact. | Updater signature can authenticate an updater artifact under its configured key. | No trusted observation of installed or mapped image bytes; no process measurement authority. |
| Replaced executable after installation | Bind the assessed process to the exact installed object and reject replacement. | Package/updater metadata identifies a release artifact. | No installation identity or stable object binding from package to live process. |
| Patched binary after installation | Detect post-install file/image modification before the protected action. | Distribution signing is scoped to release artifacts. | No current image measurement, OS policy appraisal, or independent source. |
| Process injection | Define and detect in-scope injected/modified executable code, not only on-disk file changes. | None in the AD-5 path. | No loaded-code measurement policy or authority; file identity alone would not cover injected code. |
| Runtime/process substitution | Prove the process performing capture/gameplay is the authenticated target process. | Worker Runtime Attestation and `/health` identify a Worker deployment; device proof identifies possession of a registered key. | Neither binds the FUSOU APP process that performs capture/gameplay. No process-object source exists. |
| Configuration substitution | Bind actual configuration consumed by the assessed process to the expected approved configuration. | APP configuration fingerprint contract defines hashes of declared projections; signed approval is a separate evidence domain. | Production approval pins are absent; no independent observation binds live process configuration to the process/image at the consuming decision. |
| Helper substitution | Authenticate any future helper and reject replacement/forged helper responses. | No helper exists. | No helper owner, independently provisioned helper root, IPC policy, service identity, or lifecycle. |
| Stale attestation replay | Require fresh evidence for the specific current assessment. | Canary Worker Runtime Attestation has its own capture/manifest freshness checks. | Those checks concern Worker deployment evidence, not APP process evidence; no APP process challenge exists. |
| Different-machine attestation replay | Bind evidence to the machine/platform and target process being assessed. | No APP process attestation is implemented. | No authenticated machine/attestation-key identity or challenge-bound process evidence. |
| Different-installation attestation replay | Bind evidence to the installation instance under assessment, not another installation of the same release. | Candidate artifact IDs and Builder claims identify candidate/release metadata. | No installation instance identity or authenticated installation-to-process chain. |
| TOCTOU between measurement and gameplay | Ensure the measured process/object remains the one used at the protected decision; invalidate on exit/change. | No process-image measurement or gameplay authorization gate exists. | No retained process reference, atomic challenge consumption at the relying decision, or revalidation/invalidation protocol. |
| PID reuse | Use a non-reusable process-object/creation identity and reject a replacement process. | PID is operational/diagnostic only. | PID is not unique or an authority; no process object or creation-identity verifier exists. |
| Path substitution | Bind measurement to the mapped executable object rather than a mutable pathname. | `current_exe()` reports a path for APP informational output. | No stable file/object identity or process mapping proof; a path is not an authority. |
| Debug/test build promotion | Accept only a Builder-authorized artifact under the intended production policy and prove that it is the running process. | Builder Provenance schema can state source/workflow/toolchain/builder identity. | Production Builder root is not application-pinned, and no process measurement connects those claims to the running APP. |
| Valid old build replay | Enforce the intended artifact/version policy and fresh evidence for the current process, including after restart. | v3 evidence validity is checked separately from signed `issued_at`; registry lifecycle is evaluated under its current-snapshot semantics. | No fresh current-process source, install/version binding, or process-instance challenge. A valid old signature does not prove current execution. |

## 7. Security gaps

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

## 8. Readiness

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

## 9. Secret exposure

Previously observed credential-like output remains classified **`EXPOSURE_OBSERVED / VALUE_NOT_REPRODUCED / ROTATION_RECOMMENDED`**. No value is copied into this document, code, commit, or fixture.

The preceding redaction change fixes `error.name` and exception text in failure output, replaces non-null external consume errors with a generic message, and expands sensitive-key redaction for API/access key, authorization, bearer, and credential fields. `stage` and HTTP response status remain structured diagnostics. An exception-specific `error.code` field was not persisted before or after this change; therefore this change did not remove an existing structured code. If more diagnostics are needed, add an allowlisted stable code enum, never raw exception name/message or user-controlled code text.

## 10. Code changes and verification

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
