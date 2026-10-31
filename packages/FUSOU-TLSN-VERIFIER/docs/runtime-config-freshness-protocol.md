# Runtime Config Freshness Protocol — Phase 0 Specification

- **Status:** Specification selected; implementation and approval pending
- **Updated:** 2026-11-01
- **Repository HEAD at review start:** `254967c4fb77d279a608da91b8836b5b9d8f551e`
- **Runtime-source baseline:** `43ab72e6284deee3ad202be7fb50e3f0199af304`
- **Historical design snapshot:** `a0cb49250df53132ee8df42ca02fbce91e10c7d2`
- **Readiness record:** [FIRST-TESTPLAY-READINESS.md](../FIRST-TESTPLAY-READINESS.md)

This is the Phase 0 protocol specification. It changes no APP, Worker, Rust,
TypeScript, JavaScript, build, binding, or deployment source. It creates no key,
contacts no Production service, and writes nothing to R2. The source baseline
was independently inspected. At review start, the APP/Worker Runtime Config
source paths compared in Section 2 were unchanged from runtime-source baseline
`43ab72e...`; the older design snapshot `a0cb492...` is historical, not the
current repository HEAD.
The edits made for this Phase 0 review are documentation-only.

The protocol is **not implemented**. Root and delegated keys, the Release
Journal, the authority state machine, endpoint, and Production registration
are all absent or unregistered. No Freshness, deployment, or real-game
readiness is implied by this specification.

## 1. Normative decisions

1. **Use a Bootstrap-root-delegated Release Authority commit record.** The
   Freshness signer must verify that record, independently read the current
   R2 pointer and immutable Manifest snapshot, and compare them with the
   environment's Durable Object ledger. This is Option B. It is not enough to
   trust values supplied by the HTTP endpoint.
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

## 2. Source-confirmed current implementation

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
| Release Authority | Separate Ed25519 child key delegated by the Bootstrap root; non-exportable in an online HSM or equivalent managed signing service. | Sign only `release-commit-record-v1` after the signer service independently reads and checks the committed pointer, DO state, Journal head and Manifest snapshot. The API accepts a typed commit operation, never arbitrary bytes. | No Manifest, Result, Notary, or Freshness-response signature. No R2 pointer-write credential or arbitrary Journal update/delete permission. |
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
delegation issued by the offline Bootstrap root has a maximum validity of 30
days. These are maximum
caps, not registered certificate dates.

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
   HSM. It accepts a typed commit operation, not arbitrary bytes or
   endpoint-supplied epoch/digest claims. It has no R2 pointer-write
   credential, cannot update/delete Journal records, and cannot sign Manifest,
   Result, Notary or Freshness-response payloads.
4. **Append-only Release Journal:** stores each Release Authority signed
   commit record and its exact root-signed Release Authority delegation
   envelope create-once, with monotonic per-environment generation and
   previous-record hash. Only the authenticated Authority Worker commit
   transaction can append after verifying the record/delegation and matching
   the prepared DO attempt. The Journal verifier uses an independently
   provisioned copy of the approved Bootstrap public key, never a caller- or
   APP-supplied root. Journal append is atomic compare-and-append:
   require the record's previous generation and hash to equal the current
   head, require generation `head + 1` and a strictly greater Manifest epoch,
   then create the record and delegation sidecar once. An exact same-byte
   retry is idempotent; a different record at that generation rejects. No
   general update/delete API exists. Its authenticated, linearizable
   latest-head API returns the exact record and delegation bytes and is the
   authority for which record is newest.
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
only a Release Authority-signed record matching the current
`POINTER_COMMITTED` DO attempt, expected generation/previous-record digest,
environment and exact R2 readback, with no active issue lease. Journal append
is create-once and cannot update or delete records; an exact idempotent replay
is accepted only for the same record bytes. The Release Authority signer
returns a signature but has no Journal write capability. The Freshness signer
has read-only Journal access plus direct DO read/issue-lease RPCs.

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
4. fetches the corresponding signed commit record and verifies its
   Release-Authority signature/delegation, generation, previous-record hash,
   environment and `COMMITTED` state;
5. queries `getCurrentCommitted` directly from the same DO namespace and
   requires its stored generation, epoch, digest, commit ID and record digest
   to equal the Journal head, with no pending transaction;
6. reads `manifest.json` directly from the R2 S3 API using read-only access,
   obtains its opaque ETag and exact raw bytes, and verifies the bytes match
   the commit record's digest and pointer ETag;
7. reads `manifest_ref` from the immutable snapshot namespace and requires
   byte-for-byte equality with the mutable pointer;
8. verifies the Manifest v2 envelope signature with the Bootstrap public key,
   then checks the exact Production schema, epoch, scope and referenced
   metadata against the commit record;
9. checks all observed values again against the request environment/audience,
   captures `issued_at` while the lease is still valid, and signs the response
   with the Freshness delegated key;
10. releases the issue lease through the authenticated DO RPC after
    signing and returns the signed response. If the lease expired or the
    signer cannot confirm it before signing, it discards the signature and
    returns an error.

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
  state, and whether the pointer write was started;
- active issue leases keyed by a CSPRNG UUID, containing environment,
  committed generation, acquisition time and expiry (maximum 8 seconds), plus
  a writer-pending flag. Leases do not alter the committed release head.
- no private keys, endpoint-supplied "latest" claims, or APP state.

The append-only Release Journal stores the exact signed
`ReleaseCommitRecordV1` bytes at a create-once generation/commit-ID key,
including the previous record hash, and the matching root-signed Release
Authority delegation envelope as an immutable sidecar. Before append, the
Authority Worker verifies both signatures and the prepared attempt. The
Journal atomically compares the record's previous generation/hash and
strictly increasing Manifest epoch against its current head before creating
the next record; it does not trust a caller's head assertion. The current
head operation returns the exact record and delegation bytes and is part of
the Journal trust contract. The pointer ETag is recorded as an opaque
conditional-write token; the SHA-256 of exact Manifest bytes is the
cryptographic identifier.

The signed record payload is:

```json
{
  "schema_version": 1,
  "scope": "fusou-tlsn-runtime-config-release-commit-v1",
  "environment": "production",
  "commit_state": "COMMITTED",
  "commit_generation": "18",
  "release_commit_id": "lowercase-canonical-uuid",
  "manifest_schema_version": 2,
  "manifest_epoch": "43",
  "manifest_sha256": "<base64url-sha256-of-exact-envelope>",
  "manifest_ref": "tlsn/runtime-config/v2/manifests/<same-digest>",
  "pointer_etag": "<opaque-exact-r2-etag>",
  "previous_commit_generation": "17",
  "previous_commit_record_sha256": "<base64url-sha256>",
  "committed_at": "2026-11-01T00:00:00.000Z",
  "release_authority_delegation_id": "lowercase-canonical-uuid",
  "release_authority_delegation_sha256": "<base64url-sha256>"
}
```

For genesis, generation is `1`, Manifest epoch is positive, and both
previous-generation fields are `null`; genesis requires an explicit
root-approved authorization. A missing DO record or R2 pointer is never
interpreted as permission to initialize epoch `0`.

### 6.2 State transitions

| State | Meaning and durable data | Allowed transition and CAS | Signer may respond? |
|---|---|---|---|
| `PREPARED` | Candidate Manifest/artifact/snapshot bytes were validated and written immutably. DO records candidate epoch/digest/ref, attempt ID, expected previous generation/digest/ETag, and pointer-write flag. No commit is yet authoritative. | `beginRelease` requires no active issue lease and a matching current head. `PREPARED -> POINTER_COMMITTED` only after Authority Worker performs R2 `If-Match` on the expected previous ETag (or `If-None-Match: *` for authorized genesis) and directly reads back exact bytes. A same attempt/same bytes retry is idempotent; same generation with different bytes rejects. | **No.** Any pending attempt blocks Freshness. |
| `POINTER_COMMITTED` | R2 mutable pointer and immutable snapshot both contain the exact candidate bytes; the actual ETag is recorded. Release Journal still has no committed record. | `POINTER_COMMITTED -> COMMITTED` only after the online Release Authority HSM service validates the direct R2/DO readback, signs the record, the Authority Worker's single commit transaction appends/reads back those exact bytes in the Journal, and the DO atomically advances its current generation. No active issue lease or other pending transaction is allowed. | **No.** A pointer without an archived commit record is not a committed release. |
| `COMMITTED` | DO current row, Journal head/record, R2 pointer, immutable Manifest snapshot and Manifest signature agree at the same environment, generation, epoch, digest and commit ID. | Next release must be generation `current+1`, Manifest epoch strictly greater than current, expected previous digest/generation equal current, and CAS against current ETag. Same epoch/different bytes always rejects. | **Yes**, only after the signer freshly rechecks every source in Section 5.3 and sees no pending attempt. |
| `ABORTED` (terminal attempt) | A pre-pointer attempt was cancelled after proving the pointer write was never started and the old pointer is unchanged. Record attempt ID and reason; never lower current generation. | A new attempt starts with a new attempt ID and current generation. An ambiguous/in-flight write cannot be aborted automatically. | Only if the current `COMMITTED` head and all sources still agree. |

If `beginRelease` arrives while issue leases exist, the DO enters a bounded
`WAITING_FOR_LEASES` admission substate: it marks a writer pending, blocks new
leases, and performs no pointer write. After the existing leases finish or
expire, the caller retries the same attempt ID; the DO revalidates the
committed generation, digest and ETag before creating `PREPARED`. The wait
expires after 10 seconds; expiry before `pointer_write_started` aborts only
that attempt and leaves immutable objects as uncommitted orphans.

DO state updates use one SQLite transaction per state transition. R2, Journal,
or signer I/O must occur outside that transaction; after external I/O, the DO
rechecks the expected attempt/generation in a transaction before advancing.
No transaction waits on network I/O. `PREPARED` sets `pointer_write_started`
before the publisher begins CAS. ETags are exact CAS values; body digests are
recomputed from bytes.

Freshness issue leases are separate from release states and expire after at
most 8 seconds. The DO allows multiple bounded read leases for the same
committed generation, but blocks a new `PREPARED` release and all pointer CAS
while any valid lease exists. A release request sets a writer-pending flag so
new leases are refused; existing leases drain or expire before the release
begins. The Gateway enforces a finite in-flight limit and returns unavailable
above it. The signer acquires a lease before its final Journal/DO/R2 checks
and keeps it through signature creation. It releases the lease after signing
or lets its bounded expiry release it after failure. The APP's 10-second
monotonic response deadline is longer than the signer's bounded lease work
budget; the signer must discard a response if its lease expires before
signature creation. The DO never holds a storage transaction across R2,
Journal, or signer I/O.

The Authority Worker's single `commitRelease` path checks the lease table and
writer-pending attempt before pointer write, Journal append, or DO commit.
Only that path has the Journal append credential; the Release Authority HSM
can sign a typed record but cannot append/update/delete it, and the Freshness
Signer can only read Journal state and acquire/release its scoped lease.
Therefore no legitimate pointer or Journal-head update can interleave between
the signer's final consistency read and response signature. Recovery has no
lease-bypass path: first disable Freshness issuance through the separately
controlled kill switch, wait for active leases to finish/expire, then perform
two-person recovery. Re-enable Freshness only after Journal, DO, R2 pointer
and snapshot agree.

`POINTER_COMMITTED` is provisional coordination state, not a Freshness
authorization. A publisher report alone cannot advance the DO to
`COMMITTED`: the Release Authority signer must independently verify R2 and
DO state, sign the exact commit record, and append/read it back from the
Journal. The Freshness signer then independently re-reads all sources.

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
| 8. DO ledger is lost, R2 pointer remains | No current DO state; Journal retains signed commit chain/head. | Freshness stays blocked. Restore DO only from a verified Journal chain plus pointer/snapshot readback; do not initialize at zero. |
| 9. R2 pointer is lost, ledger/journal remain | Missing mutable `manifest.json`; current generation remains nonzero. | Freshness stays blocked. Restore the exact content-addressed snapshot with conditional create, verify ETag/body, then re-enable only after all three sources agree. |
| 10. R2 backup restore makes an old pointer visible | DO/Journal head has greater generation/digest. | Detect mismatch and block. A restore of DO or Journal state too must be treated as an authority incident; compare the independent WORM checkpoint. If every independent source has been rolled back, no automatic cryptographic recovery exists. |

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
| `issued_at`, `expires_at` | UTC RFC3339 with exactly millisecond precision and `Z` | Signer time; APP enforces ordering, <=30-second skew, <=30-second response TTL and 10-second monotonic challenge deadline. | Limit replay and detect clock/expiry errors. |
| `latest_epoch` | Canonical unsigned decimal string, no leading zero, in Manifest v2 UInt64 range | From Release Journal head and must equal commit record and Manifest payload. | Bind current release epoch. |
| `manifest_schema_version` | JSON integer `2` | Must equal the fetched Manifest v2 schema. | Prevent schema confusion. |
| `manifest_sha256` | SHA-256 of exact raw signed Manifest envelope, base64url without padding | Recomputed from the immutable snapshot bytes. | Prevent body substitution/whitespace reserialization. |
| `manifest_ref` | Exact relative key `tlsn/runtime-config/v2/manifests/<manifest_sha256>` | Must match digest and fixed namespace; no URL accepted from caller. | Identifies recoverable immutable bytes. |
| `pointer_generation` | Canonical unsigned decimal string, no leading zero | Must equal Release Journal generation and DO committed generation. | Bind the R2 pointer transition, not just Manifest epoch. |
| `release_commit_id` | Lowercase canonical UUIDv4 | Must equal signed commit record. | Uniquely bind this commit attempt. |
| `release_commit_record_sha256` | SHA-256 of exact signed record envelope, base64url without padding | Recomputed from response sidecar. | Bind the independently signed commit authorization. |
| `freshness_signer_key_id` | Existing key-ID grammar `[A-Za-z0-9._-]{1,128}` | Must equal envelope key ID and Freshness delegation. | Select the purpose-limited response key. |
| Freshness delegation ID/digest | UUID plus exact-envelope SHA-256 | Recompute and verify root signature, purpose, audience, generation and validity. | Bind the delegated response signer. |
| Release Authority key ID/delegation ID/digest | Key ID, UUID, exact-envelope SHA-256 | Recompute and verify root signature and `release-commit-record-v1` purpose. | Bind the independent commit-record signer. |

The Release Commit Record sidecar must contain `commit_state=COMMITTED`,
environment, generation, Manifest epoch/schema/digest/ref, pointer ETag,
release commit ID, previous generation/record digest, commit time, Release
Authority key ID and delegation digest. Its exact bytes are hashed above and
its signature is verified with the Release Authority key certified by the
Bootstrap root.

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
   verify its key ID, Ed25519 purpose, Production scope, audience,
   generation, expiry and previous-delegation link.
6. Verify the signed Release Commit Record with that delegated Release
   Authority key. Require exact `COMMITTED`, environment, generation,
   Manifest schema/epoch/digest/ref, ETag, commit ID and previous-record link.
7. Verify the Freshness delegation with the same embedded Bootstrap root;
   require its purpose to be only `freshness-response-v1`, correct
   environment/audience/key ID, valid period and delegation generation.
8. Verify the response signature with the delegated Freshness public key.
   The response key ID and delegation ID/digest must match exactly.
9. Require exact nonce equality with the outstanding one-use challenge,
   `LATEST_AT_ISSUANCE`, correct audience/environment, and bounded issue/
   expiry times. Consume/discard the nonce on every outcome. Check the same
   monotonic deadline; do not start a new timeout for any following fetch.
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
    again; perform no `await` or unrelated I/O between this check and rename.
    If elapsed time is 10 seconds or more, remove the temporary file, discard
    the verified result, and do not change epoch, digest, commit generation,
    record digest, delegation generation, or last signed time. Otherwise,
    atomically rename the complete state file and then sync the parent
    directory for durability. The rename is the acceptance/persistence
    linearization point.

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
releases continue, that rolling downgrade can persist until the current
Freshness delegation expires (maximum 24 hours), or the service is disabled.
Response TTL and the APP's 10-second deadline do not bound this attack because
the compromised signer can issue a new response for each request. Local
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
   signer/journal checks pass. An extracted old key remains usable by an
   attacker until its delegation expires; a fresh APP cannot remotely learn
   an untrusted revocation statement. The 24-hour delegation cap is the
   maximum exposure absent successful service-key disable.
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
| Release Authority HSM key/service compromised | A non-exportable key can still be misused through its online signing interface. The typed service must re-read the pending DO attempt, pointer/snapshot and prior Journal head before signing; Journal compare-and-append and the Authority Worker's commit path independently recheck the signed record and expected generation/epoch. | The signer alone can create commit-record signatures but cannot write the pointer, DO ledger or Journal, and cannot create a Freshness response. The delegated signature authority expires within 30 days; an untrusted revocation is not available to a fresh APP. If combined with Authority Worker compromise it can cause malformed commits or availability loss; APP and Freshness still require the original root-signed Manifest v2 and monotonic Journal head, so no Manifest/Notary/Result trust can be forged. |
| Freshness delegated key compromised | Attacker can sign a response to each fresh nonce and replay any still-valid root-signed Manifest/Release Commit Record as latest. APP verifies those originals but cannot independently know Journal head. | Latestness guarantee is compromised. A fixed Manifest is bounded by `min(expires_at + 60s, observed_at + 630s)` under the clock assumption; with continuing releases, rollback may persist until the delegation expires (maximum 24 hours). The 10-second request deadline does not limit this attack. The child cannot create new Manifest, Result, Notary or Registry signatures. |
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
| Delegation not-before, not-after, generation rollback, previous digest mismatch | Reject; no response accepted. | APP unit |
| Freshness delegation expired/revoked by expiry | Reject even if response signature is otherwise valid. | APP unit |
| Release Authority record signature invalid, wrong key/delegation, wrong scope/env/state | Journal entry not committed; signer and APP reject. | Release Authority + signer unit |
| Release record wrong epoch/digest/ref/ETag/generation/commit ID or previous record hash | Reject; do not advance DO or Journal head. | DO + Release Authority unit |
| Journal append has a stale previous head, repeated generation with different bytes, or non-increasing Manifest epoch | Reject atomically; preserve current Journal head. | Journal compare-and-append integration |
| Release/Freshness signer uses the wrong DO operation credential or attempts a release mutation | Reject; no pointer, DO release state or Journal change. | DO RPC authorization integration |
| Release signer receives forged DO/pointer/Journal claims from its caller | Ignore caller state and independently read its DO binding, R2 and Journal; do not sign on mismatch. | Release signer integration |
| Root-signed Manifest modified after record creation | Exact digest/signature mismatch; no Freshness response. | Signer unit |
| Publish attempt starts while an issue lease is active | DO denies pointer preparation/CAS until leases end; no pointer mutation occurs. | DO concurrency test |
| Freshness request starts after a release is pending | DO refuses a new lease; no response signature. | DO + signer integration |
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
| Crash after POINTER_COMMITTED before signed Journal append | Signer blocks; Release Authority HSM service may complete the exact prepared record after revalidating all current state. | Release Authority integration |
| Crash after Journal append before DO COMMITTED | Recovery validates exact Journal record and pointer before advancing DO; no new generation. | DO + Journal integration |
| Partial artifact/snapshot writes | Pointer remains unchanged; no commit record or Freshness signature. | Publisher unit |
| Missing pointer with nonzero DO/Journal state | Never treat as first install; restore exact latest snapshot or remain blocked. | Signer/recovery integration |
| Pointer-only restore from R2 backup | DO/Journal higher generation forces rejection. | Recovery integration |
| All current sources disagree or Journal lost | No signature, no epoch-zero fallback, manual recovery required. | Recovery/runbook exercise |
| CDN supplies cached old response or old Manifest | Nonce or exact raw digest mismatch rejects. | APP/Worker integration |
| Freshness endpoint/signer/Journal/DO unavailable | TLSN readiness blocks, local state unchanged, normal proxy traffic still succeeds. | APP integration |
| Freshness response arrives before 10 seconds but Manifest/artifact verification finishes at/after the shared deadline | Reject; do not persist epoch, digest, commit or delegation state. | APP integration with delayed fake fetcher |
| Deadline expires immediately before atomic state rename | Remove the temporary state file; the prior canonical state is unchanged. | APP state-store unit test with monotonic clock |
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
  10-second APP deadline, and failure policy.
- **Order/dependency:** complete before implementation.
- **Tests:** source inspection and current existing Node contract tests only;
  no Freshness tests or signing calls.
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
  `commitRelease`, `getPreparedRelease`, `acquireFreshnessIssueLease`,
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
  signature/delegation, compares previous head hash/generation and increasing
  Manifest epoch, then creates the record once; `getHead(environment)` is
  authenticated and linearizable.
- **Order:** prepare/verify Manifest and artifacts; write artifacts and
  snapshot create-only; DO records PREPARED; the Authority Worker sets the
  pointer-write-started bit and performs the existing R2 `If-Match` /
  `If-None-Match: *` CAS only when no issue lease is active; Authority
  directly reads the pointer/snapshot and records provisional
  POINTER_COMMITTED; the online Release Authority HSM service independently
  rereads R2/DO/Journal and signs the exact commit record; Journal
  compare-and-appends against its current head and reads back the create-once
  record; DO verifies it and transitions to COMMITTED. No endpoint-supplied
  release values are trusted in these transitions.
- **Tests:** all state transitions, CAS, concurrent release, generation and
  epoch rules, crash recovery, missing snapshot, Journal head mismatch,
  R2 restore, and no secret output. Run live R2 only against a separately
  authorized disposable bucket.
- **Fail/complete:** no Freshness response until all committed state sources
  agree. Any lost state blocks; no zero reset.
- **External input:** approve Journal provider/retention/account, DO
  namespace and scoped Worker bindings, Release Authority non-exportable HSM
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
  fetch method; immutable Manifest snapshot fetch; APP state v2 with
  epoch/digest/generation/record/delegation high-waters and atomic migration.
- **Order:** challenge -> verify both delegations -> verify commit record ->
  verify response -> nonce/time/deadline -> fetch exact snapshot -> existing
  full Manifest/artifact verification -> compare local state -> one atomic
  state update.
- **Tests:** all APP and canonicalization cases in Section 12, state loss,
  corruption, OS restore, clock rollback and monotonic deadline.
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
  game traffic, and cross-language vectors.
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
   v2 signature contract.
2. Release Authority key custody/approval and the independently administered
   append-only Journal provider, account, retention, access roles,
   independently provisioned Bootstrap public-key pin/rotation process and
   current-head guarantee.
3. Freshness key custody provider and its 24-hour maximum delegation policy.
   No private key or token is to be pasted into chat.
4. Release Journal/DO/R2 data retention, backup restore permissions,
   two-person recovery owners, and signed offsite checkpoint retention.
5. Approval of the 10-second request deadline, 30-second response maximum,
   30-second clock skew, and strict outage behavior.
6. Availability/latency load test for one Release Authority coordination
   object per environment; if it is inadequate, stop and re-approve a new
   serialization design rather than weakening checks.
7. Production endpoint/domain, R2 roles, signer registration, APP release
   and external service access. All remain unregistered/not checked.
8. Worker deployment identities, direct DO namespace bindings, and separate
   operation credentials for Authority mutation versus Release Authority
   reads and Freshness reads/leases. Cloudflare namespace bindings are not
   method-level ACLs; the deployed DO RPC authorization must be reviewed.
   These permissions are not registered or verified.

**Phase 0 result:** Option B and `LATEST_AT_ISSUANCE` are specified with
bounded semantics, delegated keys, a signed commit record, an independent
Journal, DO state transitions, APP verification and failure handling.
The Freshness protocol remains **NOT_IMPLEMENTED**, registrations remain
**BLOCKED**, and Production/Stage A/B/C acceptance remains **BLOCKED**.
