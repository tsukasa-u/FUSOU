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
import { CANARY_EXTERNAL_PACKAGE_MANIFEST_INPUT, loadCanaryExternalPackageManifest } from "./canary-external-package.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const CANARY_CONTROL_INPUTS = new Set(["TLSN_CANARY_READINESS_REPORT_PATH", CANARY_EXTERNAL_PACKAGE_MANIFEST_INPUT]);
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
  const invalidGroups = [];
  const groups = new Map();
  for (const entry of CANARY_EXTERNAL_INPUT_INTAKE) {
    if (!entry.required_group) continue;
    if (!groups.has(entry.required_group)) groups.set(entry.required_group, []);
    groups.get(entry.required_group).push(entry.name);
  }
  for (const [group, names] of groups) {
    const presentNames = names.filter((name) => present(environment, name));
    if (presentNames.length === 0) missing.push(`${group}:one-of:${names.join(",")}`);
    if (presentNames.length > 1) invalidGroups.push(`${group}:exactly-one:${names.join(",")}`);
  }
  return {
    missing: [...new Set(missing)].sort(),
    invalidGroups: invalidGroups.sort(),
  };
}

function ownershipSummary(environment, missing) {
  const missingNames = new Set(missing.filter((name) => !name.includes(":one-of:")));
  const missingGroups = new Set(
    missing
      .filter((name) => name.includes(":one-of:"))
      .map((name) => name.slice(0, name.indexOf(":one-of:"))),
  );
  const summary = {};
  for (const entry of CANARY_EXTERNAL_INPUT_INTAKE) {
    const bucket = summary[entry.ownership] ?? {
      input_count: 0,
      required_count: 0,
      required_group_count: 0,
      present_count: 0,
      absent_count: 0,
      invalid_count: 0,
      missing_required_count: 0,
      external_dependency_missing_count: 0,
      locally_generable_missing_count: 0,
      unmet_required_group_count: 0,
      unmet_external_required_group_count: 0,
      approval_required_count: 0,
      external_dependency_count: 0,
      locally_generable_count: 0,
      deployment_generable_count: 0,
    };
    bucket.input_count += 1;
    bucket.required_count += entry.required ? 1 : 0;
    bucket.required_group_count += entry.required_group ? 1 : 0;
    bucket.present_count += present(environment, entry.name) ? 1 : 0;
    bucket.absent_count += present(environment, entry.name) ? 0 : 1;
    bucket.invalid_count += validateInputFormat(environment, entry) ? 1 : 0;
    bucket.missing_required_count += missingNames.has(entry.name) ? 1 : 0;
    bucket.external_dependency_missing_count += missingNames.has(entry.name) && entry.external_dependency ? 1 : 0;
    bucket.locally_generable_missing_count += missingNames.has(entry.name) && entry.can_generate_locally ? 1 : 0;
    bucket.unmet_required_group_count += entry.required_group && missingGroups.has(entry.required_group) ? 1 : 0;
    bucket.unmet_external_required_group_count += entry.required_group
      && missingGroups.has(entry.required_group)
      && entry.external_dependency ? 1 : 0;
    bucket.approval_required_count += entry.approval_required ? 1 : 0;
    bucket.external_dependency_count += entry.external_dependency ? 1 : 0;
    bucket.locally_generable_count += entry.can_generate_locally ? 1 : 0;
    bucket.deployment_generable_count += entry.can_generate_during_deployment ? 1 : 0;
    summary[entry.ownership] = bucket;
  }
  return {
    contract_entry_count: CANARY_EXTERNAL_INPUT_INTAKE.length,
    missing_contract_entry_count: missing.length,
    unmet_required_group_count: missingGroups.size,
    unmet_external_required_group_count: [...missingGroups].filter((group) =>
      CANARY_EXTERNAL_INPUT_INTAKE.some((entry) => entry.required_group === group && entry.external_dependency)).length,
    external_dependency_missing_count: Object.values(summary)
      .reduce((count, value) => count + value.external_dependency_missing_count, 0),
    locally_generable_missing_count: Object.values(summary)
      .reduce((count, value) => count + value.locally_generable_missing_count, 0),
    by_ownership: summary,
  };
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
      ownership: entry.ownership,
      owner: entry.owner,
      generated_by: entry.generated_by,
      generation_stage: entry.generation_stage,
      can_generate_locally: entry.can_generate_locally,
      can_generate_during_deployment: entry.can_generate_during_deployment,
      external_dependency: entry.external_dependency,
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
  const { missing, invalidGroups } = missingRequired(environment);
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
  let externalPackage = { status: "ABSENT" };
  const externalPackagePath = value(environment, CANARY_EXTERNAL_PACKAGE_MANIFEST_INPUT);
  if (externalPackagePath) {
    try {
      await loadCanaryExternalPackageManifest(externalPackagePath, { environment, currentHead });
      externalPackage = { status: "VALID" };
    } catch (error) {
      externalPackage = {
        status: "INVALID",
        reason: error instanceof Error ? error.message : "external package validation failed",
      };
    }
  }
  const structuralFailures = [...formatFailures, ...unexpected, ...invalidGroups];
  if (externalPackage.status === "INVALID") structuralFailures.push(CANARY_EXTERNAL_PACKAGE_MANIFEST_INPUT);
  const validation = structuralFailures.length === 0 ? "PASS" : "FAIL";
  const readiness = missing.length === 0 && approvedContractStatus === "APPROVED" && externalPackage.status !== "INVALID"
    ? "REQUIRES_CANARY_READINESS_GATE"
    : "BLOCKED";
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
    external_package: externalPackage,
    missing_required_inputs: missing,
    invalid_required_groups: invalidGroups,
    ownership_summary: ownershipSummary(environment, missing),
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
