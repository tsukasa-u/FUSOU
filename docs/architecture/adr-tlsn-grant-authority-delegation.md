# ADR: TLSN Grant Authority Delegation

Date: 2026-10-27.
Basis: `tlsn-first-testplay-candidate` at
`b917fd2cdf3b56b644ade1271d01e8bf4c807d69`.
Status: **Proposed recommendation; delegation approval not granted.**
Runtime authorization/publication/read implementation: **NOT_IMPLEMENTED**.

This ADR fixes the recommended allocation of responsibilities and required
invariants. It does not register a policy, select real Production values,
define an issued-grant wire schema, or enable acceptance. Every
`UNDEFINED_CONTRACT` below is a blocking protocol decision, not an optional
TODO. The existing source and real deployment are separate evidence classes.

## 1. Decision and approval boundary

Recommend **Option A**: a dedicated, immutable-revision trusted reusable
workflow is the sole delegated eligibility principal; the existing binding
authority remains the final grant authorizer and durable issuer. The
authority independently enforces its policy and consumed-capture scope.
The independent consumer rechecks both grant state and release/evidence
context. **There is no runtime success path in this change.**

This is an explicit proposed delegation of an authorization function, not a
claim that present OIDC authentication already grants it. Approval must bind
the principal, complete trusted implementation, allowed callers, eligibility
algorithm, independent policy inputs and capture-selection predicate.
If those conditions cannot be established, remain blocked; do not fall back
to Option B/C, a candidate hash, static grants or human approval per release.

Option A minimizes new credentials and duplicated GitHub-verification code:
the existing Actions metadata adapter and eligibility checks can be reused.
It adds a new public delegation-policy decision and a new trusted workflow;
neither exists as a registered issuer today. It is conditional on the
reusable-workflow identity/claim and isolated-job contract being verified.

## 2. Source audit and eight separate boundaries

| Boundary | Source-observed state | Not implied |
| --- | --- | --- |
| B1 | [OIDC verifier](../../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc.mjs) verifies fixed GitHub issuer/JWKS, RS256, audience, expiry/age and configured repository/workflow/run claims | Successful eligibility steps, source identity or publication permission |
| B2 | [Eligibility](../../scripts/release-eligibility.mjs) uses authenticated GitHub tag-validation metadata, tag resolution, main ancestry and workflow parity | Durable authority approval or permanent eligibility after external state changes |
| B3 | [Catalog reader](../../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-catalog.mjs) checks exact consumed binding/subject/job and Result/receipt/catalog consistency | Permission for a release/run to read another session's evidence |
| B4 | [Candidate compiler](../../scripts/release-grant-provider.mjs) outputs `DERIVED_NOT_AUTHORIZED` after independent input checks | An authorized grant or transferable authority capability |
| B5 | [Binding authority](../../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/binding_authority.ts) commits consumed binding, Result, optional receipt and catalog in its transaction | A grant store, issuer policy, revocation state or grant CAS |
| B6 | [Online provenance](../../scripts/release-archive-provenance.mjs) and [consumer](../../scripts/release-consumer.mjs) reacquire GitHub artifacts and compare exact report/input bytes and metadata | Detached JSON authentication or an implemented authorized-grant reader |
| B7 | [Archive writer](../../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/result_archive.ts), [HTTP client](../../scripts/release-archive-http.mjs) and [handler](../../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http.mjs) check current version/size/raw digests against catalog/policy | Historical generation retrieval, overwrite prevention or retention |
| B8 | Existing checks distinguish archive acquisition from native execution; the formal native identity contract is undefined | TLSN/native cryptographic verification from OIDC, a report or a grant |

The [current workflow](../../.github/workflows/tlsn-release-eligibility.yml)
has an isolated archive acquisition job, not a grant-issuing reusable
workflow. The [archive job](../../scripts/release-archive-job.mjs) can emit
only a blocked candidate branch. The
[transport contract](../../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs)
is a pinned static readback policy: its optional reusable-workflow fields
are constrained to the existing workflow identity. They cannot silently
become Option A's new principal or permission.

The [execution intake](../../scripts/release-execution-intake.mjs) private
proof is process-local. Serializing its fields does not create an
authority-verifiable decision. The
[Worker source inventory](../../scripts/release-worker-source.mjs) and
execution implementation list constrain source integrity, not who may issue
grants. Future trusted delegation modules/workflows must enter the applicable
inventories before acceptance; no inventory changes are made here.

The [earlier authenticity contract](./tlsn-data-authenticity-contract.md)
provides scope context at its stated older source basis, not evidence of
current grant implementation. APP image/process authority, TPM, measured
boot, privileged helpers and browser integrity remain **OUT_OF_SCOPE**.
Game Server identity remains the observed canonical lowercase DNS identity
from Presentation/Web PKI, not an archive endpoint or candidate selection.

## 3. Options compared on the same criteria

| Option | Authorization root and independent checks | Reuse and new requirements | Principal risks and disposition |
| --- | --- | --- | --- |
| A | Explicit public delegation policy pins the reusable eligibility principal; authority checks caller identity, local policy and catalog; consumer independently rechecks release state | Reuses GitHub OIDC/JWKS, Actions API metadata, eligibility logic and existing authority. Requires isolated reusable job, exact identity/revision approval and issued-grant protocol | Trusts approved workflow implementation to perform eligibility before requesting issuance; OIDC is not step attestation. **Recommended conditionally**, no registration/acceptance now |
| B | Existing coordinator requests issuance; authority itself independently reacquires and verifies GitHub eligibility, release inputs and capture policy | Reuses caller workflow but needs an approved authority-side GitHub metadata acquisition/authentication contract, trusted revision/closure and policy derivation, plus the same persistence/read protocol | Repository visibility/API access is unverified; no such authority verifier exists. Coordinator JSON/private proof cannot substitute. Not safer if independent checks are omitted; not selected |
| C | A distinct provider needs an independently approved identity, delegation, metadata acquisition and authority/consumer trust binding | Adds an actor/service and operational trust distribution; no existing registered provider was found in this path | Does not solve the missing trust contract by naming a provider. No new long-lived secret, key, unapproved root or per-release human approval. Not selected while A is viable |

For B, distinguish an issuance requester from the final durable issuer.
Calling the coordinator an issuer does not authorize it to publish its own
candidate. If A's mandatory identity guarantees cannot be established, record
that failure and reassess B with real independent authority verification;
there is no automatic downgrade.

## 4. One-time bootstrap versus automatically derived values

All new public-input rows are **design requirements only**. Existing
variable/field names describe current source, not installed Production pins.
Numeric repository/owner IDs, endpoint hosts and deployment IDs are
**NOT_CHECKED**; synthetic fixture values must never fill them.

| Input | Need and existing value/source | Independent verification and bootstrap requirement |
| --- | --- | --- |
| P01 | Canonical HTTPS Worker endpoint and logical authority deployment/state identity. Existing route is archive readback only; real deployment mapping is not verified | Independently approved endpoint-to-authority/deployment mapping and state epoch. TLS authenticates the configured endpoint, not arbitrary response-reported deployment IDs. No process/image attestation |
| P02 | Issuer is exactly `https://token.actions.githubusercontent.com`; fixed JWKS source exists | Reuse signature/algorithm/kid refresh/time validation from trusted issuer. Never use token-header `jku`/`jwk` as a key source |
| P03 | Dedicated issue and read audiences; current archive audience equals its exact endpoint | Independently register purpose-separated issue/read identities. Endpoint paths and new audience strings are `UNDEFINED_CONTRACT`; archive-read token must not authorize issuance |
| P04 | Repository name is `tsukasa-u/FUSOU`; numeric `repository_id` is required today; `repository_owner_id` is not enforced by the current verifier | Obtain/approve actual repository and owner IDs independently, then compare signed claims and trusted metadata. Ownership transfer requires policy review, not name matching |
| P05 | Existing caller workflow path is known; the follow-up adds a fixed-disabled reusable diagnostic, not a registered issuer | Approve exact allowed caller and reusable identities plus full trusted dependency closure. Caller inputs/artifacts are not identity roots |
| P06 | Current caller is main-history checked; no immutable reusable issuer revision is registered | Pin reusable revision and transitive implementation/actions. Explicit caller revision/ref policy must be verified independently. A mutable ref alone is insufficient |
| P07 | Existing Production caller uses `workflow_run` on `refs/heads/main`; eligibility requires successful same-repository tag-validation push/main ancestry | Approve these predicates and development-tag exclusion. Verify actual reusable OIDC event/ref semantics before implementing them; do not assume `workflow_call` is the signed caller event |
| P08 | Release source SHA, caller `workflow_sha` and reusable `job_workflow_sha` have different roles | Resolve source from authenticated live tag/validation metadata. Match the caller and delegated revisions independently; never require or infer equality with release source |
| P09 | Capture/Result/receipt expectations come from exact consumed authority state/catalog, not candidate metadata | Approve an automated release-to-capture/subject selection predicate. Matching source alone does not authorize every session built from that source |
| P10 | Final issuer is the existing authority; binding names alone are not a globally authenticated issuer identity | Register logical issuer/deployment/state-epoch and allowed operation/subject scope. No Origin Inventory/Target Approval key is repurposed as a grant key |
| P11 | Existing `FUSOU_RELEASE_CHECK_INPUTS_SHA256` and `FUSOU_RELEASE_PUBLIC_INPUTS_SHA256` independently pin current inputs | Both authority and consumer need independently distributed delegation-policy identity. Reuse current roots only after approved versioned semantic extension; never take a new pin from candidate/report |
| P12 | Static grants have time bounds; candidates cap proposed lifetime at 600000 ms; issued-grant lifetime/revocation/revision/CAS is absent | Approve short TTL, freshness/clock rules, state revision and revocation authority/propagation. Existing candidate limits are not an installed issued-grant policy |
| P13 | Existing provider reads archive bytes, not authorized grants; consumer can run separately from producer | Approve a scoped read-only grant principal/path and online reacquisition model. Reader run identity is not required to impersonate producer run identity |
| P14 | Source/TCB inventories and per-release input digests exist, but are not delegation registries | Pin the stable derivation algorithm and approved authenticated input sources once. A machine-verifiable per-release input/capture derivation contract must replace any need to manually repin each release |

In particular, today's check policy includes concrete source/capture/object
values. Copying that policy and manually registering its new hash each release
would **not** satisfy the no-recurring-approval requirement. New policy
semantics must derive release-specific input bytes/digests and eligible
capture selectors from approved immutable GitHub source/metadata and authority
state. The delegate computes observations; authority and consumer verify the
agreed independent expectations. This derivation contract remains undefined
and must preserve all current assertions, not merely remove pins.

Bootstrap is performed once per approved policy/deployment or trusted-code
revision change, not once per release. After protocol implementation and
bootstrap approval, run/attempt, source/tag eligibility, exact input digests,
eligible capture and short-lived grant issuance/readback can be automatic.
Registration alone does not implement those operations. Trusted-workflow
revision rotation or ownership/deployment changes still require
controlled bootstrap maintenance, never silent self-registration.

## 5. Option A authorization invariants

Before any durable issuance, all of the following must hold:

1. A purpose-specific token passes trusted GitHub signature/issuer/exact
   audience/algorithm/time checks. Unknown keys refresh only from fixed JWKS;
   unavailable keys or missing inputs fail closed. Require `exp` and `iat`,
   validate `nbf` when present, enforce expiry/order/maximum age and the
   independently approved clock tolerance; do not assume any token is valid
   merely because its signature verifies.
2. Signed repository/owner, caller workflow identity/revision, event/ref and
   run/attempt match independent policy. `job_workflow_ref` and
   `job_workflow_sha` must identify the approved immutable delegate. For this
   sole-delegate design they are mandatory; unavailable or ambiguous claims
   block A rather than falling back to caller `workflow_ref`.
3. The approved reusable job itself performs live eligibility verification
   using authenticated GitHub metadata. Input validation-run IDs and source
   hints are selectors, not expected truth. It verifies completed successful
   same-repository validation, production tag resolution, main ancestry,
   trusted validation workflow parity, producer run/attempt and independent
   release-input derivation. It rechecks mutable tag/run metadata before
   requesting issuance. Development/untrusted PR/other-branch callers fail.
4. The token-requesting job executes only the immutable trusted closure.
   No caller checkout, arbitrary command, build, artifact executable,
   caller-controlled script/module/environment override or inherited secret
   may run with issuance OIDC permissions. Permissions are confined to that
   job; contents/actions access is read-only. Nested/cross-repository callers
   are denied unless a future explicit policy defines equivalent guarantees.
5. The authority validates the authenticated delegated request against its
   independent active delegation/release/capture policy, allowed lookup and
   exact consumed binding/catalog/Result/receipt state. It computes its own
   record/digests/lifetime; candidate `PASS`, `authenticated` or proposed
   policy hashes never become roots.
6. Policy/capture/state revision and authorization freshness are still valid
   at atomic persistence. No success is returned before commit; failed commit
   cannot return a candidate as a grant.

OIDC identifies the approved job/principal; it **does not prove successful
steps**. Under A the newly approved policy explicitly trusts the immutable
principal's implementation to make the eligibility request only after its
checks. This trust assumption must be accepted as delegation, or A cannot
be enabled. Independent authority-local checks and consumer live rechecks
are still required. Raw candidate JSON has no such delegated authority.

The current workflow job, policy schema and optional reusable claim
comparison do not satisfy this new contract. No actual GitHub claim
availability or job isolation has been observed in this work.

## 6. Semantic grant state and persistence contract

The following are semantic requirements, **not new wire tokens or a schema
version assignment**:

```text
DERIVED_NOT_AUTHORIZED
  -> authorization predicates hold (transient, not a consumable grant)
  -> atomic durable authorized grant (design-only; NOT_IMPLEMENTED)
  -> fresh scoped reader observation
  -> consumer independently verifies grant, release and archive evidence
```

Unknown/missing/mismatched, not-yet-valid, expired, revoked, conflicting or
stale-revision state must be rejected, never replaced by a candidate.
Revocation is terminal for an issued record; retries cannot reactivate it.
Expiry is checked with `not_before <= authority time < expires_at`; consumer
freshness/clock policy must also be explicit. JWT clock tolerance does not
implicitly extend a grant lifetime.

| Semantic item | Required binding | Present source versus unresolved protocol |
| --- | --- | --- |
| G01 | Grant ID and version identify one logical authorization scope | Scope includes issuer epoch, repository/principal, caller/delegate revisions, producer run/attempt, release source, capture/subject/job/attempt/binding and operation. ID encoding/hash/domain and schema are `UNDEFINED_CONTRACT` |
| G02 | Issuer logical identity, approved deployment and state epoch | Must match independent bootstrap, not the record's own assertion; current catalog writer names do not supply it |
| G03 | Repository/owner and caller/reusable workflow identities/revisions | Authenticated as distinct principals/commit identities; actual new claim policy remains undefined |
| G04 | Producer run/attempt, validation run/attempt, tag/source and workflow context | Live independent/delegated verification plus consumer recheck; no source-from-OIDC assumption |
| G05 | Exact release input, check/capture policy and delegation-policy identities/digests | Approved stable derivation and independent roots, not a newly self-pinned candidate |
| G06 | Capture/session/user/device/job/verification attempt/binding and permitted operation | Resolved from authorized authority lookup and predicate; no arbitrary key or cross-session inference |
| G07 | Each permitted object's current version, raw size/digest and catalog-resolved key | Existing snapshots provide these facts; they do not assert retention or old-generation retrieval |
| G08 | Exact Presentation and outer Result envelope digests; execution receipt digest/presence | Preserve existing byte bindings. Optional absence is explicit; a policy requiring a receipt must reject absence, not invent native verification |
| G09 | Authorization policy revision, exact catalog/state snapshot and decision freshness | Version/CAS/epoch binding to be defined; content hash alone is not authorization |
| G10 | Authority-issued time, not-before, expiry and permitted use scope | Bounded by approved TTL/freshness, never request-selected or renewed on idempotent retry |
| G11 | Immutable grant raw bytes and digest, compared independently | Canonical serialization/hash domain/version and response representation remain undefined; no offline signature is added |
| G12 | Separate mutable active/revoked state, monotonic revision and revocation metadata | Immutable grant bytes remain stable; current state is reacquired, not inferred from a saved active response |
| G13 | Authenticated delegated observation context and checked input identities | No token in logs/artifacts and no bare `PASS` as proof; exact request/observation binding and freshness format remain undefined |

Logical scope must not include candidate digest, random request ID, current
clock, proposed expiry or object-content hash as a way to evade same-scope
conflict detection. Concurrent same-scope/same-content issuance returns the
same committed immutable bytes/ID/expiry. Different content or a changed
authorization policy for that existing scope conflicts unless an explicitly
approved migration protocol says otherwise; it is not a silent renewal.
Distinct workflow attempts are distinct scopes. This is idempotence, not a
global one-time consumption ledger.

### Async boundaries, atomicity and revocation

- OIDC key refresh, delegated GitHub checks, HTTP transport and any external
  reads happen outside the Durable Object storage transaction. The approved
  runtime must not retain a transaction across external I/O.
- Snapshot policy/epoch/catalog/consumed-state identity before evaluating the
  decision; after awaits, re-read/revalidate relevant state at commit.
  Atomically compare active authorization revisions, resolve same-scope
  existing content, and persist immutable grant plus mutable initial state.
  Stale state or conflicts must abort/re-evaluate, never use the old decision.
- Policy/control-plane state outside that object is **not** made atomic by
  a local transaction. Epoch ingestion/invalidations, cross-object routing,
  rollback/restore fencing and revocation propagation need an approved
  protocol before any claimed CAS guarantee.
- Global GitHub state and local persistence cannot be one transaction.
  Eligibility is a bounded-freshness observation, not a permanent lock on
  a tag/run/main branch. The delegate rechecks before issuance; the consumer
  independently rechecks before acceptance. Changed/expired observations
  block acceptance; they are not hidden by the grant's recorded status.
- Reader observes grant bytes and mutable state/revision consistently.
  Revocation/expiry is checked at grant read and archive admission; the
  consumer rechecks immediately before its decision. Revocation after that
  final observation is a temporal limit, not retroactive global atomicity.
  No stale cache fallback is permitted when current state cannot be obtained.

Existing consumed Result/catalog transactions are prior art, not evidence
that this grant/CAS protocol is implemented.

## 7. Scoped reader and independent consumer verification

Recommend online authority reacquisition, not a new detached signature
scheme. The consumer supplies independently established producer run/source,
release inputs, policy/issuer and allowed capture context. It authenticates
to a separately authorized read-only grant principal and fixed trusted
authority endpoint, resolves just that scope, and receives exact immutable
grant bytes plus consistent current state/revision.

The **reader run and producer run are different identities** in cross-run
intake. A reader must not impersonate the producer's OIDC `run_id` to obtain
its grant. A proposed read policy must authorize the independently verified
consumer workflow/revision/run and its relation to the intended producer/
release scope. Both issuance and reader roles are deny-by-default; neither
implies list/write/delete/publish rights. Read authorization must not require
the very grant being fetched or allow arbitrary session/capture enumeration.
Actual endpoint/method/selector and role policy are `UNDEFINED_CONTRACT`.

Consumer requirements, in order:

1. Authenticate the independent endpoint/issuer/policy binding and the
   authorized read acquisition, not response `authenticated` fields.
2. Verify raw grant bytes/digest/schema and current active state/revision,
   issuer epoch, validity window and non-revocation under independent policy.
3. Reacquire trusted GitHub producer/caller/delegate and validation run
   metadata and approved source/eligibility/input identities. Reject moved
   tags, attempts/revisions or changed expectations; do not use grant JSON
   as the expected values.
4. Correlate grant capture/lookup/catalog/object/Result/receipt bindings with
   independently expected context and existing authenticated report and raw
   HTTP/archive bytes. Size, exact raw digest and current version checks
   remain necessary even when the grant is authentic.
5. Recheck live policy/grant state and relevant mutable external metadata
   before acceptance. Any missing acquisition/authentication/schema/input
   keeps the check unattested or blocked.

TLS authenticates the independently configured service endpoint; an issuer
or deployment field inside JSON is not self-authenticating. Actual
endpoint-to-authority deployment mapping still needs trusted bootstrap and
external observation. This is not process/image authority. Saved grant or
provenance JSON alone cannot establish fresh authorization/revocation;
offline signature verification remains **NOT_IMPLEMENTED**.

The existing label `AUTHENTICATED_PRODUCER_REPORT_VERIFIED` retains only its
online GitHub metadata/archive digest/trusted workflow scope. It must not be
renamed or interpreted as authorized-grant verification or native crypto.
Neither reader nor issuance success proves archive retention or TLSN crypto.

## 8. Unresolved contracts and stopping conditions

Each row is currently **UNDEFINED_CONTRACT** and blocks runtime enablement.
Exact endpoints, encodings, errors and real bootstrap values are deliberately
not fabricated in this ADR.

| Contract | Required resolution before implementation/acceptance |
| --- | --- |
| U01 | Verify signed reusable/caller/owner/event/ref claim semantics and availability, exact direct-call restrictions, immutable closure and isolated token-requesting job |
| U02 | Approve delegation-policy schema, purpose-separated roots/digest canonicalization, independent authority/consumer distribution and rotation |
| U03 | Define machine-verifiable per-release public/check input derivation from stable approved sources; no manually repinned hash per release and no removed assertions |
| U04 | Define authorized release-to-capture/subject selection from authority/policy, including multiple captures for the same source; request hints alone cannot decide it |
| U05 | Define logical issuer/deployment/state epoch and routing/restore identity, independently bound to trusted service configuration |
| U06 | Define issue/read protocol, canonical endpoints/audiences, bounded wire formats, role checks, privacy-preserving errors and no-enumeration behavior |
| U07 | Define logical scope/ID, schema version, immutable byte encoding/digest domain, receipt presence and exact input/observation bindings |
| U08 | Define state revision/CAS/idempotence, policy epoch ingestion, cross-object coordination and revocation authority/propagation/rollback fencing |
| U09 | Approve exact lifetime, authorization observation freshness, issuer/reader clock handling and rejection when time/state is uncertain |
| U10 | Define independent consumer read identity and cross-run producer relation, current-state reacquisition and final recheck behavior |
| U11 | Specify endpoint/deployment and GitHub acquisition evidence needed by authority/consumer; no serialized private proof or detached JSON fallback |
| U12 | Approve versioned migration/TCB inventories and acceptance tests, and separately observe real bootstrap/deployment/service behavior |

Existing blockers remain, without aliasing a document decision to code:

- `ARCHIVE_GRANT_AUTHORITY_READER_NOT_REGISTERED`
- `ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED`
- `FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED`

No publication provider, mock successful authorizer, Production endpoint,
trust-policy auto-registration, key, secret or runtime path is added here.

## 9. Check meanings and future real verification

| Existing check | Meaning preserved | This ADR establishes |
| --- | --- | --- |
| `locked_dependencies` | Exact approved dependency/source input contract | Documentation only, no new runtime evidence |
| `compiled_inputs` | Actual compiled artifact/input correlation | No build or compiler execution |
| `archive_readback` | Authenticated acquisition plus exact catalog/version/size/raw bytes | No real provider, OIDC, authority or R2 acceptance |
| `offline_verification` | Formal authenticated native producer and crypto verification contract | No launcher, executable identity or native/TLSN proof |

All real evidence remains **UNVERIFIED** in this step. The native blocker is
unchanged and cannot be discharged by a grant. R2 version is opaque
current-object equality, not historical retrieval, retention or overwrite/
delete protection.

After the undefined contracts are approved and source implementation is
separately allowed, local tests must cover caller/delegate substitution,
fork/PR/event/ref/revision rejection, missing claims/keys/policy, source versus
workflow SHA, run/attempt/input/capture/size/digest mismatch, expired/revoked/
unknown scope, simultaneous identical/conflicting writes, state changes
across awaits, failed transactions and cross-run reader authorization.

Only when external operations are separately authorized: observe actual
signed reusable OIDC claims without preserving tokens; authenticated GitHub
eligibility and immutable closure; independent bootstrap distribution;
authority durable issue/restart/read/revoke/CAS behavior; policy epoch
changes; current real R2 bytes/version; and independent consumer reacquisition.
Native build provenance, real Presentation/Result/receipt and TLSN verification
remain separate acceptance work. Synthetic tests or this ADR cannot establish
real `RELEASE_ARTIFACTS_VALIDATED` or `DEPLOYMENT_VERIFIED`.

Invariant: `publication_authorized: false`; deployment **NOT_CHECKED**;
Production acceptance **BLOCKED**.

See the [roadmap verification record](../implementation-plans/tlsn-data-authenticity-roadmap-2026-10-23.md)
for the documentation-only commands and their actual outcomes.

## 10. Nonoperational Option A source preparation

Follow-up source basis:
`4505b8fcd6a5c145ba56fb9a8e56b2a690adecda` on
`tlsn-first-testplay-candidate`. This section adds planning tools, not
delegation approval, an issuer protocol or new runtime trust roots.

### Machine-readable bootstrap, not an issued-grant schema

The [v1 bootstrap schema](../../scripts/tlsn-grant-delegation.v1.schema.json)
and [draft policy](../../scripts/tlsn-grant-delegation.draft.json) express the
P01-P14 requirements. They are distinct from the existing static archive
readback policy, candidate policy and still-undefined issued-grant format.
The scope is `fusou-grant-delegation-bootstrap-policy-v1`; version is 1.
Lifecycle permits local claims `PROPOSED`, `ACTIVE`, `REVOKED`, but
`operational_enabled` and `publication_authorized` are always false. The
committed draft is `PROPOSED`; no actual numeric ID, endpoint, audience,
trusted revision, state epoch or lifetime is invented.

Property annotations distinguish `SOURCE_CONFIRMED` constants,
`DESIGN_PROPOSAL` rules requiring approval and `EXTERNAL_INPUT` values or
protocol identities requiring independent definition/registration. Null is
an explicit missing bootstrap input, not a permissive runtime default.
`policy_digest_contract` remains null: source inventory hashes/current
public/check input pins are not a delegation-policy approval registry.
The digest encoding/domain/distribution and actual authenticated active
digest remain U02. A populated local registry name is not that evidence.

The [offline preflight](../../scripts/release-grant-delegation.mjs) uses a
bounded flat JSON Schema profile: required scalar properties, no extra
properties, scalar types, const/enum, string pattern/minimum length and
JSON-safe integer bounds. Unknown schema keywords, missing fields and unsupported
versions fail closed. It does not implement a general JSON Schema engine,
resolve references or fetch schemas. Endpoint syntax and purpose-separated
audiences are checked without connecting. Shape validation is neither
issuer authentication nor policy approval.

| Report layer | Meaning and current result |
| --- | --- |
| `source_contract` | `SOURCE_CONTRACT_READY` means only that the bundled bootstrap schema/draft shape passes; invalid source is `BLOCKED_IMPLEMENTATION`. It does not mean U01-U12 are resolved |
| `policy_approval` | Always `BLOCKED_POLICY_NOT_APPROVED`; independent active pin is `NOT_VERIFIED`, because no independent registry adapter exists in this offline tool |
| `external_inputs` | Always `BLOCKED_EXTERNAL_INPUTS`; enumerates missing fields. Even a fully populated local policy has registration `NOT_VERIFIED`, not proven registered or proven absent |
| `implementation` | Always `BLOCKED_IMPLEMENTATION`; grant authorization, publication provider, authority/grant reader, policy root/digest distribution, input/capture derivation and issued-grant state protocol remain absent/undefined |

The overall status stays blocked, including self-claimed `ACTIVE` policy or
`PASS`/`authenticated` report fields. There is no activation option, registry
writer, token/credential lookup or arbitrary input-path CLI. The CLI reads
only the two fixed bootstrap JSON files through the existing regular-file,
no-follow helper, prints diagnostic JSON and exits 1 because operational
readiness is blocked. Parse/read errors propagate; they are not replaced
with success-shaped reports. Pure in-memory inspection accepts test data
but never grants authorization.

### Fixed-disabled reusable workflow

The [reusable diagnostic source](../../.github/workflows/tlsn-grant-delegation.yml)
has exactly one job, unconditionally `if: ${{ false }}`. This fixed-disabled
choice was explicitly confirmed for the follow-up. There is no existing
caller wiring, workflow output capability, OIDC permission/request, authority
endpoint call, grant issue/publish/read or policy registration. Only
contents/actions read permissions and already-used immutable Action SHAs
appear. No job was executed.

Its source calls `evaluateDelegationDiagnostic`, which reuses
`evaluateReleaseRun` and keeps development validation distinct from Production
main-history eligibility. It compares caller selectors to live API run/
attempt/workflow metadata and reports the separately observed release source.
The selected implementation SHA is **not** a trusted delegate pin: it is
explicitly `CALLER_SELECTED_DIAGNOSTIC_LOCATOR` / `NOT_VERIFIED`.
`GITHUB_WORKFLOW_SHA` describes caller context, never assumed callee identity.
Signed `job_workflow_ref` / `job_workflow_sha` are not obtained; delegated
identity remains `NOT_VERIFIED`, `job_workflow_sha` is null, and
`production_grant_eligible` is false even with `PRODUCTION_ELIGIBLE`.
The diagnostic is `DERIVED_NOT_AUTHORIZED`, not an authority grant.

In particular, the disabled candidate checkout is not the isolated trusted
closure needed by section 5. Removing `if: false` or filling the draft does
not implement that boundary. Before a future issuer job, approve and implement
independently verified immutable delegate loading, exact signed claim
comparison, source inventories, release-input/capture derivation and every
U01-U12 runtime contract. Do not execute caller-selected code with issuance
permissions.

### Bootstrap and fixed-revision sequence

1. Commit and independently inspect the diagnostic/schema/implementation
   closure. Source readiness alone authorizes nothing.
2. Resolve remaining protocol decisions, implement the separately authorized
   isolated issuer/reader path and add all relevant files to its versioned
   trusted source inventory. The current runtime inventories are unchanged.
3. Determine the actual final full commit SHA from source, verify the reusable
   revision and Action/module closure independently, and explicitly approve/
   register that delegation policy, issuer/deployment/epoch and purpose-
   separated roots/audiences for authority and consumer.
4. Only in a later authorized change, wire callers using
   `tsukasa-u/FUSOU/.github/workflows/tlsn-grant-delegation.yml@<full-40-hex-SHA>`.
   No future SHA is guessed or registered here. A new approved revision must
   be pinned again; the skeleton commit is not automatically an issuer pin.
5. After separately permitted external observation of actual OIDC claims,
   live eligibility, durable issue/revoke/CAS/read and consumer reacquisition,
   evaluate operational acceptance. Registration alone cannot provide it.

Stable bootstrap inputs are repository/owner identities, delegate/caller
revision policy, endpoint/deployment/epoch, roots/digest derivation,
eligibility/capture/subject rules, grant wire/scope/TTL/revocation/CAS and
consumer read identity. Run/attempt, release source SHA, per-release input/
capture-policy digests, capture/session/job/verification attempt/binding,
object version/raw size/digest and Result/optional receipt observations must
then be derived automatically from authenticated metadata and independent
authority state. They are not hardcoded recurring bootstrap fields.

No authorized-grant persistence, ID, canonical bytes, expiry, revocation,
CAS or grant-read protocol is implemented by these tools. Section 6's
same-scope idempotence, nonrenewing retries, changed-content conflicts,
external I/O outside transactions and post-await state/epoch revalidation
remain proposed requirements, not locally tested issued-grant transitions.
There is no global one-time consumption ledger.

The [key-free contracts](../../scripts/release-grant-delegation.test.mjs)
verify local shape/blocker/diagnostic behavior and refusal to consume a
preflight as a registered provider. Existing candidate/consumer/runtime
contracts remain unchanged. Four real checks remain **UNVERIFIED**;
`FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED`,
`ARCHIVE_GRANT_AUTHORITY_READER_NOT_REGISTERED` and
`ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED` remain blockers.
`AUTHENTICATED_PRODUCER_REPORT_VERIFIED` retains its existing online
GitHub metadata/archive/trusted workflow scope, not grant/native authority.
`publication_authorized: false`, deployment **NOT_CHECKED**, Production
acceptance **BLOCKED** remain invariant.
