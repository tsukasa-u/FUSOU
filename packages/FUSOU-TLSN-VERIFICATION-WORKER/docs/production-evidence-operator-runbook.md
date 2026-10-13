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
- [The existing human-gameplay preflight](../scripts/human-gameplay-preflight.mjs) is an offline candidate/governance report. `PASS_LIMITED` does not authorize gameplay: `readiness_status` and `gameplay_authorization` remain `BLOCKED`, with no network access or game start. Its post-Presentation predicates cannot be satisfied merely by predicting a candidate hostname before first capture. The APP-specific pre-capture launch below is a separate local software-readiness check, not a replacement or authorization.
- [The APP config renderer](../scripts/production-trust-contract.mjs) validates its manifest inputs but emits only `enabled`, disclosure/response mode and artifact output path. Its fragment does not supply all compile-time trust pins, health expectations, endpoints or `candidate_capture_enabled`. Do not assume rendering it completes APP setup.
- Production [Wrangler configuration](../wrangler.toml) now declares `CF_VERSION_METADATA`. [Main Worker health](../src/index.ts) can report that runtime's version ID after deployment; the binding alone does not establish which version is actively serving traffic. It does not return the separate signed Canary Runtime Attestation. Obtain the active deployment/traffic mapping independently as below; do not invent a signed Production health attestation.

All steps below are conditional operating instructions. Until these stop conditions and the required real inputs are resolved without bypass, do not begin real Production gameplay.

### Initial testplay candidate launch: pre-capture boundary

First acquire the Worker reference by running `node packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/capture-app-worker-reference.mjs` from the repository root. Supply the independently obtained files through `TLSN_PROVENANCE_REPORT_PATH` and `TLSN_PUBLIC_MANIFEST_PATH`, choose a new non-overwriting `TLSN_APP_WORKER_REFERENCE_PATH` outside the evidence package, and provide the approved release pins and read-only Cloudflare control-plane credentials required by the deployment contract to the process environment. The existing [`app-worker-deployment-reference.mjs`](../scripts/app-worker-deployment-reference.mjs) acquisition checks the active deployment/version and HTTPS endpoint mapping, and re-observes deployment and mapping to fail if they change during capture. Do not run this control-plane acquisition until the Infrastructure/Release operators have authorized it; stop if any required authoritative input or approval is unavailable. The acquisition was not performed as part of this implementation.

Independently review the acquired reference against its provenance and public manifest, then recompute the digest from the exact file bytes with a separate trusted local process. The launch option requires SHA-256 encoded as unpadded base64url:

```sh
node --input-type=module -e 'import { createHash } from "node:crypto"; import { readFileSync } from "node:fs"; process.stdout.write(createHash("sha256").update(readFileSync(process.argv[1])).digest("base64url") + "\n")' /absolute/path/to/approved-worker-reference.json
```

Record that digest independently; do not treat the capture tool's own log or the reference file's self-description as its independent pin. If provenance, manifest, deployment/version, mapping or the independently recomputed digest cannot be verified, stop.

Then use [`testplay-verify.mjs`](../../FUSOU-APP/scripts/testplay-verify.mjs) with `--tlsn-candidate` only from a clean, reviewed candidate-source checkout. The APP build handoff requires an approved source revision and rejects a dirty checkout. The command takes the approved Worker reference and its independently recorded raw-byte SHA-256, the approved Worker and APP source SHAs, the locked Rust toolchain, and private output directories; it does not retrieve or approve a Worker reference itself:

```sh
cd packages/FUSOU-APP
node scripts/testplay-verify.mjs \
  --tlsn-candidate \
  --worker-reference /absolute/path/to/approved-worker-reference.json \
  --reference-sha256 <independently-recorded-raw-reference-sha256-base64url> \
  --worker-sha <approved-worker-source-sha-40-hex> \
  --app-sha <candidate-app-source-sha-40-hex> \
  --toolchain <locked-rust-toolchain-version> \
  --profile release \
  --build-output /absolute/path/to/private-app-build \
  /absolute/path/to/empty-private-capture-directory
```

Replace every placeholder only with independently approved values; this example supplies no deployment, URL, key, SHA or toolchain value. The launch path validates the reference against its independent digest, checks the Worker deployment/version/endpoint/authority mapping and the 15 compile-time inputs in the shared APP entry-input contract through [`app-build-handoff.mjs`](../scripts/app-build-handoff.mjs), then builds the APP and checks the compiled-entry report from the actual binary. It writes the temporary candidate capture configuration with ordinary persistence/uploads disabled, invokes that same binary's `--tlsn-preflight --config <effective-config>` mode, checks the Rust report, and saves `tlsn/pre-capture-readiness-v1.json`. Before launching, it rechecks both the reference bytes and the actual binary digest, then starts the exact binary with `--tlsn-candidate-config <effective-config> --tlsn-candidate-start-marker <private-marker>`. The candidate-only CLI loads that path before Tauri setup; config setup and subsequent TLSN preflight use the same path rather than silently falling back to the release app-data config. It repeats the candidate pre-capture checks in the running APP process and writes the start marker only after Tauri setup loads the candidate configuration. A successful child-process exit without that marker (for example, when the existing single-instance handler forwards the invocation to another APP process) is rejected.

`LOCAL_APP_PREFLIGHT_PASS` means only that the local reference/build/configuration checks passed. The report leaves `authority_status` `UNVERIFIED`, `gameplay_authorized` false, and `production_acceptance` `BLOCKED`; its target identity is `NOT_YET_OBSERVED` with no server identity. It does not run gameplay or establish Auth/device eligibility. The running APP must still pass its live Worker identity/version check, valid Auth session, registered-device and binding checks; a human operator must separately authorize ordinary gameplay under the applicable operational rules. Stop on any missing or mismatched pin, build report, APP preflight check, live authority, Auth session, registered device or approved operating condition. Do not bypass a failure, substitute a dev binary, or infer the Game Server identity from configuration, health, manifest or Result.

The target's actual identity is established only from the captured TLSN Presentation and its verification. Continue to use the existing post-capture Inventory/Target Approval, exact-byte, evidence archive and independent-verification gates unchanged. A successful pre-capture report, testplay, fixture, mock or CI result does not satisfy Production acceptance.

### APPビルド再現性とローカル検証

APPのCargo lockfileは [`packages/FUSOU-APP/src-tauri/Cargo.lock`](../../FUSOU-APP/src-tauri/Cargo.lock) の1ファイルだけをGit管理する。ルート `.gitignore` の `Cargo.lock` 除外にはこのパスだけ例外を設ける。他パッケージのlockfileを一括で追跡対象にしない。APP build handoff は、承認済みclean source revisionにlockfileが実在し、`git ls-files --error-unmatch` でGit管理下と確認できる場合だけビルドを開始する。lockfileが欠落・未追跡、またはAPP sourceと一緒にdirtyになっている場合は停止する。handoffはビルド前後のbytesを比較し、SHA-256をBuild recordへ記録する。ビルドは `--locked` で実行する。

APP manifestの `rust-version = "1.81"` は最低互換バージョンであり、使用する正確なビルドtoolchainのpinではない。TLSN candidate用PR workflowは `1.98.1` を固定して使用する。既存の一般APP build workflowの `stable` 指定は別経路であり、移動するchannelのままである。candidate handoffでは実行toolchainを明示し、実際の `rustc` / `cargo` version一致を確認したうえで、Build recordに記録する。異なるtoolchainを使う場合は、そのバージョンで同じlocked test/buildを実行してから採用する。

依存変更を意図的に行う場合のみ、APP manifest directoryでlockfileを生成・更新し、その差分をレビューする。lockfileを通常のビルドで更新したり、`cargo update` で無計画に依存を進めたりしない。

```sh
cd packages/FUSOU-APP/src-tauri
cargo generate-lockfile
git diff -- Cargo.lock
cargo metadata --locked --filter-platform x86_64-unknown-linux-gnu --format-version 1
cargo test --locked --features tlsn-production tlsn_preflight --lib
```

candidate regression testsは次で実行する。PRでは [`tlsn-testplay-candidate.yml`](../../../.github/workflows/tlsn-testplay-candidate.yml) が同じJS契約テストと `--locked` Rust preflight testsを走らせる。

```sh
pnpm --dir packages/FUSOU-APP run test:clean-capture
node --test \
  packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-build-handoff-test.mjs \
  packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-dotenvx-inputs-test.mjs \
  packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-worker-deployment-reference-test.mjs \
  packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-worker-endpoint-mapping-test.mjs
```

これらのfixture / mock tests、Cargo lock検査、CI結果はソース・依存固定・ローカル契約の検証であり、承認済みWorker referenceの取得、secret利用可能性、実APPの運用承認、実Gameplay、実Presentation／Result／archiveの取得やProduction acceptanceを証明しない。これらの実運用ゲートは引き続き別途満たす必要がある。実Productionサービスへの接続やsecret取得をローカル検証の代替として行わない。

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
| Exact active Worker version/deployment identity | Authenticated Cloudflare Workers Deployments API's first/latest active deployment, plus its Version detail and endpoint mapping | Infrastructure operator | One version at 100%; public release bindings agree; active deployment and endpoint mapping unchanged during handoff; exact APP pin versus live health | No; account context sensitive | Restricted public record yes | Yes |
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
2. The infrastructure operator uses an account-scoped Cloudflare API token with `Workers Scripts Read` (or the existing deploy token's required permissions) over authenticated HTTPS. Custom Domain checks additionally require read access to the selected zone and `Workers Routes Read`. The [handoff implementation](../scripts/app-worker-deployment-reference.mjs) requests:
   - [List Worker Deployments](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/): `GET /accounts/{account_id}/workers/scripts/{script_name}/deployments`. Cloudflare defines the **first** entry as the latest deployment actively serving traffic. Merely finding a historical matching version is insufficient.
   - [Get Worker Script Version](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/get/): `GET /accounts/{account_id}/workers/scripts/{script_name}/versions/{version_id}` for that active version.
3. Require exactly one version with 100% traffic. Match the active version's public environment/role, Git SHA, logical deployment ID, Worker name, Result registry/public authority/Root envelope, Session public authority, Notary selection/registry, Verifier selection and security registry-set binding to the approved release. Reject forbidden Canary/Test bindings; Production `random` is derived by the existing Worker source, not a new Worker binding-mode variable. Require `CF_VERSION_METADATA`. Verify endpoint mapping as below, then re-read both active deployments and mapping and reject changes during acquisition.
4. Store the new schema-2 reference in restricted **operator-controlled storage outside the evidence package**. `flag: "wx"` prevents overwriting a prior reference. The record preserves acquisition time, distinct Cloudflare deployment/version IDs, account/script/API sources, approved release context, checked public bindings, endpoint mapping and the complete public Worker-entry `compile_inputs`. It deliberately excludes API credentials, private keys and unrelated/secret version bindings. Preserve the authorized release/control-plane acquisition record and independently approve its exact raw SHA-256 in base64url form; the resulting JSON is an unsigned operator handoff, not a new cryptographic root or Runtime Attestation. A hash computed from an arbitrary supplied file is not independent approval. Schema-1 references lack mapping and must be reacquired; the builder does not silently upgrade them.
5. Use the dedicated [approved APP builder](../scripts/build-approved-app.mjs) to pass those exact `compile_inputs` into the APP build environment, especially `FUSOU_TLSN_EXPECTED_ACTIVE_VERSION_ID`, and compare the actual resulting binary's offline report. They are compile-time `option_env!` inputs; putting reference JSON in APP config, changing user TOML, running frontend-only `pnpm run build`, or merely exporting a variable is not verified binary handoff. Handoff defaults to the existing `complete` mode; select `TLSN_PRODUCTION_DISCLOSURE_MODE=sparse` to derive the existing same-origin `/verify/tlsn/sparse` route from the approved manifest endpoint. The effective APP TOML disclosure mode must match the handoff's `disclosure_mode`. Preserve raw registry strings, including trailing newlines. Do not use shell command substitution, `eval`, or JSON reserialization to replace registry bytes.
6. Only after the expectation exists does APP contact the pinned `/health`. The health and verification URLs must be canonical HTTPS DNS URLs on the **same approved origin**, with no credentials, nondefault port, query, fragment or normalized path manipulation. Health path is `/health`; verification is `/verify/tlsn` or the existing same-origin `/verify/tlsn/sparse` route and must match the effective disclosure mode. Health, verification/status and Session clients do not follow redirects. A correct health URL paired with another Worker's verification URL is rejected.

To refresh a handoff for an already authorized release, use `pnpm run capture:app-worker-reference` with the same independent release inputs, context, Cloudflare credentials and a **new** `TLSN_APP_WORKER_REFERENCE_PATH`. It does not contact health, the Game Server, Auth or device services. Never extract its authorities from a captured evidence package.

#### Read-only endpoint/account/script mapping

The old reference only checked approved origin strings. Schema 2 also records [control-plane mapping](../scripts/app-worker-endpoint-mapping.mjs):

- **workers.dev:** [account subdomain](https://developers.cloudflare.com/api/resources/workers/subresources/subdomains/methods/get/) and [script subdomain availability](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/subdomain/methods/get/) must yield exactly `{script}.{account-subdomain}.workers.dev` with `enabled: true`. Preview URL availability does not authorize a preview endpoint.
- **Custom Domain:** [List Worker Domains](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/list/) filtered by the approved hostname must return exactly one complete mapping to the selected script's default Cloudflare `production` environment. [Zone Details](https://developers.cloudflare.com/api/resources/zones/methods/get/) must confirm the domain's active zone, zone name and same account. [List Worker Routes](https://developers.cloudflare.com/api/resources/workers/subresources/routes/methods/list/) for that zone must return an empty list. Cloudflare's deprecated domain `environment` is not FUSOU's role; public bindings independently enforce the latter.
- [Routes take precedence over Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/routes/). Therefore **any** Worker Route in the zone, even an apparently unrelated or same-script route, conservatively blocks this minimal helper. Route-only, wildcard routing and partial/multi-page domain results are unsupported, not silently accepted. Review the complete zone routing with the existing read-only APIs before proposing a separately tested extension; do not bypass this check.

All requests are authenticated GETs to fixed Cloudflare HTTPS API paths, with redirects forbidden. HTTP errors, permission failures, malformed JSON, missing metadata or unsupported mapping fail closed without taking values from health. Both routing and active traffic are re-observed; this detects observed races, not an atomic Cloudflare snapshot or changes after acquisition. Reconfirm immediately before release/gameplay. These checks do not attest other Cloudflare routing products, network/application integrity, or an independent cryptographic Result issuing-version claim.

The guarded Production deploy still performs all its existing gates before acquiring a reference. Mapping/build helpers introduce no alternate deploy path and never change Cloudflare resources.

#### Reference → actual APP artifact

Use an independently approved, clean APP checkout and installed dependencies/toolchain. Keep Cloudflare/deployment credentials in the acquisition environment, not the public build environment. Retain separate approved Worker SHA and APP SHA; they may differ. From the repository root:

```sh
pnpm --dir packages/FUSOU-TLSN-VERIFICATION-WORKER run build:approved-app \
  --reference /restricted/release/worker-reference-v2.json \
  --reference-sha256 APPROVED_RAW_REFERENCE_SHA256_BASE64URL \
  --worker-sha APPROVED_WORKER_40_CHARACTER_SHA \
  --app-sha APPROVED_APP_40_CHARACTER_SHA \
  --toolchain 1.95.0 \
  --profile release \
  --output /restricted/builds/new-unique-app-build
```

The output directory must not exist; its parent must exist outside the checkout. `--profile debug` is available for source/mocked smoke testing. No reference field needs manual transcription into an environment variable:

1. Validate the independently approved raw file hash, strict reference/public-input inventories, Production pair, Worker source pin, Cloudflare identity and verified endpoint mapping.
2. Require a clean checkout matching the independent APP source SHA. Reject inherited TLSN input conflicts, including stale versions; an empty parent environment is populated from the approved reference. Preserve the exact 15 raw strings, not trimmed config getters.
3. Load the **existing APP dotenvx inputs**, relative to `packages/FUSOU-APP`: `../.env.keys`, `.env`, then `src-tauri/.env`. All three must exist as regular, non-symlink files. The installed dotenvx engine uses the normal APP script's explicit key file and `--overload` precedence: file values override ambient public values, and the second file wins. Loading runs in an isolated worker with strict decryption errors, quiet/discarded output and no external dotenvx operations. Only approved public inputs and dotenvx key-resolution variables enter that loader; a decryption key supplied through the environment precedes the key file, matching dotenvx. The builder has no alternate-file CLI flag and rejects normal-script/precedence drift. Do not wrap this builder in verbose dotenvx or manually copy decrypted values into shell history.
4. Require file-derived `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_PUBLISHABLE_KEY`: APP initialization unconditionally constructs Auth, so the dedicated Production build must embed them, not depend on runtime fallback. The key must be a public publishable/anon key, never a service-role/private key. `DISCORD_CLIENT_ID` is optional because Discord integration defaults to disabled; absence is explicitly `null` in the public configuration digest. If supplied, it must be numeric and must match the binary. Enabling Discord requires its ID. Ambient Auth/Discord inputs or `.env.local` cannot supply missing declarations in the canonical files.
5. Use a fresh Cargo target under the new restricted output directory. Pass only these validated public APP inputs, the approved TLSN inputs and ordinary tool-location variables to Tauri/Cargo. Do not inherit `NODE_OPTIONS`, compiler wrappers/flags, dotenv keys, Cloudflare tokens or Worker/device/evidence/APP/updater signing private keys or passwords. Decrypted non-public dotenvx fields never leave the isolated loader. This is a **no-bundle** build; installation/updater signing credentials are not needed.
6. Select exact Rust toolchain and verify actual Rust/Cargo versions. Invoke **`pnpm exec tauri build --ci --no-bundle --features tlsn-production,custom-protocol -- --locked`**, not the overloaded `pnpm tauri` wrapper. Tauri runs the existing frontend hook; the desktop custom protocol is explicitly enabled for both release and debug builds rather than inferred from CLI mode. This builds the actual native APP executable, not just a frontend or a separate example/probe. Installation bundles/updater signing are deliberately separate release steps and must use this verified artifact rather than an unrecorded rebuild.
7. Before GUI/auth/network startup, execute that artifact with `--tlsn-compiled-worker-entry`. Its offline report derives the unchanged domain-separated [entry-input v1 digest](../scripts/app-worker-entry-input-contract-v1.json) from the same raw `option_env!` config source used by runtime. Require exact digest, active version, distinct Worker/APP source SHAs, profile and features.
8. Execute the same artifact with `--app-compiled-public-configuration`. Its separate [public configuration v1 digest](../scripts/app-public-configuration-contract-v1.json) reads **fusou-auth's actual compiled constants** and the same Discord getter used by runtime. Require exact digest and optional-Discord presence against canonical dotenvx acquisition. Only digest/presence/status is printed, never raw configuration. Missing compiled Auth, substituted values or malformed reports cannot produce a success record. The old `public_app_build_inputs_sha256` remains an environment trace, not embedded-value proof.
9. Recheck reference bytes, dotenvx file identities/change times, isolated build environment, clean source SHA, lock/config and artifact bytes. Write schema-2 `app-build-record.json` once (0600) under the restricted directory (0700). In addition to the prior reference/entry/source/toolchain/artifact correspondence, the record includes the versioned public digest, actual binary public report and explicit comparison result. It records canonical paths and env-file hashes, **not** decrypted settings, dotenvx private keys or a key-file digest. Raw environment, tokens and child logs are not retained; command failures are explicit stage/exit errors without raw output that might disclose credentials.

Hosted verification uses an encrypted **public-only temporary fixture**, with this same relative file layout, dotenvx engine and precedence, injected solely through the internal acquisition provider. Production CLI input paths are unchanged, and tracked encrypted APP files are never replaced for CI. Test decryption material and fake disallowed-secret markers are confined to that fixture/loader; no Production keys are supplied. The actual native executable must match its public digest even when executed with deliberately different runtime Auth/Discord values. CI fixture success is not approval of real Auth deployment or real Production evidence.

The Hosted APP build-handoff job separately runs `app_public_configuration::tests::public_configuration_requires_auth_and_binds_optional_discord` with `--lib` and `--exact`, using the committed public contract test vector, pinned Rust 1.95.0, locked/offline Cargo and an allowlisted `env -i` environment. This unit step neither loads Production dotenvx files nor calls external services. Its log must contain the exact named test passing and `1 passed; 0 failed; 0 ignored`; zero-test selection fails the step. `PASS=1 FAIL=0 SKIP=0` is unit-test evidence, separate from the encrypted-fixture native smoke and never real Production evidence.

A failed build directory is not a successful record and cannot be reused. Diagnose failures in a public-only tool environment, then start a new output directory with the same independently approved inputs. Reference changes/replacements and output reuse are rejected. An unchanged approved reference may support reproducible fresh builds; approval of its hash must still be current. Supplying an old reference against the newly approved raw hash fails immediately. The builder is offline with respect to Cloudflare and cannot discover a later deployment rotation; an old correctly built binary still refuses a new observed Worker version at runtime. A compromised local compiler/process/filesystem is not addressed by this traceability mechanism.

Run the existing renderer/preflight on the effective capture TOML separately. Record that configuration through its existing runtime fingerprint/capture metadata; user TOML must not overwrite deployment compile pins. Retain the builder record and unsigned health observation with independent operator references. A build record's `compiled_input_comparison: VERIFIED` means exact local build-handoff comparison; its `authority_status: UNVERIFIED` is intentional. It is not a signed attestation, APP binary/process authority, measured boot or Production acceptance.

#### Fingerprint disposition and consumer limits

Keep [fingerprint v2](../scripts/app-configuration-fingerprint-contract-v2.json) and its Rust/Node test vector unchanged. It is an explicit **fixed projection**, not all APP compile-time trust configuration: 14 deployment/public fields and four runtime flags/modes. It excludes active version, APP source/toolchain/artifact, capture output paths and other frontend/Auth configuration. APP preflight emits it; proxy capture metadata carries it; Rust/Node candidate artifact identity treats its digests as opaque configuration traces; the candidate finalizer/configuration-binding consumers assess it under their existing separate contracts. Those consumers do not reconstruct or prove the active pin from v2. Metadata remains `UNBOUND`; no new builder signature/authority is added.

The separate entry-input v1 digest selects exactly all 15 raw Worker-entry compile inputs, **including active version**. It lives in the actual binary's offline report and operator build record, not the unchanged capture schema. Pin-only V1 → V2 rotation leaves v2 unchanged by design but changes this digest. Auth/Discord changes do not alter entry v1 or fingerprint v2; they change the separate public configuration v1 digest, whose exact three-field projection includes optional Discord absence. Runtime TOML flags and other APP inputs remain outside both compile-input digests. APP/source/toolchain/artifact correspondence is explicitly represented by the build record instead; these digests are configuration traces, not all-config coverage, binary/process authenticity or AD-5 authority.

Keep the following distinct: Git commit SHA; FUSOU logical deployment ID; Cloudflare deployment ID; Cloudflare version ID; unsigned health response; existing signed Runtime Attestation. Health metadata remains `unsigned-https-health-response`, `signature_valid: false`, `authority_status: UNVERIFIED` even when its cross-check succeeds. It establishes only an observation at the approved HTTPS endpoint consistent with independent deployment/public Result expectations. It does not prove APP/image/browser integrity, Game Server identity, Presentation cryptography or an independent cryptographic issuing-version claim for Result.

**ROTATION MODEL:** for Worker A, V1 → V2 requires a fresh authenticated schema-2 handoff, approval of its new raw hash, and a fresh APP build/record/release with V2's compile-time pin. Keep V1 reference/artifact/record immutable and distinct; do not patch the old record or reuse its output directory. V1's binary/pin rejects V2, and an unrelated valid UUID also rejects. Worker name, logical deployment ID, Result authority and approved Game Server set may remain unchanged. Version rotation alone never changes Game Server identity or requires a new Target Approval; update Approval only through its existing independently authorized policy change. A multi-version rollout is unsupported by this entry contract and remains blocked rather than accepting an arbitrary served version. Reconfirm the active mapping immediately before gameplay.

**NEGATIVE TEST MATRIX:** APP source tests cover both distinct role identities, root/nested/missing role/binding, wrong deployment/name/SHA, missing/stale/unrelated version and missing independent expectations, Result signer/key/registry substitutions, endpoint host/origin/path/query/HTTP mismatches and no-redirect clients. Handoff tests cover historical versus active selection, split/partial traffic, release/Root/registry substitutions, duplicate/wrong public version bindings, missing version metadata, rotation races and zero health requests. These tests do not substitute for real deployment or gameplay evidence.

### TLSN runtime configuration manifest — authenticated contract implemented, Production blocked

Manifest schema 2 now binds the Worker reference digest, Production authority digest pair, Result registry/envelope digests, and Result registry root identity inside the Runtime Config manifest signature. Node and Rust use the same V2 scope and domain-separated Ed25519 signing bytes. The cross-language `test_only` vectors in [`tlsn-runtime-config-manifest-v2-vector.json`](../scripts/fixtures/tlsn-runtime-config-manifest-v2-vector.json) and [`tlsn-runtime-config-independent-v2-vector.json`](../scripts/fixtures/tlsn-runtime-config-independent-v2-vector.json) cover the shared contract. V1 is rejected; no Production V1 publisher/root was registered.

With `tlsn-production` enabled, the APP verifier first verifies the manifest signature, freshness policy, and exact schema, then compares fetched raw artifacts against digests authenticated by that signed payload. It re-hashes the exact Worker reference bytes and checks Result registry bindings in the reference; it re-hashes and structurally checks the Origin Inventory, Target Approval and security registry set; it hashes the UTF-8 Result registry string and exact signed-envelope bytes and verifies the envelope's Ed25519 signature using the root key ID/SPKI carried by the authenticated Runtime Config manifest. The Result registry root remains distinct from the Runtime Config signer, updater signer, Canary attestation signer and Notary key. A digest's format alone is not evidence of authenticity; a manifest digest is useful only after the manifest signer is authenticated.

The bounded Rust fetch interface is wired into the APP's TLSN path. Tauri startup registers a `RuntimeConfigManager` and makes a best-effort refresh; the authoritative gate is in `serve_proxy`, which must fetch and verify the manifest and all raw artifacts before runtime preflight, Worker health observation, certificate setup, or production TLSN dependency construction. Worker endpoints, Result verification inputs, Notary endpoint/key, expected Worker identity, disclosure mode and approved targets come from the verified manifest/artifacts, not compile-time Worker values in `configs.toml`. Local configuration still controls opt-in, response mode, capture and output policy. The fetcher accepts only the compiled bootstrap endpoint at `/tlsn/runtime-config/v2/manifest.json`, requires canonical HTTPS DNS with no explicit port/query/fragment, disables redirects, applies 5-second connect and 15-second request timeouts, and streams each response under a byte cap. It verifies the signed manifest before deriving same-origin content-addressed artifact URLs.

The embedded endpoint and signer fields in `tlsn_runtime_config_manifest.rs` remain deliberately `None`; `RuntimeConfigBootstrap::from_embedded()` therefore fails with `Production Runtime Config bootstrap is not registered`. Consequently the new APP gate currently blocks TLSN before TLSN transport or binding issuance. This is intentional until the separately approved Production Runtime Config signer public key and fixed HTTPS endpoint are enrolled. No Production trust root or endpoint is registered, and compile-time Worker settings or health observations are not substitutes.

The Node publication-object builder validates a signed V2 manifest and emits immutable object keys under `tlsn/runtime-config/v2/artifacts/<kind>/<sha256-base64url>`, followed by the mutable `tlsn/runtime-config/v2/manifest.json` pointer with `no-store` metadata. It does not sign, upload, or publish. No suitable existing TLSN config store/domain was found; the existing workflow R2 bucket is unrelated. The selected delivery design is a dedicated public R2 bucket on a controlled custom domain; Cloudflare documents `r2.dev` as development-only, so it is not an acceptable Production endpoint. Bucket/domain provisioning, upload credentials and publication automation have not been created or operated.

Initial trust enrollment requires a separately managed Runtime Config Ed25519 signer, public key and stable custom-domain manifest URL embedded in a reviewed APP release. The private key must be controlled outside the repository and separated from APP updater, Result registry, Canary and Notary authorities. No key was generated or registered. Root-transition/rotation protocol, signing service, publication operation and deployment workflow are not implemented; until those are approved, all Production runtime config remains `BLOCKED_EXTERNAL_INPUTS`.

The manager supplies the current OS UTC clock and reads a local per-user high-water state containing the last accepted epoch and exact manifest-envelope digest. It persists a higher epoch atomically only after full manifest and artifact verification; an identical envelope at the same epoch may be revalidated, while rollback or same-epoch different bytes are rejected. This is local state, not an adversary-resistant monotonic store: the OS clock is not an independent trusted time source, and the local owner can alter or delete the state file. There is no verified-config cache; each proxy start and each TLSN request revalidates the complete signed configuration before binding issuance and again immediately before the origin transport factory is called. A changed digest or refresh error blocks the corresponding action; a newly accepted digest differing from the one used to build the running proxy requires proxy restart before using the new configuration. The final check narrows the binding-to-network TOCTOU window but is not atomic with the external mutable manifest pointer; a pointer change immediately after the check cannot be excluded. Local verification tests do not establish secure persistent rollback defense or Production readiness. The attestation implementation plan remains `NO-GO (0/17 PASS)`.

The Node release module now accepts an injected signer provider only when its key ID and SPKI match the independently supplied Runtime Config trust pin. It signs the domain-separated manifest bytes, verifies the resulting envelope plus all independent raw artifacts, writes content-addressed artifacts through an injected object-store interface, reads each one back byte-for-byte, reacquires the approved Worker reference using the existing authenticated Cloudflare control-plane checks, and only then attempts the mutable manifest pointer update with an atomic ETag compare-and-swap. The adapter contract treats a null expected ETag as create-if-absent and a non-null ETag as update-only-if-current; CAS must return the committed ETag. The module reads the manifest body and ETag back after CAS and refuses success if either differs. Bad signer identity/signature, artifact readback mismatch, changed active deployment/mapping, or a CAS race fails without this publisher committing the pointer. Immutable objects written before a later failure may remain as unreferenced content-addressed objects.

This is orchestration logic and fake-store coverage, not a Production signer or publisher deployment. There is no Runtime Config signing service/provider configured, no Production trust root or endpoint registered in APP, and no concrete Cloudflare/R2 object-store adapter demonstrating atomic conditional writes, immutable-create behavior, credentials, or external readback. The test signer is ephemeral and test-only. The custom-domain R2 delivery design remains a proposal until the storage adapter's atomic CAS semantics and public endpoint are verified and approved; no Cloudflare API, bucket, domain, key, or Production object was operated in this work.

Runtime gate/release validation in this worktree: the four Node Runtime Config/Worker/build-handoff/endpoint suites passed 40/40; APP tests with `tlsn-production` passed 66 library tests plus 10 integration tests, with one existing ignored library test; the no-Production APP library suite passed 26/26 using the explicit `kc-api-epoch-20250627` feature; proxy HTTPS with `synthetic-tlsn` passed 95 tests with one ignored; and `fusou-auth` passed 13/13. The focused APP transport-gate tests passed 3/3, including unchanged config forwarding once, changed/unavailable config blocking before inner transport, and a change after binding-time revalidation blocking the later origin call. Changed-file `rustfmt --check` and `git diff --check` passed. APP production-feature Clippy completed with 24 warnings; the reported `wrap_proxy.rs:584` needless-return warning is on the existing proxy URL return, not the new guard. No Hosted CI or Production operation was run; the missing embedded Production signer/URL and concrete publisher adapter keep runtime use blocked.

#### Pre-commit “test gap” audit

The local `.git/hooks/pre-commit` invokes `code-review-graph update` and `code-review-graph detect-changes --brief`, both with `|| true`. The hook is non-blocking and its “test gap” count is a static symbol-to-`TESTED_BY` graph heuristic, not executed-test coverage or branch coverage. The original report was reproduced with `code-review-graph` v2.3.6 and base `1a0c627405d6e6998a3b22ffb9729f1f1d858eac`: 13 changed files, 62 changed symbols, 58 symbol gaps, risk score 0.60. After the focused test additions, the same-base rerun reported 16 changed files, 75 changed symbols, 65 symbol gaps, risk score 0.60. The seven additional entries are four Rust test helpers, one Node test helper, and two production helpers; they are not seven newly discovered vulnerabilities.

The 65-symbol table below is a historical snapshot from the offline-manifest audit before the APP Runtime Config manager and TLSN gate were wired. It is not the current hook result. Its `ProductionAuthorityPins` gap records the earlier implementation state; subsequent code added independent raw artifact verification, but Production remains blocked because the embedded manifest signer and endpoint are not enrolled. Runtime Config manager/provider symbols added after that snapshot are not included or classified in the table.

For the gate-wiring follow-up, `code-review-graph update --base f1525fb1bac80d99444f427807a00b0698a6148c --repo . --brief` and the matching full `detect-changes` were run. The current diff snapshot reported 12 changed files, 56 changed functions/classes, 52 static test gaps, and risk score 0.60. The highlighted names were `run`, `TlsnPreflightConfig`, `from_verified_runtime_config` (two symbols), `run_verified_runtime_preflight`, and `fmt`; `fmt` already has direct string assertions but is still reported by the graph. The complete 52-entry list was retrieved but not individually reclassified in this follow-up, so this is not `PASS_GAP_AUDIT`. The count is a graph heuristic, not executed-test coverage.

The exact historical 98-gap JSON was not present in the repository, hook output, or session artifacts. The non-blocking pre-commit hook on the Runtime Config follow-up printed 98 gaps for 14 changed files/111 changed symbols at risk 0.60, but its `--brief` output contained only the summary and five highlighted names, not the individual gap rows. A subsequent full rebuild with `code-review-graph` v2.3.6 reported 14 changed files/83 changed functions/classes/71 gaps at risk 0.85 for base `f1525fb1bac80d99444f427807a00b0698a6148c`, and 23 files/151 changed functions/classes/122 gaps at risk 0.85 for base `1a0c627405d6e6998a3b22ffb9729f1f1d858eac`. The initial 98 count was observed but its complete list remains unrecoverable; these differing fresh/incremental snapshots are not interchangeable individual findings. The full 122-entry JSON was offloaded to a temporary tool file and is not retained as a repository artifact.

Reproduce the full-graph snapshots from the repository root with:

```sh
code-review-graph build --repo .
code-review-graph detect-changes --base f1525fb1bac80d99444f427807a00b0698a6148c --repo .
code-review-graph detect-changes --base 1a0c627405d6e6998a3b22ffb9729f1f1d858eac --repo .
```

The analyzer summaries highlight `run`, `TlsnPreflightConfig`, both `from_verified_runtime_config` helpers, `run_verified_runtime_preflight`, `fmt`, and (in the longer-base report) `validate_notary_key_bytes`. The two `RuntimeConfigGuardedOriginTransportFactory` tests directly exercise changed/unavailable digest rejection before the inner factory and same-digest forwarding exactly once. Existing `validate_notary_key_bytes` tests directly cover valid and malformed alpha.15 key encodings; `RuntimeConfigManifestError::fmt` has direct exact-string assertions. At this historical snapshot, APP startup registration and the verified-manifest-to-preflight builder lacked a dedicated APP integration test; the follow-up below adds tests for the registration helper, verified Runtime Config inputs, and preflight target-approval result. The original 98 entries and the historical fresh 122 entries remain unrecoverable as complete item lists. The separate current-worktree report below is classified independently; it does not reconstruct either older list.

Local validation for this audit was: the Node manifest/reference/build-handoff/endpoint suites, 33/33 passed; Rust manifest tests, 5/5 without `tlsn-production` and 6/6 with it; Rust TLSN preflight, 17 passed and 1 existing ignored test; `fusou-auth` Ed25519 tests, 2/2 passed; changed-file `rustfmt --check` and `git diff --check` passed. No Hosted CI or Production operation was run.

The hook does not persist its report. The table classifies every symbol in the historical 65-entry report: `COVERED_DIRECTLY` means a test directly invokes/asserts the symbol or type behavior; `COVERED_INDIRECTLY` means a named end-to-end test traverses the path and the stated property is observed; `NOT_APPLICABLE` means the symbol is test-only fixture/helper code; `IMPLEMENTATION_GAP` records behavior the verifier could not enforce at that snapshot. `COVERED_INDIRECTLY` is not a claim that every branch is exhaustively tested.

| # | Symbol | Status | Test path or disposition |
|---:|---|---|---|
| 1 | `validate_notary_key_bytes` | `COVERED_DIRECTLY` | Preflight accepts the fixture alpha.15 K256 key and rejects empty, truncated, trailing, P256, unbounded-length, and out-of-field encodings. |
| 2 | `RuntimeConfigManifestError` | `COVERED_DIRECTLY` | Unit test checks both `Invalid` and `InvalidSignature` variants. |
| 3 | `RuntimeConfigManifestError::fmt` | `COVERED_DIRECTLY` | Unit test checks exact static display strings; errors do not interpolate input values. |
| 4 | `RuntimeConfigManifestSource` | `COVERED_DIRECTLY` | Serde tests reject missing/unknown fields; verifier tests exercise valid metadata, nil IDs, malformed digest, and invalid source fields. |
| 5 | `ProductionAuthorityPins` | `IMPLEMENTATION_GAP` | Required-field/unknown-field and digest-shape checks exist, but APP has no independent expected digest pair or authority artifact bytes to compare. |
| 6 | `RuntimeConfigManifestPayload` | `COVERED_INDIRECTLY` | Shared signed golden vector and payload mutation tests exercise deserialization and validation. |
| 7 | `RuntimeConfigManifestEnvelope` | `COVERED_INDIRECTLY` | Golden envelope, canonical-byte rejection, signature mutation, and unauthenticated payload mutation traverse envelope parsing and verification. |
| 8 | `RuntimeConfigTrustedSigner` | `COVERED_INDIRECTLY` | Verifier tests cover the valid external pin, wrong scope, invalid key ID, and missing/invalid public key. |
| 9 | `RuntimeConfigVerificationPolicy` | `COVERED_DIRECTLY` | Policy values are constructed and malformed epoch, zero/oversized limits, expiry, staleness, and rollback are tested. |
| 10 | `verify_runtime_config_manifest` | `COVERED_DIRECTLY` | Rust tests invoke the public verifier for the shared vector, signature, canonical envelope, trust-scope, byte-limit, and rollback cases. |
| 11 | `validate_trusted_signer` | `COVERED_INDIRECTLY` | Public-verifier tests reject wrong scope, invalid key ID, and invalid public-key encoding before envelope acceptance. |
| 12 | `validate_policy` | `COVERED_DIRECTLY` | Unit tests invoke policy validation and check canonical epoch and interoperable numeric bounds. |
| 13 | `validate_payload` | `COVERED_DIRECTLY` | Rust unit tests directly exercise source identity, endpoint mapping, authority digest shape, and registry mutations. |
| 14 | `validate_freshness` | `COVERED_INDIRECTLY` | Public verifier tests cover supplied high-water rollback, expiry/future issuance, stale reference, and configured lifetime. |
| 15 | `validate_result_registry` | `COVERED_DIRECTLY` | Rust matrix tests invalid JSON/schema/scope/keys/IDs/duplicates/SPKI/status/timestamps/current identity and validity windows. |
| 16 | `validate_https_endpoint` | `COVERED_INDIRECTLY` | Node/Rust manifest tests cover HTTPS, DNS-only hosts, route, origin, credentials, port, query, fragment, casing, and IP rejection. |
| 17 | `validate_notary_endpoint` | `COVERED_INDIRECTLY` | Node/Rust tests cover absent/invalid port, signed port, unbracketed IPv6, and malformed brackets. |
| 18 | `is_dns_hostname` | `COVERED_INDIRECTLY` | Endpoint validation accepts the DNS fixture and rejects IP literals and noncanonical host casing. |
| 19 | `is_worker_name` | `COVERED_INDIRECTLY` | Valid fixture name succeeds; uppercase name is rejected by manifest validation. |
| 20 | `is_uuid` | `COVERED_INDIRECTLY` | Valid deployment/version IDs pass; nil UUIDs fail on both implementations. |
| 21 | `is_lower_hex` | `COVERED_INDIRECTLY` | Valid account/commit values pass; malformed account identity fails. |
| 22 | `validate_digest` | `COVERED_INDIRECTLY` | Valid golden digests pass; malformed reference and authority digests fail. |
| 23 | `validate_key_id` | `COVERED_INDIRECTLY` | Trust-pin and Result-registry tests reject spaces/invalid IDs and accept fixture IDs. |
| 24 | `validate_ed25519_spki` | `COVERED_INDIRECTLY` | Golden signer keys pass; malformed registry SPKI fails. |
| 25 | `decode_ed25519_spki` | `COVERED_INDIRECTLY` | Trusted signer and Result-registry paths decode valid SPKI and reject empty/malformed input. |
| 26 | `decode_canonical_base64url` | `COVERED_INDIRECTLY` | Signed envelope and signer parsing exercise canonical decode; malformed and noncanonical inputs fail. |
| 27 | `parse_epoch` | `COVERED_DIRECTLY` | Unit tests cover zero policy epoch, canonical decimal, leading zeros, signs, overflow, and `u64::MAX`. |
| 28 | `parse_canonical_utc` | `COVERED_DIRECTLY` | Unit tests cover canonical UTC milliseconds and reject offsets/omitted milliseconds. |
| 29 | `seconds_to_millis` | `COVERED_DIRECTLY` | Unit tests cover the largest interoperable value and overflow. |
| 30 | `signature_message` | `COVERED_INDIRECTLY` | Node/Rust golden signature and a Node-signed raw payload traverse the same domain, length-prefix, key ID, and payload-byte contract. |
| 31 | `canonical_json_bytes` | `COVERED_INDIRECTLY` | Shared vector plus whitespace and duplicate-key rejection exercise canonical reserialization. |
| 32 | `write_canonical_json` | `COVERED_INDIRECTLY` | Same canonical-vector and mutation paths traverse the writer for envelope and payload. |
| 33 | `TestVector` | `NOT_APPLICABLE` | Test-only deserialization DTO for the `test_only` cross-language fixture, not production logic. |
| 34 | `load_test_vector` | `NOT_APPLICABLE` | Test-only fixture decompression/loader. |
| 35 | `policy_for` | `NOT_APPLICABLE` | Test-only policy builder; policy behavior is tested separately. |
| 36 | `trusted_signer` | `NOT_APPLICABLE` | Test-only trusted-pin builder; pin acceptance/rejection is tested through the verifier. |
| 37 | `assert_registry_rejected` | `NOT_APPLICABLE` | Test-only table helper; the table directly invokes `validate_result_registry`. |
| 38 | `approvedProductionRelease` | `COVERED_INDIRECTLY` | APP Worker deployment-reference/handoff suite traverses provenance, public-manifest, and Result authority agreement. |
| 39 | `assertResultSigningIdentity` | `COVERED_INDIRECTLY` | Manifest tests traverse registry/current-key checks with the policy time, including inactive and expired signers. |
| 40 | `referenceRaw` | `NOT_APPLICABLE` | Node test-only canonical Worker-reference fixture builder. |
| 41 | `preparedOptions` | `NOT_APPLICABLE` | Node test-only manifest fixture builder. |
| 42 | `policy` | `NOT_APPLICABLE` | Node test-only policy builder; policy fields are exercised by verifier tests. |
| 43 | `signedRaw` | `NOT_APPLICABLE` | Node test-only signer helper; signature contract is separately exercised end to end. |
| 44 | `signedRawPayloadBytes` | `NOT_APPLICABLE` | Node test-only raw-byte signer used to construct malformed-but-authenticated payloads. |
| 45 | `assertExactKeys` | `COVERED_INDIRECTLY` | Missing/unknown payload, source, trust-pin, envelope, and authority-pin fields are rejected. |
| 46 | `assertWellFormedJsonStrings` | `COVERED_INDIRECTLY` | Authenticated payload with a lone surrogate is rejected; valid strings traverse the same verifier path. |
| 47 | `assertKeyId` | `COVERED_INDIRECTLY` | Invalid external signer IDs and registry IDs are rejected through signing/verification entry points. |
| 48 | `assertDigest` | `COVERED_INDIRECTLY` | Reference and each Production pin reject malformed base64url digest values. |
| 49 | `decodeBase64Url` | `COVERED_INDIRECTLY` | Envelope creation/verification and external signer parsing reject malformed/noncanonical base64url. |
| 50 | `assertEd25519Spki` | `COVERED_INDIRECTLY` | Golden keys pass; malformed trusted and registry keys fail. |
| 51 | `assertCanonicalUtc` | `COVERED_INDIRECTLY` | Manifest and registry timestamps reject noncanonical UTC forms and invalid windows. |
| 52 | `assertEpoch` | `COVERED_INDIRECTLY` | Manifest and supplied high-water epochs traverse canonical/overflow and rollback checks. |
| 53 | `assertCleanHttpsEndpoint` | `COVERED_INDIRECTLY` | Endpoint matrix checks scheme, host, credentials, port, query, fragment, path, origin, and sparse/complete route selection. |
| 54 | `assertNotaryEndpoint` | `COVERED_INDIRECTLY` | Notary endpoint boundary matrix exercises format and port rejects. |
| 55 | `assertManifestPayload` | `COVERED_INDIRECTLY` | Preparation and signing/verification tests traverse exact schema, source, compile-input, registry, endpoint, Notary, and pin checks. |
| 56 | `assertTrustedSigner` | `COVERED_INDIRECTLY` | External signer scope, key ID, and SPKI checks are exercised through verification. |
| 57 | `assertPolicy` | `COVERED_INDIRECTLY` | Policy limits and freshness behavior are exercised via Node verifier; Rust has direct boundary tests. |
| 58 | `signingBytes` | `COVERED_INDIRECTLY` | Test-signed golden envelope and authenticated malformed payload traverse the domain-separated bytes. |
| 59 | `tlsnRuntimeConfigSigningBytes` | `COVERED_DIRECTLY` | Node tests call the exported function for valid payloads and schema/source/authority/endpoint failures. |
| 60 | `prepareTlsnRuntimeConfigManifest` | `COVERED_INDIRECTLY` | Preparation tests verify exact raw Worker-reference hashing, release agreement, required pair, and canonical signing bytes. |
| 61 | `signing_bytes` | `COVERED_DIRECTLY` | Preparation test compares its returned signing bytes against the exported signing function. |
| 62 | `createTlsnRuntimeConfigEnvelopeRaw` | `COVERED_INDIRECTLY` | Test signer helpers create valid envelopes; malformed signature base64 is rejected. |
| 63 | `verifyTlsnRuntimeConfigEnvelope` | `COVERED_DIRECTLY` | Node tests invoke it for golden verification, trust/policy failures, signature ordering, canonical JSON, Unicode, freshness, endpoint, registry, and pin cases. |
| 64 | `Ed25519SignatureError` | `COVERED_DIRECTLY` | Auth unit tests assert all four error variants, including invalid point encoding. |
| 65 | `verify_ed25519_signature` | `COVERED_DIRECTLY` | Auth unit tests verify a matching signature and reject changed message, invalid key/ signature lengths, and invalid public-key encoding. |

The historical symbol-level classification does not promote local tests into runtime guarantees. Later V2 code independently hashes the fetched Worker reference and Production authority artifacts and verifies the Result registry envelope; the manager now connects those checks to the APP TLSN gate. These checks are still unusable in Production until the independent Runtime Config signing root and endpoint are approved and enrolled. Trusted time and adversary-resistant durable rollback state remain unimplemented; local epoch state and system time are not substitutes.

The manifest carries no Game Server identity. Before a real Presentation is independently verified, identity remains `NOT_YET_OBSERVED`; neither candidate configuration, Worker health, manifest contents, nor Result claims can supply it. Keep the existing human-gameplay preflight, Presentation validation, Origin Inventory, Target Approval, Result signature, and archive byte-binding requirements unchanged. Authenticated APP session handoff, device-possession binding, and a TLSN Session Authority flow are not implemented by this offline contract.

#### Runtime Config release-adapter and APP-integration follow-up

At branch HEAD `a3d8259cff01cccecd39075ef14fb20db8b7fa71`, the current worktree was rebuilt and analyzed with `code-review-graph` v2.3.6 using base `f1525fb1bac80d99444f427807a00b0698a6148c`. The full report summarized 15 changed files, 123 changed functions/classes, 105 static test-gap candidates, and risk score 0.85. The complete raw JSON (`runtime-config-graph-final.json`) and row-by-row classification (`runtime-config-graph-final-classified.json`) were retained as session artifacts; the 105 candidates are not 105 uncovered defects and are not interchangeable with the earlier 98- or 122-gap snapshots.

| Classification | Rows | Disposition |
|---|---:|---|
| `COVERED_DIRECTLY` | 40 | Targeted tests directly invoke/assert manifest verification, independent artifact checks, epoch-state behavior, verified preflight construction, binding/origin gates, and Node signing/publication orchestration. |
| `COVERED_INDIRECTLY` | 27 | Wrappers, accessors, validation helpers, and transport/publication substeps are exercised through their tested verifier, manager, or orchestration callers. This does not imply real service integration. |
| `NOT_APPLICABLE` | 36 | 33 test-only fixtures/helpers plus the unrelated `close_debug_window` and `TlsnTransportError` formatting symbols included because their containing files changed. |
| `UNRESOLVED` | 2 | `build_production_tlsn_dependencies` and the complete `serve_proxy` Production path still have no successful real-bootstrap integration test; the independent Production signer root and endpoint are not enrolled. |

The direct/indirect classification is limited to the exact local paths stated above. The `run` and `run_verified_runtime_preflight` analyzer highlights are covered only through the tested manager-registration and shared preflight-helper paths; the Tauri desktop event loop is not launched in these tests. HTTP transport limits are tested with a local response server and the manager uses a fake object fetcher; neither is a test against the intended Production origin.

The APP startup now registers a `RuntimeConfigManager` through a shared helper and attempts a best-effort refresh. The authoritative gate remains `serve_proxy`: missing or invalid Runtime Config blocks TLSN before worker health observation, certificate setup, dependency construction, or transport. The Tauri Production preflight command now refreshes the registered manager and requires `proxy_target`; it no longer creates a Production-shaped report from user configuration alone. Verified Runtime Config values supply the Worker identity and preflight inputs, and the approved Target Approval is checked. The binding provider revalidates the manifest before issuing a binding, and the origin transport factory revalidates again before invoking the underlying transport. Added tests assert fail-closed bootstrap/registration behavior, verified-manifest-to-preflight mapping, target rejection, binding rejection before issuance, and changed/unavailable manifest rejection before origin transport.

Node release code remains injected orchestration, not a deployed publisher. It requires a signer whose key ID/SPKI match an independently supplied pin, verifies its signature and raw artifacts, writes and reads back content-addressed artifacts, reacquires the approved Worker reference, and calls an object-store `compareAndSwapManifest` interface before checking final readback. Tests use ephemeral signers and a fake store. No Production signer provider, key custody/rotation/revocation process, Runtime Config bucket, dedicated public hostname, publisher credentials, or concrete R2 adapter is configured. `FUSOU-WORKFLOW`'s existing `BATTLE_DATA_BUCKET` is a different-purpose binding and is not reused.

Cloudflare documents conditional object operations in the [R2 Workers API reference](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/) and describes same-key concurrent writes as last-writer-wins in its [R2 consistency model](https://developers.cloudflare.com/r2/reference/consistency/). Those documents do not establish the exact per-key atomic compare-and-swap guarantee required by this publisher contract. A concrete adapter must demonstrate immutable-create behavior, atomic conditional pointer update under races, credential scope, and byte-for-byte readback before it can be treated as Production-ready.

Validation in this worktree: Node Runtime Config/Worker-reference/build-handoff/endpoint suites passed `41/41`; APP `tlsn-production` library tests passed `70` with `1` ignored; APP without `tlsn-production` passed `26/26`; Proxy HTTPS with `synthetic-tlsn` passed `95` with `1` ignored; `fusou-auth` passed `13/13`; APP library Clippy exited successfully with 24 warnings. Changed standalone Rust modules passed individual `rustfmt --check`; checking `lib.rs` and `tauri_cmd.rs` as whole files still reports unrelated pre-existing formatting differences, while the edited registration/command hunks were not among those formatter diffs. `git diff --check` passed. No Hosted CI, Cloudflare/Supabase operation, Production key issuance, deployment, Notary session, or real gameplay was performed.

The compiled Production manifest URL and signer root remain `None`; the APP therefore fails closed with `Production Runtime Config bootstrap is not registered`. A local epoch state file is not adversary-resistant persistent rollback protection, and OS time is not an independent trusted clock. Production signer/root enrollment, fixed endpoint approval, concrete storage adapter and CAS evidence, runtime delivery operation, real Worker/Notary interaction, and real Presentation/Result verification remain external or unverified. Keep Production acceptance `BLOCKED`; these local tests do not establish a release, Production Runtime Config service, Phase 0 runtime gate, or real TLSN testplay.

#### Runtime Config R2 publisher adapter and readiness follow-up

The Node publisher now has a concrete Cloudflare R2 S3-compatible object-store adapter in [`tlsn-runtime-config-r2-store.mjs`](../scripts/tlsn-runtime-config-r2-store.mjs). It uses the account-derived `https://<account-id>.r2.cloudflarestorage.com` endpoint, path-style addressing, `region=auto`, and one SDK attempt per write. It does not reuse the unrelated `BATTLE_DATA_BUCKET`.

The dedicated bucket name must follow Cloudflare's current [R2 bucket naming rules](https://developers.cloudflare.com/r2/buckets/create-buckets/) (3-63 lowercase letters, digits, and internal hyphens). The adapter validates this format and the 32-hex account ID before constructing a client.

The adapter accepts only the versioned Runtime Config object namespace. Immutable artifact keys must contain the SHA-256 base64url digest of the exact body; creation uses `If-None-Match: *`, and an existing object is accepted only after exact byte readback. The mutable manifest pointer is read with its body and ETag from one `GetObject` response, then updated with `PutObject` using `If-Match: <observed-etag>` or `If-None-Match: *` when absent. Afterward, the publisher checks the exact body and committed ETag in a single readback and reruns the Production envelope plus referenced-artifact verifier. A racing signed release is reported as a conflict only after its envelope and all referenced artifacts verify; a changed, missing, or unverifiable pointer is not reported as a successful publication.

HTTP 409/412 conditional failures are conflicts. Known timeout, connection-reset, and server-error outcomes are reconciled with one readback and are never blindly retried. If the exact attempted bytes are current, the operation is reconciled as committed; a changed or deleted update pointer becomes a conflict; an absent pointer after a create-if-absent request, or a failed reconciliation read, remains an explicit unknown outcome. Immutable writes follow the same no-blind-retry rule. These decisions are tested with a fake S3 transport, including concurrent writers and timeout-after-commit cases.

Cloudflare's [R2 S3 API compatibility table](https://developers.cloudflare.com/r2/api/s3/api/) lists `If-Match` and `If-None-Match` support for `PutObject`; the [R2 consistency model](https://developers.cloudflare.com/r2/reference/consistency/) describes same-key concurrent writes. No real bucket or credentials were supplied, so service-side concurrent conditional-write behavior, scoped permissions, readback, and timeout reconciliation remain `NOT_CHECKED`; fake-transport tests do not establish Production CAS readiness.

The no-network diagnostic is available as `pnpm run tlsn:runtime-config:publisher-readiness`. It reads only `TLSN_RUNTIME_CONFIG_R2_ACCOUNT_ID`, `TLSN_RUNTIME_CONFIG_R2_BUCKET`, `TLSN_RUNTIME_CONFIG_R2_ACCESS_KEY_ID`, and `TLSN_RUNTIME_CONFIG_R2_SECRET_ACCESS_KEY`, and reports statuses without values. It performs no signing or network access and always reports `BLOCKED_EXTERNAL_INPUTS` because the Production Runtime Config signing root/provider and live R2 verification are not registered. `PRESENT_UNVERIFIED` means only that a variable is set; it does not prove credential scope or usability.

No bucket, custom domain, credential, signing provider/root, deployment, or object was created or operated. The adapter implementation does not make Runtime Config publication a Production service. Production acceptance and the APP Runtime Config gate remain blocked until separately approved signer enrollment, a dedicated bucket/domain, least-privilege credentials, and live conditional-write/readback evidence are in place.

#### Runtime Config R2 integration harness and signer enrollment

The opt-in live-service harness is `pnpm run tlsn:runtime-config:r2-integration`. It uses Node's built-in test runner and the existing `@aws-sdk/client-s3`; it does not use the publisher's Production manifest key. With no opt-in it reports a skipped `NOT_RUN` test and sends no request. Partial or invalid opt-in inputs report `BLOCKED_EXTERNAL_INPUTS` and also send no request.

Before a human runs it, create a new disposable, non-Production R2 bucket whose name is exactly `fusou-tlsn-r2-test-<lowercase-alphanumeric-suffix>`. Create a separate R2 S3 API token with **Object Read & Write** permission scoped only to that bucket. Do not use an Admin token, account-wide bucket scope, Production bucket, Production publisher credential, or APP/Runtime Config signer. The token permission allows object listing within its scoped bucket, but this harness does not issue list or bucket-management requests. Cloudflare documents this token permission and bucket scoping in [R2 S3 API authentication](https://developers.cloudflare.com/r2/api/tokens/).

Supply these inputs through an approved local secret manager or equivalent environment injection; do not paste credential values into command history or diagnostic output:

| Environment variable | Purpose |
| --- | --- |
| `TLSN_RUNTIME_CONFIG_R2_INTEGRATION_OPT_IN=1` | Required exact opt-in; generic `node --test` is not opt-in. |
| `TLSN_RUNTIME_CONFIG_R2_TEST_ACCOUNT_ID` | 32-hex account ID used to derive the endpoint. |
| `TLSN_RUNTIME_CONFIG_R2_TEST_BUCKET` | Dedicated `fusou-tlsn-r2-test-<suffix>` bucket. |
| `TLSN_RUNTIME_CONFIG_R2_TEST_ACCESS_KEY_ID` | Access key from the bucket-scoped test token. |
| `TLSN_RUNTIME_CONFIG_R2_TEST_SECRET_ACCESS_KEY` | Secret key from the bucket-scoped test token. |
| `TLSN_RUNTIME_CONFIG_R2_TEST_BUCKET_CONFIRMATION=I_CONFIRM_THIS_IS_DISPOSABLE_NON_PRODUCTION` | Explicit operator confirmation of the dedicated disposable bucket. |

The harness derives `https://<account-id>.r2.cloudflarestorage.com`; it accepts no endpoint override and supplies explicit credentials to SDK clients configured for one attempt. Use a bucket without a jurisdictional restriction; jurisdiction-specific endpoints are not configurable in this harness. Automatic data placement is a location choice, not a jurisdiction. The script rejects malformed account IDs, buckets outside the dedicated naming pattern, a bucket equal to the configured publisher bucket, reused publisher credentials, missing confirmation, or any missing required input before constructing a client. These checks reduce accidental mis-targeting but cannot prove the operator's account/bucket classification; use a newly created disposable bucket and verify its identity and location in the Cloudflare dashboard before opt-in.

Create the bucket in the Cloudflare dashboard before running the harness. It sends only object GET, PUT, and DELETE operations; it does not issue `CreateBucket` or list requests and does not set the [`cf-create-bucket-if-missing`](https://developers.cloudflare.com/r2/api/s3/extensions/) header. A missing bucket is an error, not a request to create one.

The test run writes only beneath `tlsn/runtime-config-integration/<random-run-uuid>/`. It checks create-only immutable writes and exact digest/readback, first-create races, ETag-conditioned updates, stale and concurrent ETag conflicts, valid competing test releases, and readback of both changed and unchanged state around simulated client timeouts. Concurrent races issue requests through separate SDK client instances, using the same bucket-scoped test credential; the requests run concurrently, but this is not a test with independently authorized publisher identities. Its signed pointer is a disposable, test-only format signed by a per-process ephemeral Ed25519 key; passing it does not verify a Production manifest or trust root. The timeout cases simulate failure before request submission and loss of the response after an R2 write returned; they do not simulate or establish every real network-timeout mode. ETags are used only as conditional-operation state, never as body digests.

The harness deletes only exact immutable keys it created, after an exact-byte readback, and verifies their removal. It retains mutable pointer objects beneath the run prefix. The [R2 S3 compatibility table](https://developers.cloudflare.com/r2/api/s3/api/) documents conditional `PutObject` headers but does not list an `If-Match` conditional operation for `DeleteObject`; therefore the harness does not perform an unguarded pointer delete or claim conditional cleanup. After recording the test output, an operator may retire the disposable bucket through the Cloudflare dashboard. The harness never deletes a bucket, lists a bucket, accesses the Production pointer, or cleans up outside its run prefix.

#### Timeout triage and recovery

The harness's timeout cases are local failure simulations; they do not establish real network timeout behavior. For any real write timeout or lost response, stop automatic publication and treat the outcome as `UNKNOWN` until reconciled. Do not retry the same write unconditionally, delete the pointer, or infer that a write failed solely because an immediate read shows the prior value.

1. Record the run ID, exact pointer key, attempted body SHA-256, request time, error class, and any observed ETag. Do not record credentials. An ETag is a CAS token, not a body digest.
2. Use an authorized read-only GET of that exact pointer and retain its raw body and ETag. Verify the full expected signature, digest, and referenced artifacts against the separately approved trust inputs; do not treat a matching ETag alone as proof of a valid release.
3. If the exact attempted body is current and independently verifies, reconcile it as committed. If a different valid release is current, stop with a conflict and require the release authority to decide whether to prepare a new release from that state. Never overwrite it with a stale body.
4. If the prior body remains, the readback is malformed, or the GET fails, keep the outcome `UNKNOWN`/`BLOCKED`; do not blindly replay the original request. The storage/release authority must establish that the original operation is no longer in flight and authorize any new attempt. A new attempt must re-read the body and ETag and use the normal conditional CAS path.
5. Preserve ambiguous test pointers under the disposable run prefix for review. Retire the test bucket manually only after recording the exact run-prefix objects; do not use an unconditional pointer DELETE as cleanup.

The service-evidence levels must remain distinct:

| Evidence | What it establishes |
| --- | --- |
| Cloudflare compatibility documentation | The documented R2 S3 operation/header support; not observed service behavior for this project. |
| SDK request-configuration tests | The `PutObject` conditional fields are passed by the client adapter; not R2 enforcement. |
| Local fake-store tests | The local orchestration's conflict, timeout-reconciliation, and readback branches; not real R2 behavior. |
| Opt-in integration harness, only after a human runs it | Observations for the named disposable bucket, token, and run; not Production CAS readiness. |
| Production publisher readiness | Still `BLOCKED_EXTERNAL_INPUTS` until signer/root/endpoint enrollment and required live evidence are separately approved. |

No approved Runtime Config Production signer provider or independent signer pin is registered. The APP's embedded Runtime Config manifest URL, key ID, and SPKI are all `None`; the release gate therefore rejects Production signing and publication before using a signer or accessing a store. The existing Tauri updater public key and `TAURI_SIGNING_PRIVATE_KEY` release secrets are scoped to updater artifacts, not Runtime Config manifests. They are not the Result registry root or the Notary verification key. Existing workflow `contents`/OIDC permissions also do not establish a Runtime Config signing authority or R2 publisher.

Required initial enrollment is an external, reviewed operation:

| Item | Required content | Approval subject | Registration target | Independent verification | Initial or ongoing | If incomplete |
| --- | --- | --- | --- | --- | --- | --- |
| Runtime Config signer and provider | Dedicated Ed25519 key ID/SPKI, signing domain, allowed signing operation, custody, audit, expiry, and rotation/revocation policy. Do not reuse Result, Notary, or updater keys. | Runtime Config trust authority and security/key custodian. | An approved KMS/HSM or equivalently controlled signer provider and its access policy; never the APP, repository, public artifact, or logs. | Independently derive the public SPKI/key ID and verify a signature over the exact canonical, domain-separated manifest bytes against the separately approved pin. | Initial enrollment and every rotation/revocation. | Production signature generation and publication remain blocked. |
| Independent signer pin and fixed manifest endpoint | Approved signer key ID/SPKI and a fixed HTTPS URL, approved independently of any manifest the signer produces. | Runtime Config trust authority and APP security/release owners. | Reviewed APP bootstrap verifier configuration and the approved deployment endpoint. The current embedded APP URL/key ID/SPKI are unset. | Review the exact source/build values, then verify a fetched manifest with the embedded pin and expected signing contract. | Initial enrollment and every endpoint/key change. | APP bootstrap and Production Runtime Config gate remain fail-closed. |
| Production R2 storage and credentials | Dedicated Runtime Config bucket, account/bucket identity, jurisdiction/location choice, and least-privilege credentials. Do not use the disposable integration bucket or its token for Production. | Storage owner and security authority. | Cloudflare account bucket plus an approved secret manager or equivalent credential store; never source control or command-line examples. | Independently check bucket identity and token scope in Cloudflare, then use a separately approved live Production storage validation. The disposable-bucket harness is not Production evidence. | Initial provisioning and credential rotation/revocation. | Live permissions and CAS remain unverified; Production publication stays blocked. |
| Publisher authorization and release inputs | Authorized operator/provider binding, approved active Worker reference, and fresh independent authority inputs for each release. | Production release authority. | Reviewed signer access policy, publisher deployment configuration, and secret manager. | Verify the exact signed manifest, independent inputs, object readback, and pointer CAS under the approved release procedure. | Every release and any authorization change. | No Production publish; readiness remains `BLOCKED_EXTERNAL_INPUTS`. |

The current APP bootstrap accepts one embedded signer; overlapping roots and online rotation are not established. Do not claim revocation until the replacement APP trust state is deployed and old-signer acceptance is checked.

Until those external steps are completed, readiness reports `NOT_REGISTERED`/`NOT_CONFIGURED` for trust and signer checks, `NOT_CHECKED` for live credential permissions, `NOT_RUN` for live R2 writes, and `BLOCKED_EXTERNAL_INPUTS` for Production publication. This task did not run the integration harness, contact Cloudflare, create or use a bucket/token, publish a manifest, or start Hosted CI.

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

Also preserve the APP writer's `device-identity.json`, `capture-provenance.json`, `candidate-identity.json` and `candidate-manifest.json`. The writer emits `verifier-execution-receipt-header.txt` and `verifier-execution-receipt.bin` only when the corresponding receipt bytes are present; these are conditional files, not part of the nine-file minimum. When a receipt is required for the capture, compare its presence and digest with `candidate-manifest.json` fields `candidate_status`, `verifier_execution_receipt_status`, `verifier_execution_receipt_sha256` and the `artifacts` descriptors. A missing required receipt or an inconsistent descriptor is a stop: do not infer, regenerate or rename files to fill the gap. A candidate manifest's `UNAPPROVED`, `NOT_YET_OBSERVED` or pending status is not Target Approval authority. Missing execution/required evidence is a stop, not permission to fabricate it.

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
