# FUSOU TLSN Canary External Input Intake Contract

Date: 2026-09-22

Baseline commit: `3fa5ee482350a06901a01d7b345fe44fb82e8ffd`

This document describes the existing Canary input path and the additional machine-readable contract in `packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/canary-external-input-intake.mjs`.

This is preparation only. It does not execute Canary, deploy a Worker, contact a target, access a secret provider, acquire credentials, or decrypt secrets.

## Authority and Scope

The repository source of truth remains:

- `packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/deployment-contract.mjs`
- `packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-inputs.json`
- `packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/canary-approved-input-contract.mjs`
- `packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/deployment-preflight.mjs`
- `packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/canary-readiness-test.mjs`
- `packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/canary-external-input-intake.mjs`

`canary-external-input-intake.mjs` must cover the union of the repository's canary deployment inputs, canary secret inputs, workflow evidence inputs, and readiness remote-validation inputs. The test command `pnpm run test:canary-input-intake` fails when that inventory drifts.

An approval record authorizes a target/configuration. It is not a trust root. Cryptographic authority remains in the approved trust registry, trust root, signed registries, verified TLSN presentation binding, and independent verifier result.

## Phase Boundary

There are two separate environments:

1. `DEPLOYMENT_PREFLIGHT`
   - Inputs consumed by `deployment-preflight.mjs` and `deploy-canary.mjs`.
   - Canary-owned private keys are passed only to the temporary Wrangler secrets file.
   - `REMOTE_VALIDATION_ONLY` inputs are removed before preflight and before any deploy child process.

2. `REMOTE_VALIDATION_ONLY`
   - Inputs consumed after deployment by `remote-validation.mjs` and `verify-remote-gate.mjs`.
   - Device access tokens and private keys never belong in deployment preflight or the deploy child environment.
   - A fixture JSON input can support a synthetic validation path but cannot establish real Canary readiness.

## Machine-Readable Operator Contract

Every entry in `CANARY_EXTERNAL_INPUT_INTAKE` has these fields:

| Field | Meaning |
|---|---|
| `name` | exact environment/input name |
| `purpose` | why the value exists in the Canary flow |
| `classification` | one of the ten repository-supported input classes |
| `required` / `required_group` | whether the value is required, including one-of alternatives |
| `exposure` / `secret` | `PUBLIC` or `SECRET`; sensitivity is separate from approval |
| `source` / `approval_provenance` | who supplies or authorizes the value and which contract section proves it |
| `format` / `canonicalization` / `fingerprint` | representation, normalization, and hash/key fingerprint rule |
| `validity_period` | lifetime or validity-window rule |
| `consumer` / `validator` | exact code boundary that consumes and checks it |
| `failure_conditions` / `readiness_effect` | non-success states and effect on readiness |
| `ownership` | who must supply, approve, derive, generate, or observe the input |
| `owner` / `generated_by` / `generation_stage` | accountable boundary and when the value can be produced |
| `can_generate_locally` / `can_generate_during_deployment` | whether FUSOU can produce the value without an external approval or post-deployment runtime |
| `external_dependency` | whether the value still depends on an external approval, credential provider, or remote party |

Public exposure does not mean approved. A syntactically valid Ed25519 public key, hostname, profile hash, device reference, or trust root is not an approved Canary identity until the corresponding external approval/provenance validator passes. Conversely, `TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER` uses the protected Wrangler input channel but is public certificate material, not a secret credential.

The approval provenance is intentionally split into independent records:

| Approval area | Required evidence | Repository validation |
|---|---|---|
| Target identity | `target_approval.target_identity`, hostname, approver, approval reference, expiry, and non-production flag | `assertTargetApproval`, target marker checks, current provenance checks |
| Profiles | complete/sparse canonical profile artifacts and their hashes | `profile-canonical-contract`, approved contract hash equality |
| Verifier identity | verifier key ID, SPKI, deployment ID, validity window, registry reference | `assertVerifier`, preflight key and deployment checks |
| Trust / Notary | trust-root fingerprint, canonical Notary registry fingerprint, Notary key ID, security registry-set hash | production trust contract, security-registry-set contract, preflight |
| Authentication | User A/device/Supabase references, credential policy, short-lived secret-provider references | approved contract authentication sections, remote validation |
| Binding | Canary binding identity, authority key ID, fixed binding, Replay identity separation | `assertBinding`, identity separation checks, preflight |
| Workflow | run ID, attempt, repository, workflow file identity, approval reference, current commit | `assertWorkflow`, workflow context, deployment attestation |

No single `approved=true` flag replaces these records.

## Ownership Boundary and Complete Matrix

`missing_required_inputs` is a count of missing contract fields plus any unmet one-of group. It is not a count of external approvals, external operators, or external packages. The ownership-aware dry-run report separates those concepts without changing the readiness gates.

The following matrix is the complete 68-entry inventory generated from `CANARY_EXTERNAL_INPUT_INTAKE`:

| Ownership | Boundary | Complete input names |
|---|---|---|
| `EXTERNAL_APPROVAL_REQUIRED` | External authority must approve or provide the identity, trust, authentication configuration, or binding reference. | `TLSN_CANDIDATE_SERVER_IDENTITY`, `TLSN_CANDIDATE_VERIFIER_KEY_ID`, `TLSN_CANARY_APPROVED_INPUT_CONTRACT_JSON`, `TLSN_PRODUCTION_NOTARY_REGISTRY`, `TLSN_CANDIDATE_NOTARY_KEY_ID`, `TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER`, `TLSN_CANARY_VERIFIER_PUBLIC_KEY_SPKI`, `TLSN_CANARY_VERIFIER_DEPLOYMENT_ID`, `TLSN_REMOTE_DEVICE_ID_A`, `TLSN_REMOTE_SUPABASE_URL`, `TLSN_REMOTE_SUPABASE_PUBLISHABLE_KEY`, `TLSN_CANARY_BINDING_IDENTITY` |
| `DERIVED` | FUSOU computes the value from approved external source material; the derived value is not itself an independent external approval. | `TLSN_CANDIDATE_PROFILE_SHA256`, `TLSN_CANDIDATE_SPARSE_PROFILE_SHA256`, `TLSN_SECURITY_REGISTRY_SET_SHA256`, `TLSN_CANDIDATE_DEVICE_AUTH_URL`, `TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL`, `TLSN_CANDIDATE_DEVICE_AUTH_ALLOWED_HOSTS`, `TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS`, `TLSN_CANDIDATE_SUPABASE_URL`, `TLSN_CANDIDATE_SUPABASE_PUBLISHABLE_KEY` |
| `SECRET_PROVIDER_REQUIRED` | An approved provider supplies the short-lived remote credential. These fields are remote-validation-only and are excluded from deployment preflight and deploy child environments. | `TLSN_REMOTE_ACCESS_TOKEN_A`, `TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_FILE`, `TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL` |
| `DEPLOYMENT_GENERATED` | FUSOU deployment/provisioning config or deployment policy supplies the value; no external approval is implied. | `TLSN_BINDING_TTL_SECONDS`, `TLSN_CANARY_DEPLOYMENT_ID`, `TLSN_CANARY_WORKER_NAME`, `TLSN_CANARY_TRIGGER_API_URL`, `TLSN_CANARY_TRIGGER_TASK_ID`, `TLSN_CANARY_WORKER_INTERNAL_URL` |
| `CANARY_GENERATED` | `provision-canary-material.mjs` generates the Canary authorities, registries, binding value, private keys, and callback secrets. | `TLSN_CANARY_BINDING_AUTHORITY_PUBLIC_KEY_SPKI`, `TLSN_CANARY_BINDING_AUTHORITY_KEY_ID`, `TLSN_CANARY_BINDING_AUTHORITY_KEY_REGISTRY`, `TLSN_CANARY_BINDING_VALUE`, `TLSN_CANARY_SESSION_AUTHORITY_PUBLIC_KEY_SPKI`, `TLSN_CANARY_SESSION_AUTHORITY_KEY_ID`, `TLSN_CANARY_SESSION_AUTHORITY_KEY_REGISTRY`, `TLSN_CANARY_RESULT_PUBLIC_KEY_SPKI`, `TLSN_CANARY_RESULT_SIGNER_KEY_ID`, `TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY`, `TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE`, `TLSN_CANARY_RESULT_REGISTRY_ROOT_KEY_ID`, `TLSN_CANARY_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI`, `TLSN_CANARY_RESULT_SIGNING_PRIVATE_KEY_PKCS8`, `TLSN_CANARY_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8`, `TLSN_CANARY_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8`, `TLSN_CANARY_TRIGGER_SECRET_KEY`, `TLSN_CANARY_TRIGGER_CALLBACK_SECRET`, `TLSN_CANARY_DIRECT_CALLBACK_SECRET` |
| `WORKFLOW_CONTEXT_REQUIRED` | The approved FUSOU workflow supplies run identity, role, repository, workflow identity, and checked-out commit context. | `TLSN_WORKFLOW_RUN_ID`, `TLSN_WORKFLOW_RUN_ATTEMPT`, `TLSN_REPOSITORY`, `TLSN_WORKFLOW_FILE_IDENTITY`, `TLSN_ENVIRONMENT`, `TLSN_DEPLOYMENT_ROLE`, `TLSN_GIT_COMMIT_SHA` |
| `REMOTE_VALIDATION_ONLY` | FUSOU produces or records these paths/URLs after deployment for remote validation and evidence. They cannot satisfy pre-deployment readiness. | `TLSN_REMOTE_REPORT_PATH`, `TLSN_REMOTE_VALIDATION_REPORT_PATH`, `TLSN_PROVENANCE_REPORT_PATH`, `TLSN_REMOTE_ATTESTATION_PATH`, `TLSN_REMOTE_ATTESTATION_OUTPUT_PATH`, `TLSN_REMOTE_WORKER_URL`, `TLSN_REMOTE_WEB_ORIGIN`, `TLSN_REMOTE_EXPECTED_PROVENANCE_JSON` |
| `REPOSITORY_STATIC` | Repository policy or explicit mode configuration; not external approval. | `TLSN_CANARY_FIXTURE_ONLY`, `TLSN_CANARY_SYNCHRONOUS_RESPONSE_ENABLED`, `TLSN_BENCHMARK_TIMINGS` |
| `FIXTURE_ONLY` | Synthetic fixture harness only; never accepted as real Canary evidence. | `TLSN_REMOTE_FIXTURE_JSON` |

`EXTERNAL_REQUIRED` and `HISTORICAL_ONLY` are reserved ownership classes in the schema and have no current entries. `TARGET_RUNTIME` is also reserved for values observed only by the deployed Worker. A value can be `DERIVED` and still have `external_dependency=true`: this is the explicit distinction between “FUSOU computes it” and “FUSOU is authorized to invent it.”

### Minimum External Package

The minimum package that must come from outside the FUSOU generator consists of:

- An unexpired, non-fixture target approval and provenance record, including target identity and scope.
- Canonical complete and sparse profile artifacts, or an approved source that yields their hashes; FUSOU computes and checks the two profile hash fields.
- Approved trust material: trust-root certificate/fingerprint, canonical Notary registry, Notary key ID, and verifier key/deployment identity.
- Approved authentication configuration: candidate device-auth and Supabase policy inputs, plus the approved remote device identity.
- An approved Canary binding identity, distinct from Replay identities.
- A secret-provider reference for the short-lived remote token and exactly one device private-key representation. These are required for later remote validation, not deployment preflight, and their values must never be recorded in the package.

### Machine-Verifiable External Package

The operator handoff is a directory whose manifest is selected with `TLSN_CANARY_EXTERNAL_PACKAGE_MANIFEST`. The offline validator is:

```text
pnpm run check:canary-external-package
```

The package layout is fixed:

```text
canary-external-package/
   manifest.json
   artifacts/
      target-approval.json
      complete-profile.json
      sparse-profile.json
      notary-registry.json
      trust-root.json
      verifier-identity.json
      authentication-policy.json
      binding-approval.json
```

`manifest.json` has `schema_version=1` and `scope=tlsn-canary-external-input-package`. Its required top-level sections are `target`, `workflow`, `inputs`, `artifacts`, and `secret_provider`:

```json
{
   "schema_version": 1,
   "scope": "tlsn-canary-external-input-package",
   "package_id": "approval-package-YYYY-MM-DD",
   "issued_at": "2026-09-22T00:00:00.000Z",
   "expires_at": "2026-09-23T00:00:00.000Z",
   "target": {
      "server_identity": "approved.example.com",
      "environment": "production",
      "deployment_role": "canary",
      "binding_identity": "approved-canary-binding"
   },
   "workflow": {
      "repository": "owner/repository",
      "run_id": "12345",
      "run_attempt": "1",
      "workflow_file_identity": "dotenvx+pnpm+wrangler",
      "commit_sha": "40-character-current-commit-sha"
   },
   "inputs": [
      {
         "name": "TLSN_CANDIDATE_SERVER_IDENTITY",
         "value_sha256": "43-character-unpadded-base64url-sha256",
         "approval_reference": "approval/target-2026-09-22",
         "provenance_reference": "provenance/target-2026-09-22",
         "evidence_level": "AUTHORITY_SIGNED"
      }
   ],
   "artifacts": [
      {
         "name": "target-approval",
         "path": "artifacts/target-approval.json",
         "sha256": "43-character-unpadded-base64url-sha256",
         "current": true,
         "fixture_only": false,
         "historical": false
      }
   ],
   "secret_provider": {
      "access_token": {
         "input_name": "TLSN_REMOTE_ACCESS_TOKEN_A",
         "provider_ref": "secret-provider/user-a/access-token",
         "issued_at": "2026-09-22T00:00:00.000Z",
         "expires_at": "2026-09-22T01:00:00.000Z"
      },
      "private_key": {
         "selected_input_name": "TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL",
         "provider_ref": "secret-provider/user-a/device-key-b64url",
         "issued_at": "2026-09-22T00:00:00.000Z",
         "expires_at": "2026-09-22T01:00:00.000Z"
      }
   }
}
```

The real manifest contains all 21 public external package inputs, all eight current artifact records, and the two secret-provider references. Public input fingerprints use trimmed UTF-8, canonical JSON for the approved contract and Notary registry, and decoded DER bytes for the trust root. The validator compares these fingerprints with the current environment, verifies every artifact hash beneath the package directory, checks target/environment/role/binding/workflow/current HEAD, rejects expired or fixture/historical records, and rejects both private-key representations being present. The access token, private key, bearer material, and callback secrets are never accepted as manifest fields.

`AUTHORITY_SIGNED`, `AUTHORITY_ATTESTED`, and `OPERATOR_APPROVED` are the allowed evidence levels. An `approved=true` flag, hostname-only metadata, an R2/archive copy, a deployment response, a fixture, a historical report, or a remote-test report is not an acceptable substitute for the required approval/provenance records.

The workflow run context and deployment naming/Trigger configuration are FUSOU-owned execution inputs, not external approval evidence. Remote reports, attestations, and runtime URLs are produced or selected after the deployment boundary and are not part of the minimum pre-deployment approval package.

### FUSOU-Generated Package

FUSOU may produce/configure the following after the external package is accepted:

- Derived profile, security-registry, authentication endpoint, and allowlist values (`DERIVED`).
- Canary Result, Session Authority, and Binding Authority key pairs, public registries, signed registry envelope, binding value, and callback/Trigger secrets (`CANARY_GENERATED`).
- Deployment ID, Worker/Trigger URLs and task identity, and deployment policy values (`DEPLOYMENT_GENERATED`).
- Workflow context bound to the checked-out HEAD (`WORKFLOW_CONTEXT_REQUIRED`) and repository-static flags (`REPOSITORY_STATIC`).
- Post-deployment report paths, provenance, attestation paths, and remote validation URLs (`REMOTE_VALIDATION_ONLY`).

Generated key material, derived hashes, and deployment configuration do not constitute external approval. The provisioner must leave unresolved external target, trust, profile, verifier, authentication, and binding approvals unresolved rather than fabricate them.

For the current empty local environment, the dry-run reports `68` inventory entries, `66` missing contract fields, `22` missing external-dependency fields, and `1` unmet external one-of group. The 22 external dependencies comprise the 21 public package inputs and the separately required remote access-token secret-provider input. It also reports `32` locally generable missing fields. These numbers explain why raw `missing=66` must not be interpreted as “66 external approvals required.”

## Intake Dry-Run

The non-network operator check is:

```text
pnpm run check:canary-input-intake
```

It validates the inventory itself, reports every input as `PRESENT`, `ABSENT`, or `INVALID`, detects unexpected Canary-shaped environment names, checks basic canonical formats without printing values, checks artifact path presence, and validates `TLSN_CANARY_APPROVED_INPUT_CONTRACT_JSON` with the existing strict validator when present. It reports `APPROVED` only when that validator passes. It never generates keys, tokens, callback secrets, approvals, or provenance.

The JSON report also includes `ownership_summary`. Its `missing_contract_entry_count` preserves the raw contract-field count; `external_dependency_missing_count` and `unmet_external_required_group_count` identify the external boundary; `locally_generable_missing_count` identifies values FUSOU can produce/configure. Per-ownership buckets include present/absent, required, approval, external-dependency, local-generation, and deployment-generation counts.

The default command exits successfully when the check ran, even when readiness is `BLOCKED`, so an operator can inspect the complete missing-input report. Use the completeness gate only after the secure environment has been populated:

```text
node scripts/canary-external-input-dry-run.mjs --require-complete
```

`--require-complete` fails on missing required inputs or invalid/unexpected inputs. Neither command performs network access, deployment, runtime validation, or secret-provider access. The next machine gate is `pnpm run test:canary-readiness`.

## External Input Checklist

The following names are the complete machine-checked intake inventory. Values are intentionally omitted.

| Category and input names | Source | Representation | Secret | Approval / validation | Consumer | Failure states |
|---|---|---|---|---|---|---|
| `TLSN_CANDIDATE_SERVER_IDENTITY` | `EXTERNAL_APPROVAL` | DNS hostname; TLSN server identity, not a network destination | No | Real target approval; must not be fixture, synthetic, historical, local, staging, or production-marked | preflight, approved-input contract, profile contract | missing, invalid, mismatched, fixture, historical |
| `TLSN_CANDIDATE_PROFILE_SHA256`, `TLSN_CANDIDATE_SPARSE_PROFILE_SHA256` | `EXTERNAL_APPROVAL` | 43-character base64url SHA-256 digests of canonical UTF-8 JSON | No | Approved complete and sparse profiles; canonical profile contract | provisioner, preflight, approved-input contract | missing, invalid, mismatched, fixture, historical |
| `TLSN_CANDIDATE_VERIFIER_KEY_ID` | `EXTERNAL_APPROVAL` | verifier key ID | No | Must match approved input and verifier metadata | preflight, approved-input contract | missing, invalid, mismatched, historical |
| `TLSN_CANARY_APPROVED_INPUT_CONTRACT_JSON` | `EXTERNAL_APPROVAL` | strict JSON; metadata and references only, no secret values | No | `assertCanaryApprovedInputContract` | preflight, approved-input contract | missing, invalid, expired, mismatched, historical |
| `TLSN_PRODUCTION_NOTARY_REGISTRY` | `EXTERNAL_APPROVAL` | canonical Notary registry JSON | No | Notary registry must contain the approved key ID | trust contract, security registry contract, preflight | missing, invalid, mismatched, fixture, historical |
| `TLSN_CANDIDATE_NOTARY_KEY_ID` | `EXTERNAL_APPROVAL` | Notary key ID | No | Must be present in the approved registry | trust contract, preflight | missing, invalid, mismatched |
| `TLSN_SECURITY_REGISTRY_SET_SHA256` | `EXTERNAL_APPROVAL` derived from supplied inputs | canonical base64url SHA-256 digest | No | Derived from Notary key ID, registry, both profile hashes, and target identity | security registry contract, preflight | missing, invalid, mismatched |
| `TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER` | `EXTERNAL_APPROVAL` | DER certificate encoded as canonical base64url | No; protected input channel | External target trust; hash is bound into deployment identity | preflight, Worker runtime | missing, invalid, mismatched, fixture, historical |
| `TLSN_CANARY_VERIFIER_PUBLIC_KEY_SPKI`, `TLSN_CANARY_VERIFIER_DEPLOYMENT_ID` | `EXTERNAL_APPROVAL` / current verifier metadata | Ed25519 SPKI base64url and deployment ID | No | Must match approved verifier identity and validity window | preflight, approved-input contract, verifier deployment | missing, invalid, expired, mismatched, historical |
| `TLSN_CANDIDATE_DEVICE_AUTH_URL`, `TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL` | `EXTERNAL_APPROVAL` | clean HTTPS URLs with exact repository API paths | No | Host must be in the approved allowlist; no credentials, port, query, or fragment | preflight, remote validation | missing, invalid, mismatched, fixture |
| `TLSN_CANDIDATE_DEVICE_AUTH_ALLOWED_HOSTS`, `TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS` | `EXTERNAL_APPROVAL` | comma-separated DNS hostname allowlists | No | Clean hostname syntax and URL host membership | preflight | missing, invalid, mismatched |
| `TLSN_CANDIDATE_SUPABASE_URL`, `TLSN_CANDIDATE_SUPABASE_PUBLISHABLE_KEY` | `EXTERNAL_APPROVAL` | clean HTTPS origin and publishable key | No | Candidate auth configuration; service-role keys are forbidden | preflight, remote validation | missing, invalid, mismatched, fixture |
| `TLSN_REMOTE_DEVICE_ID_A` | `EXTERNAL_APPROVAL` | device reference | No | Must correspond to the approved short-lived credential set | remote validation | missing, invalid, mismatched |
| `TLSN_REMOTE_ACCESS_TOKEN_A` | `SECRET_PROVIDER` | short-lived access token | Yes | Approved User A/device credential; never recorded in evidence or repository | remote validation only | missing, invalid, expired, mismatched |
| `TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_FILE` or `TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL` | `SECRET_PROVIDER` | Ed25519 PKCS8 file path or canonical base64url; exactly one representation is required | Yes | Must match the approved device identity; remote validation only | remote validation only | missing, invalid, expired, mismatched |
| `TLSN_REMOTE_SUPABASE_URL`, `TLSN_REMOTE_SUPABASE_PUBLISHABLE_KEY` | `EXTERNAL_APPROVAL` | clean HTTPS origin and publishable key | No | Remote User A validation configuration | remote validation only | missing, invalid, mismatched, fixture |
| `TLSN_ENVIRONMENT` | `WORKFLOW_CONTEXT` | exactly `production` for the current deployment contract | No | preflight role/environment check | preflight, deploy-canary | missing, invalid, mismatched |
| `TLSN_DEPLOYMENT_ROLE` | `WORKFLOW_CONTEXT` | exactly `canary` | No | role isolation and forbidden-input check | preflight, deploy-canary | missing, invalid, mismatched |
| `TLSN_GIT_COMMIT_SHA` | `WORKFLOW_CONTEXT` | current 40-character checked-out Git SHA | No | must equal checked-out HEAD | preflight, deploy-canary, attestation | missing, invalid, mismatched, historical |
| `TLSN_CANARY_DEPLOYMENT_ID`, `TLSN_CANARY_WORKER_NAME` | `WORKFLOW_CONTEXT` / explicit deployment input | deployment ID and non-production Worker name | No | deployment identity and current commit | preflight, deploy-canary | missing, invalid, mismatched, historical |
| `TLSN_CANARY_TRIGGER_API_URL`, `TLSN_CANARY_TRIGGER_TASK_ID`, `TLSN_CANARY_WORKER_INTERNAL_URL` | `WORKFLOW_CONTEXT` | clean HTTPS origins and Trigger task ID | No | clean URL and task ID checks | preflight, deploy-canary | missing, invalid, mismatched |
| `TLSN_CANARY_SESSION_AUTHORITY_PUBLIC_KEY_SPKI`, `TLSN_CANARY_SESSION_AUTHORITY_KEY_ID`, `TLSN_CANARY_SESSION_AUTHORITY_KEY_REGISTRY` | `CANARY_GENERATED` | Ed25519 public key and authority registry metadata | No | Generated by `provision-canary-material`; registry must match key | preflight, Worker runtime | missing, invalid, mismatched, Replay identity reuse |
| `TLSN_CANARY_BINDING_AUTHORITY_PUBLIC_KEY_SPKI`, `TLSN_CANARY_BINDING_AUTHORITY_KEY_ID`, `TLSN_CANARY_BINDING_AUTHORITY_KEY_REGISTRY` | `CANARY_GENERATED` | Ed25519 public key and authority registry metadata | No | Generated by `provision-canary-material`; must be Canary-specific | preflight, binding authority | missing, invalid, mismatched, Replay identity reuse |
| `TLSN_CANARY_BINDING_IDENTITY` | `EXTERNAL_APPROVAL` | binding identity reference | No | Must match approved contract and differ from Replay identity | preflight, approved-input contract | missing, invalid, mismatched, Replay binding reuse |
| `TLSN_CANARY_BINDING_VALUE` | `CANARY_GENERATED` | per-provisioning base64url-safe binding value | No | Must not collide with fixed binding ID or Replay binding | preflight, binding authority | missing, invalid, mismatched, Replay binding reuse |
| `TLSN_BINDING_TTL_SECONDS` | `DEPLOYMENT_GENERATED` deployment policy | integer from 1 through 3600 | No | FUSOU deployment policy and preflight range check | preflight, binding authority | missing, invalid |
| `TLSN_CANARY_RESULT_PUBLIC_KEY_SPKI`, `TLSN_CANARY_RESULT_SIGNER_KEY_ID`, `TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY`, `TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE`, `TLSN_CANARY_RESULT_REGISTRY_ROOT_KEY_ID`, `TLSN_CANARY_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI` | `CANARY_GENERATED` | Ed25519 public keys, key IDs, registry JSON, signed envelope | No | signing-key registry and signed-envelope validation | preflight, Worker runtime, result verification | missing, invalid, mismatched, Replay identity reuse |
| `TLSN_CANARY_RESULT_SIGNING_PRIVATE_KEY_PKCS8`, `TLSN_CANARY_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8`, `TLSN_CANARY_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8` | `CANARY_GENERATED` | canonical base64url Ed25519 PKCS8 private keys | Yes | Generated by provisioner; public-key derivation must match | deploy-canary via temporary Wrangler secrets file | missing, invalid, mismatched, Replay identity reuse |
| `TLSN_CANARY_TRIGGER_SECRET_KEY`, `TLSN_CANARY_TRIGGER_CALLBACK_SECRET`, `TLSN_CANARY_DIRECT_CALLBACK_SECRET` | `CANARY_GENERATED` | random secret references/values in secure deployment environment | Yes | generated per provisioning; role-separated | deploy-canary via temporary Wrangler secrets file | missing, invalid, Replay identity reuse |
| `TLSN_CANARY_FIXTURE_ONLY`, `TLSN_CANARY_SYNCHRONOUS_RESPONSE_ENABLED`, `TLSN_BENCHMARK_TIMINGS` | `REPOSITORY_STATIC` / explicit mode | boolean/capability flags | No | fixture mode must be false for real readiness; sync flag must be explicit | preflight, approved-input contract | missing, invalid, fixture-only |
| `TLSN_WORKFLOW_RUN_ID`, `TLSN_WORKFLOW_RUN_ATTEMPT`, `TLSN_REPOSITORY`, `TLSN_WORKFLOW_FILE_IDENTITY` | `WORKFLOW_CONTEXT` | positive IDs, owner/name repository, `dotenvx+pnpm+wrangler` | No | `workflowContextFromEnvironment` and current HEAD comparison | preflight, approved-input contract, attestation | missing, invalid, mismatched, historical |
| `TLSN_REMOTE_WORKER_URL`, `TLSN_REMOTE_WEB_ORIGIN` | `DEPLOYMENT_GENERATED` | clean HTTPS origins | No | remote validation target and origin checks | remote validation only | missing, invalid, mismatched |
| `TLSN_REMOTE_EXPECTED_PROVENANCE_JSON` | `DEPLOYMENT_GENERATED` | path to the current canary provenance JSON | No | schema/status/role/current commit and identity checks | remote validation and gate | missing, invalid, expired, mismatched, historical |
| `TLSN_REMOTE_FIXTURE_JSON` | `FIXTURE_ONLY` | synthetic fixture JSON path | No | synthetic validation only; never a real target authority | remote validation only | missing, fixture-only |
| `TLSN_REMOTE_REPORT_PATH`, `TLSN_REMOTE_VALIDATION_REPORT_PATH`, `TLSN_PROVENANCE_REPORT_PATH` | `DEPLOYMENT_GENERATED` | paths to JSON reports | No | report identity, status, commit, and validation window | verify-remote-gate | missing, invalid, expired, mismatched, historical |
| `TLSN_REMOTE_ATTESTATION_PATH`, `TLSN_REMOTE_ATTESTATION_OUTPUT_PATH` | `DEPLOYMENT_GENERATED` | input/output path for signed remote attestation | No | signed attestation freshness and identity checks | verify-remote-gate | missing, invalid, expired, mismatched |

## Artifact Checklist

| Artifact | Required state before real readiness | Current repository state |
|---|---|---|
| `scripts/production-inputs.json` | `CURRENT` repository-static manifest | `CURRENT` |
| target approval record in `TLSN_CANARY_APPROVED_INPUT_CONTRACT_JSON` | `CURRENT`, externally approved, non-fixture, unexpired | `MISSING` |
| canonical complete and sparse target profiles | `CURRENT`, externally supplied and hash-matched | `MISSING`; repository profiles are fixture-only unless explicitly supplied as external artifacts |
| target provenance referenced by the approval record | `CURRENT`, externally approved and hash-matched | `MISSING` |
| Notary registry and target trust root | `CURRENT`, externally approved, hash-matched | `MISSING` |
| current verifier metadata | `CURRENT`, externally approved and validity-window checked | `MISSING` |
| workflow provenance | `CURRENT`, generated by the approved workflow and bound to current HEAD | `MISSING` |
| Canary-owned result/session/binding authority public registries | `CANARY_GENERATED`, generated for this deployment | `MISSING` until provisioning is intentionally run |
| Canary-owned private keys and callback secrets | transient secure deployment inputs; never repository or evidence artifacts | `MISSING` |
| remote validation report and attestation | `CURRENT`, generated only after the corresponding runtime validation | `MISSING` |
| repository benchmark fixtures | `FIXTURE_ONLY` | present only as synthetic test material; cannot satisfy real readiness |
| artifacts from another commit or prior deployment | `HISTORICAL` | rejected by commit and identity checks |

## Secret Intake

The repository does not call a secret provider itself. The operator must materialize references/values through the approved secure deployment environment. The code expects environment variables for preflight and deploy, and `deploy-canary.mjs` passes only role-approved non-secret variables as `--var` values.

Canary-owned secret names:

- `TLSN_CANARY_RESULT_SIGNING_PRIVATE_KEY_PKCS8`
- `TLSN_CANARY_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8`
- `TLSN_CANARY_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8`
- `TLSN_CANARY_TRIGGER_SECRET_KEY`
- `TLSN_CANARY_TRIGGER_CALLBACK_SECRET`
- `TLSN_CANARY_DIRECT_CALLBACK_SECRET`

Remote-validation-only secret names:

- `TLSN_REMOTE_ACCESS_TOKEN_A`
- `TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_FILE` or `TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL`

`TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER` is public certificate material, not a secret. The existing deployment contract transports it through the protected Wrangler secrets-file channel, so it must still be supplied to preflight through that channel without being treated as a credential.

`deploy-canary.mjs` writes the Canary-owned secret values to a temporary mode `0600` Wrangler secrets file and removes that directory in `finally`. The provisioner also writes generated private material to its output directory with mode `0600`; that directory is operator-managed temporary material and must not be committed. Secret values are never written to approval, provenance, evidence, or report JSON.

## Readiness Mapping

`canary-readiness-test.mjs` computes these gates without network access:

| Gate | Required input | Validation | Current state |
|---|---|---|---|
| `current_head` | checked-out Git HEAD | 40-character SHA | valid for current checkout |
| `contract` | `scripts/production-inputs.json` | `assertManifest` | valid |
| `deployment_contract` | role, environment, commit, URLs, registries, keys, secrets | `deployment-preflight` rules | blocked by missing external inputs |
| `approved_input_contract` | approved JSON plus verifier/deployment metadata | `assertCanaryApprovedInputContract` | `MISSING` |
| `target_provenance` | approved real target and current provenance artifact | approval plus current non-fixture artifact | blocked |
| `trust_material` | trust root, Notary registry, registry-set hash, authority registries | preflight and trust contracts | `MISSING` |
| `authentication` | approved endpoints, User A credential, device ID/key, remote validation references | auth input checks and remote validation | `MISSING` |
| `binding` | Canary binding identity/value and binding authority | strict binding contract and Replay separation | `MISSING` |
| `workflow_provenance` | workflow IDs, repository, workflow identity, current SHA | `workflowContextFromEnvironment` | `MISSING` |
| `runtime_inputs` | Canary deployment/Trigger/runtime inputs | role-specific manifest and preflight | `MISSING` |
| `identity_separation` | absence of Replay/production/test inputs | forbidden input set | valid when forbidden names are absent |
| `fixture_contamination_absent` | real non-fixture target and artifacts | fixture/synthetic/historical rejection | blocked until external target inputs exist |

The readiness report now includes `input_diagnostics`, one entry per inventory input. It reports only metadata and one of `MISSING`, `PRESENT_INVALID`, `PRESENT_MISMATCHED`, `PRESENT_UNVERIFIED`, `VALID`, `FIXTURE_ONLY`, or `NOT_REQUIRED` for the alternate device-key representation.

The current repository state is `BLOCKED` because these independent conditions are absent: external target approval/provenance, approved profile hashes/artifacts, trust root and Notary approval, verifier approval, approved authentication/device references and remote credentials, Canary binding material, current workflow provenance, generated Canary runtime material, and post-validation provenance/report/attestation artifacts. Repository fixtures and historical artifacts do not satisfy any of these conditions.

## Operator Handoff Checklist

Complete these checks in order. A checked item means the named validator has passed, not merely that a value exists.

- [ ] Target identity approval obtained: `TLSN_CANDIDATE_SERVER_IDENTITY` and `target_approval`, checked by `assertTargetApproval` and preflight.
- [ ] Target provenance obtained: `target_approval.provenance` with current artifact hash and scope, checked by the approved-input contract.
- [ ] Complete and sparse profiles supplied: `TLSN_CANDIDATE_PROFILE_SHA256` and `TLSN_CANDIDATE_SPARSE_PROFILE_SHA256`, checked by `profile-canonical-contract`.
- [ ] Profile hashes verified against the approved record and current target identity.
- [ ] Trust root approved: `TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER` and its approved SHA-256 fingerprint, checked by preflight.
- [ ] Notary registry approved: `TLSN_PRODUCTION_NOTARY_REGISTRY`, `TLSN_CANDIDATE_NOTARY_KEY_ID`, and registry fingerprint, checked by the trust and security-registry contracts.
- [ ] Verifier identity approved: `TLSN_CANDIDATE_VERIFIER_KEY_ID`, `TLSN_CANARY_VERIFIER_PUBLIC_KEY_SPKI`, and deployment ID, checked by `assertVerifier`.
- [ ] Device/User identity approved: `TLSN_REMOTE_DEVICE_ID_A` plus approved authentication and credential-policy references.
- [ ] Authentication material provisioned: remote token and exactly one device private-key representation in the approved secret provider; values remain unprinted.
- [ ] Canary binding approved: `TLSN_CANARY_BINDING_IDENTITY` and generated authority/value material differ from Replay.
- [ ] Workflow provenance obtained: run ID, attempt, repository, workflow identity, approval reference, and current HEAD.
- [ ] Current provenance artifact obtained: `TLSN_REMOTE_EXPECTED_PROVENANCE_JSON` matches current commit, role, deployment identity, and target.
- [ ] All approval and credential validity windows checked by the approved-input contract and preflight.
- [ ] No fixture contamination: `game.example.test`, fixture providers, and synthetic records are rejected for real mode.
- [ ] No historical evidence reuse: commit-bound artifacts from another HEAD are rejected.
- [ ] No Remote validation input contamination: remote-only secrets are absent from deploy preflight and child environments.
- [ ] Intake validation PASS: `pnpm run check:canary-input-intake -- --require-complete`.
- [ ] Canary readiness READY: `pnpm run test:canary-readiness`, with every gate true and no `input_diagnostics` failure.

Only after every item above is independently satisfied may a separately authorized operator decision consider Canary runtime validation. This checklist does not authorize deployment or runtime execution.

## Operator Procedure

Do not deploy from this procedure.

1. Obtain an externally approved target identity and target provenance record. Confirm it is current, non-fixture, non-historical, and explicitly scoped to Canary.
2. Obtain canonical complete and sparse profile artifacts and independently record their profile-contract hashes.
3. Obtain the approved trust root, Notary registry/key ID, security registry-set hash, and current verifier key/deployment metadata.
4. Obtain approved short-lived authentication references. Put access tokens and device private keys only in the configured secret provider or secure runtime environment.
5. Obtain a Canary-specific binding identity. Keep Replay binding identity, Replay trust identity, and Replay credentials separate.
6. Obtain workflow provenance for the current commit: positive run ID/attempt, repository owner/name, and `TLSN_WORKFLOW_FILE_IDENTITY=dotenvx+pnpm+wrangler`.
7. Run the provisioner only with explicit real external inputs. For real mode, use `--fixture-only false`, `--server-identity`, `--profile-file`, `--sparse-profile-file`, `--trust-root-file`, `--notary-registry-file`, `--notary-key-id`, `--verifier-key-id`, `--deployment-id`, and `--worker-name`. The provisioner must leave unresolved external values unresolved rather than inventing them.
8. Materialize only the required deployment inputs and Canary-owned secrets through the secure environment. Keep remote-validation-only secrets out of the deployment environment passed to preflight.
9. Run `pnpm run test:canary-input-intake` to detect inventory drift.
10. Run `pnpm run check:canary-input-intake -- --require-complete` and inspect the value-free JSON report.
11. Run `pnpm run test:canary-readiness` and inspect the JSON `input_diagnostics` and `gates`. The expected state remains `BLOCKED` until all external inputs are valid.
12. Run `pnpm run preflight:production` with `TLSN_DEPLOYMENT_ROLE=canary` and the current commit. Inspect the non-secret report and provenance output. Do not proceed when any failure is present.
13. Stop for a separate authorized deployment decision. This document does not authorize or instruct Canary deployment.

## Security Conclusions

- Replay verification, callback security, stale callback rejection, duplicate callback idempotency, R2 authority separation, and Replay/Canary identity separation were not changed by this intake work.
- Fixture-only provisioning remains network-isolated and cannot satisfy real Canary target approval.
- Approval metadata is not treated as a trust root.
- Remote-validation credentials are phase-separated from deployment preflight and deploy child processes.
- Secret values are not stored in repository configuration, approval artifacts, provenance artifacts, evidence artifacts, or logs. Temporary secure files are created only where the existing deployment flow requires them and are cleaned up by that flow.
- Canary runtime was not executed and no deployment was performed.

Current expected state:

```text
CANARY RUNTIME: NOT EXECUTED
CANARY READINESS: BLOCKED
```
