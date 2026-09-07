#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const DEFAULT_REPORT_PATH = resolve(packageDirectory, "artifacts/tlsn-deployment-preflight.json");
const DNS_HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const TEST_MARKER_PATTERN = /(?:^|[._-])(test|synthetic|fixture|local|staging)(?:$|[._-])/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

const requiredProductionVariables = [
  "TLSN_BINDING_TTL_SECONDS",
  "TLSN_PRODUCTION_SERVER_IDENTITY",
  "TLSN_PRODUCTION_PROFILE_SHA256",
  "TLSN_PRODUCTION_VERIFIER_KEY_ID",
  "TLSN_PRODUCTION_NOTARY_KEY_ID",
  "TLSN_PRODUCTION_NOTARY_REGISTRY",
  "TLSN_PRODUCTION_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_PRODUCTION_TRUST_ROOT_CERTIFICATE_DER",
  "TLSN_PRODUCTION_DEVICE_AUTH_URL",
  "TLSN_PRODUCTION_DEVICE_POSSESSION_AUTH_URL",
  "TLSN_PRODUCTION_DEVICE_AUTH_ALLOWED_HOSTS",
  "TLSN_PRODUCTION_SUPABASE_ALLOWED_HOSTS",
  "TLSN_SUPABASE_URL",
  "TLSN_SUPABASE_PUBLISHABLE_KEY",
  "TLSN_DEPLOYMENT_ID",
  "TLSN_SECURITY_REGISTRY_SET_SHA256",
  "TLSN_RESULT_PUBLIC_KEY_SPKI",
];

function value(name) {
  return process.env[name]?.trim() || undefined;
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
  if (value("TLSN_ENVIRONMENT") !== "production") {
    addFailure(failures, "TLSN_ENVIRONMENT", "must be exactly production");
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
  try {
    registry = JSON.parse(value("TLSN_PRODUCTION_NOTARY_REGISTRY") ?? "");
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
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ report_path: reportPath, status: report.status, failure_count: report.failure_count }));
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[tlsn-deployment-preflight] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
