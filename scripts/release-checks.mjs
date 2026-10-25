import { isDeepStrictEqual } from "node:util";
import { canonicalJson } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-trust-contract.mjs";
import {
  assertCompiledReport, assertCompiledPublicConfiguration, runtimeConfigBootstrapReport, entryInputSha256,
} from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-build-handoff.mjs";
import { sha256 } from "./release-bytes.mjs";
import { requireRelease, parseReleaseRecord, assertArtifactBuildProof } from "./release-build-proof.mjs";
import { ReleaseBlocked } from "./release-transport.mjs";
import { readReleaseSource, inspectWorkerSourceAt, encodeUnsignedWorkerPackage } from "./release-worker-source.mjs";
import { assertCanonicalServerIdentity } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/origin-trust-contract.mjs";

export const CHECKS = ["locked_dependencies", "compiled_inputs", "archive_readback", "offline_verification"];
// Data-only artifacts cannot carry these in-process execution capabilities.
const offlineExecutionProofs = new WeakMap();
const archiveReadbackProofs = new WeakMap();
export const LOCK_PATHS = ["pnpm-lock.yaml", "packages/FUSOU-APP/src-tauri/Cargo.lock", "package.json"];
export const jsonBytes = (value) => Buffer.from(canonicalJson(value));
export function checkContext(run, sourceSha) {
  return { repository: "tsukasa-u/FUSOU", source_sha: sourceSha, run_id: run.id,
    run_attempt: run.run_attempt, workflow_sha: run.head_sha };
}
const descriptors = (blobs) => Object.fromEntries([...blobs].sort(([a], [b]) => a.localeCompare(b, "en")).map(
  ([name, raw]) => {
    requireRelease(raw instanceof Uint8Array, "check raw input");
    return [name, { sha256: sha256(raw), byte_length: raw.byteLength }];
  }));
export function recordCheckExecution(check, context, inputs, output, { status = "PASS", exitCode = 0, error = null } = {}) {
  requireRelease(CHECKS.includes(check) && context.repository === "tsukasa-u/FUSOU" &&
    /^[0-9a-f]{40}$/.test(context.source_sha) && /^[0-9a-f]{40}$/.test(context.workflow_sha) &&
    Number.isSafeInteger(context.run_id) && context.run_id > 0 && Number.isSafeInteger(context.run_attempt) &&
    context.run_attempt > 0 && (status === "PASS" ? exitCode === 0 && error === null :
      status === "FAIL" && Number.isInteger(exitCode) && typeof error === "string" && error.length > 0),
  "check execution context/result");
  const input = descriptors(inputs);
  const receipt = jsonBytes({ schema_version: 1, scope: "fusou-release-check-execution-v1",
    check, ...context, inputs: input, input_sha256: sha256(jsonBytes(input)), status,
    exit_code: exitCode, error, output });
  const record = jsonBytes({ schema_version: 1, scope: "fusou-release-check-v1", check, status,
    source_sha: context.source_sha, run_id: context.run_id, run_attempt: context.run_attempt,
    workflow_sha: context.workflow_sha, evidence_sha256: sha256(receipt) });
  const files = new Map([[`check-${check}.json`, record], [`evidence-${sha256(receipt)}.bin`, receipt]]);
  for (const raw of inputs.values()) files.set(`evidence-${sha256(raw)}.bin`, Buffer.from(raw));
  return { record, receipt, files };
}
function receiptFor(check, records, evidence, context) {
  const record = records[check];
  if (!record) throw new ReleaseBlocked(`MISSING_${check.toUpperCase()}_EXECUTION`);
  const raw = evidence.get(record.evidence_sha256), receipt = parseReleaseRecord(raw);
  requireRelease(sha256(raw) === record.evidence_sha256 && record.check === check && record.status === "PASS" &&
    record.schema_version === 1 && record.scope === "fusou-release-check-v1" &&
    receipt.schema_version === 1 && receipt.scope === "fusou-release-check-execution-v1" &&
    receipt.check === check && receipt.status === "PASS" && receipt.exit_code === 0 && receipt.error === null &&
    Object.entries(context).every(([key, value]) => receipt[key] === value) &&
    record.source_sha === context.source_sha && record.run_id === context.run_id &&
    record.run_attempt === context.run_attempt && record.workflow_sha === context.workflow_sha &&
    receipt.input_sha256 === sha256(jsonBytes(receipt.inputs)), "check execution identity/result/input digest");
  const inputs = new Map();
  for (const [name, descriptor] of Object.entries(receipt.inputs)) {
    const bytes = evidence.get(descriptor.sha256);
    requireRelease(bytes instanceof Uint8Array && bytes.byteLength === descriptor.byte_length &&
      sha256(bytes) === descriptor.sha256, "required raw check input missing/corrupt");
    inputs.set(name, bytes);
  }
  return { receipt, inputs };
}
function sameInputs(actual, expected) {
  requireRelease(isDeepStrictEqual(descriptors(actual), descriptors(expected)), "check independent input inventory/digest");
}
export function parsePinnedCheckInputs(raw, pin, scope) {
  if (raw === undefined || !pin) throw new ReleaseBlocked(`PINNED_${scope.toUpperCase().replaceAll("-", "_")}_MISSING`);
  requireRelease(sha256(raw) === pin, "independent check policy digest");
  const value = parseReleaseRecord(raw);
  requireRelease(value.schema_version === 1 && value.scope === scope, "independent check policy scope");
  return value;
}
export function recordCompiledInputsExecution({ context, publicBuildInputs, artifacts, buildRecords, observations, rawEvidence }) {
  requireRelease(artifacts.some((a) => a.role === "app") && artifacts.filter((a) => a.role === "worker").length === 1,
    "complete APP and Worker outputs required before recording compiled check");
  const inputs = new Map([["public_build_inputs", jsonBytes(publicBuildInputs)]]), appReports = {};
  for (const artifact of artifacts) {
    const raw = buildRecords.get(artifact.name), wrapper = parseReleaseRecord(raw);
    requireRelease(wrapper.source_sha === context.source_sha && wrapper.run_id === context.run_id &&
      wrapper.run_attempt === context.run_attempt && wrapper.workflow_sha === context.workflow_sha &&
      wrapper.artifact_sha256 === artifact.sha256, "compiled recorder build identity");
    inputs.set(`record_${artifact.name}`, raw);
    if (artifact.role !== "app") continue;
    const observation = parseReleaseRecord(observations.get(artifact.name));
    requireRelease(observation.scope === "fusou-app-compiled-execution-observations-v1" &&
      Object.entries(context).every(([key, value]) => observation[key] === value) &&
      observation.app_build_record_sha256 === sha256(raw) && observation.executable_sha256 === artifact.sha256 &&
      observation.public_build_inputs_sha256 === sha256(jsonBytes(publicBuildInputs)), "actual APP report observation identity");
    const metadata = { executable_sha256: artifact.sha256 };
    for (const role of ["worker", "public"]) {
      const report = observation.reports[role], stdout = rawEvidence.get(report.stdout_sha256);
      requireRelease(report.exit_code === 0 && stdout instanceof Uint8Array && sha256(stdout) === report.stdout_sha256 &&
        report.executable_sha256 === artifact.sha256, "actual APP report process result");
      metadata[role] = { argv: report.argv, exit_code: report.exit_code, stdout_sha256: report.stdout_sha256 };
      inputs.set(`stdout_${artifact.name}_${role}`, stdout);
    }
    appReports[artifact.name] = metadata;
  }
  return recordCheckExecution("compiled_inputs", context, inputs, {
    projection_sha256: entryInputSha256(publicBuildInputs.worker_reference.compile_inputs), app_reports: appReports,
  });
}
function assertLockedExecution(inputs, output) {
  requireRelease(isDeepStrictEqual([...inputs.keys()].sort(), [...LOCK_PATHS].sort()), "locked source input inventory");
  const commands = output.commands;
  requireRelease(Array.isArray(commands) && commands.some((c) => isDeepStrictEqual(c.argv,
    ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"]) && c.exit_code === 0) &&
    commands.some((c) => isDeepStrictEqual(c.argv,
      ["pnpm", "exec", "tauri", "build", "--ci", "--no-bundle", "--features", "tlsn-production,custom-protocol", "--", "--locked"]) &&
      c.exit_code === 0), "frozen/locked commands were not recorded as executed");
  const packageManager = JSON.parse(inputs.get("package.json")).packageManager;
  requireRelease(/^pnpm@\d+\.\d+\.\d+(?:\+.*)?$/.test(packageManager) &&
    output.pnpm_version === packageManager.slice(5).split("+")[0], "pnpm toolchain mismatch");
}
export function recordLockedDependenciesExecution({ context, inputs, output, appRecord }) {
  assertLockedExecution(inputs, output);
  requireRelease(appRecord.cargo_lock_sha256 === sha256(inputs.get(LOCK_PATHS[1])), "build Cargo.lock differs from observed source");
  return recordCheckExecution("locked_dependencies", context, inputs, output);
}
export async function verifyLockedDependencies({ inputs, receipt, github, context, build }) {
  const expected = new Map(await Promise.all(LOCK_PATHS.map(async (path) =>
    [path, await readReleaseSource(github, context.source_sha, path)])));
  sameInputs(inputs, expected);
  assertLockedExecution(inputs, receipt.output);
  for (const artifact of build.artifacts.filter((a) => a.role === "app")) {
    const p = parseReleaseRecord(build.buildRecords.get(artifact.name));
    const record = parseReleaseRecord(build.evidenceBytes.get(p.input_record_sha256));
    requireRelease(record.details.cargo_lock_sha256 === sha256(expected.get(LOCK_PATHS[1])), "build Cargo.lock differs from exact source");
  }
}
export async function verifyCompiledInputs({ inputs, receipt, build, payload, publicBuildInputs, runtimeVerification, github, context, workerToolchain }) {
  requireRelease(build.artifacts.some((a) => a.role === "app") &&
    build.artifacts.filter((a) => a.role === "worker").length === 1, "APP and Worker compiled inputs required");
  requireRelease(publicBuildInputs.app_source_sha === context.source_sha &&
    publicBuildInputs.worker_reference.compile_inputs &&
    isDeepStrictEqual(publicBuildInputs.worker_reference.compile_inputs, payload.compile_inputs) &&
    publicBuildInputs.worker_reference.cloudflare.version_id === payload.source.active_version_id &&
    publicBuildInputs.worker_reference.cloudflare.script_name === payload.source.script_name, "independent compile Worker reference");
  const referenceRaw = runtimeVerification.independentInputs.worker_reference_raw;
  requireRelease(isDeepStrictEqual(JSON.parse(referenceRaw), publicBuildInputs.worker_reference), "signed Worker reference/public build inputs");
  const bootstrap = runtimeConfigBootstrapReport(publicBuildInputs.runtime_config_bootstrap);
  requireRelease(bootstrap.signer_key_id === runtimeVerification.trustedSigner.key_id &&
    bootstrap.signer_public_key_spki === runtimeVerification.trustedSigner.public_key_spki, "compiled bootstrap independent root");
  const expected = new Map([["public_build_inputs", jsonBytes(publicBuildInputs)]]);
  for (const artifact of build.artifacts) {
    const provenance = parseReleaseRecord(build.buildRecords.get(artifact.name));
    const raw = build.evidenceBytes.get(provenance.input_record_sha256), wrapper = parseReleaseRecord(raw), d = wrapper.details;
    expected.set(`record_${artifact.name}`, raw);
    if (artifact.role === "app") {
      requireRelease(d.rust_toolchain === publicBuildInputs.rust_toolchain, "compiled Rust toolchain");
      assertCompiledReport(d.compiled_report, publicBuildInputs.worker_reference, context.source_sha, "release", bootstrap);
      assertCompiledPublicConfiguration(d.compiled_public_configuration, publicBuildInputs.public_app_inputs);
      const observations = receipt.output.app_reports?.[artifact.name];
      requireRelease(observations?.executable_sha256 === artifact.sha256, "compiled report executable digest");
      for (const [role, flag, value] of [
        ["worker", "--tlsn-compiled-worker-entry", d.compiled_report],
        ["public", "--app-compiled-public-configuration", d.compiled_public_configuration],
      ]) {
        const stdout = inputs.get(`stdout_${artifact.name}_${role}`);
        requireRelease(stdout instanceof Uint8Array && isDeepStrictEqual(JSON.parse(Buffer.from(stdout)), value) &&
          observations[role]?.stdout_sha256 === sha256(stdout) && observations[role].exit_code === 0 &&
          isDeepStrictEqual(observations[role].argv, [flag]), "compiled report actual stdout/command");
        expected.set(`stdout_${artifact.name}_${role}`, stdout);
      }
    } else {
      if (!workerToolchain) throw new ReleaseBlocked("PINNED_WORKER_TOOLCHAIN_MISSING");
      const source = await inspectWorkerSourceAt(github, context.source_sha);
      if (source.status !== "SOURCE_INPUTS_PRESENT") throw new ReleaseBlocked("WORKER_SOURCE_INCOMPLETE_AT_RELEASE_SHA", "BLOCKED_IMPLEMENTATION");
      requireRelease(d.scope === "fusou-unsigned-worker-build-v1" &&
        d.source_inputs_sha256 === source.source_inputs_sha256 && isDeepStrictEqual(d.source_inputs, source.source_inputs) &&
        isDeepStrictEqual(d.commands, source.commands) && d.version_reference?.worker_git_commit_sha === context.source_sha &&
        d.version_reference.active_version_id === payload.source.active_version_id &&
        d.version_reference.script_name === payload.source.script_name &&
        isDeepStrictEqual(d.toolchain, workerToolchain), "Worker source/recipe/reference/toolchain mismatch");
      const bundleRaw = build.artifactBytes.get(artifact.name), bundle = parseReleaseRecord(bundleRaw);
      requireRelease(bundle.scope === "fusou-unsigned-worker-package-v1" && bundle.schema_version === 1 &&
        bundle.entrypoint === "index.js" && bundle.modules["index.js"] &&
        Object.keys(bundle.modules).some((name) => name.endsWith(".wasm")), "dummy/missing Worker package");
      const modules = new Map();
      for (const [name, descriptor] of Object.entries(bundle.modules)) {
        const bytes = Buffer.from(descriptor.bytes, "base64url");
        requireRelease(bytes.toString("base64url") === descriptor.bytes && bytes.length === descriptor.byte_length &&
          sha256(bytes) === descriptor.sha256, "Worker module readback");
        modules.set(name, bytes);
      }
      requireRelease(encodeUnsignedWorkerPackage(modules).equals(Buffer.from(bundleRaw)), "Worker package output contract");
    }
  }
  sameInputs(inputs, expected);
  requireRelease(receipt.output.projection_sha256 === entryInputSha256(payload.compile_inputs), "compiled projection digest");
}
export async function captureArchiveReadback({ context, expected, sourceBytes, backend, now = () => Date.now() }) {
  if (!backend?.get) throw new ReleaseBlocked("ARCHIVE_BACKEND_NOT_CONFIGURED");
  const expectedSnapshot = jsonBytes(expected), contextSnapshot = jsonBytes(context);
  const saved = new Map([...sourceBytes].map(([role, raw]) => [role, Buffer.from(raw)])), inputs = new Map(), objects = [];
  for (const role of ["presentation", "result"]) {
    const identity = expected.objects[role], original = saved.get(role);
    requireRelease(original instanceof Uint8Array && identity.sha256 === sha256(original) &&
      identity.role === role && identity.session_id === expected.session_id &&
      identity.capture_id === expected.capture_id, "archive capture identity/role");
    const read = await backend.get({ ...identity });
    requireRelease(read?.bytes instanceof Uint8Array && Object.entries(identity).every(([key, value]) => read[key] === value) &&
      read.bytes.byteLength === original.byteLength && Buffer.from(read.bytes).equals(original) &&
      sha256(sourceBytes.get(role)) === sha256(original), "archive backend identity/readback bytes mismatch");
    const readAt = now();
    requireRelease(Number.isSafeInteger(readAt), "archive observation clock");
    inputs.set(`saved_${role}`, original); inputs.set(`readback_${role}`, Buffer.from(read.bytes));
    objects.push({ ...identity, read_at_ms: readAt, sha256: sha256(read.bytes), byte_length: read.bytes.byteLength });
  }
  sameInputs(sourceBytes, saved);
  requireRelease(expectedSnapshot.equals(jsonBytes(expected)) && contextSnapshot.equals(jsonBytes(context)), "archive capture inputs changed");
  const output = { session_id: expected.session_id, capture_id: expected.capture_id, objects };
  verifyArchiveReadback({ inputs, receipt: { output }, policy: expected, nowMs: now() });
  const execution = recordCheckExecution("archive_readback", context, inputs, output);
  execution.executionProof = Object.freeze({});
  archiveReadbackProofs.set(execution.executionProof, { receipt_sha256: sha256(execution.receipt), inputs: descriptors(inputs) });
  return execution;
}
export function verifyArchiveReadback({ inputs, receipt, policy, nowMs }) {
  requireRelease(Number.isSafeInteger(nowMs) && Number.isSafeInteger(policy.not_before_ms) &&
    Number.isSafeInteger(policy.max_age_ms) && policy.max_age_ms > 0 &&
    receipt.output.session_id === policy.session_id && receipt.output.capture_id === policy.capture_id &&
    Array.isArray(receipt.output.objects) && receipt.output.objects.length === 2, "archive session/capture correlation");
  for (const role of ["presentation", "result"]) {
    const identity = policy.objects[role], object = receipt.output.objects.find((o) => o.role === role);
    requireRelease(identity.role === role && identity.session_id === policy.session_id && identity.capture_id === policy.capture_id &&
      ["backend_id", "object_key", "version_id", "session_id", "capture_id", "job_id", "verification_attempt_id", "sha256"]
        .every((key) => typeof identity[key] === "string" && identity[key].length > 0) &&
      identity.verification_attempt_id === policy.objects.result.verification_attempt_id &&
      identity.job_id === policy.objects.result.job_id &&
      identity.object_key === `tlsn-verification/${identity.verification_attempt_id}/${role}.${role === "presentation" ? "bin" : "json"}` &&
      object && Object.entries(identity).every(([key, value]) => object[key] === value) &&
      Number.isSafeInteger(object.read_at_ms) && object.read_at_ms >= policy.not_before_ms &&
      object.read_at_ms <= nowMs && nowMs - object.read_at_ms <= policy.max_age_ms, "archive origin/version/freshness");
    const saved = inputs.get(`saved_${role}`), readback = inputs.get(`readback_${role}`);
    requireRelease(saved instanceof Uint8Array && readback instanceof Uint8Array &&
      Buffer.from(saved).equals(Buffer.from(readback)) && object.sha256 === sha256(readback) &&
      object.byte_length === readback.byteLength && sha256(readback) === identity.sha256, "archive exact bytes/hash/length");
  }
  requireRelease(inputs.size === 4, "archive raw input inventory");
}
const fileFlags = {
  bundle: "--bundle", trusted_notary_registry: "--trusted-notary-registry", session_authority_registry: "--session-authority-registry",
  binding_authority_registry: "--binding-authority-registry", origin_inventory: "--origin-inventory",
  target_approval: "--target-approval", trust_anchor_der: "--trust-anchor-der",
};
const scalarFlags = ["evidence-root-key-id", "evidence-root-public-key-spki", "session-authority-key-id",
  "session-authority-public-key-spki", "binding-authority-key-id", "binding-authority-public-key-spki",
  "canonical-user-id", "device-id", "device-public-key", "server-identity", "profile-sha256", "verifier-key-id"];
export function offlineInvocation(policy) {
  requireRelease(/^[A-Za-z0-9_-]{43}$/.test(policy.executable_sha256), "independently pinned native executable digest");
  const argv = [];
  for (const [role, flag] of Object.entries(fileFlags)) argv.push(flag, `${role}.input`);
  for (const flag of scalarFlags) {
    requireRelease(typeof policy.options?.[flag] === "string" && policy.options[flag].length > 0, "offline independent CLI option");
    argv.push(`--${flag}`, policy.options[flag]);
  }
  if (policy.options["sparse-profile-sha256"]) argv.push("--sparse-profile-sha256", policy.options["sparse-profile-sha256"]);
  return argv;
}
export const OFFLINE_BUNDLE_ARTIFACTS = ["presentation", "result", "result_registry", "result_registry_envelope",
  "notary_registry", "health", "session", "authenticated_user", "device_identity", "device_authentication",
  "possession_proof", "consume_receipt", "replay", "session_authority_registry", "binding_authority_registry",
  "capture_metadata", "semantic_verification", "trust_root", "subject"];
export function offlineLayout(policy, inputs) {
  const files = new Map(), required = [...Object.keys(fileFlags)], bundle = JSON.parse(Buffer.from(inputs.get("bundle")));
  requireRelease(bundle.artifacts && OFFLINE_BUNDLE_ARTIFACTS.every((role) => bundle.artifacts[role]), "native bundle required artifacts");
  for (const role of Object.keys(fileFlags)) files.set(`${role}.input`, inputs.get(role));
  for (const [role, descriptor] of Object.entries(bundle.artifacts)) {
    const name = `bundle_artifact_${role}`, raw = inputs.get(name), path = descriptor.path;
    requireRelease(/^[a-z][a-z0-9_]*$/.test(role) && typeof path === "string" && path.length > 0 &&
      !path.startsWith("/") && !/[\\:\0]/.test(path) &&
      path.split("/").every((part) => part && part !== "." && part !== "..") && !files.has(path) &&
      raw instanceof Uint8Array && sha256(raw) === descriptor.sha256 && raw.byteLength === descriptor.byte_length,
    "native bundle raw artifact/path binding");
    files.set(path, raw); required.push(name);
  }
  requireRelease(Object.keys(policy.input_sha256).sort().join() === required.sort().join(), "offline required input digest inventory");
  for (const role of required) requireRelease(inputs.get(role) instanceof Uint8Array &&
    sha256(inputs.get(role)) === policy.input_sha256[role], "offline independently pinned raw input");
  for (const [cli, artifact] of [["trusted_notary_registry", "notary_registry"],
    ["session_authority_registry", "session_authority_registry"], ["binding_authority_registry", "binding_authority_registry"]]) {
    requireRelease(Buffer.from(inputs.get(cli)).equals(Buffer.from(inputs.get(`bundle_artifact_${artifact}`))),
      "offline CLI/bundle authority registry bytes");
  }
  return { argv: offlineInvocation(policy), files, required };
}
export async function captureOfflineExecution({ context, inputs, policy }, { execute } = {}) {
  if (typeof execute !== "function") throw new ReleaseBlocked("TRUSTED_NATIVE_OFFLINE_EXECUTOR_NOT_CONFIGURED");
  const policySnapshot = jsonBytes(policy), contextSnapshot = jsonBytes(context);
  const snapshot = descriptors(inputs), layout = offlineLayout(policy, inputs), argv = layout.argv;
  const executionInputs = new Map([...inputs].map(([k, v]) => [k, Buffer.from(v)]));
  const executionFiles = offlineLayout(policy, executionInputs).files;
  const fileSnapshot = descriptors(executionFiles);
  const result = await execute({ argv: [...argv], inputs: executionInputs, files: executionFiles,
    executable_sha256: policy.executable_sha256 });
  requireRelease(isDeepStrictEqual(snapshot, descriptors(inputs)) && isDeepStrictEqual(snapshot, descriptors(executionInputs)) &&
    policySnapshot.equals(jsonBytes(policy)) && contextSnapshot.equals(jsonBytes(context)) &&
    isDeepStrictEqual(fileSnapshot, descriptors(executionFiles)) &&
    result.stdout instanceof Uint8Array &&
    result.executable_sha256 === policy.executable_sha256 && isDeepStrictEqual(result.argv, argv) &&
    Number.isInteger(result.exit_code), "native execution source/executable/command");
  const rawInputs = new Map(inputs); rawInputs.set("stdout", result.stdout);
  if (result.exit_code === 0) assertOfflineReport(result.stdout, policy);
  const execution = recordCheckExecution("offline_verification", context, rawInputs,
    { executable_sha256: result.executable_sha256, argv, stdout_sha256: sha256(result.stdout) },
    result.exit_code === 0 ? {} : { status: "FAIL", exitCode: result.exit_code, error: "native verifier rejected evidence" });
  if (result.exit_code === 0) {
    execution.executionProof = Object.freeze({});
    offlineExecutionProofs.set(execution.executionProof, { receipt_sha256: sha256(execution.receipt),
      inputs: descriptors(rawInputs), executable_sha256: policy.executable_sha256 });
  }
  return execution;
}
function assertAuthenticatedOfflineExecution(proof, execution, policy) {
  requireRelease(proof && isDeepStrictEqual(offlineExecutionProofs.get(proof), {
    receipt_sha256: sha256(jsonBytes(execution.receipt)), inputs: descriptors(execution.inputs),
    executable_sha256: policy.executable_sha256,
  }), "unauthenticated/mismatched native execution proof");
}
function assertOfflineReport(stdout, policy) {
  const report = JSON.parse(Buffer.from(stdout));
  assertCanonicalServerIdentity(policy.options["server-identity"]);
  requireRelease(report.status === "VERIFIED" && report.verification === "FUSOU_TLSN_EVIDENCE_BUNDLE" &&
    ["evidence_root", "result_registry", "result_signature", "result_evidence_binding", "tlsn_presentation", "notary", "artifact_manifest"]
      .every((key) => report.trust?.[key] === "VERIFIED") &&
    policy.expected_derived && Object.keys(policy.expected_derived).length > 0 &&
    policy.expected_derived.server_identity === policy.options["server-identity"] &&
    Object.entries(policy.expected_derived).every(([key, value]) => report.derived?.[key] === value), "native verification result/trust/identity");
}
export function verifyOfflineExecution({ inputs, receipt, policy, archiveInputs, archivePolicy, context }) {
  requireRelease(receipt.output.executable_sha256 === policy.executable_sha256 &&
    isDeepStrictEqual(receipt.output.argv, offlineInvocation(policy)), "offline executable/independent arguments");
  const stdout = inputs.get("stdout");
  requireRelease(stdout instanceof Uint8Array && sha256(stdout) === receipt.output.stdout_sha256, "offline actual stdout");
  assertOfflineReport(stdout, policy);
  const layout = offlineLayout(policy, inputs);
  requireRelease(inputs.size === layout.required.length + 1, "offline required raw input inventory");
  for (const role of ["presentation", "result"]) {
    requireRelease(Buffer.from(inputs.get(`bundle_artifact_${role}`)).equals(Buffer.from(archiveInputs.get(`readback_${role}`))),
      "offline verifier did not receive the same archive readback");
  }
  const manifest = JSON.parse(Buffer.from(inputs.get("bundle")));
  const session = JSON.parse(Buffer.from(inputs.get("bundle_artifact_session")));
  requireRelease(manifest.security_identity?.git_commit_sha === context.source_sha &&
    manifest.capture_id === archivePolicy.capture_id && session.session_id === archivePolicy.session_id,
  "signed bundle source/capture/session correlation");
}
export async function verifyReleaseChecks({ records, evidenceBytes, build, eligibility, inputs, payload, run },
  { github, publicBuildInputsBytes, publicBuildInputsSha256, checkPolicyBytes, checkPolicySha256,
    authenticateOfflineExecution, authenticateArchiveReadback, nowMs = Date.now() } = {}) {
  requireRelease(build.artifacts.length > 0, "check producer build origin required");
  for (const artifact of build.artifacts) assertArtifactBuildProof(build.buildProofs.get(artifact.name), artifact);
  const context = checkContext(run, eligibility.commit_sha), results = {}, verified = {};
  const pinnedPolicy = () => {
    const policy = parsePinnedCheckInputs(checkPolicyBytes, checkPolicySha256, "fusou-release-check-inputs-v1");
    requireRelease(policy.repository === context.repository && policy.source_sha === context.source_sha,
      "independent check policy repository/source");
    return policy;
  };
  for (const check of CHECKS) {
    try {
      const execution = receiptFor(check, records, evidenceBytes, context);
      if (check === "locked_dependencies") await verifyLockedDependencies({ ...execution, github, context, build });
      if (check === "compiled_inputs") {
        if (!publicBuildInputsBytes || !publicBuildInputsSha256) throw new ReleaseBlocked("PINNED_PUBLIC_BUILD_INPUTS_MISSING");
        if (!payload || !inputs?.verification) throw new ReleaseBlocked("VERIFIED_RUNTIME_CONFIG_REQUIRED");
        requireRelease(sha256(publicBuildInputsBytes) === publicBuildInputsSha256, "independent public build input hash");
        const publicBuildInputs = parseReleaseRecord(publicBuildInputsBytes);
        const workerToolchain = checkPolicyBytes && checkPolicySha256 ?
          pinnedPolicy().worker_toolchain : undefined;
        await verifyCompiledInputs({ ...execution, build, payload, publicBuildInputs,
          runtimeVerification: inputs.verification, github, context, workerToolchain });
      }
      if (check === "archive_readback") {
        const checkPolicy = pinnedPolicy();
        if (!checkPolicy.archive) throw new ReleaseBlocked("AUTHENTICATED_ARCHIVE_CONTEXT_MISSING");
        verifyArchiveReadback({ ...execution, policy: checkPolicy.archive, nowMs });
        if (typeof authenticateArchiveReadback !== "function") {
          throw new ReleaseBlocked("AUTHENTICATED_ARCHIVE_READBACK_INTAKE_NOT_CONFIGURED", "BLOCKED_IMPLEMENTATION");
        }
        const proof = await authenticateArchiveReadback({ ...execution, policy: checkPolicy.archive, context });
        requireRelease(proof && isDeepStrictEqual(archiveReadbackProofs.get(proof), {
          receipt_sha256: sha256(jsonBytes(execution.receipt)), inputs: descriptors(execution.inputs),
        }), "unauthenticated/mismatched archive readback proof");
      }
      if (check === "offline_verification") {
        const checkPolicy = pinnedPolicy();
        if (!checkPolicy.offline) throw new ReleaseBlocked("NATIVE_OFFLINE_TRUST_INPUTS_MISSING");
        if (!payload || !inputs?.verification) throw new ReleaseBlocked("VERIFIED_RUNTIME_CONFIG_REQUIRED");
        if (!verified.archive_readback) throw new ReleaseBlocked("VERIFIED_ARCHIVE_READBACK_REQUIRED");
        for (const [role, raw] of [["origin_inventory", inputs.verification.independentInputs.origin_inventory_raw],
          ["target_approval", inputs.verification.independentInputs.target_approval_raw]]) {
          requireRelease(execution.inputs.get(role) instanceof Uint8Array &&
            Buffer.from(execution.inputs.get(role)).equals(Buffer.from(raw)), "offline signed Runtime Config authority inputs");
        }
        requireRelease(checkPolicy.offline.options["session-authority-key-id"] === payload.compile_inputs.FUSOU_TLSN_SESSION_AUTHORITY_KEY_ID &&
          checkPolicy.offline.options["session-authority-public-key-spki"] === payload.compile_inputs.FUSOU_TLSN_SESSION_AUTHORITY_PUBLIC_KEY &&
          checkPolicy.offline.expected_derived.result_signer_key_id === payload.compile_inputs.FUSOU_TLSN_RESULT_SIGNER_KEY_ID &&
          checkPolicy.offline.expected_derived.result_key_registry_sha256 === payload.result_registry_pins.result_registry_sha256,
        "offline Runtime Config authority/signer pins");
        const security = JSON.parse(Buffer.from(inputs.verification.independentInputs.security_registry_set_raw));
        requireRelease(checkPolicy.offline.expected_derived.notary_key_id === security.notary_key_id &&
          security.notary_registry[security.notary_key_id] === payload.compile_inputs.FUSOU_TLSN_NOTARY_VERIFYING_KEY &&
          isDeepStrictEqual(JSON.parse(Buffer.from(execution.inputs.get("trusted_notary_registry"))), security.notary_registry),
        "offline signed Runtime Config Notary registry/identity");
        verifyOfflineExecution({ ...execution, policy: checkPolicy.offline, archiveInputs: verified.archive_readback.inputs,
          archivePolicy: checkPolicy.archive, context });
        if (typeof authenticateOfflineExecution !== "function") {
          throw new ReleaseBlocked("AUTHENTICATED_OFFLINE_EXECUTION_INTAKE_NOT_CONFIGURED", "BLOCKED_IMPLEMENTATION");
        }
        const proof = await authenticateOfflineExecution({ ...execution, policy: checkPolicy.offline, context });
        assertAuthenticatedOfflineExecution(proof, execution, checkPolicy.offline);
      }
      verified[check] = execution; results[check] = { status: "VERIFIED", evidence_sha256: records[check].evidence_sha256 };
    } catch (error) {
      if (!(error instanceof ReleaseBlocked)) throw error;
      results[check] = { status: error.status, blocker: error.code };
    }
  }
  const blocked = Object.values(results).filter((r) => r.status !== "VERIFIED");
  if (blocked.length) {
    const error = new ReleaseBlocked(blocked.map((r) => r.blocker).join(","),
      blocked.some((r) => r.status === "BLOCKED_IMPLEMENTATION") ? "BLOCKED_IMPLEMENTATION" : "BLOCKED_EXTERNAL_INPUTS");
    error.check_results = results; throw error;
  }
  return { status: "CHECK_EXECUTIONS_VERIFIED", checks: results };
}
