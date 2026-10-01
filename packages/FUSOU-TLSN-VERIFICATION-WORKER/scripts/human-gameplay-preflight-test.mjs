#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  HUMAN_GAMEPLAY_PREFLIGHT_SCOPE,
  HUMAN_GAMEPLAY_PREDICATES,
  validateHumanGameplayPreflight,
} from "./human-gameplay-preflight.mjs";

const scriptPath = fileURLToPath(new URL("./human-gameplay-preflight.mjs", import.meta.url));
const predicate = (status = "PASS_LIMITED") => ({
  claimed_status: status,
  claimed_cryptographic_verification: "UNVERIFIED",
  claimed_authority_provenance: "UNVERIFIED",
  evidence_ref: ["PASS", "PASS_LIMITED"].includes(status) ? "test-only:authority-input" : null,
  evidence_sha256: ["PASS", "PASS_LIMITED"].includes(status) ? "B".repeat(43) : null,
});

function makePackage() {
  const predicates = Object.fromEntries(HUMAN_GAMEPLAY_PREDICATES.map((name) => [name, predicate()]));
  Object.assign(predicates, {
    target_identity: predicate("PASS_LIMITED"),
    candidate_configuration_binding: predicate("UNVERIFIED"),
    candidate_device_key_binding: predicate("UNVERIFIED"),
    human_operation_no_injection: predicate("UNVERIFIED"),
    human_operation_no_replay: predicate("UNVERIFIED"),
    human_operation_no_automation: predicate("UNVERIFIED"),
    presentation_crypto_verification: predicate("UNAVAILABLE"),
    capture_provenance: predicate("UNVERIFIED"),
    result_signer_deployment_binding: predicate("UNVERIFIED"),
    non_synthetic_alpha15_proof_bundle: predicate("UNAVAILABLE"),
    wasm_legacy_build_network: predicate("UNKNOWN"),
    wasm_artifact_source_commit_binding: predicate("UNVERIFIED"),
    windows_runtime: predicate("UNAVAILABLE"),
    finalizer_effects: predicate("PASS_LIMITED"),
  });
  return {
    schema_version: 1,
    scope: HUMAN_GAMEPLAY_PREFLIGHT_SCOPE,
    target: {
      server_identity: "game.example.invalid",
      source: "verified-alpha15-presentation",
      presentation_sha256: "A".repeat(43),
      declared_expected_identity: "game.example.invalid",
    },
    capture_source_claim: "ABSENT",
    local_identity: {
      session_status: "PASS_LIMITED",
      registered_device_key_status: "PASS_LIMITED",
      device_id: "123e4567-e89b-42d3-a456-426614174000",
    },
    predicates,
    non_authorizations: {
      readiness: "BLOCKED",
      gameplay: "BLOCKED",
      runtime_attestation_scope: "RUNTIME_IDENTITY_ONLY",
    },
  };
}

const packageInput = makePackage();
const report = validateHumanGameplayPreflight(packageInput);
assert.equal(report.contract_validation, "PASS_LIMITED");
assert.equal(report.preflight_status, "PASS_LIMITED");
assert.equal(report.independent_authority_verification, "UNVERIFIED");
assert.equal(report.target.operator_asserted_source, "verified-alpha15-presentation");
assert.equal(report.local_identity.device_id_present, true);
assert.equal(report.local_identity.server_ownership, "UNVERIFIED");
assert.equal(report.local_identity.server_revocation, "UNVERIFIED");
assert.equal(report.predicates.result_signer_deployment_binding.operator_asserted_status, "UNVERIFIED");
assert.equal(report.predicates.non_synthetic_alpha15_proof_bundle.operator_asserted_status, "UNAVAILABLE");
assert.equal(report.predicates.candidate_configuration_binding.operator_asserted_status, "UNVERIFIED");
assert.equal(report.predicates.result_signer_deployment_binding.operator_asserted_authority_provenance, "UNVERIFIED");
assert.equal(report.runtime_attestation_scope, "RUNTIME_IDENTITY_ONLY");
assert.equal(report.readiness_status, "BLOCKED");
assert.equal(report.gameplay_authorization, "BLOCKED");
assert.equal(report.finalizer_readiness_effect, "NONE");
assert.equal(report.finalizer_gameplay_effect, "NONE");
assert.equal(report.network_access, "NOT_USED");
assert.equal(report.game_started, false);
assert.equal(JSON.stringify(report).includes(packageInput.local_identity.device_id), false);

const fullyAsserted = makePackage();
fullyAsserted.local_identity.session_status = "PASS";
fullyAsserted.local_identity.registered_device_key_status = "PASS";
for (const predicateInput of Object.values(fullyAsserted.predicates)) {
  predicateInput.claimed_status = "PASS";
  predicateInput.claimed_cryptographic_verification = "VERIFIED";
  predicateInput.claimed_authority_provenance = "VERIFIED";
  predicateInput.evidence_ref = "test-only:asserted-input";
  predicateInput.evidence_sha256 = "C".repeat(43);
}
fullyAsserted.predicates.candidate_configuration_binding = predicate("UNVERIFIED");
fullyAsserted.predicates.candidate_device_key_binding = predicate("UNVERIFIED");
fullyAsserted.predicates.human_operation_no_injection = predicate("UNVERIFIED");
fullyAsserted.predicates.human_operation_no_replay = predicate("UNVERIFIED");
fullyAsserted.predicates.human_operation_no_automation = predicate("UNVERIFIED");
fullyAsserted.predicates.presentation_crypto_verification = predicate("UNAVAILABLE");
fullyAsserted.predicates.capture_provenance = predicate("UNVERIFIED");
fullyAsserted.predicates.result_signer_deployment_binding = predicate("UNVERIFIED");
fullyAsserted.predicates.non_synthetic_alpha15_proof_bundle = predicate("UNAVAILABLE");
fullyAsserted.predicates.wasm_legacy_build_network = predicate("UNKNOWN");
fullyAsserted.predicates.wasm_artifact_source_commit_binding = predicate("UNVERIFIED");
fullyAsserted.predicates.windows_runtime = predicate("UNAVAILABLE");
fullyAsserted.predicates.finalizer_effects = predicate("PASS_LIMITED");
const fullyAssertedReport = validateHumanGameplayPreflight(fullyAsserted);
assert.equal(fullyAssertedReport.preflight_status, "PASS_LIMITED");
assert.equal(fullyAssertedReport.independent_authority_verification, "UNVERIFIED");
assert.equal(fullyAssertedReport.readiness_status, "BLOCKED");
assert.equal(fullyAssertedReport.gameplay_authorization, "BLOCKED");

assert.throws(() => validateHumanGameplayPreflight({
  ...packageInput,
  predicates: {
    ...packageInput.predicates,
    result_signer_deployment_binding: predicate("PASS"),
  },
}), /must remain UNVERIFIED/);

assert.throws(() => validateHumanGameplayPreflight({
  ...packageInput,
  predicates: {
    ...packageInput.predicates,
    candidate_configuration_binding: predicate("PASS"),
  },
}), /must remain UNVERIFIED/);

for (const [name, status] of [
  ["candidate_device_key_binding", "PASS"],
  ["human_operation_no_injection", "PASS"],
  ["human_operation_no_replay", "PASS"],
  ["human_operation_no_automation", "PASS"],
  ["presentation_crypto_verification", "PASS"],
  ["capture_provenance", "PASS"],
  ["non_synthetic_alpha15_proof_bundle", "PASS"],
  ["wasm_artifact_source_commit_binding", "PASS"],
  ["wasm_legacy_build_network", "PASS_LIMITED"],
  ["windows_runtime", "PASS"],
  ["finalizer_effects", "PASS"],
]) {
  const promoted = makePackage();
  promoted.predicates[name] = predicate(status);
  assert.throws(() => validateHumanGameplayPreflight(promoted), /must remain/);
}

assert.throws(() => validateHumanGameplayPreflight({
  ...packageInput,
  target: { ...packageInput.target, declared_expected_identity: "other.example.invalid" },
}), /does not match/);

assert.throws(() => validateHumanGameplayPreflight({
  ...packageInput,
  local_identity: { ...packageInput.local_identity, device_id: "123e4567-e89b-12d3-a456-426614174000" },
}), /UUID v4/);

assert.throws(() => validateHumanGameplayPreflight({
  ...packageInput,
  local_identity: { ...packageInput.local_identity, access_token: "must-not-be-present" },
}), /sensitive fields/);

assert.throws(() => validateHumanGameplayPreflight({
  ...packageInput,
  non_authorizations: { ...packageInput.non_authorizations, gameplay: "PASS" },
}), /must not authorize readiness or gameplay/);

assert.throws(() => validateHumanGameplayPreflight({
  ...packageInput,
  non_authorizations: { ...packageInput.non_authorizations, runtime_attestation_scope: "ALL_SERVICES" },
}), /scope must remain limited/);

const missingRequiredInput = makePackage();
missingRequiredInput.predicates.main_worker = predicate("ABSENT");
assert.equal(validateHumanGameplayPreflight(missingRequiredInput).preflight_status, "BLOCKED");

const absentTarget = makePackage();
absentTarget.target = {
  server_identity: null,
  source: "ABSENT",
  presentation_sha256: null,
  declared_expected_identity: null,
};
const absentTargetReport = validateHumanGameplayPreflight(absentTarget);
assert.equal(absentTargetReport.target.operator_asserted_source, "ABSENT");
assert.equal(absentTargetReport.preflight_status, "BLOCKED");

const declaredOnlyTarget = makePackage();
declaredOnlyTarget.target.source = "declared-expected-identity";
assert.equal(validateHumanGameplayPreflight(declaredOnlyTarget).preflight_status, "BLOCKED");
assert.equal(report.predicates.candidate_device_key_binding.operator_asserted_status, "UNVERIFIED");
assert.equal(report.predicates.wasm_legacy_build_network.operator_asserted_status, "UNKNOWN");
assert.equal(report.operator_asserted_capture_source_claim, "ABSENT");
assert.equal(report.predicates.capture_provenance.operator_asserted_status, "UNVERIFIED");

const syntheticCapture = makePackage();
syntheticCapture.capture_source_claim = "synthetic-alpha15-test-fixture";
const syntheticCaptureReport = validateHumanGameplayPreflight(syntheticCapture);
assert.equal(syntheticCaptureReport.preflight_status, "PASS_LIMITED");
assert.equal(syntheticCaptureReport.predicates.capture_provenance.operator_asserted_status, "UNVERIFIED");
assert.equal(syntheticCaptureReport.gameplay_authorization, "BLOCKED");

const proxyCaptureClaim = makePackage();
proxyCaptureClaim.capture_source_claim = "production-proxy-capture";
const proxyCaptureReport = validateHumanGameplayPreflight(proxyCaptureClaim);
assert.equal(proxyCaptureReport.predicates.capture_provenance.operator_asserted_status, "UNVERIFIED");
assert.equal(proxyCaptureReport.gameplay_authorization, "BLOCKED");

const noEvidence = makePackage();
noEvidence.predicates.main_worker.evidence_ref = null;
noEvidence.predicates.main_worker.evidence_sha256 = null;
assert.throws(() => validateHumanGameplayPreflight(noEvidence), /requires an evidence reference and digest/);

assert.throws(() => validateHumanGameplayPreflight({
  ...packageInput,
  predicates: {
    ...packageInput.predicates,
    main_worker: {
      ...predicate(),
      evidence_ref: "authority.json?access_token=redacted",
      evidence_sha256: "B".repeat(43),
    },
  },
}), /must not contain query or credential data/);

const noInput = spawnSync(process.execPath, [scriptPath], { encoding: "utf8" });
assert.equal(noInput.status, 2, noInput.stderr);
const emptyReport = JSON.parse(noInput.stdout);
assert.equal(emptyReport.preflight_status, "BLOCKED");
assert.equal(emptyReport.readiness_status, "BLOCKED");
assert.equal(emptyReport.gameplay_authorization, "BLOCKED");
assert.equal(emptyReport.network_access, "NOT_USED");
assert.equal(emptyReport.game_started, false);

console.log("human gameplay preflight contract tests passed");