#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inputsForRole, secretInputsForRole } from "./deployment-contract.mjs";
import { checkoutCommit } from "./deployment-attestation.mjs";
import {
  CANARY_VERIFIER_WORKER_NAME,
  CANARY_WORKER_NAME,
  assertCanonicalCanaryWorkerName,
} from "./canary-deployment-target.mjs";
import {
  assertAlpha15NotaryVerifyingKey,
  canonicalJson,
  canonicalNotaryRegistryJson,
  notaryRegistrySha256,
  parseNotaryRegistry,
} from "./production-trust-contract.mjs";
import {
  assertFusouNotaryEndpoint,
  FUSOU_NOTARY_DEFAULT_MAX_CONCURRENT_SESSIONS,
  FUSOU_NOTARY_DEFAULT_SESSION_TIMEOUT_SECONDS,
  FUSOU_NOTARY_PROTOCOL,
} from "./fusou-notary-material.mjs";

export const CANARY_DEPLOYMENT_MANIFEST_SCHEMA_VERSION = 2;
export const CANARY_DEPLOYMENT_MANIFEST_SCOPE = "tlsn-canary-deployment-manifest";
export const CANARY_DEPLOYMENT_MANIFEST_INPUT = "TLSN_CANARY_DEPLOYMENT_MANIFEST";

const HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const REFERENCE_PATTERN = /^[A-Za-z0-9._:/-]{1,512}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const DNS_HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const SECRET_MARKER = /(?:private|secret|password|bearer|access[_-]?token|credential[_-]?value|token[_-]?value)/i;
const ALLOWED_INPUTS = new Set(inputsForRole("canary"));
const SECRET_INPUTS = new Set(secretInputsForRole("canary"));
const REQUIRED_NON_SECRET_INPUTS = new Set(
  inputsForRole("canary").filter((name) => !SECRET_INPUTS.has(name)),
);
const REMOVED_GOVERNANCE_INPUTS = new Set(["TLSN_CANARY_APPROVED_INPUT_CONTRACT_JSON"]);

export class CanaryDeploymentManifestValidationError extends Error {
  constructor(message, diagnostics = []) {
    super(message);
    this.name = "CanaryDeploymentManifestValidationError";
    this.diagnostics = diagnostics;
  }
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function assertExactKeys(value, keys, label) {
  const actual = Object.keys(value).sort().join("\0");
  const expected = [...keys].sort().join("\0");
  if (actual !== expected) throw new Error(`${label} fields are invalid`);
}

function assertString(value, label, pattern = null) {
  if (typeof value !== "string" || value.length === 0 || (pattern && !pattern.test(value))) throw new Error(`${label} is invalid`);
  return value;
}

function assertHash(value, label) {
  return assertString(value, label, HASH_PATTERN);
}

function assertReference(value, label) {
  return assertString(value, label, REFERENCE_PATTERN);
}

function assertTimestamp(value, label, now) {
  assertString(value, label, ISO_TIMESTAMP_PATTERN);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is invalid`);
  return parsed;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

function inputBytes(environment, name) {
  const raw = environment[name];
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  const value = raw.trim();
  if (name === "TLSN_PRODUCTION_NOTARY_REGISTRY" || name.endsWith("_REGISTRY_ENVELOPE")) {
    return Buffer.from(canonicalJson(JSON.parse(value)), "utf8");
  }
  if (name === "TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER") {
    if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new Error(`${name} is not canonical base64url`);
    const bytes = Buffer.from(value, "base64url");
    if (bytes.length === 0 || bytes.toString("base64url") !== value) throw new Error(`${name} is not canonical base64url`);
    return bytes;
  }
  return Buffer.from(value, "utf8");
}

function assertNoSecrets(value, label = "deployment manifest") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_MARKER.test(key) && key !== "secret_provider") throw new Error(`${label} contains a secret value field`);
    assertNoSecrets(child, `${label}.${key}`);
  }
}

function assertValidityWindow(manifest, now) {
  const issued = assertTimestamp(manifest.issued_at, "deployment manifest.issued_at", now);
  const expires = assertTimestamp(manifest.expires_at, "deployment manifest.expires_at", now);
  if (expires <= issued || issued > now.getTime() || expires <= now.getTime()) throw new Error("deployment manifest validity window is not current");
}

function assertTarget(target, environment) {
  assertExactKeys(target, ["server_identity", "environment", "deployment_role", "binding_identity"], "deployment manifest target");
  assertString(target.server_identity, "deployment manifest target.server_identity", DNS_HOSTNAME_PATTERN);
  assertString(target.environment, "deployment manifest target.environment");
  assertString(target.deployment_role, "deployment manifest target.deployment_role");
  assertReference(target.binding_identity, "deployment manifest target.binding_identity");
  if (target.environment !== "production" || target.deployment_role !== "canary") throw new Error("deployment manifest target must be production Canary");
  if (/(?:test|synthetic|fixture|local|staging|historical|remote-test)/i.test(target.server_identity)) throw new Error("deployment manifest target is fixture, synthetic, or historical");
  if (/(?:replay|fixture|historical|synthetic)/i.test(target.binding_identity)) throw new Error("deployment manifest binding identity is not a current Canary identity");
  if (environment.TLSN_CANDIDATE_SERVER_IDENTITY?.trim() !== target.server_identity) throw new Error("deployment manifest target does not match deployment input");
  if (environment.TLSN_ENVIRONMENT?.trim() !== target.environment) throw new Error("deployment manifest environment does not match deployment input");
  if (environment.TLSN_DEPLOYMENT_ROLE?.trim() !== target.deployment_role) throw new Error("deployment manifest role does not match deployment input");
  if (environment.TLSN_CANARY_BINDING_IDENTITY?.trim() !== target.binding_identity) throw new Error("deployment manifest binding identity does not match deployment input");
}

function notaryBindingFromEnvironment(environment) {
  const endpoint = environment.TLSN_CANDIDATE_NOTARY_ENDPOINT?.trim();
  const keyId = environment.TLSN_CANDIDATE_NOTARY_KEY_ID?.trim();
  const registryRaw = environment.TLSN_PRODUCTION_NOTARY_REGISTRY?.trim();
  if (!endpoint || !keyId || !registryRaw) throw new Error("deployment manifest FUSOU-NOTARY binding inputs are incomplete");
  assertFusouNotaryEndpoint(endpoint);
  const registry = parseNotaryRegistry(registryRaw, "deployment manifest Notary registry");
  const verifyingKey = registry[keyId];
  if (!verifyingKey) throw new Error("deployment manifest Notary key ID is not present in the registry");
  return {
    endpoint,
    key_id: keyId,
    verifying_key: verifyingKey,
    registry_sha256: notaryRegistrySha256(canonicalNotaryRegistryJson(registryRaw)),
    owner: "FUSOU",
    service: "FUSOU-NOTARY",
    protocol: FUSOU_NOTARY_PROTOCOL,
    transport: "raw_tcp",
    mpc_role: "verifier",
    origin_connection: "prover_owned",
    session_timeout_seconds: FUSOU_NOTARY_DEFAULT_SESSION_TIMEOUT_SECONDS,
    max_concurrent_sessions: FUSOU_NOTARY_DEFAULT_MAX_CONCURRENT_SESSIONS,
  };
}

function assertNotaryBinding(notary, environment) {
  assertExactKeys(notary, [
    "endpoint",
    "key_id",
    "verifying_key",
    "registry_sha256",
    "owner",
    "service",
    "protocol",
    "transport",
    "mpc_role",
    "origin_connection",
    "session_timeout_seconds",
    "max_concurrent_sessions",
  ], "deployment manifest notary");
  assertFusouNotaryEndpoint(notary.endpoint);
  assertString(notary.key_id, "deployment manifest notary.key_id", /^[A-Za-z0-9._-]{1,128}$/);
  assertAlpha15NotaryVerifyingKey(notary.verifying_key, "deployment manifest notary.verifying_key");
  assertHash(notary.registry_sha256, "deployment manifest notary.registry_sha256");
  if (notary.owner !== "FUSOU" || notary.service !== "FUSOU-NOTARY") throw new Error("deployment manifest Notary ownership is invalid");
  if (notary.protocol !== FUSOU_NOTARY_PROTOCOL || notary.transport !== "raw_tcp" || notary.mpc_role !== "verifier" || notary.origin_connection !== "prover_owned") {
    throw new Error("deployment manifest Notary protocol binding is invalid");
  }
  if (!Number.isSafeInteger(notary.session_timeout_seconds) || notary.session_timeout_seconds < 1 || notary.session_timeout_seconds > 3600) {
    throw new Error("deployment manifest Notary session timeout is invalid");
  }
  if (!Number.isSafeInteger(notary.max_concurrent_sessions) || notary.max_concurrent_sessions < 1 || notary.max_concurrent_sessions > 64) {
    throw new Error("deployment manifest Notary concurrency limit is invalid");
  }
  const expected = notaryBindingFromEnvironment(environment);
  if (JSON.stringify(notary) !== JSON.stringify(expected)) throw new Error("deployment manifest Notary binding does not match deployment inputs");
}

function assertWorkflow(workflow, currentHead, environment) {
  assertExactKeys(workflow, ["repository", "run_id", "run_attempt", "workflow_file_identity", "commit_sha"], "deployment manifest workflow");
  assertReference(workflow.repository, "deployment manifest workflow.repository");
  assertString(workflow.run_id, "deployment manifest workflow.run_id", /^[1-9][0-9]*$/);
  assertString(workflow.run_attempt, "deployment manifest workflow.run_attempt", /^[1-9][0-9]*$/);
  assertString(workflow.workflow_file_identity, "deployment manifest workflow.workflow_file_identity");
  assertString(workflow.commit_sha, "deployment manifest workflow.commit_sha", /^[0-9a-f]{40}$/i);
  if (workflow.workflow_file_identity !== "dotenvx+pnpm+wrangler") throw new Error("deployment manifest workflow identity is invalid");
  if (workflow.commit_sha.toLowerCase() !== currentHead.toLowerCase()) throw new Error("deployment manifest commit does not match checked-out HEAD");
  for (const [name, expected] of [["TLSN_REPOSITORY", workflow.repository], ["TLSN_WORKFLOW_RUN_ID", workflow.run_id], ["TLSN_WORKFLOW_RUN_ATTEMPT", workflow.run_attempt], ["TLSN_WORKFLOW_FILE_IDENTITY", workflow.workflow_file_identity], ["TLSN_GIT_COMMIT_SHA", workflow.commit_sha]]) {
    if (environment[name]?.trim() !== expected) throw new Error(`deployment manifest ${name} does not match deployment input`);
  }
}

function assertInputs(inputs, environment) {
  if (!Array.isArray(inputs) || inputs.length === 0) throw new Error("deployment manifest inputs are incomplete");
  const seen = new Set();
  for (const [index, input] of inputs.entries()) {
    assertObject(input, `deployment manifest inputs[${index}]`);
    assertExactKeys(input, ["name", "value_sha256", "provenance"], `deployment manifest inputs[${index}]`);
    assertString(input.name, `deployment manifest inputs[${index}].name`, /^TLSN_[A-Z0-9_]+$/);
    if (!ALLOWED_INPUTS.has(input.name) || SECRET_INPUTS.has(input.name) || REMOVED_GOVERNANCE_INPUTS.has(input.name) || seen.has(input.name)) throw new Error(`deployment manifest input is unexpected or secret: ${input.name}`);
    seen.add(input.name);
    assertHash(input.value_sha256, `${input.name}.value_sha256`);
    assertReference(input.provenance, `${input.name}.provenance`);
    const bytes = inputBytes(environment, input.name);
    if (!bytes) throw new Error(`${input.name} is missing from deployment input`);
    if (sha256(bytes) !== input.value_sha256) throw new Error(`${input.name} fingerprint does not match deployment input`);
  }
  const missing = [...REQUIRED_NON_SECRET_INPUTS].filter((name) => !seen.has(name));
  if (missing.length > 0) throw new Error(`deployment manifest inputs are incomplete: missing ${missing.join(", ")}`);
}

async function assertArtifacts(artifacts, packageRoot) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) throw new Error("deployment manifest artifacts are incomplete");
  const seen = new Set();
  const packageRootRealPath = resolve(packageRoot);
  for (const [index, artifact] of artifacts.entries()) {
    assertObject(artifact, `deployment manifest artifacts[${index}]`);
    assertExactKeys(artifact, ["name", "path", "sha256"], `deployment manifest artifacts[${index}]`);
    assertString(artifact.name, `deployment manifest artifacts[${index}].name`, /^[A-Za-z0-9._-]{1,128}$/);
    if (seen.has(artifact.name)) throw new Error(`deployment manifest artifact is duplicated: ${artifact.name}`);
    seen.add(artifact.name);
    if (isAbsolute(artifact.path) || artifact.path.includes("\\")) throw new Error(`${artifact.name}.path must be relative POSIX path`);
    const artifactPath = resolve(packageRootRealPath, artifact.path);
    const artifactRelativePath = relative(packageRootRealPath, artifactPath);
    if (!artifactRelativePath || artifactRelativePath.startsWith("..") || isAbsolute(artifactRelativePath)) throw new Error(`${artifact.name}.path escapes package directory`);
    assertHash(artifact.sha256, `${artifact.name}.sha256`);
    const bytes = await readFile(artifactPath);
    if (sha256(bytes) !== artifact.sha256) throw new Error(`${artifact.name} hash does not match manifest`);
    if (artifact.path.endsWith(".json")) assertNoSecrets(JSON.parse(bytes.toString("utf8")), `${artifact.name} artifact`);
  }
}

function assertDeployment(deployment, environment) {
  assertExactKeys(deployment, ["deployment_id", "worker_name", "verifier_worker_name"], "deployment manifest deployment");
  assertReference(deployment.deployment_id, "deployment manifest deployment_id");
  assertCanonicalCanaryWorkerName(deployment.worker_name);
  assertString(deployment.verifier_worker_name, "deployment manifest verifier_worker_name", /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/);
  if (deployment.worker_name !== CANARY_WORKER_NAME || deployment.verifier_worker_name !== CANARY_VERIFIER_WORKER_NAME) throw new Error("deployment manifest worker identity is not canonical");
  if (environment.TLSN_CANARY_DEPLOYMENT_ID?.trim() !== deployment.deployment_id) throw new Error("deployment manifest deployment ID does not match deployment input");
}

function assertSecretProvider(secretProvider) {
  assertExactKeys(secretProvider, ["references"], "deployment manifest secret_provider");
  if (!Array.isArray(secretProvider.references) || secretProvider.references.length === 0) throw new Error("deployment manifest secret_provider.references are incomplete");
  const seen = new Set();
  for (const [index, reference] of secretProvider.references.entries()) {
    assertObject(reference, `deployment manifest secret_provider.references[${index}]`);
    assertExactKeys(reference, ["input_name", "provider_ref"], `deployment manifest secret_provider.references[${index}]`);
    assertString(reference.input_name, "deployment manifest secret provider input name", /^TLSN_[A-Z0-9_]+$/);
    if (!SECRET_INPUTS.has(reference.input_name)) throw new Error("deployment manifest secret provider input is not a Canary secret");
    if (seen.has(reference.input_name)) throw new Error(`deployment manifest secret provider input is duplicated: ${reference.input_name}`);
    seen.add(reference.input_name);
    assertReference(reference.provider_ref, "deployment manifest secret provider reference");
  }
  const missing = [...SECRET_INPUTS].filter((name) => !seen.has(name));
  if (missing.length > 0) throw new Error(`deployment manifest secret provider references are incomplete: missing ${missing.join(", ")}`);
}

export function deploymentManifestIdentity(manifest) {
  const body = { ...manifest };
  delete body.manifest_id;
  return sha256(Buffer.from(canonicalJson(body), "utf8"));
}

export function createCanaryDeploymentManifest({
  environment = process.env,
  currentHead,
  issuedAt = new Date(),
  expiresAt = new Date(issuedAt.getTime() + 30 * 60_000),
  artifacts = [],
  secretProviderReferences = [],
} = {}) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) throw new Error("cannot create deployment manifest: canonical artifacts are required");
  if (!Array.isArray(secretProviderReferences) || secretProviderReferences.length === 0) throw new Error("cannot create deployment manifest: secret provider references are required");
  const inputs = [];
  for (const name of inputsForRole("canary")) {
    if (SECRET_INPUTS.has(name) || REMOVED_GOVERNANCE_INPUTS.has(name)) continue;
    if (typeof environment[name] !== "string" || environment[name].trim().length === 0) {
      throw new Error(`cannot create deployment manifest: missing non-secret input ${name}`);
    }
    const bytes = inputBytes(environment, name);
    inputs.push({ name, value_sha256: sha256(bytes), provenance: "deployment-input" });
  }
  const manifest = {
    schema_version: CANARY_DEPLOYMENT_MANIFEST_SCHEMA_VERSION,
    scope: CANARY_DEPLOYMENT_MANIFEST_SCOPE,
    manifest_id: "pending",
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    target: {
      server_identity: environment.TLSN_CANDIDATE_SERVER_IDENTITY,
      environment: environment.TLSN_ENVIRONMENT,
      deployment_role: environment.TLSN_DEPLOYMENT_ROLE,
      binding_identity: environment.TLSN_CANARY_BINDING_IDENTITY,
    },
    notary: notaryBindingFromEnvironment(environment),
    workflow: {
      repository: environment.TLSN_REPOSITORY,
      run_id: environment.TLSN_WORKFLOW_RUN_ID,
      run_attempt: environment.TLSN_WORKFLOW_RUN_ATTEMPT,
      workflow_file_identity: environment.TLSN_WORKFLOW_FILE_IDENTITY,
      commit_sha: currentHead,
    },
    inputs,
    artifacts,
    deployment: {
      deployment_id: environment.TLSN_CANARY_DEPLOYMENT_ID,
      worker_name: environment.TLSN_CANARY_WORKER_NAME,
      verifier_worker_name: CANARY_VERIFIER_WORKER_NAME,
    },
    secret_provider: { references: secretProviderReferences },
  };
  manifest.manifest_id = deploymentManifestIdentity(manifest);
  return manifest;
}

export function parseCanaryDeploymentManifest(raw) {
  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw new Error("Canary deployment manifest must be valid JSON");
  }
  assertObject(parsed, "Canary deployment manifest");
  return parsed;
}

export async function assertCanaryDeploymentManifest(raw, {
  packageRoot = process.cwd(),
  environment = process.env,
  currentHead,
  now = new Date(),
} = {}) {
  try {
    const manifest = parseCanaryDeploymentManifest(raw);
    assertNoSecrets(manifest);
    assertExactKeys(manifest, ["schema_version", "scope", "manifest_id", "issued_at", "expires_at", "target", "notary", "workflow", "inputs", "artifacts", "deployment", "secret_provider"], "Canary deployment manifest");
    if (manifest.schema_version !== CANARY_DEPLOYMENT_MANIFEST_SCHEMA_VERSION || manifest.scope !== CANARY_DEPLOYMENT_MANIFEST_SCOPE) throw new Error("Canary deployment manifest schema is invalid");
    assertString(manifest.manifest_id, "Canary deployment manifest.manifest_id", HASH_PATTERN);
    if (deploymentManifestIdentity(manifest) !== manifest.manifest_id) throw new Error("Canary deployment manifest identity does not match canonical content");
    const validationNow = now instanceof Date ? now : new Date(now);
    if (!Number.isFinite(validationNow.getTime())) throw new Error("Canary deployment manifest validation time is invalid");
    assertValidityWindow(manifest, validationNow);
    assertTarget(manifest.target, environment);
    assertNotaryBinding(manifest.notary, environment);
    assertWorkflow(manifest.workflow, currentHead ?? checkoutCommit(resolve(packageRoot, "../..")), environment);
    assertInputs(manifest.inputs, environment);
    await assertArtifacts(manifest.artifacts, packageRoot);
    assertDeployment(manifest.deployment, environment);
    assertSecretProvider(manifest.secret_provider);
    return manifest;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof CanaryDeploymentManifestValidationError) throw error;
    throw new CanaryDeploymentManifestValidationError(message, [{
      field: "deployment_manifest",
      category: /secret|private|token/i.test(message) ? "SECRET_BOUNDARY" : /target|workflow|HEAD|commit|binding|identity|deployment/i.test(message) ? "PROVENANCE" : /validity|expired|current|window/i.test(message) ? "VALIDITY" : "CONTENT",
      reason: message,
      expected: "current Canary deployment manifest with complete deployment inputs",
      actual: "rejected",
      owner: "FUSOU repository or deployment operator",
    }]);
  }
}

export async function loadCanaryDeploymentManifest(manifestPath, options = {}) {
  const path = resolve(manifestPath);
  const raw = await readFile(path, "utf8");
  return assertCanaryDeploymentManifest(raw, { ...options, packageRoot: options.packageRoot ?? dirname(path) });
}

export function canaryDeploymentManifestVerificationReport({ status, manifest = null, diagnostics = [], preflightStatus = "NOT_RUN" } = {}) {
  const manifestValid = status === "VALID";
  const preflightPassed = preflightStatus === "PASS";
  return {
    manifest_state: status,
    manifest_id: manifest?.manifest_id ?? null,
    identity: manifest ? { manifest_id: manifest.manifest_id, target: manifest.target, workflow: manifest.workflow, deployment: manifest.deployment } : null,
    verification: {
      manifest: manifestValid ? "PASS" : "BLOCKED",
      preflight: preflightStatus,
      preconditions: manifestValid && preflightPassed ? "PASS" : "BLOCKED",
      deployment_eligible: manifestValid && preflightPassed,
    },
    diagnostics,
  };
}

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifestPath = process.env[CANARY_DEPLOYMENT_MANIFEST_INPUT]?.trim();
  if (!manifestPath) {
    console.error(`[tlsn-canary-deployment-manifest] ${CANARY_DEPLOYMENT_MANIFEST_INPUT} is required`);
    process.exitCode = 2;
  } else {
    loadCanaryDeploymentManifest(manifestPath, { currentHead: checkoutCommit(resolve(packageDirectory, "../..")), environment: process.env })
      .then((manifest) => console.log(JSON.stringify({ scope: CANARY_DEPLOYMENT_MANIFEST_SCOPE, status: "PASS", ...canaryDeploymentManifestVerificationReport({ status: "VALID", manifest }), network_access: "NOT_USED", deployment_executed: false }, null, 2)))
      .catch((error) => {
        console.error(JSON.stringify({ scope: CANARY_DEPLOYMENT_MANIFEST_SCOPE, status: "FAIL", ...canaryDeploymentManifestVerificationReport({ status: "INVALID", diagnostics: error.diagnostics }), network_access: "NOT_USED", deployment_executed: false }, null, 2));
        process.exitCode = 1;
      });
  }
}
