# FUSOU Current APP Process Image Authority

Status: Architecture decision record, **AD-5: authority source and mechanism not yet selected**
Decision date: 2026-10-05
Scope: design only; no authority, trust root, runtime verifier, or readiness gate is implemented here.

## Scope and immutable constraints

The provenance baseline is `1e548ce3c`. The reviewed HEAD is `314089b13`; that later commit only hardens failure-output redaction and does not change provenance semantics. The active external input remains `TLSN_CANARY_DEPLOYMENT_MANIFEST`. External Package v2 is historical and is not reactivated.

This record does not change provenance v3, convert `CURRENT_BINARY_IDENTITY` into authenticated evidence, configure application pins, or authorize gameplay. It does not treat `current_exe()`, a self-hash, PID, updater signature, Main Worker Runtime Attestation, `/health`, or operator JSON as current-process authority. It creates no fixture authority and proposes no TSA, global registry, historical registry, revocation service, or separate nonce registry. Any such service would require a separate trust-model justification.

## 1. Architecture decision

### AD-5

Keep `AUTHENTICATED_CURRENT_BINARY_IDENTITY_SOURCE` as an external prerequisite. The authority owner, trust root, threat boundary, measurement semantics, and process-instance protocol are not sufficiently determined to select a security-complete architecture.

The repository has a frozen v3 contract that describes the required boundary but no implementation that satisfies it. Tauri release signing/updater configuration covers distribution artifacts, not the running process. OS/platform primitives may be ingredients, but none has been selected, configured, and verified as an independent source across FUSOU's intended targets. A privileged helper or hardware-backed quote alone would also leave unresolved trust and process-binding questions.

This is not “blocked because code is missing.” It is blocked because the source authority boundary and its trustable evidence are not yet specified. No readiness advancement follows from this decision.

### Models considered

| Model | Potential source | What it could contribute | Unresolved before it can be selected |
|---|---|---|---|
| A: OS/platform measurement authority | OS code-integrity subsystem, kernel process-code identity, measured executable object, or hardware-backed platform measurement | A platform-bound observation of a process or executable object, if the selected OS API and policy actually expose the required measurement | FUSOU has no selected API, policy, application pin, signed source statement, or evidence of current-process binding. Code-signing a file does not by itself prove that the measured bytes are those mapped in the process being assessed. Kernel/admin compromise and same-user process manipulation need an explicit threat decision. |
| B: privileged local verifier | A FUSOU-owned helper/service in a distinct privilege and IPC boundary | It could hold a process handle, inspect the executable object, measure it, and bind the result to a live process instance | No helper exists. Its binary and service identity need an independently provisioned trust path; the APP must not be able to forge its output. Service privilege, IPC authorization, user-level attacks, local privilege escalation, service replacement, restart races, and helper provenance are unresolved. A helper controlled by the same user or release key is not automatically independent. |
| C: remote/hardware-backed attestation | TPM/platform quote plus a separately verified measurement chain | A hardware-protected key can authenticate a quote over selected platform measurements and a verifier challenge | A quote does not automatically measure the FUSOU process. PCR/event-log interpretation, firmware and boot roots, OS/runtime measurement, verifier identity, target-process binding, challenge use, and the trust owner of the attestation key all need to be defined. No such end-to-end FUSOU source exists. |
| D: distribution signing only | Tauri updater, release artifact signature, installer/package signature | Distribution artifact integrity and signer identity according to the relevant signature policy | **Classification: `B: DISTRIBUTION_ARTIFACT_INTEGRITY_ONLY`.** It does not authenticate the currently running process image, process instance, freshness, or absence of post-install substitution. It is not a candidate for closing this prerequisite. |

For Model C, keep these claims separate and verify each link: firmware/platform trust -> measured boot/PCR values -> event-log replay and appraisal -> quote signature and hardware-backed attestation-key identity -> relying-verifier identity and policy -> verifier/authority challenge nonce -> OS/runtime measurement -> exact target-process and APP-image binding -> Builder Provenance cross-binding. A valid quote can authenticate only the values covered by that quote under its key and nonce. It does not imply the later OS/runtime, process-image, or builder links.

## 2. Trust model

Repository evidence identifies cryptographic roles and interfaces more clearly than it identifies accountable human/organizational owners or key custody. “Owner unresolved” below is intentional: a role name, deployment variable, or signer key ID is not proof of independent ownership. Root means the trust anchor actually accepted by the relying verifier, not a key carried by the evidence itself.

| Subject | Subject owner / credential | Trust root and scope | What it proves | What it does not prove |
|---|---|---|---|---|
| `MAIN_WORKER_RUNTIME` | FUSOU Worker deployment operator; operational key custody/independent owner is not established by this record. Runtime-attestation signing identity is a distinct role. | Active canary deployment/runtime-attestation inputs; production application pins for candidate provenance are not configured. Scope is Main Worker runtime identity. | A valid, fresh runtime attestation may identify the configured Main Worker runtime under its own contract. | APP binary, Dedicated Verifier, Trigger, Notary, Auth, DO/R2, or gameplay identity. `/health` alone is not authority. |
| `DEDICATED_VERIFIER` | Dedicated Verifier deployment operator; organizational/control-plane separation from Main Worker is not established here. | Its deployment identity and verifier key material under the active canary manifest; exact independent root/owner remains to be evidenced. | The verifier deployment identity within its own verifier contract. | Main Worker identity, APP binary, or that the verifier actually executed a particular attempt. |
| `VERIFIER_EXECUTION` | Verifier execution-receipt signer/operator; distinct receipt key role. | Verifier execution receipt trust inputs in the active manifest. The receipt is detached and scoped to the execution/result bytes it names. | A signed execution receipt over its stated attempt and byte digests, after its verifier validates the receipt. | APP image identity; callback transport HMAC is not authorization for Result fields; receipt claims are not broader than signed fields. |
| `RESULT_SIGNER` | FUSOU TLSN Worker Result-signing operator/key custodian; key material is deployment-scoped. | Result signer registry/envelope and the relevant application/deployment trust input. Production candidate application pins remain unconfigured. | Signature over the exact serialized Result bytes and fields in its signature domain. | That the signing key ran in a particular APP process, that the APP binary is authentic, or that a Result's claims are independently true beyond its verifier contract. |
| `APP_BINARY` | FUSOU release/build pipeline and package publisher; independent source owner is not defined. Tauri updater verification key is distribution trust only. | Updater/release signing configuration. Windows `certificateThumbprint` and macOS `signingIdentity` are `null`. | At most, integrity/authenticity of a signed distribution artifact under the updater/package policy. | Current process image, mapped code, process instance, runtime configuration, or post-install integrity. |
| `APP_CONFIGURATION` | FUSOU APP configuration producer; expected-configuration approval is a separate authority role with no production application pin configured. | `app-configuration-fingerprint-contract-v2` defines the compile/runtime projection and hash format. The approval root is not configured for production readiness. | Deterministic hashes of the declared public configuration projections; a separately authorized approval may approve an expected fingerprint. | The values currently loaded by a particular process, binary identity, or approval authority identity absent a trusted signature/root. |
| `BUILDER_AUTHORITY` | FUSOU build workflow/operator is the apparent subject; separate legal/operator ownership and signing-key custody are not established by repository configuration. | Signed Builder Provenance v2 and a separately application-pinned builder root; production pins are not configured. | Signed claims for `candidate_artifact_id`, `artifact_identity`, `binary_sha256`, `source_commit`, `build_workflow_identity`, `toolchain_identity`, and `builder_identity`. | Installation or execution of that artifact; current process image; independent measurement by an OS/helper. |
| `CANDIDATE_AUTHORITY` | Independent candidate authority owner is external and not named/configured. | `INDEPENDENT_AUTHORITY_RECEIPT` registry/root is not production-pinned. | Only the candidate/configuration/deployment/capture claims it signs, if its root and signer are trusted. | Current process measurement unless explicitly and independently measured; builder truth; any field outside the signed scope. |
| `CONFIGURATION_APPROVAL_AUTHORITY` | Configuration approver/owner is not established by repository state. | `APPROVED_EXPECTED_CONFIGURATION_FINGERPRINT` registry/root is not production-pinned. | Approval of the signed expected APP configuration fingerprint and candidate fields in its v2 payload. | Actual runtime configuration or current APP binary. |
| `NOTARY` | FUSOU-NOTARY service/deployment operator; independent organizational ownership is not established here. | Notary verification key/registry and candidate/deployment configuration. Test material is not production authority. | Notary signatures and claims within the TLSN Notary protocol and verifier's trust configuration. | APP image identity, Worker/Verifier runtime identity, or game-server identity. |
| `WEB_PKI` | Web PKI certificate authorities and platform/browser trust-store operators. | The trust store and TLS validation policy used by the specific verifier/client. | The authenticated TLS server name/channel under that policy. | FUSOU APP process identity, release builder identity, Worker runtime identity, or freshness of an APP measurement. |
| `AUTH_DEVICE_AUTHORITY` | FUSOU-WEB device-proof service and its device ownership/revocation data; device private-key custody belongs to the device. | FUSOU-WEB server-side owner/revocation checks plus the registered device public key and protocol-specific challenge validation. | A device-key proof and server-side ownership/revocation result within the Auth contract. | APP binary authenticity, device OS integrity, or proof that the signing process is the genuine FUSOU APP. |
| `CURRENT_PROCESS_IMAGE_SOURCE_AUTHORITY` | **Unselected external owner and credential.** It must be distinct from APP self-report and independently accountable. | Future dedicated application-pinned source-authority root and narrowly scoped process-image evidence. No production pin exists. | Must authenticate a fresh measurement of the exact process instance and bind it to a trusted builder artifact. | Anything not measured or signed in its explicit scope; it must not inherit authority from `/health`, operator JSON, updater signatures, or builder provenance alone. |

### Independence and key-domain separation

For `CURRENT_PROCESS_IMAGE_SOURCE_AUTHORITY` to be independent of `BUILDER_AUTHORITY`, the process measurement must be produced by a separately controlled measurement boundary, with independently governed credentials, signing-key custody, lifecycle/incident response, and a root pinned by the relying application through a trusted configuration path. The source must not be able to rewrite or self-assert the builder receipt it compares against. The builder must not be able to mint the process-measurement statement merely because it created the binary.

If the builder signs “this is the current process,” no measurement independence remains: the builder can assert execution without observing it. A different key under the same builder-controlled root, account, workflow, or secret store gives cryptographic key separation but not independent control. Reusing the same signing key or application root across Builder, Candidate, Configuration Approval, and Process Image Source domains collapses those trust boundaries. Distinct signed scopes prevent signature transplantation; they do not make one operator independent from itself. The existing v3 key-reuse check is limited to registries co-evaluated in one assessment and makes no global uniqueness claim.

## 3. Requirement matrix

Every row is required by the source prerequisite. `UNRESOLVED` means the property has neither a selected source nor a selected verification point in the current repository. The verification point shown is a design boundary, not implemented behavior.

| Property | Required | Candidate source | Verification point | Current status |
|---|---:|---|---|---|
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
| Revocation/status | AS NEEDED | Authority status channel/registry under a declared availability and freshness policy | Source verifier evaluates revocation/status at validation time and fails closed according to policy | UNRESOLVED; no service proposed |
| Historical verification | AS NEEDED | Authenticated versioned status/registry chronology only if a retrospective claim is required | Historical verifier proves signer authorization at the relevant time, not just signature validity | NOT REQUIRED for current-process readiness; v3 does not provide it |

### Freshness semantics

These time/challenge concepts are not interchangeable:

| Signal | Meaning | Limitation |
|---|---|---|
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
|---|---|
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

Do not add current-process identity fields to their signed payloads or change their existing `issued_at`, validity-window, signer lifecycle, pin, or opaque-commitment semantics. Do not route the new source through the existing Builder signature verifier.

If a source is selected in a future change, the safest integration is a separate predicate named `AUTHENTICATED_CURRENT_BINARY_IDENTITY_SOURCE`, with its own evidence verifier, signed scope, source-authority identity and application-pinned root. Candidate assessment then cross-binds its verified measurement to Builder Provenance v2 and reports signature validity, source-root trust, freshness, process binding, artifact match, and overall candidate match separately. Readiness may consume that predicate only after all dimensions pass. `CURRENT_BINARY_IDENTITY` remains operator-supplied unverified metadata.

This ADR does not change the active `TLSN_CANARY_DEPLOYMENT_MANIFEST` contract or implement a new manifest field. It does not restore External Package v2. The human gameplay preflight remains a claim/report surface only and cannot authorize the source or turn operator evidence into independent verification.

## 6. Security gaps

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

## 7. Readiness

Required regression state remains:

| Gate/state | Required current result |
|---|---|
| `candidate_configuration_binding` | `UNVERIFIED` |
| `authenticated_current_binary` | `UNVERIFIED` / `NOT_IMPLEMENTED` |
| Candidate readiness | `BLOCKED` |
| `HUMAN_GAMEPLAY_GATE` | `BLOCKED` |
| Production application pins | `NOT_CONFIGURED` |
| Active deployment contract | `TLSN_CANARY_DEPLOYMENT_MANIFEST` |
| Historical signer authorization | `NOT_PROVEN` under existing v3 semantics |
| `ACTIVE` / `VERIFY_ONLY` / `RETIRED` / `REVOKED` | Unchanged existing lifecycle semantics |
| Signed `issued_at` | Issuer-signed claim, not independent time attestation |
| `evidence_sha256` | Opaque commitment, unchanged |
| Network / deployment / gameplay | `NOT_USED` / `NOT_EXECUTED` / `NOT_EXECUTED` |

No synthetic authority or fixture is accepted as production evidence. No `/health` result, updater signature, APP self-report, PID, or self-hash changes these states.

## 8. Secret exposure

Previously observed credential-like output remains classified **`EXPOSURE_OBSERVED / VALUE_NOT_REPRODUCED / ROTATION_RECOMMENDED`**. No value is copied into this document, code, commit, or fixture.

The preceding redaction change fixes `error.name` and exception text in failure output, replaces non-null external consume errors with a generic message, and expands sensitive-key redaction for API/access key, authorization, bearer, and credential fields. `stage` and HTTP response status remain structured diagnostics. An exception-specific `error.code` field was not persisted before or after this change; therefore this change did not remove an existing structured code. If more diagnostics are needed, add an allowlisted stable code enum, never raw exception name/message or user-controlled code text.

## 9. Code changes and verification

This record changes no runtime security semantics and does not modify provenance v3 or readiness code. The accompanying redaction commit is `314089b13`; it is separate from this architecture decision and changes failure-output handling/tests only.

Verification record for the implementation baseline:

- Candidate configuration binding: 24 passed; signature/lifecycle: 32 passed.
- Production evidence and human gameplay preflight tests: passed.
- Canary readiness contract and readiness report tests: passed; readiness stayed blocked.
- Modified JavaScript syntax, Tauri config JSON parse, updater shell syntax, and `git diff --check`: passed.
- `CARGO_NET_OFFLINE=true cargo test --lib --locked --offline`: 11 passed.
- Full APP `cargo test --locked --offline` is blocked by the unrelated `tlsn_alpha15_key` example's undeclared `tlsn_attestation` and `bincode` dependencies. This is not evidence for or against this architecture.
- A previously observed finalizer suite result was 27/28 because a synthetic alpha.15 Presentation failed certificate-path validation against supplied anchors. Do not weaken Web PKI/trust-anchor validation to make that fixture pass; it was not rerun for this design-only change.
- Network, release APIs, deployment, and gameplay were not executed.

Before implementation is proposed, repeat the tests against the then-current worktree and add platform-specific negative tests for stale challenge, replay, PID reuse, process restart, file replacement between open/hash/exec, process-object mismatch, wrong builder artifact, wrong source root, and source/builder key-domain reuse.