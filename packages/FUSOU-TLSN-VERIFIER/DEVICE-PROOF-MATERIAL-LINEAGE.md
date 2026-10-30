# Device-proof contract, material lineage and three testplay boundaries

## Status and source basis

Branch: `tlsn-first-testplay-candidate`. The earlier investigation started at
`ec37f88e7be4937dfae49f7ec6917c736992592c`, parent
`fbafee38f6da832f780bd9c2756651201a8ebf10`. Cached upstream
`origin/tlsn-first-testplay-candidate` was 0 ahead / 0 behind, with a clean
scoped index/worktree. No fetch, service operation or actual capture was used.

The subsequent implementation starts at
`fc29aac29d454bf949510e0d97acbd3cd7e68e5b`. Both owner handlers now exist in
the WEB lifecycle router. The new
[proof-consumption migration](../FUSOU-WEB/supabase/migrations/20261030000000_tlsn_device_proofs.sql)
connects existing ownership to durable, atomic proof consumption. No enrollment
authority, ownership transfer, signer or root was added. Deployment and
migration against real Supabase remain **NOT_CHECKED / NOT_RUN**.
All three stages currently have `BLOCKED_CODE`, plus external-input blockers.
Local tests do not establish deployment, real proof capture or gameplay approval.

The user explicitly chose **classification/documentation only** for the existing
candidate execution-receipt prerequisite: its writer/finalizer gates stay intact.
This is not a decision that makes a Canary receipt a Production authority.

Relevant sources:

* [Worker routing/configuration](../FUSOU-TLSN-VERIFICATION-WORKER/src/index.ts),
  [proof HTTP clients](../FUSOU-TLSN-VERIFICATION-WORKER/src/device-proof-client.ts),
  [Binding Authority](../FUSOU-TLSN-VERIFICATION-WORKER/src/binding_authority.ts).
* [APP dependency construction](../FUSOU-APP/src-tauri/src/wrap_proxy.rs),
  [APP binding, proof and candidate writer](../FUSOU-PROXY/proxy-https/src/real_tlsn.rs),
  [AUTH client](../fusou-auth/src/manager.rs).
* [WEB device lifecycle](../FUSOU-WEB/src/server/routes/anonymous-sync-v2.ts),
  [route mount](../FUSOU-WEB/src/server/app.ts),
  [challenge/signature helpers](../FUSOU-WEB/src/server/utils/pepper.ts).
* [Bundle verifier](src/evidence_bundle.rs), [finalizer](src/evidence_bundle/finalization.rs),
  [existing authenticity contract](../../docs/architecture/tlsn-data-authenticity-contract.md).

## 1. Three acceptance stages, not three bypass switches

| Stage | Acceptance evidence | Current reachability / status | Not implied |
|---|---|---|---|
| A: `TLSN_PROTOCOL_TESTPLAY` | Real Game Server Presentation; trusted Notary signature; observed canonical DNS/Web PKI identity; real signed Result and exact Presentation binding | `BLOCKED_CODE`: no independent APP protocol-only entry. The actual APP always constructs Remote Session Binding and Worker verification. Both proof APIs are needed before this route can finish. Runtime Config/target/keys/services are also external prerequisites. | User/device ownership, a complete Bundle, execution-provider authority, full-Bundle remote retention |
| B: `IDENTITY_BOUND_TESTPLAY` | A plus authenticated/non-revoked owner/device, Session/Binding signatures, possession/challenge/replay, all 19 roles, local finalization and independent actual-evidence verification | `BLOCKED_CODE`: complete real-material assembly is not connected; candidate receipt gate deliberately retained. Owner handlers now exist, but real deployment and exact-owner enrollment remain external prerequisites. | Production delivery, formal builder/provider approval |
| C: `PRODUCTION_EVIDENCE_DELIVERY` | B plus complete-Bundle remote readback/retention, independently verifiable delivery receipt, approved applicable execution/signer/builder/provider and operational acceptance | `BLOCKED_CODE`: full-Bundle uploader/retention receipt and Production execution-receipt authority contract missing; approval/configuration also outstanding | Nothing is promoted by local status, elapsed time or a successful CLI return |

These are assessments of source contracts. The additive
[`acceptance_stages` report](../FUSOU-APP/scripts/testplay-acceptance-stages.mjs)
is wired into the existing pre-capture report; it never enables a runtime path
or grants gameplay. Existing preflight checks, report schema version and
`gameplay_authorized=false` / Production `BLOCKED` remain unchanged.

Protocol cryptography itself is separable: the
[alpha.15 adapter](src/tlsn_alpha15.rs) verifies Presentation bytes with an
externally supplied Notary key and DER trust anchor, then obtains the observed
server name/transcript. That library call has no device-proof, execution-receipt
or remote-delivery input. It is **not** an independent real-game APP launcher.
Do not substitute a synthetic binding/provider to make A reachable.
The existing Complete/Sparse Result contract also requires canonical user,
device and session/binding fields. A bare Presentation-verification call does
not produce an identity-free version of that signed Result. A new independent
A entry/profile would need explicit trust-boundary design approval; none is
implemented or enabled here.

The existing local Bundle verifier uses loaded local bytes and independent
options; it does not fetch remote storage or require a full-Bundle retention
receipt. Thus full-Bundle remote delivery belongs to C, not B's local verification.
However, the **current Worker Production-inventory Result path already requires raw
Presentation/outer-Result archive write/readback before authority commit**.
That operational dependency can affect A/B through this Worker. It is not
permission to remove it, nor proof that a complete Bundle was remotely delivered.

## 2. Implemented HTTP caller contract

### Owner implementation and transaction boundary

The public paths in the table below are now mounted by
[WEB](../FUSOU-WEB/src/server/routes/anonymous-sync-v2.ts), not by the TLSN Worker
or a new Supabase Edge service. The existing WEB/device/Supabase operators own
deployment; the responsible individual and live hostname are not inferred.
The handlers require an independently authenticated, non-anonymous Supabase
bearer and exact equality with the existing canonical device owner. They never
register, link, transfer, revive or replace a key. An anonymous registered owner
does not become a non-anonymous owner by calling these APIs.

Authentication signs the existing HMAC nonce's **UTF-8 text**. Possession uses
the shared [framing function](../FUSOU-TLSN-VERIFICATION-WORKER/src/device-proof-framing.ts):
domain `FUSOU-TLSN-DEVICE-PROOF-V1\0`, u16BE-length-prefixed device, session and
binding UTF-8 bytes, then the length-prefixed raw 32-byte challenge. No receipt
version is inserted. `replay_digest_hex` is SHA-256 of those message bytes,
not of the signature.

`rpc_consume_tlsn_device_proof` locks the existing device row, rechecks canonical
owner/non-anonymous user, raw Ed25519 key and revocation, then consumes the
nonce/proof in one transaction. Authentication shares existing lifecycle nonce
uniqueness. Possession has unique device/message and device/session claims.
Successful audit rows retain canonical owner, public-key snapshot, context
digests and DB consumption time. RLS and service-role-only grants restrict access.
Rows survive DB restart; there is no arbitrary TTL reset. Existing device
deletion cascades remain; Production audit/privacy retention still needs approval.

WEB proves possession of the supplied context; it does **not** independently
authorize a session/challenge supplied by the caller. Worker Binding Authority
continues to own issuance, expiry, context equality and consumption. Proofs
committed before later revocation are not globally/retroactively invalidated.
WEB commit, DO issuance and receipt signing are not a distributed transaction.
Later failure never unconsumes the proof or authorizes another origin send.

Success is HTTP 200 with the exact existing response schema. Missing/invalid
bearer, anonymous user, expired nonce or invalid signature returns 401; owner
mismatch 403; unknown device 404; revoked/replayed nonce/proof 409; oversized body
413; infrastructure/DB/schema-snapshot failure 503. These responses are bounded
and never retried automatically by the Worker client. WEB request bodies retain
the existing 64 KiB cap; Worker proof responses now have a 16 KiB declared/streamed
cap and a 10-second fetch timeout. Redirects fail closed. These limits do not
replace the APP's absolute exchange deadline.

The real Hono handler, Supabase SDK, Ed25519 verification, actual PostgreSQL RPC
and Worker consumer pass 24 new integration cases, alongside 39 existing cases.
Auth and PostgREST HTTP are local test adapters, **not** deployed Supabase.
Eight concurrent DB claims produce one success/seven replay refusals; restart,
revocation locking, key/owner races and rollback are tested.

### Actual call chain

1. APP `RemoteSessionBindingProvider::issue_binding` requires an existing
   authenticated APP session and a registered on-disk device key. It uses
   `fusou-auth`'s configured WEB challenge endpoint, signs the nonce and POSTs
   to the configured Worker `/attestation/session`. APP requires HTTP 201 and
   verifies the signed Session receipt/context before issuing its binding.
2. Worker independently checks the bearer through Supabase `/auth/v1/user`,
   refuses anonymous users and forwards the same bearer plus proof to the first
   owner API below. The configured HTTPS host is independently allowlisted and
   path must match exactly; redirects are not followed.
3. Only after owner proof success does Worker issue the DO binding and sign a
   Session receipt. APP uses its 32-byte device challenge for possession proof.
4. APP later POSTs Presentation/session/binding/device/proof to configured
   `/verify/tlsn` or `/verify/tlsn/sparse`. Worker calls the second owner API,
   validates its returned subject/device/digest, and binds the proof context to
   DO state and the independently verified Presentation/Result.
5. APP polls `/verify/tlsn/status` where needed. `/verify/tlsn/retry` is disabled.

Actual deployed base URLs, credentials and endpoint availability were not
inspected or tested. `fusou-auth` is a client, not the owner API implementation.

### Requests and responses

Both owner APIs use **POST**, `Content-Type: application/json`, and the user's
bearer Authorization header. No new service credential is invented.

| API | Exact JSON request | Accepted success JSON |
|---|---|---|
| `/api/auth/anonymous-sync/v2/device-proof` | `{device_id, nonce, sig}` | `{authenticated: true, canonical_user_id, device_id}` |
| `/api/auth/anonymous-sync/v2/tlsn-device-proof` | `{device_id, session_id, binding_value, challenge, sig}` | Above plus `{replay_digest_hex}` |

Worker validates the first request strictly: UUID device ID, exactly 64 lowercase
hex nonce characters, signature string 1..256 matching `[A-Za-z0-9+/_=-]+`.
The second request is assembled from the strictly validated verification request:
UUID device/session IDs, base64url binding length 1..512, canonical unpadded
base64url challenge decoding to exactly 32 bytes, and the same signature syntax.
It is a flat owner-service request, not the nested APP `device_proof` object.

Success response schemas are strict, reject extra properties, require UUIDs and
`authenticated: true`, and compare canonical user with the authenticated bearer
subject and device with the request. The caller accepts `response.ok` (2xx),
not exclusively 200. The proposed normal owner response is 200; no restriction
to that one status was silently added. Possession also requires 64 lowercase
hex digest characters and now compares that digest with the **current locally
framed proof message** before starting/consuming authority work.

The response is not a signed owner receipt. HTTPS/owner-service authentication
and later signed Session/Binding material have different responsibilities.

### Exact signature bytes

* Device authentication: Ed25519 over the **UTF-8 bytes of the 64-character
  nonce**, not decoded nonce bytes or JSON.
* Possession: concatenate `FUSOU-TLSN-DEVICE-PROOF-V1\0`, then four
  `u16 big-endian byte-length || bytes` fields, in order:
  device UUID string, session UUID string, opaque binding string, raw 32-byte
  challenge. String fields are UTF-8. There is no extra receipt-version word.
* `replay_digest_hex` is lowercase hex SHA-256 of those possession signing bytes,
  excluding the signature. Bundle proof/replay material also uses base64url
  SHA-256 of the same bytes.
* APP/Rust emits canonical lowercase hyphenated UUIDv4 strings. Worker framing
  uses the actual request strings, while its UUID schema is broader; the owner
  proposal requires the canonical APP spelling rather than silently normalizing
  signed bytes. No permissive normalization is implemented.
* Registered Ed25519 raw key bytes come from the owner row, never a request's
  self-reported key. Existing Session/consume receipt framing is separate:
  its own domain, `[0,1]` schema word and ordered length-prefixed fields.

### Failure and retry semantics

| Owner response | Device authentication caller | Possession caller |
|---|---|---|
| 403 | 403 `device_owner_mismatch` | 403 `device_possession_owner_mismatch` |
| 409 `device_revoked` | 409 `device_revoked` | 409 `device_possession_revoked` |
| 409 `nonce_already_used` | 409 `device_nonce_replayed` | Not a possession success |
| 401 `nonce_invalid_or_expired` | 401 `device_nonce_invalid` | Not a possession success |
| 409 `device_proof_replayed` | Not an authentication success | 409 `device_possession_replayed` |
| Redirect / network / 5xx | 503 `device_auth_unavailable` | 503 `device_possession_unavailable` |
| Other non-2xx, including unknown-device 404 | 401 `device_unauthorized` | 401 `device_possession_unauthorized` |
| Invalid success schema/user/device | 403 owner mismatch | 403 owner mismatch |
| Success digest from a different proof/context | N/A | 503 `device_possession_unavailable`, no authority start |

The client has no retry loop. A narrow existing replay acknowledgement helper
accepts 409 only against an exact previously expected digest; it never turns a
revoked response into success. Current routed calls do not supply that optional
expected-digest argument. Separate Worker cached-result logic requires the
stored subject/session/binding/challenge/Presentation/profile/digest context;
cached authoritative 200 is not the Bundle's required 409 replay observation.

## 3. Earlier owner API proposal and remaining policy approvals

No matching owner proof handler was found in the tracked Worker/WEB routes,
WEB page endpoints, AUTH crate or tracked Supabase function inventory.
The following investigation/proposal paragraphs describe the earlier baseline,
not the current absence of handlers. The exact-owner implementation above
supersedes proposal-only statements; unapproved transfer/enrollment and
cross-service revocation/recovery policy remains unresolved.

WEB mounts its lifecycle router under `/auth`; public page routing supplies the
`/api` prefix. Register, pending, devices, challenge, refresh, revoke and deletion
do not implement either proof contract. Deployment outside this source remains
`NOT_CHECKED`, not proof of absence.

Proposed responsibility is the WEB device-ownership service plus Supabase data
owner, coordinated with Worker/Session owners. An appointed individual/team,
enrollment policy and revocation semantics are **not approved by this document**.

| Contract decision | Reuse / required implementation / approval |
|---|---|
| Authentication | Independently validate the same non-anonymous Supabase issuer/project and bearer; compare its user ID directly with the stored canonical owner. No dataset-token or caller user-ID substitution. |
| Enrollment / ownership | Existing `register` can create an **anonymous canonical owner** via `ensureCanonicalUserForPublicId`; registration quota is not non-anonymous enrollment proof. Pending completion records dataset handoff, not device-owner transfer. An existing row may only be used when its owner really equals the authenticated subject. Linking/transfer/re-enrollment authority needs explicit human approval; no guessing from member ID. |
| Key registry | Reuse `user_devices` raw 32-byte Ed25519 key, algorithm, canonical owner and revocation fields. The UUID cutover migration, not the obsolete `pid` schema, is current. Do not insert a new key or reactivate a revoked row on proof calls. |
| WEB challenge | Reuse the existing HMAC helper/challenge API. It issues one deterministic device+300-second-bucket nonce, advertises bucket-end expiry, and currently accepts current or preceding bucket. Acceptance can extend beyond advertised expiry; this is not a new strict 300-second one-shot guarantee. Which policy applies to proof use must be approved and tested. |
| Auth nonce consumption | Reuse the durable `(device_id, nonce)` uniqueness mechanism, not KV-only checks. Current table is shared by register/refresh/revoke; purpose/cross-endpoint interference must be reviewed before expanding its use. Existing duplicate helper returns 401, whereas Worker proof expects 409: map deliberately in a future proof handler, do not rename refresh semantics. |
| TLSN challenge | Existing Binding Authority generates a random 32-byte challenge and owns session validity, device/user/binding matching and consumption. Worker TTL is explicitly 1..3600 seconds. Owner API proves possession over context bytes; it must not claim to have issued or authorized that session from caller fields. No duplicate challenge issuer is needed. |
| Proof replay | Record the canonical message digest durably and uniquely per device/context. Required lifetime must cover approved binding validity and permitted retrieval/replay policy, not an arbitrary cache TTL. An approved choice of existing-table extension versus a purpose-specific record is still required; none is created here. |
| Revocation | Unknown/unowned/wrong-owner/revoked devices fail closed. Check owner, key and revocation **before** replay classification, including cached-result cases. Define the linearization point and whether in-flight work is invalidated; current proof consumer alone cannot enforce cross-service revocation after success. |
| DB transaction | Owner/key/revocation recheck and unique consumption must commit atomically under the same device-row serialization as revocation. If signature verification occurs outside the transaction, recheck the identical key/owner snapshot under lock. A lookup followed by a separate insert is not that guarantee. |
| Cross-service failure | WEB nonce/proof commit, Worker DO issuance and receipt signing are not one transaction. If a later stage fails, do not unconsume/retry blindly. Define authenticated reconciliation or require a separately authorized fresh pre-send attempt. APP currently refuses rather than recovering automatically. |
| Signed receipts | Owner proof response itself is not signed. Reuse Worker Session and Binding signing interfaces/registries; no new signer or receipt authority is introduced. |
| Audit trail | Approved policy must retain correlation, canonical subject/device, proof/nonce digests, decision, revocation/key snapshot and time sufficiently to reconstruct consumption. Never log bearer, private keys or raw secret material; access/retention policy needs approval. |

### Existing DB constraints and required integration evidence

Existing current migration facts:

* [`user_devices` UUID cutover](../FUSOU-WEB/supabase/migrations/20260822120000_destructive_uuid_public_id_cutover.sql):
  UUIDv4 device/public IDs; canonical-user FK; raw key length 32; algorithm
  Ed25519; unique `(public_id, device_pubkey)`; authenticated SELECT with
  `auth.uid() = canonical_user_id`; privileged mutation.
* [Registration RPC](../FUSOU-WEB/supabase/migrations/20260822160000_anon_sync_device_quota.sql):
  mapping-row lock, existing canonical owner, no revoked-key resurrection,
  active-device quota 16, restricted service-role execution.
* [Nonce table](../FUSOU-WEB/supabase/migrations/20260522000000_anon_sync_nonce_consumptions.sql):
  lowercase-hex check, primary key `(device_id, nonce)`, RLS and service-role
  SELECT/INSERT/DELETE. It has no proof-purpose/context/revocation transaction
  guarantee merely because it exists.
* [Refresh-result storage](../FUSOU-WEB/supabase/migrations/20260824180000_anon_sync_nonce_refresh_results.sql)
  supports identical refresh recovery, not Worker Session issuance or TLSN
  proof authorization.

Future approved integration tests must exercise the actual service and DB:
non-anonymous same-owner success; anonymous/wrong issuer/expired bearer refusal;
unknown/wrong-owner/revoked/changed-key refusal; exact Ed25519 framing and
signature/context mutations; challenge boundary windows; concurrent duplicate
consumption; revoke-versus-proof serialization; cross-endpoint nonce use;
proof replay retention; rollback/DB outage; DO/signing failure after DB commit;
status/reconciliation without a second origin send. Unit fake HTTP responses
below do **not** implement or prove those server/DB behaviors.

## 4. Nineteen-role data lineage

`IMPLEMENTED_AND_CONNECTED` describes an actual source caller/writer/finalizer
connection, conditional on its preceding gates; it does not mean real artifacts
were acquired. Other statuses use the requested vocabulary. Every role retains
descriptor length/SHA-256 and provenance checking. Final output location is
`artifacts/<role>.bin`; runtime candidate filenames below are input artifacts,
not new manifest roles.

Status vocabulary: `IMPLEMENTED_AND_CONNECTED`, `IMPLEMENTED_BUT_NOT_CONNECTED`,
`EXTERNAL_INPUT_REQUIRED`, `OWNER_API_MISSING`, `HUMAN_APPROVAL_REQUIRED`,
`NOT_IMPLEMENTED`, and `UNKNOWN` (insufficient source evidence to decide).

| Role | Producer | Generation event | Storage | Collector | Binding | Independent verification | Status |
|---|---|---|---|---|---|---|---|
| `presentation` | Actual APP prover | Deferred real proof completes | Candidate `presentation.bin`; Worker raw archive | APP writer -> finalizer override | Exact bytes/hash/length, transcript/Notary identity | Actual Presentation cryptography + Web PKI/observed DNS | IMPLEMENTED_AND_CONNECTED |
| `result` | Worker verifier/signer | Presentation verification/signing; response released after authority commit | APP compact `result.json`; raw **outer** response separately | APP admission -> finalizer override | Inner V2/V3 signature, Presentation hash, Inventory/Approval pair | Canonical parse/signature, registry root, independently re-derived Result | IMPLEMENTED_AND_CONNECTED |
| `result_registry` | Approved registry publisher | Manifest independently verified | Candidate `runtime-result-registry.json`, exact raw input | APP verified manifest -> signer capture -> operator material descriptor | Candidate length/hash; envelope authorizes exact registry hash | Independent root envelope + signer resolution; no candidate-root default | IMPLEMENTED_AND_CONNECTED |
| `result_registry_envelope` | Approved independent registry-root signer | Manifest and envelope independently verified | Candidate `runtime-result-registry-envelope.json` | APP verified manifest -> signer capture -> operator material descriptor | Exact registry digest, root ID/SPKI, schema/domain/signature | Independent evidence-root pin, not a candidate-provided root | IMPLEMENTED_AND_CONNECTED |
| `notary_registry` | Approved Notary publication owner | Key publication | Approved external raw file | Explicit material and external CLI input | Byte equality, key ID/serialized key, Presentation | Pinned registry and actual Notary signature | EXTERNAL_INPUT_REQUIRED |
| `health` | Worker `/health` | Actual health observation for this approved service/version | Response not automatically saved as full role; APP metadata keeps a reduced unsigned observation | Existing APP observer is not connected to complete-role material collection | Result/root/Notary/Session/Binding identities and registry hashes | Cross-check against independent pins and verified Result; not a signed receipt | IMPLEMENTED_BUT_NOT_CONNECTED |
| `session` | Worker Session Authority + DO | Authenticated owner proof accepted, binding issued | APP `session.json` | APP verified binding state -> writer -> finalizer override | Signed user/device/auth nonce/session/binding/challenge/times | External Session registry/key and receipt signature/context | IMPLEMENTED_AND_CONNECTED |
| `authenticated_user` | Supabase authenticated-user service | Actual non-anonymous bearer validation | Worker observation is not saved as this role | No approved observation-to-material handoff | Externally pinned canonical user equals signed session/Result | Existing verifier checks external pin and signed graph; boolean alone is not independent authority | IMPLEMENTED_BUT_NOT_CONNECTED |
| `device_identity` | WEB `user_devices` owner service | Approved owner/key/non-revoked observation | DB row; APP local identity explicitly UNVERIFIED | No approved owner observation/export for Bundle | Canonical owner/device, raw key hash, non-revoked state, session/Result | Independent device/user/key pins and proof/receipts | HUMAN_APPROVAL_REQUIRED |
| `device_authentication` | WEB exact-owner proof API plus Worker session observation | Nonce signature accepted and HTTP 201 session issued | APP `device-authentication.json`; private DB proof audit; external role material still required | Matching handler/DB/consumer connected; complete external role collector still missing; finalizer compares external request with candidate | Nonce/device signature, exact captured request, Session receipt | Device signature and signed session/context; local acceptance JSON is not service proof | IMPLEMENTED_BUT_NOT_CONNECTED |
| `possession_proof` | Registered device via APP | Current session/binding/device challenge available | APP `possession-proof.json` | APP writer -> finalizer override | Framed signature and both digest encodings | Pinned device key, current Result/session/challenge | IMPLEMENTED_AND_CONNECTED |
| `consume_receipt` | Worker Binding Authority | Successful verified binding consumption | APP `consume-receipt.json`; outer response | APP writer -> finalizer override | Signed user/device/session/binding/nonce/Presentation hash/use time | External Binding registry/key, signature and context | IMPLEMENTED_AND_CONNECTED |
| `replay` | Approved negative-observation collector, not implemented | Actual same-proof/context rejection | Required external role not produced by APP polling | No approved actual 409 acquisition/assembly path | Expected 409/error, current context and stored message digest | Canonical proof digests, session/device/binding and allowed rejection | NOT_IMPLEMENTED |
| `session_authority_registry` | Approved Session authority key publisher | Key publication/rotation | Explicit raw file, not just health key fields | Operator material + independent CLI input | Byte equality and historical signer validity | Independently pinned key/registry and Session signature | EXTERNAL_INPUT_REQUIRED |
| `binding_authority_registry` | Approved Binding authority key publisher | Key publication/rotation | Explicit raw file | Operator material + independent CLI input | Byte equality and historical signer validity | Independently pinned key/registry and consume signature | EXTERNAL_INPUT_REQUIRED |
| `capture_metadata` | Real capture mapper | Actual capture start/finish and HTTP profile observations | APP `metadata.json` is a different schema | Partial source observation exists; complete role mapping not wired | Presentation digest, production/non-synthetic flags, fixed request/response profile/times | Existing metadata predicates and graph checks | IMPLEMENTED_BUT_NOT_CONNECTED |
| `semantic_verification` | Independent actual-Presentation analysis writer not established | After real cryptographic/semantic derivation | Required external material not produced here | Rust re-derives/checks semantics but does not publish this input report | Exact Presentation size/hash, unsigned Result, disclosed ranges/member/Notary/profile | Re-derived authenticated transcript/Result and mandatory predicates | NOT_IMPLEMENTED |
| `trust_root` | Independently approved Web PKI anchor owner | Trust-set approval | Explicit DER file, also supplied independently | Operator material + trust-anchor CLI option | Exact DER byte equality and actual TLS chain | TLSN Presentation server-certificate verifier | EXTERNAL_INPUT_REQUIRED |
| `subject` | Verified capture/evidence-context writer not established | Derive current signed subject context | Required external material not assembled | No connected production writer | User/device/session/member/binding hashes match signed Result | Existing subject and trust-graph cross-checks | NOT_IMPLEMENTED |

The independent verifier's 19-role requirement is now one private constant and
one inventory check. A regression removes **each of the 19 roles** and requires
the exact missing-role error. This inventory test is not a proof-verification
success or a material generator.

### Auxiliary inputs and collector boundaries

* Raw Origin Inventory and Target Approval are **independent CLI inputs**, not
  additional roles. Production Result requires both digest fields, exact raw
  hashes and the identity actually observed from Presentation. Configured
  candidate identity cannot supply that authority.
* External user/device/public-key pins, Result root ID/SPKI, Notary and authority
  registries/key IDs/SPKIs, Web PKI DER, profile digests and verifier key ID must
  all come from approved independent sources. Runtime Config trust is not
  automatically the Result-registry evidence root.
* APP supplies five override roles; the other fourteen descriptors/bytes and
  full manifest/evidence predicates must already exist in approved material.
  Candidate device identity, reduced health metadata, local delivery status or
  semantic assertions cannot be copied into an authoritative role.
* A new, connected **partial collector** retains seven verified public inputs:
  signed Runtime Config envelope, Worker reference, Origin Inventory, Target
  Approval, security registry set, exact Result registry and its signed envelope.
  `VerifiedRuntimeConfigManifest` retains bytes only after all existing independent
  checks; `wrap_proxy` passes an immutable snapshot to the actual Result writer.
  Candidate capture writes the seven `runtime-*.json` files before publishing
  its manifest, including each exact byte length/hash. No reserialization,
  new endpoint, secret export or nineteenth-role replacement is used.
  Capture accepts only those seven names, nonempty files and a 16 MiB aggregate
  snapshot bound. The finalizer still has **five**, not six, APP overrides:
  external authentication is not replaced with the same local file it checks.
  Operators can collect the two registry roles and Inventory/Approval from these
  snapshots, but independent CLI trust pins and byte equality remain mandatory.
  These files are not a complete Bundle or an execution/delivery receipt.
* No duplicate role reuse is implemented: candidate `metadata.json` is not
  `capture_metadata`; APP `device-identity.json` is not authoritative
  `device_identity`; Worker archived outer JSON is not inner `result`.
* Worker archive currently contains raw Presentation, exact outer response and
  authority catalog/generation context, not all nineteen materials. Status
  retrieval preserves authoritative bytes, not a complete Bundle.
* Existing [release collector](../../scripts/release-evidence-producer.mjs)
  requires approved main/workflow identity and archive grants; it collects
  raw readback and remains formally gated. It is not an APP candidate collector.
  [Local delivery policy](../../scripts/evidence-delivery-policy.mjs) consumes
  a trusted verifier interface, not a real missing-material producer.
* No new collector is implemented against an unapproved endpoint. Local file
  acquisition and finalization already exist. Actual owner observations,
  replay evidence, complete metadata/semantic/subject assembly and coordinated
  snapshot provenance still need an approved, connected collection contract.

## 5. Receipt guarantees must remain distinct

| Material | Issuer / signer | Binding and limit |
|---|---|---|
| TLSN Notary signature | Approved Notary key | Attestation/Presentation and authenticated TLS evidence; not APP process authority or device enrollment |
| Session receipt | Worker Session Authority signing API + independent registry | User/device/auth nonce/session/binding/challenge/create/expiry; domain `FUSOU-ATTESTATION-SESSION-V1\0` |
| Consume receipt | Worker Binding Authority signing API + independent registry | User/device/session/nonce/binding/exact Presentation digest/use time; domain `FUSOU-ATTESTATION-CONSUME-V1\0` |
| Canary execution receipt | Injected Canary signer capability; independent approval still required | Exact Presentation and **outer** Result digests, job/attempt, deployment/version, key identity and time; Canary-only domain/scope |
| APP local status / file receipt | APP local writer | Local observation/IO, not independent authority or remote retention |
| Full-Bundle delivery/retention receipt | Approved storage/delivery authority, not implemented | Must authenticate entire Bundle identity, exact objects/versions/hash/length, readback/retention/time/policy and receipt signer/replay context |

[Canary receipt code](../FUSOU-TLSN-VERIFICATION-WORKER/src/verifier_identity.ts)
uses scope `tlsn-canary-verifier-execution-receipt` and domain
`FUSOU-TLSN-CANARY-VERIFIER-EXECUTION-V1\0`. Receipt ID alone does not provide
durable replay prevention. Target/profile/subject are not direct receipt fields;
any indirect claim depends on separately verified Result binding. This is not
measured execution, process/image attestation or AD-5 authority.

No approved Production signer/registry, Production receipt schema, independent
offline receipt verifier or complete operation/profile/replay contract was
identified. Do not relabel Canary receipts or infer them from local status.
Neither the bare TLSN Presentation verifier nor the existing nineteen-role
schema has an execution-receipt input. Formal Production execution assurance
is a separate approval/implementation obligation. Nevertheless, **current
candidate writer/finalizer require captured receipt bytes and retain that
requirement by the user's decision**. This implementation dependency still
blocks the present B finalization route; it is not misrepresented as TLSN's
intrinsic cryptographic requirement.

## 6. Local publication, remote delivery and lifecycle limits

The finalizer still checks candidate schema/provenance/completeness,
descriptor/top-level digests, exact outer/inner/consume/replay consistency and
receipt header bytes; it then runs the full existing verifier before creating
output. All nineteen roles, authority byte equality and target approval remain
mandatory. Local writes are private/create-only, synced and read back; manifest
publication is last and create-if-absent. Relative output parent sync is
covered. Failed new-output cleanup is an explicit error; existing output is
never removed or reused. A retained directory after cleanup failure is not a
successful completion or remote-retention claim.

Full-Bundle remote upload/retention and independent delivery-receipt verification
remain `NOT_IMPLEMENTED`. The existing raw-object archive readback and local
verification report are not substitutes. C needs approved transport identity,
object/version retention semantics, authenticated receipts and explicit
partial-failure/reconciliation policy without duplicate origin requests.

The explicit exchange timeout, separate cleanup timeout and maximum Notary
bytes remain mandatory/default-free. The absolute exchange deadline starts
after a prepared binding is claimed and covers origin exchange and proof/
Worker/Result work; background Runtime Config, health and Session/Binding
prewarm occur before it and use their own bounded calls/retry schedule. Cleanup
has its separate wait budget, and late Result admission uses the current
exchange; cancellation cannot promote partial output to success.

The default Hudsucker path selects only a single bounded Content-Length no
greater than the 128 KiB TLSN sent-data ceiling; the complete serialized
request has the same 128 KiB ceiling. Its ingress collector adds a 1 MiB body
cap, 10-second idle timeout, 30-second completion timeout and eight-slot
reservation. These TLSN-specific checks do not apply to non-target or not-ready
requests sent through the ordinary proxy. Capture-unavailable, unsupported-body
and admission-busy requests fall through before body collection. A selected
body read/timeout/limit failure after collection begins is fail-closed and is
not retried upstream because the body may have been consumed. This local
ingress reservation is not a proof/archive lease or a process-wide memory
bound. Pre-send rejection may send zero origin requests;
normal completion is one logical operation; ambiguous writes are never retried
and Game Server receipt can be `UNKNOWN`. Worker-only polling/cached lookup is
not another origin send, but also not an automatic replay-evidence collector
or remote cancellation.

## 7. Human decisions and external inputs

Every owner below is a required responsibility, not an appointed person.
Names/approval records are `HUMAN_APPROVAL_REQUIRED`; request no secrets.

| Decision / input | Required approver | Configuration / independent confirmation |
|---|---|---|
| Two proof APIs and service owner | WEB identity/security + Supabase data owner + Worker owner | Approve exact method/schema/issuer/error/transaction contracts; service/DB integration tests and version/deployment evidence |
| Enrollment/ownership/revocation and in-flight semantics | Identity/security and account/data owner | Approved non-anonymous canonical ownership, no implicit transfer; revoke/proof/duplicate races tested |
| Session/Binding signers and registries | Authority/security and key-publication owners | Public key IDs/SPKIs, exact registry bytes and validity; signed receipt/context rejection tests |
| Production execution receipt | Evidence/security/release owners | Define required assurance/stage, approved signer/registry/domain/context and independent verifier; existing candidate gate remains unchanged meanwhile |
| Bootstrap/manifest/signer pins | APP release + Runtime Config publication owners | Public approved tuple, independent root, fresh epoch/raw artifact hashes; actual APP and Worker agreement |
| Canonical target and Inventory/Approval | Deployment/game-target approval owner | Actual lowercase DNS hostname and approved raw documents; later observed Presentation identity comparison |
| Worker/Notary/Session deployments | Respective service operators | Approved endpoints/build versions/public keys and controlled connectivity checks, not mock health |
| Real material collector | Evidence + auth/authority/capture owners | Approved real observations, coordinated context, all nineteen descriptors and independent inputs; no copied fixture flags |
| Full-Bundle remote delivery/retention | Storage/security/release operators | Approved uploader, authenticated whole-Bundle receipts, retention/readback/reconciliation tests; C only |
| Real testplay scope and stop conditions | Human protocol/release authority + operator | Resolve source/fork/profile/license decisions, approved limits and explicit capture permission; A does not certify B/C |

Direct blockers: A cannot use the current APP/Worker route without the proof
services, and no separate approved A entry is implemented. B additionally lacks
the real-material handoff and still requires the retained receipt. C additionally
lacks full-Bundle transport/retention and formal execution/delivery approval.
External trust/configuration/services and explicit human gameplay permission
remain necessary in all applicable stages.

## 8. Earlier investigation validation record (historical)

Earlier commands/results are recorded separately from the preceding
[finalization audit](FIRST-TESTPLAY-READINESS.md#current-finalization-audit-validation).
No actual APP launch, key generation, owner API/DB integration, Game Server/
Notary access, real evidence acquisition/cryptographic verification, remote
archive operation or deployment is part of these tests.

| Suite / check | Current result |
|---|---|
| Worker proof HTTP client / exact framing | 28 PASS, 0 FAIL/SKIP; fake HTTP responses only, not owner handler/signature/DB integration |
| APP three-stage assessment | 3 PASS, 0 FAIL/SKIP |
| Existing APP pre-capture and launcher helpers | 34 PASS, 0 FAIL/SKIP; no actual launcher execution |
| Existing local delivery policy / archive catalog | 5 + 41 PASS, 0 FAIL/SKIP; not whole-Bundle remote delivery or retention |
| Rust finalizer | 14 PASS, 0 FAIL/ignored; retained receipt gate, partial output, IO and correlation |
| Rust Bundle verifier | 25 PASS, 0 FAIL/ignored; includes each missing mandatory role and existing fixed signature/receipt/registry/context mutations |
| Rust verifier CLI | 5 PASS, 0 FAIL/ignored; no actual evidence CLI execution |
| Rust actual APP library gates | 55 PASS, 0 FAIL, 1 pre-existing ignored external-roundtrip test |
| Rust Proxy selected lifecycle/production/ingress/framing | 50 PASS, 0 FAIL/ignored |
| Actual APP GNU `tlsn-production` library/binary check | PASS, exit 0; existing warnings, not packaging or GUI launch |
| Worker strict existing TypeScript check | PASS, exit 0 |
| Finalizer module edition-2021 formatter check / five changed JS syntax checks | PASS, exit 0 |
| Required-document local links / lineage shape | 120 targets exist; exactly the same 19 ordered roles as Rust, eight columns per role and allowed status values, exit 0 |

Totals excluding repeated invocations: **Rust 149 PASS / 0 FAIL / 1 existing
ignored**, **Node 111 PASS / 0 FAIL/SKIP**. Successful commands exited 0.
No new skip was added. These unit/fixture assertions do not prove external
revocation/enrollment, DB transactions, a valid real finalized Bundle or receipt
authority. Delivery-receipt signature verification cannot be claimed while its
approved production contract/implementation is missing.

The same isolated offline runner/cache preparation from the preceding task
was reused; new command logs are under `device-proof-lineage-gate`.
It selects the actual package working directory, uses Rust 1.98.1 GNU,
`env -i`, private HOME/CARGO_HOME/TMPDIR and separate targets with existing
offline caches. No manifest/lock/dependency change or download was needed.

```sh
ROOT=/home/ogu-h/Documents/GitHub/FUSOU
GATE=/home/ogu-h/.copilot/session-state/641fd5f4-19dd-4ad5-a248-79cd863d59da/files/evidence-finalization-gate
sh "$GATE/run-cargo.sh" app check --features tlsn-production --locked --offline --lib --bins
sh "$GATE/run-cargo.sh" app test --features tlsn-production --locked --offline --lib -- tlsn_preflight::tests tlsn_runtime_config_manifest::tests tlsn_runtime_config_runtime::tests wrap_proxy::runtime_config_transport_gate_tests
sh "$GATE/run-cargo.sh" verifier test --locked --offline --lib -- evidence_bundle::finalization::tests evidence_bundle::tests
sh "$GATE/run-cargo.sh" verifier test --locked --offline --bin verify_fusou_tlsn_evidence
sh "$GATE/run-cargo.sh" proxy test --locked --offline --features alpha15-tlsn --lib -- exchange_lifecycle::tests experimental_tlsn::tests request_ingress::tests production_tlsn::tests real_tlsn::tests::tlsn_device_proof_frames_challenge_with_length
cd "$ROOT"
node --experimental-strip-types --test packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/device-proof-client.test.mjs packages/FUSOU-APP/scripts/testplay-acceptance-stages.test.mjs packages/FUSOU-APP/scripts/testplay-pre-capture-readiness.test.mjs packages/FUSOU-APP/scripts/testplay-verify.test.mjs scripts/evidence-delivery-policy.test.mjs scripts/release-archive-catalog.test.mjs
cd "$ROOT/packages/FUSOU-TLSN-VERIFICATION-WORKER"
npm run typecheck -- --pretty false
cd "$ROOT"
/home/ogu-h/.rustup/toolchains/1.98.1-x86_64-unknown-linux-gnu/bin/rustfmt --check --edition 2021 packages/FUSOU-TLSN-VERIFIER/src/evidence_bundle/finalization.rs
node --check packages/FUSOU-APP/scripts/testplay-acceptance-stages.mjs
node --check packages/FUSOU-APP/scripts/testplay-pre-capture-readiness.mjs
node --check packages/FUSOU-APP/scripts/testplay-acceptance-stages.test.mjs
node --check packages/FUSOU-APP/scripts/testplay-pre-capture-readiness.test.mjs
node --check packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/device-proof-client.test.mjs
```

Non-successful/intermediate commands were not hidden:

* Two first invocations accidentally used APP as cwd: Node could not locate the
  root-relative test paths, and APP has no `typecheck` npm script (both exit 1).
  They ran no intended suites. The correctly scoped commands above passed.
* Initial combined verifier run: 38 PASS / 1 FAIL, exit 101. The new
  missing-receipt test called a fixture helper which indexed the deleted map
  entry. Only that new test setup was corrected: it removes the descriptor while
  retaining the captured flags and top-level digest, then requires actual
  missing-byte refusal and no output. No production gate/assertion was weakened.
  Final combined run: 39 PASS / 0 FAIL, exit 0.
* The earlier task's opt-in synthetic-feature compile issue is historical, not
  rerun or reported as a PASS here. Actual APP/Proxy feature validation above
  is distinct from that optional test harness.

## Nonblocking capture and origin-send journal follow-up

The local follow-up keeps the nineteen-role schema, producer/collector
assignments and finalizer gates unchanged. It changes only how the APP decides
whether a request is eligible to enter that existing capture pipeline:

* The ordinary Proxy listener starts before Runtime Config refresh, preflight,
  Worker health and TLSN dependency construction run in a background task.
  The forwarder is installed only after those checks pass. Initialization
  failure leaves capture unavailable rather than stopping ordinary proxying.
* Capture is per-request, not a listener-global one-shot. A matching request
  is captured only when a prepared binding, one-request admission and selected
  TLSN ingress capacity are available. Otherwise, its untouched body follows
  the ordinary proxy path. A selected body read failure after consumption is
  fail-closed and never triggers a retry.
* Production APP wiring opens an append-only, private JSONL send journal under
  the APP roaming directory. It durably records the SHA-256 of the authority
  binding as the local attempt key, canonical target and serialized request
  digest before origin transport I/O; no binding value or raw request body is
  stored. On startup, an unfinished `send_started` entry is durably finalized
  as `unknown`, and its attempt key cannot be reused. `response_received`
  persistence is asynchronous after the browser response, so a crash before
  that update is conservatively recovered as `unknown`.
* This journal is local crash/replay protection, not an authority-issued
  logical-operation reservation. The existing Worker Binding Authority
  durably owns per-binding state, but its contract does not bind a stable Game
  Server operation ID, request digest or origin-send intent. A retry of the
  same logical game operation with a newly issued binding is not identifiable
  from the current contract; no endpoint or ownership policy was invented.

| Follow-up check | Result | Evidence boundary |
|---|---|---|
| Default Proxy library suite | 122 PASS, 0 FAIL, exit 0 | Local Rust tests only. |
| `rama-experimental` Proxy library suite | 155 PASS, 0 FAIL, exit 0 | Includes Rama route fallback and HTTP/1 loopback tests, not real-game evidence. |
| APP `tlsn-production` library/binary check | PASS, exit 0 | Type checking only; existing warnings remain, no GUI/package launch. |
| APP `runtime_config_transport_gate_tests` with `tlsn-production` | 7 PASS, 0 FAIL, exit 0 | Local fake revalidation/binding/origin tests; not APP launch or live services. |

No Worker/Durable Object test, actual service request, real Presentation,
archive operation, APP GUI launch or gameplay was performed in this follow-up.
The three testplay stages therefore retain their prior blocked/external-input
states.
