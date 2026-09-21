#!/usr/bin/env node

import { createPrivateKey, createPublicKey } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { fixtureSourcePath, readRealFixtureManifest } from "./tlsn-benchmark-fixtures.mjs";

const DEFAULT_SAMPLE_COUNT = 20;
const DEFAULT_CASES = "p50,p95,p99,max";
const DEFAULT_CONCURRENCY = "1,2,4,8";
const FORBIDDEN_GAME_SERVER_HOST_PATTERN = /(?:^|\.)(?:kancolle-server\.com|kancolle\.dmm\.com)$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMON_REQUIRED_ENVIRONMENT = [
  "TLSN_REMOTE_BENCHMARK_WORKER_URL",
  "TLSN_REMOTE_ACCESS_TOKEN_A",
  "TLSN_REMOTE_DEVICE_ID_A",
];
const PRIVATE_KEY_ENVIRONMENT = [
  "TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_FILE",
  "TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL",
];

function authMode() {
  const mode = value("TLSN_REMOTE_AUTH_MODE") ?? "supabase";
  if (mode !== "test" && mode !== "supabase") {
    throw new Error("TLSN_REMOTE_AUTH_MODE must be test or supabase");
  }
  return mode;
}

function value(name) {
  const environmentValue = process.env[name]?.trim();
  return environmentValue || undefined;
}

function required(name) {
  const environmentValue = value(name);
  if (!environmentValue) throw new Error(`missing required environment variable: ${name}`);
  return environmentValue;
}

function parseInteger(name, fallback, minimum, maximum) {
  const raw = value(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function parseList(name, fallback, mapper) {
  const values = (value(name) ?? fallback)
    .split(",")
    .map((item) => mapper(item.trim()))
    .filter((item) => item !== undefined);
  if (values.length === 0) throw new Error(`${name} must contain at least one value`);
  return values;
}

function requireHttpsOrigin(name) {
  const raw = required(name);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid HTTPS origin`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "/" && parsed.pathname !== "")
  ) {
    throw new Error(`${name} must be an HTTPS origin without credentials, port, path, query, or fragment`);
  }
  return parsed.origin;
}

function assertReadinessOrigin(name, origin) {
  const hostname = new URL(origin).hostname;
  if (FORBIDDEN_GAME_SERVER_HOST_PATTERN.test(hostname) || hostname.includes("kancolle")) {
    throw new Error(`${name} must not target a game-server hostname during canary readiness`);
  }
  return origin;
}

async function validatePrivateKey() {
  const configured = PRIVATE_KEY_ENVIRONMENT.filter((name) => value(name));
  if (configured.length !== 1) {
    throw new Error(`set exactly one of ${PRIVATE_KEY_ENVIRONMENT.join(" and ")}`);
  }
  const keyFile = value(PRIVATE_KEY_ENVIRONMENT[0]);
  const encoded = keyFile
    ? (await readFile(keyFile, "utf8")).trim()
    : required(PRIVATE_KEY_ENVIRONMENT[1]);
  if (!encoded) throw new Error("remote device private key is empty");
  try {
    const privateKey = createPrivateKey({
      key: Buffer.from(encoded, "base64url"),
      format: "der",
      type: "pkcs8",
    });
    return privateKey;
  } catch {
    throw new Error("remote device private key is not a valid PKCS#8 base64url Ed25519 key");
  }
}

function validateTestAuth(token, deviceId, privateKey) {
  let users;
  try {
    users = JSON.parse(required("TLSN_TEST_AUTH_USERS"));
  } catch {
    throw new Error("TLSN_TEST_AUTH_USERS must be a valid JSON object");
  }
  const user = users[token];
  if (!user || typeof user.id !== "string" || user.is_anonymous === true) {
    throw new Error("TLSN_REMOTE_ACCESS_TOKEN_A is not present in TLSN_TEST_AUTH_USERS as a non-anonymous user");
  }
  if (value("TLSN_TEST_DEVICE_ID") !== deviceId || !value("TLSN_TEST_DEVICE_PUBLIC_KEY")) {
    throw new Error("test auth requires TLSN_TEST_DEVICE_ID and TLSN_TEST_DEVICE_PUBLIC_KEY matching the remote device");
  }
  const derivedPublicKey = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const expectedPublicKey = Buffer.from(required("TLSN_TEST_DEVICE_PUBLIC_KEY"), "base64url");
  if (derivedPublicKey.length === 0 || expectedPublicKey.length !== 32) {
    throw new Error("TLSN_TEST_DEVICE_PUBLIC_KEY must be the raw Ed25519 public key in base64url");
  }
  const derivedRawPublicKey = derivedPublicKey.subarray(-32);
  if (!derivedRawPublicKey.equals(expectedPublicKey)) {
    throw new Error("remote device private key does not match TLSN_TEST_DEVICE_PUBLIC_KEY");
  }
  return user.id;
}

async function validateFixtures(cases) {
  const { manifest, entries } = readRealFixtureManifest();
  for (const caseLabel of cases) {
    const entry = entries.get(caseLabel);
    if (!entry) throw new Error(`unknown real fixture case: ${caseLabel}`);
    await access(fixtureSourcePath(manifest, entry));
  }
  return { source_path: manifest.source.path, cases };
}

async function main() {
  const mode = authMode();
  const requiredEnvironment = mode === "test"
    ? COMMON_REQUIRED_ENVIRONMENT
    : [
      ...COMMON_REQUIRED_ENVIRONMENT,
      "TLSN_REMOTE_WEB_ORIGIN",
      "TLSN_REMOTE_SUPABASE_URL",
      "TLSN_REMOTE_SUPABASE_PUBLISHABLE_KEY",
    ];
  const missing = requiredEnvironment.filter((name) => !value(name));
  const configuredPrivateKeys = PRIVATE_KEY_ENVIRONMENT.filter((name) => value(name));
  if (missing.length > 0) {
    throw new Error(`missing required environment variables: ${missing.join(", ")}`);
  }

  const workerOrigin = assertReadinessOrigin(
    "TLSN_REMOTE_BENCHMARK_WORKER_URL",
    requireHttpsOrigin("TLSN_REMOTE_BENCHMARK_WORKER_URL"),
  );
  const webOrigin = mode === "supabase"
    ? assertReadinessOrigin("TLSN_REMOTE_WEB_ORIGIN", requireHttpsOrigin("TLSN_REMOTE_WEB_ORIGIN"))
    : null;
  const supabaseOrigin = mode === "supabase"
    ? assertReadinessOrigin("TLSN_REMOTE_SUPABASE_URL", requireHttpsOrigin("TLSN_REMOTE_SUPABASE_URL"))
    : null;
  if (configuredPrivateKeys.length !== 1) {
    throw new Error(`set exactly one of ${PRIVATE_KEY_ENVIRONMENT.join(" and ")}`);
  }
  if (mode === "supabase") {
    required("TLSN_REMOTE_SUPABASE_PUBLISHABLE_KEY");
  }
  const deviceId = required("TLSN_REMOTE_DEVICE_ID_A");
  if (!UUID_PATTERN.test(deviceId)) throw new Error("TLSN_REMOTE_DEVICE_ID_A must be a UUID v4");
  const cases = parseList("TLSN_REMOTE_CASES", DEFAULT_CASES, (item) => item || undefined);
  const concurrency = parseList("TLSN_REMOTE_CONCURRENCY", DEFAULT_CONCURRENCY, (item) => {
    const parsed = Number(item);
    return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 32 ? parsed : undefined;
  });
  const sampleCount = parseInteger("TLSN_REMOTE_SAMPLE_COUNT", DEFAULT_SAMPLE_COUNT, 1, 1_000);
  const privateKey = await validatePrivateKey();
  const userId = mode === "test"
    ? validateTestAuth(required("TLSN_REMOTE_ACCESS_TOKEN_A"), deviceId, privateKey)
    : undefined;
  const fixtures = await validateFixtures(cases);

  console.log(JSON.stringify({
    ok: true,
    auth_mode: mode,
    worker_origin: workerOrigin,
    web_origin: webOrigin,
    supabase_origin: supabaseOrigin,
    device_id: deviceId,
    canonical_user_id: userId ?? null,
    requested_samples_per_case_and_concurrency: sampleCount,
    cases,
    concurrency,
    fixtures,
    network_check: "NOT RUN",
  }));
}

main().catch((error) => {
  console.error(`[tlsn-remote-preflight] ${error instanceof Error ? error.message : "validation_failed"}`);
  process.exitCode = 2;
});
