#!/usr/bin/env node

import { createHash, createPublicKey } from "node:crypto";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { checkoutCommit } from "./deployment-attestation.mjs";
import {
  CANARY_EXTERNAL_INPUT_INTAKE,
  CANARY_EXTERNAL_INPUT_INTAKE_EXPECTED_NAMES,
  assertCanaryExternalInputIntakeContract,
} from "./canary-external-input-intake.mjs";
import { assertCanaryApprovedInputContract } from "./canary-approved-input-contract.mjs";
import { canonicalJson } from "./production-trust-contract.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const CANARY_CONTROL_INPUTS = new Set(["TLSN_CANARY_READINESS_REPORT_PATH"]);
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PUBLIC_KEY_LENGTH = 59;

function present(environment, name) {
  return typeof environment[name] === "string" && environment[name].trim().length > 0;
}

function value(environment, name) {
  return present(environment, name) ? environment[name].trim() : undefined;
}

function sha256Base64Url(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

function canonicalBase64Url(raw) {
  if (!raw || !BASE64URL_PATTERN.test(raw) || raw.length % 4 === 1) return null;
  const bytes = Buffer.from(raw, "base64url");
  return bytes.length > 0 && bytes.toString("base64url") === raw ? bytes : null;
}

function validateInputFormat(environment, entry) {
  const raw = value(environment, entry.name);
  if (!raw) return null;
  if (/[\r\n]/.test(raw)) return "must not contain a newline";
  if (entry.name.endsWith("_SHA256") || entry.name === "TLSN_SECURITY_REGISTRY_SET_SHA256") {
    return HASH_PATTERN.test(raw) ? null : "must be a 43-character base64url SHA-256 digest";
  }
  if (entry.name.endsWith("_PUBLIC_KEY_SPKI")) {
    if (!BASE64URL_PATTERN.test(raw) || raw.length !== PUBLIC_KEY_LENGTH) return "must be a canonical Ed25519 SPKI public key";
    try {
      if (createPublicKey({ key: Buffer.from(raw, "base64url"), format: "der", type: "spki" }).asymmetricKeyType !== "ed25519") {
        return "must be an Ed25519 SPKI public key";
      }
    } catch {
      return "must be an Ed25519 SPKI public key";
    }
  }
  if (entry.name === "TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER") {
    return canonicalBase64Url(raw) ? null : "must be canonical base64url DER material";
  }
  if (entry.name.endsWith("_URL") || entry.name.endsWith("_ORIGIN")) {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) return "must be a clean HTTPS URL";
    } catch {
      return "must be a valid HTTPS URL";
    }
  }
  return null;
}

function unexpectedInputNames(environment) {
  const expected = new Set(CANARY_EXTERNAL_INPUT_INTAKE_EXPECTED_NAMES);
  return Object.keys(environment)
    .filter((name) => /^(?:TLSN_(?:CANARY|CANDIDATE|REMOTE|WORKFLOW)_|TLSN_(?:ENVIRONMENT|DEPLOYMENT_ROLE|GIT_COMMIT_SHA|REPOSITORY|BINDING_TTL_SECONDS|BENCHMARK_TIMINGS)$)/.test(name))
    .filter((name) => !expected.has(name) && !CANARY_CONTROL_INPUTS.has(name))
    .sort();
}

function missingRequired(environment) {
  const missing = CANARY_EXTERNAL_INPUT_INTAKE
    .filter((entry) => entry.required && !present(environment, entry.name))
    .map((entry) => entry.name);
  const groups = new Map();
  for (const entry of CANARY_EXTERNAL_INPUT_INTAKE) {
    if (!entry.required_group) continue;
    if (!groups.has(entry.required_group)) groups.set(entry.required_group, []);
    groups.get(entry.required_group).push(entry.name);
  }
  for (const [group, names] of groups) {
    if (!names.some((name) => present(environment, name))) missing.push(`${group}:one-of:${names.join(",")}`);
  }
  return [...new Set(missing)].sort();
}

async function artifactPathStatus(environment, name) {
  const path = value(environment, name);
  if (!path) return "ABSENT";
  try {
    await access(resolve(path));
    return "PRESENT";
  } catch {
    return "INVALID";
  }
}

function contractComparisonOptions(environment, currentHead) {
  const trustRoot = value(environment, "TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER");
  const notaryRegistry = value(environment, "TLSN_PRODUCTION_NOTARY_REGISTRY");
  let trustRootHash;
  let notaryRegistryHash;
  try {
    trustRootHash = trustRoot ? sha256Base64Url(canonicalBase64Url(trustRoot)) : undefined;
    notaryRegistryHash = notaryRegistry ? sha256Base64Url(Buffer.from(canonicalJson(JSON.parse(notaryRegistry)), "utf8")) : undefined;
  } catch {
    trustRootHash = undefined;
    notaryRegistryHash = undefined;
  }
  return {
    fixtureOnly: value(environment, "TLSN_CANARY_FIXTURE_ONLY") === "true",
    currentHead,
    expectedServerIdentity: value(environment, "TLSN_CANDIDATE_SERVER_IDENTITY"),
    expectedProfileSha256: value(environment, "TLSN_CANDIDATE_PROFILE_SHA256"),
    expectedSparseProfileSha256: value(environment, "TLSN_CANDIDATE_SPARSE_PROFILE_SHA256"),
    expectedSecurityRegistrySetSha256: value(environment, "TLSN_SECURITY_REGISTRY_SET_SHA256"),
    expectedTrustRootCertificateSha256: trustRootHash,
    expectedNotaryRegistrySha256: notaryRegistryHash,
    expectedNotaryKeyId: value(environment, "TLSN_CANDIDATE_NOTARY_KEY_ID"),
    expectedResultRegistryRootKeyId: value(environment, "TLSN_CANARY_RESULT_REGISTRY_ROOT_KEY_ID"),
    expectedVerifierKeyId: value(environment, "TLSN_CANDIDATE_VERIFIER_KEY_ID"),
    expectedVerifierPublicKeySpki: value(environment, "TLSN_CANARY_VERIFIER_PUBLIC_KEY_SPKI"),
    expectedDeploymentId: value(environment, "TLSN_CANARY_DEPLOYMENT_ID"),
    expectedVerifierDeploymentId: value(environment, "TLSN_CANARY_VERIFIER_DEPLOYMENT_ID"),
    expectedBindingAuthorityKeyId: value(environment, "TLSN_CANARY_BINDING_AUTHORITY_KEY_ID"),
    expectedBindingIdentity: value(environment, "TLSN_CANARY_BINDING_IDENTITY"),
    expectedBindingValue: value(environment, "TLSN_CANARY_BINDING_VALUE"),
    expectedWorkflow: {
      run_id: value(environment, "TLSN_WORKFLOW_RUN_ID"),
      attempt: value(environment, "TLSN_WORKFLOW_RUN_ATTEMPT"),
      repository: value(environment, "TLSN_REPOSITORY"),
      workflow_file_identity: value(environment, "TLSN_WORKFLOW_FILE_IDENTITY"),
    },
  };
}

export async function inspectCanaryExternalInput(environment = process.env) {
  assertCanaryExternalInputIntakeContract();
  const currentHead = checkoutCommit(packageDirectory);
  const entries = CANARY_EXTERNAL_INPUT_INTAKE.map((entry) => {
    const inputPresent = present(environment, entry.name);
    const formatError = validateInputFormat(environment, entry);
    return {
      name: entry.name,
      classification: entry.classification,
      required: entry.required,
      exposure: entry.exposure,
      phase: entry.phase,
      status: inputPresent ? (formatError ? "INVALID" : "PRESENT") : "ABSENT",
      approval_status: entry.approval_required ? (inputPresent ? "NOT_CHECKED" : "ABSENT") : "NOT_REQUIRED",
      validity_status: inputPresent ? "NOT_CHECKED" : "ABSENT",
      readiness_effect: entry.readiness_effect,
      reason: formatError ?? (inputPresent ? "presence and basic format accepted" : "required input is absent"),
    };
  });
  const missing = missingRequired(environment);
  const formatFailures = entries.filter((entry) => entry.status === "INVALID").map((entry) => entry.name);
  const unexpected = unexpectedInputNames(environment);
  let approvedContractStatus = "ABSENT";
  const contractRaw = value(environment, "TLSN_CANARY_APPROVED_INPUT_CONTRACT_JSON");
  if (contractRaw) {
    try {
      assertCanaryApprovedInputContract(contractRaw, contractComparisonOptions(environment, currentHead));
      approvedContractStatus = "APPROVED";
    } catch {
      approvedContractStatus = "INVALID";
    }
  }
  const artifactStatuses = {};
  for (const name of [
    "TLSN_REMOTE_EXPECTED_PROVENANCE_JSON",
    "TLSN_REMOTE_REPORT_PATH",
    "TLSN_REMOTE_VALIDATION_REPORT_PATH",
    "TLSN_PROVENANCE_REPORT_PATH",
    "TLSN_REMOTE_ATTESTATION_PATH",
    "TLSN_REMOTE_ATTESTATION_OUTPUT_PATH",
  ]) artifactStatuses[name] = await artifactPathStatus(environment, name);
  const structuralFailures = [...formatFailures, ...unexpected];
  const validation = structuralFailures.length === 0 ? "PASS" : "FAIL";
  const readiness = missing.length === 0 && approvedContractStatus === "APPROVED" ? "REQUIRES_CANARY_READINESS_GATE" : "BLOCKED";
  return {
    schema_version: 1,
    scope: "tlsn-canary-external-input-dry-run",
    validation,
    readiness,
    network_access: "NOT_USED",
    runtime_executed: false,
    deployment_executed: false,
    current_head: currentHead,
    approved_input_contract: { status: approvedContractStatus },
    missing_required_inputs: missing,
    unexpected_input_names: unexpected,
    artifact_paths: artifactStatuses,
    inputs: entries,
    next_command: "pnpm run test:canary-readiness",
  };
}

const requireComplete = process.argv.includes("--require-complete");
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  inspectCanaryExternalInput(process.env)
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (report.validation !== "PASS" || (requireComplete && (report.missing_required_inputs.length > 0 || report.approved_input_contract.status !== "APPROVED"))) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(`[tlsn-canary-input-dry-run] ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    });
}
