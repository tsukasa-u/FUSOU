# Runtime Config Freshness Protocol — Phase 0 Specification

- **Status:** Phase 0 design selected; local APP verification and a separate Freshness Gateway source route are implemented; Production signer/authority implementation, endpoint/binding registration and approval remain pending
- **Updated:** 2026-11-01
- **Repository HEAD at review start:** `42bd255bb128bef97b1d6e01fb3dbcf323437fd6`
- **Parent at review start:** `891ec66a729da4dc832cb70fbd6ff5cd3e620cae`
- **Previous Phase 0 review snapshot:** `254967c4fb77d279a608da91b8836b5b9d8f551e`
- **Runtime-source baseline:** `43ab72e6284deee3ad202be7fb50e3f0199af304`
- **Historical design snapshot:** `a0cb49250df53132ee8df42ca02fbce91e10c7d2`
- **Phase 1 implementation base:** branch `tlsn-first-testplay-candidate`, HEAD `b2a546986aaa31eae46aa8944304df6508d83be1`, parent `42bd255bb128bef97b1d6e01fb3dbcf323437fd6`
- **Phase 1 source/test commit:** `2211b3964c8779f5032a5444165eb9daaa2ccca7`
- **Readiness record:** [FIRST-TESTPLAY-READINESS.md](../FIRST-TESTPLAY-READINESS.md)

The decisions below are the Phase 0 design. The Phase 1 record below describes
later local source and test changes based on the stated implementation base;
it does not revise the Manifest v2 signing contract. The 42bd/43ab source
observations in Section 2 are historical review-start evidence, not a claim
that those exact source paths remain unchanged in the current branch.

The Production protocol is **not implemented**. The local APP verifier and
Worker-side test protocol are not Production services: no Production key,
Release Journal, DO, R2 authority, endpoint, binding or registration was
created. No deployment, live Freshness response, or real-game readiness is
implied.

## Current source state — Freshness Gateway connection (2026-11-06)

- A separate `FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-GATEWAY` Worker source entry
  now owns the Freshness request path. It validates the configured Manifest
  URL and same-origin audience, enforces the shared request/response byte
  limits, validates the challenge through the shared Runtime Config domain,
  forwards only the canonical validated challenge through an optional private
  signer Service Binding, rejects redirects/non-200 or malformed-size
  responses, and returns the signer's exact response bytes without
  reserialization.
- The new Worker configuration deliberately has no public route or signer
  Service Binding. Its production handler therefore fails closed with
  `503` until those externally approved registrations exist. The existing
  `FUSOU-TLSN-VERIFICATION-WORKER/src/index.ts` remains unchanged and does not
  host Freshness authority behavior.
- A local integration test explicitly injects
  `InMemoryRuntimeConfigFreshnessAuthorityForTest`; it does not select that
  test implementation from the Gateway Worker. The actual Gateway handler's
  output bytes are passed to the APP Rust verifier, which verifies the nonce,
  signatures/delegations, Release Commit Record, Manifest signature and
  independent artifacts. This is synthetic evidence, not a Production
  Freshness response.
- APP's 2-second connect timeout, 10-second request/acceptance deadline,
  redirect prohibition, 65,536-byte response limit, Manifest checks and
  artifact limits remain unchanged. The capture forwarder is still installed
  only after APP refresh and preflight succeed.
- **Still NOT_IMPLEMENTED / NOT_REGISTERED:** the separate Production
  Freshness Signer Worker and adapters for the approved Freshness key,
  Release Journal, dedicated DO state/issue lease, read-only Runtime Config
  R2 access, public route/domain and private Service Binding. No external
  authority or trust input was substituted with test material.
- **Readiness:** local Gateway-to-APP verification is `VERIFIED` for the
  synthetic fixture only. Production service response and real APP capture
  remain `UNVERIFIED` / `BLOCKED`; Stage A/B/C and Production acceptance remain
  `BLOCKED`. No Production resource was created or deployed.

## Freshness Gateway request controls (2026-11-07)

- The Gateway retains `compatibility_date = "2026-11-06"` and explicitly
  enables `enable_request_signal`. Cloudflare's
  [November 2, 2026 changelog](https://developers.cloudflare.com/changelog/post/2026-11-02-request-signal-default/)
  says incoming disconnect events become the default only for compatibility
  dates on or after November 17, 2026; no date-wide upgrade was made.
- Each admitted request has one 7,000 ms monotonic Gateway deadline, started
  before audience hashing and request-body reading and never reset between
  phases. It covers the bounded request body, challenge validation, signer
  Service Binding fetch, signer response body read, and creation of the exact
  response. The Gateway mirrors client disconnect and deadline into one
  internal `AbortSignal`, passes it to the signer, races stream reads against
  it, and cancels request/response readers on interruption. Success, failure,
  and response completion clear the deadline timer and remove the disconnect
  listener.
- The Gateway deadline is separate from APP's 10-second end-to-end
  verification/persistence deadline and the signer's at-most-8-second issue
  lease. It does not assert that APP persistence completes within 7 or 10
  seconds and does not change the lease contract.
- Admission is capped at 16 in-flight requests **per Worker isolate**. The
  counter is acquired synchronously, has no queue, and returns `503` without
  contacting the signer when full. A slot is released once only after the
  operation settles and every body stream owned by it is either consumed to
  EOF or successfully canceled; any acquired reader must also release its
  lock. If a signer or stream does not honor cancellation, the response
  deadline still returns `504` (client disconnect returns `499`), but its slot
  remains occupied rather than being reused while work is pending. The handler
  attaches pending cleanup to
  [`ctx.waitUntil()`](https://developers.cloudflare.com/workers/runtime-apis/context/);
  Cloudflare documents a 30-second limit after response/disconnect, which is
  not a bound on total request time. If cleanup
  cannot be confirmed before the runtime limit, this implementation does not
  claim remote cancellation or release the slot. The per-isolate cap is not a
  service-wide cap; no shared limiter or new coordination authority was
  introduced. If a service-wide upper bound is required, that remains an
  unimplemented external coordination contract.
- Each acquired Signer response body has one owner from the moment `fetch()`
  resolves, including a response that arrives after disconnect/deadline. The
  owner cancels an unread body directly, or cancels through its reader after
  reading has begun; it memoizes the cancellation so rejection and interruption
  paths cannot double-cancel or call `ReadableStream.cancel()` on a locked
  stream. A normal response is accepted only after the finite bounded body is
  read to EOF. Header/status/redirect/Content-Length rejection cancels the body
  before returning `502` when cancellation completes.
- The HTTP deadline and cleanup completion are separate. A pending
  `cancel()` does not delay a deadline/disconnect response: the operation
  remains attached to `ctx.waitUntil()` and keeps its admission slot until
  cancellation and reader release settle. If cancellation rejects, or an
  acquired reader cannot release its lock, resource release is unconfirmed:
  the operation fails closed and permanently retains that slot for the
  lifetime of the isolate. No retry, background queue, or automatic slot
  reclamation is used. A permanently retained slot can reduce the isolate's
  available capacity up to the existing 16-request limit.
- Local Node tests use explicit `AbortController` signals and synthetic
  signer bindings. They cover incomplete request and response streams, a
  non-settling signer fetch, late resolve/reject, late streaming responses,
  Content-Length early rejection, delayed/rejected cleanup, admission
  overflow, cleanup-gated slot retention/release, and the existing
  Gateway-to-APP exact-byte verification.
  Wrangler configuration/type generation and packaging are checked locally,
  but incoming disconnect propagation in a local or deployed Workers runtime
  has not been exercised. The explicit `enable_request_signal` configuration
  is verified separately from Node's AbortController behavior.
- The candidate workflow installs `libwebkit2gtk-4.1-dev`,
  `libappindicator3-dev`, `librsvg2-dev`, and `patchelf` in the
  `node-contract-tests` job because its Freshness Node integration test invokes
  the APP Rust verifier. The integration assertion remains enabled; Hosted CI
  has not been run.

## Phase 1 local implementation record

The Phase 1 implementation commit is
`2211b3964c8779f5032a5444165eb9daaa2ccca7`, based on
`b2a546986aaa31eae46aa8944304df6508d83be1` on
`tlsn-first-testplay-candidate` (parent `42bd255bb128bef97b1d6e01fb3dbcf323437fd6`).

- APP `RuntimeConfigManager::refresh` now enters a dedicated Freshness POST
  flow with a fresh 32-byte nonce, redirects disabled, bounded response reads,
  a 2-second connect timeout, a 10-second request timeout, and a single
  10-second monotonic deadline from immediately before challenge submission
  through the synchronous atomic state-file replacement check. The existing
  Manifest v2 envelope and signing bytes are unchanged.
- APP source verifies canonical, exact-schema delegation/Release Commit
  Record/Freshness envelopes; root and delegated Ed25519 signatures; scope,
  environment, audience, nonce, timestamps, strict delegation lifetime,
  Manifest reference/digests and release metadata. It fetches the exact
  immutable Manifest snapshot and all existing independent artifacts before
  accepting the original Manifest verifier result.
- Persisted epoch state v2 binds Manifest epoch/digest, commit generation,
  Release Commit Record digest, and Freshness delegation generation/digest.
  Valid v1 state is used as migration high-water. Malformed or unsupported
  state fails closed. The final callback runs after temporary-file write and
  fsync, rechecks state and time/deadline, and returns synchronously to atomic
  rename without an async yield.
- Worker `scripts/tlsn-runtime-config-freshness.mjs` and its in-memory R2,
  DO-coordination, Journal, clock and signer adapters are test-only. They are
  not wired into `src/index.ts` and do not implement Cloudflare service
  adapters. The test genesis approval sentinel is explicitly test-only and
  does not specify Production genesis authorization.
- **Local verification:** 12/12 Freshness adversarial tests and 70/70 focused
  Freshness/Manifest/R2-store/publisher-readiness/Bootstrap tests passed;
  Worker TypeScript typecheck and JavaScript syntax checks passed; Rust
  rustfmt/syntax check passed. APP Cargo tests/build are **NOT_CHECKED**:
  `packages/configs/src/configs.rs` embeds protected `configs.toml` files with
  `include_str!`, so Cargo compilation would read those files. No Cargo
  command was run. No hosted CI or live R2/Journal/DO/HSM operation was run.
- **Readiness:** APP Rust compilation is **UNVERIFIED**; Production authority
  adapters and registration are **NOT_IMPLEMENTED** / **BLOCKED**. Human
  trust-owner approval and key/Journal/provider registration remain required.
  Stage A, Stage B, Stage C, Production acceptance, deployment and real-game
  evidence remain **BLOCKED**.

## Phase 1 follow-up verification — audit base `4183a4c6d54b92f253504546a4e674cae682d866`

This follow-up started on `tlsn-first-testplay-candidate` at
`4183a4c6d54b92f253504546a4e674cae682d866`, parent
`2211b3964c8779f5032a5444165eb9daaa2ccca7`. The earlier Phase 1 record above
is historical and is superseded only for the local test/validation results
listed here; it does not imply a Production service implementation.

- The test-only Release Authority creates `authorized_at` from its injected
  `releaseClock.now()` when authorizing the exact pending attempt. The caller
  does not supply a timestamp. The Journal independently samples its append
  clock and accepts only when both timestamps are inside the Release Authority
  delegation's half-open interval and `authorized_at <= appended_at`.
  Tests reject a signer clock before `not_before`, a signer time after Journal
  append time, authorization bytes replayed into another release attempt, and
  an orphaned signature that was not persisted to its pending DO attempt.
- Phase 0 defines no independent maximum elapsed time from authorization to
  Journal append. No new age threshold or timestamp trust source is introduced
  here: a delayed authorization remains eligible only as the exact bytes
  stored for its exact pending attempt, while the prior Journal head and
  pointer/snapshot still match, and only before the delegation expires. The
  resulting upper bound is the remaining Release Authority delegation
  lifetime (strictly less than 30 days from its `issued_at`); adding a shorter
  production signing-to-append SLA requires an explicit protocol decision.
- Recovery tests cover `PREPARED`, R2 CAS, `POINTER_COMMITTED`, stored
  authorization, Journal append, and post-DO-commit restart. Exact committed
  Journal bytes are verified before DO recovery. A candidate pointer confirmed
  after an ambiguous CAS is recoverable; an unchanged prior pointer after a
  CAS was started remains blocked rather than being retried. Recovery waits
  for existing issue leases, and multiple concurrent leases prevent release
  until all have completed.
- The test Journal validates its signed generation/hash chain and append
  metadata on restart. The in-memory R2, Journal, DO, clocks and keys remain
  test-only; none is wired to the deployed Worker.
- **Local verification:** 21/21 Freshness tests and 79/79 combined
  Freshness/Manifest/R2-store/publisher-readiness/Bootstrap tests passed,
  with zero skips. Worker typecheck passed. APP `cargo check` with
  `tlsn-production` passed, and 28 matching APP Runtime Config/preflight Rust
  tests passed with that feature enabled. The changed Rust file passed a
  targeted `rustfmt --check`. Workspace-wide `cargo fmt --check` still reports
  existing formatting differences in unrelated files; no formatting change
  was applied to them. Cargo emitted existing unused/dead-code warnings.
- No hosted CI or live R2/Journal/DO/HSM operation was run. Production
  Freshness adapters, bindings, keys and registration remain
  **NOT_IMPLEMENTED** / **BLOCKED**. Stage A, Stage B, Stage C, Production
  acceptance, deployment and real-game evidence remain **BLOCKED**.

## 1. Normative decisions

1. **Use a Bootstrap-root-delegated Release Authority commit record.** The
   Freshness signer must verify that record, independently read the current
   R2 pointer and immutable Manifest snapshot, and compare them with the
   environment's Durable Object ledger. This is Option B. The HSM signature
   authorizes a specific attempt but does not commit it: the Journal's
   atomic compare-and-append is the release commit linearization point. The
   DO `COMMITTED` row is post-commit coordination state. Freshness requires
   both the current Journal record and matching DO `COMMITTED` state; it is
   not enough to trust values supplied by the HTTP endpoint.
2. **Do not place the Bootstrap root private key online.** The existing public
   pin remains the APP's trust anchor and direct Manifest v2 signer. Under
   this selected design, Manifest v2 signing and root delegation signing stay
   offline. Actual private-key custody/provider is NOT_REGISTERED and
   NOT_VERIFIED. A separate, delegated Release Authority key is held
   non-exportably in an online HSM signer service and signs only commit
   records. A second delegated key signs only Freshness responses.
3. **Use `LATEST_AT_ISSUANCE`.** `issued_at` is captured while a short
   per-environment issue lease is active, after the Freshness signer has
   verified the signed Release Journal head, DO ledger, R2 pointer, Manifest
   snapshot, and Manifest signature. The lease prevents a pointer commit
   between that final verification and response signing.
4. **Bound post-issuance staleness by the APP challenge deadline.** APP starts
   a 10-second monotonic deadline when it sends a fresh challenge and accepts
   no response after that deadline. The DO issue lease is at most 8 seconds.
   The response itself has a maximum 30-second validity interval and the
   existing 30-second wall-clock skew check. A
   release may commit after the response is issued and before APP acceptance;
   this is allowed for `LATEST_AT_ISSUANCE`, but it can make the response
   stale for less than 10 seconds. The number of later epochs is not bounded
   if multiple releases occur in that interval.
5. **Do not claim `LATEST_AT_ACCEPTANCE`.** The client cannot be atomically
   serialized with a future release after the signer's final snapshot without
   holding a distributed release lock through client verification. That
   would make acceptance dependent on a long-lived lock and add avoidable
   availability risk. This protocol does not provide that guarantee.
6. **Keep the Manifest v2 contract unchanged.** The new delegation, commit
   record, and response have separate v1 scopes and signature domains. The
   APP must still verify the complete original Manifest and every referenced
   artifact.
7. **Freshness failure blocks TLSN capture/readiness only.** It must not
   disable normal APP-to-Game-Server proxying or cause a game request retry.

Option A (signer reads only the R2 pointer and a local/current ledger) is
insufficient as the sole rollback witness: the current implementation has no
registered independent ledger, and restoring a ledger with a pointer could
make both appear current. Option C (Bootstrap root signing each online
response) is rejected because it puts the broad Manifest trust key online.
The selected Option B adds a root-delegated Release Authority key and a
separately administered append-only journal; this is a new online trust
assumption and is an explicit human-approval item, not an already existing
property.

## 2. Historical source-confirmed implementation at Phase 0 review start

| Area | Verified source behavior | Limit relevant to Freshness |
|---|---|---|
| APP Bootstrap | `FUSOU_TLSN_RUNTIME_CONFIG_MANIFEST_URL`, signer key ID, and signer SPKI are the three embedded `option_env!` values. All missing is `UNREGISTERED`; partial registration fails. The embedded SPKI directly verifies Manifest v2. See [Bootstrap construction](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_manifest.rs#L156) and [URL validation](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_manifest.rs#L606). | There is no existing delegation registry or Freshness key verifier. The APP's pinned key is the direct Manifest signer for the current v2 contract, not merely a root that currently certifies another Manifest key. |
| APP HTTP fetch | The current reqwest client has redirects disabled, a 5-second connect timeout, and a 15-second request timeout. The response URL must exactly equal the requested URL. See [HTTP fetcher](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_manifest.rs#L457). | The interface currently fetches objects with GET; no nonce POST or Freshness route is implemented. |
| APP Manifest verification | The APP requires the envelope key ID to match the embedded key ID, checks canonical envelope/payload JSON, verifies the Ed25519 signature, then checks schema, time, source freshness and independent artifact bindings. See [`verify_signed_runtime_config_manifest`](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_manifest.rs#L706). | A correctly signed, in-window old Manifest remains a valid Manifest; signature validity alone is not latestness. |
| APP local state | A missing epoch file starts at `0`; a malformed or unsafe existing file errors. After full Manifest and independent artifact verification, APP rejects a lower epoch and same-epoch/different-digest, then atomically persists the new epoch/digest. See [`RuntimeConfigManager::refresh_with_fetcher_at`](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_runtime.rs#L58), [state read](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_runtime.rs#L104), and [state acceptance](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_runtime.rs#L171). | It protects only the surviving APP installation's prior state. State loss resets the local comparison to zero; state is not a global latest-epoch authority and is modifiable by the local owner. |
| Time policy | Current APP policy is 3,600 seconds maximum Manifest lifetime, 30 seconds wall-clock skew, and 600 seconds Worker-reference age. | These limit some replay, but not replay inside the valid window. The proposed 10-second monotonic challenge deadline is an additional protocol rule. |
| Manifest signature bytes | Manifest v2 uses Ed25519 and domain `FUSOU-TLSN-RUNTIME-CONFIG-MANIFEST-V2\0`, followed by `u16_be(key_id length)`, ASCII key ID, and canonical payload bytes. JS and Rust implement the same contract. See [Worker signer bytes](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-manifest.mjs#L404) and [APP signer bytes](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_manifest.rs#L1940). | The new signatures must use distinct domains; no change to these v2 bytes is specified. |
| Manifest publisher | The Node publisher signs and locally verifies the candidate, checks the current pointer and the supplied epoch policy, writes content-addressed artifacts with create-only semantics/readback, revalidates the Worker reference, then conditionally updates the pointer and reads it back. See [`publishTlsnRuntimeConfigWithMode`](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-release.mjs#L178). | `policy.last_accepted_epoch` is supplied to the publisher; it is not a registered durable online high-water authority. |
| Publisher pointer-loss / rollback behavior | If the pointer is absent and the supplied policy epoch is nonzero, the publisher fails closed. If both pointer and supplied high-water are absent/reset to `0`, it permits a newly signed candidate with any epoch greater than `0`. The API signs a `prepared.payload`; it does not accept a previously signed envelope as raw input. | It can re-sign a still-valid old candidate if the caller and signer provide that payload; current code has no independent durable latest epoch. Fresh APPs likewise have no latestness proof and can accept an old Manifest still within existing time/reference limits. Production signing is currently unregistered. |
| R2 pointer | `tlsn/runtime-config/v2/manifest.json` is the mutable pointer and is itself the signed Manifest envelope. Existing S3 `PutObject` uses `If-None-Match: *` for creation and `If-Match: <ETag>` for updates; ambiguous outcomes are reconciled without automatic retry. See [`compareAndSwapManifest`](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-r2-store.mjs#L415). | ETag is an opaque CAS token, not a cryptographic digest. The current allowlist and publication objects do not include an immutable Manifest snapshot. |
| R2 artifacts | Worker reference, Inventory, Target Approval, Security Registry set, and Result Registry envelope are content-addressed artifacts. The mutable Manifest object uses `no-store`; artifacts use immutable cache metadata. See [`createTlsnRuntimeConfigPublicationObjects`](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-manifest.mjs#L722). | The current namespace has no immutable exact Manifest snapshot from which to restore a deleted pointer. A newly signed publication depends on the external epoch policy; it is not authoritative recovery. Phase 1 adds immutable snapshots. |
| Production registration | The signer provider, independent signer pin, APP root, Manifest endpoint, and recovery authority are not registered; Production publishing remains blocked. See [production registration](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-production-registration.mjs) and [publisher readiness](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-publisher-readiness.mjs). | No production endpoint, private signer, R2 permissions, ledger, journal, or recovery authority can be presumed. |
| Existing Worker Durable Object | `TlsnBindingAuthorityDurableObject` and `TLSN_BINDINGS` coordinate proof/session/binding state, not Runtime Config. See [the class](../../FUSOU-TLSN-VERIFICATION-WORKER/src/binding_authority.ts#L647) and [Worker config](../../FUSOU-TLSN-VERIFICATION-WORKER/wrangler.toml). | Do not reuse the proof/session authority namespace for the Release Journal or Freshness. A separate class/namespace and least-privilege service boundaries are required. |
| Freshness code/tests | No Freshness endpoint, delegated key, commit record, response schema, or APP response verifier was found in the inspected APP/Worker source or Runtime Config tests. | The 58 existing Node tests run during this audit cover existing Bootstrap/Manifest/publisher/fake-R2 behavior only; they are not Freshness protocol tests. |

Cloudflare documents SQLite-backed Durable Object storage as transactional
and strongly consistent, with point-in-time recovery to database contents
from up to 30 days earlier. This makes a dedicated DO suitable for serialized
per-environment release transitions, but PITR is itself a possible ledger
rollback; the independent Release Journal remains necessary. The current
`TLSN_BINDINGS` DO is not that authority. See [Durable Object rules](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/index.md)
and [SQLite storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/index.md).

R2 provides strong consistency after a completed operation and atomic S3
conditional `PutObject` writes. Serving the mutable pointer through a caching
custom domain can relax the observed consistency. The signer therefore reads
the R2 S3 API directly with read-only credentials, never a public CDN URL or
Worker Cache API. A `no-store` header is defense in depth, not proof.
See [R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/)
and [R2 conditional `PutObject`](https://developers.cloudflare.com/r2/api/s3/extensions/#conditional-operations-in-putobject).

## 3. Threat model and guarantees

### 3.1 Protected

- A fresh APP with no local state accepts a Manifest only after a challenge
  response binds it to a currently committed Release Journal record.
- The signed response binds environment, audience, fresh nonce, issuance/expiry
  times, epoch, exact raw Manifest bytes, immutable Manifest reference,
  commit generation/ID, both delegated key identities, and semantics.
- The Freshness signer does not trust epoch, digest, URI, pointer generation,
  release state, or ledger values supplied by the HTTP endpoint or APP.
- R2 pointer, DO state, Release Journal head, signed commit record, Manifest
  envelope and immutable snapshot must all agree.
- Root, Release Authority, and Freshness keys have separate signing purposes.
- The Worker still independently verifies the actual TLSN Presentation,
  observed server identity, Origin Inventory, Target Approval, Notary and
  Result Registry. APP freshness is never Worker authority.
- A freshness failure blocks TLSN capture/readiness only; ordinary game
  traffic and its no-retry behavior remain unchanged.

### 3.2 Trust assumptions and excluded guarantees

The embedded Bootstrap public key is part of the trust basis for an
unmodified APP, but the APP binary, process, OS and local state are not a
trust boundary. A hostile local owner can replace the APP or alter/delete its
state. The protocol is a network/server replay defense, not process
attestation, Browser integrity, or proof that the user played a game.
APP delegation-expiry enforcement uses the local OS wall clock with a
conservative ±30-second safety margin; the APP cannot attest that clock's
accuracy. The 24-hour true-time acceptance bound therefore applies only while
the clock remains within that bound. A hostile local owner can alter the
clock or patch the APP, so no absolute client-side expiry guarantee exists
under that excluded threat model. This does not make APP freshness a Worker
trust root.

The Release Journal's authenticated latest-head service and its retention/
administration are new external trust assumptions. A signature authenticates
a record; it cannot prove that a service has shown the newest record. The
Freshness signer trusts the Journal's latest-head operation, cross-checks its
result against the independent DO ledger and R2 pointer, and refuses on any
disagreement. If the Bootstrap root, Release Journal control plane, and
independent recovery records are all compromised or jointly rolled back, no
protocol in this design can prove the former latest state. The only safe
behavior is BLOCKED until an independently authorized recovery.

## 4. Selected trust model — delegated keys and Option B

### 4.1 Key roles

| Role | Key and custody | Allowed operation | Explicitly not allowed |
|---|---|---|---|
| Bootstrap root / current Manifest v2 signer | Existing APP-pinned Ed25519 public key. The private key must remain offline; actual custody/provider is **NOT_REGISTERED / NOT_VERIFIED**. In current source this pin directly verifies Manifest v2; there is no separate Manifest-signer delegation today. | Under the selected design, sign Manifest v2 releases offline and issue root-signed delegations for the Release Authority and Freshness keys. | No online Freshness endpoint, Worker binding, general online signing RPC, or chat-disclosed key. |
| Release Authority | Separate Ed25519 child key delegated by the Bootstrap root; non-exportable in an online HSM or equivalent managed signing service. | Sign only a typed authorization for the exact `POINTER_COMMITTED` attempt after the signer service independently reads and checks DO state, R2 pointer/snapshot and prior Journal head. | No Manifest, Result, Notary, or Freshness-response signature. No R2 pointer-write credential or Journal append/update/delete permission. |
| Freshness signer | Separate Ed25519 child key delegated by the Bootstrap root; non-exportable in an online HSM/managed signing service used only by the dedicated Freshness Signer Worker. | Sign only the fixed `freshness-response-v1` preimage after independently validating the Release Journal, DO ledger, R2 pointer/snapshot and Manifest signature. | No Manifest/Result/Notary signing, R2 write, release-ledger mutation, pointer update, or generic `sign(bytes)` API. |

This adds delegated purposes under the already embedded Bootstrap root, not a
new independent root. The current Manifest v2 direct-root contract is
preserved. The root must remain offline; it may sign Manifest releases and
delegations during an approved release ceremony. An APP release is required
to change the embedded root. No key is created or registered in Phase 0.

### 4.2 Delegation certificate

The response carries two root-signed delegation envelopes: one for the
Release Authority key and one for the Freshness signer key. Both use a strict
exact-field schema, Ed25519 only, and the existing embedded Bootstrap root
key ID/SPKI. Example payload shape:

```json
{
  "schema_version": 1,
  "scope": "fusou-tlsn-runtime-config-delegation-v1",
  "delegation_id": "lowercase-canonical-uuid",
  "delegation_generation": "7",
  "environment": "production",
  "purpose": "freshness-response-v1",
  "key_id": "<delegated-key-id>",
  "public_key_spki": "<base64url-unpadded-ed25519-spki>",
  "signature_algorithm": "Ed25519",
  "audience": "<audience value defined below>",
  "issued_at": "<canonical-utc-root-issuance-time>",
  "not_before": "<canonical-utc>",
  "not_after": "<canonical-utc>",
  "max_validity_seconds": 86400,
  "revocation_mode": "expiry-only-v1",
  "previous_delegation_sha256": "<base64url-sha256-or-null>"
}
```

For `freshness-response-v1`, `audience` is the base64url SHA-256 of the exact
canonical embedded Manifest URL. For `release-commit-record-v1`, it is the
fixed ASCII scope `fusou-tlsn-runtime-config-v2:<environment>`. The
Freshness delegation has a maximum validity of 24 hours; the Release Authority
delegation has a maximum validity of 30 days. Each cap is measured from the
root-signed `issued_at` to exclusive `not_after`, not from first use or
`not_before`. `issued_at` is the approved offline Bootstrap ceremony's UTC
time, not an independent timestamp proof. Require
`issued_at <= not_before < not_after` and
`not_after - issued_at <= max_validity_seconds`; the signed field must be
exactly `86400` for Freshness or `2592000` for Release Authority. No future
`not_before` may extend the cap.

Delegation validity is the half-open interval
`not_before <= signer_now < not_after`. The signer and Journal use their
trusted UTC clock with no Manifest clock-skew grace. APP also checks the
Freshness delegation at final acceptance using a conservative 30-second clock
uncertainty margin:
`app_now - 30s >= not_before` and `app_now + 30s < not_after`. This is not a
permissive skew grace: it shrinks the usable interval so a client whose clock
is within ±30 seconds does not accept before activation or after expiry. The
signed response `issued_at` must also lie in the delegation and
`expires_at <= not_after`. The existing 30-second APP response-time skew
check applies separately to response `issued_at`/`expires_at`; it never
extends delegation validity. A Release Authority delegation is checked at
its signed `authorized_at` and at Journal append time; an already committed
Journal record remains verifiable after that delegation expires.

Assuming the offline root ceremony timestamp is trusted and APP clock error
is bounded by ±30 seconds, the conservative Freshness delegation check means
true-time acceptance never extends beyond `not_after`. The maximum true-time
Freshness-key acceptance window is therefore 24 hours from root-signed
delegation `issued_at`, and Release Authority Journal appends are capped at
30 days from its `issued_at`. The conservative margin
can reject a still-valid delegation by up to 60 seconds at either boundary
(up to 120 seconds of the usable interval in the worst case). This
availability cost is intentional; the Manifest's permissive ±30-second rule
is not reused. If the root ceremony timestamp is untrusted, or the local clock can be wrong
by more than 30 seconds or deliberately changed, no absolute wall-time bound
is claimed; local APP integrity is not a trust root. The monotonic 10-second deadline does not add
to the delegation limit because the strict-safe delegation window is checked
again at the final rename.

These are new delegation checks, not a change to the existing Manifest v2
time policy: its 3,600-second lifetime, 30-second skew, and 600-second
Worker-reference age remain unchanged. The current APP Result Registry has
its own inclusive `not_after` boundary (`not_after == validation_time` is
accepted; see [the existing validator](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_manifest.rs#L1727)).
That unrelated contract is unchanged and is not reused for delegations.
Freshness certificates use the explicitly defined half-open interval and
conservative APP clock window above.

The root-signed delegation envelope has exact fields
`schema_version`, `scope`, `signature_algorithm`, `root_key_id`,
`payload_base64url`, and `signature_base64url`; it uses Ed25519 and a
dedicated `FUSOU-TLSN-RUNTIME-CONFIG-DELEGATION-V1\0` signature domain.
The signing preimage is domain, `u16_be(root_key_id byte length)`, ASCII root
key ID, and canonical payload bytes. The APP and Freshness signer both verify
the root signature, delegation ID/generation, purpose, environment, audience,
algorithm, key ID/SPKI, validity, and previous-delegation link. Unknown
purpose, algorithm, environment, fields or version reject.

Revocation is **expiry-bounded**, not instantaneous for stateless clients.
APP persists the highest accepted delegation generation and rejects a lower
one while that state survives. A fresh APP has no such value and must accept
an unexpired root-signed delegation presented in a nonce-bound response.
Consequently, a compromised delegated key may be used until its delegation
expires unless the Bootstrap root is rotated in a new APP release. A
root-signed revocation object served only by the compromised Freshness signer
cannot provide immediate revocation to a fresh client. Do not claim otherwise.
Renewal must therefore be planned before expiry: an offline-root-signed
successor must link the prior delegation digest and increase generation.
Because the lifetime cap starts at delegation `issued_at`, a future
`not_before` consumes part of that cap. If no valid Freshness delegation is
available at response signing time, Freshness blocks with no expiry grace.
A Release Authority delegation that expires prevents new Journal appends;
it does not invalidate a previously appended current record.

## 5. Release Authority, journal and Freshness signer

### 5.1 Selected verification method

**Option B is selected:** a separate Release Authority key signs a commit
record, and the Freshness signer verifies that record using a root-verified
Release Authority delegation. The signer also reads the R2 pointer and the
release-state DO directly and requires all three views to agree.

The current publisher policy and R2 ETag CAS are not a durable release
authority. A DO by itself is also insufficient as the anti-rollback witness:
as documented in Section 2, SQLite-backed DO storage supports point-in-time
recovery to any point in the preceding 30 days. Restoring that DO can
therefore restore an older high-water. The separate append-only Release
Journal is required for the selected design; it is not in the DO or R2
restore domain.
It must be in a separately administered retention-locked store/service,
outside the R2 bucket used for the mutable Manifest pointer. Its operator and
provider are **NOT_REGISTERED** and require human approval before Phase 1.

### 5.2 Components and permissions

1. **Manifest release preparation:** the protected release workflow validates
   inputs and obtains the v2 Manifest signature through the offline Bootstrap
   signing ceremony. After Phase 1 it submits the exact signed envelope and
   artifact bytes to the Authority Worker; it has no R2 pointer write
   credential.
2. **Runtime Config Authority Worker + DO:** a new Worker owns the only
   Runtime Config R2 writer capability and serializes pointer updates through
   a new SQLite-backed Durable Object namespace, separate from the existing
   `TLSN_BINDINGS` session/proof DO. One DO instance per environment is the
   coordination atom for that environment's single current Manifest. It
   persists `PREPARED`, `POINTER_COMMITTED`, and `COMMITTED` state and tracks
   expiring Freshness issue leases. It has no signing private key. Signer
   Workers bind directly to this same namespace for their typed read/lease
   RPCs; they do not obtain DO state from the Authority Worker's HTTP route.
3. **Online Release Authority signer service:** a managed HSM signer with a
   non-exportable Release Authority child key and a separately deployed
   signer Worker/adapter. The adapter directly binds to the same DO namespace
   and calls the typed `getPreparedRelease` RPC; it independently reads the
   current R2 pointer/snapshot and prior Journal head before invoking the
   HSM. The HSM accepts a typed `authorizeCommit` operation for that exact
   `POINTER_COMMITTED` attempt, not arbitrary bytes or endpoint-supplied
   epoch/digest claims. It has no R2 pointer-write credential, cannot
   update/delete Journal records, and cannot sign Manifest, Result, Notary or
   Freshness-response payloads.
4. **Append-only Release Journal:** stores each Release Authority signed
   commit record and its exact root-signed Release Authority delegation
   envelope create-once, with monotonic per-environment generation and
   previous-record hash. Only the Authority Worker's authenticated
   `commitRelease` operation may call append after matching the
   `POINTER_COMMITTED` DO attempt and durably storing the exact HSM-signed
   authorization in that pending DO attempt. The Journal verifier uses an independently
   provisioned copy of the approved Bootstrap public key, never a caller- or
   APP-supplied root. Before append it verifies the authorization signature,
   delegated purpose, `authorized_at`, and requires
   `authorized_at <= appended_at` with Journal's own append time inside the
   Release Authority delegation. Journal append is atomic
   compare-and-append:
   require the record's previous generation and hash to equal the current
   head, require generation `head + 1` and a strictly greater Manifest epoch,
   then create the record and delegation sidecar once. An exact same-byte
   retry is idempotent; a different record at that generation rejects. The
   Journal records its append time as authenticated entry metadata; that time
   is not part of the pre-append HSM-signed payload. No general update/delete
   API exists. Its authenticated, linearizable latest-head API returns the
   exact record, delegation bytes and append metadata and is the authority
   for which record is newest.
5. **Freshness Gateway:** owns the public same-origin POST route but has no
   signer key, R2 access, DO namespace, or Release Journal credentials. It
   validates request size/shape and passes only protocol version, environment,
   audience and nonce to the signer using a private service binding.
6. **Freshness Signer Worker:** has the delegated Freshness key, read-only R2
   and Journal access, and a direct binding to the same DO namespace for
   `getCurrentCommitted` and the bounded issue-lease RPCs. It has no R2
   writer credential or release-mutation capability. It independently
   fetches and verifies all latest-state material; it accepts no
   endpoint-supplied epoch/digest/URI/state. It does not reuse the existing
   verification Worker's
   `TLSN_BINDINGS` or `TLSN_PRESENTATIONS` bindings.
7. **APP:** verifies both delegations, the Release Authority commit record,
   the Freshness response, the exact immutable Manifest bytes, and then the
   entire existing Manifest v2/artifact contract.

The Authority Worker is the only service with mutable R2 pointer-write and
Release Journal append capabilities. Its `commitRelease` operation accepts
only a Release Authority-signed authorization matching the current
`POINTER_COMMITTED` DO attempt, expected generation/previous-record digest,
environment and exact R2 readback, with no active issue lease. The HSM
signature alone is not a commit. The Authority Worker stores the exact signed
authorization bytes and digest in the pending DO row before attempting
Journal append, so ambiguous outcomes can be reconciled byte-for-byte.
Journal append is create-once and cannot update or delete records; an exact
idempotent replay is accepted only for the same record bytes. The Release
Authority signer returns an authorization but has no Journal write
capability. The Freshness signer has read-only Journal access plus direct DO
read/issue-lease RPCs.

This is a distributed commit protocol, not a cross-service ACID transaction.
R2 CAS, Journal append, and each DO SQLite state transition are separate
linearizable operations with explicit recovery between them. The Journal
append is the release commit point; DO `COMMITTED` records completion of the
coordination state after that point.

Cloudflare does not provide per-method Durable Object ACLs: a namespace
binding is Worker-level reachability, not an operation-level permission
([Durable Objects roles and permissions](https://developers.cloudflare.com/workers/authorization/durable-objects/)).
Therefore the DO RPC contract must authenticate each internal caller and
enforce distinct Release Authority read, Freshness read/lease, and Authority
mutation operations. Signer Workers receive no release-mutation credential;
the Authority Worker receives no HSM key and cannot invoke generic signing.
Worker deployment permissions and these service credentials remain external
approval items. A binding alone is never treated as proof of method-level
least privilege.

The Gateway can deny or delay a challenge but cannot forge a signed response.
The Freshness signer is the online currentness authority; if that signer is
compromised, the stale-Manifest risk in Section 11 applies. The Release
Journal's `getHead` must be a live, authenticated, linearizable operation;
if it is unavailable or cannot distinguish its current head from a stale
head, the signer returns unavailable.

The per-environment DO is used only for Runtime Config release coordination
and Freshness snapshots, not game requests. It is a serialized coordination
point and therefore needs a concurrency/latency test. The current verification
Worker's Wrangler config has a `2026-09-07` compatibility date and no explicit
Logs/Traces settings; any new production Worker must review its compatibility
date against the then-current schema and configure structured Logs and
Traces. No Wrangler config is changed in this task.

### 5.3 Freshness signer validation procedure

The signer accepts only `schema_version`, `scope`, `environment`,
`audience_manifest_url_sha256`, and `request_nonce`. It rejects extra fields
and never accepts `latest_epoch`, `manifest_sha256`, Manifest URI, pointer
version, commit state, journal head, or raw signing bytes from the endpoint.

For every request, the signer itself:

1. validates the pending challenge, canonical audience and Production scope;
2. acquires an at-most-8-second issue lease for the current environment
   generation through the DO's authenticated issue-lease RPC. The DO denies
   it if a release is pending or waiting to publish;
3. queries the Release Journal's authenticated current head directly;
4. fetches the exact authorization record, its delegation sidecar and
   authenticated `appended_at` metadata from that head. It verifies
   `commit_authorization=AUTHORIZE_JOURNAL_APPEND`, the Release Authority
   signature,    `authorized_at <= appended_at`, generation, previous-record hash
   and environment. Both signed authorization time and Journal append time
   must be within the Release Authority delegation;
5. queries `getCurrentCommitted` directly from the same DO namespace and
   requires its state to be `COMMITTED`; generation, epoch, digest, commit ID
   and record digest must equal the Journal head, with no pending attempt;
6. reads `manifest.json` directly from the R2 S3 API using read-only access,
   obtains its opaque ETag and exact raw bytes, and verifies the bytes match
   the commit record's digest and pointer ETag;
7. reads `manifest_ref` from the immutable snapshot namespace and requires
   byte-for-byte equality with the mutable pointer;
8. verifies the Manifest v2 envelope signature with the Bootstrap public key,
   then checks the exact Production schema, epoch, scope and referenced
   metadata against the commit record;
9. checks all observed values again against the request environment/audience
   and Freshness delegation. Capture `issued_at` immediately after the final
   state checks while the lease is valid; this sample is the `LATEST_AT_ISSUANCE`
   currentness point. Require
   `authorized_at <= release_commit_record_appended_at <= issued_at`. Set
   `expires_at = min(issued_at + 30s, freshness_delegation.not_after)`. Refuse
   to sign if the remaining delegation validity is nonpositive;
10. signs the exact response with the Freshness delegated key, then confirms
    the same issue lease is still valid and the signer clock remains in the
    half-open Freshness delegation interval before returning. Because the
    lease prevents a release commit between the `issued_at` sample and
    signature completion, both observe the same head. Release the lease
    through the authenticated DO RPC after signing. If the lease or
    delegation expires during signing, or cannot be confirmed, discard the
    signature and return an error.

If any read is missing, slow, contradictory, stale, unverified or
unauthorized, the signer returns a non-success response without a signature.
It does not serve a cache fallback. The signer signs no endpoint-provided
state and has no path to modify R2, the DO ledger, Journal, Manifest, Worker
bindings, Result Registry or Notary trust.

## 6. Release record state machine and crash recovery

### 6.1 Durable records

The per-environment SQLite DO stores:

- current committed `commit_generation`, Manifest epoch/digest/ref, R2 ETag,
  commit ID, Release Journal record digest and previous-record digest;
- at most one pending attempt with candidate generation, epoch, exact
  Manifest digest/ref, expected previous generation/digest/ETag, attempt ID,
  state, whether the pointer write was started, and (after HSM authorization)
  the exact signed authorization bytes and digest. These bytes are retry
  material, not proof of commit;
- active issue leases keyed by a CSPRNG UUID, containing environment,
  committed generation, acquisition time and expiry (maximum 8 seconds), plus
  writer-pending and recovery-pending gates. Leases do not alter the
  committed release head; recovery has an attempt ID and expected head so its
  external work can be finalized by a DO compare-and-set.
- no private keys, endpoint-supplied "latest" claims, or APP state.

The append-only Release Journal stores the exact signed
`ReleaseCommitRecordV1` bytes at a create-once generation/commit-ID key,
including the previous record hash, and the matching root-signed Release
Authority delegation envelope as an immutable sidecar. Before append, the
Authority Worker verifies both signatures and the prepared attempt. The
Journal atomically compares the record's previous generation/hash and
strictly increasing Manifest epoch against its current head before creating
the next record; it does not trust a caller's head assertion. It also checks
the exact authorization bytes, Release Authority delegation validity at its
own append clock, and requires `authorized_at <= appended_at` with no clock
skew grace. It records authenticated `appended_at` metadata that is not part
of the pre-append HSM signature. The current-head operation returns
the exact record, delegation and append metadata and is part of the Journal
trust contract. The pointer ETag is recorded as an opaque conditional-write
token; the SHA-256 of exact Manifest bytes is the cryptographic identifier.

`ReleaseCommitRecordV1` is an HSM-signed authorization certificate, not a
statement that a distributed release has already committed.
`commit_authorization` authorizes only the Journal append for the identified
attempt. The record is a committed release only after its exact bytes are
successfully appended to the canonical Journal chain. The Journal's
authenticated append time is metadata created at that append; it cannot be
pre-signed into the HSM record.

The signed record payload is:

```json
{
  "schema_version": 1,
  "scope": "fusou-tlsn-runtime-config-release-commit-v1",
  "environment": "production",
  "commit_authorization": "AUTHORIZE_JOURNAL_APPEND",
  "commit_generation": "18",
  "release_commit_id": "lowercase-canonical-uuid",
  "manifest_schema_version": 2,
  "manifest_epoch": "43",
  "manifest_sha256": "<base64url-sha256-of-exact-envelope>",
  "manifest_ref": "tlsn/runtime-config/v2/manifests/<same-digest>",
  "pointer_etag": "<opaque-exact-r2-etag>",
  "previous_commit_generation": "17",
  "previous_commit_record_sha256": "<base64url-sha256>",
  "authorized_at": "2026-11-01T00:00:00.000Z",
  "release_authority_delegation_id": "lowercase-canonical-uuid",
  "release_authority_delegation_sha256": "<base64url-sha256>"
}
```

`authorized_at` is included in the Release Authority signature and must fall
inside the delegated key's half-open validity interval. The Journal records
its own authenticated `appended_at` metadata and accepts the authorization
only while its own clock is also inside that interval. An unappended signed
authorization is an orphan, never a COMMITTED record and never APP input.
`commit_state` is intentionally absent from this pre-implementation v1 schema;
the prior draft field name is not a legacy format to accept. If any prototype
has already emitted the old shape, reject it or explicitly version that
prototype rather than treating an HSM signature as COMMITTED.

For genesis, generation is `1`, Manifest epoch is positive, and both
previous-generation fields are `null`; genesis requires an explicit
root-approved authorization. A missing DO record or R2 pointer is never
interpreted as permission to initialize epoch `0`.

### 6.2 State transitions

| State | Meaning and durable data | Allowed transition and CAS | Signer may respond? |
|---|---|---|---|
| `PREPARED` | Candidate Manifest/artifact/snapshot bytes were validated and written immutably. DO records candidate epoch/digest/ref, attempt ID, expected previous generation/digest/ETag, and `pointer_write_started=false`. No commit is authoritative. | `beginRelease` compares the current head and lease table in a DO transaction. If no lease exists, that transaction admits the attempt as `PREPARED`; if a lease exists, it sets writer-pending/`WAITING_FOR_LEASES` and the same attempt is retried after leases drain, where a DO transaction changes it to `PREPARED`. `PREPARED -> POINTER_COMMITTED` requires R2 `If-Match` on the expected ETag (or authorized genesis `If-None-Match: *`) and exact pointer/snapshot readback. | **No.** Any pending attempt blocks Freshness. |
| `POINTER_COMMITTED` | R2 mutable pointer and immutable snapshot contain the exact candidate bytes; actual ETag is recorded. Journal does not yet contain this release. | The Release Authority signer may issue an HSM-signed `AUTHORIZE_JOURNAL_APPEND` authorization only after direct DO/R2/prior-Journal checks. Journal append is a separate operation and the release commit point. After a successful append/readback, DO verifies the exact current Journal record and R2 state, then separately CASes this row to `COMMITTED`. | **No.** A signed authorization or pointer without a canonical Journal append is not a committed release. |
| `COMMITTED` | DO coordination row agrees with the current Journal head/record, authenticated Journal append metadata, R2 pointer, immutable Manifest snapshot and Manifest signature at the same environment, generation, epoch, digest and commit ID. The Journal append already committed the release. | Next release requires generation `current+1`, strictly greater Manifest epoch, matching previous digest/generation and CAS against current ETag. Same epoch/different bytes rejects. | **Yes**, only after the Freshness signer sees the current Journal record and matching DO `COMMITTED` state, plus all Section 5.3 R2/snapshot checks. |
| `ABORTED` (terminal attempt) | A pre-pointer attempt was cancelled after proving the pointer write was never started and the old pointer is unchanged. Record attempt ID and reason; never lower current generation. | A new attempt starts with a new attempt ID and current generation. An ambiguous/in-flight write cannot be aborted automatically. | Only if the current `COMMITTED` head and all sources still agree. |

No operation below is a cross-service ACID transaction. DO transactions
linearize only DO state; R2 conditional writes and Journal compare-and-append
have their own independent linearization points.

| Operation | Start condition | Success and linearization point | Failure/crash result |
|---|---|---|---|
| `beginRelease` | Immutable artifacts and Manifest snapshot have been create-only written and byte-readback verified; attempt ID and expected prior head are fixed. | A DO transaction sets `writer_pending`. If leases exist, it records `WAITING_FOR_LEASES`; otherwise the same transaction also creates `PREPARED`. Its commit is the admission point. | No pointer or Journal change. If waiting, retry the same attempt after leases drain; if the head changed, reject and leave only immutable orphans. |
| `PREPARED` | `writer_pending` is set, no valid issue lease remains, and the expected generation/digest/ETag still equal the DO current head. | A DO transaction stores the exact candidate, prior-head fields, and `pointer_write_started=false`; on a waiting attempt this is the retry transaction. Its commit is the `PREPARED` point. | If the transaction does not commit, there is no PREPARED attempt; immutable objects remain uncommitted orphans. |
| R2 pointer CAS | `PREPARED`; a DO transaction first sets `pointer_write_started=true`; no lease can be active. | The successful conditional `PutObject` (`If-Match` or authorized genesis `If-None-Match: *`) is the R2 pointer linearization point. | A conflict is not retried against a new head. On an ambiguous result, keep the attempt pending and read back; do not assume failure. |
| `POINTER_COMMITTED` | R2 CAS may have succeeded; Authority Worker directly reads pointer and snapshot. | After exact bytes, digest and actual ETag match, a DO transaction records the observation. That transaction commit is the coordination-state point, not the release commit. | A crash after R2 CAS leaves `PREPARED`; recovery re-reads R2 and advances only on exact match. Mismatch/unknown stays blocked. |
| Release Authority HSM signing | `POINTER_COMMITTED`; signer directly checks pending DO attempt, pointer/snapshot, prior Journal head and delegation validity. | HSM signature creation is an authorization artifact only. It has no release-commit linearization point. | A returned but unappended signature is an orphan authorization. Do not send it to APP or mark DO `COMMITTED`. |
| Persist signed authorization | HSM returned a valid authorization; the DO attempt and writer-pending gate still match. | The Authority Worker invokes `storeCommitAuthorization`; a DO transaction stores the exact authorization bytes and digest in the pending attempt. This is durable retry material only, not a commit point. | If persistence fails, the HSM signature remains an orphan; do not append it or expose it to APP. Reauthorize only after revalidating the same attempt and Journal head. |
| Journal compare-and-append | Exact signed authorization bytes are read from DO and verify; Journal head still equals the authorization's previous generation/hash; generation and Manifest epoch advance; append time is within the delegation. | The Journal's atomic successful append of exact record and delegation bytes is the **release commit linearization point**. Journal position plus authenticated append metadata establishes canonical membership. | On an ambiguous result, query the linearizable head. Exact bytes at the expected position mean append succeeded; unchanged prior head permits retrying only the exact stored bytes; conflicting head blocks for recovery. A signature alone never commits. |
| DO `COMMITTED` | Journal confirms the exact authorization is the canonical committed record; R2 pointer/snapshot and expected attempt match it. | A DO compare-and-set transaction stores the Journal record digest and clears the pending attempt. This is post-commit coordination completion, not a second or replacement commit point. | If the process crashes or the transaction fails after Journal append, Freshness remains blocked. Recovery reconstructs this DO row from the exact Journal record/delegation and R2 readback without allocating a new generation. |
| Freshness issue lease acquisition | No writer-pending release, pending attempt, recovery gate, or stale state. | One DO transaction verifies the current `COMMITTED` generation and inserts the bounded lease. Its commit is the lease grant point. | If release/recovery gate won first, reject. If lease won first, release/recovery must wait; no R2 CAS or Journal append is allowed. |
| Freshness response signing | Active lease; signer has verified the Journal's current head, DO `COMMITTED` row, R2 pointer/snapshot, Manifest signature and active Freshness delegation. | Sampling `issued_at` immediately after those checks is the `LATEST_AT_ISSUANCE` currentness linearization point. The HSM must return the signature while the same lease and delegation remain valid; no release commit can interleave between the sample and signature. | If signing fails, the lease/delegation expires, or state mismatches, discard the signature and return no response. A process crash before HTTP delivery leaves no APP acceptance; the lease is released explicitly or expires. |
| Issue lease release | A lease exists for the exact request. | A DO transaction deletes that lease after response signing; its commit releases the serialization guard. | If the release RPC fails or the process crashes, expiry removes the guard; a release writer must still revalidate all expected head values. |
| Recovery admission | Freshness issuance is disabled by the controlled kill switch. | A DO transaction sets a recovery/writer-pending gate only when no valid lease exists; that transaction is the recovery admission point. Recovery then performs external reads/writes outside SQLite transactions and finalizes each DO change with an expected-head CAS. | If a lease exists, recovery waits or fails closed; it cannot bypass or delete the lease. A Journal-absent authorization can never be promoted to `COMMITTED`. |

If `beginRelease` arrives while issue leases exist, the DO enters a bounded
`WAITING_FOR_LEASES` admission substate: it marks a writer pending, blocks new
leases, and performs no pointer write. After the existing leases finish or
expire, the caller retries the same attempt ID; the DO revalidates the
committed generation, digest and ETag before creating `PREPARED`. The wait expires after 10 seconds; if `pointer_write_started=false` and no
valid issue lease remains, expiry atomically marks only that attempt `ABORTED`
and clears its writer-pending gate, leaving immutable objects as uncommitted
orphans. If a valid lease remains, keep the gate and wait/fail closed. If
pointer writing started, the attempt cannot be auto-aborted; direct R2
readback/recovery remains required.

Each DO state transition is one synchronous SQLite transaction or conditional
SQL operation that checks the expected head/attempt and commits its state
change atomically. Do not `await` between related SQL writes, and fully consume
SQL cursors before any `await`; Cloudflare documents that a cursor held across
an `await` is not a stable snapshot. R2, Journal, and HSM I/O always occur
outside DO transactions. After that external I/O, the DO rechecks the expected
attempt/generation in a new transaction before advancing. There is no
cross-service ACID transaction. `PREPARED` records
`pointer_write_started=false`; a separate DO transaction sets it to `true`
immediately before the R2 CAS. ETags are exact CAS values; body digests are
recomputed from bytes.

Freshness issue leases are separate from release states and expire after at
most 8 seconds. Lease acquisition and `beginRelease`/recovery gates use
transactions on the same per-environment DO, so they are totally ordered:
if lease acquisition commits first, `beginRelease` sets writer-pending,
refuses later leases and waits for that lease to finish/expire; if
writer-pending commits first, lease acquisition rejects. The same rule applies
to recovery. The DO allows multiple bounded readers of one committed
generation, but no pointer CAS or Journal append while any valid lease exists.
The Gateway enforces a finite in-flight limit and returns unavailable above it.
The signer acquires the lease before its final Journal/DO/R2 checks and keeps
it through response signing. It releases the lease after successful signing
or lets bounded expiry release it after failure. It checks the lease again
after the HSM returns and discards the signature if the lease expired during
signing. The APP's 10-second monotonic response deadline is longer than the
signer's bounded lease budget. No DO storage transaction is held across R2,
Journal, or signer I/O.

The Authority Worker's sole `commitRelease` operation checks the lease table
and writer-pending attempt before R2 CAS, Journal append, and the later DO
`COMMITTED` update. It is an orchestrator for separate operations, not one
transaction spanning those services. Only this operation has the Journal
append credential; the Release Authority HSM returns an authorization but
cannot append/update/delete. The Authority Worker persists the exact signed
bytes in the pending DO attempt before calling Journal append. The Freshness
signer can only read Journal state and acquire/release its lease. While that
lease remains valid, no authorized pointer or Journal-head update can commit
between its final consistency read and response signing. If the lease expires
while the HSM call is in flight, a release may proceed, but the signer
discards the signature after the post-call lease check and emits no response.

Recovery enters the same DO serialization gate: disable new Freshness
issuance, atomically set `recovery_pending`/writer-pending only when no valid
lease exists, and wait rather than bypassing an active lease. Perform recovery
I/O outside the DO transaction, then finalize with an expected-head CAS.
Re-enable Freshness only after Journal, DO, R2 pointer and snapshot agree.
`POINTER_COMMITTED` is provisional and cannot authorize Freshness. The
Release Authority signature alone is not a commit; Journal append is the
commit point, and the subsequent DO `COMMITTED` update is required before a
Freshness response.

### 6.3 Required crash and recovery behavior

| Failure | Detection | Required action |
|---|---|---|
| 1. Stop after `PREPARED`, before pointer write | `pointer_write_started=false`; pointer remains the recorded previous ETag/digest. | Abort the attempt or retry the exact candidate after readback. No Freshness response while pending. |
| 2. Stop after pointer CAS, before `POINTER_COMMITTED`/`COMMITTED` | DO has `PREPARED`; direct R2 pointer may equal the exact candidate. | If exact pointer/snapshot match, advance to `POINTER_COMMITTED`, then require the Release Authority signature and Journal append. If not exact or outcome is unknown, stay blocked. |
| 3. DO ledger and R2 pointer disagree | Generation, epoch, digest, ETag or commit ID mismatch. | No signature; freeze publishing; reconcile from signed Journal record and immutable snapshot. |
| 4. Pointer returns to an older generation | Journal/DO head exceeds pointer generation/epoch/digest. | Reject as rollback. Restore exact latest snapshot under approved recovery or publish a strictly higher epoch; never accept the older pointer. |
| 5. Same epoch has another Manifest digest | Release record/DO current epoch has a different digest. | Reject; correct forward with a strictly higher Manifest epoch. |
| 6. Only some immutable artifacts/snapshot exist | Publisher has no matching `COMMITTED` record; exact snapshot/readback or input digest fails. | Do not move pointer or sign. Leave immutable orphans for retention-controlled cleanup. |
| 7. Signer reads while commit is in progress | DO state is pending, Journal head is old/new but not matching, or R2 pointer has moved before `COMMITTED`. | Return unavailable without signature. Retry requires a new APP nonce after the release resolves. |
| 8. HSM authorization succeeds, then the process crashes or Journal append fails | If the authorization was not stored in the pending DO attempt, it is an orphan; if stored, it remains pending and uncommitted. | Never return it to APP. Keep Freshness blocked. If stored, retry only the exact bytes after revalidating the attempt and unchanged prior Journal head; if not stored, reauthorize only after the same revalidation. |
| 9. Process crashes immediately before/after Journal append or append outcome is ambiguous | Query the Journal's linearizable head by environment/generation/commit ID. | Exact same bytes at the expected next position means append committed; unchanged prior head means it did not and permits only exact-byte retry; any competing/mismatched head remains BLOCKED. |
| 10. Journal append succeeds, then DO `COMMITTED` update fails or crashes | Journal contains the canonical commit, while DO is still `POINTER_COMMITTED`/pending. | No Freshness response. Recovery verifies Journal entry, delegation, append metadata, pointer and snapshot, then repairs the DO to `COMMITTED` at the same generation; never append a second generation. |
| 11. Recovery races an active Freshness lease | The DO transaction observes a valid lease or a pre-existing recovery/writer-pending gate. | Recovery cannot bypass the lease. Disable issuance, wait for release/expiry, then re-read all authorities before recovery admission. |
| 12. DO ledger is lost, R2 pointer remains | No current DO state; Journal retains the signed commit chain/head. | Freshness stays blocked. Restore DO only from a verified Journal chain plus pointer/snapshot readback; do not initialize at zero. |
| 13. R2 pointer is lost, ledger/Journal remain | Missing mutable `manifest.json`; current generation remains nonzero. | Freshness stays blocked. Restore the exact content-addressed snapshot with conditional create, verify ETag/body, then re-enable only after all sources agree. |
| 14. R2 backup restore makes an old pointer visible | DO/Journal head has greater generation/digest. | Detect mismatch and block. A restore of DO or Journal state too must be treated as an authority incident; compare the independent WORM checkpoint. If every independent source has been rolled back, no automatic cryptographic recovery exists. |

An ambiguous R2 write is never silently retried by the current publisher.
R2 documentation warns that a negative read does not prove an earlier
in-flight write failed. The transition remains pending until the exact outcome
is reconciled. The WORM Journal must not be in the R2 bucket being restored.
If the Journal itself is missing, corrupted or returns a head inconsistent
with the signed chain/DO/pointer, Freshness is BLOCKED. Recovery requires an
independently retained signed checkpoint and two-person approval (Release
Authority custodian plus Bootstrap Trust custodian). Without a trustworthy
checkpoint, the system must remain blocked or undergo an explicitly approved
new APP trust-root release; it must never reset the sequence to zero.

## 7. Freshness wire protocol

### 7.1 Request

The APP sends a body no larger than 1 KiB to the derived HTTPS route
`/tlsn/runtime-config/v2/freshness/v1`:

```json
{
  "schema_version": 1,
  "scope": "fusou-tlsn-runtime-config-freshness-request-v1",
  "environment": "production",
  "audience_manifest_url_sha256": "<base64url-sha256>",
  "request_nonce": "<base64url-of-32-random-bytes>"
}
```

The request is not a signing authority. It contains no epoch, digest, URI,
ETag, pointer generation, release state, commit record or raw signing bytes.
The endpoint returns `Cache-Control: no-store`; CDN and Cache API are bypassed.
Redirects, query parameters, extra JSON fields, oversized bodies and unknown
environments reject.

### 7.2 Response envelope and payload

The response carries the two root-signed delegations and the exact signed
Release Commit Record as base64url sidecars. Their exact-byte SHA-256 hashes
are inside the signed payload, so sidecar replacement is detected.

```json
{
  "schema_version": 1,
  "scope": "fusou-tlsn-runtime-config-freshness-envelope-v1",
  "signature_algorithm": "Ed25519",
  "signer_key_id": "<freshness-child-key-id>",
  "freshness_delegation_base64url": "<root-signed-delegation>",
  "release_authority_delegation_base64url": "<root-signed-delegation>",
  "release_commit_record_base64url": "<release-authority-signed-record>",
  "payload_base64url": "<base64url-of-canonical-payload>",
  "signature_base64url": "<base64url-ed25519-signature>"
}
```

Signed response payload:

```json
{
  "schema_version": 1,
  "scope": "fusou-tlsn-runtime-config-freshness-response-v1",
  "freshness_semantics": "LATEST_AT_ISSUANCE",
  "environment": "production",
  "audience_manifest_url_sha256": "<base64url-sha256>",
  "request_nonce": "<exact-request-nonce>",
  "issued_at": "2026-11-01T00:00:00.000Z",
  "expires_at": "2026-11-01T00:00:30.000Z",
  "latest_epoch": "43",
  "manifest_schema_version": 2,
  "manifest_sha256": "<base64url-sha256-of-exact-envelope>",
  "manifest_ref": "tlsn/runtime-config/v2/manifests/<same-digest>",
  "pointer_generation": "18",
  "release_commit_id": "lowercase-canonical-uuid",
  "release_commit_record_sha256": "<base64url-sha256-of-exact-record-envelope>",
  "release_commit_record_appended_at": "2026-11-01T00:00:00.000Z",
  "freshness_signer_key_id": "<freshness-child-key-id>",
  "freshness_delegation_id": "lowercase-canonical-uuid",
  "freshness_delegation_sha256": "<base64url-sha256-of-exact-delegation>",
  "release_authority_key_id": "<release-child-key-id>",
  "release_authority_delegation_id": "lowercase-canonical-uuid",
  "release_authority_delegation_sha256": "<base64url-sha256-of-exact-delegation>"
}
```

### 7.3 Field contract

Every payload field is covered by the Freshness response signature. Sidecar
bytes are covered by their digest fields. Unknown or missing fields reject.

| Field | Type/canonical form | Source and validation | Security purpose |
|---|---|---|---|
| `schema_version`, `scope` | JSON integer `1`; exact ASCII scope string | APP requires exact values. | Prevent downgrade and cross-protocol use. |
| `freshness_semantics` | Exact ASCII enum `LATEST_AT_ISSUANCE` | Must match the selected guarantee. | Prevent claiming a stronger guarantee. |
| `environment` | Exact lowercase enum `production` (current APP) | Must match APP bootstrap and both delegations. | Prevent Production/Canary substitution. |
| `audience_manifest_url_sha256` | 32-byte SHA-256, canonical base64url without padding (43 chars) | Recomputed from exact canonical embedded Manifest URL bytes. | Prevent cross-origin/manifest-endpoint replay. |
| `request_nonce` | 32 random bytes, canonical base64url without padding | Exact equality with the one outstanding APP challenge. | Bind this response to one attempt. |
| `issued_at`, `expires_at` | UTC RFC3339 with exactly millisecond precision and `Z` | Signer time; APP applies the separate <=30-second response-time skew and <=30-second TTL. `expires_at` is never later than Freshness delegation `not_after`; APP checks the conservative delegation window again at final rename. The monotonic deadline is independent. | Limit replay and detect clock/expiry errors without extending delegation validity. |
| `latest_epoch` | Canonical unsigned decimal string, no leading zero, in Manifest v2 UInt64 range | From Release Journal head and must equal commit record and Manifest payload. | Bind current release epoch. |
| `manifest_schema_version` | JSON integer `2` | Must equal the fetched Manifest v2 schema. | Prevent schema confusion. |
| `manifest_sha256` | SHA-256 of exact raw signed Manifest envelope, base64url without padding | Recomputed from the immutable snapshot bytes. | Prevent body substitution/whitespace reserialization. |
| `manifest_ref` | Exact relative key `tlsn/runtime-config/v2/manifests/<manifest_sha256>` | Must match digest and fixed namespace; no URL accepted from caller. | Identifies recoverable immutable bytes. |
| `pointer_generation` | Canonical unsigned decimal string, no leading zero | Must equal Release Journal generation and DO committed generation. | Bind the R2 pointer transition, not just Manifest epoch. |
| `release_commit_id` | Lowercase canonical UUIDv4 | Must equal signed commit record. | Uniquely bind this commit attempt. |
| `release_commit_record_sha256` | SHA-256 of exact signed record envelope, base64url without padding | Recomputed from response sidecar. | Bind the independently signed commit authorization. |
| `release_commit_record_appended_at` | Canonical UTC millisecond timestamp from the authenticated Journal head entry | Freshness signer verifies it is the append metadata for the exact current-head record, satisfies `authorized_at <= appended_at`, falls inside the Release Authority delegation, and is no later than response `issued_at`. | Bind the record's canonical Journal commit time and show the authorization entered the chain while its signing delegation was active. |
| `freshness_signer_key_id` | Existing key-ID grammar `[A-Za-z0-9._-]{1,128}` | Must equal envelope key ID and Freshness delegation. | Select the purpose-limited response key. |
| Freshness delegation ID/digest | UUID plus exact-envelope SHA-256 | Recompute and verify root signature, purpose, audience, issuance cap and generation; enforce the conservative APP validity window without Manifest skew. | Bind the delegated response signer and bound its acceptance lifetime. |
| Release Authority key ID/delegation ID/digest | Key ID, UUID, exact-envelope SHA-256 | Recompute and verify root signature, `release-commit-record-v1` purpose, `authorized_at` and the Freshness-signed Journal `appended_at` against the half-open interval. | Bind the independent commit authorization; expiry does not invalidate already appended valid records. |

The Release Commit Record sidecar contains
`commit_authorization=AUTHORIZE_JOURNAL_APPEND`, environment, generation,
Manifest epoch/schema/digest/ref, pointer ETag, release commit ID, previous
generation/record digest, `authorized_at`, Release Authority key ID and
delegation digest. Its exact bytes are hashed above and its signature is
verified with the Release Authority key certified by the Bootstrap root.
The signed record does not contain `committed_at`: only authenticated Journal
append metadata establishes when it entered the canonical chain. The Freshness
signer includes that metadata in its own signed response after confirming the
record is the current Journal head and the DO is `COMMITTED`.

## 8. Canonicalization and signature bytes

### 8.1 URL and audience

The existing APP bootstrap URL validator remains authoritative:

- HTTPS only; a DNS hostname accepted by `ServerIdentity`; no username,
  password, explicit port, query, or fragment.
- Exact path `/tlsn/runtime-config/v2/manifest.json`; no trailing slash,
  alternate path, path percent-encoding, or path normalization.
- `Url::as_str()` must equal the original input. Scheme/hostname variants that
  the parser would normalize are rejected; host is canonical lowercase ASCII
  DNS. Raw Unicode hostnames are rejected; use an accepted ASCII DNS name.
- Default port 443 is implicit and must not be written explicitly. No
  hostname alias is accepted unless it is the embedded URL.
- Query order/duplicates have no representation because any query is
  forbidden.

`audience_manifest_url_sha256` is
`base64url_no_pad(SHA256(UTF8(exact_validated_manifest_url_string)))`.
The APP derives the Freshness route by replacing only the fixed final
`manifest.json` path component with `freshness/v1` on the same origin; no
fourth build-time locator is introduced. It does not accept a URL from a
response or request.

### 8.2 JSON and byte encodings

- Reuse the repository's JS `canonicalJson` and Rust `canonical_json_bytes`
  implementations and cross-language golden vectors; do not use a generic
  “JSON looks equivalent” rule.
- The protocol schema contains only exact ASCII property names and ASCII
  string values (base64url, UUID, key ID, enums, decimal strings, timestamps,
  object keys). No floats, arbitrary Unicode, arrays, duplicate keys,
  unknown fields, BOM, or insignificant whitespace are accepted.
- Serialize object keys using the existing canonical helper, compact UTF-8
  JSON; require `canonical_json(parsed) == raw_bytes`. The same schema/vector
  is verified in APP Rust and Worker JavaScript.
- Epoch, generation and pointer generation are decimal strings with no
  leading zero except the value `"0"` where explicitly permitted for
  previous-generation fields. Manifest epoch and committed generation are
  positive.
- SHA-256 values are 32 bytes encoded as unpadded base64url, exactly 43 ASCII
  characters. SPKI is DER Ed25519 SubjectPublicKeyInfo encoded as unpadded
  base64url. Signature is exactly 64 bytes encoded the same way.
- Timestamps are exactly `YYYY-MM-DDTHH:MM:SS.sssZ`; alternate offsets,
  missing milliseconds, extra precision, and noncanonical strings reject.

### 8.3 Domain-separated signatures

Keep current Manifest v2 signing bytes unchanged:

```text
ASCII("FUSOU-TLSN-RUNTIME-CONFIG-MANIFEST-V2\0")
|| uint16_be(key_id_ascii_length) || ASCII(key_id)
|| canonical_manifest_payload_utf8
```

New signatures each use a distinct domain and purpose:

```text
Bootstrap delegation:
ASCII("FUSOU-TLSN-RUNTIME-CONFIG-DELEGATION-V1\0")
|| uint16_be(root_key_id_ascii_length) || ASCII(root_key_id)
|| canonical_delegation_payload_utf8

Release commit:
ASCII("FUSOU-TLSN-RUNTIME-CONFIG-RELEASE-COMMIT-V1\0")
|| uint16_be(release_authority_key_id_ascii_length)
|| ASCII(release_authority_key_id)
|| canonical_release_commit_payload_utf8

Freshness response:
ASCII("FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-RESPONSE-V1\0")
|| uint16_be(freshness_key_id_ascii_length) || ASCII(freshness_key_id)
|| canonical_freshness_payload_utf8
```

Every component adds a fixed scope string and exact-field validation. A key
valid for one domain is never accepted in another domain. Shared test vectors
must prove identical JS/Rust bytes, including boundary key-ID lengths,
timestamp spelling, payload digest, envelope canonicality and malformed
duplicate-field rejection.

## 9. APP verification and local state algorithm

For each TLSN capture/readiness refresh, APP performs these steps in order:

1. Load and validate all three embedded Bootstrap values. Missing/incomplete
   input rejects. Do not fall back to a build-time operational endpoint,
   cached unverified Manifest, or local epoch `0`.
2. Construct the exact same-origin Freshness URL and generate 32 CSPRNG bytes.
   Immediately before sending the challenge, start one monotonic 10-second
   deadline and retain the nonce only in pending request state.
3. Send one bounded HTTPS POST. No redirects, GET query nonce, auto retry, or
   request replay. Reject if a response does not arrive before the deadline.
4. Parse the exact response envelope and reject unknown/duplicate fields,
   noncanonical JSON, wrong version/scope, environment, URL audience, or
   invalid base64url.
5. Verify the Release Authority delegation with the embedded Bootstrap root;
   verify its signed `issued_at`, purpose-specific 30-day cap, key ID,
   Production scope, audience, generation and previous-delegation link.
   Do not require this historical Release Authority delegation to remain
   active at response acceptance.
6. Verify the exact Release Commit Record authorization signature and
   `commit_authorization=AUTHORIZE_JOURNAL_APPEND`, environment, generation,
   Manifest schema/epoch/digest/ref, ETag, commit ID and previous-record link.
   Require its signed `authorized_at` to lie inside the Release Authority
   delegation's half-open validity interval.
   Recompute its exact-byte digest and require it to equal the signed
   Freshness payload. The record's signature alone is not proof of commit:
   APP accepts it only inside a Freshness response whose signer attests that
   it is the current Journal head and the DO is `COMMITTED`.
7. Verify the Freshness delegation with the same embedded Bootstrap root;
   require its signed issuance time, 24-hour cap, purpose
   `freshness-response-v1`, correct environment/audience/key ID, generation,
   and the conservative clock-safety window
   `app_now - 30s >= not_before` and `app_now + 30s < not_after`. This is an
   early-reject margin, not a 30-second acceptance grace.
8. Verify the response signature with the delegated Freshness public key.
   The response key ID and delegation ID/digest must match exactly.
9. Require exact nonce equality with the outstanding one-use challenge,
   `LATEST_AT_ISSUANCE`, correct audience/environment, and response times
   within the separate 30-second response clock-skew rule and 30-second
   maximum TTL. Require
   `authorized_at <= release_commit_record_appended_at <= issued_at`.
   Validate the Freshness-signed append time against the Release Authority
   delegation; the Freshness signature attests that it came from the exact
   current Journal head. Require response `issued_at` inside the Freshness
   delegation and `expires_at <= freshness_delegation.not_after`.
   The response skew never relaxes delegation validity. Consume/discard the
   nonce on every outcome. Check the same monotonic deadline; do not start a
   new timeout for any following fetch.
10. Fetch `manifest_ref` from the same origin's immutable snapshot path and
    fetch every referenced artifact using the remaining portion of that same
    deadline. Hash each exact response body before parsing; the Manifest bytes
    must equal `manifest_sha256` and the Release Commit Record. Do not
    fetch/re-serialize JSON to compute these digests. Recheck the monotonic
    deadline after the snapshot and each artifact fetch/hash; abort the
    verification as soon as the shared deadline expires.
11. Run the existing full Manifest v2 verification unchanged: root signer
    key ID/signature, schema/scope, expiry, 30-second clock policy,
    600-second Worker reference, all independent artifact digest checks,
    Notary/config Registry validation and Production target pins.
12. Require Manifest payload epoch to equal both `latest_epoch` and the
    Release Commit Record epoch. Require `manifest_schema_version=2`.
13. Compare to local state: reject a lower epoch; at equal epoch require the
    same Manifest digest and commit generation/record digest; reject a lower
    delegation generation. A fresh client with no state still requires every
    online proof above.
14. Prepare the versioned state in a uniquely named temporary file, write all
    bytes and `fsync` that file without changing the current canonical state.
    Immediately before the atomic rename, check the same monotonic deadline
    again and sample fresh UTC `app_now` (not the earlier Manifest
    `policy.now`). Require the Freshness delegation still inside its
    conservative clock-safety window and recheck the separate response-time
    rule. Perform no `await` or unrelated I/O between these checks and rename.
    If the deadline is 10 seconds or more, the response expired, or the
    delegation is no longer active, remove the temporary file, discard the
    verified result, and do not change epoch, digest, commit generation,
    record digest, delegation generation, or last signed time. Otherwise,
    atomically rename the complete state file and then sync the parent
    directory for durability.
    The rename is the acceptance/persistence linearization point.

If the parent-directory sync fails after rename, return an explicit state
durability error and do not expose the verified Runtime Config for capture.
The canonical path may already contain the new high-water because rename has
linearized; the next attempt must read that state and reconcile it with a
fresh server proof, never roll it back automatically.

Receiving a response before the deadline is not acceptance. The response
receipt time is distinct from the final acceptance time: all immutable
Manifest/artifact fetches and verification must finish, and the final
monotonic check must pass, before the atomic state rename can accept the
Runtime Config.

The current [`HttpRuntimeConfigObjectFetcher`](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_manifest.rs#L456)
uses a 5-second connect timeout and 15-second request timeout. Do not change
that existing fetcher as part of this design. Phase 3 adds a separate
Freshness-scoped client with redirects disabled, a 2-second connect limit,
and a per-request timeout no greater than 10 seconds. One shared monotonic
deadline starts immediately before the Freshness POST and is passed through
the POST, immutable Manifest fetch, all artifact fetches, verification and
the final state commit; per-request timeouts never reset it.

The current [`RuntimeConfigEpochStateStore::write_atomic`](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_runtime.rs#L200)
and [`replace_state_file`](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_runtime.rs#L265)
are synchronous Rust functions: the temporary file is written and `fsync`ed,
then the OS atomic replace (`fs::rename` on non-Windows and synchronous
`MoveFileExW` on Windows) occurs before parent-directory sync. The Freshness
implementation must keep temporary-file writes/fsync before the last check,
then call a synchronous atomic replace with no async yield between check and
rename. If an async filesystem API is used for preparation, complete and
`fsync` its temporary file before the check; the final rename still must be a
synchronous operation. If that cannot be guaranteed on a target platform,
fail closed rather than moving the deadline check earlier.

The existing state file schema is v1 and stores only epoch/digest. Phase 3
must migrate to a strict v2 state atomically while preserving v1 high-water.
If the state is absent after first install/reinstall/data loss, use the online
Freshness/Release Authority proof and then persist the current record. If the
state is malformed or corrupt, do not silently initialize `0`; block TLSN,
obtain a successful current challenge and full Manifest validation, then
replace the corrupt state atomically. If the authority is unavailable, remain
blocked. A state value above the server head indicates rollback/authority
recovery trouble; never lower it automatically.

An OS backup that restores an older local state is safe only while the
server-side Release Journal and pointer are current: APP still requires a
fresh proof of the current committed record. A high-water state greater than
the current Journal head blocks. A large wall-clock rollback is rejected by
the persisted signed server-time high-water and 30-second skew bound; a
state-less client still relies on the fresh nonce and monotonic timeout.
Long-offline or expired Manifest has no grace path for TLSN capture.

## 10. Failure behavior and ordinary game traffic

| Failure | TLSN behavior | Normal APP/Game Server behavior |
|---|---|---|
| Freshness route, signer, Release Journal or DO unavailable | Report a stable `TLSN_FRESHNESS_UNAVAILABLE` readiness error; no Manifest acceptance/capture. Keep local state unchanged. | Ordinary proxy path continues; do not add a synchronous Freshness call to each game request. |
| Invalid signature/delegation/commit record | `TLSN_FRESHNESS_INVALID` and no high-water update. | Unchanged. |
| Expired or revoked-by-expiry delegation | `TLSN_FRESHNESS_SIGNER_EXPIRED`; no capture. | Unchanged. |
| Pointer, snapshot, DO and journal mismatch/pending state | `TLSN_RELEASE_STATE_UNCOMMITTED`; no response signature. | Unchanged. |
| Manifest or artifact digest/registry validation fails | Existing Runtime Config validation error; no state update or capture. | Unchanged. |
| APP local state corrupt or high-water above authority | `TLSN_RUNTIME_CONFIG_STATE_INVALID`; require online validated recovery or operator diagnosis. No reset-to-zero fallback. | Unchanged. |
| Response timeout (>10 seconds) | `TLSN_FRESHNESS_TIMEOUT`; discard nonce; a later attempt gets a new nonce. | Unchanged. |

Logs/diagnostics use fixed error codes, operation phase, environment and
elapsed duration. Do not log request nonces, full responses/Manifest bodies,
delegated private keys, secret bindings, credentials, or raw signer requests.
Freshness failures must never be shown as “Manifest valid” or “TLSN ready”.
The APP must not retry or replay any Game Server request due to a freshness
failure or an ambiguous game-network write.

## 11. Adversarial security analysis

### 11.1 Normal signer versus compromised Freshness signer

The 10-second bound applies only while the Freshness signer and its
currentness checks are honest: the issue lease holds the committed generation
through response signing, and APP's monotonic deadline limits acceptance after
the signature. It is **not** a bound on a compromised Freshness signer.

A compromised Freshness signer can answer a fresh nonce with an older,
previously root-signed Manifest and its valid Release Commit Record. APP cannot
independently query the Journal's current head; it trusts the delegated
Freshness signer for that claim. It still verifies the original Manifest
signature and all existing time/reference constraints, so the child key
cannot invent new Manifest bytes or new trust pins.

The current source enforces these limits:

- Manifest lifetime: `expires_at - not_before <= 3,600s`.
- APP clock skew: at most `30s`; expiry is accepted only while
  `expires_at > app_now - 30s`.
- Worker reference age: `app_now - source.observed_at <= 600s`, and
  `source.observed_at <= app_now + 30s`.
- The source does **not** require `source.observed_at <= issued_at`; nor does
  it prove that a supplied publisher `policy.now` is the actual signing wall
  clock.

For one fixed Manifest, let `E=expires_at` and
`O=source.observed_at`. The source-level APP acceptance conditions imply:

- On the APP clock, it must satisfy both `E > app_now - 30s` and
  `app_now - O <= 600s`.
- If the APP wall clock is at most 30 seconds slow, the corresponding
  true-time upper bound is
  `min(E + 60s, O + 630s)`. The Worker-reference age is therefore the tighter
  per-Manifest limit when `O` is within the allowed release-time skew.
- At publisher verification time `T0`, the code permits
  `not_before <= T0 + 30s`, `E - not_before <= 3,600s`, and
  `O <= T0 + 30s`. Thus the expiry path is at most `T0 + 3,690s`, while the
  Worker-reference path is at most `T0 + 660s`; the latter is the maximum
  fixed-Manifest window under those assumptions.

The `660s` value is conditional on `policy.now` representing current release
time and an APP clock within the configured skew. The code does not enforce
`source.observed_at <= issued_at`, and `policy.now` is an input to the
publisher verifier rather than an independently attested clock. Therefore
the robust per-Manifest statement is the `min(E + 60s, O + 630s)` formula;
without the clock assumptions, no absolute wall-time bound can be claimed.
The one-hour Manifest lifetime is not a 10-second freshness guarantee.

The fixed-Manifest window is **not** a total exposure bound for a compromised
Freshness signer. The signer can answer each new nonce with a succession of
previous root-signed Manifests whose Worker references remain fresh. If
releases continue, that rolling downgrade can persist until the Freshness
delegation's `not_after`. The root-signed interval is capped at 24 hours from
delegation `issued_at`; assuming the offline root ceremony timestamp is
trusted, the APP's conservative clock-safety window ensures true-time
acceptance does not extend past `not_after` when its wall clock is within
±30 seconds. Thus maximum true-time acceptance is 24 hours from delegation
issuance, and the remaining window from compromise cannot exceed that. The
30-second response clock-skew rule and 10-second challenge deadline
do not extend a delegation; the attacker can sign each fresh challenge until
the certificate boundary. If the APP clock is manipulated or outside the
±30-second assumption, no absolute wall-time bound is claimed. Local
delegation-generation high-water can reject an older key for an installation
that stored a higher generation; a fresh APP has no such history. Immediate
remote revocation for a fresh APP is not available under this offline-root
design. Emergency response requires disabling the signer and an approved
Bootstrap-root rotation/APP release.

### 11.2 Key-compromise response

1. **Freshness HSM/service compromise:** immediately disable its signing
   operation and the Freshness route; readiness becomes BLOCKED. Do not renew
   the compromised delegation. Generate/approve a different Freshness key
   outside this repository, have the offline Bootstrap root issue a
   higher-generation Freshness delegation, and deploy only after the new
   signer/Journal checks pass. An extracted old key can still make signatures
   after expiry, but an APP within the ±30-second clock assumption rejects
   them at    the conservative `not_after` boundary. With a trusted root ceremony
   timestamp and APP clock error bounded by ±30 seconds, the maximum
   acceptance window is 24 hours from delegation `issued_at`; a fresh APP
   cannot learn an untrusted revocation statement. If either clock is
   untrusted or unbounded, no absolute wall-time exposure limit is claimed.
2. **Release Authority HSM/service compromise:** freeze releases and Journal
   commit operations. The online key is non-exportable but can still be
   misused through its signing service; confirm that no arbitrary signing
   path exists, rotate to a new root-delegated Release Authority key, and
   verify the Journal/DO/R2 head before resuming. Do not renew the old
   delegation; an extracted key remains cryptographically authorized until
   its 30-day delegation expires, and a fresh APP cannot accept an
   untrusted revocation claim. Never delete or rewrite old commit records or
   lower the generation.
3. **Bootstrap root compromise:** stop Manifest publication, delegations and
   Freshness. Existing APPs cannot remotely revoke their embedded root. Root
   rotation requires a separately approved APP release and trust migration;
   until affected clients use the new root, Production acceptance remains
   BLOCKED.
4. **After any signer incident:** keep the issue-lease and signer circuit
   breakers closed until the current Release Journal head, DO state, pointer,
   immutable snapshot, delegations and APP verifier agree. Preserve the
   highest known generation and offsite checkpoint; never reset to zero.

| Scenario / attacker capability | Detection and required behavior | Maximum impact if assumptions hold |
|---|---|---|
| Freshness endpoint compromised, signer key not compromised | Endpoint can deny, delay, cache or alter bytes; APP signature/nonce/audience/digest checks reject. Signer obtains data independently, not endpoint-supplied epoch/digest. | TLSN availability loss only. |
| Manifest publisher compromised | It may attempt pointer rollback or publish partial objects. It lacks Bootstrap root and Release Authority keys; DO/journal/pointer mismatch blocks Freshness. | DoS/orphan objects; cannot create a new valid Manifest. |
| Bootstrap-root/Manifest signer compromised | Attacker can sign a malicious Manifest and malicious delegations because current Manifest v2 trusts this key directly. | Full APP Runtime Config trust compromise, including APP-side Notary/Registry pins. Requires new Bootstrap root in an APP release; no remote revocation of old APP pins. |
| Release Authority HSM key/service compromised | A non-exportable key can still be misused through its online signing interface. The typed service must re-read the pending DO attempt, pointer/snapshot and prior Journal head before signing; Journal compare-and-append and the Authority Worker's commit path independently recheck the authorization and expected generation/epoch. | The signer alone can create authorization signatures but cannot write the pointer, DO ledger or Journal. New Journal commits are limited to the 30-day root-signed delegation interval because Journal checks append time strictly; previously appended valid records remain verifiable after expiry. It cannot create a Freshness response or forge Manifest/Notary/Result trust. |
| Freshness delegated key compromised | Attacker can sign a response to each fresh nonce and replay any still-valid root-signed Manifest/Journal record as latest. APP verifies those originals but cannot independently know Journal head. | Latestness guarantee is compromised. A fixed Manifest retains the bound `min(expires_at + 60s, observed_at + 630s)` under the clock assumption; rolling rollback can continue until delegation `not_after`. With a trusted root ceremony timestamp and bounded ±30-second APP clock, the conservative expiry check caps true-time key acceptance at 24 hours from delegation `issued_at`. The response skew and 10-second deadline do not extend it. If either clock is untrusted/unbounded, no absolute wall-time bound exists. The child cannot create new Manifest, Result, Notary or Registry signatures. |
| Delegation issuance authority compromised | Root can issue replacement child keys or alter allowed purposes. | Equivalent to Bootstrap-root compromise; offline custody and APP root rotation are required. |
| R2 object bytes modified | Exact Manifest/snapshot digest, root signature, artifact hashes and commit record do not match. | Freshness/Manifest acceptance blocked. |
| R2 mutable pointer rolled back | Current DO generation/ETag and Release Journal head exceed or differ from pointer. | No response; recovery uses exact current snapshot, not the old pointer. |
| DO ledger rolled back/PITR restored | Release Journal head and signed record generation are higher/different. | Freshness blocked until the DO is reconstructed from the signed journal chain. |
| Release Journal rolled back or unavailable | DO current state and pointer disagree with journal head, or the Journal cannot prove a current head. | Freshness blocked. If Journal, DO and R2 are all jointly rolled back, latestness is unknowable without an offsite checkpoint; remain blocked. |
| Endpoint and Freshness signer collude | They can issue a response for a stale but valid root-signed Manifest; the signer has the designated Freshness authority. | Stale-config acceptance within the Manifest's remaining validity window; no new Manifest signature or Worker evidence authority. |
| Old response replay | Fresh random nonce, one pending request, consumed-challenge state and monotonic 10-second deadline fail. | No cross-request acceptance. |
| Cross-environment response/delegation | Environment, scope, audience and root-signed delegation mismatch. | Rejected before config acceptance. |
| Nonce reused or leaked | APP nonce generator/pending-state tests detect reuse; a leaked nonce can only retrieve/relay a response for that exact pending challenge. | Same-attempt response relay; no ability to alter manifest or satisfy another nonce. |
| APP local state deleted or lowered | Fresh nonce and signed current Release Journal/commit record establish the online current snapshot; offline fallback is forbidden. | A hostile owner can still patch APP (out of scope); a network replay alone fails. |
| APP local state tampered to a higher epoch | Fresh server head is lower; APP refuses downgrade and reports recovery issue. | Local denial of TLSN only. |
| OS clock moved backwards | Monotonic request deadline, wall-clock skew and persisted last signed server time reject large rollback. | Availability denial; no silent stale fallback. |
| Network partition | No valid challenge response; TLSN readiness/capture blocks. | Ordinary game traffic continues. |
| Release stopped during commit | Pending DO state, absent journal record or mismatched pointer makes signer refuse. | Temporary TLSN outage until exact recovery. |
| R2 backup restore to an old pointer | Separate DO and Release Journal remain newer; digest/generation mismatch rejects. | Freshness blocked until pointer restored to the exact latest snapshot. |
| R2, DO and Release Journal all restored/controlled by one attacker | All current sources can present a coherent old history. | No self-contained protocol can know a deleted external history. Require independently retained checkpoint/root-owner intervention or remain blocked. |

## 12. Adversarial test plan

These are future tests, not tests run for this protocol. The 58 existing Node
tests run during Phase 0 cover current source only. No live R2 bucket, signer,
Production endpoint, Notary or Game Server is used. Any R2 integration test
requires explicit approval for a disposable bucket.

| Test | Expected result | Layer |
|---|---|---|
| Root-signed Release and Freshness delegations with exact Production scope | Accept only after verifying root signature, key ID, algorithm, purpose, audience and validity. | APP unit + JS/Rust golden vector |
| Delegation wrong root key, key ID, purpose, env, audience, algorithm, version, unknown field or malformed SPKI | Reject. | APP + Freshness Worker unit |
| Delegation `not_before` inclusive start, `not_after` exclusive end, generation rollback or previous digest mismatch | Accept only inside the defined interval; reject at/after `not_after` and for every invalid chain. | APP + signer unit |
| Delegation validity duration or future `not_before` attempts to extend the cap | Reject when `not_after - issued_at` exceeds 24h/30d or `not_before < issued_at`; validity cap remains anchored to signed issuance. | Root delegation verifier |
| APP fast/slow clock at delegation boundaries | Accept only when `app_now - 30s >= not_before` and `app_now + 30s < not_after`; reject the conservative boundary margins and every time outside the certificate interval. Manifest/response skew is not a delegation grace. | APP clock-injected unit |
| Freshness response issued just before delegation expiry | Clamp `expires_at` to `not_after`; reject at final rename once APP safe window closes; no response-TTL grace extends the delegation. | Signer + APP time-boundary integration |
| Release Authority signature created in validity but Journal append occurs at/after `not_after` | Journal refuses append; the authorization remains orphaned and cannot become committed. | Journal clock-injected integration |
| Valid Journal-committed Release record is observed after its Release Authority delegation expires | Verify `authorized_at` and authenticated `appended_at` inside the delegation; accept the historical record only when it remains the current Journal head and DO is COMMITTED. | Freshness signer + APP unit |
| Freshness delegation expired/revoked by expiry | Reject even if response signature is otherwise valid. | APP unit |
| Release Authority authorization signature invalid, wrong key/delegation, wrong scope/env/authorization | Journal entry not committed; signer and APP reject. | Release Authority + signer unit |
| Release record wrong epoch/digest/ref/ETag/generation/commit ID or previous record hash | Reject; do not advance DO or Journal head. | DO + Release Authority unit |
| HSM-signed authorization exists but Journal has no corresponding canonical entry | No Freshness response and no APP input; DO never treats the HSM signature alone as COMMITTED. | Authority + Journal + Freshness integration |
| Crash after exact HSM authorization bytes are stored in the pending DO attempt but before Journal append | Recovery revalidates the same attempt/head and retries only the stored exact bytes; no Freshness response until Journal append and DO COMMITTED. | DO + Journal recovery integration |
| Journal append succeeds but DO remains POINTER_COMMITTED | Freshness remains blocked until recovery verifies the exact current Journal entry and repairs DO at the same generation. | Recovery integration |
| Journal append has a stale previous head, repeated generation with different bytes, or non-increasing Manifest epoch | Reject atomically; preserve current Journal head. | Journal compare-and-append integration |
| Journal append response is lost immediately before/after its linearization point | Resolve from linearizable `getHead`; exact stored bytes mean committed, unchanged prior head permits exact-byte retry, any conflicting head blocks. | Journal crash/ambiguous-response integration |
| Release/Freshness signer uses the wrong DO operation credential or attempts a release mutation | Reject; no pointer, DO release state or Journal change. | DO RPC authorization integration |
| Release signer receives forged DO/pointer/Journal claims from its caller | Ignore caller state and independently read its DO binding, R2 and Journal; do not sign on mismatch. | Release signer integration |
| Root-signed Manifest modified after record creation | Exact digest/signature mismatch; no Freshness response. | Signer unit |
| Publish attempt starts while an issue lease is active | DO denies pointer preparation/CAS until leases end; no pointer mutation occurs. | DO concurrency test |
| Freshness request starts after a release is pending | DO refuses a new lease; no response signature. | DO + signer integration |
| `beginRelease` and issue-lease acquisition race in both serialization orders | If lease wins, release sets writer-pending and waits; if writer-pending wins, lease is rejected. No pointer CAS/Journal append overlaps a valid lease. | DO concurrency test |
| Recovery admission races with issue-lease acquisition | The same DO transaction order decides the winner; recovery waits/rejects if a lease exists and cannot bypass it. | DO recovery concurrency test |
| Issue lease expires before response signature | Signer discards any produced signature; no response; release may proceed after lease expiry. | Signer/DO fault-injection test |
| Concurrent Freshness readers with a waiting release | Existing leases can finish; writer-pending rejects new leases and then proceeds. | DO concurrency test |
| Valid nonce-bound response with current record and exact immutable Manifest snapshot | APP accepts after all existing Manifest/artifact checks and persists state once. | APP unit + integration |
| Nonce mismatch, invalid length, duplicate/consumed nonce, or response from another APP request | Reject and do not update persistent state. | APP unit |
| Response replay with a previously valid response and fresh nonce | Reject nonce mismatch. | APP integration |
| Wrong audience, environment, scope or protocol version | Reject; Production/Canary never cross. | APP + signer unit |
| Wrong signer key ID, unknown delegated key, bad Freshness signature | Reject. | APP unit |
| Response `issued_at` >30 seconds in the future, expiry, >30-second validity, or monotonic request deadline >=10 seconds | Reject; no acceptance. | APP unit |
| Freshness `latest_epoch` differs from commit record or Manifest payload | Reject before state persistence. | APP integration |
| Same Manifest epoch with different exact bytes/digest | Reject. | APP + publisher unit |
| Same Manifest bytes with older commit generation or lower epoch | Reject as rollback. | APP + DO + signer unit |
| `manifest_ref` is outside fixed snapshot prefix or digest suffix mismatches bytes | Reject; no URL/path supplied by endpoint is trusted. | APP + signer unit |
| R2 pointer signature invalid, ETag/digest wrong, or pointer not equal snapshot | Signer emits no response. | Freshness Worker integration |
| Stale pointer below DO/Journal head | Signer emits no response. | Freshness Worker + fake R2/journal |
| Stale/rollback Release Journal head while DO is newer | Signer emits no response and raises integrity alert. | Signer + Journal integration |
| DO PITR restore to old generation while Journal remains current | Signer detects mismatch and blocks. | DO recovery integration |
| R2 pointer CAS races with same ETag | One publisher wins; one conflict; no two commit records. | Publisher unit + disposable R2 |
| Crash after PREPARED before pointer CAS | No Freshness signature; safe abort only if write never began and old pointer remains exact. | DO state-machine test |
| Crash after pointer CAS before POINTER_COMMITTED | Direct readback advances only if exact candidate; otherwise pending/block. | DO + fake R2 |
| Crash after POINTER_COMMITTED before signed Journal append | Signer blocks. HSM may issue an authorization only after revalidating the exact attempt; an unappended authorization remains non-committed and is never APP input. | Release Authority integration |
| Crash after Journal append before DO COMMITTED | Journal append remains the release commit; Freshness stays blocked until recovery verifies exact Journal record/append metadata and R2 pointer/snapshot, then repairs DO at the same generation. | DO + Journal recovery integration |
| Partial artifact/snapshot writes | Pointer remains unchanged; no commit record or Freshness signature. | Publisher unit |
| Missing pointer with nonzero DO/Journal state | Never treat as first install; restore exact latest snapshot or remain blocked. | Signer/recovery integration |
| Pointer-only restore from R2 backup | DO/Journal higher generation forces rejection. | Recovery integration |
| All current sources disagree or Journal lost | No signature, no epoch-zero fallback, manual recovery required. | Recovery/runbook exercise |
| CDN supplies cached old response or old Manifest | Nonce or exact raw digest mismatch rejects. | APP/Worker integration |
| Freshness endpoint/signer/Journal/DO unavailable | TLSN readiness blocks, local state unchanged, normal proxy traffic still succeeds. | APP integration |
| Freshness response arrives before 10 seconds but Manifest/artifact verification finishes at/after the shared deadline | Reject; do not persist epoch, digest, commit or delegation state. | APP integration with delayed fake fetcher |
| Deadline expires immediately before atomic state rename | Remove the temporary state file; the prior canonical state is unchanged. | APP state-store unit test with monotonic clock |
| Parent-directory `fsync` fails after rename | Return a state durability error and do not expose readiness/capture; next refresh reads the canonical file and reconciles with a fresh authority proof without rollback. | APP state-store fault-injection test |
| POST, snapshot and artifact requests attempt to restart their own timeout | Reject at the original 10-second operation deadline; each request receives only the remaining time. | Freshness client unit/integration |
| Release tries to update R2 or append Journal while an issue lease is active | Authority blocks mutation until lease end/expiry; no commit is visible during the signature interval. | DO + Authority Worker concurrency test |
| Recovery tries to bypass an active issue lease | Recovery remains blocked until issue leases expire and Freshness is disabled by the controlled kill switch. | Recovery/Authority integration |
| APP ordinary game request has ambiguous network outcome | No resend due to freshness failure or runtime configuration retry. | APP proxy integration |
| Freshness key attempts to sign Manifest/Result/Notary payload | APP Manifest verifier and Worker Result/Notary verifiers reject the child key/domain. | Cross-language + Worker contract |
| Freshness Worker receives caller-supplied epoch/digest/URI/ledger state | Strict request schema rejects; signer derives them independently. | Worker security test |

## 13. Implementation roadmap

Phase 0 is the only current phase. No source changes from Phases 1–6 were
started.

### Phase 0 — Specification and trust approval

- **Files changed:** this document and
  [FIRST-TESTPLAY-READINESS.md](../FIRST-TESTPLAY-READINESS.md) only.
- **APIs/schema:** select Option B, `LATEST_AT_ISSUANCE`, the two delegated
  child purposes, response/delegation/commit-record canonical forms,
  HSM commit authorization versus Journal commit semantics, per-operation
  linearization points, delegation clock rules, 10-second APP deadline, and
  failure policy.
- **Order/dependency:** complete before implementation.
- **Tests:** source reinspection and documentation checks in this final
  consistency pass; the 58 existing Runtime Config Node tests were run in the
  prior source audit. No Freshness tests or signing calls were run.
- **Fail/complete:** no design ambiguity for code implementation; human
  approval remains required for root custody, child-key custody, Journal
  operator/retention, Worker deployment identities/bindings, scoped DO
  operation credentials, and service registration. **Specification written;
  trust approval NOT_GRANTED.**
- **External inputs:** no secret/key values in chat or source.

### Phase 1 — Release Authority ledger, R2 snapshots and Journal

- **Existing files:** `scripts/tlsn-runtime-config-manifest.mjs`,
  `scripts/tlsn-runtime-config-r2-store.mjs`,
  `scripts/tlsn-runtime-config-release.mjs`,
  `scripts/tlsn-runtime-config-production-registration.mjs`,
  `scripts/tlsn-runtime-config-publisher-readiness.mjs`, and their tests.
- **New files:** a dedicated
  `packages/FUSOU-TLSN-RUNTIME-CONFIG-AUTHORITY/` Worker with
  `src/index.ts`, `src/release-authority.ts`, `src/journal-client.ts`,
  `wrangler.toml`, generated binding types, and SQLite Durable Object
  migration; a separately deployed
  `packages/FUSOU-TLSN-RUNTIME-CONFIG-RELEASE-SIGNER/` adapter Worker with
  `src/index.ts`, `src/commit-verifier.ts`, its HSM client and binding types;
  plus `scripts/tlsn-runtime-config-release-commit.mjs` and commit-record
  fixtures/tests.
- **API/schema:** Release Authority DO methods
  `prepareRelease`, `markPointerWriteStarted`, `observePointerCommitted`,
  `commitRelease`, `getPreparedRelease`, `storeCommitAuthorization`,
  `acquireFreshnessIssueLease`,
  `releaseFreshnessIssueLease`, `getCurrentCommitted`, and recovery-only
  methods with role-checked operations. Both signer Workers bind to this same
  DO namespace and query the stored state directly; they do not consume state
  synthesized by the Authority Worker's HTTP handler. The release CLI calls an authenticated internal
  `POST /internal/v1/releases/prepare` with the exact signed Manifest bytes;
  Authority code verifies the root signature and derives the candidate
  epoch/digest itself. The route authenticates the protected release-pipeline
  identity; that access only authorizes submission and is not a latest-state
  proof. The CLI has no R2 writer credential after migration.
  The Authority Worker is the only Runtime Config pointer writer;
  `observePointerCommitted(attempt_id)` reads R2 directly and accepts no
  publisher-supplied ETag/digest as proof. The Release Authority signer uses
  `getPreparedRelease`; the Freshness signer uses `getCurrentCommitted` and
  the two issue-lease calls. Signers have no release-mutation credentials.
  Add immutable Manifest snapshot key
  `tlsn/runtime-config/v2/manifests/<manifest_sha256>`, `R2` allowlist,
  cache metadata and exact readback. Add `ReleaseCommitRecordV1` and an
  append-only Journal interface whose atomic `append(record)` verifies the
  signature/delegation and authorized/append times, compares previous head
  hash/generation and increasing Manifest epoch, then creates the record
  once and returns authenticated `appended_at` metadata;
  `getHead(environment)` is authenticated and linearizable.
- **Order:** prepare/verify Manifest and artifacts; write artifacts and
  snapshot create-only; DO records PREPARED; the Authority Worker sets the
  pointer-write-started bit and performs the existing R2 `If-Match` /
  `If-None-Match: *` CAS only when no issue lease is active; Authority
  directly reads the pointer/snapshot and records provisional
  POINTER_COMMITTED; the online Release Authority HSM service independently
  rereads R2/DO/Journal and signs the exact `AUTHORIZE_JOURNAL_APPEND` record;
  the Authority Worker stores those signed bytes in the pending DO attempt;
  Journal compare-and-appends against its current head (the release commit
  linearization point) and reads back the create-once record; DO then verifies
  it and transitions to `COMMITTED` as post-commit coordination state. These
  are separate operations, not a distributed ACID transaction. No
  endpoint-supplied release values are trusted in these transitions.
- **Tests:** all DO transitions and race orderings, R2 CAS, HSM authorization
  without Journal append, exact authorization persistence, Journal
  compare-and-append, crash/ambiguous outcomes before and after append,
  Journal-append/DO-update recovery, generation/epoch rules, missing snapshot,
  Journal head mismatch, R2 restore, and no secret output. Run live R2 only
  against a separately authorized disposable bucket.
- **Fail/complete:** no Freshness response until all committed state sources
  agree. Any lost state blocks; no zero reset.
- **External input:** approve Journal provider/retention/account, linearizable
  append-time clock, DO namespace and scoped Worker bindings, Release
  Authority non-exportable HSM
  provider/key custody, per-service DO operation credentials, authorized
  release operators, and R2 permissions. No user supplies secrets in chat.

### Phase 2 — Root delegations and Freshness signer service

- **New files:** separate
  `packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-GATEWAY/` and
  `packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-SIGNER/` Workers, each with
  its own `src/index.ts`, `wrangler.toml`, generated types and tests. The
  Gateway owns the same-origin APP route and a private Service Binding to
  the Signer. The Signer owns the delegated Freshness secret, read-only R2
  and Journal access, and a direct binding to the same DO namespace for
  committed-state reads and issue-lease calls. Its DO interface is
  role-checked and contains no release-mutation credential. Do not add either
  role to `FUSOU-TLSN-VERIFICATION-WORKER`.
- **Existing files:** add production readiness checks to Runtime Config
  registration/publisher diagnostics and type/vector tests.
- **API/schema:** strict POST request/response, root delegation verifier,
  Release Authority record verifier, Freshness signer, and read-only
  R2/DO/Journal adapters. The Gateway passes only the validated challenge.
  There is no arbitrary `sign(bytes)` endpoint and no caller-supplied release
  state.
- **Order:** obtain approved root-signed delegations offline; provision
  read-only R2/Journal access, the direct DO read/issue-lease binding, and a
  non-exportable Freshness key in the approved managed HSM; only then enable
  the endpoint. The Freshness signer
  acquires an issue lease before checking state, signs while the lease is
  active, and releases it after signing. The Gateway never receives the
  signing key. Bootstrap root material never enters either Worker.
- **Tests:** signer reads actual test pointer/DO/Journal rather than request
  claims; invalid/stale state fails; key purpose isolation; Production/Canary
  isolation; outage and cache tests.
- **Fail/complete:** response only for a current Journal head matching
  DO/R2/snapshot. Any unavailable authority returns explicit non-success.
- **External input:** delegated keys, provider, domain/route, read-only R2
  access, journal authentication and operator registration. These are not
  present now.

### Phase 3 — APP verifier and persistent state

- **Existing files:** `src-tauri/src/tlsn_runtime_config_manifest.rs`,
  `src-tauri/src/tlsn_runtime_config_runtime.rs`, `wrap_proxy.rs`, Rust unit
  tests, JS/Rust golden vectors and relevant APP pre-capture tests.
- **API/schema:** new Rust types for Delegation, ReleaseCommitRecord,
  Freshness envelope/payload; new domain-separated verifiers; bounded POST
  fetch method; strict half-open delegation validity with the conservative
  APP clock-safety window, separate response skew, immutable Manifest snapshot
  fetch; APP state v2 with epoch/digest/generation/record/delegation
  high-waters and atomic migration.
- **Order:** challenge -> verify both delegations -> verify commit record ->
  verify response -> nonce/time/deadline -> fetch exact snapshot -> existing
  full Manifest/artifact verification -> compare local state -> one atomic
  state update.
- **Tests:** all APP, delegation-boundary, historical Release Authority
  record, response-expiry and canonicalization cases in Section 12, state
  loss, corruption, OS restore, clock rollback and monotonic deadline.
- **Fail/complete:** no state mutation until all checks pass; offline or bad
  Freshness blocks TLSN, not the ordinary proxy.
- **External input:** approved trust/certificate schemas, TTL and outage
  policy; no Production URL or key is guessed.

### Phase 4 — Worker and trust-boundary consistency

- **Existing files:** Worker `src/index.ts`, `src/binding_authority.ts`,
  Result Registry helpers, Production/Canary schema tests, and current
  worker-source tests. Modify only if an actual interface gap is shown.
- **API/schema:** Worker continues to reject APP-asserted trust; any release
  identifier used by Worker comes from its own Binding or independently
  verified source. No app-provided Freshness result becomes Worker authority.
- **Order/dependency:** after Phases 1–3.
- **Tests:** APP claim forgery, Production/Canary substitution, observed
  Presentation identity, Inventory/Approval/Notary/Result Registry remain
  independently verified.
- **Fail/complete:** no Worker acceptance based solely on a freshness response.
- **External input:** any new Worker Binding requires explicit approval; no
  Binding change is part of Phase 0.

### Phase 5 — Cross-component and adversarial validation

- **Files:** APP/Authority/Freshness Worker tests, shared fixtures, release
  Journal adapter tests, optional CI selectors in
  `.github/workflows/tlsn-testplay-candidate.yml`.
- **API/schema:** test-only clock, signer and R2/Journal adapters; no
  Production credentials.
- **Tests:** full Section 12 matrix, DO restart/PITR scenarios, WORM recovery,
  CAS concurrency, signer compromise boundaries, endpoint outage with normal
  game traffic, cross-language vectors, and worst-case signer/state-read
  latency proving the whole lease-held validation/signing path fits within
  8 seconds. If it does not, remain BLOCKED and re-approve a new serialization
  design; never weaken the lease or APP deadline.
- **Fail/complete:** require unit, Worker runtime, APP integration, and
  disposable R2/Journal integration evidence as separate labels. No test
  skip or weakened assertion.
- **External input:** explicit authorization for any disposable R2 or
  external Journal integration environment.

### Phase 6 — Deployment preparation

- **Files:** production readiness/runbook, new Worker `wrangler.toml`,
  registration controls and coordinated APP release handoff.
- **Order:** only after Phase 5; register the real Bootstrap root and
  delegations, Release Authority key, Freshness key, Journal and exact
  endpoint; then review CDN bypass, role separation, recovery, observability
  and current compatibility date.
- **Tests:** configuration/readiness must show registered state without
  printing secret values; recovery/outage rehearsal and deployment review.
- **Fail/complete:** any missing root/delegation/journal/pointer/endpoint
  remains BLOCKED; successful build is not deployment or real-game proof.
- **External input:** human trust-owner and release-operator approvals,
  key provisioning through approved systems, scoped R2 permissions, Journal
  retention, domain and APP release. Review compatibility dates against the
  then-current Wrangler schema and enable structured Workers Logs and Traces
  for the new services. No deploy is implied here.

## 14. Decisions still requiring human authority

The following are external trust/operations inputs, not coding questions:

1. Bootstrap Trust Custodian approval to issue two child delegations while
   retaining the root offline and continuing the current direct-root Manifest
   v2 signature contract, including the trusted UTC source used for root-signed
   delegation `issued_at`.
2. Release Authority key custody/approval and the independently administered
   append-only Journal provider, account, retention, access roles,
   independently provisioned Bootstrap public-key pin/rotation process,
   atomic compare-and-append/current-head guarantee, and trusted append-time
   clock with strict `authorized_at <= appended_at` ordering (no skew grace).
3. Freshness key custody provider and renewal operation for the 24-hour
   maximum measured from root-signed delegation `issued_at`; Release Authority
   keys are capped at 30 days. Approve the trusted-clock assumption, the APP
   ±30-second clock-error bound and its conservative delegation-boundary
   margin. No private key or token is to be pasted into chat.
4. Release Journal/DO/R2 data retention, backup restore permissions,
   two-person recovery owners, and signed offsite checkpoint retention.
5. Approval of the 10-second request deadline, 30-second response maximum,
   response-only 30-second skew, strict delegation validity, conservative
   APP clock-safety window, and strict outage behavior.
6. Production endpoint/domain, R2 roles, signer registration, APP release
   and external service access. All remain unregistered/not checked.
7. Worker deployment identities, direct DO namespace bindings, and separate
   operation credentials for Authority mutation versus Release Authority
   reads and Freshness reads/leases. Cloudflare namespace bindings are not
   method-level ACLs; the deployed DO RPC authorization must be reviewed.
   These permissions are not registered or verified.

**Phase 0 result:** Option B and `LATEST_AT_ISSUANCE` were specified with
bounded semantics, delegated keys, HSM authorization versus Journal commit
semantics, per-operation linearization points, expiry/clock rules, DO state
transitions, APP verification and failure handling. At that Phase 0 boundary,
Freshness source was **NOT_IMPLEMENTED**. The later local Phase 1 verifier and
test-only adapters are recorded at the top of this document; the Production
Freshness service remains **NOT_IMPLEMENTED**, registrations remain
**BLOCKED**, and Production/Stage A/B/C acceptance remains **BLOCKED**.

## Local Workers runtime HTTP disconnect observation — current follow-up

The real Gateway source was exercised through a local Miniflare HTTPS listener
and a test-only Service Binding Worker. A separate minimal signal-probe Worker
contains no Gateway, domain validation, or Signer. The local runtime versions
were Node `v22.21.1`, Miniflare `5.20261104.0-beta`, workerd `1.20261104.1`,
and esbuild `0.28.2`; the candidate workflow pins Node `22.16.0`. All Workers
use the Production Gateway's unchanged `2026-11-06` compatibility date and
`enable_request_signal` flag, checked against `wrangler.toml`. The normal
Miniflare HTTPS entry and `unsafeGetDirectURL()` direct Worker socket are both
loopback-only. The reserved `.test` Host/SNI name is never resolved externally.
Cloudflare describes Miniflare as a local simulator using `workerd`, not as a
hosted Workers verification
([Miniflare documentation](https://developers.cloudflare.com/workers/testing/miniflare/)).

The client owns its HTTP request, Agent, TLS socket, and underlying TCP socket.
The test calls `net.Socket.destroy()` and
[`net.Socket.resetAndDestroy()`](https://nodejs.org/download/release/v22.16.0/docs/api/net.html#socketresetanddestroy)
as distinct operations. Node documents the latter as sending a TCP RST; no
packet capture independently confirmed the wire packet. It waits for the
test-only Worker to record request arrival before either operation. The
`destroy()` result does not imply that FIN or RST was sent. The probe waits a
bounded 7.5 seconds, longer than the Gateway deadline, so a signal observed
only after the Gateway deadline would not be reported as prompt delivery.
The test accepts either `signal` or `watchdog` for ordinary `destroy()` only
when the observed signal event agrees with the probe outcome. For
`resetAndDestroy()`, an incoming signal and `outcome="signal"` remain required.
The ordinary-destroy result recorded below is specific to that run, not a
cross-runtime expectation.
The runner has a 120-second outer limit. On `SIGINT`, `SIGTERM`, or that limit,
it signals the isolated test process group, allows 5 seconds for runtime
cleanup, then escalates to `SIGKILL`; its temporary root is removed only after
the child exits. A child that does not exit is reported as cleanup failure,
not treated as a completed timeout race. The supervisor's `SIGINT` and
`SIGTERM` paths were exercised and returned the expected 130/143 exit codes
with temporary-root cleanup. The 120-second overall-timeout escalation was
inspected but not waited out in a separate run.

| Case | Result |
|---|---|
| Minimal probe, ordinary `destroy()` | **LOCAL_WORKERS_RUNTIME_VERIFIED** for this pinned local runtime only: no incoming `Request.signal` abort was observed within 7.5 seconds through either the normal Miniflare entry or direct Worker socket. No FIN/RST conclusion is made. |
| Minimal probe, `resetAndDestroy()` | **LOCAL_WORKERS_RUNTIME_VERIFIED**: incoming `Request.signal` abort was observed through both the normal entry and direct Worker socket. |
| Normal Gateway response | **LOCAL_WORKERS_RUNTIME_VERIFIED** for exact bytes only: response length and SHA-256 match the test Signer's whitespace/newline-containing bytes. This does not verify signature or APP acceptance. |
| Client remains connected; Gateway deadline | **LOCAL_WORKERS_RUNTIME_VERIFIED** for the 7-second `504`: the Service Binding request received the deadline abort, its test response wait ended, `ctx.waitUntil()` cleanup settled, and a subsequent exact-byte request succeeded without restarting the same Gateway Worker isolate. This does not prove full 16-slot recovery. |
| Explicit reset during Gateway request-body read | **LOCAL_WORKERS_RUNTIME_VERIFIED**: the incoming signal aborted after reader acquisition; request-body cancellation and reader release were observed, `waitUntil` settled, and the Signer was not called. |
| Explicit reset while Signer headers were pending | **LOCAL_WORKERS_RUNTIME_VERIFIED**: incoming signal propagated through the Gateway's internal signal and the Service Binding request; the test Signer wait ended and `waitUntil` cleanup settled. |
| Explicit reset while Signer body was being read | **UNVERIFIED** for incoming-signal and Service Binding signal propagation. The observed event order was: Signer body pull pending; Gateway body `read()` rejected; Gateway `reader.cancel()` rejected; `releaseLock()` succeeded; `freshness_gateway_admission_retained_cleanup_unconfirmed` was logged; the handler returned `502`. No incoming, internal, or Service Binding abort was observed before handler completion in the bounded follow-up sampling. The test Signer's pending pull had no observed cancellation or resolution. `waitUntil` was not registered because the read-error operation completed as `502`, rather than the interruption race winning. The slot-retention log is confirmed; cleanup of the test Signer's pending work is not. |

The ordinary-destroy versus explicit-reset difference is a client-operation
distinction, not evidence of a Gateway implementation defect. For the
Signer-body case, the pinned Miniflare/workerd runtime surfaced a stream read
failure before an incoming signal was observed. The Gateway then followed its
fail-closed cleanup contract: cancel rejection did not release admission.
The test expectation was corrected to observe either signal-first or
read-error-first behavior and to require `waitUntil` only for interruption;
it no longer treats a read error as proof that a signal arrived. The exact
lower-level cause (workerd ingress, Miniflare listener, or Service Binding
body-cancellation behavior) remains unresolved. This local result does not
establish a Cloudflare Production defect or a Production Service Binding
guarantee. No Production code, trust boundary, APP deadline, or signer lease
was weakened.

Reproduce with
`pnpm --dir packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-GATEWAY run test:runtime`.
The required candidate-workflow step runs this command without skip or
continue-on-error. It asserts the pinned probe's ordinary-destroy and
explicit-reset outcomes, exact Gateway bytes/deadline behavior, request-body
and header-wait reset propagation, and the Signer-body read-error/cleanup
classification. The selected 11 Gateway handler regressions are
**NODE_UNIT_VERIFIED**; Node `AbortController` tests remain distinct from
real-socket runtime evidence. No APP Cargo target was selected or run, and no
APP Rust source was changed. Gateway source is **SOURCE_IMPLEMENTED**.
Hosted CI is **NOT_CHECKED**; no case is **PRODUCTION_VERIFIED**. Production
Signer/Journal registration and Stage A/B/C and Production acceptance remain
**BLOCKED**.
