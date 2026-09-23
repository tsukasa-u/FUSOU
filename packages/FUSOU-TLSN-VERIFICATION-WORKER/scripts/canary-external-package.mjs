#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANARY_EXTERNAL_INPUT_INTAKE,
} from "./canary-external-input-intake.mjs";
import { assertCanaryApprovedInputContract } from "./canary-approved-input-contract.mjs";
import { canonicalJson } from "./production-trust-contract.mjs";
import { checkoutCommit } from "./deployment-attestation.mjs";

export const CANARY_EXTERNAL_PACKAGE_SCHEMA_VERSION = 2;
export const CANARY_EXTERNAL_PACKAGE_SCOPE = "tlsn-canary-external-input-package";
export const CANARY_EXTERNAL_PACKAGE_MANIFEST_INPUT = "TLSN_CANARY_EXTERNAL_PACKAGE_MANIFEST";
export const CANARY_EXTERNAL_PACKAGE_ARTIFACT_SCOPE = "tlsn-canary-external-package-artifact";

const HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const REFERENCE_PATTERN = /^[A-Za-z0-9._:/-]{1,512}$/;
const SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const DNS_HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const PRIVATE_KEY_INPUTS = [
  "TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_FILE",
  "TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL",
];
const SECRET_INPUTS = new Set([
  "TLSN_REMOTE_ACCESS_TOKEN_A",
  ...PRIVATE_KEY_INPUTS,
]);
const EXTERNAL_PACKAGE_INPUTS = Object.freeze(CANARY_EXTERNAL_INPUT_INTAKE
  .filter((entry) => entry.external_dependency && entry.required && !SECRET_INPUTS.has(entry.name))
  .map((entry) => entry.name));
const REQUIRED_ARTIFACTS = Object.freeze([
  "target-approval",
  "complete-profile",
  "sparse-profile",
  "notary-registry",
  "trust-root",
  "verifier-identity",
  "authentication-policy",
  "binding-approval",
]);
const EVIDENCE_LEVELS = new Set([
  "AUTHORITY_SIGNED",
  "AUTHORITY_ATTESTED",
  "OPERATOR_APPROVED",
]);
const AUTHORITY_EVIDENCE_LEVELS = new Set(["AUTHORITY_SIGNED", "AUTHORITY_ATTESTED"]);

export class CanaryExternalPackageValidationError extends Error {
  constructor(message, diagnostics = []) {
    super(message);
    this.name = "CanaryExternalPackageValidationError";
    this.diagnostics = diagnostics;
  }
}

export const CANARY_EXTERNAL_PACKAGE_INPUTS = EXTERNAL_PACKAGE_INPUTS;
export const CANARY_EXTERNAL_PACKAGE_ARTIFACTS = REQUIRED_ARTIFACTS;

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function assertExactKeys(value, keys, label) {
  const actual = Object.keys(value).sort().join("\0");
  const expected = [...keys].sort().join("\0");
  if (actual !== expected) throw new Error(`${label} fields are invalid`);
}

function assertString(value, label, pattern = null) {
  if (typeof value !== "string" || value.length === 0 || (pattern && !pattern.test(value))) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function assertBoolean(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean`);
}

function assertTimestamp(value, label, now) {
  assertString(value, label, ISO_TIMESTAMP_PATTERN);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} is invalid`);
  return timestamp;
}

function assertValidityWindow(issuedAt, expiresAt, label, now, { within } = {}) {
  const issued = assertTimestamp(issuedAt, `${label}.issued_at`, now);
  const expires = assertTimestamp(expiresAt, `${label}.expires_at`, now);
  if (expires <= issued || issued > now.getTime() || expires <= now.getTime()) {
    throw new Error(`${label} validity window is not current`);
  }
  if (within && (issued < within.issuedAt || expires > within.expiresAt)) {
    throw new Error(`${label} validity window is outside the external package window`);
  }
  return { issued, expires };
}

function assertHash(value, label) {
  return assertString(value, label, HASH_PATTERN);
}

function assertReference(value, label) {
  return assertString(value, label, REFERENCE_PATTERN);
}

function assertNoSecretValues(value, label = "external package") {
  if (!value || typeof value !== "object") return;
  const structuralSecretKeys = new Set(["secret_provider", "access_token", "private_key"]);
  for (const [key, child] of Object.entries(value)) {
    if (/(?:private|secret|password|bearer|access[_-]?token|credential[_-]?value|token[_-]?value)/i.test(key)
      && !structuralSecretKeys.has(key)
      && !/(?:provider_ref|input_name|selected_input_name|representation)/i.test(key)) {
      throw new Error(`${label} contains a secret value field`);
    }
    assertNoSecretValues(child, `${label}.${key}`);
  }
}

function parseManifest(raw) {
  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw new Error("Canary external package manifest must be valid JSON");
  }
  assertObject(parsed, "Canary external package manifest");
  return parsed;
}

function inputBytes(environment, name) {
  const raw = environment[name];
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  const value = raw.trim();
  if (name === "TLSN_CANARY_APPROVED_INPUT_CONTRACT_JSON" || name === "TLSN_PRODUCTION_NOTARY_REGISTRY") {
    return Buffer.from(canonicalJson(JSON.parse(value)), "utf8");
  }
  if (name === "TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER") {
    if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new Error(`${name} is not canonical base64url`);
    const decoded = Buffer.from(value, "base64url");
    if (decoded.length === 0 || decoded.toString("base64url") !== value) throw new Error(`${name} is not canonical base64url`);
    return decoded;
  }
  return Buffer.from(value, "utf8");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

function inputFingerprint(environment, name) {
  const bytes = inputBytes(environment, name);
  return bytes ? sha256(bytes) : undefined;
}

export function canaryExternalPackageIdentity(manifest) {
  return {
    package_id: manifest.package_id,
    manifest_sha256: sha256(Buffer.from(canonicalJson(manifest), "utf8")),
    authority: {
      reference: manifest.authority.reference,
      approval_artifact: manifest.authority.approval_artifact,
      approval_artifact_sha256: manifest.authority.approval_artifact_sha256,
    },
    artifacts: Object.fromEntries(manifest.artifacts.map((artifact) => [artifact.name, artifact.sha256])),
  };
}

export function canaryExternalPackageVerificationReport({
  status,
  manifest = null,
  diagnostics = [],
} = {}) {
  const identity = manifest ? canaryExternalPackageIdentity(manifest) : null;
  return {
    package_state: status,
    package_id: identity?.package_id ?? null,
    identity,
    target: manifest?.target ?? null,
    workflow: manifest?.workflow ?? null,
    validity: manifest
      ? { issued_at: manifest.issued_at, expires_at: manifest.expires_at }
      : null,
    verification: {
      acceptance: status === "VALID" ? "PASS" : "BLOCKED",
      readiness_eligible: status === "VALID",
    },
    diagnostics,
  };
}

function assertCurrentTarget(target, workflow, { environment, currentHead, fixtureOnly }) {
  assertExactKeys(target, ["server_identity", "environment", "deployment_role", "binding_identity"], "external package target");
  assertExactKeys(workflow, ["repository", "run_id", "run_attempt", "workflow_file_identity", "commit_sha"], "external package workflow");
  assertString(target.server_identity, "external package target.server_identity", DNS_HOSTNAME_PATTERN);
  assertString(target.environment, "external package target.environment");
  assertString(target.deployment_role, "external package target.deployment_role");
  assertReference(target.binding_identity, "external package target.binding_identity");
  assertReference(workflow.repository, "external package workflow.repository");
  assertString(workflow.run_id, "external package workflow.run_id", /^[1-9][0-9]*$/);
  assertString(workflow.run_attempt, "external package workflow.run_attempt", /^[1-9][0-9]*$/);
  assertString(workflow.workflow_file_identity, "external package workflow.workflow_file_identity");
  assertString(workflow.commit_sha, "external package workflow.commit_sha", /^[0-9a-f]{40}$/);
  if (target.environment !== "production" || target.deployment_role !== "canary") throw new Error("external package target environment or deployment role is invalid");
  if (!fixtureOnly && /(?:test|synthetic|fixture|local|staging|historical|remote-test)/i.test(target.server_identity)) throw new Error("external package target is fixture, synthetic, or historical");
  if (fixtureOnly && target.server_identity !== "game.example.test") throw new Error("fixture external package target identity is invalid");
  if (workflow.workflow_file_identity !== "dotenvx+pnpm+wrangler") throw new Error("external package workflow identity is invalid");
  if (environment.TLSN_CANDIDATE_SERVER_IDENTITY?.trim() !== target.server_identity) throw new Error("external package target identity does not match deployment input");
  if (environment.TLSN_ENVIRONMENT?.trim() !== target.environment) throw new Error("external package environment does not match deployment input");
  if (environment.TLSN_DEPLOYMENT_ROLE?.trim() !== target.deployment_role) throw new Error("external package deployment role does not match deployment input");
  if (environment.TLSN_CANARY_BINDING_IDENTITY?.trim() !== target.binding_identity) throw new Error("external package binding identity does not match deployment input");
  if (environment.TLSN_REPOSITORY?.trim() !== workflow.repository) throw new Error("external package repository does not match workflow input");
  if (environment.TLSN_WORKFLOW_RUN_ID?.trim() !== workflow.run_id) throw new Error("external package workflow run does not match workflow input");
  if (environment.TLSN_WORKFLOW_RUN_ATTEMPT?.trim() !== workflow.run_attempt) throw new Error("external package workflow attempt does not match workflow input");
  if (environment.TLSN_WORKFLOW_FILE_IDENTITY?.trim() !== workflow.workflow_file_identity) throw new Error("external package workflow identity does not match workflow input");
  if (environment.TLSN_GIT_COMMIT_SHA?.trim().toLowerCase() !== workflow.commit_sha) throw new Error("external package commit does not match workflow input");
  if (currentHead !== undefined && workflow.commit_sha !== currentHead) throw new Error("external package commit does not match checked-out HEAD");
}

function assertInputs(inputs, environment, requireEnvironment) {
  if (!Array.isArray(inputs) || inputs.length !== EXTERNAL_PACKAGE_INPUTS.length) throw new Error("external package inputs are incomplete");
  const expected = new Set(EXTERNAL_PACKAGE_INPUTS);
  const seen = new Set();
  for (const [index, input] of inputs.entries()) {
    assertObject(input, `external package inputs[${index}]`);
    assertExactKeys(input, ["name", "value_sha256", "approval_reference", "provenance_reference", "evidence_level"], `external package inputs[${index}]`);
    assertString(input.name, `external package inputs[${index}].name`);
    if (!expected.has(input.name) || seen.has(input.name)) throw new Error(`external package input name is unexpected or duplicated: ${input.name}`);
    seen.add(input.name);
    assertString(input.value_sha256, `${input.name}.value_sha256`, SHA256_PATTERN);
    assertReference(input.approval_reference, `${input.name}.approval_reference`);
    assertReference(input.provenance_reference, `${input.name}.provenance_reference`);
    if (!EVIDENCE_LEVELS.has(input.evidence_level)) throw new Error(`${input.name}.evidence_level is invalid`);
    const bytes = inputBytes(environment, input.name);
    if (!bytes && requireEnvironment) throw new Error(`${input.name} is missing from the deployment input`);
    if (bytes && sha256(bytes) !== input.value_sha256) throw new Error(`${input.name} fingerprint does not match deployment input`);
  }
  if (seen.size !== expected.size) throw new Error("external package inputs do not cover the required public input set");
}

function assertExternalAuthority(authority, artifacts, environment, fixtureOnly) {
  assertExactKeys(authority, ["type", "reference", "approval_artifact", "approval_artifact_sha256"], "external package authority");
  if (authority.type !== "external-authority") throw new Error("external package authority type is invalid");
  assertReference(authority.reference, "external package authority reference");
  if (/(?:^|[/:])(?:self|manifest|worker|fixture|synthetic|historical)(?:$|[/:])/i.test(authority.reference)) {
    throw new Error("external package authority reference is self-asserted or non-current");
  }
  if (authority.approval_artifact !== "target-approval") throw new Error("external package authority approval artifact is invalid");
  const targetApproval = artifacts.find((artifact) => artifact.name === "target-approval");
  if (!targetApproval || authority.approval_artifact_sha256 !== targetApproval.sha256) {
    throw new Error("external package authority approval artifact hash does not match");
  }
  if (fixtureOnly && environment.TLSN_CANARY_FIXTURE_ONLY?.trim() !== "true") {
    throw new Error("fixture external package requires explicit fixture-only mode");
  }
}

function assertArtifactPath(path, label, packageRoot) {
  assertString(path, label);
  if (isAbsolute(path) || path.includes("\\")) throw new Error(`${label} must be a relative POSIX path`);
  const resolved = resolve(packageRoot, path);
  const relativePath = relative(resolve(packageRoot), resolved);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) throw new Error(`${label} escapes the package directory`);
  return resolved;
}

async function assertArtifacts(artifacts, packageRoot, {
  target,
  workflow,
  fixtureOnly,
  packageWindow,
  environment,
  currentHead,
  now,
} = {}) {
  if (!Array.isArray(artifacts) || artifacts.length !== REQUIRED_ARTIFACTS.length) throw new Error("external package artifacts are incomplete");
  const expected = new Set(REQUIRED_ARTIFACTS);
  const seen = new Set();
  const packageRootRealPath = await realpath(packageRoot);
  for (const [index, artifact] of artifacts.entries()) {
    assertObject(artifact, `external package artifacts[${index}]`);
    assertExactKeys(artifact, ["name", "path", "sha256", "current", "fixture_only", "historical"], `external package artifacts[${index}]`);
    assertString(artifact.name, `external package artifacts[${index}].name`);
    if (!expected.has(artifact.name) || seen.has(artifact.name)) throw new Error(`external package artifact name is unexpected or duplicated: ${artifact.name}`);
    seen.add(artifact.name);
    const artifactPath = assertArtifactPath(artifact.path, `${artifact.name}.path`, packageRoot);
    assertString(artifact.sha256, `${artifact.name}.sha256`, SHA256_PATTERN);
    assertBoolean(artifact.current, `${artifact.name}.current`);
    assertBoolean(artifact.fixture_only, `${artifact.name}.fixture_only`);
    assertBoolean(artifact.historical, `${artifact.name}.historical`);
    if (!artifact.current || artifact.fixture_only !== fixtureOnly || artifact.historical) throw new Error(`${artifact.name} current/fixture status is invalid`);
    let artifactRealPath;
    try {
      artifactRealPath = await realpath(artifactPath);
    } catch {
      throw new Error(`${artifact.name} artifact is missing or unreadable`);
    }
    const artifactRelativePath = relative(packageRootRealPath, artifactRealPath);
    if (artifactRelativePath.startsWith("..") || isAbsolute(artifactRelativePath)) throw new Error(`${artifact.name} artifact escapes the package directory`);
    let bytes;
    try {
      bytes = await readFile(artifactRealPath);
    } catch {
      throw new Error(`${artifact.name} artifact is missing or unreadable`);
    }
    if (sha256(bytes) !== artifact.sha256) throw new Error(`${artifact.name} artifact hash does not match manifest`);
    let content;
    try {
      content = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new Error(`${artifact.name} artifact content must be valid JSON`);
    }
    assertNoSecretValues(content, `${artifact.name} artifact`);
    if (artifact.name === "target-approval") {
      assertCanaryApprovedInputContract(content, {
        fixtureOnly,
        now,
        currentHead,
        expectedServerIdentity: target.server_identity,
        expectedProfileSha256: environment.TLSN_CANDIDATE_PROFILE_SHA256?.trim(),
        expectedSparseProfileSha256: environment.TLSN_CANDIDATE_SPARSE_PROFILE_SHA256?.trim(),
        expectedSecurityRegistrySetSha256: environment.TLSN_SECURITY_REGISTRY_SET_SHA256?.trim(),
        expectedTrustRootCertificateSha256: inputFingerprint(environment, "TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER"),
        expectedNotaryRegistrySha256: inputFingerprint(environment, "TLSN_PRODUCTION_NOTARY_REGISTRY"),
        expectedNotaryKeyId: environment.TLSN_CANDIDATE_NOTARY_KEY_ID?.trim(),
        expectedResultRegistryRootKeyId: environment.TLSN_CANARY_RESULT_REGISTRY_ROOT_KEY_ID?.trim(),
        expectedVerifierKeyId: environment.TLSN_CANDIDATE_VERIFIER_KEY_ID?.trim(),
        expectedVerifierPublicKeySpki: environment.TLSN_CANARY_VERIFIER_PUBLIC_KEY_SPKI?.trim(),
        expectedDeploymentId: environment.TLSN_CANARY_DEPLOYMENT_ID?.trim(),
        expectedVerifierDeploymentId: environment.TLSN_CANARY_VERIFIER_DEPLOYMENT_ID?.trim(),
        expectedWorkflow: {
          run_id: workflow.run_id,
          attempt: workflow.run_attempt,
          repository: workflow.repository,
          workflow_file_identity: workflow.workflow_file_identity,
        },
        expectedBindingIdentity: target.binding_identity,
        expectedBindingAuthorityKeyId: environment.TLSN_CANARY_BINDING_AUTHORITY_KEY_ID?.trim(),
        expectedBindingValue: environment.TLSN_CANARY_BINDING_VALUE?.trim(),
      });
      const environmentContract = environment.TLSN_CANARY_APPROVED_INPUT_CONTRACT_JSON?.trim();
      if (!environmentContract || canonicalJson(JSON.parse(environmentContract)) !== canonicalJson(content)) {
        throw new Error("target approval artifact does not match the approved input contract");
      }
      if (content.target_approval.approver === workflow.repository || /(?:^|[/:])(?:self|workflow|worker|deployment)(?:$|[/:])/i.test(content.target_approval.approver)) {
        throw new Error("target approval is self-approved by the deployment path");
      }
      assertValidityWindow(content.target_approval.approved_at, content.target_approval.expires_at, "target approval", now, { within: packageWindow });
      continue;
    }
    assertExactKeys(content, ["schema_version", "scope", "artifact_name", "status", "fixture_only", "historical", "subject", "provenance", "validity", "content"], `${artifact.name} artifact content`);
    if (content.schema_version !== 1 || content.scope !== CANARY_EXTERNAL_PACKAGE_ARTIFACT_SCOPE || content.artifact_name !== artifact.name || content.status !== "CURRENT" || content.fixture_only !== fixtureOnly || content.historical) {
      throw new Error(`${artifact.name} artifact content schema or status is invalid`);
    }
    assertExactKeys(content.subject, ["server_identity", "environment", "deployment_role", "binding_identity", "repository", "run_id", "run_attempt", "commit_sha"], `${artifact.name} artifact subject`);
    for (const [field, expected] of Object.entries({
      server_identity: target.server_identity,
      environment: target.environment,
      deployment_role: target.deployment_role,
      binding_identity: target.binding_identity,
      repository: workflow.repository,
      run_id: workflow.run_id,
      run_attempt: workflow.run_attempt,
      commit_sha: workflow.commit_sha,
    })) if (content.subject[field] !== expected) throw new Error(`${artifact.name} artifact subject mismatch: ${field}`);
    assertExactKeys(content.provenance, ["authority_artifact_sha256", "approval_reference", "provenance_reference", "evidence_level"], `${artifact.name} artifact provenance`);
    if (content.provenance.authority_artifact_sha256 !== artifacts.find((entry) => entry.name === "target-approval")?.sha256) throw new Error(`${artifact.name} artifact authority provenance does not bind target approval`);
    assertReference(content.provenance.approval_reference, `${artifact.name} artifact approval_reference`);
    assertReference(content.provenance.provenance_reference, `${artifact.name} artifact provenance_reference`);
    if (!AUTHORITY_EVIDENCE_LEVELS.has(content.provenance.evidence_level)) throw new Error(`${artifact.name} artifact evidence level is not authority-backed`);
    assertObject(content.content, `${artifact.name} artifact content payload`);
    assertExactKeys(content.validity, ["issued_at", "expires_at"], `${artifact.name} artifact validity`);
    assertValidityWindow(content.validity.issued_at, content.validity.expires_at, `${artifact.name} artifact`, now, { within: packageWindow });
  }
  if (seen.size !== expected.size) throw new Error("external package artifacts do not cover the required artifact set");
}

function assertSecretProvider(secretProvider, environment, now, packageWindow) {
  assertExactKeys(secretProvider, ["access_token", "private_key"], "external package secret_provider");
  assertObject(secretProvider.access_token, "external package secret_provider.access_token");
  assertExactKeys(secretProvider.access_token, ["input_name", "provider_ref", "issued_at", "expires_at"], "external package access token reference");
  if (secretProvider.access_token.input_name !== "TLSN_REMOTE_ACCESS_TOKEN_A") throw new Error("external package access token reference is invalid");
  assertReference(secretProvider.access_token.provider_ref, "external package access token provider_ref");
  assertValidityWindow(secretProvider.access_token.issued_at, secretProvider.access_token.expires_at, "external package access token", now, { within: packageWindow });

  assertObject(secretProvider.private_key, "external package secret_provider.private_key");
  assertExactKeys(secretProvider.private_key, ["selected_input_name", "provider_ref", "issued_at", "expires_at"], "external package private key reference");
  if (!PRIVATE_KEY_INPUTS.includes(secretProvider.private_key.selected_input_name)) throw new Error("external package private key representation is invalid");
  assertReference(secretProvider.private_key.provider_ref, "external package private key provider_ref");
  assertValidityWindow(secretProvider.private_key.issued_at, secretProvider.private_key.expires_at, "external package private key", now, { within: packageWindow });
  if (environment.TLSN_REMOTE_ACCESS_TOKEN_A !== undefined && !environment.TLSN_REMOTE_ACCESS_TOKEN_A.trim()) throw new Error("remote access token is empty");
  const selected = secretProvider.private_key.selected_input_name;
  const other = PRIVATE_KEY_INPUTS.find((name) => name !== selected);
  if (environment[selected] !== undefined && !environment[selected].trim()) throw new Error("selected remote private key representation is empty");
  if (environment[other] !== undefined && environment[other].trim()) throw new Error("both remote private key representations are present");
}

export async function assertCanaryExternalPackage(raw, {
  packageRoot = process.cwd(),
  environment = process.env,
  currentHead,
  now = new Date(),
  requireEnvironment = true,
  allowSyntheticFixture = false,
} = {}) {
  try {
    const manifest = parseManifest(raw);
    assertNoSecretValues(manifest);
    assertExactKeys(manifest, ["schema_version", "scope", "package_id", "issued_at", "expires_at", "fixture_only", "authority", "target", "workflow", "inputs", "artifacts", "secret_provider"], "external package manifest");
    if (manifest.schema_version !== CANARY_EXTERNAL_PACKAGE_SCHEMA_VERSION || manifest.scope !== CANARY_EXTERNAL_PACKAGE_SCOPE) throw new Error("external package manifest schema is invalid");
    assertBoolean(manifest.fixture_only, "external package fixture_only");
    if (manifest.fixture_only && !allowSyntheticFixture) throw new Error("fixture-only external package is not accepted by the production gate");
    assertReference(manifest.package_id, "external package package_id");
    const validationNow = now instanceof Date ? now : new Date(now);
    if (!Number.isFinite(validationNow.getTime())) throw new Error("external package validation time is invalid");
    const packageWindow = assertValidityWindow(manifest.issued_at, manifest.expires_at, "external package", validationNow);
    assertCurrentTarget(manifest.target, manifest.workflow, { environment, currentHead, fixtureOnly: manifest.fixture_only });
    assertInputs(manifest.inputs, environment, requireEnvironment);
    assertExternalAuthority(manifest.authority, manifest.artifacts, environment, manifest.fixture_only);
    await assertArtifacts(manifest.artifacts, packageRoot, {
      target: manifest.target,
      workflow: manifest.workflow,
      fixtureOnly: manifest.fixture_only,
      packageWindow,
      environment,
      currentHead,
      now: validationNow,
    });
    assertSecretProvider(manifest.secret_provider, environment, validationNow, packageWindow);
    return manifest;
  } catch (error) {
    if (error instanceof CanaryExternalPackageValidationError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const diagnostic = {
      field: "external_package",
      category: /schema|fields|JSON|type|incomplete|unexpected|duplicated/i.test(message) ? "SCHEMA" : /secret|private key|token/i.test(message) ? "SECRET_PROVIDER_REFERENCE" : /authority|approval|provenance|self-approved|evidence/i.test(message) ? "AUTHORITY" : /subject|target|workflow|HEAD|commit|binding|identity/i.test(message) ? "PROVENANCE" : /validity|expired|future|current|window/i.test(message) ? "VALIDITY" : "CONTENT",
      reason: message,
      expected: "current, authority-backed, canonical external package",
      actual: "rejected",
      owner: "external operator or authority",
    };
    throw new CanaryExternalPackageValidationError(message, [diagnostic]);
  }
}

export async function loadCanaryExternalPackageManifest(manifestPath, options = {}) {
  const path = resolve(manifestPath);
  const raw = await readFile(path, "utf8");
  return assertCanaryExternalPackage(raw, { ...options, packageRoot: options.packageRoot ?? dirname(path) });
}

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifestPath = process.env[CANARY_EXTERNAL_PACKAGE_MANIFEST]?.trim();
  if (!manifestPath) {
    console.error(`[tlsn-canary-external-package] ${CANARY_EXTERNAL_PACKAGE_MANIFEST} is required`);
    process.exitCode = 2;
  } else {
    loadCanaryExternalPackageManifest(manifestPath, {
      currentHead: checkoutCommit(packageDirectory),
      environment: process.env,
    })
      .then((manifest) => console.log(JSON.stringify({
        schema_version: CANARY_EXTERNAL_PACKAGE_SCHEMA_VERSION,
        scope: CANARY_EXTERNAL_PACKAGE_SCOPE,
        status: "PASS",
        ...canaryExternalPackageVerificationReport({ status: "VALID", manifest }),
        network_access: "NOT_USED",
        deployment_executed: false,
        runtime_executed: false,
      }, null, 2)))
      .catch((error) => {
        const diagnostics = Array.isArray(error?.diagnostics) ? error.diagnostics : [{
          field: "external_package",
          category: "CONTENT",
          reason: "external package validation failed",
          expected: "current, authority-backed, canonical external package",
          actual: "rejected",
          owner: "external operator or authority",
        }];
        console.error(JSON.stringify({
          scope: CANARY_EXTERNAL_PACKAGE_SCOPE,
          status: "FAIL",
          ...canaryExternalPackageVerificationReport({ status: "INVALID", diagnostics }),
          network_access: "NOT_USED",
          deployment_executed: false,
          runtime_executed: false,
        }, null, 2));
        process.exitCode = 1;
      });
  }
}