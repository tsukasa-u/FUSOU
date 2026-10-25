// API, process and storage doubles only; no key generation, native execution or live evidence.
import { createHash } from "node:crypto";
import { consumerFixture } from "./release-consumer-fixture.mjs";
import { WORKER_SOURCE_PATHS, WORKER_ROOT, inspectWorkerSource, encodeUnsignedWorkerPackage } from "./release-worker-source.mjs";
import { ENTRY_INPUT_CONTRACT, entryInputSha256, runtimeConfigBootstrapReport } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-build-handoff.mjs";
import { publicAppConfigurationSha256 } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-public-configuration.mjs";
import { sha256 } from "./release-bytes.mjs";
import { jsonBytes, checkContext, recordCheckExecution, recordCompiledInputsExecution, captureArchiveReadback,
  captureOfflineExecution, OFFLINE_BUNDLE_ARTIFACTS, LOCK_PATHS } from "./release-checks.mjs";
import { verifyProducerBuild } from "./release-build-proof.mjs";

export function workerSourceFixture() {
  const files = new Map(WORKER_SOURCE_PATHS.map((path) => [path, Buffer.from(`synthetic source snapshot: ${path}`)]));
  files.set("package.json", jsonBytes({ packageManager: "pnpm@10.0.0" }));
  files.set(`${WORKER_ROOT}/package.json`, jsonBytes({ main: "src/index.ts", scripts: { "build:wasm": "node scripts/build-wasm.mjs" },
    dependencies: { hono: "4.12.34", zod: "3.24.0" }, devDependencies: { wrangler: "4.78.0" } }));
  files.set(`${WORKER_ROOT}/wrangler.toml`, Buffer.from('main = "src/index.ts"\n'));
  return files;
}
export const fixtureToolchain = { node: "22.16.0", pnpm: "10.0.0", rust: "1.95.0", wrangler: "4.78.0" };
export async function checkFixture() {
  const f = consumerFixture(), sourceSha = f.eligibility.commit_sha, sourceFiles = workerSourceFixture();
  sourceFiles.set(LOCK_PATHS[1], Buffer.from("synthetic committed Cargo lock"));
  const context = checkContext(f.run, sourceSha), source = inspectWorkerSource(sourceFiles, sourceSha);
  const rootSpki = Buffer.from("302a300506032b6570032100d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "hex").toString("base64url");
  f.payload.compile_inputs = { ...Object.fromEntries(ENTRY_INPUT_CONTRACT.compile_inputs.map((key) => [key, `synthetic-${key}`])),
    ...f.payload.compile_inputs, FUSOU_TLSN_EXPECTED_GIT_COMMIT_SHA: sourceSha, FUSOU_TLSN_NOTARY_VERIFYING_KEY: "synthetic public reference" };
  const security = { notary_key_id: "notary", notary_registry: { notary: f.payload.compile_inputs.FUSOU_TLSN_NOTARY_VERIFYING_KEY } };
  const securityRaw = jsonBytes(security);
  f.publicInput.verification.independentInputs.security_registry_set_raw = securityRaw.toString("base64url");
  f.payload.production_authority_pins.security_registry_set_sha256 = sha256(securityRaw);
  f.publicInput.verification.trustedSigner.public_key_spki = rootSpki;
  const reference = { compile_inputs: f.payload.compile_inputs,
    cloudflare: { version_id: f.payload.source.active_version_id, script_name: f.payload.source.script_name } };
  f.publicInput.verification.independentInputs.worker_reference_raw = jsonBytes(reference).toString("base64url");
  const publicBuildInputs = { schema_version: 1, app_source_sha: sourceSha, worker_reference: reference,
    public_app_inputs: { PUBLIC_SUPABASE_URL: "https://auth.example.test", PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic", DISCORD_CLIENT_ID: null },
    runtime_config_bootstrap: { FUSOU_TLSN_RUNTIME_CONFIG_MANIFEST_URL: "https://config.example.test/tlsn/runtime-config/v2/manifest.json",
      FUSOU_TLSN_RUNTIME_CONFIG_SIGNER_KEY_ID: "runtime", FUSOU_TLSN_RUNTIME_CONFIG_SIGNER_PUBLIC_KEY_SPKI: rootSpki },
    rust_toolchain: "1.98.1", platform: "linux-x86_64" };
  const bootstrap = runtimeConfigBootstrapReport(publicBuildInputs.runtime_config_bootstrap);
  const observations = new Map(), rawEvidence = new Map(), wrappers = new Map();
  const updateArtifact = (claim, bytes, details) => {
    const wrapper = JSON.parse(f.files.get(claim.build_record_file));
    wrapper.artifact_sha256 = sha256(bytes); wrapper.byte_length = bytes.length; wrapper.details = details;
    const wrapperRaw = jsonBytes(wrapper), p = JSON.parse(f.files.get(claim.provenance_file));
    p.artifact_sha256 = sha256(bytes); p.input_record_sha256 = sha256(wrapperRaw);
    const provenance = jsonBytes(p);
    Object.assign(claim, { sha256: sha256(bytes), byte_length: bytes.length,
      build_record_sha256: sha256(wrapperRaw), provenance_sha256: sha256(provenance) });
    f.files.set(claim.file, bytes); f.files.set(claim.build_record_file, wrapperRaw); f.files.set(claim.provenance_file, provenance);
    wrappers.set(claim.name, wrapperRaw);
  };
  const app = f.report.build.artifacts[0], detail = JSON.parse(f.files.get(app.build_record_file)).details;
  Object.assign(detail, { rust_toolchain: publicBuildInputs.rust_toolchain, cargo_lock_sha256: sha256(sourceFiles.get(LOCK_PATHS[1])),
    compiled_report: { schema_version: 2, scope: "fusou-tlsn-app-compiled-worker-entry-report",
      entry_input_sha256: entryInputSha256(reference.compile_inputs),
      worker_source_sha: sourceSha, active_version_id: reference.cloudflare.version_id, app_source_sha: sourceSha,
      build_profile: "release", tlsn_production_feature: true, custom_protocol_feature: true,
      runtime_config_bootstrap: bootstrap, authority_status: "UNVERIFIED" },
    compiled_public_configuration: { schema_version: 1, scope: "fusou-app-compiled-public-configuration-report",
      public_app_configuration_sha256: publicAppConfigurationSha256(publicBuildInputs.public_app_inputs),
      discord_client_id_present: false, authority_status: "UNVERIFIED" } });
  updateArtifact(app, f.files.get(app.file), detail);
  const reports = {};
  for (const [role, flag, data] of [["worker", "--tlsn-compiled-worker-entry", detail.compiled_report],
    ["public", "--app-compiled-public-configuration", detail.compiled_public_configuration]]) {
    const raw = jsonBytes(data); rawEvidence.set(sha256(raw), raw);
    reports[role] = { argv: [flag], exit_code: 0, stdout_sha256: sha256(raw), executable_sha256: app.sha256 };
  }
  observations.set(app.name, jsonBytes({ schema_version: 1, scope: "fusou-app-compiled-execution-observations-v1", ...context,
    executable_sha256: app.sha256, reports, app_build_record_sha256: sha256(wrappers.get(app.name)),
    public_build_inputs_sha256: sha256(jsonBytes(publicBuildInputs)) }));
  const worker = f.report.build.artifacts[1];
  updateArtifact(worker, encodeUnsignedWorkerPackage(new Map([["index.js", Buffer.from("// synthetic compiler output\n")],
    ["verifier.wasm", Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])]])),
  { scope: "fusou-unsigned-worker-build-v1", source_inputs: source.source_inputs, source_inputs_sha256: source.source_inputs_sha256,
    commands: source.commands, toolchain: fixtureToolchain, version_reference: f.payload.source });
  const add = (execution) => { for (const [name, raw] of execution.files) f.files.set(name, raw); };
  add(recordCheckExecution("locked_dependencies", context, new Map(LOCK_PATHS.map((path) => [path, sourceFiles.get(path)])), {
    pnpm_version: "10.0.0", commands: [
      { argv: ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"], exit_code: 0 },
      { argv: ["pnpm", "exec", "tauri", "build", "--ci", "--no-bundle", "--features", "tlsn-production,custom-protocol", "--", "--locked"], exit_code: 0 },
    ],
  }));
  const compiled = recordCompiledInputsExecution({ context, publicBuildInputs, artifacts: f.report.build.artifacts,
    buildRecords: wrappers, observations, rawEvidence }); add(compiled);
  const presentation = Buffer.from("synthetic Presentation, not TLSN"), result = jsonBytes({ synthetic: true });
  const archive = { session_id: "synthetic-session", capture_id: "synthetic-capture", not_before_ms: 800, max_age_ms: 500, objects: {} };
  for (const [role, raw] of [["presentation", presentation], ["result", result]]) archive.objects[role] = {
    role, backend_id: "mock-archive", object_key: `tlsn-verification/attempt-1/${role}.${role === "presentation" ? "bin" : "json"}`,
    version_id: `${role}-version-1`, session_id: archive.session_id, capture_id: archive.capture_id,
    job_id: "job-1", verification_attempt_id: "attempt-1", sha256: sha256(raw),
  };
  const saved = new Map([["presentation", presentation], ["result", result]]);
  const archiveExecution = await captureArchiveReadback({ context, expected: archive, sourceBytes: saved, now: () => 900,
    backend: { get: async (identity) => ({ ...identity, bytes: saved.get(identity.role) }) } }); add(archiveExecution);
  f.dependencies.authenticateArchiveReadback = async () => archiveExecution.executionProof;
  const nativeInputs = new Map(), artifacts = {};
  for (const role of OFFLINE_BUNDLE_ARTIFACTS) {
    const raw = role === "presentation" ? presentation : role === "result" ? result :
      role === "session" ? jsonBytes({ session_id: archive.session_id }) :
      role === "notary_registry" ? jsonBytes(security.notary_registry) :
      ["session_authority_registry", "binding_authority_registry"].includes(role) ? Buffer.from(`synthetic CLI ${role}`) : Buffer.from(`synthetic ${role}`);
    nativeInputs.set(`bundle_artifact_${role}`, raw);
    artifacts[role] = { path: `${role}.artifact`, sha256: sha256(raw), byte_length: raw.length };
  }
  nativeInputs.set("bundle", jsonBytes({ capture_id: archive.capture_id, security_identity: { git_commit_sha: sourceSha }, artifacts }));
  for (const role of ["trusted_notary_registry", "session_authority_registry", "binding_authority_registry",
    "origin_inventory", "target_approval", "trust_anchor_der"]) nativeInputs.set(role, Buffer.from(`synthetic CLI ${role}`));
  nativeInputs.set("trusted_notary_registry", jsonBytes(security.notary_registry));
  nativeInputs.set("origin_inventory", Buffer.from(f.publicInput.verification.independentInputs.origin_inventory_raw, "base64url"));
  nativeInputs.set("target_approval", Buffer.from(f.publicInput.verification.independentInputs.target_approval_raw, "base64url"));
  const offline = { executable_sha256: sha256(Buffer.from("independently pinned synthetic executable")),
    input_sha256: Object.fromEntries([...nativeInputs].map(([name, raw]) => [name, sha256(raw)])),
    options: Object.fromEntries(["evidence-root-key-id", "evidence-root-public-key-spki", "session-authority-key-id",
      "session-authority-public-key-spki", "binding-authority-key-id", "binding-authority-public-key-spki", "canonical-user-id",
      "device-id", "device-public-key", "server-identity", "profile-sha256", "verifier-key-id"].map((key) => [key, `synthetic-${key}`])),
    expected_derived: { server_identity: "game.example.test", notary_key_id: security.notary_key_id, result_signer_key_id: f.payload.compile_inputs.FUSOU_TLSN_RESULT_SIGNER_KEY_ID,
      result_key_registry_sha256: f.payload.result_registry_pins.result_registry_sha256 } };
  offline.options["server-identity"] = "game.example.test";
  offline.options["session-authority-key-id"] = f.payload.compile_inputs.FUSOU_TLSN_SESSION_AUTHORITY_KEY_ID;
  offline.options["session-authority-public-key-spki"] = f.payload.compile_inputs.FUSOU_TLSN_SESSION_AUTHORITY_PUBLIC_KEY;
  const nativeReport = { status: "VERIFIED", verification: "FUSOU_TLSN_EVIDENCE_BUNDLE",
    trust: Object.fromEntries(["evidence_root", "result_registry", "result_signature", "result_evidence_binding",
      "tlsn_presentation", "notary", "artifact_manifest"].map((key) => [key, "VERIFIED"])), derived: offline.expected_derived };
  const executor = async ({ argv }) => ({ argv, stdout: jsonBytes(nativeReport), exit_code: 0, executable_sha256: offline.executable_sha256 });
  const offlineExecution = await captureOfflineExecution({ context, inputs: nativeInputs, policy: offline }, { execute: executor }); add(offlineExecution);
  f.dependencies.authenticateOfflineExecution = async () => offlineExecution.executionProof;
  const checkPolicy = { schema_version: 1, scope: "fusou-release-check-inputs-v1", repository: context.repository, source_sha: sourceSha,
    worker_toolchain: fixtureToolchain, archive, offline };
  f.files.set("release-report.json", jsonBytes(f.report)); f.sync();
  const originalContent = f.github.rest.repos.getContent;
  f.github.rest.repos.getContent = async (p) => {
    if (!WORKER_SOURCE_PATHS.includes(p.path) && p.path !== LOCK_PATHS[1]) return originalContent(p);
    if (!sourceFiles.has(p.path)) throw Object.assign(new Error("source not found"), { status: 404 });
    if (p.ref !== sourceSha) throw new Error("wrong exact source ref");
    const raw = sourceFiles.get(p.path);
    return { data: { type: "file", encoding: "base64", content: raw.toString("base64"),
      sha: createHash("sha1").update(`blob ${raw.length}\0`).update(raw).digest("hex") } };
  };
  Object.assign(f.options, { nowMs: 1000, publicInputsBytes: jsonBytes(f.publicInput), publicInputsSha256: sha256(jsonBytes(f.publicInput)),
    publicBuildInputsBytes: jsonBytes(publicBuildInputs), publicBuildInputsSha256: sha256(jsonBytes(publicBuildInputs)),
    checkPolicyBytes: jsonBytes(checkPolicy), checkPolicySha256: sha256(jsonBytes(checkPolicy)) });
  const build = verifyProducerBuild({ run: f.run, eligibility: f.eligibility, files: f.files,
    origin: { ...f.metadata(), run_id: f.run.id, workflow_sha: f.run.head_sha } });
  const records = Object.fromEntries(["locked_dependencies", "compiled_inputs", "archive_readback", "offline_verification"].map(
    (check) => [check, JSON.parse(f.files.get(`check-${check}.json`))]));
  const evidenceBytes = new Map(build.evidenceBytes);
  for (const [name, raw] of f.files) if (name.startsWith("evidence-")) evidenceBytes.set(sha256(raw), raw);
  const archiveInputs = new Map(["presentation", "result"].flatMap((role) =>
    [[`saved_${role}`, saved.get(role)], [`readback_${role}`, saved.get(role)]]));
  return { ...f, context, sourceFiles, build, records, evidenceBytes, publicBuildInputs, checkPolicy,
    archiveExecution, archiveInputs, offlineExecution, compiled, nativeInputs, nativeReport, executor, saved,
    args: { records, evidenceBytes, build, eligibility: f.eligibility, payload: f.payload, run: f.run,
      inputs: { verification: { ...f.publicInput.verification, independentInputs: Object.fromEntries(
        Object.entries(f.publicInput.verification.independentInputs).map(([key, value]) => [key, typeof value === "string" ? Buffer.from(value, "base64url") : value])) } } },
    config: { github: f.github, publicBuildInputsBytes: f.options.publicBuildInputsBytes, publicBuildInputsSha256: f.options.publicBuildInputsSha256,
      checkPolicyBytes: f.options.checkPolicyBytes, checkPolicySha256: f.options.checkPolicySha256,
      authenticateOfflineExecution: f.dependencies.authenticateOfflineExecution,
      authenticateArchiveReadback: f.dependencies.authenticateArchiveReadback, nowMs: 1000 } };
}
