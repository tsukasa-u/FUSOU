# Production evidence: human/operator preflight

This is an operator runbook, not gameplay authorization. The completed consumer baseline is `eb256aa3293997e48e86e1dfcc90b43b190fd39b` on `tlsn-phase0-investigation`. The APP entry contract below adds strict role-aware deployment observation and an independent active-version pin; it does not redesign Result, Presentation, Inventory, Approval, exact-byte, consumer or acceptance contracts.

## 1. Fixed status and current stop conditions

| Item | Status | Evidence / limit |
|---|---|---|
| Collector trust chain; offline independent re-approval | VERIFIED | Completed consumer implementation and Complete/Sparse negative regressions. |
| Inventory / Approval binding; exact outer Result binding; raw-only fail-closed | VERIFIED | Completed contracts; no redesign in this runbook. |
| Consumer negative regression coverage | VERIFIED | Both disclosure modes in [Run #70](https://github.com/tsukasa-u/FUSOU/actions/runs/37835901490), exact baseline SHA, both jobs successful. |
| Real deployment, real Notary/Game Server interaction, human gameplay, real Presentation/Result/archive | UNVERIFIED | No actual operator deployment records or real evidence are established by this document. |
| Actual Production URLs, deployed SHA/version and operator-selected public pins | UNKNOWN | Must be supplied and checked by the responsible operators. CI SHA is not deployed SHA. |
| Production acceptance | BLOCKED | Tests, successful capture and offline CLI exit zero do not promote acceptance. |
| AD-5 / APP process-image authority / TPM / measured boot / Browser integrity | OUT_OF_SCOPE | Do not add these as prerequisites or infer these guarantees from provenance. |

There are existing source-level limits that must not be hidden behind a checklist:

- The APP experiment calls [its health observer](../../FUSOU-APP/src-tauri/src/tlsn_runtime.rs) before starting the proxy. It now requires the independently expected pair `canary + fixed_canary` or `production + random`, with `environment == "production"` in both cases. Root and nested deployment identity, Git SHA, Result authority and the independently pinned active version must match. The [caller](../../FUSOU-APP/src-tauri/src/wrap_proxy.rs) supplies compile-time pins before health observation. Missing pins or incompatible identities still block entry; source/test compatibility is not evidence of an actual Production deployment.
- [The existing human-gameplay preflight](../scripts/human-gameplay-preflight.mjs) is an offline candidate/governance report. `PASS_LIMITED` does not authorize gameplay: `readiness_status` and `gameplay_authorization` remain `BLOCKED`, with no network access or game start. Its post-Presentation predicates cannot be satisfied merely by predicting a candidate hostname before first capture.
- [The APP config renderer](../scripts/production-trust-contract.mjs) validates its manifest inputs but emits only `enabled`, disclosure/response mode and artifact output path. Its fragment does not supply all compile-time trust pins, health expectations, endpoints or `candidate_capture_enabled`. Do not assume rendering it completes APP setup.
- Production [Wrangler configuration](../wrangler.toml) now declares `CF_VERSION_METADATA`. [Main Worker health](../src/index.ts) can report that runtime's version ID after deployment; the binding alone does not establish which version is actively serving traffic. It does not return the separate signed Canary Runtime Attestation. Obtain the active deployment/traffic mapping independently as below; do not invent a signed Production health attestation.

All steps below are conditional operating instructions. Until these stop conditions and the required real inputs are resolved without bypass, do not begin real Production gameplay.

## 2. Input inventory and handling rules

Phase names are literal:

- `REQUIRED_BEFORE_DEPLOY`: release preparation and the existing guarded deploy.
- `REQUIRED_AFTER_DEPLOY`: establish what is actually serving traffic.
- `REQUIRED_FOR_HUMAN_GAMEPLAY`: authenticated operator/APP readiness, before gameplay.
- `REQUIRED_FOR_CAPTURE`: package the original APP evidence; no new Game Server traffic.
- `REQUIRED_FOR_OFFLINE_VERIFICATION`: independently rebuild and verify the chain.

The tables classify each input's primary acquisition phase. Public pins acquired before deploy are also required, unchanged, for gameplay/capture/offline verification. After-deploy records are reused for capture and offline expectations. An input's presence is not proof of authenticity.

`Package` means safe to include in **restricted evidence storage**, not permission to publish. `Public` keys/registries are not private keys; URLs, account/device identifiers, receipts, complete transcripts and member data can still be sensitive. Raw transcripts can contain Game Server credentials or personal data. Review access/privacy separately; never redact or reserialize signed/raw artifacts in place.

`Independent = Yes` means acquire or pin outside the evidence package through the stated trusted source. A second path pointing to a file extracted from the package is not independent. Maintain operator-controlled, access-restricted reference storage separate from the package, with approved raw hashes, provenance, key IDs, acquisition time and release context. A package may contain copies for comparison, never bootstrap its own authorities.

### REQUIRED_BEFORE_DEPLOY

| Input | Source of truth | Who supplies it | Authenticity check | Secret? | Package | Independent? |
|---|---|---|---|---|---|---|
| Production Worker URL; verification, Session Authority and Trigger endpoints | Approved release/deployment configuration; public manifest where defined | Deployment operator | Clean HTTPS endpoints; reviewed routing, allowed origins and postdeploy agreement | No; routing may be sensitive | Public endpoints yes; internal routing restricted | Yes |
| FUSOU-WEB origin; Supabase origin and publishable key | Production WEB/Auth configuration | WEB/Auth operator | Exact reviewed HTTPS origins; device-auth/possession and Supabase allowlists agree with Worker/APP configuration | Origins/key are not bearer secrets | Yes, with privacy review | Yes |
| Production Result signing registry and signed Root envelope | Published raw registry/envelope | Result key-registry publisher | Existing registry validator; current ID/SPKI ACTIVE and within validity; envelope signature and raw digest | No | Yes | Yes |
| Result registry Root ID and SPKI | Previously trusted publisher/operator root pin | Registry authority/operator | Pin obtained out-of-band; envelope root must equal it, not select its own root | Public pin only | Yes | Yes |
| Selected Result signer ID/SPKI | Approved registry and deployment configuration | Result authority/operator | Exact registry membership and deployed public identity agreement | Public pin only | Yes | Yes |
| Session Authority registry, selected ID/SPKI and endpoint | Published authority registry and approved release | Session Authority/operator | Correct registry scope, status/validity, exact raw hash and selected public key | Public pin only | Yes | Yes |
| Binding Authority registry and selected ID/SPKI | Published authority registry and approved release | Binding Authority/operator | Correct scope/status/validity; hash/key agree with deployed authority and durable-single-use policy | Public pin only | Yes | Yes |
| Production Notary registry; selected Notary key ID/endpoint | Trusted Notary publication and approved release | Notary authority/operator | Validate registry material; selected key belongs to trusted registry; endpoint/key/hash agree with release | Public material only | Yes | Yes |
| Selected Verifier key ID; verifier routing; security registry-set digest | Approved Dedicated Verifier/release configuration | Verifier/deployment operator | Match production deployment, registry-set contract and later signed Result; not a candidate hostname | No | Yes; internal routing restricted | Yes |
| Origin Inventory reference | Exact reviewed [Inventory source](../../configs/tlsn-origin-inventory.json) at the approved release | Release/operator authority | Schema/hostname/port validation and independently recorded raw digest | No | Yes, exact bytes | Yes |
| Target Approval reference | Exact reviewed [Approval source](../../configs/tlsn-target-approval.json) | FUSOU deployment operator | Canonical APPROVED Production schema; raw digest; recompute its Inventory digest and target relationship | No | Yes, exact bytes | Yes |
| Deployment manifest, provenance and workflow context | Guarded release pipeline and trusted checkout | Release operator | Declared 40-character SHA equals clean checkout; manifest/provenance/role/registry agreement | No; operational details may be sensitive | Public manifest yes; other records restricted | Yes |
| `TLSN_APP_WORKER_REFERENCE_PATH` and approved release inputs | Operator-controlled independent storage; existing public manifest/provenance and registry Root pins | Release/infrastructure operator | New, non-overwriting reference filepath outside the evidence package; independent inputs supplied before health | Path/reference not secret; account context sensitive | Public reference copy restricted; not authority when packaged | Yes |
| Previous-known-good provenance/change report; remote validation report and signed attestation; attestation signer pin | Existing deploy-gate records and remote validation authority | Release/Canary validation operators | Existing previous-deployment/remote-gate signature, freshness and context checks | Reports/public pin no; signer private key secret | Public reports/pins restricted; private keys never | Yes |
| Worker Result/Session/Binding signing private keys; Trigger API/callback secrets | Existing role-specific secret manager | Respective authorities/deployment operator | Existing key-pair/role/secret allowlists and guarded secret injection | Yes | Never | Yes; provision outside package |
| Cloudflare deploy/R2 credentials; WEB Supabase service-role secret | Respective infrastructure/backend secret managers | Infrastructure/WEB operators | Authorized account, least required access and correct backend role | Yes | Never; service-role key stays backend-only | Yes |
| Proxy provenance public pin, **only if the existing signed provenance claim is used** | Independently pinned existing provenance authority | Provenance/operator authority | Existing pin schema and signature/identity agreement with capture metadata | Public pin no; signing private key secret | Public pin/claim yes; private key never | Yes if used |

Proxy provenance is governance-only. With no external pin, the existing predicate remains `UNVERIFIED`; this is not missing Game Server/Notary authority and does not require process/image attestation. A self-declared or newly invented key cannot upgrade it. Do not supply a pin to unsigned/unverified metadata simply to make a status green.

Use [production-inputs.json](../scripts/production-inputs.json), [deployment contract](../scripts/deployment-contract.mjs) and [guarded deploy](../scripts/deploy-production.mjs) for deployment input allowlists and required remote-gate/previous-release artifacts. Some common input names retain `TLSN_CANDIDATE_` prefixes (selected key IDs, Notary/Auth endpoints and allowlists); that naming does not authorize candidate-derived Game Server identity. The deploy allowlist also retains legacy consumer private-key/raw-override names: they are **not** supported capture instructions. Current consumer source requires an APP bundle.

The guarded `pnpm run deploy:production` sequence is preflight, WASM build, previous-deployment capture, remote gate, previous-change validation, deploy, deployment verification, then independent APP handoff capture. A clean approved checkout and all its prerequisite inputs are required. The handoff requires `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` and `TLSN_APP_WORKER_REFERENCE_PATH`; these are operator/CLI inputs, not new Worker variables or secrets. Do not replace the sequence with a direct deployment to bypass a gate. This runbook does not execute deployment.

### REQUIRED_AFTER_DEPLOY

| Input | Source of truth | Who supplies it | Authenticity check | Secret? | Package | Independent? |
|---|---|---|---|---|---|---|
| Actual deployed git SHA, Worker name, deployment ID/role and binding mode | Authorized release/control-plane deployment record, cross-checked with live health | Deployment operator | Release SHA/identity equals actual active deployment and health; Production role, `random` binding | No; identifiers may be sensitive | Restricted records yes | Yes |
| Exact active Worker version/deployment identity | Authenticated Cloudflare Workers Deployments API's first/latest active deployment, plus its Version detail | Infrastructure operator | One version at 100%; public release bindings agree; active deployment unchanged during handoff; exact APP pin versus live health | No; account context sensitive | Restricted public record yes | Yes |
| Live Worker health | Approved Worker origin `/health`, no redirects | Deployment operator | HTTP 200, schema 3, production role/environment, `trust_contract_valid`, independent public keys/digests/identity agreement | No; operational data | Yes | Yes for expected pins; response is only a cross-check |
| Runtime Attestation / remote validation evidence | Existing signed Canary/remote-gate authority records | Validation/operator authority | Signer, scope, freshness, registry, deployment/SHA/version agreement for the deployment they actually attest | Evidence/public keys no | Restricted yes | Yes |
| R2 archive account, bucket, binding and retention/access policy | Deployed resource bindings and authorized storage control plane | Infrastructure operator | Actual `TLSN_PRESENTATIONS` binding resolves to intended account/bucket; retained objects can be read | Location no; access credentials secret | Location/read records yes; credentials never | Yes |

The configured Production bucket is `fusou-tlsn-verification-production`, binding `TLSN_PRESENTATIONS`. This is **OBSERVED configuration**, not proof of an existing deployed bucket, its access, retention or a stored object.

Run existing `pnpm run verify:deployment` with independently acquired provenance/public manifest and required deploy-context inputs. It checks live health agreement and unauthenticated Session rejection (HTTP 401); it does not establish live Auth/device ownership, a real TLSN proof, actual R2 retrieval or the Cloudflare active-version record. Preserve those additional operator observations separately. A Canary signed Runtime Attestation does not attest an unrelated Production Worker.

### Approved release → active deployment → APP handoff

**ROOT CAUSE / CURRENT CONTRACT:** the former APP preflight/observer hard-coded Canary and `fixed_canary`, while a correct Production Worker uses `production + random`. This was source incompatibility, not insufficient configuration.

**PROPOSED CONTRACT / SECURITY INVARIANTS:** the role is selected from the independent expected binding mode's strict one-to-one mapping. Production requires `production + random`; Canary requires `canary + fixed_canary`. Neither `production + fixed_canary` nor `canary + random` is valid. Both root and nested health fields must agree with the expected pair. `FUSOU_TLSN_EXPECTED_BINDING_MODE` is now explicit for both roles; a missing/empty input no longer silently selects Canary. Empty or partially populated expected identity, missing independent version, wrong SHA/deployment/name/Result key/signer/raw registry digest, or a different observed version fails closed before proxy entry.

**AUTHORITY SOURCES / DATA FLOW:**

1. The release operator supplies independently approved provenance, public manifest, selected public Result registry/envelope and its existing out-of-band Root pin, workflow context, Production Worker name/logical deployment ID and approved HTTPS origin. The public manifest/provenance are not self-authenticating; an arbitrary file from a package is not an approved release.
2. The infrastructure operator uses an account-scoped Cloudflare API token with `Workers Scripts Read` (or the existing deploy token's required permissions) over authenticated HTTPS. The [handoff implementation](../scripts/app-worker-deployment-reference.mjs) requests:
   - [List Worker Deployments](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/): `GET /accounts/{account_id}/workers/scripts/{script_name}/deployments`. Cloudflare defines the **first** entry as the latest deployment actively serving traffic. Merely finding a historical matching version is insufficient.
   - [Get Worker Script Version](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/get/): `GET /accounts/{account_id}/workers/scripts/{script_name}/versions/{version_id}` for that active version.
3. Require exactly one version with 100% traffic. Match the active version's public environment/role, Git SHA, logical deployment ID, Worker name, Result registry/public authority/Root envelope, Session public authority, Notary selection/registry, Verifier selection and security registry-set binding to the approved release. Reject forbidden Canary/Test bindings; Production `random` is derived by the existing Worker source, not a new Worker binding-mode variable. Require `CF_VERSION_METADATA`. Re-read active deployments and reject rotation during acquisition.
4. Store the new reference in restricted **operator-controlled storage outside the evidence package**. `flag: "wx"` prevents overwriting a prior reference. The record preserves acquisition time, distinct Cloudflare deployment/version IDs, account/script/API sources, approved release context, checked public bindings and the complete public APP `compile_inputs`. It deliberately excludes API credentials, private keys and unrelated/secret version bindings. Preserve the authorized release/control-plane acquisition record; the resulting JSON is an unsigned operator handoff, not a new cryptographic root or Runtime Attestation.
5. Pass those exact `compile_inputs` into the APP build environment, especially `FUSOU_TLSN_EXPECTED_ACTIVE_VERSION_ID`. They are compile-time `option_env!` inputs; changing user TOML alone does not update them. Handoff defaults to the existing `complete` mode; select `TLSN_PRODUCTION_DISCLOSURE_MODE=sparse` to derive the existing same-origin `/verify/tlsn/sparse` route from the approved manifest endpoint. The effective APP TOML disclosure mode must match the handoff's `disclosure_mode`. Preserve raw registry strings, including trailing newlines. Do not use shell command substitution, `eval`, or JSON reserialization to replace registry bytes.
6. Only after the expectation exists does APP contact the pinned `/health`. The health and verification URLs must be canonical HTTPS DNS URLs on the **same approved origin**, with no credentials, nondefault port, query, fragment or normalized path manipulation. Health path is `/health`; verification is `/verify/tlsn` or the existing same-origin `/verify/tlsn/sparse` route and must match the effective disclosure mode. Health, verification/status and Session clients do not follow redirects. A correct health URL paired with another Worker's verification URL is rejected.

To refresh a handoff for an already authorized release, use `pnpm run capture:app-worker-reference` with the same independent release inputs, context, Cloudflare credentials and a **new** `TLSN_APP_WORKER_REFERENCE_PATH`. It does not contact health, the Game Server, Auth or device services. Never extract its authorities from a captured evidence package.

An operator-controlled Node build runner can load the public values without stripping raw registry bytes:

```js
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const reference = JSON.parse(await readFile(process.env.TLSN_APP_WORKER_REFERENCE_PATH, "utf8"));
if (reference.scope !== "tlsn-app-approved-worker-deployment-reference") throw new Error("Wrong handoff scope");
const env = { ...process.env, ...reference.compile_inputs };
delete env.CLOUDFLARE_API_TOKEN;
delete env.CLOUDFLARE_ACCOUNT_ID;
const build = spawnSync("cargo", ["build", "--locked", "--manifest-path",
  "packages/FUSOU-APP/src-tauri/Cargo.toml", "--features", "tlsn-production"], {
  env, stdio: "inherit",
});
if (build.error) throw build.error;
if (build.status !== 0) throw new Error(`APP build failed: ${build.status}`);
```

Run this from the approved repository checkout using a public-build environment without Worker/device/evidence private keys. The snippet only consumes a previously approved, independently stored handoff; checking its scope does not authenticate an untrusted file. Run the existing APP preflight on the effective capture configuration, then retain the unsigned health observation and compare all pins. The historical configuration-fingerprint v2 projection remains unchanged and **does not include the new active-version pin**; preserve the separate handoff/version comparison record rather than claiming v2 covers it.

Keep the following distinct: Git commit SHA; FUSOU logical deployment ID; Cloudflare deployment ID; Cloudflare version ID; unsigned health response; existing signed Runtime Attestation. Health metadata remains `unsigned-https-health-response`, `signature_valid: false`, `authority_status: UNVERIFIED` even when its cross-check succeeds. It establishes only an observation at the approved HTTPS endpoint consistent with independent deployment/public Result expectations. It does not prove APP/image/browser integrity, Game Server identity, Presentation cryptography or an independent cryptographic issuing-version claim for Result.

**ROTATION MODEL:** for Worker A, V1 → V2 requires a fresh authenticated active-deployment handoff and APP rebuild/release with V2's compile-time pin. V1's pin rejects V2, and an unrelated valid UUID also rejects. Worker name, logical deployment ID, Result authority and approved Game Server set may remain unchanged. Version rotation alone never changes Game Server identity or requires a new Target Approval; update Approval only through its existing independently authorized policy change. A multi-version rollout is unsupported by this entry contract and remains blocked rather than accepting an arbitrary served version. Reconfirm the active mapping immediately before gameplay.

**NEGATIVE TEST MATRIX:** APP source tests cover both distinct role identities, root/nested/missing role/binding, wrong deployment/name/SHA, missing/stale/unrelated version and missing independent expectations, Result signer/key/registry substitutions, endpoint host/origin/path/query/HTTP mismatches and no-redirect clients. Handoff tests cover historical versus active selection, split/partial traffic, release/Root/registry substitutions, duplicate/wrong public version bindings, missing version metadata, rotation races and zero health requests. These tests do not substitute for real deployment or gameplay evidence.

### REQUIRED_FOR_HUMAN_GAMEPLAY

| Input | Source of truth | Who supplies it | Authenticity check | Secret? | Package | Independent? |
|---|---|---|---|---|---|---|
| Production Auth session / canonical user ID | Live Production Supabase login and `/auth/v1/user` | Human account holder/Auth service | Valid access token; correct origin/user; `is_anonymous` is false; available through capture | Bearer/refresh tokens yes; user ID sensitive | User observation restricted; tokens never | Yes |
| Registered device ID, public key/hash, ownership and revocation | Live FUSOU-WEB `user_devices` authority via device-identity endpoint | Device owner/WEB service | UUID v4; `authoritative`; correct authority/user/device; 32-byte key/hash; `revoked_at == null` | ID/public key not private secrets; identifiers sensitive | Restricted yes | Yes |
| Local registered device private key | Existing APP device keystore | Device owner/APP | Existing challenge/device-auth/possession checks prove correspondence to registered public key | Yes | Never; not sent to collector/offline machine | Yes; local provisioning |
| APP build/configuration and capture directory | Reviewed APP build and effective configuration | APP/release operator | Existing feature/config preflight, public fingerprints, endpoint/key agreement; directory writable/private; capture enabled | Config pins no; paths sensitive | Public config fingerprints/path record restricted | Yes |
| Human gameplay operation and capture time | Human operator's actual operation record | Human operator | Record actual operation/time/account context; no test/fixture substitution | Potentially personal | Restricted record yes | Yes; not inferred from CI |

The [device-identity endpoint](../../FUSOU-WEB/src/server/routes/anonymous-sync-v2.ts) is `/api/auth/anonymous-sync/v2/device-identity?device_id=<UUID-v4>` under the configured WEB origin. It requires bearer authentication, rejects anonymous users, unknown devices and owner mismatch, and returns the registered public key/hash and revocation state. Use the existing authenticated client/secret-managed operator runner; do not put tokens in logs, reports or command-line examples.

APP capture requires the `tlsn-production` feature and effective `[proxy.tlsn]` settings `enabled = true`, `candidate_capture_enabled = true`, the chosen `complete` or `sparse` mode, `response_mode = "async"` and a private writable `artifact_output_path`. The default [config](../../configs/configs.toml) disables both experiment and capture. Complete compile-time pins/endpoints and health expectations must already be supplied by the reviewed APP configuration; a rendered TOML fragment is insufficient. Do not change candidate host settings into identity authority.

### REQUIRED_FOR_CAPTURE

| Input | Source of truth | Who supplies it | Authenticity check | Secret? | Package | Independent? |
|---|---|---|---|---|---|---|
| Original APP bundle path and nine primary artifacts below | Original APP capture, not a rebuilt fixture | Human/APP operator | Complete files; original Session/proofs; exact response; collector re-verifies bindings/signatures | Sensitive evidence, not private signing keys | Restricted exact artifacts yes | Primary capture; authorities remain external |
| All public registries/pins/references and approved origins above | Operator-controlled reference storage | Respective authorities/operator | Same reviewed raw bytes/IDs/digests as deployed release | Public pins no | Copies yes; copies are not authority | Yes |
| Evidence manifest signer ID/SPKI and PKCS8 private key | Existing evidence-signing authority / capture secret manager | Capture authority/operator | Correct Ed25519 pair and independently published public pin; distinct role from Result/remote attestation signer | Private key yes | Public ID/SPKI yes; private key never | Yes |
| Output manifest filepath and containing evidence directory | Operator-selected restricted local storage | Capture operator | Fresh output location; adequate storage/access; preserve all relative artifact paths | Path not a credential | Package itself restricted | Operator-controlled |
| Capture workflow context and clock | Actual approved capture execution/release records and correct UTC clock | Capture/operator authority | Real run ID/attempt/repository/source context; not fabricated from manifest or reused Run #70 | No; operational metadata | Yes | Yes |

### REQUIRED_FOR_OFFLINE_VERIFICATION

| Input | Source of truth | Who supplies it | Authenticity check | Secret? | Package | Independent? |
|---|---|---|---|---|---|---|
| Copied signed manifest and all descriptor-referenced files; archive downloads | Captured package and authorized exact archive retrieval | Capture/storage operator | Manifest signature; every size/hash; receipt/Result/Presentation bindings; archive byte comparison | Sensitive evidence | Restricted yes | Artifacts are inputs, not trust anchors |
| External Inventory/Approval, Notary/Result/authority registries, Root/evidence-signer pins | Separately obtained approved reference snapshot | Independent verifier/operator authorities | Raw-byte agreement, pinned digests, registry/envelope signatures/status, policy relationship | Public pins no | Copies may be present, never select the external pins | Yes |
| Expected deployment/security/Result/subject identities and workflow context | Independent release/Auth/device records; verified original Session and Presentation for derived subject fields | Independent verifier/operator | Match actual release/user/device; derive hostname/profile/member only through verified Presentation; never copy package declarations as authority | Not private keys; subject metadata sensitive | Restricted expectations yes | Yes |
| Trusted checkout, dependencies, toolchain, WASM/provenance and verifier logs | Approved release and independent verifier build | Independent verifier operator | Pinned checkout/build provenance; no fixture/test hooks; record exact tool/build context and exit status | No keys needed | Restricted build/verification record yes | Yes |

The offline environment needs **no** access token, refresh token, device private key, Worker signing private key, evidence signing private key, Cloudflare credential or live service request.

## 3. Mechanical before-gameplay checklist

Keep checked inputs and outputs in the operator reference/validation record. A missing, unknown, stale, revoked, wrongly scoped or mismatched required trust identity means **BLOCKED**. Do not continue after a nonzero exit, substitute a fixture, or treat a human assertion as a verified key/deployment identity.

| Check | Mechanical check / required record | Stop condition |
|---|---|---|
| 1. Deployed Worker SHA | Guarded release checkout/provenance SHA; actual active control-plane release; live health root/security SHA agree | CI-only SHA, dirty/unpinned release, unknown deployment or mismatch |
| 2. Manifest / Runtime Attestation | Existing deployment preflight/previous-release/remote-gate validators; public manifest digests; signed attestation context, signer and freshness | Missing gate evidence; Canary attestation presented as Production evidence; any context mismatch |
| 3. Worker health / active version | Existing `verify:deployment`; new independent handoff from current active 100% mapping; APP's strict Production/schema-3 health cross-check against the compiled version/deployment/authority/endpoints | Redirect/503/invalid contract; missing/stale/unrelated version pin; role/binding/origin/identity mismatch |
| 4. Result key registry | Existing signing-registry and signed-envelope validators; independent Root pin; raw hash and active ID/SPKI match health | Self-selected Root, missing envelope, revoked/expired/mismatched key or hash |
| 5. Notary registry | Existing Notary registry validator and public-manifest/preflight checks; selected ID/key/endpoint agrees with independent reference and health | Unknown/synthetic registry, wrong key/endpoint/hash |
| 6. Origin Inventory | `parseOriginInventory` on exact reference bytes; 20 canonical lowercase DNS hosts, port 443; independently pinned digest agrees with release/health | Invalid schema/identity, changed unapproved raw bytes or wrong digest |
| 7. Target Approval | `parseTargetApproval(raw, inventory, rawInventoryDigest)`; APPROVED Production record; approved target relationship and independent raw digest match release/health | Invalid/unknown approval, wrong Inventory digest/membership or approval hash |
| 8. Auth session | Authenticated `/auth/v1/user` at approved Supabase origin, publishable key and canonical non-anonymous user match intended account | Missing/expired/anonymous/wrong-origin or wrong-account session |
| 9. Registered device | Live WEB device-identity response, correct owner/device/public key/hash and no revocation; existing APP key/challenge path available | Unknown device, wrong owner/key, revocation or inability to use registered local key |
| 10. APP capture directory | Existing APP configuration preflight; reviewed full pins/endpoints; capture enabled; private writable artifact root; enough storage | Disabled capture, incomplete config, unsupported runtime health expectation or unwritable/shared output |

Use existing validators, not new acceptance logic: [deployment preflight](../scripts/deployment-preflight.mjs), [registry envelope](../scripts/result-registry-envelope.mjs), [authority registry](../scripts/authority-key-registry.mjs), [Origin contract](../src/origin-trust-contract.mjs), and [APP preflight](../../FUSOU-APP/src-tauri/src/tlsn_preflight.rs).

The baseline raw-byte facts, locally recomputed through the existing Inventory/Approval parsers, are:

| Reference | Bytes | SHA-256 (base64url, no padding) |
|---|---:|---|
| Origin Inventory | 1876 | `oPGCXkdYTkTCfif4bmujVhtHP-vOSmF1CB8R6eo-XZ0` |
| Target Approval | 899 | `LMq3_l4PVfOv1K3rKXVekG1N7VOOxn5rQBZRr-J7z78` |

Both have 20 targets and the ordered approved set equals the Inventory set at this baseline. These are release-reference facts, not hashes to update from a package to make it pass. A different approved release requires independent review/pinning of its actual bytes.

Before gameplay, establish the trusted approved **set** and intended routing. An actual observed server identity does not exist until a real Presentation has been obtained and cryptographically inspected. Do not invent this identity to clear the existing human-preflight report. Health/config/manifest/Result must never become its authority.

## 4. After human gameplay: retain the original APP bundle

Only proceed after the stop conditions above have been resolved in the authorized operational scope. The human uses the real Game Server through the reviewed APP/Notary path; record time and actual operation. Do not replace gameplay with a collector-generated request.

[The APP writer](../../FUSOU-PROXY/proxy-https/src/real_tlsn.rs) places the bundle under `<artifact_output_path>/<presentation.identifier()>`. Locate the actual completed directory rather than guessing from a job ID. Minimum files:

```text
presentation.bin
metadata.json
session.json
device-authentication.json
possession-proof.json
worker-verification.json
result.json
result-exact.bin
consume-receipt.json
```

Also preserve `candidate-manifest.json`, `candidate-identity.json` and any `verifier-execution-receipt.json` / `verifier-execution-receipt-header.bin` emitted by the APP. A candidate manifest's `UNAPPROVED`, `NOT_YET_OBSERVED` or pending status is not Target Approval authority. Missing execution/required evidence is a stop, not permission to fabricate it.

From the Worker directory, this presence check is deliberately only a completeness check; the collector performs cryptographic verification:

```sh
node --input-type=module <<'NODE'
import { stat } from "node:fs/promises";
import { join } from "node:path";
const root = process.env.TLSN_PRODUCTION_EVIDENCE_BUNDLE_PATH;
if (!root) throw new Error("Original APP bundle path is required");
const files = ["presentation.bin", "metadata.json", "session.json",
  "device-authentication.json", "possession-proof.json", "worker-verification.json",
  "result.json", "result-exact.bin", "consume-receipt.json"];
for (const file of files) {
  const info = await stat(join(root, file));
  if (!info.isFile() || info.size === 0) throw new Error(`Missing/empty artifact: ${file}`);
}
console.log("Bundle files present; cryptographic verification still required");
NODE
```

Preserve the original Session/receipt, device nonce/authentication, possession proof, binding and replay digest. Inspect metadata provenance/time/request profile without editing it. The supported profile is `POST /kcsapi/api_get_member/require_info HTTP/1.1`; metadata is a cross-check, not authority. No fresh Session may be issued to rebind this Presentation.

## 5. Capture the evidence package

Prepare the approved verifier build before gameplay to avoid losing the freshness window. From this Worker directory, `pnpm run build:wasm` and `pnpm run verify:wasm-provenance` use existing tooling. Use a clean approved checkout, its locked dependencies and the trusted production registries/references.

Supply these capture-specific environment variables through the existing operator/CI configuration, with bearer/private material from the secret manager:

```text
TLSN_PRODUCTION_EVIDENCE_WORKER_URL
TLSN_PRODUCTION_EVIDENCE_WEB_ORIGIN
TLSN_PRODUCTION_EVIDENCE_SUPABASE_URL
TLSN_PRODUCTION_EVIDENCE_SUPABASE_PUBLISHABLE_KEY
TLSN_PRODUCTION_EVIDENCE_ACCESS_TOKEN
TLSN_PRODUCTION_EVIDENCE_DEVICE_ID
TLSN_PRODUCTION_EVIDENCE_BUNDLE_PATH
TLSN_PRODUCTION_EVIDENCE_OUTPUT_PATH
TLSN_PRODUCTION_DISCLOSURE_MODE
TLSN_PRODUCTION_EVIDENCE_NOTARY_KEY_ID
TLSN_PRODUCTION_EVIDENCE_VERIFIER_KEY_ID
TLSN_PRODUCTION_EVIDENCE_SIGNER_KEY_ID
TLSN_PRODUCTION_EVIDENCE_SIGNER_PUBLIC_KEY_SPKI
TLSN_PRODUCTION_EVIDENCE_SIGNING_PRIVATE_KEY_PKCS8
```

`OUTPUT_PATH` is the **manifest filepath**, in a new restricted directory. Choose the bundle's actual disclosure mode, not a convenient mode inferred from Result declarations. Worker/WEB/Supabase inputs are clean HTTPS origins; do not include path, port, query or credentials. Also supply the shared public trust inputs:

```text
TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY
TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE
TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_KEY_ID
TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI
TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID
TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI
TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_REGISTRY
TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_ID
TLSN_PRODUCTION_SESSION_AUTHORITY_PUBLIC_KEY_SPKI
TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_REGISTRY
TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_ID
TLSN_PRODUCTION_BINDING_AUTHORITY_PUBLIC_KEY_SPKI
TLSN_PRODUCTION_NOTARY_REGISTRY
TLSN_PRODUCTION_ORIGIN_INVENTORY_REFERENCE_PATH
TLSN_PRODUCTION_TARGET_APPROVAL_REFERENCE_PATH
TLSN_GIT_COMMIT_SHA
TLSN_WORKFLOW_RUN_ID
TLSN_WORKFLOW_RUN_ATTEMPT
TLSN_REPOSITORY
TLSN_WORKFLOW_FILE_IDENTITY
```

Reference paths point to independently obtained policy files outside the package. Registry variables contain the published raw JSON strings, not paths or reserialized replacements. Preserve raw bytes when loading them; shell command substitution can strip trailing newlines. Workflow context must describe the actual approved capture execution, with `repository = tsukasa-u/FUSOU`, the correct source SHA/run/attempt and the existing `workflow_file_identity = dotenvx+pnpm+wrangler`. Offline verification uses that same independently recorded capture context, not its own machine's new run ID. Deployed source identity is additionally checked through deployment/health records.

After preparing the build and inputs:

```sh
node scripts/capture-production-evidence.mjs
```

Alternatively, the existing `pnpm run capture:production-evidence` builds WASM before running the same collector. Do not use test hooks, raw Presentation/metadata overrides or a device private-key input.

Capture reads the original bundle; its allowed live observations are Worker health, authenticated Supabase user, WEB device identity and consumed-binding rejection on the matching Worker route. It does not contact the Game Server, issue a Session or perform a new first-use verification. Production async acceptance/polling already belongs to the APP path, not a collector raw-only HTTP-200 path.

Require successful exit and a valid signed package, then retain the entire output directory. An unsigned `FAILED` diagnostic manifest / exit 2 is not accepted evidence. Require descriptor-referenced exact raw Inventory, Approval and outer response files (`*-origin-inventory.raw`, `*-target-approval.raw`, `*-result-exact.bin`) and all other required artifacts. Every descriptor records size and SHA-256. Never replace the outer artifact with `JSON.stringify(result)`, update a signed descriptor in place or silently re-sign an existing package after mutation.

## 6. Archive retrieval and ordered evidence checks

The chain to check is:

```text
exact raw Presentation
  -> selected independently trusted Notary cryptographic verification / built-in Web PKI
  -> observed canonical lowercase DNS server_identity
  -> independently pinned raw Origin Inventory and membership
  -> independently pinned raw Target Approval, Inventory relationship and membership
  -> derived existing Complete/Sparse canonical profile
  -> semantic predicates / original Session / signed Result
  -> exact outer Worker response, consume receipt and replay digest
  -> exact Presentation/Result archive
  -> independent offline verification in another environment
```

The signed Result must bind actual Presentation bytes by `presentation_sha256` and require the Inventory/Approval digest pair. Check these against independently verified raw artifacts, not just digest strings in Result. Recompute both profile hashes from approved observed identity; compare the appropriate mode and all signed security/subject/binding fields. Health, manifest, metadata and Result identity declarations are cross-checks only. Production Origin verification uses built-in Web PKI, never a custom/synthetic Origin trust root.

Use the completed response/verified execution receipt and actual verification attempt ID to locate retained R2 objects. [Archive key generation](../src/verification_jobs.ts) uses:

```text
tlsn-verification/<verification_attempt_id>/presentation.bin
tlsn-verification/<verification_attempt_id>/result.json
```

Distinguish attempt ID from asynchronous job ID; use the actual record/receipt, not a guessed substitution. Temporary job-input objects are deleted and are not the retained authority archive. [Archive persistence](../src/result_archive.ts) checks stored length/digest before authority commit.

An authorized storage operator downloads both objects from the actual deployed account/bucket into a restricted archive-download directory. With the [Cloudflare R2 dashboard](https://developers.cloudflare.com/r2/objects/download-objects/), select the verified bucket, locate the exact object key, then select `...` and `Download`; existing authorized S3 access is also suitable. Do not create a public download endpoint. Record account/bucket/key, retrieval time and byte size/hash without packaging credentials.

Compare downloaded Presentation byte-for-byte with the package Presentation. Compare downloaded R2 `result.json` byte-for-byte with the package's **exact outer** `result_exact` artifact, not its inner Result JSON. Check the actual receipt's object key/digests as applicable. The R2 filename does not imply an inner Result object. Recompute SHA-256 locally; an object ETag, a UI listing or Worker persistence code alone is not proof of actual retrieval. Missing/truncated/mismatched archives or unknown retention/access remain **BLOCKED**.

Preserve original exact bytes, parsed outer contents, inner signed Result, consume receipt and replay digest as distinct but cross-checked representations. Equivalent JSON serialization is not equivalent raw artifact integrity. Any byte change in a signed package fails its original size/hash/signature contract.

## 7. Independent verification on a separate environment

Prepare machine B before gameplay/capture. It must not inherit machine A's secret environment or select authorities from the transferred package.

1. Obtain a fresh checkout of the independently approved verifier/release SHA, not a SHA chosen from the package. Record the commit and toolchain. Install locked dependencies and prepare WASM with the existing build/provenance commands **before** network isolation. A cold dependency install is not an offline operation.
2. Obtain external registries/envelope, Root/evidence-signer pins, Inventory/Approval files and expected deployment/security/Result identities through the authorities in section 2. Acquire the correct live release/version records independently. Do not copy `health` or manifest fields into the expected-identity JSON to make comparison pass.
3. Prepare expected subject identity from the independently authenticated user/device and verified original Session. Any member-derived hash must come from independently cryptographically/semantically verified Presentation, not a Result/manifest member declaration. Retain acquisition and derivation records; a subject expectation copied from the package is not an independent check.
4. Transfer the complete signed package and exact archive downloads through approved restricted storage. Separately supply the reference snapshot. Preserve raw bytes and relative descriptor paths; do not transfer bearer tokens or private keys.
5. Set the shared public trust variables from section 5, disclosure/selected key IDs, evidence-signer public pin and these offline-only variables:

```text
TLSN_PRODUCTION_EVIDENCE_MANIFEST_PATH
TLSN_PRODUCTION_EVIDENCE_EXPECTED_DEPLOYMENT_IDENTITY_JSON
TLSN_PRODUCTION_EVIDENCE_EXPECTED_SECURITY_IDENTITY_JSON
TLSN_PRODUCTION_EVIDENCE_EXPECTED_RESULT_IDENTITY_JSON
TLSN_PRODUCTION_EVIDENCE_EXPECTED_SUBJECT_IDENTITY_JSON
```

Use independently recorded **capture** workflow context and actual deployed identity; do not reuse Run #70 as a real capture run. Expected security includes independently pinned policy/registry digests. If an expected identity contains hostname/profile fields, derive them through verified Presentation and external references rather than candidate configuration. The offline consumer independently inspects Presentation and reconstructs approval/profile again.

One concrete way to avoid altering raw registry strings is an operator-controlled JSON object mapping environment variable names to string values. Store it **outside** the package; include only required public/reference/context/path inputs above, no private keys/tokens or module/test hooks. Paths must point to machine B's independent references and transferred package. This JSON is operator configuration, not an artifact whose contents are trusted merely because it was copied.

From the prepared Worker checkout on machine B:

```sh
export TLSN_OPERATOR_OFFLINE_ENV_PATH=/operator-controlled/reference/offline-env.json
env -u NODE_OPTIONS -u NODE_PATH node --input-type=module <<'NODE'
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const config = JSON.parse(readFileSync(process.env.TLSN_OPERATOR_OFFLINE_ENV_PATH, "utf8"));
if (Object.values(config).some(value => typeof value !== "string")) {
  throw new Error("Offline environment values must be strings");
}
const child = spawnSync(process.execPath, ["scripts/verify-production-evidence.mjs"], {
  env: { PATH: process.env.PATH, ...config },
  stdio: "inherit",
});
if (child.error) throw child.error;
if (child.status !== 0) throw new Error(`Offline verification failed: ${child.status}`);
NODE
```

The path is illustrative; use the actual approved reference storage, not a file supplied inside the package. The existing `pnpm run verify:production-evidence` also runs this verifier but builds WASM first; direct Node invocation above assumes that verified build is already present. The verifier performs no HTTP requests. Record stdout/stderr, exit status, verification time, checkout/WASM provenance, external-reference hashes and archive comparisons in restricted validation records.

The existing manifest freshness default is **900 seconds**. Prepare machine B in advance and verify promptly after capture with a correct UTC clock. Do not disable freshness, alter the clock, silently enlarge the age policy or re-sign an old package merely to refresh it. A stale package fails this acceptance verification; do not describe this CLI as an unlimited historical-acceptance mode. Keep approved registry snapshots and actual key validity/revocation consistent throughout the acquisition/verification interval.

Successful offline verification establishes only the chain it actually checked. It does not attest APP/Browser integrity, prove human behavior cryptographically, or promote the manifest's fixed governance/acceptance statuses.

## 8. Operator handoff and acceptance record

Keep these separate in the final real-evidence report:

- **Deployment evidence:** approved release SHA/context, public manifest/provenance/remote gate, actual active Worker/version record, live health and public registry/authority agreement.
- **Human/operator record:** authenticated account/device ownership, private-key availability through the existing APP path, supported runtime/configuration, real gameplay time/operation and actual APP bundle location. No private key/token is attached.
- **Primary evidence:** original nine-file APP bundle, execution receipt if emitted/required, signed Result, original outer bytes, raw references, signed package descriptors, downloaded exact R2 objects and byte comparisons.
- **Independent verification:** separate-environment checkout/build context, external authorities/references, reconstructed identity/profile/semantic/subject checks, verifier exit/output/time and unchanged freshness policy.
- **Unresolved blockers:** any unknown endpoint/pin/deployment/version, unsupported APP Production health path, missing/stale/mismatched required evidence, archive retrieval or independent verification, plus existing human/governance/privacy decisions not established by cryptographic proof.

No new runtime/security machinery is required by this documentation. Closed consumer/signing/ABI/policy/byte-binding code needs no further redesign for this handoff. The existing APP Production-entry compatibility stop is explicitly recorded, not patched or bypassed here.

Real deployment, real Game Server/Notary interaction, human gameplay, real TLSN Presentation, signed Production Result, exact retained/retrieved archives and independent offline verification are necessary primary-evidence conditions for a later acceptance review. Their actual existence and verification must be reported individually; no CI result substitutes for them. Until that review and the existing operational conditions are satisfied, **Production acceptance = BLOCKED**. This runbook and the current capture/verifier never auto-promote it.
