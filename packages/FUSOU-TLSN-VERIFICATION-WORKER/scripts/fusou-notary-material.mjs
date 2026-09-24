#!/usr/bin/env node

import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  assertAlpha15NotaryVerifyingKey,
  canonicalNotaryRegistryJson,
} from "./production-trust-contract.mjs";

export const FUSOU_NOTARY_PROTOCOL = "tlsn-v0.1.0-alpha.15";
export const FUSOU_NOTARY_DEFAULT_SESSION_TIMEOUT_SECONDS = 300;
export const FUSOU_NOTARY_DEFAULT_MAX_CONCURRENT_SESSIONS = 1;
export const FUSOU_NOTARY_MAX_SESSION_TIMEOUT_SECONDS = 3600;
export const FUSOU_NOTARY_MAX_CONCURRENT_SESSIONS = 64;

const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
}

function assertExactKeys(value, keys, label) {
  const actual = Object.keys(value).sort().join("\0");
  const expected = [...keys].sort().join("\0");
  if (actual !== expected) throw new Error(`${label} fields are invalid`);
}

function assertCanonicalBase64url(value, label) {
  if (typeof value !== "string" || !BASE64URL_PATTERN.test(value) || value.length % 4 === 1) {
    throw new Error(`${label} must be canonical base64url`);
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length === 0 || bytes.toString("base64url") !== value) {
    throw new Error(`${label} must be canonical base64url`);
  }
  return bytes;
}

export function assertFusouNotaryEndpoint(value) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0 || /\s|:\/\//.test(value)) {
    throw new Error("FUSOU-NOTARY endpoint must be a raw host:port value");
  }
  let host;
  let port;
  if (value.startsWith("[")) {
    const separator = value.lastIndexOf("]:");
    if (separator < 0) throw new Error("FUSOU-NOTARY IPv6 endpoint must use [host]:port syntax");
    host = value.slice(1, separator);
    port = value.slice(separator + 2);
  } else {
    const separator = value.lastIndexOf(":");
    if (separator <= 0 || value.indexOf(":") !== separator) {
      throw new Error("FUSOU-NOTARY endpoint must use host:port syntax");
    }
    host = value.slice(0, separator);
    port = value.slice(separator + 1);
  }
  if (!host || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error("FUSOU-NOTARY endpoint must contain a valid port");
  }
  return value;
}

export function parseFusouNotaryPublicKeyExport(raw, label = "FUSOU-NOTARY public key export") {
  let parsed;
  try {
    parsed = JSON.parse(raw ?? "");
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
  assertObject(parsed, label);
  assertExactKeys(parsed, [
    "schema_version",
    "protocol",
    "key_id",
    "status",
    "signature_algorithm",
    "verifying_key_base64url",
    "sec1_public_key_base64url",
  ], label);
  if (parsed.schema_version !== 1 || parsed.protocol !== FUSOU_NOTARY_PROTOCOL) {
    throw new Error(`${label} must identify TLSNotary v0.1.0-alpha.15`);
  }
  if (parsed.status !== "ACTIVE") throw new Error(`${label} must contain an ACTIVE signing key`);
  if (parsed.signature_algorithm !== "secp256k1") throw new Error(`${label} must use secp256k1`);
  if (typeof parsed.key_id !== "string" || !KEY_ID_PATTERN.test(parsed.key_id)) {
    throw new Error(`${label} key_id is invalid`);
  }

  const verifyingKeyBytes = assertCanonicalBase64url(parsed.verifying_key_base64url, `${label}.verifying_key_base64url`);
  const sec1PublicKeyBytes = assertCanonicalBase64url(parsed.sec1_public_key_base64url, `${label}.sec1_public_key_base64url`);
  assertAlpha15NotaryVerifyingKey(parsed.verifying_key_base64url, `${label}.verifying_key_base64url`);
  if (sec1PublicKeyBytes.length !== 33 || ![0x02, 0x03].includes(sec1PublicKeyBytes[0])) {
    throw new Error(`${label}.sec1_public_key_base64url must be a compressed secp256k1 public key`);
  }
  if (!verifyingKeyBytes.subarray(9).equals(sec1PublicKeyBytes)) {
    throw new Error(`${label} VerifyingKey and SEC1 public key do not match`);
  }
  return Object.freeze({
    schema_version: parsed.schema_version,
    protocol: parsed.protocol,
    key_id: parsed.key_id,
    status: parsed.status,
    signature_algorithm: parsed.signature_algorithm,
    verifying_key_base64url: parsed.verifying_key_base64url,
    sec1_public_key_base64url: parsed.sec1_public_key_base64url,
  });
}

export function fusouNotaryRegistryFromPublicKeyExport(publicKeyExport) {
  const parsed = typeof publicKeyExport === "string"
    ? parseFusouNotaryPublicKeyExport(publicKeyExport)
    : parseFusouNotaryPublicKeyExport(JSON.stringify(publicKeyExport));
  const registry = canonicalNotaryRegistryJson(JSON.stringify({
    [parsed.key_id]: parsed.verifying_key_base64url,
  }));
  const registryBytes = Buffer.from(registry, "utf8");
  return {
    key_id: parsed.key_id,
    verifying_key: parsed.verifying_key_base64url,
    sec1_public_key: parsed.sec1_public_key_base64url,
    registry,
    registry_sha256: createHash("sha256").update(registryBytes).digest("base64url"),
    verifying_key_sha256: createHash("sha256").update(Buffer.from(parsed.verifying_key_base64url, "base64url")).digest("base64url"),
    sec1_public_key_sha256: createHash("sha256").update(Buffer.from(parsed.sec1_public_key_base64url, "base64url")).digest("base64url"),
  };
}

export async function readFusouNotaryPublicKeyExport(path) {
  return parseFusouNotaryPublicKeyExport(await readFile(resolve(path), "utf8"), path);
}

export function createFusouNotaryProvisioningRecord({
  publicKeyExport,
  endpoint,
  sessionTimeoutSeconds = FUSOU_NOTARY_DEFAULT_SESSION_TIMEOUT_SECONDS,
  maxConcurrentSessions = FUSOU_NOTARY_DEFAULT_MAX_CONCURRENT_SESSIONS,
  source = "packages/FUSOU-NOTARY/src/keys.rs public_key_export_json",
} = {}) {
  const notary = fusouNotaryRegistryFromPublicKeyExport(publicKeyExport);
  assertFusouNotaryEndpoint(endpoint);
  if (!Number.isSafeInteger(sessionTimeoutSeconds) || sessionTimeoutSeconds < 1 || sessionTimeoutSeconds > FUSOU_NOTARY_MAX_SESSION_TIMEOUT_SECONDS) {
    throw new Error(`session timeout must be between 1 and ${FUSOU_NOTARY_MAX_SESSION_TIMEOUT_SECONDS} seconds`);
  }
  if (!Number.isSafeInteger(maxConcurrentSessions) || maxConcurrentSessions < 1 || maxConcurrentSessions > FUSOU_NOTARY_MAX_CONCURRENT_SESSIONS) {
    throw new Error(`max concurrent sessions must be between 1 and ${FUSOU_NOTARY_MAX_CONCURRENT_SESSIONS}`);
  }
  return {
    schema_version: 1,
    scope: "fusou-owned-notary-provisioning",
    owner: "FUSOU",
    service: "FUSOU-NOTARY",
    status: "PUBLIC_MATERIAL_READY",
    protocol: FUSOU_NOTARY_PROTOCOL,
    transport: "raw_tcp",
    mpc_role: "verifier",
    origin_connection: "prover_owned",
    attestation_signing: "FUSOU-NOTARY active secp256k1 signing key",
    endpoint,
    key_id: notary.key_id,
    verifying_key: notary.verifying_key,
    registry_sha256: notary.registry_sha256,
    verifying_key_sha256: notary.verifying_key_sha256,
    sec1_public_key_sha256: notary.sec1_public_key_sha256,
    runtime_policy: {
      session_timeout_seconds: sessionTimeoutSeconds,
      max_concurrent_sessions: maxConcurrentSessions,
      max_attestation_request_bytes: 16 * 1024 * 1024,
    },
    key_material_handling: "Notary private key is secret-provider-only; never written by this provisioning path",
    source,
  };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const exportPath = argument("--export-file");
  const endpoint = argument("--endpoint");
  const outputPath = argument("--output");
  if (!exportPath || !endpoint || !outputPath) {
    throw new Error("usage: fusou-notary-material --export-file <public-export.json> --endpoint <host:port> --output <directory>");
  }
  const publicKeyExport = await readFusouNotaryPublicKeyExport(exportPath);
  const record = createFusouNotaryProvisioningRecord({
    publicKeyExport,
    endpoint,
    sessionTimeoutSeconds: Number(argument("--session-timeout-seconds") ?? FUSOU_NOTARY_DEFAULT_SESSION_TIMEOUT_SECONDS),
    maxConcurrentSessions: Number(argument("--max-concurrent-sessions") ?? FUSOU_NOTARY_DEFAULT_MAX_CONCURRENT_SESSIONS),
  });
  const registry = fusouNotaryRegistryFromPublicKeyExport(publicKeyExport).registry;
  const outputDirectory = resolve(outputPath);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await chmod(outputDirectory, 0o700);
  await writeFile(join(outputDirectory, "notary-public-key-export.json"), `${JSON.stringify(publicKeyExport, null, 2)}\n`, { mode: 0o644 });
  await writeFile(join(outputDirectory, "notary-registry.json"), `${registry}\n`, { mode: 0o644 });
  await writeFile(join(outputDirectory, "notary-provisioning.json"), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o644 });
  console.log(JSON.stringify({ status: record.status, output: outputDirectory, key_id: record.key_id, registry_sha256: record.registry_sha256, private_key_written: false, network_access: "NOT_USED" }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error(`[fusou-notary-material] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}