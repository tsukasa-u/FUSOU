# ADR: TLSN Grant Authority Delegation

Date: 2026-10-27.
Basis: `tlsn-first-testplay-candidate` at
`b917fd2cdf3b56b644ade1271d01e8bf4c807d69`.
Status: **Proposed recommendation; delegation approval not granted.**
Runtime authorization/publication/read implementation: **NOT_IMPLEMENTED**.

Implementation follow-up: the WEB exact-owner device-proof handlers and durable
proof consumption now exist, and the APP collects seven verified public runtime
artifacts into candidate capture. These establish neither delegated grant
eligibility nor full-Bundle archive authorization. The current
[readiness record](../../packages/FUSOU-TLSN-VERIFIER/FIRST-TESTPLAY-READINESS.md)
and [material lineage](../../packages/FUSOU-TLSN-VERIFIER/DEVICE-PROOF-MATERIAL-LINEAGE.md)
describe that narrower implementation. This ADR's delegation approval, authority
grant store/protocol and Production delivery gates remain unchanged.

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
| P04 | Repository name is `tsukasa-u/FUSOU`; archive policy and signed claims require both `repository_id` and `repository_owner_id` as canonical positive decimal strings | Obtain/approve actual repository and owner IDs independently, then compare signed claims and trusted metadata. Source enforcement does not prove real ID registration or OIDC acceptance. Ownership transfer requires policy review, not name matching |
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

## 11. Bootstrap classification and minimal draft projection

Source basis: `1ef6af67de90db90cb4202a52df960445f804f2b`.
The [classification module](../../scripts/release-grant-delegation-classification.mjs)
adds a machine-readable inventory to the existing preflight JSON:
`classification.fields` lists all 43 schema paths, current public value/state,
one exclusive primary class, normal supplier, independent verification,
blocker, bootstrap/runtime/source derivability, approval/registration
requirements, actor/target and exact source/ADR anchors.
`classification.legacy_missing_fields` classifies all 22 old gaps.
No field or validation requirement is removed from the v1 schema.

| Primary class | Fields | Meaning |
| --- | --- | --- |
| `SOURCE_DERIVED` (18) | `schema_version`, `scope`, `issuer`, `jwks_uri`, `repository`, `caller_workflow`, `caller_revision_policy`, `delegate_workflow`, `delegate_claims_contract`, `event`, `ref`, `eligibility_contract`, `workflow_source_rule`, `policy_pin_source_contract`, `capture_state_contract`, `external_io_contract`, `idempotence_contract`, `consumer_recheck_contract` | Reproduce fixed source constants or requirement labels. Proposed rules still require policy-bundle approval and implementation; source text is not authority evidence |
| `DIAGNOSTIC_ONLY` (3) | `lifecycle`, `operational_enabled`, `publication_authorized` | Local planning claims/false flags, never roots or capabilities |
| `ONE_TIME_BOOTSTRAP_INPUT` (3) | `repository_id`, `repository_owner_id`, `delegate_revision` | Independently pin actual numeric identities and an explicitly approved immutable issuer closure. Current values remain null / `NOT_VERIFIED` |
| `UNDEFINED_CONTRACT` (19) | `issue_audience`, `read_audience`, `authority_endpoint`, `authority_deployment_identity`, `authority_state_epoch`, `policy_digest_contract`, `active_policy_registry_identity`, `public_input_derivation_contract`, `capture_selection_contract`, `grant_issuer_identity`, `grant_scope_contract`, `grant_wire_contract`, `grant_ttl_ms`, `freshness_and_clock_contract`, `revocation_contract`, `state_revision_cas_contract`, `consumer_read_endpoint`, `consumer_identity_contract`, `source_inventory_contract` | Missing semantics/acquisition/authorization or protocol decisions, not 19 text boxes solved by registration |

Thus the 22 old gaps split into **3 static trust selections plus 19 undefined
contracts**, not 22 manually supplied settings. The three selections are
the currently well-defined subset, **not a complete minimal activation
bootstrap**. The complete minimum remains `UNDEFINED_CONTRACT` until U01-U12
are resolved. Exact lifetime, issuer/deployment/epoch, roots/endpoints/roles
and other stable parameters may become necessary bootstrap inputs after
their protocols are defined; their security conditions are not deleted.
The eventual approval actor/root-distribution procedure itself remains U02,
not a newly invented provider or producer self-approval.

No current schema field is purely `EXTERNAL_REGISTRATION_REQUIRED`:
endpoint/audience/reader/root meaning must first be defined. Actual
registration is a separate, still-required operation under the approved
protocol. Likewise, no current schema field is a concrete `RUNTIME_DERIVED`
or `AUTHORITY_STATE_DERIVED` value. These categories are explicitly
represented by separate derivation records, not falsely attached to
source rule labels.

### Draft manifest and derivation obligations

`classification.minimal_manifest` is a `PROPOSED`, false-flagged diagnostic
projection of the same v1 policy, **not a duplicate acceptance schema**.
It separates static selections, source rule labels, diagnostic fields,
runtime/authority derivations, 19 unresolved fields, ten protocol
requirements, implementation blockers and post-registration observations.
Each field includes its approval/registration actor and destination;
where those are undefined the manifest says so, rather than inventing an
approved registrar. Public JSON outputs are recorded with exact generation
commands in the roadmap.

- Runtime: producer/validation run and attempt, actual caller workflow SHA,
  live tag/release source/main context come from authenticated GitHub
  metadata and existing `evaluateReleaseRun`/candidate/intake checks.
  These are not fixed bootstrap inputs. SHA roles are separate; their
  values may legitimately coincide.
- Runtime input digests: exact public/check/capture-policy bytes can be
  hashed and compared against existing independent pins. U03/U04 still
  block automatic *expected-input* and authorized-capture selection.
  Computing a digest does not authenticate its expectation, and current
  assertions/pins remain mandatory.
- Authority state: exact capture/session/subject/job/attempt/binding and
  current object version/raw size/digest, Result envelope and optional
  receipt digest come from the consumed Result/receipt/binding/catalog
  and exact lookup. U04 still blocks release-to-subject/capture permission.
  A catalog is neither a grant nor permission to enumerate sessions.
- Grant scope, issued time/expiry, state revision/epoch and revocation
  cannot yet be derived by existing grant code: there is no such code.
  These remain U05-U09 protocol/implementation blockers, not values to
  generate or register speculatively. Candidate TTL is not issued-grant TTL.

Existing candidate/report/catalog verification is source-established and
locally contract-tested; no real runtime values were observed in this
offline step. Every derivation records `NOT_OBSERVED` and grant binding
`NOT_IMPLEMENTED`. External registration alone does not implement these
paths. Section 6's CAS/revalidation/idempotence requirements are unchanged.

### OIDC identity audit without external observation

The current source fixes issuer/JWKS and checks exact configured audience,
repository/owner IDs, caller workflow/event/ref, run/attempt and token time/
signature. Current archive policy is not the new issue/read delegation
policy; optional `job_workflow_ref` / `job_workflow_sha` are constrained to
the existing caller, not Option A's new delegate. Current archive OIDC
verification now enforces `repository_owner_id` as detailed in section 12;
that check was absent at the classification audit's starting revision.
The proposed immutable delegate and mandatory signed reusable claims still need independent
policy approval, implementation and real observation.

No `sub` template is required or inferred. The verifier does not compare
`sub`; repository subject settings, any immutable-subject configuration,
actual reusable signed-claim availability and current official GitHub
subject specification were not externally inspected. They remain
`NOT_VERIFIED` / `NOT_CHECKED_OFFLINE`; the repository name or an assumed
legacy/custom `sub` shape cannot replace numeric identity checks. No
repository setting or trust policy is changed.

An authenticated reusable job is not successful-step attestation.
Eligibility-to-issuance still requires an explicitly approved immutable
principal performing its own checks and an authenticated observation path
to the final authority; JSON/private process capability cannot supply it.
The existing reusable workflow remains fixed-disabled, with no OIDC.

### Preflight compatibility and stopping conditions

The legacy `external_inputs.missing` list remains for compatibility and
audit continuity. Its meaning is now explicitly unpopulated planning fields,
**not a manual bootstrap checklist**. New `bootstrap_inputs` separates the
three static selections, `external_registration` remains `NOT_VERIFIED`,
and `readiness.complete` is always false while those independent adapters
and protocols are absent. Coverage errors block source status; filled
local values never discharge protocol, implementation or approval blockers.
The CLI still exits 1 and never activates policy, grants or publication.
For the valid bundled draft, source shape is `SOURCE_CONTRACT_READY`,
policy is `BLOCKED_POLICY_NOT_APPROVED`, bootstrap is
`BLOCKED_EXTERNAL_INPUTS` and implementation is `BLOCKED_IMPLEMENTATION`.
These are separate layers, not a complete-readiness success state.

The [classification tests](../../scripts/release-grant-delegation-classification.test.mjs)
verify exhaustive unique coverage, source anchors, no guessed values,
runtime/authority separation, preserved protocol blockers, OIDC uncertainty
and output mutation isolation. Prior candidate/provider assertions remain
unchanged. All four real checks remain **UNVERIFIED**;
`FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED` is unchanged.
`publication_authorized: false`, deployment **NOT_CHECKED**, Production
acceptance **BLOCKED** remain invariant.

## 12. Archive OIDC repository owner identity enforcement

The archive transport's existing trust boundary is unchanged: Worker
configuration supplies `TLSN_ARCHIVE_TRANSPORT_POLICY` and an independent
`TLSN_ARCHIVE_TRANSPORT_POLICY_SHA256`; canonical policy bytes must match
that pin before JWT or request-body processing. Producer/consumer inputs
independently pin the same archive contract. A local policy file, matching
self-reported digest, bootstrap report or approval label is not a new
registration/approval mechanism.

The existing archive policy validator now requires **both**
`repository_id` and `repository_owner_id` to be strings matching
`^[1-9][0-9]*$`. Policy or claims containing numbers, missing/null values,
leading zeroes, signs or whitespace are rejected without coercion.
Comparison does not convert IDs to JavaScript numbers. The bootstrap
schema already uses that string pattern; its nullable `PROPOSED` planning
values remain nonoperational, not permitted active archive policy values.
No new policy lifecycle, issuer, grant scope, root or Production value is
introduced.

After JOSE signature/issuer/audience/time verification, the
[verified-claims assertion](../../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc-claims.mjs)
strictly compares the two signed numeric ID strings with the pinned
policy. JOSE also requires signed `repository_owner` and
`repository_owner_id` claims. The owner name must exactly match the owner
component of the independently pinned repository name. This is a separate
name-consistency check, **not** derivation of an ID from a name, `sub`,
request body, producer record or release source. Missing/bad policy is a
503 policy error; missing/bad identity is a 401 authentication error.
Responses expose fixed error codes, never the JWT or claim values.

The assertion is deliberately key-free and assumes a verified payload;
calling it alone authenticates neither a JWT nor policy registration.
The actual verifier calls it only after `jwtVerify`. Archive response
authorization now includes the pinned owner ID, and the independent
consumer's existing exact metadata comparison rejects an absent,
mistyped or altered owner binding.

This is a fail-closed tightening of the existing v1 archive policy, not
automatic migration: an older policy without the owner ID is rejected
before token acquisition or archive reads. Any future rollout requires
independently observed IDs, approved policy/pin distribution and real
OIDC acceptance testing. No installed policy/pin or setting was read,
generated, registered or modified in this work.

Caller `workflow_ref`/`workflow_sha` remain distinct from delegated
`job_workflow_ref`/`job_workflow_sha` and release source SHA. The optional
job policy remains constrained to the existing archive caller identity;
when configured, both signed claims are required and compared exactly.
It does not accept Option A's new delegate or prove a successful
eligibility step. Real reusable claim availability and repository `sub`
settings remain **NOT_VERIFIED**; no legacy/immutable subject format is
assumed and no external specification/settings were consulted.

[Key-free owner contract tests](../../scripts/release-archive-oidc-claims.test.mjs)
cover strict ID/name checks, caller/reusable refusal conditions, policy
pin/body/client boundaries, consumer owner binding and continued grant
blockers. The existing RSA/JWKS fixture was updated for the tightened
contract but **NOT_RUN**: it generates RSA keys at module load even with
test filters. Parse-only validation is not signature/JWKS integration
evidence. Exact commands/results are in the roadmap.

The 43-field classification and three static trust selections are
unchanged. Only `owner_claim_enforcement` advances to
`SOURCE_IMPLEMENTED_NOT_EXTERNALLY_OBSERVED`. Real policy/pin registration,
IDs and signed acceptance remain unverified. Delegation stays unapproved,
the reusable workflow fixed-disabled, grant authorization/publication/
reader unimplemented, and the formal native identity blocker unchanged.
`DERIVED_NOT_AUTHORIZED`, `publication_authorized: false`, deployment
**NOT_CHECKED** and Production acceptance **BLOCKED** are preserved.

## 2026-10-28 native executable provenance stopping boundary

Source basis: `tlsn-first-testplay-candidate` at
`225c9c6752b54163407731ef85bdb91caf53b50b`. This is a source audit and
stopping decision, **not an approved native identity schema or registration**.

The formal CLI is
[`verify_fusou_tlsn_evidence.rs`](../../packages/FUSOU-TLSN-VERIFIER/src/bin/verify_fusou_tlsn_evidence.rs),
in the `fusou-tlsn-verifier` package. Existing argument handling, successful
Evidence Bundle JSON and rejected JSON/nonzero exit are implemented.
The [README invocation](../../packages/FUSOU-TLSN-VERIFIER/README.md)
uses `cargo +1.95.0 run --offline`; it does not select a target triple,
use `--locked`, distribute an executable or authenticate a builder.
The APP preflight workflow's Rust 1.98.1 is not a native verifier pin.
At this source basis the verifier's local Cargo.lock exists, but is
untracked and ignored. Its local contents cannot be authenticated by
the release source SHA. No lock or toolchain change is made here.

### Reusable mechanisms, not a completed native provenance contract

The [existing transport](../../scripts/release-transport.mjs) can authenticate
release/archive acquisition using online GitHub API reacquisition, fresh run/
attempt context, unique artifact name/ID, ZIP size/digest and metadata recheck.
The [execution intake](../../scripts/release-execution-intake.mjs) also checks
trusted implementation blob parity/main ancestry and exact report/receipt/raw
input binding. Its proof is process-local, not a detached signed attestation.
The [build verifier](../../scripts/release-build-proof.mjs) accepts only
`app` and `worker` artifact roles, not a formal native verifier artifact.
The [archive supplement](../../scripts/release-archive-provenance.mjs)
explicitly cannot replace build/native origin.

These are suitable mechanisms to evaluate for a future approved native
distribution contract; they do not supply its absent builder, recipe,
artifact role/derivation or independent native expectations. Do not assign
an arbitrary current workflow SHA as the native builder, turn the README
command into an approved recipe, reuse an APP/Worker proof for a native
binary, or treat a correct candidate digest as its own trust pin.
No new GitHub Artifact Attestations verifier, key, root or signature format
is introduced; offline signature verification is not implemented by the
existing online reacquisition mechanism.

### Required identity bindings and unresolved decisions

The following is a requirements checklist, **not an issued record schema**.
Every row must be independently supported before native acceptance:

| Binding | Current boundary / required resolution |
| --- | --- |
| Executable raw bytes, algorithm, digest and length | Existing checks use SHA-256/base64url raw byte pins. The GitHub ZIP digest is separately `sha256:` plus hex. A ZIP digest is not the executable digest; neither authenticates its own issuer |
| Source repository/SHA and input closure | Formal CLI/package are located, but no approved native source/TCB inventory or builder-source binding exists; protected source is not read to fabricate a complete closure |
| Target/platform, compiler/toolchain, dependency lock and flags | No formal native expected values/recipe are registered. Commit/review the correct native lock and define reproducible source/toolchain/recipe expectations before build observation |
| Builder workflow and immutable implementation identity | Approve the native builder principal, workflow path/revision, implementation closure, allowed source and isolation rules; a coordinator or reusable eligibility identity is not automatically a native builder |
| Builder run/attempt and artifact acquisition | Define native artifact role/name/ID/member and source-to-output/run relation, then extend the existing independent API reacquisition checks under explicit approval |
| Distribution/provenance verification | Define how consumer-approved expectations authenticate that native artifact and producer. JSON `authenticated: true`, self-declared digests or unverified signatures never substitute |
| Actual executable at launch | Define a permitted launcher and capture of the actual bytes launched, not merely callback-supplied before/after buffers or version strings |
| Execution identity and exact output/evidence binding | Bind producer workflow/run/attempt/source, expected binary and arguments, every input byte digest, stdout/stderr, start/end/termination state, exit and parsed JSON to release/capture/session/job/binding/archive context |

One-time decisions/registrations are the approved native builder/distribution/
launcher contracts and independent policy acquisition/verification rules,
not per-release human approval or a new secret. Per-build source/input
digests, compiler observations, output bytes, artifact/run/attempt and
per-execution evidence/output measurements must then be derived and
independently checked through those approved rules. No bootstrap values
or formal wire encodings are invented here.

### Existing report validators and explicit non-implementation

[`release-checks.mjs`](../../scripts/release-checks.mjs) already validates
independently pinned executable/input bytes, exact formal CLI argv/layout,
callback-supplied executable-before/after equality, stdout digest, exit/
structured result/trust/derived identity, archive byte equality and bundle
source/capture/session/binding correlation. That lower-level contract is
reused as-is, not duplicated into a new unverifiable record format.

There is no Production native launcher: the generic callback supplies its
measurements, and its mock-only `executable_version` requirement is not
an actual observation supported by this CLI. No stderr, process start/end
or authenticated formal builder/artifact relation is captured by that
generic contract. The formal JSON itself has no executable, builder,
session/job or process-identity fields; evidence correlation is separately
derived from the pinned input bundle, registries and archive.

Accordingly no new native schema/validator, artifact role, capability issuer,
authenticated launcher or successful consumer connection is added. A
shape-only schema could not discharge these trust requirements. The
[collector](../../scripts/release-evidence-producer.mjs) remains unconditionally
blocked for native production, and the independent consumer still rejects
missing native evidence and self-asserted success. Existing key-free tests
exercise only synthetic data/API/process doubles; their successful private
proofs are not real build provenance or TLSN execution.

`FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED` is **maintained**. Existing
delegation/grant blockers, four real checks **UNVERIFIED**,
`publication_authorized: false`, deployment **NOT_CHECKED** and Production
acceptance **BLOCKED** are unchanged. APP process/image authority, TPM,
measured boot, privileged helpers and browser integrity remain out of scope.

## Native build inputs and provenance candidate (source-only)

Source basis: `1a98e76ee941f902ea322a8d0e76749593bc873f`. This advances the
source foundation beyond the preceding stopping-boundary audit, not its trust
decisions. Its historical "no new schema" and untracked-lock findings describe
that earlier source, not a claim that the following candidate is authenticated.

The native [manifest](../../packages/FUSOU-TLSN-VERIFIER/Cargo.toml) now declares
an explicit standalone workspace/resolver and the existing formal CLI binary.
There is no ancestor Cargo workspace. The existing Cargo-generated
[lock](../../packages/FUSOU-TLSN-VERIFIER/Cargo.lock) belongs to this package;
only its ignore exception was added and its original bytes were retained
(SHA-256 hex `a23d6d3363b0e2c34fc244fb74f51dd87aca80d2a4f31e6f0e9ca833c4c9a21c`).
The authenticity-core and patched TLSN path dependencies retain their own
workspace boundaries. Cargo resolution/locked-build consistency and the
complete native input closure remain **NOT_CHECKED**.

The [candidate contract](../../scripts/release-native-build.mjs) provides:

- explicit package/bin/workspace, four tracked input byte descriptors and
  source-shape guards, not a Cargo resolver or complete native TCB inventory;
- an **UNAPPROVED** Rust `1.98.1`/Linux x86_64/release/default-feature recipe
  with `--locked`, explicit output directory and empty extra Rust flags;
- canonical candidate metadata binding executable SHA-256 hex/length/path,
  source repository/IDs/SHA, workflow path/revision, run/attempt, compiler
  observation, input/lock hashes and recipe/flags; these declarations are not
  authenticated build measurements;
- independent expected-context/input/recipe/compiler comparisons against raw
  binary/metadata bytes and a separately supplied normalized artifact origin
  (ID/name/archive digest/repository/workflow/run/attempt);
- a **MOCK_ONLY** normalized provenance interface requiring the SLSA v1
  predicate and both executable and metadata subjects to match the same
  expected context. It is not a parser for actual SLSA/`gh` output.

The archive digest (`sha256:` plus hex), executable hex subject, and
source-input base64url digests have separate meanings. Actual raw binary and
metadata subject hashes are recomputed, not taken as trust pins from the
metadata. Independent expectations must come from an approved consumer
policy/acquisition path, not this draft or its own build record. Currently
the candidate origin comparison authenticates neither GitHub metadata nor
downloaded artifact bytes. Even a consistent mock packet reports
`signature_verification`, `signer_authentication`,
`artifact_origin_authentication` and native cryptographic verification as
**UNVERIFIED**, `authenticated: false` and `BLOCKED_IMPLEMENTATION`.

The [workflow](../../.github/workflows/tlsn-native-build.yml) is a reusable
source candidate; **all three jobs have literal `if: ${{ false }}`**.
Its candidate implementation locator and future build source SHA are distinct,
full-SHA inputs, neither an approved signer pin. Existing checkout/setup-node/
github-script immutable action pins are reused. The user-supplied
`actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6` remains a candidate
reference only. Local action metadata was unavailable and `gh` was absent;
network access was prohibited. Accordingly no guessed action inputs, actual
attest step, write/OIDC permissions or `gh` options/output parser were added.
There is no workflow metadata capture/upload/attest connection. Preflight
always refuses build authorization, including if its draft fields are
self-declared approved. The attestation placeholder also fails explicitly.

The existing [consumer](../../scripts/release-consumer.mjs),
[checks](../../scripts/release-checks.mjs),
[collector](../../scripts/release-evidence-producer.mjs) and app/worker
transport proof roles are unchanged; no native success capability or
authenticated report is connected. Existing argv/input/raw-output/exit/evidence
correlation contracts are retained, but do not measure a real launched
executable. Key-free candidate tests are synthetic-byte/mock control-flow
checks, not actual attestation, native execution or TLSN verification.

Remaining approvals/registrations are the native source/build input closure,
repository/owner IDs, exact toolchain/target/flags, trusted workflow immutable
revision/isolation, verified action/API/permissions/eligibility, approved
attestation verifier/trust acquisition, artifact role/member/download proof
and executable launcher/measurement/producer report. The draft's recipe and
action digest do not grant any of them. Actual locked build, binary/compiler
measurement, artifact publication/reacquisition, attestation verification and
native execution require separately authorized observations.

`FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED` therefore remains maintained;
new granular preflight blockers include
`NATIVE_ARTIFACT_ACQUISITION_NOT_REGISTERED`,
`NATIVE_ATTESTATION_VERIFIER_NOT_REGISTERED` and
`NATIVE_LAUNCHER_NOT_IMPLEMENTED`. Delegation remains **PROPOSED**,
`DERIVED_NOT_AUTHORIZED`, both archive-grant registration blockers, four real
checks **UNVERIFIED**, `publication_authorized: false`, deployment
**NOT_CHECKED**, Production acceptance **BLOCKED**. No keys, new trust root,
issuer, grant, `--version`, APP process/image authority or browser integrity
guarantee is introduced.

## 2026-10-28 official gh native provenance adapter (source only)

Source basis: `ab2f35ba4781e8b544165ead911f927b3de9ee30`. This supersedes
the preceding source-availability findings only; the draft approval and
all native/grant/Production authority blockers remain unchanged.

Official JSON contracts are grounded in CLI commit
`94c5a6fa2781cb8d6391e032c1943aa98c5d64f7`
([command](https://github.com/cli/cli/blob/94c5a6fa2781cb8d6391e032c1943aa98c5d64f7/pkg/cmd/attestation/verify/verify.go),
[result](https://github.com/cli/cli/blob/94c5a6fa2781cb8d6391e032c1943aa98c5d64f7/pkg/cmd/attestation/verification/sigstore.go))
and Sigstore commit `ba85fa81ff9e14614e10d99eae43e8e59fc46531`
([result schema](https://github.com/sigstore/sigstore-go/blob/ba85fa81ff9e14614e10d99eae43e8e59fc46531/pkg/verify/signed_entity.go),
[extensions](https://github.com/sigstore/sigstore-go/blob/ba85fa81ff9e14614e10d99eae43e8e59fc46531/pkg/fulcio/certificate/extensions.go)).
Public source reads were permitted; no GitHub/attestation API was called.

The [adapter](../../scripts/release-native-attestation.mjs) accepts the
documented array of `attestation`/`verificationResult`, not invented
`verified`/`signatureVerified` flags. It uses the official media type and
requires an in-toto v1 statement, raw artifact SHA-256 subject, independent
SLSA predicate expectation, certificate and nonempty verified timestamps.
Certificate SAN, OIDC issuer, reusable signer URI/digest, separate build
config URI/digest, repository/owner URI/approved numeric IDs, source SHA/ref,
runner and run/attempt URI must match independent policy exactly.
`certificateIssuer` is an optional X.509 display value, not the OIDC issuer.
Optional `verifiedIdentity`/attestation bundle contents are not substituted
for these certificate checks. Unknown result fields/media types are rejected.
Multiple returned entries are conservatively blocked as ambiguous in this
candidate; it never silently chooses the first. Timestamps require exact
policy authorities, valid RFC3339 calendar dates and an independent time
window. The existing Result duplicate-key scanner is exported unchanged and
reused so pretty-printed JSON is allowed without accepting duplicate keys.

The consumer process boundary builds shell-free argv from independent policy,
not producer stdout or a bundle path. It captures stdout/stderr separately,
uses a bounded timeout/output size, blocks missing/unknown/unsupported gh,
nonzero/signal/failed/timeout execution and malformed/missing JSON, and
records only output digests rather than secret-bearing process text.
The consumer must select a trusted absolute gh path/raw-byte pin; an artifact
cannot supply the verifier. Both executable/artifact bytes are rechecked
after capture. A path/hash check alone is not a registered verifier delivery
or process-integrity contract. All capture results remain unauthenticated
until that separate authority boundary is implemented.

Following
[GHSA-4mq3-hpgx-9cx8](https://github.com/cli/cli/security/advisories/GHSA-4mq3-hpgx-9cx8),
stable gh 2.x >= 2.102.0 is required and source refs use case-sensitive exact
comparison independently of CLI exit success. Unknown future major/prerelease
versions require contract review; no version or offline-bundle fallback is
guessed. Official version formatting includes an optional matching release
URL; it is not incorrectly constrained to one output line.

The [consumer](../../scripts/release-consumer.mjs) now exports the native
candidate inspector from the existing build module. That inspector retains
byte/metadata/recipe/compiler/origin checks, requires certificate source/
signer/repository/run correspondence, independently captures verification
for binary and metadata, and rechecks input snapshots. It does not mint a
local or cross-run execution capability. Existing checks, execution intake,
app/worker transport roles and unconditional native collector blocker remain.

The fixed [action](https://github.com/actions/attest/tree/1e69f48acb82d1966a394da916b4c1698aa569d6)
documents standard SLSA generation without custom predicate inputs. The
disabled workflow now connects future tool observations, the existing v1
metadata (raw rustc/Cargo observations encoded in `compiler_identity`),
binary/metadata packaging, same-run artifact-ID download, data-only
readback, standard two-subject attestation and bundle packaging. Download
action `d3f86a106a0bac45b974a628896c90dbdf5c8093` is an additionally inspected,
immutable **UNAPPROVED candidate**; existing upload/checkout/Node/script pins
are reused. Only the signing job has `contents: read`, `id-token: write`,
`attestations: write`; storage records are disabled, with no artifact-metadata
write, Production publish or deploy permission.

All three literal false gates and the unconditional preflight refusal
remain. Source/certificate SHA disagreement stops metadata emission rather
than treating a checkout as certificate identity. The workflow revision in
metadata remains a declared policy expectation pending certificate matching.
Rust 1.98.1/Linux target/flags remain UNAPPROVED, not described as latest;
the reported newer Rust release does not justify an untested pin update.

Key-free fixtures model the official schema only; they are not actual gh
output, real signed bundles or successful TLSN verification. Pure parsing,
mock process success and unregistered process captures always return
`authenticated: false`; native cryptographic verification stays UNVERIFIED.
No actual build, gh artifact verification, attestation issuance/API,
native execution or Production operation occurred. Lock consistency, complete
input closure, registered repository/builder/verifier/acquisition policy and
formal launcher/report authentication remain unresolved.
`FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED`, delegation PROPOSED,
fixed-disabled reusable workflow, existing grant blockers, four real checks
UNVERIFIED, `publication_authorized: false`, deployment NOT_CHECKED and
Production acceptance BLOCKED are maintained.
