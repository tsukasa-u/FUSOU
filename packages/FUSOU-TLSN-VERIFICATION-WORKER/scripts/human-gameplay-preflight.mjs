#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HUMAN_GAMEPLAY_PREFLIGHT_SCHEMA_VERSION = 2;
export const HUMAN_GAMEPLAY_PREFLIGHT_SCOPE = "tlsn-human-gameplay-preflight";

export const HUMAN_GAMEPLAY_PREDICATES = Object.freeze([
  "target_identity",
  "main_worker",
  "dedicated_verifier",
  "deployment_runtime_ids",
  "verifier_key_registry",
  "notary",
  "origin_web_pki_validation",
  "session_authority",
  "binding_authority",
  "result_authority",
  "workflow_artifact_profile",
  "runtime_attestation",
  "auth_session",
  "registered_device_key",
  "server_device_ownership",
  "candidate_device_key_binding",
  "candidate_configuration_binding",
  "human_operation_no_injection",
  "human_operation_no_replay",
  "human_operation_no_automation",
  "presentation_crypto_verification",
  "capture_provenance",
  "result_signer_deployment_binding",
  "non_synthetic_alpha15_proof_bundle",
  "wasm_build_network",
  "wasm_legacy_build_network",
  "wasm_artifact_source_commit_binding",
  "windows_gnu_cross_compile",
  "windows_runtime",
  "finalizer_effects",
]);

const PREDICATE_STATUSES = new Set([
  "PASS",
  "PASS_LIMITED",
  "UNVERIFIED",
  "BLOCKED",
  "UNAVAILABLE",
  "UNKNOWN",
  "ABSENT",
]);

const PROVENANCE_STATUSES = new Set([
  "VERIFIED",
  "DECLARED",
  "UNVERIFIED",
  "ABSENT",
  "UNAVAILABLE",
  "UNKNOWN",
]);

const REQUIRED_PREDICATES = HUMAN_GAMEPLAY_PREDICATES.filter((name) =>
  ![
    "presentation_crypto_verification",
    "capture_provenance",
    "non_synthetic_alpha15_proof_bundle",
    "wasm_legacy_build_network",
    "windows_gnu_cross_compile",
    "windows_runtime",
    "finalizer_effects",
  ].includes(name),
);

const FIXED_PREDICATE_STATUSES = Object.freeze({
  candidate_configuration_binding: "UNVERIFIED",
  candidate_device_key_binding: "UNVERIFIED",
  human_operation_no_injection: "UNVERIFIED",
  human_operation_no_replay: "UNVERIFIED",
  human_operation_no_automation: "UNVERIFIED",
  presentation_crypto_verification: "UNAVAILABLE",
  capture_provenance: "UNVERIFIED",
  result_signer_deployment_binding: "UNVERIFIED",
  non_synthetic_alpha15_proof_bundle: "UNAVAILABLE",
  wasm_artifact_source_commit_binding: "UNVERIFIED",
  wasm_legacy_build_network: "UNKNOWN",
  windows_runtime: "UNAVAILABLE",
  finalizer_effects: "PASS_LIMITED",
});

const SENSITIVE_KEY_PATTERN = /(token|private.?key|secret|password|credential|cookie)/i;
const SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertExactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} fields do not match the schema`);
  }
}

function assertNoSensitiveValues(value, label = "preflight package") {
  if (Array.isArray(value)) {
    for (const entry of value) assertNoSensitiveValues(entry, label);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) throw new Error(`${label} must not contain sensitive fields`);
    assertNoSensitiveValues(entry, label);
  }
}

function assertStatus(value, allowed, label) {
  if (typeof value !== "string" || !allowed.has(value)) throw new Error(`${label} is invalid`);
}

function validatePredicate(name, predicate) {
  assertExactKeys(
    predicate,
    ["claimed_status", "claimed_cryptographic_verification", "claimed_authority_provenance", "evidence_ref", "evidence_sha256"],
    `predicate ${name}`,
  );
  assertStatus(predicate.claimed_status, PREDICATE_STATUSES, `predicate ${name}.claimed_status`);
  assertStatus(predicate.claimed_cryptographic_verification, PROVENANCE_STATUSES, `predicate ${name}.claimed_cryptographic_verification`);
  assertStatus(predicate.claimed_authority_provenance, PROVENANCE_STATUSES, `predicate ${name}.claimed_authority_provenance`);
  if (predicate.evidence_ref !== null && (typeof predicate.evidence_ref !== "string" || predicate.evidence_ref.trim() === "")) {
    throw new Error(`predicate ${name}.evidence_ref is invalid`);
  }
  if (predicate.evidence_sha256 !== null && (typeof predicate.evidence_sha256 !== "string" || !SHA256_PATTERN.test(predicate.evidence_sha256))) {
    throw new Error(`predicate ${name}.evidence_sha256 is invalid`);
  }
  if ((predicate.evidence_ref === null) !== (predicate.evidence_sha256 === null)) {
    throw new Error(`predicate ${name} evidence reference and digest must be supplied together`);
  }
  if (["PASS", "PASS_LIMITED"].includes(predicate.claimed_status) && name !== "finalizer_effects" && predicate.evidence_ref === null) {
    throw new Error(`predicate ${name} requires an evidence reference and digest for ${predicate.claimed_status}`);
  }
  if (predicate.evidence_ref !== null && /[?&=\s]/.test(predicate.evidence_ref)) {
    throw new Error(`predicate ${name}.evidence_ref must not contain query or credential data`);
  }
  const fixedStatus = FIXED_PREDICATE_STATUSES[name];
  if (fixedStatus && predicate.claimed_status !== fixedStatus) {
    throw new Error(`predicate ${name} must remain ${fixedStatus} in this preflight contract`);
  }
  return {
    operator_asserted_status: predicate.claimed_status,
    operator_asserted_cryptographic_verification: predicate.claimed_cryptographic_verification,
    operator_asserted_authority_provenance: predicate.claimed_authority_provenance,
    evidence_ref_present: predicate.evidence_ref !== null,
    evidence_sha256: predicate.evidence_sha256,
  };
}

function validateTarget(target) {
  assertExactKeys(target, ["server_identity", "source", "presentation_sha256", "declared_expected_identity"], "target");
  if (target.source === "ABSENT") {
    if (target.server_identity !== null || target.presentation_sha256 !== null) {
      throw new Error("absent target identity must not include identity values");
    }
    if (target.declared_expected_identity !== null) {
      throw new Error("absent target identity cannot assert a declared expected value");
    }
    return { operator_asserted_source: "ABSENT", server_identity_present: false, presentation_sha256: null, declared_expected_identity_present: false };
  }
  if (typeof target.server_identity !== "string" || target.server_identity.trim() === "") {
    throw new Error("target.server_identity is missing");
  }
  if (![
    "verified-alpha15-presentation",
    "declared-expected-identity",
    "ABSENT",
  ].includes(target.source)) {
    throw new Error("target.source is invalid");
  }
  if (target.presentation_sha256 !== null && (typeof target.presentation_sha256 !== "string" || !SHA256_PATTERN.test(target.presentation_sha256))) {
    throw new Error("target.presentation_sha256 is invalid");
  }
  if (target.source === "verified-alpha15-presentation" && target.presentation_sha256 === null) {
    throw new Error("Presentation-derived target identity requires a Presentation hash");
  }
  if (target.declared_expected_identity !== null && typeof target.declared_expected_identity !== "string") {
    throw new Error("target.declared_expected_identity is invalid");
  }
  if (target.declared_expected_identity !== null && target.declared_expected_identity !== target.server_identity) {
    throw new Error("declared expected target identity does not match the observed identity");
  }
  return {
    operator_asserted_source: target.source,
    server_identity_present: true,
    presentation_sha256: target.presentation_sha256,
    declared_expected_identity_present: target.declared_expected_identity !== null,
  };
}

function validateLocalIdentity(localIdentity) {
  assertExactKeys(localIdentity, ["session_status", "registered_device_key_status", "device_id"], "local_identity");
  assertStatus(localIdentity.session_status, PREDICATE_STATUSES, "local_identity.session_status");
  assertStatus(localIdentity.registered_device_key_status, PREDICATE_STATUSES, "local_identity.registered_device_key_status");
  if (localIdentity.device_id !== null && (typeof localIdentity.device_id !== "string" || !UUID_V4_PATTERN.test(localIdentity.device_id))) {
    throw new Error("local_identity.device_id must be a UUID v4 or null");
  }
  if (["PASS", "PASS_LIMITED"].includes(localIdentity.registered_device_key_status) && localIdentity.device_id === null) {
    throw new Error("registered local device key requires a UUID v4 device_id");
  }
  if (localIdentity.device_id !== null && !["PASS", "PASS_LIMITED"].includes(localIdentity.registered_device_key_status)) {
    throw new Error("local device_id requires a registered local device key assertion");
  }
  return {
    operator_asserted_session_status: localIdentity.session_status,
    operator_asserted_registered_device_key_status: localIdentity.registered_device_key_status,
    device_id_present: localIdentity.device_id !== null,
    server_ownership: "UNVERIFIED",
    server_revocation: "UNVERIFIED",
  };
}

export function validateHumanGameplayPreflight(raw) {
  let input;
  try {
    input = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw new Error("human gameplay preflight package must be valid JSON");
  }
  assertNoSensitiveValues(input);
  assertExactKeys(
    input,
    ["schema_version", "scope", "target", "capture_source_claim", "local_identity", "predicates", "non_authorizations"],
    "human gameplay preflight package",
  );
  if (input.schema_version !== HUMAN_GAMEPLAY_PREFLIGHT_SCHEMA_VERSION || input.scope !== HUMAN_GAMEPLAY_PREFLIGHT_SCOPE) {
    throw new Error("human gameplay preflight schema or scope is invalid");
  }
  const target = validateTarget(input.target);
  if (!["production-proxy-capture", "synthetic-alpha15-test-fixture", "ABSENT"].includes(input.capture_source_claim)) {
    throw new Error("capture_source_claim is invalid");
  }
  const localIdentity = validateLocalIdentity(input.local_identity);
  assertExactKeys(input.predicates, HUMAN_GAMEPLAY_PREDICATES, "predicates");
  const predicates = Object.fromEntries(HUMAN_GAMEPLAY_PREDICATES.map((name) => [
    name,
    validatePredicate(name, input.predicates[name]),
  ]));
  if (predicates.auth_session.operator_asserted_status !== localIdentity.operator_asserted_session_status) {
    throw new Error("auth_session predicate does not match the local session assertion");
  }
  if (predicates.registered_device_key.operator_asserted_status !== localIdentity.operator_asserted_registered_device_key_status) {
    throw new Error("registered_device_key predicate does not match the local key assertion");
  }
  assertExactKeys(input.non_authorizations, ["readiness", "gameplay", "runtime_attestation_scope"], "non_authorizations");
  if (input.non_authorizations.readiness !== "BLOCKED" || input.non_authorizations.gameplay !== "BLOCKED") {
    throw new Error("preflight must not authorize readiness or gameplay");
  }
  if (input.non_authorizations.runtime_attestation_scope !== "RUNTIME_IDENTITY_ONLY") {
    throw new Error("runtime attestation scope must remain limited to runtime identity");
  }

  const missingRequired = REQUIRED_PREDICATES.filter((name) =>
    ["ABSENT", "BLOCKED", "UNAVAILABLE", "UNKNOWN"].includes(predicates[name].operator_asserted_status),
  );
  if (target.operator_asserted_source !== "verified-alpha15-presentation" && !missingRequired.includes("target_identity")) {
    missingRequired.push("target_identity");
  }
  const unresolvedRequired = REQUIRED_PREDICATES.filter((name) =>
    predicates[name].operator_asserted_status === "UNVERIFIED" ||
    predicates[name].operator_asserted_cryptographic_verification !== "VERIFIED" ||
    predicates[name].operator_asserted_authority_provenance !== "VERIFIED",
  );
  const preflightStatus = missingRequired.length > 0 ? "BLOCKED" : "PASS_LIMITED";

  return {
    schema_version: HUMAN_GAMEPLAY_PREFLIGHT_SCHEMA_VERSION,
    scope: HUMAN_GAMEPLAY_PREFLIGHT_SCOPE,
    contract_validation: "PASS_LIMITED",
    preflight_status: preflightStatus,
    independent_authority_verification: "UNVERIFIED",
    target,
    operator_asserted_capture_source_claim: input.capture_source_claim,
    local_identity: localIdentity,
    predicates,
    unresolved_required_predicates: unresolvedRequired,
    missing_required_predicates: missingRequired,
    runtime_attestation_scope: "RUNTIME_IDENTITY_ONLY",
    readiness_status: "BLOCKED",
    gameplay_authorization: "BLOCKED",
    finalizer_readiness_effect: "NONE",
    finalizer_gameplay_effect: "NONE",
    network_access: "NOT_USED",
    game_started: false,
  };
}

function absentPredicate() {
  return {
    status: "ABSENT",
    cryptographic_verification: "ABSENT",
    authority_provenance: "ABSENT",
    evidence_ref: null,
    evidence_sha256: null,
  };
}

function emptyPreflightReport() {
  return {
    schema_version: HUMAN_GAMEPLAY_PREFLIGHT_SCHEMA_VERSION,
    scope: HUMAN_GAMEPLAY_PREFLIGHT_SCOPE,
    contract_validation: "BLOCKED",
    preflight_status: "BLOCKED",
    independent_authority_verification: "ABSENT",
    target: { source: "ABSENT" },
    local_identity: {
      operator_asserted_session_status: "ABSENT",
      operator_asserted_registered_device_key_status: "ABSENT",
      device_id_present: false,
      server_ownership: "UNVERIFIED",
      server_revocation: "UNVERIFIED",
    },
    predicates: Object.fromEntries(HUMAN_GAMEPLAY_PREDICATES.map((name) => [name, {
      operator_asserted_status: absentPredicate().status,
      operator_asserted_cryptographic_verification: absentPredicate().cryptographic_verification,
      operator_asserted_authority_provenance: absentPredicate().authority_provenance,
      evidence_ref_present: false,
      evidence_sha256: null,
    }])),
    unresolved_required_predicates: REQUIRED_PREDICATES,
    missing_required_predicates: [...REQUIRED_PREDICATES],
    operator_asserted_capture_source_claim: "ABSENT",
    runtime_attestation_scope: "RUNTIME_IDENTITY_ONLY",
    readiness_status: "BLOCKED",
    gameplay_authorization: "BLOCKED",
    finalizer_readiness_effect: "NONE",
    finalizer_gameplay_effect: "NONE",
    network_access: "NOT_USED",
    game_started: false,
  };
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const inputPath = process.argv[2];
  if (!inputPath || process.argv.length !== 3) {
    console.log(JSON.stringify(emptyPreflightReport(), null, 2));
    process.exitCode = 2;
  } else {
    readFile(resolve(inputPath), "utf8")
      .then((raw) => {
        const report = validateHumanGameplayPreflight(raw);
        console.log(JSON.stringify(report, null, 2));
        if (report.preflight_status === "BLOCKED") process.exitCode = 2;
      })
      .catch((error) => {
        const report = emptyPreflightReport();
        report.contract_validation = "BLOCKED";
        report.error = error instanceof Error ? error.message : String(error);
        console.log(JSON.stringify(report, null, 2));
        process.exitCode = 2;
      });
  }
}