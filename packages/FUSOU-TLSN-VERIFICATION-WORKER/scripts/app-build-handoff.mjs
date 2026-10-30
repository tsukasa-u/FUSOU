import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { assertWorkerEndpointMapping } from "./app-worker-endpoint-mapping.mjs";
import {
  assertNotaryRegistryConsistency, assertResultSigningIdentity, canonicalJson,
} from "./production-trust-contract.mjs";
import { publicToolEnvironment } from "./app-build-tool-environment.mjs";
import {
  publicAppConfigurationSha256, publicAppEnvironment, validatePublicAppInputs,
} from "./app-public-configuration.mjs";

export const ENTRY_INPUT_CONTRACT = JSON.parse(await readFile(new URL("./app-worker-entry-input-contract-v1.json", import.meta.url), "utf8"));
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("base64url");
const shaPattern = /^[0-9a-f]{40}$/;
const digestPattern = /^[A-Za-z0-9_-]{43}$/;
const uuidPattern = /^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export const RUNTIME_CONFIG_BOOTSTRAP_INPUTS = Object.freeze([
  "FUSOU_TLSN_RUNTIME_CONFIG_MANIFEST_URL",
  "FUSOU_TLSN_RUNTIME_CONFIG_SIGNER_KEY_ID",
  "FUSOU_TLSN_RUNTIME_CONFIG_SIGNER_PUBLIC_KEY_SPKI",
]);
const runtimeConfigManifestPath = "/tlsn/runtime-config/v2/manifest.json";
const canonicalDnsHostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const ed25519SpkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
const publicBindingNames = [
  "TLSN_ENVIRONMENT", "TLSN_DEPLOYMENT_ROLE", "TLSN_GIT_COMMIT_SHA",
  "TLSN_PRODUCTION_DEPLOYMENT_ID", "TLSN_PRODUCTION_WORKER_NAME",
  "TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI", "TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID",
  "TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY", "TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE",
  "TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_KEY_ID", "TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI",
  "TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_ID", "TLSN_PRODUCTION_SESSION_AUTHORITY_PUBLIC_KEY_SPKI",
  "TLSN_CANDIDATE_NOTARY_KEY_ID", "TLSN_PRODUCTION_NOTARY_REGISTRY",
  "TLSN_CANDIDATE_VERIFIER_KEY_ID", "TLSN_SECURITY_REGISTRY_SET_SHA256",
];

function exactFields(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
    throw new Error(`${label} field inventory is invalid`);
  }
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString());
  } catch {
    throw new Error(`${label} is malformed JSON`);
  }
}

export function runtimeConfigBootstrapInputs(environment) {
  const values = RUNTIME_CONFIG_BOOTSTRAP_INPUTS.map((name) => environment[name]);
  if (values.every((value) => value === undefined)) return null;
  if (values.some((value) => typeof value !== "string" || !value || value !== value.trim() || value.includes("\0"))) {
    throw new Error("Runtime Config bootstrap release inputs must be supplied as a complete non-empty set");
  }

  const [manifestUrl, signerKeyId, signerPublicKeySpki] = values;
  let url;
  try {
    url = new URL(manifestUrl);
  } catch {
    throw new Error("Runtime Config bootstrap manifest URL is invalid");
  }
  if (url.protocol !== "https:" || url.href !== manifestUrl ||
      !canonicalDnsHostnamePattern.test(url.hostname) || url.username || url.password || url.port || url.search || url.hash ||
      url.pathname !== runtimeConfigManifestPath) {
    throw new Error("Runtime Config bootstrap manifest URL is not a canonical HTTPS DNS URL");
  }
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(signerKeyId)) {
    throw new Error("Runtime Config bootstrap signer key ID is invalid");
  }
  const publicKeyBytes = Buffer.from(signerPublicKeySpki, "base64url");
  if (publicKeyBytes.length !== ed25519SpkiPrefix.length + 32 ||
      !publicKeyBytes.subarray(0, ed25519SpkiPrefix.length).equals(ed25519SpkiPrefix) ||
      publicKeyBytes.toString("base64url") !== signerPublicKeySpki) {
    throw new Error("Runtime Config bootstrap signer SPKI is invalid");
  }
  return Object.fromEntries(RUNTIME_CONFIG_BOOTSTRAP_INPUTS.map((name, index) => [name, values[index]]));
}

function runtimeConfigBootstrapReportFromInputs(inputs) {
  if (inputs === null) {
    return {
      registration_status: "UNREGISTERED",
      manifest_url: null,
      signer_key_id: null,
      signer_public_key_spki: null,
    };
  }
  return {
    registration_status: "EMBEDDED_UNVERIFIED",
    manifest_url: inputs.FUSOU_TLSN_RUNTIME_CONFIG_MANIFEST_URL,
    signer_key_id: inputs.FUSOU_TLSN_RUNTIME_CONFIG_SIGNER_KEY_ID,
    signer_public_key_spki: inputs.FUSOU_TLSN_RUNTIME_CONFIG_SIGNER_PUBLIC_KEY_SPKI,
  };
}

export function runtimeConfigBootstrapReport(inputs) {
  const validated = inputs === null ? null : runtimeConfigBootstrapInputs(inputs);
  return runtimeConfigBootstrapReportFromInputs(validated);
}

export function assertRuntimeConfigBootstrapReport(report) {
  exactFields(report, [
    "registration_status", "manifest_url", "signer_key_id", "signer_public_key_spki",
  ], "compiled Runtime Config bootstrap report");
  let expected;
  if (report.registration_status === "UNREGISTERED") {
    expected = runtimeConfigBootstrapReportFromInputs(null);
  } else if (report.registration_status === "EMBEDDED_UNVERIFIED") {
    const inputs = runtimeConfigBootstrapInputs({
      FUSOU_TLSN_RUNTIME_CONFIG_MANIFEST_URL: report.manifest_url,
      FUSOU_TLSN_RUNTIME_CONFIG_SIGNER_KEY_ID: report.signer_key_id,
      FUSOU_TLSN_RUNTIME_CONFIG_SIGNER_PUBLIC_KEY_SPKI: report.signer_public_key_spki,
    });
    expected = runtimeConfigBootstrapReportFromInputs(inputs);
  } else {
    throw new Error("compiled Runtime Config bootstrap report status is invalid");
  }
  if (canonicalJson(report) !== canonicalJson(expected)) {
    throw new Error("compiled Runtime Config bootstrap report is malformed");
  }
  return expected;
}

export function entryInputSha256(inputs) {
  exactFields(inputs, ENTRY_INPUT_CONTRACT.compile_inputs, "Worker entry compile inputs");
  if (Object.values(inputs).some((value) => typeof value !== "string" || !value.trim() || value.includes("\0"))) {
    throw new Error("Worker entry compile input is missing or invalid");
  }
  return sha256(canonicalJson({
    schema_version: ENTRY_INPUT_CONTRACT.schema_version,
    scope: ENTRY_INPUT_CONTRACT.scope,
    compile_inputs: inputs,
  }));
}

export function assertBuildReference(reference, expectedWorkerSha) {
  exactFields(reference, ["schema_version", "scope", "authority", "observed_at", "release_context",
    "disclosure_mode", "endpoint_mapping", "cloudflare", "compile_inputs"], "APP Worker reference");
  entryInputSha256(reference.compile_inputs);
  const inputs = reference.compile_inputs;
  const cf = reference.cloudflare;
  exactFields(cf, ["account_id", "script_name", "deployments_source", "version_source",
    "deployment_id", "created_on", "version_id", "percentage", "checked_public_bindings"], "Cloudflare reference");
  exactFields(reference.release_context, ["workflow_run_id", "workflow_run_attempt", "git_commit_sha",
    "repository", "workflow_file_identity", "deployment_role"], "approved release context");
  exactFields(cf.checked_public_bindings, publicBindingNames, "checked public bindings");
  const source = `https://api.cloudflare.com/client/v4/accounts/${cf.account_id}/workers/scripts/${cf.script_name}`;
  if (reference.schema_version !== 2 || reference.scope !== "tlsn-app-approved-worker-deployment-reference" ||
      reference.authority !== "operator-controlled-approved-release-and-authenticated-cloudflare-control-plane" ||
      !Number.isFinite(Date.parse(reference.observed_at)) || !Number.isFinite(Date.parse(cf.created_on)) ||
      !/^[0-9a-f]{32}$/.test(cf.account_id ?? "") || !/^[a-z][a-z0-9-]{1,62}[a-z0-9]$/.test(cf.script_name ?? "") ||
      !uuidPattern.test(cf.deployment_id ?? "") || !uuidPattern.test(cf.version_id ?? "") || cf.percentage !== 100 ||
      cf.deployments_source !== `${source}/deployments` || cf.version_source !== `${source}/versions/${cf.version_id}` ||
      !shaPattern.test(expectedWorkerSha ?? "") || inputs.FUSOU_TLSN_EXPECTED_GIT_COMMIT_SHA !== expectedWorkerSha ||
      reference.release_context.git_commit_sha !== expectedWorkerSha || reference.release_context.deployment_role !== "production" ||
      inputs.FUSOU_TLSN_EXPECTED_BINDING_MODE !== "random" || inputs.FUSOU_TLSN_EXPECTED_WORKER_NAME !== cf.script_name ||
      inputs.FUSOU_TLSN_EXPECTED_ACTIVE_VERSION_ID !== cf.version_id) {
    throw new Error("APP build reference deployment/version/release pins disagree");
  }
  const health = new URL(inputs.FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT);
  const verification = new URL(inputs.FUSOU_TLSN_VERIFICATION_ENDPOINT);
  if (reference.disclosure_mode !== "complete") {
    throw new Error("APP build reference requires complete disclosure because its Prover reveals the full transcript");
  }
  const path = "/verify/tlsn";
  for (const [url, raw, wantedPath] of [
    [health, inputs.FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT, "/health"],
    [verification, inputs.FUSOU_TLSN_VERIFICATION_ENDPOINT, path],
  ]) {
    if (url.protocol !== "https:" || url.href !== raw || !url.hostname.includes(".") ||
        url.username || url.password || url.port || url.search || url.hash || url.pathname !== wantedPath) {
      throw new Error("APP build reference endpoint pin is invalid");
    }
  }
  if (health.origin !== verification.origin) throw new Error("APP build reference endpoint origins disagree");
  assertWorkerEndpointMapping(reference.endpoint_mapping, health.origin, cf.account_id, cf.script_name);
  for (const [name, expected] of [
    ["TLSN_ENVIRONMENT", "production"], ["TLSN_DEPLOYMENT_ROLE", "production"],
    ["TLSN_GIT_COMMIT_SHA", expectedWorkerSha],
    ["TLSN_PRODUCTION_DEPLOYMENT_ID", inputs.FUSOU_TLSN_EXPECTED_DEPLOYMENT_ID],
    ["TLSN_PRODUCTION_WORKER_NAME", inputs.FUSOU_TLSN_EXPECTED_WORKER_NAME],
    ["TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI", inputs.FUSOU_TLSN_RESULT_PUBLIC_KEY_SPKI],
    ["TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID", inputs.FUSOU_TLSN_RESULT_SIGNER_KEY_ID],
    ["TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY", inputs.FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY],
    ["TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_ID", inputs.FUSOU_TLSN_SESSION_AUTHORITY_KEY_ID],
    ["TLSN_PRODUCTION_SESSION_AUTHORITY_PUBLIC_KEY_SPKI", inputs.FUSOU_TLSN_SESSION_AUTHORITY_PUBLIC_KEY],
  ]) {
    if (cf.checked_public_bindings[name] !== expected) throw new Error(`APP build reference public binding disagrees: ${name}`);
  }
  const bindings = cf.checked_public_bindings;
  assertResultSigningIdentity({
    registry: inputs.FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY,
    registryRaw: inputs.FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY,
    keyId: inputs.FUSOU_TLSN_RESULT_SIGNER_KEY_ID,
    publicKeySpki: inputs.FUSOU_TLSN_RESULT_PUBLIC_KEY_SPKI,
    registryEnvelope: bindings.TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE,
    registryRootKeyId: bindings.TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_KEY_ID,
    registryRootPublicKeySpki: bindings.TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI,
  });
  assertNotaryRegistryConsistency({
    sourceRegistryRaw: bindings.TLSN_PRODUCTION_NOTARY_REGISTRY,
    keyId: bindings.TLSN_CANDIDATE_NOTARY_KEY_ID,
    appVerifyingKey: inputs.FUSOU_TLSN_NOTARY_VERIFYING_KEY,
  });
  return reference;
}

export function approvedBuildEnvironment(
  environment, reference, appSourceSha, targetDirectory, publicInputs, bootstrapInputs,
) {
  const result = publicToolEnvironment(environment);
  const workerInputNames = new Set(ENTRY_INPUT_CONTRACT.compile_inputs);
  const bootstrapInputNames = new Set(RUNTIME_CONFIG_BOOTSTRAP_INPUTS);
  // Do not inherit dotenv overloads, compiler wrappers/flags or credential-bearing environments.
  for (const name of Object.keys(environment)) {
    if (name.startsWith("FUSOU_TLSN_") &&
        (!workerInputNames.has(name) && !bootstrapInputNames.has(name) ||
          workerInputNames.has(name) && environment[name] !== reference.compile_inputs[name])) {
      throw new Error("inherited TLSN compile input conflicts with the approved reference");
    }
  }
  if (environment.FUSOU_APP_BUILD_SOURCE_SHA !== undefined && environment.FUSOU_APP_BUILD_SOURCE_SHA !== appSourceSha) {
    throw new Error("inherited APP source pin conflicts with the approved source");
  }
  return {
    ...result, ...publicAppEnvironment(publicInputs), ...reference.compile_inputs, ...(bootstrapInputs ?? {}),
    FUSOU_APP_BUILD_SOURCE_SHA: appSourceSha,
    CARGO_TARGET_DIR: targetDirectory,
  };
}

export function runPublicBuildCommand(command, args, options) {
  const completed = spawnSync(command, args, { ...options, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (completed.error || completed.status !== 0) {
    // Raw child output can contain secrets from local tooling. Never publish it in records/logs.
    throw new Error(`APP build command failed: ${basename(command)} (exit ${completed.status ?? "unavailable"})`);
  }
  return completed.stdout;
}

async function inspectSource(repository, expectedSha, run, env) {
  const lockRelativePath = "packages/FUSOU-APP/src-tauri/Cargo.lock";
  const lockPath = join(repository, lockRelativePath);
  let lockStat;
  try {
    lockStat = await lstat(lockPath);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("APP Cargo.lock is missing from the approved source checkout");
    throw error;
  }
  if (!lockStat.isFile() || lockStat.isSymbolicLink()) {
    throw new Error("APP Cargo.lock must be a regular file in the approved source checkout");
  }
  let trackedLockPath;
  try {
    trackedLockPath = run("git", ["ls-files", "--error-unmatch", "--", lockRelativePath],
      { cwd: repository, env }).trim();
  } catch {
    throw new Error("APP Cargo.lock must be tracked by the approved source revision");
  }
  if (trackedLockPath !== lockRelativePath) {
    throw new Error("APP Cargo.lock must be tracked by the approved source revision");
  }
  const head = run("git", ["rev-parse", "HEAD"], { cwd: repository, env }).trim();
  const changes = run("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repository, env }).trim();
  if (head !== expectedSha || changes) throw new Error("APP source must be the independently approved clean checkout");
}

export function assertCompiledReport(report, reference, appSourceSha, profile, expectedBootstrapReport) {
  exactFields(report, ["schema_version", "scope", "entry_input_sha256", "worker_source_sha", "active_version_id",
    "app_source_sha", "build_profile", "tlsn_production_feature", "custom_protocol_feature",
    "runtime_config_bootstrap", "authority_status"], "compiled APP report");
  const expectedBootstrap = assertRuntimeConfigBootstrapReport(expectedBootstrapReport);
  assertRuntimeConfigBootstrapReport(report.runtime_config_bootstrap);
  for (const [name, expected] of Object.entries({
    schema_version: 2, scope: "fusou-tlsn-app-compiled-worker-entry-report",
    entry_input_sha256: entryInputSha256(reference.compile_inputs),
    worker_source_sha: reference.compile_inputs.FUSOU_TLSN_EXPECTED_GIT_COMMIT_SHA,
    active_version_id: reference.cloudflare.version_id, app_source_sha: appSourceSha,
    build_profile: profile, tlsn_production_feature: true, custom_protocol_feature: true, authority_status: "UNVERIFIED",
  })) {
    if (report[name] !== expected) {
      throw new Error(`actual APP binary does not match approved build handoff: ${name}`);
    }
  }
  if (canonicalJson(report.runtime_config_bootstrap) !== canonicalJson(expectedBootstrap)) {
    throw new Error("actual APP binary does not match approved Runtime Config bootstrap inputs");
  }
}

export function assertCompiledPublicConfiguration(report, inputs) {
  exactFields(report, ["schema_version", "scope", "public_app_configuration_sha256",
    "discord_client_id_present", "authority_status"], "compiled APP public configuration report");
  if (report.schema_version !== 1 || report.scope !== "fusou-app-compiled-public-configuration-report" ||
      report.public_app_configuration_sha256 !== publicAppConfigurationSha256(inputs) ||
      report.discord_client_id_present !== (inputs.DISCORD_CLIENT_ID !== null) || report.authority_status !== "UNVERIFIED") {
    throw new Error("actual APP binary public configuration does not match canonical dotenvx inputs");
  }
}

export async function buildApprovedApp({
  referencePath, expectedReferenceSha256, expectedWorkerSha, expectedAppSha, outputDirectory,
  repositoryDirectory, toolchain, profile = "release", environment = process.env,
}, { run = runPublicBuildCommand, loadDotenvx } = {}) {
  if (!digestPattern.test(expectedReferenceSha256 ?? "") || !shaPattern.test(expectedAppSha ?? "") ||
      !/^\d+\.\d+\.\d+$/.test(toolchain ?? "") || !["debug", "release"].includes(profile)) {
    throw new Error("independent reference hash, APP source, exact Rust toolchain and build profile are required");
  }
  const bootstrapInputs = runtimeConfigBootstrapInputs(environment);
  if (!bootstrapInputs) {
    throw new Error("approved tlsn-production APP release requires registered Runtime Config bootstrap inputs");
  }
  referencePath = resolve(referencePath);
  outputDirectory = resolve(outputDirectory);
  repositoryDirectory = await realpath(resolve(repositoryDirectory));
  outputDirectory = join(await realpath(dirname(outputDirectory)), basename(outputDirectory));
  if (outputDirectory === repositoryDirectory || outputDirectory.startsWith(`${repositoryDirectory}${sep}`)) {
    throw new Error("build output must be outside the approved source checkout");
  }
  const initialStat = await lstat(referencePath, { bigint: true });
  if (!initialStat.isFile() || initialStat.isSymbolicLink()) throw new Error("reference must be an operator-controlled regular file");
  const bytes = await readFile(referencePath);
  if (sha256(bytes) !== expectedReferenceSha256) throw new Error("reference raw SHA-256 does not match the independent approved pin");
  const reference = assertBuildReference(parseJson(bytes, "APP Worker reference"), expectedWorkerSha);
  const appDirectory = join(repositoryDirectory, "packages/FUSOU-APP");
  const loader = loadDotenvx ?? (await import("./app-dotenvx-inputs.mjs")).loadCanonicalAppDotenvx;
  const dotenvxInputs = await loader(appDirectory, environment);
  const publicInputs = validatePublicAppInputs(dotenvxInputs.inputs);
  const targetDirectory = join(outputDirectory, "cargo-target");
  const env = {
    ...approvedBuildEnvironment(
      environment, reference, expectedAppSha, targetDirectory, publicInputs, bootstrapInputs,
    ),
    RUSTUP_TOOLCHAIN: toolchain,
  };
  const expectedEnvironment = { ...env };
  async function unchanged() {
    const stat = await lstat(referencePath, { bigint: true });
    if (stat.dev !== initialStat.dev || stat.ino !== initialStat.ino || stat.mtimeNs !== initialStat.mtimeNs ||
        stat.ctimeNs !== initialStat.ctimeNs || !stat.isFile() || sha256(await readFile(referencePath)) !== expectedReferenceSha256) {
      throw new Error("approved reference changed during APP build");
    }
    if (JSON.stringify(Object.entries(env).sort()) !== JSON.stringify(Object.entries(expectedEnvironment).sort())) {
      throw new Error("actual APP binary/build environment changed after input isolation");
    }
    await dotenvxInputs.assertUnchanged();
    await inspectSource(repositoryDirectory, expectedAppSha, run, env);
  }
  await unchanged();
  const lockPath = join(appDirectory, "src-tauri/Cargo.lock");
  const lockBytes = await readFile(lockPath);
  // Exclusive fresh target/output avoids stale artifacts and reuse of an earlier build record.
  await mkdir(outputDirectory, { mode: 0o700 });
  const rustc = run("rustc", ["--version", "--verbose"], { cwd: repositoryDirectory, env }).trim();
  const cargo = run("cargo", ["--version"], { cwd: repositoryDirectory, env }).trim();
  if (!rustc.startsWith(`rustc ${toolchain} `) || !cargo.startsWith(`cargo ${toolchain} `)) {
    throw new Error("actual Rust/Cargo toolchain does not match the independently selected toolchain");
  }
  const tauriConfigBytes = await readFile(join(appDirectory, "src-tauri/tauri.conf.json"));
  const buildArgs = ["exec", "tauri", "build", "--ci", "--no-bundle", "--features", "tlsn-production,custom-protocol"];
  if (profile === "debug") buildArgs.push("--debug");
  buildArgs.push("--", "--locked");
  run("pnpm", buildArgs, { cwd: appDirectory, env });
  await unchanged();
  const artifactPath = join(targetDirectory, profile, process.platform === "win32" ? "fusou.exe" : "fusou");
  const artifactStat = await lstat(artifactPath);
  if (!artifactStat.isFile() || artifactStat.isSymbolicLink()) throw new Error("built APP artifact is not a regular file");
  const artifactBytes = await readFile(artifactPath);
  const compiledReport = parseJson(run(artifactPath, ["--tlsn-compiled-worker-entry"], { cwd: appDirectory, env }), "compiled APP report");
  const expectedBootstrapReport = runtimeConfigBootstrapReport(bootstrapInputs);
  assertCompiledReport(compiledReport, reference, expectedAppSha, profile, expectedBootstrapReport);
  const compiledPublicConfiguration = parseJson(run(artifactPath, ["--app-compiled-public-configuration"],
    { cwd: appDirectory, env }), "compiled APP public configuration report");
  assertCompiledPublicConfiguration(compiledPublicConfiguration, publicInputs);
  await unchanged();
  if (sha256(await readFile(artifactPath)) !== sha256(artifactBytes) ||
      sha256(await readFile(lockPath)) !== sha256(lockBytes) ||
      sha256(await readFile(join(appDirectory, "src-tauri/tauri.conf.json"))) !== sha256(tauriConfigBytes)) {
    throw new Error("APP build artifact/lock/config changed during handoff verification");
  }
  const record = {
    schema_version: 3, scope: "fusou-tlsn-app-operator-build-record", created_at: new Date().toISOString(),
    authority_status: "UNVERIFIED", compiled_input_comparison: "VERIFIED",
    runtime_config_bootstrap_comparison: "VERIFIED",
    reference_sha256: expectedReferenceSha256, worker_source_sha: expectedWorkerSha,
    app_source_sha: expectedAppSha, active_version_id: reference.cloudflare.version_id,
    entry_input_sha256: compiledReport.entry_input_sha256, disclosure_mode: reference.disclosure_mode,
    runtime_config_bootstrap: expectedBootstrapReport,
    public_app_build_inputs_sha256: sha256(canonicalJson(publicAppEnvironment(publicInputs))),
    public_app_configuration_sha256: publicAppConfigurationSha256(publicInputs),
    public_app_configuration_comparison: "VERIFIED",
    dotenvx_input_reference: dotenvxInputs.reference,
    rust_toolchain: toolchain, rustc, cargo, build_profile: profile, build_command: ["pnpm", ...buildArgs],
    cargo_lock_sha256: sha256(lockBytes), tauri_config_sha256: sha256(tauriConfigBytes),
    artifact: { path: artifactPath, sha256: sha256(artifactBytes), byte_length: artifactBytes.length },
    compiled_report: compiledReport,
    compiled_public_configuration: compiledPublicConfiguration,
  };
  const recordPath = join(outputDirectory, "app-build-record.json");
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return { record, recordPath, artifactPath };
}
