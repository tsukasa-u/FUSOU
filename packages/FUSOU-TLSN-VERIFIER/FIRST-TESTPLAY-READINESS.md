# First real APP TLSN testplay: current readiness boundary

## Candidate CI Ubuntu package sources — 2026-11-27

Hosted run [#148](https://github.com/tsukasa-u/FUSOU/actions/runs/45968849206)
failed in APP preflight before compilation. The runner's Microsoft Ubuntu
repository returned HTTP 403 during `apt-get update`. The candidate workflow
installs its Ubuntu build and test packages using the image's Ubuntu sources
explicitly. The requested packages, Clang pin and test steps are unchanged.

## Signed retirement of an unconfirmed Freshness issue — 2026-11-27

Read-only Cloudflare SQLite queries found exactly one issue with
`RESULT_UNKNOWN`, a retained blocker and a persisted signing claim. Its
response bytes, length and digest are all absent. The Release is still
`AVAILABLE`. The query wrote zero rows. This leaves no finalized response
to read back, and does not establish whether a signature was computed.

The local Coordinator adds a private DO RPC for retiring that exact class of
issue. The operator presents a canonical Ed25519 approval verified against a
separately configured recovery key. The approval covers the Coordinator ID,
profile, chain, restore epoch, issue ID, request digest, old fence, installed
state, incident ID and validity window. One SQLite transaction records the
approval and receipt, advances the fence, and permanently rejects the old
operation while preserving its request and nonce. [Cloudflare SQLite transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transactions)

An exact authorized replay returns the same receipt, including after a
restart. New Freshness requests remain blocked on the retired Release state.
The existing writer may advance to a newly verified Release, after which
only new challenges can be issued. The regression includes a real fixture
signature lost before finalization and tests rejection of that late signature.
A caller with an unregistered key, an out-of-window approval, or mismatched
target, request, installed state or fence cannot perform the retirement.

The Coordinator runtime suite passed 75/75 with zero skips or RPC disposal
warnings. Coordinator typecheck passed. The retirement regression uses a
generated test authority and isolated SQLite/R2 state. The deployed Signer has no recovery key or management route for this
operation. This change has not been deployed or verified in Hosted CI. The
live issue remains retained and the Gateway remains private. Stage A/B/C and
Production acceptance remain `BLOCKED`.

## Freshness UTC comparison fixed in the local candidate — 2026-11-27

An isolated Coordinator runtime test reproduced a post-claim failure with the
Worker clock one millisecond behind the Coordinator. Before the fix, the
release-state reader returned `RESULT_UNKNOWN` before reaching R2. The fix
compares the two clock observations after exact R2 readback and before the
reader accepts the Release as current. The Coordinator's persisted monotonic
check and the Manifest, Release and delegation validity checks remain in
effect. Cloudflare documents that deployed Workers' timers advance after I/O.
[Workers timer behavior](https://developers.cloudflare.com/workers/runtime-apis/performance/)

When the Worker clock catches up during readback, the runtime test verifies one
signature and exact finalized bytes. With a persistent mismatch it verifies
zero signatures and a retained `RESULT_UNKNOWN` blocker. The private Signer
now logs the phase and a fixed error code when a caught failure leaves an
issue unconfirmed. The deployed failure could still have occurred at another
post-claim step. Its exact cause remains unconfirmed.

Node 22.16.0 passed Domain tests (33/33), Coordinator runtime tests (74/74),
both typechecks and the Gateway runtime suite. The existing candidate
workflow covers these checks.
Changes are local. The deployed retained issue and Release were left alone.
A recovery path with evidence or authorized fencing is still required for that
issue, followed by a fresh Worker observation and signed Release update.
Hosted verification of this change is `NOT_CHECKED`. The Gateway remains
private. Stage A/B/C and Production acceptance remain `BLOCKED`.

## Initial Runtime Config installed privately; Freshness blocked — 2026-11-27

The initial Manifest V3 for selected Worker source
`c25f1b71e830ab2fd27fcb07f67bff9c4e847dcf` was issued after authenticated
Cloudflare deployment and Custom Domain readback. The independent approval,
the Manifest signature, exact bytes of all five artifacts, and trust pins
verified locally. The epoch 1 Manifest SHA-256 (unpadded base64url) is
`Ie2WDzdZpQztaQ2-OU-oUP0rciseSU-chAYrhaQ2aVk`. Its Worker reference age
window ended at `2026-11-27T03:29:26.365Z`.

Seven objects were placed in the dedicated private R2 bucket. The immutable
artifacts and snapshot were written with create-only conditions. The Manifest
pointer was created only if absent, after the immutable byte readbacks.
The signed Release Commit Record binds the actual pointer ETag
`33692ea865e24422385b0325fda6647c` and has digest
`ingKZfCu_F_zWn8sgp8oqcWLrWGzoMTgblbh3Vb1zso`.
Separate Release and Freshness delegations were verified before enrolling
the two child keys and management capabilities on the private Signer.
The Bootstrap and approval private keys stayed local.

Signer version `3bde1d70-efc9-41af-8d93-88e9d2c546e5` registered
Genesis operation `7467e54c-9d93-435c-b24b-751b65e59097` once through the
private Service Binding. The apply response and subsequent read-only status
both reported `INSTALLED`, Release `AVAILABLE`, install `INSTALLED`.
The initial `NOT_FOUND` status uses CLI exit code 1. That status stopped the
first shell sequence before it sent an apply. The subsequent sequence sent
the first and only apply.

Through a private Service Binding to Gateway version
`55aecfbc-8363-4c11-b15c-c1251a5a7a2e`, the Manifest, immutable snapshot, and
all five artifacts returned HTTP 200 with the expected exact bytes. The
Freshness POST returned HTTP 502 `invalid_freshness_response`. The Signer
diagnostic showed `private_signer_result_not_finalized`.
A read-only Coordinator query confirmed one issue in `RESULT_UNKNOWN` with
the signing claim and blocker retained. The Release remained `AVAILABLE`
and current state stayed installed. The query wrote zero rows. The exact
failure point after the signing claim is unconfirmed. The Gateway and Signer
remain private. No Custom Domain was added for `tlsn-config.fusou.dev`.

Preserve the installed Release and issue blocker while diagnosing the
post-claim path. Use an isolated reproduction for new challenges. Follow the
existing [Unknown and recovery contract](docs/runtime-config-freshness-contract-revision-proposal.md)
before any production recovery. The selected revision exposes no operator
recovery RPC for this retained issue. Refresh the Worker observation and
advance the signed Release through the supported path before APP testing once
recovery is possible. Live APP and Game Server traffic were not started.
Stage A/B/C and Production acceptance remain `BLOCKED`.

## Independently signed approval for the initial Manifest — 2026-11-27

The operator approved registration of a separate approval authority for the
first testplay Manifest. Its Ed25519 public key is pinned in the local
operator tooling for source `c25f1b71e830ab2fd27fcb07f67bff9c4e847dcf`,
epoch 1 and `https://tlsn-config.fusou.dev/tlsn/runtime-config/v2/manifest.json`.
The approval signature binds the Bootstrap root, exact Manifest delegation
bytes and approved configuration digest. The initial preparation path checks
the approval before Cloudflare observation and again before signing. The
generic publisher still has its existing registration gate.

The Bootstrap root and Manifest child were generated separately from the
approval key. Private material remains in the task's permission-restricted
local directory. Local verification passed on the actual public Bootstrap
pin, root-signed Manifest delegation and independently signed approval.
The delegation expires at `2026-11-28T00:46:27.524Z`. Re-observation of the
Worker is still required before issuing a current Manifest.

Read-only Cloudflare checks found the expected private Gateway-to-Signer
binding, Signer DO/R2 bindings, zero objects in the dedicated R2 bucket, and no
exact-name DNS record or Custom Domain for `tlsn-config.fusou.dev`. No Manifest
has been issued. Release/Freshness authority setup, R2 staging, Genesis,
Gateway publication and APP verification are pending. Neither cloud-side
signing secrets nor real Game Server connections were used in this check.

Local Node 22.16.0 passed 119 candidate handoff tests and 73 Coordinator
runtime tests with zero failures or skips. The new regression rejects a
caller-signed approval before Cloudflare access. Hosted CI for the tooling
change is `NOT_CHECKED`. Stage A/B/C and Production acceptance are `BLOCKED`.

## Public Verification Worker and initial Runtime Config inputs — 2026-11-27

The dedicated [Verification Worker health endpoint](https://tlsn-verify.fusou.dev/health)
now serves `fusou-tlsn-verification-production`. Before assigning the Custom
Domain, the Cloudflare control plane reported no exact-name DNS record, no
existing Custom Domain for the hostname, and only the existing disjoint
`fusou.dev/*` and `s.fusou.dev/*` Worker Routes. The single managed domain was
added with preview routing disabled. Readback confirmed the same Zone, Worker,
deployment and active version `53c99c10-d39e-4263-a558-fae8159a2277` at 100%.
The two regular-site Worker Routes remained as before.

Public HTTPS certificate validation succeeded. `GET /health` returned 200
with the selected SHA `c25f1b71e830ab2fd27fcb07f67bff9c4e847dcf`, matching
active version, Production role, random binding, Queue mode and a valid trust
contract. Unauthenticated requests to `POST /attestation/session` and
`POST /verify/tlsn` both returned 401. This confirms the hosted response and
denial paths. Authenticated Session issuance, Queue execution for a real
Presentation and Result delivery remain unchecked.

The local APP Worker reference was captured by validating the independently
pinned deployment record and two authenticated Cloudflare observations of the
active version and route mapping. The reference is 7,019 bytes with SHA-256
(unpadded base64url)
`46AvVyrfUPoPpwFNIpfs0nqqvMdRHqnvUmAUMqTia98`. The exact reference,
Inventory and Target Approval from the selected SHA, security registry set,
and Result registry envelope passed local independent-input checks against the
unsigned initial payload. The configuration digest for the proposed
`tlsn-config.fusou.dev` Manifest URL is
`kW8e3nTW3X09IBeYBxJ5x-k2V6NSd-L7ot7hUC5O6mU`. Re-observe the Worker when
issuing a time-sensitive Manifest.

The private Runtime Config Gateway has its Signer Service Binding. The
private Signer has its DO and R2 bindings. The readback showed no registered
Manifest URL or signing bindings on these active versions. The next release
work is signing authority registration, initial Manifest and Release Record
issuance, R2 readback and Genesis install. The unsigned inputs are local
preparation. Stage A/B/C and Production acceptance remain `BLOCKED`. No Game
Server was selected or contacted in this check.

## Wrangler deployment evidence for the APP Worker reference — 2026-11-27

The [APP Worker reference tool](../FUSOU-TLSN-VERIFICATION-WORKER/scripts/capture-app-worker-reference.mjs)
now accepts an independently pinned `operator-wrangler-v1` record. Successful
candidate CI is recorded against the selected source SHA. Wrangler deployment
evidence records the account, script, logical deployment, actual deployment,
active version and the approved public manifest bytes. The tool still reads
the active Cloudflare version, public bindings and custom domain mapping before
emitting the reference. Manifest preparation re-observes the same deployment
before signing. Workflow-issued deployment provenance remains supported.

Before the public domain assignment, for selected SHA `c25f1b71e830ab2fd27fcb07f67bff9c4e847dcf`,
[candidate CI #147](https://github.com/tsukasa-u/FUSOU/actions/runs/45906069426)
passed on attempt 1. A read-only Wrangler check confirmed the same Wrangler
deployment `f87a78d2-5e50-4977-930d-5b508aac37da`, version
`53c99c10-d39e-4263-a558-fae8159a2277` at 100%, 18 expected public
bindings and the version-metadata binding. The local operator draft binds the
existing public-manifest bytes and the recorded WASM build digest. Its
SHA-256 (unpadded base64url) is
`wIlQRklbFhSIBhnn5AGApuDuJP9XLfFfoFu7G7_ohmc`. This is a draft
digest from the local preparation. The Worker is still private and no
final APP Worker reference has been issued.

Local Node 22.16.0 passed all 118 candidate handoff tests and all 174 tag
contract tests, with zero failures or skips. The operator-profile test covers
delegated Manifest V3 preparation, exact Worker-reference digest, and rejection
when the active version differs. Deployment and signing in these tests use
fixtures. Hosted CI for this tooling change is `NOT_CHECKED`.

The next live checks at that point were binding the dedicated
`tlsn-verify.fusou.dev` custom domain, reading its route back to produce the
APP Worker reference, and registering the Runtime Config signer and initial signed release. The
[cloud setup runbook](../FUSOU-TLSN-VERIFICATION-WORKER/docs/first-testplay-cloud-setup.md#配備ワークフローとwranglerの証跡)
records both provenance inputs and the configuration order. APP live handoff
and actual Game Server capture are pending. Stage A/B/C and Production
acceptance are `BLOCKED`.

## Dedicated operational Verification Worker active privately — 2026-11-27

Wrangler 4.135.0 deployed `fusou-tlsn-verification-production` from
`c25f1b71e830ab2fd27fcb07f67bff9c4e847dcf` with the verified
candidate-bound WASM. Cloudflare reports version
`53c99c10-d39e-4263-a558-fae8159a2277` at 100% and Binding Authority
namespace `6c0b2bf36db1483e8e7aad1b603f8437`. The dedicated
Verification Queue has one producer and one consumer. Its separate
archive R2 and the Runtime Config R2 both had zero objects. The
Worker was deployed with routes empty and `workers.dev` and preview
URLs disabled.

The active version exposes exactly the four intended secret binding
names for Session, Binding, Result and Queue execution signing. Their
public bindings matched the prepared settings. Notary private material
and the Result Registry root private key were kept local. Through a
temporary Wrangler remote Service Binding, hosted `/health` returned
HTTP 200 with the expected source SHA, active version, Production role,
random binding, Supabase auth, Queue execution,
`trust_contract_valid=true` and
`queue_execution_receipt_configured=true`. Unauthenticated
`/attestation/session` and `/verify/tlsn` both returned 401. No active
user/device, Presentation, Queue job or Result was created by this
check.

The actual private deployment and a validated draft public manifest
are recorded separately. The candidate public name
`tlsn-verify.fusou.dev` was exercised in a triggers dry run only.
At the time of this deployment, APP Worker-reference acquisition required both a public
Cloudflare endpoint mapping and independently approved deployment
provenance with `workflow_file_identity=dotenvx+pnpm+wrangler`.
Candidate Actions #147 verified the source and build; this Worker was
deployed separately by Wrangler. No workflow-issued Production
provenance was derived from #147. The handoff path must be able to
represent the observed deployment truthfully before this version is
bound into a signed initial Runtime Config. The public route,
initial Runtime Config, APP live handoff, operational Notary start and
game capture are pending. Stage A/B/C and Production acceptance remain
`BLOCKED`.

## Dedicated Notary and Verification Worker authority inputs prepared — 2026-11-27

The candidate remains `c25f1b71e830ab2fd27fcb07f67bff9c4e847dcf`. A
single-operator enrollment draft uses `fusou-first-testplay-notary` at
`127.0.0.1:47047`; no listener was present at the time of the placement
check. Separate keys were generated for Notary K256, Session Authority,
Binding Authority, Result signing, Queue execution receipts, and the
Result Registry root. Private files are `0600` in a `0700` directory
outside Git. The Result Registry root is retained locally. The three
authority registry entries have a 30-day initial validity window.

The signed Result Registry envelope, both authority registries and the
Security Registry Set were validated against the candidate's exact inputs.
The ordinary candidate Notary's `export-public` matched the planned
public bytes exactly and refused an altered K256 pin. A disposable
anchor was used for that key/configuration check and was removed; no
operational origin anchor, Notary ledger, or listener was established.

The candidate Verification Worker returned HTTP 200 in the isolated
runtime with `trust_contract_valid=true`, `production` role, `random`
binding, `queue` execution and
`queue_execution_receipt_configured=true`. Substituting the Result
public key for the Queue execution public key yielded HTTP 503. The
worker made zero outbound requests during those checks. The public-only
configuration passed Wrangler dry run with routes, preview URLs and
`workers.dev` disabled.

The status is `PREPARED_NOT_REGISTERED`. No secrets were uploaded,
no Worker was deployed, and no approved Manifest or Game Server was
selected. The prepared public inputs can be used for the dedicated
Worker setup. Before the Notary is started for a real capture, the
chosen host's authorized certificate chain, exact approved Runtime
Config and the independently pinned registration must pass preflight.

## Candidate-bound operational Notary binary verified locally — 2026-11-27

Following the predeployment check below, the isolated checkout of
`c25f1b71e830ab2fd27fcb07f67bff9c4e847dcf` restored only the tracked shared
dependency `packages/configs/configs.toml`. Its Git blob matched the
candidate. APP roaming configuration remained absent. The normal
`operational-notary` release built on Linux x86-64 with Rust 1.98.1,
`--locked --offline` and no fault-injection feature. The Proxy lockfile
did not change. The executable is 23,199,448 bytes, mode `0755`, with
SHA-256 `7b64c306cdd7e8e1fb50a62e6d31264c6ec8051be4c88c8e6d8bfa2b1a005301`.

Both hosted selectors were run locally against those exact executable
bytes in the isolated release-profile harness. Complete Presentation and
same-ledger restart passed. Invalid non-loopback, noncanonical or
mismatched settings were refused before side effects. Both ran one test
with zero failures or skips. The copied binary and the pre/post-test
digests matched. The test used synthetic inputs and loopback only.

The local build gap in the previous record is resolved. Operational Notary
keys and registration, the actual service instance and ledger, Verification
Worker signing inputs and deployment remain pending. No game or other
external service was contacted by the Notary tests.

## Candidate-bound Verification Worker predeployment — 2026-11-27

[Candidate run #147](https://github.com/tsukasa-u/FUSOU/actions/runs/45906069426)
completed all four jobs at `c25f1b71e830ab2fd27fcb07f67bff9c4e847dcf`.
The Verification Worker WASM was rebuilt offline from that exact SHA in
an isolated checkout using Rust 1.98.1, wasm-pack 0.15.1, wasm-bindgen
0.2.128, Binaryen 133 and Clang 18.1.3. Worker typecheck and provenance
passed. The resulting WASM SHA-256 is
`84012792173d14b9a2c89799f2e63e94fa2f0476592c1e82e07d507077577223`.

The Worker dry run used that WASM, the dedicated Supabase project's
publishable configuration and the existing WEB proof endpoints.
The Worker contract verified the exact Inventory and Target Approval
inputs for all 20 recorded entries without selecting or contacting a
game host. The preview config has the dedicated verification Queue as
producer and consumer, archive R2, Binding Authority DO, version
metadata, and no public route or preview URL. Both live WEB endpoints
returned 401 to unauthenticated requests. The local Worker preview
returned 503 with `trust_contract_valid=false` with its signing and
registry inputs absent.

Wrangler readback showed no deployed operational Verification Worker,
zero Verification Queue producers and consumers, zero objects in both
dedicated R2 buckets, and the existing private Gateway and Signer
versions active at 100%. Cloudflare and Supabase configuration was
unchanged in this work unit.

Hosted #147 also passed its normal operational Notary build and interop
step at the same SHA. The separate local Notary build did not produce a
binary. The isolated file selection omitted the compile-time `configs`
dependency's `configs.toml`. Automatic approval review rejected adding
that file to the isolated checkout, so it was not read or restored in
this work unit. The hosted Notary step did not publish the executable as
an artifact. The next deployment work is to establish the actual
same-host Notary public material, Session/Binding/Result signing and
registry inputs, and verify the complete Worker configuration before
deployment. APP Bootstrap enrollment, signed Runtime Config
publication, game capture and formal Evidence acceptance remain open.

## Private initial Release operator CLI — 2026-11-26

The [Genesis operator CLI](../FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/scripts/genesis-operator.mjs)
checks an independently approved digest and exact input bytes offline,
derives the same operation ID as the Coordinator, and separates status
GET from a single explicit apply POST. The hosted Signer and its admin
endpoint remain private. The temporary Wrangler loopback bridge allows
one request scoped by a random token and a fixed operation/method.

The pinned local runtime verified exact request material, initial
registration, rejection of substitutions and mismatched success reports,
and recovery of the same installed operation after response loss without
automatic resubmission. The actual CLI reached the deployed Signer via
Wrangler and the hosted read-only status operation refused a synthetic
unregistered capability (`403 forbidden`). No hosted Genesis POST or R2
write occurred. Deployment, DNS, signing-key and registration state did
not change during this work unit. Coordinator typecheck and 73/73 runtime
tests passed. Hosted CI was not run for this revision.

The [first-release approval record](../FUSOU-TLSN-VERIFICATION-WORKER/docs/first-testplay-release-approval.md)
collects the proposed dedicated hosts, operating profile and public trust
inputs. It records no approval or new signing key. Approved keys and
scope, the active Verification Worker reference and the exact initial
Release package remain necessary before live initialization. Stage A/B/C
and Production acceptance remain `BLOCKED`.

## Verification Worker wiring preview — 2026-11-26

The [first-testplay cloud setup guide](../FUSOU-TLSN-VERIFICATION-WORKER/docs/first-testplay-cloud-setup.md)
records the dedicated endpoints, the key and delegation inputs, the
initial Release and APP settings, and the boundary before gameplay.
The [Verification Worker example](../FUSOU-TLSN-VERIFICATION-WORKER/wrangler.first-testplay.example.toml)
sets the dedicated WEB proof endpoints, queue producer/consumer, R2,
DO and version metadata. Routes, `workers.dev` and previews are disabled.

Wrangler 4.135.0 confirmed the existing private Gateway and Signer
versions at 100%, no operational Verification Worker, no Queue producers
or consumers, and zero objects in both dedicated buckets. The example
bundled successfully in an isolated dry run with the existing local
WASM. That WASM's recorded SHA differs from current HEAD and the configured
toolchain path lacks `wasm-bindgen`; this run does not verify release WASM
provenance. Worker typecheck and forty focused Node contract tests passed.

At that point Production trust inputs and public hosts were unregistered,
and the private Genesis API only had a test caller. The operator CLI is
now recorded above. No Worker deployment, route, Queue binding, R2 write,
APP session, or game request was made during this work unit. Stage A/B/C
and Production acceptance remain `BLOCKED`.

## Private Runtime Config infrastructure deployed — 2026-11-26

Wrangler 4.135.0 deployed the two Runtime Config Workers from source
`0e3042c70bdecfbe774c7133449e04727f402c6f` using isolated deployment
configurations derived from the existing examples. Neither name had an
existing deployment. The deployment configurations disable `workers.dev`
and Preview URLs and have no routes. Wrangler reported no deployed
targets. There was no change to the ordinary WEB, dedicated TLSN WEB,
test-role Verification Worker, or Verification Queue.

| Worker | Active Cloudflare version | Verified bindings |
| --- | --- | --- |
| `fusou-tlsn-runtime-config-freshness-signer` | `cfc91dda-2f3a-48a8-915d-d81635d4c266` | New SQLite Coordinator namespace `90ed082255654a6c90be9595a31ae3a8` and dedicated `fusou-tlsn-runtime-config-first-testplay` R2 bucket |
| `fusou-tlsn-runtime-config-freshness-gateway` | `07cab25b-7619-4bd9-9a98-e78e3a3f71ff` | Private Service Binding to that Signer |

Both dry runs passed. Deployment and version readback showed each
version active at 100% and confirmed the bindings above. An authenticated
loopback Wrangler probe reached both hosted Workers through remote
Service Bindings. The Gateway rejected the unconfigured Manifest with
`503 runtime_config_unavailable` and Freshness with `503
freshness_unavailable`. The Signer returned `404 not_found` for the empty
R2 Manifest pointer and `403 forbidden` for Genesis without a capability.
The Workers retain compatibility date `2026-11-13` and
`enable_request_signal`. The loopback probe alone used `2026-09-07`
after the CLI's bundled local runtime rejected the newer date.

No operational signing keys, delegation, Genesis authorization, or
public Manifest URL were installed. The DO namespace is provisioned;
the Genesis state was not initialized. The release diagnostic still reports
`BLOCKED_EXTERNAL_INPUTS`. The release owner must approve the APP
Bootstrap public root, the exact HTTPS Manifest URL and scoped signing
delegations before publication. The active operational Verification
Worker and signed Worker reference are separate pending inputs to the first
Manifest. No APP run, game traffic, or fresh Hosted CI run occurred in this
work unit. Stage A/B/C and Production acceptance remain `BLOCKED`.

## Dedicated Queue, private R2 and Worker endpoint preparation — 2026-11-26

Wrangler created the dedicated `fusou-tlsn-verification-production`
Queue and two separate R2 buckets. The verification archive uses
`fusou-tlsn-verification-production`. The Runtime Config release
ledger uses `fusou-tlsn-runtime-config-first-testplay`. Both buckets
reported APAC, zero objects and disabled public access. No custom
domains are attached to either bucket. The Queue has zero producers
and consumers. Existing Workers, buckets and Queue bindings were
preserved.

Worker reference acquisition previously rejected any Worker Route
in the Custom Domain's zone and assumed a 32-character Custom Domain
ID. Cloudflare returned the ordinary WEB and shortener routes in the
active zone and a longer opaque ID for the dedicated WEB Custom Domain.
The observer now accepts other literal hostnames in the same zone and
records the sorted route-pattern digest as mapping schema 2. It still
rejects same-host, wildcard-host, ambiguous or incomplete observations.
It rechecks the endpoint mapping and route inventory before accepting
the reference. The existing route-free and `workers.dev` mapping
formats still use schema 1. The fixed observer reproduced a valid
mapping from the authenticated Cloudflare control-plane response for
`tlsn-web.fusou.dev`. That is endpoint-mapping evidence for the WEB,
independent of any future Verification Worker deployment. Node 22.16.0
passed all 115 candidate APP handoff and Worker reference tests and all
174 release tag contract tests.

At the end of that work unit, the resources were empty and unbound. The Runtime Config publisher
diagnostic still reports the Manifest signer as `NOT_CONFIGURED` and
the root-signed delegation, APP Bootstrap root and Manifest URL as
`NOT_REGISTERED`. The next dependency is an independently approved
key and endpoint registration for the exact first-testplay scope.
The operational Verification Worker, Runtime Config Gateway and
private Signer were not deployed. No object, message, signature,
Session, APP run or game request was produced in this work unit.

## Hosted private Verification Worker Session test — 2026-11-26

The separately deployed test-role Worker `fusou-tlsn-session-testplay`
served version `ded6c9d9-73f2-465d-941b-716867526293` at 100%.
Cloudflare reported no routes, Custom Domain, `workers.dev` endpoint
or Preview URL. A local authenticated
[remote Service Binding](https://developers.cloudflare.com/workers/local-development/#using-remote-resources-with-durable-objects-and-workflows)
invoked a test-only wrapper around the real Verification Worker handlers.
The wrapper accepted only test-role health and Session requests. The
Worker had its own SQLite Durable Object and separate temporary test
Session, Binding and Result keys. The wrapper and deployment config were
generated in an isolated checkout and were not committed.

Worker source and WASM provenance matched
`0e3042c70bdecfbe774c7133449e04727f402c6f`. The WASM build used Rust 1.98.1,
wasm-pack 0.15.1, wasm-bindgen 0.2.128 and Binaryen 133. The build ran
with Cargo offline. Worker typecheck and the deployment dry run passed.
An initial health check returned HTTP 503
`unknown_test_execution_mode` for an explicit `sync` value. Omitting
the optional test-mode setting selected the supported default.

Health returned HTTP 200 with test role, Supabase authentication,
external device proof and random binding. With live
`tlsn-web.fusou.dev` and the dedicated Supabase, missing authentication
returned 401, the other owner returned 403 and the enrolled owner got
201. Independent Ed25519 checks matched the Session receipt and grant
to the previously pinned test public key, exact owner/device, nonce,
binding and 180-second lifetime. A different key and a modified
receipt binding were rejected by the independent check. Reusing the
authentication proof returned 409. The issued Session context drove a
WEB possession proof that returned 200. PostgreSQL held exactly one
authentication proof and one possession proof linked to that device.
The read-only replay response was 409 and matched the possession row
without changing the stored rows.

The two users, their test device and its proof, nonce and member
mapping rows were cleaned up, with zero matching rows on readback.
The local relay was stopped. The private test Worker remains deployed.
Production authority registration, Production Verification Worker,
Runtime Config/Freshness, APP enrollment and same-host Notary remain
open. No game communication or Presentation verification was attempted.
Stage A/B/C and Production acceptance remain `BLOCKED`.

## Dedicated TLSN WEB live proof verification — 2026-11-26

`fusou-tlsn-testplay-web` serves
[tlsn-web.fusou.dev](https://tlsn-web.fusou.dev/) at Worker version
`482d6be4-6388-430e-9404-ba07e87f2750`. The root returned HTTPS 200.
The configured Custom Domain lets Cloudflare manage DNS and TLS for the
new hostname. The ordinary WEB and URL-shortener route mappings were
unchanged in the Cloudflare readback. The source baseline was
`0e3042c70bdecfbe774c7133449e04727f402c6f` plus the uncommitted dedicated
domain configuration and matching build guard. The guard disables the
`workers.dev` and preview URLs and rejects any other hostname. All five
profile tests, the Astro build and the deployment dry run passed.

The WEB points to the separately approved Supabase project
`fusou-tlsn-testplay` (`yakmlupdjpgsbxfopjja`). The initial Auth probe
received HTTP 401 because the CLI's modern server key was masked. A
server-only service-role credential was verified against the dedicated
project before redeploying. Credential values were kept out of the
source, build inputs and recorded evidence.

Two temporary non-anonymous accounts signed in through Supabase Auth.
The service-only registration RPC enrolled a temporary Ed25519 device
for the first account. The public challenge endpoint returned HTTP 200.
Both device-proof endpoints returned HTTP 401 without a bearer token,
HTTP 403 for the other owner, HTTP 200 for the owner, and HTTP 409 on a
duplicate. The dedicated PostgreSQL returned one authentication proof,
one possession proof and one consumed nonce. Read-only replay
observation returned HTTP 409 and the exact stored possession row,
with no change to the proof rows. The fixture users, device, proof rows,
nonce and member mapping were removed. A read-only query verified zero
rows for those fixture IDs after cleanup.

This verified the live WEB/Auth/database boundary. The possession
request used a temporary test Session context. The public APP enrollment
path, Verification Worker Session issuance, Runtime Config/Freshness
publication and same-host Notary are pending. No game traffic was sent.
Stage A/B/C and Production acceptance remain `BLOCKED`.

## Dedicated first-testplay infrastructure preparation — 2026-11-26

The source baseline was `0e3042c70bdecfbe774c7133449e04727f402c6f`.
[Candidate run #146](https://github.com/tsukasa-u/FUSOU/actions/runs/45737507898)
passed all four jobs. The [Linux verification artifact](https://github.com/tsukasa-u/FUSOU/actions/runs/45737507898/artifacts/15080792936)
matched the GitHub ZIP digest and pinned source SHA. The Debian package was
29,579,082 bytes with SHA-256
`6724becee367a5f9f3ed5d606baec668a9ad74c2b62bb70df31e54e94a26c864`.
It was inspected without installation. A game-ready APP still needs approved
public Bootstrap inputs.

Wrangler 4.135.0 confirmed separate active deployments for the ordinary
`fusou` WEB and the legacy TLSN test, canary and replay Workers. The planned
`fusou-tlsn-testplay-web`, `fusou-tlsn-verification-production`,
`fusou-tlsn-runtime-config-freshness-gateway` and
`fusou-tlsn-runtime-config-freshness-signer` returned Worker-not-found
in the selected account. The existing `fusou-tlsn-verification-test` Queue
has the legacy test Worker as both producer and consumer.
Wrangler dry runs passed for the Gateway, private Signer and Verification
Worker, with a temporary Queue binding for the last. The Verification
Worker dry run used cached WASM from `0dd7a8e92d3ad90b7fc6a9865741c9273266534c`
and serves as a configuration check. A deployment needs newly verified
WASM provenance for its approved source.

The operator approved a separate zero-dollar Supabase project in Tokyo
named `fusou-tlsn-testplay` with ref `yakmlupdjpgsbxfopjja`. CLI 3.2.0
applied the first two pinned migrations, the existing pristine-only
legacy prelude, then all 23 remaining original migrations. Postgres
17.12 reported all 25 original migration IDs in order, the UUID cutover,
proof storage RLS, and the service-role-only consume and replay RPCs.
Auth users, registered devices and proof rows were all zero at readback.
The prelude SHA-256 was
`3ec53be2b00c0d96baaadcd189c52e9755d832157b905d4783d3d613acfcc7a7`.
It was previously ignored by Git. The narrow ignore exception exposes
only that SQL file for the next commit.

The dedicated WEB built from the isolated source copy using the new
Supabase public origin and its single-host allowlist. The generated
Wrangler config passed the repository guard for `tlsn-web.fusou.dev/*`
and the deployment dry run. The WEB build did not use service-role
credentials. Live proof requests remain untested.

Cloudflare deployment, real key and authority registration, Auth
enrollment, Session issuance and same-host Notary preflight remain open.
No game hostname was selected and no game traffic was sent. Stage A/B/C
and Production acceptance remain `BLOCKED`.

## APP release tag contract repair

[Candidate run #145](https://github.com/tsukasa-u/FUSOU/actions/runs/45682873014)
passed all four jobs at `97d5729d877aa3a9168ac80af1a13020c1ad74ac`,
including the Queue source check and Linux verification APP artifact upload.
The separate release tag contract reproduced 17 failures at that revision.
The release producer and consumer now use the APP's current Bootstrap report
command and schema-4 build record. The consumer checks the pinned Bootstrap
inputs and digest and still verifies the Worker reference independently.
Node 22.16.0 passed all 174 tag contract tests, 113 candidate APP handoff
and Worker reference tests, and 75 candidate Worker proof and replay tests.
The repair's Hosted CI and actual release execution are `NOT_CHECKED`.

## Hosted CI run 45674634194 and local Queue source fix

[Candidate run 45674634194](https://github.com/tsukasa-u/FUSOU/actions/runs/45674634194)
failed at source `4e67163b28be4c952ad917604ec1953a611fa1cc`.
The [node-contract-tests job](https://github.com/tsukasa-u/FUSOU/actions/runs/45674634194/job/139418769935)
failed at step 28 with 74 passing tests and one failure.
The Proxy and Rust preflight jobs succeeded. Steps 29 through 35 and the
Linux verification APP artifact job were skipped.

The release source inventory omitted three tracked imports of the Verification
Worker entrypoint. The import closure reported `production_queue_receipt.js`
first. The repair includes `production_queue_receipt.ts`, `execution-mode.ts`,
and `queue-policy.ts` in the release source inventory and verifies that
omitting any one of them still blocks the release source check.

Node 22.16.0 reproduced the original missing import. After the repair, Worker
typecheck and all 75 step 28 tests passed. In an isolated source copy,
the Freshness and readiness checks passed, including the Gateway runtime,
73 Coordinator runtime cases and 112 contract tests. The contract suite
compiled the APP and exercised its Freshness verifier. The Queue receipt
suite passed 3 tests, the isolated APP Manifest harness passed 45 tests,
and the APP build handoff and Worker reference suite passed 113 tests.
The tracked lockfile guard, offline locked fetch and Manifest vector check
also passed. The Linux artifact job was not rerun.

A supplemental release check outside the failed workflow reproduced the same
17 failures before and after the fix. Its first failure is an APP bootstrap
report field inventory mismatch. The candidate repair's Hosted CI is
`NOT_CHECKED`. Stage A/B/C and Production acceptance remain `BLOCKED`.

## Native Linux APP finalizes and independently verifies a local 19-role Bundle — 2026-11-26

**LOCAL_APP_19_ROLE_BUNDLE_VERIFIED.** A fresh capture from the candidate
worktree at `0dd7a8e92d3ad90b7fc6a9865741c9273266534c` reached both
`finalize_candidate` and the ordinary offline `verify_bundle`. Each returned
`VERIFIED`. The manifest carried all 19 required roles,
`verification_status=VERIFIED`, and `production_evidence_status=BLOCKED`.
The Queue execution receipt separately returned
`SIGNATURE_AND_EXACT_BYTES_VERIFIED` under the independently configured test
execution trust. The exported manifest, material and negative controls were
temporary files from this run.

**Health compatibility.** Schema-3 multi-origin Production health now binds
its Inventory and Target Approval digests at both the top level and
`security_identity` to the already verified signed Result and independent
inputs. The selected origin and profile are still verified from the
Presentation, Result and independent pins. Health remains an unsigned
observation. Single-origin health retains the origin and profile checks.
Production role and binding mode must agree at both deployment levels. The
synthetic regressions verified exact output health bytes and rejected a
missing digest at either level, matching-but-wrong digest copies, conflicting
roles, an invalid trust report, and mixed single-origin fields.

**Environment and capture.** Built the native Linux APP, operational-feature
Notary and offline Verifier from an isolated source snapshot using Rust 1.98.1
and locked offline dependencies. The Docker network was internal with isolated
gateway mode and no published container ports. The stack used a fresh local
Supabase Auth user and PostgreSQL device row, all 25 original migrations,
the dedicated prebuilt WEB bundle, Runtime Config/Freshness, and a
Production-role Verification Worker under local Miniflare Queue, DO and R2.
The disposable Worker selected the local CA for Complete origin checks using
the existing WASM verification exports, scoped to `capture.fusou.internal`.
The APP validated Runtime Config, five artifacts and Freshness, obtained a
Session (HTTP 201) and reported `Overall: ready`. The game launch switch was
off. One request went to the dummy HTTPS origin. The 170-byte request carried
no correlation header or Cookie. The 417-byte HTTP 200 response and request
digests matched the Result's authenticated transcript. The APP submitted
once (HTTP 202), polled the same job (HTTP 202, then 200), and retained the
Result and execution receipt. One Queue delivery was observed. The DO record
was `consumed`. R2 readback digests matched the HTTP/APP Result and
submitted/saved Presentation.

**Evidence inputs and checks.** One read-only WEB replay POST returned a
539-byte HTTP 409 observation for the same proof. The stored-proof response
matched the single existing DB row, which was byte-for-byte unchanged before
and after the replay query. The six independent local roles came from Auth,
the active PostgreSQL device, the Notary registry checked against its public
export, the configured Session and Binding Authority registries, and the
local origin trust anchor. The offline finalizer generated the semantic
report. The declared lengths and digests matched all 19 role files, and
health, captured metadata, both device proofs, replay observation, Presentation
and inner Result matched the exact input bytes. Removing the device role,
changing the receipt signature, changing the exact outer Result, or
substituting the health Inventory digests rejected finalization without
creating an output directory. For byte mutations, updating local descriptors
did not avoid rejection.

| Material | Bytes | SHA-256 (base64url) |
|---|---:|---|
| Complete Presentation | 4,240 | `8211dxoEuat1uVLuj1oo5mHbH5-KZO9ZUWEdhYNzUUw` |
| Exact outer Result | 3,179 | `bYy-5W1WTqFzWtlZ8SY7j9R4flYVrvT6cos9ZUDvBCI` |
| Queue execution receipt | 987 | `Kw_xOJgwEtn2A1raqUsVYB0kLCUxIUWItWtXxZ6fS8w` |
| Worker health | 3,548 | `33UaiAa-_DtkLmbcwdHK1EYn1yGjDn6HqobtAKELI1E` |
| Finalized Bundle manifest | 25,088 | `OWJ4yy0u7WtEVk5Cwmn9zz3imeBffeo6PhOAKa2vVxU` |

The locked offline Verifier library (159 tests), CLI (6 tests) and WASM
target check passed. Unrelated pre-existing format differences remain
outside the edited test and verifier sections. SIGINT exited the APP with
code 0 and restored the isolated PAC to `none` with an empty URL.
Task-owned containers, DB volume, network, bridge listeners and temporary
inputs, keys, builds and evidence were removed.

Hosted CI, live deployment, production authorities, actual gameplay,
and formal Production retention/delivery were outside this run. No
connections were made to an actual game server or to the public FUSOU WEB.
Production acceptance and Stage A/B/C remain `BLOCKED`.

## Unsigned observation timestamp compatibility and multi-origin health diagnosis — 2026-11-26

**LOCAL_TEST_VERIFIED** on the candidate worktree at
`0dd7a8e92d3ad90b7fc6a9865741c9273266534c`. The finalizer reproduced the
PostgreSQL `stored_proof.consumed_at` rejection first and, after that
field was accepted, the APP `proxy_provenance.created_at` rejection.
These two unsigned fields now use the existing RFC 3339 validator.
The APP can retain nanoseconds and a numeric UTC offset. The replay
response can retain PostgreSQL's microseconds and numeric UTC offset.
The comparison of replay body bytes, their length and digests, and the
stored-proof context remains in force. The published replay and metadata
artifacts matched their inputs byte-for-byte.

The 19-role synthetic Bundle finalized and passed ordinary independent
verification. An impossible replay date, an invalid APP offset and a
Session Authority receipt signed with the fixture key using the unsigned
observation format were each rejected without publication. Signed receipt
timestamps and validity-window calculations retain the existing parser.
Rust 1.98.1 locked offline regressions passed (158 library and 6 CLI tests),
as did the WASM target library check and 11 Node replay collector tests.

**Remaining blocker reproduced.** A separate disposable source snapshot
used a synthetic Complete candidate with a schema-3 production/queue
health observation shaped like the current Worker. The Inventory and
Target Approval digests matched the independent inputs and the signed
Result. The observation omitted the single-origin fields, as the Worker
does in this deployment role. The actual finalizer rejected it at
`result_identity/health`, because it expects `server_identity` and
`profile_sha256` in `security_identity`. It created no output directory.
This diagnostic changed the fixture only. The production health test and
the single-origin test still need to exercise their respective inputs
through the same verifier after a contract change. The next comparison
can bind multi-origin health to the independently checked Inventory and
Target Approval while deriving the selected origin and profile from the
Presentation and Result. The health observation is unsigned.

No fresh native APP capture, live service calls or Hosted CI run were
performed. Stage A/B/C and Production acceptance remain `BLOCKED`.

## APP device-proof signature encoding compatibility — 2026-11-26

**LOCAL_TEST_VERIFIED** on the candidate worktree at
`0dd7a8e92d3ad90b7fc6a9865741c9273266534c`. The offline Verifier now decodes the
APP's canonical padded standard Base64 for the authentication and possession
proof signatures. Both cases require exactly 64 decoded bytes and Ed25519
verification with the same independently pinned device key and message.
Canonical unpadded Base64url remains valid for earlier evidence. The proof
artifacts and their exact-byte checks are preserved. The shared Base64url
decoder and authority, Result and Queue receipt signature formats are unchanged.

The focused regression accepted both canonical encodings and rejected a changed
signature, message or public key, wrong signature length and noncanonical
representations. The Queue finalization regression ran against the synthetic
19-role Bundle with both device proofs in APP format. It compared the two
published proof files byte-for-byte, and the normal offline verifier accepted
the published Bundle. Rust 1.98.1 locked offline tests passed (157 library
tests and 6 CLI tests). The locked offline `wasm32-unknown-unknown` library
check passed. The candidate workflow already runs the Rust suites. Hosted
CI for this change and a fresh integrated native APP capture are `NOT_CHECKED`.

The next contract check is the exact timestamp representation in unsigned
APP provenance and PostgreSQL replay observations. An isolated check against
the two existing parser functions confirmed that the RFC 3339 validator accepts
both previously recorded observation formats and rejects impossible dates,
invalid offsets and missing time zones. The signed authority parser still
rejects those observation forms and accepts the canonical millisecond UTC
format. A separate check is required for the
multi-origin Worker health binding to the independently approved Inventory
and Target Approval. The synthetic Bundle result does not establish that
the real APP candidate from the previous run can finalize. Stage A/B/C and
Production acceptance remain `BLOCKED`.

## Native APP Queue capture and replay observation verified; 19-role finalization rejected — 2026-11-25

**Scope.** Disposable Linux test at source baseline
`0dd7a8e92d3ad90b7fc6a9865741c9273266534c`, including the candidate worktree
changes present at build time. Built the native APP and the operational-feature
Notary with Rust 1.98.1 and the locked offline dependencies in an isolated
source snapshot. The local Miniflare Verification Worker used the Production
Queue role and actual WASM verification with the disposable origin CA for
`capture.fusou.internal`. The isolated WEB used the available prebuilt dedicated
bundle. These are local keys, registries, trust inputs and services. Open KanColle
was off. No actual game server, public FUSOU service or deployment was used.

**Capture.** An initial start exposed two harness issues. Candidate saving
needs `proxy.tlsn.candidate_capture_enabled`, and the D-Bus session needs the
same XDG configuration environment as the APP. After correcting those values,
the APP reported `Overall: ready`. An initial connection reached the Runtime
Config ingress address and failed certificate-name validation before an HTTP
request reached the origin. The dummy HTTPS origin then ran at a separate
address. A new Session and a distinct locally generated POST produced the only
HTTP exchange, with a 170-byte request and a 417-byte HTTP 200 response. The
transcript digests matched the recorded origin bytes. The request carried no
added correlation header or Cookie. The APP made one verification submission
(HTTP 202) and polled the same job (HTTP 202, then HTTP 200). There was one Queue
delivery, the Binding Authority state was `consumed`, and the R2 Result readback
digest matched the final HTTP body and the APP's saved bytes.

| Material | Bytes | SHA-256 (base64url) |
|---|---:|---|
| APP Presentation and submitted Presentation | 4,242 | `VudBZ254JU8xrsbAFhYNLaZazRMfzluF9um9GjwVozM` |
| Final HTTP body and APP `result-exact.bin` | 3,179 | `YzHTnJSQcnvBjfHr9ZttSM53PPPBxgYqGouESxwjfVk` |
| Queue execution receipt | 987 | `Ogc_6fBKf0pQWbDfltNkI6m2fEWTU_sT3h2vSsvd30w` |

**Replay and independent inputs.** The real candidate reproduced a replay
collector bug before HTTP. Complete and Sparse Result JSON uses `device_id`,
while the collector and its fixture incorrectly used Rust's internal
`canonical_device_id`. The corrected [collector](scripts/collect-replay-observation.mjs)
performed one read-only POST. The WEB returned HTTP 409 with a 539-byte body
whose stored-proof fields matched the same single DB row. The read-only DB
snapshot was byte-for-byte unchanged. This is an unsigned observation.
The six local independent inputs were the authenticated user from actual
Supabase Auth, the non-revoked device read from PostgreSQL, the configured Notary
registry checked against Notary's public export, the separately configured
Session and Binding Authority registries, and the disposable origin trust anchor.

**Finalization.** The standalone CLI verified the receipt against independently
prepared Queue execution trust with `SIGNATURE_AND_EXACT_BYTES_VERIFIED`. The
unchanged finalizer rejected the Complete candidate at `device_authentication`
with `Ed25519 signature: invalid strict base64url`. The exact APP authentication
and possession proofs each carry a canonical padded standard Base64 signature.
An independent Ed25519 check using the DB public key accepted both original
signatures and rejected both one-byte mutations. The current finalizer requires
the exact captured authentication request. Changing the signature representation
in the candidate or supplying a modified request as material would violate that
requirement.

Two further contract differences were identified by comparing the unchanged
inputs with the code. They have not been reached in the full finalization run.
PostgreSQL's unsigned stored-proof timestamp carries microseconds and a numeric
UTC offset, and APP provenance carries nanoseconds with a numeric UTC offset.
Both are checked by a millisecond-only parser. The exact multi-origin Worker
health observation carries matching Inventory and Target Approval digests.
The health verifier still expects the single-origin `server_identity` and
`profile_sha256` fields. Any future contract fix should keep signed timestamp
formats, exact-byte binding, the single-origin checks where applicable, and
independent verification of the selected origin and profile.

No 19-role Bundle was published and normal verification of a published Bundle
could not run. The unchanged CLI rejected all three controls with no output
directory: missing `device_identity`, a changed receipt signature with updated
candidate descriptors, and a whitespace change to the exact outer Result with
updated descriptors. The replay collector suite passed 11/11, including rejection
of the internal Rust field without any HTTP request. The Verifier library passed
156/156 and its CLI passed 6/6. The candidate workflow already selects the
replay collector suite. Hosted CI for this worktree remains `NOT_CHECKED`.

The APP exited successfully on SIGINT and the isolated PAC returned to mode
`none` with an empty URL. The test containers, internal network, DB volume,
listeners and temporary inputs were removed. Stage A/B/C and Production
acceptance remain `BLOCKED`.

## Native APP receives a local Queue execution receipt and offline verification passes — 2026-11-25

**LOCAL_APP_QUEUE_RECEIPT_VERIFIED:** From the candidate worktree at
`0dd7a8e92d3ad90b7fc6a9865741c9273266534c`, the native Linux APP submitted one
Complete Presentation after one HTTP 200 exchange with the disposable HTTPS
origin `capture.fusou.internal`. Open KanColle was off. The origin captured a
121-byte request and a 417-byte response. The transcript matched the origin's
recorded bytes, with no added correlation header or Cookie.

The isolated runtime used a fresh Supabase Auth user and registered device,
production-role Verification Worker with the local Miniflare Queue and R2,
the dedicated WEB server bundle, Runtime Config/Freshness and a same-host
operational-feature Notary. The network was internal with isolated gateway
mode and no published container ports. The disposable Worker bundle selected
only the local CA for the two Complete origin certificate checks. The stock
WASM trust path rejected the same Presentation with
`certificate_path_invalid`. The APP had verified the runtime prerequisites
and showed `Overall: ready` before sending. Both the Worker reference
and the new Session had at least 120 seconds remaining.

**Delivery and storage.** The first submission was HTTP 202, with one actual
Queue delivery. The APP polled the same job twice, receiving HTTP 202 and
HTTP 200 with `verified=true`. The authoritative record was `consumed`
with an empty Queue backlog. The signed execution receipt matched the
observed job `60c6e5f4-4267-4c74-8a0e-7fc8bee074ce` and the Durable Object's
attempt `94da004c-e7c9-463b-8f87-5758cdef951e`. The Result and consume-receipt
signatures and their Session, device, binding and transcript checks passed.
The disposable DB contained exactly one matching possession-proof row for
this Session and replay digest. An extra read-only status query to the same
job returned the same exact Result and receipt header. No additional proof
submission, Queue delivery, or origin exchange was observed.

| Material | Bytes | SHA-256 (base64url) |
|---|---:|---|
| APP Presentation, submitted proof and R2 Presentation archive | 4,021 | `55zZZAqLc_blJECAGX3ebXMBUjQ0Hg9gvOTgvrVGkBk` |
| Final status body, R2 Result archive and APP Result files | 3,114 | `hf3JLP7aXGZ7zJOJPIzuhJ7RyNN9eL2ASSfeMm4ZuUk` |
| APP execution receipt decoded from the 1,316-byte HTTP header | 987 | `cLwd8oiGm8sL06z5V-99Pwf6uSDRTHOI_l840wcL4CM` |
| Queue execution trust policy generated from test configuration before capture | | `S4TEMtJf-yJBJl3hH6ItnVwseexMoNHCPXKC5_F89e8` |

**Independent verification.** The Node candidate identity verifier accepted
`yu4RQ2JGM6GNHVMiRb3t7wFXjbAtlg0Q9hVpb07dCPc`. All 22 local descriptors
matched the files they described. The candidate recorded
`CAPTURED_PENDING_OFFLINE_VERIFICATION`, `CAPTURED` for the receipt and
`UNAPPROVED` for approval. The Rust
`verify_fusou_tlsn_evidence --verify-queue-execution-receipt` entry accepted
the saved directory and the separate test trust policy with
`SIGNATURE_AND_EXACT_BYTES_VERIFIED`. It rejected a mismatched Worker version
pin, a changed receipt attempt ID, and a trailing byte added to the Result
body. The two file changes were tested after rebuilding the candidate's
affected descriptor and top-level digests. The changed attempt also had
its saved header rebuilt.

The APP displayed `Latest capture state: result_ready`. The separate
next-capture readiness issue also reproduced. The same authentication
nonce caused seven HTTP 409 `device_nonce_replayed` responses while the
APP queued another Session. A second Session was eventually issued. No
second capture was sent.

The APP and normal-feature debug Notary were rebuilt with Rust 1.98.1,
`--locked --offline`. APP SHA-256 was
`83366e84e0c96f24aa9b16428b17b4a056ba124057fa74bf166fd69f9a8ff6ea` and
Notary SHA-256 was
`dbdc16b5eeb1a8251e66f56379e7412c1111f1920566495a1e0a490c18429f19`.
The test reused the existing generated WEB testplay server bundle and
existing verifier WASM. It did not redo their builds or WASM provenance.
Node was 22.16.0 and the Runtime Config harness used Miniflare
5.20261113.0-beta. On SIGINT, the APP exited with code 0 and the same D-Bus
session read back PAC `mode=none` and an empty URL. The disposable services,
DB volume, listeners and private work files were removed.

This run established the receipt gate on the local APP path. It did not
assemble the live capture's strict 19-role Evidence Bundle or observe
remote delivery. Production issuer/policy approval, deployment, Hosted CI
and real gameplay remain unverified. Stage A/B/C and Production acceptance
remain `BLOCKED`. The next Evidence verification is the same isolated
capture with the read-only replay observation and independently sourced
materials, followed by strict finalization and ordinary Bundle verification.

## Production Queue execution receipt source and local verification — 2026-11-25

**SOURCE_IMPLEMENTED / LOCAL_TEST_VERIFIED:** The Production-role Queue
consumer signs a detached execution receipt with a dedicated Ed25519 key.
It binds the exact Presentation and outer Result body to the job, attempt,
profile, signing time, deployment, Worker runtime version, source SHA and
signer identity. The existing authority transaction stores those bytes with
the Result and archive catalog. Authenticated status uses the committed
receipt bytes in the existing header. Queue submission requires a working
receipt signer before auth or proof handling. A missing signer on an
in-flight job causes Queue retry. The consumer checks existing terminal
Results through the normal authoritative readback.

The status and capture paths were tested with local HTTP and synthetic
keys. The Proxy saved the receipt header, decoded receipt and exact outer
Result, and the independent Rust verifier checked the saved directory with
a separately supplied trust pin. The Worker and Rust verified the same
signature vector. The Queue receipt finalization regression finalized,
published and verified a synthetic 19-role Bundle. The same test rejected
an absent independent pin and a changed attempt ID even after refreshing
the candidate's local digest inventory. Prior Canary and earlier Bundle
contracts retain their established checks.

A network-disabled Miniflare smoke used the real Worker entrypoint and
local Queue binding. Health and an unauthenticated initial POST returned
200 and 401 with the configured receipt key. Removing the private key
returned 503 at health and 503 `queue_execution_receipt_unconfigured` on
initial POST, before authentication. This smoke did not submit a job.
The positive worker-to-Rust vector, Proxy archive test and synthetic full
Bundle test exercised the receipt and persistence boundaries locally.
The previous native APP and Queue run captured a Result before receipt
issuance was implemented.

Worker typecheck, three signer contract tests on Node 22.16.0, 13 Proxy
Result-binding tests, and 156 Verifier library and six CLI tests passed.
The receipt-only CLI also accepted a signed fixture and rejected the same
candidate under a mismatched source pin.

**OPEN:** The independent signer approval, public policy registration
and revocation rules require operator records. The subsequent native
APP and Queue receipt test is recorded above. Hosted CI on this worktree,
deployed Production receipt
issuance, accepted Evidence, and full-Bundle delivery remain unverified.
Stage A/B/C and Production acceptance remain `BLOCKED`. The observed
same-nonce wait before another capture remains open.

The policy fields and command are in the
[Evidence operator runbook](../FUSOU-TLSN-VERIFICATION-WORKER/docs/production-evidence-operator-runbook.md#production-queue-execution-receipt).

## Native Linux APP through the local Queue consumer — 2026-11-25

**LOCAL_TEST_VERIFIED:** The native APP sent one Complete Presentation.
The actual Worker entrypoint queued it, the local Miniflare Queue delivered
it once, and the consumer performed WASM verification, signed the Result,
archived the Presentation and Result in R2, and committed the Binding
Authority Durable Object to `consumed`. The APP verified the signed Result
and wrote its exact bytes. This run covers local Queue delivery with test
trust material.

The branch was `tlsn-first-testplay-candidate` at
`0dd7a8e92d3ad90b7fc6a9865741c9273266534c`, using the existing worktree
changes. The native APP and normal-feature Notary were built with Rust
1.98.1 and `--locked --offline`. APP SHA-256 was
`c0ec39e934dad9c5280e84bf3166221a6139a4b08364653c7b44063a66ec651e`.
The debug Notary build used `operational-notary` without fault injection
and its SHA-256 was
`9520794e9e773dae5eac4bf52ffa922f7d2b8bfb6e259b0ea91a586b2d0f8f35`.
Node was 22.16.0 and the Runtime Config harness used Miniflare
5.20261113.0-beta. The Worker used the existing WASM artifact with SHA-256
`Ed3uMoEPsadNDEEd-pLKziOmPDM-jz7h3QZe0tvKoWg` (base64url).
WASM provenance was not regenerated in this run.

The Docker network was internal with isolated gateway mode and no
published container ports. The initializer's API/DB relays listened on
host loopback. The local Supabase stack applied all 25 migrations through
the existing historical-schema initializer. The APP ran in a disposable
Xvfb/D-Bus desktop. The full WEB build failed during static-page
prerendering after emitting the generated server bundle. The dedicated WEB
was run from that bundle. Its unauthenticated proof POST returned 401 and
the real authenticated device and possession proof handlers completed the
capture flow. The prerender log recorded an unsuccessful Cloudflare
metadata DNS lookup. This run does not verify a complete WEB build or all
DNS activity. The runtime Wrangler process was started with
`CLOUDFLARE_CF_FETCH_ENABLED=false`.

**Trust boundary:** The Worker reported its Production role, Queue mode and
`trust_contract_valid=true` for local test keys, inventory and approvals.
Only the disposable bundle redirected the two Complete WASM certificate
checks to the existing custom-root functions, pinned to the generated CA
and `capture.fusou.internal`. This allowed a positive local roundtrip with
the dummy origin. The default WASM trust path independently rejected the
very same Presentation with `certificate_path_invalid`. No production
source, deployment, trust store, or approvals were changed. The APP's
Open KanColle option was off. No game or actual Game Server was used.

| Boundary | Observation |
|---|---|
| APP preparation | `Overall: ready`, signed Manifest and five artifacts, Freshness, health and Session HTTP 201. The Manifest had over 120 seconds of Worker-reference validity at send time. |
| Origin | One 121-byte POST to the dummy HTTPS service, one HTTP 200 with a 417-byte response. No correlation header or Cookie. The authenticated transcript matched the recorded bytes. |
| Worker and Queue | `/verify/tlsn` POST once, HTTP 202. The APP polled the same job twice, HTTP 202 then HTTP 200 with `verified=true`. Actual Queue delivery was recorded once, with `attempts=1`, and backlog was zero after completion. |
| Authority and APP Result | DO `consumed`. The Result and consume-receipt signatures and Session, device, binding, Presentation, and transcript comparisons passed. APP showed `Latest capture state: result_ready`. |
| Candidate | Existing Node identity validation passed. All 20 artifact descriptors matched their actual lengths and digests, including `result-exact.bin`. Candidate remained `INCOMPLETE_MISSING_EXECUTION_RECEIPT` and `UNAPPROVED`. |

The observed job was `a612337c-029e-421a-8f53-b93ca4bbc5d7`. R2 archive
readback was checked both through its indexed key/digest and by direct
byte comparison with the APP files. The transient input object is cleaned
up after commit, so the Presentation comparison used its retained
attempt archive.

| Exact material | Bytes | SHA-256 (base64url) |
|---|---:|---|
| APP Presentation, submitted proof and R2 Presentation archive | 4,020 | `SyoxkKS0RGvppBMwwH6IQeFePYttS4XVF0z-Z0CYjTA` |
| Final status HTTP body, R2 Result archive and both APP Result files | 3,114 | `gv9ZPoNPWXC-iRVXkxwTzhguwZN07Ng0w_OIVJvYouc` |

**Next-capture readiness observed:** After the first Result was saved, the
APP automatically attempted to prepare another Session. In the sampled
window it received six HTTP 409 `device_nonce_replayed` responses while
sending the first Session's authentication nonce. At the next
300-second challenge bucket, the same device used a different nonce
and automatically obtained a second Session (HTTP 201), about 86 seconds
after the first Session. The DB had two authentication consumptions and
one possession consumption for this device. No second capture was sent.
Review how the APP schedules the next preparation and reports this wait
before testing consecutive captures. Preserve the replay rejection.

Worker typecheck and the focused execution-mode, Queue policy and
Production Result contract tests passed 12/12. On SIGINT the APP exited
with code 0 and the same D-Bus session reported PAC `mode=none` with an
empty URL. The task-owned containers, DB volume, network, loopback relays
and private scratch data were removed.

The serving Worker currently issues a formal verifier execution receipt
only on its Canary path. The Production-role Queue Result and its signed
consume receipt therefore leave the capture incomplete at the existing
Evidence gate. Hosted CI for this worktree, deployed execution, formal
Queue execution receipt and accepted Evidence remain unverified. Stage
A/B/C and Production acceptance remain blocked.

## Local Linux APP same-job Result recovery and candidate persistence — 2026-11-25

**LOCAL_APP_RESULT_VERIFIED:** On branch `tlsn-first-testplay-candidate`,
the native Linux APP was built from the permitted worktree at
`0dd7a8e92d3ad90b7fc6a9865741c9273266534c` with the candidate-writer fix,
Rust/Cargo 1.98.1, `--locked --offline`, and
`tlsn-production,custom-protocol`. The resulting APP SHA-256 was
`c0d7e63dcd27f21da6fe5dde6912a458e361a5414b59b5f373e485b028f4ef5f`.
The local Notary used the normal `operational-notary` feature without fault
injection (debug build, SHA-256
`2358c4a06252594d288253eb50523512d2a2fdd4ea04d92d8b7b74ac8b0b1a91`).
The test used an Xvfb/D-Bus Linux session, a Docker internal isolated network
without published host ports, and a fresh Supabase Auth/DB stack initialized
with 25 existing migrations after the historical-schema initializer. The
APP's Open KanColle switch was off. The only origin was
`capture.fusou.internal`, a dummy HTTPS service on the isolated network.

APP startup verified Runtime Config, its five artifacts, Freshness and
Worker health. The real local Verification Worker issued a fresh Session
with HTTP 201 through the dedicated WEB and local Supabase Auth. The screen
showed `Overall: ready`, and the accepted Manifest digest was checked just
before the single dummy request, with over 120 seconds remaining for both
Worker reference freshness and the Session. The origin received one
121-byte request without a correlation header or Cookie and returned one
421-byte response (HTTP 200). The local verifier verified the Notary
signature, the fixture CA, the Session grant and acceptance, and the
request/response transcript against the origin's recorded bytes.

The test-only Result endpoint verified APP possession proof and the exact
Presentation with the existing local WASM verifier, then signed the Result
and consume receipt with local test keys. It returned
`503 queue_enqueue_unconfirmed` for the single initial `/verify/tlsn` POST.
The APP polled the same job `cd5138d7-e349-4be0-8dc4-dbf6b632f5c9` twice,
receiving HTTP 202 then HTTP 200. The test recorded no repeated proof
submission or origin send. The final screen showed
`Latest capture state: result_ready`.

| Checked material | Exact bytes | SHA-256 (base64url) |
|---|---:|---|
| APP Presentation and submitted proof | 4,308 | `H1YVPbL6E3ByaZWZStu9XlK5iEJXihN-5dFrhMeQ7mU` |
| Final status response, `result-exact.bin`, and APP local Result delivery | 3,120 | `PBllBr9NCqBep9FaOkwh1EqcKFRPqQUEPItI6mu3z-s` |

The APP wrote the candidate and all 20 inventory entries matched their
actual lengths and digests. The existing Node
`assertCandidateArtifactIdentity` verified the APP's exact identity,
metadata and Presentation bytes against candidate ID
`lCtIiJZJ62lmi-LL3MFyeLjb6UVmQ_sQP26FkQzBruA`.
The candidate is `INCOMPLETE_MISSING_EXECUTION_RECEIPT` and
`UNAPPROVED`, with gameplay/readiness effects `NONE`. The inventory
check covers local candidate files. The 19-role Evidence Bundle has its
own independent inputs and finalizer.

**Defect reproduced and fixed:** An initial fixture error returned 502
after a valid Presentation. After fixing the fixture, a separate Session
demonstrated that the unmodified writer accepted the signed Result but
rejected the APP's v3 public configuration fingerprint and removed the
incomplete candidate directory. The Rust writer now reads the shared
fingerprint contract, recomputes its combined digest and emits the
current v2 candidate identity with separate original and authenticated
request digests. The third capture used the fixed build, a fresh device
and Session, and one new dummy origin request. The prior proof requests
were not retried. The local startup scripts also honor supplied test root
keys, call the existing test bootstrap RPC and accurately report the
Wrangler metadata-fetch setting. The live Wrangler process had
`CLOUDFLARE_CF_FETCH_ENABLED=false`. A full DNS trace was not collected.

**Regression and cleanup:** The Proxy `real_tlsn::tests::` suite passed
48 tests with one existing ignored case. The candidate-writer regression
checks a Node-derived candidate ID and rejects malformed or inconsistent
fingerprints. The candidate workflow explicitly selects it. APP Node
pre-capture readiness passed 12 tests. The APP exited normally on SIGINT
and PAC readback in the same D-Bus session was `mode=none` with an empty
URL. The task's containers, DB volume, internal network and private
scratch data were removed.

The Result endpoint drove the APP recovery test without a real Queue
delivery or a formal execution receipt. Hosted CI for the worktree,
deployed Production verification, accepted Evidence and gameplay
authorization remain unverified. Stage A/B/C and Production acceptance
remain blocked. No game was launched and no real Game Server was used.

## Test-role local Trigger completion roundtrip — 2026-11-23

**VERIFIED (local test role only):** On branch `tlsn-first-testplay-candidate`
at HEAD `0dd7a8e92d3ad90b7fc6a9865741c9273266534c`, the existing dirty and
untracked worktree was preserved. The previously initialized internal-isolated
Supabase stack, dedicated WEB, and real Worker entrypoint at
`packages/FUSOU-TLSN-VERIFICATION-WORKER/src/index.ts` were reused. The local
Worker health response reported `environment=test`,
`deployment_role=test`, `binding_mode=random`, `auth_mode=supabase`, and
`device_auth_mode=external-endpoint`; `trust_contract_valid` was not present
for this test-role health response. This is not Production trust evidence.

The local Trigger executor used the Worker's task
`tlsn-local-verify`, the existing verification-job schemas, and
`internalRequestSignature`. It accepted the Worker request, fetched the
Presentation from local R2, compared its exact bytes and digest, and sent the
completion body with its HMAC. Trigger.dev was not contacted or configured.
The executor's private environment contained no Result signing key; it did
not create Results or execution receipts. The Worker ran with
`TLSN_EXECUTION_MODE=trigger`, the actual `TlsnBindingAuthorityDurableObject`,
and task-local Miniflare R2/SQLite state. Wrangler was `4.135.0`.

The local Auth users were non-anonymous and signed in through the dedicated
Supabase Auth. Each tested Session was issued by the Worker with HTTP 201 and
its Session receipt signature was verified. The Rust fixture independently
verified each fresh Session Context Grant against the pinned Session Authority
key, including Session, device, binding, challenge, and validity. Complete
Presentations were generated by the existing
`worker_session_grant_produces_independently_verified_complete_presentation`
fixture. Its normal release Notary binary was built from source
`46f11efede83d83a672614f7dc575f27a47f4120`, had SHA-256
`702a27898ec7908c8a3a6b37503bb68a24cdb5e1d6bb6d77ef72736245423fa3`, and
was the `operational-notary` release artifact (not a fault-injection Notary).
The test harness itself enables its existing
`local-test-notary-fault-injection` test feature; it does not change that
Notary binary. The fixture used Notary ID `synthetic-notary-v1`, key ID
`fixture-k256`, environment `local-test`, and an ephemeral loopback endpoint.
All fixture traffic used a local test origin with identity `game.example.test`,
not a real Game Server.

| Case | Session / job / attempt | Exact input SHA-256 (base64url), bytes | Completion | Status | Result objects under attempt prefix |
|---|---|---|---|---|---:|
| Positive | `b3e7f0fc-2ffa-4107-acde-54ddf5a53229` / `a2aec5ee-756a-4620-9be5-efaa1c5f7dda` / `2644d907-0435-416a-8b60-74fcf576f75f` | `T-P3422kTIhamPLsxXDIBKqz5KykKHAPl1gqquKFhbA`, 3,473 | HTTP 200 | HTTP 200, `verified=true` | 1 (2,645 bytes) |
| Invalid HMAC | `6ed20909-98bc-4a05-844a-b34695ed9b58` / `ac018752-9d33-4daa-ac56-8d4a2e2e083c` / `572437b8-2422-404b-963c-61678dc17645` | `LihAVUtLoaOYJ9_TrjTsErdbUgJMprmzkbtRUu3yBfk`, 3,475 | HTTP 401, `unauthorized` | HTTP 202, `verified=false` | 0 |
| Corrupted Presentation | `41a8c714-3e9a-45ae-8451-cef34fb0f6b0` / `7ef0ad5e-e5c0-4ce2-afd7-06dabb7d4693` / `07de826c-b4f7-4d54-9cb7-9002b9274727` | `EJEs7Qi-Y4-ZfvTD5HjTZfUgwQfmWwyAALfLCrAHTgw`, 3,475 | HTTP 422, `verification_failed` (valid HMAC) | HTTP 200, `verified=false`, `not_verified` | 0 |

For the positive Presentation, the Rust fixture independently verified the
Notary signature, Web PKI chain, grant, and exact Complete transcript. The
Presentation digest was the same `T-P3422...` value above; the request
transcript was 116 bytes with SHA-256
`gzYVao4vpETB5tCJVWvCCpXdGCBkAf7EUYoiKYVxwIM`; the response was 133 bytes
with SHA-256 `N0yEyvskourUXRQzHIc2OqQJzr_DJEui9usxOGweVcU`. The Worker Result
was Complete v2, profile
`fusou-require-info-v3-notary-session-binding`, profile SHA-256
`PM_SInpqWytwvYbRYo39aG7rPwqhL649MDKzTbEN3vE`, and outer-byte SHA-256
`1OVDG6NyGKjCPm4WkZQwhiDnQoA79gb8zeaPBJDD1_A` (base64url). The independent
verifier derived the Result signing bytes with the current verifier WASM and
verified the inner Ed25519 signature. It separately verified the
consume-receipt signature with the Binding Authority public key and confirmed
its nonce matched this Session. The Result's Presentation digest and transcript
metadata matched the independently verified Presentation.

After the positive completion, the same Trigger request was replayed and
rejected with HTTP 409; the local executor state was unchanged and still
showed one execution, one input fetch, and one initial completion request.
The exact signed completion body was also replayed; the Worker returned
HTTP 200 with `accepted=true`. A fresh authenticated status request after the
replay remained byte-identical to both the initially observed response and
the exact local R2 object. The attempt prefix still contained one Result
object. The status route only returns the authoritative Result after the
Durable Object reports the job `consumed`; no debug route was added.

For the invalid-HMAC job, the executor fetched the exact expected input once,
but the Worker rejected completion before commit. For the corrupted case, the
valid callback HMAC and exact R2 input digest were checked before the Worker
verification-complete path invoked `verifyPresentationToPreparedResult`;
the WASM verifier rejected the changed Presentation, the DO reached
`not_verified`, and no Result archive was created. The original valid
Presentation for that fresh grant was independently verified before the
client flipped its first byte. The corrupted input digest above matches the
Worker's fetched R2 bytes. The local R2 metadata query confirmed one Result
object for the positive attempt and zero for both rejection attempts.

One intermediate Session attempt using the same device within its 300-second
challenge bucket received the expected HTTP 409 `device_nonce_replayed`; no
Session was issued. The corrupted case then used a separately signed-in
non-anonymous test user and newly registered device, and received a fresh
Session. This expected anti-replay rejection is not counted as a Trigger job
or a Presentation test case.

**REPEATABLE LOCAL HARNESS:** The private executor and client are
`packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/local-trigger-test-harness.mjs`
and `packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/local-trigger-test-client.mjs`.
After recreating a private test config/env directory and local services, the
flow is below. Replace `RUN_DIR`, `SESSION_ID`, and `JOB_ID` with the
task-private paths and IDs returned by the preceding command; populate the
Cargo fixture's required `FUSOU_TEST_*` environment from the same private
config without printing it.

```sh
RUN_DIR=/path/to/private-run-dir
node --experimental-strip-types --env-file="$RUN_DIR/trigger.env" \
  packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/local-trigger-test-harness.mjs serve

FUSOU_LOCAL_TEST_RUN_DIR="$RUN_DIR" node --experimental-strip-types \
  packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/local-trigger-test-client.mjs issue-session
SESSION_ID=the-session-id-from-issue-session

cargo test --locked --offline \
  --manifest-path packages/FUSOU-PROXY/proxy-https/Cargo.toml \
  --test local_notary_interop \
  --features "local-test-notary-fault-injection operational-notary" \
  operational::worker_session_grant_produces_independently_verified_complete_presentation \
  -- --exact --nocapture

FUSOU_LOCAL_TEST_RUN_DIR="$RUN_DIR" \
FUSOU_LOCAL_SESSION_FILE="$RUN_DIR/sessions/$SESSION_ID.json" \
FUSOU_LOCAL_PRESENTATION_FILE="$RUN_DIR/presentation.bin" \
  node --experimental-strip-types \
  packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/local-trigger-test-client.mjs submit valid
JOB_ID=the-job-id-from-submit

node --experimental-strip-types --env-file="$RUN_DIR/trigger.env" \
  packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/local-trigger-test-harness.mjs replay-trigger "$JOB_ID"
node --experimental-strip-types --env-file="$RUN_DIR/trigger.env" \
  packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/local-trigger-test-harness.mjs replay-completion "$JOB_ID"
```

The Cargo fixture requires the `FUSOU_TEST_*` input/output paths and pinned
Session Authority public configuration, plus
`FUSOU_OPERATIONAL_NOTARY_BIN`; keep their values in a mode-0600 private
environment, not in this report. Use a fresh Worker Session for every
submission. The client also supports `submit invalid-hmac` and `submit corrupt`,
and `verify-outer <job-id>` for the exact Result/R2/signature checks.

**CHECKS:** Verification Worker `typecheck` passed. The focused
`device-proof-client.test.mjs`, `session-context-grant-contract-test.mjs`,
and `production-result-contract.test.mjs` run passed **35/35**, with 0
failures and 0 skips on Node `22.21.1` and pnpm `10.14.0`. The exact-HEAD
Worker WASM provenance check passed for
`0dd7a8e92d3ad90b7fc6a9865741c9273266534c` using Rust/Cargo `1.98.1`,
wasm-pack `0.15.1`, wasm-bindgen `0.2.128`, and wasm-opt `133`. The Rust
Presentation fixture passed **3/3** invocations (one test each; 13 other
tests filtered per invocation). `node --check` passed for both local Trigger
scripts. Rust emitted only existing unused-function warnings. Two earlier
provenance invocations were blocked by the default PATH/toolchain selection;
no tool was installed or changed, and the final check passed with the retained
pinned tools on PATH and `RUSTUP_TOOLCHAIN=1.98.1`.

**CLEANUP VERIFIED:** The Trigger executor, Worker, WEB, and Supabase host
relay were stopped. Supabase project `fusou-tlsn-testplay-supabase-iIeq0u`
was verified as the only target stack for this run; its containers and DB
volume were removed, as were its owner-labeled internal network and relay
container. The private run directory, test credentials, Worker R2/DO state,
and Supabase work directory were deleted. No listeners remained on the
Worker, WEB, relay API/DB, or Trigger ports. Other Supabase work directories
were not touched.

This proves only the local test-role Trigger roundtrip and test Result
signature. Production acceptance remains **BLOCKED**. Production execution
infrastructure, a formal execution receipt, accepted Evidence, APP Result
receipt, and hosted CI were **NOT_CHECKED** in this run. No real Game Server,
Cloudflare deployment, or Trigger.dev service was contacted; no files were
staged, committed, or pushed.

## Isolated real-APP Complete Presentation — 2026-11-23

**VERIFIED (local Complete Presentation only; not Result, Evidence, or
Production acceptance):** On `tlsn-first-testplay-candidate` at HEAD
`0dd7a8e92d3ad90b7fc6a9865741c9273266534c`, the existing dirty and untracked
worktree was preserved. The run reused the isolated Linux APP binary; its
SHA-256 was
`7f9d5e5c461bc5fd970d5ed9c0d2c38f8ee60850b7404a0a9bf1941b84771011`.
`--tlsn-compiled-bootstrap` reported the same source SHA, release profile,
`tlsn-production` and `custom-protocol`, the local Runtime Config Manifest
URL, and key ID `local-test-manifest-root`. The compile-only bootstrap status
was `EMBEDDED_UNVERIFIED`; runtime readiness had separately verified the
local signed configuration. The compiled public-configuration digest was
`WbNV4im41_JTZ4no8iw1u0MEax7goZtBOnCkaVvI1i0`.

The normal release `fusou-notary` was built from the task-local isolated source
copy's `packages/FUSOU-PROXY/proxy-https` source. Its SHA-256 was
`4491785308fb9484da323279e0436b0937bb8a543f4ab35a0e90bdd0d83244e7`; its
Cargo fingerprint enabled `operational-notary` and did not enable
fault-injection. The independently exported public configuration matched the
prepared pins: `environment=production`, `wire_version=1`, endpoint/listen
`127.0.0.1:47047`. A new task-local ledger was initialized before serving.
The APP, Notary, dummy origin, and one-shot client used the internal-isolated
Docker network; only `capture.fusou.internal` resolved to the dummy origin.
No real Game Server, production Worker, or Cloudflare deployment was used.

The APP Start/readiness path had reached **Overall: ready** with Run Proxy
Server on and Open KanColle off. The Worker observer recorded Session issuance
HTTP 201 at `2026-11-23T19:23:44.659Z` and another HTTP 201 at
`2026-11-23T19:25:46.033Z`. The capture metadata Session ID selected the first
response; the independent verifier matched its exact `session_context_grant`
bytes to the grant embedded in the Presentation. No grant bytes or credentials
were written to this report.

One HTTP/1.1 `POST
https://capture.fusou.internal/kcsapi/api_get_member/require_info` with an
empty body was sent through the APP proxy. The dummy origin recorded exactly
one 121-byte request
(`14bf5f96615492f97781edfe7f0fe7daea26ecf0764f92ed4d478809d7bc9cd9`) and
the exact 133-byte response fixture
(`374c84cafb24a2ead45d14331c87363aa409cebfc3244ba2f6eb31386c1e55c`). The
client received HTTP 200 and the expected 75-byte body. The recorded request
had no query, body, Cookie, or `X-Attestation-Binding` correlation header.
The APP artifact and private helper capture were byte-identical:
4,275-byte Presentation, SHA-256
`badba34d92cc78d9cf3966e122ea103152c2e3854f71729426a4b2aa01a221a3`.

A temporary, task-local verifier test in the isolated source copy passed **1/1**
using the existing APIs from
[local_notary_interop.rs](../FUSOU-PROXY/proxy-https/tests/local_notary_interop.rs):
`verify_alpha15_presentation_with_trusted_notary_key_and_trust_anchor` and
`verify_require_info_with_session_extension`. It validated the trusted
Notary signature and CA chain, observed identity
`capture.fusou.internal`, Session Authority grant signature and exact grant
match, and Notary acceptance. Reconstructed Complete request/response
transcripts matched the origin's exact recorded bytes, lengths, and hashes.
They were 121 and 133 bytes respectively, with the digests above. The only
compiler diagnostic was the existing unused-function warning in the verifier
library; the test had 0 failures.

The APP's single `/verify/tlsn` submission was forwarded without response
replacement, and the real local Worker returned **HTTP 503**:
`TLSN verification Trigger is unavailable` (`trigger_unconfigured`). Thus
there is no verified Result, accepted Evidence, or Production Result from this
run; those remain **BLOCKED**. The success boundary is the independently
verified Complete Presentation only.

**CLEANUP VERIFIED:** After recording the capture, the APP received SIGINT and
exited. PAC read back over the same D-Bus session as `mode=none` and an empty
`autoconfig-url`. The Notary exited; task-owned containers, Supabase volume,
internal network, D-Bus/Xvfb processes, and listeners were stopped/removed.
No game launch, game-target DNS/TCP/HTTP, `/verify/tlsn` retry, second origin
request, or Presentation retry was performed. Hosted CI and Production
acceptance remain **BLOCKED**.

## Linux PAC shutdown reproduction — disposable GNOME/Xvfb — 2026-11-23

**OBSERVED (local APP only; no product change):** On branch
`tlsn-first-testplay-candidate` at HEAD
`0dd7a8e92d3ad90b7fc6a9865741c9273266534c`, the three shutdown paths were
compared in fresh APP processes with PAC active. The reusable Linux binary has
SHA-256
`b311ece43cc938fbf47a42c96fdd1fee8e499bd153abe17462aa71e29f183043` and came
from source commit `4b402486bce85d31cd2c7c8e19ca3f6954e130cf`. The tracked
`packages/FUSOU-APP` tree matches current HEAD, but this was not a fresh build
of the entire current monorepo; no broader build-input parity is claimed.

The disposable Ubuntu 24.04 container used Xvfb `:177`, GNOME Shell 46.0 /
Mutter 46.2, a private D-Bus session, and a task-only home directory. Every
APP container used Docker `network=none`; the final container had only `lo`
and no IP routes. Open KanColle was off, and no game WebView or external
browser was opened. Google Fonts names were pinned to loopback; a startup
period-tag request to `fusou.dev` failed closed in the no-network container.
No game, Notary, or external endpoint could be reached. The APP's generated
test CA was installed and checked only inside the disposable containers
because `pkexec` was unavailable; the host trust store was not changed.

Each case began with GNOME PAC `mode=none` and
`autoconfig-url=http://pac-shutdown-test.invalid:8123/previous.pac`. After
Start, Run Proxy Server was on and Open KanColle was off; PAC read back as
`mode=auto` and the generated local URL:

| Operation | Start and active PAC | Result |
|---|---|---|
| Main-window Alt+F4 | Start at `16:11:21.267 UTC`; APP host PID `675434`; proxy `127.0.0.1:46485`; PAC `http://localhost:43329/proxy.pac` | The normal WM close hid the main window, but the APP and tray remained alive. There was no exit code/signal or PAC-cleanup event; mode and URL remained `auto` and the same local PAC URL. The keypress was not separately timestamped; it occurred after Start and before a tray Quit at `16:13:21.463 UTC`, which then restored the original PAC pair. |
| Tray Quit, fresh process | Start at `16:14:27.852 UTC`; APP host PID `691807`; proxy `127.0.0.1:46601`; PAC `http://localhost:34937/proxy.pac` | `PacCleanedExit` was logged at `16:14:43 UTC` after cleanup; the APP exited with code 0 by `16:14:47 UTC`. PAC returned to `mode=none` and the exact original `.invalid` URL; the recovery state file was absent. |
| PTY Ctrl+C, fresh process | Start at `16:16:14.854 UTC`; APP PID `904` in its disposable container; proxy `127.0.0.1:35165`; PAC `http://localhost:39147/proxy.pac` | The PTY delivered `\x03` at about `16:16:29 UTC`; the APP logged `Received Ctrl+C, shutting down.`, ran its existing cleanup, and exited with status 0 (`docker exec` status 0). The container supervisor remained alive until cleanup. PAC returned to the exact original pair and the recovery state file was absent. |

No valid operation emitted `BadDrawable`. The earlier incident's exact window,
operation, emitter, and timestamp remain **UNKNOWN**; the current tests do not
reproduce it. A separate diagnostic used `xdotool windowclose`, which destroys
an X11 window instead of requesting a normal WM close. Before PAC was applied,
that invalid probe emitted GDK/GLib warnings at
`2026-11-23T16:02:47.900`; it is excluded and did not establish the cause of
the earlier `BadDrawable`.

The results match the existing behavior in
[window_event.rs](../FUSOU-APP/src-tauri/src/builder_setup/window_event.rs):
closing the `main` window hides it and prevents close, so the APP continues in
the tray and keeps its PAC active. Tray Quit and Ctrl+C use the existing
PAC-cleanup-before-shutdown path in
[setup.rs](../FUSOU-APP/src-tauri/src/builder_setup/setup.rs) and
[native_cmd.rs](../FUSOU-APP/src-tauri/src/cmd/native_cmd.rs). Thus Alt+F4
explains an apparently closed main window with PAC still active, but cannot be
attributed to the prior incident without its missing operation trace. Tray
Quit and Ctrl+C both restored PAC in actual APP runs. No product fix was
justified; no source behavior changed, so repository test suites and tray
Restart were not run.

**CLEANUP VERIFIED:** No manual PAC restoration was performed. The final PAC
pair was read back as `none` plus the original `.invalid` URL before stopping
the private D-Bus session. The three
task containers, GNOME/Xvfb/D-Bus processes, and
`/tmp/fusou-pac-shutdown-repro-20261124` were removed; the Xvfb socket and
named containers were absent afterward. The regular user's PAC, CA, and
roaming settings were not changed. TLSN capture, Notary, Presentation,
`/verify/tlsn`, gameplay, Hosted CI, and Production acceptance remain
**NOT_CHECKED** by this PAC-only reproduction.

## Isolated Docker APP start and capture-readiness — 2026-11-23

**LOCAL_APP_CAPTURE_READINESS_VERIFIED (container-only; not a capture):**
On branch `tlsn-first-testplay-candidate` at HEAD
`0dd7a8e92d3ad90b7fc6a9865741c9273266534c`, the existing dirty and untracked
worktree was preserved. This retry reused the previously built isolated
`/usr/bin/fusou`; it did not rebuild or install the APP. The binary's
`--tlsn-compiled-bootstrap` output reported the matching source SHA, `release`
profile, `tlsn-production` and `custom-protocol` enabled, and
`https://runtime-config.fusou.test/tlsn/runtime-config/v2/manifest.json` with
signer key ID `local-test-manifest-root`. Its public-key fingerprint matched
the local Runtime Config fixture. The compile-only summary reports
`EMBEDDED_UNVERIFIED` / `UNVERIFIED`; only the subsequent runtime checks below
establish that the local Manifest and Freshness were verified. The
`--app-compiled-public-configuration` diagnostic returned digest
`WbNV4im41_JTZ4no8iw1u0MEax7goZtBOnCkaVvI1i0`; no token or private key was
printed.

The local Runtime Config report at `2026-11-23T12:03:15.996Z` had
`contract_status=VERIFIED`: Manifest HTTP 200, 4,033 bytes, exact-byte match,
and SHA-256 `iBuj_0ZSpXuQf0mWbubUe3Rn14DCqXFryuf2gVjQscI`. All five artifacts
returned HTTP 200 and matched their pinned lengths/digests:

| Artifact | Length | SHA-256 (base64url) |
|---|---:|---|
| `worker-reference` | 6,187 | `-65bE7wInGuzRcZVtUA-bkhLx-2LlPzZBUaWs6SrAUc` |
| `origin-inventory` | 1,876 | `oPGCXkdYTkTCfif4bmujVhtHP-vOSmF1CB8R6eo-XZ0` |
| `target-approval` | 899 | `LMq3_l4PVfOv1K3rKXVekG1N7VOOxn5rQBZRr-J7z78` |
| `security-registry-set` | 410 | `d9w0sv469ochAC8lN76DivSlPtZqNnyYccabL0qC_J8` |
| `result-registry-envelope` | 702 | `e_f_rHsFcvqGyFrqnlOHFKEw6F2RyG2J8gc8hjrkyVU` |

Freshness returned HTTP 200, verified its signature/release, and bound to the
Manifest digest. Worker `/health` returned HTTP 200 with
`worker_name=fusou-tlsn-verification-production`,
`deployment_id=runtime-readiness-20261123`, `deployment_role=production`,
`binding_mode=random`, and `trust_contract_valid=true`. The local harness
checked the health Git SHA, active version, security-registry/origin/approval
digests, Result registry and root, Session Authority, Notary, and Verifier
identities against the fixed public inputs before signing the Manifest. The
observed local version ID was
`3da9156b-0bfe-48c0-9359-96e04177fbb8`; these local version/deployment values
are not evidence of a Cloudflare deployment.

The first APP attempt exposed two disposable-environment setup issues: the
active APP device had no matching `user_devices` row (challenge requests
returned 404), and launching without a session D-Bus caused PAC application
readback to fail and roll back. Only the disposable PostgreSQL was repaired,
registering the active local Auth user's existing Ed25519 device. The
successful retry ran `dbus-run-session -- /usr/bin/fusou` in the isolated
desktop with `DISPLAY=:99`,
`FUSOU_TLSN_EXCHANGE_TIMEOUT_MS=120000`,
`FUSOU_TLSN_CLEANUP_TIMEOUT_MS=10000`, and
`FUSOU_TLSN_MAX_NOTARY_ATTESTATION_BYTES=1048576`. In the Start UI, Run Proxy
Server was on and Open KanColle was off; Open App displayed only the internal
data viewer. No game WebView was started.

The APP made one Worker `POST /attestation/session` in this retry and received
HTTP 201 at `2026-11-23T12:04:25.956Z`. The response's receipt and context
grant signatures were independently verified with the pinned local Session
Authority key and the existing `attestation_receipts.ts` signing-byte
contracts, not a key from the response. Receipt claims matched the active
local Auth user, device, authentication nonce, Session ID, binding, device
challenge, and expiry. The grant's signed bytes matched the same Session,
binding, device commitment, challenge, and timestamps; an unrelated Result
signing key failed both signature checks. The Session expired at
`2026-11-23T12:09:25.933Z`; the APP's readiness snapshot was confirmed at
12:05:30 local time, while the Session was still valid. The later signature
check establishes signature/claim integrity, not that the expired Session is
currently usable.

During the Session's lifetime, the private harness called the real
`DurableObjectBindingAuthority.lookupBinding`: HTTP 200, active record, with
the same Session ID, binding, user, device, authentication nonce, Session
nonce, challenge, creation time, and expiry. A same-Session PostgreSQL query
found exactly one active owner/key device row, one non-anonymous Auth user,
one matching `anon_sync_nonce_consumptions` row, and one matching
`tlsn_device_proof_consumptions` authentication row with `session_id IS NULL`.
There were zero authentication rows with a non-NULL Session ID and zero
possession-consumption rows for this Session. No possession proof was sent.

The APP's **Read current readiness** result was **Overall: ready**:
Proxy listener, PAC server/application, Runtime Config/Freshness, Worker
health, forwarder initialization, candidate evidence saving, Session grant,
and current capture readiness were all verified. The separate browser-PAC,
Notary connection, observed server identity, evidence, and gameplay checks
remained `not_checked`; `Current capture: ready` means preparation only.
The local readiness fixture permitted Worker paths `/health` and
`/attestation/session` only. No `/verify/tlsn`, Presentation generation, or
Result execution occurred.

The 1,190-packet APP capture stayed on the Docker network
`fusou-tlsn-testplay-supabase-4KCkmA` (`internal=true`, `172.20.0.0/16`):
all TCP SYN destinations were in that subnet, and zero outside IPv4/IPv6
packets were observed. There were zero DNS queries for a game target, zero
packets to the APP proxy listener or Notary port 7047, and zero game-target
TCP/HTTP traffic. The capture did include 96 DNS packets to Docker's
`127.0.0.11` resolver; 48 responses were `SERVFAIL` for
`fonts.googleapis.com` and its resolver-search-suffix variants. Therefore
this run does not claim that no DNS queries occurred.

After measurement, closing the APP stopped its process but left the isolated
PAC mode set to `auto`; the X11 client also reported `BadDrawable` during
window close. The disposable desktop's original `mode=none` and empty
`autoconfig-url` were restored manually in a new D-Bus session and verified.
This is a manual cleanup result, not evidence that APP shutdown automatically
restores PAC. The packet capture was stopped and flushed. After the evidence
was recorded, all ten task-owned containers (including the TCP relay), the
dedicated Supabase volume and internal network, and
`/tmp/fusou-tlsn-testplay-supabase-4KCkmA` were removed. Final checks found no
task containers, published container ports, Docker-proxy TCP listeners,
volume, network, or temporary work directory. The APP-only retry used Node
22.21.1, pnpm 10.14.0, Docker 29.10.0, Wrangler 4.135.0, and
PostgreSQL 17.12; the Runtime Config harness used Node 22.16.0 and Miniflare
5.20261113.0-beta. The disposable Supabase stack had been initialized with
Supabase CLI 3.2.0. No repository tests or APP rebuild were run in this
runtime-only retry.

**NOT_CHECKED / OUT_OF_SCOPE:** No Notary connection, possession proof,
Presentation, `/verify/tlsn`, Production Result, gameplay, or real Game Server
identity was exercised. The APP's `ready` snapshot is local preparation
evidence only. Hosted CI, real deployment, Stage A/B/C, and Production
acceptance remain **BLOCKED**.

## Runtime Config read-only delivery — local HTTPS verification

**LOCAL_RUNTIME_VERIFIED:** The [Freshness Gateway](../FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-GATEWAY/src/index.ts)
now serves `GET /tlsn/runtime-config/v2/manifest.json` and the five
content-addressed artifact kinds through its existing Signer Service Binding.
The [private Signer](../FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/src/private-signer-worker.ts)
reads the exact Manifest pointer bytes and bounded immutable artifact bytes from
the existing R2 binding; artifact responses require the stored-byte SHA-256 to
match the canonical digest in the path. Both Workers cap each object at
1,048,576 bytes. The Gateway constructs fixed internal paths and does not expose
R2 or Release-management routes.

The local HTTPS test origin was `https://gateway.fusou.test`. Against the
existing signed Release fixture, the [runtime integration test](../FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/scripts/runtime.test.mjs)
matched the pointer and all five artifacts byte-for-byte, including lengths and
SHA-256 digests. The same origin's existing Freshness POST returned a signed
response that passed the existing request/response verifier and exact Manifest
binding check. Instrumented GETs made six R2 reads, zero R2 writes/deletes,
zero signatures, and zero Genesis/Release-management requests; the test also
removed the DO binding during each private read. Wrong origin, unknown route or
kind, noncanonical digest, query, Range, disallowed method, missing binding or
object, oversized Manifest/artifact, and corrupted artifact all failed closed
without exposing private route or R2 details.

**LOCAL_TEST_VERIFIED:** Both package type-checks passed. The Gateway runtime
harness reported 12 PASS checks, 0 FAIL/SKIP. The Coordinator/private Signer
runtime suite reported 73 tests passed, 0 failed, 0 skipped. The local runtime
used Node 22.21.1, Miniflare 5.20261113.0-beta, and workerd 1.20261113.1. The
existing candidate workflow includes both packages' type-check and runtime
commands; Hosted CI for this change is **NOT_CHECKED**.

**NOT_CHECKED:** This synthetic local R2/Worker run does not establish a
Cloudflare deployment, production R2 contents, or APP acceptance. GET alone
does not establish Runtime Config authenticity or currentness; the APP must
still verify the signed Manifest/artifacts and the Freshness response.

Remaining before first play: dedicated WEB deployment; APP Bootstrap and
Notary registration/placement; and the Production Result execution path.
Production service health and authentication, Verification Worker-issued
Session issuance, game-server communication, and production evidence remain
unverified. Local WEB/Auth proof handling is recorded below. Stage A/B/C and
Production acceptance remain **BLOCKED**.

## Dedicated TLSN testplay WEB — local verification (2026-11-22)

**LOCAL_BUILD_VERIFIED:** The WEB package now has an isolated
[Astro config](../FUSOU-WEB/astro.config.tlsn-testplay.mjs),
[Wrangler config](../FUSOU-WEB/wrangler.tlsn-testplay.toml), and
`build:tlsn-testplay` entrypoint. The build accepts only an explicit
verification Supabase origin and exact single-host allowlist, disables dotenv
loading/process-environment injection, and rejects the regular WEB Worker,
route, or resource bindings. The normal `fusou` / `fusou.dev/*` configuration
was not changed.

The local build used only `http://127.0.0.1:54321` with allowlist
`127.0.0.1`. Astro generated the expected
`https://tlsn-web.fusou.dev` sitemap and
`dist-tlsn-testplay/server/wrangler.json`; a build-output guard checks the
generated Worker name, `entry.mjs`, exact route, assets path, and absence of
service, storage, queue, and workflow bindings. Wrangler's dry-run against
that generated config packaged `fusou-tlsn-testplay-web` for
`tlsn-web.fusou.dev/*`; it showed only `ASSETS` and the public site URL and
exited without uploading. The source TOML is an Astro build input; the
generated `server/wrangler.json` is the effective post-build Wrangler config.

**LOCAL_HTTP_VERIFIED:** The generated Worker ran with Wrangler's local mode
and no remote bindings. POSTs to both existing handlers returned HTTP 401
without a bearer token:

- `/api/auth/anonymous-sync/v2/device-proof`
- `/api/auth/anonymous-sync/v2/tlsn-device-proof`

**LOCAL_AUTH_HTTP_VERIFIED (2026-11-22):** The generated Worker was rebuilt
with the disposable Supabase API at `http://127.0.0.1:56421` and ran at
`http://127.0.0.1:56431`. Two non-anonymous test users were created and signed
in through the real local Supabase Auth API. A test Ed25519 device was
registered in the matching temporary Postgres database; all requests stayed on
loopback, and user tokens/private-key material were kept out of logs and files.

The first live run exposed a Worker-runtime incompatibility in the proof
handler's guarded Supabase fetch: Cloudflare Workers does not implement
`redirect: "error"` and throws a `TypeError` before sending the request. The
[proof handler](../FUSOU-WEB/src/server/routes/anonymous-sync-v2.ts) now uses
`redirect: "manual"` and explicitly rejects every 3xx response, preserving the
no-follow behavior. A regression test verifies that Auth redirects fail
closed without consuming a proof. This follows the
[Workers Request redirect contract](https://developers.cloudflare.com/workers/runtime-apis/request/).

Measured over the built WEB's real HTTP handlers and local Supabase:

- Both APIs returned HTTP 401 without a bearer token.
- `device-proof` returned HTTP 200 for a signed challenge from the owning user;
  the response user/device matched, one proof row and one nonce-consumption row
  were stored, and replay returned HTTP 409 without adding a row. A second
  user's token returned HTTP 403.
- `tlsn-device-proof` returned HTTP 200 for a valid signed proof; the response
  user/device matched and `replay_digest_hex` matched the independently
  computed digest. One proof row was stored; replay returned HTTP 409 without
  adding a row. A second user's token returned HTTP 403.
- After revoking a separate test device, the challenge endpoint and both proof
  APIs returned HTTP 409. No proof-consumption row was created for that device.

The possession `session_id` and `binding_value` above were test inputs only;
they were not issued by the Verification Worker and do not establish a real
Session or TLSN capture.

**LOCAL_TEST_VERIFIED:** `pnpm exec tsc --noEmit --pretty false` passed. The
four candidate proof test files passed **73/73**, 0 failed and 0 skipped, using
an isolated PostgreSQL 16.15 test instance. The build-profile regression suite
passed **5/5**. The dedicated build command passed; Astro reported 0 errors,
0 warnings, and 1 hint (the build also emitted non-blocking existing Vite
chunk/dynamic-import warnings). These test commands are selected by the
existing candidate workflow; that workflow was not run in this task.

The local run used Node 22.21.1, pnpm 10.14.0, Wrangler 4.135.0, Docker
29.10.0, Supabase CLI 3.2.0, and the Supabase database's PostgreSQL 17.12.
PostgreSQL 16.15 test binaries were downloaded and unpacked under a temporary
directory, not installed as a system service. Commands:

```sh
FUSOU_TLSN_TESTPLAY_SUPABASE_URL=http://127.0.0.1:56421 \
FUSOU_TLSN_TESTPLAY_SUPABASE_ALLOWED_HOSTS=127.0.0.1 \
pnpm --dir packages/FUSOU-WEB run build:tlsn-testplay

cd packages/FUSOU-WEB
pnpm exec tsc --noEmit --pretty false
pnpm exec vitest run \
  src/server/routes/__tests__/tlsn-device-proof.integration.test.ts \
  src/server/routes/__tests__/anonymous-sync-v2-endpoints.test.ts \
  src/server/routes/__tests__/anonymous-sync-v2.test.ts \
  src/server/schemas/__tests__/anonymous-sync-v2.test.ts
node --test scripts/tlsn-testplay-build-profile.test.mjs
```

The Vitest run set `FUSOU_TEST_PG_BIN`, `FUSOU_TEST_PG_SHARE`, and
`FUSOU_TEST_PSQL` to the temporary PostgreSQL 16.15 tools. Wrangler used
`dist-tlsn-testplay/server/wrangler.json`, `--local`, a mode-0600 temporary
runtime env file, and the loopback listener on port 56431. After verification,
the disposable Supabase containers/database volume/network, temporary
credentials and Wrangler state, and extracted PostgreSQL tools were removed;
the test ports were confirmed closed.

**NOT_CHECKED:** Hosted CI and Cloudflare deployment were not run. The planned
hostname was not registered or called; no Verification Worker-issued Session,
real Notary, game-server communication, or production Auth/DB behavior was
tested. These local HTTP results do not authorize a game connection.

For the Verification Worker deployment, retain the existing proof handlers
and configure:

```text
TLSN_CANDIDATE_DEVICE_AUTH_URL=https://tlsn-web.fusou.dev/api/auth/anonymous-sync/v2/device-proof
TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL=https://tlsn-web.fusou.dev/api/auth/anonymous-sync/v2/tlsn-device-proof
TLSN_CANDIDATE_DEVICE_AUTH_ALLOWED_HOSTS=tlsn-web.fusou.dev
TLSN_CANDIDATE_SUPABASE_URL=<the same verification-only Supabase used by the WEB>
TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS=<that Supabase host only>
```

No Supabase address or deployed value is asserted here. Before first play,
the dedicated WEB and matching verification Supabase Auth/DB still need
approved deployment and registration; APP Bootstrap and Notary registration,
and the Production Result execution path, also remain outstanding. Stage A/B/C
and Production acceptance remain **BLOCKED**.

## Verification Worker-issued Session and WEB possession proof — local integrated verification (2026-11-22)

**LOCAL_SESSION_FLOW_VERIFIED:** From the built TLSN-only WEB and disposable
Supabase stack above, the actual Verification Worker entrypoint handled
`POST /attestation/session` in Wrangler's local Workers runtime with
`TLSN_ENVIRONMENT=test` and the real `TlsnBindingAuthorityDurableObject`
bound through `TLSN_BINDINGS`. WEB, Supabase Auth/PostgREST/PostgreSQL, and
Worker listeners were loopback-only: WEB `127.0.0.1:56431`, Supabase API
`127.0.0.1:56421`, and Worker `127.0.0.1:43477`. The Supabase database was
PostgreSQL 17.12. Two non-anonymous users were created and signed in through
the local Auth API; the first user's Ed25519 device was registered in that
same database. The challenge came from the built WEB, and the signed
authentication proof's first submission was to the Worker.
No `TLSN_DEPLOYMENT_ROLE` or `TLSN_TEST_*` auth/device/binding override was
set. The Worker used distinct local-only Session Authority and Binding
Authority keys.

The Worker returned HTTP 201 with a Session. The harness independently
verified the receipt and context-grant signatures using the public key pinned
by the committed Session-context-grant vector, not a key taken from the
response. It checked the user/device/authentication nonce, Session ID,
binding, device challenge, and expiry relationships. Altered signed data and
an unrelated public key failed verification. The existing
`DurableObjectBindingAuthority.lookupBinding` found persisted DO state
matching the Worker response. The session's device challenge, binding, and
Session ID were then used to sign a possession proof; the built WEB returned
HTTP 200 and the expected independently computed `replay_digest_hex`.

Measured HTTP outcomes were Worker `401` (no bearer), `201` (Session),
`409` (authentication-proof replay), and `403` (another user's token for the
device); possession proof returned `200`, and replay returned `409`. Rejected
Session responses contained no Session ID, binding, receipt, or grant.
PostgreSQL queries confirmed exactly one authentication consumption, one
possession consumption, and one nonce consumption for the test device;
counts remained unchanged after replay. The Session context was created by
this local Worker run; it is not a production Session and does not establish
Notary, Presentation, `/verify/tlsn`, or Production Result acceptance.

**LOCAL_TEST_VERIFIED:** Worker type-check passed. A combined
`node --test` run of `device-proof-client.test.mjs` and
`session-context-grant-contract-test.mjs` passed **31/31** (29 and 2 tests
respectively), 0 failed and 0 skipped. The local integration harness passed
with all assertions, including the HTTP, signature, DO, and database checks
above. The existing WASM build and provenance check also passed and bound the WASM source to HEAD
`0dd7a8e92d3ad90b7fc6a9865741c9273266534c`. This used Node 22.21.1,
pnpm 10.14.0, Wrangler 4.135.0, Supabase CLI 3.2.0, and Docker 29.10.0.
The integrated flow completed at `2026-11-22T16:52:44.152Z`.
The dedicated WEB build command was
`pnpm --dir packages/FUSOU-WEB run build:tlsn-testplay`; Worker commands were
`pnpm --dir packages/FUSOU-TLSN-VERIFICATION-WORKER run build:wasm`,
`pnpm --dir packages/FUSOU-TLSN-VERIFICATION-WORKER run typecheck`, and
`node --test packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/device-proof-client.test.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/session-context-grant-contract-test.mjs`.

The disposable Supabase project was stopped with its data volume removed;
its test users, the Worker harness, temporary credentials, and the WEB
`.dev.vars` link were removed. The Supabase containers for project
`fusou-tlsn-261122` were absent after shutdown, and loopback ports 43477,
56421, 56422, and 56431 were confirmed closed. The ignored WEB/WASM build
outputs remain available locally; they contain no test credentials.

**MIGRATION LIMITATION:** The disposable database reached the current schema
using a test-only copy of the migrations. Two early migrations reference
legacy `user_member_map` columns before a later destructive cutover recreates
that table, so those legacy-only statements were omitted from the temporary
copy. No repository migration was changed. This does not verify that the
unmodified migration chain applies cleanly to an empty database.

**NOT_CHECKED:** Hosted CI and Cloudflare deployment were not run. No
production Auth/DB, Notary, production Session, Presentation, `/verify/tlsn`,
Production Result, APP, or game-server communication was exercised. The
temporary test fixture credentials and local services are not production
configuration. Stage A/B/C and Production acceptance remain **BLOCKED**.

## #142: same-host Notary release candidate built and tested

**HOSTED_CI_OBSERVED:** Actions
[#142](https://github.com/tsukasa-u/FUSOU/actions/runs/44944308825)
completed with all four jobs successful at source SHA
`46f11efede83d83a672614f7dc575f27a47f4120`, matching this build candidate.
The successful `proxy-capture-source-unit-tests` job includes the normal
Notary release build and exact binary tests. Its uploaded artifact
`fusou-linux-x86_64-verification-46f11efede83d83a672614f7dc575f27a47f4120`
(ID `14724630764`, digest
`sha256:e618311e3e92a2f66da4584d746715662b33ee89934d8f332b3329a823d5812c`)
is the verification APP package, **not** a Notary binary.

**SOURCE_AND_BUILD_VERIFIED:** The clean isolated source snapshot came from
the candidate commit; the existing worktree was not used as build input.
Builder: Ubuntu 24.04.5 LTS, Linux x86_64; `rustc 1.98.1
(48a229cea 2026-09-01)`, Cargo `1.98.1 (797e8a9bc 2026-08-05)`,
target `x86_64-unknown-linux-gnu`. The release command was:

```sh
cargo +1.98.1 build --release --locked --offline \
  --manifest-path packages/FUSOU-PROXY/proxy-https/Cargo.toml \
  --features operational-notary --bin fusou-notary
```

The binary was built with `operational-notary` only. The tracked Proxy
`Cargo.lock` SHA-256 was
`e001bb7815a4af743fd60f906ae6aad86dd4e59be68f6a478e6805b9d42f1dc6`
before and after dependency fetch, build, and tests. The TLSN SDK upstream
revision is `47aee45b53e06648c1b2ad3689b367b8c923fdec`; its FUSOU tree ID is
`a6726d9c69108b0d93ea6b3d4041052620e6cab9`.

**LOCAL_ARTIFACT_VERIFIED:** The tested and locally retained candidate file
`fusou-notary` is an executable x86-64 Linux ELF, mode `0755`, length
`23,204,144` bytes, SHA-256
`702a27898ec7908c8a3a6b37503bb68a24cdb5e1d6bb6d77ef72736245423fa3`.
`SHA256SUMS` passed, and the copied file compared byte-for-byte with the
release output. The same digest and length were verified before and after the
tests.

**LOCAL_TEST_VERIFIED:** The two exact candidate selectors ran against this
binary using test-harness features
`local-test-notary-fault-injection,operational-notary`; those are distinct
from the release artifact's features:

| Exact test | Result | Observed scope |
|---|---|---|
| `operational::normal_binary_complete_and_restarts_using_the_same_ledger` | **PASS, 1/1** | Synthetic credentials, ephemeral IPv4 loopback, temporary ledger, Complete capture, public export/offline preflight against the synthetic signed vector, and restart using the same ledger. |
| `operational::normal_binary_rejects_invalid_loopback_settings_before_side_effects` | **PASS, 1/1** | Wildcard, non-loopback, IPv6, hostname, zero-port, and mismatched endpoint settings were rejected before the tested side effects. |

No production endpoint, key, registration, trust anchor, APP Bootstrap,
service placement, or durable ledger was used. Reusable exact-selector
commands are in the [Notary release runbook](../FUSOU-TLSN-VERIFICATION-WORKER/docs/notary-release-runbook.md).
The #142 `.deb` is the Linux APP job's uploaded verification package;
`fusou-notary` is a separate local candidate and was not uploaded. The local
candidate binary, `RELEASE-RECORD.md`, and `SHA256SUMS` remain in local storage.
Their terminal-specific location is provided in the local handoff report, not
in this shared document.

**OPERATOR_APPROVAL_NOT_CHECKED:** Still required before release or placement:
an approved signed `notary/vX.Y.Z` tag and signer; approval of this binary
digest; actual Notary ID/environment; an operator-selected nonzero loopback
port; production K256 Notary pin; dedicated Session Authority key ID/SPKI;
independently approved registration-table digest; approved Web PKI anchor;
protected key/config paths; dedicated durable ledger custody; stop/recovery
and compatibility procedure; and host/instance, ingress, preflight, and
resume approvals. None of these are supplied by the synthetic test fixtures.

No tag, publication, installation, production configuration, key registration,
ledger initialization, service start, or deployment was performed. APP
Bootstrap and service confirmation remain subsequent work. Stage A/B/C and
Production acceptance remain **BLOCKED**.

## Candidate CI #141: PostgreSQL output capture correction

**HOSTED_CI_OBSERVED:** Actions [#141](https://github.com/tsukasa-u/FUSOU/actions/runs/44937896359)
ran at baseline SHA `cd4c8535bacb7c8527548e814ee5754111304f15`. The WEB
PostgreSQL concurrency check failed: 67 tests passed and one failed; the
verification APP artifact job was skipped. The failed assertion expected seven
replay rejections but observed six. This is the pre-fix run, not post-fix
Hosted verification.

**ROOT_CAUSE_REPRODUCED:** `ProofPostgres.concurrent()` finalized stdout on the
child `exit` event, although stdout may still deliver data before `close`. A
deterministic mock emitted `exit` before its successful stdout; the regression
failed against the old handler with expected `"ok"` and received `""`. The
helper now collects stdout/stderr through `close`, rejects spawn and stream
errors, and reports nonzero exits or signal termination as failures. The same
mock passes with the corrected handler. Additional deterministic cases cover
spawn failure, nonzero exit with stderr diagnostics, and signal termination.

**LOCAL_VERIFIED:** In an isolated container with networking disabled, Node
`22.16.0`, pnpm `10.14.0`, Vitest `4.1.11`, and PostgreSQL `16.15`:

- The workflow WEB type-check (`pnpm exec tsc --noEmit --pretty false`) passed.
- All four workflow Vitest files passed: 4 files, 72 tests, zero skipped.
- The complete PostgreSQL integration file passed in three independent runs,
  each with 33/33 tests passing and a newly initialized temporary database.
  Each run exercised eight concurrent connections and asserted exactly one
  `ok`, seven `device_proof_replayed` results, and one saved row with the
  expected owner and device key.

The eight-result assertion includes every returned value in failure output.
The SQL, replay contract, workflow, and artifact-job dependency were unchanged.

**NOT_CHECKED:** Hosted CI for the post-fix revision. No Production database,
migration, APP Cargo build, APP-launching Node suite, or Actions run was used.
The changes remain local and unstaged.

Stage A/B/C and Production acceptance remain **BLOCKED**.

## #140 hosted artifact verified; disposable Linux PAC observed

**HOSTED_CI_OBSERVED:** [Actions #140](https://github.com/tsukasa-u/FUSOU/actions/runs/44903160622)
completed successfully with all four jobs green, including Linux verification
APP packaging and upload. The run SHA, artifact manifest `sourceSha`, and local
HEAD are all `4b402486bce85d31cd2c7c8e19ca3f6954e130cf`.

**ARTIFACT_VERIFIED:** Artifact ID `14706959705`,
`fusou-linux-x86_64-verification-4b402486bce85d31cd2c7c8e19ca3f6954e130cf`.
The downloaded archive is 29,248,512 bytes and SHA-256
`c952b31d494d51bcb11fcb6d8b4a27f984240b0231153e1fa6cdf4a554bb72d5`, matching
the GitHub artifact digest. `MANIFEST.json` and `SHA256SUMS` identify
`fusou_0.5.0_amd64.deb` at 29,569,016 bytes, SHA-256
`776989992e6a335b141072530882473672c43108db7f5ddd3fc59d9db5edc2d6`; the
manifest source SHA matches the run and HEAD, and `sha256sum --check` passed.
Package extraction verified the executable APP and four executable Linux
scripts, the readable common PAC helper, both PAC files and bundled default
config; the expected bundled roaming-config path was absent. The package was
installed and run only in the disposable container described below. The host
package database, user configuration, trust store and proxy settings were not
changed.

**DEVICE_OBSERVATION:** **OBSERVED (disposable container only).** The APP ran
in Ubuntu 24.04 with Xvfb `:99`, GNOME Shell 46.0 / Mutter 46.2 and Chrome
158.0.8127.36. This was an internal-only Docker network, not a full VM,
physical desktop or normal GNOME login; those environments remain
**NOT_CHECKED**. The test endpoint `pac-test.invalid:8123` resolved to
`172.19.0.2`; the APP/browser container was `172.19.0.3`. No external route
was available.

Runtime observations were recorded on 2026-11-22 from 03:12 to 03:23 JST.

The test user received a full config derived from the tracked default, with
TLSN and candidate capture disabled, custom PAC enabled, and
`pac-test.invalid` as the only selected target. Open KanColle was off for every
Start. No existing roaming config was copied and no Production setting was
changed. Initial GNOME readback was mode `none` and
`http://pac-test.invalid:8123/previous.pac`. After Start, readback was mode
`auto` and the APP's generated `http://localhost:<port>/proxy.pac`. The
generated PAC returned `PROXY 127.0.0.1:<port>` for `pac-test.invalid`.

The first Start stopped before PAC setup because the container lacked XDG
Documents metadata; adding the test user's `Documents` directory and
`user-dirs.dirs` allowed the attempt to continue. CA installation then stopped
because `pkexec` was unavailable. The generated test CA was trusted only in
the disposable container with `update-ca-certificates`; the host trust store
was not touched, and the next Start succeeded.

Chrome was launched without a manual proxy argument. Its NetLog recorded
`from_system: true`, the APP PAC URL, a PAC fetch, and selection of
`PROXY 127.0.0.1:34631` for
`http://pac-test.invalid:8123/observed/browser-pac-02`. Chrome sent the
absolute-form request through that proxy; the APP Proxy log recorded status
`200 OK` for the same path from `127.0.0.1:40738`, and the test HTTP server
recorded the same path from `172.19.0.3`. This correlates browser PAC
resolution, Proxy handling and endpoint receipt; it is not evidence about
TLSN or a real Game Server.

Tray Restart, tray Quit and a terminal Ctrl+C each restored mode `none` and
the original `/previous.pac` URL; the recovery state was absent after each
confirmed cleanup. In a separate run, changing only the PAC URL to
`http://pac-test.invalid:8123/user-selected.pac` while mode remained `auto`
was preserved as the same auto-mode/URL pair after tray Quit.

The first Chrome attempt lacked `XDG_CURRENT_DESKTOP=GNOME` and NetLog showed
an empty system proxy config with `DIRECT`; rerunning with the GNOME session
environment made Chrome consume the system PAC. Chrome also required
`--no-sandbox` because this container could not create the browser's namespace
sandbox. One initial omnibox selection attempted a Google search, which failed
inside the internal-only network and is excluded from the test evidence. The
APP's period-tag request also failed closed; no external service was allowed.
No PAC defect was reproduced, so no APP implementation or regression test
changed. Results remain limited to this container session.

**TEST CONFIG:** For repeat runs, use a full config in a fresh test user's
roaming directory, never a partial TOML file or existing roaming config. Keep
both TLSN switches false, enable `proxy.pac.use_custom_pac`, set `pac_script`
to that user's generated `ROAMING_DIR/pac/proxy.pac`, and use port `0`. Set
`app.connect_kc_server.kc_server_name` and the selected proxy target to the
managed test hostname only. Keep egress default-deny and Open KanColle off;
do not allow the period-tag service as a workaround.

Stage A/B/C and Production acceptance remain **BLOCKED**.

Historical sections below preserve `NOT_CHECKED` and `NOT_RUN` statuses as of
their named source baseline or run; they are not the current status unless
explicitly stated. The current #140 and disposable-container results are
recorded above.

## Candidate artifact pnpm setup — preventive correction

**HISTORICAL SNAPSHOT:** The local correction was checked on 2026-11-21 JST
against the #138 baseline SHA below (session record: 20:10 JST; exact command
completion time was not retained).

**BASELINE:** Actions [#138](https://github.com/tsukasa-u/FUSOU/actions/runs/44834317244)
passed all three jobs at `e81af0d3e9744ca3fc25238584fbb0ee288dcb4a`; it
published no verification APP artifact. The conflicting action input was
identified from source; no Hosted failure log exists for it.

**SOURCE_CORRECTED:** Removed the artifact job's explicit
`pnpm/action-setup@v4` version so the action resolves the root
`packageManager` pin, including its integrity hash, as the existing jobs do.
The subsequent exact `pnpm --version` check and
`pnpm install --frozen-lockfile --ignore-scripts` remain in place. No
dependency, hash, lockfile, Tauri build setting, artifact condition, or
existing test job was changed.

**LOCAL_VALIDATION:** Workflow YAML and the artifact job were parsed; the
explicit version is absent while the root pin, version check, and frozen
install command remain. With a fresh `COREPACK_HOME`, `corepack pnpm
--version` resolved `10.14.0`; this local check used Node `v22.21.1`, not the
workflow's Node `22.16.0`, and did not execute the GitHub Action or install
project dependencies. At that handoff, GitHub Actions had not run, so Hosted
CI and artifact generation were **NOT_CHECKED**. That state was superseded by
the successful #140 run and artifact verification recorded above.

Stage A/B/C and Production acceptance remain **BLOCKED**.

## Candidate artifact job rejected before execution — #139

**HISTORICAL SNAPSHOT:** This correction followed the #139 rejection at base
SHA `0d723e8555f6ad413862eeb7f18c9d6c85a3bca7`, recorded on 2026-11-21 JST
(session record: 20:52 JST; exact local validation completion time was not
retained).

**HOSTED_CI_OBSERVED:** Actions [#139](https://github.com/tsukasa-u/FUSOU/actions/runs/44898661267)
was rejected while evaluating `linux-verification-app-artifact`: job-level
`env.CARGO_TARGET_DIR` referenced `${{ runner.temp }}`, which is not an allowed
context for `jobs.<job_id>.env`. All jobs were unexecuted and no artifact was
produced.

**SOURCE_CORRECTED:** Removed only that job-level `CARGO_TARGET_DIR`
expression. A Bash initialization step now creates the same isolated path
under `$RUNNER_TEMP` and writes it to `$GITHUB_ENV` before Cargo is used.
The package build inherits this value, and package inspection reads the same
`$CARGO_TARGET_DIR`. Existing jobs, artifact conditions, lockfiles, Tauri
configuration, and the pnpm root pin/version check remain unchanged.

**LOCAL_VALIDATION:** Workflow YAML, expression placement, and the initialization
shell were checked. With mock `RUNNER_TEMP` and `GITHUB_ENV`, the script saved
the expected target path; the build and package-check steps both use
`CARGO_TARGET_DIR`. `actionlint` was unavailable; the placement was checked
against GitHub's [official context-availability table](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability),
where `runner` is absent for `jobs.<job_id>.env` and allowed for step-level
contexts. Hosted CI was not run; the corrected workflow, Debian package
generation/upload, and real PAC inspection were **NOT_CHECKED** at that
handoff. This was superseded by #140's successful package generation/upload
and by the disposable-container PAC observations above. A normal GNOME login
remains **NOT_CHECKED**.

Stage A/B/C and Production acceptance remain **BLOCKED**.

## Linux verification APP artifact — candidate CI path

**BASELINE:** Candidate Actions [#138](https://github.com/tsukasa-u/FUSOU/actions/runs/44834317244)
passed all three jobs at `e81af0d3e9744ca3fc25238584fbb0ee288dcb4a`; that run
published no verification APP artifact.

**SOURCE_IMPLEMENTED:** The candidate workflow now builds a Linux x86_64
verification-only Debian package after all three existing jobs pass. It runs
only for a push to `tlsn-first-testplay-candidate` or a manual dispatch on that
branch, not for pull requests. The build pins Ubuntu 24.04, Rust 1.98.1, Node
22.16.0 and pnpm 10.14.0; uses the committed APP Cargo lockfile and repository
pnpm lockfile; explicitly enables `tlsn-production` and `custom-protocol`;
and records the default Cargo feature set. Vite uses an empty runner-temp
environment directory, and the Tauri dotenvx wrapper is not invoked. No
Production TLSN bootstrap values, private signing keys, secrets or roaming
user configuration are supplied. The package is unsigned, updater artifacts
are disabled, and the verification overlay has no updater endpoints.

The workflow extracts the Debian package before upload and requires the APP
binary, Linux PAC scripts, shared PAC helper, PAC files and bundled default
config at their runtime paths. It checks executable/read permissions and
uploads the package with `MANIFEST.json` and `SHA256SUMS`. The manifest records
the actual checkout SHA, runner OS, target, features, toolchain versions,
package filename, byte length and SHA-256. This is a test artifact, not a
release or production acceptance artifact.

**HOSTED_CI:** At the original implementation handoff, the new workflow had
not yet run. This was superseded by the successful #140 run and artifact
verification recorded above; no additional run was started for this PAC task.

**DEVICE_OBSERVATION:** Refer to the current #140 status above. Artifact
creation and package inspection do not establish that a browser fetched PAC
or sent traffic through the Proxy.

Stage A/B/C and Production acceptance remain **BLOCKED**.

## Candidate CI #134 — Playwright CLI resolution

**HOSTED_CI_OBSERVED:** [Actions #134](https://github.com/tsukasa-u/FUSOU/actions/runs/44694490416/job/136147867774#step:6:1)
failed at `node-contract-tests` step 6:
`pnpm --dir packages/FUSOU-APP exec playwright install --with-deps chromium`
reported `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "playwright" not found`.
Step 7 (the readiness Storybook regression) and later checks were skipped.

**SOURCE_IMPLEMENTED / LOCAL_TEST_VERIFIED:** Added `playwright` as an exact
APP devDependency at `1.58.2`. The lockfile change adds it only to the APP
importer; both the Playwright CLI and the `@vitest/browser-playwright` provider
resolve to `1.58.2`. The existing required Chromium-install and Storybook
regression workflow steps are unchanged.

In an isolated `node:22.16.0-bookworm` container with fresh `node_modules`,
`pnpm install --frozen-lockfile --ignore-scripts` passed using pnpm `10.14.0`,
and `pnpm --dir packages/FUSOU-APP exec playwright --version` returned
`Version 1.58.2`. `playwright install --with-deps chromium` passed inside the
container, and the specified Storybook command passed **1 file / 1 test**.
The existing ready → refresh clears the old ready/time → IPC failure assertion
was unchanged and passed.

The first isolated run omitted the APP's sibling `FUSOU-TESTDATA` Storybook
aliases, so Vite's dependency scan failed and Vitest reported no tests. The
rerun mounted the two alias directories read-only at their expected location;
the test then passed. Vite still printed non-fatal unresolved React
`optimizeDeps.include` warnings. No workflow edit, Actions rerun, or external
service access was made. Modified Hosted CI remains **NOT_CHECKED**; Stage A/B/C
and Production acceptance remain **BLOCKED**.

## APP TLSN readiness refresh and PAC state — local verification

**HISTORICAL SNAPSHOT:** These local checks used baseline SHA
`75ff8c7c6287629e8bb120742396137da4ae1a4d` during the 2026-11-20 JST session
(recorded start: 15:22 JST; exact test completion time was not retained).
The #133 result below was pre-change baseline evidence only.

**BASELINE:** Work continued on `tlsn-first-testplay-candidate` at
`75ff8c7c6287629e8bb120742396137da4ae1a4d`. Actions [#133](https://github.com/tsukasa-u/FUSOU/actions/runs/44636473582)
passed all three jobs for that pre-change SHA; it is baseline evidence only.

**SOURCE_IMPLEMENTED / LOCAL_TEST_VERIFIED:** Read-only APP readiness now
separates Proxy listener, PAC server startup, Linux PAC application,
Runtime Config/Freshness, Worker health, forwarder initialization, candidate
saving, grant, and capture state. PAC server binding is fallible and a startup
error is reported as `pac_server_start_failed`; Linux PAC application is
verified only after the existing command succeeds. Attempt IDs prevent an
older asynchronous startup result from overwriting a newer attempt. The actual
candidate-saving setting is shared by readiness, Result signing, and artifact
saving. Start and `/app` use the same UI: beginning a refresh clears the prior
snapshot, a successful result shows its check time, and a failed query shows
`unavailable` with its fixed diagnostic code.

The readiness snapshot is read-only: it does not reapply PAC, request
Runtime Config/Freshness or Worker/Session services, obtain or consume a grant,
admit to the Notary, or contact the origin. `ready` is only the APP's
preparation state at the displayed check time; it does not prove browser PAC
traffic, live Notary connectivity, observed Game Server identity, evidence
capture, or gameplay approval. The existing no-game retry for `grant_expired`
(tray **Restart**, then Proxy on / Open KanColle off / **Start**) was checked
against the source path, not reproduced against live services.

**LOCAL_TEST_RESULTS:** The isolated APP-source Manifest harness passed 37/37;
the Proxy capture/lifecycle harness passed 38/38, including grant expiry,
cleanup, pre-send fallback, and no-resend cases. The new Storybook browser
interaction passed 1/1, exercising ready followed by a failed refresh with no
stale ready state. The Vite build, focused Rust formatting, Prettier, and
Rust 1.98.1 `cargo check --locked --offline` for `proxy-https` passed. The
frontend `tsc --noEmit` remains blocked by 20 existing TS1117 duplicate
properties in `FUSOU-TESTDATA/storybook/ipc/1-5/cells.ts`; it reported no
readiness component/story errors. Targeted ESLint could not run because the
installed ESLint/Minimatch stack throws `TypeError: expand is not a function`.

The candidate workflow installed Chromium on its ephemeral runner and ran the
readiness interaction story. At that snapshot, Modified Hosted CI was
**NOT_CHECKED**. No APP Cargo build or APP-launching Node suite, real OS PAC
change, actual browser-route observation, real service, gameplay, or
deployment had been used for that local work. The later #140 hosted and
container-only evidence is recorded above; a normal GNOME login remains
**NOT_CHECKED**. Stage A/B/C and Production acceptance remain **BLOCKED**.

## Linux PAC shutdown readiness ordering — local verification

**HISTORICAL SNAPSHOT:** This local validation followed the #137 baseline SHA
`929a9d6392447f78a99d7f9c50409a2dbb6d83d5` on 2026-11-21 JST (session
record: 07:40 JST; exact test completion time was not retained). The Hosted CI
and desktop statuses below describe that snapshot only.

**BASELINE:** Actions [#137](https://github.com/tsukasa-u/FUSOU/actions/runs/44824868180)
passed all three jobs at `929a9d6392447f78a99d7f9c50409a2dbb6d83d5`.
That baseline included 26/26 mocked PAC cases and the 1/1 Chromium readiness
interaction; it predates this change.

**SOURCE_IMPLEMENTED / LOCAL_TEST_VERIFIED:** Linux tray **Restart**/**Quit**
and Ctrl+C now mark PAC cleanup as `cleanup_in_progress` with
`pac_cleanup_in_progress` before waiting for the serialized cleanup. PAC
application results are recorded while the operation gate is held, and the
readiness-state lock rejects same-attempt delayed success or failure after
cleanup starts, completes, or becomes unconfirmed. Successful restoration is
recorded as `pac_application_removed` before shutdown is queued; a queue failure
therefore remains unready. Cleanup failure and an unknown process result remain
`pac_cleanup_unconfirmed`. When PAC setup was skipped, its stage remains
`skipped` while the overall report becomes `pending` with
`app_shutdown_in_progress` (or `failed` if cleanup is unconfirmed). Existing
startup-attempt rejection and PAC setup behavior remain unchanged.

**LOCAL_TEST_RESULTS:** The Rust 1.98.1 isolated APP-source Manifest harness
passed 44 unit tests plus 1 integration test. New deterministic regressions
cover cleanup waiting behind an in-flight apply, readiness remaining unready
through shutdown (including skipped PAC setup), delayed same-attempt results,
cleanup failure/unknown result, and successful restoration followed by
shutdown-queue failure. The existing mocked Linux PAC suite passed 26/26 and
the Chromium readiness regression passed 1/1. Focused `rustfmt --check` passed
for the readiness implementation, `native_cmd.rs`, and harness tests. A
whole-file check of `setup.rs` still
reports pre-existing formatting differences outside this change. The workflow
already runs the Manifest harness with `--all-targets` and the PAC/browser
regressions; no selector change was needed.

At that snapshot, Modified Hosted CI was **NOT_CHECKED**. The APP had not been
built or launched for that local change; actual Linux desktop scheduling,
tray/Ctrl+C behavior, and live PAC readback had not been observed. No real PAC
settings or services were touched. The later #140 hosted package and
container-only runtime observations are recorded at the top; a normal GNOME
login remains **NOT_CHECKED**. Stage A/B/C and Production acceptance remain
**BLOCKED**.

### #137 handoff snapshot — 2026-11-21 (historical; superseded)

This table preserves the state at the #137 handoff, not the current status.
The current #140 artifact and container observations are recorded at the top
of this document.

| Evidence at that handoff | Status then | Result and scope |
|---|---|---|
| Actions [#137](https://github.com/tsukasa-u/FUSOU/actions/runs/44824868180), SHA `929a9d6392447f78a99d7f9c50409a2dbb6d83d5` | OBSERVED | All three jobs succeeded: `rust-tlsn-preflight`, `node-contract-tests`, and `proxy-capture-source-unit-tests`. This was the unchanged-HEAD baseline, not a result for the then-current edits. |
| Hosted run for the then-current edits | NOT_CHECKED | At that handoff, the six permitted worktree changes were unstaged and no commit SHA contained them. No Actions run had been started. |
| Local mocked regressions | VERIFIED | APP-source Manifest harness 44/44 unit tests plus 1/1 integration test; GNOME/KDE PAC mocks 26/26; Chromium readiness interaction 1/1. These do not establish desktop behavior. |
| Linux desktop operation | NOT_CHECKED | At that time, no authorized disposable VM/user session or prepared verification APP and managed destination was available. No desktop, browser, PAC URL/mode, proxy traffic, Restart/Quit, or Ctrl+C observation had been made; DE/browser versions were not recorded. |

The VM probe reported no VM and the expected APP release-binary paths were
absent at that handoff. The missing observation was later completed to
container-only scope in the #140 results at the top of this document. A normal
GNOME login remains **NOT_CHECKED**; the container result does not substitute
for it.

## Notary offline preflight and placement checks — local verification

**BASELINE:** Work continued on branch `tlsn-first-testplay-candidate` at
`bfaad877cfba1c2354a73cc711bb3f8f185dcc9e`. Actions [#131](https://github.com/tsukasa-u/FUSOU/actions/runs/44606865454)
passed all three jobs (`proxy-capture-source-unit-tests`,
`node-contract-tests`, and `rust-tlsn-preflight`) for that SHA. The previously
blocked step-29 lockfile fetch, step-30 isolated harness (30 tests), and
step-31 APP build handoff/Worker reference checks (110 tests) passed. This is
the pre-change Hosted CI baseline, not evidence for the edits below.

**SOURCE_IMPLEMENTED / LOCAL_TEST_VERIFIED:** The Notary offline preflight now
limits each of the five Runtime Config artifacts to the APP's inclusive
1,048,576-byte cap in both CLI file reads and direct checker calls. Direct and
CLI tests cover exact limit and one byte over for every artifact. A synthetic
valid signed Manifest with an exact-digest Worker reference succeeds at the
limit and is rejected one byte over. The targeted Node test file passed 10/10.

The existing normal-binary loopback regression now binds its synthetic signed
Notary endpoint, approved registration, `export-public` output and actual
loopback `listen` value to the same endpoint before ledger initialization.
The normal release binary was built with Rust 1.98.1,
`--locked --offline`, and an isolated `CARGO_TARGET_DIR`; SHA-256:
`f6af67872c250a2af084b52b0ed1dadf606218462356211910c0d61f2cec33e7`.
The normal-binary Complete/restart test passed 1/1: the Presentation and
transcript were verified, the origin received one headerless request, and
same-ledger finalized-result readback remained exact. Its unavailable-Notary
case failed before origin HTTP, with zero origin requests. Existing confirmed
pre-send fallback tests passed 2/2; the ambiguous-failure no-fallback test
passed 1/1. All Rust checks used `CARGO_NET_OFFLINE=true` and the same isolated
target.

The candidate workflow already runs the edited preflight Node test file and
selects the exact normal-binary loopback test, so no workflow selector change
was needed. The Notary runbook now distinguishes synthetic same-host loopback
from unimplemented separate-host transport security. The Evidence operator
runbook documents the tracked Worker `/attestation/session`, WEB
`device-proof` and `tlsn-device-proof` routes, first-APP live-service checks,
and independent Stage B `device_identity` acquisition from the authorized
WEB/DB operator.

Only synthetic Runtime Config/keys and loopback Notary/origin traffic were
used. No APP Cargo or APP-launching Node suite, Production service, real
Notary/Game Server, deployment, actual owner/device enrollment, Hosted CI, or
Actions was run for these changes. Modified Hosted CI is **NOT_CHECKED**.
Stage A/B/C and Production acceptance remain **BLOCKED**; actual placement
and Production endpoint values remain undecided.

## Isolated APP-source Manifest harness lockfile — Actions #130

**BASELINE:** Work continued on `tlsn-first-testplay-candidate` at
`bfd90e11aaab8859c1a9f1c8481f2421c6047a97`; the allowed worktree and index
were clean at task start. In Actions #130,
`proxy-capture-source-unit-tests` and `rust-tlsn-preflight` passed.
`node-contract-tests` failed at step 29 while running the isolated harness
`cargo fetch --locked` (exit 101), so steps 30 and 31 were skipped.

**SOURCE_IMPLEMENTED / LOCAL_TEST_VERIFIED:** The proxy manifest declares
`tracing-subscriber = "0.3.8"` as a normal dependency, but the isolated
harness lockfile's `proxy-https` dependency list omitted it. The lockfile
already contained `tracing-subscriber` 0.3.23 and its checksum. Added only the
missing dependency edge; package versions, checksums, and Git revisions were
left unchanged. The candidate workflow already runs the harness in steps 29
and 30, so no workflow change was needed.

With Rust 1.98.1 and a protected-file-free temporary workspace, the
step-29-equivalent `cargo +1.98.1 fetch --locked` passed with network access
allowed (`CARGO_NET_OFFLINE=false`). The step-30-equivalent
`cargo +1.98.1 test --locked --offline --all-targets` passed using a new
`CARGO_TARGET_DIR`: 29 unit tests and the shared delegation-vector integration
test passed (30 total). The corrected lockfile SHA-256 was
`6d60a62ca4d08569d2e6fee6028bb28953ac86db91f80419a737b1c66a8e4b43` both
before and after Cargo validation. The lockfile remains Git-tracked and not
ignored.

The APP build handoff and Worker reference Node tests from step 31 were not
run locally; APP Cargo and its Node suite remain outside this task's scope.
Actions #130 remains the pre-fix failure record. Modified Hosted CI is
**NOT_CHECKED**. Stage A/B/C and Production acceptance remain **BLOCKED**.

## Notary MPC-TLS configuration gate — local verification (2026-11-20)

**BASELINE:** Work continued on `tlsn-first-testplay-candidate` at
`576ece2188280113e6005a590677338d6caf32f0`, preserving the existing unstaged
changes.

**SOURCE_IMPLEMENTED / LOCAL_TEST_VERIFIED:** Proxy and Notary share the
128 KiB sent-data and 4 MiB received-data ceilings. Before `Verifier::accept`,
the Notary checks the proposed `MpcTlsConfig`: both byte limits are inclusive;
online receive decryption is at most the pinned Proxy default of 32 bytes;
record-limit fields must remain omitted; deferred decryption must start
enabled; and the network setting must remain `Latency`. The fixed alpha.15
SDK defaults omitted online receive decryption to 32 bytes, deferred
decryption to `true`, and network to `Latency`. Its `deps.rs` passes those
settings into setup, applies record caps only for `Some`, and maps `Latency`
to `low_bandwidth()`. Runbook acceptance rationale is recorded in the Notary
release runbook.

An unsupported proposal is sent through the SDK's `reject()` path before
MPC setup. The live grant lease then persists `Unknown`, so it is neither
returned to `Unused` nor re-admitted; the integration test confirms no
finalized result is available.

With Rust 1.98.1, `--locked --offline`, and isolated temporary
`CARGO_TARGET_DIR`s, the five in-memory Notary MPC policy tests passed 5/5.
The actual loopback Notary rejection test passed 1/1. The combined
separate-process suite passed 10/10, including Complete and Sparse transcript
verification, exact finalized-result replay, and the normal
`operational-notary` binary Complete/same-ledger restart regression. The
normal release binary was built without test fault injection; SHA-256:
`f6af67872c250a2af084b52b0ed1dadf606218462356211910c0d61f2cec33e7`.
The candidate workflow now selects all five policy tests and the new
loopback rejection test; its fault-injection loopback selector discovered
9/9 required tests. Changed Rust files passed `rustfmt +1.98.1 --edition 2021
--check`; workflow YAML parsing and the allowed-scope `git diff --check`
passed.

Only synthetic grants and loopback Notary/origin fixtures were used. APP
Cargo, APP-launching Node suites, real Notary/Game Server traffic, deployment,
Hosted CI, and Actions were not run. Modified Hosted CI remains
**NOT_CHECKED**. Stage A/B/C and Production acceptance remain **BLOCKED**.

## Notary persistence-failure stderr diagnostic — local verification

**BASELINE:** Work continued on `tlsn-first-testplay-candidate` at
`576ece2188280113e6005a590677338d6caf32f0`, preserving the existing unstaged
changes. No real service, deployment, or Hosted CI run was used.

**SOURCE_IMPLEMENTED / LOCAL_TEST_VERIFIED:** Normal `fusou-notary serve`
initializes the shared stderr tracing subscriber. On the first transition to
durability-uncertain, the ledger emits the stable error identifier
`target=fusou_notary::ledger event=notary_ledger_persistence_uncertain`.
The fail-closed state is set before logging and does not depend on log output;
subsequent rejected queries do not repeat the transition notification. The
event contains no grant, key, credential, ledger, or Attestation bytes. The
test-only Notary uses the same diagnostic initialization, while the normal
binary has no fault-injection feature or option.

With Rust 1.98.1, `--locked --offline`, and isolated temporary
`CARGO_TARGET_DIR`s, all 16 `synthetic_notary::tests` passed and the
separate-process loopback `local_notary_interop` suite passed 9/9. The
parent-directory-sync failure case verified that repeated result queries
remain rejected and produce exactly one diagnostic without logging synthetic
grant or Attestation bytes. The normal operational-binary regression passed
1/1, including ordinary connection-rejection diagnostics, fault-option
rejection, unchanged canonical `export-public` output, and exact finalized
bytes after same-ledger restart. The `operational-notary` binary was built
without fault injection; SHA-256:
`f3c88bc9bed3879025fc945cd5f4c9e3028ef7a5bd968405a5c6ccc926e3f27f`.
Changed Rust files passed `rustfmt +1.98.1 --edition 2021 --check`;
candidate workflow YAML parsing and the allowed-scope `git diff --check`
passed. Existing candidate selectors already cover the exercised tests.

The [Notary release runbook](../FUSOU-TLSN-VERIFICATION-WORKER/docs/notary-release-runbook.md)
documents stderr monitoring, the event identifier, ingress shutdown, and
same-ledger confirmation/synchronization before service resumes. Modified
Hosted CI remains **NOT_CHECKED**. Stage A/B/C and Production acceptance remain
**BLOCKED**.

## Notary ledger durability uncertainty — local verification

**BASELINE:** Work continued on `tlsn-first-testplay-candidate` at
`576ece2188280113e6005a590677338d6caf32f0`, preserving the existing unstaged
Proxy changes. Hosted CI and external services were not started or contacted.

**SOURCE_IMPLEMENTED / LOCAL_TEST_VERIFIED:** A failed ledger save now marks
that Notary process durability-uncertain while its exclusive ledger lock is
still held. Reads, writes, normal Attestation responses, and `QueryFinalized`
are then refused; lease cleanup cannot turn a visible post-rename
`Finalized` row into a published result. Restart opens and re-saves the same
ledger, including file and parent-directory synchronization, before serving.
Only a durably confirmed `Finalized` row returns its stored exact bytes;
interrupted `Admitted`/`Signing` work becomes `Unknown` after process loss and
cannot be re-admitted or re-signed.

With Rust 1.98.1, `--locked --offline`, and isolated temporary
`CARGO_TARGET_DIR`s, all 16 `synthetic_notary::tests` passed, including the
two new deterministic parent-directory-sync failures. The separate-process
loopback Notary suite passed 8/8: after a successful temp-file sync and
`rename`, the injected directory-sync failure exposed neither the normal
Attestation response nor a separate query result; the already received,
headerless origin response was preserved and origin was sent exactly once.
The same-ledger restart returned the byte-identical finalized result and
rejected replay without another origin send. The normal
`operational-notary` binary built without the fault-injection feature
(SHA-256 `71497f65b248e22fb76870df03bcf12e90652af066ba48f2e36464ce489b92e8`);
its existing same-ledger Complete/restart integration passed 1/1. Candidate
workflow selectors and the Notary runbook now include the new regression and
the mandatory stop/recovery procedure. The local synthetic request builder
also passes the parsed grant expiry into its binding while preserving the
original encoded grant bytes, keeping the fault-injection test feature
compatible with prepared-binding expiry checks.

No APP Cargo, APP-launching Node suite, real Notary, Game Server, or
Production deployment was used. Modified Hosted CI remains **NOT_CHECKED**.
Stage A/B/C and Production acceptance remain **BLOCKED**.

## Prepared Session grant expiry — 2026-11-19

**BASELINE:** Work continued on `tlsn-first-testplay-candidate` at
`576ece2188280113e6005a590677338d6caf32f0`, preserving the existing unstaged
capture-isolation and cancellation-cleanup work. Hosted CI #129 is a
pre-change baseline only; no Actions run was started. All repository changes
remain unstaged; no commit or push was made.

**SOURCE_IMPLEMENTED:** The prepared binding now retains `expires_at_ms` from
the Session Context Grant only after the existing grant-signature verification
and Session Receipt/expiry match. `capture_ready()` and `issue_binding()` both
reject at `now >= expires_at_ms`. Expiring an unused grant calls the existing
provider cleanup once and blocks replacement preparation until the old Session
context is released; in-use bindings are not revoked or replaced. The next
capture uses the next background-prepared grant. Grantless synthetic bindings
remain supported. Synthetic grant construction also carries expiry from its
verified parsed grant.

**LOCAL_TEST_VERIFIED:** With Rust 1.98.1, `--locked --offline`, and an
isolated temporary `CARGO_TARGET_DIR`, all seven new exact tests passed:
exclusive deadline (including at-deadline and after-deadline cases), expiry
recheck after readiness, in-use capture retention, pre-send fallback and
replacement grant delivery, serialized concurrent cleanup/repreparation,
grantless compatibility, and preservation of a replacement Remote Session
context. Ten related exact regressions also passed: reserved-header rejection,
two loopback pre-send fallback cases (one origin request each), ambiguous-send
no-retry, Complete and Sparse synthetic transport, capture-scoped Presentation
and Result cleanup, and both forwarder cancellation cleanup points. The
non-test `alpha15-tlsn` Proxy `cargo check` passed. Rust formatting, workflow
YAML parsing, and the protected-path-excluded `git diff --check` passed. The
build emitted one existing verifier dead-code warning,
`from_verified_alpha15_partial`.

No APP Cargo or APP-launching Node suite, real Notary, Game Server, or other
live service was used. Modified Hosted CI remains **NOT_CHECKED**. Stage A/B/C
and Production acceptance remain **BLOCKED**.

## Forwarder-owned cleanup after cancellation — 2026-11-19

**BASELINE:** The worktree remains on `tlsn-first-testplay-candidate` at
`576ece2188280113e6005a590677338d6caf32f0`. The existing capture-isolation
changes were preserved; #129 remains a pre-change baseline and does not verify
these regressions.

**SOURCE_IMPLEMENTED / LOCAL_TEST_VERIFIED:** Added two deterministic,
unit-test-only pause points in the normal forwarder pipeline. The first stops
after a synthetic Presentation is pending in the shared handoff but before the
Presentation verifier is called. The second stops after the fixture's signed
Worker Result has passed `ResultSignatureVerifier` and been registered, but
before the actual `SignedResultBoundary` begins local persistence. In both
cases `forwarder.cancel()` stops the existing lifecycle; the forwarder-owned
`CaptureAttemptOwner` performs cleanup. Tests do not call `discard_capture`,
`finish_capture`, or store deletion methods.

Both interrupted captures returned their loopback game response and ended in
`Cancelled`, not an evidence-success state. The first case confirmed A's
Presentation was pending and the verifier had not started; the second confirmed
A's verified Result was stored and the Result boundary had not started. After
owner cleanup, the same forwarder accepted B with the same serialized HTTP
bytes and a different binding. B's delivered Result signature verified and its
`presentation_sha256` and binding matched B's exact synthetic Presentation and
binding. The loopback origin received exactly one request from each capture;
the bytes contained no binding header, Cookie, or binding value.

The two new tests each passed 1/1. With Rust 1.98.1, `--locked --offline`, and a
temporary `CARGO_TARGET_DIR`, related suites passed: `real_tlsn::tests::` 42
passed/1 ignored, `experimental_tlsn::tests::` 22, `production_tlsn::tests::`
28, `synthetic_notary::tests::` 14, `proxy_server_https::tests::` 42, and the
separate-process loopback Notary integration 7/7. The non-test
`alpha15-tlsn` Proxy `cargo check` passed with one existing verifier dead-code
warning. Workflow YAML parsed; the modified forwarder/test files pass rustfmt.
The whole-file `production_tlsn.rs` rustfmt check still reports two
pre-existing formatting differences outside the new test inspection helper.

The new cancellation tests use synthetic Presentation/Worker fixtures and a
loopback TCP origin; they do not establish a TLS session or contact a Notary.
The separate Notary integration tests use only their managed loopback Notary
and origin. APP Cargo, APP-launching Node suites, real services, and Game Server
traffic were not run. Modified Hosted CI is **NOT_CHECKED**. Stage A/B/C and
Production acceptance remain **BLOCKED**.

## Capture-scoped Proxy handoff follow-up

**HOSTED_CI_OBSERVED (pre-change only):** The user-provided Hosted CI #129
baseline passed all three jobs at `576ece2188280113e6005a590677338d6caf32f0`.
That result predates this change and is not evidence for the updated source.

**SOURCE_IMPLEMENTED:** Presentation handoff and Worker Result storage now use
the capture binding identifier as their ownership key while retaining request
and response SHA-256 checks for exact-byte verification. Cleanup is capture
scoped, duplicate publication/registration is rejected until capture cleanup,
and shared Proxy transport send-once state is per serialized capture rather
than global across later captures. No game-server correlation data or wire
contract was added.

**LOCAL_TEST_VERIFIED:** Rust 1.98.1 with `--locked --offline` passed the
`real_tlsn::tests::` selection (40 passed, 1 existing ignored), the
`experimental_tlsn::tests::` selection (22 passed), and the
`production_tlsn::tests::` selection (28 passed). The separate-process
loopback Notary integration suite passed 7/7, including the existing
Complete/Sparse roundtrip and the new shared-transport test: two captures with
identical HTTP request bytes each produced one origin request, the received
bytes matched the authenticated request transcript, and independent
Presentation verification succeeded. Replaying a finalized capture did not
increase the origin request count. All network traffic was to managed
loopback services; APP Cargo and APP-launching Node suites were not run.

**HOSTED_CI_VERIFIED: NOT_CHECKED** after this change. Stage A/B/C and
Production acceptance remain **BLOCKED**.

## Hosted baseline #128 and current operational preflight — 2026-11-18

**HOSTED_CI_VERIFIED (baseline only):** [Run #128](https://github.com/tsukasa-u/FUSOU/actions/runs/44178936943)
passed all three candidate jobs for `434aab9a19be57503e101d11ec205cd841cc5190`
on `tlsn-first-testplay-candidate`. The workflow and job records/logs establish:

| Hosted job | Successful baseline scope |
|---|---|
| [APP preflight](https://github.com/tsukasa-u/FUSOU/actions/runs/44178936943/job/134377737433) | 23 passed, 1 ignored, 0 failed; #127's fingerprint test passed. The subsequent health/Runtime Config selection ran and passed all 47 tests. |
| [Proxy capture](https://github.com/tsukasa-u/FUSOU/actions/runs/44178936943/job/134377737970) | 20 required Proxy/Notary cases and 6 separate-process loopback Notary cases passed; the separate Proxy health selection also passed 4 tests. |
| [Node contracts](https://github.com/tsukasa-u/FUSOU/actions/runs/44178936943/job/134377738408) | Current-source WASM generation and provenance checks preceded the Worker typecheck. The contract group including Gateway-to-APP passed 112/112 (zero skipped); APP handoff/Worker reference passed 103/103. |

**SOURCE_IMPLEMENTED / LOCAL_TEST_VERIFIED:** The
[operator runbook](../FUSOU-TLSN-VERIFICATION-WORKER/docs/production-evidence-operator-runbook.md)
now describes the Complete APP path, the first-capture gates and the
11 candidate-connected + 1 offline semantic + 1 replay + 6 external roles.
The [offline checker](../FUSOU-TLSN-VERIFICATION-WORKER/scripts/notary-operational-preflight.mjs)
uses existing signed Runtime Config and independent artifact verification to
compare public Notary/Session Authority settings with an independently pinned
scope registration and a separately acquired operator configuration. The
checker makes no network requests and detects key reuse within the supplied
registration. It cannot establish off-register key custody or live peer
behavior. Node v22.21.1 passed the 46 explicit offline/loopback cases; Rust
1.98.1 `--locked --offline` on the standalone Verifier passed the two exact
missing-role and synthetic Complete 19-role finalization cases. Neither run
included the full APP or any live deployment; real replay remains `NOT_CHECKED`.

**Notary operator model: SELECTED; release and deployment: UNAPPROVED.**
The FUSOU developer operates a single-host, single-instance Notary. The
[release runbook](../FUSOU-TLSN-VERIFICATION-WORKER/docs/notary-release-runbook.md)
specifies a signed, immutable `notary/vX.Y.Z` source tag, separate artifact
digest approval and manual placement/handover record. The separate
`fusou-notary` release build has no fault-injection CLI and uses the same
wire-v1 admission, grant-v1 lease and exact Attestation persistence as the
loopback server. `init` is separate from `serve`; `serve` locks and reopens
only the existing, configuration-bound ledger. Run its `export-public`
through the offline checker before any placement. The accepted grant/wire
formats, headerless send rules, current v3 profiles, Complete Result v2 /
Sparse Result v3, exact bytes and receipt gate were not changed.

**LOCAL_TEST_VERIFIED (operational release path):** The normally built
artifact passed a separate-process loopback Complete capture using the real
Proxy transport that APP constructs, with independent Presentation
verification and exactly one origin HTTP request matching the authenticated
transcript. The actual public export passed the signed synthetic configuration
checker. An external process stop after admission and restart of the **same
binary** preserved `Unknown`, refused both grants on re-admission, and returned
unchanged finalized Attestation bytes. This is not a cross-version upgrade,
APP executable test, real release tag, or deployment validation.
Normal release build and SHA-256 readback passed; Rust 1.98.1 `--locked
--offline` passed the operational case (1), the existing Proxy/Notary
selections (20) and the existing separate-process selections (6). The two
explicit Node Notary/Runtime Config files passed 36/36. No selected case
failed or was skipped in these local verification runs.

**HOSTED_CI_VERIFIED: NOT_CHECKED** for these changes. Real settings, external
Notary/WEB/Worker operations, Production execution authority, approved
gameplay and full-Bundle delivery/retention remain unverified. Stage A/B/C
and Production acceptance remain **BLOCKED**. Earlier sections below are
historical snapshots at their stated baselines.

## Worker Result profile contract fixture follow-up — 2026-11-17

**HOSTED_CI_OBSERVED (pre-fix):** Run [#124](https://github.com/tsukasa-u/FUSOU/actions/runs/44072846697), for commit `29c3b1f7716e0e7906cc9109eeab833d5a3ec4f5`, failed at `node-contract-tests` step 25 with 72/74 tests passing. The Complete and Sparse Result success fixtures used historical profile IDs while the current contract requires the v3 Notary-session-binding IDs. Subsequent job steps 26–31 were skipped, including the candidate readiness contract suite.

**SOURCE_IMPLEMENTED:** `scripts/release-worker-integration.test.mjs` now imports the current Complete/Sparse profile constants for its success fixtures and rejects each historical profile ID. Complete Result remains version 2 and Sparse Result version 3. Existing exact-Presentation, Production digest, mutation, and canonical-identity assertions remain intact; production profile validation was not changed.

**LOCAL_TEST_VERIFIED:** The two targeted Result tests passed (2/2), the full integration file passed (24/24), and the exact step 25 Node test list passed (74/74, 0 skipped); Worker typecheck passed using current-source WASM bindings generated in temporary output with verified provenance. Local Node was v22.21.1 (workflow: v22.16.0); pnpm was v10.14.0. Existing ignored WASM artifacts were restored unchanged.

**HOSTED_CI_VERIFIED: NOT_CHECKED** after this fix. Run #124 remains the pre-fix failure record; Stage A/B/C and Production acceptance remain **BLOCKED**.

## Headerless ingress and local Notary durability follow-up — 2026-11-18

**SOURCE_IMPLEMENTED:** The Hudsucker APP proxy now rejects any
case-insensitive `X-Attestation-Binding` occurrence, including duplicates,
before route selection, body reads, capture admission, binding issuance, or
ordinary-proxy fallback. The optional Rama ingress applies the same guard
before authority routing or upstream service calls. Both return `400`; the
serializer's existing rejection remains defense in depth. Ordinary game
headers and body bytes are not stripped or rewritten. Confirmed pre-send
`NotSent` fallback still forwards once; an ambiguous post-send failure returns
an error response rather than an ordinary-proxy request.

The feature-gated synthetic Notary now separates explicit `initialize_new`
from `open_existing`. Initialization creates a new lock and installs the
initial state without overwriting an existing file; ordinary open, status, and
update require the existing lock and state. A missing initialized state is an
error, never an empty ledger or `Unused` result. Corrupt, unreadable, truncated,
and unsupported-schema stores also fail closed. File locking, atomic state
replacement, file sync, and parent-directory sync are retained. An absent
grant in a successfully initialized store is `Unused`; admission,
pre-signature claim, exact-result finalization, restart/interruption `Unknown`,
and quarantined `Rejected` states remain distinct. The Notary generates the
operation and live-connection identifiers itself. A non-clonable operation
lease is moved into and returned by the TLSN verifier task that owns the
protocol instance; extension validation uses that lease with the task's output,
requires the exact admitted grant, and durably claims it before attestation
signing. The validated, signed TLSN Attestation is saved as exact bytes; result
lookup returns those bytes and never signs again. Restart turns unfinished
admission/signing states into `Unknown`, while a finalized result remains
readable.

The existing grant v1 signature has no explicit audience, Notary, or
environment fields. The local adapter pins one dedicated synthetic Session
Authority key ID/public key and has fixed local Notary/environment scope. A
real integration must enforce a distinct authority key and pin for each
authorized Notary/environment tuple, or version the grant to sign those scope
fields; no production scope registration is claimed here.

**LOCAL_TEST_VERIFIED:** Thirteen candidate persistent-store test cases pass,
covering explicit non-overwriting initialization, missing-file rejection for
`Admitted`, `Signing`, `Unknown`, and `Finalized`, corrupt/unreadable/
unsupported-schema rejection, concurrent single admission,
cross-connection and Session/device substitution, invalid authority pin,
client acceptance injection, actual child-process restart recovery, and
exact-result byte readback after restart.
Hudsucker handler tests pass for
mixed-case/duplicate rejection before body polling, raw loopback origin
receipt count and bytes on both unavailable-capture and confirmed-`NotSent`
fallbacks, and no ordinary request after an ambiguous failure. The optional
Rama guard test also passes with `rama-experimental`. The real alpha.15 SDK
synthetic integration passes in both Complete and Sparse modes; the concrete
Hudsucker handler path still verifies the actual TLSN Presentation and
test-signed Result.

The candidate workflow fetches locked dependencies with `cargo fetch
--locked` (which does not accept feature flags); `synthetic-tlsn` remains on
the feature-aware test/list commands, which run offline. It lists the required
test names before invoking each with exact matching, so a filter typo cannot
pass with zero tests. The 20 required invocations cover Complete and Sparse
transport paths, handler regressions, and persistent Notary tests.
Locally, the corrected Rust 1.98.1 fetch completed with a fresh temporary
`CARGO_HOME` and network access enabled; all 20 exact invocations then passed
offline using that populated cache. This does not establish a Hosted runner's
first-fetch result.
**HOSTED_CI_VERIFIED: NOT_CHECKED** after these changes; Actions were not
started. **PRODUCTION_VERIFIED:
NOT_VERIFIED**; no real Notary, Game Server, Worker deployment, key enrollment,
or Production evidence was exercised. Stage A/B/C and Production acceptance
remain **BLOCKED**.

## Separate-process loopback Notary interop — 2026-11-18

**HOSTED_BASELINE_OBSERVED:** Run [#125](https://github.com/tsukasa-u/FUSOU/actions/runs/44078508976) passed all three jobs on baseline commit `d4728204435e8da2ad44353b19555c2ca4426e80`. This is pre-change baseline evidence only; it does not verify the implementation below. The earlier #124 failure record above is retained.

Repository inspection found no independently runnable external Notary source,
entrypoint, or deployment configuration. The new
`fusou-local-test-notary` binary is a repository-local integration adapter; it
uses the existing persistent `LocalTestNotary` state machine and the pinned
TLSN alpha.15 SDK dependency (`0.1.0-alpha.15`,
revision `47aee45b53e06648c1b2ad3689b367b8c923fdec`). It is not evidence that an
external Notary implements this protocol.

**SOURCE_IMPLEMENTED:** The local adapter accepts only loopback TCP connections
and uses a bounded, versioned admission/query frame. The Proxy sends the
Session Authority grant before opening the origin connection. The Notary
verifies the grant signature against its configured key ID/public-key pin,
purpose, claims, and validity window, generates the operation and live
connection identity, and durably admits the grant. It signs an acknowledgement
binding a fresh nonce, grant digest, Notary ID, and environment; the Proxy
checks the pinned Notary key and expected scope before proceeding. The same
TCP stream then carries the alpha.15 MPC/TLSN session. Its verifier output and
non-clone live lease are the only inputs accepted for the attestation
extension check. The Notary persists the signing claim before signing, creates
the acceptance itself, signs it together with that connection's TLS
commitments in the Attestation, persists the exact serialized Attestation, and
returns those exact bytes. A finalized-result query reads the saved bytes and
does not sign again. An unfinished admission or signing claim becomes
`Unknown` on restart and cannot be re-admitted.

The loopback harness uses an ephemeral test CA and server key, an isolated
temporary store, and a distinct Notary child process. The child is stopped and
waited before temporary state is removed; it has parent-death cleanup and
handles interrupt/termination signals. Fault injection is a test-only startup
option, not a request endpoint. Game Server HTTP bytes are not augmented with
grant, acceptance, correlation, or FUSOU headers/query/cookies.

Grant v1 has no signed audience, Notary, or environment field. This adapter
therefore fixes one synthetic Notary/environment and a dedicated authority
key ID/pin. A real integration must register and enforce a distinct authority
key/pin per authorized Notary/environment tuple, or revise the grant
contract if that cannot be guaranteed. This local configuration cannot prove
that a key is not reused in another environment. No claim is made that an
external Notary has registered the key, implements this wire protocol, or
enforces an operational policy merely because a policy ID matches.

**LOCAL_TEST_VERIFIED:** Rust 1.98.1 ran the separate-process suite with
`--features local-test-notary-fault-injection --test local_notary_interop`:
6 passed, 0 failed, 0 ignored. Complete and Sparse each completed a real
alpha.15 TLSN exchange with the child Notary and loopback HTTPS origin; the
independent verifier checked the signed Presentation, Web PKI chain, Notary
key, Session Authority grant, and Notary acceptance. The origin's received
HTTP bytes matched the serialized request exactly, with one request per
successful capture and no FUSOU correlation header. Wrong authority pin,
invalid signature, expiry, wrong Notary signature pin, foreign live-grant
reuse, client-supplied acceptance, and same-grant concurrent admission were
rejected; no unauthorized/retried HTTP request was observed. Restart tests
confirmed `Admitted` and `Signing` interruption become `Unknown`, and a
finalized grant returns identical saved Attestation bytes after restart.
Missing and corrupt initialized stores prevented server startup. Rejected
proof processing preserved the already received game response and did not
cause an ordinary fallback or resend; after restart, a later client request
was accepted only with a fresh Session grant as a distinct capture.

The candidate workflow keeps its existing 20 exact-name synthetic TLSN,
handler, and persistent-store invocations and adds a separate six-test
loopback Notary integration step. The step checks the complete discovered
test list and invokes each name exactly with Rust 1.98.1 and offline locked
dependencies. The workflow was edited but not run.

**HOSTED_CI_VERIFIED: NOT_CHECKED** after these changes; no Actions run was
started. **PRODUCTION_VERIFIED: NOT_VERIFIED**; no external Notary, real Game
Server, Worker, Production database, deployment, key registration, or
Production Result/receipt flow was exercised. Real integration still needs
the external Notary source/revision and wire-protocol owner, public Session
Authority key ID and SPKI pin for the authorized tuple, Notary ID/environment,
Notary TCP endpoint and signing-key public pin, target identity policy, and
approved runtime store/network configuration. No private key should be
provided through this readiness record. Stage A/B/C and Production acceptance
remain **BLOCKED**.

## Headerless Session binding — initial implementation verification

The verification snapshot below predates the persistent Notary and ingress
follow-up above. Its in-memory-ledger description and test counts are
historical, not the current implementation state.

**SOURCE_IMPLEMENTED:** The current complete and sparse profiles are
`fusou-require-info-v3-notary-session-binding` and
`fusou-require-info-v3-sparse-notary-session-binding`. The origin serializer
does not inject `X-Attestation-Binding`; it rejects a client-supplied instance
and carries FUSOU context separately as typed metadata. The Session Authority
grant is signed under `FUSOU-TLSN-SESSION-CONTEXT-GRANT-V1\0` and binds the
purpose, canonical Session ID, binding, device commitment, challenge, signer
key ID, and issue/expiry times. It is carried as
`fusou.session-context.grant.v1`. The verified Presentation must contain
exactly that grant and `fusou.notary.session-context.accepted.v1`; the latter
binds the grant digest, fixed policy ID, and validation time. Rust's shared
verifier checks the exact extension set and signature, and the offline Evidence
Bundle verifier matches the grant against the signed Session receipt and
Result. The v3 profile IDs and per-identity canonical profile digest derivation
are recorded in the tracked
[Worker profile contract](../FUSOU-TLSN-VERIFICATION-WORKER/src/origin-trust-contract.mjs).

**LOCAL_TEST_VERIFIED:** Rust verifier library tests passed (**154/154**),
including complete and sparse 19-role Bundle finalization with independent
semantic-report verification, including malformed and unknown-version
Session-context encoding rejection. The proxy library suite passed
(**188 passed, 1 ignored**); its headerless handler path verifies the
Notary-signed Presentation, Session grant, and test-signed Result, and confirms
the ordinary pre-send fallback adds no tracking header. The local synthetic
TLSN/Notary path passed in complete and sparse modes; exact origin bytes match
the authenticated transcript, signed Session context is recovered, Results
verify, and duplicate sends are rejected. Sparse capture passed separately
(**1/1**). The ignored proxy test is the APP/Worker roundtrip and remains
**NOT_CHECKED**. Worker Session/evidence contract tests passed (**55/55**).
TypeScript typecheck passed against temporary WASM
bindings generated from the current verifier source; a local WASM build also
confirmed all four extension-aware exports load. This temporary build used
`wasm-pack 0.13.1`, not the workflow-pinned `0.15.1`. The checked-in
commit-bound WASM artifacts and provenance were left unchanged. A direct
typecheck against those unchanged bindings still fails because they lack the
four new exports; the candidate workflow regenerates them before typecheck, and
the release provenance guard was not bypassed.

The candidate workflow already rebuilds the Worker WASM from the exact clean
commit, verifies its provenance, typechecks the Worker, and runs the shared
Session/evidence contract tests. No workflow change or Actions run was needed.
Post-change Hosted CI is **NOT_CHECKED**.

The synthetic Notary's one-use ledger is in-memory and local. No real Notary,
Game Server, Worker deployment, key enrollment, or non-synthetic Production
Presentation was tested. A real Notary must independently validate the
pinned Session Authority grant, all bound claims and validity, consume it
once, and sign the acceptance in the same attestation as the live TLS
transcript commitments. There is no legacy header-injection fallback. APP
process/image authority and browser input correctness remain out of scope.
Stage A/B/C and Production acceptance remain **BLOCKED**.

## Worker compatibility guard parser hardening — 2026-11-15

**SOURCE_IMPLEMENTED:** The compatibility guard previously extracted matching
lines with regular expressions. It could accept impossible calendar dates,
malformed arrays, and an indented duplicate assignment. The shared
[guard](../../scripts/worker-compatibility-settings.mjs) now parses the whole
TOML document with `smol-toml@1.8.0` and reads only the document's root
`compatibility_date` and `compatibility_flags`; TOML parser errors propagate
instead of being skipped. The parser is now a direct root devDependency; this
version was already present transitively in the lockfile. The guard requires
a quoted `YYYY-MM-DD` real calendar date and a root array of non-empty strings
without surrounding whitespace or duplicates. Empty arrays remain valid.
TOML comments, multiline arrays, and trailing commas follow parser behavior.
No compatibility date, flag, or runtime pin changed in this hardening.

The positive and negative guard cases run before the Miniflare tests in the
[Coordinator suite](../FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/scripts/runtime.test.mjs)
and [Gateway suite](../FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-GATEWAY/scripts/runtime-http.test.mjs);
the existing [candidate workflow](../../.github/workflows/tlsn-testplay-candidate.yml)
executes both runtime scripts. Tests cover the three reported reproductions,
valid and invalid calendar dates including leap years, missing/type-invalid
fields, repeated flags, root versus environment-table fields, TOML comments
and trailing commas, and date/flag mismatches.

**LOCAL_TEST_VERIFIED:** Guard cases and all four Gateway/Signer/Coordinator
configuration reads/parity passed. Coordinator typecheck and runtime suite
passed (**72/72**, 0 skipped); Gateway typecheck and HTTP runtime suite passed.
Both used Miniflare `5.20261113.0-beta`, workerd `1.20261113.1`, and the
existing `2026-11-13` / `enable_request_signal` settings. Gateway exact-byte,
deadline, and reset assertions passed; the previously noted Signer-body
cleanup boundary remains **OBSERVED**, not resolved by this guard change.
No RPC-stub disposal or unhandled-promise warning appeared, and runtime
temporary directories were removed.

The guard validates TOML syntax and the two consumed root settings; it does
not replace Wrangler's full configuration-schema validation. `smol-toml` has
documented edge cases for some invalid TOML-native date values; the consumed
compatibility date must be a quoted string and is independently calendar
validated here.

**HOSTED_CI_VERIFIED:** **NOT_CHECKED** after this change. Hosted run
[#122](https://github.com/tsukasa-u/FUSOU/actions/runs/43587188696) remains
the pre-change baseline at `73f6800c8dfa78bee84349445e7a346317770697`; no
Actions run was started.
**PRODUCTION_VERIFIED:** **NOT_VERIFIED**. Production acceptance and Stage
A/B/C remain **BLOCKED**.

## Workers compatibility parity — 2026-11-15

**SOURCE_IMPLEMENTED:** The former `2026-11-13` examples were tested with
older Worker settings (`2026-11-08` for the Coordinator and `2026-11-06` for
the Gateway), while Miniflare/workerd were pinned to the November 4 build.
Kept the intended November 13 date and upgraded the two runtime harnesses to
Miniflare `5.20261113.0-beta` / workerd `1.20261113.1`. The Coordinator's
`@cloudflare/workers-types` is `5.20261113.1`; Node in local runs is
`v22.21.1`, esbuild is `0.28.2`, and candidate CI uses Node `22.16.0`.

| Worker/configuration | compatibility date | flags | Local runtime coverage |
|---|---|---|---|
| Gateway `wrangler.toml` and Gateway service-binding example | `2026-11-13` | `enable_request_signal` | Miniflare 5.20261113.0-beta / workerd 1.20261113.1 |
| Private Signer example and test-only Coordinator DO wrapper config | `2026-11-13` | `enable_request_signal` | Same pinned runtime; settings are read independently and compared |
| Test-only request-signal probe | Gateway settings | Gateway flags | Same pinned runtime |
| TLSN Verification Worker `wrangler.toml` | `2026-09-07` | omitted in that config | No corresponding Miniflare runtime suite; not changed or claimed verified |

The harnesses now read the actual Wrangler compatibility fields, require
exactly one valid date and flags array, and pass each Worker its own parsed
settings. Missing/malformed fields or date/flag mismatches fail before runtime
startup; positive, missing-field, malformed-field, and mismatch guard cases
are exercised. No configuration placeholders or secrets are passed to test
Workers.

The first Gateway parity run exposed that the separate Signer Worker also
needs `enable_request_signal`: with its previous empty flags, the Gateway's
deadline and disconnect while awaiting Signer headers did not reach the
Signer-side `Request.signal`. The private Signer example and local Coordinator
config now explicitly enable the flag. Cloudflare documents that cancellation
can continue through Service Bindings and that incoming `Request.signal`
requires this flag before the November 17 default change
([Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/),
[Request.signal change](https://developers.cloudflare.com/changelog/post/2026-11-02-request-signal-default/)).
The Gateway retains its distinct 7-second deadline and flag contract.

The chosen path was to update the pinned local runtime rather than lower the
Production examples' date. Cloudflare's November 17 default transition is
after the selected November 13 date, so the explicit request-signal flag
remains intentional. The root Wrangler CLI remains locked at `4.135.0`; its
bundled Miniflare/workerd (`5.20260918.0-alpha` / `1.20260918.1`) is not used
by these runtime harnesses. No Wrangler dev/dry-run or deploy was performed;
that separate local preview path is **NOT_CHECKED**.

**LOCAL_TEST_VERIFIED:** Domain typecheck and unit tests passed (**33/33**);
Coordinator typecheck and runtime suite passed (**72/72**, 0 skipped); Gateway
typecheck and HTTP runtime suite passed with the November 13 settings,
including exact response bytes, the Gateway-owned deadline, and reset while
awaiting Signer headers. The runtime logs identify the per-Worker settings
and actual Node/Miniflare/workerd versions. The existing Signer-body
disconnect case still reports unconfirmed cancellation/cleanup and retains
admission; that outcome remains **OBSERVED**, not verified cleanup. Related
Node Manifest/Production artifact contract tests passed (**81/81**). The
separate `tlsn-runtime-config-freshness-test.mjs` was not run because it
starts APP Cargo, which is outside this verification scope. No RPC-stub
disposal or unhandled-promise warning appeared; test temporary runtime
directories were removed.

Hosted run [#122](https://github.com/tsukasa-u/FUSOU/actions/runs/43587188696)
is the pre-change baseline for branch `tlsn-first-testplay-candidate`,
HEAD `73f6800c8dfa78bee84349445e7a346317770697`; all three jobs succeeded.
It did not verify this compatibility change. Post-change Hosted CI is
**NOT_CHECKED**. No real Cloudflare deployment, resource/key registration,
Production materials, Game Server/Notary communication, or Production
acceptance was performed. Stage A/B/C and Production acceptance remain
**BLOCKED**. The compatibility statements in the historical entries below
describe their original test conditions and are superseded for current local
runtime parity by this section.

## Production artifact semantic verification — local hardening

**SOURCE_IMPLEMENTED:** Independent review reproduced that valid Manifest and
artifact hashes could admit a Worker reference whose identity did not match
the signed Manifest. A Workers-compatible Production artifact verifier now
checks the exact five ordered publication objects and their content-addressed
bytes, Worker identity/build/bindings and observation time, freshness, Origin
Inventory, Target Approval, security registry cross-references, and the
root-signed Result registry envelope. The private HTTP route and Coordinator
RPC admission both run it before admission or R2 writes; persisted exact inputs
are rechecked before Release progress and `ADVANCE` install. The Node and
Workers-compatible verifiers agree on the shared positive vector and invalid
artifact cases. This does not claim APP process/image attestation.

**LOCAL_TEST_VERIFIED:** The correctly hashed and correctly child-signed
identity-mismatch reproduction is rejected by the formal Node verifier, the
private route, and direct Coordinator RPC. The test confirms the root-signed
Manifest delegation remains unchanged and that R2 pointer, ledger head,
current-state binding, Release signature count, and install state do not
change. Shared-contract tests cover Worker identity/observation/freshness and
JSON failures, role/order/duplicate/missing publication objects, and semantic
inconsistency in all four other artifacts. Domain tests passed **33/33**,
Node Manifest tests **28/28**, and Coordinator runtime tests **72/72**;
Coordinator and Domain typechecks passed. Gateway runtime checks passed,
including exact response bytes and cleanup/reset scenarios. No RPC-stub
disposal or unhandled-promise warnings were reported.

The local Coordinator runtime used Miniflare `5.20261104.0-beta`, workerd
`1.20261104.1`, `compatibility_date = "2026-11-08"`, and flags `[]`.
The private Signer example date `2026-11-13` remains **NOT_CHECKED**.
Candidate workflow already runs the Domain tests, Coordinator runtime suite,
and Node Manifest tests; no workflow change was needed.

**HOSTED:** Changed-source Hosted CI is **NOT_CHECKED**. Hosted run [#121](https://github.com/tsukasa-u/FUSOU/actions/runs/43469695925)
remains only the pre-change baseline.
**PRODUCTION:** No registration, deployment, or Production operation was
performed. Stage A/B/C and Production acceptance remain **BLOCKED**.

## One cloudflare-operator Release update — local implementation

**SOURCE_IMPLEMENTED:** The update uses the configured Production
`cloudflare-operator-v1` profile, environment, chain, Coordinator name/DO, and
current restore epoch. Admission binds the stable operation ID and exact
Manifest V3/publication bytes to the expected prior Release head and current
state. The private Release-management capability is separate from the Genesis
capability and ordinary Freshness challenge; the caller cannot choose or
declare an approved target.

The root-delegated Manifest V3 and exact Worker-reference artifacts are
verified against the configured pins and allowed configuration. Manifest
signing and `release-commit-record-v1` signing use separate purpose-limited
keys/delegations; the latter is claimed and persisted by exact bytes before
append. The Node publisher is preparation-only for this path. The DO
coordinates immutable R2 writes, the sole mutable pointer update, exact
readback, conditional ledger append, `AVAILABLE`, and conditional `ADVANCE`
binding install. Completion is reported only when the installed current state
matches the committed Release.

Same-operation POST resumes only the exact persisted request; a changed input
or competing/stale operation is rejected. GET is read-only. R2 write,
Release-signing, append, readback, and install outcomes remain distinct:
Unknown is not cleared by timeout, restart, or a negative read, and a new
operation ID cannot bypass a retained writer. A persisted signer result is
reused; an unresolved Release signature is not re-signed.

**LOCAL_TEST_VERIFIED:** Test-signed Manifest/Release material traverses the
private route, DO coordination, local R2, Gateway, and independent
verification. Tests cover concurrent same-operation POST, exact replay and
conflict, Release signer result loss/Unknown across restart, R2 write and
readback recovery, append response loss, both `ADVANCE` install interruption
boundaries, read-only GET, no duplicate install/signature, and post-recovery
Freshness exact-byte verification. Test-only faults are isolated to the local
runtime Worker/subclass.
The complete Coordinator runtime suite passed **72/72**, with **0 failed**,
**0 skipped**, and no RPC-stub disposal or unhandled-promise warnings.

Hosted run [#121](https://github.com/tsukasa-u/FUSOU/actions/runs/43469695925)
is the **pre-change** baseline (all three jobs passed; Coordinator runtime
68/68). Hosted CI after this Release-update change is **NOT_CHECKED**.
Local runtime compatibility is Miniflare `5.20261104.0-beta`, workerd
`1.20261104.1`, date `2026-11-08`, flags `[]`. The private Signer example uses
`2026-11-13`; compatibility parity at that date remains **NOT_CHECKED**.

Production operator/resource/key/pin registration, initial material issuance
and R2 publication, deployment/restore validation, and renewal/continuous
publishing were not performed. Stage A/B/C and Production acceptance remain
**BLOCKED**.

## Genesis binding-install recovery — local verification follow-up

**SOURCE_IMPLEMENTED:** The independently reproduced recovery failure was
caused by treating the `VERIFYING` install's own persistent writer gate as a
new-bootstrap blocker. Recovery now distinguishes pristine one-time bootstrap,
the exact same approved `VERIFYING` install, and a matching durable `INSTALLED`
result. The `VERIFYING` path rechecks the operation/input and approval binding,
Release/head and restore-epoch binding, writer owner and fences, install state,
and blocker/quarantine conditions before reusing the existing finalizer. The
`INSTALLED` path validates the durable install/current-state relationship and
returns the existing result without reinstalling or issuing authorization.
Later monotonic fence advancement is accepted only when the persisted fences
remain canonical and no lower than the installed fence.

**LOCAL_TEST_VERIFIED:** The runtime suite now exercises interruption after
install admission but before finalization, runtime recreation, read-only GET,
and same-input POST recovery through `INSTALLED`; it also exercises interruption
after install commit but before the Genesis status update, including read-only
GET and same-operation status repair after recreation. Both cases verify that
the install is not duplicated and that authorization, writer ownership, fences,
and current state are preserved as applicable. Concurrent same-operation
recovery and refusal of changed approval/input, foreign writer/fence, Release
head/restore mismatch, and quarantined or inconsistent state are covered.
Coordinator typecheck passed and the full runtime suite passed **68/68**, with
**0 failed, 0 skipped** and no RPC-stub disposal or unhandled-promise warnings.

The local suite used Miniflare `5.20261104.0-beta`, workerd `1.20261104.1`,
`compatibility_date = "2026-11-08"`, and flags `[]`. The example configuration
uses `2026-11-13`; parity at that date remains **NOT_CHECKED**.
**Hosted CI after this recovery change: NOT_CHECKED.** Production genesis,
resource/key registration, deployment, and restore validation remain
unperformed. Stage A/B/C and Production acceptance remain **BLOCKED**.

## Hosted baseline before Production genesis changes — 2026-11-13

Hosted run [#120](https://github.com/tsukasa-u/FUSOU/actions/runs/43368457187),
attempt 1, passed all three jobs for branch
`tlsn-first-testplay-candidate`, baseline HEAD
`20d5d090cc9b8b263720850a07d7b9da1a5b601e`. The Coordinator runtime
reported **67/67**, including Gateway → private Signer → DO/R2 →
finalization → exact response bytes. This is pre-genesis-change evidence;
Hosted CI for the genesis implementation below is **NOT_CHECKED**.

## One-time fixed-approval Cloudflare/operator genesis — local implementation

**SOURCE_IMPLEMENTED:** The private Signer now has a separate management-only
genesis route, distinct from the ordinary Freshness challenge. It requires the
operator-managed canonical `FRESHNESS_GENESIS_APPROVAL_JSON` and a dedicated
`FRESHNESS_GENESIS_ADMIN_CAPABILITY` secret at both the HTTP and DO RPC
boundaries. The caller cannot declare approval or supply an operation ID. The
deterministic operation ID is derived from the exact fixed approval.

The approval pins the Production environment/profile, chain, coordinator
name and actual DO identity, restore epoch, initial position/generation,
exact Release Record and Release delegation digests, Manifest epoch/digest/
immutable reference/URL/audience digest, and the Release/Manifest root public
key pins. The existing verifiers check the signed Record, delegation and
Manifest, their time and reference bindings, and exact R2 pointer/snapshot
bytes and ETag before durable admission. A short SQLite transaction admits
only a pristine target and sets the writer gate; the existing Release append,
exact R2 readback/`AVAILABLE`, and conditional current-state install are then
reused. Freshness remains blocked until install succeeds.
The current Release Record schema has no `chain_id`; chain binding comes from
the fixed approval and Coordinator profile/config, not from a chain field in
the Record signature. `restore_epoch` is likewise an operator-managed
binding, not an independent witness or common-rollback detector.

Same-operation lookup is read-only. Same exact input may continue an admitted
operation through the existing verified stages; changed or unapproved input,
other operation IDs, retained history, mismatch, or quarantine cannot reset
or bypass it. A post-admission R2 readback fault remains `RESULT_UNKNOWN`
across runtime recreation and blocks Freshness. Only a same-operation retry
that observes exact positive R2 evidence can continue. Test-only R2 fault
injection exists only in the runtime test Worker; successful genesis state is
not inserted directly into SQLite.

The [private Signer example](../FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/wrangler.private-signer.example.toml)
now names the fixed approval setting and required management capability
secret. It remains placeholder-only, has `workers_dev = false`, no public
route, and is not selected by deployment automation. No Production resource,
operator, key, pin, initial material, or R2 object was registered or
deployed.

**LOCAL_TEST_VERIFIED:** Coordinator typecheck passed. The full pinned
Coordinator runtime suite passed **68/68**, **0 failed**, **0 skipped**. The
genesis integration uses test-signed material and the real production genesis,
Release, install, private Signer, Gateway, and independent state/response
verifiers. It checks pre-initialization Freshness denial, exact approved
Record/head binding, missing approval and mismatched DO/environment/profile/
chain rejection, wrong digest, invalid Record signature, expired Release
delegation, and missing/corrupt R2 rejection before admission. It also checks
concurrent same-operation calls, post-admission `RESULT_UNKNOWN`, Unknown
retention across runtime recreation, rejection of a different operation ID,
same-operation recovery only after exact readback, discarded-response result
lookup, finalized exact response bytes, and replay without a second response
signature. RPC-stub disposal warnings and unhandled/background-promise
warnings were not observed.

The pinned workerd runtime supports `compatibility_date = "2026-11-08"` with
the example's flags `[]`; the example's `2026-11-13` date is newer than the
runtime's observed maximum `2026-11-11`. Therefore behavioral parity at the
example date is **NOT_CHECKED**. No APP Cargo or APP-launching Node group was
run.

**Hosted after this change: NOT_CHECKED.** Production configuration,
registration, genesis material issuance/R2 publication, deployment, and
restore validation remain unperformed. Continuous Manifest/Release issuance
and renewal also remain outstanding. Stage A/B/C and Production acceptance
remain **BLOCKED**.

## Latest Hosted baseline before private Signer integration — 2026-11-13

Hosted run [#119](https://github.com/tsukasa-u/FUSOU/actions/runs/43261801324),
attempt 1, passed all three jobs for baseline HEAD
`08dd6f9d0e22a8111383ba5467bb99c8deff4b63` on
`tlsn-first-testplay-candidate`. It reported APP Runtime **46 passed**,
Manifest harness **28 unit + 1 shared-vector passed**, Coordinator runtime
**66 passed**, Verifier **149 library + 5 CLI passed**, and Proxy **29 + 4
passed**. This is pre-change evidence only. Hosted CI for the private Signer
integration below is **NOT_CHECKED**.

## Gateway-to-private Signer connection — local implementation snapshot

**SOURCE_IMPLEMENTED:** The Gateway's existing `TLSN_RUNTIME_CONFIG_MANIFEST_URL`
and `TLSN_FRESHNESS_SIGNER` contract now has a private Worker entrypoint in
[private-signer-worker.ts](../FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/src/private-signer-worker.ts).
It validates the bounded canonical challenge, environment and Manifest
audience, constructs the existing operator issue core with the Release reader,
SQLite DO, R2 adapter and Worker-readable signer, and returns only finalized
response bytes. The operation ID is derived from the exact challenge,
environment-bound configuration and chain; the HTTP caller cannot supply one.
DO stubs are created per request rather than cached across Worker requests;
only parsed configuration and cryptographic key material are cached.
The first local integration failure exposed why: caching a DO stub across
requests violates Workers' request-scoped I/O ownership and produced an
`OutgoingFactory` error. The restart check also now creates a fresh Miniflare
stub, and compares Gateway bytes to the persisted response-byte DTO shape.

The existing one-time persistent signing claim, state/fence checks,
independent response verification, durable finalization and exact-byte replay
remain in the shared operator core. A timeout, Gateway disconnect, negative
read or new request does not clear an Unknown operation or prove it was
cancelled. Test-only metric/configuration routes are in the runtime wrapper,
not the production Worker entrypoint.

The unregistered configuration examples are
[private Signer](../FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/wrangler.private-signer.example.toml)
and
[Gateway](../FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-GATEWAY/wrangler.private-signer.example.toml).
They disable workers.dev and Preview URLs, define no public route, contain
placeholder pins/resources, and are not selected by CI. The private signing
key is only named as a required secret; no secret value is present. No
Production key, resource, operator, or genesis registration or deployment was
performed.

**LOCAL_TEST_VERIFIED:** The existing candidate workflow already runs the
Gateway and Coordinator runtime suites, so the new integration test is reached
without changing CI selectors. Coordinator typecheck passed, and the complete
Coordinator runtime suite passed **67/67**, **0 failed**, **0 skipped**. The
new end-to-end case verifies finalized response length, digest and exact bytes
through Gateway, replay without a second response signature, concurrent
one-operation signing, Unknown retention and runtime-restart recovery.
It also rejects missing bindings, wrong pins/keys, malformed or expired
delegations, wrong audience/chain, and an uninitialized profile.
Gateway typecheck passed and its local HTTP runtime suite passed all **11**
reported checks. Domain typecheck and all **27/27** Domain tests passed.
Wrangler **4.135.0** local `deploy --dry-run` succeeded for both examples and
performed no upload. The Worker runtime suite remains on the pinned Miniflare
compatibility date `2026-11-08`; the example configs use the current
`2026-11-13` compatibility date and were build-checked, not runtime-tested at
that date. No RPC-stub disposal warning or unhandled-background-promise warning
was observed.

**Hosted after this change: NOT_CHECKED.** Production configuration,
registration and deployment remain unperformed. Continuous Manifest/Release
issuance and renewal, genesis, real Game Server/Notary evidence, Production
execution/delivery receipts and human gameplay remain outstanding. Stage A/B/C
and Production acceptance remain **BLOCKED**.

## Hosted CI history — APP Runtime Config epoch-state failure (#118)

Hosted run [#118](https://github.com/tsukasa-u/FUSOU/actions/runs/43233657703),
attempt 1, tested baseline
`d3c180cd076a04f8f5dd1cd7ce2db93035d4f281`. The
`rust-tlsn-preflight` job failed its `tlsn_runtime` test selection with 44
passed and one failed:
`epoch_state_starts_empty_and_roundtrips_canonical_state_atomically`.
`write_atomic()` wrote the fixture, but `read()` rejected its 43-character
`"B".repeat(43)` delegation digest as noncanonical base64url and the test
unwrapped that error. Production digest validation was not the defect.

The local regression change uses the existing `sha256_base64url()` helper for
valid roundtrip digests, asserts the persisted Manifest digest, authority
generation and delegation digest, and adds a separate noncanonical-digest
rejection case. No schema, state transition, or authentication contract was
changed.

Rust 1.98.1 isolated verification compiled the actual APP Runtime Config
runtime, Manifest and Freshness source files directly, with a new empty target
directory and the existing harness lockfile. The selected epoch-state tests
passed (**6 passed**, including the roundtrip and rejection cases; 28 filtered
out); the copied lockfile remained byte-identical. The run was offline and
used the existing Cargo download cache. APP Cargo and Node groups that could
launch it were not run. Changed-source Hosted CI remains **NOT_CHECKED**;
run #118 remains the pre-fix failure, not evidence for this change.

Stage A/B/C and Production acceptance remain **BLOCKED**.

## Hosted CI baseline before the Runtime Config epoch-state failure — 2026-11-11

The Manifest-delegation work starts from branch
`tlsn-first-testplay-candidate`, baseline HEAD
`47ff1f6a70f8825cbbc6ea8511a8400fd1382a3f`. Hosted run
[#117](https://github.com/tsukasa-u/FUSOU/actions/runs/42970415077), attempt 1,
completed successfully for that exact SHA: all three jobs passed. The
`node-contract-tests` job reported Coordinator runtime **65/65**, Verifier
library **149/149**, and Verifier CLI **5/5**. The run is pre-change evidence;
Hosted CI for the Manifest-delegation changes in this work is **NOT_CHECKED**.

Run [#116](https://github.com/tsukasa-u/FUSOU/actions/runs/42638941184) remains
successful evidence for its older baseline SHA
`69d30a7b1e3c62ae06018e405af019c3a3fba727`; it is not the current baseline.
Run #117 supersedes it only for baseline SHA
`47ff1f6a70f8825cbbc6ea8511a8400fd1382a3f`.

Hosted CI does not verify Production bindings, key custody, deployment,
continuous Manifest issuance, real Game Server/Notary exchange, or
Production acceptance. Stage A/B/C and Production acceptance remain
**BLOCKED**. Current contract decisions and the approval draft are in the
[Freshness contract revision proposal](./docs/runtime-config-freshness-contract-revision-proposal.md).

## Manifest-only delegation — local implementation snapshot (2026-11-11)

The local implementation adds an explicit Manifest envelope v3 while keeping
the existing root-signed envelope v2 unchanged. V2 continues to require the
external offline Bootstrap root pin. V3 requires the same root to verify a
root-signed, Manifest-purpose-only child delegation; it does not try v2 or
direct-child-pin fallback after a v3 failure. Release/Freshness signing
purposes and their limits are unchanged.

The root-approved configuration digest covers the Production environment,
Manifest URL audience, payload schema, Worker/deployment/build identity,
complete compile inputs, Production authority pins and Result Registry pins.
Only epoch and Manifest validity timestamps plus the Worker reference digest
and its matching observation time are reissuable. The reference remains bound
to the approved Worker identity, version, commit, compile inputs, bindings and
the exact referenced bytes; unknown Manifest/delegation fields are rejected.
The root-signed delegation is limited to 24 hours from its signed `issued_at`,
`not_before` cannot extend that interval, and the existing 30-second clock
skew policy remains explicit. Revocation is expiry plus per-client generation
high-water, not immediate revocation of an extracted child key.

APP state tracks Manifest delegation generation/digest separately from
Manifest epoch and Freshness delegation high-water, scoped to Production and
the Manifest URL audience. Existing epoch/Manifest/Release/Freshness
high-waters are retained on state migration; state writes remain after full
Manifest, artifact, response, deadline and transition verification. Local
test-only keys exercise the same publisher, Node/Domain verifier, APP Rust
source and strict/operator Release readers; no Production key is registered.

Local regression status: selected Node Manifest/R2/publisher suites
**43/43** (Manifest file **26/26**) and deterministic vector `--check` pass;
Domain **27/27** plus typecheck, Coordinator Workers runtime **66/66** (strict
and operator cases; no skips or RPC-stub disposal warnings), isolated
APP-source Rust **28/28 unit + 1/1 shared-vector test**, and Gateway typecheck/
runtime regression pass. The Rust harness includes the APP Manifest/Freshness
source directly; it is not the full APP Cargo integration build.

The Gateway-to-APP Node integration entrypoint was not included in the final
selected run because it launches APP Cargo as a child process. An earlier
parallel test command inadvertently included that entrypoint; its child APP
Cargo build failed before tests with `E0277` because the newly migrated legacy
epoch state lacked `Serialize`. That derive is now present and the isolated
APP-source harness passes, but the APP Cargo child test was not rerun; its
integration status remains **NOT_CHECKED**, and its indirect compile-time
access was not audited. Changed-source Hosted CI is **NOT_CHECKED**.
Continuous Production Manifest issuance, key/operator/genesis registration,
real artifacts and external Game Server/Notary evidence remain unverified;
Stage A/B/C and Production acceptance remain **BLOCKED**.

## Manifest harness lockfile follow-up — 2026-11-12

The root `Cargo.lock` ignore rule now has a narrow exception for
`packages/FUSOU-APP/src-tauri/manifest-verification-harness/Cargo.lock`.
The existing lockfile was retained unchanged, is no longer ignored, and is
still untracked in this unstaged worktree; include it and the new harness
sources/tests/manifest in the next user commit. The candidate workflow now
checks existence, Git tracking and ignore status before fetching dependencies.

Rust 1.98.1 verification passed in a clean temporary tree containing only the
harness, its referenced APP source and vectors, and required path-dependency
crate files. `cargo fetch --locked` and
`cargo test --locked --offline --all-targets` passed; the lockfile hash was
unchanged. The existing Cargo download cache was reused with network disabled.
The protected APP roaming config, `.git`, existing `target`, `node_modules`
and dotenv files were not copied. The workflow parsed with PyYAML; actionlint
was not available. Changed-source Hosted CI remains **NOT_CHECKED**.

## Private Signer authorization audit — local result (2026-11-11)

An independent local DO diagnostic had shown that the private
`cloudflare-operator-v1` Signer could produce a valid response for a missing
issue operation or a `RESULT_UNKNOWN` operation. This was a typed private
Signer authorization-boundary defect, not evidence that the ordinary public
issue route bypassed admission.

The Signer now requires a persistent, one-time `IN_PROGRESS` claim in the
SQLite issue ledger before response signing. The transaction matches the
fixed profile/environment/chain, operation and signer-operation IDs, exact
request bytes/digest/nonce/audience, issue fence, admission-time state and
the current installed Release/head; it also requires no writer or other
retained issue blocker. Generic Release reads no longer accept an operation
ID that suppresses its blocker. The issue-specific read requires the exact
claimed binding. Existing rows without the new claim column migrate
fail-closed as already claimed; newly admitted operations start unclaimed.
Unknown, rejected and finalized operations cannot start another signature.
Only exact finalized bytes are returned, and same-operation lookup does not
re-sign.

Local verification: Coordinator runtime **65/65 PASS** (56 strict plus nine
operator-profile cases), no skipped cases and no RPC-stub disposal warning;
the new direct-Signer tests measured exactly one Freshness response signature
for concurrent calls and zero for rejected/replayed calls. Claim persistence
was exercised across runtime recreation while the operation remained
`IN_PROGRESS`; Unknown remained blocked across restart and did not re-sign.
Domain typecheck and **26/26** Domain tests pass; Coordinator typecheck passes.
The existing candidate workflow step 27 already runs these package checks and
was not changed. Hosted run #116 is pre-change evidence; changed-source
Hosted status is **NOT_CHECKED**. Production acceptance and Stage A/B/C remain
**BLOCKED**.

## Cloudflare/operator Freshness profile — pre-claim local snapshot (2026-11-10)

The explicitly selected `cloudflare-operator-v1` profile is implemented and
verified locally; this does not approve Production deployment, operator/key/
genesis registration, or external resource creation. The existing
`strict-journal-witness-v1` profile remains separate, including its 8-second
issue authorization bound and mandatory Journal/witness validation. A missing
strict witness does not fall back to the operator profile.

The operator profile uses the SQLite Durable Object Release ledger and issue
coordination as canonical local state. Release verification, DO
`LEDGER_COMMITTED`, exact R2 pointer/snapshot/reference/ETag readback,
`AVAILABLE`, and current-state install remain distinct; DO and R2 are not a
distributed transaction. Issue operations bind profile, environment, chain,
state, request digest/nonce/audience, Release head and fence. Raw signer
results are private until exact response verification and durable
finalization. Same-operation lookup returns exact persisted bytes without
re-signing; Unknown is not cleared by timeout, negative R2 read, restart or a
new operation ID.

The local profile omits only the elapsed-time eight-second issue cutoff.
Release/delegation, Manifest and Freshness-response expiry checks remain.
The host UTC path and a deterministic test-only time sequence verify the
expiry guard near Release commit; neither proves an authenticated clock or
bounded accuracy. APP's 10-second and Gateway's 7-second deadlines,
Bootstrap-root offline custody, the 24-hour Freshness delegation, the
30-day Release delegation, and Manifest's 600-second reference age are
unchanged. Worker-readable child keys are allowed only for Runtime Config
Release/Freshness in this profile and are not HSM-equivalent.

Local results: Coordinator typecheck passes and the pinned Workers runtime
suite passes **63/63** (56 strict plus seven operator-profile cases) with no
RPC-stub disposal warning. Domain typecheck passes with **26/26** tests.
Gateway typecheck and its isolated Workers runtime regression pass; the
runtime reports eleven PASS checks. The shared Domain Node wire-contract suite
passes 26/26. The combined Worker-to-APP handoff test was not run because its
entrypoint invokes APP Cargo as a child process; that indirect read path is
excluded by the protected-file constraint. Candidate workflow step 27
already runs the Domain, Gateway and Coordinator checks; the workflow was
not changed. Run #116 remains pre-change Hosted evidence; changed-source
Hosted status is **NOT_CHECKED**.

The APP still verifies Manifest v2 directly with the offline Bootstrap root.
It has no delegated Manifest signer compatibility, while its 600-second
reference-age limit prevents indefinite reuse of one Manifest. Manifest
signer separation/APP compatibility and Freshness delegation renewal are a
separate implementation unit. External roles, real materials,
execution/delivery receipts, continuous Manifest issuance, real
Presentation/Result, real Game Server/Notary, Stage A/B/C and Production
acceptance remain **BLOCKED**.

## Historical candidate CI incident and local follow-up — run #113

Hosted run [#113](https://github.com/tsukasa-u/FUSOU/actions/runs/42456497746)
for `886e9e40669188e9ffdf254a32cf63b5a6b9aff2` failed in three jobs:

- `rust-tlsn-preflight` could not run the Gateway runtime test because `pnpm`
  was not installed in that job (`pnpm: command not found`, exit 127).
- `proxy-capture-source-unit-tests` passed the isolated capture harness
  (29/29), then `cargo fetch --locked` for the Proxy package failed because
  `packages/FUSOU-PROXY/proxy-https/Cargo.lock` was ignored and not tracked.
- `node-contract-tests` reported 148 Verifier tests passed and one failed:
  `experimental_probe_runs_on_a_prover_owned_connection`, with forwarding
  `BrokenPipe`/`WriteZero` and a panicking task. The later Freshness and
  Coordinator step did not run.

The local follow-up moves the Gateway runtime command into
`node-contract-tests`, after that job's pinned Node/pnpm setup and frozen
dependency install; it is not duplicated in the Rust-only job. The Proxy
package lockfile exception is now explicit, and the workflow checks that the
lockfile is tracked and not ignored before fetching with `--locked`. The
existing local lockfile passed that fetch and the health/candidate selector;
it remains untracked until included in a user-created commit.

The Verifier failure was not reproduced in the pre-fix local standalone or
parallel test runs. Source review found that the test origin shut down as soon
as it wrote the response while the probe was still completing its owned
connection, and the failing test detached both Session driver tasks. The
fixture now waits for the client close before shutting down the origin, and
the test joins both drivers. Exact request/response and binding assertions
remain unchanged. After the change, the standalone regression test passed
1/1, and the parallel Verifier library/CLI suites passed 149/149 and 5/5.

Local Freshness checks passed: Domain typecheck and 24/24 tests, Gateway
typecheck/runtime test, and Coordinator typecheck and 16/16 runtime tests.
The Proxy health/candidate selector passed 4/4; the isolated capture harness
type-check passed and its 29/29 tests passed. The workflow parsed with PyYAML;
`actionlint` is unavailable locally.

Post-fix Hosted CI is **NOT_CHECKED**; no workflow rerun or dispatch was made.
Stage A/B/C and Production acceptance remain **BLOCKED**.

## Current capture-scoped send policy — user-confirmed 2026-11-06

The selected contract is one Game Server send at most per capture. A pre-send
failure may send zero times. Once a send starts, timeout, cancellation,
disconnect, or an unknown outcome terminates that capture; it is not resumed
or resent, including after restart. If the Game Server response succeeds but
proof, Notary, Worker, Result, or delivery handling fails, preserve the game
response and reject that capture's incomplete evidence without another origin
send.

After local capture work is confirmed finished, the next client request may be
a new capture even when its method, path, and body are identical. This does not
deduplicate semantic game operations or claim Game Server exactly-once
processing. A logical operation ID or new origin reservation authority is not
required. Existing admission/preparation/concurrency restrictions and
Session/Device Proof/Result/Evidence binding and replay protections remain.
Ordinary-proxy fallback is allowed only when no origin send is confirmed;
ambiguous sends never fall back. Cleanup-unconfirmed local resources remain
unavailable, but remote `Unknown` alone does not permanently block later
independent captures.

This decision supersedes the earlier audit's
`authority_issued_logical_origin_attempt_reservation_missing` Stage B blocker.
Stage B remains **BLOCKED**: eleven roles are candidate-connected and the
offline finalizer can generate `semantic_verification`; an explicit offline
collector now supports `replay` and is locally verified, but no real
Production replay observation has been acquired. Six roles still require
independent external input, and the candidate execution-receipt gate remains.
Stage A/C and Production acceptance are not promoted by this policy.

### Current implementation and local verification

The Proxy [experimental capture forwarder](../FUSOU-PROXY/proxy-https/src/experimental_tlsn.rs)
now keeps state, origin outcome, lifecycle, and proof-task ownership per
capture. An `Unknown` origin outcome does not block a new capture after local
cleanup is confirmed. An active capture or `CleanupUnconfirmed` state still
blocks capture admission; dropping a task after send start leaves its local
slot unavailable. A binding is completed and prepared again only after local
cleanup is confirmed. The durable send journal remains responsible for
unfinished-send `Unknown` recovery and binding-attempt replay rejection.

Regression tests were added for an ambiguous send followed by an identical
new request with a fresh binding, reuse of a binding, old-capture state
isolation, task drop, not-sent versus ambiguous fallback, and
cleanup-unconfirmed admission. The existing durable send journal is responsible
for restart recovery; its separate tests were not run in this task.

The [isolated capture test harness](../FUSOU-PROXY/proxy-https/capture-test-harness/README.md)
uses relative `include!` wrappers for the actual Proxy source and nested
lifecycle tests.
Its separate lock pins the direct dependencies to versions resolved in the
Proxy lock; it is a focused module harness, not a `proxy-https` package
integration test. This avoids compiling the Proxy build script/dependency
graph, which includes [`configs.rs`](../configs/src/configs.rs) and its
protected APP roaming config.

Local harness verification with Rust 1.98.1:

- The lifecycle assertion now reads the lifecycle from the active
  `CaptureExecution`, fixing the stale `forwarder.lifecycle` E0609 reference.
- `cargo check --locked --offline --lib`: **PASS** for the isolated source
  modules; this is not a full Proxy type-check.
- `cargo test --locked --offline --lib`: **29 passed, 0 failed, 0 ignored**.
  The first run had **27 passed, 2 failed, 0 ignored** because two existing
  pre-send failure assertions expected `Ready`; capture-local terminal state is
  `Unattested`. They now assert that explicit terminal state; neither test was
  removed, skipped, or weakened.
- `rustfmt --check`: **PASS**. Formatting/syntax validation is distinct from
  the successful harness type-check and test run.

The candidate workflow has a separate job to fetch the harness lockfile and
run its offline type-check and tests. Hosted run #113 passed those harness
tests but failed later when fetching the main Proxy package dependencies; see
the current CI status above. The existing acceptance-stage tests passed
**3/3**, and the updated JavaScript syntax checks passed. Production acceptance
and Stage A/B/C remain **BLOCKED**.

## Earlier Runtime Config Freshness issuer-core status snapshot

The shared
[Runtime Config domain package](../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/index.ts)
now exports a provider-independent
[Freshness issue core](../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/freshness-issue.ts)
and purpose-specific
[signer/operation bindings](../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/signers.ts).
The core verifies the canonical Production challenge rather than trusting a
caller-supplied “verified” value, binds the operation and signer IDs to the
exact request digest/nonce/environment/audience, and reads/verifies current
Journal, coordination, R2 pointer/snapshot, Manifest, and anti-rollback
evidence through an injected adapter. It checks the issue lease and current
state after signing, verifies the exact signed response bytes with the shared
Freshness verifier, and returns bytes only after a matching finalization
receipt. A mismatched signer operation or unknown signer/persistence outcome
returns no bytes and retains the modeled blocker; same-operation retries do
not re-sign.

| Boundary | Current contract |
|---|---|
| APP | Existing single 10-second monotonic request/verification deadline. It is not a new guarantee that state persistence always returns within 10 seconds. |
| Freshness Gateway | Separate 7-second HTTP response deadline. Client disconnect/timeout does not prove signer work stopped or release an issue blocker. |
| Freshness signer lease | Maximum 8 seconds from acquisition, bounded by the selected clock's uncertainty. This is an authorization bound, not an SLO; expiry rejects signing/finalization but does not erase an unresolved operation. |
| Final response | Only exact bytes/digest durably finalized for the same operation, request, lease, release generation, and fence may be returned. |
| External signer | The model enforces logical return-path fencing only. It does not claim that HSM work physically stops. |

The provider-independent core's Node tests inject a fake clock, test signer,
map-backed operation store, and synthetic witness. Those snapshot-restoration
tests remain protocol-model evidence only. Separately, a dedicated
SQLite-backed Durable Object adapter now runs through the pinned local
Miniflare/workerd runtime, with a temporary storage path and explicitly
test-only clock, witness, bootstrap, Release controls, and fault injection.
Its 16 integration cases verify concurrent operation admission, blocker
retention, exact finalized-byte persistence, and operation lookup after
disposing and recreating the runtime with the same Durable Object ID. This is
local runtime evidence, not Production clock bounds, independent PITR
resistance, HSM idempotency/cancellation, or deployed authority.

| Evidence | Status |
|---|---|
| Shared issuer source | **SOURCE_IMPLEMENTED** |
| Domain Node tests and type-check | **NODE_UNIT_VERIFIED**; 24 tests pass locally |
| Local SQLite DO adapter and issuer-core integration | **LOCAL_WORKERS_RUNTIME_VERIFIED**; 16 pinned Miniflare/workerd integration cases pass, including concurrency and runtime recreation; no Production binding is wired |
| Hosted CI | **NOT_CHECKED** |
| Production signer, Journal, DO binding/coordinator authority, R2 adapter, trusted clock, independent witness, routes and registrations | **NOT_IMPLEMENTED / BLOCKED** |
| Stage A/B/C and Production acceptance | **BLOCKED** |

Reproduce the local adapter suite with
`pnpm --dir packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR run test:runtime`.
Hosted CI has not been run. The next implementation boundary is reviewed
Production adapter conformance and registration for the trusted clock, signer
operation ledger/HSM, Release Journal/checkpoint, R2 reader, and independent
rollback witness. Do not select or register a provider from the local test
model. The checked-in
[Web device-proof route](../FUSOU-WEB/src/server/routes/anonymous-sync-v2.ts)
and [Worker device-proof client](../FUSOU-TLSN-VERIFICATION-WORKER/src/device-proof-client.ts)
exist in source; their existence does not establish deployment, domain
routing, production authorization, or real service verification.

## Current Release reader and snapshot status — 2026-11-08

Hosted run [#115](https://github.com/tsukasa-u/FUSOU/actions/runs/42484486660)
passed all three candidate jobs for baseline
`8a87314a055f45d37f1ae5b0524561575ab9b7ea`. That run predates this follow-up;
the current changes have not been run on Hosted CI (**NOT_CHECKED**).

The shared
[current-state reader](../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/freshness-current-state-reader.ts)
now verifies the exact Release Commit Record/delegation, injected Journal
receipt and latest-head proof, signed Manifest, R2 pointer/ETag and
content-addressed immutable Manifest envelope, Coordinator snapshot, and
injected external-witness evidence. The issue core performs the verification
before and after signing; tests confirm that changed or invalid current state
does not release response bytes. The local test Journal and witness
signatures are test-only and are not an approved Production evidence format.

The SQLite-backed
[Coordinator snapshot RPC](../FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/src/sqlite-freshness-issue-coordinator.ts)
checks the operation, lease, fence, writer state, current head, witness, and
restore epoch in one synchronous storage transaction. It is a private DO RPC,
not an HTTP endpoint. The Node
[R2 store](../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-r2-store.mjs)
now reads the exact current signed-envelope pointer and immutable snapshot;
the publisher writes and verifies the immutable snapshot before pointer CAS.
The mutable pointer's body is still the signed Manifest envelope itself.

| Evidence | Status |
|---|---|
| Freshness issue core | **SOURCE_IMPLEMENTED / NODE_UNIT_VERIFIED**; Domain typecheck and 26/26 tests pass locally |
| Provider-neutral Release reader | **SOURCE_IMPLEMENTED**; local issue-core integration uses test-only Journal/witness adapters |
| SQLite Coordinator snapshot and reader/core integration | **LOCAL_WORKERS_RUNTIME_VERIFIED**; 20/20 pinned Miniflare/workerd integration cases pass, including snapshot RPC, runtime recreation, issue/replay, and state-change rejection |
| Node R2 read adapter and immutable Manifest publication | **SOURCE_IMPLEMENTED / LOCAL_TEST_VERIFIED**; R2-store tests 12/12 and Manifest/publisher tests 25/25 pass against fake clients |
| Production Journal/latest-head and authenticated append-time contract | **UNRESOLVED / NOT_IMPLEMENTED** |
| Production trusted clock, independent witness/checkpoint and restore epoch | **NOT_IMPLEMENTED / BLOCKED** |
| Production R2 permissions/registration, HSM/signer, Release authority and deployment | **NOT_IMPLEMENTED / BLOCKED** |
| Hosted CI after this follow-up | **NOT_CHECKED** |
| Production acceptance and Stage A/B/C | **BLOCKED** |

No Production R2, Journal, DO, signer/HSM, or deployment operation was
performed. The local snapshot reload does not prove Production PITR
resistance or independent anti-rollback. APP's 10-second deadline, Gateway's
7-second deadline, and the 8-second issue authorization bound are unchanged;
the lease is not an SLO.

## Successful-capture material handoff — source implementation

The local finalizer consumes the exact candidate bytes and overlays them onto
the existing 19-role material manifest before calling the existing independent
verifier. The eleven candidate-available roles are `presentation`, `result`, `health`,
`session`, `device_authentication`, `possession_proof`, `consume_receipt`,
`result_registry`, `result_registry_envelope`, `capture_metadata`, and
`subject`. The original five roles retain their candidate paths; the finalizer
also forwards the captured device-authentication request, capture
`metadata.json`, exact runtime Result registry bytes, and exact
`worker-health.json` response body, and derives `subject` hashes from the
strictly parsed candidate Result. The verifier rechecks the generated subject
against its independently verified Result; it is not an identity source.

Candidate-supplied bytes are checked against any same-role descriptor already
present in the external manifest. When the descriptor is absent, its path,
length, and digest are added only in memory to the material manifest. The
finalizer can generate `semantic_verification` only when that role is absent.
It runs the shared independent verification core over the exact Presentation,
Result, trust inputs, profile, observed target, and Session bindings before
building the report from the derived values. It does not treat manifest PASS
declarations or a copied input Result as verification. This report-generation
step is not complete-Bundle verification: the finalizer then runs the ordinary
strict verifier with all 19 roles, including the generated report, before
publishing any output. An externally supplied semantic report is never
replaced; if it is invalid, finalization fails. Missing other roles or any
verification failure prevent publication.

The material input must have `verification_status: NOT_CHECKED`; only after
strict verification succeeds does the finalizer set the published manifest to
`VERIFIED`. The artifact's `offline_finalizer` provenance identifies this
local report-generation path only. `verifier_identity` and `verified_at` do not
establish Production execution authority, trusted process/image identity, or an
external timestamp. Overall, Production, and P0-05 statuses remain `BLOCKED`.

Local regression coverage now exercises actual Complete and Sparse
`finalize_candidate` outputs through ordinary Rust `verify_bundle` and the
Worker's Node `assertProductionEvidenceManifest` contract. The Node check uses
the published manifest/report bytes, not a separately assembled success
fixture. These synthetic cross-runtime checks do not establish Hosted CI or
Production acceptance.

The current source classification is 11 candidate-connected roles, one
offline-generated semantic report, one offline replay-observation collector,
and six independent external inputs (19 roles total). The collector is
source-implemented and locally verified, but the replay artifact is not yet
acquired from a real Production authority. Stage acceptance remains blocked
by the six independent inputs, real material acquisition and the retained
execution-receipt gate.

| Classification | Roles | Current boundary |
|---|---|---|
| `EXTERNAL_INPUT_REQUIRED` | `notary_registry`, `authenticated_user`, `device_identity`, `session_authority_registry`, `binding_authority_registry`, `trust_root` | Require independently supplied raw material and trust pins; candidate declarations or embedded Bundle keys cannot serve as pins. |
| `OFFLINE_COLLECTION_SOURCE` | `replay` | Explicit collector and local authority/mock checks are verified; a real Production rejection remains `NOT_CHECKED`. |
| `OFFLINE_GENERATED` | `semantic_verification` | Generated by the local finalizer only after the actual independent verification core succeeds; this is not an APP candidate artifact or Production execution authority. |

`health` is now `AVAILABLE_AND_CONNECTED` for new APP candidates. APP fetches
the Worker `/health` response once during proxy initialization using the
existing 10-second, no-redirect client, rejects bodies over 1 MiB, validates
the parsed schema and independently configured identity, then retains the same
body bytes. The cap reuses the existing 1 MiB APP Runtime Config artifact
bound. An immutable snapshot is copied into each capture context and
saved as create-only `worker-health.json`; its candidate descriptor records
the exact byte length and SHA-256. No JSON reserialization or second health
request is used for the evidence role.

The health snapshot is unsigned. APP validation against Runtime Config, HTTPS
transport, exact-byte retention, and offline verifier consistency checks are
separate facts; none turns the response into a signature, process/image
attestation, or Production authority. The snapshot is fetched before the
forwarder is installed and reused immutably across captures for that runtime.
There is no health TTL or freshness contract, so it does not prove that the
reported deployment is current at each capture time. Existing candidates
without `worker-health.json` may still use the external `health` material; if
both sources provide health, their exact bytes must agree with the external
descriptor and file. If neither source provides it, finalization reports the
missing role.

Origin Inventory and Target Approval remain independent raw CLI inputs, not
Evidence roles; Production Result requires their digest pair. Additional
independent verifier options include the Result evidence-root pin, user/device
pins, profile hashes, verifier key ID, and the Web PKI DER trust anchor.
The candidate execution receipt remains a separate required gate, and its
current Canary producer is not a Production authority.

The reproducible local invocation remains the existing CLI:

```sh
cargo +1.98.1 run --locked --offline \
  --manifest-path packages/FUSOU-TLSN-VERIFIER/Cargo.toml \
  --bin verify_fusou_tlsn_evidence -- \
  --bundle /secure/material-input/manifest.json \
  --finalize-candidate /secure/candidates/<capture-id> \
  --replay-observation /secure/material-input/replay-observation.json \
  --output /secure/evidence/<new-directory> \
  --evidence-root-key-id <independently-approved-id> \
  --evidence-root-public-key-spki <independently-approved-spki> \
  --trusted-notary-registry /secure/trust/notary-registry.json \
  --session-authority-registry /secure/trust/session-authority-registry.json \
  --session-authority-key-id <independently-approved-id> \
  --session-authority-public-key-spki <independently-approved-spki> \
  --binding-authority-registry /secure/trust/binding-authority-registry.json \
  --binding-authority-key-id <independently-approved-id> \
  --binding-authority-public-key-spki <independently-approved-spki> \
  --canonical-user-id <independently-pinned-uuid> \
  --device-id <independently-pinned-uuid> \
  --device-public-key <independently-pinned-key> \
  --server-identity <canonical-lowercase-dns-hostname> \
  --origin-inventory /secure/trust/origin-inventory.json \
  --target-approval /secure/trust/target-approval.json \
  --profile-sha256 <approved-profile-digest> \
  --verifier-key-id <approved-verifier-id> \
  --trust-anchor-der /secure/trust/web-pki-anchor.der
```

The sidecar is optional when a material manifest already supplies `replay`.
For an explicit collection, the operator runs the one-shot candidate-only
collector separately, using the authenticated WEB owner endpoint and an
authorized token from the environment:

```sh
FUSOU_REPLAY_OBSERVATION_ENDPOINT='https://<WEB-host>/api/auth/anonymous-sync/v2/tlsn-device-proof' \
FUSOU_REPLAY_OBSERVATION_BEARER_TOKEN='<authorized-user-token>' \
node packages/FUSOU-TLSN-VERIFIER/scripts/collect-replay-observation.mjs \
  /secure/candidates/<capture-id> \
  /secure/material-input/replay-observation.json
```

This sends the saved candidate proof only to WEB's read-only observation mode;
it does not call the Worker verification route, Game Server or Notary and
never retries. The response is an unsigned observation, not an authority
receipt. The finalizer compares a sidecar byte-for-byte with any externally
supplied `replay` role and refuses conflicts.

`material-input/manifest.json` must still describe the other required role
materials, evidence predicates, timestamps, and trust graph; the finalizer
does not manufacture these claims. The paths above are placeholders for
separately obtained and approved inputs, not a way to trust candidate content.
An output path must be new. Test-only full-path fixtures use an ephemeral
CA/server certificate and TLSN Presentation over in-process duplex TLS,
temporary Ed25519 keys, and synthetic authority, identity, receipt, registry,
and health materials. With no semantic report pre-supplied, the real
`finalize_candidate` entry point generates it for both Complete and Sparse
Results, publishes all 19 roles, checks saved bytes/lengths/digests, and
reopens the output through ordinary `verify_bundle`. Negative cases reject
missing roles, cross-session/user/device material, Presentation and Result
mutation, external trust-root and Notary-pin mismatch, profile and target
identity mismatch, invalid externally supplied semantic reports, and missing
or mismatched execution-receipt bytes without publishing output.

This establishes **SOURCE_IMPLEMENTED / LOCAL_TEST_VERIFIED** for the
synthetic contract path only. The fixture's production-shaped schema values
and test-only receipt do not represent real services, approved authorities,
Production material, or Production finalization. The material input remains
`NOT_CHECKED`; output verification may become `VERIFIED` while overall,
Production-evidence, and P0-05 statuses remain `BLOCKED`. Real Production
finalization remains **UNVERIFIED**, and Stage A/B/C and Production acceptance
remain **BLOCKED**.

For a structurally valid `NOT_CHECKED` manifest with all eleven current
candidate materials, but without the six external roles and without either an
external replay artifact or an explicit sidecar, the finalizer reports those
seven unavailable materials. `semantic_verification` is not listed as missing
because the eligible finalizer path can generate it. Replay now has a
collection source; this diagnostic does not mean that a real replay response
has been acquired:

```text
required evidence roles are missing: notary_registry, authenticated_user, device_identity, replay, session_authority_registry, binding_authority_registry, trust_root
```

Older candidates without `worker-health.json` can still use an external
`health` role; if both candidate and external sources provide it, exact bytes
must agree. If neither source provides health, `health` is included in the
missing-role list.

If the exact Result registry and signed envelope are absent from the candidate,
both roles are also reported; if only one is present, the candidate entry point
rejects the incomplete pair. Structural manifest/status, timestamp, and
predicate validation remains mandatory. Once that passes, the finalizer reports
the stable-order list of missing non-generated roles before checking
evidence-item artifact dependencies. The semantic report is generated only
when its prerequisites are available; all dependencies and the trust graph are
then checked again through the ordinary complete-Bundle verifier. Invalid
paths, byte digests/lengths, schemas, signatures, or trust inputs remain
rejection cases; no failure publishes an output directory or completion
marker.

## Previous independent remediation audit — pre-decision snapshot at baseline `7c54b933e01762ce65968c4a3f3a2a76fc50a7dd` (2026-11-06)

The following audit is retained as a historical record from before the
capture-scoped policy was selected. Its authority-reservation blocker and
validation results do not override the current policy above.

This is the newest source-backed assessment in this file. The dated sections
below are historical snapshots at their stated baselines; their test results
and status labels are not evidence for the current HEAD.

### Git and scope

- Repository: `tsukasa-u/FUSOU`
- Branch: `tlsn-first-testplay-candidate`
- Starting HEAD: `7c54b933e01762ce65968c4a3f3a2a76fc50a7dd`
- Parent: `bbf1811cdbb6503ccec5851929da5b755dfc4496`
- The index and working tree were clean at audit start when checked with the
  protected paths excluded. No `.codegraph/` directory or `AGENTS.md` was
  found.
- The root `justfile` and APP roaming `configs.toml` were not inspected,
  searched, listed by Git status/diff, tested, built, changed, or staged.
- No Production resource, secret, deployment, migration, real Game Server,
  Notary, game traffic, or human gameplay was used.

### Current source findings

| Area | Current evidence | Status and boundary |
|---|---|---|
| Production identity and Result binding | Worker [index](../FUSOU-TLSN-VERIFICATION-WORKER/src/index.ts) derives identity from the inspected TLSN Presentation, resolves it against the independently pinned Origin Inventory and Target Approval, and checks the prepared Result against exact Presentation bytes and both digests. Production task validation requires both digests. The Rust Complete v2 / Sparse v3 Result serializers and verifier retain the signing-domain and digest checks. | **OBSERVED in source; synthetic tests only.** No real Presentation or Production Result was verified. |
| Origin attempt and retry | The APP/Proxy [origin journal](../FUSOU-PROXY/proxy-https/src/production_tlsn.rs) records a binding-derived digest, canonical target, and serialized request digest before origin I/O. Restart converts an unfinished send to `Unknown`; that attempt is not replayable. | **No authority-issued reservation.** A new binding yields a new local attempt key. Under the selected capture-scoped contract, cross-capture semantic deduplication and exactly-once operation authority are not requirements and are not Stage B blockers. |
| Candidate materials | The verified APP Runtime Config supplies seven exact public artifacts to the Proxy [candidate writer](../FUSOU-PROXY/proxy-https/src/real_tlsn.rs). The offline [finalizer](./src/evidence_bundle/finalization.rs) forwards eleven candidate-available roles, including the exact bounded Worker health response, and derives subject hashes from the strict Result. When absent, it generates `semantic_verification` only after its shared independent verification core succeeds. A separate explicit collector accepts a read-only replay sidecar for `replay`; it does not run during capture. | **PARTIAL CONNECTION; full collection remains BLOCKED.** Six roles require independent external input, and no real Production replay response is acquired. Runtime Config artifacts remain supporting material, not seven new roles; the offline report is not an APP candidate artifact or Production authority. |
| Execution receipt | Candidate finalization still requires exact receipt bytes and the matching header encoding. The Worker receipt implementation remains Canary-scoped; no approved Production receipt issuer/verification contract was found. | **BLOCKED.** No Canary-to-Production promotion, synthetic receipt, or receipt-gate bypass was added. |
| Runtime Config Freshness / P2 | At this earlier audit snapshot, the signer interface lacked operation/lease/fence/finalization bindings and no issuer core existed. | **Historical snapshot only; superseded by “Current Runtime Config Freshness issuer-core status” above.** The current shared core is locally verified; Production adapters remain **NOT_IMPLEMENTED / BLOCKED**. |
| Freshness deadlines | APP creates its 10-second monotonic deadline immediately before the Freshness POST and checks it through verification and the pre-replace guard. State persistence then writes/fsyncs a temporary file, renames it, and syncs the parent directory. No deadline check follows rename and parent-directory sync before successful return. If the parent sync fails after rename, the writer returns an error although the local high-water may already have advanced; it is not rolled back. | **No worst-case 10-second durable-acceptance guarantee is established.** Rename, durability completion, return, and use of the verified config are distinct. Performance is **NOT MEASURED**; no post-rename error or high-water rollback was introduced. |
| Eight-second issue lease | At the time of this earlier snapshot, the P2 design's SLO wording conflicted with the normative at-most-eight-second lease. | **Historical note:** the SLO interpretation is rejected. The maximum eight-second authorization lease remains the contract; Production clock/finalization adapters are unselected and blocked. |
| Historical `undefined.length` failure | The previously reported smoke/finalizer test names and error text were not found in the current tracked source/workflow search. | **NOT_CHECKED against historical run logs.** This audit does not claim that the old CI failure was fixed or reproduced. |

### Earlier local validation snapshot (before evidence material handoff)

| Check | Result | Scope |
|---|---|---|
| APP acceptance-stage and pre-capture tests, Worker Freshness and Production evidence graph tests, new Production Result contract tests (`node --test`) | **95 passed, 0 failed** | Synthetic/local contracts; no live service or Production evidence. |
| Runtime Config domain typecheck | **PASS** | Shared TypeScript wire/domain package. |
| Runtime Config domain golden-vector tests | **6 passed, 0 failed** | JS validators and shared vectors; not a Production authority test. |
| Worker TypeScript typecheck | **PASS** | `tsc --noEmit`; no deployment. |
| Independent Verifier library and candidate finalizer (`cargo +1.98.1 test --locked --offline --manifest-path packages/FUSOU-TLSN-VERIFIER/Cargo.toml --lib`) | **140 passed, 0 failed, 0 ignored** | Synthetic/local fixtures; does not establish real evidence validity. |
| APP/Proxy Cargo tests or builds | **NOT RUN** | The APP/Proxy dependency graph includes `packages/configs`, whose Rust source uses compile-time `include_str!` on the protected APP roaming config. |
| Hosted CI for this local working tree | **NOT RUN** | Workflow edits are local and have no corresponding hosted run. Older run #108 is not evidence for this baseline. |
| Production resources, real Game Server/Notary, real capture, human gameplay | **NOT RUN** | No Production acceptance evidence was created. |

The candidate [CI workflow](../../.github/workflows/tlsn-testplay-candidate.yml)
includes the Freshness, Production Result, trust-graph, acceptance-stage,
pre-capture, and independent Verifier library checks. Current material collection diagnostics now distinguish eleven
candidate-connected roles, the six roles requiring external input, and the
two roles whose producers are not implemented.

### Current successful-capture material handoff validation

| Check | Result | Scope |
|---|---|---|
| Verifier library and finalizer CLI (`cargo +1.98.1 test --locked --offline --manifest-path packages/FUSOU-TLSN-VERIFIER/Cargo.toml --lib --bin verify_fusou_tlsn_evidence`) | **148 library tests and 5 CLI tests passed; 0 failed, 0 ignored** | Includes the test-only `finalize_candidate` → publish → ordinary `verify_bundle` path, actual-entry missing-role diagnosis, candidate/external health fallback and mismatch, and negative cases; synthetic/local fixtures only. |
| APP exact Worker health snapshot tests (`cargo +1.98.1 test --locked --offline --manifest-path packages/FUSOU-APP/src-tauri/Cargo.toml --features tlsn-production --lib tlsn_runtime`) | **44 passed, 0 failed; 47 filtered** | Actual APP library test target; includes exact-byte retention, malformed/oversized response, identity mismatch, and runtime-config tests. Filtered tests were not run by this selector. |
| Proxy health/candidate tests (`cargo +1.98.1 test --locked --offline --manifest-path packages/FUSOU-PROXY/proxy-https/Cargo.toml --features alpha15-tlsn --lib health`) | **4 passed, 0 failed; 179 filtered** | Actual Proxy package library tests; verifies immutable capture snapshots, exact candidate health inventory, and one origin send on health artifact export failure. Filtered tests were not run by this selector; this is not a full Proxy suite or integration test. |
| Isolated Proxy capture harness, Rust 1.98.1 (`cargo check --locked --offline --lib`, then `cargo test --locked --offline --lib`) | **Type-check PASS; 29 passed, 0 failed, 0 ignored** | Direct references to the actual Proxy source and nested tests; not a full Proxy package build or integration test. |
| Acceptance-stage readiness Node test | **3 passed, 0 failed** | Local stage diagnostics; no readiness promotion. |
| Full synthetic 19-role finalization success fixture | **LOCAL TEST VERIFIED** | The actual `finalize_candidate` publishes all 19 test-only roles and the ordinary `verify_bundle` revalidates the saved output; ephemeral loopback TLS/Notary and synthetic authorities are not Production evidence. |
| Rust formatting (`rustfmt +1.98.1 --edition 2021 --check` on changed Rust sources) | **PASS** | Formatting validation only; distinct from type checking and test execution. |
| Candidate workflow YAML parse; scoped diff and updated-document link checks | **PASS** | Static local checks only; `actionlint` and Prettier were unavailable locally. |
| Candidate workflow on a GitHub-hosted runner | **NOT RUN** | The workflow now connects the APP health selector, Proxy health/candidate selector, Verifier library, and isolated capture harness; local test success is not hosted-CI evidence. |
| Real Production material / real Game Server, Notary, or testplay | **NOT RUN** | No Production acceptance evidence was created. |

Rust type-checking, unit tests, formatting checks, and hosted CI are separate
claims. The results above do not establish Stage A/B/C or Production
acceptance.

`IDENTITY_BOUND_TESTPLAY_READY` remains **BLOCKED_CODE /
BLOCKED_EXTERNAL_INPUTS**. Stage A, Stage B, Stage C, and Production acceptance
remain **BLOCKED**. Browser integrity and APP process/image authority remain
outside scope; AD-5 remains **OUT_OF_SCOPE**.

## Historical identity-bound testplay snapshot — audit base `bbf1811cdbb6503ccec5851929da5b755dfc4496`

This continuation rechecked the current source path and readiness boundary
without registering Production trust, changing a service, or performing a
testplay.

### Git and hosted-CI baseline

- Repository: `tsukasa-u/FUSOU`
- Branch: `tlsn-first-testplay-candidate`
- Starting HEAD: `bbf1811cdbb6503ccec5851929da5b755dfc4496`
- Parent: `ab818c266361b582eef86d001afc40bf2c467706`
- The local tracking ref and the GitHub branch API both reported the same HEAD
  when checked. The scoped worktree and index were clean; protected
  configuration paths were excluded from status and content inspection.
- Latest observed hosted workflow: [run #108](https://github.com/tsukasa-u/FUSOU/actions/runs/41401374741),
  `TLSN testplay candidate checks`, completed successfully for the exact
  starting SHA. This predates the local changes described in this continuation
  and is not evidence of live service operation or game-server acceptance.

### Current source findings

| Boundary | Current observation | Status / limit |
|---|---|---|
| TLSNotary revision and interoperability | The [alpha.15 audit](../../docs/implementation-plans/tlsnotary-alpha15-revision-attestation-id-interoperability-audit.md) records the effective patched source graph and local characterization. | P0-01 factual mapping has evidence; independent compatibility, security, and license approval remains `BLOCKED_EXTERNAL_INPUTS`. P0-10 remains `UNRESOLVED`; the source-derived corpus is not an owner-approved normative oracle. |
| APP Runtime Config / Freshness | [RuntimeConfigManager::refresh](../FUSOU-APP/src-tauri/src/tlsn_runtime_config_runtime.rs) calls the Freshness verifier before returning a verified Manifest. The verifier uses the signed `LATEST_AT_ISSUANCE` response and local high-water state. | The checked-in Worker has no Runtime Config Freshness route or service adapter. Production Bootstrap values, signer/delegation, endpoint and service registration remain `NOT_REGISTERED` / `NOT_IMPLEMENTED`; the APP path cannot treat this as configured. No P2 or wire-contract change was made. |
| WEB Device Proof | The Worker client calls both exact-owner handlers mounted by [anonymous-sync-v2.ts](../FUSOU-WEB/src/server/routes/anonymous-sync-v2.ts); [the migration](../FUSOU-WEB/supabase/migrations/20261030000000_tlsn_device_proofs.sql) locks/rechecks the existing device row and atomically consumes proof/replay claims. | Source implementation is present. Deployment, real owner enrollment, live Supabase migration and service behavior are `NOT_CHECKED`; no migration was applied. |
| Worker Result and raw archive | In Production inventory mode, the Worker archives and reads back the exact Presentation and outer Result, binds the archive snapshots to the authority record, and only then commits the verified Result. | `OBSERVED` in source, not a deployment claim. Stage C whole-Bundle remote delivery/retention is separate and remains `NOT_IMPLEMENTED`. |
| Evidence roles and local finalization | The [offline verifier](./src/evidence_bundle.rs) requires the existing 19 roles. The [candidate finalizer](./src/evidence_bundle/finalization.rs) supplies five candidate artifacts and requires the other role material separately; it rejects a missing execution-receipt sidecar and checks its exact header/bytes. | No role is fabricated or relaxed. A candidate receipt sidecar does not become a 20th role or a Production trust root. The current capture path does not collect all authoritative real-material roles end to end. |
| Execution receipt | The optional receipt is Canary-scoped in the Worker implementation. Candidate capture is marked complete only when receipt bytes exist; synchronous Production handling does not create that Canary receipt. | The retained receipt gate remains. No Production execution-receipt authority, registry, or independent approval was found/registered; Canary material is not promoted to Production evidence. |
| Origin send | The APP/Proxy durable local journal keys a send record from the issued binding digest, records target/request digest before transport, and persists `NotSent`, `Unknown`, or `ResponseReceived`. An unfinished send becomes `Unknown` on restart. | This is local single-use/recovery evidence, not a dedicated authority-issued reservation binding an authenticated request and target to a durable logical origin-attempt ID. That contract remains a Stage B code blocker; ambiguous origin sends are not retried. |
| Pre-capture report | The existing preflight keeps `gameplay_authorized=false`, target identity `NOT_YET_OBSERVED`, and Production acceptance `BLOCKED`. | This continuation adds the missing authority-issued logical origin-attempt blocker to the machine-readable Stage B report; it does not grant capture or gameplay permission. |

### Validation and current decision

| Check | Result | Scope |
|---|---|---|
| Verifier library tests, `cargo test --manifest-path packages/FUSOU-TLSN-VERIFIER/Cargo.toml --locked --offline --lib` | **140 passed, 0 failed, 0 ignored** | Local tests; TLSN fixtures and test keys are synthetic. Does not verify a real Presentation or external service. |
| Focused candidate finalization tests | **14 passed, 0 failed** | Local byte-binding, receipt-presence, missing-material and fail-closed output tests. |
| Worker contract suites under Deno (`--no-check`, sanitized environment) | **140 passed, 0 failed** | Device Proof client, Freshness, Manifest, Bootstrap trust and Production evidence trust-graph fixtures; no network permission. This is not the Worker TypeScript typecheck. |
| APP pre-capture and acceptance-stage helpers under Deno (`--no-check`, sanitized environment) | **15 passed, 0 failed** | Report/preflight contract only; no APP launch, protected config use, or gameplay. |
| Latest hosted workflow at starting SHA | **PASS** | Run #108; completed before this continuation's uncommitted change. |
| Node/Vitest, Worker TypeScript typecheck, WEB PostgreSQL integration, APP/Proxy Cargo checks | **NOT RUN** | Node/npm/pnpm are unavailable in this environment. Deno execution used `--no-check`; no typecheck was established. No live service or external database was used. |
| Production resources, real Game Server/Notary, human gameplay | **NOT RUN** | No Production secrets, trust roots, migrations, deployment, R2 operation, real capture, or game traffic. |

The only implementation change in this continuation is additive blocker
reporting and its regression assertion. It does not create the missing
authority, weaken a trust boundary, alter the 19-role schema, remove the
candidate receipt requirement, or enable Stage A as an independent APP path.

`IDENTITY_BOUND_TESTPLAY_READY` remains **BLOCKED_CODE /
BLOCKED_EXTERNAL_INPUTS**. Stage A, Stage B, Stage C, and Production acceptance
remain **BLOCKED**. Stage C's full-Bundle remote delivery is not a Stage B
acceptance condition; the existing Worker raw Presentation/outer-Result archive
readback and candidate finalizer receipt gate remain intact.

## Phase 1 follow-up verification — audit base `4183a4c6d54b92f253504546a4e674cae682d866`

The follow-up audit started on branch `tlsn-first-testplay-candidate` at
`4183a4c6d54b92f253504546a4e674cae682d866`, parent
`2211b3964c8779f5032a5444165eb9daaa2ccca7`. The index was empty. Existing
local edits to the root `justfile` and APP roaming config were preserved and
excluded from this work.

| Area | Status | Evidence and limit |
|---|---|---|
| Test-only release/freshness authority | **VERIFIED — TEST ONLY** | The focused Freshness suite passed 21/21. It exercises signer-clock `authorized_at`, strict Journal append ordering, exact-attempt replay rejection, orphan signatures, every commit/recovery boundary, ambiguous R2 outcomes, restart chain validation, multiple leases, and recovery waiting. The adapter does not provide production service bindings. |
| Related Runtime Config Worker tests | **VERIFIED — LOCAL TESTS** | 79/79 Freshness, Manifest, R2-store, publisher-readiness and Bootstrap trust tests passed with zero skips. |
| Worker TypeScript | **VERIFIED** | `npm run typecheck` passed. No Worker runtime source or binding was changed. |
| APP `tlsn-production` build/check | **VERIFIED — LOCAL** | `cargo check --features tlsn-production --lib` passed. |
| APP Runtime Config/preflight Rust tests | **VERIFIED — LOCAL** | `cargo test --features tlsn-production --lib tlsn_runtime_config` passed 28 tests; 57 unrelated tests were filtered out. This compiled and exercised the changed final-deadline state-preservation test. |
| Rust formatting | **PARTIAL** | `rustfmt --edition 2021 --check` passed for the changed Freshness Rust file. Workspace `cargo fmt --check` reports existing formatting differences in unrelated files; those files were not reformatted. |
| Hosted CI | **NOT_CHECKED** | No hosted workflow was started or observed for this follow-up. |
| Production Freshness implementation | **NOT_IMPLEMENTED** | There is no deployed route, production DO/R2/Journal/HSM adapter, binding, key, or registration. The in-memory adapter and genesis sentinel are tests only. |
| Human trust-owner approval / Production registration | **BLOCKED** | Trust-owner approvals, Release/Freshness key custody, Journal authority/retention, service registration and APP release remain external prerequisites. |
| Stage A — protocol-only `TLSN_PROTOCOL_TESTPLAY` | **BLOCKED** | No qualifying protocol-only testplay or approved live inputs were supplied. |
| Stage B — identity-bound `IDENTITY_BOUND_TESTPLAY` | **BLOCKED** | No real Game Server, Notary or identity-bound testplay was performed. |
| Stage C — `PRODUCTION_EVIDENCE_DELIVERY` | **BLOCKED** | No Production signer, Journal, Freshness service or evidence delivery was registered or exercised. |
| Production acceptance / deployment / real-game evidence | **BLOCKED** | Local tests and builds do not establish deployment, real Presentation/Result validity, gameplay, or Production acceptance. |

`authorized_at` in the in-memory adapter is sampled from its injected test
clock, not supplied by a caller. The Phase 0 contract has no separate
authorization-to-append age limit beyond strict delegation bounds and
`authorized_at <= appended_at`; see the protocol follow-up record for the
resulting constraint and why no unapproved threshold was invented.

## Initial Phase 1 implementation snapshot (historical) — based on `b2a546986aaa31eae46aa8944304df6508d83be1`

The implementation work started on branch `tlsn-first-testplay-candidate` at
`b2a546986aaa31eae46aa8944304df6508d83be1`, parent
`42bd255bb128bef97b1d6e01fb3dbcf323437fd6`. The source/test implementation
is committed as `2211b3964c8779f5032a5444165eb9daaa2ccca7`; this record
distinguishes local protocol code and tests from deployed Production
readiness.

| Area | Status | Evidence and limit |
|---|---|---|
| Worker Freshness verifier and in-memory authority adapters | **VERIFIED — TEST ONLY** | Twelve adversarial Node tests pass against fake in-memory R2, Journal, DO, clocks and ephemeral test keys. The verifier is under Worker `scripts/`; it is not imported by the deployed Worker entry point and does not use Cloudflare DO, R2, Journal or HSM bindings. |
| APP Freshness source path | **OBSERVED / UNVERIFIED** | Feature-gated Rust verification, a dedicated bounded Freshness HTTP client, exact Manifest snapshot/artifact checks, state-v2 high-waters, v1-state migration and final synchronous atomic-rename deadline check are present. Rust compilation and execution were not verified. |
| APP epoch state failure behavior | **OBSERVED** | Valid v1 state is retained as a migration high-water; malformed or unsupported state fails closed rather than resetting the high-water. New state is persisted only after full Manifest/artifact verification. |
| APP Rust tests | **NOT_CHECKED** | Focused state-migration, corrupt-state and failed-final-check tests were added but not run. Cargo would compile `packages/configs`, whose source uses `include_str!` for protected `configs.toml` files; the requested protection against reading those files therefore prevents Cargo validation. Rust formatting/syntax check passed. |
| Worker TypeScript typecheck | **VERIFIED** | `npm run typecheck` passed. |
| Freshness and existing Runtime Config Worker tests | **VERIFIED — LOCAL TESTS** | The focused Freshness suite passed 12/12; the combined Freshness, Manifest, R2-store, publisher-readiness and Bootstrap trust suites passed 70/70 with zero skips. No R2 integration test or live service was run. |
| Hosted CI for this implementation | **NOT_CHECKED** | No hosted run was started or observed for this implementation. |
| Production Freshness endpoint and service adapters | **NOT_IMPLEMENTED** | No deployed Worker route, DO, HSM, Journal, production R2 access, binding or key was added or registered. The test-only genesis sentinel is not a Production genesis-approval contract. |
| Human trust-owner approval / Production registration | **BLOCKED** | Root-signed delegations, HSM custody, Journal genesis/retention/access authority, DO/R2/service registration, endpoint and APP release remain external prerequisites. |
| Stage A — protocol-only `TLSN_PROTOCOL_TESTPLAY` | **BLOCKED** | This local test implementation is not a protocol-only testplay and supplies no required live or approved inputs. |
| Stage B — identity-bound `IDENTITY_BOUND_TESTPLAY` | **BLOCKED** | No real Game Server, Notary or identity-bound testplay was performed. |
| Stage C — `PRODUCTION_EVIDENCE_DELIVERY` | **BLOCKED** | No Production signer, Journal, Freshness service or evidence delivery was registered or exercised. |
| Production acceptance / deployment / real-game evidence | **BLOCKED** | Local tests do not establish deployment, real Presentation/Result validity, gameplay, or Production acceptance. |

`RuntimeConfigManager::refresh` now uses the Freshness path and does not fall
back to the old direct Manifest GET path. The old 15-second generic Manifest
fetcher remains available to the existing private test helper; the Freshness
path has its own 2-second connect / 10-second request limits and one 10-second
monotonic acceptance deadline through the pre-rename check. The Worker scripts
and in-memory adapters are test scaffolding only, not a Production service.

## Historical Phase 0 review-start snapshot — HEAD `42bd255bb128bef97b1d6e01fb3dbcf323437fd6` (2026-11-01)

## Source/readiness snapshot at review start — HEAD `42bd255bb128bef97b1d6e01fb3dbcf323437fd6` (2026-11-01)

At review start, the inspected branch was `tlsn-first-testplay-candidate`;
local HEAD was `42bd255bb128bef97b1d6e01fb3dbcf323437fd6`, with parent
`891ec66a729da4dc832cb70fbd6ff5cd3e620cae`. This is a local documentation
follow-up to the previous Phase 0 review snapshot `254967c4fb77d279a608da91b8836b5b9d8f551e`;
it has not been pushed. The runtime-source baseline remains
`43ab72e6284deee3ad202be7fb50e3f0199af304`; the scoped APP/Worker
Runtime Config source-path comparison found no source changes from that
baseline. At task start, the worktree had only the pre-existing
[justfile](/home/ogu-h/Documents/GitHub/FUSOU/justfile) and APP roaming
config edit, with an empty index; both were preserved.

### Historical verification status at that review start

| Area | Status | Evidence and limit |
|---|---|---|
| Hosted workflow for previous source baseline `254967c` | **HOSTED_CI_VERIFIED** | Run #95 (`41245477137`) completed `success` with `head_sha` exactly `254967c...`; it does not validate the later documentation review commits or Freshness implementation. |
| `node-contract-tests` / `rust-tlsn-preflight` for `254967c` | **PASS** | Both Run #95 jobs completed successfully. They cover selected Node/WASM/APP handoff contracts and APP preflight, not Freshness protocol code. |
| Cloudflare `Workers Builds` check-runs for `254967c` | **PASS — build only** | `fusou`, `fusou-url-shorter`, and `fusou-workflow` reported successful build check-runs; not Production runtime or binding verification. |
| CodeFlow for `254967c` | **ANALYSIS_REPORTED, NOT A TEST PASS** | Reported `191 errors and 5368 warnings`; individual findings are **NOT_CHECKED**. |
| Branch protection / required checks | **PREVIOUSLY_OBSERVED NOT ENFORCED** | The previous source-snapshot review reported `protected: false` and zero rulesets; it was not rechecked in this design review. |
| Existing Runtime Config Node tests from the previous source review | **58 passed, 0 failed, 0 skipped** | Bootstrap/Result Registry, Manifest/publisher, fake R2 store and publisher-readiness suites. Existing code only; not Freshness tests. |
| APP Rust Runtime Config-specific local tests | **NOT_RUN in this documentation review** | No APP source changed; the prior Hosted Rust job was the `rust-tlsn-preflight` target. |
| Human trust-owner approval | **NOT_GRANTED** | Root/delegation authority, HSM custody and Journal operation approvals remain external prerequisites. |
| APP Bootstrap source readiness | **SOURCE_VERIFIED / COMPILED_VALUES_NOT_CHECKED** | Source has only the three Manifest URL/signer ID/SPKI pins; all absent is unregistered and partial input fails. No actual Production values or compiled APP artifact were registered/verified here. |
| Runtime Config signature verification readiness | **MANIFEST_V2_SOURCE_VERIFIED / FRESHNESS_NOT_IMPLEMENTED** | Existing Rust/JS Manifest v2 signing domain and checks are unchanged; the proposed delegation/commit-record/Freshness verification chain has no implementation. Production signer registration remains blocked. |
| Worker independent trust readiness | **NOT_REVALIDATED_IN_THIS_DESIGN_PASS** | No Worker source was changed; the Freshness protocol does not make an APP freshness claim Worker authority. Existing Worker verification is not a new Production acceptance result from this documentation-only task. |
| Freshness design | **DESIGN_SPECIFIED / TRUST_APPROVAL_PENDING** | Option B / `LATEST_AT_ISSUANCE`, authorization-versus-commit semantics, Journal linearization, DO lease ordering, and delegation expiry rules are specified in [runtime-config-freshness-protocol.md](./docs/runtime-config-freshness-protocol.md). |
| Freshness source implementation | **NOT_IMPLEMENTED** | No APP/Worker code, delegation verifier, Release Authority, Journal, signer or binding was added. |
| Freshness-specific unit/integration tests | **NOT_RUN / NOT_IMPLEMENTED** | No Freshness code exists to test; no live R2, key, endpoint, or service integration was used. |
| Freshness HTTP/deadline implementation | **NOT_IMPLEMENTED** | Current Manifest fetch remains 5-second connect / 15-second total timeout; the separate Freshness client and end-to-end monotonic deadline through final state commit are not in source. |
| Production registration | **NOT_REGISTERED / NOT_CHECKED** | Bootstrap values, HSM key providers, Release Journal/retention, DO namespace and Worker bindings, scoped operation credentials, endpoints and deployed services remain unregistered or unverified. |
| Stage A — protocol-only `TLSN_PROTOCOL_TESTPLAY` | **BLOCKED_CODE / BLOCKED_EXTERNAL_INPUTS** | No new protocol-only testplay was implemented or performed; required inputs remain unapproved. |
| Stage B — identity-bound `IDENTITY_BOUND_TESTPLAY` | **BLOCKED_CODE / BLOCKED_EXTERNAL_INPUTS** | No identity-bound testplay or real Notary/Game Server verification was performed. |
| Stage C — `PRODUCTION_EVIDENCE_DELIVERY` | **BLOCKED_CODE / BLOCKED_EXTERNAL_INPUTS** | Production Freshness, signer/Journal registration and evidence delivery remain unimplemented/unregistered. |
| Deployment / real-game evidence | **NOT_VERIFIED** | No deployment validation, real Notary, Game Server, gameplay, Presentation, or Production Result was performed. |

With an honest signer, issue-lease serialization and the end-to-end APP
deadline bound post-issuance staleness to under 10 seconds. A compromised
Freshness signer is different: for one fixed Manifest, APP source requires
`expires_at > app_now - 30s` and
`app_now - source.observed_at <= 600s`; with an APP clock at most 30 seconds
slow, its true-time bound is
`min(expires_at + 60s, source.observed_at + 630s)`. The worst fixed-Manifest
limit is 660 seconds from a current publisher policy time because the source
permits `observed_at` up to 30 seconds ahead. The source does not attest that
`policy.now` is the actual wall clock, so this is not an absolute deployed
bound. If releases continue, a compromised signer can roll back to successive
recent Manifests until the Freshness delegation's `not_after`. The root-signed
validity is capped at 24 hours from delegation `issued_at`; assuming the
offline root ceremony timestamp is trusted, the APP's conservative 30-second
clock-safety window keeps true-time acceptance within that cap when the APP
clock error is bounded by ±30 seconds. An untrusted root timestamp, unbounded
or deliberately changed APP clock removes any absolute wall-time bound. The
10-second deadline does not limit signer compromise; fresh-client immediate
delegation revocation is unavailable.

Run #95 validates previous source baseline `254967c...`, not review-start HEAD
`42bd255...` or the current documentation changes. No push or new Hosted CI
run is part of this task.

## Historical status snapshot — `a0cb49250df53132ee8df42ca02fbce91e10c7d2` (2026-11-01)

The inspected branch is `tlsn-first-testplay-candidate`; local HEAD, local
tracking ref, and GitHub branch head are `a0cb49250df53132ee8df42ca02fbce91e10c7d2`.
Its parent is `8820ec1877f4c4552005ae03fc717a233a8b036c`. The changes since the
runtime-source baseline `43ab72e6284deee3ad202be7fb50e3f0199af304` are
documentation-only; no APP or Worker source changed. At task start the only
worktree changes were the pre-existing `justfile` and APP roaming config edits;
the index was empty and those edits remain uncommitted.
Run #94 validates `a0cb492...`, not this later documentation-only commit; no
push or new Hosted CI run is part of this Phase 0 task.

### Verification status at this historical snapshot

| Area | Status | Evidence and limit |
|---|---|---|
| Hosted workflow for `a0cb492` | **HOSTED_CI_VERIFIED** | Run #94 (`41225866303`) completed `success` with `head_sha` exactly `a0cb492...`; it is the only Actions workflow run returned for that SHA. |
| `node-contract-tests` | **PASS** | Job completed successfully. Its pass covers the workflow's selected Node/WASM/APP handoff tests, not the new Freshness protocol, which is not implemented. |
| `rust-tlsn-preflight` | **PASS** | Job completed successfully; this is the workflow's APP preflight target, not a Freshness delegation verifier test. |
| Cloudflare `Workers Builds` check-runs | **PASS — build only** | `fusou`, `fusou-url-shorter`, and `fusou-workflow` reported successful build check-runs. This is not Production runtime, binding, or acceptance evidence. |
| CodeFlow | **ANALYSIS_REPORTED, NOT A TEST PASS** | Latest status for this SHA is `success`, with `191 errors and 5368 warnings`. The individual analysis findings were not retrievable through the available interface and are **NOT_CHECKED**. |
| Branch protection / required checks | **NOT ENFORCED** | GitHub reports `protected: false` and zero repository rulesets. Candidate required checks are `node-contract-tests` and `rust-tlsn-preflight`; CodeFlow is separate static analysis. |
| Existing Runtime Config Node tests run during this audit | **58 passed, 0 failed, 0 skipped** | Worker Bootstrap/Result Registry, Manifest/publisher, fake R2 store and publisher-readiness suites. These exercise existing code only; they do not implement or test Freshness delegation. |
| APP Rust Runtime Config-specific local tests | **NOT_RUN in this Phase 0 audit** | The Hosted Rust job is `rust-tlsn-preflight`; the selected local run was the existing Node suite. |
| Freshness protocol design | **DESIGN_SPECIFIED** | The selected design is Option B / `LATEST_AT_ISSUANCE`; see [runtime-config-freshness-protocol.md](./docs/runtime-config-freshness-protocol.md). Bootstrap-root delegations, Release Authority records, journal, signer, and APP verifier are **NOT_IMPLEMENTED**. |
| Freshness source implementation | **NOT_IMPLEMENTED** | No APP/Worker source code or bindings changed. |
| Freshness unit/integration tests | **NOT_RUN / NOT_IMPLEMENTED** | No Freshness response, delegation, commit-record, or replay-protection code exists to test. No live R2 or service integration was run. |
| APP Freshness HTTP/deadline behavior | **NOT_IMPLEMENTED** | Existing Manifest fetcher remains 5-second connect / 15-second request timeout. The specified separate Freshness client and end-to-end 10-second deadline through final atomic state commit are not in source. |
| Production registration | **NOT_REGISTERED / NOT_CHECKED** | Bootstrap values, signer providers, endpoint, Release Authority, journal and deployed bindings are not registered or verified here. |
| `TLSN_PROTOCOL_TESTPLAY` | **BLOCKED_CODE / BLOCKED_EXTERNAL_INPUTS** | No authorization change. |
| `IDENTITY_BOUND_TESTPLAY` | **BLOCKED_CODE / BLOCKED_EXTERNAL_INPUTS** | No authorization change. |
| `PRODUCTION_EVIDENCE_DELIVERY` | **BLOCKED_CODE / BLOCKED_EXTERNAL_INPUTS** | No authorization change. |
| Deployment / real-game evidence | **NOT_VERIFIED** | No deployment validation, real Notary, Game Server, gameplay, Presentation, or Production Result was performed. |

Evidence tiers are intentionally distinct: the Freshness protocol is
**DESIGN_SPECIFIED**; its source implementation and protocol-specific unit
tests are **NOT_IMPLEMENTED**; integration tests are **NOT_RUN**; external
root/delegation/Journal/service registration is **NOT_REGISTERED**; Production
demonstration and real-game evidence are **NOT_VERIFIED**.

Run #94 had two successful jobs and no failed steps. The Runtime Config source
and test inventory below is historical and remains useful, but its earlier
`NOT_RUN` / `NOT_CHECKED` entries describe their named snapshots. The older
snapshot also proposed direct online use of the Bootstrap signer; that proposal
is superseded by the delegated-key design below and was never implemented.
The current result does not promote Production acceptance.

With an honest signer, the issue lease holds the current committed generation
through response signing and the APP's 10-second monotonic deadline is checked
again before final state persistence. A release after signing may be ahead at
APP acceptance for less than 10 seconds. A compromised Freshness signer is
different: it can sign a fresh nonce response for an older still-valid
root-signed Manifest. For one fixed Manifest, APP source requires both
`expires_at > app_now - 30s` and
`app_now - source.observed_at <= 600s`; with an APP clock at most 30 seconds
slow, the true-time bound is
`min(expires_at + 60s, source.observed_at + 630s)`. The source permits
`source.observed_at` up to 30 seconds ahead of the publisher verification
time, so under a current `policy.now` the maximum fixed-Manifest window is
660 seconds from that policy time; the reference-age condition is tighter
than the one-hour Manifest lifetime. The source does not attest that
`policy.now` is the actual wall clock, so this is not an absolute deployed
bound. If releases continue, a compromised signer can roll back to successive
recent Manifests until its delegation expires (maximum 24 hours); renewing a
compromised key extends that exposure and is forbidden. Local delegation
generation high-water helps existing installs, but fresh-client immediate
revocation is unavailable without an APP Bootstrap-root rotation.

## Historical status snapshot — runtime-code SHA `43ab72e` (2026-11-01, earlier)

This snapshot was for runtime-code commit `43ab72e6284deee3ad202be7fb50e3f0199af304`
on `tlsn-first-testplay-candidate`. At inspection time, the local HEAD, local
`origin/tlsn-first-testplay-candidate` ref, and GitHub branch head all matched
that SHA. The two commits immediately before this snapshot are
`f6c6b951d3ad5f36e2564a1c086a2d81369cdb72` and
`43ab72e6284deee3ad202be7fb50e3f0199af304`.
This is a documentation follow-up; Run #93 validates the runtime-code SHA
above, not this later documentation commit.

### Verification status recorded for runtime-code SHA `43ab72e`

| Area | Status | Evidence and limit |
|---|---|---|
| Hosted workflow for `43ab72e` | **HOSTED_CI_VERIFIED** | Run #93 (`41215720970`) completed `success` with `head_sha` exactly `43ab72e...`. This is the only GitHub Actions workflow run returned for that SHA. |
| `node-contract-tests` | **PASS** | All job steps, including APP clean-capture tests, proof-handler tests, Worker WASM build/provenance checks, typecheck, and APP handoff/Runtime Config tests, completed successfully. |
| `rust-tlsn-preflight` | **PASS** | The locked APP TLSN preflight test step completed successfully. |
| Cloudflare `Workers Builds` check-runs | **PASS — build only** | `fusou`, `fusou-url-shorter`, and `fusou-workflow` reported successful build check-runs for this commit. These are not proof of Production runtime behavior, active deployment correctness, or Production acceptance. |
| CodeFlow | **ANALYSIS_REPORTED, NOT A TEST PASS** | The latest status for this SHA is `success`, with the description `191 errors and 5368 warnings`. The older `pending` status is superseded. The CodeFlow result page was not readable through the available unauthenticated interface, so individual findings and severity classifications are **NOT_CHECKED**. |
| Branch protection / required checks | **NOT ENFORCED** | GitHub reports the branch as `protected: false` and repository rulesets as empty. The detailed branch-protection endpoint requires authentication, but no effective branch protection or ruleset was reported. Candidate required checks are `node-contract-tests` and `rust-tlsn-preflight`; CodeFlow remains a separate static-analysis result. |
| Deployment verification | **NOT_VERIFIED** | No Production Worker binding, Runtime Config endpoint, signer, or R2 publication was verified by this run. Worker build check-runs are not deployment acceptance evidence. |
| Real-game evidence | **NOT_VERIFIED** | No real Game Server, Notary, gameplay, Presentation, or Production Result was used. |

The GitHub Actions run had two jobs and no failed step: `node-contract-tests`
and `rust-tlsn-preflight` both completed successfully. No failed-job log exists
for this run. The older checks and CodeFlow result attached to PR #231 refer to
a different head commit and are not evidence for `43ab72e`.

### Readiness summary recorded for runtime-code SHA `43ab72e`

| Property | Current status |
|---|---|
| Runtime Config source contract | **SOURCE_VERIFIED** at the inspected source revision; local and Hosted CI tests cover their stated synthetic/code scope. |
| Production Bootstrap values | **NOT_REGISTERED**; no production values were inferred or supplied. |
| Production signer provider and manifest endpoint | **NOT_CONFIGURED / NOT_REGISTERED** in the publisher registration contract. |
| APP–Proxy target policy | **SOURCE_VERIFIED / TEST_VERIFIED** for the current unique-hostname, port-443 contract; no real target was observed. |
| APP–Worker Result Registry trust | **SOURCE_VERIFIED / TEST_VERIFIED** for independent source and local synthetic tests; deployed Worker bindings are **NOT_CHECKED**. |
| Fresh-client Manifest replay protection | **BLOCKED / NOT_IMPLEMENTED**. The design proposal is in [runtime-config-freshness-protocol.md](./docs/runtime-config-freshness-protocol.md); it is not an implemented protocol. |
| `TLSN_PROTOCOL_TESTPLAY` | **BLOCKED_CODE / BLOCKED_EXTERNAL_INPUTS** |
| `IDENTITY_BOUND_TESTPLAY` | **BLOCKED_CODE / BLOCKED_EXTERNAL_INPUTS** |
| `PRODUCTION_EVIDENCE_DELIVERY` | **BLOCKED_CODE / BLOCKED_EXTERNAL_INPUTS** |

The historical `NOT_RUN` and `NOT_CHECKED` entries below describe their
individual earlier audit snapshots; they are retained as history and must not
be read as the current result. The current snapshot does not promote
`DEPLOYMENT_VERIFIED`, `REAL_GAME_EVIDENCE_VERIFIED`, or Production acceptance.

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
| CODE_READY | BLOCKED_CODE | Strict local finalizer and WEB proof handlers exist. Nine required material roles and the retained candidate receipt prerequisite still block broader completion. Capture initialization is backgrounded; unavailable capture leaves ordinary proxying active. | Do not call candidate files a finalized Evidence Bundle or enable a protocol-only bypass. |
| LOCAL_BUILD_READY | VERIFIED, GNU check only | Actual APP `tlsn-production`, its own manifest/lock and library/binary targets checked. | Not a GUI launch, release package, clean candidate handoff or live-bootstrap test. |
| CONFIG_READY | BLOCKED_EXTERNAL_INPUTS | Trust/release operator supplies approved embedded bootstrap and fresh signed manifest/artifacts; APP independently verifies them. | Missing/expired/mismatched/unregistered inputs reject; no fixture or stale-manifest fallback. |
| TARGET_APPROVAL_READY | BLOCKED_EXTERNAL_INPUTS | Deployment operator supplies the actual canonical hostname, reviewed Inventory and Approval bound by the manifest. | No real target/approval was admitted in this task. Candidate selection is not observed identity. |
| SERVICE_CONNECTIVITY_READY | NOT_CHECKED | Operators confirm intended Worker, Session Authority, device-auth, Notary and storage contracts/version. | Local mocks/health JSON are not execution or deployment proof. |
| CAPTURE_READY | BLOCKED | Existing runtime gates plus explicit human approval and the three local limits below must pass. | No real capture command was run; no gameplay permission follows from a local report. |
| DEVICE_AUTHENTICATION_READY | IMPLEMENTED_AND_CONNECTED source; deployment NOT_CHECKED | WEB exact-owner handlers, shared framing, atomic PostgreSQL proof/nonce claims and bounded Worker consumer are locally tested. | Only an existing non-anonymous exact owner is accepted. No anonymous-owner transfer or new enrollment policy is invented. |
| EVIDENCE_FINALIZATION_READY | PARTIAL | CLI consumes ten candidate-available roles, derives `subject` from the Result, and uses the existing material manifest for the remaining roles and independently pinned inputs; all 19 roles must pass the real verifier before local publication. | Missing receipt/material or invalid bindings reject. Full synthetic success and real Production finalization were not verified. |
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
| Origin Inventory, Target Approval, Web PKI trust roots, and signed Runtime Config artifacts | Manifest-pinned raw artifacts for APP preflight; Worker-owned shipped artifacts and bindings for verification | APP verifies artifact digests and derives its local Proxy identity/port policy from the Manifest-approved targets. The current Production inventory contract requires exactly 20 unique canonical hostnames on port 443, so same-host multiple-port entries are rejected. The Worker independently checks its own inventory, approval, Notary registry set, and observed Presentation identity. |
| `FUSOU_TLSN_RESULT_PUBLIC_KEY_SPKI`, `FUSOU_TLSN_RESULT_SIGNER_KEY_ID`, `FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY` | Signed Runtime Config V2 for APP Result verification; Worker-owned signer bindings for result generation | The Manifest signer may update the APP-side Result Registry pin, but cannot update Worker bindings. The Worker verifies the Result Registry envelope against its own root before accepting production configuration. |
| `FUSOU_TLSN_EXPECTED_ACTIVE_VERSION_ID`, `FUSOU_TLSN_EXPECTED_BINDING_MODE`, `FUSOU_TLSN_EXPECTED_DEPLOYMENT_ID`, `FUSOU_TLSN_EXPECTED_GIT_COMMIT_SHA`, `FUSOU_TLSN_EXPECTED_WORKER_NAME`, `FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT`, `FUSOU_TLSN_VERIFICATION_ENDPOINT` | Signed Runtime Config V2 `compile_inputs`, derived from the operator-approved Worker reference | Fetched and verified at APP runtime; these values are no longer supplied to the APP build environment or emitted in its compiled Bootstrap report. |
| `FUSOU_TLSN_SESSION_AUTHORITY_ENDPOINT`, `FUSOU_TLSN_SESSION_AUTHORITY_KEY_ID`, `FUSOU_TLSN_SESSION_AUTHORITY_PUBLIC_KEY` | Session receipt verification and binding prewarm | Stage B identity/session inputs, not intrinsic TLSN Presentation verification inputs. They remain required by the existing APP path and were not bypassed. |
| APP E2E variables, `FUSOU_TLSN_EVIDENCE_BUNDLE`, and `FUSOU_TLSN_ROUNDTRIP_CONFIG_PATH` | Test harnesses and evidence CLI only | Test/CLI inputs, not production runtime configuration and not proof of real service readiness. No values were inspected. |
| `artifact_output_path` and capture toggles | APP user configuration and local filesystem sink | Local path/behavior inputs; protected user configuration values were not inspected. No real artifact path or output was created. |

## Historical local implementation validation — baseline `fc29aac29d454bf949510e0d97acbd3cd7e68e5b`

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

### Runtime Config Freshness service path — current source state

| Stage | Current entry point | Status | Required external input / local evidence |
|---|---|---|---|
| APP bootstrap and startup | [`lib.rs`](../FUSOU-APP/src-tauri/src/lib.rs) registers `RuntimeConfigManager` and starts a refresh when TLSN is enabled; [`RuntimeConfigManager::refresh`](../FUSOU-APP/src-tauri/src/tlsn_runtime_config_runtime.rs) loads the embedded bootstrap tuple. | APP verifier and startup connection are implemented. The Production tuple remains `UNREGISTERED` in the current build. | Approved Manifest URL and root public-key pin must be supplied by a controlled APP release. No tuple was registered by this work. |
| APP Freshness request | [`tlsn_runtime_config_freshness.rs`](../FUSOU-APP/src-tauri/src/tlsn_runtime_config_freshness.rs) posts to `/tlsn/runtime-config/v2/freshness/v1`, then verifies the signed response before fetching the immutable Manifest and referenced artifacts. | Implemented; existing no-redirect, 2-second connect, 10-second request/deadline, and bounded-body checks remain. | No live endpoint response has been observed. |
| Freshness Gateway route | [`Freshness Gateway`](../FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-GATEWAY/src/index.ts) validates the configured Manifest URL and same-origin audience, enforces shared request/response byte limits, validates the challenge through the shared domain contract, sends only its canonical validated form through an optional private Service Binding, and returns bounded response bytes unchanged. Each admitted request has one 7-second monotonic deadline and admission is capped at 16 in-flight requests per Worker isolate; overflow fails immediately with `503`. The Wrangler config explicitly enables incoming `Request.signal` for the unchanged `2026-11-06` compatibility date. Signer response bodies are owned from fetch resolution through EOF or confirmed cancellation; pending cleanup retains the slot, and unconfirmed cancellation/reader release permanently retains the slot for that isolate. | Source route implemented and fail-closed. Its Wrangler source has no public route or signer binding, so an unconfigured service returns `503`; no Production endpoint is active. Deadline, signal propagation, per-isolate admission, and local body cleanup behavior are tested; Cloudflare runtime disconnect propagation and a service-wide concurrency bound are not verified. | A reviewed route/domain and the approved private signer binding are not registered. Per-isolate admission is not a service-wide cap; no shared limiter was introduced. |
| Freshness signer and current-state authority | The selected protocol requires a separate signer that reads the current Release Journal, DO committed state/issue lease, R2 pointer/snapshot and Manifest signature. | **NOT_IMPLEMENTED / NOT_REGISTERED.** The current in-memory R2/Journal/DO and signing implementation under Worker `scripts/` remains explicitly test-only. No Production signer Worker or authority adapter was added. | Bootstrap-root delegations, non-exportable Freshness/Release Authority keys, independently administered append-only Journal, separate DO namespace, read-only R2 access and worker deployment identities all require approval and registration. |
| Manifest/artifact verification | APP [`verify_freshness_response`](../FUSOU-APP/src-tauri/src/tlsn_runtime_config_freshness.rs) and [`verify_runtime_config_manifest`](../FUSOU-APP/src-tauri/src/tlsn_runtime_config_manifest.rs) verify the challenge, signatures, Release Commit Record, Manifest and independent artifact pins. | **VERIFIED** locally against the exact bytes returned by the Gateway handler using synthetic keys and test-only authority state. The route test also checks the exact response body length/digest; APP Rust re-verifies the response, Manifest and all required artifacts. | This is synthetic local integration evidence only. No Production response, root delegation, Manifest or artifact was fetched. |
| Capture initialization | [`wrap_proxy.rs`](../FUSOU-APP/src-tauri/src/wrap_proxy.rs) refreshes Runtime Config, runs preflight, validates disclosure/health and installs the capture forwarder only after success. | Existing fail-closed connection remains. A failed/unregistered Freshness bootstrap leaves TLSN capture unavailable while ordinary proxying remains available. | A real first capture still requires the approved bootstrap, deployed Gateway/Signer/authority bindings, verified live response and the other existing Notary/Worker/device/trust inputs. |

The local Gateway integration injects the test-only authority explicitly; no
test adapter is imported or selected by the Gateway Worker source. It passes
the handler's exact response bytes to the APP Rust verifier. Node tests cover
an explicit `AbortController`, pre-aborted input, incomplete request and
signer-response bodies, a non-settling signer fetch, late resolve/reject,
admission overflow and retained slots, as well as redirect, missing binding,
invalid audience and oversized request/response rejection. This does not verify
Cloudflare's incoming disconnect event in a Workers runtime: that behavior is
configured by `enable_request_signal` but has not been runtime-tested locally
or in Production. The candidate `node-contract-tests` job now installs the
Linux build dependencies required by its APP Cargo integration test; Hosted CI
has not been run. These local results do not establish Production service
availability or capture readiness.

### Signer response-body cleanup hardening

The Gateway now creates one body owner immediately when a Signer `Response`
arrives, before checking whether the request has already disconnected or
expired. It reads a valid response to EOF, or cancels an unread/partially read
body through its one owned stream/reader path. The body is considered cleaned
only after EOF, or after cancellation resolves and an acquired reader releases
its lock. Invalid/oversized Content-Length rejection therefore cancels the
unread body rather than returning while leaving it unowned.

The 7-second HTTP response deadline remains independent of cleanup. A delayed
cancel can leave the operation pending under `ctx.waitUntil()` and its
per-isolate admission slot stays occupied until cleanup settles. A rejected
cancel or failed reader unlock cannot prove resource release; the request
returns its existing failure response but the slot is intentionally retained
for the remainder of that isolate's lifetime. This is fail-closed capacity
degradation, not a service-wide limit or a claim that the underlying resource
was reclaimed. Local handler tests cover late streaming responses after
disconnect/deadline, early malformed/oversized Content-Length cancellation,
deadline response while cancellation is unsettled, and admission behavior
before and after cleanup. They do not exercise Workers-runtime client
disconnect delivery.

Local verification on 2026-11-07: the Freshness/Production Result/evidence/
readiness Node group passed **104/104**, including the Gateway-to-APP test,
which asserts that the exact handler response is accepted by one APP Rust
verifier test. Runtime Config domain tests passed **6/6**; Gateway and
Verification Worker typechecks passed. Wrangler 4.135.0 type generation and
`deploy --dry-run` passed; the dry run reported no bindings. No local Workers
runtime disconnect test or Hosted CI run was performed.

Local verification for this cleanup change: the selected Gateway handler
regression set passed **11/11**; Gateway `tsc --noEmit` and Node syntax checking
passed. The existing Gateway-to-APP exact-byte integration passed **1/1**,
including the Rust APP verifier invocation with Rust 1.98.1, the committed
lockfile, and offline mode. Its selected `--lib --exact` test uses the
`freshness-gateway-integration-test` feature. The APP build script calls
`tauri_build::build()` and its configured resources are under
`src-tauri/resources/`; the `roaming/user/configs.toml` include is in the
`configs` crate's `#[cfg(test)]` module, which is not compiled as a dependency
unit-test target by this selection. The protected file was not read.
Hosted CI is **NOT_CHECKED**. These local synthetic tests do not establish
Workers-runtime disconnect behavior, Production Signer availability, or
Production acceptance; Stage A/B/C and Production acceptance remain
**BLOCKED**.

The selected route must already be approved before capture. The actual
identity still comes from Web PKI/TLSN Presentation verification and is matched
against Inventory/Approval. URLs, ports, IPs, wildcards, certificate fingerprints
and custom CA roots are not Production target identities.

### Local Workers runtime disconnect check — current follow-up

The real Gateway source is exercised through a local Miniflare HTTPS listener
and an explicitly test-only Service Binding Worker. A separate minimal signal
probe contains no Gateway, domain validation, or Signer. Local versions were
Node `v22.21.1`, Miniflare `5.20261104.0-beta`, workerd `1.20261104.1`, and
esbuild `0.28.2`; the candidate workflow pins Node `22.16.0`. The harness
binds only to `127.0.0.1` on runtime-assigned ports. It checks the Production
Gateway's `wrangler.toml` and passes its unchanged `2026-11-06` compatibility
date and `enable_request_signal` flag to every local Worker. The reserved
`.test` name is sent as Host/SNI without DNS.

The HTTP client explicitly owns its `ClientRequest`, Agent, TLS socket, and
underlying TCP socket. After test-Worker request-arrival observation, it
separately calls `net.Socket.destroy()` or
[`net.Socket.resetAndDestroy()`](https://nodejs.org/download/release/v22.16.0/docs/api/net.html#socketresetanddestroy).
Node documents the latter as sending a TCP RST; no packet capture independently
confirmed the wire packet. Ordinary `destroy()` produced no incoming
`Request.signal` event within the 7.5-second probe window via either the
Miniflare entry or direct Worker socket; its wire close type is unknown.
Explicit reset produced an incoming signal via
both paths.
The test accepts either a consistent `signal` or `watchdog` result for ordinary
`destroy()`; for `resetAndDestroy()`, an incoming signal and
`outcome="signal"` are mandatory. The ordinary-destroy result above records
that run only and is not a guarantee for other runtimes.
The runner is limited to 120 seconds; interruption or timeout signals its
isolated test process group, waits 5 seconds for runtime cleanup, then escalates
to `SIGKILL`. The supervisor removes its temporary root only after child exit.
Both signal paths were exercised (exit codes 130 and 143); the 120-second
timeout escalation was not run separately.

| Boundary | Result |
|---|---|
| Minimal probe: ordinary `destroy()` | **LOCAL_WORKERS_RUNTIME_VERIFIED** for the pinned local runtime only: no signal observed within 7.5 seconds through the Miniflare entry or direct socket. The wire close type is unknown. |
| Minimal probe: `resetAndDestroy()` | **LOCAL_WORKERS_RUNTIME_VERIFIED**: incoming `Request.signal` abort observed through both the normal entry and direct Worker socket. |
| Normal Gateway response | **LOCAL_WORKERS_RUNTIME_VERIFIED** for exact bytes only: actual Gateway response length and SHA-256 match the test Signer's whitespace/newline-containing bytes. No signature or APP acceptance is asserted. |
| Gateway-owned deadline | **LOCAL_WORKERS_RUNTIME_VERIFIED** for the 7-second `504`: the Service Binding request received the deadline abort, the test Signer observed it, `waitUntil` cleanup settled, and a later exact-byte request succeeded in the same Gateway isolate. This does not claim full 16-slot recovery. |
| Explicit reset during request-body read | **LOCAL_WORKERS_RUNTIME_VERIFIED**: incoming signal, body cancellation, reader release, and `waitUntil` settlement were observed; the Signer was not called. |
| Explicit reset while Signer headers were pending | **LOCAL_WORKERS_RUNTIME_VERIFIED**: incoming signal reached the Gateway's internal signal and Service Binding request, the Signer wait ended, and `waitUntil` settled. |
| Explicit reset while Signer body was being read | **UNVERIFIED** for signal propagation. The body read rejected before an incoming signal was observed; reader cancellation then rejected, the reader lock was released, the isolate admission slot was retained, and the handler returned `502`. No Service Binding signal, Signer cancellation, or test-Signer pull settlement was observed. `waitUntil` was absent because the read-error operation completed as `502`, not because the test assumed cleanup had settled. |

The prior expectation that every socket close would produce an incoming
`Request.signal` was incorrect for the chosen ordinary `destroy()` operation;
the minimal probe now distinguishes that from explicit TCP reset. The
Signer-body observation is a separate order: read rejection, failed cancel,
reader release, slot-retention log, then handler response. The Gateway's
fail-closed slot behavior is confirmed; cleanup of the test Signer's pending
pull is not. The test now allows signal-first or read-error-first outcomes,
requires `waitUntil` only for the interrupted response path, and records the
actual body/cancel/slot events. The exact lower-layer cause (workerd,
Miniflare listener, or Service Binding stream cancellation) remains unknown;
the result does not establish a Production defect or guarantee. No Gateway
Production code or trust boundary was weakened.

Reproduce with
`pnpm --dir packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-GATEWAY run test:runtime`.
The required candidate-workflow step invokes this command without skip or
continue-on-error. The selected **11/11 Gateway handler regressions** are
**NODE_UNIT_VERIFIED**; Node `AbortController` tests do not substitute for the
real HTTP cases. No APP Cargo target was selected or run, and no APP Rust
source was changed. Gateway source is **SOURCE_IMPLEMENTED**. Hosted CI is
**NOT_CHECKED**; `HOSTED_CI_VERIFIED` and `PRODUCTION_VERIFIED` are not
established. Production Signer/Journal registration, real service execution,
Stage A/B/C, and Production acceptance remain **BLOCKED**.

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
Production archive retrieval, and independent verification of a real
finalized Bundle remain **NOT EXECUTED**. Local Rust fixtures, collector mock
responses, and the WEB handler with ephemeral PostgreSQL are separate local
contract tests, not Production evidence.

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
   `verify_loaded_bundle`, then local publication. Candidate-to-finalizer
   handoff for eleven roles is connected; the finalizer can derive the
   semantic role offline after successful verification of its inputs. There is
   no APP automatic invocation. Replay collection is an explicit offline
   operation with local mock/authority-handler tests only; the six independent
   external roles and any real Production replay response remain uncollected.
6. Only a successful ordinary strict independent verifier call permits local publication.
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

| Role | Generator / retained input | Representation and binding | Independent trust / verification | Current connection |
|---|---|---|---|---|
| `presentation` | APP prover; candidate `presentation.bin` | Exact raw Presentation bytes; candidate/session/request context in metadata | Notary publication, externally pinned Web PKI DER, observed DNS identity and transcript verification | `AVAILABLE_AND_CONNECTED`; real capture UNVERIFIED |
| `result` | Worker signer; candidate compact `result.json` | Contract-defined inner Result; V2/V3 binds exact Presentation and Production authority digest pair | Registry/root/signature checks and independent Result derivation | `AVAILABLE_AND_CONNECTED`; real Result UNVERIFIED |
| `result_registry` | Verified Runtime Config; candidate `runtime-result-registry.json` | Exact raw bytes from verified manifest input; candidate hash/length checked | Signed envelope and external evidence-root pin | `AVAILABLE_AND_CONNECTED`; real publication not checked |
| `result_registry_envelope` | Verified Runtime Config; candidate `runtime-result-registry-envelope.json` | Exact raw envelope bytes | Signature checked against external evidence-root ID/SPKI and exact registry digest | `AVAILABLE_AND_CONNECTED`; real root registration not checked |
| `notary_registry` | Approved Notary publication; supplied separately | Exact raw registry bytes; key ID must match Presentation Notary key | External byte pin and actual Notary signature | `EXTERNAL_INPUT_REQUIRED` |
| `health` | APP fetches Worker `/health` once during proxy initialization and validates it against independently configured identity/version/Result registry pins; exact body is kept in an immutable capture snapshot and candidate `worker-health.json` | Exact response body bytes, bounded to 1 MiB; candidate manifest records length/SHA-256; no reserialization | APP validation is not a signature; finalizer hands the bytes to the existing verifier, which cross-checks Result and external registry identities/hashes | `AVAILABLE_AND_CONNECTED` |
| `session` | Worker Session Authority; candidate `session.json` | Signed Session receipt binds user/device/nonce/session/binding/challenge/times | External Session registry/key and signature/context verification | `AVAILABLE_AND_CONNECTED`; real issuance UNVERIFIED |
| `authenticated_user` | Supabase authenticated-user service; no authoritative role file retained | Contract-defined user observation tied to Session/Result | Independently pinned canonical user | `EXTERNAL_INPUT_REQUIRED` |
| `device_identity` | WEB `user_devices`; local APP record is `UNVERIFIED` | Owner/key/non-revoked observation tied to user/device/session | Independent user/device/key pins plus proof/receipts | `EXTERNAL_INPUT_REQUIRED` |
| `device_authentication` | APP device signature and Worker Session issuance; candidate `device-authentication.json` | Captured request/acceptance projection bound to signed Session receipt | Device signature, external device key, and signed Session/context | `AVAILABLE_AND_CONNECTED`; not APP process authority |
| `possession_proof` | Registered device; candidate `possession-proof.json` | Framed message digest/signature bound to session/device/binding/challenge | External device-key pin and Ed25519 verification | `AVAILABLE_AND_CONNECTED` |
| `consume_receipt` | Worker Binding Authority; candidate `consume-receipt.json` | Signed receipt binds subject/session/binding/nonce/Presentation hash/use time | External Binding registry/key, signature and context | `AVAILABLE_AND_CONNECTED`; real issuance UNVERIFIED |
| `replay` | Explicit offline collector reads successful candidate proof and uses WEB's authenticated read-only observation mode; not an APP candidate artifact | Exact HTTP 409 body bytes, length and SHA-256, stored-row proof/context projection and consume-receipt Presentation ID | Rust verifier checks body/projection, exact proof digest, user/device/session/binding/challenge and Presentation linkage; observation remains unsigned | `SOURCE_IMPLEMENTED / LOCAL_TEST_VERIFIED; REAL_OBSERVATION_NOT_CHECKED` |
| `session_authority_registry` | Approved Session authority publisher; raw file not in Runtime Config materials | Exact raw JSON registry bytes | Independent CLI byte pin and historical key validity | `EXTERNAL_INPUT_REQUIRED` |
| `binding_authority_registry` | Approved Binding authority publisher; raw file not in Runtime Config materials | Exact raw JSON registry bytes | Independent CLI byte pin and key/receipt verification | `EXTERNAL_INPUT_REQUIRED` |
| `capture_metadata` | APP `FilesystemPresentationArtifactSink`; candidate `metadata.json` | Exact canonical JSON bytes include Presentation hash, capture ID/profile and unverified proxy provenance | Existing predicates and trust graph; proxy process authority remains unverified | `AVAILABLE_AND_CONNECTED` |
| `semantic_verification` | Offline `finalize_candidate`; not an APP candidate artifact | Existing report contract derived from exact Presentation and Result facts produced by the shared independent verification core | Report generation follows successful independent checks; ordinary strict verification still requires all 19 roles before publication. Provenance/time fields are not execution authority or external time proof. | `AVAILABLE_AND_CONNECTED` |
| `trust_root` | Independently approved Web PKI owner; raw DER supplied separately | Exact DER bytes used as TLS trust anchor | External byte pin and actual Presentation chain verification | `EXTERNAL_INPUT_REQUIRED` |
| `subject` | Finalizer derives from strict candidate Result parsing | Hash projection of canonical user/device/session/member/binding | Existing verifier rechecks values against independently verified Result | `AVAILABLE_AND_CONNECTED`; not identity authority |

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

## Historical finalization audit validation

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

### Independent audit follow-up at `3e9f361e430cb14f71ba92fa92c3e1147d1172da`

The independent source trace found that `ProductionTlsnDependencies::build_forwarder`
still reached `OriginTransportConfig::validate_for_experimental`, which checked
the target against a second Origin Inventory embedded by the `configs` crate.
Consequently, a target admitted by the freshly verified Runtime Config could
pass APP preflight but fail while constructing the production forwarder, and
the APP path retained a static inventory dependency.

The current working-tree fix makes the APP construct its Proxy policy from the
verified Manifest's exact `(server_identity, port)` targets. The Proxy validates
that pair and no longer consults `configs::get_tlsn_origin_inventory`; the
unused `configs` crate inventory API/embed was removed. The Worker keeps its
independent inventory, Target Approval and Notary checks. The APP's local
Manifest result remains an untrusted client-side decision, and the Manifest
signer still cannot replace the Worker's Result Registry root binding.

Publisher rollback checks the current signed pointer, requires monotonic epoch
advancement (or byte-identical same-epoch publication), and uses conditional
CAS. A fresh APP still starts with local epoch zero and has no independent
server-side latest-epoch pin. Its acceptance of an older signed Manifest is
constrained by the Manifest expiry and the 600-second Worker-reference age
limit, but is not globally excluded if an endpoint serves a still-current
older pointer. Pointer-loss recovery authority also remains unregistered.

Replay design options were compared without adding a new root or endpoint:

- `no-store`, short expiry and the existing 600-second Worker-reference age
  limit reduce ordinary cache-staleness exposure, but do not cryptographically
  prevent a server from returning an older still-valid Manifest.
- A fresh HTTPS latest-pointer query makes the endpoint/control plane the
  freshness authority; TLS and deployment integrity then become part of the
  guarantee.
- A nonce-bound latest-epoch response signed by the existing Bootstrap signer
  can prevent replay to a fresh APP without a new root hierarchy, but requires
  a versioned challenge protocol, an online signing/response authority, and
  separate availability and key-custody approval.

No option was implemented because the endpoint, signer service and authority
are not registered. Fresh-client replay protection remains **BLOCKED** pending
that design and external registration.

The existing cross-language Result Registry contract uses inclusive
`not_before` and `not_after` bounds: `not_before <= validation_time <=
not_after`; `not_after: null` is unbounded. Worker, APP Manifest, Proxy and
offline verifier implementations already use those comparisons. The boundary
is now tested at equality and immediately after expiry. This preserves current
behavior; changing to a half-open end would require coordinated producer,
Manifest, Worker, APP/Proxy and offline-verifier migration. A registry
rotation should account for the fact that adjacent inclusive windows may
overlap at a shared boundary.

| Independent audit check | Result | Scope |
|---|---|---|
| Runtime Config, APP handoff/pre-capture and R2 store Node suites | **105 passed, 0 failed, 0 skipped** | Includes synthetic root mismatch, Production/Canary root selection, missing root binding, signer lookup/status/validity-window checks, publisher rollback and APP Manifest-approved Origin policy source contract. |
| Worker TypeScript `pnpm --dir packages/FUSOU-TLSN-VERIFICATION-WORKER run typecheck` | **PASS** | Checks Worker binding selection and Result Registry helper declarations. |
| Worker source-release closure `node --experimental-strip-types --test scripts/release-worker-source.test.mjs` | **11 passed, 0 failed** | Local source/recipe fixtures only; no deployment or API call. |
| `node --check` on the changed MJS sources | **PASS** | Syntax only. |
| `rustfmt --check` for `production_tlsn.rs`, `wrap_proxy.rs`, and `configs/src/lib.rs` | **PASS** | `configs/src/configs.rs` full-file formatting remains non-clean in unrelated existing sections; the changed removal hunk is formatted. |
| `git diff --check` on the explicit changed-path allowlist | **PASS** | No whitespace errors. |
| APP `tlsn-production` and Proxy `alpha15-tlsn` Cargo check/tests | **NOT_RUN** | Both paths depend on `configs`, whose compiled source contains `include_str!("../configs.toml")`; Cargo would read the protected configuration. The new Proxy Rust regression tests are present but unexecuted. No Cargo compile/test command was run. |
| Hosted CI | **NOT_CHECKED** | No workflow was dispatched. |

Readiness remains: Bootstrap source shape **VERIFIED** by source and synthetic
contract tests, but real Bootstrap values **NOT_REGISTERED**; APP Rust
Manifest execution **NOT_CHECKED**; Worker independent trust **VERIFIED** at
source/typecheck/synthetic-test level, but deployed binding values
**NOT_CHECKED**; Production external inputs and Stage A/B/C acceptance remain
**BLOCKED**. No real Worker, Notary, R2, Game Server or gameplay operation was
performed.

### Remaining boundary and Cargo verification (base `2ab34ff2`)

**APP/Proxy target policy:** The accepted Production inventory is an ordered
20-entry list of unique canonical hostnames, each on port 443. Target Approval
is a unique ordered hostname set. Thus the current Manifest contract rejects
the same hostname on multiple ports before APP selection; Worker parsing
applies the same constraint. The APP's `approved_target(hostname)` is
unambiguous under this invariant. Proxy policy construction now also rejects
duplicate hostnames and validates the exact approved `(identity, port)` pair.
Tests exercise the actual APP artifact validator, verified-target-to-Proxy
policy construction, Worker Inventory parser and Proxy policy validator.

**Result Registry time semantics:** Existing Registry producers and consumers
in JavaScript, APP Rust, Proxy Rust, Worker and offline Evidence verification
consistently treat both ends as inclusive: `not_before <= time <= not_after`;
`not_after: null` means no upper bound. This audit retains that version-1
contract rather than changing only one consumer to a half-open interval.
Fixed-time tests cover equality at each bound and just outside the end. A
rotation that gives adjacent keys a shared boundary may make both eligible at
that instant; the issuer should avoid unintended overlap.

**Fresh-APP replay:** A first-install APP has no persisted epoch and can accept
an older signed Manifest while its expiry and 600-second Worker-reference
freshness checks still pass if the endpoint serves it. Publisher monotonicity,
signed pointer verification, CAS and `no-store` reduce publisher/cache
rollback; they do not prove the latest epoch to a new client if the serving
endpoint itself replays an older valid object. A nonce-bound latest-epoch
response signed by the existing Bootstrap signer is the preferred future
option without a new root hierarchy, but it requires a versioned online
freshness protocol, signer/service availability and external approval.
No such protocol or new authority was introduced; fresh-client replay
protection remains **BLOCKED**.

**Cargo and local tests:** The APP check, targeted APP tests, Proxy feature
checks/tests and offline verifier boundary test were run `--locked --offline`.
The standalone `configs` crate test suite was not run; it includes the
pre-existing user roaming config fixture. The modified `justfile` was read to
confirm it contains cleanup/license recipes but no test recipe; no clean
recipe was executed. Existing edits to `justfile` and the roaming user config
were not staged or committed.

| Follow-up validation | Result | Scope |
|---|---|---|
| Runtime Config, APP handoff/pre-capture, publisher/R2 and trust Node suites | **107 passed, 0 failed, 0 skipped** | Includes actual Manifest/Worker parser/policy helper tests and fixed-time Registry boundary tests; synthetic data only. |
| Worker TypeScript typecheck | **PASS** | Current Worker bindings, selector and helper declarations. |
| Worker release source closure | **11 passed, 0 failed** | Local source/recipe fixtures. |
| `node --check` on changed MJS tests | **PASS** | Syntax only. |
| APP `tlsn-production` Cargo check (`--lib --bins`) | **PASS** | `--locked --offline`; 8 compiler warnings, no lockfile update. |
| APP Manifest/Runtime Config Rust tests | **25 passed, 0 failed** | `tlsn_runtime_config_manifest` and `tlsn_runtime_config_runtime` filters. |
| APP preflight Rust tests | **22 passed, 0 failed, 1 ignored** | `tlsn_preflight` filter; generated-config roundtrip remains ignored unless explicitly supplied. |
| Proxy `alpha15-tlsn` check and policy tests | **PASS; 4 passed** | `--locked --offline`; unique-host, approved-port and mismatch cases. |
| Proxy Result signature tests and inclusive boundary test | **7 passed, 0 failed** | `--locked --offline`. |
| Proxy ordinary non-TLSN check | **PASS** | `--locked --offline`; one existing dead-code warning. |
| Offline Result verifier boundary test | **1 passed, 0 failed** | Synthetic cross-language Result vector. |
| Rustfmt | **PASS** for modified APP/Proxy modules; **NOT CLEAN** for the full `evidence_bundle.rs` file due unrelated pre-existing formatting hunks; the new boundary-test hunk has no formatter diff. |
| `git diff --check` | **PASS** | Explicit changed-path allowlist. |
| Hosted CI at base SHA `2ab34ff2` | **PASS** | Run #92 (`41201483438`): `node-contract-tests` and `rust-tlsn-preflight` succeeded. It predates the follow-up changes. |
| GitHub check-runs at base SHA `2ab34ff2` | **PASS with caveat** | Five check-runs report success, including three `Workers Builds` statuses. The separate CodeFlow status is `success` but reports 191 errors and 5,368 warnings; it is not a test result. |
| Branch protection / required-check policy | **NOT_CHECKED** | GitHub API returned HTTP 401 for the protection endpoint. |

No Hosted CI run exists for the follow-up commit because it was not pushed.
No Production Worker Binding change, R2 write, deployment, Notary/Game Server
connection or gameplay was performed. Bootstrap registration, fresh-client
replay protection and Stage A/B/C acceptance remain **BLOCKED**.

## Journal and independent rollback-witness follow-up — 2026-11-08

The current reader/verifier contract now receives a fresh read nonce plus
environment, chain, issue operation, request digest/nonce, lease/fence and
clock context for Journal and witness reads. It rejects context replay,
wrong configured provider/chain/time/witness source, invalid head position or
predecessor, unauthenticated observation time, and append-time uncertainty
outside the signed Release delegation. The test-only signature fixture
exercises these checks through the issue core and real local SQLite-backed
Workers RPC.

The local Coordinator runtime suite passes 21/21. Domain typecheck passes.
These results do not establish an AWS/Cloudflare provider's
linearizability, trusted commit time, current-head response, account/restore
separation, or independent witness durability. The bounded DynamoDB
conditional-append prototype is a recommendation only; no provider, account,
time source, witness, trust pin or Production binding is approved or
registered. The detailed contract, source links, candidate comparison,
conformance matrix and approval decisions are in
[runtime-config-freshness-journal-witness-contract.md](./docs/runtime-config-freshness-journal-witness-contract.md).

Hosted run [#115](https://github.com/tsukasa-u/FUSOU/actions/runs/42484486660)
still refers only to baseline `8a87314a055f45d37f1ae5b0524561575ab9b7ea`.
Post-change Hosted CI is **NOT_CHECKED**. Production acceptance and
Stages A/B/C remain **BLOCKED**.

## Local SQLite Release ledger and binding-install prototypes — 2026-11-09

The existing issue Coordinator now has a local-only Release ledger prototype
in the same SQLite-backed DO. It durably records exact signed Release bytes,
operation ID/request binding, predecessor, position/generation, fencing state,
and per-operation results. R2 publication is outside the SQLite transaction:
the prototype records intent, performs conditional pointer and immutable
snapshot writes, verifies exact bytes/ETag, then rechecks operation, fence,
predecessor, and head before changing durable state.

`LEDGER_COMMITTED` means only that the Release entry and head committed in the
local DO transaction. It does not open Freshness issuance. `AVAILABLE` means
that this local prototype also completed exact R2 readback; it still does not
by itself install an independently verified current-state binding or satisfy
Production Journal/witness, trusted-clock, or key-custody requirements.
Unknown outcomes and quarantine retain the writer gate. Local
`localAppendObservedAt` is not an authenticated provider receipt.

The same Coordinator now has a separate local-only binding-install path.
Release evidence is independently verified without manufacturing an issue
lease; bootstrap and advance use a distinct install context. The install
transaction rechecks the still-`AVAILABLE` head and operation, exact Release
and R2 bindings, fences, restore epoch, expected old binding, and issue
blockers before installing. The normal issue reader still verifies its
issue-specific operation, lease and Coordinator snapshot before and after
signing, and only exact finalized response bytes are returned. Bootstrap
requires an explicit test-only initial Release checkpoint; absent or corrupt
current state is not automatic genesis, and old install results cannot roll
back a later advance.

Coordinator typecheck passes; the pinned Workers runtime suite passes 56/56.
It covers the earlier concurrent append/idempotency/Unknown/R2/restart cases
plus explicit bootstrap, advance, issue-core signing/finalization,
response-loss recovery, stale or mismatched proof/head/fence/restore/R2
evidence, retained blockers, and missing/corrupt-state refusal. All Release
keys, initial checkpoint authority, clock, witness, and fault injection are
test-only. These results are local model evidence, not proof of deployed
Cloudflare guarantees.

The RPC lifetime follow-up on 2026-11-09 reran the same 56 cases successfully
with no undisposed-stub warning. The direct Node-side Miniflare DO proxy
could not expose Workers' `Symbol.dispose`; R2-only cleanup and fixture-only
R2 reads did not resolve that ownership boundary. The test-only Worker now
owns each real DO RPC call/result, encodes its data and exact byte arrays,
and explicitly disposes the handles before returning data to Node. The
loopback harness uses Miniflare's Worker fetch API for this allowlisted test
transport; no Production endpoint, wire contract or verification gate changed.
All child logs are forwarded, and the supervisor fails the run if the RPC
warning recurs even when assertions pass.

**Hosted status at this historical prototype snapshot (2026-11-09, before the
subsequent push):** the candidate workflow had not run for that working tree;
run [#115](https://github.com/tsukasa-u/FUSOU/actions/runs/42484486660)
covered baseline `8a87314a055f45d37f1ae5b0524561575ab9b7ea` only. This is
superseded for the committed SHA by run #116 in the current-status section
above. Stage A/B/C and Production acceptance remain **BLOCKED**.

## APP Notary trust configuration follow-up

Hosted run [#125](https://github.com/tsukasa-u/FUSOU/actions/runs/44078508976)
passed all three jobs for its baseline `d4728204435e8da2ad44353b19555c2ca4426e80`;
it predates the changes in this follow-up. Hosted run
[#126](https://github.com/tsukasa-u/FUSOU/actions/runs/44124438248) is a
failure on baseline `9ef45dc9990527a1e71eda678fb1e9c1522f7c3d`: its Proxy
capture, health, existing 20-case, and six separate-process Notary checks
passed, but APP preflight and the Gateway-to-APP check failed because
`wrap_proxy.rs` still called the six-argument transport constructor with only
three arguments.

The constructor path now uses the verified alpha.15 K256 Notary verifying key,
the explicit Notary ID carried from the Production public manifest, the signed
Runtime Config environment, and the verified endpoint. Notary ID remains
distinct from signing-key ID and is never inferred from an endpoint or
acknowledgement. The Production public manifest contract now requires
`notary.notary_id` and binds it into the security-registry-set digest and
approved Runtime Config inputs. Older Production manifests without that field
are rejected; the changed approved-input inventory requires newly authorized
configuration rather than silently accepting an old delegation.

**Status for this follow-up**

- `SOURCE_IMPLEMENTED`: the APP constructor call and its shared source helper
  now pass all six required arguments; the Worker publisher, independent
  verifier, Runtime Config Domain, and test vectors validate the explicit
  Notary ID and environment binding.
- `LOCAL_TEST_VERIFIED`: Node v22.21.1 passed the candidate Worker reference
  and manifest vector-check step (103 tests, zero skipped), and the delegation
  vector generator check passed. Also passed: 12 APP pre-capture tests, six
  Runtime Config Domain artifact tests and its typecheck, 29 isolated
  APP-source harness tests plus one doctest, the existing Proxy/Notary 20
  cases, and six separate-process loopback Notary cases. The isolated harness
  compiles the production helper and invokes the real constructor.
- `HOSTED_CI_VERIFIED`: `NOT_CHECKED` after these changes. Run #126 remains
  the pre-fix failure and is not evidence for the updated source.
- `PRODUCTION_VERIFIED`: `NOT_VERIFIED`. No external Notary, Game Server,
  Worker, deployment, or production key was used.

The Worker package typecheck did not pass: its checked-in WASM declarations
are missing four exports required by current sources. No stale or ad hoc WASM
binding was substituted or regenerated. The complete APP Cargo build also
remains unverified. During local validation, an overly broad Node command
included `tlsn-runtime-config-freshness-test.mjs`, which unintentionally
started APP Cargo despite the local execution restriction; it failed with
`E0308` in a test's double-`Arc` construction. That test code was corrected,
and the isolated APP-source harness passed afterward; APP Cargo was not
rerun. This accidental attempt is not evidence of an APP build pass.

The changed call-path Rust files pass the pinned formatter check. The
large APP Runtime Config manifest source still has formatter differences in
unrelated existing sections, which were left untouched. Stage A/B/C and
Production acceptance remain **BLOCKED**.

## #127 APP fingerprint preflight follow-up

Hosted run [#127](https://github.com/tsukasa-u/FUSOU/actions/runs/44172007326)
used baseline `1a8ae0c4b8613df34761f58c9ee16b7803078e1a`. The earlier APP
constructor E0061 was no longer reported. The run nevertheless failed because
`canonical_fingerprint_encoding_is_order_independent_and_domain_separated`
had 22 passes, one failure, and one ignored test in preflight; the subsequent
health step was skipped. The failure compared the current schema version with
the same hard-coded version used by the baseline, so both canonical inputs
produced the reported digest
`rSc3uy_G1QxCaYKElagk6_nQ-1DTedv9o9e0wKODw_8`.

The test now derives a distinct representable schema value from the shared
contract version, handling `u8` overflow, while holding scope and both input
digests constant. Its separate scope case holds the current schema and both
digests constant and derives a different scope. Key-order equality and both
domain-separation assertions remain. Production hashing, shared schema/scope,
canonicalization, vectors, and Notary configuration contracts are unchanged.

**Verification after this change**

- `SOURCE_IMPLEMENTED`: only the preflight test assertions and this readiness
  record changed.
- `LOCAL_INDEPENDENT_CALCULATION_VERIFIED`: a standalone Python calculation
  reproduced the Hosted baseline digest, matched the shared combined vector,
  confirmed equal hashes for reordered JSON keys, and confirmed distinct
  results when only schema or only scope changed.
- `LOCAL_RUST_TEST`: `NOT_RUN`. The existing isolated APP harness replaces
  `tlsn_preflight` with a stub and does not compile this test; its passing
  results are not counted here. APP Cargo is prohibited for this verification.
- `HOSTED_CI_VERIFIED`: `NOT_CHECKED` after this fix.
- `PRODUCTION_VERIFIED`: `NOT_VERIFIED`. Stage A/B/C and Production
  acceptance remain **BLOCKED**.

## Initial Notary loopback binding — baseline Actions #132

Baseline branch: `tlsn-first-testplay-candidate`, HEAD
`62d52bf28952198e5244763ddb052153851e8e9c`. Actions
[#132](https://github.com/tsukasa-u/FUSOU/actions/runs/44626018477) completed
all three jobs successfully for that exact SHA. This is the pre-change baseline;
it does not validate the local follow-up below.

The normal Notary binary now validates its operator configuration before
signing-key/trust-anchor reads, ledger operations, or listener bind. The
`listen` value must be canonical IPv4 loopback `127.0.0.1:<non-zero-port>`,
and `public.endpoint` must be the exact same `host:port` string. The check is
shared by `init`, `serve`, and `export-public`. It does not change Runtime
Config's generic endpoint contract or the Notary wire/signing format.

### Local verification

| Check | Result | Scope |
|---|---|---|
| Rust toolchain | **VERIFIED** | `rustc` and `cargo` 1.98.1. |
| Normal Notary release build | **PASS** | `cargo +1.98.1 build --release --locked --offline --features operational-notary --bin fusou-notary`, with a fresh isolated `CARGO_TARGET_DIR`. |
| Loopback integration test discovery | **PASS** | `local_notary_interop -- --list` reported 11 tests. |
| Existing normal-binary Complete/restart regression | **PASS, 1/1** | `normal_binary_complete_and_restarts_using_the_same_ledger`; ordinary `fusou-notary` binary, canonical `export-public` JSON matching the approved signed endpoint, Complete capture, independent Presentation verification, one synthetic-origin request, exact finalized bytes after same-ledger restart, and zero origin requests when the Notary endpoint is unavailable. |
| Invalid configuration regression | **PASS, 1/1** | `normal_binary_rejects_invalid_loopback_settings_before_side_effects`; covers wildcard, non-loopback, IPv6, hostname, zero-port, endpoint host substitution, and port mismatch across `init`, `serve`, and `export-public`. Init created no ledger, export emitted no JSON, and serve left the existing ledger unchanged. |
| Rust formatting | **PASS** | `rustfmt +1.98.1 --edition 2021 --check` on the changed Rust source and integration-test module. |
| Candidate workflow selection | **VERIFIED** | The normal release step discovers and runs both exact normal-binary test names. |
| Workflow YAML and embedded shell | **PASS** | Parsed the candidate workflow and ran `bash -n` on the normal-Notary step. |
| Documentation links and diff check | **PASS** | Relative links in the changed runbook and this entry resolved; `git diff --check` passed with protected paths excluded. Changes remain unstaged. |

The release build and integration tests used `--locked --offline`; all Notary
and origin communication was loopback/synthetic. The invalid-configuration
test did not bind a non-loopback address. The [runbook](../FUSOU-TLSN-VERIFICATION-WORKER/docs/notary-release-runbook.md)
marks `9444` as illustrative and requires the operator-selected port to match
in the signed APP config and approved registration before ledger initialization.
No production host, port, key, or ledger was selected or initialized. Windows,
macOS, mobile, and a separate-host authenticated/encrypted pre-grant transport
remain follow-up work.

| Acceptance | Status |
|---|---|
| Hosted CI after this change | **NOT_CHECKED** |
| Stage A/B/C | **BLOCKED** |
| Production acceptance | **BLOCKED** |

## Linux PAC transaction and shutdown — local verification

**HISTORICAL SNAPSHOT:** These local results were recorded for a worktree
based on `2d5cc0904769c69242a7c638020a1d1322b72fef`, during the
2026-11-21 JST validation session (session record began at 03:39 JST; exact
test completion time was not retained). The Hosted CI and desktop statuses
below describe that snapshot, not the current state. Current #140 evidence is
recorded at the top of this document.

The starting branch and HEAD were `tlsn-first-testplay-candidate` and
`2d5cc0904769c69242a7c638020a1d1322b72fef`. Existing changes outside this task
were preserved.

**SOURCE_IMPLEMENTED / LOCAL_TEST_VERIFIED:** Linux PAC apply now snapshots the
selected GNOME or KDE backend and exact prior values/presence before writing.
It reads settings back before recording success, rolls back only values still
owned by that attempt, and preserves later user changes. Cleanup restores the
saved values and verifies them; unconfirmed recovery state is retained. Normal
cleanup reads the mode and URL pair while state is still `active`. It persists
`removing` only when the current pair, including saved presence, matches both
FUSOU-applied values. An already-restored original pair completes without
settings writes; any other pair is preserved as an external change. A persisted
`removing` state resumes by restoring only keys still at their applied values,
then verifies the final original pair. Apply-failure rollback remains separate
from this post-apply ownership check.
Restart and Quit are serialized behind any apply operation and wait for the
cleanup process plus its termination/readback result. Cleanup failure cancels
shutdown/restart, leaves the APP running, and permits a retry; an unknown
process result fails closed. If the APP remains open after cleanup failure or
after confirmed PAC removal but a failed shutdown request, readiness marks the
PAC stage failed with `pac_cleanup_unconfirmed` or
`pac_application_removed`. Windows PAC behavior is unchanged.

At this snapshot, PAC application readiness meant only that the configured
settings were read back successfully. Readiness did not collect browser
evidence, so `browser_proxy_traffic` remained `not_checked`. Separately, the
#140 disposable-container observation at the top of this document recorded
system PAC retrieval and a browser request through FUSOU Proxy; that does not
change the readiness field. The local tests did not alter desktop settings or
contact services. The workflow already ran the GNOME/KDE mocked transaction
suite, and its APP-source Manifest harness included the PAC operation-gate
tests.

The PAC runner now uses the API present in the locked
`tauri-plugin-shell 2.5.0`: `set_process_group(true)` and consuming
`CommandChild::kill()`. It waits for the `Terminated` event and confirms the
process group is gone. Timeout, missing termination confirmation, or an
unconfirmed process-group stop is surfaced as an unknown outcome and latches
the operation gate, so another apply or successful Restart/Quit is blocked.
This does not add a recovery command for clearing that latch.

| Check | Result | Scope |
|---|---|---|
| Linux shell syntax | **PASS** | `bash -n` for the shared helper, apply/remove scripts, and mock suite. |
| Mocked GNOME/KDE PAC transactions | **PASS, 26/26** | The prior 18 cases remain; added the exact URL-reselected-as-original and already-original-pair cases, failed `removing`-state persistence with zero setting writes, and interrupted second-restore-write/retry coverage on both backends. |
| Candidate workflow selection | **VERIFIED** | The existing workflow invokes `scripts/test-pac-settings.sh`; the added cases run without a selector change. |
| Locked Tauri process API harness | **PASS, 3/3** | Rust 1.98.1 `cargo test --locked --offline --all-targets` in an isolated crate pinned to Tauri 2.12.3, `tauri-plugin-shell` 2.5.0, Tokio 1.53.2 and libc 0.2.190; compiled and exercised the production Linux PAC process module for normal exit, timeout/group stop, and unconfirmed termination. |
| APP-source Manifest harness | **PASS, 41/41** | Rust 1.98.1 `cargo test --locked --offline --all-targets` with isolated `CARGO_TARGET_DIR`: 40 unit tests plus 1 shared-vector integration test; includes gate serialization, failed cleanup, unknown-result, and readiness-not-ready-on-cleanup cases. |
| Readiness browser regression | **PASS, 1/1** | Dedicated Chromium readiness interaction command; existing refresh behavior remains intact. |
| Rust formatting | **PASS (focused)** | Rust 1.98.1 `rustfmt --check` passes for the changed PAC runner, native command, and module declaration; an APP-wide format check was not run. |
| Protected-path-excluded `git diff --check` | **PASS** | Both worktree and index whitespace checks passed while excluding the protected paths. |
| APP Cargo / APP-launching Node suite | **NOT_RUN** | Excluded by task scope; the native APP binary and startup wiring were not built. The exact production PAC process module was type-checked separately against the locked Tauri API. |
| Real GNOME/KDE desktop and APP Restart/Quit at this snapshot | **NOT_CHECKED** | No real desktop settings, PAC retrieval, browser route, or APP process was used then; later container-only observations are recorded at the top. |
| Hosted CI after this change at this snapshot | **NOT_CHECKED** | No Actions run had been started then; Actions #140 is the later hosted result recorded at the top. |
| Stage A/B/C and Production acceptance | **BLOCKED** | Real deployment, services, Notary, Game Server, gameplay, and production evidence remain unverified. |

## Candidate CI #135 — isolated readiness browser regression

Run [#135](https://github.com/tsukasa-u/FUSOU/actions/runs/44718041221/job/136226343474#step:7:1)
successfully installed Chromium in step 6. Step 7 selected one readiness story,
but Vite dependency scanning also reached an adjacent `FUSOU-TESTDATA` fixture
that was absent in CI and reported `ENOENT`. The log then showed React
resolution warnings, a Vite reload, and Storybook setup reporting
`Vitest failed to find the runner`; the browser regression ran zero tests. This
records the observed sequence without asserting a causal relationship beyond
the log.

The candidate workflow now keeps Chromium preparation and switches step 7 to
`vitest.readiness.config.ts`, which uses the existing Solid Vite plugin, Vitest,
the Playwright provider, and headless Chromium without loading Storybook addons,
preview, or stories. Its focused browser test renders the actual readiness
component, mocks only Tauri IPC, and verifies that the first response displays
`ready` and its confirmation time; while the second response is pending both
are cleared; and an IPC rejection displays
`tlsn_capture_readiness_query_failed`.

### Isolated local verification

| Check | Result | Scope |
|---|---|---|
| Clean source environment | **PASS** | Temporary source snapshot without existing `node_modules`, Vite cache, or adjacent `FUSOU-TESTDATA`; protected paths were excluded. |
| Runtime and install | **PASS** | Isolated Linux container with Node 22.16.0 and pnpm 10.14.0; `pnpm install --frozen-lockfile --ignore-scripts` passed and APP Playwright CLI reported `Version 1.58.2`. |
| Chromium preparation | **PASS** | `playwright install --with-deps chromium` completed inside the isolated container. |
| Dedicated readiness browser regression | **PASS, 1/1** | Workflow command `pnpm --dir packages/FUSOU-APP exec vitest run --config vitest.readiness.config.ts`; 1 test passed, 0 failed, 0 skipped in Chromium. |
| Hosted CI after this change | **NOT_CHECKED** | No Actions run was started. |
| Stage A/B/C and Production acceptance | **BLOCKED** | No real APP, service, Notary, Game Server, or Production evidence was exercised. |

The test does not use Storybook or require `FUSOU-TESTDATA`; no skip or
`continue-on-error` was introduced. Changes remain unstaged.

## Local APP TLSN capture-readiness diagnostic

Baseline Actions [#133](https://github.com/tsukasa-u/FUSOU/actions/runs/44636473582)
passed all three jobs at the exact pre-change SHA
`75ff8c7c6287629e8bb120742396137da4ae1a4d`. This is a historical baseline,
not Hosted CI verification of the diagnostic changes below.

The APP now has an on-demand, read-only capture-readiness snapshot on its Start
page and `/app` TLSN readiness tab. It reports Proxy listener, Runtime Config /
Freshness, Worker health, forwarder initialization, grant expiry/use/cleanup,
and active-capture state using fixed status values and diagnostic codes. It
does not refresh configuration, call Session/device-proof services, admit to
the Notary, or contact the origin. Notary connectivity, observed server
identity, evidence acquisition, and gameplay authorization remain separately
`not_checked`. The existing APP-start marker and static preflight retain their
prior meaning.

### Local verification

| Check | Result | Scope |
|---|---|---|
| Rust toolchain | **VERIFIED** | Rust/Cargo 1.98.1. |
| Proxy capture/lifecycle harness | **PASS, 38/38** | `cargo +1.98.1 test --locked --offline --lib` with isolated `CARGO_TARGET_DIR`; includes repeated expiry reads at `now >= expires_at_ms`, no grant release/repreparation, in-use expiry, active capture, and cleanup-unconfirmed status. |
| APP-source Manifest harness | **PASS, 34/34** | `cargo +1.98.1 test --locked --offline --all-targets` with isolated `CARGO_TARGET_DIR`; 33 unit tests plus 1 shared-vector integration test, including stage failures, forwarder pending, expired/in-use/cleanup readiness, and ten repeated reads with zero `capture_ready` checks, freshness, Worker-health, Session, device-proof, Notary-admission, or origin calls. |
| APP-source harness type-check | **PASS** | `cargo +1.98.1 check --locked --offline --lib` after adding only direct harness dependencies already present in the lock graph (`http` 1.5.0, `hyper` 1.12.0, `tracing` 0.1.44). No dependency versions or checksums changed. |
| APP frontend bundle | **PASS** | `corepack pnpm exec vite build --outDir /tmp/fusou-app-vite-check`; the Solid UI transformed and bundled without launching Tauri or the native APP. |
| APP frontend ESLint | **BLOCKED** | Both package lint and targeted ESLint stop before analysis with installed `minimatch` error `expand is not a function`; no dependency or unrelated tooling change was made. |
| Rust formatting | **PASS WITH EXISTING DRIFT** | Focused `rustfmt +1.98.1 --edition 2021 --config skip_children=true --check` passes for changed Proxy, APP readiness, and harness modules. A full-file check of the existing `cmd/tauri_cmd.rs` reports unrelated pre-existing formatting differences; those lines were not reformatted. |
| Candidate workflow selection | **VERIFIED** | The existing Proxy capture `--lib` harness and APP-source Manifest `--all-targets` harness include these tests; no workflow selector change was needed. |
| APP Cargo / launching Node suite | **NOT_RUN** | Excluded by task scope; the native Tauri command and startup wiring are not compiled by the isolated harness. |
| Hosted CI after this change | **NOT_CHECKED** | No Actions run was started. |
| Stage A/B/C and Production acceptance | **BLOCKED** | No real APP deployment, Worker/Session service, Notary, Game Server, gameplay, or Production Presentation/Result was exercised. |

The [operator runbook](../FUSOU-TLSN-VERIFICATION-WORKER/docs/production-evidence-operator-runbook.md)
describes the local panel, status interpretation, and the requirement to keep
gameplay disabled until readiness is `ready`. That status is only APP-side
preparation; it is not evidence of live Notary connectivity or Production
acceptance. Changes remain unstaged.

| Acceptance | Status |
|---|---|
| Hosted CI after this change | **NOT_CHECKED** |
| Stage A/B/C | **BLOCKED** |
| Production acceptance | **BLOCKED** |

## Empty-database initializer and fresh Session-flow rerun — 2026-11-22

This addendum supersedes the earlier migration limitation only for the
TLSN-specific initializer. Applying the unmodified migrations to an empty
database without the historical prelude still fails: after
`20251217040555_remote_schema.sql`, the first failure is in
[`20260518000000_user_devices_and_rotations.sql`](../FUSOU-WEB/supabase/migrations/20260518000000_user_devices_and_rotations.sql),
at `COMMENT ON COLUMN public.user_member_map.salt_version ...`, with SQLSTATE
`42P01` (`public.user_member_map` does not exist).

**EMPTY_DATABASE_INITIALIZATION_VERIFIED:** The
[`init:tlsn-testplay-supabase` initializer](../FUSOU-WEB/scripts/init-tlsn-testplay-supabase.mjs)
uses the minimal historical
[`user_member_map` prelude](../FUSOU-WEB/supabase/tlsn-testplay/legacy-user-member-map.sql)
grounded in
[`docs/sql/supabase/schema.sql`](../../docs/sql/supabase/schema.sql), then
applies all 25 original migrations in order without editing, skipping, or
filtering their SQL. Original migration digests were unchanged. The resulting
database's cutover UUID schema, device/proof-consumption tables, RPCs, and
permissions were checked. Re-running initialization against a populated
database was refused before writes. The initial empty-database baseline was
25 migration records, 0 Auth users, and 0 devices. This does not claim that
the raw migration sequence is standalone without its required historical
prelude.

**LOCAL_SESSION_FLOW_VERIFIED:** In that disposable project, the built WEB,
local Supabase Auth/PostgREST/PostgreSQL, the actual Verification Worker
entrypoint, and its SQLite-backed `TlsnBindingAuthorityDurableObject` ran
locally. The final flow used newly created non-anonymous Auth users, a
registered Ed25519 device, and a challenge from the built WEB. The Worker ran
with `TLSN_ENVIRONMENT=test`; no deployment role or `TLSN_TEST_*` auth/device/
binding override was set. All configured service URLs were loopback.

The Worker returned `401` without a bearer, `403` for another user's device,
`201` for Session issuance, and `409` for authentication-proof replay. Rejected
responses contained no Session ID, binding, receipt, or grant. Receipt and
grant signatures and claims were independently checked against the pinned
shared-vector Session Authority key; mutations and an unrelated key failed.
The existing `DurableObjectBindingAuthority.lookupBinding` found an active
stored record matching the response. The WEB accepted a possession proof
created from that Session with HTTP `200` and the expected
`replay_digest_hex`; replay returned `409`. Database counts were exactly one
authentication proof, one possession proof, and one nonce consumption for
the successful test device, unchanged after replay.

The initial end-to-end attempt used a custom global-fetch wrapper that did not
preserve the test harness's proxied outbound Authorization headers and
returned `401`. Removing that wrapper (the harness already uses Node's
`globalThis.fetch` for outbound requests) allowed the fixed loopback
endpoints to work. No product-code change was needed. Earlier diagnostic
attempts left only disposable fixture rows (Auth users, identity mappings, and
devices) in this project before
the final successful run; the successful assertions used distinct new
identities and were scoped to that device. The complete project volume was
removed afterward.

**LOCAL_TEST_VERIFIED:**

| Check | Result |
|---|---|
| WEB TypeScript check (`pnpm --dir packages/FUSOU-WEB exec tsc --noEmit --pretty false`) | **PASS** |
| WEB proof/anonymous-sync Vitest selectors (four candidate-CI files) | **PASS, 73/73**, 0 failed, 0 skipped |
| TLSN WEB build-profile regression | **PASS, 5/5**, 0 failed, 0 skipped |
| Worker TypeScript check | **PASS** |
| Worker proof-client and Session-grant tests | **PASS, 31/31**, 0 failed, 0 skipped |
| Real local Auth → Worker Session → DO lookup → WEB possession proof | **PASS**, HTTP and database results above |

The host did not have the PostgreSQL 16 `initdb` binary expected by the WEB
test helper. The same candidate selectors were therefore rerun with a
temporary isolated PostgreSQL 17.12 cluster inside the owned disposable
Supabase container; the helper used real `initdb`/`postgres`/`pg_ctl`/`psql`
and its temporary cluster was removed. No system PostgreSQL package or
service was installed. Tool versions: Node 22.21.1, pnpm 10.14.0, Supabase
CLI 3.2.0, PostgreSQL 17.12, Wrangler 4.135.0, and Vitest 4.1.11.

The disposable WEB/Supabase listeners were stopped; its four containers,
database volume, network, workdir, temporary credentials, `.dev.vars`, and
named Wrangler/Miniflare harness states were removed. Ports 58432, 37731, and
37161 were confirmed closed. Ignored WEB build output remains, without test
credentials. No Hosted CI, Cloudflare deployment, APP/Notary operation,
Presentation, `/verify/tlsn`, Production Result, or game-server communication
was run. Hosted CI remains **NOT_CHECKED**; Stage A/B/C and Production
acceptance remain **BLOCKED**.

## Production-role local Session flow — 2026-11-22

**LOCAL_PRODUCTION_ROLE_SESSION_FLOW_VERIFIED (local contract only):** At
HEAD `0dd7a8e92d3ad90b7fc6a9865741c9273266534c`, the actual Verification
Worker bundle ran with `TLSN_ENVIRONMENT=production` and
`TLSN_DEPLOYMENT_ROLE=production`. It used random Durable Object bindings and
the production auth mode (`supabase` / `external-endpoint`); no Canary,
Replay, fixed binding, or `TLSN_TEST_*` override was supplied. The health
response was HTTP `200`, `ok=true`, with
`security_identity.trust_contract_valid=true`.

The local-only trust setup used exact checked-in Origin Inventory and Target
Approval bytes, with SHA-256/base64url values
`oPGCXkdYTkTCfif4bmujVhtHP-vOSmF1CB8R6eo-XZ0` and
`LMq3_l4PVfOv1K3rKXVekG1N7VOOxn5rQBZRr-J7z78`. The Security Registry Set
digest was calculated by the existing `productionSecurityRegistrySetHash`
helper and matched:
`X3nb5x7UjNSbWWOpCy_Ax7IGSBCgCmrlI4vX_iyn0cE`. Temporary, separate Session
Authority, Binding Authority, and Result signer keys were used; the Result
registry envelope/root pin followed the existing bootstrap-trust test
pattern. The Notary registry used the existing public alpha.15 K256 fixture
[`tlsn-alpha15-clean-upstream-sparse-notary-verifying-key.bin`](./fixtures/tlsn-alpha15-clean-upstream-sparse-notary-verifying-key.bin)
with a local-only registry. This is not a real Notary key, registry, or
deployment trust record.

`tlsn-web.fusou.test` and `tlsn-auth.fusou.test` were mapped only to loopback.
Normal HTTP requests from the harness reached a loopback bridge, which invoked
the real Worker through Miniflare `dispatchFetch`; Worker outbound requests
used Miniflare's restricted `outboundService` and a temporary Node HTTPS
adapter. The adapter terminated TLS (not workerd), validated its task-local
CA with certificate verification enabled, and preserved request headers,
method, body, and upstream status. A client using an unrelated CA was
rejected before service ingress. No DNS, deployed Worker, real Supabase, or
game-server connection was used.

Two non-anonymous users signed in through the disposable Supabase Auth. The
built WEB issued the device challenge; the first authentication proof was
sent to the Worker:

| Check | Result |
|---|---|
| `/health` | **200**; production role, random binding, valid local trust contract |
| Invalid host allowlist / HTTP URL / Result registry root pin / Inventory digest | **503** for each invalid configuration |
| Missing bearer / other user's device / authentication proof replay | **401 / 403 / 409**; no Session material in rejection responses |
| Session issuance | **201** |
| Session receipt and context-grant signatures | **Verified** against the independently pinned local Session Authority key; mutations and an alternate key rejected |
| Durable Object lookup | **Matched** the issued Session and one SQLite-backed record |
| WEB possession proof / replay | **200 / 409**; returned replay digest `bd1ad519ad91eafaa18e59f7fd3ff6495a85ab767375a6436007fa0f3a4e0c7d` |
| Proof-consumption rows | Authentication **1**, possession **1**, nonce **1**; replay added no rows |

The Worker made 6 outbound requests through the TLS adapter (8 TLS ingress
requests total); three out-of-policy host/path/HTTP probes were rejected.
TLS negotiated `TLSv1.3`. These results establish only the local Worker/Auth/
WEB/DO contract. No Presentation, Notary interaction, `/verify/tlsn`,
Production Result execution, APP startup, or gameplay was performed.

**LOCAL_TEST_VERIFIED:**

| Check | Result |
|---|---|
| `pnpm --dir packages/FUSOU-TLSN-VERIFICATION-WORKER run typecheck` | **PASS** |
| `node --experimental-strip-types --test packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/device-proof-client.test.mjs packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/session-context-grant-contract-test.mjs` | **PASS, 31/31**, 0 failed, 0 skipped, 0 cancelled |
| Session-only Production-role integration harness | **PASS**, all scenario assertions completed |

Versions: Node `v22.21.1`, pnpm `10.14.0`, Wrangler `4.135.0`, Miniflare
`5.20260918.0-alpha`, Supabase CLI `3.2.0`, PostgreSQL `17.12`.

The disposable Supabase containers, network and database volume were removed.
The task-local credentials, test users/devices, TLS CA and keys, SQLite/
Wrangler state, Worker bundle, and session-only integration harness were also
removed; loopback listeners were confirmed stopped. Existing ignored WEB build
output and unrelated worktree changes were preserved. No product-code or CI
change was made for this Production-role check.

Hosted CI remains **NOT_CHECKED**. Stage A/B/C and Production acceptance remain
**BLOCKED** pending real deployment, Notary, Presentation/Result, APP, and
gameplay evidence.

## Isolated APP capture-readiness attempt - 2026-11-23

**APP package build: VERIFIED (build-only). APP capture readiness: BLOCKED.**
The APP GUI was not started because a disposable local Supabase stack could
not be reached safely from the host while blocking container egress. This was
an isolated source/HOME/target build on the host OS, not a disposable desktop
runtime.

### Build inputs and result

The source snapshot was assembled from branch
`tlsn-first-testplay-candidate`, HEAD
`0dd7a8e92d3ad90b7fc6a9865741c9273266534c`, the allowed working-tree changes,
and the six untracked WEB profile files listed below. The protected
`packages/FUSOU-APP/src-tauri/roaming/user/configs.toml` and all tracked `.env`
files (`packages/FUSOU-APP/.env`, `packages/FUSOU-APP/src-tauri/.env`,
`packages/FUSOU-WEB/.env`, `packages/FUSOU-WORKFLOW/.env`,
`packages/fusou-auth/.env`, and `packages/fusou-compaction-trigger/.env`)
were excluded. The source-only snapshot digest is SHA-256
`dba211d59430cdb721aecc23a214102c5cb715177451f133b5712a0fda00a4f2`;
it covers 2,459 files, excluding `node_modules` and generated
`packages/FUSOU-APP/dist`.

The explicitly included untracked inputs were:

| File | SHA-256 |
|---|---|
| `packages/FUSOU-WEB/astro.config.tlsn-testplay.mjs` | `468ef3457d0649090e8b0d22f116e05f578f3042049d4e647e41d1b6760a7b1a` |
| `packages/FUSOU-WEB/scripts/build-tlsn-testplay.mjs` | `6f15e4810b035d2ff74047f4d1cb3ec7e0235a91c9dbab0ae94045767bb7218d` |
| `packages/FUSOU-WEB/scripts/init-tlsn-testplay-supabase.mjs` | `f8374f3378b9948af055c78fe0d6334c802828591e7bfcf474ccec55060877e2` |
| `packages/FUSOU-WEB/scripts/tlsn-testplay-build-profile.mjs` | `a97605f229def102bce7e2a634ab0a762765e1bf9c3ea8c08c69a63222c76069` |
| `packages/FUSOU-WEB/scripts/tlsn-testplay-build-profile.test.mjs` | `730f085e447ca6a28e44bed69bcce2ec52c6ddd84121a4dd642d8adbd50a75fb` |
| `packages/FUSOU-WEB/wrangler.tlsn-testplay.toml` | `90b86fb07f5d664ac25faae9e5b3df2edf14296996e48f1a561042e1bd2a5f53` |

Build-only public inputs were:

| Input | Value or status |
|---|---|
| Runtime Config Manifest URL | `https://runtime-config.fusou.test/tlsn/runtime-config/v2/manifest.json` |
| Runtime Config signer key ID | `local-capture-readiness-build-only` |
| Runtime Config signer SPKI SHA-256 | `4bc36ee1cb15503284bbbb6b8daa4910c58c7a27b074c0dfe7e3b824a2332907` |
| Supabase URL | `https://tlsn-auth.fusou.test` |
| Supabase publishable key | Synthetic `sb_publishable_...` value; not an Auth key and not usable for runtime |
| `FUSOU_APP_BUILD_SOURCE_SHA` | `0dd7a8e92d3ad90b7fc6a9865741c9273266534c` (metadata input only; the snapshot was dirty) |

The keypair was generated only for the build check; no private key was
persisted. The build ran with an empty Vite env directory, an isolated HOME
and `CARGO_TARGET_DIR`, `env -i` containing only the listed public inputs and
tool paths, and `CARGO_NET_OFFLINE=true`. Locked JavaScript dependencies were
installed offline: 1,364 packages added, 1,349 reused, 0 downloaded.

Commands:

Run from the isolated source snapshot root, with the sanitized environment
described above:

```sh
pnpm install --offline --frozen-lockfile --ignore-scripts --package-import-method=copy
pnpm --dir packages/FUSOU-APP exec vite build --mode production
pnpm --dir packages/FUSOU-APP exec tauri build \
  --target x86_64-unknown-linux-gnu \
  --features tlsn-production,custom-protocol \
  --bundles deb \
  --config src-tauri/tauri.verification-linux.conf.json \
  --no-sign --ci -- --locked
```

The Vite build and unsigned verification-only Debian package build succeeded.
The package was `fusou_0.5.0_amd64.deb`, SHA-256
`30c6a2cb92b64899399bfcec5786bf490f0ad1ae9a08977ef661ef8f438e2bcb`.
The package contained `resources/user/configs.toml` and did not contain the
protected roaming config. The compiled bootstrap report matched the expected
URL, key ID, and SPKI, with registration `EMBEDDED_UNVERIFIED` and authority
`UNVERIFIED`. The compiled public configuration report matched the expected
hash `B-fn0LsA-eZvbTzzMM06oEbBp4bY-GI5oIYdXw8kPq4`, also with authority
`UNVERIFIED`. These reports validate compile-time wiring only; no signed
Manifest or usable local Supabase key was provisioned. The build emitted
existing Rust warnings and a Tauri bundler warning about the missing
`__TAURI_BUNDLE_TYPE` marker.

Versions: Node `v22.21.1`, pnpm `10.14.0`, Vite `7.3.5`, Tauri CLI `2.9.4`,
Rust/Cargo `1.98.1`, Supabase CLI `3.2.0`, Docker `29.10.0`, PostgreSQL image
`17.12.0.000`. The local Node version differs from candidate CI's
`22.16.0`.

### Runtime block and status

The disposable initializer was attempted on a Docker `--internal` network.
Supabase CLI's startup health check requires host-published ports, but Docker
created no port mapping for that network. A bounded reproduction failed after
305.6 seconds with `HealthCheckTimeoutError` and `ECONNREFUSED` on its
127.0.0.1 database port; direct host access to the container IP worked.
Host `iptables` access was denied and non-interactive `sudo` was unavailable,
so no host firewall rule or non-internal network was used. The internal
network/health-timeout experiment was reverted; the initializer retains
offline npm CLI resolution. Its syntax check and offline Supabase CLI version
check passed.

| Check | Status |
|---|---|
| APP package and compiled configuration reports | **VERIFIED**, synthetic build inputs only |
| Runtime Config Manifest/artifacts/Freshness and high-water | **NOT_CHECKED** |
| Worker health, new Session, and Durable Object state | **NOT_CHECKED** in this attempt |
| WEB/Auth, device proof, and session grant | **NOT_CHECKED** in this attempt |
| APP GUI, Start, and `get_tlsn_capture_readiness` | **BLOCKED**; APP not launched |
| PAC setup/restore | **NOT_CHECKED**; APP did not touch PAC |
| Game DNS/TCP/HTTP, Notary, `/verify/tlsn`, Presentation | **NOT_CHECKED**; no APP runtime request was generated |
| Hosted CI | **NOT_CHECKED** |
| Stage A/B/C and Production acceptance | **BLOCKED** |

No APP GUI/proxy runtime, browser/WebView, CA installation, Auth session,
Worker, Gateway, WEB, or completed Supabase stack was started. The packaged
binary was invoked only for its two compiled-configuration reports. No game
target was resolved or contacted, and no Notary attempt or Presentation output
occurred.
This is not a measured end-to-end zero-traffic result because the APP runtime
never began. Task-owned diagnostic containers, networks, volumes, source
snapshot, build inputs, and package output were removed; pre-existing local
stacks and unrelated worktree changes were left untouched. No host firewall,
PAC, CA, or protected APP configuration was changed.

Hosted CI remains **NOT_CHECKED**. Stage A/B/C and Production acceptance
remain **BLOCKED** pending an egress-isolated local service path, real APP
readiness, and the remaining Notary/Presentation/Result and gameplay evidence.

## Internal Docker-only service connectivity — follow-up

**LOCAL_INTERNAL_SERVICE_VERIFIED:** This follow-up exercised the disposable
Supabase, dedicated WEB, Production-role Verification Worker, and Runtime
Config/Freshness services on one Docker internal network. It resolves the
earlier Supabase CLI startup failure recorded above: the internal network has
no published host ports, while the CLI expects loopback API/DB access. The
task-only initializer relay now provides that loopback path without switching
to a regular bridge, changing host firewall rules, or using
`--ignore-health-check`.

The run used Docker `29.10.0`, Supabase CLI `3.2.0`, PostgreSQL
`17.12.0.000`, Wrangler `4.135.0`, Node `22.21.1` on the host and `22.16.0`
in the service container, pnpm `10.14.0`, Miniflare `5.20261113.0-beta`, and
workerd `1.20261113.1`.

Commands from the repository root:

```sh
pnpm --dir packages/FUSOU-WEB run init:tlsn-testplay-supabase -- --internal-isolated
pnpm --dir packages/FUSOU-WEB run build:tlsn-testplay
pnpm --dir packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-GATEWAY run typecheck
pnpm --dir packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-GATEWAY run test:runtime
pnpm --dir packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR run typecheck
pnpm --dir packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR run test:runtime
```

The disposable network was `fusou-tlsn-testplay-supabase-wLio8e`; Docker
reported `internal=true` and IPv4 gateway mode `isolated`. Each task service
container was attached only to this network, and Docker had no effective
published service ports. The initializer's host-loopback TCP relay forwarded
only the CLI's API and DB connections to Supabase Kong (`kong:8000`) and
PostgreSQL (`db:5432`) through the internal network. The relay preflight
round-trip passed before the CLI started. Its temporary host listeners were
ports `43421` and `34509`; both were closed after cleanup.

The dedicated WEB build completed. The empty disposable DB applied all 25
original migration records after the initializer's historical precondition.
Internal Auth health returned HTTP 200, a real local Auth sign-in succeeded,
and an internal DB query succeeded. The Production-role Verification Worker
health endpoint returned HTTP 200 with `environment=production`,
`deployment_role=production`, `binding_mode=random`, Auth `supabase`, device
auth `external-endpoint`, and
`security_identity.trust_contract_valid=true`.

The Runtime Config service was reached as
`https://runtime-config.fusou.test`. The Manifest returned HTTP 200 (5,739
bytes; SHA-256 base64url
`AHCUazz7Xd7j6C1PT7xJIJ40MCwa45651jb0RLX6ZGg`) and matched the saved exact
bytes. All five artifacts also returned HTTP 200 and matched their saved exact
bytes and SHA-256 base64url digests:

| Artifact | Bytes | SHA-256 base64url |
|---|---:|---|
| `worker-reference` | 6,059 | `nmuLngUvrnMTWvD763MNrDew9efWARZYqyYl49RbXS8` |
| `origin-inventory` | 1,876 | `oPGCXkdYTkTCfif4bmujVhtHP-vOSmF1CB8R6eo-XZ0` |
| `target-approval` | 899 | `LMq3_l4PVfOv1K3rKXVekG1N7VOOxn5rQBZRr-J7z78` |
| `security-registry-set` | 408 | `_wC902u9WACSTPyER0A00g5H7359aq1ysI6p8HMQMgs` |
| `result-registry-envelope` | 673 | `2V_ojvyLaneNveeS_HBqzwPKbhEzZSCMRvKdyGXxt4` |

The existing verifier returned `MANIFEST_AND_SIGNED_PINS_VERIFIED`. The
Freshness POST returned HTTP 200; its signature and Manifest binding passed
verification, with latest epoch `2`. A local Node HTTPS edge validated the
test CA and hostname/SAN, and validated its HTTPS upstream to the local
Runtime Config service. TLS terminated at that adapter, not in workerd; the
adapter invoked the actual local Gateway Worker and did not provide a fixed
response.

Gateway typecheck passed and its runtime suite reported 12 PASS, 0 FAIL, 0
SKIP. Coordinator typecheck passed and its runtime suite reported 73 PASS, 0
FAIL, 0 SKIP.

### Boundaries and evidence status

An earlier local integration run in this work sequence observed
`POST /attestation/session` returning 201, WEB possession proof returning 200,
and proof replay returning 409. The actual Binding Authority DO binding was
used, but its stored record was not independently read in that run. The
pre-cleanup DB count snapshot for this follow-up showed one Auth user, zero
`user_devices`, one nonce-consumption row, zero TLSN proof-consumption rows,
and six rate-limit rows. Therefore those earlier API results are **OBSERVED**
history, not proof of durable device/proof rows in this follow-up DB; this
service check does not claim independent DO-state verification.

| Check | Status |
|---|---|
| Internal-only Docker topology and scoped initializer relay | **VERIFIED** |
| 25 migration records, local Auth health/sign-in, and DB query | **VERIFIED** |
| Production-role Worker health and trust contract | **VERIFIED** |
| Runtime Config Manifest, all five exact artifacts, and Freshness verification | **VERIFIED** |
| Session/proof API outcomes from the earlier local integration | **OBSERVED**; final DB snapshot did not corroborate proof-consumption persistence |
| APP build/GUI/Start and `get_tlsn_capture_readiness` | **NOT_CHECKED** in this service-only run; prior APP-start gate remains **BLOCKED** |
| Notary, Presentation, `/verify/tlsn`, Result, and game-server traffic | **NOT_CHECKED**; none was attempted |
| Hosted CI | **NOT_CHECKED** |
| Stage A/B/C and Production acceptance | **BLOCKED** |

No ordinary external network, regular bridge, host firewall rule, Cloudflare
service, real Supabase, game server, APP, Notary, Presentation, or
`/verify/tlsn` path was used. The task-owned containers, DB volume, network,
temporary credentials, CA/private keys, Miniflare state, and temporary
harnesses were removed. Root-owned runtime files were removed by a one-shot
cleanup container with networking disabled and only the task temp directory
mounted; no host permissions were changed. The task directory, Docker
containers/volume/network, and relay listeners were confirmed absent after
cleanup. The older `fusou-tlsn-testplay-supabase-yBcw5F` network and other
existing services were left untouched.

This follow-up verifies local service connectivity only. It does not advance
APP readiness, Hosted CI, Stage A/B/C, or Production acceptance.

## Explicit Verification Worker Queue execution — local implementation

**IMPLEMENTED; PARTIALLY VERIFIED LOCALLY:** On branch
`tlsn-first-testplay-candidate` at HEAD
`0dd7a8e92d3ad90b7fc6a9865741c9273266534c`, the Worker now selects Queue
execution only when Production environment and Production deployment role
explicitly set `TLSN_PRODUCTION_EXECUTION_MODE=queue`. An unset Production
mode continues to select Trigger; unknown values fail closed. Canary and
test-role mode selection remain separate. Queue mode with no
`TLSN_VERIFICATION_QUEUE` returns 503 before authentication, proof consumption,
or job creation. The health response reports the selected mode and Queue
binding availability.

The existing `/verify/tlsn` authentication, device proof, Session, binding,
and exact Presentation-to-R2/DO registration path is retained before sending
the schema-validated Queue message. The `queue()` consumer checks the current
Production role and trust digests, then compares the message's job, Session,
binding, owner, device, challenge, Presentation, input/output keys, and profile
against the Binding Authority record. It uses the existing completion path,
which reads the stored Presentation, performs WASM verification, signs and
persists the Result, reads the archive back, and commits the DO state. Queue
mode does not expose Trigger completion/input callbacks. A send exception is
treated as an unconfirmed outcome: the same job ID is returned with HTTP 503
`queue_enqueue_unconfirmed`; the DO is not failed, no replacement job is
created, and there is no Trigger/direct fallback.

At-least-once handling uses the existing DO lease and terminal state. A
consumed job is acknowledged only after authoritative Result readback; failed
or expired jobs are acknowledged; uncertain storage/authority outcomes retry.
An active `verifying` lease is not changed to failure by a duplicate: a first
delivery that observes another active execution is acknowledged, while a
redelivery (`attempts > 1`) waits for the lease. Focused policy tests cover
those dispositions and trust/DO mismatches. Local concurrent Queue delivery
was not exercised.

Queue producer/consumer wiring exists only in
`packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/scripts/local-worker-queue-test.mjs`,
which starts Miniflare Queue, R2, and the actual Worker entrypoint with
loopback-only outbound service access. The default Wrangler configuration and
current deployment contract were not changed; Production deployment still
requires Trigger. Any future switch must first drain existing Trigger jobs to
terminal states, then explicitly change the execution mode under a separately
approved deployment-contract change.

**CHECKS:** Verification Worker typecheck passed. The focused mode, Queue
policy, and Production Result contract suite passed **12/12**, with 0 failures
and 0 skips. Current-source WASM provenance passed for the exact HEAD using
the retained pinned Rust `1.98.1`, wasm-pack `0.15.1`, wasm-bindgen `0.2.128`,
and Binaryen `133` toolchain. `node --check` passed for both local Queue
scripts and both preserved local Trigger scripts. A disposable Miniflare
startup smoke returned Worker health HTTP 200 with `execution_mode=queue`;
it did not submit a Queue message or create a test job. The smoke was stopped
with its scheduled SIGINT; its process, listeners, and temporary directory
were confirmed absent.

| Queue verification | Status |
|---|---|
| Production default-to-Trigger, explicit Queue selection, and unknown-mode rejection | **VERIFIED** by focused tests |
| Runtime trust digest, role, DO identity, and lease disposition policies | **VERIFIED** by focused tests |
| Local Queue Worker/Miniflare startup and health reporting | **OBSERVED**; empty-config smoke only |
| Full test-role Auth → fresh Session → Complete Presentation → Queue → WASM → signed Result/R2/DO roundtrip | **NOT_CHECKED**; the earlier Trigger test does not establish Queue execution |
| Existing local Trigger end-to-end harness rerun | **NOT_CHECKED**; only its scripts' syntax and Trigger default selection were checked |
| Production Queue message delivery, binding/digest/job rejection, external callback rejection, and local-CA Presentation rejection | **NOT_CHECKED** |
| Actual duplicate/concurrent Queue delivery and same-job Result idempotency | **NOT_CHECKED**; only disposition policy tests ran |

## Local Queue runtime follow-up — 2026-11-24

**VERIFIED (local test role only):** The existing dirty/untracked worktree was
preserved on `tlsn-first-testplay-candidate` at HEAD
`0dd7a8e92d3ad90b7fc6a9865741c9273266534c`. The already initialized
internal-isolated Supabase and dedicated WEB were reused. The Queue runtime
used the actual Worker entrypoint, Miniflare Queue, R2, and
`TlsnBindingAuthorityDurableObject`; its outbound service wrapper allowed only
the configured loopback Supabase/Auth origins.

The normal release Notary binary used by the existing Rust fixture was
`notary-normal-target/release/fusou-notary`, SHA-256
`0d8ba4894bcec0d9f6980919b131f4f7ffd601d9e18f21a86eb50ffc6958f694`.
`operational::worker_session_grant_produces_independently_verified_complete_presentation`
passed **1/1** for each fresh Session used below. One initial fixture invocation
hit an existing output filename (`create_new`); it did not overwrite that
file. The fixture was rerun with a fresh Auth user/device/Session and unique
output paths and passed.

### Queue success, rejection, and uncertain send

For Session `97839b47-98af-4636-86d4-8b9170bc4a52`, job
`42dcf315-3b46-4b2f-b621-47665a9d5a23` returned HTTP 202 and status HTTP 200
with `verified=true`. The DO reached `consumed`; exact status Result bytes
matched R2, the independent inner signature and consume receipt checks passed,
and the Result's Presentation digest matched the fresh Complete Presentation.
Presentation SHA-256 (base64url) was
`oNlJhJ7kU-fPCfDtjtLiPlTNjjVR9Iz1ON2xTuT7DWU`; Result SHA-256 (base64url)
was `jYCFllm0GXjkro0HpLtqrVkSpbTMWFHm08OnD7LNpJM`. The Presentation input
was removed after commit, one attempt Result archive remained, and the Queue
backlog drained to zero.

While that job held an unexpired `verifying` DO lease, the harness invoked the
same real `queue()` handler through its local dispatcher and delivered
Production-shaped role/trust data, an invalid origin-policy message, and
job-ID, Session-ID, Presentation-digest, input-key, and binding-ID mismatches.
Each was acknowledged without changing the valid job's lease; the original
job subsequently reached `consumed`. A same-job duplicate was published while
the lease was active and after commit (both publish responses HTTP 202); the
consumer acknowledged replays and the Result bytes, object key, and R2 object
set remained unchanged. Miniflare's configured `maxBatchSize` is one, so this
is a controlled concurrent invocation of the actual consumer while the first
invocation held the lease, not evidence about Cloudflare Queue scheduling.
The messages were delivered to a **test-role** Worker; these results do not
establish Production runtime trust rejection.

The corruption case used a separate fresh user/device/Session and reached the
consumer: request HTTP 202, terminal status HTTP 200 with `verified=false`,
DO `failed`, Presentation input retained, and no signed Result archive.

The previously requested Trigger regression also passed with a fresh
Session/Presentation: HTTP 202 submission, HTTP 200 completion callback, and
HTTP 200 `verified=true` status. The Result was 2,645 bytes with SHA-256
(base64url) `ZXeYv5KRgS-C3QHwJRadU1rAbFNco_0lktmWihr06OI`; independent inner
signature, receipt, exact status/R2 bytes, and bindings were checked. Duplicate
submission returned HTTP 409, completion replay was idempotent, and the
committed Result did not change.

For the queue-send-unknown regression, a test-only
`TLSN_TEST_QUEUE_SEND_ACK_LOST_AFTER_ACCEPTANCE` switch was added. It is
effective only when `TLSN_ENVIRONMENT=test` and throws after the real local
Queue producer accepts the message; it does not alter Production behavior or
simulate a Cloudflare transport failure. With a distinct fresh Session,
`/verify/tlsn` returned HTTP 503 `queue_enqueue_unconfirmed` and job
`f5df611e-c6a2-4713-95a4-c12aa030aac6`. Replaying the same device proof
returned HTTP 409 `device_possession_replayed` and no new job ID. The local
Trigger executor state was unchanged. The accepted Queue message for the
returned ID was consumed and status reached HTTP 200 `verified=true`; DO was
`consumed`, exact Result/R2 bytes and signatures were checked, and duplicate
delivery remained idempotent. Presentation SHA-256 (base64url) was
`f_UOA_xQNzIdnyH4B9DUGlw25VZ3sgBRPcW6j5ZdDek`; Result SHA-256 (base64url)
was `hHOjqhWRx4mfUHhdOoxhIbhS8Gw9IpK5fNXHYLypVWo`.

### Production-mode boundary and remaining gaps

A separate local Wrangler Worker was started with
`TLSN_ENVIRONMENT=production`, `TLSN_DEPLOYMENT_ROLE=production`, and
`TLSN_PRODUCTION_EXECUTION_MODE=queue`, but deliberately had no Queue binding
or Production trust configuration. Health returned HTTP 503 while reporting
`execution_mode=queue` and `execution_binding_configured=false`.
Unauthenticated `POST /verify/tlsn` returned HTTP 503
`queue_unconfigured` before authentication/proof handling. A POST to
`/internal/tlsn/verification-complete` returned HTTP 404 `not_found`.
These verify local mode selection, missing-binding refusal, and callback
gating only; they do not prove a Production consumer run.

| Boundary | Status |
|---|---|
| Test-role Queue valid Result, R2/DO/signature checks, duplicate delivery | **VERIFIED** |
| Test-role corruption reaches WASM/terminal failure without a Result | **VERIFIED** |
| Accepted-then-unconfirmed Queue send returns the same job ID without Trigger fallback | **VERIFIED** with the test-only fault switch |
| Production mode with missing Queue binding and external Trigger callback refusal | **VERIFIED** locally; other Production configuration intentionally absent |
| Production Queue consumer role/origin/trust-digest/DO mismatch behavior | **NOT_CHECKED** in a Production runtime; test-role consumer/policy tests are not a substitute |
| Production rejection of the local-CA Presentation | **NOT_CHECKED**; no complete Production Queue/trust fixture was started |
| Hosted CI, formal execution receipt, and APP Result acceptance | **NOT_CHECKED** |
| Stage A/B/C and Production acceptance | **BLOCKED** |

**CHECKS:** Worker typecheck passed. The execution-mode, Queue-policy, and
Production Result contract tests passed **12/12**, with 0 failures and 0
skips. Current-source WASM provenance reported
`VERIFIED_LOCAL_CONSISTENCY` and source commit binding
`0dd7a8e92d3ad90b7fc6a9865741c9273266534c`. `node --check` passed for both
local Queue harnesses.

**ISOLATION AND CLEANUP:** Docker inspection confirmed the task network
`fusou-tlsn-testplay-supabase-c4KQZY` had `Internal=true` and
`bridge.gateway_mode_ipv4=isolated`; its containers were attached only to that
network. Inspection also showed Docker port bindings for DB `33493` and Kong
`43723` while the stack was running, so this run does not claim that Docker
created no host port mappings. The task's five Supabase/relay containers, its
DB volume, and its network were stopped and removed; the older
`fusou-tlsn-testplay-supabase-yBcw5F` network was left untouched. WEB, Queue,
and local Production Worker processes were stopped. Local checks confirmed
ports `19002`, `19003`, `8787`, `8788`, `8789`, `33493`, and `43723` closed,
and the private run directory containing temporary credentials, keys, CA,
R2/DO state, and artifacts was removed. No Cloudflare, Trigger.dev, game
server, `fusou.dev`, APP build, stage, commit, push, or Actions run occurred.

**REPEATABLE LOCAL COMMANDS:** Start the test-role harness with a private
`RUN_DIR` containing the existing local configuration. For the uncertain-send
case, set the test-only switch on the harness process:

```sh
FUSOU_LOCAL_TEST_RUN_DIR="$RUN_DIR" \
  node --experimental-transform-types \
  packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/scripts/local-worker-queue-test.mjs serve

# Or, for the deterministic accepted-then-unconfirmed case:
FUSOU_LOCAL_TEST_RUN_DIR="$RUN_DIR" \
FUSOU_LOCAL_QUEUE_SEND_ACK_LOST_AFTER_ACCEPTANCE=true \
  node --experimental-transform-types \
  packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/scripts/local-worker-queue-test.mjs serve

FUSOU_LOCAL_TEST_RUN_DIR="$RUN_DIR" node --experimental-transform-types \
  packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/local-trigger-test-client.mjs prepare-user
FUSOU_LOCAL_TEST_RUN_DIR="$RUN_DIR" node --experimental-transform-types \
  packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/local-trigger-test-client.mjs issue-session
# Run the normal-Notary Rust fixture above with FUSOU_TEST_* inputs/outputs from the private run.
FUSOU_LOCAL_TEST_RUN_DIR="$RUN_DIR" \
FUSOU_LOCAL_SESSION_FILE="$RUN_DIR/sessions/$SESSION_ID.json" \
FUSOU_LOCAL_PRESENTATION_FILE="$RUN_DIR/presentation-$SESSION_ID.bin" \
  node --experimental-transform-types \
  packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/local-queue-test-client.mjs uncertain
```
| Cloudflare Queue/Worker deployment, formal execution receipt, accepted Evidence, APP Result receipt, Hosted CI | **NOT_CHECKED** |
| Production acceptance | **BLOCKED** |

The prior local Supabase/WEB/Trigger services and their task credentials were
already cleaned up, and no fresh Auth Session or Presentation was created for
this Queue run. No Cloudflare Queue, Trigger.dev, real Supabase, APP, Notary,
game server, or external endpoint was contacted. No Queue deployment settings
were enabled, and no files were staged, committed, or pushed. These local
implementation checks do not advance Stage A/B/C or Production acceptance.

## Local Production Queue rejection verification

**SCOPE:** This run verifies only the local Production-role Queue trust and
consumer boundaries. The checkout remained at `tlsn-first-testplay-candidate`,
HEAD `0dd7a8e92d3ad90b7fc6a9865741c9273266534c`; existing worktree changes
were preserved. No Worker production source, tracked Inventory/Approval, or
deployment configuration was changed for this test. The local-only
`local-production-queue-test.mjs` synchronization harness was corrected to
bridge its test barrier through the same loopback Node admin server, avoiding
cross-request Promise state in Workerd.

**ISOLATION:** The task-owned Supabase stack reports 25 migrations. Its Docker
network had `Internal=true` and `bridge.gateway_mode_ipv4=isolated`. DB and
Kong retained random port values in Docker `HostConfig.PortBindings`, but
their runtime `NetworkSettings.Ports` entries were `null`; `docker ps` showed
only container ports, not host-published ports. The task relay had no port
bindings. Local Auth/WEB/Worker traffic used the task-owned relays; no
Cloudflare, Trigger.dev, real Supabase, `fusou.dev`, or game endpoint was
contacted.

**PRODUCTION HEALTH:** `/health` returned HTTP 200 with
`execution_mode=queue`, `execution_binding_configured=true`, and
`trust_contract_valid=true`. The runtime values matched the local trust
summary:

| Trust input | SHA-256 (base64url) |
| --- | --- |
| Origin Inventory | `GxuuiqFckRvMhKRR5ersCTutAYG9VlgUtQDwZDu1jV8` |
| Target Approval artifact | `dX-LGwyMweYVozcyz3i6Yo0_RxyZZpaf-5XtgBFlMaY` |
| Security Registry Set | `KAmWECZnA_8BBDR7PYp0SLmMNS75vQPwgg-_afsYUgc` |

`TLSN_TRUST_ROOT_CERTIFICATE_DER` was absent (`production_trust_root_bound=false`).
The external `/internal/tlsn/verification-complete` callback returned HTTP 404
`not_found`.

**FRESH FIXTURE:** A new non-anonymous Supabase user and Ed25519 device were
registered, signed in, and used for Session
`06c42836-d97a-49e1-8735-6e29a8fa03df`. The normal release Notary was rebuilt
from the current proxy worktree with
`cargo build --locked --release --features operational-notary --bin fusou-notary`;
the binary had no fault-injection feature. Its SHA-256 was
`DYukiUvOwNn2mAkZsTH09__WAdnhjyGobrUP_GlY9pQ` (hex
`0d8ba4894bcec0d9f6980919b131f4f7ffd601d9e18f21a86eb50ffc6958f694`).
The existing Rust fixture
`operational::worker_session_grant_produces_independently_verified_complete_presentation`
passed 1/1 (13 filtered). It produced a 3,481-byte Complete Presentation for
`capture.fusou.internal`; independent verification with the local test CA
passed. The exact Presentation SHA-256 (base64url) was
`_-6WLUu6PoCdM3Tu-uOx4irw6ooexQx4uot8joHn7aw`.

**QUEUE MISMATCHES:** The authenticated `/verify/tlsn` request returned HTTP
202 and queued job `fc1b0cf9-d63e-4e17-8a43-1264f34178aa`. Thirteen
role/origin-policy/trust-digest/DO-binding mismatch variants were passed
through the actual Worker `queue()` handler while the valid job was
`processing`; each was acknowledged and the DO/R2 snapshot was unchanged.
While the valid job held an unexpired `verifying` lease, a separate job-ID
mismatch was also acknowledged without changing the lease, Result fields, or
R2 object set. The test-only barrier was released immediately after that
comparison.

The unmodified Queue message then reached the actual Queue consumer once.
The authenticated status endpoint returned HTTP 200,
`verified=false`, `status=not_verified`, and
`verification_failure_code=verifier_failed`. Secret-free Worker instrumentation
identified `failure_stage=wasm_verification`; no Result digest, consume
receipt, or success archive was created. The DO ended `failed`, and R2
contained only the original `presentation.bin` object (3,481 bytes, the exact
Presentation digest above); Queue backlog was zero. The harness event log
contained one actual Queue delivery and 13 controlled handler entries. The
test command reported all 13 processing mismatches and the active-lease
mismatch individually as acknowledged/unchanged. The stage was
`wasm_verification`; the surfaced error type was `unknown`, so a more specific
internal WASM failure subcode remains **UNKNOWN**.

Two earlier attempts did not reach WASM: the first used a Workerd
cross-request Promise barrier and the second kept barrier state in a host
closure that was not shared with the admin poller. Both were abandoned without
claiming a Production verification result or reusing their Session/job for
the successful run. A post-restart Session request using the previous device
was also rejected with `409 device_nonce_replayed`; a new user/device and
fresh Session were used for the successful run.

**CHECKS:** Worker typecheck passed. Execution-mode, Queue-policy, and
Production Result contract tests passed **12/12**, with 0 failures and 0
skips. The local-CA Rust Presentation fixture passed 1/1. Current-source WASM
provenance passed with source commit binding `VERIFIED` for
`0dd7a8e92d3ad90b7fc6a9865741c9273266534c`; the pinned tools were
`wasm-pack 0.15.1`, `wasm-bindgen 0.2.128`, `wasm-opt 133`, Rust 1.98.1, and
Clang 18.1.3. The existing WASM artifact was provenance-verified, not rebuilt.
The local Production Queue harness passed `node --check`.

**REPEATABLE COMMANDS:** After creating a task-owned run with
`pnpm --dir packages/FUSOU-WEB run init:tlsn-testplay-supabase --internal-isolated`
and applying the existing local Production trust fixture, use:

```sh
FUSOU_LOCAL_TEST_RUN_DIR="$RUN_DIR" \
  node packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/scripts/local-production-queue-test.mjs serve

FUSOU_LOCAL_TEST_RUN_DIR="$RUN_DIR" \
  node packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/scripts/local-production-queue-test.mjs health
FUSOU_LOCAL_TEST_RUN_DIR="$RUN_DIR" \
  node packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/scripts/local-production-queue-test.mjs build-notary
FUSOU_LOCAL_TEST_RUN_DIR="$RUN_DIR" \
  node packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/scripts/local-production-queue-test.mjs callback-probe
FUSOU_LOCAL_TEST_RUN_DIR="$RUN_DIR" \
  node packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/local-trigger-test-client.mjs prepare-user
FUSOU_LOCAL_TEST_RUN_DIR="$RUN_DIR" \
  node packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/local-trigger-test-client.mjs issue-session
FUSOU_LOCAL_TEST_RUN_DIR="$RUN_DIR" \
  node packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/scripts/local-production-queue-test.mjs prepare-fixture
FUSOU_LOCAL_TEST_RUN_DIR="$RUN_DIR" \
  node packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/scripts/local-production-queue-test.mjs submit "$SESSION_ID"
JOB_ID="$(node -e 'const fs=require("node:fs"); process.stdout.write(JSON.parse(fs.readFileSync(process.argv.at(-1), "utf8")).job_id)' "$RUN_DIR/production-queue-job.json")"
FUSOU_LOCAL_TEST_RUN_DIR="$RUN_DIR" \
  node packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/scripts/local-production-queue-test.mjs mismatches "$JOB_ID" processing
FUSOU_LOCAL_TEST_RUN_DIR="$RUN_DIR" \
  node packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/scripts/local-production-queue-test.mjs mismatches "$JOB_ID" lease
FUSOU_LOCAL_TEST_RUN_DIR="$RUN_DIR" \
  node packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/scripts/local-production-queue-test.mjs status "$JOB_ID"
FUSOU_LOCAL_TEST_RUN_DIR="$RUN_DIR" \
  node packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/scripts/local-production-queue-test.mjs verify-logs "$JOB_ID"
```

**STATUS:** Local Production Queue mismatch rejection and local-CA
Presentation rejection through the WASM stage are **VERIFIED**. Hosted CI,
APP Result receipt, accepted Evidence, and formal execution receipt are
**NOT_CHECKED**.
Stage A/B/C and Production acceptance remain **BLOCKED**.

**CLEANUP:** After recording the measurements, the task-owned Supabase
containers and data volumes were stopped/deleted; the relay container and
internal network were removed. The WEB, Worker, and local relays stopped;
ports `8787`, `8788`, `9443`, `19004`, and the temporary DB/Kong ports were
confirmed closed. The private run directory, including credentials, CA,
keys, R2/DO state, logs, binaries, and temporary WASM toolchains, was removed.

## Production-default certificate-path rejection comparison — 2026-11-24

The earlier run's `UNKNOWN` WASM exception classification at the top of this
section is retained as its historical observation. This fresh run establishes
the failing call and fixed diagnostic for the new Presentation; it does not
identify a more specific cause such as an untrusted root versus certificate
expiry.

**SOURCE AND ISOLATION:** Branch `tlsn-first-testplay-candidate`, HEAD
`0dd7a8e92d3ad90b7fc6a9865741c9273266534c`. The disposable Supabase stack used
`--internal-isolated`; its Docker network was internal and the API/DB access
used only the initializer's loopback relay. No Production trust root was bound
to the Worker. No cloud Worker, Trigger.dev, game server, or external trigger
was contacted.

Production `/health` returned HTTP 200 with `execution_mode=queue`,
`execution_binding_configured=true`, and
`security_identity.trust_contract_valid=true`. The configured digests matched:

| Trust input | SHA-256 (base64url) |
| --- | --- |
| Origin Inventory | `GxuuiqFckRvMhKRR5ersCTutAYG9VlgUtQDwZDu1jV8` |
| Target Approval | `8iCUocKj0N_Q0xmHQq5_c938SfxigslnCX9pyyY-1c8` |
| Security Registry Set | `oK4HRxhQKLoaXuQe5SMDiuBKipk9VwTpP7B4gQMG0jc` |

The fixture used the normal `operational-notary` release binary, built from
the local `packages/FUSOU-PROXY/proxy-https` source; its SHA-256 (base64url)
was `DYukiUvOwNn2mAkZsTH09__WAdnhjyGobrUP_GlY9pQ`. The pinned Notary public
key SHA-256 was
`IMpo0iAm2eXVs8XXtO13f9WG9Vw_pvBCkz4wkpXToZ4`. A fresh non-anonymous local
Auth user and registered device received a new Worker Session (HTTP 201); the
Session receipt signature was verified.

The existing Rust test
`operational::worker_session_grant_produces_independently_verified_complete_presentation`
passed 1/1 and generated a Complete Presentation for
`capture.fusou.internal` from that Session. The exact Presentation was 3,481
bytes with SHA-256 (base64url)
`lpRvt3pRyfGJndj3AHEpqXS6EoPa2RUvH42NK79MyxA`.

**SAME-BYTE COMPARISON:**

| Verification path | Result |
| --- | --- |
| Independent Rust verification with the fixture CA and pinned Notary key | `PASS` |
| Current-source Worker WASM `inspect_alpha15_server_identity`, default trust store, no custom root | `REJECTED`; `exception_kind=wasm_string`; `diagnostic_code=certificate_path_invalid` |
| Presentation digest before/after direct WASM inspection | Identical: `lpRvt3pRyfGJndj3AHEpqXS6EoPa2RUvH42NK79MyxA` |

The fixed diagnostic was `failed to verify certificate path to provided
trust anchors`, corresponding to `ServerCertVerifierError::InvalidPath`.
The observed evidence establishes certificate-path rejection, not the
particular path-validation subcause.

**ACTUAL QUEUE RESULT:** One authenticated `POST /verify/tlsn` submitted those
exact bytes and returned HTTP 202 (`status=queued`). The real Queue consumer
received one actual Queue delivery. Fourteen controlled mismatch deliveries
(13 while the legitimate DO job was `processing`, one while its verification
lease was active) were acknowledged without changing the legitimate DO/R2
state. The held active lease was observed as `verifying` and preserved until
the barrier was released.

The real job then failed at `wasm_verification`. Sanitized Worker observations
identified the failing call as `inspect_alpha15_server_identity`, with
`wasm_string` and `certificate_path_invalid`. Authenticated status returned
HTTP 200 with `verified=false` and `status=not_verified`; the DO was `failed`
with `verification_failure_code=verifier_failed`. The result digest was null,
and no consume receipt or success archive was created. R2 contained only
`tlsn-verification/<job>/presentation.bin` (3,481 bytes) with the exact
Presentation digest above.

The first `verify-logs` attempt exposed that the pre-existing `serve` command
did not persist Worker stdout. The live stdout contained the actual Queue,
mismatch, and sanitized WASM events; an allowlisted, private event transcript
made from those observed records passed `verify-logs` with 1 actual delivery,
14 controlled deliveries, and the expected diagnostic. The local harness now
persists only allowlisted event fields and fixed diagnostic codes; it rejects
unknown event shapes and never writes raw error text, certificate data,
Presentation bytes, keys, proofs, or tokens to that log.

**VALIDATION:** Classification regression cases passed 5/5; Verification
Worker typecheck passed. Execution-mode tests passed 4/4, Queue-policy tests
passed 4/4, and Production Result contract tests passed 4/4. Current-source
WASM build/provenance had already passed earlier in this run with source
binding `VERIFIED` and the pinned toolchain (Rust 1.98.1, wasm-pack 0.15.1,
wasm-bindgen 0.2.128, wasm-opt 133, Clang 18.1.3). A later provenance
re-invocation was blocked because the ambient `PATH` did not contain
`wasm-bindgen`; no WASM source input or artifact changed after the successful
provenance check. The generated WASM SHA-256 (base64url) was
`RN0aIqOOlpQINFgJmNHsI7Ma0yxEbc8_erbfvMtSHnE`.

**REPEATABLE COMMANDS:** After the existing `--internal-isolated` setup,
temporary trust fixture configuration, and dedicated WEB/Worker startup, run:

```sh
FUSOU_LOCAL_TEST_RUN_DIR="$RUN_DIR" node packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/scripts/local-production-queue-test.mjs health
FUSOU_LOCAL_TEST_RUN_DIR="$RUN_DIR" node packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/local-trigger-test-client.mjs prepare-user
FUSOU_LOCAL_TEST_RUN_DIR="$RUN_DIR" node packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/local-trigger-test-client.mjs issue-session
FUSOU_LOCAL_TEST_RUN_DIR="$RUN_DIR" node packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/scripts/local-production-queue-test.mjs prepare-fixture
FUSOU_LOCAL_TEST_RUN_DIR="$RUN_DIR" node packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/scripts/local-production-queue-test.mjs inspect-wasm
FUSOU_LOCAL_TEST_RUN_DIR="$RUN_DIR" node packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/scripts/local-production-queue-test.mjs submit "$SESSION_ID"
JOB_ID="$(node -e 'const fs=require("node:fs"); process.stdout.write(JSON.parse(fs.readFileSync(process.argv.at(-1), "utf8")).job_id)' "$RUN_DIR/production-queue-job.json")"
FUSOU_LOCAL_TEST_RUN_DIR="$RUN_DIR" node packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/scripts/local-production-queue-test.mjs mismatches "$JOB_ID" processing
FUSOU_LOCAL_TEST_RUN_DIR="$RUN_DIR" node packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/scripts/local-production-queue-test.mjs mismatches "$JOB_ID" lease
FUSOU_LOCAL_TEST_RUN_DIR="$RUN_DIR" node packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/scripts/local-production-queue-test.mjs status "$JOB_ID"
FUSOU_LOCAL_TEST_RUN_DIR="$RUN_DIR" node packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/scripts/local-production-queue-test.mjs verify-logs "$JOB_ID"
```

**STATUS:** This fresh local Production-role certificate-path rejection is
**VERIFIED**. The earlier run's `UNKNOWN` remains accurate for that earlier
observation. Hosted CI, APP Result receipt, accepted Evidence, and formal
execution receipt are **NOT_CHECKED**. Stage A/B/C and Production acceptance
remain **BLOCKED**.

**CLEANUP:** The WEB, Worker, and relay processes stopped; loopback ports
`8787`, `8788`, `9443`, `19004`, `33925`, and `34213` were confirmed closed.
The task-owned Supabase containers and database volume were stopped/removed,
and only the verified task-owned relay container and internal network were
removed. The private run directory and generated WASM outputs are removed
after the recorded measurements.

## Remote Worker Queue-enqueue Uncertainty Recovery

**SCOPE:** Local Rust integration tests against a loopback HTTP Worker fixture.
No APP binary, live Worker, origin, cloud service, or game server was used.
The source state was branch `tlsn-first-testplay-candidate` at
`0dd7a8e92d3ad90b7fc6a9865741c9273266534c`; pre-existing worktree changes and
untracked harnesses were preserved.

**IMPLEMENTATION:** `RemoteWorkerVerificationBackend` now polls the existing
status endpoint only when the initial response is HTTP 503 with
`verified=false`, the exact error `queue_enqueue_unconfirmed`, and a Worker
UUID v4 job ID. It uses the existing status request and Result acceptance
path. It does not resend `/verify/tlsn`, the Presentation, or device proof.
The existing HTTP 202 payload contract, synchronous success path, generic
503 mapping, Trigger error mapping, poll deadline, and cancellation behavior
remain unchanged.

**OBSERVED:** The recovery fixture returned `503 queue_enqueue_unconfirmed`,
then `202 processing`, then `200 verified=true` for the same job. The initial
POST count was 1 and status query count was 2. Both status requests carried
the same job ID, Session ID, binding digest, canonical user ID, and device ID;
they did not contain Presentation bytes or device proof. The test verifies
the initial device proof and accepts the signed Complete Result through the
existing signature, Presentation, transcript, Session, binding, target, and
device checks. The Result fixture pins both Production authority digests.
The registered exact Worker response bytes matched `result-exact.bin`
byte-for-byte. The candidate manifest remained
`INCOMPLETE_MISSING_EXECUTION_RECEIPT`; no formal execution receipt was
present or claimed. The archive fixture's `consume_receipt` value exists only
to exercise the existing candidate writer and is not asserted as a valid
receipt.

**REJECTIONS AND COMPATIBILITY:** `queue_unconfigured`, Trigger errors,
generic 503 responses, malformed/non-v4 job IDs, and a response with
`verified=true` did not start status polling. An initial POST timeout made
one POST and no status query. A changed job ID in an interim 202, terminal
`verified=false`, invalid inner signature, and Session binding mismatch
registered no Result. A status-poll timeout did not create a new job, resend
the capture, or fall back to Trigger. Existing ordinary 202-to-status and
synchronous 200 success paths both passed.

**VALIDATION:** The five new exact test selectors passed 5/5. The complete
`result_binding_tests` module passed 12/12, including both independent
Production digest pins, and the five existing capture/cancellation cleanup
selectors passed 5/5. Rust formatting and edited-file whitespace checks
passed. The workflow parsed as YAML, and all five new exact names were found
by Cargo's test listing. Compilation emitted the existing unused
`from_verified_alpha15_partial` warning in the verifier crate.

**REPEATABLE COMMANDS:** From the repository root, using Rust 1.98.1 and a
temporary `CARGO_TARGET_DIR` (choose a fresh path for a clean rebuild):

```sh
manifest=packages/FUSOU-PROXY/proxy-https/Cargo.toml
run_exact_test() {
  CARGO_TARGET_DIR=/tmp/fusou-proxy-queue-recovery-target \
  CARGO_NET_OFFLINE=true \
    cargo +1.98.1 test --locked --offline --lib --features synthetic-tlsn \
      --manifest-path "$manifest" "$1" -- --exact
}
run_exact_test real_tlsn::tests::queue_enqueue_unconfirmed_requires_exact_error_and_worker_uuid_v4
run_exact_test real_tlsn::tests::result_binding_tests::remote_backend_recovers_unconfirmed_queue_result_once_and_preserves_exact_candidate_bytes
run_exact_test real_tlsn::tests::result_binding_tests::remote_backend_preserves_accepted_202_and_synchronous_success
run_exact_test real_tlsn::tests::result_binding_tests::remote_backend_does_not_poll_other_503_responses_or_retry_initial_timeouts
run_exact_test real_tlsn::tests::result_binding_tests::remote_backend_rejects_mismatched_jobs_unverified_results_and_invalid_signatures_or_bindings
```

The five selectors are added to the existing Proxy test step in
`tlsn-testplay-candidate.yml`.

**STATUS:** This proves local Proxy recovery behavior only. APP Result
receipt, Hosted CI, formal execution receipt, and accepted Evidence are
**NOT_CHECKED**. Stage A/B/C and Production acceptance remain **BLOCKED**.

## Linux APP Queue-enqueue Recovery Attempt

**SCOPE AND OUTCOME:** One run used a task-only source snapshot and disposable
Linux GUI, D-Bus, HOME, local Runtime Config/Freshness, Supabase Auth/WEB, and
dummy HTTPS origin. No successful contact with a game server, public service,
Cloudflare, or Trigger.dev was observed. Isolated WEB startup emitted
`EAI_AGAIN workers.cloudflare.com` while Wrangler attempted to fetch the
`Request.cf` object, then fell back to its default placeholder. The APP was
built with Rust 1.98.1 and the
`tlsn-production` and `custom-protocol` features. Source snapshot SHA-256:
`ff4d701282f14ed1518e4583bf13714c9ba48d55c765d40dbb96becb50318e43`.
APP binary SHA-256:
`3b0e0b1ecc29e6b00c751b3d69ad000eef0416224689110771d87a93a09321ae`;
size: 91,726,904 bytes. The source state was
`tlsn-first-testplay-candidate` at
`0dd7a8e92d3ad90b7fc6a9865741c9273266534c`; existing worktree changes were
preserved.

**OBSERVED:** The APP was started with Run Proxy Server enabled and Open
KanColle disabled. A readiness snapshot showed `Overall: ready`, and a fresh
Worker Session issuance returned HTTP 201 at `2026-11-24T07:21:35.215Z`.
That snapshot did not establish capture-time freshness. At the single capture
attempt (`2026-11-24T07:25:34Z`), APP revalidation failed with
`Worker reference is not fresh`. The APP logged that the TLSN origin request
was not sent and ordinary proxy fallback was used. The dummy origin observed
exactly one empty-body `POST /kcsapi/api_get_member/require_info`, returned
HTTP 200 with 83 response bytes, and the APP subsequently reported that the
response omitted `api_firstflag`. This parser issue was secondary; the
capture-time Worker-reference freshness failure stopped TLSN first.

No request reached the local `/verify/tlsn` or `/verify/tlsn/status` handler:
initial POST count 0, status count 0, and Result-generation count 0. No job ID,
Complete Presentation, Presentation digest/length, final status bytes,
`result-exact.bin`, or candidate was produced. Therefore this run does not
demonstrate `503 queue_enqueue_unconfirmed` recovery or APP Result receipt and
save. There is no candidate to label
`INCOMPLETE_MISSING_EXECUTION_RECEIPT`.

**REPEAT PROCEDURE:** Use a fresh isolated task environment and fresh user,
device, and Worker Session. Refresh the Worker reference immediately before
capture and verify its freshness at the actual capture-time revalidation
boundary; do not rely on a cached readiness panel. Configure the dummy origin
to return an APP-parser-compatible response including `api_firstflag`, then
make only the single permitted proxy request. Count the origin request and
the local result-handler requests independently. Continue to require one
initial POST, same-job status polling, exact Result-byte comparison, signature
and binding checks, and the candidate's missing-receipt state only if a
candidate is actually created.

**CLEANUP AND STATUS:** The APP exited, and PAC readback in the task-only
D-Bus session was mode `none` with an empty URL; host PAC, CA, and HOME were
untouched. Task containers, database volume, and both task networks were
removed; no task listener or host port mapping remained. The operator
reported that deletion of the task directory stopped on root-owned files.
The directory and earlier temporary output were left for the operator.
This attempt's APP Result receipt and candidate save are **BLOCKED**
at capture-time Runtime Config freshness. Hosted CI, formal execution
receipt, and accepted Evidence are **NOT_CHECKED**. Stage A/B/C and Production
acceptance remain **BLOCKED**.

## Linux APP local Result-recovery re-run — HOME11

**SCOPE:** This attempt used the existing disposable Linux APP, dedicated
desktop/D-Bus, local Runtime Config/Freshness, local Auth/WEB, local Notary,
and dummy HTTPS origin only. No game, public service, Cloudflare, or
Trigger.dev connection was used. Repository state remained on
`tlsn-first-testplay-candidate` at
`0dd7a8e92d3ad90b7fc6a9865741c9273266534c`; existing worktree changes were
preserved. The previously recorded APP binary SHA-256 for this build is
`5cd7a03fe1865b22d8e6a5987d2f502a2b618f95c22a7307529c1750c85fa29e`.

**OBSERVED — RUNTIME CONFIG AND SESSION:** The local Worker health response
was HTTP 200 with Production Queue mode, configured binding, and a valid trust
contract. The signed Manifest was issued at
`2026-11-24T13:26:21.986Z`; its exact-byte SHA-256 was
`bOuIqX6XgxqxklduoTB6G7ISMHzCdG23uW7ZU1kYtgw`. The APP's persisted accepted
Manifest digest matched. Run Proxy Server was enabled and Open KanColle was
disabled. APP start was clicked at `2026-11-24T13:27:24.722Z`; the new Worker
Session returned HTTP 201 at `2026-11-24T13:27:24.920Z` and had expiry
`2026-11-24T13:57:24.903Z`. The `Overall: ready` label itself was not
observed in the running APP UI and remains **NOT_CHECKED**.

**OBSERVED — SINGLE PROXY REQUEST:** Immediately before the one actual proxy
request, origin count and local Result-handler observation count were both
zero. The capture began at `2026-11-24T13:33:54.229Z`, 452.243 seconds after
the Worker reference observation, with 147.757 seconds remaining in its
600-second window (27.757 seconds beyond the required 120-second start
margin). One HTTP/1.1 POST to
`/kcsapi/api_get_member/require_info` through the APP proxy returned HTTP 200.
The dummy origin recorded exactly one request at
`2026-11-24T13:33:56.533Z`; its 329-byte response SHA-256 was
`3c68e7c9628377b355ac6582cba90ebe544cdb01713a0ea25a74dce943220127`.
The APP origin-send journal recorded one `send_intent` and
`outcome=response_received`.

**BLOCKED — TLSN CAPTURE AND RESULT:** The local Result handler observed zero
`/verify/tlsn` and zero status requests. No `503 queue_enqueue_unconfirmed`,
job ID, Presentation, Presentation digest/length, signed Result, final status
body, `result-exact.bin`, or candidate was produced. The HOME11 task-local APP
configuration had `capture_enabled=false`, an empty `capture_output_path`,
and `proxy.tlsn.candidate_capture_enabled=true`. The first two values disable
the optional raw client-wire capture hook. The TLSN forwarder and its
candidate output use separate settings. The correlated TLSN send-journal
entry reaches `response_received`, before the background proof starts.
The exact post-response stop is **UNKNOWN**. This run did not identify a
Notary, proof, deadline, cancellation, or artifact-write failure. A Settings-page “Load slot item data” action produced no
origin request; the single proxy POST above was the only origin request, and
it was not retried. There is no candidate to label
`INCOMPLETE_MISSING_EXECUTION_RECEIPT`.

**REPEAT PROCEDURE:** Use a new isolated HOME, user, device, Session, signed
Worker reference, and Manifest. Verify the resolved `proxy.tlsn.enabled`,
`proxy.tlsn.candidate_capture_enabled`, and an absolute, writable,
task-owned `proxy.tlsn.artifact_output_path`. Keep optional raw client-wire
capture off unless that separate output is part of the test. Start with Run
Proxy Server on and Open KanColle off. Read the live readiness panel and
check reference age, Session expiry, and the accepted Manifest digest
before sending one new request. After HTTP 200, keep the APP running and
observe the latest capture state until success or a named stop. Correlate
the APP log, Notary, send journal, and Worker requests before cleanup.
See the [operator procedure](../FUSOU-TLSN-VERIFICATION-WORKER/docs/production-evidence-operator-runbook.md#observing-the-app-after-the-origin-replies).
Wrangler child-process propagation of `CLOUDFLARE_CF_FETCH_ENABLED=false`
and its DNS-attempt status were **NOT_CHECKED** for HOME11.

**STATUS:** APP Result receipt and candidate save are **BLOCKED** following
the origin response. APP `Overall: ready` text is **NOT_CHECKED**. Hosted CI, formal execution receipt, and accepted Evidence
are **NOT_CHECKED**. Stage A/B/C and Production acceptance remain
**BLOCKED**.

**CLEANUP:** Sent SIGINT to the APP and confirmed it stopped. In the
isolated D-Bus session, PAC readback after shutdown was
`org.gnome.system.proxy mode='none'` and `autoconfig-url=''`. Removed this
attempt's APP desktop, origin, services, and GC58An Supabase containers,
network, and database volume. No listener for the task's local ports
remained. The older `cn2pPT` stack and prior root-owned
`/tmp/fusou-app-result-7zBsMq` directory were left untouched. Removed only
the current user-owned `/tmp/fusou-app-result-retry-9NfTeJ` directory.

## APP post-response capture diagnostics — 2026-11-25

The read-only APP readiness report now exposes `capture_execution_state` for
the current or most recent attempt in the running forwarder. The UI displays
this state independently from overall readiness and clears it on recheck
until the new snapshot arrives. The console reports the final state of a
completed post-response task. No request, grant, signing, or receipt behavior
changed. The local WEB harness explicitly disables Wrangler's online
`Request.cf` fetch in its child environment.

**CHECKS:** Rust 1.98.1, locked and offline. The Proxy capture harness passed
38/38, including the case where the origin HTTP response is preserved, a
proof failure stays observable after cleanup, and the verifier and Result
boundary are never called. The APP-source harness passed 44 unit tests and
one shared-vector test. The actual Proxy Result-binding suite passed 12/12,
including same-job recovery and exact candidate bytes. The separate-process
Notary Complete/Sparse loopback test passed 1/1 on its separate rerun in
17.41 seconds. Its initial run reached the existing 60-second deadline
during transport while a compile was running. The cause of that first
timeout was not determined.

The Chromium readiness regression passed 1/1. The Vite build with an empty
dotenv directory passed, and the isolated native APP
`cargo check --locked --offline --features tlsn-production,custom-protocol`
passed. The snapshot omitted the APP roaming configuration. A separate
no-network Wrangler smoke returned the local `Request.cf` default without a
fetch warning. The five local WASM diagnostic classification cases passed.

**OPEN:** This change has not been exercised in a new native APP GUI capture.
The HOME11 post-response stop remains **UNKNOWN**, and actual APP Result
receipt and candidate save remain **NOT_CHECKED**. Hosted CI, formal
execution receipt, and accepted Evidence remain **NOT_CHECKED**. Stage A/B/C
and Production acceptance remain **BLOCKED**.
