import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { canonicalJson } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-trust-contract.mjs";
import { classifyReleaseTag, evaluateReleaseRun, TAG_WORKFLOW_PATH } from "./release-eligibility.mjs";

export const RELEASE_SCOPE = "fusou-release-manifest-v1";
export const MAX_RELEASE_RECORD_BYTES = 1024 * 1024;
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("base64url");
const commit = /^[a-f0-9]{40}$/;
const id = /^[A-Za-z0-9._-]{1,128}$/;
const platforms = new Set(["linux-x86_64", "linux-aarch64", "windows-x86_64", "windows-aarch64", "macos-x86_64", "macos-aarch64"]);
const identifier = (value) => typeof value === "string" && id.test(value);

function requireValue(condition, label) {
  if (!condition) throw new Error(`release manifest: ${label}`);
}
function exact(value, keys, label) {
  requireValue(value && typeof value === "object" && !Array.isArray(value) &&
    isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort()), `${label} field inventory`);
}
function digest(value) {
  requireValue(typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value) &&
    Buffer.from(value, "base64url").toString("base64url") === value, "canonical SHA-256");
}
function positive(value) {
  requireValue(Number.isSafeInteger(value) && value > 0, "positive safe integer");
}
function binary(bytes) {
  requireValue(bytes instanceof Uint8Array, "raw binary bytes required");
}

export function encodeReleaseManifest(manifest) {
  // Canonical keys recursively sorted; arrays ordered; UTF-8, no BOM/whitespace/newline.
  const bytes = Buffer.from(canonicalJson(manifest), "utf8");
  parseReleaseManifest(bytes);
  return bytes;
}

export function parseReleaseManifest(bytes) {
  binary(bytes);
  requireValue(bytes.byteLength > 0 && bytes.byteLength <= MAX_RELEASE_RECORD_BYTES, "record byte limit");
  const raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const m = JSON.parse(raw);
  requireValue(canonicalJson(m) === raw, "canonical JSON required (including unique keys)");
  exact(m, ["schema_version", "scope", "release", "validation", "eligibility", "artifacts", "worker",
    "runtime_config", "registries", "targets", "checks", "deployment"], "root");
  requireValue(m.schema_version === 1 && m.scope === RELEASE_SCOPE, "schema/scope");
  exact(m.release, ["repository", "tag", "kind", "commit_sha", "app_version"], "release");
  requireValue(m.release.repository === "tsukasa-u/FUSOU" && commit.test(m.release.commit_sha) &&
    classifyReleaseTag(m.release.tag) === m.release.kind && m.release.kind === "production" &&
    m.release.tag === `fusou-v${m.release.app_version}`, "release identity");
  exact(m.validation, ["run_id", "run_attempt", "workflow_path", "workflow_blob_sha", "source_sha"], "validation");
  positive(m.validation.run_id); positive(m.validation.run_attempt);
  requireValue(m.validation.workflow_path === TAG_WORKFLOW_PATH && commit.test(m.validation.workflow_blob_sha) &&
    m.validation.source_sha === m.release.commit_sha, "validation identity");
  exact(m.eligibility, ["run_id", "run_attempt", "coordinator_sha", "status"], "eligibility");
  positive(m.eligibility.run_id); positive(m.eligibility.run_attempt);
  requireValue(commit.test(m.eligibility.coordinator_sha) && m.eligibility.status === "PRODUCTION_ELIGIBLE", "eligibility identity");
  requireValue(Array.isArray(m.artifacts) && m.artifacts.length >= 2 && m.artifacts.length <= 16, "artifact inventory");
  const names = new Set();
  const appPlatforms = new Set();
  for (const a of m.artifacts) {
    exact(a, ["name", "role", "platform", "sha256", "byte_length", "source_sha", "build_run_id",
      "build_run_attempt", "build_workflow_sha", "build_record_sha256"], "artifact");
    requireValue(identifier(a.name) && !names.has(a.name), "unique artifact name");
    names.add(a.name);
    digest(a.sha256); digest(a.build_record_sha256);
    positive(a.byte_length); positive(a.build_run_id); positive(a.build_run_attempt);
    requireValue(a.source_sha === m.release.commit_sha && commit.test(a.build_workflow_sha), "artifact provenance");
    requireValue(a.role === "app" ? platforms.has(a.platform) && !appPlatforms.has(a.platform) :
      a.role === "worker" && a.platform === "cloudflare-workers", "role/platform");
    if (a.role === "app") appPlatforms.add(a.platform);
  }
  requireValue(appPlatforms.size > 0 && m.artifacts.filter((a) => a.role === "worker").length === 1, "APP and Worker required");
  exact(m.worker, ["name", "source_sha", "artifact_sha256", "version_id"], "Worker");
  requireValue(typeof m.worker.name === "string" && /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/.test(m.worker.name) &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(m.worker.version_id) &&
    m.worker.version_id !== "00000000-0000-0000-0000-000000000000" &&
    m.worker.source_sha === m.release.commit_sha &&
    m.worker.artifact_sha256 === m.artifacts.find((a) => a.role === "worker").sha256, "Worker binding");
  exact(m.runtime_config, ["schema_version", "epoch", "manifest_sha256", "signer_key_id", "trust_root_sha256"], "Runtime Config");
  requireValue(m.runtime_config.schema_version === 2 && typeof m.runtime_config.epoch === "string" && /^[1-9][0-9]{0,19}$/.test(m.runtime_config.epoch) &&
    BigInt(m.runtime_config.epoch) <= 18446744073709551615n && identifier(m.runtime_config.signer_key_id), "Runtime Config identity");
  digest(m.runtime_config.manifest_sha256); digest(m.runtime_config.trust_root_sha256);
  exact(m.registries, ["result_signer_key_id", "result_registry_sha256", "notary_registry_sha256",
    "session_authority_key_id", "security_registry_set_sha256"], "registries");
  requireValue(identifier(m.registries.result_signer_key_id) && identifier(m.registries.session_authority_key_id), "signer identity");
  for (const key of ["result_registry_sha256", "notary_registry_sha256", "security_registry_set_sha256"]) digest(m.registries[key]);
  exact(m.targets, ["origin_inventory_sha256", "target_approval_artifact_sha256"], "targets");
  Object.values(m.targets).forEach(digest);
  exact(m.checks, ["locked_dependencies", "compiled_inputs", "archive_readback", "offline_verification"], "checks");
  Object.values(m.checks).forEach(digest);
  exact(m.deployment, ["status"], "deployment");
  requireValue(m.deployment.status === "NOT_CHECKED", "manifest cannot self-attest deployment");
  return m;
}

// Expected references and observed bytes come from a separate trusted consumer,
// never from this manifest's claims. This verifies linkage, not TLSN signatures.
export function validateReleaseManifest(bytes, { expected, artifactBytes, buildRecords, evidenceBytes, observedRuns } = {}) {
  const m = parseReleaseManifest(bytes);
  requireValue(expected && artifactBytes instanceof Map && buildRecords instanceof Map &&
    evidenceBytes instanceof Map && observedRuns instanceof Map, "independent expectations/observations required");
  for (const field of ["release", "validation", "eligibility", "worker", "runtime_config", "registries", "targets", "checks"]) {
    requireValue(isDeepStrictEqual(m[field], expected[field]), `${field} differs from independent reference`);
  }
  requireValue(isDeepStrictEqual(m.artifacts, expected.artifacts), "artifact inventory differs from independent reference");
  requireValue(artifactBytes.size === m.artifacts.length && buildRecords.size === m.artifacts.length, "missing/extra observations");
  for (const a of m.artifacts) {
    assertBuildRun(observedRuns.get(`${a.build_run_id}:${a.build_run_attempt}`), a, m.release.repository);
    const raw = artifactBytes.get(a.name);
    const record = buildRecords.get(a.name);
    binary(raw); binary(record);
    requireValue(raw.byteLength === a.byte_length && sha256(raw) === a.sha256, `artifact hash/length: ${a.name}`);
    requireValue(record.byteLength <= MAX_RELEASE_RECORD_BYTES && sha256(record) === a.build_record_sha256, `build record hash: ${a.name}`);
    const provenance = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(record));
    requireValue(canonicalJson(provenance) === Buffer.from(record).toString("utf8"), "canonical build record");
    exact(provenance, ["schema_version", "scope", "source_sha", "run_id", "run_attempt", "workflow_sha",
      "artifact_sha256", "platform", "input_record_sha256"], "build record");
    requireValue(provenance.schema_version === 1 && provenance.scope === "fusou-release-build-provenance-v1", "build record schema");
    digest(provenance.input_record_sha256);
    const inputRecord = evidenceBytes.get(provenance.input_record_sha256);
    binary(inputRecord);
    requireValue(sha256(inputRecord) === provenance.input_record_sha256, "input build record readback");
    for (const [key, value] of Object.entries({
      source_sha: a.source_sha, run_id: a.build_run_id, run_attempt: a.build_run_attempt,
      workflow_sha: a.build_workflow_sha, artifact_sha256: a.sha256, platform: a.platform,
    })) requireValue(provenance[key] === value, `build record ${key}: ${a.name}`);
  }

  const required = [m.runtime_config.manifest_sha256, ...Object.values(m.checks),
    m.registries.result_registry_sha256, m.registries.notary_registry_sha256,
    m.registries.security_registry_set_sha256, m.runtime_config.trust_root_sha256, ...Object.values(m.targets)];
  for (const hash of required) {
    const raw = evidenceBytes.get(hash);
    binary(raw);
    requireValue(sha256(raw) === hash, "evidence readback hash");
  }
  for (const [check, hash] of Object.entries(m.checks)) {
    const raw = evidenceBytes.get(hash);
    requireValue(raw.byteLength <= MAX_RELEASE_RECORD_BYTES, "check record limit");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    const record = JSON.parse(text);
    exact(record, ["schema_version", "scope", "check", "status", "source_sha", "run_id",
      "run_attempt", "workflow_sha", "evidence_sha256"], "check record");
    requireValue(canonicalJson(record) === text && record.schema_version === 1 &&
      record.scope === "fusou-release-check-v1" && record.check === check && record.status === "PASS" &&
      record.source_sha === m.release.commit_sha, "check status/source identity");
    assertBuildRun(observedRuns.get(`${record.run_id}:${record.run_attempt}`), {
      build_run_id: record.run_id, build_run_attempt: record.run_attempt, build_workflow_sha: record.workflow_sha,
    }, m.release.repository);
    digest(record.evidence_sha256);
    const evidence = evidenceBytes.get(record.evidence_sha256);
    binary(evidence);
    requireValue(sha256(evidence) === record.evidence_sha256, "check evidence readback");
  }
  return {
    schema_version: 1, status: "RELEASE_ARTIFACTS_VALIDATED",
    scope: "independently-supplied-reference-and-raw-byte-linkage-only",
    manifest_sha256: sha256(bytes), tag_status: "PRODUCTION_ELIGIBLE",
    signature_status: "NOT_CHECKED", deployment_status: "NOT_CHECKED",
    publication_authorized: false, production_acceptance: "BLOCKED",
  };
}

function assertBuildRun(run, artifact, repository) {
  requireValue(run?.id === artifact.build_run_id && run.run_attempt === artifact.build_run_attempt &&
    run.repository?.full_name === repository && run.head_repository?.full_name === repository &&
    run.event === "workflow_run" && run.path === ".github/workflows/tlsn-release-eligibility.yml" &&
    run.head_branch === "main" && run.head_sha === artifact.build_workflow_sha &&
    run.status === "completed" && run.conclusion === "success", "independent build run metadata");
}

export async function observeReleaseBuildRuns(github, manifest, evidenceBytes) {
  requireValue(evidenceBytes instanceof Map, "check record observations required");
  const observed = new Map();
  const candidates = [...manifest.artifacts];
  for (const hash of Object.values(manifest.checks)) {
    const raw = evidenceBytes.get(hash);
    binary(raw);
    requireValue(raw.byteLength <= MAX_RELEASE_RECORD_BYTES && sha256(raw) === hash, "check record readback");
    const record = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    positive(record.run_id); positive(record.run_attempt);
    requireValue(commit.test(record.workflow_sha), "check workflow SHA");
    candidates.push({ build_run_id: record.run_id, build_run_attempt: record.run_attempt, build_workflow_sha: record.workflow_sha });
  }
  for (const a of candidates) {
    const key = `${a.build_run_id}:${a.build_run_attempt}`;
    if (observed.has(key)) continue;
    const { data } = await github.rest.actions.getWorkflowRun({
      owner: "tsukasa-u", repo: "FUSOU", run_id: a.build_run_id,
    });
    assertBuildRun(data, a, manifest.release.repository);
    observed.set(key, data);
  }
  return observed;
}

export function assertReleaseRuntimeConfigBinding(manifest, payload, rawEnvelope) {
  binary(rawEnvelope);
  requireValue(sha256(rawEnvelope) === manifest.runtime_config.manifest_sha256 &&
    payload.epoch === manifest.runtime_config.epoch &&
    payload.source.worker_git_commit_sha === manifest.release.commit_sha &&
    payload.source.active_version_id === manifest.worker.version_id &&
    payload.source.script_name === manifest.worker.name, "Runtime Config source/version/epoch binding");
  for (const key of ["origin_inventory_sha256", "target_approval_artifact_sha256"]) {
    requireValue(payload.production_authority_pins[key] === manifest.targets[key], `Runtime Config ${key}`);
  }
  requireValue(payload.production_authority_pins.security_registry_set_sha256 === manifest.registries.security_registry_set_sha256 &&
    payload.result_registry_pins.result_registry_sha256 === manifest.registries.result_registry_sha256 &&
    payload.compile_inputs.FUSOU_TLSN_RESULT_SIGNER_KEY_ID === manifest.registries.result_signer_key_id &&
    payload.compile_inputs.FUSOU_TLSN_SESSION_AUTHORITY_KEY_ID === manifest.registries.session_authority_key_id &&
    sha256(Buffer.from(payload.compile_inputs.FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY)) === manifest.registries.result_registry_sha256,
  "Runtime Config registry/signer binding");
}

export async function recheckReleaseManifestTag(github, manifest, trustedSha) {
  const fresh = await evaluateReleaseRun({
    github, repository: { owner: "tsukasa-u", repo: "FUSOU" },
    runId: manifest.validation.run_id, trustedSha,
  });
  requireValue(fresh.status === "PRODUCTION_ELIGIBLE" && fresh.tag === manifest.release.tag &&
    fresh.commit_sha === manifest.release.commit_sha &&
    fresh.validation_run_attempt === manifest.validation.run_attempt &&
    fresh.validation_workflow_blob_sha === manifest.validation.workflow_blob_sha, "live tag/validation binding");
  return fresh;
}

export async function verifyProductionReleaseManifest(bytes, observations, { github, runtimeVerification, trustedSha } = {}) {
  const manifest = parseReleaseManifest(bytes);
  const envelope = observations?.evidenceBytes?.get(manifest.runtime_config.manifest_sha256);
  binary(envelope);
  // Reuse the real signature/freshness/independent-input verifier; no mock default.
  const { verifyTlsnRuntimeConfigProductionEnvelope } = await import(
    "../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-manifest.mjs"
  );
  const verified = verifyTlsnRuntimeConfigProductionEnvelope(envelope, runtimeVerification);
  requireValue(runtimeVerification.trustedSigner.key_id === manifest.runtime_config.signer_key_id &&
    sha256(Buffer.from(runtimeVerification.trustedSigner.public_key_spki, "base64url")) === manifest.runtime_config.trust_root_sha256,
  "Runtime Config external signer/root");
  assertReleaseRuntimeConfigBinding(manifest, verified.payload, envelope);
  await recheckReleaseManifestTag(github, manifest, trustedSha);
  const securitySet = JSON.parse(Buffer.from(observations.evidenceBytes.get(manifest.registries.security_registry_set_sha256)).toString("utf8"));
  const notaryRaw = observations.evidenceBytes.get(manifest.registries.notary_registry_sha256);
  binary(notaryRaw);
  requireValue(canonicalJson(JSON.parse(Buffer.from(notaryRaw).toString("utf8"))) === canonicalJson(securitySet.notary_registry),
    "Notary registry differs from signed security registry set");
  const observedRuns = await observeReleaseBuildRuns(github, manifest, observations.evidenceBytes);
  const result = validateReleaseManifest(bytes, { ...observations, observedRuns });
  await recheckReleaseManifestTag(github, manifest, trustedSha);
  return { ...result, runtime_config_signature_status: "VERIFIED", validated_at_coordinator_sha: trustedSha, publication_authorized: false };
}
