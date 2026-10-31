# First real APP TLSN testplay: current readiness boundary

## Scope and evidence

Testplay decision: **BLOCKED_CODE**, with additional **BLOCKED_EXTERNAL_INPUTS**.
Actual APP GNU checking and selected local contracts pass;
real gameplay, real TLSN evidence acquisition and independent verification are
**NOT EXECUTED**. This document is a source/validation record, not permission
to launch the APP, contact services, publish or deploy.

The [device-proof contract and nineteen-role data lineage](DEVICE-PROOF-MATERIAL-LINEAGE.md)
separates **TLSN_PROTOCOL_TESTPLAY**, **IDENTITY_BOUND_TESTPLAY** and
**PRODUCTION_EVIDENCE_DELIVERY**. All currently have `BLOCKED_CODE`, for
different reasons. The APP has no independent protocol-only entry: its current
route already depends on proof APIs and Session/Binding services. The WEB proof
handlers now exist; deployment, complete material assembly and candidate receipt
prerequisites remain unresolved.
Complete-Bundle remote retention is not required by the local nineteen-role
verifier. The existing candidate execution-receipt prerequisite is retained by
the user's explicit decision, not described as an intrinsic TLSN requirement.
The existing pre-capture report now includes this source-only stage assessment,
without enabling a path or granting gameplay.

The preceding implementation follow-ups were:

* `929bbf58350b9641e6c1589235c3e854f5e8cd18`: bounded exchange ownership.
* `7ea2ba9d026c9b74d5ea8b30e8d471b29f651dee`: current-exchange Result admission.

They follow baseline `f8965eaf4d83fe67123c5ace6bb88b53cf3bf92c`
on `tlsn-first-testplay-candidate`. Earlier native, corpus and hosted-run
results are historical; they were not rerun or promoted here.

The preceding finalization audit started at `fbafee38f6da832f780bd9c2756651201a8ebf10`,
parent `7ea2ba9d026c9b74d5ea8b30e8d471b29f651dee`, on that same branch.
The cached upstream was `origin/tlsn-first-testplay-candidate`, ahead/behind
0/0, with a clean scoped worktree/index. No fetch or external operation was used.
Its validation is recorded separately below. The newer contract/lineage
follow-up starts at `ec37f88e7be4937dfae49f7ec6917c736992592c` and records its
own commands/results in the linked lineage document; do not merge the runs.

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
| CODE_READY | BLOCKED_CODE | Strict local finalizer and WEB proof handlers exist. Complete real-material assembly, the retained candidate receipt prerequisite and a stable authority-issued logical origin-attempt reservation still block broader completion. Capture initialization is backgrounded; unavailable capture leaves ordinary proxying active. | Do not call candidate files a finalized Evidence Bundle or enable a protocol-only bypass. |
| LOCAL_BUILD_READY | VERIFIED, GNU check only | Actual APP `tlsn-production`, its own manifest/lock and library/binary targets checked. | Not a GUI launch, release package, clean candidate handoff or live-bootstrap test. |
| CONFIG_READY | BLOCKED_EXTERNAL_INPUTS | Trust/release operator supplies approved embedded bootstrap and fresh signed manifest/artifacts; APP independently verifies them. | Missing/expired/mismatched/unregistered inputs reject; no fixture or stale-manifest fallback. |
| TARGET_APPROVAL_READY | BLOCKED_EXTERNAL_INPUTS | Deployment operator supplies the actual canonical hostname, reviewed Inventory and Approval bound by the manifest. | No real target/approval was admitted in this task. Candidate selection is not observed identity. |
| SERVICE_CONNECTIVITY_READY | NOT_CHECKED | Operators confirm intended Worker, Session Authority, device-auth, Notary and storage contracts/version. | Local mocks/health JSON are not execution or deployment proof. |
| CAPTURE_READY | BLOCKED | Existing runtime gates plus explicit human approval and the three local limits below must pass. | No real capture command was run; no gameplay permission follows from a local report. |
| DEVICE_AUTHENTICATION_READY | IMPLEMENTED_AND_CONNECTED source; deployment NOT_CHECKED | WEB exact-owner handlers, shared framing, atomic PostgreSQL proof/nonce claims and bounded Worker consumer are locally tested. | Only an existing non-anonymous exact owner is accepted. No anonymous-owner transfer or new enrollment policy is invented. |
| EVIDENCE_FINALIZATION_READY | PARTIAL | CLI consumes five APP artifacts plus an existing-schema material manifest and independently pinned inputs; all 19 artifacts must pass the real verifier before local publication. | Missing receipt/material or invalid bindings reject. No successful real finalization was run. |
| EVIDENCE_DELIVERY_READY | PARTIAL locally; remote UNVERIFIED | Private create-only local handoff with byte readback is implemented. Worker separately archives Presentation and exact outer Result before authority commit. | No full-Bundle remote upload/retention receipt or APP-to-collector transport is established. |
| INDEPENDENT_VERIFICATION_READY | IMPLEMENTED source; real run UNVERIFIED | Independent verifier uses externally pinned roots/registries and real artifacts. | No actual evidence verifier/attestation command was executed. |
| HUMAN_TESTPLAY_REQUIRED | NOT_EXECUTED | Human release/protocol authority approves exact scope/profile, operator, stop conditions and evidence review. | Unresolved fork/P0-10 decisions are not waived by this document. |

The report deliberately keeps `gameplay_authorized=false`,
`target_identity=NOT_YET_OBSERVED`, service connectivity `NOT_CHECKED`,
post-capture delivery/verification pending, and Production acceptance `BLOCKED`.
`target_approval: POST_CAPTURE_REQUIRED` refers to evidence of the observed
identity match, not permission to skip pre-capture runtime Target Approval.

## Prior Stage A source-path and runtime-input follow-up (baseline `1877824`)

This historical source-only follow-up starts from `18778247cb7b5641378e5bed4a153a9cd555531c`.
The prior hosted candidate run at that baseline passed its two jobs; it does not
validate the local follow-up or prove a real-game exchange.

The APP path still has no independent protocol-only entry. Its production
dependency graph constructs Session Binding and the identity-bound Worker
verification/result path. The Worker `/verify/tlsn` contract requires the
authenticated user/device proof flow. There is no approved identity-free
Result signing API in the inspected source. This remains `BLOCKED_CODE`; no
anonymous Worker route, local signer, or synthetic authority was introduced.
Runtime bootstrap pins, the reviewed target/approval, and Notary endpoint/key
are also `BLOCKED_EXTERNAL_INPUTS`. Resolving the signer/API trust contract
requires explicit human approval. The e7c0676 audit update below supersedes
this baseline's profile-routing and response-parser status.

The origin transport now accepts either a single `Content-Length` or the
existing strict chunked-response profile (hex chunk sizes, no extensions or
trailers). It preserves the exact wire response bytes for the TLSN transcript
and response digest; chunked bytes are decoded only for browser forwarding and
semantic parsing. Close-delimited and other transfer codings remain rejected.
The target server's actual response framing and body-size distribution are
`UNKNOWN` because no real-game connection was made. Existing limits were not
changed: request capture remains bounded by its existing TLSN admission
contract, the Prover receive setting remains 4 MiB, and the verifier response
transcript limit remains 16 MiB. No ordinary-proxy body or concurrency limit
was added.

Source instrumentation records request/wire-response/body byte counts,
response status and framing, origin and Notary TCP connection time, TLS
handshake time, request-write and response-read time, then elapsed durations
for Presentation/Notary processing, Worker verification, and signed-Result
signing/delivery. It does not record request/response bodies, auth material,
keys, or proof bytes. The last two stages are end-to-end durations; internal
remote signer time is not separately observable. These logs are measurement
support, not evidence that any stage completed against the real services.

| Input group | Source and consumer | Stage / current handling |
|---|---|---|
| `FUSOU_TLSN_RUNTIME_CONFIG_MANIFEST_URL`, `FUSOU_TLSN_RUNTIME_CONFIG_SIGNER_KEY_ID`, `FUSOU_TLSN_RUNTIME_CONFIG_SIGNER_PUBLIC_KEY_SPKI` | The only TLSN operational values embedded by the APP build; consumed by `RuntimeConfigBootstrap` | Public Bootstrap locator and initial Ed25519 trust anchor. All three are required together; compiled reports distinguish `UNREGISTERED` from `EMBEDDED_UNVERIFIED`. They do not prove Manifest verification or APP integrity. |
| `FUSOU_TLSN_NOTARY_ENDPOINT`, `FUSOU_TLSN_NOTARY_VERIFYING_KEY` | Signed Runtime Config Manifest V2 `compile_inputs`; APP reads them from `VerifiedRuntimeConfigManifest` | Not APP build inputs. The APP uses these values only after local Manifest verification; the Worker uses its own Notary registry and key binding. Production values remain unregistered/unverified. |
| `FUSOU_TLSN_EXCHANGE_TIMEOUT_MS`, `FUSOU_TLSN_CLEANUP_TIMEOUT_MS`, `FUSOU_TLSN_MAX_NOTARY_ATTESTATION_BYTES` | Runtime environment parsed by `exchange_lifecycle` | Required explicit limits with range/canonical checks and no defaults; an operator must supply approved values. |
| Origin Inventory, Target Approval, Web PKI trust roots, and signed Runtime Config artifacts | Manifest-pinned raw artifacts for APP preflight; Worker-owned shipped artifacts and bindings for verification | APP verifies artifact digests and approval before local use. The Worker independently checks its own inventory, approval, Notary registry set, and observed Presentation identity. |
| `FUSOU_TLSN_RESULT_PUBLIC_KEY_SPKI`, `FUSOU_TLSN_RESULT_SIGNER_KEY_ID`, `FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY` | Signed Runtime Config V2 for APP Result verification; Worker-owned signer bindings for result generation | The Manifest signer may update the APP-side Result Registry pin, but cannot update Worker bindings. The Worker verifies the Result Registry envelope against its own root before accepting production configuration. |
| `FUSOU_TLSN_EXPECTED_ACTIVE_VERSION_ID`, `FUSOU_TLSN_EXPECTED_BINDING_MODE`, `FUSOU_TLSN_EXPECTED_DEPLOYMENT_ID`, `FUSOU_TLSN_EXPECTED_GIT_COMMIT_SHA`, `FUSOU_TLSN_EXPECTED_WORKER_NAME`, `FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT`, `FUSOU_TLSN_VERIFICATION_ENDPOINT` | Signed Runtime Config V2 `compile_inputs`, derived from the operator-approved Worker reference | Fetched and verified at APP runtime; these values are no longer supplied to the APP build environment or emitted in its compiled Bootstrap report. |
| `FUSOU_TLSN_SESSION_AUTHORITY_ENDPOINT`, `FUSOU_TLSN_SESSION_AUTHORITY_KEY_ID`, `FUSOU_TLSN_SESSION_AUTHORITY_PUBLIC_KEY` | Session receipt verification and binding prewarm | Stage B identity/session inputs, not intrinsic TLSN Presentation verification inputs. They remain required by the existing APP path and were not bypassed. |
| APP E2E variables, `FUSOU_TLSN_EVIDENCE_BUNDLE`, and `FUSOU_TLSN_ROUNDTRIP_CONFIG_PATH` | Test harnesses and evidence CLI only | Test/CLI inputs, not production runtime configuration and not proof of real service readiness. No values were inspected. |
| `artifact_output_path` and capture toggles | APP user configuration and local filesystem sink | Local path/behavior inputs; protected user configuration values were not inspected. No real artifact path or output was created. |

## Current local implementation validation

Follow-up baseline: `fc29aac29d454bf949510e0d97acbd3cd7e68e5b`.
The earlier hosted candidate run at that SHA passed; it is not CI for these
new local changes. No workflow dispatch, deployment or real service call was made.

| Check | Current observation |
|---|---|
| Actual APP GNU `tlsn-production --locked --offline --lib --bins` | Exit 0; eight pre-existing warnings. Native/WASM entry separation avoids loading the protected WASM bridge. WASM build/provenance NOT_RUN. |
| APP TLSN library tests (`-- tlsn_`) | 64 PASS, 0 FAIL, 1 pre-existing ignored harness-only test, exit 0. The ignored generated-config/offline-preflight test requires its separate round-trip harness; it is not a real-service test or a PASS. |
| Actual Proxy synthetic-feature selected contracts | 129 PASS, 0 FAIL, 1 pre-existing ignored harness-only test, exit 0. Loopback TLSN/Notary and actual HTTP handler pass; the separately orchestrated APP/Worker synthetic E2E is not run or counted as PASS. |
| Independent Bundle/finalization and CLI | 39 + 5 PASS, exit 0; real evidence NOT_RUN. |
| WEB actual handler/Ed25519/PostgreSQL/Worker consumer | 63 PASS, exit 0, including 24 new cases; local Auth/PostgREST adapters, not deployed Supabase. |
| Node proof/stages/pre-capture/finalizer/delivery/catalog | 112 PASS, exit 0. |
| Closed Worker source inventory / release driver regressions | 35 PASS, exit 0; actual parse-only source closure plus in-memory build/WASM/archive adapters, not native/WASM execution or deployment. Both proof client and new framing source are mandatory inventory inputs. |
| WEB / Worker type checks; frozen offline pnpm lock | Exit 0. No Production bindings or secrets used. |

APP now retains seven independently verified Runtime Config public artifacts
and sends them to the real candidate writer as immutable exact bytes. This
partial collector does not complete the nineteen roles. The five existing
finalizer overrides and independent authentication/registry comparison remain.

The origin transport connects directly to the target, not through the Worker.
After a complete origin response, proof/Worker/signing/archive failure can no
longer overwrite the independent `ResponseReceived` origin outcome. Controlled
tests hold each proof stage, receive the browser response first, then observe
the exact evidence failure with one origin send. Pre-send refusal is `NotSent`;
send-start failure is `Unknown`/`AmbiguousOriginSend`, never automatic retry.

**Nonblocking-capture follow-up (source status):** The APP starts the ordinary
proxy before background Runtime Config refresh, preflight, Worker health checks
and TLSN dependency construction. It installs the capture forwarder only after
those gates pass; initialization failure leaves capture unavailable while the
ordinary proxy remains active. Matching requests are admitted individually
only when a prepared binding and capture capacity are available. An unready
binding, competing request, unsupported body framing or unavailable ingress
capacity falls through to the ordinary proxy before the body is consumed.
There is no listener-global permanent one-shot.

Once selected body collection begins, a read failure/timeout/limit failure
cannot be reconstructed from the consumed stream; that request fails closed
without upstream fallback or retry. A claimed binding remains in use through
proof-task cleanup, so later target requests use the ordinary proxy until a
new binding is prepared. The APP's append-only journal synchronously records
the binding-derived attempt digest, target and serialized-request digest before
origin I/O; unfinished records recover as `UNKNOWN` and the same attempt digest
cannot be reused. This is local restart protection, not an authoritative
logical-operation reservation: the Worker Binding Authority record does not
bind a stable Game Server operation ID, request digest or origin-send intent.
No new Worker policy or endpoint was introduced. Do not waive authentication,
classify a possibly sent operation as unsent, or treat a different binding as
proof that a repeated logical operation is new.

Ingress-only Linux measurement, one test process/thread: eight retained 1 MiB
bodies, ninth rejected; baseline RSS 16,612 KiB, process high-water 30,380 KiB,
retained body bytes 8,388,608; growth below the test's 64 MiB ceiling. The
measurement runs in a dedicated child test process, including when selected
from a parallel suite, so unrelated tests cannot pollute its high-water metric. This is
not full TLSN/MPC/proof/process-wide memory accounting. Existing ingress limits
and the three explicit exchange/cleanup/Notary inputs remain unchanged.

## Earlier APP build and ownership snapshot (historical)

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
compact canonical inner Result, receipt bytes/header, session/consume/device material
and inventory; filesystem Result delivery is a separate JSON output. Pretty
JSON is not the authoritative exact response-byte source. These files remain
unapproved candidates, not an automatically finalized Evidence Bundle.

The new operator caller is the existing offline CLI's paired
`--finalize-candidate PATH --output NEW_DIRECTORY` path. Its implementation is
[finalization](src/evidence_bundle/finalization.rs), not an automatic APP
callback. It takes the existing Production manifest and external material via
`--bundle`; the five APP-owned roles are loaded from the candidate instead of
requiring manually copied duplicates. Their descriptor hashes/lengths must
already match. Other required artifacts/predicates are not fabricated.
All candidate sidecars are preserved separately under `candidate/`.

The previous pretty inner export was incompatible with the independent
canonical Result parser. New APP exports are compact; exact outer
`result-exact.bin` is unchanged. Old pretty exports are not silently rewritten.
Candidate-write cleanup errors are now returned explicitly rather than ignored.

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

## Evidence finalization and delivery contract

The actual source chain is:

1. APP runtime/verified Runtime Config builds the Proxy dependencies.
2. Per-request capture admission calls the production forwarder only when a
   prepared binding and local capture capacity are available; Prover-owned
   TLS/MPC creates the actual Presentation, then the deferred proof invokes Worker
   verification. Browser response completion is earlier, not evidence completion.
3. Worker verifies/signs the inner Complete v2 or Sparse v3 Result. In the
   Production-inventory path it PUTs and readbacks exact Presentation and outer
   Result, verifies length/hash/generation, then commits the consumed binding,
   exact Result and optional execution receipt/catalog in the authority transaction.
4. APP Result admission verifies signature, current exchange and authority pair.
   `RemoteWorkerResultSigner::sign` calls the private candidate writer.
   `FilesystemResultDelivery::deliver` is separate local JSON delivery, not R2 success.
5. After separately authorized capture and material collection, a human operator
   invokes `run` in the existing CLI, then `finalize_candidate`, then
   `verify_loaded_bundle`, then local publication. No APP automatic invocation
   or real-service collector was added.
6. Only a successful independent verifier call permits local publication.
   New output is exclusive/private; artifact/report writes are create-only,
   synced and read back. The complete manifest is published last with atomic
   create-if-absent hard-link semantics. Existing output is never reused,
   overwritten or removed. Filesystems without the required operations fail
   closed. This is local filesystem handoff, not remote retention verification.
7. Later independent verification reads the finalized directory with the same
   externally approved roots/pins. A saved local report is not trusted instead
   of re-verification. Missing inputs or any partial failure never produce a
   successful return; failed new-output cleanup is explicitly reported.

Finalizer reads are capped at 32 MiB/file and 256 MiB cumulative input, before
read-all allocation, with a bounded read sentinel as well. This is not a
formal shared memory/resource issuer. Production Bundle schema is unchanged:
scope `tlsn-production-evidence`, schema 1, capture PASS, verification VERIFIED,
production provenance, but overall/Production/P0-05 statuses remain BLOCKED.
The 14 evidence requirements, semantic/device predicates, timestamps and trust
graph remain mandatory; proxy process provenance can remain UNVERIFIED.

### Required artifact / binding matrix

All 19 roles below are mandatory for the existing independent verifier.
Output stores them under `artifacts/<role>.bin`; descriptor length/SHA-256 and
production provenance apply to every role. External means separately acquired
real material, not values generated from a candidate declaration.

| Artifact / fields | Producer and input location | Binding / verification owner | Current acquisition |
|---|---|---|---|
| `presentation` | Actual APP proof; `presentation.bin` | Exact raw SHA-256, Notary signature, Web PKI DER, observed DNS identity; independent Rust verifier | APP writer implemented; real capture UNVERIFIED |
| `result` | Worker; APP compact `result.json` | Strict Complete v2 / Sparse v3, signing domain V2, external Result registry, exact Presentation digest and authority pair; verifier independently re-derives Result | APP admission/export implemented; real Result UNVERIFIED |
| `session` | Worker Session Authority; APP `session.json` | Signed receipt binds user/device/auth nonce/session/binding/challenge/times to Result and external authority key | APP-owned finalizer role |
| `possession_proof` | Registered device's existing signature; APP `possession-proof.json` | Canonical framed message, device key pin, session/binding/challenge, digest; Rust signature verification | APP-owned finalizer role |
| `consume_receipt` | Worker Binding Authority; APP `consume-receipt.json` | Independent signed consumption receipt, exact Presentation hash and current subject/session/binding/time | APP-owned finalizer role |
| `result_registry` | Approved published Result registry; external file | Envelope-authorized bytes, signer status/validity at capture | Real publication/collection NOT_CHECKED |
| `result_registry_envelope` | Approved registry signer; external file | Independent evidence-root ID/SPKI authorizes exact registry bytes | No root/signing registration performed |
| `notary_registry` | Approved Notary publication; external file | Byte equality with external option and actual Presentation Notary key | Real input pending |
| `health` | Actual Worker health response; external capture | Result/Notary/Session/Binding public identities and registry hashes agree | APP metadata observation is not the complete required artifact |
| `authenticated_user` | Supabase authenticated-user observation; external material | Externally pinned canonical user; signed session/Result cross-reference | No real authenticated observation |
| `device_identity` | Approved WEB `user_devices` observation; external material | External device key/hash, canonical owner, non-revoked row; session/Result cross-reference | APP's `authority_state=UNVERIFIED` record is not promoted |
| `device_authentication` | Actual auth request + Worker session issuance observation; external material | Request must equal APP capture; device signature and signed session receipt bind auth nonce; acceptance 201 binds device/session | Candidate metadata alone is not endpoint execution proof |
| `replay` | Approved authority/device-proof negative observation; external material | Actual 409 and allowed error plus canonical digest/session/device/binding/stored digest | No producer captured here; a cached 200 Result is not a 409 replay observation |
| `session_authority_registry` | Session authority publication; external file | Exact byte equality with separately supplied registry; independent key ID/SPKI and historical validity | Worker signing source exists; deployment/pins NOT_CHECKED |
| `binding_authority_registry` | Binding authority publication; external file | Exact byte equality and independent key pin; consumption signature validity | Same separation as Session authority |
| `capture_metadata` | Real production capture mapping; external material | Fixed HTTP profile, Presentation hash, timestamps, false synthetic/test/local flags; proxy cryptographic provenance remains UNVERIFIED | Candidate `metadata.json` is not automatically this schema |
| `semantic_verification` | Independent actual-Presentation analysis; external material | Exact Presentation size/hash, unsigned Result, disclosed ranges, identity/member/Notary, profile predicates and verifier/time metadata | Not a fabricated PASS report; no real material collected |
| `trust_root` | Independently approved Web PKI DER anchor; external file | Exact byte equality with external trust-anchor option; actual Presentation TLS chain | DER is not target identity or a custom-CA authorization |
| `subject` | Capture/evidence producer from verified subject context; external file | SHA-256s of canonical user/device/session/member/binding match signed Result | Must match current exchange, not candidate identity authority |

Origin Inventory and Target Approval are independently supplied raw CLI inputs,
not new manifest artifact roles. Both digests are mandatory together in
Production Result, and checked against these exact inputs and the hostname
actually observed from Presentation. Supplied target selection alone has no authority.
Manifest provenance/version/status/times and all graph/evidence relationships
are checked by the existing verifier, not supplied as bypass booleans.

### Exact outer Result, execution receipt and archive limits

`result` in the existing Bundle schema is the canonical **inner** signed Result,
not the outer HTTP response. The finalizer also checks raw outer JSON agrees
with captured inner Result/consume receipt/replay digest and parsed response;
preserves raw outer/header/receipt bytes; and checks local digest/length and
header encoding. These are consistency checks, **not an independent signature
verification or archive-authority proof for the outer response/execution receipt**.
The saved report retains the existing Bundle verifier's scope only.

The source execution-receipt signer is explicitly Canary-scoped and guarded by
`canaryVerifierExecution`; a Production receipt producer/verification contract
was not established. The existing candidate status is INCOMPLETE when receipt
bytes are missing, and this finalizer rejects it. It does not mint a Production
receipt, reinterpret a Canary receipt as Production, or treat local hashes as
independently authorized bytes. Resolving this code/contract gap requires the
responsible verifier/evidence authority, not a random key or relaxed assertion.

The existing [archive catalog](../FUSOU-TLSN-VERIFICATION-WORKER/src/archive-catalog.mjs)
connects exact consumed binding/job/attempt/subject to object keys, versions,
lengths and hashes. The [archive HTTP handler](../FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http.mjs)
is read-only, OIDC/grant/policy constrained; it is not a full-Bundle upload API.
The [release collector](../../scripts/release-evidence-producer.mjs) and
[archive job](../../scripts/release-archive-job.mjs) require an independently
eligible main release/workflow context, not a local APP candidate. The existing
[delivery policy](../../scripts/evidence-delivery-policy.mjs) is a helper with
a trusted-verifier interface, not a connected APP collector. No new caller
claims its mock authorization is real authority.
Remote Bundle delivery, permanence/retention and an independently verifiable
full-Bundle delivery receipt remain UNVERIFIED / NOT_IMPLEMENTED where absent.
The finalizer does not claim `archive_success` or publication authorization.

## Worker / Session / WEB service contract

The audit inventoried tracked source across APP/Proxy, `fusou-auth`, Worker,
WEB routes/pages and SQL migrations, including source filenames for Edge
Functions. No matching tracked device-proof/tlsn-device-proof handler was found.
This is **NOT_IMPLEMENTED in tracked source**, not evidence that an unknown
external deployment does or does not run one.

* APP `AuthManager` fetches the configured
  `anonymous_sync_v2_challenge_endpoint` with `device_id`, then calls the
  Runtime-Config-pinned Worker's `/attestation/session` using its authenticated
  bearer and `{device_id, nonce, sig}`. It does not directly call a fictional
  TLSN device-auth URL. Nonce signing/registered-key handling stays unchanged.
* Worker validates bearer with Supabase `/auth/v1/user`, rejects anonymous
  subjects, then calls the configured device-auth endpoint without redirect
  following. Production config requires the allowlisted HTTPS path
  `/api/auth/anonymous-sync/v2/device-proof`. Success must be exactly
  `{authenticated:true, canonical_user_id:UUID, device_id:UUID}`, matching
  both bearer subject and requested device.
* Worker possession authentication requires the separately configured
  `/api/auth/anonymous-sync/v2/tlsn-device-proof` endpoint, the existing framed
  device/session/binding/challenge signature, and canonical replay digest.
  Success extends the auth response with `replay_digest_hex`. A matching
  previously recorded operation digest can support the existing authority's
  same-operation replay handling; it does not authorize an unknown operation.
* Error contracts remain 403 owner mismatch; 409 revoked, nonce already used
  or proof replayed as appropriate; 401 invalid/expired nonce/signature; 5xx,
  redirect or transport failure unavailable. No refresh fallback is added.
* Intended data/service responsibility is the WEB device-ownership service and
  its Supabase administrator, since WEB/SQL own `user_devices`,
  `user_member_map` and atomic nonce consumption. An appointed human endpoint
  owner, approved enrollment policy, implementation, deployed URL/version and
  credential configuration remain unregistered/NOT_CHECKED, not inferred.
* Existing WEB `/auth/anonymous-sync/v2` register/challenge/refresh/revoke and
  authenticated device listing/deletion are mounted in the real server.
  Registration resolves member/public/canonical mapping; the SQL registration
  RPC serializes/quota-limits it and rejects revoked rows. Ordinary initial
  registration is not itself a non-anonymous bearer-owner/enrollment proof.
  Refresh checks registered key/nonce/member mapping and returns a dataset
  token; it is not the Worker's required auth response. Device-signed revoke
  checks the same canonical owner; web deletion verifies bearer/ownership.
* Challenge freshness uses the existing signed challenge; nonce consumption has
  a database `(device_id, nonce)` uniqueness boundary and fails when the table
  is unavailable. Refresh can return its durably saved response for an identical
  retry. These contracts do not implement either missing TLSN proof API.
* Worker holds distinct Session and Binding authority signing APIs/keys/
  registries. Session receipt signs auth nonce and exact identity/binding/time;
  consume receipt signs exact Presentation identity and consumption. The
  independent verifier pins both registries byte-for-byte and both authority
  public keys; no private key is exported to the bundle.
* Binding authority transactions fence user/device/session/job/attempt/lease.
  Exact repeated commits can be idempotent only with matching stored bytes,
  receipt and catalog; stale/foreign attempts reject. Status reads retrieve the
  authoritative exact Result; `/verify/tlsn/retry` is explicitly disabled.
  This is not permission to resend an origin request.

The missing service contract must implement bearer-to-row owner checks,
revocation, registered public-key verification, challenge expiry and atomic
single consumption, with the exact existing response/error contracts and
separately approved enrollment rules. No endpoint, secret or owner was invented.

## Ingress, deadlines, single-use and cleanup

Browser request body collection occurs **before** the TLSN absolute exchange
deadline. In the default Hudsucker path, only a matching request with a ready
binding first acquires per-request capture admission and a slot from the
[TLSN ingress collector](../FUSOU-PROXY/proxy-https/src/request_ingress.rs).
Selection additionally requires one bounded Content-Length no greater than
the 128 KiB TLSN sent-data ceiling, and the complete serialized request has
that same 128 KiB ceiling. The ingress collector provides a separate 1 MiB
body cap, 10 s idle timeout, 30 s absolute completion timeout and eight
concurrent reservations. Declared lower bounds and each streamed chunk are
checked; progress does not reset completion. These limits apply to selected
TLSN capture, not to non-target or not-ready requests sent through the ordinary
proxy, and are not whole-process memory bounds.

If capture is unavailable, the target body has an unsupported/unbounded
Content-Length, another request owns admission, or TLSN ingress capacity is
unavailable, the untouched body follows the ordinary proxy path. Once selected
body collection starts, an overflow, timeout or read error may have consumed
the stream; the request then fails closed and is not retried upstream. Drop
discards the temporary buffer and releases local admission, but does not prove
external FD/job cleanup. The optional Rama path has its own selected-body
timeout and also routes requests that are not admitted to the ordinary proxy.
Ordinary request buffering/logging and remote service budgets are not bounded
by the TLSN collector.

The existing three mandatory exchange/cleanup/Notary inputs still have no
defaults. Their canonical-positive/range checks remain. The absolute exchange
deadline starts after a prepared binding is claimed and covers the origin
exchange and proof/Worker/Result pipeline; it does not cover background Runtime
Config, health or Session/Binding prewarm, which use their own bounded calls and
retry schedule. Cleanup uses its separate wait budget. Notary reads use
`take(max_bytes + 1)` before deserialize, not an unbounded attestation allocation.
Local tracked cleanup must complete before `ResultReady`; no cleanup-unknown
operation is promoted or its single-use state reopened. Remote jobs can continue
after local cancellation. Immutable stop reason, current-exchange admission,
non-overwriting store and single-use ownership prevent late data becoming a
new operation's successful Result; this is not remote-job cancellation proof.

Single-use means FUSOU does not resend after send intent:
normal completion has one logical request, pre-send rejection can have zero,
and ambiguous write failure leaves Game Server receipt **UNKNOWN**. No retry
can repair that uncertainty. Neither browser success nor a local callback
settlement establishes completed proof, durable archive, or Production acceptance.

## Historical local validation before this finalization audit

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

## Current finalization audit validation

The new runner was isolated under the session's `evidence-finalization-gate`,
using Rust 1.98.1 GNU, `env -i`, private HOME/TMPDIR/CARGO_HOME, separate
APP/proxy/verifier targets, and committed lockfiles. Only existing local caches
were restored after an offline missing-dependency failure; MPZ was privately
copied. No dependencies were downloaded. No actual evidence, GUI APP,
Notary/game session, device registration or actual verifier CLI was executed.

| Suite / command scope | Current result |
|---|---|
| Actual APP `check --features tlsn-production --locked --offline --lib --bins` | PASS, exit 0; existing warnings remain |
| APP library preflight / manifest / runtime manager / wrapper gates | 55 PASS, 0 FAIL, 1 pre-existing ignored external-roundtrip test, exit 0 |
| Proxy combined selected suites, `alpha15-tlsn` | 78 PASS, 0 FAIL/ignored, exit 0: lifecycle 7, experimental 15, production 22, real-task 10, Result binding 8, signature/canonical export 6, ingress 5, request routing/body failure 4, candidate export 1 |
| Finalizer input/state/IO and relative-output parent sync | 13 PASS, 0 FAIL/ignored, exit 0; no fake finalization success or real positive-evidence run |
| Existing Bundle schema/acquisition/signature/receipt trust-edge tests | 24 PASS, 0 FAIL/ignored, exit 0; fixed synthetic vectors only |
| Existing CLI parsing / finalizer flags / closed FD gate | 5 PASS, 0 FAIL/ignored, exit 0; not actual evidence execution |
| Node APP helper/readiness 34 + delivery policy 5 + archive catalog 41 | 80 PASS, 0 FAIL/SKIP, exit 0; in-memory/temporary-file tests, not service/archive operations |
| Ordinary proxy `--no-default-features --features kc-api-epoch-20250627 --lib` | PASS, exit 0 |
| New Rust modules, edition-2021 formatter check | PASS, exit 0 |
| Required README/readiness/runbook local links | 95 existing targets checked, exit 0; four stale deployment/builder links corrected to current contracts, without inventing removed commands |

Full current invocations, with `ROOT` the repository and `GATE` the new isolated
directory, are below. The current runner's first argument selects the actual
working directory (`app`, `proxy` or `verifier`); it supplies the sanitized
environment described above. It is not the previous task's runner.

```sh
ROOT=/home/ogu-h/Documents/GitHub/FUSOU
GATE=/home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/evidence-finalization-gate
sh "$GATE/run-cargo.sh" app check --features tlsn-production --locked --offline --lib --bins
sh "$GATE/run-cargo.sh" app test --features tlsn-production --locked --offline --lib -- tlsn_preflight::tests tlsn_runtime_config_manifest::tests tlsn_runtime_config_runtime::tests wrap_proxy::runtime_config_transport_gate_tests
sh "$GATE/run-cargo.sh" proxy test --locked --offline --features alpha15-tlsn --lib -- request_ingress::tests proxy_server_https::tests::ingress_ proxy_server_https::tests::uncollectable_tlsn_request_is_not_sent_or_forwarded_to_production real_tlsn::tests::candidate_bundle_preserves_exact_response_and_receipt_without_overwrite real_tlsn::tests::result_signature_verifier_export_bytes_are_canonical exchange_lifecycle::tests experimental_tlsn::tests real_tlsn::task_tests production_tlsn::tests real_tlsn::tests::result_binding_tests real_tlsn::tests::result_signature_verifier
sh "$GATE/run-cargo.sh" verifier test --locked --offline --lib evidence_bundle::finalization::tests
sh "$GATE/run-cargo.sh" verifier test --locked --offline --lib evidence_bundle::tests
sh "$GATE/run-cargo.sh" verifier test --locked --offline --lib -- evidence_bundle::finalization::tests evidence_bundle::tests
sh "$GATE/run-cargo.sh" verifier test --locked --offline --bin verify_fusou_tlsn_evidence
sh "$GATE/run-cargo.sh" verifier check --locked --offline --lib --bins
sh "$GATE/run-cargo.sh" proxy check --locked --offline --no-default-features --features kc-api-epoch-20250627 --lib
sh "$GATE/run-cargo.sh" proxy test --locked --offline --features alpha15-tlsn --lib request_ingress::tests
/home/ogu-h/.rustup/toolchains/1.98.1-x86_64-unknown-linux-gnu/bin/rustfmt --check --edition 2021 "$ROOT/packages/FUSOU-PROXY/proxy-https/src/request_ingress.rs" "$ROOT/packages/FUSOU-TLSN-VERIFIER/src/evidence_bundle/finalization.rs"
cd "$ROOT"
node --test scripts/evidence-delivery-policy.test.mjs scripts/release-archive-catalog.test.mjs packages/FUSOU-APP/scripts/testplay-pre-capture-readiness.test.mjs packages/FUSOU-APP/scripts/testplay-verify.test.mjs
```

Non-successful/intermediate commands were not hidden:

* The first isolated verifier checks exited 101 for missing `nix` in an empty
  private cache, then a misplaced registry link; existing caches/link correction
  resolved this offline.
* The initial finalizer run was 11 PASS / 1 FAIL because a new test expected
  the wrong existing structured rejection edge. It now asserts the exact
  `artifact_manifest` rejection and message; no verifier check was weakened.
* The first proxy attempts found a new `BytesMut` import and two test-body
  constructor mistakes, corrected using existing re-exports/`Full`.
* The attempted `synthetic-tlsn` test build also found a pre-existing ignored
  roundtrip test calling `.collect()` on an already-buffered `Bytes` response.
  That unrelated opt-in test was not changed or run. Validation uses the actual
  APP's `alpha15-tlsn` feature; the synthetic-feature build remains a known
  pre-existing failure, not a PASS.
* An initial Node invocation used two nonexistent `-test.mjs` filenames; Node
  selected only the two real root suites (46 PASS). The corrected existing
  `.test.mjs` inputs above ran all four files (80 PASS). The 46-run is not
  represented as APP helper validation.
* OIDC HTTP tests that generate fresh RSA keypairs were not run under this
  task's no-key-generation constraint. Existing catalog/delivery fake tests are
  not live OIDC, archive retention, or TLSN proof evidence.

## Human next operations (not performed here)

| What the responsible human supplies/approves | Where / why | Completion evidence |
|---|---|---|
| Exact local TLSN patch set, profile/testplay scope and stop conditions | Protocol/security/license/release review; settle applicable P0-01/P0-10 decisions without silently waiving them. | Named approval record covering current source, not an upstream revision string alone. |
| Public bootstrap tuple and authorized manifest signing/publication arrangement | Controlled APP release build plus Runtime Config signing/endpoint owners; establish independent roots, not self-reported candidate values. | Approved public pin provenance, matching compiled handoff, fresh signature/raw-artifact checks and explicit registration review. Do not paste private keys here. |
| Real canonical hostname, Inventory and Approval | Deployment operator and APP selected route; constrain the intended Game Server. | Signed manifest/security-set raw digest bindings, valid ordered approval subset; later observed Presentation identity match. |
| Exchange/cleanup milliseconds and maximum Notary bytes | APP operator's explicit local limits; bound this attempt without inventing formal shared resource policy. | Required preflight checks pass with recorded public operational settings; no fixture defaults. |
| Matching proof APIs and approved enrollment/ownership policy | WEB/device service and Supabase owners, then Worker/Session owners; implement both fixed proof paths and nonce/proof replay contracts before claiming CODE_READY. | Reviewed code/tests, appointed owner and deployment/API compatibility; refresh/revoke are not substitutes. |
| Actual service/deployment references, trusted registries, authenticated user/device | Worker/Notary/Session/device/storage operators; verify compatible services and ownership/revocation contract. | Separately authorized live connectivity/negative checks and approved version/provenance evidence; no secrets printed. |
| Clean approved candidate build and permission for actual gameplay | Release/gameplay operator; current audit did not run scripts that touch protected configuration. | Exact build/config reference match, runtime verified gates, human permission and scoped private capture output. |
| Production receipt contract and all 19-role real material | Verifier/evidence authority and collector owner; resolve incomplete candidate receipt status and source the actual owner/replay/semantic/capture observations. | Approved non-fabricated producers, schema-correct manifest/predicates and independent external pins; a local metadata flag cannot complete it. |
| Archive access, finalizer/delivery ownership and independent verifier inputs | Evidence/storage operator and independent reviewer; run the conditional finalizer/verification procedure in the [operator runbook](../FUSOU-TLSN-VERIFICATION-WORKER/docs/production-evidence-operator-runbook.md). | Exact archive generation/readback, full artifact inventory, verified local bundle and separately established remote delivery/retention evidence, then human review. |

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

## Nonblocking capture follow-up validation

The local source follow-up was validated without launching the APP, contacting
Worker/Notary/Game Server services, or creating evidence:

| Check | Result | Scope |
|---|---|---|
| Proxy default library tests | 122 PASS, 0 FAIL, exit 0 | Existing Hudsucker lifecycle, request routing, ingress and Production boundary tests. |
| Proxy `rama-experimental` library tests | 155 PASS, 0 FAIL, exit 0 | Includes Rama route fallback and HTTP/1 loopback tests; not an actual Game Server connection. |
| APP `tlsn-production` library/binary check | PASS, exit 0 | APP Cargo graph type-checks; existing warnings remain. Not a GUI launch or package build. |
| APP `tlsn-production` Runtime Config transport-gate tests | 7 PASS, 0 FAIL, exit 0 | APP library/test compilation and local fake revalidation/binding/origin gates; not APP GUI launch or service readiness. |

The first optional-feature compile exposed mismatched `http`/Rama header types
and a test adapter error contract; those were corrected before the 155-test
pass. A separate APP test filter initially matched zero tests and is not
counted; the actual `runtime_config_transport_gate_tests` filter ran the
seven tests above. No CI run covers these uncommitted changes. No real TLSN
Presentation, external receipt, or Production acceptance was established by
these local checks.

## e7c0676 independent audit update

The audit started at `e7c0676849eaad672e63c79c96c9a3fd6750a1a8` on
`tlsn-first-testplay-candidate`; the local follow-up is uncommitted.

### APP-to-Result call chain

```text
wrap_proxy::build_production
  -> verified Runtime Config target/endpoint/profile
  -> RealAlpha15OriginTransportFactory::send_once
  -> real_tlsn::run_real_exchange
       -> Origin/Notary TCP connections
       -> alpha.15 Prover owns Origin TLS
       -> ProverOwnedTlsTransport sends once and reads a framed raw response
       -> transcript commitment and full disclosure in ProveConfig
       -> Notary attestation, Presentation serialization, one-use handoff
  -> PresentationVerifierBoundary
  -> RemoteWorkerVerificationBackend sends exact Presentation bytes
  -> Worker /verify/tlsn
       -> handleTlsnVerification and bound verification callback
       -> verifyPresentationToPreparedResult
       -> WASM verify_require_info_presentation
       -> Alpha15 AuthenticatedTranscript::verify_require_info
       -> parse_require_info_response_source / parse_framed_body
       -> unsigned Complete Result v2 and signing bytes
  -> Worker validates profile/binding, signs and returns the Result
  -> APP ResultSignatureVerifier verifies it; RemoteWorkerResultSigner
     persists the exact Result through the local delivery boundary
```

`run_real_exchange` and `build_presentation` both reveal the complete sent and
received transcript ranges. The Worker selects its parser from the endpoint
route, not from `productionInventoryMode`: `/verify/tlsn` is complete and
`/verify/tlsn/sparse` is sparse. `productionInventoryMode` is true only for the
production environment/role pair; it changes server-identity selection to the
observed Presentation identity matched against Inventory and Target Approval,
but does not choose the parser. Production also rejects the synthetic trust
root. The separate Worker sparse route remains available to other callers.

The baseline APP Runtime Config accepted sparse mode, but the APP Prover always
reveals the entire transcript. Sparse v3 Result construction rejects a fully
covered transcript, and the sparse response parser rejects Transfer-Encoding
because it does not implement an authenticated chunk-framing scan. Thus an
APP sparse profile was not a working alternative, even for Content-Length
responses. The APP Runtime Config, preflight, dependency builder, release
reference and build handoff now fail closed unless the mode is `complete` and
the endpoint is `/verify/tlsn`. The sparse parser and its chunked rejection
were not weakened. APP full disclosure was already the Prover's behavior; the
change prevents the configuration from misrepresenting it as sparse.

The normal WASM entry verifies the alpha.15 Presentation with the trusted
Notary key and calls `verify_require_info`; the sparse entry calls
`verify_require_info_sparse`. Synthetic-root WASM functions are used only by
non-Production test configurations. A native verifier test now exercises the
complete WASM wrapper logic on a local TLSN loopback Presentation; the Notary
key and root in that test are synthetic, not Production trust inputs.

### HTTP framing and evidence bytes

| Path | Accepted framing |
|---|---|
| APP complete Production route | One Content-Length, or exactly one `Transfer-Encoding: chunked` with no Content-Length |
| Generic Worker sparse parser | Content-Length only; any Transfer-Encoding remains rejected pending an authenticated sparse framing scan |

The supported complete chunked profile accepts 1–16 ASCII hexadecimal size
digits (either case), exact CRLF boundaries, multiple chunks and an exact
zero-chunk terminator. Chunk extensions, trailers, duplicate or comma-separated
Transfer-Encoding, Content-Length/Transfer-Encoding ambiguity, close-delimited
responses and other transfer codings reject. The limits remain unchanged:
16 MiB response transcript parser ceiling and 4 MiB Prover receive setting.
The actual Game Server response framing and size distribution remain
`UNKNOWN`.

HTTP Content-Length now uses the shared
`authenticity_core::http_framing::parse_http_content_length` byte parser in the
Verifier and Proxy. Surrounding SP/HTAB OWS is accepted; only ASCII digits are
accepted; `0`, `007` and ordinary positive values parse correctly; empty
values, signs, embedded whitespace, non-ASCII digits and overflow reject.
Duplicate Content-Length and Content-Length plus Transfer-Encoding remain
rejected. The separate canonical-UInt64 parser used by signed Result fields
remains canonical.

The shared response-forwarding parser keeps `raw_response_bytes` separate from
the transfer-decoded body. For chunked forwarding it removes
`Transfer-Encoding`/`Trailer` and inserts Content-Length for the decoded body.
The TLSN transcript and response digest use the original raw wire bytes; the
Worker verifier reads those authenticated transcript bytes from the
Presentation. The local WASM-wrapper test checks both the raw response digest
and exact serialized Presentation hash.

### Telemetry timing review

| Metric | Measurement boundary |
|---|---|
| Origin TCP connect | Origin `TcpStream::connect` |
| Notary TCP connect | Separate Notary `TcpStream::connect` interval |
| Origin TLS handshake | Prover Origin TLS `connect` |
| Request write | `write_all` plus `flush`, timed after request validation |
| Response read | Framed reads; response parsing/normalization is outside the interval |
| Transcript proof | `prover.prove` only |
| Notary attestation | Serialized request write through response read, deserialize and validation; TCP connect is separate |
| Presentation serialization/handoff | Presentation build/serialization through one-use handoff publication |
| Worker verification and signed Result response | End-to-end `verifier.verify` future, including Worker processing, returned signature verification and polling if queued |
| Worker Result signing | Worker `result_signing` diagnostic interval; recorded only when Worker benchmark timings are enabled |
| APP Result finalization/delivery | APP Result boundary after Worker signing; local candidate capture and filesystem delivery, not a local signature operation |

The outer proof timer is labelled as an overall proof-pipeline duration.
Metrics contain sizes, status, framing and elapsed time only; request/response
bodies, binding, session token, authentication material, keys and proof secrets
are not logged. Deadlines, cleanup, single-use state and no-retry behavior are
unchanged.

### Current local validation and evidence status

| Check | Result | Scope |
|---|---|---|
| Shared HTTP parser `cargo test --manifest-path packages/authenticity/authenticity-core/Cargo.toml --locked --offline` | **5 passed, 0 failed; exit 0** | Exercises HTTP Content-Length OWS, leading zeros, invalid bytes and overflow. |
| Verifier `cargo test --manifest-path packages/FUSOU-TLSN-VERIFIER/Cargo.toml --locked --offline --lib` | **139 passed, 0 failed, 0 ignored; exit 0** | Includes parser/transport boundary tests and a local TLSN loopback Presentation through the complete WASM wrapper logic. Synthetic test evidence only. |
| Verifier `cargo check --manifest-path packages/FUSOU-TLSN-VERIFIER/Cargo.toml --locked --offline --target wasm32-unknown-unknown --lib` | **exit 0**, one pre-existing `unused_mut` warning in finalization | Compiles the WASM target including `wasm.rs`; no packaged Worker artifact was generated. |
| Worker `pnpm exec tsc --noEmit --pretty false` | **exit 0** | Typecheck only; no Worker source API changed. |
| APP pre-capture/acceptance and APP handoff/Worker reference/endpoint-mapping Node suites | **46 passed, 0 failed; exit 0** | Synthetic/in-memory contract tests, not service connectivity or deployment validation. |
| `node --check` on the changed Worker handoff files | **exit 0** | Syntax only. |
| Rust formatting and scoped `git diff --check` | **exit 0** | Does not typecheck Proxy/APP crates. |
| Proxy `proxy-https` Cargo tests/check and APP Cargo tests | **NOT_RUN** | Their Cargo dependency graph embeds local configuration. They were not run to avoid a build/test path accessing protected local settings; Proxy wrapper call sites therefore lack full Cargo typecheck coverage here. |
| Hosted run [#89](https://github.com/tsukasa-u/FUSOU/actions/runs/41067098329) | **success** on baseline e7c0676: `node-contract-tests`, `rust-tlsn-preflight` | It built and provenance-checked the Worker WASM but had no Proxy crate check/test. It does not validate this local follow-up. |

No new Hosted CI run, Worker WASM artifact rebuild, service deployment, real
Notary session, Game Server connection or real Presentation/Result verification
was performed.
The commit-bound Worker `build-wasm.mjs` was not run because this follow-up is
uncommitted and the script requires a clean source SHA; no build gate was
bypassed. The wasm32 Cargo check and native WASM-wrapper test are the local
WASM-source validations reported above.

**Stage A code status:** the complete-profile source path and chunked parser
passed local synthetic/loopback verification; Proxy/APP crate typecheck remains
`NOT_CHECKED`. The APP's independent protocol-only signed Result path remains
`BLOCKED_CODE` because the existing Result service is identity-bound.
**External status:** Runtime Config pins, selected canonical target, Notary,
Worker deployment and signer registry remain `BLOCKED_EXTERNAL_INPUTS` /
`NOT_CHECKED`. Production acceptance and real-game testplay readiness remain
**BLOCKED**.

## Runtime Config Bootstrap trust boundary

The APP has exactly three TLSN Runtime Config `option_env!` inputs:

- `FUSOU_TLSN_RUNTIME_CONFIG_MANIFEST_URL`
- `FUSOU_TLSN_RUNTIME_CONFIG_SIGNER_KEY_ID`
- `FUSOU_TLSN_RUNTIME_CONFIG_SIGNER_PUBLIC_KEY_SPKI`

They are public Bootstrap data, not secrets. The URL is restricted to the
canonical HTTPS DNS endpoint `/tlsn/runtime-config/v2/manifest.json`; the
signer ID and canonical Ed25519 SPKI are validated. All three absent produces
`UNREGISTERED`; a partial set is rejected; a valid set reports
`EMBEDDED_UNVERIFIED`. The compiled APP report exposes those public values for
release comparison and never marks them as an independently approved trust
authority. The APP build handoff no longer passes Worker deployment inputs,
Notary keys, authority keys or Result Registry inputs into the APP build.

The Bootstrap key authenticates only the Runtime Config Manifest V2 envelope:
scope `fusou-tlsn-runtime-config-signing-root-v2`, Ed25519, and the
domain-separated `FUSOU-TLSN-RUNTIME-CONFIG-MANIFEST-V2` signing bytes. The
Manifest payload has a strict V2 schema and canonical envelope/payload
encoding, time bounds, epoch policy, digest-pinned Worker reference and
authority artifacts, plus the 15 Worker `compile_inputs`. The Manifest has no
field that can replace the APP's embedded Manifest signer. Its signer can
change signed operational values for the APP, including the APP-side Result
Registry root pin; that pin is a distinct Result Registry key/scope, but its
replacement is transitively authorized by the Manifest signer for APP-side
checks.

The Manifest signer can also change the APP-side Notary endpoint/verifying-key
inputs in its signed payload. The Worker selects its Notary key from its own
`TLSN_PRODUCTION_NOTARY_REGISTRY` and `TLSN_CANDIDATE_NOTARY_KEY_ID` bindings
and verifies the Presentation against that key. This repository does not add a
separate cryptographic Notary-registry root; the Worker deployment/control
plane is the trust source for those bindings.

The Worker does not consume APP Bootstrap values, APP worker-identity claims,
or APP-supplied inventory/result-root assertions as trust roots. It reads
Notary, Origin Inventory, Target Approval, and Result Registry inputs from its
own bindings/shipped artifacts. The APP's selected target and origin transport
policy now come from the verified Manifest Inventory/Target Approval rather
than a second APP-shipped inventory. Production Worker verification derives
the server identity from the actual Presentation and matches it against the
Worker's own Inventory and Approval. The Worker now verifies the Result Registry envelope,
exact registry bytes, root key ID/SPKI and Ed25519 signature from Worker-owned
bindings before production configuration is accepted. An APP preflight report
labels the Manifest digest/epoch as locally verified but keeps
`authority_status=UNVERIFIED`; a modified APP can alter that report or its
Bootstrap checks.

The APP's persisted epoch is an atomic local high-water mark and only an
auxiliary rollback defense. It is not a server freshness authority and is
modifiable with the client. The publisher now checks the signed current R2
manifest pointer, enforces nondecreasing exact-epoch bytes/strict advancement
and uses conditional CAS. The Manifest object uses `no-store`. Independent
recovery authority after loss of the server pointer is not registered, so
Production publishing remains blocked rather than trusting a client-local
epoch.

Runtime Config signer rotation, overlap and online revocation are not
implemented. The current APP accepts one embedded signer. Replacing it
requires an independently approved APP release with new Bootstrap pins; old
APP binaries do not automatically learn the new key or reject the old key.
A future overlap/online rotation requires a versioned schema and an explicitly
reviewed Bootstrap-root-signed signer registry or equivalent migration; no
new root hierarchy is introduced here.

The repository's Production signing registration still reports
`NOT_CONFIGURED` / `NOT_REGISTERED` for the signer provider, independent pin,
APP Bootstrap root and Manifest endpoint. No Production URL/key was supplied
or invented for this work, and no signer, R2 write, Worker deployment,
Notary session or Game Server connection was attempted.

### Local validation for this Bootstrap change

| Check | Result | Scope |
|---|---|---|
| Targeted APP/Worker Runtime Config and handoff Node suites (`node --test --test-reporter=tap` over the Bootstrap trust, Manifest/publisher, APP handoff/dotenvx, Worker reference/endpoint and APP pre-capture tests) | **92 passed, 0 failed, 0 skipped** | Synthetic public keys, fixtures and in-memory object store; no external service. |
| Worker device-proof and release-source/integration suites (`node --experimental-strip-types --test`) | **64 passed, 0 failed, 0 skipped** | Source closure and mocked release/client contracts; no deployment or Cloudflare API operation. |
| Worker TypeScript `pnpm --dir packages/FUSOU-TLSN-VERIFICATION-WORKER run typecheck` | **PASS** | Includes Worker-owned Result Registry root/envelope verification. |
| `node --check` on changed JavaScript/MJS files | **PASS** | Syntax only. |
| `rustfmt --check` on changed Rust sources excluding `packages/configs/src/configs.rs` and `packages/FUSOU-APP/src-tauri/src/main.rs` | **PASS** | A full-file check reports pre-existing formatting differences outside this task's hunks in those two files; no APP typecheck was run. |
| Full APP/config Cargo tests/build | **NOT_RUN** | The dependency graph can compile embedded local configuration; protected local configuration was not opened or used for validation. |
| Hosted CI for this change | **NOT_CHECKED** | No push or workflow run. |

These are source/unit checks only. Bootstrap registration, Production signing,
Manifest publication, Worker binding values, external freshness/recovery
authority, and all live acceptance stages remain `BLOCKED_EXTERNAL_INPUTS` or
`NOT_CHECKED`; no readiness state is promoted by the local passes above.
