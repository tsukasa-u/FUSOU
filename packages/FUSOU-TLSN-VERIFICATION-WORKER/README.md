# FUSOU TLSNotary Verification Worker

This Worker is the authoritative authentication, binding, evidence-verification, signing, and result-delivery boundary for FUSOU TLSNotary alpha.15 `require_info` Presentations. In production, the `fusou-tlsn-trigger` Trigger.dev task performs the first verification pass, but the Worker independently re-fetches the stored Presentation and runs the profile-specific WASM verifier again before it signs or commits a Result. The Trigger callback is metadata-only; its HMAC authenticates the callback transport and does not authorize any Result fields.

The Worker issues a one-shot, authenticated Session/Binding context at `/attestation/session`. Session issuance requires the existing FUSOU device proof (`device_id`, the HMAC challenge nonce, and the Ed25519 signature over that nonce). Every Session also receives a fresh 32-byte TLSN device challenge. `/verify/tlsn` requires `presentation_base64`, `session_id`, `device_id`, `binding`, and `device_proof` (`challenge`, `sig`); the signature covers the current device, Session, binding, and challenge context. Rust/WASM verifies the Presentation and derives `verified_member_id` from authenticated response bytes. Client-provided member IDs are not accepted. Synthetic wire data is never treated as verified. `/verify/tlsn` emits the complete-disclosure Result profile. `/verify/tlsn/sparse` is a separate sparse profile endpoint, requires `TLSN_SPARSE_PROFILE_SHA256`, uses a separate Result signing domain, and carries the explicit sparse profile through Trigger mode.

In production, both attestation endpoints require `Authorization: Bearer <Supabase access token>`. The Worker resolves the token through Supabase `/auth/v1/user`, uses the returned `auth.users.id` as the canonical user subject, rejects anonymous users, and never stores the raw token. For session issuance it forwards that bearer token and the existing device proof to the configured FUSOU-WEB generic device-proof endpoint. During verification it forwards the bearer token and TLSN-specific proof context to the dedicated `/api/auth/anonymous-sync/v2/tlsn-device-proof` endpoint. FUSOU-WEB remains the device-auth authority: both paths use `user_devices` owner and `revoked_at`; the TLSN path verifies Ed25519 over the canonical proof message and atomically consumes its SHA-256 digest through the existing nonce table. The Worker stores only the backend-derived device ID and TLSN challenge in the Durable Object. The canonical user ID, device ID, and device challenge are included in the signed verifier-result bytes. A binding issued to one user/device cannot be looked up or consumed under another user/device context.

Test deployments may opt into a self-contained test-only path by setting `TLSN_TEST_AUTH_USERS`, `TLSN_TEST_DEVICE_ID`, and `TLSN_TEST_DEVICE_PUBLIC_KEY`. The bearer token then maps to a synthetic non-anonymous user in the Worker, and both device proofs are verified with the configured Ed25519 public key. This path is available only when `TLSN_ENVIRONMENT=test`; it does not contact Supabase or FUSOU-WEB and is never accepted by production configuration validation.

The Worker does not own a TLSN device registry, receive a Supabase service-role key, or receive a device private key. A client-supplied `device_id` is only a selector/proof input; the authoritative device identity comes from the FUSOU-WEB verification response and the Durable Object record. The generic device proof and TLSN proof are separate one-shot proofs and cannot be reused across Sessions or bindings.

Completion replay has a separate availability boundary. A Trigger callback is accepted only as metadata, after HMAC and schema validation. The Durable Object atomically moves a job from `processing` to `verifying` and assigns a short-lived verification attempt lease before the Worker reads R2 or invokes WASM. Only that lease owner may verify, sign, and commit a Result; concurrent duplicates receive `202` with `status: processing` and do not start another verifier. A lease-expired or failed owner returns the job to `processing`, allowing a later callback or retry to recover. A stale owner cannot commit a newer attempt. The Result bytes, exact SHA-256, consumed status, attempt identifiers, and binding metadata are committed together in one Durable Object transaction.

The authoritative Result is the exact serialized final JSON response body: the signed inner Result, result signer identity, consume receipt, and device replay digest are all included. The Canary Verifier execution receipt is detached; it signs the SHA-256 of those exact response bytes and is stored under a separate Durable Object key, returned as `X-FUSOU-TLSN-Verifier-Execution-Receipt`, and never embedded in the body it hashes. Status, direct replay, and callback replay preserve the exact body bytes and attach the detached receipt separately. Before the DO transaction commits, the Worker writes the Result to R2, reads it back, checks exact byte length and SHA-256, and deletes the attempt object if verification fails. The Durable Object then commits the Result bytes, digest, consumed status, attempt identifiers, binding metadata, and detached receipt atomically. R2 is therefore a required verified pre-commit archive for this path, not authority; a later DO failure may leave an orphan attempt-specific R2 object, which cannot authorize a Result. Result bytes are limited to slightly less than 2 MiB per Durable Object storage entry because the storage key consumes part of the platform's 2 MiB value budget; oversized Results fail closed before commit.

### Offline existing-proof adapter

`scripts/canary-operational-smoke-existing-proofs.mjs` verifies the supplied proof bundle without changing operational smoke or readiness. Its schema-v2 `PASS` means `proof_bundle_status: PASS_LIMITED` only: signed Session/Consume receipt claims and time bounds; the generic Ed25519 signature over the exact UTF-8 nonce; the domain-separated TLSN device-possession signature and replay digest; complete and sparse inner Result signatures under a root-pinned Result registry envelope; the signed Verifier execution receipt and its exact Presentation/outer-Result byte hashes; alpha.15 Presentation verification under the supplied Notary/trust inputs; and separate Result/Presentation/Session field comparisons. `operational_smoke_effect`, `readiness_effect`, and `gameplay_effect` are always `NONE`.

The adapter does not independently establish FUSOU-WEB device ownership/revocation or public-key provenance, generic challenge HMAC validity/freshness/replay state, Session/Binding signer-key provenance, Notary registry provenance, deployment-manifest authenticity or artifact provenance, or Result signer-to-deployment association. `deviceIdentity.authoritative`/`authority`/`revoked_at`, `deviceAuthentication.worker_acceptance`, and manifest artifact names/labels are captured self-report/metadata, not signed proofs. The caller-supplied Runtime Attestation is not signature-verified again by this adapter; its asserted identity is cross-bound to the Verifier receipt. Semantic consistency is field equality, not a cryptographic proof. Callback, Trigger, DO, R2, and Auth remain blocked, and `HUMAN_GAMEPLAY_GATE` remains `BLOCKED`.

The synthetic regression is available as `pnpm run test:canary-existing-proofs-offline` and is included in `pnpm run test:canary-operational-smoke`. It generates local synthetic authority keys; it does not contact external services or exercise alpha.15 WASM verification. The inspected sparse crypto fixture was generated by `synthetic_tlsn_fixture` from a real API body with HTTP/TLS framing reconstructed locally, so `NON_SYNTHETIC_ALPHA15_PROOF_BUNDLE=UNAVAILABLE`; full proof-bundle verification is not claimed as PASS.

The APP TLSN Session provider now obtains the generic device-auth challenge through the existing `fusou-auth` endpoint client, validates its lowercase SHA-256 hex shape, and signs the nonce's UTF-8 bytes. TLSN possession remains a separate Worker-issued 32-byte challenge bound to the Session and binding. This fixes the caller protocol mismatch; the offline adapter still reports challenge freshness and replay state as `UNVERIFIED`.

### Human test-play candidate capture

Before considering any human candidate session, prepare a private copy of
`scripts/human-gameplay-preflight.template.json` and run the static contract:

```sh
pnpm --dir packages/FUSOU-TLSN-VERIFICATION-WORKER preflight:human-gameplay -- /absolute/private/human-gameplay-preflight.json
```

The template intentionally contains no production values. Its predicate groups
cover the Main Worker and Dedicated Verifier identities/runtime IDs, verifier
registry, FUSOU-NOTARY endpoint/key/registry, Origin Web PKI validation,
Session/Binding/Result authorities, workflow/profile/artifact identity, Runtime Attestation, local Auth
session and registered device key, server-side device ownership, candidate
configuration binding, human-operation assertions, capture provenance, WASM
build/artifact binding, Windows compile/runtime, and finalizer effects. Use the
active `TLSN_CANARY_DEPLOYMENT_MANIFEST` contract; External Package v2 remains
historical and is not an active gate.

Each candidate bundle verifies one observed server identity. A representative
natural-play capture is not coverage of the 20-target candidate inventory; do
not infer verification of other targets from it.

For `PASS` or `PASS_LIMITED` operator claims, supply an evidence reference and
SHA-256. The validator checks the package shape and digest format only; it does
not load those references, authenticate their issuer, or independently verify
authority provenance. Its output labels all such fields
`operator_asserted_*`, and `independent_authority_verification` stays
`UNVERIFIED`. Do not place tokens, private keys, cookies, or other credentials
in the package. Local session/device fields are presence assertions only; the
device ID must be UUID v4, while server ownership/revocation remains
`UNVERIFIED`.

The command is static: it makes no network requests and starts no game. A
structurally complete report may say `preflight_status: PASS_LIMITED`, but
`readiness_status` and `gameplay_authorization` remain `BLOCKED`. In particular,
candidate-to-compiled-configuration binding and
`result_signer_deployment_binding` remain `UNVERIFIED`; the validator rejects
attempts to mark them passed. `CANARY_RUNTIME_IDENTITY_VERIFIED` is limited to
runtime identity and cannot authorize callback, Trigger, DO, R2, Notary, Auth,
Presentation smoke, or gameplay. Pre-capture human-operation claims are not
proof of no injection/replay/automation, and `production-proxy-capture` alone
does not establish human-play provenance. Exact Presentation verification is
a separate post-capture predicate. `NON_SYNTHETIC_ALPHA15_PROOF_BUNDLE` remains
`UNAVAILABLE`; a synthetic positive test is not a gameplay prerequisite.

The APP public configuration fingerprint uses the shared schema-v2 contract in
`scripts/app-configuration-fingerprint-contract-v2.json`. It fixes the scope,
compile-time/runtime field inventories, canonical JSON encoding, projection
hash preimages, and combined hash preimage. Rust APP preflight and Node
candidate verification share a golden test vector. Candidate metadata carries
the compile-time and runtime projection digests; the verifier validates their
canonical SHA-256 encodings and recomputes `combined_sha256` from both digests.
The raw configuration values are intentionally not included, so this does not
recompute either projection from a supplied running configuration or
independently authenticate the APP binary.

Candidate artifact identity schema v2 separately binds `request_sha256` and
`authenticated_request_sha256`, as well as request/session/binding IDs, capture
time, the APP combined fingerprint, and exact Presentation/metadata bytes. The
finalizer reports this as `LOCAL_CONSISTENCY`; it is not independent
authentication. A locally consistent synthetic bundle remains synthetic and
cannot affect readiness or gameplay.

Readiness and human preflight may locally load a candidate bundle through
`TLSN_CANDIDATE_ARTIFACT_BUNDLE_PATH`. Optional schema-v1 files are accepted at
`TLSN_APPROVED_EXPECTED_CONFIGURATION_FINGERPRINT_PATH`,
`TLSN_CURRENT_BINARY_IDENTITY_PATH`,
`TLSN_TRUSTED_BUILDER_PROVENANCE_PATH`, and
`TLSN_INDEPENDENT_AUTHORITY_RECEIPT_PATH`; exact fields are defined in
`scripts/candidate-configuration-provenance-contract-v1.json`. The contracts
bind approval to a candidate/capture, builder evidence to candidate/artifact
identity and binary hash/source commit/workflow/toolchain/builder, and authority receipts to the
candidate fingerprint, binary, deployment, and capture/session/request/binding
identity. Declared signature key IDs must match their declared authority or
builder signing key; this is only an internal consistency check. Current code
only validates shape, freshness, and cross-binding.
Approval, builder, and independent authority signature verifiers/trust roots
are not implemented, so presence or a matching digest is never `PASS` and
`candidate_configuration_binding` remains `UNVERIFIED` with its readiness gate
`BLOCKED`.

`WASM_BUILD_NETWORK` from the current offline wrapper proves only that build
subprocess; old untraced builds remain `UNKNOWN`, and WASM artifact/source/commit
binding is separate. Windows GNU cross-compilation and Windows runtime are
distinct predicates.

The offline contract matrix is `pnpm --dir
packages/FUSOU-TLSN-VERIFICATION-WORKER test:human-gameplay-preflight`. Its
positive case uses test-only declarations and still asserts blocked readiness
and gameplay. This report is not a candidate-launch authorization or a
replacement for `pnpm run test:canary-readiness`.

The APP launcher supports an explicit local candidate-capture mode. Use an empty, owner-private absolute directory outside the checkout:

```sh
pnpm --dir packages/FUSOU-APP testplay:verify -- --tlsn-candidate /absolute/private/empty-directory
```

This temporarily enables the TLSN production feature and `proxy.tlsn.candidate_capture_enabled`, keeps raw natural-traffic capture under `natural/`, and stores TLSN artifacts under `tlsn/`. The launcher restores the original APP config when Tauri exits. It requires an existing valid FUSOU Auth session and complete local TLSN deployment configuration. Candidate mode sets `app.auth.deny_auth=false` only in the temporary config so the TLSN provider can use the saved session; it separately disables anonymous Auth bootstrap and pending upload retries. The launcher does not obtain, refresh, or store credentials. If there is no usable saved session or registered device key, capture fails before requesting the Web-issued challenge. Only ordinary gameplay through FUSOU-APP is allowed; do not inject, replay, automate, retry, or send standalone requests.

Candidate startup uses the local JST calendar date and a fixed `tlsn-candidate` filename prefix instead of fetching the period tag or resolving an upload dataset ID. Normal APP launch behavior is unchanged. This avoids unrelated period-tag and dataset/Auth lookups before the user explicitly starts a future candidate capture.

After the human session, select the Presentation subdirectory containing `candidate-manifest.json` and run the local-only finalizer with an independently prepared JSON trust context:

```sh
pnpm --dir packages/FUSOU-TLSN-VERIFICATION-WORKER tlsn:candidate:finalize -- --bundle /absolute/private/empty-directory/tlsn/PRESENTATION_ID --trust-context /absolute/private/offline-trust-context.json
```

The trust context supplies the verifier identity registry, trusted runtime identity, expected job and attempt IDs, Session/Binding/Result authority inputs, deployment manifest, profile digest, Notary registry, and trust-anchor DER; it must not contain private keys or runtime tokens. The `deploymentManifest.target` may be omitted when discovering an unknown target. The finalizer checks every captured file against the candidate manifest, requires the exact Worker response bytes and detached execution receipt, and invokes `verifyCanaryExistingSourceProofBundle` without network access. It first cryptographically inspects the exact alpha.15 Presentation bytes under the selected Notary key and trust anchor, then derives `server_identity`, `tlsn_attestation_id`, and the Notary key fingerprint from that verified Presentation. If a target identity is declared in the manifest, it must match; manifest, Host, and capture metadata are never used as the observed identity. Full profile/Notary semantic verification remains a separate stage after identity extraction.

The candidate directory and each artifact are checked as private filesystem objects. On Unix, the finalizer opens the root with `O_DIRECTORY|O_NOFOLLOW`, records its device/inode identity, and revalidates the pathname against the open directory handle around inventory enumeration, artifact reads, and output creation; artifact files are opened with `O_NOFOLLOW` and checked with `fstat`. This is a race detector and a symlink defense, not a complete descriptor-relative tree walk: Node's path-based `readdir` and file opens leave a same-user directory replacement window between checks. The offline verifier must therefore run under the same-user, owner-private candidate assumption; hostile concurrent processes under that same UID are outside this guarantee. On Windows, the current finalizer performs path/file type and metadata checks but does not have equivalent directory-handle identity pinning; its Windows runtime behavior was not exercised in this audit. Separately, the APP recovery Rust code passed an offline `x86_64-pc-windows-gnu` cross-target check, but no Windows runtime test was available. `candidate-finalization.json` is create-only and never overwrites an existing file; only a private regular finalization file is permitted as an optional inventory entry on a later run.

The repository's `pnpm run test:tlsn-candidate-finalize` includes a fully synthetic positive test. It generates an alpha.15 Presentation using `SyntheticAlpha15OriginTransport`, then runs the real WASM inspection, signed proof verifiers, offline existing-proof adapter, and candidate finalizer. It asserts `proof_bundle_status: PASS_LIMITED`, `status: OBSERVED_UNAPPROVED`, `approval_status: UNAPPROVED`, and no readiness/gameplay effects. This proves the local verifier/finalizer route only; it is explicitly marked `synthetic_fixture: true` and is not human-play, production, or non-synthetic alpha.15 evidence. The fixture also rejects a mutated Presentation, a declared-target mismatch, and a changed exact outer Result body even when its candidate manifest is updated to match that mutation.

Before a future human capture, complete the `READY_FOR_HUMAN_CANDIDATE_CAPTURE` checklist without treating it as approval or gameplay authorization:

- Build the APP and Proxy with the intended production TLSN feature and verify the pinned Worker, Session Authority, Notary, profile, trust-anchor, and Result signer public configuration locally.
- Confirm an existing Auth session can be read/refreshed through the APP's normal session manager and that the registered local device key maps to the expected device; no candidate-mode anonymous bootstrap is allowed.
- Confirm the candidate output root is empty, absolute, outside the repository, owner-private, and contains separate `natural/` and `tlsn/` directories.
- Confirm the Worker and Notary endpoints/configuration are the intended deployment identities before launching; this task's local tests do not establish their current availability or provenance.
- Review the ordinary-gameplay-only instruction and ensure there is no request injection, standalone request, replay, retry, traffic automation, or test harness attached.
- Confirm the verifier receipt header/body byte preservation, offline finalizer trust context, and output no-overwrite behavior using local tests.
- After capture, independently validate the full candidate and review all `UNVERIFIED`/self-reported fields. Keep target approval separate and manual.

The checklist does not make target identity approved and does not clear `HUMAN_GAMEPLAY_GATE`. A human capture, operational smoke, callback/Trigger/DO/R2/Auth provenance, device ownership/revocation, generic nonce freshness/replay state, and production authority provenance remain separate gates. Until independently completed, report `HUMAN_GAMEPLAY_GATE=BLOCKED`, readiness as `BLOCKED`, and `NON_SYNTHETIC_ALPHA15_PROOF_BUNDLE=UNAVAILABLE` unless a genuine non-synthetic artifact is separately supplied and verified.

This candidate is not an Approved Target Identity, does not update an approval or readiness manifest, and has `readiness_effect: NONE` and `gameplay_effect: NONE`. Raw human-play provenance and FUSOU-WEB ownership/revocation are not cryptographically established by this package; those remain review inputs or `UNVERIFIED`. A candidate is not evidence that a human test-play has occurred until a real non-synthetic session is captured and independently reviewed.

The synchronous Canary response is still an explicit opt-in capability. In production it is dispatched through the dedicated Direct Verifier, which commits the exact authoritative body and detached execution receipt; the main Worker relays both body and receipt header unchanged. The inline synchronous implementation is test-only and cannot be selected in production. The opt-in response is therefore receipt-bound, but enabling synchronous delivery does not itself clear readiness.

This bounds active duplicate amplification per binding to one Worker verification at a time, but it is not a global denial-of-service control. The Worker does not currently provide a global callback rate limiter or a per-principal quota; an authenticated caller or holder of the callback secret can still consume request, Durable Object, R2, Trigger, and platform quota. Lease expiry, Trigger retries, and configured binding TTL remain operational limits. These controls protect false-Result authority and concurrent work ownership; they do not make an untrusted callback endpoint unlimited-resource safe.

The availability and security boundaries are intentionally separate:

- False-result security: callback metadata, callback-supplied Result fields, stale attempts, and unbound R2 objects cannot promote a Result; promotion requires fresh WASM verification plus an atomic Durable Object Result commit.
- Per-binding availability: one active verification lease bounds duplicate callback work for one binding. A lease expiry permits one later owner to recover the binding.
- Lease and fencing: attempt IDs, job IDs, lease expiry, and exact attempt Result keys fence late owners. The binding expiry always wins over lease recovery.
- Global availability: there is no global callback limiter, principal quota, or cross-binding verifier budget. N independent bindings may therefore run up to N verifiers, subject to Trigger and platform limits.
- Persistence safety: Result promotion is a bytes-plus-hash transaction in the Durable Object. R2 archival is best effort and never participates in authority.

Sparse semantic parsing uses an authenticated forward-only range reader. Parser reads must advance through disclosed ranges in ascending order; a gap where the parser needs HTTP framing, the `svdata=` prefix, a required JSON key/value, or a required delimiter is rejected. A gap at a non-required opaque JSON value is the explicit exception: the cursor skips that entire value span and continues at the next disclosed structural token. The reader is not a random-access API. The sparse cryptographic claim is an explicit semantic projection, not a claim over the JSON document as a whole. It covers the HTTP framing, exact `svdata=` prefix, and the disclosed JSON tokens needed to establish `api_result == 1` and `api_data.api_basic.api_member_id`. Opaque string, number, object, and array interiors are outside that claim scope and are not cryptographically authenticated. The planner may scan the origin bytes to locate valid token boundaries, but that local scan does not authenticate undisclosed bytes. Request/response transcript sizes remain signed metadata, so changing a total size without changing the disclosed bytes invalidates the Result.

The boundary invariant is local and explicit: a valid sparse plan discloses the opaque field key, its colon, and the surrounding JSON structure; it omits only the selected opaque value span. The cursor may skip a gap only while parsing a non-required value, and the next disclosed byte must still satisfy the enclosing object's or array's separator rule. Adversarial gaps that hide a string quote, comma, nested delimiter, required key, or required value are covered by Rust and Worker tests and are blocked when the disclosed continuation cannot satisfy that rule. The verifier cannot inspect or independently authenticate bytes inside an undisclosed span, nor can it prove from the gap alone that those bytes form exactly one JSON value. Therefore the issuance path must use the verifier-owned planner and its body-free `{kind,start,length}` range report as the disclosure schedule; a hidden-value mutation passing is evidence that those bytes are intentionally outside claim scope, not evidence about their contents or semantics. The report itself never contains response body bytes.

The sparse threat model treats the Prover as malicious: it may omit arbitrary ranges, choose an insufficient disclosure schedule, and mutate bytes inside undisclosed spans. The verifier does not accept a Prover- or client-supplied range report as semantic authority; it derives the authenticated ranges from the verified TLSN Presentation and rejects any missing required byte before returning `PASS`. The planner and its report are generation and audit aids only. TLSN authentication proves the disclosed bytes, the sparse parser proves the narrow required semantic projection, and the signed Result binds the verifier's output and range metadata; these are separate evidence layers. A passing hidden-value mutation therefore remains outside the claim and must never be interpreted as authentication of hidden content or proof that a hidden gap is exactly one opaque JSON value.

The Prover-compromise and Trigger-compromise properties are separate. Against a malicious Prover, forged TLSN bytes, missing required semantic bytes, and malicious disclosure schedules remain blocked by the Presentation verifier and sparse parser. Against a compromised Trigger process or leaked callback HMAC, the Worker does not trust `prepared_result` data because completion callbacks contain no Result fields. It authenticates the callback, looks up the one-shot job, loads the exact private R2 Presentation, checks its SHA-256 against the binding's stored `presentation_id`, re-runs the configured complete or sparse verifier, re-checks binding/profile fields in the fresh verifier output, and only then derives and signs the Result. A valid callback HMAC alone therefore cannot mint a false Result. The Result signing key means "the Worker independently verified this Presentation under this policy," not merely "the Worker received a callback."

In Trigger mode, `/verify/tlsn` authenticates and atomically claims the binding, stores the raw Presentation in the private `TLSN_PRESENTATIONS` R2 bucket, records its SHA-256 as `presentation_id`, and returns `202` with a job ID. Trigger fetches that object through `/internal/tlsn/verification-input` using the shared HMAC callback secret, performs its work, and sends only job/binding/profile/status metadata to `/internal/tlsn/verification-complete`. The Worker independently fetches and verifies the stored object before signing and committing the Result to the Durable Object, then deletes the raw input object. A verified final response identifies the result-signing key with top-level `signer_key_id` alongside `signature_algorithm`; the signed result remains nested under `result`. `/verify/tlsn/retry` re-enqueues an accepted job without replaying the device proof; each new completion callback causes fresh verification from the stored Presentation.

## Local development

Requirements:

- Rust toolchain `1.95.0`
- Rust target `wasm32-unknown-unknown`
- `wasm-pack`
- A wasm-capable Clang compiler for ring's C backend

Build and run the fail-closed smoke tests:

```sh
rustup target add wasm32-unknown-unknown --toolchain 1.95.0
RUSTUP_TOOLCHAIN=1.95.0 pnpm test
```

The build script discovers `clang`, `clang-18`, or `clang-17`. Set `CC_wasm32_unknown_unknown` when Clang is installed outside `PATH`.

The Worker `scripts/build-wasm.mjs` invocation forces `CARGO_NET_OFFLINE=true` and `RUSTUP_AUTO_INSTALL=0`, and calls wasm-pack with `--mode no-install`. Missing Cargo dependencies, wasm-bindgen, wasm-opt, Rust toolchain, or target must fail locally rather than trigger an install/download. A successful invocation prints `WASM_BUILD_NETWORK=VERIFIED_OFFLINE`; this predicate covers that build subprocess only. It does not cover checkout/GitHub Actions, `pnpm install`, prior provisioning of wasm-pack/cache contents, or prove the provenance of those tools. CI package-manager access remains an independent external-network step. Verification determinism for fixed Presentation bytes and trust inputs is a separate predicate and is not evidence of build network isolation. This build marker is not a readiness/gameplay input; if a build cannot produce it, treat the artifact's build-network provenance as `UNKNOWN` and rebuild through this offline path before relying on that artifact.

`pnpm test` runs Wrangler's local Worker runtime and checks device-proof session issuance plus verify-time TLSN possession through a synthetic FUSOU-WEB HTTP boundary, strict request validation, invalid/tampered Presentation rejection, user/device authority correlation, atomic single-use consumption including concurrent requests, expiry, identity and Notary fail-closed paths, and missing-configuration failure. FUSOU-WEB route tests cover the generic and TLSN device-auth primitives and reject revoked, invalid-signature, owner-mismatch, malformed-context, and replayed proofs. It does not contact the Game Server or Notary.

### Security-contract test inputs

The `TLSN Verification Worker Security Contracts` workflow is reproducible from a fresh FUSOU checkout, `pnpm install`, and the normal CI runtime. It has no external test-data repository dependency and does not contact the Game Server, FUSOU-NOTARY, Cloudflare, Supabase, R2, Trigger.dev, or a real TLSNotary session.

The fixture-only provisioning and deployment-manifest tests use the tracked `scripts/canary-fixture-only-data.mjs` module. Its bytes and metadata are deterministic synthetic placeholders: they are not a real TLSNotary Presentation, a real Game Server capture, a trust root, deployment authority, or benchmark measurement data. The fixture is used only to exercise structure, provenance, isolation, and fail-closed contracts; it must not be used as deployment material or evidence.

The real captured-fixture path remains separate. `scripts/tlsn-benchmark-fixtures.mjs`, `generate:sparse-real-fixtures`, real sparse benchmarks, production provisioning tests, and FUSOU-NOTARY material tests require locally supplied or ignored benchmark resources and are not dependencies of this workflow. Missing benchmark resources must remain a failure for those benchmark/provisioning commands rather than becoming a silent security-test skip.

### Offline sparse measurements

These commands are offline and use synthetic alpha.15 data. They are reproducible parser and signing-path measurements, not production evidence:

```sh
node scripts/sparse-parser-memory-benchmark.mjs
TLSN_SPARSE_CRYPTO_BENCHMARK_PADDING_BYTES=4096,16384,65536,262144,524288,1048576 pnpm run generate:sparse-fixtures
TLSN_SPARSE_CRYPTO_BENCHMARK_PADDING_BYTES=4096,16384,65536,262144,524288,1048576 node --expose-gc scripts/sparse-crypto-benchmark.mjs
pnpm run benchmark:sparse-scope
```

The repository-local `require_info` fixture corpus can be measured separately:

```sh
pnpm run stats:require-info-fixtures
```

That command inspected 373 request/response pairs across 16 epochs without
printing tokens or response bodies. Response fixture bodies were 144,022 to
165,752 bytes (P50 150,080, P95 165,258, P99 165,751); JSON bytes after the
`svdata=` prefix were 144,015 to 165,745 bytes. These are metadata-plus-API-body
fixtures, not HTTP transcripts: status lines, headers, TLS framing, and a proven
wire transcript boundary are absent, so HTTP transcript size is
`NOT_ESTABLISHED`. The 1 MiB and 32 MiB cases below remain synthetic stress
measurements; 32 MiB is not justified by this corpus.

The real-body alpha.15 path is separate from the synthetic stress matrix:

```sh
pnpm run generate:sparse-real-fixtures
pnpm run benchmark:sparse-real
pnpm run benchmark:sparse-real-regression
```

The generator selects deterministic `S@api_get_member@require_info` fixtures at
P50/P95/P99/max body size and records the source epoch, filename, body size, and
SHA-256 in the local machine-readable manifest. Rust removes only the fixture
metadata delimiter and sends the remaining bytes unchanged. The local origin
reconstructs `HTTP/1.1 200 OK`, `Content-Length`, and `Connection: close`; the
request still uses the existing empty-body synthetic serializer because the
sparse semantic contract rejects non-empty `require_info` request bodies. The
corpus therefore remains `requestTranscriptStatus: NOT_ESTABLISHED`, and these
measurements are not production wire evidence.

The real-body measurements below preserve the old run as a BEFORE baseline.
`prover peak RSS` is captured during alpha.15 `prover.prove`; verification and
signing are the WASM verifier child process.

BEFORE (longest-string heuristic): the 12-byte gap between the response
transcript and disclosed/committed response was the largest JSON string interior
that the sparse parser could skip. This left nearly the entire real response in
the cryptographic claim.

| Case | Body | Reconstructed response | Committed response | Disclosed | Disclosure ratio | Sparse Presentation | Generation | `prover.prove` | Prover peak RSS | WASM verify | Sign |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| P50 | 150,080 B | 150,142 B | 150,130 B | 150,130 B | 0.999920 | 151,904 B | 14,351.22 ms | 13,850.24 ms | 7,783,522,304 B | 21.06 ms | 24.92 ms |
| P95 | 165,258 B | 165,320 B | 165,308 B | 165,308 B | 0.999927 | 167,082 B | 16,246.35 ms | 15,741.47 ms | 8,059,215,872 B | 22.33 ms | 27.93 ms |
| P99 | 165,751 B | 165,813 B | 165,801 B | 165,801 B | 0.999928 | 167,575 B | 16,480.08 ms | 15,955.91 ms | 8,098,877,440 B | 22.99 ms | 26.91 ms |
| Max | 165,752 B | 165,814 B | 165,802 B | 165,802 B | 0.999928 | 167,575 B | 16,272.91 ms | 15,741.69 ms | 8,067,039,232 B | 22.48 ms | 26.70 ms |

AFTER (semantic range planner): synthetic and real paths use the same
verifier-owned planner. The response claim includes HTTP framing, the exact
`svdata=` prefix, and the disclosed JSON structure, keys, and values needed to
establish `api_result == 1`, the `api_data.api_basic` path, and the canonical
`api_member_id` value. It does not claim the JSON document as a whole. The
interiors of non-required opaque strings, numbers, objects, and arrays are
outside the claim scope; the sparse verifier skips those complete value spans
and does not cryptographically authenticate them. The planner's local syntax
scan is boundary discovery, not authentication of opaque bytes. The companion
range report exposes only kind, offset, and length for auditability and never
includes response body bytes. Ratios below are against the response body,
excluding the reconstructed HTTP headers; the range column is `count / largest
range`.

| Case | Body | Reconstructed response | Committed response | Committed body ratio | Disclosed response | Disclosed body ratio | Ranges | Sparse Presentation | Generation | `prover.prove` | Prover peak RSS | WASM verify | Sign |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| P50 | 150,080 B | 150,142 B | 324 B | 0.001746 | 324 B | 0.001746 | 12 / 102 B | 3,477 B | 209.49 ms | 66.67 ms | 200,712,192 B | 10.81 ms | 3.01 ms |
| P95 | 165,258 B | 165,320 B | 324 B | 0.001585 | 324 B | 0.001585 | 12 / 102 B | 3,479 B | 211.53 ms | 71.89 ms | 201,392,128 B | 11.01 ms | 2.90 ms |
| P99 | 165,751 B | 165,813 B | 324 B | 0.001581 | 324 B | 0.001581 | 12 / 102 B | 3,477 B | 204.71 ms | 65.49 ms | 196,603,904 B | 10.96 ms | 2.80 ms |
| Max | 165,752 B | 165,814 B | 324 B | 0.001581 | 324 B | 0.001581 | 12 / 102 B | 3,477 B | 218.01 ms | 75.00 ms | 211,972,096 B | 10.47 ms | 3.04 ms |

All four AFTER cases passed sparse cryptographic and semantic verification. Each
child rejected 8/8 signed Result mutations and 2/2 disclosed-range mutations.
The real-data regression kept a valid hidden response mutation with the same
disclosed bytes and member ID, while disclosed-header, member-ID, and
Presentation mutations were all `BLOCKED`; the hidden mutation also preserved
the disclosed response digest. The new scope is substantially smaller, but
alpha.15 still used about 197-212 MiB peak RSS for these real-body proving
runs. The reconstructed HTTP status, headers, and TLS framing remain local test
inputs, not production wire evidence.

On Linux with Node `v22.21.1`, the parser benchmark produced the following measurements. `additional.rssBytes` is the child-process RSS increase during parsing.

| Transcript | Sparse disclosed | Sparse ratio | Sparse parse | Sparse RSS | Materialized parse | Materialized RSS |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 MiB | 134 B | 0.0001277924 | 1.168753 ms | 61,440 B | 1.044763 ms | 2,113,536 B |
| 4 MiB | 134 B | 0.0000319481 | 1.315778 ms | 57,344 B | 3.834926 ms | 8,409,088 B |
| 8 MiB | 134 B | 0.0000159740 | 0.987403 ms | 36,864 B | 7.996145 ms | 16,793,600 B |
| 16 MiB | 135 B | 0.0000080466 | 1.285620 ms | 53,248 B | 17.224014 ms | 33,570,816 B |
| 32 MiB | 135 B | 0.0000040233 | 1.042368 ms | 57,344 B | 42.031784 ms | 67,125,248 B |

The sparse crypto benchmark forces sparse proof generation in the child Cargo
process and records committed bytes separately from disclosed bytes. The
required six-case matrix was measured offline with the semantic range planner:

| Padding | Response transcript | Committed/disclosed response | Ranges (largest) | Body ratio | Sparse Presentation | Fixture generation | `prover.prove` | Prover peak RSS | WASM verify | Sign | Status |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 4 KiB | 4,244 B | 146 / 146 B | 2 / 145 B | 0.020554 | 1,919 B | 202.21 ms | 46.20 ms | 154,406,912 B | 12.95 ms | 3.03 ms | PASS |
| 16 KiB | 16,533 B | 147 / 147 B | 2 / 146 B | 0.005221 | 1,921 B | 223.68 ms | 56.06 ms | 145,682,432 B | 12.45 ms | 2.74 ms | PASS |
| 64 KiB | 65,685 B | 147 / 147 B | 2 / 146 B | 0.001310 | 1,919 B | 185.59 ms | 45.01 ms | 162,619,392 B | 12.76 ms | 2.68 ms | PASS |
| 256 KiB | 262,294 B | 148 / 148 B | 2 / 147 B | 0.000328 | 1,921 B | 205.02 ms | 54.25 ms | 173,248,512 B | 10.99 ms | 2.49 ms | PASS |
| 512 KiB | 524,438 B | 148 / 148 B | 2 / 147 B | 0.000164 | 1,920 B | 203.15 ms | 10.05 ms | 167,067,648 B | 11.03 ms | 2.44 ms | PASS |
| 1 MiB | 1,048,727 B | 149 / 149 B | 2 / 148 B | 0.000082 | 1,922 B | 249.28 ms | 8.69 ms | 236,163,072 B | 10.79 ms | 2.43 ms | PASS |

The committed and disclosed response ranges are equal in sparse mode. Body
ratios exclude the reconstructed response headers; the request is committed and
disclosed separately. The sparse Result signature was independently verified
and rejected all 8/8 general mutations plus 2/2 disclosed-range mutations in
every child. The scope regression generated equal-length sparse responses with
different hidden interiors for string, number, object, and array values: both
Results remained valid for every kind, disclosed response bytes and their digest
stayed identical, and the verified member ID stayed `16189463`. Mutating
`response_transcript_size` was rejected by the signed Result contract. A 4 KiB
complete fixture passed complete verification with the same member ID;
full-Presentation/sparse-verifier and sparse-Presentation/full-verifier
cross-profile checks were both blocked.

The 4/8/16/32 MiB cases were not forced. Full Presentation memory remains `BLOCKED` because the sparse fixtures intentionally contain no full Presentation. These are synthetic/offline measurements, not production evidence.

### Worker E2E latency measurement

The full asynchronous Worker path can be measured with real-body sparse fixtures:

```sh
pnpm run benchmark:tlsn-e2e
```

The benchmark runs Wrangler `unstable_dev` with local R2 and Durable Object
storage, a local Trigger HTTP mock, and the actual Worker WASM verifier. The
mock returns the Trigger acceptance response before it performs input handoff,
first-pass WASM verification, and a metadata-only completion callback. The
benchmark then polls `/verify/tlsn/status` until the authoritative Result is
returned. It does not contact Trigger.dev, Cloudflare production services, the
Game Server, or the Notary.

The Direct path has a test-only synchronous candidate and a production canary
capability. Set `TLSN_TEST_DIRECT_SYNCHRONOUS_CANDIDATE=true` on a
non-production test Worker and run `node scripts/test.mjs --direct-only`. The
candidate commits the serialized Result bytes to the Durable Object, then
relays those exact bytes in the same `POST` response. The test compares them
with authenticated status recovery and checks that the first response performs
no Result R2 GET.

`POST /verify/tlsn` and `/verify/tlsn/sparse` negotiate the response contract
with `X-FUSOU-TLSN-Response-Mode: async|sync`. An omitted header and explicit
`async` are equivalent: the production default remains `202` plus status
polling. `sync` is accepted only by a canary Worker with
`TLSN_CANARY_SYNCHRONOUS_RESPONSE_ENABLED=true`, the canary Direct service
binding, and `TLSN_CANARY_DIRECT_CALLBACK_SECRET`; the Worker returns the
authoritative committed Result bytes as `200` and validates the complete final
Result schema before exposing them. A sync request that does not satisfy that
gate returns `503 sync_unavailable` and never falls back to async. The normal
production deployment has no Direct service binding and remains async-only.

Fresh Direct requests no longer perform a preliminary Durable Object binding
lookup. After device-possession authentication, the Worker sends the request
metadata, parsed binding nonce, and TLSN device challenge directly to the
authoritative `startVerification` transaction, reducing the ordinary synchronous
success path to `startVerification`, `acquireVerification`, and
`commitVerifiedResult`. A repeated synchronous Direct proof uses the dedicated
consumed-Result replay RPC, which validates replay metadata and returns the exact
Durable Object Result bytes without starting verification again.

To measure recovery when the initial synchronous `200` is lost at the client
boundary, enable the evidence-only benchmark mode with
`TLSN_REMOTE_DIRECT_RESPONSE_LOSS_RECOVERY=true`. The harness completes the
first request, discards that response as the simulated loss, then sends the
identical `POST /verify/tlsn/sparse` body again. It requires a `200`, exact
response byte and SHA-256 equality, `synchronous_replay_path=established`, one
direct invocation, one DO `commit_verified_result`, one DO `result_read`, one
optional `result_archive_put`, and zero Result R2 reads. The replay path never
invokes TLSN verification again and does not commit the binding again. Reports
contain only bounded sizes, hashes, timings, and diagnostics; they do not
contain access tokens, job IDs, trace IDs, proof signatures, or Result bodies.

Run the recovery evidence matrix against the dedicated non-production evidence
Worker only:

```sh
TLSN_REMOTE_EXPECTED_ENVIRONMENT=evidence \
TLSN_REMOTE_EXECUTION_MODE=direct \
TLSN_REMOTE_DIRECT_SYNCHRONOUS_CANDIDATE=true \
TLSN_REMOTE_DIRECT_RESPONSE_LOSS_RECOVERY=true \
TLSN_REMOTE_CONCURRENCY=1 TLSN_REMOTE_SAMPLE_COUNT=5 \
TLSN_REMOTE_BENCHMARK_REPORT_PATH=artifacts/tlsn-remote-recovery-c1.json \
pnpm run benchmark:tlsn-remote

TLSN_REMOTE_EXPECTED_ENVIRONMENT=evidence \
TLSN_REMOTE_EXECUTION_MODE=direct \
TLSN_REMOTE_DIRECT_SYNCHRONOUS_CANDIDATE=true \
TLSN_REMOTE_DIRECT_RESPONSE_LOSS_RECOVERY=true \
TLSN_REMOTE_CONCURRENCY=4 TLSN_REMOTE_SAMPLE_COUNT=20 \
TLSN_REMOTE_BENCHMARK_REPORT_PATH=artifacts/tlsn-remote-recovery-c4.json \
pnpm run benchmark:tlsn-remote

TLSN_REMOTE_EXPECTED_ENVIRONMENT=evidence \
TLSN_REMOTE_EXECUTION_MODE=direct \
TLSN_REMOTE_DIRECT_SYNCHRONOUS_CANDIDATE=true \
TLSN_REMOTE_DIRECT_RESPONSE_LOSS_RECOVERY=true \
TLSN_REMOTE_CONCURRENCY=8 TLSN_REMOTE_SAMPLE_COUNT=40 \
TLSN_REMOTE_BENCHMARK_REPORT_PATH=artifacts/tlsn-remote-recovery-c8.json \
pnpm run benchmark:tlsn-remote
```

The benchmark rejects this flag when the synchronous candidate is disabled.
For a controlled canary readiness run, additionally set
`TLSN_REMOTE_EXPECTED_ENVIRONMENT=production` and
`TLSN_REMOTE_PRODUCTION_SYNC_CANARY=true`; the harness then requires the
remote `/health` response to identify the canary deployment role before it
sends the sync header. This is a readiness measurement only and does not
change the production default.

The canary deploy wrapper bootstraps the canonical canary Worker without the
Direct binding, deploys the canonical canary verifier service, then redeploys
the canonical canary Worker with the binding. `TLSN_CANARY_WORKER_NAME` must
exactly match the repository-owned `fusou-tlsn-verification-canary` identity;
the generated verifier config uses that same canonical target, so the service
binding cannot be redirected to another Worker. To roll back the sync candidate, stop sending `sync`, disable
the canary capability flag, or deploy the previous canary inputs; the ordinary
production Worker is not changed by that rollback.

After the main Canary deploy, `deploy:canary` extracts Wrangler's deployed
Version ID and independently reads Cloudflare deployment and version metadata.
`TLSN_CANARY_DEPLOYMENT_ID` is the authorized logical FUSOU deployment identity,
not the opaque Cloudflare deployment UUID. Before deploy, the Canary Binding
Authority signs that logical ID, canonical Worker name, and checked-out Git
SHA into the Wrangler deployment message. The independently fetched platform
deployment and version metadata must carry the same valid binding, and the
deployment must contain the selected Version ID at 100 percent. It then
requests `<TLSN_CANARY_WORKER_INTERNAL_URL>/health` without following
redirects and compares the
platform deployment/version, runtime deployment identity, runtime Version ID,
runtime Git SHA, canonical Worker name, Canary role, and fixed binding mode.
Only a successful comparison writes the create-only artifact
`artifacts/tlsn-canary-deployment-runtime-attestation-<run>-<attempt>.json` and
prints `CANARY_RUNTIME_IDENTITY_VERIFIED`. This confirms only the main Worker's
platform/runtime identity; it does not authorize human gameplay. Set
`TLSN_CANARY_DEPLOYMENT_ATTESTATION_PATH` to choose an explicit artifact path;
an existing path is never overwritten. Fixture or synthetic deployments are
rejected and cannot produce this real readiness artifact.

The production canary readiness matrix is intentionally manual and requires
explicit approval for remote access:

```sh
TLSN_REMOTE_EXPECTED_ENVIRONMENT=production \
TLSN_REMOTE_EXECUTION_MODE=direct \
TLSN_REMOTE_DIRECT_SYNCHRONOUS_CANDIDATE=true \
TLSN_REMOTE_PRODUCTION_SYNC_CANARY=true \
TLSN_REMOTE_CONCURRENCY=1,2,4,8 TLSN_REMOTE_SAMPLE_COUNT=20 \
pnpm run benchmark:tlsn-remote
```

Do not run this matrix against the ordinary production Worker. It requires
the isolated canary URL, random bindings, the canary Direct verifier, and the
same authenticated remote benchmark inputs as the async measurement.

The opt-in timing header is emitted only when
`TLSN_BENCHMARK_TIMINGS=true` and the Worker is a test deployment or an
explicitly opted-in production canary. Its legacy local stages are:

- `T0` job accepted after request, authentication, Binding, and device-proof validation and before the Presentation R2 put.
- `T1` Presentation persisted to R2; `T2` Trigger request completed.
- `T3` callback HMAC/schema accepted; `T4` verification lease acquired.
- `T5` Worker Presentation R2 read completed; `T6` Worker WASM verification completed.
- `T7` Result signing completed; `T8` Result committed to the Durable Object; `T9` the commit path completed.
- `T10` authenticated status polling returned the verified Result.

The machine-readable timing header separates `do_operations` from
`r2_operations`. Result authority uses `start_verification`,
`acquire_verification`, `commit_verified_result`, and `result_read` under
`do_operations`. The only Result R2 operation is the optional asynchronous
`result_archive_put`; Result R2 reads are expected to remain zero. The archive
write is scheduled with `waitUntil()` after the DO transaction and is not part
of the client-visible authority path.

`Accept 202` is the client request duration through the queued response.
`Poll total` is the client-visible duration from that `202` response until the
final status response. `Accept 202 + Poll total` is the complete client-observed
latency used for target classification. `Queue`, `Worker WASM`, and `Finalize`
are derived from the stage timestamps. `E2E` is the internal `T0..T10` span; the
machine-readable JSON also contains client-latency samples, R2 operation counts,
per-isolate verifier concurrency, and all raw timestamps. RSS is the benchmark
harness process; Worker isolate RSS is `NOT_ESTABLISHED` because Wrangler does
not expose that boundary.

The target is informational: approximately 2-3 seconds for complete client
latency, not a correctness gate. Values below were measured on Linux with
Node `v22.21.1`; table values are per-row medians from the P50/P95/P99/max
real-body cases. `C=2` and `C=4` use independent local Worker instances so
each generated Presentation can retain its matching synthetic trust anchor;
the request still traverses the actual Worker/R2/DO/WASM path. They measure
effective concurrent Worker instances, while the telemetry reports the
per-isolate verifier concurrency separately.

| Case | Body | Presentation | C | Accept 202 | Poll total | Queue | Worker WASM | Finalize | E2E | Peak harness RSS | Result |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| P50 | 150,080 B | 3,477 B | 1 | 26 ms | 49 ms | 21 ms | 13 ms | 7 ms | 70 ms | 281.5 MB (+13.0 MB) | MEASURED WITHIN TARGET |
| P95 | 165,258 B | 3,478 B | 1 | 25 ms | 37 ms | 11 ms | 12 ms | 7 ms | 58 ms | 294.2 MB (+10.4 MB) | MEASURED WITHIN TARGET |
| P99 | 165,751 B | 3,476 B | 1 | 25 ms | 36 ms | 9 ms | 12 ms | 7 ms | 56 ms | 297.0 MB (+0.3 MB) | MEASURED WITHIN TARGET |
| Max | 165,752 B | 3,477 B | 1 | 24 ms | 35 ms | 9 ms | 11 ms | 7 ms | 54 ms | 299.7 MB (+0 MB) | MEASURED WITHIN TARGET |
| P50 | 150,080 B | 3,477 B | 2 | 35 ms | 41 ms | 13 ms | 12 ms | 9 ms | 71 ms | 308.3 MB (+0.1 MB) | MEASURED WITHIN TARGET |
| P95 | 165,258 B | 3,478 B | 2 | 36 ms | 42 ms | 13 ms | 12 ms | 9 ms | 73 ms | 314.1 MB (+0 MB) | MEASURED WITHIN TARGET |
| P99 | 165,751 B | 3,476 B | 2 | 31 ms | 40 ms | 11 ms | 12 ms | 9 ms | 67 ms | 320.1 MB (+0.1 MB) | MEASURED WITHIN TARGET |
| Max | 165,752 B | 3,477 B | 2 | 35 ms | 42 ms | 14 ms | 13 ms | 10 ms | 73 ms | 325.2 MB (+0 MB) | MEASURED WITHIN TARGET |
| P50 | 150,080 B | 3,477 B | 4 | 36 ms | 32 ms | 11 ms | 14 ms | 9 ms | 70 ms | 343.8 MB (+25.4 MB) | MEASURED WITHIN TARGET |
| P95 | 165,258 B | 3,478 B | 4 | 38 ms | 37 ms | 10 ms | 15 ms | 11 ms | 78 ms | 346.8 MB (+1.9 MB) | MEASURED WITHIN TARGET |
| P99 | 165,751 B | 3,476 B | 4 | 38 ms | 32 ms | 11 ms | 14 ms | 8 ms | 75 ms | 361.0 MB (+4 MB) | MEASURED WITHIN TARGET |
| Max | 165,752 B | 3,477 B | 4 | 37 ms | 48 ms | 16 ms | 15 ms | 9 ms | 80 ms | 360.8 MB (+2.3 MB) | MEASURED WITHIN TARGET |

These results establish the local path only. Trigger.dev scheduling latency,
Cloudflare production R2/DO latency, Worker isolate RSS, and production
concurrency behavior remain `NOT_ESTABLISHED`; a production-like deployment
measurement is still required before using this as an operational SLO.

Result authority has a hard storage boundary: the DO stores the exact final
response bytes under one storage key, with a maximum slightly below 2 MiB after
the `verification-result` key overhead is deducted. The full Result, including
the signed verifier payload and consume receipt, must fit this limit. R2
archive bytes may be larger only if the DO commit already fits; they are
operational copies and are never used by status or replay.

### Result storage scaling

Result byte growth can be measured without external access:

```sh
pnpm run benchmark:tlsn-result-storage
```

This benchmark uses a synthetic JSON Result and a local filesystem persistence
proxy. It reports `payload_bytes`, `signed_result_bytes`, archive-object bytes,
and `client_response_bytes`, plus Result construction/hash/write timings. Its
report is deliberately marked
`verification_semantics: NOT_TESTED`; it does not perform TLSN verification,
Durable Object commit/read, or remote R2 measurement. It must not be used to
infer that a Result larger than the DO limit is authoritative.

The current local three-repeat run measured these p50 values:

| Result object | Local write | Status read/hash/parse |
| ---: | ---: | ---: |
| 4 KiB | 0.09 ms | 0.22 ms |
| 64 KiB | 0.22 ms | 0.15 ms |
| 1 MiB | 0.66 ms | 2.04 ms |
| 4 MiB | 1.24 ms | 6.74 ms |
| 16 MiB | 3.59 ms | 34.04 ms |

These values are sizing evidence only. They indicate that large
`battle_data` Results need separate production R2 and status-response evidence;
they do not establish a production or canary latency gate.

### Production-like Worker E2E measurement

The production-like measurement has a separate entry point and must not be
confused with the local mock benchmark:

```sh
pnpm run benchmark:tlsn-remote
```

This command requires an already deployed test/staging Worker with real
Cloudflare R2 and Durable Object bindings, the real deployed Trigger.dev task,
and a random-binding configuration. A fixed canary binding is intentionally
rejected because each binding is one-shot and cannot provide a 20-sample
latency distribution. The Worker must have the opt-in public variable
`TLSN_BENCHMARK_TIMINGS=true`; normal production deployments do not enable this
telemetry.

In the default `supabase` mode, the benchmark reads all credentials and
device key material from the environment. It requires
`TLSN_REMOTE_BENCHMARK_WORKER_URL`, `TLSN_REMOTE_WEB_ORIGIN`,
`TLSN_REMOTE_SUPABASE_URL`, `TLSN_REMOTE_SUPABASE_PUBLISHABLE_KEY`,
`TLSN_REMOTE_ACCESS_TOKEN_A`, and `TLSN_REMOTE_DEVICE_ID_A`, plus either
`TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_FILE` or
`TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL`. In `test` mode, only the
deployed Worker URL, the generated test token/user map, test device ID/public
key, and generated PKCS#8 private key are needed; Supabase and FUSOU-WEB are
skipped. It does not store these values, print them, or include them in the
JSON report.

The real P50/P95/P99/max fixture sources and manifest above are reused. For
each sample, the benchmark issues a fresh remote Session, generates an
ephemeral sparse Presentation from the existing source fixture using that
Session's binding, and excludes fixture generation from T0-T11. Defaults are
20 samples per case/concurrency and `C=1,2,4,8`; use
`TLSN_REMOTE_SAMPLE_COUNT`, `TLSN_REMOTE_CASES`, and
`TLSN_REMOTE_CONCURRENCY` to change the matrix. The report is written to
`artifacts/tlsn-remote-benchmark.json` or
`TLSN_REMOTE_BENCHMARK_REPORT_PATH`.

The client records T0 at `/verify/tlsn/sparse` request start, T1 when the 202
response is received, and T11 when verified status is received. The Worker
telemetry records T2 after the Trigger API accepts the task, T4 at callback
receipt, T5 at lease acquisition, T6 after the Worker R2 read, T7 after WASM,
T8 after signing, T9 after Result persistence, T10 after Durable Object
consume, and T11 at the final status response. The Trigger task records T3 at
the first task-code instruction and sends it as authenticated callback
metadata. Trigger's platform scheduler timestamp is not exposed by the current
SDK and remains `NOT_ESTABLISHED`; T2-T3 is therefore reported as a
cross-clock wall-time observation, without clock-skew correction.

In the current Worker ordering, Trigger task acceptance completes before the
client receives 202. The report records the Worker-side 202-send timestamp
separately rather than pretending that T2 occurs after client T1. Client
visible latency is always measured directly as `T11 - T0` by the benchmark
process.

The formal decision is based only on remote client-visible samples: every
requested sample must have all required timestamps, and each row's P95, P99,
and Max must be at most 3 seconds. The only outcomes are
`MEASURED WITHIN TARGET`, `EXCEEDS TARGET`, and `NOT ESTABLISHED`. Until this
command has been run against a real deployed Worker and Trigger.dev task, the
production-like result is `NOT ESTABLISHED`; the local 54-80 ms result is not
used as evidence for the remote target.

The remote report separates these boundaries:

| Boundary | Status before remote run |
| --- | --- |
| Client-visible Worker-to-status latency | `NOT_ESTABLISHED` |
| Trigger task start and queue observation | `NOT_ESTABLISHED` |
| Cloudflare R2/DO path | `NOT_ESTABLISHED` |
| Worker isolate RSS | `NOT_ESTABLISHED` |
| Production scheduler timestamp | `NOT_ESTABLISHED` |

Remote timing records may also contain optional Result serialization,
Result-R2 PUT request/response, and synchronous-response phases. Older Worker
timing records remain valid because these phases are not required for the
legacy `timing_complete` decision. Setting
`TLSN_REMOTE_DIRECT_SYNCHRONOUS_CANDIDATE=true` makes the remote harness expect
an explicit Direct `POST 200` response. A latency-only report generated before
recovery validation may mark `status_recovery_measurement` as `NOT_MEASURED`;
the recovery-validation run uses test-only response headers to recover the same
job through the authenticated status endpoint and compares response bytes,
Result hash, and Result byte count. This option is restricted to `test` or
dedicated non-production `evidence` environments and must not be used as
production/canary evidence.

This benchmark adds timing metadata only. It does not change
`VERIFICATION_LEASE_MS`, retry semantics, Durable Object transitions, timeout
policy, verification failure semantics, Result signing, attempt fencing, or
authoritative Result pointer/hash rules.

### Remote benchmark setup

The repository provides a self-contained test credential generator and a
dotenvx-backed encrypted environment for the remote measurement. Set the
Trigger API key once; deploy and benchmark commands load it automatically:

```sh
cp packages/FUSOU-TLSN-VERIFICATION-WORKER/.env.example \
	packages/FUSOU-TLSN-VERIFICATION-WORKER/.env
pnpm run tlsn:benchmark:remote:setup
read -rsp 'Trigger API key: ' TLSN_TRIGGER_SECRET_KEY; echo
pnpm exec dotenvx set TLSN_TRIGGER_SECRET_KEY "$TLSN_TRIGGER_SECRET_KEY" \
	-f packages/FUSOU-TLSN-VERIFICATION-WORKER/.env \
	-fk packages/.env.keys
unset TLSN_TRIGGER_SECRET_KEY
pnpm run tlsn:deploy:test:self-contained
pnpm exec dotenvx set TLSN_WORKER_INTERNAL_URL \
	https://your-test-worker.example \
	-f packages/FUSOU-TLSN-VERIFICATION-WORKER/.env \
	-fk packages/.env.keys
pnpm exec dotenvx set TLSN_REMOTE_BENCHMARK_WORKER_URL \
	https://your-test-worker.example \
	-f packages/FUSOU-TLSN-VERIFICATION-WORKER/.env \
	-fk packages/.env.keys
pnpm run tlsn:trigger:deploy:self-contained
pnpm run tlsn:benchmark:remote:self-contained:preflight
pnpm run tlsn:benchmark:remote:self-contained
```

`tlsn:deploy:test` now forwards the sparse profile hash and benchmark timing
flag. Leave `TLSN_TEST_BINDING_VALUE` empty so the test Worker uses random
bindings; the benchmark rejects fixed bindings. The Trigger values must point
to the deployed `tlsn-verification` task and its callback secret must match the
Worker. `TLSN_REMOTE_BENCHMARK_WORKER_URL` is the HTTPS URL of the deployed
test Worker, usually the `workers.dev` URL printed by Wrangler.

`tlsn:benchmark:remote:setup` generates a UUID v4 synthetic user, a UUID v4
device, an Ed25519 keypair, and a random bearer token. It writes the test-only
values into `.env` using `packages/.env.keys`; the temporary plaintext source is
removed after encryption.
Only `TLSN_WORKER_INTERNAL_URL` and `TLSN_REMOTE_BENCHMARK_WORKER_URL` remain
deployment-specific because a Worker may use a custom domain instead of its
`workers.dev` URL. The preflight
validates the generated values and fixture paths without contacting any
service. It does not access the Game Server or replay a Game Server request;
the benchmark only submits existing sparse fixture-derived Presentations to
the deployed verification Worker.

The root-level commands load the encrypted Worker `.env` through dotenvx, so
remote credentials need not be exported in the shell. The preflight output
contains only origins, the device ID, fixture labels, and matrix settings. It
does not print tokens, private keys, or response bodies.

### Sparse prover allocation investigation

Root cause:

- Before the fix, sparse mode committed the hidden response padding as well as the disclosed prefix and suffix. Alpha.15 `prove_plaintext` computes `commit union reveal`, allocates that union in the MPC VM, and builds the AES/ciphertext circuit over every allocated byte. The packed sparse `PartialTranscript` and the verifier's compatibility materialization were not the source of the 20 GiB peak.
- The sparse path now commits only the response ranges that it reveals. Hidden padding remains undisclosed and is not represented as an authenticated claim in the sparse profile.

Affected phase:

- `prover.prove`, specifically plaintext allocation and ciphertext/keystream circuit construction.

Complexity:

- At the TLSN layer, memory and circuit work are `O(C + R)`, where `C` is the committed plaintext range length and `R` is the revealed range length. The alpha.15 MPC VM has a large per-byte constant, so committing a 1 MiB hidden range is not a memory-bounded sparse operation.

Before:

- 1 MiB -> 21,728,813,056 B peak RSS (about 20.24 GiB) / 384.92 s `prover.prove`.

After:

- 1 MiB -> 236,163,072 B peak RSS (about 225 MiB) / 8.69 ms `prover.prove` in the current matrix run.

Sparse cryptographic verification: `PASS` for the local synthetic 1 MiB case.

Sparse semantic verification: `PASS` in the local synthetic scope.

Sparse Result signing: `PASS`; 8/8 general signed-Result mutations and 2/2 disclosed-range mutations rejected.

Sparse claim scope regression: `PASS`; equal-length hidden response mutation remained valid while disclosed bytes, range metadata, and signed transcript sizes remained protected.

Full Presentation memory: `BLOCKED`; sparse fixtures intentionally do not contain a full Presentation.

Production evidence: `BLOCKED`; no Game Server, Notary, Worker, or Trigger execution was used.

### Manual test deployment

The test Worker can be deployed from a developer machine without GitHub Actions. Copy `.env.example` to `.env`, fill the test values, and encrypt it with the repository key:

```sh
cp packages/FUSOU-TLSN-VERIFICATION-WORKER/.env.example packages/FUSOU-TLSN-VERIFICATION-WORKER/.env
pnpm run tlsn:env.encrypt
pnpm run tlsn:deploy:test
```

`tlsn:deploy:test` uses dotenvx to inject the environment, sends public values through Wrangler `--var`, and sends private values through a mode-600 temporary secrets file. The test deploy does not require a clean git worktree or GitHub Actions. Do not use this path for canary or production.

## Configuration

Configure these Worker values before deployment:

- `TLSN_BINDINGS` Durable Object binding for `TlsnBindingAuthorityDurableObject`
- `TLSN_PRESENTATIONS` private R2 bucket binding for pending and completed job objects
- `TLSN_BINDING_TTL_SECONDS` between `1` and `3600`
- `TLSN_SERVER_IDENTITY`
- `TLSN_PROFILE_SHA256`
- `TLSN_SPARSE_PROFILE_SHA256` when enabling `/verify/tlsn/sparse`; this is a separate trusted profile hash and is never used as a client-selected mode switch
- `TLSN_VERIFIER_KEY_ID`
- `TLSN_NOTARY_KEY_ID`
- `TLSN_NOTARY_REGISTRY`
- `TLSN_TRUST_ROOT_CERTIFICATE_DER` only for synthetic TEST fixtures that need a custom Origin root; omit it for real candidate and Production verification, which use alpha.15's built-in Mozilla Web PKI roots
- `TLSN_DEVICE_AUTH_URL` set to the FUSOU-WEB device-proof endpoint (`/api/auth/anonymous-sync/v2/device-proof` in the deployed API) for the test/non-production runtime
- `TLSN_DEVICE_POSSESSION_AUTH_URL` set to the dedicated FUSOU-WEB TLSN possession endpoint (`/api/auth/anonymous-sync/v2/tlsn-device-proof` in the deployed API) for the test/non-production runtime
- `TLSN_CANDIDATE_*` deployment values for the FUSOU-WEB endpoints, Supabase URL/key, and host allowlists. Canary additionally pins one `TLSN_CANDIDATE_SERVER_IDENTITY` and its complete/sparse profile hashes; Production omits these and selects the identity from a Notary-authenticated Presentation against the shipped 20-host Origin inventory, then computes the profile digest for that identity.
- `TLSN_PRODUCTION_NOTARY_REGISTRY` is the single public Notary registry input for the Production Worker, production evidence verifier, and APP public manifest. The selected `TLSN_CANDIDATE_NOTARY_KEY_ID` entry must be the same alpha.15 public verifying key passed to the APP.
- Production public configuration additionally requires `TLSN_PRODUCTION_NOTARY_ENDPOINT`, `TLSN_PRODUCTION_SESSION_AUTHORITY_ENDPOINT`, and `TLSN_PRODUCTION_VERIFICATION_ENDPOINT`. The schema-v4 `tlsn-production-public-manifest.json` carries the selected Notary registry entry and raw registry, the inventory contract, and the recomputed security-set digest; it does not nominate one Production server.
- `TLSN_SECURITY_REGISTRY_SET_SHA256` for non-secret deployment and trust-registry identity
- `TLSN_TEST_AUTH_USERS` only in `TLSN_ENVIRONMENT=test`, as a JSON map of test bearer tokens to non-anonymous user IDs
- `TLSN_BENCHMARK_TIMINGS=true` only in `TLSN_ENVIRONMENT=test` or an explicit canary deployment; it enables the opt-in E2E timing header and is ignored in normal production deployments
- `TLSN_TEST_BINDING_VALUE` only in `TLSN_ENVIRONMENT=test`; the local E2E benchmark supplies one matching fixture binding to each independent Worker through the `X-FUSOU-TLSN-Test-Binding` session header
- `TLSN_TEST_VERIFICATION_LEASE_MS`, `TLSN_TEST_COMPLETION_DELAY_MS`, and `TLSN_TEST_POST_RESULT_DELAY_MS` are bounded test-only race controls; they are ignored outside `TLSN_ENVIRONMENT=test`. The corresponding `*_ONCE=true` values delay only the first completion in a local test Worker.
- Production Trigger execution additionally requires `TLSN_TRIGGER_API_URL`, `TLSN_TRIGGER_TASK_ID`, `TLSN_TRIGGER_SECRET_KEY`, and `TLSN_TRIGGER_CALLBACK_SECRET` on the Worker, plus `TLSN_WORKER_INTERNAL_URL`, `TLSN_TRIGGER_CALLBACK_SECRET`, `TLSN_TRIGGER_VERIFIER_KEY_ID`, `TLSN_TRIGGER_NOTARY_KEY_ID`, and `TLSN_TRIGGER_NOTARY_REGISTRY` in the dotenvx-managed Trigger environment. Production Trigger derives the server identity from the authenticated Presentation, matches the shared inventory, and computes the selected profile digest; its TLS verification uses Web PKI and accepts no custom Origin root. Worker task payloads carry an explicit `origin_policy`: Production selects `inventory`, while Canary selects its separately configured fixed identity/profile. Trigger deployment configuration uses `TLSN_TRIGGER_DEPLOYMENT_ROLE` to sync Canary-only fixed inputs, rejects them for Production, and rejects custom Origin roots for both roles. Sparse jobs use the sparse verifier and sparse result signer path.

- Deployment roles use separate result-signing inputs. Canary requires `TLSN_CANARY_RESULT_SIGNING_PRIVATE_KEY_PKCS8`, `TLSN_CANARY_RESULT_PUBLIC_KEY_SPKI`, `TLSN_CANARY_RESULT_SIGNER_KEY_ID`, and `TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY`. Production requires the corresponding `TLSN_PRODUCTION_RESULT_SIGNING_PRIVATE_KEY_PKCS8`, `TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI`, `TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID`, and `TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY`. The private key is used only by the matching Worker; the public SPKI and registry are published for independent verification.
- A result signing registry is a JSON object with `schema_version: 1`, `scope: "tlsn-result-signing-key-registry"`, and a non-empty `keys` array. Each entry has a unique `key_id`, Ed25519 `public_key_spki`, `status`, `not_before`, and nullable `not_after`. Valid statuses are `ACTIVE`, `VERIFY_ONLY`, `RETIRED`, and `REVOKED`. The configured signer must match an `ACTIVE` registry entry and be inside its validity window. Rotation adds the new `ACTIVE` key while retaining the previous key as `VERIFY_ONLY`; retired or revoked keys cannot sign new results.
- Canary Runtime Attestation uses the repository-controlled `scripts/canary-runtime-attestation-key-registry.json` as its trust root. `TLSN_CANARY_RUNTIME_ATTESTATION_SIGNER_KEY_ID` selects the current Ed25519 registry entry; `TLSN_CANARY_RUNTIME_ATTESTATION_SIGNING_PRIVATE_KEY_PKCS8` is supplied by the external deployment secret provider and is consumed only by `deploy-canary.mjs` while creating the post-deployment artifact. It is never included in the Worker `secrets.json`, Worker bindings, or committed files. The preflight derives the private key's public SPKI and requires an `ACTIVE`, currently valid registry entry with the matching key ID and public key.
- The Runtime Attestation signature covers the canonical JSON representation of the entire Attestation object after removing only `signature_base64url`; `attestation_signer_key_id` and `signature_algorithm` remain covered fields. Verification resolves the public key from the repository registry by signer ID at `captured_at`, so `RETIRED` keys can verify historical artifacts inside their validity window while unknown, not-before, expired, and `REVOKED` keys fail closed. The readiness report exposes `attestation_signature: true` only after this Ed25519 check succeeds. Create-only artifact writing prevents same-path replacement, but does not replace cryptographic authenticity; manifest identity and freshness provide separate binding and temporal predicates. Fixture-only Attestations remain unsigned and cannot satisfy readiness.
- Runtime Attestation uses an explicit forward-compatible field policy: unknown fields are included in the canonical signed payload, but the semantic validator ignores them. An unrecognized security-looking field therefore cannot grant readiness; only the validator's named scope, evidence, workflow, deployment, runtime identity, checks, freshness, and signature predicates do so. Any change to the committed signer registry is a trust-root change: CI pins its byte-level SHA-256, exact scope/schema, current `ACTIVE` key identity, Ed25519 shape, status, and validity window, and fails closed on mutation.
- The repository CI job `.github/workflows/tlsn-verification-worker-security.yml` runs these registry, signing, preflight, private-key-boundary, manifest, Runtime Attestation, readiness, fixture-isolation, and input-intake contracts without Cloudflare credentials, production private keys, Game Server access, Notary traffic, or real deployment.
- Remote validation uses an independent `TLSN_REMOTE_ATTESTATION_SIGNING_PRIVATE_KEY_PKCS8`. Production receives only `TLSN_ATTESTATION_SIGNER_KEY_ID` and `TLSN_ATTESTATION_SIGNER_PUBLIC_KEY_SPKI` as its trust anchor and never receives the attestation private key. `TLSN_MAX_ATTESTATION_AGE_SECONDS` defaults to `900` and is bounded to `1..86400`.
- Device URLs must use HTTPS, match an allowlisted DNS hostname, contain no credentials/query/fragment/alternate port, and use the exact deployed FUSOU-WEB API paths. `TLSN_CANDIDATE_SUPABASE_URL` must satisfy the same HTTPS and clean-origin policy and match `TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS`. Production does not accept `TLSN_TEST_BINDING_VALUE`. The test environment may use `TLSN_TEST_BINDING_VALUE` only to seed the synthetic fixture binding; it is not a Prover authority.

`TLSN_SUPABASE_PUBLISHABLE_KEY` is a publishable client key, not a service-role key. Do not configure a service-role key in this Worker. Missing production auth configuration fails closed with `503 auth_unconfigured`; missing, unknown, malformed, or anonymous credentials return `401 unauthorized`.

### Canary provisioning input matrix

`provision-canary-material.mjs` is an offline material provisioner. In real mode it never creates a Notary private key, contacts a Game Server, connects to FUSOU-NOTARY, or deploys a Worker. A complete deployment manifest is emitted only when the required real inputs below are resolved. The generated authority private keys remain in mode-600 local output files and are not public manifest inputs.

| Input | Source and owner | Provisioning behavior | Readiness gate |
| --- | --- | --- | --- |
| `TLSN_CANDIDATE_SERVER_IDENTITY` | FUSOU deployment operator | Canary-only fixed target hostname; Production selects from the shipped inventory | target provenance |
| `TLSN_CANDIDATE_PROFILE_SHA256` | FUSOU provisioner from the canonical complete profile | Binds the complete Presentation verifier profile | target/profile |
| `TLSN_CANDIDATE_SPARSE_PROFILE_SHA256` | FUSOU provisioner from the canonical sparse profile | Binds the sparse Presentation verifier profile | target/profile |
| `TLSN_CANDIDATE_VERIFIER_KEY_ID` | FUSOU verifier deployment configuration | Selects the public verifier identity used by the Canary path | trust material |
| `TLSN_CANARY_VERIFIER_PUBLIC_KEY_SPKI` | FUSOU verifier deployment output | Public SPKI for the selected verifier deployment | trust material |
| `TLSN_CANARY_VERIFIER_DEPLOYMENT_ID` | FUSOU verifier deployment configuration | Binds the verifier identity to its deployment | trust material |
| `TLSN_CANARY_RUNTIME_ATTESTATION_SIGNER_KEY_ID` | Repository-controlled Runtime Attestation registry | Selects the Ed25519 key that signs the post-deployment Runtime Attestation | Runtime Attestation signature |
| `TLSN_PRODUCTION_NOTARY_REGISTRY` | FUSOU-NOTARY public export, normalized by the provisioner | Canonical alpha.15 verifying-key registry; public only | Notary binding |
| `TLSN_CANDIDATE_NOTARY_KEY_ID` | FUSOU-NOTARY public export selection | Must identify an active key present in the registry | Notary binding |
| `TLSN_CANDIDATE_NOTARY_ENDPOINT` | FUSOU deployment operator | Raw `host:port`; validated syntactically without a connection | Notary binding |
| `TLSN_SECURITY_REGISTRY_SET_SHA256` | FUSOU provisioner | Canary binds target/profile hashes; Production binds the shipped inventory digest, canonical profile policy, and Notary registry/key | trust material |
| `TLSN_CANARY_BINDING_IDENTITY` | FUSOU deployment operator | Current Canary binding identity; fixture and replay identities are rejected | binding |
| `TLSN_CANARY_DEPLOYMENT_ID` | FUSOU deployment operator/platform | Current Canary deployment identity | deployment provenance |
| `TLSN_CANARY_WORKER_NAME` | FUSOU deployment operator/platform | Canonical Canary Worker name | deployment provenance |

The current Presentation path requires the FUSOU-owned delegated alpha.15 Notary registry, selected key ID, and endpoint together. `optional_in_protocol: true` describes a future direct-Verifier protocol property only; it does not make the current Notary-backed Presentation verification path optional. Remote validation credentials remain post-deployment inputs and are not part of this provisioning gate.

### Canary Notary endpoint mapping

The public raw endpoint follows this explicit handoff:

```text
TLSN_CANDIDATE_NOTARY_ENDPOINT
	-> Canary provisioning output and deployment input
	-> FUSOU_TLSN_NOTARY_ENDPOINT (compile-time APP/Proxy binding)
	-> configs option_env!("FUSOU_TLSN_NOTARY_ENDPOINT")
	-> FUSOU-APP TLSN preflight (format validation only)
	-> FUSOU-APP RealAlpha15OriginTransportFactory
	-> FUSOU-PROXY raw TCP alpha.15 MPC connection to FUSOU-NOTARY
```

The APP preflight does not connect to the endpoint. The actual raw TCP connection occurs only when the real alpha.15 Prover/MPC flow runs, with the Prover retaining the origin connection and FUSOU-NOTARY acting as the alpha.15 MPC verifier. No direct live FUSOU Verifier is introduced by this mapping.

### Canary Runtime Attestation readiness

The trust roles are intentionally separate:

| Trust role | Meaning |
| --- | --- |
| Repository signer registry | Trust anchor for Runtime Attestation Ed25519 verification and signer lifecycle |
| Deployment manifest | Authorized deployment, workflow, worker, and validity identity |
| Runtime Attestation signature | Authenticity of the post-deployment artifact under the registry |
| Manifest ID binding | Artifact-to-deployment authorization identity |
| Freshness | Temporal validity of the manifest and captured runtime evidence |

No single field or create-only artifact path replaces the other predicates. The registry is a security-sensitive repository input and must be reviewed like code that changes who can authorize a Canary runtime.

`CANARY_RUNTIME_IDENTITY_VERIFIED` is not a human-gameplay readiness state. It attests the Main Worker and independently cross-binds the Canary Verifier deployment; the Verifier `/health` check also proves that its signing private key matches its published Ed25519 SPKI. The readiness audit remains `BLOCKED` until every independent gate passes. Smoke schema v3 binds the signed manifest ID, a canonical digest of target/Notary/deployment-input/artifact identities, and an independently supplied readiness invocation UUID. Its replay policy is bounded reuse within the fresh attestation window; it does not claim one-time use because there is no persistent anti-replay ledger. Each component reports semantic status separately from source-authentication status, authority, and reason. `pnpm run run:canary-operational-smoke` requires the validated deployment manifest and Runtime Attestation plus manifest-fingerprinted Main/Verifier HTTPS origins; it directly fetches both `/health` routes and writes only those two create-only, mode-0600 observations alongside the signed smoke artifact. Their `PASS` status means the runner fetched the manifest-bound HTTPS origins and matched the returned deployment/version/key identity to the current Runtime Attestation; it is not a source-issued signature over the health response.

The other eight components (`callback`, `trigger`, `session_binding`, `DO`, `R2`, `Notary`, `Auth`, and `Presentation`) are recorded as `semantic_status: NOT_RUN` and `source_authentication: BLOCKED`. Raw filesystem JSON assertions are neither required nor accepted as proof, and cannot be upgraded by setting `source`, `synthetic`, or validity booleans. Clearing those components requires integrating their existing authoritative proofs: authenticated callback-chain evidence, an authenticated Trigger.dev run, signed Session/Consume receipts, authenticated Durable Object state, actual R2 readback evidence, Presentation bytes verified against the Notary registry, Supabase/FUSOU-WEB subject/device proof, and the exact Presentation/Result bytes with the signed Dedicated Verifier execution receipt. Until then the aggregate smoke and readiness gates remain `BLOCKED`, even when both health probes pass. The runner has no fixture fallback; it does not deploy or authorize gameplay. Fixture scopes, generic `PASS` artifacts, configuration variables, and replayed or synthetic evidence cannot satisfy readiness.

The readiness evaluator treats the artifact path as an identification mechanism, not a trust boundary. It compares the artifact against the current workflow run/attempt, repository, workflow identity, checked-out SHA, validated deployment manifest, and current Canary environment. The real Runtime Attestation records the exact validated `deployment.manifest_id`; `manifest_attestation: true` therefore includes an exact manifest identity comparison, not only deployment/workflow field equality. It also re-checks the observable deployment, worker, platform deployment, serving version, and runtime self-reported version fields; the embedded `checks.*` booleans are supporting assertions, not the final trust root. Because the manifest is created before Cloudflare returns a version ID, its binding deliberately covers the authorized deployment/workflow identity while the Runtime Attestation binds the platform's current serving version to the runtime version.

`attestation_fresh: true` is a separate temporal predicate. The Runtime Attestation `captured_at` must be a valid non-future ISO timestamp inside the validated manifest window (`issued_at <= captured_at <= expires_at`), and the manifest window itself must still be current at validation time. Exact manifest identity is an artifact identity check; `captured_at` freshness is a temporal validity check; `writeImmutableCanaryAttestation()`'s create-only file write prevents replacement; `attestation_signature: true` is an independent Ed25519 authenticity predicate backed by the repository-controlled signer registry. The readiness evaluator's `validatedDeploymentManifest` argument is reserved for explicit internal test fixtures; the production CLI path loads and validates the manifest artifact before passing it to Runtime Attestation validation.

The report exposes `cross_binding.status` plus workflow, manifest, environment, and version-serving predicates. A valid artifact paired with an older workflow attempt, another deployment ID, another worker, or a different manifest is rejected as Frankenstein evidence even when the individual artifact has the same Git SHA.

Run `pnpm run test:canary-readiness` for the offline audit. It performs no deployment, Game Server, Notary, or remote validation call. The readiness gate requires current HEAD, contract, deployment manifest, deployment contract, target provenance, trust material, Notary binding, authentication, binding, workflow provenance, verifier identity binding, operational smoke, Runtime Attestation, cross-binding, identity separation, and no fixture contamination. Remote validation remains `POST_DEPLOYMENT_ONLY` and is not a readiness gate. Runtime identity attestation alone cannot clear the two currently unimplemented gates; human gameplay and the subsequent fresh TLSN verification path remain blocked until every gate is independently satisfied.

## Production Trust Contract

The following values are the Production source of truth. The raw registry JSON is kept byte-for-byte identical wherever it is captured or compared; its hash is an identity field, not a replacement for the registry contents. Every Notary registry value is canonical base64url for the pinned alpha.15 bincode `tlsn_attestation::signing::VerifyingKey` using the FUSOU Notary `K256` algorithm and compressed SEC1 public key.

| Authority | Public source | Private source | Consumers |
| --- | --- | --- | --- |
| TLSN alpha.15 Notary | `TLSN_PRODUCTION_NOTARY_REGISTRY` plus selected `TLSN_CANDIDATE_NOTARY_KEY_ID` | Notary deployment only | Worker, offline evidence verifier, public manifest, APP selected verifying key |
| Session Authority | `TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_ID`, `TLSN_PRODUCTION_SESSION_AUTHORITY_PUBLIC_KEY_SPKI`, and `TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_REGISTRY` | `TLSN_PRODUCTION_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8` | Worker issuance, offline evidence verifier, public manifest |
| Binding Authority | `TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_ID`, `TLSN_PRODUCTION_BINDING_AUTHORITY_PUBLIC_KEY_SPKI`, and `TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_REGISTRY` | `TLSN_PRODUCTION_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8` | Worker consume receipts, offline evidence verifier; never APP |
| Result signer | `TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID`, `TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI`, and `TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY` | `TLSN_PRODUCTION_RESULT_SIGNING_PRIVATE_KEY_PKCS8` | Worker result signing, offline evidence verifier, public manifest, APP result verification |

The Production workflow connects those public values to preflight and Worker `--var` inputs, and connects the Session/Binding private keys and the existing Result signing private key to the temporary secrets file. No private authority material is written to the public manifest or sent to the APP.

The public manifest schema is:

```json
{
	"schema_version": 4,
	"scope": "tlsn-production-public-config",
	"notary": {
		"endpoint": "host:port",
		"key_id": "...",
		"verifying_key": "...",
		"registry_entry": { "key_id": "...", "verifying_key": "..." },
		"registry_raw": "...",
		"registry_sha256": "..."
	},
	"session_authority": {
		"endpoint": "https://.../attestation/session",
		"key_id": "...",
		"public_key_spki": "...",
		"key_registry_sha256": "..."
	},
	"result_signing": {
		"key_id": "...",
		"public_key_spki": "...",
		"key_registry": {
			"schema_version": 1,
			"scope": "tlsn-result-signing-key-registry",
			"keys": []
		},
		"key_registry_sha256": "...",
		"result_key_registry_envelope_sha256": "...",
		"result_registry_root_key_id": "...",
		"result_registry_root_public_key_spki": "..."
	},
	"verification_endpoint": "https://.../verify/tlsn",
	"security_registry_set_sha256": "...",
	"origin_inventory": {
		"schema_version": 1,
		"sha256": "...",
		"target_count": 20,
		"port": 443
	}
}
```

Schema v4 binds the selected Notary key ID and canonical raw registry, the byte-level digest of the shipped Origin inventory, and the canonical profile-policy digest through `security_registry_set_sha256`. `origin_inventory` is an identity-selection allowlist, not a trust anchor: Production selects from its 20 DNS identities using the Notary-authenticated Presentation, while alpha.15 independently validates the captured Origin certificate chain, validity, and DNS identity through its built-in Mozilla Web PKI roots. Production and Canary do not publish or consume a target Origin DER root. `pnpm run render:app-config` maps this manifest to APP public TLSN settings, including the Result signer SPKI, signer key ID, and complete public registry, and receives the local artifact path as a separate argument. APP constructs its own fail-closed Result signature verifier from those public values. APP receives no Binding Authority registry, private key, bearer token, service credential, device key, or Cloudflare credential.

For rotation, publish the new Notary registry and selected key together, then regenerate the public manifest and APP config. For Session or Binding Authority rotation, publish the new public SPKI, key ID, registry, and matching private secret as one deployment unit. The new key must be `ACTIVE`; the previous Session/Binding key may remain `VERIFY_ONLY` for historical receipt verification, but must not issue new receipts. Validate the old/new registry hashes and public-key identities offline before deployment, and retain the previous complete configuration for rollback.

## Deployment preflight

Run the preflight in the same CI environment that supplies the production Worker variables:

```sh
pnpm run preflight:production
```

`scripts/production-inputs.json` is the explicit production input contract and the deploy wrapper's allowlist. The preflight checks required production variables, clean HTTPS URLs and exact FUSOU-WEB paths, DNS allowlists, profile/security digests, Notary registry membership, result-key publication, and the absence of test fixtures, service-role keys, and device-private-key variables. It writes only non-secret failure metadata to `artifacts/tlsn-deployment-preflight.json` or `TLSN_PREFLIGHT_REPORT_PATH`, plus `artifacts/tlsn-production-provenance.json` or `TLSN_PROVENANCE_REPORT_PATH`; it never prints configuration values.

The passing Production preflight also writes the public-only `tlsn-production-public-manifest.json` schema version 4. It contains the Notary endpoint, selected Notary key ID and raw registry, Session Authority endpoint/key ID/public SPKI and registry hash, Result signer key ID/public SPKI/registry and registry hash, Verification Worker endpoint, security-set digest, and the shipped Origin inventory schema, SHA-256, target count, and port. It contains no single Production hostname, Origin trust-root DER, private key, bearer token, service credential, device key, or Cloudflare credential. Use `pnpm run render:app-config -- --manifest <manifest> --canary-manifest <TLSN_CANARY_DEPLOYMENT_MANIFEST> --output <configs.toml> --artifact-output-path <local-directory> --runtime-attestation-endpoint <https-worker-health-url>` to create an APP config. The renderer validates the current Canary deployment manifest and derives the expected deployment ID, Worker name, and commit SHA from it; the artifact path and health URL are supplied separately because they are APP-local/runtime inputs.

APP TLSN verification loads native operating-system roots; the alpha.15 Worker verifier uses its bundled Mozilla roots. These stores can differ. APP's native-store availability preflight does not prove that a particular Origin chain validates, and a Worker rejection can occur even after APP's local handshake succeeds. A leaf renewal or intermediate change normally needs no FUSOU change if both stores can build a valid chain; introducing a root absent from the Worker bundle requires updating and redeploying the Worker verifier.

The inventory is an identity-selection allowlist, not a certificate trust store. It does not authorize hostname-only trust, bypass Web PKI, or make Notary signatures a replacement for certificate validation. The opt-in `tlsn-origin-probe` binary records the peer certificate chain from a rustls Web PKI-validated TCP/TLS handshake; it sends no HTTP request and does not enroll roots or change trust. Run it against real hosts only with explicit approval because it makes outbound DNS/TCP/TLS connections.

Use `pnpm run deploy:production` for the guarded deploy entry point. It runs the preflight, captures the previous production identity, runs remote validation against the canary, verifies the fresh report, deploys only after that gate passes, and performs post-deploy identity and unauthenticated smoke checks. It injects non-secret manifest inputs through Wrangler `--var` and uploads signing keys through a temporary mode-600 secrets file. Wrangler authentication remains CLI-only; a failed prerequisite cannot deploy.

The complete offline contract check is `pnpm run test:production-roundtrip`. It generates synthetic authority keys and an X.509 root, uses a pinned alpha.15 K256 key, runs Production preflight, validates the public manifest, renders the APP TLSN fragment, parses it through the APP config loader, and requires APP preflight `ready=true`. It does not contact a Game Server, Notary, Worker, Supabase, or any other remote service.

## Remote validation

`scripts/remote-validation.mjs` exercises deployed HTTP boundaries and verifies the returned Ed25519 result independently in Node.js. It writes `artifacts/tlsn-remote-validation.json` with the current workflow run, commit, validation ID, and validation timestamps. Declared `production_evidence` and `p0_05` blocks are report status only; any other blocked or failed check prevents the gate from passing and returns a non-zero exit code. `scripts/verify-remote-gate.mjs` recomputes the Canary provenance and remote report hashes and writes an immutable `tlsn-remote-validation-attestation.json` only after the report passes.

The attestation is schema version 2 with scope `tlsn-remote-validation-attestation`. Its signature covers a fixed canonical JSON payload containing the workflow context, canary provenance hash, remote report hash, security identity hash, validation window, validation ID, and creation time. It carries `signature_algorithm: "Ed25519"`, `attestation_signer_key_id`, and `signature_base64url`. Production verifies the signature against the configured attestation public SPKI, requires the expected workflow context and canary identity, recomputes both artifact hashes, and rejects future or stale validation results.

The verify Worker used by the synthetic fixture may have one fixed `TLSN_TEST_BINDING_VALUE`. Session sampling must use a separate Worker URL without that variable; the harness requires `binding_mode: random` and at least 100 unique session IDs, binding values, and device challenges, so fixed-binding reuse cannot masquerade as a benchmark. The cold/warm WASM metric is explicitly labeled as binding-mismatch measurement and is not valid-verification performance. Concurrent replay uses a separate fixed-binding Worker and requires exactly one success. Payload/resource and per-field signed-result mutation matrices are included. Revocation and expiry checks likewise require separate Worker URLs and disposable test devices; when both run, expiry uses unrevoked User B. Revocation is opt-in and permanently revokes the configured device.

Required harness inputs are supplied through CI secrets or a local secret manager, never committed:

- `TLSN_REMOTE_WORKER_URL`, `TLSN_REMOTE_SESSION_BENCHMARK_URL`, `TLSN_REMOTE_WEB_ORIGIN`, and `TLSN_REMOTE_SUPABASE_URL`
- `TLSN_REMOTE_SUPABASE_PUBLISHABLE_KEY`, `TLSN_REMOTE_ACCESS_TOKEN_A`, `TLSN_REMOTE_DEVICE_ID_A`, and either `TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL` or `TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_FILE`
- `TLSN_REMOTE_FIXTURE_JSON`, `TLSN_REMOTE_RESULT_PUBLIC_KEY_SPKI`, and `TLSN_REMOTE_EXPECTED_MEMBER_ID` (the last value may instead be `expected_member_id` in the fixture)

Set `TLSN_REMOTE_ACCESS_TOKEN_B`, `TLSN_REMOTE_DEVICE_ID_B`, and the corresponding device key to enable cross-user attacks. Set `TLSN_REMOTE_FIXTURE_B_JSON` to a fixture with a different binding value for context swapping. Set `TLSN_REMOTE_REVOCATION_WORKER_URL` and `TLSN_REMOTE_RUN_REVOCATION=true` for verify-time revocation; set `TLSN_REMOTE_EXPIRY_WORKER_URL` and `TLSN_REMOTE_RUN_EXPIRY=true` for expiry. A sanitized log export can be scanned with `TLSN_REMOTE_LOG_EXPORT`.

Run it with:

```sh
pnpm run validate:remote
```

Remote validation currently exercises `/verify/tlsn` and verifies the complete Result profile only. The sparse endpoint still requires a remote sparse capture and production fixture; offline contract tests cover its local parser and payload boundaries.

Status: authenticated user ownership `PASS`; authenticated device ownership `PASS`; current device possession proof `PASS, local synthetic scope`; TLSN/device cryptographic binding `PASS, local synthetic scope`; replay/expiry `PASS`; production evidence `BLOCKED`; `P0-05` `BLOCKED`. The remote report always records `production_evidence` and `p0_05` as `BLOCKED`, even when every synthetic check passes. The production trust contract is not complete until the deployed FUSOU-WEB endpoints, production device registry/revocation behavior, approved Notary registry, Origin certificate-chain/validity/hostname verification through built-in Mozilla Web PKI, replay/session authority, result-key publication and rotation, and performance evidence are exercised remotely. The test Worker and synthetic evidence do not satisfy that contract.

`production_evidence` is governed by the `tlsn-production-evidence` contract. Its status remains `BLOCKED` until independently captured evidence verifies a real production Game Server connection, TLSN Notary interaction, FUSOU-WEB authentication and device possession, replay and binding authorities, Origin certificate-chain/validity/hostname verification through built-in Mozilla Web PKI, result signer, public-key publication, and the complete production capture. Passing synthetic checks, signing a remote report, or verifying the attestation does not satisfy these requirements and cannot unlock `production_evidence` or `P0-05`.
The Production job independently verifies the attestation, its artifact hashes, the current workflow context, the Canary/Production security identity match, and the previous-known-good identity change report before deployment. No bypass variable is used for declared blocked evidence, and both `production_evidence` and `p0_05` remain `BLOCKED`.

## Production Evidence Capture

`pnpm run capture:production-evidence` is a standalone evidence verifier. The preferred input is `TLSN_PRODUCTION_EVIDENCE_BUNDLE_PATH`, a directory emitted by FUSOU-APP containing `presentation.bin`, `metadata.json`, the APP-issued `session.json`, `device-authentication.json`, `possession-proof.json`, `worker-verification.json`, `result.json`, and `consume-receipt.json`. Bundle mode consumes the already-used Session and signed Result, so it does not issue a second Session or submit the Presentation for a second first-use verification, and it does not require a device private key. For legacy standalone input, set `TLSN_PRODUCTION_EVIDENCE_PRESENTATION_PATH` to raw Presentation bytes and `TLSN_PRODUCTION_EVIDENCE_PRESENTATION_PROVENANCE_JSON` to its sidecar; that mode requires a registered device private key and performs the first Worker verification itself. Both modes require a real production Worker, FUSOU-WEB and Supabase origins, a non-anonymous access token, the production result signing registry, and `TLSN_PRODUCTION_NOTARY_REGISTRY`. The sidecar must identify `fusou-proxy-production-tlsn`, declare `capture_provenance: "production"`, set `synthetic`, `test`, `canary`, and `local` to `false`, record the exact `POST /kcsapi/api_get_member/require_info HTTP/1.1` profile, include the Presentation SHA-256, and include a separate `proxy_provenance` object. The sidecar is capture metadata, not TLSN authority evidence: without `TLSN_PRODUCTION_PROXY_PROVENANCE_PIN_JSON`, its proxy cryptographic predicate remains `UNVERIFIED`; a self-declared signature cannot become `VERIFIED`. A pin must contain the external Ed25519 public key, signer key ID, proxy identity, deployment ID, and binary identity. Fixture bytes, candidate registries, member IDs, request/response declarations, and metadata-only provenance cannot satisfy this input contract. The alpha.15 verifier derives the server identity, transcript digests/ranges, HTTP profile, and member ID directly from the cryptographically verified Presentation. The authenticated request binding must match the APP-issued Session binding and encoded session ID. The harness independently verifies the signed Result and verifies one-shot replay rejection without making any Game Server request.

The harness never promotes the gate: the manifest governance status, `production_evidence`, `p0_05`, and independent governance status remain `BLOCKED`, including when capture and semantic verification pass. `pnpm run verify:production-evidence` performs offline verification of the manifest signature, trusted workflow/deployment identities, artifact hashes, captured Notary and result registries, the alpha.15 built-in Mozilla Web PKI checks for the Origin certificate chain and server identity, alpha.15 Presentation cryptography, strict HTTP semantics, authenticated member derivation, direct Presentation-to-Session freshness, session/device/subject binding, Result-to-Presentation correlation, proxy provenance status, and replay evidence. Synthetic declarations, metadata-only manifests, altered artifacts, stale manifests, wrong signer keys, unrelated Result/Presentation pairings, old Presentations paired with fresh Sessions, and context substitutions are rejected or remain blocked.

The evidence signer uses `TLSN_PRODUCTION_EVIDENCE_SIGNER_KEY_ID`, `TLSN_PRODUCTION_EVIDENCE_SIGNER_PUBLIC_KEY_SPKI`, and `TLSN_PRODUCTION_EVIDENCE_SIGNING_PRIVATE_KEY_PKCS8`. These are separate from both the remote attestation signer and the Worker Result signer; the private key is used only by the capture job and is never sent to the Worker. Live capture credentials and device keys must be supplied through the CI secret manager and are not committed.
