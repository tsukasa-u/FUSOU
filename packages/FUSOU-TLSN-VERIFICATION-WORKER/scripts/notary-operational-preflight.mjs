import { createHash, createPublicKey } from "node:crypto";
import { constants, closeSync, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { assertAuthorityKeyRegistry } from "./authority-key-registry.mjs";
import {
  assertAlpha15NotaryVerifyingKey,
  assertNotaryId,
  canonicalJson,
} from "../src/origin-trust-contract.mjs";
import { verifyTlsnRuntimeConfigProductionEnvelope } from "./tlsn-runtime-config-manifest.mjs";

// APP/Proxy notary_wire.rs: FUSOU-N1. This is not a negotiated fallback.
const WIRE_VERSION = 1;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
// Keep the operator check no more permissive than APP's manifest policy.
const APP_POLICY_CEILINGS = {
  max_lifetime_seconds: 3600,
  max_clock_skew_seconds: 30,
  max_reference_age_seconds: 600,
  max_envelope_bytes: 65_536,
};
const SCOPE_FIELDS = [
  "endpoint", "notary_id", "environment", "notary_key_id", "notary_verifying_key",
  "session_authority_key_id", "session_authority_public_key_spki", "wire_version",
];
const KEY_ID = /^[A-Za-z0-9._-]{1,128}$/;
const INPUT_ARTIFACTS = {
  worker_reference_raw: "worker-reference.json",
  origin_inventory_raw: "origin-inventory.json",
  target_approval_raw: "target-approval.json",
  security_registry_set_raw: "security-registry-set.json",
  result_registry_envelope_raw: "result-registry-envelope.json",
};

function sha256(raw) {
  return createHash("sha256").update(raw).digest("base64url");
}

function json(raw, canonical = false) {
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
  const value = JSON.parse(text);
  if (canonical && canonicalJson(value) !== text) throw new Error("Noncanonical JSON");
  return value;
}

function requireFields(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== fields.length ||
      !fields.every((field) => Object.hasOwn(value, field))) {
    throw new Error("Invalid field inventory");
  }
}

function checked(diagnostic, operation) {
  try {
    return operation();
  } catch (cause) {
    // Keep input values, paths and parser excerpts out of the CLI diagnostic.
    throw new Error(diagnostic, { cause });
  }
}

function validateScope(entry) {
  assertNotaryId(entry.notary_id);
  if (typeof entry.endpoint !== "string" || !entry.endpoint || /\s/.test(entry.endpoint) ||
      typeof entry.environment !== "string" || !KEY_ID.test(entry.environment) ||
      typeof entry.notary_key_id !== "string" || !KEY_ID.test(entry.notary_key_id) ||
      typeof entry.session_authority_key_id !== "string" || !KEY_ID.test(entry.session_authority_key_id) ||
      !Number.isSafeInteger(entry.wire_version) || entry.wire_version < 1) {
    throw new Error("Invalid Notary scope metadata");
  }
  assertAlpha15NotaryVerifyingKey(entry.notary_verifying_key);
  const spki = entry.session_authority_public_key_spki;
  if (typeof spki !== "string" || !/^[A-Za-z0-9_-]{59}$/.test(spki)) {
    throw new Error("Invalid Session Authority SPKI");
  }
  const key = createPublicKey({ key: Buffer.from(spki, "base64url"), format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "ed25519" ||
      key.export({ format: "der", type: "spki" }).toString("base64url") !== spki) {
    throw new Error("Invalid Session Authority SPKI");
  }
}

export function checkNotaryOperationalPreflight({
  envelopeRaw, trustedSigner, policy, independentInputs,
  registrationRaw, approvedRegistrationSha256, notaryPublicConfigRaw, sessionRegistryRaw,
}) {
  if (!registrationRaw || sha256(registrationRaw) !== approvedRegistrationSha256) {
    throw new Error("Approved Notary registration digest mismatch or missing input");
  }
  const registration = checked("Invalid Notary registration", () => {
    const table = json(registrationRaw, true);
    requireFields(table, ["schema_version", "scopes"]);
    if (table.schema_version !== 1 || !Array.isArray(table.scopes) ||
        !table.scopes.length || table.scopes.length > 256) throw new Error("Invalid scope list");
    for (const entry of table.scopes) {
      requireFields(entry, [...SCOPE_FIELDS, "session_authority_registry_sha256"]);
      validateScope(entry);
      if (typeof entry.session_authority_registry_sha256 !== "string" ||
          !/^[A-Za-z0-9_-]{43}$/.test(entry.session_authority_registry_sha256)) {
        throw new Error("Invalid Session Authority registry digest");
      }
    }
    return table;
  });
  const scopes = new Map();
  const authorityKeys = new Set();
  const authorityIds = new Set();
  for (const entry of registration.scopes) {
    const scope = JSON.stringify([entry.notary_id, entry.environment]);
    if (scopes.has(scope)) throw new Error("Duplicate Notary/environment scope");
    if (authorityKeys.has(entry.session_authority_public_key_spki) ||
        authorityIds.has(entry.session_authority_key_id)) {
      throw new Error("Session Authority key or key ID reused across Notary scopes");
    }
    scopes.set(scope, entry);
    authorityKeys.add(entry.session_authority_public_key_spki);
    authorityIds.add(entry.session_authority_key_id);
  }

  const { payload } = checked("Runtime Config signature, policy, or independent artifacts rejected", () => {
    for (const [field, ceiling] of Object.entries(APP_POLICY_CEILINGS)) {
      if (!Number.isSafeInteger(policy?.[field]) || policy[field] < 1 || policy[field] > ceiling) {
        throw new Error("Policy exceeds APP limits");
      }
    }
    return verifyTlsnRuntimeConfigProductionEnvelope(envelopeRaw, { trustedSigner, policy, independentInputs });
  });
  if (payload.environment !== "production" || payload.source.disclosure_mode !== "complete") {
    throw new Error("APP Notary preflight requires Production Complete Runtime Config");
  }
  const app = payload.compile_inputs;
  const expected = {
    endpoint: app.FUSOU_TLSN_NOTARY_ENDPOINT,
    notary_id: app.FUSOU_TLSN_NOTARY_ID,
    environment: payload.environment,
    notary_key_id: json(independentInputs.security_registry_set_raw).notary_key_id,
    notary_verifying_key: app.FUSOU_TLSN_NOTARY_VERIFYING_KEY,
    session_authority_key_id: app.FUSOU_TLSN_SESSION_AUTHORITY_KEY_ID,
    session_authority_public_key_spki: app.FUSOU_TLSN_SESSION_AUTHORITY_PUBLIC_KEY,
    wire_version: WIRE_VERSION,
  };
  const approved = scopes.get(JSON.stringify([expected.notary_id, expected.environment]));
  if (!approved) throw new Error("No approved registration for APP Notary ID/environment");
  const operator = checked("Invalid Notary operator public configuration", () => {
    const value = json(notaryPublicConfigRaw, true);
    requireFields(value, SCOPE_FIELDS);
    validateScope(value);
    return value;
  });
  for (const field of SCOPE_FIELDS) {
    if (approved[field] !== expected[field]) throw new Error(`Notary registration mismatch: ${field}`);
    if (operator[field] !== expected[field]) throw new Error(`Notary operator configuration mismatch: ${field}`);
  }
  if (!sessionRegistryRaw || sha256(sessionRegistryRaw) !== approved.session_authority_registry_sha256) {
    throw new Error("Approved Session Authority registry digest mismatch or missing input");
  }
  checked("Session Authority registry does not authorize the configured grant key", () =>
    assertAuthorityKeyRegistry(json(sessionRegistryRaw), {
      scope: "tlsn-session-authority-key-registry",
      currentKeyId: expected.session_authority_key_id,
      currentPublicKeySpki: expected.session_authority_public_key_spki,
      now: new Date(policy.now_ms),
    }));
  return { status: "NOTARY_PUBLIC_CONFIGURATION_MATCHED_OFFLINE", gameplay_authorized: false };
}

function readInput(directory, name) {
  return checked(`Missing, unreadable, or oversized input: ${name}`, () => {
    const fd = openSync(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = fstatSync(fd);
      const { size } = stat;
      if (!stat.isFile() || !size || size > MAX_FILE_BYTES) throw new Error("Invalid file");
      const raw = Buffer.alloc(size + 1);
      let total = 0;
      while (total < raw.length) {
        const count = readSync(fd, raw, total, raw.length - total, null);
        if (!count) break;
        total += count;
      }
      if (total !== size) throw new Error("Input size changed");
      return raw.subarray(0, total);
    } finally {
      closeSync(fd);
    }
  });
}

function main([snapshot, approval, approvedRegistrationSha256, ...extra]) {
  if (!snapshot || !approval || extra.length || !/^[A-Za-z0-9_-]{43}$/.test(approvedRegistrationSha256 ?? "")) {
    throw new Error("Usage: node notary-operational-preflight.mjs SNAPSHOT_DIR APPROVAL_DIR APPROVED_REGISTRATION_SHA256");
  }
  const trust = checked("Invalid independently supplied Runtime Config trust/policy", () => {
    const value = json(readInput(approval, "runtime-config-trust.json"));
    requireFields(value, ["trusted_signer", "policy"]);
    if (!value.policy || typeof value.policy !== "object" || Array.isArray(value.policy) ||
        Object.hasOwn(value.policy, "now_ms")) throw new Error("Validation uses the current clock");
    return value;
  });
  return checkNotaryOperationalPreflight({
    envelopeRaw: readInput(snapshot, "runtime-config-envelope.json"),
    trustedSigner: trust.trusted_signer,
    policy: { ...trust.policy, now_ms: Date.now() },
    independentInputs: Object.fromEntries(Object.entries(INPUT_ARTIFACTS).map(
      ([field, name]) => [field, readInput(snapshot, name)],
    )),
    registrationRaw: readInput(approval, "notary-registration.json"),
    approvedRegistrationSha256,
    notaryPublicConfigRaw: readInput(snapshot, "notary-operator-public-config.json"),
    sessionRegistryRaw: readInput(snapshot, "session-authority-registry.json"),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(main(process.argv.slice(2))));
  } catch (error) {
    console.error(`Notary preflight: ${error.message}`);
    process.exitCode = 1;
  }
}
