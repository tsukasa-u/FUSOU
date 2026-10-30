# First real APP TLSN testplay: current readiness boundary

## Scope and evidence

Overall: **PARTIAL**. Actual APP GNU checking and selected local contracts pass;
real gameplay, real TLSN evidence acquisition and independent verification are
**NOT EXECUTED**. This document is a source/validation record, not permission
to launch the APP, contact services, publish or deploy.

The current implementation follow-ups are:

* `929bbf58350b9641e6c1589235c3e854f5e8cd18`: bounded exchange ownership.
* `7ea2ba9d026c9b74d5ea8b30e8d471b29f651dee`: current-exchange Result admission.

They follow baseline `f8965eaf4d83fe67123c5ace6bb88b53cf3bf92c`
on `tlsn-first-testplay-candidate`. Earlier native, corpus and hosted-run
results are historical; they were not rerun or promoted here.

Linux native-launch/cgroup/quarantine mechanisms are not dependencies of the
actual APP normal/build closure. No privileged helper, process/image authority,
TPM or Browser-integrity gate is added. The local TLSN fork's compatibility,
security and license decisions remain separate, not implicitly approved.

## Readiness map, not a new authorization framework

These labels describe the existing
[pre-capture report](../FUSOU-APP/scripts/testplay-pre-capture-readiness.mjs)
and runtime gates. They do not replace them or create a release policy.

| Stage | Current status | Owner / completion evidence | Refusal / next action |
|---|---|---|---|
| CODE_READY | PARTIAL | APP transport and Result acceptance paths exist and have selected local regressions. Real-service integration and finalized evidence delivery are not established. | Do not call candidate files a finalized Evidence Bundle. |
| LOCAL_BUILD_READY | VERIFIED, GNU check only | Actual APP `tlsn-production`, its own manifest/lock and library/binary targets checked. | Not a GUI launch, release package, clean candidate handoff or live-bootstrap test. |
| CONFIG_READY | BLOCKED_EXTERNAL_INPUTS | Trust/release operator supplies approved embedded bootstrap and fresh signed manifest/artifacts; APP independently verifies them. | Missing/expired/mismatched/unregistered inputs reject; no fixture or stale-manifest fallback. |
| TARGET_APPROVAL_READY | BLOCKED_EXTERNAL_INPUTS | Deployment operator supplies the actual canonical hostname, reviewed Inventory and Approval bound by the manifest. | No real target/approval was admitted in this task. Candidate selection is not observed identity. |
| SERVICE_CONNECTIVITY_READY | NOT_CHECKED | Operators confirm intended Worker, Session Authority, device-auth, Notary and storage contracts/version. | Local mocks/health JSON are not execution or deployment proof. |
| CAPTURE_READY | BLOCKED | Existing runtime gates plus explicit human approval and the three local limits below must pass. | No real capture command was run; no gameplay permission follows from a local report. |
| EVIDENCE_DELIVERY_READY | UNVERIFIED / POST_CAPTURE_REQUIRED | Storage/evidence operator retrieves exact artifacts and produces the verifier's required bundle. | APP export alone does not establish archive retrieval or finalization. |
| INDEPENDENT_VERIFICATION_READY | IMPLEMENTED source; real run UNVERIFIED | Independent verifier uses externally pinned roots/registries and real artifacts. | No actual evidence verifier/attestation command was executed. |
| HUMAN_TESTPLAY_REQUIRED | NOT_EXECUTED | Human release/protocol authority approves exact scope/profile, operator, stop conditions and evidence review. | Unresolved fork/P0-10 decisions are not waived by this document. |

The report deliberately keeps `gameplay_authorized=false`,
`target_identity=NOT_YET_OBSERVED`, service connectivity `NOT_CHECKED`,
post-capture delivery/verification pending, and Production acceptance `BLOCKED`.
`target_approval: POST_CAPTURE_REQUIRED` refers to evidence of the observed
identity match, not permission to skip pre-capture runtime Target Approval.

## Actual APP build and ownership contract

The GNU metadata normal/build closure contains 901 packages, enables proxy
`alpha15-tlsn` and `tokio-util/rt`, and contains no native-launch crate.
APP lock versions include `time=0.3.55`, `time-core=0.1.9`,
`time-macros=0.2.32`, `tokio-util=0.7.20`. APP, proxy and verifier lockfiles
are unchanged. Standalone proxy success is not substituted for APP checking.

The operator must explicitly choose all three values; there are no defaults:

| Input | Meaning |
|---|---|
| `FUSOU_TLSN_EXCHANGE_TIMEOUT_MS` | One absolute, monotonic deadline from typed request selection through session binding, capture, proof, Worker verification and Result delivery. |
| `FUSOU_TLSN_CLEANUP_TIMEOUT_MS` | Separate maximum wait for tracked local completion after success/failure/stop. |
| `FUSOU_TLSN_MAX_NOTARY_ATTESTATION_BYTES` | Bounded Notary read with a one-byte oversize sentinel before deserialization. |

All must be canonical positive integers within native timer/buffer ranges.
Fixture numbers are not recommended settings, independent resource policy or
a shared budget issuer. The launcher forwards only the explicit allowlisted
variables. Both runtime construction and active Production preflight require
the limits; disabled TLSN does not acquire a new active requirement.

| Work | Owner and completion behavior |
|---|---|
| TLSN driver and prover | Shared actual spawn helper returns abort-on-drop handles; normal code awaits their results; the exchange tracker observes registered task exit. Error/drop requests abort rather than detaching owners. |
| MPC worker entry-points | Local `Session::new_with_worker_spawn` uses tracked blocking work. Executor shutdown requests stop; the tracker observes entry-point return, not destruction of Tokio's pooled OS threads. |
| Post-browser proof continuation | Forwarder retains an abort-on-drop task owner. It shares the same exchange context/deadline and cannot reopen a consumed forwarder. |
| Admitted artifact export and Result persistence | Tracked local IO retains its completion owner if the awaiting caller is cancelled. Already-admitted IO can drain; new work cannot start after observed stop. |
| Worker request/poll | Covered by the same outer absolute deadline plus existing HTTP/poll limits. A server job already submitted may continue remotely. |

The first **observed** cancel/deadline reason is immutable. A result finishing
after the deadline is rejected even if synchronous work delayed timer polling.
Success requires Result delivery, tracked cleanup and a final stop/deadline
check before `ResultReady`. Cleanup timeout yields `CleanupUnconfirmed`, not
success or reuse. Cancel/final success serialize on the same state lock.

Send intent is consumed before transport IO and again before prover write/
flush. Ambiguous writes, proof failures and late cancellation never retry or
fall back. Preparation failure may send zero requests; normal success tests
observe one send, not a universal exactly-once delivery promise.

Abort is cooperative: CPU/OS calls are not forcibly preempted; drop cannot
synchronously await all cleanup. Authentication/filesystem dependencies and
remote jobs are not certified as all-FD/all-thread terminated. Browser response
precedes proof by design and is not `ResultReady`. No process attestation follows.

## Runtime Config and Target Approval

The release bootstrap is the separately approved public tuple:

* `FUSOU_TLSN_RUNTIME_CONFIG_MANIFEST_URL`
* `FUSOU_TLSN_RUNTIME_CONFIG_SIGNER_KEY_ID`
* `FUSOU_TLSN_RUNTIME_CONFIG_SIGNER_PUBLIC_KEY_SPKI`

These are embedded release inputs, not arbitrary runtime environment authority.
`from_embedded` can accept a complete valid tuple; registration is not an
unconditional hardcoded APP refusal. However, the repository's
[Production signing registration](../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-production-registration.mjs)
still reports signer provider NOT_CONFIGURED, independent signer pin/APP
root/manifest endpoint NOT_REGISTERED and publication disabled. No fake pin
or registration was added.

The v2 signed manifest binds the 15 Worker inputs, source/version/deployment
reference, authority/security artifacts and signed Result registry/root.
The APP independently fetches digest-addressed raw artifacts, verifies hashes,
signature/freshness, target subset and registry authorization, then persists
verified epoch/digest state to reject rollback and same-epoch equivocation.
Local time/state do not become trusted time or adversary-resistant storage.
Binding and Origin wrappers revalidate freshness and expected manifest hash
before their underlying calls.

Inventory contains 20 ordered canonical DNS targets on port 443. Approval is
the current schema-1, production, APPROVED, FUSOU_DEPLOYMENT_OPERATOR artifact:
it binds the exact inventory digest, approval timestamp and nonempty ordered
subset, rejecting fixture identities. Do not invent a separate detached
Approval signature or expiry field: its raw-byte authority binding comes from
the signed manifest/security set. Actual approved artifacts were not fetched.

The selected route must already be approved before capture. The actual
identity still comes from Web PKI/TLSN Presentation verification and is matched
against Inventory/Approval. URLs, ports, IPs, wildcards, certificate fingerprints
and custom CA roots are not Production target identities.

## APP to services: source exists, execution not checked

| Boundary | Current source and contract | Real condition still required |
|---|---|---|
| APP to Notary | [Real transport](../FUSOU-PROXY/proxy-https/src/real_tlsn.rs) connects to configured host/port, runs the TLSN Session/MPC, sends the bincode Attestation request, bounds the returned bytes and validates the response before Presentation construction. | Approved compatible Notary service/key, protocol/runtime compatibility, reachability and real evidence. No Notary service was contacted. |
| APP to Session Authority | [Worker](../FUSOU-TLSN-VERIFICATION-WORKER/src/index.ts) has `/attestation/session`: bearer/device authentication, canonical-user/device-owner equality, binding issue and signed Session receipt. APP verifies the receipt and uses the binding/device challenge. | Intended deployment, authority registry/root, authenticated user and registered non-revoked device. |
| External device authentication | Worker forwards bearer and device nonce/signature to configured `deviceAuthUrl` with redirects rejected, then validates returned user/device and propagates replay/revocation/ownership failures. Production configuration uses `TLSN_CANDIDATE_DEVICE_AUTH_URL`. | Matching endpoint implementation, operator and live contract remain UNKNOWN in the bounded current source trace. WEB refresh/revoke and `user_devices` code are not substitutes for that handler. |
| APP to verification Worker | `/verify/tlsn`, sparse/status/retry handlers and job state exist. APP posts exact Presentation/session/device proof and polls async jobs. | Actual active version/deployment, approved Result/Notary registries and WASM provenance, connectivity and live failure behavior. |
| Result generation/archive | Worker derives observed identity from Presentation, matches approval/profile, prepares/signs inner Result, serializes outer response once and binds execution receipt to exact bytes. [Archive code](../FUSOU-TLSN-VERIFICATION-WORKER/src/result_archive.ts) performs length/hash/readback checks before authority commit and reports cleanup failures. | Actual storage bindings/permissions, exact readback/retrieval, service execution and retention. Source is not evidence that these ran. |

Unsigned health/configuration observations cannot prove the running source or
remote process image. Approved references/public pins and external deployment
evidence remain distinct. No credential, device key, actual endpoint secret or
registered evidence was read/created by this work.

## Result, candidate export and independent evidence

The real backend checks signature/registry and strict Complete v2 or Sparse v3
before admission. The shared acceptance/cache function then requires exact
Presentation hash, approved expected DNS identity, current session/binding/
nonce, user/device/challenge and captured transcript sizes. Complete checks
both captured full hashes; Sparse does not invent full transcript hashes.
Both Production authority digests must match the verified manifest. Generic
null-authority fixtures cannot accept non-null Production Results. Mismatch
rejects before cache insertion or `VerifiedTlsnEvidence`; duplicate insertion
cannot replace an unconsumed operation. Signing domains/bytes are unchanged.

The candidate sink writes raw Presentation and unverified metadata into private
create-only output. The remote Result signer preserves `result-exact.bin`,
inner pretty Result, receipt bytes/header, session/consume/device/replay material
and inventory; filesystem Result delivery is a separate JSON output. Pretty
JSON is not the authoritative exact response-byte source. These files remain
unapproved candidates, not an automatically finalized Evidence Bundle.

The current APP/Worker script entry inventory and bounded collector/finalizer
trace did not establish an operational finalization handoff. Contract helpers
are not a collector. The evidence/storage owner must identify and review that
handoff and its exact artifact/receipt inventory; automatic finalized bundle
delivery remains UNVERIFIED. Do not synthesize missing receipts, roots or
Production signer authority from candidate fields.

The [offline CLI](src/bin/verify_fusou_tlsn_evidence.rs) still supports legacy
path arguments or explicit `--path-mode`. Its external inputs include bundle,
evidence signer root, Notary/Session/Binding registries and authority roots,
canonical user/device/public key, server identity, Inventory/Approval, profile
digests, verifier key ID and Web PKI trust-anchor DER. Trust-anchor material is
not target identity or permission to substitute a synthetic/custom CA.
The formal `--fd-abi-v1` registration gate remains closed; it is not a
prerequisite for the existing path-mode testplay verification route.

[Evidence verification](src/evidence_bundle.rs) checks artifact path/length/
hash, externally supplied registry/root equality, signatures/receipts, actual
Presentation semantics and observed target, mandatory Production authority
pair, exact Presentation binding and independently transcript-derived Result
contents, plus session/device/consume/replay. This independent derivation is
not replaced by the APP signature/context check. Real evidence acquisition,
archive retrieval and this verifier run are all **NOT EXECUTED**.

## Current local validation

All Cargo commands used the actual checked-in manifests/locks with
`--locked --offline --target x86_64-unknown-linux-gnu`, Rust 1.98.1, a sanitized
environment/private HOME/CARGO_HOME/TMPDIR and separate APP/proxy targets.
Existing dependency caches were used without downloads; the MPZ checkout was
privately copied because its build script writes generated source data.

| Check | Result | Scope |
|---|---|---|
| APP `check --package app --features tlsn-production --lib --bins --jobs 2` | PASS, exit 0 | Actual APP graph; not standalone proxy substitution, release packaging or execution. |
| Proxy selected lifecycle/experimental/task/production/Result tests | 67 PASS, 0 failed/ignored, exit 0 | Lifecycle 7, experimental 15, production 22, real task 10, Result binding 8, signature/registry 5. Synthetic async/IO, actual shared spawn/accept helpers and local Session executor lifecycle without TLSN protocol execution. |
| APP selected preflight/manifest/manager/transport-guard tests | 55 PASS, 0 failed, 1 pre-existing ignored, exit 0 | Preflight 24 plus one ignored, manifest 19, manager 5, transport guard 7. Local/fake contracts and actual APP library test compilation; external roundtrip deliberately not invoked. No new skip was added. |
| Node pre-capture/temporary-file launcher tests | 34 PASS, 0 failed/skipped, exit 0 | Synthetic report/environment and safe temporary-file tests; not actual APP launcher CLI. |
| Four changed JavaScript files, `node --check` | PASS, exit 0 | Source and test files. |
| Exact changed Rust modules, `rustfmt --check` | PASS with their own editions | APP/proxy edition 2021; local TLSN Session edition 2024. Stable rustfmt reports unsupported upstream nightly-option warnings. |
| Ordinary proxy, no defaults plus `kc-api-epoch-20250627` | PASS, exit 0 | Non-TLSN feature behavior retained. |
| Scoped whitespace, reviewed/staged/committed comparisons and normal hook | PASS for the two implementation commits above | Static hook test-gap candidates are not coverage completeness or runtime evidence. |

Recorded invocations below use `ROOT` for the repository root and `GATE` for
the isolated local validation directory. The retained `run-cargo.sh` invokes
Cargo in the sanitized environment described above; these are not instructions
to run the real APP. Reconstruct the approved offline cache/runner before
repeating them.

```sh
sh "$GATE/run-cargo.sh" check --manifest-path "$ROOT/packages/FUSOU-APP/src-tauri/Cargo.toml" --package app --features tlsn-production --locked --offline --target x86_64-unknown-linux-gnu --lib --bins --jobs 2
sh "$GATE/run-cargo.sh" test --manifest-path "$ROOT/packages/FUSOU-PROXY/proxy-https/Cargo.toml" --features alpha15-tlsn --locked --offline --target x86_64-unknown-linux-gnu --target-dir "$GATE/target-proxy" --lib --jobs 2 -- exchange_lifecycle::tests experimental_tlsn::tests real_tlsn::task_tests production_tlsn::tests real_tlsn::tests::result_binding_tests real_tlsn::tests::result_signature_verifier
sh "$GATE/run-cargo.sh" test --manifest-path "$ROOT/packages/FUSOU-APP/src-tauri/Cargo.toml" --package app --features tlsn-production --locked --offline --target x86_64-unknown-linux-gnu --lib --jobs 2 -- tlsn_preflight::tests tlsn_runtime_config_manifest::tests tlsn_runtime_config_runtime::tests wrap_proxy::runtime_config_transport_gate_tests
sh "$GATE/run-cargo.sh" check --manifest-path "$ROOT/packages/FUSOU-PROXY/proxy-https/Cargo.toml" --no-default-features --features kc-api-epoch-20250627 --locked --offline --target x86_64-unknown-linux-gnu --target-dir "$GATE/target-proxy" --lib --jobs 2
sh "$GATE/run-cargo.sh" metadata --manifest-path "$ROOT/packages/FUSOU-APP/src-tauri/Cargo.toml" --features tlsn-production --locked --offline --filter-platform x86_64-unknown-linux-gnu --format-version 1
node --test "$ROOT/packages/FUSOU-APP/scripts/testplay-pre-capture-readiness.test.mjs" "$ROOT/packages/FUSOU-APP/scripts/testplay-verify.test.mjs"
node --check "$ROOT/packages/FUSOU-APP/scripts/testplay-pre-capture-readiness.mjs"
node --check "$ROOT/packages/FUSOU-APP/scripts/testplay-pre-capture-readiness.test.mjs"
node --check "$ROOT/packages/FUSOU-APP/scripts/testplay-verify.mjs"
node --check "$ROOT/packages/FUSOU-APP/scripts/testplay-verify.test.mjs"
```

Only the selected tests were run. Do not replace these with workspace/all-
package testing: compiling the `configs` test harness includes protected
configuration, and unrelated ignored roundtrip tests require separate authority.

Earlier failed attempts were not hidden: an APP method-placement syntax error,
test helper braces/imports, new fixture borrow errors, wrong workspace package
selection and missing mandatory epoch feature were corrected. A uniform
edition-2021 formatter check reported TLSN import ordering; the crate declares
edition 2024 and its matching check passes without rewriting upstream style.
The current appropriate commands pass. These failures did not justify assertion weakening,
new ignored tests, fake Production inputs or network dependency acquisition.
No protected configuration, real launcher/evidence verifier, external service,
privileged host operation, deployment or publication was used.

## Human next operations (not performed here)

| What the responsible human supplies/approves | Where / why | Completion evidence |
|---|---|---|
| Exact local TLSN patch set, profile/testplay scope and stop conditions | Protocol/security/license/release review; settle applicable P0-01/P0-10 decisions without silently waiving them. | Named approval record covering current source, not an upstream revision string alone. |
| Public bootstrap tuple and authorized manifest signing/publication arrangement | Controlled APP release build plus Runtime Config signing/endpoint owners; establish independent roots, not self-reported candidate values. | Approved public pin provenance, matching compiled handoff, fresh signature/raw-artifact checks and explicit registration review. Do not paste private keys here. |
| Real canonical hostname, Inventory and Approval | Deployment operator and APP selected route; constrain the intended Game Server. | Signed manifest/security-set raw digest bindings, valid ordered approval subset; later observed Presentation identity match. |
| Exchange/cleanup milliseconds and maximum Notary bytes | APP operator's explicit local limits; bound this attempt without inventing formal shared resource policy. | Required preflight checks pass with recorded public operational settings; no fixture defaults. |
| Actual service/deployment references, device-auth handler owner, trusted registries, authenticated user/device | Worker/Notary/Session/device/storage operators; verify compatible services and ownership/revocation contract. | Separately authorized live connectivity/negative checks and approved version/provenance evidence; no secrets printed. |
| Clean approved candidate build and permission for actual gameplay | Release/gameplay operator; current audit did not run scripts that touch protected configuration. | Exact build/config reference match, runtime verified gates, human permission and scoped private capture output. |
| Archive access, finalizer/delivery ownership and independent verifier inputs | Evidence/storage operator and independent reviewer; turn exact raw artifacts/receipts into a reviewable bundle. | Byte/hash/length inventory and successful independent reconstruction against externally pinned roots, followed by human evidence review. |

No human step above authorizes an operation in this task. A later explicit
instruction is required before real gameplay or service operations.

## Remaining guarantees

| Guarantee | Current state / reason |
|---|---|
| Executable identity | BLOCKED: no independent executable registration/admission is established by checking the APP. |
| Runtime dependency closure | UNVERIFIED: Cargo feature/source closure observed, not approved real ELF/loader/library closure. |
| Offline input integrity | BLOCKED for formal native provider; synthetic tests do not establish actual native input identity. Existing path-mode verification remains separate. |
| Actual attestation verification | UNVERIFIED, NOT EXECUTED. |
| Signer / trusted builder authorization | UNAPPROVED; no new signer/root authorization. |
| Provider bootstrap / registration | NOT_IMPLEMENTED; formal FD policy refusal unchanged. |
| authenticated | false; no actual user/device session verified in this work. |
| publication_authorized | false. |
| deployment | NOT_CHECKED. |
| Production acceptance | BLOCKED; successful local tests or eventual testplay are not acceptance. |
