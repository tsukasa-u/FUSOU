# Runtime Config Freshness Production Authority — Source Investigation and Design

## Status and scope

This is a source-based implementation design for the Production Runtime Config
Freshness Authority. It does not implement a Worker, register a binding, change
the wire contract, or establish Production readiness. The existing
[Phase 0 protocol](./runtime-config-freshness-protocol.md) remains the
normative protocol specification; this document maps that design to the
currently checked-in APP and Worker code and records the implementation
boundaries that are still absent.

For the later P2 design-only review of DO lease clocks, RPC replay, and PITR
rollback, see [Runtime Config Freshness DO Coordination — P2 Design](./runtime-config-freshness-do-coordination-design.md).
That review does not implement or register Production services. The current
[issuer-core contract](./runtime-config-freshness-protocol.md#current-freshness-issuer-core-2026-11-07)
fixes the maximum eight-second lease as an authorization bound, not an SLO;
the trusted clock and durable adapter that enforce it remain unselected.

The source of truth for this review was the checked-out source at the baseline
below, not commit-message wording or historical audit summaries. No secret
values or environment-variable values were read.

## Baseline

- Repository: `tsukasa-u/FUSOU`
- Branch: `tlsn-first-testplay-candidate`
- Start HEAD: `2082b6a02d2c43a856f20348d79065c1a234b271`
- Parent: `25b3cacbd68097435206db9452b492d8f4d9fd33`
- The index was empty.
- Existing local edits to the root `justfile` and
  `packages/FUSOU-APP/src-tauri/roaming/user/configs.toml` were present and
  remain out of scope. They were not read, staged, or changed for this design.
- No Production API, R2, Durable Object, HSM, deployment, Game Server, or
  Notary operation was performed.

## Outcome

The APP-side Freshness verifier, Worker-side in-memory protocol model, and
provider-independent shared-domain issuer core exist in source. The core is
locally unit-tested only. The Production Freshness route, Runtime Config
coordination DO, Production Release Journal adapter, Runtime Config R2
adapter, and Freshness/Release signer services do not exist in the checked-in
Worker runtime. The Worker-side test adapters are not substitutes for those
services.

The implementation must preserve the already selected Option B design:

1. A root-delegated Release Authority signs a record authorizing one exact
   Journal append.
2. The exact signed record becomes committed only when the Journal atomically
   appends it to the canonical chain.
3. The DO `COMMITTED` state is post-append coordination state, not a second
   commit point.
4. Freshness means `LATEST_AT_ISSUANCE`, established while a bounded issue
   lease prevents release mutation.
5. The APP continues to verify the existing Manifest v2 contract and every
   referenced artifact before atomically accepting local high-water state.

No trust boundary is moved to the APP, browser, candidate configuration, or
existing Result signer.

## APP contract confirmed from source

Primary sources: [APP Freshness verifier](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_freshness.rs),
[APP Manifest verifier](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_manifest.rs),
and [RuntimeConfigManager](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_runtime.rs).

### Bootstrap and request

| Contract item | Current APP behavior |
|---|---|
| Bootstrap trust | `RuntimeConfigBootstrap::from_embedded` requires the build-time Manifest URL, signer key ID, and Ed25519 SPKI pin. The pinned public key remains the direct Manifest v2 verifier and verifies the root-signed Freshness/Release delegations. Missing or partial registration fails closed. |
| Manifest URL | HTTPS canonical DNS URL, exact path `/tlsn/runtime-config/v2/manifest.json`; no user info, explicit port, query, fragment, or URL normalization. |
| Freshness URL | Same scheme/host as the pinned Manifest URL; APP replaces the path with `/tlsn/runtime-config/v2/freshness/v1`. |
| Request body | Canonical JSON, at most 1,024 bytes: `schema_version`, exact request `scope`, `environment: "production"`, `audience_manifest_url_sha256`, and a one-use 32-byte `request_nonce`. The audience is SHA-256/base64url of the exact `Url::as_str()` bytes. No epoch, digest, reference, ETag, commit state, or signing bytes are accepted from the caller. |
| HTTP behavior | POST with JSON and `Cache-Control: no-store`; redirects disabled; status must be 200 and final URL must equal the requested URL. Response bytes are streamed and bounded to 65,536 bytes. Connect timeout is 2 seconds, request timeout is at most 10 seconds. |

### Response and signature contract

The exact Rust structs and scopes are in the APP source and the normative
wire examples are in
[protocol sections 7–8](./runtime-config-freshness-protocol.md). The response
envelope contains the Freshness delegation, Release Authority delegation,
Release Commit Record, signed payload, and Freshness signature as canonical
base64url sidecars. The signed payload binds the same environment, URL
audience, exact request nonce, response times, Manifest epoch/schema/digest/
immutable reference, commit generation/ID, exact Release Commit Record digest
and authenticated Journal append time, and both delegation identities/digests.

The checks observed in source are:

- JSON is reserialized into canonical form and compared byte-for-byte; unknown
  fields are denied. Object keys are sorted recursively, array order is kept,
  and whitespace/key-order mutations are rejected.
- Base64url is unpadded and must round-trip to the exact same bytes.
- Ed25519 is the only accepted signature algorithm. The signing preimage is
  `domain || u16_be(key_id byte length) || ASCII key_id || canonical payload
  bytes`.
- Delegation, Release Commit Record, Freshness response, and Manifest v2 use
  separate domains. The Freshness domains are
  `FUSOU-TLSN-RUNTIME-CONFIG-DELEGATION-V1\0`,
  `FUSOU-TLSN-RUNTIME-CONFIG-RELEASE-COMMIT-V1\0`, and
  `FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-RESPONSE-V1\0`. Manifest v2 signing
  bytes are unchanged.
- The Release Commit Record must say
  `commit_authorization: "AUTHORIZE_JOURNAL_APPEND"`. It binds environment,
  commit generation/ID, Manifest epoch/schema/digest/ref, pointer ETag,
  previous generation/record digest, authorization time, and Release
  delegation. The APP verifies the signature and record shape; it does not
  independently read or prove Journal membership. The Freshness signer must
  attest that these exact bytes are the current Journal head and that the DO
  is `COMMITTED`.
- The APP requires `LATEST_AT_ISSUANCE`, exact nonce/audience/environment,
  response-to-delegation bindings, and
  `authorized_at <= release_commit_record_appended_at <= issued_at`.

### Time, delegation, and final acceptance

- Delegation validity is half-open: `not_before <= time < not_after`.
  `issued_at <= not_before < not_after`; the maximum interval is measured from
  root-signed `issued_at` to exclusive `not_after` and is exactly 86,400
  seconds for Freshness or 2,592,000 seconds for Release Authority. A future
  `not_before` consumes that cap.
- APP applies a conservative 30-second wall-clock margin to Freshness
  delegation validity: `app_now - 30s >= not_before` and
  `app_now + 30s < not_after`. This shrinks the usable interval; it is not an
  expiry grace. The separate response-time rule allows at most 30 seconds of
  response clock skew, requires `expires_at > issued_at`, a response lifetime
  no greater than 30 seconds, and `expires_at <= freshness not_after`.
- The APP checks Release `authorized_at` and Journal `appended_at` against the
  Release delegation's half-open interval. An already appended record remains
  verifiable after that delegation expires.
- The Freshness flow starts one monotonic 10-second deadline immediately
  before POST submission. That same deadline covers the response, immutable
  Manifest snapshot, every artifact fetch, verification, and final state
  acceptance. It is not restarted for each fetch.
- APP fetches the exact content-addressed snapshot at
  `/<manifest_ref>` and artifacts at
  `/tlsn/runtime-config/v2/artifacts/<kind>/<digest>`. It hashes the exact
  bytes before parsing, then runs the existing full Manifest v2 and
  independent-artifact checks.
- `FreshnessEpochState` persists Manifest epoch/digest, commit generation,
  Release Commit Record digest, and Freshness delegation generation/digest.
  Malformed state is not treated as epoch zero.
- `write_state_atomic_bytes` writes and `fsync`s a unique temporary file,
  synchronously runs the final state/deadline/time checks, and synchronously
  renames it without an async yield. Rename is the acceptance linearization
  point. The parent directory is synced afterward. If that sync fails, APP
  returns an explicit durability error and does not expose the verified
  config; the renamed state may already be present and must not be rolled back.

The current Freshness Rust module contains local-state tests for legacy state,
malformed state, and final acceptance failure. The JavaScript Freshness suite
uses in-memory signer/clock/DO/R2/Journal adapters. Neither source set proves
Production HTTP, HSM, Cloudflare DO persistence, or a real Journal.

## Existing Worker and Cloudflare source inventory

Primary sources: [Worker entry point](../../FUSOU-TLSN-VERIFICATION-WORKER/src/index.ts),
[binding authority](../../FUSOU-TLSN-VERIFICATION-WORKER/src/binding_authority.ts),
[R2 archive code](../../FUSOU-TLSN-VERIFICATION-WORKER/src/result_archive.ts),
[archive readback route](../../FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http.mjs),
[Wrangler configuration](../../FUSOU-TLSN-VERIFICATION-WORKER/wrangler.toml),
[Worker package scripts](../../FUSOU-TLSN-VERIFICATION-WORKER/package.json),
and the [Runtime Config release publisher](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-release.mjs).

### Routes and environment boundaries

- The deployed entrypoint named in Wrangler is the Hono app in
  `src/index.ts`. It registers TLSN verification, `/health`, internal
  verification callbacks, and `/internal/tlsn/archive-readback/v1`. There is
  no Production Freshness route and no Runtime Config immutable-object route.
- Existing internal verification callbacks use a route-specific
  HMAC-SHA256 over a domain-separated job ID and request-body digest.
  Archive readback instead validates a configured GitHub OIDC token and
  workflow/run claims. Neither mechanism is a Production Freshness/Release
  signer interface or a role-separated DO authorization system; do not reuse
  either as the new authority's generic credentials.
- `readRawBody` implements bounded request reads; existing body limits range
  from 64 KiB internal callbacks to multi-megabyte TLSN requests. There is no
  global Freshness request/response cap or cache policy because that route
  does not exist. The new public route must implement the APP's 1 KiB and
  64 KiB limits and `no-store` behavior.
- `Bindings` includes `TLSN_BINDINGS`, `TLSN_PRESENTATIONS`, Result/Session/
  Binding signing keys, and `TLSN_ENVIRONMENT`; it has no Runtime Config
  Journal, DO, R2, signer, or service binding. Existing Result and
  Binding-authority PKCS8 keys must not be repurposed.
- `wrangler.toml` declares `TLSN_BINDINGS` and `TLSN_PRESENTATIONS`, with a
  `new_sqlite_classes` migration for
  `TlsnBindingAuthorityDurableObject`, repeated for `env.production`.
  It does not declare Runtime Config routes/bindings or a Canary Wrangler
  environment. The file explicitly labels resource names historical and
  unverified; it has no `routes` or observability configuration. Actual
  deployed routes and bindings are therefore **NOT_CHECKED**.

### Durable Objects

`TlsnBindingAuthorityDurableObject` is a per-binding verification/session
authority, reached by deterministic `getByName` calls. It stores binding,
result, receipt, and archive-catalog state using
`this.ctx.storage.transaction(...)`; it schedules alarms for existing
verification/binding expiry. It has no Runtime Config release head, issue
lease, writer gate, recovery gate, or Journal integration and must not be
repurposed as the Runtime Config authority.

Cloudflare documents SQLite-backed DO storage as private to the object,
transactional, and strongly consistent; it also documents a 30-day
point-in-time restore window. Therefore DO state is coordination state, not
the independent anti-rollback witness. A new per-environment DO must use its
own SQLite namespace and migration, while the independent Journal remains
outside the DO/R2 restore domain.

All new DO compare-and-set operations are local storage transactions only.
R2, Journal, HSM, service-binding, and network operations happen outside the
DO transaction; after each external result, a new DO transaction validates
the same attempt/fencing token and records the observation. `alarm()` may
reconcile lease/operation state, but it must not delete an unresolved issue
or release its blocker solely because a lease expired; lease validity is
checked inside every operation, and alarm delivery is not the correctness
boundary.

### R2

- `TLSN_PRESENTATIONS` is the current Worker R2 binding and is used by
  `result_archive.ts` for Presentation/Result archive `put`, `get`, byte
  verification, and failure cleanup. It is not the Runtime Config bucket.
- The separate Node `tlsn-runtime-config-r2-store.mjs` uses the S3-compatible
  R2 endpoint and `@aws-sdk/client-s3`, with
  `TLSN_RUNTIME_CONFIG_R2_ACCOUNT_ID`,
  `TLSN_RUNTIME_CONFIG_R2_BUCKET`,
  `TLSN_RUNTIME_CONFIG_R2_ACCESS_KEY_ID`, and
  `TLSN_RUNTIME_CONFIG_R2_SECRET_ACCESS_KEY`. Its credentials and scopes were
  not read or checked.
- That script uses create-only `If-None-Match: *` for immutable artifacts and
  conditional `If-Match`/`If-None-Match: *` for the mutable
  `tlsn/runtime-config/v2/manifest.json` pointer. It reads back outcomes and
  does not automatically retry an ambiguous pointer write. The publisher
  creates the five immutable artifact objects and the mutable Manifest
  pointer; it does **not** create the APP-required immutable Manifest
  snapshot under `tlsn/runtime-config/v2/manifests/<digest>`.
- Cloudflare's Workers R2 API exposes conditional `put` via `onlyIf` (including
  conditional headers); a failed precondition returns `null`. R2 writes are
  strongly consistent after the `put` promise resolves. The Runtime Config
  Worker adapter must still verify exact bytes and ETag and reconcile
  ambiguous results; it must not treat a timeout as a definite failure.
- A bucket-scoped R2 `Object Read only` API token is available for S3-compatible
  access. Freshness/Release signer readers must use separate read-only
  credentials, not the Authority writer credential or a general R2 writer
  binding. No such token is registered or tested.
- The APP's snapshot/artifact URLs require a read origin on the exact
  Bootstrap hostname. No such public object route or R2 custom-domain mapping
  is declared in the inspected Wrangler source. The implementation must add
  a read-only object-serving path for `manifest.json`, `manifests/<digest>`,
  and the exact `artifacts/<kind>/<digest>` allowlist; it must not put R2
  credentials in the Freshness Gateway.

### Signing and tests

- The verification Worker imports existing PKCS8 software signing keys from
  Worker bindings. It has no Production Freshness or Release HSM service
  binding.
- The Node Runtime Config publisher accepts a signer-provider interface and
  verifies generated Manifest signatures, but it does not implement the
  Release Journal protocol or a Production Freshness signer.
- Worker `package.json` provides `typecheck`, WASM build, and WASM provenance
  scripts; it has no package-level `test` or lint/format script and no
  Cloudflare Vitest integration. Runtime Config tests are standalone Node
  tests using in-memory adapters. The R2 integration test is external-service
  capable and was not run.
- No test, typecheck, R2 write, HSM call, or deployment was run for this
  documentation-only investigation.

Cloudflare documentation consulted:
[SQLite-backed DO storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/),
[DO alarms](https://developers.cloudflare.com/durable-objects/api/alarms/),
[R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/),
[R2 API tokens](https://developers.cloudflare.com/r2/api/tokens/), and
[DO roles and permissions](https://developers.cloudflare.com/workers/authorization/durable-objects/).

## Production component design

The existing Phase 0 roles remain separate. The package paths below are
proposed implementation locations consistent with the existing protocol
roadmap; none exists yet.

```text
APP
 ├─ POST same-origin /tlsn/runtime-config/v2/freshness/v1
 │    └─ Freshness Gateway (no DO, R2, Journal, or signer credential)
 │         └─ private service binding → Freshness Signer
 │                ├─ Freshness HSM key (response only)
 │                ├─ DO: current COMMITTED state + issue lease
 │                ├─ Journal: authenticated current-head read
 │                └─ R2: read-only pointer/snapshot read
 └─ GET same-origin immutable Manifest/artifacts
      └─ read-only Runtime Config object origin

Release pipeline
 └─ authenticated internal request → Runtime Config Authority Worker
      ├─ Runtime Config coordinator DO (one instance per environment)
      ├─ dedicated Runtime Config R2 writer
      ├─ Journal append capability
      └─ private service binding → Release Authority signer
             ├─ Release HSM key (Journal-append authorization only)
             ├─ direct DO read
             ├─ Journal current-head read
             └─ R2 read-only pointer/snapshot verification

Bootstrap root private key: offline; never bound to a Worker.
Release Journal: separately administered append-only service, outside DO/R2 restore.
```

### Ownership and permissions

| Component | Owns / may do | Must not do |
|---|---|---|
| Runtime Config Authority Worker | Accept an authenticated release candidate; validate the signed Manifest and artifacts; write immutable artifacts/snapshot; set the pointer using conditional R2 writes; persist release intent/observations in the DO; append the exact authorized record to Journal; finalize DO `COMMITTED`. | Hold a signing private key; sign arbitrary bytes; accept caller-provided ETag/head as proof; expose a Freshness response. |
| Coordination DO | One current committed head, at most one pending attempt, pointer-write-started bit, exact stored authorization bytes/digest, writer/recovery gates, and active bounded issue leases. Serialize every local state transition with a DO transaction. | Be the only anti-rollback witness; store private keys; perform R2/Journal/HSM I/O inside its transaction; initialize missing state as generation zero. |
| Release Authority signer | Independently read the exact pending attempt, prior Journal head, pointer/snapshot, and delegation; call a typed HSM `authorizeJournalAppend` operation for that attempt. | Write R2 or Journal; mutate the DO; sign Manifest, Result, Freshness, or generic caller bytes. |
| Release Journal | Verify delegation/record and append time; atomically compare previous generation/hash and increasing Manifest epoch; append exact record/delegation sidecar once; return authenticated append time/current head. | Update/delete an entry or accept caller-asserted latest state. |
| Freshness Gateway | Bound and validate the APP challenge; bypass caches; pass only protocol version, Production environment, audience, and nonce to the signer; return only the signer's bounded response. | Hold signing keys, DO/R2/Journal access, or accept `latest_epoch`, digest, URI, pointer, or commit state from a request. |
| Freshness signer | Acquire/release issue lease; independently verify the current Journal head, DO `COMMITTED`, R2 pointer/snapshot, Manifest signature, and Freshness delegation; sample `issued_at` and call a typed Freshness HSM operation. | Write R2/Journal or mutate release state; sign endpoint-supplied state; return a stale/cache fallback. |
| Public immutable-object reader | GET only for the mutable pointer and digest-addressed snapshot/artifact allowlist on the Bootstrap hostname, using R2 read-only access. | Write/delete/list through a public API, sign, use DO/Journal, or expose arbitrary R2 keys. |
| APP | Verify the existing wire contract, exact bytes, artifact policy, and local high-water state. | Become a Worker trust authority or replace server-side latestness proof. |

Use dedicated new Worker packages, not
`FUSOU-TLSN-VERIFICATION-WORKER`, so Freshness/Release services do not inherit
its Result/Session/Binding keys. The existing Phase 0 roadmap names
`FUSOU-TLSN-RUNTIME-CONFIG-AUTHORITY`,
`FUSOU-TLSN-RUNTIME-CONFIG-RELEASE-SIGNER`,
`FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-GATEWAY`, and
`FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-SIGNER`. The object reader is an
additional transport-only role required by the APP's same-origin snapshot
and artifact GET paths; it has no authority over freshness.

Durable Object namespace access is Worker-level, not a per-method ACL.
Cross-Worker DO calls therefore use a narrow typed RPC surface plus
role-specific request authentication enforced by the DO. Each RPC authorization
binds a fixed domain, role, environment, operation, attempt/lease ID, and exact
body digest under a distinct per-role HMAC secret. Verify the MAC with
`crypto.subtle.verify`; do not use a caller timestamp as an authorization
source. Exact retries for the same attempt/lease and body are idempotent;
reusing an ID with different bytes rejects. Do not reuse the verification
callback HMAC or treat possession of a namespace binding as authorization.
Freshness and Release signer Workers get only their respective read/lease or
read/authorize methods; the Authority Worker gets mutation methods. Service
endpoints for signers and Authority are not publicly routed.

## State transitions, linearization, and recovery

Every transition below is one local DO storage transaction/CAS or one external
linearizable conditional operation. There is no cross-service ACID
transaction. The coordinator must persist intent before external mutation and
reconcile after uncertain outcomes. No DO storage transaction spans R2,
Journal, HSM, or network I/O.

| Operation | Start condition | Success / linearization point | Failure and recovery |
|---|---|---|---|
| `beginRelease` | Candidate Manifest/artifacts and immutable snapshot have been validated and exact prior head/ETag fixed. | DO transaction sets `writer_pending`; if no issue operation is unsettled, stores `PREPARED`, otherwise records `WAITING_FOR_ISSUES`. Transaction commit admits that attempt. | A waiting attempt remains the same attempt and resumes only after prior operations are durably terminal and the head is rechecked. Lease expiry alone does not drain an operation. A changed head rejects it. No R2 pointer mutation occurs. |
| `PREPARED` | Writer gate active; no unsettled issue operation; expected current generation/digest/ETag still match. | DO transaction stores candidate bytes/reference, prior head, attempt ID, `pointer_write_started=false`. | Failed transaction leaves only immutable orphan objects. Pending or recovery state blocks Freshness. |
| Pointer write intent | `PREPARED`; no active lease. | DO transaction sets `pointer_write_started=true` before calling R2. | If restart sees `false`, no CAS was admitted. If `true`, treat the result as possibly in flight until reconciled. |
| R2 pointer CAS | Durable pointer-write intent; expected prior ETag (or approved genesis create). | Successful `R2Bucket.put` with `onlyIf: If-Match: <exact-etag>` or authorized genesis `If-None-Match: *`. The successful conditional R2 write is the pointer linearization point. | A failed precondition is a conflict. On timeout/unknown result, read back exact pointer and snapshot; candidate bytes/ETag confirms success. Prior pointer or unavailable readback after an admitted CAS remains pending/blocked; do not assume failure or silently retry. |
| `POINTER_COMMITTED` | Pointer and content-addressed snapshot have exact matching bytes/digest; actual pointer ETag observed. | DO transaction records the ETag and `POINTER_COMMITTED`. | Crash after R2 success but before DO update is reconciled from R2 readback; mismatch stays blocked. This is not release commit. |
| Release HSM signature | Exact `POINTER_COMMITTED` attempt; signer independently verifies DO/R2 and prior Journal head/delegation. | HSM creates an authorization artifact only; this has no release commit linearization point. | Signature not persisted or appended is orphaned and never APP input. Reauthorize only after revalidating the exact same attempt/head. |
| Persist authorization | Valid HSM result for current attempt. | DO transaction stores exact signed bytes and digest as retry material. | Storage failure leaves an orphan signature. Do not append or expose it. |
| Journal compare-and-append | Exact stored bytes verify; Journal head matches previous generation/hash; generation and Manifest epoch advance; append time is inside Release delegation. | Journal atomically appends the exact record and delegation sidecar at the expected chain position. This is the **release commit linearization point**. | On ambiguous result, query the linearizable head. Exact bytes at the expected position mean success; an unchanged prior head permits retrying only the exact stored bytes against that expected head; conflict/unavailability blocks. |
| DO `COMMITTED` | Journal confirms the exact record and authenticated append metadata; R2 pointer/snapshot and attempt match. | DO compare-and-set transaction stores the Journal head and clears pending/writer state. This is post-commit coordination completion, not a second commit. | If Journal append succeeded but DO update failed, Freshness stays blocked; recovery verifies Journal/R2 then reconstructs the same generation in DO. Never allocate another generation. |
| Freshness lease acquisition | No writer/recovery gate or pending attempt; current head is `COMMITTED`. | DO transaction inserts the issue operation and lease for the current generation. The lease is at most 8 seconds under the approved clock. | If release/recovery gate commits first, reject. If issue admission commits first, release/recovery waits for its durable terminal result; lease expiry alone does not unblock pointer CAS or Journal append. |
| Freshness signing | Lease active; signer has verified Journal head, DO, R2 pointer/snapshot, Manifest signature, and delegation. | Sampling `issued_at` after final current-state checks is the `LATEST_AT_ISSUANCE` point. HSM signing, post-sign rechecks, and exact-byte finalization must complete while the same lease and delegation remain valid. | Expiry or mismatch discards the signature. Unknown signer/finalization state yields no response and retains the operation blocker; a known completed rejection may be terminally recorded. |
| Issue completion | Exact operation, request digest, nonce, lease, and fence exist. | DO transaction stores exact response bytes/digest or a known rejection and marks the operation terminal. | A timeout, caller disconnect, alarm, or lease expiry does not itself release the blocker. |
| Recovery admission | Pending release or source mismatch; no new freshness issuance may begin. | DO transaction sets `recovery_pending` and `writer_pending`; recovery proceeds only after no issue operation remains unsettled. | Recovery cannot bypass an operation whose lease expired but whose result is unknown. It re-reads Journal/R2 before every repair and fails closed on unknown or conflicting state. |

### Concurrency and crash cases

- **Lease acquisition vs `beginRelease`:** both contend on the same DO
  transaction. If the lease wins, release records writer-pending/waiting but
  cannot CAS R2 or append Journal until every earlier issue operation is
  durably terminal; expiry alone does not clear an unresolved blocker. If
  release admission wins, new leases are denied. There is no
  overlap.
- **Writer-pending vs a new lease:** the same serialized DO transaction
  decides the winner. Writer-pending prevents all later lease grants.
- **Crash after `PREPARED`, before pointer write:** if the durable
  `pointer_write_started` bit is false and the prior pointer is unchanged,
  recovery may abort or resume the exact candidate. No Freshness response is
  allowed while the attempt remains pending.
- **Crash after pointer CAS, before `POINTER_COMMITTED`:** re-read the mutable
  pointer and immutable snapshot. Exact candidate bytes/digest/ETag advance
  the DO; any mismatch or unknown result stays blocked.
- **R2 CAS outcome unknown:** the S3 publisher already models readback and
  no automatic retry. Production recovery follows the same fail-closed rule;
  a missing/prior read does not prove an admitted write cannot still complete.
- **Crash after `POINTER_COMMITTED`, before HSM signing:** revalidate the
  exact pending attempt, prior Journal head, pointer, snapshot, and delegation,
  then continue.
- **HSM signature succeeds before DO persistence:** the signature is orphaned.
  It is not sent to APP and is not appended. Reauthorization is allowed only
  for the same attempt and unchanged prior head.
- **Authorization persisted, Journal append not known:** remain pending and
  block Freshness. Retry only the exact persisted bytes against the unchanged
  expected Journal head.
- **Crash immediately before/after Journal append:** query the Journal's
  authenticated linearizable head. Exact record/delegation/append metadata at
  the expected position is committed; an unchanged prior head permits retry
  of the exact stored bytes against that head. If that retry conflicts, read
  back and compare the exact record; a different or unknown head requires
  recovery.
- **Journal append succeeds, DO update fails:** Journal is authoritative.
  Repair the DO from the exact Journal record and R2 snapshot at the same
  generation. Do not issue Freshness during repair.
- **Freshness signer outlives the 8-second lease:** discard the response
  signature. The lease is checked after signing; a delayed signer cannot turn
  an expired lease into a response.
- **Several Freshness requests race a release:** each lease grant serializes
  in the DO. Release waits for every unsettled issue operation to become
  durably terminal; lease expiry alone does not clear a blocker. After
  writer-pending is stored, no new lease can join.
- **Recovery races a Freshness lease:** recovery first installs the gate in
  the same DO transaction, waits for existing leases, and denies new ones.
  Recovery never runs as an out-of-band bypass.
- **DO and Journal disagree / Journal chain is corrupt:** no signature and no
  Freshness. Validate the complete chain and exact append metadata; restore
  the DO only from the independently retained Journal and matching R2
  snapshot. If the Journal/checkpoint is also rolled back or corrupt, remain
  `BLOCKED` pending independently authorized recovery.
- **R2 pointer and immutable snapshot disagree:** no signature. Never repair
  by treating the pointer or a candidate manifest as authority.
- **DO state lost or PITR-restored:** compare against the independent Journal
  and R2. A missing/older DO is recovery-required, not generation zero.
  Rebuild only from a verified Journal chain and matching pointer/snapshot;
  if all independent witnesses were rolled back, no automatic cryptographic
  recovery exists.

Lease expiry, signer timestamps, Journal append time, and the APP's clock
window are not interchangeable. APP time is local wall clock with a
conservative 30-second margin; the monotonic 10-second deadline is separate.
Release/Freshness signer and Journal time must be trusted UTC with no
delegation skew grace. The current repository does not establish a trusted
Production UTC source or a bounded clock-error guarantee for the DO lease;
that registration/assurance is a blocker, not permission to substitute a
caller timestamp or unverified test clock.

## External dependencies and current status

| Dependency | Repository evidence | Registration / status |
|---|---|---|
| Bootstrap trust root and APP pin | APP reads three build-time `option_env!` values; protocol requires offline root custody. | Public pin/build registration is **NOT_CHECKED** here; readiness history records Production registration as **NOT_REGISTERED**. Trust-owner approval and APP release are required. No private root key is in source. |
| Release Authority HSM key and signer | No Production signer Worker/service or HSM binding in the verification Worker. | **NOT_IMPLEMENTED / NOT_REGISTERED**; key custody, provider, delegation, and typed signing policy require approval. |
| Freshness HSM key and signer | No Production Freshness signer or HSM binding. | **NOT_IMPLEMENTED / NOT_REGISTERED**; separate key/provider and renewal process require approval. |
| Runtime Config coordination DO | The Production Worker still declares only the verification-binding DO; a separate SQLite coordinator package and local-only runtime configuration now exist. | The local adapter is **LOCAL_WORKERS_RUNTIME_VERIFIED**. Production namespace/class/migration and role-specific access remain **NOT_IMPLEMENTED / NOT_REGISTERED**. |
| Runtime Config R2 bucket | Existing Worker R2 binding is for TLSN archives; a separate script adapter expects named S3 credentials. | Dedicated bucket, object retention, writer/read-only token scopes, and availability are **NOT_CHECKED**. No R2 values were read or writes attempted. |
| Public object origin | APP requires snapshot/artifact GETs on the Bootstrap hostname. No corresponding route is declared in the inspected Worker config. | Same-host domain/path routing and read-only origin are **NOT_REGISTERED / NOT_CHECKED**. |
| Release Journal | No Production Journal provider or adapter exists. | Provider, independently administered retention, authenticated linearizable `getHead`, atomic compare-and-append, append-time clock, and recovery checkpoint require human approval. |
| Trusted time | No Freshness/Release/Journal clock binding or provider exists in the Worker source. | **UNKNOWN / NOT_CHECKED**; trust owner must approve UTC source and clock bounds for signer, Journal, and bounded issue leases. |
| Worker environment/service bindings | Existing `wrangler.toml` declares only verification DO/R2 and Production version metadata. | New role-specific Worker/service bindings, deploy identities, and same-host routes are **NOT_REGISTERED**. No deploy/configuration was changed. |
| DO RPC credentials | The current verifier callback secret is route-specific and is not a DO role credential. | Distinct Authority, Release-signer, and Freshness-signer HMAC secrets are **NOT_REGISTERED**; register them only through the approved secret store. |
| Runtime tests/observability | A dedicated Miniflare/workerd harness now exercises the SQLite coordinator locally; Production Workers Logs/Traces are not configured. | The local adapter is **LOCAL_WORKERS_RUNTIME_VERIFIED**. No hosted or live Production tests were run; Production observability remains future work. |

The only human-authority decisions that should remain are approval/registration
of trust custody, HSM providers and keys, the independent Journal and its
retention/checkpoint, trusted clock bounds, scoped Cloudflare resources,
domain/routes, Worker identities, and APP release. No secret values should be
sent through chat.

## Implementation roadmap

The phases below separate code that can be tested locally from external
registration. P3 and P4 can proceed in parallel after P1/P2 interfaces are
stable. Production signing and external writes remain gated until approved.

| Phase | Files / component | Depends on | Completion conditions and required tests | External dependency |
|---|---|---|---|---|
| **P1 — domain, validation, signer interfaces and issuer core** | `FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/signers.ts`, `freshness-issue.ts`, and Node contract tests. | None. | Strict canonical request validation; issue/signer IDs, request/nonce/environment binding, lease/clock/fence/current-state evidence, exact response verification and durable-finalization-only return. Current fake adapters are local-only; no Production authority is connected. | None for local implementation. |
| **P2 — coordination DO** | Dedicated SQLite-backed coordinator package and local-only runtime configuration; Production Authority Worker's role-checked RPCs, `wrangler.toml` migration and generated binding types remain future work. | P1. | Local adapter currently verifies atomic operation admission/finalization, active blockers, restart persistence, exact result retrieval, and selected Release/fence races. Production completion still requires reviewed role access, recovery transitions, full crash-boundary tests, and no transaction held across external I/O. | Cloudflare namespace/binding registration and trusted external providers before deployed tests. |
| **P3 — Release Journal adapter** | Authority Worker's `journal-client.ts` and provider adapter/conformance tests. | P1/P2. | Multi-generation chain, exact record/delegation bytes, append timestamp, compare-and-append, same-byte idempotency, conflict, unavailable/ambiguous result, corruption and recovery tests. | Approved independent provider, retention, clock, and checkpoint. |
| **P4 — R2 immutable/pointer adapters** | Authority Worker's R2 writer; scoped read-only R2 client for signers/object reader; immutable Manifest snapshot support; object-key allowlists. | P1; may run beside P3. | `If-None-Match: *` immutable create, `If-Match` pointer CAS, exact readback, ETag preservation, pointer/snapshot equality, ambiguous outcomes and no-auto-retry policy. Include the APP-required `manifests/<digest>` object, currently absent from the publisher. | Dedicated bucket, R2 permissions/tokens, and authorized disposable-bucket integration test. |
| **P5 — Release Authority orchestration** | `FUSOU-TLSN-RUNTIME-CONFIG-AUTHORITY/src/release-authority.ts`; separate `FUSOU-TLSN-RUNTIME-CONFIG-RELEASE-SIGNER/src/index.ts` and commit verifier; authenticated release submission script. | P1–P4. | Test exact attempt binding, signer checks before HSM, orphan signatures, persisted authorization, Journal append point, DO post-append repair, all crash/ambiguous boundaries, genesis approval, and no Freshness before `COMMITTED`. | Release key/HSM, operator identity, Journal, DO and R2 registration. |
| **P6 — Freshness Authority/signer** | Separate `FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-SIGNER` Worker, read-only Journal/R2 adapters, direct DO read/issue/finalization RPC, typed HSM client. | P1–P5. | Test `LATEST_AT_ISSUANCE`, exact nonce/audience, current Journal/DO/R2/snapshot/Manifest agreement, maximum 8-second authorization lease, rejection after expiry, retained blocker for unknown work, concurrent release, delegation/time limits, and no response on any missing/contradictory read. | Freshness key/HSM, trusted clock with uncertainty bounds, scoped read-only access and same DO/Journal resources. |
| **P7 — HTTP and immutable object delivery** | Separate `FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-GATEWAY` Worker and `FUSOU-TLSN-RUNTIME-CONFIG-OBJECT-READER` (`src/index.ts`, `src/r2-readonly.ts`, `wrangler.toml`, tests); same-host route configuration. | P4/P6. | Worker-runtime tests for POST/GET methods, canonical/unknown/oversize requests, 200/no redirect/no-store response, 64 KiB response bound, allowed object paths/cache headers, unknown environment, Gateway isolation, and signer outage. | Approved domain, route and read-only R2 object origin. |
| **P8 — APP ↔ Worker contract integration** | Shared JS/Rust golden vectors; APP test-only transport seam if needed; Worker runtime integration tests across Gateway/signer/DO/R2/Journal fakes. | P1–P7. | Feed Worker-produced exact response bytes to the APP verifier; test signatures, sidecars, expiry/skew, nonce, every artifact digest, one shared 10-second deadline, final rename, and state preservation on failure. No live services required for the local suite. | Hosted CI registration is separate; Production acceptance still requires live evidence. |

The dedicated Miniflare/workerd suite now verifies selected DO persistence,
concurrency, state transitions, and runtime recreation against the local
Workers runtime; the provider-independent Node in-memory suite remains a fast
protocol model. Add Workers Vitest coverage if needed for future migration or
route-specific behaviors, but neither local suite is evidence of Production
registration or authority. Generated binding types must match the selected Wrangler schema.
New services should enable structured Logs and Traces; update and test their
compatibility date at implementation time.

## Readiness and scope boundary

- The readiness rows recorded in this design are historical to its stated
  review baseline. The current readiness boundary is maintained in
  [`FIRST-TESTPLAY-READINESS.md`](../FIRST-TESTPLAY-READINESS.md): the shared
  issuer core is source-implemented and locally Node-tested; the dedicated
  SQLite DO adapter is local-Workers-runtime verified; Production Freshness
  and all registrations remain blocked.
- The local adapter's fake clock, witness, bootstrap, and Release controls
  exist only in the local test Worker/configuration. Runtime recreation
  verifies local storage persistence, not Production PITR resistance,
  independent anti-rollback, an 8-second Production clock guarantee, or HSM
  physical cancellation. Hosted CI remains **NOT_CHECKED**; Stage A/B/C and
  Production acceptance remain **BLOCKED**.
- Stage A, Stage B, Stage C, Production acceptance, deployment, real
  Presentation/Result verification, and real-game testplay remain
  **BLOCKED**. This design does not promote any readiness status.
- No Production APP/Worker route, DO/R2/HSM service, credential, binding, or
  external service was changed or operated. The shared-domain core does not
  register or select any of them.
- Browser integrity, APP process/image authority, TPM/measured boot, and
  privileged helpers remain out of scope. Freshness failure gates TLSN
  capture/readiness only; it does not change ordinary APP-to-Game-Server
  traffic or the existing TLSN evidence chain.
