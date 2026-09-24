# FUSOU TLSN Canary Readiness Audit

Date: 2026-09-22

## Current Architecture Status

This audit predates the removal of External Authority / External Package deployment governance. The current readiness boundary uses `TLSN_CANARY_DEPLOYMENT_MANIFEST` and repository-controlled deployment preconditions. Readiness must verify the manifest's target, workflow/current HEAD, non-secret input fingerprints, artifact hashes, deployment identity, validity window, and secret-provider references, followed by the existing cryptographic and role-isolation preflight checks.

The following remain trust requirements: TLSN presentation verification, canonical profiles, Notary/trust-root configuration, independent verifier identity, signed Result registry envelope, Session/Binding Authority registries, binding identity, runtime/deployment attestation, evidence persistence, and secret-value exclusion. The following are not current gates: External Authority approval, `target_approval`, `TLSN_CANARY_APPROVED_INPUT_CONTRACT_JSON`, accepted-package promotion, or self-approval semantics.

Current local result: `CANARY READINESS: BLOCKED`, `CANARY RUNTIME: NOT EXECUTED`, `REAL CANARY: NOT EXECUTED`. The historical tables below are retained for audit lineage and are not an instruction to create an External Package.

## Decision

- HEAD: `87d6eb674a52faea41e78f6f32fff8ed24bbe8be`
- Branch: `tlsn-phase0-investigation`
- Canary runtime: **NOT EXECUTED** by this audit
- Production endpoint access: **NOT USED**
- Production credentials: **NOT USED**
- Canary deployment: **NOT EXECUTED**
- Readiness: **BLOCKED**

The repository has a complete local contract for provisioning and preflight, but it does not currently have an approved non-fixture target, trust chain, authentication set, workflow provenance, or current approved Canary provenance artifact.

## Existing Contracts

The controlling implementations are:

- `scripts/deployment-contract.mjs`: role-specific inputs, secrets, forbidden inputs, and identity field sets.
- `scripts/production-inputs.json`: canonical profile and security-registry contracts.
- `scripts/deployment-preflight.mjs`: fail-closed format, hash, registry, key, URL, workflow, and role checks.
- `scripts/canary-approved-input-contract.mjs`: machine-readable approved target, verifier, credential-lifetime, authentication, binding, workflow, identity-separation, and evidence-authority contract.
- `scripts/canary-approved-input-contract-test.mjs`: offline approved/fixture-only and invalid-contract cases.
- `scripts/provision-canary-material.mjs`: locally generates only Canary authority material; it never invents production-bound target identity, profiles, trust root, Notary registry, or workflow values.
- `scripts/deploy-canary.mjs`: clean-worktree guard, current-HEAD guard, preflight, WASM build, bootstrap -> verifier -> main deployment, and temporary mode-600 secret handling.
- `scripts/remote-validation.mjs`: authenticated remote validation and full Result verification. It requires a production Canary provenance manifest and real User A/device material.
- `scripts/verify-remote-gate.mjs`: current `/health`, remote report, provenance, identity comparison, and signed remote-attestation gate.
- `wrangler.toml`, `wrangler.canary-bootstrap.toml`, and `wrangler.verifier-canary.toml`: isolated Canary Worker, Durable Object, R2, and verifier service topology.

There is no repository workflow under `.github/workflows` that supplies the TLSN Canary workflow context. The workflow context is therefore an external approved execution input, not something this repository can infer.

## Target Provenance

| Input or artifact | Required | Source | Current availability | Classification | Security significance |
|---|---:|---|---|---|---|
| `TLSN_CANDIDATE_SERVER_IDENTITY` | Yes | Explicit externally approved candidate target identity | Only `game.example.test` is present in fixture artifacts | Fixture-only; production value missing | Binds the TLSN Presentation server identity; hostname metadata alone is insufficient |
| Complete canonical profile and `TLSN_CANDIDATE_PROFILE_SHA256` | Yes | Explicit candidate profile file, canonicalized by `profile-canonical-contract.mjs` | Fixture profile/hash only | Synthetic; production value missing | Defines the full authenticated HTTP contract |
| Sparse canonical profile and `TLSN_CANDIDATE_SPARSE_PROFILE_SHA256` | Yes | Explicit candidate sparse profile file | Fixture profile/hash only | Synthetic; production value missing | Defines sparse disclosure and hidden-range fail-closed behavior |
| Candidate endpoint/host allowlists | Yes | Explicit FUSOU-WEB candidate configuration | No approved current values | Missing | Restricts device and Supabase network destinations |
| Candidate device endpoints | Yes | `TLSN_CANDIDATE_DEVICE_AUTH_URL`, `TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL` | Missing from current approved material | Missing | Binds device authentication to exact HTTPS paths and allowlisted hosts |
| Candidate Supabase endpoint | Yes | `TLSN_CANDIDATE_SUPABASE_URL`, publishable key, host allowlist | Missing from current approved material | Missing | Binds the authenticated User A identity source |
| Approved target identifier/approval record | Required for readiness approval | `TLSN_CANARY_APPROVED_INPUT_CONTRACT_JSON.target_approval` | Contract is implemented; no approved real-target value exists | **MISSING EXTERNAL INPUT** | A server identity plus profile/trust inputs is not an independent approval record |
| Target Presentation/proxy provenance | Required for real evidence | `TLSN_REMOTE_FIXTURE_JSON` and production evidence/proxy provenance contracts | Only repository-local synthetic fixture is available | Fixture-only | Independently proves the Presentation was produced for the approved target and profile |

`TLSN_CANDIDATE_SERVER_IDENTITY` is explicitly defined by `production-inputs.json` as the TLSN attestation target identity, not a network destination. A candidate URL, certificate, or hostname must not be accepted without the corresponding verified TLSN Presentation and approved profile/trust material.

## Trust and Notary Material

| Material | Required | Repository source | Current state | Accepted only when |
|---|---:|---|---|---|
| Evidence Root / Result registry root ID and public key | Yes | `TLSN_CANARY_RESULT_REGISTRY_ROOT_KEY_ID`, `TLSN_CANARY_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI`, signed Result registry envelope | Locally generated fixture/Canary keys exist; no approved current trust anchor | External approval pins the root and the envelope authenticates exact registry bytes |
| Result signing public key and signer ID | Yes | `TLSN_CANARY_RESULT_PUBLIC_KEY_SPKI`, `TLSN_CANARY_RESULT_SIGNER_KEY_ID` | Generated by provisioner for fixture/supplied runs | Registry entry and signed Result agree; Canary key is distinct from Production |
| Result signing registry and envelope | Yes | `TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY`, `TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE` | Synthetic/fixture material only | `deployment-preflight.mjs` validates registry, root signature, key ID, and public key |
| Registry signing key | Yes | Result registry root material above | Synthetic/fixture material only | Root identity is externally pinned; raw private key never enters evidence |
| Notary public key and key ID | Yes | `TLSN_PRODUCTION_NOTARY_REGISTRY`, `TLSN_CANDIDATE_NOTARY_KEY_ID` | `notary-canary-2026` and fixture Notary key only | Explicit approved alpha15 Notary registry contains the selected key ID |
| Evidence Root / TLSN trust root | Yes | `TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER` | Fixture root hash only | Supplied DER bytes are approved for the candidate target and `/health` publishes the same hash |
| Verifier identity | Yes | `TLSN_CANDIDATE_VERIFIER_KEY_ID` plus `fusou-tlsn-verifier-canary` service binding | Key ID is fixture-only; no approved candidate identity | Independent verifier service and health/result identity agree |
| Verifier public key | Yes | `TLSN_CANARY_VERIFIER_PUBLIC_KEY_SPKI`, `TLSN_CANARY_VERIFIER_DEPLOYMENT_ID`, and `TLSN_CANARY_APPROVED_INPUT_CONTRACT_JSON.verifier` | Contract is implemented; no approved real-target value exists | The verifier key, algorithm, purpose, validity, registry reference, deployment, and binding are independently pinned; runtime responses cannot establish trust |
| Security registry set hash | Yes | `TLSN_SECURITY_REGISTRY_SET_SHA256` | Fixture-derived hash only | Canonical hash covers Notary key ID/registry, complete/sparse profile hashes, and server identity |
| Session Authority | Yes | Canary public key, key ID, registry, and private key inputs | Locally generated only | Registry and private/public key match; receipts verify against this Canary registry |
| Binding Authority | Yes | Canary public key, key ID, registry, private key, and fixed binding | Locally generated only | Canary-specific registry and Durable Object single-use state agree |

The security registry set intentionally excludes deployment ID, response mode, Worker name, trust root, signing keys, private keys, callback secrets, and access tokens. The deployment identity binds the trust-root hash separately. This separation is preserved by the current implementation.

## Authentication Material

| Material | Environment input | Source and scope | Current state | Required handling |
|---|---|---|---|---|
| Device ID | `TLSN_REMOTE_DEVICE_ID_A` | Approved User A/device fixture for remote validation | Missing approved value | Short-lived validation scope; never write to evidence |
| Device private key | `TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_FILE` or `_B64URL` | Approved device secret provider | Missing approved value | Keep outside Worker deployment env; mode-600 file or secret injection only; never print/commit |
| Device authentication endpoint | `TLSN_CANDIDATE_DEVICE_AUTH_URL` | Candidate FUSOU-WEB configuration | Missing | Exact HTTPS path and allowlisted host checked by preflight |
| Device possession endpoint | `TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL` | Candidate FUSOU-WEB configuration | Missing | Exact HTTPS path and allowlisted host checked by preflight |
| Supabase URL | `TLSN_CANDIDATE_SUPABASE_URL` and `TLSN_REMOTE_SUPABASE_URL` | Candidate FUSOU-WEB/Supabase configuration | Missing approved value | Clean origin and host allowlist; no service-role key |
| Supabase publishable key | `TLSN_CANDIDATE_SUPABASE_PUBLISHABLE_KEY` and `TLSN_REMOTE_SUPABASE_PUBLISHABLE_KEY` | Candidate public configuration | Missing approved value | Publishable key only; service-role keys are forbidden |
| User A access token | `TLSN_REMOTE_ACCESS_TOKEN_A` | Approved short-lived authentication provider | Missing approved value; existing encrypted remote values are test material | Inject only for the validation process; do not pass to Worker deploy or evidence |
| Session Authority | Canary session authority inputs | `provision-canary-material.mjs` plus approved secret provider | Synthetic/local only | Canary-specific private key and registry; replay material is not acceptable |
| Binding Authority | Canary binding authority inputs | `provision-canary-material.mjs` plus approved secret provider | Synthetic/local only | Canary-specific private key and registry; replay material is not acceptable |

`TLSN_CANARY_APPROVED_INPUT_CONTRACT_JSON.credential_policy` now requires metadata-only credential entries with issuer, issued/expiry windows, maximum lifetime, rotation mode/window, revocation conditions, allowed consumers, and secret-provider references. Secret values remain outside the repository contract. User A/device material must still be scoped to one validation run and revoked/rotated by the credential owner.

## Workflow Provenance

The required workflow fields are:

- `TLSN_WORKFLOW_RUN_ID`: positive integer.
- `TLSN_WORKFLOW_RUN_ATTEMPT`: positive integer.
- `TLSN_REPOSITORY`: `owner/name`.
- `TLSN_WORKFLOW_FILE_IDENTITY`: exactly `dotenvx+pnpm+wrangler`.
- `TLSN_GIT_COMMIT_SHA`: exact checked-out HEAD.
- `TLSN_CANARY_DEPLOYMENT_ID`: explicit deployment identity.

Current status:

- No `.github/workflows` file supplies the TLSN Canary contract.
- The repository validates the shape and binds the values into provenance and attestation.
- There is no separate repository contract naming the approving workflow, target approval authority, or approved target identifier.
- `TLSN_REMOTE_EXPECTED_PROVENANCE_JSON` must be schema 2, scope `tlsn-deployment-provenance`, status `PASS`, environment `production`, and role `canary`; it is a post-deployment expected identity input, not a substitute for target approval.
- `verify-remote-gate.mjs` additionally requires a current `/health`, remote validation report, matching security/deployment/result identities, and an Ed25519 attestation signer key ID/public key. The signer approval source is external to this repository.

Therefore workflow execution provenance is **MISSING** until an approved workflow supplies the exact context for the current HEAD. Historical run IDs or a `PASS` field in a fixture artifact are not sufficient.

## Fixed Binding

The repository requires a fixed binding for Canary:

- `TLSN_ENVIRONMENT=production`
- `TLSN_DEPLOYMENT_ROLE=canary`
- `execution_mode=trigger` for the normal Canary Worker path, with the Canary Direct service binding available for explicit sync capability
- `binding_mode=fixed_canary`
- `TLSN_CANARY_BINDING_VALUE` is required and must be Canary-specific
- `TLSN_CANARY_BINDING_AUTHORITY_*` registry/key material is required
- `TLSN_CANARY_SYNCHRONOUS_RESPONSE_ENABLED=true` is explicit capability configuration

Replay configuration (`test/replay/direct/fixed`) and replay fixed values must not be reused. The Canary Durable Object, R2 bucket, Worker name, verifier service, and binding authority are isolated by Wrangler configuration.

## Identity Separation

The current implementation separates:

- **Security/trust identity:** commit SHA, target server identity, complete/sparse profile hashes, verifier key ID, Notary key ID, security registry hash, Notary registry hash, and binding authority semantic.
- **Deployment/runtime identity:** deployment ID, deployment role, binding mode, trust-root certificate hash, and Worker name.
- **Result identity:** Result public key, Result registry/envelope hashes, and registry root identity.
- **Authority identity:** Session Authority and Binding Authority key IDs, public keys, and registry hashes.
- **Runtime secrets:** private signing keys, trust-root bytes, callback/Trigger secrets, and access tokens.

The separation is enforced by role-specific input lists and forbidden Canary inputs. Canary and Production may share the approved security identity, but their Result public keys must differ. A runtime `PASS` or Worker name does not authenticate target provenance by itself.

## Artifact Classification

| Artifact class | Current examples | Classification rule |
|---|---|---|
| Current approved Canary evidence | None | Must be current HEAD, non-fixture, production/canary, matching health/provenance/result identities, and pass the remote gate |
| Fixture-only | `artifacts/tlsn-production-provenance.json`, `.cache/tlsn-current-canary-fixture/*` | `game.example.test`, fixture profile/root/Notary material, or explicit fixture provenance |
| Synthetic | `artifacts/tlsn-canary-evidence-chain-current.json`, `artifacts/tlsn-canary-evidence-chain.json` | `fixture_only=true`, synthetic remote scope, or fixture repository/source markers |
| Historical | Canary evidence-chain artifacts whose recorded commit differs from current HEAD; `tlsn-canary-readiness-inconclusive-ff39ea4f.json` | Recorded commit is not the current HEAD, regardless of filename |
| Remote-test | `artifacts/tlsn-remote-*.json`, stale-attempt and malicious-callback reports | Replay/evidence/remote synthetic validation; not production target provenance |
| Replay evidence | `artifacts/tlsn-replay-*.json` | Replay runtime security evidence only; cannot satisfy Canary target/trust provenance |

`artifacts/tlsn-production-provenance.json` currently has `status=PASS` and the current HEAD, but it contains `game.example.test`, fixture profile/trust hashes, and `repository=fixture/example`; it is therefore fixture-only/synthetic and not approved production Canary evidence.

## Machine-Readable Readiness

The new no-network command is:

```sh
pnpm run test:canary-readiness
```

It reports `CANARY_READINESS` as `BLOCKED` when required input names are absent or unapproved. It only reads the current process environment, the repository input manifest, and bounded public artifact metadata. It does not decrypt dotenv, fetch URLs, resolve DNS, open TCP/TLS, invoke Wrangler, deploy, or print secret values. An optional `TLSN_CANARY_READINESS_REPORT_PATH` writes the same secret-free JSON report.

At this HEAD the audit reports:

- `contract=true`
- `approved_input_contract=false`
- `current_head=true`
- `target_provenance=false`
- `trust_material=false`
- `authentication=false`
- `binding=false`
- `workflow_provenance=false`
- `runtime_inputs=false`
- `identity_separation=true`
- `network_access=NOT_USED`
- `deployment_executed=false`

## Approved Input Contract

The contract input is a JSON envelope carried as `TLSN_CANARY_APPROVED_INPUT_CONTRACT_JSON`. It has two non-interchangeable statuses:

- `APPROVED`: real, non-fixture Canary target metadata supplied by an external approver.
- `FIXTURE_ONLY`: repository-local synthetic metadata used only by offline contract/preflight tests.

The envelope contains these sections:

- `target_approval`: target identity/hostname, provenance digest, approval reference, approver, validity, profile hashes, trust identity hashes, verifier key ID, workflow repository, and explicit non-production flag.
- `verifier`: Ed25519 public key, key ID, purpose, validity, registry reference, verifier deployment identity, and binding identity.
- `credential_policy`: metadata-only lifetime and rotation rules; no token, private key, or secret value fields are accepted.
- `authentication`: User A/device/Supabase identities plus credential/provider references.
- `binding`: Canary binding identity, fixed binding ID, authority key ID, verifier relationship, and Replay binding identity for separation checks.
- `workflow`: run/attempt, repository, fixed toolchain identity, current commit, and approval reference.
- `identity_separation`: Replay/Canary binding and trust identities, fixture identity, target identity, and non-production marker.
- `evidence_semantics`: fixed authority and non-authority metadata sets.

`deployment-preflight.mjs` validates this envelope before the existing build/deploy boundary. `test:canary-readiness` uses the same validator without network or secret-provider access. A valid `FIXTURE_ONLY` envelope can make fixture preflight pass, but it cannot make real readiness pass.

## Exact Resume Conditions

### Target provenance

Required:

- An externally approved non-fixture `TLSN_CANDIDATE_SERVER_IDENTITY`.
- Canonical complete and sparse profile files matching that identity and their exact SHA-256 base64url hashes.
- Candidate device-auth and Supabase origins/allowlists matching the approved FUSOU-WEB configuration.
- A target Presentation/proxy provenance source that independently proves the verified server identity and profile.
- An external approval record for the target identifier, because the repository has no separate approval-record contract.

Acceptable origin:

- Candidate service owner or approved deployment/configuration authority.
- Canonical profile files and trust inputs supplied through the approved secret/configuration provider.

Reject:

- `game.example.test`.
- Any `test`, `synthetic`, `fixture`, `local`, or `staging` marker.
- A hostname or certificate without a verified TLSN Presentation.
- Historical evidence or callback metadata alone.

Runtime checks:

- `deployment-preflight.mjs` validates profile hashes, target identity, URL paths, host allowlists, and security registry hash.
- Independent Result/evidence verification validates Presentation server identity and profile predicates.

### Trust root and Notary

Required:

- Approved DER trust root for the candidate target as `TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER`.
- Approved alpha15 Notary registry JSON and selected `TLSN_CANDIDATE_NOTARY_KEY_ID`.
- Canonical `TLSN_SECURITY_REGISTRY_SET_SHA256`.
- Canary Result signer public key, signer registry, signed registry envelope, Evidence Root ID/public key.
- Canary Session and Binding Authority public keys, IDs, and registries.
- Candidate verifier identity and the existing Canary verifier service binding.

Acceptable origin:

- The candidate TLSN/Notary authority and the approved security/configuration provider.
- Locally generated Canary authority keys only for this isolated deployment; they do not supply target trust.

Reject:

- Synthetic fixture root or Notary key.
- Replay/test/Production role keys.
- A registry without its trusted root envelope.
- A hash copied from a historical artifact.
- A verifier key ID without the independently verifiable verifier service contract.

Runtime checks:

- `deployment-preflight.mjs` validates registry contents, profile/security hash, Ed25519 public/private key matches, authority registries, and signed Result registry envelope.
- `/health` and Result identities must match the expected provenance.
- Independent evidence verification must verify Notary identity, trust-root publication, Result registry-root authentication, and Result signature.

### Device and Supabase authentication

Required:

- `TLSN_REMOTE_DEVICE_ID_A`.
- `TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_FILE` or `TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL`.
- `TLSN_REMOTE_ACCESS_TOKEN_A`.
- `TLSN_REMOTE_WEB_ORIGIN`.
- `TLSN_REMOTE_SUPABASE_URL` and `TLSN_REMOTE_SUPABASE_PUBLISHABLE_KEY`.
- Candidate deployment equivalents and allowlists required by preflight.
- `TLSN_REMOTE_FIXTURE_JSON` containing an approved real-target Presentation/fixture, not a repository-local synthetic fixture.

Acceptable origin:

- Approved credential/device provider and candidate FUSOU-WEB/Supabase environment.

Reject:

- Existing encrypted test placeholders.
- Service-role keys.
- Device private keys in Worker deployment environment.
- Credentials recorded in reports, logs, or evidence bundles.

Runtime checks:

- `remote-validation.mjs` authenticates User A/device A, performs device possession proof, validates complete Result disclosure and signature, and checks expected identity fields.
- Device/auth material must be one-run, short-lived, and revoked or rotated after validation; this lifetime policy is external because the repository does not enforce it.

### Canary binding

Required:

- Canary-specific Binding Authority public/private key and registry.
- Canary-specific fixed binding value.
- `TLSN_CANARY_BINDING_TTL_SECONDS` via the common TTL input.
- Explicit sync capability and direct callback secret if sync validation is authorized.

Acceptable origin:

- `provision-canary-material.mjs` for locally generated isolated authority material, followed by approved secret-provider injection.

Reject:

- Replay binding value or replay authority registry.
- Fixture binding used as real-target proof.
- A binding value without the matching signed authority registry and Durable Object state.

Runtime checks:

- `/health` must report `binding_mode=fixed_canary` and the expected Canary deployment identity.
- Session issuance, binding consumption, Result commit, and callback validation remain authoritative and single-use.

### Workflow and deployment provenance

Required:

- Approved workflow supplies `TLSN_WORKFLOW_RUN_ID`, `TLSN_WORKFLOW_RUN_ATTEMPT`, `TLSN_REPOSITORY`, `TLSN_WORKFLOW_FILE_IDENTITY`, and exact current `TLSN_GIT_COMMIT_SHA`.
- Explicit `TLSN_CANARY_DEPLOYMENT_ID`, Worker name, Trigger URLs/task ID, and runtime identities.
- A schema-2 `TLSN_REMOTE_EXPECTED_PROVENANCE_JSON` from the same approved run.
- Approved attestation signer key ID/public key; if producing an attestation, its private key comes only from the attestation secret provider.

Acceptable origin:

- Approved CI/deployment workflow and its secret provider. The repository's existing fixed workflow identity is `dotenvx+pnpm+wrangler`.

Reject:

- Manually copied historical run IDs.
- A fixture repository value such as `fixture/example`.
- Current-looking provenance with fixture target/trust fields.
- A mismatched commit, role, environment, or result identity.

Runtime checks:

- `deploy-canary.mjs` requires a clean worktree, current HEAD, preflight PASS, and uses only Canary role inputs.
- `verify-remote-gate.mjs` compares the current `/health`, provenance, remote report, and attestation identities and rejects stale or substituted evidence.

## Safe Bootstrap

```text
approved target/config material
        |
approved secret/config provider
        |  (public values + ephemeral secrets; no commit)
        v
Canary process environment
        |
        +--> deployment-preflight.mjs
        |      (offline format/hash/registry/role checks)
        |
        +--> deploy-canary.mjs
               bootstrap Worker
                    -> Canary verifier service
                    -> main Canary Worker
        |
        v
current /health identity capture
        |
        v
remote-validation.mjs
        |
        v
verify-remote-gate.mjs + signed attestation
        |
        v
offline production-evidence verification
```

`deploy-canary.mjs` writes a temporary mode-600 secret file and removes it after each deployment stage. The device private key and User A access token belong to the remote validation process, not the Worker deployment secret set. Evidence bundles contain hashes, bounded metadata, and verified identities only; they must not contain raw private keys, access tokens, raw presentations, or raw transcripts.

Rollback is the existing deployment rollback to the last approved Canary/production provenance. It must not enable sync, reuse Replay authority material, weaken trust validation, or relax callback validation.

## Expected Runtime Workflow

| Step | Input | Output | Trust boundary | Failure mode |
|---|---|---|---|---|
| Approved target/config | target identity, profiles, trust root, Notary registry | complete Canary input set | external target/config approval | missing/unapproved input; remain BLOCKED |
| Preflight | role env, registries, keys, URLs, workflow context | PASS report and provenance candidate | local canonical contracts | malformed/mismatched/fixture input; fail closed |
| Canary deployment | preflight PASS, current checkout, Wrangler auth | bootstrap/verifier/main deployments | isolated Worker/DO/R2/service bindings | dirty/mismatched checkout or deploy failure; no promotion |
| Health identity | current Worker URL | security/deployment/result identities | current deployed `/health` | identity mismatch or stale artifact; reject |
| Device/session auth | User A token, device key, auth endpoints | device identity, session, binding receipt | FUSOU-WEB and Session Authority | auth/signature/receipt failure; no Result |
| TLSN acquisition | approved Presentation/target profile | verified Presentation input | alpha15 verifier + Notary/trust root | server/profile/Notary mismatch; reject |
| Binding | Canary fixed binding and session | single-use consume receipt | Canary Binding Authority + DO state | reuse/stale/mismatch; no commit |
| Independent verifier | Presentation, profile, trust material | verified member/result predicates | verifier service and offline evidence verifier | malformed/hidden-range/signature failure |
| Result signing | verified payload and Canary Result key | signed Result | Result registry/Evidence Root | registry/root/key mismatch; reject |
| Authority commit | signed Result and authority receipts | authoritative DO Result | DO commit transaction | duplicate/conflict/lease failure; no resurrection |
| Callback | signed callback and attempt identity | terminal state/archival action | callback signature and stale fencing | missing/mutated/stale/duplicate callback handled fail-closed/idempotently |
| Evidence bundle | bounded hashes and current identities | secret-free report/attestation | signed attestation + offline verifier | stale/substituted/fixture evidence remains BLOCKED |

## Validation Performed

- `pnpm run test:production-canary-provisioning`: PASS.
- `pnpm run test:canary-approved-input-contract`: PASS.
- `pnpm run test:fixture-only`: PASS.
- `pnpm run test:security-registry-set-contract`: PASS.
- `pnpm run test:canary-readiness`: PASS as a no-network audit command; its readiness result is `BLOCKED`.
- `node --check scripts/canary-readiness-test.mjs`: PASS.
- Replay baseline was not altered. The supplied replay runtime baseline remains PASS, including callback-security 16/16.

## Changes

- Added `scripts/canary-readiness-test.mjs`.
- Added the `test:canary-readiness` package script.
- Added this audit document.
- No verification, callback, trust, deployment, or production configuration was weakened.

## Conclusion

```text
Replay security: PASS
Local Canary contracts: PASS
Canary runtime: BLOCKED
Production endpoint access: NOT USED
Production credentials: NOT USED
Canary deployment: NOT EXECUTED

Blocking inputs:
- approved non-fixture target identity and target provenance
- canonical complete/sparse profiles and hashes
- approved trust root and Notary registry/key
- approved Result Evidence Root and authority registries
- approved device/User A/Supabase authentication material
- Canary-specific fixed binding authority/value
- approved workflow and deployment provenance
- separate approved verifier identity contract is not explicitly defined

Resume procedure:
- supply those exact materials through the approved provider without committing secrets
- run the no-network readiness audit and deployment preflight
- deploy only through bootstrap -> verifier -> main Canary wrapper
- verify current /health identities, remote validation, attestation, and offline evidence
- keep Production default async and preserve callback-security checks
```
