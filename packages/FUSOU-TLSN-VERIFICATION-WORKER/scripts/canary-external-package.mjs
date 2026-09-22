#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANARY_EXTERNAL_INPUT_INTAKE,
} from "./canary-external-input-intake.mjs";
import { canonicalJson } from "./production-trust-contract.mjs";
import { checkoutCommit } from "./deployment-attestation.mjs";

export const CANARY_EXTERNAL_PACKAGE_SCHEMA_VERSION = 1;
export const CANARY_EXTERNAL_PACKAGE_SCOPE = "tlsn-canary-external-input-package";
export const CANARY_EXTERNAL_PACKAGE_MANIFEST_INPUT = "TLSN_CANARY_EXTERNAL_PACKAGE_MANIFEST";

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

function assertCurrentTarget(target, workflow, { environment, currentHead }) {
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
  if (/(?:test|synthetic|fixture|local|staging|historical|remote-test)/i.test(target.server_identity)) throw new Error("external package target is fixture, synthetic, or historical");
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

function assertArtifactPath(path, label, packageRoot) {
  assertString(path, label);
  if (isAbsolute(path) || path.includes("\\")) throw new Error(`${label} must be a relative POSIX path`);
  const resolved = resolve(packageRoot, path);
  const relativePath = relative(resolve(packageRoot), resolved);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) throw new Error(`${label} escapes the package directory`);
  return resolved;
}

async function assertArtifacts(artifacts, packageRoot) {
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
    if (!artifact.current || artifact.fixture_only || artifact.historical) throw new Error(`${artifact.name} is not a current non-fixture artifact`);
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
  }
  if (seen.size !== expected.size) throw new Error("external package artifacts do not cover the required artifact set");
}

function assertSecretProvider(secretProvider, environment) {
  assertExactKeys(secretProvider, ["access_token", "private_key"], "external package secret_provider");
  assertObject(secretProvider.access_token, "external package secret_provider.access_token");
  assertExactKeys(secretProvider.access_token, ["input_name", "provider_ref", "issued_at", "expires_at"], "external package access token reference");
  if (secretProvider.access_token.input_name !== "TLSN_REMOTE_ACCESS_TOKEN_A") throw new Error("external package access token reference is invalid");
  assertReference(secretProvider.access_token.provider_ref, "external package access token provider_ref");
  const tokenExpires = assertTimestamp(secretProvider.access_token.expires_at, "external package access token expires_at");
  const tokenIssued = assertTimestamp(secretProvider.access_token.issued_at, "external package access token issued_at");
  if (tokenExpires <= tokenIssued) throw new Error("external package access token validity window is invalid");

  assertObject(secretProvider.private_key, "external package secret_provider.private_key");
  assertExactKeys(secretProvider.private_key, ["selected_input_name", "provider_ref", "issued_at", "expires_at"], "external package private key reference");
  if (!PRIVATE_KEY_INPUTS.includes(secretProvider.private_key.selected_input_name)) throw new Error("external package private key representation is invalid");
  assertReference(secretProvider.private_key.provider_ref, "external package private key provider_ref");
  const keyExpires = assertTimestamp(secretProvider.private_key.expires_at, "external package private key expires_at");
  const keyIssued = assertTimestamp(secretProvider.private_key.issued_at, "external package private key issued_at");
  if (keyExpires <= keyIssued) throw new Error("external package private key validity window is invalid");
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
} = {}) {
  const manifest = parseManifest(raw);
  assertNoSecretValues(manifest);
  assertExactKeys(manifest, ["schema_version", "scope", "package_id", "issued_at", "expires_at", "target", "workflow", "inputs", "artifacts", "secret_provider"], "external package manifest");
  if (manifest.schema_version !== CANARY_EXTERNAL_PACKAGE_SCHEMA_VERSION || manifest.scope !== CANARY_EXTERNAL_PACKAGE_SCOPE) throw new Error("external package manifest schema is invalid");
  assertReference(manifest.package_id, "external package package_id");
  const issuedAt = assertTimestamp(manifest.issued_at, "external package issued_at");
  const expiresAt = assertTimestamp(manifest.expires_at, "external package expires_at");
  if (expiresAt <= issuedAt || expiresAt <= now.getTime()) throw new Error("external package is expired or has an invalid validity window");
  assertCurrentTarget(manifest.target, manifest.workflow, { environment, currentHead });
  assertInputs(manifest.inputs, environment, requireEnvironment);
  await assertArtifacts(manifest.artifacts, packageRoot);
  assertSecretProvider(manifest.secret_provider, environment);
  return manifest;
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
      .then(() => console.log(JSON.stringify({
        schema_version: CANARY_EXTERNAL_PACKAGE_SCHEMA_VERSION,
        scope: CANARY_EXTERNAL_PACKAGE_SCOPE,
        status: "PASS",
        network_access: "NOT_USED",
        deployment_executed: false,
        runtime_executed: false,
      }, null, 2)))
      .catch((error) => {
        console.error(`[tlsn-canary-external-package] ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      });
  }
}