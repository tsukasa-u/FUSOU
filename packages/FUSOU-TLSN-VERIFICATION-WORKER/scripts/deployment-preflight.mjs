#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const DEFAULT_REPORT_PATH = resolve(packageDirectory, "artifacts/tlsn-deployment-preflight.json");
const DEFAULT_PROVENANCE_PATH = resolve(packageDirectory, "artifacts/tlsn-production-provenance.json");
const INPUT_MANIFEST_PATH = resolve(packageDirectory, "scripts/production-inputs.json");
const DNS_HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const TEST_MARKER_PATTERN = /(?:^|[._-])(test|synthetic|fixture|local|staging)(?:$|[._-])/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const GIT_COMMIT_PATTERN = /^[0-9a-f]{40}$/i;

function value(name) {
  return process.env[name]?.trim() || undefined;
}

function sha256Base64Url(valueToHash) {
  return createHash("sha256").update(valueToHash).digest("base64url");
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
  let inputManifest;
  try {
    inputManifest = JSON.parse(await readFile(INPUT_MANIFEST_PATH, "utf8"));
  } catch {
    addFailure(failures, "production-inputs.json", "input manifest could not be read");
    inputManifest = { allowed_inputs: [] };
  }
  const allowedInputs = Array.isArray(inputManifest.allowed_inputs)
    ? inputManifest.allowed_inputs
    : [];
  if (
    inputManifest.schema_version !== 1 ||
    inputManifest.scope !== "fusou-tlsn-verification-worker-production" ||
    allowedInputs.length === 0 ||
    allowedInputs.some((name) => typeof name !== "string")
  ) {
    addFailure(failures, "production-inputs.json", "manifest schema is invalid");
  }
  const requiredProductionVariables = allowedInputs;
  if (value("TLSN_ENVIRONMENT") !== "production") {
    addFailure(failures, "TLSN_ENVIRONMENT", "must be exactly production");
  }

  if (!new Set(["production", "canary"]).has(value("TLSN_DEPLOYMENT_ROLE"))) {
    addFailure(failures, "TLSN_DEPLOYMENT_ROLE", "must be production or canary");
  }
  if (!GIT_COMMIT_PATTERN.test(value("TLSN_GIT_COMMIT_SHA") ?? "")) {
    addFailure(failures, "TLSN_GIT_COMMIT_SHA", "must be a 40-character git commit SHA");
  }
  if (value("TLSN_DEPLOYMENT_ROLE") === "canary" && !/^[A-Za-z0-9_-]{1,512}$/.test(value("TLSN_CANARY_BINDING_VALUE") ?? "")) {
    addFailure(failures, "TLSN_CANARY_BINDING_VALUE", "canary role requires a fixed synthetic binding value");
  }
  if (value("TLSN_DEPLOYMENT_ROLE") === "production" && process.env.TLSN_CANARY_BINDING_VALUE !== undefined) {
    addFailure(failures, "TLSN_CANARY_BINDING_VALUE", "canary binding must not be present in production");
  }

  for (const name of requiredProductionVariables) {
    if (!value(name)) addFailure(failures, name, "required value is missing");
  }

  for (const name of ["TLSN_TEST_BINDING_VALUE", "TLSN_TEST_AUTH_USERS"]) {
    if (process.env[name] !== undefined) addFailure(failures, name, "test-only configuration must not be present in production");
  }

  const forbiddenNames = Object.keys(process.env).filter((name) =>
    /SUPABASE_SERVICE_ROLE|SUPABASE_SERVICE_KEY|DEVICE_(?:PRIVATE|SECRET|PKCS8)|TLSN_REMOTE_(?:ACCESS_TOKEN|DEVICE_.*PRIVATE)/i.test(name),
  );
  for (const name of forbiddenNames) {
    addFailure(failures, name, "service-role, device-private-key, or remote-test secret must not be in the deployment environment");
  }

  const markerFields = [
    "TLSN_PRODUCTION_SERVER_IDENTITY",
    "TLSN_PRODUCTION_VERIFIER_KEY_ID",
    "TLSN_PRODUCTION_NOTARY_KEY_ID",
    "TLSN_DEPLOYMENT_ID",
    "TLSN_PRODUCTION_DEVICE_AUTH_URL",
    "TLSN_PRODUCTION_DEVICE_POSSESSION_AUTH_URL",
    "TLSN_SUPABASE_URL",
  ];
  for (const name of markerFields) {
    const raw = value(name);
    if (raw && TEST_MARKER_PATTERN.test(raw)) {
      addFailure(failures, name, "test, synthetic, fixture, local, or staging marker is not allowed");
    }
  }

  const deviceHosts = parseHosts(value("TLSN_PRODUCTION_DEVICE_AUTH_ALLOWED_HOSTS"), failures, "TLSN_PRODUCTION_DEVICE_AUTH_ALLOWED_HOSTS");
  const supabaseHosts = parseHosts(value("TLSN_PRODUCTION_SUPABASE_ALLOWED_HOSTS"), failures, "TLSN_PRODUCTION_SUPABASE_ALLOWED_HOSTS");
  parseCleanUrl(
    value("TLSN_PRODUCTION_DEVICE_AUTH_URL") ?? "",
    failures,
    "TLSN_PRODUCTION_DEVICE_AUTH_URL",
    "/api/auth/anonymous-sync/v2/device-proof",
    deviceHosts,
  );
  parseCleanUrl(
    value("TLSN_PRODUCTION_DEVICE_POSSESSION_AUTH_URL") ?? "",
    failures,
    "TLSN_PRODUCTION_DEVICE_POSSESSION_AUTH_URL",
    "/api/auth/anonymous-sync/v2/tlsn-device-proof",
    deviceHosts,
  );
  parseCleanUrl(
    value("TLSN_SUPABASE_URL") ?? "",
    failures,
    "TLSN_SUPABASE_URL",
    "/",
    supabaseHosts,
  );

  const ttl = Number(value("TLSN_BINDING_TTL_SECONDS"));
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 3600) {
    addFailure(failures, "TLSN_BINDING_TTL_SECONDS", "must be an integer from 1 through 3600");
  }
  if (!value("TLSN_PRODUCTION_SERVER_IDENTITY") || !DNS_HOSTNAME_PATTERN.test(value("TLSN_PRODUCTION_SERVER_IDENTITY"))) {
    addFailure(failures, "TLSN_PRODUCTION_SERVER_IDENTITY", "must be a DNS hostname");
  }
  if (!value("TLSN_DEPLOYMENT_ID") || !/^[A-Za-z0-9._-]{1,128}$/.test(value("TLSN_DEPLOYMENT_ID"))) {
    addFailure(failures, "TLSN_DEPLOYMENT_ID", "must be an alphanumeric deployment identifier");
  }
  requireBase64UrlLength(failures, "TLSN_PRODUCTION_PROFILE_SHA256", 43);
  requireBase64UrlLength(failures, "TLSN_SECURITY_REGISTRY_SET_SHA256", 43);
  requireBase64UrlLength(failures, "TLSN_RESULT_PUBLIC_KEY_SPKI", 59);

  let registry;
  const registryRaw = value("TLSN_PRODUCTION_NOTARY_REGISTRY");
  try {
    registry = JSON.parse(registryRaw ?? "");
  } catch {
    addFailure(failures, "TLSN_PRODUCTION_NOTARY_REGISTRY", "must be valid JSON");
  }
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
    addFailure(failures, "TLSN_PRODUCTION_NOTARY_REGISTRY", "must be a JSON object");
  } else if (!registry[value("TLSN_PRODUCTION_NOTARY_KEY_ID")]) {
    addFailure(failures, "TLSN_PRODUCTION_NOTARY_REGISTRY", "must contain TLSN_PRODUCTION_NOTARY_KEY_ID");
  }

  const outboundUrlChecks = new Set([
    "TLSN_PRODUCTION_DEVICE_AUTH_URL",
    "TLSN_PRODUCTION_DEVICE_POSSESSION_AUTH_URL",
    "TLSN_SUPABASE_URL",
    "TLSN_PRODUCTION_DEVICE_AUTH_ALLOWED_HOSTS",
    "TLSN_PRODUCTION_SUPABASE_ALLOWED_HOSTS",
  ]);
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    environment: "production",
    status: failures.length === 0 ? "PASS" : "FAIL",
    checks: {
      required_variables: failures.filter(({ check }) => requiredProductionVariables.includes(check)).length === 0,
      no_test_configuration: failures.every(({ check }) => !["TLSN_TEST_BINDING_VALUE", "TLSN_TEST_AUTH_USERS"].includes(check)),
      no_forbidden_secret_names: forbiddenNames.length === 0,
      clean_outbound_urls: failures.every(({ check }) => !outboundUrlChecks.has(check)),
      result_key_published: !failures.some(({ check }) => check === "TLSN_RESULT_PUBLIC_KEY_SPKI"),
    },
    failure_count: failures.length,
    failures,
  };
  const reportPath = value("TLSN_PREFLIGHT_REPORT_PATH") ?? DEFAULT_REPORT_PATH;
  const provenancePath = value("TLSN_PROVENANCE_REPORT_PATH") ?? DEFAULT_PROVENANCE_PATH;
  const deviceHostsForProvenance = [...deviceHosts].sort();
  const supabaseHostsForProvenance = [...supabaseHosts].sort();
  const provenance = {
    schema_version: 1,
    scope: "production-deployment-inputs",
    generated_at: new Date().toISOString(),
    status: report.status,
    environment: "production",
    deployment_role: value("TLSN_DEPLOYMENT_ROLE") ?? null,
    git_commit_sha: value("TLSN_GIT_COMMIT_SHA") ?? null,
    deployment_id: value("TLSN_DEPLOYMENT_ID") ?? null,
    security_registry_set_sha256: value("TLSN_SECURITY_REGISTRY_SET_SHA256") ?? null,
    profile_sha256: value("TLSN_PRODUCTION_PROFILE_SHA256") ?? null,
    verifier_key_id: value("TLSN_PRODUCTION_VERIFIER_KEY_ID") ?? null,
    notary_key_id: value("TLSN_PRODUCTION_NOTARY_KEY_ID") ?? null,
    notary_registry_sha256: registryRaw ? sha256Base64Url(registryRaw) : null,
    binding_mode: value("TLSN_DEPLOYMENT_ROLE") === "canary" ? "fixed_canary" : "random",
    result_public_key_spki: value("TLSN_RESULT_PUBLIC_KEY_SPKI") ?? null,
    result_public_key_spki_sha256: value("TLSN_RESULT_PUBLIC_KEY_SPKI")
      ? sha256Base64Url(value("TLSN_RESULT_PUBLIC_KEY_SPKI"))
      : null,
    device_endpoint_hosts: deviceHostsForProvenance,
    supabase_endpoint_hosts: supabaseHostsForProvenance,
    allowed_input_manifest: "scripts/production-inputs.json",
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
