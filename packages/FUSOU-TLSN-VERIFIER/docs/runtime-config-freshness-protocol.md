# Runtime Config Freshness Protocol — Phase 0 Design

- **Status:** Design proposal only; not approved or implemented
- **Updated:** 2026-11-01
- **Runtime-code basis:** `43ab72e6284deee3ad202be7fb50e3f0199af304`
- **Readiness record:** [FIRST-TESTPLAY-READINESS.md](../FIRST-TESTPLAY-READINESS.md)

This document designs protection against replaying an older, still-valid
Runtime Config Manifest to an APP with no persisted epoch. It does not change
Manifest v2, create or register a key, publish a Worker, write R2, or authorize
a testplay. Phases 1–6 below are a roadmap, not work started.

## 1. Decision summary

The current APP can reject an epoch below its locally persisted high-water
mark, but a first-install APP starts at epoch `0`. It can therefore accept any
otherwise-valid signed Manifest served during its time window. `no-store`,
publisher CAS, and ordinary endpoint freshness do not give that new client a
cryptographic proof that the served Manifest is the latest one.

**Option C is the only compared option that can give the APP a nonce-bound,
signature-verified latest-pointer assertion without adding a separate trust
root.** It remains blocked until its signer and pointer authority are approved.
The literal design has the existing Bootstrap-pinned signer sign a narrowly
typed response. This makes that signing key an online availability and
security dependency. It must not be exposed as a general signing API or
Worker binding. If a reviewed signer service cannot enforce the typed
operation, do not deploy Option C; keep freshness blocked rather than silently
falling back to A or B.

The response means “this was the latest committed Manifest observed at
`issued_at`,” not “no higher epoch can be committed after the response.” A
release racing after the read is a bounded time-of-check/time-of-use window.
The proposed short response lifetime limits that window; eliminating it
entirely would require publication/issuance serialization and a separate
availability decision.

## 2. Current protocol and source-confirmed boundary

| Component | Current behavior | Security boundary |
|---|---|---|
| APP Bootstrap | Three `option_env!` values pin the Manifest HTTPS URL, signer key ID, and signer SPKI. The URL is restricted to the canonical `/tlsn/runtime-config/v2/manifest.json` path. All three absent means unregistered; partial configuration rejects. See [Bootstrap and URL validation](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_manifest.rs#L156) and [URL validation](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_manifest.rs#L606). | The embedded public key is a trust anchor for local Manifest verification, not APP integrity or Worker authority. A local owner can alter the APP and its local state. |
| APP fetch and verify | APP fetches the exact Manifest object and its referenced artifacts; it rejects noncanonical envelopes/payloads, signer mismatch, invalid signature, invalid time window, stale Worker reference, and artifact digest mismatch. The Manager persists an epoch only after verification. See [`fetch_and_verify_with_fetcher`](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_manifest.rs#L483), [`verify_signed_runtime_config_manifest`](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_manifest.rs#L706), and [`RuntimeConfigManager::refresh_with_fetcher_at`](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_runtime.rs#L58). | Full content authenticity is verified, but a valid older Manifest is still valid content. These checks do not prove it is latest to a new client. |
| Manifest signature | Manifest v2 uses Ed25519 and a dedicated `FUSOU-TLSN-RUNTIME-CONFIG-MANIFEST-V2\0` domain. Signing bytes are domain, 16-bit big-endian key-ID length, ASCII key ID, and canonical payload bytes. JS and Rust implement the same shape. See [Worker signing bytes](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-manifest.mjs#L404) and [APP signature message](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_manifest.rs#L1940). | A new response must use a separate domain and scope; it must not reuse Manifest signing bytes or weaken Manifest verification. |
| APP local high-water | A missing state file produces epoch `0`; the accepted epoch and exact Manifest digest are then persisted atomically with restrictive local permissions. See [state read and initial state](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_runtime.rs#L115), [accept](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_runtime.rs#L171), and [initial state](../../FUSOU-APP/src-tauri/src/tlsn_runtime_config_runtime.rs#L247). | Useful against accidental rollback while state survives. It is not server-side authority and can be reset by a hostile local owner. |
| Time checks | APP allows at most 3,600 seconds of Manifest lifetime, 30 seconds of clock skew, and 600 seconds of Worker-reference age. | Expiry bounds replay duration; it does not prevent replay inside the valid interval. |
| Publisher | Release code validates the current signed Manifest, compares its epoch/digest to the supplied release policy, rejects missing pointer with a nonzero policy high-water, writes immutable artifacts, uses conditional pointer CAS, and verifies readback. Ambiguous writes are reconciled without automatic retry. See [`publishTlsnRuntimeConfigWithMode`](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-release.mjs#L178) and [R2 pointer CAS](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-r2-store.mjs#L415). | CAS serializes competing writes; it does not give a new APP a signed statement of the publisher's current high-water. The policy high-water is an input to the publisher, not a registered independent recovery authority. |
| R2 objects | Mutable pointer object: `tlsn/runtime-config/v2/manifest.json`; immutable content-addressed artifacts: `tlsn/runtime-config/v2/artifacts/<kind>/<sha256>`. The Manifest object uses `Cache-Control: no-store`; artifacts use long-lived immutable cache metadata. See [publication objects](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-manifest.mjs#L722). | The mutable pointer is itself the signed Manifest envelope; there is no separate signed pointer object. The current publisher does not create an immutable Manifest snapshot. Recovery therefore needs an external exact-byte copy or a future snapshot/ledger design. |
| Registration / endpoint | Publisher readiness marks the Production signer provider, APP root, Manifest endpoint, and recovery authority unregistered; Production publish is blocked. No Runtime Config freshness route was found in Worker runtime source. See [registration](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-production-registration.mjs) and [publisher readiness](../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-publisher-readiness.mjs). | There is no current online freshness signer or endpoint to rely on. Do not infer one from a successful Worker build. |
| Worker trust | The Worker independently validates Presentation identity, Inventory, Target Approval, and Result Registry trust. | APP freshness proof is only an APP configuration-readiness input; it must never become Worker evidence authority. |

R2 documents strong global consistency for object reads/writes and atomic
`If-Match` / `If-None-Match` conditional `PutObject`. The same documentation
warns that serving a custom R2 domain with caching relaxes the consistency
observed through that cached domain. A freshness endpoint must read the R2
object directly (binding or S3 API), not treat a CDN response as authoritative.
Strong consistency prevents stale R2 reads after a completed write; it does not
make an HTTP cache or an endpoint's own stale state cryptographic evidence.
See Cloudflare's [R2 consistency model](https://developers.cloudflare.com/r2/reference/consistency/)
and [S3 conditional operations](https://developers.cloudflare.com/r2/api/s3/extensions/#conditional-operations-in-putobject).

## 3. Threat model

### Protected properties

1. A new APP must not accept a lower epoch merely because its local high-water
   starts at zero.
2. The latest assertion must bind to the exact raw signed Manifest envelope,
   not an APP-supplied digest or parsed/re-serialized JSON.
3. A captured signed freshness response must not be reusable for a new APP
   request, another environment, another Manifest URL, or another nonce.
4. Existing Manifest v2 signature, schema, time, independent artifact, and
   digest checks remain mandatory.
5. Worker-side Origin Inventory, Target Approval, Notary, and Result Registry
   trust remains independent of APP claims.
6. Freshness service failure must disable TLSN capture/readiness only; it must
   not stop ordinary APP-to-Game-Server proxy communication.

### Adversary and limits

The design assumes an attacker may replay an older signed Manifest through a
network path, cache, or endpoint; may race publication; and may cause a
service outage. It does not protect a user who can replace their APP and its
embedded pin, nor does it make that APP trustworthy to the Worker. It also
cannot protect against compromise of the Bootstrap signing authority or the
authoritative release ledger. Those remain explicit trust assumptions.

Current expiry (maximum one hour) and Worker-reference freshness (maximum ten
minutes) bound some stale data but leave a window for a valid old Manifest.
The `no-store` metadata is operational cache control, not a cryptographic
freshness proof.

## 4. Option comparison

| Option | Security against fresh-client replay | Availability | Operational cost | Added trust assumption |
|---|---|---|---|---|
| **A. Cache policy and endpoint freshness** | Helpful against accidental caching only. `no-store`, CDN bypass, and fetching the current pointer reduce stale responses. A misconfigured/compromised endpoint can still serve an old signed Manifest; a new APP cannot prove it is latest. | Highest; uses the existing GET path and does not require an online signing service. | Low to moderate: cache rules, endpoint pointer reads, monitoring. | Trust that the HTTPS endpoint/CDN path is serving the current object. Not cryptographic. |
| **B. Endpoint as independent freshness authority** | Better only if the endpoint has a monotonic authoritative epoch and is authenticated. If its authority can roll back or is compromised, it can attest an old epoch. | Medium: the endpoint becomes required for fresh bootstrap; endpoint outage blocks new TLSN capture. | High: separate authority, durable state, service operation and recovery. | Adds trust in endpoint operator/runtime and its server-side state. If authenticated only by HTTPS, adds reliance on Web PKI and the endpoint domain/control plane; if pinned by a new key, adds a new root. |
| **C. Bootstrap-signer nonce response** | Strongest of these without a separate root: a fresh nonce and signature bind the assertion to the existing pinned signer and exact Manifest digest. It does not prove the signer read the true latest pointer if the signer or its authority is compromised. | Lower than A: the signer and freshness endpoint must be reachable for a new TLSN capture. | High: online signer isolation, endpoint, high-water authority, key custody and recovery. | Trusts the existing Bootstrap signer to assert the latest committed epoch. It makes that authority an online availability/security dependency. |

**Recommendation:** use Option C only after approval of the online signer
boundary and durable high-water/recovery authority. Option A is a useful
defense-in-depth measure, not a fix. Option B adds another authority and does
not improve on C unless its independent monotonic state and compromise model
are explicitly accepted.

The currently registered signer provider is `NOT_CONFIGURED`; Production
signing, Bootstrap root, endpoint, and recovery authority are
`NOT_REGISTERED`. The existing code supplies a release-time `signerProvider`
to the publisher; it does not establish that the private key is online or
available to a Worker. Do not move it into Worker bindings or assume a custody
model. The literal C design below requires a separate, human-approved signing
service. If the Bootstrap key must remain strictly offline, a future
root-authorized, purpose-limited child key could be considered, but that is a
new delegation contract and is not silently included in this proposal.

## 5. Option C protocol proposal

### 5.1 Flow

1. APP creates a fresh 32-byte cryptographic nonce and records it as the sole
   pending challenge for this refresh attempt.
2. APP sends a bounded `POST` to a proposed same-origin route,
   `/tlsn/runtime-config/v2/freshness`. The route is derived from the embedded
   Manifest URL; no fourth build-time endpoint or new trust root is proposed.
   The route does not redirect.
3. The endpoint accepts only the protocol version, scope, audience binding,
   and nonce. It does not accept a client-supplied epoch, Manifest digest,
   signer key ID, or arbitrary signing bytes.
4. The endpoint reads `tlsn/runtime-config/v2/manifest.json` directly from R2,
   bypassing CDN and Cache API. It verifies the exact signed Manifest envelope
   using the configured Bootstrap signer pin and checks that epoch and exact
   digest match the committed server-side high-water record.
5. Only after those checks does the typed signer operation sign the
   nonce-bound response. On a missing pointer, stale pointer, mismatch, invalid
   signature, unresolved CAS, pending publication, or unavailable high-water
   authority, it returns an error without a signature.
6. APP verifies the response envelope and signature using its embedded
   Bootstrap pin, then checks scope, version, environment, audience, pending
   nonce, times, epoch, and digest.
7. APP fetches the Manifest from its existing pinned URL. SHA-256 over the
   exact raw response bytes must equal the signed response digest. APP then
   performs all existing Manifest v2 checks, requires its payload epoch to
   equal the signed `latest_epoch`, and fetches/verifies every referenced
   artifact. Only after the complete existing verification succeeds does it
   persist the accepted epoch/digest.
8. The Worker does not consume an APP claim of “freshness verified” as trust.
   Its independent Presentation and Result verification remains unchanged.

The assertion is explicitly “latest committed state observed by the
authoritative endpoint at `issued_at`.” A newer publication may commit after
the pointer read and before APP acceptance. With a 60-second response
validity ceiling, that race is bounded, not eliminated. If product policy
requires linearizable “latest at APP acceptance,” publication and response
issuance must be serialized by the same authority; this is an unresolved
availability/design decision.

### 5.2 Message shape

Illustrative request (strict exact field set; no release authority values):

```json
{
  "schema_version": 1,
  "scope": "fusou-tlsn-runtime-config-freshness-request-v1",
  "audience_manifest_url_sha256": "<base64url-sha256-of-canonical-embedded-manifest-url>",
  "request_nonce": "<base64url-of-32-random-bytes>"
}
```

Illustrative response envelope:

```json
{
  "schema_version": 1,
  "scope": "fusou-tlsn-runtime-config-freshness-envelope-v1",
  "signature_algorithm": "Ed25519",
  "signer_key_id": "<pinned-bootstrap-key-id>",
  "payload_base64url": "<base64url-of-canonical-payload>",
  "signature_base64url": "<base64url-ed25519-signature>"
}
```

Illustrative signed payload:

```json
{
  "schema_version": 1,
  "scope": "fusou-tlsn-runtime-config-freshness-response-v1",
  "environment": "production",
  "audience_manifest_url_sha256": "<same-url-digest>",
  "request_nonce": "<exact-request-nonce>",
  "latest_epoch": "<canonical-unsigned-decimal>",
  "manifest_schema_version": 2,
  "manifest_sha256": "<base64url-sha256-of-exact-manifest-envelope-bytes>",
  "issued_at": "<canonical-UTC-timestamp>",
  "expires_at": "<canonical-UTC-timestamp>"
}
```

The fields have the following purpose:

| Field | Required reason |
|---|---|
| `schema_version` and `scope` | Reject downgrade, cross-protocol use and unknown protocol roles. Exact-key validation rejects extensions until a versioned change. |
| `environment` | Prevent Production/Canary response substitution. The Production APP accepts only `production`. |
| `audience_manifest_url_sha256` | Bind the response to the exact canonical embedded Manifest URL without accepting a server-selected URL. |
| `request_nonce` | Bind the response to this pending APP challenge; defeats cached or captured response replay to a fresh challenge. |
| `latest_epoch` | Provide the high-water value that must not be below the APP's persisted epoch. |
| `manifest_schema_version` | Make the expected Manifest version explicit; the digest also commits to it, but the explicit check makes version mismatch fail visibly. |
| `manifest_sha256` | Bind the assertion to SHA-256 of the exact raw signed Manifest envelope bytes. The APP must not hash reserialized JSON or only the payload. |
| `issued_at` / `expires_at` | Bound response replay and server clock claims. Proposed maximum validity is 60 seconds; acceptance uses the existing 30-second clock-skew policy unless a separately approved policy changes it. |
| Envelope `signer_key_id` | Select the pinned signer and bind its identity into the signature preimage, as the current Manifest contract does. |

There is currently no distinct signed pointer object: the R2
`manifest.json` object is the Manifest envelope. Therefore a separate
`pointer_sha256` would duplicate `manifest_sha256` in v1. If a separate pointer
format is introduced later, a new protocol version must bind both pointer
bytes and exact Manifest bytes.

### 5.3 Canonical bytes and signature

The new response must not reuse the Manifest v2 domain. The proposed v1
preimage is:

```text
ASCII("FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-RESPONSE-V1\0")
|| uint16_be(length(ASCII(signer_key_id)))
|| ASCII(signer_key_id)
|| canonical_json(payload)_utf8
```

This mirrors the existing domain-separated Manifest layout while using a
separate purpose string and strict response schema. Implementation must call
the existing JS/Rust canonical JSON helpers and add shared known-answer
vectors; it must not introduce a second ad-hoc JSON encoding. The payload is
canonical JSON, base64url without padding. The envelope is also canonical
JSON, has exact known fields, rejects unknown fields, and carries a 64-byte
Ed25519 signature. APP verifies the envelope's key ID against the embedded
Bootstrap key ID and uses the pinned SPKI. A new response scope/domain and
compatibility tests are required; current Manifest v2 signing bytes remain
unchanged.

### 5.4 Nonce and expiry rules

- Generate 32 bytes using the OS/runtime cryptographic RNG for every new
  refresh attempt. Do not use timestamps, `Math.random`, job IDs, or a
  persistent counter.
- Keep the nonce only in the pending in-memory refresh operation. Accept a
  response only when it exactly matches that pending nonce and consume the
  pending challenge once. After success, timeout, cancellation, or error, a
  later operation must use a new nonce.
- Retries after an ambiguous transport failure should start a new challenge.
  The endpoint need not maintain a global nonce database; APP pending-state
  and cryptographic uniqueness prevent cross-request replay. A duplicate HTTP
  request may produce the same response, but it cannot be accepted by a
  different or completed APP challenge.
- Reject malformed/noncanonical base64url, wrong nonce length, nonce mismatch,
  duplicate/consumed challenge, audience mismatch, and Production/Canary
  mismatch.
- Require canonical UTC time strings; reject a response issued more than the
  approved clock skew in the future, expired responses, and a validity interval
  longer than the approved ceiling (proposed 60 seconds).
- `latest_epoch` is canonical decimal and must be at least the APP's local
  epoch. If equal, `manifest_sha256` must equal the locally persisted digest.
- After fetching and fully verifying the Manifest, its payload epoch must
  exactly equal the response's `latest_epoch`.
- A response never makes an expired Manifest valid. The existing Manifest
  expiry and Worker-reference freshness checks still run independently.

### 5.5 Publisher, pointer authority, endpoint and signer responsibilities

**Publisher**

- Validates the candidate Manifest and all independent artifacts before
  publication, as today.
- Advances epoch strictly and serializes releases with conditional CAS.
- Writes exact immutable artifact bytes and an immutable Manifest snapshot
  before changing the mutable current pointer.
- Records a committed `(environment, epoch, exact_manifest_sha256,
  previous_epoch, previous_manifest_sha256, approval_id, signer_key_id)`
  in an independently protected monotonic release ledger.
- Does not lower the high-water mark to recover from a missing pointer.

**Freshness endpoint**

- Reads the mutable `manifest.json` directly from R2, not from a public
  custom-domain cache.
- Verifies the Manifest signature with the configured Bootstrap trust pin,
  and checks that the pointer bytes, epoch and digest exactly match the latest
  committed ledger record. It rejects a pending publication or any mismatch.
- Accepts only a bounded typed challenge; never accepts a caller-selected
  epoch, digest, key ID, Manifest URL, or raw message to sign.
- Is read-only with respect to the Manifest and release ledger. It cannot
  publish, roll back, change Inventory/Approval, alter Worker bindings, or
  create Result Registry trust.

**Signer**

- Exposes only a typed `signFreshnessResponse` operation after endpoint
  validation. No generic `sign(bytes)` HTTP API and no Worker proof route.
- The literal design requires the existing Bootstrap signer key online. Keep
  it in an approved HSM/signing service with access restricted to the
  freshness operation, rate limits, audit records, and two-person operational
  controls. The endpoint supplies validated typed fields; the signer or its
  policy reconstructs the fixed v1 preimage.
- The existing repository does not establish an online key custody
  implementation. If the signer cannot enforce this purpose-limited boundary,
  direct online use is not approved by this design.
- Any future delegated freshness key is a separate approved protocol
  extension rooted in the existing Bootstrap pin, not a new trust root
  silently introduced here.

**Worker**

- Does not accept the APP response as proof of Worker, Notary, Origin,
  Target Approval, or Result trust.
- Continues to derive server identity from the actual Presentation and
  independently verify its configured registries and approved target policy.
- Must not share its Result-signing or Notary authority with the freshness
  endpoint.

### 5.6 R2 high-water and pointer-loss recovery

Current behavior is intentionally fail-closed in some cases: publisher
publication rejects a missing pointer when the supplied epoch high-water is
nonzero, and the R2 adapter does not automatically retry ambiguous writes.
However, the current publisher readiness records the independent recovery
authority as `NOT_REGISTERED`. The `policy.last_accepted_epoch` is supplied to
the publisher; the inspected code does not establish a separate durable
online high-water authority. Also, current publication stores content-addressed
artifacts but only the Manifest at the mutable `manifest.json` key; it does
not persist an immutable Manifest snapshot. Thus the current R2 namespace
alone cannot reconstruct a lost Manifest pointer.

Proposed future release ledger and snapshots:

1. Store exact signed Manifest bytes at an immutable key such as
   `tlsn/runtime-config/v2/manifests/<manifest_sha256>` and verify readback.
2. Maintain an append-only/monotonic authority record independent of the
   mutable pointer. It records committed epoch and digest plus approval and
   prior-record linkage. A storage technology and its control-plane owner
   require human approval; do not assume eventual-consistency storage is
   sufficient.
3. Serialize publication states (`PREPARED`, `POINTER_COMMITTED`,
   `COMMITTED`). The endpoint signs only when the authoritative record is
   `COMMITTED` and the R2 pointer matches exactly. Any split-state, timeout,
   stale pointer, or unknown write outcome fails closed.
4. If the pointer is missing but the ledger and immutable snapshot agree on
   the latest committed `(epoch, digest)`, two authorized custodians may
   restore those exact bytes with conditional create. This is restoration of
   the same epoch and digest, not a rollback.
5. If the latest snapshot or ledger is missing, corrupt, or contradictory,
   freeze publication and freshness responses. Do not reset the epoch to zero
   or choose the highest-looking R2 object automatically.
6. If repair requires new bytes, issue a new Manifest at an epoch strictly
   above the last independently verified high-water. Correct a bad release
   forward; never republish different bytes at the same epoch.
7. If both online ledger and snapshots are lost, recovery requires an
   independently retained signed release log and explicit two-person
   approval: a Runtime Config Release Owner and a Bootstrap Trust/Key
   Custodian. If no trustworthy record survives, a new APP release with an
   approved Bootstrap trust change may be required. No such recovery
   authority is currently registered.

Signer revocation is also not a normal Runtime Config operation. The APP pins
one Bootstrap key at build time; a compromised root cannot be remotely revoked
for an old APP that only trusts that root. Recovery requires approved root
rotation and an APP release. A new Manifest epoch does not revoke a trusted
signing key.

R2 strong consistency does not remove the need for this recovery authority.
Cloudflare notes that a negative read does not prove an earlier in-flight
write failed. A freshness endpoint must treat missing pointer plus nonzero
ledger state, an unresolved write, or any mismatch as unavailable, never as a
new installation.

### 5.7 Outage and cache behavior

| Condition | APP/TLSN behavior | Ordinary Game Server communication |
|---|---|---|
| New APP, endpoint/signer unavailable | No verified latest assertion; TLSN capture and evidence readiness stay blocked. | Continues through the ordinary proxy path. |
| Existing APP update, endpoint unavailable | Keep local high-water unchanged; do not silently downgrade or treat cached data as freshly checked. Under the recommended strict policy, do not start a new TLSN capture until freshness succeeds. | Continues. |
| Existing Manifest still within expiry but no fresh response | It remains previously verified local data, not a current-latest assertion. Strict policy blocks new capture; any offline grace would need separate human approval and must be labeled stale/unverified. | Continues. |
| Only an expired Manifest is available | Reject it; no build-time operational fallback or expired-config grace. TLSN capture blocked. | Continues. |
| Worker reference is older than 600 seconds | Existing Manifest verification rejects it; publish a fresh approved Manifest/reference. Do not bypass the freshness check. | Continues. |
| Pointer missing, stale, invalid, or disagrees with ledger | Endpoint returns unavailable without a signature; no fallback to the last cached Manifest. | Continues. |
| Freshness endpoint outage | Mark Runtime Config freshness unavailable; do not disable ordinary proxying. | Continues. |
| Bootstrap signer unavailable | No response signature; TLSN capture blocked. | Continues. |

For both request and response, use HTTPS, `POST`, bounded bodies, and
`Cache-Control: no-store, private`; configure the CDN route to bypass caching
and disable Worker Cache API use for this endpoint. Do not place the nonce in
a GET URL or rely on it as a cache key. The Manifest object already has
`no-store`, but a CDN/custom-domain configuration can still alter observed
freshness; cache headers are not a security proof. A stale cached response
must fail the nonce check; a stale cached Manifest must fail the exact digest
check.

## 6. Compatibility and trust boundary

- Keep Runtime Config Manifest schema v2 and its existing signature bytes
  unchanged. Freshness is a separate v1 protocol with new scope/domain and
  cross-language vectors.
- The existing three APP Bootstrap inputs remain the only static locator/pin
  inputs for the direct-key proposal. Derive the freshness path from the
  canonical Manifest URL on the same origin. If deployment requires another
  host or key, stop for trust-model approval rather than adding an implicit
  fourth input.
- An APP that does not implement this protocol cannot claim fresh-client
  replay protection. Rollout requires an APP release containing the new
  verifier; old clients remain bounded only by expiry/local high-water.
- Worker Production/Canary bindings and Result Registry/Notary/Origin trust
  remain independent. No Worker may treat the APP's response as its trust
  root.
- The APP pin and its local epoch are modifiable by a hostile APP owner.
  This protocol reduces network/server replay under the stated signer and
  ledger assumptions; it does not prove APP binary, process, OS, Browser, or
  gameplay integrity.

## 7. Adversarial test plan

These are future tests, not tests run in this design task. No production R2
bucket or live service is to be used. R2 integration tests require an
explicitly disposable test bucket and separate approval.

| Test | Expected result | Test layer |
|---|---|---|
| Correct signed response, pending random nonce and exact Manifest bytes | Accept response, then pass existing full Manifest/artifact verification; persist epoch only after full success. | APP unit + cross-language vector |
| Nonce mismatch or wrong nonce length | Reject before accepting Manifest or changing high-water. | APP unit |
| Response replay after challenge consumed; response for another APP nonce | Reject; no second acceptance. | APP unit/integration |
| Response expiry | Reject an expired response and leave persisted epoch/digest unchanged. | APP unit |
| `issued_at` too far in future or `expires_at <= issued_at` / TTL too long | Reject. | APP unit |
| Wrong audience URL digest | Reject, even if signature is otherwise valid. | APP unit |
| Wrong scope, environment, or protocol/schema version | Reject; Production never accepts Canary. | APP unit |
| Wrong signer key ID, unknown key, invalid signature, malformed SPKI | Reject. | APP unit |
| Unknown field, duplicate JSON key, noncanonical envelope/payload, padded or malformed base64url | Reject. | APP + shared JS/Rust vectors |
| Freshness response epoch below APP local high-water | Reject. | APP unit |
| Same epoch with a different Manifest digest | Reject. | APP unit + publisher unit |
| Fetched Manifest bytes differ from signed response digest by one byte/whitespace | Reject before config acceptance. | APP integration |
| Response points at Manifest with wrong schema/scope or invalid original Manifest signature | Reject; freshness response does not bypass Manifest v2 verification. | APP integration |
| Pointer signature invalid or signed pointer wrong environment | Endpoint returns no signed freshness response. | Endpoint/Worker unit |
| Pointer and exact Manifest digest mismatch | Endpoint rejects; APP also rejects any fetched-byte mismatch. | Endpoint + APP integration |
| Mock stale R2 pointer below independent ledger high-water | Endpoint fails closed and emits no signature. | Endpoint unit |
| R2 read-after-acknowledged-write through direct API | Reads exact committed pointer; test uses only an approved disposable bucket. | R2 integration |
| Publisher CAS race, stale ETag, same epoch/different bytes | One writer wins; conflicting release fails; no two success receipts. | Publisher unit + disposable R2 integration |
| Missing pointer with ledger high-water > 0 | No “first install” fallback; no signed freshness response. | Publisher + endpoint integration |
| Pointer missing with pending/ambiguous write | Remain unavailable until readback/reconciliation; no blind retry or epoch reset. | Publisher + endpoint unit |
| Pointer-loss restore using ledger and exact immutable snapshot | Only exact previously committed bytes restore via conditional create; epoch/digest unchanged. | Recovery integration/runbook exercise |
| Pointer-loss with missing/corrupt ledger or snapshot | Freeze and require two-person recovery; no auto-selected object or reset to zero. | Recovery integration/runbook exercise |
| CDN returns a previously cached response with old nonce | APP rejects nonce mismatch. | Endpoint/APP integration |
| CDN returns old Manifest bytes after a valid response | APP rejects exact digest mismatch. | APP integration |
| Endpoint outage or timeout | Freshness/capture readiness fails closed; high-water is unchanged. | APP integration |
| Signer outage or signing error | No success-shaped response; TLSN capture blocked. | Endpoint + APP integration |
| Production/Canary endpoint, signer, or pointer crossed | Reject due role/audience/independent signer policy. | Endpoint + APP + Worker tests |
| APP sends a self-asserted epoch/digest or arbitrary signing bytes | Endpoint schema rejects; signer interface has no generic signing operation. | Endpoint security test |
| Freshness endpoint unavailable during ordinary proxy traffic | Ordinary Game Server request/response remains functional; only TLSN capture/readiness is denied. | APP integration |
| Worker receives APP claim that freshness was verified | Worker still independently checks observed Presentation identity, Inventory, Approval, and Result Registry. | Worker contract test |

## 8. Implementation roadmap

Only Phase 0 design/documentation is in scope here. Every later phase requires
its own approval and validation; no code from Phases 1–6 was started.

### Phase 0 — Protocol / trust-model approval

- **Files:** this document; [FIRST-TESTPLAY-READINESS.md](../FIRST-TESTPLAY-READINESS.md).
- **API/types:** approve the v1 request/response schema, domain separation,
  same-origin route, exact “latest as of issued_at” semantics, nonce/TTL, and
  fail-closed behavior.
- **Depends on:** none.
- **Success:** designated human owners approve the trust model, key custody,
  high-water/recovery authority, outage policy, and test environment. Design
  status is recorded as approved or rejected.
- **Security tests:** review test matrix; no runtime test or signing operation.
- **Human approval / external inputs:** required. No secrets or Production
  values are needed for Phase 0.
- **Current result:** proposal documented; approval **NOT_GRANTED**.

### Phase 1 — Publisher / pointer authority

- **Files:** `scripts/tlsn-runtime-config-release.mjs`,
  `scripts/tlsn-runtime-config-manifest.mjs`,
  `scripts/tlsn-runtime-config-r2-store.mjs`,
  publisher/R2 tests, plus a new monotonic release-ledger module and schema.
- **API/types:** immutable Manifest snapshot, high-water ledger record,
  serialized prepared/committed states, recovery receipt, and an API that
  atomically advances a committed ledger version under conditional CAS.
- **Depends on:** Phase 0. Storage selection must be approved; no production
  R2 write in this phase without a separate authorization.
- **Success:** exact snapshots and artifacts read back by digest; no epoch
  rollback; one CAS winner; missing/corrupt state fails closed; recovery can
  restore only exact committed bytes.
- **Security tests:** CAS race, ambiguous outcome, pointer loss, ledger loss,
  same-epoch mutation, corrupt snapshot, and recovery approval tests.
- **Human approval / external inputs:** choose and authorize the authoritative
  ledger, independent custodians, retention and restore controls. Production
  R2 credentials are not needed for local tests.

### Phase 2 — Freshness signer / endpoint

- **Files:** a new route module under
  `packages/FUSOU-TLSN-VERIFICATION-WORKER/src/` and its `src/index.ts`
  wiring, endpoint tests, generated binding/schema declarations only if the
  approved design requires them.
- **API/types:** bounded challenge parser, direct R2/ledger read, exact
  pointer verifier, typed `signFreshnessResponse`, strict v1 response
  envelope, no-cache headers and explicit 503 refusal states.
- **Depends on:** Phase 0 and Phase 1.
- **Success:** signs only the committed pointer for the pending nonce; accepts
  no caller-supplied epoch/digest/message; no Worker Result/Notary authority
  is shared; Production/Canary are isolated.
- **Security tests:** invalid/stale pointer, cache, nonce, role, audience,
  signer outage, R2/ledger mismatch and arbitrary-signing request tests.
- **Human approval / external inputs:** signer custody and endpoint ownership
  approval are mandatory. Do not place the signing key in ordinary Worker
  bindings. Any HSM/provider integration is external and secret-bearing.

### Phase 3 — APP verifier / persistence

- **Files:** `src-tauri/src/tlsn_runtime_config_manifest.rs`,
  `src-tauri/src/tlsn_runtime_config_runtime.rs`, Rust tests and shared
  cross-language known-answer fixtures.
- **API/types:** one-time pending challenge, bounded POST fetcher, strict
  response parser/verifier, exact URL audience derivation, exact-byte digest
  comparison, and atomic high-water update after complete Manifest and
  artifact verification.
- **Depends on:** approved Phase 0 schema and a Phase 2 endpoint contract.
- **Success:** new APP rejects replay/rollback and preserves current Manifest
  verification; endpoint failure blocks TLSN capture without stopping normal
  proxy traffic.
- **Security tests:** APP cases in Section 7, local state corruption,
  process restart, cancellation and repeated response.
- **Human approval / external inputs:** approved policy for response TTL,
  time skew and existing APP behavior during endpoint outage. Release values
  and signing secrets are not added to source.

### Phase 4 — Worker consistency / independent verification

- **Files:** Worker config/route tests, `src/index.ts` only if a reviewed
  interface is needed, and Runtime Config/Result Registry contract tests.
- **API/types:** no APP “verified” claim is accepted as Worker authority. If
  the Worker needs a release identifier, it must come from its own approved
  Binding or verified source, not the APP body.
- **Depends on:** Phases 1–3; existing trust checks remain in force.
- **Success:** Production and Canary authority remain separate; observed
  Presentation identity, Inventory, Target Approval and Result Registry
  verification are unchanged and independently enforced.
- **Security tests:** cross-environment substitution, APP claim forgery,
  mismatched release and existing Worker negative tests.
- **Human approval / external inputs:** any new Worker Binding or role change
  requires separate approval; not needed if existing independent checks
  suffice.

### Phase 5 — Integration / adversarial tests

- **Files:** APP/Worker integration tests, fixtures, cross-language protocol
  vectors, and `.github/workflows/tlsn-testplay-candidate.yml` only if the
  approved required-check set is changed.
- **API/types:** test-only endpoint/signer adapters and deterministic clock /
  R2 fakes; a disposable R2 integration adapter if separately approved.
- **Depends on:** Phases 1–4.
- **Success:** all Section 7 tests pass, including the ordinary-proxy
  availability property. Tests explicitly distinguish source, unit,
  integration and live-service evidence.
- **Security tests:** complete matrix, concurrency/fault injection, cache
  replay and recovery exercise.
- **Human approval / external inputs:** disposable R2 test bucket authorization
  required for live storage integration. No Production bucket, Game Server or
  Notary is used.

### Phase 6 — Deployment preparation

- **Files:** deployment/readiness runbook, approved Worker route/config and
  APP release handoff only after the prior phases are accepted.
- **API/types:** registered same-origin route, role-separated signer access,
  read-only pointer/ledger access for endpoint, cache bypass, structured
  observability and alerting.
- **Depends on:** Phases 0–5, separate operator sign-off, and successful
  non-Production rehearsal.
- **Success:** registration readiness reports actual approved states without
  printing secrets; rollback/recovery drills pass; APP release and endpoint
  are reviewed as a coordinated versioned rollout.
- **Security tests:** access-control review, cache-bypass verification,
  signer audit, pointer-loss rehearsal, outage monitoring, and release
  rollback exercise.
- **Human approval / external inputs:** exact Bootstrap registration, signer
  custody, endpoint domain/route, ledger owner, CDN policy, secrets, and APP
  release approval. No deploy is implied by completion of this document.

## 9. Required human decisions and residual risk

1. Approve or reject Option C and the fact that its signer must be available
   online. Decide whether same-key direct signing is acceptable or whether a
   separate root-authorized purpose key is required.
2. Select the authoritative monotonic release ledger and its independent
   custodian(s); define two-person pointer/high-water recovery authority.
3. Approve the exact route/audience, response TTL (60 seconds proposed),
   allowed clock skew, retry semantics and strict outage policy.
4. Approve immutable Manifest snapshot retention and recovery-log retention.
5. Define signer compromise response, revocation and APP root-rotation
   process. Current APPs cannot remotely revoke their sole embedded root.
6. Decide if the guarantee is “latest at signed `issued_at`” (proposed) or
   requires serialization against concurrent publication.
7. Establish the non-Production integration environment and whether a
   disposable R2 test bucket may be used.

Residual risks remain: a compromised Bootstrap signer can issue valid
assertions and Manifests; a compromised authoritative ledger can lie about
latest state; endpoint outage blocks fresh TLSN capture; an APP owner can
change its own pin and local state; and a signed response only proves what the
signer asserted. None of these risks changes Worker-side independent evidence
verification or creates Browser/process integrity guarantees.
