#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANARY_EXTERNAL_PACKAGE_ARTIFACTS,
  CANARY_EXTERNAL_PACKAGE_INPUTS,
} from "./canary-external-package.mjs";
import { CANARY_EXTERNAL_INPUT_INTAKE } from "./canary-external-input-intake.mjs";
import { canonicalJson } from "./production-trust-contract.mjs";
import { checkoutCommit } from "./deployment-attestation.mjs";
import { profilesForServerIdentity } from "./profile-canonical-contract.mjs";

export const CANARY_EXTERNAL_PACKAGE_CANDIDATE_SCHEMA_VERSION = 1;
export const CANARY_EXTERNAL_PACKAGE_CANDIDATE_SCOPE = "tlsn-canary-external-input-package-candidate";
export const CANARY_EXTERNAL_PACKAGE_CANDIDATE_ARTIFACT_SCOPE = "tlsn-canary-external-package-candidate-artifact";
export const CANDIDATE_STATES = Object.freeze([
  "CANDIDATE_VALID",
  "CANDIDATE_INCOMPLETE",
  "CANDIDATE_INVALID",
]);
const CANDIDATE_MANIFEST_KEYS = Object.freeze([
  "schema_version",
  "scope",
  "candidate_state",
  "package_schema_version",
  "package_scope",
  "repository",
  "target",
  "workflow",
  "validity",
  "authority",
  "inputs",
  "artifacts",
  "secret_provider",
  "missing_external_inputs",
  "invalid_external_inputs",
  "pending_external_approvals",
  "security",
  "boundary",
  "identity",
]);

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const repositoryDirectory = resolve(packageDirectory, "../..");
const PUBLIC_EXTERNAL_INPUTS = Object.freeze(CANARY_EXTERNAL_PACKAGE_INPUTS);
const PRIVATE_KEY_INPUTS = Object.freeze([
  "TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_FILE",
  "TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL",
]);
const SECRET_INPUTS = Object.freeze([
  "TLSN_REMOTE_ACCESS_TOKEN_A",
  ...PRIVATE_KEY_INPUTS,
  "TLSN_CANARY_TRIGGER_SECRET_KEY",
  "TLSN_CANARY_TRIGGER_CALLBACK_SECRET",
  "TLSN_CANARY_DIRECT_CALLBACK_SECRET",
  "TLSN_CANARY_RESULT_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_CANARY_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_CANARY_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
]);
const FIXTURE_SERVER_IDENTITY = "game.example.test";
const SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DNS_HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export class CanaryExternalPackageCandidateError extends Error {
  constructor(message, diagnostics = []) {
    super(message);
    this.name = "CanaryExternalPackageCandidateError";
    this.diagnostics = diagnostics;
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

function canonicalBytes(value) {
  return Buffer.from(canonicalJson(value), "utf8");
}

function value(environment, name) {
  const raw = environment[name];
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}

function inputBytes(name, raw) {
  if (name === "TLSN_CANARY_APPROVED_INPUT_CONTRACT_JSON" || name === "TLSN_PRODUCTION_NOTARY_REGISTRY") {
    return canonicalBytes(JSON.parse(raw));
  }
  if (name === "TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER") {
    if (!/^[A-Za-z0-9_-]+$/.test(raw) || raw.length % 4 === 1) throw new Error("trust root is not canonical base64url");
    const bytes = Buffer.from(raw, "base64url");
    if (bytes.length === 0 || bytes.toString("base64url") !== raw) throw new Error("trust root is not canonical base64url");
    return bytes;
  }
  return Buffer.from(raw, "utf8");
}

function publicInputRecords(environment) {
  return PUBLIC_EXTERNAL_INPUTS.map((name) => {
    if (SECRET_INPUTS.includes(name)) return { name, status: "PENDING_SECRET_PROVIDER", value_sha256: null };
    const raw = value(environment, name);
    if (!raw) return { name, status: "MISSING", value_sha256: null };
    try {
      return { name, status: "PRESENT", value_sha256: sha256(inputBytes(name, raw)) };
    } catch {
      return { name, status: "INVALID", value_sha256: null };
    }
  });
}

function safeIdentity(environment, name, pattern, label) {
  const raw = value(environment, name);
  if (!raw) return null;
  if (!pattern.test(raw)) throw new CanaryExternalPackageCandidateError(`${label} is invalid`, [{ field: name, category: "PROVENANCE" }]);
  return raw;
}

function rejectUnsafeIdentity(environment) {
  if (value(environment, "TLSN_CANARY_FIXTURE_ONLY") === "true") {
    throw new CanaryExternalPackageCandidateError("fixture-only mode cannot generate a production Canary candidate");
  }
  const serverIdentity = value(environment, "TLSN_CANDIDATE_SERVER_IDENTITY");
  if (serverIdentity === FIXTURE_SERVER_IDENTITY || /(?:test|synthetic|fixture|local|staging|historical|remote-test)/i.test(serverIdentity ?? "")) {
    throw new CanaryExternalPackageCandidateError("fixture, synthetic, or historical target identity cannot generate a production Canary candidate");
  }
  const bindingIdentity = value(environment, "TLSN_CANARY_BINDING_IDENTITY");
  if (/(?:replay|fixture|historical|synthetic)/i.test(bindingIdentity ?? "")) {
    throw new CanaryExternalPackageCandidateError("Replay, fixture, or historical binding identity cannot generate a production Canary candidate");
  }
  if (value(environment, "TLSN_ENVIRONMENT") && value(environment, "TLSN_ENVIRONMENT") !== "production") {
    throw new CanaryExternalPackageCandidateError("candidate environment must be production");
  }
  if (value(environment, "TLSN_DEPLOYMENT_ROLE") && value(environment, "TLSN_DEPLOYMENT_ROLE") !== "canary") {
    throw new CanaryExternalPackageCandidateError("candidate deployment role must be canary");
  }
  if (value(environment, "TLSN_WORKFLOW_FILE_IDENTITY") && value(environment, "TLSN_WORKFLOW_FILE_IDENTITY") !== "dotenvx+pnpm+wrangler") {
    throw new CanaryExternalPackageCandidateError("candidate workflow identity is invalid");
  }
}

function workflow(environment, currentHead) {
  const fields = {
    repository: value(environment, "TLSN_REPOSITORY"),
    run_id: value(environment, "TLSN_WORKFLOW_RUN_ID"),
    run_attempt: value(environment, "TLSN_WORKFLOW_RUN_ATTEMPT"),
    workflow_file_identity: value(environment, "TLSN_WORKFLOW_FILE_IDENTITY") ?? "dotenvx+pnpm+wrangler",
    commit_sha: value(environment, "TLSN_GIT_COMMIT_SHA") ?? currentHead,
  };
  if (fields.commit_sha !== currentHead) {
    throw new CanaryExternalPackageCandidateError("workflow commit does not match checked-out HEAD", [{ field: "TLSN_GIT_COMMIT_SHA", category: "PROVENANCE" }]);
  }
  return fields;
}

function requiredMissing(environment, records, workflowContext, target) {
  const missing = records.filter((entry) => entry.status !== "PRESENT").map((entry) => entry.name);
  for (const [field, name] of [
    [workflowContext.repository, "TLSN_REPOSITORY"],
    [workflowContext.run_id, "TLSN_WORKFLOW_RUN_ID"],
    [workflowContext.run_attempt, "TLSN_WORKFLOW_RUN_ATTEMPT"],
    [target.server_identity, "TLSN_CANDIDATE_SERVER_IDENTITY"],
    [target.binding_identity, "TLSN_CANARY_BINDING_IDENTITY"],
  ]) if (!field) missing.push(name);
  missing.push("TLSN_REMOTE_ACCESS_TOKEN_A_PROVIDER_REF");
  missing.push("REMOTE_DEVICE_PRIVATE_KEY_ONE_OF:exactly-one-provider-ref");
  return [...new Set(missing)];
}

function artifactOrigin(name, target) {
  if ((name === "complete-profile" || name === "sparse-profile") && target.server_identity) return "DERIVED";
  return "PENDING_EXTERNAL_APPROVAL";
}

function artifactMaterial(name, environment, target) {
  if (name === "complete-profile" || name === "sparse-profile") {
    if (!target.server_identity) return null;
    const profiles = profilesForServerIdentity(target.server_identity);
    const selected = name === "complete-profile" ? profiles.complete : profiles.sparse;
    return {
      profile: selected.profile,
      canonical_json_sha256: selected.sha256,
    };
  }
  if (name === "verifier-identity") {
    return {
      key_id: value(environment, "TLSN_CANDIDATE_VERIFIER_KEY_ID"),
      public_key_spki: value(environment, "TLSN_CANARY_VERIFIER_PUBLIC_KEY_SPKI"),
      deployment_id: value(environment, "TLSN_CANARY_VERIFIER_DEPLOYMENT_ID"),
    };
  }
  if (name === "binding-approval") {
    return { binding_identity: target.binding_identity };
  }
  if (name === "trust-root") {
    const raw = value(environment, "TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER");
    return raw ? { certificate_sha256: sha256(inputBytes("TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER", raw)) } : null;
  }
  if (name === "notary-registry") {
    const raw = value(environment, "TLSN_PRODUCTION_NOTARY_REGISTRY");
    if (!raw) return null;
    try {
      return { registry_sha256: sha256(inputBytes("TLSN_PRODUCTION_NOTARY_REGISTRY", raw)), key_id: value(environment, "TLSN_CANDIDATE_NOTARY_KEY_ID") };
    } catch {
      return null;
    }
  }
  if (name === "authentication-policy") {
    const names = PUBLIC_EXTERNAL_INPUTS.filter((inputName) => inputName.includes("AUTH") || inputName.includes("SUPABASE"));
    return { input_fingerprints: names.map((inputName) => ({ name: inputName, value_sha256: publicInputRecords(environment).find((entry) => entry.name === inputName)?.value_sha256 ?? null })) };
  }
  return null;
}

function candidateArtifact(name, environment, target, workflowContext, currentHead) {
  const origin = artifactOrigin(name, target);
  return {
    schema_version: 1,
    scope: CANARY_EXTERNAL_PACKAGE_CANDIDATE_ARTIFACT_SCOPE,
    artifact_name: name,
    candidate_state: origin === "DERIVED" ? "DERIVED" : "PENDING_EXTERNAL_APPROVAL",
    origin,
    required_external_approval: true,
    subject: {
      server_identity: target.server_identity,
      environment: target.environment,
      deployment_role: target.deployment_role,
      binding_identity: target.binding_identity,
      repository: workflowContext.repository,
      run_id: workflowContext.run_id,
      run_attempt: workflowContext.run_attempt,
      commit_sha: currentHead,
    },
    approval_requirements: origin === "DERIVED"
      ? ["external authority confirmation of target/profile identity", "authority-bound provenance"]
      : ["external authority supplied artifact", "authority-bound provenance", "current validity window"],
    material: artifactMaterial(name, environment, target),
  };
}

function candidateArtifactBytes(body) {
  return Buffer.from(`${canonicalJson(body)}\n`, "utf8");
}

function artifactFileName(name) {
  return `artifacts/${name}.json`;
}

function candidateIdentity(body) {
  const manifestBytes = canonicalBytes(body);
  return {
    candidate_id: sha256(manifestBytes),
    manifest_sha256: sha256(manifestBytes),
    artifacts: Object.fromEntries(body.artifacts.map((artifact) => [artifact.name, artifact.sha256])),
  };
}

function handoffMarkdown(manifest) {
  const artifactRows = manifest.artifacts.map((artifact) => `| ${artifact.name} | ${artifact.origin} | ${artifact.sha256} |`).join("\n");
  return [
    "# FUSOU TLSN Canary External Package Candidate",
    "",
    "THIS IS A CANDIDATE. EXTERNAL AUTHORITY APPROVAL IS STILL REQUIRED.",
    "",
    `- candidate_state: ${manifest.candidate_state}`,
    `- candidate_id: ${manifest.identity.candidate_id}`,
    `- manifest_sha256: ${manifest.identity.manifest_sha256}`,
    `- current_head: ${manifest.repository.current_head}`,
    `- target_environment: ${manifest.target.environment}`,
    `- deployment_role: ${manifest.target.deployment_role}`,
    `- workflow_identity: ${manifest.workflow.workflow_file_identity}`,
    `- binding_identity: ${manifest.target.binding_identity ?? "PENDING"}`,
    "",
    "## Artifact identity map",
    "",
    "| Artifact | Origin | Candidate artifact SHA-256 |",
    "| --- | --- | --- |",
    artifactRows,
    "",
    "## External approvals and unresolved inputs",
    "",
    ...manifest.pending_external_approvals.map((item) => `- ${item}`),
    "",
    "## Boundary",
    "",
    "Candidate generation is repository-controlled only. It is not an accepted External Package, not readiness, and not deployment authorization.",
    "",
    "Secret exposure: none. Secret values, private keys, callback secrets, and credentials are excluded.",
    "",
  ].join("\n");
}

function assertNoSecretValues(serialized, environment) {
  for (const name of SECRET_INPUTS) {
    const secret = value(environment, name);
    if (secret && serialized.includes(secret)) throw new CanaryExternalPackageCandidateError(`candidate output contains a value from ${name}`);
  }
  if (/(?:private_key_pkcs8|callback_secret|secret_value|access_token_value|private_key_value)/i.test(serialized)) {
    throw new CanaryExternalPackageCandidateError("candidate output contains a forbidden secret value field");
  }
}

export function candidateManifestIdentity(manifest) {
  if (!manifest || typeof manifest !== "object" || !manifest.identity) throw new Error("candidate manifest identity is missing");
  const body = { ...manifest };
  delete body.identity;
  return candidateIdentity(body);
}

export async function generateCanaryExternalPackageCandidate({
  environment = process.env,
  outputDirectory,
  currentHead = checkoutCommit(repositoryDirectory),
  overwrite = false,
} = {}) {
  if (!outputDirectory) throw new CanaryExternalPackageCandidateError("candidate output directory is required");
  rejectUnsafeIdentity(environment);
  const target = {
    server_identity: safeIdentity(environment, "TLSN_CANDIDATE_SERVER_IDENTITY", DNS_HOSTNAME_PATTERN, "candidate server identity"),
    environment: "production",
    deployment_role: "canary",
    binding_identity: value(environment, "TLSN_CANARY_BINDING_IDENTITY"),
  };
  const workflowContext = workflow(environment, currentHead);
  const records = publicInputRecords(environment);
  const invalidExternalInputs = records.filter((entry) => entry.status === "INVALID").map((entry) => entry.name);
  const missingExternalInputs = requiredMissing(environment, records, workflowContext, target);
  const pendingExternalApprovals = [
    "External authority target approval and authority-bound provenance",
    "External authority approval of trust, verifier, authentication, and binding artifacts",
    "External authority validity window and workflow approval reference",
    "Secret provider reference for TLSN_REMOTE_ACCESS_TOKEN_A",
    "Secret provider reference for exactly one remote private-key representation",
  ];
  const artifactBodies = CANARY_EXTERNAL_PACKAGE_ARTIFACTS.map((name) => candidateArtifact(name, environment, target, workflowContext, currentHead));
  const artifactFiles = artifactBodies.map((body) => ({
    name: body.artifact_name,
    path: artifactFileName(body.artifact_name),
    sha256: sha256(candidateArtifactBytes(body)),
    origin: body.origin,
    candidate_state: body.candidate_state,
    required_external_approval: body.required_external_approval,
  }));
  const candidateState = invalidExternalInputs.length > 0
    ? "CANDIDATE_INVALID"
    : missingExternalInputs.length > 0
      ? "CANDIDATE_INCOMPLETE"
      : "CANDIDATE_VALID";
  const body = {
    schema_version: CANARY_EXTERNAL_PACKAGE_CANDIDATE_SCHEMA_VERSION,
    scope: CANARY_EXTERNAL_PACKAGE_CANDIDATE_SCOPE,
    candidate_state: candidateState,
    package_schema_version: 2,
    package_scope: "tlsn-canary-external-input-package",
    repository: {
      current_head: currentHead,
      source: "checked-out FUSOU repository",
    },
    target,
    workflow: workflowContext,
    validity: {
      status: "PENDING_EXTERNAL_APPROVAL",
      issued_at: null,
      expires_at: null,
    },
    authority: {
      status: "PENDING_EXTERNAL_APPROVAL",
      type: "external-authority",
      reference: null,
      approval_artifact: "target-approval",
      approval_artifact_sha256: null,
    },
    inputs: records,
    artifacts: artifactFiles,
    secret_provider: {
      status: "PENDING_EXTERNAL_APPROVAL",
      access_token: { input_name: "TLSN_REMOTE_ACCESS_TOKEN_A", provider_ref: null },
      private_key: { selected_input_name: null, provider_ref: null, required: "exactly-one" },
    },
    missing_external_inputs: missingExternalInputs,
    invalid_external_inputs: invalidExternalInputs,
    pending_external_approvals: pendingExternalApprovals,
    security: {
      secret_exposure: "NONE",
      fixture_contamination: "NONE",
      historical_contamination: "NONE",
      replay_contamination: "NONE",
    },
    boundary: {
      candidate_is_accepted_package: false,
      candidate_is_readiness_pass: false,
      candidate_is_deployment_authorization: false,
      external_authority_approval: "NOT_PERFORMED",
    },
  };
  const manifest = { ...body, identity: candidateIdentity(body) };
  const serialized = JSON.stringify(manifest, null, 2) + "\n";
  assertNoSecretValues(serialized + artifactBodies.map((artifact) => JSON.stringify(artifact)).join(""), environment);
  const handoff = handoffMarkdown(manifest);
  const directory = resolve(outputDirectory);
  if (!overwrite) {
    try {
      await readFile(resolve(directory, "manifest.json"));
      throw new CanaryExternalPackageCandidateError("candidate output already exists; pass --overwrite explicitly");
    } catch (error) {
      if (error instanceof CanaryExternalPackageCandidateError) throw error;
      if (error?.code !== "ENOENT") throw error;
    }
  }
  if (overwrite) await rm(directory, { recursive: true, force: true });
  await mkdir(resolve(directory, "artifacts"), { recursive: true });
  await writeFile(resolve(directory, "manifest.json"), serialized, { mode: 0o644 });
  for (const artifact of artifactBodies) {
    await writeFile(resolve(directory, artifactFileName(artifact.artifact_name)), candidateArtifactBytes(artifact), { mode: 0o644 });
  }
  await writeFile(resolve(directory, "HANDOFF.md"), handoff, { mode: 0o644 });
  return manifest;
}

function assertCandidatePath(root, candidatePath) {
  if (isAbsolute(candidatePath) || candidatePath.includes("\\")) throw new Error("candidate artifact path must be relative POSIX path");
  const resolved = resolve(root, candidatePath);
  const relativePath = relative(resolve(root), resolved);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) throw new Error("candidate artifact path escapes output directory");
  return resolved;
}

function assertExactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CanaryExternalPackageCandidateError(`${label} must be an object`);
  const actual = Object.keys(value).sort().join("\0");
  const expected = [...keys].sort().join("\0");
  if (actual !== expected) throw new CanaryExternalPackageCandidateError(`${label} fields are invalid`);
}

function assertCandidateSubject(content, manifest, currentHead) {
  assertExactKeys(content.subject, [
    "server_identity",
    "environment",
    "deployment_role",
    "binding_identity",
    "repository",
    "run_id",
    "run_attempt",
    "commit_sha",
  ], `${content.artifact_name} candidate artifact subject`);
  for (const [field, expected] of Object.entries({
    server_identity: manifest.target.server_identity,
    environment: manifest.target.environment,
    deployment_role: manifest.target.deployment_role,
    binding_identity: manifest.target.binding_identity,
    repository: manifest.workflow.repository,
    run_id: manifest.workflow.run_id,
    run_attempt: manifest.workflow.run_attempt,
    commit_sha: currentHead,
  })) {
    if (content.subject[field] !== expected) throw new CanaryExternalPackageCandidateError(`${content.artifact_name} candidate artifact subject mismatch: ${field}`);
  }
}

export async function checkCanaryExternalPackageCandidate({
  outputDirectory,
  environment = process.env,
  currentHead = checkoutCommit(repositoryDirectory),
} = {}) {
  if (!outputDirectory) throw new CanaryExternalPackageCandidateError("candidate output directory is required");
  const root = resolve(outputDirectory);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
  } catch {
    throw new CanaryExternalPackageCandidateError("candidate manifest is missing or invalid JSON");
  }
  if (manifest.scope !== CANARY_EXTERNAL_PACKAGE_CANDIDATE_SCOPE || !CANDIDATE_STATES.includes(manifest.candidate_state)) {
    throw new CanaryExternalPackageCandidateError("candidate manifest scope or state is invalid");
  }
  assertExactKeys(manifest, CANDIDATE_MANIFEST_KEYS, "candidate manifest");
  if (manifest.schema_version !== CANARY_EXTERNAL_PACKAGE_CANDIDATE_SCHEMA_VERSION
    || manifest.package_schema_version !== 2
    || manifest.package_scope !== "tlsn-canary-external-input-package") {
    throw new CanaryExternalPackageCandidateError("candidate manifest schema is invalid");
  }
  assertExactKeys(manifest.repository, ["current_head", "source"], "candidate repository");
  assertExactKeys(manifest.workflow, ["repository", "run_id", "run_attempt", "workflow_file_identity", "commit_sha"], "candidate workflow");
  if (manifest.repository.current_head !== currentHead || manifest.workflow.commit_sha !== currentHead) {
    throw new CanaryExternalPackageCandidateError("candidate does not match checked-out HEAD");
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== CANARY_EXTERNAL_PACKAGE_ARTIFACTS.length) {
    throw new CanaryExternalPackageCandidateError("candidate artifacts are incomplete");
  }
  const expectedArtifacts = new Set(CANARY_EXTERNAL_PACKAGE_ARTIFACTS);
  const seenArtifacts = new Set();
  const expectedIdentity = candidateManifestIdentity(manifest);
  if (canonicalJson(expectedIdentity) !== canonicalJson(manifest.identity)) throw new CanaryExternalPackageCandidateError("candidate identity does not match canonical content");
  for (const artifact of manifest.artifacts) {
    if (!artifact || typeof artifact !== "object" || !expectedArtifacts.has(artifact.name) || seenArtifacts.has(artifact.name)) {
      throw new CanaryExternalPackageCandidateError("candidate artifact set is unexpected or duplicated");
    }
    seenArtifacts.add(artifact.name);
    if (artifact.path !== artifactFileName(artifact.name)) throw new CanaryExternalPackageCandidateError(`${artifact.name} candidate artifact path is invalid`);
    const path = assertCandidatePath(root, artifact.path);
    const bytes = await readFile(path);
    if (sha256(bytes) !== artifact.sha256) throw new CanaryExternalPackageCandidateError(`${artifact.name} candidate artifact hash does not match`);
    const content = JSON.parse(bytes.toString("utf8"));
    assertExactKeys(content, [
      "schema_version",
      "scope",
      "artifact_name",
      "candidate_state",
      "origin",
      "required_external_approval",
      "subject",
      "approval_requirements",
      "material",
    ], `${artifact.name} candidate artifact`);
    if (content.schema_version !== 1 || content.scope !== CANARY_EXTERNAL_PACKAGE_CANDIDATE_ARTIFACT_SCOPE || content.artifact_name !== artifact.name) throw new CanaryExternalPackageCandidateError(`${artifact.name} candidate artifact schema is invalid`);
    assertCandidateSubject(content, manifest, currentHead);
  }
  if (seenArtifacts.size !== expectedArtifacts.size) throw new CanaryExternalPackageCandidateError("candidate artifacts do not cover the required artifact set");
  const files = await Promise.all([
    readFile(resolve(root, "manifest.json"), "utf8"),
    readFile(resolve(root, "HANDOFF.md"), "utf8"),
    ...manifest.artifacts.map((artifact) => readFile(assertCandidatePath(root, artifact.path), "utf8")),
  ]);
  assertNoSecretValues(files.join("\n"), environment);
  return {
    candidate_state: manifest.candidate_state,
    candidate_id: manifest.identity.candidate_id,
    manifest_sha256: manifest.identity.manifest_sha256,
    artifact_identity_map: manifest.identity.artifacts,
    missing_external_inputs: manifest.missing_external_inputs,
    invalid_external_inputs: manifest.invalid_external_inputs,
    secret_exposure: manifest.security.secret_exposure,
    fixture_contamination: manifest.security.fixture_contamination,
    historical_contamination: manifest.security.historical_contamination,
    replay_contamination: manifest.security.replay_contamination,
    external_package_acceptance: "NOT_PERFORMED",
    readiness: "BLOCKED",
    deployment_executed: false,
    runtime_executed: false,
  };
}

function parseArguments(argumentsList) {
  const options = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--overwrite") {
      options.overwrite = true;
      continue;
    }
    if (argument === "--help") return { help: true };
    if (!argument.startsWith("--")) throw new Error(`unexpected argument: ${argument}`);
    const name = argument.slice(2);
    const next = argumentsList[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`missing value for --${name}`);
    options[name] = next;
    index += 1;
  }
  return options;
}

const usage = [
  "Usage:",
  "  pnpm run generate:canary-external-package-candidate -- --output DIR [--overwrite]",
  "  pnpm run check:canary-external-package-candidate -- --output DIR",
].join("\n");

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv.includes("--check") ? "check" : "generate";
  Promise.resolve().then(async () => {
    const options = parseArguments(process.argv.slice(2).filter((argument) => argument !== "--check" && argument !== "--"));
    if (options.help || !options.output) {
      console.log(usage);
      if (!options.help) process.exitCode = 2;
      return;
    }
    const outputDirectory = resolve(options.output);
    const result = command === "check"
      ? await checkCanaryExternalPackageCandidate({ outputDirectory })
      : await generateCanaryExternalPackageCandidate({ outputDirectory, overwrite: options.overwrite });
    console.log(JSON.stringify(result, null, 2));
  }).catch((error) => {
    console.error(`[tlsn-canary-external-package-candidate] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
