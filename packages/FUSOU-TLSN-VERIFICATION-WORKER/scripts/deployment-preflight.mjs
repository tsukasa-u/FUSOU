#!/usr/bin/env node

import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  CANARY_INPUTS,
  COMMON_INPUTS,
  PRODUCTION_INPUTS,
  WORKFLOW_EVIDENCE_INPUTS,
  SECURITY_IDENTITY_FIELDS,
  secretInputsForRole,
  inputsForRole,
} from "./deployment-contract.mjs";
import { checkoutCommit, workflowContextFromEnvironment } from "./deployment-attestation.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const DEFAULT_REPORT_PATH = resolve(packageDirectory, "artifacts/tlsn-deployment-preflight.json");
const DEFAULT_PROVENANCE_PATH = resolve(packageDirectory, "artifacts/tlsn-production-provenance.json");
const INPUT_MANIFEST_PATH = resolve(packageDirectory, "scripts/production-inputs.json");
const DNS_HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const TEST_MARKER_PATTERN = /(?:^|[._-])(test|synthetic|fixture|local|staging)(?:$|[._-])/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const GIT_COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
const ROLE_PATTERN = /^(canary|production)$/;

function value(name) {
  return process.env[name]?.trim() || undefined;
}

function sha256Base64Url(valueToHash) {
  return createHash("sha256").update(valueToHash).digest("base64url");
}

function decodeBase64Url(raw) {
  if (!raw || !BASE64URL_PATTERN.test(raw) || raw.length % 4 === 1) return null;
  const bytes = Buffer.from(raw, "base64url");
  return bytes.length > 0 && bytes.toString("base64url") === raw ? bytes : null;
}

function secretHash(raw) {
  const bytes = decodeBase64Url(raw);
  return bytes ? createHash("sha256").update(bytes).digest("base64url") : null;
}

function addFailure(failures, check, reason) {
  failures.push({ check, reason });
}

function parseHosts(raw, failures, check) {
  const hosts = (raw ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (hosts.length === 0 || hosts.some((host) => !DNS_HOSTNAME_PATTERN.test(host))) {
    addFailure(failures, check, "must be a non-empty comma-separated DNS hostname allowlist");
    return new Set();
  }
  return new Set(hosts);
}

function parseCleanUrl(raw, failures, check, pathname, allowedHosts) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    addFailure(failures, check, "must be a valid URL");
    return;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== pathname ||
    !allowedHosts.has(parsed.hostname.toLowerCase())
  ) {
    addFailure(failures, check, `must be clean HTTPS URL ${pathname} on an allowlisted hostname`);
  }
}

function requireBase64UrlLength(failures, name, length) {
  const raw = value(name);
  if (!raw || raw.length !== length || !BASE64URL_PATTERN.test(raw)) {
    addFailure(failures, name, `must be canonical base64url with ${length} characters`);
  }
}

async function main() {
  const failures = [];
  const role = value("TLSN_DEPLOYMENT_ROLE");
  let inputManifest;
  try {
    inputManifest = JSON.parse(await readFile(INPUT_MANIFEST_PATH, "utf8"));
  } catch {
    addFailure(failures, "production-inputs.json", "input manifest could not be read");
    inputManifest = {};
  }
  const commonInputs = Array.isArray(inputManifest.common_inputs) ? inputManifest.common_inputs : [];
  const workflowEvidenceInputs = Array.isArray(inputManifest.workflow_evidence_inputs) ? inputManifest.workflow_evidence_inputs : [];
  const canaryInputs = Array.isArray(inputManifest.canary_inputs) ? inputManifest.canary_inputs : [];
  const productionInputs = Array.isArray(inputManifest.production_inputs) ? inputManifest.production_inputs : [];
  const canarySecrets = Array.isArray(inputManifest.canary_secret_inputs) ? inputManifest.canary_secret_inputs : [];
  const productionSecrets = Array.isArray(inputManifest.production_secret_inputs) ? inputManifest.production_secret_inputs : [];
  if (
    inputManifest.schema_version !== 2 ||
    inputManifest.scope !== "tlsn-deployment-inputs" ||
    JSON.stringify(commonInputs) !== JSON.stringify(COMMON_INPUTS) ||
    JSON.stringify(workflowEvidenceInputs) !== JSON.stringify(WORKFLOW_EVIDENCE_INPUTS) ||
    JSON.stringify(canaryInputs) !== JSON.stringify(CANARY_INPUTS) ||
    JSON.stringify(productionInputs) !== JSON.stringify(PRODUCTION_INPUTS) ||
    JSON.stringify(canarySecrets) !== JSON.stringify(["TLSN_CANARY_SIGNING_PRIVATE_KEY_PKCS8", "TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER"]) ||
    JSON.stringify(productionSecrets) !== JSON.stringify(["TLSN_PRODUCTION_SIGNING_PRIVATE_KEY_PKCS8", "TLSN_PRODUCTION_TRUST_ROOT_CERTIFICATE_DER"])
  ) {
    addFailure(failures, "production-inputs.json", "manifest schema is invalid");
  }
  const roleInputs = ROLE_PATTERN.test(role ?? "") ? inputsForRole(role) : [];
  const secretInputs = ROLE_PATTERN.test(role ?? "") ? secretInputsForRole(role) : [];
  const requiredInputs = [...roleInputs, ...secretInputs, ...WORKFLOW_EVIDENCE_INPUTS];
  if (value("TLSN_ENVIRONMENT") !== "production") {
    addFailure(failures, "TLSN_ENVIRONMENT", "must be exactly production");
  }
  if (!ROLE_PATTERN.test(role ?? "")) {
    addFailure(failures, "TLSN_DEPLOYMENT_ROLE", "must be production or canary");
  }
  if (!GIT_COMMIT_PATTERN.test(value("TLSN_GIT_COMMIT_SHA") ?? "")) {
    addFailure(failures, "TLSN_GIT_COMMIT_SHA", "must be a 40-character git commit SHA");
  } else {
    try {
      if (checkoutCommit(packageDirectory) !== value("TLSN_GIT_COMMIT_SHA")?.toLowerCase()) {
        addFailure(failures, "TLSN_GIT_COMMIT_SHA", "must match the checked-out HEAD");
      }
    } catch {
      addFailure(failures, "TLSN_GIT_COMMIT_SHA", "checked-out HEAD could not be read");
    }
  }
  let workflowContext;
  try {
    workflowContext = workflowContextFromEnvironment(process.env, role);
  } catch (error) {
    addFailure(failures, "workflow_evidence", error instanceof Error ? error.message : String(error));
  }
  if (role === "canary" && !/^[A-Za-z0-9_-]{1,512}$/.test(value("TLSN_CANARY_BINDING_VALUE") ?? "")) {
    addFailure(failures, "TLSN_CANARY_BINDING_VALUE", "canary role requires a fixed synthetic binding value");
  }
  const forbiddenRoleInputs = role === "canary"
    ? ["TLSN_PRODUCTION_SIGNING_PRIVATE_KEY_PKCS8", "TLSN_PRODUCTION_TRUST_ROOT_CERTIFICATE_DER", "TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI", "TLSN_PRODUCTION_DEPLOYMENT_ID", "TLSN_PRODUCTION_WORKER_NAME"]
    : ["TLSN_CANARY_SIGNING_PRIVATE_KEY_PKCS8", "TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER", "TLSN_CANARY_RESULT_PUBLIC_KEY_SPKI", "TLSN_CANARY_DEPLOYMENT_ID", "TLSN_CANARY_WORKER_NAME", "TLSN_CANARY_BINDING_VALUE"];
  for (const name of [...forbiddenRoleInputs, "TLSN_TEST_BINDING_VALUE", "TLSN_TEST_AUTH_USERS"]) {
    if (process.env[name] !== undefined) addFailure(failures, name, "forbidden configuration is present for this deployment role");
  }
  for (const name of requiredInputs) {
    if (!value(name)) addFailure(failures, name, "required value is missing");
  }
  const forbiddenNames = Object.keys(process.env).filter((name) =>
    /SUPABASE_SERVICE_ROLE|SUPABASE_SERVICE_KEY|DEVICE_(?:PRIVATE|SECRET|PKCS8)|TLSN_REMOTE_(?:ACCESS_TOKEN|DEVICE_.*PRIVATE)/i.test(name),
  );
  for (const name of forbiddenNames) {
    addFailure(failures, name, "service-role, device-private-key, or remote-test secret must not be in the deployment environment");
  }
  const markerFields = [
    "TLSN_CANDIDATE_SERVER_IDENTITY",
    "TLSN_CANDIDATE_VERIFIER_KEY_ID",
    "TLSN_CANDIDATE_NOTARY_KEY_ID",
    "TLSN_CANARY_DEPLOYMENT_ID",
    "TLSN_PRODUCTION_DEPLOYMENT_ID",
    "TLSN_CANDIDATE_DEVICE_AUTH_URL",
    "TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL",
    "TLSN_CANDIDATE_SUPABASE_URL",
  ];
  for (const name of markerFields) {
    const raw = value(name);
    if (raw && TEST_MARKER_PATTERN.test(raw)) addFailure(failures, name, "test, synthetic, fixture, local, or staging marker is not allowed");
  }
  const deviceHosts = parseHosts(value("TLSN_CANDIDATE_DEVICE_AUTH_ALLOWED_HOSTS"), failures, "TLSN_CANDIDATE_DEVICE_AUTH_ALLOWED_HOSTS");
  const supabaseHosts = parseHosts(value("TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS"), failures, "TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS");
  parseCleanUrl(value("TLSN_CANDIDATE_DEVICE_AUTH_URL") ?? "", failures, "TLSN_CANDIDATE_DEVICE_AUTH_URL", "/api/auth/anonymous-sync/v2/device-proof", deviceHosts);
  parseCleanUrl(value("TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL") ?? "", failures, "TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL", "/api/auth/anonymous-sync/v2/tlsn-device-proof", deviceHosts);
  parseCleanUrl(value("TLSN_CANDIDATE_SUPABASE_URL") ?? "", failures, "TLSN_CANDIDATE_SUPABASE_URL", "/", supabaseHosts);
  const ttl = Number(value("TLSN_BINDING_TTL_SECONDS"));
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 3600) addFailure(failures, "TLSN_BINDING_TTL_SECONDS", "must be an integer from 1 through 3600");
  if (!value("TLSN_CANDIDATE_SERVER_IDENTITY") || !DNS_HOSTNAME_PATTERN.test(value("TLSN_CANDIDATE_SERVER_IDENTITY"))) addFailure(failures, "TLSN_CANDIDATE_SERVER_IDENTITY", "must be a DNS hostname");
  const deploymentIdName = role === "canary" ? "TLSN_CANARY_DEPLOYMENT_ID" : "TLSN_PRODUCTION_DEPLOYMENT_ID";
  if (!value(deploymentIdName) || !/^[A-Za-z0-9._-]{1,128}$/.test(value(deploymentIdName))) addFailure(failures, deploymentIdName, "must be an alphanumeric deployment identifier");
  requireBase64UrlLength(failures, "TLSN_CANDIDATE_PROFILE_SHA256", 43);
  requireBase64UrlLength(failures, "TLSN_SECURITY_REGISTRY_SET_SHA256", 43);
  const resultKeyName = role === "canary" ? "TLSN_CANARY_RESULT_PUBLIC_KEY_SPKI" : "TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI";
  requireBase64UrlLength(failures, resultKeyName, 59);
  let registry;
  const registryRaw = value("TLSN_CANDIDATE_NOTARY_REGISTRY");
  try { registry = JSON.parse(registryRaw ?? ""); } catch { addFailure(failures, "TLSN_CANDIDATE_NOTARY_REGISTRY", "must be valid JSON"); }
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) addFailure(failures, "TLSN_CANDIDATE_NOTARY_REGISTRY", "must be a JSON object");
  else if (!registry[value("TLSN_CANDIDATE_NOTARY_KEY_ID")]) addFailure(failures, "TLSN_CANDIDATE_NOTARY_REGISTRY", "must contain TLSN_CANDIDATE_NOTARY_KEY_ID");
  const signingKeyRaw = value(secretInputs[0]);
  const trustRootHash = secretHash(value(secretInputs[1]));
  const signingKeyBytes = decodeBase64Url(signingKeyRaw);
  if (!signingKeyBytes) addFailure(failures, secretInputs[0] ?? "signing_key", "must be canonical base64url");
  if (!trustRootHash) addFailure(failures, secretInputs[1] ?? "trust_root", "must be canonical base64url");
  if (signingKeyBytes) {
    try {
      const derivedPublicKey = createPublicKey(createPrivateKey({ key: signingKeyBytes, format: "der", type: "pkcs8" })).export({ format: "der", type: "spki" }).toString("base64url");
      if (derivedPublicKey !== value(resultKeyName)) addFailure(failures, resultKeyName, "must match the role-specific signing private key");
    } catch { addFailure(failures, secretInputs[0], "must be a valid Ed25519 PKCS8 private key"); }
  }
  const outboundUrlChecks = new Set(["TLSN_CANDIDATE_DEVICE_AUTH_URL", "TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL", "TLSN_CANDIDATE_SUPABASE_URL", "TLSN_CANDIDATE_DEVICE_AUTH_ALLOWED_HOSTS", "TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS"]);
  const report = {
    schema_version: 2,
    generated_at: new Date().toISOString(),
    environment: "production",
    deployment_role: role ?? null,
    status: failures.length === 0 ? "PASS" : "FAIL",
    checks: {
      required_variables: failures.filter(({ check }) => requiredInputs.includes(check)).length === 0,
      no_test_configuration: failures.every(({ check }) => !["TLSN_TEST_BINDING_VALUE", "TLSN_TEST_AUTH_USERS"].includes(check)),
      no_forbidden_secret_names: forbiddenNames.length === 0,
      clean_outbound_urls: failures.every(({ check }) => !outboundUrlChecks.has(check)),
      result_key_published: !failures.some(({ check }) => check === resultKeyName),
      signing_key_matches_result_key: !failures.some(({ reason }) => reason.includes("signing private key")),
    },
    failure_count: failures.length,
    failures,
  };
  const reportPath = value("TLSN_PREFLIGHT_REPORT_PATH") ?? DEFAULT_REPORT_PATH;
  const provenancePath = value("TLSN_PROVENANCE_REPORT_PATH") ?? DEFAULT_PROVENANCE_PATH;
  const provenance = {
    schema_version: 2,
    scope: "tlsn-deployment-provenance",
    generated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    status: report.status,
    environment: "production",
    deployment_role: role ?? null,
    security_identity: {
      git_commit_sha: value("TLSN_GIT_COMMIT_SHA") ?? null,
      server_identity: value("TLSN_CANDIDATE_SERVER_IDENTITY") ?? null,
      profile_sha256: value("TLSN_CANDIDATE_PROFILE_SHA256") ?? null,
      verifier_key_id: value("TLSN_CANDIDATE_VERIFIER_KEY_ID") ?? null,
      notary_key_id: value("TLSN_CANDIDATE_NOTARY_KEY_ID") ?? null,
      security_registry_set_sha256: value("TLSN_SECURITY_REGISTRY_SET_SHA256") ?? null,
      notary_registry_sha256: registryRaw ? sha256Base64Url(registryRaw) : null,
      binding_authority: "durable-single-use",
    },
    deployment_identity: {
      deployment_id: value(deploymentIdName) ?? null,
      deployment_role: role ?? null,
      binding_mode: role === "canary" ? "fixed_canary" : "random",
      trust_root_certificate_sha256: trustRootHash,
      worker_name: value(role === "canary" ? "TLSN_CANARY_WORKER_NAME" : "TLSN_PRODUCTION_WORKER_NAME") ?? null,
    },
    result_identity: {
      result_public_key_spki: value(resultKeyName) ?? null,
      result_public_key_spki_sha256: value(resultKeyName) ? sha256Base64Url(value(resultKeyName)) : null,
    },
    device_endpoint_hosts: [...deviceHosts].sort(),
    supabase_endpoint_hosts: [...supabaseHosts].sort(),
    allowed_input_manifest: "scripts/production-inputs.json",
    ...(workflowContext ?? {
      workflow_run_id: value("TLSN_WORKFLOW_RUN_ID") ?? null,
      workflow_run_attempt: value("TLSN_WORKFLOW_RUN_ATTEMPT") ?? null,
      git_commit_sha: value("TLSN_GIT_COMMIT_SHA") ?? null,
      repository: value("TLSN_REPOSITORY") ?? null,
      workflow_file_identity: value("TLSN_WORKFLOW_FILE_IDENTITY") ?? null,
      deployment_role: role ?? null,
    }),
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await mkdir(dirname(provenancePath), { recursive: true });
  await writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, "utf8");
  report.provenance_path = provenancePath;
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ report_path: reportPath, provenance_path: provenancePath, status: report.status, failure_count: report.failure_count }));
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[tlsn-deployment-preflight] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
